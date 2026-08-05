// apps/btw/lib/btwTileCache.ts
//
// За прямим запитом користувача — "закешировать данные уровня города на старте мини апп на
// уровне устройства - и обновлять кеш только по необходимости". Дані міста (buildings.bin/
// cameras.json/streets.json, § btwLocalScanner.ts) — до кількох МБ на місто (§ tile-generation.
// util.ts: "0.4–1.1 МБ/район"), і без цього кешу телефон користувача перезавантажує їх ПОВНІСТЮ
// з мережі при КОЖНОМУ відкритті мінідодатку — навіть коли сервер видав АБСОЛЮТНО ТІ САМІ байти,
// що вчора. Manifest (`GET /btw/manifest`) вже несе версію кожного шару (§ getLocalTileLayers()
// у btw.service.ts — `uploadedAt` blob'а як cache-bust токен, оновлюється лише коли адмін
// реально перегенерував тайли міста) — саме цю версію й використовуємо як ключ валідності
// кешу: якщо версія з manifest ЗБІГАЄТЬСЯ з тим, що вже лежить на пристрої — просто повертаємо
// кешоване, БЕЗ жодного мережевого запиту на самі файли тайлів (лишається лише сам виклик
// /api/manifest — маленький JSON, потрібен щоразу, щоб дізнатись АКТУАЛЬНУ версію).
//
// IndexedDB (не localStorage) — свідомо: buildings.bin — БІНАРНИЙ ArrayBuffer (не рядок,
// localStorage приймає лише рядки — довелось би base64-кодувати, +33% розміру й зайва
// CPU-робота на кожному відкритті), а квота localStorage (типово ~5-10МБ) надто мала для
// кількох міст із запасом. IndexedDB підтримує структуровані дані (в т.ч. ArrayBuffer) напряму
// й має набагато більшу практичну квоту в усіх сучасних мобільних браузерах/Telegram WebView
// (Chromium/WebKit-рушії).
//
// ⚠️ ЧЕСНО: не перевірено на реальному пристрої/Telegram WebView (немає живого доступу в цьому
// середовищі розробки) — IndexedDB підтримується практично всюди, але приватний режим деяких
// WebView-рушіїв (напр. старий Safari у "Private Browsing") може або дуже жорстко обмежувати
// квоту, або кидати помилку при відкритті БД. Кожна функція нижче свідомо "тихо" деградує до
// null/no-op при БУДЬ-ЯКІЙ помилці IndexedDB — кеш є приємним бонусом, а не критичною залежністю,
// додаток і далі повністю працює (просто повільніше, як і раніше) без нього.

const DB_NAME = 'btw-tile-cache';
const DB_VERSION = 1;
const STORE_NAME = 'cities';

export interface TileLayerVersions {
  buildings: number;
  cameras: number;
  streets: number;
}

export interface CachedCityTiles {
  citySlug: string;
  versions: TileLayerVersions;
  buildingsBuf: ArrayBuffer;
  camerasJson: unknown;
  streetsJson: unknown;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступний (SSR-рендер сторінки або дуже старий браузер)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Один запис на місто (keyPath — citySlug) — новий put() з тим самим citySlug просто
        // ПЕРЕЗАПИСУЄ попередній запис, окремої логіки "видалити стару версію" не треба.
        db.createObjectStore(STORE_NAME, { keyPath: 'citySlug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB.open() failed'));
  });
}

function versionsEqual(a: TileLayerVersions, b: TileLayerVersions): boolean {
  return a.buildings === b.buildings && a.cameras === b.cameras && a.streets === b.streets;
}

// Повертає кешовані тайли ЛИШЕ якщо вони є в IndexedDB, І версії ВСІХ ТРЬОХ шарів точно
// збігаються з тим, що зараз каже manifest — часткова збіжність версій НЕ приймається
// (безпечніше перезавантажити всі 3 файли заново, ніж змішати різні покоління даних одного
// міста, § та сама логіка обережності, що вже ensureCellCacheValidForBbox() на сервері
// застосовує до кешу комірок генерації).
export async function getCachedCityTiles(citySlug: string, versions: TileLayerVersions): Promise<CachedCityTiles | null> {
  try {
    const db = await openDb();
    const cached = await new Promise<CachedCityTiles | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(citySlug);
      req.onsuccess = () => resolve(req.result as CachedCityTiles | undefined);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get() failed'));
    });
    db.close();
    if (!cached) return null;
    if (!versionsEqual(cached.versions, versions)) return null; // сервер перегенерував тайли — кеш застарів
    return cached;
  } catch {
    return null; // будь-яка проблема з IndexedDB (квота, приватний режим, недоступність) — просто працюємо без кешу
  }
}

// Викликач МУСИТЬ дочекатись (await) цей виклик ПЕРЕД тим, як передавати ТОЙ САМИЙ
// buildingsBuf у Worker через transferable postMessage([buildingsBuf]) — транспортний
// список "нейтралізує" (detached) ArrayBuffer у головному потоці одразу після відправки, і
// якщо IndexedDB ще не встигла синхронно склонувати його вміст на момент виклику .put()
// (структуроване клонування в IndexedDB відбувається одразу під час виклику .put(), а не
// лінькво пізніше — але сам виклик .put() усередині цієї функції стається лише ПІСЛЯ await
// openDb(), тобто вже в наступному мікротаску), гонка могла б записати в кеш "обнулений"
// буфер. Саме тому btwLocalScanner.ts::init() робить `await putCachedCityTiles(...)` ДО
// `worker.postMessage(..., [buildingsBuf])`, а не паралельно/після.
export async function putCachedCityTiles(entry: Omit<CachedCityTiles, 'cachedAt'>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...entry, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put() failed'));
    });
    db.close();
  } catch {
    // Не вдалось закешувати (квота/приватний режим/etc.) — не критично, просто наступного разу
    // знову довантажимо з мережі, як і раніше без цієї фічі.
  }
}

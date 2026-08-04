// apps/api/src/btw/tile-generation.util.ts
//
// §4.7.1 ТЗ — спільна (чиста, без Prisma/NestJS DI) логіка збірки тайлів, винесена з
// apps/api/scripts/generate-btw-tiles.ts, щоб її МІГ використовувати і сам CLI-скрипт (без
// живого Nest DI-графа — standalone `new PrismaClient()`), і новий адмінський ендпоінт
// (`BtwService.generateTiles()`, викликається з нової вкладки в адмінці — за прямим запитом
// користувача: "сделай новую вкладку в админке для запуска скрипта... по городам"). Кожен
// виклик приймає вже отриманий список камер (виклик передає його сам, звідки завгодно —
// `new PrismaClient()` у скрипті чи injected `PrismaService` у сервісі) — сама ця функція НЕ
// знає, звідки камери прийшли, тому не залежить від жодного способу підключення до БД.
//
// Той самий принцип "чиста логіка окремо від мережевого/DI виклику", що вже
// azimuth-heuristic.service.ts::extractStreetAzimuthCandidates() застосовує в цьому проєкті.

import { encodeBuildingsTile } from './tile-format';
import type { DecodedBuilding, CamerasTile, CamerasTileEntry, StreetsTile, StreetsTileEntry } from './tile-format';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

// RegistryProxyService — той самий проксі ("VPN проекту"), яким уже ходять fetchThumbImage()
// (btw.service.ts) і fetchStreamImageProxy() (cameras.service.ts) в обхід гео-блокувань.
// Інстанційовано ТУТ напряму (`new`, не Nest DI) — клас не має власних залежностей у
// конструкторі (лише lazy-побудова http(s)-proxy-agent за потреби), тож окремий екземпляр
// повністю безпечний і не порушує "чиста логіка без DI" з коментаря на початку файлу — той
// самий принцип, що вже BtwModule/CamerasModule застосовують ("RegistryProxyService
// зареєстровано ЯК ОКРЕМИЙ провайдер", див. коментарі там).
const registryProxy = new RegistryProxyService();

const METERS_PER_DEG_LAT = 111320;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Той самий haversine-bearing, що вже в apps/api/src/common/geometry.util.ts — окрема мала
// копія тут (не імпорт), той самий принцип, що azimuth-heuristic.service.ts уже застосовує для
// власної копії haversine (уникнення залежності низькорівневого генератора тайлів від
// геодезичного модуля заради однієї функції).
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Та сама рівнокутна ENU-проекція, що apps/btw/lib/btw-geometry-engine.ts::toLocalXY() —
// окрема копія тут з тієї самої причини відсутності спільного пакета (див. коментар на початку
// btw-geometry-engine.ts).
function toLocalXY(origin: { lat: number; lng: number }, point: { lat: number; lng: number }): { x: number; y: number } {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRad(origin.lat));
  return {
    x: (point.lng - origin.lng) * metersPerDegLng,
    y: (point.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CameraForTiling {
  id: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  heightMeters: number | null;
  streamType: string;
  confidence: string;
}

export interface GenerateTilesResult {
  citySlug: string;
  cityDir: string;
  bbox: Bbox;
  cameraCount: number;
  buildingCount: number;
  buildingBytes: number;
  streetCount: number;
  // За прямим запитом користувача — "сделай запуски из вкладки идемпотентными - несколько
  // запусков подряд до исчерпания списка ячеек" (§ коментар біля GENERATION_TIME_BUDGET_MS
  // нижче). cellsTotal/cellsDone — сумарно по ОБОХ шарах (buildings+streets, той самий grid).
  // complete=false означає "цей виклик вичерпав свій часовий бюджет, не діставши всі комірки
  // Overpass — buildings.bin/cameras.json/streets.json ЩЕ НЕ записані (щоб не видати
  // напівготові тайли як готові), просто повторіть виклик (та сама кнопка/CLI-команда) — він
  // сам продовжить з того місця, де кеш комірок на диску зупинився".
  cellsTotal: number;
  cellsDone: number;
  complete: boolean;
}

// Bbox міста — з екстремумів позицій УЖЕ наявних камер (той самий підхід, що
// findDensestCameraPoint() у btw.service.ts вже застосовує для адмінського вибору dev-точки),
// + запас 800м з кожного боку, щоб camera.rangeMeters (типово до кількох сотень метрів) не
// впирався в край тайлу.
export function computeBboxFromCameras(cameras: { lat: number; lng: number }[], marginM = 800): Bbox {
  const lats = cameras.map((c) => c.lat);
  const lngs = cameras.map((c) => c.lng);
  const marginLat = marginM / METERS_PER_DEG_LAT;
  const south = Math.min(...lats) - marginLat;
  const north = Math.max(...lats) + marginLat;
  const refLat = Math.max(Math.abs(south), Math.abs(north));
  const marginLng = marginM / (METERS_PER_DEG_LAT * Math.cos(toRad(refLat)));
  const west = Math.min(...lngs) - marginLng;
  const east = Math.max(...lngs) + marginLng;
  return { south, west, north, east };
}

// ВИПРАВЛЕНО (реальний недолік, знайдений під час підготовки адмінської вкладки — за прямим
// запитом користувача): Overpass-запити нижче мали `[timeout:180]` і виконувались
// ПОСЛІДОВНО (буд-ки, потім вулиці) — до 360с у гіршому разі, тоді як Vercel Hobby має
// жорсткий ліміт 300с на функцію (doc/AUDIT-vercel-hobby.md). CLI-скрипт (запускається на
// власній машині користувача) не має цього обмеження, але НОВИЙ адмінський шлях
// (BtwService.generateTiles(), викликається з HTTP-запиту адмінки) — має. Тому: (1) обидва
// запити тепер ідуть ПАРАЛЕЛЬНО (Promise.all), (2) внутрішній Overpass-таймаут зменшено (§ нижче
// — тепер 55с, трохи менше за клієнтський OVERPASS_ATTEMPT_TIMEOUT_MS, щоб сервер встиг
// відповісти власним graceful-таймаутом ДО того, як клієнт сам обірве з'єднання) — разом дає
// запас під 300с навіть з накладними витратами Prisma/кодування/диску. Для дуже великих/щільних
// міст цього однаково може не вистачити — у такому разі рекомендація (в UI адмінки) —
// запустити CLI-скрипт локально, де такого обмеження немає.
const OVERPASS_QUERY_TIMEOUT_S = 55;

// За прямим запитом користувача ("свой User-Agent в запросах (хороший тон, который сейчас у
// нас отсутствует)") — той самий принцип, що вже geocoding.service.ts застосовує для Nominatim
// ("требует идентифицирующий User-Agent... без него запросы могут блокироваться без
// предупреждения"). Overpass API офіційно рекомендує те саме (OSM Wiki/Fair Use policy —
// описовий User-Agent із назвою застосунку й контактом, щоб адміністратори сервісу могли
// зв'язатись замість мовчазного бану IP при проблемній поведінці клієнта). Формат — рядок, а
// не браузерний User-Agent-спуфінг (той стиль, що вже 'RoadScoutBot/1.0' у scraper/providers/*
// — там навмисно імітується браузер, щоб обійти анти-бот захист сайтів-агрегаторів; тут інша
// мета — чесно ідентифікуватись публічному API, тому інший, "не-браузерний" формат, як і в
// geocoding.service.ts).
const OVERPASS_USER_AGENT = 'RoadScout-BTW-TileGenerator/1.0 (+https://roadscout.example/bot; tile generation for offline radar scanning)';

// ВИПРАВЛЕНО (реальний, відтворюваний інцидент — скріншот користувача з /admin/btw-tiles:
// генерація для New York двічі поспіль провалилась з `Overpass HTTP 406`, обидва рази менш
// ніж за секунду — надто швидко для реального таймауту чи "живого" rate-limit черги). Пошук
// (community.openstreetmap.org/t/overpass-api-error-406, cadshift.com/blog/qgis-overpass-406)
// підтверджує: це НЕ пов'язано з відсутністю User-Agent (він уже є вище, попередній крок
// цього самого запиту користувача) чи з нашим запитом — головний інстанс overpass-api.de
// останнім часом застосовує "request-shape"-фільтри проти AI-скрейперів, що інколи блокують
// і легітимних клієнтів так само. Список дзеркал — ті самі публічні інстанси, що вже досліджені
// й названі користувачу в цій сесії раніше ("как настроить Overpass"). OVERPASS_ENDPOINTS
// дозволяє адміну перевизначити список/порядок через env, не чіпаючи код (той самий принцип
// конфігурованості, що вже в OVERPASS_QUERY_TIMEOUT_S/getContentCheckTimeBudgetMs() тощо по
// проєкту).
const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
function getOverpassEndpoints(): string[] {
  const fromEnv = process.env.OVERPASS_ENDPOINTS?.split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OVERPASS_ENDPOINTS;
}

// ПЕРЕРОБЛЕНО (за прямим запитом користувача — наступний скріншот після впровадження дзеркал
// вище показав, що ПОСЛІДОВНИЙ перебір сам створює нову проблему: перший ендпоінт просто
// ЗАВИС — не відповів швидкою 406, а мовчав аж до власного AbortSignal ("The operation was
// aborted due to timeout", 1м46с), з'ївши майже весь тодішній бюджет 120с на ОДНУ спробу з
// чотирьох). Дослівні вимоги користувача: "добавь тайм менеджмент = максимум 60 секунд",
// "добавь кокурентность - 5 запросов одновременно", "вторую группу запросов параллельно через
// впн проекта". Реалізовано так:
//
// 1) Часовий менеджмент — 60с. Оскільки ВСІ спроби нижче тепер ідуть ОДНОЧАСНО (не по черзі),
//    один спільний таймаут на кожну спробу (OVERPASS_ATTEMPT_TIMEOUT_MS) автоматично і є
//    фактичним лімітом часу на весь виклик — не сума по спробах, як у попередній послідовній
//    версії, а їхній max (усі стартують разом).
// 2) Конкурентність — до 5 запитів одночасно: по одному прямому запиту на кожне дзеркало
//    (MAX_CONCURRENT_OVERPASS_REQUESTS обмежує зверху) + друга група нижче.
// 3) Друга група — той самий головний ендпоінт, але через VPN проекту (RegistryProxyService,
//    той самий проксі, що вже fetchThumbImage()/fetchStreamImageProxy() використовують для
//    обходу гео-блокувань) — паралельно з прямими спробами, а не замість них: інша вихідна IP-
//    адреса іноді обходить саме той "request-shape"-фільтр, що спричиняє 406 (VPN — інший
//    патерн трафіку, не обов'язково інша причина блокування, тож про запас, а не замість).
//
// Перемагає та спроба, що відповість першою успішно (Promise.any) — решта просто ігноруються
// (без явного скасування "запізнілих" запитів, вони самі згаснуть по AbortSignal). Якщо
// провалились УСІ — кидається агрегована помилка з причиною кожної спроби (видно в історії
// запусків адмінки, BtwTileGenerationRun.error).
const OVERPASS_ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_OVERPASS_REQUESTS = 5;

interface OverpassAttempt {
  label: string;
  run: () => Promise<any>;
}

function buildOverpassAttempts(query: string): OverpassAttempt[] {
  const endpoints = getOverpassEndpoints().slice(0, MAX_CONCURRENT_OVERPASS_REQUESTS);
  const attempts: OverpassAttempt[] = endpoints.map((endpoint) => ({
    label: endpoint,
    run: () =>
      axios
        .post(endpoint, query, {
          headers: { 'User-Agent': OVERPASS_USER_AGENT, 'Content-Type': 'text/plain' },
          timeout: OVERPASS_ATTEMPT_TIMEOUT_MS,
          validateStatus: (s) => s >= 200 && s < 300,
        })
        .then((res) => res.data),
  }));

  // Друга група (п.3 вище) — лише якщо VPN реально налаштований і лишилось місце в лімiтi
  // конкурентності; інакше registryProxy.request() сам виродився б у ще один прямий запит до
  // того самого ендпоінту — жодної додаткової користі, лише зайвий дубль.
  if (attempts.length < MAX_CONCURRENT_OVERPASS_REQUESTS && endpoints.length > 0 && registryProxy.isConfigured()) {
    const viaVpnEndpoint = endpoints[0];
    attempts.push({
      label: `${viaVpnEndpoint} (через VPN проекту)`,
      run: () =>
        registryProxy
          .request((axiosConfig) =>
            axios.post(viaVpnEndpoint, query, {
              ...axiosConfig,
              headers: { 'User-Agent': OVERPASS_USER_AGENT, 'Content-Type': 'text/plain' },
              timeout: OVERPASS_ATTEMPT_TIMEOUT_MS,
              validateStatus: (s) => s >= 200 && s < 300,
            }),
          )
          .then((result) => result.data.data),
    });
  }

  return attempts;
}

async function fetchOverpass(query: string): Promise<any> {
  const attempts = buildOverpassAttempts(query);
  if (attempts.length === 0) {
    throw new Error('Overpass: нет доступных эндпоинтов (OVERPASS_ENDPOINTS пуст)');
  }

  try {
    return await Promise.any(attempts.map((a) => a.run()));
  } catch (err) {
    // AggregateError, коли ВСІ спроби відхилені — err.errors у тому самому порядку, що attempts.
    const reasons = err instanceof AggregateError ? err.errors : [err];
    const details = reasons.map((e: any, i: number) => `${attempts[i]?.label ?? '?'}: ${e?.response?.status ? `HTTP ${e.response.status}` : e?.message ?? e}`).join('; ');
    throw new Error(`Overpass: все ${attempts.length} параллельных попытки провалились — ${details}`);
  }
}

// ВИПРАВЛЕНО (за прямим запитом користувача — "разбей bbox на сетку", після того як живий тест
// на New York (692 камери, bbox — практично весь округ) показав, що навіть 5 конкурентних
// спроб/дзеркал/VPN (§ вище) не рятують: VPN обійшов бан-фільтр overpass-api.de (замість 406
// отримали 504 — Gateway Timeout: запит ДІЙШОВ, але сервер не встиг його порахувати за 60с), а
// незалежні дзеркала просто зависали без відповіді. Це вже не питання блокування конкретного
// ендпоінту — сам ОДИН величезний запит для всього міста структурно завеликий для Overpass,
// скільки дзеркал не перебирай). Тепер bbox розбивається на сітку менших комірок
// (GRID_CELL_SIZE_M, за замовчуванням 4×4 км) — кожна комірка йде ОКРЕМИМ Overpass-запитом
// (через ту саму 5-конкурентну гонку дзеркал+VPN вище), результати об'єднуються з дедуплікацією
// по id (одна OSM way може мати вузли в кількох сусідніх комірках і тому потрапити в
// результати більш ніж однієї комірки — Overpass повертає way, якщо ХОЧА Б один її вузол
// потрапляє в bbox). Для міст, чий bbox МЕНШИЙ за одну комірку (типовий випадок — Київ і
// подібні), сітка вироджується в ОДНУ комірку, що дорівнює всьому bbox — поведінка НЕ
// змінюється порівняно з попередньою версією.
const GRID_CELL_SIZE_M = 4000;
// Скільки комірок обробляти ОДНОЧАСНО — кожна комірка сама по собі вже до 5 конкурентних
// HTTP-запитів (§ вище), тож занадто високе число тут помножило б навантаження на й так
// перевантажені публічні дзеркала Overpass. Для дуже великого міста (десятки комірок) це
// свідомий компроміс "довше, але надійніше", а не "якнайшвидше" —§ AUDIT-btw-radar-m1-m2.md.
const GRID_QUERY_CONCURRENCY = 3;

export function splitBboxIntoGrid(bbox: Bbox, cellSizeM = GRID_CELL_SIZE_M): Bbox[] {
  const refLat = Math.max(Math.abs(bbox.south), Math.abs(bbox.north));
  const latStep = cellSizeM / METERS_PER_DEG_LAT;
  const lngStep = cellSizeM / (METERS_PER_DEG_LAT * Math.cos(toRad(refLat)));

  const cells: Bbox[] = [];
  for (let south = bbox.south; south < bbox.north; south += latStep) {
    const north = Math.min(south + latStep, bbox.north);
    for (let west = bbox.west; west < bbox.east; west += lngStep) {
      const east = Math.min(west + lngStep, bbox.east);
      cells.push({ south, west, north, east });
    }
  }
  return cells;
}

// Обмежена конкурентність без залежності від сторонніх бібліотек (p-limit тощо — той самий
// принцип "без зайвих npm-залежностей заради однієї функції", що вже bearing()/toLocalXY() тут
// же копіюють замість імпорту спільного пакета).
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function dedupeElementsById(elements: any[]): any[] {
  const seen = new Set<number>();
  const result: any[] = [];
  for (const el of elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    result.push(el);
  }
  return result;
}

// За прямим запитом користувача — "сделай запуски из вкладки идемпотентными - несколько
// запусков подряд до исчерпания списка ячеек": для дуже великого міста (Нью-Йорк — кілька
// десятків комірок сітки, § вище) один HTTP-виклик адмінки (Vercel Hobby, 300с) або навіть
// одне термінальне очікування CLI фізично не встигне обробити ВСІ комірки за раз. Замість
// "усе за один прохід або нічого" — кожна комірка, щойно отримана, ОДРАЗУ пишеться на диск
// (кеш-файл `<cityDir>/.cellcache/<layer>/<cellIndex>.json`), а НАСТУПНИЙ виклик
// generateTilesForCity() для того самого міста (наступний клік на кнопку в адмінці — та сама
// ідемпотентність, що вже в BtwService.generateTiles()/BtwTileGenerationRun, чи наступний
// запуск CLI-скрипта локально) перевіряє, які комірки вже готові на диску, і довантажує ЛИШЕ
// відсутні — доки список комірок не вичерпається. Остаточні тайли (buildings.bin/cameras.json/
// streets.json) пишуться ЛИШЕ коли комірки ОБОХ шарів (buildings+streets) повністю готові —
// інакше манфест (`getLocalTileLayers()`) продовжує чесно показувати "тайлів немає" замість
// видачі напівготових даних як завершених.
//
// ⚠️ ЧЕСНО: кеш комірок на диску — те саме припущення про стійкість файлової системи
// BTW_TILES_DIR між окремими HTTP-викликами адмінки на Vercel, що вже неявно закладено в
// існуючий механізм видачі готових тайлів (getTilesDir()/getLocalTileLayers()) — я не вводжу
// новий клас ризику, лише покладаюсь на той самий, вже наявний. Якщо серверless-інстанси
// Vercel НЕ поділяють диск між викликами насправді — кеш комірок (і сама видача готових
// тайлів) однаково не працює вже сьогодні, до цього кроку.
const GENERATION_TIME_BUDGET_MS = 220_000; // з запасом під 300с Vercel Hobby — лишає час на Prisma/кодування/фіналізацію

interface LayerGridResult {
  elements: any[];
  cellsDone: number;
}

// Перевіряє/скидає кеш комірок, якщо bbox змінився з попереднього запуску (склад камер міста
// змінився між двома кліками на кнопку — реальна, хоч і рідкісна ситуація) — довіряти кешу
// комірок, порахованому для ІНШОЇ географії, небезпечно (дало б неправильні дані без жодної
// помітної ознаки браку).
function ensureCellCacheValidForBbox(cacheDir: string, bbox: Bbox): void {
  const bboxFile = path.join(cacheDir, 'bbox.json');
  const bboxJson = JSON.stringify(bbox);
  let cachedBboxJson: string | null = null;
  try {
    cachedBboxJson = fs.readFileSync(bboxFile, 'utf-8');
  } catch {
    cachedBboxJson = null;
  }
  if (cachedBboxJson !== bboxJson) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(bboxFile, bboxJson);
  }
}

// Одна комірка, що впала (мережа/усі 5 спроб провалились) — НЕ обриває решту: просто лишається
// pending і буде повторно спробувана наступним викликом, разом з рештою недороблених комірок.
// Набагато стійкіше за попередню версію (де будь-яка провалена комірка валила ВЕСЬ прогін) —
// саме цього бракувало, коли Overpass реально ненадійний (живі 406/504/timeout зі скріншотів
// користувача цієї сесії).
async function fetchLayerGridResumable(
  layer: 'buildings' | 'streets',
  cells: Bbox[],
  cacheDir: string,
  buildQuery: (cell: Bbox) => string,
  filterElement: (el: any) => boolean,
  deadline: number,
): Promise<LayerGridResult> {
  const layerCacheDir = path.join(cacheDir, layer);
  fs.mkdirSync(layerCacheDir, { recursive: true });

  const cellFile = (i: number) => path.join(layerCacheDir, `${i}.json`);
  const pending = cells.map((_, i) => i).filter((i) => !fs.existsSync(cellFile(i)));

  if (pending.length > 0) {
    await mapWithConcurrency(pending, GRID_QUERY_CONCURRENCY, async (cellIndex) => {
      if (Date.now() >= deadline) return; // бюджет вичерпано — лишаємо комірку pending для наступного виклику
      try {
        const data = await fetchOverpass(buildQuery(cells[cellIndex]));
        const elements = ((data.elements ?? []) as any[]).filter(filterElement);
        fs.writeFileSync(cellFile(cellIndex), JSON.stringify(elements));
        if (cells.length > 1) {
          console.log(`[tile-generation] ${layer}: комірка ${cellIndex + 1}/${cells.length} готова (${elements.length} елементів)`);
        }
      } catch (err) {
        console.warn(`[tile-generation] ${layer}: комірка ${cellIndex + 1}/${cells.length} провалилась — ${(err as Error).message} (спробуємо в наступному запуску)`);
      }
    });
  }

  // Джерело істини — файлова система (а не лічильник у пам'яті цього виклику): так наступний
  // запуск бачить прогрес попереднього незалежно від того, ЯКИЙ саме виклик записав кожен файл.
  const allElements: any[] = [];
  let cellsDone = 0;
  for (let i = 0; i < cells.length; i++) {
    try {
      allElements.push(...JSON.parse(fs.readFileSync(cellFile(i), 'utf-8')));
      cellsDone += 1;
    } catch {
      // файлу ще немає — комірка досі pending
    }
  }

  return { elements: dedupeElementsById(allElements), cellsDone };
}

// ⚠️ ЧЕСНО: жоден наявний сервіс проєкту досі не парсив висоту будівель з OSM
// (occlusion.service.ts перевіряє лише 2D-перетин полігону, без висоти взагалі) — тому це НОВА
// евристика, не порт. "height" (метри) пріоритетний за наявності, інакше
// "building:levels" × 3м (типова висота поверху), інакше дефолт 9м (3 поверхи) — консервативне
// наближення, прийнятне для LOS-тесту (isVisible()) у щільній міській забудові.
export function estimateHeightM(tags: Record<string, string> | undefined): number {
  if (!tags) return 9;
  const height = parseFloat(tags['height'] ?? '');
  if (Number.isFinite(height) && height > 0) return height;
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * 3;
  return 9;
}

// Уся "важка" робота — Overpass-запити, кодування, запис на диск. Викликач відповідає лише за
// отримання `cameras` (звідки завгодно) і `citySlug` (§ нижче — навмисно `slug`, не
// відображуване `City.name`, див. ВИПРАВЛЕНО-коментар у btw.service.ts::generateTiles()).
//
// ІДЕМПОТЕНТНІ БАГАТОРАЗОВІ ЗАПУСКИ (за прямим запитом користувача — "сделай запуски из
// вкладки идемпотентными - несколько запусков подряд до исчерпания списка ячеек", § детальний
// коментар біля GENERATION_TIME_BUDGET_MS вище): функція тепер може повернутись, НЕ дописавши
// фінальні тайли — `result.complete === false` — якщо не встигла обробити всі комірки сітки
// за свій часовий бюджет. Виклик просто ПОВТОРЮЄТЬСЯ (той самий citySlug/cameras/tilesDir) —
// кеш комірок на диску сам підхоплює прогрес з попереднього разу.
export async function generateTilesForCity(citySlug: string, cameras: CameraForTiling[], tilesDir: string): Promise<GenerateTilesResult> {
  if (cameras.length === 0) {
    throw new Error(`no VERIFIED/OUTDOOR/ONLINE cameras found for city slug="${citySlug}" — nothing to tile`);
  }

  const bbox = computeBboxFromCameras(cameras);
  const cityDir = path.join(tilesDir, citySlug);
  const cellCacheDir = path.join(cityDir, '.cellcache');
  ensureCellCacheValidForBbox(cellCacheDir, bbox);

  const cells = splitBboxIntoGrid(bbox);
  const deadline = Date.now() + GENERATION_TIME_BUDGET_MS;

  // Послідовно (не Promise.all, як у попередній версії) — свідомо, для простоти й чіткості
  // прогресу: buildings спершу забирають свою частку бюджету, streets — те, що лишилось.
  // Кожен шар усередині себе однаково паралелить комірки (GRID_QUERY_CONCURRENCY), тож
  // конкурентність не втрачається, лише координація між двома шарами спрощена.
  const buildingsResult = await fetchLayerGridResumable(
    'buildings',
    cells,
    cellCacheDir,
    (cell) => `
      [out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
      way["building"](${cell.south},${cell.west},${cell.north},${cell.east});
      out geom;
    `,
    (el) => el.geometry?.length >= 3,
    deadline,
  );
  const streetsResult = await fetchLayerGridResumable(
    'streets',
    cells,
    cellCacheDir,
    (cell) => `
      [out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
      way["highway"](${cell.south},${cell.west},${cell.north},${cell.east});
      out geom;
    `,
    (el) => el.geometry?.length >= 2,
    deadline,
  );

  const cellsTotal = cells.length * 2; // buildings + streets — той самий grid, дві незалежні прогрес-доріжки
  const cellsDone = buildingsResult.cellsDone + streetsResult.cellsDone;
  const complete = buildingsResult.cellsDone === cells.length && streetsResult.cellsDone === cells.length;

  if (!complete) {
    // НЕ пишемо buildings.bin/cameras.json/streets.json — манфест (getLocalTileLayers()) має
    // й далі чесно показувати "тайлів немає", доки дані справді не повні. Кеш комірок на диску
    // вже зберігає все, що встигли забрати цим викликом — наступний виклик продовжить звідси.
    return { citySlug, cityDir, bbox, cameraCount: cameras.length, buildingCount: buildingsResult.elements.length, buildingBytes: 0, streetCount: streetsResult.elements.length, cellsTotal, cellsDone, complete: false };
  }

  const buildingElements = buildingsResult.elements;
  const streetElements = streetsResult.elements;

  // Origin — центр bbox, той самий tileOrigin, який клієнтський toLocalXY()/fromLocalXY()
  // (btw-geometry-engine.ts) використовує для проекції camera/building координат у локальні
  // ENU-метри. §4.7.1 (спрощення цього кроку): "ОДИН тайл на місто", не z15-піраміда — тому
  // origin теж один на все місто (див. doc/AUDIT-btw-radar-m1-m2.md).
  const origin = { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 };

  const buildings: DecodedBuilding[] = buildingElements.map((el: any) => ({
    heightM: estimateHeightM(el.tags),
    vertices: el.geometry.map((p: any) => toLocalXY(origin, { lat: p.lat, lng: p.lon })),
  }));

  const buildingsBuf = encodeBuildingsTile(origin.lat, origin.lng, buildings);

  const camerasTile: CamerasTile = {
    version: 1,
    cameras: cameras.map(
      (c): CamerasTileEntry => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        heightMeters: c.heightMeters ?? 3, // §4.7.1 поле "висота" — дефолт для камер без явного значення
        azimuth: c.azimuth,
        fovAngle: c.fovAngle,
        rangeMeters: c.rangeMeters,
        streamType: c.streamType,
        confidence: c.confidence,
      }),
    ),
  };

  // Дослівно та сама логіка, що вже extractStreetAzimuthCandidates() (azimuth-heuristic.
  // service.ts) використовує в проді — обидва напрямки осі (bearing і bearing+180°),
  // дедуплікація в межах 10° — щоб getNearbyStreetAzimuths() у Worker'і (btw-scan.worker.ts)
  // повертав НАБІР кандидатів, еквівалентний тому, що раніше давав живий Overpass-запит.
  const DEDUP_TOLERANCE_DEG = 10;
  const streets: StreetsTileEntry[] = [];
  for (const way of streetElements) {
    const geometry = way.geometry;
    for (let i = 0; i < geometry.length - 1; i++) {
      const p1 = geometry[i];
      const p2 = geometry[i + 1];
      const segBearing = bearing(p1.lat, p1.lon, p2.lat, p2.lon);
      const axisAzimuths: number[] = [];
      for (const candidate of [segBearing, (segBearing + 180) % 360]) {
        const isDuplicate = axisAzimuths.some((existing) => {
          const diff = Math.abs(existing - candidate) % 360;
          return Math.min(diff, 360 - diff) < DEDUP_TOLERANCE_DEG;
        });
        if (!isDuplicate) axisAzimuths.push(candidate);
      }
      streets.push({ lat: (p1.lat + p2.lat) / 2, lng: (p1.lon + p2.lon) / 2, axisAzimuths });
    }
  }
  const streetsTile: StreetsTile = { version: 1, streets };

  fs.mkdirSync(cityDir, { recursive: true });

  fs.writeFileSync(path.join(cityDir, 'buildings.bin'), Buffer.from(buildingsBuf));
  fs.writeFileSync(path.join(cityDir, 'cameras.json'), JSON.stringify(camerasTile));
  fs.writeFileSync(path.join(cityDir, 'streets.json'), JSON.stringify(streetsTile));

  // Успішно завершено — кеш комірок більше не потрібен (не накопичуємо диск між містами).
  fs.rmSync(cellCacheDir, { recursive: true, force: true });

  return {
    citySlug,
    cityDir,
    bbox,
    cameraCount: cameras.length,
    buildingCount: buildings.length,
    buildingBytes: buildingsBuf.byteLength,
    streetCount: streets.length,
    cellsTotal,
    cellsDone,
    complete: true,
  };
}

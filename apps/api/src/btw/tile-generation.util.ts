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
import axios from 'axios';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';
import { fetchOverpassConcurrent } from '../common/overpass-client.util';

// РЕФАКТОРИНГ (за прямим запитом користувача — розбір випадку з AI-автокалібруванням камери,
// що повернуло "Азимут: —"; § детальний розбір у common/overpass-client.util.ts): гонка по
// кількох Overpass-дзеркалах + опційна VPN-група раніше була ПРОДубльована тут і в
// azimuth-heuristic.service.ts (де взагалі не було дзеркал — лише голий fetch() до одного
// ендпоінту). Спільна функція тепер у overpass-client.util.ts, використовується ОБОМА місцями —
// нижче лишились лише локальні для генерації тайлів значення (таймаут/конкурентність), самі
// HTTP-спроби більше не дублюються тут.
//
// RegistryProxyService — той самий проксі ("VPN проекту"), яким уже ходять fetchThumbImage()
// (btw.service.ts) і fetchStreamImageProxy() (cameras.service.ts) в обхід гео-блокувань.
// Інстанційовано ТУТ напряму (`new`, не Nest DI) — клас не має власних залежностей у
// конструкторі (лише lazy-побудова http(s)-proxy-agent за потреби), тож окремий екземпляр
// повністю безпечний і не порушує "чиста логіка без DI" з коментаря на початку файлу — той
// самий принцип, що вже BtwModule/CamerasModule застосовують ("RegistryProxyService
// зареєстровано ЯК ОКРЕМИЙ провайдер", див. коментарі там).
const registryProxy = new RegistryProxyService();

// ==== Сховище тайлів — Vercel Blob (§ детальний розбір нижче) ====
//
// ВИПРАВЛЕНО (реальний, живий інцидент на проді — адмін отримав
// `ENOENT: no such file or directory, mkdir '/var/task/btw-tiles/new-york-us/.cellcache'`
// одразу після того, як Overpass-запити нарешті почали проходити): на Vercel serverless-
// функціях файлова система ПОЗА `/tmp` — READ-ONLY (`/var/task` — це розгорнутий бандл коду), а
// `/tmp` хоч і доступний на запис, НЕ гарантовано переживає МІЖ окремими HTTP-викликами (кожен
// клік на кнопку в адмінці може потрапити на інший інстанс функції з чистим `/tmp`). §4.7.1 ТЗ
// від самого початку вимагав саме об'єктне сховище (R2/Supabase Storage) — на момент першої
// реалізації цього кроку не було credentials до жодного з них (doc/AUDIT-btw-radar-m1-m2.md,
// розділ "Спрощення"). Тепер credentials Є — `@vercel/blob` вже є залежністю проєкту
// (package.json: `^0.27.1`) і вже реально працює в продакшені для
// home-verification/receipt-storage.service.ts::store() — переносимо сховище тайлів (і кеш
// комірок сітки) туди, той самий пакет, той самий принцип доступу.
//
// ⚠️ ЧЕСНО, версія SDK: `^0.27.1` — СТАРА версія (перевірено проти реального .d.ts саме цієї
// версії через unpkg.com, а не проти найновішої документації) БЕЗ `get()`, БЕЗ
// `access:'private'` (єдине прийняте значення в цій версії — `'public'`), БЕЗ `allowOverwrite`
// (з'явились лише в 2.x). Тому нижче свідомо використовуються ЛИШЕ `put`/`list`/`del` (усі є в
// 0.27.1) з `access:'public'` — той самий рівень доступу, що вже receipt-storage.service.ts
// використовує, прийнятний тут із тієї самої причини, що вже задокументовано в контролері для
// `/btw/tiles/*` (geometрічні дані тайлів не чутливі, guard на цьому шляху не стояв і раніше).
// Читання вмісту — звичайний `axios.get(blob.url)` замість SDK-методу `get()` (якого в цій
// версії немає) — блоб публічний, тому пряме HTTP GET без токена працює.
const BLOB_PATH_PREFIX = 'btw-tiles';

// Захист від конструювання "дивних" blob-шляхів із чужого/невалідного `citySlug` (приходить від
// клієнта як @Query('city')/@Body().city/@Param — той самий принцип обережності, що раніше
// застосовував path.basename() для локальних шляхів). Vercel Blob API прямо забороняє символи
// `#`, `?`, `//` у pathname — sanitize тут про запас, а не тому що це колись реально стрілило.
function sanitizeSlug(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || '_';
}

export function getCityBlobPrefix(citySlug: string): string {
  return `${BLOB_PATH_PREFIX}/${sanitizeSlug(citySlug)}`;
}

// Мінімальний зріз ListBlobResultBlob (0.27.1) — саме ці поля реально повертає list().
export interface BlobListEntry {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
}

export async function listBlobsByPrefix(prefix: string): Promise<BlobListEntry[]> {
  const { list } = await import('@vercel/blob');
  // ⚠️ ЧЕСНО: ліміт 1000 записів на сторінку, БЕЗ пагінації (курсор ігнорується навмисно) —
  // для реалістичного розміру міста (сітка з десятків комірок × 2 шари + 1 bbox.json + 3
  // фінальні файли) це на порядки більше, ніж коли-небудь знадобиться в межах ОДНОГО міста.
  const result = await list({ prefix, limit: 1000 });
  return result.blobs;
}

async function putBlob(pathname: string, body: string | Buffer, contentType: string): Promise<string> {
  const { put } = await import('@vercel/blob');
  const blob = await put(pathname, body, { access: 'public', addRandomSuffix: false, contentType });
  return blob.url;
}

async function deleteBlobsByPrefix(prefix: string): Promise<void> {
  const blobs = await listBlobsByPrefix(prefix);
  if (blobs.length === 0) return;
  const { del } = await import('@vercel/blob');
  await del(blobs.map((b) => b.url));
}

// Немає allowOverwrite у цій версії SDK (§ коментар вище) — тому для файлів, які МОЖУТЬ
// перезаписуватись (фінальні тайли при повторній генерації того самого міста), явно видаляємо
// перед записом замість покладання на невідому поведінку put() при колізії pathname.
async function putBlobOverwrite(pathname: string, body: string | Buffer, contentType: string): Promise<string> {
  await deleteBlobsByPrefix(pathname);
  return putBlob(pathname, body, contentType);
}

export async function fetchBlobJson(url: string): Promise<any> {
  const res = await axios.get(url);
  return res.data;
}

export async function fetchBlobBuffer(url: string): Promise<Buffer> {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// ДОДАНО (за прямим запитом користувача — "мы создаем полный кеш overpass by city - предлагаю
// использовать сначала его а уже потом фоллбеком переходить к сервису запросов"): читання
// вже згенерованого streets.json міста, щоб AzimuthHeuristicService (scraper/azimuth-heuristic.
// service.ts) міг перевірити ЙОГО ПЕРШИМ, перш ніж бити живий Overpass — той самий bbox+запас
// 800м, що вже покриває всі камери міста (§ computeBboxFromCameras), тому для точки в межах
// цього міста кеш дає ТУ САМУ відповідь, що дав би живий запит, але без мережевого виклику й
// без ризику 406/504/timeout.
//
// Власний невеликий TTL-кеш у пам'яті (окремий від AzimuthHeuristicService.cache — інша форма
// значення, весь StreetsTile, а не один AzimuthGuess) — інакше кожен виклик fetchGuess()/
// getNearbyStreetAzimuths() (для BTW-сканування — раз на ~2с при активному скануванні, § вже
// задокументовано в azimuth-heuristic.service.ts) бив би Vercel Blob (list()+GET) наново,
// повертаючи ОДИН і той самий вміст streets.json, що не змінюється між регенераціями міста.
const STREETS_TILE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 хв — достатньо, щоб не бити Blob на кожен виклик, і досить мало, щоб підхопити регенерацію того самого міста без рестарту процесу
interface StreetsTileCacheEntry {
  tile: StreetsTile | null; // null — навмисно кешується теж (немає завершеної генерації для цього міста), щоб не повторювати list() щоразу
  expiresAt: number;
}
const streetsTileCache = new Map<string, StreetsTileCacheEntry>();

export async function getCachedStreetsTile(citySlug: string): Promise<StreetsTile | null> {
  const cached = streetsTileCache.get(citySlug);
  if (cached && cached.expiresAt > Date.now()) return cached.tile;

  let tile: StreetsTile | null = null;
  try {
    const pathname = `${getCityBlobPrefix(citySlug)}/streets.json`;
    const found = (await listBlobsByPrefix(pathname))[0];
    if (found) tile = await fetchBlobJson(found.url);
  } catch {
    tile = null; // не критично — викликач (AzimuthHeuristicService) сам падає на живий Overpass
  }

  streetsTileCache.set(citySlug, { tile, expiresAt: Date.now() + STREETS_TILE_CACHE_TTL_MS });
  return tile;
}

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
  // За прямим запитом користувача — живий випадок "задвоилась камера" (дві картки кандидата в
  // мінідодатку з однаковою дистанцією/текстом, неможливо було відрізнити на очах, чи це та сама
  // камера двічі, чи дві різні поруч) — § детальний коментар біля CamerasTileEntry в tile-format.ts.
  name: string;
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
  // Було `cityDir` (шлях на локальному диску) — перейменовано на `cityBlobPrefix` при переносі
  // сховища на Vercel Blob (§ коментар біля BLOB_PATH_PREFIX вище): це більше не директорія на
  // диску, а префікс pathname у Blob-сховищі (`btw-tiles/<slug>/...`).
  cityBlobPrefix: string;
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

// За прямим запитом користувача (живий інцидент — CLI-запуск на New York впирався саме у ці
// 55с/60с таймаути на "живих", НЕ заблокованих дзеркалах (kumi.systems/private.coffee) для
// найщільніших комірок Мангеттена, а не в 406-блокування overpass-api.de/lz4 — ті просто
// одразу відсіювались). Адмінська кнопка (BtwService.generateTiles(), HTTP-запит) і далі жорстко
// обмежена Vercel Hobby (300с на функцію) — тому саме ЦІ дефолти нижче лишаються НЕЗМІННИМИ (їх
// і далі використовує generateTilesForCity(), якщо викликач не передав options.overpassAttemptTimeoutS
// явно). Але окремий CLI-скрипт (apps/api/scripts/generate-btw-tiles.ts) виконується на
// власній машині розробника й НЕ має жодного serverless-обмеження — для нього тепер можна
// передати щедріші значення через GenerateTilesOptions, не чіпаючи behavior адмінського шляху.
export interface GenerateTilesOptions {
  // За прямим запитом користувача — "скрипт каждый раз разбивает новую сетку по новой и
  // стартует с нуля - добавь флаг continue". bbox за замовчуванням рахується ЗАНОВО з живого
  // списку камер при КОЖНОМУ виклику (computeBboxFromCameras нижче) — а список камер у БД
  // реально змінюється між окремими запусками CLI-скрипта (сканер/скрапер додає нові камери у
  // фоні — живий приклад цього кроку: той самий citySlug дав 694 камери в одному запуску й 845
  // у наступному). Навіть ОДНА нова камера на краю території зсуває min/max lat/lng, тобто й
  // bbox — а ensureCellCacheValidForBbox() звіряє {bbox, cellSizeM} З ПОПЕРЕДНІМ запуском і
  // скидає ВЕСЬ кеш комірок при будь-якій розбіжності (§ детальний коментар там — свідомо,
  // щоб не змішати геодані різної географії), хоча вже готові комірки для майже тієї самої
  // території й далі цілком валідні. `bboxOverride`, якщо передано, підміняє
  // computeBboxFromCameras() РІВНО тим bbox, що дав попередній запуск (§ CLI-флаг --continue,
  // getCellCacheBboxSnapshot() нижче) — тоді ensureCellCacheValidForBbox() бачить ТОЙ САМИЙ
  // bbox і НЕ скидає прогрес, навіть якщо живий список камер тим часом підріс/змінився.
  bboxOverride?: Bbox;
  // Скільки часу (мс) на ОДИН виклик generateTilesForCity() відводиться перед тим, як
  // повернутись частково готовим (ідемпотентний resume, § GENERATION_TIME_BUDGET_MS нижче).
  timeBudgetMs?: number;
  // Overpass-таймаут ОДНІЄЇ спроби (передається в fetchOverpassConcurrent) — має бути ТРОХИ
  // БІЛЬШИМ за overpassQueryTimeoutS нижче, щоб клієнт встиг дочекатись власної graceful-
  // відповіді Overpass ДО того, як сам обірве з'єднання (той самий принцип, що вже й для
  // дефолтних 60с/55с).
  overpassAttemptTimeoutMs?: number;
  // Серверний `[timeout:N]` усередині самого Overpass QL — має лишатись МЕНШИМ за
  // overpassAttemptTimeoutMs вище (з тим самим запасом ~5с, що вже в дефолтах).
  overpassQueryTimeoutS?: number;
}

// ПЕРЕРОБЛЕНО (за прямим запитом користувача — наступний скріншот після впровадження дзеркал
// показав, що ПОСЛІДОВНИЙ перебір сам створює нову проблему: перший ендпоінт просто ЗАВИС — не
// відповів швидкою 406, а мовчав аж до власного AbortSignal ("The operation was aborted due to
// timeout", 1м46с), з'ївши майже весь тодішній бюджет 120с на ОДНУ спробу з чотирьох). Дослівні
// вимоги користувача: "добавь тайм менеджмент = максимум 60 секунд", "добавь кокурентность - 5
// запросов одновременно", "вторую группу запросов параллельно через впн проекта" — сама логіка
// гонки (дзеркала + VPN-група) тепер у спільному common/overpass-client.util.ts::
// fetchOverpassConcurrent() (§ детальний коментар там і причина винесення). Тут лишаються лише
// ЛОКАЛЬНІ для генерації тайлів значення часового бюджету/конкурентності — сам виклик передає їх
// у спільну функцію.
const OVERPASS_ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_OVERPASS_REQUESTS = 5;

function fetchOverpass(query: string, attemptTimeoutMs: number = OVERPASS_ATTEMPT_TIMEOUT_MS): Promise<any> {
  return fetchOverpassConcurrent(query, {
    timeoutMs: attemptTimeoutMs,
    maxConcurrent: MAX_CONCURRENT_OVERPASS_REQUESTS,
    registryProxy,
  });
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
// ВИПРАВЛЕНО (реальний, живий інцидент — скріншот користувача з /admin/btw-tiles: New York
// (694 камери, bbox — увесь округ) застряг РІВНО на "88/288 ячеек" ЧОТИРИ запуски поспіль
// (23:07 -> 23:24, кожен ~4хв, повний часовий бюджет) — прогрес не зрушив НІ НА ОДНУ комірку.
// Це НЕ схоже на звичайну мережеву "флакі" поведінку Overpass (§ дзеркала+VPN-гонка вище) —
// та давала б хоч якісь окремі успіхи то тут, то там, не ідеально стабільне число. Найбільш
// правдоподібне пояснення: комірка 4×4км у справді щільній забудові (Мангеттен — одна з
// найщільніших міських територій у світі) містить ТАК БАГАТО `way["building"]`, що Overpass
// фізично не встигає порахувати відповідь за 55с (OVERPASS_QUERY_TIMEOUT_S) НІ НА ОДНОМУ з
// дзеркал, скільки разів не повторюй той самий запит — це не питання "не пощастило", а питання
// розміру/щільності самої комірки, яке повторна спроба того самого запиту не вирішує. (Друге
// можливе пояснення — тимчасовий бан IP на ВСІХ дзеркалах одразу після серії важких запитів —
// менш імовірне: дзеркала незалежні один від одного, синхронний бан одразу на всіх малоймовірний,
// а стабільність РІВНО того самого числа кілька разів поспіль більше вказує на "ця саме комірка
// завжди програє перегонку з часом", а не на випадкову мережеву відмову.)
//
// Зменшено з 4000 до 1500 — площа комірки падає ~7x (1500² проти 4000²), тож і очікувана
// кількість елементів/навантаження на Overpass для тієї самої щільності — приблизно у стільки ж
// разів менша, з набагато більшим запасом навіть для найщільніших районів Мангеттена. Ціна —
// у ~7x більше комірок (а отже й HTTP-запитів) для того самого міста, тобто більше окремих
// запусків "Продовжити генерацію" знадобиться для повного покриття — прийнятний компроміс:
// краще повільніше, але БЕЗ комірок, які структурно ніколи не можуть встигнути.
//
// ⚠️ ЧЕСНО: якщо навіть 1500м виявиться замало для найщільніших кварталів (малоймовірно, але
// теоретично можливо) — city застрягне так само, просто на іншому числі. Справжнє, повністю
// надійне рішення — АДАПТИВНЕ дроблення: комірка, що провалюється кілька разів поспіль,
// автоматично розбивається на 4 менші під-комірки замість нескінченних однакових повторів
// того самого завеликого запиту. Свідомо НЕ реалізовано цим кроком (вимагає збереження
// персистентного лічильника невдач по комірці й переходу від "плаского масиву комірок
// фіксованого розміру" до дерева змінного розміру — суттєво більший рефакторинг, який
// неможливо перевірити живим Overpass-викликом у цьому середовищі) — якщо зменшення розміру
// комірки саме по собі не вирішить конкретно цей випадок з New York, це наступний логічний крок.
const GRID_CELL_SIZE_M = 1500;
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
// "усе за один прохід або нічого" — кожна комірка, щойно отримана, ОДРАЗУ пишеться окремим
// blob'ом (`<cityBlobPrefix>/.cellcache/<layer>/<cellIndex>.json`, § BLOB_PATH_PREFIX вище), а
// НАСТУПНИЙ виклик generateTilesForCity() для того самого міста (наступний клік на кнопку в
// адмінці — та сама ідемпотентність, що вже в BtwService.generateTiles()/
// BtwTileGenerationRun, чи наступний запуск CLI-скрипта локально) перевіряє, які комірки вже
// готові в сховищі, і довантажує ЛИШЕ відсутні — доки список комірок не вичерпається.
// Остаточні тайли (buildings.bin/cameras.json/streets.json) пишуться ЛИШЕ коли комірки ОБОХ
// шарів (buildings+streets) повністю готові — інакше манфест (getLocalTileLayers()) продовжує
// чесно показувати "тайлів немає" замість видачі напівготових даних як завершених.
const GENERATION_TIME_BUDGET_MS = 220_000; // з запасом під 300с Vercel Hobby — лишає час на Prisma/кодування/фіналізацію

interface LayerProgress {
  cellsDone: number;
  complete: boolean;
}

function cellPathname(layerPrefix: string, i: number): string {
  return `${layerPrefix}/${i}.json`;
}

function parseCellIndexFromPathname(pathname: string): number {
  const m = /\/(\d+)\.json$/.exec(pathname);
  return m ? parseInt(m[1], 10) : -1;
}

// Перевіряє/скидає кеш комірок, якщо bbox АБО розмір сітки ПІДТВЕРДЖЕНО змінився з попереднього
// запуску — довіряти кешу комірок, порахованому для ІНШОЇ географії ЧИ ІНШОГО розбиття на
// комірки, небезпечно (дало б неправильні дані без жодної помітної ознаки браку).
//
// ВИПРАВЛЕНО (§ детальний коментар біля GRID_CELL_SIZE_M вище — реальний живий інцидент,
// New York застряг на "88/288" чотири запуски поспіль): раніше тут звірявся ЛИШЕ bbox, не
// розмір комірки. Кеш комірок (`.cellcache/<layer>/<i>.json`) індексується ПОЗИЦІЄЮ `i` в
// масиві `cells[]`, який `splitBboxIntoGrid()` будує з bbox І cellSizeM РАЗОМ — якщо змінити
// лише cellSizeM (як щойно зроблено, 4000 -> 1500), bbox лишається ТИМ САМИМ, стара перевірка
// вважала б кеш і далі валідним, а індекс `i` тепер вказував би на ЗОВСІМ ІНШУ (меншу) ділянку
// міста, ніж коли комірку `i` рахували під старою, грубішою сіткою — тихе змішування
// географічно НЕПРАВИЛЬНИХ даних під виглядом валідного прогресу, без жодної помітної ознаки
// браку. Тепер звіряється `{bbox, cellSizeM}` РАЗОМ — зміна EITHER скидає кеш повністю.
//
// ВИПРАВЛЕНО (живий інцидент цієї сесії — CLI-запуск на New York впав з
// `BlobStoreSuspendedError: This store has been suspended` РІВНО на переході між "проходом 1" і
// "проходом 2" ОДНОГО Й ТОГО САМОГО процесу, з тим самим `cameras`/bbox, що НЕ мав жодної
// причини відрізнятись від щойно записаного самим же проходом 1): стара версія трактувала БУДЬ-
// ЯКУ невдачу читання попереднього `bbox.json` (навіть тимчасовий мережевий збій запиту axios.
// get(blob.url), не обов'язково реальну розбіжність bbox) як "кеш невалідний" і одразу викликала
// `deleteBlobsByPrefix()` — стираючи СОТНІ вже отриманих (дорогих, по одному Overpass-запиту на
// комірку) blob'ів кешу комірок ПЕРЕД тим, як узагалі спробувати записати новий `bbox.json`.
// Найправдоподібніше пояснення того самого інциденту: саме такий флакі-момент читання (мережа
// весь цей сеанс поводилась нестабільно — 406/504/429/ECONNREFUSED зі скріншотів раніше) і
// спричинив зайве стирання, а сама лавина delete-запитів (сотні blob'ів кожного разу, коли таке
// траплялось за багато перезапусків цієї сесії) — правдоподібний внесок у вичерпання квоти
// операцій Vercel Blob, що й призвело до самої суспензії стора (§ чесно, це не підтверджений
// факт з боку Vercel — самé рішення про суспензію ухвалює їхня платформа, не видно причини
// напряму з цього середовища розробки, лише правдоподібна гіпотеза за спостережуваною
// послідовністю подій). Тепер: скидання кешу відбувається ЛИШЕ при ПІДТВЕРДЖЕНІЙ розбіжності
// вмісту (успішно прочитали старий `bbox.json`, і він РЕАЛЬНО не збігається з новим) — якщо
// читання самого файлу невдале (мережа/будь-яка інша помилка), функція тепер просто ЗАЛИШАЄ
// кеш як є й повертається, НІЧОГО не видаляючи й не перезаписуючи — наступний виклик спробує
// знову. Єдиний тепер прийнятний компроміс: якщо bbox ДІЙСНО змінився РІВНО в момент, коли
// читання попереднього значення до того ж випадково провалилось, старий (уже неактуальний) кеш
// комірок проживе ще один зайвий виклик, перш ніж розбіжність нарешті підтвердиться й кеш
// скинеться — набагато безпечніший компроміс, ніж стирати вже готові дані через звичайний
// мережевий "гикання".
async function ensureCellCacheValidForBbox(cellCachePrefix: string, bbox: Bbox, cellSizeM: number): Promise<void> {
  const bboxPathname = `${cellCachePrefix}/bbox.json`;
  const validityPayload = { bbox, cellSizeM };
  const validityJson = JSON.stringify(validityPayload);

  const existing = await listBlobsByPrefix(bboxPathname);
  if (existing.length > 0) {
    let cachedValidityJson: string | null = null;
    let readFailed = false;
    try {
      const data = await fetchBlobJson(existing[0].url);
      // axios сам розпарсить application/json у JS-значення — повторно серіалізуємо, щоб
      // порівняння не залежало від того, повернувся рядок чи вже розпарсений об'єкт.
      //
      // ЗВОРОТНА СУМІСНІСТЬ: старий формат файлу (до попереднього виправлення) містив ГОЛИЙ
      // bbox, без cellSizeM — такий запис ніколи побайтово не збігається з новим
      // `{bbox, cellSizeM}`, тому трактується як ПІДТВЕРДЖЕНА розбіжність (успішно прочитали,
      // просто інший формат/вміст) — кеш безпечно скидається один раз при першому запуску після
      // цього деплою (саме той ефект, що й потрібен — стара сітка мала ІНШИЙ розмір комірки, її
      // кеш і так більше не мав значення). Це НЕ той самий випадок, що read-failure нижче.
      cachedValidityJson = JSON.stringify(data);
    } catch {
      readFailed = true;
    }
    if (cachedValidityJson === validityJson) return; // bbox і розмір сітки не змінились — кеш валідний
    if (readFailed) {
      // Не змогли ПІДТВЕРДИТИ розбіжність (мережа/будь-яка помилка читання) — навмисно НЕ
      // скидаємо кеш "про всяк випадок": стерти вже отримані дані дешевше НЕ ризикувати, ніж
      // втратити їх через звичайний мережевий збій (§ детальний коментар вище).
      console.warn(
        `[tile-generation] не вдалось прочитати попередній ${bboxPathname} (мережа/тимчасова помилка) — пропускаємо перевірку валідності кешу цим разом, комірки НЕ скидаються (спробуємо знову наступного виклику).`,
      );
      return;
    }
  }

  // Підтверджена розбіжність bbox/розміру сітки (успішно прочитали старе значення, воно
  // РЕАЛЬНО інше) АБО кеш ще порожній — краще безпечно почати "з нуля", ніж ризикнути змішати
  // комірки різної географії/розбиття без жодної помітної ознаки браку.
  await deleteBlobsByPrefix(`${cellCachePrefix}/`);
  await putBlob(bboxPathname, validityJson, 'application/json');
}

export interface CellCacheBboxSnapshot {
  bbox: Bbox;
  cellSizeM: number;
}

// За прямим запитом користувача — "скрипт каждый раз разбивает новую сетку по новой и стартует
// с нуля - добавь флаг continue" (§ детальний коментар біля GenerateTilesOptions.bboxOverride
// вище). Читає bbox.json, який `ensureCellCacheValidForBbox()` записав ПІД ЧАС попереднього
// запуску того самого міста — не рахуючи нічого заново, просто повертає, що там реально
// збережено. CLI-скрипт (--continue) передає результат назад у `bboxOverride`, щоб продовжити
// РІВНО з тієї самої сітки, а не з нової, перерахованої зі свіжого (можливо, вже зміненого)
// списку камер. Повертає null, якщо кешу для цього міста ще немає (перший запуск) або файл у
// старому форматі без cellSizeM (§ зворотна сумісність в ensureCellCacheValidForBbox) — в обох
// випадках виклику CLI просто нема з чим продовжувати, --continue поводиться як звичайний запуск.
export async function getCellCacheBboxSnapshot(citySlug: string): Promise<CellCacheBboxSnapshot | null> {
  const cityBlobPrefix = getCityBlobPrefix(citySlug);
  const bboxPathname = `${cityBlobPrefix}/.cellcache/bbox.json`;
  const existing = await listBlobsByPrefix(bboxPathname);
  if (existing.length === 0) return null;
  try {
    const data = await fetchBlobJson(existing[0].url);
    if (data && typeof data === 'object' && data.bbox && typeof data.cellSizeM === 'number') {
      return { bbox: data.bbox, cellSizeM: data.cellSizeM };
    }
    return null;
  } catch {
    return null;
  }
}

// Одна комірка, що впала (мережа/усі 5 спроб провалились) — НЕ обриває решту: просто лишається
// pending і буде повторно спробувана наступним викликом, разом з рештою недороблених комірок.
// Набагато стійкіше за попередню версію (де будь-яка провалена комірка валила ВЕСЬ прогін) —
// саме цього бракувало, коли Overpass реально ненадійний (живі 406/504/timeout зі скріншотів
// користувача цієї сесії).
//
// Свідомо ДВОФАЗНО (тут — лише прогрес, без вмісту комірок): при частковому прогресі (велике
// місто, ще не всі комірки готові) НЕМАЄ сенсу щоразу перечитувати вміст УЖЕ готових комірок —
// він однаково не використовується, доки НЕ готові ОБИДВА шари (§ generateTilesForCity нижче).
// Рахунок готових комірок (`cellsDone`) бере лише КІЛЬКІСТЬ blob'ів з list() — без жодного
// додаткового читання вмісту.
async function processLayerGridResumable(
  layer: 'buildings' | 'streets',
  cells: Bbox[],
  cellCachePrefix: string,
  buildQuery: (cell: Bbox) => string,
  filterElement: (el: any) => boolean,
  deadline: number,
  overpassAttemptTimeoutMs: number,
): Promise<LayerProgress> {
  const layerPrefix = `${cellCachePrefix}/${layer}`;

  const existing = await listBlobsByPrefix(`${layerPrefix}/`);
  const doneIndices = new Set(existing.map((b) => parseCellIndexFromPathname(b.pathname)).filter((i) => i >= 0));

  const pending = cells.map((_, i) => i).filter((i) => !doneIndices.has(i));

  if (pending.length > 0) {
    await mapWithConcurrency(pending, GRID_QUERY_CONCURRENCY, async (cellIndex) => {
      if (Date.now() >= deadline) return; // бюджет вичерпано — лишаємо комірку pending для наступного виклику
      try {
        const data = await fetchOverpass(buildQuery(cells[cellIndex]), overpassAttemptTimeoutMs);
        const elements = ((data.elements ?? []) as any[]).filter(filterElement);
        await putBlob(cellPathname(layerPrefix, cellIndex), JSON.stringify(elements), 'application/json');
        doneIndices.add(cellIndex);
        if (cells.length > 1) {
          console.log(`[tile-generation] ${layer}: комірка ${cellIndex + 1}/${cells.length} готова (${elements.length} елементів)`);
        }
      } catch (err) {
        console.warn(`[tile-generation] ${layer}: комірка ${cellIndex + 1}/${cells.length} провалилась — ${(err as Error).message} (спробуємо в наступному запуску)`);
      }
    });
  }

  return { cellsDone: doneIndices.size, complete: doneIndices.size === cells.length };
}

// Фаза 2 — викликається ЛИШЕ коли ОБИДВА шари вже complete (§ generateTilesForCity нижче):
// зчитує вміст УСІХ комірок шару й зливає в один список елементів з дедуплікацією по `id`
// (одна OSM way може мати вузли в кількох сусідніх комірках і тому потрапити в результати
// більш ніж однієї — Overpass повертає way, якщо ХОЧА Б один її вузол потрапляє в bbox).
async function collectLayerGridElements(layer: 'buildings' | 'streets', cells: Bbox[], cellCachePrefix: string): Promise<any[]> {
  const layerPrefix = `${cellCachePrefix}/${layer}`;
  const blobs = await listBlobsByPrefix(`${layerPrefix}/`);
  const urlByIndex = new Map(blobs.map((b) => [parseCellIndexFromPathname(b.pathname), b.url]));

  const allElements: any[] = [];
  await mapWithConcurrency(
    Array.from({ length: cells.length }, (_, i) => i),
    GRID_QUERY_CONCURRENCY,
    async (i) => {
      const url = urlByIndex.get(i);
      if (!url) return; // не мало б статись, якщо complete===true — про всяк випадок не валимось
      try {
        const elements = await fetchBlobJson(url);
        if (Array.isArray(elements)) allElements.push(...elements);
      } catch (err) {
        console.warn(`[tile-generation] ${layer}: не вдалось прочитати кеш комірки ${i} — ${(err as Error).message}`);
      }
    },
  );

  return dedupeElementsById(allElements);
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
// за свій часовий бюджет. Виклик просто ПОВТОРЮЄТЬСЯ (той самий citySlug/cameras) — кеш
// комірок у Vercel Blob сам підхоплює прогрес з попереднього разу.
export async function generateTilesForCity(
  citySlug: string,
  cameras: CameraForTiling[],
  options?: GenerateTilesOptions,
): Promise<GenerateTilesResult> {
  if (cameras.length === 0) {
    throw new Error(`no VERIFIED/OUTDOOR/ONLINE cameras found for city slug="${citySlug}" — nothing to tile`);
  }

  // За замовчуванням (жоден options не передано — саме так і далі викликає адмінська кнопка,
  // BtwService.generateTiles()) — поведінка АБСОЛЮТНО не змінюється, ті самі константи, що й
  // раніше. Лише CLI-скрипт (apps/api/scripts/generate-btw-tiles.ts) тепер явно передає щедріші
  // значення (§ GenerateTilesOptions вище) — обмеження Vercel Hobby 300с на нього не діє.
  const timeBudgetMs = options?.timeBudgetMs ?? GENERATION_TIME_BUDGET_MS;
  const overpassAttemptTimeoutMs = options?.overpassAttemptTimeoutMs ?? OVERPASS_ATTEMPT_TIMEOUT_MS;
  const overpassQueryTimeoutS = options?.overpassQueryTimeoutS ?? OVERPASS_QUERY_TIMEOUT_S;

  // bboxOverride (§ GenerateTilesOptions вище / CLI --continue) — якщо передано, використовуємо
  // ТОЙ САМИЙ bbox, що й попередній запуск, замість перерахунку з живого списку камер, щоб
  // ensureCellCacheValidForBbox() нижче не побачив розбіжності й не скинув кеш комірок.
  const bbox = options?.bboxOverride ?? computeBboxFromCameras(cameras);
  const cityBlobPrefix = getCityBlobPrefix(citySlug);
  const cellCachePrefix = `${cityBlobPrefix}/.cellcache`;
  await ensureCellCacheValidForBbox(cellCachePrefix, bbox, GRID_CELL_SIZE_M);

  const cells = splitBboxIntoGrid(bbox);
  const deadline = Date.now() + timeBudgetMs;

  // Послідовно (не Promise.all, як у попередній версії) — свідомо, для простоти й чіткості
  // прогресу: buildings спершу забирають свою частку бюджету, streets — те, що лишилось.
  // Кожен шар усередині себе однаково паралелить комірки (GRID_QUERY_CONCURRENCY), тож
  // конкурентність не втрачається, лише координація між двома шарами спрощена.
  const buildingsProgress = await processLayerGridResumable(
    'buildings',
    cells,
    cellCachePrefix,
    (cell) => `
      [out:json][timeout:${overpassQueryTimeoutS}];
      way["building"](${cell.south},${cell.west},${cell.north},${cell.east});
      out geom;
    `,
    (el) => el.geometry?.length >= 3,
    deadline,
    overpassAttemptTimeoutMs,
  );
  const streetsProgress = await processLayerGridResumable(
    'streets',
    cells,
    cellCachePrefix,
    (cell) => `
      [out:json][timeout:${overpassQueryTimeoutS}];
      way["highway"](${cell.south},${cell.west},${cell.north},${cell.east});
      out geom;
    `,
    (el) => el.geometry?.length >= 2,
    deadline,
    overpassAttemptTimeoutMs,
  );

  const cellsTotal = cells.length * 2; // buildings + streets — той самий grid, дві незалежні прогрес-доріжки
  const cellsDone = buildingsProgress.cellsDone + streetsProgress.cellsDone;
  const complete = buildingsProgress.complete && streetsProgress.complete;

  if (!complete) {
    // НЕ пишемо buildings.bin/cameras.json/streets.json — манфест (getLocalTileLayers()) має
    // й далі чесно показувати "тайлів немає", доки дані справді не повні. Кеш комірок у Blob
    // уже зберігає все, що встигли забрати цим викликом — наступний виклик продовжить звідси.
    // buildingCount/streetCount тут навмисно 0 — фаза 2 (collectLayerGridElements) ще НЕ
    // викликалась (§ коментар біля неї — немає сенсу читати вміст комірок до завершення ОБОХ
    // шарів), тож справжня кількість елементів поки невідома; адмінка показує лише
    // cellsDone/cellsTotal для 'partial', ці два поля тут ні на що не впливають.
    return { citySlug, cityBlobPrefix, bbox, cameraCount: cameras.length, buildingCount: 0, buildingBytes: 0, streetCount: 0, cellsTotal, cellsDone, complete: false };
  }

  const buildingElements = await collectLayerGridElements('buildings', cells, cellCachePrefix);
  const streetElements = await collectLayerGridElements('streets', cells, cellCachePrefix);

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
        name: c.name,
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

  // putBlobOverwrite (не звичайний put) — місто може генеруватись ПОВТОРНО пізніше (склад камер
  // змінився), а ця версія SDK (§ коментар біля BLOB_PATH_PREFIX вище) не має allowOverwrite.
  await putBlobOverwrite(`${cityBlobPrefix}/buildings.bin`, Buffer.from(buildingsBuf), 'application/octet-stream');
  await putBlobOverwrite(`${cityBlobPrefix}/cameras.json`, JSON.stringify(camerasTile), 'application/json');
  await putBlobOverwrite(`${cityBlobPrefix}/streets.json`, JSON.stringify(streetsTile), 'application/json');

  // Успішно завершено — кеш комірок більше не потрібен (не накопичуємо зайве в сховищі).
  await deleteBlobsByPrefix(`${cellCachePrefix}/`);

  return {
    citySlug,
    cityBlobPrefix,
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

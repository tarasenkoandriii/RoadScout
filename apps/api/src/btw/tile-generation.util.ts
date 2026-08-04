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
// запити тепер ідуть ПАРАЛЕЛЬНО (Promise.all), (2) внутрішній Overpass-таймаут зменшено до 90с
// — разом дає запас під 300с навіть з накладними витратами Prisma/кодування/диску. Для дуже
// великих/щільних міст цього однаково може не вистачити — у такому разі рекомендація (в UI
// адмінки) — запустити CLI-скрипт локально, де такого обмеження немає.
const OVERPASS_QUERY_TIMEOUT_S = 90;

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
// і легітимних клієнтів так само. Офіційна рекомендація спільноти в такому разі — "не
// ретраїти той самий ендпоінт (запит не змінюється), перемкнутись на дзеркало". Список
// дзеркал — ті самі публічні інстанси, що вже досліджені й названі користувачу в цій сесії
// раніше ("как настроить Overpass"), тепер нарешті реалізовані як fallback-ланцюжок, а не
// просто перелічені текстом. OVERPASS_ENDPOINTS дозволяє адміну перевизначити список/порядок
// через env, не чіпаючи код (той самий принцип конфігурованості, що вже в
// OVERPASS_QUERY_TIMEOUT_S/getContentCheckTimeBudgetMs() тощо по проєкту).
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

// 406/429/502/503/504 — сигнали "САМЕ ЦЕЙ ендпоінт зараз відмовляє" (бан-фільтр, перевантаження,
// проксі впав) — варто спробувати дзеркало. Мережевий виняток (fetch кинув, DNS/timeout) —
// той самий випадок, теж переходимо до наступного дзеркала. Будь-який ІНШИЙ статус (напр. 400
// — синтаксична помилка в самому Overpass QL-запиті) НЕ ретраїмо на дзеркалах: та сама
// помилка повториться всюди (запит однаковий), а спроби лише даремно з'їдять секунди з
// Vercel Hobby-бюджету (doc/AUDIT-vercel-hobby.md).
const OVERPASS_RETRYABLE_STATUSES = new Set([406, 429, 502, 503, 504]);

// Клієнтський таймаут — трохи більше за [timeout:N] у самому Overpass QL-запиті
// (OVERPASS_QUERY_TIMEOUT_S вище), бо той таймаут — це ліміт ВИКОНАННЯ запиту НА СЕРВЕРІ
// Overpass, а не ліміт мережевого round-trip до нього; без власного AbortSignal зависший (не
// відповідає, але й не рве з'єднання) ендпоінт міг би заблокувати спробу назавжди.
const OVERPASS_SINGLE_ATTEMPT_TIMEOUT_MS = OVERPASS_QUERY_TIMEOUT_S * 1000 + 15000;

// Спільний бюджет часу на ВЕСЬ ланцюжок спроб (усі дзеркала разом), не на кожну окремо — той
// самий принцип "startedAt + часовий бюджет", що вже MonitoringService.checkAll()/
// checkYoutubeAndVisionAvailability() застосовують до перевірки камер (і саме він надихнув цей
// запит користувача: "мониторинг времени - как уже делали с камерами"). БЕЗ цієї спільної межі
// цикл по 4 дзеркалах міг би витратити до 4×105с ≈ 420с лише на ОДИН з двох (buildings/streets)
// запитів, самостійно перевищивши весь ліміт Vercel Hobby (300с) — навіть попри те, що
// buildings/streets виконуються паралельно (ВИПРАВЛЕНО-коментар біля OVERPASS_QUERY_TIMEOUT_S
// вище). Коли бюджет вичерпано — зупиняємось і повертаємо останню відому помилку; сам запуск
// уже ідемпотентний на рівні BtwService.generateTiles()/BtwTileGenerationRun, тож "спробувати
// ще раз" безпечно, а не тупик.
const OVERPASS_TOTAL_BUDGET_MS = 120_000;

async function fetchOverpass(query: string): Promise<any> {
  const deadline = Date.now() + OVERPASS_TOTAL_BUDGET_MS;
  let lastError: Error = new Error('Overpass: список эндпоинтов пуст (OVERPASS_ENDPOINTS)');
  for (const endpoint of getOverpassEndpoints()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new Error(`${lastError.message} (общий бюджет ${OVERPASS_TOTAL_BUDGET_MS / 1000}с на все дзеркала вичерпано)`);
      break;
    }

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': OVERPASS_USER_AGENT },
        signal: AbortSignal.timeout(Math.min(remainingMs, OVERPASS_SINGLE_ATTEMPT_TIMEOUT_MS)),
      });
    } catch (err) {
      // Мережевий збій самого запиту (DNS/з'єднання скинуто/наш AbortSignal.timeout спрацював)
      // — той самий випадок, що ретрайний статус нижче: пробуємо наступне дзеркало (якщо
      // спільний бюджет ще дозволяє).
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (res.ok) return res.json();

    lastError = new Error(`Overpass HTTP ${res.status} (${endpoint})`);
    if (!OVERPASS_RETRYABLE_STATUSES.has(res.status)) {
      // Не-ретрайний статус (напр. 400 — синтаксична помилка запиту) — та сама помилка
      // повториться на будь-якому дзеркалі, тож зупиняємось одразу замість марних спроб.
      throw lastError;
    }
    // ретрайний статус (406/429/5xx) — пробуємо наступне дзеркало.
  }
  throw lastError;
}

// Дослівно та сама конструкція запиту, що occlusion.service.ts::fetchNearbyBuildings() вже
// використовує в проді (`way["building"]`) — тут bbox-варіант замість `around:radius,lat,lng`,
// бо потрібне ЦІЛЕ місто одразу, а не околиця однієї точки.
export async function fetchBuildings(bbox: Bbox): Promise<any[]> {
  const query = `
    [out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
    way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    out geom;
  `;
  const data = await fetchOverpass(query);
  return (data.elements ?? []).filter((el: any) => el.geometry?.length >= 3);
}

// Дослівно та сама конструкція запиту, що azimuth-heuristic.service.ts вже використовує в
// проді (`way["highway"]`) — bbox-варіант з тієї самої причини, що й для будівель вище.
export async function fetchStreets(bbox: Bbox): Promise<any[]> {
  const query = `
    [out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];
    way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    out geom;
  `;
  const data = await fetchOverpass(query);
  return (data.elements ?? []).filter((el: any) => el.geometry?.length >= 2);
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
export async function generateTilesForCity(citySlug: string, cameras: CameraForTiling[], tilesDir: string): Promise<GenerateTilesResult> {
  if (cameras.length === 0) {
    throw new Error(`no VERIFIED/OUTDOOR/ONLINE cameras found for city slug="${citySlug}" — nothing to tile`);
  }

  const bbox = computeBboxFromCameras(cameras);

  // Паралельно — див. ВИПРАВЛЕНО-коментар біля OVERPASS_QUERY_TIMEOUT_S вище.
  const [buildingElements, streetElements] = await Promise.all([fetchBuildings(bbox), fetchStreets(bbox)]);

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

  const cityDir = path.join(tilesDir, citySlug);
  fs.mkdirSync(cityDir, { recursive: true });

  fs.writeFileSync(path.join(cityDir, 'buildings.bin'), Buffer.from(buildingsBuf));
  fs.writeFileSync(path.join(cityDir, 'cameras.json'), JSON.stringify(camerasTile));
  fs.writeFileSync(path.join(cityDir, 'streets.json'), JSON.stringify(streetsTile));

  return {
    citySlug,
    cityDir,
    bbox,
    cameraCount: cameras.length,
    buildingCount: buildings.length,
    buildingBytes: buildingsBuf.byteLength,
    streetCount: streets.length,
  };
}

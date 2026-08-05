// apps/btw/lib/tile-format.ts
//
// §4.7.1 ТЗ — формат тайлів, що сервер віддає клієнту для локального (на пристрої) сканування
// (частина завдання "(b) full spec as originally written" — Web Worker + PMTiles + локальна
// геометрія замість серверного /btw/scan на кожен кадр).
//
// ЦЕЙ ФАЙЛ — КАНОНІЧНЕ ДЖЕРЕЛО байт-формату будівель. Дослівна копія існує в
// `apps/api/src/btw/tile-format.ts` (сервер: генерація тайлів) — тому що в репозиторії немає
// кореневого workspace package.json (перевірено: `ls -la` на корені не знаходить root
// package.json/pnpm-workspace.yaml/turbo.json), і проєкт вже свідомо дублює ізоморфний код між
// apps/btw та apps/api замість npm-пакета (див. apps/btw/lib/geometry.ts як прецедент). Обидві
// копії МАЮТЬ лишатися побайтово ідентичними — інакше encode(сервер)/decode(клієнт) розійдуться.
//
// ЧЕСНІСТЬ ЩОДО BUILDINGS vs CAMERAS/STREETS (див. doc/AUDIT-btw.md, той самий стиль):
// ТЗ §4.7.1 наводить ТОЧНИЙ бінарний байт-формат ТІЛЬКИ для тайлу `buildings`:
//   header: u16 version | f64 tileOriginLat | f64 tileOriginLon | u16 buildingCount
//   per building: u8 heightM/2 | u8 vertexCount | vertices: i16 x, i16 y   // ENU-метри від origin
// Для `cameras` і `streets` ТЗ дає лише перелік полів і орієнтовний розмір у КБ (2–8 КБ / 3–10
// КБ), БЕЗ точного байт-макета. Тому вони тут реалізовані як звичайний JSON (документована
// відмінність, не мікроформат) — обидва на порядок менші за buildings і завантажуються один раз
// разом з manifest, тож накладні витрати JSON тут не є суттєвими для бюджету 0.4–1.1 МБ/район.

export const BUILDINGS_TILE_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Buildings — бінарний формат, дослівно за §4.7.1
// ---------------------------------------------------------------------------------------------

export interface DecodedBuildingVertex {
  x: number; // ENU-метри від tileOrigin (схід+)
  y: number; // ENU-метри від tileOrigin (північ+)
}

export interface DecodedBuilding {
  heightM: number;
  vertices: DecodedBuildingVertex[];
}

export interface DecodedBuildingsTile {
  version: number;
  originLat: number;
  originLon: number;
  buildings: DecodedBuilding[];
}

// Кодування (сервер, скрипт генерації тайлів — apps/api/scripts/generate-btw-tiles.ts).
// heightM квантується як u8(heightM/2) — §4.7.1 дослівно "u8 heightM/2" — тобто точність 2м,
// діапазон 0–510м (достатньо для будь-якої цивільної будівлі; вищі об'єкти обрізаються до 510м,
// що прийнятно для окклюзії — LOS-тест лише порівнює висоту з лінією погляду).
export function encodeBuildingsTile(
  originLat: number,
  originLon: number,
  buildings: DecodedBuilding[],
): ArrayBuffer {
  let size = 2 + 8 + 8 + 2; // header: u16 + f64 + f64 + u16
  for (const b of buildings) {
    const vertexCount = Math.min(255, b.vertices.length);
    size += 1 + 1 + vertexCount * 4; // u8 + u8 + vertexCount*(i16+i16)
  }

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let off = 0;

  view.setUint16(off, BUILDINGS_TILE_VERSION);
  off += 2;
  view.setFloat64(off, originLat);
  off += 8;
  view.setFloat64(off, originLon);
  off += 8;
  view.setUint16(off, buildings.length);
  off += 2;

  for (const b of buildings) {
    const h2 = clampU8(Math.round(b.heightM / 2));
    view.setUint8(off, h2);
    off += 1;

    const vertexCount = Math.min(255, b.vertices.length);
    view.setUint8(off, vertexCount);
    off += 1;

    for (let i = 0; i < vertexCount; i++) {
      const v = b.vertices[i];
      view.setInt16(off, clampI16(Math.round(v.x)));
      off += 2;
      view.setInt16(off, clampI16(Math.round(v.y)));
      off += 2;
    }
  }

  return buf;
}

// Декодування (клієнт, Web Worker — apps/btw/workers/btw-scan.worker.ts).
export function decodeBuildingsTile(buf: ArrayBuffer): DecodedBuildingsTile {
  const view = new DataView(buf);
  let off = 0;

  const version = view.getUint16(off);
  off += 2;
  const originLat = view.getFloat64(off);
  off += 8;
  const originLon = view.getFloat64(off);
  off += 8;
  const buildingCount = view.getUint16(off);
  off += 2;

  const buildings: DecodedBuilding[] = [];
  for (let i = 0; i < buildingCount; i++) {
    if (off + 2 > buf.byteLength) break; // захист від обірваного/пошкодженого файлу
    const heightM = view.getUint8(off) * 2;
    off += 1;
    const vertexCount = view.getUint8(off);
    off += 1;

    const vertices: DecodedBuildingVertex[] = [];
    for (let j = 0; j < vertexCount; j++) {
      if (off + 4 > buf.byteLength) break;
      const x = view.getInt16(off);
      off += 2;
      const y = view.getInt16(off);
      off += 2;
      vertices.push({ x, y });
    }
    buildings.push({ heightM, vertices });
  }

  return { version, originLat, originLon, buildings };
}

function clampU8(v: number): number {
  return Math.max(0, Math.min(255, v));
}
function clampI16(v: number): number {
  return Math.max(-32768, Math.min(32767, v));
}

// ---------------------------------------------------------------------------------------------
// Cameras / Streets — JSON (документована відмінність від бінарного мікроформату, див. вище)
// ---------------------------------------------------------------------------------------------

// Поля — дослівно за переліком у §4.7.1: "id, позиция, высота, азимут, fov, range, тип потока,
// качество". Поле `name` — навмисне розширення ПОНАД спек §4.7.1: додано за прямим запитом
// користувача (живий випадок "задвоилась камера" — дві картки кандидата в мінідодатку з
// однаковою дистанцією й однаковим текстом, неможливо було візуально відрізнити справжній
// дубль запису камери в БД від двох різних камер поруч, що випадково округлились до тієї самої
// дистанції). Ім'я камери дозволяє відрізнити їх на картці кандидата.
export interface CamerasTileEntry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  heightMeters: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  streamType: string;
  confidence: string;
}

export interface CamerasTile {
  version: number;
  cameras: CamerasTileEntry[];
}

// §У3 (прив'язка до вуличної мережі) — азимути осей вулиць для snap-евристики
// (snapHeadingToStreetGrid у btw-geometry-engine.ts), той самий формат, що вже повертає
// сервер (azimuth-heuristic.service.ts::extractStreetAzimuthCandidates), просто впакований у
// тайл замість запиту-на-запит. axisAzimuths містить ОБИДВА напрямки осі (bearing і
// bearing+180°, дедуплікація в межах 10°) — дослівно та сама логіка, що вже в
// extractStreetAzimuthCandidates() і продубльована в apps/api/scripts/generate-btw-tiles.ts.
export interface StreetsTileEntry {
  lat: number;
  lng: number;
  axisAzimuths: number[]; // 0-360°, обидва напрямки осі, вже дедупльовані
}

export interface StreetsTile {
  version: number;
  streets: StreetsTileEntry[];
}

// ---------------------------------------------------------------------------------------------
// Допоміжне: конвертація декодованого buildings-тайлу в EdgeIndex-сумісний список ребер
// (кожен будинок — замкнутий полігон; ребра — послідовні пари вершин, включно з останньою→першою).
// Використовується клієнтським Worker'ом одразу після decodeBuildingsTile(), перед побудовою
// EdgeIndex (apps/btw/lib/edge-index.ts).
// ---------------------------------------------------------------------------------------------

export interface FlatBuildingEdge {
  buildingId: number;
  heightM: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export function buildingsToEdges(tile: DecodedBuildingsTile): FlatBuildingEdge[] {
  const edges: FlatBuildingEdge[] = [];
  tile.buildings.forEach((building, buildingId) => {
    const n = building.vertices.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = building.vertices[i];
      const b = building.vertices[(i + 1) % n]; // замикаємо полігон (останнє ребро: остання→перша)
      edges.push({ buildingId, heightM: building.heightM, a, b });
    }
  });
  return edges;
}

// Beyond the Wall (BTW) — ізоморфне геометричне ядро, §4.2–§4.6, §8.1 ТЗ (doc/BTW-tz.md).
//
// За прямим запитом користувача — "lets realize (b) the full spec as originally written":
// це клієнтська частина `@btw/geometry`, яку §8.1 ТЗ вимагає як "один і той самий код у
// воркері й у серверному фолбеку /btw/scan". У проєкті НЕМАЄ workspace-тулінгу для реального
// спільного npm-пакета (жоден з apps/* не має root package.json/workspaces — перевірено; той
// самий факт, чому apps/btw/lib/geometry.ts вже є окремою копією apps/api/src/common/
// geometry.util.ts, а не імпортом) — тому й тут той самий, уже усталений у проєкті підхід:
// ОКРЕМА копія, а не нова інфраструктура спільних пакетів (яка сама по собі — великий і
// ризикований рефакторинг деплою всіх apps/*, поза розумним обсягом цього кроку).
//
// Пряма похідна від apps/api/src/common/geometry.util.ts + apps/api/src/btw/
// btw-geometry.util.ts — усі функції звідти вже чисті (без DI/Prisma), тому більшість цього
// файлу є ДОСЛІВНИМ портом уже перевіреної (і в проді, увесь цей сеанс) математики. НОВЕ
// відносно серверної версії — саме occlusion-функції (findOccluder/isVisible/
// raySegmentIntersect) і локальна ENU-проекція: сервер сьогодні НЕ має локальної геометрії
// будівель узагалі (occlusion.service.ts робить живий Overpass-запит на КОЖНУ з 9 точок
// сэмплювання), тому ці функції написані наново, точно за псевдокодом §4.2/§4.5 ТЗ.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CameraSector {
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angularDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

  return { lat: toDeg(phi2), lng: toDeg(lambda2) };
}

// -----------------------------------------------------------------------------------------
// §8.1 ТЗ — "Вся математика — в локальних ENU-метрах Float32Array, геодезія тільки на межах".
// Проста рівнокутна (equirectangular) проекція відносно tile-origin — коректна на масштабі
// одного міста (кілька км), саме такий підхід і описаний у ТЗ для цієї мети (не Mercator,
// не UTM — навмисно найпростіша локальна апроксимація).
// -----------------------------------------------------------------------------------------
export interface Vec2 {
  x: number;
  y: number;
}

const METERS_PER_DEG_LAT = 111320;

export function toLocalXY(origin: LatLng, point: LatLng): Vec2 {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRad(origin.lat));
  return {
    x: (point.lng - origin.lng) * metersPerDegLng,
    y: (point.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

export function fromLocalXY(origin: LatLng, xy: Vec2): LatLng {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRad(origin.lat));
  return {
    lat: origin.lat + xy.y / METERS_PER_DEG_LAT,
    lng: origin.lng + xy.x / metersPerDegLng,
  };
}

// Core sector-test from the ТЗ: is `point` within the camera's field of view?
export function cameraSeesPoint(cam: CameraSector, point: LatLng): { visible: boolean; distanceM: number; bearingFromCamera: number } {
  const distanceM = haversineDistance(cam, point);
  const bearingFromCamera = bearing(cam, point);
  if (distanceM > cam.rangeMeters) return { visible: false, distanceM, bearingFromCamera };
  const visible = angularDiff(bearingFromCamera, cam.azimuth) <= cam.fovAngle / 2;
  return { visible, distanceM, bearingFromCamera };
}

export interface ObserverPose {
  lat: number;
  lng: number;
  accuracyM: number;
  heading: number;
  headingSigma: number;
  eyeHeightM?: number;
}

export interface TargetZone {
  point: LatLng;
  radiusM: number;
  distanceM: number;
  occluded: boolean;
}

// §4.4 ТЗ — адаптивний кутовий допуск: чим гірший GPS і чим ближче ціль, тим ширший конус.
export function angularTolerance(accuracyM: number, targetDistanceM: number, headingSigma: number): number {
  const fromAccuracy = (Math.atan2(accuracyM, targetDistanceM) * 180) / Math.PI;
  const raw = fromAccuracy + headingSigma;
  return Math.max(10, Math.min(35, raw));
}

// -----------------------------------------------------------------------------------------
// §4.2 ТЗ — визначення окклюдера. НОВЕ відносно серверної версії (там немає локальних даних
// про будівлі взагалі — computeTargetZone на сервері завжди ставить ціль на фіксовані 250м,
// див. коментар у apps/api/src/btw/btw-geometry.util.ts). Тут — дослівно за псевдокодом ТЗ:
// один тест перетину промінь-відрізок на ребро будівлі, а не марш з кроком.
// -----------------------------------------------------------------------------------------
export interface BuildingEdge {
  buildingId: number;
  heightM: number;
  a: Vec2; // локальні ENU-метри від tile-origin
  b: Vec2;
}

// Перетин променя (з точки `o` в напрямку `dir`, обидва в локальних метрах) з відрізком [a,b].
// Повертає дистанцію вздовж променя до перетину, або null, якщо перетину немає (стандартна
// параметрична формула променя vs відрізок).
export function raySegmentIntersect(o: Vec2, dir: Vec2, a: Vec2, b: Vec2): number | null {
  const v1x = o.x - a.x;
  const v1y = o.y - a.y;
  const v2x = b.x - a.x;
  const v2y = b.y - a.y;
  const v3x = -dir.y;
  const v3y = dir.x;

  const denom = v2x * v3x + v2y * v3y;
  if (Math.abs(denom) < 1e-9) return null; // паралельні — перетину немає

  const t1 = (v2x * v1y - v2y * v1x) / denom; // дистанція вздовж променя
  const t2 = (v1x * v3x + v1y * v3y) / denom; // параметр вздовж відрізка [0,1]

  if (t1 >= 0 && t2 >= 0 && t2 <= 1) return t1;
  return null;
}

export interface EdgeIndex {
  search(bboxMinX: number, bboxMinY: number, bboxMaxX: number, bboxMaxY: number): BuildingEdge[];
}

// §4.2 ТЗ, дослівно: shooting a 400m ray, find nearest building edge whose height exceeds
// the line-of-sight height at that distance.
export function findOccluder(
  index: EdgeIndex,
  o: Vec2,
  dirDeg: number,
  eyeHeightM: number,
  pitchRad: number,
  maxD = 400,
): { d: number; h: number; buildingId: number } | null {
  const dirRad = toRad(dirDeg);
  const dir: Vec2 = { x: Math.sin(dirRad), y: Math.cos(dirRad) }; // x=схід, y=північ — той самий ENU-базис, що toLocalXY
  const pad = maxD;
  const hits = index.search(Math.min(o.x, o.x + dir.x * maxD) - pad, Math.min(o.y, o.y + dir.y * maxD) - pad, Math.max(o.x, o.x + dir.x * maxD) + pad, Math.max(o.y, o.y + dir.y * maxD) + pad);

  let best: { d: number; h: number; buildingId: number } | null = null;
  for (const e of hits) {
    const d = raySegmentIntersect(o, dir, e.a, e.b);
    if (d === null || d > maxD) continue;
    const losH = eyeHeightM + d * Math.tan(pitchRad);
    if (e.heightM > losH && (!best || d < best.d)) best = { d, h: e.heightM, buildingId: e.buildingId };
  }
  return best;
}

// §4.3 ТЗ — ціль ставиться на дистанцію вздовж променя погляду: за замовчуванням OPEN_VIEW
// (250м), або (якщо знайдено окклюдер) трохи далі за нього. ВІДМІННІСТЬ від серверної версії
// (apps/api/src/btw/btw-geometry.util.ts::computeTargetZone) — та ЗАВЖДИ використовує 250м
// (occluderDistanceM там ніколи не передається, бо сервер не має локальної геометрії); тут —
// реальний findOccluder() вище, тож клієнт коректно реалізує ПОВНУ логіку §4.3.
export function computeTargetZone(
  observer: LatLng,
  heading: number,
  opts?: { targetOverride?: LatLng; occluderDistanceM?: number },
): TargetZone {
  const DEFAULT_OPEN_VIEW_DISTANCE_M = 250;
  const MAX_DISTANCE_M = 400;

  const distanceM = opts?.occluderDistanceM != null ? Math.min(opts.occluderDistanceM + 60, MAX_DISTANCE_M) : DEFAULT_OPEN_VIEW_DISTANCE_M;

  const point = opts?.targetOverride ?? destinationPoint(observer, heading, distanceM);
  const actualDistance = opts?.targetOverride ? haversineDistance(observer, opts.targetOverride) : distanceM;
  const radiusM = Math.max(25, Math.min(120, actualDistance * Math.tan((15 * Math.PI) / 180)));

  return { point, radiusM, distanceM: actualDistance, occluded: opts?.occluderDistanceM != null };
}

export type OrientationFitLabel = 'ALIGNED' | 'SIDE' | 'OPPOSING';

export function classifyOrientationFit(cameraAzimuth: number, userHeading: number): OrientationFitLabel {
  const delta = angularDiff((cameraAzimuth + 180) % 360, userHeading);
  if (delta <= 45) return 'ALIGNED';
  if (delta <= 135) return 'SIDE';
  return 'OPPOSING';
}

export interface RankedCandidate {
  cameraId: string;
  // Дзеркало серверної копії (apps/api/src/btw/btw-geometry.util.ts) — за прямим запитом
  // користувача, живий випадок "задвоилась камера" на картках кандидата в мінідодатку.
  cameraName: string;
  distanceM: number;
  bearingToTarget: number;
  coverage: number;
  orientationFit: OrientationFitLabel;
  score: number;
  cameraAzimuth: number;
}

export function passesConeFilter(cam: CameraSector, target: TargetZone, headingUncertaintyDeg = 0): boolean {
  const distanceM = haversineDistance(cam, target.point);
  if (distanceM > cam.rangeMeters + target.radiusM) return false;
  const bearingToTarget = bearing(cam, target.point);
  const toleranceExtra = (Math.atan2(target.radiusM, Math.max(1, distanceM)) * 180) / Math.PI;
  return angularDiff(bearingToTarget, cam.azimuth) <= cam.fovAngle / 2 + toleranceExtra + headingUncertaintyDeg;
}

// §4.6 ТЗ — скоринг і ранжування. Ваги узяті прямо з ТЗ (той самий, що вже серверний
// computeScore у btw-geometry.util.ts).
export function computeScore(params: { coverage: number; orientationFit: OrientationFitLabel; ageSeconds: number; quality: number; distanceM: number; popularity: number }): number {
  const orientationScore = params.orientationFit === 'ALIGNED' ? 1 : params.orientationFit === 'SIDE' ? 0.5 : 0.1;
  const freshness = 1 - Math.min(1, params.ageSeconds / 120);
  const proximity = 1 - Math.min(1, params.distanceM / 2500);
  return 0.35 * params.coverage + 0.2 * orientationScore + 0.15 * freshness + 0.12 * params.quality + 0.1 * proximity + 0.08 * params.popularity;
}

export function computeCoverageFromSamples(visibleFlags: boolean[]): number {
  if (visibleFlags.length === 0) return 0;
  return visibleFlags.filter(Boolean).length / visibleFlags.length;
}

export function sampleTargetZonePoints(target: TargetZone): LatLng[] {
  const points: LatLng[] = [target.point];
  for (let i = 0; i < 8; i++) {
    points.push(destinationPoint(target.point, (i * 360) / 8, target.radiusM));
  }
  return points;
}

// -----------------------------------------------------------------------------------------
// §4.5 ТЗ, Ф3 — LOS камера→ціль, дослівно за псевдокодом ТЗ. НОВЕ відносно серверної версії
// (яка йде через живий OcclusionService/Overpass на КОЖНУ з 9 точок — тут той самий тест, але
// проти вже завантаженого в пам'ять edge-індексу, тому 0 мережевих викликів під час
// активного сканування, саме той виграш §4.7.6 ТЗ описує).
// -----------------------------------------------------------------------------------------
export function isVisible(index: EdgeIndex, camPos: Vec2, camHeightM: number, targetPos: Vec2, targetGroundH: number): boolean {
  const dx = targetPos.x - camPos.x;
  const dy = targetPos.y - camPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return true;
  const dir: Vec2 = { x: dx / dist, y: dy / dist };

  const pad = 5;
  const hits = index.search(Math.min(camPos.x, targetPos.x) - pad, Math.min(camPos.y, targetPos.y) - pad, Math.max(camPos.x, targetPos.x) + pad, Math.max(camPos.y, targetPos.y) + pad);

  for (const e of hits) {
    const d = raySegmentIntersect(camPos, dir, e.a, e.b);
    if (d === null || d >= dist) continue;
    // 2.5D-інтерполяція висоти лінії зору між камерою (camHeightM) і "очима" цілі
    // (targetGroundH + 1.5м, зростання людини) — дослівно з псевдокоду ТЗ.
    const losH = camHeightM + (targetGroundH + 1.5 - camHeightM) * (d / dist);
    if (e.heightM > losH) return false;
  }
  return true;
}

// У3 ТЗ (§5) — "привязка к уличной сети".
export interface SnapResult {
  heading: number;
  snapped: boolean;
  snappedTo: number | null;
}

export function snapHeadingToStreetGrid(measuredHeading: number, streetCandidates: number[], toleranceDeg = 20): SnapResult {
  let best: { candidate: number; diff: number } | null = null;
  for (const candidate of streetCandidates) {
    const raw = Math.abs(measuredHeading - candidate) % 360;
    const diff = Math.min(raw, 360 - raw);
    if (diff <= toleranceDeg && (best === null || diff < best.diff)) best = { candidate, diff };
  }
  if (best === null) return { heading: measuredHeading, snapped: false, snappedTo: null };
  return { heading: best.candidate, snapped: true, snappedTo: best.candidate };
}

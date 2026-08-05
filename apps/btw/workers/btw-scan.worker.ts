// apps/btw/workers/btw-scan.worker.ts
//
// §8.1 ТЗ — Web Worker, що виконує повний каскад Ф1→Ф2→Ф3→скоринг ЛОКАЛЬНО на пристрої, над
// уже завантаженими тайлами (buildings/cameras/streets), без жодного мережевого запиту під час
// самого сканування (§4.7.6 п.2: "скан виконується за 3-6мс локально замість 120-180мс по
// мережі"). Частина завдання "(b) full spec as originally written".
//
// Протокол postMessage — навмисно з `requestId` у кожному запиті/відповіді (той самий принцип
// анти-race, що вже застосований у apps/btw/app/page.tsx для lastScanRef/sendTelemetry цього
// сеансу) — навіть попри те, що сам скан тут синхронний (єдиний потік Worker'а, без await на
// мережу), клієнтський wrapper (btwLocalScanner.ts) все одно повинен коректно відкидати
// відповіді на застарілі запити, якщо dispose()/повторна ініціалізація сталася поки відповідь
// була "в польоті" (наприклад, юзер вийшов зі сканування раніше, ніж Worker встиг відповісти).
//
// ЧЕСНІ ВІДМІННОСТІ від серверного /btw/scan (btw.service.ts::scan(), яка лишається
// незмінною — §4.7.5 ТЗ прямо вимагає зберегти серверний фолбек):
// 1. Вулиці для У3-снепу (§5) беруться з ЛОКАЛЬНОГО tiles.streets, а не з живого
//    AzimuthHeuristicService/Overpass — той самий принцип snapHeadingToStreetGrid(), просто
//    дані вже на пристрої замість запиту-на-кожен-скан.
// 2. Ф3 (LOS) рахується через isVisible()/локальний EdgeIndex (справжня геометрія проти
//    завантажених ребер будівель) — а НЕ через живий OcclusionService/Overpass, як на сервері.
//    Це саме те, що §4.2/§4.5 ТЗ описують як цільову архітектуру M2 — тут реалізовано
//    буквально, на відміну від сервера, який ніколи не мав локальної геометрії будівель.
// 3. "Свіжість" камери (ageSeconds у скорингу) — сервер бере lastCheckedAt із БД; тайл
//    (§4.7.1) СВІДОМО не містить lastCheckedAt (тільки ONLINE/OFFLINE-статус приходить окремо
//    через /btw/status, §4.7.3, TTL 30с) — тому тут ageSeconds оптимістично приймається 0
//    (сама камера вже пройшла live ONLINE-статус фільтр на сервері при генерації тайлу/manifest,
//    а актуальність offline-списку клієнт звіряє окремим періодичним /btw/status-запитом, не
//    тут). Задокументована відмінність, не забутий баг.
// 4. Рельєф (§4.7.4, terrain-тайл) — НЕ реалізовано в цьому кроці (той самий, вже раніше
//    задокументований у AUDIT-btw.md пропуск, не новий). targetGroundH тут завжди 0 —
//    ізовисотне наближення, коректне для щільного міста, неточне для горбистих районів,
//    так само як зазначено в §4.7.4 самого ТЗ ("для рівнинних районів вплив малий").

import {
  ObserverPose,
  TargetZone,
  CameraSector,
  RankedCandidate,
  computeTargetZone,
  angularTolerance,
  passesConeFilter,
  classifyOrientationFit,
  computeScore,
  sampleTargetZonePoints,
  computeCoverageFromSamples,
  snapHeadingToStreetGrid,
  findOccluder,
  isVisible,
  toLocalXY,
  haversineDistance,
  bearing,
  LatLng,
} from '../lib/btw-geometry-engine';
import { decodeBuildingsTile, buildingsToEdges, CamerasTile, CamerasTileEntry, StreetsTile } from '../lib/tile-format';
import { LinearScanEdgeIndex, buildEdgeIndex } from '../lib/edge-index';

// ---------------------------------------------------------------------------------------------
// Протокол повідомлень
// ---------------------------------------------------------------------------------------------

interface LoadTilesRequest {
  type: 'loadTiles';
  buildings: ArrayBuffer;
  cameras: CamerasTile;
  streets: StreetsTile;
}

interface ScanRequest {
  type: 'scan';
  requestId: number;
  pose: ObserverPose;
  targetOverride?: LatLng;
}

type WorkerRequest = LoadTilesRequest | ScanRequest;

interface LoadTilesAck {
  type: 'loadTilesAck';
  ok: true;
  buildingCount: number;
  edgeCount: number;
  cameraCount: number;
  streetCount: number;
}

interface LoadTilesError {
  type: 'loadTilesAck';
  ok: false;
  error: string;
}

interface ScanResultMessage {
  type: 'scanResult';
  requestId: number;
  direct: RankedCandidate[];
  fallback: RankedCandidate[];
  target: LatLng;
  debug: {
    rawHeading: number;
    effectiveHeading: number;
    snapped: boolean;
    snappedTo: number | null;
    streetCandidatesFound: number;
    camerasInBbox: number;
    coneSurvivors: number;
    finalCandidates: number;
    headingUncertaintyDeg: number;
  };
}

interface ScanErrorMessage {
  type: 'scanError';
  requestId: number;
  error: string;
}

type WorkerResponse = LoadTilesAck | LoadTilesError | ScanResultMessage | ScanErrorMessage;

function post(msg: WorkerResponse): void {
  // eslint-disable-next-line no-restricted-globals
  (self as unknown as Worker).postMessage(msg);
}

// ---------------------------------------------------------------------------------------------
// Стан воркера — заповнюється один раз через 'loadTiles', далі 'scan' лише читає.
// ---------------------------------------------------------------------------------------------

let tileOrigin: LatLng | null = null;
let edgeIndex: LinearScanEdgeIndex | null = null;
let cameras: CamerasTileEntry[] = [];
let streets: StreetsTile['streets'] = [];

const DEFAULT_EYE_HEIGHT_M = 1.6; // середній зріст ока для людини, що тримає телефон піднятим

// Радіус пошуку "найближчих вулиць" — той самий порядок величини, що AzimuthHeuristicService
// використовує для живого Overpass-запиту (кілька сотень метрів навколо спостерігача).
const STREET_SEARCH_RADIUS_M = 200;

function getNearbyStreetAzimuths(pose: { lat: number; lng: number }): number[] {
  const out: number[] = [];
  for (const s of streets) {
    if (haversineDistance(pose, { lat: s.lat, lng: s.lng }) <= STREET_SEARCH_RADIUS_M) {
      out.push(...s.axisAzimuths);
    }
  }
  return out;
}

function handleLoadTiles(msg: LoadTilesRequest): void {
  try {
    const decoded = decodeBuildingsTile(msg.buildings);
    tileOrigin = { lat: decoded.originLat, lng: decoded.originLon };
    const edges = buildingsToEdges(decoded);
    edgeIndex = buildEdgeIndex(edges);
    cameras = msg.cameras.cameras;
    streets = msg.streets.streets;

    post({
      type: 'loadTilesAck',
      ok: true,
      buildingCount: decoded.buildings.length,
      edgeCount: edges.length,
      cameraCount: cameras.length,
      streetCount: streets.length,
    });
  } catch (err) {
    post({ type: 'loadTilesAck', ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Дослівне дзеркало каскаду з apps/api/src/btw/btw.service.ts::scan() — див. коментарі на
// початку файлу щодо трьох свідомих відмінностей (вулиці/LOS локальні, ageSeconds спрощено).
function handleScan(msg: ScanRequest): void {
  const { requestId, pose, targetOverride } = msg;

  try {
    if (!edgeIndex || !tileOrigin) {
      post({ type: 'scanError', requestId, error: 'tiles not loaded — call loadTiles first' });
      return;
    }

    // У3 (§5) — snap до вуличної сітки, тепер з локального tiles.streets замість Overpass.
    const streetCandidates = getNearbyStreetAzimuths(pose);
    const snapResult = snapHeadingToStreetGrid(pose.heading, streetCandidates);
    const effectiveHeading = snapResult.heading;

    // §4.2 — реальний occluder-пошук уздовж променя погляду (НОВЕ відносно сервера, який
    // завжди використовує фіксовані 250м — тут справжня геометрія будівель у пам'яті).
    const observerXY = toLocalXY(tileOrigin, { lat: pose.lat, lng: pose.lng });
    const eyeHeightM = pose.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
    const occluder = findOccluder(edgeIndex, observerXY, effectiveHeading, eyeHeightM, 0);

    const target: TargetZone = computeTargetZone(pose, effectiveHeading, {
      targetOverride,
      occluderDistanceM: occluder?.d,
    });

    // Ф1 — дистанція (весь тайл — один "bbox", лінійний скан по вже завантажених камерах;
    // немає окремого SQL bbox-запиту, бо всі камери тайлу вже в пам'яті).
    const BBOX_RADIUS_M = 2500;
    const roughCandidates = cameras.filter((cam) => haversineDistance(pose, { lat: cam.lat, lng: cam.lng }) <= BBOX_RADIUS_M);

    // Ф2 — конус без окклюзії, з тим самим adaptive tolerance (§4.4), що й сервер.
    const headingUncertaintyDeg = angularTolerance(pose.accuracyM, target.distanceM, pose.headingSigma);
    const coneSurvivors = roughCandidates.filter((cam) => passesConeFilter(toCameraSector(cam), target, headingUncertaintyDeg));

    // Ф3 — LOS через локальний edge-index (замість живого OcclusionService).
    const samplePoints = sampleTargetZonePoints(target);
    const candidates: RankedCandidate[] = [];

    for (const cam of coneSurvivors) {
      const camXY = toLocalXY(tileOrigin, { lat: cam.lat, lng: cam.lng });
      const visibilityFlags = samplePoints.map((point) => {
        const pointXY = toLocalXY(tileOrigin!, point);
        // targetGroundH=0 — немає рельєфу в цьому кроці (§4.7.4, задокументований пропуск).
        return isVisible(edgeIndex!, camXY, cam.heightMeters, pointXY, 0);
      });
      const coverage = computeCoverageFromSamples(visibilityFlags);
      if (coverage === 0) continue;

      const distanceM = haversineDistance(cam, target.point);
      const orientationFit = classifyOrientationFit(cam.azimuth, effectiveHeading);

      const score = computeScore({
        coverage,
        orientationFit,
        ageSeconds: 0, // спрощено — див. коментар "3." на початку файлу
        quality: 0.5, // те саме спрощення, що вже на сервері (немає окремого поля якості)
        distanceM,
        popularity: 0, // те саме спрощення, що вже на сервері (немає накопиченої CTR-статистики)
      });

      candidates.push({
        cameraId: cam.id,
        cameraName: cam.name,
        distanceM,
        bearingToTarget: bearing(cam, target.point),
        coverage,
        orientationFit,
        score,
        cameraAzimuth: cam.azimuth,
      });
    }

    // М1 — той самий поділ direct(ALIGNED)/fallback(SIDE+OPPOSING), топ-3 у кожній групі.
    const direct = candidates
      .filter((c) => c.orientationFit === 'ALIGNED')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const fallback = candidates
      .filter((c) => c.orientationFit !== 'ALIGNED')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    post({
      type: 'scanResult',
      requestId,
      direct,
      fallback,
      target: target.point,
      debug: {
        rawHeading: pose.heading,
        effectiveHeading,
        snapped: snapResult.snapped,
        snappedTo: snapResult.snappedTo,
        streetCandidatesFound: streetCandidates.length,
        camerasInBbox: roughCandidates.length,
        coneSurvivors: coneSurvivors.length,
        finalCandidates: direct.length + fallback.length,
        headingUncertaintyDeg,
      },
    });
  } catch (err) {
    post({ type: 'scanError', requestId, error: err instanceof Error ? err.message : String(err) });
  }
}

function toCameraSector(cam: CamerasTileEntry): CameraSector {
  return { lat: cam.lat, lng: cam.lng, azimuth: cam.azimuth, fovAngle: cam.fovAngle, rangeMeters: cam.rangeMeters };
}

// eslint-disable-next-line no-restricted-globals
(self as unknown as Worker).onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'loadTiles') {
    handleLoadTiles(msg);
  } else if (msg.type === 'scan') {
    handleScan(msg);
  }
};

// Client-side mirror of apps/api/src/common/geometry.util.ts — той самий патерн, що вже
// перевірений в apps/admin/lib/geometry.ts: дублюється навмисно, щоб мапа могла миттєво
// малювати сектори без round-trip до API при кожній зміні масштабу/панорамування.

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

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

  return { lat: toDeg(phi2), lng: toDeg(lambda2) };
}

export function buildSectorPolygon(cam: CameraSector, arcPoints = 24): LatLng[] {
  const halfAngle = cam.fovAngle / 2;
  const startAngle = cam.azimuth - halfAngle;
  const endAngle = cam.azimuth + halfAngle;

  const coords: LatLng[] = [{ lat: cam.lat, lng: cam.lng }];
  for (let i = 0; i <= arcPoints; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / arcPoints;
    coords.push(destinationPoint(cam, angle, cam.rangeMeters));
  }
  coords.push({ lat: cam.lat, lng: cam.lng });
  return coords;
}

// Потрібно для карти (не було в SectorMap.tsx, там завжди відомий один конкретний адрес) —
// bbox навколо центру для запиту /btw/coverage за заданим радіусом.
export function bboxAroundPoint(center: LatLng, radiusM: number): { swLat: number; swLng: number; neLat: number; neLng: number } {
  const north = destinationPoint(center, 0, radiusM);
  const south = destinationPoint(center, 180, radiusM);
  const east = destinationPoint(center, 90, radiusM);
  const west = destinationPoint(center, 270, radiusM);
  return { swLat: south.lat, swLng: west.lng, neLat: north.lat, neLng: east.lng };
}

// ДОДАНО — за прямим запитом користувача «полностью реализовать п 3 и п 4 по тз» (§5.2 ТЗ,
// "Сопровождение в поездке"): клієнтське дзеркало `haversineDistance`/`bearing`/
// `nearestPointOnRoute` з `apps/api/src/common/geometry.util.ts` — той самий принцип
// дублювання, що вже й решта цього файлу. Рахується НА КОЖЕН GPS-фікс під час поїздки
// (`watchPosition`, кілька разів на секунду можливо) — навмисно клієнтське, без round-trip до
// сервера на кожен тик (сервер і так викликається окремо, але лише коли РЕАЛЬНО потрібен
// перерахунок маршруту, §5.3).
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

// Точна копія алгоритму `nearestPointOnRoute` з `common/geometry.util.ts` (сервер), включно з
// ВИПРАВЛЕННЯМ від 2026-08-06 (аудит — doc/AUDIT-btw-route-planning.md): попередня версія
// апроксимувала проєкцію `point` на сегмент через ПРЯМУ (не спроєктовану) відстань від
// `segStart` до `point` — правильно лише коли `point` лежить точно на лінії сегмента, для
// точки, зміщеної вбік (типовий випадок реального GPS-фікса), хибно зсувала "найближчу точку"
// вздовж сегмента. Приклад: сегмент 1000м на північ, точка навпроти початку сегмента за 500м на
// схід — правильно: offset=0м, distance=500м; стара формула давала offset=500м, distance≈707м —
// під час поїздки це напряму годувало індикатор відхилення (§5.2) і поріг авто-ре-роутингу
// (§5.3) хибними значеннями. Нова версія — точна 2D-проекція (скалярний добуток) у локальній
// рівнокутній (flat-earth) системі координат з початком у `segStart`, той самий принцип
// точності, що вже заявлявся коментарем "достатньо точно в масштабі міста", тепер коректно
// застосований до самої проєкції.
export function nearestPointOnRoute(route: LatLng[], point: LatLng): { azimuth: number; offsetMeters: number; distanceToRouteM: number } {
  if (route.length < 2) {
    return { azimuth: 0, offsetMeters: 0, distanceToRouteM: route[0] ? haversineDistance(route[0], point) : Infinity };
  }

  let best = { azimuth: 0, offsetMeters: 0, distanceToRouteM: Infinity };
  let cumulative = 0;

  for (let i = 1; i < route.length; i++) {
    const segStart = route[i - 1];
    const segEnd = route[i];
    const segLength = haversineDistance(segStart, segEnd);
    const segAzimuth = bearing(segStart, segEnd);

    const latRad = toRad(segStart.lat);
    const toLocalXY = (p: LatLng) => ({
      x: toRad(p.lng - segStart.lng) * Math.cos(latRad) * EARTH_RADIUS_M,
      y: toRad(p.lat - segStart.lat) * EARTH_RADIUS_M,
    });
    const segVec = toLocalXY(segEnd);
    const pointVec = toLocalXY(point);
    const segLenSq = segVec.x * segVec.x + segVec.y * segVec.y;
    const rawFraction = segLenSq === 0 ? 0 : (pointVec.x * segVec.x + pointVec.y * segVec.y) / segLenSq;
    const clampedFraction = Math.min(1, Math.max(0, rawFraction));
    const crossX = pointVec.x - clampedFraction * segVec.x;
    const crossY = pointVec.y - clampedFraction * segVec.y;
    const distanceToRouteM = Math.sqrt(crossX * crossX + crossY * crossY);

    if (distanceToRouteM < best.distanceToRouteM) {
      best = { azimuth: segAzimuth, offsetMeters: cumulative + clampedFraction * segLength, distanceToRouteM };
    }
    cumulative += segLength;
  }

  return best;
}

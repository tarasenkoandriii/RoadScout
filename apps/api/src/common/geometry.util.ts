import { PrismaClient } from '@prisma/client';

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
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

  return { lat: toDeg(phi2), lng: toDeg(lambda2) };
}

// Core sector-test from the ТЗ: is `point` within the camera's field of view?
export function cameraSeesPoint(
  cam: CameraSector,
  point: LatLng,
): { visible: boolean; distanceM: number; bearingFromCamera: number } {
  const distanceM = haversineDistance(cam, point);
  const bearingFromCamera = bearing(cam, point);

  if (distanceM > cam.rangeMeters) {
    return { visible: false, distanceM, bearingFromCamera };
  }

  const visible = angularDiff(bearingFromCamera, cam.azimuth) <= cam.fovAngle / 2;
  return { visible, distanceM, bearingFromCamera };
}

// Builds the fan/cone polygon (camera position + arc), used both for map rendering
// and for the PostGIS fov_polygon column.
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

export function sectorToEwkt(cam: CameraSector, arcPoints = 24): string {
  const poly = buildSectorPolygon(cam, arcPoints);
  const coordStr = poly.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `SRID=4326;POLYGON((${coordStr}))`;
}

// Recomputes and persists fov_polygon for a camera. Called after every create/update
// of position/azimuth/fovAngle/rangeMeters, both from the admin CRUD and from the scraper.
export async function syncCameraPolygon(
  prisma: PrismaClient,
  camera: CameraSector & { id: string },
): Promise<void> {
  const ewkt = sectorToEwkt(camera);
  await prisma.$executeRawUnsafe(`UPDATE "Camera" SET fov_polygon = ST_GeomFromEWKT($1) WHERE id = $2`, ewkt, camera.id);
}

// ---------------------------------------------------------------------------
// Глава 16–18 ТЗ: FIXED_ROUTE — геометрия маршрута
// ---------------------------------------------------------------------------

// Total length of a polyline (sum of haversine segments). Used as a fallback when
// Camera.routeLengthMeters wasn't cached at creation time.
export function routeLength(route: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineDistance(route[i - 1], route[i]);
  }
  return total;
}

// Walks the polyline and returns the point (and local direction of travel) at the given
// cumulative distance from the start. `distanceM` is clamped into [0, length] — callers doing
// LOOP wraparound must take the modulo *before* calling this.
export function pointAtDistanceAlongRoute(route: LatLng[], distanceM: number): { point: LatLng; azimuth: number } {
  if (route.length === 0) {
    throw new Error('pointAtDistanceAlongRoute: empty routeGeometry');
  }
  if (route.length === 1) {
    return { point: route[0], azimuth: 0 };
  }

  const clamped = Math.max(0, Math.min(distanceM, routeLength(route)));
  let remaining = clamped;

  for (let i = 1; i < route.length; i++) {
    const segStart = route[i - 1];
    const segEnd = route[i];
    const segLength = haversineDistance(segStart, segEnd);
    const segAzimuth = bearing(segStart, segEnd);

    if (remaining <= segLength || i === route.length - 1) {
      const fraction = segLength === 0 ? 0 : remaining / segLength;
      const point = destinationPoint(segStart, segAzimuth, fraction * segLength);
      return { point, azimuth: segAzimuth };
    }
    remaining -= segLength;
  }

  // Shouldn't be reached given the clamp above, but keep TypeScript (and runtime) safe.
  const last = route[route.length - 1];
  return { point: last, azimuth: bearing(route[route.length - 2], last) };
}

// Nearest-segment projection — used by the LIVE_GPS provider to derive a plausible azimuth
// (direction of travel) and an approximate route offset from a raw lat/lng GPS fix, since the
// carrier feed only gives us a point, not a heading. Also used by `BtwRouteForecastService`
// (route-along filtering of incidents/traffic) and, client-side, by the BTW trip-mode deviation
// indicator/auto-reroute trigger (`apps/btw/lib/geometry.ts` — kept as an exact mirror of this
// function, see comment there).
//
// ⚠️ ВИПРАВЛЕНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — попередня версія
// апроксимувала проєкцію `point` на сегмент через ПРЯМУ (не спроєктовану) відстань від
// `segStart` до `point`, поділену на довжину сегмента. Це давало правильний результат ЛИШЕ
// коли `point` лежить точно на лінії сегмента; для будь-якої точки, зміщеної вбік (типовий
// випадок реального GPS-фікса при русі транспорту), частка завищувалась і "найближча точка"
// хибно зсувалась вздовж сегмента навіть тоді, коли справжня найближча точка — початок/кінець
// сегмента. Приклад: сегмент довжиною 1000м напрямку на північ, точка точно навпроти початку
// сегмента (abeam) за 500м на схід — правильна відповідь: offset=0м, distance=500м; стара
// формула давала offset=500м, distance≈707м.
//
// Нова версія — точна 2D-проекція (скалярний добуток) у локальній рівнокутній (flat-earth)
// системі координат з початком у `segStart` (x — схід, y — північ, обидва в метрах,
// довгота масштабується на cos(широта) для компенсації звуження меридіанів) — той самий
// принцип точності, що вже описувався коментарем "sufficient at city scale (segments are short
// relative to Earth's radius)", лише коректно застосований до самої проєкції, а не до вибору
// частки вздовж сегмента.
export function nearestPointOnRoute(
  route: LatLng[],
  point: LatLng,
): { azimuth: number; offsetMeters: number; distanceToRouteM: number } {
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

// Buffer polygon around the full route (route_buffer_polygon column) — cheap PostGIS prefilter
// for FIXED_ROUTE candidates in /search and /cameras/at-point. Not a precise visibility test,
// see comment in sql/route-migration.sql.
export function routeLineToEwkt(route: LatLng[]): string {
  const lineStr = route.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `SRID=4326;LINESTRING(${lineStr})`;
}

// Recomputes and persists route_line / route_buffer_polygon for a FIXED_ROUTE camera.
// Called after every create/update that touches routeGeometry/rangeMeters.
export async function syncCameraRoutePolygon(
  prisma: PrismaClient,
  cameraId: string,
  route: LatLng[],
  rangeMeters: number,
): Promise<void> {
  const lineEwkt = routeLineToEwkt(route);
  const degreesBuffer = rangeMeters / 111320; // rough metres->degrees at this latitude — fine for a prefilter margin
  await prisma.$executeRawUnsafe(
    `UPDATE "Camera"
     SET route_line = ST_GeomFromEWKT($1),
         route_buffer_polygon = ST_Buffer(ST_GeomFromEWKT($1), $2)
     WHERE id = $3`,
    lineEwkt,
    degreesBuffer,
    cameraId,
  );
}

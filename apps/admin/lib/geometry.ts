// Client-side mirror of apps/api/src/common/geometry.util.ts — duplicated on purpose
// so the calibration tool can redraw the sector instantly while dragging sliders,
// without a round-trip to the API on every change.

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

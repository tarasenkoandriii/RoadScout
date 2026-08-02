import { buildSectorPolygon, CameraSector, LatLng } from '../common/geometry.util';
import { FixedRouteCamera, RoutePosition } from './route-position.types';

// Глава 17 ТЗ: "строится временный FOV; вызывается существующий cameraSeesPoint()".
// fovAngle/rangeMeters are the camera's own intrinsic properties (static); lat/lng/azimuth
// come from the resolved RoutePosition — this is what makes STATIONARY and FIXED_ROUTE run
// through the exact same sector-test code path.
export function buildDynamicSector(camera: FixedRouteCamera, position: RoutePosition): CameraSector {
  return {
    lat: position.lat,
    lng: position.lng,
    azimuth: position.azimuth,
    fovAngle: camera.fovAngle,
    rangeMeters: camera.rangeMeters,
  };
}

// Only computed on demand (e.g. for admin/debug map rendering of a moving camera's current
// sector) — not part of the hot search path, which only needs cameraSeesPoint's boolean/distance
// result, not the full polygon.
export function buildDynamicSectorPolygon(camera: FixedRouteCamera, position: RoutePosition): LatLng[] {
  return buildSectorPolygon(buildDynamicSector(camera, position));
}

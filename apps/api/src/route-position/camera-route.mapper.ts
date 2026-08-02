import { LatLng } from '../common/geometry.util';
import { FixedRouteCamera } from './route-position.types';

// Minimal shape this mapper needs from a Prisma Camera row — deliberately loose (rather than
// importing the generated Prisma type) so it also works with the raw-SQL prefilter rows used
// in CamerasService.findCamerasNearPoint.
export interface CameraRouteFields {
  id: string;
  mobilityType: string;
  routeGeometry: unknown;
  routeLengthMeters: number | null;
  routeMode: string | null;
  routeSchedule: unknown;
  averageSpeed: number | null;
  routeStartedAt: Date | null;
  liveGpsLat: number | null;
  liveGpsLng: number | null;
  liveGpsSpeed: number | null;
  liveGpsUpdatedAt: Date | null;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

// Prisma's client API returns Json columns already parsed. The raw `$queryRaw` prefilter in
// CamerasService goes through the same underlying `pg` driver, which also auto-parses
// json/jsonb columns — but we defensively handle a JSON string too, in case that assumption
// ever breaks (different driver/pooler config), rather than silently dropping the route.
function coerceJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function parseRouteGeometry(raw: unknown): LatLng[] {
  const value = coerceJson(raw);
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is { lat: number; lng: number } => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function parseRouteSchedule(raw: unknown): { departures?: string[] } | null {
  const value = coerceJson(raw);
  if (!value || typeof value !== 'object') return null;
  const departures = (value as any).departures;
  if (!Array.isArray(departures)) return null;
  return { departures: departures.filter((d: unknown) => typeof d === 'string') };
}

export function toFixedRouteCamera(camera: CameraRouteFields): FixedRouteCamera {
  return {
    id: camera.id,
    routeGeometry: parseRouteGeometry(camera.routeGeometry),
    routeLengthMeters: camera.routeLengthMeters,
    routeMode: (camera.routeMode as FixedRouteCamera['routeMode']) ?? 'LOOP',
    routeSchedule: parseRouteSchedule(camera.routeSchedule),
    averageSpeed: camera.averageSpeed,
    routeStartedAt: camera.routeStartedAt,
    liveGpsLat: camera.liveGpsLat,
    liveGpsLng: camera.liveGpsLng,
    liveGpsSpeed: camera.liveGpsSpeed,
    liveGpsUpdatedAt: camera.liveGpsUpdatedAt,
    lat: camera.lat,
    lng: camera.lng,
    azimuth: camera.azimuth,
    fovAngle: camera.fovAngle,
    rangeMeters: camera.rangeMeters,
  };
}

import { LatLng } from '../common/geometry.util';

export type RouteModeValue = 'LOOP' | 'TIMETABLE' | 'LIVE_GPS';

// Subset of the Camera Prisma model that FIXED_ROUTE position calculation actually needs.
// Kept as a plain interface (not the Prisma type) so providers stay easily unit-testable.
export interface FixedRouteCamera {
  id: string;
  routeGeometry: LatLng[];
  routeLengthMeters: number | null;
  routeMode: RouteModeValue;
  routeSchedule: { departures?: string[] } | null;
  averageSpeed: number | null;
  routeStartedAt: Date | null;
  liveGpsLat: number | null;
  liveGpsLng: number | null;
  liveGpsSpeed: number | null;
  liveGpsUpdatedAt: Date | null;
  // Static fallback / intrinsic camera properties — see comment on the Camera model.
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

// The result of resolving a FIXED_ROUTE camera's position at a given instant — глава 16
// "Новые поля" (currentOffsetMeters/currentAzimuth) plus what глава 17/18 need downstream.
export interface RoutePosition {
  lat: number;
  lng: number;
  azimuth: number;
  speedMps: number;
  offsetMeters: number;
  timestamp: number; // ms epoch this position corresponds to
  source: RouteModeValue;
  // true when the provider had to fall back to a static/degraded estimate (no active
  // TIMETABLE trip, stale/missing LIVE_GPS fix, etc.) — surfaced so callers/logs can tell
  // a "real" fix apart from a best-effort guess.
  degraded: boolean;
}

export interface RoutePositionProvider {
  readonly mode: RouteModeValue;
  getPosition(camera: FixedRouteCamera, at: Date): RoutePosition;
}

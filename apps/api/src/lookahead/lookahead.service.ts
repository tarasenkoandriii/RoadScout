import { Injectable } from '@nestjs/common';
import { cameraSeesPoint, LatLng } from '../common/geometry.util';
import { buildDynamicSector } from '../route-position/dynamic-fov.builder';
import { FixedRoutePositionService } from '../route-position/fixed-route-position.service';
import { FixedRouteCamera, RouteModeValue, RoutePosition } from '../route-position/route-position.types';

export interface UserRoutePoint extends LatLng {
  // Seconds from "now" (request time) that the user expects to be at this point.
  // The first point should normally be 0 (user's current position).
  timestampOffsetSeconds: number;
}

export interface PredictedEncounter {
  cameraId: string;
  etaSeconds: number;
  distanceMeters: number;
  confidence: number; // 0..1, глава 17 "вероятность пересечения маршрутов"
  cameraPosition: RoutePosition;
}

// Don't simulate further ahead than this — a meeting predicted 2 hours out isn't useful and
// isn't cheap to compute for every candidate camera on every request.
const DEFAULT_HORIZON_SECONDS = 30 * 60;
const DEFAULT_STEP_SECONDS = 5;

// Confidence is a simple heuristic keyed off how trustworthy each RouteMode's position
// estimate is, not a statistical model — documented simplification (see README).
const CONFIDENCE_BY_MODE: Record<RouteModeValue, number> = {
  LIVE_GPS: 0.95, // ground-truth position, only azimuth is inferred
  LOOP: 0.85, // deterministic given averageSpeed, but real traffic can shift timing
  TIMETABLE: 0.6, // depends on schedule adherence (delays are common for surface transport)
};

@Injectable()
export class LookAheadService {
  constructor(private readonly positionService: FixedRoutePositionService) {}

  confidenceFor(mode: RouteModeValue, degraded: boolean): number {
    const base = CONFIDENCE_BY_MODE[mode] ?? 0.5;
    // A degraded estimate (no active TIMETABLE trip, stale LIVE_GPS, missing route data) is
    // never more trustworthy than a plain LOOP guess, and should read as noticeably weaker.
    return degraded ? Math.min(base, 0.4) : base;
  }

  // Глава 16–17 ТЗ: "прогнозирование встречи камеры с пользователем" for the plain
  // /search and /cameras/at-point case — a single, static target point (the searched
  // address / tapped map point), not yet visible right now, but that the camera might
  // pass by within the look-ahead horizon.
  predictPointEncounter(
    camera: FixedRouteCamera,
    point: LatLng,
    horizonSeconds = DEFAULT_HORIZON_SECONDS,
    stepSeconds = DEFAULT_STEP_SECONDS,
  ): PredictedEncounter | null {
    const now = Date.now();

    for (let t = 0; t <= horizonSeconds; t += stepSeconds) {
      const at = new Date(now + t * 1000);
      const position = this.positionService.computePositionAt(camera, at);
      const sector = buildDynamicSector(camera, position);
      const { visible, distanceM } = cameraSeesPoint(sector, point);

      if (visible) {
        return {
          cameraId: camera.id,
          etaSeconds: t,
          distanceMeters: Math.round(distanceM),
          confidence: this.confidenceFor(position.source, position.degraded),
          cameraPosition: position,
        };
      }
    }

    return null;
  }

  // Broader case from глава 17: an actual user route (not just one point) — e.g. a "route
  // planner" feature that isn't wired into a public endpoint yet beyond POST /lookahead,
  // but follows the exact same algorithm and sort order as the ТЗ specifies.
  predictRouteMeetings(
    userRoute: UserRoutePoint[],
    cameras: FixedRouteCamera[],
    horizonSeconds = DEFAULT_HORIZON_SECONDS,
    stepSeconds = DEFAULT_STEP_SECONDS,
  ): PredictedEncounter[] {
    const results: PredictedEncounter[] = [];

    for (const camera of cameras) {
      const encounter = this.predictAgainstMovingTarget(camera, userRoute, horizonSeconds, stepSeconds);
      if (encounter) results.push(encounter);
    }

    // Глава 17: "Результаты сортируются: 1. ETA; 2. расстояние; 3. confidence."
    results.sort((a, b) => a.etaSeconds - b.etaSeconds || a.distanceMeters - b.distanceMeters || b.confidence - a.confidence);
    return results;
  }

  private predictAgainstMovingTarget(
    camera: FixedRouteCamera,
    userRoute: UserRoutePoint[],
    horizonSeconds: number,
    stepSeconds: number,
  ): PredictedEncounter | null {
    if (userRoute.length === 0) return null;
    const now = Date.now();
    const maxUserT = userRoute[userRoute.length - 1].timestampOffsetSeconds;

    for (let t = 0; t <= Math.min(horizonSeconds, maxUserT); t += stepSeconds) {
      const userPoint = this.interpolateUserPosition(userRoute, t);
      const at = new Date(now + t * 1000);
      const position = this.positionService.computePositionAt(camera, at);
      const sector = buildDynamicSector(camera, position);
      const { visible, distanceM } = cameraSeesPoint(sector, userPoint);

      if (visible) {
        return {
          cameraId: camera.id,
          etaSeconds: t,
          distanceMeters: Math.round(distanceM),
          confidence: this.confidenceFor(position.source, position.degraded),
          cameraPosition: position,
        };
      }
    }

    return null;
  }

  // Piecewise-linear interpolation of the user's position along their declared route,
  // by elapsed seconds. Clamps to the first/last point outside the declared range.
  private interpolateUserPosition(route: UserRoutePoint[], t: number): LatLng {
    if (t <= route[0].timestampOffsetSeconds) return route[0];
    const last = route[route.length - 1];
    if (t >= last.timestampOffsetSeconds) return last;

    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1];
      const next = route[i];
      if (t <= next.timestampOffsetSeconds) {
        const span = next.timestampOffsetSeconds - prev.timestampOffsetSeconds;
        const fraction = span === 0 ? 0 : (t - prev.timestampOffsetSeconds) / span;
        return {
          lat: prev.lat + (next.lat - prev.lat) * fraction,
          lng: prev.lng + (next.lng - prev.lng) * fraction,
        };
      }
    }

    return last;
  }
}

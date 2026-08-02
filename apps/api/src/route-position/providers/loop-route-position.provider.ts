import { Injectable } from '@nestjs/common';
import { pointAtDistanceAlongRoute, routeLength } from '../../common/geometry.util';
import { FixedRouteCamera, RoutePosition, RoutePositionProvider } from '../route-position.types';

// Глава 17 ТЗ — LOOP: offset = ((now - startTime) * speed) mod routeLength.
// Deterministic and cheap — no external data needed, so this also doubles as the degraded
// fallback for TIMETABLE (no active trip) and LIVE_GPS (stale/missing fix).
@Injectable()
export class LoopRoutePositionProvider implements RoutePositionProvider {
  readonly mode = 'LOOP' as const;

  getPosition(camera: FixedRouteCamera, at: Date): RoutePosition {
    const speed = camera.averageSpeed ?? 0;
    const length = camera.routeLengthMeters ?? routeLength(camera.routeGeometry);

    if (!speed || !length || camera.routeGeometry.length < 2) {
      return this.staticFallback(camera, at);
    }

    const t0 = camera.routeStartedAt?.getTime() ?? 0;
    const elapsedSeconds = (at.getTime() - t0) / 1000;
    // JS `%` can return negative results for negative operands (e.g. t0 in the future) —
    // normalize into [0, length) so pointAtDistanceAlongRoute never sees a negative offset.
    const offset = (((elapsedSeconds * speed) % length) + length) % length;

    const { point, azimuth } = pointAtDistanceAlongRoute(camera.routeGeometry, offset);
    return {
      lat: point.lat,
      lng: point.lng,
      azimuth,
      speedMps: speed,
      offsetMeters: offset,
      timestamp: at.getTime(),
      source: 'LOOP',
      degraded: false,
    };
  }

  // Camera has no usable route data (missing speed/geometry) — report it at its static
  // depot position rather than throwing, so a misconfigured camera degrades gracefully
  // instead of breaking the whole /search response.
  staticFallback(camera: FixedRouteCamera, at: Date): RoutePosition {
    return {
      lat: camera.lat,
      lng: camera.lng,
      azimuth: camera.azimuth,
      speedMps: 0,
      offsetMeters: 0,
      timestamp: at.getTime(),
      source: 'LOOP',
      degraded: true,
    };
  }
}

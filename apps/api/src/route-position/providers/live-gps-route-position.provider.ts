import { Injectable } from '@nestjs/common';
import { nearestPointOnRoute } from '../../common/geometry.util';
import { FixedRouteCamera, RoutePosition, RoutePositionProvider } from '../route-position.types';
import { LoopRoutePositionProvider } from './loop-route-position.provider';

// Fixes older than this are considered stale — carrier feed probably stopped publishing
// (vehicle out of service, connectivity loss, etc.). Chosen a bit above the LIVE_GPS cache
// TTL (1s, глава 18) so a single missed push doesn't immediately trigger a fallback.
const STALE_MS = 30_000;

// Глава 17 ТЗ — LIVE_GPS: "если перевозчик публикует координаты транспорта, они имеют
// максимальный приоритет". Ingested out-of-band via
// POST /internal/fixed-route/:cameraId/live-position (see FixedRouteController).
@Injectable()
export class LiveGpsRoutePositionProvider implements RoutePositionProvider {
  readonly mode = 'LIVE_GPS' as const;

  constructor(private readonly loopFallback: LoopRoutePositionProvider) {}

  getPosition(camera: FixedRouteCamera, at: Date): RoutePosition {
    const hasFix = camera.liveGpsLat != null && camera.liveGpsLng != null && camera.liveGpsUpdatedAt != null;
    const ageMs = hasFix ? at.getTime() - camera.liveGpsUpdatedAt!.getTime() : Infinity;

    if (!hasFix || ageMs > STALE_MS) {
      // Known simplification: degrade to the LOOP estimate rather than, say, holding the
      // last known GPS point indefinitely — a stopped/disconnected vehicle is more likely
      // to still be roughly "on schedule" than frozen at its last reported spot.
      const fallback = this.loopFallback.getPosition(camera, at);
      return { ...fallback, source: 'LIVE_GPS', degraded: true };
    }

    const fix = { lat: camera.liveGpsLat!, lng: camera.liveGpsLng! };
    // The carrier feed gives us a point, not a heading — derive azimuth (and an approximate
    // route offset, for admin/debug display) from the nearest point on the published route.
    const { azimuth, offsetMeters } = nearestPointOnRoute(camera.routeGeometry, fix);

    return {
      lat: fix.lat,
      lng: fix.lng,
      azimuth,
      speedMps: camera.liveGpsSpeed ?? camera.averageSpeed ?? 0,
      offsetMeters,
      timestamp: at.getTime(),
      source: 'LIVE_GPS',
      degraded: false,
    };
  }
}

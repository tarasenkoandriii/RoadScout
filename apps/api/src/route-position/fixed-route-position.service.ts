import { Injectable, Logger } from '@nestjs/common';
import { LoopRoutePositionProvider } from './providers/loop-route-position.provider';
import { TimetableRoutePositionProvider } from './providers/timetable-route-position.provider';
import { LiveGpsRoutePositionProvider } from './providers/live-gps-route-position.provider';
import { FixedRouteCamera, RoutePosition, RoutePositionProvider, RouteModeValue } from './route-position.types';
import { buildDynamicSector } from './dynamic-fov.builder';
import { CameraSector } from '../common/geometry.util';

// Глава 18 ТЗ — кэш по routeMode, общий для всех сервисов (searchByAddress, /cameras/at-point,
// LookAheadService и т.д. все проходят через один и тот же getCurrentPosition()).
const CACHE_TTL_MS: Record<RouteModeValue, number> = {
  LOOP: 5_000,
  TIMETABLE: 3_000,
  LIVE_GPS: 1_000,
};

interface CacheEntry {
  position: RoutePosition;
  sector: CameraSector;
  expiresAt: number;
}

// NOTE (known simplification, documented in README): this is a plain in-process Map, not a
// shared cache like Redis. On a single long-running Node process (docker-compose, a
// traditional server) it works exactly as specified. On Vercel serverless, each cold
// lambda instance gets its own empty cache — still correct (just re-computes on a cold
// start), but doesn't dedupe across concurrently-warm instances. Good enough for the current
// scale; revisit if FIXED_ROUTE camera count or traffic grows.
@Injectable()
export class FixedRoutePositionService {
  private readonly logger = new Logger(FixedRoutePositionService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly providers: Record<RouteModeValue, RoutePositionProvider>;

  constructor(
    private readonly loop: LoopRoutePositionProvider,
    private readonly timetable: TimetableRoutePositionProvider,
    private readonly liveGps: LiveGpsRoutePositionProvider,
  ) {
    this.providers = { LOOP: this.loop, TIMETABLE: this.timetable, LIVE_GPS: this.liveGps };
  }

  // Cached "where is this camera right now" lookup — this is what the hot search path
  // (CamerasService.searchByAddress / atPoint) should call.
  getCurrentPosition(camera: FixedRouteCamera): { position: RoutePosition; sector: CameraSector } {
    const now = Date.now();
    const cached = this.cache.get(camera.id);
    if (cached && cached.expiresAt > now) {
      return { position: cached.position, sector: cached.sector };
    }

    const position = this.computePositionAt(camera, new Date(now));
    const sector = buildDynamicSector(camera, position);
    const ttl = CACHE_TTL_MS[camera.routeMode];
    this.cache.set(camera.id, { position, sector, expiresAt: now + ttl });

    return { position, sector };
  }

  // Uncached, arbitrary-instant computation — used by LookAheadService to simulate a
  // camera's future position at t+N seconds. Deliberately bypasses the cache: simulating
  // 30 minutes ahead in 5s steps means every timestamp is different anyway.
  computePositionAt(camera: FixedRouteCamera, at: Date): RoutePosition {
    const provider = this.providers[camera.routeMode];
    if (!provider) {
      this.logger.warn(`Camera ${camera.id}: unknown routeMode "${camera.routeMode}", falling back to LOOP`);
      return this.loop.getPosition(camera, at);
    }
    return provider.getPosition(camera, at);
  }

  // Called by the LIVE_GPS ingestion endpoint so a fresh push is reflected immediately
  // instead of waiting out the (short) cache TTL.
  invalidate(cameraId: string): void {
    this.cache.delete(cameraId);
  }
}

import { Injectable } from '@nestjs/common';
import { pointAtDistanceAlongRoute, routeLength } from '../../common/geometry.util';
import { FixedRouteCamera, RoutePosition, RoutePositionProvider } from '../route-position.types';
import { LoopRoutePositionProvider } from './loop-route-position.provider';

// Глава 17 ТЗ — TIMETABLE: "выбирается ближайший рейс, после этого вычисляется положение
// камеры относительно времени отправления".
//
// routeSchedule format: { "departures": ["06:20", "06:50", ...] } — daily local-time
// departures, repeating every day. We don't model calendars/exceptions/day-of-week — a known
// simplification (see README), fine for a fixed city bus/tram loop.
@Injectable()
export class TimetableRoutePositionProvider implements RoutePositionProvider {
  readonly mode = 'TIMETABLE' as const;

  constructor(private readonly loopFallback: LoopRoutePositionProvider) {}

  getPosition(camera: FixedRouteCamera, at: Date): RoutePosition {
    const speed = camera.averageSpeed ?? 0;
    const length = camera.routeLengthMeters ?? routeLength(camera.routeGeometry);
    const departures = camera.routeSchedule?.departures ?? [];

    if (!speed || !length || departures.length === 0 || camera.routeGeometry.length < 2) {
      return this.degrade(camera, at);
    }

    const routeDurationMs = (length / speed) * 1000;
    const activeDeparture = this.findActiveDeparture(departures, at, routeDurationMs);

    if (!activeDeparture) {
      // No trip currently in progress (between runs, e.g. overnight) — the vehicle is
      // presumably at a depot/terminus. We can't know exactly which one without more data,
      // so we degrade rather than guess a specific point.
      return this.degrade(camera, at);
    }

    const elapsedSeconds = (at.getTime() - activeDeparture.getTime()) / 1000;
    const offset = Math.min(length, Math.max(0, elapsedSeconds * speed));
    const { point, azimuth } = pointAtDistanceAlongRoute(camera.routeGeometry, offset);

    return {
      lat: point.lat,
      lng: point.lng,
      azimuth,
      speedMps: speed,
      offsetMeters: offset,
      timestamp: at.getTime(),
      source: 'TIMETABLE',
      degraded: false,
    };
  }

  // Builds candidate departure timestamps for yesterday/today/tomorrow (handles trips that
  // cross midnight) and picks the most recent one that is still "in transit" — i.e.
  // 0 <= (now - departure) <= routeDurationMs.
  private findActiveDeparture(departures: string[], at: Date, routeDurationMs: number): Date | null {
    let best: Date | null = null;

    for (const dayOffset of [-1, 0, 1]) {
      for (const hhmm of departures) {
        const [hours, minutes] = hhmm.split(':').map(Number);
        if (Number.isNaN(hours) || Number.isNaN(minutes)) continue;

        const candidate = new Date(at);
        candidate.setDate(candidate.getDate() + dayOffset);
        candidate.setHours(hours, minutes, 0, 0);

        const elapsed = at.getTime() - candidate.getTime();
        if (elapsed >= 0 && elapsed <= routeDurationMs) {
          if (!best || candidate.getTime() > best.getTime()) best = candidate;
        }
      }
    }

    return best;
  }

  private degrade(camera: FixedRouteCamera, at: Date): RoutePosition {
    const fallback = this.loopFallback.staticFallback(camera, at);
    return { ...fallback, source: 'TIMETABLE' };
  }
}

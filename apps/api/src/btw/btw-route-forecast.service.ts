import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeatherService, WeatherPoint } from '../situational/weather.service';
import { RoadIncidentsService } from '../situational/incidents.service';
import { FiveElevenNyService } from '../situational/five11ny.service';
import { TomTomTrafficService, BoundingBox } from '../situational/tomtom.service';
import { LookAheadService, UserRoutePoint } from '../lookahead/lookahead.service';
import { toFixedRouteCamera } from '../route-position/camera-route.mapper';
import { LatLng, haversineDistance, nearestPointOnRoute, routeLineToEwkt } from '../common/geometry.util';

// Этапы 1 и 2 (§8 ТЗ, doc/TZ-btw-route-planning.md) — за прямым запросом користувача «полностью
// реализовать п 1 и п 2 по тз». Этот сервис — «наложение» на уже построенный маршрут
// (OpenRouteServiceClient, §6): камеры вдоль маршрута (§4.1/§4.2, Этап 1), погода/инциденты/
// живой трафик (§7.1/§7.2, Этап 2) и встречи с FIXED_ROUTE-камерами через уже существующий
// LookAheadService (§4.3, Этап 2, "переиспользует /lookahead"). Вызывается ОДИН раз из
// BtwService.buildRoute() сразу после получения геометрии маршрута — тот же UX, что описан в
// §2.1 шаг 4: «маршрутизатор строит путь → приложение накладывает на него...».

// §9 п.2 ТЗ — «решено: 250-400м», конкретное значение в диапазоне не зафиксировано пользователем
// («по плотности камер в городе», §4.1) — берём середину диапазона как стартовое значение.
const CAMERA_BUFFER_METERS = 300;

// Не зафиксировано явно в ТЗ (§7.1 говорит лишь "тот же геометрический приём", без конкретного
// числа) — шире буфера камер: инцидент/пробка в 400-500м от линии маршрута всё ещё релевантен
// водителю (видно с дороги, объезд может задеть), тогда как камера должна физически "видеть"
// точку на маршруте, для чего 250-400м уже достаточный запас (§4.1).
const INCIDENT_BUFFER_METERS = 500;

// Грубое приближение границ штата Нью-Йорк прямоугольником (НЕ настоящий контур штата — §7.2
// ТЗ: "по городу маршрута/штату", более точная привязка к границе штата не запрошена и не
// реализована здесь) — используется только чтобы решить, 511NY или TomTom обслуживает этот
// маршрут (§7.2 "Логика выбора источника в коде").
const NY_STATE_BBOX = { minLat: 40.45, maxLat: 45.05, minLng: -79.9, maxLng: -71.75 };

// Лимит точек маршрута, передаваемых в LookAheadService.predictRouteMeetings() — декодированный
// OpenRouteService-polyline может содержать сотни/тысячи точек (одна на каждый изгиб дороги),
// а predictRouteMeetings() на каждом шаге симуляции (по умолчанию каждые 5с) линейно сканирует
// весь переданный массив точек (interpolateUserPosition) — даунсэмплинг держит это дешёвым, не
// теряя формы маршрута (равномерная выборка, первая/последняя точка всегда сохраняются).
const MAX_LOOKAHEAD_POINTS = 200;

export interface CameraAlongRoute {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  confidence: string;
  status: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  offsetMeters: number; // §4.2 — расстояние вдоль маршрута от точки А
  distanceToRouteM: number; // §4.2 — насколько камера в стороне от линии маршрута
}

export interface IncidentAlongRoute {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  offsetMeters: number;
  distanceToRouteM: number;
}

export interface TrafficEventAlongRoute {
  id: string;
  lat: number;
  lng: number;
  description: string | null;
  severityLabel: string;
  offsetMeters: number;
  distanceToRouteM: number;
}

export interface TrafficForecast {
  // null — маршрут вне зоны покрытия ОБОИХ источников (не NY State И TomTom не настроен) либо
  // определённый источник не настроен (нет ключа) — see `configured` для различия причин.
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  events: TrafficEventAlongRoute[];
}

export interface FixedRouteEncounterAlongRoute {
  cameraId: string;
  name: string;
  streamUrl: string;
  streamType: string;
  etaSeconds: number;
  distanceMeters: number;
  confidence: number;
  cameraLat: number;
  cameraLng: number;
  cameraAzimuth: number;
  cameraSpeed: number;
}

export interface RouteForecast {
  camerasAlongRoute: CameraAlongRoute[];
  weather: WeatherPoint | null;
  incidents: IncidentAlongRoute[];
  traffic: TrafficForecast;
  fixedRouteEncounters: FixedRouteEncounterAlongRoute[];
}

@Injectable()
export class BtwRouteForecastService {
  private readonly logger = new Logger(BtwRouteForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly weather: WeatherService,
    private readonly roadIncidents: RoadIncidentsService,
    private readonly five11ny: FiveElevenNyService,
    private readonly tomtom: TomTomTrafficService,
    private readonly lookAhead: LookAheadService,
  ) {}

  async getForecast(route: LatLng[], distanceMeters: number, durationSeconds: number): Promise<RouteForecast> {
    // Независимые друг от друга запросы — параллельно, тот же принцип, что уже
    // WeatherService.getSnapshot() (Promise.all по опорным точкам).
    //
    // ⚠️ ВИПРАВЛЕНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — раніше лише
    // `findCamerasAlongRoute` мав власний try/catch; решта чотирьох джерел кидали виняток прямо
    // в цей `Promise.all`, і збій БУДЬ-ЯКОГО одного з них (напр. `WeatherService.getSnapshot()`)
    // валив ВЕСЬ `Promise.all` — `BtwService.getForecastSafely()` (btw.service.ts) ловив це на
    // зовнішньому рівні й підміняв ЦІЛИЙ прогноз порожнім, включно з джерелами, які насправді
    // встигли успішно відпрацювати. Це прямо суперечило задокументованій поведінці "м'яка
    // деградація по кожному джерелу окремо" (§ Проверка в AUDIT). Тепер кожне джерело обгорнуте
    // окремо через `safeForecast()` — збій одного джерела деградує ЛИШЕ його, решта чотирьох
    // повертаються як завжди.
    const [camerasAlongRoute, weatherPoint, incidents, traffic, fixedRouteEncounters] = await Promise.all([
      this.safeForecast('findCamerasAlongRoute', () => this.findCamerasAlongRoute(route), []),
      this.safeForecast('findNearestWeather', () => this.findNearestWeather(route), null),
      this.safeForecast('findIncidentsAlongRoute', () => this.findIncidentsAlongRoute(route), []),
      this.safeForecast('findTrafficAlongRoute', () => this.findTrafficAlongRoute(route), {
        source: null,
        configured: false,
        events: [],
      } as TrafficForecast),
      this.safeForecast('findFixedRouteEncounters', () => this.findFixedRouteEncounters(route, distanceMeters, durationSeconds), []),
    ]);

    return { camerasAlongRoute, weather: weatherPoint, incidents, traffic, fixedRouteEncounters };
  }

  // Спільна "м'яка деградація по джерелу" — кожен виклик `getForecast()` вище проходить через
  // цю обгортку, а не покладається на власний try/catch кожного приватного методу (у
  // `findCamerasAlongRoute` він лишився — подвійний захист, не шкодить). Гарантує, що збій
  // ОДНОГО джерела ніколи не "з'їдає" вже успішно отримані дані решти чотирьох.
  private async safeForecast<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`${label} failed, degrading to empty result for this source only: ${(err as Error).message}`);
      return fallback;
    }
  }

  // §4.1/§4.2 ТЗ — STATIONARY-камеры, чей fov_polygon пересекает буфер вокруг линии маршрута.
  // Тот же приём, что уже CamerasService.findCandidatesNearPoint (ST_Contains для точки) —
  // здесь ST_Intersects с буфером линии, ровно как решено в §4.1 ТЗ (сектор камеры может
  // ЧАСТИЧНО попадать в буфер, не обязательно целиком).
  private async findCamerasAlongRoute(route: LatLng[]): Promise<CameraAlongRoute[]> {
    if (route.length < 2) return [];

    const ewkt = routeLineToEwkt(route);
    // Тот же грубый метр->градус перевід, що вже syncCameraRoutePolygon (geometry.util.ts) —
    // не справжній геодезичний буфер, узгоджений з рештою проєкту прийом для SRID 4326.
    const bufferDegrees = CAMERA_BUFFER_METERS / 111320;

    try {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT id, name, "streamUrl", "streamType", confidence, status, lat, lng, azimuth, "fovAngle", "rangeMeters"
        FROM "Camera"
        WHERE "deletedAt" IS NULL
          AND confidence = 'VERIFIED'
          AND status = 'ONLINE'
          AND "mobilityType" = 'STATIONARY'
          AND "locationType" = 'OUTDOOR'
          AND fov_polygon IS NOT NULL
          AND ST_Intersects(fov_polygon, ST_Buffer(ST_GeomFromEWKT(${ewkt}), ${bufferDegrees}))
      `;

      return rows
        .map((r) => {
          const { offsetMeters, distanceToRouteM } = nearestPointOnRoute(route, { lat: r.lat, lng: r.lng });
          return {
            id: r.id,
            name: r.name,
            streamUrl: r.streamUrl,
            streamType: r.streamType,
            confidence: r.confidence,
            status: r.status,
            lat: r.lat,
            lng: r.lng,
            azimuth: r.azimuth,
            fovAngle: r.fovAngle,
            rangeMeters: r.rangeMeters,
            offsetMeters: Math.round(offsetMeters),
            distanceToRouteM: Math.round(distanceToRouteM),
          };
        })
        .sort((a, b) => a.offsetMeters - b.offsetMeters); // §2.1 шаг 5 — "по пути", по расстоянию вдоль маршрута
    } catch (err) {
      // Тот же деградаційний принцип, що вже findCandidatesNearPoint у cameras.service.ts —
      // якщо PostGIS-міграція (geo-migration.sql) ще не прогнана, порожній список, не 500.
      this.logger.warn(`findCamerasAlongRoute PostGIS query failed (geo-migration.sql применена?): ${(err as Error).message}`);
      return [];
    }
  }

  // §7.1 ТЗ — "погода: можно брать ближайшую опорную точку к каждому сегменту маршрута (или
  // просто к городу... — упрощение, приемлемое для MVP)". Берём САМОЕ простое из двух явно
  // допущенных упрощений — ближайшую опорную точку к точке маршрута с "серединным" индексом
  // (route[Math.floor(route.length / 2)], ⚠️ ТОЧНО НЕ геометрическое среднее первой/последней
  // точки — уточнено аудитом 2026-08-06, прежний комментарий тут был неточным; для маршрута с
  // неравномерно распределёнными по длине точками "срединный индекс" может заметно отличаться от
  // истинного географического центра, но остаётся разумным приближением — не отдельным SQL/API
  // запросом на сегмент) — а не к каждому сегменту отдельно.
  private async findNearestWeather(route: LatLng[]): Promise<WeatherPoint | null> {
    if (route.length === 0) return null;
    const mid = route[Math.floor(route.length / 2)];

    const points = await this.weather.getSnapshot();
    if (points.length === 0) return null;

    let best = points[0];
    let bestDist = haversineDistance(mid, best);
    for (const p of points.slice(1)) {
      const d = haversineDistance(mid, p);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  // §7.1 ТЗ — вручную заведённые инциденты (RoadIncidentsService), фильтр route-aware: точка
  // инцидента попадает в тот же буфер, что уже используется для камер (тот же приём). У
  // RoadIncident нет PostGIS-геометрии (просто lat/lng, см. schema.prisma) — фильтруем в JS
  // через уже существующий nearestPointOnRoute(), не отдельным SQL-запросом.
  private async findIncidentsAlongRoute(route: LatLng[]): Promise<IncidentAlongRoute[]> {
    if (route.length < 2) return [];
    const active = await this.roadIncidents.listActive();

    return active
      .map((i) => {
        const { offsetMeters, distanceToRouteM } = nearestPointOnRoute(route, { lat: i.lat, lng: i.lng });
        return { i, offsetMeters, distanceToRouteM };
      })
      .filter((x) => x.distanceToRouteM <= INCIDENT_BUFFER_METERS)
      .sort((a, b) => a.offsetMeters - b.offsetMeters)
      .map(({ i, offsetMeters, distanceToRouteM }) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        title: i.title,
        description: i.description,
        lat: i.lat,
        lng: i.lng,
        offsetMeters: Math.round(offsetMeters),
        distanceToRouteM: Math.round(distanceToRouteM),
      }));
  }

  // §7.2 ТЗ — "Логика выбора источника в коде: по городу маршрута (citySlug/штат) — для
  // Нью-Йорка... 511NY; для городов вне зоны покрытия 511NY — в TomTom (если он подключён)".
  // Ни одна из точек маршрута не привязана к City-записи (маршрут строится по свободным
  // координатам, не по городскому справочнику) — решаем грубым bbox-приближением штата Нью-
  // Йорк (см. NY_STATE_BBOX выше), а не точным геокодингом штата/округа (не запрошено, не
  // реализовано).
  private async findTrafficAlongRoute(route: LatLng[]): Promise<TrafficForecast> {
    if (route.length < 2) return { source: null, configured: false, events: [] };

    const routeTouchesNyState = route.some(
      (p) => p.lat >= NY_STATE_BBOX.minLat && p.lat <= NY_STATE_BBOX.maxLat && p.lng >= NY_STATE_BBOX.minLng && p.lng <= NY_STATE_BBOX.maxLng,
    );

    if (routeTouchesNyState) {
      if (!this.five11ny.isConfigured()) {
        return { source: '511NY', configured: false, events: [] };
      }
      const events = await this.five11ny.getEvents();
      const filtered = events
        .map((e) => {
          const { offsetMeters, distanceToRouteM } = nearestPointOnRoute(route, { lat: e.lat, lng: e.lng });
          return { e, offsetMeters, distanceToRouteM };
        })
        .filter((x) => x.distanceToRouteM <= INCIDENT_BUFFER_METERS)
        .sort((a, b) => a.offsetMeters - b.offsetMeters)
        .map(({ e, offsetMeters, distanceToRouteM }) => ({
          id: e.id,
          lat: e.lat,
          lng: e.lng,
          description: e.description ?? e.roadwayName,
          severityLabel: e.severity,
          offsetMeters: Math.round(offsetMeters),
          distanceToRouteM: Math.round(distanceToRouteM),
        }));
      return { source: '511NY', configured: true, events: filtered };
    }

    // Вне (грубо приближённого) штата Нью-Йорк — фоллбэк TomTom (§7.2 fallback), если настроен.
    if (!this.tomtom.isConfigured()) {
      return { source: 'TomTom', configured: false, events: [] };
    }

    const bbox = this.routeBoundingBox(route, INCIDENT_BUFFER_METERS);
    const tomtomIncidents = await this.tomtom.getIncidents(bbox);
    const filtered = tomtomIncidents
      .map((t) => {
        const { offsetMeters, distanceToRouteM } = nearestPointOnRoute(route, { lat: t.lat, lng: t.lng });
        return { t, offsetMeters, distanceToRouteM };
      })
      .filter((x) => x.distanceToRouteM <= INCIDENT_BUFFER_METERS)
      .sort((a, b) => a.offsetMeters - b.offsetMeters)
      .map(({ t, offsetMeters, distanceToRouteM }) => ({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        description: t.description ?? t.iconCategoryLabel,
        severityLabel: t.magnitudeLabel,
        offsetMeters: Math.round(offsetMeters),
        distanceToRouteM: Math.round(distanceToRouteM),
      }));
    return { source: 'TomTom', configured: true, events: filtered };
  }

  // Прямоугольник вокруг всех точек маршрута + запас в метрах — для TomTom, которому (в отличие
  // от 511NY) нужен bbox на каждый запрос (§7.2 ТЗ, тот же комментарий, что уже
  // TomTomTrafficService про необходимость bbox). Не переиспользует
  // `centerRadiusToBoundingBox()` (тоже из tomtom.service.ts) — та функция рассчитана на ОДНУ
  // точку+радиус (админка, произвольный центр), а не на прямоугольник вдоль всей линии маршрута.
  private routeBoundingBox(route: LatLng[], paddingMeters: number): BoundingBox {
    let minLat = route[0].lat;
    let maxLat = route[0].lat;
    let minLng = route[0].lng;
    let maxLng = route[0].lng;
    for (const p of route) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const padDeg = paddingMeters / 111320;
    return { minLat: minLat - padDeg, maxLat: maxLat + padDeg, minLng: minLng - padDeg, maxLng: maxLng + padDeg };
  }

  // §4.3 ТЗ — "не отдельная задача — уже решена POST /lookahead... нужно только правильно
  // собрать points: [{lat,lng,timestampOffsetSeconds}]". Средняя скорость — из уже построенного
  // маршрута (distanceMeters/durationSeconds, реальная оценка ORS для выбранного профиля, а не
  // придуманная константа) — timestampOffsetSeconds для каждой точки = накопленное расстояние
  // от начала маршрута / средняя скорость.
  private async findFixedRouteEncounters(route: LatLng[], distanceMeters: number, durationSeconds: number): Promise<FixedRouteEncounterAlongRoute[]> {
    if (route.length < 2) return [];

    const avgSpeedMps = distanceMeters > 0 && durationSeconds > 0 ? distanceMeters / durationSeconds : 5; // ⚠️ ЧЕСНО: 5 м/с — грубый фоллбэк (ходьба/медленная езда), используется только если ORS вернул нулевые distance/duration (не должно происходить в норме)

    const points = this.buildTimestampedPoints(route, avgSpeedMps);

    const fixedRouteCameras = await this.prisma.camera.findMany({
      where: { mobilityType: 'FIXED_ROUTE', deletedAt: null },
    });
    if (fixedRouteCameras.length === 0) return [];

    const mapped = fixedRouteCameras.map((c) => toFixedRouteCamera(c as any));
    const encounters = this.lookAhead.predictRouteMeetings(points, mapped);

    const byId = new Map(fixedRouteCameras.map((c) => [c.id, c]));
    return encounters.map((e) => {
      const camera = byId.get(e.cameraId)!;
      return {
        cameraId: e.cameraId,
        name: camera.name,
        streamUrl: camera.streamUrl,
        streamType: camera.streamType,
        etaSeconds: e.etaSeconds,
        distanceMeters: e.distanceMeters,
        confidence: e.confidence,
        cameraLat: e.cameraPosition.lat,
        cameraLng: e.cameraPosition.lng,
        cameraAzimuth: e.cameraPosition.azimuth,
        cameraSpeed: e.cameraPosition.speedMps,
      };
    });
  }

  // Даунсэмплинг + расчёт timestampOffsetSeconds — см. комментарий у MAX_LOOKAHEAD_POINTS выше.
  private buildTimestampedPoints(route: LatLng[], avgSpeedMps: number): UserRoutePoint[] {
    const sampled = this.downsampleRoute(route, MAX_LOOKAHEAD_POINTS);
    let cumulativeMeters = 0;
    const points: UserRoutePoint[] = [{ ...sampled[0], timestampOffsetSeconds: 0 }];
    for (let i = 1; i < sampled.length; i++) {
      cumulativeMeters += haversineDistance(sampled[i - 1], sampled[i]);
      points.push({ ...sampled[i], timestampOffsetSeconds: cumulativeMeters / avgSpeedMps });
    }
    return points;
  }

  private downsampleRoute(route: LatLng[], maxPoints: number): LatLng[] {
    if (route.length <= maxPoints) return route;
    const step = (route.length - 1) / (maxPoints - 1);
    const sampled: LatLng[] = [];
    for (let i = 0; i < maxPoints; i++) {
      sampled.push(route[Math.round(i * step)]);
    }
    return sampled;
  }
}

import { Injectable, Logger } from '@nestjs/common';

// OpenRouteService Directions API v2 — за прямим запитом користувача: «маршрутизация не
// вызывается — ключа OpenRouteService пока нет (§6.3) исправь» (doc/TZ-btw-route-planning.md
// §6.1/§6.3, рішення "OpenRouteService" зафіксоване раніше в цій же сесії). Це РЕАЛЬНИЙ виклик
// зовнішнього API (POST /v2/directions/{profile}, plain-JSON варіант — НЕ /geojson), а не
// заглушка — на відміну від попереднього кроку (app/page.tsx::handleBuildRoute() раніше лише
// показував чесне повідомлення "ключа ще немає").
//
// ⚠️ ЧЕСНО — цей клієнт НЕ був живо протестований проти справжнього OpenRouteService API в
// цьому сендбоксі (немає мережевого доступу для реального HTTP-виклику під час написання
// коду) — на відміну від 511NY (five11ny.service.ts), який БУВ живо перевірений раніше в цій
// сесії. Схема запиту/відповіді нижче — з офіційної документації ORS (endpoint, авторизація,
// поля запиту/відповіді, коди помилок, формат encoded polyline) та дослідницького агента перед
// написанням цього файлу, той самий рівень впевненості, що вже був чесно позначений для
// TomTomTrafficService ("схема з документації, не живо перевірена"). Якщо реальний виклик
// поверне щось, що не відповідає очікуваній схемі — parseRouteResponse() нижче кине
// OpenRouteServiceError('upstream_error', ...) замість мовчазного падіння з незрозумілим стеком.

export type RoutingProfile = 'driving-car' | 'cycling-regular' | 'foot-walking';

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteResult {
  points: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
}

export type OpenRouteServiceErrorKind =
  | 'not_configured' // ключ не заданий (OPENROUTESERVICE_API_KEY порожній)
  | 'rate_limited' // локальний троттлінг (40/хв) АБО ORS повернув 429/403-квоту
  | 'no_route' // ORS не зміг побудувати маршрут між точками (code 2009) чи не знайшов точку (2010/404)
  | 'invalid_key' // 401 від ORS
  | 'upstream_error'; // будь-яка інша мережева/HTTP/парсингова помилка

export class OpenRouteServiceError extends Error {
  constructor(
    public readonly kind: OpenRouteServiceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouteServiceError';
  }
}

const API_BASE = 'https://api.openrouteservice.org/v2/directions';
const FETCH_TIMEOUT_MS = 12_000;

// Docs-confirmed ліміти (§ дослідження перед цим кодом) — 2000 запитів/день, 40/хв. Денний
// ліміт НЕ відстежується тут (немає персистентного лічильника, той самий чесний компроміс, що
// вже в TomTomTrafficService для місячної квоти) — лише простий ковзний лічильник на хвилину,
// щоб один зациклений клієнт не спалив запас за секунди; ORS сам поверне 429/403, якщо ліміт
// таки вичерпано (upstream — джерело істини, локальний троттлінг лише "перший рубіж").
const RATE_LIMIT_PER_MINUTE = 40;
const RATE_LIMIT_WINDOW_MS = 60_000;

@Injectable()
export class OpenRouteServiceClient {
  private readonly logger = new Logger(OpenRouteServiceClient.name);
  private readonly apiKey = process.env.OPENROUTESERVICE_API_KEY;

  // ⚠️ ЧЕСНО: in-process лічильник, той самий каveat, що вже в TomTomTrafficService/
  // WeatherService — на Vercel serverless (кілька холодних інстансів) це НЕ гарантує глобальний
  // ліміт 40/хв, лише знижує ризик у межах одного "теплого" інстансу.
  private requestTimestamps: number[] = [];

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getRoute(pointA: RoutePoint, pointB: RoutePoint, profile: RoutingProfile): Promise<RouteResult> {
    if (!this.apiKey) {
      throw new OpenRouteServiceError('not_configured', 'OPENROUTESERVICE_API_KEY не задан — см. .env.example и doc/TZ-btw-route-planning.md §6.3');
    }

    this.enforceLocalRateLimit();

    const url = `${API_BASE}/${profile}`;
    // ORS — координати в порядку [lon, lat] (НЕ [lat, lng], як у більшості цього проєкту, той
    // самий клас помилки, що вже задокументований для TomTom bbox) — instructions:false, бо
    // покроковий текстовий опис маршруту тут не потрібен (лише лінія + відстань/час, §6 ТЗ).
    const body = {
      coordinates: [
        [pointA.lng, pointA.lat],
        [pointB.lng, pointB.lat],
      ],
      instructions: false,
    };

    let res: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            // Сира авторизація — саме "Authorization: <ключ>", БЕЗ префіксу "Bearer " (docs-
            // confirmed, § дослідження — ORS відрізняється тут від типового Bearer-токена).
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new OpenRouteServiceError('upstream_error', `OpenRouteService network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      throw await this.buildHttpError(res);
    }

    const raw = await res.json().catch(() => null);
    return this.parseRouteResponse(raw);
  }

  private enforceLocalRateLimit(): void {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (this.requestTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
      throw new OpenRouteServiceError('rate_limited', 'Локальный лимит OpenRouteService (40/мин) исчерпан — попробуйте через минуту');
    }
    this.requestTimestamps.push(now);
  }

  private async buildHttpError(res: Response): Promise<OpenRouteServiceError> {
    const raw = await res.json().catch(() => null as any);
    const code = raw?.error?.code;
    const message = typeof raw?.error?.message === 'string' ? raw.error.message : `HTTP ${res.status}`;

    if (res.status === 401) {
      return new OpenRouteServiceError('invalid_key', `OpenRouteService: неверный ключ (401) — ${message}`);
    }
    if (res.status === 429 || res.status === 403) {
      return new OpenRouteServiceError('rate_limited', `OpenRouteService: превышен лимит запросов (${res.status}) — ${message}`);
    }
    // 2009 — "route could not be found between locations", 2010 — "point was not found"
    // (docs-confirmed, зазвичай приходить з HTTP 404 для 2010, але перевіряємо саме код
    // помилки, а не лише статус — стійкіше до дрібних розбіжностей у документації).
    if (code === 2009 || code === 2010 || res.status === 404) {
      return new OpenRouteServiceError('no_route', `OpenRouteService: маршрут не найден — ${message}`);
    }
    return new OpenRouteServiceError('upstream_error', `OpenRouteService HTTP ${res.status}: ${message}`);
  }

  private parseRouteResponse(raw: any): RouteResult {
    const route = raw?.routes?.[0];
    if (!route || typeof route.geometry !== 'string' || !route.summary) {
      this.logger.warn(`OpenRouteService: unexpected response shape — ${JSON.stringify(raw)?.slice(0, 500)}`);
      throw new OpenRouteServiceError('upstream_error', 'OpenRouteService вернул неожиданный формат ответа');
    }

    const distanceMeters = Number(route.summary.distance);
    const durationSeconds = Number(route.summary.duration);
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      throw new OpenRouteServiceError('upstream_error', 'OpenRouteService вернул нечисловые distance/duration');
    }

    return {
      points: decodePolyline(route.geometry),
      distanceMeters,
      durationSeconds,
    };
  }
}

// Стандартний Google Encoded Polyline Algorithm Format, precision 5 (той самий, що ORS
// використовує за замовчуванням для поля `geometry` у plain-JSON відповіді, docs-confirmed).
// Написано вручну, а не через npm-пакет — немає мережевого доступу для встановлення пакета в
// цьому сендбоксі (той самий компроміс, що вже пояснений біля PMTiles у btw.service.ts).
// Публічний, добре відомий алгоритм — https://developers.google.com/maps/documentation/utilities/polylinealgorithm.
export function decodePolyline(encoded: string, precision = 5): RoutePoint[] {
  const factor = Math.pow(10, precision);
  const points: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / factor, lng: lng / factor });
  }

  return points;
}

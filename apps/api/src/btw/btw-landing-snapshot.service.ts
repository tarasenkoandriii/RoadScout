import { Injectable, Logger } from '@nestjs/common';
import { WeatherService } from '../situational/weather.service';
import { FiveElevenNyService } from '../situational/five11ny.service';
import { TomTomTrafficService, centerRadiusToBoundingBox } from '../situational/tomtom.service';
import { haversineDistance } from '../common/geometry.util';

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 («интерактивность по айпи
// посетителя - погода и инциденты по городу - возможно дорожную ситуацию по tom-tom»), розділ
// 3.3 («Новый эндпоинт»). Це — сервіс, що обслуговує ПУБЛІЧНИЙ, анонімний ендпоінт для нового
// лендингу `apps/interactive`, а НЕ вже наявний `BtwRouteForecastService` (той накладає прогноз
// на конкретний ПОБУДОВАНИЙ маршрут користувача мінІ-аппа; тут немає ні маршруту, ні
// авторизованого користувача — лише «місто відвідувача лендингу», один довільний lat/lng).
// Тому — окремий, свідомо простіший сервіс, що перевикористовує ті самі провайдери
// (WeatherService/FiveElevenNyService/TomTomTrafficService), а не сам BtwRouteForecastService.
//
// Той самий принцип деградації по джерелу, що вже в BtwRouteForecastService.safeForecast() —
// падіння погоди не повинно гасити інциденти і навпаки (§3.6 ТЗ: секція на лендингу повинна
// вміти чесно показати «даних немає», не мовчки зникнути чи впасти цілком).

// Груба апроксимація меж штату Нью-Йорк прямокутником — той самий NY_STATE_BBOX, що вже
// перевірений і задокументований у btw-route-forecast.service.ts (§7.2 ТЗ: не справжній контур
// штату, лише щоб вирішити, 511NY чи TomTom обслуговує цю точку). Продубльовано тут навмисно
// (не імпортовано з btw-route-forecast.service.ts) — там це приватна деталь одного конкретного
// сервісу для маршрутів, а не публічний спільний контракт; дублювання одного невеликого
// прямокутника дешевше, ніж зв'язувати два концептуально різні сервіси через спільний імпорт.
const NY_STATE_BBOX = { minLat: 40.45, maxLat: 45.05, minLng: -79.9, maxLng: -71.75 };

// Радіус, у якому інцидент вважається «поруч» із відвідувачем лендингу — ширше, ніж
// INCIDENT_BUFFER_METERS у btw-route-forecast.service.ts (там це «наскільки вбік від лінії
// маршруту», тут — «наскільки далеко від міста взагалі», інша задача, тому інше число).
// Не зафіксовано в ТЗ явним числом — 40км обрано як «сусідні райони того ж міста/агломерації»,
// не наукове значення.
const INCIDENT_RADIUS_KM = 40;
const MAX_INCIDENTS = 6;

export interface LandingSnapshotIncident {
  id: string;
  source: '511NY' | 'TomTom';
  title: string;
  severity: string;
  distanceKm: number;
}

export interface LandingWeatherSummary {
  available: boolean;
  tempC: number | null;
  conditionLabel: string;
  isHazard: boolean;
}

export interface LandingIncidentsSummary {
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  items: LandingSnapshotIncident[];
  // ДОДАНО (§3.3 ТЗ — «coverageNote... обов'язкове, не опціональне») — чому саме items
  // порожній/непорожній, щоб фронт міг чесно показати причину, а не просто "нічого немає".
  coverageNote: 'ny-state' | 'tomtom' | 'not-configured';
}

export interface LandingSnapshot {
  cityLabel: string;
  weather: LandingWeatherSummary;
  incidents: LandingIncidentsSummary;
}

@Injectable()
export class BtwLandingSnapshotService {
  private readonly logger = new Logger(BtwLandingSnapshotService.name);

  constructor(
    private readonly weather: WeatherService,
    private readonly fiveElevenNy: FiveElevenNyService,
    private readonly tomTom: TomTomTrafficService,
  ) {}

  async getSnapshot(lat: number, lng: number, cityLabel: string): Promise<LandingSnapshot> {
    const [weather, incidents] = await Promise.all([
      this.safeCall('weather', () => this.getWeather(lat, lng, cityLabel), this.emptyWeather()),
      this.safeCall('incidents', () => this.getIncidents(lat, lng), this.emptyIncidents()),
    ]);
    return { cityLabel, weather, incidents };
  }

  // Той самий паттерн, що BtwRouteForecastService.safeForecast() — окремий try/catch НА КОЖНЕ
  // джерело, а не один спільний Promise.all без обробки (§3.6 ТЗ — секція повинна деградувати
  // частково, не гаситись цілком через один збій).
  private async safeCall<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`${label} failed for landing snapshot, degrading to fallback: ${(err as Error).message}`);
      return fallback;
    }
  }

  private async getWeather(lat: number, lng: number, cityLabel: string): Promise<LandingWeatherSummary> {
    const point = await this.weather.getPointWeather({ name: cityLabel, lat, lng });
    if (point.error || point.tempC === null) {
      return this.emptyWeather();
    }
    return { available: true, tempC: point.tempC, conditionLabel: point.conditionLabel, isHazard: point.isHazard };
  }

  private emptyWeather(): LandingWeatherSummary {
    return { available: false, tempC: null, conditionLabel: 'Нет данных', isHazard: false };
  }

  private emptyIncidents(): LandingIncidentsSummary {
    return { source: null, configured: false, items: [], coverageNote: 'not-configured' };
  }

  private isInNyState(lat: number, lng: number): boolean {
    return lat >= NY_STATE_BBOX.minLat && lat <= NY_STATE_BBOX.maxLat && lng >= NY_STATE_BBOX.minLng && lng <= NY_STATE_BBOX.maxLng;
  }

  private async getIncidents(lat: number, lng: number): Promise<LandingIncidentsSummary> {
    // §7.2 ТЗ route-planning (переспользовано тут — §3.4 ТЗ лендингу v2): 511NY — єдиний живий
    // фід НА ВЕСЬ ШТАТ Нью-Йорк, без параметрів запиту, тому в межах NY_STATE_BBOX саме він, а
    // не TomTom, і фільтрація по відстані відбувається вже ПІСЛЯ отримання повного фіду (на
    // відміну від TomTom нижче, де bbox передається в сам запит).
    if (this.isInNyState(lat, lng)) {
      if (!this.fiveElevenNy.isConfigured()) {
        return { source: '511NY', configured: false, items: [], coverageNote: 'not-configured' };
      }
      const events = await this.fiveElevenNy.getEvents();
      const nearby = events
        .map((e) => ({ event: e, distanceKm: haversineDistance({ lat, lng }, { lat: e.lat, lng: e.lng }) / 1000 }))
        .filter((x) => x.distanceKm <= INCIDENT_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, MAX_INCIDENTS);
      return {
        source: '511NY',
        configured: true,
        coverageNote: 'ny-state',
        items: nearby.map(({ event, distanceKm }) => ({
          id: event.id,
          source: '511NY' as const,
          title: event.description ?? event.eventType,
          severity: event.severity,
          distanceKm: Math.round(distanceKm * 10) / 10,
        })),
      };
    }

    if (!this.tomTom.isConfigured()) {
      return { source: 'TomTom', configured: false, items: [], coverageNote: 'not-configured' };
    }
    const bbox = centerRadiusToBoundingBox(lat, lng, INCIDENT_RADIUS_KM);
    const incidents = await this.tomTom.getIncidents(bbox);
    return {
      source: 'TomTom',
      configured: true,
      coverageNote: 'tomtom',
      items: incidents.slice(0, MAX_INCIDENTS).map((incident) => ({
        id: incident.id,
        source: 'TomTom' as const,
        title: incident.description ?? incident.iconCategoryLabel,
        severity: incident.magnitudeLabel,
        distanceKm: Math.round((haversineDistance({ lat, lng }, { lat: incident.lat, lng: incident.lng }) / 1000) * 10) / 10,
      })),
    };
  }
}

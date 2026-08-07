import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CitiesService } from '../cities/cities.service';

// Опорные точки для сводки погоды: раньше — только Київ + сателлитные городки області,
// теперь — все города из справочника City (см. doc/README.md, "Города Украины"), чтобы
// ситуационная осведомленность покрывала всю Украину, а не только Київську область. Список не
// хардкодится тут — City.list() уже содержит имя/координаты каждого города, единая точка
// правды (та же таблица, что и для выпадающего списка на публичном поиске).
interface ReferencePoint {
  name: string;
  lat: number;
  lng: number;
}

// ДОДАНО за прямим запитом користувача (doc/TZ-btw-landing-v2.md — "добавить значок ясно/
// осадки и тд" до IP-віджета лендингу apps/interactive) — категорія іконки для рендеру на
// фронтенді. Свідомо ОКРЕМИЙ, менш деталізований набір, ніж текстові `label` нижче (наприклад
// "Дощ слабкий"/"Дощ сильний" — це один і той самий `iconKind: 'rain'`, різниця в силі опадів
// відображається текстом, не окремою іконкою) — фронтенд не повинен тримати копію WMO-таблиці
// лише заради вибору картинки.
export type WeatherIconKind = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'thunderstorm';

// WMO weather codes (используются Open-Meteo) -> человекочитаемая метка + признак "опасно для
// дорог" (туман/гололедица/сильный дождь/гроза — то, что должно привлечь внимание на карте) +
// категория иконки (см. WeatherIconKind выше).
const WEATHER_CODE_INFO: Record<number, { label: string; hazard: boolean; icon: WeatherIconKind }> = {
  0: { label: 'Ясно', hazard: false, icon: 'clear' },
  1: { label: 'Малооблачно', hazard: false, icon: 'partly-cloudy' },
  2: { label: 'Переменная облачность', hazard: false, icon: 'partly-cloudy' },
  3: { label: 'Пасмурно', hazard: false, icon: 'cloudy' },
  45: { label: 'Туман', hazard: true, icon: 'fog' },
  48: { label: 'Изморозь/туман', hazard: true, icon: 'fog' },
  51: { label: 'Морось слабая', hazard: false, icon: 'drizzle' },
  53: { label: 'Морось умеренная', hazard: false, icon: 'drizzle' },
  55: { label: 'Морось сильная', hazard: true, icon: 'drizzle' },
  56: { label: 'Ледяная морось слабая', hazard: true, icon: 'drizzle' },
  57: { label: 'Ледяная морось сильная', hazard: true, icon: 'drizzle' },
  61: { label: 'Дождь слабый', hazard: false, icon: 'rain' },
  63: { label: 'Дождь умеренный', hazard: false, icon: 'rain' },
  65: { label: 'Дождь сильный', hazard: true, icon: 'rain' },
  66: { label: 'Ледяной дождь слабый', hazard: true, icon: 'rain' },
  67: { label: 'Ледяной дождь сильный', hazard: true, icon: 'rain' },
  71: { label: 'Снег слабый', hazard: false, icon: 'snow' },
  73: { label: 'Снег умеренный', hazard: true, icon: 'snow' },
  75: { label: 'Снег сильный', hazard: true, icon: 'snow' },
  77: { label: 'Снежная крупа', hazard: true, icon: 'snow' },
  80: { label: 'Ливень слабый', hazard: false, icon: 'showers' },
  81: { label: 'Ливень умеренный', hazard: true, icon: 'showers' },
  82: { label: 'Ливень сильный', hazard: true, icon: 'showers' },
  85: { label: 'Снегопад слабый', hazard: true, icon: 'snow' },
  86: { label: 'Снегопад сильный', hazard: true, icon: 'snow' },
  95: { label: 'Гроза', hazard: true, icon: 'thunderstorm' },
  96: { label: 'Гроза с градом', hazard: true, icon: 'thunderstorm' },
  99: { label: 'Сильная гроза с градом', hazard: true, icon: 'thunderstorm' },
};

export interface WeatherPoint {
  name: string;
  lat: number;
  lng: number;
  tempC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  visibilityM: number | null;
  weatherCode: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  observedAt: string | null;
  error?: string; // this point's own fetch failed — surfaced per-point rather than failing the whole snapshot
}

// ДОДАНО за прямим запитом користувача — прогноз на 2 дні для IP-віджета лендингу
// (doc/TZ-btw-landing-v2.md, "добавить прогноз погоды на два дня"). Свідомо ОКРЕМИЙ тип від
// `WeatherPoint` (а не "той самий WeatherPoint з масивом днів") — денний прогноз Open-Meteo
// віддає лише max/min температуру й один weather_code на добу, не весь набір полів поточних
// умов (вологість/вітер/видимість), тож змішувати їх в один тип було б оманливо (виглядало б,
// ніби прогноз має ті самі поля, що й "зараз").
export interface WeatherForecastDay {
  dateIso: string; // YYYY-MM-DD, локальна дата ТОЧКИ (не сервера) — див. timezone=auto нижче
  weatherCode: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  tempMaxC: number | null;
  tempMinC: number | null;
}

interface CacheEntry {
  data: WeatherPoint[];
  expiresAt: number;
}

interface PointCacheEntry {
  data: WeatherPoint;
  expiresAt: number;
}

interface ForecastCacheEntry {
  data: WeatherForecastDay[];
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут — сводка погоды не нужна свежее этого, а свободный API вежливо не долбить
const FETCH_TIMEOUT_MS = 8000;

// За прямим запитом користувача (doc/TZ-btw-landing-v2.md §3.3/§3.7) — окремий кеш саме для
// довільних координат (не з довідника `City`), ключ — округлені lat/lng, а не назва міста
// (назви від відвідувачів лендингу можуть повторюватись/бути неточними, координати — ні).
// TTL коротший за CACHE_TTL_MS вище — тут очікується набагато ширший розкид точок (кожне
// унікальне місто відвідувача), тримати їх довго в пам'яті сенсу менше, ніж фіксовану City-
// сітку зі снапшоту.
const POINT_CACHE_TTL_MS = 10 * 60 * 1000;
const POINT_CACHE_KEY_PRECISION = 1; // ~11км — досить грубо, щоб сусідні відвідувачі того ж міста ділили один запис кешу

// Прогноз на кілька днів вперед не потребує оновлення так часто, як поточні умови (10 хв
// вище) — довший TTL, менше зайвих викликів Open-Meteo для того самого візерунку відвідувачів.
const FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
const FORECAST_DAYS = 2; // "прогноз погоды на два дня" — за прямим запитом користувача

// Фоллбэк на случай пустого справочника City (например, свежая БД до прогона
// sql/cities-seed.sql) — чтобы сводка погоды не была пустой, а не потому что это "правильный"
// список городов (единственный источник правды — таблица City, см. комментарий выше).
const FALLBACK_POINT: ReferencePoint = { name: 'Київ', lat: 50.4501, lng: 30.5234 };

// NOTE (известное упрощение, см. doc/): кэш — обычный in-process Map, как и в
// FixedRoutePositionService. На Vercel serverless это означает отдельный кэш на каждый холодный
// инстанс — по-прежнему корректно, просто не разделяется между тёплыми инстансами.
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache: CacheEntry | null = null;
  private readonly pointCache = new Map<string, PointCacheEntry>();
  private readonly forecastCache = new Map<string, ForecastCacheEntry>();

  constructor(private readonly cities: CitiesService) {}

  async getSnapshot(): Promise<WeatherPoint[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.data;
    }

    const referencePoints = await this.getReferencePoints();
    const points = await Promise.all(referencePoints.map((p) => this.fetchOne(p)));
    this.cache = { data: points, expiresAt: now + CACHE_TTL_MS };
    return points;
  }

  // ДОДАНО за прямим запитом користувача (doc/TZ-btw-landing-v2.md §3.3, відкрите питання §3.7,
  // вирішене на користь варіанту (а) — розширити WeatherService на довільні координати, а не
  // обмежувати IP-віджет лендингу лише містами з довідника `City`). Публічна обгортка над вже
  // наявним `fetchOne()` — той самий провайдер (Open-Meteo) і той самий формат `WeatherPoint`
  // (включно з `error` при збої), просто для точки, якої може не бути в довіднику `City` —
  // жодних змін у `getSnapshot()`/`getReferencePoints()` не знадобилось.
  async getPointWeather(point: { name: string; lat: number; lng: number }): Promise<WeatherPoint> {
    const key = this.buildPointCacheKey(point.lat, point.lng);
    const now = Date.now();
    const cached = this.pointCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const data = await this.fetchOne(point);
    this.pointCache.set(key, { data, expiresAt: now + POINT_CACHE_TTL_MS });
    return data;
  }

  private buildPointCacheKey(lat: number, lng: number): string {
    return `${lat.toFixed(POINT_CACHE_KEY_PRECISION)},${lng.toFixed(POINT_CACHE_KEY_PRECISION)}`;
  }

  // ДОДАНО за прямим запитом користувача (doc/TZ-btw-landing-v2.md, "добавить прогноз погоды
  // на два дня") — окремий виклик Open-Meteo з `daily=...` замість `current=...`. Свідомо
  // `timezone=auto` (НЕ жорстко закодований 'Europe/Kyiv', як у `fetchOne()` вище) — той метод
  // обслуговує лише українські міста з довідника `City`, а цей — відвідувача лендингу з БУДЬ-
  // ЯКОЮ точкою світу; денні межі прогнозу (що вважається "сьогодні"/"завтра") мають рахуватись
  // від ЛОКАЛЬНОГО часового поясу цієї точки, інакше дата могла б "з'їхати" на добу для
  // відвідувачів з інших часових поясів.
  async getPointForecast(point: { lat: number; lng: number }): Promise<WeatherForecastDay[]> {
    const key = this.buildPointCacheKey(point.lat, point.lng);
    const now = Date.now();
    const cached = this.forecastCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: point.lat,
          longitude: point.lng,
          daily: 'weather_code,temperature_2m_max,temperature_2m_min',
          forecast_days: FORECAST_DAYS,
          timezone: 'auto',
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      const daily = res.data?.daily ?? {};
      const dates: string[] = daily.time ?? [];
      const codes: (number | null)[] = daily.weather_code ?? [];
      const maxTemps: (number | null)[] = daily.temperature_2m_max ?? [];
      const minTemps: (number | null)[] = daily.temperature_2m_min ?? [];

      const days: WeatherForecastDay[] = dates.map((dateIso, i) => {
        const code = codes[i] ?? null;
        const info = code !== null ? WEATHER_CODE_INFO[code] : undefined;
        return {
          dateIso,
          weatherCode: code,
          conditionLabel: info?.label ?? 'Нет данных',
          iconKind: info?.icon ?? null,
          isHazard: info?.hazard ?? false,
          tempMaxC: maxTemps[i] ?? null,
          tempMinC: minTemps[i] ?? null,
        };
      });

      this.forecastCache.set(key, { data: days, expiresAt: now + FORECAST_CACHE_TTL_MS });
      return days;
    } catch (err) {
      this.logger.warn(`Forecast fetch failed for ${key}: ${(err as Error).message}`);
      return []; // деградація — порожній прогноз, а не крах усього віджету (той самий принцип, що getSnapshot()/fetchOne())
    }
  }

  private async getReferencePoints(): Promise<ReferencePoint[]> {
    const cities = await this.cities.list();
    if (cities.length === 0) {
      this.logger.warn('City table is empty (has sql/cities-seed.sql been run?) — falling back to Kyiv only.');
      return [FALLBACK_POINT];
    }
    return cities.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng }));
  }

  private async fetchOne(point: ReferencePoint): Promise<WeatherPoint> {
    try {
      const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: point.lat,
          longitude: point.lng,
          current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,visibility',
          timezone: 'Europe/Kyiv',
        },
        timeout: FETCH_TIMEOUT_MS,
      });

      const current = res.data?.current ?? {};
      const code: number | null = current.weather_code ?? null;
      const info = code !== null ? WEATHER_CODE_INFO[code] : undefined;

      return {
        name: point.name,
        lat: point.lat,
        lng: point.lng,
        tempC: current.temperature_2m ?? null,
        precipitationMm: current.precipitation ?? null,
        windSpeedKmh: current.wind_speed_10m ?? null,
        visibilityM: current.visibility ?? null,
        weatherCode: code,
        conditionLabel: info?.label ?? 'Нет данных',
        iconKind: info?.icon ?? null,
        isHazard: info?.hazard ?? false,
        observedAt: current.time ?? null,
      };
    } catch (err) {
      this.logger.warn(`Weather fetch failed for ${point.name}: ${(err as Error).message}`);
      return {
        name: point.name,
        lat: point.lat,
        lng: point.lng,
        tempC: null,
        precipitationMm: null,
        windSpeedKmh: null,
        visibilityM: null,
        weatherCode: null,
        conditionLabel: 'Нет данных',
        iconKind: null,
        isHazard: false,
        observedAt: null,
        error: (err as Error).message,
      };
    }
  }
}

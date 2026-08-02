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

// WMO weather codes (используются Open-Meteo) -> человекочитаемая метка + признак "опасно для
// дорог" (туман/гололедица/сильный дождь/гроза — то, что должно привлечь внимание на карте).
const WEATHER_CODE_INFO: Record<number, { label: string; hazard: boolean }> = {
  0: { label: 'Ясно', hazard: false },
  1: { label: 'Малооблачно', hazard: false },
  2: { label: 'Переменная облачность', hazard: false },
  3: { label: 'Пасмурно', hazard: false },
  45: { label: 'Туман', hazard: true },
  48: { label: 'Изморозь/туман', hazard: true },
  51: { label: 'Морось слабая', hazard: false },
  53: { label: 'Морось умеренная', hazard: false },
  55: { label: 'Морось сильная', hazard: true },
  56: { label: 'Ледяная морось слабая', hazard: true },
  57: { label: 'Ледяная морось сильная', hazard: true },
  61: { label: 'Дождь слабый', hazard: false },
  63: { label: 'Дождь умеренный', hazard: false },
  65: { label: 'Дождь сильный', hazard: true },
  66: { label: 'Ледяной дождь слабый', hazard: true },
  67: { label: 'Ледяной дождь сильный', hazard: true },
  71: { label: 'Снег слабый', hazard: false },
  73: { label: 'Снег умеренный', hazard: true },
  75: { label: 'Снег сильный', hazard: true },
  77: { label: 'Снежная крупа', hazard: true },
  80: { label: 'Ливень слабый', hazard: false },
  81: { label: 'Ливень умеренный', hazard: true },
  82: { label: 'Ливень сильный', hazard: true },
  85: { label: 'Снегопад слабый', hazard: true },
  86: { label: 'Снегопад сильный', hazard: true },
  95: { label: 'Гроза', hazard: true },
  96: { label: 'Гроза с градом', hazard: true },
  99: { label: 'Сильная гроза с градом', hazard: true },
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
  isHazard: boolean;
  observedAt: string | null;
  error?: string; // this point's own fetch failed — surfaced per-point rather than failing the whole snapshot
}

interface CacheEntry {
  data: WeatherPoint[];
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут — сводка погоды не нужна свежее этого, а свободный API вежливо не долбить
const FETCH_TIMEOUT_MS = 8000;

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
        isHazard: false,
        observedAt: null,
        error: (err as Error).message,
      };
    }
  }
}

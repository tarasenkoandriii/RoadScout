import { Injectable, Logger } from '@nestjs/common';

// TomTom Traffic Incidents API (v5, "incidentDetails") — за прямим запитом користувача:
// "реализовать TomTom Traffic API — fallback/дополнение вне NY State" (doc/TZ-btw-route-
// planning.md §7.2/§9 п.5) — другий джерело трафіку поруч із 511NY (five11ny.service.ts). На
// відміну від 511NY (один живий фід на весь штат, без параметрів запиту), TomTom вимагає bbox
// (географічну прив'язку) у КОЖНОМУ запиті — тому цей сервіс, на відміну від FiveElevenNyService,
// не має єдиного "getEvents() для всього", а приймає bbox від виклику (§7.2 ТЗ: "TomTom ...
// глобальне покриття — корисно, якщо проект розшириться за межі Нью-Йорка на міста, де
// 511NY-аналога немає" — тобто виклик завжди прив'язаний до конкретного міста/маршруту поза
// NY State, не до "всього світу одним запитом").
//
// Свідомо НЕ використовуємо v4 (задокументовано TomTom як deprecated) і НЕ Orbis v2 (новий
// ребрендинг платформи, інша схема відповіді/аутентифікації, не відповідає безкоштовному тарифу,
// під який рахувались ліміти в §7.2 ТЗ) — лише класичний v5, як і досліджено окремим агентом
// перед написанням цього файлу.

export interface TomTomIncident {
  id: string;
  lat: number;
  lng: number;
  iconCategory: number;
  iconCategoryLabel: string;
  magnitudeOfDelay: number;
  magnitudeLabel: string;
  description: string | null;
  roadNumbers: string[];
  from: string | null;
  to: string | null;
  lengthMeters: number | null;
  delaySeconds: number | null;
  startTime: string | null;
  endTime: string | null;
  probabilityOfOccurrence: string | null;
  source: 'TomTom';
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

// Docs-confirmed (§ дослідження перед цим кодом) — TomTom v5 bbox ЛОН-перший
// (minLon,minLat,maxLon,maxLat), НЕ лат-перший, як 511NY координати чи звичний "lat,lng"
// порядок в решті цього проєкту (наприклад ObserverPose у btw-geometry-engine.ts) — джерело
// типової помилки, тому конвертація винесена в окрему функцію з явним коментарем, а не
// вставлена інлайном у URL.
function bboxToTomTomParam(bbox: BoundingBox): string {
  return `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
}

// Docs-confirmed мапи (§ дослідження) — 12 і 13 навмисно відсутні (так задокументовано в
// TomTom, не помилка тут).
const ICON_CATEGORY_LABEL: Record<number, string> = {
  0: 'Неизвестно',
  1: 'ДТП',
  2: 'Туман',
  3: 'Опасные условия',
  4: 'Дождь',
  5: 'Гололёд',
  6: 'Затор',
  7: 'Перекрыта полоса',
  8: 'Дорога закрыта',
  9: 'Дорожные работы',
  10: 'Ветер',
  11: 'Подтопление',
  14: 'Неисправное ТС',
};

const MAGNITUDE_LABEL: Record<number, string> = {
  0: 'Неизвестно',
  1: 'Незначительная',
  2: 'Умеренная',
  3: 'Серьёзная',
  4: 'Без оценки (закрытие дороги)',
};

// Сира форма properties одного incident-елемента v5 (GeoJSON-подібна, але НЕ справжній
// FeatureCollection — кореневий об'єкт `{incidents: [...]}`, підтверджено дослідженням).
interface RawTomTomIncident {
  type?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: {
    id?: unknown;
    iconCategory?: unknown;
    magnitudeOfDelay?: unknown;
    events?: { description?: unknown; code?: unknown; iconCategory?: unknown }[];
    startTime?: unknown;
    endTime?: unknown;
    from?: unknown;
    to?: unknown;
    length?: unknown;
    delay?: unknown;
    roadNumbers?: unknown;
    probabilityOfOccurrence?: unknown;
    [key: string]: unknown;
  };
}

const API_BASE = 'https://api.tomtom.com/traffic/services/5';
// Безкоштовний тариф — 2500 запитів/міс на Incidents (§7.2 ТЗ). На відміну від 511NY (де
// відомий ліміт "10/60с" дозволяє простий троттлінг за часом), місячна квота не відстежується
// тут ВЗАГАЛІ (немає персистентного лічильника — ⚠️ ЧЕСНО, див. коментар класу нижче) —
// кешування per-bbox нижче знижує кількість реальних викликів, але не гарантує, що місячний
// ліміт не буде вичерпаний при частому використанні адмінкою.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 хвилин — довше, ніж у 511NY (3 хв), свідомо: платний ресурс з жорсткішою місячною квотою, а не лише короткочасним лімітом на хвилину
const FETCH_TIMEOUT_MS = 10_000;
// Округлення bbox до цієї кількості знаків при побудові ключа кешу — щоб незначний зсув мапи
// адміном (кілька метрів) не вважався "новим" bbox і не спричиняв зайвий виклик API.
const CACHE_KEY_PRECISION = 2;

interface CacheEntry {
  data: TomTomIncident[];
  expiresAt: number;
}

@Injectable()
export class TomTomTrafficService {
  private readonly logger = new Logger(TomTomTrafficService.name);
  private readonly apiKey = process.env.TOMTOM_API_KEY;

  // Кеш по bbox, а не єдине значення (як у 511NY) — TomTom-запити завжди прив'язані до
  // конкретної локації, тож потрібен per-location кеш. Той самий чесний коментар, що і в
  // WeatherService/FiveElevenNyService: in-process Map, на Vercel serverless не спільний між
  // холодними інстансами.
  private cache = new Map<string, CacheEntry>();

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getIncidents(bbox: BoundingBox): Promise<TomTomIncident[]> {
    if (!this.apiKey) {
      this.logger.warn('TOMTOM_API_KEY is not set — TomTom incidents skipped (см. doc/TZ-btw-route-planning.md §7.2, fallback вне NY State)');
      return [];
    }

    const cacheKey = this.buildCacheKey(bbox);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const fields =
      '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,probabilityOfOccurrence}}}';
    const params = new URLSearchParams({
      key: this.apiKey,
      bbox: bboxToTomTomParam(bbox),
      fields,
      language: 'ru-RU',
      timeValidityFilter: 'present',
    });
    const url = `${API_BASE}/incidentDetails?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        this.logger.warn(`TomTom incidentDetails HTTP ${res.status} for bbox ${cacheKey}`);
        return cached?.data ?? []; // деградуємо до старого кешу цього bbox, якщо він є, інакше — порожній список (не валимо весь запит адмінки)
      }

      const raw = (await res.json()) as { incidents?: unknown };
      const rawIncidents = Array.isArray(raw.incidents) ? raw.incidents : [];
      const parsed = rawIncidents
        .map((e) => this.parseIncident(e as RawTomTomIncident))
        .filter((e): e is TomTomIncident => e !== null);

      this.cache.set(cacheKey, { data: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
      this.logger.log(`TomTom incidentDetails: ${parsed.length} incidents parsed for bbox ${cacheKey}`);
      return parsed;
    } catch (err) {
      this.logger.warn(`TomTom incidentDetails fetch failed: ${(err as Error).message}`);
      return cached?.data ?? [];
    }
  }

  private buildCacheKey(bbox: BoundingBox): string {
    const round = (n: number) => n.toFixed(CACHE_KEY_PRECISION);
    return `${round(bbox.minLat)},${round(bbox.minLng)},${round(bbox.maxLat)},${round(bbox.maxLng)}`;
  }

  private parseIncident(raw: RawTomTomIncident): TomTomIncident | null {
    const id = raw.properties?.id != null ? String(raw.properties.id) : null;
    if (!id) return null;

    const point = this.pickRepresentativePoint(raw.geometry);
    if (!point) return null;

    const iconCategory = Number(raw.properties?.iconCategory);
    const magnitude = Number(raw.properties?.magnitudeOfDelay);
    const events = Array.isArray(raw.properties?.events) ? raw.properties!.events! : [];
    const description = events.length > 0 && typeof events[0]?.description === 'string' ? events[0].description : null;
    const roadNumbers = Array.isArray(raw.properties?.roadNumbers)
      ? (raw.properties!.roadNumbers as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];

    return {
      id,
      lat: point.lat,
      lng: point.lng,
      iconCategory: Number.isFinite(iconCategory) ? iconCategory : 0,
      iconCategoryLabel: ICON_CATEGORY_LABEL[iconCategory] ?? 'Неизвестно',
      magnitudeOfDelay: Number.isFinite(magnitude) ? magnitude : 0,
      magnitudeLabel: MAGNITUDE_LABEL[magnitude] ?? 'Неизвестно',
      description,
      roadNumbers,
      from: typeof raw.properties?.from === 'string' ? raw.properties.from : null,
      to: typeof raw.properties?.to === 'string' ? raw.properties.to : null,
      lengthMeters: typeof raw.properties?.length === 'number' ? raw.properties.length : null,
      delaySeconds: typeof raw.properties?.delay === 'number' ? raw.properties.delay : null,
      startTime: typeof raw.properties?.startTime === 'string' ? raw.properties.startTime : null,
      endTime: typeof raw.properties?.endTime === 'string' ? raw.properties.endTime : null,
      probabilityOfOccurrence: typeof raw.properties?.probabilityOfOccurrence === 'string' ? raw.properties.probabilityOfOccurrence : null,
      source: 'TomTom',
    };
  }

  // TomTom-геометрія — GeoJSON Point АБО LineString (координати [lon,lat] чи масив [lon,lat],
  // порядок LON-перший, на відміну від 511NY, де Latitude/Longitude — окремі поля з очевидним
  // порядком). Для LineString (типовий випадок — інцидент "на ділянці дороги", не в точці)
  // беремо СЕРЕДНЮ точку масиву як представницьку координату маркера — спрощення для MVP:
  // реальний UI мав би малювати всю лінію ділянки, тут — лише точка на карті (той самий рівень
  // деталізації, що вже NyTrafficMap.tsx для 511NY-подій).
  private pickRepresentativePoint(geometry: RawTomTomIncident['geometry']): { lat: number; lng: number } | null {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;

    const coords = geometry.coordinates;
    let lonLat: unknown;
    if (geometry.type === 'Point') {
      lonLat = coords;
    } else if (geometry.type === 'LineString' && Array.isArray(coords) && coords.length > 0) {
      lonLat = coords[Math.floor((coords as unknown[]).length / 2)];
    } else {
      return null;
    }

    if (!Array.isArray(lonLat) || lonLat.length < 2) return null;
    const lng = Number(lonLat[0]);
    const lat = Number(lonLat[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }
}

// Наближене перетворення "центр + радіус (км)" -> bbox — за прямим запитом користувача,
// адмінка (§ NySituationalPanel-аналог для TomTom, TomTomFallbackPanel.tsx) дає обирати
// довільну точку поза NY State, а не фіксоване місто. Формула — стандартне наближення
// (градуси широти ~ однакові всюди, довготи стискаються з cos(lat)), достатньо точне для
// вибору області перегляду на карті, НЕ для точних геодезичних розрахунків.
export function centerRadiusToBoundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  // TomTom обмежує bbox максимум ~10 000 км² (§ дослідження) — клемпимо радіус, щоб (2*r)² не
  // перевищував це з запасом, а не тому що ми самі вважаємо це "правильним" UX-лімітом.
  const safeRadiusKm = Math.min(Math.max(radiusKm, 1), 40);
  const deltaLat = safeRadiusKm / 111.32;
  const deltaLng = safeRadiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - deltaLat,
    maxLat: lat + deltaLat,
    minLng: lng - deltaLng,
    maxLng: lng + deltaLng,
  };
}

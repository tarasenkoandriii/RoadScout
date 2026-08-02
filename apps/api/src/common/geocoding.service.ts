import { Injectable, Logger } from '@nestjs/common';

export interface GeocodeResult {
  lat: number;
  lng: number;
  confidence: number; // 0..1, derived from Google's location_type
}

// Опциональная подсказка города — см. doc/README.md, разделы "Города Украины" и "Соседние
// страны". Без неё запрос уходит как "<адрес>, Україна" (без привязки к конкретному городу —
// хуже disambiguation для частых названий улиц вроде "вулиця Шевченка", по-прежнему работает,
// и по умолчанию считается Украиной — свободный текстовый поиск без выбора города остаётся
// украиноцентричным, соседние страны становятся доступны именно через явный выбор города).
export interface CityHint {
  name: string;
  lat: number;
  lng: number;
  // ISO 3166-1 alpha-2, например "PL"/"SK"/"HU"/"RO"/"MD". Дефолт "UA" для обратной
  // совместимости со старыми вызовами (до появления соседних стран).
  countryCode?: string;
  // Название страны на украинском для строки запроса геокодинга, например "Польща". Если не
  // передано (undefined) или null (как в City.countryName для украинских городов) — берётся из
  // COUNTRY_NAME_BY_CODE по countryCode, а не молча подставляется "Україна" — иначе город
  // соседней страны без явного countryName ушёл бы в Google Geocoding как "<адрес>, Перемишль,
  // Україна", что бессмысленно.
  countryName?: string | null;
}

// Соседние с Украиной страны, поддержанные для приграничных регионов (см. doc/README.md,
// "Соседние страны" — используется и здесь как дефолт для countryName, и как справочный список
// поддерживаемых кодов). Значения — на украинском, как для "Україна", для единообразия строки
// запроса геокодинга.
const COUNTRY_NAME_BY_CODE: Record<string, string> = {
  UA: 'Україна',
  PL: 'Польща',
  SK: 'Словаччина',
  HU: 'Угорщина',
  RO: 'Румунія',
  MD: 'Молдова',
};

const LOCATION_TYPE_CONFIDENCE: Record<string, number> = {
  ROOFTOP: 0.95,
  RANGE_INTERPOLATED: 0.7,
  GEOMETRIC_CENTER: 0.5,
  APPROXIMATE: 0.3,
};

// Google Places API (Text Search) — в отличие от geocode() выше (Geocoding API, ожидает
// структурированный адрес), справляется с запросами-ориентирами вроде "Пішохідний міст Київ" —
// ищет по реальной базе POI/достопримечательностей Google Maps, а не по компонентам адреса.
// Использует тот же GOOGLE_GEOCODING_API_KEY (Places API нужно отдельно включить на том же
// проекте Google Cloud — тот же ключ, если оба API включены). См. запрос пользователя: "AI
// helper для получения широты долготы (возможно через google maps)" — это и есть тот хелпер,
// дополняющий (не заменяющий) текстовую догадку GrokCameraAssistService своими знаниями.
export interface PlaceSearchResult {
  lat: number;
  lng: number;
  name: string | null;
  formattedAddress: string | null;
  // Places API не отдаёт числовую уверенность как Geocoding (location_type) — эвристика:
  // единственный найденный кандидат считается надёжным (1.0), несколько кандидатов — берём
  // первый (обычно самый релевантный по ранжированию Google), но честно помечаем как менее
  // уверенный результат (0.6), а не выдаём его как единственно верный.
  confidence: number;
  candidateCount: number;
}

// Радиус (метры) вокруг центра города, которым Google Geocoding API "подсказывается" при
// поиске — https://developers.google.com/maps/documentation/geocoding/requests-geocoding#Viewports
// (location+radius не жёстко ограничивают результат, только смещают ранжирование кандидатов).
const CITY_BIAS_RADIUS_METERS = 30_000;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  // Throttling для Nominatim (см. searchPlaceOSM ниже) — политика использования OpenStreetMap
  // Nominatim требует не чаще 1 запроса в секунду (https://operations.osmfoundation.org/policies/nominatim/).
  // Хранится на уровне экземпляра сервиса (синглтон в Nest DI) — гарантирует лимит независимо
  // от того, сколько раз подряд админ открывает карточки в очереди ревью.
  private lastNominatimCallAt = 0;

  async geocode(locationText: string, cityHint?: CityHint | null): Promise<GeocodeResult | null> {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEOCODING_API_KEY is not set, skipping geocoding');
      return null;
    }

    const countryCode = (cityHint?.countryCode ?? 'UA').toUpperCase();
    const countryName = cityHint?.countryName ?? COUNTRY_NAME_BY_CODE[countryCode] ?? countryCode;

    const query = cityHint ? `${locationText}, ${cityHint.name}, ${countryName}` : `${locationText}, ${countryName}`;
    const params = new URLSearchParams({ address: query, key: this.apiKey, region: countryCode.toLowerCase() });
    if (cityHint) {
      params.set('location', `${cityHint.lat},${cityHint.lng}`);
      params.set('radius', String(CITY_BIAS_RADIUS_METERS));
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== 'OK' || !data.results?.length) {
        return null;
      }

      const best = data.results[0];
      const locationType: string = best.geometry?.location_type ?? 'APPROXIMATE';

      return {
        lat: best.geometry.location.lat,
        lng: best.geometry.location.lng,
        confidence: LOCATION_TYPE_CONFIDENCE[locationType] ?? 0.3,
      };
    } catch (err) {
      this.logger.warn(`Geocoding failed for "${locationText}": ${(err as Error).message}`);
      return null;
    }
  }

  // См. комментарий класса PlaceSearchResult выше. query обычно — название камеры (реальный
  // случай: "Пішохідний міст Київ" — Geocoding API не может это разобрать как структурированный
  // адрес и проваливается, а Places Text Search ищет по реальным ориентирам/POI).
  async searchPlace(query: string, cityHint?: CityHint | null): Promise<PlaceSearchResult | null> {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEOCODING_API_KEY is not set, skipping Places search');
      return null;
    }

    const countryCode = (cityHint?.countryCode ?? 'UA').toUpperCase();
    const countryName = cityHint?.countryName ?? COUNTRY_NAME_BY_CODE[countryCode] ?? countryCode;

    const fullQuery = cityHint ? `${query}, ${cityHint.name}, ${countryName}` : `${query}, ${countryName}`;
    const params = new URLSearchParams({ query: fullQuery, key: this.apiKey, region: countryCode.toLowerCase() });
    if (cityHint) {
      params.set('location', `${cityHint.lat},${cityHint.lng}`);
      params.set('radius', String(CITY_BIAS_RADIUS_METERS));
    }
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== 'OK' || !data.results?.length) {
        return null;
      }

      const best = data.results[0];
      const candidateCount = data.results.length as number;

      return {
        lat: best.geometry.location.lat,
        lng: best.geometry.location.lng,
        name: typeof best.name === 'string' ? best.name : null,
        formattedAddress: typeof best.formatted_address === 'string' ? best.formatted_address : null,
        confidence: candidateCount === 1 ? 1.0 : 0.6,
        candidateCount,
      };
    } catch (err) {
      this.logger.warn(`Places search failed for "${query}": ${(err as Error).message}`);
      return null;
    }
  }

  // OpenStreetMap Nominatim — третье, БЕСПЛАТНОЕ и не требующее API-ключа вообще источник
  // координат (см. запрос пользователя: "робочий варіант навіть без налаштованого Google-
  // ключа"). Вызывается автоматически при открытии карточки в очереди ревью (не по кнопке, в
  // отличие от Grok/Places) — именно поэтому throttleNominatim() ниже реально важен: админ,
  // быстро пролистывающий очередь, не должен случайно нарушить лимит Nominatim.
  async searchPlaceOSM(query: string, cityHint?: CityHint | null): Promise<PlaceSearchResult | null> {
    await this.throttleNominatim();

    const countryCode = (cityHint?.countryCode ?? 'UA').toLowerCase();
    const countryName = cityHint?.countryName ?? COUNTRY_NAME_BY_CODE[countryCode.toUpperCase()] ?? countryCode;
    const fullQuery = cityHint ? `${query}, ${cityHint.name}, ${countryName}` : `${query}, ${countryName}`;

    const params = new URLSearchParams({
      q: fullQuery,
      format: 'jsonv2',
      limit: '5',
      countrycodes: countryCode,
      'accept-language': 'uk',
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

    try {
      // Nominatim требует идентифицирующий User-Agent в каждом запросе (та же политика
      // использования — без него запросы могут блокироваться без предупреждения).
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RoadScout-CameraRegistry/1.0 (admin coordinate lookup helper)' },
      });
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }

      const best = data[0];
      const lat = parseFloat(best.lat);
      const lng = parseFloat(best.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return {
        lat,
        lng,
        name: typeof best.display_name === 'string' ? best.display_name : null,
        formattedAddress: typeof best.display_name === 'string' ? best.display_name : null,
        // Тот же принцип, что и для Places выше: единственный кандидат — надёжнее, чем один из
        // нескольких (Nominatim дополнительно отдаёт "importance", но для простоты и
        // единообразия с Places используем ту же двухуровневую эвристику; importance всё
        // равно передаётся дальше в metadata на будущее, не отбрасывается).
        confidence: data.length === 1 ? 1.0 : 0.6,
        candidateCount: data.length,
      };
    } catch (err) {
      this.logger.warn(`Nominatim search failed for "${query}": ${(err as Error).message}`);
      return null;
    }
  }

  private async throttleNominatim(): Promise<void> {
    const minGapMs = 1000;
    const elapsed = Date.now() - this.lastNominatimCallAt;
    if (elapsed < minGapMs) {
      await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
    }
    this.lastNominatimCallAt = Date.now();
  }
}

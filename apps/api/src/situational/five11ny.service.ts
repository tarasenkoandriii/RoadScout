import { Injectable, Logger } from '@nestjs/common';

// Парсер офіційного 511NY API (NYSDOT, 511ny.org) — за прямим запитом користувача: "впиши 511NY
// как основной источник трафика для NYC в §7.2 ТЗ (вместо работы над oktraffic.org — проект
// работает с американскими городами)" (doc/TZ-btw-route-planning.md, §7.2/§9) і далі "пишем
// парсер 511ny.org ... в рамках пункта 2 тз" (§8, Этап 2).
//
// Архітектурне рішення: НЕ зберігаємо ці події в таблиці RoadIncident (хоча її поле `source`
// формально "зарезервоване під майбутній зовнішній фід" — див. doc/AUDIT-situational-
// awareness.md і коментар над моделлю RoadIncident у schema.prisma). Причина: RoadIncident —
// це вручну курована адміном таблиця (create/update/resolve/remove через UI), розрахована на
// рідкісні ручні записи, що явно "закриваються" адміном. 511NY, навпаки, — це живий зовнішній
// фід, що постійно змінюється сам по собі (події з'являються/зникають між нашими запитами) —
// перетворення його на CRUD-записи вимагало б окремої синхронізації/дедуплікації/автозакриття
// зниклих подій (окрема задача, тут не запитана). Натомість цей сервіс дзеркалить ТОЧНО той
// самий патерн, що вже `WeatherService` (§weather.service.ts) — теж живий зовнішній фід
// (Open-Meteo), теж не зберігається в БД, теж простий in-process кеш з TTL. Тобто 511NY-події —
// концептуально "як погода", не "як наші ДТП".

export type FiveElevenNyEventType =
  | 'roadwork'
  | 'closures'
  | 'specialEvents'
  | 'transitOperations'
  | 'accidentsAndIncidents'
  | 'generalInfo'
  | 'winterDrivingIndex'
  | string; // 511NY може повернути значення поза цим списком — не валимось, просто показуємо як є

export type FiveElevenNySeverity = 'None' | 'Minor' | 'Major' | 'Unknown' | string;

export interface FiveElevenNyEvent {
  id: string;
  lat: number;
  lng: number;
  eventType: FiveElevenNyEventType;
  eventSubType: string | null;
  severity: FiveElevenNySeverity;
  roadwayName: string | null;
  directionOfTravel: string | null;
  description: string | null;
  countyName: string | null;
  regionName: string | null;
  primaryLocation: string | null;
  reportedAt: string | null; // ISO 8601, після нормалізації формату 511NY (див. parseFiveElevenNyDate нижче)
  lastUpdatedAt: string | null;
  plannedEndAt: string | null;
  encodedPolyline: string | null;
  source: '511NY';
}

// Сира форма відповіді 511NY GetEvents — перевірено ЖИВИМ запитом до продакшн API (не з
// офіційної сторінки документації 511ny.org/help/endpoint/event, яка, як з'ясувалось, показує
// приклад від зовсім іншого 511-провайдера — Ontario MTO — з іншими назвами полів і Unix-
// таймстампами, що НЕ відповідає реальній відповіді 511NY). Тому парсинг нижче захисний
// (`?? null` на кожному полі), а не сліпо довіряє жодній зі схем.
interface RawFiveElevenNyEvent {
  ID?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
  EventType?: unknown;
  EventSubType?: unknown;
  Severity?: unknown;
  RoadwayName?: unknown;
  DirectionOfTravel?: unknown;
  Description?: unknown;
  CountyName?: unknown;
  RegionName?: unknown;
  PrimaryLocation?: unknown;
  Reported?: unknown;
  LastUpdated?: unknown;
  PlannedEndDate?: unknown;
  MapEncodedPolyline?: unknown;
  [key: string]: unknown;
}

const API_BASE = 'https://511ny.org/api';
// Документований ліміт 511NY — 10 запитів/60с (§7.2 ТЗ). Тримаємо суттєвий запас, а не рівно
// 6с — кілька паралельних інстансів Vercel serverless (§ той самий застережний коментар, що і в
// WeatherService/FixedRoutePositionService про in-process кеш) можуть звертатись до цього
// сервісу незалежно один від одного, тож "мінімум N секунд між запитами ЦЬОГО інстансу" не
// гарантує ліміт на рівні всього застосунку — лише знижує ризик, не усуває його повністю.
const RATE_LIMIT_MIN_GAP_MS = 8_000;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 хвилини — дорожні події не змінюються настільки часто, щоб опитувати частіше, і це заощаджує ліміт запитів
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class FiveElevenNyService {
  private readonly logger = new Logger(FiveElevenNyService.name);
  private readonly apiKey = process.env.FIVE11NY_API_KEY;

  private lastFetchStartedAt = 0;
  private cachedEvents: FiveElevenNyEvent[] = [];
  private cacheExpiresAt = 0;
  // Захист від "стада" паралельних викликів (наприклад overview + прямий запит адмінки майже
  // одночасно) — усі, хто прийшов поки триває один живий запит, чекають на його результат
  // замість того, щоб кожен окремо бити по ліміту 511NY.
  private inFlight: Promise<FiveElevenNyEvent[]> | null = null;

  // Дозволяє фронту чесно показати "ключ не налаштований" замість мовчазного порожнього списку
  // (§ той самий принцип, що вже logNote()/kind:'note' у BTW — "не могу сделать выводы").
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getEvents(): Promise<FiveElevenNyEvent[]> {
    if (!this.apiKey) {
      this.logger.warn('FIVE11NY_API_KEY is not set — 511NY events skipped (см. doc/TZ-btw-route-planning.md §6.3/§7.2, той же паттерн ключа, що OPENROUTESERVICE_API_KEY)');
      return [];
    }

    if (Date.now() < this.cacheExpiresAt) {
      return this.cachedEvents;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.fetchAndParse();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async fetchAndParse(): Promise<FiveElevenNyEvent[]> {
    await this.throttle();

    const url = `${API_BASE}/getevents?key=${encodeURIComponent(this.apiKey!)}&format=json`;

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
        this.logger.warn(`511NY GetEvents HTTP ${res.status} — keeping previous cache (${this.cachedEvents.length} events)`);
        // Тимчасовий збій зовнішнього API не повинен "стирати" карту до порожньої — деградуємо
        // до останнього відомого стану (той самий принцип, що btwLocalScanner.ts при init-
        // помилках деградує до серверного шляху, а не до порожнього результату).
        return this.cachedEvents;
      }

      const raw: unknown = await res.json();
      if (!Array.isArray(raw)) {
        this.logger.warn('511NY GetEvents returned a non-array payload — treating as empty result');
        return [];
      }

      const parsed = raw
        .map((e) => this.parseEvent(e as RawFiveElevenNyEvent))
        .filter((e): e is FiveElevenNyEvent => e !== null);

      this.cachedEvents = parsed;
      this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      this.logger.log(`511NY GetEvents: ${parsed.length} events parsed (of ${raw.length} raw entries)`);
      return parsed;
    } catch (err) {
      this.logger.warn(`511NY GetEvents fetch failed: ${(err as Error).message} — keeping previous cache (${this.cachedEvents.length} events)`);
      return this.cachedEvents;
    }
  }

  private parseEvent(raw: RawFiveElevenNyEvent): FiveElevenNyEvent | null {
    const lat = Number(raw.Latitude);
    const lng = Number(raw.Longitude);
    // (0, 0) — типовий "немає даних" маркер зовнішніх API (Null Island), а не реальна координата
    // в Нью-Йорку — відкидаємо разом із просто некоректними/відсутніми координатами.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return null;
    }

    const id = raw.ID != null ? String(raw.ID) : null;
    if (!id) return null;

    return {
      id,
      lat,
      lng,
      eventType: typeof raw.EventType === 'string' && raw.EventType ? raw.EventType : 'generalInfo',
      eventSubType: typeof raw.EventSubType === 'string' && raw.EventSubType ? raw.EventSubType : null,
      severity: typeof raw.Severity === 'string' && raw.Severity ? raw.Severity : 'Unknown',
      roadwayName: typeof raw.RoadwayName === 'string' && raw.RoadwayName ? raw.RoadwayName : null,
      directionOfTravel: typeof raw.DirectionOfTravel === 'string' && raw.DirectionOfTravel ? raw.DirectionOfTravel : null,
      description: typeof raw.Description === 'string' && raw.Description ? raw.Description : null,
      countyName: typeof raw.CountyName === 'string' && raw.CountyName ? raw.CountyName : null,
      regionName: typeof raw.RegionName === 'string' && raw.RegionName ? raw.RegionName : null,
      primaryLocation: typeof raw.PrimaryLocation === 'string' && raw.PrimaryLocation ? raw.PrimaryLocation : null,
      reportedAt: parseFiveElevenNyDate(raw.Reported),
      lastUpdatedAt: parseFiveElevenNyDate(raw.LastUpdated),
      plannedEndAt: parseFiveElevenNyDate(raw.PlannedEndDate),
      encodedPolyline: typeof raw.MapEncodedPolyline === 'string' && raw.MapEncodedPolyline ? raw.MapEncodedPolyline : null,
      source: '511NY',
    };
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastFetchStartedAt;
    if (elapsed < RATE_LIMIT_MIN_GAP_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MIN_GAP_MS - elapsed));
    }
    this.lastFetchStartedAt = Date.now();
  }
}

// 511NY віддає дати як рядок "dd/MM/yyyy HH:mm:ss" — ДЕНЬ-перший (перевірено живим запитом:
// поле StartDate="09/06/2025 09:40:00" відповідає людинозрозумілому тексту в Description
// "Starting 06/09/2025 9:40 AM", де 06/09 — американський місяць-перший запис ТІЄЇ Ж дати, 9
// червня — тобто поле і опис використовують РІЗНИЙ порядок дня/місяця для однієї дати). Це НЕ
// Unix-таймстамп (усупереч застарілій сторінці документації з чужим прикладом, див. коментар
// класу вище) — `new Date("dd/MM/...")` в JS парсить це неправильно (як MM/dd), тому парсимо
// вручну й повертаємо ISO-рядок (зручніше для фронту/серіалізації, ніж Date-об'єкт).
// ⚠️ ЧЕСНО: 511NY, найімовірніше, віддає час у місцевому поясі Нью-Йорка (America/New_York,
// ET), не в UTC — живий запит цього не підтвердив напевно (немає окремого поля таймзони у
// відповіді). Нижче трактуємо рядок як UTC (Date.UTC) — це ПРОСТІШЕ, ніж коректний ET-парсинг
// зі зміною літнього/зимового часу, і тому свідомо неточне: показаний адміну час може бути
// зсунутий на 4-5 годин від реального. Прийнятно для MVP-візуалізації "коли приблизно
// повідомлено/оновлено", неприйнятно, якщо колись знадобиться точна сортування/порівняння з
// іншими джерелами часу — тоді потрібно або знайти в 511NY документації явну таймзону, або
// конвертувати з America/New_York explicitly (наприклад через Intl/date-fns-tz).
function parseFiveElevenNyDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

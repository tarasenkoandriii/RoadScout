import { Injectable, Logger } from '@nestjs/common';

export type RangeHint = 'bridge' | 'avenue' | 'street' | 'yard';
export type AzimuthSource = 'heuristic' | 'fallback';

export interface AzimuthGuess {
  azimuth: number;
  rangeHint: RangeHint;
  // Явный источник значения (см. doc/TZ-parser-import-improvements.md, П2.1) — раньше
  // вызывающий код (ScraperService) угадывал "это фолбэк?" по тому, что azimuth===0 И
  // rangeHint==='yard', что ошибочно классифицировало бы РЕАЛЬНЫЙ результат эвристики (дорога,
  // идущая точно на север, классифицированная как двор — редкий, но возможный случай) как
  // фолбэк. Теперь сервис сообщает источник напрямую, никакого угадывания по магическим
  // значениям.
  source: AzimuthSource;
}

interface CacheEntry {
  guess: AzimuthGuess;
  expiresAt: number;
}

// First-approximation heuristic for MVP: assume the camera faces roughly along
// the nearest road segment. This is intentionally simple — it gets replaced
// or corrected by manual calibration (confidence: VERIFIED) later.
//
// П2.1 (см. doc/TZ-parser-import-improvements.md): кэш по координатам (сетка ~100м — соседние
// камеры на одной улице переиспользуют один и тот же результат, не долбят Overpass на каждую) +
// явный клиентский таймаут (раньше fetch() не имел ограничения по времени со стороны клиента
// вообще — только `timeout:10` внутри самого Overpass-запроса, который ничего не гарантирует,
// если сервер вообще не отвечает/зависает на уровне сети).
@Injectable()
export class AzimuthHeuristicService {
  private readonly logger = new Logger(AzimuthHeuristicService.name);
  private readonly cache = new Map<string, CacheEntry>();
  // ВИПРАВЛЕННЯ РЕАЛЬНОГО БАГА, знайденого під час аудиту на Vercel Hobby-сумісність
  // (за прямим запитом користувача, doc/AUDIT-vercel-hobby.md): коментар у btw.service.ts
  // СТВЕРДЖУВАВ, що getNearbyStreetAzimuths() кешується "тим самим кешем по сітці", але
  // РЕАЛЬНО в коді кешу не було взагалі — кожен тик /btw/scan (кожні ~2с при активному
  // скануванні) бив живий Overpass-запит наново. Окремий Map, не той самий this.cache вище,
  // бо CacheEntry типізований конкретно під AzimuthGuess, інша форма значення тут (number[]).
  private readonly streetAzimuthCache = new Map<string, { azimuths: number[]; expiresAt: number }>();

  async guessForPoint(lat: number, lng: number): Promise<AzimuthGuess> {
    const key = this.gridKey(lat, lng);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.guess;
    }

    const guess = await this.fetchGuess(lat, lng);
    this.cache.set(key, { guess, expiresAt: Date.now() + getCacheTtlMs() });
    return guess;
  }

  // Батчування Overpass-запитів (глибша переробка — див. запит користувача, реалізовано ПІСЛЯ
  // явного попередження про ризик і збереження точки відновлення, doc/AUDIT-overpass-batching.md).
  // ЕЛЕГАНТНЕ рішення без зміни processItem()/guessForPoint() взагалі: цей метод лише
  // ПРОГРІВАЄ той самий кеш по сітці координат (this.cache), яким guessForPoint() уже
  // користується — виклики guessForPoint() з ScraperService лишаються без жодних змін,
  // просто отримують кеш-хіт замість власного мережевого запиту, якщо точку вже прогріто тут.
  //
  // До 20 точок в ОДНОМУ Overpass-запиті (декілька `way(around:...)` в одному union-блоці) —
  // сам Overpass повертає ОДИН спільний, дедуплікований список доріг для всіх точок одразу, без
  // явного маркування "яка дорога відповідає якій точці". Кореляція виконується КЛІЄНТСЬКИ:
  // для кожної вхідної точки шукаємо серед повернутих доріг ту, чия геометрія проходить у межах
  // 60м (той самий радіус, що й раніше в одноточковому запиті) — так само надійно, як і
  // попередня логіка "elements[0]" (яка теж неявно покладалась на радіус запиту), але тепер
  // явно перевіряється відстань, а не просто перший елемент масиву.
  async guessForPoints(points: { lat: number; lng: number }[]): Promise<AzimuthGuess[]> {
    if (points.length === 0) return [];

    const results: (AzimuthGuess | null)[] = points.map((p) => {
      const cached = this.cache.get(this.gridKey(p.lat, p.lng));
      return cached && cached.expiresAt > Date.now() ? cached.guess : null;
    });

    const uncachedIndices = results.reduce<number[]>((acc, r, i) => (r === null ? [...acc, i] : acc), []);
    if (uncachedIndices.length === 0) return results as AzimuthGuess[];

    const uncachedPoints = uncachedIndices.map((i) => points[i]);
    const fetched = await this.fetchGuessesBatch(uncachedPoints);

    uncachedIndices.forEach((originalIndex, batchIndex) => {
      const guess = fetched[batchIndex];
      results[originalIndex] = guess;
      this.cache.set(this.gridKey(points[originalIndex].lat, points[originalIndex].lng), { guess, expiresAt: Date.now() + getCacheTtlMs() });
    });

    return results as AzimuthGuess[];
  }

  private async fetchGuessesBatch(points: { lat: number; lng: number }[]): Promise<AzimuthGuess[]> {
    const MAX_BATCH = getOverpassBatchSize();
    // Захисний рекурсивний розподіл, якщо викликач передав більше точок, ніж дозволяє
    // максимальний розмір одного запиту (не мало б траплятись, якщо виклик уже сам ділить на
    // чанки по 20, але лишає метод коректним і безпечним для будь-якого виклику).
    if (points.length > MAX_BATCH) {
      const combined: AzimuthGuess[] = [];
      for (let i = 0; i < points.length; i += MAX_BATCH) {
        combined.push(...(await this.fetchGuessesBatch(points.slice(i, i + MAX_BATCH))));
      }
      return combined;
    }

    try {
      const queryParts = points.map((p) => `way(around:60,${p.lat},${p.lng})["highway"];`).join('\n        ');
      const query = `
        [out:json][timeout:25];
        (${queryParts});
        out geom;
      `;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), getFetchTimeoutMs());

      let res: Response;
      try {
        res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await res.json();
      const ways: any[] = data.elements ?? [];

      return points.map((p) => this.pickNearestWay(p, ways));
    } catch (err) {
      this.logger.warn(`Batched azimuth heuristic failed for ${points.length} points: ${(err as Error).message}`);
      return points.map(() => ({ azimuth: 0, rangeHint: 'yard' as RangeHint, source: 'fallback' as AzimuthSource }));
    }
  }

  // 60м — той самий радіус, що вже був у одноточковому Overpass-запиті (`around:60`) — тут
  // застосовується як явна перевірка відстані на клієнті, оскільки один спільний запит на 20
  // точок повертає ОДИН об'єднаний список доріг без прив'язки "яка дорога — до якої точки".
  private pickNearestWay(point: { lat: number; lng: number }, ways: any[]): AzimuthGuess {
    const RADIUS_M = 60;
    let best: { way: any; dist: number } | null = null;

    for (const way of ways) {
      if (!way?.geometry || way.geometry.length < 2) continue;
      for (const vertex of way.geometry) {
        const dist = this.haversine(point.lat, point.lng, vertex.lat, vertex.lon);
        if (dist <= RADIUS_M && (!best || dist < best.dist)) {
          best = { way, dist };
        }
      }
    }

    if (!best) return { azimuth: 0, rangeHint: 'yard', source: 'fallback' };

    const [p1, p2] = best.way.geometry;
    const azimuth = this.bearing(p1.lat, p1.lon, p2.lat, p2.lon);
    const rangeHint = this.classifyHighway(best.way.tags?.highway, best.way.tags?.bridge);
    return { azimuth, rangeHint, source: 'heuristic' };
  }

  // Той самий haversine-розрахунок, що вже є в src/common/geometry.util.ts — окрема, невелика
  // копія тут (не імпорт), щоб не створювати циклічну залежність цього низькорівневого
  // сервісу від geometry.util.ts заради однієї функції.
  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async fetchGuess(lat: number, lng: number): Promise<AzimuthGuess> {
    try {
      const query = `
        [out:json][timeout:10];
        way(around:60,${lat},${lng})["highway"];
        out geom;
      `;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), getFetchTimeoutMs());

      let res: Response;
      try {
        res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await res.json();
      const way = data.elements?.[0];

      if (!way?.geometry || way.geometry.length < 2) {
        return { azimuth: 0, rangeHint: 'yard', source: 'fallback' };
      }

      const [p1, p2] = way.geometry;
      const azimuth = this.bearing(p1.lat, p1.lon, p2.lat, p2.lon);
      const rangeHint = this.classifyHighway(way.tags?.highway, way.tags?.bridge);

      return { azimuth, rangeHint, source: 'heuristic' };
    } catch (err) {
      this.logger.warn(`Azimuth heuristic failed for (${lat}, ${lng}): ${(err as Error).message}`);
      return { azimuth: 0, rangeHint: 'yard', source: 'fallback' };
    }
  }

  // Округление до сетки ~100м (0.001° по широте ≈ 111м на экваторе, для наших широт (Україна,
  // ~48-51°) практически то же самое по порядку величины что по долготе) — соседние камеры на
  // одной улице почти всегда попадут в одну ячейку и переиспользуют результат.
  private gridKey(lat: number, lng: number): string {
    const round = (v: number) => Math.round(v / 0.001) * 0.001;
    return `${round(lat).toFixed(3)},${round(lng).toFixed(3)}`;
  }

  private classifyHighway(highway?: string, bridgeTag?: string): RangeHint {
    if (bridgeTag === 'yes') return 'bridge';
    if (!highway) return 'yard';
    if (['motorway', 'trunk', 'primary'].includes(highway)) return 'avenue';
    if (highway === 'secondary' || highway === 'tertiary') return 'street';
    return 'yard';
  }

  private bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;

    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // У3 ТЗ (doc/BTW-tz.md, §5) — "привязка к уличной сети": на відміну від guessForPoint()
  // вище (одна "найкраща" дорога, радіус 60м, для АВТОКАЛІБРУВАННЯ КАМЕР), тут потрібні ВСІ
  // близькі дороги в радіусі 30м (саме так у ТЗ), і для КОЖНОЇ — ОБИДВА напрямки вздовж неї
  // (людина може дивитись в будь-яку сторону вздовж вулиці, не лише в бік, звідки рахувався
  // bearing) — "получаем 2–4 «разрешённых» направления" з ТЗ відповідає, наприклад,
  // перехрестю двох вулиць: 0°/180° + 90°/270°.
  async getNearbyStreetAzimuths(lat: number, lng: number, radiusM = 30): Promise<number[]> {
    const key = this.gridKey(lat, lng);
    const cached = this.streetAzimuthCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.azimuths;
    }

    try {
      const query = `
        [out:json][timeout:10];
        way(around:${radiusM},${lat},${lng})["highway"];
        out geom;
      `;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), getFetchTimeoutMs());

      let res: Response;
      try {
        res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await res.json();
      const azimuths = this.extractStreetAzimuthCandidates(data.elements ?? []);
      this.streetAzimuthCache.set(key, { azimuths, expiresAt: Date.now() + getCacheTtlMs() });
      return azimuths;
    } catch (err) {
      this.logger.warn(`getNearbyStreetAzimuths failed for (${lat}, ${lng}): ${(err as Error).message}`);
      return []; // порожньо -> викликач НЕ підтягує (snap), а не хибно "0°", на відміну від guessForPoint()'s fallback
    }
  }

  // Винесено окремо від getNearbyStreetAzimuths() навмисно — сама логіка "з сирих Overpass-
  // елементів побудувати список кандидатів" не робить мережевих викликів і тому реально
  // тестується юніт-тестами без живого Overpass (на відміну від fetchGuess()/
  // fetchGuessesBatch() вище, де парсинг і мережевий виклик перемішані в одному методі).
  extractStreetAzimuthCandidates(elements: any[]): number[] {
    const candidates = new Set<number>();
    const DEDUP_TOLERANCE_DEG = 10; // близькі за азимутом дороги (напр. злегка вигнута вулиця) не множать кандидатів

    for (const way of elements) {
      if (!way?.geometry || way.geometry.length < 2) continue;
      const [p1, p2] = way.geometry;
      const bearingDeg = this.bearing(p1.lat, p1.lon, p2.lat, p2.lon);

      for (const candidate of [bearingDeg, (bearingDeg + 180) % 360]) {
        const isDuplicate = [...candidates].some((existing) => {
          const diff = Math.abs(existing - candidate) % 360;
          return Math.min(diff, 360 - diff) < DEDUP_TOLERANCE_DEG;
        });
        if (!isDuplicate) candidates.add(candidate);
      }
    }

    return [...candidates];
  }
}

function getCacheTtlMs(): number {
  const hours = parseInt(process.env.AZIMUTH_HEURISTIC_CACHE_TTL_HOURS ?? '', 10);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

function getFetchTimeoutMs(): number {
  const ms = parseInt(process.env.AZIMUTH_HEURISTIC_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 8000;
}

// Розмір пачки для батчованого Overpass-запиту (див. запит користувача: "поднимем количество
// точек в запросе до 20") — скільки координат об'єднується в ОДИН HTTP-запит замість окремого
// запиту на кожну.
function getOverpassBatchSize(): number {
  const v = parseInt(process.env.OVERPASS_BATCH_SIZE ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService, CityHint } from '../common/geocoding.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { syncCameraPolygon } from '../common/geometry.util';
import { AzimuthHeuristicService } from './azimuth-heuristic.service';
import { ProviderAdapter, RawCameraItem } from './providers/provider-adapter.interface';
import { WebcamGuruAdapter } from './providers/webcam-guru.adapter';
import { YoutubeSearchAdapter } from './providers/youtube-search.adapter';
import { GoogleWebCameraSearchAdapter } from './providers/google-web-camera-search.adapter';
import { WindyWebcamsAdapter } from './providers/windy-webcams.adapter';
import { NycTmcAdapter } from './providers/nyctmc.adapter';
import { TrafficVisionAdapter } from './providers/trafficvision.adapter';
import { findTrafficVisionSource, slugFromAdapterKey } from './providers/trafficvision-sources';
import { RegistryProxyService } from './proxy/registry-proxy.service';
import { ImportLogService } from './import-log.service';
import { ResolveSourceRawDto } from './dto/resolve-source-raw.dto';

const GEOCODE_CONFIDENCE_THRESHOLD = 0.6;

const DEFAULT_RANGE_BY_HINT: Record<string, number> = {
  bridge: 500,
  avenue: 400,
  street: 200,
  yard: 80,
};

const DEFAULT_FOV_ANGLE = 80;

function getAnomalyHistorySize(): number {
  const v = parseInt(process.env.PARSER_ANOMALY_HISTORY_SIZE ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
}
function getAnomalyMinHistory(): number {
  const v = parseInt(process.env.PARSER_ANOMALY_MIN_HISTORY ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}
function getAnomalyThreshold(): number {
  const v = parseFloat(process.env.PARSER_ANOMALY_THRESHOLD ?? '');
  return Number.isFinite(v) && v > 0 ? v : 0.5;
}
function getRunAllDelayMs(): number {
  const v = parseInt(process.env.PARSER_RUN_ALL_DELAY_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 2000;
}
// Пауза между дозапросами деталей отдельных элементов (см. ProviderAdapter.fetchDetails) —
// вежливость по отношению к сайту-источнику; не путать с PARSER_RUN_ALL_DELAY_MS (та — между
// РАЗНЫМИ провайдерами/городами, эта — между камерами ВНУТРИ одного прохода).
function getDetailFetchDelayMs(): number {
  const v = parseInt(process.env.PARSER_DETAIL_FETCH_DELAY_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 300;
}
// Конкурентність обробки елементів у циклі нижче (див. doc/AUDIT-nyctmc-performance.md —
// реальний знайдений інцидент: NYC TMC повертає ~900-969 камер одним викликом, але кожна
// потім оброблялась ПОСЛІДОВНО, з реальним мережевим викликом до Overpass API на кожну
// (AzimuthHeuristicService.guessForPoint()) — за бюджет часу 25с встигало лише ~10-25 камер,
// решта чекала наступного проходу (раз на добу) — теоретично 40-100+ днів на повний імпорт.
//
// "Многопоточність", про яку йшлося в запиті користувача, у Node.js для I/O-навантаженої
// роботи (мережеві виклики/БД, не CPU-обчислення) — це не OS-потоки (worker_threads тут не
// дав би виграшу, вузьке місце не в обчисленнях), а конкурентні проміси: кілька елементів
// обробляються ПАРАЛЕЛЬНО через Promise.all(), чекаючи одне на одного, поки триває мережевий
// I/O — саме це й реалізовано нижче.
function getItemConcurrency(): number {
  const v = parseInt(process.env.PARSER_ITEM_CONCURRENCY ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// Бюджет времени на один проход (см. doc/TZ-parser-import-improvements.md, П3.2) — защита от
// таймаута serverless-функции при большом каталоге: вместо того чтобы оборваться посередине
// без предупреждения (и без сохранённой статистики), проход аккуратно останавливается,
// сохраняет то, что успел обработать, и явно логирует, сколько элементов осталось необработано.
// Полноценное решение при действительно больших каталогах — асинхронный воркер/очередь (см.
// ТЗ) — этот бюджет лишь смягчает риск, не устраняет его архитектурно.
function getRunTimeBudgetMs(): number {
  const v = parseInt(process.env.PARSER_RUN_TIME_BUDGET_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25000;
}

// Для resolveOrCreateCityId() (автостворення City для TrafficVisionAdapter та будь-якого
// майбутнього адаптера з тим самим suggestedCityName-шляхом) — проста, без зовнішніх бібліотек
// транслітерація/нормалізація не потрібна (назви міст від TrafficVision уже латиницею): нижній
// регістр, усе, що не [a-z0-9], стає "-", повторні/крайні "-" згортаються.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface RunStats {
  discoveredCount: number;
  newCount: number;
  updatedCount: number;
  geocodedCount: number;
  autoImportedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  errorCount: number;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly azimuthHeuristic: AzimuthHeuristicService,
    private readonly registryProxy: RegistryProxyService,
    private readonly importLog: ImportLogService,
    private readonly grokAssist: GrokCameraAssistService,
  ) {}

  // Города Украины (см. doc/README.md): один и тот же адаптер обслуживает ЛЮБОЙ город —
  // конкретный город приходит из CameraProvider.city (одна строка CameraProvider = один город,
  // например "WebcamGuru — Львів" с adapterKey "webcam-guru-lviv" и city=Львів). Собирается
  // заново на каждый прогон (не кэшируется по adapterKey), т.к. дешёво и не завязано на DI.
  private resolveAdapter(provider: { adapterKey: string; city: { webcamGuruSlug: string | null; name: string; lat: number; lng: number; countryCode: string; countryName: string | null } | null }): ProviderAdapter {
    if (provider.adapterKey.startsWith('webcam-guru')) {
      if (!provider.city?.webcamGuruSlug) {
        throw new Error(
          `Provider "${provider.adapterKey}" uses the webcam-guru adapter but has no linked City.webcamGuruSlug — ` +
            'set CameraProvider.cityId to a City with webcamGuruSlug configured (see sql/cities-seed.sql).',
        );
      }
      return new WebcamGuruAdapter(provider.city.webcamGuruSlug, this.registryProxy);
    }

    // См. doc/TZ-youtube-camera-discovery.md — окремий провайдер на кожне місто, потребує
    // лише City.lat/City.lng/City.name (жодного окремого slug-поля не заведено, на відміну
    // від webcam-guru — гео-координати вже й так є в City для будь-якого міста).
    if (provider.adapterKey.startsWith('youtube-search')) {
      if (!provider.city) {
        throw new Error(`Provider "${provider.adapterKey}" uses the youtube-search adapter but has no linked City — set CameraProvider.cityId.`);
      }
      return new YoutubeSearchAdapter(provider.city.name, provider.city.lat, provider.city.lng, this.grokAssist, this.registryProxy, provider.city.countryCode);
    }

    // Пошук окремих камер через Google (веб-пошук Grok) — див. doc/AUDIT-google-web-search-cameras.md.
    if (provider.adapterKey.startsWith('web-search')) {
      if (!provider.city) {
        throw new Error(`Provider "${provider.adapterKey}" uses the web-search adapter but has no linked City — set CameraProvider.cityId.`);
      }
      return new GoogleWebCameraSearchAdapter(provider.city.name, this.grokAssist, this.registryProxy, provider.city.countryName ?? 'Украина');
    }

    // NYC DOT Real Time Traffic Information — реальний, безкоштовний API без ключа, знайдений
    // і підтверджений користувачем напряму (webcams.nyctmc.org/cameras-list). Єдиний
    // глобальний провайдер (не по місту, як YouTube/Windy) — API повертає всі камери міста
    // одним запитом. Без квоти/ключа — НЕ виключений з загального run-all() (див. нижче).
    if (provider.adapterKey === 'nyctmc') {
      return new NycTmcAdapter(this.registryProxy);
    }

    // Windy Webcams API (реальна, структурована база камер, заміна webcam.guru.ua для не-
    // українських міст — див. doc/AUDIT-windy-webcams-and-nature-cameras.md).
    if (provider.adapterKey.startsWith('windy')) {
      if (!provider.city) {
        throw new Error(`Provider "${provider.adapterKey}" uses the windy adapter but has no linked City — set CameraProvider.cityId.`);
      }
      return new WindyWebcamsAdapter(provider.city.name, provider.city.lat, provider.city.lng, this.registryProxy);
    }

    // TrafficVision.Live camera-data (див. клас-коментар TrafficVisionAdapter і
    // doc/AUDIT-trafficvision-parser.md за повним дослідженням) — ЄДИНИЙ провайдер НЕ по місту
    // (як nyctmc — одне джерело охоплює ціле джерело/агентство, потенційно багато міст), тому
    // City тут НЕ обов'язковий (на відміну від webcam-guru/youtube-search/web-search/windy
    // вище) — City-прив'язка окремих камер робиться поштучно нижче, у processItem(), через
    // item.suggestedCityName/suggestedCountryCode, а не через provider.city.
    if (provider.adapterKey.startsWith('trafficvision-')) {
      const slug = slugFromAdapterKey(provider.adapterKey);
      const source = slug ? findTrafficVisionSource(slug) : undefined;
      if (!source) {
        throw new Error(
          `Provider "${provider.adapterKey}" uses the trafficvision adapter, but "${slug}" is not a known TrafficVision source — ` +
            'see TRAFFICVISION_SOURCES in providers/trafficvision-sources.ts.',
        );
      }
      return new TrafficVisionAdapter(source.slug, source.url, this.registryProxy);
    }

    // Register additional adapter families here as they're implemented (matched by adapterKey
    // prefix, same pattern as above), e.g. `if (provider.adapterKey.startsWith('video-probok'))`.
    throw new Error(`No adapter registered for provider "${provider.adapterKey}"`);
  }

  async runForProvider(providerId: string, triggeredBy: 'cron' | 'manual') {
    const provider = await this.prisma.cameraProvider.findUniqueOrThrow({
      where: { id: providerId },
      include: { city: true },
    });
    const cityHint: CityHint | null = provider.city
      ? {
          name: provider.city.name,
          lat: provider.city.lat,
          lng: provider.city.lng,
          countryCode: provider.city.countryCode,
          countryName: provider.city.countryName,
        }
      : null;

    const run = await this.prisma.parserRunLog.create({
      data: { providerId, status: 'RUNNING', triggeredBy },
    });

    // Ретенция детального лога (см. doc/TZ-parser-import-improvements.md, П1.2) — "заодно, раз
    // уж всё равно идёт очередной проход", без отдельного cron-задания. Не должна блокировать/
    // ронить сам импорт при сбое — cleanupOld() сама глотает ошибки.
    await this.importLog.cleanupOld();

    const stats: RunStats = {
      discoveredCount: 0,
      newCount: 0,
      updatedCount: 0,
      geocodedCount: 0,
      autoImportedCount: 0,
      needsReviewCount: 0,
      rejectedCount: 0,
      errorCount: 0,
    };

    const startedAt = Date.now();

    try {
      const adapter = this.resolveAdapter(provider);
      const { items, diagnostics } = await adapter.discover();
      stats.discoveredCount = items.length;

      // П0.1: явный, заметный сигнал, если источник не нашёл ни одной камеры. Раньше (когда
      // существовал только webcam.guru.ua) самой частой причиной была смена вёрстки сайта —
      // формулировка ниже тогда прямо на это указывала. Теперь адаптеров с реальным API без
      // HTML-скрапинга (YouTube/Google/Windy/NYC TMC) больше, чем HTML-скрапинга — "проверьте
      // вёрстку" для них была бы прямо неверной подсказкой (нет никакой вёрстки, есть только
      // ответ API). Формулировка ниже нейтральна к типу источника — конкретную причину всегда
      // смотреть в diagnostics.reason (заполняется каждым адаптером самостоятельно, см.
      // WindyWebcamsAdapter/NycTmcAdapter/YoutubeSearchAdapter — все заполняют diagnostics.reason
      // при пустом результате).
      await this.importLog.log({
        runId: run.id,
        providerId,
        level: items.length === 0 ? 'WARN' : 'INFO',
        stage: 'FETCH_PAGE',
        message:
          items.length === 0
            ? `Источник не вернул ни одной камеры${diagnostics?.reason ? `: ${diagnostics.reason}` : ' — см. diagnostics для деталей (для HTML-источников обычно означает смену вёрстки/селекторов, для API-источников — ошибку запроса или пустой ответ)'}.`
            : `Найдено ${items.length} камер (см. diagnostics для деталей: сколько найдено в списке vs сколько удалось дозапросить).`,
        metadata: diagnostics,
      });

      const timeBudgetMs = getRunTimeBudgetMs();
      let truncatedByTimeBudget = false;

      // Конкурентність = 1 (стара, послідовна поведінка) для адаптерів із fetchDetails() —
      // вони самі роблять по одному мережевому запиту на елемент до САЙТА-ДЖЕРЕЛА
      // (webcam.guru.ua, знайдені Google-пошуком сторінки) — паралелити ці запити означало б
      // одночасно бомбардувати чужий сайт кількома запитами замість ввічливого одного за раз,
      // чого свідомо уникали з самого початку. Для адаптерів БЕЗ fetchDetails() (NYC TMC,
      // Windy, YouTube — усі дані вже отримані одним викликом у discover()) конкурентність
      // безпечна: єдиний реальний per-item мережевий виклик — Overpass API (сторонній,
      // спільний геосервіс, не сайт-джерело), тому паралельна обробка не шкодить jerelu.
      const concurrency = adapter.fetchDetails ? 1 : getItemConcurrency();

      // Батчування Overpass-запитів (глибша переробка — див. запит користувача, точку
      // відновлення збережено окремо перед цією зміною). ЕЛЕГАНТНЕ рішення без зміни
      // processItem()/сигнатури виклику azimuthHeuristic.guessForPoint() нижче взагалі: тут
      // лише ПРОГРІВАЄТЬСЯ той самий кеш по сітці координат, яким guessForPoint() уже
      // користується — сам виклик у processItem() лишається без жодних змін, просто отримує
      // кеш-хіт замість власного мережевого запиту для точок, прогрітих тут. Стосується лише
      // елементів з прямими координатами (suggestedLat/suggestedLng — NYC TMC та подібні
      // джерела); елементи без них (де координати відомі лише ПІСЛЯ геокодингу тексту
      // всередині processItem()) прогріти заздалегідь неможливо — для них guessForPoint()
      // і далі робить власний одноточковий запит, як і раніше.
      if (!adapter.fetchDetails) {
        const pointsToWarm = items
          .filter((item) => typeof item.suggestedLat === 'number' && typeof item.suggestedLng === 'number')
          .map((item) => ({ lat: item.suggestedLat as number, lng: item.suggestedLng as number }));

        const OVERPASS_BATCH_SIZE = 20;
        for (let i = 0; i < pointsToWarm.length; i += OVERPASS_BATCH_SIZE) {
          try {
            // provider.city?.slug ДОДАНО (за прямим запитом користувача — "используй кеш overpass
            // by city сначала, а уже потом фоллбеком..."): дозволяє guessForPoints() спершу
            // перевірити ВЖЕ згенерований BTW-тайл цього міста (streets.json), перш ніж бити
            // живий Overpass — весь цей провайдер прив'язаний до ОДНОГО міста (§ resolveAdapter()
            // вище й так вимагає provider.city для більшості адаптерів).
            await this.azimuthHeuristic.guessForPoints(pointsToWarm.slice(i, i + OVERPASS_BATCH_SIZE), provider.city?.slug ?? null);
          } catch (err) {
            // Прогрів кешу — суто оптимізація; якщо групований запит не вдався (мережа,
            // Overpass недоступний тощо), просто не прогріваємо — processItem() однаково
            // зробить власний одноточковий запит на кожен елемент нижче (той самий fallback,
            // що й до цієї зміни, лише без пришвидшення).
            this.logger.warn(`Не удалось прогреть кеш азимутов пачкой (${pointsToWarm.length} точек): ${(err as Error).message}`);
          }
        }
      }

      for (let batchStart = 0; batchStart < items.length; batchStart += concurrency) {
        if (Date.now() - startedAt > timeBudgetMs) {
          truncatedByTimeBudget = true;
          const remaining = items.length - batchStart;
          const message = `Проход остановлен по бюджету времени (${timeBudgetMs}мс) — не обработано ещё ${remaining} из ${items.length} найденных камер. Они будут обработаны на следующем проходе (уже импортированные/отклонённые элементы пропускаются повторно, см. SKIPPED_ALREADY_RESOLVED).`;
          this.logger.warn(message);
          await this.importLog.log({ runId: run.id, providerId, level: 'WARN', stage: 'ERROR', message });
          break;
        }

        const batch = items.slice(batchStart, batchStart + concurrency);
        await Promise.all(
          batch.map(async (item) => {
            try {
              const resolvedItem = await this.resolveItemDetails(adapter, item);
              if (!resolvedItem) {
                stats.errorCount += 1;
                const message = `Не удалось дозапросить детали камеры "${item.externalId}" от ${provider.name} (страница камеры недоступна или её вёрстка не распозналась).`;
                this.logger.warn(message);
                await this.importLog.log({ runId: run.id, providerId, level: 'ERROR', stage: 'ERROR', externalId: item.externalId, message });
                // Затримка-ввічливість до САЙТА-ДЖЕРЕЛА (fetchDetails) — не потрібна для
                // адаптерів без цієї фази, там нема кого "берегти" повторним запитом.
                if (adapter.fetchDetails) await sleep(getDetailFetchDelayMs());
                return;
              }

              await this.processItem(run.id, provider.id, provider.cityId, provider.city?.slug ?? null, cityHint, resolvedItem, stats, adapter);
              if (adapter.fetchDetails) await sleep(getDetailFetchDelayMs());
            } catch (itemErr) {
              stats.errorCount += 1;
              const message = `Не удалось обработать камеру "${item.externalId}" от ${provider.name}: ${(itemErr as Error).message}`;
              this.logger.warn(message);
              await this.importLog.log({
                runId: run.id,
                providerId,
                level: 'ERROR',
                stage: 'ERROR',
                externalId: item.externalId,
                message,
              });
            }
          }),
        );
      }

      const anomalyFlag = await this.detectAnomaly(providerId, stats.discoveredCount);
      if (anomalyFlag) {
        await this.importLog.log({
          runId: run.id,
          providerId,
          level: 'WARN',
          stage: 'FETCH_PAGE',
          message: `Найдено ${stats.discoveredCount} камер — заметно отличается от обычного для этого источника (см. историю проходов). Возможна поломка вёрстки источника или баг парсинга.`,
        });
      }

      return this.prisma.parserRunLog.update({
        where: { id: run.id },
        data: {
          status: stats.errorCount > 0 || truncatedByTimeBudget ? 'PARTIAL' : 'SUCCESS',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          anomalyFlag,
          ...stats,
        },
      });
    } catch (err) {
      await this.importLog.log({
        runId: run.id,
        providerId,
        level: 'ERROR',
        stage: 'ERROR',
        message: `Проход завершился ошибкой: ${(err as Error).message}`,
      });

      return this.prisma.parserRunLog.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          errorMessage: (err as Error).message?.slice(0, 2000),
          ...stats,
        },
      });
    }
  }

  // Health-сигнал (см. doc/TZ-parser-import-improvements.md, П2.3) — сравнивает discoveredCount
  // текущего прохода со скользящим средним последних успешных проходов ЭТОГО ЖЕ источника.
  // Резкое отклонение в любую сторону подозрительно: падение обычно значит "вёрстка источника
  // изменилась, селекторы больше не совпадают" (см. П0.1), рост — тоже стоит проверить (баг
  // парсинга/дублирование элементов).
  // Охват всех городов (см. doc/TZ-parser-import-improvements.md, П2.2) — раньше pg_cron бил
  // по одному захардкоженному providerId, все остальные города импортировались только вручную.
  // Обходит ВСЕ строки CameraProvider (не фильтрует по adapterKey заранее — resolveAdapter()
  // внутри runForProvider() сам решит, поддержан ли адаптер, и корректно пометит проход FAILED,
  // если нет; так не дублируется логика "какие adapterKey поддержаны" в двух местах). Задержка
  // между провайдерами (PARSER_RUN_ALL_DELAY_MS, по умолчанию 2с) — вежливость по отношению к
  // внешнему сайту-источнику, не долбить его параллельно по 20 городам одновременно.
  // adapterKeyPrefix (див. doc/TZ-youtube-camera-discovery.md) — дозволяє запускати окремі
  // сімейства адаптерів на РІЗНИХ cron-розкладах: youtube-search-* коштує реальну квоту
  // YouTube Data API (100 одиниць/виклик, ~90 безпечних викликів/добу — див. ТЗ, П1) і НЕ може
  // ганятись на тому самому частому розкладі, що webcam-guru-* (безкоштовний скрапінг).
  // Без параметра — стара поведінка, усі провайдери одразу (зворотна сумісність).
  // adapterKeyPrefix/excludeAdapterKeyPrefix (див. doc/TZ-youtube-camera-discovery.md) —
  // дозволяє запускати окремі сімейства адаптерів на РІЗНИХ cron-розкладах: youtube-search-*
  // коштує реальну квоту YouTube Data API (100 одиниць/виклик, ~90 безпечних викликів/добу —
  // див. ТЗ, П1) і НЕ повинен подвійно тригеритись і загальним run-all(), і власним окремим
  // job'ом одночасно — тому загальний виклик явно ВИКЛЮЧАЄ youtube-search-*, а окремий
  // youtube-специфічний виклик явно ВКЛЮЧАЄ тільки його (див. controller). Без опцій — стара
  // поведінка, усі провайдери одразу (зворотна сумісність).
  async runAll(triggeredBy: 'cron' | 'manual' = 'cron', options?: { adapterKeyPrefix?: string; excludeAdapterKeyPrefix?: string | string[] }) {
    const excludePrefixes = options?.excludeAdapterKeyPrefix
      ? Array.isArray(options.excludeAdapterKeyPrefix)
        ? options.excludeAdapterKeyPrefix
        : [options.excludeAdapterKeyPrefix]
      : [];

    const providers = await this.prisma.cameraProvider.findMany({
      where: {
        ...(options?.adapterKeyPrefix ? { adapterKey: { startsWith: options.adapterKeyPrefix } } : {}),
        ...(excludePrefixes.length ? { AND: excludePrefixes.map((p) => ({ adapterKey: { not: { startsWith: p } } })) } : {}),
      },
    });
    const results: { providerId: string; providerName: string; runId: string; status: string }[] = [];

    for (const provider of providers) {
      const run = await this.runForProvider(provider.id, triggeredBy);
      results.push({ providerId: provider.id, providerName: provider.name, runId: run.id, status: run.status });
      await sleep(getRunAllDelayMs());
    }

    return results;
  }

  // Dry-run (см. doc/TZ-parser-import-improvements.md, П3.1) — прогоняет discover() (и,
  // опционально, геокодинг при deep=true) БЕЗ единой записи в БД: ни CameraSourceRaw, ни
  // Camera, ни ParserRunLog, ни ImportLogEntry. Основной сценарий — проверить починку
  // селекторов (см. П0.1) не трогая боевые данные. deep=false (по умолчанию) — только сырое
  // обнаружение (быстро, бесплатно); deep=true — вдобавок классифицирует каждый элемент так
  // же, как processItem() решал бы для него в реальном проходе (IMPORTED vs NEEDS_REVIEW), но
  // всё ещё ничего не сохраняя — стоит реальных вызовов геокодинга, поэтому не включено по
  // умолчанию.
  async dryRun(providerId: string, deep: boolean) {
    const provider = await this.prisma.cameraProvider.findUniqueOrThrow({
      where: { id: providerId },
      include: { city: true },
    });
    const cityHint: CityHint | null = provider.city
      ? {
          name: provider.city.name,
          lat: provider.city.lat,
          lng: provider.city.lng,
          countryCode: provider.city.countryCode,
          countryName: provider.city.countryName,
        }
      : null;

    const adapter = this.resolveAdapter(provider);
    const { items, diagnostics } = await adapter.discover();

    if (!deep) {
      return {
        deep: false,
        discoveredCount: items.length,
        diagnostics,
        preview: items.map((item) => ({
          externalId: item.externalId,
          title: item.title,
          streamType: item.streamType,
          hasLocationText: !!item.locationText,
          locationText: item.locationText ?? null,
        })),
      };
    }

    const preview = await Promise.all(
      items.map(async (item) => {
        if (!item.locationText) {
          return { externalId: item.externalId, title: item.title, wouldBe: 'NEEDS_REVIEW' as const, reason: 'Нет текста адреса у источника.' };
        }

        const geocoded = await this.geocoding.geocode(item.locationText, cityHint);
        if (!geocoded) {
          return {
            externalId: item.externalId,
            title: item.title,
            wouldBe: 'NEEDS_REVIEW' as const,
            reason: 'Геокодинг не вернул результата.',
            locationText: item.locationText,
          };
        }
        if (geocoded.confidence < GEOCODE_CONFIDENCE_THRESHOLD) {
          return {
            externalId: item.externalId,
            title: item.title,
            wouldBe: 'NEEDS_REVIEW' as const,
            reason: `Уверенность геокодинга ${geocoded.confidence.toFixed(2)} ниже порога ${GEOCODE_CONFIDENCE_THRESHOLD}.`,
            locationText: item.locationText,
            lat: geocoded.lat,
            lng: geocoded.lng,
          };
        }

        return {
          externalId: item.externalId,
          title: item.title,
          wouldBe: 'IMPORTED' as const,
          lat: geocoded.lat,
          lng: geocoded.lng,
          confidence: geocoded.confidence,
        };
      }),
    );

    return { deep: true, discoveredCount: items.length, diagnostics, preview };
  }

  private async detectAnomaly(providerId: string, currentDiscoveredCount: number): Promise<boolean> {
    const recentRuns = await this.prisma.parserRunLog.findMany({
      where: { providerId, status: { in: ['SUCCESS', 'PARTIAL'] } },
      orderBy: { startedAt: 'desc' },
      take: getAnomalyHistorySize(),
    });

    // Недостаточно истории, чтобы понять, что "нормально" для этого источника — не поднимаем
    // тревогу на первых нескольких проходах.
    if (recentRuns.length < getAnomalyMinHistory()) return false;

    const average = recentRuns.reduce((sum, r) => sum + r.discoveredCount, 0) / recentRuns.length;
    // Среднее само равно 0 — значит источник и раньше стабильно ничего не находил (например,
    // селекторы уже давно сломаны, см. П0.1) — это не "новая" аномалия относительно истории,
    // отдельный WARN на уровне FETCH_PAGE (см. выше) уже покрывает сам факт нулевого результата.
    if (average === 0) return false;

    const deviation = Math.abs(currentDiscoveredCount - average) / average;
    return deviation > getAnomalyThreshold();
  }

  // Дозапрос деталей элемента для двухфазных адаптеров (см. ProviderAdapter.fetchDetails и
  // WebcamGuruAdapter — реальный источник, у которого страница-список не содержит streamUrl
  // вообще). Если адаптер не реализует fetchDetails() ИЛИ у item уже есть streamUrl (адаптер
  // отдал его сразу из discover()) — возвращает item как есть, без лишнего запроса.
  private async resolveItemDetails(adapter: ProviderAdapter, item: RawCameraItem): Promise<RawCameraItem | null> {
    if (!adapter.fetchDetails || item.streamUrl) return item;

    const details = await adapter.fetchDetails(item);
    if (!details) return null;

    return { ...item, ...details };
  }

  // Поштучна City-прив'язка для джерел, де ОДИН provider охоплює БАГАТО міст (див. клас-
  // коментар RawCameraItem.suggestedCityName) — за прямим запитом користувача: "добавить при
  // импорте проверку есть ли в базе город провайдер и добавлять если отсутствуют". Спочатку
  // шукає ТОЧНИЙ (case-insensitive) збіг City.name (+ City.countryCode, якщо задано); якщо не
  // знайдено — створює новий City-рядок із того, що дав сам адаптер (suggestedCityName/
  // suggestedCountryCode/suggestedCountryName/suggestedRegion) і координат ЦІЄЇ камери як
  // наближення для City.lat/lng (справжнього центру міста джерело не дає — окремий геокодинг
  // "центру міста" тут навмисно НЕ робиться, це був би зайвий виклик на кожне нове місто; для
  // цілей проєкту (сектор пошуку/відображення на карті) наближення координатами першої знайденої
  // в цьому місті камери достатньо точне — місто однаково не менше кількох км).
  //
  // upsert (НЕ findFirst+create окремо) — items у batch обробляються ПАРАЛЕЛЬНО
  // (Promise.all у runForProvider()), тож кілька камер одного НОВОГО міста в одному batch
  // могли б одночасно не знайти City і спробувати створити його — upsert за унікальним slug
  // атомарний на рівні БД (ON CONFLICT), тому race-умова не породжує дублікат/помилку
  // унікальності: хто б не "виграв" гонку, решта просто отримають той самий рядок назад.
  private async resolveOrCreateCityId(item: RawCameraItem, cameraLat: number, cameraLng: number): Promise<string | null> {
    const cityName = item.suggestedCityName?.trim();
    if (!cityName) return null;

    const countryCode = item.suggestedCountryCode?.trim() || undefined;

    const existing = await this.prisma.city.findFirst({
      where: {
        name: { equals: cityName, mode: 'insensitive' },
        ...(countryCode ? { countryCode } : {}),
      },
    });
    if (existing) return existing.id;

    const slug = await this.uniqueCitySlug(slugify(`${cityName}-${countryCode ?? ''}`));

    this.logger.log(`resolveOrCreateCityId: город "${cityName}" (${countryCode ?? '?'}) не найден в City — создаю новый (slug="${slug}").`);

    const created = await this.prisma.city.upsert({
      where: { slug },
      update: {},
      create: {
        name: cityName,
        slug,
        lat: cameraLat,
        lng: cameraLng,
        region: item.suggestedRegion?.trim() || null,
        countryCode: countryCode ?? 'UA', // City.countryCode не nullable — 'UA' лишається дефолтом схеми, якщо джерело зовсім не дало код країни (для TrafficVisionAdapter це не мало б траплятись — country_code завжди присутній у реальних відповідях обох джерел)
        countryName: item.suggestedCountryName?.trim() || null,
      },
    });
    return created.id;
  }

  // slug мусить бути унікальним (City.slug @unique) — на випадок, якщо ДВА РІЗНІ міста
  // (наприклад, однакова назва в різних областях тієї самої країни — camera-data не завжди дає
  // достатньо деталей, щоб їх відрізнити) згенерують однаковий базовий slug, додаємо числовий
  // суфікс. Малоймовірно на практиці (dedup вище й так спрацьовує за назвою+країною раніше), але
  // без цього другий такий випадок впав би з помилкою унікальності на порожньому місці.
  private async uniqueCitySlug(baseSlug: string): Promise<string> {
    let candidate = baseSlug || 'city';
    let suffix = 2;
    while (await this.prisma.city.findUnique({ where: { slug: candidate }, select: { id: true } })) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async processItem(
    runId: string,
    providerId: string,
    cityId: string | null,
    // citySlug ДОДАНО (за прямим запитом користувача — "используй кеш overpass by city сначала,
    // а уже потом фоллбеком..."), окремо від cityId (Prisma id, не URL-safe slug, який власне
    // потрібен для ключа тайл-кешу в Vercel Blob, § getCityBlobPrefix()).
    citySlug: string | null,
    cityHint: CityHint | null,
    rawItem: RawCameraItem,
    stats: RunStats,
    adapter: ProviderAdapter,
  ) {
    // К этому моменту rawItem уже прошёл через resolveItemDetails() в цикле runForProvider()
    // (см. этот метод выше) — для двухфазных источников (см. doc/AUDIT-webcam-guru-real-html.md)
    // streamUrl/streamType уже дозапрошены ДО вызова processItem(), под уже существующей
    // проверкой бюджета времени на каждой итерации. Проверка ниже — просто защитный барьер на
    // случай, если resolveItemDetails() всё же вернула item без streamUrl по какой-то причине
    // (не должно происходить при корректной работе, но лучше явная ошибка, чем NPE ниже).
    const item = rawItem;
    if (!item.streamUrl || !item.streamType) {
      stats.errorCount += 1;
      await this.importLog.log({
        runId,
        providerId,
        level: 'ERROR',
        stage: 'ERROR',
        externalId: item.externalId,
        message: 'У элемента нет streamUrl/streamType после разрешения деталей — пропущено (не должно происходить в норме).',
      });
      return;
    }

    // С этого места streamUrl/streamType гарантированно заполнены (см. проверку выше) —
    // локальные константы вместо повторных обращений item.streamUrl по всему методу ниже.
    const title = item.title;
    const streamUrl = item.streamUrl;
    const streamType = item.streamType;
    const locationText = item.locationText;

    const existing = await this.prisma.cameraSourceRaw.findUnique({
      where: { providerId_externalId: { providerId, externalId: item.externalId } },
    });

    if (existing) {
      // История изменений (см. doc/TZ-parser-import-improvements.md, П3.3) — вместо отдельной
      // таблицы истории (более тяжёлое решение, ТЗ прямо разрешает не заводить её, если
      // достаточно детального лога — он уже есть после П1.2): если ссылка на поток или
      // название у источника изменились, это отдельная WARN-запись в ImportLogEntry со
      // старым/новым значением в metadata — до того, как затрём старые значения апдейтом ниже.
      const streamUrlChanged = existing.rawStreamUrl !== streamUrl;
      const titleChanged = existing.rawTitle !== title;
      if (streamUrlChanged || titleChanged) {
        await this.importLog.log({
          runId,
          providerId,
          level: 'WARN',
          stage: 'PARSE_ITEM',
          externalId: item.externalId,
          cameraSourceRawId: existing.id,
          message: streamUrlChanged
            ? 'У источника изменилась ссылка на поток по сравнению с предыдущим проходом.'
            : 'У источника изменилось название камеры по сравнению с предыдущим проходом.',
          metadata: {
            ...(streamUrlChanged ? { previousStreamUrl: existing.rawStreamUrl, newStreamUrl: streamUrl } : {}),
            ...(titleChanged ? { previousTitle: existing.rawTitle, newTitle: title } : {}),
          },
        });
      }

      await this.prisma.cameraSourceRaw.update({
        where: { id: existing.id },
        data: { rawStreamUrl: streamUrl, rawTitle: title, scrapedAt: new Date() },
      });
      stats.updatedCount += 1;

      // Already resolved by a previous run or by an admin — nothing further to do automatically.
      if (existing.importStatus === 'IMPORTED' || existing.importStatus === 'REJECTED') {
        await this.importLog.log({
          runId,
          providerId,
          level: 'INFO',
          stage: 'SKIPPED_ALREADY_RESOLVED',
          externalId: item.externalId,
          cameraSourceRawId: existing.id,
          message: `Уже решено ранее (статус: ${existing.importStatus}) — пропущено.`,
        });
        return;
      }
    } else {
      // AI-фильтр релевантности (см. doc/TZ-youtube-camera-discovery.md, П3) — только для
      // НОВЫХ элементов (existing отсутствует), чтобы не тратить AI-вызов повторно на каждом
      // проходе для того же элемента: как только элемент один раз пройдёт фильтр и попадёт в
      // CameraSourceRaw, дальше он идёт по обычному пути (SKIPPED_ALREADY_RESOLVED/обновление
      // существующей записи выше), фильтр релевантности повторно не запускается. Адаптеры без
      // этого метода (webcam.guru.ua — там каждая запись и так гарантированно камера)
      // пропускают эту проверку целиком.
      if (adapter.isRelevant) {
        const relevant = await adapter.isRelevant(item);
        if (!relevant) {
          await this.importLog.log({
            runId,
            providerId,
            level: 'INFO',
            stage: 'PARSE_ITEM',
            externalId: item.externalId,
            message: 'AI отфильтровал элемент как нерелевантный (не похоже на городскую камеру) — не добавлено в очередь ревью.',
          });
          return;
        }
      }
      stats.newCount += 1;
    }

    await this.importLog.log({
      runId,
      providerId,
      level: 'INFO',
      stage: 'PARSE_ITEM',
      externalId: item.externalId,
      message: existing ? 'Обновлена существующая запись источника.' : 'Новая камера найдена у источника.',
      metadata: { title, streamType, hasLocationText: !!locationText },
    });

    const raw =
      existing ??
      (await this.prisma.cameraSourceRaw.create({
        data: {
          providerId,
          externalId: item.externalId,
          sourcePageUrl: item.sourcePageUrl,
          rawTitle: title,
          rawLocationText: locationText ?? null,
          rawStreamUrl: streamUrl,
          importStatus: 'PENDING',
        },
      }));

    // AI-автоматизация (GrokCameraAssistService) сознательно НЕ используется в автоматическом
    // импорте — по прямому запросу пользователя вся AI-обработка вынесена исключительно на
    // этап ручного ревью (см. suggestAiForSourceRaw() ниже и /admin/parser/review, кнопка
    // "Спросить AI"). Раньше AI вызывался здесь на каждую камеру без текста адреса/с неудачным
    // геокодингом — на практике почти всё равно уходило в NEEDS_REVIEW (см.
    // doc/AUDIT-indoor-cameras-and-ai-assist.md), то есть тратило вызовы API без реальной
    // пользы, при этом делая автоматический прогон медленнее и дороже. Если источник не дал
    // текста адреса вовсе — сразу на ревью, без попытки угадать.
    if (!locationText) {
      await this.prisma.cameraSourceRaw.update({
        where: { id: raw.id },
        data: { importStatus: 'NEEDS_REVIEW' },
      });
      stats.needsReviewCount += 1;
      await this.importLog.log({
        runId,
        providerId,
        level: 'WARN',
        stage: 'NEEDS_REVIEW',
        externalId: item.externalId,
        cameraSourceRawId: raw.id,
        message: 'Нет текста адреса у источника — отправлено на ручное ревью (AI-подсказку можно запросить там же).',
      });
      return;
    }

    // Города Украины: geocode() получает подсказку города провайдера (если есть) — иначе
    // ищет "как есть, Україна", без привязки к конкретному городу.
    //
    // Якщо адаптер уже дав точні координати напряму (RawCameraItem.suggestedLat/suggestedLng
    // — див. NycTmcAdapter) — обходимо геокодинг тексту повністю: офіційне джерело з готовими
    // координатами надійніше за спробу геокодити короткий технічний опис на кшталт "WBB - 2
    // NOR @ ABOVE BEDFORD AVE & S 5 St", який звичайний геокодер міг би розпізнати неправильно
    // чи взагалі не розпізнати. confidence: 1 — джерело авторитетне, порогова перевірка нижче
    // проходить автоматично.
    const hasDirectCoords = typeof item.suggestedLat === 'number' && typeof item.suggestedLng === 'number';
    const geocodeResult = hasDirectCoords
      ? { lat: item.suggestedLat as number, lng: item.suggestedLng as number, confidence: 1 }
      : await this.geocoding.geocode(locationText, cityHint);

    if (geocodeResult) stats.geocodedCount += 1;

    await this.importLog.log({
      runId,
      providerId,
      level: geocodeResult ? 'INFO' : 'WARN',
      stage: 'GEOCODE',
      externalId: item.externalId,
      cameraSourceRawId: raw.id,
      message: hasDirectCoords
        ? 'Координаты получены напрямую от источника (без геокодинга текста).'
        : geocodeResult
          ? `Геокодинг: уверенность ${geocodeResult.confidence.toFixed(2)} (порог ${GEOCODE_CONFIDENCE_THRESHOLD}).`
          : 'Геокодинг не вернул результата.',
      metadata: geocodeResult
        ? { lat: geocodeResult.lat, lng: geocodeResult.lng, confidence: geocodeResult.confidence, threshold: GEOCODE_CONFIDENCE_THRESHOLD }
        : { locationText },
    });

    if (!geocodeResult || geocodeResult.confidence < GEOCODE_CONFIDENCE_THRESHOLD) {
      await this.prisma.cameraSourceRaw.update({
        where: { id: raw.id },
        data: {
          importStatus: 'NEEDS_REVIEW',
          guessedLat: geocodeResult?.lat,
          guessedLng: geocodeResult?.lng,
          geocodeConfidence: geocodeResult?.confidence,
        },
      });
      stats.needsReviewCount += 1;
      await this.importLog.log({
        runId,
        providerId,
        level: 'WARN',
        stage: 'NEEDS_REVIEW',
        externalId: item.externalId,
        cameraSourceRawId: raw.id,
        message: 'Уверенность геокодинга ниже порога (или геокодинг не удался) — отправлено на ручное ревью (AI-подсказку можно запросить там же).',
      });
      return;
    }

    const heuristic = await this.azimuthHeuristic.guessForPoint(geocodeResult.lat, geocodeResult.lng, citySlug);
    await this.importLog.log({
      runId,
      providerId,
      level: heuristic.source === 'fallback' ? 'WARN' : 'INFO',
      stage: 'AZIMUTH_HEURISTIC',
      externalId: item.externalId,
      cameraSourceRawId: raw.id,
      message:
        heuristic.source === 'fallback'
          ? 'Эвристика азимута не нашла дорогу рядом (или запрос к Overpass API не удался) — использован фолбэк по умолчанию.'
          : `Азимут определён эвристически: ${heuristic.azimuth.toFixed(0)}° (${heuristic.rangeHint}).`,
      metadata: { azimuthSource: heuristic.source, azimuth: heuristic.azimuth, rangeHint: heuristic.rangeHint },
    });

    // AI (Grok) в автоматический импорт сознательно не вмешивается (см. комментарий выше) —
    // но если сам адаптер даёт ДЕТЕРМИНИРОВАННУЮ подсказку типа локации (см.
    // RawCameraItem.suggestedLocationType — например, категории Windy Webcams API для
    // "пляж"/"природа"/"море", doc/AUDIT-windy-webcams-and-nature-cameras.md), используем её —
    // это не AI-угадывание, а прямые данные от самого источника. Адаптеры без такой
    // информации (webcam.guru.ua, YouTube/Google-поиск) создают камеру как OUTDOOR по
    // умолчанию, как и раньше; если камера на самом деле окажется "внутри помещения"/
    // "природа/пляж", это исправляется вручную через инструмент калибровки.
    const resolvedLocationType = item.suggestedLocationType ?? 'OUTDOOR';

    // Поштучна City-прив'язка (див. RawCameraItem.suggestedCityName/suggestedCountryCode,
    // клас-коментар там же) — потрібно для джерел, де ОДИН provider охоплює БАГАТО міст
    // (TrafficVisionAdapter: bpjt-джерело — платні дороги всієї Індонезії). Якщо жоден City не
    // задовольняє точний (case-insensitive) збіг за name+countryCode — АВТОСТВОРЮЄМО новий (за
    // прямим запитом користувача: "добавить при импорте проверку есть ли в базе город
    // провайдер и добавлять если отсутствуют"), див. resolveOrCreateCityId() нижче. Адаптери,
    // що не задають suggestedCityName (усі, крім TrafficVisionAdapter), лишаються на
    // provider-рівневому cityId — поведінка НЕ змінюється.
    const resolvedCityId = item.suggestedCityName
      ? await this.resolveOrCreateCityId(item, geocodeResult.lat, geocodeResult.lng)
      : cityId;

    const camera = await this.prisma.camera.create({
      data: {
        name: title,
        providerId,
        cityId: resolvedCityId,
        streamUrl,
        streamType,
        lat: geocodeResult.lat,
        lng: geocodeResult.lng,
        azimuth: heuristic.azimuth,
        azimuthSource: heuristic.source,
        fovAngle: DEFAULT_FOV_ANGLE,
        rangeMeters: DEFAULT_RANGE_BY_HINT[heuristic.rangeHint] ?? 200,
        confidence: 'ESTIMATED',
        status: 'UNKNOWN',
        locationType: resolvedLocationType,
      },
    });

    // Камери всередині приміщень/природа-пляж-море (див. doc/README.md) — сектор обзора не
    // строится (нет осмысленного "направления обзора улицы"), см. те же комментарии в
    // resolveSourceRaw()/CameraSubmissionsService.approve() для ручных путей создания камеры.
    if (resolvedLocationType === 'OUTDOOR') {
      await syncCameraPolygon(this.prisma, camera);
    }

    await this.prisma.cameraSourceRaw.update({
      where: { id: raw.id },
      data: {
        importStatus: 'IMPORTED',
        cameraId: camera.id,
        guessedLat: geocodeResult.lat,
        guessedLng: geocodeResult.lng,
        geocodeConfidence: geocodeResult.confidence,
      },
    });
    stats.autoImportedCount += 1;

    await this.importLog.log({
      runId,
      providerId,
      level: 'INFO',
      stage: 'CAMERA_CREATED',
      externalId: item.externalId,
      cameraSourceRawId: raw.id,
      message: `Камера создана автоматически (id: ${camera.id}).`,
      metadata: { cameraId: camera.id },
    });
  }

  // --- Очередь ревью CameraSourceRaw (см. doc/TZ-parser-import-improvements.md, П1.1) ---
  // Действия здесь НЕ пишутся в ImportLogEntry: тот журнал привязан к конкретному ParserRunLog
  // ("что случилось во время автоматического прохода"), а ручное ревью может происходить днями
  // позже, вне какого-либо прохода — это разные по своей природе события. История ручного
  // решения хранится прямо в CameraSourceRaw (reviewedByTelegramId/reviewedAt/rejectionReason).

  async listSourceRaw(filters: { status?: string; providerId?: string; take?: number; skip?: number }) {
    // По умолчанию — сама очередь (NEEDS_REVIEW), не всё подряд; ?status=all снимает фильтр.
    const status = filters.status === 'all' ? undefined : (filters.status ?? 'NEEDS_REVIEW');

    return this.prisma.cameraSourceRaw.findMany({
      where: { importStatus: status as any, providerId: filters.providerId },
      include: { provider: { select: { name: true } } },
      orderBy: { scrapedAt: 'desc' },
      take: filters.take ?? 50,
      skip: filters.skip ?? 0,
    });
  }

  async getSourceRaw(id: string) {
    const raw = await this.prisma.cameraSourceRaw.findUnique({
      where: { id },
      include: { provider: { include: { city: true } } },
    });
    if (!raw) throw new NotFoundException(`CameraSourceRaw ${id} not found`);
    return raw;
  }

  // Создаёт настоящую Camera из записи очереди — тем же путём, что и авто-импорт
  // (confidence: 'ESTIMATED', status: 'UNKNOWN'; точная геометрия сектора доводится потом уже
  // существующим инструментом калибровки, не здесь). Админ может передать address (геокодируется
  // с подсказкой города источника, как при авто-импорте) ИЛИ lat/lng напрямую, если уже знает
  // координаты — например, скопировал их из карты вручную.
  async resolveSourceRaw(id: string, adminTelegramId: string, dto: ResolveSourceRawDto) {
    const raw = await this.getSourceRaw(id);

    let lat = dto.lat;
    let lng = dto.lng;

    if ((lat === undefined || lng === undefined) && dto.address) {
      const cityHint: CityHint | null = raw.provider.city
        ? {
            name: raw.provider.city.name,
            lat: raw.provider.city.lat,
            lng: raw.provider.city.lng,
            countryCode: raw.provider.city.countryCode,
            countryName: raw.provider.city.countryName,
          }
        : null;
      const geocoded = await this.geocoding.geocode(dto.address, cityHint);
      if (!geocoded) {
        throw new BadRequestException('Не удалось геокодировать указанный адрес — укажите координаты напрямую.');
      }
      lat = geocoded.lat;
      lng = geocoded.lng;
    }

    if (lat === undefined || lng === undefined) {
      throw new BadRequestException('Укажите адрес (для геокодинга) или координаты (lat/lng) напрямую.');
    }

    const isIndoor = dto.locationType === 'INDOOR';

    const camera = await this.prisma.camera.create({
      data: {
        name: dto.name || raw.rawTitle,
        providerId: raw.providerId,
        cityId: raw.provider.cityId,
        streamUrl: raw.rawStreamUrl ?? raw.sourcePageUrl,
        streamType: dto.streamType,
        lat,
        lng,
        azimuth: dto.azimuth ?? 0,
        azimuthSource: 'manual',
        fovAngle: dto.fovAngle ?? DEFAULT_FOV_ANGLE,
        rangeMeters: dto.rangeMeters ?? 200,
        confidence: 'ESTIMATED',
        status: 'UNKNOWN',
        locationType: isIndoor ? 'INDOOR' : 'OUTDOOR',
      },
    });

    if (!isIndoor) {
      await syncCameraPolygon(this.prisma, camera);
    }

    await this.prisma.cameraSourceRaw.update({
      where: { id },
      data: {
        importStatus: 'IMPORTED',
        cameraId: camera.id,
        guessedLat: lat,
        guessedLng: lng,
        reviewedByTelegramId: adminTelegramId,
        reviewedAt: new Date(),
      },
    });

    return camera;
  }

  // AI-подсказка по запросу админа (кнопка "Спросить AI" в очереди ревью) — та же логика, что
  // и в автоматическом импорте (см. processItem()), но без автоматического применения: админ
  // видит предложение и сам решает, использовать ли его в форме резолва. Дополнена реальным
  // поиском через Google Places (см. GeocodingService.searchPlace) — по прямому запросу
  // пользователя добавить "AI helper для получения широты/долготы (возможно через google
  // maps)": Grok может честно не знать точных координат ориентира (реальный случай —
  // "Пішохідний міст" без уточнения, какой именно мост среди нескольких), а Places ищет по
  // настоящей базе POI Google Maps — два независимых источника подсказки, не один вместо
  // другого.
  //
  // Nominatim (OpenStreetMap) — бесплатный, без API-ключа источник координат (см. запрос
  // пользователя). В отличие от suggestAiForSourceRaw() ниже (Grok + Google Places, по кнопке
  // "Спросить AI"), этот метод рассчитан на автоматический вызов ПРИ ОТКРЫТИИ карточки в
  // очереди ревью — фронтенд вызывает его сразу, без клика, поэтому throttling для Nominatim
  // (см. GeocodingService.searchPlaceOSM) особенно важен.
  async suggestOsmForSourceRaw(id: string) {
    const raw = await this.getSourceRaw(id);
    const cityHint: CityHint | null = raw.provider.city
      ? {
          name: raw.provider.city.name,
          lat: raw.provider.city.lat,
          lng: raw.provider.city.lng,
          countryCode: raw.provider.city.countryCode,
          countryName: raw.provider.city.countryName,
        }
      : null;

    const result = await this.geocoding.searchPlaceOSM(raw.rawTitle, cityHint);

    return {
      osmLat: result?.lat ?? null,
      osmLng: result?.lng ?? null,
      osmConfidence: result?.confidence ?? 0,
      osmDisplayName: result?.name ?? null,
    };
  }

  // Grok + Google Places — за кнопкою "Спросить AI" (не автоматично, на відміну від
  // suggestOsmForSourceRaw() вище) — обидва коштують запитів/квоти.
  async suggestAiForSourceRaw(id: string) {
    const raw = await this.getSourceRaw(id);
    const cityName = raw.provider.city?.name ?? null;
    const cityHint: CityHint | null = raw.provider.city
      ? {
          name: raw.provider.city.name,
          lat: raw.provider.city.lat,
          lng: raw.provider.city.lng,
          countryCode: raw.provider.city.countryCode,
          countryName: raw.provider.city.countryName,
        }
      : null;

    const [aiSuggestion, placeResult] = await Promise.all([
      this.grokAssist.suggestAddressAndType(raw.rawTitle, raw.rawLocationText, cityName),
      this.geocoding.searchPlace(raw.rawTitle, cityHint),
    ]);

    return {
      ...aiSuggestion,
      placesLat: placeResult?.lat ?? null,
      placesLng: placeResult?.lng ?? null,
      placesConfidence: placeResult?.confidence ?? 0,
      placesName: placeResult?.name ?? null,
      placesFormattedAddress: placeResult?.formattedAddress ?? null,
    };
  }

  async rejectSourceRaw(id: string, adminTelegramId: string, reason?: string) {
    await this.getSourceRaw(id); // 404, если такой записи нет

    return this.prisma.cameraSourceRaw.update({
      where: { id },
      data: {
        importStatus: 'REJECTED',
        reviewedByTelegramId: adminTelegramId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  // Батчове ДОТЯГУВАННЯ азимуту для ВЖЕ ІМПОРТОВАНИХ камер — за прямим запитом користувача
  // (реальний живий інцидент: прогін trafficvision-oktraffic ловив "Overpass: все 4
  // параллельных попытки провалились — ECONNREFUSED" на всі 4 дзеркала одразу, тобто мережа
  // самого середовища на момент прогону не мала виходу до жодного з overpass-хостів — не
  // проблема коду/джерела даних; питання користувача: "то есть текущий парсер импортирует все
  // 649 камер oktraffic ... возможно ли потом в админке батчами дотянуть оверпасс ?").
  //
  // ⚠️ ЧЕСНО: жоден імпортований запис НЕ втрачається через збій Overpass — processItem() і так
  // завжди створює камеру з azimuthSource:'fallback' (azimuth:0, rangeHint:'yard'), якщо
  // AzimuthHeuristicService.guessForPoint() впав чи не знайшов дорогу поруч (§ коментар там
  // же) — це лише ГІРША якість автокалібрування (порожня заглушка замість реального напрямку
  // вздовж дороги), не втрата камери. Тому НЕ потрібно перезапускати весь імпорт (дублікатів
  // не буде — dedup по [providerId, externalId] і так відсіє вже імпортовані елементи, але це
  // все одно зайвий прохід по всьому джерелу заради невеликої частки, що впала). Натомість цей
  // метод точково перебирає ТІЛЬКИ вже існуючі камери з azimuthSource==='fallback' (опційно
  // одного провайдера) і заново пробує ТОЙ САМИЙ Overpass-запит через
  // AzimuthHeuristicService.guessForPoints() — той самий тайл-кеш-спершу + пакетний шлях, що й
  // під час звичайного імпорту (§ прогрів кешу в runForProvider() вище), лише за вже готовими
  // координатами з БД замість щойно спарсених.
  //
  // Групування по citySlug ОБОВ'ЯЗКОВЕ (не можна просто зібрати всі fallback-камери провайдера
  // в один виклик): guessForPoints() приймає ОДИН citySlug на весь пакет точок (перевіряє
  // тайл-кеш САМЕ цього міста), а TrafficVision-джерела (bpjt-) охоплюють багато міст одним
  // провайдером (§ resolveOrCreateCityId() вище) — camera.cityId тут ВЖЕ поставлений на
  // конкретне місто кожної окремої камери (не provider.cityId), тому city зчитується З КОЖНОЇ
  // камери, а не з provider.
  async recalibrateFallbackAzimuths(providerId?: string): Promise<{ totalFallback: number; updated: number; stillFallback: number }> {
    const cameras = await this.prisma.camera.findMany({
      where: {
        azimuthSource: 'fallback',
        deletedAt: null,
        ...(providerId ? { providerId } : {}),
      },
      include: { city: { select: { slug: true } } },
    });

    if (cameras.length === 0) {
      return { totalFallback: 0, updated: 0, stillFallback: 0 };
    }

    const groups = new Map<string, { citySlug: string | null; cameras: typeof cameras }>();
    for (const camera of cameras) {
      const citySlug = camera.city?.slug ?? null;
      const key = citySlug ?? '__no_city__';
      if (!groups.has(key)) groups.set(key, { citySlug, cameras: [] });
      groups.get(key)!.cameras.push(camera);
    }

    // Той самий розмір пачки, що й прогрів кешу під час звичайного імпорту (§ OVERPASS_BATCH_SIZE
    // у runForProvider() вище) — Overpass приймає до 20 точок в одному union-запиті.
    const OVERPASS_BATCH_SIZE = 20;
    let updated = 0;

    for (const { citySlug, cameras: groupCameras } of groups.values()) {
      for (let i = 0; i < groupCameras.length; i += OVERPASS_BATCH_SIZE) {
        const chunk = groupCameras.slice(i, i + OVERPASS_BATCH_SIZE);

        let guesses;
        try {
          guesses = await this.azimuthHeuristic.guessForPoints(
            chunk.map((c) => ({ lat: c.lat, lng: c.lng })),
            citySlug,
          );
        } catch (err) {
          // Overpass і зараз недоступний (та сама мережева проблема) — не критична помилка,
          // просто лишаємо цю пачку fallback, як і раніше; наступний виклик цієї ж кнопки
          // спробує знову.
          this.logger.warn(`recalibrateFallbackAzimuths: пачка з ${chunk.length} камер провалилась: ${(err as Error).message}`);
          continue;
        }

        for (let j = 0; j < chunk.length; j++) {
          const guess = guesses[j];
          if (guess.source === 'fallback') continue; // Overpass і зараз не дав результату для цієї конкретної точки — лишаємо як є

          const camera = chunk[j];
          const updatedCamera = await this.prisma.camera.update({
            where: { id: camera.id },
            data: {
              azimuth: guess.azimuth,
              azimuthSource: guess.source,
              // rangeMeters теж перераховуємо (та сама таблиця DEFAULT_RANGE_BY_HINT, що й при
              // створенні камери) — фолбек-заглушка мала rangeHint:'yard' (80м), реальна
              // еврестика могла визначити дорогу (avenue/street/bridge) з іншою типовою
              // дальністю; без цього оновлення сектор огляду лишився б неправильного розміру
              // навіть після виправлення самого азимуту.
              rangeMeters: DEFAULT_RANGE_BY_HINT[guess.rangeHint] ?? camera.rangeMeters,
            },
          });
          updated += 1;

          // Той самий принцип, що й processItem()/resolveSourceRaw() вище — сектор огляду
          // (fov_polygon) перебудовується лише для OUTDOOR-камер (INDOOR/NATURE не мають
          // осмисленого "напрямку вздовж вулиці").
          if (updatedCamera.locationType === 'OUTDOOR') {
            await syncCameraPolygon(this.prisma, updatedCamera);
          }
        }
      }
    }

    return { totalFallback: cameras.length, updated, stillFallback: cameras.length - updated };
  }
}

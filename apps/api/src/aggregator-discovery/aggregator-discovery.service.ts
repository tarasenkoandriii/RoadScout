import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function getDelayMs(): number {
  const v = parseInt(process.env.AGGREGATOR_DISCOVERY_DELAY_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
}
function getMaxPageFetchBytes(): number {
  const v = parseInt(process.env.WEB_SEARCH_PAGE_FETCH_MAX_BYTES ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 500_000;
}

// Пошук САЙТІВ-АГРЕГАТОРІВ (не окремих камер — див. GoogleWebCameraSearchAdapter для того) —
// див. запит користувача: "окремо сайтів агрегаторів для кожного гео... нова вкладка в
// адмінці, таблиця з урл та орієнтовно кількість камер". Свідомо ОКРЕМИЙ сервіс, не
// ProviderAdapter/ScraperService — результати НЕ камери для імпорту, а кандидати сайтів для
// майбутньої розробки окремих парсерів (той самий принцип "П0-дослідження", що вже описаний у
// doc/TZ-official-open-data-cameras.md).
@Injectable()
export class AggregatorDiscoveryService {
  private readonly logger = new Logger(AggregatorDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly grokAssist: GrokCameraAssistService,
    private readonly registryProxy: RegistryProxyService,
  ) {}

  // Пошук — для всіх українських міст. Той самий Grok web_search tool, що
  // GoogleWebCameraSearchAdapter — сам пошук виконується на серверах xAI, VPN тут не
  // застосовний (див. doc/AUDIT-google-web-search-cameras.md).
  async discoverForAllCities() {
    // Розширення на всі країни (не тільки Україну — див. запит користувача про світове
    // розширення "починаючи з технологічно розвинених країн"): усі City незалежно від країни.
    const cities = await this.prisma.city.findMany();
    return this.discoverForCities(cities);
  }

  // Пошук по одній конкретній країні (див. запит користувача: "дабл клик по стране на
  // странице Сайты-агрегаторы камер — автоматический запуск парсера сайтов агрегаторов именно
  // по этой стране"). Той самий цикл, що discoverForAllCities(), просто звужений список міст —
  // жодного дублювання логіки пошуку/дедуплікації.
  async discoverForCountry(countryCode: string) {
    const cities = await this.prisma.city.findMany({ where: { countryCode } });
    return this.discoverForCities(cities);
  }

  private async discoverForCities(cities: { id: string; name: string; countryName: string | null }[]) {
    let discovered = 0;
    let created = 0;

    for (const city of cities) {
      const found = await this.grokAssist.searchAggregatorSites(city.name, city.countryName ?? 'Украина');
      discovered += found.length;

      for (const site of found) {
        const existing = await this.prisma.aggregatorSiteCandidate.findUnique({ where: { url: site.url } });
        if (existing) continue; // не перезаписуємо вже знайдені — можливо, адмін вже переглянув/оцінив

        await this.prisma.aggregatorSiteCandidate.create({
          data: {
            url: site.url,
            title: site.title,
            cityId: city.id,
            estimatedCameraCount: site.estimatedCameraCount,
            estimationMethod: site.estimatedCameraCount != null ? 'search_snippet' : null,
          },
        });
        created += 1;
      }

      await sleep(getDelayMs());
    }

    return { citiesSearched: cities.length, discovered, created };
  }

  // ---------------------------------------------------------------------------------------
  // Batch API xAI — ВІДМОВЛЕНО для aggregator-discovery (doc/AUDIT-grok-batch-api.md, розділ
  // "xAI Batch API + web_search: чому пакетний пошук сайтів-агрегаторів скасовано").
  //
  // ⚠️ ЧЕСНО: попри офіційну документацію xAI, що обіцяє "server-side tools (web search...)
  // execute during processing" для Batch API так само, як у реальному часі — РЕАЛЬНИЙ виклик
  // (лог користувача, batch_cfdf2c2c-..., 30/30 completed) показав, що це НЕПРАВДА для
  // web_search: кожна відповідь повертається з message.content: "" і НЕВИКОНАНИМ tool_calls
  // (модель лише ПРОПОНУЄ виклик web_search, але Batch API ніколи його не виконує і не
  // продовжує розмову до фінальної відповіді — на відміну від синхронного /v1/responses).
  // Перевірено (WebFetch офіційних доків xAI): `batch_request` приймає ЛИШЕ ключі responses /
  // image_generation / image_edit / video_generation / video_extension — жодної "chat"-
  // альтернативи не існує; сам `web_search` tool не має прапорця авто-виконання. Тобто це не
  // виправна помилка формату запиту з нашого боку, а реальне обмеження платформи xAI.
  //
  // За прямим вибором користувача ("Отказаться от Batch API для этой задачи (рекомендую)")
  // Batch API для aggregator-discovery ВИМКНЕНО тут (defense in depth — сам сервіс відмовляє,
  // навіть якщо зовнішній cron все ще смикає ендпоінт; див. controller). Batch API й далі
  // ПРАЦЮЄ для camera-calibration (submitAzimuthFovBatch/getAzimuthFovBatchResults у
  // GrokCameraAssistService) — той шлях НЕ використовує tools і не зачеплений цим виправленням.
  //
  // discoverForAllCities()/discoverForCountry() вище (синхронний шлях, без Batch API) —
  // ПОВНІСТЮ РОБОЧІ й НЕ зачеплені цією зміною; це і лишається єдиним способом пошуку
  // сайтів-агрегаторів.
  // ---------------------------------------------------------------------------------------

  async submitBatchDiscovery() {
    return {
      submitted: false,
      reason:
        'Batch API вимкнено для пошуку сайтів-агрегаторів: xAI Batch API не виконує web_search ' +
        'всупереч документації (підтверджено реальним викликом — див. doc/AUDIT-grok-batch-api.md). ' +
        'Використовуйте синхронний пошук ("Запустить поиск по всем городам" / по країні).',
    };
  }

  // Опитування всіх ще не оброблених пакетів — викликається з cron (не при кожному запиті
  // користувача). ⚠️ Оскільки submitBatchDiscovery() більше не створює нових job — це лишено
  // лише для того, щоб доопрацювати вже наявні (до цього виправлення) записи GrokBatchJob, які
  // окремий SQL-скрипт (sql/) переводить у status='failed'; якщо з якоїсь причини лишиться
  // pending/processing запис поза цим скриптом — нижче все одно нічого корисного не станеться
  // (getBatchResults поверне ті самі порожні content), тож функція просто нешкідливо no-op'иться.
  async processPendingBatches() {
    const pendingJobs = await this.prisma.grokBatchJob.findMany({
      where: { jobType: 'aggregator-discovery', status: { in: ['pending', 'processing'] } },
    });

    let processed = 0;
    let stillPending = 0;
    let createdTotal = 0;

    for (const job of pendingJobs) {
      const statusInfo = await this.grokAssist.getBatchStatus(job.xaiBatchId);
      if (!statusInfo) {
        this.logger.warn(`Не удалось получить статус batch ${job.xaiBatchId} — пропускаем до следующего опроса.`);
        stillPending += 1;
        continue;
      }

      // ✅ ВИПРАВЛЕНО за підтвердженим реальним викликом (лог сервера показав точну відповідь
      // xAI): жодного плоского поля "status" немає взагалі — є лише вкладений "state" з
      // num_requests/num_pending/num_success/num_error/num_cancelled. Готовність batch —
      // pendingCount === 0 (більше нічого не очікує обробки), НЕ completedCount === totalCount
      // (частина запитів могла завершитись помилкою — num_error — тоді num_success ніколи не
      // дорівнюватиме num_requests, попри те, що сам batch уже дійсно готовий).
      const isActuallyDone = statusInfo.totalCount > 0 && statusInfo.pendingCount === 0;
      if (!isActuallyDone) {
        stillPending += 1;
        continue;
      }

      const resultsByRequestId = await this.grokAssist.getBatchResults(job.xaiBatchId);
      const requestMap = job.requestMap as Record<string, { cityId: string; cityName: string }>;

      for (const [batchRequestId, cityInfo] of Object.entries(requestMap)) {
        const sites = resultsByRequestId[batchRequestId] ?? [];
        for (const site of sites) {
          const existing = await this.prisma.aggregatorSiteCandidate.findUnique({ where: { url: site.url } });
          if (existing) continue;

          await this.prisma.aggregatorSiteCandidate.create({
            data: {
              url: site.url,
              title: site.title,
              cityId: cityInfo.cityId,
              estimatedCameraCount: site.estimatedCameraCount,
              estimationMethod: site.estimatedCameraCount != null ? 'search_snippet' : null,
            },
          });
          createdTotal += 1;
        }
      }

      // Той самий принцип, що вже виправлено в CamerasService.processPendingCalibrationBatches()
      // — якщо жоден запит у пачці не дав РОЗПАРСЕНОГО результату (resultsByRequestId
      // порожній) попри непорожній requestMap, це сильний сигнал зламаного парсингу, а не
      // "усі міста легітимно не мають сайтів-агрегаторів" (та ситуація дала б непорожні ключі
      // з порожніми масивами sites, не повністю порожній словник). Не позначаємо "completed",
      // щоб наступний прохід спробував ще раз після виправлення парсингу.
      const requestMapSize = Object.keys(requestMap).length;
      if (requestMapSize > 0 && Object.keys(resultsByRequestId).length === 0) {
        this.logger.warn(`processPendingBatches: batch ${job.xaiBatchId} завершён (${requestMapSize} городов в пачке), но не удалось извлечь НИ ОДНОГО результата — вероятно, парсинг ответа сломан. Job оставлен в processing для повторной попытки.`);
        await this.prisma.grokBatchJob.update({ where: { id: job.id }, data: { status: 'processing' } });
        stillPending += 1;
        continue;
      }

      await this.prisma.grokBatchJob.update({ where: { id: job.id }, data: { status: 'completed', processedAt: new Date() } });
      processed += 1;
    }

    return { processed, stillPending, createdTotal };
  }

  async listCandidates() {
    return this.prisma.aggregatorSiteCandidate.findMany({
      orderBy: { discoveredAt: 'desc' },
      // countryCode/countryName — для нової колонки "Страна" в адмінці (див. запит користувача).
      include: { city: { select: { name: true, countryCode: true, countryName: true } } },
    });
  }

  // Уточнення оцінки — наш сервер САМ відвідує сайт (на відміну від самого пошуку) — тому VPN
  // (RegistryProxyService) тут застосовний і використовується. Проста евристика замість AI —
  // рахуємо посилання, схожі на записи камер (щоб не витрачати AI-виклик на кожен сайт, коли
  // досить грубої оцінки для пріоритезації, які сайти вартий подальшого ручного дослідження).
  async refineEstimate(id: string) {
    const candidate = await this.prisma.aggregatorSiteCandidate.findUnique({ where: { id } });
    if (!candidate) return null;

    try {
      const html = await this.fetchPage(candidate.url);
      const count = this.estimateCameraLinksCount(html);

      const updated = await this.prisma.aggregatorSiteCandidate.update({
        where: { id },
        data: { estimatedCameraCount: count, estimationMethod: 'page_visit', lastCheckedAt: new Date() },
      });
      return updated;
    } catch (err) {
      this.logger.warn(`refineEstimate failed for ${candidate.url}: ${(err as Error).message}`);
      return null;
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const fetchOne = (axiosConfig: object) =>
      axios.get(url, {
        ...axiosConfig,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadScoutBot/1.0)' },
        timeout: 15000,
        maxContentLength: getMaxPageFetchBytes(),
        responseType: 'text',
      });

    const res = (await this.registryProxy.request(fetchOne)).data;
    return typeof res.data === 'string' ? res.data : '';
  }

  // Груба евристика, не точний підрахунок — рахує посилання (<a href=...>) з текстом, що
  // натякає на "окрема камера" (номер камери, назва вулиці/площі поруч зі словом "камера" тощо).
  // Мета — орієнтовна оцінка для сортування кандидатів у таблиці, не точна цифра.
  private estimateCameraLinksCount(html: string): number {
    const matches = html.match(/<a\b[^>]*>[^<]{0,80}<\/a>/gi) ?? [];
    const cameraLike = matches.filter((m) => /камер|webcam|веб.?камера|cam\d|онлайн/i.test(m));
    return cameraLike.length;
  }
}

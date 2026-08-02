import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ScraperService } from './scraper.service';
import { CronSecretGuard } from './guards/cron-secret.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from '../auth/admin.guard';
import { RegistryProxyService } from './proxy/registry-proxy.service';
import { ImportLogService, ImportLogLevel, ImportLogStage } from './import-log.service';
import { ResolveSourceRawDto } from './dto/resolve-source-raw.dto';
import { RejectSourceRawDto } from './dto/reject-source-raw.dto';

@Controller()
export class ScraperController {
  constructor(
    private readonly scraperService: ScraperService,
    private readonly prisma: PrismaService,
    private readonly registryProxy: RegistryProxyService,
    private readonly importLog: ImportLogService,
  ) {}

  // Triggered by Supabase pg_cron via pg_net http_post — not exposed to the frontend,
  // authenticated via shared secret instead of a Telegram session (see CronSecretGuard).
  @UseGuards(CronSecretGuard)
  @Post('internal/parser/run/:providerId')
  async runFromCron(@Param('providerId') providerId: string) {
    return this.scraperService.runForProvider(providerId, 'cron');
  }

  // Охват всех городов (см. doc/TZ-parser-import-improvements.md, П2.2) — один cron-job вместо
  // отдельной записи расписания на каждый CameraProvider (см. sql/pg_cron-schedule.sql).
  @UseGuards(CronSecretGuard)
  @Post('internal/parser/run-all')
  async runAllFromCron() {
    return this.scraperService.runAll('cron', { excludeAdapterKeyPrefix: ['youtube-search', 'web-search', 'windy'] });
  }

  // "Запустить все источники сейчас" в админке — тот же runAll(), вручную.
  @UseGuards(AdminGuard)
  @Post('admin/parser/run-all')
  async runAllManually() {
    return this.scraperService.runAll('manual', { excludeAdapterKeyPrefix: ['youtube-search', 'web-search', 'windy'] });
  }

  // Окремий, значно рідший розклад для youtube-search-* (див.
  // doc/TZ-youtube-camera-discovery.md, П1) — реальна квота YouTube Data API, не можна
  // ганяти на тому самому частому cron, що безкоштовний webcam-guru-*. Явно ВКЛЮЧАЄ тільки
  // youtube-search-*, щоб не тригеритись двічі разом із загальним run-all() вище.
  @UseGuards(CronSecretGuard)
  @Post('internal/parser/run-all-youtube')
  async runAllYoutubeFromCron() {
    return this.scraperService.runAll('cron', { adapterKeyPrefix: 'youtube-search' });
  }

  @UseGuards(AdminGuard)
  @Post('admin/parser/run-all-youtube')
  async runAllYoutubeManually() {
    return this.scraperService.runAll('manual', { adapterKeyPrefix: 'youtube-search' });
  }

  // Окремий розклад для web-search-* (пошук окремих камер через Google/Grok web_search, див.
  // doc/AUDIT-google-web-search-cameras.md) — той самий принцип взаємного виключення, що й
  // youtube-search вище: явно ВКЛЮЧАЄ тільки web-search-*, не тригериться разом з іншими.
  @UseGuards(CronSecretGuard)
  @Post('internal/parser/run-all-websearch')
  async runAllWebSearchFromCron() {
    return this.scraperService.runAll('cron', { adapterKeyPrefix: 'web-search' });
  }

  @UseGuards(AdminGuard)
  @Post('admin/parser/run-all-websearch')
  async runAllWebSearchManually() {
    return this.scraperService.runAll('manual', { adapterKeyPrefix: 'web-search' });
  }

  // Окремий розклад для windy-* (Windy Webcams API, див.
  // doc/AUDIT-windy-webcams-and-nature-cameras.md) — той самий принцип взаємного виключення.
  @UseGuards(CronSecretGuard)
  @Post('internal/parser/run-all-windy')
  async runAllWindyFromCron() {
    return this.scraperService.runAll('cron', { adapterKeyPrefix: 'windy' });
  }

  @UseGuards(AdminGuard)
  @Post('admin/parser/run-all-windy')
  async runAllWindyManually() {
    return this.scraperService.runAll('manual', { adapterKeyPrefix: 'windy' });
  }

  // "Запустить сейчас" button in the admin panel.
  @UseGuards(AdminGuard)
  @Post('admin/parser/run/:providerId')
  async runManually(@Param('providerId') providerId: string) {
    return this.scraperService.runForProvider(providerId, 'manual');
  }

  // Dry-run (см. doc/TZ-parser-import-improvements.md, П3.1) — ничего не пишет в БД, только
  // показывает, что было бы найдено/импортировано. ?deep=true дополнительно классифицирует
  // элементы через реальный геокодинг (стоит реальных вызовов, поэтому по умолчанию выключено).
  @UseGuards(AdminGuard)
  @Post('admin/parser/dry-run/:providerId')
  async dryRun(@Param('providerId') providerId: string, @Query('deep') deep?: string) {
    return this.scraperService.dryRun(providerId, deep === 'true');
  }

  // "VPN" (registry-scan proxy) config status for the admin panel — never returns credentials,
  // only whether it's configured and which proxy host would be used. Doesn't do a live
  // connectivity check by itself; actual reachability shows up per-run via ParserRunLog/logs
  // when a scan falls back to a direct request (see RegistryProxyService.request()).
  @UseGuards(AdminGuard)
  @Get('admin/parser/proxy-status')
  proxyStatus() {
    return {
      configured: this.registryProxy.isConfigured(),
      proxyHost: this.registryProxy.proxyHostForDisplay(),
    };
  }

  // Full log of every pass (cron + manual) with per-run stats — "лог крона с результатами"
  @UseGuards(AdminGuard)
  @Get('admin/parser/runs')
  async listRuns(
    @Query('providerId') providerId?: string,
    @Query('status') status?: string,
    @Query('take') take = '30',
    @Query('skip') skip = '0',
  ) {
    return this.prisma.parserRunLog.findMany({
      where: {
        providerId: providerId || undefined,
        status: (status as any) || undefined,
      },
      include: { provider: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: Number(take),
      skip: Number(skip),
    });
  }

  @UseGuards(AdminGuard)
  @Get('admin/parser/runs/:id')
  async getRun(@Param('id') id: string) {
    return this.prisma.parserRunLog.findUniqueOrThrow({
      where: { id },
      include: { provider: true },
    });
  }

  // Детальный пошаговый журнал импорта (см. doc/TZ-parser-import-improvements.md, П1.2) —
  // отдельно от агрегированной сводки выше (listRuns/getRun): что случилось с конкретным
  // элементом на конкретном шаге, а не только итоговые числа по проходу. Отдельная вкладка в
  // админке (не подраздел существующей статистики) — см. фронтенд.
  @UseGuards(AdminGuard)
  @Get('admin/parser/log')
  async listImportLog(
    @Query('runId') runId?: string,
    @Query('providerId') providerId?: string,
    @Query('level') level?: string,
    @Query('stage') stage?: string,
    @Query('externalId') externalId?: string,
    @Query('take') take = '100',
    @Query('skip') skip = '0',
  ) {
    return this.importLog.list({
      runId,
      providerId,
      level: (level as ImportLogLevel) || undefined,
      stage: (stage as ImportLogStage) || undefined,
      externalId,
      take: Number(take),
      skip: Number(skip),
    });
  }

  // Очередь ревью CameraSourceRaw (см. doc/TZ-parser-import-improvements.md, П1.1) — записи,
  // которые парсер нашёл, но не смог однозначно геокодировать/сопоставить с адресом
  // автоматически. По умолчанию — только NEEDS_REVIEW (сама очередь), ?status=all снимает
  // фильтр (видно и уже решённые записи для истории).
  @UseGuards(AdminGuard)
  @Get('admin/parser/source-raw')
  async listSourceRaw(
    @Query('status') status?: string,
    @Query('providerId') providerId?: string,
    @Query('take') take = '50',
    @Query('skip') skip = '0',
  ) {
    return this.scraperService.listSourceRaw({ status, providerId, take: Number(take), skip: Number(skip) });
  }

  @UseGuards(AdminGuard)
  @Get('admin/parser/source-raw/:id')
  async getSourceRaw(@Param('id') id: string) {
    return this.scraperService.getSourceRaw(id);
  }

  // Nominatim (OpenStreetMap) — бесплатный, без API-ключа (см. ScraperService.
  // suggestOsmForSourceRaw). Вызывается фронтендом автоматически при открытии карточки, не по
  // кнопке — в отличие от ai-suggest ниже (Grok + Google Places, требует ключей/квоты).
  @UseGuards(AdminGuard)
  @Post('admin/parser/source-raw/:id/nominatim-suggest')
  nominatimSuggest(@Param('id') id: string) {
    return this.scraperService.suggestOsmForSourceRaw(id);
  }

  // AI-подсказка адреса/типа камеры по запросу (кнопка "Спросить AI" в очереди ревью) —
  // см. GrokCameraAssistService. Ничего не сохраняет, только предлагает.
  @UseGuards(AdminGuard)
  @Post('admin/parser/source-raw/:id/ai-suggest')
  async aiSuggestForSourceRaw(@Param('id') id: string) {
    return this.scraperService.suggestAiForSourceRaw(id);
  }

  // Ручное разрешение записи из очереди в настоящую камеру (адрес геокодируется так же, как при
  // авто-импорте, либо принимаются готовые координаты напрямую).
  @UseGuards(AdminGuard)
  @Post('admin/parser/source-raw/:id/resolve')
  async resolveSourceRaw(@Param('id') id: string, @Body() dto: ResolveSourceRawDto, @Req() req: Request) {
    return this.scraperService.resolveSourceRaw(id, (req as any).telegramId, dto);
  }

  @UseGuards(AdminGuard)
  @Post('admin/parser/source-raw/:id/reject')
  async rejectSourceRaw(@Param('id') id: string, @Body() dto: RejectSourceRawDto, @Req() req: Request) {
    return this.scraperService.rejectSourceRaw(id, (req as any).telegramId, dto.reason);
  }

  // Per-provider summary: total cameras, pending review count, last run, success rate —
  // "конкретная статистика по проходам парсера по списку камер"
  @UseGuards(AdminGuard)
  @Get('admin/parser/stats/summary')
  async statsSummary() {
    // orderBy: createdAt — гарантований, не побічний-ефект-плану-запиту порядок (див. запит
    // користувача про NYC TMC "першим у списку парсерів" + sql/nyctmc-provider-seed.sql).
    const providers = await this.prisma.cameraProvider.findMany({ orderBy: { createdAt: 'asc' } });

    return Promise.all(
      providers.map(async (provider) => {
        const [lastRun, last10, totalCameras, needsReview, fallbackAzimuthCount, heuristicAzimuthCount] = await Promise.all([
          this.prisma.parserRunLog.findFirst({
            where: { providerId: provider.id },
            orderBy: { startedAt: 'desc' },
          }),
          this.prisma.parserRunLog.findMany({
            where: { providerId: provider.id },
            orderBy: { startedAt: 'desc' },
            take: 10,
          }),
          this.prisma.camera.count({ where: { providerId: provider.id, deletedAt: null } }),
          this.prisma.cameraSourceRaw.count({
            where: { providerId: provider.id, importStatus: 'NEEDS_REVIEW' },
          }),
          // Доля камер с фолбэком азимута (см. doc/TZ-parser-import-improvements.md, П2.1) —
          // критерий приёмки: должно быть видно в статистике, не только в детальном логе.
          this.prisma.camera.count({ where: { providerId: provider.id, azimuthSource: 'fallback', deletedAt: null } }),
          this.prisma.camera.count({ where: { providerId: provider.id, azimuthSource: 'heuristic', deletedAt: null } }),
        ]);

        const successCount = last10.filter((r) => r.status === 'SUCCESS').length;

        return {
          providerId: provider.id,
          providerName: provider.name,
          lastRun,
          successRateLast10: last10.length ? Math.round((successCount / last10.length) * 100) : null,
          totalCameras,
          needsReviewCount: needsReview,
          azimuthFallbackCount: fallbackAzimuthCount,
          azimuthHeuristicCount: heuristicAzimuthCount,
        };
      }),
    );
  }
}

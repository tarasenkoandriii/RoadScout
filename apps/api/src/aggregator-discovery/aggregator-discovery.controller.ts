import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AggregatorDiscoveryService } from './aggregator-discovery.service';
import { CronSecretGuard } from '../scraper/guards/cron-secret.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller()
export class AggregatorDiscoveryController {
  constructor(private readonly aggregatorDiscovery: AggregatorDiscoveryService) {}

  @UseGuards(CronSecretGuard)
  @Post('internal/aggregator-discovery/run')
  runFromCron() {
    return this.aggregatorDiscovery.discoverForAllCities();
  }

  @UseGuards(AdminGuard)
  @Post('admin/aggregator-sites/run')
  runManually() {
    return this.aggregatorDiscovery.discoverForAllCities();
  }

  // Дабл-клік по країні на сторінці "Сайты-агрегаторы камер" (див. запит користувача) —
  // запускає пошук ТІЛЬКИ для міст цієї країни, не всього світу.
  @UseGuards(AdminGuard)
  @Post('admin/aggregator-sites/run-country/:countryCode')
  runForCountry(@Param('countryCode') countryCode: string) {
    return this.aggregatorDiscovery.discoverForCountry(countryCode);
  }

  // Batch API xAI (глибша переробка — за прямим запитом користувача, doc/AUDIT-grok-batch-api.md)
  // — подає ВСІ міста одним асинхронним пакетом замість синхронного циклу вище. Окремий
  // cron-виклик (нижче) періодично перевіряє готовність і обробляє результати.
  @UseGuards(CronSecretGuard)
  @Post('internal/aggregator-discovery/submit-batch')
  submitBatchFromCron() {
    return this.aggregatorDiscovery.submitBatchDiscovery();
  }

  @UseGuards(AdminGuard)
  @Post('admin/aggregator-sites/submit-batch')
  submitBatchManually() {
    return this.aggregatorDiscovery.submitBatchDiscovery();
  }

  // Опитування вже поданих пакетів — типово раз на годину чи рідше (Batch API — типово до 24
  // годин на обробку, немає сенсу опитувати частіше).
  @UseGuards(CronSecretGuard)
  @Post('internal/aggregator-discovery/process-pending-batches')
  processPendingBatchesFromCron() {
    return this.aggregatorDiscovery.processPendingBatches();
  }

  // ВАЖЛИВО (реальний знайдений інцидент — 404 "Cannot POST
  // /admin/aggregator-sites/process-pending-batches"): фронтенд (і сторінка сайтів-
  // агрегаторів, і сторінка камер — перевірка при відкритті сторінки, див. запит
  // користувача) викликає САМЕ цей admin-шлях, а не internal/cron-шлях вище — раніше
  // існував тільки останній.
  @UseGuards(AdminGuard)
  @Post('admin/aggregator-sites/process-pending-batches')
  processPendingBatchesManually() {
    return this.aggregatorDiscovery.processPendingBatches();
  }

  @UseGuards(AdminGuard)
  @Get('admin/aggregator-sites')
  list() {
    return this.aggregatorDiscovery.listCandidates();
  }

  // Уточнення оцінки кількості камер за запитом адміна (кнопка в таблиці) — див.
  // AggregatorDiscoveryService.refineEstimate() (реальне відвідування сайту через VPN).
  @UseGuards(AdminGuard)
  @Post('admin/aggregator-sites/:id/refine-estimate')
  refineEstimate(@Param('id') id: string) {
    return this.aggregatorDiscovery.refineEstimate(id);
  }
}

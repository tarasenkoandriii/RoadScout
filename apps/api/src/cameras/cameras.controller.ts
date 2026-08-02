import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Redirect, UseGuards } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { CalibrateCameraDto, UpdateCameraDto } from './dto/update-camera.dto';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CronSecretGuard } from '../scraper/guards/cron-secret.guard';

@Controller()
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  // За прямим запитом користувача — раніше GET / повертав дефолтний Express/NestJS 404
  // ("Cannot GET /"), бо в API взагалі не було жодного маршруту на корінь (це нормально для
  // чистого API-бекенду, але незручно, якщо хтось відкриває сам API-домен у браузері).
  // Редирект саме на GET-ендпоінт списку камер (JSON, не HTML-сторінку адмінки — та
  // лежить в окремому Next.js-застосунку apps/admin, іншому Vercel-деплої).
  @Get()
  @Redirect('/admin/cameras', 302)
  redirectToCamerasList() {}

  // Ембед-віджет для сторонніх сайтів/блогерів (див. doc/README.md, "Ембед-віджет") —
  // навмисно БЕЗ TelegramAuthGuard: сторінка вбудовується на чужому сайті, у відвідувача
  // цього сайту немає (і не повинно бути) власного логіна в RoadScout. Віддає тільки те, що й
  // так публічно видно на самій трансляції (назва/посилання/тип потоку), жодних приватних полів
  // (координати/сектор огляду тощо для ембеда не потрібні).
  @Get('cameras/:id/embed-info')
  async embedInfo(@Param('id') id: string) {
    const camera = await this.camerasService.findOne(id); // findOne() already throws NotFoundException if missing
    // Soft delete (см. doc/AUDIT-camera-soft-delete.md) — findOne() намеренно не фильтрует по
    // deletedAt (нужно админским действиям вроде калибровки/восстановления), но публичный
    // embed-виджет — не админский контекст: удалённая камера здесь должна вести себя как
    // отсутствующая.
    if (camera.deletedAt) throw new NotFoundException(`Camera ${id} not found`);

    return {
      id: camera.id,
      name: camera.name,
      streamUrl: camera.streamUrl,
      streamType: camera.streamType,
      status: camera.status,
    };
  }

  // Public flow (section 3 of the ТЗ): any logged-in Telegram user can search.
  // cityId (см. doc/README.md, "Города Украины") — необязательная подсказка для геокодинга и
  // фильтра камер; без неё поиск идёт по всей стране.
  @UseGuards(TelegramAuthGuard)
  @Get('search')
  search(
    @Query('address') address: string,
    @Query('checkOcclusion') checkOcclusion?: string,
    @Query('cityId') cityId?: string,
  ) {
    return this.camerasService.searchByAddress(address, checkOcclusion === 'true', cityId);
  }

  // Глава 16 ТЗ: /cameras/at-point — same pipeline as /search, from a raw lat/lng
  // (e.g. a tap on the map) instead of a geocoded address.
  @UseGuards(TelegramAuthGuard)
  @Get('cameras/at-point')
  atPoint(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('checkOcclusion') checkOcclusion?: string,
    @Query('cityId') cityId?: string,
  ) {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      throw new BadRequestException('lat and lng query params must be valid numbers');
    }
    return this.camerasService.findAtPoint({ lat: parsedLat, lng: parsedLng }, checkOcclusion === 'true', cityId);
  }

  // --- Admin CRUD (5.2) — requires a Telegram account in ADMIN_TELEGRAM_IDS ---

  @UseGuards(AdminGuard)
  @Get('admin/cameras')
  findAll(@Query('countryCode') countryCode?: string) {
    return this.camerasService.findAll(countryCode);
  }

  // Світова карта (див. запит користувача про світове розширення) — див.
  // CamerasService.getCameraCountByCountry(). ВАЖЛИВО: цей маршрут має бути ЗАРЕЄСТРОВАНИЙ
  // РАНІШЕ за admin/cameras/:id нижче — інакше "stats-by-country" перехопився б туди як :id
  // (NestJS/Express реєструють маршрути в порядку оголошення для того самого HTTP-методу).
  @UseGuards(AdminGuard)
  @Get('admin/cameras/stats-by-country')
  getCameraCountByCountry() {
    return this.camerasService.getCameraCountByCountry();
  }

  // Експорт списку камер провайдера як JSON (див. запит користувача, кнопка на
  // /admin/parser) — ВАЖЛИВО: зареєстровано ПЕРЕД admin/cameras/:id нижче (та сама причина,
  // що й stats-by-country вище — інакше "export" перехопився б туди як :id).
  @UseGuards(AdminGuard)
  @Get('admin/cameras/export/:providerId')
  exportByProvider(@Param('providerId') providerId: string) {
    return this.camerasService.exportByProvider(providerId);
  }

  // Імпорт камер із JSON (див. запит користувача, значок імпорту на /admin/parser).
  @UseGuards(AdminGuard)
  @Post('admin/cameras/import')
  importCameras(@Body() body: { cameras: unknown[] }) {
    if (!Array.isArray(body?.cameras)) {
      throw new BadRequestException('Ожидается тело вида { "cameras": [...] } — массив камер для импорта.');
    }
    return this.camerasService.importCameras(body.cameras);
  }

  @UseGuards(AdminGuard)
  @Get('admin/cameras/:id')
  findOne(@Param('id') id: string) {
    return this.camerasService.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/cameras')
  create(@Body() dto: CreateCameraDto) {
    return this.camerasService.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/cameras/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCameraDto) {
    return this.camerasService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/cameras/:id')
  remove(@Param('id') id: string) {
    return this.camerasService.remove(id);
  }

  // Массовое "Удалить нерабочие" (кнопка над списком камер, см. запит користувача) — POST, не
  // DELETE, чтобы не конфликтовать с маршрутом DELETE admin/cameras/:id выше (иначе строка
  // "offline" попала бы туда как :id). См. CamerasService.removeAllOffline().
  @UseGuards(AdminGuard)
  @Post('admin/cameras/delete-offline')
  removeAllOffline() {
    return this.camerasService.removeAllOffline();
  }

  // Автокалібрування пачками по 10 (див. запит користувача) — див.
  // CamerasService.autoCalibrateBatch(). Немає конфлікту з admin/cameras/:id/ai-calibrate-suggest
  // нижче — різна кількість сегментів шляху, NestJS розрізняє їх незалежно від порядку.
  @UseGuards(AdminGuard)
  @Post('admin/cameras/auto-calibrate-batch')
  autoCalibrateBatch() {
    return this.camerasService.autoCalibrateBatch();
  }

  // Batch API xAI для групової верифікації камер (за прямим запитом користувача, розширення
  // GrokBatchJob) — див. CamerasService.submitCalibrationBatch()/processPendingCalibrationBatches().
  @UseGuards(AdminGuard)
  @Post('admin/cameras/submit-calibration-batch')
  submitCalibrationBatch() {
    return this.camerasService.submitCalibrationBatch();
  }

  // Перевірка завершеності batch-калібрування — викликається і з cron (нижче),
  // і з фронтенду при відкритті сторінки камер (див. запит користувача: "при загрузке
  // страницы камер проверять все батчи на завершенность").
  @UseGuards(AdminGuard)
  @Post('admin/cameras/process-pending-calibration-batches')
  processPendingCalibrationBatches() {
    return this.camerasService.processPendingCalibrationBatches();
  }

  // Той самий виклик, для cron (фонове опитування — типово раз на годину, окремо від
  // перевірки при відкритті сторінки вище).
  @UseGuards(CronSecretGuard)
  @Post('internal/cameras/process-pending-calibration-batches')
  processPendingCalibrationBatchesFromCron() {
    return this.camerasService.processPendingCalibrationBatches();
  }

  // Calibration tool (5.1) — saving here promotes ESTIMATED -> VERIFIED
  @UseGuards(AdminGuard)
  @Patch('admin/cameras/:id/calibrate')
  calibrate(@Param('id') id: string, @Body() dto: CalibrateCameraDto) {
    return this.camerasService.calibrate(id, dto);
  }

  // Автокалибровка (кнопка "🤖 Автокалибровка (ИИ)" на экране калибровки) — см.
  // CamerasService.suggestAzimuthFovForCamera() / GrokCameraAssistService.suggestAzimuthFov().
  // Ничего не сохраняет, только предлагает азимут/FOV по кадру трансляции (если доступен).
  @UseGuards(AdminGuard)
  @Post('admin/cameras/:id/ai-calibrate-suggest')
  aiCalibrateSuggest(@Param('id') id: string) {
    return this.camerasService.suggestAzimuthFovForCamera(id);
  }

  // Проверка доступности видео по запросу (кнопка на экране калибровки — см. запрос
  // пользователя: "недоступное видео"). См. CamerasService.checkAvailabilityForCamera() /
  // GrokCameraAssistService.checkStreamAvailability().
  @UseGuards(AdminGuard)
  @Post('admin/cameras/:id/check-availability')
  checkAvailability(@Param('id') id: string) {
    return this.camerasService.checkAvailabilityForCamera(id);
  }
}

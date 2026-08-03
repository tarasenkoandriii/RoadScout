import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BtwService } from './btw.service';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

// Beyond the Wall (BTW) — контролер, §7 ТЗ (doc/BTW-tz.md). Автентифікація —
// TelegramAuthGuard (той самий шаблон, що вже використовується по всьому проєкту —
// caller-id, "Мой дом" тощо), а НЕ пряма HMAC-перевірка X-Telegram-Init-Data, як буквально
// написано в §7.4 ТЗ — це свідома відповідність вже наявній конвенції автентифікації в
// проєкті, не помилка (обидва підходи однаково безпечні, TelegramAuthGuard перевіряє JWT,
// видану після HMAC-перевірки init-data під час логіну).
@Controller('btw')
export class BtwController {
  constructor(private readonly btwService: BtwService) {}

  @Get('manifest')
  getManifest(@Query('city') city: string) {
    return this.btwService.getManifest(city ?? 'kyiv');
  }

  @Get('status')
  getStatus(@Query('city') city?: string) {
    return this.btwService.getStatus(city);
  }

  // §7 ТЗ формально не має "POST /btw/scan" з тілом пози як HTTP-ендпоінту сканування (у
  // повній версії ТЗ — це серверний ФОЛБЕК, а не основний шлях) — тут це саме він, єдиний
  // шлях у цьому кроці (клієнтський Web Worker не реалізовано, див. AUDIT-btw.md).
  @UseGuards(TelegramAuthGuard)
  @Post('scan')
  scan(
    @Body()
    body: {
      lat: number;
      lng: number;
      accuracyM: number;
      heading: number;
      headingSigma: number;
      targetLat?: number;
      targetLng?: number;
    },
  ) {
    return this.btwService.scan(
      { lat: body.lat, lng: body.lng, accuracyM: body.accuracyM, heading: body.heading, headingSigma: body.headingSigma },
      body.targetLat != null && body.targetLng != null ? { lat: body.targetLat, lng: body.targetLng } : undefined,
    );
  }

  @UseGuards(TelegramAuthGuard)
  @Post('thumb')
  thumb(@Req() req: any, @Body() body: { cameraId: string; targetLat: number; targetLng: number }) {
    return this.btwService.requestThumb(req.telegramId, body.cameraId, body.targetLat, body.targetLng);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('lock')
  lock(@Req() req: any, @Body() body: { cameraId: string; targetLat: number; targetLng: number }) {
    return this.btwService.requestLock(req.telegramId, body.cameraId, body.targetLat, body.targetLng);
  }

  // У5 ТЗ (§5) — vision-уточнення. Ліміт 1/30с реалізовано серверно (BtwService), не лише
  // на клієнті — клієнтський таймер легко обійти (модифікований клієнт), сервер — єдина
  // реальна точка контролю, той самий принцип, що §7.3 ТЗ вимагає для lock/thumb.
  @UseGuards(TelegramAuthGuard)
  @Post('refine')
  refine(@Req() req: any, @Body() body: { cameraId: string; phoneImageDataUrl: string; expectedRelationship: 'ALIGNED' | 'SIDE' | 'OPPOSING' }) {
    return this.btwService.refineHeading(req.telegramId, body.cameraId, body.phoneImageDataUrl, body.expectedRelationship);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('viewpoints')
  saveViewpoint(@Req() req: any, @Body() body: { label: string; lat: number; lng: number; heading: number }) {
    return this.btwService.saveViewpoint(req.telegramId, body.label, body.lat, body.lng, body.heading);
  }

  @UseGuards(TelegramAuthGuard)
  @Get('viewpoints')
  listViewpoints(@Req() req: any) {
    return this.btwService.listViewpoints(req.telegramId);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('report')
  report(@Req() req: any, @Body() body: { cameraId?: string; reason: string }) {
    return this.btwService.report(req.telegramId, body.cameraId, body.reason);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('telemetry')
  telemetry(@Req() req: any, @Body() body: { scans: number; withCandidates: number; locks: number; snapUsed: boolean; fallbackOffered?: number; fallbackUsed?: number }) {
    return this.btwService.telemetry(req.telegramId, body);
  }

  @Get('coverage')
  coverage(@Query('swLat') swLat: string, @Query('swLng') swLng: string, @Query('neLat') neLat: string, @Query('neLng') neLng: string) {
    return this.btwService.coverage(parseFloat(swLat), parseFloat(swLng), parseFloat(neLat), parseFloat(neLng));
  }

  // За прямим запитом користувача — програмний спуфінг GPS для дебагу (не апаратний).
  // Гейт — DEV_AUTO_LOGIN, той самий, що вже вимикає auth.service.ts::devLogin() у
  // продакшені (BtwService.assertDevToolsEnabled() кидає 404, якщо вимкнено).

  // За прямим запитом користувача — вибір міста зі списку (з кількістю придатних для
  // сканування камер) перед підміною координат, замість ручного вводу lat/lng наосліп.
  @UseGuards(AdminGuard)
  @Get('admin/dev-cities')
  listDevCities() {
    return this.btwService.listCitiesWithCameraDensity();
  }

  @UseGuards(AdminGuard)
  @Get('admin/dev-cities/:cityId/densest-point')
  getDensestCameraPoint(@Param('cityId') cityId: string) {
    return this.btwService.findDensestCameraPoint(cityId);
  }

  // Адмінська сторона — керування підмінами (окрема вкладка в адмінці).
  @UseGuards(AdminGuard)
  @Get('admin/dev-location-overrides')
  listDevLocationOverrides() {
    return this.btwService.listDevLocationOverrides();
  }

  @UseGuards(AdminGuard)
  @Post('admin/dev-location-overrides')
  setDevLocationOverride(@Body() body: { telegramId: string; lat: number; lng: number; label?: string }) {
    return this.btwService.setDevLocationOverride(body.telegramId, body.lat, body.lng, body.label);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/dev-location-overrides/:telegramId')
  clearDevLocationOverride(@Param('telegramId') telegramId: string) {
    return this.btwService.clearDevLocationOverride(telegramId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/telemetry')
  listTelemetry() {
    return this.btwService.listTelemetry();
  }

  // Клієнтська сторона — сам BTW-клієнт викликає це БЕЗУМОВНО (той самий підхід, що
  // GET /auth/dev-accounts) перед реальним navigator.geolocation, щоб дізнатись, чи є для
  // ЦЬОГО конкретного telegram-юзера активна підміна. Повертає null, якщо гейт вимкнений АБО
  // підміни просто немає — сервер сам вирішує, не клієнт.
  @UseGuards(TelegramAuthGuard)
  @Get('dev-location-override')
  getDevLocationOverride(@Req() req: any) {
    return this.btwService.getDevLocationOverride(req.telegramId);
  }
}

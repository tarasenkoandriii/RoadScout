import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { BtwService } from './btw.service';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AuthService } from '../auth/auth.service';
import { setSessionCookie } from '../auth/session-cookie.util';
// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 (лендинг apps/interactive,
// «интерактивность по айпи посетителя - погода и инциденты по городу»).
import { BtwLandingSnapshotService } from './btw-landing-snapshot.service';

// Beyond the Wall (BTW) — контролер, §7 ТЗ (doc/BTW-tz.md). Автентифікація —
// TelegramAuthGuard (той самий шаблон, що вже використовується по всьому проєкту —
// caller-id, "Мой дом" тощо), а НЕ пряма HMAC-перевірка X-Telegram-Init-Data, як буквально
// написано в §7.4 ТЗ — це свідома відповідність вже наявній конвенції автентифікації в
// проєкті, не помилка (обидва підходи однаково безпечні, TelegramAuthGuard перевіряє JWT,
// видану після HMAC-перевірки init-data під час логіну).
//
// ВИПРАВЛЕНО (реальний баг, знайдений користувачем на живому пристрої): коментар вище
// описував БАЖАНИЙ стан, який насправді ніколи не був реалізований — клієнт (apps/btw)
// нізвідки не отримував ту саму "JWT, видану після HMAC-перевірки init-data", бо ендпоінта,
// що робив би цю HMAC-перевірку й видавав JWT, просто не існувало. `POST session` нижче —
// саме він, тепер реально є (детальний розбір — telegram-verify.util.ts).
@Controller('btw')
export class BtwController {
  constructor(
    private readonly btwService: BtwService,
    private readonly authService: AuthService,
    private readonly landingSnapshotService: BtwLandingSnapshotService,
  ) {}

  // За прямим запитом користувача — реальний вхід для BTW mini-app. Викликається клієнтом
  // (apps/btw/app/page.tsx) одразу після Telegram.WebApp.ready(), з Telegram.WebApp.initData.
  // Свідомо БЕЗ guard — сама HMAC-перевірка initData всередині і Є перевіркою автентичності
  // (той самий принцип, що вже POST /auth/telegram для Login Widget).
  @Post('session')
  async createSession(@Body() body: { initData: string }, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.loginWithTelegramWebApp(body?.initData ?? '');
    setSessionCookie(res, token);
    return { user };
  }

  @Get('manifest')
  getManifest(@Query('city') city: string) {
    return this.btwService.getManifest(city ?? 'kyiv');
  }

  @Get('status')
  getStatus(@Query('city') city?: string) {
    return this.btwService.getStatus(city);
  }

  // §4.7.1/§4.7.5 ТЗ — роздача тайлів для клієнтського Web Worker (apps/btw/workers/
  // btw-scan.worker.ts, apps/btw/lib/btwLocalScanner.ts). Без guard — той самий рівень
  // публічності, що вже /btw/manifest, /btw/status, /btw/coverage вище (нечутливі геометричні
  // дані, не персональні). Range-заголовок прокидується напряму в BtwService.streamTile(),
  // яка сама вирішує 200 vs 206 (справжня підтримка HTTP Range, §4.7.1).
  @Get('tiles/:city/:layer')
  async getTile(@Param('city') city: string, @Param('layer') layer: string, @Req() req: any, @Res() res: Response) {
    await this.btwService.streamTile(city, layer, req.headers['range'], res);
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
      // ДОДАНО — § детальний коментар біля BtwService.scan(): дозволяє серверному фолбек-шляху
      // (поки локальний Worker ще не готовий) користуватись тим самим кешем тайлу вулиць
      // міста, що вже Worker використовує локально, замість завжди живого Overpass-запиту.
      // Клієнт УЖЕ визначає це значення одноразово (GET /btw/nearest-city) перед стартом
      // сканування — просто передає його тут, без жодного додаткового запиту.
      citySlug?: string;
    },
  ) {
    return this.btwService.scan(
      { lat: body.lat, lng: body.lng, accuracyM: body.accuracyM, heading: body.heading, headingSigma: body.headingSigma },
      body.targetLat != null && body.targetLng != null ? { lat: body.targetLat, lng: body.targetLng } : undefined,
      body.citySlug,
    );
  }

  @UseGuards(TelegramAuthGuard)
  @Post('thumb')
  thumb(@Req() req: any, @Body() body: { cameraId: string; targetLat: number; targetLng: number }) {
    return this.btwService.requestThumb(req.telegramId, body.cameraId, body.targetLat, body.targetLng);
  }

  // За прямим запитом користувача ("видео необходимо тянуть и в дев режиме - но через впн") —
  // фактичне завантаження байтів кадру (те, на що веде `url` з POST /thumb вище). Свідомо GET,
  // не POST — саме на це посилання вказує <img src> на клієнті (apps/btw/app/page.tsx), браузер
  // сам робить звичайний GET. @Res({ passthrough: false }) — самі керуємо відповіддю (бінарні
  // дані + Content-Type зображення, не JSON).
  @UseGuards(TelegramAuthGuard)
  @Get('thumb-image')
  async thumbImage(@Query('cameraId') cameraId: string, @Query('targetLat') targetLat: string, @Query('targetLng') targetLng: string, @Res() res: Response) {
    const { contentType, data } = await this.btwService.fetchThumbImage(cameraId, parseFloat(targetLat), parseFloat(targetLng));
    res.setHeader('Content-Type', contentType);
    // Кадр застаріває миттєво (MJPEG-знімок — не архівне зображення) — не даємо браузеру/проксі
    // кешувати його довше, ніж один перегляд.
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
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

  // §3.1 doc/TZ-btw-route-planning.md — за прямим запитом користувача: "добавить модель и её
  // сохранение/удаление на сервере". Той самий шаблон, що viewpoints вище — apps/btw викликає
  // це як `/api/saved-places` (next.config.js rewrite `/api/:path*` -> `${apiUrl}/btw/:path*`).
  @UseGuards(TelegramAuthGuard)
  @Post('saved-places')
  saveSavedPlace(@Req() req: any, @Body() body: { label: string; lat: number; lng: number; address?: string }) {
    return this.btwService.saveSavedPlace(req.telegramId, body.label, body.lat, body.lng, body.address);
  }

  @UseGuards(TelegramAuthGuard)
  @Get('saved-places')
  listSavedPlaces(@Req() req: any) {
    return this.btwService.listSavedPlaces(req.telegramId);
  }

  @UseGuards(TelegramAuthGuard)
  @Delete('saved-places/:id')
  removeSavedPlace(@Req() req: any, @Param('id') id: string) {
    return this.btwService.removeSavedPlace(req.telegramId, id);
  }

  // §6.1/§6.3 doc/TZ-btw-route-planning.md — за прямим запитом користувача: "маршрутизация не
  // вызывается — ключа OpenRouteService пока нет (§6.3) исправь". Апс btw викликає це як
  // `/api/route` (той самий rewrite `/api/:path*` -> `${apiUrl}/btw/:path*`, що вже
  // saved-places вище). З guard'ом — той самий принцип, що вже §7.3 ТЗ вимагає для lock/thumb:
  // без автентифікації анонімний клієнт міг би спалити денну/хвилинну квоту ORS-ключа.
  @UseGuards(TelegramAuthGuard)
  @Post('route')
  buildRoute(@Body() body: { pointA: { lat: number; lng: number }; pointB: { lat: number; lng: number }; profile: 'driving-car' | 'cycling-regular' | 'foot-walking' }) {
    return this.btwService.buildRoute(body.pointA, body.pointB, body.profile);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('report')
  report(@Req() req: any, @Body() body: { cameraId?: string; reason: string }) {
    return this.btwService.report(req.telegramId, body.cameraId, body.reason);
  }

  @UseGuards(TelegramAuthGuard)
  @Post('telemetry')
  telemetry(
    @Req() req: any,
    @Body()
    body: {
      scans: number;
      withCandidates: number;
      locks: number;
      snapUsed: boolean;
      fallbackOffered?: number;
      fallbackUsed?: number;
      scanErrors?: number;
      camerasInBboxLast?: number;
      coneSurvivorsLast?: number;
      streetCandidatesFoundLast?: number;
    },
  ) {
    return this.btwService.telemetry(req.telegramId, body);
  }

  @Get('coverage')
  coverage(@Query('swLat') swLat: string, @Query('swLng') swLng: string, @Query('neLat') neLat: string, @Query('neLng') neLng: string) {
    return this.btwService.coverage(parseFloat(swLat), parseFloat(swLng), parseFloat(neLat), parseFloat(neLng));
  }

  // За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3.3: живий блок «що у вашому
  // місті» на новому лендингу apps/interactive. Анонімний, без guard — той самий рівень
  // публічності, що вже /btw/coverage/nearest-city вище (§3.5 ТЗ: сервер не отримує нічого
  // ідентифікованого — лише lat/lng, які лендинг сам уже отримав із заголовків Vercel geo-IP
  // на СВОЄМУ боці; цей ендпоінт про них навіть не знає, приймає голі координати як вхід).
  // cityLabel — лише косметика для відображення (§3.2 ТЗ: сама логіка working завжди йде по
  // координатах, не по текстовій назві міста).
  @Get('landing-snapshot')
  landingSnapshot(@Query('lat') latRaw: string, @Query('lng') lngRaw: string, @Query('cityLabel') cityLabel?: string) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new BadRequestException('lat/lng must be valid coordinates');
    }
    return this.landingSnapshotService.getSnapshot(lat, lng, cityLabel?.trim() || 'Ваш регион');
  }

  // За прямим запитом користувача — розбір живого бага (хардкод 'kyiv' незалежно від реальної/
  // підміненої позиції, § детальний коментар біля BtwService.nearestCity()). Публічний, без
  // TelegramAuthGuard — той самий рівень приватності, що вже /btw/coverage вище.
  @Get('nearest-city')
  nearestCity(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.btwService.nearestCity(parseFloat(lat), parseFloat(lng));
  }

  // ДОДАНО за прямим запитом користувача («ввод точек А и Б маршрута сейчас просто плейсхолдеры
  // - ничего не вводится и не редактируется - исправь») — пошук адреси за текстом для полів
  // "Откуда"/"Куда" (apps/btw/components/BtwPlacePicker.tsx). Публічний, БЕЗ TelegramAuthGuard —
  // той самий рівень приватності, що вже /btw/nearest-city вище: сервер отримує лише текст
  // запиту й, опційно, приблизну позицію (яку клієнт і так уже показує на мапі), нічого не
  // прив'язує до telegramId. lat/lng — опційні (BtwService.searchAddress трактує їх відсутність
  // як "без міської підказки", не як помилку).
  @Get('geocode-search')
  searchAddress(@Query('q') q: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const parsedLat = lat != null && lat !== '' ? parseFloat(lat) : undefined;
    const parsedLng = lng != null && lng !== '' ? parseFloat(lng) : undefined;
    return this.btwService.searchAddress(q ?? '', parsedLat, parsedLng);
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

  // За прямим запитом користувача — "сделай новую вкладку в админке для запуска скрипта...
  // по городам": те саме, що `npx ts-node scripts/generate-btw-tiles.ts <slug>` у CLI, тепер
  // однією кнопкою з нової вкладки (apps/admin/app/admin/btw-tiles/page.tsx). `body.city` —
  // САМЕ `City.slug` (напр. "kyiv"), не відображувана назва — той самий `slug`, що тепер
  // повертає `listDevCities()` вище (BtwService.generateTiles() кидає зрозумілу
  // BadRequestException, якщо переплутано).
  @UseGuards(AdminGuard)
  @Post('admin/generate-tiles')
  generateTiles(@Body() body: { city: string }) {
    return this.btwService.generateTiles(body.city);
  }

  // "Мониторинг времени" запуску генерації (за прямим запитом користувача — "сделай
  // возможность идемпотентного мнгоразового запуска с мониторингом времени - как уже делали с
  // камерами") — поточний статус (якщо ще "running", скільки часу вже минуло) + історія
  // останніх спроб. Викликається сторінкою /admin/btw-tiles як одразу після відкриття
  // (показати результат попередньої спроби до першого кліку), так і під час очікування
  // (опитування поки generateTiles ще виконується десь-в-іншому виклику — свіжий "running"-
  // запис від паралельного натискання кнопки, див. BtwService.generateTiles()).
  @UseGuards(AdminGuard)
  @Get('admin/generation-status')
  getGenerationStatus(@Query('city') city: string) {
    return this.btwService.getGenerationStatus(city);
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

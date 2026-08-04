import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { OcclusionService } from '../occlusion/occlusion.service';
import { AzimuthHeuristicService } from '../scraper/azimuth-heuristic.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';
import { haversineDistance, bearing } from '../common/geometry.util';
import {
  ObserverPose,
  computeTargetZone,
  angularTolerance,
  passesConeFilter,
  classifyOrientationFit,
  computeScore,
  sampleTargetZonePoints,
  computeCoverageFromSamples,
  snapHeadingToStreetGrid,
  RankedCandidate,
} from './btw-geometry.util';

// За прямим запитом користувача — розширений результат /btw/scan із діагностикою для debug
// HUD (потрібно саме для М0-спайку на реальному пристрої, doc/AUDIT-btw.md).
// М1 ТЗ (doc/TZ-btw-side-reverse-view.md) — direct (ALIGNED-кандидати, показуються
// автоматично) і fallback (SIDE+OPPOSING, показуються лише за явним тапом користувача, і
// лише коли direct порожній — див. ТЗ для повного обґрунтування) замість єдиного змішаного
// списку candidates.
export interface ScanResult {
  direct: RankedCandidate[];
  fallback: RankedCandidate[];
  debug: {
    rawHeading: number;
    effectiveHeading: number;
    snapped: boolean;
    snappedTo: number | null;
    streetCandidatesFound: number;
    camerasInBbox: number;
    coneSurvivors: number;
    finalCandidates: number;
  };
}

// Beyond the Wall (BTW) — сервісний шар. Реалізує §7 ТЗ (doc/BTW-tz.md), з чесними
// спрощеннями там, де повна реалізація вимагає інфраструктури поза обсягом цього кроку —
// див. doc/AUDIT-btw.md для повного переліку.
//
// ⚠️ НАЙВАЖЛИВІШЕ спрощення: /btw/scan тут — це і є той самий "серверний фолбек", що ТЗ
// (§4.7.5) явно залишає обов'язковим ("не удаляется, а становится резервным путём") —
// просто в цьому кроці він ЄДИНИЙ шлях (клієнтський Web Worker/PMTiles не реалізовано), а не
// один із двох. Архітектурно нічого не суперечить ТЗ — просто М1/М2 (§14) не зроблені.
@Injectable()
export class BtwService {
  private readonly logger = new Logger(BtwService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly occlusion: OcclusionService,
    private readonly azimuthHeuristic: AzimuthHeuristicService,
    private readonly grokAssist: GrokCameraAssistService,
    // За прямим запитом користувача ("видео необходимо тянуть ... через впн, поскольку на
    // камеры нью-йорка стоит фильтр на американский айпи") — той самий сервіс, що вже
    // використовує scraper для обходу реєстрів камер (webshare rotating proxy тощо, див.
    // scraper/proxy/registry-proxy.service.ts). Не експортований з ScraperModule — тому
    // окремий екземпляр тут (у BtwModule), не спільний з ScraperModule. Це нормально: сервіс
    // сам по собі stateless-обгортка над лінивим побудуванням http(s)-proxy-agent з ОДНІЄЇ й
    // тієї самої env-змінної (REGISTRY_SCAN_PROXY_URL/Webshare/*), два екземпляри просто двічі
    // ліниво збудують однакові агенти — жодного конфлікту стану.
    private readonly registryProxy: RegistryProxyService,
  ) {}

  // У5 ТЗ (§5) — "не чаще 1 раза в 30 с". ВИПРАВЛЕНО за прямим запитом користувача (аудит
  // сумісності з Vercel Hobby, doc/AUDIT-vercel-hobby.md): раніше тут був in-process `Map` —
  // на serverless (кожен виклик функції може потрапити на інший/холодний інстанс) це
  // означало ненадійний rate-limit, який міг мовчки не спрацьовувати. Тепер перевірка йде
  // через БД (`BtwRefineEvent`) — той самий принцип, що вже застосований для антисталкінгу
  // в `BtwLockEvent`, коректно переживає холодні старти й кілька інстансів.
  private static readonly REFINE_COOLDOWN_MS = 30_000;

  // §7.1 ТЗ — спрощено: без PMTiles (немає офлайн-пайплайну збірки з OSM у цьому кроці, див.
  // AUDIT-btw.md) повертаємо тільки метадані, потрібні клієнту для роботи в режимі
  // серверного фолбеку (§3.3, "Перископ по адресу") — саме магнітне схилення, необхідне для
  // приведення показань компаса до істинного азимута (§4.1 ТЗ).
  async getManifest(cityName: string) {
    // ⚠️ ЧЕСНО: справжня формула WMM (World Magnetic Model) вимагає npm-пакет geomagnetism
    // (§4.1 ТЗ) — не встановлений (немає мережі в цій пісочниці). Тимчасово — фіксоване
    // наближення "+8°" для України (ТЗ саме й вказує діапазон +7…+9° для України) — ГРУБЕ,
    // не залежить від конкретних lat/lng чи дати, на відміну від справжньої WMM-таблиці.
    // Замінити на geomagnetism, коли з'явиться мережевий доступ для встановлення пакета.
    const APPROX_UKRAINE_DECLINATION_DEG = 8;

    return {
      city: cityName,
      declination: APPROX_UKRAINE_DECLINATION_DEG,
      // Немає PMTiles-шарів у цьому кроці — клієнт (коли буде реалізований) працює лише через
      // серверний /btw/scan, не через локальні тайли.
      layers: null,
      scanMode: 'server-fallback-only',
    };
  }

  // §7.2 ТЗ — дельта-версіонування статусів камер. Спрощено: рахуємо версію по кількості
  // ONLINE-камер, що не найточніший монотонний лічильник (справжній варіант — окремий
  // інкремент при КОЖНІЙ зміні статусу, camera_status_gen у ТЗ), але коректно віддає повний
  // список offline-камер клієнту, чого й вимагає ендпоінт по суті.
  async getStatus(cityName: string | undefined) {
    const offline = await this.prisma.camera.findMany({
      where: {
        deletedAt: null,
        confidence: 'VERIFIED',
        locationType: 'OUTDOOR',
        status: { in: ['OFFLINE', 'UNKNOWN'] },
        ...(cityName ? { city: { name: cityName } } : {}),
      },
      select: { id: true },
    });

    return { v: Date.now(), off: offline.map((c) => c.id), ttl: 30 };
  }

  // §4.5 ТЗ — каскад Ф1→Ф2→Ф3, і §4.6 — скоринг. Це ядро всього продукту.
  async scan(pose: ObserverPose, targetOverride?: { lat: number; lng: number }): Promise<ScanResult> {
    // У3 ТЗ (§5) — "главный приём": перед усім іншим намагаємось притягнути виміряний
    // компасом heading до одного з реальних напрямків найближчої вулиці. Живий Overpass-
    // запит (з кешем по сітці всередині AzimuthHeuristicService — сусідні скани тієї самої
    // позиції майже завжди влучають у кеш, не долблять Overpass на кожен тик).
    const streetCandidates = await this.azimuthHeuristic.getNearbyStreetAzimuths(pose.lat, pose.lng);
    const snapResult = snapHeadingToStreetGrid(pose.heading, streetCandidates);
    const effectiveHeading = snapResult.heading;
    if (snapResult.snapped) {
      this.logger.debug(`У3 snap: ${pose.heading.toFixed(1)}° -> ${snapResult.snappedTo?.toFixed(1)}°`);
    }

    const target = computeTargetZone(pose, effectiveHeading, targetOverride ? { targetOverride } : undefined);

    // Ф1 — дистанція. PostGIS-індекс на Camera вже є (@@index([cityId]) тощо), але окремого
    // геопросторового індексу немає — фільтруємо по грубому bbox (~2500м) у SQL, точну
    // haversine-відстань рахуємо потім у пам'яті (кандидатів однаково мало після цього).
    const BBOX_DEGREES = 2500 / 111000; // ~2500м у градусах широти, грубо
    const roughCandidates = await this.prisma.camera.findMany({
      where: {
        deletedAt: null,
        confidence: 'VERIFIED', // §11.1 ТЗ — тільки перевірені камери
        locationType: 'OUTDOOR', // BTW не має сенсу для камер усередині приміщень
        status: 'ONLINE',
        lat: { gte: pose.lat - BBOX_DEGREES, lte: pose.lat + BBOX_DEGREES },
        lng: { gte: pose.lng - BBOX_DEGREES, lte: pose.lng + BBOX_DEGREES },
      },
    });

    // Ф2 — конус без окклюзії (дешева перевірка, без мережевих викликів).
    const coneSurvivors = roughCandidates.filter((cam) => passesConeFilter(cam, target));

    // Ф3 — LOS-перевірка через уже наявний OcclusionService (реальний, живий запит до
    // Overpass — на відміну від ТЗ, де це локальний R-tree-пошук по завантажених тайлах;
    // повільніше, але дає СПРАВЖНЮ перевірку видимості вже зараз).
    const samplePoints = sampleTargetZonePoints(target);
    const candidates: RankedCandidate[] = [];

    for (const cam of coneSurvivors) {
      const visibilityFlags = await Promise.all(
        samplePoints.map(async (point) => {
          const blocked = await this.occlusion.isPossiblyBlocked(cam, point, Math.min(300, haversineDistance(cam, point) + 50));
          return !blocked;
        }),
      );
      const coverage = computeCoverageFromSamples(visibilityFlags);
      if (coverage === 0) continue; // жодна з 9 точок не видима — камера не кандидат

      const distanceM = haversineDistance(cam, target.point);
      const orientationFit = classifyOrientationFit(cam.azimuth, effectiveHeading);
      const ageSeconds = cam.lastCheckedAt ? (Date.now() - cam.lastCheckedAt.getTime()) / 1000 : 999999;

      const score = computeScore({
        coverage,
        orientationFit,
        ageSeconds,
        quality: 0.5, // ⚠️ спрощено — немає окремого поля "роздільна здатність" у Camera (AUDIT-btw.md)
        distanceM,
        popularity: 0, // ⚠️ спрощено — немає накопиченої статистики CTR ще (AUDIT-btw.md)
      });

      candidates.push({
        cameraId: cam.id,
        distanceM,
        bearingToTarget: bearing(cam, target.point),
        coverage,
        orientationFit,
        score,
      });
    }

    // М1 ТЗ (doc/TZ-btw-side-reverse-view.md) — розділення на "прямий" (ALIGNED) і
    // "резервний" (SIDE+OPPOSING) рівні. Сама геометрія/каскад фільтрів/скоринг НЕ
    // змінюються — лише групування вже порахованого результату перед видачею клієнту.
    // §У6 ТЗ — веер із 3-5 кандидатів; тут по топ-3 у КОЖНІЙ групі окремо (не єдиний топ-5
    // на всіх разом), щоб fallback не витісняв direct і навпаки.
    const direct = candidates
      .filter((c) => c.orientationFit === 'ALIGNED')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const fallback = candidates
      .filter((c) => c.orientationFit !== 'ALIGNED')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // За прямим запитом користувача — діагностика для debug HUD на клієнті (потрібна саме
    // під час М0-спайку на реальному пристрої, doc/AUDIT-btw.md): дозволяє побачити на
    // самому телефоні, чи спрацював snap, скільки камер узагалі є поблизу до фільтрів, і
    // скільки пройшло кожен фільтр каскаду — без USB-дебагу консолі браузера.
    return {
      direct,
      fallback,
      debug: {
        rawHeading: pose.heading,
        effectiveHeading,
        snapped: snapResult.snapped,
        snappedTo: snapResult.snappedTo,
        streetCandidatesFound: streetCandidates.length,
        camerasInBbox: roughCandidates.length,
        coneSurvivors: coneSurvivors.length,
        finalCandidates: direct.length + fallback.length,
      },
    };
  }

  // §7.3 ТЗ — кадр і захват, ЄДИНА точка контролю. Перевірки виконуються в цьому порядку,
  // саме як описано в ТЗ: (1) камера онлайн, (2) ціль не в забороненій зоні, (3) ціль
  // фізично може бути в полі зору камери, (4) ліміти й антисталкінг.
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "видео необходимо тянуть и в дев режиме - но
  // через впн, поскольку на камеры нью-йорка стоит фильтр на американский айпи") — раніше тут
  // повертався ПРЯМИЙ camera.streamUrl, і телефон користувача сам ішов по ньому НАПРЯМУ (свій
  // мережевий шлях, не через бекенд) — жодного бекендового VPN/проксі це не зачіпало в
  // принципі, навіть якщо він налаштований. Тепер повертаємо посилання на СВІЙ-таки
  // `GET /btw/thumb-image` — саме він фактично завантажує байти зображення (можливо, через
  // RegistryProxyService/VPN, див. fetchThumbImage нижче), а телефон вже отримує їх від НАШОГО
  // бекенда. Перевірки безпеки нижче лишаються і тут (не втрачають сенсу — цей URL все одно
  // веде на ще один захищений ендпоінт, що сам перевіряє все те саме заново), а не як заміна
  // реальної точки контролю (якою тепер є /thumb-image, бо саме він реально віддає байти).
  async requestThumb(telegramId: string, cameraId: string, targetLat: number, targetLng: number) {
    await this.assertCameraAvailable(cameraId);
    await this.assertNotInForbiddenZone(targetLat, targetLng);
    await this.assertWithinConeOfCamera(cameraId, targetLat, targetLng);
    // Rate-limit thumb (60/мин, §9 ТЗ) — не реалізовано (потребує окремого лічильника з TTL,
    // напр. Redis; AUDIT-btw.md) — див. AUDIT-btw.md.

    const params = new URLSearchParams({
      cameraId,
      targetLat: String(targetLat),
      targetLng: String(targetLng),
    });
    return { url: `/btw/thumb-image?${params}`, ttl: 60 };
  }

  // Реальне завантаження байтів кадру — викликається з GET /btw/thumb-image (той самий шлях,
  // що браузерний <img src>, тому й сам GET, не POST). Свідомо ПОВТОРЮЄ ті самі перевірки, що
  // requestThumb() вище — саме тут, а не в requestThumb(), відбувається фактична передача
  // зображення, тож саме тут і мусить бути реальна точка контролю (без цього requestThumb()
  // був би просто "видача перепустки", яку ніхто потім не перевіряє).
  //
  // Підтримується лише MJPEG_SNAPSHOT (реальний випадок — NycTmcAdapter, саме ці камери й
  // викликали запит на VPN) — streamUrl для нього вже є прямим посиланням на статичне
  // зображення. IFRAME/HLS/YOUTUBE_LIVE — це сторінки/плейлисти/embed-посилання, не окремий
  // файл зображення; проксувати "байти" звідти немає сенсу (там треба або рендерити сторінку,
  // або переписувати HLS-плейлист по сегментах — поза обсягом цього запиту).
  async fetchThumbImage(cameraId: string, targetLat: number, targetLng: number): Promise<{ contentType: string; data: Buffer }> {
    await this.assertCameraAvailable(cameraId);
    await this.assertNotInForbiddenZone(targetLat, targetLng);
    await this.assertWithinConeOfCamera(cameraId, targetLat, targetLng);

    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    if (camera.streamType !== 'MJPEG_SNAPSHOT') {
      throw new BadRequestException(
        `Проксирование кадра для streamType "${camera.streamType}" не реализовано (поддерживается только MJPEG_SNAPSHOT) — см. комментарий у fetchThumbImage().`,
      );
    }

    const fetchOnce = (axiosConfig: object) =>
      axios.get(camera.streamUrl, { ...axiosConfig, responseType: 'arraybuffer', timeout: 10000, validateStatus: (s) => s >= 200 && s < 300 });

    const viaVpn = this.registryProxy.isConfigured();
    const res = viaVpn ? (await this.registryProxy.request(fetchOnce)).data : await fetchOnce({});

    return {
      contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : 'image/jpeg',
      data: Buffer.from(res.data),
    };
  }

  async requestLock(telegramId: string, cameraId: string, targetLat: number, targetLng: number) {
    await this.assertCameraAvailable(cameraId);

    const inForbiddenZone = await this.isInForbiddenZone(targetLat, targetLng);
    const targetCell = this.gridCell(targetLat, targetLng);

    if (inForbiddenZone) {
      await this.prisma.btwLockEvent.create({ data: { telegramId, targetCell, cameraId, granted: false } });
      throw new ForbiddenException({ code: 'UNAVAILABLE_HERE' });
    }

    await this.assertWithinConeOfCamera(cameraId, targetLat, targetLng);

    // §11.4 ТЗ — антисталкінг: >10 запитів по тій самій цільовій комірці за 24г -> soft-block.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await this.prisma.btwLockEvent.count({
      where: { telegramId, targetCell, createdAt: { gte: since } },
    });
    if (recentCount >= 10) {
      await this.prisma.btwLockEvent.create({ data: { telegramId, targetCell, cameraId, granted: false } });
      throw new ForbiddenException({ code: 'RATE_LIMIT' });
    }

    await this.prisma.btwLockEvent.create({ data: { telegramId, targetCell, cameraId, granted: true } });

    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    const perspective = classifyOrientationFit(camera.azimuth, bearing({ lat: targetLat, lng: targetLng }, camera));

    // ⚠️ ЧЕСНО: "streamToken" тут — не справжній підписаний/захищений токен (немає окремої
    // токен-інфраструктури в цьому кроці) — просто пряме посилання на потік. Реальна точка
    // контролю (перевірки вище) ВЖЕ працює; сам токен-механізм — AUDIT-btw.md, "Що відкладено".
    return { streamUrl: camera.streamUrl, ttl: 300, perspective };
  }

  private async assertCameraAvailable(cameraId: string) {
    const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera || camera.deletedAt || camera.confidence !== 'VERIFIED' || camera.status !== 'ONLINE') {
      throw new BadRequestException('Камера недоступна');
    }
  }

  private async assertNotInForbiddenZone(lat: number, lng: number) {
    if (await this.isInForbiddenZone(lat, lng)) {
      throw new ForbiddenException({ code: 'UNAVAILABLE_HERE' });
    }
  }

  // §11.2 ТЗ — перевірка перетину цільової точки з полігоном забороненої зони. Точка-в-
  // полігоні через простий ray-casting (без turf, щоб не тягнути зайву залежність лише
  // заради цієї перевірки — той самий підхід достатній для точки, не для складних перетинів
  // ліній, які вже робить OcclusionService через turf).
  private async isInForbiddenZone(lat: number, lng: number): Promise<boolean> {
    const zones = await this.prisma.noTargetZone.findMany();
    for (const zone of zones) {
      const polygon = zone.geom as unknown as { lat: number; lng: number }[];
      if (this.pointInPolygon(lat, lng, polygon)) return true;
    }
    return false;
  }

  private pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng,
        yi = polygon[i].lat;
      const xj = polygon[j].lng,
        yj = polygon[j].lat;
      const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // §7.3 ТЗ, перевірка (3) — "дешевая проверка конуса без окклюзии (защита от использования
  // BTW как массового браузера камер)".
  private async assertWithinConeOfCamera(cameraId: string, targetLat: number, targetLng: number) {
    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    const distance = haversineDistance(camera, { lat: targetLat, lng: targetLng });
    if (distance > camera.rangeMeters) {
      throw new BadRequestException('Цель вне радиуса действия камеры');
    }
  }

  // Огрублення цільової точки до комірки ~65м (аналог H3 r10 — §11.4 ТЗ). ⚠️ Спрощення: не
  // справжня бібліотека H3 (h3-js), а проста lat/lng-сітка — функціонально еквівалентно для
  // мети антисталкінгу (групування "та сама приблизна цільова точка"), але не є справжніми
  // H3-комірками (інша форма/межі) — див. AUDIT-btw.md.
  private gridCell(lat: number, lng: number): string {
    const CELL_SIZE_DEG = 65 / 111000; // ~65м у градусах
    const cellLat = Math.round(lat / CELL_SIZE_DEG);
    const cellLng = Math.round(lng / CELL_SIZE_DEG);
    return `${cellLat}:${cellLng}`;
  }

  // §7.4 ТЗ — прочее
  // У5 ТЗ (§5) — vision-уточнення. expectedRelationship передається клієнтом напряму (вже
  // пораховано геометричним рушієм в /btw/scan як RankedCandidate.orientationFit) — не
  // перераховується тут повторно, немає сенсу дублювати цю логіку.
  async refineHeading(telegramId: string, cameraId: string, phoneImageDataUrl: string, expectedRelationship: 'ALIGNED' | 'SIDE' | 'OPPOSING') {
    const since = new Date(Date.now() - BtwService.REFINE_COOLDOWN_MS);
    const lastCall = await this.prisma.btwRefineEvent.findFirst({
      where: { telegramId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (lastCall != null) {
      const retryAfterMs = BtwService.REFINE_COOLDOWN_MS - (Date.now() - lastCall.createdAt.getTime());
      throw new ForbiddenException({ code: 'RATE_LIMIT', retryAfterMs });
    }
    await this.prisma.btwRefineEvent.create({ data: { telegramId } });

    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    return this.grokAssist.refineHeadingWithVision(phoneImageDataUrl, camera.name, camera.streamUrl, camera.streamType, expectedRelationship);
  }

  async saveViewpoint(telegramId: string, label: string, lat: number, lng: number, heading: number) {
    // ⚠️ ЧЕСНО: §11.4 ТЗ вимагає шифрування точки на клієнті (ключ від telegram_id + сіль) —
    // НЕ реалізовано в цьому кроці (потребує клієнтської криптографії, окрема робота). Сервер
    // зараз зберігає координати як є — див. AUDIT-btw.md, "Що відкладено".
    return this.prisma.btwViewpoint.create({ data: { telegramId, label, lat, lng, heading } });
  }

  async listViewpoints(telegramId: string) {
    return this.prisma.btwViewpoint.findMany({ where: { telegramId }, orderBy: { createdAt: 'desc' } });
  }

  // За прямим запитом користувача — вибір міста зі списку (замість ручного вводу lat/lng
  // "наосліп") перед підміною координат. Той самий фільтр камер, що scan()/coverage() уже
  // вважають "придатними для сканування" (deletedAt: null, VERIFIED, OUTDOOR, ONLINE) — інакше
  // лічильник тут показував би місто як "багате на камери", а сканування на місці не знаходило
  // б жодного кандидата (заплутувало б, а не допомагало відладці).
  private readonly SCANNABLE_CAMERA_FILTER = {
    deletedAt: null,
    confidence: 'VERIFIED' as const,
    locationType: 'OUTDOOR' as const,
    status: 'ONLINE' as const,
  };

  // Список міст, де ВЗАГАЛІ є придатні для сканування камери, з їхньою кількістю — тільки
  // непорожні міста (порожні не мають сенсу в випадаючому списку дебаг-інструменту),
  // відсортовано за спаданням кількості (найбагатше на камери місто — першим, зручно
  // одразу побачити, де є що тестувати).
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "нужно чтобы всегда работал селектор городов
  // на этой вкладке в любом окружении") — свідомо БЕЗ assertDevToolsEnabled(). Це, на відміну
  // від setDevLocationOverride()/auth.service.ts::devLogin(), суто READ-ONLY довідковий запит
  // (список міст і координати вже існуючих камер, які будь-який адмін і так бачить у
  // /admin/cameras) — не відкриває жодного обходу автентифікації чи запису даних. Гейт
  // AdminGuard на контролері (справжній Telegram-логін + ADMIN_TELEGRAM_IDS allowlist,
  // НЕЗАЛЕЖНИЙ від DEV_AUTO_LOGIN — див. admin.guard.ts) сам по собі достатній і працює
  // однаково в будь-якому середовищі, на відміну від DEV_AUTO_LOGIN, який свідомо вимкнений на
  // "реальних" деплоях.
  async listCitiesWithCameraDensity() {
    const grouped = await this.prisma.camera.groupBy({
      by: ['cityId'],
      where: { ...this.SCANNABLE_CAMERA_FILTER, cityId: { not: null } },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const cityIds = grouped.map((g) => g.cityId as string);
    const cities = await this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } });
    const nameById = new Map(cities.map((c) => [c.id, c.name]));

    return grouped
      .map((g) => ({ cityId: g.cityId as string, name: nameById.get(g.cityId as string) ?? '(?)', cameraCount: g._count._all }))
      .sort((a, b) => b.cameraCount - a.cameraCount);
  }

  // Точка найбільшої щільності камер у вибраному місті — для кожної придатної для сканування
  // камери рахуємо, скільки ІНШИХ таких камер лежить у радіусі DENSITY_RADIUS_METERS (типова
  // "видима пішки" відстань — навмисно менша за грубий bbox 2500м, що scan() використовує для
  // ПОШУКУ кандидатів: тут ідеться не про "де сервер шукатиме", а про "де реально стоїть купа
  // камер поруч", щоб дебаг мав що показати одразу після переходу на локацію). O(n²) по
  // камерах міста — прийнятно для розміру одного міста в цьому проєкті (десятки-сотні, не
  // мільйони), це інструмент адмінки для одноразового ручного вибору, не гарячий шлях.
  private static readonly DENSITY_RADIUS_METERS = 350;

  // Той самий принцип, що й listCitiesWithCameraDensity() вище — READ-ONLY (лише читає вже
  // наявні координати камер), без assertDevToolsEnabled(), гейт лише AdminGuard.
  async findDensestCameraPoint(cityId: string) {
    const cameras = await this.prisma.camera.findMany({
      where: { ...this.SCANNABLE_CAMERA_FILTER, cityId },
      select: { id: true, name: true, lat: true, lng: true },
    });
    if (cameras.length === 0) {
      throw new NotFoundException('No scannable cameras in this city');
    }

    let best = cameras[0];
    let bestNeighborCount = -1;
    for (const camera of cameras) {
      const neighborCount = cameras.reduce(
        (count, other) => (other.id !== camera.id && haversineDistance(camera, other) <= BtwService.DENSITY_RADIUS_METERS ? count + 1 : count),
        0,
      );
      if (neighborCount > bestNeighborCount) {
        best = camera;
        bestNeighborCount = neighborCount;
      }
    }

    return { lat: best.lat, lng: best.lng, cameraId: best.id, cameraName: best.name, camerasNearby: bestNeighborCount + 1 };
  }

  // Адмінська сторона — список усіх активних підмін (для вкладки в адмінці).
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "нахрена ты закрыл возможность дебажить мини
  // апп ... из прод админки я управляю дебаг телефонами для мини апп - открой вкладку для
  // прода тоже") — прибрано DEV_AUTO_LOGIN-гейт з усіх чотирьох методів підміни координат
  // нижче (list/set/clear/getDevLocationOverride). На відміну від auth.service.ts::devLogin()
  // (СПРАВЖНІЙ обхід автентифікації — видає сесію будь-якій ролі без Telegram-логіну взагалі,
  // якщо знати сам URL API) підміна координат НЕ є обходом автентифікації: list/set/clear і
  // так вимагають AdminGuard (реальний Telegram-логін конкретного адміна + ADMIN_TELEGRAM_IDS
  // allowlist), а get — TelegramAuthGuard (реальний логін конкретного юзера) і повертає
  // підміну ЛИШЕ для того telegramId, для якого адмін її явно встановив. Тобто без
  // авторизованої дії адміна для ЦЬОГО конкретного юзера нічого не змінюється — саме так і
  // працює "керування дебаг-телефонами" з прод-адмінки. devLogin() свідомо НЕ чіпаю — це інший
  // ризик (справжній auth bypass), його вимикати в проді потрібно й далі.
  async listDevLocationOverrides() {
    return this.prisma.btwDevLocationOverride.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async setDevLocationOverride(telegramId: string, lat: number, lng: number, label?: string) {
    return this.prisma.btwDevLocationOverride.upsert({
      where: { telegramId },
      create: { telegramId, lat, lng, label },
      update: { lat, lng, label },
    });
  }

  async clearDevLocationOverride(telegramId: string) {
    await this.prisma.btwDevLocationOverride.deleteMany({ where: { telegramId } });
    return { cleared: true };
  }

  // Клієнтська сторона — сам BTW-клієнт викликає це ПЕРЕД реальним navigator.geolocation,
  // щоб дізнатись, чи для ЦЬОГО конкретного telegram-юзера є активна підміна. Повертає null,
  // якщо підміни просто немає для цього telegramId — сервер сам вирішує, показати щось чи ні.
  async getDevLocationOverride(telegramId: string): Promise<{ lat: number; lng: number } | null> {
    const override = await this.prisma.btwDevLocationOverride.findUnique({ where: { telegramId } });
    return override ? { lat: override.lat, lng: override.lng } : null;
  }

  async report(telegramId: string, cameraId: string | undefined, reason: string) {
    return this.prisma.btwReport.create({ data: { telegramId, cameraId, reason } });
  }

  async telemetry(
    telegramId: string,
    aggregates: {
      scans: number;
      withCandidates: number;
      locks: number;
      snapUsed: boolean;
      fallbackOffered?: number;
      fallbackUsed?: number;
      // ВИПРАВЛЕНО (за прямим запитом користувача — "нужно больше полей телеметрии", під час
      // діагностики "кандидатов то находит то не находит") — усі опціональні, з тієї ж
      // причини, що fallbackOffered/fallbackUsed вище: старіший клієнт без цих полів не
      // повинен ламати запис телеметрії.
      scanErrors?: number;
      camerasInBboxLast?: number;
      coneSurvivorsLast?: number;
      streetCandidatesFoundLast?: number;
    },
  ) {
    // §6 ТЗ — "агрегаты сессии, без координат". За прямим запитом користувача — тепер реально
    // зберігається (раніше лише логувалось і пропадало), щоб ПІСЛЯ польового тесту можна було
    // подивитись через адмінку, а не покладатись на пам'ять.
    //
    // М3 ТЗ (doc/TZ-btw-side-reverse-view.md §7) — fallbackOffered/fallbackUsed опціональні
    // (`?? 0`) заради зворотної сумісності: старіша версія клієнта, що ще не оновлена до М3,
    // не мала б ламати запис телеметрії відсутністю цих полів.
    await this.prisma.btwTelemetryEvent.create({
      data: {
        telegramId,
        scans: aggregates.scans,
        withCandidates: aggregates.withCandidates,
        locks: aggregates.locks,
        snapUsed: aggregates.snapUsed,
        fallbackOffered: aggregates.fallbackOffered ?? 0,
        fallbackUsed: aggregates.fallbackUsed ?? 0,
        scanErrors: aggregates.scanErrors ?? 0,
        camerasInBboxLast: aggregates.camerasInBboxLast ?? 0,
        coneSurvivorsLast: aggregates.coneSurvivorsLast ?? 0,
        streetCandidatesFoundLast: aggregates.streetCandidatesFoundLast ?? 0,
      },
    });
    return { ok: true };
  }

  // Для адмінки — перегляд збереженої телеметрії після польового тесту. Той самий принцип, що
  // й вище — без DEV_AUTO_LOGIN-гейту, лише AdminGuard: телеметрія (агрегати сканів, без
  // координат) не є секретом, доступним лише "не в проді".
  async listTelemetry() {
    return this.prisma.btwTelemetryEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  // §7.4 ТЗ — тепловая карта покрытия. Спрощено: рахує кількість VERIFIED-камер у bbox, не
  // справжню heatmap-агрегацію по зоні покриття кожної камери (що вимагало б viewshed-подібних
  // обчислень, яких свідомо немає в цьому кроці).
  // §7.4 ТЗ — тепловая карта покрытия. За прямим запитом користувача — розширено для нового
  // режиму міні-карти (doc/AUDIT-btw.md): раніше повертались лише {lat, lng} для теплокарти,
  // тепер — повні дані камери (azimuth/fovAngle/rangeMeters/name), потрібні клієнту, щоб
  // намалювати сам сектор огляду, не лише точку. Ендпоінт і далі СВІДОМО без TelegramAuthGuard
  // (публічний, анонімний bbox-запит) — саме тому міні-карта може працювати БЕЗ передачі
  // ідентифікованих даних про місцезнаходження користувача: клієнт сам вирішує, який bbox
  // запитати (з панорамування/масштабу мапи), сервер не знає, ЧИЯ це позиція і чи це взагалі
  // "де я стою", а не довільна область карти.
  async coverage(swLat: number, swLng: number, neLat: number, neLng: number) {
    const cameras = await this.prisma.camera.findMany({
      where: {
        deletedAt: null,
        confidence: 'VERIFIED',
        locationType: 'OUTDOOR',
        lat: { gte: swLat, lte: neLat },
        lng: { gte: swLng, lte: neLng },
      },
      select: { id: true, name: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true },
    });
    return { count: cameras.length, cameras };
  }
}

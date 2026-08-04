import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
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
  MAX_TARGET_RADIUS_M,
} from './btw-geometry.util';
import { generateTilesForCity } from './tile-generation.util';

// За прямим запитом користувача — розширений результат /btw/scan із діагностикою для debug
// HUD (потрібно саме для М0-спайку на реальному пристрої, doc/AUDIT-btw.md).
// М1 ТЗ (doc/TZ-btw-side-reverse-view.md) — direct (ALIGNED-кандидати, показуються
// автоматично) і fallback (SIDE+OPPOSING, показуються лише за явним тапом користувача, і
// лише коли direct порожній — див. ТЗ для повного обґрунтування) замість єдиного змішаного
// списку candidates.
export interface ScanResult {
  direct: RankedCandidate[];
  fallback: RankedCandidate[];
  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "нужно сделать подсказки снизу
  // кликабельными", деякі fallback-картки просто нічого не робили по тапу): клієнт
  // (apps/btw/app/page.tsx::handleLock) раніше НЕ мав справжньої цільової точки для
  // /btw/thumb і замість неї повторно слав ВЛАСНУ поточну GPS-позицію користувача —
  // assertWithinConeOfCamera() тоді перевіряє відстань від КАМЕРИ до цієї (хибної) точки,
  // а не до реальної цільової зони, яку щойно порахував /scan (та, що дала candidate.distanceM
  // і пройшла Ф2/Ф3). Для SIDE-кандидатів (де ціль лежить осторонь від того, де фактично стоїть
  // користувач) відстань камера->власна_позиція_юзера часто перевищує camera.rangeMeters,
  // навіть коли відстань камера->справжня_ціль — ні -> 400 "Цель вне радиуса действия камеры"
  // -> тап виглядає "нежива кнопка". Тепер сервер повертає саму цільову точку в відповіді
  // /scan, і клієнт передає САМЕ ЇЇ назад у /thumb, а не власну позицію.
  target: { lat: number; lng: number };
  debug: {
    rawHeading: number;
    effectiveHeading: number;
    snapped: boolean;
    snappedTo: number | null;
    streetCandidatesFound: number;
    camerasInBbox: number;
    coneSurvivors: number;
    finalCandidates: number;
    // За прямим запитом користувача — видимість того, наскільки зараз "розширено" конус
    // проти шуму компаса (§4.4 ТЗ, раніше не застосовувалось узагалі — див. коментар біля
    // passesConeFilter() у btw-geometry.util.ts).
    headingUncertaintyDeg: number;
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

  // ВИПРАВЛЕНО/РОЗШИРЕНО за прямим запитом користувача ("lets realize (b) the full spec as
  // originally written"): раніше тут БЕЗУМОВНО поверталось layers:null — тепер перевіряємо
  // диск (getLocalTileLayers нижче) і якщо тайли для міста реально згенеровані (скриптом
  // apps/api/scripts/generate-btw-tiles.ts — Я НЕ можу виконати цей скрипт у цьому середовищі,
  // бо він потребує живого доступу до Overpass API й до продакшн-БД, яких тут немає, — але сам
  // скрипт коректний і призначений для запуску користувачем поза цим сендбоксом), клієнт
  // отримує реальні URL і переходить у 'local-worker' режим (apps/btw/lib/btwLocalScanner.ts).
  // Якщо тайлів немає — точно той самий 'server-fallback-only', що й раніше, БЕЗ регресії.
  //
  // ЧЕСНО (§7.1 ТЗ): "формат — один файл PMTiles на місто в об'єктному сховищі (R2/Supabase
  // Storage)" — тут замість цього звичайні файли на локальному диску апі-сервера, роздані через
  // GET /btw/tiles/:city/:layer із СПРАВЖНЬОЮ підтримкою HTTP Range (streamTile нижче) — тому
  // що (перевірено прямо в цьому сеансі): немає credentials для R2/Supabase Storage
  // (.env.example не містить жодних), і `npm view pmtiles version` повертає 403 Forbidden від
  // registry.npmjs.org (мережа для встановлення нових пакетів недоступна). Сама PMTiles-логіка
  // (одна карта тайлів z15-піраміди на місто) також не реалізована — замість неї ОДИН тайл на
  // все місто (спрощення, задокументоване в новому doc/AUDIT-btw-radar-m1-m2.md).
  // `cityName` тут — САМЕ `City.slug` (напр. "kyiv"), коли йдеться про пошук тайлів
  // (getLocalTileLayers нижче) — контролер передає `city ?? 'kyiv'`, тобто дефолт сам по собі
  // вже узгоджений зі slug-форматом. Для решти цього методу (declination) значення параметра
  // взагалі не впливає на результат — фіксована константа нижче.
  async getManifest(cityName: string) {
    // ⚠️ ЧЕСНО: справжня формула WMM (World Magnetic Model) вимагає npm-пакет geomagnetism
    // (§4.1 ТЗ) — не встановлений (немає мережі в цій пісочниці). Тимчасово — фіксоване
    // наближення "+8°" для України (ТЗ саме й вказує діапазон +7…+9° для України) — ГРУБЕ,
    // не залежить від конкретних lat/lng чи дати, на відміну від справжньої WMM-таблиці.
    // Замінити на geomagnetism, коли з'явиться мережевий доступ для встановлення пакета.
    const APPROX_UKRAINE_DECLINATION_DEG = 8;

    const layers = this.getLocalTileLayers(cityName);

    return {
      city: cityName,
      declination: APPROX_UKRAINE_DECLINATION_DEG,
      layers,
      scanMode: layers ? 'local-worker' : 'server-fallback-only',
    };
  }

  // Директорія тайлів на диску апі-сервера — конфігурована env-змінною (той самий принцип
  // "env-змінна з розумним дефолтом", що вже getMonitoringConcurrency() у monitoring.service.ts
  // цього ж кроку), за замовчуванням `<cwd>/btw-tiles/<citySlug>/<layer>.<ext>`. Скрипт
  // генерації (apps/api/scripts/generate-btw-tiles.ts) і generateTiles() нижче пишуть сюди ж
  // (обидва — через спільну generateTilesForCity(), tile-generation.util.ts).
  private getTilesDir(): string {
    return process.env.BTW_TILES_DIR ?? path.join(process.cwd(), 'btw-tiles');
  }

  // ВИПРАВЛЕНО термінологію (за прямим запитом користувача — адмінська вкладка генерації
  // тайлів виявила реальну плутанину): параметр тут і нижче — САМЕ `City.slug` (наприклад
  // "kyiv"), НЕ `City.name` (український відображуваний напис, наприклад "Київ", див.
  // schema.prisma). Ці два методи самі по собі DB-агностичні (просто складають шлях на диску з
  // рядка) — плутанина була у ВИКЛИКАЧІВ (generateTiles() нижче, до фіксу, і CLI-скрипт),
  // які фільтрували камери в БД через `city: { name: citySlug }` — тобто буквальний рядок
  // "kyiv" ніколи не збігався б із жодним `City.name` (там завжди українська назва). Тепер
  // всюди узгоджено — `slug`.
  private getTileFilePath(citySlug: string, layer: 'buildings' | 'cameras' | 'streets'): string {
    const ext = layer === 'buildings' ? 'bin' : 'json';
    // path.basename() — захист від directory traversal через city/layer з query/param (обидва
    // приходять від клієнта як @Query('city')/@Param('layer')); той самий принцип обережності,
    // що вже застосовується в проєкті для будь-якого шляху, похідного від користувацького вводу.
    return path.join(this.getTilesDir(), path.basename(citySlug), `${path.basename(layer)}.${ext}`);
  }

  private getLocalTileLayers(
    citySlug: string,
  ): { buildings: { url: string; version: number }; cameras: { url: string; version: number }; streets: { url: string; version: number } } | null {
    const buildingsPath = this.getTileFilePath(citySlug, 'buildings');
    const camerasPath = this.getTileFilePath(citySlug, 'cameras');
    const streetsPath = this.getTileFilePath(citySlug, 'streets');

    if (!fs.existsSync(buildingsPath) || !fs.existsSync(camerasPath) || !fs.existsSync(streetsPath)) {
      return null;
    }

    // mtime файлу як версія/cache-bust токен — грубий, але чесний субститут справжнього ETag
    // з вмісту (§4.7.1 ТЗ: "Кэш: 30 сут, ETag" / "24 ч, ETag") — той самий рівень точності, що
    // й streamTile() нижче вже реально віддає в заголовку ETag.
    return {
      buildings: { url: `/api/tiles/${encodeURIComponent(citySlug)}/buildings`, version: Math.round(fs.statSync(buildingsPath).mtimeMs) },
      cameras: { url: `/api/tiles/${encodeURIComponent(citySlug)}/cameras`, version: Math.round(fs.statSync(camerasPath).mtimeMs) },
      streets: { url: `/api/tiles/${encodeURIComponent(citySlug)}/streets`, version: Math.round(fs.statSync(streetsPath).mtimeMs) },
    };
  }

  // §4.7.1 ТЗ — "запити через HTTP Range". СПРАВЖНЯ підтримка Range тут реалізована (206 Partial
  // Content, Content-Range) — це не спрощено, попри те що самé сховище (локальний диск
  // апі-сервера, не PMTiles-контейнер в об'єктному сховищі) є задокументованою відмінністю
  // (див. коментар біля getManifest() вище). Викликається з контролера — сам метод керує
  // response напряму (той самий підхід, що вже fetchThumbImage()/thumbImage() у контролері).
  async streamTile(cityName: string, layer: string, rangeHeader: string | undefined, res: Response): Promise<void> {
    if (layer !== 'buildings' && layer !== 'cameras' && layer !== 'streets') {
      res.status(404).send('unknown tile layer');
      return;
    }

    const filePath = this.getTileFilePath(cityName, layer);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('tile not found — run generate-btw-tiles.ts for this city first');
      return;
    }

    const stat = fs.statSync(filePath);
    const contentType = layer === 'buildings' ? 'application/octet-stream' : 'application/json';
    // §4.7.1 ТЗ: buildings/streets — 30 діб кешу, cameras — 24 год (статус камер змінюється
    // частіше, тому окремий короткий /btw/status покриває свіжість між перезбірками тайлу).
    const cacheControl = layer === 'cameras' ? 'public, max-age=86400' : 'public, max-age=2592000';
    const etag = `"${Math.round(stat.mtimeMs)}-${stat.size}"`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);

    const rangeMatch = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
    if (rangeMatch) {
      const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : stat.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }

      const clampedEnd = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${stat.size}`);
      res.setHeader('Content-Length', String(clampedEnd - start + 1));
      fs.createReadStream(filePath, { start, end: clampedEnd }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(filePath).pipe(res);
  }

  // За прямим запитом користувача — "сделай новую вкладку в админке для запуска скрипта...
  // по городам": те саме, що apps/api/scripts/generate-btw-tiles.ts робить у CLI, тепер
  // доступне однією кнопкою з адмінки (apps/admin/app/admin/btw-tiles/page.tsx), через спільну
  // generateTilesForCity() (tile-generation.util.ts) — жодної повторної логіки Overpass/
  // кодування тайлів, лише інше джерело камер (injected PrismaService замість
  // standalone `new PrismaClient()` у скрипті).
  //
  // ВИПРАВЛЕНО (реальна плутанина, знайдена саме під час підготовки цієї вкладки): камери
  // фільтруються по `city: { slug: citySlug } }` — НЕ `{ name: citySlug }`, як помилково було
  // написано в першій версії скрипта цього кроку. `City.name` — український відображуваний
  // напис ("Київ"), `City.slug` — латинський URL-ідентифікатор ("kyiv", схема прямо документує
  // це як "используется в запросах фронтенда/URL"). Виклик `getManifest('kyiv')` (дефолт
  // контролера) ніколи не знайшов би жодного міста при фільтрі по `name`. Адмінська вкладка
  // передає `slug` із listCitiesWithCameraDensity() (тепер теж повертає `slug`, див. вище).
  async generateTiles(citySlug: string) {
    if (!citySlug?.trim()) {
      throw new BadRequestException('Не указан город (slug)');
    }

    const cameras = await this.prisma.camera.findMany({
      where: { ...this.SCANNABLE_CAMERA_FILTER, city: { slug: citySlug } },
      select: { id: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true, heightMeters: true, streamType: true, confidence: true },
    });

    if (cameras.length === 0) {
      throw new BadRequestException(`Нет подходящих (VERIFIED/OUTDOOR/ONLINE) камер для города со slug="${citySlug}"`);
    }

    try {
      const result = await generateTilesForCity(citySlug, cameras, this.getTilesDir());
      this.logger.log(
        `[generateTiles] city=${citySlug}: buildings=${result.buildingCount} (${result.buildingBytes}B), cameras=${result.cameraCount}, streets=${result.streetCount}`,
      );
      return result;
    } catch (err) {
      // Найімовірніша причина збою тут — Overpass (мережа/таймаут, §4.7.1) чи serverless-ліміт
      // часу виконання (Vercel Hobby 300с, doc/AUDIT-vercel-hobby.md) для дуже великого міста
      // — тому людське повідомлення прямо підказує CLI-альтернативу без такого обмеження.
      this.logger.warn(`[generateTiles] failed for city=${citySlug}: ${(err as Error).message}`);
      throw new BadRequestException(
        `Не удалось сгенерировать тайлы для "${citySlug}": ${(err as Error).message}. Для больших городов (риск таймаута serverless-функции) запустите тот же скрипт локально: npx ts-node scripts/generate-btw-tiles.ts ${citySlug}`,
      );
    }
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
    //
    // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "приложение часто пишет кандидатов
    // не найдено, а рядом 10 камер"): angularTolerance() (§4.4 ТЗ) була написана, але
    // ніколи не викликалася — конус не мав ЖОДНОГО запасу на headingSigma (похибку компаса).
    // На пристроях без гироскопа (типовий випадок, судячи зі скрінів користувача — "Гироскоп:
    // нет данных") звичайний шум магнітометра в кілька градусів був досить, щоб кандидат
    // щотика "зникав/з'являвся". Тепер цей запас реально додається до допуску конуса.
    const headingUncertaintyDeg = angularTolerance(pose.accuracyM, target.distanceM, pose.headingSigma);
    const coneSurvivors = roughCandidates.filter((cam) => passesConeFilter(cam, target, headingUncertaintyDeg));

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
        cameraAzimuth: cam.azimuth,
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
      target: { lat: target.point.lat, lng: target.point.lng },
      debug: {
        rawHeading: pose.heading,
        effectiveHeading,
        snapped: snapResult.snapped,
        snappedTo: snapResult.snappedTo,
        streetCandidatesFound: streetCandidates.length,
        camerasInBbox: roughCandidates.length,
        coneSurvivors: coneSurvivors.length,
        finalCandidates: direct.length + fallback.length,
        headingUncertaintyDeg,
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

    // ВИПРАВЛЕНО (за прямим запитом користувача — "в основном это камеры которые отдают поток
    // периодических снимков - в админке мы уже решали эту проблему"): той самий кейс, що вже
    // задокументовано в doc/AUDIT-nyctmc-adapter.md ("Оновлення 2") і виправлено в адмінці
    // (apps/admin/app/embed/[id]/page.tsx, apps/admin/app/admin/cameras/[id]/calibrate/page.tsx
    // — обидва додають `_t=<tick>` до streamUrl і перезапитують кожні 3с). streamUrl для
    // NYC DOT — це НЕ статичне зображення за фіксованим лінком, а ендпоінт, що сам себе
    // оновлює десь раз на ~2с (nyctmc.adapter.ts) — без cache-busting параметра проміжні
    // кеші (CDN камери, сам браузер через <img>) могли віддавати той самий застарілий кадр
    // щоразу. Адмінка це вже вирішила на клієнті (прямий <img src> з `_t=`, БЕЗ серверного
    // проксі — камери там доступні напряму). BTW не може так само напряму, бо весь сенс цього
    // ендпоінту — проксувати через VPN (registryProxy, camerас з NYC зазвичай блокують не-US
    // IP) — тож той самий cache-bust додається тут, на самому запиті ДО камери, а не на
    // клієнтському <img src> (client-side тег однаково не звертається до camera.streamUrl
    // напряму — він завжди йде через /btw/thumb-image, тому клієнтський `_t=` теж потрібен
    // окремо, щоб узагалі спричинити ПОВТОРНИЙ запит — додано в apps/btw/app/page.tsx).
    const cacheBustedUrl = `${camera.streamUrl}${camera.streamUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const fetchOnce = (axiosConfig: object) =>
      axios.get(cacheBustedUrl, { ...axiosConfig, responseType: 'arraybuffer', timeout: 10000, validateStatus: (s) => s >= 200 && s < 300 });

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

  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — скріншот: 3 кандидати в списку
  // сканування, усі з "покрытие 100%", тап на одного з них -> "Цель вне радиуса действия
  // камеры"): ця перевірка порівнювала distance ЛИШЕ з `camera.rangeMeters`, БЕЗ ЖОДНОГО
  // допуску — тоді як Ф2 (`passesConeFilter`, btw-geometry.util.ts — той самий алгоритм і в
  // apps/btw/lib/btw-geometry-engine.ts для локального Worker'а), яка й вирішує, чи кандидат
  // ВЗАГАЛІ потрапляє у список сканування, порівнює з `camera.rangeMeters + target.radiusM`
  // (`computeTargetZone` обмежує `target.radiusM` до 25-120м, §4.3 ТЗ). Кандидат, чия
  // дистанція потрапляла саме в цей проміжок (`rangeMeters < distance <= rangeMeters + 120`),
  // коректно ПРОХОДИВ Ф2 і показувався в списку — але ЗАВЖДИ провалював цю строгу перевірку
  // при тапі. Системна невідповідність двох формул, не залежить від локального/серверного
  // шляху сканування (обидва застосовують ту саму Ф2-формулу з тим самим допуском). Тепер тут
  // той самий максимально можливий допуск (MAX_TARGET_RADIUS_M — верхня межа
  // `target.radiusM`, тепер СПІЛЬНА іменована константа з btw-geometry.util.ts, а не другий
  // незалежний магічний літерал 120), що Ф2 і так уже дозволяє: будь-який кандидат, що легально
  // пройшов у список, більше не може провалити цю перевірку при фактичному тапі на нього.

  // §7.3 ТЗ, перевірка (3) — "дешевая проверка конуса без окклюзии (защита от использования
  // BTW как массового браузера камер)".
  private async assertWithinConeOfCamera(cameraId: string, targetLat: number, targetLng: number) {
    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    const distance = haversineDistance(camera, { lat: targetLat, lng: targetLng });
    if (distance > camera.rangeMeters + MAX_TARGET_RADIUS_M) {
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
    // РОЗШИРЕНО (за прямим запитом користувача — нова адмінська вкладка генерації тайлів,
    // "по городам (список селект городов)"): додано `slug` — той самий ідентифікатор, що
    // generateTiles()/getManifest()/streamTile() нижче використовують для файлової системи й
    // URL (`City.slug`, наприклад "kyiv" — НЕ `name`, український відображуваний напис
    // "Київ"). Стара вкладка "BTW: подмена координат" (яка вже споживає цей метод) просто
    // ігнорує нове поле — не ламається.
    const cities = await this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true, slug: true } });
    const cityById = new Map(cities.map((c) => [c.id, c]));

    return grouped
      .map((g) => {
        const city = cityById.get(g.cityId as string);
        return { cityId: g.cityId as string, name: city?.name ?? '(?)', slug: city?.slug ?? '', cameraCount: g._count._all };
      })
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

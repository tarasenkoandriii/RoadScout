import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { OcclusionService } from '../occlusion/occlusion.service';
import { AzimuthHeuristicService } from '../scraper/azimuth-heuristic.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { GeocodingService, CityHint } from '../common/geocoding.service';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';
import { OpenRouteServiceClient, OpenRouteServiceError, RoutingProfile } from '../routing/openrouteservice.service';
import { BtwRouteForecastService, RouteForecast } from './btw-route-forecast.service';
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
import { generateTilesForCity, getCellCacheBboxSnapshot, getLiveCellCacheStats, getCityBlobPrefix, listBlobsByPrefix, fetchBlobBuffer } from './tile-generation.util';

// generateTiles()/getGenerationStatus() нижче — за прямим запитом користувача ("сделай
// возможность идемпотентного мнгоразового запуска с мониторингом времени - как уже делали с
// камерами"). Скільки часу "running"-запис вважається ще живим, перш ніж наступний виклик
// generateTiles() того самого міста дозволить собі почати новий запуск замість того, щоб
// відмовити з ConflictException — трохи БІЛЬШЕ за жорсткий ліміт Vercel Hobby (300с,
// doc/AUDIT-vercel-hobby.md), щоб не вважати живий (ще не завершений) запит завислим
// достроково; трохи МЕНШЕ, ніж "довго й незрозуміло чекати" для адміна, що просто хоче
// повторити спробу після реального збою.
function getTileGenerationStaleRunMs(): number {
  const v = parseInt(process.env.BTW_TILE_GENERATION_STALE_RUN_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 6 * 60 * 1000; // 6 хв
}

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

// ДОДАНО (аудит 2026-08-06 доку route-planning'а, doc/AUDIT-btw-route-planning.md) — спільна
// перевірка "координати — скінченні числа" для нових ендпоінтів `/btw/route`/`/btw/saved-places`
// (§ детальний розбір — коментарі біля buildRoute()/saveSavedPlace() нижче). Module-scope
// функція, не метод класу — не потребує `this`, використовується з кількох місць.
function assertFiniteLatLng(lat: unknown, lng: unknown, label = 'point'): void {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new BadRequestException(`${label}.lat must be a finite number between -90 and 90`);
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new BadRequestException(`${label}.lng must be a finite number between -180 and 180`);
  }
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
    // За прямим запитом користувача — «маршрутизация не вызывается — ключа OpenRouteService
    // пока нет (§6.3) исправь» (doc/TZ-btw-route-planning.md §6.1/§6.3). Реальний HTTP-клієнт
    // ORS Directions API — src/routing/openrouteservice.service.ts.
    private readonly openRouteService: OpenRouteServiceClient,
    // За прямим запитом користувача — «полностью реализовать п 1 и п 2 по тз» (§8, Этапы 1-2):
    // камери/погода/інциденти/трафік/FIXED_ROUTE-зустрічі вздовж вже побудованого маршруту —
    // src/btw/btw-route-forecast.service.ts.
    private readonly routeForecast: BtwRouteForecastService,
    // ДОДАНО за прямим запитом користувача («ввод точек А и Б маршрута сейчас просто
    // плейсхолдеры - ничего не вводится и не редактируется - исправь») — searchAddress()
    // нижче. GeocodingService зареєстрований у CommonModule як @Global() (див. common.module.ts)
    // — тут НЕ потрібно нічого додавати в imports BtwModule, той самий принцип, що вже
    // AzimuthHeuristicService/GrokCameraAssistService вище.
    private readonly geocoding: GeocodingService,
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
  // Storage)" — тут замість справжньої PMTiles-піраміди (z15, тайл спостерігача + 8 сусідів)
  // ОДИН тайл на все місто, роздається через GET /btw/tiles/:city/:layer з Range-підтримкою
  // (streamTile нижче) — `npm view pmtiles version` повертав 403 в цьому сеансі. Саме СХОВИЩЕ
  // (об'єктне, не локальний диск) — ОНОВЛЕНО: спочатку тут був локальний диск апі-сервера через
  // брак credentials до R2/Supabase Storage; ЖИВИЙ інцидент на проді (Vercel serverless — диск
  // read-only поза /tmp, § детальний розбір біля getLocalTileLayers() нижче) змусив перенести
  // на Vercel Blob, credentials до якого вже були — той самий пакет, що вже реально працює в
  // home-verification/receipt-storage.service.ts. R2/Supabase Storage й досі не підключені.
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

    const layers = await this.getLocalTileLayers(cityName);

    return {
      city: cityName,
      declination: APPROX_UKRAINE_DECLINATION_DEG,
      layers,
      scanMode: layers ? 'local-worker' : 'server-fallback-only',
    };
  }

  // ВИПРАВЛЕНО (реальний, живий інцидент на проді — 500 на GET /btw/manifest І GET
  // /btw/admin/generation-status одразу після того, як grid-checkpoint-фіча вперше дійшла до
  // запису на диск): "директорія тайлів на диску апі-сервера" більше не існує — Vercel
  // serverless-функції мають READ-ONLY файлову систему поза `/tmp`, а `/tmp` не переживає між
  // окремими HTTP-викликами. Сховище тепер — Vercel Blob (tile-generation.util.ts,
  // getCityBlobPrefix()/listBlobsByPrefix()/fetchBlobBuffer() — та сама логіка, що
  // generateTilesForCity() вже використовує для запису, тепер читання дзеркалить її).
  //
  // ВИПРАВЛЕНО (реальний, живий інцидент — скріншот Log-панелі користувача: `GET
  // /api/manifest?city=new-york-us` — 1953мс на відповідь МЕНШЕ 1КБ, § "переключаться сразу"
  // (продовження 3), doc/AUDIT-btw-radar-m1-m2.md): manifest — саме той запит, що лежить на
  // критичному шляху ДО переходу на локальний Worker, і раніше він БЕЗУМОВНО бив живий
  // List-запит до Vercel Blob (`listBlobsByPrefix`, нижче тепер лише фолбек) — сам Blob List
  // API має помітну (секунди) латентність, невиправдану для відповіді, що не змінюється між
  // сусідніми запитами частіше, ніж раз на кілька хвилин/годин (нова генерація тайлів — рідкісна
  // адмінська дія, не щотикова подія). `BtwTileGenerationRun` (§ generateTiles() вище) УЖЕ
  // атомарно фіксує в БД, коли генерація дійсно ЗАВЕРШИЛАСЬ — `status: 'completed'`
  // виставляється ЛИШЕ ПІСЛЯ того, як `generateTilesForCity()` успішно записала ВСІ 3 файли в
  // Blob (§ tile-generation.util.ts — три `putBlobOverwrite()` перед `return {complete: true}`,
  // жодного проміжного стану "частково записано" не існує). Тобто швидкий індексований запит
  // до власної БД (`@@index([citySlug, startedAt])`) дає ТУ САМУ гарантію "усі 3 файли готові",
  // що раніше давав повільний живий Blob List, без зовнішньої мережевої залежності на
  // критичному шляху відкриття мінідодатку.
  private async getLocalTileLayers(
    citySlug: string,
  ): Promise<{ buildings: { url: string; version: number }; cameras: { url: string; version: number }; streets: { url: string; version: number } } | null> {
    const lastCompletedRun = await this.prisma.btwTileGenerationRun.findFirst({
      where: { citySlug, status: 'completed' },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true, startedAt: true },
    });
    if (lastCompletedRun) {
      // uploadedAt блоба як версія/cache-bust токен раніше давав mtime файлу (§4.7.1 ТЗ: "Кэш:
      // 30 сут, ETag" / "24 ч, ETag") — finishedAt цього запуску еквівалентний: усі 3 файли
      // записуються атомарно в межах ОДНОГО завершеного запуску (§ коментар вище), тож єдиний
      // спільний timestamp коректний для всіх трьох, а не лише наближення.
      const version = (lastCompletedRun.finishedAt ?? lastCompletedRun.startedAt).getTime();
      return {
        buildings: { url: `/api/tiles/${encodeURIComponent(citySlug)}/buildings`, version },
        cameras: { url: `/api/tiles/${encodeURIComponent(citySlug)}/cameras`, version },
        streets: { url: `/api/tiles/${encodeURIComponent(citySlug)}/streets`, version },
      };
    }

    // Фолбек — той самий повільний, але коректний живий Blob List, що був єдиним шляхом раніше
    // (§ коментар вище): покриває міста, тайли яких згенеровані НАПРЯМУ CLI-скриптом
    // (apps/api/scripts/generate-btw-tiles.ts), а не через адмінську кнопку "Сгенерировать
    // тайлы" (BtwService.generateTiles() вище) — CLI-скрипт використовує ВЛАСНИЙ standalone
    // `new PrismaClient()` і НІКОЛИ не пише в `BtwTileGenerationRun` (ця таблиця — суто
    // адмінський UI-моніторинг прогресу, § коментар біля generateTiles()), тож для таких міст
    // DB-запис просто відсутній, і ЛИШЕ прямий Blob List лишається джерелом істини.
    const prefix = getCityBlobPrefix(citySlug);
    const blobs = await listBlobsByPrefix(`${prefix}/`);
    // Виключаємо все під `.cellcache/` — це проміжний кеш комірок сітки (§ tile-generation.
    // util.ts), не готові тайли; без цього фільтра будь-який частковий прогрес помилково
    // задовольняв би перевірку "усі 3 файли є" за збігом імен усередині .cellcache/.
    const byName = new Map(
      blobs.filter((b) => !b.pathname.includes('/.cellcache/')).map((b) => [b.pathname.slice(prefix.length + 1), b]),
    );

    const buildings = byName.get('buildings.bin');
    const cameras = byName.get('cameras.json');
    const streets = byName.get('streets.json');
    if (!buildings || !cameras || !streets) return null;

    return {
      buildings: { url: `/api/tiles/${encodeURIComponent(citySlug)}/buildings`, version: new Date(buildings.uploadedAt).getTime() },
      cameras: { url: `/api/tiles/${encodeURIComponent(citySlug)}/cameras`, version: new Date(cameras.uploadedAt).getTime() },
      streets: { url: `/api/tiles/${encodeURIComponent(citySlug)}/streets`, version: new Date(streets.uploadedAt).getTime() },
    };
  }

  // §4.7.1 ТЗ — "запити через HTTP Range". Раніше — СПРАВЖНІЙ byte-range читав напряму з
  // локального диска (fs.createReadStream({start,end})). ВИПРАВЛЕНО (перенесення на Vercel Blob,
  // § детальний розбір біля getLocalTileLayers() вище): ця версія SDK (`@vercel/blob@^0.27.1`)
  // не має `get()` зі стрімінгом і НЕВІДОМО, чи прямий HTTP GET до публічного blob URL реально
  // підтримує Range на рівні сховища (не задокументовано для цієї версії) — тому свідомо
  // спрощено: весь вміст блоба зчитується в пам'ять ОДИН раз (fetchBlobBuffer), а Range (якщо
  // запитаний) нарізається вручну з уже отриманого буфера. Дає коректну поведінку 206/
  // Content-Range НЕЗАЛЕЖНО від того, чи сховище саме підтримує Range, ціною зайвого мережевого
  // трафіку апі-сервер↔Blob при частих часткових запитах великих файлів — прийнятний компроміс
  // для розміру тайлів цього кроку (§4.7.1 — "ОДИН тайл на місто", не піраміда).
  async streamTile(cityName: string, layer: string, rangeHeader: string | undefined, res: Response): Promise<void> {
    if (layer !== 'buildings' && layer !== 'cameras' && layer !== 'streets') {
      res.status(404).send('unknown tile layer');
      return;
    }

    const ext = layer === 'buildings' ? 'bin' : 'json';
    const pathname = `${getCityBlobPrefix(cityName)}/${layer}.${ext}`;
    const found = (await listBlobsByPrefix(pathname))[0];
    if (!found) {
      res.status(404).send('tile not found — run generate-btw-tiles.ts for this city first (or "Сгенерировать тайлы" в адмінці)');
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await fetchBlobBuffer(found.url);
    } catch (err) {
      this.logger.warn(`[streamTile] не вдалось прочитати blob для ${pathname}: ${(err as Error).message}`);
      res.status(502).send('tile storage temporarily unavailable');
      return;
    }

    const contentType = layer === 'buildings' ? 'application/octet-stream' : 'application/json';
    // §4.7.1 ТЗ: buildings/streets — 30 діб кешу, cameras — 24 год (статус камер змінюється
    // частіше, тому окремий короткий /btw/status покриває свіжість між перезбірками тайлу).
    const cacheControl = layer === 'cameras' ? 'public, max-age=86400' : 'public, max-age=2592000';
    const etag = `"${new Date(found.uploadedAt).getTime()}-${buffer.byteLength}"`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);

    const rangeMatch = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
    if (rangeMatch) {
      const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : buffer.byteLength - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= buffer.byteLength) {
        res.status(416).setHeader('Content-Range', `bytes */${buffer.byteLength}`).end();
        return;
      }

      const clampedEnd = Math.min(end, buffer.byteLength - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${clampedEnd}/${buffer.byteLength}`);
      res.setHeader('Content-Length', String(clampedEnd - start + 1));
      res.end(buffer.subarray(start, clampedEnd + 1));
      return;
    }

    res.setHeader('Content-Length', String(buffer.byteLength));
    res.end(buffer);
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
  // ВИПРАВЛЕНО (реальний, знайдений користувачем інцидент — скріншот з живим таймером
  // "⏳ Генерация уже выполняется — 8м 18с" і заблокованою кнопкою, хоча запуск мав вважатись
  // завислим ще на 6-й хвилині): перевірка "чи не застарів running-запис" раніше жила ЛИШЕ
  // всередині generateTiles() — а її викликає ЛИШЕ клік на кнопку "Сгенерировать тайлы", яка
  // ЗАБЛОКОВАНА, поки latest.status === 'running'. Виходило замкнене коло: єдиний спосіб
  // позначити завислий запуск як failed — викликати generateTiles(), а єдиний спосіб
  // викликати generateTiles() — щоб latest.status уже НЕ був 'running'. getGenerationStatus()
  // (яку UI опитує кожні 4с, поки йде "живий" запуск) сама ніколи не позначала застарілі
  // записи — просто повертала їх як є, тож таймер рахував нескінченно, а кнопка лишалась
  // заблокованою назавжди. Тепер обидва методи ділять ОДНУ реконсиляцію нижче — опитування
  // статусу саме "лікує" завислі записи, без потреби чекати на клік по кнопці.
  private async reconcileStaleRunningRun(citySlug: string): Promise<void> {
    const staleMs = getTileGenerationStaleRunMs();
    const existingRunning = await this.prisma.btwTileGenerationRun.findFirst({
      where: { citySlug, status: 'running' },
      orderBy: { startedAt: 'desc' },
    });
    if (!existingRunning) return;

    const ageMs = Date.now() - existingRunning.startedAt.getTime();
    if (ageMs < staleMs) return; // ще живий (у межах staleMs) — не чіпаємо

    this.logger.warn(`[btw-tiles] city=${citySlug}: запуск ${existingRunning.id} завис на ${Math.round(ageMs / 1000)}с — помечаю failed`);
    await this.prisma.btwTileGenerationRun.update({
      where: { id: existingRunning.id },
      data: { status: 'failed', finishedAt: new Date(), durationMs: ageMs, error: 'Запуск считается зависшим (не завершился за отведённое время) — вероятно, инстанс упал по таймауту.' },
    });
  }

  async generateTiles(citySlug: string) {
    if (!citySlug?.trim()) {
      throw new BadRequestException('Не указан город (slug)');
    }

    // ІДЕМПОТЕНТНІСТЬ (за прямим запитом користувача — див. коментар біля
    // getTileGenerationStaleRunMs() вище): якщо для цього міста вже є "running"-запис — не
    // вважаємо це автоматично помилкою. Свіжий (молодший за staleMs) — справді ще виконується
    // десь-в-іншому виклику, повторний паралельний запуск лише марно б'є по тому самому
    // Overpass другий раз одночасно -> ConflictException з чіткою підказкою. Застарілий уже
    // позначено failed через reconcileStaleRunningRun() вище (може статись і тут ПЕРШИЙ раз,
    // якщо ніхто не опитував статус, поки запуск висів) — новий запуск дозволяється.
    await this.reconcileStaleRunningRun(citySlug);
    const existingRunning = await this.prisma.btwTileGenerationRun.findFirst({
      where: { citySlug, status: 'running' },
      orderBy: { startedAt: 'desc' },
    });
    if (existingRunning) {
      const ageMs = Date.now() - existingRunning.startedAt.getTime();
      throw new ConflictException(
        `Генерация тайлов для "${citySlug}" уже выполняется (запущена ${Math.round(ageMs / 1000)}с назад) — дождитесь завершения или повторите позже.`,
      );
    }

    const run = await this.prisma.btwTileGenerationRun.create({ data: { citySlug, status: 'running' } });

    const cameras = await this.prisma.camera.findMany({
      where: { ...this.SCANNABLE_CAMERA_FILTER, city: { slug: citySlug } },
      select: { id: true, name: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true, heightMeters: true, streamType: true, confidence: true },
    });

    if (cameras.length === 0) {
      const message = `Нет подходящих (VERIFIED/OUTDOOR/ONLINE) камер для города со slug="${citySlug}"`;
      await this.prisma.btwTileGenerationRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime(), error: message },
      });
      throw new BadRequestException(message);
    }

    try {
      // За прямим запитом користувача — "админка не видит кеш тайлов радара" (живий інцидент:
      // історія запусків New York в адмінці стабільно застрягала на "3-4/1800 ячеек" кілька
      // спроб поспіль, попри те, що кеш комірок у Vercel Blob МАВ накопичувати прогрес між
      // кліками). Причина — та сама, що вже виправлена для CLI-шляху (§ детальний коментар біля
      // GenerateTilesOptions.bboxOverride/getCellCacheBboxSnapshot() у tile-generation.util.ts):
      // bbox рахувався ЗАНОВО з живого списку камер при КОЖНОМУ виклику, а список камер у БД
      // реально змінюється у фоні (сканер/скрапер) — щонайменша розбіжність bbox між кліками
      // змушувала ensureCellCacheValidForBbox() скидати ВЕСЬ кеш комірок щоразу. На відміну від
      // CLI (де продовження з попереднього bbox — опційний прапорець `--continue`), ЦЯ кнопка
      // адмінки вже НАЗИВАЄТЬСЯ "Продолжить генерацию" — продовження й так очікувана поведінка
      // за замовчуванням тут, без потреби в окремому прапорці (клік по кнопці не передає жодних
      // додаткових аргументів). Тому тут ЗАВЖДИ спершу перевіряємо, чи є кеш bbox від
      // попереднього запуску цього самого міста, і якщо є — підставляємо його як bboxOverride.
      const bboxSnapshot = await getCellCacheBboxSnapshot(citySlug);
      const result = await generateTilesForCity(citySlug, cameras, bboxSnapshot ? { bboxOverride: bboxSnapshot.bbox } : undefined);

      // ДОПОВНЕНО (за прямим запитом користувача — "сделай запуски из вкладки идемпотентными -
      // несколько запусков подряд до исчерпания списка ячеек"): `complete: false` — НЕ помилка.
      // generateTilesForCity() сітка обробилась лише частково за свій часовий бюджет (велике
      // місто на кшталт New York, десятки комірок) — кеш комірок на диску вже зберігає прогрес,
      // наступний виклик (наступний клік на ту саму кнопку в адмінці, чи повторний запуск
      // CLI-скрипта) продовжить звідти. Тому `partial`, а не `failed` — і жодного throw: адмін
      // бачить прогрес і чітку підказку тиснути кнопку ще раз, а не текст червоної помилки.
      if (!result.complete) {
        this.logger.log(
          `[generateTiles] city=${citySlug}: частково готово (${result.cellsDone}/${result.cellsTotal} комірок) — потрібен ще один запуск`,
        );
        await this.prisma.btwTileGenerationRun.update({
          where: { id: run.id },
          data: {
            status: 'partial',
            finishedAt: new Date(),
            durationMs: Date.now() - run.startedAt.getTime(),
            cellsTotal: result.cellsTotal,
            cellsDone: result.cellsDone,
          },
        });
        return result;
      }

      this.logger.log(
        `[generateTiles] city=${citySlug}: buildings=${result.buildingCount} (${result.buildingBytes}B), cameras=${result.cameraCount}, streets=${result.streetCount}`,
      );
      await this.prisma.btwTileGenerationRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          durationMs: Date.now() - run.startedAt.getTime(),
          cameraCount: result.cameraCount,
          buildingCount: result.buildingCount,
          streetCount: result.streetCount,
          cellsTotal: result.cellsTotal,
          cellsDone: result.cellsDone,
        },
      });
      return result;
    } catch (err) {
      // Найімовірніша причина збою тут — Overpass (мережа/таймаут/бан за rate-limit — §4.7.1,
      // реальний випадок зі скріншота користувача, HTTP 406) чи serverless-ліміт часу
      // виконання (Vercel Hobby 300с, doc/AUDIT-vercel-hobby.md) для дуже великого міста —
      // тому людське повідомлення прямо підказує CLI-альтернативу без такого обмеження.
      const message = (err as Error).message;
      this.logger.warn(`[generateTiles] failed for city=${citySlug}: ${message}`);
      await this.prisma.btwTileGenerationRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime(), error: message },
      });
      throw new BadRequestException(
        `Не удалось сгенерировать тайлы для "${citySlug}": ${message}. Для больших городов (риск таймаута serverless-функции) запустите тот же скрипт локально: npx ts-node scripts/generate-btw-tiles.ts ${citySlug} (нужен BLOB_READ_WRITE_TOKEN локально — "vercel env pull" — скрипт пишет в тот же Vercel Blob, что и эта кнопка).`,
      );
    }
  }

  // Для UI (apps/admin/app/admin/btw-tiles/page.tsx) — "мониторинг времени" запуску: поточний
  // статус (якщо ще "running" — скільки вже минуло часу, щоб адмін бачив живий таймер, а не
  // просто заблоковану кнопку без пояснень) + коротка історія останніх спроб (тривалість,
  // причина провалу) — та сама ідея, що вже "previousAttempt" у suggestAzimuthFovForCamera()
  // вище (показати результат ПОПЕРЕДНЬОЇ спроби, а не лише "зараз щось відбувається").
  //
  // ВИПРАВЛЕНО (реальний баг зі скріншота — див. довгий коментар біля reconcileStaleRunningRun()
  // вище): опитування статусу тепер САМЕ реконсилює застарілі "running"-записи, а не лише
  // покладається на клік по кнопці (яка якраз заблокована, поки статус "running" — інакше
  // замкнене коло).
  async getGenerationStatus(citySlug: string) {
    if (!citySlug?.trim()) {
      throw new BadRequestException('Не указан город (slug)');
    }
    await this.reconcileStaleRunningRun(citySlug);
    const runs = await this.prisma.btwTileGenerationRun.findMany({
      where: { citySlug },
      orderBy: { startedAt: 'desc' },
      take: 5,
    });
    const [latest, ...history] = runs;

    // За прямим запитом користувача — "админка не показывает кеш скрипта - хотя бы статистику
    // покажи": усе вище (`latest`/`history`) читає ЛИШЕ таблицю `BtwTileGenerationRun`, яку
    // пише ВИКЛЮЧНО ця сама `generateTiles()` (клік по кнопці адмінки) — CLI-скрипт
    // (`generate-btw-tiles.ts`) працює через ОКРЕМИЙ `new PrismaClient()` і НІКОЛИ не торкається
    // цієї таблиці, увесь його прогрес живе лише в самому кеші комірок у Vercel Blob. Тому якщо
    // прогрес зробив CLI, адмінка про це попередньо НІЧОГО не знала. `liveCache` — незалежне
    // джерело правди: рахує кеш НАПРЯМУ з Blob (§ детальний коментар біля
    // getLiveCellCacheStats() у tile-generation.util.ts), тому показує РЕАЛЬНИЙ поточний стан
    // незалежно від того, хто саме (CLI чи ця кнопка) його наповнив. `null`, якщо для цього
    // міста кешу комірок ще взагалі немає.
    const liveCache = await getLiveCellCacheStats(citySlug);

    return {
      citySlug,
      latest: latest
        ? {
            ...latest,
            elapsedMs: latest.status === 'running' ? Date.now() - latest.startedAt.getTime() : null,
          }
        : null,
      history,
      liveCache,
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
  //
  // ВИПРАВЛЕНО (реальний живий інцидент — користувач помітив у адмінській телеметрії, що
  // "улиц рядом"/"прошли конус" міняються МІЖ сесіями сканування ПРИ НЕЗМІННІЙ позиції (dev-
  // override, фіксовані координати) — підозра на "долгая подгрузка в начале". Причина: клієнт
  // (apps/btw/app/page.tsx) на кожен тик обирає ОДИН з ДВОХ незалежних шляхів сканування —
  // локальний Worker (btw-scan.worker.ts), щойно тайли міста довантажені, АБО цей самий
  // серверний шлях, ПОКИ тайли ще вантажаться. Обидва шляхи мали б давати ідентичний результат
  // для однієї й тієї самої пози, але:
  //   1. Worker шукає найближчі вулиці в радіусі STREET_SEARCH_RADIUS_M=200м (btw-scan.
  //      worker.ts), а цей метод викликався БЕЗ явного radiusM — тобто з дефолтом
  //      AzimuthHeuristicService.getNearbyStreetAzimuths() = 30м, у 6.6 рази менше. На тій
  //      самій позиції 30м vs 200м майже завжди дають РІЗНУ кількість "вулиць поруч" — саме
  //      це й спостерігав користувач як "телеметрия меняется при неизменной позиции".
  //   2. citySlug тут НІКОЛИ не передавався — тобто гілка "спершу перевір кеш тайлу міста"
  //      усередині getNearbyStreetAzimuths() (§ коментар там же) НІКОЛИ не спрацьовувала для
  //      цього шляху, і кожен серверний тик бив ЖИВИЙ Overpass-запит, навіть коли тайл міста
  //      вже давно згенерований і лежить у Vercel Blob. Це і є найімовірніша причина "долгая
  //      подгрузка в начале" — не сама лише loading тайлів, а те, що ВСІ тики до готовності
  //      Worker'а платять мережевий round-trip до Overpass замість дешевого читання кешу.
  //
  // citySlug — опційний (без нього поведінка та сама, що й раніше, ДЕ radiusM тепер 200 —
  // джерело `scanCitySlug`, що клієнт УЖЕ визначає одноразово через GET /btw/nearest-city
  // перед стартом сканування, § page.tsx — жодного додаткового запиту на сервері не потрібно).
  async scan(pose: ObserverPose, targetOverride?: { lat: number; lng: number }, citySlug?: string): Promise<ScanResult> {
    // У3 ТЗ (§5) — "главный приём": перед усім іншим намагаємось притягнути виміряний
    // компасом heading до одного з реальних напрямків найближчої вулиці. Спершу кеш тайлу
    // міста (якщо citySlug передано), лише потім живий Overpass — той самий шлях, що вже
    // Worker використовує локально (§ детальний коментар вище).
    const STREET_SEARCH_RADIUS_M = 200; // той самий, що btw-scan.worker.ts::STREET_SEARCH_RADIUS_M — див. коментар вище
    const streetCandidates = await this.azimuthHeuristic.getNearbyStreetAzimuths(pose.lat, pose.lng, STREET_SEARCH_RADIUS_M, citySlug);
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
        cameraName: cam.name,
        distanceM,
        bearingToTarget: bearing(cam, target.point),
        coverage,
        orientationFit,
        score,
        cameraAzimuth: cam.azimuth,
        fovAngle: cam.fovAngle, // § детальний коментар біля RankedCandidate.fovAngle (btw-geometry.util.ts)
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
  // ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем — "проблема с камерой осталась хотя
  // в админке она решена уже"): `url` тут повертається КЛІЄНТУ (apps/btw/app/page.tsx кладе
  // його прямо в `<img src>`) — а мінідодаток Next.js рерайтить лише `/api/:path* ->
  // NEST_API_URL/btw/:path*` (§ apps/btw/next.config.js). Тобто з точки зору БРАУЗЕРА
  // клієнтські URL мають починатись саме з `/api/`, а НЕ з `/btw/` — сам Next.js-рерайт уже
  // додає префікс `/btw/` при проксуванні до бекенда, повторювати його в самому URL, який іде
  // В БРАУЗЕР, не можна. Тут стояло саме "/btw/thumb-image" — з точки зору браузера це запит
  // на ВЛАСНИЙ ORIGIN мінідодатку за шляхом, якого там просто немає (рерайт ловить лише
  // `/api/*`) -> Next.js повертав 404 (свою HTML-сторінку, не зображення) -> `<img onError>`
  // спрацьовував і показував загальне повідомлення "не удалось загрузить кадр... возможно,
  // нужен другой тип прокси" — насправді жодного стосунку до VPN/проксі/streamType камери
  // взагалі не було, це чиста помилка неправильного префіксу шляху. Усі ІНШІ клієнтські URL у
  // цьому файлі (§ getLocalTileLayers() вище) вже правильно використовують "/api/..." — саме
  // ця невідповідність і відрізняла thumb від решти (і чому в адмінці — окремий застосунок з
  // ІНШИМ власним проксі-ендпоінтом, CamerasService.fetchStreamImageProxy() — той самий кейс
  // ніколи не проявлявся).
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
    return { url: `/api/thumb-image?${params}`, ttl: 60 };
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
    // задокументовано в doc/AUDIT-nyctmc-adapter.md ("Оновлення 2"). streamUrl для NYC DOT —
    // це НЕ статичне зображення за фіксованим лінком, а ендпоінт, що сам себе оновлює десь раз
    // на ~2с (nyctmc.adapter.ts) — без cache-busting параметра проміжні кеші (CDN камери, сам
    // браузер через <img>) могли віддавати той самий застарілий кадр щоразу. Тож той самий
    // cache-bust додається тут, на самому запиті ДО камери, а не лише на клієнтському
    // <img src> (client-side тег однаково не звертається до camera.streamUrl напряму — він
    // завжди йде через /btw/thumb-image, тому клієнтський `_t=` теж потрібен окремо, щоб
    // узагалі спричинити ПОВТОРНИЙ запит — додано в apps/btw/app/page.tsx).
    //
    // СПРОСТОВАНО (за прямим запитом користувача, скріншот DevTools — "та же проблема с
    // показом видео в админке"): попередня версія цього коментаря стверджувала, що адмінка
    // "вже вирішила" гео-блокування на клієнті прямим <img src>, БЕЗ серверного проксі — це
    // виявилось НЕВІРНО (той самий 100%-провальний Network tab, що був би й тут, якби BTW теж
    // бив напряму з браузера). /admin/cameras/[id]/calibrate тепер так само проксує через
    // CamerasController.imageProxy()/CamerasService.fetchStreamImageProxy() — той самий
    // RegistryProxyService, той самий патерн, що й тут. /embed/[id]/page.tsx досі б'є напряму
    // (той самий баг) — свідомо НЕ виправлено цього разу: публічний ембед-віджет без
    // TelegramAuthGuard/AdminGuard, і відкритий серверний проксі довільного url для
    // неавторизованих відвідувачів — окреме рішення з іншими вимогами до захисту від SSRF/
    // зловживання, не в межах цього запиту користувача.
    const cacheBustedUrl = `${camera.streamUrl}${camera.streamUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const fetchOnce = (axiosConfig: object) =>
      axios.get(cacheBustedUrl, { ...axiosConfig, responseType: 'arraybuffer', timeout: 10000, validateStatus: (s) => s >= 200 && s < 300 });

    // ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем — "любой тап по камере — нет
    // видео — 500"): запит до ЗОВНІШНЬОГО потоку камери (не наш сервер — реальна вулична
    // камера/DOT-ендпоінт, який регулярно буває тимчасово недоступний, повертає негеографічну
    // помилку, чи просто "лежить") раніше не мав жодного try/catch — будь-яка мережева
    // помилка (timeout, ECONNREFUSED, non-2xx статус — усе це кидає `AxiosError`, не
    // `HttpException`) провалювалась як сира помилка й перетворювалась на непрозорий
    // "Internal server error" замість зрозумілого "камера тимчасово недоступна". Тепер —
    // BadGatewayException (502, семантично коректний код саме для "апстрім не відповів
    // коректно") з людським повідомленням, той самий принцип, що вже `assertCameraAvailable()`
    // вище ("Камера недоступна" замість сирого падіння).
    let res: Awaited<ReturnType<typeof fetchOnce>>;
    try {
      const viaVpn = this.registryProxy.isConfigured();
      res = viaVpn ? (await this.registryProxy.request(fetchOnce)).data : await fetchOnce({});
    } catch (err) {
      this.logger.warn(`fetchThumbImage: upstream camera stream failed for camera ${cameraId}: ${(err as any)?.message ?? err}`);
      throw new BadGatewayException('Камера временно недоступна — попробуйте ещё раз');
    }

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
      // ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем — скріншот "любой тап по
      // камере — нет видео — 500"): `geom` — це Prisma `Json` (§ schema.prisma коментар),
      // тобто жодної схемної гарантії, що там справді масив `{lat,lng}[]`, а не `null`,
      // об'єкт іншої форми (напр. справжній GeoJSON `{type,coordinates}`), чи взагалі щось
      // побите. Ця перевірка запускається на КОЖЕН тап "заблокувати камеру" (assertNotIn
      // ForbiddenZone -> requestThumb/requestLock), для ВСІХ зон одразу — раніше ОДНА погана
      // зона в базі кидала некеровану помилку (`polygon.length` на не-масиві) і валила весь
      // ланцюжок для БУДЬ-ЯКОЇ камери, з якою намагався взаємодіяти БУДЬ-ЯКИЙ користувач —
      // саме це й пояснює "любой тап — 500", незалежно від конкретної камери. Тепер погана
      // зона просто пропускається (з логом) — інші, коректні зони й далі перевіряються, а
      // сам факт "не можу перевірити цю зону" НЕ трактується як "не заборонено" чи навпаки
      // "заборонено" — вона просто випадає з перевірки, як і мала б, якби її взагалі не
      // існувало в базі.
      if (!Array.isArray(zone.geom) || zone.geom.length < 3) {
        this.logger.warn(`NoTargetZone ${zone.id} has malformed geom (expected {lat,lng}[] with >=3 points) — skipping in forbidden-zone check`);
        continue;
      }
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

  // §3.1 doc/TZ-btw-route-planning.md — за прямим запитом користувача: "добавить модель и её
  // сохранение/удаление на сервере" (заміна тимчасового localStorage-сховища на пристрої,
  // apps/btw/lib/btwSavedPlaces.ts — детальний розбір у AUDIT-btw-route-planning.md). Той
  // самий шаблон CRUD, що вже saveViewpoint()/listViewpoints() вище — жодного шифрування тут
  // теж немає (той самий чесний компроміс, що і §11.4 ТЗ для BtwViewpoint), просто без
  // heading, бо для точки маршруту він не потрібен.
  //
  // ДОДАНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — `@Body()` у btw.controller.ts
  // типізовано простим TS-інтерфейсом, не class-validator DTO (той самий патерн, що й решта
  // цього контролера) — глобальний `ValidationPipe` тут нічого не перевіряє. Без явної перевірки
  // тут `lat`/`lng`, що прийшли NaN/нескінченними/поза розумним діапазоном (наприклад, зламаний
  // клієнт або ручний curl-запит), потрапили б прямо в `prisma.savedPlace.create()` — Postgres
  // прийняв би NaN у `Float`-колонку мовчки, зіпсувавши запис назавжди (жоден подальший маршрут/
  // мапа коректно не відобразили б цю точку). `assertFiniteLatLng()` — чесний 400 замість цього.
  async saveSavedPlace(telegramId: string, label: string, lat: number, lng: number, address?: string) {
    assertFiniteLatLng(lat, lng);
    if (!label || !label.trim()) {
      throw new BadRequestException('label is required');
    }
    return this.prisma.savedPlace.create({ data: { telegramId, label, lat, lng, address } });
  }

  async listSavedPlaces(telegramId: string) {
    return this.prisma.savedPlace.findMany({ where: { telegramId }, orderBy: { createdAt: 'desc' } });
  }

  // Перевірка власності ПЕРЕД видаленням — на відміну від viewpoints (де досі немає жодного
  // DELETE-ендпоінту взагалі, тож питання не поставало), тут воно є з самого початку: без
  // перевірки один telegram-юзер міг би видалити чуже збережене місце, знаючи лише його `id`
  // (cuid непередбачувані, але це все одно неправильний контроль доступу, а не "досить
  // складно вгадати"). 404, а не 403, на чужий запис — не розкриваємо навіть факт існування.
  async removeSavedPlace(telegramId: string, id: string) {
    const existing = await this.prisma.savedPlace.findUnique({ where: { id } });
    if (!existing || existing.telegramId !== telegramId) {
      throw new NotFoundException(`SavedPlace ${id} not found`);
    }
    await this.prisma.savedPlace.delete({ where: { id } });
    return { id, deleted: true };
  }

  // За прямим запитом користувача — «маршрутизация не вызывается — ключа OpenRouteService пока
  // нет (§6.3) исправь»: реальний виклик OpenRouteService Directions API (§6.1/§6.3 ТЗ),
  // замінює попередній клієнтський стаб-повідомлення (apps/btw/app/page.tsx::handleBuildRoute).
  // Мапимо OpenRouteServiceError у конкретні HTTP-статуси, а не єдиний загальний 500 — клієнт
  // (app/page.tsx) показує РІЗНІ чесні повідомлення залежно від причини (not_configured vs
  // no_route vs rate_limited), тож статус/код мають донести, яка саме це причина.
  async buildRoute(pointA: { lat: number; lng: number }, pointB: { lat: number; lng: number }, profile: RoutingProfile) {
    // ДОДАНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — раніше відсутній `pointA`/
    // `pointB` (напр. клієнт з багом, або ручний запит без body) не перехоплювалось: звертання
    // до `pointA.lat` всередині `OpenRouteServiceClient.getRoute()` кидало звичайний TypeError,
    // який НЕ є `OpenRouteServiceError` — падав крізь `catch` нижче в НЕОБРОБЛЕНИЙ 500 замість
    // чесного 400 (клієнт показав би загальне "OpenRouteService временно недоступен", хоча
    // причина зовсім інша — некоректний запит, не збій зовнішнього сервісу). Явна перевірка тут
    // — той самий принцип "чесний код помилки замість непояснимого 500", що вже вся решта цього
    // методу застосовує до `OpenRouteServiceError`.
    assertFiniteLatLng(pointA?.lat, pointA?.lng, 'pointA');
    assertFiniteLatLng(pointB?.lat, pointB?.lng, 'pointB');
    if (profile !== 'driving-car' && profile !== 'cycling-regular' && profile !== 'foot-walking') {
      throw new BadRequestException('profile must be one of driving-car, cycling-regular, foot-walking');
    }

    try {
      const route = await this.openRouteService.getRoute(pointA, pointB, profile);
      const forecast = await this.getForecastSafely(route.points, route.distanceMeters, route.durationSeconds);
      return { profile, ...route, ...forecast };
    } catch (err) {
      if (err instanceof OpenRouteServiceError) {
        switch (err.kind) {
          case 'not_configured':
          case 'invalid_key':
            // Проблема конфігурації сервера (відсутній/невірний ключ), не дій користувача —
            // 503, не 400.
            throw new HttpException({ code: err.kind, message: err.message }, HttpStatus.SERVICE_UNAVAILABLE);
          case 'rate_limited':
            throw new HttpException({ code: err.kind, message: err.message }, HttpStatus.TOO_MANY_REQUESTS);
          case 'no_route':
            throw new HttpException({ code: err.kind, message: err.message }, HttpStatus.BAD_REQUEST);
          default:
            throw new HttpException({ code: 'upstream_error', message: err.message }, HttpStatus.BAD_GATEWAY);
        }
      }
      throw err;
    }
  }

  // Маршрут (route.points/distance/duration) — це головне, заради чого користувач тапнув
  // кнопку; накладення камер/погоди/інцидентів/трафіку (§4/§7 ТЗ, Этап 2) — ДОДАТКОВА цінність
  // поверх нього. Якщо якийсь із цих запитів впаде (напр. PostGIS-міграція не прогнана, або
  // зовнішній API 511NY/TomTom тимчасово недоступний) — користувач все одно повинен побачити
  // побудований маршрут, а не отримати 500 через щось другорядне. Тому тут — м'яка деградація
  // до "порожнього" прогнозу з логуванням, а не прокидання помилки далі в buildRoute().
  private async getForecastSafely(points: { lat: number; lng: number }[], distanceMeters: number, durationSeconds: number): Promise<RouteForecast> {
    try {
      return await this.routeForecast.getForecast(points, distanceMeters, durationSeconds);
    } catch (err) {
      this.logger.warn(`BtwRouteForecastService.getForecast failed, returning route without along-route data: ${(err as Error).message}`);
      return {
        camerasAlongRoute: [],
        weather: null,
        incidents: [],
        traffic: { source: null, configured: false, events: [] },
        fixedRouteEncounters: [],
      };
    }
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

  // За прямим запитом користувача — живий баг, знайдений через скріншот панелі Log
  // (§ networkLog.ts): мінідодаток (apps/btw/app/page.tsx) досі мав ЗАХАРДКОДЖЕНЕ 'kyiv' для
  // GET /btw/manifest, повністю ІГНОРУЮЧИ фактичну (чи підмінену через dev-tools) позицію
  // користувача — підміна координат на Нью-Йорк, а мінідодаток однаково просив тайли Києва.
  // Наслідок — не просто "неправильна назва міста в лозі": локальний Worker (§
  // btwLocalScanner.ts) вантажив BUILDINGS/CAMERAS/STREETS КИЄВА, а компонував їх геометрично
  // з GPS-координатами Нью-Йорка — географічно безглузда комбінація, яка структурно НЕ МОЖЕ
  // знайти жодного кандидата (звідси "Кандидатов не найдено рядом с вами" на скріншоті,
  // незалежно від того, скільки камер Нью-Йорка реально є в БД).
  //
  // Це найпростіший робочий розв'язок — найближче МІСТО за прямою відстанню від точки до
  // City.lat/lng (центру міста), БЕЗ урахування справжніх адміністративних меж чи форми
  // bbox конкретного міста (§ computeBboxFromCameras у tile-generation.util.ts — справжня bbox
  // міста може бути витягнутою вздовж узбережжя/річки й не бути "круглою" навколо центру).
  // ⚠️ ЧЕСНО: для користувача, що фізично стоїть майже точно посередині між двома містами
  // (рідкісний випадок для типової відстані між містами в цьому проєкті), це евристика може
  // вибрати не те місто, чий bbox реально покриває точку користувача — повноцінне рішення
  // вимагало б перевірки належності до bbox/полігону кожного міста, не лише відстані до
  // центру; свідомо не зроблено цим кроком заради простоти (жодного реального інциденту з цим
  // ще не було, на відміну від хардкоду 'kyiv', який ламав усе структурно й завжди).
  //
  // Публічний, БЕЗ TelegramAuthGuard — той самий рівень приватності, що вже /btw/coverage вище:
  // сервер отримує лише координату, яку клієнт сам вирішив надіслати (той самий принцип, що й
  // /btw/coverage вже застосовує для bbox навколо позиції користувача на карті), і не прив'язує
  // її до жодного telegramId (виклик не проходить через TelegramAuthGuard узагалі, req.telegramId
  // тут недоступний).
  async nearestCity(lat: number, lng: number): Promise<{ slug: string; name: string; distanceM: number }> {
    const cities = await this.prisma.city.findMany({ select: { slug: true, name: true, lat: true, lng: true } });
    if (cities.length === 0) {
      throw new NotFoundException('no cities configured');
    }

    let best = cities[0];
    let bestDistanceM = haversineDistance({ lat, lng }, { lat: cities[0].lat, lng: cities[0].lng });
    for (const city of cities.slice(1)) {
      const d = haversineDistance({ lat, lng }, { lat: city.lat, lng: city.lng });
      if (d < bestDistanceM) {
        best = city;
        bestDistanceM = d;
      }
    }

    // ДОДАНО — живий баг, знайдений користувачем через скріншот Log-панелі: клієнт надіслав
    // (0,0) через окремий баг у apps/btw/app/scan/page.tsx (Number(null) === 0 — виправлено
    // окремо), і ця функція, БЕЗ жодної перевірки на розумну відстань, впевнено повернула
    // "munich-de" (~5468 км від (0,0) — фактично найближче з ~43 засіяних міст, бо Мюнхен має
    // найменшу за модулем довготу серед них, але це географічно безглуздий "збіг", не реальне
    // покриття). Клієнт же трактує будь-яку відповідь 200 як "точно те місто" — звідси й
    // "Кандидатов не найдено рядом с вами", бо локальний Worker тоді змішує тайли Мюнхена з
    // GPS-координатами (0,0). Тепер — та сама, вже прийнята в цьому файлі философія "чесно
    // показати відсутність покриття" (див. коментар вище про хардкод 'kyiv'): якщо навіть
    // найближче місто за прямою відстанню далі за розумний поріг, вважаємо, що покриття тут
    // просто немає, і кидаємо 404 замість впевненої, але безглуздої відповіді. Поріг — 150 км
    // (типова відстань "у межах тієї ж агломерації/сусіднього міста" для засіяного списку міст
    // цього проєкту), не наукове значення.
    const MAX_REASONABLE_DISTANCE_M = 150_000;
    if (bestDistanceM > MAX_REASONABLE_DISTANCE_M) {
      throw new NotFoundException(
        `nearest configured city (${best.slug}) is ${Math.round(bestDistanceM / 1000)} km away — no real coverage near (${lat}, ${lng})`,
      );
    }

    return { slug: best.slug, name: best.name, distanceM: Math.round(bestDistanceM) };
  }

  // ДОДАНО за прямим запитом користувача («ввод точек А и Б маршрута сейчас просто плейсхолдеры
  // - ничего не вводится и не редактируется - исправь») — реальний пошук адреси за текстом для
  // полів "Откуда"/"Куда" на головному екрані apps/btw (app/page.tsx, через
  // components/BtwPlacePicker.tsx). До цього моменту єдиним способом "ввести" точку вручну був
  // прямий ввід координат lat/lng (§ коментар класу BtwPlacePicker) — робочий, але не те, що
  // людина очікує від поля "Куда едем?" типу Uklon/Google Maps.
  //
  // GeocodingService.searchAddressCandidates() (не searchPlaceOSM — та повертає лише ОДИН
  // найкращий результат, для адмінки) — той самий безкоштовний Nominatim, без потреби в
  // GOOGLE_GEOCODING_API_KEY (§ коментар класу GeocodingService: "БЕСПЛАТНОЕ и не требующее
  // API-ключа джерело").
  //
  // near (lat/lng) — необов'язковий: якщо передано, підказуємо Nominatim найближче з засіяних
  // міст як CityHint (той самий механізм, що вже geocode()/searchPlace() вище використовують
  // для адмінки) — той самий текст "вулиця Хрещатик 1" по-різному резолвиться в Києві й у
  // Варшаві, а мінідодаток якраз знає приблизне місце користувача (LocationProvider). Якщо
  // найближче місто занадто далеко (>150 км, той самий поріг, що nearestCity() вище) або lat/lng
  // не передано зовсім — просто НЕ передаємо hint, а не кидаємо помилку: пошук і без нього
  // працює (дефолтний ухил на "Україна" всередині GeocodingService), підказка міста — лише
  // покращення релевантності, не обов'язкова умова.
  async searchAddress(query: string, lat?: number, lng?: number): Promise<{ label: string; lat: number; lng: number }[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return []; // той самий здоровий глузд, що вже клієнтський debounce — не турбувати Nominatim односимвольними запитами

    let cityHint: CityHint | null = null;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      const cities = await this.prisma.city.findMany({
        select: { name: true, lat: true, lng: true, countryCode: true, countryName: true },
      });
      let best: (typeof cities)[number] | null = null;
      let bestDistanceM = Infinity;
      for (const city of cities) {
        const d = haversineDistance({ lat, lng }, { lat: city.lat, lng: city.lng });
        if (d < bestDistanceM) {
          best = city;
          bestDistanceM = d;
        }
      }
      if (best && bestDistanceM <= 150_000) {
        cityHint = { name: best.name, lat: best.lat, lng: best.lng, countryCode: best.countryCode, countryName: best.countryName };
      }
    }

    const results = await this.geocoding.searchAddressCandidates(trimmed, cityHint, 5);
    return results
      .filter((r) => r.formattedAddress || r.name)
      .map((r) => ({ label: (r.formattedAddress ?? r.name) as string, lat: r.lat, lng: r.lng }));
  }
}

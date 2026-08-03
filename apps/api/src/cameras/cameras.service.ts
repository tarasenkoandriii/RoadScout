import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../common/geocoding.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { OcclusionService } from '../occlusion/occlusion.service';
import { bearing, cameraSeesPoint, haversineDistance, LatLng, routeLength, sectorToEwkt, routeLineToEwkt, syncCameraPolygon, syncCameraRoutePolygon } from '../common/geometry.util';
import { CreateCameraDto } from './dto/create-camera.dto';
import { CalibrateCameraDto, UpdateCameraDto } from './dto/update-camera.dto';
import { FixedRoutePositionService } from '../route-position/fixed-route-position.service';
import { LookAheadService } from '../lookahead/lookahead.service';
import { toFixedRouteCamera } from '../route-position/camera-route.mapper';
import { CitiesService } from '../cities/cities.service';

const COMPASS = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];

// За прямим запитом користувача — попередній поріг (рівно 100%) виявився нереалістичним:
// реальні відповіді моделі (45%, 75%) практично ніколи не сягають 100%, тому камери з batch-
// калібрування не ставали VERIFIED узагалі. Тепер поріг конфігурований (за замовчуванням
// 70% — пропускає реальний приклад 75%, відхиляє 45%), спільний і для синхронного
// autoCalibrateBatch(), і для асинхронного processPendingCalibrationBatches().
function getAiCalibrationConfidenceThreshold(): number {
  const v = parseFloat(process.env.AI_CALIBRATION_CONFIDENCE_THRESHOLD ?? '');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
}

// Глава 16–18 ТЗ: don't bother predicting an encounter more than this far in the future for a
// plain address/point search — keeps the hot search path bounded (acceptance criteria: search
// latency must not regress by more than 10%). LookAheadController's dedicated /lookahead
// endpoint (user-route case) uses its own, separately tunable horizon.
const SEARCH_LOOKAHEAD_HORIZON_SECONDS = 20 * 60;
const SEARCH_LOOKAHEAD_STEP_SECONDS = 10;

// Камеры внутри помещений (см. findIndoorNearby ниже) — радиус "рядом с искомым адресом", в
// котором такую камеру ещё стоит показать как "также поблизости", хоть она и не участвует в
// поиске по сектору обзора.
function getIndoorNearbyRadiusMeters(): number {
  const v = parseInt(process.env.INDOOR_CAMERA_NEARBY_RADIUS_METERS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 500;
}

function compassLabel(deg: number): string {
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS[idx];
}

export interface IndoorCameraResult {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  confidence: string;
  status: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export interface CameraSearchResult {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  confidence: string;
  status: string;
  delaySeconds: number | null;
  distanceMeters: number;
  directionFromCamera: string; // e.g. "ЮВ" — camera is looking towards the address in this direction
  possiblyBlocked?: boolean;
  // Camera's own *static* geometry — needed by the frontend to draw the sector on the map
  // (it must not use the address point as a stand-in for the camera's position). For
  // FIXED_ROUTE cameras this is the depot/fallback position, NOT where the camera is now —
  // use cameraLat/cameraLng/cameraAzimuth below for that.
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  // --- Глава 18 ТЗ API extension: resolved current position + look-ahead metadata ---
  mobilityType: 'STATIONARY' | 'FIXED_ROUTE';
  etaSeconds: number; // 0 if the camera sees the point right now, >0 if this is a predicted future encounter
  cameraLat: number;
  cameraLng: number;
  cameraAzimuth: number;
  cameraSpeed: number;
  meetingConfidence?: number; // глава 17 "confidence" — only meaningful for FIXED_ROUTE, omitted for STATIONARY
}

@Injectable()
export class CamerasService {
  private readonly logger = new Logger(CamerasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly occlusion: OcclusionService,
    private readonly routePosition: FixedRoutePositionService,
    private readonly lookAhead: LookAheadService,
    private readonly cities: CitiesService,
    private readonly grokAssist: GrokCameraAssistService,
  ) {}

  // Soft delete (див. doc/AUDIT-camera-soft-delete.md) — список активних камер, видалені
  // (deletedAt заповнений) сюди не потрапляють. countryCode — фільтр по країні (див. запит
  // користувача: "фільтр по камерам тільки цієї країни, активація дабл-кліком по країні").
  // countryCode/providerId — обидва опціональні фільтри. providerId — для експорту списку
  // камер конкретного провайдера як JSON (див. запит користувача, кнопка на /admin/parser).
  findAll(countryCode?: string, providerId?: string) {
    return this.prisma.camera.findMany({
      where: { deletedAt: null, ...(countryCode ? { city: { countryCode } } : {}), ...(providerId ? { providerId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { provider: true, city: { select: { name: true, countryCode: true, countryName: true } } },
    });
  }

  // findOne() свідомо НЕ фільтрує по deletedAt — пряме звернення за id (калібрування/AI-
  // підказки/перевірка доступності) має працювати навіть для вже видаленої камери (наприклад,
  // для майбутньої функції "відновити"), на відміну від списків/пошуку нижче.
  async findOne(id: string) {
    const camera = await this.prisma.camera.findUnique({ where: { id }, include: { provider: true } });
    if (!camera) throw new NotFoundException(`Camera ${id} not found`);
    return camera;
  }

  // Експорт списку камер конкретного провайдера як JSON (див. запит користувача, кнопка на
  // /admin/parser) — свідомо ПЛОСКА форма (providerId/cityId напряму, не вкладені
  // об'єкти provider/city, як у findAll() для відображення) — саме тому, що цей формат
  // призначений для повторного імпорту через importCameras() нижче, round-trip.
  //
  // ВАЖЛИВО (реальний знайдений інцидент — аудит за запитом користувача, doc/AUDIT-camera-
  // export-import.md): раніше тут НЕ вистачало кількох полів, серед них — критично важливі
  // mobilityType/routeGeometry/routeMode/routeSchedule/averageSpeed/routeStartedAt (камера
  // на маршруті мовчки перетворювалась на звичайну STATIONARY без жодних даних маршруту!),
  // а також district/notes/heightMeters/azimuthSource (реальні дані, введені вручну,
  // губились без жодного попередження). Свідомо НЕ включено: status/lastCheckedAt/
  // lastSnapshotHash/delaySeconds (живий стан моніторингу — має скидатись, не імпортуватись
  // як факт) і lastAutoCalibrationAttemptAt/autoCalibrationAttemptCount/
  // lastAiCalibrationSuggestion (процесна історія AI-калібрування — логічно почати чергу
  // "з нуля" для щойно імпортованої камери, той самий принцип, що вже застосований до
  // status/lastCheckedAt).
  // Експорт списку камер конкретного провайдера як JSON (див. запит користувача, кнопка на
  // /admin/parser) — свідомо ПЛОСКА форма (providerId/cityId напряму, не вкладені
  // об'єкти provider/city, як у findAll() для відображення) — саме тому, що цей формат
  // призначений для повторного імпорту через importCameras() нижче, round-trip.
  //
  // ВАЖЛИВО (реальний знайдений інцидент — аудит за запитом користувача, doc/AUDIT-camera-
  // export-import.md): раніше тут НЕ вистачало кількох полів, серед них — критично важливі
  // mobilityType/routeGeometry/routeMode/routeSchedule/averageSpeed/routeStartedAt (камера
  // на маршруті мовчки перетворювалась на звичайну STATIONARY без жодних даних маршруту!),
  // а також district/notes/heightMeters/azimuthSource (реальні дані, введені вручну,
  // губились без жодного попередження).
  //
  // ОНОВЛЕНО за прямим запитом користувача ("ми повністю будемо мігрувати між оточеннями"):
  // status/lastCheckedAt/lastAutoCalibrationAttemptAt/autoCalibrationAttemptCount/
  // lastAiCalibrationSuggestion — раніше свідомо ВИКЛЮЧЕНІ (аргумент: "живий стан
  // моніторингу"/"процесна історія AI, не семантичні дані камери") — тепер СВІДОМО
  // ВКЛЮЧЕНІ, бо мета використання змінилась: не разова передача списку камер іншому
  // провайдеру, а ПОВНА міграція реєстру між середовищами (напр. staging -> prod), де втрата
  // саме цих полів означала б втрату реального прогресу моніторингу й AI-калібрування, а не
  // просто "почати з чистого аркуша" для нового середовища.
  async exportByProvider(providerId: string) {
    const cameras = await this.prisma.camera.findMany({
      where: { providerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return cameras.map((c) => ({
      name: c.name,
      providerId: c.providerId,
      cityId: c.cityId,
      streamUrl: c.streamUrl,
      streamType: c.streamType,
      lat: c.lat,
      lng: c.lng,
      azimuth: c.azimuth,
      azimuthSource: c.azimuthSource,
      fovAngle: c.fovAngle,
      rangeMeters: c.rangeMeters,
      heightMeters: c.heightMeters,
      confidence: c.confidence,
      status: c.status,
      lastCheckedAt: c.lastCheckedAt,
      locationType: c.locationType,
      district: c.district,
      notes: c.notes,
      mobilityType: c.mobilityType,
      routeGeometry: c.routeGeometry,
      routeMode: c.routeMode,
      routeSchedule: c.routeSchedule,
      averageSpeed: c.averageSpeed,
      routeStartedAt: c.routeStartedAt,
      lastAutoCalibrationAttemptAt: c.lastAutoCalibrationAttemptAt,
      autoCalibrationAttemptCount: c.autoCalibrationAttemptCount,
      lastAiCalibrationSuggestion: c.lastAiCalibrationSuggestion,
    }));
  }

  // Імпорт камер із JSON (див. запит користувача, значок імпорту на /admin/parser) — очікує
  // той самий формат, що повертає exportByProvider() вище (round-trip). Свідомо НЕ падає на
  // першій же поганій записі — обробляє кожен елемент окремо, повертає підсумок
  // успішних/пропущених, той самий принцип "часткова помилка не ламає весь прохід", що вже
  // застосований у ScraperService.
  // ВИПРАВЛЕНО (реальний знайдений баг — за прямим запитом користувача): раніше кожна камера
  // робила ОКРЕМИЙ INSERT + ОКРЕМИЙ UPDATE (fov_polygon) послідовно — на імпорті 972 камер
  // (NYC DOT) це ~1944 послідовних мережевих запити до Supabase-пулера й закінчувалось
  // `504 Gateway Timeout` (`FUNCTION_INVOCATION_TIMEOUT`) задовго до завершення. Тепер:
  // (1) валідація ВСІХ рядків одним проходом у пам'яті, без жодного звернення до БД;
  // (2) один `createManyAndReturn()` — масовий INSERT за один мережевий запит;
  // (3) один batched `UPDATE ... FROM (VALUES ...)` для fov_polygon усіх OUTDOOR-камер разом
  //     (не N окремих UPDATE) — те саме для route_line/route_buffer_polygon FIXED_ROUTE-камер;
  // (4) усе всередині ОДНІЄЇ транзакції (`$transaction`) — атомарно: або весь імпорт
  //     успішний, або відкочується повністю. Це свідомий компроміс (озвучений явно, не
  //     замовчаний): попередня версія була повільною, але стійкою до часткових помилок
  //     (одна погана камера — пропускалась, решта імпортувались); ця версія швидка, але
  //     "усе або нічого" — якщо хоч один рядок порушує зовнішній ключ (неіснуючий
  //     providerId/cityId), відкотиться ВЕСЬ імпорт, а не лише той рядок.
  async importCameras(items: unknown[]) {
    const errors: string[] = [];
    interface ValidRow {
      data: any;
      locationType: string;
      mobilityType: string;
      routeGeometry: { lat: number; lng: number }[] | undefined;
    }
    const validRows: ValidRow[] = [];

    // Прохід 1 — лише валідація й побудова даних, ЖОДНОГО звернення до БД.
    for (const item of items) {
      const c = item as Record<string, unknown>;
      if (typeof c.name !== 'string' || typeof c.providerId !== 'string' || typeof c.streamUrl !== 'string' || typeof c.lat !== 'number' || typeof c.lng !== 'number') {
        errors.push(`Пропущена запись без обязательных полей (name/providerId/streamUrl/lat/lng): ${JSON.stringify(c).slice(0, 120)}`);
        continue;
      }

      const locationType = typeof c.locationType === 'string' ? (c.locationType as any) : 'OUTDOOR';
      const mobilityType = typeof c.mobilityType === 'string' ? (c.mobilityType as any) : 'STATIONARY';
      const routeGeometry = Array.isArray(c.routeGeometry) ? (c.routeGeometry as any) : undefined;

      validRows.push({
        locationType,
        mobilityType,
        routeGeometry,
        data: {
          name: c.name,
          providerId: c.providerId,
          cityId: typeof c.cityId === 'string' ? c.cityId : undefined,
          streamUrl: c.streamUrl,
          streamType: typeof c.streamType === 'string' ? (c.streamType as any) : 'IFRAME',
          lat: c.lat,
          lng: c.lng,
          azimuth: typeof c.azimuth === 'number' ? c.azimuth : 0,
          azimuthSource: typeof c.azimuthSource === 'string' ? c.azimuthSource : undefined,
          fovAngle: typeof c.fovAngle === 'number' ? c.fovAngle : 80,
          rangeMeters: typeof c.rangeMeters === 'number' ? c.rangeMeters : 200,
          heightMeters: typeof c.heightMeters === 'number' ? c.heightMeters : undefined,
          confidence: typeof c.confidence === 'string' ? (c.confidence as any) : 'ESTIMATED',
          status: typeof c.status === 'string' ? (c.status as any) : 'UNKNOWN',
          lastCheckedAt: typeof c.lastCheckedAt === 'string' ? new Date(c.lastCheckedAt) : undefined,
          locationType,
          district: typeof c.district === 'string' ? c.district : undefined,
          notes: typeof c.notes === 'string' ? c.notes : undefined,
          mobilityType,
          routeGeometry: routeGeometry as any,
          routeMode: typeof c.routeMode === 'string' ? (c.routeMode as any) : undefined,
          routeSchedule: c.routeSchedule as any,
          averageSpeed: typeof c.averageSpeed === 'number' ? c.averageSpeed : undefined,
          routeStartedAt: typeof c.routeStartedAt === 'string' ? new Date(c.routeStartedAt) : undefined,
          routeLengthMeters: routeGeometry ? routeLength(routeGeometry) : undefined,
          lastAutoCalibrationAttemptAt: typeof c.lastAutoCalibrationAttemptAt === 'string' ? new Date(c.lastAutoCalibrationAttemptAt) : undefined,
          autoCalibrationAttemptCount: typeof c.autoCalibrationAttemptCount === 'number' ? c.autoCalibrationAttemptCount : undefined,
          lastAiCalibrationSuggestion: c.lastAiCalibrationSuggestion as any,
        },
      });
    }

    if (validRows.length === 0) {
      return { created: 0, skipped: errors.length, total: items.length, errors: errors.slice(0, 20) };
    }

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          // Масовий INSERT за ОДИН мережевий запит. createManyAndReturn (Prisma 5.14+,
          // PostgreSQL) повертає рядки в ТОМУ САМОМУ порядку, що й вхідний масив — на цьому
          // тримається зіставлення insertedRows[i] <-> validRows[i] нижче.
          const insertedRows = await (tx.camera as any).createManyAndReturn({
            data: validRows.map((r) => r.data),
            select: { id: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true },
          });

          // Один batched UPDATE для fov_polygon УСІХ OUTDOOR-камер разом — замість окремого
          // UPDATE на кожну (той самий сектор-EWKT, що вже рахує sectorToEwkt(), лише тепер
          // зібраний у єдиний SQL-запит через VALUES-таблицю).
          const outdoorParams: unknown[] = [];
          const outdoorValues: string[] = [];
          validRows.forEach((r, i) => {
            if (r.locationType !== 'OUTDOOR') return;
            const row = insertedRows[i];
            const ewkt = sectorToEwkt(row);
            const base = outdoorParams.length;
            outdoorParams.push(row.id, ewkt);
            outdoorValues.push(`($${base + 1}, $${base + 2})`);
          });
          if (outdoorValues.length > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE "Camera" AS c SET fov_polygon = ST_GeomFromEWKT(v.ewkt) FROM (VALUES ${outdoorValues.join(', ')}) AS v(id, ewkt) WHERE c.id = v.id`,
              ...outdoorParams,
            );
          }

          // Той самий підхід для route_line/route_buffer_polygon FIXED_ROUTE-камер (зазвичай
          // значно менша підмножина, ніж OUTDOOR, але той самий принцип — один запит, не N).
          const routeParams: unknown[] = [];
          const routeValues: string[] = [];
          validRows.forEach((r, i) => {
            if (r.mobilityType !== 'FIXED_ROUTE' || !r.routeGeometry) return;
            const row = insertedRows[i];
            const lineEwkt = routeLineToEwkt(r.routeGeometry);
            const degreesBuffer = row.rangeMeters / 111320; // те саме грубе наближення метри->градуси, що вже в syncCameraRoutePolygon()
            const base = routeParams.length;
            routeParams.push(row.id, lineEwkt, degreesBuffer);
            routeValues.push(`($${base + 1}, $${base + 2}, $${base + 3}::double precision)`);
          });
          if (routeValues.length > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE "Camera" AS c SET route_line = ST_GeomFromEWKT(v.line_ewkt), route_buffer_polygon = ST_Buffer(ST_GeomFromEWKT(v.line_ewkt), v.buf) FROM (VALUES ${routeValues.join(', ')}) AS v(id, line_ewkt, buf) WHERE c.id = v.id`,
              ...routeParams,
            );
          }

          return insertedRows.length;
        },
        { timeout: 60_000 }, // Prisma-транзакції за замовчуванням мають короткий таймаут (5с) — цього мало для сотень рядків, піднято з запасом
      );

      return { created, skipped: errors.length, total: items.length, errors: errors.slice(0, 20) };
    } catch (err) {
      // "Усе або нічого" (див. коментар вище методу) — якщо транзакція впала, ЖОДНА камера
      // не створена. Явно повідомляємо про це, а не тихо повертаємо created: 0 без пояснення.
      return {
        created: 0,
        skipped: items.length,
        total: items.length,
        errors: [`Импорт полностью откачен (транзакция не прошла): ${(err as Error).message}`, ...errors.slice(0, 19)],
      };
    }
  }

  async create(dto: CreateCameraDto) {
    this.validateMobilityFields(dto);

    const { routeGeometry, routeSchedule, routeStartedAt, ...rest } = dto;
    const camera = await this.prisma.camera.create({
      data: {
        ...rest,
        confidence: 'ESTIMATED',
        status: 'UNKNOWN',
        routeGeometry: routeGeometry as any,
        routeSchedule: routeSchedule as any,
        routeStartedAt: routeStartedAt ? new Date(routeStartedAt) : undefined,
        routeLengthMeters: routeGeometry ? routeLength(routeGeometry) : undefined,
      },
    });

    await syncCameraPolygon(this.prisma, camera);
    if (camera.mobilityType === 'FIXED_ROUTE' && routeGeometry) {
      await syncCameraRoutePolygon(this.prisma, camera.id, routeGeometry, camera.rangeMeters);
    }
    return camera;
  }

  async update(id: string, dto: UpdateCameraDto) {
    this.validateMobilityFields(dto, await this.findOne(id));

    const { routeGeometry, routeSchedule, routeStartedAt, ...rest } = dto;
    const camera = await this.prisma.camera.update({
      where: { id },
      data: {
        ...rest,
        routeGeometry: routeGeometry as any,
        routeSchedule: routeSchedule as any,
        routeStartedAt: routeStartedAt ? new Date(routeStartedAt) : undefined,
        routeLengthMeters: routeGeometry ? routeLength(routeGeometry) : undefined,
      },
    });

    // Only touch the geometry column if a geometry-relevant field was actually present
    // in the payload (checked via `!== undefined`, since azimuth=0 is a valid value).
    const geometryFieldsTouched = [dto.lat, dto.lng, dto.azimuth, dto.fovAngle, dto.rangeMeters].some(
      (v) => v !== undefined,
    );
    if (geometryFieldsTouched) {
      await syncCameraPolygon(this.prisma, camera);
    }

    if (camera.mobilityType === 'FIXED_ROUTE' && (routeGeometry || geometryFieldsTouched)) {
      const geometry = routeGeometry ?? ((camera.routeGeometry as any) as LatLng[]);
      if (geometry?.length >= 2) {
        await syncCameraRoutePolygon(this.prisma, camera.id, geometry, camera.rangeMeters);
      }
    }

    // A cached position (route-position.service in-process cache) is only ever wrong for the
    // rest of its TTL (max 5s) after an admin edits the route — acceptable, but invalidate
    // anyway so calibration/route edits are reflected on the very next request.
    this.routePosition.invalidate(camera.id);

    return camera;
  }

  // Soft delete (по всьому проєкту, за прямим запитом користувача — див.
  // doc/AUDIT-camera-soft-delete.md): НЕ видаляємо запис фізично — позначаємо deletedAt.
  // Причини: (1) CameraSourceRaw.cameraId/CameraSubmission.createdCameraId досі посилаються на
  // цю камеру — фізичне видалення або впало б на FK-обмеженні, або залишило б биті посилання;
  // (2) можливість "відновити" видалену камеру в майбутньому без повторного проходу
  // імпорту/калібрування з нуля.
  async remove(id: string) {
    await this.prisma.camera.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }

  // Масове "Удалить нерабочие" (кнопка над списком камер, див. запит користувача) — той самий
  // soft delete, застосований до всіх активних камер зі статусом OFFLINE одразу. Свідомо НЕ
  // чіпає DISABLED_SECURITY (ручний оверрайд власника — окрема причина, не "не працює") і вже
  // видалені камери (виключені через deletedAt: null у where нижче).
  // Світова карта (див. запит користувача: "у зв'язку з воєнним станом важко буде стартувати в
  // Україні або Росії — почати збір даних по камерах по всьому світу... на карті відображати
  // кількість камер по країнах, щоб розуміти в яку сторону рухатися") — групування по
  // City.countryCode/countryName, тільки активні (не soft-deleted) камери.
  async getCameraCountByCountry() {
    const cameras = await this.prisma.camera.findMany({
      where: { deletedAt: null },
      include: { city: { select: { countryCode: true, countryName: true } } },
    });

    const counts = new Map<string, { countryCode: string; countryName: string; count: number }>();
    for (const camera of cameras) {
      // Камери без прив'язаного City (не мали б траплятись у нормі, але захисно) —
      // групуємо окремо, щоб не втратити з підрахунку взагалі.
      const countryCode = camera.city?.countryCode ?? 'UNKNOWN';
      const countryName = camera.city?.countryName ?? (countryCode === 'UA' ? 'Україна' : countryCode === 'UNKNOWN' ? 'Невідомо' : countryCode);
      const existing = counts.get(countryCode);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(countryCode, { countryCode, countryName, count: 1 });
      }
    }

    return [...counts.values()].sort((a, b) => b.count - a.count);
  }

  async removeAllOffline() {
    const result = await this.prisma.camera.updateMany({
      where: { status: 'OFFLINE', deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deletedCount: result.count };
  }

  // Admin calibration tool (5.1): saving here always promotes ESTIMATED -> VERIFIED,
  // since a human has now visually confirmed the sector against the real camera feed.
  // NOTE: only meaningful for STATIONARY cameras — a FIXED_ROUTE camera's real position
  // changes continuously, so there is nothing fixed here to "calibrate" against.
  // Автокалибровка (див. запит користувача: "автоматизировать автокалибровку - ИИ чтобы
  // определял азимут и FOV") — див. GrokCameraAssistService.suggestAzimuthFov() за деталями й
  // чесним застереженням щодо надійності. Нічого не зберігає — тільки пропозиція, адмін сам
  // застосовує (чи ні) до форми калібрування.
  async suggestAzimuthFovForCamera(id: string) {
    const camera = await this.findOne(id);
    // За прямим запитом користувача — передаємо результат ПОПЕРЕДНЬОЇ спроби (якщо була
    // збережена, doc/AUDIT-auto-calibrate-batch.md "Оновлення 10"), щоб AI будував на
    // власному попередньому аналізі, а не оцінював кадр "з нуля" щоразу.
    const previousAttempt = camera.lastAiCalibrationSuggestion as any;
    const suggestion = await this.grokAssist.suggestAzimuthFov(
      camera.name,
      camera.streamUrl,
      camera.streamType,
      camera.lat,
      camera.lng,
      { azimuth: camera.azimuth, fovAngle: camera.fovAngle, rangeMeters: camera.rangeMeters },
      previousAttempt ?? null,
    );

    // За прямим запитом користувача — зберігаємо ПОВНИЙ результат (включно з reasoning) для
    // подальшого навчання ревьюверів/операторів і дебагу, незалежно від того, чи впевненість
    // достатня, щоб щось застосувати автоматично — тут узагалі нічого не застосовується
    // автоматично (це підказка для людини на сторінці калібрування), тому зберігаємо завжди.
    try {
      await this.prisma.camera.update({
        where: { id },
        data: {
          lastAiCalibrationSuggestion: {
            suggestedAzimuth: suggestion.suggestedAzimuth,
            suggestedFovAngle: suggestion.suggestedFovAngle,
            suggestedRangeMeters: suggestion.suggestedRangeMeters,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            checkedAt: new Date().toISOString(),
            source: 'manual',
          },
        },
      });
    } catch (err) {
      // Збереження діагностичного тексту — не критичний шлях; якщо не вдалось (наприклад,
      // камеру видалили паралельно) — сама підказка вже повернута фронтенду, це не має
      // блокувати відповідь користувачу.
      this.logger.warn(`Не удалось сохранить lastAiCalibrationSuggestion для камеры ${id}: ${(err as Error).message}`);
    }

    return suggestion;
  }

  // Автокалібрування пачками по 10 (див. запит користувача: "выбирать по 10 камер и
  // пытаться калибровать через ии — при уверенности 100 процентов записывать калибровку в
  // базу"). Обирає ТІЛЬКИ camera.confidence === 'ESTIMATED' (не чіпає вже VERIFIED — той
  // самий принцип, що всюди в проєкті: AI-підказка ніколи не перезаписує те, що вже
  // підтвердив адмін вручну). Порядок вибору — lastAutoCalibrationAttemptAt ASC NULLS FIRST
  // (ніколи не пробовані камери — першими) — не застрягає нескінченно на тих самих кількох
  // камерах, де AI щоразу невпевнений, а рухається по всьому реєстру.
  //
  // ОНОВЛЕНО за прямим запитом користувача: при впевненості AI 100% (і наявності всіх трьох
  // значень одразу) камера тепер промотується у confidence: 'VERIFIED', не лишається
  // ESTIMATED. Попереднє рішення (VERIFIED = лише людська перевірка вручну, AI-впевненість —
  // не те саме) було свідомим, але користувач явно попросив саме цю поведінку — тому
  // скасовано прямою вказівкою, не помилка чи регресія.
  async autoCalibrateBatch() {
    const BATCH_SIZE = 50; // за запитом користувача — піднято з 10 до 50
    const CONFIDENCE_THRESHOLD = getAiCalibrationConfidenceThreshold(); // за запитом користувача — знижено зі 100%, див. коментар до getAiCalibrationConfidenceThreshold()

    // ВАЖЛИВО (реальний знайдений інцидент — 500 на живому сервері): раніше тут стояв
    // одинарний orderBy з {sort: 'asc', nulls: 'first'} — цей синтаксис вимагає ввімкненої
    // preview-фічі Prisma ("orderByNulls" у generator-блоці schema.prisma), якої в проєкті
    // немає. Локальна пісочниця цього не виявила (заглушка @prisma/client там надто
    // спрощена — приймає будь-який синтаксис як any), а на реальному клієнті Prisma запит
    // падав з помилкою валідації, що бекенд віддавав як 500 з нестандартизованим тілом
    // відповіді (звідси "Unexpected token 'I'" на фронтенді — тіло не було JSON узагалі).
    // Виправлено без потреби вмикати preview-фічу — два окремих, стабільних запити замість
    // одного: спершу ніколи не пробувані (NULL), потім, якщо не вистачає, найдавніше
    // пробувані — той самий "nulls first" результат звичайним, гарантовано підтримуваним
    // Prisma API.
    const neverTried = await this.prisma.camera.findMany({
      where: { confidence: 'ESTIMATED', deletedAt: null, lastAutoCalibrationAttemptAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    const cameras =
      neverTried.length >= BATCH_SIZE
        ? neverTried
        : [
            ...neverTried,
            ...(await this.prisma.camera.findMany({
              where: { confidence: 'ESTIMATED', deletedAt: null, lastAutoCalibrationAttemptAt: { not: null } },
              // За прямим запитом користувача — головний пріоритет за КІЛЬКІСТЮ спроб (менше
              // спроб — раніше в черзі), не лише за часом останньої спроби — забезпечує
              // рівномірний розподіл AI-спроб по всьому реєстру. Час — лише вторинний
              // тайбрейк для камер з однаковою кількістю спроб.
              orderBy: [{ autoCalibrationAttemptCount: 'asc' }, { lastAutoCalibrationAttemptAt: 'asc' }],
              take: BATCH_SIZE - neverTried.length,
            })),
          ];

    // Конкурентна обробка (див. запит користувача: "100 секунд судя по скрину - примени
    // многопоточность") — той самий принцип, що вже застосований для NYC TMC парсера (див.
    // doc/AUDIT-nyctmc-performance.md): вузьке місце тут — очікування мережі (виклик vision-
    // моделі на кожну камеру), не CPU-обчислення, тому справжні OS-потоки не дали б виграшу;
    // правильний відповідник — конкурентні проміси. Оскільки пачка вже жорстко обмежена 10
    // елементами (на відміну від парсера, де могли бути сотні), додаткове батчування на
    // менші шматки не потрібне — просто Promise.all() одразу на всі 10. Try/catch на кожну
    // камеру (див. коментар нижче) лишається без змін — потрібен так само і при конкурентній
    // обробці: один зірваний проміс не повинен впливати на решту.
    const results = await Promise.all(
      cameras.map(async (camera) => {
        // ВАЖЛИВО (реальний знайдений інцидент — другий 500 на живому сервері, вже ПІСЛЯ
        // виправлення orderBy вище): на відміну від УСІХ інших місць пакетної обробки в проєкті
        // (ScraperService.runForProvider(), AggregatorDiscoveryService, importCameras()) — тут
        // не було try/catch на кожну ОКРЕМУ камеру. Якщо suggestAzimuthFov()/camera.update()/
        // syncCameraPolygon() кидали виняток для БУДЬ-ЯКОЇ причини (мережевий таймаут до AI,
        // неочікувана помилка) на, скажімо, 5-й камері з 10 — весь прохід обривався
        // необробленим винятком, а не позначав саме ЦЮ камеру як невдалу й продовжував далі.
        try {
          // За прямим запитом користувача — та сама передача попередньої спроби, що для
          // одиночної калібровки вище.
          const previousAttempt = (camera as any).lastAiCalibrationSuggestion;
          const suggestion = await this.grokAssist.suggestAzimuthFov(
            camera.name,
            camera.streamUrl,
            camera.streamType,
            camera.lat,
            camera.lng,
            { azimuth: camera.azimuth, fovAngle: camera.fovAngle, rangeMeters: camera.rangeMeters },
            previousAttempt ?? null,
          );

          const canApply =
            suggestion.confidence >= CONFIDENCE_THRESHOLD &&
            suggestion.suggestedAzimuth != null &&
            suggestion.suggestedFovAngle != null &&
            suggestion.suggestedRangeMeters != null;

          // За прямим запитом користувача — зберігаємо ПОВНИЙ результат (включно з reasoning)
          // для подальшого навчання ревьюверів/операторів і дебагу, незалежно від того, чи
          // застосовано автоматично — саме випадки з низькою впевненістю найцікавіші для
          // аналізу (чому AI не був упевнений).
          const suggestionRecord = {
            suggestedAzimuth: suggestion.suggestedAzimuth,
            suggestedFovAngle: suggestion.suggestedFovAngle,
            suggestedRangeMeters: suggestion.suggestedRangeMeters,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            checkedAt: new Date().toISOString(),
            source: 'auto-batch-sync',
          };

          if (canApply) {
            await this.prisma.camera.update({
              where: { id: camera.id },
              data: {
                azimuth: suggestion.suggestedAzimuth!,
                fovAngle: suggestion.suggestedFovAngle!,
                rangeMeters: suggestion.suggestedRangeMeters!,
                // За прямим запитом користувача: при впевненості AI 100% (і наявності всіх
                // трьох значень) камера тепер промотується у VERIFIED — попереднє рішення
                // (лишати ESTIMATED, вважаючи AI-впевненість не рівною людській перевірці)
                // свідомо скасовано за явною вказівкою користувача, не помилка.
                confidence: 'VERIFIED',
                lastAutoCalibrationAttemptAt: new Date(),
                autoCalibrationAttemptCount: { increment: 1 },
                lastAiCalibrationSuggestion: suggestionRecord,
              },
            });
            await syncCameraPolygon(this.prisma, { ...camera, azimuth: suggestion.suggestedAzimuth!, fovAngle: suggestion.suggestedFovAngle!, rangeMeters: suggestion.suggestedRangeMeters! } as any);
          } else {
            await this.prisma.camera.update({
              where: { id: camera.id },
              data: { lastAutoCalibrationAttemptAt: new Date(), autoCalibrationAttemptCount: { increment: 1 }, lastAiCalibrationSuggestion: suggestionRecord },
            });
          }

          return {
            cameraId: camera.id,
            name: camera.name,
            calibrated: canApply,
            confidence: suggestion.confidence,
            reason: canApply ? null : suggestion.unavailableReason ?? `AI не достиг порога уверенности (${Math.round(getAiCalibrationConfidenceThreshold() * 100)}%) по всем трём значениям (азимут/FOV/дальность).`,
          };
        } catch (err) {
          // Навіть при помилці позначаємо спробу (lastAutoCalibrationAttemptAt) — інакше ця
          // сама камера знову й знову опинялась би першою в наступних пачках, замість руху
          // вперед по реєстру (та сама мета, що й основний механізм прогресу вище).
          try {
            await this.prisma.camera.update({ where: { id: camera.id }, data: { lastAutoCalibrationAttemptAt: new Date(), autoCalibrationAttemptCount: { increment: 1 } } });
          } catch {
            // якщо навіть це не вдалось (наприклад, камеру видалили паралельно) — просто йдемо далі
          }
          this.logger.warn(`Автокалибровка камеры "${camera.name}" (${camera.id}) упала с ошибкой: ${(err as Error).message}`);
          return {
            cameraId: camera.id,
            name: camera.name,
            calibrated: false,
            confidence: 0,
            reason: `Ошибка при обработке: ${(err as Error).message}`,
          };
        }
      }),
    );

    return { processed: cameras.length, calibrated: results.filter((r) => r.calibrated).length, results };
  }

  // ---------------------------------------------------------------------------------------
  // Batch API xAI для групової верифікації камер (за прямим запитом користувача — розширення
  // GrokBatchJob, doc/AUDIT-grok-batch-api.md) — ДОДАТКОВИЙ, окремий шлях поруч із
  // синхронним autoCalibrateBatch() вище (той лишається без змін для швидкого,
  // інтерактивного випадку — кнопка "🤖 Автокалибровка", результат за секунди). Цей шлях —
  // свідомий вибір адміна: почекати довше (типово до 24 годин, best-effort) заради знижки
  // 20-50% вартості.
  // ---------------------------------------------------------------------------------------

  // Той самий вибір камер, що вже є в autoCalibrateBatch() (ESTIMATED, ніколи не пробувані
  // спершу) — але тут одразу позначаємо lastAutoCalibrationAttemptAt при ПОДАЧІ пакета (не
  // при отриманні результату, як у синхронному шляху) — інакше ті самі 50 камер потрапили б
  // у ЩЕ ОДИН пакет, поданий до того, як перший встиг завершитись.
  async submitCalibrationBatch() {
    const BATCH_SIZE = 50;

    const neverTried = await this.prisma.camera.findMany({
      where: { confidence: 'ESTIMATED', deletedAt: null, lastAutoCalibrationAttemptAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    const cameras =
      neverTried.length >= BATCH_SIZE
        ? neverTried
        : [
            ...neverTried,
            ...(await this.prisma.camera.findMany({
              where: { confidence: 'ESTIMATED', deletedAt: null, lastAutoCalibrationAttemptAt: { not: null } },
              // За прямим запитом користувача — головний пріоритет за КІЛЬКІСТЮ спроб (менше
              // спроб — раніше в черзі), не лише за часом останньої спроби — забезпечує
              // рівномірний розподіл AI-спроб по всьому реєстру. Час — лише вторинний
              // тайбрейк для камер з однаковою кількістю спроб.
              orderBy: [{ autoCalibrationAttemptCount: 'asc' }, { lastAutoCalibrationAttemptAt: 'asc' }],
              take: BATCH_SIZE - neverTried.length,
            })),
          ];

    if (cameras.length === 0) {
      return { submitted: false, reason: 'Нет камер со статусом ESTIMATED для калибровки.' };
    }

    const submission = await this.grokAssist.submitAzimuthFovBatch(cameras);
    if ('error' in submission) {
      return { submitted: false, reason: submission.error };
    }

    await this.prisma.grokBatchJob.create({
      data: {
        xaiBatchId: submission.xaiBatchId,
        jobType: 'camera-calibration',
        status: 'pending',
        requestMap: submission.requestMap as any,
      },
    });

    // Позначаємо спробу одразу, щоб ці самі камери не потрапили в наступний пакет, поки цей
    // ще не завершився (див. коментар класу вище).
    await this.prisma.camera.updateMany({
      where: { id: { in: cameras.map((c) => c.id) } },
      data: { lastAutoCalibrationAttemptAt: new Date(), autoCalibrationAttemptCount: { increment: 1 } },
    });

    return { submitted: true, xaiBatchId: submission.xaiBatchId, camerasInBatch: cameras.length };
  }

  // Опитування ще не оброблених пакетів калібрування — викликається і з cron (фонове
  // опитування, типово раз на годину), і з фронтенду при відкритті сторінки камер (див. запит
  // користувача: "при загрузке страницы камер проверять все батчи на завершенность").
  async processPendingCalibrationBatches() {
    const pendingJobs = await this.prisma.grokBatchJob.findMany({
      where: { jobType: 'camera-calibration', status: { in: ['pending', 'processing'] } },
    });

    let processed = 0;
    let stillPending = 0;
    let calibratedTotal = 0;

    for (const job of pendingJobs) {
      const statusInfo = await this.grokAssist.getBatchStatus(job.xaiBatchId);
      if (!statusInfo) {
        stillPending += 1;
        continue;
      }

      // ✅ ВИПРАВЛЕНО за підтвердженим реальним викликом (лог сервера показав точну відповідь
      // xAI): жодного плоского поля "status" немає взагалі — є лише вкладений "state" з
      // num_requests/num_pending/num_success/num_error/num_cancelled. Готовність batch —
      // pendingCount === 0, НЕ completedCount === totalCount (частина запитів могла
      // завершитись помилкою, тоді num_success ніколи не дорівнюватиме num_requests, попри
      // те, що сам batch уже дійсно готовий).
      const isActuallyDone = statusInfo.totalCount > 0 && statusInfo.pendingCount === 0;
      if (!isActuallyDone) {
        stillPending += 1;
        continue;
      }

      const resultsByRequestId = await this.grokAssist.getAzimuthFovBatchResults(job.xaiBatchId);
      const requestMap = job.requestMap as Record<string, { cameraId: string }>;

      for (const [batchRequestId, { cameraId }] of Object.entries(requestMap)) {
        const suggestion = resultsByRequestId[batchRequestId];
        if (!suggestion) continue;

        const canApply = suggestion.confidence >= getAiCalibrationConfidenceThreshold() && suggestion.suggestedAzimuth != null && suggestion.suggestedFovAngle != null && suggestion.suggestedRangeMeters != null;

        const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
        if (!camera) continue; // могли видалити, поки чекали результат пакета

        // За прямим запитом користувача — зберігаємо ПОВНИЙ результат (включно з reasoning)
        // для подальшого навчання ревьюверів/операторів і дебагу. РАНІШЕ тут стояв ранній
        // "continue" для camerи, що не пройшла поріг, — жодного запису взагалі НЕ робилось,
        // хоча саме такі випадки (AI невпевнений) найцікавіші для аналізу причин.
        const suggestionRecord = {
          suggestedAzimuth: suggestion.suggestedAzimuth,
          suggestedFovAngle: suggestion.suggestedFovAngle,
          suggestedRangeMeters: suggestion.suggestedRangeMeters,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          checkedAt: new Date().toISOString(),
          source: 'auto-batch-async',
        };

        if (!canApply) {
          // lastAutoCalibrationAttemptAt/autoCalibrationAttemptCount уже проставлені при
          // поданні пакета — тут оновлюємо ЛИШЕ діагностичний запис.
          await this.prisma.camera.update({ where: { id: cameraId }, data: { lastAiCalibrationSuggestion: suggestionRecord } });
          continue; // камера лишається ESTIMATED
        }

        await this.prisma.camera.update({
          where: { id: cameraId },
          data: {
            azimuth: suggestion.suggestedAzimuth!,
            fovAngle: suggestion.suggestedFovAngle!,
            rangeMeters: suggestion.suggestedRangeMeters!,
            confidence: 'VERIFIED', // та сама логіка, що синхронний шлях (див. запит користувача про VERIFIED при 100%)
            lastAiCalibrationSuggestion: suggestionRecord,
          },
        });
        await syncCameraPolygon(this.prisma, { ...camera, azimuth: suggestion.suggestedAzimuth!, fovAngle: suggestion.suggestedFovAngle!, rangeMeters: suggestion.suggestedRangeMeters! } as any);
        calibratedTotal += 1;
      }

      // ВАЖЛИВО (реальний знайдений інцидент — job позначався "completed" одразу, навіть
      // якщо resultsByRequestId виявився ПОРОЖНІМ (0 результатів витягнуто попри те, що
      // batch дійсно завершений і requestMap непорожній) — сильний сигнал, що ПАРСИНГ
      // зламаний (структура відповіді відрізняється від очікуваної), а не що AI просто ні в
      // чому не був упевнений для ВСІХ камер одразу. Позначення "completed" у такому випадку
      // назавжди "губило" batch — getAzimuthFovBatchResults() більше ніколи не викликався б
      // для нього, навіть після виправлення парсингу. Тепер — якщо результатів 0 попри
      // непорожній requestMap, лишаємо job у стані "processing" (не completed), щоб
      // наступний прохід спробував ще раз, коли парсинг буде виправлено.
      const requestMapSize = Object.keys(requestMap).length;
      if (requestMapSize > 0 && Object.keys(resultsByRequestId).length === 0) {
        this.logger.warn(`processPendingCalibrationBatches: batch ${job.xaiBatchId} завершён (${requestMapSize} камер в пачке), но не удалось извлечь НИ ОДНОГО результата — вероятно, парсинг ответа сломан. Job оставлен в processing для повторной попытки, НЕ помечен completed.`);
        await this.prisma.grokBatchJob.update({ where: { id: job.id }, data: { status: 'processing' } });
        stillPending += 1;
        continue;
      }

      await this.prisma.grokBatchJob.update({ where: { id: job.id }, data: { status: 'completed', processedAt: new Date() } });
      processed += 1;
    }

    return { processed, stillPending, calibratedTotal };
  }

  // Проверка доступности контента по запросу (кнопка на экране калибровки — см. запрос
  // пользователя: "недоступное видео"). Ничего не сохраняет автоматически здесь — только
  // предложение; если available: false, фронтенд может предложить админу перевести камеру в
  // OFFLINE/удалить (см. также автоматический фоновый вариант в MonitoringService, который
  // ПРИМЕНЯЕТ решение сам, отдельно от этого on-demand метода).
  async checkAvailabilityForCamera(id: string) {
    const camera = await this.findOne(id);
    return this.grokAssist.checkStreamAvailability(camera.streamUrl, camera.streamType);
  }

  async calibrate(id: string, dto: CalibrateCameraDto) {
    const camera = await this.prisma.camera.update({
      where: { id },
      data: { ...dto, confidence: 'VERIFIED', azimuthSource: 'manual' },
    });

    // Камеры внутри помещений (см. doc/README.md, "Камери всередині приміщень") — сектор
    // обзора не имеет физического смысла, поэтому не строится вовсе; если админ переключает
    // уже существующую (ранее OUTDOOR) камеру на INDOOR через калибровку, явно обнуляем
    // старый fov_polygon — не оставляем висящую геометрию от прежнего состояния.
    if (camera.locationType === 'INDOOR') {
      await this.prisma.$executeRawUnsafe(`UPDATE "Camera" SET fov_polygon = NULL WHERE id = $1`, camera.id);
    } else {
      await syncCameraPolygon(this.prisma, camera);
    }

    return camera;
  }

  // Public search flow (section 3 of the ТЗ): address -> geocode -> sector-test -> sorted list.
  // Глава 16: now a full participant flow for FIXED_ROUTE cameras too.
  // Поддержка городов Украины (см. doc/README.md): cityId — необязательная подсказка, и для
  // геокодинга (дизамбигуация одноимённых улиц в разных городах), и для фильтра кандидатов.
  // Без неё поиск идёт по всей стране — работает, но хуже разрешает частые названия улиц.
  async searchByAddress(address: string, checkOcclusion = false, cityId?: string) {
    const city = cityId ? await this.cities.findById(cityId) : null;
    const geocoded = await this.geocoding.geocode(address, city);
    if (!geocoded) {
      return { address, point: null, cameras: [] as CameraSearchResult[], indoorNearby: [] as IndoorCameraResult[], natureNearby: [] as IndoorCameraResult[] };
    }

    const point = { lat: geocoded.lat, lng: geocoded.lng };
    const results = await this.resolveResultsForPoint(point, checkOcclusion, cityId);
    const indoorNearby = await this.findIndoorNearby(point, undefined, cityId);
    const natureNearby = await this.findNatureNearby(point, undefined, cityId);
    return { address, point, cameras: results, indoorNearby, natureNearby };
  }

  // Глава 16 ТЗ: /cameras/at-point — same sector-test pipeline as /search, but starting from
  // a point directly (e.g. a tap on the map) instead of a geocoded address.
  async findAtPoint(point: LatLng, checkOcclusion = false, cityId?: string) {
    const results = await this.resolveResultsForPoint(point, checkOcclusion, cityId);
    const indoorNearby = await this.findIndoorNearby(point, undefined, cityId);
    const natureNearby = await this.findNatureNearby(point, undefined, cityId);
    return { point, cameras: results, indoorNearby, natureNearby };
  }

  // Камеры внутри помещений (см. doc/README.md, "Камери всередині приміщень") — не участвуют в
  // поиске по сектору (нет осмысленного направления обзора улицы, см. findCandidatesNearPoint),
  // но всё равно могут быть интересны рядом с искомым адресом (например, храм/музей у самой
  // площади) — простая проверка по прямой дистанции, не по сектору обзора.
  async findIndoorNearby(point: LatLng, radiusMeters = getIndoorNearbyRadiusMeters(), cityId?: string): Promise<IndoorCameraResult[]> {
    const cameras = await this.prisma.camera.findMany({
      where: { locationType: 'INDOOR', deletedAt: null, ...(cityId ? { cityId } : {}) },
    });

    return cameras
      .map((c) => ({
        id: c.id,
        name: c.name,
        streamUrl: c.streamUrl,
        streamType: c.streamType,
        confidence: c.confidence,
        status: c.status,
        lat: c.lat,
        lng: c.lng,
        distanceMeters: Math.round(haversineDistance(point, { lat: c.lat, lng: c.lng })),
      }))
      .filter((c) => c.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // Камери природа/пляж/море (див. запит користувача: "пометить камеры которые смотрят в
  // море пляж на природу как отдельный класс и исключить из поиска") — той самий принцип, що
  // findIndoorNearby() вище: не бере участі в пошуку за сектором (locationType != 'OUTDOOR'),
  // але все одно може бути цікавою як "поруч" — проста перевірка за прямою відстанню.
  async findNatureNearby(point: LatLng, radiusMeters = getIndoorNearbyRadiusMeters(), cityId?: string): Promise<IndoorCameraResult[]> {
    const cameras = await this.prisma.camera.findMany({
      where: { locationType: 'NATURE', deletedAt: null, ...(cityId ? { cityId } : {}) },
    });

    return cameras
      .map((c) => ({
        id: c.id,
        name: c.name,
        streamUrl: c.streamUrl,
        streamType: c.streamType,
        confidence: c.confidence,
        status: c.status,
        lat: c.lat,
        lng: c.lng,
        distanceMeters: Math.round(haversineDistance(point, { lat: c.lat, lng: c.lng })),
      }))
      .filter((c) => c.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // Shared by searchByAddress/findAtPoint: candidate prefilter -> per-mobility-type sector
  // test (static for STATIONARY, dynamic + look-ahead for FIXED_ROUTE) -> sort.
  private async resolveResultsForPoint(
    point: LatLng,
    checkOcclusion: boolean,
    cityId?: string,
  ): Promise<CameraSearchResult[]> {
    const { stationary, fixedRoute } = await this.findCandidatesNearPoint(point, cityId);

    const results: CameraSearchResult[] = [];

    for (const cam of stationary) {
      const { visible, distanceM, bearingFromCamera } = cameraSeesPoint(cam, point);
      if (!visible) continue;

      const result: CameraSearchResult = {
        id: cam.id,
        name: cam.name,
        streamUrl: cam.streamUrl,
        streamType: cam.streamType,
        confidence: cam.confidence,
        status: cam.status,
        delaySeconds: cam.delaySeconds,
        distanceMeters: Math.round(distanceM),
        directionFromCamera: compassLabel(bearingFromCamera),
        lat: cam.lat,
        lng: cam.lng,
        azimuth: cam.azimuth,
        fovAngle: cam.fovAngle,
        rangeMeters: cam.rangeMeters,
        mobilityType: 'STATIONARY',
        etaSeconds: 0,
        cameraLat: cam.lat,
        cameraLng: cam.lng,
        cameraAzimuth: cam.azimuth,
        cameraSpeed: 0,
      };

      if (checkOcclusion) {
        result.possiblyBlocked = await this.occlusion.isPossiblyBlocked(cam, point, cam.rangeMeters);
      }

      results.push(result);
    }

    for (const cam of fixedRoute) {
      const fixedRouteCamera = toFixedRouteCamera(cam);
      const { position, sector } = this.routePosition.getCurrentPosition(fixedRouteCamera);
      const now = cameraSeesPoint(sector, point);

      let etaSeconds = 0;
      let distanceM = now.distanceM;
      let cameraAt = position;
      let confidence: number | undefined;

      if (!now.visible) {
        // Глава 17 "прогноз встречи": not visible right now — is this camera about to pass by?
        const encounter = this.lookAhead.predictPointEncounter(
          fixedRouteCamera,
          point,
          SEARCH_LOOKAHEAD_HORIZON_SECONDS,
          SEARCH_LOOKAHEAD_STEP_SECONDS,
        );
        if (!encounter) continue; // won't see this point within the look-ahead horizon — drop it

        etaSeconds = encounter.etaSeconds;
        distanceM = encounter.distanceMeters;
        cameraAt = encounter.cameraPosition;
        confidence = encounter.confidence;
      } else {
        confidence = this.lookAhead.confidenceFor(position.source, position.degraded);
      }

      const bearingFromCamera = bearing({ lat: cameraAt.lat, lng: cameraAt.lng }, point);

      const result: CameraSearchResult = {
        id: cam.id,
        name: cam.name,
        streamUrl: cam.streamUrl,
        streamType: cam.streamType,
        confidence: cam.confidence,
        status: cam.status,
        delaySeconds: cam.delaySeconds,
        distanceMeters: Math.round(distanceM),
        directionFromCamera: compassLabel(bearingFromCamera),
        lat: cam.lat,
        lng: cam.lng,
        azimuth: cam.azimuth,
        fovAngle: cam.fovAngle,
        rangeMeters: cam.rangeMeters,
        mobilityType: 'FIXED_ROUTE',
        etaSeconds,
        cameraLat: cameraAt.lat,
        cameraLng: cameraAt.lng,
        cameraAzimuth: cameraAt.azimuth,
        cameraSpeed: cameraAt.speedMps,
        meetingConfidence: confidence,
      };

      if (checkOcclusion) {
        // Occlusion is only checked against the *current/predicted* position — a static
        // building-occlusion check doesn't really apply once the camera itself is moving,
        // but it's still a reasonable best-effort signal for the specific instant in question.
        result.possiblyBlocked = await this.occlusion.isPossiblyBlocked(
          { lat: cameraAt.lat, lng: cameraAt.lng },
          point,
          cam.rangeMeters,
        );
      }

      results.push(result);
    }

    // Глава 17 ТЗ sort order: ETA, then distance, then confidence. For STATIONARY results
    // etaSeconds is always 0, so this reduces to the original distance-only sort — same
    // behaviour as before глава 16 for an all-STATIONARY result set.
    results.sort(
      (a, b) =>
        a.etaSeconds - b.etaSeconds ||
        a.distanceMeters - b.distanceMeters ||
        (b.meetingConfidence ?? 1) - (a.meetingConfidence ?? 1),
    );

    return results;
  }

  // Uses the PostGIS fov_polygon/route_buffer_polygon columns for a cheap first-pass filter,
  // falling back to a full JS scan if PostGIS/geo-migration.sql or route-migration.sql
  // haven't been run yet (e.g. a fresh local DB). cityId (see doc/README.md, "Города Украины")
  // additionally narrows candidates to one city — omitted, this scans all cities' cameras.
  private async findCandidatesNearPoint(point: LatLng, cityId?: string) {
    const cityFilter = cityId ? Prisma.sql`AND "cityId" = ${cityId}` : Prisma.empty;

    try {
      const [stationary, fixedRoute] = await Promise.all([
        this.prisma.$queryRaw<any[]>`
          SELECT id, name, "streamUrl", "streamType", confidence, status, "delaySeconds",
                 lat, lng, azimuth, "fovAngle", "rangeMeters"
          FROM "Camera"
          WHERE "mobilityType" = 'STATIONARY'
            AND "locationType" = 'OUTDOOR'
            AND "deletedAt" IS NULL
            AND fov_polygon IS NOT NULL
            AND ST_Contains(fov_polygon, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))
            ${cityFilter}
        `,
        this.prisma.$queryRaw<any[]>`
          SELECT id, name, "streamUrl", "streamType", confidence, status, "delaySeconds",
                 lat, lng, azimuth, "fovAngle", "rangeMeters",
                 "mobilityType", "routeGeometry", "routeLengthMeters", "routeMode", "routeSchedule",
                 "averageSpeed", "routeStartedAt", "liveGpsLat", "liveGpsLng", "liveGpsSpeed", "liveGpsUpdatedAt"
          FROM "Camera"
          WHERE "mobilityType" = 'FIXED_ROUTE'
            AND "locationType" = 'OUTDOOR'
            AND "deletedAt" IS NULL
            AND route_buffer_polygon IS NOT NULL
            AND ST_Contains(route_buffer_polygon, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326))
            ${cityFilter}
        `,
      ]);
      return { stationary, fixedRoute };
    } catch (err) {
      this.logger.warn(`PostGIS query failed, falling back to full scan: ${(err as Error).message}`);
      // Камеры внутри помещений (см. doc/README.md) исключаются и здесь тоже — без этого
      // фильтра запасной JS-путь (когда PostGIS недоступен/не настроен) ошибочно включил бы их
      // в поиск по сектору, хотя у них нет осмысленного направления обзора улицы.
      const all = await this.prisma.camera.findMany({ where: { locationType: 'OUTDOOR', deletedAt: null, ...(cityId ? { cityId } : {}) } });
      return {
        stationary: all.filter((c) => c.mobilityType === 'STATIONARY'),
        fixedRoute: all.filter((c) => c.mobilityType === 'FIXED_ROUTE'),
      };
    }
  }

  // FIXED_ROUTE requires routeGeometry + routeMode *when the camera is newly becoming
  // FIXED_ROUTE* (create, or an update that flips it from STATIONARY). An update that simply
  // re-states `mobilityType: "FIXED_ROUTE"` on an *already* FIXED_ROUTE camera (e.g. while
  // only changing its name) must not force the caller to resend the whole route every time.
  // TIMETABLE's routeSchedule requirement and averageSpeed are still validated independently
  // whenever the request actually touches routeMode, regardless of which branch above applies.
  private validateMobilityFields(dto: CreateCameraDto | UpdateCameraDto, existing?: { mobilityType: string }) {
    const mobilityType = dto.mobilityType ?? existing?.mobilityType ?? 'STATIONARY';
    if (mobilityType !== 'FIXED_ROUTE') return;

    const routeGeometry = dto.routeGeometry;
    const routeMode = dto.routeMode;
    const becomingFixedRoute = !existing || existing.mobilityType !== 'FIXED_ROUTE';

    if (becomingFixedRoute && (!routeGeometry || routeGeometry.length < 2)) {
      throw new BadRequestException('FIXED_ROUTE camera requires routeGeometry with at least 2 points');
    }
    if (becomingFixedRoute && !routeMode) {
      throw new BadRequestException('FIXED_ROUTE camera requires routeMode (LOOP | TIMETABLE | LIVE_GPS)');
    }
    if (routeMode === 'TIMETABLE' && !dto.routeSchedule?.departures?.length) {
      throw new BadRequestException('TIMETABLE routeMode requires routeSchedule.departures');
    }
    if ((routeMode === 'LOOP' || routeMode === 'TIMETABLE') && dto.averageSpeed === undefined && becomingFixedRoute) {
      throw new BadRequestException('LOOP/TIMETABLE routeMode requires averageSpeed (m/s)');
    }
  }
}

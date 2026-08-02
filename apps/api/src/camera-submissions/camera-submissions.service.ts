import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../common/geocoding.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';
import { syncCameraPolygon } from '../common/geometry.util';
import { assertIpRateLimit, windowStartDate } from '../common/rate-limit.util';
import { SubmitCameraDto } from './dto/submit-camera.dto';
import { ApproveCameraSubmissionDto } from './dto/approve-camera-submission.dto';

const CROWDSOURCE_PROVIDER_ADAPTER_KEY = 'crowdsource';

function getRateLimitMax(): number {
  const v = parseInt(process.env.CAMERA_SUBMISSION_RATE_LIMIT_MAX ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
}
function getRateLimitWindowHours(): number {
  const v = parseInt(process.env.CAMERA_SUBMISSION_RATE_LIMIT_WINDOW_HOURS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 24;
}

// Краудсорс "Додати камеру" — будь-хто (клієнт чи блогер, окремої ролі не потрібно) кидає
// посилання на публічну вебкамеру; потрапляє в чергу модерації (окрема вкладка в адмінці, як
// і просив запит), а не одразу в реєстр. При approve() створюється справжня Camera з
// confidence: ESTIMATED і дефолтною геометрією — точний сектор огляду адмін доводить окремо
// вже існуючим інструментом калібрування, не тут.
@Injectable()
export class CameraSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly grokAssist: GrokCameraAssistService,
  ) {}

  async submit(telegramId: string, dto: SubmitCameraDto, ipAddress: string | null) {
    await assertIpRateLimit(
      () =>
        this.prisma.cameraSubmission.count({
          where: { ipAddress, submittedAt: { gt: windowStartDate(getRateLimitWindowHours()) } },
        }),
      ipAddress,
      getRateLimitMax(),
      getRateLimitWindowHours(),
      `Занадто багато заявок з вашого IP (ліміт: ${getRateLimitMax()} за ${getRateLimitWindowHours()} год). Спробуйте пізніше.`,
    );

    const city = dto.cityId ? await this.prisma.city.findUnique({ where: { id: dto.cityId } }) : null;

    // AI (Grok) сознательно НЕ вызывается здесь автоматически — по прямому запросу пользователя
    // вся AI-обработка вынесена исключительно на этап ручного ревью админом (см.
    // suggestAiForSubmission() ниже, кнопка "Спросить AI" в /admin/camera-submissions).
    let lat: number | undefined;
    let lng: number | undefined;
    if (dto.address) {
      const geocoded = await this.geocoding.geocode(dto.address, city);
      lat = geocoded?.lat;
      lng = geocoded?.lng;
    }

    return this.prisma.cameraSubmission.create({
      data: {
        streamUrl: dto.streamUrl,
        suggestedName: dto.suggestedName,
        cityId: dto.cityId,
        address: dto.address,
        description: dto.description,
        lat,
        lng,
        submittedByTelegramId: telegramId,
        ipAddress,
      },
    });
  }

  async listMine(telegramId: string) {
    return this.prisma.cameraSubmission.findMany({
      where: { submittedByTelegramId: telegramId },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // --- Admin review ---

  async listForReview(status: 'PENDING' | 'ALL' = 'PENDING') {
    return this.prisma.cameraSubmission.findMany({
      where: status === 'ALL' ? undefined : { status },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getOne(id: string) {
    const submission = await this.prisma.cameraSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException(`Camera submission ${id} not found`);
    return submission;
  }

  // Nominatim (OpenStreetMap) — бесплатный, без API-ключа источник координат (см. запрос
  // пользователя), вызывается фронтендом автоматически при открытии карточки заявки.
  async suggestOsmForSubmission(id: string) {
    const submission = await this.getOne(id);
    const city = submission.cityId ? await this.prisma.city.findUnique({ where: { id: submission.cityId } }) : null;
    const query = submission.suggestedName ?? submission.streamUrl;

    const result = await this.geocoding.searchPlaceOSM(query, city);

    return {
      osmLat: result?.lat ?? null,
      osmLng: result?.lng ?? null,
      osmConfidence: result?.confidence ?? 0,
      osmDisplayName: result?.name ?? null,
    };
  }

  // AI-подсказка по запросу админа (кнопка "Спросить AI" в очереди модерации краудсорс-заявок)
  // — та же модель, что и в очереди ревью парсера (см. ScraperService.suggestAiForSourceRaw),
  // включая реальный поиск через Google Places (см. GeocodingService.searchPlace) в дополнение
  // к текстовой догадке Grok.
  async suggestAiForSubmission(id: string) {
    const submission = await this.getOne(id);
    const city = submission.cityId ? await this.prisma.city.findUnique({ where: { id: submission.cityId } }) : null;
    const query = submission.suggestedName ?? submission.streamUrl;

    const [aiSuggestion, placeResult] = await Promise.all([
      this.grokAssist.suggestAddressAndType(query, submission.address ?? submission.description, city?.name ?? null),
      this.geocoding.searchPlace(query, city),
    ]);

    return {
      ...aiSuggestion,
      placesLat: placeResult?.lat ?? null,
      placesLng: placeResult?.lng ?? null,
      placesConfidence: placeResult?.confidence ?? 0,
      placesName: placeResult?.name ?? null,
      placesFormattedAddress: placeResult?.formattedAddress ?? null,
    };
  }

  async approve(id: string, adminTelegramId: string, dto: ApproveCameraSubmissionDto) {
    const submission = await this.getOne(id);
    const providerId = await this.getOrCreateCrowdsourceProviderId();
    const isIndoor = dto.locationType === 'INDOOR';

    const camera = await this.prisma.camera.create({
      data: {
        name: dto.name,
        providerId,
        streamUrl: submission.streamUrl,
        streamType: dto.streamType,
        lat: dto.lat,
        lng: dto.lng,
        // Дефолти "поставили — потім відкалібрували" (див. коммент класу): дивиться на північ,
        // широкий кут огляду, помірна дальність — досить, щоб адмін одразу побачив камеру на
        // карті калібрування і підправив, а не заводив геометрію з нуля.
        azimuth: dto.azimuth ?? 0,
        fovAngle: dto.fovAngle ?? 90,
        rangeMeters: dto.rangeMeters ?? 300,
        confidence: 'ESTIMATED',
        status: 'UNKNOWN',
        cityId: dto.cityId ?? submission.cityId,
        locationType: isIndoor ? 'INDOOR' : 'OUTDOOR',
        notes: `Створено з краудсорс-заявки ${submission.id} (подав telegramId=${submission.submittedByTelegramId})`,
      },
    });

    // Камеры внутри помещений (см. doc/README.md) — сектор обзора не строится, см. тот же
    // комментарий в ScraperService.processItem().
    if (!isIndoor) {
      await syncCameraPolygon(this.prisma, camera);
    }

    await this.prisma.cameraSubmission.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByTelegramId: adminTelegramId, reviewedAt: new Date(), createdCameraId: camera.id },
    });

    return camera;
  }

  async reject(id: string, adminTelegramId: string, reason?: string) {
    await this.getOne(id); // 404, если такой заявки нет
    return this.prisma.cameraSubmission.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByTelegramId: adminTelegramId, reviewedAt: new Date(), rejectionReason: reason },
    });
  }

  // Ленивое создание провайдера-плейсхолдера для краудсорс-камер (см. класс-комментарий) —
  // не требует отдельного sql-сида, чтобы фича не сломалась, если его забыли прогнать.
  private async getOrCreateCrowdsourceProviderId(): Promise<string> {
    const existing = await this.prisma.cameraProvider.findUnique({ where: { adapterKey: CROWDSOURCE_PROVIDER_ADAPTER_KEY } });
    if (existing) return existing.id;

    const created = await this.prisma.cameraProvider.create({
      data: { name: 'Краудсорс (додано користувачами)', baseUrl: '', adapterKey: CROWDSOURCE_PROVIDER_ADAPTER_KEY },
    });
    return created.id;
  }
}

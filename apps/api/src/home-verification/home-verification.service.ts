import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../common/geocoding.service';
import { ReceiptVerificationService, getMinConfidence } from './receipt-verification.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { CamerasService } from '../cameras/cameras.service';
import { getAdminTelegramIds } from '../auth/dev-accounts.util';

// Не даём копить бесконечную очередь заявок на один аккаунт — пока есть незавершённая
// (PENDING/NEEDS_REVIEW), новую не принимаем. REJECTED/APPROVED можно переотправить в любой
// момент (переезд, отклонённая заявка после исправления фото и т.п.).
const BLOCKING_STATUSES = ['PENDING', 'NEEDS_REVIEW'];

function getRateLimitMax(): number {
  const v = parseInt(process.env.HOME_VERIFICATION_RATE_LIMIT_MAX ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}
function getRateLimitWindowHours(): number {
  const v = parseInt(process.env.HOME_VERIFICATION_RATE_LIMIT_WINDOW_HOURS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 24;
}

@Injectable()
export class HomeVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly receiptVerification: ReceiptVerificationService,
    private readonly receiptStorage: ReceiptStorageService,
    private readonly camerasService: CamerasService,
  ) {}

  // Синхронная проверка сразу после аплоада (см. класс-комментарий у enum HomeVerificationStatus
  // в schema.prisma про то, почему PENDING не должен подолгу висеть) — есть две внешние сетевые
  // зависимости (object storage, AI-провайдер), обе с щедрым, но конечным таймаутом внутри своих
  // сервисов. Для админов (см. ниже) ни одна из этих двух зависимостей вообще не вызывается.
  async submit(
    telegramId: string,
    claimedAddress: string,
    receiptBuffer: Buffer | null,
    receiptMimeType: string | null,
    ipAddress: string | null,
  ) {
    // Rate-limit по IP — проверяем ПЕРВЫМ, до дорогих операций (object storage upload, AI vision
    // call), чтобы спам-заявки не жгли ни хранилище, ни платный AI-запрос. Заявки без известного
    // IP (ipAddress === null — например, локальная разработка без прокси) не лимитируются: не
    // на чем считать, и это не боевой сценарий. Применяется и к админам тоже — дёшево, и админ
    // обычно не подаёт заявки настолько часто, чтобы упереться в лимит.
    if (ipAddress) {
      const windowStart = new Date(Date.now() - getRateLimitWindowHours() * 60 * 60 * 1000);
      const recentCount = await this.prisma.homeAddressVerification.count({
        where: { ipAddress, submittedAt: { gt: windowStart } },
      });
      if (recentCount >= getRateLimitMax()) {
        throw new HttpException(
          `Слишком много заявок с вашего IP (лимит: ${getRateLimitMax()} за ${getRateLimitWindowHours()} ч). Попробуйте позже.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const existing = await this.prisma.homeAddressVerification.findFirst({
      where: { telegramId, status: { in: BLOCKING_STATUSES as any } },
    });
    if (existing) {
      throw new BadRequestException(
        `У вас уже есть заявка на рассмотрении (статус: ${existing.status}). Дождитесь решения перед повторной отправкой.`,
      );
    }

    const geocoded = await this.geocoding.geocode(claimedAddress);

    // Админам квитанция не нужна — Telegram-аккаунт уже в ADMIN_TELEGRAM_IDS/DEV_MOCK_ACCOUNTS
    // (см. dev-accounts.util.ts), это само по себе достаточное подтверждение личности. Если
    // receiptBuffer всё же не передан НЕ-админом, это баг вызывающего кода (контроллер уже
    // требует файл для не-админов) — не полагаемся молча на инвариант, а падаем с понятной
    // ошибкой, а не NPE где-нибудь ниже по цепочке.
    if (!receiptBuffer) {
      if (!getAdminTelegramIds().includes(telegramId)) {
        throw new BadRequestException('Фото квитанции обязательно.');
      }

      const record = await this.prisma.homeAddressVerification.create({
        data: {
          telegramId,
          ipAddress,
          claimedAddress,
          lat: geocoded?.lat,
          lng: geocoded?.lng,
          receiptImageUrl: null,
          adminExempt: true,
          status: 'APPROVED',
          aiNotes: 'Квитанция не требуется — Telegram-аккаунт в списке администраторов.',
          reviewedAt: new Date(),
          reviewedByTelegramId: telegramId,
        },
      });

      const { receiptImageUrl: _omit, aiRawResponse: _omit2, ipAddress: _omit3, ...safe } = record;
      return safe;
    }

    const receiptUrl = await this.receiptStorage.store(receiptBuffer, receiptMimeType!, telegramId);
    const aiResult = await this.receiptVerification.verify(claimedAddress, receiptUrl);

    const record = await this.prisma.homeAddressVerification.create({
      data: {
        telegramId,
        ipAddress,
        claimedAddress,
        lat: geocoded?.lat,
        lng: geocoded?.lng,
        receiptImageUrl: receiptUrl,
        status: aiResult.autoApprove ? 'APPROVED' : 'NEEDS_REVIEW',
        extractedAddress: aiResult.extractedAddress,
        addressMatchConfidence: aiResult.addressMatchConfidence,
        handwrittenDateText: aiResult.handwrittenDateText,
        handwrittenDateIsRecent: aiResult.handwrittenDateIsRecent,
        looksGenuine: aiResult.looksGenuine,
        aiNotes: aiResult.notes,
        aiRawResponse: aiResult.rawResponse as any,
        reviewedAt: aiResult.autoApprove ? new Date() : undefined,
      },
    });

    // Не отдаём receiptImageUrl обратно клиенту в ответе на его же аплоад — он и так его
    // прислал, эхо лишь раздувает ответ; полноразмерное фото видит только админ на ручном ревью.
    const { receiptImageUrl: _omit, aiRawResponse: _omit2, ipAddress: _omit3, ...safe } = record;
    return safe;
  }

  async getStatusForUser(telegramId: string) {
    const latest = await this.prisma.homeAddressVerification.findFirst({
      where: { telegramId },
      orderBy: { submittedAt: 'desc' },
    });
    if (!latest) return { status: 'NONE' as const };

    const { receiptImageUrl: _omit, aiRawResponse: _omit2, ipAddress: _omit3, ...safe } = latest;
    return safe;
  }

  // "Мой дом": сектор камер вокруг ПОСЛЕДНЕГО одобренного адреса пользователя. Точка входа для
  // самого требования из главы — без APPROVED сюда не попасть.
  async getHomeSector(telegramId: string) {
    const approved = await this.prisma.homeAddressVerification.findFirst({
      where: { telegramId, status: 'APPROVED' },
      orderBy: { submittedAt: 'desc' },
    });

    if (!approved) {
      const latest = await this.prisma.homeAddressVerification.findFirst({
        where: { telegramId },
        orderBy: { submittedAt: 'desc' },
      });
      throw new ForbiddenException(
        latest
          ? `Адрес ещё не подтверждён (текущий статус: ${latest.status}). Просмотр сектора вокруг дома доступен только после подтверждения.`
          : 'Сначала подтвердите адрес проживания квитанцией об оплате жилья (POST /home/verify).',
      );
    }

    if (approved.lat == null || approved.lng == null) {
      throw new BadRequestException('Не удалось геокодировать подтверждённый адрес — обратитесь к администратору.');
    }

    return this.camerasService.findAtPoint({ lat: approved.lat, lng: approved.lng });
  }

  // --- Admin-side ---

  async listForReview(status: 'NEEDS_REVIEW' | 'ALL' = 'NEEDS_REVIEW') {
    return this.prisma.homeAddressVerification.findMany({
      where: status === 'ALL' ? undefined : { status },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // Включает receiptImageUrl — единственное место, где полноразмерное фото квитанции вообще
  // возвращается по API, и только под AdminGuard.
  async getForReview(id: string) {
    const record = await this.prisma.homeAddressVerification.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Verification ${id} not found`);
    return record;
  }

  async approve(id: string, adminTelegramId: string) {
    return this.prisma.homeAddressVerification.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedByTelegramId: adminTelegramId },
    });
  }

  async reject(id: string, adminTelegramId: string, reason?: string) {
    return this.prisma.homeAddressVerification.update({
      where: { id },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByTelegramId: adminTelegramId, rejectionReason: reason },
    });
  }

  // Калибровка порога уверенности (HOME_VERIFICATION_MIN_CONFIDENCE): распределение
  // addressMatchConfidence по итоговому решению админа, чтобы видно было, не отсекает ли текущий
  // порог заявки, которые люди потом одобряют вручную (порог завышен), или наоборот — не
  // пропускает ли он заявки, которые потом отклоняют (порог занижен).
  async getCalibrationStats() {
    const all = await this.prisma.homeAddressVerification.findMany({
      where: { addressMatchConfidence: { not: null } },
      select: { status: true, addressMatchConfidence: true },
    });

    const bucket = (min: number, max: number) =>
      all.filter((r: any) => r.addressMatchConfidence >= min && r.addressMatchConfidence < max);

    const summarize = (rows: any[]) => ({
      total: rows.length,
      approved: rows.filter((r) => r.status === 'APPROVED').length,
      rejected: rows.filter((r) => r.status === 'REJECTED').length,
      needsReview: rows.filter((r) => r.status === 'NEEDS_REVIEW').length,
    });

    return {
      currentMinConfidence: getMinConfidence(),
      buckets: {
        '0.0-0.5': summarize(bucket(0, 0.5)),
        '0.5-0.7': summarize(bucket(0.5, 0.7)),
        '0.7-0.9': summarize(bucket(0.7, 0.9)),
        '0.9-1.01': summarize(bucket(0.9, 1.01)),
      },
      totalWithConfidenceScore: all.length,
    };
  }
}

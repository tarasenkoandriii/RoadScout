import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { haversineDistance } from '../common/geometry.util';
import { CreateAlertDto } from './dto/create-alert.dto';

const DEFAULT_RADIUS_METERS = 1500;

function getIncidentLookbackMinutes(): number {
  // Насколько далеко в прошлое смотреть на новые инциденты при первом же тике после подписки
  // (lastNotifiedAt ещё null) — не заваливать пользователя всей историей area, только недавнее.
  const v = parseInt(process.env.ALERTS_INCIDENT_LOOKBACK_MINUTES ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

// Підписки-алерти: сповіщення в Telegram (той самий бот, що для логіна) при (1) зміні статусу
// конкретної камери (ONLINE<->OFFLINE і т.п.), (2) новому активному інциденту біля точки (див.
// RoadIncident з ситуаційної обізнаності). Перевірка умов — окремий cron-тик
// (checkAndNotify(), викликається POST /internal/alerts/check), НЕ live-тригер у момент самої
// події — простіше для MVP, ціна: затримка до наступного проходу крону (див.
// doc/README.md, "Известные упрощения").
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TelegramNotifierService,
  ) {}

  async subscribe(telegramId: string, dto: CreateAlertDto) {
    if (dto.type === 'CAMERA_STATUS') {
      if (!dto.cameraId) throw new BadRequestException('cameraId обязателен для типа CAMERA_STATUS.');
      const camera = await this.prisma.camera.findUnique({ where: { id: dto.cameraId } });
      if (!camera || camera.deletedAt) throw new NotFoundException(`Camera ${dto.cameraId} not found`);

      return this.prisma.alertSubscription.create({
        data: {
          telegramId,
          type: 'CAMERA_STATUS',
          cameraId: dto.cameraId,
          label: dto.label,
          lastCameraStatus: camera.status,
        },
      });
    }

    // AREA_INCIDENT
    if (dto.lat === undefined || dto.lng === undefined) {
      throw new BadRequestException('lat/lng обязательны для типа AREA_INCIDENT.');
    }

    return this.prisma.alertSubscription.create({
      data: {
        telegramId,
        type: 'AREA_INCIDENT',
        lat: dto.lat,
        lng: dto.lng,
        radiusMeters: dto.radiusMeters ?? DEFAULT_RADIUS_METERS,
        label: dto.label,
      },
    });
  }

  async listMine(telegramId: string) {
    return this.prisma.alertSubscription.findMany({
      where: { telegramId, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async unsubscribe(telegramId: string, id: string) {
    const sub = await this.prisma.alertSubscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    // Владелец подписки — единственный, кто может её удалить (кроме будущего admin-override,
    // которого пока нет — не требовалось для MVP).
    if (sub.telegramId !== telegramId) throw new ForbiddenException('Это не ваша подписка.');

    await this.prisma.alertSubscription.update({ where: { id }, data: { active: false } });
    return { id, unsubscribed: true };
  }

  // Вызывается периодически (см. AlertsController.check(), под тем же CronSecretGuard, что и
  // остальные internal-эндпоинты проекта). Возвращает сводку для лога/ответа крона, не бросает
  // исключение из-за одной неудавшейся подписки — остальные должны быть проверены всё равно.
  async checkAndNotify(): Promise<{ checked: number; notified: number }> {
    const subs = await this.prisma.alertSubscription.findMany({ where: { active: true } });
    let notified = 0;

    for (const sub of subs) {
      try {
        const didNotify = sub.type === 'CAMERA_STATUS' ? await this.checkCameraStatus(sub) : await this.checkAreaIncidents(sub);
        if (didNotify) notified++;
      } catch (err) {
        this.logger.warn(`Alert check failed for subscription ${sub.id}: ${(err as Error).message}`);
      }
    }

    return { checked: subs.length, notified };
  }

  private async checkCameraStatus(sub: { id: string; telegramId: string; cameraId: string | null; label: string; lastCameraStatus: string | null }): Promise<boolean> {
    if (!sub.cameraId) return false;

    const camera = await this.prisma.camera.findUnique({ where: { id: sub.cameraId } });
    // Soft delete (см. doc/AUDIT-camera-soft-delete.md) — камеру могли мягко удалить админ
    // (deletedAt заполнен, но запись физически ещё существует) — подписка так же просто
    // перестаёт срабатывать, не падает, как и в случае настоящего отсутствия записи.
    if (!camera || camera.deletedAt) return false;

    if (camera.status === sub.lastCameraStatus) return false;

    const text =
      `📷 <b>${escapeHtml(sub.label)}</b>\n` +
      `Статус изменился: ${escapeHtml(sub.lastCameraStatus ?? '—')} → ${escapeHtml(camera.status)}`;

    const sent = await this.notifier.send(sub.telegramId, text);
    await this.prisma.alertSubscription.update({
      where: { id: sub.id },
      data: { lastCameraStatus: camera.status, lastNotifiedAt: sent ? new Date() : undefined },
    });
    return sent;
  }

  private async checkAreaIncidents(sub: {
    id: string;
    telegramId: string;
    lat: number | null;
    lng: number | null;
    radiusMeters: number | null;
    label: string;
    lastNotifiedAt: Date | null;
  }): Promise<boolean> {
    if (sub.lat == null || sub.lng == null) return false;

    const since = sub.lastNotifiedAt ?? new Date(Date.now() - getIncidentLookbackMinutes() * 60 * 1000);
    const radius = sub.radiusMeters ?? DEFAULT_RADIUS_METERS;

    const candidates = await this.prisma.roadIncident.findMany({
      where: { status: 'ACTIVE', reportedAt: { gt: since } },
    });

    const nearby = candidates.filter((inc) => haversineDistance({ lat: sub.lat!, lng: sub.lng! }, { lat: inc.lat, lng: inc.lng }) <= radius);
    if (nearby.length === 0) return false;

    const lines = nearby.map((inc) => `• ${escapeHtml(inc.title)} (${escapeHtml(inc.type)})`).join('\n');
    const text = `⚠️ <b>${escapeHtml(sub.label)}</b>\nНовые происшествия рядом:\n${lines}`;

    const sent = await this.notifier.send(sub.telegramId, text);
    if (sent) {
      await this.prisma.alertSubscription.update({ where: { id: sub.id }, data: { lastNotifiedAt: new Date() } });
    }
    return sent;
  }
}

// Telegram sendMessage с parse_mode: 'HTML' интерпретирует <, >, & — экранируем то, что берём
// из пользовательских/парсерных данных (название камеры, заголовок инцидента), иначе сломанная
// разметка может привести к 400 от Bot API и вообще не доставить сообщение.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

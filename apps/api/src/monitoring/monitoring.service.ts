import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GrokCameraAssistService } from '../common/grok-camera-assist.service';

const CHECK_TIMEOUT_MS = 8000;

// Автоматична перевірка доступності контенту (див. запит користувача: "автоматично дизейблити
// такі камери, контролювати через ІІ, тільки НЕ на етапі парсингу — не вистачить часу у
// парсера, або у фоні парсера"). Свідомо реалізовано ТУТ, у вже існуючому, окремому від
// ScraperService циклі моніторингу (власний cron-розклад, вже розв'язаний з парсером) — не в
// самому парсері/автоімпорті. Той самий бюджет часу і принцип "зупинитись і продовжити
// наступного разу", що вже є в ScraperService (див. doc/TZ-parser-import-improvements.md, П3.2)
// — той самий ризик (serverless-таймаут при великій кількості камер), те саме рішення.
function getContentCheckTimeBudgetMs(): number {
  const v = parseInt(process.env.CONTENT_CHECK_TIME_BUDGET_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25000;
}
function getContentCheckDelayMs(): number {
  const v = parseInt(process.env.CONTENT_CHECK_DELAY_MS ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : 500;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly grokAssist: GrokCameraAssistService,
  ) {}

  // Окремий, повільніший прохід (не викликається checkAll()/швидким 5-15хв циклом) — YouTube
  // oEmbed + AI vision дорожчі й повільніші за просту перевірку досяжності вище, тому
  // розраховані на рідший розклад (наприклад, раз на добу, див. sql/pg_cron-schedule.sql).
  // Свідомо обмежені бюджетом часу (той самий принцип, що П3.2 у парсері) — якщо камер багато,
  // прохід акуратно зупиняється й логує, скільки лишилось необроблених, замість
  // необ'яснювального обриву serverless-функції.
  async checkContentAvailability() {
    const startedAt = Date.now();
    const budgetMs = getContentCheckTimeBudgetMs();

    // Тільки YOUTUBE_LIVE — саме там застосовний oEmbed/vision-контроль (див.
    // GrokCameraAssistService.checkStreamAvailability). DISABLED_SECURITY — ручний оверрайд
    // власника, автоматика його ніколи не чіпає (той самий принцип, що й у checkAll() вище).
    const cameras = await this.prisma.camera.findMany({
      where: { streamType: 'YOUTUBE_LIVE', status: { not: 'DISABLED_SECURITY' }, deletedAt: null },
    });

    let checked = 0;
    let disabled = 0;
    let truncated = false;

    for (let i = 0; i < cameras.length; i++) {
      if (Date.now() - startedAt > budgetMs) {
        truncated = true;
        this.logger.warn(
          `Проход проверки доступности остановлен по бюджету времени (${budgetMs}мс) — не обработано ещё ${cameras.length - i} из ${cameras.length} камер. Будут обработаны на следующем проходе.`,
        );
        break;
      }

      const camera = cameras[i];
      const result = await this.grokAssist.checkStreamAvailability(camera.streamUrl, camera.streamType);
      if (result.checked) checked++;

      if (result.checked && result.available === false) {
        await this.prisma.camera.update({
          where: { id: camera.id },
          data: { status: 'OFFLINE', lastCheckedAt: new Date() },
        });
        disabled++;
        this.logger.warn(`Камера ${camera.id} ("${camera.name}") помечена OFFLINE — контент недоступен (${result.checkedVia}): ${result.reason}`);
      }

      // Пауза между камерами — вежливость к YouTube oEmbed/img CDN, не бьём параллельно по
      // всем камерам разом (тот же принцип, что PARSER_DETAIL_FETCH_DELAY_MS у парсера).
      await sleep(getContentCheckDelayMs());
    }

    return { totalYoutubeCameras: cameras.length, checked, disabled, truncated };
  }

  async checkAll() {
    const cameras = await this.prisma.camera.findMany({
      where: { status: { not: 'DISABLED_SECURITY' }, deletedAt: null }, // manual security overrides are never auto-touched
    });

    // NOTE: checkOne() always catches its own errors internally and resolves with 'OFFLINE'
    // rather than rejecting — so Promise.allSettled would always report 0 rejections here.
    // Count outcomes by the returned status instead.
    const statuses = await Promise.all(cameras.map((camera) => this.checkOne(camera)));

    return {
      checked: statuses.length,
      online: statuses.filter((s) => s === 'ONLINE').length,
      delayed: statuses.filter((s) => s === 'DELAYED').length,
      offline: statuses.filter((s) => s === 'OFFLINE').length,
    };
  }

  async checkOne(camera: {
    id: string;
    streamUrl: string;
    streamType: string;
    lastSnapshotHash: string | null;
  }) {
    try {
      const status = await this.probe(camera);
      await this.prisma.camera.update({
        where: { id: camera.id },
        data: { status, lastCheckedAt: new Date() },
      });
      return status;
    } catch (err) {
      this.logger.warn(`Health check failed for camera ${camera.id}: ${(err as Error).message}`);
      await this.prisma.camera.update({
        where: { id: camera.id },
        data: { status: 'OFFLINE', lastCheckedAt: new Date() },
      });
      return 'OFFLINE';
    }
  }

  private async probe(camera: {
    id: string;
    streamUrl: string;
    streamType: string;
    lastSnapshotHash: string | null;
  }): Promise<'ONLINE' | 'DELAYED' | 'OFFLINE'> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    try {
      if (camera.streamType === 'MJPEG_SNAPSHOT') {
        // Snapshot-based cameras: if the frame hash hasn't changed since the last check,
        // it's likely a frozen/delayed feed rather than a live one.
        const res = await fetch(camera.streamUrl, { signal: controller.signal });
        if (!res.ok) return 'OFFLINE';

        const buf = Buffer.from(await res.arrayBuffer());
        const hash = createHash('sha1').update(buf).digest('hex');

        if (hash === camera.lastSnapshotHash) {
          return 'DELAYED';
        }

        await this.prisma.camera.update({ where: { id: camera.id }, data: { lastSnapshotHash: hash } });
        return 'ONLINE';
      }

      // IFRAME / HLS / YOUTUBE_LIVE: simple reachability check for MVP.
      // NOTE: doesn't verify the stream is actually playing, only that the source responds.
      const res = await fetch(camera.streamUrl, { method: 'HEAD', signal: controller.signal });
      return res.ok ? 'ONLINE' : 'OFFLINE';
    } finally {
      clearTimeout(timeout);
    }
  }
}

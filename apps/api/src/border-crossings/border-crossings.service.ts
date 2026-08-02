import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertIpRateLimit, windowStartDate } from '../common/rate-limit.util';

function getEstimateWindowHours(): number {
  const v = parseInt(process.env.BORDER_WAIT_ESTIMATE_WINDOW_HOURS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}
function getRateLimitMax(): number {
  const v = parseInt(process.env.BORDER_REPORT_RATE_LIMIT_MAX ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}
function getRateLimitWindowHours(): number {
  const v = parseInt(process.env.BORDER_REPORT_RATE_LIMIT_WINDOW_HOURS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

interface WaitSummary {
  averageMinutes: number | null;
  reportCount: number;
  lastReportedAt: Date | null;
}

// Час очікування на кордоні — краудсорс, не офіційні дані митниці/прикордонслужби (їх немає у
// відкритому API). Оцінка — просте усереднення звітів за останні кілька годин
// (BORDER_WAIT_ESTIMATE_WINDOW_HOURS, за замовчуванням 3) окремо по кожному напрямку. Свідомо
// без зважування "довіри" до конкретного заявника чи виявлення викидів — MVP.
@Injectable()
export class BorderCrossingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const crossings = await this.prisma.borderCrossing.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(
      crossings.map(async (c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        lat: c.lat,
        lng: c.lng,
        countryFrom: c.countryFrom,
        countryTo: c.countryTo,
        waitEstimate: await this.getWaitEstimate(c.id),
      })),
    );
  }

  async getWaitEstimate(crossingId: string): Promise<{ UA_OUT: WaitSummary; UA_IN: WaitSummary }> {
    const windowStart = windowStartDate(getEstimateWindowHours());
    const reports = await this.prisma.borderWaitReport.findMany({
      where: { crossingId, reportedAt: { gt: windowStart } },
      select: { direction: true, waitMinutes: true, reportedAt: true },
      orderBy: { reportedAt: 'desc' },
    });

    return {
      UA_OUT: this.summarize(reports.filter((r) => r.direction === 'UA_OUT')),
      UA_IN: this.summarize(reports.filter((r) => r.direction === 'UA_IN')),
    };
  }

  private summarize(reports: { waitMinutes: number; reportedAt: Date }[]): WaitSummary {
    if (reports.length === 0) {
      return { averageMinutes: null, reportCount: 0, lastReportedAt: null };
    }
    const average = Math.round(reports.reduce((sum, r) => sum + r.waitMinutes, 0) / reports.length);
    return { averageMinutes: average, reportCount: reports.length, lastReportedAt: reports[0].reportedAt };
  }

  async report(
    crossingId: string,
    direction: 'UA_OUT' | 'UA_IN',
    waitMinutes: number,
    telegramId: string,
    ipAddress: string | null,
  ) {
    await assertIpRateLimit(
      () =>
        this.prisma.borderWaitReport.count({
          where: { ipAddress, reportedAt: { gt: windowStartDate(getRateLimitWindowHours()) } },
        }),
      ipAddress,
      getRateLimitMax(),
      getRateLimitWindowHours(),
      `Занадто багато звітів з вашого IP (ліміт: ${getRateLimitMax()} за ${getRateLimitWindowHours()} год). Спробуйте пізніше.`,
    );

    const crossing = await this.prisma.borderCrossing.findUnique({ where: { id: crossingId } });
    if (!crossing) throw new NotFoundException(`Border crossing ${crossingId} not found`);

    if (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 24 * 60) {
      throw new BadRequestException('Некоректний час очікування (0–1440 хвилин).');
    }

    return this.prisma.borderWaitReport.create({
      data: { crossingId, direction, waitMinutes, reportedByTelegramId: telegramId, ipAddress },
    });
  }
}

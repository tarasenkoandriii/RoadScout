import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ImportLogLevel = 'INFO' | 'WARN' | 'ERROR';
export type ImportLogStage =
  | 'FETCH_PAGE'
  | 'PARSE_ITEM'
  | 'AI_ASSIST'
  | 'GEOCODE'
  | 'AZIMUTH_HEURISTIC'
  | 'CAMERA_CREATED'
  | 'NEEDS_REVIEW'
  | 'SKIPPED_ALREADY_RESOLVED'
  | 'ERROR';

export interface ImportLogEntryInput {
  runId: string;
  providerId: string;
  level: ImportLogLevel;
  stage: ImportLogStage;
  message: string;
  externalId?: string;
  cameraSourceRawId?: string;
  metadata?: Record<string, unknown>;
}

function getRetentionDays(): number {
  const v = parseInt(process.env.IMPORT_LOG_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

// Детальный пошаговый журнал импорта (см. doc/TZ-parser-import-improvements.md, П1.2) —
// дополняет агрегированную сводку ParserRunLog записями "что случилось с конкретным элементом
// на конкретном шаге". Намеренно НЕ бросает исключения при сбое самой записи лога (лог не
// должен ронить реальный импорт) — только предупреждает в серверных логах.
@Injectable()
export class ImportLogService {
  private readonly logger = new Logger(ImportLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: ImportLogEntryInput): Promise<void> {
    try {
      await this.prisma.importLogEntry.create({
        data: {
          runId: entry.runId,
          providerId: entry.providerId,
          level: entry.level,
          stage: entry.stage,
          message: entry.message,
          externalId: entry.externalId,
          cameraSourceRawId: entry.cameraSourceRawId,
          metadata: entry.metadata as any,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write import log entry (stage=${entry.stage}): ${(err as Error).message}`);
    }
  }

  async list(filters: {
    runId?: string;
    providerId?: string;
    level?: ImportLogLevel;
    stage?: ImportLogStage;
    externalId?: string;
    take?: number;
    skip?: number;
  }) {
    return this.prisma.importLogEntry.findMany({
      where: {
        runId: filters.runId,
        providerId: filters.providerId,
        level: filters.level,
        stage: filters.stage,
        externalId: filters.externalId,
      },
      include: { provider: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
      take: filters.take ?? 100,
      skip: filters.skip ?? 0,
    });
  }

  // Вызывается в начале каждого прохода (см. ScraperService.runForProvider) — простая политика
  // удержания без отдельного cron-задания: "заодно, раз уж всё равно идёт очередной проход".
  // IMPORT_LOG_RETENTION_DAYS — см. .env.example.
  async cleanupOld(): Promise<void> {
    const cutoff = new Date(Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.importLogEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
    } catch (err) {
      this.logger.warn(`Import log cleanup failed: ${(err as Error).message}`);
    }
  }
}

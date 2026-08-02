import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { CronSecretGuard } from '../scraper/guards/cron-secret.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller()
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly prisma: PrismaService,
  ) {}

  // Triggered by Supabase pg_cron every 5-15 minutes (see sql/pg_cron-schedule.sql)
  @UseGuards(CronSecretGuard)
  @Post('internal/monitoring/run')
  runFromCron() {
    return this.monitoringService.checkAll();
  }

  // Перевірка доступності контенту (див. запит користувача) — окремий, повільніший розклад
  // (наприклад, раз на добу, не 5-15хв), окремий від і парсера, і швидкого checkAll() вище —
  // див. MonitoringService.checkContentAvailability().
  @UseGuards(CronSecretGuard)
  @Post('internal/monitoring/check-content-availability')
  checkContentAvailabilityFromCron() {
    return this.monitoringService.checkContentAvailability();
  }

  @UseGuards(AdminGuard)
  @Post('admin/monitoring/check-content-availability')
  checkContentAvailabilityManually() {
    return this.monitoringService.checkContentAvailability();
  }

  // "Force recheck" — manual buttons in the admin dashboard (5.3)
  @UseGuards(AdminGuard)
  @Post('admin/monitoring/run')
  runManually() {
    return this.monitoringService.checkAll();
  }

  @UseGuards(AdminGuard)
  @Post('admin/monitoring/run/:cameraId')
  async runForCamera(@Param('cameraId') cameraId: string) {
    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    const status = await this.monitoringService.checkOne(camera);
    return { cameraId, status };
  }

  // Status dashboard: counts by status + full camera list
  @UseGuards(AdminGuard)
  @Get('admin/monitoring/dashboard')
  async dashboard() {
    const cameras = await this.prisma.camera.findMany({
      where: { deletedAt: null },
      orderBy: { lastCheckedAt: 'desc' },
      include: { provider: { select: { name: true } } },
    });

    const counts = cameras.reduce<Record<string, number>>((acc, cam) => {
      acc[cam.status] = (acc[cam.status] ?? 0) + 1;
      return acc;
    }, {});

    return { counts, cameras };
  }
}

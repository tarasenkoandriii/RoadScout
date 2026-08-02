import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LiveGpsSecretGuard } from './live-gps-secret.guard';
import { LivePositionDto } from './dto/live-position.dto';
import { FixedRoutePositionService } from './fixed-route-position.service';

// Глава 16–17 ТЗ, LIVE_GPS: ingestion endpoint for a carrier's own GPS feed. Whatever pulls
// the carrier's data (a small poller job, or the carrier's own webhook) pushes fixes here.
@Controller('internal/fixed-route')
export class FixedRouteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly positionService: FixedRoutePositionService,
  ) {}

  @UseGuards(LiveGpsSecretGuard)
  @Post(':cameraId/live-position')
  async pushLivePosition(@Param('cameraId') cameraId: string, @Body() dto: LivePositionDto) {
    await this.prisma.camera.update({
      where: { id: cameraId },
      data: {
        liveGpsLat: dto.lat,
        liveGpsLng: dto.lng,
        liveGpsSpeed: dto.speedMps ?? null,
        liveGpsUpdatedAt: new Date(),
      },
    });

    // Don't make the caller wait out the (1s) cache TTL for their own push to take effect.
    this.positionService.invalidate(cameraId);

    return { cameraId, updated: true };
  }
}

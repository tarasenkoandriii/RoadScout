import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { LookAheadService } from './lookahead.service';
import { PredictMeetingsDto } from './dto/predict-meetings.dto';
import { toFixedRouteCamera } from '../route-position/camera-route.mapper';

// Глава 17 ТЗ, "прогноз встречи" against a full user route — the single-point shortcut used
// by /search and /cameras/at-point lives inside CamerasService instead, since it needs the
// full sector-test/occlusion pipeline around it.
@Controller('lookahead')
export class LookAheadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookAhead: LookAheadService,
  ) {}

  @UseGuards(TelegramAuthGuard)
  @Post()
  async predict(@Body() dto: PredictMeetingsDto) {
    const cameras = await this.prisma.camera.findMany({
      where: {
        mobilityType: 'FIXED_ROUTE',
        deletedAt: null,
        ...(dto.cameraIds?.length ? { id: { in: dto.cameraIds } } : {}),
      },
    });

    const fixedRouteCameras = cameras.map((c) => toFixedRouteCamera(c as any));
    const points = dto.points.map((p) => ({ lat: p.lat, lng: p.lng, timestampOffsetSeconds: p.timestampOffsetSeconds }));

    const encounters = this.lookAhead.predictRouteMeetings(points, fixedRouteCameras);

    const byId = new Map(cameras.map((c) => [c.id, c]));
    return {
      encounters: encounters.map((e) => {
        const camera = byId.get(e.cameraId)!;
        return {
          cameraId: e.cameraId,
          name: camera.name,
          streamUrl: camera.streamUrl,
          streamType: camera.streamType,
          etaSeconds: e.etaSeconds,
          distanceMeters: e.distanceMeters,
          confidence: e.confidence,
          cameraLat: e.cameraPosition.lat,
          cameraLng: e.cameraPosition.lng,
          cameraAzimuth: e.cameraPosition.azimuth,
          cameraSpeed: e.cameraPosition.speedMps,
        };
      }),
    };
  }
}

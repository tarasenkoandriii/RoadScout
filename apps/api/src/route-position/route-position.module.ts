import { Module } from '@nestjs/common';
import { LoopRoutePositionProvider } from './providers/loop-route-position.provider';
import { TimetableRoutePositionProvider } from './providers/timetable-route-position.provider';
import { LiveGpsRoutePositionProvider } from './providers/live-gps-route-position.provider';
import { FixedRoutePositionService } from './fixed-route-position.service';
import { FixedRouteController } from './fixed-route.controller';
import { PrismaModule } from '../prisma/prisma.module';

// Глава 16–18 ТЗ: RoutePositionProvider (Loop/Timetable/LiveGps) -> FixedRoutePositionService
// -> DynamicFovBuilder -> cameraSeesPoint() -> SearchService/LookAheadService.
@Module({
  imports: [PrismaModule],
  controllers: [FixedRouteController],
  providers: [
    LoopRoutePositionProvider,
    TimetableRoutePositionProvider,
    LiveGpsRoutePositionProvider,
    FixedRoutePositionService,
  ],
  exports: [FixedRoutePositionService],
})
export class RoutePositionModule {}

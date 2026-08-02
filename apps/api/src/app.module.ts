import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { ScraperModule } from './scraper/scraper.module';
import { CamerasModule } from './cameras/cameras.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { AggregatorDiscoveryModule } from './aggregator-discovery/aggregator-discovery.module';
import { OcclusionModule } from './occlusion/occlusion.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { RoutePositionModule } from './route-position/route-position.module';
import { LookAheadModule } from './lookahead/lookahead.module';
import { SituationalModule } from './situational/situational.module';
import { HomeVerificationModule } from './home-verification/home-verification.module';
import { CitiesModule } from './cities/cities.module';
import { BorderCrossingsModule } from './border-crossings/border-crossings.module';
import { AlertsModule } from './alerts/alerts.module';
import { ShareModule } from './share/share.module';
import { CameraSubmissionsModule } from './camera-submissions/camera-submissions.module';
import { BtwModule } from './btw/btw.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    ScraperModule,
    CamerasModule,
    MonitoringModule,
    AggregatorDiscoveryModule,
    OcclusionModule,
    ProvidersModule,
    RoutePositionModule,
    LookAheadModule,
    SituationalModule,
    HomeVerificationModule,
    CitiesModule,
    BorderCrossingsModule,
    AlertsModule,
    ShareModule,
    CameraSubmissionsModule,
    BtwModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OcclusionModule } from '../occlusion/occlusion.module';
import { RoutePositionModule } from '../route-position/route-position.module';
import { LookAheadModule } from '../lookahead/lookahead.module';
import { CitiesModule } from '../cities/cities.module';

@Module({
  imports: [PrismaModule, OcclusionModule, RoutePositionModule, LookAheadModule, CitiesModule],
  controllers: [CamerasController],
  providers: [CamerasService],
  exports: [CamerasService],
})
export class CamerasModule {}

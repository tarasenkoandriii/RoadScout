import { Module } from '@nestjs/common';
import { OcclusionService } from './occlusion.service';

@Module({
  providers: [OcclusionService],
  exports: [OcclusionService],
})
export class OcclusionModule {}

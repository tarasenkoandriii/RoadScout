import { Module } from '@nestjs/common';
import { CameraSubmissionsController } from './camera-submissions.controller';
import { CameraSubmissionsService } from './camera-submissions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CameraSubmissionsController],
  providers: [CameraSubmissionsService],
})
export class CameraSubmissionsModule {}

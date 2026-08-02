import { Module } from '@nestjs/common';
import { HomeVerificationController } from './home-verification.controller';
import { HomeVerificationService } from './home-verification.service';
import { ReceiptVerificationService } from './receipt-verification.service';
import { ReceiptStorageService } from './receipt-storage.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CamerasModule } from '../cameras/cameras.module';

@Module({
  imports: [PrismaModule, CamerasModule],
  controllers: [HomeVerificationController],
  providers: [HomeVerificationService, ReceiptVerificationService, ReceiptStorageService],
})
export class HomeVerificationModule {}

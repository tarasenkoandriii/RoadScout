import { Module } from '@nestjs/common';
import { BorderCrossingsController } from './border-crossings.controller';
import { BorderCrossingsService } from './border-crossings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BorderCrossingsController],
  providers: [BorderCrossingsService],
})
export class BorderCrossingsModule {}

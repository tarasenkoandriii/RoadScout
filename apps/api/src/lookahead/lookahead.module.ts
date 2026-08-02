import { Module } from '@nestjs/common';
import { LookAheadService } from './lookahead.service';
import { LookAheadController } from './lookahead.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RoutePositionModule } from '../route-position/route-position.module';

@Module({
  imports: [PrismaModule, AuthModule, RoutePositionModule],
  controllers: [LookAheadController],
  providers: [LookAheadService],
  exports: [LookAheadService],
})
export class LookAheadModule {}

import { Module } from '@nestjs/common';
import { BtwController } from './btw.controller';
import { BtwService } from './btw.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OcclusionModule } from '../occlusion/occlusion.module';

// Beyond the Wall (BTW) — doc/BTW-tz.md / doc/AUDIT-btw.md. AuthModule не потрібен в
// imports — TelegramAuthGuard використовується напряму (JwtService походить із глобального
// AuthModule/JwtModule, той самий шаблон, що в інших контролерах проєкту).
@Module({
  imports: [PrismaModule, OcclusionModule],
  controllers: [BtwController],
  providers: [BtwService],
})
export class BtwModule {}

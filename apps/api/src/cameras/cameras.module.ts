import { Module } from '@nestjs/common';
import { CamerasService } from './cameras.service';
import { CamerasController } from './cameras.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OcclusionModule } from '../occlusion/occlusion.module';
import { RoutePositionModule } from '../route-position/route-position.module';
import { LookAheadModule } from '../lookahead/lookahead.module';
import { CitiesModule } from '../cities/cities.module';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

// RegistryProxyService зареєстровано тут ЯК ОКРЕМИЙ провайдер (не через імпорт ScraperModule)
// — той самий патерн, що вже в BtwModule (див. коментар там): за запитом користувача
// ("та же проблема с показом видео в админке") адмінському GET /admin/cameras/image-proxy
// (CamerasService.fetchStreamImageProxy()) теж потрібен той самий VPN/проксі, яким BTW уже
// ходить за кадрами гео-заблокованих камер (наприклад NYC DOT). Сам клас — stateless обгортка
// без btw/cameras-специфічного стану, тож окремий екземпляр тут безпечний.
@Module({
  imports: [PrismaModule, OcclusionModule, RoutePositionModule, LookAheadModule, CitiesModule],
  controllers: [CamerasController],
  providers: [CamerasService, RegistryProxyService],
  exports: [CamerasService],
})
export class CamerasModule {}

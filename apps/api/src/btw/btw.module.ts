import { Module } from '@nestjs/common';
import { BtwController } from './btw.controller';
import { BtwService } from './btw.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OcclusionModule } from '../occlusion/occlusion.module';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

// Beyond the Wall (BTW) — doc/BTW-tz.md / doc/AUDIT-btw.md. AuthModule не потрібен в
// imports — TelegramAuthGuard використовується напряму (JwtService походить із глобального
// AuthModule/JwtModule, той самий шаблон, що в інших контролерах проєкту).
//
// RegistryProxyService зареєстровано тут ЯК ОКРЕМИЙ провайдер (не через імпорт ScraperModule)
// — за прямим запитом користувача, щоб /btw/thumb-image міг ходити через той самий VPN/проксі,
// що вже використовує scraper для реєстрів камер. ScraperModule не експортує цей сервіс, а сам
// клас — stateless обгортка без залежностей від чогось btw-специфічного, тож окремий екземпляр
// тут повністю безпечний (не про спільний стан, лише про той самий env-конфіг проксі).
@Module({
  imports: [PrismaModule, OcclusionModule],
  controllers: [BtwController],
  providers: [BtwService, RegistryProxyService],
})
export class BtwModule {}

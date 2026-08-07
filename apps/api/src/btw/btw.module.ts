import { Module } from '@nestjs/common';
import { BtwController } from './btw.controller';
import { BtwService } from './btw.service';
import { BtwRouteForecastService } from './btw-route-forecast.service';
// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 (публічний IP-віджет для нового
// лендингу apps/interactive).
import { BtwLandingSnapshotService } from './btw-landing-snapshot.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OcclusionModule } from '../occlusion/occlusion.module';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';
import { OpenRouteServiceClient } from '../routing/openrouteservice.service';
import { SituationalModule } from '../situational/situational.module';
import { LookAheadModule } from '../lookahead/lookahead.module';

// Beyond the Wall (BTW) — doc/BTW-tz.md / doc/AUDIT-btw.md. AuthModule не потрібен в
// imports — TelegramAuthGuard використовується напряму (JwtService походить із глобального
// AuthModule/JwtModule, той самий шаблон, що в інших контролерах проєкту).
//
// RegistryProxyService зареєстровано тут ЯК ОКРЕМИЙ провайдер (не через імпорт ScraperModule)
// — за прямим запитом користувача, щоб /btw/thumb-image міг ходити через той самий VPN/проксі,
// що вже використовує scraper для реєстрів камер. ScraperModule не експортує цей сервіс, а сам
// клас — stateless обгортка без залежностей від чогось btw-специфічного, тож окремий екземпляр
// тут повністю безпечний (не про спільний стан, лише про той самий env-конфіг проксі).
// OpenRouteServiceClient зареєстровано тут ЗА ТИМ САМИМ ПРИНЦИПОМ, що вже RegistryProxyService
// вище — за прямим запитом користувача ("маршрутизация не вызывается — ключа OpenRouteService
// пока нет (§6.3) исправь", doc/TZ-btw-route-planning.md §6.3): окремий stateless-провайдер тут,
// не через окремий RoutingModule/export — той самий рівень оверхеду, що вже прийнятий для
// RegistryProxyService в цьому ж модулі.
// ДОДАНО — за прямим запитом користувача "полностью реализовать п 1 и п 2 по тз"
// (doc/TZ-btw-route-planning.md §8, Этапы 1-2): `SituationalModule`/`LookAheadModule`
// імпортовано (не продубльовано провайдерами напряму, як RegistryProxyService/
// OpenRouteServiceClient вище) — обидва вже мають власні `imports`/залежності (CitiesModule,
// RoutePositionModule, AuthModule), дублювати їх тут значно більше оверхеду, ніж просто
// імпортувати готові модулі й покластись на їх `exports`.
@Module({
  imports: [PrismaModule, OcclusionModule, SituationalModule, LookAheadModule],
  controllers: [BtwController],
  providers: [BtwService, RegistryProxyService, OpenRouteServiceClient, BtwRouteForecastService, BtwLandingSnapshotService],
})
export class BtwModule {}

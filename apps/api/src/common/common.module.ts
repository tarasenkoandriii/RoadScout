import { Global, Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { GrokCameraAssistService } from './grok-camera-assist.service';
import { AzimuthHeuristicService } from '../scraper/azimuth-heuristic.service';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

// AzimuthHeuristicService перенесено сюди (з ScraperModule) — за прямим запитом користувача
// ("сделай что-то прорывное"): GrokCameraAssistService тепер теж потребує доступу до неї (щоб
// давати AI реальний напрямок дороги з карти як орієнтир для vision-калібрування, а не лише
// евристичний fallback без AI, як було раніше). CommonModule уже @Global() — жодних змін у
// ScraperModule/ScraperService не потрібно, AzimuthHeuristicService і далі доступна там так
// само через звичайну DI-ін'єкцію в конструктор.
//
// RegistryProxyService ДОДАНО тут (за прямим запитом користувача — розбір випадку з
// "Азимут: —" в AI-автокалібруванні камери): AzimuthHeuristicService тепер отримує його через
// конструктор (§ детальний коментар у azimuth-heuristic.service.ts) для тієї самої гонки по
// Overpass-дзеркалах + VPN-групи, що вже надійно працює в генерації тайлів. Зареєстровано ЯК
// ОКРЕМИЙ провайдер — той самий принцип, що вже ScraperModule/BtwModule/CamerasModule
// застосовують для цього самого класу (клас без власних DI-залежностей у конструкторі, тож
// безпечно мати кілька незалежних Nest-екземплярів у різних модулях замість спільного).
@Global()
@Module({
  providers: [GeocodingService, GrokCameraAssistService, AzimuthHeuristicService, RegistryProxyService],
  exports: [GeocodingService, GrokCameraAssistService, AzimuthHeuristicService],
})
export class CommonModule {}

import { Global, Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { GrokCameraAssistService } from './grok-camera-assist.service';
import { AzimuthHeuristicService } from '../scraper/azimuth-heuristic.service';

// AzimuthHeuristicService перенесено сюди (з ScraperModule) — за прямим запитом користувача
// ("сделай что-то прорывное"): GrokCameraAssistService тепер теж потребує доступу до неї (щоб
// давати AI реальний напрямок дороги з карти як орієнтир для vision-калібрування, а не лише
// евристичний fallback без AI, як було раніше). CommonModule уже @Global() — жодних змін у
// ScraperModule/ScraperService не потрібно, AzimuthHeuristicService і далі доступна там так
// само через звичайну DI-ін'єкцію в конструктор.
@Global()
@Module({
  providers: [GeocodingService, GrokCameraAssistService, AzimuthHeuristicService],
  exports: [GeocodingService, GrokCameraAssistService, AzimuthHeuristicService],
})
export class CommonModule {}

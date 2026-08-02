import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { RegistryProxyService } from './proxy/registry-proxy.service';
import { ImportLogService } from './import-log.service';
import { PrismaModule } from '../prisma/prisma.module';

// ВАЖЛИВО: AzimuthHeuristicService перенесено в CommonModule (@Global()) — див.
// common.module.ts. Тут її НЕ оголошуємо як провайдер повторно (NestJS видасть помилку
// "provider registered in multiple modules" інакше) — ScraperService і далі отримує її
// звичайною DI-ін'єкцією в конструктор, без жодних змін у самому ScraperService.
@Module({
  imports: [PrismaModule],
  controllers: [ScraperController],
  providers: [ScraperService, RegistryProxyService, ImportLogService],
})
export class ScraperModule {}

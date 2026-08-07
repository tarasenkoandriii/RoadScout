import { Module } from '@nestjs/common';
import { SituationalController } from './situational.controller';
import { WeatherService } from './weather.service';
import { RoadIncidentsService } from './incidents.service';
// За прямим запитом користувача — "пишем парсер 511ny.org ... в рамках пункта 2 тз"
// (doc/TZ-btw-route-planning.md §7.2/§8) — той самий модуль, той самий AdminGuard, що вже
// weather/incidents, просто ще один провайдер живих зовнішніх даних.
import { FiveElevenNyService } from './five11ny.service';
// За прямим запитом користувача — "реализовать TomTom Traffic API — fallback/дополнение вне
// NY State" (doc/TZ-btw-route-planning.md §7.2/§9 п.5).
import { TomTomTrafficService } from './tomtom.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CitiesModule } from '../cities/cities.module';

@Module({
  imports: [PrismaModule, CitiesModule],
  controllers: [SituationalController],
  providers: [WeatherService, RoadIncidentsService, FiveElevenNyService, TomTomTrafficService],
  // ДОДАНО — за прямим запитом користувача "полностью реализовать п 1 и п 2 по тз"
  // (doc/TZ-btw-route-planning.md §7.1/§7.2, Этап 2): `BtwRouteForecastService`
  // (apps/api/src/btw/btw-route-forecast.service.ts) накладає погоду/інциденти/трафік на
  // побудований маршрут — потребує ін'єкції цих сервісів у `BtwModule`, раніше не було
  // потреби експортувати їх за межі цього модуля.
  exports: [WeatherService, RoadIncidentsService, FiveElevenNyService, TomTomTrafficService],
})
export class SituationalModule {}

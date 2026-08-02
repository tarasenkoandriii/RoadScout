import { Module } from '@nestjs/common';
import { SituationalController } from './situational.controller';
import { WeatherService } from './weather.service';
import { RoadIncidentsService } from './incidents.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CitiesModule } from '../cities/cities.module';

@Module({
  imports: [PrismaModule, CitiesModule],
  controllers: [SituationalController],
  providers: [WeatherService, RoadIncidentsService],
})
export class SituationalModule {}

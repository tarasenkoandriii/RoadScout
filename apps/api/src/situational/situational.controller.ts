import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { WeatherService } from './weather.service';
import { RoadIncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';

// Карта-вкладка "Ситуационная осведомленность" в админке: сводка погоды (дождь/туман/гололёд
// и т.п.) по городу и области + ДТП/внештатные ситуации на дорогах (пока — только ручной ввод
// админом, см. doc/AUDIT-situational-awareness.md про внешние источники на будущее).
// Всё под AdminGuard — это внутренний рабочий инструмент, не публичная страница.
@Controller('admin/situational')
@UseGuards(AdminGuard)
export class SituationalController {
  constructor(
    private readonly weather: WeatherService,
    private readonly incidents: RoadIncidentsService,
  ) {}

  @Get('weather')
  getWeather() {
    return this.weather.getSnapshot();
  }

  @Get('incidents')
  getIncidents(@Query('status') status?: string) {
    return status === 'all' ? this.incidents.listAll() : this.incidents.listActive();
  }

  // Один запрос для карты: погода + активные инциденты вместе, чтобы фронту не делать два
  // отдельных round-trip'а при каждом открытии вкладки.
  @Get('overview')
  async getOverview() {
    const [weather, incidents] = await Promise.all([this.weather.getSnapshot(), this.incidents.listActive()]);
    return { weather, incidents };
  }

  @Post('incidents')
  createIncident(@Body() dto: CreateIncidentDto, @Req() req: Request) {
    return this.incidents.create(dto, (req as any).telegramId);
  }

  @Patch('incidents/:id')
  updateIncident(@Param('id') id: string, @Body() dto: UpdateIncidentDto) {
    return this.incidents.update(id, dto);
  }

  @Post('incidents/:id/resolve')
  resolveIncident(@Param('id') id: string) {
    return this.incidents.resolve(id);
  }

  @Delete('incidents/:id')
  removeIncident(@Param('id') id: string) {
    return this.incidents.remove(id);
  }
}

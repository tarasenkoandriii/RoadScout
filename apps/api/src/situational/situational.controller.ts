import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { WeatherService } from './weather.service';
import { RoadIncidentsService } from './incidents.service';
// За прямим запитом користувача — "впиши 511NY как основной источник трафика для NYC" +
// "пишем парсер 511ny.org ... показываем инциденты" (doc/TZ-btw-route-planning.md §7.2/§8).
import { FiveElevenNyService } from './five11ny.service';
// За прямим запитом користувача — "реализовать TomTom Traffic API — fallback/дополнение вне
// NY State" (doc/TZ-btw-route-planning.md §7.2/§9 п.5).
import { TomTomTrafficService, centerRadiusToBoundingBox } from './tomtom.service';
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
    private readonly fiveElevenNy: FiveElevenNyService,
    private readonly tomTom: TomTomTrafficService,
  ) {}

  @Get('weather')
  getWeather() {
    return this.weather.getSnapshot();
  }

  @Get('incidents')
  getIncidents(@Query('status') status?: string) {
    return status === 'all' ? this.incidents.listAll() : this.incidents.listActive();
  }

  // Живий фід 511NY (§7.2/§8 ТЗ) — окремо від ручних /incidents вище: `configured: false`
  // дозволяє фронту чесно показати "ключ 511NY не налаштований" замість того, щоб мовчки
  // показувати порожню карту й лишати адміна гадати, чи це "немає подій" чи "щось зламалось".
  @Get('511ny')
  async getFiveElevenNy() {
    const events = await this.fiveElevenNy.getEvents();
    return { configured: this.fiveElevenNy.isConfigured(), events };
  }

  // TomTom — fallback/дополнение ВНЕ NY State (§7.2 ТЗ): в отличие от 511NY (один фид на весь
  // штат без параметров), TomTom требует конкретную географическую точку — сюда её передаёт
  // фронт (TomTomFallbackPanel.tsx, поле координат/радиуса), это НЕ фиксированный регион, как
  // 511NY, поэтому не входит в /overview ниже, а вызывается по требованию.
  @Get('tomtom')
  async getTomTom(@Query('lat') latRaw: string, @Query('lng') lngRaw: string, @Query('radiusKm') radiusKmRaw?: string) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const radiusKm = radiusKmRaw ? Number(radiusKmRaw) : 15;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
      throw new BadRequestException('lat/lng/radiusKm must be valid numbers');
    }

    const bbox = centerRadiusToBoundingBox(lat, lng, radiusKm);
    const incidents = await this.tomTom.getIncidents(bbox);
    return { configured: this.tomTom.isConfigured(), incidents };
  }

  // Один запрос для карты: погода + активные инциденты + 511NY вместе, чтобы фронту не делать
  // отдельные round-trip'ы при каждом открытии вкладки. TomTom сюда НЕ входит — см. /tomtom
  // выше, требует координаты, у которых нет единого дефолта для "всего обзора".
  @Get('overview')
  async getOverview() {
    const [weather, incidents, fiveElevenNyEvents] = await Promise.all([
      this.weather.getSnapshot(),
      this.incidents.listActive(),
      this.fiveElevenNy.getEvents(),
    ]);
    return {
      weather,
      incidents,
      fiveElevenNy: { configured: this.fiveElevenNy.isConfigured(), events: fiveElevenNyEvents },
    };
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

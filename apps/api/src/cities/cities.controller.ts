import { Controller, Get, UseGuards } from '@nestjs/common';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { CitiesService } from './cities.service';

@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  // Список городов для выпадающего списка на публичном поиске — тот же уровень доступа, что
  // и /search (любой залогиненный через Telegram), не публикуется вообще без авторизации.
  @UseGuards(TelegramAuthGuard)
  @Get()
  list() {
    return this.cities.list();
  }
}

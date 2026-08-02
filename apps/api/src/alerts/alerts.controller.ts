import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { CronSecretGuard } from '../scraper/guards/cron-secret.guard';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Controller()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @UseGuards(TelegramAuthGuard)
  @Post('alerts')
  subscribe(@Body() dto: CreateAlertDto, @Req() req: Request) {
    return this.alerts.subscribe((req as any).telegramId, dto);
  }

  @UseGuards(TelegramAuthGuard)
  @Get('alerts')
  listMine(@Req() req: Request) {
    return this.alerts.listMine((req as any).telegramId);
  }

  @UseGuards(TelegramAuthGuard)
  @Delete('alerts/:id')
  unsubscribe(@Param('id') id: string, @Req() req: Request) {
    return this.alerts.unsubscribe((req as any).telegramId, id);
  }

  // Дёргается по расписанию (Supabase pg_cron -> pg_net http_post, см. sql/pg_cron-schedule.sql
  // и тот же CronSecretGuard, что уже используется для парсера/мониторинга).
  @UseGuards(CronSecretGuard)
  @Post('internal/alerts/check')
  check() {
    return this.alerts.checkAndNotify();
  }
}

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { BorderCrossingsService } from './border-crossings.service';
import { ReportWaitDto } from './dto/report-wait.dto';
import { getClientIp } from '../common/client-ip.util';

// Час очікування на кордоні (краудсорс) — доступно будь-якому залогіненому користувачу, як і
// звичайний пошук камер; окремої ролі не потребує.
@Controller('border-crossings')
export class BorderCrossingsController {
  constructor(private readonly borderCrossings: BorderCrossingsService) {}

  @UseGuards(TelegramAuthGuard)
  @Get()
  list() {
    return this.borderCrossings.list();
  }

  @UseGuards(TelegramAuthGuard)
  @Get(':id/wait-estimate')
  estimate(@Param('id') id: string) {
    return this.borderCrossings.getWaitEstimate(id);
  }

  @UseGuards(TelegramAuthGuard)
  @Post(':id/report')
  report(@Param('id') id: string, @Body() dto: ReportWaitDto, @Req() req: Request) {
    return this.borderCrossings.report(id, dto.direction, dto.waitMinutes, (req as any).telegramId, getClientIp(req));
  }
}

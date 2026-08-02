import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { ShareService } from './share.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';

@Controller('share')
export class ShareController {
  constructor(private readonly share: ShareService) {}

  // Создание ссылки требует логина (иначе createdByTelegramId негде взять) — но переход по
  // уже созданной ссылке (см. resolve() ниже) — нет.
  @UseGuards(TelegramAuthGuard)
  @Post()
  create(@Body() dto: CreateShareLinkDto, @Req() req: Request) {
    return this.share.create((req as any).telegramId, dto);
  }

  // Без TelegramAuthGuard намеренно — получатель ссылки может ещё не быть залогинен, когда
  // фронт впервые резолвит slug; сама точка не более чувствительна, чем обычный поиск.
  @Get(':slug')
  resolve(@Param('slug') slug: string) {
    return this.share.resolve(slug);
  }
}

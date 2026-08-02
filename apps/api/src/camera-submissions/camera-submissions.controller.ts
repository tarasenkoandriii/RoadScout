import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { getClientIp } from '../common/client-ip.util';
import { CameraSubmissionsService } from './camera-submissions.service';
import { SubmitCameraDto } from './dto/submit-camera.dto';
import { ApproveCameraSubmissionDto } from './dto/approve-camera-submission.dto';
import { RejectCameraSubmissionDto } from './dto/reject-camera-submission.dto';

// Краудсорс "Додати камеру" — доступно будь-якому залогіненому користувачу (клієнту чи
// блогеру, окремої ролі не вимагається), заявка йде в чергу модерації, а не одразу в реєстр.
@Controller()
export class CameraSubmissionsController {
  constructor(private readonly submissions: CameraSubmissionsService) {}

  @UseGuards(TelegramAuthGuard)
  @Post('camera-submissions')
  submit(@Body() dto: SubmitCameraDto, @Req() req: Request) {
    return this.submissions.submit((req as any).telegramId, dto, getClientIp(req));
  }

  @UseGuards(TelegramAuthGuard)
  @Get('camera-submissions/mine')
  listMine(@Req() req: Request) {
    return this.submissions.listMine((req as any).telegramId);
  }

  // --- Admin review (окрема вкладка в адмінці) ---

  @UseGuards(AdminGuard)
  @Get('admin/camera-submissions')
  listForReview(@Query('status') status?: string) {
    return this.submissions.listForReview(status === 'all' ? 'ALL' : 'PENDING');
  }

  @UseGuards(AdminGuard)
  @Get('admin/camera-submissions/:id')
  getOne(@Param('id') id: string) {
    return this.submissions.getOne(id);
  }

  // Nominatim (OpenStreetMap) — бесплатный, без API-ключа. Вызывается фронтендом автоматически
  // при открытии карточки заявки, не по кнопке.
  @UseGuards(AdminGuard)
  @Post('admin/camera-submissions/:id/nominatim-suggest')
  nominatimSuggest(@Param('id') id: string) {
    return this.submissions.suggestOsmForSubmission(id);
  }

  // AI-подсказка адреса/типа камеры по запросу (кнопка "Спросить AI") — см.
  // CameraSubmissionsService.suggestAiForSubmission() / GrokCameraAssistService.
  @UseGuards(AdminGuard)
  @Post('admin/camera-submissions/:id/ai-suggest')
  aiSuggest(@Param('id') id: string) {
    return this.submissions.suggestAiForSubmission(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/camera-submissions/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveCameraSubmissionDto, @Req() req: Request) {
    return this.submissions.approve(id, (req as any).telegramId, dto);
  }

  @UseGuards(AdminGuard)
  @Post('admin/camera-submissions/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectCameraSubmissionDto, @Req() req: Request) {
    return this.submissions.reject(id, (req as any).telegramId, dto.reason);
  }
}

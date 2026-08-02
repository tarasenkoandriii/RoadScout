import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { getAdminTelegramIds } from '../auth/dev-accounts.util';
import { HomeVerificationService } from './home-verification.service';
import { SubmitHomeVerificationDto } from './dto/submit-verification.dto';
import { RejectVerificationDto } from './dto/reject-verification.dto';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
// Держим лимит заметно ниже потолка тела запроса на Vercel Hobby (~4.5 МБ) — с запасом на
// multipart-накладные расходы, чтобы отдавать понятную 400-ошибку, а не generic 413 от платформы.
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

import { getClientIp } from '../common/client-ip.util';

// "Мой дом": авто-верификация адреса проживания по квитанции об оплате жилья с рукописной
// датой (см. ReceiptVerificationService про сам AI-чек и почему "auto-reject" не существует —
// только auto-approve или ручное ревью).
@Controller()
export class HomeVerificationController {
  constructor(private readonly homeVerification: HomeVerificationService) {}

  @UseGuards(TelegramAuthGuard)
  @Post('home/verify')
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async submit(
    @Body() dto: SubmitHomeVerificationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const telegramId = (req as any).telegramId;
    // Для админа квитанция не требуется (см. HomeVerificationService.submit()) — Telegram-
    // аккаунт уже в ADMIN_TELEGRAM_IDS/DEV_MOCK_ACCOUNTS, это и есть подтверждение. Если админ
    // всё же приложил файл (например, чтобы проверить сам AI-пайплайн), он проходит обычную
    // проверку как у любого пользователя — это не запрещено, просто не обязательно.
    const isAdmin = getAdminTelegramIds().includes(telegramId);

    if (!file && !isAdmin) {
      throw new BadRequestException('Приложите фото квитанции (поле формы: "receipt").');
    }
    if (file && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Неподдерживаемый тип файла: ${file.mimetype}. Разрешены: JPEG, PNG, WEBP, HEIC.`);
    }

    return this.homeVerification.submit(telegramId, dto.address, file?.buffer ?? null, file?.mimetype ?? null, getClientIp(req));
  }

  @UseGuards(TelegramAuthGuard)
  @Get('home/verify/status')
  status(@Req() req: Request) {
    return this.homeVerification.getStatusForUser((req as any).telegramId);
  }

  // "Мой дом" — сектор камер вокруг подтверждённого адреса. 403 с понятным статусом, если ещё
  // не APPROVED (см. HomeVerificationService.getHomeSector).
  @UseGuards(TelegramAuthGuard)
  @Get('home/sector')
  homeSector(@Req() req: Request) {
    return this.homeVerification.getHomeSector((req as any).telegramId);
  }

  // --- Admin review ---

  @UseGuards(AdminGuard)
  @Get('admin/home-verifications')
  list(@Query('status') status?: string) {
    return this.homeVerification.listForReview(status === 'all' ? 'ALL' : 'NEEDS_REVIEW');
  }

  // Калибровка порога уверенности — см. HomeVerificationService.getCalibrationStats(). Роут
  // объявлен ДО 'admin/home-verifications/:id', чтобы "stats" не попал в параметр :id.
  @UseGuards(AdminGuard)
  @Get('admin/home-verifications/stats')
  stats() {
    return this.homeVerification.getCalibrationStats();
  }

  // Единственный эндпоинт, отдающий полноразмерный URL фото квитанции (receiptImageUrl) —
  // намеренно отдельный от list(), чтобы список на дашборде не тянул все фото сразу.
  @UseGuards(AdminGuard)
  @Get('admin/home-verifications/:id')
  getOne(@Param('id') id: string) {
    return this.homeVerification.getForReview(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/home-verifications/:id/approve')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.homeVerification.approve(id, (req as any).telegramId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/home-verifications/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectVerificationDto, @Req() req: Request) {
    return this.homeVerification.reject(id, (req as any).telegramId, dto.reason);
  }
}

import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TelegramAuthGuard } from './telegram-auth.guard';
import { getAdminTelegramIds, getBloggerTelegramIds } from './dev-accounts.util';

// Гейт для "рабочего места блогера" — пока минимальный (список ID в BLOGGER_TELEGRAM_IDS,
// зеркалит AdminGuard). Админы тоже проходят — обычная иерархия прав, чтобы не заводить
// отдельный dev-аккаунт админу каждый раз, когда нужно посмотреть блогерский кабинет.
@Injectable()
export class BloggerGuard extends TelegramAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context); // throws UnauthorizedException if not logged in at all

    const req = context.switchToHttp().getRequest();
    const allowed = getBloggerTelegramIds().includes(req.telegramId) || getAdminTelegramIds().includes(req.telegramId);

    if (!allowed) {
      throw new ForbiddenException('This Telegram account is not in the blogger allowlist');
    }

    return true;
  }
}

import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TelegramAuthGuard } from './telegram-auth.guard';
import { getAdminTelegramIds } from './dev-accounts.util';

@Injectable()
export class AdminGuard extends TelegramAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context); // throws UnauthorizedException if not logged in at all

    const req = context.switchToHttp().getRequest();

    if (!getAdminTelegramIds().includes(req.telegramId)) {
      throw new ForbiddenException('This Telegram account is not in the admin allowlist');
    }

    return true;
  }
}

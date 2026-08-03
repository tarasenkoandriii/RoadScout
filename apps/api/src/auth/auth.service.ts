import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAuthPayload, verifyTelegramAuth, verifyTelegramWebAppInitData } from './telegram-verify.util';
import {
  DevRole,
  findDevMockAccount,
  getAdminTelegramIds,
  getBloggerTelegramIds,
  isDevAutoLoginEnabled,
  parseDevMockAccounts,
} from './dev-accounts.util';

export interface SessionUser {
  telegramId: string;
  firstName: string;
  username?: string;
  photoUrl?: string;
  isAdmin: boolean;
  isBlogger: boolean;
}

interface UpsertableUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async loginWithTelegram(payload: TelegramAuthPayload): Promise<{ token: string; user: SessionUser }> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new UnauthorizedException('Telegram login is not configured (TELEGRAM_BOT_TOKEN missing)');
    }

    if (!verifyTelegramAuth(payload, botToken)) {
      throw new UnauthorizedException('Invalid or expired Telegram login payload');
    }

    return this.issueSession({
      telegramId: String(payload.id),
      firstName: payload.first_name ?? '',
      lastName: payload.last_name,
      username: payload.username,
      photoUrl: payload.photo_url,
    });
  }

  // За прямим запитом користувача — реальний логін для BTW mini-app (Telegram.WebApp.initData),
  // якого раніше не існувало ВЗАГАЛІ (клієнт лише покладався на кукі `session`, яку нічого не
  // створювало — див. коментар у telegram-verify.util.ts::verifyTelegramWebAppInitData про повну
  // діагностику). Окремий метод, а не перевикористання loginWithTelegram() вище — інший формат
  // вхідних даних (підписаний query-string від Mini App, не {id, hash, ...} від Login Widget) і
  // інший алгоритм перевірки підпису.
  async loginWithTelegramWebApp(initData: string): Promise<{ token: string; user: SessionUser }> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new UnauthorizedException('Telegram login is not configured (TELEGRAM_BOT_TOKEN missing)');
    }

    const user = verifyTelegramWebAppInitData(initData, botToken);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired Telegram Mini App init data');
    }

    return this.issueSession({
      telegramId: String(user.id),
      firstName: user.first_name ?? '',
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
    });
  }

  // Локальная отладка (см. dev-accounts.util.ts): логинит одним кликом в один из мок-аккаунтов
  // без реального Telegram Login Widget. Полностью недоступно, если DEV_AUTO_LOGIN != "true" —
  // ведёт себя так, будто эндпоинт вообще не существует (404), а не просто "запрещено".
  async devLogin(role: string): Promise<{ token: string; user: SessionUser }> {
    if (!isDevAutoLoginEnabled()) {
      throw new NotFoundException();
    }

    const account = findDevMockAccount(role);
    if (!account) {
      throw new BadRequestException(
        `No DEV_MOCK_ACCOUNTS entry for role "${role}" — check the env var format (role:telegramId:firstName:lastName:username:photoUrl).`,
      );
    }

    return this.issueSession(account);
  }

  // Список мок-аккаунтов для кнопок в dev-панели фронтенда. Пусто (и `enabled: false`), если
  // DEV_AUTO_LOGIN выключен — фронтенд просто не рисует панель в этом случае.
  listDevAccounts(): { enabled: boolean; accounts: { role: DevRole; displayName: string }[] } {
    if (!isDevAutoLoginEnabled()) {
      return { enabled: false, accounts: [] };
    }

    const accounts = parseDevMockAccounts().map((a) => ({
      role: a.role,
      displayName: a.lastName ? `${a.firstName} ${a.lastName}` : a.firstName,
    }));

    return { enabled: true, accounts };
  }

  async getSessionUser(telegramId: string): Promise<SessionUser | null> {
    const dbUser = await this.prisma.telegramUser.findUnique({ where: { telegramId } });
    if (!dbUser) return null;

    return this.toSessionUser({
      telegramId: dbUser.telegramId,
      firstName: dbUser.firstName,
      username: dbUser.username ?? undefined,
      photoUrl: dbUser.photoUrl ?? undefined,
    });
  }

  // Shared by loginWithTelegram/devLogin: upsert the TelegramUser row, sign the session JWT.
  // The JWT only ever carries telegramId — isAdmin/isBlogger are deliberately NOT embedded in
  // it, since guards always recompute them fresh against the current env allowlists (so
  // revoking access, or toggling DEV_AUTO_LOGIN off, takes effect immediately without having
  // to invalidate any already-issued tokens).
  private async issueSession(fields: UpsertableUser): Promise<{ token: string; user: SessionUser }> {
    await this.prisma.telegramUser.upsert({
      where: { telegramId: fields.telegramId },
      create: {
        telegramId: fields.telegramId,
        firstName: fields.firstName,
        lastName: fields.lastName,
        username: fields.username,
        photoUrl: fields.photoUrl,
      },
      update: {
        firstName: fields.firstName,
        lastName: fields.lastName,
        username: fields.username,
        photoUrl: fields.photoUrl,
      },
    });

    const user = this.toSessionUser(fields);
    const token = await this.jwt.signAsync({ telegramId: fields.telegramId });

    return { token, user };
  }

  private toSessionUser(fields: UpsertableUser): SessionUser {
    return {
      telegramId: fields.telegramId,
      firstName: fields.firstName,
      username: fields.username,
      photoUrl: fields.photoUrl,
      isAdmin: getAdminTelegramIds().includes(fields.telegramId),
      isBlogger: getBloggerTelegramIds().includes(fields.telegramId),
    };
  }
}

import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TelegramAuthPayload } from './telegram-verify.util';

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
  ) {}

  // Called by the Telegram Login Widget on the frontend with the signed user payload.
  @Post('telegram')
  async loginWithTelegram(@Body() payload: TelegramAuthPayload, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.loginWithTelegram(payload);
    this.setSessionCookie(res, token);
    return { user };
  }

  // Локальная отладка: авто-вход во все "рабочие места" (admin/blogger/client) одним кликом,
  // без реального Telegram Login Widget. См. dev-accounts.util.ts — полностью отключено (404),
  // если DEV_AUTO_LOGIN != "true".
  @Post('dev-login')
  async devLogin(@Body() body: { role: string }, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.devLogin(body?.role);
    this.setSessionCookie(res, token);
    return { user };
  }

  // Список доступных для авто-входа мок-аккаунтов — used by the frontend dev panel to decide
  // whether to render at all, and what buttons to show. Deliberately unguarded/no-auth-required
  // (same reasoning as GET /auth/me below): returns `{ enabled: false }` rather than a 401/404
  // signal when disabled, so the frontend can call it unconditionally on every page load.
  @Get('dev-accounts')
  devAccounts() {
    return this.authService.listDevAccounts();
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { loggedOut: true };
  }

  // Used by the frontend on every page load to check session state. Deliberately
  // has no guard — returns { user: null } instead of a 401 when not logged in,
  // since "not logged in" is an expected, non-error state for this endpoint.
  @Get('me')
  async me(@Req() req: Request) {
    const token = (req as any).cookies?.[COOKIE_NAME];
    if (!token) return { user: null };

    try {
      const decoded = await this.jwt.verifyAsync(token);
      const user = await this.authService.getSessionUser(decoded.telegramId);
      return { user };
    } catch {
      return { user: null };
    }
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
}

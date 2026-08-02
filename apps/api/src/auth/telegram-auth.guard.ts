import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// Any authenticated Telegram user passes this guard — used for the public site's
// endpoints (e.g. /search). AdminGuard extends this with an additional allowlist check.
@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.session ?? extractBearerToken(req);

    if (!token) {
      throw new UnauthorizedException('Not authenticated — log in with Telegram first');
    }

    try {
      const decoded = await this.jwt.verifyAsync(token);
      req.telegramId = decoded.telegramId;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}

function extractBearerToken(req: any): string | undefined {
  const header = req.headers?.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

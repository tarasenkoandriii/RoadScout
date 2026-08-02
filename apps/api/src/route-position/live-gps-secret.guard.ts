import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

// Mirrors scraper/guards/cron-secret.guard.ts — a carrier's GPS feed calls this endpoint
// out-of-band (webhook or their own poller), not via Supabase pg_cron, so it gets its own
// secret rather than reusing PARSER_CRON_SECRET.
@Injectable()
export class LiveGpsSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-live-gps-secret'];

    if (!secret || secret !== process.env.LIVE_GPS_SECRET) {
      throw new UnauthorizedException('Invalid live-gps secret');
    }
    return true;
  }
}

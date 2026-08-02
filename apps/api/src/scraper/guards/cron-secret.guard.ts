import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

// Supabase pg_cron calls the internal endpoint via pg_net http_post with this header.
// See sql/pg_cron-schedule.sql for the scheduling side.
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-cron-secret'];

    if (!secret || secret !== process.env.PARSER_CRON_SECRET) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return true;
  }
}

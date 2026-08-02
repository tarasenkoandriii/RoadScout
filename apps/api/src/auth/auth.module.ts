import { Global, Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TelegramAuthGuard } from './telegram-auth.guard';
import { AdminGuard } from './admin.guard';
import { BloggerGuard } from './blogger.guard';
import { PrismaModule } from '../prisma/prisma.module';

const DEV_ONLY_FALLBACK_SECRET = 'insecure-dev-secret-change-me';
const jwtSecret = process.env.JWT_SECRET ?? DEV_ONLY_FALLBACK_SECRET;

if (jwtSecret === DEV_ONLY_FALLBACK_SECRET) {
  new Logger('AuthModule').warn(
    'JWT_SECRET is not set — using an insecure default. Set JWT_SECRET before deploying to production.',
  );
}

@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TelegramAuthGuard, AdminGuard, BloggerGuard],
  exports: [TelegramAuthGuard, AdminGuard, BloggerGuard, JwtModule],
})
export class AuthModule {}

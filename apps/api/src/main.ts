import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
// Реальный сбой в проде: `import cookieParser from 'cookie-parser'` + `app.use(cookieParser())`
// падал в рантайме с `TypeError: (0, cookie_parser_1.default) is not a function`, хотя
// компиляция проходила без ошибок — см. doc/AUDIT-cookie-parser-fix.md. `@types/cookie-parser`
// типизирован через `export =` (классический CJS-стиль, как и большинство express-миддлваров),
// и `import cookieParser = require(...)` — единственный вариант импорта, который для такого
// типа модуля гарантированно компилируется БЕЗ обёртки `__importDefault`/интероп-угадывания:
// эмитится буквально `const cookieParser = require("cookie-parser")`, без риска несовпадения
// между тем, что тип-декларация обещает, и тем, что реально лежит в module.exports.
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // NOTE: browsers reject `credentials: true` combined with a wildcard origin —
  // ADMIN_ORIGIN must be a concrete origin (e.g. https://admin.example.com) once
  // cookie-based Telegram sessions are in use, not '*'.
  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3001',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();

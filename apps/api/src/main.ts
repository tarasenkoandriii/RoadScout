import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { NotFoundRedirectFilter } from './common/not-found-redirect.filter';
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

  // ВИПРАВЛЕНО (реальний знайдений баг — за прямим запитом користувача, POST
  // /admin/cameras/import повертав 413 на файлі всього 1.27МБ, 972 камери): Express за
  // замовчуванням обмежує тіло JSON-запиту 100КБ — набагато менше, ніж навіть ліміт самого
  // Vercel Hobby на тіло запиту (~4.5МБ, див. doc/AUDIT-vercel-hobby.md). "4mb" — з запасом
  // під платформний ліміт Vercel, не впритул до нього.
  app.use(json({ limit: '4mb' }));

  app.use(cookieParser());

  // NOTE: browsers reject `credentials: true` combined with a wildcard origin —
  // ADMIN_ORIGIN must be a concrete origin (e.g. https://admin.example.com) once
  // cookie-based Telegram sessions are in use, not '*'.
  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3001',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // За прямим запитом користувача — будь-який GET 404 редиректить на адмін-логін, не голий
  // JSON (див. коментар у самому фільтрі щодо точних меж застосування).
  app.useGlobalFilters(new NotFoundRedirectFilter());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();

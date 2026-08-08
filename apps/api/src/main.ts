import { NestFactory } from '@nestjs/core';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
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
  //
  // ВИПРАВЛЕНО/РОЗШИРЕНО за прямим запитом користувача — doc/TZ-btw-landing-v2.md §4: новий
  // публічний ендпоінт `/btw/landing-snapshot` (btw-landing-snapshot.service.ts) тепер
  // викликається з БРАУЗЕРА окремого фронтенд-проєкту `apps/interactive`, чий origin раніше
  // не потрапляв у CORS взагалі (тут був лише один жорстко заданий ADMIN_ORIGIN). Замість
  // розширення на wildcard (несумісний із `credentials: true`, до того ж послабив би CORS і
  // для чутливих ендпоінтів під AdminGuard/TelegramAuthGuard) — origin тепер СПИСОК
  // (`CORS_ALLOWED_ORIGINS`, через кому), з ADMIN_ORIGIN у фолбеку заради зворотної
  // сумісності зі старим deployment-конфігом, де ще немає нової змінної. Сам факт, що
  // origin у списку — це НЕ те саме, що авторизація: адмінські/telegram-ендпоінти й далі
  // захищені власними guard'ами (JWT), а не лише перевіркою origin.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.ADMIN_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      // Без Origin-заголовка (curl, серверні виклики, той самий запит із самого apps/api) —
      // пропускаємо, той самий дефолт, що вже неявно був раніше (enableCors без функції теж
      // не блокує запити без Origin).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем через тепер-уже-логуючий
      // NotFoundRedirectFilter — "POST /btw/session: Origin https://road-scout-inky.vercel.app
      // not allowed by CORS"): цей `callback(new Error(...))` кидав ЗВИЧАЙНИЙ `Error`, не
      // `HttpException` — той самий клас проблеми, що вже виправлено у самому фільтрі (§ його
      // коментар), але тут навпаки: відхилений origin — це ОЧІКУВАНА, не аварійна, поведінка
      // (клієнт із недозволеного домену), і мала б повертати 403, а не потрапляти під
      // "невідома/аварійна помилка сервера" 500. Причина живого багу в скріншоті — ІНША:
      // production-домен самого BTW mini-app (`road-scout-inky.vercel.app`) просто відсутній у
      // `CORS_ALLOWED_ORIGINS`/`ADMIN_ORIGIN` — це виправляється ЛИШЕ зміною env-змінної на
      // деплої (код тут не може знати домен наперед), а не кодом. Ця зміна лише виправляє СЕМАНТИКУ
      // відповіді (403 замість 500) для будь-якого недозволеного origin — включно з тим самим
      // випадком, якщо домен ще не додано.
      callback(new ForbiddenException(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // За прямим запитом користувача — будь-який GET 404 редиректить на адмін-логін, не голий
  // JSON (див. коментар у самому фільтрі щодо точних меж застосування).
  app.useGlobalFilters(new NotFoundRedirectFilter());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();

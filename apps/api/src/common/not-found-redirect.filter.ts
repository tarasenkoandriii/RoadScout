import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { resolveAdminOrigin } from './admin-origin.util';

// За прямим запитом користувача — будь-який GET-запит на неіснуючий маршрут API тепер
// редиректить на адмін-застосунок (той самий ADMIN_ORIGIN, що вже використовується для CORS
// у main.ts і для кореневого редиректу в CamerasController), замість голого JSON 404. Це
// той самий сценарій, що привів до цього запиту: людина відкриває сам API-домен у браузері
// напряму (наприклад, помилково перейшовши за старим посиланням) і бачить сирий JSON замість
// чогось зрозумілого.
//
// ВАЖЛИВО — обмежено ЛИШЕ 404 і ЛИШЕ GET-запитами: усі інші статуси (400/401/403/500 тощо) і
// всі інші методи (POST/PATCH/DELETE) і далі повертають звичайну JSON-відповідь як раніше —
// зміна поведінки на редирект для НИХ зламала б реальних API-клієнтів (мобільний застосунок,
// BTW тощо), що очікують структуровану помилку, а не HTTP-редирект.
//
// ВИПРАВЛЕНО (реальний баг, знайдений користувачем — /admin/btw-dev-tools показував
// "Не удалось загрузить список" і порожній список міст, хоча дані в базі реально є) — сама
// адмінка теж робить GET-запити на цей самий API (fetch з credentials: 'include') і деякі з
// них навмисно повертають 404 як сигнал "фіча вимкнена" (BtwService.assertDevToolsEnabled()),
// який фронтенд явно очікує розпарсити (`if (res.status === 404) setDisabled(true)`). Без
// розрізнення цей фільтр перехоплював і ЦІ 404 теж, підмінюючи їх на 302-редирект на голий
// ADMIN_ORIGIN — браузерний fetch() тихо йде за редиректом, отримує HTML замість JSON, і
// .json() падає. Розрізняємо за заголовком Accept: справжня навігація браузера (людина
// відкрила посилання на API напряму) шле "Accept: text/html", а програмні fetch/XHR-виклики
// (як усі виклики адмінки вище) — "Accept: */*" або "application/json". Редиректимо лише
// перший випадок.
// ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем — скріншоти "POST /api/session — 500"
// і "любой тап по камере — нет видео — 500"): цей фільтр раніше стояв як `@Catch(HttpException)`
// — тобто перехоплював ЛИШЕ контрольовані помилки (BadRequestException тощо), які й так вже
// логуються/обробляються коректно самими сервісами. БУДЬ-ЯКИЙ інший кинутий об'єкт (сирий
// `Error`, `PrismaClientKnownRequestError`/`PrismaClientInitializationError` з
// `AuthService.issueSession()` — `telegramUser.upsert()` без try/catch, `AxiosError` з
// `BtwService.fetchThumbImage()` — запит до зовнішнього потоку камери без try/catch, чи
// TypeError з `BtwService.pointInPolygon()`, якщо `NoTargetZone.geom` (Prisma `Json`, без
// схемної гарантії форми) виявиться не масивом `{lat,lng}[]`) — НЕ підпадав під `@Catch
// (HttpException)` узагалі, провалювався крізь цей фільтр і діставався до вбудованого
// дефолтного обробника Nest, який віддає рівно те, що бачив користувач: голий JSON
// `{"statusCode":500,"message":"Internal server error"}` (52 байти — точно збігається з логом
// у скріншоті) — і, що найгірше, БЕЗ ЖОДНОГО server-side логування, тобто діагностувати такі
// збої за самими лише клієнтськими скріншотами було об'єктивно неможливо.
//
// Тепер — `@Catch()` без аргументів (перехоплює АБСОЛЮТНО все, не лише HttpException), з
// явним розгалуженням: контрольовані `HttpException` — та сама поведінка, що й раніше (включно
// з редиректом 404 нижче), без жодної зміни. Усе інше — тепер (1) логується сервером ПОВНІСТЮ
// (`this.logger.error(exception)`, стек трейс потрапляє в реальні серверні логи Vercel/іншого
// хостингу — саме те, чого не вистачало для діагностики двох живих багів вище), і (2)
// повертається клієнту той самий за формою 500 JSON, що й раніше (сумісність з фронтендом, який
// уже парсить `body?.message` — apps/btw/app/scan/page.tsx:1027 — не порушена), але БЕЗ
// внутрішніх деталей помилки (стек, повідомлення драйвера БД тощо) у самій відповіді — щоб не
// розкривати внутрішню структуру бекенда випадковому клієнту.
@Catch()
export class NotFoundRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(NotFoundRedirectFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (!(exception instanceof HttpException)) {
      // Некерована помилка — саме той клас багів, що раніше мовчки провалювався крізь старий
      // `@Catch(HttpException)` (§ коментар вище). Логуємо ПОВНІСТЮ (з стеком, якщо є) і
      // повертаємо стандартну форму 500-відповіді Nest, без витоку внутрішніх деталей.
      this.logger.error(`Unhandled exception on ${request?.method} ${request?.url}: ${(exception as any)?.message ?? exception}`, (exception as any)?.stack);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
      return;
    }

    const status = exception.getStatus();

    if (status === HttpStatus.NOT_FOUND && request.method === 'GET' && this.looksLikeBrowserNavigation(request)) {
      // ВИПРАВЛЕНО (той самий реальний інцидент, що й у CamerasController) — fallback на
      // localhost допустимий лише поза Vercel; на Vercel без ADMIN_ORIGIN просто лишаємо
      // звичайну JSON-відповідь 404, а не редиректимо в нікуди.
      const adminOrigin = resolveAdminOrigin();
      if (adminOrigin) {
        response.redirect(302, adminOrigin);
        return;
      }
    }

    // Стандартна поведінка NestJS для решти випадків — та сама форма відповіді
    // ({message, error, statusCode}), що й раніше, без жодних змін.
    const exceptionResponse = exception.getResponse();
    response.status(status).json(typeof exceptionResponse === 'string' ? { message: exceptionResponse, statusCode: status } : exceptionResponse);
  }

  // "text/html" у Accept — це те, що реально шле браузер під час звичайної навігації
  // (адресний рядок, клік по посиланню). fetch()/XHR без явного Accept (як усі виклики в
  // btw-dev-tools/page.tsx) або з "application/json" — це програмний клієнт, якому редирект
  // замість JSON лише зламає .json(). Свідомо НЕ дивимось на X-Requested-With чи інші
  // евристики — Accept вже однозначно видно в скріншоті Network-панелі, що спричинив цей фікс.
  private looksLikeBrowserNavigation(request: { headers?: Record<string, string | string[] | undefined> }): boolean {
    const accept = request.headers?.['accept'];
    const acceptValue = Array.isArray(accept) ? accept.join(',') : accept;
    return !!acceptValue && acceptValue.includes('text/html');
  }
}

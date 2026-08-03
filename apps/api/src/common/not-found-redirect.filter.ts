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
@Catch(HttpException)
export class NotFoundRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(NotFoundRedirectFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
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

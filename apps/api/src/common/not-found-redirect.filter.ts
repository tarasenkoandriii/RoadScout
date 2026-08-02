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
@Catch(HttpException)
export class NotFoundRedirectFilter implements ExceptionFilter {
  private readonly logger = new Logger(NotFoundRedirectFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception.getStatus();

    if (status === HttpStatus.NOT_FOUND && request.method === 'GET') {
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
}

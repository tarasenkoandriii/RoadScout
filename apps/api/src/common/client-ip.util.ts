import type { Request } from 'express';

// За обратным прокси (Vercel/большинство хостингов) реальный IP клиента приходит в
// x-forwarded-for (первое значение в списке — исходный клиент, дальше — цепочка прокси).
// req.socket.remoteAddress — фоллбэк для локальной разработки без прокси перед Nest (тогда это
// и есть настоящий IP подключения).
//
// Изначально жил только в home-verification.controller.ts — вынесен сюда, чтобы новые
// краудсорс-эндпоинты (жалобы на очередь на границе, заявки камер, шеринг локации) не
// дублировали одну и ту же логику.
export function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket as any)?.remoteAddress ?? null;
}

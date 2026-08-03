import type { Response } from 'express';

// Виділено в спільний util (за прямим запитом користувача — знайдено під час діагностики
// "подмена координат на реальном устройстве не работает и телеметрии нет"): раніше ім'я/TTL
// кукі й опції `res.cookie(...)` існували ЛИШЕ приватним методом усередині AuthController —
// коли знадобився ДРУГИЙ спосіб входу (BtwController, initData Mini App замість Login Widget),
// довелося або дублювати ці магічні константи (ризик розсинхронізації — приклад: одне місце
// поправили на `sameSite: 'none'`, друге забули), або винести сюди один раз.
export const SESSION_COOKIE_NAME = 'session';
export const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 днів

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { LANGUAGES, isSupportedLanguage, LanguageCode } from './lib/i18n/languages';
import { detectLanguageFromVercelCountry } from './lib/i18n/detect';

// За прямим запитом користувача — доведення мультимовності до справжнього URL-based
// SEO (/en/, /pl/ тощо як окремі маршрути, не єдина URL-адреса з мовою за cookie/JS-станом).
// Middleware перехоплює БУДЬ-ЯКИЙ запит без мовного префікса в шляху (найчастіше — просто
// корінь "/") і редиректить на конкретний `/{lang}` ДО того, як запит взагалі досягне
// маршрутизації App Router — саме так реалізовано офіційний патерн i18n-роутингу Next.js.
const COOKIE_NAME = 'btw_landing_lang';
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

function resolveLanguage(request: NextRequest): LanguageCode {
  const savedLang = request.cookies.get(COOKIE_NAME)?.value;
  if (savedLang && isSupportedLanguage(savedLang)) return savedLang;

  // Той самий заголовок, що й раніше (доступний у middleware так само, як у Server
  // Components через headers()) — Vercel сам підставляє його на кожен запит.
  const country = request.headers.get('x-vercel-ip-country');
  return detectLanguageFromVercelCountry(country);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Шлях уже має мовний префікс (напр. /en, /en/щось) — пропускаємо без змін.
  const hasLangPrefix = LANGUAGE_CODES.some((code) => pathname === `/${code}` || pathname.startsWith(`/${code}/`));
  if (hasLangPrefix) return NextResponse.next();

  const lang = resolveLanguage(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Виключаємо статичні файли, спеціальні маршрути Next.js (_next), API (якщо колись
  // з'являться) і публічні файли з розширенням (favicon, зображення тощо) — редирект
  // потрібен лише для реальних HTML-сторінок, не для ассетів.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};

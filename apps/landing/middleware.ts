import { LANGUAGES, isSupportedLanguage, LanguageCode } from './lib/i18n/languages';
import { detectLanguageFromVercelCountry } from './lib/i18n/detect';

// За прямим запитом користувача — доведення мультимовності до справжнього URL-based
// SEO (/en/, /pl/ тощо як окремі маршрути, не єдина URL-адреса з мовою за cookie/JS-станом).
// Middleware перехоплює БУДЬ-ЯКИЙ запит без мовного префікса в шляху (найчастіше — просто
// корінь "/") і редиректить на конкретний `/{lang}` ДО того, як запит взагалі досягне
// маршрутизації App Router — саме так реалізовано офіційний патерн i18n-роутингу Next.js.
//
// ВИПРАВЛЕНО (реальна помилка на проді, знайдена користувачем — `ReferenceError: __dirname
// is not defined`, `MIDDLEWARE_INVOCATION_FAILED`): це задокументований баг самого Next.js
// (напр. vercel/next.js#53968, vercel/next.js#58140, той самий клас помилки в next-intl і
// @supabase/ssr) — сам ІМПОРТ із 'next/server' (навіть лише типів NextRequest/NextResponse)
// тягне за собою внутрішній ua-parser-js, який звертається до __dirname при завантаженні
// модуля — і падає саме на Edge Runtime (локально не відтворюється, тому й не було спіймано
// раніше). Виправлення — уникнути імпорту з 'next/server' ВЗАГАЛІ, використовувати лише
// стандартні Web API (Request/Response/URL), які нативно підтримуються Edge Runtime без
// жодних внутрішніх залежностей Next.js.
const COOKIE_NAME = 'btw_landing_lang';
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

// Ручний парсинг cookie із заголовка запиту — NextRequest.cookies.get() був зручною
// обгорткою, яку довелось прибрати разом з імпортом 'next/server'; сам Cookie-заголовок —
// звичайний рядок виду "name1=value1; name2=value2", парситься без жодних залежностей.
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function resolveLanguage(request: Request): LanguageCode {
  const savedLang = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (savedLang && isSupportedLanguage(savedLang)) return savedLang;

  // Той самий заголовок, що й раніше — Vercel сам підставляє його на кожен запит, доступний
  // через стандартний Request.headers, без потреби в NextRequest-обгортці.
  const country = request.headers.get('x-vercel-ip-country');
  return detectLanguageFromVercelCountry(country);
}

// Стандартний Web Request/Response — жодного імпорту з 'next/server'. Next.js викликає цю
// функцію з об'єктом, структурно сумісним із Request (те саме, що NextRequest, лише без
// зручних обгорток типу .cookies/.nextUrl, які довелось замінити ручними еквівалентами вище).
export function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Шлях уже має мовний префікс (напр. /en, /en/щось) — пропускаємо без змін (повертаємо
  // undefined — так само, як NextResponse.next(), Next.js трактує "нічого не повернуто" як
  // "продовжити звичайну маршрутизацію").
  const hasLangPrefix = LANGUAGE_CODES.some((code) => pathname === `/${code}` || pathname.startsWith(`/${code}/`));
  if (hasLangPrefix) return;

  const lang = resolveLanguage(request);
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  return Response.redirect(url, 307);
}

export const config = {
  // Виключаємо статичні файли, спеціальні маршрути Next.js (_next), API (якщо колись
  // з'являться) і публічні файли з розширенням (favicon, зображення тощо) — редирект
  // потрібен лише для реальних HTML-сторінок, не для ассетів.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};

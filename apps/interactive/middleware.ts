import { LANGUAGES, isSupportedLanguage, LanguageCode } from './lib/i18n/languages';
import { detectLanguageFromVercelCountry } from './lib/i18n/detect';

// Той самий паттерн, що вже apps/landing/middleware.ts (URL-based і18n /{lang}/, детекція за
// заголовком Vercel x-vercel-ip-country) — тут не переосмислюється заново. ЄДИНА відмінність —
// окрема cookie (`btw_interactive_lang`, не `btw_landing_lang`), щоб вибір мови на одному
// лендингу не "перетікав" на інший через спільний домен-піддомен (якщо колись обидва
// опиняться під одним кореневим доменом) — окремі проєкти, окремий стан.
//
// ВАЖЛИВО (той самий підводний камінь, що вже задокументований і виправлений в
// apps/landing/middleware.ts) — імпорт із 'next/server' тягне внутрішній ua-parser-js, який
// падає на Vercel Edge Runtime (`__dirname is not defined`). Тому тут теж НЕ використовується
// NextRequest/NextResponse — лише стандартні Web API (Request/Response/URL).
const COOKIE_NAME = 'btw_interactive_lang';
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function resolveLanguage(request: Request): LanguageCode {
  const savedLang = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (savedLang && isSupportedLanguage(savedLang)) return savedLang;

  const country = request.headers.get('x-vercel-ip-country');
  return detectLanguageFromVercelCountry(country);
}

export function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем на живому Vercel-деплої: `GET /api/geo`
  // повертав 404, хоча `app/api/geo/route.ts` реально є в білді) — цей middleware, на відміну
  // від apps/landing (де взагалі немає жодного `/api/*` роуту), тепер обслуговує CityWidget
  // (§ TZ-btw-landing-v2.md §3.2), який ходить у СВІЙ ЖЕ `/api/geo`. Матчер нижче раніше НЕ
  // виключав `/api/*` — тож запит `/api/geo` не мав "мовного префіксу" (`/uk`, `/en`, ...),
  // middleware вважав це звичайною сторінкою і РЕДІРЕКТИВ на `/uk/api/geo` (307), якого не
  // існує (Route Handler лежить рівно в `app/api/geo/route.ts`, не під `app/[lang]/api/...`)
  // — звідси і 404 в мережевій вкладці (спершу 307, потім 404 на кінцевому URL). Захист у
  // двох місцях: `matcher` нижче (щоб middleware для `/api/*` взагалі не запускався — дешевше)
  // ТА цей явний ранній return (про всяк випадок, якщо під `app/api/` з'явиться ще один роут,
  // а хтось поправить matcher і забуде цей нюанс — той самий "belt and suspenders" підхід, що
  // вже прийнятий в інших місцях проєкту для критичної деградації).
  if (pathname.startsWith('/api/')) {
    return;
  }

  const hasLangPrefix = LANGUAGE_CODES.some((code) => pathname === `/${code}` || pathname.startsWith(`/${code}/`));
  if (hasLangPrefix) {
    return;
  }

  const lang = resolveLanguage(request);
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  return Response.redirect(url, 307);
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};

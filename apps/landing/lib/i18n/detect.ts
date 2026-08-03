import { LANGUAGES, LanguageCode, DEFAULT_LANGUAGE } from './languages';

// За прямим запитом користувача — детекція мови САМЕ з заголовка країни, який Vercel сам
// підставляє на кожен запит (`x-vercel-ip-country`, ISO 3166-1 alpha-2, напр. "UA"/"PL"/"DE")
// — на відміну від apps/admin, де детекція йде через Accept-Language браузера
// (apps/admin/lib/i18n/detect.ts). Обидва підходи мають сенс для різних сценаріїв: Accept-
// Language відображає МОВНІ налаштування пристрою (точніше для діаспори/мандрівників),
// x-vercel-ip-country — фізичне розташування (точніше для "хто зазвичай тут" на
// маркетинговому лендингу, де мета — одразу показати релевантну мову масовому відвідувачу).
//
// ВАЖЛИВО — це не автентифікований, не завжди точний сигнал (VPN/корпоративний проксі можуть
// підмінити країну) — тому це лише ПОЧАТКОВЕ значення за замовчуванням, яке користувач
// одразу може змінити через селектор; підміна країни через VPN не "ламає" нічого критичного,
// просто дає не той дефолт.
const COUNTRY_TO_LANGUAGE: Record<string, LanguageCode> = {
  UA: 'uk',
  PL: 'pl',
  SK: 'sk',
  HU: 'hu',
  RO: 'ro',
  MD: 'ro', // Молдова говорить румунською — той самий вибір, що вже зроблено в apps/admin
  DE: 'de',
  AT: 'de',
  CH: 'de',
  FR: 'fr',
  BE: 'fr',
  ES: 'es',
  IT: 'it',
  GB: 'en',
  US: 'en',
  IE: 'en',
};

// Заголовок Vercel може бути відсутній (локальна розробка через docker-compose, де запити
// взагалі не проходять через Vercel Edge Network) — тоді коректна деградація до
// DEFAULT_LANGUAGE, не крах.
export function detectLanguageFromVercelCountry(countryHeader: string | null | undefined): LanguageCode {
  if (!countryHeader) return DEFAULT_LANGUAGE;

  const mapped = COUNTRY_TO_LANGUAGE[countryHeader.toUpperCase()];
  if (mapped && LANGUAGES.some((l) => l.code === mapped)) return mapped;

  return DEFAULT_LANGUAGE;
}

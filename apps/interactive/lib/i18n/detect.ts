import { LANGUAGES, LanguageCode, DEFAULT_LANGUAGE } from './languages';

// Той самий підхід, що вже apps/landing/lib/i18n/detect.ts — детекція мови з Vercel-заголовка
// x-vercel-ip-country (не з Accept-Language) — початкове значення, яке відвідувач одразу може
// змінити через селектор мови.
const COUNTRY_TO_LANGUAGE: Record<string, LanguageCode> = {
  UA: 'uk',
  PL: 'pl',
  SK: 'sk',
  HU: 'hu',
  RO: 'ro',
  MD: 'ro',
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

export function detectLanguageFromVercelCountry(countryHeader: string | null | undefined): LanguageCode {
  if (!countryHeader) return DEFAULT_LANGUAGE;

  const mapped = COUNTRY_TO_LANGUAGE[countryHeader.toUpperCase()];
  if (mapped && LANGUAGES.some((l) => l.code === mapped)) return mapped;

  return DEFAULT_LANGUAGE;
}

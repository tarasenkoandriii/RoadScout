// Той самий набір 10 мов, що вже apps/landing/lib/i18n/languages.ts — той самий бренд/ринок,
// той самий обґрунтований вибір (Україна + сусідні країни + найбільші мови ЄС), не
// переосмислюється заново для другого лендингу.
export type LanguageCode = 'uk' | 'en' | 'pl' | 'sk' | 'hu' | 'ro' | 'de' | 'fr' | 'es' | 'it';

export interface LanguageOption {
  code: LanguageCode;
  nativeName: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'uk', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'en', nativeName: 'English', flag: '🇬🇧' },
  { code: 'pl', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'sk', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hu', nativeName: 'Magyar', flag: '🇭🇺' },
  { code: 'ro', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'de', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'es', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'it', nativeName: 'Italiano', flag: '🇮🇹' },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'uk';

export function isSupportedLanguage(value: string): value is LanguageCode {
  return LANGUAGES.some((l) => l.code === value);
}

// Той самий набір 10 мов, що вже в apps/admin (за аналогією ATM-travel.org/ОРБІТА, див.
// apps/admin/lib/i18n/languages.ts для повного обґрунтування вибору саме цих 10): Україна +
// 5 сусідніх країн (Молдова говорить румунською — окремого словника не заводимо) + 4
// найбільші мови ЄС для решти аудиторії.
export type LanguageCode = 'uk' | 'en' | 'pl' | 'sk' | 'hu' | 'ro' | 'de' | 'fr' | 'es' | 'it';

export interface LanguageOption {
  code: LanguageCode;
  nativeName: string;
  flag: string; // emoji — просте крос-платформне рішення без іконок-спрайтів
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

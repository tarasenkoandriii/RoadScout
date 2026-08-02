// Мультиязычность публичного сайта (см. doc/README.md, "Мультиязычность") — по аналогии с
// ATM-travel.org/ОРБІТА: авто-детект по заголовку Accept-Language браузера + ручной выбор через
// выпадающий список с флагами, сохраняется в cookie.
//
// Выбор именно этих 10 языков: Україна + 5 соседних стран, чей приграничный регион уже
// поддержан в справочнике City (Польща/Словаччина/Угорщина/Румунія — Молдова говорит
// по-румунски, отдельного словаря не заводим), плюс 4 крупнейших языка ЄС для остальной
// аудитории (діаспора/туристи/новинний інтерес).
export type LanguageCode = 'uk' | 'en' | 'pl' | 'sk' | 'hu' | 'ro' | 'de' | 'fr' | 'es' | 'it';

export interface LanguageOption {
  code: LanguageCode;
  nativeName: string;
  flag: string; // emoji — простое кросс-платформенное решение без иконок-спрайтов
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

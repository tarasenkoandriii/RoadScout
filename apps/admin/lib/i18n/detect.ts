import { LANGUAGES, LanguageCode, DEFAULT_LANGUAGE } from './languages';

// Разбор заголовка Accept-Language вида "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7" в список кодов
// языка по убыванию приоритета ("uk-UA" -> "uk", без учёта региона — нам нужен только сам
// язык, не диалект/страна). Возвращает [] на пустой/некорректный заголовок, а не бросает.
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];

  return header
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';q=');
      const quality = qPart ? parseFloat(qPart) : 1;
      const primary = tag.split('-')[0].trim().toLowerCase();
      return { primary, quality: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((p) => p.primary)
    .sort((a, b) => b.quality - a.quality)
    .map((p) => p.primary);
}

// Первый код из заголовка, который реально поддерживается (см. LANGUAGES) — иначе
// DEFAULT_LANGUAGE ("uk", основной рынок сервиса). Заголовок Accept-Language — это то, что
// реально отправляет браузер согласно системным/пользовательским языковым настройкам, поэтому
// это и есть детект "через заголовок в браузере", а не просто navigator.language на клиенте.
export function detectLanguageFromAcceptHeader(header: string | null | undefined): LanguageCode {
  const candidates = parseAcceptLanguage(header);
  const supported = new Set(LANGUAGES.map((l) => l.code));

  for (const candidate of candidates) {
    if (supported.has(candidate as LanguageCode)) {
      return candidate as LanguageCode;
    }
  }

  return DEFAULT_LANGUAGE;
}

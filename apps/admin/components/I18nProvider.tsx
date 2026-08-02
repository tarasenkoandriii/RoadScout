'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { LanguageCode, isSupportedLanguage } from '../lib/i18n/languages';
import { getDictionary, interpolate, Dictionary } from '../lib/i18n';

// Перейменовано з "liveahead_lang" на "roadscout_lang" за прямим запитом користувача ("все
// упоминания предыдущих названий на RoadScout, включая ТЗ"). ВАЖЛИВО: користувачі, які вже
// зберегли вибір мови під старою назвою cookie, побачать одноразовий скид на мову за
// замовчуванням (детекція з Accept-Language) — старе значення cookie просто ігнорується, нова
// назва ще не встановлена. Прийнятний компроміс, оскільки проєкт ще не в продакшені з живими
// користувачами (див. неодноразові застереження "не перевірено на живій БД" у doc/AUDIT-*.md).
const COOKIE_NAME = 'roadscout_lang';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

interface I18nContextValue {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: keyof Dictionary, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface Props {
  // Определяется на сервере (app/layout.tsx) — либо из сохранённой cookie, либо из
  // Accept-Language текущего запроса (см. lib/i18n/detect.ts) — так первый рендер сразу в
  // правильном языке, без "мигания" дефолтным перед гидратацией.
  initialLang: LanguageCode;
  children: React.ReactNode;
}

export default function I18nProvider({ initialLang, children }: Props) {
  const [lang, setLangState] = useState<LanguageCode>(initialLang);

  useEffect(() => {
    // Подстраховка: если cookie на клиенте почему-то разошлась с тем, что сервер увидел при
    // рендере (например, cookie выставлена другой вкладкой уже после того, как эта страница
    // была засервлена) — подхватываем её после гидратации.
    const stored = readCookie(COOKIE_NAME);
    if (stored && isSupportedLanguage(stored) && stored !== initialLang) {
      setLangState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = (next: LanguageCode) => {
    setLangState(next);
    document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}`;
  };

  const dict = getDictionary(lang);
  const t = (key: keyof Dictionary, params?: Record<string, string | number>) => interpolate(dict[key], params);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n() must be used within <I18nProvider> (see app/layout.tsx)');
  }
  return ctx;
}

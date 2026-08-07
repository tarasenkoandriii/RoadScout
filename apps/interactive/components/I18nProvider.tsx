'use client';

import { createContext, useContext } from 'react';
import { LanguageCode } from '../lib/i18n/languages';
import { getDictionary, interpolate, Dictionary } from '../lib/i18n';

// Той самий паттерн, що apps/landing/components/I18nProvider.tsx — мова фіксується
// URL-сегментом (middleware.ts + app/[lang]/layout.tsx), не окремим клієнтським станом.
interface I18nContextValue {
  lang: LanguageCode;
  t: (key: keyof Dictionary, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface Props {
  lang: LanguageCode;
  children: React.ReactNode;
}

export default function I18nProvider({ lang, children }: Props) {
  const dict = getDictionary(lang);
  const t = (key: keyof Dictionary, params?: Record<string, string | number>) => interpolate(dict[key], params);

  return <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

'use client';

import { useI18n } from './I18nProvider';

// Той самий паттерн, що apps/landing/components/SkipLink.tsx.
export default function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-bg"
    >
      {t('skipLink')}
    </a>
  );
}

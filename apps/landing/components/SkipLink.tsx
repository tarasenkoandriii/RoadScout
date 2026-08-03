'use client';

import { useI18n } from './I18nProvider';

// Окремий маленький клієнтський компонент лише для перекладеного тексту skip-link — сам
// layout.tsx є серверним компонентом (читає cookies()/headers() для визначення мови),
// useI18n() потребує клієнтського контексту, тому виносимо саме цей шматок окремо, а не
// перетворюємо весь layout на клієнтський компонент заради одного рядка тексту.
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

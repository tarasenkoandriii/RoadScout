import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Unbounded, Manrope, JetBrains_Mono } from 'next/font/google';
import I18nProvider from '../../components/I18nProvider';
import { LANGUAGES, isSupportedLanguage, LanguageCode } from '../../lib/i18n/languages';
import { getDictionary } from '../../lib/i18n';
import '../globals.css';

// ВИПРАВЛЕНО (реальна помилка збірки, знайдена користувачем на `next build`) — Space
// Grotesk НЕ має кириличної підмножини символів взагалі (лише latin/latin-ext/vietnamese),
// а українська — одна з 10 мов сайту. Просте прибирання 'cyrillic' з конфігу зробило б білд
// успішним, але мовчки зламало б заголовки саме для української версії (кириличні символи
// впали б на інший, невибраний шрифт). Замінено на Unbounded — той самий геометричний,
// технічний, "дисплейний" характер (і ті самі ваги 500/700), але з ПОВНОЮ кириличною
// підтримкою (cyrillic/cyrillic-ext у офіційному наборі підмножин шрифту).
const displayFont = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', weight: ['500', '700'] });
const bodyFont = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-body', weight: ['400', '500', '600'] });
// ВИПРАВЛЕНО (та сама помилка, лише без явного збою збірки — 'latin' сам собою валідна
// підмножина для JetBrains Mono, тому build проходив, але кириличні "телеметрійні" лейбли
// (напр. '// приватність' в uk-словнику) мовчки рендерились би не тим шрифтом). JetBrains
// Mono РЕАЛЬНО підтримує cyrillic (на відміну від Space Grotesk) — тут достатньо було просто
// додати підмножину в запит, не міняти сам шрифт.
const monoFont = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-mono', weight: ['400', '500'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://btw.example.com';

// За прямим запитом користувача — доведення до справжнього URL-based мультимовного SEO.
// generateStaticParams() каже Next.js заздалегідь згенерувати всі 10 мовних маршрутів
// (/uk, /en, /pl, ...) статично на етапі збірки, а не лише за першим живим запитом.
export function generateStaticParams() {
  return LANGUAGES.map((l) => ({ lang: l.code }));
}

// ВИПРАВЛЕНО (знайдено під час аудиту) — без цього Next.js за замовчуванням намагається
// ДИНАМІЧНО відрендерити БУДЬ-яке значення [lang], якого немає в generateStaticParams
// (dynamicParams: true за замовчуванням) — запит на /zz спершу пройшов би через рендер
// layout/page (і лише там впав би на notFound() нижче), замість миттєвого 404 на рівні
// маршрутизації. З dynamicParams = false Next.js одразу віддає 404 для непідтримуваних
// кодів, не витрачаючи рендер.
export const dynamicParams = false;

// ВИПРАВЛЕНО (знайдено під час аудиту) — og:locale за специфікацією Open Graph очікує код
// формату "мова_РЕГІОН" (напр. "en_US", "de_DE"), не голий ISO 639-1 код мови. Атрибут HTML
// lang (нижче, <html lang={lang}>) — це ІНША, окрема річ, там навпаки правильний саме голий
// код (uk/en/pl/...), не займати. Ця мапа — лише для og:locale.
const OG_LOCALE: Record<LanguageCode, string> = {
  uk: 'uk_UA',
  en: 'en_US',
  pl: 'pl_PL',
  sk: 'sk_SK',
  hu: 'hu_HU',
  ro: 'ro_RO',
  de: 'de_DE',
  fr: 'fr_FR',
  es: 'es_ES',
  it: 'it_IT',
};

// Метадані генеруються ОКРЕМО для кожної мови (реальний перекладений title/description, не
// один захардкоджений варіант для всіх) — плюс `alternates.languages` з повним набором
// hreflang-посилань на всі 10 мовних версій + x-default. Саме цього не вистачало в
// попередній, cookie-based реалізації: тепер кожна мовна URL-адреса сама оголошує, де
// знайти решту 9 варіантів, і пошуковий краулер бачить їх усі одночасно, а не одну випадкову
// мову залежно від того, звідки прийшов запит.
export function generateMetadata({ params }: { params: { lang: string } }): Metadata {
  const lang = isSupportedLanguage(params.lang) ? params.lang : 'uk';
  const dict = getDictionary(lang);

  const languageAlternates: Record<string, string> = {};
  for (const l of LANGUAGES) {
    languageAlternates[l.code] = `${SITE_URL}/${l.code}`;
  }
  languageAlternates['x-default'] = `${SITE_URL}/uk`;

  // ВИПРАВЛЕНО (знайдено під час аудиту) — title раніше був захардкоджений "Beyond the Wall"
  // ОДНАКОВО для всіх 10 мов, попри те що description уже коректно бере переклад з dict.
  // Тепер title теж реально відрізняється по мовах — зібраний з уже наявних ключів словника
  // (hero_title_line1/line2), без потреби додавати новий ключ у всі 10 файлів словника.
  const localizedTitle = `${dict.hero_title_line1} ${dict.hero_title_line2} | Beyond the Wall`;

  return {
    metadataBase: new URL(SITE_URL),
    title: localizedTitle,
    description: dict.hero_subtitle,
    alternates: {
      canonical: `/${lang}`,
      languages: languageAlternates,
    },
    openGraph: {
      title: localizedTitle,
      description: dict.hero_subtitle,
      url: `${SITE_URL}/${lang}`,
      siteName: 'Beyond the Wall',
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
      locale: OG_LOCALE[lang],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: localizedTitle,
      images: ['/og-image.png'],
    },
    robots: { index: true, follow: true },
    icons: {
      icon: [
        { url: '/favicon.ico' },
        { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: '/apple-touch-icon.png',
      other: [{ rel: 'mask-icon', url: '/safari-pinned-tab.svg' }],
    },
  };
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Beyond the Wall', url: SITE_URL },
    { '@type': 'Organization', name: 'Beyond the Wall', url: SITE_URL, logo: `${SITE_URL}/android-chrome-512.png` },
  ],
};

export default function LangLayout({ children, params }: { children: React.ReactNode; params: { lang: string } }) {
  // Middleware уже гарантує, що сюди потрапляють лише запити з мовним префіксом (див.
  // middleware.ts), але пряме звернення до /xx з довільним, непідтримуваним кодом (напр.
  // хтось вручну набрав /zz) усе одно можливе — коректна деградація через notFound() (справжні
  // 404), а не мовчазний рендер зі сміттєвим значенням params.lang.
  if (!isSupportedLanguage(params.lang)) {
    notFound();
  }
  const lang = params.lang as LanguageCode;

  return (
    <html lang={lang} className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body className="bg-bg font-body text-neutral antialiased">
        <I18nProvider lang={lang}>
          {children}
        </I18nProvider>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </body>
    </html>
  );
}

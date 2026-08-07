import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Unbounded, Manrope, JetBrains_Mono } from 'next/font/google';
import I18nProvider from '../../components/I18nProvider';
import { LANGUAGES, isSupportedLanguage, LanguageCode } from '../../lib/i18n/languages';
import { getDictionary } from '../../lib/i18n';
import '../globals.css';

// Той самий шрифтовий вибір, що apps/landing/app/[lang]/layout.tsx (Unbounded замінив Space
// Grotesk, § вже задокументована причина — Space Grotesk не має кириличної підмножини, а
// українська/10 мов сайту цього потребують).
const displayFont = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', weight: ['500', '700'] });
const bodyFont = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-body', weight: ['400', '500', '600'] });
const monoFont = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-mono', weight: ['400', '500'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://interactive.btw.example.com';

export function generateStaticParams() {
  return LANGUAGES.map((l) => ({ lang: l.code }));
}

export const dynamicParams = false;

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

export function generateMetadata({ params }: { params: { lang: string } }): Metadata {
  const lang = isSupportedLanguage(params.lang) ? params.lang : 'uk';
  const dict = getDictionary(lang);

  const languageAlternates: Record<string, string> = {};
  for (const l of LANGUAGES) {
    languageAlternates[l.code] = `${SITE_URL}/${l.code}`;
  }
  languageAlternates['x-default'] = `${SITE_URL}/uk`;

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
  if (!isSupportedLanguage(params.lang)) {
    notFound();
  }
  const lang = params.lang as LanguageCode;

  return (
    <html lang={lang} className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body className="bg-bg font-body text-neutral antialiased">
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </body>
    </html>
  );
}

import type { MetadataRoute } from 'next';
import { LANGUAGES } from '../lib/i18n/languages';

// ОНОВЛЕНО за прямим запитом користувача — усі 10 мовних URL-адрес (/uk, /en, /pl, ...), не
// лише корінь сайту. Кожен запис також оголошує альтернативи для решти мов (те саме, що вже
// генерується через generateMetadata в app/[lang]/layout.tsx) — краулер бачить повний набір
// мовних версій прямо з sitemap.xml, а не лише список URL без зв'язку між ними.
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://btw.example.com';

  const languageAlternates: Record<string, string> = {};
  for (const l of LANGUAGES) {
    languageAlternates[l.code] = `${siteUrl}/${l.code}`;
  }

  return LANGUAGES.map((l) => ({
    url: `${siteUrl}/${l.code}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: l.code === 'uk' ? 1 : 0.9,
    alternates: { languages: languageAlternates },
  }));
}

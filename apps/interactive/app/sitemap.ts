import type { MetadataRoute } from 'next';
import { LANGUAGES } from '../lib/i18n/languages';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://interactive.btw.example.com';

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

import type { MetadataRoute } from 'next';

// App Router-конвенція Next.js — динамічний robots.txt/sitemap.xml замість статичних
// файлів у public/, щоб домен читався з NEXT_PUBLIC_SITE_URL (той самий реальний домен
// деплою), а не був захардкоджений заглушкою, яку легко забути оновити.
export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://btw.example.com';
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

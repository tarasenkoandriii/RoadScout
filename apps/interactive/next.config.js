/** @type {import('next').NextConfig} */
// Ті самі security-заголовки, що вже apps/landing/next.config.js — окремий деплой, окремий
// файл конфігу (не reuse через симлінк/спільний пакет — той самий рівень незалежності проєктів,
// що вже прийнятий для apps/admin/apps/btw/apps/landing у цьому монорепо). CSP тут ТРОХИ
// ширший за landing: connect-src дозволяє звертання до NEXT_PUBLIC_API_URL (сам бекенд
// apps/api) — саме заради цього віджет-по-IP (doc/TZ-btw-landing-v2.md §3) тут і існує, на
// відміну від apps/landing, де connect-src навмисно 'self' (той лендинг без бекенду взагалі).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;

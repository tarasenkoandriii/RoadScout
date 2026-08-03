/** @type {import('next').NextConfig} */
// За прямим запитом користувача (TZ-apps-landing-v2-audit.md) — розумний підмножина
// «критичних» вимог, реально застосовна для соло-розробки на MVP-етапі (той самий принцип,
// що вже витриманий у apps/admin/apps/btw — жодного CI/тестового стека, лише те, що дає
// реальну користь без витрат на підтримку інфраструктури, якої немає в решті проєкту).
// Security-заголовки — дешево, безпечно, варто зробити одразу; CSP навмисно М'ЯКИЙ
// (script-src 'self' 'unsafe-inline' — Next.js інлайнить частину гідратаційного JS,
// суворіший CSP зламав би сторінку без додаткової nonce-інфраструктури, яку немає сенсу
// городити для статичного маркетингового лендингу).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;

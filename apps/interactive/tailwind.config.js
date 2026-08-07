/** @type {import('tailwindcss').Config} */
// Ті самі кольорові токени, що apps/landing/tailwind.config.js (design-source/btw-illustrations/
// manifest/tokens.json) — той самий бренд, лише інша аудиторія/контент, тому палітра
// НЕ переосмислюється тут заново.
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F172A',
        surface: '#1E293B',
        primary: '#3B82F6',
        success: '#22C55E',
        warning: '#EAB308',
        neutral: '#F8FAFC',
        muted: '#64748B',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
};

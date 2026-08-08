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
        // ДОДАНО за прямим запитом користувача ("мелкий текст на полтона светлее включая
        // слоган") — рівно посередині між muted (#64748B, slate-500) і наступним кроком палітри
        // slate-400 (#94A3B8): (100,116,139)+(148,163,184) / 2 = (124,139,161) → #7C8BA1. Для
        // дрібного тексту (text-xs і менше: слоган, футер, підписи, номери кроків) — не для
        // звичайного тексту-абзацу, який лишається на muted.
        mutedLight: '#7C8BA1',
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

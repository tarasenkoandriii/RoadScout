/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Точні токени з design-source/btw-illustrations/manifest/tokens.json — палітра вже
      // задана самими ілюстраціями, тут лише узгоджуємо CSS-змінні сторінки з ними, а не
      // вигадуємо нову.
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

import './globals.css';

export const metadata = {
  title: 'Beyond the Wall',
};

// Beyond the Wall (BTW) — doc/BTW-tz.md / doc/AUDIT-btw.md. Telegram Mini App SDK
// (`telegram-web-app.js`) підключається тут прямим `<script>` (той самий підхід, що вже
// використовується в інших TMA-продуктах проєкту, напр. Caller ID) — не через npm-пакет,
// оскільки офіційний SDK Telegram розповсюджується саме так.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>{children}</body>
    </html>
  );
}

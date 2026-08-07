import './globals.css';
import { TripProvider } from '../lib/tripContext';

export const metadata = {
  title: 'Beyond the Wall',
};

// Beyond the Wall (BTW) — doc/BTW-tz.md / doc/AUDIT-btw.md. Telegram Mini App SDK
// (`telegram-web-app.js`) підключається тут прямим `<script>` (той самий підхід, що вже
// використовується в інших TMA-продуктах проєкту, напр. Caller ID) — не через npm-пакет,
// оскільки офіційний SDK Telegram розповсюджується саме так.
//
// ДОДАНО — за прямим запитом користувача «должна переживать [навигацию] - исправь»
// (doc/TZ-btw-route-planning.md §2.2/§5, Этап 3): `<TripProvider>` обгортає `{children}` тут, на
// рівні кореневого layout — спільного предка ВСІХ роутів (`/`, `/scan`, `/map`). Layout НЕ
// розмонтовується при навігації між ними, тож стан активної поїздки (маршрут, живий GPS,
// авто-ре-роутинг — детальний розбір `lib/tripContext.tsx`) переживає тап "Скан" з "что
// впереди" і повернення назад, а не втрачається разом з розмонтованою `app/page.tsx`.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>
        <TripProvider>{children}</TripProvider>
      </body>
    </html>
  );
}

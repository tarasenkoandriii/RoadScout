import './globals.css';
import { TripProvider } from '../lib/tripContext';
import { LocationProvider } from '../lib/locationContext';

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
//
// ДОДАНО — за прямим запитом користувача «поскольку весь роутинг и сканирование начинается с
// определения местоположения - запрашивать местоположение при входе в мини апп»: `<LocationProvider>`
// (lib/locationContext.tsx) — той самий рівень, спільний предок усіх роутів, тому позиція
// запитується РІВНО один раз, одразу при відкритті мінідодатку, а не окремо на кожному з трьох
// екранів (`/`, `/map`, `/scan`), як було раніше. Порядок вкладення з `<TripProvider>` не
// важливий — вони не залежать одне від одного (Trip веде власне живе стеження лише під час
// активної поїздки, окремо від цього одноразового визначення позиції при вході).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>
        <LocationProvider>
          <TripProvider>{children}</TripProvider>
        </LocationProvider>
      </body>
    </html>
  );
}

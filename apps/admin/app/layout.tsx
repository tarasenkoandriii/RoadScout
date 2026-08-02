import './globals.css';
import { headers, cookies } from 'next/headers';
import DevLoginPanel from '../components/DevLoginPanel';
import I18nProvider from '../components/I18nProvider';
import { detectLanguageFromAcceptHeader } from '../lib/i18n/detect';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '../lib/i18n/languages';

export const metadata = {
  title: 'RoadScout',
};

// Мультиязычность (см. doc/README.md, "Мультиязычність") — визначаємо мову на сервері ДО
// першого рендеру, щоб не було "миготіння" дефолтною мовою перед гідратацією:
// 1) якщо в cookie вже збережено ручний вибір користувача (LanguageSelector) — беремо його;
// 2) інакше — детектимо з реального заголовка Accept-Language поточного запиту (не
//    navigator.language на клієнті, а саме те, що надіслав браузер на сервер).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Перейменовано з "liveahead_lang" на "roadscout_lang" (див. I18nProvider.tsx) — узгоджено з
  // ключем, який реально встановлює LanguageSelector.
  const savedLang = cookies().get('roadscout_lang')?.value;
  const initialLang =
    savedLang && isSupportedLanguage(savedLang) ? savedLang : detectLanguageFromAcceptHeader(headers().get('accept-language'));

  return (
    <html lang={initialLang || DEFAULT_LANGUAGE}>
      <body>
        <I18nProvider initialLang={initialLang}>
          {children}
          {/* Рендерит себя в null, если бэкенд не сообщил DEV_AUTO_LOGIN=true (см. компонент) —
              безопасно смонтирован здесь безусловно, ничего не показывает в проде. */}
          <DevLoginPanel />
        </I18nProvider>
      </body>
    </html>
  );
}

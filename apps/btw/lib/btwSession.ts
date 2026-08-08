// За прямим запитом користувача — реальний логін BTW mini-app через Telegram.WebApp.initData
// (HMAC-перевірка на сервері, apps/api/src/auth/telegram-verify.util.ts). Раніше цей код жив
// лише всередині app/page.tsx (сканування) — винесено сюди, щоб /map (яка теж ходить на
// захищений `/api/dev-location-override`, за прямим наступним запитом користувача "подмену
// координат ... и на карте") могла використати ТОЙ САМИЙ логін, а не дублювати його й
// потенційно логінитись двічі окремими запитами.
//
// Модульний (не React-стейт/ref) сінглтон-проміс — навмисно: єдиний на весь client-side
// bundle, переживає навігацію між /  і /map (Next.js App Router client-side routing не
// перезавантажує JS-модулі), тому повторний вхід на іншу сторінку не шле зайвий POST /session.
//
// loggedFetch (не голий fetch) — за прямим запитом користувача ("между радар и HUD - Log,
// каждый запрос на сервер и каждый ответ отображай в этом логе") — § networkLog.ts.
import { loggedFetch } from './networkLog';

let sessionPromise: Promise<void> | null = null;
// ВИПРАВЛЕНО (аудит після живого CORS-інциденту — "POST /api/session — 500", де причиною
// виявився недозволений origin): поки CORS був зламаний, КОЖЕН виклик /api/session провалювався
// — а через модульний сінглтон-проміс НИЖЧЕ це означало, що після ПЕРШОЇ ж невдачі
// `sessionPromise` назавжди запам'ятовував "успішно завершений, але нічого не зробив" стан:
// усі наступні виклики `ensureBtwSession()` (з будь-якого екрана, будь-коли) отримували ТОЙ
// САМИЙ уже-вирішений проміс і НАВІТЬ НЕ НАМАГАЛИСЬ повторити запит — аж до повного
// перезавантаження сторінки (яке скидає JS-модулі й сам `sessionPromise`). Тобто навіть ПІСЛЯ
// виправлення CORS на сервері, вкладка/сесія браузера, що вже встигла один раз невдало
// спробувати, лишалась би "залогінена нізащо" без жодної подальшої спроби. Той самий клас
// проблеми, що вже виправлено для кешу міста (btwCityCache.ts) — "негативний результат
// закешовано назавжди, без шляху до самовиправлення". Тепер — при невдачі `sessionPromise`
// скидається в `null` (не залишається "успішно вирішеним"), тож НАСТУПНИЙ виклик
// `ensureBtwSession()` (з будь-якого екрана — усі й далі діляться тим самим сінглтоном, поки
// він в польоті чи успішно завершений) реально спробує ще раз, а не мовчки повторить ту саму
// заморожену невдачу.
let sessionAttemptFailed = false;

export function ensureBtwSession(): Promise<void> {
  if (!sessionPromise) {
    sessionAttemptFailed = false;
    sessionPromise = (async () => {
      const initData = (window as any).Telegram?.WebApp?.initData;
      if (!initData) return; // не всередині Telegram (напр. звичайний браузер для тестів UI) — просто немає сесії
      try {
        const res = await loggedFetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ initData }),
        });
        if (!res.ok) sessionAttemptFailed = true;
      } catch {
        // мовчазно продовжуємо без сесії — далі просто НЕ буде override/телеметрії/скану,
        // як і раніше, а не блокуємо весь UI через збій одного логін-запиту
        sessionAttemptFailed = true;
      } finally {
        // Скидаємо сінглтон ЛИШЕ при невдачі — успішний логін і далі кешується назавжди (як
        // і раніше, це навмисно: не сенсу перелогінюватись щоразу, initData не змінюється
        // впродовж сесії мінідодатку).
        if (sessionAttemptFailed) sessionPromise = null;
      }
    })();
  }
  return sessionPromise;
}

// Спільний тип відповіді /api/dev-location-override — теж винесено сюди, щоб не дублювати
// inline-тип в обох сторінках.
export interface DevLocationOverride {
  lat: number;
  lng: number;
}

// Спільна перевірка "чи є підміна координат для ЦЬОГО telegram-юзера" — той самий виклик, що
// раніше існував лише в app/page.tsx. Повертає null і при мережевій помилці, і коли підміни
// просто немає (як і сам ендпоінт) — викликач не повинен розрізняти ці два випадки, обидва
// означають "працюй з реальною геолокацією".
export async function fetchDevLocationOverride(): Promise<DevLocationOverride | null> {
  try {
    const res = await loggedFetch('/api/dev-location-override', { credentials: 'include' });
    if (!res.ok) return null;
    const override = await res.json();
    return override ?? null;
  } catch {
    return null;
  }
}

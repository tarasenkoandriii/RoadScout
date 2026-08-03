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
let sessionPromise: Promise<void> | null = null;

export function ensureBtwSession(): Promise<void> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const initData = (window as any).Telegram?.WebApp?.initData;
      if (!initData) return; // не всередині Telegram (напр. звичайний браузер для тестів UI) — просто немає сесії
      try {
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ initData }),
        });
      } catch {
        // мовчазно продовжуємо без сесії — далі просто НЕ буде override/телеметрії/скану,
        // як і раніше, а не блокуємо весь UI через збій одного логін-запиту
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
    const res = await fetch('/api/dev-location-override', { credentials: 'include' });
    if (!res.ok) return null;
    const override = await res.json();
    return override ?? null;
  } catch {
    return null;
  }
}

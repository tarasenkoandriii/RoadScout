// За прямим запитом користувача — «сверстать главное окно мини апп в стиле скрина - в рамках
// тз» (doc/TZ-btw-route-planning.md §2.3/§3.1 — «Сохранённые места»), а потім — «добавить
// модель и её сохранение/удаление на сервере»: ЦЯ ВЕРСІЯ файлу вже ходить на реальний сервер
// (`apps/api/src/btw/btw.service.ts::saveSavedPlace/listSavedPlaces/removeSavedPlace`, модель
// `SavedPlace` у schema.prisma), а не в localStorage, як у попередній версії цього ж файлу.
//
// `loggedFetch` (не голий `fetch`) — той самий принцип, що й у решті BTW-клієнта (§ networkLog.ts):
// запити на збережені місця теж мають бути видимі в Log-панелі.
//
// `ensureBtwSession()` викликається тут явно, а не лишається "відповідальністю викликача" —
// `/btw/saved-places` під `TelegramAuthGuard` (той самий шаблон, що вже `/btw/viewpoints`), без
// дійсної сесії запит поверне 401. `ensureBtwSession()` — модульний сінглтон-проміс
// (btwSession.ts), повторний виклик з уже готовою сесією нічого зайвого не робить.
import { ensureBtwSession } from './btwSession';
import { loggedFetch } from './networkLog';

export interface SavedPlace {
  id: string;
  label: string;
  lat: number;
  lng: number;
  address?: string | null;
  createdAt: string;
}

// Поза Telegram (звичайний браузер без initData — напр. локальне тестування UI) сесії просто
// не буде: `ensureBtwSession()` тихо не робить нічого (той самий фолбек, що вже в btwSession.ts),
// і наступний запит під `TelegramAuthGuard` впаде з 401 — тут це трактується як "місць немає",
// не як фатальна помилка екрана, той самий підхід, що вже для мережевих збоїв нижче.
export async function listSavedPlaces(): Promise<SavedPlace[]> {
  await ensureBtwSession();
  try {
    const res = await loggedFetch('/api/saved-places', { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function addSavedPlace(label: string, lat: number, lng: number): Promise<SavedPlace | null> {
  await ensureBtwSession();
  try {
    const res = await loggedFetch('/api/saved-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ label, lat, lng }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function removeSavedPlace(id: string): Promise<boolean> {
  await ensureBtwSession();
  try {
    const res = await loggedFetch(`/api/saved-places/${id}`, { method: 'DELETE', credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

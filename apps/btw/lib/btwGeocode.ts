// ДОДАНО за прямим запитом користувача («ввод точек А и Б маршрута сейчас просто плейсхолдеры
// - ничего не вводится и не редактируется - исправь») — клієнтський хелпер для нового
// публічного ендпоінту GET /btw/geocode-search (apps/api/src/btw/btw.controller.ts,
// apps/api/src/btw/btw.service.ts::searchAddress) — реальний пошук адреси за текстом, замість
// єдиного попереднього способу "ввести точку вручну" (сирі координати lat/lng, § BtwPlacePicker.tsx).
//
// `loggedFetch` (не голий `fetch`) — той самий принцип, що й у решті BTW-клієнта: запити
// пошуку адреси теж мають бути видимі в Log-панелі.
import { loggedFetch } from './networkLog';

export interface AddressSearchResult {
  label: string;
  lat: number;
  lng: number;
}

// near — опційна приблизна позиція користувача (LocationProvider), передається як міська
// підказка на сервері (§ коментар BtwService.searchAddress) для кращої релевантності —
// відсутність near НЕ ламає пошук, просто без підказки міста.
export async function searchAddress(query: string, near?: { lat: number; lng: number } | null): Promise<AddressSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const params = new URLSearchParams({ q: trimmed });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lng', String(near.lng));
  }

  try {
    const res = await loggedFetch(`/api/geocode-search?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.filter(
      (r): r is AddressSearchResult => typeof r?.label === 'string' && Number.isFinite(r?.lat) && Number.isFinite(r?.lng),
    );
  } catch {
    // Той самий "чесний" фолбек, що вже lib/btwSavedPlaces.ts — мережевий збій тут означає
    // "результатів немає", не фатальну помилку екрана (людина й так бачить порожній список і
    // може скористатись збереженими місцями/ручним вводом координат нижче).
    return [];
  }
}

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3.2/§3.3. Vercel-заголовки geo-IP
// (x-vercel-ip-latitude/-longitude/-city) доступні лише на СЕРВЕРНОМУ боці запиту, який реально
// проходить через Vercel Edge Network — клієнтський JS у браузері їх не бачить. Тому CityWidget
// (components/CityWidget.tsx) спершу звертається СЮДИ (той самий origin, той самий Next.js-
// проєкт), а вже тоді, маючи явні lat/lng, іде до окремого apps/api за самим снапшотом
// погоди/інцидентів (§3.3 ТЗ: "лендинг сам читает Vercel-заголовки... і передає координати
// явно").
//
// ВАЖЛИВО (той самий підводний камінь, що вже задокументований і виправлений у
// apps/landing/middleware.ts) — імпорт із 'next/server' (навіть NextRequest/NextResponse)
// тягне внутрішній ua-parser-js, який падає на Edge Runtime. Route Handler за замовчуванням
// виконується в Node.js runtime (не Edge), тому цей конкретний баг тут не спрацював би — але
// стандартний Web API Request/Response однаково достатній і без next/server, тож немає сенсу
// імпортувати зайве.
export const dynamic = 'force-dynamic'; // геозаголовки унікальні для кожного відвідувача — не кешувати статично на етапі збірки

export async function GET(request: Request) {
  const latRaw = request.headers.get('x-vercel-ip-latitude');
  const lngRaw = request.headers.get('x-vercel-ip-longitude');
  const cityRaw = request.headers.get('x-vercel-ip-city');

  const lat = latRaw !== null ? Number(latRaw) : NaN;
  const lng = lngRaw !== null ? Number(lngRaw) : NaN;

  // Локальна розробка (next dev) — Vercel не проксує запит, заголовків немає взагалі. Коректна
  // деградація: "недоступно", а не крах чи вигадані координати.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ available: false });
  }

  // x-vercel-ip-city закодований за RFC3986 (підтверджено документацією Vercel, § ТЗ 3.2) —
  // decodeURIComponent обов'язковий, інакше кирилічні/діакритичні назви міст прийдуть
  // відсотково-екранованими.
  const cityLabel = cityRaw !== null ? decodeURIComponent(cityRaw) : null;

  return Response.json({ available: true, lat, lng, cityLabel });
}

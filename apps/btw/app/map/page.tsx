'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { bboxAroundPoint } from '../../lib/geometry';
import type { LatLng } from '../../lib/geometry';
import { useLocation } from '../../lib/locationContext';
import { loggedFetch } from '../../lib/networkLog';
import type { MapCamera } from '../../components/MapView';

// Leaflet звертається до window/document при завантаженні модуля — SSR має бути вимкнено,
// той самий патерн, що вже перевірений в apps/admin (SectorMap через next/dynamic).
const MapView = dynamic(() => import('../../components/MapView'), { ssr: false });

const SCALE_OPTIONS = [
  { label: '500 м', radiusM: 500, zoom: 16 },
  { label: '1 км', radiusM: 1000, zoom: 15 },
  { label: '2 км', radiusM: 2000, zoom: 14 },
] as const;

// Beyond the Wall (BTW) — окремий режим "міні-карта" (за прямим запитом користувача):
// мітки камер і секторів огляду поблизу, панорамування ДВОМА пальцями, перемикач масштабу
// (500м/1км/2км). ГОЛОВНЕ ПРО ПРИВАТНІСТЬ: реальна позиція користувача (client-only,
// одноразовий виклик navigator.geolocation при відкритті режиму) НІКОЛИ НЕ НАДСИЛАЄТЬСЯ на
// сервер як ідентифікована точка — лише використовується локально, щоб порахувати bbox
// (`bboxAroundPoint`) для запиту до вже наявного АНОНІМНОГО ендпоінту `/btw/coverage`
// (публічний, без TelegramAuthGuard, не прив'язаний до жодного користувача — сервер бачить
// лише "покажи камери в цій прямокутній області", не "де стоїть конкретна людина"). Після
// панорамування bbox для наступних запитів рахується ВІД НОВОГО ЦЕНТРУ МАПИ, а не від
// початкової геолокації — тому навіть той перший клієнтський зчитаний GPS не "тягнеться" за
// користувачем по всій сесії використання карти.
//
// ВИПРАВЛЕНО (за прямим запитом користувача — "реализуй и подмену координат на карте в мини
// апп") — той самий dev-override, що вже працює на екрані сканування (app/page.tsx), тепер
// перевіряється і тут ПЕРЕД реальною геолокацією. Це НЕ суперечить приватності, описаній вище:
// override — це не "реальна позиція користувача", а координати, які АДМІН явно виставив для
// ЦЬОГО telegram-акаунту через /admin/btw-dev-tools (те саме, що вже відбувається на екрані
// сканування) — сервер тут так само не дізнається нічого понад те, що адмін сам туди вписав.
export default function BtwMapPage() {
  const router = useRouter();
  // ВИПРАВЛЕНО — за прямим запитом користувача «запрашивать местоположение при входе в мини
  // апп»: позиція більше НЕ запитується окремо цим екраном — вона вже визначена (або
  // визначається) провайдером `<LocationProvider>` в app/layout.tsx, спільним для всіх трьох
  // роутів. Тут лише читаємо вже наявний результат через useLocation().
  const { location, locating, usedDevOverride, permissionDenied } = useLocation();
  const [center, setCenter] = useState<LatLng | null>(null);
  const [scaleIndex, setScaleIndex] = useState(1); // за замовчуванням 1 км
  const [cameras, setCameras] = useState<MapCamera[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scale = SCALE_OPTIONS[scaleIndex];

  const fetchCamerasForBounds = useCallback(async (bounds: { swLat: number; swLng: number; neLat: number; neLng: number }) => {
    try {
      const params = new URLSearchParams({
        swLat: String(bounds.swLat),
        swLng: String(bounds.swLng),
        neLat: String(bounds.neLat),
        neLng: String(bounds.neLng),
      });
      const res = await loggedFetch(`/api/coverage?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCameras(data.cameras ?? []);
      }
    } catch {
      // мовчазно ігноруємо — карта просто лишається з попереднім набором камер
    }
  }, []);

  // Центруємо мапу, щойно провайдер визначив позицію (реальну, dev-override, чи відмову) —
  // замість власного виклику navigator.geolocation, як було раніше.
  useEffect(() => {
    if (center != null) return; // вже відцентровано — панорамування користувача не чіпаємо
    if (location != null) {
      setCenter(location);
      fetchCamerasForBounds(bboxAroundPoint(location, SCALE_OPTIONS[1].radiusM));
      return;
    }
    if (permissionDenied) {
      setError('Геолокация недоступна — укажите область на карте вручную (панорамирование двумя пальцами)');
      // Розумний дефолт, щоб мапа взагалі щось показала навіть без геолокації — Київ,
      // центр (та сама логіка, що /btw/manifest?city=kyiv за замовчуванням).
      const fallback = { lat: 50.4501, lng: 30.5234 };
      setCenter(fallback);
      fetchCamerasForBounds(bboxAroundPoint(fallback, SCALE_OPTIONS[1].radiusM));
    }
  }, [location, permissionDenied, center, fetchCamerasForBounds]);

  function handleScaleChange(index: number) {
    setScaleIndex(index);
    if (center) fetchCamerasForBounds(bboxAroundPoint(center, SCALE_OPTIONS[index].radiusM));
  }

  if (locating || center == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p>Определяем область карты…</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 bg-black/70 px-4 py-3">
        {/* ВИПРАВЛЕНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — раніше тут був
            жорстко зашитий `<Link href="/scan">`, який вважав, що на `/map` можна потрапити
            ЛИШЕ з екрана сканування. Це стало неправильним, щойно головний екран (`app/page.tsx`)
            отримав власну кнопку "Карта" (§ route-planning): користувач, який відкрив мапу з
            головного екрана і тиснув "← Сканирование" очікуючи повернутись туди, звідки прийшов,
            замість цього потрапляв на екран сканування — незрозумілий "глухий кут" навігації.
            `router.back()` — стандартний "поверни туди, звідки прийшли", коректний для ОБОХ
            точок входу (з `/` і з `/scan`); фолбек на `/` лише якщо історії браузера немає
            (наприклад, прямий deep-link на `/map`). */}
        <button
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/');
          }}
          className="rounded-full bg-white/20 px-3 py-1.5 text-sm"
        >
          ← Назад
        </button>
        <div className="flex gap-1">
          {SCALE_OPTIONS.map((opt, i) => (
            <button
              key={opt.label}
              onClick={() => handleScaleChange(i)}
              className={`rounded-full px-3 py-1.5 text-xs ${i === scaleIndex ? 'bg-white text-black' : 'bg-white/20 text-white'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="absolute top-14 left-4 right-4 z-10 rounded bg-yellow-900/80 px-3 py-2 text-center text-xs text-yellow-200">{error}</p>}

      {usedDevOverride && (
        <p className="absolute top-14 left-4 right-4 z-10 rounded bg-yellow-900/80 px-3 py-2 text-center text-xs text-yellow-200">
          ⚠️ используется подмена координат (dev)
        </p>
      )}

      <div className="h-screen w-full pt-14">
        <MapView center={center} zoom={scale.zoom} cameras={cameras} onBoundsChange={fetchCamerasForBounds} />
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-10 rounded-lg bg-black/70 px-3 py-2 text-center text-[10px] text-gray-300">
        Ваши координаты не передаются на сервер — только область карты, которую вы просматриваете. Панорамирование —
        двумя пальцами.
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { bboxAroundPoint, LatLng } from '../../lib/geometry';
import { ensureBtwSession, fetchDevLocationOverride } from '../../lib/btwSession';
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
  const [center, setCenter] = useState<LatLng | null>(null);
  const [scaleIndex, setScaleIndex] = useState(1); // за замовчуванням 1 км
  const [cameras, setCameras] = useState<MapCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedDevOverride, setUsedDevOverride] = useState(false);

  const scale = SCALE_OPTIONS[scaleIndex];

  const fetchCamerasForBounds = useCallback(async (bounds: { swLat: number; swLng: number; neLat: number; neLng: number }) => {
    try {
      const params = new URLSearchParams({
        swLat: String(bounds.swLat),
        swLng: String(bounds.swLng),
        neLat: String(bounds.neLat),
        neLng: String(bounds.neLng),
      });
      const res = await fetch(`/api/coverage?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCameras(data.cameras ?? []);
      }
    } catch {
      // мовчазно ігноруємо — карта просто лишається з попереднім набором камер
    }
  }, []);

  // Одноразове зчитування позиції ЛИШЕ для центрування мапи при відкритті режиму — НЕ
  // зберігається, НЕ надсилається нікуди як ідентифікована точка (див. коментар вище).
  //
  // ВИПРАВЛЕНО — спершу перевіряємо dev-override (те саме джерело, що вже працює на екрані
  // сканування), і лише якщо його немає — реальний navigator.geolocation, як і раніше.
  useEffect(() => {
    let cancelled = false;

    function useRealGeolocation() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCenter(c);
          setLoading(false);
          fetchCamerasForBounds(bboxAroundPoint(c, SCALE_OPTIONS[1].radiusM));
        },
        () => {
          if (cancelled) return;
          setError('Геолокация недоступна — укажите область на карте вручную (панорамирование двумя пальцами)');
          setLoading(false);
          // Розумний дефолт, щоб мапа взагалі щось показала навіть без геолокації — Київ,
          // центр (та сама логіка, що /btw/manifest?city=kyiv за замовчуванням).
          const fallback = { lat: 50.4501, lng: 30.5234 };
          setCenter(fallback);
          fetchCamerasForBounds(bboxAroundPoint(fallback, SCALE_OPTIONS[1].radiusM));
        },
        { enableHighAccuracy: false, timeout: 8000 },
      );
    }

    (async () => {
      await ensureBtwSession();
      if (cancelled) return;
      const override = await fetchDevLocationOverride();
      if (cancelled) return;
      if (override != null) {
        setCenter({ lat: override.lat, lng: override.lng });
        setUsedDevOverride(true);
        setLoading(false);
        fetchCamerasForBounds(bboxAroundPoint({ lat: override.lat, lng: override.lng }, SCALE_OPTIONS[1].radiusM));
        return;
      }
      useRealGeolocation();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScaleChange(index: number) {
    setScaleIndex(index);
    if (center) fetchCamerasForBounds(bboxAroundPoint(center, SCALE_OPTIONS[index].radiusM));
  }

  if (loading || center == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p>Определяем область карты…</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 bg-black/70 px-4 py-3">
        <Link href="/" className="rounded-full bg-white/20 px-3 py-1.5 text-sm">
          ← Сканирование
        </Link>
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

'use client';

// За прямим запитом користувача — "поскольку весь роутинг и сканирование начинается с
// определения местоположения - запрашивать местоположение при входе в мини апп". До цього кроку
// геолокація запитувалась ТРИЧІ, незалежно, трьома різними екранами:
//   - app/page.tsx (головний екран) — на монтуванні, працювало
//   - app/map/page.tsx — окрема ДУБЛЬОВАНА копія того самого коду, теж на монтуванні
//   - app/scan/page.tsx — лише всередині requestPermissions(), тобто ЛИШЕ після тапу
//     "Начать сканирование", разом з орієнтацією і камерою (які справді потребують прямого
//     жесту користувача на iOS — геолокація сама по собі цього не вимагає)
// Наслідок: відкриваючи сканер напряму, користувач чекав на новий запит дозволу геолокації,
// хоча вона вже могла бути відома, якби її запитали одразу при вході в мінідодаток.
//
// Тепер — ОДИН провайдер, змонтований в app/layout.tsx (спільний предок УСІХ роутів, той самий
// рівень, що вже <TripProvider> — детальний розбір lib/tripContext.tsx), що запускає ту саму
// послідовність (сесія -> dev-override -> реальна геолокація) ОДИН РАЗ, одразу при відкритті
// мінідодатку, і ділиться результатом з усіма трьома екранами через useLocation().
//
// Свідомо ОДНОРАЗОВИЙ виклик (getCurrentPosition), не watchPosition — той самий принцип, що вже
// був у кожної з трьох попередніх копій цього коду: "де я зараз, щоб показати карту/визначити
// найближче місто", не "стеж за мною постійно". Живе стеження під час активної поїздки —
// окрема, вже наявна відповідальність lib/tripContext.tsx (startTrip() вмикає власний
// watchPosition), навмисно НЕ зливається з цим провайдером.

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { ensureBtwSession, fetchDevLocationOverride } from './btwSession';
import type { LatLng } from './geometry';

interface LocationContextValue {
  location: LatLng | null;
  locating: boolean;
  usedDevOverride: boolean;
  // §8.2 ТЗ, той самий принцип деградації — "отказ -> деградация, не блокировка": якщо дозвіл
  // геолокації відхилено (чи недоступний), решта мінідодатку має продовжувати працювати
  // (ручний вибір точки на головному екрані, ручне панорамування на /map), просто без
  // автоматичного центрування — не єдиний блокуючий екран помилки.
  permissionDenied: boolean;
  // Ручний повторний запит — напр. користувач спершу відхилив дозвіл, потім хоче спробувати
  // ще раз (кнопка "Начать сканирование" на /scan тепер теж викликає це як fallback, якщо
  // контекст ще не встиг визначити позицію до моменту тапу).
  refresh: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(true);
  const [usedDevOverride, setUsedDevOverride] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Захист від паралельних викликів (напр. refresh() натиснуто ще раз до завершення першого) —
  // той самий "останній виклик виграє" принцип, що вже cancelled-прапорці в старих трьох копіях
  // цього коду, тут — через лічильник поколінь замість трьох окремих closure-змінних.
  const generationRef = useRef(0);

  const resolveLocation = useCallback(() => {
    const generation = ++generationRef.current;
    setLocating(true);
    setPermissionDenied(false);

    function useRealGeolocation() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (generationRef.current !== generation) return;
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocating(false);
        },
        () => {
          if (generationRef.current !== generation) return;
          setPermissionDenied(true);
          setLocating(false);
        },
        { enableHighAccuracy: false, timeout: 8000 },
      );
    }

    (async () => {
      await ensureBtwSession();
      if (generationRef.current !== generation) return;
      const override = await fetchDevLocationOverride();
      if (generationRef.current !== generation) return;
      if (override != null) {
        setLocation({ lat: override.lat, lng: override.lng });
        setUsedDevOverride(true);
        setLocating(false);
        return;
      }
      setUsedDevOverride(false);
      useRealGeolocation();
    })();
  }, []);

  // Запускається ОДИН раз, одразу при монтуванні провайдера — тобто при самому вході в
  // мінідодаток (app/layout.tsx — перший рендер незалежно від того, який роут відкрився першим).
  useEffect(() => {
    resolveLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: LocationContextValue = { location, locating, usedDevOverride, permissionDenied, refresh: resolveLocation };

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation() must be used within <LocationProvider> (see app/layout.tsx)');
  return ctx;
}

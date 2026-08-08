'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './I18nProvider';
import CityMapPanel from './CityMapPanel';
import type { LandingSnapshot } from '../lib/landing-snapshot.types';

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 («интерактивность по айпи
// посетителя - погода и инциденты по городу - возможно дорожную ситуацию по tom-tom»).
// Двоетапний потік (§3.2/§3.3 ТЗ): 1) свій же серверний /api/geo (читає Vercel geo-заголовки,
// які видно лише на сервері) -> 2) зовнішній apps/api /btw/landing-snapshot із явними lat/lng.
// Секція НЕ блокує перший рендер сторінки (§3.6 ТЗ) — весь запит іде вже після гідратації, у
// useEffect, з власним skeleton/деградацією, а не як частина серверного рендеру самої сторінки.
//
// РОЗШИРЕНО за прямим запитом користувача — сам компонент тепер лише завантажує дані й керує
// станом (loading/error/unavailable/ready); вся верстка погоди+карти+інцидентів винесена в
// CityMapPanel.tsx (плаваюча картка погоди поверх карти Windy/схематичного радару інцидентів/
// карти доріг). Типи відповіді бекенду — у спільному lib/landing-snapshot.types.ts, а не тут.

interface GeoResponse {
  available: boolean;
  lat?: number;
  lng?: number;
  cityLabel?: string | null;
}

type WidgetState = 'loading' | 'unavailable' | 'error' | 'ready';

// ⚠️ ЧЕСНО / ТИМЧАСОВО — за прямим запитом користувача ("в дебаг целях сейчас карту рисовать
// вокруг центра нью-йорка - заспуфить"): поки новий шар "Дороги" (RoadMapLayer.tsx) і сценарій
// 511NY не перевірені візуально на реальному деплої, позиція відвідувача ПРИМУСОВО підміняється
// на центр Нью-Йорка (в межах NY_STATE_BBOX бекенду — саме тому спрацює саме 511NY-джерело
// інцидентів, а не TomTom). Справжній виклик /api/geo нижче лишається НЕДОТОРКАНИМ — досить
// виставити прапорець у false (і прибрати цей коментар/константу), щоб повернути реальну
// IP-геолокацію без жодних інших змін коду. Не забути прибрати перед тим, як показувати цей
// лендинг реальним відвідувачам — інакше ВСІ побачать нью-йоркський віджет замість свого міста.
const DEBUG_FORCE_NYC = true;
const NYC_DEBUG_CENTER = { lat: 40.7128, lng: -74.006 };

export default function CityWidget() {
  const { t } = useI18n();
  const [state, setState] = useState<WidgetState>('loading');
  const [snapshot, setSnapshot] = useState<LandingSnapshot | null>(null);
  // Власна позиція відвідувача (з /api/geo) лишається в стані компонента, а не лише в
  // тимчасовому closure useEffect, бо потрібна нижче як `center` для CityMapPanel (і Windy-карти,
  // і схематичної карти інцидентів всередині неї).
  const [visitorGeo, setVisitorGeo] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const geoRes = await fetch('/api/geo');
        if (!geoRes.ok) throw new Error(`geo HTTP ${geoRes.status}`);
        const geo: GeoResponse = await geoRes.json();
        if (cancelled) return;

        // Точка, яку реально використовуємо нижче — або дебаг-спуф (NYC_DEBUG_CENTER, поки
        // DEBUG_FORCE_NYC=true), або справжня IP-геолокація з /api/geo. Обчислюється в одну
        // змінну (а не окремими lat/lng-перевірками нижче по коду), щоб TypeScript міг звузити
        // тип до "гарантовано number" одним `if (!point) return;` замість двох незалежних
        // перевірок geo.lat/geo.lng, які інакше не narrow-яться після присвоєння в let.
        const point = DEBUG_FORCE_NYC
          ? { lat: NYC_DEBUG_CENTER.lat, lng: NYC_DEBUG_CENTER.lng, cityLabel: 'Нью-Йорк (debug-спуф)' }
          : !geo.available || geo.lat === undefined || geo.lng === undefined
            ? null
            : { lat: geo.lat, lng: geo.lng, cityLabel: geo.cityLabel ?? undefined };

        if (!point) {
          setState('unavailable');
          return;
        }

        const apiBase = process.env.NEXT_PUBLIC_API_URL;
        if (!apiBase) {
          // ⚠️ ЧЕСНО — NEXT_PUBLIC_API_URL не налаштовано на цьому деплої; секція
          // деградує так само, як "немає покриття", а не показує помилку конфігурації
          // відвідувачу.
          setState('unavailable');
          return;
        }

        const params = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
        if (point.cityLabel) params.set('cityLabel', point.cityLabel);

        const snapRes = await fetch(`${apiBase}/btw/landing-snapshot?${params.toString()}`);
        if (!snapRes.ok) throw new Error(`landing-snapshot HTTP ${snapRes.status}`);
        const data: LandingSnapshot = await snapRes.json();
        if (cancelled) return;

        setVisitorGeo({ lat: point.lat, lng: point.lng });
        setSnapshot(data);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-surface p-6 sm:p-8">
      {/* ЗМІНЕНО за прямим запитом користувача ("все подобные тексты [...] сделать светлее на
          лендинге") — mutedLight замість muted. */}
      {state === 'loading' && <p className="text-center text-mutedLight">{t('widget_loading')}</p>}
      {state === 'error' && <p className="text-center text-mutedLight">{t('widget_error')}</p>}
      {state === 'unavailable' && <p className="text-center text-mutedLight">{t('widget_unavailable')}</p>}

      {state === 'ready' && snapshot && visitorGeo && (
        <div>
          <p className="mb-6 text-center font-display text-lg font-medium text-neutral">{snapshot.cityLabel}</p>

          <CityMapPanel center={visitorGeo} weather={snapshot.weather} incidents={snapshot.incidents} />

          <p className="mt-6 text-center text-xs text-mutedLight">{t('widget_disclaimer')}</p>
        </div>
      )}
    </div>
  );
}

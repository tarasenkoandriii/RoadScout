'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './I18nProvider';

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 («интерактивность по айпи
// посетителя - погода и инциденты по городу - возможно дорожную ситуацию по tom-tom»).
// Двоетапний потік (§3.2/§3.3 ТЗ): 1) свій же серверний /api/geo (читає Vercel geo-заголовки,
// які видно лише на сервері) -> 2) зовнішній apps/api /btw/landing-snapshot із явними lat/lng.
// Секція НЕ блокує перший рендер сторінки (§3.6 ТЗ) — весь запит іде вже після гідратації, у
// useEffect, з власним skeleton/деградацією, а не як частина серверного рендеру самої сторінки.

interface GeoResponse {
  available: boolean;
  lat?: number;
  lng?: number;
  cityLabel?: string | null;
}

interface LandingWeatherSummary {
  available: boolean;
  tempC: number | null;
  conditionLabel: string;
  isHazard: boolean;
}

interface LandingSnapshotIncident {
  id: string;
  source: '511NY' | 'TomTom';
  title: string;
  severity: string;
  distanceKm: number;
}

interface LandingIncidentsSummary {
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  items: LandingSnapshotIncident[];
  coverageNote: 'ny-state' | 'tomtom' | 'not-configured';
}

interface LandingSnapshot {
  cityLabel: string;
  weather: LandingWeatherSummary;
  incidents: LandingIncidentsSummary;
}

type WidgetState = 'loading' | 'unavailable' | 'error' | 'ready';

export default function CityWidget() {
  const { t } = useI18n();
  const [state, setState] = useState<WidgetState>('loading');
  const [snapshot, setSnapshot] = useState<LandingSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const geoRes = await fetch('/api/geo');
        if (!geoRes.ok) throw new Error(`geo HTTP ${geoRes.status}`);
        const geo: GeoResponse = await geoRes.json();
        if (cancelled) return;

        if (!geo.available || geo.lat === undefined || geo.lng === undefined) {
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

        const params = new URLSearchParams({ lat: String(geo.lat), lng: String(geo.lng) });
        if (geo.cityLabel) params.set('cityLabel', geo.cityLabel);

        const snapRes = await fetch(`${apiBase}/btw/landing-snapshot?${params.toString()}`);
        if (!snapRes.ok) throw new Error(`landing-snapshot HTTP ${snapRes.status}`);
        const data: LandingSnapshot = await snapRes.json();
        if (cancelled) return;

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
      {state === 'loading' && <p className="text-center text-muted">{t('widget_loading')}</p>}
      {state === 'error' && <p className="text-center text-muted">{t('widget_error')}</p>}
      {state === 'unavailable' && <p className="text-center text-muted">{t('widget_unavailable')}</p>}

      {state === 'ready' && snapshot && (
        <div>
          <p className="mb-6 text-center font-display text-lg font-medium text-neutral">{snapshot.cityLabel}</p>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted">{t('widget_weather_label')}</p>
              {snapshot.weather.available ? (
                <div>
                  <p className="font-display text-3xl font-medium text-neutral">
                    {Math.round(snapshot.weather.tempC as number)}°C
                  </p>
                  <p className="mt-1 text-sm text-muted">{snapshot.weather.conditionLabel}</p>
                  {snapshot.weather.isHazard && <p className="mt-2 text-sm text-warning">{t('widget_weather_hazard')}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted">{t('widget_unavailable')}</p>
              )}
            </div>

            <div>
              <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted">{t('widget_incidents_label')}</p>
              {snapshot.incidents.configured ? (
                <div>
                  {snapshot.incidents.items.length === 0 ? (
                    <p className="text-sm text-muted">{t('widget_incidents_empty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {snapshot.incidents.items.map((item) => (
                        <li key={item.id} className="text-sm text-neutral">
                          <span className="text-muted">{item.distanceKm.toFixed(1)} км —</span> {item.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 font-mono text-[11px] text-muted">
                    {snapshot.incidents.source === '511NY' && t('widget_incidents_source_511ny')}
                    {snapshot.incidents.source === 'TomTom' && t('widget_incidents_source_tomtom')}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted">{t('widget_incidents_source_none')}</p>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted">{t('widget_disclaimer')}</p>
        </div>
      )}
    </div>
  );
}

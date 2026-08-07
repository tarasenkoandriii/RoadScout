'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './I18nProvider';
import WeatherIcon, { WeatherIconKind } from './WeatherIcon';
import CityIncidentsMap from './CityIncidentsMap';

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md §3 («интерактивность по айпи
// посетителя - погода и инциденты по городу - возможно дорожную ситуацию по tom-tom»).
// Двоетапний потік (§3.2/§3.3 ТЗ): 1) свій же серверний /api/geo (читає Vercel geo-заголовки,
// які видно лише на сервері) -> 2) зовнішній apps/api /btw/landing-snapshot із явними lat/lng.
// Секція НЕ блокує перший рендер сторінки (§3.6 ТЗ) — весь запит іде вже після гідратації, у
// useEffect, з власним skeleton/деградацією, а не як частина серверного рендеру самої сторінки.
//
// РОЗШИРЕНО за прямим запитом користувача (2-денний прогноз меншим шрифтом, значки погоди,
// інциденти на схематичній карті регіону + список праворуч) — типи нижче тепер дзеркалять
// повний контракт apps/api/src/btw/btw-landing-snapshot.service.ts (iconKind/forecast на
// погоді, lat/lng на кожному інциденті, radiusKm на секції інцидентів), а не лише підмножину,
// що використовувалась раніше.

interface GeoResponse {
  available: boolean;
  lat?: number;
  lng?: number;
  cityLabel?: string | null;
}

interface WeatherForecastDay {
  dateIso: string;
  weatherCode: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  tempMaxC: number | null;
  tempMinC: number | null;
}

interface LandingWeatherSummary {
  available: boolean;
  tempC: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  forecast: WeatherForecastDay[];
}

interface LandingSnapshotIncident {
  id: string;
  source: '511NY' | 'TomTom';
  title: string;
  severity: string;
  distanceKm: number;
  lat: number;
  lng: number;
}

interface LandingIncidentsSummary {
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  items: LandingSnapshotIncident[];
  coverageNote: 'ny-state' | 'tomtom' | 'not-configured';
  radiusKm: number;
}

interface LandingSnapshot {
  cityLabel: string;
  weather: LandingWeatherSummary;
  incidents: LandingIncidentsSummary;
}

type WidgetState = 'loading' | 'unavailable' | 'error' | 'ready';

// Той самий формат дати, що приходить із weather.service.ts (WeatherForecastDay.dateIso —
// ISO YYYY-MM-DD, часовий пояс уже враховано на бекенді через timezone=auto). Тут лише
// коротка назва дня тижня мовою відвідувача — Intl.DateTimeFormat приймає наші дволітерні
// коди мов (uk/en/pl/...) напряму як валідні BCP47-теги, окремої мапи не потрібно.
function formatForecastDay(dateIso: string, lang: string): string {
  try {
    const date = new Date(`${dateIso}T00:00:00`);
    return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(date);
  } catch {
    return dateIso;
  }
}

export default function CityWidget() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<WidgetState>('loading');
  const [snapshot, setSnapshot] = useState<LandingSnapshot | null>(null);
  // ДОДАНО — власна позиція відвідувача (з /api/geo) тепер лишається в стані компонента, а не
  // лише в тимчасовому closure useEffect, бо потрібна нижче як `center` для CityIncidentsMap.
  const [visitorGeo, setVisitorGeo] = useState<{ lat: number; lng: number } | null>(null);

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

        setVisitorGeo({ lat: geo.lat, lng: geo.lng });
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
                  <div className="flex items-center gap-3">
                    <WeatherIcon kind={snapshot.weather.iconKind} className="h-10 w-10 text-neutral" />
                    <div>
                      <p className="font-display text-3xl font-medium text-neutral">
                        {Math.round(snapshot.weather.tempC as number)}°C
                      </p>
                      <p className="text-sm text-muted">{snapshot.weather.conditionLabel}</p>
                    </div>
                  </div>
                  {snapshot.weather.isHazard && <p className="mt-2 text-sm text-warning">{t('widget_weather_hazard')}</p>}

                  {snapshot.weather.forecast.length > 0 && (
                    <div className="mt-4 border-t border-white/10 pt-3">
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                        {t('widget_forecast_label')}
                      </p>
                      <div className="flex gap-4">
                        {snapshot.weather.forecast.map((day) => (
                          <div key={day.dateIso} className="flex items-center gap-1.5 text-xs text-muted">
                            <WeatherIcon kind={day.iconKind} className="h-4 w-4 text-muted" />
                            <span className="capitalize">{formatForecastDay(day.dateIso, lang)}</span>
                            <span className="text-neutral">
                              {day.tempMaxC !== null ? Math.round(day.tempMaxC) : '—'}° / {day.tempMinC !== null ? Math.round(day.tempMinC) : '—'}°
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-[auto_1fr] sm:grid-cols-1 md:grid-cols-[auto_1fr]">
                      {visitorGeo && (
                        <div className="order-1">
                          <CityIncidentsMap center={visitorGeo} incidents={snapshot.incidents.items} radiusKm={snapshot.incidents.radiusKm} />
                          <p className="mt-1 text-center font-mono text-[10px] text-muted">
                            {t('widget_map_radius_note', { radius: snapshot.incidents.radiusKm })}
                          </p>
                        </div>
                      )}
                      <ul className="order-2 space-y-2 self-start">
                        {snapshot.incidents.items.map((item, i) => (
                          <li key={item.id} className="flex items-start gap-2 text-sm text-neutral">
                            <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-warning text-[9px] font-semibold text-[#0F172A]">
                              {i + 1}
                            </span>
                            <span>
                              <span className="text-muted">{item.distanceKm.toFixed(1)} км —</span> {item.title}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
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

'use client';

import { useState } from 'react';
import { useI18n } from './I18nProvider';
import WeatherIcon from './WeatherIcon';
import WindyWidget, { WindyOverlay } from './WindyWidget';
import CityIncidentsMap from './CityIncidentsMap';
import type { LandingWeatherSummary, LandingIncidentsSummary } from '../lib/landing-snapshot.types';

// За прямим запитом користувача — "виджет погоды уменьшить и сделать отдельно - оформить
// отдельным прямоугольником и разместить внахлест на карте слева вверху" + "карту взять у windy
// - сделать как в админке с теми же селекторами слоев, поверх нанести слой инцидентов - по
// возможности отдельный слой".
//
// ⚠️ ЧЕСНО (та сама причина, що вже задокументована в
// apps/admin/components/NySituationalPanel.tsx) — Windy embed є повноцінним iframe із власною
// внутрішньою картою, а НЕ растровим tile-шаром, тому інциденти технічно НЕ можна намалювати як
// прозорий шар ПОВЕРХ карти Windy. Замість цього — той самий компроміс, що вже прийнятий в
// адмінці: один "слот" карти, що перемикається горизонтальним рядом вкладок (Windy-шари +
// "Інциденти"), а не одночасне накладання. Єдина відмінність від адмінки — шар "Інциденти" тут
// показує власну схематичну SVG-карту (CityIncidentsMap, без нових залежностей, той самий
// підхід, що вже в цьому лендингу), а не справжню Leaflet-карту з OSM-тайлами (там, на відміну
// від цього лендингу, react-leaflet вже є залежністю проєкту).
type LayerKey = 'incidents' | WindyOverlay;

const WINDY_LAYERS: WindyOverlay[] = ['rain', 'wind', 'clouds', 'temp', 'radar'];
const MAP_HEIGHT_CLASS = 'h-72 w-full sm:h-80';

interface Props {
  center: { lat: number; lng: number };
  weather: LandingWeatherSummary;
  incidents: LandingIncidentsSummary;
}

// Той самий формат дати, що приходить із weather.service.ts (WeatherForecastDay.dateIso — ISO
// YYYY-MM-DD, часовий пояс уже враховано на бекенді через timezone=auto). Intl.DateTimeFormat
// приймає дволітерні коди мов (uk/en/pl/...) напряму як валідні BCP47-теги.
function formatForecastDay(dateIso: string, lang: string): string {
  try {
    const date = new Date(`${dateIso}T00:00:00`);
    return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(date);
  } catch {
    return dateIso;
  }
}

export default function CityMapPanel({ center, weather, incidents }: Props) {
  const { t, lang } = useI18n();
  const [layer, setLayer] = useState<LayerKey>('incidents');

  const tabs: { key: LayerKey; label: string }[] = [
    { key: 'incidents', label: t('widget_layer_incidents') },
    { key: 'rain', label: t('widget_layer_rain') },
    { key: 'wind', label: t('widget_layer_wind') },
    { key: 'clouds', label: t('widget_layer_clouds') },
    { key: 'temp', label: t('widget_layer_temp') },
    { key: 'radar', label: t('widget_layer_radar') },
  ];

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted">{t('widget_map_label')}</p>

      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setLayer(tab.key)}
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  layer === tab.key ? 'bg-primary text-[#0F172A]' : 'bg-white/5 text-muted hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-surface">
            {/* Плаваюча картка погоди — за прямим запитом користувача винесена в окремий
                прямокутник і розміщена внахлест зверху зліва на карті, меншим шрифтом, ніж
                раніше. Якщо погода недоступна (weather.available === false) — картка просто не
                рендериться, а не показує фейкові/порожні значення (той самий принцип "чесно" з
                widget_unavailable). */}
            {weather.available && (
              <div className="absolute left-2 top-2 z-10 max-w-[62%] rounded-lg border border-white/10 bg-surface/95 px-2.5 py-2 shadow-lg backdrop-blur-sm sm:max-w-[210px]">
                <p className="mb-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted">{t('widget_weather_label')}</p>
                <div className="flex items-center gap-1.5">
                  <WeatherIcon kind={weather.iconKind} className="h-5 w-5 flex-none text-neutral" />
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold leading-tight text-neutral">
                      {Math.round(weather.tempC as number)}°C
                    </p>
                    <p className="truncate text-[10px] leading-tight text-muted">{weather.conditionLabel}</p>
                  </div>
                </div>
                {weather.isHazard && <p className="mt-1 text-[9px] leading-tight text-warning">{t('widget_weather_hazard')}</p>}
                {weather.forecast.length > 0 && (
                  <div className="mt-1.5 flex gap-2 border-t border-white/10 pt-1.5">
                    {weather.forecast.map((day) => (
                      <div key={day.dateIso} className="flex items-center gap-1 text-[9px] text-muted">
                        <WeatherIcon kind={day.iconKind} className="h-3 w-3 flex-none text-muted" />
                        <span className="capitalize">{formatForecastDay(day.dateIso, lang)}</span>
                        <span className="whitespace-nowrap text-neutral">
                          {day.tempMaxC !== null ? Math.round(day.tempMaxC) : '—'}°/{day.tempMinC !== null ? Math.round(day.tempMinC) : '—'}°
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {layer === 'incidents' ? (
              <div className={`flex items-center justify-center ${MAP_HEIGHT_CLASS}`}>
                <CityIncidentsMap center={center} incidents={incidents.items} radiusKm={incidents.radiusKm} />
              </div>
            ) : (
              <WindyWidget lat={center.lat} lng={center.lng} zoom={8} overlay={layer} heightClassName={`${MAP_HEIGHT_CLASS} border-0`} />
            )}
          </div>

          {layer === 'incidents' && (
            <p className="mt-1 text-center font-mono text-[10px] text-muted">
              {t('widget_map_radius_note', { radius: incidents.radiusKm })}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted">{t('widget_incidents_label')}</p>
          {incidents.configured ? (
            <div>
              {incidents.items.length === 0 ? (
                <p className="text-sm text-muted">{t('widget_incidents_empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {incidents.items.map((item, i) => (
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
              )}
              <p className="mt-3 font-mono text-[11px] text-muted">
                {incidents.source === '511NY' && t('widget_incidents_source_511ny')}
                {incidents.source === 'TomTom' && t('widget_incidents_source_tomtom')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('widget_incidents_source_none')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

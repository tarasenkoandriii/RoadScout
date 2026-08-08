'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useI18n } from './I18nProvider';
import WeatherIcon from './WeatherIcon';
import WindyWidget, { WindyOverlay } from './WindyWidget';
import type { LandingWeatherSummary, LandingIncidentsSummary } from '../lib/landing-snapshot.types';

// За прямим запитом користувача — "виджет погоды уменьшить и сделать отдельно - оформить
// отдельным прямоугольником и разместить внахлест на карте слева вверху" + "карту взять у windy
// - сделать как в админке с теми же селекторами слоев, поверх нанести слой инцидентов - по
// возможности отдельный слой" + "добавить еще карту дорог которую можно взять из blob" +
// "перенести виджет погоды над списком инцидентов и сделать немного крупнее - прогноз плохо
// читается" (ОСТАННЄ ПЕРЕВАЖАЄ найперше: картка погоди БІЛЬШЕ НЕ плаваюча/накладена на карту —
// винесена в окремий блок над списком інцидентів праворуч, крупнішим шрифтом).
//
// ⚠️ ЧЕСНО (та сама причина, що вже задокументована в
// apps/admin/components/NySituationalPanel.tsx) — Windy embed є повноцінним iframe із власною
// внутрішньою картою, а НЕ растровим tile-шаром, тому інциденти технічно НЕ можна намалювати як
// прозорий шар ПОВЕРХ карти Windy. Замість цього — той самий компроміс, що вже прийнятий в
// адмінці: один "слот" карти, що перемикається горизонтальним рядом вкладок (Windy-шари +
// один комбінований шар "Дороги/інциденти").
//
// ЗМІНЕНО за прямим запитом користувача ("дороги и инциденты должны быть в одном слое") —
// РАНІШЕ тут було ДВІ окремі вкладки: "Інциденти" (власна схематична SVG-карта
// CityIncidentsMap.tsx, без реальної вулично-дорожньої мережі) і "Дороги" (RoadMapLayer.tsx,
// react-leaflet + OSM-тайли з інцидентами, накладеними прозорим шаром маркерів ПОВЕРХ —
// технічно можливо саме тут, бо Leaflet це дозволяє, на відміну від Windy-iframe). Тепер
// лишається лише ОДНА вкладка "Дороги" — вона й раніше показувала і дороги, і інциденти
// одночасно, тож схематична CityIncidentsMap.tsx стала буквально дублем і прибрана зі списку
// вкладок. Сам файл CityIncidentsMap.tsx НЕ видалено (див. коментар на початку файлу) — про
// всяк випадок, раптом знадобиться десь ще, але тут більше не імпортується/не рендериться.
type LayerKey = 'roads' | WindyOverlay;

// react-leaflet звертається до window/document при імпорті — на сервері (SSR/SSG) це падає,
// тому карта доріг вантажиться лише на клієнті (ssr:false), той самий паттерн, що вже
// apps/admin/components/NySituationalPanel.tsx використовує для NyTrafficMap.
const RoadMapLayer = dynamic(() => import('./RoadMapLayer'), { ssr: false });

const WINDY_LAYERS: WindyOverlay[] = ['rain', 'wind', 'clouds', 'temp', 'radar'];
const MAP_HEIGHT_CLASS = 'h-72 w-full sm:h-80';
const ROAD_MAP_ZOOM = 12;

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
  const [layer, setLayer] = useState<LayerKey>('roads');

  const tabs: { key: LayerKey; label: string }[] = [
    { key: 'roads', label: t('widget_layer_roads') },
    { key: 'rain', label: t('widget_layer_rain') },
    { key: 'wind', label: t('widget_layer_wind') },
    { key: 'clouds', label: t('widget_layer_clouds') },
    { key: 'temp', label: t('widget_layer_temp') },
    { key: 'radar', label: t('widget_layer_radar') },
  ];

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-mutedLight">{t('widget_map_label')}</p>

      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setLayer(tab.key)}
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  layer === tab.key ? 'bg-primary text-[#0F172A]' : 'bg-white/5 text-mutedLight hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-surface">
            {layer === 'roads' && (
              <RoadMapLayer center={center} incidents={incidents.items} zoom={ROAD_MAP_ZOOM} heightClassName={MAP_HEIGHT_CLASS} />
            )}
            {layer !== 'roads' && (
              <WindyWidget lat={center.lat} lng={center.lng} zoom={8} overlay={layer} heightClassName={`${MAP_HEIGHT_CLASS} border-0`} />
            )}
          </div>

          {layer === 'roads' && (
            <p className="mt-1 text-center font-mono text-[10px] text-mutedLight">
              {t('widget_map_radius_note', { radius: incidents.radiusKm })}
            </p>
          )}
        </div>

        <div>
          {/* За прямим запитом користувача — "перенести виджет погоды над списком инцидентов и
              сделать немного крупнее - прогноз плохо читается": картка погоди більше не
              плаваюча/накладена на карту (як у попередній ітерації), а власний блок над списком
              інцидентів, крупнішим шрифтом (особливо рядок прогнозу — саме на нього була
              скарга). Якщо погода недоступна — блок просто не рендериться (той самий принцип
              "чесно", що й раніше). */}
          {weather.available && (
            <div className="mb-4 rounded-xl border border-white/10 bg-surface/60 p-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-mutedLight">{t('widget_weather_label')}</p>
              <div className="flex items-center gap-2.5">
                <WeatherIcon kind={weather.iconKind} className="h-9 w-9 flex-none text-neutral" />
                <div className="min-w-0">
                  <p className="font-display text-2xl font-semibold leading-tight text-neutral">
                    {Math.round(weather.tempC as number)}°C
                  </p>
                  <p className="truncate text-xs text-mutedLight">{weather.conditionLabel}</p>
                </div>
              </div>
              {weather.isHazard && <p className="mt-1.5 text-xs text-warning">{t('widget_weather_hazard')}</p>}
              {weather.forecast.length > 0 && (
                <div className="mt-2.5 flex gap-3 border-t border-white/10 pt-2.5">
                  {weather.forecast.map((day) => (
                    <div key={day.dateIso} className="flex items-center gap-1.5">
                      <WeatherIcon kind={day.iconKind} className="h-5 w-5 flex-none text-muted" />
                      <div className="leading-tight">
                        <p className="text-[11px] capitalize text-mutedLight">{formatForecastDay(day.dateIso, lang)}</p>
                        <p className="text-[11px] font-medium text-neutral">
                          {day.tempMaxC !== null ? Math.round(day.tempMaxC) : '—'}°/{day.tempMinC !== null ? Math.round(day.tempMinC) : '—'}°
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-mutedLight">{t('widget_incidents_label')}</p>
          {incidents.configured ? (
            <div>
              {/* ЗМІНЕНО за прямим запитом користувача ("все подобные тексты [...] сделать
                  светлее на лендинге") — mutedLight замість muted (текстовий колір, а не
                  колір іконки — WeatherIcon fill вище лишається на muted). */}
              {incidents.items.length === 0 ? (
                <p className="text-sm text-mutedLight">{t('widget_incidents_empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {incidents.items.map((item, i) => (
                    <li key={item.id} className="flex items-start gap-2 text-sm text-neutral">
                      <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-warning text-[9px] font-semibold text-[#0F172A]">
                        {i + 1}
                      </span>
                      <span>
                        <span className="text-mutedLight">{item.distanceKm.toFixed(1)} км —</span> {item.title}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 font-mono text-[11px] text-mutedLight">
                {incidents.source === '511NY' && t('widget_incidents_source_511ny')}
                {incidents.source === 'TomTom' && t('widget_incidents_source_tomtom')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-mutedLight">{t('widget_incidents_source_none')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

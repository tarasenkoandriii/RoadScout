'use client';

import { useState } from 'react';

// Виджет погоды Windy.com — тот же подход, что и на atm-travel.org (ОРБИТА): встроенный iframe
// embed2.html, без ключа API и без бэкенд-интеграции (см. doc/README.md, "Виджет погоды
// Windy"). Публичный embed-виджет Windy бесплатен для встраивания на сторонних сайтах.
export type WindyOverlay = 'rain' | 'wind' | 'clouds' | 'temp' | 'pressure' | 'radar';

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  defaultOverlay?: WindyOverlay;
  heightClassName?: string;
  showOverlayPicker?: boolean;
}

const OVERLAY_OPTIONS: { value: WindyOverlay; label: string }[] = [
  { value: 'rain', label: 'Дождь' },
  { value: 'wind', label: 'Ветер' },
  { value: 'clouds', label: 'Облачность' },
  { value: 'temp', label: 'Температура' },
  { value: 'radar', label: 'Радар осадков' },
];

function buildWindyEmbedUrl(lat: number, lng: number, zoom: number, overlay: WindyOverlay): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    detailLat: String(lat),
    detailLon: String(lng),
    zoom: String(zoom),
    level: 'surface',
    overlay,
    menu: '',
    message: 'true',
    marker: 'true',
    calendar: 'now',
    pressure: '',
    type: 'map',
    location: 'coordinates',
    detail: '',
    metricWind: 'default',
    metricTemp: 'default',
    radarRange: '-1',
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

export default function WindyWidget({ lat, lng, zoom = 8, defaultOverlay = 'rain', heightClassName, showOverlayPicker = true }: Props) {
  const [overlay, setOverlay] = useState<WindyOverlay>(defaultOverlay);

  return (
    <div className="space-y-2">
      {showOverlayPicker && (
        <div className="flex flex-wrap gap-1.5">
          {OVERLAY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOverlay(o.value)}
              className={`rounded px-2 py-1 text-xs ${
                overlay === o.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <iframe
        title="Windy — прогноз погоды"
        src={buildWindyEmbedUrl(lat, lng, zoom, overlay)}
        className={heightClassName ?? 'h-96 w-full rounded border-0'}
        loading="lazy"
      />
    </div>
  );
}

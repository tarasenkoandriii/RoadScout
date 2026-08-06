'use client';

import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// See SituationalMap.tsx for why this patch is needed under Next.js bundling.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// За прямим запитом користувача — "реализовать TomTom Traffic API — fallback/дополнение вне NY
// State" (doc/TZ-btw-route-planning.md §7.2/§9 п.5). Той самий "лише читання" підхід, що вже
// NyTrafficMap.tsx для 511NY — TomTom-подіями адмін теж не керує, вони живуть у зовнішньому
// джерелі.
export interface TomTomIncident {
  id: string;
  lat: number;
  lng: number;
  iconCategory: number;
  iconCategoryLabel: string;
  magnitudeOfDelay: number;
  magnitudeLabel: string;
  description: string | null;
  roadNumbers: string[];
  from: string | null;
  to: string | null;
  lengthMeters: number | null;
  delaySeconds: number | null;
  startTime: string | null;
  endTime: string | null;
  probabilityOfOccurrence: string | null;
  source: 'TomTom';
}

interface Props {
  center: { lat: number; lng: number };
  incidents: TomTomIncident[];
  heightClassName?: string;
  zoom?: number;
}

// Колір за magnitudeOfDelay (0-4, docs-confirmed мапінг — див. tomtom.service.ts) — той самий
// трирівневий+ принцип, що вже SEVERITY_COLOR у SituationalMap.tsx/NyTrafficMap.tsx.
const MAGNITUDE_COLOR: Record<number, string> = {
  0: '#6b7280',
  1: '#ca8a04',
  2: '#ea580c',
  3: '#dc2626',
  4: '#7f1d1d',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

export default function TomTomIncidentMap({ center, incidents, heightClassName, zoom = 11 }: Props) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={heightClassName ?? 'h-[32rem] w-full rounded'}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {incidents.map((inc) => (
        <CircleMarker
          key={inc.id}
          center={[inc.lat, inc.lng]}
          radius={inc.magnitudeOfDelay >= 3 ? 10 : 7}
          pathOptions={{
            color: MAGNITUDE_COLOR[inc.magnitudeOfDelay] ?? MAGNITUDE_COLOR[0],
            fillColor: MAGNITUDE_COLOR[inc.magnitudeOfDelay] ?? MAGNITUDE_COLOR[0],
            fillOpacity: 0.6,
          }}
        >
          <Popup>
            <div className="text-sm space-y-1 max-w-[240px]">
              <p className="font-semibold">{inc.iconCategoryLabel}</p>
              {inc.description && <p className="text-gray-600">{inc.description}</p>}
              {(inc.from || inc.to) && (
                <p>
                  {inc.from ?? '?'} → {inc.to ?? '?'}
                </p>
              )}
              {inc.roadNumbers.length > 0 && <p className="text-gray-600">{inc.roadNumbers.join(', ')}</p>}
              <p className="text-gray-500">
                Задержка: {inc.magnitudeLabel}
                {inc.delaySeconds != null ? ` (~${Math.round(inc.delaySeconds / 60)} мин)` : ''}
              </p>
              {inc.lengthMeters != null && <p className="text-gray-500">Длина участка: {Math.round(inc.lengthMeters)} м</p>}
              <p className="text-gray-500">Начало: {formatDate(inc.startTime)}</p>
              <p className="text-gray-400 text-xs">Источник: TomTom, ID {inc.id}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

'use client';

import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// See SectorMap.tsx for why this patch is needed under Next.js bundling.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface WeatherPoint {
  name: string;
  lat: number;
  lng: number;
  tempC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  visibilityM: number | null;
  conditionLabel: string;
  isHazard: boolean;
  observedAt: string | null;
  error?: string;
}

export interface RoadIncident {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'ACTIVE' | 'RESOLVED';
  lat: number;
  lng: number;
  title: string;
  description?: string | null;
  reportedAt: string;
  expiresAt?: string | null;
}

interface Props {
  center: { lat: number; lng: number };
  weather: WeatherPoint[];
  incidents: RoadIncident[];
  onMapClick?: (pos: { lat: number; lng: number }) => void;
  onResolveIncident?: (id: string) => void;
  heightClassName?: string;
  // По умолчанию 6 — вся Украина целиком (см. doc/README.md, "Города Украины"); раньше карта
  // была захардкожена на zoom=9 (масштаб области), что обрезало бы точки погоды других регионов.
  zoom?: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: '#ca8a04',
  MEDIUM: '#ea580c',
  HIGH: '#dc2626',
};

const TYPE_LABEL: Record<string, string> = {
  ACCIDENT: 'ДТП',
  ROAD_CLOSURE: 'Перекрытие дороги',
  FLOODING: 'Подтопление',
  ICE: 'Гололёд',
  FOG: 'Туман',
  CONSTRUCTION: 'Ремонтные работы',
  OTHER: 'Другое',
};

// Клик по карте прокидывается наверх (для формы добавления инцидента) через невидимый
// дочерний компонент с useMapEvents — react-leaflet не даёт onClick прямо на MapContainer.
function ClickCatcher({ onMapClick }: { onMapClick?: (pos: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function SituationalMap({
  center,
  weather,
  incidents,
  onMapClick,
  onResolveIncident,
  heightClassName,
  zoom = 6,
}: Props) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={heightClassName ?? 'h-[32rem] w-full rounded'}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickCatcher onMapClick={onMapClick} />

      {weather.map((w) => (
        <CircleMarker
          key={w.name}
          center={[w.lat, w.lng]}
          radius={w.isHazard ? 14 : 9}
          pathOptions={{
            color: w.isHazard ? '#dc2626' : '#2563eb',
            fillOpacity: w.isHazard ? 0.5 : 0.25,
          }}
        >
          <Popup>
            <div className="text-sm space-y-1">
              <p className="font-semibold">{w.name}</p>
              {w.error ? (
                <p className="text-red-600">Нет данных о погоде ({w.error})</p>
              ) : (
                <>
                  <p>{w.conditionLabel}</p>
                  <p>Температура: {w.tempC ?? '—'}°C</p>
                  <p>Осадки: {w.precipitationMm ?? '—'} мм</p>
                  <p>Ветер: {w.windSpeedKmh ?? '—'} км/ч</p>
                  {w.visibilityM !== null && <p>Видимость: {Math.round(w.visibilityM / 1000)} км</p>}
                </>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {incidents.map((inc) => (
        <Marker
          key={inc.id}
          position={[inc.lat, inc.lng]}
          icon={L.divIcon({
            className: '',
            html: `<div style="background:${SEVERITY_COLOR[inc.severity]};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          })}
        >
          <Popup>
            <div className="text-sm space-y-1 max-w-[220px]">
              <p className="font-semibold">{TYPE_LABEL[inc.type] ?? inc.type}</p>
              <p>{inc.title}</p>
              {inc.description && <p className="text-gray-600">{inc.description}</p>}
              <p className="text-gray-500">Заявлено: {new Date(inc.reportedAt).toLocaleString('ru-RU')}</p>
              {inc.expiresAt && (
                <p className="text-gray-500">До: {new Date(inc.expiresAt).toLocaleString('ru-RU')}</p>
              )}
              {onResolveIncident && (
                <button
                  className="mt-1 rounded bg-green-600 px-2 py-1 text-white text-xs hover:bg-green-700"
                  onClick={() => onResolveIncident(inc.id)}
                >
                  Отметить решённым
                </button>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

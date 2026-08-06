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

// За прямим запитом користувача — "пишем парсер 511ny.org - карту штата нью йорк отображаем на
// вкладку /admin/situational ... показываем инциденты" (§8 doc/TZ-btw-route-planning.md, Этап
// 2). На відміну від SituationalMap.tsx (той компонент — редаговані вручну RoadIncident, клік
// по карті додає нову точку) цей — ЧИТАННЯ ЛИШЕ, живий зовнішній фід 511NY, без форми додавання
// й без кнопки "решено" (адмін не може "вирішити" чужу подію 511NY — вона зникне сама, коли
// зникне з їхнього фіду при наступному опитуванні).
export interface FiveElevenNyEvent {
  id: string;
  lat: number;
  lng: number;
  eventType: string;
  eventSubType: string | null;
  severity: string;
  roadwayName: string | null;
  directionOfTravel: string | null;
  description: string | null;
  countyName: string | null;
  regionName: string | null;
  primaryLocation: string | null;
  reportedAt: string | null;
  lastUpdatedAt: string | null;
  plannedEndAt: string | null;
  source: '511NY';
}

interface Props {
  center: { lat: number; lng: number };
  events: FiveElevenNyEvent[];
  heightClassName?: string;
  zoom?: number;
}

// Колір за Severity 511NY (None/Minor/Major/Unknown, підтверджено живим запитом — §
// five11ny.service.ts) — той самий трирівневий принцип, що вже SEVERITY_COLOR у
// SituationalMap.tsx, просто інший вхідний enum.
const SEVERITY_COLOR: Record<string, string> = {
  None: '#2563eb',
  Minor: '#ca8a04',
  Major: '#dc2626',
  Unknown: '#6b7280',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  roadwork: 'Дорожные работы',
  closures: 'Перекрытие',
  specialEvents: 'Спецмероприятие',
  transitOperations: 'Транзит/ОТ',
  accidentsAndIncidents: 'ДТП/инцидент',
  generalInfo: 'Общая информация',
  winterDrivingIndex: 'Зимние условия',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    // ⚠️ ЧЕСНО (див. five11ny.service.ts, parseFiveElevenNyDate): вихідний час трактується як
    // UTC, хоча 511NY, найімовірніше, віддає America/New_York — показаний тут час може бути
    // зсунутий на 4-5 годин від реального.
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' UTC*';
  } catch {
    return iso;
  }
}

export default function NyTrafficMap({ center, events, heightClassName, zoom = 7 }: Props) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={heightClassName ?? 'h-[32rem] w-full rounded'}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {events.map((ev) => (
        <CircleMarker
          key={ev.id}
          center={[ev.lat, ev.lng]}
          radius={ev.severity === 'Major' ? 10 : 7}
          pathOptions={{
            color: SEVERITY_COLOR[ev.severity] ?? SEVERITY_COLOR.Unknown,
            fillColor: SEVERITY_COLOR[ev.severity] ?? SEVERITY_COLOR.Unknown,
            fillOpacity: 0.6,
          }}
        >
          <Popup>
            <div className="text-sm space-y-1 max-w-[240px]">
              <p className="font-semibold">{EVENT_TYPE_LABEL[ev.eventType] ?? ev.eventType}</p>
              {ev.eventSubType && <p className="text-gray-600">{ev.eventSubType}</p>}
              {ev.roadwayName && (
                <p>
                  {ev.roadwayName}
                  {ev.directionOfTravel ? ` · ${ev.directionOfTravel}` : ''}
                </p>
              )}
              {ev.primaryLocation && <p className="text-gray-600">{ev.primaryLocation}</p>}
              {ev.description && <p className="text-gray-600">{ev.description}</p>}
              <p className="text-gray-500">
                {ev.countyName ?? ev.regionName ?? ''} · Severity: {ev.severity}
              </p>
              <p className="text-gray-500">Обновлено: {formatDate(ev.lastUpdatedAt)}</p>
              {ev.plannedEndAt && <p className="text-gray-500">Плановое завершение: {formatDate(ev.plannedEndAt)}</p>}
              <p className="text-gray-400 text-xs">Источник: 511NY, ID {ev.id}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

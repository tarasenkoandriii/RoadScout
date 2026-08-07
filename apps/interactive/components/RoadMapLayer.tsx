'use client';

import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LandingSnapshotIncident } from '../lib/landing-snapshot.types';

// За прямим запитом користувача — "необходимо добавить еще карту дорог которую можно взять из
// blob". У проєкті вже є робоче Vercel Blob Storage (apps/api, пакет @vercel/blob,
// BLOB_READ_WRITE_TOKEN) — але єдині дорожні дані, що там реально зберігаються
// (`btw-tiles/<citySlug>/streets.json`, apps/api/src/btw/tile-format.ts), це розріджена хмара
// точок з азимутами вулиць для евристики розпізнавання камер (azimuth-heuristic.service.ts),
// БЕЗ ліній/полігонів доріг і НЕ гарантовано згенерована для довільного міста відвідувача
// лендингу — намалювати з цього справжню карту доріг неможливо. Тому — той самий підхід, що вже
// прийнятий в apps/admin/apps/btw для реальних карт (SituationalMap.tsx/NyTrafficMap.tsx):
// react-leaflet + публічні растрові тайли OpenStreetMap, без ключа/токена.
//
// НА ВІДМІНУ від WindyWidget.tsx (повноцінний iframe із власною картою всередині, тому шари
// перемикаються, а не накладаються — див. коментар у CityMapPanel.tsx) це СПРАВЖНІЙ Leaflet
// tile-layer, тому інциденти тут дійсно МОЖНА накласти прозорим шаром маркерів ПОВЕРХ карти доріг
// — саме це й зроблено нижче.
interface Props {
  center: { lat: number; lng: number };
  incidents: LandingSnapshotIncident[];
  zoom?: number;
  heightClassName?: string;
}

// Ті самі кольори, що вже bg-warning/bg-primary в CityMapPanel.tsx/CityIncidentsMap.tsx —
// узгоджено з рештою UI цього ж лендингу (apps/interactive/tailwind.config.js).
const INCIDENT_COLOR = '#EAB308';
const SELF_COLOR = '#3B82F6';

export default function RoadMapLayer({ center, incidents, zoom = 12, heightClassName }: Props) {
  return (
    // scrollWheelZoom=false — публічна вітринна карта на лендингу, не робочий інструмент
    // адмінки: скрол коліщатком миші тут не повинен "красти" прокрутку сторінки під час
    // наведення на карту. Пінч-зум на тачскрінах лишається штатним.
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      scrollWheelZoom={false}
      className={heightClassName ?? 'h-72 w-full sm:h-80'}
    >
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <CircleMarker center={[center.lat, center.lng]} radius={7} pathOptions={{ color: SELF_COLOR, fillColor: SELF_COLOR, fillOpacity: 0.9 }} />

      {/* ⚠️ ЧЕСНО — маркери інцидентів тут навмисно БЕЗ порядкового номера (на відміну від
          схематичного радару CityIncidentsMap.tsx) — Leaflet CircleMarker не має вбудованого
          текстового лейбла без окремого divIcon-хаку з власним CSS, а клікабельний Popup з тим
          самим номером/заголовком/дистанцією — той самий патерн, що вже
          apps/admin/components/NyTrafficMap.tsx використовує для 511NY-інцидентів. */}
      {incidents.map((incident, i) => (
        <CircleMarker
          key={incident.id}
          center={[incident.lat, incident.lng]}
          radius={9}
          pathOptions={{ color: INCIDENT_COLOR, fillColor: INCIDENT_COLOR, fillOpacity: 0.85 }}
        >
          <Popup>
            <div className="max-w-[220px] space-y-1 text-sm">
              <p className="font-semibold">
                {i + 1}. {incident.title}
              </p>
              <p className="text-gray-600">
                {incident.distanceKm.toFixed(1)} км · {incident.severity}
              </p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

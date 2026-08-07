'use client';

// За прямим запитом користувача — "инциденты отображать на карте региона". Свідомо НЕ справжня
// картографічна бібліотека (Leaflet/Mapbox тощо, як у самому мінІ-аппі `apps/btw`) — тут немає
// тайлів вулиць, лише відносне положення інцидентів навколо відвідувача, тому цього достатньо і
// дешевше: той самий "радар"-підхід, що вже є в мінІ-аппі (`apps/btw/components/BtwRadar.tsx`),
// але тут повністю client-side і без реальної геометрії маршруту — просто бейринг+відстань від
// центру.
//
// ⚠️ ЧЕСНО — це НЕ мапа з вулицями/орієнтирами, а спрощена схематична візуалізація "де приблизно
// відносно вас" (напрямок + відстань). Для реальної навігаційної карти в самому лендингу немає
// сенсу — це вітрина, не інструмент планування (той лишається в мінІ-аппі).

interface IncidentLike {
  id: string;
  lat: number;
  lng: number;
  title: string;
  distanceKm: number;
}

interface Props {
  center: { lat: number; lng: number };
  incidents: IncidentLike[];
  radiusKm: number;
}

const SIZE = 220;
const CENTER = SIZE / 2;
const MAX_R = SIZE / 2 - 22; // залишає місце під підписи кілець по краю

// Стандартна формула початкового бейрингу (initial bearing) між двома точками — та сама, що
// вже документована/перевірена в apps/api/src/common/geometry.util.ts, тут — окрема, свідомо
// НЕ імпортована копія: та версія — частина серверного геометричного движка для маршрутів
// (справжня точність важлива), ця — лише для розташування крапки на візуальній схемі.
function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(from.lat);
  const phi2 = toRad(to.lat);
  const deltaLambda = toRad(to.lng - from.lng);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function project(bearing: number, distanceKm: number, radiusKm: number): { x: number; y: number } {
  const fraction = Math.min(distanceKm / Math.max(radiusKm, 1), 1);
  const r = fraction * MAX_R;
  const angleRad = ((bearing - 90) * Math.PI) / 180; // -90: 0° (північ) має бути вгорі, не праворуч
  return {
    x: CENTER + r * Math.cos(angleRad),
    y: CENTER + r * Math.sin(angleRad),
  };
}

export default function CityIncidentsMap({ center, incidents, radiusKm }: Props) {
  const rings = [radiusKm / 3, (radiusKm * 2) / 3, radiusKm];

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[260px] text-muted" role="img" aria-label="Схема розташування інцидентів відносно вашого міста">
      {rings.map((km, i) => {
        const r = ((i + 1) / rings.length) * MAX_R;
        return (
          <g key={km}>
            <circle cx={CENTER} cy={CENTER} r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
            <text x={CENTER + 4} y={CENTER - r - 2} fontSize="8" fill="currentColor" opacity="0.5" fontFamily="var(--font-mono)">
              {Math.round(km)} км
            </text>
          </g>
        );
      })}

      {/* Позначка "північ" — суто орієнтир, той самий принцип, що компас у BtwRadar.tsx мінІ-аппа. */}
      <text x={CENTER} y={CENTER - MAX_R - 8} fontSize="9" fill="currentColor" opacity="0.6" textAnchor="middle" fontFamily="var(--font-mono)">
        N
      </text>

      {/* Центр — сам відвідувач (наближено, за IP, § privacy-секція вище). */}
      <circle cx={CENTER} cy={CENTER} r="4" className="fill-primary" />
      <circle cx={CENTER} cy={CENTER} r="8" fill="none" stroke="currentColor" className="text-primary" strokeOpacity="0.4" strokeWidth="1.5" />

      {incidents.map((incident, i) => {
        const bearing = bearingDeg(center, { lat: incident.lat, lng: incident.lng });
        const { x, y } = project(bearing, incident.distanceKm, radiusKm);
        return (
          <g key={incident.id}>
            <circle cx={x} cy={y} r="8" className="fill-warning" opacity="0.9" />
            <text x={x} y={y + 3} fontSize="9" fontWeight="600" textAnchor="middle" fill="#0F172A" fontFamily="var(--font-mono)">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

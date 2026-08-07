'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildSectorPolygon, LatLng } from '../lib/geometry';

// Той самий фікс, що вже застосований в apps/admin/components/SectorMap.tsx — дефолтні
// іконки маркерів Leaflet посилаються на файли, які некоректно резолвляться під бандлінгом
// Next.js.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface MapCamera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

interface MapViewProps {
  center: LatLng;
  zoom: number;
  cameras: MapCamera[];
  // За прямим запитом користувача — панорамування мапи має реально оновлювати список камер
  // для НОВОЇ видимої області, а не залишатись прив'язаним лише до початкової точки відкриття
  // режиму. Викликається з межами поточного viewport (bbox), НЕ з "позицією користувача" —
  // сервер отримує лише область карти, куди користувач сам перемістився.
  onBoundsChange?: (bounds: { swLat: number; swLng: number; neLat: number; neLng: number }) => void;
  // За прямим запитом користувача — «маршрутизация не вызывается — ключа OpenRouteService пока
  // нет (§6.3) исправь» (doc/TZ-btw-route-planning.md §6.1): реальна лінія побудованого
  // маршруту (декодований polyline від OpenRouteService, apps/btw/app/page.tsx). Необов'язковий
  // — без нього MapView поводиться точно так само, як і раніше (превʼю без маршруту).
  route?: LatLng[];
}

// За прямим запитом користувача — "можливість пересувати мапу при натисканні двома
// пальцями". Мотивація: у Telegram WebView одним пальцем часто прив'язаний нативний жест
// (напр. swipe-to-close), тому звичайне однопальцеве панорамування карти конфліктувало б із
// ним. На МИШІ (десктоп-тестування) такого конфлікту немає — там лишаємо звичайну поведінку.
function TwoFingerPanController() {
  const map = useMap();

  useEffect(() => {
    const isTouchDevice = typeof window !== 'undefined' && 'ontouchstart' in window;
    if (!isTouchDevice) return; // десктоп/миша — без обмежень, конфлікту з жестами Telegram тут немає

    map.dragging.disable(); // за замовчуванням — панорамування одним пальцем вимкнено
    const container = map.getContainer();

    const sync = (e: TouchEvent) => {
      if (e.touches.length >= 2) map.dragging.enable();
      else map.dragging.disable();
    };

    container.addEventListener('touchstart', sync, { passive: true });
    container.addEventListener('touchend', sync, { passive: true });
    container.addEventListener('touchcancel', sync, { passive: true });
    return () => {
      container.removeEventListener('touchstart', sync);
      container.removeEventListener('touchend', sync);
      container.removeEventListener('touchcancel', sync);
    };
  }, [map]);

  return null;
}

// Синхронізує центр/масштаб мапи з пропсами при зміні перемикача масштабу (500м/1км/2км) —
// react-leaflet сам не переміщує мапу при зміні prop center/zoom після першого рендеру.
function ViewSync({ center, zoom }: { center: LatLng; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom);
  }, [map, center.lat, center.lng, zoom]);
  return null;
}

// Реальне оновлення списку камер при панорамуванні (двома пальцями) чи масштабуванні —
// без цього мапа була б статичним знімком лише навколо точки відкриття, що суперечило б
// самій ідеї "пересувати мапу" з реальною користю від цього.
function BoundsReporter({ onBoundsChange }: { onBoundsChange?: MapViewProps['onBoundsChange'] }) {
  useMapEvents({
    moveend: (e) => {
      const b = e.target.getBounds();
      onBoundsChange?.({ swLat: b.getSouth(), swLng: b.getWest(), neLat: b.getNorth(), neLng: b.getEast() });
    },
  });
  return null;
}

export default function MapView({ center, zoom, cameras, onBoundsChange, route }: MapViewProps) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      dragging={true}
      zoomControl={false}
      className="h-full w-full"
    >
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <TwoFingerPanController />
      <ViewSync center={center} zoom={zoom} />
      <BoundsReporter onBoundsChange={onBoundsChange} />

      {/* Центр мапи (позиція, з якої користувач відкрив режим карти) — НЕ надсилається на
          сервер як ідентифікована точка (див. коментар у btw.service.ts::coverage()), лише
          використовується локально для відображення й для обчислення bbox запиту. */}
      <Circle center={[center.lat, center.lng]} radius={15} pathOptions={{ color: '#3b82f6', fillOpacity: 0.6 }} />

      {route && route.length > 1 && (
        <Polyline positions={route.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#facc15', weight: 4, opacity: 0.9 }} />
      )}

      {cameras.map((cam) => {
        const polygon = buildSectorPolygon(cam);
        return (
          <React.Fragment key={cam.id}>
            <Polygon positions={polygon.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#22c55e', fillOpacity: 0.25, weight: 1 }} />
            <Marker position={[cam.lat, cam.lng]} />
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}

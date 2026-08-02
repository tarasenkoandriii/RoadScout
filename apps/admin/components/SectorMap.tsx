'use client';

import React from 'react';
import { MapContainer, TileLayer, Marker, Polygon, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildSectorPolygon, LatLng } from '../lib/geometry';

// Default Leaflet marker icons reference files that don't resolve correctly under
// Next.js bundling — patch the icon URLs once here.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface SectorMapCamera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  status?: string;
  draggable?: boolean;
}

interface SectorMapProps {
  center: LatLng;
  cameras: SectorMapCamera[];
  addressMarker?: LatLng;
  onCameraDrag?: (id: string, pos: LatLng) => void;
  heightClassName?: string;
}

const STATUS_COLOR: Record<string, string> = {
  ONLINE: '#16a34a',
  DELAYED: '#ca8a04',
  OFFLINE: '#dc2626',
  DISABLED_SECURITY: '#6b7280',
  UNKNOWN: '#2563eb',
};

export default function SectorMap({ center, cameras, addressMarker, onCameraDrag, heightClassName }: SectorMapProps) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={16} className={heightClassName ?? 'h-96 w-full rounded'}>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {addressMarker && (
        <Marker position={[addressMarker.lat, addressMarker.lng]}>
          <Popup>Искомый адрес</Popup>
        </Marker>
      )}

      {cameras.map((cam) => {
        const polygon = buildSectorPolygon(cam);
        const color = STATUS_COLOR[cam.status ?? 'UNKNOWN'] ?? STATUS_COLOR.UNKNOWN;

        return (
          <React.Fragment key={cam.id}>
            <Polygon
              positions={polygon.map((p) => [p.lat, p.lng])}
              pathOptions={{ color, fillOpacity: 0.2 }}
            />
            <Marker
              position={[cam.lat, cam.lng]}
              draggable={!!cam.draggable}
              eventHandlers={
                cam.draggable
                  ? {
                      dragend: (e) => {
                        const pos = e.target.getLatLng();
                        onCameraDrag?.(cam.id, { lat: pos.lat, lng: pos.lng });
                      },
                    }
                  : undefined
              }
            >
              <Popup>{cam.name}</Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}

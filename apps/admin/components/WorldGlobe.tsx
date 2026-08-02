'use client';

import { useEffect, useRef } from 'react';

interface CountryStat {
  countryCode: string;
  countryName: string;
  count: number;
}

// Наближені координати центру країни (lat, lng) — для розміщення точки на глобусі. Свідомо
// НЕ повний список усіх ~195 країн (немає доступу до реального geo-датасету кордонів країн у
// цій пісочниці, на відміну від проєкту ОРБІТА, звідки взято лише сам підхід — globe.gl +
// точки, розмір/колір яких залежить від кількості камер) — покриває країни, вже присутні в
// проєкті (Україна + сусідні + технологічно розвинені), плюс типовий набір великих країн для
// кращого загального вигляду глобуса. Країна без координати в цій таблиці просто не
// намальована на глобусі (але лишається видимою в табличному режимі нижче).
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  UA: [48.3794, 31.1656],
  PL: [51.9194, 19.1451],
  SK: [48.669, 19.699],
  HU: [47.1625, 19.5033],
  RO: [45.9432, 24.9668],
  MD: [47.4116, 28.3699],
  US: [37.0902, -95.7129],
  DE: [51.1657, 10.4515],
  JP: [36.2048, 138.2529],
  KR: [35.9078, 127.7669],
  SG: [1.3521, 103.8198],
  GB: [55.3781, -3.436],
  FR: [46.2276, 2.2137],
  IT: [41.8719, 12.5674],
  ES: [40.4637, -3.7492],
  CA: [56.1304, -106.3468],
  AU: [-25.2744, 133.7751],
  CN: [35.8617, 104.1954],
  IN: [20.5937, 78.9629],
  BR: [-14.235, -51.9253],
  NL: [52.1326, 5.2913],
  SE: [60.1282, 18.6435],
  NO: [60.472, 8.4689],
  FI: [61.9241, 25.7482],
  CH: [46.8182, 8.2275],
  AT: [47.5162, 14.5501],
  TR: [38.9637, 35.2433],
  IL: [31.0461, 34.8516],
  AE: [23.4241, 53.8478],
  UNKNOWN: [0, 0],
};

// Свідомо без важкої залежності від реального GeoJSON кордонів країн (choropleth-полігони, як
// у проєкті ОРБІТА могло бути) — точки на глобусі, розмір і колір яких масштабуються за
// кількістю камер, дають ту саму практичну відповідь ("де більше активності") із значно
// меншою вагою залежностей і складністю налаштування.
export default function WorldGlobe({ stats }: { stats: CountryStat[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeInstanceRef = useRef<any>(null);

  useEffect(() => {
    let disposed = false;

    import('globe.gl').then((mod) => {
      if (disposed || !containerRef.current) return;
      const Globe = mod.default;

      const maxCount = Math.max(1, ...stats.map((s) => s.count));
      const points = stats
        .filter((s) => COUNTRY_CENTROIDS[s.countryCode])
        .map((s) => {
          const [lat, lng] = COUNTRY_CENTROIDS[s.countryCode];
          return {
            lat,
            lng,
            countryName: s.countryName,
            count: s.count,
            size: 0.4 + (s.count / maxCount) * 1.6, // 0.4..2.0 — мінімальний розмір, щоб країни з 1 камерою теж було видно
            color: s.count > 0 ? `rgba(37, 99, 235, ${0.4 + (s.count / maxCount) * 0.6})` : 'rgba(156, 163, 175, 0.4)',
          };
        });

      const globe = Globe()(containerRef.current)
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .backgroundColor('rgba(0,0,0,0)')
        .pointsData(points)
        .pointLat('lat')
        .pointLng('lng')
        .pointColor('color')
        .pointRadius('size')
        .pointAltitude(0.01)
        .pointLabel((d: any) => `<div style="background:white;padding:4px 8px;border-radius:4px;color:#111;font-size:12px;">${d.countryName}: <strong>${d.count}</strong> камер</div>`)
        .width(containerRef.current.clientWidth)
        .height(520);

      globeInstanceRef.current = globe;
    });

    return () => {
      disposed = true;
      // globe.gl не надає офіційного destroy() у всіх версіях — приберемо canvas вручну, щоб
      // не накопичувались WebGL-контексти при повторному відкритті сторінки/перемиканні вкладок.
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [stats]);

  return <div ref={containerRef} className="w-full rounded border" style={{ height: 520 }} />;
}

'use client';

// За прямим запитом користувача — "карту взять у windy - сделать как в админке с теми же
// селекторами слоев". Той самий підхід, що вже apps/admin/components/WindyWidget.tsx: публічний
// iframe-embed embed.windy.com/embed2.html, без ключа API, без бекенд-інтеграції (Windy Webcams
// API з apps/api/.env.example — зовсім інша, не пов'язана фіча). Продубльовано тут, а не
// імпортовано з apps/admin, — окремі задеплоєні Next.js-проєкти без спільного пакету, той самий
// принцип, що вже прийнятий для NY_STATE_BBOX/bearingDeg() в інших файлах цього ж лендингу.
//
// НА ВІДМІНУ від apps/admin/components/WindyWidget.tsx (там компонент сам тримає власний
// horizontal-picker і useState<overlay>) — тут компонент навмисно "тупий": лише iframe, без
// власного стану. Вибір шару керується ЗОВНІ, в CityMapPanel.tsx, бо там один спільний
// перемикач шарів об'єднує Windy-шари ТА шар "Інциденти" (який Windy взагалі не знає) — двом
// незалежним стейтам вибору шару в одному UI сенсу не було б.
export type WindyOverlay = 'rain' | 'wind' | 'clouds' | 'temp' | 'radar';

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  overlay: WindyOverlay;
  heightClassName?: string;
}

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

export default function WindyWidget({ lat, lng, zoom = 8, overlay, heightClassName }: Props) {
  return (
    <iframe
      title="Windy — погода на карті"
      src={buildWindyEmbedUrl(lat, lng, zoom, overlay)}
      className={heightClassName ?? 'h-72 w-full border-0'}
      loading="lazy"
    />
  );
}

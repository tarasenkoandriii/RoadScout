// За прямим запитом користувача — "добавить значок ясно/осадки и тд" до IP-віджета.
// Свідомо ІНЛАЙН SVG-компонент, не окремі файли в public/icons/ — на відміну від навігаційних/
// приватних іконок (Icon-компонент у app/[lang]/page.tsx, mask-image підхід), тут потрібна
// композиція з кількох примітивів (сонце + хмара + опади), яку простіше й дешевше зібрати
// прямо в JSX, ніж тримати десяток окремих .svg-файлів під кожну комбінацію. Той самий
// візуальний стиль, що решта іконок проєкту: currentColor, stroke-width 2, round caps.
//
// Категорії відповідають WeatherIconKind з apps/api/src/situational/weather.service.ts —
// НЕ прямому переліку WMO weather_code (backend вже згортає ~28 кодів у ці 9 категорій, щоб
// фронтенду не тримати власну копію цієї таблиці лише заради вибору картинки).

export type WeatherIconKind = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'thunderstorm';

interface Props {
  kind: WeatherIconKind | null;
  className?: string;
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

// Стандартна "хмара" (той самий обрис, що й у поширених іконкових наборах) — переюзається у
// всіх варіантах з опадами нижче.
function CloudPath({ transform }: { transform?: string }) {
  return <path {...STROKE} transform={transform} d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />;
}

function SunRays({ cx, cy, r, rayLen }: { cx: number; cy: number; r: number; rayLen: number }) {
  // 8 промінчиків рівномірно по колу — простіше й компактніше рахувати в JS, ніж виписувати
  // 8 окремих <line> з ручними координатами.
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(angle) * (r + 1.5);
    const y1 = cy + Math.sin(angle) * (r + 1.5);
    const x2 = cx + Math.cos(angle) * (r + 1.5 + rayLen);
    const y2 = cy + Math.sin(angle) * (r + 1.5 + rayLen);
    rays.push(<line key={i} {...STROKE} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return (
    <>
      <circle {...STROKE} cx={cx} cy={cy} r={r} />
      {rays}
    </>
  );
}

export default function WeatherIcon({ kind, className = 'h-8 w-8' }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-hidden="true">
      {kind === 'clear' && <SunRays cx={12} cy={12} r={4.5} rayLen={2} />}

      {kind === 'partly-cloudy' && (
        <>
          <SunRays cx={7.5} cy={7} r={2.6} rayLen={1.4} />
          <CloudPath transform="translate(1.5, 2) scale(0.82)" />
        </>
      )}

      {kind === 'cloudy' && <CloudPath />}

      {(kind === null || kind === undefined) && <CloudPath />}

      {kind === 'fog' && (
        <>
          <CloudPath transform="translate(0, -2.5) scale(0.85)" />
          <line {...STROKE} x1="3" y1="18" x2="21" y2="18" />
          <line {...STROKE} x1="5" y1="21.5" x2="19" y2="21.5" />
        </>
      )}

      {kind === 'drizzle' && (
        <>
          <CloudPath transform="translate(0, -2) scale(0.9)" />
          <line {...STROKE} x1="9" y1="19" x2="9" y2="21" />
          <line {...STROKE} x1="15" y1="19" x2="15" y2="21" />
        </>
      )}

      {kind === 'rain' && (
        <>
          <CloudPath transform="translate(0, -2) scale(0.9)" />
          <line {...STROKE} x1="8" y1="18" x2="8" y2="22" />
          <line {...STROKE} x1="12" y1="18" x2="12" y2="22" />
          <line {...STROKE} x1="16" y1="18" x2="16" y2="22" />
        </>
      )}

      {kind === 'showers' && (
        <>
          <CloudPath transform="translate(0, -2) scale(0.9)" />
          <line {...STROKE} x1="7" y1="18" x2="5.5" y2="23" />
          <line {...STROKE} x1="12" y1="18" x2="10.5" y2="23" />
          <line {...STROKE} x1="17" y1="18" x2="15.5" y2="23" />
        </>
      )}

      {kind === 'snow' && (
        <>
          <CloudPath transform="translate(0, -2) scale(0.9)" />
          <circle cx="8" cy="19" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="12" cy="21.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="16" cy="19" r="0.9" fill="currentColor" stroke="none" />
        </>
      )}

      {kind === 'thunderstorm' && (
        <>
          <CloudPath transform="translate(0, -2.5) scale(0.9)" />
          <path {...STROKE} d="M13 15.5 10 20h3l-2 4" />
        </>
      )}
    </svg>
  );
}

// apps/api/src/scraper/providers/trafficvision-sources.ts
//
// TrafficVision.Live (https://trafficvision.live) — світовий агрегатор дорожніх камер
// (~154 000 камер, 700+ джерел, 190+ країн за власною статистикою сайту). Дослідження живого
// сайту в цій сесії (реальні мережеві запити через браузер + аналіз мінифікованого JS-бандла,
// не здогадки) показало ДВА окремих шари даних:
//
//   1. `api.trafficvision.live/internal/catalog/shards/*.json` (+ `/internal/manifest`) —
//      повний дедуплікований/геокодований каталог, що реально малює карту/грід сайту. Вимагає
//      сесії (`POST app.trafficvision.live/api/session` → далі кука/токен) — 401 без неї.
//      Це і є те, що Terms of Service сайту прямо називає "compilation copyright" і забороняє
//      масово витягувати ботами без письмового дозволу. ⚠️ НЕ ЧІПАЄМО — за прямим рішенням
//      користувача, до того ж спробу відтворити цей сесійний handshake заблокував сам
//      інструмент (класифікатор безпеки), не лише порада розробника.
//
//   2. `data.trafficvision.live/camera-data/<slug>-cameras.json` — окремий, менший шар:
//      сирі (але вже геокодовані самим TrafficVision) дампи ПО ОКРЕМИХ джерелах, без сесії.
//      ⚠️ ЧЕСНО: це НЕ загальний механізм для всіх 700+ джерел — пряма перевірка (WebFetch)
//      показала, що з навмання обраних слагів (511ny, nycdot, cotrip, jartic) кожен дає 404.
//      Реально підтверджено робочими РІВНО ці два:
//        - oktraffic — Oklahoma DOT (~400-600 камер на живому сайті)
//        - bpjt-     — Indonesia Toll Roads (BPJT, ~1058 камер)
//      Обидва завантажуються сайтом БЕЗУМОВНО на кожному завантаженні сторінки (map/grid) —
//      судячи з усього, для окремої фічі CamGuessr (гра "вгадай локацію камери"), а не як
//      загальний шлях доступу до каталогу. Інші 843 джерела бачимо ЛИШЕ як назви/лічильники
//      всередині `main-*.js` (список для UI-фільтра "search=") — самих даних під цим відкритим
//      хостом для них немає.
//
// Якщо TrafficVision колись відкриє більше джерел під цим самим `camera-data/` хостом без
// сесії — просто додати новий запис нижче, і TrafficVisionAdapter/скрипт-імпортер підхоплять
// його автоматично (жодних змін коду адаптера не потрібно).
export interface TrafficVisionSource {
  // Використовується і як частина CameraProvider.adapterKey (`trafficvision-${slug}`), і як
  // позиційний аргумент CLI-скрипта (apps/api/scripts/import-trafficvision-cameras.ts). Це
  // СЛАГ ДЖЕРЕЛА (агентства/оператора), НЕ слаг міста — camera-data влаштований по
  // джерелах/агентствах (одне джерело може охоплювати цілий штат чи цілу країну багатьма
  // містами), на відміну від City.slug цього проєкту (WebcamGuruAdapter тощо).
  slug: string;
  url: string;
  label: string;
}

export const TRAFFICVISION_SOURCES: TrafficVisionSource[] = [
  {
    slug: 'oktraffic',
    url: 'https://data.trafficvision.live/camera-data/oktraffic-cameras.json',
    label: 'Oklahoma DOT (OKTraffic)',
  },
  {
    slug: 'bpjt',
    url: 'https://data.trafficvision.live/camera-data/bpjt-cameras.json',
    label: 'Indonesia Toll Roads (BPJT)',
  },
];

export function findTrafficVisionSource(slug: string): TrafficVisionSource | undefined {
  return TRAFFICVISION_SOURCES.find((s) => s.slug === slug);
}

// provider.adapterKey -> slug ("trafficvision-oktraffic" -> "oktraffic"). Використовується і
// ScraperService.resolveAdapter(), і скриптом-імпортером.
const ADAPTER_KEY_PREFIX = 'trafficvision-';

export function adapterKeyForSlug(slug: string): string {
  return `${ADAPTER_KEY_PREFIX}${slug}`;
}

export function slugFromAdapterKey(adapterKey: string): string | null {
  return adapterKey.startsWith(ADAPTER_KEY_PREFIX) ? adapterKey.slice(ADAPTER_KEY_PREFIX.length) : null;
}

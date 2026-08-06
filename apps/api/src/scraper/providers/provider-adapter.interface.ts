export type StreamType = 'IFRAME' | 'HLS' | 'MJPEG_SNAPSHOT' | 'YOUTUBE_LIVE';

export interface RawCameraItem {
  externalId: string; // stable id/slug from source site, used for dedup
  title: string;
  sourcePageUrl: string;
  streamUrl: string;
  streamType: StreamType;
  locationText?: string; // free-text address/description, if the source provides one
  // Детермінована (не AI-угадана) підказка типу локації від самого джерела — див.
  // WindyWebcamsAdapter (категорії Windy напряму дають "пляж"/"природа"/"море" тощо, надійніше
  // за AI-класифікацію на етапі ручного ревʼю). ScraperService.processItem() використовує це,
  // якщо є, замість дефолтного OUTDOOR — адаптери без цієї інформації (webcam.guru.ua,
  // YouTube/Google-пошук) просто не заповнюють поле, поведінка не змінюється.
  suggestedLocationType?: 'OUTDOOR' | 'INDOOR' | 'NATURE';
  // Точні координати напряму від джерела (див. NycTmcAdapter — офіційний API NYC DOT віддає
  // lat/lng для кожної камери напряму, без потреби геокодити текстову назву). Коли заповнено,
  // ScraperService.processItem() використовує ЦІ координати замість виклику
  // GeocodingService.geocode() — точніше й надійніше, ніж геокодинг короткого технічного
  // опису на кшталт "WBB - 2 NOR @ ABOVE BEDFORD AVE & S 5 St", який звичайний геокодер міг би
  // розпізнати неправильно чи взагалі не розпізнати.
  suggestedLat?: number;
  suggestedLng?: number;

  // Підказка міста/країни НАПРЯМУ від джерела (додано для TrafficVisionAdapter — camera-data
  // JSON вже містить власний геокодинг TrafficVision, поле `city`/`country_code` на кожному
  // записі). ОКРЕМО від suggestedLocationType/suggestedLat — це не координати самої камери, а
  // підказка, ЯКИЙ City-рядок цього проєкту їй відповідає (якщо він взагалі є в базі).
  // ScraperService.processItem() намагається знайти ТОЧНИЙ (case-insensitive) збіг
  // City.name+City.countryCode і, якщо знаходить, використовує його cityId ДЛЯ ЦІЄЇ КОНКРЕТНОЇ
  // камери — замість provider.cityId (провайдера) за замовчуванням. Це потрібно тому, що
  // provider.cityId — ОДНЕ місто на весь провайдер (див. WebcamGuruAdapter/NycTmcAdapter — там
  // це коректно, бо кожен провайдер там і так одне місто), а TrafficVision-джерела (наприклад
  // bpjt — платні дороги ВСІЄЇ Індонезії, багато міст) охоплюють БАГАТО міст одним провайдером.
  // ВИПРАВЛЕНО (за прямим запитом користувача — "добавить при импорте проверку есть ли в базе
  // город провайдер и добавлять если отсутствуют"): якщо точного збігу City немає,
  // ScraperService.processItem() тепер АВТОМАТИЧНО СТВОРЮЄ новий City-рядок із цих полів (а не
  // просто лишає cityId=null, як було раніше) — див. детальний коментар безпосередньо в
  // processItem() біля виклику upsert. suggestedCountryName/suggestedRegion — додаткові поля
  // САМЕ для цього створення (region/countryName у самому City теж nullable, тому їх
  // відсутність не блокує створення міста, лише лишає ці колонки порожніми).
  // Адаптери, що не задають ці поля (усі, крім TrafficVisionAdapter), поводяться РІВНО як
  // раніше — provider.cityId і далі використовується без змін, нових City не створюється.
  suggestedCityName?: string;
  suggestedCountryCode?: string;
  suggestedCountryName?: string;
  suggestedRegion?: string;
}

// diagnostics — см. doc/TZ-parser-import-improvements.md, П0.1: адаптер сообщает, какая именно
// селекторная стратегия сработала (или что ни одна не сработала) — ScraperService пишет это в
// ImportLogEntry (стадия FETCH_PAGE), чтобы отличить "источник реально пуст" от "вёрстка
// источника изменилась и селекторы больше не совпадают", не читая серверные логи руками.
export interface DiscoverResult {
  items: RawCameraItem[];
  diagnostics?: Record<string, unknown>;
}

export interface ProviderAdapter {
  discover(): Promise<DiscoverResult>;

  // Необязательный второй шаг для источников с двухфазной структурой (страница-список без
  // потока/адреса, затем отдельная страница на каждую камеру — см. WebcamGuruAdapter,
  // подтверждено реальным HTML: doc/AUDIT-webcam-guru-real-html.md). ScraperService вызывает
  // его ПОСЛЕ проверки бюджета времени на каждой итерации цикла — то есть дозапрос страницы
  // конкретной камеры естественно попадает под уже существующий P3.2-бюджет прохода, а не
  // делается одним большим блоком внутри discover() до того, как этот бюджет вообще успевает
  // сработать (реальный инцидент, из-за которого это и появилось — см. тот же аудит-файл).
  //
  // Адаптеры, которые уже отдают полностью готовые RawCameraItem из discover() (streamUrl и
  // т.д. заполнены сразу), этот метод не реализуют вовсе — ScraperService учитывает его
  // отсутствие и просто использует item как есть.
  fetchDetails?(item: RawCameraItem): Promise<Partial<Pick<RawCameraItem, 'title' | 'streamUrl' | 'streamType' | 'locationText'>> | null>;

  // Необязательный фильтр релевантности (см. doc/TZ-youtube-camera-discovery.md, П3) — для
  // источников, где текстовый поиск даёт много нерелевантного шума (например, поиск по
  // YouTube: новости/игровые стримы/музыка вперемешку с настоящими городскими камерами, в
  // отличие от webcam.guru.ua, где каждая запись на странице города гарантированно камера).
  // ScraperService вызывает это ТОЛЬКО для новых (ещё не существующих в CameraSourceRaw)
  // элементов, под тем же бюджетом времени, что и fetchDetails() — если возвращает false,
  // элемент вообще не попадает в очередь ревью (не тратит место в NEEDS_REVIEW шумом).
  // Адаптеры, где источник и так гарантированно релевантен (webcam.guru.ua), этот метод не
  // реализуют — ScraperService считает отсутствие метода как "всегда релевантно".
  isRelevant?(item: RawCameraItem): Promise<boolean>;
}

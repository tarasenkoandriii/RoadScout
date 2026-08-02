import axios from 'axios';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { RegistryProxyService } from '../proxy/registry-proxy.service';

// NYC DOT Real Time Traffic Information (RTTI) — реальний, безкоштовний, публічний API без
// ключа, знайдений і підтверджений користувачем напряму (https://webcams.nyctmc.org/cameras-list).
// Структура ендпоінтів звірена з незалежними джерелами (технічний блог-пост зі скрапінгу цього
// самого API, https://wttdotm.com/blog/tcpb_part_2.html, і відкритий репозиторій
// github.com/wttdotm/traffic_cam_photobooth з реальним прикладом JSON-відповіді) — не
// офіційна документація як така (NYC DOT її публічно не веде для цього ендпоінту), тому перед
// продакшеном варто перевірити один живий виклик (той самий принцип, що вже застосований для
// webcam.guru.ua/Windy — див. клас-коментарі там).
//
// GET https://webcams.nyctmc.org/api/cameras — масив ВСІХ камер міста одним запитом (сотні
// записів), кожна з полями id/name/latitude/longitude/area/isOnline/imageUrl. Жодного ключа,
// жодної пагінації, жодного відомого ліміту квоти — тому, на відміну від YouTube/Grok-джерел,
// цей адаптер НЕ виключений з загального run-all() (див. ScraperService/ScraperController) і
// може ганятися на тому самому частому розкладі, що webcam.guru.ua.
//
// streamUrl — пряме посилання на JPEG-знімок (`/api/cameras/{id}/image`, оновлюється що
// ~2 секунди за спостереженнями спільноти), не iframe/HLS — тому `streamType: MJPEG_SNAPSHOT`
// (значення вже існує в enum StreamType, тут просто перший реальний адаптер, що його
// використовує).
const CAMERAS_URL = 'https://webcams.nyctmc.org/api/cameras';

// Таймаут запиту — окрема env-змінна (реальний знайдений інцидент: жорстко закодовані 20с
// призвели до timeout у продакшені користувача — тепер налаштовується, без потреби міняти код,
// поки з'ясовується справжня причина повільності: сам сайт, мережа сервера, чи VPN-проксі).
function getRequestTimeoutMs(): number {
  const v = parseInt(process.env.NYCTMC_REQUEST_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 20000;
}

interface NycTmcCamera {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  area?: string; // NYC borough — Manhattan/Brooklyn/Queens/Bronx/Staten Island
  isOnline?: string | boolean; // API реально віддає рядок "true"/"false", не boolean
  imageUrl?: string;
}

export class NycTmcAdapter implements ProviderAdapter {
  constructor(private readonly registryProxy?: RegistryProxyService) {}

  async discover(): Promise<DiscoverResult> {
    // ВАЖЛИВО (реальний знайдений інцидент — див. doc/AUDIT-nyctmc-adapter.md, розділ
    // "Оновлення"): цей запит спершу НЕ мав заголовка User-Agent взагалі, на відміну від
    // УСІХ інших адаптерів проєкту (webcam-guru/google-web-camera-search/aggregator-discovery
    // всі явно ставлять описовий User-Agent) — дефолтний User-Agent axios ("axios/1.x.x") є
    // поширеним сигналом для WAF/бот-захисту багатьох сайтів (включно з деякими державними),
    // через що запит міг тихо відхилятися чи повертати інший вміст замість реального JSON.
    const fetchOne = (axiosConfig: object) =>
      axios.get(CAMERAS_URL, {
        ...axiosConfig,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadScoutBot/1.0; +https://roadscout.example/bot)', Accept: 'application/json' },
        timeout: getRequestTimeoutMs(),
        validateStatus: () => true,
      });

    const viaVpn = !!this.registryProxy?.isConfigured();

    try {
      const res = this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : await fetchOne({});

      if (res.status !== 200) {
        return { items: [], diagnostics: { reason: `NYC TMC API вернул статус ${res.status}.`, responseSnippet: this.snippetOf(res.data) } };
      }

      // Розширена діагностика (реальний знайдений інцидент — попередня версія при
      // "status 200, але не масив" просто мовчки поверталась із foundCount: 0, невідрізнюваним
      // від "джерело реально не має камер" — тепер явно вказуємо причину.
      if (!Array.isArray(res.data)) {
        return {
          items: [],
          diagnostics: {
            reason: `NYC TMC API вернул статус 200, но тело ответа — не массив (получили ${typeof res.data}). Возможно, запрос заблокирован защитой сайта (WAF/CAPTCHA) и вместо JSON вернулась HTML-страница, либо изменилась структура ответа API.`,
            responseSnippet: this.snippetOf(res.data),
          },
        };
      }

      const cameras: NycTmcCamera[] = res.data;
      const withoutCoords = cameras.filter((c) => !c.id || typeof c.latitude !== 'number' || typeof c.longitude !== 'number').length;
      const items: RawCameraItem[] = cameras
        .filter((c) => !!c.id && typeof c.latitude === 'number' && typeof c.longitude === 'number')
        .map((c) => this.toRawCameraItem(c));

      if (items.length === 0 && cameras.length > 0) {
        // Реально отримали масив, він не порожній, але ЖОДЕН елемент не пройшов фільтр —
        // явно інша причина, ніж "джерело порожнє", варта окремого пояснення.
        return {
          items: [],
          diagnostics: {
            reason: `NYC TMC API вернул ${cameras.length} записей, но ни один не содержит валидных id/latitude/longitude — возможно, изменилась структура полей ответа API.`,
            sampleRecord: cameras[0],
          },
        };
      }

      return { items, diagnostics: { foundCount: items.length, totalReturned: cameras.length, filteredOutMissingCoords: withoutCoords } };
    } catch (err) {
      const message = (err as Error).message;
      this.logger_warn(message);
      // Реальний знайдений інцидент — таймаут замість блокування/зміни структури. Явно
      // вказуємо, чи запит ішов через VPN-проксі (частий кандидат на причину повільності,
      // якщо сам сайт у браузері відповідає швидко), і поточне значення таймауту, щоб не
      // здогадуватись наосліп при читанні одного лише повідомлення про помилку.
      const isTimeout = /timeout/i.test(message);
      return {
        items: [],
        diagnostics: {
          reason: `Ошибка запроса к NYC TMC API: ${message}`,
          viaVpnProxy: viaVpn,
          timeoutMs: getRequestTimeoutMs(),
          hint: isTimeout
            ? viaVpn
              ? 'Таймаут при запросе ЧЕРЕЗ VPN-прокси (REGISTRY_SCAN_PROXY_URL) — попробуйте временно отключить прокси (очистить эту переменную) и повторить запуск, чтобы понять, прокси ли тому причиной, или сам сайт/сеть сервера.'
              : 'Таймаут при ПРЯМОМ запросе (VPN-прокси не настроен/не использовался) — проверьте, доступен ли webcams.nyctmc.org с сервера напрямую (например, curl -v с сервера), возможна блокировка на уровне сети/файрвола сервера, а не самого сайта.'
            : undefined,
        },
      };
    }
  }

  // Обрізаний фрагмент відповіді для журналу — не весь HTML/JSON (може бути дуже великим),
  // досить, щоб адмін одразу побачив "це схоже на HTML-заглушку" чи "це JSON іншої форми".
  private snippetOf(data: unknown): string {
    const asString = typeof data === 'string' ? data : JSON.stringify(data);
    return asString.length > 300 ? `${asString.slice(0, 300)}…` : asString;
  }

  // Фаза 2 (fetchDetails) тут не потрібна — /api/cameras уже дає повний набір полів (включно з
  // готовим imageUrl і точними координатами) за один виклик.

  private toRawCameraItem(c: NycTmcCamera): RawCameraItem {
    const streamType: StreamType = 'MJPEG_SNAPSHOT';
    const streamUrl = c.imageUrl || `${CAMERAS_URL}/${c.id}/image`;
    const title = c.name || `NYC TMC camera ${c.id}`;
    const locationText = c.area ? `${title}, ${c.area}, New York` : `${title}, New York`;

    return {
      externalId: String(c.id),
      title,
      sourcePageUrl: `https://webcams.nyctmc.org/cameras-list?camera=${c.id}`,
      streamUrl,
      streamType,
      locationText,
      // Реальні координати напряму з API — обходить геокодинг тексту (див. клас-коментар
      // RawCameraItem.suggestedLat/suggestedLng), надійніше за спробу геокодити технічний
      // опис на кшталт "WBB - 2 NOR @ ABOVE BEDFORD AVE & S 5 St".
      suggestedLat: c.latitude,
      suggestedLng: c.longitude,
    };
  }

  private logger_warn(msg: string) {
    // eslint-disable-next-line no-console
    console.warn(`NycTmcAdapter: ${msg}`);
  }
}

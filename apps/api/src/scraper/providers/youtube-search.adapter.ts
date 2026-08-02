import axios from 'axios';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { GrokCameraAssistService } from '../../common/grok-camera-assist.service';
import { RegistryProxyService } from '../proxy/registry-proxy.service';

// См. doc/TZ-youtube-camera-discovery.md — окреме джерело камер (доповнення до
// webcam.guru.ua), пошук через YouTube Data API v3 `search.list`, з упором на потрібну
// географію проєкту (City.lat/City.lng). На відміну від webcam.guru.ua (кожен запис на
// сторінці міста гарантовано камера), тут пошук текстовий/геотегований — значна частка
// результатів буде шумом (новини/стріми/музика), тому isRelevant() (П3 ТЗ) — ОБОВ'ЯЗКОВИЙ
// AI-фільтр перед тим, як елемент взагалі потрапляє в CameraSourceRaw (реалізовано в
// ScraperService.processItem(), не тут — адаптер лише повідомляє провайдеру, релевантний
// елемент чи ні).

function getApiKey(): string | null {
  return process.env.YOUTUBE_DATA_API_KEY || null;
}
function getSearchRadiusKm(): number {
  const v = parseInt(process.env.YOUTUBE_SEARCH_RADIUS_KM ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25;
}
function getMaxResultsPerQuery(): number {
  const v = parseInt(process.env.YOUTUBE_SEARCH_MAX_RESULTS ?? '', 10);
  return Number.isFinite(v) && v > 0 && v <= 50 ? v : 50;
}

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

export class YoutubeSearchAdapter implements ProviderAdapter {
  // Один екземпляр адаптера обслуговує одне місто (той самий принцип, що WebcamGuruAdapter) —
  // назва потрібна для тексту запиту, координати — для гео-фільтра search.list.
  constructor(
    private readonly cityName: string,
    private readonly cityLat: number,
    private readonly cityLng: number,
    private readonly grokAssist: GrokCameraAssistService,
    // VPN ("VPN уже есть в проекте" — тот же RegistryProxyService, что уже использует
    // WebcamGuruAdapter, см. класс-комментарий там же). Google API зазвичай не блокує звичайні
    // запити по IP так, як деякі окремі сайти, — але тримати той самий, уже перевірений
    // механізм (з автоматичним фолбеком на прямий запит, якщо VPN недоступний) послідовно для
    // всіх зовнішніх джерел дешевше й безпечніше, ніж вирішувати для кожного окремо.
    private readonly registryProxy?: RegistryProxyService,
    // Розширення на будь-яку країну (див. запит користувача: "почати збір даних по камерах по
    // всьому світу"), не тільки Україну — City.countryCode вже підтримує це.
    private readonly countryCode: string = 'UA',
  ) {}

  async discover(): Promise<DiscoverResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { items: [], diagnostics: { reason: 'YOUTUBE_DATA_API_KEY не настроен — источник пропущен.' } };
    }

    // Дворівневий запит (див. ТЗ, П1): гео-фільтр (тільки геотеговані відео, точніше) +
    // текстовий пошук без гео (ширше покриття, більше шуму — isRelevant() відфільтрує далі).
    const [geoItems, textItems] = await Promise.all([
      this.searchOnce(apiKey, {
        location: `${this.cityLat},${this.cityLng}`,
        locationRadius: `${getSearchRadiusKm()}km`,
      }),
      this.searchOnce(apiKey, {}),
    ]);

    // Дедуплікація за videoId — одне й те саме відео могло знайтись в обох запитах.
    const byVideoId = new Map<string, RawCameraItem>();
    for (const item of [...geoItems, ...textItems]) {
      if (!byVideoId.has(item.externalId)) byVideoId.set(item.externalId, item);
    }

    return {
      items: [...byVideoId.values()],
      diagnostics: { geoCount: geoItems.length, textCount: textItems.length, cityName: this.cityName },
    };
  }

  // Фаза 2 (fetchDetails) тут не потрібна — search.list з part=snippet уже дає повний набір
  // полів (title, videoId) за один виклик, на відміну від webcam.guru.ua (див. ТЗ, П2).

  // AI-фільтр релевантності (див. ТЗ, П3) — викликається ScraperService лише для нових
  // елементів, під бюджетом часу. Один текстовий Grok-виклик на елемент (не vision — тільки
  // назва відео/каналу, зображення тут не потрібне).
  async isRelevant(item: RawCameraItem): Promise<boolean> {
    return this.grokAssist.isLikelyCityCamera(item.title);
  }

  private async searchOnce(apiKey: string, extraParams: Record<string, string>): Promise<RawCameraItem[]> {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      eventType: 'live',
      // Пошук кількома варіантами формулювання одразу (оператор "|" — логічне АБО в q, див.
      // документацію search.list). Для UA — українською й англійською (як і було); для інших
      // країн — англійською (найбільш універсально для "технологічно розвинених країн", див.
      // запит користувача про світове розширення).
      q: this.countryCode === 'UA'
        ? `веб камера ${this.cityName}|webcam ${this.cityName}|онлайн трансляция ${this.cityName}`
        : `live webcam ${this.cityName}|live camera ${this.cityName}|traffic cam ${this.cityName}`,
      regionCode: this.countryCode,
      relevanceLanguage: this.countryCode === 'UA' ? 'uk' : 'en',
      maxResults: String(getMaxResultsPerQuery()),
      key: apiKey,
      ...extraParams,
    });

    const url = `${SEARCH_URL}?${params.toString()}`;
    const fetchOne = (axiosConfig: object) => axios.get(url, { ...axiosConfig, timeout: 15000, validateStatus: () => true });

    // Той самий механізм VPN, що вже є в проєкті (RegistryProxyService) — якщо
    // REGISTRY_SCAN_PROXY_URL не налаштований, працює прямим запитом як і раніше; якщо
    // налаштований, але сам недоступний ("VPN не подключён"), автоматично падає назад на
    // прямий запит, не падаючи взагалі.
    const res = this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : await fetchOne({});

    // Квота вичерпана — див. ТЗ: "чітка обробка 403 quotaExceeded — зупинка проходу з
    // поясненням у журналі, не краш". Кидаємо явну помилку — вже існуючий catch() у
    // ScraperService.runForProvider() коректно позначає прохід FAILED з цим повідомленням,
    // нічого додатково писати не треба (перевірено раніше в цьому ж коді на реальному
    // інциденті з fov_polygon — той самий принцип "не ковтати помилку мовчки").
    if (res.status === 403) {
      throw new Error(`YouTube Data API вернул 403 (вероятно, дневная квота исчерпана) для города "${this.cityName}".`);
    }
    if (res.status !== 200) {
      return [];
    }

    const rawItems: YoutubeSearchItem[] = res.data?.items ?? [];
    return rawItems
      .filter((it) => !!it.id?.videoId)
      .map((it) => {
        const videoId = it.id!.videoId!;
        const title = it.snippet?.title ?? `YouTube Live — ${this.cityName}`;
        return {
          externalId: videoId,
          title,
          sourcePageUrl: `https://www.youtube.com/watch?v=${videoId}`,
          streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
          streamType: 'YOUTUBE_LIVE' as StreamType,
          locationText: title,
        };
      });
  }
}

import axios from 'axios';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { RegistryProxyService } from '../proxy/registry-proxy.service';

// Windy Webcams API v3 (див. запит користувача: "добавить поддержку камер и апи windy.com
// (взамен українського guru)") — реальна, структурована база вебкамер по всьому світу з
// офіційним API, на відміну від текстового пошуку (YouTube/Google) — тут кожен запис
// гарантовано справжня камера з готовою геолокацією, без потреби в AI-фільтрі релевантності.
//
// NOTE (чесно, за встановленою конвенцією проєкту): точні назви полів відповіді й параметр
// геопошуку ("nearby") звірені з публічною документацією (https://api.windy.com/webcams/docs,
// https://api.windy.com/webcams/version-transfer) станом на момент реалізації, БЕЗ реального
// тестового виклику (немає мережі в цій пісочниці) — перед продакшеном варто звірити один
// живий виклик проти актуальної документації, як і для webcam.guru.ua свого часу (див.
// doc/AUDIT-webcam-guru-real-html.md).
//
// Категорії Windy дають ДЕТЕРМІНОВАНУ (не AI-угадану) класифікацію "природа/пляж/море" —
// див. doc/AUDIT-windy-webcams-and-nature-cameras.md.
const NATURE_CATEGORY_KEYWORDS = ['beach', 'sea', 'coast', 'nature', 'mountain', 'landscape', 'lake', 'forest', 'ocean', 'harbour', 'harbor'];

function getApiKey(): string | null {
  return process.env.WINDY_WEBCAMS_API_KEY || null;
}
function getSearchRadiusKm(): number {
  const v = parseInt(process.env.WINDY_SEARCH_RADIUS_KM ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25;
}
function getMaxResults(): number {
  const v = parseInt(process.env.WINDY_MAX_RESULTS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 50;
}

const WEBCAMS_URL = 'https://api.windy.com/webcams/api/v3/webcams';

interface WindyWebcam {
  webcamId?: string | number;
  title?: string;
  location?: { city?: string; region?: string; country?: string; latitude?: number; longitude?: number };
  categories?: { id?: string; name?: string }[];
  player?: { live?: { embed?: string }; day?: { embed?: string } };
  urls?: { detail?: string };
}

export class WindyWebcamsAdapter implements ProviderAdapter {
  constructor(
    private readonly cityName: string,
    private readonly cityLat: number,
    private readonly cityLng: number,
    private readonly registryProxy?: RegistryProxyService,
  ) {}

  async discover(): Promise<DiscoverResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { items: [], diagnostics: { reason: 'WINDY_WEBCAMS_API_KEY не настроен — источник пропущен.' } };
    }

    const params = new URLSearchParams({
      nearby: `${this.cityLat},${this.cityLng},${getSearchRadiusKm()}`,
      include: 'categories,images,location,player,urls',
      lang: 'uk',
      limit: String(getMaxResults()),
    });

    const fetchOne = (axiosConfig: object) =>
      axios.get(`${WEBCAMS_URL}?${params.toString()}`, {
        ...axiosConfig,
        headers: { 'x-windy-api-key': apiKey },
        timeout: 15000,
        validateStatus: () => true,
      });

    try {
      const res = this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : await fetchOne({});

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Windy Webcams API вернул ${res.status} — проверьте WINDY_WEBCAMS_API_KEY.`);
      }
      if (res.status !== 200) {
        return { items: [], diagnostics: { reason: `Windy Webcams API вернул статус ${res.status}.` } };
      }

      const webcams: WindyWebcam[] = res.data?.webcams ?? res.data?.result?.webcams ?? [];
      const items: RawCameraItem[] = webcams
        .filter((w) => w.webcamId != null)
        .map((w) => this.toRawCameraItem(w));

      return { items, diagnostics: { foundCount: items.length, cityName: this.cityName } };
    } catch (err) {
      if ((err as Error).message.includes('WINDY_WEBCAMS_API_KEY')) throw err;
      this.logger_warn((err as Error).message);
      return { items: [], diagnostics: { reason: `Ошибка запроса к Windy Webcams API: ${(err as Error).message}` } };
    }
  }

  // Фаза 2 (fetchDetails) тут не потрібна — Windy вже дає готовий embed-плеєр (player.live.embed)
  // за один виклик, на відміну від webcam.guru.ua (двофазний HTML-скрапінг).

  private toRawCameraItem(w: WindyWebcam): RawCameraItem {
    const externalId = String(w.webcamId);
    const title = w.title || `Windy webcam ${externalId}`;
    const streamUrl = w.player?.live?.embed || w.player?.day?.embed || w.urls?.detail || '';
    const streamType: StreamType = streamUrl.includes('windy.com') || streamUrl ? 'IFRAME' : 'IFRAME';
    const locationText = [w.location?.city, w.location?.region, w.location?.country].filter(Boolean).join(', ') || title;

    return {
      externalId,
      title,
      sourcePageUrl: w.urls?.detail || streamUrl || `https://www.windy.com/webcams/${externalId}`,
      streamUrl,
      streamType,
      locationText,
      // Категорії Windy — детермінована класифікація NATURE (не AI-здогадка), див. клас-
      // коментар вище. isRelevant() тут не потрібен (Windy — вже курована база реальних камер,
      // не вільний текстовий пошук), тому ScraperService.processItem() одразу створює
      // CameraSourceRaw, а не викликає AI-фільтр релевантності.
      suggestedLocationType: this.isNatureCategory(w.categories ?? []) ? 'NATURE' : 'OUTDOOR',
    } as RawCameraItem;
  }

  private isNatureCategory(categories: { id?: string; name?: string }[]): boolean {
    return categories.some((c) => {
      const text = `${c.id ?? ''} ${c.name ?? ''}`.toLowerCase();
      return NATURE_CATEGORY_KEYWORDS.some((kw) => text.includes(kw));
    });
  }

  private logger_warn(msg: string) {
    // eslint-disable-next-line no-console
    console.warn(`WindyWebcamsAdapter: ${msg}`);
  }
}

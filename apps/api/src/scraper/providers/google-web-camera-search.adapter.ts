import axios from 'axios';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { GrokCameraAssistService } from '../../common/grok-camera-assist.service';
import { RegistryProxyService } from '../proxy/registry-proxy.service';

// Пошук ОКРЕМИХ камер через Google (веб-пошук, див. запит користувача: "додати пошук через
// Google з VPN окремо самих камер, окремо сайтів агрегаторів"). Дублює структуру
// YoutubeSearchAdapter (окремий провайдер на місто, isRelevant()-фільтр перед створенням
// CameraSourceRaw), джерело даних інше — Grok web_search tool (Google Custom Search JSON API
// закритий для нових клієнтів з 2025 — див. doc/AUDIT-google-web-search-cameras.md).
//
// ВАЖЛИВО (архітектурний нюанс, пояснений користувачу перед реалізацією): сам пошук
// виконується на СТОРОНІ СЕРВЕРІВ xAI (Grok сам робить запит до Google), не з нашого сервера —
// RegistryProxyService (VPN) до цього кроку НЕ застосовний. VPN використовується окремо —
// у fetchDetails() нижче, де наш сервер САМ відвідує знайдену сторінку камери, щоб спробувати
// витягти реальний embed/stream URL з її HTML (той самий двофазний підхід, що WebcamGuruAdapter).

function getMaxPageFetchBytes(): number {
  const v = parseInt(process.env.WEB_SEARCH_PAGE_FETCH_MAX_BYTES ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 500_000;
}

export class GoogleWebCameraSearchAdapter implements ProviderAdapter {
  constructor(
    private readonly cityName: string,
    private readonly grokAssist: GrokCameraAssistService,
    private readonly registryProxy?: RegistryProxyService,
    // Розширення на будь-яку країну (див. запит користувача про світове розширення) — City вже
    // має countryName для всіх не-UA міст (null для UA — див. GeocodingService).
    private readonly countryName: string = 'Украина',
  ) {}

  async discover(): Promise<DiscoverResult> {
    const found = await this.grokAssist.searchCameraPages(this.cityName, this.countryName);

    const items: RawCameraItem[] = found.map((c) => ({
      externalId: this.hashUrl(c.url),
      title: c.title,
      sourcePageUrl: c.url,
      // Плейсхолдер — реальний тип/посилання на потік визначається в fetchDetails() нижче
      // (сторінка, знайдена пошуком, зазвичай сама по собі HTML-сторінка з вбудованим
      // плеєром, не готовий stream URL — той самий принцип, що вже підтверджений на
      // webcam.guru.ua, див. doc/AUDIT-webcam-guru-real-html.md).
      streamUrl: '',
      streamType: 'IFRAME' as StreamType,
      locationText: c.title,
    }));

    return { items, diagnostics: { foundCount: found.length, cityName: this.cityName } };
  }

  // Фаза 2 — відвідуємо знайдену сторінку (наш сервер, тому VPN тут застосовний) і пробуємо
  // витягти реальний embed URL (iframe/youtube/m3u8) з її HTML. Якщо не вдалось розпізнати —
  // повертаємо саму знайдену сторінку як streamUrl (адмін розбереться на ручному ревʼю,
  // canEmbedStream()/looksEmbeddable() на фронтенді відфільтрує биті посилання).
  async fetchDetails(item: RawCameraItem): Promise<Partial<Pick<RawCameraItem, 'title' | 'streamUrl' | 'streamType' | 'locationText'>> | null> {
    try {
      const html = await this.fetchPage(item.sourcePageUrl);
      const extracted = this.extractStreamFromHtml(html);
      if (extracted) {
        return { streamUrl: extracted.streamUrl, streamType: extracted.streamType };
      }
      // Нічого розпізнати не вдалось — повертаємо саму сторінку як є (краще неідеальний, але
      // видимий адміну кандидат, ніж зовсім пропустити елемент).
      return { streamUrl: item.sourcePageUrl, streamType: 'IFRAME' };
    } catch (err) {
      return null;
    }
  }

  async isRelevant(item: RawCameraItem): Promise<boolean> {
    return this.grokAssist.isLikelyCityCamera(item.title);
  }

  private async fetchPage(url: string): Promise<string> {
    const fetchOne = (axiosConfig: object) =>
      axios.get(url, {
        ...axiosConfig,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadScoutBot/1.0)' },
        timeout: 15000,
        maxContentLength: getMaxPageFetchBytes(),
        responseType: 'text',
      });

    const res = this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : await fetchOne({});
    return typeof res.data === 'string' ? res.data : '';
  }

  private extractStreamFromHtml(html: string): { streamUrl: string; streamType: StreamType } | null {
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
      const src = iframeMatch[1];
      if (/youtube\.com|youtu\.be/i.test(src)) return { streamUrl: src, streamType: 'YOUTUBE_LIVE' };
      return { streamUrl: src, streamType: 'IFRAME' };
    }
    const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (m3u8Match) return { streamUrl: m3u8Match[0], streamType: 'HLS' };

    return null;
  }

  private hashUrl(url: string): string {
    // Простий, стабільний externalId без залежності від crypto — досить для дедуплікації
    // (той самий рядок завжди дає той самий externalId).
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = (hash << 5) - hash + url.charCodeAt(i);
      hash |= 0;
    }
    return `websearch_${Math.abs(hash)}`;
  }
}

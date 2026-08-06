import axios from 'axios';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { RegistryProxyService } from '../proxy/registry-proxy.service';

// TrafficVision.Live (https://trafficvision.live) — див. повне дослідження й обґрунтування
// вибору саме ЦЬОГО шару даних у providers/trafficvision-sources.ts (клас-коментар там) і
// doc/AUDIT-trafficvision-parser.md. Коротко: сайт має 700+ джерел камер, але БЕЗ авторизації
// (без сесійного handshake, який навмисно НЕ відтворюється — і заборонений ToS сайту, і
// заблокований інструментом розробки) відкриті РІВНО два: `oktraffic` (Oklahoma DOT) і
// `bpjt-` (платні дороги Індонезії) — обидва підтверджені реальними мережевими запитами.
//
// Формат JSON (ПІДТВЕРДЖЕНО реальними відповідями обох джерел, не документація — TrafficVision
// не публікує жодної офіційної специфікації цього ендпоінту):
//   {
//     "_metadata": {
//       cameraCount: 649, sourceUrl: "https://oktraffic.org/",         // справжній першоджерельний
//       apiEndpoints: ["https://oktraffic.org/api/CameraPoles", ...],  // державний API (окреме
//                                                                      // дослідження — АУДИТ нижче)
//       license: "... TrafficVision compilation copyright. Attribution requested for reuse.",
//       usage: { prohibited: ["Bulk downloading without permission", ...], contact: "legal@trafficvision.live" },
//       ...
//     },
//     "cameras": [{
//       id: "oktraffic-video-1103130967",       // стабільний зовнішній id — dedup-ключ
//       location: "I-44 & I-240 N",              // короткий людський орієнтир (назва камери)
//       description: "Oklahoma City, Oklahoma",
//       lat: 35.39637, lng: -97.57406,            // РЕАЛЬНІ координати — geocodingComplete:true
//       videoUrl: "https://stream.oktraffic.org/.../playlist.m3u8",  // HLS-потік
//       imageUrl: null,                            // або JPEG-знімок замість/на додачу до відео
//       feedType: "video",                         // "video" | ймовірно "image" для camera без videoUrl
//       city: "Oklahoma City", country_code: "US",  // вже геокодовано САМИМ TrafficVision
//       display_name: "Southwest Expressway, Oklahoma City, ..., United States",
//       ...
//     }, ...]
//   }
// bpjt- використовує ту саму обгортку й ту саму форму полів записів (плюс власні operator/
// section/binamargaVideoId, які тут не потрібні) — обидва джерела структурно сумісні, тому
// один парсер на обидва. ⚠️ Раніше (перша версія цього файлу) очікувала, що ВЕСЬ res.data —
// голий масив камер, без обгортки `{_metadata, cameras}` — реальний живий прогін користувача
// показав статус 200 / discoveredCount=0, бо `Array.isArray(res.data)` був false. Виправлено
// нижче в discover() — див. коментар там же за деталями й за важливим застереженням у
// _metadata.usage.prohibited щодо bulk-завантаження.
//
// Одноразовий (не двофазний) — усі потрібні поля вже є в самому списку, fetchDetails()/
// isRelevant() не потрібні (той самий принцип, що NycTmcAdapter — джерело офіційне й вже
// гарантовано релевантне, жодного шуму на кшталт YouTube-пошуку).
export class TrafficVisionAdapter implements ProviderAdapter {
  constructor(
    private readonly sourceSlug: string,
    private readonly sourceUrl: string,
    private readonly registryProxy?: RegistryProxyService,
  ) {}

  async discover(): Promise<DiscoverResult> {
    const fetchOne = (axiosConfig: object) =>
      axios.get(this.sourceUrl, {
        ...axiosConfig,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadScoutBot/1.0; +https://roadscout.example/bot)', Accept: 'application/json' },
        timeout: getRequestTimeoutMs(),
        validateStatus: () => true,
      });

    let res: { status: number; data: unknown };
    try {
      res = this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : await fetchOne({});
    } catch (err) {
      return { items: [], diagnostics: { reason: `Ошибка запроса к ${this.sourceUrl}: ${(err as Error).message}` } };
    }

    if (res.status !== 200) {
      return { items: [], diagnostics: { reason: `TrafficVision (${this.sourceSlug}) вернул статус ${res.status}.`, sourceUrl: this.sourceUrl } };
    }

    // ВИПРАВЛЕНО (реальний знайдений інцидент — живий прогін користувача, oktraffic: статус 200,
    // discoveredCount=0): попередня версія очікувала, що ВЕСЬ res.data — масив. Насправді
    // відповідь — `{ _metadata: {...}, cameras: [...] }` (перевірено WebFetch на оновленому
    // живому запиті, ОБИДВА джерела — і oktraffic, і bpjt- мають РІВНО ту саму обгортку;
    // раніше в цьому сеансі я показав користувачу "перші записи як масив" — це був артефакт
    // AI-резюмування інструменту дослідження, а не справжня коренева структура відповіді).
    //
    // ⚠️ ЧЕСНО, важливо: `_metadata` цієї відповіді МІСТИТЬ явне машиночитане застереження:
    //   "license": "... TrafficVision compilation copyright. Attribution requested for reuse.",
    //   "usage": { "prohibited": ["Bulk downloading without permission", ...],
    //              "contact": "For bulk access or API licensing, contact: legal@trafficvision.live" }
    // Це СИЛЬНІШЕ й конкретніше за загальний ToS сайту (знайдений раніше) — застереження прямо
    // в самому файлі, адресоване будь-якому автоматичному споживачу. За прямим, повторним (вже
    // втретє) поінформованим рішенням користувача — парсер і далі використовується для цих 2
    // джерел, АЛЕ `_metadata.sourceUrl`/`apiEndpoints` (справжній першоджерельний державний
    // API — oktraffic.org/bpjt.pu.go.id) окремо досліджується як довгостроковий, юридично
    // чистіший шлях замість цього (див. doc/AUDIT-trafficvision-parser.md).
    const body = res.data as unknown;
    let records: TrafficVisionRecord[] = [];
    if (Array.isArray(body)) {
      records = body as TrafficVisionRecord[];
    } else if (body && typeof body === 'object' && Array.isArray((body as { cameras?: unknown }).cameras)) {
      records = (body as { cameras: TrafficVisionRecord[] }).cameras;
    }

    if (records.length === 0) {
      return {
        items: [],
        diagnostics: {
          reason: `TrafficVision (${this.sourceSlug}) вернул статус 200, но не удалось найти непустой массив камер (ни в корне ответа, ни в поле "cameras"). Возможно, снова изменилась структура ответа — см. doc/AUDIT-trafficvision-parser.md (этот источник не документирован официально).`,
          responseTopLevelKeys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : undefined,
        },
      };
    }
    let missingId = 0;
    let missingCoords = 0;
    let missingStream = 0;

    const items: RawCameraItem[] = [];
    for (const r of records) {
      const externalId = r.id || r._key;
      if (!externalId) {
        missingId += 1;
        continue;
      }
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) {
        missingCoords += 1;
        continue;
      }

      const stream = this.resolveStream(r);
      if (!stream) {
        missingStream += 1;
        continue;
      }

      const title = r.location || r.description || `TrafficVision (${this.sourceSlug}) camera ${externalId}`;
      items.push({
        externalId,
        title,
        // Немає підтвердженої публічної сторінки конкретної камери на trafficvision.live (grid/
        // map — SPA-маршрути без адресованого посилання на один запис) — посилання на фільтр
        // пошуку за цим джерелом як найкраще доступне атрибутування.
        sourcePageUrl: `https://trafficvision.live/?search=${encodeURIComponent(this.sourceSlug)}`,
        streamUrl: stream.url,
        streamType: stream.type,
        // display_name — уже повністю геокодована людська адреса від самого TrafficVision,
        // надійніша за сирий location/description (той самий принцип, що NycTmcAdapter
        // конкатенує title+area — тут TrafficVision вже зробив цю роботу за нас).
        locationText: r.display_name || r.description || title,
        suggestedLat: r.lat,
        suggestedLng: r.lng,
        // Див. RawCameraItem.suggestedCityName — City-прив'язка поштучно (ScraperService.
        // processItem()), бо ОДНЕ це джерело охоплює багато міст/областей/країн. countryName/
        // region — додатково для АВТОСТВОРЕННЯ нового City-рядка, коли збігу немає (r.country —
        // повна назва країни англійською, наприклад "United States"/"Indonesia"; r.state —
        // область/штат, наприклад "Oklahoma", null для bpjt-записів).
        suggestedCityName: r.city || undefined,
        suggestedCountryCode: r.country_code || undefined,
        suggestedCountryName: r.country || undefined,
        suggestedRegion: r.state || undefined,
      });
    }

    return {
      items,
      diagnostics: {
        sourceSlug: this.sourceSlug,
        totalRecords: records.length,
        validItems: items.length,
        skippedMissingId: missingId,
        skippedMissingCoords: missingCoords,
        skippedMissingStream: missingStream,
      },
    };
  }

  // videoUrl (зазвичай .m3u8 — HLS) пріоритетніший за imageUrl (JPEG-знімок), коли є обидва —
  // відео інформативніше. feedType з відповіді НЕ використовуємо напряму (не підтверджено, що
  // це надійне джерело істини для обох джерел одночасно — судимо з фактичної наявності полів).
  private resolveStream(r: TrafficVisionRecord): { url: string; type: StreamType } | null {
    if (r.videoUrl) {
      const isHls = /\.m3u8(\?|$)/i.test(r.videoUrl);
      return { url: r.videoUrl, type: isHls ? 'HLS' : 'IFRAME' };
    }
    if (r.imageUrl) {
      return { url: r.imageUrl, type: 'MJPEG_SNAPSHOT' };
    }
    return null;
  }
}

interface TrafficVisionRecord {
  id?: string;
  _key?: string;
  location?: string;
  description?: string;
  lat?: number;
  lng?: number;
  videoUrl?: string | null;
  imageUrl?: string | null;
  feedType?: string;
  city?: string | null;
  country_code?: string | null;
  country?: string | null;
  state?: string | null;
  display_name?: string | null;
}

function getRequestTimeoutMs(): number {
  const v = parseInt(process.env.TRAFFICVISION_REQUEST_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 20000;
}

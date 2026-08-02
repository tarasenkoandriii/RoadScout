import axios from 'axios';
import * as cheerio from 'cheerio';
import { DiscoverResult, ProviderAdapter, RawCameraItem, StreamType } from './provider-adapter.interface';
import { RegistryProxyService } from '../proxy/registry-proxy.service';
import { decodeHtmlBuffer } from '../common/html-encoding.util';

const BASE_URL = 'https://webcam.guru.ua';

// П0.1 (см. doc/TZ-parser-import-improvements.md) — ПОДТВЕРЖДЕНО реальным HTML с живого сайта.
// Структура — двухфазная:
//
// 1) Страница города (https://webcam.guru.ua/city/{slug}/) содержит простой список:
//      <ol class="red padd"><li><a href="/city/Kiev/609/">Название</a></li>...</ol>
//    Ни ссылки на поток, ни текста адреса на этой странице нет вообще — только externalId
//    (последний сегмент пути) + название + ссылка на страницу конкретной камеры.
//
// 2) Страница отдельной камеры (https://webcam.guru.ua/city/Kiev/{id}/) содержит:
//      <h1 style="display:inline;">Веб камера {Название} {Город}</h1>
//      ...
//      <a href="http://www.youtube.com/channel/..." target="_blank">...</a>   (ссылка на поток)
//    Реальный адрес/ориентир отдельным полем НЕ существует — название камеры на этом сайте и
//    есть человекочитаемый ориентир, используем очищенный заголовок и как title, и как
//    locationText.
//
// ВАЖНО (см. doc/AUDIT-webcam-guru-real-html.md — реальный инцидент, не гипотеза): в первой
// версии этого фикса фаза 2 (дозапрос страницы каждой камеры) выполнялась ЦЕЛИКОМ внутри
// discover(), одним блоком до возврата результата. На реальном проходе (Київ, 50 камер) это
// съело весь бюджет времени прохода (PARSER_RUN_TIME_BUDGET_MS) ДО того, как цикл обработки в
// ScraperService вообще успел сделать первую проверку бюджета — прогон завершался статусом
// PARTIAL с нулём обработанных камер, хотя список из 50 штук был найден корректно. Поэтому
// discover() здесь теперь делает ТОЛЬКО фазу 1 (один запрос, быстро) — фаза 2 вынесена в
// fetchDetails() и вызывается ScraperService поштучно, под уже существующей проверкой бюджета
// на каждой итерации цикла (см. ProviderAdapter.fetchDetails — там же и объяснение).
export class WebcamGuruAdapter implements ProviderAdapter {
  // citySlug — путь города на webcam.guru.ua (City.webcamGuruSlug), например "kiev". Один
  // экземпляр адаптера — на один город (см. ScraperService.resolveAdapter()).
  constructor(
    private readonly citySlug: string,
    private readonly registryProxy?: RegistryProxyService,
  ) {}

  async discover(): Promise<DiscoverResult> {
    const catalogUrl = `${BASE_URL}/city/${this.citySlug}/`;
    const listHtml = await this.fetchPage(catalogUrl);
    const listed = this.parseList(listHtml, catalogUrl);

    if (listed.length === 0) {
      return {
        items: [],
        diagnostics: {
          phase: 'list',
          reason: 'Список камер не найден (ol.red.padd пуст или отсутствует) — либо у города нет камер, либо изменилась вёрстка списка.',
          catalogUrl,
        },
      };
    }

    // Плейсхолдеры streamUrl/streamType — заполняются реально в fetchDetails() перед тем, как
    // ScraperService передаст item в processItem() (см. resolveItemDetails() там же). Пустая
    // строка (falsy), а не какое-то похожее на настоящий URL значение — так и предполагаемый
    // будущий баг ("забыли вызвать fetchDetails для этого адаптера") сразу дал бы понятную
    // ошибку валидации при попытке создать Camera с пустым streamUrl, а не тихо создал бы
    // битую запись.
    const items: RawCameraItem[] = listed.map((c) => ({
      externalId: c.externalId,
      title: c.title,
      sourcePageUrl: c.detailPageUrl,
      streamUrl: '',
      streamType: 'IFRAME' as StreamType,
    }));

    return { items, diagnostics: { phase: 'list', listedCount: items.length, catalogUrl } };
  }

  // Фаза 2 — см. комментарий класса и ProviderAdapter.fetchDetails. Заголовок камеры всегда
  // начинается с "Веб камера " — отрезаем этот префикс. Ссылка на поток — первая ссылка с
  // target="_blank", ведущая НЕ на сам guru.ua (собственные ссылки сайта такого атрибута не
  // имеют, подтверждено реальными образцами).
  async fetchDetails(item: RawCameraItem): Promise<Partial<Pick<RawCameraItem, 'title' | 'streamUrl' | 'streamType' | 'locationText'>> | null> {
    const html = await this.fetchPage(item.sourcePageUrl);
    const $ = cheerio.load(html);

    const rawTitle = $('h1').first().text().trim();
    const title = rawTitle.replace(/^веб\s*камера\s*/i, '').trim() || rawTitle;

    let streamUrl: string | undefined;
    $('a[target="_blank"]').each((_, el) => {
      if (streamUrl) return;
      const href = $(el).attr('href');
      if (href && !href.includes('guru.ua')) {
        streamUrl = href;
      }
    });

    if (!title || !streamUrl) return null;

    const streamType: StreamType = streamUrl.includes('youtube.com') ? 'YOUTUBE_LIVE' : 'IFRAME';
    // См. комментарий класса выше — на этом сайте отдельного поля "адрес" нет, название камеры
    // уже является человекочитаемым ориентиром для геокодинга.
    return { title, streamUrl, streamType, locationText: title };
  }

  private async fetchPage(url: string): Promise<string> {
    // arraybuffer, не текст — иначе axios/Node декодируют байты ответа как UTF-8 по умолчанию,
    // что даёт "кракозябры" на страницах в другой кодировке (реально найдено на живом сайте —
    // см. doc/AUDIT-webcam-guru-encoding.md). decodeHtmlBuffer() сама определяет и применяет
    // правильную кодировку (заголовок Content-Type → <meta charset> → windows-1251 по фолбэку).
    const fetchOne = (axiosConfig: object) =>
      axios
        .get<ArrayBuffer>(url, {
          ...axiosConfig,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoadScoutBot/1.0; +https://your-domain.example/bot)' },
          timeout: 15000,
          responseType: 'arraybuffer',
        })
        .then((res) => decodeHtmlBuffer(Buffer.from(res.data), (res.headers as any)?.['content-type']));

    // Прокси ("VPN") с автоматическим фоллбэком на прямой запрос — см. RegistryProxyService.
    return this.registryProxy ? (await this.registryProxy.request(fetchOne)).data : fetchOne({});
  }

  // Фаза 1 — см. комментарий класса. `ol.red.padd` — единственный список такого вида на
  // странице города (подтверждено реальным HTML).
  private parseList(html: string, catalogUrl: string): { externalId: string; title: string; detailPageUrl: string }[] {
    const $ = cheerio.load(html);
    const results: { externalId: string; title: string; detailPageUrl: string }[] = [];

    $('ol.red.padd > li > a').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      if (!href || !title) return;

      const externalId = href.split('/').filter(Boolean).pop();
      if (!externalId) return;

      results.push({ externalId, title, detailPageUrl: new URL(href, catalogUrl).toString() });
    });

    return results;
  }
}

// Register additional adapter families in ScraperService.resolveAdapter() (matched by
// CameraProvider.adapterKey prefix, same pattern as the webcam-guru branch there).

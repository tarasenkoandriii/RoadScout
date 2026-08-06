// apps/btw/lib/btwLocalScanner.ts
//
// §8.1/§4.7.5 ТЗ — клієнтський wrapper над btw-scan.worker.ts. Керує життєвим циклом Worker'а:
// завантаження тайлів (через /api/manifest + /api/tiles/*, див. серверну частину нижче в
// btw.service.ts/btw.controller.ts), і сам виклик scan(). Спроєктовано так, щоб інтеграція в
// page.tsx (§Pending Tasks цього кроку) залишалась мінімальним диффом: якщо init() повертає
// false (немає локальних тайлів для міста, стара помилка мережі, воркери не підтримуються),
// існуючий серверний шлях (`fetch('/api/scan', ...)`, вже в page.tsx) продовжує працювати БЕЗ
// ЗМІН — жодного регресу для пристроїв/міст без завантажених тайлів (§4.7.5 ТЗ: "серверний
// фолбек зберігається").

import type { ObserverPose, RankedCandidate, LatLng } from './btw-geometry-engine';
// За прямим запитом користувача — "между радар и HUD - Log, каждый запрос на сервер и каждый
// ответ отображай в этом логе" (§ networkLog.ts) — включно з ЦИМИ запитами (manifest +
// buildings.bin/cameras.json/streets.json), а не лише прямими викликами з page.tsx: саме ці
// запити раніше й пояснювали "медленно ищет кандидатов сначала" (§ AUDIT-btw-radar-m1-m2.md),
// тож бачити їхній реальний час/розмір у логу особливо корисно.
import { loggedFetch } from './networkLog';
// За прямим запитом користувача — "закешировать данные уровня города на старте мини апп на
// уровне устройства - и обновлять кеш только по необходимости" (§ детальний розбір у
// btwTileCache.ts).
import { getCachedCityTiles, putCachedCityTiles } from './btwTileCache';
import type { TileLayerVersions } from './btwTileCache';
// За прямим запитом користувача — "в логе не показывает запрос tiles - не могу сделать
// выводы" (§ детальний коментар біля logNote() у networkLog.ts): робить РІШЕННЯ init() (не
// лише самі HTTP-запити) видимими в тій самій Log-панелі мінідодатку.
import { logNote } from './networkLog';

export interface LocalScanResult {
  direct: RankedCandidate[];
  fallback: RankedCandidate[];
  target: LatLng;
  debug: {
    rawHeading: number;
    effectiveHeading: number;
    snapped: boolean;
    snappedTo: number | null;
    streetCandidatesFound: number;
    camerasInBbox: number;
    coneSurvivors: number;
    finalCandidates: number;
    headingUncertaintyDeg: number;
  };
}

// Викидається замість "зависання" промісу, коли scan() викликано знову ДО того, як попередній
// запит устиг відповісти — той самий принцип анти-race, що вже застосований у page.tsx для
// lastScanRef/sendTelemetry (тільки там — через ref+прапорець, тут — явний клас помилки, щоб
// виклик у page.tsx міг явно відрізнити "справжню помилку" від "просто застаріло, є новіший").
export class ScanSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanSupersededError';
  }
}

interface ManifestLayerRef {
  url: string;
  version: number;
}

interface BtwManifest {
  city: string;
  declination: number;
  scanMode: 'server-fallback-only' | 'local-worker';
  layers: {
    buildings: ManifestLayerRef;
    cameras: ManifestLayerRef;
    streets: ManifestLayerRef;
  } | null;
}

type WorkerAck =
  | { type: 'loadTilesAck'; ok: true; buildingCount: number; edgeCount: number; cameraCount: number; streetCount: number }
  | { type: 'loadTilesAck'; ok: false; error: string };

type WorkerScanMsg =
  | ({ type: 'scanResult'; requestId: number } & LocalScanResult)
  | { type: 'scanError'; requestId: number; error: string };

type WorkerOutgoingMsg = WorkerAck | WorkerScanMsg;

export class BtwLocalScanner {
  private worker: Worker | null = null;
  private ready = false;
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (r: LocalScanResult) => void; reject: (e: unknown) => void }>();
  private loadTilesWaiter: { resolve: (ack: WorkerAck) => void } | null = null;

  isReady(): boolean {
    return this.ready && this.worker !== null;
  }

  // Повертає false замість того, щоб кидати виняток, у БУДЬ-ЯКОМУ разі недоступності —
  // сторінка має трактувати "не готово" й "помилка" однаково: продовжувати серверним шляхом.
  async init(cityName: string): Promise<boolean> {
    if (typeof Worker === 'undefined') {
      // SSR-рендер сторінки (Next.js) або дуже старий браузер без Worker — фолбек без спроби.
      logNote('Локальный Worker не поддерживается браузером — используется серверный /api/scan', false);
      return false;
    }

    try {
      const manifestRes = await loggedFetch(`/api/manifest?city=${encodeURIComponent(cityName)}`);
      if (!manifestRes.ok) {
        logNote(`GET /api/manifest вернул ${manifestRes.status} — используется серверный /api/scan`, false);
        return false;
      }
      const manifest = (await manifestRes.json()) as BtwManifest;

      // §7.1 — доки сервер не має зібраних тайлів для цього міста (немає /btw/tiles/*
      // згенерованих скриптом — apps/api/scripts/generate-btw-tiles.ts, який я НЕ можу
      // виконати в цьому середовищі, бо потрібен живий Overpass+БД доступ), manifest.layers
      // лишається null і зберігається старий, уже перевірений сценарій.
      if (!manifest.layers) {
        // Саме ЦЕЙ випадок і був "невидимим" у Log-панелі (§ прямий запит користувача — "не
        // показывает запрос tiles, не могу сделать выводы"): тайли для міста `cityName` ще не
        // готові на сервері (getManifest() -> scanMode:'server-fallback-only') — жодного
        // запиту на buildings.bin/cameras.json/streets.json просто НЕ буде, це очікувано, а не
        // збій мережі.
        logNote(`Тайлы для города "${cityName}" ещё не готовы на сервере (layers=null) — используется серверный /api/scan`, false);
        return false;
      }

      // За прямим запитом користувача — "закешировать данные уровня города на старте мини апп
      // на уровне устройства - и обновлять кеш только по необходимости" (§ btwTileCache.ts).
      // manifest завжди запитується заново (маленький JSON) — САМЕ ВІН несе актуальну версію
      // кожного шару (`uploadedAt` останньої генерації тайлів на сервері). Якщо версія з
      // manifest збігається з тим, що вже лежить в IndexedDB на цьому пристрої — просто
      // використовуємо кешоване, БЕЗ жодного мережевого запиту на самі buildings.bin/
      // cameras.json/streets.json (це і є основна економія — саме вони важать 0.4-1.1 МБ,
      // не сам manifest).
      const versions: TileLayerVersions = {
        buildings: manifest.layers.buildings.version,
        cameras: manifest.layers.cameras.version,
        streets: manifest.layers.streets.version,
      };

      let buildingsBuf: ArrayBuffer;
      let camerasJson: unknown;
      let streetsJson: unknown;

      const cached = await getCachedCityTiles(cityName, versions);
      if (cached) {
        buildingsBuf = cached.buildingsBuf;
        camerasJson = cached.camerasJson;
        streetsJson = cached.streetsJson;
        logNote(`Тайлы города "${cityName}" взяты из локального кеша (IndexedDB) — без сети`);
      } else {
        logNote(`Тайлы города "${cityName}" не в кеше устройства — загружаются 3 файла (buildings/cameras/streets)`);
        [buildingsBuf, camerasJson, streetsJson] = await Promise.all([
          fetchArrayBuffer(manifest.layers.buildings.url),
          fetchJson(manifest.layers.cameras.url),
          fetchJson(manifest.layers.streets.url),
        ]);

        // ВАЖЛИВО: await ЦЬОГО виклику МУСИТЬ завершитись ДО того, як buildingsBuf піде в
        // transferable postMessage([buildingsBuf]) нижче — інакше transfer "нейтралізує"
        // (detached) буфер у головному потоці, і IndexedDB могла б спробувати склонувати вже
        // порожній буфер (§ детальний розбір гонки в коментарі біля putCachedCityTiles()).
        await putCachedCityTiles({ citySlug: cityName, versions, buildingsBuf, camerasJson, streetsJson });
      }

      this.worker = new Worker(new URL('../workers/btw-scan.worker.ts', import.meta.url));
      this.worker.onmessage = (ev: MessageEvent<WorkerOutgoingMsg>) => this.handleMessage(ev.data);
      this.worker.onerror = (ev) => {
        // eslint-disable-next-line no-console
        console.warn('[btwLocalScanner] worker error, disposing and falling back to server scan:', ev.message);
        logNote(`Worker упал: ${ev.message} — используется серверный /api/scan`, false);
        this.dispose();
      };

      const ack = await new Promise<WorkerAck>((resolve) => {
        this.loadTilesWaiter = { resolve };
        this.worker!.postMessage(
          { type: 'loadTiles', buildings: buildingsBuf, cameras: camerasJson, streets: streetsJson },
          [buildingsBuf],
        );
      });

      this.ready = ack.ok;
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.warn('[btwLocalScanner] loadTiles failed, falling back to server scan:', ack.error);
        logNote(`Worker не смог загрузить тайлы: ${ack.error} — используется серверный /api/scan`, false);
        this.dispose();
      } else {
        logNote(`Локальный сканер готов для "${cityName}" — переключение с сервера`);
      }
      return this.ready;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[btwLocalScanner] init failed, falling back to server scan:', err);
      logNote(`Локальный сканер не запустился: ${err instanceof Error ? err.message : String(err)} — используется серверный /api/scan`, false);
      this.dispose();
      return false;
    }
  }

  // Кидає ScanSupersededError на всі попередні незавершені виклики, якщо scan() викликано
  // знову раніше, ніж прийшла відповідь — той самий "лише останній результат має значення"
  // принцип, що вже в page.tsx для серверного шляху (там — через lastScanRef).
  scan(pose: ObserverPose, targetOverride?: LatLng): Promise<LocalScanResult> {
    if (!this.worker || !this.ready) {
      return Promise.reject(new Error('BtwLocalScanner: not ready — call init() first and check isReady()'));
    }

    for (const [id, p] of this.pending) {
      p.reject(new ScanSupersededError(`scan request ${id} superseded by a newer scan() call`));
    }
    this.pending.clear();

    const requestId = this.nextRequestId++;
    return new Promise<LocalScanResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({ type: 'scan', requestId, pose, targetOverride });
    });
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      p.reject(new Error('BtwLocalScanner disposed'));
    }
    this.pending.clear();
    this.loadTilesWaiter = null;
    this.ready = false;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private handleMessage(msg: WorkerOutgoingMsg): void {
    if (msg.type === 'loadTilesAck') {
      this.loadTilesWaiter?.resolve(msg);
      this.loadTilesWaiter = null;
      return;
    }

    const entry = this.pending.get(msg.requestId);
    if (!entry) return; // вже витіснено новішим scan() — ігноруємо застарілу відповідь

    this.pending.delete(msg.requestId);
    if (msg.type === 'scanResult') {
      entry.resolve({ direct: msg.direct, fallback: msg.fallback, target: msg.target, debug: msg.debug });
    } else {
      entry.reject(new Error(msg.error));
    }
  }
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await loggedFetch(url);
  if (!res.ok) throw new Error(`tile fetch failed: ${url} (${res.status})`);
  return res.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await loggedFetch(url);
  if (!res.ok) throw new Error(`tile fetch failed: ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

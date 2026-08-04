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
      return false;
    }

    try {
      const manifestRes = await loggedFetch(`/api/manifest?city=${encodeURIComponent(cityName)}`);
      if (!manifestRes.ok) return false;
      const manifest = (await manifestRes.json()) as BtwManifest;

      // §7.1 — доки сервер не має зібраних тайлів для цього міста (немає /btw/tiles/*
      // згенерованих скриптом — apps/api/scripts/generate-btw-tiles.ts, який я НЕ можу
      // виконати в цьому середовищі, бо потрібен живий Overpass+БД доступ), manifest.layers
      // лишається null і зберігається старий, уже перевірений сценарій.
      if (!manifest.layers) return false;

      const [buildingsBuf, camerasJson, streetsJson] = await Promise.all([
        fetchArrayBuffer(manifest.layers.buildings.url),
        fetchJson(manifest.layers.cameras.url),
        fetchJson(manifest.layers.streets.url),
      ]);

      this.worker = new Worker(new URL('../workers/btw-scan.worker.ts', import.meta.url));
      this.worker.onmessage = (ev: MessageEvent<WorkerOutgoingMsg>) => this.handleMessage(ev.data);
      this.worker.onerror = (ev) => {
        // eslint-disable-next-line no-console
        console.warn('[btwLocalScanner] worker error, disposing and falling back to server scan:', ev.message);
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
        this.dispose();
      }
      return this.ready;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[btwLocalScanner] init failed, falling back to server scan:', err);
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

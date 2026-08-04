// apps/btw/lib/networkLog.ts
//
// За прямим запитом користувача — "между радар и HUD - Log, каждый запрос на сервер и каждый
// ответ отображай в этом логе, пиши время которое занял запрос и размер ответа". Модульний
// (не React-стейт) сінглтон-масив + підписка — той самий принцип, що вже
// btwSession.ts::sessionPromise застосовує (переживає навігацію між сторінками мінідодатку,
// спільний для всього клієнтського бандла, без потреби прокидувати через React-контекст).
//
// `loggedFetch()` — тонка обгортка над `fetch()` з ІДЕНТИЧНОЮ сигнатурою й поведінкою (той
// самий `Response`, той самий кинутий виняток при мережевому збої) — просте перейменування
// `fetch(...)` -> `loggedFetch(...)` у місцях виклику (page.tsx, btwLocalScanner.ts,
// btwSession.ts, map/page.tsx), без зміни жодної іншої логіки навколо.

export interface NetworkLogEntry {
  id: number;
  time: string; // HH:MM:SS.mmm — локальний час клієнта (немає доступу до "справжнього" часу відповіді сервера)
  method: string;
  url: string; // відносний шлях (без origin) — коротше й читабельніше на маленькому екрані
  status: number | null; // null — мережевий збій ДО отримання відповіді (немає статусу взагалі)
  ok: boolean;
  durationMs: number;
  sizeBytes: number | null; // null — не вдалось визначити (§ measureResponseSize нижче)
  error: string | null;
}

// Досить для "останні кілька хвилин активного сканування" (тик /api/scan кожні ~2с, § page.tsx)
// — не росте необмежено за довгу сесію, старі записи просто випадають знизу списку.
const MAX_ENTRIES = 50;

let entries: NetworkLogEntry[] = [];
let nextId = 1;

type Listener = (entries: NetworkLogEntry[]) => void;
const listeners = new Set<Listener>();

export function subscribeNetworkLog(listener: Listener): () => void {
  listeners.add(listener);
  listener(entries); // одразу віддаємо поточний стан — новий підписник (напр. компонент щойно змонтувався) не чекає наступного запиту, щоб побачити вже накопичене
  return () => listeners.delete(listener);
}

function publish() {
  for (const l of listeners) l(entries);
}

function shortUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return u.pathname + u.search;
  } catch {
    return rawUrl;
  }
}

function nowLabel(): string {
  const d = new Date();
  return d.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function pushEntry(entry: NetworkLogEntry) {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES); // найновіші зверху, старі відкидаються
  publish();
}

// ЧЕСНО, розмір відповіді: пріоритет — заголовок `Content-Length` (typowo стоїть у відповідей
// Next.js/Node для JSON і бінарних тіл) — визначається БЕЗ читання тіла взагалі, найдешевше.
// Якщо заголовка немає — `res.clone().arrayBuffer()`: `Response.clone()` — стандартний спосіб
// прочитати тіло ДВІЧІ незалежно (клон і оригінал ділять один потік до першого читання, але
// кожен читається окремо) — сам `res`, який повертається викликачу `loggedFetch()`, лишається
// НЕ торкнутим і й далі читається його власним `.json()`/`.arrayBuffer()` як завжди.
async function measureResponseSize(res: Response): Promise<number | null> {
  const contentLength = res.headers.get('content-length');
  if (contentLength != null) {
    const n = parseInt(contentLength, 10);
    if (Number.isFinite(n)) return n;
  }
  try {
    const buf = await res.clone().arrayBuffer();
    return buf.byteLength;
  } catch {
    return null; // не мало б траплятись за нашого патерну виклику — про всяк випадок не валимось
  }
}

export async function loggedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET').toUpperCase();
  const startedAt = performance.now();
  const time = nowLabel();

  try {
    const res = await fetch(input, init);
    const durationMs = performance.now() - startedAt;
    const sizeBytes = await measureResponseSize(res);
    pushEntry({ id: nextId++, time, method, url: shortUrl(url), status: res.status, ok: res.ok, durationMs, sizeBytes, error: null });
    return res;
  } catch (err) {
    const durationMs = performance.now() - startedAt;
    pushEntry({ id: nextId++, time, method, url: shortUrl(url), status: null, ok: false, durationMs, sizeBytes: null, error: (err as Error).message });
    throw err; // поведінка для викликача НЕ змінюється — той самий кинутий виняток, що й голий fetch()
  }
}

export function formatBytes(n: number | null): string {
  if (n == null) return '?';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

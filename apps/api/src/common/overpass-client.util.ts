// apps/api/src/common/overpass-client.util.ts
//
// ВИНЕСЕНО (за прямим запитом користувача — розбір випадку, коли AI-автокалібрування камери
// повернуло "Азимут: —" без орієнтиру по дорозі): концерентна гонка по кількох Overpass-
// дзеркалах + опційна VPN-група раніше існувала ЛИШЕ в btw/tile-generation.util.ts (§ там же
// детальний розбір живого інциденту — Overpass HTTP 406/504/timeout на New York). Виявилось, що
// `AzimuthHeuristicService` (scraper/azimuth-heuristic.service.ts) — окремий, повністю
// незалежний шматок коду, що робить ТОЙ САМИЙ Overpass-запит, але СТАРИМ способом: голий
// `fetch()` до ЛИШЕ ОДНОГО ендпоінту (`overpass-api.de`), без дзеркал, без User-Agent, без
// конкурентної гонки. Це й пояснює конкретний випадок зі скріншота користувача: `roadAzimuth`
// (орієнтир "дорога йде вздовж X°/Y°", що передається в промпт AI-автокалібрування, §
// suggestAzimuthFov() у grok-camera-assist.service.ts) з великою ймовірністю прийшов `null`
// через 406/збій ЄДИНОГО ендпоінту — тому AI не отримав жодної підказки по дорозі й, не
// знайшовши NB/SB/EB/WB у назві камери, чесно повернув azimuth: null замість вигаданого числа.
//
// Замість дублювання виправлення в ДВОХ місцях (і ризику, що наступного разу хтось поправить
// лише одне) — спільна функція тут, використовується і tile-generation.util.ts, і
// azimuth-heuristic.service.ts.
import axios from 'axios';
import { RegistryProxyService } from '../scraper/proxy/registry-proxy.service';

// Той самий User-Agent, що вже tile-generation.util.ts використовував — Overpass API офіційно
// рекомендує описовий User-Agent (OSM Wiki/Fair Use policy), не браузерний спуфінг.
export const OVERPASS_USER_AGENT =
  'RoadScout-Overpass-Client/1.0 (+https://roadscout.example/bot; camera azimuth heuristic + BTW tile generation)';

// Overpass API's anti-bot "request-shape"-фільтр (§ детальний розбір у doc/AUDIT-btw-radar-
// m1-m2.md — HTTP 406 на overpass-api.de, підтверджено кількома незалежними джерелами:
// community.openstreetmap.org, cadshift.com, GitHub issue drolbr/Overpass-API#791) блокує ГОЛОВНИЙ
// інстанс незалежно від коректності запиту чи наявності User-Agent — єдиний надійний вихід —
// незалежні дзеркала (інший оператор/інша бан-база), не повторні спроби того самого ендпоінту.
const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function getOverpassEndpoints(): string[] {
  const fromEnv = process.env.OVERPASS_ENDPOINTS?.split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OVERPASS_ENDPOINTS;
}

interface OverpassAttempt {
  label: string;
  run: () => Promise<any>;
}

export interface OverpassFetchOptions {
  // Таймаут ОДНІЄЇ спроби — оскільки всі спроби йдуть ОДНОЧАСНО (не по черзі), це й є фактичний
  // ліміт часу на весь виклик. Викликач сам обирає: 60с для фонової генерації тайлів (§
  // GENERATION_TIME_BUDGET_MS у tile-generation.util.ts), кілька секунд — для інтерактивної
  // підказки в адмінці (кнопка "Автокалибровка", де довге очікування — погана UX).
  timeoutMs: number;
  maxConcurrent?: number; // за замовчуванням 5 — по одному прямому запиту на кожне дзеркало
  // Опційна "друга група" — той самий ендпоінт через VPN проекту (RegistryProxyService), інша
  // вихідна IP іноді обходить саме "request-shape"-фільтр. Якщо не передано — просто немає
  // цієї додаткової спроби (не помилка, не деградація — VPN не завжди потрібен/налаштований).
  registryProxy?: RegistryProxyService;
}

function buildOverpassAttempts(query: string, opts: OverpassFetchOptions): OverpassAttempt[] {
  const maxConcurrent = opts.maxConcurrent ?? 5;
  const endpoints = getOverpassEndpoints().slice(0, maxConcurrent);
  const attempts: OverpassAttempt[] = endpoints.map((endpoint) => ({
    label: endpoint,
    run: () =>
      axios
        .post(endpoint, query, {
          headers: { 'User-Agent': OVERPASS_USER_AGENT, 'Content-Type': 'text/plain' },
          timeout: opts.timeoutMs,
          validateStatus: (s) => s >= 200 && s < 300,
        })
        .then((res) => res.data),
  }));

  if (attempts.length < maxConcurrent && endpoints.length > 0 && opts.registryProxy?.isConfigured()) {
    const viaVpnEndpoint = endpoints[0];
    const registryProxy = opts.registryProxy;
    attempts.push({
      label: `${viaVpnEndpoint} (через VPN проекту)`,
      run: () =>
        registryProxy
          .request((axiosConfig) =>
            axios.post(viaVpnEndpoint, query, {
              ...axiosConfig,
              headers: { 'User-Agent': OVERPASS_USER_AGENT, 'Content-Type': 'text/plain' },
              timeout: opts.timeoutMs,
              validateStatus: (s) => s >= 200 && s < 300,
            }),
          )
          .then((result) => result.data.data),
    });
  }

  return attempts;
}

// Перемагає перша успішна відповідь (Promise.any) — решта просто ігноруються. Якщо провалились
// УСІ — кидається агрегована помилка з причиною кожної окремої спроби (видно в логах/UI
// викликача).
export async function fetchOverpassConcurrent(query: string, opts: OverpassFetchOptions): Promise<any> {
  const attempts = buildOverpassAttempts(query, opts);
  if (attempts.length === 0) {
    throw new Error('Overpass: нет доступных эндпоинтов (OVERPASS_ENDPOINTS пуст)');
  }

  try {
    return await Promise.any(attempts.map((a) => a.run()));
  } catch (err) {
    const reasons = err instanceof AggregateError ? err.errors : [err];
    const details = reasons
      .map((e: any, i: number) => `${attempts[i]?.label ?? '?'}: ${e?.response?.status ? `HTTP ${e.response.status}` : e?.message ?? e}`)
      .join('; ');
    throw new Error(`Overpass: все ${attempts.length} параллельных попытки провалились — ${details}`);
  }
}

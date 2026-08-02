import { Injectable, Logger } from '@nestjs/common';
import { registryScanProxyUrl } from './registry-proxy.util';

// Deliberately loose/duck-typed instead of importing axios's AxiosRequestConfig, so this file
// has no hard dependency on axios — the proxy mechanism is transport-agnostic in principle,
// even though today's only caller (WebcamGuruAdapter) happens to use axios.
export interface ProxyAxiosConfig {
  httpAgent?: unknown;
  httpsAgent?: unknown;
  proxy?: false;
}

export interface RegistryProxyResult<T> {
  data: T;
  usedProxy: boolean;
  /** true if a configured proxy failed and the request was retried directly. */
  fellBackToDirect: boolean;
}

// Network-level failures that indicate the *proxy itself* is unreachable/misconfigured
// ("VPN не подключён") — as opposed to the target site responding with its own error (4xx/5xx),
// which means the proxy DID work and retrying direct wouldn't help (and would defeat the
// point of using a proxy in the first place, e.g. to dodge an IP-based block).
const PROXY_CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'EPROTO',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isProxyConnectivityError(err: unknown): boolean {
  const e = err as any;
  if (e?.code && PROXY_CONNECTIVITY_ERROR_CODES.has(e.code)) return true;
  // Proxy auth failure (Webshare/most providers respond 407 to a bad user/pass) — also a
  // "proxy is not usable right now" condition, not a target-site error.
  if (e?.response?.status === 407) return true;
  // axios wraps a failed CONNECT tunnel (via https-proxy-agent) as a generic error without a
  // `.response` — heuristic: no HTTP response at all reached us, so nothing target-side
  // rejected the request; the failure happened before that.
  if (!e?.response && e?.request) return true;
  return false;
}

// Прокси ("VPN") для сканирования внешних реестров камер (глава: "Добавить VPN из cargo
// проекта для скана внешних реестров камер"). Порт идеи из cargo-tracker: строим прокси-агент
// один раз лениво, и КАЖДЫЙ запрос идёт через request() — если прокси настроен, но реально не
// отвечает ("VPN не подключён"), автоматически повторяем тот же запрос напрямую, а не просто
// падаем. Если прокси не настроен вовсе, всегда работает как раньше — без прокси.
@Injectable()
export class RegistryProxyService {
  private readonly logger = new Logger(RegistryProxyService.name);

  private agentsReady = false;
  private httpAgent: unknown = null;
  private httpsAgent: unknown = null;
  private proxyUrl: string | null = null;

  isConfigured(): boolean {
    return !!registryScanProxyUrl();
  }

  // Host:port only (never the credentials) — safe to show in the admin panel / logs.
  proxyHostForDisplay(): string | null {
    const url = registryScanProxyUrl();
    if (!url) return null;
    try {
      const u = new URL(url);
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return null;
    }
  }

  // Lazily builds the http(s)-proxy-agent instances (once per process). If the agent packages
  // aren't installed for some reason, disables the proxy silently and logs a warning — a
  // broken proxy dependency should degrade to "no proxy", not crash the scraper.
  private async getAgents(): Promise<{ httpAgent: unknown; httpsAgent: unknown } | null> {
    if (this.agentsReady) {
      return this.httpAgent || this.httpsAgent ? { httpAgent: this.httpAgent, httpsAgent: this.httpsAgent } : null;
    }
    this.agentsReady = true;

    const url = registryScanProxyUrl();
    this.proxyUrl = url;
    if (!url) return null;

    try {
      const [{ HttpProxyAgent }, { HttpsProxyAgent }] = await Promise.all([
        import('http-proxy-agent'),
        import('https-proxy-agent'),
      ]);
      this.httpAgent = new HttpProxyAgent(url);
      this.httpsAgent = new HttpsProxyAgent(url);
      return { httpAgent: this.httpAgent, httpsAgent: this.httpsAgent };
    } catch (err) {
      this.logger.warn(
        `REGISTRY_SCAN_PROXY_URL is set but http(s)-proxy-agent could not be loaded — running direct. (${(err as Error).message})`,
      );
      return null;
    }
  }

  // Runs `fn` once with the proxy config (if a proxy is configured), and — only if the proxy
  // itself appears to be the problem (not the target site) — retries once with no proxy at all
  // ("VPN не подключён — работаем напрямую"). If no proxy is configured, just runs `fn({})`.
  async request<T>(fn: (axiosConfig: ProxyAxiosConfig) => Promise<T>): Promise<RegistryProxyResult<T>> {
    const agents = await this.getAgents();

    if (!agents) {
      return { data: await fn({}), usedProxy: false, fellBackToDirect: false };
    }

    try {
      const data = await fn({ httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent, proxy: false });
      return { data, usedProxy: true, fellBackToDirect: false };
    } catch (err) {
      if (!isProxyConnectivityError(err)) throw err; // target site's own error — proxy worked, don't retry direct

      this.logger.warn(
        `Registry-scan proxy (${this.proxyHostForDisplay()}) unreachable — "VPN не подключён", falling back to a direct request. (${(err as Error).message})`,
      );
      const data = await fn({});
      return { data, usedProxy: false, fellBackToDirect: true };
    }
  }
}

/**
 * Прокси ("VPN") для парсера, сканирующего внешние реестры камер (webcam.guru.ua и т.п.).
 * Портировано из cargo-tracker (server/config.ts, webshareProxyUrl) — тот же Webshare backbone
 * трюк: собрать rotating-прокси URL из пары username/password, не заставляя админа вручную
 * склеивать `http://user-rotate:pass@p.webshare.io:80`.
 *
 * Зачем это вообще нужно парсеру камер (в отличие от cargo-tracker, где обходили per-IP
 * rate-limit): сайты-каталоги камер могут банить/ограничивать datacenter-IP хостинга
 * (Vercel/Docker-хоста) по географии или как "подозрительный" трафик. Ротация внешнего IP
 * снижает шанс попасть под такую блокировку при регулярных обходах реестров.
 */

function truthy(value: string | undefined, def: boolean): boolean {
  if (value === undefined) return def;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

/**
 * Собирает Webshare backbone proxy URL из удобных env-переменных. Хост backbone —
 * p.webshare.io; имя пользователя дополняется через дефис: `{username}[-{country}][-rotate]`.
 * Ротация (новый выходной IP на каждый запрос) включена по умолчанию.
 * Возвращает null, если логин/пароль не заданы.
 */
export function webshareRegistryProxyUrl(): string | null {
  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  if (!user || !pass) return null;

  const host = process.env.WEBSHARE_PROXY_HOST || 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT || '80';
  const country = (process.env.WEBSHARE_PROXY_COUNTRY || '').trim().toLowerCase();
  const rotate = truthy(process.env.WEBSHARE_PROXY_ROTATE, true);

  let u = user;
  if (country) u += `-${country}`;
  if (rotate) u += '-rotate';

  return `http://${u}:${pass}@${host}:${port}`;
}

/**
 * Итоговый URL прокси для сканирования реестров камер. Порядок приоритета (первый заданный
 * побеждает):
 *   1) REGISTRY_SCAN_PROXY_URL — полный URL, любой провайдер: http://user:pass@host:port
 *   2) Webshare-переменные (см. webshareRegistryProxyUrl выше) — удобство, не нужно
 *      склеивать URL вручную
 *   3) обычные HTTPS_PROXY / HTTP_PROXY (уже могут быть выставлены окружением/хостингом)
 * Возвращает null, если ничего не задано — в этом случае парсер просто ходит напрямую,
 * как и раньше (это не регрессия, а поведение по умолчанию без прокси).
 */
export function registryScanProxyUrl(): string | null {
  return (
    process.env.REGISTRY_SCAN_PROXY_URL ||
    webshareRegistryProxyUrl() ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

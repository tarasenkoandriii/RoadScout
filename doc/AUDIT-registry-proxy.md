# Аудит: прокси ("VPN") для сканирования внешних реестров камер

Портировано из cargo-tracker (`server/config.ts` → `webshareProxyUrl()`, undici `ProxyAgent`
в `cargoai.connector.ts`). RoadScout использует `axios`, а не `fetch`/`undici`, поэтому
транспортный слой сделан через `http-proxy-agent`/`https-proxy-agent` (axios `httpAgent`/
`httpsAgent`), а не через undici — сама идея (сборка URL из Webshare-переменных, ленивая
инициализация агента раз на процесс, отключение при отсутствии конфига) перенесена как есть.

## Что добавлено

- `src/scraper/proxy/registry-proxy.util.ts` — `webshareRegistryProxyUrl()` /
  `registryScanProxyUrl()` (порядок приоритета: `REGISTRY_SCAN_PROXY_URL` → Webshare-переменные
  → `HTTPS_PROXY`/`HTTP_PROXY`).
- `src/scraper/proxy/registry-proxy.service.ts` — `RegistryProxyService`:
  - `request(fn)` — если прокси не настроен, просто вызывает `fn({})` (без изменений в
    поведении); если настроен — пробует через прокси, и **если ошибка похожа на проблему
    самого прокси** (`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`/407/нет `response` вообще —
    "VPN не подключён"), автоматически повторяет `fn({})` напрямую. Ошибки самого целевого
    сайта (реальный HTTP-ответ 4xx/5xx) не триггерят повтор — прокси в этом случае отработал.
  - `isConfigured()` / `proxyHostForDisplay()` — для админ-эндпоинта, без утечки логина/пароля.
- `WebcamGuruAdapter` — теперь принимает `RegistryProxyService` (опционально) и прогоняет запрос
  каталога через него.
- `ScraperService`/`ScraperModule` — `RegistryProxyService` внедрён через DI; `adapters`
  переехал из field-инициализатора в тело конструктора (иначе `this.registryProxy` ещё не
  назначен на момент инициализации поля).
- `ScraperController` — `GET /admin/parser/proxy-status` (`AdminGuard`).
- `package.json` — `http-proxy-agent`, `https-proxy-agent`.
- `.env.example` (root + `apps/api`), `docker-compose.yml` — новые переменные, пусто по
  умолчанию (без прокси, поведение не меняется).

## Реально прогнанные тесты (ts-node + офлайн-стабы `@nestjs/common`/`axios`/`cheerio`/
`http(s)-proxy-agent`)

11 сценариев в одном прогоне:

1. Нет env вообще → `null`.
2. Webshare-переменные собирают ожидаемый URL (`http://abc-rotate:secret@proxy.example.com:1080`).
3. Код страны подставляется перед `-rotate`.
4. `WEBSHARE_PROXY_ROTATE=false` убирает суффикс `-rotate`.
5. `REGISTRY_SCAN_PROXY_URL` побеждает Webshare-переменные и `HTTPS_PROXY`.
6. При отсутствии явного URL используется `HTTPS_PROXY`.
7. Без настроенного прокси `request()` вызывает `fn({})` напрямую, `usedProxy`/`fellBackToDirect`
   оба `false`.
8. С рабочим прокси — `fn` получает `httpAgent`/`httpsAgent`/`proxy:false`, `usedProxy: true`.
9. **Ключевой сценарий** — прокси настроен, но первая попытка кидает `ECONNREFUSED`: `request()`
   логирует warning и повторяет `fn({})` уже без прокси-конфига, `fellBackToDirect: true`,
   второй вызов `fn` реально произошёл (`callCount === 2`).
10. Ошибка от самого целевого сайта (настоящий HTTP-ответ, `err.response.status === 404`) —
    **не** триггерит прямой повтор, ошибка просто пробрасывается дальше (`callCount === 1`).
11. `proxyHostForDisplay()` возвращает только `host:port`, без логина/пароля.

Плюс `tsc --noEmit` по всем новым/изменённым файлам scraper-модуля вместе — 0 ошибок.

## Не проверено (ограничение аудита)

- Реальное сетевое обращение через настоящий Webshare-прокси / реальный npm install
  `http-proxy-agent`/`https-proxy-agent` — в этой среде нет доступа к npm registry, стабы лишь
  дублируют публичный конструктор `new XxxProxyAgent(url)`, не реальную сетевую логику.
- Селекторы `WebcamGuruAdapter` (`.webcam-card` и т.п.) остаются placeholder'ами, как и раньше —
  это не относится к прокси-фиче и не менялось.

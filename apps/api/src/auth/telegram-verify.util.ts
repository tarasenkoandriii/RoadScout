import { createHash, createHmac } from 'crypto';

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Telegram Login Widget payloads don't expire on their own — without this check,
// a captured payload (e.g. from logs or a MITM) could be replayed indefinitely.
const MAX_AUTH_AGE_SECONDS = 86400; // 24h

// Algorithm per https://core.telegram.org/widgets/login#checking-authorization
export function verifyTelegramAuth(payload: TelegramAuthPayload, botToken: string): boolean {
  const { hash, ...fields } = payload as unknown as Record<string, unknown>;
  if (!hash || typeof hash !== 'string') return false;

  const dataCheckString = Object.keys(fields)
    .filter((key) => fields[key] !== undefined && fields[key] !== null)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return false;

  const ageSeconds = Math.floor(Date.now() / 1000) - Number(payload.auth_date);
  // Also reject payloads claiming to be from the future — a sign of a forged auth_date.
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) return false;

  return true;
}

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

// ВИПРАВЛЕНО (реальний баг, знайдений користувачем на живому пристрої — "подмена координат не
// работает и телеметрии нет"): у BTW mini-app клієнті (apps/btw) НІКОЛИ не було коду, що
// реально логінить користувача — `credentials: 'include'` сам по собі кукі не створює,
// потрібен окремий виклик, якого не існувало. BtwController.getDevLocationOverride/scan/
// telemetry й далі стоять за TelegramAuthGuard (кукі `session`), тому на реальному пристрої
// (де ADMIN-панель і BTW-міні-апп — РІЗНІ домени, кукі одного не бачить інший) усі ці виклики
// мовчки падали 401 — і override не застосовувався (falls back на реальний GPS), і
// /api/telemetry мовчки ковтав помилку (`catch {}` без логування), і /api/scan повертав
// !res.ok, що на екрані виглядає невідрізнимо від "кандидатів справді немає".
//
// §7.4 ТЗ (doc/BTW-tz.md:426) вимагає саме `X-Telegram-Init-Data` HMAC-валідацію для
// автентифікації mini-app — це ІНШИЙ алгоритм, ніж verifyTelegramAuth() вище (та функція — для
// Telegram Login Widget, окремого механізму для звичайних веб-сторінок, не для Mini Apps).
// Різниця — у виведенні секретного ключа:
//   Login Widget: secret_key = SHA256(bot_token)
//   Mini App:     secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
// (офіційна специфікація: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// Переплутати ці два алгоритми — типова помилка, яка робить перевірку мовчки завжди хибною
// (чи навпаки, вразливою) — тому явно окрема функція, а не "гілка" в існуючій verifyTelegramAuth().
const MAX_INIT_DATA_AGE_SECONDS = 86400; // 24h — той самий орієнтир, що й Login Widget вище

export function verifyTelegramWebAppInitData(initData: string, botToken: string): TelegramWebAppUser | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_INIT_DATA_AGE_SECONDS || ageSeconds < -60) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw);
    if (typeof user?.id !== 'number') return null;
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      photo_url: user.photo_url,
    };
  } catch {
    return null;
  }
}

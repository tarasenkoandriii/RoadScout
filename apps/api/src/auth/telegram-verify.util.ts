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

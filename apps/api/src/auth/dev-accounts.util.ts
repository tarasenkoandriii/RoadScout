// Локальная отладка: авто-вход во все "рабочие места" (admin/blogger/client) без реального
// Telegram Login Widget. Управляется ДВУМЯ env-переменными (см. .env.example):
//
//   DEV_AUTO_LOGIN=true            — обязательный выключатель. Если не "true" (в т.ч. если
//                                    переменная вообще не задана), весь функционал этого файла
//                                    и связанные dev-эндпоинты полностью отключены — как будто
//                                    их не существует. НИКОГДА не включать в проде.
//
//   DEV_MOCK_ACCOUNTS="role:telegramId:firstName:lastName:username:photoUrl;..."
//                                  — список мок-аккаунтов через ';'. Внутри записи поля через
//                                    ':'. role — один из admin|blogger|client. lastName/
//                                    username/photoUrl можно оставлять пустыми
//                                    (например "client:900000003:Клиент:::").
//
// Пример: см. docker-compose.yml — там оба флага уже включены для локальной разработки.

export type DevRole = 'admin' | 'blogger' | 'client';

export interface DevMockAccount {
  role: DevRole;
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

const VALID_ROLES: DevRole[] = ['admin', 'blogger', 'client'];

export function isDevAutoLoginEnabled(): boolean {
  return process.env.DEV_AUTO_LOGIN === 'true';
}

function isValidRole(value: string): value is DevRole {
  return (VALID_ROLES as string[]).includes(value);
}

// Malformed entries (missing role/telegramId/firstName, unknown role) are silently dropped
// rather than crashing the whole auth flow over a typo in a local .env file — this is a
// debug convenience feature, not something that should be able to take down the app.
export function parseDevMockAccounts(): DevMockAccount[] {
  if (!isDevAutoLoginEnabled()) return [];

  const raw = process.env.DEV_MOCK_ACCOUNTS ?? '';
  const accounts: DevMockAccount[] = [];

  for (const entry of raw.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [role, telegramId, firstName, lastName, username, photoUrl] = trimmed.split(':').map((s) => s?.trim() ?? '');

    if (!isValidRole(role) || !telegramId || !firstName) continue;

    accounts.push({
      role,
      telegramId,
      firstName,
      lastName: lastName || undefined,
      username: username || undefined,
      photoUrl: photoUrl || undefined,
    });
  }

  return accounts;
}

export function findDevMockAccount(role: string): DevMockAccount | undefined {
  return parseDevMockAccounts().find((a) => a.role === role);
}

function splitEnvIds(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Used by AuthService (for SessionUser.isAdmin) AND AdminGuard — single source of truth so
// the two can never drift out of sync. When dev auto-login is on, the mock "admin" account's
// telegramId is automatically treated as an admin too, so logging in via the dev panel just
// works without also having to hand-edit ADMIN_TELEGRAM_IDS.
export function getAdminTelegramIds(): string[] {
  const ids = splitEnvIds(process.env.ADMIN_TELEGRAM_IDS);
  const devAdmin = findDevMockAccount('admin');
  if (devAdmin && !ids.includes(devAdmin.telegramId)) ids.push(devAdmin.telegramId);
  return ids;
}

// Mirrors getAdminTelegramIds() for the "blogger" workplace. BLOGGER_TELEGRAM_IDS is a new,
// independent allowlist (a real blogger dashboard/permissions model doesn't exist yet — this
// is deliberately as minimal as ADMIN_TELEGRAM_IDS was, ready to grow later).
export function getBloggerTelegramIds(): string[] {
  const ids = splitEnvIds(process.env.BLOGGER_TELEGRAM_IDS);
  const devBlogger = findDevMockAccount('blogger');
  if (devBlogger && !ids.includes(devBlogger.telegramId)) ids.push(devBlogger.telegramId);
  return ids;
}

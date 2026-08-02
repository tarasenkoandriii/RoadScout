# Аудит: локальная отладка / авто-вход во все рабочие места

## Что добавлено

- **Три "рабочих места"** на одном Next.js-фронтенде: клиентский сайт (`/`), кабинет блогера
  (`/blogger`, новый, роль+гейт+заглушка), админка (`/admin/*`).
- **`DEV_AUTO_LOGIN`** (bool) + **`DEV_MOCK_ACCOUNTS`** (`role:telegramId:firstName:lastName:username:photoUrl`,
  записи через `;`) — включены по умолчанию в `docker-compose.yml`.
- `GET /auth/dev-accounts` / `POST /auth/dev-login` на бэкенде; плавающая dev-панель на фронте.
- `BLOGGER_TELEGRAM_IDS` + `BloggerGuard` (админы проходят и туда — иерархия прав).

## Реально прогнанные тесты (ts-node + офлайн-стабы `@nestjs/*`, `@prisma/client`, `reflect-metadata`)

1. **`dev-accounts.util.ts`** (6 сценариев): выключено по умолчанию; парсинг корректных записей;
   dev-id админа/блогера автоматически подмешивается в allowlist без дублей при пересечении с
   реальным `ADMIN_TELEGRAM_IDS`; битые записи (неизвестная роль/нет id/нет имени) отбрасываются,
   не роняя весь парсинг; при `DEV_AUTO_LOGIN` не `"true"` даже валидный `DEV_MOCK_ACCOUNTS`
   полностью игнорируется. **Все 6 — пройдены.**
2. **`AuthService`** (8 сценариев, с фейковым Prisma + `JwtService`): `devLogin` кидает 404, если
   выключено; кидает 400 на неизвестную роль; `devLogin('admin'/'blogger'/'client')` — корректный
   upsert `TelegramUser`, верные `isAdmin`/`isBlogger` для каждой роли; `getSessionUser` после
   dev-логина отдаёт те же права; `listDevAccounts()` пуст при выключенном режиме; обычный
   `loginWithTelegram` по-прежнему требует `TELEGRAM_BOT_TOKEN` (реальный флоу не задет
   рефакторингом `issueSession`). **Все 8 — пройдены.**
3. **Guards** (6 сценариев): `TelegramAuthGuard` отклоняет отсутствие токена / принимает валидный;
   `AdminGuard` отклоняет не-админа / принимает админа из `ADMIN_TELEGRAM_IDS`; `AdminGuard`
   принимает dev-мок-админа, даже если `ADMIN_TELEGRAM_IDS` пуст; `BloggerGuard` — блогер
   проходит, админ тоже проходит (иерархия), посторонний id отклоняется. **Все 6 — пройдены.**
4. **`tsc --noEmit`** по всем файлам `src/auth/*` вместе (со стабами) — 0 ошибок после исправления
   находки ниже.
5. **`tsc --noEmit --strict`** по новым/изменённым файлам фронтенда (`DevLoginPanel.tsx`,
   `AuthGate.tsx`, `app/layout.tsx`, `app/blogger/layout.tsx`, `app/blogger/page.tsx`) со
   стабами `react`/`react/jsx-runtime`/`next/link` — **0 ошибок**. Остаточные ошибки при
   расширении прогона на `app/page.tsx`/`SectorMap.tsx` — из-за отсутствия стабов
   `leaflet`/`react-leaflet`/`next/dynamic`/`React.Fragment` в моём минимальном стенде, к новым
   файлам не относятся и не проверялись подробно (не в объёме этой задачи).

## Найден и исправлен реальный (не мой) баг

`src/auth/telegram-verify.util.ts`: `payload as Record<string, unknown>` — **TS2352, настоящая
ошибка компиляции**, подтверждённая изолированным прогоном `tsc` вне зависимости от моих стабов
(TelegramAuthPayload не имеет индексной сигнатуры, поэтому прямой каст в `Record<string, unknown>`
невалиден). Это значит, что проект в текущем виде до этого исправления **не прошёл бы**
`tsc --noEmit`/`nest build`, если бы кто-то его прогнал. Похоже, это осталось незамеченным, потому
что раньше в этой среде не было возможности собрать проект целиком.

**Исправлено:** `payload as unknown as Record<string, unknown>` (двойной каст через `unknown` —
стандартный способ обойти недостаточное перекрытие типов, когда преобразование осознанное).

## Не проверено (ограничение аудита)

- Полная сборка `next build`/`nest build` в вашей среде с реальными пакетами — сделайте
  `npm install && npx tsc --noEmit` в обоих `apps/*` перед деплоем.
- `TelegramLoginButton.tsx`/`LogoutButton.tsx`/`SectorMap.tsx` не менялись в этой задаче и не
  проверялись повторно, кроме как побочно (через прогон `tsc` над файлами, которые их
  импортируют).

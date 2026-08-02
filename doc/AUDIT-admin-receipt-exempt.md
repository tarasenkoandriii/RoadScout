# Аудит: для админа не требуется квитанция («Мой дом»)

## Что добавлено

- Prisma: `HomeAddressVerification.receiptImageUrl` теперь `String?` (было обязательным) +
  новое поле `adminExempt Boolean @default(false)`.
- `HomeVerificationService.submit()` — принимает `receiptBuffer: Buffer | null` (было
  обязательным `Buffer`). Если `receiptBuffer` не передан:
  - для **админа** (`getAdminTelegramIds().includes(telegramId)`, тот же helper, что и в
    `AdminGuard`/dev-auto-login) — создаёт заявку сразу со статусом `APPROVED`,
    `adminExempt: true`, `receiptImageUrl: null`, `reviewedByTelegramId` = сам админ.
    **Ни `ReceiptStorageService.store()`, ни `ReceiptVerificationService.verify()` не
    вызываются вообще** — не просто "быстро одобряется", а буквально не обращается ни к object
    storage, ни к AI-провайдеру;
  - для **не-админа** — `BadRequestException` (защита на уровне сервиса, а не только
    контроллера — на случай, если контроллер когда-нибудь изменится и перестанет это
    гарантировать).
  - Если админ **всё же приложил** файл — заявка идёт по обычному пути (storage → AI →
    `NEEDS_REVIEW`/`APPROVED` по результату), `adminExempt` остаётся `false`. Это специально:
    админ может протестировать реальный AI-пайплайн, не будучи автоматически исключённым из
    него.
- `HomeVerificationController.submit()` — обязательность файла (`BadRequestException`, если
  файла нет) теперь пропускается для админа; для остальных не изменилась.
- `apps/admin/app/my-home/page.tsx` — подтягивает `isAdmin` из `GET /auth/me`, при `isAdmin`
  делает поле файла необязательным и меняет подсказку под формой.
- `apps/admin/app/admin/home-verifications/page.tsx` — бейдж «Админ» в списке заявок,
  в детальной карточке вместо `<img>` (когда `receiptImageUrl: null`) — пояснение
  "квитанция не требовалась".

## Реально прогнанные тесты (ts-node + офлайн-стабы)

**`HomeVerificationService.submit()`** (3 сценария, с фейковыми Prisma/Geocoding/
ReceiptVerification/ReceiptStorage/CamerasService, `ADMIN_TELEGRAM_IDS=900000001,42`):

1. Админ (telegramId `900000001`), без файла → заявка сразу `APPROVED`, `adminExempt: true`;
   **проверено счётчиками вызовов**, что `ReceiptStorageService.store()` и
   `ReceiptVerificationService.verify()` НЕ были вызваны ни разу (`called === 0` на обоих) —
   не просто "быстро прошло", а реально не обратилось ни к одной внешней зависимости;
   геокодинг при этом всё равно вызывается один раз (нужны координаты для сектора камер).
   **Пройден.**
2. Не-админ, без файла → `BadRequestException` с понятным сообщением. **Пройден.**
3. Админ (telegramId `42`), С файлом → идёт по обычному AI-пути: `store()`/`verify()`
   вызваны **по одному разу каждый** (не по нулю, не по двое — контроль от случайного
   дублирования логики), `adminExempt` не выставлен в `true`. **Пройден.**

Плюс `tsc --noEmit` по `home-verification.controller.ts`/`.service.ts`/`.module.ts` вместе —
0 ошибок, относящихся к этим файлам.

**Фронтенд**: `tsc --noEmit --strict` по `app/my-home/page.tsx` и
`app/admin/home-verifications/page.tsx` — 0 новых ошибок сверх уже неоднократно
подтверждённого в предыдущих аудитах ложного паттерна заглушки (`implicit any` на `onChange`,
отсутствующие `useCallback`/`useRef`/`Fragment` в упрощённом стенде `@types/react`).

## Не проверено (ограничение аудита)

- Реальный прогон формы `/my-home` в браузере для залогиненного админ-аккаунта (через
  `DEV_AUTO_LOGIN`) — нет браузера/сети в этой песочнице; проверена только логика получения
  `isAdmin` из ответа `/auth/me` и условный рендеринг по типам, не реальный клик по кнопке.
- `Prisma db push` с изменённой схемой (`receiptImageUrl` → nullable, новое поле
  `adminExempt`) — не прогонялся против настоящего Postgres; изменения обратно совместимы
  по построению (ослабление ограничения NOT NULL и новое поле с дефолтом не требуют миграции
  существующих данных), но не проверено вживую.

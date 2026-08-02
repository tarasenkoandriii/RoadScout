-- Бекфіл для вже імпортованих камер NYC TMC (реальний знайдений баг — див. коментар у
-- sql/nyctmc-provider-seed.sql і doc/AUDIT-nyctmc-adapter.md, розділ "Оновлення 3").
--
-- Провайдер `nyctmc` довгий час мав cityId = NULL, тому всі камери, вже імпортовані ДО фіксу
-- в nyctmc-provider-seed.sql, лишились із cityId = NULL — колонки "Город"/"Страна" в адмінці
-- показують "—" для них, і фільтр по країні на /admin/cameras їх не бачить.
--
-- Прогнати ПІСЛЯ оновленого nyctmc-provider-seed.sql (щоб сам провайдер уже мав правильний
-- cityId, звідки цей запит бере значення):
--   docker compose exec api npx prisma db execute --file sql/nyctmc-backfill-city-fix.sql --schema prisma/schema.prisma
--
-- Ідемпотентно — виправляє тільки камери з deletedAt IS NULL і cityId IS NULL, повторний
-- запуск безпечний (нічого зайвого не торкнеться, якщо вже виправлено).
UPDATE "Camera"
SET "cityId" = (SELECT "cityId" FROM "CameraProvider" WHERE "adapterKey" = 'nyctmc')
WHERE "providerId" = (SELECT id FROM "CameraProvider" WHERE "adapterKey" = 'nyctmc')
  AND "cityId" IS NULL
  AND "deletedAt" IS NULL;

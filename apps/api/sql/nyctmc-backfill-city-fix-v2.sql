-- Другий, окремий бекфіл для тієї самої історії, що вже sql/nyctmc-backfill-city-fix.sql
-- (див. коментар там і doc/AUDIT-nyctmc-adapter.md, розділ "Оновлення 3") — за прямим
-- підтвердженням користувача (скріншот /admin/cameras, "NYC provider reported some cameras in
-- Kyv") залишковий випадок, який ТОЙ бекфіл НЕ покривав.
--
-- Хронологія (реконструйована з коментарів у cities-seed.sql/nyctmc-provider-seed.sql/
-- nyctmc-backfill-city-fix.sql — без прямого доступу до продакшн-БД у цьому середовищі
-- розробки, тому ЧЕСНО позначено як найбільш правдоподібна реконструкція, не підтверджений
-- живий факт):
--   1. До мульти-сіті фічі ВСІ камери (незалежно від провайдера) мали cityId = NULL.
--   2. Міграція мульти-сіті (sql/cities-seed.sql, рядок
--      `UPDATE "Camera" SET "cityId" = 'city_kyiv' WHERE "cityId" IS NULL;`) заднім числом
--      проставила 'city_kyiv' УСІМ камерам з cityId IS NULL на момент запуску — правильне
--      припущення для тодішніх (лише українських) камер, але якщо провайдер `nyctmc` на ТОЙ
--      момент теж ще мав cityId = NULL (до фіксу в nyctmc-provider-seed.sql) — уже імпортовані
--      на той час NYC TMC камери потрапили під цей самий бланкетний UPDATE і отримали
--      cityId = 'city_kyiv', хоча фізично це камери Нью-Йорка.
--   3. nyctmc-provider-seed.sql пізніше виправив САМ провайдер на 'city_us_new_york'.
--   4. nyctmc-backfill-city-fix.sql виправив камери, що на ТОЙ момент усе ще мали
--      cityId IS NULL — але камери, уже "заражені" кроком 2 (cityId = 'city_kyiv', НЕ NULL),
--      під умову `WHERE "cityId" IS NULL` того скрипту не потрапляли й лишились неправильними
--      назавжди — саме це користувач і побачив у списку камер адмінки.
--
-- Прогнати (той самий спосіб, що й попередній бекфіл):
--   docker compose exec api npx prisma db execute --file sql/nyctmc-backfill-city-fix-v2.sql --schema prisma/schema.prisma
--
-- Ідемпотентно — виправляє лише камери nyctmc-провайдера з cityId, що ЗБІГАЄТЬСЯ з Київським
-- (city_kyiv) і НЕ дорівнює вже правильному cityId провайдера (WHERE-умова нижче природно
-- перестає щось знаходити після першого успішного запуску). deletedAt IS NULL — не чіпаємо
-- вже soft-deleted записи.
--
-- ⚠️ ПЕРЕД запуском UPDATE — рекомендується спершу виконати самостійно лише SELECT нижче
-- (закоментований UPDATE), щоб вручну звірити список камер, які буде змінено, і переконатись,
-- що серед них немає жодної, що ФІЗИЧНО справді в Києві (малоймовірно для nyctmc-провайдера,
-- який завжди повертає лише камери Нью-Йорка, § NycTmcAdapter — але зайва обережність для
-- прямого запису в продакшн-БД не завадить).

-- SELECT c.id, c.name, c."cityId", c.lat, c.lng
-- FROM "Camera" c
-- WHERE c."providerId" = (SELECT id FROM "CameraProvider" WHERE "adapterKey" = 'nyctmc')
--   AND c."cityId" = 'city_kyiv'
--   AND c."deletedAt" IS NULL;

UPDATE "Camera"
SET "cityId" = (SELECT "cityId" FROM "CameraProvider" WHERE "adapterKey" = 'nyctmc')
WHERE "providerId" = (SELECT id FROM "CameraProvider" WHERE "adapterKey" = 'nyctmc')
  AND "cityId" = 'city_kyiv'
  AND "deletedAt" IS NULL;

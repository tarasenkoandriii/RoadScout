-- NYC DOT Real Time Traffic Information (RTTI) — реальний, безкоштовний API без ключа,
-- знайдений і підтверджений користувачем напряму (webcams.nyctmc.org/cameras-list). Єдиний
-- глобальний провайдер (не по місту) — API повертає всі камери Нью-Йорка одним запитом.
--
-- ВАЖЛИВО (реальний знайдений баг, виправлено — див. doc/AUDIT-nyctmc-adapter.md, розділ
-- "Оновлення 3"): раніше тут стояло cityId = NULL з міркуванням "адаптеру City не потрібне
-- для побудови запиту" — це правда для САМОГО адаптера, але кожна СТВОРЕНА камера успадковує
-- provider.cityId (див. ScraperService.processItem()), тому з NULL усі камери NYC TMC
-- залишались без City взагалі — колонки "Город"/"Страна" в адмінці показували "—", і фільтр
-- по країні на /admin/cameras не бачив ці камери жодною країною. Тепер прив'язано до
-- 'city_us_new_york' (див. sql/cities-seed-developed-countries.sql) — координати кожної
-- окремої камери (suggestedLat/suggestedLng з API) лишаються точними, City тут потрібне лише
-- для країни/назви міста на UI, не для геопозиції самої камери.
--
-- За прямим запитом користувача — доданий ПЕРШИМ у ланцюг сідів (docker-entrypoint.sh), щоб
-- природний порядок вставки рядків ставив цей провайдер на початок списку в адмінці.
--
-- Ідемпотентно (ON CONFLICT ("adapterKey") DO UPDATE — на відміну від DO NOTHING раніше,
-- тепер навмисно оновлює cityId навіть для вже існуючого рядка, щоб цей фікс застосувався і
-- без повторного видалення провайдера). Прогнати:
--   docker compose exec api npx prisma db execute --file sql/nyctmc-provider-seed.sql --schema prisma/schema.prisma
-- ⚠️ Це виправляє ТІЛЬКИ сам провайдер — уже імпортовані камери (створені до цього фіксу)
-- потребують окремого бекфілу, див. sql/nyctmc-backfill-city-fix.sql.
--
-- createdAt — штучно рання дата (не @default(now())), гарантує, що провайдер сортується
-- першим (ORDER BY "createdAt" ASC) незалежно від точного моменту виконання цього сіда.
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId", "createdAt")
VALUES (
  'provider_nyctmc',
  'NYC DOT Traffic Cameras (RTTI)',
  'https://webcams.nyctmc.org',
  'nyctmc',
  'city_us_new_york',
  '2000-01-01T00:00:00Z'::timestamp
)
ON CONFLICT ("adapterKey") DO UPDATE SET "cityId" = EXCLUDED."cityId";

-- См. doc/TZ-youtube-camera-discovery.md — окреме джерело камер, доповнення до webcam-guru-*.
-- На відміну від webcam-guru (потрібен окремий City.webcamGuruSlug, звірений вручну під
-- реальний сайт), youtube-search працює для БУДЬ-ЯКОГО міста з lat/lng (є в кожного City) —
-- жодного окремого slug-поля заводити не потрібно.
--
-- Створює по одному CameraProvider (adapterKey: "youtube-search-<slug>") на кожне City,
-- незалежно від країни (розширено з "тільки UA" — див. запит користувача про світове
-- розширення "починаючи з технологічно розвинених країн", doc/AUDIT-world-camera-map.md).
--
-- Ідемпотентно (ON CONFLICT ("adapterKey") DO NOTHING) — можна ганяти повторно, і повторно
-- після додавання нових міст у cities-seed.sql / sql/cities-seed-developed-countries.sql.
-- Прогнати один раз ПІСЛЯ cities-seed.sql:
--   docker compose exec api npx prisma db execute --file sql/youtube-search-providers-seed.sql --schema prisma/schema.prisma
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId")
SELECT
  'provider_youtube_search_' || c.slug,
  'YouTube Search — ' || c.name,
  'https://www.googleapis.com/youtube/v3',
  'youtube-search-' || c.slug,
  c.id
FROM "City" c
ON CONFLICT ("adapterKey") DO NOTHING;

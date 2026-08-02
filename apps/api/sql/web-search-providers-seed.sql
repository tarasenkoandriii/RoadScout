-- Пошук окремих камер через Google (веб-пошук Grok, див. doc/AUDIT-google-web-search-cameras.md)
-- — той самий принцип, що youtube-search-providers-seed.sql: по одному CameraProvider на
-- кожне City, незалежно від країни (розширено з "тільки UA" для світового розширення, див.
-- doc/AUDIT-world-camera-map.md).
--
-- Ідемпотентно (ON CONFLICT ("adapterKey") DO NOTHING). Прогнати один раз ПІСЛЯ cities-seed.sql:
--   docker compose exec api npx prisma db execute --file sql/web-search-providers-seed.sql --schema prisma/schema.prisma
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId")
SELECT
  'provider_web_search_' || c.slug,
  'Google Web Search — ' || c.name,
  'https://api.x.ai/v1',
  'web-search-' || c.slug,
  c.id
FROM "City" c
ON CONFLICT ("adapterKey") DO NOTHING;

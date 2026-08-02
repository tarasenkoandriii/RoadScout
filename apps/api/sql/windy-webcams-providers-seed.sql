-- Windy Webcams API (реальна, структурована база камер — див. запит користувача: "добавить
-- поддержку камер и апи windy.com (взамен українського guru)", doc/AUDIT-windy-webcams-and-nature-cameras.md)
-- — по одному CameraProvider на кожне City, незалежно від країни (той самий принцип, що
-- youtube-search-providers-seed.sql/web-search-providers-seed.sql).
--
-- Ідемпотентно (ON CONFLICT ("adapterKey") DO NOTHING). Прогнати ПІСЛЯ cities-seed.sql:
--   docker compose exec api npx prisma db execute --file sql/windy-webcams-providers-seed.sql --schema prisma/schema.prisma
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId")
SELECT
  'provider_windy_' || c.slug,
  'Windy Webcams — ' || c.name,
  'https://api.windy.com/webcams/api/v3',
  'windy-' || c.slug,
  c.id
FROM "City" c
ON CONFLICT ("adapterKey") DO NOTHING;

-- Розширення на технологічно розвинені країни (див. запит користувача: "у зв'язку з воєнним
-- станом важко буде стартувати в Україні або Росії — почати збір даних по камерах по всьому
-- світу починаючи з технологічно розвинених країн", doc/AUDIT-world-camera-map.md).
--
-- Окремий файл від cities-seed.sql/cities-seed-neighboring.sql намеренно — це початковий,
-- явно НЕПОВНИЙ список (по 2-3 великих міста на країну) для перевірки самої концепції
-- світового розширення через уже існуючі YouTube/Google-пошук адаптери (обидва вже
-- параметризовані по countryCode/countryName, не жорстко закодовані на Україну — див.
-- YoutubeSearchAdapter/GoogleWebCameraSearchAdapter). Розширювати цей список — окрема, менш
-- термінова робота, не частина цього кроку.
--
-- webcamGuruSlug = NULL для всіх (цей адаптер суто український) — камери сюди
-- надходитимуть тільки через youtube-search-*/web-search-* (їхні провайдери створюються
-- автоматично для БУДЬ-ЯКОГО City через youtube-search-providers-seed.sql/
-- web-search-providers-seed.sql, без фільтра по країні).
--
-- Ідемпотентно (ON CONFLICT DO NOTHING). Прогнати ПІСЛЯ cities-seed.sql, ПЕРЕД
-- youtube-search-providers-seed.sql/web-search-providers-seed.sql:
--   docker compose exec api npx prisma db execute --file sql/cities-seed-developed-countries.sql --schema prisma/schema.prisma
INSERT INTO "City" (id, name, slug, lat, lng, region, "countryCode", "countryName", "webcamGuruSlug", "createdAt") VALUES
  -- США
  ('city_us_new_york',    'New York',      'new-york-us',      40.7128, -74.0060, 'New York',    'US', 'United States', NULL, now()),
  ('city_us_los_angeles', 'Los Angeles',   'los-angeles-us',    34.0522, -118.2437,'California',  'US', 'United States', NULL, now()),
  ('city_us_san_francisco','San Francisco','san-francisco-us',  37.7749, -122.4194,'California',  'US', 'United States', NULL, now()),
  -- Німеччина
  ('city_de_berlin',      'Berlin',        'berlin-de',         52.5200, 13.4050, 'Berlin',       'DE', 'Deutschland',   NULL, now()),
  ('city_de_munich',      'München',       'munich-de',         48.1351, 11.5820, 'Bayern',       'DE', 'Deutschland',   NULL, now()),
  -- Японія
  ('city_jp_tokyo',       'Tokyo',         'tokyo-jp',          35.6762, 139.6503,'Tokyo',        'JP', '日本',          NULL, now()),
  ('city_jp_osaka',       'Osaka',         'osaka-jp',          34.6937, 135.5023,'Osaka',        'JP', '日本',          NULL, now()),
  -- Південна Корея
  ('city_kr_seoul',       'Seoul',         'seoul-kr',          37.5665, 126.9780,'Seoul',        'KR', '대한민국',      NULL, now()),
  -- Сінгапур
  ('city_sg_singapore',   'Singapore',     'singapore-sg',      1.3521,  103.8198,NULL,           'SG', 'Singapore',     NULL, now())
ON CONFLICT (slug) DO NOTHING;

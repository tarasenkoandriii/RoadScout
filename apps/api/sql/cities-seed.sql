-- Поддержка всех городов Украины: справочник City (см. doc/README.md, раздел "Города Украины").
-- Идемпотентно (ON CONFLICT DO NOTHING) — можно гонять повторно. Прогнать один раз после
-- `prisma db push`/`migrate deploy`, аналогично geo-migration.sql/route-migration.sql:
--   docker compose exec api npx prisma db execute --file sql/cities-seed.sql --schema prisma/schema.prisma
--
-- webcam_guru_slug сверен только для Києва ("kiev") и Львова ("lvov") по факту существующего
-- парсера/исследования (см. doc/AUDIT-research-analogues.md, если есть, либо просто README).
-- Для остальных городов — предположение по образцу URL (webcam.guru.ua/city/<slug>/), ПЕРЕД
-- включением парсера для нового города обязательно проверить реальный слаг вручную.
INSERT INTO "City" (id, name, slug, lat, lng, region, "webcamGuruSlug", "createdAt") VALUES
  ('city_kyiv',           'Київ',              'kyiv',            50.4501, 30.5234, 'Київська область',         'kiev',    now()),
  ('city_lviv',           'Львів',             'lviv',            49.8397, 24.0297, 'Львівська область',        'lvov',    now()),
  ('city_kharkiv',        'Харків',            'kharkiv',         49.9935, 36.2304, 'Харківська область',       'harkov',  now()),
  ('city_odesa',          'Одеса',             'odesa',           46.4825, 30.7233, 'Одеська область',          'odessa',  now()),
  ('city_dnipro',         'Дніпро',            'dnipro',          48.4647, 35.0462, 'Дніпропетровська область', 'dnepr',   now()),
  ('city_zaporizhzhia',   'Запоріжжя',         'zaporizhzhia',    47.8388, 35.1396, 'Запорізька область',       NULL,      now()),
  ('city_vinnytsia',      'Вінниця',           'vinnytsia',       49.2331, 28.4682, 'Вінницька область',        NULL,      now()),
  ('city_poltava',        'Полтава',           'poltava',         49.5883, 34.5514, 'Полтавська область',       NULL,      now()),
  ('city_chernihiv',      'Чернігів',          'chernihiv',       51.4982, 31.2893, 'Чернігівська область',     NULL,      now()),
  ('city_cherkasy',       'Черкаси',           'cherkasy',        49.4444, 32.0598, 'Черкаська область',        NULL,      now()),
  ('city_zhytomyr',       'Житомир',           'zhytomyr',        50.2547, 28.6587, 'Житомирська область',      NULL,      now()),
  ('city_sumy',           'Суми',              'sumy',            50.9077, 34.7981, 'Сумська область',          NULL,      now()),
  ('city_khmelnytskyi',   'Хмельницький',      'khmelnytskyi',    49.4229, 26.9871, 'Хмельницька область',      NULL,      now()),
  ('city_rivne',          'Рівне',             'rivne',           50.6199, 26.2516, 'Рівненська область',       NULL,      now()),
  ('city_ternopil',       'Тернопіль',         'ternopil',        49.5535, 25.5948, 'Тернопільська область',    NULL,      now()),
  ('city_ivano_frankivsk','Івано-Франківськ',  'ivano-frankivsk', 48.9226, 24.7111, 'Івано-Франківська область',NULL,      now()),
  ('city_lutsk',          'Луцьк',             'lutsk',           50.7472, 25.3254, 'Волинська область',        NULL,      now()),
  ('city_uzhhorod',       'Ужгород',           'uzhhorod',        48.6208, 22.2879, 'Закарпатська область',     NULL,      now()),
  ('city_mykolaiv',       'Миколаїв',          'mykolaiv',        46.9750, 31.9946, 'Миколаївська область',     NULL,      now()),
  ('city_kherson',        'Херсон',            'kherson',         46.6354, 32.6169, 'Херсонська область',       NULL,      now()),
  ('city_kropyvnytskyi',  'Кропивницький',     'kropyvnytskyi',   48.5079, 32.2623, 'Кіровоградська область',   NULL,      now())
ON CONFLICT (slug) DO NOTHING;

-- Существующие камеры (все были импортированы как Киев до введения мульти-city) — привязать
-- к городу Київ, если ещё не привязаны. Безопасно гонять повторно.
UPDATE "Camera" SET "cityId" = 'city_kyiv' WHERE "cityId" IS NULL;

-- ВАЖНО: этого файла не хватало во всём проекте до этого момента — City.webcamGuruSlug
-- заполнялся для нескольких городов (см. sql/cities-seed.sql), но ни один CameraProvider на
-- него никогда не создавался. Из-за этого ScraperService.runAll() обходил ПУСТОЙ список
-- источников (см. doc/AUDIT-parser-no-providers-incident.md — эта проблема на уровне данных,
-- не кода: сам импорт/парсер работали бы корректно, если бы источники вообще существовали).
--
-- Создаёт по одному CameraProvider (adapterKey: "webcam-guru-<slug>") на каждый City с
-- заполненным webcamGuruSlug — сейчас это Київ/Львів/Харків/Одеса/Дніпро (см.
-- sql/cities-seed.sql). Остальные города намеренно пропускаются — их webcamGuruSlug ещё NULL,
-- см. предупреждение в самом cities-seed.sql про непроверенные слаги.
--
-- Идемпотентно (ON CONFLICT ("adapterKey") DO NOTHING) — можно гонять повторно, и повторно
-- после добавления новых городов с непустым webcamGuruSlug в cities-seed.sql.
-- Прогнать один раз ПОСЛЕ cities-seed.sql:
--   docker compose exec api npx prisma db execute --file sql/camera-providers-seed.sql --schema prisma/schema.prisma
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId")
SELECT
  'provider_webcam_guru_' || c.slug,
  'WebcamGuru — ' || c.name,
  'https://webcam.guru.ua',
  'webcam-guru-' || c.slug,
  c.id
FROM "City" c
WHERE c."webcamGuruSlug" IS NOT NULL
ON CONFLICT ("adapterKey") DO NOTHING;

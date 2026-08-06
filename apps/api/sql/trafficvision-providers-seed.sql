-- TrafficVision.Live camera-data (див. TrafficVisionAdapter і
-- doc/AUDIT-trafficvision-parser.md за повним дослідженням — знайдено 845 джерел камер на
-- сайті, але без сесійного handshake (навмисно НЕ відтворюється — заборонено ToS сайту й
-- заблоковано інструментом розробки) відкриті БЕЗ авторизації рівно два: oktraffic і bpjt-).
--
-- "cityId" = NULL для ОБОХ — на відміну від nyctmc-provider-seed.sql (де провайдер = рівно
-- одне місто, Нью-Йорк), ці два джерела охоплюють БАГАТО міст/областей одним провайдером
-- (oktraffic — увесь штат Оклахома, bpjt- — платні дороги всієї Індонезії) — City-прив'язка
-- робиться поштучно на рівні кожної камери (ScraperService.processItem(), через
-- RawCameraItem.suggestedCityName/suggestedCountryCode), не на рівні провайдера.
--
-- Прогнати:
--   docker compose exec api npx prisma db execute --file sql/trafficvision-providers-seed.sql --schema prisma/schema.prisma
-- (уже підключено в docker-entrypoint.sh — прогониться автоматично при старті контейнера)
--
-- Ідемпотентно (ON CONFLICT ("adapterKey") DO NOTHING).
INSERT INTO "CameraProvider" (id, name, "baseUrl", "adapterKey", "cityId", "createdAt")
VALUES
  ('provider_trafficvision_oktraffic', 'TrafficVision.Live — Oklahoma DOT (OKTraffic)', 'https://data.trafficvision.live/camera-data/oktraffic-cameras.json', 'trafficvision-oktraffic', NULL, now()),
  ('provider_trafficvision_bpjt', 'TrafficVision.Live — Indonesia Toll Roads (BPJT)', 'https://data.trafficvision.live/camera-data/bpjt-cameras.json', 'trafficvision-bpjt', NULL, now())
ON CONFLICT ("adapterKey") DO NOTHING;

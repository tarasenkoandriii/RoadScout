-- Глава 16–18 ТЗ: PostGIS-поддержка для FIXED_ROUTE камер.
-- Как и geo-migration.sql, не управляется Prisma — прогнать отдельно один раз.
--
-- Local:      docker compose exec api npx prisma db execute --file sql/route-migration.sql --schema prisma/schema.prisma
-- Supabase:   вставить в SQL editor после первого `prisma migrate deploy` (и после geo-migration.sql).

CREATE EXTENSION IF NOT EXISTS postgis;

-- route_buffer_polygon — дешёвый первичный фильтр кандидатов для /search и /cameras/at-point:
-- буфер вокруг routeGeometry шириной rangeMeters. В отличие от fov_polygon (точный статический
-- сектор STATIONARY-камеры), это НЕ точный тест видимости — просто "точка находится где-то в
-- зоне, которую камера теоретически может увидеть в какой-то момент своего маршрута". Точный
-- sector-test (cameraSeesPoint) всё равно выполняется в JS против динамической позиции камеры
-- на конкретный момент времени (см. FixedRoutePositionService / LookAheadService).
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS route_buffer_polygon geometry(Polygon, 4326);
ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS route_line geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS camera_route_buffer_gist ON "Camera" USING GIST (route_buffer_polygon);

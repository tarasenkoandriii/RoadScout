-- Prisma doesn't manage PostGIS geometry columns, so this runs separately
-- from `prisma migrate deploy` (see README / docker-compose command).
--
-- Local:      docker compose exec api npx prisma db execute --file sql/geo-migration.sql --schema prisma/schema.prisma
-- Supabase:   paste into the SQL editor once after the first `prisma migrate deploy`.

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "Camera" ADD COLUMN IF NOT EXISTS fov_polygon geometry(Polygon, 4326);

CREATE INDEX IF NOT EXISTS camera_fov_polygon_gist ON "Camera" USING GIST (fov_polygon);

#!/bin/sh
# Автоматический прогон схемы + всех сидов/миграций при каждом старте контейнера (см.
# doc/README.md, "Локальная разработка" — раньше это была одна огромная нечитаемая строка
# внутри docker-compose.yml command:, куда каждый новый sql-файл приходилось дописывать через
# ещё один "&&"; см. doc/AUDIT-parser-no-providers-incident.md — именно так и получилось, что
# camera-providers-seed.sql какое-то время вообще не существовал, и добавить его было неудобно
# именно из-за формата одной строки). Теперь — обычный шаг-за-шагом скрипт, куда новый сид
# добавляется одной строкой `run_sql sql/новый-файл.sql`.
#
# set -e — падаем сразу на первой реальной ошибке (Prisma generate/push, обязательный SQL-файл),
# а не продолжаем в неопределённом состоянии.
set -e

echo "==> [entrypoint] Генерация Prisma Client..."
npx prisma generate

echo "==> [entrypoint] Применение схемы к базе (prisma db push)..."
npx prisma db push --skip-generate

# run_sql <путь> [optional]
#   optional=true  — файла может не быть (или его можно осознанно не прогонять) — пропускаем
#                    молча, не роняя весь запуск контейнера.
#   optional=false (по умолчанию) — файл обязателен; если его нет, это поломанный образ/чекаут,
#                    останавливаемся с понятной ошибкой, а не продолжаем без нужных данных.
run_sql() {
  file="$1"
  optional="${2:-false}"

  if [ ! -f "$file" ]; then
    if [ "$optional" = "true" ]; then
      echo "==> [entrypoint]   (пропущено — файла нет: $file)"
      return 0
    fi
    echo "==> [entrypoint] ОШИБКА: обязательный файл не найден: $file" >&2
    exit 1
  fi

  echo "==> [entrypoint]   -> $file"
  npx prisma db execute --file "$file" --schema prisma/schema.prisma
}

echo "==> [entrypoint] Применение SQL-миграций и сидов..."
# Порядок важен: geo/route-migration — расширения/колонки PostGIS, до сидов данных.
# cities-seed — до camera-providers-seed (тот зависит от строк City) и до border-crossings.
run_sql sql/geo-migration.sql
run_sql sql/route-migration.sql
run_sql sql/cities-seed.sql
# ВАЖЛИВО (реальний знайдений баг — див. doc/AUDIT-nyctmc-adapter.md, розділ "Оновлення 3"):
# cities-seed-developed-countries.sql (містить New York) раніше НЕ був підключений у цьому
# ланцюгу взагалі — City "city_us_new_york" міг просто не існувати в БД, коли
# nyctmc-provider-seed.sql намагався на нього посилатись. Порядок нижче тепер критичний:
# міста → провайдер, що на них посилається → бекфіл уже створених камер.
run_sql sql/cities-seed-developed-countries.sql
run_sql sql/nyctmc-provider-seed.sql
run_sql sql/nyctmc-backfill-city-fix.sql
run_sql sql/camera-providers-seed.sql
run_sql sql/youtube-search-providers-seed.sql
run_sql sql/web-search-providers-seed.sql
run_sql sql/windy-webcams-providers-seed.sql
run_sql sql/trafficvision-providers-seed.sql
run_sql sql/cities-seed-neighboring.sql true
run_sql sql/border-crossings-seed.sql

echo "==> [entrypoint] Готово, запускаем приложение..."
exec "$@"

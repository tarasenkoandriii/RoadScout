// apps/api/scripts/generate-btw-tiles.ts
//
// §4.7.1 ТЗ — офлайн-скрипт збірки тайлів (buildings/cameras/streets) для локального
// сканування (apps/btw/lib/btwLocalScanner.ts + apps/btw/workers/btw-scan.worker.ts). Частина
// завдання "(b) full spec as originally written".
//
// РЕФАКТОРИНГ (за прямим запитом користувача — "сделай новую вкладку в админке для запуска
// скрипта... по городам"): уся важка логіка (Overpass-запити, кодування тайлів, запис на
// диск) винесена в `../src/btw/tile-generation.util.ts` — щоб її МІГ використовувати і цей
// CLI-скрипт (standalone `new PrismaClient()`, без Nest DI), і новий адмінський ендпоінт
// `POST /btw/admin/generate-tiles` (`BtwService.generateTiles()`, викликається кнопкою з нової
// вкладки адмінки). Цей файл тепер лише: розбір argv, запит камер через Prisma, виклик
// спільної функції, консольний вивід.
//
// ⚠️ ЦЕЙ СКРИПТ Я (Claude) НЕ МОЖУ ВИКОНАТИ В ЦЬОМУ СЕРЕДОВИЩІ РОЗРОБКИ — перевірено прямо в
// цьому сеансі: `curl https://overpass-api.de/api/status` повертає "000" (немає мережевого
// маршруту назовні), і в `.env.example`/середовищі немає `DATABASE_URL` чи будь-яких інших
// credentials до продакшн-БД. Тому скрипт написаний коректно, дослівно тими самими
// Overpass-запитами, що вже реально працюють у продакшені (occlusion.service.ts::
// fetchNearbyBuildings, azimuth-heuristic.service.ts::extractStreetAzimuthCandidates), але Я
// ЙОГО ЖОДНОГО РАЗУ НЕ ЗАПУСКАВ. Через це саме й додано зручнішу альтернативу — адмінська
// вкладка "BTW: тайлы радара" (apps/admin/app/admin/btw-tiles/page.tsx), яка робить те саме
// одним кліком через сервер (де вже є DATABASE_URL) — але той шлях обмежений таймаутом
// serverless-функції (Vercel Hobby, 300с — див. коментар біля OVERPASS_QUERY_TIMEOUT_S у
// tile-generation.util.ts), тоді як ЦЕЙ CLI-скрипт такого обмеження не має і краще підходить
// для великих/щільних міст:
//
//   cd apps/api
//   npm i -D ts-node          # якщо ще не встановлено — не входить у поточні devDependencies
//   npx ts-node scripts/generate-btw-tiles.ts kyiv
//
// (альтернатива без ts-node: скомпілювати окремо —
//   npx tsc scripts/generate-btw-tiles.ts --module commonjs --target es2021 --esModuleInterop \
//     --skipLibCheck --outDir /tmp/btw-tiles-build
//   node /tmp/btw-tiles-build/generate-btw-tiles.js kyiv
// )
//
// Аргумент — САМЕ `City.slug` (наприклад "kyiv"), НЕ `City.name` (український відображуваний
// напис, наприклад "Київ") — див. ВИПРАВЛЕНО-коментар у btw.service.ts::generateTiles() щодо
// того, чому це важливо.
//
// Результат — файли в BTW_TILES_DIR (за замовчуванням `<apps/api cwd>/btw-tiles/<slug>/`):
//   buildings.bin, cameras.json, streets.json
// Той самий формат/шлях, що читає GET /btw/tiles/:city/:layer (btw.service.ts::streamTile) і
// генерує/перевіряє apps/btw/lib/tile-format.ts (канонічне джерело байт-формату — обидві копії
// побайтово ідентичні, перевірено тестом round-trip у цьому кроці). Після запуску —
// GET /btw/manifest?city=kyiv має почати повертати scanMode:"local-worker".

import { PrismaClient } from '@prisma/client';
import { generateTilesForCity } from '../src/btw/tile-generation.util';
import * as path from 'path';

async function main() {
  const citySlug = process.argv[2];
  if (!citySlug) {
    console.error('Usage: ts-node generate-btw-tiles.ts <citySlug>   (напр. kyiv — City.slug, не City.name)');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    console.log(`[generate-btw-tiles] fetching cameras for city slug="${citySlug}"...`);
    // Той самий фільтр, що BtwService.SCANNABLE_CAMERA_FILTER вже застосовує для адмінських
    // списків міст (listCitiesWithCameraDensity/findDensestCameraPoint) — включно зі
    // status:'ONLINE' (ВИПРАВЛЕНО — раніше тут цього поля не було, тайл міг містити камери, що
    // вже позначені офлайн; тепер узгоджено з рештою адмінських методів BtwService).
    const cameras = await prisma.camera.findMany({
      where: { deletedAt: null, confidence: 'VERIFIED', locationType: 'OUTDOOR', status: 'ONLINE', city: { slug: citySlug } },
      select: { id: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true, heightMeters: true, streamType: true, confidence: true },
    });

    if (cameras.length === 0) {
      console.error(`[generate-btw-tiles] no VERIFIED/OUTDOOR/ONLINE cameras found for city slug="${citySlug}" — aborting (nothing to tile).`);
      process.exit(1);
    }
    console.log(`[generate-btw-tiles] ${cameras.length} cameras found.`);

    const tilesDir = process.env.BTW_TILES_DIR ?? path.join(process.cwd(), 'btw-tiles');
    const result = await generateTilesForCity(citySlug, cameras, tilesDir);

    console.log(
      `[generate-btw-tiles] done. buildings=${result.buildingCount} (${result.buildingBytes} bytes), cameras=${result.cameraCount}, streets=${result.streetCount}`,
    );
    console.log(`[generate-btw-tiles] bbox: ${JSON.stringify(result.bbox)}`);
    console.log(`[generate-btw-tiles] written to ${result.cityDir}`);
    console.log(`[generate-btw-tiles] GET /btw/manifest?city=${citySlug} should now report scanMode:"local-worker".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[generate-btw-tiles] failed:', err);
  process.exit(1);
});

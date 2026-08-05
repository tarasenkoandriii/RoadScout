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
//   vercel env pull           # ОБОВ'ЯЗКОВО (§ нижче) — без цього запис піде в помилку
//   npx ts-node scripts/generate-btw-tiles.ts kyiv
//
// (альтернатива без ts-node: скомпілювати окремо —
//   npx tsc scripts/generate-btw-tiles.ts --module commonjs --target es2021 --esModuleInterop \
//     --skipLibCheck --outDir /tmp/btw-tiles-build
//   node /tmp/btw-tiles-build/generate-btw-tiles.js kyiv
// )
//
// --continue (за прямим запитом користувача — живий випадок, коли для New York (694 -> 845
// камер того самого міста між двома окремими запусками CLI, бо сканер додав нові в фоні) кожен
// новий запуск рахував ІНШИЙ bbox і тому скидав увесь кеш комірок сітки, стартуючи заново
// з "0/930", попри те що величезна частина вже отриманих даних для практично тієї самої
// території й далі валідна — § детальний коментар біля GenerateTilesOptions.bboxOverride/
// getCellCacheBboxSnapshot() у tile-generation.util.ts):
//
//   npx ts-node scripts/generate-btw-tiles.ts new-york-us --continue
//
// Продовжує РІВНО з того bbox, що дав попередній запуск для цього міста (якщо кеш комірок уже
// існує) — новоприбулі камери просто увійдуть у наступну ПОВНУ регенерацію (без --continue) чи
// в наступний виклик з нуля, коли поточна серія комірок завершиться.
//
// Аргумент — САМЕ `City.slug` (наприклад "kyiv"), НЕ `City.name` (український відображуваний
// напис, наприклад "Київ") — див. ВИПРАВЛЕНО-коментар у btw.service.ts::generateTiles() щодо
// того, чому це важливо.
//
// ВИПРАВЛЕНО (реальний, живий інцидент на проді — § детальний розбір у tile-generation.util.ts
// біля BLOB_PATH_PREFIX і в doc/AUDIT-btw-radar-m1-m2.md): сховище тайлів більше НЕ локальний
// диск (`BTW_TILES_DIR`) — тепер Vercel Blob, той самий, що читає деплойнутий апі-сервер. Це
// ЗМІНЮЄ вимоги до запуску: потрібен `BLOB_READ_WRITE_TOKEN` (або `VERCEL_OIDC_TOKEN`+
// `BLOB_STORE_ID`) у ЛОКАЛЬНОМУ середовищі — інакше `@vercel/blob` кине помилку авторизації.
// Найпростіше — `vercel env pull` у корені `apps/api` (підтягне `.env.local` з тими самими
// значеннями, що вже налаштовані в проєкті на Vercel, за умови що ви залоговані в тому самому
// Vercel-акаунті через `vercel login`). Це РЕАЛЬНЕ покращення порівняно з попередньою версією
// цього скрипта: раніше запис ішов на ЛОКАЛЬНИЙ диск розробника, який деплойнутий апі-сервер
// узагалі не бачив (підказка "запустіть CLI локально" в адмінці була, по суті, марною для
// продакшн-використання) — тепер CLI і кнопка в адмінці пишуть у ТЕ САМЕ сховище.
//
// Результат — записується у Vercel Blob під префіксом `btw-tiles/<slug>/`:
//   buildings.bin, cameras.json, streets.json
// Той самий формат/шлях, що читає GET /btw/tiles/:city/:layer (btw.service.ts::streamTile) і
// генерує/перевіряє apps/btw/lib/tile-format.ts (канонічне джерело байт-формату — обидві копії
// побайтово ідентичні, перевірено тестом round-trip у цьому кроці). Після запуску —
// GET /btw/manifest?city=kyiv має почати повертати scanMode:"local-worker".

import { PrismaClient } from '@prisma/client';
import { generateTilesForCity, getCellCacheBboxSnapshot } from '../src/btw/tile-generation.util';
import type { GenerateTilesOptions } from '../src/btw/tile-generation.util';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const citySlug = process.argv[2];
  // За прямим запитом користувача — "скрипт каждый раз разбивает новую сетку по новой и
  // стартует с нуля - добавь флаг continue" (§ детальний коментар біля
  // GenerateTilesOptions.bboxOverride/getCellCacheBboxSnapshot() у tile-generation.util.ts).
  const continueFlag = process.argv.includes('--continue');
  if (!citySlug) {
    console.error('Usage: ts-node generate-btw-tiles.ts <citySlug> [--continue]   (напр. kyiv — City.slug, не City.name)');
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
      select: { id: true, name: true, lat: true, lng: true, azimuth: true, fovAngle: true, rangeMeters: true, heightMeters: true, streamType: true, confidence: true },
    });

    if (cameras.length === 0) {
      console.error(`[generate-btw-tiles] no VERIFIED/OUTDOOR/ONLINE cameras found for city slug="${citySlug}" — aborting (nothing to tile).`);
      process.exit(1);
    }
    console.log(`[generate-btw-tiles] ${cameras.length} cameras found.`);

    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) {
      console.warn(
        '[generate-btw-tiles] ⚠️ ні BLOB_READ_WRITE_TOKEN, ні VERCEL_OIDC_TOKEN не задані локально — запис у Vercel Blob, ' +
          'скоріш за все, провалиться з помилкою авторизації. Запустіть "vercel env pull" у apps/api й повторіть.',
      );
    }

    // ВИПРАВЛЕНО (за прямим запитом користувача — розбір живого випадку, коли New York
    // застряг рівно на "88/288 ячеек" чотири запуски АДМІНСЬКОЇ кнопки поспіль, § детальний
    // розбір і зменшення GRID_CELL_SIZE_M у tile-generation.util.ts): адмінська кнопка
    // ОБМЕЖЕНА таймаутом Vercel-функції (GENERATION_TIME_BUDGET_MS=220с) і тому МУСИТЬ
    // повертатись частково готовою для великих міст — саме тому весь механізм ідемпотентних
    // повторних запусків і існує. Але ЦЕЙ CLI-скрипт запускається на власній машині
    // розробника — жодного таймауту serverless-функції немає, тому НЕМАЄ причини змушувати
    // людину вручну перезапускати команду в циклі самому. Тепер скрипт сам повторює виклик,
    // доки generateTilesForCity() не поверне complete:true — той самий кеш комірок у Vercel
    // Blob, що й раніше, просто цикл тепер усередині скрипта, а не в руках людини.
    //
    // Захисна верхня межа ітерацій (не безумовний `while (true)`) — на випадок, якщо якась
    // конкретна комірка структурно НІКОЛИ не зможе завершитись (§ чесний коментар біля
    // GRID_CELL_SIZE_M — навіть після зменшення розміру комірки теоретично можливо для
    // найщільніших районів) — щоб скрипт зрештою зупинився з чітким повідомленням, а не висів
    // нескінченно, гріючи Overpass марними повторними запитами.
    // ВИПРАВЛЕНО (живий інцидент — CLI-запуск на New York реально впирався саме у 55с/60с
    // Overpass-таймаути на "живих" (НЕ заблокованих 406-фільтром) дзеркалах kumi.systems/
    // private.coffee для найщільніших комірок Мангеттена — не в саме блокування overpass-api.de/
    // lz4.overpass-api.de, ті відсіювались одразу). За прямим підтвердженням користувача — цей
    // CLI-скрипт виконується на власній машині, БЕЗ жодного serverless-обмеження, тому може
    // дозволити собі значно щедріші таймаути, ніж адмінська кнопка (яка й далі жорстко обмежена
    // Vercel Hobby 300с — § детальний коментар біля GenerateTilesOptions/OVERPASS_QUERY_TIMEOUT_S
    // у tile-generation.util.ts, ЦІ дефолти для адмінки НЕ змінені цим кроком).
    //   - overpassAttemptTimeoutMs: 60с -> 120с (клієнтський HTTP-таймаут на одну спробу);
    //   - overpassQueryTimeoutS: 55с -> 110с (серверний `[timeout:N]` усередині самого Overpass
    //     QL — лишається трохи МЕНШИМ за attemptTimeoutMs з тим самим запасом ~10с, щоб Overpass
    //     встиг відповісти власним graceful-таймаутом ДО того, як клієнт сам обірве з'єднання);
    //   - timeBudgetMs: 220с -> 15 хв на ОДИН виклик generateTilesForCity() — за той самий
    //     зовнішній цикл нижче все одно продовжує резюмуватись, доки complete:true, просто
    //     тепер кожен прохід встигає забрати значно більше комірок перед тим, як повернутись.
    // ⚠️ ЧЕСНО: конкретні числа (120с/110с/15хв) підібрані розрахунково — немає живого доступу
    // до Overpass у цьому середовищі розробки, щоб перевірити ідеальні значення емпірично.
    const CLI_TILE_OPTIONS: GenerateTilesOptions = {
      overpassAttemptTimeoutMs: 120_000,
      overpassQueryTimeoutS: 110,
      timeBudgetMs: 15 * 60_000,
    };

    // --continue: підміняємо bbox тим самим, що дав ПОПЕРЕДНІЙ запуск (якщо для цього міста
    // вже є частковий кеш комірок) — інакше кожен окремий запуск CLI перераховує bbox зі
    // свіжого списку камер, і якщо він хоч трохи змінився (сканер додав/оновив камеру між
    // запусками — саме так і сталось цього разу: 694 -> 845 камер того самого міста), увесь
    // кеш комірок скидається й прогрес втрачається (§ детальний коментар у
    // tile-generation.util.ts біля GenerateTilesOptions.bboxOverride).
    if (continueFlag) {
      const snapshot = await getCellCacheBboxSnapshot(citySlug);
      if (snapshot) {
        CLI_TILE_OPTIONS.bboxOverride = snapshot.bbox;
        console.log(
          `[generate-btw-tiles] --continue: знайдено кеш попереднього запуску — продовжуємо з тим самим bbox ${JSON.stringify(snapshot.bbox)} (а не перераховуємо зі свіжого списку камер).`,
        );
      } else {
        console.log(
          '[generate-btw-tiles] --continue: кешу попереднього запуску для цього міста не знайдено (перший запуск) — рахуємо bbox зі свіжого списку камер, як завжди.',
        );
      }
    }

    // ВИПРАВЛЕНО (живий інцидент — реальний запуск на New York показав, ЩО повторні проходи
    // самі по собі стали проблемою: ячейки, що впали в проході 1 з "звичайних" timeout/504,
    // у ПРОХОДІ 2 — одразу наступному, без жодної паузи — почали падати вже з HTTP 429 ("забагато
    // запитів") і навіть ECONNREFUSED/ETIMEDOUT на IP-адресу lz4.overpass-api.de (тобто хост
    // почав повністю відмовляти в з'єднанні, а не просто повільно відповідати). Це ознака, що
    // безкоштовні публічні дзеркала почали активно обмежувати/банити саме нас за занадто часті
    // повторні запити без жодної паузи між проходами (кожен прохід — до 3 комірок одночасно ×
    // 4 дзеркала = до 12 паралельних HTTP-запитів, і наступний прохід стартував одразу, як
    // тільки попередній завершувався). За прямим підтвердженням користувача — пауза між
    // проходами МАЄ пріоритет над "просто чекати, поки саме розсмокчеться" чи "додати ще VPN":
    // VPN додав би ЩЕ паралельних запитів до й так перевантажених дзеркал, не вирішуючи корінну
    // причину (rate-limit від НАШОЇ ЖЕ надмірної частоти запитів).
    //
    // Лінійний бекофф із стелею (не експоненційний — на довгому списку в 200 проходів
    // експоненційний зріс би до абсурдних значень): 5с, 10с, 15с, ... до стелі 60с. Досить, щоб
    // дати вікну rate-limit'у публічних дзеркал "охолонути" між проходами, не розтягуючи повний
    // прогін на неприйнятно довгий час для великих міст (максимум +60с на прохід після 12-го).
    // ⚠️ ЧЕСНО: конкретні числа (5с крок/60с стеля) підібрані розрахунково, за логікою типової
    // rate-limit поведінки публічних API — немає живого доступу до Overpass у цьому середовищі
    // розробки, щоб перевірити емпірично, чи цього досить, щоб повністю прибрати 429/ECONNREFUSED.
    const MAX_ITERATIONS = 200;
    const BACKOFF_STEP_MS = 5_000;
    const BACKOFF_CEILING_MS = 60_000;

    let result = await generateTilesForCity(citySlug, cameras, CLI_TILE_OPTIONS);
    let iteration = 1;
    while (!result.complete && iteration < MAX_ITERATIONS) {
      console.log(
        `[generate-btw-tiles] прохід ${iteration}: ${result.cellsDone}/${result.cellsTotal} комірок сітки — продовжуємо автоматично (кеш комірок у Vercel Blob зберігає прогрес)...`,
      );
      const backoffMs = Math.min(BACKOFF_STEP_MS * iteration, BACKOFF_CEILING_MS);
      console.log(
        `[generate-btw-tiles] пауза ${Math.round(backoffMs / 1000)}с перед наступним проходом — даємо публічним Overpass-дзеркалам "охолонути" після можливого rate-limit'у...`,
      );
      await sleep(backoffMs);
      iteration += 1;
      result = await generateTilesForCity(citySlug, cameras, CLI_TILE_OPTIONS);
    }

    if (!result.complete) {
      console.error(
        `[generate-btw-tiles] зупинено після ${MAX_ITERATIONS} проходів, усе ще частково готово: ${result.cellsDone}/${result.cellsTotal} комірок сітки. Схоже, певні комірки НІКОЛИ не завершуються (надто щільна/велика ділянка для одного Overpass-запиту навіть після зменшення розміру комірки, § tile-generation.util.ts) — просто повторний запуск цього скрипта навряд чи допоможе; потрібне подальше зменшення GRID_CELL_SIZE_M або адаптивне дроблення проблемних комірок.`,
      );
      process.exit(1);
    }

    console.log(
      `[generate-btw-tiles] done. buildings=${result.buildingCount} (${result.buildingBytes} bytes), cameras=${result.cameraCount}, streets=${result.streetCount}`,
    );
    console.log(`[generate-btw-tiles] bbox: ${JSON.stringify(result.bbox)}`);
    console.log(`[generate-btw-tiles] written to Vercel Blob, prefix ${result.cityBlobPrefix}`);
    console.log(`[generate-btw-tiles] GET /btw/manifest?city=${citySlug} should now report scanMode:"local-worker".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[generate-btw-tiles] failed:', err);
  process.exit(1);
});

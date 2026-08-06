// apps/api/scripts/import-trafficvision-cameras.ts
//
// Окремий CLI-скрипт для імпорту камер з TrafficVision.Live (за прямим запитом користувача —
// "написать парсер именно под открытый слой camera-data/*.json ... создать отдельный скрипт
// со слагом интересующего города в параметрах - при запуске без слага города с паузой в
// 2 минуты по очереди парсить все города"). Повне дослідження сайту (реальні мережеві запити +
// аналіз JS-бандла), обґрунтування вибору саме відкритого шару даних (не захищеного каталогу —
// той навмисно НЕ чіпається, спробу відтворити його сесію заблокував сам інструмент розробки)
// і структура JSON — усе в providers/trafficvision-sources.ts і providers/trafficvision.adapter.ts
// (клас-коментарі там), doc/AUDIT-trafficvision-parser.md.
//
// ⚠️ ЧЕСНО, важливо для очікувань: "слаг" тут — це СЛАГ ДЖЕРЕЛА (агентства/оператора:
// "oktraffic", "bpjt"), НЕ слаг міста (City.slug цього проєкту, як в generate-btw-tiles.ts).
// camera-data влаштований по джерелах, не по містах — одне джерело може охоплювати цілий штат
// чи цілу країну багатьма містами (bpjt — платні дороги ВСІЄЇ Індонезії). Користувач попросив
// саме "слаг города" — але з реальним дослідженням сайту з'ясувалось, що відкритих джерел
// усього ДВА (oktraffic, bpjt), а не "багато міст і країн", як очікувалось спочатку (детально
// пояснено користувачу в чаті перед цим кроком) — тому і "перебір усіх міст" тут означає
// "перебір усіх ВІДОМИХ ВІДКРИТИХ джерел" (TRAFFICVISION_SOURCES), яких зараз двоє.
//
// На відміну від generate-btw-tiles.ts (raw `new PrismaClient()`, без Nest DI) — цей скрипт
// НАВМИСНО піднімає повний Nest-контекст (`NestFactory.createApplicationContext`), щоб
// викликати САМЕ `ScraperService.runForProvider()` — той самий метод, що й адмінська кнопка
// "Запустить парсер" використовує для будь-якого іншого провайдера. Це свідомий вибір:
// dedup (CameraSourceRaw), NEEDS_REVIEW-черга для низької впевненості геокодингу (хоча тут
// координати завжди прямі від джерела — geocodingComplete:true, тож цей шлях фактично не
// спрацьовує), ParserRunLog-історія, аномалія-детекція — уся ця логіка вже існує в
// ScraperService і НЕ дублюється тут вручну (той самий принцип, що вже застосований у
// btw-tiles: спільна логіка виноситься в один файл, а не копіюється в скрипт і в сервіс
// окремо). Побічний ефект — ці провайдери одразу видно і керовано зі звичайної адмінки
// (/admin/parsers чи де там список провайдерів), без жодної додаткової роботи.
//
// Використання:
//   cd apps/api
//   npx ts-node scripts/import-trafficvision-cameras.ts oktraffic   # тільки одне джерело
//   npx ts-node scripts/import-trafficvision-cameras.ts bpjt
//   npx ts-node scripts/import-trafficvision-cameras.ts             # ВСІ відомі джерела по черзі,
//                                                                    # пауза 2 хв між кожним
//
// Потребує DATABASE_URL (те саме, що й уся решта проєкту) — `vercel env pull`, якщо не задано
// локально. Провайдери (CameraProvider) мають бути заздалегідь заведені —
// sql/trafficvision-providers-seed.sql (вже підключено в docker-entrypoint.sh, прогониться
// автоматично; якщо база не через docker-entrypoint.sh — прогнати вручну, скрипт нижче дасть
// зрозумілу помилку, якщо провайдера не знайдено).

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ScraperService } from '../src/scraper/scraper.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TRAFFICVISION_SOURCES, adapterKeyForSlug, findTrafficVisionSource } from '../src/scraper/providers/trafficvision-sources';

const PAUSE_BETWEEN_SOURCES_MS = 2 * 60 * 1000; // 2 минуты — за прямым запросом пользователя

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneSource(scraperService: ScraperService, prisma: PrismaService, slug: string): Promise<void> {
  const adapterKey = adapterKeyForSlug(slug);
  const provider = await prisma.cameraProvider.findUnique({ where: { adapterKey } });
  if (!provider) {
    console.error(
      `[import-trafficvision-cameras] провайдер "${adapterKey}" не найден в БД — сначала прогоните ` +
        `sql/trafficvision-providers-seed.sql (docker compose exec api npx prisma db execute --file sql/trafficvision-providers-seed.sql --schema prisma/schema.prisma), ` +
        `либо перезапустите контейнер (уже подключено в docker-entrypoint.sh).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[import-trafficvision-cameras] источник "${slug}" (${provider.name}) — запуск...`);
  const run = await scraperService.runForProvider(provider.id, 'manual');
  console.log(
    `[import-trafficvision-cameras] источник "${slug}": статус=${run.status}, найдено=${run.discoveredCount ?? 0}, ` +
      `новых=${run.newCount ?? 0}, обновлено=${run.updatedCount ?? 0}, на ревью=${run.needsReviewCount ?? 0}, ошибок=${run.errorCount ?? 0}` +
      (run.errorMessage ? `, сообщение: ${run.errorMessage}` : ''),
  );

  // ВИПРАВЛЕНО (реальний знайдений інцидент — живий прогін користувача дав discoveredCount=0/
  // errorCount=0 без жодного пояснення в консолі): причина "0 знайдено" завжди пишеться
  // ScraperService.runForProvider() у ImportLogEntry (stage:'FETCH_PAGE', з diagnostics
  // адаптера в metadata) — але ТІЛЬКИ в БД, не в консоль. Раніше побачити її можна було лише
  // через адмінку; тепер CLI сам витягує й друкує цей самий запис одразу після прогону, щоб не
  // змушувати гортати адмінку заради єдиного рядка причини.
  if (run.discoveredCount === 0) {
    const fetchPageEntry = await prisma.importLogEntry.findFirst({
      where: { runId: run.id, stage: 'FETCH_PAGE' },
      orderBy: { timestamp: 'desc' },
    });
    if (fetchPageEntry) {
      console.log(`[import-trafficvision-cameras] источник "${slug}": причина 0 найденных камер — ${fetchPageEntry.message}`);
      if (fetchPageEntry.metadata) console.log(`[import-trafficvision-cameras] источник "${slug}": diagnostics =`, JSON.stringify(fetchPageEntry.metadata));
    }
  }
}

async function main() {
  const sourceSlug = process.argv[2];

  if (sourceSlug) {
    const source = findTrafficVisionSource(sourceSlug);
    if (!source) {
      console.error(
        `[import-trafficvision-cameras] неизвестный слаг источника "${sourceSlug}". Известные: ${TRAFFICVISION_SOURCES.map((s) => s.slug).join(', ')}.\n` +
          `Usage: ts-node import-trafficvision-cameras.ts [sourceSlug]   (без аргумента — все известные источники по очереди, пауза 2 мин)`,
      );
      process.exit(1);
    }
  }

  console.log('[import-trafficvision-cameras] поднимаем Nest-контекст (без HTTP-сервера)...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const scraperService = app.get(ScraperService);
  const prisma = app.get(PrismaService);

  try {
    if (sourceSlug) {
      await runOneSource(scraperService, prisma, sourceSlug);
      return;
    }

    console.log(`[import-trafficvision-cameras] аргумент не задан — перебираем все ${TRAFFICVISION_SOURCES.length} известных источника(ов) по очереди, пауза ${PAUSE_BETWEEN_SOURCES_MS / 60000} мин между каждым.`);
    for (let i = 0; i < TRAFFICVISION_SOURCES.length; i++) {
      const source = TRAFFICVISION_SOURCES[i];
      await runOneSource(scraperService, prisma, source.slug);

      const isLast = i === TRAFFICVISION_SOURCES.length - 1;
      if (!isLast) {
        console.log(`[import-trafficvision-cameras] пауза ${PAUSE_BETWEEN_SOURCES_MS / 60000} мин перед следующим источником...`);
        await sleep(PAUSE_BETWEEN_SOURCES_MS);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[import-trafficvision-cameras] failed:', err);
  process.exit(1);
});

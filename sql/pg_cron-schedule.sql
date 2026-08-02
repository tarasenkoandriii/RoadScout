-- Requires the `pg_cron` and `pg_net` extensions enabled in Supabase
-- (Database > Extensions in the Supabase dashboard).

-- Охват всех городов (см. doc/TZ-parser-import-improvements.md, П2.2): один job бьёт по
-- /internal/parser/run-all, который сам находит ВСЕ строки CameraProvider и обходит их по
-- очереди с задержкой между запросами (см. PARSER_RUN_ALL_DELAY_MS в apps/api/.env.example) —
-- не нужно заводить отдельную запись расписания на каждый новый город вручную.
select cron.schedule(
  'parser-run-all-daily',
  '0 3 * * *', -- 03:00 every day (server time, usually UTC on Supabase)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/parser/run-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Пошук сайтів-агрегаторів (див. AggregatorDiscoveryService, doc/AUDIT-google-web-search-cameras.md)
-- — окремий, ще рідший розклад (раз на 3 дні — результат не змінюється швидко, це довідкова
-- таблиця кандидатів для ручного дослідження, не жива черга камер).
select cron.schedule(
  'aggregator-discovery-every-3-days',
  '0 4 */3 * *', -- 04:00, кожні 3 дні
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/aggregator-discovery/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Windy Webcams API (див. WindyWebcamsAdapter, doc/AUDIT-windy-webcams-and-nature-cameras.md)
-- — окремий job, той самий принцип взаємного виключення.
select cron.schedule(
  'parser-run-all-windy-daily',
  '15 4 * * *', -- 04:15 every day — після aggregator-discovery-every-3-days (04:00)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/parser/run-all-windy',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Batch API xAI (глибша переробка — за прямим запитом користувача, doc/AUDIT-grok-batch-api.md)
-- — асинхронний шлях, окремий від синхронного aggregator-discovery-every-3-days вище (той
-- лишається як є для сумісності). Подача пачки — та сама частота (раз на 3 дні, той самий
-- час, щоб не збігатися); опитування готовності — щогодини (Batch API типово до 24 годин,
-- частіше опитувати немає сенсу).
select cron.schedule(
  'aggregator-discovery-submit-batch-every-3-days',
  '30 4 */3 * *', -- 04:30, кожні 3 дні — трохи пізніше за aggregator-discovery-every-3-days (04:00)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/aggregator-discovery/submit-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'aggregator-discovery-process-pending-batches-hourly',
  '0 * * * *', -- щогодини
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/aggregator-discovery/process-pending-batches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To inspect scheduled jobs:
-- select * from cron.job;

-- To unschedule:
-- select cron.unschedule('parser-run-all-daily');

-- To see pg_net delivery results (separate from ParserRunLog, useful for debugging
-- network-level failures like DNS/TLS/timeouts before the request reaches the API):
-- select * from net._http_response order by created desc limit 20;

-- Монитор камер (глава 6): каждые 15 минут.
select cron.schedule(
  'camera-monitoring-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/monitoring/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- YouTube-пошук камер (див. doc/TZ-youtube-camera-discovery.md) — ОКРЕМИЙ endpoint і job від
-- run-all вище (той навмисно виключає youtube-search-* — див. ScraperService.runAll()) —
-- реальна квота YouTube Data API (100 одиниць/виклик search.list, ~90 безпечних викликів/добу,
-- 2 виклики на місто → до ~45 міст на один прохід у межах денної квоти). Розклад свідомо
-- рідший/зсунутий у часі відносно parser-run-all-daily, щоб не конкурувати за той самий вікно.
select cron.schedule(
  'parser-run-all-youtube-daily',
  '15 3 * * *', -- 03:15 every day — одразу після parser-run-all-daily (03:00)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/parser/run-all-youtube',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Пошук окремих камер через Google (веб-пошук Grok, див. doc/AUDIT-google-web-search-cameras.md)
-- — окремий job/endpoint, той самий принцип, що parser-run-all-youtube-daily вище.
select cron.schedule(
  'parser-run-all-websearch-daily',
  '45 3 * * *', -- 03:45 every day — після parser-run-all-youtube-daily (03:15) і camera-content-availability-daily (03:30)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/parser/run-all-websearch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Перевірка доступності контенту (див. doc/AUDIT-camera-content-availability.md) — окремий,
-- набагато рідший розклад, ніж швидкий 15-хвилинний моніторинг вище: YouTube oEmbed + AI
-- vision-резерв дорожчі й повільніші за просту перевірку досяжності, тому раз на добу
-- достатньо. Свідомо ОКРЕМИЙ endpoint від /internal/parser/* — не частина автоімпорту/парсера.
select cron.schedule(
  'camera-content-availability-daily',
  '30 3 * * *', -- 03:30 every day — трохи пізніше за parser-run-all-daily (03:00), щоб не збігатись
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/monitoring/check-content-availability',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Підписки-алерти (src/alerts): перевірка умов кожні 5 хвилин — досить часто для сповіщень про
-- статус камери/нові інциденти, не надто часто, щоб не перевантажувати Telegram Bot API.
select cron.schedule(
  'alerts-check-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/alerts/check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Batch API xAI для калібрування камер (за прямим запитом користувача, розширення
-- GrokBatchJob на камери — doc/AUDIT-grok-batch-api.md, розділ "Оновлення") — фонове
-- опитування, щогодини (та сама частота, що опитування пакетів сайтів-агрегаторів вище).
select cron.schedule(
  'camera-calibration-process-pending-batches-hourly',
  '5 * * * *', -- щогодини, о 5-й хвилині (трохи зсунуто відносно aggregator-discovery-process-pending-batches-hourly, щоб не збігатись)
  $$
  select net.http_post(
    url := 'https://<your-api-domain>/internal/cameras/process-pending-calibration-batches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<PARSER_CRON_SECRET value, same as in the API env>'
    ),
    body := '{}'::jsonb
  );
  $$
);

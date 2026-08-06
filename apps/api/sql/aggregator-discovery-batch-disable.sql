-- Позначає ЗАСТАРІЛІ (доопрацьовані до відмови від Batch API) записи GrokBatchJob для
-- aggregator-discovery як 'failed' — щоб processPendingBatches() (cron) більше НЕ намагався
-- нескінченно опитувати їх (getBatchStatus/getBatchResults продовжували б "успішно" повертати
-- ту саму порожню відповідь щоразу, job ніколи природно не завершився б).
--
-- Контекст (див. doc/AUDIT-grok-batch-api.md, розділ "xAI Batch API + web_search: чому
-- пакетний пошук сайтів-агрегаторів скасовано"): реальний виклик (batch_cfdf2c2c-...,
-- 30/30 completed за скріншотом користувача з консолі xAI) показав, що xAI Batch API НЕ
-- виконує web_search попри офіційну документацію, яка обіцяє протилежне — кожна відповідь
-- повертається з message.content: "" і невиконаним tool_calls. Це підтверджене обмеження
-- платформи xAI, не виправна помилка формату запиту з нашого боку. За прямим вибором
-- користувача ("Отказаться от Batch API для этой задачи (рекомендую)") Batch API для
-- aggregator-discovery вимкнено в коді (AggregatorDiscoveryService.submitBatchDiscovery()) —
-- цей скрипт лише прибирає "хвіст" уже наявних pending/processing записів від попередніх
-- запусків (зокрема сам batch_cfdf2c2c-... з 30 містами).
--
-- Прогнати:
--   docker compose exec api npx prisma db execute --file sql/aggregator-discovery-batch-disable.sql --schema prisma/schema.prisma
--
-- Ідемпотентно — WHERE-умова (status IN ('pending','processing')) природно перестає щось
-- знаходити після першого успішного запуску. camera-calibration job'и (інший jobType) НЕ
-- зачіпаються — той шлях Batch API й далі повністю робочий.
--
-- ⚠️ ПЕРЕД запуском UPDATE — рекомендується спершу виконати самостійно лише SELECT нижче
-- (закоментований UPDATE), щоб вручну звірити список job'ів, які буде позначено.

-- SELECT id, "xaiBatchId", "jobType", status, "createdAt"
-- FROM "GrokBatchJob"
-- WHERE "jobType" = 'aggregator-discovery'
--   AND status IN ('pending', 'processing');

UPDATE "GrokBatchJob"
SET status = 'failed',
    "processedAt" = NOW()
WHERE "jobType" = 'aggregator-discovery'
  AND status IN ('pending', 'processing');

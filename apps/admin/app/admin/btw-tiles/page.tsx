'use client';

import { useEffect, useRef, useState } from 'react';

// За прямим запитом користувача — "сделай новую вкладку в админке для запуска скрипта...
// npx ts-node scripts/generate-btw-tiles.ts kyiv... по городам (список селекто городов)".
// Ця вкладка — веб-обгортка над тим самим генератором (apps/api/src/btw/
// tile-generation.util.ts::generateTilesForCity(), спільна логіка з CLI-скриптом
// apps/api/scripts/generate-btw-tiles.ts — жодного дублювання Overpass/кодування тайлів).
//
// ⚠️ ЧЕСНО: адмінська кнопка нижче виконує запит СИНХРОННО (той самий патерн, що вже
// "Запустить все источники" на /admin/parser — await fetch(...), кнопка блокується до
// завершення) — і може займати до ~1-2 хвилин (два Overpass-запити, нехай і паралельно,
// §4.7.1 ТЗ). Для дуже великих/щільних міст це може впертися в ліміт serverless-функції
// (Vercel Hobby — 300с, doc/AUDIT-vercel-hobby.md) — сервер у такому разі поверне зрозумілу
// помилку з підказкою запустити CLI-скрипт локально (там такого обмеження немає).
//
// ІДЕМПОТЕНТНІСТЬ + МОНІТОРИНГ ЧАСУ (за прямим запитом користувача — "сделай возможность
// идемпотентного мнгоразового запуска с мониторингом времени - как уже делали с камерами"):
// нижче тепер опитується GET /btw/admin/generation-status (BtwService.getGenerationStatus()) —
// показує, чи вже виконується запуск для обраного міста (у т.ч. запущений В ІНШІЙ вкладці/
// адміном — не лише в цьому браузері), скільки часу він вже триває, і коротку історію останніх
// спроб із причиною провалу. Повторний клік на кнопку, поки запуск ще живий, повертає від
// сервера 409 (BtwService.generateTiles()) замість того, щоб тихо продублювати запит до
// Overpass — саме це тут і має на увазі "ідемпотентний повторний запуск".

interface CityOption {
  cityId: string;
  name: string;
  slug: string;
  cameraCount: number;
}

interface ManifestLayerInfo {
  url: string;
  version: number;
}

interface Manifest {
  city: string;
  declination: number;
  scanMode: 'server-fallback-only' | 'local-worker';
  layers: { buildings: ManifestLayerInfo; cameras: ManifestLayerInfo; streets: ManifestLayerInfo } | null;
}

interface GenerateResult {
  citySlug: string;
  cityBlobPrefix: string;
  bbox: { south: number; west: number; north: number; east: number };
  cameraCount: number;
  buildingCount: number;
  buildingBytes: number;
  streetCount: number;
  // ДОПОВНЕНО (за прямим запитом користувача — "сделай запуски из вкладки идемпотентными -
  // несколько запусков подряд до исчерпания списка ячеек"): generateTilesForCity() тепер може
  // повернутись ДО завершення всієї сітки комірок (великий часовий бюджет вичерпано, кеш на
  // диску вже зберігає прогрес) — complete: false відрізняє це від справжнього "Готово".
  complete: boolean;
  cellsTotal: number;
  cellsDone: number;
}

interface GenerationRun {
  id: string;
  citySlug: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  cameraCount: number | null;
  buildingCount: number | null;
  streetCount: number | null;
  cellsTotal: number | null;
  cellsDone: number | null;
  elapsedMs?: number | null; // заповнено сервером ЛИШЕ для latest.status === 'running'
}

interface GenerationStatus {
  citySlug: string;
  latest: GenerationRun | null;
  history: GenerationRun[];
}

// Опитування статусу поки триває "running" — той самий часовий бюджет за замовчуванням
// (6 хв), що й BTW_TILE_GENERATION_STALE_RUN_MS на сервері (btw.service.ts), просто щоб
// таймер тут не крутився нескінченно, якщо щось пішло геть не так і статус ніколи не змінився.
const STATUS_POLL_MS = 4000;
const LOCAL_TICK_MS = 1000;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}м ${seconds}с` : `${seconds}с`;
}

function runStatusLabel(status: GenerationRun['status']): string {
  if (status === 'running') return '⏳ выполняется';
  if (status === 'completed') return '✅ успешно';
  // 'partial' — НЕ ошибка (см. комментарий у BtwService.generateTiles()): часовий бюджет
  // одного виклику вичерпано, прогрес по комірках збережено на диску, потрібен ще клік.
  if (status === 'partial') return '🟡 частично готово';
  return '❌ ошибка';
}

export default function BtwTilesPage() {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<GenerationStatus | null>(null);
  const [nowTick, setNowTick] = useState(0); // тік для живого таймера — сам не несе даних

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingCities(true);
      try {
        // Той самий ендпоінт, що вже "BTW: подмена координат" використовує для вибору міста
        // (тепер розширений полем `slug`, див. BtwService.listCitiesWithCameraDensity()) —
        // жодного нового бекенд-виклику для самого списку не знадобилось.
        const res = await fetch('/api/btw/admin/dev-cities', { credentials: 'include' });
        if (res.ok) setCities(await res.json());
      } catch {
        setError('Не удалось загрузить список городов');
      } finally {
        setLoadingCities(false);
      }
    })();
  }, []);

  async function loadManifest(slug: string) {
    setManifestLoading(true);
    setManifest(null);
    try {
      const res = await fetch(`/api/btw/manifest?city=${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (res.ok) setManifest(await res.json());
    } catch {
      setError('Не удалось проверить текущий статус тайлов');
    } finally {
      setManifestLoading(false);
    }
  }

  // Повертає свіжий статус (для першого завантаження і для кожного опитування) — окремо від
  // loadManifest вище, бо це різні ендпоінти з різним сенсом (стан ФАЙЛІВ vs стан ЗАПУСКІВ).
  async function fetchStatus(slug: string): Promise<GenerationStatus | null> {
    try {
      const res = await fetch(`/api/btw/admin/generation-status?city=${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (!res.ok) return null;
      return (await res.json()) as GenerationStatus;
    } catch {
      return null;
    }
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }

  // Поки latest.status === 'running' — опитуємо сервер раз на STATUS_POLL_MS (дізнатись, чи
  // не завершилось — і саме сервер, а не клієнт, вирішує це остаточно: запуск міг бути
  // розпочатий в ІНШІЙ вкладці/адміном) і окремо "тікаємо" раз на секунду (LOCAL_TICK_MS) для
  // плавного живого таймера між опитуваннями, замість того, щоб число застигало на 4с.
  function startPollingIfRunning(slug: string, status: GenerationStatus | null) {
    stopPolling();
    if (status?.latest?.status !== 'running') return;

    tickTimerRef.current = setInterval(() => setNowTick((t) => t + 1), LOCAL_TICK_MS);
    pollTimerRef.current = setInterval(async () => {
      const fresh = await fetchStatus(slug);
      setGenStatus(fresh);
      if (fresh?.latest?.status !== 'running') {
        stopPolling();
        await loadManifest(slug); // запуск (свій чи чужой) завершився — оновити статус тайлов
      }
    }, STATUS_POLL_MS);
  }

  useEffect(() => stopPolling, []); // прибрати таймери при виході зі сторінки

  async function handleSelectCity(slug: string) {
    stopPolling();
    setSelectedSlug(slug);
    setResult(null);
    setError(null);
    setGenStatus(null);
    if (!slug) return;
    await loadManifest(slug);
    const status = await fetchStatus(slug);
    setGenStatus(status);
    startPollingIfRunning(slug, status);
  }

  async function handleGenerate() {
    if (!selectedSlug) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/btw/admin/generate-tiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ city: selectedSlug }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // 409 (уже выполняется — см. BtwService.generateTiles()) выглядит так же, как любая
        // другая ошибка, но статус ниже тут же покажет живой таймер того запуска, который
        // реально идёт — так что "ошибка" в этом случае не тупик, а просто устаревшее нажатие.
        setError(body?.message ?? 'Не удалось сгенерировать тайлы');
        return;
      }
      setResult(body);
      await loadManifest(selectedSlug); // обновить статус — теперь должен показать local-worker
    } catch {
      setError('Ошибка сети при генерации тайлов');
    } finally {
      setGenerating(false);
      const status = await fetchStatus(selectedSlug);
      setGenStatus(status);
      startPollingIfRunning(selectedSlug, status);
    }
  }

  const selectedCity = cities.find((c) => c.slug === selectedSlug);
  const latestRun = genStatus?.latest ?? null;
  const isRunningRemotely = latestRun?.status === 'running';
  // 'partial' — НЕ блокирует кнопку (в отличие от 'running'): это результат ЗАВЕРШИВШЕГОСЯ
  // вызова, который просто не успел обработать все ячейки сетки за свой часовой бюджет —
  // прогресс уже сохранён на диске (см. tile-generation.util.ts::fetchLayerGridResumable()),
  // следующий клик по кнопке продолжит именно с этого места (идемпотентно).
  const isPartial = latestRun?.status === 'partial';
  // elapsedMs — снимок с сервера на момент последнего fetchStatus(); nowTick лишь заставляет
  // React перерисовать между опросами, реальное число всегда считаем от startedAt заново —
  // так таймер не "залипает" на устаревшем значении между STATUS_POLL_MS.
  const liveElapsedMs = isRunningRemotely && latestRun ? Date.now() - new Date(latestRun.startedAt).getTime() : null;
  void nowTick; // используется только чтобы триггернуть перерисовку — само значение не нужно

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">BTW: тайлы радара (локальное сканирование)</h1>
      <p className="mb-4 text-sm text-gray-600">
        Генерирует три файла тайлов (здания/камеры/улицы, §4.7.1 ТЗ) для выбранного города — то же самое, что{' '}
        <code>npx ts-node scripts/generate-btw-tiles.ts &lt;slug&gt;</code>, но одной кнопкой. После генерации BTW mini-app
        начинает сканировать локально в Web Worker, без запросов на сервер при каждом тике.
      </p>

      {error && <div className="mb-4 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-6 rounded border p-4">
        <h2 className="mb-2 font-medium">Выбор города</h2>
        <select
          className="w-full rounded border px-2 py-1 text-sm mb-3"
          value={selectedSlug}
          onChange={(e) => handleSelectCity(e.target.value)}
          disabled={loadingCities || generating}
        >
          <option value="">{loadingCities ? 'Загрузка…' : cities.length === 0 ? 'Нет городов с камерами' : 'Выбрать город…'}</option>
          {cities.map((c) => (
            <option key={c.cityId} value={c.slug}>
              {c.name} ({c.cameraCount} {c.cameraCount === 1 ? 'камера' : 'камер'}) — slug: {c.slug || '(?)'}
            </option>
          ))}
        </select>

        {selectedCity && !selectedCity.slug && (
          <div className="mb-3 rounded bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
            У этого города не задан <code>slug</code> в базе — генерация не сработает, пока не заполните это поле в
            /admin/cameras (или напрямую в БД).
          </div>
        )}

        {manifestLoading && <p className="mb-3 text-xs text-gray-500">Проверяем текущий статус тайлов…</p>}

        {manifest && (
          <div className="mb-3 rounded bg-gray-50 border px-3 py-2 text-xs text-gray-700">
            {manifest.layers ? (
              <>
                <div className="mb-1 font-medium text-green-700">🟢 Тайлы уже есть — scanMode: local-worker</div>
                <div>Здания: сгенерированы {new Date(manifest.layers.buildings.version).toLocaleString('ru-RU')}</div>
                <div>Камеры: сгенерированы {new Date(manifest.layers.cameras.version).toLocaleString('ru-RU')}</div>
                <div>Улицы: сгенерированы {new Date(manifest.layers.streets.version).toLocaleString('ru-RU')}</div>
              </>
            ) : (
              <div className="text-gray-500">⚪ Тайлов пока нет — BTW mini-app использует серверный /api/scan (без изменений)</div>
            )}
          </div>
        )}

        {isRunningRemotely && latestRun && (
          <div className="mb-3 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            <div className="font-medium">⏳ Генерация уже выполняется — {formatDuration(liveElapsedMs ?? latestRun.elapsedMs ?? 0)}</div>
            <div className="mt-0.5 text-blue-700">
              Запущена {new Date(latestRun.startedAt).toLocaleTimeString('ru-RU')} (возможно, из другой вкладки/другим админом) —
              повторный запуск заблокирован сервером, пока этот не завершится или не зависнет дольше отведённого времени.
            </div>
          </div>
        )}

        {isPartial && latestRun && (
          <div className="mb-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <div className="font-medium">
              🟡 Частично готово — {latestRun.cellsDone ?? '?'}/{latestRun.cellsTotal ?? '?'} ячеек сетки
              {latestRun.durationMs != null ? ` (за ${formatDuration(latestRun.durationMs)})` : ''}
            </div>
            <div className="mt-0.5 text-amber-700">
              Город большой — Overpass не успевает отдать все ячейки за один вызов (лимит ~220с на попытку). Прогресс уже
              сохранён на диске: нажмите кнопку ещё раз, чтобы продолжить с того же места — так до исчерпания списка ячеек.
              Ничего не потеряется, если закрыть вкладку между попытками.
            </div>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!selectedSlug || !selectedCity?.slug || generating || isRunningRemotely}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {generating
            ? 'Генерация… (до 1-2 минут, не закрывайте вкладку)'
            : isRunningRemotely
              ? 'Уже выполняется…'
              : isPartial
                ? 'Продолжить генерацию'
                : 'Сгенерировать тайлы'}
        </button>

        <p className="mt-2 text-xs text-gray-500">
          Для очень больших/плотных городов запрос может не уложиться в лимит serverless-функции (Vercel Hobby — 300с) — в
          этом случае сервер вернёт понятную ошибку с подсказкой запустить тот же скрипт локально:{' '}
          <code>npx ts-node scripts/generate-btw-tiles.ts {selectedSlug || '<slug>'}</code>. Повторный клик по кнопке безопасен —
          сервер не запустит вторую генерацию параллельно (см. блок выше, если запуск уже идёт).
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Ошибка вида <code>Overpass HTTP 406</code> — не сбой запроса и не таймаут, а фильтр против ботов на основном сервере
          Overpass (реальный случай, поймали на New York) — сервер теперь сам пробует резервные зеркала
          (<code>tile-generation.util.ts::getOverpassEndpoints()</code>), повторно жать кнопку из-за этой ошибки не нужно.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Для очень больших городов (сотни камер, сетка из десятков ячеек) один клик может не успеть обработать всё — тогда
          статус станет «🟡 частично готово», и нужно будет нажать кнопку ещё раз (и, возможно, ещё раз), пока ячейки не
          закончатся. Это ожидаемо и безопасно — уже готовые ячейки не запрашиваются повторно.
        </p>
      </div>

      {result && result.complete && (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <h2 className="mb-2 font-medium">Готово</h2>
          <div>Здания: {result.buildingCount} ({(result.buildingBytes / 1024).toFixed(1)} КБ)</div>
          <div>Камеры: {result.cameraCount}</div>
          <div>Улицы (сегменты): {result.streetCount}</div>
          <div className="mt-1 text-xs text-green-700">
            Записано в Vercel Blob (префикс {result.cityBlobPrefix}). GET /btw/manifest?city={result.citySlug} теперь вернёт scanMode: &quot;local-worker&quot;.
          </div>
        </div>
      )}

      {/* result.complete === false — это тот же самый успешный ответ сервера, просто сітка
          комірок обробилась не повністю за один виклик; фінальні файли тайлів ще НЕ записані
          (див. generateTilesForCity() — вони пишуться лише коли complete === true), тому "Готово"
          вище тут не показуємо — натомість блок "🟡 частично готово" вище кнопки вже пояснює, що
          робити далі (нажать кнопку ещё раз). */}

      {genStatus && (genStatus.latest || genStatus.history.length > 0) && (
        <div className="mt-6 rounded border p-4">
          <h2 className="mb-2 font-medium text-sm">История запусков для этого города</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-1 pr-3">Начало</th>
                <th className="pb-1 pr-3">Статус</th>
                <th className="pb-1 pr-3">Длительность</th>
                <th className="pb-1">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {[genStatus.latest, ...genStatus.history].filter((r): r is GenerationRun => !!r).map((run) => (
                <tr key={run.id} className="border-t align-top">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(run.startedAt).toLocaleString('ru-RU')}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{runStatusLabel(run.status)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {run.status === 'running'
                      ? formatDuration((run.elapsedMs ?? liveElapsedMs) || 0)
                      : run.durationMs != null
                        ? formatDuration(run.durationMs)
                        : '—'}
                  </td>
                  <td className="py-1 text-gray-600">
                    {run.status === 'completed'
                      ? `здания: ${run.buildingCount ?? '?'}, камеры: ${run.cameraCount ?? '?'}, улицы: ${run.streetCount ?? '?'}`
                      : run.status === 'partial'
                        ? `${run.cellsDone ?? '?'}/${run.cellsTotal ?? '?'} ячеек — нажмите «Продолжить генерацию» выше`
                        : run.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

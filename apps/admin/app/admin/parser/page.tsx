'use client';

import { useEffect, useRef, useState } from 'react';

interface RunSummary {
  status: string;
  startedAt: string;
  discoveredCount: number;
  newCount: number;
  autoImportedCount: number;
  needsReviewCount: number;
  errorCount: number;
}

interface ProviderStat {
  providerId: string;
  providerName: string;
  lastRun: RunSummary | null;
  successRateLast10: number | null;
  totalCameras: number;
  needsReviewCount: number;
  azimuthFallbackCount: number;
  azimuthHeuristicCount: number;
}

interface RunLog {
  id: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  durationMs: number | null;
  discoveredCount: number;
  newCount: number;
  autoImportedCount: number;
  needsReviewCount: number;
  errorCount: number;
  anomalyFlag: boolean;
  provider: { name: string };
}

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
};

export default function ParserAdminPage() {
  const [stats, setStats] = useState<ProviderStat[]>([]);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [statsRes, runsRes] = await Promise.all([
      fetch('/api/admin/parser/stats/summary').then((r) => r.json()),
      fetch('/api/admin/parser/runs?take=50').then((r) => r.json()),
    ]);
    setStats(statsRes);
    setRuns(runsRes);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const runNow = async (providerId: string) => {
    setRunningId(providerId);
    try {
      await fetch(`/api/admin/parser/run/${providerId}`, { method: 'POST' });
      await load();
    } finally {
      setRunningId(null);
    }
  };

  const [runningAll, setRunningAll] = useState(false);
  const runAll = async () => {
    setRunningAll(true);
    try {
      // Охват всех городов (см. doc/TZ-parser-import-improvements.md, П2.2) — обходит все
      // источники по очереди с задержкой между ними на бэкенде, здесь просто один запрос.
      await fetch('/api/admin/parser/run-all', { method: 'POST' });
      await load();
    } finally {
      setRunningAll(false);
    }
  };

  const [dryRunLoading, setDryRunLoading] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const runDryRun = async (providerId: string, deep = false) => {
    setDryRunLoading(providerId);
    try {
      const res = await fetch(`/api/admin/parser/dry-run/${providerId}${deep ? '?deep=true' : ''}`, { method: 'POST' });
      const data = await res.json();
      const providerName = stats.find((s) => s.providerId === providerId)?.providerName ?? providerId;
      setDryRunResult({ ...data, providerId, providerName });
    } finally {
      setDryRunLoading(null);
    }
  };

  // Ручной запуск YouTube/Google-поиска (см. запрос пользователя: "для дебагу та початкового
  // наповнення бази") — обычно эти семейства крутятся по собственному, более редкому cron
  // (см. sql/pg_cron-schedule.sql), но для отладки/первого наполнения базы удобнее запустить
  // прямо сейчас, не дожидаясь ночного прохода. ВАЖНО: реально тратит квоту/деньги (YouTube
  // Data API — 100 единиц/вызов; Grok web_search — платный tool-вызов) — не нажимать бездумно
  // помногу раз подряд.
  // Експорт списку камер провайдера як JSON (див. запит користувача, значок біля "Камер в
  // реестре") — просто скачує вже готовий JSON браузером, без додаткової серверної логіки
  // окрім самого ендпоінта.
  const [exportingProviderId, setExportingProviderId] = useState<string | null>(null);
  const exportProviderCameras = async (providerId: string, providerName: string) => {
    setExportingProviderId(providerId);
    try {
      const res = await fetch(`/api/admin/cameras/export/${providerId}`, { credentials: 'include' });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cameras-${providerName.replace(/[^a-zA-Zа-яА-Я0-9]+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingProviderId(null);
    }
  };

  // Імпорт камер із JSON-файлу (див. запит користувача, значок імпорту одразу за заголовком)
  // — очікує той самий формат, що повертає export вище (round-trip).
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; total: number; errors: string[] } | null>(null);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // дозволяє повторно вибрати той самий файл наступного разу
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const cameras = Array.isArray(parsed) ? parsed : parsed.cameras;
      if (!Array.isArray(cameras)) {
        setImportResult({ created: 0, skipped: 0, total: 0, errors: ['Файл должен содержать массив камер (или объект { "cameras": [...] }).'] });
        return;
      }
      const res = await fetch('/api/admin/cameras/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameras }),
      });
      setImportResult(await res.json());
      await load();
    } catch (err) {
      setImportResult({ created: 0, skipped: 0, total: 0, errors: [`Не удалось прочитать файл: ${(err as Error).message}`] });
    } finally {
      setImporting(false);
    }
  };

  const [runningYoutube, setRunningYoutube] = useState(false);
  const [youtubeRunResult, setYoutubeRunResult] = useState<any[] | null>(null);
  const runAllYoutube = async () => {
    if (!confirm('Запустить YouTube-поиск по всем городам сейчас? Это тратит реальную квоту YouTube Data API (100 единиц за каждый запрос) — используйте для отладки/первого наполнения, не постоянно.')) return;
    setRunningYoutube(true);
    try {
      const res = await fetch('/api/admin/parser/run-all-youtube', { method: 'POST' });
      setYoutubeRunResult(await res.json());
      await load();
    } finally {
      setRunningYoutube(false);
    }
  };

  const [runningWebSearch, setRunningWebSearch] = useState(false);
  const [webSearchRunResult, setWebSearchRunResult] = useState<any[] | null>(null);
  const runAllWebSearch = async () => {
    if (!confirm('Запустить поиск отдельных камер через Google (Grok web_search) по всем городам сейчас? Это платные вызовы AI — используйте для отладки/первого наполнения, не постоянно.')) return;
    setRunningWebSearch(true);
    try {
      const res = await fetch('/api/admin/parser/run-all-websearch', { method: 'POST' });
      setWebSearchRunResult(await res.json());
      await load();
    } finally {
      setRunningWebSearch(false);
    }
  };

  return (
    <div className="p-6 space-y-10">
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Статистика парсера по источникам</h1>
            {/* Значок імпорту одразу за заголовком (див. запит користувача) — прихований file
                input + кнопка-тригер, приймає той самий JSON-формат, що повертає експорт нижче. */}
            <input ref={importFileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
            <button
              onClick={() => importFileInputRef.current?.click()}
              disabled={importing}
              title="Импортировать камеры из JSON-файла"
              className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {importing ? '⏳' : '📥'} Импорт
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runAll}
              disabled={runningAll}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {runningAll ? 'Запуск всех источников…' : 'Запустить все источники'}
            </button>
            {/* Ручной запуск YouTube/Google-поиска для дебагу/початкового наповнення бази —
                см. запрос пользователя. Обычно эти семейства крутятся по собственному, более
                редкому cron (см. sql/pg_cron-schedule.sql), эти кнопки просто дают запустить
                прямо сейчас, не дожидаясь ночного прохода. */}
            <button
              onClick={runAllYoutube}
              disabled={runningYoutube}
              title="Тратит реальную квоту YouTube Data API — используйте для отладки/первого наполнения"
              className="rounded bg-red-500 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {runningYoutube ? 'Запуск YouTube…' : '🤖 Запустить YouTube-поиск (debug)'}
            </button>
            <button
              onClick={runAllWebSearch}
              disabled={runningWebSearch}
              title="Платные вызовы Grok web_search — используйте для отладки/первого наполнения"
              className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {runningWebSearch ? 'Запуск Google-поиска…' : '🤖 Запустить Google-поиск (debug)'}
            </button>
          </div>
        </div>

        {importResult && (
          <div className="mb-4 rounded bg-green-50 p-3 text-xs">
            <p className="font-medium mb-1">
              Импорт завершён: создано {importResult.created} из {importResult.total}, пропущено {importResult.skipped}.
            </p>
            {importResult.errors.length > 0 && (
              <ul className="space-y-0.5 text-red-700">
                {importResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {youtubeRunResult && (
          <div className="mb-4 rounded bg-red-50 p-3 text-xs">
            <p className="font-medium mb-1">Результат ручного запуска YouTube-поиска ({youtubeRunResult.length} источников):</p>
            <ul className="space-y-0.5">
              {youtubeRunResult.map((r: any) => (
                <li key={r.runId}>
                  {r.providerName} — <span className={STATUS_STYLE[r.status] ? '' : ''}>{r.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {webSearchRunResult && (
          <div className="mb-4 rounded bg-purple-50 p-3 text-xs">
            <p className="font-medium mb-1">Результат ручного запуска Google-поиска ({webSearchRunResult.length} источников):</p>
            <ul className="space-y-0.5">
              {webSearchRunResult.map((r: any) => (
                <li key={r.runId}>
                  {r.providerName} — {r.status}
                </li>
              ))}
            </ul>
          </div>
        )}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Источник</th>
              <th>Камер в реестре</th>
              <th>На ревью</th>
              <th title="Доля камер, у которых азимут определён эвристикой vs фолбэком по умолчанию (см. doc/TZ-parser-import-improvements.md, П2.1)">
                Азимут: эвристика/фолбэк
              </th>
              <th>Успешность (10 запусков)</th>
              <th>Последний запуск</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.providerId} className="border-b">
                <td className="py-2 font-medium">{s.providerName}</td>
                <td>
                  {s.totalCameras}{' '}
                  <button
                    onClick={() => exportProviderCameras(s.providerId, s.providerName)}
                    disabled={exportingProviderId === s.providerId || s.totalCameras === 0}
                    title="Экспортировать список камер этого источника как JSON"
                    className="text-xs disabled:opacity-30"
                  >
                    {exportingProviderId === s.providerId ? '⏳' : '📤'}
                  </button>
                </td>
                <td>
                  {s.needsReviewCount > 0 ? (
                    <a href={`/admin/parser/review?providerId=${s.providerId}`} className="text-blue-600 underline">
                      {s.needsReviewCount}
                    </a>
                  ) : (
                    s.needsReviewCount
                  )}
                </td>
                <td className={s.azimuthFallbackCount > s.azimuthHeuristicCount ? 'text-yellow-700' : ''}>
                  {s.azimuthHeuristicCount} / {s.azimuthFallbackCount}
                </td>
                <td>{s.successRateLast10 !== null ? `${s.successRateLast10}%` : '—'}</td>
                <td>
                  {s.lastRun ? (
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[s.lastRun.status]}`}>
                      {s.lastRun.status} · {new Date(s.lastRun.startedAt).toLocaleString('ru-RU')}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <button
                    className="text-blue-600 text-xs underline disabled:opacity-50"
                    disabled={runningId === s.providerId}
                    onClick={() => runNow(s.providerId)}
                  >
                    {runningId === s.providerId ? 'Запуск…' : 'Запустить сейчас'}
                  </button>
                  <button
                    className="ml-2 text-gray-500 text-xs underline disabled:opacity-50"
                    disabled={dryRunLoading === s.providerId}
                    onClick={() => runDryRun(s.providerId)}
                    title="Показать, что было бы найдено/импортировано — ничего не сохраняет"
                  >
                    {dryRunLoading === s.providerId ? 'Проверка…' : 'Dry-run'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {dryRunResult && (
        <section className="rounded border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">
              Dry-run: {dryRunResult.providerName} — найдено {dryRunResult.discoveredCount}
              {dryRunResult.diagnostics?.matchedStrategy !== undefined && (
                <span className="ml-2 text-xs text-gray-500">
                  (стратегия: {dryRunResult.diagnostics.matchedStrategy ?? 'ни одна не сработала'})
                </span>
              )}
            </h2>
            <button onClick={() => setDryRunResult(null)} className="text-xs text-gray-500 underline">
              Закрыть
            </button>
          </div>
          {!dryRunResult.deep && (
            <button onClick={() => runDryRun(dryRunResult.providerId, true)} className="mb-2 text-xs text-blue-600 underline">
              Углублённая проверка (с геокодингом, тратит реальные запросы)
            </button>
          )}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">Название</th>
                <th>Адрес у источника</th>
                {dryRunResult.deep && <th>Что было бы</th>}
              </tr>
            </thead>
            <tbody>
              {dryRunResult.preview.map((p: any) => (
                <tr key={p.externalId} className="border-b">
                  <td className="py-1">{p.title}</td>
                  <td>{p.locationText ?? (p.hasLocationText ? '—' : <span className="text-yellow-700">нет адреса</span>)}</td>
                  {dryRunResult.deep && (
                    <td className={p.wouldBe === 'NEEDS_REVIEW' ? 'text-yellow-700' : 'text-green-700'}>
                      {p.wouldBe}
                      {p.reason ? ` — ${p.reason}` : ''}
                    </td>
                  )}
                </tr>
              ))}
              {dryRunResult.preview.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-gray-500">
                    Ничего не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-4">Лог запусков (крон + ручные)</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Источник</th>
              <th>Статус</th>
              <th>Запуск</th>
              <th>Найдено</th>
              <th>Новых</th>
              <th>Импортировано</th>
              <th>На ревью</th>
              <th>Ошибок</th>
              <th>Длительность</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2">{r.provider.name}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  {r.anomalyFlag && (
                    <span title="Найдено заметно отличается от обычного для этого источника — см. журнал импорта" className="ml-1 text-yellow-600">
                      ⚠️
                    </span>
                  )}
                </td>
                <td>
                  {r.triggeredBy} · {new Date(r.startedAt).toLocaleString('ru-RU')}
                </td>
                <td>{r.discoveredCount}</td>
                <td>{r.newCount}</td>
                <td>{r.autoImportedCount}</td>
                <td>{r.needsReviewCount}</td>
                <td>{r.errorCount}</td>
                <td>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}с` : '—'}</td>
                <td>
                  <a href={`/admin/parser/log?runId=${r.id}`} className="text-blue-600 text-xs underline">
                    Журнал
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="text-sm text-gray-500 mt-2">Загрузка…</p>}
      </section>
    </div>
  );
}

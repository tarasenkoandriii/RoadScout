'use client';

import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  stage: string;
  externalId: string | null;
  cameraSourceRawId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  provider: { name: string };
}

const LEVEL_STYLE: Record<string, string> = {
  INFO: 'bg-gray-100 text-gray-700',
  WARN: 'bg-yellow-100 text-yellow-700',
  ERROR: 'bg-red-100 text-red-700',
};

const STAGES = [
  'FETCH_PAGE',
  'PARSE_ITEM',
  'GEOCODE',
  'AZIMUTH_HEURISTIC',
  'CAMERA_CREATED',
  'NEEDS_REVIEW',
  'SKIPPED_ALREADY_RESOLVED',
  'ERROR',
];

// Детальный пошаговый журнал импорта (см. doc/TZ-parser-import-improvements.md, П1.2) —
// ОТДЕЛЬНАЯ вкладка от агрегированной статистики на /admin/parser: что случилось с конкретным
// элементом на конкретном шаге, а не только итоговые числа по проходу. Обычно открывается по
// ссылке "?runId=..." из таблицы проходов на /admin/parser, но можно и смотреть/фильтровать
// весь журнал целиком независимо от конкретного прохода.
export default function ImportLogPage() {
  const searchParams = useSearchParams();
  const initialRunId = searchParams.get('runId') ?? '';

  const [runId, setRunId] = useState(initialRunId);
  const [level, setLevel] = useState('');
  const [stage, setStage] = useState('');
  const [externalId, setExternalId] = useState('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (runId) params.set('runId', runId);
      if (level) params.set('level', level);
      if (stage) params.set('stage', stage);
      if (externalId) params.set('externalId', externalId);
      params.set('take', '200');
      const res = await fetch(`/api/admin/parser/log?${params.toString()}`, { credentials: 'include' });
      setEntries(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Журнал импорта (детально)</h1>
        <p className="text-sm text-gray-500">
          Пошаговый журнал: что произошло с каждой найденной камерой на каждом шаге пайплайна. Для агрегированной статистики по
          проходам — вкладка «Парсер».
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border p-4">
        <label className="text-sm">
          runId
          <input className="mt-1 rounded border px-2 py-1" value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="все проходы" />
        </label>
        <label className="text-sm">
          Уровень
          <select className="mt-1 rounded border px-2 py-1" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">все</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
        </label>
        <label className="text-sm">
          Этап
          <select className="mt-1 rounded border px-2 py-1" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">все</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          externalId
          <input className="mt-1 rounded border px-2 py-1" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="id камеры у источника" />
        </label>
        <button onClick={load} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
          Применить
        </button>
        {runId && (
          <button
            onClick={() => {
              setRunId('');
              load();
            }}
            className="text-xs text-gray-500 underline"
          >
            Сбросить фильтр по проходу
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Загрузка…</p>}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2">Время</th>
            <th>Уровень</th>
            <th>Этап</th>
            <th>Источник</th>
            <th>externalId</th>
            <th>Сообщение</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && !loading && (
            <tr>
              <td colSpan={6} className="py-4 text-gray-500">
                Записей не найдено.
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr
                className={`border-b cursor-pointer hover:bg-gray-50 ${e.level === 'ERROR' ? 'bg-red-50/40' : e.level === 'WARN' ? 'bg-yellow-50/40' : ''}`}
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                <td className="py-2 whitespace-nowrap">{new Date(e.timestamp).toLocaleString('ru-RU')}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
                </td>
                <td className="whitespace-nowrap">{e.stage}</td>
                <td>{e.provider.name}</td>
                <td className="max-w-[160px] truncate">{e.externalId ?? '—'}</td>
                <td>{e.message}</td>
              </tr>
              {expanded === e.id && e.metadata && (
                <tr className="border-b bg-gray-50">
                  <td colSpan={6} className="py-2 px-2">
                    <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(e.metadata, null, 2)}</pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

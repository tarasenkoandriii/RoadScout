'use client';

import { useEffect, useState } from 'react';

interface Camera {
  id: string;
  name: string;
  status: string;
  lastCheckedAt: string | null;
  provider: { name: string };
}

interface Dashboard {
  counts: Record<string, number>;
  cameras: Camera[];
}

const STATUS_STYLE: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-700',
  DELAYED: 'bg-yellow-100 text-yellow-700',
  OFFLINE: 'bg-red-100 text-red-700',
  DISABLED_SECURITY: 'bg-gray-200 text-gray-700',
  UNKNOWN: 'bg-blue-100 text-blue-700',
};

export default function MonitoringDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = () => fetch('/api/admin/monitoring/dashboard').then((r) => r.json()).then(setData);

  useEffect(() => {
    load();
  }, []);

  const runAll = async () => {
    setRunningAll(true);
    try {
      await fetch('/api/admin/monitoring/run', { method: 'POST' });
      await load();
    } finally {
      setRunningAll(false);
    }
  };

  const runOne = async (id: string) => {
    setRunningId(id);
    try {
      await fetch(`/api/admin/monitoring/run/${id}`, { method: 'POST' });
      await load();
    } finally {
      setRunningId(null);
    }
  };

  if (!data) return <p className="p-6 text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Мониторинг камер</h1>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={runAll}
          disabled={runningAll}
        >
          {runningAll ? 'Проверяем…' : 'Проверить все'}
        </button>
      </div>

      <div className="flex gap-3">
        {Object.entries(data.counts).map(([status, count]) => (
          <div key={status} className={`px-3 py-2 rounded text-sm ${STATUS_STYLE[status] ?? ''}`}>
            {status}: {count}
          </div>
        ))}
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2">Камера</th>
            <th>Провайдер</th>
            <th>Статус</th>
            <th>Последняя проверка</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.cameras.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-2">{c.name}</td>
              <td>{c.provider?.name}</td>
              <td>
                <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[c.status] ?? ''}`}>{c.status}</span>
              </td>
              <td>{c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleString('ru-RU') : '—'}</td>
              <td>
                <button
                  className="text-blue-600 underline text-xs disabled:opacity-50"
                  onClick={() => runOne(c.id)}
                  disabled={runningId === c.id}
                >
                  {runningId === c.id ? 'Проверка…' : 'Recheck'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

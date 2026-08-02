'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// globe.gl потребує WebGL/Three.js (тільки браузер) — динамічний імпорт без SSR, той самий
// принцип, що вже застосований для SectorMap (Leaflet).
const WorldGlobe = dynamic(() => import('../../../components/WorldGlobe'), { ssr: false });

interface CountryStat {
  countryCode: string;
  countryName: string;
  count: number;
}

type ViewMode = 'globe' | 'table';

// Селектор "Глобус / Таблиця" (див. запит користувача: "селектор карта - globe (default
// globe, селектор глобуса зліва)... показ кількості камер аналогічно проекту ОРБІТА") —
// глобус за замовчуванням, перемикач ліворуч. Табличний вигляд лишається як запасний/
// доповнюючий (точні числа зручніше читати в таблиці, ніж на 3D-глобусі).
export default function WorldMapPage() {
  const [stats, setStats] = useState<CountryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('globe');

  useEffect(() => {
    fetch('/api/admin/cameras/stats-by-country', { credentials: 'include' })
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const maxCount = Math.max(1, ...stats.map((s) => s.count));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Камеры по странам мира</h1>
          <p className="text-sm text-gray-500 mt-1">
            Активные (не удалённые) камеры в реестре, сгруппированные по стране города. Помогает понять, куда двигаться дальше
            с расширением — YouTube/Google/Windy-поиск (см. /admin/parser) уже работают для любой страны, добавленной в
            справочник City (см. sql/cities-seed-developed-countries.sql — стартовый список технологически развитых стран).
          </p>
        </div>

        {/* Селектор ліворуч від контенту (як просив користувач) — вертикальний список кнопок. */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => setViewMode('globe')}
            className={`rounded px-3 py-1.5 text-sm text-left ${viewMode === 'globe' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            🌐 Глобус
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`rounded px-3 py-1.5 text-sm text-left ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            📊 Таблица
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : stats.length === 0 ? (
        <p className="text-sm text-gray-500">Камер пока нет.</p>
      ) : viewMode === 'globe' ? (
        <WorldGlobe stats={stats} />
      ) : (
        <div className="space-y-2">
          {stats.map((s) => (
            <div key={s.countryCode} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-sm">
                {s.countryName} <span className="text-gray-400">({s.countryCode})</span>
              </div>
              <div className="flex-1 h-6 rounded bg-gray-100 overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${Math.max(2, (s.count / maxCount) * 100)}%` }} />
              </div>
              <div className="w-12 shrink-0 text-right text-sm font-medium">{s.count}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';

interface AggregatorSiteCandidate {
  id: string;
  url: string;
  title: string | null;
  estimatedCameraCount: number | null;
  estimationMethod: string | null;
  status: string;
  discoveredAt: string;
  lastCheckedAt: string | null;
  city: { name: string; countryCode: string; countryName: string | null } | null;
}

// Та сама конвенція, що вже застосована в CamerasService.getCameraCountByCountry() (світова
// карта) — City.countryName пусте (null) саме для українських міст за домовленістю схеми,
// тому явний фолбек на "Україна" для UA, інакше — сам код країни як останній запасний варіант.
function countryDisplayName(city: AggregatorSiteCandidate['city']): string {
  if (!city) return '—';
  if (city.countryName) return city.countryName;
  return city.countryCode === 'UA' ? 'Україна' : city.countryCode;
}

type SortColumn = 'title' | 'city' | 'country' | 'estimatedCameraCount' | 'discoveredAt';
type SortDirection = 'asc' | 'desc';

// Сайти-агрегатори (каталоги камер, знайдені пошуком, див. запит користувача) — НЕ камери для
// імпорту, а кандидати сайтів для майбутнього ручного дослідження/розробки окремого парсера
// (той самий принцип, що doc/TZ-official-open-data-cameras.md, П0). Оцінка кількості камер —
// або зі сніпета пошуку (`search_snippet`), або з реального відвідування сторінки через VPN
// (`page_visit`, кнопка "Уточнить" — AggregatorDiscoveryService.refineEstimate()).
export default function AggregatorSitesPage() {
  const [items, setItems] = useState<AggregatorSiteCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [refiningId, setRefiningId] = useState<string | null>(null);

  // Сортування по одній колонці одразу (не мультисорт, за прямим запитом користувача) — клік
  // по тому самому заголовку перемикає напрямок, клік по іншому — скидає напрямок на "asc".
  const [sortColumn, setSortColumn] = useState<SortColumn>('discoveredAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const load = () => {
    setLoading(true);
    fetch('/api/admin/aggregator-sites', { credentials: 'include' })
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // При завантаженні сторінки — перевірка стану активних batch-ів сайтів-агрегаторів (за
  // прямим запитом користувача: "аналогично и в других открытиях страниц"). Той самий
  // принцип, що на сторінці камер — перезавантажуємо список, тільки якщо щось реально щойно
  // обробилось.
  useEffect(() => {
    fetch('/api/admin/aggregator-sites/process-pending-batches', { method: 'POST', credentials: 'include' })
      .then((r) => r.json())
      .then((result) => {
        if (result?.processed > 0) load();
      })
      .catch(() => {
        // Перевірка пакетів — суто фонова оптимізація; при помилці сторінка й далі показує
        // звичайний, уже завантажений список.
      });
  }, []);

  const runSearch = async () => {
    setRunning(true);
    try {
      await fetch('/api/admin/aggregator-sites/run', { method: 'POST', credentials: 'include' });
      load();
    } finally {
      setRunning(false);
    }
  };

  // Batch API xAI (глибша переробка — за прямим запитом користувача, doc/AUDIT-grok-batch-api.md)
  // — подає пачку й одразу повертається, НЕ чекаючи результатів (на відміну від runSearch()
  // вище) — результати з'являться в таблиці згодом (типово до 24 годин, окремий cron
  // забирає їх), не одразу після натискання.
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [batchSubmitResult, setBatchSubmitResult] = useState<{ submitted: boolean; reason?: string; citiesInBatch?: number } | null>(null);
  const submitBatch = async () => {
    if (!confirm('Подать пакетный запрос (Batch API) по всем городам? Дешевле, но результаты появятся в таблице не сразу — обычно в течение часов, иногда до суток.')) return;
    setSubmittingBatch(true);
    try {
      const res = await fetch('/api/admin/aggregator-sites/submit-batch', { method: 'POST', credentials: 'include' });
      setBatchSubmitResult(await res.json());
    } finally {
      setSubmittingBatch(false);
    }
  };

  // Дабл-клік по країні (див. запит користувача: "автоматический запуск парсера сайтов
  // агрегаторов именно по этой стране") — запускає пошук ТІЛЬКИ для міст цієї країни. "По
  // можливості - оновлення списку при кожному знайденому" — без SSE/WebSocket у проєкті,
  // найпростіший спосіб — періодичний polling списку, поки триває операція: кожен новий сайт,
  // збережений на бекенді (AggregatorDiscoveryService.discoverForCities() зберігає по одному,
  // не пачкою наприкінці), зʼявиться в таблиці протягом кількох секунд, не чекаючи завершення
  // всього проходу по країні.
  const [runningCountryCode, setRunningCountryCode] = useState<string | null>(null);
  const runForCountry = async (countryCode: string, countryName: string) => {
    if (runningCountryCode) return; // не запускати паралельно кілька пошуків по країнах одразу
    if (!confirm(`Запустить поиск сайтов-агрегаторов только для страны «${countryName}»?`)) return;
    setRunningCountryCode(countryCode);
    const pollInterval = setInterval(load, 2000);
    try {
      await fetch(`/api/admin/aggregator-sites/run-country/${countryCode}`, { method: 'POST', credentials: 'include' });
    } finally {
      clearInterval(pollInterval);
      setRunningCountryCode(null);
      load();
    }
  };

  // ВАЖЛИВО (реальний знайдений баг — див. запит користувача): раніше ця кнопка тільки
  // запускала серверну оцінку (refine-estimate), хоча підпис "(посетить сайт)" обіцяв
  // відкриття сайту — сайт ніколи фактично не відкривався в новій вкладці. Тепер відкриває
  // одразу (window.open, синхронно в обробнику кліку — інакше браузер заблокував би спливне
  // вікно, якби відкриття відбувалось після await мережевого запиту) і паралельно запускає
  // серверну оцінку кількості камер.
  const refine = (item: AggregatorSiteCandidate) => {
    window.open(item.url, '_blank', 'noopener,noreferrer');
    setRefiningId(item.id);
    fetch(`/api/admin/aggregator-sites/${item.id}/refine-estimate`, { method: 'POST', credentials: 'include' })
      .then(load)
      .finally(() => setRefiningId(null));
  };

  const handleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedItems = useMemo(() => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (sortColumn) {
        case 'title':
          return dir * (a.title || a.url).localeCompare(b.title || b.url);
        case 'city':
          return dir * (a.city?.name ?? '').localeCompare(b.city?.name ?? '');
        case 'country':
          return dir * countryDisplayName(a.city).localeCompare(countryDisplayName(b.city));
        case 'estimatedCameraCount':
          // null (ще не оцінено) — завжди в кінці, незалежно від напрямку сортування.
          if (a.estimatedCameraCount == null && b.estimatedCameraCount == null) return 0;
          if (a.estimatedCameraCount == null) return 1;
          if (b.estimatedCameraCount == null) return -1;
          return dir * (a.estimatedCameraCount - b.estimatedCameraCount);
        case 'discoveredAt':
          return dir * (new Date(a.discoveredAt).getTime() - new Date(b.discoveredAt).getTime());
        default:
          return 0;
      }
    });
  }, [items, sortColumn, sortDirection]);

  const sortArrow = (column: SortColumn) => (sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Сайты-агрегаторы камер</h1>
          <p className="text-sm text-gray-500 mt-1">
            Найдено поиском (Google через Grok web_search) — сайты-каталоги со списками многих камер одного города.
            Не импортируются как камеры автоматически — справочный список для ручного исследования (стоит ли строить отдельный парсер под сайт).
          </p>
        </div>
        <button onClick={runSearch} disabled={running} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50 whitespace-nowrap">
          {running ? 'Ищем…' : 'Запустить поиск по всем городам'}
        </button>
        <button
          onClick={submitBatch}
          disabled={submittingBatch}
          title="Дешевле (Batch API xAI, скидка 20-50%), но результаты появятся не сразу — типово в течение часов, иногда до суток"
          className="rounded border border-purple-600 px-3 py-1.5 text-sm text-purple-700 disabled:opacity-50 whitespace-nowrap"
        >
          {submittingBatch ? 'Подаём…' : '🕐 Пакетный запрос (дешевле)'}
        </button>
      </div>

      {batchSubmitResult && (
        <div className={`rounded px-3 py-2 text-xs ${batchSubmitResult.submitted ? 'bg-purple-50 text-purple-700' : 'bg-red-50 text-red-700'}`}>
          {batchSubmitResult.submitted
            ? `📦 Пакет из ${batchSubmitResult.citiesInBatch} городов подан. Результаты появятся в таблице позже (фоновая проверка раз в час).`
            : batchSubmitResult.reason}
        </div>
      )}
      {runningCountryCode && (
        <div className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
          🔍 Идёт поиск по стране «{runningCountryCode}» — список обновляется автоматически по мере нахождения новых сайтов…
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b select-none">
              <th className="py-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('title')}>
                URL{sortArrow('title')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('city')}>
                Город{sortArrow('city')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('country')}>
                Страна{sortArrow('country')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('estimatedCameraCount')}>
                Оценка кол-ва камер{sortArrow('estimatedCameraCount')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('discoveredAt')}>
                Найдено{sortArrow('discoveredAt')}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-gray-500">
                  Пока пусто — нажмите «Запустить поиск по всем городам».
                </td>
              </tr>
            )}
            {sortedItems.map((it) => (
              <tr key={it.id} className="border-b align-top">
                <td className="py-2 max-w-[280px]">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                    {it.title || it.url}
                  </a>
                </td>
                <td>{it.city?.name ?? '—'}</td>
                <td
                  onDoubleClick={() => it.city && runForCountry(it.city.countryCode, countryDisplayName(it.city))}
                  className={it.city ? 'cursor-pointer hover:bg-blue-50' : ''}
                  title={it.city ? 'Двойной клик — запустить поиск сайтов-агрегаторов только для этой страны' : undefined}
                >
                  {countryDisplayName(it.city)}
                </td>
                <td>
                  {it.estimatedCameraCount ?? '—'}
                  {it.estimationMethod && (
                    <span className="ml-1 text-xs text-gray-500">
                      ({it.estimationMethod === 'page_visit' ? 'по факту' : 'по сниппету'})
                    </span>
                  )}
                </td>
                <td className="text-xs text-gray-500">{new Date(it.discoveredAt).toLocaleDateString('ru-RU')}</td>
                <td>
                  <button
                    onClick={() => refine(it)}
                    disabled={refiningId === it.id}
                    className="text-xs text-purple-700 underline disabled:opacity-50"
                  >
                    {refiningId === it.id ? 'Уточняем…' : 'Уточнить (посетить сайт)'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

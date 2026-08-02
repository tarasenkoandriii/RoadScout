'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface Camera {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  confidence: string;
  status: string;
  // За прямим запитом користувача — лічильник спроб автокалібрування, показуємо як
  // діагностичну підказку (див. нижче) — допомагає побачити "застряглі" камери (багато спроб,
  // AI досі невпевнений).
  autoCalibrationAttemptCount: number;
  provider: { name: string };
  city: { name: string; countryCode: string; countryName: string | null } | null;
}

// Та сама конвенція, що вже застосована на світовій карті й сторінці сайтів-агрегаторів —
// City.countryName пусте (null) саме для українських міст за домовленістю схеми.
function countryDisplayName(city: Camera['city']): string {
  if (!city) return '—';
  if (city.countryName) return city.countryName;
  return city.countryCode === 'UA' ? 'Україна' : city.countryCode;
}

interface Provider {
  id: string;
  name: string;
}

type SortColumn = 'name' | 'provider' | 'city' | 'country' | 'confidence' | 'status' | 'azimuth';
type SortDirection = 'asc' | 'desc';

const emptyForm = {
  name: '',
  providerId: '',
  streamUrl: '',
  streamType: 'IFRAME',
  lat: '',
  lng: '',
  azimuth: '0',
  fovAngle: '80',
  rangeMeters: '200',
};

export default function CamerasAdminPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);

  // Фільтр по країні (див. запит користувача: "активация фильтра дабл кликом по стране — по
  // умолчанию фильтр выключен") — null = вимкнено (усі камери), інакше — код і назва країни
  // для банера статусу зверху.
  const [countryFilter, setCountryFilter] = useState<{ code: string; name: string } | null>(null);

  // Сортування по одній колонці (клік перемикає напрямок) — той самий патерн, що вже є на
  // /admin/aggregator-sites. Фільтрація по кожній колонці (див. запит користувача) —
  // текстовий пошук для Название/Город, випадаючі списки для категоріальних колонок
  // (Провайдер/Confidence/Статус) — усе клієнтське, дані вже завантажені одним запитом.
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filters, setFilters] = useState({ name: '', providerId: '', city: '', country: '', confidence: '', status: '' });

  const handleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  const sortArrow = (column: SortColumn) => (sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '');

  const visibleCameras = useMemo(() => {
    const filtered = cameras.filter((c) => {
      if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
      if (filters.providerId && c.provider?.name !== filters.providerId) return false;
      if (filters.city && !(c.city?.name ?? '').toLowerCase().includes(filters.city.toLowerCase())) return false;
      if (filters.country && (c.city ? countryDisplayName(c.city) : '') !== filters.country) return false;
      if (filters.confidence && c.confidence !== filters.confidence) return false;
      if (filters.status && c.status !== filters.status) return false;
      return true;
    });

    if (!sortColumn) return filtered;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'provider':
          return dir * (a.provider?.name ?? '').localeCompare(b.provider?.name ?? '');
        case 'city':
          return dir * (a.city?.name ?? '').localeCompare(b.city?.name ?? '');
        case 'country':
          return dir * countryDisplayName(a.city).localeCompare(countryDisplayName(b.city));
        case 'confidence':
          return dir * a.confidence.localeCompare(b.confidence);
        case 'status':
          return dir * a.status.localeCompare(b.status);
        case 'azimuth':
          return dir * (a.azimuth - b.azimuth);
        default:
          return 0;
      }
    });
  }, [cameras, filters, sortColumn, sortDirection]);

  // Плашка зі статистикою (див. запит користувача) — показується при БУДЬ-ЯКОМУ з трьох
  // "географічних/організаційних" фільтрів (країна/місто/провайдер), не при фільтрах
  // за назвою/confidence/статусом (ті вже й так відразу видно з таблиці нижче — окрема плашка
  // для них не додає нової інформації). Рахуємо по visibleCameras — тобто з урахуванням УСІХ
  // активних фільтрів одночасно (наприклад, країна + confidence разом), не тільки трьох
  // географічних.
  const showStatsBanner = Boolean(filters.country || filters.city || filters.providerId);
  const statsByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of visibleCameras) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [visibleCameras]);
  // За запитом користувача — та сама розбивка, але по Confidence (VERIFIED/ESTIMATED), поруч
  // зі статусом моніторингу — це різні, незалежні виміри (див. пояснення нижче в чаті).
  const statsByConfidence = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of visibleCameras) {
      counts[c.confidence] = (counts[c.confidence] ?? 0) + 1;
    }
    return counts;
  }, [visibleCameras]);

  // Списки значень для випадаючих фільтрів — з реально завантажених камер, не окремий запит.
  const providerNames = useMemo(() => [...new Set(cameras.map((c) => c.provider?.name).filter(Boolean))] as string[], [cameras]);
  const statusValues = useMemo(() => [...new Set(cameras.map((c) => c.status))], [cameras]);
  // Список країн для фільтра (див. запит користувача — фільтра по країні на списку камер не
  // було взагалі, лише прихований дабл-клік по комірці "Страна", що робить окремий запит до
  // сервера). Цей фільтр — простий клієнтський (як провайдер/статус), не робить нового запиту.
  const countryNames = useMemo(() => [...new Set(cameras.map((c) => (c.city ? countryDisplayName(c.city) : null)).filter(Boolean))] as string[], [cameras]);

  const load = async () => {
    setLoading(true);
    const camerasUrl = countryFilter ? `/api/admin/cameras?countryCode=${encodeURIComponent(countryFilter.code)}` : '/api/admin/cameras';
    const [camerasRes, providersRes] = await Promise.all([
      fetch(camerasUrl).then((r) => r.json()),
      fetch('/api/admin/providers').then((r) => r.json()).catch(() => []),
    ]);
    setCameras(camerasRes);
    setProviders(providersRes);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryFilter]);

  // При завантаженні сторінки — перевірка стану всіх активних batch-ів (за прямим запитом
  // користувача: "при загрузке страницы камер проверять все батчи на завершенность"). Тільки
  // ОДИН раз при монтуванні (не при кожній зміні countryFilter, на відміну від load() вище) —
  // порожній масив залежностей. Перевіряються ОБИДВА типи пакетів — калібрування камер (щоб
  // оновити цю саму таблицю) і сайтів-агрегаторів (той самий принцип "аналогично и в других
  // открытиях страниц", хоча цей другий тип не впливає на таблицю камер напряму).
  useEffect(() => {
    (async () => {
      try {
        const calibrationResPromise = fetch('/api/admin/cameras/process-pending-calibration-batches', { method: 'POST', credentials: 'include' }).then((r) => r.json());
        // Той самий принцип "перевіряти при відкритті сторінки" застосований і до пакетів
        // сайтів-агрегаторів — не впливає на цю таблицю напряму, просто той самий фоновий
        // тригер, що вже є на сторінці /admin/aggregator-sites.
        const aggregatorCheckPromise = fetch('/api/admin/aggregator-sites/process-pending-batches', { method: 'POST', credentials: 'include' }).catch(() => null);

        const [calibrationResult] = await Promise.all([calibrationResPromise, aggregatorCheckPromise]);
        // Перезавантажуємо список камер, ТІЛЬКИ якщо якийсь пакет реально щойно завершився —
        // немає сенсу зайвий раз перезапитувати БД, якщо всі пакети й далі просто pending.
        if (calibrationResult?.processed > 0) {
          load();
        }
      } catch {
        // Перевірка пакетів — суто фонова оптимізація; якщо не вдалась (мережа, сервер
        // недоступний тощо) — сторінка й далі показує звичайний, уже завантажений список камер.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCamera = async () => {
    await fetch('/api/admin/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        lat: Number(form.lat),
        lng: Number(form.lng),
        azimuth: Number(form.azimuth),
        fovAngle: Number(form.fovAngle),
        rangeMeters: Number(form.rangeMeters),
      }),
    });
    setForm(emptyForm);
    await load();
  };

  const removeCamera = async (id: string) => {
    if (!confirm('Удалить камеру?')) return;
    await fetch(`/api/admin/cameras/${id}`, { method: 'DELETE' });
    await load();
  };

  const [bulkDeleting, setBulkDeleting] = useState(false);
  const offlineCount = cameras.filter((c) => c.status === 'OFFLINE').length;

  // Массовое "Удалить нерабочие" (см. запит користувача) — soft delete по всему проекту (см.
  // doc/AUDIT-camera-soft-delete.md), не физическое удаление — камеры со статусом OFFLINE
  // получают deletedAt и пропадают из активных списков/поиска, но не теряются безвозвратно.
  const removeAllOffline = async () => {
    if (!confirm(`Удалить все нерабочие камеры (статус OFFLINE, сейчас ${offlineCount})?`)) return;
    setBulkDeleting(true);
    try {
      await fetch('/api/admin/cameras/delete-offline', { method: 'POST', credentials: 'include' });
      await load();
    } finally {
      setBulkDeleting(false);
    }
  };

  // Автокалібрування пачками по 10 (див. запит користувача) — при впевненості AI 100%
  // координати сектора записуються в базу напряму, без потреби відкривати кожну камеру
  // окремо; статус confidence лишається ESTIMATED (AI-впевненість — не те саме, що людська
  // перевірка, див. CamerasService.autoCalibrateBatch()).
  const [autoCalibrating, setAutoCalibrating] = useState(false);
  const [autoCalibrateResult, setAutoCalibrateResult] = useState<{ processed: number; calibrated: number; results: any[]; errorText?: string } | null>(null);
  const autoCalibrateBatch = async () => {
    setAutoCalibrating(true);
    setAutoCalibrateResult(null);
    try {
      const res = await fetch('/api/admin/cameras/auto-calibrate-batch', { method: 'POST', credentials: 'include' });
      // ВАЖЛИВО (реальний знайдений інцидент — див. doc/AUDIT-auto-calibrate-batch.md,
      // "Оновлення"): при 500-помилці сервер міг віддати тіло, що не є JSON взагалі —
      // `res.json()` тоді кидав "Unexpected token", а не показував саму причину помилки.
      // Тепер читаємо як текст спершу і пробуємо розпарсити безпечно.
      const text = await res.text();
      if (!res.ok) {
        setAutoCalibrateResult({ processed: 0, calibrated: 0, results: [], errorText: `Ошибка сервера (${res.status}): ${text.slice(0, 300)}` } as any);
        return;
      }
      try {
        setAutoCalibrateResult(JSON.parse(text));
      } catch {
        setAutoCalibrateResult({ processed: 0, calibrated: 0, results: [], errorText: `Сервер вернул не-JSON ответ: ${text.slice(0, 300)}` } as any);
      }
      await load();
    } finally {
      setAutoCalibrating(false);
    }
  };

  // Batch API xAI (за прямим запитом користувача, розширення GrokBatchJob на камери) —
  // подає той самий набір (до 50 камер) через асинхронний, дешевший шлях. Результати
  // з'являться в таблиці НЕ одразу — при наступному відкритті цієї сторінки (чи будь-якої
  // іншої, де підключена перевірка пакетів) або в наступному годинному cron-опитуванні.
  const [submittingCalibrationBatch, setSubmittingCalibrationBatch] = useState(false);
  const [calibrationBatchResult, setCalibrationBatchResult] = useState<{ submitted: boolean; reason?: string; camerasInBatch?: number } | null>(null);
  const submitCalibrationBatch = async () => {
    if (!confirm('Подать пакетный запрос калибровки (Batch API, дешевле на 20-50%)? Результаты появятся не сразу — обычно в течение часов, иногда до суток.')) return;
    setSubmittingCalibrationBatch(true);
    try {
      const res = await fetch('/api/admin/cameras/submit-calibration-batch', { method: 'POST', credentials: 'include' });
      setCalibrationBatchResult(await res.json());
    } finally {
      setSubmittingCalibrationBatch(false);
    }
  };

  return (
    <div className="p-6 space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Камеры</h1>
          <div className="flex items-center gap-2">
            <button
              className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={autoCalibrateBatch}
              disabled={autoCalibrating}
              title="Берёт следующие 50 камер со статусом ESTIMATED и пытается откалибровать их через AI — при уверенности ≥70% (настраивается) записывает результат в базу"
            >
              {autoCalibrating ? '🤖 Калибруем…' : '🤖 Автокалибровка (50 камер)'}
            </button>
            <button
              className="rounded border border-purple-600 px-3 py-1.5 text-sm text-purple-700 disabled:opacity-50"
              onClick={submitCalibrationBatch}
              disabled={submittingCalibrationBatch}
              title="Дешевле (Batch API xAI, скидка 20-50%), но результаты появятся не сразу — типово в течение часов, иногда до суток"
            >
              {submittingCalibrationBatch ? 'Подаём…' : '🕐 Пакетная калибровка (дешевле)'}
            </button>
            <button
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={removeAllOffline}
              disabled={bulkDeleting || offlineCount === 0}
              title={offlineCount === 0 ? 'Нет камер со статусом OFFLINE' : undefined}
            >
              {bulkDeleting ? 'Удаляем…' : `Удалить нерабочие (${offlineCount})`}
            </button>
          </div>
        </div>

        {calibrationBatchResult && (
          <div className={`mb-4 rounded px-3 py-2 text-xs ${calibrationBatchResult.submitted ? 'bg-purple-50 text-purple-700' : 'bg-red-50 text-red-700'}`}>
            {calibrationBatchResult.submitted
              ? `📦 Пакет из ${calibrationBatchResult.camerasInBatch} камер подан. Результаты появятся в таблице позже (проверяется автоматически при открытии этой страницы, а также фоново раз в час).`
              : calibrationBatchResult.reason}
          </div>
        )}
        {autoCalibrateResult && (
          <div className={`mb-4 rounded p-3 text-xs ${autoCalibrateResult.errorText ? 'bg-red-50 text-red-700' : 'bg-purple-50'}`}>
            {autoCalibrateResult.errorText ? (
              <p className="font-medium">{autoCalibrateResult.errorText}</p>
            ) : (
              <>
                <p className="font-medium mb-2">
                  Автокалибровка: обработано {autoCalibrateResult.processed}, откалибровано {autoCalibrateResult.calibrated}.
                </p>
                {/* 4 колонки (див. запит користувача — для 50 результатів одна колонка була б
                    занадто довгою) — grid замість <ul>, кожна причина невдачі все одно
                    показується повністю (title з повним текстом, якщо обрізано класом truncate). */}
                <div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
                  {autoCalibrateResult.results.map((r) => (
                    <div
                      key={r.cameraId}
                      className={`truncate ${r.calibrated ? 'text-green-700' : 'text-gray-500'}`}
                      title={r.calibrated ? undefined : r.reason ?? undefined}
                    >
                      {r.calibrated ? '✅ VERIFIED' : '—'} {r.name} — {Math.round(r.confidence * 100)}%
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Статус активного фільтра по країні (див. запит користувача: "статус - фильтр по
            такой-то стране активирован (отменить справа - кликабельное)"), за замовчуванням
            вимкнений — банер показується лише коли countryFilter не null. */}
        {countryFilter && (
          <div className="mb-4 flex items-center justify-between rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
            <span>Фильтр по стране «{countryFilter.name}» активирован</span>
            <button onClick={() => setCountryFilter(null)} className="underline hover:text-blue-900">
              Отменить
            </button>
          </div>
        )}

        {/* Плашка зі статистикою (за запитом користувача) — при будь-якому "географічному"
            фільтрі (країна/місто/провайдер): всього камер + розбивка по статусах. */}
        {showStatsBanner && (
          <div className="mb-4 rounded bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 space-y-0.5">
            <div>
              <span className="font-medium">Всего камер: {visibleCameras.length}</span>
              {Object.keys(statsByStatus).length > 0 && (
                <span className="ml-3 text-slate-500">
                  Статус:{' '}
                  {Object.entries(statsByStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => `${status}: ${count}`)
                    .join(' · ')}
                </span>
              )}
            </div>
            {Object.keys(statsByConfidence).length > 0 && (
              <div className="text-slate-500">
                Confidence:{' '}
                {Object.entries(statsByConfidence)
                  .sort((a, b) => b[1] - a[1])
                  .map(([confidence, count]) => `${confidence}: ${count}`)
                  .join(' · ')}
              </div>
            )}
          </div>
        )}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b select-none">
              <th className="py-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('name')}>
                Название{sortArrow('name')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('provider')}>
                Провайдер{sortArrow('provider')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('city')}>
                Город{sortArrow('city')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('country')}>
                Страна{sortArrow('country')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('confidence')}>
                Confidence{sortArrow('confidence')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('status')}>
                Статус{sortArrow('status')}
              </th>
              <th className="cursor-pointer hover:text-blue-600" onClick={() => handleSort('azimuth')}>
                Азимут / FOV / Range{sortArrow('azimuth')}
              </th>
              <th />
            </tr>
            <tr className="text-left border-b bg-gray-50">
              <th className="py-1.5">
                <input
                  className="w-full rounded border px-1.5 py-0.5 text-xs font-normal"
                  placeholder="Фильтр…"
                  value={filters.name}
                  onChange={(e) => setFilters({ ...filters, name: e.target.value })}
                />
              </th>
              <th>
                <select
                  className="w-full rounded border px-1 py-0.5 text-xs font-normal"
                  value={filters.providerId}
                  onChange={(e) => setFilters({ ...filters, providerId: e.target.value })}
                >
                  <option value="">Все</option>
                  {providerNames.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <input
                  className="w-full rounded border px-1.5 py-0.5 text-xs font-normal"
                  placeholder="Фильтр…"
                  value={filters.city}
                  onChange={(e) => setFilters({ ...filters, city: e.target.value })}
                />
              </th>
              <th>
                <select
                  className="w-full rounded border px-1 py-0.5 text-xs font-normal"
                  value={filters.country}
                  onChange={(e) => setFilters({ ...filters, country: e.target.value })}
                >
                  <option value="">Все</option>
                  {countryNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <select
                  className="w-full rounded border px-1 py-0.5 text-xs font-normal"
                  value={filters.confidence}
                  onChange={(e) => setFilters({ ...filters, confidence: e.target.value })}
                >
                  <option value="">Все</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="ESTIMATED">ESTIMATED</option>
                </select>
              </th>
              <th>
                <select
                  className="w-full rounded border px-1 py-0.5 text-xs font-normal"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                >
                  <option value="">Все</option>
                  {statusValues.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleCameras.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-gray-500">
                  {cameras.length === 0 ? 'Камер пока нет.' : 'Ничего не найдено — измените фильтры.'}
                </td>
              </tr>
            )}
            {visibleCameras.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2">{c.name}</td>
                <td>{c.provider?.name}</td>
                <td>{c.city?.name ?? '—'}</td>
                <td
                  onDoubleClick={() => c.city && setCountryFilter({ code: c.city.countryCode, name: countryDisplayName(c.city) })}
                  className={c.city ? 'cursor-pointer hover:bg-blue-50' : ''}
                  title={c.city ? 'Двойной клик — показать только камеры этой страны' : undefined}
                >
                  {countryDisplayName(c.city)}
                </td>
                <td>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${c.confidence === 'VERIFIED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}
                    title={c.confidence === 'ESTIMATED' ? `Попыток автокалибровки: ${c.autoCalibrationAttemptCount}` : undefined}
                  >
                    {c.confidence}
                  </span>
                  {/* За прямим запитом користувача — лічильник спроб, компактно, лише коли > 0
                      і статус ще ESTIMATED (для VERIFIED це вже не актуально) — допомагає
                      побачити камери, "застряглі" через багато невдалих спроб AI. */}
                  {c.confidence === 'ESTIMATED' && c.autoCalibrationAttemptCount > 0 && (
                    <span className="ml-1 text-[10px] text-gray-400" title={`Попыток автокалибровки: ${c.autoCalibrationAttemptCount}`}>
                      ({c.autoCalibrationAttemptCount})
                    </span>
                  )}
                </td>
                <td>
                  {c.status === 'UNKNOWN' ? (
                    <span className="text-gray-400" title="Ещё не проверено фоновым мониторингом (проверка раз в ~15 минут) — не ошибка, просто новая камера">
                      UNKNOWN <span className="text-[10px]">(ожидает проверки)</span>
                    </span>
                  ) : (
                    c.status
                  )}
                </td>
                <td>
                  {c.azimuth}° / {c.fovAngle}° / {c.rangeMeters}м
                </td>
                <td className="space-x-2">
                  <Link className="text-blue-600 underline text-xs" href={`/admin/cameras/${c.id}/calibrate`}>
                    Калибровать
                  </Link>
                  <button className="text-red-600 underline text-xs" onClick={() => removeCamera(c.id)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="text-sm text-gray-500 mt-2">Загрузка…</p>}
      </section>

      <section className="border-t pt-6">
        <h2 className="text-lg font-semibold mb-4">Добавить камеру вручную</h2>
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <input
            className="border rounded px-2 py-1 col-span-2"
            placeholder="Название"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className="border rounded px-2 py-1 col-span-2"
            value={form.providerId}
            onChange={(e) => setForm({ ...form, providerId: e.target.value })}
          >
            <option value="">Провайдер…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="border rounded px-2 py-1 col-span-2"
            placeholder="URL трансляции (iframe/HLS/YouTube)"
            value={form.streamUrl}
            onChange={(e) => setForm({ ...form, streamUrl: e.target.value })}
          />
          <select
            className="border rounded px-2 py-1"
            value={form.streamType}
            onChange={(e) => setForm({ ...form, streamType: e.target.value })}
          >
            <option value="IFRAME">IFRAME</option>
            <option value="HLS">HLS</option>
            <option value="MJPEG_SNAPSHOT">MJPEG_SNAPSHOT</option>
            <option value="YOUTUBE_LIVE">YOUTUBE_LIVE</option>
          </select>
          <div />
          <input
            className="border rounded px-2 py-1"
            placeholder="lat"
            value={form.lat}
            onChange={(e) => setForm({ ...form, lat: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1"
            placeholder="lng"
            value={form.lng}
            onChange={(e) => setForm({ ...form, lng: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1"
            placeholder="azimuth (0-360)"
            value={form.azimuth}
            onChange={(e) => setForm({ ...form, azimuth: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1"
            placeholder="fovAngle"
            value={form.fovAngle}
            onChange={(e) => setForm({ ...form, fovAngle: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 col-span-2"
            placeholder="rangeMeters"
            value={form.rangeMeters}
            onChange={(e) => setForm({ ...form, rangeMeters: e.target.value })}
          />
        </div>
        <button className="mt-3 px-4 py-2 bg-blue-600 text-white rounded" onClick={createCamera}>
          Создать
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Точные значения azimuth/fovAngle можно потом уточнить в инструменте калибровки — там же камера получает
          статус VERIFIED.
        </p>
      </section>
    </div>
  );
}

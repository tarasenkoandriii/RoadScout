'use client';

import { useEffect, useState } from 'react';

interface DevLocationOverride {
  telegramId: string;
  lat: number;
  lng: number;
  label: string | null;
  updatedAt: string;
}

interface TelemetryEvent {
  id: string;
  telegramId: string;
  scans: number;
  withCandidates: number;
  locks: number;
  snapUsed: boolean;
  // М3 ТЗ (doc/TZ-btw-side-reverse-view.md §7) — conversion rate резервного рівня.
  fallbackOffered: number;
  fallbackUsed: number;
  // ВИПРАВЛЕНО (за прямим запитом користувача — "нужно больше полей телеметрии", під час
  // діагностики "кандидатов то находит то не находит") — scanErrors: скільки спроб скана
  // впало (мережа/5xx), а не просто "камер немає в цьому напрямку". *Last — знімок
  // діагностики ОСТАННЬОГО успішного скана в сесії (те саме, що видно в HUD телефону, але
  // лишається тут і після того, як тестувальник закрив застосунок).
  scanErrors: number;
  camerasInBboxLast: number;
  coneSurvivorsLast: number;
  streetCandidatesFoundLast: number;
  createdAt: string;
}

// За прямим запитом користувача — вибір міста зі списку (з кількістю придатних для
// сканування камер) замість ручного вводу координат наосліп.
interface CityOption {
  cityId: string;
  name: string;
  cameraCount: number;
}

// BTW — дебаг-режим: програмний (не апаратний) спуфінг GPS-координат для конкретного
// telegram-юзера (за прямим запитом користувача). Азимут (компас) свідомо НЕ підмінюється —
// реальне обертання телефоном лишається потрібним, підміняється лише позиція. Гейт на
// сервері — DEV_AUTO_LOGIN (той самий, що вже вимикає авто-вхід у продакшені): якщо
// вимкнено, усі виклики нижче отримають 404, і ця сторінка коректно покаже повідомлення про
// це, а не мовчазну порожню таблицю.
export default function BtwDevToolsPage() {
  const [overrides, setOverrides] = useState<DevLocationOverride[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [selectedCityId, setSelectedCityId] = useState('');
  const [cityPickLoading, setCityPickLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [telegramId, setTelegramId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/btw/admin/dev-location-overrides', { credentials: 'include' });
      if (res.status === 404) {
        setDisabled(true);
        setOverrides([]);
        return;
      }
      if (res.ok) setOverrides(await res.json());

      const telemetryRes = await fetch('/api/btw/admin/telemetry', { credentials: 'include' });
      if (telemetryRes.ok) setTelemetry(await telemetryRes.json());

      const citiesRes = await fetch('/api/btw/admin/dev-cities', { credentials: 'include' });
      if (citiesRes.ok) setCities(await citiesRes.json());
    } catch {
      setError('Не удалось загрузить список');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // При выборе города — подставляем координаты точки с максимальной плотностью камер
  // (сервер сам считает "плотность" — среди камер этого города ищет ту, у которой больше
  // всего соседей в радиусе ~350м, см. BtwService.findDensestCameraPoint). Метку/telegramId
  // не трогаем — только lat/lng, чтобы не сбрасывать уже введённые значения.
  async function handleSelectCity(cityId: string) {
    setSelectedCityId(cityId);
    if (!cityId) return;
    setCityPickLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/btw/admin/dev-cities/${encodeURIComponent(cityId)}/densest-point`, { credentials: 'include' });
      if (!res.ok) {
        setError('Не удалось найти точку с камерами для этого города');
        return;
      }
      const point: { lat: number; lng: number; cameraName: string; camerasNearby: number } = await res.json();
      setLat(String(point.lat));
      setLng(String(point.lng));
      if (!label.trim()) {
        setLabel(`${cities.find((c) => c.cityId === cityId)?.name ?? ''} — у камеры «${point.cameraName}» (рядом ещё ${point.camerasNearby - 1})`);
      }
    } catch {
      setError('Не удалось найти точку с камерами для этого города');
    } finally {
      setCityPickLoading(false);
    }
  }

  async function handleSave() {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!telegramId.trim() || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      setError('Укажите telegram ID и корректные координаты (широта/долгота числом)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/btw/admin/dev-location-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ telegramId: telegramId.trim(), lat: latNum, lng: lngNum, label: label.trim() || undefined }),
      });
      if (res.ok) {
        setTelegramId('');
        setLat('');
        setLng('');
        setLabel('');
        await load();
      } else {
        setError('Не удалось сохранить подмену');
      }
    } catch {
      setError('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(id: string) {
    try {
      await fetch(`/api/btw/admin/dev-location-overrides/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      await load();
    } catch {
      setError('Не удалось убрать подмену');
    }
  }

  if (loading) return <div className="p-6">Загрузка…</div>;

  if (disabled) {
    return (
      <div className="p-6">
        <h1 className="mb-3 text-xl font-bold">BTW — подмена координат (дебаг)</h1>
        <div className="rounded bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          Функция отключена — переменная окружения <code>DEV_AUTO_LOGIN</code> не установлена в{' '}
          <code>&quot;true&quot;</code>. Это ожидаемо в продакшене: подмена координат — инструмент только для
          локальной/staging-отладки, полностью скрыт (404), когда флаг выключен.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">BTW — подмена координат (дебаг)</h1>
      <p className="mb-4 text-sm text-gray-600">
        Программный (не аппаратный) спуфинг GPS для конкретного telegram-пользователя — вместо реальной геолокации
        клиент BTW получит выбранную здесь точку. Компас (азимут) НЕ подменяется — реальное вращение телефоном
        по-прежнему нужно.
      </p>

      {error && <div className="mb-4 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-6 rounded border p-4">
        <h2 className="mb-2 font-medium">Добавить / обновить подмену</h2>

        {/* За прямим запитом користувача — вибір міста (з бекенду, лише міста, де реально є
            придатні для сканування камери) ПЕРЕД координатами. Вибір міста сам підставляє
            lat/lng — точку з максимальною щільністю камер поруч, а не центр міста, щоб
            одразу після переходу на локацію сканування знаходило кандидатів. */}
        <div className="mb-3">
          <select
            className="w-full rounded border px-2 py-1 text-sm"
            value={selectedCityId}
            onChange={(e) => handleSelectCity(e.target.value)}
            disabled={cityPickLoading}
          >
            <option value="">
              {cities.length === 0 ? 'Нет городов с камерами, готовыми к сканированию' : 'Выбрать город…'}
            </option>
            {cities.map((c) => (
              <option key={c.cityId} value={c.cityId}>
                {c.name} ({c.cameraCount} {c.cameraCount === 1 ? 'камера' : 'камер'})
              </option>
            ))}
          </select>
          {cityPickLoading && <p className="mt-1 text-xs text-gray-500">Ищем точку с максимальной плотностью камер…</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="Telegram ID пользователя"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
          />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Метка (необязательно)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Широта (lat)" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Долгота (lng)" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <button onClick={handleSave} disabled={saving} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          {saving ? 'Сохранение…' : 'Сохранить подмену'}
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Telegram ID</th>
            <th>Метка</th>
            <th>Координаты</th>
            <th>Обновлено</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {overrides.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-400">
                Нет активных подмен
              </td>
            </tr>
          )}
          {overrides.map((o) => (
            <tr key={o.telegramId} className="border-b">
              <td className="py-2">{o.telegramId}</td>
              <td>{o.label ?? '—'}</td>
              <td>
                {o.lat.toFixed(5)}, {o.lng.toFixed(5)}
              </td>
              <td>{new Date(o.updatedAt).toLocaleString('ru-RU')}</td>
              <td>
                <button onClick={() => handleClear(o.telegramId)} className="text-red-600 hover:underline">
                  Убрать
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* За прямим запитом користувача — телеметрія сесій (§6 ТЗ, "агрегаты сессии, без
          координат") тепер реально зберігається, а не лише логується й пропадає — щоб ПІСЛЯ
          польового тесту (М0-спайк) можна було подивитись цифри тут, а не покладатись на
          пам'ять "здається, спрацювало". */}
      <h2 className="mt-8 mb-2 font-medium">Телеметрия сессий (последние 200)</h2>
      {/* ВИПРАВЛЕНО (за прямим запитом користувача — "нужно больше полей телеметрии", під час
          діагностики "кандидатов то находит то не находит") — Ошибки/Последний скан нижче:
          раніше з цієї таблиці неможливо було відрізнити "камер немає в цьому напрямку" від
          "запит до /btw/scan просто впав" — обидва випадки виглядали як 0 кандидатів. */}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Telegram ID</th>
            <th>Сканы</th>
            <th>С кандидатами</th>
            <th>Ошибки сканов</th>
            <th>Захваты</th>
            <th>Snap сработал</th>
            <th>Fallback (использовано/предложено)</th>
            <th>Последний скан (камер в bbox / прошли конус / улиц рядом)</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {telemetry.length === 0 && (
            <tr>
              <td colSpan={9} className="py-4 text-center text-gray-400">
                Нет данных телеметрии — запустите скан на реальном устройстве
              </td>
            </tr>
          )}
          {telemetry.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2">{t.telegramId}</td>
              <td>{t.scans}</td>
              <td>
                {t.withCandidates} ({t.scans > 0 ? Math.round((t.withCandidates / t.scans) * 100) : 0}%)
              </td>
              <td className={t.scanErrors > 0 ? 'text-red-600' : undefined}>{t.scanErrors > 0 ? t.scanErrors : '—'}</td>
              <td>{t.locks}</td>
              <td>{t.snapUsed ? '✅' : '—'}</td>
              <td>
                {t.fallbackOffered > 0
                  ? `${t.fallbackUsed}/${t.fallbackOffered} (${Math.round((t.fallbackUsed / t.fallbackOffered) * 100)}%)`
                  : '—'}
              </td>
              <td>
                {t.camerasInBboxLast} / {t.coneSurvivorsLast} / {t.streetCandidatesFoundLast}
              </td>
              <td>{new Date(t.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

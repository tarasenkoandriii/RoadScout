'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import WindyWidget from '../../../components/WindyWidget';

const SituationalMap = dynamic(() => import('../../../components/SituationalMap'), { ssr: false });

interface WeatherPoint {
  name: string;
  lat: number;
  lng: number;
  tempC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  visibilityM: number | null;
  conditionLabel: string;
  isHazard: boolean;
  observedAt: string | null;
  error?: string;
}

interface Incident {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'ACTIVE' | 'RESOLVED';
  lat: number;
  lng: number;
  title: string;
  description?: string | null;
  reportedAt: string;
  expiresAt?: string | null;
}

// Города Украины (см. doc/README.md): погодная сводка теперь охватывает всю страну (City),
// поэтому центр карты по умолчанию — географический центр Украины, а не только Київ.
const UKRAINE_CENTER = { lat: 49.0, lng: 31.0 };

const TYPE_OPTIONS = [
  { value: 'ACCIDENT', label: 'ДТП' },
  { value: 'ROAD_CLOSURE', label: 'Перекрытие дороги' },
  { value: 'FLOODING', label: 'Подтопление' },
  { value: 'ICE', label: 'Гололёд' },
  { value: 'FOG', label: 'Туман (локально)' },
  { value: 'CONSTRUCTION', label: 'Ремонтные работы' },
  { value: 'OTHER', label: 'Другое' },
];

const SEVERITY_OPTIONS = [
  { value: 'LOW', label: 'Низкая' },
  { value: 'MEDIUM', label: 'Средняя' },
  { value: 'HIGH', label: 'Высокая' },
];

export default function SituationalAwarenessPage() {
  const [weather, setWeather] = useState<WeatherPoint[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    type: 'ACCIDENT',
    severity: 'MEDIUM',
    lat: '',
    lng: '',
    title: '',
    description: '',
    expiresAt: '',
  });

  const load = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/situational/overview', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWeather(data.weather ?? []);
      setIncidents(data.incidents ?? []);
    } catch (e) {
      setError('Не удалось загрузить данные ситуационной осведомленности.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMapClick = (pos: { lat: number; lng: number }) => {
    setForm({ ...form, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lat || !form.lng || !form.title) {
      setError('Укажите точку на карте (или координаты) и заголовок.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/situational/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: form.type,
          severity: form.severity,
          lat: Number(form.lat),
          lng: Number(form.lng),
          title: form.title,
          description: form.description || undefined,
          expiresAt: form.expiresAt || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm({ ...form, lat: '', lng: '', title: '', description: '', expiresAt: '' });
      await load();
    } catch {
      setError('Не удалось добавить инцидент.');
    } finally {
      setSubmitting(false);
    }
  };

  const resolveIncident = async (id: string) => {
    await fetch(`/api/admin/situational/incidents/${id}/resolve`, { method: 'POST', credentials: 'include' });
    await load();
  };

  if (loading) return <p className="p-6 text-sm text-gray-500">Загрузка…</p>;

  const hazardPoints = weather.filter((w) => w.isHazard);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ситуационная осведомленность</h1>
        <button className="text-sm text-blue-600 underline" onClick={load}>
          Обновить
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {hazardPoints.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Погодные предупреждения: {hazardPoints.map((w) => `${w.name} — ${w.conditionLabel}`).join('; ')}
        </div>
      )}

      <SituationalMap
        center={UKRAINE_CENTER}
        weather={weather}
        incidents={incidents}
        onMapClick={handleMapClick}
        onResolveIncident={resolveIncident}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700">Радар осадков (Windy)</h2>
        <WindyWidget lat={UKRAINE_CENTER.lat} lng={UKRAINE_CENTER.lng} zoom={5} defaultOverlay="radar" heightClassName="h-80 w-full rounded border-0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSubmit} className="space-y-3 rounded border p-4">
          <h2 className="font-medium">Добавить инцидент</h2>
          <p className="text-xs text-gray-500">Кликните по карте, чтобы поставить точку, или введите координаты вручную.</p>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Тип
              <select
                className="mt-1 w-full rounded border px-2 py-1"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Серьёзность
              <select
                className="mt-1 w-full rounded border px-2 py-1"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Широта
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
                placeholder="50.4501"
              />
            </label>

            <label className="text-sm">
              Долгота
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={form.lng}
                onChange={(e) => setForm({ ...form, lng: e.target.value })}
                placeholder="30.5234"
              />
            </label>
          </div>

          <label className="block text-sm">
            Заголовок
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Например: ДТП на мосту Патона"
            />
          </label>

          <label className="block text-sm">
            Описание (необязательно)
            <textarea
              className="mt-1 w-full rounded border px-2 py-1"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>

          <label className="block text-sm">
            Актуально до (необязательно)
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border px-2 py-1"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? 'Добавляем…' : 'Добавить'}
          </button>
        </form>

        <div className="rounded border p-4">
          <h2 className="mb-2 font-medium">Активные инциденты ({incidents.length})</h2>
          <ul className="space-y-2 text-sm">
            {incidents.length === 0 && <li className="text-gray-500">Нет активных инцидентов.</li>}
            {incidents.map((inc) => (
              <li key={inc.id} className="flex items-start justify-between gap-2 border-b pb-2">
                <div>
                  <p className="font-medium">{inc.title}</p>
                  <p className="text-xs text-gray-500">
                    {TYPE_OPTIONS.find((o) => o.value === inc.type)?.label ?? inc.type} · {inc.severity} ·{' '}
                    {new Date(inc.reportedAt).toLocaleString('ru-RU')}
                  </p>
                </div>
                <button className="shrink-0 text-xs text-green-700 underline" onClick={() => resolveIncident(inc.id)}>
                  Решено
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

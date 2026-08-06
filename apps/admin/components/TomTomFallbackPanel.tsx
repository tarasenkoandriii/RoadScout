'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { TomTomIncident } from './TomTomIncidentMap';

const TomTomIncidentMap = dynamic(() => import('./TomTomIncidentMap'), { ssr: false });

// За прямим запитом користувача — "реализовать TomTom Traffic API — fallback/дополнение вне NY
// State" (doc/TZ-btw-route-planning.md §7.2/§9 п.5). На відміну від NySituationalPanel.tsx
// (511NY — один фід на весь штат, без параметрів) — TomTom вимагає конкретну точку+радіус у
// кожному запиті (§ tomtom.service.ts), тому тут є поля вводу координат, а не готова карта
// штату: панель демонструє САМЕ "fallback поза NY State" — за замовчуванням показує місто, де
// 511NY свідомо НЕ покриває (Чикаго, а не Нью-Йорк), щоб не дублювати секцію вище.
const DEFAULT_LOCATION = { label: 'Чикаго, Иллинойс (вне NY State — демонстрация fallback)', lat: 41.8781, lng: -87.6298, radiusKm: 15 };

export default function TomTomFallbackPanel() {
  const [form, setForm] = useState({
    lat: String(DEFAULT_LOCATION.lat),
    lng: String(DEFAULT_LOCATION.lng),
    radiusKm: String(DEFAULT_LOCATION.radiusKm),
  });
  const [center, setCenter] = useState({ lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng });
  const [incidents, setIncidents] = useState<TomTomIncident[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const radiusKm = Number(form.radiusKm);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
      setError('Координаты и радиус должны быть числами.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radiusKm: String(radiusKm) });
      const res = await fetch(`/api/admin/situational/tomtom?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents ?? []);
      setConfigured(Boolean(data.configured));
      setCenter({ lat, lng });
      setLoaded(true);
    } catch {
      setError('Не удалось загрузить события TomTom.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-700">Вне штата Нью-Йорк — TomTom (fallback, демо)</h2>
      <p className="text-xs text-gray-500">
        511NY (секция выше) покрывает только штат Нью-Йорк — здесь тот же принцип, что описан в §7.2 ТЗ: для городов вне NY State
        используется TomTom Traffic Incidents API. По умолчанию — {DEFAULT_LOCATION.label}, координаты можно изменить вручную.
      </p>

      {loaded && !configured && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Ключ TomTom не настроен (переменная окружения <code>TOMTOM_API_KEY</code> на сервере пуста) — список событий пуст. Получить
          бесплатный ключ:{' '}
          <a href="https://developer.tomtom.com" target="_blank" rel="noreferrer" className="underline">
            developer.tomtom.com
          </a>
          .
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Широта
          <input
            className="mt-1 block w-32 rounded border px-2 py-1"
            value={form.lat}
            onChange={(e) => setForm({ ...form, lat: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Долгота
          <input
            className="mt-1 block w-32 rounded border px-2 py-1"
            value={form.lng}
            onChange={(e) => setForm({ ...form, lng: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Радиус, км
          <input
            className="mt-1 block w-24 rounded border px-2 py-1"
            value={form.radiusKm}
            onChange={(e) => setForm({ ...form, radiusKm: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? 'Загрузка…' : 'Показать'}
        </button>
        {loaded && <span className="text-xs text-gray-500">Событий: {incidents.length}</span>}
      </div>

      {loaded && <TomTomIncidentMap center={center} incidents={incidents} heightClassName="h-[28rem] w-full rounded" zoom={11} />}
    </div>
  );
}

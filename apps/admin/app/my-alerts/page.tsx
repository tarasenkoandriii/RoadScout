'use client';

import { useEffect, useState } from 'react';
import AuthGate from '../../components/AuthGate';
import { useI18n } from '../../components/I18nProvider';

interface Subscription {
  id: string;
  type: 'CAMERA_STATUS' | 'AREA_INCIDENT';
  label: string;
  createdAt: string;
  lastNotifiedAt: string | null;
}

// Підписки-алерти (див. doc/README.md) — сповіщення прилітають у Telegram (той самий бот, що
// й логін). AREA_INCIDENT можна створити прямо тут (вручну вкажіть координати або скористайтесь
// геолокацією браузера); CAMERA_STATUS підписки створюються кнопкою "Стежити" на сторінці
// пошуку камер (там уже є конкретний cameraId під рукою).
export default function MyAlertsPage() {
  const { t } = useI18n();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('1500');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch('/api/alerts', { credentials: 'include' })
      .then((r) => r.json())
      .then(setSubs)
      .catch(() => setSubs([]));
  };

  useEffect(() => {
    load();
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!label || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      setError(t('myAlerts_errorMissingFields'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: 'AREA_INCIDENT',
          lat: parsedLat,
          lng: parsedLng,
          radiusMeters: Number(radiusMeters) || undefined,
          label,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setLabel('');
      setLat('');
      setLng('');
      load();
    } catch (e: any) {
      setError(e.message || t('myAlerts_errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  const unsubscribe = async (id: string) => {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <AuthGate>
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('myAlerts_title')}</h1>
          <p className="text-sm text-gray-500">{t('myAlerts_subtitle')}</p>
        </div>

        <ul className="space-y-2">
          {subs.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <p className="font-medium">{s.label}</p>
                <p className="text-xs text-gray-500">
                  {s.type === 'CAMERA_STATUS' ? t('myAlerts_typeCameraStatus') : t('myAlerts_typeAreaIncident')}
                  {s.lastNotifiedAt ? ` · ${t('myAlerts_lastNotified', { date: new Date(s.lastNotifiedAt).toLocaleString('uk-UA') })}` : ''}
                </p>
              </div>
              <button onClick={() => unsubscribe(s.id)} className="text-xs text-red-600 underline">
                {t('myAlerts_unsubscribe')}
              </button>
            </li>
          ))}
          {subs.length === 0 && <p className="text-sm text-gray-500">{t('myAlerts_empty')}</p>}
        </ul>

        <form onSubmit={submit} className="space-y-3 rounded border p-4">
          <h2 className="font-medium">{t('myAlerts_formTitle')}</h2>

          <label className="block text-sm">
            {t('myAlerts_labelName')}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('myAlerts_namePlaceholder')}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              {t('myAlerts_labelLat')}
              <input className="mt-1 w-full rounded border px-2 py-1" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="50.4501" />
            </label>
            <label className="text-sm">
              {t('myAlerts_labelLng')}
              <input className="mt-1 w-full rounded border px-2 py-1" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="30.5234" />
            </label>
          </div>

          <button type="button" onClick={useMyLocation} className="text-xs text-blue-600 underline">
            {t('myAlerts_useMyLocation')}
          </button>

          <label className="block text-sm">
            {t('myAlerts_labelRadius')}
            <input
              type="number"
              min={100}
              max={20000}
              className="mt-1 w-full rounded border px-3 py-2"
              value={radiusMeters}
              onChange={(e) => setRadiusMeters(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting} className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {submitting ? t('myAlerts_submitButtonLoading') : t('myAlerts_submitButton')}
          </button>
        </form>
      </main>
    </AuthGate>
  );
}

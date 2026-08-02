'use client';

import { useEffect, useState } from 'react';
import AuthGate from '../../components/AuthGate';
import { useI18n } from '../../components/I18nProvider';

interface City {
  id: string;
  name: string;
  countryName: string | null;
}

interface Submission {
  id: string;
  streamUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  rejectionReason: string | null;
}

// Краудсорс "Додати камеру" (див. doc/README.md) — доступно будь-якому залогіненому
// користувачу (клієнту чи блогеру, окремої ролі не потрібно). Заявка йде в чергу модерації
// (окрема вкладка в адмінці), а не одразу в публічний реєстр.
export default function AddCameraPage() {
  const { t } = useI18n();
  const [cities, setCities] = useState<City[]>([]);
  const [streamUrl, setStreamUrl] = useState('');
  const [suggestedName, setSuggestedName] = useState('');
  const [cityId, setCityId] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Submission[]>([]);

  const loadMine = () => {
    fetch('/api/camera-submissions/mine', { credentials: 'include' })
      .then((r) => r.json())
      .then(setMine)
      .catch(() => setMine([]));
  };

  useEffect(() => {
    fetch('/api/cities', { credentials: 'include' })
      .then((r) => r.json())
      .then(setCities)
      .catch(() => setCities([]));
    loadMine();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamUrl) {
      setError(t('addCamera_errorMissingUrl'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/camera-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          streamUrl,
          suggestedName: suggestedName || undefined,
          cityId: cityId || undefined,
          address: address || undefined,
          description: description || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setStreamUrl('');
      setSuggestedName('');
      setAddress('');
      setDescription('');
      loadMine();
    } catch (e: any) {
      setError(e.message || t('addCamera_errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_LABEL: Record<string, string> = {
    PENDING: t('addCamera_statusPending'),
    APPROVED: t('addCamera_statusApproved'),
    REJECTED: t('addCamera_statusRejected'),
  };

  return (
    <AuthGate>
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('addCamera_title')}</h1>
          <p className="text-sm text-gray-500">{t('addCamera_subtitle')}</p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded border p-4">
          <label className="block text-sm">
            {t('addCamera_labelStreamUrl')}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>

          <label className="block text-sm">
            {t('addCamera_labelName')}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={suggestedName}
              onChange={(e) => setSuggestedName(e.target.value)}
              placeholder={t('addCamera_namePlaceholder')}
            />
          </label>

          <label className="block text-sm">
            {t('addCamera_labelCity')}
            <select className="mt-1 w-full rounded border px-2 py-2" value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">{t('addCamera_cityNotSpecified')}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.countryName ? ` (${c.countryName})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            {t('addCamera_labelAddress')}
            <input className="mt-1 w-full rounded border px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>

          <label className="block text-sm">
            {t('addCamera_labelDescription')}
            <textarea className="mt-1 w-full rounded border px-3 py-2" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting} className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {submitting ? t('addCamera_submitButtonLoading') : t('addCamera_submitButton')}
          </button>
        </form>

        <div>
          <h2 className="mb-2 font-medium">{t('addCamera_myRequestsTitle')}</h2>
          <ul className="space-y-2 text-sm">
            {mine.map((s) => (
              <li key={s.id} className="rounded border p-3">
                <p className="truncate">{s.streamUrl}</p>
                <p className="text-xs text-gray-500">
                  {STATUS_LABEL[s.status]} · {new Date(s.submittedAt).toLocaleString('uk-UA')}
                  {s.rejectionReason ? ` · ${s.rejectionReason}` : ''}
                </p>
              </li>
            ))}
            {mine.length === 0 && <li className="text-gray-500">{t('addCamera_noRequests')}</li>}
          </ul>
        </div>
      </main>
    </AuthGate>
  );
}

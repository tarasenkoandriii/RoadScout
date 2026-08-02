'use client';

import { useEffect, useState } from 'react';
import AuthGate from '../../components/AuthGate';
import { useI18n } from '../../components/I18nProvider';

interface WaitSummary {
  averageMinutes: number | null;
  reportCount: number;
  lastReportedAt: string | null;
}

interface Crossing {
  id: string;
  name: string;
  countryFrom: string;
  countryTo: string;
  waitEstimate: { UA_OUT: WaitSummary; UA_IN: WaitSummary };
}

// Час очікування на кордоні (краудсорс, див. doc/README.md) — оцінка це просте усереднення
// звітів користувачів за останні кілька годин, не офіційні дані митниці/прикордонслужби.
export default function BorderPage() {
  const { t } = useI18n();
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [direction, setDirection] = useState<'UA_OUT' | 'UA_IN'>('UA_OUT');
  const [minutes, setMinutes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch('/api/border-crossings', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setCrossings(data);
        if (!selected && data[0]) setSelected(data[0].id);
      })
      .catch(() => setCrossings([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const waitMinutes = Number(minutes);
    if (!selected || !Number.isFinite(waitMinutes) || waitMinutes < 0) {
      setError(t('border_errorInvalidMinutes'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/border-crossings/${selected}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ direction, waitMinutes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setMinutes('');
      load();
    } catch (e: any) {
      setError(e.message || t('border_errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatSummary = (s: WaitSummary) =>
    s.averageMinutes === null
      ? t('border_noRecentReports')
      : t('border_summaryTemplate', { avg: s.averageMinutes, count: s.reportCount });

  return (
    <AuthGate>
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('border_title')}</h1>
          <p className="text-sm text-gray-500">{t('border_subtitle')}</p>
        </div>

        <ul className="space-y-2">
          {crossings.map((c) => (
            <li key={c.id} className="rounded border p-4">
              <p className="font-medium">
                {c.name} ({c.countryFrom} ↔ {c.countryTo})
              </p>
              <div className="mt-1 grid grid-cols-2 gap-2 text-sm text-gray-600">
                <p>{t('border_directionSummary', { direction: t('border_directionOut'), summary: formatSummary(c.waitEstimate.UA_OUT) })}</p>
                <p>{t('border_directionSummary', { direction: t('border_directionIn'), summary: formatSummary(c.waitEstimate.UA_IN) })}</p>
              </div>
            </li>
          ))}
          {crossings.length === 0 && <p className="text-sm text-gray-500">{t('border_loading')}</p>}
        </ul>

        <form onSubmit={submit} className="space-y-3 rounded border p-4">
          <h2 className="font-medium">{t('border_reportFormTitle')}</h2>

          <label className="block text-sm">
            {t('border_crossingLabel')}
            <select className="mt-1 w-full rounded border px-2 py-2" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {crossings.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            {t('border_directionLabel')}
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'UA_OUT' | 'UA_IN')}
            >
              <option value="UA_OUT">{t('border_directionOut')}</option>
              <option value="UA_IN">{t('border_directionIn')}</option>
            </select>
          </label>

          <label className="block text-sm">
            {t('border_minutesLabel')}
            <input
              type="number"
              min={0}
              max={1440}
              className="mt-1 w-full rounded border px-3 py-2"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder={t('border_minutesPlaceholder')}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting} className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {submitting ? t('border_submitButtonLoading') : t('border_submitButton')}
          </button>
        </form>
      </main>
    </AuthGate>
  );
}

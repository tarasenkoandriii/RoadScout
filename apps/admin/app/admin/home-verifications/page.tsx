'use client';

import { useEffect, useState } from 'react';

interface VerificationSummary {
  id: string;
  telegramId: string;
  claimedAddress: string;
  status: string;
  submittedAt: string;
  addressMatchConfidence: number | null;
  handwrittenDateText: string | null;
  handwrittenDateIsRecent: boolean | null;
  looksGenuine: boolean | null;
  aiNotes: string | null;
  adminExempt: boolean;
}

interface VerificationDetail extends VerificationSummary {
  receiptImageUrl: string | null;
  extractedAddress: string | null;
  lat: number | null;
  lng: number | null;
}

interface CalibrationStats {
  currentMinConfidence: number;
  buckets: Record<string, { total: number; approved: number; rejected: number; needsReview: number }>;
  totalWithConfidenceScore: number;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-700',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function HomeVerificationsAdminPage() {
  const [items, setItems] = useState<VerificationSummary[]>([]);
  const [stats, setStats] = useState<CalibrationStats | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<VerificationDetail | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [listRes, statsRes] = await Promise.all([
      fetch(`/api/admin/home-verifications${showAll ? '?status=all' : ''}`, { credentials: 'include' }),
      fetch('/api/admin/home-verifications/stats', { credentials: 'include' }),
    ]);
    setItems(await listRes.json());
    setStats(await statsRes.json());
  };

  useEffect(() => {
    load();
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/admin/home-verifications/${id}`, { credentials: 'include' });
    setSelected(await res.json());
    setRejectReason('');
  };

  const approve = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/home-verifications/${id}/approve`, { method: 'POST', credentials: 'include' });
      setSelected(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/home-verifications/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      setSelected(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Верификация адресов («Мой дом»)</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Показать все статусы
        </label>
      </div>

      {stats && (
        <div className="rounded border p-4 text-sm">
          <p className="mb-2 font-medium">
            Калибровка порога: текущий <code>HOME_VERIFICATION_MIN_CONFIDENCE</code> ={' '}
            <strong>{stats.currentMinConfidence}</strong> · заявок с оценкой уверенности: {stats.totalWithConfidenceScore}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">Диапазон confidence</th>
                <th>Всего</th>
                <th>Одобрено</th>
                <th>Отклонено</th>
                <th>На ревью</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.buckets).map(([range, b]) => (
                <tr key={range} className="border-b">
                  <td className="py-1">{range}</td>
                  <td>{b.total}</td>
                  <td className="text-green-700">{b.approved}</td>
                  <td className="text-red-700">{b.rejected}</td>
                  <td className="text-amber-700">{b.needsReview}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-gray-500">
            Если в диапазонах ниже порога много «Одобрено» вручную — порог, возможно, стоит понизить. Если выше порога
            много «Отклонено» — стоит повысить.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Адрес</th>
              <th>Статус</th>
              <th>Подано</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-500">
                  Нет заявок.
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="py-2">{it.claimedAddress}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[it.status] ?? ''}`}>{it.status}</span>
                  {it.adminExempt && (
                    <span className="ml-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">Админ</span>
                  )}
                </td>
                <td>{new Date(it.submittedAt).toLocaleString('ru-RU')}</td>
                <td>
                  <button className="text-blue-600 underline text-xs" onClick={() => openDetail(it.id)}>
                    Открыть
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selected && (
          <div className="rounded border p-4 space-y-3 text-sm">
            <h2 className="font-medium">Заявка: {selected.claimedAddress}</h2>

            {selected.receiptImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={selected.receiptImageUrl} alt="Квитанция" className="max-h-96 w-full rounded border object-contain" />
            ) : (
              <div className="rounded border border-dashed p-3 text-sm text-gray-500">
                {selected.adminExempt
                  ? 'Квитанция не требовалась — заявка от администратора, подтверждена автоматически.'
                  : 'Фото квитанции отсутствует.'}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-gray-500">Распознанный адрес</dt>
              <dd>{selected.extractedAddress ?? '—'}</dd>
              <dt className="text-gray-500">Совпадение адреса</dt>
              <dd>{selected.addressMatchConfidence != null ? `${Math.round(selected.addressMatchConfidence * 100)}%` : '—'}</dd>
              <dt className="text-gray-500">Рукописная дата</dt>
              <dd>
                {selected.handwrittenDateText ?? '—'}{' '}
                {selected.handwrittenDateIsRecent === false && <span className="text-red-600">(не свежая/не рукописная)</span>}
              </dd>
              <dt className="text-gray-500">Похоже на подлинник</dt>
              <dd>{selected.looksGenuine === false ? <span className="text-red-600">Нет</span> : selected.looksGenuine === true ? 'Да' : '—'}</dd>
            </dl>

            {selected.aiNotes && <p className="rounded bg-gray-50 p-2 text-gray-600">Комментарий AI: {selected.aiNotes}</p>}

            <div className="flex flex-col gap-2 pt-2">
              <button
                className="rounded bg-green-600 px-3 py-1.5 text-white disabled:opacity-50"
                onClick={() => approve(selected.id)}
                disabled={busy}
              >
                Одобрить
              </button>
              <input
                className="rounded border px-2 py-1"
                placeholder="Причина отказа (необязательно)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50"
                onClick={() => reject(selected.id)}
                disabled={busy}
              >
                Отклонить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

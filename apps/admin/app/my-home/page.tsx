'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthGate from '../../components/AuthGate';
import LanguageSelector from '../../components/LanguageSelector';
import { useI18n } from '../../components/I18nProvider';

const SectorMap = dynamic(() => import('../../components/SectorMap'), { ssr: false });

interface VerificationStatus {
  status: 'NONE' | 'PENDING' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
  claimedAddress?: string;
  submittedAt?: string;
  rejectionReason?: string;
  aiNotes?: string;
}

interface HomeCamera {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  distanceMeters: number;
  directionFromCamera: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

interface HomeSectorResponse {
  point: { lat: number; lng: number };
  cameras: HomeCamera[];
}

export default function MyHomePage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [sector, setSector] = useState<HomeSectorResponse | null>(null);
  const [address, setAddress] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STATUS_LABEL: Record<string, string> = {
    NONE: t('myHomeStatus_none'),
    PENDING: t('myHomeStatus_pending'),
    NEEDS_REVIEW: t('myHomeStatus_needsReview'),
    APPROVED: t('myHomeStatus_approved'),
    REJECTED: t('myHomeStatus_rejected'),
  };

  const loadStatus = async () => {
    const [meRes, statusRes] = await Promise.all([
      fetch('/api/auth/me', { credentials: 'include' }),
      fetch('/api/home/verify/status', { credentials: 'include' }),
    ]);
    const me = await meRes.json().catch(() => ({ user: null }));
    setIsAdmin(!!me.user?.isAdmin);

    const data = await statusRes.json();
    setStatus(data);

    if (data.status === 'APPROVED') {
      const sectorRes = await fetch('/api/home/sector', { credentials: 'include' });
      if (sectorRes.ok) setSector(await sectorRes.json());
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Админу фото квитанции не требуется (см. doc/README.md) — только адрес.
    if (!address || (!file && !isAdmin)) {
      setError(t('myHome_errorMissingFields'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('address', address);
      if (file) form.append('receipt', file);

      // Не выставляем Content-Type вручную — браузер сам проставит multipart-boundary.
      const res = await fetch('/api/home/verify', { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setAddress('');
      setFile(null);
      await loadStatus();
    } catch (e: any) {
      setError(e.message || t('myHome_errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthGate>
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold mb-1">{t('myHome_title')}</h1>
            <p className="text-sm text-gray-500">{t('myHome_subtitle')}</p>
          </div>
          <LanguageSelector />
        </div>

        {status === null && <p className="text-sm text-gray-500">{t('myHome_loading')}</p>}

        {status && (status.status === 'NONE' || status.status === 'REJECTED') && (
          <form onSubmit={handleSubmit} className="space-y-3 rounded border p-4">
            {status.status === 'REJECTED' && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-700">
                {t('myHome_rejectedPrefix')}
                {status.rejectionReason ? t('myHome_rejectedReasonSuffix', { reason: status.rejectionReason }) : '.'}{' '}
                {t('myHome_canResubmit')}
              </div>
            )}

            <label className="block text-sm">
              {t('myHome_addressLabel')}
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('myHome_addressPlaceholder')}
              />
            </label>

            <label className="block text-sm">
              {t('myHome_receiptLabel')}
              {isAdmin ? t('myHome_receiptOptionalForAdmin') : ''}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="mt-1 w-full text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {isAdmin ? (
              <div className="rounded bg-blue-50 p-3 text-sm text-blue-800">{t('myHome_adminNote')}</div>
            ) : (
              <div className="rounded bg-amber-50 p-3 text-sm text-amber-800">
                <strong>{t('myHome_dateWarningLabel')}</strong> {t('myHome_dateWarningText')}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              {submitting ? t('myHome_submitButtonLoading') : t('myHome_submitButton')}
            </button>
          </form>
        )}

        {status && (status.status === 'PENDING' || status.status === 'NEEDS_REVIEW') && (
          <div className="rounded border p-4 text-sm space-y-1">
            <p className="font-medium">{STATUS_LABEL[status.status]}</p>
            <p className="text-gray-500">
              {t('myHome_addressPrefix')} {status.claimedAddress}
            </p>
            {status.status === 'NEEDS_REVIEW' && <p className="text-gray-500">{t('myHome_needsReviewNote')}</p>}
          </div>
        )}

        {status?.status === 'APPROVED' && (
          <div className="space-y-4">
            <div className="rounded bg-green-50 p-3 text-sm text-green-700">
              {t('myHome_approvedPrefix')} {status.claimedAddress}
            </div>

            {sector && sector.cameras.length === 0 && <p className="text-sm text-gray-500">{t('myHome_noCamerasFound')}</p>}

            {sector && sector.cameras.length > 0 && (
              <>
                <SectorMap
                  center={sector.point}
                  addressMarker={sector.point}
                  cameras={sector.cameras.map((c) => ({
                    id: c.id,
                    name: c.name,
                    lat: c.lat,
                    lng: c.lng,
                    azimuth: c.azimuth,
                    fovAngle: c.fovAngle,
                    rangeMeters: c.rangeMeters,
                  }))}
                />
                <ul className="space-y-2 text-sm">
                  {sector.cameras.map((c) => (
                    <li key={c.id} className="border-b pb-2">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-gray-500">
                        {t('myHome_cameraDistanceDirection', { distance: c.distanceMeters, direction: c.directionFromCamera })}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </main>
    </AuthGate>
  );
}

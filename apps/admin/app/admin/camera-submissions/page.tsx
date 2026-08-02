'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';

interface Submission {
  id: string;
  streamUrl: string;
  suggestedName: string | null;
  address: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  cityId: string | null;
  status: string;
  submittedByTelegramId: string;
  submittedAt: string;
}

interface OsmSuggestion {
  osmLat: number | null;
  osmLng: number | null;
  osmConfidence: number;
  osmDisplayName: string | null;
}

interface AiSuggestion {
  configured: boolean;
  suggestedAddress: string | null;
  addressConfidence: number;
  suggestedLat: number | null;
  suggestedLng: number | null;
  coordinatesConfidence: number;
  isLikelyIndoor: boolean;
  reasoning: string | null;
  placesLat: number | null;
  placesLng: number | null;
  placesConfidence: number;
  placesName: string | null;
  placesFormattedAddress: string | null;
}

const STREAM_TYPES = ['IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE'];

// Тот же фикс, что и на /admin/parser/review (см. doc/AUDIT-embed-bare-url-fix.md) — угадываем
// тип потока по самой ссылке при открытии заявки, а не жёстко "IFRAME" по умолчанию.
function inferStreamType(streamUrl: string): string {
  return /youtube\.com|youtu\.be/i.test(streamUrl) ? 'YOUTUBE_LIVE' : 'IFRAME';
}

// Краудсорс "Додати камеру" — окрема вкладка модерації (див. doc/README.md). approve() створює
// справжню Camera одразу з confidence: ESTIMATED і дефолтною геометрією (azimuth/fovAngle/
// rangeMeters можна лишити стандартними тут і довести пізніше через /admin/cameras/:id/calibrate).
// AI-підказка (GrokCameraAssistService) і перемикач "всередині приміщення" — за прямим запитом.
export default function CameraSubmissionsAdminPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Submission[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [osmSuggestion, setOsmSuggestion] = useState<OsmSuggestion | null>(null);
  const [osmLoading, setOsmLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [form, setForm] = useState({
    name: '',
    streamType: 'IFRAME',
    locationType: 'OUTDOOR' as 'OUTDOOR' | 'INDOOR',
    lat: '',
    lng: '',
    azimuth: '0',
    fovAngle: '90',
    rangeMeters: '300',
  });

  const load = () => {
    fetch(`/api/admin/camera-submissions${showAll ? '?status=all' : ''}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setItems)
      .catch(() => setItems([]));
  };

  useEffect(() => {
    load();
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  const openDetail = (item: Submission) => {
    setSelected(item);
    setAiSuggestion(null);
    setOsmSuggestion(null);
    setForm({
      name: item.suggestedName ?? '',
      streamType: inferStreamType(item.streamUrl),
      locationType: 'OUTDOOR',
      lat: item.lat != null ? String(item.lat) : '',
      lng: item.lng != null ? String(item.lng) : '',
      azimuth: '0',
      fovAngle: '90',
      rangeMeters: '300',
    });
    setRejectReason('');

    // Nominatim (OpenStreetMap) — бесплатно, без ключа, уточняем адрес сразу при открытии
    // карточки заявки (см. запрос пользователя), не по кнопке.
    setOsmLoading(true);
    fetch(`/api/admin/camera-submissions/${item.id}/nominatim-suggest`, { method: 'POST', credentials: 'include' })
      .then((r) => r.json())
      .then(setOsmSuggestion)
      .catch(() => setOsmSuggestion(null))
      .finally(() => setOsmLoading(false));
  };

  const askAi = async () => {
    if (!selected) return;
    setAiBusy(true);
    try {
      const res = await fetch(`/api/admin/camera-submissions/${selected.id}/ai-suggest`, { method: 'POST', credentials: 'include' });
      setAiSuggestion(await res.json());
    } finally {
      setAiBusy(false);
    }
  };

  const applyOsmCoords = () => {
    if (!osmSuggestion?.osmLat || !osmSuggestion?.osmLng) return;
    setForm({ ...form, lat: String(osmSuggestion.osmLat), lng: String(osmSuggestion.osmLng) });
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setForm({ ...form, locationType: aiSuggestion.isLikelyIndoor ? 'INDOOR' : form.locationType });
  };
  const applyAiCoords = () => {
    if (!aiSuggestion?.suggestedLat || !aiSuggestion?.suggestedLng) return;
    setForm({ ...form, lat: String(aiSuggestion.suggestedLat), lng: String(aiSuggestion.suggestedLng) });
  };
  const applyPlacesCoords = () => {
    if (!aiSuggestion?.placesLat || !aiSuggestion?.placesLng) return;
    setForm({ ...form, lat: String(aiSuggestion.placesLat), lng: String(aiSuggestion.placesLng) });
  };

  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/camera-submissions/${selected.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name,
          streamType: form.streamType,
          locationType: form.locationType,
          lat: Number(form.lat),
          lng: Number(form.lng),
          azimuth: Number(form.azimuth),
          fovAngle: Number(form.fovAngle),
          rangeMeters: Number(form.rangeMeters),
        }),
      });
      if (res.ok) {
        setSelected(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/camera-submissions/${selected.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      setSelected(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('cameraSubmissions_title')}</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('cameraSubmissions_showAll')}
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">{t('cameraSubmissions_colLink')}</th>
              <th>{t('cameraSubmissions_colStatus')}</th>
              <th>{t('cameraSubmissions_colSubmittedAt')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-500">
                  {t('cameraSubmissions_empty')}
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="py-2 max-w-[200px] truncate">{it.streamUrl}</td>
                <td>{it.status}</td>
                <td>{new Date(it.submittedAt).toLocaleString('ru-RU')}</td>
                <td>
                  <button className="text-blue-600 underline text-xs" onClick={() => openDetail(it)}>
                    {t('cameraSubmissions_open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selected && (
          <div className="rounded border p-4 space-y-3 text-sm">
            <h2 className="font-medium break-all">{selected.streamUrl}</h2>
            <p className="text-gray-500">
              {selected.address ?? '—'} {selected.description ? `· ${selected.description}` : ''}
            </p>

            {/* Nominatim (OpenStreetMap) — бесплатно, без ключа, загружается автоматически при
                открытии заявки — приоритетный источник, показывается первым. */}
            <div className="rounded bg-green-50 p-2 text-xs">
              <p className="font-medium text-green-800">{t('cameraSubmissions_osmTitle')}</p>
              {osmLoading ? (
                <p className="text-gray-500">{t('cameraSubmissions_osmLoading')}</p>
              ) : osmSuggestion?.osmLat != null && osmSuggestion?.osmLng != null ? (
                <>
                  <p>
                    {t('cameraSubmissions_osmCoordsLabel')} <strong>{osmSuggestion.osmLat.toFixed(5)}, {osmSuggestion.osmLng.toFixed(5)}</strong> ({Math.round(osmSuggestion.osmConfidence * 100)}%)
                  </p>
                  {osmSuggestion.osmDisplayName && <p className="text-gray-600">{osmSuggestion.osmDisplayName}</p>}
                  <button onClick={applyOsmCoords} className="text-blue-600 underline">
                    {t('cameraSubmissions_aiUse')}
                  </button>
                </>
              ) : (
                <p className="text-gray-500">{t('cameraSubmissions_osmNotFound')}</p>
              )}
            </div>

            <button onClick={askAi} disabled={aiBusy} className="text-xs text-purple-700 underline disabled:opacity-50">
              {aiBusy ? t('cameraSubmissions_askAiBusy') : t('cameraSubmissions_askAi')}
            </button>
            {aiSuggestion && (
              <div className="rounded bg-purple-50 p-2 text-xs">
                {!aiSuggestion.configured ? (
                  <p className="text-gray-500">{t('cameraSubmissions_aiNotConfigured')}</p>
                ) : (
                  <>
                    <p>
                      {t('cameraSubmissions_aiAddressLabel')} <strong>{aiSuggestion.suggestedAddress ?? '—'}</strong> ({Math.round(aiSuggestion.addressConfidence * 100)}%)
                    </p>
                    <p>
                      {t('cameraSubmissions_aiCoordsLabel')}{' '}
                      <strong>
                        {aiSuggestion.suggestedLat != null && aiSuggestion.suggestedLng != null
                          ? `${aiSuggestion.suggestedLat.toFixed(5)}, ${aiSuggestion.suggestedLng.toFixed(5)}`
                          : '—'}
                      </strong>
                      {aiSuggestion.suggestedLat != null && (
                        <>
                          {' '}
                          ({Math.round(aiSuggestion.coordinatesConfidence * 100)}%){' '}
                          <button onClick={applyAiCoords} className="text-blue-600 underline">
                            {t('cameraSubmissions_aiUse')}
                          </button>
                        </>
                      )}
                    </p>
                    <p>
                      {t('cameraSubmissions_aiPlacesCoordsLabel')}{' '}
                      <strong>
                        {aiSuggestion.placesLat != null && aiSuggestion.placesLng != null
                          ? `${aiSuggestion.placesLat.toFixed(5)}, ${aiSuggestion.placesLng.toFixed(5)}`
                          : '—'}
                      </strong>
                      {aiSuggestion.placesLat != null && (
                        <>
                          {' '}
                          ({t('cameraSubmissions_aiFoundLabel')} {aiSuggestion.placesName ?? aiSuggestion.placesFormattedAddress ?? '—'}, {Math.round(aiSuggestion.placesConfidence * 100)}%){' '}
                          <button onClick={applyPlacesCoords} className="text-blue-600 underline">
                            {t('cameraSubmissions_aiUse')}
                          </button>
                        </>
                      )}
                    </p>
                    <p>
                      {t('cameraSubmissions_aiIndoorLabel')} {aiSuggestion.isLikelyIndoor ? t('cameraSubmissions_yes') : t('cameraSubmissions_no')}
                    </p>
                    {aiSuggestion.reasoning && <p className="text-gray-500 mt-1">{aiSuggestion.reasoning}</p>}
                    <button onClick={applyAiSuggestion} className="mt-1 text-blue-600 underline">
                      {t('cameraSubmissions_aiApply')}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label>
                {t('cameraSubmissions_labelName')}
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                {t('cameraSubmissions_labelStreamType')}
                <select className="mt-1 w-full rounded border px-2 py-1" value={form.streamType} onChange={(e) => setForm({ ...form, streamType: e.target.value })}>
                  {STREAM_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2">
                {t('cameraSubmissions_labelLocationType')}
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.locationType}
                  onChange={(e) => setForm({ ...form, locationType: e.target.value as 'OUTDOOR' | 'INDOOR' })}
                >
                  <option value="OUTDOOR">{t('cameraSubmissions_locationOutdoor')}</option>
                  <option value="INDOOR">{t('cameraSubmissions_locationIndoor')}</option>
                </select>
              </label>
              <label>
                {t('cameraSubmissions_labelLat')}
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
              </label>
              <label>
                {t('cameraSubmissions_labelLng')}
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
              </label>
              {form.locationType === 'OUTDOOR' && (
                <>
                  <label>
                    {t('cameraSubmissions_labelAzimuth')}
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.azimuth} onChange={(e) => setForm({ ...form, azimuth: e.target.value })} />
                  </label>
                  <label>
                    {t('cameraSubmissions_labelFov')}
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.fovAngle} onChange={(e) => setForm({ ...form, fovAngle: e.target.value })} />
                  </label>
                  <label>
                    {t('cameraSubmissions_labelRange')}
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.rangeMeters} onChange={(e) => setForm({ ...form, rangeMeters: e.target.value })} />
                  </label>
                </>
              )}
            </div>
            {form.locationType === 'OUTDOOR' && <p className="text-xs text-gray-500">{t('cameraSubmissions_calibrationNote')}</p>}

            <div className="flex flex-col gap-2 pt-2">
              <button className="rounded bg-green-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={approve} disabled={busy}>
                {t('cameraSubmissions_approveButton')}
              </button>
              <input
                className="rounded border px-2 py-1"
                placeholder={t('cameraSubmissions_rejectReasonPlaceholder')}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={reject} disabled={busy}>
                {t('cameraSubmissions_rejectButton')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

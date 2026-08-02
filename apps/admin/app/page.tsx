'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthGate from '../components/AuthGate';
import LogoutButton from '../components/LogoutButton';
import WindyWidget from '../components/WindyWidget';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../components/I18nProvider';

const SectorMap = dynamic(() => import('../components/SectorMap'), { ssr: false });

interface CameraResult {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  confidence: string;
  status: string;
  delaySeconds: number | null;
  distanceMeters: number;
  directionFromCamera: string;
  possiblyBlocked?: boolean;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
}

interface SearchResponse {
  address: string;
  point: { lat: number; lng: number } | null;
  cameras: CameraResult[];
}

// Города Украины (см. doc/README.md) — список подтягивается с бэкенда (справочник City),
// а не хардкодится тут, чтобы новые города появлялись без пересборки фронта.
interface City {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  region: string | null;
  countryCode: string;
  countryName: string | null;
}

export default function HomePage() {
  const { t } = useI18n();
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState<string>('');
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cities', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: City[]) => {
        setCities(data);
        // По умолчанию — Київ, если есть в списке, иначе первый город.
        const kyiv = data.find((c) => c.slug === 'kyiv');
        setCityId((kyiv ?? data[0])?.id ?? '');
      })
      .catch(() => setCities([]));
  }, []);

  const selectedCity = cities.find((c) => c.id === cityId) ?? null;

  const STATUS_LABEL: Record<string, string> = {
    ONLINE: t('status_online'),
    DELAYED: t('status_delayed'),
    OFFLINE: t('status_offline'),
    DISABLED_SECURITY: t('status_disabledSecurity'),
    UNKNOWN: t('status_unknown'),
  };

  const search = async () => {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ address });
      if (cityId) params.set('cityId', cityId);
      const res = await fetch(`/api/search?${params.toString()}`);
      const data: SearchResponse = await res.json();
      setResult(data);
      if (!data.point) setError(t('search_addressNotRecognized'));
    } finally {
      setLoading(false);
    }
  };

  // Поділитися локацією (див. doc/README.md) — якщо хтось відкрив нас за посиланням `/s/:slug`,
  // сторінка `/s/[slug]` вже зробила редирект сюди з готовими координатами в query-параметрах,
  // тож тут просто підвантажуємо результат напряму по точці, а не заново гадаємо адресу.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qLat = params.get('lat');
    const qLng = params.get('lng');
    const qAddress = params.get('address');
    if (qAddress) setAddress(qAddress);
    if (qLat && qLng) {
      setLoading(true);
      fetch(`/api/cameras/at-point?lat=${qLat}&lng=${qLng}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => setResult({ address: qAddress ?? '', point: data.point, cameras: data.cameras }))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const shareCurrentLocation = async () => {
    if (!result?.point) return;
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lat: result.point.lat, lng: result.point.lng, address, cityId: cityId || undefined }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const url = `${window.location.origin}/s/${data.slug}`;
    setShareUrl(url);
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
  };

  const [embedForCameraId, setEmbedForCameraId] = useState<string | null>(null);

  const followCamera = async (cameraId: string, cameraName: string) => {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'CAMERA_STATUS', cameraId, label: cameraName }),
    });
    if (res.ok) alert(t('follow_confirmation', { name: cameraName }));
  };

  // Центр для виджета погоды: результат поиска, если он есть, иначе центр выбранного города.
  const weatherCenter = result?.point ?? (selectedCity ? { lat: selectedCity.lat, lng: selectedCity.lng } : null);

  return (
    <AuthGate>
      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold mb-1">{t('search_title')}</h1>
            <p className="text-sm text-gray-500">{t('search_subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <LanguageSelector />
            <a href="/border" className="text-sm text-blue-600 underline whitespace-nowrap">
              {t('nav_border')}
            </a>
            <a href="/my-alerts" className="text-sm text-blue-600 underline whitespace-nowrap">
              {t('nav_myAlerts')}
            </a>
            <a href="/add-camera" className="text-sm text-blue-600 underline whitespace-nowrap">
              {t('nav_addCamera')}
            </a>
            <a href="/my-home" className="text-sm text-blue-600 underline whitespace-nowrap">
              {t('nav_myHome')}
            </a>
            <LogoutButton />
          </div>
        </div>

      <div className="flex gap-2">
        <select
          className="border rounded px-2 py-2 text-sm"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
        >
          {/* Города Украины и соседних стран (см. doc/README.md) — группируем по стране, Україна
              всегда первой (это основной рынок), остальные страны — в алфавитном порядке названия. */}
          {Object.entries(
            cities.reduce<Record<string, City[]>>((groups, c) => {
              const key = c.countryName ?? 'Україна';
              (groups[key] ??= []).push(c);
              return groups;
            }, {}),
          )
            .sort(([a], [b]) => (a === 'Україна' ? -1 : b === 'Україна' ? 1 : a.localeCompare(b)))
            .map(([countryName, group]) => (
              <optgroup key={countryName} label={countryName}>
                {group.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder={t('search_addressPlaceholder')}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={search}
          disabled={loading}
        >
          {loading ? t('search_buttonLoading') : t('search_button')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result?.point && (
        <>
          <SectorMap
            center={result.point}
            addressMarker={result.point}
            cameras={result.cameras.map((c) => ({
              id: c.id,
              name: c.name,
              lat: c.lat,
              lng: c.lng,
              azimuth: c.azimuth,
              fovAngle: c.fovAngle,
              rangeMeters: c.rangeMeters,
              status: c.status,
            }))}
          />

          <div className="flex items-center gap-2">
            <button onClick={shareCurrentLocation} className="text-sm text-blue-600 underline">
              {t('share_button')}
            </button>
            {shareUrl && (
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded border px-2 py-1 text-xs text-gray-600"
              />
            )}
          </div>

          {result.cameras.length === 0 ? (
            <p className="text-sm text-gray-500">
              {selectedCity && selectedCity.countryCode !== 'UA'
                ? t('search_noCamerasForeignCity', { city: selectedCity.name, country: selectedCity.countryName ?? '' })
                : t('search_noCamerasFound')}
            </p>
          ) : (
            <ul className="space-y-3">
              {result.cameras.map((c) => (
                <li key={c.id} className="border rounded p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-sm text-gray-500">
                        {t('camera_distanceDirection', { distance: c.distanceMeters, direction: c.directionFromCamera })}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-gray-100">{STATUS_LABEL[c.status] ?? c.status}</span>
                  </div>

                  {c.confidence === 'ESTIMATED' && (
                    <p className="text-xs text-yellow-700 mt-2">{t('camera_estimatedWarning')}</p>
                  )}
                  {c.possiblyBlocked && <p className="text-xs text-red-600 mt-1">{t('camera_possiblyBlocked')}</p>}
                  {c.delaySeconds ? (
                    <p className="text-xs text-gray-500 mt-1">
                      {t('camera_delay', { minutes: Math.round(c.delaySeconds / 60) })}
                    </p>
                  ) : null}

                  <a
                    href={c.streamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 underline mt-2 inline-block"
                  >
                    {t('camera_openStream')}
                  </a>
                  <button
                    onClick={() => setEmbedForCameraId(embedForCameraId === c.id ? null : c.id)}
                    className="text-sm text-gray-500 underline mt-2 ml-3 inline-block"
                  >
                    {t('embed_button')}
                  </button>
                  <button
                    onClick={() => followCamera(c.id, c.name)}
                    className="text-sm text-gray-500 underline mt-2 ml-3 inline-block"
                  >
                    {t('follow_button')}
                  </button>
                  {embedForCameraId === c.id && (
                    <div className="mt-2 rounded bg-gray-50 p-2 text-xs break-all">
                      <code>{`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/embed/${c.id}" width="480" height="270" frameborder="0" allowfullscreen></iframe>`}</code>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {weatherCenter && (
        <div className="space-y-2 border-t pt-4">
          <h2 className="text-sm font-medium text-gray-700">
            {t('weather_title')}
            {selectedCity ? ` — ${selectedCity.name}${selectedCity.countryCode !== 'UA' ? ` (${selectedCity.countryName})` : ''}` : ''} (Windy)
          </h2>
          <WindyWidget lat={weatherCenter.lat} lng={weatherCenter.lng} zoom={result?.point ? 11 : 8} />
        </div>
      )}

      <p className="text-xs text-gray-400 pt-4 border-t">{t('footer_disclaimer')}</p>
      </main>
    </AuthGate>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface SourceRawSummary {
  id: string;
  externalId: string;
  sourcePageUrl: string;
  rawTitle: string;
  rawLocationText: string | null;
  rawStreamUrl: string | null;
  guessedLat: number | null;
  guessedLng: number | null;
  geocodeConfidence: number | null;
  importStatus: string;
  scrapedAt: string;
  provider: { name: string };
}

interface SourceRawDetail extends SourceRawSummary {
  provider: { name: string; city: { name: string } | null };
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

// ВАЖНО (реальный найденный инцидент — см. doc/AUDIT-embed-bare-url-fix.md): раньше форма
// всегда открывалась с жёстко закодированным streamType: 'IFRAME' по умолчанию, независимо от
// того, что реально показывает rawStreamUrl. Реальный случай: у камеры "Шулявка реконструкція"
// rawStreamUrl оказался youtube.com-ссылкой, но админ (по невнимательности, форма не подсказала)
// оставил тип "IFRAME" — итог: сохранённая камера с несовместимой парой тип/ссылка, потоковый
// виджет пытался вставить YouTube в <iframe> с типом IFRAME и ловил X-Frame-Options-блокировку.
// Теперь тип угадывается по самой ссылке при открытии карточки — админ всё ещё может поменять
// вручную, но дефолт куда реже вводит в заблуждение.
function inferStreamType(rawStreamUrl: string | null): string {
  if (!rawStreamUrl) return 'IFRAME';
  return /youtube\.com|youtu\.be/i.test(rawStreamUrl) ? 'YOUTUBE_LIVE' : 'IFRAME';
}

// Очередь ревью CameraSourceRaw (см. doc/TZ-parser-import-improvements.md, П1.1) — записи,
// которые парсер нашёл, но не смог однозначно геокодировать/сопоставить с адресом
// автоматически (нет текста адреса у источника, либо уверенность геокодинга ниже порога).
// Тот же UX-паттерн, что уже есть на /admin/camera-submissions (список слева, карточка справа).
// AI-подсказка (см. GrokCameraAssistService) и переключатель "внутри помещения" (см.
// doc/README.md, "Камери всередині приміщень") — по прямому запросу пользователя.
export default function ParserReviewPage() {
  const searchParams = useSearchParams();
  const initialProviderId = searchParams.get('providerId') ?? '';

  const [providerId, setProviderId] = useState(initialProviderId);
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<SourceRawSummary[]>([]);
  const [selected, setSelected] = useState<SourceRawDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  // Nominatim (OpenStreetMap) — бесплатный, без API-ключа (см. запрос пользователя), поэтому
  // запрашивается АВТОМАТИЧЕСКИ при открытии карточки (см. openDetail ниже), не по кнопке —
  // в отличие от aiSuggestion (Grok + Google Places, требует ключей/квоты, только по клику).
  const [osmSuggestion, setOsmSuggestion] = useState<OsmSuggestion | null>(null);
  const [osmLoading, setOsmLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [form, setForm] = useState({
    name: '',
    streamType: 'IFRAME',
    locationType: 'OUTDOOR' as 'OUTDOOR' | 'INDOOR',
    address: '',
    lat: '',
    lng: '',
    azimuth: '0',
    fovAngle: '80',
    rangeMeters: '200',
  });

  const load = async () => {
    const params = new URLSearchParams();
    if (showAll) params.set('status', 'all');
    if (providerId) params.set('providerId', providerId);
    const res = await fetch(`/api/admin/parser/source-raw?${params.toString()}`, { credentials: 'include' });
    setItems(await res.json());
  };

  useEffect(() => {
    load();
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, providerId]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/admin/parser/source-raw/${id}`, { credentials: 'include' });
    const data: SourceRawDetail = await res.json();
    setSelected(data);
    setAiSuggestion(null);
    setOsmSuggestion(null);
    setForm({
      name: data.rawTitle,
      streamType: inferStreamType(data.rawStreamUrl),
      locationType: 'OUTDOOR',
      address: data.rawLocationText ?? '',
      lat: data.guessedLat != null ? String(data.guessedLat) : '',
      lng: data.guessedLng != null ? String(data.guessedLng) : '',
      azimuth: '0',
      fovAngle: '80',
      rangeMeters: '200',
    });
    setRejectReason('');
    setError(null);

    // Уточняем адрес через Nominatim сразу при открытии страницы камеры (см. запрос
    // пользователя) — бесплатно и без ключа, поэтому не требует явного клика админа.
    setOsmLoading(true);
    fetch(`/api/admin/parser/source-raw/${id}/nominatim-suggest`, { method: 'POST', credentials: 'include' })
      .then((r) => r.json())
      .then(setOsmSuggestion)
      .catch(() => setOsmSuggestion(null))
      .finally(() => setOsmLoading(false));
  };

  const askAi = async () => {
    if (!selected) return;
    setAiBusy(true);
    try {
      const res = await fetch(`/api/admin/parser/source-raw/${selected.id}/ai-suggest`, { method: 'POST', credentials: 'include' });
      const data: AiSuggestion = await res.json();
      setAiSuggestion(data);
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
    setForm({
      ...form,
      address: aiSuggestion.suggestedAddress ?? form.address,
      locationType: aiSuggestion.isLikelyIndoor ? 'INDOOR' : form.locationType,
    });
  };

  // Две отдельные кнопки для координат (не одна с автоприоритетом) — AI-догадка по памяти
  // модели и реальный поиск через Google Places (см. GeocodingService.searchPlace) — это два
  // независимых источника, которые могут не совпадать; админ сам решает, какому верить, а не
  // получает тихо смешанный результат.
  const applyAiCoords = () => {
    if (!aiSuggestion?.suggestedLat || !aiSuggestion?.suggestedLng) return;
    setForm({ ...form, lat: String(aiSuggestion.suggestedLat), lng: String(aiSuggestion.suggestedLng) });
  };
  const applyPlacesCoords = () => {
    if (!aiSuggestion?.placesLat || !aiSuggestion?.placesLng) return;
    setForm({ ...form, lat: String(aiSuggestion.placesLat), lng: String(aiSuggestion.placesLng) });
  };

  const resolve = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name || undefined,
        streamType: form.streamType,
        locationType: form.locationType,
        azimuth: Number(form.azimuth),
        fovAngle: Number(form.fovAngle),
        rangeMeters: Number(form.rangeMeters),
      };
      // Либо координаты напрямую (если заполнены), либо адрес для геокодинга — не оба сразу,
      // чтобы не было двусмысленности, что именно использовать.
      if (form.lat && form.lng) {
        body.lat = Number(form.lat);
        body.lng = Number(form.lng);
      } else if (form.address) {
        body.address = form.address;
      } else {
        setError('Укажите адрес или координаты (широта/долгота).');
        setBusy(false);
        return;
      }

      const res = await fetch(`/api/admin/parser/source-raw/${selected.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setSelected(null);
      load();
    } catch (e: any) {
      setError(e.message || 'Не удалось создать камеру.');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/parser/source-raw/${selected.id}/reject`, {
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
        <h1 className="text-xl font-semibold">Очередь ревью (парсер не смог сопоставить автоматически)</h1>
        <div className="flex items-center gap-3 text-sm">
          {providerId && (
            <button onClick={() => setProviderId('')} className="text-gray-500 underline">
              Сбросить фильтр по источнику
            </button>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Показать все статусы
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Название</th>
              <th>Адрес источника</th>
              <th>Найдено</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-500">
                  Очередь пуста.
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="py-2">{it.rawTitle}</td>
                <td className="max-w-[160px] truncate">{it.rawLocationText ?? '—'}</td>
                <td>{new Date(it.scrapedAt).toLocaleDateString('ru-RU')}</td>
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
            <h2 className="font-medium">{selected.rawTitle}</h2>
            <p className="text-xs text-gray-500">
              Источник: {selected.provider.name} {selected.provider.city ? `(${selected.provider.city.name})` : ''}
            </p>
            <a href={selected.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline break-all">
              {selected.sourcePageUrl}
            </a>
            {selected.rawLocationText && <p className="text-gray-600">Адрес у источника: «{selected.rawLocationText}»</p>}
            {selected.geocodeConfidence != null && (
              <p className="text-gray-600">Уверенность геокодинга при импорте: {Math.round(selected.geocodeConfidence * 100)}%</p>
            )}

            {/* Nominatim (OpenStreetMap) — бесплатно, без ключа, загружается автоматически при
                открытии карточки (см. openDetail) — приоритетный, всегда доступный источник,
                показывается первым, до платных Grok/Google Places ниже. */}
            <div className="rounded bg-green-50 p-2 text-xs">
              <p className="font-medium text-green-800">🗺️ Nominatim (OpenStreetMap, бесплатно)</p>
              {osmLoading ? (
                <p className="text-gray-500">Уточняем адрес…</p>
              ) : osmSuggestion?.osmLat != null && osmSuggestion?.osmLng != null ? (
                <>
                  <p>
                    Координаты: <strong>{osmSuggestion.osmLat.toFixed(5)}, {osmSuggestion.osmLng.toFixed(5)}</strong> (уверенность {Math.round(osmSuggestion.osmConfidence * 100)}%)
                  </p>
                  {osmSuggestion.osmDisplayName && <p className="text-gray-600">{osmSuggestion.osmDisplayName}</p>}
                  <button onClick={applyOsmCoords} className="text-blue-600 underline">
                    Использовать
                  </button>
                </>
              ) : (
                <p className="text-gray-500">Ничего не найдено.</p>
              )}
            </div>

            <button onClick={askAi} disabled={aiBusy} className="text-xs text-purple-700 underline disabled:opacity-50">
              {aiBusy ? '🤖 Спрашиваем AI…' : '🤖 Спросить AI (адрес/тип камеры)'}
            </button>
            {aiSuggestion && (
              <div className="rounded bg-purple-50 p-2 text-xs">
                {!aiSuggestion.configured ? (
                  <p className="text-gray-500">AI-провайдер не настроен (нет XAI_API_KEY/GROK_API_KEY).</p>
                ) : (
                  <>
                    <p>
                      Адрес: <strong>{aiSuggestion.suggestedAddress ?? '—'}</strong> (уверенность {Math.round(aiSuggestion.addressConfidence * 100)}%)
                    </p>
                    <p>
                      Координаты (по памяти AI):{' '}
                      <strong>
                        {aiSuggestion.suggestedLat != null && aiSuggestion.suggestedLng != null
                          ? `${aiSuggestion.suggestedLat.toFixed(5)}, ${aiSuggestion.suggestedLng.toFixed(5)}`
                          : '—'}
                      </strong>
                      {aiSuggestion.suggestedLat != null && (
                        <>
                          {' '}
                          (уверенность {Math.round(aiSuggestion.coordinatesConfidence * 100)}%){' '}
                          <button onClick={applyAiCoords} className="text-blue-600 underline">
                            Использовать
                          </button>
                        </>
                      )}
                    </p>
                    <p>
                      Координаты (Google Places):{' '}
                      <strong>
                        {aiSuggestion.placesLat != null && aiSuggestion.placesLng != null
                          ? `${aiSuggestion.placesLat.toFixed(5)}, ${aiSuggestion.placesLng.toFixed(5)}`
                          : '—'}
                      </strong>
                      {aiSuggestion.placesLat != null && (
                        <>
                          {' '}
                          (найдено: {aiSuggestion.placesName ?? aiSuggestion.placesFormattedAddress ?? '—'}, уверенность {Math.round(aiSuggestion.placesConfidence * 100)}%){' '}
                          <button onClick={applyPlacesCoords} className="text-blue-600 underline">
                            Использовать
                          </button>
                        </>
                      )}
                    </p>
                    <p>Внутри помещения: {aiSuggestion.isLikelyIndoor ? 'да' : 'нет'}</p>
                    {aiSuggestion.reasoning && <p className="text-gray-500 mt-1">{aiSuggestion.reasoning}</p>}
                    <button onClick={applyAiSuggestion} className="mt-1 text-blue-600 underline">
                      Применить адрес/тип к форме
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <label className="col-span-2">
                Название камеры
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="col-span-2">
                Тип потока
                <select className="mt-1 w-full rounded border px-2 py-1" value={form.streamType} onChange={(e) => setForm({ ...form, streamType: e.target.value })}>
                  {STREAM_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2">
                Тип камеры
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.locationType}
                  onChange={(e) => setForm({ ...form, locationType: e.target.value as 'OUTDOOR' | 'INDOOR' })}
                >
                  <option value="OUTDOOR">Снаружи (улица/площадь/двор)</option>
                  <option value="INDOOR">Внутри помещения (интерьер)</option>
                </select>
              </label>
              <label className="col-span-2">
                Адрес (для геокодинга — используется, только если широта/долгота ниже пустые)
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label>
                Широта
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
              </label>
              <label>
                Долгота
                <input className="mt-1 w-full rounded border px-2 py-1" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
              </label>
              {form.locationType === 'OUTDOOR' && (
                <>
                  <label>
                    Азимут
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.azimuth} onChange={(e) => setForm({ ...form, azimuth: e.target.value })} />
                  </label>
                  <label>
                    FOV
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.fovAngle} onChange={(e) => setForm({ ...form, fovAngle: e.target.value })} />
                  </label>
                  <label>
                    Дальность (м)
                    <input className="mt-1 w-full rounded border px-2 py-1" value={form.rangeMeters} onChange={(e) => setForm({ ...form, rangeMeters: e.target.value })} />
                  </label>
                </>
              )}
            </div>
            {form.locationType === 'OUTDOOR' ? (
              <p className="text-xs text-gray-500">
                Точную геометрию сектора можно потом уточнить через обычный инструмент калибровки (/admin/cameras/:id/calibrate).
              </p>
            ) : (
              <p className="text-xs text-amber-700">Камера внутри помещения — азимут/FOV/дальность не применяются, не участвует в поиске по адресу.</p>
            )}

            {error && <p className="text-red-600">{error}</p>}

            <div className="flex flex-col gap-2 pt-2">
              <button className="rounded bg-green-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={resolve} disabled={busy}>
                Создать камеру
              </button>
              <input
                className="rounded border px-2 py-1"
                placeholder="Причина отказа (необязательно)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={reject} disabled={busy}>
                Отклонить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

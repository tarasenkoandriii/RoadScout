'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { canEmbedStream, canShowAsImage, toEmbeddableUrl } from '../../../../../lib/embeddable';

const SectorMap = dynamic(() => import('../../../../../components/SectorMap'), { ssr: false });

interface Camera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  confidence: string;
  streamUrl: string;
  streamType: string;
  locationType: 'OUTDOOR' | 'INDOOR';
}

interface AzimuthFovSuggestion {
  configured: boolean;
  imageAvailable: boolean;
  imageUrl: string | null;
  unavailableReason: string | null;
  suggestedAzimuth: number | null;
  suggestedFovAngle: number | null;
  suggestedRangeMeters: number | null;
  confidence: number;
  reasoning: string | null;
}

interface StreamAvailability {
  checked: boolean;
  available: boolean | null;
  checkedVia: 'oembed' | 'vision' | 'none';
  reason: string | null;
}

// Камери всередині приміщень (див. doc/README.md, "Камери всередині приміщень") — перший
// реальний приклад: камера Введенського храму показує інтер'єр, не вулицю. Для таких камер
// азимут/кут огляду/дальність не мають фізичного сенсу (немає "напрямку огляду вулиці") —
// повзунки нижче ховаються, коли обрано "Всередині приміщення".
export default function CalibrateCameraPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [camera, setCamera] = useState<Camera | null>(null);
  // Для MJPEG_SNAPSHOT-прев'ю (реальний випадок — NycTmcAdapter) — знімок статичний, а
  // реальна камера оновлює його що ~2 секунди (за спостереженнями, див.
  // doc/AUDIT-nyctmc-adapter.md); без cache-bust параметра браузер показав би один і той же
  // застарілий кадр весь час, поки відкрита сторінка калібрування.
  const [snapshotRefreshTick, setSnapshotRefreshTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSnapshotRefreshTick((t) => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AzimuthFovSuggestion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availability, setAvailability] = useState<StreamAvailability | null>(null);

  useEffect(() => {
    fetch(`/api/admin/cameras/${id}`)
      .then((r) => r.json())
      .then(setCamera);
  }, [id]);

  if (!camera) return <p className="p-6 text-sm text-gray-500">Загрузка…</p>;

  const update = (patch: Partial<Camera>) => setCamera({ ...camera, ...patch });
  const isIndoor = camera.locationType === 'INDOOR';

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/admin/cameras/${id}/calibrate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: camera.lat,
          lng: camera.lng,
          azimuth: camera.azimuth,
          fovAngle: camera.fovAngle,
          rangeMeters: camera.rangeMeters,
          locationType: camera.locationType,
          streamUrl: camera.streamUrl,
          streamType: camera.streamType,
        }),
      });
      router.push('/admin/cameras');
    } finally {
      setSaving(false);
    }
  };

  // Автокалибровка (см. doc/README.md, раздел про GrokCameraAssistService.suggestAzimuthFov) —
  // ЧЕСТНО: определение азимута по одному кадру трансляции — куда менее надёжная задача для
  // vision-модели, чем чтение текста; результат — подсказка для сверки с картой вручную, не
  // готовое значение для слепого применения.
  const askAiCalibrate = async () => {
    setAiBusy(true);
    try {
      const res = await fetch(`/api/admin/cameras/${id}/ai-calibrate-suggest`, { method: 'POST', credentials: 'include' });
      setAiSuggestion(await res.json());
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiCalibration = () => {
    if (!aiSuggestion) return;
    update({
      azimuth: aiSuggestion.suggestedAzimuth ?? camera.azimuth,
      fovAngle: aiSuggestion.suggestedFovAngle ?? camera.fovAngle,
      rangeMeters: aiSuggestion.suggestedRangeMeters ?? camera.rangeMeters,
    });
  };

  // Перевірка доступності відео за запитом (див. запит користувача: "недоступное видео") —
  // YouTube oEmbed + AI vision-резерв, див. GrokCameraAssistService.checkStreamAvailability.
  // Той самий механізм автоматично працює у фоні окремим cron-джобом (не тут, не в парсері) —
  // ця кнопка лише дає перевірити конкретну камеру негайно, не чекаючи наступного проходу.
  const checkAvailability = async () => {
    setAvailabilityBusy(true);
    try {
      const res = await fetch(`/api/admin/cameras/${id}/check-availability`, { method: 'POST', credentials: 'include' });
      setAvailability(await res.json());
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const deleteCamera = async () => {
    if (!confirm(`Удалить камеру «${camera.name}» безвозвратно?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/admin/cameras/${id}`, { method: 'DELETE', credentials: 'include' });
      router.push('/admin/cameras');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 grid grid-cols-3 gap-6">
      <div className="col-span-2">
        <h1 className="text-xl font-semibold mb-4">Калибровка: {camera.name}</h1>
        {isIndoor ? (
          <div className="flex h-[520px] w-full items-center justify-center rounded border bg-gray-50 text-sm text-gray-500">
            Камера внутри помещения — сектор обзора не строится (нет "направления обзора улицы").
            Можно оставить только координаты здания ниже.
          </div>
        ) : (
          <SectorMap
            center={{ lat: camera.lat, lng: camera.lng }}
            heightClassName="h-[520px] w-full rounded"
            cameras={[{ ...camera, draggable: true, status: 'UNKNOWN' }]}
            onCameraDrag={(_id, pos) => update({ lat: pos.lat, lng: pos.lng })}
          />
        )}
        <p className="text-xs text-gray-500 mt-2">
          {isIndoor
            ? 'Координаты — местоположение здания, не самой камеры внутри него.'
            : 'Перетащите маркер на реальное место установки камеры. Сектор ниже — область обзора, подгоните её под ориентиры, видимые в реальном кадре трансляции (см. превью ниже).'}
        </p>

        {/* Небольшой iframe-превью трансляции (см. запрос пользователя) — переиспользует уже
            существующий публичный ембед-виджет (/embed/[id]), не дублирует его логику
            определения IFRAME/YOUTUBE_LIVE/HLS/MJPEG_SNAPSHOT. */}
        {/* ВАЖНО (реальный найденный инцидент — см. doc/AUDIT-embed-bare-url-fix.md): раньше
            превью грузилось через <iframe src={`/embed/${camera.id}`}> — это отдельный
            запрос к серверу, отдающий СОХРАНЁННОЕ состояние камеры, а не то, что админ только
            что ввёл в поля выше. Итог: правишь streamUrl в форме, а превью продолжает
            показывать старую (битую) ссылку и ту же ошибку в консоли, пока не нажмёшь
            "Сохранить" — вводило в заблуждение, будто фикс не сработал. Теперь превью
            рендерится НАПРЯМУЮ из текущего состояния формы (canEmbedStream/looksEmbeddable —
            общая логика с /embed/[id], см. lib/embeddable.ts), без похода на сервер и без
            задержки в один клик "Сохранить". */}
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-600 mb-1">Превью трансляции (для сверки с сектором выше — отражает текущие несохранённые значения полей):</p>
          {canEmbedStream(camera.streamType, camera.streamUrl) ? (
            <iframe src={toEmbeddableUrl(camera.streamUrl)} className="h-56 w-full rounded border" title="Превью трансляции" allowFullScreen />
          ) : canShowAsImage(camera.streamType, camera.streamUrl) ? (
            // ИСПРАВЛЕНО (за прямым запросом пользователя — "та же проблема с показом видео в
            // админке"): раньше здесь был ПРЯМОЙ camera.streamUrl — браузер шёл к камере сам,
            // минуя любой VPN/прокси. Для гео-заблокированных камер (например, NYC DOT —
            // отдают снимок только на US-IP) это всегда проваливалось (см. скриншот с 31
            // failed-запросом в Network). Теперь идём через свой же
            // GET /api/admin/cameras/image-proxy (CamerasController.imageProxy() /
            // CamerasService.fetchStreamImageProxy()) — тот же VPN/прокси-паттерн
            // (RegistryProxyService), что уже решил эту проблему для BTW
            // (BtwService.fetchThumbImage()). url передаётся параметром (а не берётся из БД по
            // id камеры) — превью тут отражает ТЕКУЩИЕ НЕСОХРАНЁННЫЕ значения полей формы, см.
            // подпись выше.
            <img
              src={`/api/admin/cameras/image-proxy?url=${encodeURIComponent(camera.streamUrl)}&streamType=${encodeURIComponent(camera.streamType)}&_t=${snapshotRefreshTick}`}
              alt="Превью трансляции"
              className="h-56 w-full rounded border object-cover bg-gray-50"
            />
          ) : (
            <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded border bg-gray-50 text-center text-xs text-gray-500">
              <p>
                {camera.streamType === 'IFRAME' || camera.streamType === 'YOUTUBE_LIVE'
                  ? 'Ссылка на поток выглядит неполной (голый адрес сайта, не конкретное видео/поток) — превью недоступно.'
                  : `Тип потока "${camera.streamType}" нельзя показать напрямую в превью — откройте трансляцию по ссылке ниже.`}
              </p>
            </div>
          )}
        </div>

        <a href={camera.streamUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline mt-2 inline-block">
          Открыть трансляцию в новой вкладке
        </a>
      </div>

      <div className="space-y-5">
        <div>
          <label className="text-sm font-medium block mb-1">Тип камеры</label>
          <select
            className="w-full rounded border px-2 py-2 text-sm"
            value={camera.locationType}
            onChange={(e) => update({ locationType: e.target.value as 'OUTDOOR' | 'INDOOR' })}
          >
            <option value="OUTDOOR">Снаружи (улица/площадь/двор)</option>
            <option value="INDOOR">Внутри помещения (интерьер)</option>
          </select>
          {isIndoor && (
            <p className="mt-1 text-xs text-amber-700">
              Такая камера не участвует в поиске по адресу (по сектору обзора), но видна как "рядом" при поиске поблизости.
            </p>
          )}
        </div>

        {/* Реальный найденный инцидент (см. doc/AUDIT-embed-bare-url-fix.md) — камера могла
            получить неверный streamType при ручном резолве в очереди ревью (форма подсказывала
            "IFRAME" по умолчанию, даже когда ссылка была на YouTube). Раньше это можно было
            исправить только напрямую в БД — теперь редактируется прямо здесь. */}
        <div>
          <label className="text-sm font-medium block mb-1">Ссылка на поток</label>
          <input
            className="w-full rounded border px-2 py-2 text-sm"
            value={camera.streamUrl}
            onChange={(e) => update({ streamUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Тип потока</label>
          <select
            className="w-full rounded border px-2 py-2 text-sm"
            value={camera.streamType}
            onChange={(e) => update({ streamType: e.target.value })}
          >
            <option value="IFRAME">IFRAME</option>
            <option value="YOUTUBE_LIVE">YOUTUBE_LIVE</option>
            <option value="HLS">HLS</option>
            <option value="MJPEG_SNAPSHOT">MJPEG_SNAPSHOT</option>
          </select>
        </div>

        {!isIndoor && (
          <>
            <div>
              <button onClick={askAiCalibrate} disabled={aiBusy} className="text-xs text-purple-700 underline disabled:opacity-50">
                {aiBusy ? '🤖 Анализируем кадр…' : '🤖 Автокалибровка (ИИ): азимут/FOV по кадру'}
              </button>
              {aiSuggestion && (
                <div className="mt-2 rounded bg-purple-50 p-2 text-xs">
                  {!aiSuggestion.imageAvailable ? (
                    <p className="text-gray-500">Кадр для анализа недоступен: {aiSuggestion.unavailableReason}</p>
                  ) : !aiSuggestion.configured ? (
                    <p className="text-gray-500">AI-провайдер не настроен (нет XAI_API_KEY/GROK_API_KEY).</p>
                  ) : aiSuggestion.suggestedAzimuth == null && aiSuggestion.suggestedFovAngle == null ? (
                    <p className="text-gray-500">
                      Модель не смогла уверенно определить азимут/FOV по кадру.
                      {aiSuggestion.reasoning && <span> {aiSuggestion.reasoning}</span>}
                    </p>
                  ) : (
                    <>
                      <p>
                        Азимут: <strong>{aiSuggestion.suggestedAzimuth != null ? `${Math.round(aiSuggestion.suggestedAzimuth)}°` : '—'}</strong>, FOV:{' '}
                        <strong>{aiSuggestion.suggestedFovAngle != null ? `${Math.round(aiSuggestion.suggestedFovAngle)}°` : '—'}</strong>, дальность:{' '}
                        <strong>{aiSuggestion.suggestedRangeMeters != null ? `${Math.round(aiSuggestion.suggestedRangeMeters)}м` : '—'}</strong>{' '}
                        (уверенность {Math.round(aiSuggestion.confidence * 100)}%)
                      </p>
                      {aiSuggestion.reasoning && <p className="text-gray-500 mt-1">{aiSuggestion.reasoning}</p>}
                      <p className="mt-1 text-amber-700">
                        Это приблизительная оценка по одному кадру — обязательно сверьте с сектором на карте и реальной трансляцией выше.
                      </p>
                      <button onClick={applyAiCalibration} className="mt-1 text-blue-600 underline">
                        Применить
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Азимут (направление взгляда): {camera.azimuth}°</label>
              <input
                type="range"
                min={0}
                max={360}
                value={camera.azimuth}
                onChange={(e) => update({ azimuth: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Угол обзора (FOV): {camera.fovAngle}°</label>
              <input
                type="range"
                min={10}
                max={180}
                value={camera.fovAngle}
                onChange={(e) => update({ fovAngle: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Дальность обзора: {camera.rangeMeters} м</label>
              <input
                type="range"
                min={20}
                max={1000}
                step={10}
                value={camera.rangeMeters}
                onChange={(e) => update({ rangeMeters: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          </>
        )}

        <div className="text-xs text-gray-500">
          lat: {camera.lat.toFixed(6)}, lng: {camera.lng.toFixed(6)}
        </div>

        <button
          className="w-full px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Сохраняем…' : 'Сохранить и пометить VERIFIED'}
        </button>

        {/* Проверка доступности + удаление камеры (см. запит користувача: "недоступное видео —
            добавить кнопку удалить камеру, по возможности автоматически дизейблить такие
            камеры"). Тот же механизм проверки работает автоматически в фоне отдельным cron'ом
            (см. doc/AUDIT-camera-content-availability.md) — эта кнопка просто даёт проверить
            прямо сейчас, не дожидаясь следующего прохода. */}
        <div className="border-t pt-4 space-y-2">
          <button
            onClick={checkAvailability}
            disabled={availabilityBusy}
            className="w-full rounded border border-purple-300 px-3 py-1.5 text-xs text-purple-700 disabled:opacity-50"
          >
            {availabilityBusy ? '🤖 Проверяем доступность…' : '🤖 Проверить доступность видео (ИИ)'}
          </button>
          {availability && (
            <div className="rounded bg-gray-50 p-2 text-xs">
              {!availability.checked ? (
                <p className="text-gray-500">Не удалось проверить: {availability.reason ?? 'неизвестная причина'}.</p>
              ) : availability.available ? (
                <p className="text-green-700">Видео доступно (проверено через {availability.checkedVia === 'oembed' ? 'YouTube oEmbed' : 'AI vision'}).</p>
              ) : (
                <p className="text-red-700">
                  Видео недоступно (проверено через {availability.checkedVia === 'oembed' ? 'YouTube oEmbed' : 'AI vision'}): {availability.reason}
                </p>
              )}
            </div>
          )}

          <button
            onClick={deleteCamera}
            disabled={deleting}
            className="w-full rounded bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {deleting ? 'Удаляем…' : 'Удалить камеру безвозвратно'}
          </button>
        </div>
      </div>
    </div>
  );
}

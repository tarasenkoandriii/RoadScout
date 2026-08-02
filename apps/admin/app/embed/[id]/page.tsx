'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { canEmbedStream, canShowAsImage, looksEmbeddable, toEmbeddableUrl } from '../../../lib/embeddable';

interface EmbedInfo {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  status: string;
}

// Ембед-віджет для сторонніх сайтів/блогерів (див. doc/README.md, "Ембед-віджет") — навмисно
// без AuthGate: сторінка вбудовується в чужий сайт через <iframe>, у відвідувача цього сайту
// немає (і не повинно бути) власного логіна в RoadScout. Дані — з публічного
// GET /api/cameras/:id/embed-info (теж без авторизації).
//
// Відомий compromise: реально відтворити тут можна IFRAME/YOUTUBE_LIVE (вони й так по своїй
// природі влаштовані для показу в чужому <iframe>) і MJPEG_SNAPSHOT (простий <img>, знімок
// оновлюється кожні кілька секунд — реальний приклад: NycTmcAdapter, див.
// doc/AUDIT-nyctmc-adapter.md). Лише HLS дійсно вимагає окремого плеєра (hls.js тощо),
// якого тут немає — для нього показуємо назву камери + пряме посилання замість спроби
// відтворити відео.
export default function EmbedPage() {
  const params = useParams<{ id: string }>();
  const [camera, setCamera] = useState<EmbedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshotRefreshTick, setSnapshotRefreshTick] = useState(0);

  useEffect(() => {
    fetch(`/api/cameras/${params.id}/embed-info`)
      .then((r) => {
        if (!r.ok) throw new Error('not-found');
        return r.json();
      })
      .then(setCamera)
      .catch(() => setError('Камеру не знайдено.'));
  }, [params.id]);

  useEffect(() => {
    const interval = setInterval(() => setSnapshotRefreshTick((t) => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">{error}</div>
    );
  }

  if (!camera) {
    return <div className="flex h-screen items-center justify-center text-sm text-gray-500">Завантаження…</div>;
  }

  const streamTypeCanEmbed = camera.streamType === 'IFRAME' || camera.streamType === 'YOUTUBE_LIVE';
  const urlEmbeddable = looksEmbeddable(camera.streamUrl);
  const canEmbedDirectly = streamTypeCanEmbed && urlEmbeddable;
  const canShowImage = canShowAsImage(camera.streamType, camera.streamUrl);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex-1">
        {canEmbedDirectly ? (
          <iframe src={toEmbeddableUrl(camera.streamUrl)} className="h-full w-full border-0" allowFullScreen title={camera.name} />
        ) : canShowImage ? (
          <img
            src={`${camera.streamUrl}${camera.streamUrl.includes('?') ? '&' : '?'}_t=${snapshotRefreshTick}`}
            alt={camera.name}
            className="h-full w-full object-cover bg-gray-50"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-50 text-center">
            <p className="font-medium">{camera.name}</p>
            <p className="text-xs text-gray-500">
              {streamTypeCanEmbed && !urlEmbeddable
                ? 'Ссылка на поток выглядит неполной — обратитесь к администратору реестра.'
                : `Цей потік не можна вбудувати напряму (тип ${camera.streamType}) — відкрийте трансляцію напряму.`}
            </p>
            <a href={camera.streamUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
              Відкрити трансляцію
            </a>
          </div>
        )}
      </div>
      <a
        href={`https://roadscout.example/?embed_camera=${camera.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="border-t bg-white px-2 py-1 text-center text-[10px] text-gray-400 hover:text-gray-600"
      >
        {camera.name} · RoadScout
      </a>
    </div>
  );
}

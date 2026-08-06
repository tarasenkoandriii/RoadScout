'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import WindyWidget, { type WindyOverlay } from './WindyWidget';
import type { FiveElevenNyEvent } from './NyTrafficMap';

const NyTrafficMap = dynamic(() => import('./NyTrafficMap'), { ssr: false });

// За прямим запитом користувача — "пишем парсер 511ny.org - карту штата нью йорк отображаем на
// вкладку /admin/situational и показываем инциденты и windy погоду с селектором слоев слева
// вертикально - в рамках пункта 2 тз" (doc/TZ-btw-route-planning.md, §7.2/§8, Этап 2).
//
// Один "слот" карти, що перемикається вертикальним списком зліва — не окрема карта на кожен
// шар: 511NY-інциденти й Windy-погода НЕ можуть бути одночасно намальовані як два прозорих шари
// однієї карти (Windy — це вбудований iframe із власною картою всередині, не растровий
// tile-layer, який можна додати поверх Leaflet-карти) — тому перемикання, а не накладання, той
// самий компроміс, що вже неявно існував у WindyWidget (там перемикач шарів горизонтальний,
// над картою; тут — за прямим запитом користувача, вертикальний, зліва).
type LayerKey = 'incidents' | WindyOverlay;

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'incidents', label: '🚧 Инциденты 511NY' },
  { key: 'rain', label: '🌧 Дождь' },
  { key: 'wind', label: '💨 Ветер' },
  { key: 'clouds', label: '☁️ Облачность' },
  { key: 'temp', label: '🌡 Температура' },
  { key: 'radar', label: '📡 Радар осадков' },
];

// Географічний центр штату Нью-Йорк (не тільки NYC) — користувач попросив саме "карту штата",
// а 511NY покриває весь штат, не лише сам Нью-Йорк-Сіті (§7.2 ТЗ: "511NY ... покрывает NYC и
// весь штат"). zoom=7 — весь штат влазить в один екран без прокрутки.
const NY_STATE_CENTER = { lat: 42.9, lng: -75.5 };

export default function NySituationalPanel() {
  const [layer, setLayer] = useState<LayerKey>('incidents');
  const [events, setEvents] = useState<FiveElevenNyEvent[]>([]);
  const [configured, setConfigured] = useState(true); // оптимістичний дефолт, щоб не блимати попередженням до першої відповіді
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/situational/511ny', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setConfigured(Boolean(data.configured));
    } catch {
      setError('Не удалось загрузить события 511NY.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">Нью-Йорк (511NY + Windy)</h2>
        <button className="text-sm text-blue-600 underline" onClick={load}>
          Обновить
        </button>
      </div>

      {/* За прямим запитом користувача — "не могу сделать выводы" (той самий принцип чесних
          UI-повідомлень, що вже logNote() в BTW): якщо ключ 511NY не налаштований, порожня
          карта повинна пояснювати ЧОМУ, а не мовчати. */}
      {!loading && !configured && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Ключ 511NY не настроен (переменная окружения <code>FIVE11NY_API_KEY</code> на сервере пуста) — слой
          «Инциденты 511NY» будет пуст. Получить бесплатный ключ:{' '}
          <a href="https://511ny.org/developers/help" target="_blank" rel="noreferrer" className="underline">
            511ny.org/developers/help
          </a>
          .
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        {/* Вертикальний селектор шарів зліва — за прямим запитом користувача. */}
        <div className="flex w-48 shrink-0 flex-col gap-1">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLayer(l.key)}
              className={`rounded px-3 py-2 text-left text-sm ${
                layer === l.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {l.label}
            </button>
          ))}
          {layer === 'incidents' && (
            <p className="mt-1 px-1 text-xs text-gray-500">
              {loading ? 'Загрузка…' : `Событий: ${events.length}`}
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {layer === 'incidents' ? (
            <NyTrafficMap center={NY_STATE_CENTER} events={events} heightClassName="h-[32rem] w-full rounded" zoom={7} />
          ) : (
            <WindyWidget
              lat={NY_STATE_CENTER.lat}
              lng={NY_STATE_CENTER.lng}
              zoom={6}
              defaultOverlay={layer}
              showOverlayPicker={false}
              heightClassName="h-[32rem] w-full rounded border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

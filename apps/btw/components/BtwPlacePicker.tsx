'use client';

import { useEffect, useState } from 'react';
import { listSavedPlaces, addSavedPlace, removeSavedPlace } from '../lib/btwSavedPlaces';
import type { SavedPlace } from '../lib/btwSavedPlaces';

// За прямим запитом користувача — «сверстать главное окно мини апп в стиле скрина - в рамках
// тз» (doc/TZ-btw-route-planning.md §2.1 шаги 2-3 — вибір точки А/Б: «текущее местоположение»
// / збережене місце / ввід вручну). Той самий bottom-sheet використовується і для точки А, і
// для точки Б (проп `title` розрізняє) — не два окремих компоненти.
//
// ОНОВЛЕНО — за прямим запитом користувача "добавить модель и её сохранение/удаление на
// сервере": `listSavedPlaces`/`addSavedPlace`/`removeSavedPlace` тепер асинхронні (реальні
// запити на `/api/saved-places`, § детальний розбір у lib/btwSavedPlaces.ts) — раніше це був
// синхронний localStorage.
//
// ⚠️ ЧЕСНО: реального пошуку адреси (геокодинг вільного тексту "вулиця, будинок" -> координати)
// ТУТ НЕМАЄ — у проєкті вже є `GeocodingService` (apps/api/src/geocoding — Google/Nominatim),
// але він зараз обслуговує лише адмінку (додавання камер), публічного BTW-ендпоінту для
// геокодингу адреси користувача ще не існує (окрема, не запитана в цьому кроці задача). Тому
// "ввід вручну" тут — саме координати (lat/lng), не текстова адреса; це свідомо чесний
// компроміс, а не спроба видати щось за роботу пошуку адрес.

export interface PickedPlace {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  title: string;
  currentLocation: { lat: number; lng: number } | null;
  onSelect: (place: PickedPlace) => void;
  onClose: () => void;
}

export default function BtwPlacePicker({ title, currentLocation, onSelect, onClose }: Props) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLabel, setManualLabel] = useState('');
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [manualSave, setManualSave] = useState(true);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listSavedPlaces();
      if (!cancelled) {
        setPlaces(list);
        setPlacesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRemove(id: string) {
    // Оптимістично прибираємо з UI одразу — видалення рідко провалюється, а чекати round-trip
    // заради простого "×" відчувалось би повільно; якщо запит на сервер таки не вдався,
    // повертаємо елемент назад, а не залишаємо UI неправдивим.
    //
    // ВИПРАВЛЕНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — раніше тут читався
    // `places` напряму із замикання (`const prev = places; setPlaces(places.filter(...))`).
    // При швидких послідовних видаленнях (тап на "×" кількох місць поспіль, до завершення
    // попереднього await) КОЖЕН виклик `handleRemove` замикав СТАРИЙ `places` на момент
    // рендеру кліку — другий виклик фільтрував масив, що ще містив уже "оптимістично" видалений
    // перший елемент, і після свого `await` мовчки повертав його назад у UI (а на випадок
    // помилки — `setPlaces(prev)` перезаписував би стан застарілим знімком, що включав уже
    // видалені елементи). Функціональна форма `setPlaces(current => ...)` читає АКТУАЛЬНИЙ стан
    // у момент виконання, не застарілий знімок — конкурентні видалення більше не топчуть одне
    // одного.
    let removedPlace: SavedPlace | undefined;
    setPlaces((current) => {
      removedPlace = current.find((p) => p.id === id);
      return current.filter((p) => p.id !== id);
    });
    const ok = await removeSavedPlace(id);
    if (!ok && removedPlace) {
      const restored = removedPlace;
      setPlaces((current) => (current.some((p) => p.id === id) ? current : [...current, restored]));
    }
  }

  async function handleManualConfirm() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setManualError('Введите корректные широту (-90..90) и долготу (-180..180).');
      return;
    }
    const label = manualLabel.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    if (manualSave) {
      setManualBusy(true);
      const saved = await addSavedPlace(label, lat, lng);
      setManualBusy(false);
      if (!saved) {
        setManualError('Не удалось сохранить место на сервере — можно продолжить без сохранения (кнопка ещё раз, сняв галочку).');
        return;
      }
    }
    onSelect({ label, lat, lng });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-zinc-900 p-4 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-white/10 px-3 py-1 text-sm text-gray-300">
            Закрыть
          </button>
        </div>

        <div className="space-y-1">
          {currentLocation ? (
            <button
              onClick={() => onSelect({ label: 'Текущее местоположение', lat: currentLocation.lat, lng: currentLocation.lng })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-white/5"
            >
              <span className="text-lg">📍</span>
              <span className="text-sm">Текущее местоположение</span>
            </button>
          ) : (
            <p className="px-3 py-2 text-xs text-gray-500">Текущее местоположение недоступно (геолокация не определена).</p>
          )}

          {placesLoading && <p className="px-3 py-2 text-xs text-gray-500">Загрузка сохранённых мест…</p>}
          {!placesLoading && places.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-500">Нет сохранённых мест — добавьте через «Указать вручную» ниже.</p>
          )}
          {places.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5">
              <button onClick={() => onSelect({ label: p.label, lat: p.lat, lng: p.lng })} className="flex flex-1 items-center gap-3 text-left">
                <span className="text-lg text-yellow-400">★</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.label}</span>
                  <span className="block text-[11px] text-gray-500">
                    {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                  </span>
                </span>
              </button>
              <button onClick={() => handleRemove(p.id)} className="shrink-0 px-2 text-gray-500 hover:text-red-400">
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <button onClick={() => setManualOpen((v) => !v)} className="text-sm text-gray-300 underline">
            {manualOpen ? 'Скрыть' : 'Указать координаты вручную'}
          </button>

          {manualOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-gray-500">
                Поиск адреса по названию пока не подключён (нужна отдельная интеграция геокодинга) — введите координаты напрямую.
              </p>
              <input
                value={manualLabel}
                onChange={(e) => setManualLabel(e.target.value)}
                placeholder="Название (например «Дом»)"
                className="w-full rounded border border-white/20 bg-black/40 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="Широта"
                  inputMode="decimal"
                  className="w-1/2 rounded border border-white/20 bg-black/40 px-3 py-2 text-sm"
                />
                <input
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  placeholder="Долгота"
                  inputMode="decimal"
                  className="w-1/2 rounded border border-white/20 bg-black/40 px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input type="checkbox" checked={manualSave} onChange={(e) => setManualSave(e.target.checked)} />
                Сохранить в избранное
              </label>
              {manualError && <p className="text-xs text-red-400">{manualError}</p>}
              <button
                onClick={handleManualConfirm}
                disabled={manualBusy}
                className="w-full rounded-lg bg-yellow-400 px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {manualBusy ? 'Сохраняем…' : 'Использовать'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

// За прямим запитом користувача — "сделай новую вкладку в админке для запуска скрипта...
// npx ts-node scripts/generate-btw-tiles.ts kyiv... по городам (список селекто городов)".
// Ця вкладка — веб-обгортка над тим самим генератором (apps/api/src/btw/
// tile-generation.util.ts::generateTilesForCity(), спільна логіка з CLI-скриптом
// apps/api/scripts/generate-btw-tiles.ts — жодного дублювання Overpass/кодування тайлів).
//
// ⚠️ ЧЕСНО: адмінська кнопка нижче виконує запит СИНХРОННО (той самий патерн, що вже
// "Запустить все источники" на /admin/parser — await fetch(...), кнопка блокується до
// завершення) — і може займати до ~1-2 хвилин (два Overpass-запити, нехай і паралельно,
// §4.7.1 ТЗ). Для дуже великих/щільних міст це може впертися в ліміт serverless-функції
// (Vercel Hobby — 300с, doc/AUDIT-vercel-hobby.md) — сервер у такому разі поверне зрозумілу
// помилку з підказкою запустити CLI-скрипт локально (там такого обмеження немає).

interface CityOption {
  cityId: string;
  name: string;
  slug: string;
  cameraCount: number;
}

interface ManifestLayerInfo {
  url: string;
  version: number;
}

interface Manifest {
  city: string;
  declination: number;
  scanMode: 'server-fallback-only' | 'local-worker';
  layers: { buildings: ManifestLayerInfo; cameras: ManifestLayerInfo; streets: ManifestLayerInfo } | null;
}

interface GenerateResult {
  citySlug: string;
  cityDir: string;
  bbox: { south: number; west: number; north: number; east: number };
  cameraCount: number;
  buildingCount: number;
  buildingBytes: number;
  streetCount: number;
}

export default function BtwTilesPage() {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingCities(true);
      try {
        // Той самий ендпоінт, що вже "BTW: подмена координат" використовує для вибору міста
        // (тепер розширений полем `slug`, див. BtwService.listCitiesWithCameraDensity()) —
        // жодного нового бекенд-виклику для самого списку не знадобилось.
        const res = await fetch('/api/btw/admin/dev-cities', { credentials: 'include' });
        if (res.ok) setCities(await res.json());
      } catch {
        setError('Не удалось загрузить список городов');
      } finally {
        setLoadingCities(false);
      }
    })();
  }, []);

  async function loadManifest(slug: string) {
    setManifestLoading(true);
    setManifest(null);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/btw/manifest?city=${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (res.ok) setManifest(await res.json());
    } catch {
      setError('Не удалось проверить текущий статус тайлов');
    } finally {
      setManifestLoading(false);
    }
  }

  function handleSelectCity(slug: string) {
    setSelectedSlug(slug);
    if (slug) loadManifest(slug);
  }

  async function handleGenerate() {
    if (!selectedSlug) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/btw/admin/generate-tiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ city: selectedSlug }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? 'Не удалось сгенерировать тайлы');
        return;
      }
      setResult(body);
      await loadManifest(selectedSlug); // обновить статус — теперь должен показать local-worker
    } catch {
      setError('Ошибка сети при генерации тайлов');
    } finally {
      setGenerating(false);
    }
  }

  const selectedCity = cities.find((c) => c.slug === selectedSlug);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">BTW: тайлы радара (локальное сканирование)</h1>
      <p className="mb-4 text-sm text-gray-600">
        Генерирует три файла тайлов (здания/камеры/улицы, §4.7.1 ТЗ) для выбранного города — то же самое, что{' '}
        <code>npx ts-node scripts/generate-btw-tiles.ts &lt;slug&gt;</code>, но одной кнопкой. После генерации BTW mini-app
        начинает сканировать локально в Web Worker, без запросов на сервер при каждом тике.
      </p>

      {error && <div className="mb-4 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-6 rounded border p-4">
        <h2 className="mb-2 font-medium">Выбор города</h2>
        <select
          className="w-full rounded border px-2 py-1 text-sm mb-3"
          value={selectedSlug}
          onChange={(e) => handleSelectCity(e.target.value)}
          disabled={loadingCities || generating}
        >
          <option value="">{loadingCities ? 'Загрузка…' : cities.length === 0 ? 'Нет городов с камерами' : 'Выбрать город…'}</option>
          {cities.map((c) => (
            <option key={c.cityId} value={c.slug}>
              {c.name} ({c.cameraCount} {c.cameraCount === 1 ? 'камера' : 'камер'}) — slug: {c.slug || '(?)'}
            </option>
          ))}
        </select>

        {selectedCity && !selectedCity.slug && (
          <div className="mb-3 rounded bg-yellow-50 border border-yellow-200 px-3 py-2 text-xs text-yellow-800">
            У этого города не задан <code>slug</code> в базе — генерация не сработает, пока не заполните это поле в
            /admin/cameras (или напрямую в БД).
          </div>
        )}

        {manifestLoading && <p className="mb-3 text-xs text-gray-500">Проверяем текущий статус тайлов…</p>}

        {manifest && (
          <div className="mb-3 rounded bg-gray-50 border px-3 py-2 text-xs text-gray-700">
            {manifest.layers ? (
              <>
                <div className="mb-1 font-medium text-green-700">🟢 Тайлы уже есть — scanMode: local-worker</div>
                <div>Здания: сгенерированы {new Date(manifest.layers.buildings.version).toLocaleString('ru-RU')}</div>
                <div>Камеры: сгенерированы {new Date(manifest.layers.cameras.version).toLocaleString('ru-RU')}</div>
                <div>Улицы: сгенерированы {new Date(manifest.layers.streets.version).toLocaleString('ru-RU')}</div>
              </>
            ) : (
              <div className="text-gray-500">⚪ Тайлов пока нет — BTW mini-app использует серверный /api/scan (без изменений)</div>
            )}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!selectedSlug || !selectedCity?.slug || generating}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {generating ? 'Генерация… (до 1-2 минут, не закрывайте вкладку)' : 'Сгенерировать тайлы'}
        </button>

        <p className="mt-2 text-xs text-gray-500">
          Для очень больших/плотных городов запрос может не уложиться в лимит serverless-функции (Vercel Hobby — 300с) — в
          этом случае сервер вернёт понятную ошибку с подсказкой запустить тот же скрипт локально:{' '}
          <code>npx ts-node scripts/generate-btw-tiles.ts {selectedSlug || '<slug>'}</code>.
        </p>
      </div>

      {result && (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <h2 className="mb-2 font-medium">Готово</h2>
          <div>Здания: {result.buildingCount} ({(result.buildingBytes / 1024).toFixed(1)} КБ)</div>
          <div>Камеры: {result.cameraCount}</div>
          <div>Улицы (сегменты): {result.streetCount}</div>
          <div className="mt-1 text-xs text-green-700">
            Записано в {result.cityDir}. GET /btw/manifest?city={result.citySlug} теперь вернёт scanMode: &quot;local-worker&quot;.
          </div>
        </div>
      )}
    </div>
  );
}

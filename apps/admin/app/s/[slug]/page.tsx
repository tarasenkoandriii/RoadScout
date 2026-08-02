'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

// "Поділитися локацією" (див. doc/README.md) — публічна сторінка (без AuthGate): резолвить
// короткий slug через публічний GET /api/share/:slug (теж без авторизації, див.
// ShareController.resolve()) і одразу редиректить на звичайну головну сторінку з готовими
// координатами — там вже спрацює AuthGate як завжди для того, хто перейшов за посиланням.
export default function SharedLocationPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share/${params.slug}`)
      .then((r) => {
        if (!r.ok) throw new Error('not-found');
        return r.json();
      })
      .then((data) => {
        const search = new URLSearchParams({ lat: String(data.lat), lng: String(data.lng) });
        if (data.address) search.set('address', data.address);
        router.replace(`/?${search.toString()}`);
      })
      .catch(() => setError('Посилання не знайдено або застаріло.'));
  }, [params.slug, router]);

  return (
    <main className="max-w-sm mx-auto p-10 text-center">
      <p className="text-sm text-gray-500">{error ?? 'Відкриваємо локацію…'}</p>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';

interface SessionUser {
  telegramId: string;
  firstName: string;
  username?: string;
  photoUrl?: string;
  isAdmin: boolean;
  isBlogger: boolean;
}

// Заглушка "рабочего места блогера" — само рабочее место (роль, гейт, авто-вход в dev-режиме)
// уже полноценно работает, инструменты конкретно для блогеров пока не спроектированы (см.
// README/AUDIT — это отдельная задача на будущее).
export default function BloggerPage() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  return (
    <div className="max-w-xl mx-auto p-8 space-y-4">
      <h1 className="text-xl font-semibold">Кабинет блогера</h1>
      <p className="text-sm text-gray-500">
        Вы вошли как {user?.firstName ?? '…'}
        {user?.username ? ` (@${user.username})` : ''}.
      </p>
      <p className="text-sm text-gray-500">
        Инструменты для блогеров (шаблоны постов, подборки камер, промо-материалы и т.п.) пока не
        реализованы — это заглушка, подтверждающая, что рабочее место и права доступа настроены
        правильно.
      </p>
    </div>
  );
}

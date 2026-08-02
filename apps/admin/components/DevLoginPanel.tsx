'use client';

import { useEffect, useState } from 'react';

interface DevAccount {
  role: 'admin' | 'blogger' | 'client';
  displayName: string;
}

interface Props {
  // If provided, called after a successful dev-login instead of doing a full page reload —
  // used inside AuthGate so it can just re-fetch /auth/me and re-render in place.
  onLoggedIn?: () => void | Promise<void>;
}

const ROLE_LABEL: Record<DevAccount['role'], string> = {
  admin: 'Админ',
  blogger: 'Блогер',
  client: 'Клиент',
};

// Локальная отладка: авто-вход во все "рабочие места" (admin/blogger/client) без реального
// Telegram Login Widget. Полностью скрыта (рендерит null), если бэкенд не сообщил
// `enabled: true` через GET /auth/dev-accounts — то есть DEV_AUTO_LOGIN != "true" там.
// НИКОГДА не включайте DEV_AUTO_LOGIN в проде — см. docker-compose.yml / .env.example.
export default function DevLoginPanel({ onLoggedIn }: Props) {
  const [accounts, setAccounts] = useState<DevAccount[] | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/dev-accounts', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { enabled: false, accounts: [] }))
      .then((data) => {
        if (!cancelled) setAccounts(data.enabled ? data.accounts : []);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!accounts || accounts.length === 0) return null;

  const login = async (role: string) => {
    setError(null);
    setPendingRole(role);
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        setError('Не удалось войти (см. DEV_MOCK_ACCOUNTS на бэкенде).');
        return;
      }
      if (onLoggedIn) {
        await onLoggedIn();
      } else {
        window.location.reload();
      }
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <div className="fixed bottom-3 right-3 z-[9999] w-56 rounded-lg border border-dashed border-amber-500 bg-amber-50 p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-amber-700">🛠 Dev: авто-вход</p>
      <div className="flex flex-col gap-1.5">
        {accounts.map((acc) => (
          <button
            key={acc.role}
            type="button"
            onClick={() => login(acc.role)}
            disabled={pendingRole === acc.role}
            className="rounded bg-amber-600 px-2 py-1 text-left text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {pendingRole === acc.role ? 'Вхожу…' : `${ROLE_LABEL[acc.role] ?? acc.role} — ${acc.displayName}`}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  );
}

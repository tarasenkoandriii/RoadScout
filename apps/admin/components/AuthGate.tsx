'use client';

import { useCallback, useEffect, useState } from 'react';
import TelegramLoginButton, { TelegramWidgetUser } from './TelegramLoginButton';
import { useI18n } from './I18nProvider';

interface SessionUser {
  telegramId: string;
  firstName: string;
  username?: string;
  photoUrl?: string;
  isAdmin: boolean;
  isBlogger: boolean;
}

interface Props {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireBlogger?: boolean;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';

// Gates a page behind Telegram login. This is a UX convenience, not the real security
// boundary — the actual data lives behind API endpoints protected by TelegramAuthGuard/
// AdminGuard/BloggerGuard on the backend, which is what actually enforces access.
export default function AuthGate({ children, requireAdmin = false, requireBlogger = false }: Props) {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = still loading
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    setUser(data.user);
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const handleAuth = async (tgUser: TelegramWidgetUser) => {
    setError(null);
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(tgUser),
    });

    if (!res.ok) {
      setError(t('authGate_loginError'));
      return;
    }
    await loadMe();
  };

  if (user === undefined) {
    return <p className="p-6 text-sm text-gray-500">{t('authGate_loading')}</p>;
  }

  const needsLogin = !user;
  const needsAdmin = requireAdmin && user && !user.isAdmin;
  // Admins can always see the blogger workplace too — usual permission hierarchy.
  const needsBlogger = requireBlogger && user && !user.isBlogger && !user.isAdmin;

  if (needsLogin || needsAdmin || needsBlogger) {
    return (
      <div className="max-w-sm mx-auto p-10 text-center space-y-4">
        <h1 className="text-lg font-semibold">
          {needsAdmin
            ? 'Доступ только для администраторов'
            : needsBlogger
              ? 'Доступ только для блогеров'
              : t('authGate_loginTitle')}
        </h1>

        {needsAdmin ? (
          <p className="text-sm text-gray-500">
            Вы вошли как {user?.firstName}, но этот Telegram-аккаунт не в списке администраторов
            (<code>ADMIN_TELEGRAM_IDS</code>).
          </p>
        ) : needsBlogger ? (
          <p className="text-sm text-gray-500">
            Вы вошли как {user?.firstName}, но этот Telegram-аккаунт не в списке блогеров
            (<code>BLOGGER_TELEGRAM_IDS</code>).
          </p>
        ) : BOT_USERNAME ? (
          <div className="flex justify-center">
            <TelegramLoginButton botUsername={BOT_USERNAME} onAuth={handleAuth} />
          </div>
        ) : (
          <p className="text-sm text-red-600">
            NEXT_PUBLIC_TELEGRAM_BOT_USERNAME не задан — виджет входа недоступен.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return <>{children}</>;
}

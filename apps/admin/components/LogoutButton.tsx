'use client';

import { useI18n } from './I18nProvider';

export default function LogoutButton() {
  const { t } = useI18n();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.reload();
  };

  return (
    <button className="text-gray-500 text-xs underline" onClick={logout}>
      {t('logout')}
    </button>
  );
}

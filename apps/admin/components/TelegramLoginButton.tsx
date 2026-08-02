'use client';

import { useEffect, useRef } from 'react';

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  botUsername: string;
  onAuth: (user: TelegramWidgetUser) => void;
}

// Injects Telegram's own widget script (https://core.telegram.org/widgets/login).
// The widget calls back through a global function name we register on `window`,
// since that's the only integration point Telegram's script supports.
export default function TelegramLoginButton({ botUsername, onAuth }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const callbackName = '__roadscoutTelegramAuth';
    (window as any)[callbackName] = (user: TelegramWidgetUser) => onAuth(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', `${callbackName}(user)`);
    script.setAttribute('data-request-access', 'write');

    containerRef.current?.appendChild(script);

    return () => {
      delete (window as any)[callbackName];
    };
  }, [botUsername, onAuth]);

  return <div ref={containerRef} />;
}

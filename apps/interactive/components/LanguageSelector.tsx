'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LANGUAGES, LanguageCode } from '../lib/i18n/languages';
import { useI18n } from './I18nProvider';

// Той самий паттерн, що apps/landing/components/LanguageSelector.tsx — окрема cookie
// (btw_interactive_lang, узгоджена з middleware.ts цього проєкту).
const COOKIE_NAME = 'btw_interactive_lang';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export default function LanguageSelector() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function handleSelect(code: LanguageCode) {
    setOpen(false);
    if (code === lang) return;

    document.cookie = `${COOKIE_NAME}=${code}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}`;

    const segments = pathname.split('/');
    segments[1] = code;
    router.push(segments.join('/') || `/${code}`);
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('languageSelector_label')}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span aria-hidden="true">{current.flag}</span>
        <span>{current.nativeName}</span>
        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('languageSelector_label')}
          className="absolute right-0 z-50 mt-2 max-h-80 w-48 overflow-y-auto rounded-xl border border-white/10 bg-surface py-2 shadow-xl"
        >
          {LANGUAGES.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === lang}>
              <button
                type="button"
                onClick={() => handleSelect(l.code)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-white/10 ${
                  l.code === lang ? 'text-primary' : 'text-neutral'
                }`}
              >
                <span aria-hidden="true" className="text-base">
                  {l.flag}
                </span>
                <span>{l.nativeName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

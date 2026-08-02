'use client';

import { LANGUAGES } from '../lib/i18n/languages';
import { useI18n } from './I18nProvider';

// Выпадающий список выбора мови з прапорцями країн (аналогічно ATM-travel.org/ОРБІТА) —
// нативный <select>, а не кастомный dropdown: доступність з коробки (клавіатура/скрінрідери),
// не потрібен окремий стан "відкрито/закрито" і обробник кліку поза межами компонента.
export default function LanguageSelector() {
  const { lang, setLang } = useI18n();

  return (
    <select
      className="border rounded px-2 py-1 text-sm"
      value={lang}
      onChange={(e) => setLang(e.target.value as (typeof LANGUAGES)[number]['code'])}
      aria-label="Language / Мова"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.nativeName}
        </option>
      ))}
    </select>
  );
}

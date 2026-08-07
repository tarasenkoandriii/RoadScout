import { LanguageCode, DEFAULT_LANGUAGE } from './languages';
import { Dictionary } from './dictionary.types';
import uk from './dictionaries/uk';
import en from './dictionaries/en';
import pl from './dictionaries/pl';
import sk from './dictionaries/sk';
import hu from './dictionaries/hu';
import ro from './dictionaries/ro';
import de from './dictionaries/de';
import fr from './dictionaries/fr';
import es from './dictionaries/es';
import it from './dictionaries/it';

export const DICTIONARIES: Record<LanguageCode, Dictionary> = { uk, en, pl, sk, hu, ro, de, fr, es, it };

export function getDictionary(lang: LanguageCode): Dictionary {
  return DICTIONARIES[lang] ?? DICTIONARIES[DEFAULT_LANGUAGE];
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

export type { Dictionary } from './dictionary.types';
export { LANGUAGES, DEFAULT_LANGUAGE, isSupportedLanguage } from './languages';
export type { LanguageCode, LanguageOption } from './languages';

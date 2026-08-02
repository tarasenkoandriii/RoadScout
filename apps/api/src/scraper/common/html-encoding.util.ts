import * as iconv from 'iconv-lite';

// Реальна проблема, знайдена вживу (не гіпотеза) — вебсторінки вроде webcam.guru.ua часто
// віддають HTML у застарілій кодуванні (windows-1251/koi8-u для кириличних сайтів, поширено на
// сайтах, зроблених задовго до повсюдного UTF-8). axios/Node за замовчуванням трактує байти
// відповіді як UTF-8, що для НЕ-UTF-8 сторінок дає "кракозябри" (мохибейк) у кожному
// кириличному символі — саме це і побачив користувач у реальному прогоні.
//
// decodeHtmlBuffer() визначає реальну кодування трьома способами по черзі (від найнадійнішого
// до найменш надійного) і декодує байти правильно, а не наосліп як UTF-8:
//   1. Заголовок Content-Type відповіді (`text/html; charset=windows-1251`) — найнадійніше,
//      сервер сам каже, що відправив.
//   2. Мета-тег у самому HTML (`<meta charset="windows-1251">` або
//      `<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">`) — шукаємо
//      в перших ~2КБ байтів, зчитаних як ASCII (декларація кодування завжди складається з
//      ASCII-символів незалежно від реальної кодування решти документа, тому це безпечно робити
//      ще ДО того, як ми знаємо справжню кодування).
//   3. Фолбек `windows-1251` — найпоширеніша кодування саме для старих українських/російських
//      сайтів (не гарантія, але кращий дефолт, ніж сліпе "завжди UTF-8", яке й спричинило баг).
export function decodeHtmlBuffer(buffer: Buffer, contentTypeHeader?: string): string {
  const charset = detectCharset(buffer, contentTypeHeader);

  // utf-8 (як за замовчуванням, так і явно задекларований) — рідний Buffer.toString(), без
  // додаткової залежності для найпоширенішого випадку.
  if (charset === 'utf-8' || charset === 'utf8') {
    return buffer.toString('utf-8');
  }

  if (iconv.encodingExists(charset)) {
    return iconv.decode(buffer, charset);
  }

  // Невідома iconv-lite кодування (одруківка в заголовку/мета-тезі і т.п.) — краще UTF-8
  // (може дати мохибейк, але хоча б не впаде), ніж кинути виключення посеред парсингу.
  return buffer.toString('utf-8');
}

function detectCharset(buffer: Buffer, contentTypeHeader?: string): string {
  const fromHeader = extractCharset(contentTypeHeader);
  if (fromHeader) return fromHeader;

  // Декларація кодування в самому документі завжди у перших кілобайтах і завжди ASCII-сумісна
  // (сама розмітка `<meta charset=...>` не містить кириличних символів) — безпечно прочитати
  // початок буфера як ASCII/latin1 для одного лише пошуку цього тега, не для всього документа.
  const head = buffer.subarray(0, 2048).toString('latin1');
  const metaCharsetMatch = head.match(/<meta[^>]+charset=["']?([a-z0-9-]+)/i);
  if (metaCharsetMatch) return normalizeCharsetName(metaCharsetMatch[1]);

  return 'windows-1251';
}

function extractCharset(contentTypeHeader?: string): string | null {
  if (!contentTypeHeader) return null;
  const match = contentTypeHeader.match(/charset=([a-z0-9-]+)/i);
  return match ? normalizeCharsetName(match[1]) : null;
}

function normalizeCharsetName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Частые синонимы одной и той же кодировки в разных заголовках/сайтах.
  if (lower === 'win-1251' || lower === 'cp1251') return 'windows-1251';
  if (lower === 'utf8') return 'utf-8';
  return lower;
}

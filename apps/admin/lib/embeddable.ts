// Общая логика для /embed/[id] и live-превью на экране калибровки (см.
// doc/AUDIT-embed-bare-url-fix.md — реальный инцидент: голый корень домена вроде
// "https://www.youtube.com/" технически проходит проверку streamType === 'IFRAME'/'YOUTUBE_LIVE',
// но реально не встраивается — YouTube отвечает X-Frame-Options: sameorigin для главной
// страницы, в отличие от настоящих embed/watch-ссылок).
export function looksEmbeddable(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Голый корень домена (путь "/" или пусто, без query/hash) — почти наверняка не настоящая
    // ссылка на конкретный поток/видео, а ошибочно сохранённый общий URL.
    return parsed.pathname.length > 1 || parsed.search.length > 0 || parsed.hash.length > 0;
  } catch {
    return false;
  }
}

export function canEmbedStream(streamType: string, streamUrl: string): boolean {
  const streamTypeCanEmbed = streamType === 'IFRAME' || streamType === 'YOUTUBE_LIVE';
  return streamTypeCanEmbed && looksEmbeddable(streamUrl);
}

// MJPEG_SNAPSHOT (реальний знайдений випадок — NycTmcAdapter, doc/AUDIT-nyctmc-adapter.md) —
// на відміну від IFRAME/HLS/YouTube (де потрібен справжній плеєр/iframe), тут streamUrl УЖЕ Є
// прямим посиланням на статичне зображення — найпростіший з усіх типів для прев'ю, звичайний
// <img>, не <iframe>. Раніше цей тип помилково потрапляв у ту саму гілку "неможливо показати
// напряму" (canEmbedStream), хоча технічно найлегше показати саме його.
export function canShowAsImage(streamType: string, streamUrl: string): boolean {
  return streamType === 'MJPEG_SNAPSHOT' && looksEmbeddable(streamUrl);
}

// ВАЖНО (реальный найденный follow-up инцидент — не гипотеза): даже после исправления
// "голого корня домена" (см. выше) в консоли браузера всё равно оставалась та же ошибка
// `X-Frame-Options: sameorigin`, теперь на реальной watch-ссылке с конкретным id видео.
// Причина глубже, чем недоступность конкретного видео (хотя видео действительно оказалось
// недоступно — см. doc/AUDIT-embed-bare-url-fix.md, раздел "Оновлення 2"): страницы
// youtube.com/watch?v=... в принципе НЕ предназначены для встраивания в чужой <iframe> —
// X-Frame-Options на них стоит ВСЕГДА, независимо от доступности видео. Только
// youtube.com/embed/{id} специально спроектирован для вставки в чужие фреймы — в том числе
// корректно показывает "видео недоступно" ВНУТРИ самого фрейма (не блокируется браузером),
// если видео действительно удалено/приватное. Это не костыль под конкретное видео, а
// системная поправка — тот же трюк нужен для ЛЮБой сохранённой youtube.com/watch-ссылки.
function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Возвращает URL, реально пригодный для <iframe src="...">: для youtube.com-ссылок
// конвертирует любой распознанный формат (watch?v=/youtu.be/live/уже-embed) в канонический
// youtube.com/embed/{id}. Для остальных ссылок возвращает streamUrl как есть — используется
// ТОЛЬКО для src самого iframe, не для ссылки "открыть в новой вкладке" (там нужен обычный
// watch-адрес — полноценный интерфейс YouTube, не урезанный embed-плеер).
//
// ВАЖНО: конвертация НЕ завязана строго на streamType === 'YOUTUBE_LIVE' — реальный найденный
// инцидент (см. doc/AUDIT-embed-bare-url-fix.md) показал, что тип и ссылка могут быть
// рассинхронизированы (та же камера "Шулявка реконструкція" была сохранена с
// streamType: 'IFRAME', хотя ссылка вела на YouTube). Если из самой ссылки можно извлечь id
// видео YouTube — конвертируем в embed-формат независимо от заявленного типа, а не полагаемся
// на то, что админ обязательно успел его поправить.
export function toEmbeddableUrl(streamUrl: string): string {
  const videoId = extractYoutubeVideoId(streamUrl);
  if (videoId) return `https://www.youtube.com/embed/${videoId}`;
  return streamUrl;
}

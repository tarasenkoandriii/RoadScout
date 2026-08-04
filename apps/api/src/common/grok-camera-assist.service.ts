import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AzimuthHeuristicService } from '../scraper/azimuth-heuristic.service';

// AI-автоматизация этапов добавления камеры (см. запрос пользователя) — тот же провайдер
// (xAI/Grok), те же переменные окружения и конвенции, что и в ReceiptVerificationService
// (см. doc/README.md, «Мой дом»): ключ читается заново при каждом вызове, при отсутствии
// ключа/ошибке — безопасный фоллбэк "ничего не предполагаем", не блокирующий остальной пайплайн.
//
// Отличие от ReceiptVerificationService: здесь только ТЕКСТ (название камеры/текст адреса от
// источника), без изображений — используется обычная (не vision) модель, поэтому отдельная
// переменная GROK_TEXT_MODEL, не GROK_VISION_MODEL.
function getApiKey(): string | null {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || null;
}
function getBaseUrl(): string {
  return process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
}
// NOTE: сверить актуальное имя текстовой модели в документации xAI перед продакшеном.
function getTextModel(): string {
  return process.env.GROK_TEXT_MODEL || 'grok-4';
}
// Автокалибровка (азимут/FOV) — нужна vision-модель (см. suggestAzimuthFov ниже), та же
// GROK_VISION_MODEL, что уже используется в ReceiptVerificationService.
function getVisionModel(): string {
  return process.env.GROK_VISION_MODEL || 'grok-4';
}
// Пошук через Google (веб-пошук, див. запит користувача) — окремий Responses API-ендпоінт
// (/v1/responses, не /v1/chat/completions вище), потребує reasoning-моделі з підтримкою
// tools: web_search (див. https://docs.x.ai/developers/tools/web-search). ВАЖЛИВО: пошук
// виконується на СТОРОНІ СЕРВЕРІВ xAI, не з нашого сервера — RegistryProxyService (VPN) до
// цього кроку не застосовний (ми не робимо HTTP-запит до Google самі). VPN залишається
// доречним окремо — коли AggregatorDiscoveryService сам відвідує знайдений сайт-агрегатор.
function getWebSearchModel(): string {
  return process.env.GROK_WEB_SEARCH_MODEL || 'grok-4';
}

const REQUEST_TIMEOUT_MS = 20000;

// Автокалибровка азимута/FOV (см. запрос пользователя) требует реального кадра трансляции —
// без него vision-модели нечего анализировать. Для YOUTUBE_LIVE со ссылкой вида
// watch?v=/youtu.be/embed/ можно получить публичную превью-картинку YouTube БЕЗ какого-либо
// API-ключа (img.youtube.com — статический CDN, не YouTube Data API). Для ссылки на КАНАЛ
// целиком (реальный случай — см. doc/AUDIT-webcam-guru-real-html.md, там streamUrl вида
// youtube.com/channel/UC...) — id конкретного текущего эфира так получить нельзя (для этого
// нужен YouTube Data API с отдельным ключом и квотой — не реализовано, честно возвращаем
// "недоступно", не гадаем). Для IFRAME/HLS/MJPEG_SNAPSHOT — тоже недоступно (нужен headless-
// браузер, чтобы снять кадр, которого в проекте нет).
export function extractYoutubeVideoId(streamUrl: string): string | null {
  const match = streamUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function extractYoutubeThumbnailUrl(streamUrl: string): string | null {
  const videoId = extractYoutubeVideoId(streamUrl);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
}

// Винесено окремо (раніше — інлайн-вираз, продубльований у трьох місцях цього файлу) — тепер
// перевикористовується і в У5 vision-уточненні (BTW) нижче.
export function resolveImageUrl(streamType: string, streamUrl: string): string | null {
  return streamType === 'YOUTUBE_LIVE' ? extractYoutubeThumbnailUrl(streamUrl) : streamType === 'MJPEG_SNAPSHOT' ? streamUrl : null;
}

export interface CameraAiSuggestion {
  configured: boolean; // AI-провайдер вообще настроен (есть ключ)?
  suggestedAddress: string | null;
  addressConfidence: number; // 0..1 — уверенность модели в suggestedAddress, не в geocoding-результате (это отдельная, последующая проверка через GeocodingService)
  // Пошук координат безпосередньо AI (див. запит користувача: "ИИ поиск координат камеры на
  // этапе ручного ревью") — на випадок, коли геокодер не може розпізнати навіть хороший
  // текстовий адрес (реальний приклад: "завод «Енергія», Київ" — впевненість геокодингу
  // занадто низька), а модель може знати приблизні координати відомого орієнтиру зі своїх
  // знань. НЕ замінює геокодинг — це окрема, паралельна підказка, яку адмін бачить і сам
  // вирішує, використовувати її чи ні.
  suggestedLat: number | null;
  suggestedLng: number | null;
  coordinatesConfidence: number; // 0..1 — уверенность именно в suggestedLat/suggestedLng (модель отвечает null, если не уверена, не выдумывает)
  // Камери всередині приміщень (див. doc/README.md) — интерьер храма/музея/ТЦ и т.п., где нет
  // осмысленного "направления обзора улицы". См. Camera.locationType.
  isLikelyIndoor: boolean;
  // Камери, що дивляться на море/пляж/природу (див. запит користувача: "пометить камеры
  // которые смотрят в море пляж на природу как отдельный класс и исключить из поиска") — не
  // приміщення, а мальовничий краєвид просто неба, тому окремий прапор, не той самий, що
  // isLikelyIndoor. См. Camera.locationType (NATURE).
  isLikelyNature: boolean;
  reasoning: string | null;
}

interface ParsedAiResponse {
  suggestedAddress: string | null;
  addressConfidence: number;
  suggestedLat: number | null;
  suggestedLng: number | null;
  coordinatesConfidence: number;
  isLikelyIndoor: boolean;
  isLikelyNature: boolean;
  reasoning: string;
}

// Автокалибровка (див. запит користувача: "автоматизировать автокалибровку - ИИ чтобы
// определял азимут и FOV") — ЧЕСНЕ ЗАСТЕРЕЖЕННЯ (у промпті нижче теж): визначити компасний
// азимут по одному кадру трансляції — суттєво менш надійна задача для vision-моделі, ніж
// читання тексту з квитанції (ReceiptVerificationService) — модель має здогадуватися за
// непрямими візуальними ознаками (напрямок вулиці, тіні, впізнавання конкретного орієнтиру й
// знання його реальної орієнтації з тренувальних даних), без жодного GPS/компас-оверлею на
// кадрі. Тому результат — це підказка для звірки з картою вручну, не автоматичне застосування.
export interface AzimuthFovSuggestion {
  configured: boolean; // AI-провайдер взагалі налаштований?
  imageAvailable: boolean; // чи вдалося взагалі отримати кадр для аналізу
  imageUrl: string | null;
  unavailableReason: string | null; // чому кадр недоступний (для UI, якщо imageAvailable: false)
  suggestedAzimuth: number | null; // 0-359.999, null якщо модель не впевнена
  suggestedFovAngle: number | null; // 10-180, null якщо модель не впевнена
  // Оцінка дальності обзору в метрах (див. запит користувача: "добавь оценку дальности обзора
  // через ИИ") — та сама чесна логіка: null, якщо за кадром неможливо оцінити (немає видимих
  // орієнтирів для масштабу — далекий будинок/перехрестя/кінець вулиці тощо).
  suggestedRangeMeters: number | null;
  confidence: number; // 0..1, спільна для всіх трьох значень
  reasoning: string | null;
  // ДОДАНО (за прямим запитом користувача — розбір випадку "Азимут: —" і "по возможности
  // определи азимут кодом для таких случаев"): ДЕТЕРМІНОВАНІ (не-AI) кандидати азимута з
  // AzimuthHeuristicService — обидва напрямки вздовж найближчої дороги за даними OpenStreetMap
  // (той самий roadAzimuth, що йде в промпт AI як підказка, § buildAzimuthFovPrompt вище, плюс
  // протилежний напрямок +180°). Заповнюється НЕЗАЛЕЖНО від того, чи вдалося AI визначити
  // азимут — навіть якщо suggestedAzimuth: null (як у випадку зі скріншота користувача), тут
  // може бути 1-2 кандидати, і адмін може застосувати один з них вручну одним кліком. null,
  // якщо поблизу взагалі не знайдено дороги (Overpass не повернув нічого в радіусі 60м) АБО
  // сам heuristic-запит провалився мережево (source==='fallback') — в обох випадках чесно
  // немає жодного орієнтиру по карті, а не вигаданий 0°.
  roadAzimuthCandidates: number[] | null;
}

// У5 ТЗ (§5, doc/BTW-tz.md, doc/AUDIT-btw.md) — результат порівняння кадру телефону з кадром
// кандидата-камери.
export interface VisionRefinementResult {
  configured: boolean;
  imageAvailable: boolean;
  unavailableReason: string | null;
  sameScene: boolean;
  angularOffsetDeg: number | null; // невелика (обмежена) поправка, +=за годинниковою, -=проти
  confidence: number; // 0..1; 0, якщо sameScene: false
  reasoning: string | null;
}

interface ParsedAzimuthFovResponse {
  suggestedAzimuth: number | null;
  suggestedFovAngle: number | null;
  suggestedRangeMeters: number | null;
  confidence: number;
  reasoning: string;
}

// Перевірка доступності контенту (див. запит користувача: «недоступне відео → автоматично
// дизейблити такі камери, контролювати через ІІ, окремо від парсера») — свідомо НЕ частина
// ScraperService/автоімпорту: викликається лише з окремого, розв'язаного циклу
// MonitoringService (уже й так працює за власним cron-розкладом, окремо від парсера), і за
// кнопкою на екрані калібрування. Двошарова перевірка:
//   1) YouTube oEmbed (https://www.youtube.com/oembed) — безкоштовний, детермінований,
//      офіційний спосіб дізнатись "чи існує/публічне це відео" без жодного ключа: повертає
//      401/404 для видалених/приватних відео, 200+JSON для доступних. Не потребує ІІ взагалі —
//      надійніший за візуальне вгадування там, де застосовний.
//   2) Grok vision (та ж модель, що для автокалібрування) — резервний шар на мініатюрі
//      YouTube-відео, коли oEmbed недоступний з якоїсь причини (мережева помилка тощо) — не
//      замінює oEmbed, а доповнює його для більшої впевненості.
export interface StreamAvailabilitySuggestion {
  checked: boolean; // чи вдалося взагалі щось перевірити (false — немає ні відео id, ні можливості перевірити)
  available: boolean | null; // null — перевірити не вдалося жодним способом
  checkedVia: 'oembed' | 'vision' | 'none';
  reason: string | null;
}

// currentAzimuth/currentFovAngle/currentRangeMeters — поточні (можливо, ще не збережені)
// значення сектора на карті (див. запит користувача: "по возможности сверяй через ИИ с
// сектором на карте") — передаються як контекст для звірки, НЕ як підказка відповіді: модель
// явно просять сказати, чи узгоджується її власна візуальна оцінка з тим, що вже виставлено
// на карті, а не просто повторити ці числа. Якщо currentAzimuth/... не задані (перший виклик
// для нової камери) — розділ звірки в промпті пропускається.
// У5 ТЗ (§5, doc/BTW-tz.md) — "визуальная привязка": порівнюємо кадр з телефону користувача
// з кадром кандидата-камери, щоб уточнити (не заново вгадати) азимут погляду користувача.
//
// Промпт побудовано, застосовуючи ВСІ уроки з ітерацій калібрування камер у RoadScout
// (doc/AUDIT-auto-calibrate-batch.md):
// 1. Явна шкала впевненості 0..1, НЕ відсоток (реальний баг — модель повертала 45 замість
//    0.45, RoadScout уже проходив це).
// 2. ГРАУНДИНГ замість вільного вгадування "з нуля" (той самий принцип, що У3 — дати AI
//    відомий геометричний факт як опору): тут — очікуваний ракурсний зв'язок
//    (ALIGNED/SIDE/OPPOSING), уже пораховано геометричним рушієм BTW, а НЕ те, що AI має
//    вгадати сам. Задача звужена до "чи узгоджується конкретна, вже відома гіпотеза" —
//    набагато легше за "розберись у геометрії з нуля".
// 3. Запит СПОЧАТКУ бінарного "чи та сама сцена" — тільки ПОТІМ кутова оцінка, якщо так. Це
//    відсікає найбільший ризик (галюцинована корекція для двох геть різних сцен) ще до того,
//    як модель взагалі почне оцінювати кут.
// 4. Явно просимо НЕВЕЛИКУ, обмежену корекцію (не абсолютний азимут) — узгоджується з тим, що
//    сервер однаково обріже результат до ±45° незалежно від відповіді (defense in depth,
//    див. validateVisionRefinement() нижче) — але явна інструкція зменшує шанс, що модель
//    взагалі поверне щось за межами розумного.
function buildVisionRefinementPrompt(cameraName: string, expectedRelationship: 'ALIGNED' | 'SIDE' | 'OPPOSING'): string {
  const relationshipHint =
    expectedRelationship === 'ALIGNED'
      ? 'камера должна показывать ТУ ЖЕ сцену, что видит пользователь, но с противоположной точки (взгляд навстречу — как будто смотришь сквозь препятствие на то же место)'
      : expectedRelationship === 'SIDE'
        ? 'камера должна показывать сцену СБОКУ от того, куда смотрит пользователь (примерно перпендикулярный ракурс)'
        : 'камера должна показывать место, ГДЕ СЕЙЧАС СТОИТ пользователь (встречный ракурс — камера смотрит в сторону пользователя)';

  return `Сравни два кадра: Изображение 1 — то, что СЕЙЧАС видит камера ТЕЛЕФОНА пользователя. Изображение 2 — живой кадр с камеры видеонаблюдения "${cameraName}".

По геометрическим расчётам (координаты, известный азимут камеры) ожидается следующее: ${relationshipHint}.

Твоя задача — СВЕРИТЬ это ожидание с тем, что реально видно на кадрах, а НЕ определить азимут с нуля.

Шаг 1 — ОБЯЗАТЕЛЬНО сначала реши: показывают ли два кадра одну и ту же местность (та же улица/перекрёсток/район), хотя бы частично перекрывающуюся? Ищи общие ориентиры — здания, дорожную разметку, растительность, вывески. Если сцены явно разные (разные улицы, разное окружение) — НЕ пытайся угадать поправку, верни sameScene: false.

Шаг 2 — ТОЛЬКО если sameScene: true — оцени НЕБОЛЬШУЮ угловую поправку: если бы пользователь довернул телефон на несколько градусов влево или вправо, ожидаемая геометрическая связь (см. выше) совпала бы точнее? Верни это как angularOffsetDeg — положительное число значит "довернуть по часовой стрелке (вправо)", отрицательное — "против часовой (влево)". Это НЕБОЛЬШАЯ поправка (обычно в пределах 30°), а НЕ абсолютный азимут — если требуется поправка больше ~45°, это признак того, что сцены на самом деле не совпадают, тогда лучше вернуть sameScene: false.

Ответь СТРОГО в формате JSON, без markdown-разметки:
{
  "sameScene": boolean,
  "angularOffsetDeg": number | null,
  "confidence": number (от 0 до 1, ДОЛЯ, не процент — например 0.6, а НЕ 60. Если sameScene: false — confidence должна быть 0),
  "reasoning": string
}`;
}

function buildAzimuthFovPrompt(
  cameraName: string,
  lat: number,
  lng: number,
  current?: { azimuth: number; fovAngle: number; rangeMeters: number },
  roadAzimuth?: number | null,
  previousAttempt?: { suggestedAzimuth: number | null; suggestedFovAngle: number | null; suggestedRangeMeters: number | null; confidence: number; reasoning: string | null } | null,
): string {
  const crossCheckSection = current
    ? `\n\nВАЖНО — сверка с текущими настройками сектора на карте (уже выставлены администратором, могут быть неточными): сейчас азимут = ${current.azimuth}°, угол обзора (FOV) = ${current.fovAngle}°, дальность обзора = ${current.rangeMeters}м. Оцени сцену на кадре НЕЗАВИСИМО от этих чисел (не подгоняй свой ответ под них), но в поле "reasoning" явно укажи, согласуется ли твоя визуальная оценка с текущими значениями сектора на карте, или расходится — и в чём именно.`
    : '';

  // За прямим запитом користувача — використовуємо результат ПОПЕРЕДНЬОЇ спроби AI-
  // калібрування цієї самої камери (якщо була), збережений у Camera.lastAiCalibrationSuggestion
  // (див. doc/AUDIT-auto-calibrate-batch.md, "Оновлення 10"). Дозволяє AI будувати на власному
  // попередньому аналізі — підтвердити його (і, можливо, підняти впевненість при повторному
  // незалежному погляді на той самий кадр) або свідомо переглянути, а не оцінювати "з нуля"
  // щоразу, ігноруючи вже накопичені міркування.
  const previousAttemptSection =
    previousAttempt && (previousAttempt.suggestedAzimuth != null || previousAttempt.reasoning)
      ? `\n\nТВОЯ ПРЕДЫДУЩАЯ ПОПЫТКА (эта же камера, отдельный независимый запрос ранее): азимут ${previousAttempt.suggestedAzimuth ?? '—'}°, FOV ${previousAttempt.suggestedFovAngle ?? '—'}°, дальность ${previousAttempt.suggestedRangeMeters ?? '—'}м, уверенность ${previousAttempt.confidence}. Твоё тогдашнее рассуждение: "${previousAttempt.reasoning ?? '—'}". Оцени кадр СЕЙЧАС заново и самостоятельно (не копируй прошлый ответ бездумно), но учти этот контекст: если твоя новая оценка согласуется с предыдущей — это дополнительное основание для более высокой уверенности; если расходится — явно укажи в reasoning, что именно заставило тебя изменить мнение.`
      : '';

  // ПРОРИВНЕ ПОКРАЩЕННЯ #1 (за прямим запитом користувача — "сделай что-то прорывное",
  // батчі марно "згорають" через низьку впевненість AI): замість вільного вгадування азимута
  // 0-360°, даємо AI реальний напрямок найближчої дороги з карти (Overpass, той самий
  // AzimuthHeuristicService, що вже використовується як fallback БЕЗ AI) — камера вздовж
  // вулиці майже завжди дивиться ВЗДОВЖ дороги в один із ДВОХ напрямків (сам напрямок дороги
  // або точно протилежний), не під довільним кутом. Це перетворює задачу з "вгадай число
  // 0-360" на набагато простішу "обери один з двох варіантів" — має суттєво підняти
  // впевненість AI.
  const roadAnchorSection =
    roadAzimuth != null
      ? `\n\nОРИЕНТИР ПО КАРТЕ (важно): ближайшая дорога/улица рядом с этими координатами (по данным OpenStreetMap) ориентирована примерно по оси ${Math.round(roadAzimuth)}°/${Math.round((roadAzimuth + 180) % 360)}° (два противоположных направления вдоль неё). Уличные камеры почти всегда смотрят ВДОЛЬ дороги в одну из этих ДВУХ сторон, а не под произвольным углом к ней (редкое исключение — камера у перекрёстка, направленная поперёк, или на здание/двор в стороне от дороги). Сначала определи по кадру, какая из этих ДВУХ конкретных сторон — это и есть твой азимут, и только если сцена явно этому противоречит (перпендикулярный вид, двор, помещение и т.п.) — оцени азимут свободно.`
      : '';

  // ПРОРИВНЕ ПОКРАЩЕННЯ #2: явна інструкція шукати напрямкові коди в самій назві камери —
  // держслужби (NYC DOT тощо) масово кодують напрямок трафіку/погляду прямо в ID камери
  // (напр. "SB" = southbound, "NB" = northbound), а це вкрай надійний сигнал, який AI міг
  // просто не помічати як пріоритетний серед іншого тексту назви.
  const nameCodeHint = `\n\nПОДСКАЗКА ПО НАЗВАНИЮ (проверь ОБЯЗАТЕЛЬНО, это часто самый надёжный сигнал): в названиях камер госслужб направление часто закодировано прямо в идентификаторе — "NB"/"SB"/"EB"/"WB" (northbound/southbound/eastbound/westbound — направление движения, за которым следит камера), "Facing North/South/East/West", номер "Exit N", название шоссе/моста (обычно известно, в какую сторону света оно идёт). Если такой код есть в названии "${cameraName}" — используй его как сильный сигнал для азимута, явно упомяни это в "reasoning".`;

  return `Ты помогаешь оценить направление обзора (азимут), угол обзора (FOV) и дальность обзора веб-камеры видеонаблюдения по кадру трансляции — для реестра городских камер в Украине.

Название камеры: "${cameraName}"
Известные координаты установки камеры: ${lat}, ${lng}${crossCheckSection}${previousAttemptSection}${roadAnchorSection}${nameCodeHint}

На изображении — кадр с этой камеры. ЧЕСТНО оцени, глядя на видимую сцену (направление улицы/дороги, если видна, положение солнца/теней, узнаваемые ориентиры и их обычная сторона света, перспектива застройки и т.п.):

1. Азимут — компасное направление, куда "смотрит" камера (0° = север, 90° = восток, 180° = юг, 270° = запад).
2. Угол обзора (FOV) — насколько широкий кадр захватывает камера (обычная камера — примерно 60-90°, широкоугольная/fisheye — до 150-180°).
3. Дальность обзора в метрах — как далеко камера реально различает объекты на кадре (используй видимые ориентиры для масштаба: расстояние до видимого перекрёстка/конца улицы/заметного здания, зная типичные размеры городских кварталов и полос движения). Для кадра, где чётко видна дорога на несколько кварталов вперёд — дальность может быть 200-500м; если видна только близкая часть перекрёстка — 50-100м.

Если по кадру невозможно уверенно определить значение — верни null для него, а не догадку наугад (для каждого из трёх значений отдельно). Ответь СТРОГО в формате JSON, без markdown-разметки, без пояснений вне JSON, точно по такой схеме:
{
  "suggestedAzimuth": number | null,
  "suggestedFovAngle": number | null,
  "suggestedRangeMeters": number | null,
  "confidence": number (от 0 до 1, ДОЛЯ, не процент — например 0.45, а НЕ 45). ВАЖНО: confidence отражает ТОЛЬКО твою уверенность в suggestedAzimuth и suggestedFovAngle — направление и ширину обзора обычно можно определить достаточно надёжно по одному кадру. Дальность (suggestedRangeMeters) по своей природе намного сложнее оценить точно по одному кадру, поэтому НЕ снижай confidence из-за неуверенности именно в дальности — даже если ты не вполне уверен в точном значении дальности (или она расходится с текущим значением на карте), это само по себе НЕ должно понижать confidence, если в азимуте и FOV ты уверен. Любые сомнения по дальности отдельно опиши в reasoning, не в числе confidence.
  "reasoning": string
}`;
}

function buildPrompt(title: string, rawLocationText: string | null, cityName: string | null): string {
  return `Ты помогаешь определить адрес, координаты и тип веб-камеры для реестра городских камер видеонаблюдения в Украине.

Название камеры (от источника): "${title}"
Текст адреса от источника (может отсутствовать): "${rawLocationText ?? '—'}"
Город (если известен): "${cityName ?? '—'}"

Проанализируй и ответь СТРОГО в формате JSON, без markdown-разметки, без пояснений вне JSON, точно по такой схеме:
{
  "suggestedAddress": string | null,  // предполагаемый геокодируемый адрес или ориентир (улица/площадь/здание/храм и т.п.), максимально конкретный из того, что можно понять из названия; null, если определить невозможно вообще
  "addressConfidence": number,        // 0.0-1.0 — насколько ты уверен, что suggestedAddress достаточно конкретен и корректен для геокодинга (не путать с тем, найдёт ли его реально геокодер — это отдельная проверка)
  "suggestedLat": number | null,      // ПРИБЛИЗИТЕЛЬНЫЕ координаты (широта) этого места, ТОЛЬКО если ты действительно знаешь это конкретное место по своим знаниям (известная достопримечательность/улица/здание) — иначе null, НЕ ВЫДУМЫВАЙ координаты наугад
  "suggestedLng": number | null,      // приблизительные координаты (долгота), тот же принцип
  "coordinatesConfidence": number,    // 0.0-1.0 — уверенность именно в suggestedLat/suggestedLng (не в адресе) — 0, если координаты null
  "isLikelyIndoor": boolean,          // true, только если камера, СКОРЕЕ ВСЕГО, показывает ВНУТРЕННЕЕ помещение (интерьер храма/музея/торгового центра/офиса/цеха и т.п.), а не улицу/площадь/фасад/двор снаружи — например, "Киево-Печерская Лавра" сама по себе не означает "внутри", а вот "внутри Софийского собора" или "интерьер ТЦ" — означает
  "isLikelyNature": boolean,          // true, только если камера, СКОРЕЕ ВСЕГО, показывает море/пляж/горы/лес/другой природный пейзаж (не улицу/площадь/здание) — например, "Пляж Аркадия, Одесса" или "Панорама Карпат" — да, а обычный уличный перекрёсток рядом с пляжем — нет
  "reasoning": string                 // короткое пояснение решения, на русском
}`;
}

@Injectable()
export class GrokCameraAssistService {
  private readonly logger = new Logger(GrokCameraAssistService.name);

  // За прямим запитом користувача ("сделай что-то прорывное" — батчі калібрування марно
  // "згорають" через низьку впевненість AI): тепер перед vision-запитом реально запитуємо
  // напрямок найближчої дороги з карти (той самий Overpass-евристичний сервіс, що вже
  // використовується як fallback БЕЗ AI) — і даємо AI цей орієнтир як "камера дивиться в один
  // з ДВОХ напрямків уздовж цієї дороги" замість вільного вгадування 0-360°. Різко звужує
  // простір вибору для AI — має суттєво підняти впевненість.
  constructor(private readonly azimuthHeuristic: AzimuthHeuristicService) {}

  isConfigured(): boolean {
    return !!getApiKey();
  }

  // Единственная безопасная точка отказа: если AI-провайдер не настроен, запрос упал, или
  // ответ не удалось распарсить — возвращаем suggestedAddress: null/isLikelyIndoor: false и
  // низкую уверенность, а не бросаем исключение — это подсказка, не обязательный шаг пайплайна,
  // остальная логика (геокодинг/ручное ревью) должна продолжать работать без неё.
  async suggestAddressAndType(title: string, rawLocationText: string | null, cityName: string | null): Promise<CameraAiSuggestion> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return this.unavailable();
    }

    try {
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getTextModel(),
          messages: [{ role: 'user', content: buildPrompt(title, rawLocationText, cityName) }],
          temperature: 0,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseAiJson(text);
      return { configured: true, ...parsed };
    } catch (err) {
      this.logger.warn(`Grok camera-assist call failed: ${(err as Error).message}`);
      return this.unavailable();
    }
  }

  private unavailable(): CameraAiSuggestion {
    return {
      configured: this.isConfigured(),
      suggestedAddress: null,
      addressConfidence: 0,
      suggestedLat: null,
      suggestedLng: null,
      coordinatesConfidence: 0,
      isLikelyIndoor: false,
      isLikelyNature: false,
      reasoning: null,
    };
  }

  // Автокалибровка азимута/FOV по кадру трансляции (см. класс-комментарий AzimuthFovSuggestion
  // выше) — streamUrl/streamType нужны, чтобы попытаться получить реальный кадр
  // (extractYoutubeThumbnailUrl для YouTube), lat/lng передаются в промпт как контекст (не как
  // результат, который надо подтвердить/опровергнуть).
  //
  // MJPEG_SNAPSHOT (реальний знайдений випадок — NycTmcAdapter, doc/AUDIT-nyctmc-adapter.md) —
  // на відміну від YouTube (де потрібно окремо витягувати мініатюру) чи IFRAME/HLS (де дійсно
  // потрібен headless-браузер, щоб відрендерити кадр), тут streamUrl УЖЕ Є прямим посиланням
  // на статичне зображення (JPEG-знімок) — жодного додаткового кроку не потрібно, можна
  // передати напряму у vision-модель.
  async suggestAzimuthFov(
    cameraName: string,
    streamUrl: string,
    streamType: string,
    lat: number,
    lng: number,
    current?: { azimuth: number; fovAngle: number; rangeMeters: number },
    // За прямим запитом користувача — результат ПОПЕРЕДНЬОЇ спроби AI-калібрування цієї самої
    // камери (якщо була), щоб AI міг будувати на власному попередньому аналізі.
    previousAttempt?: { suggestedAzimuth: number | null; suggestedFovAngle: number | null; suggestedRangeMeters: number | null; confidence: number; reasoning: string | null } | null,
    // ДОДАНО (за прямим запитом користувача — "мы создаем полный кеш overpass by city -
    // предлагаю использовать сначала его а уже потом фоллбеком переходить к сервису запросов"):
    // `Camera.city.slug`, якщо камера прив'язана до міста (nullable — див. schema.prisma) —
    // дозволяє guessForPoint() нижче спершу перевірити ВЖЕ згенерований BTW-тайл цього міста
    // (streets.json), перш ніж бити живий Overpass. `undefined`/`null` — поведінка НЕ
    // змінюється, як і до цієї зміни.
    citySlug?: string | null,
  ): Promise<AzimuthFovSuggestion> {
    const imageUrl = resolveImageUrl(streamType, streamUrl);

    // ПРОРИВНЕ ПОКРАЩЕННЯ (за прямим запитом користувача) — реальний напрямок дороги з карти
    // як орієнтир для AI (див. коментар до buildAzimuthFovPrompt() вище). Той самий
    // AzimuthHeuristicService, що вже кешує запити по сітці координат — повторний виклик тут
    // майже завжди потрапляє в кеш, не робить зайвого мережевого запиту.
    //
    // ПЕРЕНЕСЕНО НАГОРУ, ПЕРЕД imageUrl/apiKey-перевірками (за прямим запитом користувача —
    // "по возможности определи азимут кодом для таких случаев"): раніше цей виклик стояв
    // ПІСЛЯ обох ранніх `return` (кадр недоступний / AI не налаштований) — тобто
    // roadAzimuthCandidates узагалі НЕ обчислювався в цих випадках, хоча детермінований
    // орієнтир по карті не залежить від наявності кадру чи AI. Тепер обчислюється завжди,
    // одразу за lat/lng — і потрапляє у ВСІ шляхи повернення нижче, включно з обома ранніми.
    let roadAzimuth: number | null = null;
    try {
      const heuristic = await this.azimuthHeuristic.guessForPoint(lat, lng, citySlug);
      // 'cached' (§ AzimuthSource, azimuth-heuristic.service.ts) — результат з ВЖЕ
      // згенерованого тайлу міста, той самий рівень довіри, що й живий 'heuristic', просто без
      // мережевого запиту — тому теж приймається тут як реальний орієнтир, не лише 'heuristic'.
      if (heuristic.source === 'heuristic' || heuristic.source === 'cached') roadAzimuth = heuristic.azimuth;
    } catch {
      // Не критично — просто не даємо AI (і адміну) цей орієнтир, якщо Overpass недоступний
    }
    const roadAzimuthCandidates: number[] | null = roadAzimuth != null ? [roadAzimuth, (roadAzimuth + 180) % 360] : null;

    if (!imageUrl) {
      return {
        configured: this.isConfigured(),
        imageAvailable: false,
        imageUrl: null,
        unavailableReason:
          streamType === 'YOUTUBE_LIVE'
            ? 'Ссылка ведёт на канал YouTube целиком, не на конкретное видео/эфир — получить id текущего кадра без YouTube Data API нельзя.'
            : `Автоматический захват кадра для типа потока "${streamType}" не реализован (нужен headless-браузер).`,
        suggestedAzimuth: null,
        suggestedFovAngle: null,
        suggestedRangeMeters: null,
        confidence: 0,
        reasoning: null,
        roadAzimuthCandidates,
      };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        configured: false,
        imageAvailable: true,
        imageUrl,
        unavailableReason: null,
        suggestedAzimuth: null,
        suggestedFovAngle: null,
        suggestedRangeMeters: null,
        confidence: 0,
        reasoning: null,
        roadAzimuthCandidates,
      };
    }

    try {
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getVisionModel(),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildAzimuthFovPrompt(cameraName, lat, lng, current, roadAzimuth, previousAttempt) },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          temperature: 0,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseAzimuthFovJson(text);
      return { configured: true, imageAvailable: true, imageUrl, unavailableReason: null, ...parsed, roadAzimuthCandidates };
    } catch (err) {
      this.logger.warn(`Grok azimuth/FOV vision call failed: ${(err as Error).message}`);
      return {
        configured: true,
        imageAvailable: true,
        imageUrl,
        unavailableReason: `Ошибка обращения к AI: ${(err as Error).message}`,
        suggestedAzimuth: null,
        suggestedFovAngle: null,
        suggestedRangeMeters: null,
        confidence: 0,
        reasoning: null,
        roadAzimuthCandidates,
      };
    }
  }

  // У5 ТЗ (§5) — vision-уточнення для BTW: порівнює кадр телефону з живим кадром камери-
  // кандидата, використовуючи ВЖЕ ВІДОМИЙ геометричний зв'язок (ALIGNED/SIDE/OPPOSING) як
  // опору замість вільного вгадування — див. коментар до buildVisionRefinementPrompt() вище.
  async refineHeadingWithVision(
    phoneImageDataUrl: string,
    cameraName: string,
    cameraStreamUrl: string,
    cameraStreamType: string,
    expectedRelationship: 'ALIGNED' | 'SIDE' | 'OPPOSING',
  ): Promise<VisionRefinementResult> {
    const cameraImageUrl = resolveImageUrl(cameraStreamType, cameraStreamUrl);
    if (!cameraImageUrl) {
      return {
        configured: this.isConfigured(),
        imageAvailable: false,
        unavailableReason: `Автоматический захват кадра для типа потока "${cameraStreamType}" не реализован (нужен headless-браузер).`,
        sameScene: false,
        angularOffsetDeg: null,
        confidence: 0,
        reasoning: null,
      };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        configured: false,
        imageAvailable: true,
        unavailableReason: null,
        sameScene: false,
        angularOffsetDeg: null,
        confidence: 0,
        reasoning: null,
      };
    }

    try {
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getVisionModel(),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildVisionRefinementPrompt(cameraName, expectedRelationship) },
                { type: 'image_url', image_url: { url: phoneImageDataUrl } },
                { type: 'image_url', image_url: { url: cameraImageUrl } },
              ],
            },
          ],
          temperature: 0,
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseVisionRefinementJson(text);
      return { configured: true, imageAvailable: true, unavailableReason: null, ...parsed };
    } catch (err) {
      this.logger.warn(`Grok vision refinement call failed: ${(err as Error).message}`);
      return {
        configured: true,
        imageAvailable: true,
        unavailableReason: `Ошибка обращения к AI: ${(err as Error).message}`,
        sameScene: false,
        angularOffsetDeg: null,
        confidence: 0,
        reasoning: null,
      };
    }
  }

  // Парсинг + захисне ОБРІЗАННЯ (defense in depth, окремо від інструкції в самому промпті) —
  // навіть якщо модель проігнорує прохання про "невелику" поправку, сервер однаково не
  // застосує щось за межами розумного. Винесено як окремий приватний метод (не публічна
  // pure-функція в btw-geometry.util.ts, як snap/bias/filter вище) — тут парсинг сирого
  // тексту моделі неминуче прив'язаний до цього сервісу (як і parseAzimuthFovJson нижче), а
  // не чиста геометрія.
  private parseVisionRefinementJson(text: string): { sameScene: boolean; angularOffsetDeg: number | null; confidence: number; reasoning: string | null } {
    const MAX_OFFSET_DEG = 45; // те саме обмеження, що явно проговорено в промпті — тут гарантовано, не покладаючись на слухняність моделі

    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const obj = JSON.parse(cleaned);

      const sameScene = obj.sameScene === true;
      if (!sameScene) {
        return { sameScene: false, angularOffsetDeg: null, confidence: 0, reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null };
      }

      const rawOffset = typeof obj.angularOffsetDeg === 'number' ? obj.angularOffsetDeg : null;
      const clampedOffset = rawOffset == null ? null : Math.max(-MAX_OFFSET_DEG, Math.min(MAX_OFFSET_DEG, rawOffset));

      const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : 0;
      const normalizedConfidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence; // той самий захист від шкали 0-100, що вже виправлено для калібрування камер
      const confidence = Math.max(0, Math.min(1, normalizedConfidence));

      return { sameScene: true, angularOffsetDeg: clampedOffset, confidence, reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null };
    } catch (err) {
      this.logger.warn(`Не удалось разобрать ответ vision-уточнения: ${(err as Error).message}`);
      return { sameScene: false, angularOffsetDeg: null, confidence: 0, reasoning: null };
    }
  }

  // Див. класс-коментар StreamAvailabilitySuggestion вище. Викликається ТІЛЬКИ з окремого циклу
  // (MonitoringService, кнопка на екрані калібрування) — ніколи з ScraperService/автоімпорту.
  async checkStreamAvailability(streamUrl: string, streamType: string): Promise<StreamAvailabilitySuggestion> {
    const videoId = streamType === 'YOUTUBE_LIVE' ? extractYoutubeVideoId(streamUrl) : null;

    if (!videoId) {
      return { checked: false, available: null, checkedVia: 'none', reason: 'Автоматическая проверка доступна только для YouTube-ссылок с id конкретного видео.' };
    }

    // Шаг 1: YouTube oEmbed — бесплатный, детерминированный, без ключа. 401/404 означает
    // "видео удалено/приватное/недоступно в этом регионе" — тот самый реальный случай, который
    // и вызвал этот запрос (см. doc/AUDIT-embed-bare-url-fix.md).
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const res = await axios.get(oembedUrl, { timeout: 10000, validateStatus: () => true });

      if (res.status === 200) {
        return { checked: true, available: true, checkedVia: 'oembed', reason: null };
      }
      if (res.status === 401 || res.status === 404) {
        return { checked: true, available: false, checkedVia: 'oembed', reason: `YouTube oEmbed вернул ${res.status} — видео удалено, приватное или недоступно.` };
      }
      // Неожиданный статус (не 200/401/404) — не считаем это надёжным сигналом, пробуем vision ниже.
    } catch (err) {
      this.logger.warn(`YouTube oEmbed check failed for video ${videoId}: ${(err as Error).message}`);
      // Сетевая ошибка самого oEmbed-запроса — не то же самое, что "видео недоступно"; пробуем vision ниже.
    }

    // Шаг 2: резервный слой — Grok vision на превью-картинке того же видео (та же модель, что
    // для автокалибровки). Не заменяет oEmbed, а дополняет его на случай сетевой ошибки самого
    // oEmbed-запроса выше.
    const apiKey = getApiKey();
    if (!apiKey) {
      return { checked: false, available: null, checkedVia: 'none', reason: 'oEmbed не дал однозначного ответа, а AI-провайдер не настроен для резервной проверки.' };
    }

    try {
      const imageUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getVisionModel(),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `На изображении — превью-картинка видео с YouTube. Отвечай СТРОГО в формате JSON, без markdown: {"looksUnavailable": boolean, "reasoning": string}. "looksUnavailable": true, только если картинка явно похожа на служебную заглушку YouTube (например, серый/чёрный фон, значок "видео недоступно", отсутствие реальной сцены) — не настоящий кадр трансляции/видео.`,
                },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          temperature: 0,
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const cleaned = text.replace(/```json|```/g, '').trim();
      let obj: any;
      try {
        obj = JSON.parse(cleaned);
      } catch {
        obj = {};
      }

      if (typeof obj.looksUnavailable !== 'boolean') {
        return { checked: false, available: null, checkedVia: 'none', reason: 'AI не смог однозначно определить доступность по превью.' };
      }

      return {
        checked: true,
        available: !obj.looksUnavailable,
        checkedVia: 'vision',
        reason: typeof obj.reasoning === 'string' ? obj.reasoning : null,
      };
    } catch (err) {
      this.logger.warn(`Vision availability check failed for video ${videoId}: ${(err as Error).message}`);
      return { checked: false, available: null, checkedVia: 'none', reason: `Ошибка обращения к AI: ${(err as Error).message}` };
    }
  }

  // Фільтр релевантності для YouTube-пошуку (див. doc/TZ-youtube-camera-discovery.md, П3) —
  // текстовий пошук дає багато шуму (новини/стріми/музика), на відміну від webcam.guru.ua, де
  // кожен запис на сторінці міста гарантовано камера. Свідомо безпечний фолбек "релевантно" при
  // відсутності ключа/помилці — краще пропустити зайвий елемент у чергу ревʼю (адмін відхилить
  // вручну), ніж мовчки відкинути справжню камеру через недоступність AI.
  async isLikelyCityCamera(title: string): Promise<boolean> {
    const apiKey = getApiKey();
    if (!apiKey) return true;

    try {
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getTextModel(),
          messages: [
            {
              role: 'user',
              content: `Название YouTube-видео похоже на реальную городскую веб-камеру (статичный вид улицы/площади/перекрёстка/двора в прямом эфире), а не на новости/игровой стрим/музыку/что-то другое?

Название: "${title}"

Ответь СТРОГО в формате JSON, без markdown: {"isLikelyCamera": boolean, "confidence": number, "reasoning": string}`,
            },
          ],
          temperature: 0,
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );

      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      const cleaned = text.replace(/```json|```/g, '').trim();
      let obj: any;
      try {
        obj = JSON.parse(cleaned);
      } catch {
        return true; // не удалось распарсить ответ — безопасный фолбек "релевантно"
      }

      return obj.isLikelyCamera !== false; // явное false — единственный случай отфильтровать
    } catch (err) {
      this.logger.warn(`isLikelyCityCamera check failed for "${title}": ${(err as Error).message}`);
      return true;
    }
  }

  // Пошук ОКРЕМИХ камер через Google (веб-пошук Grok, див. doc/AUDIT-google-web-search-cameras.md)
  // — для GoogleWebCameraSearchAdapter. Промпт явно просить конкретні СТОРІНКИ з трансляцією
  // (не сайти-каталоги — для тих є окремий searchAggregatorSites() нижче).
  async searchCameraPages(cityName: string, countryName: string = 'Украина'): Promise<{ url: string; title: string }[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    try {
      const res = await axios.post(
        `${getBaseUrl()}/responses`,
        {
          model: getWebSearchModel(),
          input: [
            {
              role: 'user',
              content: `Найди в интернете конкретные веб-страницы с ПРЯМОЙ онлайн-трансляцией с камеры видеонаблюдения в городе "${cityName}", ${countryName} — не сайты-каталоги/агрегаторы со списками многих камер (для них отдельный поиск), а именно отдельные страницы одной конкретной камеры (может быть на YouTube, во встроенном плеере, на сайте отеля/заведения и т.п.).

Ответь СТРОГО в формате JSON, без markdown-разметки: {"cameras": [{"url": string, "title": string}]} — максимум 15 результатов, только реально найденные через поиск ссылки, не выдуманные.`,
            },
          ],
          tools: [{ type: 'web_search' }],
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 },
      );

      const text = this.extractResponsesApiText(res.data);
      const cleaned = text.replace(/```json|```/g, '').trim();
      const obj = JSON.parse(cleaned);
      const cameras = Array.isArray(obj.cameras) ? obj.cameras : [];
      return cameras.filter((c: any) => typeof c.url === 'string' && typeof c.title === 'string');
    } catch (err) {
      this.logger.warn(`searchCameraPages web search failed for "${cityName}": ${(err as Error).message}`);
      return [];
    }
  }

  // Пошук САЙТІВ-АГРЕГАТОРІВ (каталогів камер) через Google (веб-пошук Grok) — див. запит
  // користувача: окрема вкладка в адмінці для цих результатів, не імпорт як камери.
  private buildAggregatorSearchPrompt(cityName: string, countryName: string): string {
    return `Найди в интернете сайты-каталоги/агрегаторы веб-камер, у которых есть список МНОГИХ камер города "${cityName}", ${countryName} (например, разделы городов на сайтах типа "веб-камеры онлайн", а не отдельные страницы одной камеры).

Ответь СТРОГО в формате JSON, без markdown-разметки: {"sites": [{"url": string, "title": string, "estimatedCameraCount": number | null}]} — estimatedCameraCount — приблизительное число камер этого города на сайте, если это можно понять из результатов поиска (например, из текста сниппета), иначе null (не выдумывай число). Максимум 10 сайтов, только реально найденные ссылки.`;
  }

  async searchAggregatorSites(cityName: string, countryName: string = 'Украина'): Promise<{ url: string; title: string; estimatedCameraCount: number | null }[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    try {
      const res = await axios.post(
        `${getBaseUrl()}/responses`,
        {
          model: getWebSearchModel(),
          input: [{ role: 'user', content: this.buildAggregatorSearchPrompt(cityName, countryName) }],
          tools: [{ type: 'web_search' }],
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 },
      );

      const text = this.extractResponsesApiText(res.data);
      const cleaned = text.replace(/```json|```/g, '').trim();
      const obj = JSON.parse(cleaned);
      const sites = Array.isArray(obj.sites) ? obj.sites : [];
      return sites
        .filter((s: any) => typeof s.url === 'string' && typeof s.title === 'string')
        .map((s: any) => ({ url: s.url, title: s.title, estimatedCameraCount: typeof s.estimatedCameraCount === 'number' ? s.estimatedCameraCount : null }));
    } catch (err) {
      this.logger.warn(`searchAggregatorSites web search failed for "${cityName}": ${(err as Error).message}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------------------
  // Batch API xAI (глибша переробка — за прямим запитом користувача, для фонових Grok-
  // викликів у парсері, doc/AUDIT-grok-batch-api.md). НЕ для авто-калібрування камер —
  // несумісно з інтерактивністю (типово до 24 годин на обробку, best-effort, не гарантовано).
  //
  // ⚠️ ЧЕСНО: структура ендпоінтів звірена з офіційною документацією xAI
  // (https://docs.x.ai/developers/advanced-api-usage/batch-api), без реального тестового
  // виклику (немає мережі в цій пісочниці) — той самий принцип, що вже застосований для
  // webcam.guru.ua/Windy/NYC TMC свого часу. Перед продакшеном варто перевірити один живий
  // виклик.
  // ---------------------------------------------------------------------------------------

  // ВАЖЛИВО (за прямим запитом користувача — попередня перевірка після подачі повністю
  // прибрана): раніше тут була `verifyBatchRequestCountWithRetries()` — навіть із кількома
  // спробами й паузами (сукупно ~6с) вона все одно хибно повідомляла про провал, бо реальне
  // вікно узгодженості на боці xAI виявилось довшим (реальний скріншот — той самий пакет
  // показував 10/50 у той самий момент, коли перевірка ще бачила невідповідність). Довіряємо
  // самому факту успішного створення batch і додавання запитів — реальний стан перевіряє вже
  // існуюча асинхронна інфраструктура опитування (processPendingBatches/
  // processPendingCalibrationBatches — і за cron, і при відкритті сторінки).

  // Подає ОДИН пакет запитів (по одному на кожне місто) до xAI Batch API. Повертає
  // xaiBatchId і мапу "batch_request_id -> контекст міста" для подальшої кореляції
  // результатів — саме цю мапу викликач (AggregatorDiscoveryService) зберігає в
  // GrokBatchJob.requestMap.
  async submitAggregatorSearchBatch(
    cities: { id: string; name: string; countryName: string }[],
  ): Promise<{ xaiBatchId: string; requestMap: Record<string, { cityId: string; cityName: string }> } | { error: string }> {
    const apiKey = getApiKey();
    if (!apiKey) return { error: 'Не настроен XAI_API_KEY (или GROK_API_KEY) — переменная окружения пуста.' };
    if (cities.length === 0) return { error: 'Список городов пуст.' };

    try {
      const createRes = await axios.post(
        `${getBaseUrl()}/batches`,
        { name: `aggregator-discovery-${Date.now()}` },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );
      const xaiBatchId: string = createRes.data?.id ?? createRes.data?.batch_id;
      if (!xaiBatchId) {
        return { error: `xAI вернул статус ${createRes.status}, но в ответе нет ни поля "id", ни "batch_id". Ответ: ${JSON.stringify(createRes.data).slice(0, 300)}` };
      }

      const requestMap: Record<string, { cityId: string; cityName: string }> = {};
      const batchRequests = cities.map((city, i) => {
        const batchRequestId = `city_${i}_${city.id}`;
        requestMap[batchRequestId] = { cityId: city.id, cityName: city.name };
        return {
          batch_request_id: batchRequestId,
          batch_request: {
            responses: {
              model: getWebSearchModel(),
              input: [{ role: 'user', content: this.buildAggregatorSearchPrompt(city.name, city.countryName) }],
              tools: [{ type: 'web_search' }],
            },
          },
        };
      });

      // ВАЖЛИВО (за прямим запитом користувача — прибрано попередню перевірку статусу
      // одразу після подачі): реальний скріншот показав, що навіть кілька спроб опитування
      // з паузами (сукупно ~6с) недостатньо — вікно узгодженості на боці xAI довше (пакет
      // показував 10/50 у той самий момент, коли перевірка ще бачила невідповідність).
      // Замість спроб вгадати правильну затримку — довіряємо самому факту успішного
      // створення batch і додавання запитів (обидва запити пройшли без винятку), а РЕАЛЬНИЙ
      // стан (скільки запитів справді додалось, чи завершились) перевіряє вже існуюча
      // асинхронна інфраструктура опитування (processPendingBatches — і за cron, і при
      // відкритті сторінки), для якої це й було спроєктовано із самого початку.
      await axios.post(
        `${getBaseUrl()}/batches/${xaiBatchId}/requests`,
        { batch_requests: batchRequests },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );

      return { xaiBatchId, requestMap };
    } catch (err) {
      const axiosErr = err as any;
      const detail = axiosErr?.response?.data ? JSON.stringify(axiosErr.response.data).slice(0, 300) : (err as Error).message;
      this.logger.warn(`Не удалось создать batch для поиска сайтов-агрегаторов: ${detail}`);
      return { error: `Ошибка запроса к xAI Batch API: ${detail}` };
    }
  }

  // Опитування статусу пачки — викликається періодично з cron (не при кожному запиті
  // користувача, немає такого запиту тут взагалі — це суто фонова операція).
  // ✅ ПІДТВЕРДЖЕНО реальним викликом (лог сервера, реальна відповідь xAI для завершеного
  // batch): { batch_id, name, create_time, expire_time, ..., state: { num_requests,
  // num_pending, num_success, num_error, num_cancelled } } — НІЯКОГО плоского поля "status"
  // немає взагалі, усі попередні здогадки (completed_count/request_count/status="completed")
  // були невірні. Готовність batch визначається через num_pending === 0 (більше нічого не
  // очікує обробки), НЕ через порівняння completedCount === totalCount (частина запитів
  // могла завершитись помилкою — num_error — і тоді num_success ніколи не дорівнюватиме
  // num_requests, попри те, що batch дійсно вже "готовий").
  async getBatchStatus(xaiBatchId: string): Promise<{ totalCount: number; completedCount: number; pendingCount: number; errorCount: number } | null> {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
      const res = await axios.get(`${getBaseUrl()}/batches/${xaiBatchId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const state = res.data?.state ?? {};
      return {
        totalCount: state.num_requests ?? 0,
        completedCount: state.num_success ?? 0,
        pendingCount: state.num_pending ?? 0,
        errorCount: state.num_error ?? 0,
      };
    } catch (err) {
      this.logger.warn(`Не удалось получить статус batch ${xaiBatchId}: ${(err as Error).message}`);
      return null;
    }
  }

  // Забирає результати завершеної пачки, розкладені по batch_request_id — виклик залишає
  // саме зіставлення "batch_request_id -> сайти" викликачу (AggregatorDiscoveryService), а
  // не намагається сам знати про City/AggregatorSiteCandidate (розділення відповідальності).
  async getBatchResults(xaiBatchId: string): Promise<Record<string, { url: string; title: string; estimatedCameraCount: number | null }[]>> {
    const apiKey = getApiKey();
    if (!apiKey) return {};

    const resultsByRequestId: Record<string, { url: string; title: string; estimatedCameraCount: number | null }[]> = {};

    try {
      let paginationToken: string | undefined;
      let rawSampleLogged = false;
      let totalItemsSeen = 0;
      // Захист від нескінченного циклу, якщо API поверне некоректний/зациклений
      // pagination_token — той самий принцип обережності, що вже застосований у П3.2
      // (бюджет часу парсера) — краще зупинитись із частковим результатом, ніж зависнути.
      for (let page = 0; page < 50; page++) {
        // ✅ ВИПРАВЛЕНО за реальним логом (GET /batches/{id}/requests повертає лише
        // "batch_request_metadata" — id/статус/час, БЕЗ жодного поля з фактичною відповіддю
        // AI взагалі). Правильний ендпоінт — /results (за конвенцією Python SDK
        // client.batch.list_batch_results()), не /requests.
        const res = await axios.get(`${getBaseUrl()}/batches/${xaiBatchId}/results`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: { limit: 100, ...(paginationToken ? { pagination_token: paginationToken } : {}) },
          timeout: REQUEST_TIMEOUT_MS,
        });

        if (!rawSampleLogged) {
          rawSampleLogged = true;
          this.logger.warn(`getBatchResults(${xaiBatchId}): сырой ответ /results (первые 800 символов): ${JSON.stringify(res.data).slice(0, 800)}`);
        }

        // ✅ ВИПРАВЛЕНО за реальним логом: справжній топ-рівень ключ — "results" (не
        // "succeeded"/"failed", як помилково передбачалось раніше).
        const items: any[] = res.data?.results ?? res.data?.succeeded ?? res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
        totalItemsSeen += items.length;
        for (const item of items) {
          const batchRequestId: string | undefined = item.batch_request_id ?? item.custom_id ?? item.id;
          if (!batchRequestId) continue;
          // ✅ ВИПРАВЛЕНО за реальним логом — Chat Completions формат
          // (batch_result.response.chat_get_completion.choices[0].message.content), не
          // Responses API формат.
          const text = this.extractBatchResultText(item);
          if (!text) continue;

          try {
            const cleaned = text.replace(/```json|```/g, '').trim();
            const obj = JSON.parse(cleaned);
            const sites = Array.isArray(obj.sites) ? obj.sites : [];
            resultsByRequestId[batchRequestId] = sites
              .filter((s: any) => typeof s.url === 'string' && typeof s.title === 'string')
              .map((s: any) => ({ url: s.url, title: s.title, estimatedCameraCount: typeof s.estimatedCameraCount === 'number' ? s.estimatedCameraCount : null }));
          } catch (parseErr) {
            this.logger.warn(`Не удалось разобрать результат batch-запроса ${batchRequestId}: ${(parseErr as Error).message}`);
            resultsByRequestId[batchRequestId] = [];
          }
        }

        paginationToken = res.data?.pagination_token ?? undefined;
        if (!paginationToken) break;
      }

      if (totalItemsSeen > 0 && Object.keys(resultsByRequestId).length === 0) {
        this.logger.warn(`getBatchResults(${xaiBatchId}): получено ${totalItemsSeen} элементов, но ни для одного не удалось извлечь batchRequestId или текст ответа — структура ответа отличается от ожидаемой, см. сырой лог выше.`);
      }
    } catch (err) {
      this.logger.warn(`Не удалось получить результаты batch ${xaiBatchId}: ${(err as Error).message}`);
    }

    return resultsByRequestId;
  }

  // ---------------------------------------------------------------------------------------
  // Batch API для групової верифікації камер (за прямим запитом користувача — розширення
  // GrokBatchJob на автокалібрування, doc/AUDIT-grok-batch-api.md, розділ "Оновлення").
  // ⚠️ ВАЖЛИВО: свідома зміна попереднього рішення — раніше явно зазначалось, що Batch API
  // несумісний з автокалібруванням через інтерактивність (типово до 24 годин, best-effort).
  // Це лишається правдою — але тепер це ДОДАТКОВИЙ, окремий шлях (не заміна синхронної
  // CamerasService.autoCalibrateBatch(), яка лишається без змін для швидкого, інтерактивного
  // випадку) — адмін свідомо обирає довше чекати заради економії 20-50% вартості.
  // ---------------------------------------------------------------------------------------

  // ⚠️ ЧЕСНО: точний формат мультимодального (текст+зображення) запиту ВСЕРЕДИНІ Batch API
  // не підтверджений офіційною документацією напряму (приклади batch-запитів, які вдалось
  // знайти, — лише текстові) — тут використана та сама структура content-частин
  // (text + image_url), що вже перевірена для звичайного /v1/chat/completions виклику
  // (suggestAzimuthFov), обгорнута в те саме поле "responses", що й для текстового
  // searchAggregatorSites вище. Перед продакшеном це — перший пункт для перевірки живим
  // викликом.
  // ВАЖЛИВО (реальний знайдений інцидент — фронтенд показав узагальнене "нет ключа API, нет
  // камер с доступным кадром, или ошибка запроса к xAI" замість конкретної причини — той
  // самий клас проблеми, що вже виправлявся для NycTmcAdapter, doc/AUDIT-nyctmc-adapter.md).
  // Тепер повертається явна причина (`reason`) замість голого null, щоб і сервер, і
  // адміністратор бачили ТОЧНО, що саме пішло не так.
  async submitAzimuthFovBatch(
    // citySlug ДОДАНО (§ той самий коментар, що біля suggestAzimuthFov() вище) — опційне, щоб
    // не ламати виклики, де citySlug ще не прокинуто.
    cameras: {
      id: string;
      name: string;
      streamUrl: string;
      streamType: string;
      lat: number;
      lng: number;
      azimuth: number;
      fovAngle: number;
      rangeMeters: number;
      lastAiCalibrationSuggestion?: any;
      citySlug?: string | null;
    }[],
  ): Promise<{ xaiBatchId: string; requestMap: Record<string, { cameraId: string }> } | { error: string }> {
    const apiKey = getApiKey();
    if (!apiKey) return { error: 'Не настроен XAI_API_KEY (или GROK_API_KEY) — переменная окружения пуста.' };
    if (cameras.length === 0) return { error: 'Список камер для калибровки пуст (нет камер со статусом ESTIMATED).' };

    // Тільки камери, для яких взагалі можна отримати кадр (той самий фільтр, що на початку
    // suggestAzimuthFov()) — немає сенсу подавати в пакет камеру, для якої заздалегідь відомо,
    // що зображення недоступне (HLS/IFRAME).
    const withImages = cameras
      .map((c) => ({
        camera: c,
        imageUrl: resolveImageUrl(c.streamType, c.streamUrl),
      }))
      .filter((x) => x.imageUrl != null);

    if (withImages.length === 0) {
      return {
        error: `Ни у одной из ${cameras.length} камер в выборке нет доступного кадра для анализа (все — HLS/IFRAME, автоматический захват кадра для этих типов не реализован, нужен headless-браузер) — см. doc/README.md, раздел про типы потоков.`,
      };
    }

    try {
      const createRes = await axios.post(
        `${getBaseUrl()}/batches`,
        { name: `camera-calibration-${Date.now()}` },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );
      const xaiBatchId: string = createRes.data?.id ?? createRes.data?.batch_id;
      if (!xaiBatchId) {
        return { error: `xAI вернул статус ${createRes.status}, но в ответе нет ни поля "id", ни "batch_id" — структура ответа отличается от ожидаемой. Ответ: ${JSON.stringify(createRes.data).slice(0, 300)}` };
      }

      const requestMap: Record<string, { cameraId: string }> = {};
      const batchRequests = await Promise.all(
        withImages.map(async ({ camera, imageUrl }, i) => {
          const batchRequestId = `cam_${i}_${camera.id}`;
          requestMap[batchRequestId] = { cameraId: camera.id };

          // ПРОРИВНЕ ПОКРАЩЕННЯ (за прямим запитом користувача) — той самий орієнтир по
          // дорозі з карти, що й у синхронному suggestAzimuthFov() вище, тепер і в
          // пакетному шляху. Конкурентно для всіх камер пачки одразу (Promise.all) — той
          // самий принцип, що вже застосований для самого батчу калібрування.
          let roadAzimuth: number | null = null;
          try {
            const heuristic = await this.azimuthHeuristic.guessForPoint(camera.lat, camera.lng, camera.citySlug);
            // 'cached' — той самий рівень довіри, що й 'heuristic', § коментар у
            // suggestAzimuthFov() вище.
            if (heuristic.source === 'heuristic' || heuristic.source === 'cached') roadAzimuth = heuristic.azimuth;
          } catch {
            // Не критично — просто не даємо AI цей орієнтир, якщо Overpass недоступний
          }

          return {
            batch_request_id: batchRequestId,
            batch_request: {
              responses: {
                model: getVisionModel(),
                // ВАЖЛИВО (реальний знайдений і виправлений інцидент — точна помилка від xAI:
                // "responses.input: data did not match any variant of untagged enum
                // ModelInput"): /v1/responses (Responses API) використовує ІНШІ назви частин
                // контенту, ніж /v1/chat/completions (де синхронний suggestAzimuthFov() вище
                // коректно використовує "text"/"image_url" з вкладеним {url}) — тут потрібно
                // "input_text"/"input_image", і "image_url" — ПРЯМА стрічка, не вкладений
                // об'єкт (підтверджено документацією OpenAI/xAI Responses API).
                input: [
                  {
                    role: 'user',
                    content: [
                      { type: 'input_text', text: buildAzimuthFovPrompt(camera.name, camera.lat, camera.lng, { azimuth: camera.azimuth, fovAngle: camera.fovAngle, rangeMeters: camera.rangeMeters }, roadAzimuth, camera.lastAiCalibrationSuggestion ?? null) },
                      { type: 'input_image', image_url: imageUrl },
                    ],
                  },
                ],
              },
            },
          };
        }),
      );

      // ВАЖЛИВО (за прямим запитом користувача — прибрано попередню перевірку статусу
      // одразу після подачі, той самий принцип, що для сайтів-агрегаторів вище): вікно
      // узгодженості на боці xAI виявилось довшим за будь-яку розумну синхронну затримку —
      // довіряємо самому факту успішного створення batch, реальний стан перевіряє вже
      // існуюча асинхронна інфраструктура опитування (processPendingCalibrationBatches).
      await axios.post(
        `${getBaseUrl()}/batches/${xaiBatchId}/requests`,
        { batch_requests: batchRequests },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS },
      );

      return { xaiBatchId, requestMap };
    } catch (err) {
      // Реальний знайдений інцидент — саме тут найімовірніше приховувалась справжня причина
      // (наприклад, реальна відповідь axios error.response.data з поясненням від xAI, якщо
      // batch-ендпоінт повернув 4xx/5xx) — раніше це логувалось на сервері, але фронтенд
      // бачив лише узагальнене повідомлення. Тепер повертаємо деталі й туди, й туди.
      const axiosErr = err as any;
      const detail = axiosErr?.response?.data ? JSON.stringify(axiosErr.response.data).slice(0, 300) : (err as Error).message;
      this.logger.warn(`Не удалось создать batch для калибровки камер: ${detail}`);
      return { error: `Ошибка запроса к xAI Batch API: ${detail}` };
    }
  }

  // Забирає результати завершеного batch калібрування — та сама валідація (діапазони
  // азимут/FOV/дальність), що вже застосована в parseAzimuthFovJson() для синхронного шляху,
  // щоб обидва шляхи довіряли AI однаково обережно, не по-різному.
  async getAzimuthFovBatchResults(xaiBatchId: string): Promise<Record<string, ParsedAzimuthFovResponse>> {
    const apiKey = getApiKey();
    if (!apiKey) return {};

    const resultsByRequestId: Record<string, ParsedAzimuthFovResponse> = {};

    try {
      let paginationToken: string | undefined;
      let totalItemsSeen = 0;
      let rawSampleLogged = false;
      for (let page = 0; page < 50; page++) {
        // ✅ ВИПРАВЛЕНО за реальним логом (GET /batches/{id}/requests повертає лише
        // "batch_request_metadata" — id/статус/час, БЕЗ жодного поля з фактичною відповіддю
        // AI взагалі). Python SDK xAI має ОКРЕМИЙ метод саме для результатів —
        // `client.batch.list_batch_results()` — REST-еквівалент, за конвенцією найменування
        // цього самого API, — GET /batches/{id}/results (не /requests).
        const res = await axios.get(`${getBaseUrl()}/batches/${xaiBatchId}/results`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: { limit: 100, ...(paginationToken ? { pagination_token: paginationToken } : {}) },
          timeout: REQUEST_TIMEOUT_MS,
        });

        // ⚠️ ЩЕ НЕ ПІДТВЕРДЖЕНО живим викликом — цей самий метод (реальний лог → фікс)
        // застосовується вдруге поспіль, тому логуємо сирий приклад знову, про всяк випадок,
        // якщо і ЦЕЙ здогад про структуру ("succeeded"/"failed"/"pagination_token", за
        // прикладом коду з документації Python SDK) виявиться неточним.
        if (!rawSampleLogged) {
          rawSampleLogged = true;
          this.logger.warn(`getAzimuthFovBatchResults(${xaiBatchId}): сырой ответ /results (первые 800 символов): ${JSON.stringify(res.data).slice(0, 800)}`);
        }

        // ✅ ВИПРАВЛЕНО за реальним логом: справжній топ-рівень ключ — "results" (не
        // "succeeded"/"failed", як помилково передбачалось раніше).
        const items: any[] = res.data?.results ?? res.data?.succeeded ?? res.data?.data ?? (Array.isArray(res.data) ? res.data : []);
        totalItemsSeen += items.length;

        for (const item of items) {
          const batchRequestId: string | undefined = item.batch_request_id ?? item.custom_id ?? item.id;
          if (!batchRequestId) continue;
          // ✅ ВИПРАВЛЕНО за реальним логом — Chat Completions формат
          // (batch_result.response.chat_get_completion.choices[0].message.content), не
          // Responses API формат.
          const text = this.extractBatchResultText(item);
          if (!text) continue;

          resultsByRequestId[batchRequestId] = this.parseAzimuthFovJson(text);
        }

        paginationToken = res.data?.pagination_token ?? undefined;
        if (!paginationToken) break;
      }

      if (totalItemsSeen > 0 && Object.keys(resultsByRequestId).length === 0) {
        this.logger.warn(`getAzimuthFovBatchResults(${xaiBatchId}): получено ${totalItemsSeen} элементов, но ни для одного не удалось извлечь batchRequestId или текст ответа — структура ответа отличается от ожидаемой, см. сырой лог выше.`);
      }
    } catch (err) {
      this.logger.warn(`Не удалось получить результаты batch калибровки ${xaiBatchId}: ${(err as Error).message}`);
    }

    return resultsByRequestId;
  }

  // Responses API (див. https://docs.x.ai/developers/tools/web-search) повертає структуру,
  // відмінну від /chat/completions — текст відповіді треба витягти з output-масиву, не з
  // choices[0].message.content.
  private extractResponsesApiText(data: any): string {
    if (typeof data?.output_text === 'string') return data.output_text;
    const outputs = Array.isArray(data?.output) ? data.output : [];
    for (const item of outputs) {
      const contents = Array.isArray(item?.content) ? item.content : [];
      for (const c of contents) {
        if (typeof c?.text === 'string') return c.text;
      }
    }
    return '';
  }

  // ✅ ПІДТВЕРДЖЕНО реальним викликом (лог сервера — GET /batches/{id}/results): справжня
  // структура результату — {results: [{batch_request_id, batch_result: {response:
  // {chat_get_completion: {choices: [{message: {content: "..."}}]}}}}]} — Chat Completions
  // формат (choices[0].message.content), НЕ Responses API формат (output_text), попри те, що
  // сам запит подавався через поле "responses". extractResponsesApiText() вище лишається без
  // змін для синхронного шляху (searchAggregatorSites() тощо, де реально повертається саме
  // Responses API формат) — тут окремий, спеціальний екстрактор саме під batch-результати.
  private extractBatchResultText(item: any): string {
    const content = item?.batch_result?.response?.chat_get_completion?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    // Про всяк випадок — та сама структура, але без вкладеності batch_result (якщо xAI колись
    // змінить обгортку) — і сам Responses API формат теж, якщо колись повернеться до нього.
    return this.extractResponsesApiText(item?.response ?? item?.result?.response ?? item?.batch_response?.responses ?? {});
  }

  private parseAzimuthFovJson(text: string): ParsedAzimuthFovResponse {
    const cleaned = text.replace(/```json|```/g, '').trim();
    let obj: any;
    try {
      obj = JSON.parse(cleaned);
    } catch {
      obj = {};
    }

    const rawAzimuth = obj.suggestedAzimuth;
    const rawFov = obj.suggestedFovAngle;
    const rawRange = obj.suggestedRangeMeters;
    const validAzimuth = typeof rawAzimuth === 'number' && rawAzimuth >= 0 && rawAzimuth < 360;
    const validFov = typeof rawFov === 'number' && rawFov >= 1 && rawFov <= 180;
    // Той самий діапазон, що вже прийнятий у DEFAULT_RANGE_BY_HINT (ScraperService) — від
    // ближнього двору (80м) до дальнього мосту/проспекту (500м); за межами — швидше помилка
    // моделі, ніж реальна оцінка.
    const validRange = typeof rawRange === 'number' && rawRange >= 20 && rawRange <= 1000;

    // ВАЖЛИВО (критичний реальний знайдений баг — підтверджено логом сервера, реальна
    // відповідь моделі: "confidence": 45): модель не завжди дотримується запитаної шкали
    // 0..1 — іноді повертає значення у шкалі 0..100 (як відсоток). Попередній код сліпо
    // обрізав БУДЬ-ЯКЕ значення ≥1 до рівно 1.0 через Math.min(1, ...) — тобто впевненість
    // 45% помилково трактувалась би як 100% і застосовувалась би автоматично. Тепер: якщо
    // сире значення > 1, спершу нормалізуємо як відсоток (ділимо на 100), і лише ПОТІМ
    // обрізаємо до [0,1] — так 45 стає 0.45 (правильно), а 100 стає 1.0 (теж правильно).
    const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : 0;
    const normalizedConfidence = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
    const confidence = validAzimuth || validFov || validRange ? Math.max(0, Math.min(1, normalizedConfidence)) : 0;

    return {
      suggestedAzimuth: validAzimuth ? rawAzimuth : null,
      suggestedFovAngle: validFov ? rawFov : null,
      suggestedRangeMeters: validRange ? rawRange : null,
      confidence,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null,
    };
  }

  // Модель иногда оборачивает JSON в ```json ... ``` несмотря на просьбу не делать этого —
  // защитно снимаем код-блок перед парсингом (тот же приём, что в ReceiptVerificationService).
  private parseAiJson(text: string): ParsedAiResponse {
    const cleaned = text.replace(/```json|```/g, '').trim();
    let obj: any;
    try {
      obj = JSON.parse(cleaned);
    } catch {
      obj = {};
    }

    // Координаты — только если обе присутствуют И являются реальными числами; модель может
    // прислать одну без другой по ошибке, тогда безопаснее считать, что координат нет вовсе,
    // чем работать с половиной пары.
    const rawLat = obj.suggestedLat;
    const rawLng = obj.suggestedLng;
    const hasValidCoords = typeof rawLat === 'number' && typeof rawLng === 'number' && Math.abs(rawLat) <= 90 && Math.abs(rawLng) <= 180;

    return {
      suggestedAddress: typeof obj.suggestedAddress === 'string' && obj.suggestedAddress.trim() ? obj.suggestedAddress.trim() : null,
      addressConfidence: typeof obj.addressConfidence === 'number' ? Math.max(0, Math.min(1, obj.addressConfidence)) : 0,
      suggestedLat: hasValidCoords ? rawLat : null,
      suggestedLng: hasValidCoords ? rawLng : null,
      coordinatesConfidence: hasValidCoords && typeof obj.coordinatesConfidence === 'number' ? Math.max(0, Math.min(1, obj.coordinatesConfidence)) : 0,
      isLikelyIndoor: obj.isLikelyIndoor === true,
      isLikelyNature: obj.isLikelyNature === true,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null,
    };
  }
}

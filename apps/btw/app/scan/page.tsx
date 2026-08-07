'use client';

// ПЕРЕНЕСЕНО з `app/page.tsx` на `app/scan/page.tsx` — за прямим запитом користувача
// («сверстать главное окно мини апп в стиле скрина - в рамках тз») відповідно до давно
// зафіксованого рішення `doc/TZ-btw-route-planning.md` §0/§2.4: головний екран тепер —
// планування маршруту (новий `app/page.tsx`), а сканування («обведи телефоном навколо себе»)
// стало ДРУГИМ екраном, доступним за кнопкою «Сканировать» з головного (не втрачено, просто
// не перший екран при відкритті мінідодатку). Єдина реальна зміна в цьому файлі — три рядки
// відносних імпортів нижче (додано ще один рівень `../`, бо файл переїхав на рівень глибше);
// вся інша логіка (сканування, локальний Worker, HUD, лог, мінікарта камери тощо) —
// скопійована 1:1, без жодної зміни поведінки.

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ensureBtwSession, fetchDevLocationOverride } from '../../lib/btwSession';
// За прямим запитом користувача — "запрашивать местоположение при входе в мини апп": позиція,
// визначена провайдером app/layout.tsx одразу при вході, тепер повторно використовується тут,
// щоб не запитувати геолокацію вдруге при тапі "Начать сканирование" (§ детальний розбір нижче,
// біля requestPermissions()).
import { useLocation } from '../../lib/locationContext';
import BtwRadar from '../../components/BtwRadar';
// За прямим запитом користувача — "добавить на экране отображения камеры мини-карту на 33%
// экрана с отображением азимута и сектора обзора этой камеры" (§ детальний розбір у самому
// компоненті).
import BtwCameraMiniMap from '../../components/BtwCameraMiniMap';
import { BtwLocalScanner, ScanSupersededError } from '../../lib/btwLocalScanner';
import type { LocalScanResult } from '../../lib/btwLocalScanner';
// За прямим запитом користувача — "между радар и HUD - Log, каждый запрос на сервер и каждый
// ответ отображай в этом логе, пиши время которое занял запрос и размер ответа" (§ networkLog.ts).
import { loggedFetch, subscribeNetworkLog, formatBytes, clearNetworkLog } from '../../lib/networkLog';
import type { NetworkLogEntry } from '../../lib/networkLog';
// За прямим запитом користувача — "переключаться сразу и кроме того кешировать на устройстве
// результат этого запроса от сессии к сессии при совпадении координат" (§ детальний розбір у
// btwCityCache.ts).
import { getMostRecentCitySlug, lookupCitySlugForCoords, rememberCitySlug } from '../../lib/btwCityCache';

// Beyond the Wall (BTW) — сканувальний екран, §3.1/§3.2 ТЗ (doc/BTW-tz.md).
//
// ⚠️ ЧЕСНО (повний перелік — doc/AUDIT-btw.md і новий doc/AUDIT-btw-radar-m1-m2.md): це
// MVP-версія клієнта з ДОДАНИМ (за прямим запитом користувача — "lets realize (b) the full
// spec as originally written") локальним шляхом сканування. НЕ реалізовано в цьому кроці:
// - Web Worker з геометричним рушієм і локальними тайлами (§4.7, §8.1) — ТЕПЕР Є
//   (workers/btw-scan.worker.ts + lib/btwLocalScanner.ts): якщо сервер має згенеровані тайли
//   для міста (getManifest() поверне layers != null), кожен тик сканує ЛОКАЛЬНО, без мережі.
//   Якщо тайлів немає (типовий випадок у цьому середовищі — генерація вимагає живого
//   Overpass+БД доступу поза цим сендбоксом) — код автоматично й непомітно для юзера
//   продовжує йти старим шляхом, POST /api/scan щотика, без жодної зміни поведінки.
// - У2 (комплементарний фільтр), У3 (snap до вулиці, на сервері й тепер локально), У4
//   (калібрування за кандидатом) — РЕАЛІЗОВАНІ. Vision-уточнення (У5) — реалізоване (кнопка
//   "Уточнить").
// - Магнітне схилення — використовується фіксоване наближення з /btw/manifest (не WMM).
// - Кільце-радар на Canvas (§3.1.2) — components/BtwRadar.tsx: статичний (без
//   requestAnimationFrame) Canvas 2D, поверх тих самих даних, що приходять із /btw/scan АБО
//   тепер із локального Worker'а (однакова форма відповіді в обох випадках). Сектори
//   малюються за справжнім cameraAzimuth (не наближенням).
// - Розмиття облич/номерів (§11.3), водяний знак (§11.3) — сервер поки що просто віддає
//   streamUrl напряму.
// - PMTiles (реальний контейнерний формат), Flatbush (реальний R-tree), z15-піраміда тайлів,
//   Copernicus DEM рельєф — усе це задокументовані спрощення локального шляху, див.
//   doc/AUDIT-btw-radar-m1-m2.md (коротко: звичайні файли + HTTP Range замість PMTiles,
//   лінійний скан з bbox-відсіканням замість Flatbush, один тайл на місто замість піраміди,
//   рельєф не враховується — усе через відсутність мережевого доступу/credentials у цьому
//   середовищі розробки, не архітектурне рішення).
// - Debug HUD (сирі покази сенсорів, snap-статус, лічильники каскаду фільтрів) — доданий
//   саме для М0-спайку на реальному пристрої, кнопка "HUD" у правому верхньому куті екрана
//   сканування.

// У4 ТЗ (§5) — той самий алгоритм, що вже протестований у apps/api/src/btw/btw-geometry.util.ts
// (10 юніт-тестів: computeHeadingBias/blendHeadingBias/applyHeadingBias) — окрема копія тут
// через відсутність спільного пакета між двома Next.js-застосунками (doc/AUDIT-btw.md).
function computeHeadingBias(candidateBearing: number, measuredHeading: number): number {
  return ((candidateBearing - measuredHeading + 540) % 360) - 180;
}
function blendHeadingBias(previousBias: number, newBias: number, decay = 0.3): number {
  return previousBias * (1 - decay) + newBias * decay;
}
function applyHeadingBias(measuredHeading: number, bias: number): number {
  return (measuredHeading + bias + 360) % 360;
}

// У2 ТЗ (§5) — той самий алгоритм, що вже протестований у btw-geometry.util.ts (8 юніт-тестів).
function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}
function circularMedianFilter(samples: number[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0];
  let best = samples[0];
  let bestSum = Infinity;
  for (const candidate of samples) {
    const sum = samples.reduce((acc, s) => acc + circularDistance(candidate, s), 0);
    if (sum < bestSum) {
      bestSum = sum;
      best = candidate;
    }
  }
  return best;
}
function complementaryFilterStep(prevHeading: number, gyroZDegPerSec: number, dtSeconds: number, magHeadingFiltered: number, alpha = 0.94): number {
  const gyroEstimate = (prevHeading + gyroZDegPerSec * dtSeconds + 360) % 360;
  const diff = ((magHeadingFiltered - gyroEstimate + 540) % 360) - 180;
  return (gyroEstimate + (1 - alpha) * diff + 360) % 360;
}

interface Candidate {
  cameraId: string;
  // За прямим запитом користувача — живий випадок "задвоилась камера" (дві картки кандидата з
  // однаковою дистанцією й однаковим текстом, неможливо було відрізнити на очах). Опційне —
  // може бути відсутнім у відповіді сервера/тайлах, згенерованих ДО цієї зміни (старий
  // CamerasTileEntry без name) — рендер картки нижче має захисний фолбек на цей випадок.
  cameraName?: string;
  distanceM: number;
  bearingToTarget: number;
  coverage: number;
  orientationFit: 'ALIGNED' | 'SIDE' | 'OPPOSING';
  score: number;
  // ВИПРАВЛЕНО — раніше клієнт наближав азимут камери через bearingToTarget (похибка до
  // fovAngle/2, реально спостережено ~84° розбіжності проти orientationFit на скріні
  // користувача). Тепер сервер віддає справжній cam.azimuth напряму (btw.service.ts).
  cameraAzimuth: number;
  // ДОДАНО — за прямим запитом користувача (міні-карта азимута/сектора огляду на
  // locked-екрані, components/BtwCameraMiniMap.tsx). Опційне з тієї самої причини, що й
  // cameraName вище — старий закешований локальний Worker-тайл (buildings.bin/cameras.json/
  // streets.json, § btwTileCache.ts) чи ще не оновлений сервер можуть віддати кандидата БЕЗ
  // цього поля; рендер нижче має захисний дефолт на цей випадок.
  fovAngle?: number;
}

// За прямим запитом користувача — debug-інформація з /btw/scan, потрібна для HUD під час
// М0-спайку на реальному пристрої (doc/AUDIT-btw.md).
interface ScanDebug {
  rawHeading: number;
  effectiveHeading: number;
  snapped: boolean;
  snappedTo: number | null;
  streetCandidatesFound: number;
  camerasInBbox: number;
  coneSurvivors: number;
  finalCandidates: number;
  headingUncertaintyDeg: number;
}

type Phase = 'intro' | 'requesting' | 'scanning' | 'locked' | 'error';

// ДОДАНО (аудит 2026-08-06, doc/AUDIT-btw-route-planning.md) — Next.js 14 App Router вимагає,
// щоб будь-який компонент, що викликає `useSearchParams()`, був обгорнутий у `<Suspense>` —
// інакше `next build` падає з "useSearchParams() should be wrapped in a suspense boundary" на
// цьому роуті (щойно з'явився новий виклик `useSearchParams()` нижче, §2.2 ТЗ, — раніше цей
// файл його взагалі не використовував). Обгортка тут суто механічна — уся реальна логіка й
// стан лишились у `BtwScanPageInner` без жодної зміни поведінки, `fallback={null}` навмисно
// (компонент і так має власні "Определяем позицию…"/loading-стани всередині, зайвий проміжний
// fallback тут був би зайвим морганням).
export default function BtwScanPage() {
  return (
    <Suspense fallback={null}>
      <BtwScanPageInner />
    </Suspense>
  );
}

function BtwScanPageInner() {
  // ДОДАНО — за прямим запитом користувача «полностью реализовать п 3 и п 4 по тз» (§2.2 ТЗ:
  // "Тап на «что впереди» ... может открыть уже существующий режим сканирования ... для этой
  // конкретной локации"): точка вздовж маршруту передається сюди через query-параметри
  // `?lat=&lng=&label=` (з app/page.tsx, режим "Сопровождение в поездке") — ЄДИНА точка
  // перетину зі старим головним екраном, як і зазначено в ТЗ.
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);
  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем через панель Log — GET /api/manifest?
  // city=kyiv надсилався НАВІТЬ коли dev-override підміняв координати на Нью-Йорк): раніше тут
  // узагалі не було стану — `scanner.init('kyiv')` викликався із захардкодженим рядком, повністю
  // ігноруючи `position`. Тепер місто визначається асинхронно від РЕАЛЬНОЇ (чи підміненої)
  // позиції через новий публічний ендпоінт `GET /btw/nearest-city` (§ детальний коментар біля
  // BtwService.nearestCity() — найближче місто за прямою відстанню до центру). `null` — ще не
  // визначено (початковий стан І стан під час самого запиту) — ефект нижче, що стартує
  // BtwLocalScanner, чекає на непорожнє значення, перш ніж узагалі братись за завантаження
  // тайлів (§ коментар біля useEffect нижче).
  const [scanCitySlug, setScanCitySlug] = useState<string | null>(null);
  // ДОДАНО (§ btwCityCache.ts) — "здогадка" з попередньої сесії на цьому пристрої, відома
  // СИНХРОННО вже на першому рендері (лінивий ініціалізатор useState викликається один раз, до
  // будь-яких ефектів) — саме вона дозволяє ефекту завантаження тайлів нижче стартувати ще ДО
  // того, як реальна GPS-позиція взагалі відома, замість чекати на неї (§ "переключаться сразу").
  const [speculativeCitySlug] = useState<string | null>(() => (typeof window !== 'undefined' ? getMostRecentCitySlug() : null));
  // Яке саме місто зараз завантажено/завантажується в localScannerRef — потрібно, щоб ефект
  // нижче відрізняв "нічого не змінилось, не чіпай" від "реальний scanCitySlug розійшовся зі
  // спекулятивною здогадкою — перезапускай для правильного міста".
  const loadedCitySlugRef = useRef<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // М2 ТЗ (doc/TZ-btw-side-reverse-view.md) — резервний рівень (SIDE+OPPOSING), схований за
  // замовчуванням. showFallback скидається на false при КОЖНОМУ скані, де знову з'явився
  // direct-кандидат (авто-перемикання назад, §4 ТЗ) — тому це саме useState, не useRef: зміна
  // мусить викликати ре-рендер кнопки/списку.
  const [fallbackCandidates, setFallbackCandidates] = useState<Candidate[]>([]);
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  // За прямим запитом користувача — стан для debug HUD (М0-спайк на реальному пристрої).
  const [scanDebug, setScanDebug] = useState<ScanDebug | null>(null);
  const [showHud, setShowHud] = useState(true);
  // §3.1.2 ТЗ — кільце-радар (components/BtwRadar.tsx). За замовчуванням увімкнено (це і є
  // основна запитана фіча), з можливістю сховати — той самий патерн перемикання, що вже HUD
  // нижче, для тих, хто хоче бачити відео без накладеної панелі.
  const [showRadar, setShowRadar] = useState(true);
  // За прямим запитом користувача — "между радар и HUD - Log, каждый запрос на сервер и каждый
  // ответ отображай в этом логе, пиши время которое занял запрос и размер ответа". За
  // замовчуванням увімкнено, як і showHud/showRadar вище — панель невелика (§ рендер нижче,
  // компактні рядки), не заважає відео, а користувачу, який щойно попросив цю фічу, найкорисніше
  // одразу побачити її результат, не шукаючи додаткову кнопку.
  const [showLog, setShowLog] = useState(true);
  const [logEntries, setLogEntries] = useState<NetworkLogEntry[]>([]);
  const [usedDevOverride, setUsedDevOverride] = useState(false);
  // ДОДАНО — вже визначена (чи ще визначається) позиція зі спільного провайдера
  // app/layout.tsx, запитана одразу при вході в мінідодаток (див. requestPermissions() нижче).
  const { location: sharedLocation, usedDevOverride: sharedUsedDevOverride } = useLocation();
  // ДОДАНО — §2.2 ТЗ, скан для конкретної точки маршруту (див. коментар біля useSearchParams
  // вище) — окремий від `usedDevOverride` прапорець/підпис, щоб не плутати "адмінська підміна
  // координат" із "навмисно відкрито для ось цієї точки на маршруті".
  const [routeOverrideLabel, setRouteOverrideLabel] = useState<string | null>(null);
  const [lockedCandidate, setLockedCandidate] = useState<Candidate | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  // ВИПРАВЛЕНО (за прямим запитом користувача — "при встречном ракурсе нет видео с камеры",
  // діагностика показала: раніше <img> просто мовчки не завантажувалась, без жодного
  // повідомлення — користувач не міг відрізнити "камера справді недоступна" від "щось зламалось
  // технічно"). Можливі реальні причини збою: тип потоку не MJPEG_SNAPSHOT (проксі
  // /btw/thumb-image підтримує лише його — див. коментар у BtwService.fetchThumbImage), збій
  // VPN/проксі, чи камера все одно заблокувала навіть проксі-IP.
  const [thumbLoadFailed, setThumbLoadFailed] = useState(false);
  // ВИПРАВЛЕНО (за прямим запитом користувача — "в основном это камеры которые отдают поток
  // периодических снимков - в админке мы уже решали эту проблему"): раніше <img src={thumbUrl}>
  // запитувався ОДИН РАЗ при заході в locked-фазу й більше ніколи — для камери, що сама себе
  // оновлює десь раз на ~2с (NYC DOT, nyctmc.adapter.ts), це давало один-єдиний (можливо,
  // застарілий на момент показу) кадр назавжди. Той самий підхід, що вже працює в адмінці
  // (apps/admin/app/embed/[id]/page.tsx — snapshotRefreshTick, 3000мс, cache-bust `_t=`):
  // періодично міняємо query-параметр в src, змушуючи браузер перезапитати /btw/thumb-image
  // (який тепер сам теж додає cache-bust до запиту ДО камери, див. btw.service.ts).
  const [thumbRefreshTick, setThumbRefreshTick] = useState(0);
  // За прямим запитом користувача ("нужно сделать подсказки снизу кликабельными") — видимий
  // стан тапу: яка саме картка зараз вантажиться (disabled + спінер) і людський текст
  // помилки, якщо /thumb повернув не-200 — раніше тап просто нічого не показував.
  const [lockingCameraId, setLockingCameraId] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  // ЗАМІНЕНО (за прямим запитом користувача — "заменить прозрачность (рентген) на
  // контрастность"): раніше цей повзунок керував `opacity` кадру камери, блендованого поверх
  // повноекранного відео власної камери користувача (mixBlendMode:'screen' — "рентген"-ефект).
  // Тепер locked-екран перебудований на звичайний вертикальний макет (§ детальний коментар
  // біля JSX нижче — назва камери зверху, кадр камери на 50% екрана, міні-карта на 33%), і
  // повзунок керує CSS `filter: contrast()` самого кадру камери — 100% = без змін, менше =
  // тьмяніше/пласкіше, більше = різкіше — практичніша штука для розбору деталей у
  // темному/малоконтрастному кадрі камери, ніж просте затемнення прозорістю.
  const [xrayContrast, setXrayContrast] = useState(100);
  // У5 ТЗ — стан vision-уточнення: клієнтський cooldown-таймер (додатково до серверного
  // rate-limit, який є реальною точкою контролю — клієнтський лише для UX, щоб не показувати
  // кнопку як активну, коли запит однаково буде відхилено).
  const [refineStatus, setRefineStatus] = useState<'idle' | 'loading' | 'cooldown'>('idle');
  const [refineMessage, setRefineMessage] = useState<string | null>(null);
  const lastRefineAtRef = useRef<number>(0);

  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем на живому пристрої — "подмена координат
  // не работает и телеметрии нет"): раніше тут НІКОЛИ не було реального логіну — усі виклики
  // нижче (`/api/dev-location-override`, `/api/scan`, `/api/telemetry`, ...) покладались лише
  // на `credentials: 'include'`, а кукі `session` нізвідки було взятись. На реальному
  // пристрої (адмінка й цей mini-app — РІЗНІ домени) це означало: усі захищені запити мовчки
  // падали 401, override не застосовувався (тихий фолбек на реальний GPS), telemetry ніколи не
  // накопичувалась, а /api/scan повертав !res.ok, що на екрані виглядає як "кандидатів немає".
  // ensureBtwSession() (тепер у ../lib/btwSession.ts — спільний і для /map, за наступним прямим
  // запитом користувача) реально логінить через Telegram.WebApp.initData (HMAC-перевірка на
  // сервері — apps/api/src/auth/telegram-verify.util.ts::verifyTelegramWebAppInitData).

  // За прямим запитом користувача — коректна ініціалізація Telegram WebApp SDK (раніше лише
  // підключався скрипт тегом <script>, але ніколи не викликались ready()/expand() — без цього
  // WebApp може поводитись неочікувано: неправильний viewport, "білий екран" старту тощо).
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    // Розігріваємо логін одразу при монтуванні (не чекаємо тапу користувача по кнопці "старт")
    // — до моменту, коли requestPermissions() реально знадобиться сесія, запит найімовірніше
    // вже завершиться. requestPermissions() однаково await'ить той самий проміс нижче, тому
    // навіть якщо ні — коректність не постраждає, лише трохи більша затримка старту.
    ensureBtwSession();
  }, [ensureBtwSession]);

  // За прямим запитом користувача — надсилаємо "хвіст" накопиченої телеметрії (менше 10
  // сканів, що не встигли надіслатись періодично) при прихованні вкладки чи закритті
  // застосунку — надійніше, ніж намагатись зловити кожну можливу точку виходу з UI окремо
  // (exitLock повертає лише до сканування, не є справжнім кінцем сесії).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sendTelemetry();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sendTelemetry();
    };
  }, []);

  // ВИПРАВЛЕНО (реальний збій `next build` на Vercel, знайдений користувачем: "Cannot assign
  // to 'current' because it is a read-only property") — `useRef<HTMLVideoElement>(null)` з
  // ЯВНИМ типовим аргументом БЕЗ `| null` потрапляє під overload `useRef<T>(initialValue: T |
  // null): RefObject<T>` (не `MutableRefObject<T>`), тож `.current` типізується як read-only.
  // Це не проявлялось локально (проєкт тут ніколи не проганявся через реальний `tsc`/`next
  // build`, лише ізольовані ручні перевірки), а `attachVideoRef` нижче навмисно й далі
  // ПРИСВОЮЄ `videoRef.current = el` (callback-ref патерн, § коментар нижче) — потрібен саме
  // mutable ref. `HTMLVideoElement | null` як явний типовий аргумент відповідає натомість
  // overload `useRef<T>(initialValue: T): MutableRefObject<T>`, де T вже сам включає `null`.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // ВИПРАВЛЕНО (реальний баг, знайдений під час перебудови locked-екрана вище — § "добавить
  // мини-карту/изображение камеры 50%"): `getUserMedia()` у requestPermissions() викликає
  // `videoRef.current.srcObject = stream` у ФАЗІ 'requesting' — а `<video>`-елемент НІКОЛИ не
  // рендериться в цій фазі (лише в 'scanning'/'locked', § JSX нижче), тож `videoRef.current`
  // на той момент завжди `null`, і присвоєння мовчки пропускалось (`if (videoRef.current)`).
  // Коли фаза пізніше переходить у 'scanning' і `<video>` нарешті монтується — НІХТО повторно
  // не встановлює йому `srcObject`, тож picture-in-picture власної камери (і раніше повноекранне
  // відео) фактично був порожнім/чорним ВЕСЬ час, попри `hasCamera === true`. Зберігаємо сам
  // MediaStream окремо (він переживає розмонтування DOM-елемента) і прикріплюємо його заново
  // через callback-ref (attachVideoRef нижче) щоразу, коли `<video>` реально монтується.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const attachVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && mediaStreamRef.current && el.srcObject !== mediaStreamRef.current) {
      el.srcObject = mediaStreamRef.current;
      el.play().catch(() => {}); // best-effort — autoplay-обмеження тут не мають значення, той самий muted+playsInline елемент, що вже грав раніше
    }
  }, []);
  const headingSamplesRef = useRef<number[]>([]);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef = useRef<{ heading: number; lat: number; lng: number } | null>(null);
  // ВИПРАВЛЕНО (за прямим запитом користувача — "слишком долго подтягиваются камеры (до пяти
  // минут)") — див. розгорнутий коментар біля setInterval() нижче: захист від накопичення
  // ПЕРЕКРИТИХ тиков сканування, якщо один тик забарився.
  const scanInFlightRef = useRef(false);
  // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "нужно сделать подсказки снизу
  // кликабельными") — тут зберігаємо САМЕ ТУ цільову точку, яку /btw/scan щойно порахував
  // (тепер приходить у result.target), щоб handleLock() передавав її в /btw/thumb замість
  // власної GPS-позиції користувача (детальний розбір — btw.service.ts::ScanResult).
  const scanTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  // §8.1/§4.7.5 ТЗ — локальний Worker-сканер. Ref (не useState) для самого інстансу — той
  // самий принцип, що вже headingBiasRef/gyroZRef вище (нема сенсу в ре-рендері при кожній
  // внутрішній зміні), а localScannerReady — окремий useState, бо ВІД нього залежить, який
  // саме код виконує тик сканування нижче (реальна гілка поведінки, має тригерити ре-рендер
  // ефекту).
  const localScannerRef = useRef<BtwLocalScanner | null>(null);
  const [localScannerReady, setLocalScannerReady] = useState(false);
  // За прямим запитом користувача — визначення міста від позиції (§ scanCitySlug вище) МАЄ
  // спрацювати лише ОДИН РАЗ за сесію, при першому відомому `position`, а не на КОЖЕН новий
  // GPS-фікс (watchPosition оновлює position регулярно, поки триває сканування).
  const cityResolveStartedRef = useRef(false);
  // За прямим запитом користувача — реальне трекування лічильників телеметрії сесії (раніше
  // ендпоінт /btw/telemetry існував на сервері, але клієнт його жодного разу не викликав!).
  // М3 ТЗ (doc/TZ-btw-side-reverse-view.md §7) — доданo fallbackOffered/fallbackUsed для
  // conversion rate (за прямим запитом користувача — раніше цих полів не було в
  // BtwTelemetryEvent взагалі).
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "нужно больше полей телеметрии", під час
  // діагностики "кандидатов то находит то не находит") — scanErrors і три *Last-поля. Раніше
  // НЕВДАЛІ спроби скана взагалі ніде не рахувались — з адмінки неможливо було відрізнити
  // "камер немає в цьому напрямку" від "запит просто впав" (мережа/5xx).
  const telemetryRef = useRef({
    scans: 0,
    withCandidates: 0,
    locks: 0,
    snapUsed: false,
    fallbackOffered: 0,
    fallbackUsed: 0,
    scanErrors: 0,
    camerasInBboxLast: 0,
    coneSurvivorsLast: 0,
    streetCandidatesFoundLast: 0,
  });
  // У4 ТЗ (§5) — "калибровка по кандидату". Свідомо client-side, useRef (не useState) — це
  // "сессия" за задумом ТЗ (ефемерний стан, зникає при перезавантаженні застосунку), і не
  // потребує ре-рендеру щоразу при оновленні (лише впливає на майбутні виклики /api/scan).
  // Формули (computeHeadingBias/blendHeadingBias/applyHeadingBias) — той самий алгоритм, що
  // вже реально протестований у apps/api/src/btw/btw-geometry.util.ts (10 юніт-тестів) —
  // окремі копії тут через відсутність спільного @btw/geometry-пакета між двома Next.js-
  // застосунками (див. doc/AUDIT-btw.md).
  const headingBiasRef = useRef(0);
  // ВИПРАВЛЕНО (за прямим запитом користувача, під час діагностики "мало кандидатов" з
  // "Поправка (У4/У5): -96°" на скріншоті) — ПРИЧИНА: калібрування У4 порівнює РЕАЛЬНИЙ азимут
  // компаса з тим, куди "мав би" дивитись телефон до кандидата — а при dev-подмене координат
  // (GPS підмінено, компас — НІ, свідомо, див. коментар вище про приватність) ці два світи не
  // пов'язані: людина фізично стоїть десь-інде, а не там, де підмінена точка. Один тап "Захватить"
  // під час такого тестування — і калібрування "вивчає" повністю сміттєвий зсув (тут -96°), який
  // потім псує ВСІ наступні скани цієї сесії. Це не баг самого алгоритму (в реальному
  // використанні без підміни GPS такого розсинхрону немає) — просто дев-тестування навмисно
  // ламає одну з його вихідних передумов. Кнопка "Сбросить калибровку" нижче — щоб не
  // перезапускати весь застосунок заради цього. biasResetTick — лише щоб форсувати ре-рендер
  // (сам headingBiasRef — навмисно НЕ useState, див. коментар вище), бо HUD читає
  // headingBiasRef.current напряму.
  const [biasResetTick, setBiasResetTick] = useState(0);
  function resetCalibration() {
    headingBiasRef.current = 0;
    setBiasResetTick((v) => v + 1);
  }
  // У2 ТЗ — стан комплементарного фільтра. gyroZRef оновлюється окремим слухачем
  // 'devicemotion' (readGyroZ нижче), lastFilterTsRef потрібен для обчислення dt між
  // кроками (гироскоп дає кутову швидкість, °/с — потрібен реальний час між вимірами, щоб
  // проінтегрувати її в кут).
  const gyroZRef = useRef(0);
  const filteredHeadingRef = useRef<number | null>(null);
  const lastFilterTsRef = useRef<number | null>(null);
  const hasGyroRef = useRef(false);

  // §8.2 ТЗ — порядок дозволів: пояснення -> кнопка -> геолокація -> орієнтація -> камера.
  // Будь-яка відмова -> деградація, не блокування (§8.2, §3.2).
  const requestPermissions = useCallback(async () => {
    setPhase('requesting');
    setErrorMessage(null);

    // Гарантуємо, що сесія (якщо вона взагалі можлива — див. ensureBtwSession вище) уже
    // встановлена ДО першого захищеного запиту нижче, а не просто сподіваємось, що встигла
    // фонова спроба з mount-ефекту.
    await ensureBtwSession();

    // 1. Геолокація — за прямим запитом користувача, спершу перевіряємо, чи є для ЦЬОГО
    // telegram-юзера серверна підміна (дебаг-режим, /admin/btw-dev-tools в адмінці). Той
    // самий підхід, що GET /auth/dev-accounts — викликається БЕЗУМОВНО, сервер сам вирішує,
    // повернути щось чи null (404 у продакшені per DEV_AUTO_LOGIN — тут просто трактуємо як
    // "немає підміни", не як помилку).
    let usedOverride = false;

    // §2.2 ТЗ — точка з маршруту (query-параметри `?lat=&lng=&label=`) має ВИЩИЙ пріоритет за
    // адмінську dev-подмену нижче: якщо користувач явно тапнув "Скан" на конкретній точці
    // вздовж маршруту (app/page.tsx, "Сопровождение в поездке"), саме її й треба показати,
    // а не випадково активну dev-подмену координат.
    //
    // ВИПРАВЛЕНО — живий баг, знайдений користувачем через скріншот Log-панелі (HUD показував
    // "GPS: 0.00000, 0.00000", лейбл "точка на маршруте", і подальший `/api/nearest-city`
    // впевнено обирав географічно випадкове "найближче" місто за (0,0)). Причина: коли `/scan`
    // відкривають БЕЗ query-параметрів `lat`/`lng` узагалі (звичайний прямий вхід у сканер, не
    // через "Сопровождение в поездке"), `searchParams?.get('lat')` повертає `null`, а
    // `Number(null) === 0` (НЕ NaN!) — тож `Number.isFinite(routeLat)` хибно повертав `true`
    // для відсутнього параметра, і ця гілка ЗАВЖДИ спрацьовувала з (0,0) замість того, щоб
    // пропустити перевірку і дати шанс dev-подміні/реальній геолокації нижче. Тепер явно
    // перевіряємо, що обидва raw-рядки СПРАВДІ присутні (не `null`), перш ніж парсити їх у
    // число — відсутній параметр більше не маскується під "точку маршруту (0,0)".
    const routeLatRaw = searchParams?.get('lat') ?? null;
    const routeLngRaw = searchParams?.get('lng') ?? null;
    const routeLat = routeLatRaw !== null ? Number(routeLatRaw) : NaN;
    const routeLng = routeLngRaw !== null ? Number(routeLngRaw) : NaN;
    if (routeLatRaw !== null && routeLngRaw !== null && Number.isFinite(routeLat) && Number.isFinite(routeLng)) {
      setPosition({ lat: routeLat, lng: routeLng, accuracyM: 5 });
      setRouteOverrideLabel(searchParams?.get('label') || 'точка на маршруте');
      usedOverride = true;
    }

    // ДОДАНО — за прямим запитом користувача «поскольку весь роутинг и сканирование начинается
    // с определения местоположения - запрашивать местоположение при входе в мини апп»: якщо
    // спільний провайдер (app/layout.tsx) уже встиг визначити позицію ДО цього кліка (типовий
    // випадок — він запускається одразу при вході, задовго до "Начать сканирование"), не
    // питаємо геолокацію вдруге — просто переносимо вже готовий результат сюди. Для dev-
    // override поведінка ідентична до гілки нижче (жодного geolocation/watchPosition виклику).
    // Для реальної позиції — додатково підписуємось на watchPosition тут-таки, щоб зберегти
    // живе оновлення під час сканування, як і раніше.
    if (!usedOverride && sharedLocation != null) {
      setPosition({ lat: sharedLocation.lat, lng: sharedLocation.lng, accuracyM: sharedUsedDevOverride ? 5 : 50 });
      if (sharedUsedDevOverride) setUsedDevOverride(true);
      usedOverride = true;
      if (!sharedUsedDevOverride) {
        navigator.geolocation.watchPosition(
          (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
          () => {},
          { enableHighAccuracy: true },
        );
      }
    }

    if (!usedOverride) {
      const override = await fetchDevLocationOverride();
      if (override != null) {
        // Підміна є — використовуємо ЇЇ, не реальний navigator.geolocation взагалі, і не
        // підписуємось на watchPosition (інакше реальний GPS одразу "перебʼє" підмінену
        // точку першим-таки оновленням).
        setPosition({ lat: override.lat, lng: override.lng, accuracyM: 5 });
        setUsedDevOverride(true);
        usedOverride = true;
      }
    }

    if (!usedOverride) {
      try {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy });
              resolve();
            },
            () => reject(new Error('geolocation denied')),
            { enableHighAccuracy: true, timeout: 8000 },
          );
        });
        navigator.geolocation.watchPosition(
          (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
          () => {},
          { enableHighAccuracy: true },
        );
      } catch {
        setErrorMessage('Геолокация недоступна — сканирование невозможно без неё.');
        setPhase('error');
        return;
      }
    }

    // 2. Орієнтація (компас) — цепочка фолбеків §У1 ТЗ, спрощено: без Telegram.WebApp
    // DeviceOrientation SDK (потребує реального TMA-контексту, недоступного для тестування
    // тут) — одразу W3C deviceorientationabsolute/deviceorientation.
    const w = window as any;
    if (typeof w.DeviceOrientationEvent?.requestPermission === 'function') {
      // iOS — обов'язково по прямому жесту користувача (саме зараз, у цьому обробнику).
      try {
        const result = await w.DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') throw new Error('denied');
      } catch {
        // Немає компаса — переходимо в режим "ручного наведення" (§У1, п.4): показуємо
        // кандидатів без прив'язки до реального напрямку, користувач гортає сам.
      }
    }
    window.addEventListener('deviceorientationabsolute', handleOrientation as any, true);
    window.addEventListener('deviceorientation', handleOrientation as any, true);
    // У2 ТЗ — гироскоп (кутова швидкість) для комплементарного фільтра. Той самий iOS-
    // жест-гейт, що й для DeviceOrientation вище, стосується і DeviceMotionEvent — обидва
    // запитуються в одному й тому самому обробнику кліку (той самий прямий жест
    // користувача покриває обидва дозволи на iOS).
    if (typeof w.DeviceMotionEvent?.requestPermission === 'function') {
      try {
        await w.DeviceMotionEvent.requestPermission();
      } catch {
        // немає гироскопа -> handleOrientation() коректно працює без нього (fallback на
        // просто відфільтрований магнітометр, без фьюжна)
      }
    }
    window.addEventListener('devicemotion', readGyroZ as any, true);

    // 3. Камера телефону (не блокує — §3.2, фолбек-режим обов'язковий)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      // ВИПРАВЛЕНО (§ детальний коментар біля mediaStreamRef/attachVideoRef вище) — зберігаємо
      // сам stream окремо, бо `<video>` ще НЕ змонтований у цій фазі ('requesting');
      // `videoRef.current` тут майже завжди `null`, реальне прикріплення робить callback-ref
      // (attachVideoRef), коли елемент нарешті з'являється у 'scanning'/'locked'.
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCamera(true);
    } catch {
      setHasCamera(false); // §3.2 — фолбек без відео, радар/список і далі працюють
    }

    // §4.1 ТЗ — "Telegram.WebApp.lockOrientation() в портрет — інакше пересчёт осей при
    // повороті ломает азимут". Best-effort — не всі клієнти/версії SDK мають цей метод.
    try {
      (window as any).Telegram?.WebApp?.lockOrientation?.();
    } catch {
      // не критично — просто немає гарантії проти повороту екрана на цьому клієнті
    }

    setPhase('scanning');
  }, [ensureBtwSession, searchParams, sharedLocation, sharedUsedDevOverride]);

  function handleOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
    const raw = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
    if (raw == null) return;

    // Крок 1 (§У2 ТЗ) — медіанний фільтр по вікну 5 відліків проти одиничних викидів
    // магнітометра (арматура, трамвайні лінії тощо — та сама причина, що ТЗ описує в §5).
    const samples = headingSamplesRef.current;
    samples.push(raw);
    if (samples.length > 5) samples.shift();
    const magFiltered = circularMedianFilter(samples);

    // Крок 2 (§У2 ТЗ) — комплементарний фільтр: якщо гироскоп реально дає дані
    // (hasGyroRef, встановлюється в readGyroZ нижче), інтегруємо його швидку оцінку й
    // коригуємо повільною поправкою від магнітометра. ЯКЩО гироскопа немає (не всі
    // пристрої/браузери це підтримують) — коректний fallback: просто беремо
    // відфільтрований магнітометр напряму, без фьюжна (не крашимось, не показуємо
    // сирий/непотрібний шум).
    const now = performance.now();
    let fused: number;
    if (hasGyroRef.current && filteredHeadingRef.current != null && lastFilterTsRef.current != null) {
      const dt = (now - lastFilterTsRef.current) / 1000;
      fused = complementaryFilterStep(filteredHeadingRef.current, gyroZRef.current, dt, magFiltered);
    } else {
      fused = magFiltered;
    }
    filteredHeadingRef.current = fused;
    lastFilterTsRef.current = now;
    setHeading(fused);
  }

  // У2 ТЗ — читання гироскопа (кутова швидкість навколо вертикальної осі, °/с). ⚠️ ЧЕСНО:
  // `rotationRate.alpha` — це швидкість навколо Z-осі ПРИСТРОЮ, що коректно відповідає
  // компасному azimuth ЛИШЕ коли телефон тримають вертикально в портретній орієнтації (саме
  // тому ТЗ вимагає `Telegram.WebApp.lockOrientation()` в портрет, §4.1) — не перевірено на
  // реальному пристрої, чи API взагалі повертає стабільні значення в Telegram WebView (той
  // самий М0-спайк, doc/AUDIT-btw.md).
  function readGyroZ(e: DeviceMotionEvent) {
    const rotationRate = (e as any).rotationRate;
    if (rotationRate?.alpha == null) return;
    hasGyroRef.current = true;
    gyroZRef.current = rotationRate.alpha;
  }

  // ВИПРАВЛЕНО (реальний живий баг, знайдений користувачем через панель Log — § детальний
  // коментар біля scanCitySlug/cityResolveStartedRef вище): раніше тут викликався
  // `scanner.init('kyiv')` із захардкодженим рядком, повністю ігноруючи фактичну (чи
  // підмінену через dev-tools) позицію користувача — підміна на Нью-Йорк, а мінідодаток
  // однаково просив тайли Києва, і локальний Worker геометрично комбінував будівлі/вулиці
  // КИЄВА з GPS-координатами НЬЮ-ЙОРКА, структурно не здатний знайти жодного кандидата.
  // Визначаємо citySlug асинхронно (§ ефект нижче, GET /btw/nearest-city) від реальної
  // позиції, щойно вона стає відомою — цей ефект просто ЧЕКАЄ на `scanCitySlug != null`
  // (додано в масив залежностей), перш ніж узагалі братись за завантаження тайлів.
  useEffect(() => {
    if (position == null) return;
    if (cityResolveStartedRef.current) return; // вже запитали (чи в польоті, чи вже отримали) цього сеансу — watchPosition оновлює position часто, повторний запит на кожен фікс не потрібен
    cityResolveStartedRef.current = true;

    // ДОДАНО (§ btwCityCache.ts, за прямим запитом користувача — "кешировать ... результат
    // этого запроса от сессии к сессии при совпадении координат"): якщо ці самі (округлені)
    // координати вже зустрічались на цьому пристрої раніше — результат nearest-city можна
    // віддати МИТТЄВО, синхронно, без жодного мережевого запиту взагалі (не просто швидше —
    // повністю усуває цей запит із критичного шляху до готовності локального сканера).
    const cachedSlug = lookupCitySlugForCoords(position.lat, position.lng);
    if (cachedSlug != null) {
      setScanCitySlug(cachedSlug);
      return;
    }

    (async () => {
      try {
        const params = new URLSearchParams({ lat: String(position.lat), lng: String(position.lng) });
        const res = await loggedFetch(`/api/nearest-city?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { slug: string };
        setScanCitySlug(data.slug);
        rememberCitySlug(position.lat, position.lng, data.slug); // наступного разу з тими самими координатами — миттєвий cache hit вище, без мережі
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[BtwScanPage] nearest-city failed, falling back to "kyiv":', err);
        // Чесний фолбек — той самий дефолт, що вже BtwController::getManifest() застосовує
        // (`@Query('city') city ?? 'kyiv'`) — краще спробувати щось (навіть імовірно неправильне
        // місто), ніж НАЗАВЖДИ лишити локальний шлях вимкненим через один невдалий HTTP-запит.
        setScanCitySlug('kyiv');
      }
    })();
  }, [position]);

  // §8.1/§4.7.5 ТЗ — спроба ініціалізувати локальний Worker-сканер, для МІСТА, визначеного
  // ефектом вище (`scanCitySlug`) — БІЛЬШЕ НЕ захардкоджений рядок (§ детальний коментар там
  // же). init() сам ловить БУДЬ-ЯКУ помилку (немає тайлів для міста, мережа, Worker не
  // підтримується) і повертає false — саме тому нижче можна безумовно покладатись на
  // localScannerReady, не обробляючи різні "чому саме не готово" тут.
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "почему при старте так медленно ищет
  // кандидатов сначала"): раніше цей ефект стартував завантаження ЛИШЕ при `phase ===
  // 'scanning'` — тобто ПІСЛЯ того, як requestPermissions() уже послідовно пройшла геолокацію
  // (getCurrentPosition — до 8с сам таймаут!), дозвіл на орієнтацію/гироскоп (iOS-жест-діалоги)
  // і камеру (getUserMedia). Увесь цей час (реально — кілька секунд) tiles навіть НЕ починали
  // завантажуватись, і перші тики сканування (кожні 2с, поки localScannerReady не стане true)
  // ішли ПОВІЛЬНИМ серверним шляхом (`/api/scan` -> живі Overpass-запити на кожного кандидата,
  // §4.5 Ф3, доки не спрацює кеш) — саме це й відчувалось як "довго шукає кандидатов сначала".
  // Тригер — `phase === 'requesting' АБО 'scanning'` (а не лише 'scanning') — завантаження
  // тайлів (manifest + buildings.bin/cameras.json/streets.json, § btwLocalScanner.ts::init())
  // стартує, щойно ОБИДВА — і фаза активна, і місто визначене (§ ефект вище — це, як правило,
  // відбувається одразу після геолокації/dev-override, ще ДО дозволів на орієнтацію/камеру,
  // тобто раніше, ніж у "до фікса медленно ищет", хоч і не миттєво в момент кліку, як у
  // попередній — але некоректній для інших міст — версії).
  //
  // `if (localScannerRef.current) return;` — КРИТИЧНО: без цієї перевірки перехід
  // 'requesting' -> 'scanning' (обидві "активні" фази) знову спрацював би як зміна залежностей
  // ефекту і, за старою логікою (створити новий сканер + `cancelled` у closure), ПЕРЕЗАПУСТИВ
  // би саме те завантаження, яке щойно почалось — тобто звів би цю зміну нанівець. Порівняння
  // за ІДЕНТИЧНІСТЮ інстансу в `.then()` (`localScannerRef.current === scanner`), а не
  // прапорцем `cancelled`, зав'язаним на ОДИН виклик ефекту — з тієї самої причини: сам виклик
  // `init()` продовжує "летіти" через перехід 'requesting' -> 'scanning' (це той самий інстанс
  // сканера, що обидва рази проходить через `if (localScannerRef.current) return;` вище), і
  // прапорець-closure старого стилю хибно позначив би його "скасованим" на цьому переході,
  // назавжди залишаючи localScannerReady=false для всієї сесії.
  //
  // ВИПРАВЛЕНО (за прямим запитом користувача — "по прежнему секунд 10-12-15 идет режим скана
  // на сервере /api/scan и только потом переключается на локальный воркер, необходимо
  // переключаться сразу"): навіть із попереднім фіксом вище завантаження тайлів усе одно
  // чекало на `scanCitySlug`, а той — на РЕАЛЬНУ GPS-позицію, яка стає відомою лише ПІСЛЯ
  // getCurrentPosition() (до 8с таймаут сам по собі, § requestPermissions()). Тепер тригер —
  // `citySlugToLoad = scanCitySlug ?? speculativeCitySlug` (§ btwCityCache.ts) — і фаза
  // 'intro' ДОДАНА в активні: якщо на цьому пристрої вже є "здогадка" з минулої сесії,
  // завантаження тайлів стартує ОДРАЗУ при відкритті мінідодатку, ще ДО натискання кнопки
  // "почати" й задовго до того, як GPS взагалі відповість — паралельно з усією ланцюжкою
  // дозволів, а не після неї. `loadedCitySlugRef` — яке саме місто зараз завантажене/
  // завантажується: коли реальний `scanCitySlug` нарешті приходить і збігається зі здогадкою
  // (типовий випадок — той самий пристрій, та сама людина, те саме місто) — ефект НІЧОГО не
  // перезапускає, Worker уже завантажується/завантажений. Якщо не збігається (юзер справді в
  // іншому місті, ніж минулого разу) — стара спроба для неправильного міста відкидається й
  // стартує нова, коректна — чисте самовиправлення "оптимістичної" здогадки, без ризику
  // показати кандидатів НЕ того міста.
  useEffect(() => {
    const citySlugToLoad = scanCitySlug ?? speculativeCitySlug;
    const active = (phase === 'intro' || phase === 'requesting' || phase === 'scanning') && citySlugToLoad != null;
    if (!active) {
      if (localScannerRef.current) {
        localScannerRef.current.dispose();
        localScannerRef.current = null;
        loadedCitySlugRef.current = null;
        setLocalScannerReady(false);
      }
      return;
    }
    if (localScannerRef.current && loadedCitySlugRef.current === citySlugToLoad) return; // вже завантажується/завантажено САМЕ це місто

    if (localScannerRef.current) {
      // Місто, для якого вже йшло/пройшло завантаження, розійшлося з тим, яке треба зараз
      // (найчастіше — спекулятивна здогадка не збіглася з реальним GPS-визначеним містом).
      localScannerRef.current.dispose();
      setLocalScannerReady(false);
    }

    const scanner = new BtwLocalScanner();
    localScannerRef.current = scanner;
    loadedCitySlugRef.current = citySlugToLoad;

    scanner.init(citySlugToLoad).then((ok) => {
      if (localScannerRef.current === scanner) setLocalScannerReady(ok);
    });
  }, [phase, scanCitySlug, speculativeCitySlug]);

  // Гарантія звільнення Worker'а при розмонтуванні сторінки НЕЗАЛЕЖНО від того, якою була
  // фаза в момент розмонтування (ефект вище звільняє лише при ПЕРЕХОДІ у неактивну фазу, не
  // при самому unmount — React не гарантує виклик того самого cleanup для цього випадку, якщо
  // останній рендер був в активній фазі).
  useEffect(() => {
    return () => {
      localScannerRef.current?.dispose();
    };
  }, []);

  // За прямим запитом користувача — панель "Log" (§ networkLog.ts). Підписка на модульний
  // сінглтон-лог: subscribeNetworkLog одразу віддає поточний накопичений стан (навіть запити,
  // що вже пройшли ДО монтування цього ефекту — напр. /api/session, /api/manifest під час
  // самого першого завантаження сторінки — не губляться), а далі отримує кожне оновлення.
  // Підписка не залежить від phase/showLog — записи накопичуються завжди, панель лише
  // показує/ховає вже наявний стан (дешевше, ніж підписуватись/відписуватись при кожному
  // натисканні кнопки, і не губить історію, поки панель схована).
  useEffect(() => {
    return subscribeNetworkLog(setLogEntries);
  }, []);

  // Періодичне сканування — §8.4 ТЗ вказує "не частіше 8 Гц і лише при Δheading>3°/Δposition>10м"
  // для локального Worker; коли localScannerReady — саме цей режим (нижче, гілка "локально"),
  // з поки що ТИМ САМИМ інтервалом 2с (спрощення — не адаптивний §8.4, легко зменшити пізніше,
  // адже тепер це дешево). Коли ready=false — старий серверний виклик, свідомо РІДШЕ (раз на
  // 2с), щоб не перевантажувати сервер запитами на кожен рух (AUDIT-btw.md).
  useEffect(() => {
    if (phase !== 'scanning') return;

    scanTimerRef.current = setInterval(async () => {
      if (position == null || heading == null) return;
      const last = lastScanRef.current;
      const headingChanged = !last || Math.abs(last.heading - heading) > 3;
      const posChanged = !last || Math.abs(last.lat - position.lat) > 0.0001 || Math.abs(last.lng - position.lng) > 0.0001;
      if (!headingChanged && !posChanged) return;

      // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "слишком долго подтягиваются
      // камеры (до пяти минут)"): раніше ТУТ не було ЖОДНОГО захисту від перекриття тиков —
      // `setInterval` не чекає завершення попереднього async-колбека, тож якщо один тик
      // забарився (серверний фолбек /api/scan усередині робить ЖИВІ Overpass-запити для
      // ще не закешованих кандидатів — AzimuthHeuristicService/OcclusionService, §4.5 Ф3;
      // Overpass fair-use slot-система, яку ми щойно обговорювали, може чекати до ~15с НА
      // ЗАПИТ, перш ніж узагалі почати його обробляти), наступний тик через 2с стартував ЩЕ
      // ОДИН такий самий повільний запит ПОВЕРХ першого, той — ще один за 2с, і так черга
      // росте, а не спадає, аж доки найперший запит нарешті не відповість. П'ять хвилин —
      // це якраз слушна оцінка для черги з кількох таких запитів, що накопичились.
      // Тепер новий тик просто пропускається (без побічних ефектів), поки попередній ще в
      // польоті — той самий anti-overlap принцип, що вже ScanSupersededError застосовує для
      // локального Worker'а (btwLocalScanner.ts), тепер явно і для ОБОХ шляхів (сервер й
      // локально) на рівні самого тика сканування.
      if (scanInFlightRef.current) return;
      scanInFlightRef.current = true;

      // У4 ТЗ — застосовуємо накопичену персональну поправку ПЕРЕД відправкою на сервер
      // (сервер потім ще й сам застосовує У3 snap до вулиці, поверх уже скоригованого
      // значення — обидва механізми коректно комбінуються, як описано в
      // btw-geometry.util.ts).
      const correctedHeading = applyHeadingBias(heading, headingBiasRef.current);
      try {
        // §8.1/§4.7.5 ТЗ — гілка локального сканування. LocalScanResult (btwLocalScanner.ts)
        // навмисно має ТУ САМУ форму {direct, fallback, target, debug}, що й JSON-відповідь
        // /api/scan — тому вся обробка нижче СПІЛЬНА для обох шляхів, без дублювання.
        let result: LocalScanResult | { direct?: Candidate[]; fallback?: Candidate[]; target?: { lat: number; lng: number }; debug?: ScanDebug } | undefined;
        let superseded = false;

        if (localScannerReady && localScannerRef.current) {
          try {
            result = await localScannerRef.current.scan({
              lat: position.lat,
              lng: position.lng,
              accuracyM: position.accuracyM,
              heading: correctedHeading,
              headingSigma: 8,
            });
          } catch (err) {
            if (err instanceof ScanSupersededError) {
              // Новіший scan() уже в польоті (напр. дуже швидка зміна heading) — цей тик просто
              // нічого не робить, БЕЗ інкременту scanErrors (це не збій, а очікуване витіснення,
              // той самий сенс, що раніше мав невдалий /api/scan: наступний тик спробує знову).
              superseded = true;
            } else {
              throw err;
            }
          }
        } else {
          // citySlug ДОДАНО (реальний живий інцидент — телеметрія в адмінці показувала різні
          // "улиц рядом" при незмінній позиції; § детальний коментар біля BtwService.scan()):
          // без нього серверний фолбек-шлях НІКОЛИ не користувався кешем тайлу вулиць міста і
          // завжди бив живий Overpass — саме scanCitySlug тут, той самий, що вже визначено для
          // ініціалізації локального сканера вище, жодного додаткового запиту не потрібно.
          // `?? speculativeCitySlug` — та сама здогадка з минулої сесії (§ btwCityCache.ts), на
          // той рідкісний випадок, коли цей тик стається РАНІШЕ, ніж реальний scanCitySlug устиг
          // прийти: гірший випадок — хибний citySlug просто не влучить у кеш тайлу на сервері
          // (BtwService.scan() тихо йде живим Overpass-шляхом, як і без citySlug узагалі), не
          // помилка.
          const res = await loggedFetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              lat: position.lat,
              lng: position.lng,
              accuracyM: position.accuracyM,
              heading: correctedHeading,
              headingSigma: 8,
              citySlug: scanCitySlug ?? speculativeCitySlug ?? undefined,
            }),
          });
          if (!res.ok) throw new Error(`scan failed: ${res.status}`);
          result = await res.json();
        }

        if (!superseded && result) {
          // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "кандидатов то находит то не
          // находит" навіть коли на карті явно багато камер поруч): раніше lastScanRef
          // оновлювався ДО запиту, безумовно — тобто ОДНА невдала спроба (мережа/5xx) "застрявала"
          // тут назавжди, доки хтось не поверне телефон на >3°, бо headingChanged/posChanged
          // порівнюють з lastScanRef, а не з фактом успіху. Тепер оновлюємо лише ПІСЛЯ успіху —
          // невдача просто пробується знову на наступному тику (кожні 2с), а не блокується.
          lastScanRef.current = { heading, lat: position.lat, lng: position.lng };

          // М2 ТЗ — зберігаємо fallback окремо, і якщо в цьому скані знову з'явився хоча б
          // один direct-кандидат, а fallback до цього був розкритий користувачем — коректно
          // згортаємо його назад з коротким сповіщенням (§4 ТЗ, "Найден прямой ракурс").
          const newDirect: Candidate[] = result.direct ?? [];
          setCandidates(newDirect);
          setFallbackCandidates(result.fallback ?? []);
          // ВИПРАВЛЕНО — саме ця точка (не власна GPS-позиція) тепер летить у /thumb при
          // тапі на будь-якого з цих кандидатів (handleLock/handleRadarSelect).
          if (result.target) scanTargetRef.current = result.target;
          if (newDirect.length > 0 && showFallback) {
            setShowFallback(false);
            setFallbackNotice('Найден прямой ракурс!');
            setTimeout(() => setFallbackNotice(null), 3000);
          }
          setScanDebug(result.debug ?? null);

          const t = telemetryRef.current;
          t.scans += 1;
          if (newDirect.length > 0) t.withCandidates += 1;
          // М3 ТЗ (§7) — "доля сканов, где direct пуст, но fallback непуст" (наскільки
          // часто ситуація взагалі актуальна).
          if (newDirect.length === 0 && (result.fallback ?? []).length > 0) t.fallbackOffered += 1;
          if (result.debug?.snapped) t.snapUsed = true;
          if (result.debug) {
            t.camerasInBboxLast = result.debug.camerasInBbox ?? 0;
            t.coneSurvivorsLast = result.debug.coneSurvivors ?? 0;
            t.streetCandidatesFoundLast = result.debug.streetCandidatesFound ?? 0;
          }
        }
      } catch {
        // мовчазно ігноруємо запуск наступного тика (не блокуємо UI), але лічильник помилок —
        // за прямим запитом користувача, щоб це було видно в адмінці, а не лише в HUD телефону
        telemetryRef.current.scanErrors += 1;
      } finally {
        // Звільняємо ЩОЙНО тут (не після sendTelemetry() нижче) — сам скан (важка частина,
        // потенційно повільна через живий Overpass, див. коментар вище біля scanInFlightRef)
        // уже повністю завершився; sendTelemetry() — легкий одиночний POST, паралельний виклик
        // якого наступним тиком не створює тієї самої проблеми накопичення черги.
        scanInFlightRef.current = false;
      }

      // ВИПРАВЛЕНО (за прямим запитом користувача — двічі поспіль "телеметрии маловато") —
      // раніше було раз на 10 успішних сканів, потім раз на 3 спроби (batched); тепер — ПІСЛЯ
      // КОЖНОЇ спроби (успішної чи ні). Це найпростіший спосіб зробити дані видимими в адмінці
      // в реальному часі без подальших суперечок про "яке число часто достатньо" — при цьому
      // одна відправка = один POST /telemetry раз на ~2с під час активного сканування, для
      // debug-інструменту це прийнятне навантаження.
      await sendTelemetry();
    }, 2000);

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
    // scanCitySlug ДОДАНО у залежності (§ коментар біля тіла тика вище, де воно тепер
    // читається) — без цього, якщо `scanCitySlug` резолвиться (null -> реальний слаг) ПІСЛЯ
    // того, як цей ефект уже створив інтервал (закриття JS-функції захопило б старе `null`
    // назавжди), серверний фолбек-шлях так і не отримав би citySlug аж до наступної зміни
    // ІНШОЇ залежності нижче.
  }, [phase, position, heading, showFallback, localScannerReady, scanCitySlug]);

  // Надсилає накопичені лічильники й скидає їх — §6 ТЗ "агрегаты сессии, без координат"
  // (жодних lat/lng тут немає навмисно). Викликається періодично (раз на 3 скани) і при
  // виході з екрана сканування (exitLock/beforeunload), щоб не втратити "хвіст" сесії.
  async function sendTelemetry() {
    const t = telemetryRef.current;
    // ВИПРАВЛЕНО — раніше `t.scans === 0` саме собою пропускало відправку. Але якщо КОЖНА
    // спроба скана падає (мережа/5xx), scans так і лишиться 0 назавжди — і саме цей випадок
    // scanErrors має показати в адмінці, а не мовчати разом з усім іншим.
    if (t.scans === 0 && t.scanErrors === 0) return;

    // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — телеметрія в адмінці показувала
    // "Сканы: 0" поряд з непорожнім "Последний скан", тобто дані виглядали "битими"): скидання
    // лічильника раніше відбувалось ПІСЛЯ `await fetch(...)`. `setInterval` не чекає на
    // завершення попереднього тика — поки цей fetch летить (особливо повільний бекенд/холодний
    // старт), наступний тик МІГ уже встигнути мутувати ТОЙ САМИЙ об'єкт `telemetryRef.current`
    // (`t.scans += 1` тощо, той самий reference!), а потім цей виклик, дочекавшись fetch,
    // затирав його свіжими нулями — щойно накопичені (і НІКОЛИ не надіслані) дані просто
    // зникали. Тепер знімок і скидання відбуваються синхронно, ДО await — наступний тик під час
    // очікування мережі вже працює зі свіжим, окремим об'єктом, нічого не втрачається.
    telemetryRef.current = {
      scans: 0,
      withCandidates: 0,
      locks: 0,
      snapUsed: false,
      fallbackOffered: 0,
      fallbackUsed: 0,
      scanErrors: 0,
      camerasInBboxLast: 0,
      coneSurvivorsLast: 0,
      streetCandidatesFoundLast: 0,
    };
    try {
      await loggedFetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(t),
      });
    } catch {
      // не критично — телеметрія втрачається мовчки, не блокує основний UX
    }
  }

  async function handleLock(candidate: Candidate) {
    if (position == null || heading == null) return;

    // У4 ТЗ — ручний вибір кандидата зі списку (на відміну від автоматичного "спіймав"
    // вирівнюванням компаса, якого в цьому MVP-клієнті взагалі немає — див.
    // doc/AUDIT-btw.md) трактується як сигнал калібрування: різниця між РЕАЛЬНИМ азимутом
    // на цього кандидата (candidate.bearingToTarget, уже пораховано сервером у /btw/scan) і
    // тим, що зараз показує компас — це і є вимір систематичної помилки прямо зараз.
    const rawBias = computeHeadingBias(candidate.bearingToTarget, heading);
    headingBiasRef.current = blendHeadingBias(headingBiasRef.current, rawBias);

    // ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "нужно сделать подсказки снизу
    // кликабельными"): раніше тут стояла ВЛАСНА GPS-позиція користувача замість справжньої
    // цільової точки — assertWithinConeOfCamera() на сервері рахує відстань КАМЕРА->ЦЯ_ТОЧКА,
    // і для SIDE-кандидатів (де реальна ціль лежить осторонь від того, де фізично стоїть
    // користувач) це часто перевищувало camera.rangeMeters -> тихий 400, тап виглядав
    // "нежива кнопка". Тепер беремо ту саму точку, яку /btw/scan щойно порахував і повернув
    // у result.target (scanTargetRef) — а не вигадуємо її заново.
    const target = scanTargetRef.current ?? { lat: position.lat, lng: position.lng }; // фолбек на позицію користувача — лише якщо ще жодного scan-результату не було (не мало б траплятись, кандидати з'являються саме зі scan)
    setLockingCameraId(candidate.cameraId);
    setLockError(null);
    try {
      const res = await loggedFetch('/api/thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameraId: candidate.cameraId, targetLat: target.lat, targetLng: target.lng }),
      });
      if (res.ok) {
        const data = await res.json();
        setThumbUrl(data.url);
        setThumbLoadFailed(false);
        setThumbRefreshTick(0);
        setLockedCandidate(candidate);
        setPhase('locked');
        telemetryRef.current.locks += 1;
        if ((navigator as any).vibrate) (navigator as any).vibrate(40);
      } else {
        // ВИПРАВЛЕНО — раніше невдача тут не показувала АБСОЛЮТНО нічого (той самий клас
        // проблеми, що вже виправлений для <img onError> нижче): бекенд віддає людський
        // message (BadRequestException('Камера недоступна') тощо) — показуємо саме його.
        const body = await res.json().catch(() => null);
        setLockError(body?.message ?? `Камера не отвечает (${res.status})`);
      }
    } catch {
      setLockError('Нет соединения с сервером — попробуйте ещё раз');
    } finally {
      setLockingCameraId(null);
    }
  }

  // Радар (components/BtwRadar.tsx) знає лише cameraId точки, по якій тапнули — сам компонент
  // отримує урізаний BtwRadarCandidate[] (без усіх полів Candidate), тому тут відновлюємо
  // повний об'єкт з тих самих масивів candidates/fallbackCandidates і йдемо тим самим шляхом
  // захвату, що вже й список кандидатів нижче (єдина точка входу в handleLock — той самий
  // "видео через VPN" пайплайн, за прямим запитом користувача, а не окрема копія логіки).
  function handleRadarSelect(cameraId: string) {
    const candidate = candidates.find((c) => c.cameraId === cameraId) ?? fallbackCandidates.find((c) => c.cameraId === cameraId);
    if (candidate) handleLock(candidate);
  }

  // У5 ТЗ (§5) — "по кнопке «уточнить», не чаще 1 раза в 30 с". Захоплює поточний кадр
  // відео телефону через offscreen Canvas -> base64 data URL (jpeg, стиснуто — vision-запит
  // все одно дорогий, немає сенсу слати нестиснутий кадр повного розміру).
  async function handleRefine() {
    if (lockedCandidate == null || videoRef.current == null) return;

    const COOLDOWN_MS = 30_000;
    const elapsed = Date.now() - lastRefineAtRef.current;
    if (elapsed < COOLDOWN_MS) {
      setRefineMessage(`Доступно через ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)} с`);
      return;
    }

    setRefineStatus('loading');
    setRefineMessage(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas context');
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const phoneImageDataUrl = canvas.toDataURL('image/jpeg', 0.7);

      lastRefineAtRef.current = Date.now();
      const res = await loggedFetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameraId: lockedCandidate.cameraId, phoneImageDataUrl, expectedRelationship: lockedCandidate.orientationFit }),
      });

      if (res.status === 429) {
        setRefineMessage('Слишком часто — попробуйте позже');
        setRefineStatus('cooldown');
        return;
      }
      if (!res.ok) {
        setRefineMessage('Не удалось уточнить');
        setRefineStatus('idle');
        return;
      }

      const result = await res.json();
      if (!result.imageAvailable) {
        setRefineMessage('Кадр камеры недоступен для сравнения');
      } else if (!result.sameScene || result.angularOffsetDeg == null || result.confidence < 0.5) {
        // Той самий поріг довіри, що вже виправдав себе для автокалібрування камер у
        // RoadScout (0.7 там; тут 0.5, оскільки У5 — лише невелика КОРЕКЦІЯ вже наявної
        // оцінки, не одноразове самостійне рішення "застосувати чи ні" повністю з нуля).
        setRefineMessage('Не удалось однозначно сопоставить кадры');
      } else {
        // Той самий blendHeadingBias, що У4 (§5 ТЗ) — vision-уточнення не ЗАМІНЮЄ поточну
        // поправку, а змішується з нею тим самим механізмом захисту від одиничної помилки.
        headingBiasRef.current = blendHeadingBias(headingBiasRef.current, headingBiasRef.current + result.angularOffsetDeg, 0.5);
        setRefineMessage(`Скорректировано на ${result.angularOffsetDeg > 0 ? '+' : ''}${result.angularOffsetDeg}°`);
      }
      setRefineStatus('idle');
    } catch {
      setRefineMessage('Ошибка уточнения');
      setRefineStatus('idle');
    }
  }

  function exitLock() {
    setLockedCandidate(null);
    setThumbUrl(null);
    setPhase('scanning');
  }

  // ВИПРАВЛЕНО (за прямим запитом користувача — "в основном это камеры которые отдают поток
  // периодических снимков - в админке мы уже решали эту проблему"): той самий 3000мс
  // cache-bust-polling, що вже в апробований в адмінці (embed/[id]/page.tsx,
  // cameras/[id]/calibrate/page.tsx) — тут той самий інтервал, лише скинутий у 0 при кожному
  // новому замку, і зупинений, щойно locked-фаза закінчується (exitLock/новий скан).
  useEffect(() => {
    if (phase !== 'locked') return;
    const interval = setInterval(() => setThumbRefreshTick((t) => t + 1), 3000);
    return () => clearInterval(interval);
  }, [phase]);

  if (phase === 'intro') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-white text-center">
        <h1 className="text-2xl font-bold">Beyond the Wall</h1>
        <p className="text-sm text-gray-300 max-w-xs">
          Наведите телефон вокруг себя — приложение покажет, в каких направлениях есть публичная камера, которая видит то, что скрыто от вас
          препятствием.
        </p>
        <p className="text-xs text-gray-500 max-w-xs">
          Показываются только публичные, проверенные камеры. Наведение на жильё и социальные объекты заблокировано. История не хранится.
        </p>
        <button onClick={requestPermissions} className="rounded-full bg-white px-8 py-3 font-semibold text-black">
          Начать сканирование
        </button>
      </div>
    );
  }

  if (phase === 'requesting') {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <p>Запрашиваем доступ к датчикам…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-white text-center">
        <p>{errorMessage}</p>
        <button onClick={requestPermissions} className="rounded-full bg-white px-6 py-2 text-black">
          Повторить
        </button>
      </div>
    );
  }

  if (phase === 'locked' && lockedCandidate) {
    // ВИПРАВЛЕНО/ПЕРЕБУДОВАНО (за прямим запитом користувача — "добавить на экране отображения
    // камеры мини-карту на 33% экрана с отображением азимута и сектора обзора этой камеры,
    // изображение камеры (CSS 50%), сверху название камеры" + "заменить прозрачность (рентген)
    // на контрастность"): раніше цей екран був повноекранним відео власної камери користувача з
    // блендованим (mixBlendMode:'screen') поверх нього кадром цільової камери — фіксовані
    // пропорції (50%/33%) і окремий заголовок з назвою камери структурно не сумісні з таким
    // повноекранним оверлеєм, тож екран перебудований на звичайний вертикальний макет (flex-col,
    // не absolute-позиціонування): заголовок з назвою камери -> кадр камери (50vh) -> міні-карта
    // азимута/сектора (33vh, § components/BtwCameraMiniMap.tsx) -> контрастність + кнопка
    // "уточнити". Власна камера користувача НЕ прибрана повністю — лишена маленьким
    // picture-in-picture у куті кадру камери (для порівняння ракурсів, той самий сенс, що раніше
    // давав повноекранний блендований фон).
    const headingDelta =
      heading != null ? Math.round(Math.abs((((((lockedCandidate.cameraAzimuth + 180) % 360) - heading + 540) % 360) - 180))) : null;
    return (
      <div className="flex min-h-screen flex-col bg-black text-white">
        {/* Заголовок — назва камери зверху (за прямим запитом користувача). */}
        <div className="flex items-center justify-between gap-2 bg-black px-4 py-3">
          <span className="truncate text-base font-semibold">{lockedCandidate.cameraName ?? 'Камера'}</span>
          <button onClick={exitLock} className="shrink-0 rounded-full bg-white/20 px-3 py-1">
            ✕
          </button>
        </div>

        {/* Компактна панель дистанції/ракурсу — раніше плаваюча поверх повноекранного відео,
            тепер звичайний рядок під заголовком (той самий вміст, § коментарі нижче незмінні
            по суті). */}
        <div className="bg-black/60 px-4 py-1.5 text-xs text-gray-300">
          {Math.round(lockedCandidate.distanceM)} м
          {lockedCandidate.orientationFit === 'OPPOSING' && ' · ⚠️ встречный ракурс'}
          {/* За прямим запитом користувача ("подсказывать при трансляции отличие ракурса камеры
              от ракурса телефона") — точна категорія (ALIGNED/SIDE/OPPOSING) вже порахована
              сервером із РЕАЛЬНОГО азимута камери; тут — жива кількість градусів, що оновлюється
              разом із компасом. ВИПРАВЛЕНО (реальний баг, знайдений користувачем на скріні —
              число показувало ~84° одночасно з міткою "почти совпадает", хоча ALIGNED вимагає
              delta≤45°): раніше тут наближали азимут камери через bearingToTarget (похибка до
              fovAngle/2). Тепер рахуємо ТОЧНО ту саму формулу, що й classifyOrientationFit() на
              сервері (btw-geometry.util.ts), але з РЕАЛЬНИМ cameraAzimuth — число завжди
              узгоджене з міткою. */}
          {headingDelta != null && (
            <>
              {' '}
              · расхождение ракурса ~{headingDelta}°{' '}
              {lockedCandidate.orientationFit === 'ALIGNED' && '(почти совпадает)'}
              {lockedCandidate.orientationFit === 'SIDE' && '(сбоку)'}
              {lockedCandidate.orientationFit === 'OPPOSING' && '(встречный)'}
            </>
          )}
        </div>

        {/* Кадр камери — CSS 50% екрана (за прямим запитом користувача). */}
        <div className="relative w-full overflow-hidden bg-gray-900" style={{ height: '50vh' }}>
          {/* ВИПРАВЛЕНО — раніше <img> взагалі НЕ рендерився після invalid onError (умова була
              thumbUrl && !thumbLoadFailed), тож наступний cache-bust тик src нижче не мав на
              чому спрацювати — елемент просто не існував у DOM, і кадр ніколи не міг
              "самовилікуватись" на наступному успішному опитуванні. Тепер <img> лишається
              змонтованим завжди (просто прозорим під час збою), а onLoad повертає видимість. */}
          {thumbUrl && (
            <img
              src={`${thumbUrl}${thumbUrl.includes('?') ? '&' : '?'}_t=${thumbRefreshTick}`}
              alt="Camera feed"
              className="h-full w-full object-cover"
              style={{ opacity: thumbLoadFailed ? 0 : 1, filter: `contrast(${xrayContrast}%)` }}
              onError={() => setThumbLoadFailed(true)}
              onLoad={() => setThumbLoadFailed(false)}
            />
          )}
          {thumbLoadFailed && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-6 text-center text-sm text-yellow-300">
              ⚠️ Не удалось загрузить кадр с камеры — возможно, эта камера отдаёт не статичный снимок (нужен другой тип
              прокси) или недоступна даже через VPN.
            </div>
          )}
          {/* Picture-in-picture власної камери користувача — те, що раніше було повноекранним
              блендованим фоном (§ коментар на початку блоку), тепер невеликий інсет у куті для
              порівняння ракурсів, не заважає кадру цільової камери. */}
          {hasCamera && (
            <video
              ref={attachVideoRef}
              muted
              playsInline
              className="absolute bottom-2 right-2 h-1/4 w-1/4 rounded border border-white/40 object-cover shadow-lg"
            />
          )}
        </div>

        {/* Міні-карта азимута/сектора огляду камери — 33% екрана (за прямим запитом
            користувача, § components/BtwCameraMiniMap.tsx). */}
        <div className="flex w-full items-center justify-center bg-black" style={{ height: '33vh' }}>
          <div style={{ height: '100%', aspectRatio: '1 / 1' }}>
            <BtwCameraMiniMap cameraAzimuth={lockedCandidate.cameraAzimuth} fovAngle={lockedCandidate.fovAngle} />
          </div>
        </div>

        {/* Контрастність (§ заміна "рентген"-прозорості вище) + кнопка "уточнити". */}
        <div className="flex-1 space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs text-gray-300">Контрастность кадра: {xrayContrast}%</label>
            <input
              type="range"
              min={0}
              max={200}
              value={xrayContrast}
              onChange={(e) => setXrayContrast(Number(e.target.value))}
              className="w-full"
            />
          </div>
          {/* У5 ТЗ — кнопка "уточнить", доступна лише при захваті (не під час сканування) —
              vision-запит порівнює саме зафіксований кадр телефону з кадром цього конкретного
              кандидата. */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefine}
              disabled={refineStatus === 'loading'}
              className="rounded-full bg-white/20 px-4 py-2 text-sm disabled:opacity-50"
            >
              {refineStatus === 'loading' ? 'Уточняем…' : '🔍 Уточнить по кадру'}
            </button>
            {refineMessage && <span className="text-xs text-gray-300">{refineMessage}</span>}
          </div>
        </div>
      </div>
    );
  }

  // phase === 'scanning'
  // Той самий набір, що вже й компас-стрічка/список нижче показують — direct завжди, fallback
  // лише коли користувач сам розкрив його (showFallback), щоб радар не "спойлерив" резервні
  // кандидати до явного тапу "Показать резервные".
  const radarCandidates = [
    ...candidates.map((c) => ({ ...c, isFallback: false })),
    ...(showFallback ? fallbackCandidates.map((c) => ({ ...c, isFallback: true })) : []),
  ];

  return (
    <div className="relative min-h-screen bg-black text-white">
      {hasCamera ? (
        <video ref={attachVideoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-center text-sm text-gray-400">
          Камера телефона недоступна — режим карты/списка (§3.2 ТЗ)
        </div>
      )}

      {/* Компас-стрічка — та сама, що й раніше, лишена поруч із радаром нижче (той самий сенс,
          друга візуалізація тих самих даних, § 3.1.2 ТЗ). */}
      <div className="absolute top-6 left-4 right-4 rounded-full bg-black/50 px-4 py-3">
        <div className="relative h-2 rounded-full bg-white/20">
          <div className="absolute left-1/2 top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-white" />
          {heading != null &&
            candidates.map((c) => {
              const rel = ((c.bearingToTarget - heading + 540) % 360) - 180; // -180..180 відносно поточного погляду
              const clamped = Math.max(-90, Math.min(90, rel));
              const leftPct = 50 + (clamped / 90) * 50;
              return (
                <div
                  key={c.cameraId}
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-400"
                  style={{ left: `${leftPct}%` }}
                />
              );
            })}
        </div>
        <p className="mt-2 text-center text-xs text-gray-300">
          {heading == null ? 'Компас недоступен — наведение вручную' : `${Math.round(heading)}°`}
          {/* У4 ТЗ — видимість того, що персональна калібровка застосована (лише коли поправка
              вже помітна, щоб не плутати користувача дрібним шумом ±1-2°). */}
          {Math.abs(headingBiasRef.current) > 3 && (
            <span className="ml-2 text-green-400">компас откалиброван ({headingBiasRef.current > 0 ? '+' : ''}{Math.round(headingBiasRef.current)}°)</span>
          )}
          {hasGyroRef.current && <span className="ml-2 text-blue-400">гироскоп активен</span>}
        </p>
      </div>

      {/* За прямим запитом користувача — єдина нижня панель для Радара/Log/HUD.
          ВИПРАВЛЕНО (§ "радар и HUD перенеси вниз" + "добавь между радар и HUD - Log"): раніше
          HUD і Радар були двома незалежними absolute-блоками з вручну підібраними відступами
          (bottom-[48vh] для кнопки / bottom-[53vh] для панелі), що працювало, лише доки
          одночасно відкритих панелей було щонайбільше по одній з кожного боку. Додавання
          третьої панелі (Log) зробило б цей підхід крихким — довелось би вручну підбирати
          offset під усі комбінації "яка саме панель зараз розкрита". Замість цього — один
          flex-column контейнер, прив'язаний ЛИШЕ знизу (`bottom-[48vh]`, без `top`): висота
          контейнера природно зростає ВГОРУ в міру того, як розкривається більше панелей, а
          рядок кнопок завжди лишається найнижчим (§ порядок дочірніх елементів нижче — усі
          панелі йдуть ПЕРЕД рядком кнопок). Порядок кнопок зліва направо — Радар, Log, HUD:
          Log ПОСЕРЕДИНІ, точно як попросив користувач ("между радар и HUD - Log").
          `bottom-[48vh]` — той самий відступ, що й раніше, свідомо НАД панеллю кандидатів
          (`bottom-0 ... max-h-[45vh]`, ~3vh запасу), щоб не перекривати тапабельні картки
          кандидатів своєю /z-10/. ⚠️ Як і раніше, точні відступи підібрані розрахунково, БЕЗ
          перевірки на реальному екрані (немає живого Telegram WebView в цьому середовищі) —
          § doc/AUDIT-btw-radar-m1-m2.md. Якщо одночасно розкриті всі три панелі, контейнер
          може вирости вище top-6 компас-стрічки на дуже низьких екранах — той самий клас
          компромісу "на око", що вже задокументований для попередньої версії розміщення. */}
      <div className="absolute inset-x-2 bottom-[48vh] z-10 flex flex-col items-center gap-1.5">
        {showRadar && (
          <div className="w-full max-w-[260px] rounded-xl bg-black/40 p-2">
            <BtwRadar heading={heading} candidates={radarCandidates} onSelect={handleRadarSelect} />
            <p className="mt-1 text-center text-[10px] text-gray-400">
              <span className="text-green-400">●</span> прямой{' '}
              {showFallback && (
                <>
                  · <span className="text-amber-400">●</span> резервный
                </>
              )}
            </p>
          </div>
        )}

        {/* За прямим запитом користувача — "между радар и HUD - Log, каждый запрос на сервер и
            каждый ответ отображай в этом логе, пиши время которое занял запрос и размер
            ответа". Дані — з lib/networkLog.ts::loggedFetch, підключеного до ВСІХ відомих
            fetch-викликів мінідодатку (цей файл, btwLocalScanner.ts, btwSession.ts,
            map/page.tsx) — включно з manifest/тайлами, що завантажуються ще до входу у фазу
            сканування, тому лог не порожній навіть одразу після відкриття панелі.
            Найновіші записи зверху (той самий порядок, що вже в самому networkLog.ts).
            Власний overflow-y-auto + max-h — щоб довгий лог не розтягував контейнер понад
            компас-стрічку зверху. */}
        {showLog && (
          <div className="w-full max-w-[280px]">
            {/* ДОДАНО — за прямим запитом користувача ("в логе не показывает запрос tiles - не
                могу сделать выводы"): кнопка очищення. Log — модульний сінглтон (§ networkLog.
                ts), що переживає навігацію між сторінками; Telegram WebView теж часто лишає
                мінідодаток "призупиненим" замість справжнього релоаду при повторному відкритті
                — без явного очищення старі записи з попереднього тесту легко переплутати з
                поточним. */}
            <div className="mb-1 flex justify-end">
              <button onClick={() => clearNetworkLog()} className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-gray-400">
                Очистить
              </button>
            </div>
            <div className="max-h-[18vh] overflow-y-auto rounded bg-black/70 p-2 text-[10px] leading-snug text-gray-200">
              {logEntries.length === 0 ? (
                <div className="text-center text-gray-500">Запросов пока нет</div>
              ) : (
                logEntries.map((e) =>
                  // ДОДАНО — синтетичні "note"-записи (§ logNote(), networkLog.ts) показують
                  // РІШЕННЯ ("чому мережевого запиту не було"), не сам запит — окремий, коротший
                  // рендер (жовтий/зелений текст замість method+url+статус+розмір).
                  e.kind === 'note' ? (
                    <div key={e.id} className={`border-b border-white/10 py-0.5 last:border-b-0 ${e.ok ? 'text-blue-300' : 'text-yellow-300'}`}>
                      <span className="text-gray-500">{e.time}</span> {e.url}
                    </div>
                  ) : (
                    <div key={e.id} className="border-b border-white/10 py-0.5 last:border-b-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-gray-400">{e.time}</span>
                        <span className={e.ok ? 'text-green-400' : 'text-red-400'}>{e.status ?? 'ERR'}</span>
                      </div>
                      <div className="truncate text-gray-200">
                        {e.method} {e.url}
                      </div>
                      <div className="text-gray-400">
                        {Math.round(e.durationMs)}мс · {formatBytes(e.sizeBytes)}
                        {e.error && <span className="text-red-400"> · {e.error}</span>}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        )}

        {/* За прямим запитом користувача — debug HUD: усе, що потрібно бачити ПРЯМО НА
            ТЕЛЕФОНІ під час М0-спайку (doc/AUDIT-btw.md) — без USB-дебагу консолі браузера. */}
        {showHud && (
          <div className="w-full max-w-[260px] rounded bg-black/70 px-2 py-2 text-[10px] leading-snug text-gray-200">
            <div>GPS: {position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} (±${Math.round(position.accuracyM)}м)` : '—'}</div>
            {/* §8.1/§4.7.5 ТЗ — видимість, який шлях сканування зараз активний: локальний
                Worker (тайли завантажені для цього міста) чи серверний фолбек /api/scan
                (типовий випадок у цьому середовищі — тайли ще не згенеровані, див.
                doc/AUDIT-btw-radar-m1-m2.md). */}
            <div>Режим скана: {localScannerReady ? '🟢 локально (Worker)' : '⚪ сервер (/api/scan)'}</div>
            {usedDevOverride && <div className="text-yellow-400">⚠️ используется подмена координат (dev)</div>}
            {routeOverrideLabel && <div className="text-yellow-400">📍 скан для точки маршрута: {routeOverrideLabel}</div>}
            <div>Сырой азимут: {heading != null ? `${Math.round(heading)}°` : '—'}</div>
            <div>Гироскоп: {hasGyroRef.current ? 'активен' : 'нет данных'}</div>
            <div>Поправка (У4/У5): {headingBiasRef.current > 0 ? '+' : ''}{Math.round(headingBiasRef.current)}°</div>
            {/* За прямим запитом користувача — калібрування "по кандидату" (У4) при
                dev-подмене координат може "вивчити" сміттєвий зсув (компас реальний, GPS
                підмінений — це різні світи), і зіпсувати всі наступні скани сесії. Кнопка нижче
                скидає накопичену поправку без перезапуску застосунку. */}
            {Math.abs(headingBiasRef.current) > 3 && (
              <button onClick={resetCalibration} className="mt-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] text-white">
                Сбросить калибровку
              </button>
            )}
            {scanDebug && (
              <>
                <div>После snap (У3): {scanDebug.snapped ? `${Math.round(scanDebug.effectiveHeading)}° (притянуто)` : `${Math.round(scanDebug.effectiveHeading)}° (без snap)`}</div>
                <div>Уличных направлений рядом: {scanDebug.streetCandidatesFound}</div>
                <div>Камер в радиусе 2.5км: {scanDebug.camerasInBbox}</div>
                {/* ВИПРАВЛЕНО — раніше цей запас узагалі не застосовувався (мертвий код,
                    btw-geometry.util.ts::angularTolerance) — тепер видно, наскільки конус
                    розширено проти шуму компаса на цьому скані. */}
                <div>Допуск на шум компаса: ±{Math.round(scanDebug.headingUncertaintyDeg)}°</div>
                <div>Прошли конус (Ф2): {scanDebug.coneSurvivors}</div>
                <div>Итоговых кандидатов: {scanDebug.finalCandidates}</div>
              </>
            )}
          </div>
        )}

        <div className="flex w-full items-center justify-between gap-2">
          <button onClick={() => setShowRadar((v) => !v)} className="rounded bg-black/60 px-2 py-1 text-[10px] text-gray-300">
            {showRadar ? 'Радар ▲' : 'Радар ▼'}
          </button>
          <button onClick={() => setShowLog((v) => !v)} className="rounded bg-black/60 px-2 py-1 text-[10px] text-gray-300">
            {showLog ? 'Log ▲' : 'Log ▼'}
          </button>
          <button onClick={() => setShowHud((v) => !v)} className="rounded bg-black/60 px-2 py-1 text-[10px] text-gray-300">
            {showHud ? 'HUD ▲' : 'HUD ▼'}
          </button>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 max-h-[45vh] overflow-y-auto rounded-t-2xl bg-black/70 p-4">
        {fallbackNotice && <p className="mb-2 text-center text-xs text-green-400">{fallbackNotice}</p>}

        {candidates.length === 0 && fallbackCandidates.length === 0 && (
          <p className="text-center text-sm text-gray-400">Кандидатов не найдено рядом с вами</p>
        )}

        {candidates.map((c) => (
          <button
            key={c.cameraId}
            onClick={() => handleLock(c)}
            disabled={lockingCameraId === c.cameraId}
            className="mb-2 flex w-full items-center justify-between rounded-lg bg-white/10 px-4 py-3 text-left disabled:opacity-50"
          >
            <span>
              {/* За прямим запитом користувача — живий випадок "задвоилась камера" (дві картки
                  з однаковою дистанцією й текстом, неможливо було відрізнити на очах). Фолбек
                  для тайлів, згенерованих ДО додавання поля name. */}
              {c.cameraName || 'Камера'} · {Math.round(c.distanceM)} м
            </span>
            <span className="text-xs text-gray-400">{lockingCameraId === c.cameraId ? 'Загрузка…' : `покрытие ${Math.round(c.coverage * 100)}%`}</span>
          </button>
        ))}

        {/* ВИПРАВЛЕНО (за прямим запитом користувача — "нужно сделать подсказки снизу
            кликабельными") — раніше невдалий тап на картку не показував НІЧОГО, виглядало,
            наче кнопка "мертва". Тепер показуємо реальну причину з бекенда. */}
        {lockError && (
          <p className="mb-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-center text-xs text-red-300">⚠️ {lockError}</p>
        )}

        {/* М2 ТЗ (doc/TZ-btw-side-reverse-view.md §2-4) — резервний рівень з'являється ЛИШЕ
            коли direct порожній, і розкривається ЛИШЕ явним тапом користувача, а не
            автоматично. Кнопка не показується взагалі, якщо fallback теж порожній (нічого
            запропонувати) — точно як описано в §6 ТЗ ("Граничні випадки"). */}
        {candidates.length === 0 && fallbackCandidates.length > 0 && !showFallback && (
          <button
            onClick={() => {
              setShowFallback(true);
              telemetryRef.current.fallbackUsed += 1; // М3 ТЗ (§7) — conversion rate
            }}
            className="w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-center text-sm text-gray-300"
          >
            Прямых кандидатов рядом нет — показать боковые/встречные ракурсы?
          </button>
        )}

        {showFallback &&
          fallbackCandidates.map((c) => (
            <button
              key={c.cameraId}
              onClick={() => handleLock(c)}
              disabled={lockingCameraId === c.cameraId}
              className="mb-2 flex w-full flex-col items-start rounded-lg border border-yellow-500/30 bg-white/10 px-4 py-3 text-left disabled:opacity-50"
            >
              <div className="flex w-full items-center justify-between">
                <span>{c.cameraName || 'Камера'} · {Math.round(c.distanceM)} м</span>
                <span className="text-xs text-gray-400">{lockingCameraId === c.cameraId ? 'Загрузка…' : `покрытие ${Math.round(c.coverage * 100)}%`}</span>
              </div>
              {/* §4 ТЗ — явне попередження про приватність саме для OPPOSING (не нейтральна
                  мітка, а прямий текст "можете бути видні ви самі") — єдиний випадок у
                  продукті, де камера потенційно показує самого користувача. */}
              <span className="mt-1 text-xs text-yellow-400">
                {c.orientationFit === 'OPPOSING' ? '⚠️ встречный ракурс — на этом кадре можете быть видны вы сами' : 'сбоку — не совпадает с тем, куда вы смотрите'}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

// Beyond the Wall (BTW) — сканувальний екран, §3.1/§3.2 ТЗ (doc/BTW-tz.md).
//
// ⚠️ ЧЕСНО (повний перелік — doc/AUDIT-btw.md): це MVP-версія клієнта. НЕ реалізовано в
// цьому кроці:
// - Web Worker з геометричним рушієм і локальними тайлами (§4.7, §8.1) — сканування йде
//   через серверний фолбек /btw/scan (POST) при КОЖНОМУ тику, а не локально за 3-6мс.
// - У2 (комплементарний фільтр), У3 (snap до вулиці, на сервері), У4 (калібрування за
//   кандидатом) — РЕАЛІЗОВАНІ. Vision-уточнення (У5) — реалізоване (кнопка "Уточнить").
// - Магнітне схилення — використовується фіксоване наближення з /btw/manifest (не WMM).
// - Кільце-радар на Canvas (§3.1.2) — замінено на простішу горизонтальну компас-стрічку +
//   список кандидатів (той самий сенс: видно, у який бік повертати телефон).
// - Розмиття облич/номерів (§11.3), водяний знак (§11.3) — сервер поки що просто віддає
//   streamUrl напряму.
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
  distanceM: number;
  bearingToTarget: number;
  coverage: number;
  orientationFit: 'ALIGNED' | 'SIDE' | 'OPPOSING';
  score: number;
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
}

type Phase = 'intro' | 'requesting' | 'scanning' | 'locked' | 'error';

export default function BtwScanPage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);
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
  const [usedDevOverride, setUsedDevOverride] = useState(false);
  const [lockedCandidate, setLockedCandidate] = useState<Candidate | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [xrayOpacity, setXrayOpacity] = useState(70);
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
  // ensureBtwSession() нижче реально логінить через Telegram.WebApp.initData (HMAC-перевірка
  // на сервері — apps/api/src/auth/telegram-verify.util.ts::verifyTelegramWebAppInitData).
  const btwSessionPromiseRef = useRef<Promise<void> | null>(null);
  const ensureBtwSession = useCallback((): Promise<void> => {
    let promise = btwSessionPromiseRef.current;
    if (!promise) {
      promise = (async () => {
        const initData = (window as any).Telegram?.WebApp?.initData;
        if (!initData) return; // не всередині Telegram (напр. звичайний браузер для тестів UI) — просто немає сесії, як і раніше
        try {
          await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ initData }),
          });
        } catch {
          // мовчазно продовжуємо без сесії — далі просто НЕ буде override/телеметрії/скану,
          // як і раніше, а не блокуємо весь UI через збій одного логін-запиту
        }
      })();
      btwSessionPromiseRef.current = promise;
    }
    return promise;
  }, []);

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

  const videoRef = useRef<HTMLVideoElement>(null);
  const headingSamplesRef = useRef<number[]>([]);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef = useRef<{ heading: number; lat: number; lng: number } | null>(null);
  // За прямим запитом користувача — реальне трекування лічильників телеметрії сесії (раніше
  // ендпоінт /btw/telemetry існував на сервері, але клієнт його жодного разу не викликав!).
  // М3 ТЗ (doc/TZ-btw-side-reverse-view.md §7) — доданo fallbackOffered/fallbackUsed для
  // conversion rate (за прямим запитом користувача — раніше цих полів не було в
  // BtwTelemetryEvent взагалі).
  const telemetryRef = useRef({ scans: 0, withCandidates: 0, locks: 0, snapUsed: false, fallbackOffered: 0, fallbackUsed: 0 });
  // У4 ТЗ (§5) — "калибровка по кандидату". Свідомо client-side, useRef (не useState) — це
  // "сессия" за задумом ТЗ (ефемерний стан, зникає при перезавантаженні застосунку), і не
  // потребує ре-рендеру щоразу при оновленні (лише впливає на майбутні виклики /api/scan).
  // Формули (computeHeadingBias/blendHeadingBias/applyHeadingBias) — той самий алгоритм, що
  // вже реально протестований у apps/api/src/btw/btw-geometry.util.ts (10 юніт-тестів) —
  // окремі копії тут через відсутність спільного @btw/geometry-пакета між двома Next.js-
  // застосунками (див. doc/AUDIT-btw.md).
  const headingBiasRef = useRef(0);
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
    try {
      const overrideRes = await fetch('/api/dev-location-override', { credentials: 'include' });
      if (overrideRes.ok) {
        const override = await overrideRes.json();
        if (override != null) {
          // Підміна є — використовуємо ЇЇ, не реальний navigator.geolocation взагалі, і не
          // підписуємось на watchPosition (інакше реальний GPS одразу "перебʼє" підмінену
          // точку першим-таки оновленням).
          setPosition({ lat: override.lat, lng: override.lng, accuracyM: 5 });
          setUsedDevOverride(true);
          usedOverride = true;
        }
      }
    } catch {
      // мовчазно продовжуємо до реальної геолокації, якщо перевірка підміни не вдалась
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
  }, [ensureBtwSession]);

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

  // Періодичне сканування — §8.4 ТЗ вказує "не частіше 8 Гц і лише при Δheading>3°/Δposition>10м"
  // для локального Worker; тут — серверний виклик, тому свідомо РІДШЕ (раз на 2с), щоб не
  // перевантажувати сервер запитами на кожен рух (AUDIT-btw.md).
  useEffect(() => {
    if (phase !== 'scanning') return;

    scanTimerRef.current = setInterval(async () => {
      if (position == null || heading == null) return;
      const last = lastScanRef.current;
      const headingChanged = !last || Math.abs(last.heading - heading) > 3;
      const posChanged = !last || Math.abs(last.lat - position.lat) > 0.0001 || Math.abs(last.lng - position.lng) > 0.0001;
      if (!headingChanged && !posChanged) return;

      lastScanRef.current = { heading, lat: position.lat, lng: position.lng };
      // У4 ТЗ — застосовуємо накопичену персональну поправку ПЕРЕД відправкою на сервер
      // (сервер потім ще й сам застосовує У3 snap до вулиці, поверх уже скоригованого
      // значення — обидва механізми коректно комбінуються, як описано в
      // btw-geometry.util.ts).
      const correctedHeading = applyHeadingBias(heading, headingBiasRef.current);
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, heading: correctedHeading, headingSigma: 8 }),
        });
        if (res.ok) {
          const result = await res.json();
          // М2 ТЗ — зберігаємо fallback окремо, і якщо в цьому скані знову з'явився хоча б
          // один direct-кандидат, а fallback до цього був розкритий користувачем — коректно
          // згортаємо його назад з коротким сповіщенням (§4 ТЗ, "Найден прямой ракурс").
          const newDirect: Candidate[] = result.direct ?? [];
          setCandidates(newDirect);
          setFallbackCandidates(result.fallback ?? []);
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
          if (t.scans % 10 === 0) sendTelemetry();
        }
      } catch {
        // мовчазно ігноруємо — наступний тик спробує знову
      }
    }, 2000);

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [phase, position, heading, showFallback]);

  // Надсилає накопичені лічильники й скидає їх — §6 ТЗ "агрегаты сессии, без координат"
  // (жодних lat/lng тут немає навмисно). Викликається періодично (раз на 10 сканів) і при
  // виході з екрана сканування (exitLock/beforeunload), щоб не втратити "хвіст" сесії.
  async function sendTelemetry() {
    const t = telemetryRef.current;
    if (t.scans === 0) return;
    try {
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(t),
      });
    } catch {
      // не критично — телеметрія втрачається мовчки, не блокує основний UX
    }
    telemetryRef.current = { scans: 0, withCandidates: 0, locks: 0, snapUsed: false, fallbackOffered: 0, fallbackUsed: 0 };
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

    const targetLat = position.lat; // спрощено — сервер сам знає ціль по cameraId+bearingToTarget з попереднього /scan; тут для простоти MVP передаємо позицію+heading ще раз через thumb
    try {
      const res = await fetch('/api/thumb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cameraId: candidate.cameraId, targetLat, targetLng: position.lng }),
      });
      if (res.ok) {
        const data = await res.json();
        setThumbUrl(data.url);
        setLockedCandidate(candidate);
        setPhase('locked');
        telemetryRef.current.locks += 1;
        if ((navigator as any).vibrate) (navigator as any).vibrate(40);
      }
    } catch {
      // тихо ігноруємо — MVP
    }
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
      const res = await fetch('/api/refine', {
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
        {/* За прямим запитом користувача — окремий режим "міні-карта" (мітки камер і
            секторів огляду поблизу, панорамування двома пальцями, перемикач масштабу). */}
        <Link href="/map" className="text-sm text-gray-400 underline">
          Открыть карту камер поблизости
        </Link>
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
    return (
      <div className="relative min-h-screen bg-black text-white">
        {hasCamera && <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />}
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt="Camera feed"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: xrayOpacity / 100, mixBlendMode: 'screen' }}
          />
        )}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between rounded-lg bg-black/50 px-3 py-2 text-sm">
          <span>
            {Math.round(lockedCandidate.distanceM)} м · {lockedCandidate.orientationFit === 'OPPOSING' && '⚠️ встречный ракурс'}
          </span>
          <button onClick={exitLock} className="rounded-full bg-white/20 px-3 py-1">
            ✕
          </button>
        </div>
        <div className="absolute bottom-8 left-4 right-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-300">Прозрачность «рентген»: {xrayOpacity}%</label>
            <input type="range" min={0} max={100} value={xrayOpacity} onChange={(e) => setXrayOpacity(Number(e.target.value))} className="w-full" />
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
  return (
    <div className="relative min-h-screen bg-black text-white">
      {hasCamera ? (
        <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-center text-sm text-gray-400">
          Камера телефона недоступна — режим карты/списка (§3.2 ТЗ)
        </div>
      )}

      {/* За прямим запитом користувача — debug HUD: усе, що потрібно бачити ПРЯМО НА
          ТЕЛЕФОНІ під час М0-спайку (doc/AUDIT-btw.md) — без USB-дебагу консолі браузера.
          Кнопка переключення в правому верхньому куті, панель — під нею. */}
      <button onClick={() => setShowHud((v) => !v)} className="absolute top-2 right-2 z-10 rounded bg-black/60 px-2 py-1 text-[10px] text-gray-300">
        {showHud ? 'HUD ▲' : 'HUD ▼'}
      </button>
      {showHud && (
        <div className="absolute top-9 right-2 z-10 max-w-[220px] rounded bg-black/70 px-2 py-2 text-[10px] leading-snug text-gray-200">
          <div>GPS: {position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} (±${Math.round(position.accuracyM)}м)` : '—'}</div>
          {usedDevOverride && <div className="text-yellow-400">⚠️ используется подмена координат (dev)</div>}
          <div>Сырой азимут: {heading != null ? `${Math.round(heading)}°` : '—'}</div>
          <div>Гироскоп: {hasGyroRef.current ? 'активен' : 'нет данных'}</div>
          <div>Поправка (У4/У5): {headingBiasRef.current > 0 ? '+' : ''}{Math.round(headingBiasRef.current)}°</div>
          {scanDebug && (
            <>
              <div>После snap (У3): {scanDebug.snapped ? `${Math.round(scanDebug.effectiveHeading)}° (притянуто)` : `${Math.round(scanDebug.effectiveHeading)}° (без snap)`}</div>
              <div>Уличных направлений рядом: {scanDebug.streetCandidatesFound}</div>
              <div>Камер в радиусе 2.5км: {scanDebug.camerasInBbox}</div>
              <div>Прошли конус (Ф2): {scanDebug.coneSurvivors}</div>
              <div>Итоговых кандидатов: {scanDebug.finalCandidates}</div>
            </>
          )}
        </div>
      )}

      {/* Компас-стрічка замість Canvas-радара (§3.1.2 ТЗ, спрощення — див. AUDIT-btw.md) —
          показує позиції кандидатів відносно поточного напрямку погляду. */}
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

      <div className="absolute bottom-0 left-0 right-0 max-h-[45vh] overflow-y-auto rounded-t-2xl bg-black/70 p-4">
        {fallbackNotice && <p className="mb-2 text-center text-xs text-green-400">{fallbackNotice}</p>}

        {candidates.length === 0 && fallbackCandidates.length === 0 && (
          <p className="text-center text-sm text-gray-400">Кандидатов не найдено рядом с вами</p>
        )}

        {candidates.map((c) => (
          <button
            key={c.cameraId}
            onClick={() => handleLock(c)}
            className="mb-2 flex w-full items-center justify-between rounded-lg bg-white/10 px-4 py-3 text-left"
          >
            <span>{Math.round(c.distanceM)} м</span>
            <span className="text-xs text-gray-400">покрытие {Math.round(c.coverage * 100)}%</span>
          </button>
        ))}

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
              className="mb-2 flex w-full flex-col items-start rounded-lg border border-yellow-500/30 bg-white/10 px-4 py-3 text-left"
            >
              <div className="flex w-full items-center justify-between">
                <span>{Math.round(c.distanceM)} м</span>
                <span className="text-xs text-gray-400">покрытие {Math.round(c.coverage * 100)}%</span>
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

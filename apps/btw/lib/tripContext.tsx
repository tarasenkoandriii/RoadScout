'use client';

// Контекст поїздки (§2.2/§5 ТЗ, Этап 3) — ВИНЕСЕНО з `app/page.tsx` в окремий провайдер на
// рівні `app/layout.tsx` за прямим запитом користувача «должна переживать [навигацию] -
// исправь»: до цього стан поїздки (побудований маршрут, живий GPS, відхилення від маршруту,
// авто-ре-роутинг) жив у `useState` компонента `app/page.tsx`. Тап "Скан" на пункті "что
// впереди" (§2.2) — це перехід на інший роут (`/scan`) через `<Link>`, Next.js App Router
// РОЗМОНТОВУЄ поточну сторінку (інше піддерево дерева компонентів під тим самим `layout.tsx`),
// разом з нею гинув і весь стан, і сам виклик `navigator.geolocation.watchPosition`.
//
// `app/layout.tsx` — спільний предок УСІХ роутів цього застосунку (`/`, `/scan`, `/map`) і не
// розмонтовується при переходах МІЖ ними (лише при повному перезавантаженні сторінки браузером
// або закритті застосунку). Провайдер, змонтований тут, переживає будь-яку навігацію всередині
// BTW — і `watchPosition` продовжує РЕАЛЬНО працювати (не просто "стан збережено і відновлено
// заново"), поки користувач дивиться `/scan` чи `/map`.

import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ensureBtwSession } from './btwSession';
import { loggedFetch } from './networkLog';
import { nearestPointOnRoute } from './geometry';
import type { LatLng } from './geometry';

export type RoutingProfile = 'driving-car' | 'cycling-regular' | 'foot-walking';

// Клієнтське дзеркало типів `apps/api/src/btw/btw-route-forecast.service.ts` — той самий
// принцип дублювання клієнт/сервер, що вже `lib/geometry.ts` (мірор `common/geometry.util.ts`) —
// у проєкті немає спільного workspace-пакета типів, тож дублювання свідоме, не недогляд.
export interface CameraAlongRoute {
  id: string;
  name: string;
  streamUrl: string;
  streamType: string;
  confidence: string;
  status: string;
  lat: number;
  lng: number;
  azimuth: number;
  fovAngle: number;
  rangeMeters: number;
  offsetMeters: number;
  distanceToRouteM: number;
}

export interface IncidentAlongRoute {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  offsetMeters: number;
  distanceToRouteM: number;
}

export interface TrafficEventAlongRoute {
  id: string;
  lat: number;
  lng: number;
  description: string | null;
  severityLabel: string;
  offsetMeters: number;
  distanceToRouteM: number;
}

export interface TrafficForecast {
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  events: TrafficEventAlongRoute[];
}

export interface WeatherPoint {
  name: string;
  lat: number;
  lng: number;
  tempC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  visibilityM: number | null;
  weatherCode: number | null;
  conditionLabel: string;
  isHazard: boolean;
  observedAt: string | null;
}

export interface FixedRouteEncounter {
  cameraId: string;
  name: string;
  streamUrl: string;
  streamType: string;
  etaSeconds: number;
  distanceMeters: number;
  confidence: number;
  cameraLat: number;
  cameraLng: number;
  cameraAzimuth: number;
  cameraSpeed: number;
}

export interface RouteResult {
  points: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  camerasAlongRoute: CameraAlongRoute[];
  weather: WeatherPoint | null;
  incidents: IncidentAlongRoute[];
  traffic: TrafficForecast;
  fixedRouteEncounters: FixedRouteEncounter[];
}

// §9 п.3 ТЗ — підтверджено користувачем прямим питанням при реалізації Этапу 3 (§5.2 ⚠️ ЧЕСНО
// вимагало саме такого підтвердження): ЄДИНИЙ поріг 200м і для індикатора "вы отклонились", і
// як тригер авто-ре-роутингу (§5.3).
export const DEVIATION_THRESHOLD_M = 200;

// §5.3 ТЗ — "не чаще одного пересчёта в 15-20 секунд" — ⚠️ ЧЕСНО, стартова невідкалібрована
// величина (ТЗ саме так це й позначає), верхня межа запропонованого діапазону.
export const REROUTE_COOLDOWN_MS = 20_000;

// §5.1 ТЗ — "следующие ~500м-1км или ~2-5 минут пути" — середина заявленого діапазону, точне
// число не зафіксоване документом.
export const AHEAD_WINDOW_M = 800;

// Невеликий "хвіст" позаду поточної позиції — GPS-похибка/затримка фікса може показати точку,
// яку користувач щойно проїхав, як "ще попереду" на межі похибки; без цього список "що
// попереду" смикався б (пункт то з'являється, то зникає) на кожному дрібному коливанні фікса.
export const AHEAD_BACK_TOLERANCE_M = 50;

// Мапить HTTP-статус/код помилки з POST /api/route (§ детальний розбір — btw.service.ts::
// buildRoute() і openrouteservice.service.ts::OpenRouteServiceError) на конкретне російськомовне
// повідомлення — щоб користувач бачив РІЗНИЦЮ між "маршрут між цими точками неможливий" і
// "сервер тимчасово недоступний", а не єдиний загальний "щось пішло не так".
function describeRouteError(status: number, code?: string): string {
  if (code === 'not_configured' || code === 'invalid_key') {
    return 'Маршрутизация временно недоступна: сервер не настроен (нет ключа OpenRouteService) — сообщите администратору.';
  }
  if (code === 'rate_limited' || status === 429) {
    return 'Слишком много запросов маршрута — подождите минуту и попробуйте снова.';
  }
  if (code === 'no_route' || status === 400) {
    return 'Между точками А и Б не удалось построить маршрут — проверьте, что обе точки указаны верно.';
  }
  return 'OpenRouteService временно недоступен — попробуйте построить маршрут позже.';
}

// Клієнтське дзеркало `apps/api/src/btw/btw-route-forecast.service.ts` типів + POST /api/route
// виклику — module-scope функція, бо викликається з ДВОХ місць: initial "Построить маршрут"
// (buildRoute нижче) і авто-ре-роутинг під час поїздки (triggerReroute) — щоб не дублювати
// парсинг відповіді/обробку помилок двічі.
async function fetchRoute(
  pointA: { lat: number; lng: number },
  pointB: { lat: number; lng: number },
  profile: RoutingProfile,
  signal?: AbortSignal,
): Promise<{ ok: true; result: RouteResult } | { ok: false; error: string }> {
  const res = await loggedFetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pointA, pointB, profile }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null as any);
    return { ok: false, error: describeRouteError(res.status, data?.code) };
  }
  const data = await res.json();
  const points: LatLng[] = Array.isArray(data?.points)
    ? data.points.filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
    : [];
  return {
    ok: true,
    result: {
      points,
      distanceMeters: data.distanceMeters,
      durationSeconds: data.durationSeconds,
      camerasAlongRoute: Array.isArray(data?.camerasAlongRoute) ? data.camerasAlongRoute : [],
      weather: data?.weather ?? null,
      incidents: Array.isArray(data?.incidents) ? data.incidents : [],
      traffic: data?.traffic ?? { source: null, configured: false, events: [] },
      fixedRouteEncounters: Array.isArray(data?.fixedRouteEncounters) ? data.fixedRouteEncounters : [],
    },
  };
  // ЧЕСНО: помилки мережі (включно з AbortError від скасованого запиту, §5.3 анти-race) НЕ
  // ловляться тут навмисно — прокидаються викликачу як виняток, бо buildRoute і triggerReroute
  // мають РІЗНУ поведінку на AbortError (перший його ніколи не отримає, бо не передає signal;
  // другий — має розрізняти "скасовано новішим викликом" від "справжня помилка").
}

// §5.1/§2.2 ТЗ — "что впереди" під час поїздки: камери/інциденти/трафік, чия позиція вздовж
// маршруту (`offsetMeters`, вже пораховано сервером) потрапляє у вікно попереду поточної позиції
// користувача. FIXED_ROUTE-зустрічі (трамваї) свідомо НЕ тут — у них немає стабільного
// `offsetMeters` вздовж маршруту (це прогноз рухомої цілі, сортується за `etaSeconds`, не за
// позицією) — показуються окремим блоком, той самий підхід, що вже був у до-поїздковій секції
// "Вдоль маршрута".
export interface AheadItem {
  key: string;
  kind: 'camera' | 'incident' | 'traffic';
  label: string;
  sublabel: string;
  offsetMeters: number;
  lat: number;
  lng: number;
}

function buildAheadItems(route: RouteResult, currentOffsetM: number): AheadItem[] {
  const items: AheadItem[] = [];

  for (const c of route.camerasAlongRoute) {
    items.push({
      key: `camera:${c.id}`,
      kind: 'camera',
      label: c.name,
      sublabel: `камера в ${Math.round(c.distanceToRouteM)}м от дороги`,
      offsetMeters: c.offsetMeters,
      lat: c.lat,
      lng: c.lng,
    });
  }
  for (const i of route.incidents) {
    items.push({
      key: `incident:${i.id}`,
      kind: 'incident',
      label: i.title,
      sublabel: `${i.type} · ${i.severity}`,
      offsetMeters: i.offsetMeters,
      lat: i.lat,
      lng: i.lng,
    });
  }
  for (const t of route.traffic.events) {
    items.push({
      key: `traffic:${t.id}`,
      kind: 'traffic',
      label: t.description ?? 'Событие на дороге',
      sublabel: t.severityLabel,
      offsetMeters: t.offsetMeters,
      lat: t.lat,
      lng: t.lng,
    });
  }

  return items
    .filter((it) => it.offsetMeters >= currentOffsetM - AHEAD_BACK_TOLERANCE_M && it.offsetMeters <= currentOffsetM + AHEAD_WINDOW_M)
    .sort((a, b) => a.offsetMeters - b.offsetMeters);
}

export const AHEAD_KIND_ICON: Record<AheadItem['kind'], string> = { camera: '📷', incident: '⚠️', traffic: '🚦' };

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} км` : `${Math.round(meters)} м`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

interface TripContextValue {
  routeResult: RouteResult | null;
  routeLoading: boolean;
  routeError: string | null;
  buildRoute: (pointA: { lat: number; lng: number }, pointB: { lat: number; lng: number }, profile: RoutingProfile) => Promise<void>;
  clearRoute: () => void;
  tripActive: boolean;
  tripLocation: LatLng | null;
  tripOffsetM: number | null;
  tripDeviationM: number | null;
  rerouting: boolean;
  tripError: string | null;
  tripDestinationLabel: string | null;
  startTrip: (destination: { lat: number; lng: number }, label: string | undefined, profile: RoutingProfile) => void;
  stopTrip: () => void;
  manualReroute: () => void;
  aheadItems: AheadItem[];
}

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: ReactNode }) {
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [tripActive, setTripActive] = useState(false);
  const [tripLocation, setTripLocation] = useState<LatLng | null>(null);
  const [tripOffsetM, setTripOffsetM] = useState<number | null>(null);
  const [tripDeviationM, setTripDeviationM] = useState<number | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);
  const [tripDestinationLabel, setTripDestinationLabel] = useState<string | null>(null);

  // Довгоживучий `watchPosition` callback (реєструється ОДИН раз у startTrip) не повинен читати
  // `routeResult`/профіль/точку Б напряму через замикання — після ре-роутингу ці стейти
  // зміняться, а callback лишиться зі старим значенням. Тому — реф, синхронізований ефектом
  // нижче (routePointsRef), і рефи, зафіксовані РІВНО в момент старту поїздки.
  const routePointsRef = useRef<LatLng[]>([]);
  const tripDestinationRef = useRef<{ lat: number; lng: number } | null>(null);
  const tripProfileRef = useRef<RoutingProfile>('driving-car');
  const watchIdRef = useRef<number | null>(null);
  const lastRerouteTriggerAtRef = useRef(0);
  const rerouteAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    routePointsRef.current = routeResult?.points ?? [];
  }, [routeResult]);

  // Провайдер живе в `app/layout.tsx` — розмонтовується практично лише при закритті
  // застосунку/повному перезавантаженні сторінки (не при навігації між `/`/`/scan`/`/map`,
  // §-коментар зверху файлу). Цей cleanup лишений як добра практика/захист від memory leak на
  // випадок закриття вкладки під час активної поїздки.
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      rerouteAbortControllerRef.current?.abort();
    };
  }, []);

  // §5.3 ТЗ, механіка п.2 — виклик OpenRouteService з новою точкою А = поточна GPS-позиція,
  // тією ж точкою Б. Анти-race (§5.3, "переиспользует ScanSupersededError/lastScanRef паттерн"):
  // AbortController скасовує ще не завершений попередній виклик, а порівняння рефа після await —
  // друга лінія захисту на випадок, якщо скасована відповідь усе ж встигла прийти.
  const triggerReroute = useCallback(async (fix: LatLng) => {
    const destination = tripDestinationRef.current;
    if (!destination) return;

    rerouteAbortControllerRef.current?.abort();
    const controller = new AbortController();
    rerouteAbortControllerRef.current = controller;

    setRerouting(true);
    setTripError(null);

    let outcome: Awaited<ReturnType<typeof fetchRoute>> | null;
    try {
      outcome = await fetchRoute(fix, destination, tripProfileRef.current, controller.signal);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        outcome = null; // скасовано новішим викликом triggerReroute — новіший сам оновить стан, тут просто виходимо
      } else {
        outcome = { ok: false, error: 'Не удалось построить новый маршрут — проверьте соединение.' };
      }
    }

    if (rerouteAbortControllerRef.current !== controller) return; // цей виклик уже не актуальний
    setRerouting(false);
    if (!outcome) return;
    if (outcome.ok) setRouteResult(outcome.result);
    else setTripError(outcome.error);
  }, []);

  // §5.2 ТЗ — рахується на КОЖЕН GPS-фікс: `offsetMeters` (де користувач вздовж маршруту, для
  // "что впереди" §5.1) і `distanceToRouteM` (наскільки відхилився, §5.2). Клієнтський
  // `nearestPointOnRoute()` (lib/geometry.ts) — без round-trip до сервера на кожен тик.
  const handleTripFix = useCallback(
    (fix: LatLng) => {
      setTripLocation(fix);
      const route = routePointsRef.current;
      if (route.length < 2) return;

      const { offsetMeters, distanceToRouteM } = nearestPointOnRoute(route, fix);
      setTripOffsetM(offsetMeters);
      setTripDeviationM(distanceToRouteM);

      if (distanceToRouteM > DEVIATION_THRESHOLD_M) {
        const now = Date.now();
        if (now - lastRerouteTriggerAtRef.current >= REROUTE_COOLDOWN_MS) {
          lastRerouteTriggerAtRef.current = now;
          triggerReroute(fix);
        }
      }
    },
    [triggerReroute],
  );

  // ОНОВЛЕНО — за прямим запитом користувача «маршрутизация не вызывается — ключа
  // OpenRouteService пока нет (§6.3) исправь»: реальний виклик POST /api/route, а не статична
  // заглушка. `loggedFetch`, не голий fetch — той самий принцип, що і в lib/btwSavedPlaces.ts
  // (запит має бути видимий у Log-панелі).
  const buildRoute = useCallback(
    async (pointA: { lat: number; lng: number }, pointB: { lat: number; lng: number }, profile: RoutingProfile) => {
      setRouteLoading(true);
      setRouteError(null);
      setRouteResult(null);
      try {
        await ensureBtwSession();
        const outcome = await fetchRoute(pointA, pointB, profile);
        if (outcome.ok) setRouteResult(outcome.result);
        else setRouteError(outcome.error);
      } catch {
        // Мережевий збій (не HTTP-помилка з розпізнаваним кодом) — той самий чесний підхід, що
        // вже в lib/btwSavedPlaces.ts. `fetchRoute()` тут викликається БЕЗ `signal` — AbortError
        // сюди дійти не може, це завжди "справжня" мережева помилка.
        setRouteError('Не удалось связаться с сервером — проверьте соединение и попробуйте ещё раз.');
      } finally {
        setRouteLoading(false);
      }
    },
    [],
  );

  const clearRoute = useCallback(() => {
    setRouteResult(null);
    setRouteError(null);
  }, []);

  function startTrip(destination: { lat: number; lng: number }, label: string | undefined, profile: RoutingProfile) {
    // Захист від повторного виклику (аудит 2026-08-06) — напр. подвійний тап на "Начать
    // поездку" до того, як React встиг сховати кнопку після `setTripActive(true)`. Без цього
    // другий виклик перезаписав би `watchIdRef.current` НОВИМ id, і ПЕРШИЙ виклик
    // `watchPosition` ніколи б не отримав `clearWatch()` — лишався б активним (витрачаючи
    // батарею й дублюючи обробку кожного GPS-фікса через `handleTripFix`) аж до закриття
    // застосунку. Тут — просте "прибрати попередній watch перед стартом нового", безумовно.
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    tripDestinationRef.current = destination;
    tripProfileRef.current = profile;
    lastRerouteTriggerAtRef.current = 0;
    setTripDestinationLabel(label ?? null);
    setTripError(null);
    setTripDeviationM(null);
    setTripOffsetM(null);
    setTripActive(true);

    const id = navigator.geolocation.watchPosition(
      (pos) => handleTripFix({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setTripError('Живая геолокация недоступна — «что впереди» и отклонение от маршрута обновляться не будут.'),
      { enableHighAccuracy: true },
    );
    watchIdRef.current = id;
  }

  function stopTrip() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    rerouteAbortControllerRef.current?.abort();
    rerouteAbortControllerRef.current = null;
    tripDestinationRef.current = null;
    setTripActive(false);
    setRerouting(false);
    setTripDeviationM(null);
    setTripOffsetM(null);
    setTripLocation(null);
    setTripError(null);
    setTripDestinationLabel(null);
    // ДОДАНО (аудит 2026-08-06) — раніше `routeResult` НЕ скидався при завершенні поїздки. Якщо
    // під час поїздки стався хоча б один авто-ре-роутинг (§5.3), `routeResult` містив маршрут,
    // побудований від довільної GPS-позиції в момент ре-роутингу, а не від початкової точки А.
    // Без скидання — одразу після "Завершить поездку" планувальна UI (`!tripActive` гілка
    // `app/page.tsx`) бачила б цей "чужий" маршрут ще актуальним (картка дистанції/часу і кнопка
    // "▶ Начать поездку" з'являлись би одразу знову) — дозволяючи мовчки почати нову поїздку по
    // застарілій геометрії, не натиснувши "Построить маршрут" повторно.
    clearRoute();
  }

  // §5.3 ТЗ — "ручной путь остаётся": користувач може перебудувати маршрут вручну, не чекаючи
  // автоматичного порогу 200м (наприклад, побачив затор на око). Переиспользує той самий
  // triggerReroute(), що й авто-ре-роутинг — жодної окремої логіки.
  function manualReroute() {
    if (tripLocation) triggerReroute(tripLocation);
  }

  const aheadItems = tripActive && routeResult && tripOffsetM != null ? buildAheadItems(routeResult, tripOffsetM) : [];

  const value: TripContextValue = {
    routeResult,
    routeLoading,
    routeError,
    buildRoute,
    clearRoute,
    tripActive,
    tripLocation,
    tripOffsetM,
    tripDeviationM,
    rerouting,
    tripError,
    tripDestinationLabel,
    startTrip,
    stopTrip,
    manualReroute,
    aheadItems,
  };

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip() must be used within <TripProvider> (see app/layout.tsx)');
  return ctx;
}

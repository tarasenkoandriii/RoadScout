// Beyond the Wall (BTW) — геометричне ядро, §4.3–§4.6 ТЗ (doc/BTW-tz.md).
//
// ⚠️ ЧЕСНО (див. doc/AUDIT-btw.md): ТЗ проєктує ці обчислення як isomorphic-пакет
// @btw/geometry, що виконується і на клієнті (Web Worker поверх PMTiles), і на сервері
// (фолбек /btw/scan). У цьому кроці реалізовано ТІЛЬКИ серверну частину — клієнтський Web
// Worker, PMTiles-пайплайн і офлайн-тайли НЕ реалізовані (величезний окремий обсяг роботи,
// що вимагає завантаження реальних даних OSM і тестування на реальних пристроях — М0-спайк
// із самого ТЗ, який неможливо виконати в цьому середовищі). Даний модуль коректно
// реалізує саму математику з §4.3–§4.6 — коли клієнтський Worker буде реалізовано, ця сама
// логіка (чи прямий порт на TS/WASM) використовуватиметься і там.
//
// Друга свідома відмінність від ТЗ: LOS-тест (Ф3, §4.5) тут виконується через уже наявний
// OcclusionService (живі запити до Overpass API), а не через попередньо завантажені тайли
// зданий з R-tree-індексом. Це повільніше (мережевий виклик замість <1мс локально), але дає
// РЕАЛЬНУ перевірку видимості вже зараз, без необхідності будувати весь PMTiles-пайплайн.

import { LatLng, haversineDistance, bearing, angularDiff, destinationPoint, cameraSeesPoint, CameraSector } from '../common/geometry.util';

export interface ObserverPose {
  lat: number;
  lng: number;
  accuracyM: number;
  heading: number; // істинний азимут (після компенсації магнітного схилення — див. buildManifest())
  headingSigma: number;
  eyeHeightM?: number;
}

export interface TargetZone {
  point: LatLng;
  radiusM: number;
  distanceM: number;
  occluded: boolean; // true, якщо на цьому напрямку реально знайдено перешкоду (див. AUDIT-btw.md — спрощено без findOccluder(), бо немає локальних даних про будівлі на сервері без Overpass-виклику для КОЖНОЇ точки на промені)
}

// §4.4 ТЗ — адаптивний кутовий допуск: чим гірший GPS і чим ближче ціль, тим ширший конус.
export function angularTolerance(accuracyM: number, targetDistanceM: number, headingSigma: number): number {
  const fromAccuracy = (Math.atan2(accuracyM, targetDistanceM) * 180) / Math.PI;
  const raw = fromAccuracy + headingSigma;
  return Math.max(10, Math.min(35, raw));
}

// Верхня межа target.radiusM (див. computeTargetZone нижче) — ВИНЕСЕНО в іменовану експортовану
// константу (за прямим запитом користувача, під час діагностики "Цель вне радиуса действия
// камеры" попри "покрытие 100%" у списку сканування): раніше це число (120) було вписане
// одразу у ДВОХ місцях — тут і в BtwService.assertWithinConeOfCamera() — як незалежні "магічні"
// літерали. Ф2 (passesConeFilter нижче) дозволяє кандидату потрапити у список сканування, якщо
// його дистанція в межах `camera.rangeMeters + target.radiusM`; assertWithinConeOfCamera()
// раніше не мала жодного допуску взагалі, тож кандидат з дистанцією саме в цьому проміжку
// коректно ПОКАЗУВАВСЯ, але ЗАВЖДИ провалював реальний тап. Спільна константа гарантує, що
// обидві перевірки лишаться синхронізованими надалі, а не розійдуться знову при майбутній
// правці однієї з них.
export const MAX_TARGET_RADIUS_M = 120;

// §4.3 ТЗ — ціль ставиться за замовчуванням на фіксовану дистанцію вздовж променя погляду.
// ⚠️ Спрощення (див. AUDIT-btw.md): справжній findOccluder() (§4.2) потребує геометрії
// будівель на промені — на сервері без завантажених тайлів це означало б Overpass-запит
// вздовж усього променя (дорого й повільно). Тут ціль ставиться на фіксовані 250м (той самий
// дефолт, що ТЗ використовує для режиму OPEN_VIEW, коли окклюдер не знайдено) — і, якщо
// потрібно перевірити конкретну відому адресу/точку (напр. режим "Перископ по адресу", §3.3),
// викликач може передати targetOverride напряму.
export function computeTargetZone(observer: LatLng, heading: number, opts?: { targetOverride?: LatLng; occluderDistanceM?: number }): TargetZone {
  const DEFAULT_OPEN_VIEW_DISTANCE_M = 250;
  const MAX_DISTANCE_M = 400;

  const distanceM = opts?.occluderDistanceM != null ? Math.min(opts.occluderDistanceM + 60, MAX_DISTANCE_M) : DEFAULT_OPEN_VIEW_DISTANCE_M;

  const point = opts?.targetOverride ?? destinationPoint(observer, heading, distanceM);
  const actualDistance = opts?.targetOverride ? haversineDistance(observer, opts.targetOverride) : distanceM;
  const radiusM = Math.max(25, Math.min(MAX_TARGET_RADIUS_M, actualDistance * Math.tan((15 * Math.PI) / 180)));

  return { point, radiusM, distanceM: actualDistance, occluded: opts?.occluderDistanceM != null };
}

export type OrientationFitLabel = 'ALIGNED' | 'SIDE' | 'OPPOSING';

export function classifyOrientationFit(cameraAzimuth: number, userHeading: number): OrientationFitLabel {
  const delta = angularDiff((cameraAzimuth + 180) % 360, userHeading); // камера "дивиться назустріч" користувачу, коли її азимут ПРОТИЛЕЖНИЙ погляду користувача
  if (delta <= 45) return 'ALIGNED';
  if (delta <= 135) return 'SIDE';
  return 'OPPOSING';
}

export interface CandidateInput extends CameraSector {
  id: string;
  heightMeters: number | null;
  status: string;
  updatedAt: Date;
  qualityHint?: number; // 0..1, необов'язково — див. AUDIT-btw.md, поки що дефолт 0.5 (немає окремого поля "разрешение" у Camera)
}

export interface RankedCandidate {
  cameraId: string;
  distanceM: number;
  bearingToTarget: number;
  coverage: number;
  orientationFit: OrientationFitLabel;
  score: number;
  // За прямим запитом користувача — раніше клієнт (apps/btw/app/page.tsx, "ракурс camera vs
  // телефона" підказка в locked-view, і components/BtwRadar.tsx, сектори на радарі)
  // НЕ мав справжнього азимута камери й наближав його через bearingToTarget — похибка цього
  // наближення сягає fovAngle/2 (реально спостережено ~84° розбіжності на камері, чий
  // orientationFit сервер класифікував як ALIGNED — суперечність, яку користувач помітив на
  // скріні). Тепер віддаємо cam.azimuth напряму — той самий, що вже й classifyOrientationFit()
  // використовує, тож візуалізації клієнта завжди узгоджені з категорією.
  cameraAzimuth: number;
}

// §4.5 ТЗ, Ф2 — геометрія конуса без окклюзії. cameraSeesPoint() з common/geometry.util.ts
// вже реалізує саме цю перевірку (дистанція ≤ range І кут ≤ fov/2) — тут лише додаємо запас
// на радіус цільової зони r_T, як у формулі ТЗ (`|Δaz| ≤ fov_h/2 + atan2(r_T, d_ct)`).
//
// ВИПРАВЛЕНО (реальний баг, знайдений користувачем — "приложение часто пишет кандидатов не
// найдено, а рядом 10 камер"): angularTolerance() (§4.4 ТЗ, нижче) — "чим гірший GPS і чим
// ближче ціль, тим ширший конус" — була написана, але НІКОЛИ фактично не викликалася звідси
// (мертвий код, перевірено grep по всьому apps/api). Через це конус узагалі не мав запасу на
// headingSigma (похибку компаса, яку клієнт сам і рахує та шле у /scan) — на пристроях БЕЗ
// гироскопа (всі скріни користувача показують "Гироскоп: нет данных", лише медіанний фільтр
// по 5 відліках без ф'южна) звичайний шум магнітометра в кілька градусів був досить, щоб
// кандидат щотика "зникав/з'являвся" — саме симптом "то находит то не находит". Тепер
// headingUncertaintyDeg (з angularTolerance()) реально додається до допуску конуса.
export function passesConeFilter(cam: CameraSector, target: TargetZone, headingUncertaintyDeg = 0): boolean {
  const distanceM = haversineDistance(cam, target.point);
  if (distanceM > cam.rangeMeters + target.radiusM) return false;
  const bearingToTarget = bearing(cam, target.point);
  const toleranceExtra = (Math.atan2(target.radiusM, Math.max(1, distanceM)) * 180) / Math.PI;
  return angularDiff(bearingToTarget, cam.azimuth) <= cam.fovAngle / 2 + toleranceExtra + headingUncertaintyDeg;
}

// §4.6 ТЗ — скоринг і ранжування. Ваги узяті прямо з ТЗ.
export function computeScore(params: {
  coverage: number;
  orientationFit: OrientationFitLabel;
  ageSeconds: number;
  quality: number; // 0..1
  distanceM: number;
  popularity: number; // 0..1, згладжений CTR — див. AUDIT-btw.md, поки що завжди 0 (немає накопиченої статистики)
}): number {
  const orientationScore = params.orientationFit === 'ALIGNED' ? 1 : params.orientationFit === 'SIDE' ? 0.5 : 0.1;
  const freshness = 1 - Math.min(1, params.ageSeconds / 120);
  const proximity = 1 - Math.min(1, params.distanceM / 2500);

  return (
    0.35 * params.coverage +
    0.2 * orientationScore +
    0.15 * freshness +
    0.12 * params.quality +
    0.1 * proximity +
    0.08 * params.popularity
  );
}

// §4.5 ТЗ — "coverage без полігонів": 9 точок (центр + 8 по колу r_T), частка видимих. Тут
// приймає вже готовий масив результатів LOS-перевірки (isVisible виконується викликачем,
// асинхронно, через OcclusionService — див. коментар на початку файлу).
export function computeCoverageFromSamples(visibleFlags: boolean[]): number {
  if (visibleFlags.length === 0) return 0;
  return visibleFlags.filter(Boolean).length / visibleFlags.length;
}

// Генерує 9 точок для сэмплювання coverage (центр + 8 по колу) — той самий підхід, що в ТЗ.
export function sampleTargetZonePoints(target: TargetZone): LatLng[] {
  const points: LatLng[] = [target.point];
  for (let i = 0; i < 8; i++) {
    points.push(destinationPoint(target.point, (i * 360) / 8, target.radiusM));
  }
  return points;
}

// У3 ТЗ (§5, doc/BTW-tz.md) — "привязка к уличной сети": якщо виміряний компасом азимут
// потрапляє в межах ±20° від одного з "дозволених" напрямків вулиці (candidates — з
// AzimuthHeuristicService.getNearbyStreetAzimuths()) — притягуємо його точно до цього
// напрямку. Це прибирає більшість систематичної помилки магнітометра БЕЗПЛАТНО (без AI,
// без гироскопа) — саме тому ТЗ називає це "главным приёмом".
export interface SnapResult {
  heading: number; // притягнутий (або початковий, якщо притягування не відбулось) азимут
  snapped: boolean;
  snappedTo: number | null;
}

export function snapHeadingToStreetGrid(measuredHeading: number, streetCandidates: number[], toleranceDeg = 20): SnapResult {
  let best: { candidate: number; diff: number } | null = null;

  for (const candidate of streetCandidates) {
    const raw = Math.abs(measuredHeading - candidate) % 360;
    const diff = Math.min(raw, 360 - raw);
    if (diff <= toleranceDeg && (best === null || diff < best.diff)) {
      best = { candidate, diff };
    }
  }

  if (best === null) {
    return { heading: measuredHeading, snapped: false, snappedTo: null };
  }
  return { heading: best.candidate, snapped: true, snappedTo: best.candidate };
}

// У4 ТЗ (§5, doc/BTW-tz.md) — "калибровка по кандидату": якщо користувач ВРУЧНУ вибрав
// кандидата зі списку (а не "спіймав" його автоматичним вирівнюванням компаса) — різниця між
// реальним азимутом на цього кандидата і показанням компаса в цей момент є прямим виміром
// систематичної помилки компаса ЦЬОГО КОНКРЕТНОГО користувача/пристрою/локації прямо зараз.
// Зберігається як headingBias "на сессию (с затуханием)" — ⚠️ СПРОЩЕННЯ (див.
// doc/AUDIT-btw.md): у ТЗ це мало б жити в isomorphic @btw/geometry, викликатись і
// клієнтом (Web Worker), і сервером; тут — client-only (React-стан у apps/btw), оскільки
// "сессия" за своєю природою — саме клієнтський, ефемерний стан, серверу нема сенсу його
// зберігати (він і так пропадає при перезапуску застосунку, як і хоче ТЗ).

// Різниця між азимутом на кандидата (bearingToTarget з RankedCandidate) і виміряним компасом
// у момент вибору — нормалізована до -180..180 (напрямок і величина помилки одночасно).
export function computeHeadingBias(candidateBearing: number, measuredHeading: number): number {
  return ((candidateBearing - measuredHeading + 540) % 360) - 180;
}

// Згладжене оновлення поправки — "с затуханием" з ТЗ: НЕ просто перезаписуємо попередню
// поправку новою (один хибний тап зламав би всю калібровку), а змішуємо з вагою decay для
// нового виміру. decay=0.3 -> потрібно кілька узгоджених тапів поспіль, щоб поправка суттєво
// зрушила, але вона й не "застрягає" назавжди на одному старому вимірі.
export function blendHeadingBias(previousBias: number, newBias: number, decay = 0.3): number {
  return previousBias * (1 - decay) + newBias * decay;
}

// Застосування поточної збереженої поправки до сирого виміру компаса — викликається ПЕРЕД
// У3 (snapHeadingToStreetGrid), щоб обидва механізми коректно комбінувались (спершу
// персональна поправка усуває систематичну помилку конкретного пристрою, потім snap
// притягує до вулиці, якщо все ще є невеликий залишковий шум).
export function applyHeadingBias(measuredHeading: number, bias: number): number {
  return (measuredHeading + bias + 360) % 360;
}

// У2 ТЗ (§5, doc/BTW-tz.md) — "Фильтрация". Два окремих механізми, саме як у ТЗ:
// (1) медіанний фільтр по вікну 5 відліків проти одиничних викидів магнітометра;
// (2) комплементарний фільтр гироскоп+магнітометр — гироскоп дає швидку, малодрейфуючу
// зміну на секундах, магнітометр — повільну корекцію абсолютного значення.
//
// ⚠️ ЧЕСНО (див. doc/AUDIT-btw.md): математика тут повністю детермінована й реально
// протестована на синтетичних даних. НЕ підтверджено живим пристроєм: (а) чи взагалі
// доступний `DeviceMotionEvent.rotationRate` у Telegram WebView (той самий М0-спайк, що і
// для DeviceOrientation); (б) чи ось це конкретне значення α=0.94 з ТЗ добре підходить для
// реальних сенсорів конкретних пристроїв — це орієнтовний коефіцієнт із самого ТЗ, який
// варто підібрати емпірично після живого тестування.

// Циклічна відстань між двома кутами (0-180°, коротший шлях по колу).
function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

// "Медіанний фільтр" для кутових величин — класичний медіан не визначений коректно для
// циклічних даних (сортування ламається на переході 359°→0°), тому використовуємо
// медоїд: серед самих відліків обираємо той, що має найменшу СУМАРНУ циклічну відстань до
// решти — той самий сенс, що медіана (стійкість до одиничних викидів), коректно для кутів.
export function circularMedianFilter(samples: number[]): number {
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

// Один крок комплементарного фільтра. Працює в "домені різниці" (не буквальному зваженому
// середньому двох кутів, яке ламається на переході 0°/360°): спершу інтегруємо гироскоп від
// попереднього стану (швидка, малодрейфуюча оцінка), потім коригуємо результат невеликою
// часткою (1-α) різниці з магнітометром (повільна корекція абсолютного дрейфу).
export function complementaryFilterStep(prevHeading: number, gyroZDegPerSec: number, dtSeconds: number, magHeadingFiltered: number, alpha = 0.94): number {
  const gyroEstimate = (prevHeading + gyroZDegPerSec * dtSeconds + 360) % 360;
  const diff = ((magHeadingFiltered - gyroEstimate + 540) % 360) - 180; // -180..180, коротший шлях
  return (gyroEstimate + (1 - alpha) * diff + 360) % 360;
}

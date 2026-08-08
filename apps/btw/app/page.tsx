'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocation } from '../lib/locationContext';
import { listSavedPlaces } from '../lib/btwSavedPlaces';
import type { SavedPlace } from '../lib/btwSavedPlaces';
import BtwPlacePicker from '../components/BtwPlacePicker';
import type { PickedPlace } from '../components/BtwPlacePicker';
import {
  useTrip,
  formatDistance,
  formatDuration,
  AHEAD_KIND_ICON,
  AHEAD_WINDOW_M,
  DEVIATION_THRESHOLD_M,
} from '../lib/tripContext';
import type { RoutingProfile } from '../lib/tripContext';

// Leaflet звертається до window/document — SSR вимкнено, той самий патерн, що вже /map
// (app/map/page.tsx) і admin/components/SectorMap.tsx.
const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

// Beyond the Wall (BTW) — НОВИЙ головний екран: планування маршруту (doc/TZ-btw-route-
// planning.md). За прямим запитом користувача — «сверстать главное окно мини апп в стиле
// скрина - в рамках тз», скрін-приклад — головний екран Uklon (тёмна тема, картка мапи, поле
// "звідки/куди" з крапками-маркерами, ряд швидких дій зверху, список збережених місць знизу).
//
// ⚠️ ЧЕСНО — що це ЗА МЕЖАМИ верстки цього кроку (детальний розбір — doc/AUDIT-btw-route-
// planning.md, новий розділ):
// - ОНОВЛЕНО — за прямим запитом користувача «маршрутизация не вызывается — ключа
//   OpenRouteService пока нет (§6.3) исправь»: виклик маршрутизатора (OpenRouteService,
//   §6.1/§6.3 ТЗ) ТЕПЕР ПІДКЛЮЧЕНИЙ (handleBuildRoute нижче — реальний POST /api/route, серверна
//   частина — apps/api/src/routing/openrouteservice.service.ts). Без ключа на сервері
//   (OPENROUTESERVICE_API_KEY порожній у .env) ендпоінт повертає 503 з чесним кодом причини —
//   клієнт показує це як звичайну помилку побудови маршруту, не як "фічі ще немає".
// - Пошук адреси за назвою (геокодинг) не підключений до цього екрана — вибір точки А/Б працює
//   лише через "поточне місцезнаходження" / збережені місця / ручний ввід координат (детальний
//   розбір — components/BtwPlacePicker.tsx).
// - Збережені місця (§3.1 ТЗ) — вже серверна модель `SavedPlace` (детальний розбір —
//   lib/btwSavedPlaces.ts), не localStorage.
// - ОНОВЛЕНО — за прямим запитом користувача «полностью реализовать п 1 и п 2 по тз» (§8 ТЗ,
//   Этапы 1-2): камери вдовж маршруту (§4.1/§4.2), погода/інциденти/живий трафік 511NY/TomTom
//   route-aware (§7.1/§7.2) і зустрічі з FIXED_ROUTE-камерами через `/lookahead` (§4.3) тепер
//   ПІДКЛЮЧЕНІ — той самий POST /api/route повертає їх разом із геометрією маршруту (сервер —
//   `apps/api/src/btw/btw-route-forecast.service.ts`), і вони рендеряться прямо на цьому ж
//   екрані секцією "Вдоль маршрута" нижче кнопки — ОКРЕМОГО "екрана результату" (§2.1 крок 5, з
//   по-кроковими інструкціями тощо) як самостійного роута/сторінки як НЕ БУЛО зверстано, так і
//   досі немає — ТЗ §8 Этап 1/2 вимагає саме показати ці дані на головному екрані, не
//   обов'язково окремим екраном.
// - ОНОВЛЕНО — за прямим запитом користувача «полностью реализовать п 3 и п 4 по тз» (§8 ТЗ):
//   "Сопровождение в поездке" (§2.2/§5, Этап 3) тепер ПІДКЛЮЧЕНЕ — кнопка "Начать поездку"
//   (§2.1 крок 6) з'являється після побудови маршруту, вмикає живий `watchPosition`, рахує
//   відхилення від маршруту (§5.2, поріг 200м — ЄДИНИЙ для індикатора і авто-ре-роутингу,
//   підтверджено користувачем прямим питанням при реалізації цього кроку, як і вимагало ⚠️ ЧЕСНО
//   §5.2 ТЗ), автоматично перебудовує маршрут при перевищенні порогу (§5.3, кулдаун 20с,
//   AbortController скасовує застарілий переобчислення), показує "що попереду" (§5.1, камери +
//   інциденти + трафік у вікні ~800м) з тапом "Скан" на кожен пункт → відкриває /scan для цієї
//   конкретної точки (§2.2, єдина точка перетину зі старим головним екраном — реалізовано через
//   query-параметри `?lat=&lng=&label=`, `apps/btw/app/scan/page.tsx`).
//   Этап 4 (§8) — прямим підтвердженням користувача при уточненні цього запиту: нічого
//   реалізовувати НЕ треба (пункт документа — лише список ідей на майбутнє, один з трьох
//   підпунктів там прямо суперечить §3.2 "маршрут не персистентний для MVP", інший уже
//   реалізований в Этапе 2, третій — сам поріг 200м, вирішений вище).
// - ОНОВЛЕНО — за прямим запитом користувача «должна переживать [навигацию] - исправь»: увесь
//   стан поїздки (маршрут/GPS/відхилення/ре-роутинг) ВИНЕСЕНО з цього компонента в
//   `lib/tripContext.tsx` (`<TripProvider>`, змонтований в `app/layout.tsx` — спільний предок
//   усіх роутів). Тап "Скан" на пункті "что впереди" більше НЕ перериває поїздку — перехід на
//   `/scan` розмонтовує лише `app/page.tsx`, а не провайдер, `watchPosition` і весь стан
//   лишаються живими, повернення відновлює UI поїздки як є.
//
// Старий головний екран (сканування "обведи телефоном навколо себе") НІКУДИ НЕ ЗНІК —
// переїхав на /scan (app/scan/page.tsx), доступний з кнопки "Сканировать" нижче — рішення §0/
// §2.4 ТЗ, зафіксоване раніше в цій же сесії.

// §6.4 ТЗ — рішено: явний вибір профілю, driving-car за замовчуванням.
const PROFILE_OPTIONS: { value: RoutingProfile; label: string; icon: string }[] = [
  { value: 'driving-car', label: 'Авто', icon: '🚗' },
  { value: 'cycling-regular', label: 'Велосипед', icon: '🚲' },
  { value: 'foot-walking', label: 'Пешком', icon: '🚶' },
];

export default function BtwHomePage() {
  // ЗМІНЕНО — за прямим запитом користувача «запрашивать местоположение при входе в мини апп»:
  // позиція більше НЕ визначається окремим ефектом цієї сторінки — вона вже запитана рівно один
  // раз при вході в мінідодаток (`<LocationProvider>`, app/layout.tsx, § lib/locationContext.tsx),
  // спільно з /map і /scan. Тут лишається лише похідна від неї логіка, специфічна саме для цього
  // екрана (дефолт точки А — нижче).
  const { location: currentLocation, usedDevOverride, locating, permissionDenied } = useLocation();

  // §2.1 шаг 2 — точка А за замовчуванням "текущее местоположение", як тільки воно визначене.
  const [pointA, setPointA] = useState<PickedPlace | null>(null);
  const [pointB, setPointB] = useState<PickedPlace | null>(null);
  const [profile, setProfile] = useState<RoutingProfile>('driving-car');
  const [pickerFor, setPickerFor] = useState<'A' | 'B' | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  // Увесь стан маршруту/поїздки — з контексту (lib/tripContext.tsx), не локальний useState,
  // саме тому він переживає розмонтування цього компонента при переході на /scan і назад.
  const {
    routeResult,
    routeLoading,
    routeError,
    buildRoute,
    clearRoute,
    tripActive,
    tripLocation,
    tripDeviationM,
    rerouting,
    tripError,
    tripDestinationLabel,
    startTrip,
    stopTrip,
    manualReroute,
    aheadItems,
  } = useTrip();

  // ОНОВЛЕНО — listSavedPlaces() тепер асинхронний реальний запит на сервер (§ детальний
  // розбір у lib/btwSavedPlaces.ts), а не синхронне читання localStorage.
  const refreshSavedPlaces = useCallback(() => {
    listSavedPlaces().then(setSavedPlaces);
  }, []);

  // Дефолт точки А "текущее местоположение" (§2.1 шаг 2) — щойно спільна позиція з
  // <LocationProvider> стає відомою. Залежність саме від `currentLocation` (не `[]`, як у
  // старому інлайн-ефекті) — контекст резолвиться асинхронно ПІСЛЯ першого рендера цієї
  // сторінки, тож без залежності цей ефект просто ніколи б не спрацював повторно, коли позиція
  // нарешті прийде. `prev ?? ...` лишає ручний вибір користувача недоторканим, якщо він устиг
  // обрати точку А сам до того, як геолокація відповіла.
  useEffect(() => {
    if (!currentLocation) return;
    setPointA((prev) => prev ?? { label: 'Текущее местоположение', lat: currentLocation.lat, lng: currentLocation.lng });
  }, [currentLocation]);

  useEffect(() => {
    refreshSavedPlaces();
  }, [refreshSavedPlaces]);

  function handlePicked(place: PickedPlace) {
    if (pickerFor === 'A') setPointA(place);
    else if (pickerFor === 'B') setPointB(place);
    setPickerFor(null);
    refreshSavedPlaces(); // пікер міг зберегти нове місце (чекбокс "Сохранить в избранное")
    // Точки змінились — старий побудований маршрут (якщо був) уже не відповідає новим А/Б, не
    // лишаємо його на мапі, ніби він досі актуальний.
    clearRoute();
  }

  function handleProfileChange(next: RoutingProfile) {
    setProfile(next);
    // Той самий принцип, що вище в handlePicked — профіль впливає на маршрут, старий результат
    // під новим профілем був би оманливим.
    clearRoute();
  }

  function handleBuildRoute() {
    if (!pointA || !pointB) return;
    buildRoute({ lat: pointA.lat, lng: pointA.lng }, { lat: pointB.lat, lng: pointB.lng }, profile);
  }

  // "Начать поездку" — §2.1 крок 6, §5 ТЗ, Этап 3: передає точку Б (координати + підпис для
  // "Едем к: X") і поточний профіль у контекст — сам старт живого стеження (`watchPosition`)
  // тепер відбувається в `lib/tripContext.tsx`, не тут.
  function handleStartTrip() {
    if (!routeResult || !pointB) return;
    startTrip({ lat: pointB.lat, lng: pointB.lng }, pointB.label, profile);
  }

  // mapCenter: під час поїздки — жива позиція з контексту (переживає навігацію на /scan і
  // назад, на відміну від будь-якого локального стану цього компонента); поза поїздкою — як і
  // раніше, обрана точка А / поточне місцезнаходження / фолбек-Київ.
  const mapCenter = (tripActive ? tripLocation : null) ?? pointA ?? currentLocation ?? { lat: 50.4501, lng: 30.5234 };

  // Під час активної поїздки жива позиція (tripLocation) вже відома з контексту одразу при
  // монтуванні (навіть якщо це повторне монтування після повернення з /scan) — не чекаємо на
  // окремий "визначення позиції" ефект вище, інакше на секунду-дві блимне "Определяем позицию…"
  // поверх уже відомої живої точки.
  const showLocatingPlaceholder = locating && !tripActive;

  return (
    <div className="min-h-screen bg-black pb-8 text-white">
      {/* Верхня панель — за стилем скріна (тёмна закруглена панель зверху), без вигаданої
          "программы лояльности" Uklon — цього немає в ТЗ цього проєкту.
          ЗМІНЕНО — за прямим запитом користувача «перенести вход в карту ... в главное меню на
          новую кнопку "карта" ... теперь вся навигация мини апп через главное меню»: маленьке
          текстове посилання "Карта" тут прибрано — воно переїхало нижче, у ряд швидких дій,
          повноцінною кнопкою того ж візуального рівня, що "Сканировать"/"Места" (не другорядним
          посиланням у шапці). */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-400 text-lg">👁</span>
          <span className="text-base font-semibold">Beyond the Wall</span>
        </div>
      </div>

      {/* Ряд швидких дій — за стилем скріна (іконка + підпис). ЗМІНЕНО — за прямим запитом
          користувача: додано третій пункт "Карта" (раніше — окреме маленьке посилання в шапці,
          § коментар вище) — тепер це ЄДИНИЙ вхід у карту камер поблизости з усього мінідодатку;
          друге посилання на /map, що раніше було на екрані сканування ("Открыть карту камер
          поблизости"), прибрано (app/scan/page.tsx) — уся навігація тепер через це головне
          меню, як і попросив користувач. */}
      <div className="flex gap-6 px-4 py-2">
        <Link href="/scan" className="flex flex-col items-center gap-1.5">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-2xl">📷</span>
          <span className="text-xs text-gray-300">Сканировать</span>
        </Link>
        <Link href="/map" className="flex flex-col items-center gap-1.5">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-2xl">🗺️</span>
          <span className="text-xs text-gray-300">Карта</span>
        </Link>
        <button onClick={() => setPickerFor('B')} className="flex flex-col items-center gap-1.5">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-2xl">★</span>
          <span className="text-xs text-gray-300">Места</span>
        </button>
      </div>

      {/* Картка мапи — за стилем скріна: закруглена мапа-прев'ю з позицією, під нею внахлест
          картка "звідки/куди". */}
      <div className="px-4 pt-2">
        <div className="h-56 w-full overflow-hidden rounded-2xl bg-zinc-900">
          {showLocatingPlaceholder || !mapCenter ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">Определяем позицию…</div>
          ) : (
            <MapView center={mapCenter} zoom={15} cameras={routeResult?.camerasAlongRoute ?? []} route={routeResult?.points} />
          )}
        </div>

        {usedDevOverride && (
          <p className="mt-2 rounded bg-yellow-900/60 px-3 py-1.5 text-center text-[11px] text-yellow-200">
            ⚠️ используется подмена координат (dev)
          </p>
        )}

        {/* ДОДАНО (аудит — знайдена реальна прогалина UX) — за тим самим принципом, що вже
            §8.2 ТЗ і app/map/page.tsx: якщо в дозволі на геолокацію відмовлено, решта
            мінідодатку має продовжувати працювати (§ mapCenter вище — фолбек на Київ), але
            користувач має ЗНАТИ чому мапа показує невірне місто, а не просто мовчки бачити
            Київ без жодного пояснення — раніше цей екран (на відміну від /map) взагалі не
            дивився на `permissionDenied`. */}
        {permissionDenied && !usedDevOverride && (
          <p className="mt-2 rounded bg-yellow-900/60 px-3 py-1.5 text-center text-[11px] text-yellow-200">
            ⚠️ Геолокация недоступна — укажите точку «Откуда» вручную
          </p>
        )}

        {!tripActive ? (
          <div className="relative -mt-6 rounded-2xl bg-zinc-900 p-3 shadow-lg">
            {/* Картка "звідки/куди" — за стилем скріна: дві точки з'єднані пунктиром. */}
            <div className="flex flex-col gap-0">
              <button onClick={() => setPickerFor('A')} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-white/5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                </span>
                <span className={`truncate text-sm ${pointA ? 'text-white' : 'text-gray-500'}`}>{pointA?.label ?? 'Откуда едем?'}</span>
              </button>

              <div className="ml-[9px] h-3 w-px border-l border-dashed border-gray-600" />

              <button onClick={() => setPickerFor('B')} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-white/5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-white" />
                </span>
                <span className={`truncate text-sm ${pointB ? 'text-white' : 'text-gray-500'}`}>{pointB?.label ?? 'Куда едем?'}</span>
              </button>
            </div>
          </div>
        ) : (
          // Поїздка активна — та ж позиція картки (§2.2/§5 ТЗ), але замість вибору точок —
          // живий статус: відхилення від маршруту (§5.2, поріг DEVIATION_THRESHOLD_M) і
          // стан авто-ре-роутингу (§5.3). `tripDestinationLabel` — з контексту (не `pointB`,
          // який скидається при повторному монтуванні цього компонента після /scan).
          <div className="relative -mt-6 rounded-2xl bg-zinc-900 p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {tripDestinationLabel ? `Едем к: ${tripDestinationLabel}` : 'Поездка в пути'}
              </span>
              <button onClick={stopTrip} className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-gray-300">
                Завершить
              </button>
            </div>
            <div className="mt-1.5 text-xs">
              {rerouting ? (
                <span className="text-yellow-400">⏳ строим новый маршрут…</span>
              ) : tripDeviationM != null ? (
                tripDeviationM > DEVIATION_THRESHOLD_M ? (
                  <span className="text-yellow-400">⚠ вы отклонились от маршрута на {formatDistance(tripDeviationM)}</span>
                ) : (
                  <span className="text-gray-400">на маршруте · отклонение {formatDistance(tripDeviationM)}</span>
                )
              ) : (
                <span className="text-gray-500">определяем позицию…</span>
              )}
            </div>
            {tripError && <p className="mt-1.5 text-xs text-red-300">{tripError}</p>}
          </div>
        )}
      </div>

      {/* Профиль маршрутизации і CTA сховані під час активної поїздки (§5 ТЗ) — точки А/Б і
          профіль зафіксовані на старті поїздки (у контексті), змінювати їх посеред поїздки нема
          сенсу; UI не повинен натякати, що це можливо. */}
      {!tripActive && (
        <>
          {/* Профиль маршрутизации — §6.4 ТЗ, рішено прямим запитом користувача. */}
          <div className="px-4 pt-4">
            <div className="flex gap-2">
              {PROFILE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleProfileChange(opt.value)}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2.5 text-xs ${
                    profile === opt.value ? 'bg-yellow-400 text-black' : 'bg-zinc-900 text-gray-300'
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* CTA — §2.1 шаг 4. ОНОВЛЕНО — за прямим запитом користувача «маршрутизация не
              вызывается ... исправь»: реальні стани "строим…" / результат (дистанция+час) /
              помилка, замість єдиного статичного повідомлення "ще не підключено". */}
          <div className="px-4 pt-4">
            <button
              onClick={handleBuildRoute}
              disabled={!pointA || !pointB || routeLoading}
              className="w-full rounded-xl bg-yellow-400 py-3.5 text-sm font-semibold text-black disabled:opacity-40"
            >
              {routeLoading ? 'Строим маршрут…' : 'Построить маршрут'}
            </button>
            {routeError && <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{routeError}</p>}
            {routeResult && (
              <>
                <p className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300">
                  {formatDistance(routeResult.distanceMeters)} · {formatDuration(routeResult.durationSeconds)}
                </p>
                {/* "Начать поездку" — §2.1 крок 6, §5 ТЗ, Этап 3: з'являється щойно маршрут
                    побудований, вмикає живе стеження (handleStartTrip). */}
                <button
                  onClick={handleStartTrip}
                  className="mt-2 w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white"
                >
                  ▶ Начать поездку
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* "Вдоль маршрута" — §8 ТЗ Этапы 1-2 (за прямим запитом користувача «полностью
          реализовать п 1 и п 2 по тз»): камери (§4.1/§4.2), погода/інциденти/трафік (§7.1/§7.2)
          і зустрічі з FIXED_ROUTE-камерами через /lookahead (§4.3) — усе, що сервер накладає на
          вже побудований маршрут в одному виклику POST /api/route. */}
      {routeResult && !tripActive && (
        <div className="space-y-4 px-4 pt-4">
          {routeResult.weather && (
            <div className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2.5 text-xs text-gray-300">
              <span>
                {routeResult.weather.conditionLabel}
                {routeResult.weather.tempC != null ? `, ${Math.round(routeResult.weather.tempC)}°C` : ''}
                <span className="text-gray-500"> · {routeResult.weather.name}</span>
              </span>
              {routeResult.weather.isHazard && <span className="text-yellow-400">⚠ сложные условия</span>}
            </div>
          )}

          {routeResult.traffic.events.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Трафик ({routeResult.traffic.source})
              </h3>
              <div className="space-y-1.5">
                {routeResult.traffic.events.map((e) => (
                  <div key={e.id} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{e.description ?? 'Событие на дороге'}</span>
                      <span className="shrink-0 text-gray-500">{formatDistance(e.offsetMeters)}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">{e.severityLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!routeResult.traffic.configured && routeResult.traffic.source && (
            <p className="text-[11px] text-gray-500">
              Живой трафик ({routeResult.traffic.source}) не подключён — нет ключа на сервере.
            </p>
          )}

          {routeResult.incidents.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Инциденты на маршруте</h3>
              <div className="space-y-1.5">
                {routeResult.incidents.map((i) => (
                  <div key={i.id} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{i.title}</span>
                      <span className="shrink-0 text-gray-500">{formatDistance(i.offsetMeters)}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">
                      {i.type} · {i.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {routeResult.fixedRouteEncounters.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Встречи по пути (трамваи и т.п.)</h3>
              <div className="space-y-1.5">
                {routeResult.fixedRouteEncounters.map((e) => (
                  <div key={e.cameraId} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{e.name}</span>
                      <span className="shrink-0 text-gray-500">через {formatDuration(e.etaSeconds)}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">
                      {formatDistance(e.distanceMeters)} · уверенность {Math.round(e.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              Камеры вдоль маршрута ({routeResult.camerasAlongRoute.length})
            </h3>
            {routeResult.camerasAlongRoute.length === 0 ? (
              <p className="text-xs text-gray-500">Камер вдоль этого маршрута не найдено.</p>
            ) : (
              <div className="space-y-1.5">
                {routeResult.camerasAlongRoute.map((c) => (
                  <div key={c.id} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-gray-500">{formatDistance(c.offsetMeters)}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">камера в {Math.round(c.distanceToRouteM)}м от дороги</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* "Что впереди" під час активної поїздки — §5.1/§2.2 ТЗ, Этап 3. Камери/інциденти/трафік
          у вікні AHEAD_WINDOW_M попереду поточної позиції (aheadItems з контексту, рахується від
          tripOffsetM на кожен GPS-фікс). Кожен пункт — тап "Скан" відкриває /scan для цієї
          конкретної точки (§2.2, query-параметри lat/lng/label) — переживає навігацію туди-назад
          завдяки контексту в layout (детальний розбір — lib/tripContext.tsx). */}
      {routeResult && tripActive && (
        <div className="space-y-4 px-4 pt-4">
          {/* §5.3 ТЗ — "ручной путь остаётся": пользователь може перебудувати маршрут вручну, не
              чекаючи автоматичного порогу 200м (наприклад, побачив затор на око). */}
          <button
            onClick={manualReroute}
            disabled={!tripLocation || rerouting}
            className="w-full rounded-xl bg-white/10 py-2.5 text-xs font-medium text-gray-200 disabled:opacity-40"
          >
            🔄 Пересчитать маршрут вручную
          </button>

          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Впереди на маршруте</h3>
            {aheadItems.length === 0 ? (
              <p className="text-xs text-gray-500">В ближайшие ~{formatDistance(AHEAD_WINDOW_M)} впереди ничего не найдено.</p>
            ) : (
              <div className="space-y-1.5">
                {aheadItems.map((it) => (
                  <div key={it.key} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <span className="shrink-0 text-base">{AHEAD_KIND_ICON[it.kind]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{it.label}</span>
                        <span className="shrink-0 text-gray-500">{formatDistance(it.offsetMeters)}</span>
                      </div>
                      <span className="text-[11px] text-gray-500">{it.sublabel}</span>
                    </div>
                    <Link
                      href={`/scan?lat=${it.lat}&lng=${it.lng}&label=${encodeURIComponent(it.label)}`}
                      className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-gray-200"
                    >
                      Скан
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Зустрічі з FIXED_ROUTE-камерами (трамваї тощо) — сортуються за ETA, не за позицією
              вздовж маршруту (§4.3), тож завжди показуються окремо від offset-based списку вище,
              той самий підхід, що вже в до-поїздковій секції "Вдоль маршрута". */}
          {routeResult.fixedRouteEncounters.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Встречи по пути (трамваи и т.п.)</h3>
              <div className="space-y-1.5">
                {routeResult.fixedRouteEncounters.map((e) => (
                  <div key={e.cameraId} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-gray-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{e.name}</span>
                      <span className="shrink-0 text-gray-500">через {formatDuration(e.etaSeconds)}</span>
                    </div>
                    <span className="text-[11px] text-gray-500">
                      {formatDistance(e.distanceMeters)} · уверенность {Math.round(e.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={stopTrip} className="w-full rounded-xl bg-white/10 py-3 text-sm font-medium text-white">
            ⏹ Завершить поездку
          </button>
        </div>
      )}

      {/* Збережені місця — швидкий вибір, за стилем скріна (горизонтальний ряд). §2.3 ТЗ. Ховаємо
          під час поїздки — вибір нової точки Б посеред поїздки суперечив би вже зафіксованій у
          контексті цілі (див. коментар вище біля профілю/CTA). */}
      {!tripActive && (
        <div className="px-4 pt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Сохранённые места</h2>
          {savedPlaces.length === 0 ? (
            <p className="text-xs text-gray-500">
              Пока пусто — откройте «Места» выше или пикер точки Б и добавьте место через «Указать координаты вручную».
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {savedPlaces.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPointB({ label: p.label, lat: p.lat, lng: p.lng })}
                  className="shrink-0 rounded-full bg-zinc-900 px-3 py-2 text-xs text-gray-200"
                >
                  ★ {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pickerFor && (
        <BtwPlacePicker
          title={pickerFor === 'A' ? 'Откуда едем' : 'Куда едем'}
          currentLocation={currentLocation}
          onSelect={handlePicked}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

'use client';

import { useI18n } from './I18nProvider';
import { Dictionary } from '../lib/i18n';

// ДОДАНО за прямим запитом користувача ("добавь на интерактивный лендинг feature map /
// растровая картинка для референса - на ней невнятные надписи - у нас мультиязычность на
// новом лендинге") — підсумковий "оглядовий" блок перед фінальним CTA.
//
// ОНОВЛЕНО (v2) за прямим ПОВТОРНИМ запитом користувача (скріншот живого лендингу з першою
// версією — карткова розкладка 4+4 з конекторами — і коментар "просто замени тексты
// отдельным слоем на растровом изображении - твоя версия с фичами и прямоугольниками
// выглядит очень крайне плохо - используй растровое изображение с рукой - минимум
// изменений в нем - оно идеально"): растровий композит "рука+телефон+радіальне світіння"
// (inpaint-очищений від старого AI-тексту) + живий i18n-текст у напівпрозорих scrim-блоках
// поверх, точно на місці колишніх нечитабельних підписів.
//
// ОНОВЛЕНО (v3) за прямим НАСТУПНИМ запитом користувача — НОВЕ зображення (8 іконок
// променями навколо телефону в руці, AR-сканування камери на дорозі) і НОВІ, значно
// простіші вимоги до тексту: "используй на интерактивном лендинге в разделе feature map
// растровое изображение - генерировать только тексты белым шрифтом на прозрачном фоне и
// центровать на иконку и размещать справа от неё и не менять пункты и не переставлять -
// просто адаптировать для разных языков". Тобто:
//  - Растр (public/images/feature-map-composite.webp) замінено на новий, БЕЗ жодного
//    inpaint — користувач явно попросив лише текстовий шар, зображення не чіпали взагалі.
//  - Підписи — прозорий текстовий шар (жодного scrim-блоку/фону), білий текст із
//    text-shadow для читабельності на темному растрі, top = вертикальний центр іконки
//    (translateY(-50%)), left = одразу праворуч від іконки.
//  - Референсний растр і тут має 10 кільцевих іконок на 8 реальних фіч (той самий
//    патерн, що й у v2) — 2 іконки (верхній лівий і верхній правий кути) НЕ відповідають
//    жодній з 8 фіч §4 ТЗ, тож лишаються БЕЗ підпису; порядок і зміст 8 підписаних фіч —
//    рівно ті, що вказав користувач, без додавання/видалення/перестановки.
//  - Координати кожного підпису виміряні по реальних піксельних центрах іконок на новому
//    растрі (1280×853), у % — див. OVERLAY_SLOTS нижче.
//
// ⚠️ ЧЕСНО — при дуже довгих перекладах (де, fr, es часто довші за uk/en) підпис може
// зайняти більше рядків, ніж у референсі; текстові блоки навмисно НЕ мають фіксованої
// ширини впритул до тексту (мають розумний max-width) і не обрізаються — свідомий
// компроміс 10-мовної мультимовності проти пиксель-perfect відповідності референсу.
//
// Планшет/мобільний (<lg) — растр із 8 дрібними підписами нечитабельний при зменшенні,
// тож там використовується звичайний список карток із SVG-іконками design-system (не з
// растру) — окреме, читабельне під малий екран рішення незалежно від растру.

interface Feature {
  icon: string;
  titleKey: keyof Dictionary;
  textKey: keyof Dictionary;
}

// ОНОВЛЕНО (v4) за прямим запитом користувача ("правка текстов по количеству иконок (теперь
// 10)", оновлений BTWfeatureiconsi18nv2.json) — додано 2 нових пункти, community й
// cameraDetection, якими тепер підписані ті самі 2 кільцеві іконки в верхніх кутах растру, що
// в v3 навмисно лишались порожніми ("10 слотів на 8 фіч"). Порядок і склад — рівно 10 пунктів
// з JSON користувача; не переставляти, не додавати зайвого, не видаляти.
//
// ⚠️ ЧЕСНО — для двох нових пунктів немає власної SVG-іконки в design-system (мобільна
// картка нижче — не растр): "community" узято network.svg (вузли/люди — найближчий наявний
// концепт), "cameraDetection" узято radar-sweep.svg повторно (той самий, що arScanning) —
// обидва про "виявлення/сканування", а виділеної іконки камери в наборі немає.
const ALL_FEATURES: Feature[] = [
  { icon: '/icons/radar-sweep.svg', titleKey: 'feature_ar_scan_title', textKey: 'feature_ar_scan_text' },
  { icon: '/icons/on-device.svg', titleKey: 'feature_on_device_title', textKey: 'feature_on_device_text' },
  { icon: '/icons/confirm-check.svg', titleKey: 'feature_confirm_title', textKey: 'feature_confirm_text' },
  { icon: '/icons/gps.svg', titleKey: 'feature_live_map_title', textKey: 'feature_live_map_text' },
  { icon: '/icons/route.svg', titleKey: 'feature_navigation_title', textKey: 'feature_navigation_text' },
  { icon: '/icons/drive-mode.svg', titleKey: 'feature_drive_mode_title', textKey: 'feature_drive_mode_text' },
  { icon: '/icons/payment-star.svg', titleKey: 'feature_payment_title', textKey: 'feature_payment_text' },
  { icon: '/icons/kill-switch.svg', titleKey: 'feature_mode_switch_title', textKey: 'feature_mode_switch_text' },
  { icon: '/icons/network.svg', titleKey: 'feature_community_title', textKey: 'feature_community_text' },
  { icon: '/icons/radar-sweep.svg', titleKey: 'feature_camera_detection_title', textKey: 'feature_camera_detection_text' },
];

// Позиції текстових блоків поверх public/images/feature-map-composite.webp (1280×853).
// За прямим запитом користувача ("генерировать только тексты белым шрифтом на прозрачном
// фоне и центровать на иконку и размещать справа от неё") — координати виміряні по
// РЕАЛЬНИХ піксельних центрах іконок на растрі (детектовано за яскравими ціан-пікселями
// кожної іконки, скрипт-аналіз растру), а не "на око":
//   verification (110,243) · onDeviceAI (888,250) · arScanning (131,421) ·
//   liveMap (945,422) · navigation (104,590) · driveMode (921,590) ·
//   payments (280,719) · modeSwitch (841,708) · cameraDetection (124,99) ·
//   community (803,96) — координати в пікселях на растрі 1280×853.
// `left` — відразу праворуч від іконки (центр іконки + ~55px відступу на її "світіння"),
// `top` — вертикальний центр іконки (у парі з `transform: translateY(-50%)` у розмітці
// нижче — САМЕ так підпис лишається відцентрованим на іконці незалежно від висоти тексту).
// `width` — фіксований максимум, підібраний так, щоб на будь-якій із 10 мов текст не
// наліз на телефон у центрі композиції і не виліз за правий край растру.
//
// ОНОВЛЕНО (v4) — верхні лівий/правий кути растру (раніше навмисно без підпису, § v3) тепер
// підписані cameraDetection/community відповідно до оновленого JSON користувача. Іконка
// "cameraDetection" (лівий верхній кут — силует камери на кронштейні з ціллю) і "community"
// (правий верхній кут — вузол/іконка на пристрої) визначені за формою іконки в растрі; це
// НЕ підтверджено користувачем напряму, лише візуальний аналіз растру.
interface OverlaySlot {
  titleKey: keyof Dictionary;
  textKey: keyof Dictionary;
  style: { left: string; top: string; width: string };
}

const OVERLAY_SLOTS: OverlaySlot[] = [
  { titleKey: 'feature_camera_detection_title', textKey: 'feature_camera_detection_text', style: { left: '13.98%', top: '11.61%', width: '17.97%' } },
  { titleKey: 'feature_community_title', textKey: 'feature_community_text', style: { left: '67.03%', top: '11.25%', width: '17.97%' } },
  { titleKey: 'feature_confirm_title', textKey: 'feature_confirm_text', style: { left: '12.89%', top: '28.49%', width: '17.97%' } },
  { titleKey: 'feature_on_device_title', textKey: 'feature_on_device_text', style: { left: '73.67%', top: '29.31%', width: '17.97%' } },
  { titleKey: 'feature_ar_scan_title', textKey: 'feature_ar_scan_text', style: { left: '14.53%', top: '49.35%', width: '17.97%' } },
  { titleKey: 'feature_live_map_title', textKey: 'feature_live_map_text', style: { left: '78.13%', top: '49.47%', width: '17.97%' } },
  { titleKey: 'feature_navigation_title', textKey: 'feature_navigation_text', style: { left: '12.42%', top: '69.17%', width: '17.97%' } },
  { titleKey: 'feature_drive_mode_title', textKey: 'feature_drive_mode_text', style: { left: '76.25%', top: '69.17%', width: '17.97%' } },
  { titleKey: 'feature_payment_title', textKey: 'feature_payment_text', style: { left: '26.17%', top: '84.29%', width: '14.84%' } },
  { titleKey: 'feature_mode_switch_title', textKey: 'feature_mode_switch_text', style: { left: '70.0%', top: '83.0%', width: '17.97%' } },
];

function FeatureIcon({ src }: { src: string }) {
  return (
    <span
      aria-hidden="true"
      className="block h-6 w-6 shrink-0 bg-current"
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-bg p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-primary">
        <FeatureIcon src={feature.icon} />
      </div>
      <div>
        <h3 className="font-display text-base font-medium">{t(feature.titleKey)}</h3>
        <p className="mt-1 text-sm text-muted">{t(feature.textKey)}</p>
      </div>
    </div>
  );
}

export default function FeatureMap() {
  const { t } = useI18n();

  return (
    <section className="border-t border-white/5 bg-surface px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">{t('feature_map_eyebrow')}</p>
          <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('feature_map_title')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">{t('feature_map_subtitle')}</p>
        </div>

        {/* Телефон над списком карток — лише до lg (планшет/мобільний). */}
        <div className="mb-10 flex justify-center lg:hidden">
          <img
            src="/images/feature-map-phone.webp"
            alt={t('feature_map_phone_alt')}
            className="h-64 w-auto object-contain"
            width={450}
            height={950}
            loading="lazy"
          />
        </div>

        {/* Планшет (md–lg): сітка 2×4 карток із SVG-іконками. */}
        <div className="hidden grid-cols-2 gap-4 md:grid lg:hidden">
          {ALL_FEATURES.map((f) => (
            <FeatureCard key={f.titleKey} feature={f} />
          ))}
        </div>

        {/* Мобільний (<md): один вертикальний список карток. */}
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {ALL_FEATURES.map((f) => (
            <FeatureCard key={f.titleKey} feature={f} />
          ))}
        </div>

        {/* Desktop (lg+): растровий композит користувача (рука + телефон, 8 іконок
            променями) БЕЗ жодних змін самого зображення + живий i18n-текст прозорим шаром
            поверх — білий текст, без фонового блоку, відцентрований на іконці по вертикалі,
            одразу праворуч від неї (§ коментар "ОНОВЛЕНО (v3)" вгорі файлу). */}
        <div className="relative hidden overflow-hidden rounded-3xl lg:block">
          <img
            src="/images/feature-map-composite.webp"
            alt={t('feature_map_phone_alt')}
            className="block w-full"
            width={1280}
            height={853}
            loading="lazy"
          />
          {OVERLAY_SLOTS.map((slot) => (
            <div
              key={slot.titleKey}
              className="absolute"
              style={{ ...slot.style, transform: 'translateY(-50%)' }}
            >
              {/* ОНОВЛЕНО (v4) за прямим запитом користувача ("шрифт заголовка и самого
                  текста сделай чуть крупнее") — 1vw/0.75vw → 1.2vw/0.9vw (title +20%,
                  text +20%). */}
              <h3
                className="font-display font-semibold leading-tight text-white"
                style={{ fontSize: '1.2vw', textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)' }}
              >
                {t(slot.titleKey)}
              </h3>
              <p
                className="mt-1 leading-snug text-white/85"
                style={{ fontSize: '0.9vw', textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6)' }}
              >
                {t(slot.textKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

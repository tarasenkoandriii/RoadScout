'use client';

import { useI18n } from './I18nProvider';
import { Dictionary } from '../lib/i18n';

// ДОДАНО за прямим запитом користувача ("добавь на интерактивный лендинг feature map /
// растровая картинка для референса - на ней невнятные надписи - у нас мультиязычность на
// новом лендинге") — підсумковий "оглядовий" блок перед фінальним CTA.
//
// ОНОВЛЕНО за прямим ПОВТОРНИМ запитом користувача (скріншот живого лендингу з першою
// версією — карткова розкладка 4+4 з конекторами — і коментар "просто замени тексты
// отдельным слоем на растровом изображении - твоя версия с фичами и прямоугольниками
// выглядит очень крайне плохо - используй растровое изображение с рукой - минимум
// изменений в нем - оно идеально"): перша версія цього компонента (окремі HTML-картки
// обабіч телефону) користувачу НЕ сподобалась візуально. Замість неї — на lg+ тепер сам
// растровий композит користувача (public/images/feature-map-composite.webp — той самий
// референс "рука+телефон+радіальне світіння", що user надіслав, ПОЧТИ без змін), а НОВИЙ
// живий i18n-текст накладається окремим HTML-шаром absolute-позиціонованих блоків ПОВЕРХ
// растру, точно на місці, де в оригіналі був нечитабельний AI-текст.
//
// Що саме змінено в самому растрі (public/images/feature-map-composite.webp,
// див. інструменти обробки — cv2.inpaint по масці "яскраві пікселі всередині
// прямокутника навколо кожного підпису"), і чому це все ще "мінімум змін":
//  1) Прибрано (inpaint) сам застарілий текст 8 підписів — іконки, промінці й фото
//     руки з телефоном лишились пиксель-в-піксель як у референсі.
//  2) Референсний растр згенерував AI із 10 текстовими слотами на 8 реальних фіч —
//     "Маркетплейс" і "Drive Mode" дублювались у 2 місцях кожен (§4 ТЗ називає лише
//     8 унікальних фіч). Один з двох дублів кожної пари прибрано ПОВНІСТЮ (іконка+текст)
//     — інакше довелось би або показати однакову фічу двічі різними словами (виглядало
//     б як помилка контенту), або вигадувати 2 фічі, яких немає в ТЗ.
// Тексти нових HTML-блоків позиційовані у %, прив'язані до розмірів растру
// (1600×1200) — масштабуються разом із зображенням на будь-якій ширині контейнера.
//
// ⚠️ ЧЕСНО — при дуже довгих перекладах (де, fr, es часто довші за uk/en) підпис може
// зайняти більше рядків, ніж у референсі; текстові блоки навмисно НЕ мають фіксованої
// висоти (лише min-height) і не обрізаються — це свідомий компроміс 10-мовної
// мультимовності проти пиксель-perfect відповідності референсу.
//
// Планшет/мобільний (<lg) — растр із 8 дрібними підписами нечитабельний при зменшенні,
// тож там (як і в першій версії) використовується звичайний список карток із SVG-іконками
// design-system (не з растру) — це вже НЕ та розкладка, яку критикував користувач
// (критика стосувалась саме десктопної версії на скріншоті), і mobile/tablet вимагають
// власного, читабельного під малий екран рішення незалежно від растру.

interface Feature {
  icon: string;
  titleKey: keyof Dictionary;
  textKey: keyof Dictionary;
}

const ALL_FEATURES: Feature[] = [
  { icon: '/icons/radar-sweep.svg', titleKey: 'feature_ar_scan_title', textKey: 'feature_ar_scan_text' },
  { icon: '/icons/on-device.svg', titleKey: 'feature_on_device_title', textKey: 'feature_on_device_text' },
  { icon: '/icons/network.svg', titleKey: 'feature_registry_title', textKey: 'feature_registry_text' },
  { icon: '/icons/drive-mode.svg', titleKey: 'feature_drive_mode_title', textKey: 'feature_drive_mode_text' },
  { icon: '/icons/confirm-check.svg', titleKey: 'feature_confirm_title', textKey: 'feature_confirm_text' },
  { icon: '/icons/marketplace.svg', titleKey: 'feature_marketplace_title', textKey: 'feature_marketplace_text' },
  { icon: '/icons/payment-star.svg', titleKey: 'feature_payment_title', textKey: 'feature_payment_text' },
  { icon: '/icons/kill-switch.svg', titleKey: 'feature_kill_switch_title', textKey: 'feature_kill_switch_text' },
];

// Позиції текстових блоків поверх public/images/feature-map-composite.webp (1600×1200,
// координати в % — виміряно вручну по місцях, де в оригінальному растрі був підпис).
interface OverlaySlot {
  titleKey: keyof Dictionary;
  textKey: keyof Dictionary;
  style: { left: string; top: string; width: string; minHeight: string };
}

// minHeight — НЕ косметика: це висота ділянки, яку inpaint реально "вичистив" від
// старого AI-тексту (+запас). Якщо переклад короткий (uk/en), блок просто має трохи
// зайвого повітря знизу; якщо довгий (de/fr/es), йому вже є куди рости, не
// оголюючи недочищені пікселі растру під собою (перевірено вручну на de — найдовшій мові).
const OVERLAY_SLOTS: OverlaySlot[] = [
  { titleKey: 'feature_ar_scan_title', textKey: 'feature_ar_scan_text', style: { left: '11.56%', top: '7.08%', width: '23.4%', minHeight: '14%' } },
  { titleKey: 'feature_on_device_title', textKey: 'feature_on_device_text', style: { left: '62.8%', top: '5.83%', width: '21.9%', minHeight: '12.5%' } },
  { titleKey: 'feature_confirm_title', textKey: 'feature_confirm_text', style: { left: '11.9%', top: '21.7%', width: '16.25%', minHeight: '17%' } },
  { titleKey: 'feature_registry_title', textKey: 'feature_registry_text', style: { left: '71.6%', top: '21.7%', width: '24.4%', minHeight: '14%' } },
  { titleKey: 'feature_drive_mode_title', textKey: 'feature_drive_mode_text', style: { left: '75.6%', top: '43.75%', width: '16.6%', minHeight: '17%' } },
  { titleKey: 'feature_marketplace_title', textKey: 'feature_marketplace_text', style: { left: '7.19%', top: '63.3%', width: '26.9%', minHeight: '15%' } },
  { titleKey: 'feature_payment_title', textKey: 'feature_payment_text', style: { left: '15.6%', top: '77.9%', width: '26.6%', minHeight: '14%' } },
  { titleKey: 'feature_kill_switch_title', textKey: 'feature_kill_switch_text', style: { left: '66.25%', top: '77.5%', width: '32.5%', minHeight: '18%' } },
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

        {/* Desktop (lg+): растровий композит користувача (рука + телефон + радіальне
            світіння) майже без змін + живий i18n-текст окремим шаром поверх, точно на
            місці колишніх нечитабельних AI-підписів (див. коментар "ОНОВЛЕНО" вгорі файлу). */}
        <div className="relative hidden overflow-hidden rounded-3xl lg:block">
          <img
            src="/images/feature-map-composite.webp"
            alt={t('feature_map_phone_alt')}
            className="block w-full"
            width={1600}
            height={1200}
            loading="lazy"
          />
          {OVERLAY_SLOTS.map((slot) => (
            <div
              key={slot.titleKey}
              className="absolute rounded-lg bg-bg/80 px-2.5 py-1.5 backdrop-blur-[3px]"
              style={slot.style}
            >
              <h3 className="font-display text-[0.95vw] font-semibold leading-tight text-neutral">{t(slot.titleKey)}</h3>
              <p className="mt-1 text-[0.72vw] leading-snug text-neutral/75">{t(slot.textKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

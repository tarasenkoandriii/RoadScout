'use client';

import { useI18n } from './I18nProvider';
import { Dictionary } from '../lib/i18n';

// ДОДАНО за прямим запитом користувача ("добавь на интерактивный лендинг feature map /
// растровая картинка для референса - на ней невнятные надписи - у нас мультиязычность на
// новом лендинге") — компонент реалізує ТЗ №3 (doc-подібний файл TZ_illustration_3_feature_map.md,
// завантажений користувачем): підсумковий "оглядовий" блок перед фінальним CTA — телефон
// (єдиний растровий елемент, public/images/feature-map-phone.webp) в центрі + 8 функціональних
// блоків навколо, кожен — SVG-іконка з існуючої design-system (public/icons/*.svg, той самий
// currentColor-mask підхід, що вже й Icon() у app/[lang]/page.tsx) + заголовок/текст із
// словника (lib/i18n/dictionaries/*.ts, 10 мов) — жодного тексту в растрі, на відміну від
// референсного композиту користувача, де підписи були "запечені" в зображення AI-моделлю
// разом із самою ілюстрацією і тому виявились нечитабельними/дубльованими.
//
// ⚠️ ЧЕСНО — спрощення відносно ТЗ §4/§5 ("радіальна розкладка", "тонкі вигнуті лінії від
// краю екрана телефона до кожного блоку"): тут НЕ повна радіальна геометрія (8 точок по колу
// з точним прицілюванням у конкретну зону екрана), а симетрична 2-колонкова розкладка
// (4 блоки зліва + 4 справа від телефону) з короткими декоративними "конекторами" — лінія
// довжиною в фіксовані 28px від внутрішнього краю картки в бік телефону. Справжні лінії
// "картка → конкретна точка на екрані" вимагали б виміру геометрії в рантаймі
// (getBoundingClientRect у useLayoutEffect, стеження за resize) — це виправдана складність
// для інтерактивного інструмента, але не для статичного маркетингового блоку; symmetричні
// конектори дають той самий візуальний ефект "блоки з'єднані з телефоном", без крихкості
// точного піксельного прицілювання на кожному брейкпоінті.
//
// Адаптивність (ТЗ §7): lg+ — 2 колонки карток обабіч телефону з конекторами; md — телефон
// зверху, картки 2-колонковою сіткою під ним, без ліній; мобільний (<md) — телефон зверху,
// картки одним вертикальним списком, без ліній ("радіальна метафора не масштабується на
// маленький екран" — п.7 ТЗ, критерій приймання).

interface Feature {
  icon: string;
  titleKey: keyof Dictionary;
  textKey: keyof Dictionary;
}

const LEFT_FEATURES: Feature[] = [
  { icon: '/icons/radar-sweep.svg', titleKey: 'feature_ar_scan_title', textKey: 'feature_ar_scan_text' },
  { icon: '/icons/on-device.svg', titleKey: 'feature_on_device_title', textKey: 'feature_on_device_text' },
  { icon: '/icons/network.svg', titleKey: 'feature_registry_title', textKey: 'feature_registry_text' },
  { icon: '/icons/drive-mode.svg', titleKey: 'feature_drive_mode_title', textKey: 'feature_drive_mode_text' },
];

const RIGHT_FEATURES: Feature[] = [
  { icon: '/icons/confirm-check.svg', titleKey: 'feature_confirm_title', textKey: 'feature_confirm_text' },
  { icon: '/icons/marketplace.svg', titleKey: 'feature_marketplace_title', textKey: 'feature_marketplace_text' },
  { icon: '/icons/payment-star.svg', titleKey: 'feature_payment_title', textKey: 'feature_payment_text' },
  { icon: '/icons/kill-switch.svg', titleKey: 'feature_kill_switch_title', textKey: 'feature_kill_switch_text' },
];

const ALL_FEATURES = [...LEFT_FEATURES, ...RIGHT_FEATURES];

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

function FeatureCard({ feature, side }: { feature: Feature; side: 'left' | 'right' | 'plain' }) {
  const { t } = useI18n();
  return (
    <div
      className={`relative flex items-start gap-4 rounded-2xl border border-white/10 bg-bg p-5 ${
        side === 'left' ? 'lg:flex-row-reverse lg:text-right' : ''
      }`}
    >
      {/* Декоративний конектор у бік телефону (лише lg+) — див. коментар "ЧЕСНО" вгорі файлу. */}
      {side !== 'plain' && (
        <span
          aria-hidden="true"
          className={`absolute top-1/2 hidden h-px w-7 -translate-y-1/2 bg-primary/50 lg:block ${
            side === 'left' ? '-right-7' : '-left-7'
          }`}
        />
      )}
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

        {/* Телефон над списком карток — видно лише до lg (мобільний/планшет розклад). */}
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

        {/* Планшет (md–lg): сітка 2×4, без телефону в потоці карток і без конекторів. */}
        <div className="hidden grid-cols-2 gap-4 md:grid lg:hidden">
          {ALL_FEATURES.map((f) => (
            <FeatureCard key={f.titleKey} feature={f} side="plain" />
          ))}
        </div>

        {/* Мобільний (<md): один вертикальний список, без конекторів (п.7 ТЗ). */}
        <div className="grid grid-cols-1 gap-4 md:hidden">
          {ALL_FEATURES.map((f) => (
            <FeatureCard key={f.titleKey} feature={f} side="plain" />
          ))}
        </div>

        {/* Desktop (lg+): телефон по центру, 4+4 картки обабіч, з конекторами. */}
        <div className="hidden items-center gap-10 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex flex-col justify-center gap-6">
            {LEFT_FEATURES.map((f) => (
              <FeatureCard key={f.titleKey} feature={f} side="left" />
            ))}
          </div>
          <div className="flex justify-center">
            <img
              src="/images/feature-map-phone.webp"
              alt={t('feature_map_phone_alt')}
              className="h-[560px] w-auto object-contain"
              width={450}
              height={950}
              loading="lazy"
            />
          </div>
          <div className="flex flex-col justify-center gap-6">
            {RIGHT_FEATURES.map((f) => (
              <FeatureCard key={f.titleKey} feature={f} side="right" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

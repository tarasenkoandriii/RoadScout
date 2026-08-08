'use client';

import { useI18n } from '../../components/I18nProvider';
import LanguageSelector from '../../components/LanguageSelector';
import SkipLink from '../../components/SkipLink';
import CityWidget from '../../components/CityWidget';
import FeatureMap from '../../components/FeatureMap';

// За прямим запитом користувача — doc/TZ-btw-landing-v2.md: другий, ОКРЕМИЙ від apps/landing
// лендинг ("старый лендинг для пешеходов / интерактивный для велосипедистов - авто"). Контент
// тут — виключно сценарій «Побудуй маршрут» (§2.3 «Сценарій Б» ТЗ) для велосипедиста/водія;
// сценарій швидкого сканування (пішохід) свідомо НЕ дублюється тут — він лишається на
// apps/landing.
//
// ⚠️ ЧЕСНО — секція "скріншоти" з першого ТЗ (§2.5) тут свідомо пропущена — реальних знімків
// режиму сопровождения на цей момент немає, а видавати намальовані макети за "справжній
// інтерфейс" суперечило б принципу чесних скріншотів (§2.5 doc/TZ-btw-landing.md). Решта
// секцій — той самий легкий SVG-іконковий підхід (mask-image + currentColor), що вже був у
// першій версії apps/landing до фотореалістичного апдейту.
//
// ОНОВЛЕНО за прямим запитом користувача ("картинку использовать как hero image into
// interactive landing") — hero-секція раніше мала лише декоративну SVG-панель (тут НЕ було
// фотореалістичних ілюстрацій, на відміну від apps/landing); тепер там реальне фото
// (public/images/hero-drive-cycle.webp) — водій за кермом і велосипедист з AR-накладенням
// попереджень, той самий сценарій "авто/велосипед", що й секція нижче (§ ДЛЯ КОГО).

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_URL ?? 'https://t.me/RoadScoutBot/beyondthewall';

function TelegramCTA({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <a
      href={TELEGRAM_APP_URL}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-4 font-display text-base font-medium text-neutral transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary ${className}`}
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">{children}</p>;
}

function Icon({ src, className = 'h-7 w-7' }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-current ${className}`}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }}
    />
  );
}

export default function InteractiveLandingPage() {
  const { t } = useI18n();

  return (
    <main id="main">
      <SkipLink />

      {/* ============ ШАПКА ============ */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-end px-6 pt-4 sm:pt-6">
        <div className="pointer-events-auto">
          <LanguageSelector />
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden px-6 pb-20 pt-10 sm:pt-16">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>{t('hero_eyebrow')}</Eyebrow>
            <h1 className="font-display text-4xl font-medium leading-[1.1] sm:text-5xl lg:text-6xl">
              {t('hero_title_line1')}
              <br />
              {t('hero_title_line2')}
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted">{t('hero_subtitle')}</p>
            <div className="mt-10">
              <TelegramCTA>{t('cta_open')}</TelegramCTA>
            </div>
          </div>

          {/* ДОДАНО за прямим запитом користувача ("картинку использовать как hero image into
              interactive landing") — замінює попередню декоративну SVG-панель "мапа маршруту"
              (§ коментар вгорі файлу пояснював ЧОМУ раніше не було фотореалістичного hero:
              "нові фотореалістичні сцени тут не запитувались і не виготовлялись" — тепер
              запитались і виготовились). Зображення саме по собі й є ілюстрацією ціннісної
              пропозиції: зліва — вигляд з-за керма авто, справа (через AR-розлом) — вигляд з
              велосипеда з накладеними попередженнями "SPEED CAMERA 120m" / "SAFE ROUTE No
              cameras ahead", тобто той самий сценарій "авто/велосипед" з секції нижче (§ ДЛЯ
              КОГО). aspect-[4/3] (а не native 3:2 чи aspect-square) — свідомий компроміс: кадрує
              трохи неба/капота зверху-знизу, але зберігає ПОВНУ ширину композиції (від рук на
              кермі зліва до значка камери справа) на всіх viewport, на відміну від aspect-square,
              що на мобільних обрізало б бічний контент. */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
            <img
              src="/images/hero-drive-cycle.webp"
              alt={t('hero_image_alt')}
              className="aspect-[4/3] w-full object-cover"
              width={1280}
              height={853}
              loading="eager"
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      {/* ============ FEATURE MAP ============ */}
      {/* ДОДАНО за прямим запитом користувача ("добавь на интерактивный лендинг feature map") —
          підсумковий "оглядовий" блок (components/FeatureMap.tsx, детальний коментар там).
          ПЕРЕНЕСЕНО за прямим повторним запитом користувача ("перенеси раздел // весь
          функціонал сразу за разделом с hero (вторым)") — раніше стояв перед фінальним CTA
          (в самому кінці сторінки, після FAQ), тепер — одразу другою секцією, перед "ПРОБЛЕМА". */}
      <FeatureMap />

      {/* ============ ПРОБЛЕМА ============ */}
      <section className="border-t border-white/5 bg-surface px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>{t('problem_eyebrow')}</Eyebrow>
          <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('problem_title')}</h2>
          <p className="mt-6 text-lg text-muted">{t('problem_text')}</p>
        </div>
      </section>

      {/* ============ КАК ЭТО РАБОТАЕТ ============ */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <Eyebrow>{t('steps_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('steps_title')}</h2>
          </div>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <Step icon="/icons/destination.svg" iconColor="text-primary" n="01" title={t('step1_title')}>
              {t('step1_text')}
            </Step>
            <Step icon="/icons/route.svg" iconColor="text-primary" n="02" title={t('step2_title')}>
              {t('step2_text')}
            </Step>
            <Step icon="/icons/current-position.svg" iconColor="text-success" n="03" title={t('step3_title')}>
              {t('step3_text')}
            </Step>
            <Step icon="/icons/incident.svg" iconColor="text-warning" n="04" title={t('step4_title')}>
              {t('step4_text')}
            </Step>
          </ol>
        </div>
      </section>

      {/* ============ ДЛЯ КОГО (ВЕЛОСИПЕД / АВТО) ============ */}
      <section className="border-t border-white/5 bg-surface px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <Eyebrow>{t('audience_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('audience_title')}</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-bg p-8">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-primary">
                <Icon src="/icons/bicycle.svg" />
              </div>
              <h3 className="font-display text-xl font-medium">{t('audience_cyclist_title')}</h3>
              <p className="mt-2 text-muted">{t('audience_cyclist_text')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-bg p-8">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-primary">
                <Icon src="/icons/car.svg" />
              </div>
              <h3 className="font-display text-xl font-medium">{t('audience_driver_title')}</h3>
              <p className="mt-2 text-muted">{t('audience_driver_text')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ ЖИВОЙ БЛОК ПО ГОРОДУ (IP-виджет) ============ */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <Eyebrow>{t('widget_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('widget_title')}</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">{t('widget_subtitle')}</p>
          </div>
          <CityWidget />
        </div>
      </section>

      {/* ============ ПРИВАТНОСТЬ ============ */}
      <section className="border-t border-white/5 bg-surface px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-primary">
            <Icon src="/icons/shield.svg" />
          </div>
          <Eyebrow>{t('privacy_eyebrow')}</Eyebrow>
          <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('privacy_title')}</h2>
          <p className="mt-6 text-lg text-muted">{t('privacy_text')}</p>

          <ul className="mx-auto mt-10 max-w-xl space-y-4 text-left">
            <li className="flex items-start gap-3">
              <Icon src="/icons/cloud-off.svg" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="text-muted">{t('privacy_point1')}</span>
            </li>
            <li className="flex items-start gap-3">
              <Icon src="/icons/gps.svg" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="text-muted">{t('privacy_point2')}</span>
            </li>
            <li className="flex items-start gap-3">
              <Icon src="/icons/shield.svg" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="text-muted">{t('privacy_point3')}</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-2xl">
          <div className="mb-12 text-center">
            <Eyebrow>{t('faq_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('faq_title')}</h2>
          </div>
          <div className="space-y-3">
            <FaqItem q={t('faq_q1')}>{t('faq_a1')}</FaqItem>
            <FaqItem q={t('faq_q2')}>{t('faq_a2')}</FaqItem>
            <FaqItem q={t('faq_q3')}>{t('faq_a3')}</FaqItem>
            <FaqItem q={t('faq_q4')}>{t('faq_a4')}</FaqItem>
            <FaqItem q={t('faq_q5')}>{t('faq_a5')}</FaqItem>
          </div>
        </div>
      </section>

      {/* ============ ФИНАЛЬНЫЙ CTA + ФУТЕР ============ */}
      <section className="border-t border-white/5 bg-surface px-6 py-24 text-center">
        <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('final_title')}</h2>
        <div className="mt-8">
          <TelegramCTA>{t('cta_open')}</TelegramCTA>
        </div>
      </section>

      <footer className="px-6 py-10 text-center font-mono text-xs text-muted">
        <p>{t('footer_note')}</p>
        <p className="mt-2">{t('footer_copyright', { year: new Date().getFullYear() })}</p>
      </footer>
    </main>
  );
}

function Step({
  icon,
  iconColor,
  n,
  title,
  children,
}: {
  icon: string;
  iconColor: string;
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="list-none">
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 ${iconColor}`}>
        <Icon src={icon} />
      </div>
      <p className="mb-1 font-mono text-xs text-muted">{n}</p>
      <h3 className="font-display text-lg font-medium">{title}</h3>
      <p className="mt-2 text-muted">{children}</p>
    </li>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-white/10 bg-bg px-5 py-4 open:bg-surface">
      <summary className="cursor-pointer list-none font-display text-base font-medium marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <span className="flex items-center justify-between gap-4">
          {q}
          <span aria-hidden="true" className="text-primary transition-transform group-open:rotate-45">
            +
          </span>
        </span>
      </summary>
      <p className="mt-3 text-muted">{children}</p>
    </details>
  );
}

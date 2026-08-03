'use client';

import { useI18n } from '../../components/I18nProvider';
import LanguageSelector from '../../components/LanguageSelector';

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

// "Телеметрійні" лейбли-мітки — сигнатурна деталь сторінки (моноширинний шрифт, дужки), що
// наскрізь підкреслює тему пеленгації/сканування.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">{children}</p>;
}

export default function LandingPage() {
  const { t } = useI18n();

  return (
    <main id="main">
      {/* ============ ШАПКА — лише перемикач мови ============ */}
      <header className="flex justify-end px-6 pt-6">
        <LanguageSelector />
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
          <div className="relative">
            <picture>
              <source media="(max-width: 639px)" srcSet="/illustrations/hero-mobile.svg" />
              <img src="/illustrations/hero.svg" alt="" role="presentation" className="w-full rounded-3xl" />
            </picture>
          </div>
        </div>
      </section>

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
            <Step icon="/icons/open.svg" iconColor="text-primary" n="01" title={t('step1_title')}>
              {t('step1_text')}
            </Step>
            <Step icon="/icons/point.svg" iconColor="text-primary" n="02" title={t('step2_title')}>
              {t('step2_text')}
            </Step>
            <Step icon="/icons/detect.svg" iconColor="text-success" n="03" title={t('step3_title')}>
              {t('step3_text')}
            </Step>
            <Step icon="/icons/warning.svg" iconColor="text-warning" n="04" title={t('step4_title')}>
              {t('step4_text')}
            </Step>
          </ol>
        </div>
      </section>

      {/* ============ ПРИВАТНОСТЬ ============ */}
      <section className="border-t border-white/5 bg-surface px-6 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <Eyebrow>{t('privacy_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('privacy_title')}</h2>
            <ul className="mt-6 space-y-4 text-lg text-muted">
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1 text-success">
                  ✓
                </span>
                <span>{t('privacy_point1')}</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1 text-success">
                  ✓
                </span>
                <span>{t('privacy_point2')}</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-1 text-success">
                  ✓
                </span>
                <span>{t('privacy_point3')}</span>
              </li>
            </ul>
          </div>
          <div className="order-1 lg:order-2">
            <picture>
              <source media="(max-width: 639px)" srcSet="/illustrations/privacy-mobile.svg" />
              <img src="/illustrations/privacy.svg" alt={t('privacy_imgAlt')} className="w-full rounded-2xl" />
            </picture>
          </div>
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
        <p>{t('footer_copyright', { year: new Date().getFullYear() })}</p>
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
        {/* currentColor не працює через <img src="..."> (зовнішній ресурс, не вбудований у
            DOM) — CSS mask-image: іконка стає "трафаретом", реальний колір задає
            background-color (той самий ${iconColor}, що вже на батьківському div). */}
        <span
          aria-hidden="true"
          className="block h-7 w-7 bg-current"
          style={{
            WebkitMaskImage: `url(${icon})`,
            maskImage: `url(${icon})`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
          }}
        />
      </div>
      <p className="mb-1 font-mono text-xs text-muted">{n}</p>
      <h3 className="font-display text-lg font-medium">{title}</h3>
      <p className="mt-2 text-muted">{children}</p>
    </li>
  );
}

// Нативний <details>/<summary> — доступність (клавіатура/скрінрідери) з коробки, без жодного
// JS для самого акордеону.
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

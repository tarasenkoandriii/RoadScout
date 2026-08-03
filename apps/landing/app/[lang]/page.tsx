'use client';

import Image from 'next/image';
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
      {/* За запитом користувача — перемикач мови тепер плаваючий, прикріплений до верху
          (fixed), тож лишається доступним під час скролу. Обгортка pointer-events-none, щоб
          порожня смуга шапки не перехоплювала кліки по контенту під нею; сам віджет —
          pointer-events-auto. z-40, аби бути поверх контенту (випадний список віджета має
          свій z-50). */}
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
          <div className="relative">
            {/* За прямим запитом користувача — новий фотореалістичний hero (заміна
                попереднього плоского SVG). next/image замість <picture>+<img>: реальна
                користь саме для растрового фото (не було сенсу для плоских SVG-іконок,
                там залишається mask-image-підхід) — автоматична віддача WebP,
                респонсивні розміри, контроль пріоритету завантаження (priority — це
                найважливіше зображення LCP на сторінці). Дві версії з art-direction
                (десктоп/мобільна обрізка під постать) перемикаються через Tailwind-
                брейкпоінти, не через <picture><source> — next/image не підтримує
                декілька джерел в одному компоненті так само, як <picture>. */}
            <Image
              src="/illustrations/hero-desktop.png"
              alt=""
              role="presentation"
              width={1536}
              height={1024}
              priority
              className="hidden w-full rounded-3xl sm:block"
            />
            <Image
              src="/illustrations/hero-mobile.png"
              alt=""
              role="presentation"
              width={819}
              height={1024}
              priority
              className="block w-full rounded-3xl sm:hidden"
            />
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
        <div className="mx-auto max-w-6xl">
          {/* ЗМІНЕНО за прямим запитом користувача — нова ілюстрація приватності є
              горизонтальним 5-кроковим потоком (камера → AI на пристрої → лише геометрія
              → зашифровано → користувач лишається головним), не одиночною централізованою
              сценою, як стара плоска SVG-версія. Двоколонковий макет (текст/картинка
              50/50) стискав би цей потік до нечитабельної ширини — тому текст тепер
              центрований зверху, а ілюстрація йде на всю ширину контейнера нижче,
              зберігаючи свою природну горизонтальну композицію. */}
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>{t('privacy_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('privacy_title')}</h2>
          </div>

          <div className="relative mt-12 overflow-x-auto">
            <Image
              src="/illustrations/privacy-desktop.png"
              alt={t('privacy_imgAlt')}
              width={1518}
              height={824}
              sizes="(max-width: 640px) 720px, 1200px"
              className="mx-auto min-w-[720px] max-w-full rounded-2xl sm:min-w-0"
            />
            {/* ЗМІНЕНО за прямим запитом користувача — підписи розкладено навколо кожної
                іконки: короткий ОПИС кроку у темній смузі НАД іконкою, синій ЗАГОЛОВОК —
                по центру ПІД іконкою. Обидва центровані по X точно під своєю іконкою.
                leftPct — виміряні центри 5 іконок на privacy-desktop.png (у % ширини
                зображення): 12.3 / 31.85 / 50.4 / 68.7 / 86.9. min-w узгоджено з min-w
                самого <Image> вище, щоб оверлей жив у тій самій системі координат і на
                мобільних скролився разом із зображенням. */}
            <div className="pointer-events-none absolute inset-0 min-w-[720px] sm:min-w-0">
              <PrivacyDesc leftPct={12.3}>{t('privacy_step1_text')}</PrivacyDesc>
              <PrivacyDesc leftPct={31.85}>{t('privacy_step2_text')}</PrivacyDesc>
              <PrivacyDesc leftPct={50.4}>{t('privacy_step3_text')}</PrivacyDesc>
              <PrivacyDesc leftPct={68.7}>{t('privacy_step4_text')}</PrivacyDesc>
              <PrivacyDesc leftPct={86.9}>{t('privacy_step5_text')}</PrivacyDesc>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 min-w-[720px] sm:min-w-0">
              <div className="relative mx-auto h-0">
                <PrivacyTitle leftPct={12.3}>{t('privacy_step1_title')}</PrivacyTitle>
                <PrivacyTitle leftPct={31.85}>{t('privacy_step2_title')}</PrivacyTitle>
                <PrivacyTitle leftPct={50.4}>{t('privacy_step3_title')}</PrivacyTitle>
                <PrivacyTitle leftPct={68.7}>{t('privacy_step4_title')}</PrivacyTitle>
                <PrivacyTitle leftPct={86.9}>{t('privacy_step5_title')}</PrivacyTitle>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ МОЖЛИВОСТІ (FEATURES) ============ */}
      {/* За прямим запитом користувача — секція побудована так само, як privacy: дві надані
          растрові ілюстрації на всю ширину, а поверх них — справжній HTML-текст, винесений
          в i18n-словники й перекладений на всі 10 мов.
          • Ілюстрація 1 (feature-collage) — 5 сцен без вписаного тексту: над кожною сценою
            накладаємо короткий переклад-підпис біля її іконки (feature_scene{n}).
          • Ілюстрація 2 (feature-grid) — макет із 6 карток + нижній потік, де англійський
            текст «вшитий» у пікселі: перекладені підписи кладемо суцільними темними
            плашками рівно поверх англійських блоків (координати виміряні з зображення,
            у % — тому вирівнювання тримається на будь-якій ширині). Плашки close to
            #05070E — колір інтер’єру карток, щоб перекривати оригінальний текст.
          min-w оверлея = min-w зображення (горизонтальний скрол на вузьких екранах), щоб
          текст і картинка жили в одній системі координат. */}
      <section className="border-t border-white/5 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <Eyebrow>{t('features_eyebrow')}</Eyebrow>
            <h2 className="font-display text-3xl font-medium sm:text-4xl">{t('features_title')}</h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">{t('features_subtitle')}</p>
          </div>

          {/* Ілюстрація 1 — колаж із 5 сцен + переклад-підписи біля іконок */}
          <div className="relative mt-10 overflow-x-auto">
            <Image
              src="/illustrations/feature-collage.png"
              alt={t('features_imgAlt1')}
              width={1536}
              height={1024}
              sizes="(max-width: 640px) 860px, 1100px"
              className="mx-auto min-w-[860px] max-w-full rounded-2xl sm:min-w-0"
            />
            <div className="pointer-events-none absolute inset-0 min-w-[860px] sm:min-w-0">
              <SceneLabel cx={17.1} top={12.5} accent="text-primary">{t('feature_scene1')}</SceneLabel>
              <SceneLabel cx={50.2} top={11} accent="text-success">{t('feature_scene2')}</SceneLabel>
              <SceneLabel cx={82.5} top={12.5} accent="text-primary">{t('feature_scene3')}</SceneLabel>
              <SceneLabel cx={18.3} top={65} accent="text-[#F87171]">{t('feature_scene4')}</SceneLabel>
              <SceneLabel cx={81.2} top={64} accent="text-primary">{t('feature_scene5')}</SceneLabel>
            </div>
          </div>

          {/* Ілюстрація 2 — сітка можливостей + переклад поверх «вшитого» англійського тексту */}
          <div className="relative mt-8 overflow-x-auto">
            <Image
              src="/illustrations/feature-grid.png"
              alt={t('features_imgAlt2')}
              width={1536}
              height={1024}
              sizes="(max-width: 640px) 920px, 1100px"
              className="mx-auto min-w-[920px] max-w-full rounded-2xl sm:min-w-0"
            />
            <div className="pointer-events-none absolute inset-0 min-w-[920px] sm:min-w-0">
              <GridCaption left={6.8} top={5} width={29} height={13.5} accent="text-primary" title={t('feature1_title')}>
                {t('feature1_text')}
              </GridCaption>
              <GridCaption left={6.8} top={35.5} width={24} height={15.5} accent="text-primary" title={t('feature2_title')}>
                {t('feature2_text')}
              </GridCaption>
              <GridCaption left={6.8} top={61.5} width={24} height={13} accent="text-primary" title={t('feature3_title')}>
                {t('feature3_text')}
              </GridCaption>
              <GridCaption left={67.6} top={6} width={16} height={13} accent="text-[#2DD4BF]" title={t('feature4_title')}>
                {t('feature4_text')}
              </GridCaption>
              <GridCaption left={67.6} top={34.5} width={16.5} height={16.5} accent="text-[#A78BFA]" title={t('feature5_title')}>
                {t('feature5_text')}
              </GridCaption>
              <GridCaption left={67.6} top={61} width={13} height={18.5} accent="text-primary" title={t('feature6_title')}>
                {t('feature6_text')}
              </GridCaption>

              <GridFlowLabel cx={19.5} accent="text-primary">{t('feature_flow1')}</GridFlowLabel>
              <GridFlowLabel cx={34.7} accent="text-[#2DD4BF]">{t('feature_flow2')}</GridFlowLabel>
              <GridFlowLabel cx={48.8} accent="text-[#A78BFA]">{t('feature_flow3')}</GridFlowLabel>
              <GridFlowLabel cx={63.9} accent="text-success">{t('feature_flow4')}</GridFlowLabel>
              <GridFlowLabel cx={79} accent="text-primary">{t('feature_flow5')}</GridFlowLabel>
            </div>
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

// Опис кроку, накладений на ТЕМНУ смугу зображення НАД відповідною іконкою (leftPct —
// горизонтальний центр іконки). Фон зображення там достатньо темний, тож замість плашки —
// лише легка тінь тексту для читабельності. bottom підібрано так, щоб опис стояв трохи вище
// верхнього краю ряду іконок (ряд іконок починається на ~15% висоти від низу зображення).
function PrivacyDesc({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  return (
    <p
      className="absolute w-[18%] min-w-[116px] -translate-x-1/2 text-center text-[10px] leading-tight text-neutral/90 [text-shadow:_0_1px_4px_rgba(0,0,0,0.95)] sm:text-[11px]"
      style={{ left: `${leftPct}%`, bottom: '16.5%' }}
    >
      {children}
    </p>
  );
}

// Заголовок кроку — по центру ПІД відповідною іконкою (той самий leftPct — центр іконки).
// Стоїть одразу під нижнім краєм зображення (top-0 у h-0 контейнері + невеликий відступ),
// щоб не перекривати іконку. Синій текст із легкою тінню для читабельності на темному фоні.
function PrivacyTitle({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  return (
    <p
      className="absolute top-0 mt-1.5 w-[19%] min-w-[112px] -translate-x-1/2 text-center font-display text-[11px] font-medium leading-tight text-primary [text-shadow:_0_1px_4px_rgba(0,0,0,0.85)] sm:text-xs"
      style={{ left: `${leftPct}%` }}
    >
      {children}
    </p>
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


// ── Підписи-оверлеї для секції features (аналог PrivacyCaption із privacy) ──

// Короткий підпис над сценою колажу (ілюстрація 1). cx — горизонтальний центр сцени у %
// ширини зображення, top — у % висоти. Напівпрозора темна плашка + backdrop-blur — для
// читабельності поверх насиченої фотореалістичної сцени.
function SceneLabel({
  cx,
  top,
  accent,
  children,
}: {
  cx: number;
  top: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-bg/85 px-2 py-1 text-center font-display text-[11px] font-medium leading-none backdrop-blur-sm sm:text-xs ${accent}`}
      style={{ left: `${cx}%`, top: `${top}%` }}
    >
      {children}
    </span>
  );
}

// Перекладена картка-підпис поверх «вшитого» англійського тексту сітки (ілюстрація 2).
// left/top/width/height — прямокутник англійського блоку у % (виміряний із зображення);
// суцільна темна плашка (колір інтер’єру карток #05070E) повністю перекриває оригінал,
// а зверху сідає переклад: заголовок акцентним кольором + опис. minHeight (а не фіксована
// висота) гарантує, що плашка не менша за англійський блок, але росте під довші переклади,
// не обрізаючи їх.
function GridCaption({
  left,
  top,
  width,
  height,
  accent,
  title,
  children,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  accent: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute overflow-hidden rounded-md bg-[#05070E] px-1.5 py-1"
      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, minHeight: `${height}%` }}
    >
      <p className={`font-display text-[13px] font-semibold leading-tight ${accent}`}>{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-neutral/85">{children}</p>
    </div>
  );
}

// Перекладений підпис нижнього потоку сітки (ілюстрація 2). cx — центр англійського підпису
// у % ширини; вертикально стоїть рівно на ряду підписів під іконками.
function GridFlowLabel({ cx, accent, children }: { cx: number; accent: string; children: React.ReactNode }) {
  return (
    <span
      className={`absolute inline-flex -translate-x-1/2 items-center justify-center whitespace-nowrap rounded bg-[#05070E] px-2 text-center font-display text-[12px] font-medium leading-none ${accent}`}
      style={{ left: `${cx}%`, top: '94%', minHeight: '3.2%' }}
    >
      {children}
    </span>
  );
}

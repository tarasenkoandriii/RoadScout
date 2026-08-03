// Єдиний тип словника — якщо додати/прибрати ключ тут, TS змусить оновити ВСІ 10 файлів у
// dictionaries/*.ts (інакше помилка компіляції "Property X is missing"). Той самий принцип,
// що вже в apps/admin/lib/i18n/dictionary.types.ts — гарантія повних словників на рівні
// тайпчекінгу, не просто обіцянка в коментарі.
export interface Dictionary {
  skipLink: string;

  hero_eyebrow: string;
  hero_title_line1: string;
  hero_title_line2: string;
  hero_subtitle: string;
  cta_open: string;

  problem_eyebrow: string;
  problem_title: string;
  problem_text: string;

  steps_eyebrow: string;
  steps_title: string;
  step1_title: string;
  step1_text: string;
  step2_title: string;
  step2_text: string;
  step3_title: string;
  step3_text: string;
  step4_title: string;
  step4_text: string;

  privacy_eyebrow: string;
  privacy_title: string;
  privacy_step1_title: string;
  privacy_step1_text: string;
  privacy_step2_title: string;
  privacy_step2_text: string;
  privacy_step3_title: string;
  privacy_step3_text: string;
  privacy_step4_title: string;
  privacy_step4_text: string;
  privacy_step5_title: string;
  privacy_step5_text: string;
  privacy_imgAlt: string;

  features_eyebrow: string;
  features_title: string;
  features_subtitle: string;
  feature1_title: string;
  feature1_text: string;
  feature2_title: string;
  feature2_text: string;
  feature3_title: string;
  feature3_text: string;
  feature4_title: string;
  feature4_text: string;
  feature5_title: string;
  feature5_text: string;
  feature6_title: string;
  feature6_text: string;
  feature_flow1: string;
  feature_flow2: string;
  feature_flow3: string;
  feature_flow4: string;
  feature_flow5: string;
  feature_scene1: string;
  feature_scene2: string;
  feature_scene3: string;
  feature_scene4: string;
  feature_scene5: string;
  features_imgAlt1: string;
  features_imgAlt2: string;

  faq_eyebrow: string;
  faq_title: string;
  faq_q1: string;
  faq_a1: string;
  faq_q2: string;
  faq_a2: string;
  faq_q3: string;
  faq_a3: string;
  faq_q4: string;
  faq_a4: string;
  faq_q5: string;
  faq_a5: string;

  final_title: string;
  footer_copyright: string;

  languageSelector_label: string;
}

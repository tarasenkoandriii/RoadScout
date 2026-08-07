// Той самий принцип, що apps/landing/lib/i18n/dictionary.types.ts — єдиний тип словника,
// TS змусить оновити ВСІ 10 файлів dictionaries/*.ts, якщо додати/прибрати ключ. Контент —
// НОВИЙ, не копія словника apps/landing: цей лендинг про планування маршруту для велосипеда/
// авто (doc/TZ-btw-landing-v2.md), а не про сканування камер пішоходом (те лишається на
// apps/landing).
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

  audience_eyebrow: string;
  audience_title: string;
  audience_cyclist_title: string;
  audience_cyclist_text: string;
  audience_driver_title: string;
  audience_driver_text: string;

  widget_eyebrow: string;
  widget_title: string;
  widget_subtitle: string;
  widget_loading: string;
  widget_error: string;
  widget_unavailable: string;
  widget_weather_label: string;
  widget_weather_hazard: string;
  // ДОДАНО за прямим запитом користувача ("добавить прогноз погоды на два дня меньшим шрифтом") —
  // підпис над рядком 2-денного прогнозу під поточними умовами у CityWidget.
  widget_forecast_label: string;
  widget_incidents_label: string;
  widget_incidents_empty: string;
  widget_incidents_source_511ny: string;
  widget_incidents_source_tomtom: string;
  widget_incidents_source_none: string;
  // ДОДАНО за прямим запитом користувача ("инциденты отображать на карте региона") — підпис під
  // схематичною картою інцидентів, інтерпольований параметром {radius} (той самий механізм
  // interpolate(), що вже footer_copyright з {year}) — радіус приходить з backend
  // (LandingIncidentsSummary.radiusKm), а не захардкоджений на фронті.
  widget_map_radius_note: string;
  // ДОДАНО за прямим запитом користувача ("карту взять у windy - сделать как в админке с теми
  // же селекторами слоев") — підпис над рядом вкладок-перемикачів шарів карти (Інциденти +
  // 5 шарів Windy) у CityMapPanel.tsx.
  widget_map_label: string;
  widget_layer_incidents: string;
  // ДОДАНО за прямим запитом користувача ("добавить еще карту дорог") — вкладка "Дороги"
  // (RoadMapLayer.tsx, react-leaflet + OSM-тайли) серед перемикачів шарів карти.
  widget_layer_roads: string;
  widget_layer_rain: string;
  widget_layer_wind: string;
  widget_layer_clouds: string;
  widget_layer_temp: string;
  widget_layer_radar: string;
  widget_disclaimer: string;

  privacy_eyebrow: string;
  privacy_title: string;
  privacy_text: string;
  privacy_point1: string;
  privacy_point2: string;
  privacy_point3: string;

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
  footer_note: string;

  languageSelector_label: string;
}

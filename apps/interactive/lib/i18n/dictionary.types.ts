// Той самий принцип, що apps/landing/lib/i18n/dictionary.types.ts — єдиний тип словника,
// TS змусить оновити ВСІ 10 файлів dictionaries/*.ts, якщо додати/прибрати ключ. Контент —
// НОВИЙ, не копія словника apps/landing: цей лендинг про планування маршруту для велосипеда/
// авто (doc/TZ-btw-landing-v2.md), а не про сканування камер пішоходом (те лишається на
// apps/landing).
export interface Dictionary {
  skipLink: string;

  // ДОДАНО за прямим запитом користувача ("добавить на лендинг слоган сверху - служить и
  // защищать") — короткий слоган у фіксованій шапці (app/[lang]/page.tsx, поруч із
  // LanguageSelector), видимий на кожній секції лендингу під час скролу.
  header_slogan: string;

  hero_eyebrow: string;
  hero_title_line1: string;
  hero_title_line2: string;
  hero_subtitle: string;
  cta_open: string;
  // ДОДАНО за прямим запитом користувача ("картинку использовать как hero image into
  // interactive landing") — alt-текст фотореалістичного hero-зображення (водій + велосипедист
  // з AR-накладенням: камера попереду й безпечний маршрут без камер), що замінило декоративну
  // SVG-панель "мапа маршруту" (§ детальний коментар у app/[lang]/page.tsx).
  hero_image_alt: string;

  problem_eyebrow: string;
  problem_title: string;
  problem_text: string;

  steps_eyebrow: string;
  steps_title: string;
  // ДОДАНО за прямим запитом користувача ("выбираю Вариант 1 — в блок «Как это работает» -
  // обе иллюстрации внеси в эту секцию") — alt-текст двох нових фотореалістичних ілюстрацій
  // (app/[lang]/page.tsx, одразу під заголовком секції, перед списком з 4 кроків): телефон
  // закріплений на панелі приладів (пасивний радар попереду) та телефон у руці, наведений
  // на дорожню камеру (активне AR-сканування з вибором об'єкта напрямком телефону) — той
  // самий принцип іменування, що вже hero_image_alt/feature_map_phone_alt.
  steps_photo_mount_alt: string;
  steps_photo_handheld_alt: string;
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
  // ДОДАНО за прямим запитом користувача ("добавить еще режим пешком - и соотвествующую
  // плашку") — третя картка секції "для кого" (app/[lang]/page.tsx), розміщена ПЕРШОЮ, до
  // велосипеда й авто. Не вигадана функція: узгоджена з уже наявним профілем маршрутизації
  // 'foot-walking' у PROFILE_OPTIONS міні-додатку (apps/btw/app/page.tsx).
  audience_pedestrian_title: string;
  audience_pedestrian_text: string;
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

  // ДОДАНО за прямим запитом користувача ("добавь на интерактивный лендинг feature map") —
  // підсумковий "оглядовий" блок перед FAQ/фінальним CTA (components/FeatureMap.tsx).
  //
  // ОНОВЛЕНО (детальний розбір — components/FeatureMap.tsx) двічі: спершу растровий композит
  // користувача "рука+телефон+радіальне світіння" (v1) з живими i18n-підписами у напівпрозорих
  // scrim-блоках поверх; тепер — НОВИЙ растровий композит користувача (8 іконок променями
  // навколо телефону в руці, AR-сканування камери на дорозі) за прямим запитом користувача
  // ("используй на интерактивном лендинге в разделе feature map растровое изображение -
  // генерировать только тексты белым шрифтом на прозрачном фоне и центровать на иконку и
  // размещать справа от неё"): підписи — прозорий текстовий шар (без scrim-блоку), білий текст
  // із text-shadow для читабельності, вертикально відцентрований на іконці, зліва впритул до
  // іконки. В обох версіях текст лишається ЖИВИМ HTML/i18n, не запеченим у растр.
  feature_map_eyebrow: string;
  feature_map_title: string;
  feature_map_subtitle: string;
  feature_map_phone_alt: string;
  feature_ar_scan_title: string;
  feature_ar_scan_text: string;
  feature_on_device_title: string;
  feature_on_device_text: string;
  feature_live_map_title: string;
  feature_live_map_text: string;
  feature_drive_mode_title: string;
  feature_drive_mode_text: string;
  feature_confirm_title: string;
  feature_confirm_text: string;
  feature_navigation_title: string;
  feature_navigation_text: string;
  feature_payment_title: string;
  feature_payment_text: string;
  feature_mode_switch_title: string;
  feature_mode_switch_text: string;
  // ДОДАНО (v4) за прямим запитом користувача ("правка текстов по количеству иконок (теперь
  // 10)", оновлений BTWfeatureiconsi18nv2.json) — 2 нові пункти заповнюють 2 іконки, що в v3
  // навмисно лишались без підпису (верхні лівий/правий кути растру, § FeatureMap.tsx).
  feature_community_title: string;
  feature_community_text: string;
  feature_camera_detection_title: string;
  feature_camera_detection_text: string;

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

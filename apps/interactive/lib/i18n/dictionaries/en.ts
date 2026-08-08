import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Skip to content',

  header_slogan: 'To Serve and Protect',

  hero_eyebrow: '// plan ahead',
  hero_title_line1: 'Plan your route —',
  hero_title_line2: 'know what is ahead',
  hero_subtitle:
    'A free Telegram app builds a route for driving or cycling and immediately shows what is on it: cameras, weather, known incidents, and road conditions. On the way, it guides you and reroutes automatically if you drift off course.',
  cta_open: 'Open in Telegram →',
  hero_image_alt:
    'A driver’s and a cyclist’s view with an AR overlay: a speed camera 120 m ahead, and a safe, camera-free route for the cyclist',

  problem_eyebrow: '// why this matters',
  problem_title: 'On the road, you rarely know what is coming',
  problem_text:
    'Weather changes, incidents happen, new cameras appear — and you usually find out only once you are already on the road, when it is hard to react. Beyond the Wall builds your route and shows what is on it before you leave, then stays with you as a helper while you drive or ride.',

  steps_eyebrow: '// how it works',
  steps_title: 'From point A to point B — with the full picture along the way',
  steps_photo_mount_alt:
    'A phone mounted on the dashboard showing a radar-style AR overlay: a camera detected 380 m ahead and another object 750 m ahead, synced with the cloud',
  steps_photo_handheld_alt:
    'A hand holding up a phone and aiming it at a roadside speed camera, with an AR frame locking onto it and a list of nearby detected objects below',
  step1_title: 'Set points A and B',
  step1_text: 'Current location, a saved place, or manual entry — then pick a profile: driving or cycling.',
  step2_title: 'See the route ahead',
  step2_text: 'Cameras, weather, known incidents, and traffic along the way — before you even start.',
  // ЗМІНЕНО за прямим запитом користувача ("лендингфраза Їдь під наглядом идеология не следить
  // а помогать - едь с помощником или подобное") — прибрано "tracking/watching" тон і тут, і в
  // problem_text вище — застосунок позиціонується як помічник у дорозі, не наглядач.
  step3_title: 'Drive with a helper',
  step3_text: 'A helper by your side — it warns you if you drift off route, and reroutes automatically.',
  step4_title: '"What\'s ahead"',
  step4_text: 'A list of what is a few hundred meters ahead — one tap to see the details.',

  audience_eyebrow: '// who it is for',
  audience_title: 'Driving, cycling, or walking',
  audience_pedestrian_title: 'Walking',
  audience_pedestrian_text: 'A route tailored to a pedestrian profile, with warnings about cameras and conditions along the way.',
  audience_cyclist_title: 'Cycling',
  audience_cyclist_text: 'A route tailored to a cyclist profile, with warnings about cameras and conditions along the way.',
  audience_driver_title: 'Driving',
  audience_driver_text: 'A route for driving, live traffic, and automatic rerouting if the road is closed or you drift off course.',

  widget_eyebrow: '// right now',
  widget_title: "What's happening in your city",
  widget_subtitle: 'We detect your city from your IP address (no precise location request) and show live weather and known road incidents nearby.',
  widget_loading: 'Detecting your city…',
  widget_error: 'Could not load data — please try refreshing the page later.',
  widget_unavailable: 'No data available for your region yet — coverage is growing gradually.',
  widget_weather_label: 'Weather',
  widget_weather_hazard: '⚠ Possibly hazardous road conditions',
  widget_forecast_label: '2-day forecast',
  widget_incidents_label: 'Nearby road incidents',
  widget_incidents_empty: 'No known incidents nearby right now.',
  widget_incidents_source_511ny: 'Source: 511NY (New York State)',
  widget_incidents_source_tomtom: 'Source: TomTom Traffic',
  widget_incidents_source_none: 'No traffic source configured for this region',
  widget_map_radius_note: 'Within {radius} km of your city',
  widget_map_label: 'Region map',
  widget_layer_incidents: 'Incidents',
  widget_layer_roads: 'Roads',
  widget_layer_rain: 'Rain',
  widget_layer_wind: 'Wind',
  widget_layer_clouds: 'Clouds',
  widget_layer_temp: 'Temperature',
  widget_layer_radar: 'Precipitation radar',
  widget_disclaimer: 'City is detected from your IP address — approximate, without requesting your precise location.',

  feature_map_eyebrow: '// everything it does',
  feature_map_title: 'Everything the app can do — at a glance',
  feature_map_subtitle: "From AR scanning on the road to privacy and payments — a quick overview of the key features.",
  feature_map_phone_alt: "A phone with the Beyond the Wall app open: a map and AR interface on the home screen",
  feature_ar_scan_title: 'AR Scanning',
  feature_ar_scan_text: 'Real-time detection and visualization of objects.',
  feature_on_device_title: 'On-device AI',
  feature_on_device_text: 'Data is processed directly on your device.',
  feature_live_map_title: 'Live Map',
  feature_live_map_text: 'Real-time map of cameras and detected objects.',
  feature_drive_mode_title: 'Drive Mode',
  feature_drive_mode_text: 'A driver-focused mode with minimal distraction.',
  feature_confirm_title: 'Verification',
  feature_confirm_text: 'Community confirmation improves data reliability.',
  feature_navigation_title: 'Navigation',
  feature_navigation_text: 'Safer navigation based on detected objects.',
  feature_payment_title: 'Payments',
  feature_payment_text: "Free while the project is in its testing stage.",
  feature_mode_switch_title: 'Mode Switch',
  feature_mode_switch_text: 'Instantly switch between usage modes.',
  feature_community_title: 'Community',
  feature_community_text: 'Share and verify information with the community.',
  feature_camera_detection_title: 'Camera Detection',
  feature_camera_detection_text: 'Identify cameras and understand their coverage.',

  privacy_eyebrow: '// privacy',
  privacy_title: 'Your route stays with you',
  privacy_text:
    "While you are on a trip, coordinates are processed locally on your phone — the server never receives a stream of your location. The \"what's happening in your city\" block above only uses an approximate city from your IP address, with no precise location and no stored requests.",
  privacy_point1: 'Trip coordinates are not sent to the server as identified data',
  privacy_point2: 'City for the live widget is detected by IP — not GPS, no location permission needed',
  privacy_point3: 'Server requests store nothing and are not tied to anyone',

  faq_eyebrow: '// faq',
  faq_title: 'Frequently asked questions',
  faq_q1: 'Is it free?',
  faq_a1: 'Yes, completely — no subscription or paid features at this stage.',
  faq_q2: 'Does the app track me all the time?',
  faq_a2: 'No. Live tracking only runs while you are actively on a trip with the app open, and you can end it at any moment.',
  faq_q3: 'What if I go off the planned route?',
  faq_a3: 'The app notices the deviation and offers — or automatically builds — a new route, no manual searching needed.',
  faq_q4: 'Is weather and incident data available for every city?',
  faq_a4:
    'No — coverage depends on the source: route incidents via 511NY are available only in New York State, TomTom covers more regions where configured, and weather expands as the city list grows. Where there is no data, we say so honestly.',
  faq_q5: 'How does this page know my city?',
  faq_a5: "From your browser's IP address — approximate, at the city level, without requesting access to your precise location.",

  final_title: 'Try it right now',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: 'Just looking for a camera scanner? Our classic app is also on Telegram — same bot.',

  languageSelector_label: 'Language',
};

export default dict;

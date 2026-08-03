import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Skip to content',

  hero_eyebrow: '// beyond the wall',
  hero_title_line1: 'Point your phone —',
  hero_title_line2: 'find out who can see this spot',
  hero_subtitle:
    "A free Telegram app scans nearby public webcams and shows their field of view — right where you're standing, no install, no sign-up.",
  cta_open: 'Open in Telegram →',

  problem_eyebrow: '// why this exists',
  problem_title: "There are more public cameras around than you'd think",
  problem_text:
    "Traffic, city, and tourist webcams broadcast openly — but there's usually no easy way to tell which one actually faces a specific spot near you. Beyond the Wall closes exactly that narrow gap — no extra features, no subscriptions.",

  steps_eyebrow: '// how it works',
  steps_title: 'Four steps, no sign-up',
  step1_title: 'Open in Telegram',
  step1_text: 'No app install — right inside the messenger you already use.',
  step2_title: 'Point your phone',
  step2_text: "Turn around — the compass tracks the direction you're facing.",
  step3_title: 'Cameras highlighted',
  step3_text: 'The app shows nearby cameras and their field of view relative to you.',
  step4_title: 'Side view',
  step4_text: 'No direct match? You can check nearby side or reverse angles too.',

  privacy_eyebrow: '// privacy',
  privacy_title: 'Your coordinates stay with you',
  privacy_step1_title: 'Camera',
  privacy_step1_text: 'Public camera captures the scene',
  privacy_step2_title: 'On-device AI',
  privacy_step2_text: 'Video is analyzed locally on your device',
  privacy_step3_title: 'Geometry only',
  privacy_step3_text: 'Only anonymous data (location, direction, FOV) is prepared',
  privacy_step4_title: 'Encrypted & minimal',
  privacy_step4_text: 'Minimal data is encrypted and sent to BTW servers. No video. Ever.',
  privacy_step5_title: 'You stay in control',
  privacy_step5_text: 'You get safe routes and camera awareness. Your privacy stays intact.',
  privacy_imgAlt: 'Diagram: the phone does not send coordinates to the server',

  faq_eyebrow: '// faq',
  faq_title: 'Frequently asked questions',
  faq_q1: 'Is it free?',
  faq_a1: "Yes, completely — at this stage there's no subscription or paid features at all.",
  faq_q2: 'Do I need to sign up?',
  faq_a2: 'No — the app opens right inside Telegram, using your existing Telegram account.',
  faq_q3: 'Does it show private or home cameras?',
  faq_a3: 'No. Only public, already-verified webcams are included — the app never points toward homes or restricted sites.',
  faq_q4: 'Does it work in my city?',
  faq_a4: "It depends on how many public cameras are already registered for that city — coverage grows gradually and isn't equally complete everywhere.",
  faq_q5: 'How is privacy handled?',
  faq_a5: "Coordinates are only used locally on your phone for the calculation — the server only receives a request for 'what's near this map area', not tied to you personally.",

  final_title: 'Try it right now',
  footer_copyright: '© {year} Beyond the Wall',

  languageSelector_label: 'Language',
};

export default dict;

import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Zum Inhalt springen',

  hero_eyebrow: '// vorausplanen',
  hero_title_line1: 'Plane deine Route —',
  hero_title_line2: 'wisse, was vor dir liegt',
  hero_subtitle:
    'Eine kostenlose Telegram-App plant eine Route fürs Auto oder Fahrrad und zeigt sofort, was auf ihr liegt: Kameras, Wetter, bekannte Vorfälle und die Verkehrslage. Unterwegs führt sie dich und berechnet die Route automatisch neu, wenn du davon abweichst.',
  cta_open: 'In Telegram öffnen →',

  problem_eyebrow: '// warum das wichtig ist',
  problem_title: 'Unterwegs weißt du selten im Voraus, was dich erwartet',
  problem_text:
    'Das Wetter ändert sich, es passieren Vorfälle, neue Kameras tauchen auf — und meist erfährst du das erst unterwegs, wenn es schwer ist zu reagieren. Beyond the Wall plant deine Route und zeigt, was darauf liegt, bevor du losfährst, und behält es auch unterwegs im Blick.',

  steps_eyebrow: '// so funktioniert es',
  steps_title: 'Von Punkt A nach Punkt B — mit dem vollen Bild unterwegs',
  step1_title: 'Punkte A und B festlegen',
  step1_text: 'Aktueller Standort, ein gespeicherter Ort oder manuelle Eingabe — dann Profil wählen: Auto oder Fahrrad.',
  step2_title: 'Die Route im Voraus sehen',
  step2_text: 'Kameras, Wetter, bekannte Vorfälle und Verkehr auf der Strecke — schon vor der Abfahrt.',
  step3_title: 'Mit Live-Begleitung fahren',
  step3_text: 'Die Live-Verfolgung meldet Abweichungen von der Route und berechnet sie automatisch neu.',
  step4_title: '„Was vor dir liegt"',
  step4_text: 'Eine Liste dessen, was einige hundert Meter voraus liegt — ein Tipp für die Details.',

  audience_eyebrow: '// für wen',
  audience_title: 'Am Steuer oder auf dem Rad',
  audience_cyclist_title: 'Fahrrad',
  audience_cyclist_text: 'Eine Route, die auf das Radfahrer-Profil abgestimmt ist, mit Warnungen zu Kameras und Bedingungen unterwegs.',
  audience_driver_title: 'Auto',
  audience_driver_text: 'Eine Route fürs Auto, Live-Verkehr und automatische Neuberechnung, wenn die Straße gesperrt ist oder du abweichst.',

  widget_eyebrow: '// gerade jetzt',
  widget_title: 'Was in deiner Stadt gerade passiert',
  widget_subtitle: 'Wir erkennen deine Stadt anhand deiner IP-Adresse (ohne genaue Standortabfrage) und zeigen aktuelles Wetter sowie bekannte Verkehrsvorfälle in der Nähe.',
  widget_loading: 'Deine Stadt wird ermittelt…',
  widget_error: 'Daten konnten nicht geladen werden — bitte die Seite später neu laden.',
  widget_unavailable: 'Für deine Region liegen noch keine Daten vor — die Abdeckung wächst schrittweise.',
  widget_weather_label: 'Wetter',
  widget_weather_hazard: '⚠ Möglicherweise gefährliche Straßenbedingungen',
  widget_forecast_label: '2-Tage-Vorhersage',
  widget_incidents_label: 'Verkehrsvorfälle in der Nähe',
  widget_incidents_empty: 'Derzeit keine bekannten Vorfälle in der Nähe.',
  widget_incidents_source_511ny: 'Quelle: 511NY (Bundesstaat New York)',
  widget_incidents_source_tomtom: 'Quelle: TomTom Traffic',
  widget_incidents_source_none: 'Für diese Region ist keine Verkehrsquelle konfiguriert',
  widget_map_radius_note: 'Im Umkreis von {radius} km um deine Stadt',
  widget_map_label: 'Regionskarte',
  widget_layer_incidents: 'Vorfälle',
  widget_layer_roads: 'Straßen',
  widget_layer_rain: 'Regen',
  widget_layer_wind: 'Wind',
  widget_layer_clouds: 'Bewölkung',
  widget_layer_temp: 'Temperatur',
  widget_layer_radar: 'Niederschlagsradar',
  widget_disclaimer: 'Die Stadt wird anhand deiner IP-Adresse ermittelt — ungefähr, ohne Abfrage deines genauen Standorts.',

  privacy_eyebrow: '// datenschutz',
  privacy_title: 'Deine Route bleibt bei dir',
  privacy_text:
    'Während einer Fahrt werden Koordinaten lokal auf deinem Telefon verarbeitet — der Server erhält niemals einen Strom deiner Standortdaten. Der obige Block „was in deiner Stadt passiert" nutzt nur eine ungefähre Stadt anhand deiner IP-Adresse, ohne genauen Standort und ohne gespeicherte Anfragen.',
  privacy_point1: 'Koordinaten während der Fahrt werden nicht als identifizierte Daten an den Server gesendet',
  privacy_point2: 'Die Stadt für das Live-Widget wird per IP ermittelt — nicht per GPS, ohne Standortberechtigung',
  privacy_point3: 'Serveranfragen speichern nichts und sind niemandem zugeordnet',

  faq_eyebrow: '// häufige fragen',
  faq_title: 'Häufig gestellte Fragen',
  faq_q1: 'Ist es kostenlos?',
  faq_a1: 'Ja, vollständig — in dieser Phase gibt es kein Abo und keine kostenpflichtigen Funktionen.',
  faq_q2: 'Verfolgt mich die App ständig?',
  faq_a2: 'Nein. Die Live-Verfolgung läuft nur, solange du aktiv mit geöffneter App unterwegs bist, und du kannst sie jederzeit beenden.',
  faq_q3: 'Was, wenn ich von der geplanten Route abweiche?',
  faq_a3: 'Die App bemerkt die Abweichung und schlägt eine neue Route vor — oder erstellt sie automatisch —, ohne manuelle Suche.',
  faq_q4: 'Sind Wetter- und Vorfalldaten für jede Stadt verfügbar?',
  faq_a4:
    'Nein — die Abdeckung hängt von der Quelle ab: Routenvorfälle über 511NY sind nur im Bundesstaat New York verfügbar, TomTom deckt mehr Regionen ab, wo konfiguriert, und das Wetter wächst mit der Städteliste. Wo es keine Daten gibt, sagen wir das ehrlich.',
  faq_q5: 'Woher kennt diese Seite meine Stadt?',
  faq_a5: 'Aus der IP-Adresse deines Browsers — ungefähr, auf Stadtebene, ohne Zugriff auf deinen genauen Standort anzufordern.',

  final_title: 'Jetzt gleich ausprobieren',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: 'Suchst du nur einen Kamera-Scanner? Unsere klassische App gibt es auch in Telegram — derselbe Bot.',

  languageSelector_label: 'Sprache',
};

export default dict;

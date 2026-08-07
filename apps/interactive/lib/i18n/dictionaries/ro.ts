import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Sari la conținut',

  hero_eyebrow: '// planifică din timp',
  hero_title_line1: 'Planifică-ți traseul —',
  hero_title_line2: 'află ce te așteaptă',
  hero_subtitle:
    'O aplicație gratuită în Telegram construiește un traseu pentru mașină sau bicicletă și arată imediat ce se află pe el: camere, vreme, incidente cunoscute și starea drumului. Pe drum, te ghidează și recalculează automat traseul dacă te abați de la el.',
  cta_open: 'Deschide în Telegram →',

  problem_eyebrow: '// de ce contează',
  problem_title: 'Pe drum, rareori știi din timp ce te așteaptă',
  problem_text:
    'Vremea se schimbă, apar incidente, apar camere noi — și de obicei afli abia când ești deja pe drum, când e greu să reacționezi. Beyond the Wall îți construiește traseul și arată ce se află pe el înainte să pleci, apoi continuă să supravegheze cât timp conduci sau pedalezi.',

  steps_eyebrow: '// cum funcționează',
  steps_title: 'De la punctul A la punctul B — cu imaginea completă a drumului',
  step1_title: 'Stabilește punctele A și B',
  step1_text: 'Locația curentă, un loc salvat sau introducere manuală — apoi alege profilul: mașină sau bicicletă.',
  step2_title: 'Vezi traseul din timp',
  step2_text: 'Camere, vreme, incidente cunoscute și trafic pe traseu — încă înainte de plecare.',
  step3_title: 'Mergi sub supraveghere',
  step3_text: 'Urmărirea live te avertizează dacă te abați de la traseu și îl recalculează automat.',
  step4_title: '„Ce urmează"',
  step4_text: 'O listă cu ce se află la câteva sute de metri în față — o atingere pentru detalii.',

  audience_eyebrow: '// pentru cine',
  audience_title: 'La volan sau pe bicicletă',
  audience_cyclist_title: 'Bicicletă',
  audience_cyclist_text: 'Un traseu adaptat profilului de ciclist, cu avertismente despre camere și condițiile de pe drum.',
  audience_driver_title: 'Mașină',
  audience_driver_text: 'Un traseu pentru mașină, trafic live și recalculare automată dacă drumul este închis sau te abați de la traseu.',

  widget_eyebrow: '// chiar acum',
  widget_title: 'Ce se întâmplă în orașul tău',
  widget_subtitle: 'Detectăm orașul din adresa IP (fără a cere locația exactă) și afișăm vremea live și incidentele rutiere cunoscute din apropiere.',
  widget_loading: 'Detectăm orașul tău…',
  widget_error: 'Datele nu au putut fi încărcate — încearcă să reîmprospătezi pagina mai târziu.',
  widget_unavailable: 'Nu există încă date pentru regiunea ta — acoperirea crește treptat.',
  widget_weather_label: 'Vreme',
  widget_weather_hazard: '⚠ Posibile condiții periculoase pe drum',
  widget_forecast_label: 'Prognoză pe 2 zile',
  widget_incidents_label: 'Incidente rutiere din apropiere',
  widget_incidents_empty: 'Momentan nu au fost găsite incidente cunoscute în apropiere.',
  widget_incidents_source_511ny: 'Sursă: 511NY (statul New York)',
  widget_incidents_source_tomtom: 'Sursă: TomTom Traffic',
  widget_incidents_source_none: 'Nicio sursă de trafic configurată pentru această regiune',
  widget_map_radius_note: 'În raza de {radius} km de orașul tău',
  widget_disclaimer: 'Orașul este detectat din adresa ta IP — aproximativ, fără a cere acces la locația ta exactă.',

  privacy_eyebrow: '// confidențialitate',
  privacy_title: 'Traseul tău rămâne la tine',
  privacy_text:
    'În timpul unei călătorii, coordonatele sunt procesate local, pe telefonul tău — serverul nu primește niciodată un flux al locației tale. Blocul „ce se întâmplă în orașul tău" de mai sus folosește doar un oraș aproximativ din adresa IP, fără locație exactă și fără cereri stocate.',
  privacy_point1: 'Coordonatele din timpul călătoriei nu sunt trimise către server ca date identificate',
  privacy_point2: 'Orașul pentru widgetul live este detectat prin IP — nu prin GPS, fără permisiune de locație',
  privacy_point3: 'Cererile către server nu stochează nimic și nu sunt asociate cu nimeni',

  faq_eyebrow: '// întrebări',
  faq_title: 'Întrebări frecvente',
  faq_q1: 'Este gratuit?',
  faq_a1: 'Da, complet — nu există abonament sau funcții plătite în această etapă.',
  faq_q2: 'Aplicația mă urmărește tot timpul?',
  faq_a2: 'Nu. Urmărirea live rulează doar cât timp ești activ într-o călătorie cu aplicația deschisă și o poți încheia oricând.',
  faq_q3: 'Ce se întâmplă dacă ies de pe traseul planificat?',
  faq_a3: 'Aplicația observă abaterea și îți oferă — sau construiește automat — un traseu nou, fără căutare manuală.',
  faq_q4: 'Datele despre vreme și incidente sunt disponibile pentru orice oraș?',
  faq_a4:
    'Nu — acoperirea depinde de sursă: incidentele de pe traseu prin 511NY sunt disponibile doar în statul New York, TomTom acoperă mai multe regiuni acolo unde este configurat, iar vremea se extinde pe măsură ce crește lista de orașe. Acolo unde nu există date, spunem asta cinstit.',
  faq_q5: 'De unde știe această pagină orașul meu?',
  faq_a5: 'Din adresa IP a browserului tău — aproximativ, la nivel de oraș, fără a cere acces la locația ta exactă.',

  final_title: 'Încearcă chiar acum',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: 'Cauți doar un scanner de camere? Aplicația noastră clasică este tot pe Telegram — același bot.',

  languageSelector_label: 'Limbă',
};

export default dict;

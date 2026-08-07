import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Prejsť na obsah',

  hero_eyebrow: '// naplánuj vopred',
  hero_title_line1: 'Naplánuj trasu —',
  hero_title_line2: 'vedz, čo ťa čaká',
  hero_subtitle:
    'Bezplatná aplikácia v Telegrame vytvorí trasu pre auto alebo bicykel a hneď ukáže, čo je na nej: kamery, počasie, známe incidenty a situáciu na ceste. Počas jazdy ťa vedie a sama trasu prepočíta, ak z nej zídeš.',
  cta_open: 'Otvoriť v Telegrame →',

  problem_eyebrow: '// prečo je to potrebné',
  problem_title: 'Na ceste zvyčajne vopred nevieš, čo ťa čaká',
  problem_text:
    'Počasie sa mení, stávajú sa nehody, objavujú sa nové kamery — a zistíš to väčšinou až na ceste, keď je ťažké niečo zmeniť. Beyond the Wall vytvorí trasu a ukáže, čo je na nej, ešte pred odchodom, a potom to sleduje ďalej, kým si na ceste.',

  steps_eyebrow: '// ako to funguje',
  steps_title: 'Z bodu A do bodu B — s úplným obrazom cesty',
  step1_title: 'Zadaj body A a B',
  step1_text: 'Aktuálna poloha, uložené miesto alebo ručne — a vyber profil: auto alebo bicykel.',
  step2_title: 'Pozri si trasu vopred',
  step2_text: 'Kamery, počasie, známe incidenty a doprava na trase — ešte pred štartom.',
  step3_title: 'Choď pod dohľadom',
  step3_text: 'Živé sledovanie ťa upozorní, ak zídeš z trasy, a samo ju prepočíta.',
  step4_title: '„Čo je pred tebou"',
  step4_text: 'Zoznam toho, čo je pár stoviek metrov pred tebou — jedno ťuknutie na podrobnosti.',

  audience_eyebrow: '// pre koho je to určené',
  audience_title: 'Za volantom alebo na bicykli',
  audience_cyclist_title: 'Bicykel',
  audience_cyclist_text: 'Trasa prispôsobená profilu cyklistu, s upozorneniami na kamery a podmienky na ceste.',
  audience_driver_title: 'Auto',
  audience_driver_text: 'Trasa pre auto, živá doprava a automatické prepočítanie, ak je cesta uzavretá alebo zídeš z trasy.',

  widget_eyebrow: '// práve teraz',
  widget_title: 'Čo sa deje vo vašom meste',
  widget_subtitle: 'Určíme vaše mesto podľa IP adresy (bez žiadosti o presnú polohu) a zobrazíme aktuálne počasie a známe dopravné incidenty v okolí.',
  widget_loading: 'Určujeme vaše mesto…',
  widget_error: 'Dáta sa nepodarilo načítať — skúste stránku neskôr obnoviť.',
  widget_unavailable: 'Pre váš región zatiaľ nie sú dostupné dáta — pokrytie postupne rastie.',
  widget_weather_label: 'Počasie',
  widget_weather_hazard: '⚠ Možné nebezpečné podmienky na ceste',
  widget_forecast_label: 'Predpoveď na 2 dni',
  widget_incidents_label: 'Dopravné incidenty v okolí',
  widget_incidents_empty: 'Momentálne neboli nájdené žiadne známe incidenty v okolí.',
  widget_incidents_source_511ny: 'Zdroj: 511NY (štát New York)',
  widget_incidents_source_tomtom: 'Zdroj: TomTom Traffic',
  widget_incidents_source_none: 'Pre tento región nie je nakonfigurovaný žiadny zdroj dopravy',
  widget_map_radius_note: 'V okruhu {radius} km od vášho mesta',
  widget_map_label: 'Mapa regiónu',
  widget_layer_incidents: 'Incidenty',
  widget_layer_rain: 'Dážď',
  widget_layer_wind: 'Vietor',
  widget_layer_clouds: 'Oblačnosť',
  widget_layer_temp: 'Teplota',
  widget_layer_radar: 'Radar zrážok',
  widget_disclaimer: 'Mesto sa určuje podľa IP adresy — približne, bez žiadosti o presnú polohu.',

  privacy_eyebrow: '// súkromie',
  privacy_title: 'Vaša trasa zostáva u vás',
  privacy_text:
    'Počas jazdy sa súradnice spracúvajú lokálne, vo vašom telefóne — server nedostáva prúd vašej polohy. Blok „čo je vo vašom meste" vyššie používa len približné mesto podľa IP adresy, bez presnej polohy a bez ukladania požiadaviek.',
  privacy_point1: 'Súradnice počas jazdy sa neposielajú na server ako identifikované údaje',
  privacy_point2: 'Mesto pre živý widget sa určuje podľa IP — nie podľa GPS, bez povolenia na polohu',
  privacy_point3: 'Požiadavky na server nič neukladajú a nie sú s nikým spojené',

  faq_eyebrow: '// otázky',
  faq_title: 'Časté otázky',
  faq_q1: 'Je to zadarmo?',
  faq_a1: 'Áno, úplne — v tejto fáze nie je žiadne predplatné ani platené funkcie.',
  faq_q2: 'Sleduje ma aplikácia neustále?',
  faq_a2: 'Nie. Živé sledovanie beží len vtedy, keď aktívne vediete jazdu s otvorenou aplikáciou, a môžete ho kedykoľvek ukončiť.',
  faq_q3: 'Čo ak zídem z naplánovanej trasy?',
  faq_a3: 'Aplikácia si všimne odchýlku a ponúkne — alebo automaticky vytvorí — novú trasu, bez ručného hľadania.',
  faq_q4: 'Sú dáta o počasí a incidentoch dostupné pre každé mesto?',
  faq_a4:
    'Nie — pokrytie závisí od zdroja: incidenty na trase cez 511NY sú dostupné iba v štáte New York, TomTom pokrýva viac regiónov tam, kde je nakonfigurovaný, a počasie sa rozširuje so zoznamom miest. Kde dáta nie sú, poctivo to uvádzame.',
  faq_q5: 'Odkiaľ táto stránka pozná moje mesto?',
  faq_a5: 'Z IP adresy vášho prehliadača — približne, na úrovni mesta, bez žiadosti o prístup k presnej polohe.',

  final_title: 'Vyskúšajte to hneď teraz',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: 'Hľadáte len skener kamier? Naša klasická aplikácia je tiež v Telegrame — ten istý bot.',

  languageSelector_label: 'Jazyk',
};

export default dict;

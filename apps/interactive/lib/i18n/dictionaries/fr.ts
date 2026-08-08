import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Aller au contenu',

  header_slogan: 'Servir et protéger',

  hero_eyebrow: '// planifiez à l’avance',
  hero_title_line1: 'Planifiez votre itinéraire —',
  hero_title_line2: 'sachez ce qui vous attend',
  hero_subtitle:
    "Une application gratuite sur Telegram construit un itinéraire pour la voiture ou le vélo et montre immédiatement ce qui s'y trouve : caméras, météo, incidents connus et état de la route. En chemin, elle vous guide et recalcule automatiquement l'itinéraire si vous vous en écartez.",
  cta_open: 'Ouvrir dans Telegram →',
  hero_image_alt:
    'Vue depuis le volant et depuis le vélo avec une superposition AR : radar à 120 m et itinéraire sûr sans caméra pour le cycliste',

  problem_eyebrow: '// pourquoi c’est utile',
  problem_title: 'Sur la route, on sait rarement à l’avance ce qui nous attend',
  problem_text:
    "La météo change, des incidents surviennent, de nouvelles caméras apparaissent — et on l'apprend souvent une fois déjà sur la route, quand il est difficile de réagir. Beyond the Wall construit votre itinéraire et montre ce qui s'y trouve avant même de partir, puis reste à vos côtés comme un assistant pendant le trajet.",

  steps_eyebrow: '// comment ça marche',
  steps_title: "Du point A au point B — avec une vue complète du trajet",
  steps_photo_mount_alt:
    "Un téléphone fixé sur le tableau de bord avec une superposition AR façon radar : une caméra détectée à 380 m et un autre objet à 750 m devant, données synchronisées avec le cloud",
  steps_photo_handheld_alt:
    "Une main tient un téléphone pointé vers un radar routier : un cadre AR se verrouille dessus, avec en dessous une liste d'autres objets détectés à proximité",
  steps_photo_bike_alt:
    "Vue depuis le guidon d'un vélo avec une superposition AR : un radar à 120 m devant et une étiquette « itinéraire sûr — aucune caméra » sur la piste cyclable",
  step1_title: 'Indiquez les points A et B',
  step1_text: "Position actuelle, lieu enregistré ou saisie manuelle — puis choisissez un profil : voiture ou vélo.",
  step2_title: "Analysez l'itinéraire à l'avance",
  step2_text: "Caméras, météo, incidents connus et trafic sur le trajet — avant même de partir.",
  step3_title: 'Roulez avec un assistant',
  step3_text: "L'assistant vous prévient si vous vous écartez de l'itinéraire et le recalcule automatiquement.",
  step4_title: '« Ce qui vous attend »',
  step4_text: "Une liste de ce qui se trouve à quelques centaines de mètres devant vous — un tap pour voir les détails.",

  audience_eyebrow: '// pour qui',
  audience_title: 'À pied, à vélo ou au volant',
  audience_pedestrian_title: 'À pied',
  audience_pedestrian_text: "Un itinéraire adapté au profil piéton, avec des alertes sur les caméras et les conditions en chemin.",
  audience_cyclist_title: 'Vélo',
  audience_cyclist_text: "Un itinéraire adapté au profil cycliste, avec des alertes sur les caméras et les conditions en chemin.",
  audience_driver_title: 'Voiture',
  audience_driver_text: "Un itinéraire pour la voiture, du trafic en direct et un recalcul automatique si la route est fermée ou si vous vous en écartez.",

  widget_eyebrow: '// en ce moment',
  widget_title: 'Ce qui se passe dans votre ville',
  widget_subtitle: "Nous détectons votre ville à partir de votre adresse IP (sans demander votre position exacte) et affichons la météo en direct ainsi que les incidents routiers connus à proximité.",
  widget_loading: 'Détection de votre ville…',
  widget_error: "Impossible de charger les données — réessayez en actualisant la page plus tard.",
  widget_unavailable: "Aucune donnée disponible pour votre région pour l'instant — la couverture s'étend progressivement.",
  widget_weather_label: 'Météo',
  widget_weather_hazard: '⚠ Conditions routières potentiellement dangereuses',
  widget_forecast_label: 'Prévisions sur 2 jours',
  widget_incidents_label: 'Incidents routiers à proximité',
  widget_incidents_empty: "Aucun incident connu à proximité pour le moment.",
  widget_incidents_source_511ny: 'Source : 511NY (État de New York)',
  widget_incidents_source_tomtom: 'Source : TomTom Traffic',
  widget_incidents_source_none: "Aucune source de trafic configurée pour cette région",
  widget_map_radius_note: 'Dans un rayon de {radius} km autour de votre ville',
  widget_map_label: 'Carte de la région',
  widget_layer_incidents: 'Incidents',
  widget_layer_roads: 'Routes',
  widget_layer_rain: 'Pluie',
  widget_layer_wind: 'Vent',
  widget_layer_clouds: 'Nuages',
  widget_layer_temp: 'Température',
  widget_layer_radar: 'Radar de précipitations',
  widget_disclaimer: "La ville est détectée à partir de votre adresse IP — approximativement, sans demander votre position exacte.",

  feature_map_eyebrow: '// toutes les fonctionnalités',
  feature_map_title: "Tout ce que l'application sait faire — en un coup d'œil",
  feature_map_subtitle: "Du scan AR sur la route à la confidentialité et aux paiements — un aperçu rapide des fonctionnalités clés.",
  feature_map_phone_alt: "Un téléphone avec l'application Beyond the Wall ouverte : carte et interface AR sur l'écran d'accueil",
  feature_ar_scan_title: 'Scan AR',
  feature_ar_scan_text: 'Détection et visualisation des objets en temps réel.',
  feature_on_device_title: 'IA on-device',
  feature_on_device_text: 'Les données sont traitées directement sur votre appareil.',
  feature_live_map_title: 'Carte en direct',
  feature_live_map_text: 'Carte en temps réel des caméras et des objets détectés.',
  feature_drive_mode_title: 'Mode conduite',
  feature_drive_mode_text: 'Un mode centré sur le conducteur, avec un minimum de distractions.',
  feature_confirm_title: 'Vérification',
  feature_confirm_text: 'La confirmation par la communauté améliore la fiabilité des données.',
  feature_navigation_title: 'Navigation',
  feature_navigation_text: 'Une navigation plus sûre basée sur les objets détectés.',
  feature_payment_title: 'Paiements',
  feature_payment_text: "Gratuit pendant la phase de test du projet.",
  feature_mode_switch_title: 'Changement de mode',
  feature_mode_switch_text: "Basculement instantané entre les modes d'utilisation.",
  feature_community_title: 'Communauté',
  feature_community_text: "Partagez et vérifiez les informations avec la communauté.",
  feature_camera_detection_title: 'Détection des caméras',
  feature_camera_detection_text: 'Identifiez les caméras et comprenez leur zone de couverture.',

  privacy_eyebrow: '// confidentialité',
  privacy_title: 'Votre itinéraire reste chez vous',
  privacy_text:
    "Pendant un trajet, les coordonnées sont traitées localement, sur votre téléphone — le serveur ne reçoit jamais un flux de votre position. Le bloc « ce qui se passe dans votre ville » ci-dessus n'utilise qu'une ville approximative déduite de votre adresse IP, sans position exacte et sans requêtes enregistrées.",
  privacy_point1: "Les coordonnées du trajet ne sont pas envoyées au serveur sous forme de données identifiées",
  privacy_point2: "La ville du widget en direct est détectée par IP — pas par GPS, sans autorisation de localisation",
  privacy_point3: "Les requêtes au serveur ne conservent rien et ne sont associées à personne",

  faq_eyebrow: '// questions',
  faq_title: 'Questions fréquentes',
  faq_q1: 'Est-ce gratuit ?',
  faq_a1: "Oui, entièrement — aucun abonnement ni fonctionnalité payante à ce stade.",
  faq_q2: "L'application me suit-elle en permanence ?",
  faq_a2: "Non. Le suivi en direct ne fonctionne que lorsque vous êtes activement en trajet avec l'application ouverte, et vous pouvez l'arrêter à tout moment.",
  faq_q3: "Que se passe-t-il si je sors de l'itinéraire prévu ?",
  faq_a3: "L'application détecte l'écart et propose — ou construit automatiquement — un nouvel itinéraire, sans recherche manuelle.",
  faq_q4: "Les données météo et incidents sont-elles disponibles pour toutes les villes ?",
  faq_a4:
    "Non — la couverture dépend de la source : les incidents d'itinéraire via 511NY ne sont disponibles que dans l'État de New York, TomTom couvre davantage de régions là où il est configuré, et la météo s'étend au fur et à mesure que la liste des villes s'agrandit. Là où il n'y a pas de données, nous le disons honnêtement.",
  faq_q5: 'Comment cette page connaît-elle ma ville ?',
  faq_a5: "À partir de l'adresse IP de votre navigateur — approximativement, au niveau de la ville, sans demander l'accès à votre position exacte.",

  final_title: 'Essayez dès maintenant',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: "Vous cherchez juste un scanner de caméras ? Notre application classique est aussi sur Telegram — le même bot.",

  languageSelector_label: 'Langue',
};

export default dict;

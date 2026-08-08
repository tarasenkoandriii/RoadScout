import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Ir al contenido',

  header_slogan: 'Servir y proteger',

  hero_eyebrow: '// planifica con antelación',
  hero_title_line1: 'Planifica tu ruta —',
  hero_title_line2: 'sabe qué te espera',
  hero_subtitle:
    'Una app gratuita en Telegram crea una ruta para coche o bicicleta y muestra de inmediato qué hay en ella: cámaras, clima, incidentes conocidos y el estado de la vía. Durante el trayecto te guía y recalcula la ruta automáticamente si te desvías.',
  cta_open: 'Abrir en Telegram →',
  hero_image_alt:
    'Vista desde el volante del coche y desde la bicicleta con una capa AR: radar de velocidad a 120 m y una ruta segura sin cámaras para el ciclista',

  problem_eyebrow: '// por qué importa',
  problem_title: 'En la carretera rara vez sabes de antemano qué te espera',
  problem_text:
    'El clima cambia, ocurren incidentes, aparecen nuevas cámaras — y normalmente te enteras cuando ya estás en camino, cuando es difícil reaccionar. Beyond the Wall crea tu ruta y muestra qué hay en ella antes de salir, y sigue a tu lado como un asistente mientras conduces o pedaleas.',

  steps_eyebrow: '// cómo funciona',
  steps_title: 'Del punto A al punto B — con la imagen completa del camino',
  steps_photo_mount_alt:
    'Un teléfono montado en el salpicadero con una capa AR tipo radar: una cámara detectada a 380 m y otro objeto a 750 m por delante, datos sincronizados con la nube',
  steps_photo_handheld_alt:
    'Una mano sostiene un teléfono apuntando a un radar de velocidad en la carretera: un marco AR lo enfoca, y debajo aparece una lista de otros objetos detectados cerca',
  steps_photo_bike_alt:
    'Vista desde el manillar de una bicicleta con una capa AR: un radar de velocidad a 120 m por delante y una etiqueta "ruta segura — sin cámaras" en el carril bici',
  step1_title: 'Indica los puntos A y B',
  step1_text: 'Ubicación actual, un lugar guardado o entrada manual — luego elige un perfil: coche o bicicleta.',
  step2_title: 'Analiza la ruta con antelación',
  step2_text: 'Cámaras, clima, incidentes conocidos y tráfico en el camino — incluso antes de salir.',
  step3_title: 'Viaja con un asistente',
  step3_text: 'El asistente te avisa si te desvías de la ruta y la recalcula automáticamente.',
  step4_title: '«Lo que tienes por delante»',
  step4_text: 'Una lista de lo que hay a unos cientos de metros por delante — un toque para ver los detalles.',

  audience_eyebrow: '// para quién es',
  audience_title: 'A pie, en bicicleta o al volante',
  audience_pedestrian_title: 'A pie',
  audience_pedestrian_text: 'Una ruta adaptada al perfil peatonal, con avisos sobre cámaras y condiciones del camino.',
  audience_cyclist_title: 'Bicicleta',
  audience_cyclist_text: 'Una ruta adaptada al perfil ciclista, con avisos sobre cámaras y condiciones del camino.',
  audience_driver_title: 'Coche',
  audience_driver_text: 'Una ruta para coche, tráfico en vivo y recálculo automático si la vía está cerrada o te desvías.',

  widget_eyebrow: '// justo ahora',
  widget_title: 'Qué está pasando en tu ciudad',
  widget_subtitle: 'Detectamos tu ciudad a partir de tu dirección IP (sin pedir tu ubicación exacta) y mostramos el clima en vivo y los incidentes viales conocidos cercanos.',
  widget_loading: 'Detectando tu ciudad…',
  widget_error: 'No se pudieron cargar los datos — intenta actualizar la página más tarde.',
  widget_unavailable: 'Aún no hay datos disponibles para tu región — la cobertura crece poco a poco.',
  widget_weather_label: 'Clima',
  widget_weather_hazard: '⚠ Posibles condiciones peligrosas en la vía',
  widget_forecast_label: 'Pronóstico a 2 días',
  widget_incidents_label: 'Incidentes viales cercanos',
  widget_incidents_empty: 'Por ahora no se encontraron incidentes conocidos cerca.',
  widget_incidents_source_511ny: 'Fuente: 511NY (estado de Nueva York)',
  widget_incidents_source_tomtom: 'Fuente: TomTom Traffic',
  widget_incidents_source_none: 'No hay fuente de tráfico configurada para esta región',
  widget_map_radius_note: 'En un radio de {radius} km de tu ciudad',
  widget_map_label: 'Mapa de la región',
  widget_layer_incidents: 'Incidentes',
  widget_layer_roads: 'Carreteras',
  widget_layer_rain: 'Lluvia',
  widget_layer_wind: 'Viento',
  widget_layer_clouds: 'Nubosidad',
  widget_layer_temp: 'Temperatura',
  widget_layer_radar: 'Radar de precipitaciones',
  widget_disclaimer: 'La ciudad se detecta a partir de tu dirección IP — de forma aproximada, sin pedir acceso a tu ubicación exacta.',

  feature_map_eyebrow: '// todas las funciones',
  feature_map_title: 'Todo lo que la app puede hacer — de un vistazo',
  feature_map_subtitle: 'Desde el escaneo AR en la carretera hasta la privacidad y los pagos: un resumen rápido de las funciones clave.',
  feature_map_phone_alt: 'Un teléfono con la app Beyond the Wall abierta: mapa e interfaz AR en la pantalla principal',
  feature_ar_scan_title: 'Escaneo AR',
  feature_ar_scan_text: 'Detección y visualización de objetos en tiempo real.',
  feature_on_device_title: 'IA on-device',
  feature_on_device_text: 'Los datos se procesan directamente en tu dispositivo.',
  feature_live_map_title: 'Mapa en vivo',
  feature_live_map_text: 'Mapa en tiempo real de cámaras y objetos detectados.',
  feature_drive_mode_title: 'Modo conducción',
  feature_drive_mode_text: 'Un modo centrado en el conductor, con distracciones mínimas.',
  feature_confirm_title: 'Verificación',
  feature_confirm_text: 'La confirmación de la comunidad mejora la fiabilidad de los datos.',
  feature_navigation_title: 'Navegación',
  feature_navigation_text: 'Navegación más segura basada en los objetos detectados.',
  feature_payment_title: 'Pagos',
  feature_payment_text: 'Gratis durante la etapa de pruebas del proyecto.',
  feature_mode_switch_title: 'Cambio de modo',
  feature_mode_switch_text: 'Cambio instantáneo entre los modos de uso.',
  feature_community_title: 'Comunidad',
  feature_community_text: 'Comparte y verifica información junto con la comunidad.',
  feature_camera_detection_title: 'Detección de cámaras',
  feature_camera_detection_text: 'Identifica las cámaras y entiende su zona de cobertura.',

  privacy_eyebrow: '// privacidad',
  privacy_title: 'Tu ruta se queda contigo',
  privacy_text:
    'Durante un viaje, las coordenadas se procesan localmente en tu teléfono — el servidor nunca recibe un flujo de tu ubicación. El bloque «qué está pasando en tu ciudad» de arriba solo usa una ciudad aproximada a partir de tu IP, sin ubicación exacta y sin guardar solicitudes.',
  privacy_point1: 'Las coordenadas del viaje no se envían al servidor como datos identificados',
  privacy_point2: 'La ciudad del widget en vivo se detecta por IP — no por GPS, sin permiso de ubicación',
  privacy_point3: 'Las solicitudes al servidor no guardan nada y no están vinculadas a nadie',

  faq_eyebrow: '// preguntas',
  faq_title: 'Preguntas frecuentes',
  faq_q1: '¿Es gratis?',
  faq_a1: 'Sí, totalmente — en esta etapa no hay suscripción ni funciones de pago.',
  faq_q2: '¿La app me rastrea todo el tiempo?',
  faq_a2: 'No. El seguimiento en vivo solo funciona mientras estás activamente en un viaje con la app abierta, y puedes terminarlo en cualquier momento.',
  faq_q3: '¿Qué pasa si me salgo de la ruta planificada?',
  faq_a3: 'La app detecta la desviación y ofrece — o construye automáticamente — una nueva ruta, sin búsqueda manual.',
  faq_q4: '¿Los datos de clima e incidentes están disponibles para cualquier ciudad?',
  faq_a4:
    'No — la cobertura depende de la fuente: los incidentes de ruta vía 511NY solo están disponibles en el estado de Nueva York, TomTom cubre más regiones donde está configurado, y el clima crece junto con la lista de ciudades. Donde no hay datos, lo decimos con honestidad.',
  faq_q5: '¿Cómo sabe esta página cuál es mi ciudad?',
  faq_a5: 'Por la dirección IP de tu navegador — de forma aproximada, a nivel de ciudad, sin pedir acceso a tu ubicación exacta.',

  final_title: 'Pruébalo ahora mismo',
  footer_copyright: '© {year} Beyond the Wall',
  footer_note: '¿Solo buscas un escáner de cámaras? Nuestra app clásica también está en Telegram — el mismo bot.',

  languageSelector_label: 'Idioma',
};

export default dict;

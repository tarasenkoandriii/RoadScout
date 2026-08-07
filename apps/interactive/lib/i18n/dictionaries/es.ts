import { Dictionary } from '../dictionary.types';

const dict: Dictionary = {
  skipLink: 'Ir al contenido',

  hero_eyebrow: '// planifica con antelación',
  hero_title_line1: 'Planifica tu ruta —',
  hero_title_line2: 'sabe qué te espera',
  hero_subtitle:
    'Una app gratuita en Telegram crea una ruta para coche o bicicleta y muestra de inmediato qué hay en ella: cámaras, clima, incidentes conocidos y el estado de la vía. Durante el trayecto te guía y recalcula la ruta automáticamente si te desvías.',
  cta_open: 'Abrir en Telegram →',

  problem_eyebrow: '// por qué importa',
  problem_title: 'En la carretera rara vez sabes de antemano qué te espera',
  problem_text:
    'El clima cambia, ocurren incidentes, aparecen nuevas cámaras — y normalmente te enteras cuando ya estás en camino, cuando es difícil reaccionar. Beyond the Wall crea tu ruta y muestra qué hay en ella antes de salir, y sigue vigilando mientras conduces o pedaleas.',

  steps_eyebrow: '// cómo funciona',
  steps_title: 'Del punto A al punto B — con la imagen completa del camino',
  step1_title: 'Indica los puntos A y B',
  step1_text: 'Ubicación actual, un lugar guardado o entrada manual — luego elige un perfil: coche o bicicleta.',
  step2_title: 'Ve la ruta con antelación',
  step2_text: 'Cámaras, clima, incidentes conocidos y tráfico en el camino — incluso antes de salir.',
  step3_title: 'Viaja con guía en vivo',
  step3_text: 'El seguimiento en vivo avisa si te desvías de la ruta y la recalcula automáticamente.',
  step4_title: '«Lo que tienes por delante»',
  step4_text: 'Una lista de lo que hay a unos cientos de metros por delante — un toque para ver los detalles.',

  audience_eyebrow: '// para quién es',
  audience_title: 'Al volante o en bicicleta',
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
  widget_incidents_label: 'Incidentes viales cercanos',
  widget_incidents_empty: 'Por ahora no se encontraron incidentes conocidos cerca.',
  widget_incidents_source_511ny: 'Fuente: 511NY (estado de Nueva York)',
  widget_incidents_source_tomtom: 'Fuente: TomTom Traffic',
  widget_incidents_source_none: 'No hay fuente de tráfico configurada para esta región',
  widget_disclaimer: 'La ciudad se detecta a partir de tu dirección IP — de forma aproximada, sin pedir acceso a tu ubicación exacta.',

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

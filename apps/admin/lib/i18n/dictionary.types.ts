// Единый тип словаря — если добавить/убрать ключ здесь, TS заставит обновить ВСЕ 10 файлов в
// dictionaries/*.ts (иначе ошибка компиляции "Property X is missing"). Это и есть гарантия
// "полных словарей для всех языков" на уровне тайпчекинга, а не просто обещание в комментарии.
export interface Dictionary {
  // --- общее (шапка, логаут, экран входа) ---
  nav_myHome: string;
  nav_border: string;
  nav_myAlerts: string;
  nav_addCamera: string;
  logout: string;
  authGate_loading: string;
  authGate_loginTitle: string;
  authGate_loginError: string;
  share_button: string;
  embed_button: string;
  follow_button: string;
  follow_confirmation: string;

  // --- главная страница поиска (app/page.tsx) ---
  search_title: string;
  search_subtitle: string;
  search_addressPlaceholder: string;
  search_button: string;
  search_buttonLoading: string;
  search_addressNotRecognized: string;
  // {city} / {country} — подставляются в коде через .replace()
  search_noCamerasForeignCity: string;
  search_noCamerasFound: string;
  // {distance} / {direction}
  camera_distanceDirection: string;
  camera_estimatedWarning: string;
  camera_possiblyBlocked: string;
  // {minutes}
  camera_delay: string;
  camera_openStream: string;
  status_online: string;
  status_delayed: string;
  status_offline: string;
  status_disabledSecurity: string;
  status_unknown: string;
  weather_title: string;
  footer_disclaimer: string;

  // --- "Мой дом" (app/my-home/page.tsx) ---
  myHome_title: string;
  myHome_subtitle: string;
  myHome_loading: string;
  myHome_rejectedPrefix: string;
  // {reason}
  myHome_rejectedReasonSuffix: string;
  myHome_canResubmit: string;
  myHome_addressLabel: string;
  myHome_addressPlaceholder: string;
  myHome_receiptLabel: string;
  myHome_receiptOptionalForAdmin: string;
  myHome_adminNote: string;
  myHome_dateWarningLabel: string;
  myHome_dateWarningText: string;
  myHome_submitButton: string;
  myHome_submitButtonLoading: string;
  myHome_errorMissingFields: string;
  myHome_errorGeneric: string;
  myHomeStatus_none: string;
  myHomeStatus_pending: string;
  myHomeStatus_needsReview: string;
  myHomeStatus_approved: string;
  myHomeStatus_rejected: string;
  myHome_addressPrefix: string;
  myHome_needsReviewNote: string;
  // {address}
  myHome_approvedPrefix: string;
  myHome_noCamerasFound: string;
  // {distance} / {direction}
  myHome_cameraDistanceDirection: string;

  // --- "Час очікування на кордоні" (app/border/page.tsx) ---
  border_title: string;
  border_subtitle: string;
  border_directionOut: string;
  border_directionIn: string;
  // {direction} / {summary}
  border_directionSummary: string;
  border_noRecentReports: string;
  // {avg} / {count}
  border_summaryTemplate: string;
  border_loading: string;
  border_reportFormTitle: string;
  border_crossingLabel: string;
  border_directionLabel: string;
  border_minutesLabel: string;
  border_minutesPlaceholder: string;
  border_errorInvalidMinutes: string;
  border_errorGeneric: string;
  border_submitButton: string;
  border_submitButtonLoading: string;

  // --- "Мої підписки-алерти" (app/my-alerts/page.tsx) ---
  myAlerts_title: string;
  myAlerts_subtitle: string;
  myAlerts_typeCameraStatus: string;
  myAlerts_typeAreaIncident: string;
  // {date}
  myAlerts_lastNotified: string;
  myAlerts_unsubscribe: string;
  myAlerts_empty: string;
  myAlerts_formTitle: string;
  myAlerts_labelName: string;
  myAlerts_namePlaceholder: string;
  myAlerts_labelLat: string;
  myAlerts_labelLng: string;
  myAlerts_useMyLocation: string;
  myAlerts_labelRadius: string;
  myAlerts_errorMissingFields: string;
  myAlerts_errorGeneric: string;
  myAlerts_submitButton: string;
  myAlerts_submitButtonLoading: string;

  // --- "Додати камеру" (app/add-camera/page.tsx) ---
  addCamera_title: string;
  addCamera_subtitle: string;
  addCamera_labelStreamUrl: string;
  addCamera_labelName: string;
  addCamera_namePlaceholder: string;
  addCamera_labelCity: string;
  addCamera_cityNotSpecified: string;
  addCamera_labelAddress: string;
  addCamera_labelDescription: string;
  addCamera_errorMissingUrl: string;
  addCamera_errorGeneric: string;
  addCamera_submitButton: string;
  addCamera_submitButtonLoading: string;
  addCamera_myRequestsTitle: string;
  addCamera_statusPending: string;
  addCamera_statusApproved: string;
  addCamera_statusRejected: string;
  addCamera_noRequests: string;

  // --- "Заявки на камери" (app/admin/camera-submissions/page.tsx) ---
  cameraSubmissions_title: string;
  cameraSubmissions_showAll: string;
  cameraSubmissions_colLink: string;
  cameraSubmissions_colStatus: string;
  cameraSubmissions_colSubmittedAt: string;
  cameraSubmissions_empty: string;
  cameraSubmissions_open: string;
  cameraSubmissions_labelName: string;
  cameraSubmissions_labelStreamType: string;
  cameraSubmissions_labelLat: string;
  cameraSubmissions_labelLng: string;
  cameraSubmissions_labelAzimuth: string;
  cameraSubmissions_labelFov: string;
  cameraSubmissions_labelRange: string;
  cameraSubmissions_calibrationNote: string;
  cameraSubmissions_approveButton: string;
  cameraSubmissions_rejectReasonPlaceholder: string;
  cameraSubmissions_rejectButton: string;
  cameraSubmissions_labelLocationType: string;
  cameraSubmissions_locationOutdoor: string;
  cameraSubmissions_locationIndoor: string;
  cameraSubmissions_askAi: string;
  cameraSubmissions_askAiBusy: string;
  cameraSubmissions_aiNotConfigured: string;
  cameraSubmissions_aiAddressLabel: string;
  cameraSubmissions_aiCoordsLabel: string;
  cameraSubmissions_aiPlacesCoordsLabel: string;
  cameraSubmissions_aiUse: string;
  cameraSubmissions_aiFoundLabel: string;
  cameraSubmissions_osmTitle: string;
  cameraSubmissions_osmLoading: string;
  cameraSubmissions_osmCoordsLabel: string;
  cameraSubmissions_osmNotFound: string;
  cameraSubmissions_aiIndoorLabel: string;
  cameraSubmissions_aiApply: string;
  cameraSubmissions_yes: string;
  cameraSubmissions_no: string;
}

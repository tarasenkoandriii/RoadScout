import { WeatherIconKind } from '../components/WeatherIcon';

// Спільні типи для контракту GET /btw/landing-snapshot (apps/api/src/btw/btw-landing-snapshot.service.ts)
// — винесено в один файл, щоб CityWidget.tsx і CityMapPanel.tsx не дублювали одні й ті самі
// інтерфейси (на відміну від НАМІРЕНОГО дублювання через межу фронтенд/бекенд — тут обидва файли
// в межах одного й того ж фронтенд-проєкту, спільний імпорт дешевший і безпечніший за копію).

export interface WeatherForecastDay {
  dateIso: string;
  weatherCode: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  tempMaxC: number | null;
  tempMinC: number | null;
}

export interface LandingWeatherSummary {
  available: boolean;
  tempC: number | null;
  conditionLabel: string;
  iconKind: WeatherIconKind | null;
  isHazard: boolean;
  forecast: WeatherForecastDay[];
}

export interface LandingSnapshotIncident {
  id: string;
  source: '511NY' | 'TomTom';
  title: string;
  severity: string;
  distanceKm: number;
  lat: number;
  lng: number;
}

export interface LandingIncidentsSummary {
  source: '511NY' | 'TomTom' | null;
  configured: boolean;
  items: LandingSnapshotIncident[];
  coverageNote: 'ny-state' | 'tomtom' | 'not-configured';
  radiusKm: number;
}

export interface LandingSnapshot {
  cityLabel: string;
  weather: LandingWeatherSummary;
  incidents: LandingIncidentsSummary;
}

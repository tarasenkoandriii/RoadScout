import { Injectable, Logger } from '@nestjs/common';
import * as turf from '@turf/turf';
import { LatLng } from '../common/geometry.util';

interface BuildingCacheEntry {
  buildings: any[];
  expiresAt: number;
}

// Stage 2 heuristic from the ТЗ (section 6): pulls nearby building footprints from OSM
// and checks whether the camera→address line crosses any of them. This is a best-effort
// signal, not a guarantee — deliberately conservative (only flags, never hard-filters).
//
// ВИПРАВЛЕНО за прямим запитом користувача — аудит на сумісність з Vercel Hobby
// (doc/AUDIT-vercel-hobby.md, "залишковий ризик"): раніше цей коментар прямо казав "not
// cached across requests" — і BTW (doc/AUDIT-btw.md) викликає isPossiblyBlocked() 9 разів НА
// КОЖНОГО кандидата-камеру НА КОЖЕН тик сканування (кожні ~2с) — десятки некешованих
// Overpass-запитів на один тик. Тепер кешується по (гридключ центру, радіус, округлений
// ВГОРУ до 100м) — усі 9 точок сэмплювання для ОДНОГО кандидата майже завжди мають той самий
// гридключ камери (center = сама камера, не міняється між точками!) і схожий/однаковий
// округлений радіус (searchRadiusM обмежений зверху 300м у BtwService), тому фактично
// ДІЛЯТЬ ОДИН кеш-запис — 9 запитів на кандидата стають 1.
@Injectable()
export class OcclusionService {
  private readonly logger = new Logger(OcclusionService.name);
  private readonly buildingCache = new Map<string, BuildingCacheEntry>();

  async isPossiblyBlocked(camera: LatLng, target: LatLng, searchRadiusM: number): Promise<boolean> {
    try {
      const buildings = await this.getBuildingsCached(camera, searchRadiusM);
      if (!buildings.length) return false;

      const cameraPoint = turf.point([camera.lng, camera.lat]);
      const targetPoint = turf.point([target.lng, target.lat]);
      const line = turf.lineString([
        [camera.lng, camera.lat],
        [target.lng, target.lat],
      ]);

      return buildings.some((building) => {
        try {
          // Both endpoints of the line almost always sit on/inside a building: the camera's
          // own mount, and the target address itself. Without excluding those two, the line
          // would trivially "intersect" them at its endpoints regardless of what's actually
          // in between, flagging nearly every result as blocked.
          if (turf.booleanPointInPolygon(cameraPoint, building)) return false;
          if (turf.booleanPointInPolygon(targetPoint, building)) return false;
          return turf.booleanIntersects(line, building);
        } catch {
          return false; // malformed OSM geometry — skip rather than fail the whole check
        }
      });
    } catch (err) {
      this.logger.warn(`Occlusion check failed: ${(err as Error).message}`);
      return false; // fail-open: don't hide a camera just because Overpass timed out
    }
  }

  // Округлення радіусу ВГОРУ (не вниз і не найближче) — набір будівель, отриманий на
  // БІЛЬШОМУ радіусі, лишається коректним (надмножина) для перевірки перетину лінії, що
  // повністю вкладається в МЕНШИЙ радіус — тому можна безпечно перевикористати ширший кеш-
  // запис для запиту з меншим фактичним радіусом, а не робити новий Overpass-виклик.
  private async getBuildingsCached(center: LatLng, radiusM: number): Promise<any[]> {
    const bucketRadius = Math.ceil(radiusM / 100) * 100;
    const key = `${this.gridKey(center)}:${bucketRadius}`;
    const cached = this.buildingCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.buildings;
    }

    const buildings = await this.fetchNearbyBuildings(center, bucketRadius);
    this.buildingCache.set(key, { buildings, expiresAt: Date.now() + getOcclusionCacheTtlMs() });
    return buildings;
  }

  // Той самий гридключ (~100м сітка), що вже перевірений в AzimuthHeuristicService — не той
  // самий Map (інша форма значення — масив полігонів будівель, не AzimuthGuess), тому окрема
  // копія логіки, не імпорт з іншого файлу.
  private gridKey(p: LatLng): string {
    const round = (v: number) => Math.round(v / 0.001) * 0.001;
    return `${round(p.lat).toFixed(3)},${round(p.lng).toFixed(3)}`;
  }

  private async fetchNearbyBuildings(center: LatLng, radiusM: number): Promise<any[]> {
    const query = `
      [out:json][timeout:10];
      way(around:${radiusM},${center.lat},${center.lng})["building"];
      out geom;
    `;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
    });
    const data = await res.json();

    return (data.elements ?? [])
      .filter((el: any) => el.geometry?.length >= 3)
      .map((el: any) =>
        turf.polygon([[...el.geometry.map((p: any) => [p.lon, p.lat]), [el.geometry[0].lon, el.geometry[0].lat]]]),
      );
  }
}

// Той самий типовий TTL, що вже застосований в azimuth-heuristic.service.ts (24 години за
// замовчуванням) — окрема змінна середовища (не спільна з тим файлом), оскільки фізичні
// будівлі змінюються ще рідше за дорожню мережу, тому доцільно мати змогу налаштувати цей
// TTL окремо, довшим, якщо буде потрібно.
function getOcclusionCacheTtlMs(): number {
  const hours = parseInt(process.env.OCCLUSION_CACHE_TTL_HOURS ?? '', 10);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

// apps/btw/lib/edge-index.ts
//
// ЧЕСНА ЗАМІНА Flatbush (§4.7.2 ТЗ: "Flatbush-індексів (серіалізуються як ArrayBuffer)").
//
// Справжня бібліотека `flatbush` НЕ встановлена в цьому середовищі — перевірено прямо:
// `npm view flatbush version` (як і раніше `npm view pmtiles version` і `npx typescript`)
// повертає 403 Forbidden від registry.npmjs.org, і жодного вже встановленого node_modules
// немає під жодним apps/* (repo тут ніколи не проходив `npm install`). Тому замість реального
// статичного R-tree — простий bbox-префільтрований лінійний скан по всіх ребрах будинків
// поточного тайлу.
//
// Чому це прийнятний субститут (а не просто "гірше"):
// - Один тайл (§4.7.1: z15 ≈ 1.2×1.2км, або, у нашому спрощеному варіанті без PMTiles-пірамід —
//   ОДНЕ ціле місто, див. AUDIT-btw-radar-m1-m2.md) містить порядка сотень-тисяч ребер, а не
//   мільйонів — лінійний скан з bbox-відсіканням (простий `if` замість дерева) залишається
//   в межах бюджету одного кадру (findOccluder викликається раз на скан, не 60 разів/с).
// - Інтерфейс `EdgeIndex` (див. btw-geometry-engine.ts) навмисно спроєктований однаково для
//   обох реалізацій — якщо колись з'явиться мережевий доступ і реальний `flatbush` встановиться,
//   досить замінити ЛИШЕ цей файл; increment ніде більше не потрібен.
// - Це той самий принцип чесного документування субституції, що вже є в AUDIT-btw.md щодо
//   PostGIS-розширень, яких не було в сендбоксі.

import type { BuildingEdge, EdgeIndex } from './btw-geometry-engine';
import type { FlatBuildingEdge } from './tile-format';

// Проста bbox-обгортка навколо кожного ребра — уникає перерахунку min/max при кожному search().
interface IndexedEdge {
  edge: BuildingEdge;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class LinearScanEdgeIndex implements EdgeIndex {
  private readonly items: IndexedEdge[];

  constructor(edges: BuildingEdge[] | FlatBuildingEdge[]) {
    this.items = edges.map((e) => ({
      edge: e as BuildingEdge,
      minX: Math.min(e.a.x, e.b.x),
      minY: Math.min(e.a.y, e.b.y),
      maxX: Math.max(e.a.x, e.b.x),
      maxY: Math.max(e.a.y, e.b.y),
    }));
  }

  search(bboxMinX: number, bboxMinY: number, bboxMaxX: number, bboxMaxY: number): BuildingEdge[] {
    const out: BuildingEdge[] = [];
    for (const it of this.items) {
      // Стандартний тест перетину прямокутників (AABB overlap) — та сама логіка, що Flatbush
      // виконує внутрішньо через дерево, тут лінійно по всіх елементах.
      if (it.maxX < bboxMinX || it.minX > bboxMaxX || it.maxY < bboxMinY || it.minY > bboxMaxY) {
        continue;
      }
      out.push(it.edge);
    }
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}

// Зручний фабричний метод — Worker викликає це одразу після tile-format.ts::buildingsToEdges().
export function buildEdgeIndex(edges: BuildingEdge[] | FlatBuildingEdge[]): LinearScanEdgeIndex {
  return new LinearScanEdgeIndex(edges);
}

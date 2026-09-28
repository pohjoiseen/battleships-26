import {
  CELL_COUNT,
  FLEET,
  ORIENTATIONS,
  randomLayout,
  SEA_HIT,
  SEA_MISS,
  SEA_UNKNOWN,
  type ShipClass,
  neighbours8,
  placementIndices,
  placementInBounds,
  shipSize,
} from '@bs/shared';
import type { AiPlayer, ShotRequest } from './types.ts';

interface Candidate {
  cells: number[];
  /** Cells touching the ship but not part of it; no other ship may be there. */
  rim: number[];
  /** Whether any cell lies on the outermost row or column. */
  onEdge: boolean;
}

const isEdgeCell = (i: number) => {
  const x = i % 20;
  const y = Math.floor(i / 20);
  return x === 0 || y === 0 || x === 19 || y === 19;
};

/** Every on-board placement of each ship class, with its rim, computed once. */
const CANDIDATES = new Map<ShipClass, Candidate[]>();
for (const spec of FLEET) {
  if (CANDIDATES.has(spec.cls)) continue;
  const list: Candidate[] = [];
  for (let orientation = 0; orientation < ORIENTATIONS[spec.cls].length; orientation++) {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const p = { shipId: spec.id, orientation, x, y };
        if (!placementInBounds(p)) continue;
        const cells = placementIndices(p);
        const own = new Set(cells);
        const rim = new Set<number>();
        for (const c of cells) for (const n of neighbours8(c)) if (!own.has(n)) rim.add(n);
        list.push({ cells, rim: [...rim], onEdge: cells.some(isEdgeCell) });
      }
    }
  }
  CANDIDATES.set(spec.cls, list);
}

/** Placements that cover known hits are this much likelier, per hit covered. */
const HIT_WEIGHT = 50;

export interface DensityOptions {
  /**
   * How much likelier a ship is assumed to be somewhere touching the edge. Uniformly random
   * fleets would say 1, but people like the rim: a ship there blocks less of the sea.
   */
  edgeBonus: number;
}

/**
 * Edge bonus 3 measured with `npm run bench:ai`: against uniformly random fleets it costs about
 * 0.3 salvos per game (8.7 → 9.0), against fleets hugging the edge it saves about 1.75 (9.8 → 8.1).
 */
export const DEFAULT_DENSITY: DensityOptions = { edgeBonus: 3 };

/**
 * Probability-density targeting. For every enemy ship still afloat, counts the placements that
 * fit what is known (no misses under it, no hits touching it from outside, no more hits than
 * the ship has taken) and shoots the cells covered most often. Placements through known hits
 * dominate, so it finishes off damaged ships; otherwise it hunts, spreading a salvo out by not
 * counting a hunting placement twice.
 */
export function chooseShotsByDensity(
  request: ShotRequest,
  rng: { next(): number },
  opts: DensityOptions = DEFAULT_DENSITY,
): number[] {
  const { sea, damage, count } = request;

  // Placements consistent with the board; these don't change while a salvo is being chosen.
  let hunting: { cells: number[]; weight: number }[] = [];
  const targeting: { cells: number[]; weight: number }[] = [];
  for (const ship of FLEET) {
    if (damage[ship.id]! >= shipSize(ship.id)) continue;
    for (const cand of CANDIDATES.get(ship.cls)!) {
      let hits = 0;
      let blocked = false;
      for (const c of cand.cells) {
        if (sea[c] === SEA_MISS) {
          blocked = true;
          break;
        }
        if (sea[c] === SEA_HIT) hits++;
      }
      if (blocked || hits > damage[ship.id]!) continue;
      if (cand.rim.some((c) => sea[c] === SEA_HIT)) continue;
      if (hits > 0) targeting.push({ cells: cand.cells, weight: HIT_WEIGHT ** hits });
      else hunting.push({ cells: cand.cells, weight: cand.onEdge ? opts.edgeBonus : 1 });
    }
  }

  const chosen = new Set<number>();
  while (chosen.size < count) {
    const density = new Float64Array(CELL_COUNT);
    for (const { cells, weight } of targeting) for (const c of cells) density[c]! += weight;
    for (const { cells, weight } of hunting) for (const c of cells) density[c]! += weight;

    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (sea[c] !== SEA_UNKNOWN || chosen.has(c)) continue;
      // tiny noise breaks ties randomly; a zero-density cell still beats nothing
      const score = density[c]! + rng.next() * 1e-3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best < 0) break; // no unshot cells left
    chosen.add(best);
    // a hunting placement is already being tested by this shot, don't count it again
    hunting = hunting.filter(({ cells }) => !cells.includes(best));
  }
  return [...chosen];
}

export const simpleAi: AiPlayer = {
  placeFleet: (rng) => randomLayout(rng),
  chooseShots: (request, rng) => chooseShotsByDensity(request, rng),
};

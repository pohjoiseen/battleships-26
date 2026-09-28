import { BOARD_SIZE, CELL_COUNT, neighbours8 } from './geometry.ts';
import type { Rng } from './rng.ts';
import {
  FLEET,
  ORIENTATIONS,
  type Placement,
  placementInBounds,
  placementIndices,
} from './ships.ts';

/** One placement per fleet ship, indexed by ship id. */
export type Layout = Placement[];

export type LayoutProblem =
  | { kind: 'structure'; message: string }
  | { kind: 'bounds'; shipIds: number[] }
  | { kind: 'overlap'; shipIds: number[] }
  | { kind: 'touch'; shipIds: number[] };

/** Checks only that the layout has the right ships and orientations; says nothing about rules. */
export function layoutStructureProblem(layout: Layout): string | null {
  if (layout.length !== FLEET.length) return `expected ${FLEET.length} ships`;
  for (const [i, p] of layout.entries()) {
    if (p.shipId !== i) return `ship ${i} out of order`;
    const count = ORIENTATIONS[FLEET[i]!.cls].length;
    if (!Number.isInteger(p.orientation) || p.orientation < 0 || p.orientation >= count) {
      return `bad orientation for ship ${i}`;
    }
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return `bad position for ship ${i}`;
  }
  return null;
}

/**
 * Ships that break a rule: off the board, overlapping another ship, or touching one (even by a
 * corner). Used both to reject layouts and to highlight offending ships while placing.
 */
export function conflictingShips(layout: Layout): Set<number> {
  const bad = new Set<number>();
  const owner = new Array<number>(CELL_COUNT).fill(-1);
  for (const p of layout) {
    if (!placementInBounds(p)) {
      bad.add(p.shipId);
      continue;
    }
    for (const i of placementIndices(p)) {
      const other = owner[i]!;
      if (other >= 0) {
        bad.add(other);
        bad.add(p.shipId);
      }
      owner[i] = p.shipId;
    }
  }
  for (const p of layout) {
    if (!placementInBounds(p)) continue;
    for (const i of placementIndices(p)) {
      for (const n of neighbours8(i)) {
        const other = owner[n]!;
        if (other >= 0 && other !== p.shipId) {
          bad.add(other);
          bad.add(p.shipId);
        }
      }
    }
  }
  return bad;
}

export function isValidLayout(layout: Layout): boolean {
  return layoutStructureProblem(layout) === null && conflictingShips(layout).size === 0;
}

/** Map from cell index to ship id (or -1) for a valid layout. */
export function occupancy(layout: Layout): number[] {
  const owner = new Array<number>(CELL_COUNT).fill(-1);
  for (const p of layout) for (const i of placementIndices(p)) owner[i] = p.shipId;
  return owner;
}

/** A random valid layout. Biggest ships go first; on a dead end the whole attempt restarts. */
export function randomLayout(rng: Rng): Layout {
  const order = [...FLEET].sort(
    (a, b) => ORIENTATIONS[b.cls][0]!.length - ORIENTATIONS[a.cls][0]!.length,
  );
  for (;;) {
    const placed: Placement[] = [];
    let failed = false;
    for (const spec of order) {
      let ok = false;
      for (let attempt = 0; attempt < 200 && !ok; attempt++) {
        const p: Placement = {
          shipId: spec.id,
          orientation: rng.int(ORIENTATIONS[spec.cls].length),
          x: rng.int(BOARD_SIZE),
          y: rng.int(BOARD_SIZE),
        };
        if (placementInBounds(p) && conflictingShips([...placed, p]).size === 0) {
          placed.push(p);
          ok = true;
        }
      }
      if (!ok) {
        failed = true;
        break;
      }
    }
    if (!failed) return placed.sort((a, b) => a.shipId - b.shipId);
  }
}

import {
  CELL_COUNT,
  FLEET,
  neighbours8,
  ORIENTATIONS,
  placementInBounds,
  placementIndices,
  randomLayout,
  createRng,
  type Rng,
  SEA_HIT,
  SEA_MISS,
  SEA_UNKNOWN,
  type ShipClass,
} from '@bs/shared';
import { chooseShotsByDensity } from './simple.ts';
import type { AiPlayer, ShotRequest } from './types.ts';

/**
 * Monte Carlo AI. It samples whole enemy fleets that fit everything it has seen (misses, hits,
 * the damage each ship picture shows, ships never touching), scores salvos over those fleets
 * (finding ships first, then finishing them), and looks ahead: it plays candidate salvos out to
 * the end of the game in some of the sampled fleets and keeps the one that leaves the enemy
 * least firepower. It only knows what a human player would.
 */

export interface StrongOptions {
  /** Independent sampler runs, each from its own random fleet. */
  chains: number;
  /** Sweeps (every ship re-placed once) before a chain's fleets count. */
  burnIn: number;
  /** Fleets kept per chain, one per sweep. */
  samples: number;
  /** What the first hit on an unhit ship is worth, besides the hit: it has been found. */
  findBonus: number;
  /** What a hit on a ship already damaged is worth, besides the hit: finish what's found. */
  finishBonus: number;
  /** How much likelier a ship is assumed to touch the edge (people like the rim). */
  edgeBonus: number;
  /** Finish bonuses of the candidate salvos the lookahead plays out (one: no lookahead). */
  candidates: number[];
  /** Sampled fleets each candidate is played out in. */
  worlds: number;
}

/**
 * Tuned with head-to-head games (see bench.ts). Finding ships matters most: it sinks a fleet in
 * the fewest salvos. But found ships left afloat keep firing, so without the finish bonus it
 * loses most games. The edge bonus costs a little against uniformly random fleets and gains a
 * lot against fleets hugging the rim, as people's do.
 */
export const DEFAULT_STRONG: StrongOptions = {
  chains: 8,
  burnIn: 20,
  samples: 200,
  findBonus: 30,
  finishBonus: 8,
  edgeBonus: 3,
  candidates: [3, 8, 20],
  worlds: 8,
};

interface Candidate {
  cells: Int16Array;
  /** The cells and all their neighbours: no other ship's cell may be here. */
  zone: Int16Array;
  onEdge: boolean;
}

const isEdgeCell = (i: number) => {
  const x = i % 20;
  const y = Math.floor(i / 20);
  return x === 0 || y === 0 || x === 19 || y === 19;
};

/** Every on-board placement of each ship class, computed once. */
const CANDIDATES = new Map<ShipClass, Candidate[]>();
for (const spec of FLEET) {
  if (CANDIDATES.has(spec.cls)) continue;
  const list: Candidate[] = [];
  ORIENTATIONS[spec.cls].forEach((_, orientation) => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const p = { shipId: spec.id, orientation, x, y };
        if (!placementInBounds(p)) continue;
        const cells = placementIndices(p);
        const zone = new Set(cells);
        for (const c of cells) for (const n of neighbours8(c)) zone.add(n);
        list.push({
          cells: Int16Array.from(cells),
          zone: Int16Array.from(zone),
          onEdge: cells.some(isEdgeCell),
        });
      }
    }
  });
  CANDIDATES.set(spec.cls, list);
}

/**
 * The placements each ship could have: no miss under it, no hit next to it (that would be
 * another ship touching it), and exactly as many hits under it as its picture shows. Since
 * ships can't overlap, fleets built from these cover every hit exactly once.
 */
function shipCandidates(request: ShotRequest): Candidate[][] {
  const { sea, damage } = request;
  return FLEET.map((spec) =>
    CANDIDATES.get(spec.cls)!.filter((cand) => {
      let hits = 0;
      for (const c of cand.cells) {
        if (sea[c] === SEA_MISS) return false;
        if (sea[c] === SEA_HIT) hits++;
      }
      if (hits !== damage[spec.id]) return false;
      for (const c of cand.zone) if (sea[c] === SEA_HIT && !cand.cells.includes(c)) return false;
      return true;
    }),
  );
}

/**
 * Fleets that fit, as an index into each ship's candidates, from a Gibbs sampler: start from
 * any fitting fleet, then again and again take one ship out and put it back at random among
 * the places the others leave it. That draws fleets in proportion to their weight (the edge
 * bonus), and several chains from different starts keep it from getting stuck in one corner.
 */
function sampleFleets(lists: Candidate[][], rng: Rng, opts: StrongOptions): Int32Array[] {
  const n = lists.length;
  const weight = lists.map((l) => Float64Array.from(l, (c) => (c.onEdge ? opts.edgeBonus : 1)));
  const blocked = new Int32Array(CELL_COUNT);
  const scratch = new Int32Array(Math.max(...lists.map((l) => l.length)));
  const fits = (c: Candidate) => {
    for (const cell of c.cells) if (blocked[cell]) return false;
    return true;
  };
  const mark = (c: Candidate, d: number) => {
    for (const cell of c.zone) blocked[cell]! += d;
  };
  const out: Int32Array[] = [];

  for (let chain = 0; chain < opts.chains; chain++) {
    blocked.fill(0);
    const fleet = startingFleet(lists, rng, fits, mark);
    if (!fleet) continue;
    for (let sweep = 0; sweep < opts.burnIn + opts.samples; sweep++) {
      for (let s = 0; s < n; s++) {
        const list = lists[s]!;
        if (list.length === 1) continue;
        mark(list[fleet[s]!]!, -1);
        let total = 0;
        let count = 0;
        for (let i = 0; i < list.length; i++) {
          if (!fits(list[i]!)) continue;
          scratch[count++] = i;
          total += weight[s]![i]!;
        }
        // the ship's own place always fits, so count > 0
        let r = rng.next() * total;
        let pick = scratch[count - 1]!;
        for (let k = 0; k < count; k++) {
          r -= weight[s]![scratch[k]!]!;
          if (r < 0) {
            pick = scratch[k]!;
            break;
          }
        }
        fleet[s] = pick;
        mark(list[pick]!, 1);
      }
      if (sweep >= opts.burnIn) out.push(Int32Array.from(fleet));
    }
  }
  return out;
}

/** A random fitting fleet by backtracking, the most constrained ships first; null if stuck. */
function startingFleet(
  lists: Candidate[][],
  rng: Rng,
  fits: (c: Candidate) => boolean,
  mark: (c: Candidate, d: number) => void,
): Int32Array | null {
  const order = lists.map((_, i) => i).sort((a, b) => lists[a]!.length - lists[b]!.length);
  const fleet = new Int32Array(lists.length);
  let budget = 50_000;
  const place = (k: number): boolean => {
    if (k === order.length) return true;
    const s = order[k]!;
    const list = lists[s]!;
    const start = rng.int(list.length);
    for (let j = 0; j < list.length; j++) {
      if (--budget < 0) return false;
      const i = (start + j) % list.length;
      if (!fits(list[i]!)) continue;
      mark(list[i]!, 1);
      fleet[s] = i;
      if (place(k + 1)) return true;
      mark(list[i]!, -1);
    }
    return false;
  };
  return place(0) ? fleet : null;
}

/**
 * A salvo, scored over the sampled fleets: every shot scores for each sampled ship it hits, 1
 * plus the finish bonus if the ship is known to be damaged, plus the find bonus if it's the
 * first hit on a ship not found yet. Shots are added one at a time, each the one that adds the
 * most. (Scoring sinkings too, and swapping shots to find salvos that only sink ships together,
 * didn't win more games.)
 */
function pickSalvo(
  request: ShotRequest,
  lists: Candidate[][],
  fleets: Int32Array[],
  rng: Rng,
  opts: StrongOptions,
): number[] {
  const { sea, count } = request;
  // one entry per (fleet, ship) still afloat in that fleet
  const worth: number[] = [];
  const found: number[] = [];
  const occurrences: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  for (const fleet of fleets) {
    lists.forEach((list, s) => {
      const cells = list[fleet[s]!]!.cells;
      let hits = 0;
      for (const c of cells) if (sea[c] === SEA_HIT) hits++;
      if (hits === cells.length) return;
      const p = worth.length;
      worth.push(1 + (request.damage[FLEET[s]!.id]! > 0 ? opts.finishBonus : 0));
      found.push(hits > 0 ? 1 : 0);
      for (const c of cells) if (sea[c] === SEA_UNKNOWN) occurrences[c]!.push(p);
    });
  }
  const gain = (c: number) => {
    let sum = 0;
    for (const p of occurrences[c]!) sum += worth[p]! + (found[p] ? 0 : opts.findBonus);
    return sum;
  };
  const chosen = new Uint8Array(CELL_COUNT);
  const shots: number[] = [];
  while (shots.length < count) {
    let best = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (sea[c] !== SEA_UNKNOWN || chosen[c]) continue;
      const v = gain(c) + rng.next() * 1e-3; // ties at random
      if (v > bestScore) {
        bestScore = v;
        best = c;
      }
    }
    if (best < 0) break;
    chosen[best] = 1;
    for (const p of occurrences[best]!) found[p] = 1;
    shots.push(best);
  }
  return shots;
}

/** The rollouts' own AI: the score picker on a few samples, so each turn is quick. */
const ROLLOUT: StrongOptions = {
  ...DEFAULT_STRONG,
  chains: 2,
  burnIn: 5,
  samples: 10,
  candidates: [8],
};

/**
 * Lookahead: candidate salvos from the score picker with different finish bonuses, each played
 * out to the end in a few of the sampled fleets (taken as the truth), the rest of the game by a
 * quick version of this AI that doesn't know the truth. Keeps the candidate after which the
 * enemy ships stay afloat fewest turns in all, i.e. which leaves the enemy least firepower.
 */
function pickSalvoLookahead(
  request: ShotRequest,
  lists: Candidate[][],
  fleets: Int32Array[],
  rng: Rng,
  opts: StrongOptions,
): number[] {
  const salvos: number[][] = [];
  for (const f of opts.candidates) {
    const salvo = pickSalvo(request, lists, fleets, rng, { ...opts, finishBonus: f });
    const key = [...salvo].sort((a, b) => a - b).join();
    if (!salvos.some((s) => [...s].sort((a, b) => a - b).join() === key)) salvos.push(salvo);
  }
  if (salvos.length === 1) return salvos[0]!;
  const worlds = Array.from({ length: opts.worlds }, () => ({
    fleet: fleets[rng.int(fleets.length)]!,
    seed: rng.int(2 ** 32),
  }));
  let best = salvos[0]!;
  let bestTurns = Infinity;
  for (const salvo of salvos) {
    let turns = 0;
    for (const w of worlds) turns += playOut(request, lists, w.fleet, salvo, createRng(w.seed));
    if (turns < bestTurns) {
      bestTurns = turns;
      best = salvo;
    }
  }
  return best;
}

/** Plays a salvo, then the rest of the game, against a known fleet: sum of the ships' turns afloat. */
function playOut(
  request: ShotRequest,
  lists: Candidate[][],
  fleet: Int32Array,
  first: number[],
  rng: Rng,
): number {
  const owner = new Int8Array(CELL_COUNT).fill(-1);
  fleet.forEach((idx, s) => {
    for (const c of lists[s]![idx]!.cells) owner[c] = s;
  });
  const sea = [...request.sea];
  const damage = [...request.damage];
  const sizes = lists.map((l) => l[0]!.cells.length);
  let afloat = sizes.filter((size, s) => damage[FLEET[s]!.id]! < size).length;
  let total = 0;
  let salvo = first;
  for (let turn = 1; afloat > 0 && turn < 30; turn++) {
    for (const c of salvo) {
      const s = owner[c]!;
      if (s >= 0) {
        sea[c] = SEA_HIT;
        damage[FLEET[s]!.id]!++;
      } else sea[c] = SEA_MISS;
    }
    afloat = sizes.filter((size, s) => damage[FLEET[s]!.id]! < size).length;
    total += afloat;
    if (afloat === 0) break;
    const open = sea.reduce((k, v) => k + (v === SEA_UNKNOWN ? 1 : 0), 0);
    salvo = chooseShotsStrong(
      { sea, damage, count: Math.min(request.count, open), fleet: [] },
      rng,
      ROLLOUT,
    );
  }
  return total;
}

export function chooseShotsStrong(
  request: ShotRequest,
  rng: Rng,
  opts: StrongOptions = DEFAULT_STRONG,
): number[] {
  const lists = shipCandidates(request);
  const fleets = lists.some((l) => l.length === 0) ? [] : sampleFleets(lists, rng, opts);
  // should not happen with consistent information, but never leave the turn unplayed
  if (fleets.length === 0) return chooseShotsByDensity(request, rng);
  return pickSalvoLookahead(request, lists, fleets, rng, opts);
}

/** For tests: fleets sampled for a situation, as each ship's cells. */
export function sampleFleetCells(
  request: ShotRequest,
  rng: Rng,
  opts: StrongOptions,
): number[][][] {
  const lists = shipCandidates(request);
  return sampleFleets(lists, rng, opts).map((f) =>
    Array.from(f, (idx, s) => [...lists[s]![idx]!.cells]),
  );
}

export const strongAi: AiPlayer = {
  placeFleet: (rng) => randomLayout(rng),
  chooseShots: (request, rng) => chooseShotsStrong(request, rng),
};

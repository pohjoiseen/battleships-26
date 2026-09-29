import {
  applyAction,
  CELL_COUNT,
  createGame,
  createRng,
  FLEET,
  type GameState,
  neighbours8,
  occupancy,
  other,
  randomLayout,
  type Rng,
  SEA_HIT,
  SEA_MISS,
  shotsAllowed,
} from '@bs/shared';
import { describe, expect, it } from 'vitest';
import {
  chooseShotsStrong,
  DEFAULT_STRONG,
  sampleFleetCells,
  type StrongOptions,
} from './strong.ts';
import type { AiPlayer } from './types.ts';

/** Small settings, without lookahead: tests check behaviour, not strength. */
const QUICK: StrongOptions = {
  ...DEFAULT_STRONG,
  chains: 2,
  burnIn: 3,
  samples: 10,
  candidates: [8],
};
const quickAi: AiPlayer = {
  placeFleet: randomLayout,
  chooseShots: (request, rng) => chooseShotsStrong(request, rng, QUICK),
};
const randomShooter: AiPlayer = {
  placeFleet: randomLayout,
  chooseShots: ({ sea, count }, rng) =>
    rng.shuffle(sea.flatMap((s, i) => (s === 0 ? [i] : []))).slice(0, count),
};

function play(ais: [AiPlayer, AiPlayer], rng: Rng, salvo = true) {
  const g: GameState = createGame({ salvo }, rng);
  applyAction(g, { type: 'ready', player: 0, layout: ais[0].placeFleet(rng) }, rng);
  applyAction(g, { type: 'ready', player: 1, layout: ais[1].placeFleet(rng) }, rng);
  while (g.phase !== 'over') {
    const p = g.turn;
    const count = shotsAllowed(g, p);
    const enemy = g.players[other(p)];
    // the AI gets no fleet: it must not need one
    const request = { sea: [...enemy.sea], damage: [...enemy.damage], count, fleet: [] };
    const shots = ais[p].chooseShots(request, rng);
    expect(new Set(shots).size).toBe(count);
    for (const cell of shots) {
      expect(enemy.sea[cell]).toBe(0);
      expect(applyAction(g, { type: 'toggleShot', player: p, cell }, rng).ok).toBe(true);
    }
    expect(applyAction(g, { type: 'fire', player: p }, rng).ok).toBe(true);
    applyAction(g, { type: 'advance' }, rng);
  }
  return g.winner!;
}

describe('strong AI', () => {
  it('samples only fleets that fit what it has seen', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rng = createRng(seed);
      const owner = occupancy(randomLayout(rng));
      const sea = new Array<number>(CELL_COUNT).fill(0);
      const damage = FLEET.map(() => 0);
      for (const c of rng.shuffle([...Array(CELL_COUNT).keys()]).slice(0, 60 + seed * 20)) {
        sea[c] = owner[c]! >= 0 ? SEA_HIT : SEA_MISS;
        if (owner[c]! >= 0) damage[owner[c]!]!++;
      }
      const fleets = sampleFleetCells({ sea, damage, count: 24, fleet: [] }, rng, QUICK);
      expect(fleets.length).toBeGreaterThan(0);
      for (const fleet of fleets) {
        const at = new Array<number>(CELL_COUNT).fill(-1);
        fleet.forEach((cells, s) => {
          expect(cells.filter((c) => sea[c] === SEA_HIT)).toHaveLength(damage[s]!);
          for (const c of cells) {
            expect(sea[c]).not.toBe(SEA_MISS);
            expect(at[c]).toBe(-1);
            at[c] = s;
          }
        });
        for (let c = 0; c < CELL_COUNT; c++) {
          if (sea[c] === SEA_HIT) expect(at[c]).toBeGreaterThanOrEqual(0);
          if (at[c]! < 0) continue;
          for (const n of neighbours8(c)) expect([-1, at[c]]).toContain(at[n]);
        }
      }
    }
  });

  it('plays legal salvos to the end, with and without salvo fire', () => {
    for (let seed = 1; seed <= 3; seed++) play([quickAi, randomShooter], createRng(seed));
    play([randomShooter, quickAi], createRng(9), false);
  });

  it('looks ahead to a legal salvo', () => {
    const rng = createRng(4);
    const owner = occupancy(randomLayout(rng));
    const sea = new Array<number>(CELL_COUNT).fill(0);
    const damage = FLEET.map(() => 0);
    for (const c of rng.shuffle([...Array(CELL_COUNT).keys()]).slice(0, 150)) {
      sea[c] = owner[c]! >= 0 ? SEA_HIT : SEA_MISS;
      if (owner[c]! >= 0) damage[owner[c]!]!++;
    }
    const opts = { ...QUICK, candidates: [0, 8, 50], worlds: 2 };
    const shots = chooseShotsStrong({ sea, damage, count: 20, fleet: [] }, rng, opts);
    expect(new Set(shots).size).toBe(20);
    for (const c of shots) expect(sea[c]).toBe(0);
  });

  it('beats random shooting', () => {
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const first = seed % 2 === 0;
      const winner = play(
        first ? [quickAi, randomShooter] : [randomShooter, quickAi],
        createRng(seed),
      );
      if (winner === (first ? 0 : 1)) wins++;
    }
    expect(wins).toBe(6);
  });
});

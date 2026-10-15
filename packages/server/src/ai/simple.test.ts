import {
  applyAction,
  createGame,
  createRng,
  type GameState,
  other,
  randomLayout,
  type Rng,
  SEA_HIT,
  SEA_MISS,
  shotsAllowed,
} from '@bs/shared';
import { describe, expect, it } from 'vitest';
import type { AiPlayer } from './types.ts';
import { simple2Ai, simpleAi } from './simple.ts';

const randomShooter: AiPlayer = {
  placeFleet: randomLayout,
  chooseShots: ({ sea, count }, rng) =>
    rng.shuffle(sea.flatMap((s, i) => (s === 0 ? [i] : []))).slice(0, count),
};

/** Plays a whole game between two AIs and returns the winner and number of turns. */
function play(a: AiPlayer, b: AiPlayer, rng: Rng, salvo = true) {
  const g: GameState = createGame({ salvo }, rng);
  const ais = [a, b] as const;
  applyAction(g, { type: 'ready', player: 0, layout: a.placeFleet(rng) }, rng);
  applyAction(g, { type: 'ready', player: 1, layout: b.placeFleet(rng) }, rng);
  while (g.phase !== 'over') {
    const p = g.turn;
    const count = shotsAllowed(g, p);
    const enemy = g.players[other(p)];
    const shots = ais[p].chooseShots(
      { sea: [...enemy.sea], damage: [...enemy.damage], count, fleet: enemy.layout! },
      rng,
    );
    expect(new Set(shots).size).toBe(count);
    for (const cell of shots) {
      expect(enemy.sea[cell]).toBe(0);
      expect(applyAction(g, { type: 'toggleShot', player: p, cell }, rng).ok).toBe(true);
    }
    expect(applyAction(g, { type: 'fire', player: p }, rng).ok).toBe(true);
    applyAction(g, { type: 'advance' }, rng);
  }
  return { winner: g.winner!, turns: g.turnNumber };
}

describe('simple AI', () => {
  it('always makes legal shots and finishes the game', () => {
    for (let seed = 1; seed <= 10; seed++) play(simpleAi, simpleAi, createRng(seed));
  });

  it('works with salvo fire off (4 shots per turn)', () => {
    const { turns } = play(simpleAi, simpleAi, createRng(7), false);
    expect(turns).toBeLessThan(200);
  });

  it('beats random shooting nearly every time', () => {
    let wins = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed++) {
      // alternate sides so the first-move advantage evens out
      const aiIsFirst = seed % 2 === 0;
      const { winner } = aiIsFirst
        ? play(simpleAi, randomShooter, createRng(seed))
        : play(randomShooter, simpleAi, createRng(seed));
      if (winner === (aiIsFirst ? 0 : 1)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(games - 2);
  });
});

/** Cells shot in each of `games` openings: `salvos` salvos of 24 that all miss. */
function openings(ai: AiPlayer, games: number, salvos: number): Set<number>[] {
  return Array.from({ length: games }, (_, g) => {
    const rng = createRng(g + 1);
    const sea = new Array<number>(400).fill(0);
    const shot = new Set<number>();
    for (let s = 0; s < salvos; s++) {
      for (const c of ai.chooseShots(
        { sea, damage: [0, 0, 0, 0, 0, 0], count: 24, fleet: [] },
        rng,
      )) {
        sea[c] = SEA_MISS;
        shot.add(c);
      }
    }
    return shot;
  });
}

describe('2027 AI', () => {
  it('always makes legal shots and finishes the game', () => {
    for (let seed = 1; seed <= 10; seed++) play(simple2Ai, simpleAi, createRng(seed));
    play(simple2Ai, simple2Ai, createRng(7), false);
  });

  it('opens differently every game, and leaves no corner alone', () => {
    const corner = (c: number) => (c % 20 < 3 || c % 20 > 16) && (c < 60 || c >= 340);
    const cornerCells = (ai: AiPlayer) =>
      new Set(openings(ai, 20, 2).flatMap((shot) => [...shot].filter(corner))).size;
    // the greedy one shoots the same few of the corners' 3x3 patches every game
    expect(cornerCells(simpleAi)).toBeLessThan(12);
    expect(cornerCells(simple2Ai)).toBeGreaterThan(24);
    const [a, b] = openings(simple2Ai, 2, 1);
    expect([...a!].filter((c) => b!.has(c)).length).toBeLessThan(12);
  });

  it('still finishes off a hit ship first', () => {
    // two hits side by side on the cruiser: it lies along this row
    const sea = new Array<number>(400).fill(0);
    sea[210] = SEA_HIT;
    sea[211] = SEA_HIT;
    for (let seed = 1; seed <= 5; seed++) {
      const shots = simple2Ai.chooseShots(
        { sea, damage: [0, 2, 0, 0, 0, 0], count: 4, fleet: [] },
        createRng(seed),
      );
      expect(shots.every((c) => Math.floor(c / 20) === 10)).toBe(true);
    }
  });

  it('beats random shooting nearly every time', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const first = seed % 2 === 0;
      const { winner } = first
        ? play(simple2Ai, randomShooter, createRng(seed))
        : play(randomShooter, simple2Ai, createRng(seed));
      if (winner === (first ? 0 : 1)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(28);
  });
});

import {
  applyAction,
  createGame,
  createRng,
  type GameState,
  other,
  randomLayout,
  type Rng,
  shotsAllowed,
} from '@bs/shared';
import { describe, expect, it } from 'vitest';
import type { AiPlayer } from './types.ts';
import { simpleAi } from './simple.ts';

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
      { sea: [...enemy.sea], damage: [...enemy.damage], count },
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

  it('works with salvo fire off (one shot per turn)', () => {
    const { turns } = play(simpleAi, simpleAi, createRng(7), false);
    expect(turns).toBeLessThan(400);
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

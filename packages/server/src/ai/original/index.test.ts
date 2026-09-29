import {
  applyAction,
  createGame,
  createRng,
  type GameState,
  isValidLayout,
  other,
  type Rng,
  shotsAllowed,
} from '@bs/shared';
import { describe, expect, it } from 'vitest';
import { simpleAi } from '../simple.ts';
import type { AiPlayer } from '../types.ts';
import { createOriginalAi } from './index.ts';

/** Plays a whole game between two AIs; returns the winner and the number of turns. */
function play(ais: [AiPlayer, AiPlayer], rng: Rng, salvo = true) {
  const g: GameState = createGame({ salvo }, rng);
  applyAction(g, { type: 'ready', player: 0, layout: ais[0].placeFleet(rng) }, rng);
  applyAction(g, { type: 'ready', player: 1, layout: ais[1].placeFleet(rng) }, rng);
  while (g.phase !== 'over') {
    const p = g.turn;
    const count = shotsAllowed(g, p);
    const enemy = g.players[other(p)];
    const request = { sea: [...enemy.sea], damage: [...enemy.damage], count, fleet: enemy.layout! };
    const shots = ais[p].chooseShots(request, rng);
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

describe('original AI in our game', () => {
  it('places valid fleets', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(isValidLayout(createOriginalAi().placeFleet(createRng(seed)))).toBe(true);
    }
  });

  it('plays legal salvos to the end, with and without salvo fire', () => {
    for (let seed = 1; seed <= 20; seed++) {
      play([createOriginalAi(), createOriginalAi()], createRng(seed));
    }
    const { turns } = play([createOriginalAi(), simpleAi], createRng(99), false);
    expect(turns).toBeLessThan(400);
  });

  it('sinks a fleet in a sensible number of salvos', () => {
    let turns = 0;
    const games = 10;
    for (let seed = 1; seed <= games; seed++) {
      turns += play([createOriginalAi(), createOriginalAi()], createRng(seed)).turns;
    }
    // each side needs about a dozen salvos of shrinking size
    expect(turns / games).toBeGreaterThan(10);
    expect(turns / games).toBeLessThan(60);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, createGame, other, SEA_UNKNOWN } from './game.ts';
import { type Layout, occupancy, randomLayout } from './placement.ts';
import { createRng } from './rng.ts';
import { cleanName, hiscoreBoard, playerScore, POINTS } from './scoring.ts';

/** A game the first player wins with their first salvo: every enemy ship cell, and one miss. */
function oneSalvoWin() {
  const rng = createRng(7);
  const g = createGame({ salvo: true }, rng);
  const layouts: Layout[] = [randomLayout(rng), randomLayout(rng)];
  for (const player of [0, 1] as const) {
    applyAction(g, { type: 'ready', player, layout: layouts[player]! }, rng);
  }
  const shooter = g.turn;
  const owner = occupancy(layouts[other(shooter)]!);
  const ships = owner.flatMap((ship, cell) => (ship >= 0 ? [cell] : []));
  const miss = owner.findIndex((ship) => ship < 0);
  for (const cell of [...ships, miss]) {
    expect(applyAction(g, { type: 'toggleShot', player: shooter, cell }, rng).ok).toBe(true);
  }
  applyAction(g, { type: 'fire', player: shooter }, rng);
  applyAction(g, { type: 'advance' }, rng);
  expect(g.phase).toBe('over');
  return { g, shooter };
}

describe('scoring', () => {
  it('scores a perfect win and a loss without a shot fired', () => {
    const { g, shooter } = oneSalvoWin();
    expect(playerScore(g, shooter)).toEqual({
      // 23 hits, 6 sunk, the win, 6 afloat, 23 of 24 shots on target
      score: 230 + 300 + 500 + 600 + Math.round((3000 * 23) / 24),
      won: true,
      shots: 24,
      hits: 23,
      sunk: 6,
      afloat: 6,
      salvos: 1,
    });
    expect(playerScore(g, other(shooter))).toMatchObject({ score: 0, salvos: 0, afloat: 0 });
    expect(g.players[shooter].sea.every((s) => s === SEA_UNKNOWN)).toBe(true);
  });

  it('ranks any win above any loss', () => {
    const P = POINTS;
    // the least a winner can get: one own ship afloat, at the worst accuracy there can be
    const worstWin =
      23 * P.hit + 6 * P.sink + P.win + P.afloat + Math.round((P.accuracy * 23) / 400);
    // the most a loser can get: every enemy ship but the last cell of one
    const bestLoss = 22 * P.hit + 5 * P.sink;
    expect(worstWin).toBeGreaterThan(bestLoss);
  });

  it('cleans up names', () => {
    expect(cleanName('  captain  nemo ')).toBe('CAPTAIN NEMO');
    expect(cleanName("o'hara-2!")).toBe("O'HARA-2!");
    expect(cleanName('')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('THIRTEEN CHAR')).toBeNull();
    expect(cleanName('ÄÖ')).toBeNull();
    expect(cleanName('<b>')).toBeNull();
  });

  it('keeps salvo fire on and off apart', () => {
    expect(hiscoreBoard('strong', true)).toBe('strong');
    expect(hiscoreBoard('human', false)).toBe('human-single');
  });
});

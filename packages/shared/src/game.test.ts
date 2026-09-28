import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  type GameState,
  other,
  type PlayerIndex,
  SEA_HIT,
  SEA_MISS,
  shotsAllowed,
} from './game.ts';
import { CELL_COUNT } from './geometry.ts';
import { type Layout, occupancy } from './placement.ts';
import { createRng } from './rng.ts';
import { placementIndices } from './ships.ts';
import { playerView } from './views.ts';

const layoutA: Layout = [
  { shipId: 0, orientation: 0, x: 0, y: 0 },
  { shipId: 1, orientation: 0, x: 10, y: 0 },
  { shipId: 2, orientation: 0, x: 0, y: 10 },
  { shipId: 3, orientation: 0, x: 10, y: 10 },
  { shipId: 4, orientation: 1, x: 15, y: 15 },
  { shipId: 5, orientation: 2, x: 5, y: 15 },
];
const layoutB: Layout = layoutA.map((p) => ({ ...p, x: p.x + 1 }));

const rng = () => createRng(42);
const room = {
  opponent: { kind: 'human' as const, joined: true, connected: true },
  timeScale: 1,
  chartSeed: 0,
};

function started(salvo = true): GameState {
  const r = rng();
  const g = createGame({ salvo }, r);
  expect(applyAction(g, { type: 'ready', player: 0, layout: layoutA }, r)).toEqual({ ok: true });
  expect(applyAction(g, { type: 'ready', player: 1, layout: layoutB }, r)).toEqual({ ok: true });
  return g;
}

/** Places `cells` as the current shooter's shots and fires them. */
function fire(g: GameState, cells: number[]) {
  const r = rng();
  for (const cell of cells) {
    expect(applyAction(g, { type: 'toggleShot', player: g.turn, cell }, r)).toEqual({ ok: true });
  }
  expect(applyAction(g, { type: 'fire', player: g.turn }, r)).toEqual({ ok: true });
}

function unshotCells(g: GameState, target: PlayerIndex, avoid: Set<number>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELL_COUNT && out.length < n; i++) {
    if (g.players[target].sea[i] === 0 && !avoid.has(i)) out.push(i);
  }
  return out;
}

describe('game flow', () => {
  it('starts with random drafts and moves to aiming when both are ready', () => {
    const r = rng();
    const g = createGame({ salvo: true }, r);
    expect(g.phase).toBe('placing');
    expect(g.players[0].draft).toHaveLength(6);
    applyAction(g, { type: 'ready', player: 0, layout: layoutA }, r);
    expect(g.phase).toBe('placing');
    applyAction(g, { type: 'ready', player: 1, layout: layoutB }, r);
    expect(g.phase).toBe('aiming');
    expect(g.turn).toBe(g.firstPlayer);
    expect(g.turnNumber).toBe(1);
  });

  it('rejects an invalid layout on ready', () => {
    const r = rng();
    const g = createGame({ salvo: true }, r);
    const bad = layoutA.map((p) => (p.shipId === 3 ? { ...p, x: 11, y: 0 } : p));
    expect(applyAction(g, { type: 'ready', player: 0, layout: bad }, r).ok).toBe(false);
    expect(g.players[0].layout).toBeNull();
    // ...but a draft may break the rules while the player is still arranging ships
    expect(applyAction(g, { type: 'draft', player: 0, layout: bad }, r).ok).toBe(true);
  });

  it('grants 24 shots with salvo fire and 4 without', () => {
    expect(shotsAllowed(started(true), 0)).toBe(24);
    expect(shotsAllowed(started(false), 0)).toBe(4);
  });

  it('keeps 4 shots without salvo fire as ships are lost', () => {
    const on = started(true);
    const off = started(false);
    for (const g of [on, off]) g.players[0].damage[5] = 2; // torpedo boat sunk
    expect(shotsAllowed(on, 0)).toBe(20);
    expect(shotsAllowed(off, 0)).toBe(4);
  });

  it('lets shots be placed and removed, but not beyond the allowance or twice on a cell', () => {
    const g = started(false);
    const r = rng();
    const p = g.turn;
    expect(applyAction(g, { type: 'toggleShot', player: other(p), cell: 5 }, r).ok).toBe(false);
    for (const cell of [5, 6, 7, 8]) {
      expect(applyAction(g, { type: 'toggleShot', player: p, cell }, r).ok).toBe(true);
    }
    expect(applyAction(g, { type: 'toggleShot', player: p, cell: 9 }, r).ok).toBe(false);
    expect(applyAction(g, { type: 'toggleShot', player: p, cell: 5 }, r).ok).toBe(true);
    expect(g.pendingShots).toEqual([6, 7, 8]);
    expect(applyAction(g, { type: 'fire', player: p }, r).ok).toBe(false);
  });

  it('resolves a salvo, records hits and damage, then passes the turn', () => {
    const g = started(true);
    const shooter = g.turn;
    const defender = other(shooter);
    const layout = shooter === 0 ? layoutB : layoutA;
    const torpedo = placementIndices(layout[5]!);
    const occupied = new Set(occupancy(layout).flatMap((o, i) => (o >= 0 ? [i] : [])));
    fire(g, [...torpedo, ...unshotCells(g, defender, occupied, 22)]);

    expect(g.phase).toBe('resolving');
    const salvo = g.lastSalvo!;
    expect(salvo.shots.filter((s) => s.hit)).toHaveLength(2);
    expect(salvo.shipHits).toEqual([5, 5]);
    expect(salvo.sunk).toEqual([5]);
    expect(g.players[defender].damage[5]).toBe(2);
    expect(g.players[defender].sea.filter((s) => s === SEA_HIT)).toHaveLength(2);
    expect(g.players[defender].sea.filter((s) => s === SEA_MISS)).toHaveLength(22);

    applyAction(g, { type: 'advance' }, rng());
    expect(g.phase).toBe('aiming');
    expect(g.turn).toBe(defender);
    // 4 shots per surviving ship: the defender lost its torpedo boat
    expect(shotsAllowed(g, defender)).toBe(20);
    expect(shotsAllowed(g, shooter)).toBe(24);
  });

  it('ends the game when a fleet is sunk and reveals both layouts', () => {
    const g = started(true);
    const r = rng();
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 100) {
      const shooter = g.turn;
      const cells = unshotCells(g, other(shooter), new Set(), shotsAllowed(g, shooter));
      fire(g, cells);
      applyAction(g, { type: 'advance' }, r);
    }
    expect(g.phase).toBe('over');
    expect(g.winner).not.toBeNull();
    const view = playerView(g, 0, room);
    expect(view.revealed).toEqual([layoutA, layoutB]);
  });

  it('caps the allowance at the number of cells left', () => {
    const g = started(true);
    const defender = other(g.turn);
    g.players[defender].sea = g.players[defender].sea.map((_, i) =>
      i < CELL_COUNT - 5 ? SEA_MISS : 0,
    );
    expect(shotsAllowed(g, g.turn)).toBe(5);
  });
});

describe('views', () => {
  it("never include the opponent's layout before the game is over", () => {
    const g = started(true);
    for (const you of [0, 1] as const) {
      const json = JSON.stringify(playerView(g, you, room));
      const theirs = you === 0 ? layoutB : layoutA;
      expect(playerView(g, you, room).yourLayout).toEqual(you === 0 ? layoutA : layoutB);
      expect(json).not.toContain(JSON.stringify(theirs));
      expect(playerView(g, you, room).revealed).toBeNull();
    }
  });

  it('only shows the invite link to player 1 until player 2 joins', () => {
    const g = started(true);
    const waiting = {
      ...room,
      opponent: { ...room.opponent, joined: false },
      inviteUrl: '/join/x',
    };
    expect(playerView(g, 0, waiting).inviteUrl).toBe('/join/x');
    expect(playerView(g, 1, waiting).inviteUrl).toBeUndefined();
    expect(playerView(g, 0, { ...waiting, opponent: room.opponent }).inviteUrl).toBeUndefined();
  });
});

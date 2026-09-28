import { describe, expect, it } from 'vitest';
import { conflictingShips, isValidLayout, type Layout, randomLayout } from './placement.ts';
import { createRng } from './rng.ts';

// A known-good layout, spread out over the board.
const good: Layout = [
  { shipId: 0, orientation: 0, x: 0, y: 0 }, // carrier
  { shipId: 1, orientation: 0, x: 10, y: 0 }, // cruiser
  { shipId: 2, orientation: 0, x: 0, y: 10 }, // submarine
  { shipId: 3, orientation: 0, x: 10, y: 10 }, // destroyer
  { shipId: 4, orientation: 1, x: 15, y: 15 }, // destroyer, diagonal
  { shipId: 5, orientation: 2, x: 5, y: 15 }, // torpedo boat, vertical
];

const withShip = (layout: Layout, i: number, change: Partial<Layout[number]>): Layout =>
  layout.map((p) => (p.shipId === i ? { ...p, ...change } : p));

describe('placement rules', () => {
  it('accepts a spread-out layout', () => {
    expect(conflictingShips(good).size).toBe(0);
    expect(isValidLayout(good)).toBe(true);
  });

  it('rejects ships off the board', () => {
    expect(conflictingShips(withShip(good, 1, { x: 17 }))).toEqual(new Set([1]));
  });

  it('rejects overlapping ships', () => {
    expect(conflictingShips(withShip(good, 3, { x: 11, y: 0 }))).toEqual(new Set([1, 3]));
  });

  it('rejects ships touching side by side', () => {
    expect(conflictingShips(withShip(good, 3, { x: 10, y: 1 }))).toEqual(new Set([1, 3]));
  });

  it('rejects ships touching only by a corner', () => {
    // cruiser occupies (10..14, 0); a destroyer starting at (15, 1) touches its corner
    expect(conflictingShips(withShip(good, 3, { x: 15, y: 1 }))).toEqual(new Set([1, 3]));
  });

  it('rejects a diagonal ship brushing another ship with its corner', () => {
    // diagonal destroyer at (15,15),(16,16),(17,17); a vertical torpedo boat at (16,14)-(16,15)
    // fits in the gap under the diagonal but touches (15,15) and (16,16)
    const layout = withShip(good, 5, { x: 16, y: 14, orientation: 2 });
    expect(conflictingShips(layout)).toEqual(new Set([4, 5]));
  });

  it('allows ships one empty cell apart, even diagonally', () => {
    expect(conflictingShips(withShip(good, 5, { x: 17, y: 14, orientation: 0 })).size).toBe(0);
  });

  it('rejects a layout with a missing ship', () => {
    expect(isValidLayout(good.slice(0, 5))).toBe(false);
  });

  it('rejects an invalid orientation', () => {
    expect(isValidLayout(withShip(good, 0, { orientation: 2 }))).toBe(false);
  });
});

describe('randomLayout', () => {
  it('always produces a valid layout', () => {
    for (let seed = 1; seed <= 300; seed++) {
      expect(isValidLayout(randomLayout(createRng(seed)))).toBe(true);
    }
  });

  it('uses diagonals sometimes', () => {
    const orientations = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      orientations.add(randomLayout(createRng(seed))[1]!.orientation);
    }
    expect(orientations).toEqual(new Set([0, 1, 2, 3]));
  });
});

import { describe, expect, it } from 'vitest';
import { cellIndex } from './geometry.ts';
import { ORIENTATIONS, placementCells, rotatePlacement, placementInBounds } from './ships.ts';

describe('orientations', () => {
  it('has 2 for the carrier, 4 for the submarine and 4 for straight ships', () => {
    expect(ORIENTATIONS.carrier).toHaveLength(2);
    expect(ORIENTATIONS.submarine).toHaveLength(4);
    expect(ORIENTATIONS.cruiser).toHaveLength(4);
    expect(ORIENTATIONS.destroyer).toHaveLength(4);
    expect(ORIENTATIONS.torpedo).toHaveLength(4);
  });

  it('keeps the carrier Z-shaped (never mirrored into an S)', () => {
    const cells = new Set(ORIENTATIONS.carrier[0]!.map(cellIndex));
    // XXX. on top (y=1), .XXX below (y=0)
    const z = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    expect(cells).toEqual(new Set(z.map(cellIndex)));
    const s = z.map((c) => ({ x: 3 - c.x, y: c.y }));
    for (const shape of ORIENTATIONS.carrier) {
      expect(new Set(shape.map(cellIndex))).not.toEqual(new Set(s.map(cellIndex)));
    }
  });

  it('includes both diagonals for straight ships', () => {
    const shapes = ORIENTATIONS.destroyer.map((s) => s.map((c) => `${c.x},${c.y}`).join(' '));
    expect(shapes).toContain('0,0 1,1 2,2');
    expect(shapes).toContain('2,0 1,1 0,2');
  });

  it('keeps every shape normalised to the origin', () => {
    for (const shapes of Object.values(ORIENTATIONS)) {
      for (const shape of shapes) {
        expect(Math.min(...shape.map((c) => c.x))).toBe(0);
        expect(Math.min(...shape.map((c) => c.y))).toBe(0);
      }
    }
  });
});

describe('rotatePlacement', () => {
  it('cycles through all orientations and back', () => {
    let p = { shipId: 1, orientation: 0, x: 8, y: 8 };
    const seen = new Set<number>();
    for (let i = 0; i < 4; i++) {
      seen.add(p.orientation);
      p = rotatePlacement(p);
    }
    expect(seen.size).toBe(4);
    expect(p.orientation).toBe(0);
  });

  it('stays on the board near an edge', () => {
    let p = { shipId: 1, orientation: 0, x: 15, y: 19 };
    for (let i = 0; i < 8; i++) {
      p = rotatePlacement(p);
      expect(placementInBounds(p)).toBe(true);
    }
  });

  it('keeps the ship roughly in place', () => {
    const p = { shipId: 1, orientation: 0, x: 8, y: 10 };
    const r = rotatePlacement(p);
    const centre = (cells: { x: number; y: number }[]) =>
      cells.reduce((s, c) => s + c.x + c.y, 0) / cells.length;
    expect(Math.abs(centre(placementCells(r)) - centre(placementCells(p)))).toBeLessThanOrEqual(1);
  });
});

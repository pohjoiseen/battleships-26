import { BOARD_SIZE, type Cell, cellIndex, inBounds } from './geometry.ts';

export type ShipClass = 'carrier' | 'cruiser' | 'submarine' | 'destroyer' | 'torpedo';

export interface ShipSpec {
  id: number;
  cls: ShipClass;
}

/** The fleet, in the order the original shows it in the side panel. */
export const FLEET: readonly ShipSpec[] = [
  { id: 0, cls: 'carrier' },
  { id: 1, cls: 'cruiser' },
  { id: 2, cls: 'submarine' },
  { id: 3, cls: 'destroyer' },
  { id: 4, cls: 'destroyer' },
  { id: 5, cls: 'torpedo' },
];

export const SHIP_NAMES: Record<ShipClass, string> = {
  carrier: 'AIRCRAFT CARRIER',
  cruiser: 'CRUISER',
  submarine: 'SUBMARINE',
  destroyer: 'DESTROYER',
  torpedo: 'TORPEDO BOAT',
};

/** Shots per turn granted by each surviving ship (salvo mode). */
export const SHOTS_PER_SHIP = 4;

type Shape = readonly Cell[];

/** Rows are written top-down, as they look on screen; y is flipped so that y grows upwards. */
function shapeFromRows(rows: string[]): Shape {
  const cells: Cell[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, x) => {
      if (ch === 'X') cells.push({ x, y: rows.length - 1 - r });
    });
  });
  return normalise(cells);
}

function straight(length: number, dx: number, dy: number): Shape {
  return normalise(Array.from({ length }, (_, i) => ({ x: i * dx, y: i * dy })));
}

function normalise(cells: readonly Cell[]): Shape {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells
    .map((c) => ({ x: c.x - minX, y: c.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function shapeKey(shape: Shape): string {
  return shape.map((c) => `${c.x},${c.y}`).join(' ');
}

/** All distinct 90° rotations of a shape (no mirroring), in rotation order. */
function rotations(base: Shape): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  let cur = base;
  for (let i = 0; i < 4; i++) {
    const key = shapeKey(cur);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cur);
    }
    cur = normalise(cur.map((c) => ({ x: -c.y, y: c.x })));
  }
  return out;
}

/** Straight ships may lie horizontally, vertically or on either 45° diagonal, in 45° steps. */
function straightOrientations(length: number): Shape[] {
  return [
    straight(length, 1, 0),
    straight(length, 1, 1),
    straight(length, 0, 1),
    straight(length, -1, 1),
  ];
}

export const ORIENTATIONS: Record<ShipClass, readonly Shape[]> = {
  // .XXX.. / ..XXX. in the spec; a half turn maps it onto itself, so only 2 orientations exist.
  carrier: rotations(shapeFromRows(['XXX.', '.XXX'])),
  cruiser: straightOrientations(5),
  submarine: rotations(shapeFromRows(['.X.', 'XXX'])),
  destroyer: straightOrientations(3),
  torpedo: straightOrientations(2),
};

export const SHIP_SIZES: Record<ShipClass, number> = {
  carrier: 6,
  cruiser: 5,
  submarine: 4,
  destroyer: 3,
  torpedo: 2,
};

export function shipSize(shipId: number): number {
  return SHIP_SIZES[fleetShip(shipId).cls];
}

export function fleetShip(shipId: number): ShipSpec {
  const spec = FLEET[shipId];
  if (!spec) throw new Error(`no ship ${shipId}`);
  return spec;
}

/** A ship on the board: the orientation's normalised shape translated by (x, y). */
export interface Placement {
  shipId: number;
  orientation: number;
  x: number;
  y: number;
}

export function placementCells(p: Placement): Cell[] {
  const shape = ORIENTATIONS[fleetShip(p.shipId).cls][p.orientation];
  if (!shape) throw new Error(`bad orientation ${p.orientation} for ship ${p.shipId}`);
  return shape.map((c) => ({ x: c.x + p.x, y: c.y + p.y }));
}

export function placementIndices(p: Placement): number[] {
  return placementCells(p).map(cellIndex);
}

export function placementInBounds(p: Placement): boolean {
  return placementCells(p).every(inBounds);
}

/** Moves a placement so it lies fully on the board, keeping it as close as possible. */
export function clampPlacement(p: Placement): Placement {
  const cells = placementCells(p);
  const maxX = Math.max(...cells.map((c) => c.x)) - p.x;
  const maxY = Math.max(...cells.map((c) => c.y)) - p.y;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), BOARD_SIZE - 1 - max);
  return { ...p, x: clamp(p.x, maxX), y: clamp(p.y, maxY) };
}

/** Next orientation, keeping the ship centred roughly where it was. */
export function rotatePlacement(p: Placement, direction: 1 | -1 = 1): Placement {
  const count = ORIENTATIONS[fleetShip(p.shipId).cls].length;
  const orientation = (p.orientation + direction + count) % count;
  const centre = (cells: Cell[]) => ({
    x: cells.reduce((s, c) => s + c.x, 0) / cells.length,
    y: cells.reduce((s, c) => s + c.y, 0) / cells.length,
  });
  const before = centre(placementCells(p));
  const rotated = centre(placementCells({ ...p, orientation, x: 0, y: 0 }));
  return clampPlacement({
    ...p,
    orientation,
    x: Math.round(before.x - rotated.x),
    y: Math.round(before.y - rotated.y),
  });
}

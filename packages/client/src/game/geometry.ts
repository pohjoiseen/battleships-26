import { BOARD_SIZE, type Cell, cellIndex, FLEET, indexCell } from '@bs/shared';

/**
 * Where things sit on the 400x300 screen. The sea of player 1 has the ship panel on the right;
 * the sea of player 2 is mirrored, with the panel on the left, as in the original.
 */
export interface Geometry {
  mirrored: boolean;
  seaX: number;
  seaY: number;
  cell: number;
  panelX: number;
  panelW: number;
  slotH: number;
  /** Top of the button row under the panel. */
  buttonsY: number;
}

export const CELL = 12;
export const SEA_Y = 30;
const SEA_W = CELL * BOARD_SIZE;

export function geometry(mirrored: boolean): Geometry {
  return mirrored
    ? {
        mirrored,
        seaX: 144,
        seaY: SEA_Y,
        cell: CELL,
        panelX: 6,
        panelW: 128,
        slotH: SEA_W / FLEET.length,
        buttonsY: 276,
      }
    : {
        mirrored,
        seaX: 16,
        seaY: SEA_Y,
        cell: CELL,
        panelX: 266,
        panelW: 128,
        slotH: SEA_W / FLEET.length,
        buttonsY: 276,
      };
}

/** Top-left of a cell on screen (row 0 is at the bottom). */
export function cellOrigin(g: Geometry, c: Cell): { x: number; y: number } {
  return { x: g.seaX + c.x * g.cell, y: g.seaY + (BOARD_SIZE - 1 - c.y) * g.cell };
}

export function cellCentre(g: Geometry, index: number): { x: number; y: number } {
  const o = cellOrigin(g, indexCell(index));
  return { x: o.x + g.cell / 2, y: o.y + g.cell / 2 };
}

export function cellAt(g: Geometry, x: number, y: number): Cell | null {
  const cx = Math.floor((x - g.seaX) / g.cell);
  const cy = BOARD_SIZE - 1 - Math.floor((y - g.seaY) / g.cell);
  if (cx < 0 || cy < 0 || cx >= BOARD_SIZE || cy >= BOARD_SIZE) return null;
  return { x: cx, y: cy };
}

export function cellIndexAt(g: Geometry, x: number, y: number): number | null {
  const c = cellAt(g, x, y);
  return c ? cellIndex(c) : null;
}

export function slotRect(g: Geometry, shipId: number) {
  return { x: g.panelX, y: g.seaY + shipId * g.slotH, w: g.panelW, h: g.slotH };
}

export function slotAt(g: Geometry, x: number, y: number): number | null {
  for (const s of FLEET) {
    const r = slotRect(g, s.id);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return s.id;
  }
  return null;
}

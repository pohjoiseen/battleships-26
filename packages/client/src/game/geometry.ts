import { BOARD_SIZE, type Cell, cellIndex, FLEET, indexCell } from '@bs/shared';
import { LH, LW } from '../gfx/screen.ts';
import { SLOT_W } from '../gfx/ships.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where things sit on a sea screen. In landscape (400x300) the sea of player 1 has the ship panel
 * on the right; the sea of player 2 is mirrored, with the panel on the left, as in the original.
 * In portrait the panel is a grid of ships under the sea, and mirroring only moves the row labels.
 */
export interface Geometry {
  mirrored: boolean;
  portrait: boolean;
  /** Logical size of the whole screen. */
  w: number;
  h: number;
  seaX: number;
  seaY: number;
  cell: number;
  panelX: number;
  panelY: number;
  /** Width and height of one ship's slot in the panel, and how many slots side by side. */
  panelW: number;
  slotH: number;
  panelCols: number;
  /** The button row. */
  buttons: Rect;
  titleY: number;
  hintY: number;
  /** Where the chart's coastline must not reach: the ship pictures, the buttons, the texts. */
  keepClear: Rect[];
  topLimit: number;
  bottomLimit: number;
}

export const CELL = 12;
export const SEA_Y = 30;
const SEA_W = CELL * BOARD_SIZE;

/** Logical size of the portrait sea screens. */
export const PW = 264;
export const PH = 482;

export function geometry(mirrored: boolean, portrait = false): Geometry {
  if (portrait) {
    const seaY = 48;
    const panel = { x: 4, y: 326, w: 128, h: 40, cols: 2 };
    const buttons = { x: 4, y: 452, w: PW - 8, h: 24 };
    return {
      mirrored,
      portrait,
      w: PW,
      h: PH,
      seaX: mirrored ? 6 : 18,
      seaY,
      cell: CELL,
      panelX: panel.x,
      panelY: panel.y,
      panelW: panel.w,
      slotH: panel.h,
      panelCols: panel.cols,
      buttons,
      titleY: 4,
      hintY: seaY + SEA_W + 26,
      keepClear: [],
      topLimit: 40,
      bottomLimit: 310,
    };
  }
  const panelX = mirrored ? 6 : 266;
  const buttons = { x: panelX, y: 276, w: 128, h: 16 };
  return {
    mirrored,
    portrait,
    w: LW,
    h: LH,
    seaX: mirrored ? 140 : 20,
    seaY: SEA_Y,
    cell: CELL,
    panelX,
    panelY: SEA_Y,
    panelW: 128,
    slotH: SEA_W / FLEET.length,
    panelCols: 1,
    buttons,
    titleY: 6,
    hintY: 291,
    keepClear: [
      { x: panelX + 8, y: 0, w: SLOT_W + 4, h: SEA_Y + SEA_W },
      { x: buttons.x - 1, y: buttons.y - 2, w: buttons.w + 2, h: 20 },
    ],
    topLimit: 21,
    bottomLimit: 289,
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

export function slotRect(g: Geometry, shipId: number): Rect {
  const col = shipId % g.panelCols;
  const row = Math.floor(shipId / g.panelCols);
  return { x: g.panelX + col * g.panelW, y: g.panelY + row * g.slotH, w: g.panelW, h: g.slotH };
}

export function slotAt(g: Geometry, x: number, y: number): number | null {
  for (const s of FLEET) {
    const r = slotRect(g, s.id);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return s.id;
  }
  return null;
}

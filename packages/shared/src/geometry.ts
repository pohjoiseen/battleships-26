export const BOARD_SIZE = 20;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** x grows to the right, y grows upwards (row 0 is at the bottom, as in the original). */
export interface Cell {
  x: number;
  y: number;
}

/** Cells are often handled as a single index 0..399, which is cheap to compare and store. */
export function cellIndex(c: Cell): number {
  return c.y * BOARD_SIZE + c.x;
}

export function indexCell(i: number): Cell {
  return { x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) };
}

export function inBounds(c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < BOARD_SIZE && c.y < BOARD_SIZE;
}

export function isCellIndex(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < CELL_COUNT;
}

/** Indices of the in-bounds 8-neighbours of a cell. */
export function neighbours8(i: number): number[] {
  const { x, y } = indexCell(i);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = { x: x + dx, y: y + dy };
      if (inBounds(n)) out.push(cellIndex(n));
    }
  }
  return out;
}

import {
  BOARD_SIZE,
  CELL_COUNT,
  FLEET,
  type Layout,
  ORIENTATIONS,
  type Placement,
  placementIndices,
  type Rng,
  SEA_HIT,
  SEA_MISS,
  shipSize,
} from '@bs/shared';
import type { AiPlayer, ShotRequest } from '../types.ts';
import {
  type AiState,
  BOARD,
  HIT,
  initialState,
  MISS,
  pickTarget,
  placeFleet,
  type Pos,
  startTurn,
} from './machine.ts';

/**
 * The original's computer player (see machine.ts), one per game, since it remembers where it
 * was hunting from one turn to the next.
 *
 * Our cells are row 0 at the bottom, the original's row 0 at the top; ship numbers are our ids
 * plus one. The AI sees the enemy's real fleet, as the original's did: it peeks at it.
 */
export function createOriginalAi(saved?: AiState): AiPlayer {
  let st: AiState | null = saved ? structuredClone(saved) : null;
  const state = (rng: Rng) => (st ??= initialState(rng.int(2 ** 32)));

  return {
    placeFleet: (rng) => layoutFromBoard(placeFleet(state(rng))),
    chooseShots: (request, rng) => chooseShots(state(rng), request, rng),
    save: () => structuredClone(st),
  };
}

/** Our cell index for the original's (column, row). */
const toCell = (p: Pos) => (BOARD_SIZE - 1 - p.e) * BOARD_SIZE + p.d;
const toPos = (cell: number): Pos => ({
  d: cell % BOARD_SIZE,
  e: BOARD_SIZE - 1 - Math.floor(cell / BOARD_SIZE),
});

/** Picks that fail or come to nothing before we give up on the original (it would hang). */
const PATIENCE = 20_000;

/**
 * A turn as the original plays it ($B232 on): the cursor starts in the top left corner; each
 * target picked, the cursor goes there and fires, which adds the cell to the plan (or takes it
 * off again if it was on it already, and does nothing on a cell shot before).
 */
function chooseShots(st: AiState, request: ShotRequest, rng: Rng): number[] {
  const board = boardFromView(request);
  const torpedo = FLEET.length - 1;
  const sit = {
    board,
    planned: [] as Pos[],
    cursor: { d: 0, e: 0 },
    enemyShips: FLEET.filter((s) => request.damage[s.id]! < shipSize(s.id)).length,
    enemyTorpedoCells: shipSize(torpedo) - request.damage[torpedo]!,
  };
  startTurn(st);
  for (let attempt = 0; sit.planned.length < request.count && attempt < PATIENCE; attempt++) {
    let t: Pos | null;
    try {
      t = pickTarget(st, sit);
    } catch {
      break; // the original's search ran past the board (see machine.ts); not seen in play
    }
    if (!t) continue;
    sit.cursor = t;
    if (board[t.e * BOARD + t.d]! & HIT) continue;
    const i = sit.planned.findIndex((p) => p.d === t.d && p.e === t.e);
    if (i >= 0) sit.planned.splice(i, 1);
    else sit.planned.push(t);
  }
  const shots = sit.planned.map(toCell);
  // only if the original got stuck: make up the salvo with random open cells
  if (shots.length < request.count) {
    const open = rng.shuffle(
      request.sea.flatMap((s, c) => (s === 0 && !shots.includes(c) ? [c] : [])),
    );
    shots.push(...open.slice(0, request.count - shots.length));
  }
  return shots;
}

/** The enemy sea in the original's bytes: ships by number, hits and misses. */
function boardFromView(request: ShotRequest): Uint8Array {
  const board = new Uint8Array(CELL_COUNT);
  for (const p of request.fleet) {
    for (const c of placementIndices(p)) {
      const { d, e } = toPos(c);
      board[e * BOARD + d] = p.shipId + 1;
    }
  }
  request.sea.forEach((s, c) => {
    const { d, e } = toPos(c);
    if (s === SEA_HIT) board[e * BOARD + d]! |= HIT;
    else if (s === SEA_MISS) board[e * BOARD + d] = MISS;
  });
  return board;
}

const shapeKey = (cells: number[]) => {
  const xy = cells.map((c) => [c % BOARD_SIZE, Math.floor(c / BOARD_SIZE)] as const);
  const minX = Math.min(...xy.map(([x]) => x));
  const minY = Math.min(...xy.map(([, y]) => y));
  return {
    key: xy
      .map(([x, y]) => `${x - minX},${y - minY}`)
      .sort()
      .join(' '),
    x: minX,
    y: minY,
  };
};

/** Our placements for a board the original's placement routine filled. */
function layoutFromBoard(board: Uint8Array): Layout {
  return FLEET.map((spec): Placement => {
    const cells: number[] = [];
    board.forEach((v, i) => {
      if (v === spec.id + 1) cells.push(toCell({ d: i % BOARD, e: Math.floor(i / BOARD) }));
    });
    const { key, x, y } = shapeKey(cells);
    const orientation = ORIENTATIONS[spec.cls].findIndex(
      (shape) => shapeKey(shape.map((c) => c.y * BOARD_SIZE + c.x)).key === key,
    );
    if (orientation < 0) throw new Error(`no orientation of ship ${spec.id} fits ${key}`);
    return { shipId: spec.id, orientation, x, y };
  });
}

/**
 * The computer player of the original Battle Ships (Hit-Pak / Elite, 1987, ZX Spectrum), ported
 * from the Z80 code instruction by instruction, quirks, cheats and bugs included. Addresses in
 * the comments are the original's; docs/original-ai.asm is the annotated disassembly.
 *
 * Everything here works in the original's terms, so that it can be checked against the real
 * code running in an emulator (see machine.test.ts):
 * - A cell is (d, e) = (column, row), row 0 at the top of the screen. Coordinates are bytes and
 *   wrap like the Z80's registers do: one step left of column 0 is column 255.
 * - The board is 20x20 bytes, row by row: 0 open sea, 1..6 a ship (by ship number, 1 = carrier
 *   .. 6 = torpedo boat), $80 + ship when hit, $FF a miss.
 * - Random numbers come from the original's 32-bit shift register.
 *
 * The original never picks a whole salvo at once. It steers the cursor like a player would: a
 * routine at $A6DF runs every few frames, picks a target when it has none ($A722, `pickTarget`
 * here), moves the cursor towards it and fires when it's there. `pickTarget` can fail, and the
 * game simply calls it again next time.
 */

export const BOARD = 20;
export const MISS = 0xff;
export const HIT = 0x80;

/** Cells per ship, by ship number ($9A2A). */
export const SHIP_SIZE = [0, 6, 5, 4, 3, 3, 2] as const;

/** The 8 directions (dx, dy), clockwise from up ($A874). Direction ^ 4 is the opposite one. */
export const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Hunting picks between two peeks at the enemy fleet, in one-player games ($FDFE). */
export const PEEK_INTERVAL = 29;

/** A cell as the D and E registers hold it: column and row, each a byte. */
export interface Pos {
  d: number;
  e: number;
}

/** What the game shows the AI (and some it shouldn't) when it picks a target. */
export interface Situation {
  /** The enemy sea, 400 bytes as described above; it includes the unhit ships. */
  board: Uint8Array;
  /** Shots placed so far this turn, in order ($FA65). */
  planned: Pos[];
  /** Where the cursor is: the last shot placed, or (0, 0) at the start of a turn ($A14A). */
  cursor: Pos;
  /** Enemy ships still afloat ($FDAD). */
  enemyShips: number;
  /** Unhit cells of the enemy torpedo boat ($FD68); only zero or not matters. */
  enemyTorpedoCells: number;
}

/** The AI's own variables, which carry over between picks, turns and even games. */
export interface AiState {
  /** Shift register at $FD07..$FD0A, $FD07 being the top byte. */
  rng: number;
  /** $FD35: hunting picks left until the next peek at the enemy fleet. */
  peekCountdown: number;
  /** $FDEA: shots left for the current block (or line). */
  blockShots: number;
  /** $FDEB: current block, 0..15, row by row; the sea is 4x4 blocks of 5x5 cells. */
  block: number;
  /** $FDEC, $FDED: position within the block, row and column. */
  blockRow: number;
  blockCol: number;
  /** $FDF3: 1 when hunting in lines rather than in blocks. */
  lineMode: number;
  /** $FDF4: direction of the line. */
  lineDir: number;
  /** $FDEE, $FDEF: the hit a damaged ship is being worked from. */
  anchor: Pos;
  /** $A810 (self-modified operand): board offset of the hit last used as an anchor. */
  hitOffset: number;
  /** $AA26 (self-modified operand): where the cruiser search resumes. */
  resume: Pos;
  /** IX+3 per ship ($FDD0 + 4 * (6 - ship)): the ship being worked on; cleared every turn. */
  shipMark: number[];
}

/** The variables as they are when the game has just loaded. */
export function initialState(rng: number): AiState {
  return {
    rng: rng >>> 0 || 1,
    peekCountdown: PEEK_INTERVAL,
    blockShots: 0,
    block: 0,
    blockRow: 0x80,
    blockCol: 0xc0,
    lineMode: 0xff,
    lineDir: 0,
    anchor: { d: 0, e: 0 },
    hitOffset: -0x6100, // the operand starts as 0, an address before the board
    resume: { d: 0, e: 0 },
    shipMark: [0, 0, 0, 0, 0, 0, 0],
  };
}

/** What $C2E2 resets at the start of every turn. */
export function startTurn(st: AiState): void {
  st.shipMark.fill(0);
}

/** $97FE: shifts in bit 30 xor bit 27, returns the top byte. */
export function rand(st: AiState): number {
  const r = st.rng;
  const bit = ((r >>> 30) ^ (r >>> 27)) & 1;
  st.rng = ((r << 1) | bit) >>> 0;
  return st.rng >>> 24;
}

/** Thrown when the original would search memory past the board; see `find`. */
class PastBoard extends Error {}

/** Per-block counts from $9A68, recomputed before every pick. */
interface BlockStats {
  /** $F900 + 2k: shots fired or planned in block k. */
  shots: number[];
  /** $FD29: the block with fewest shots (the last one, if several). */
  emptiest: number;
  /** $FD2B: blocks without a single shot. */
  untouched: number;
  /** $FDE8: roughly the average shots per block. */
  average: number;
}

/**
 * Ship shapes by ship number and orientation 0..7 ($A211): cells as (dx, dy) from the ship's
 * origin, which is the first cell. Straight ships have 4 distinct orientations, each twice
 * (mirrored, which for the destroyer's diagonal even swaps the cells); the carrier's 8 entries
 * are 2 shapes, each with two origins.
 */
const pairs = (list: string[]) => list.flatMap((o) => [o, o]);
const cycle = (list: string[]) => [...list, ...list];
const DESTROYER = [
  '-1,0 1,0',
  '-1,-1 1,1',
  '0,-1 0,1',
  '-1,1 1,-1',
  '-1,0 1,0',
  '-1,-1 1,1',
  '0,-1 0,1',
  '1,-1 -1,1',
];
const SHAPES: readonly (readonly (readonly [number, number])[])[][] = [
  [],
  pairs([
    '-1,0 1,0 -1,-1 -2,-1 0,-1',
    '0,-1 0,1 1,0 1,-1 1,-2',
    '-1,0 1,0 0,1 1,1 2,1',
    '-1,0 -1,1 -1,2 0,1 0,-1',
  ]),
  cycle(['-1,0 1,0 -2,0 2,0', '-1,-1 1,1 -2,-2 2,2', '0,-1 0,1 0,-2 0,2', '-1,1 1,-1 -2,2 2,-2']),
  pairs(['-1,0 1,0 0,-1', '0,1 1,0 0,-1', '-1,0 1,0 0,1', '-1,0 0,-1 0,1']),
  DESTROYER,
  DESTROYER,
  ['-1,0', '-1,-1', '0,-1', '1,-1', '1,0', '1,1', '0,1', '-1,1'],
].map((ship) =>
  ship.map((cells) => [
    [0, 0] as const,
    ...cells.split(' ').map((c) => {
      const [dx, dy] = c.split(',').map(Number);
      return [dx!, dy!] as const;
    }),
  ]),
);

/**
 * $A3FD: the computer's fleet, torpedo boat first. Each ship gets a random origin at least two
 * cells from the edge and a random orientation, again and again until it's on the board and
 * neither it nor any cell around it touches a ship already placed.
 */
export function placeFleet(st: AiState): Uint8Array {
  const board = new Uint8Array(BOARD * BOARD);
  for (let ship = 6; ship >= 1; ship--) {
    for (;;) {
      const e = (rand(st) & 0x0f) + 2;
      const d = (rand(st) & 0x0f) + 2;
      const cells = SHAPES[ship]![rand(st) & 7]!.map(([dx, dy]) => ({ d: d + dx, e: e + dy }));
      const fits = cells.every(
        (c) =>
          c.d >= 0 &&
          c.d < BOARD &&
          c.e >= 0 &&
          c.e < BOARD &&
          DIRS.concat([[0, 0]]).every(([dx, dy]) => {
            const n = { d: c.d + dx, e: c.e + dy };
            const off = n.d < 0 || n.d >= BOARD || n.e < 0 || n.e >= BOARD;
            return off || board[n.e * BOARD + n.d] === 0;
          }),
      );
      if (!fits) continue;
      for (const c of cells) board[c.e * BOARD + c.d] = ship;
      break;
    }
  }
  return board;
}

/** One call of $A722: picks the next target, or returns null to be called again. */
export function pickTarget(st: AiState, sit: Situation): Pos | null {
  return new Picker(st, sit).pick();
}

class Picker {
  /** $FDCB: the target; only line hunting's $AB6F sets it other than by returning it. */
  private target: Pos | null = null;
  private damage: number[] = [];
  private stats!: BlockStats;
  /** $A73E: the ship being considered. */
  private ship = 0;

  constructor(
    private readonly st: AiState,
    private readonly sit: Situation,
  ) {}

  pick(): Pos | null {
    this.damage = this.shipDamage();
    this.stats = this.blockStats();
    // $A728: ships in order 6 (torpedo boat) .. 1 (carrier); the first damaged one that gives a
    // target wins, the others fall through to the next ($A738)
    for (let ship = 6; ship >= 1; ship--) {
      if (this.damage[ship] === 0) continue;
      this.ship = ship;
      this.st.peekCountdown = PEEK_INTERVAL; // $A745
      const t = ship >= 4 || ship === 2 ? this.straightShip() : this.oddShip();
      if (t) return t;
    }
    return this.hunt();
  }

  // --- board access ---

  private cell(p: Pos): number {
    return this.sit.board[p.e * BOARD + p.d]!;
  }

  /** $A759: one step; returns null if it leaves the board. */
  private step(p: Pos, dir: number): Pos | null {
    const r = this.stepRaw(p, dir);
    return r.ok ? r.pos : null;
  }

  /**
   * $A759 as it is: the column is only updated if it stays on the board, but the row is updated
   * either way. Only one caller uses the position after a failed step.
   */
  private stepRaw(p: Pos, dir: number): { pos: Pos; ok: boolean } {
    const [dx, dy] = DIRS[dir]!;
    const d = (p.d + dx) & 0xff;
    if (d >= BOARD) return { pos: p, ok: false };
    const e = (p.e + dy) & 0xff;
    return { pos: { d, e }, ok: e < BOARD };
  }

  /** $9BAD: is the cell already a shot this turn? */
  private planned(p: Pos): boolean {
    return this.sit.planned.some((q) => q.d === p.d && q.e === p.e);
  }

  /**
   * $9BCB / $9BC7: the first cell from `from` on holding `value`. The original searches on past
   * the board into the rest of memory; any cell it finds there has a row of 20 or more (checked
   * for every start the game can give it), which makes the callers move on to the next ship.
   */
  private find(value: number, from: number): { pos: Pos; offset: number } | null {
    if (from < 0) throw new PastBoard(); // never happens, see oddShip
    for (let i = from; i < BOARD * BOARD; i++) {
      if (this.sit.board[i] === value)
        return { pos: { d: i % BOARD, e: Math.floor(i / BOARD) }, offset: i };
    }
    return null;
  }

  // --- $9A30, $9A68: what the AI looks at ---

  /** $9A30: hits per ship, 0 for a ship that is sunk (or untouched). */
  private shipDamage(): number[] {
    const out = [0];
    for (let ship = 1; ship <= 6; ship++) {
      let hits = 0;
      for (const v of this.sit.board) if (v === (HIT | ship)) hits++;
      out.push(hits === SHIP_SIZE[ship] ? 0 : hits);
    }
    return out;
  }

  /** $9A68: counts shots (fired and planned) per 5x5 block. */
  private blockStats(): BlockStats {
    const shots: number[] = [];
    let emptiest = 0;
    let fewest = 0xff;
    let untouched = 0;
    let total = 0;
    for (let k = 0; k < 16; k++) {
      const e0 = (k >> 2) * 5;
      const d0 = (k & 3) * 5;
      let n = 0;
      for (const p of this.sit.planned) {
        if (p.d - d0 >= 0 && p.d - d0 < 5 && p.e - e0 >= 0 && p.e - e0 < 5) n++;
      }
      for (let e = e0; e < e0 + 5; e++) {
        for (let d = d0; d < d0 + 5; d++) if (this.sit.board[e * BOARD + d]! & HIT) n++;
      }
      n &= 0xff;
      shots.push(n);
      total += n;
      if (n === 0) untouched++;
      if (fewest >= n) {
        fewest = n;
        emptiest = k;
      }
    }
    // $9B2C: half the total, top nibble, as an even number: about total / 16
    const average = (((total >> 1) & 0xf0) >> 3) & 0xff;
    return { shots, emptiest, untouched: untouched & 0xff, average };
  }

  /**
   * $9B55: could a ship lie across this cell? Yes if it isn't planned already and, in some
   * direction, the next cell isn't a miss (while the enemy torpedo boat is afloat) or the next
   * two aren't. It was meant to try the cell between two neighbours too, but loads the
   * address of the saved cell rather than the cell ($9B88: LD DE,$9B64 for LD DE,($9B64)), so
   * that test always runs off the board.
   */
  private roomForShip(p: Pos): boolean {
    if (this.planned(p)) return false;
    for (let b = 8; b >= 1; b--) {
      const dir = b & 7;
      const n1 = this.step(p, dir);
      if (!n1 || this.cell(n1) === MISS) continue;
      if (this.sit.enemyTorpedoCells !== 0) return true;
      const n2 = this.step(n1, dir);
      if (n2 && this.cell(n2) !== MISS) return true;
      // the bugged test: steps from column $9B, which is always off the board
    }
    return false;
  }

  /** $99FC: a good cell to hunt: a ship would fit, and it hasn't been shot. */
  private huntable(p: Pos): boolean {
    return this.roomForShip(p) && !(this.cell(p) & HIT);
  }

  // --- finishing off the carrier and the submarine ($A7FD) ---

  private oddShip(): Pos | null {
    const st = this.st;
    const ship = this.ship;
    if (this.damage[ship] === 5) {
      // $A7F2: the carrier's last cell; the original knows where it is
      const last = this.find(ship, 0)!;
      if (!this.planned(last.pos)) return last.pos;
      // $A80F with a mark that was cleared this turn: searches for $80, which is nowhere on the
      // board, and moves on to the next ship
      if (st.shipMark[ship] === 0) return null;
    } else {
      const first = this.find(HIT | ship, 0)!;
      st.shipMark[ship] = ship;
      const t = this.aroundHit(first);
      if (t !== 'next') return t;
    }
    // $A80F: the ship's next hit, in board order
    for (;;) {
      const next = this.find(HIT | st.shipMark[ship]!, st.hitOffset + 1);
      if (!next) return null;
      const t = this.aroundHit(next);
      if (t !== 'next') return t;
    }
  }

  /** $A81C: tries the 8 directions around a hit, starting from a random one. */
  private aroundHit(hit: { pos: Pos; offset: number }): Pos | 'next' {
    const st = this.st;
    st.hitOffset = hit.offset;
    st.anchor = hit.pos;
    const first = rand(st) & 7;
    let dir = first;
    do {
      const t = this.aroundHitDir(dir);
      if (t) return t;
      dir = (dir + 1) & 7;
    } while (dir !== first);
    return 'next';
  }

  /** $A835: the neighbour that way, or the one beyond if the neighbour is a hit. */
  private aroundHitDir(dir: number): Pos | null {
    const n1 = this.step(this.st.anchor, dir);
    if (!n1 || this.planned(n1)) return null;
    const v = this.cell(n1);
    if (v === MISS) return null;
    if (!(v & HIT)) return this.nextToHits(n1) ? n1 : null;
    const n2 = this.step(n1, dir);
    if (!n2 || this.planned(n2)) return null;
    const v2 = this.cell(n2);
    if (v2 === MISS || v2 & HIT) return null;
    return this.nextToHits(n2) ? n2 : null;
  }

  /** $A7BC: with one hit anything goes; after that, the cell must touch two hits (any ship's). */
  private nextToHits(p: Pos): boolean {
    if (this.damage[this.ship] === 1) return true;
    let count = 0;
    for (let dir = 0; dir < 8; dir++) {
      const n = this.step(p, dir);
      if (!n) continue;
      const v = this.cell(n);
      if (v !== MISS && v & HIT && ++count === 2) return true;
    }
    return false;
  }

  // --- finishing off the straight ships ($A884) ---

  private straightShip(): Pos | null {
    const st = this.st;
    const first = this.find(HIT | this.ship, 0)!;
    st.anchor = first.pos;
    if (this.damage[this.ship] !== 1) return this.alongLine(first);

    // one hit: the cell two away, if the one between isn't a miss ($A895)
    let skipped = 0;
    let dir = rand(st) & 7;
    const start = dir;
    do {
      if (this.ship === 6) return this.torpedoBoat();
      const n1 = this.step(st.anchor, dir);
      if (n1 && this.cell(n1) !== MISS && !this.planned(n1)) {
        const n2 = this.step(n1, dir);
        if (n2 && !(this.cell(n2) & HIT)) {
          if (!this.planned(n2)) return n2;
          skipped++;
        }
      }
      dir = (dir + 1) & 7;
    } while (dir !== start);
    if (skipped && this.sit.enemyShips !== 1) return null;

    // $A8ED: a neighbour, if the cell opposite isn't a miss
    dir = rand(st) & 7;
    const start2 = dir;
    do {
      const n1 = this.step(st.anchor, dir);
      if (n1 && !(this.cell(n1) & HIT) && !this.planned(n1)) {
        const opp = this.step(st.anchor, dir ^ 4);
        if (opp && this.cell(opp) !== MISS) {
          if (!this.planned(opp) || this.sit.enemyShips === 1) return n1;
        }
      }
      dir = (dir + 1) & 7;
    } while (dir !== start2);
    return null;
  }

  /** $A944: a neighbour, unless the cell opposite is planned already (with ships to spare). */
  private torpedoBoat(): Pos | null {
    const st = this.st;
    const start = rand(st) & 7;
    let dir = start;
    do {
      const n1 = this.step(st.anchor, dir);
      if (n1 && !(this.cell(n1) & HIT) && !this.planned(n1)) {
        if (this.sit.enemyShips === 1) return n1;
        // the step isn't checked: off the board, a half-moved cell is looked up in the plan
        if (!this.planned(this.stepRaw(st.anchor, dir ^ 4).pos)) return n1;
      }
      dir = (dir + 1) & 7;
    } while (dir !== start);
    return null;
  }

  /** $A98B: two or more hits: extend the line through the first two. */
  private alongLine(first: { pos: Pos; offset: number }): Pos | null {
    const st = this.st;
    const damage = this.damage[this.ship]!;
    let tries = 50; // IX+2
    // $A772: the second hit, and the direction from it to the first
    const second = this.find(HIT | this.ship, first.offset + 1)!.pos;
    let gap = false;
    const sign = (a: number, b: number) => {
      const diff = (a - b) & 0xff;
      if (diff === 0) return 0;
      const s = a >= b ? 1 : 0xff;
      if (diff !== s) gap = true;
      return s;
    };
    const sd = sign(first.pos.d, second.d);
    const se = sign(first.pos.e, second.e);
    const dir = DIRS.findIndex(([dx, dy]) => (dx & 0xff) === sd && (dy & 0xff) === se);
    let found = 0; // C: planned cells met
    let from = second;

    if (gap) {
      // $A995: fill the gap, walking from the second hit towards the first
      let saved: Pos;
      let p = from;
      for (;;) {
        saved = p;
        const n = this.step(p, dir);
        if (!n) return null;
        p = n;
        if (!(this.cell(p) & HIT)) break;
      }
      if (!this.planned(p)) return p;
      found = 0;
      for (;;) {
        found++;
        const n = this.step(p, dir);
        if (!n) return null;
        p = n;
        if (this.cell(p) & HIT) break;
        if (!this.planned(p)) return p;
      }
      // $A9C2: a gap already covered; only the cruiser looks further
      if (this.ship !== 2 || damage + found >= 5) return null;
      from = saved;
    }

    for (;;) {
      // $A9D4: past the second hit, away from the first
      let p: Pos | null = from;
      for (;;) {
        p = this.step(p, dir ^ 4);
        if (!p || this.cell(p) === MISS) break;
        if (this.cell(p) & HIT) continue;
        st.resume = p;
        if (!this.planned(p)) return p;
        found++;
        break;
      }
      // $A9F4: past the first hit
      p = st.anchor;
      for (;;) {
        p = this.step(p, dir);
        if (!p || this.cell(p) === MISS) break;
        if (this.cell(p) & HIT) continue;
        st.anchor = p;
        if (!this.planned(p)) return p;
        found++;
        break;
      }
      // $AA16: both ends planned already; the cruiser looks beyond them, 50 times at most
      if (this.ship !== 2 || damage + found >= 5) return null;
      from = st.resume;
      if (--tries === 0) return null;
    }
  }

  // --- hunting ($AA6D) ---

  private hunt(): Pos | null {
    const st = this.st;
    st.peekCountdown = (st.peekCountdown - 1) & 0xff;
    if (st.peekCountdown === 0) {
      const t = this.peek();
      if (t) return t;
    }
    // $AAFB
    if (st.blockShots === 0) this.newArea();
    st.blockShots = (st.blockShots - 1) & 0xff;
    if (st.lineMode === 1) return this.lineShot();

    // a short random walk within the block
    const e0 = ((st.block & 0x0c) >> 2) * 5;
    const d0 = (st.block & 3) * 5;
    const wrap = (v: number) => {
      v &= 0xff;
      if (v < 5) return v;
      v = (v - 5) & 0xff;
      return v & 0x80 ? (v + 10) & 0xff : v;
    };
    for (let tries = 120; tries > 0; tries--) {
      const r = rand(st);
      st.blockCol = wrap(st.blockCol + (r & 3) - 1);
      st.blockRow = wrap(st.blockRow + ((r >> 2) & 3) - 1);
      const p = { d: (st.blockCol + d0) & 0xff, e: (st.blockRow + e0) & 0xff };
      if (this.huntable(p)) return p;
    }
    // $AB61: nothing here; try another area next time
    st.blockShots = 0;
    st.rng = (st.rng + 0x01000000) >>> 0; // INC (IY+$07)
    return this.target;
  }

  /**
   * $AA79: the cheat. Every PEEK_INTERVAL hunting picks, scan from a random cell for an unhit
   * ship, and hunt in its block from then on.
   */
  private peek(): Pos | null {
    const st = this.st;
    st.peekCountdown = PEEK_INTERVAL;
    let e = rand(st) & 3;
    e = ((rand(st) & 0x0f) + e) & 0xff;
    // the column is meant to be random the same way, but the sum is never stored in D
    let d = rand(st) & 3;
    rand(st);
    const h = rand(st) & 1 ? 1 : 0xff;
    for (let n = 400; n > 0; n--) {
      d = (d + h) & 0xff;
      if (d >= BOARD) {
        if (h === 1) {
          d = 0;
          e = (e + 1) & 0xff;
          if (e >= BOARD) e = 0;
        } else {
          d = BOARD - 1;
          e = (e - 1) & 0xff;
          if (e === 0xff) e = BOARD - 1;
        }
      }
      const p = { d, e };
      const v = this.cell(p);
      if (v === 0 || v & HIT || this.planned(p)) continue;
      this.setArea(Math.floor(e / 5) * 4 + Math.floor(d / 5), 5);
      return p;
    }
    return null;
  }

  /** $AA2F: a line from the cursor, one to four cells at a time, in a fixed direction. */
  private lineShot(): Pos | null {
    const st = this.st;
    let p: Pos = { d: this.sit.cursor.d, e: (this.sit.cursor.e + (rand(st) & 3) - 1) & 0xff };
    p = { d: (p.d + (rand(st) & 3) - 1) & 0xff, e: p.e };
    let b = 4;
    for (;;) {
      const n = this.step(p, st.lineDir);
      if (!n) {
        // $AA67: off the board: start a new line (the start cell is the target, if line mode)
        this.newArea();
        return this.target;
      }
      p = n;
      if (!(rand(st) & 0x80)) {
        b = (b - 1) & 0xff;
        if (b !== 0) continue;
      }
      b = (b + 1) & 0xff;
      if (this.cell(p) & HIT) continue;
      if (!this.roomForShip(p)) continue;
      return p;
    }
  }

  /**
   * $AB6F: where to hunt next. While two or more blocks are untouched, a new line from a random
   * cell, which the original makes sure is open sea: its first shot always misses. Otherwise
   * the block with the fewest shots.
   */
  private newArea(): void {
    const st = this.st;
    if (this.stats.untouched >= 2) {
      st.lineMode = 1;
      st.blockShots = 12;
      for (;;) {
        const d = (rand(st) & 0x0f) + 2;
        const e = (rand(st) & 0x0f) + 2;
        this.target = { d, e };
        if (this.cell(this.target) !== 0) continue;
        if (this.roomForShip(this.target)) break;
      }
      st.lineDir = rand(st) & 7;
      return;
    }
    // $ABAB: looks for a block with no more than the average shots, but then takes the
    // emptiest one anyway (see setArea)
    let c = this.stats.emptiest;
    for (let tries = 100; ;) {
      const k = rand(st) & 0x0f;
      if (k === st.block) continue;
      if (this.stats.average >= this.stats.shots[k]!) {
        c = k;
        break;
      }
      if (--tries === 0) break;
    }
    this.setArea(c, this.stats.untouched);
  }

  /** $ABD0: hunt in a block from its centre. */
  private setArea(k: number, untouched: number): void {
    const st = this.st;
    st.blockRow = 2;
    st.blockCol = 2;
    st.block = untouched >= 4 ? k : this.stats.emptiest;
    st.lineMode = 0;
    st.blockShots = (rand(st) & 3) + 7;
  }
}

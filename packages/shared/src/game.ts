import { CELL_COUNT, isCellIndex } from './geometry.ts';
import {
  type Layout,
  conflictingShips,
  layoutStructureProblem,
  occupancy,
  randomLayout,
} from './placement.ts';
import type { Rng } from './rng.ts';
import { FLEET, SHOTS_PER_SHIP, shipSize } from './ships.ts';

export type PlayerIndex = 0 | 1;

export const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/** What is known about each cell of a sea. */
export const SEA_UNKNOWN = 0;
export const SEA_MISS = 1;
export const SEA_HIT = 2;

export interface GameSettings {
  /** Salvo fire: 4 shots per surviving ship. Off: a single shot per turn. */
  salvo: boolean;
}

export interface PlayerState {
  /** The layout being arranged during placement (always structurally sound, maybe breaking rules). */
  draft: Layout;
  /** Committed layout, set when the player presses END. */
  layout: Layout | null;
  /** Shots received on this player's sea: SEA_* per cell. */
  sea: number[];
  /** Hits taken per ship id. */
  damage: number[];
}

export interface SalvoShot {
  cell: number;
  hit: boolean;
}

export interface Salvo {
  shooter: PlayerIndex;
  turnNumber: number;
  /** In the order the shooter placed them. */
  shots: SalvoShot[];
  /**
   * Ship ids hit, one entry per hit, shuffled. The animation shows which ship each hit lands on,
   * but deliberately not which cell it came from.
   */
  shipHits: number[];
  /** Ship ids sunk by this salvo. */
  sunk: number[];
  /** Drives the (purely cosmetic) randomness of the salvo animation on both clients. */
  seed: number;
}

export type Phase = 'placing' | 'aiming' | 'resolving' | 'over';

export interface GameState {
  settings: GameSettings;
  phase: Phase;
  players: [PlayerState, PlayerState];
  firstPlayer: PlayerIndex;
  /** The shooter in 'aiming' and 'resolving'. */
  turn: PlayerIndex;
  turnNumber: number;
  /** The shooter's shots placed so far this turn. */
  pendingShots: number[];
  lastSalvo: Salvo | null;
  winner: PlayerIndex | null;
}

export type Action =
  | { type: 'draft'; player: PlayerIndex; layout: Layout }
  | { type: 'ready'; player: PlayerIndex; layout: Layout }
  | { type: 'toggleShot'; player: PlayerIndex; cell: number }
  | { type: 'fire'; player: PlayerIndex }
  /** Ends the 'resolving' phase once the salvo animation has had time to play. */
  | { type: 'advance' };

export type ActionResult = { ok: true } | { ok: false; error: string };

function newPlayer(rng: Rng): PlayerState {
  return {
    draft: randomLayout(rng),
    layout: null,
    sea: new Array<number>(CELL_COUNT).fill(SEA_UNKNOWN),
    damage: FLEET.map(() => 0),
  };
}

export function createGame(settings: GameSettings, rng: Rng): GameState {
  const firstPlayer: PlayerIndex = rng.int(2) === 0 ? 0 : 1;
  return {
    settings,
    phase: 'placing',
    players: [newPlayer(rng), newPlayer(rng)],
    firstPlayer,
    turn: firstPlayer,
    turnNumber: 0,
    pendingShots: [],
    lastSalvo: null,
    winner: null,
  };
}

export function isSunk(player: PlayerState, shipId: number): boolean {
  return player.damage[shipId]! >= shipSize(shipId);
}

export function survivingShips(player: PlayerState): number {
  return FLEET.filter((s) => !isSunk(player, s.id)).length;
}

/** How many shots `shooter` gets this turn (never more than there are cells left to shoot). */
export function shotsAllowed(state: GameState, shooter: PlayerIndex): number {
  const wanted = state.settings.salvo ? SHOTS_PER_SHIP * survivingShips(state.players[shooter]) : 1;
  const left = state.players[other(shooter)].sea.filter((s) => s === SEA_UNKNOWN).length;
  return Math.min(wanted, left);
}

const fail = (error: string): ActionResult => ({ ok: false, error });

/** Validates and applies an action. The state is only modified when the result is ok. */
export function applyAction(state: GameState, action: Action, rng: Rng): ActionResult {
  switch (action.type) {
    case 'draft': {
      if (state.phase !== 'placing') return fail('not placing');
      const me = state.players[action.player];
      if (me.layout) return fail('already ready');
      const problem = layoutStructureProblem(action.layout);
      if (problem) return fail(problem);
      me.draft = action.layout;
      return { ok: true };
    }
    case 'ready': {
      if (state.phase !== 'placing') return fail('not placing');
      const me = state.players[action.player];
      if (me.layout) return fail('already ready');
      const problem = layoutStructureProblem(action.layout);
      if (problem) return fail(problem);
      if (conflictingShips(action.layout).size > 0) return fail('ships break placement rules');
      me.draft = action.layout;
      me.layout = action.layout;
      if (state.players.every((p) => p.layout)) {
        state.phase = 'aiming';
        state.turn = state.firstPlayer;
        state.turnNumber = 1;
      }
      return { ok: true };
    }
    case 'toggleShot': {
      if (state.phase !== 'aiming') return fail('not aiming');
      if (action.player !== state.turn) return fail('not your turn');
      if (!isCellIndex(action.cell)) return fail('bad cell');
      const at = state.pendingShots.indexOf(action.cell);
      if (at >= 0) {
        state.pendingShots.splice(at, 1);
        return { ok: true };
      }
      if (state.players[other(action.player)].sea[action.cell] !== SEA_UNKNOWN) {
        return fail('already shot there');
      }
      if (state.pendingShots.length >= shotsAllowed(state, action.player)) {
        return fail('no shots left');
      }
      state.pendingShots.push(action.cell);
      return { ok: true };
    }
    case 'fire': {
      if (state.phase !== 'aiming') return fail('not aiming');
      if (action.player !== state.turn) return fail('not your turn');
      if (state.pendingShots.length !== shotsAllowed(state, action.player)) {
        return fail('place all your shots first');
      }
      const defender = state.players[other(action.player)];
      const owner = occupancy(defender.layout!);
      const wasSunk = FLEET.map((s) => isSunk(defender, s.id));
      const shots: SalvoShot[] = [];
      const shipHits: number[] = [];
      for (const cell of state.pendingShots) {
        const ship = owner[cell]!;
        const hit = ship >= 0;
        defender.sea[cell] = hit ? SEA_HIT : SEA_MISS;
        if (hit) {
          defender.damage[ship]!++;
          shipHits.push(ship);
        }
        shots.push({ cell, hit });
      }
      state.lastSalvo = {
        shooter: action.player,
        turnNumber: state.turnNumber,
        shots,
        shipHits: rng.shuffle(shipHits),
        sunk: FLEET.filter((s) => !wasSunk[s.id] && isSunk(defender, s.id)).map((s) => s.id),
        seed: rng.int(2 ** 31),
      };
      state.pendingShots = [];
      state.phase = 'resolving';
      if (survivingShips(defender) === 0) state.winner = action.player;
      return { ok: true };
    }
    case 'advance': {
      if (state.phase !== 'resolving') return fail('not resolving');
      if (state.winner !== null) {
        state.phase = 'over';
      } else {
        state.turn = other(state.turn);
        state.turnNumber++;
        state.phase = 'aiming';
      }
      return { ok: true };
    }
  }
}

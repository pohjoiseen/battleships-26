import {
  type GameSettings,
  type GameState,
  type Phase,
  type PlayerIndex,
  type Salvo,
  shotsAllowed,
} from './game.ts';
import type { Layout } from './placement.ts';
import type { Score } from './scoring.ts';
import { salvoDurationMs } from './timing.ts';

export interface SeaView {
  /** SEA_* per cell. */
  shots: number[];
  /** Hits per ship id. Public: the ship pictures show every ship's damage. */
  damage: number[];
}

export interface OpponentInfo {
  kind: 'human' | 'ai';
  /** For a human opponent: whether they have opened their link yet. */
  joined: boolean;
  connected: boolean;
}

export interface HiscoreEntry {
  name: string;
  score: number;
  /** When it was scored, ms since the epoch. */
  date: number;
  /** In a view: this is the viewer's score from this game. */
  you?: boolean;
}

/** The top of one hi-score table (see hiscoreBoard). */
export interface HiscoreTable {
  board: string;
  entries: HiscoreEntry[];
}

/** After a game: its table, and how the viewer did (null for a viewer who isn't in it). */
export interface GameHiscores extends HiscoreTable {
  yours: (Score & { name: string; rank: number }) | null;
}

/** Extra context the server adds to each view. */
export interface RoomInfo {
  opponent: OpponentInfo;
  /** Only sent to player 1 until player 2 has joined. */
  inviteUrl?: string;
  timeScale: number;
  /** Seeds the look of the charts (their ragged coastlines); the same for both players. */
  chartSeed: number;
  /** Once the game is over. */
  hiscores?: GameHiscores;
}

/** Everything one player is allowed to know. Never contains the opponent's ship positions. */
export interface PlayerView {
  you: PlayerIndex;
  phase: Phase;
  settings: GameSettings;
  turn: PlayerIndex;
  turnNumber: number;
  winner: PlayerIndex | null;
  /** Your draft while placing, your committed layout after. */
  yourLayout: Layout;
  ready: [boolean, boolean];
  /** Indexed by the sea's owner. */
  seas: [SeaView, SeaView];
  /** The current shooter's shots placed so far (both players watch them appear). */
  pendingShots: number[];
  shotsAllowed: number;
  lastSalvo: (Salvo & { durationMs: number }) | null;
  /** Both layouts, but only once the game is over. */
  revealed: [Layout, Layout] | null;
  opponent: OpponentInfo;
  inviteUrl?: string;
  /** Seeds the look of the charts (their ragged coastlines); the same for both players. */
  chartSeed: number;
  /** The game's hi-score table, once it is over. */
  hiscores?: GameHiscores;
}

export function playerView(state: GameState, you: PlayerIndex, room: RoomInfo): PlayerView {
  const me = state.players[you];
  const over = state.phase === 'over';
  return {
    you,
    phase: state.phase,
    settings: state.settings,
    turn: state.turn,
    turnNumber: state.turnNumber,
    winner: state.winner,
    yourLayout: me.layout ?? me.draft,
    ready: [state.players[0].layout !== null, state.players[1].layout !== null],
    seas: [
      { shots: [...state.players[0].sea], damage: [...state.players[0].damage] },
      { shots: [...state.players[1].sea], damage: [...state.players[1].damage] },
    ],
    pendingShots: state.phase === 'aiming' ? [...state.pendingShots] : [],
    shotsAllowed: state.phase === 'aiming' ? shotsAllowed(state, state.turn) : 0,
    lastSalvo: state.lastSalvo
      ? { ...state.lastSalvo, durationMs: salvoDurationMs(state.lastSalvo, room.timeScale) }
      : null,
    revealed: over ? [state.players[0].layout!, state.players[1].layout!] : null,
    opponent: room.opponent,
    chartSeed: room.chartSeed,
    ...(room.inviteUrl && you === 0 && !room.opponent.joined ? { inviteUrl: room.inviteUrl } : {}),
    ...(over && room.hiscores ? { hiscores: room.hiscores } : {}),
  };
}

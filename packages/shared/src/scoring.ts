import { type GameState, isSunk, other, type PlayerIndex, SEA_HIT, SEA_UNKNOWN } from './game.ts';
import type { AiKind } from './protocol.ts';
import { FLEET } from './ships.ts';

/**
 * Hi-score points. Every game scores for what the player hit and sank; the winner also gets a
 * bonus for winning, for each of their own ships still afloat, and for accuracy (hits per shot),
 * which is what a quick win comes down to. Any win outscores any loss.
 */
export const POINTS = { hit: 10, sink: 50, win: 500, afloat: 100, accuracy: 3000 } as const;

export interface ScoreDetails {
  won: boolean;
  shots: number;
  hits: number;
  /** Enemy ships sunk. */
  sunk: number;
  /** The player's own ships still afloat. */
  afloat: number;
  /** Salvos the player fired. */
  salvos: number;
}

export interface Score extends ScoreDetails {
  score: number;
}

export function playerScore(state: GameState, player: PlayerIndex): Score {
  const enemy = state.players[other(player)];
  const own = state.players[player];
  const shots = enemy.sea.filter((s) => s !== SEA_UNKNOWN).length;
  const hits = enemy.sea.filter((s) => s === SEA_HIT).length;
  const sunk = FLEET.filter((s) => isSunk(enemy, s.id)).length;
  const afloat = FLEET.filter((s) => !isSunk(own, s.id)).length;
  const won = state.winner === player;
  // turns alternate from the first player's
  const salvos = Math.ceil((state.turnNumber - (state.firstPlayer === player ? 0 : 1)) / 2);
  let score = POINTS.hit * hits + POINTS.sink * sunk;
  if (won) {
    score += POINTS.win + POINTS.afloat * afloat + Math.round(POINTS.accuracy * (hits / shots));
  }
  return { score, won, shots, hits, sunk, afloat, salvos };
}

/** Hi-score names: short enough for the table, in letters the game's font has. */
export const NAME_MAX = 12;
const NAME_CHARS = /^[A-Z0-9 .,!?'-]+$/;

/** A name as the table shows it, or null if it can't be one. */
export function cleanName(raw: string): string | null {
  const name = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  return name.length > 0 && name.length <= NAME_MAX && NAME_CHARS.test(name) ? name : null;
}

/** Who a hi-score table is for: one of the computer players, or two humans. */
export type Opponent = AiKind | 'human';

/** Each opponent has its own tables, and salvo fire on and off are kept apart. */
export const hiscoreBoard = (opponent: Opponent, salvo: boolean) =>
  `${opponent}${salvo ? '' : '-single'}`;

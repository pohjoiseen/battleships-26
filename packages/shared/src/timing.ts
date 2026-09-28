import type { PlayerIndex, Salvo } from './game.ts';

/**
 * How long the salvo animation runs. Both clients play it for this long and the server holds the
 * 'resolving' phase for the same time, so both players see the result together.
 */
export function salvoDurationMs(salvo: Salvo, timeScale = 1): number {
  const base = 2000 + 350 * salvo.shots.length + 900 * salvo.shipHits.length;
  return Math.round(base * timeScale);
}

/** The READY banner shown at the start of each turn. */
export const TURN_BANNER_MS = 1400;
/** Titles and messages type out at this many ms per character. */
export const TYPE_MS = 45;

/** The title of a turn, e.g. "PLAYER 2" + " FIRE 24 SHOTS AT NME". */
export function turnTitle(shooter: PlayerIndex, shots: number): [string, string] {
  return [`PLAYER ${shooter + 1}`, ` FIRE ${shots} SHOT${shots === 1 ? '' : 'S'} AT NME`];
}

/** How long a turn takes to announce itself: the banner, then its title typing out. */
export function turnIntroMs(shooter: PlayerIndex, shots: number): number {
  return TURN_BANNER_MS + turnTitle(shooter, shots).join('').length * TYPE_MS;
}

/**
 * Once the last shot of a turn is placed, the shots flash on the chart with three beeps for
 * this long before the salvo goes, as in the original.
 */
export const FIRING_MS = 900;

/** Pause between the AI's shot placements, so a human can watch it aim. */
export const AI_SHOT_DELAY_MS = 280;
/** The AI's pause after the turn's title has typed out, before its first shot. */
export const AI_THINK_DELAY_MS = 500;

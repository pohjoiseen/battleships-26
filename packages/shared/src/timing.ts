import type { Salvo } from './game.ts';

/**
 * How long the salvo animation runs. Both clients play it for this long and the server holds the
 * 'resolving' phase for the same time, so both players see the result together.
 */
export function salvoDurationMs(salvo: Salvo, timeScale = 1): number {
  const base = 2000 + 350 * salvo.shots.length + 900 * salvo.shipHits.length;
  return Math.round(base * timeScale);
}

/** Pause between the AI's shot placements, so a human can watch it aim. */
export const AI_SHOT_DELAY_MS = 280;
export const AI_THINK_DELAY_MS = 900;

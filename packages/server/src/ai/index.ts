import { createOriginalAi } from './original/index.ts';
import { simpleAi } from './simple.ts';
import type { AiPlayer } from './types.ts';

export type { AiPlayer, ShotRequest } from './types.ts';

/** Makes a computer player for one game; some remember things from turn to turn. */
export const AI_PLAYERS = {
  simple: () => simpleAi,
  original: createOriginalAi,
} satisfies Record<string, () => AiPlayer>;

export type AiKind = keyof typeof AI_PLAYERS;

import type { AiKind } from '@bs/shared';
import type { AiState } from './original/machine.ts';
import { createOriginalAi } from './original/index.ts';
import { simple2Ai, simpleAi } from './simple.ts';
import { strong2Ai, strongAi } from './strong.ts';
import type { AiPlayer } from './types.ts';

export type { AiPlayer, ShotRequest } from './types.ts';

/**
 * Makes a computer player for one game; some remember things from turn to turn, and are given
 * back what they saved (AiPlayer.save) when a game is restored.
 */
export const AI_PLAYERS = {
  simple: () => simpleAi,
  original: (saved?: unknown) => createOriginalAi(saved as AiState | undefined),
  strong: () => strongAi,
  simple2: () => simple2Ai,
  strong2: () => strong2Ai,
} satisfies Record<AiKind, (saved?: unknown) => AiPlayer>;

export type { AiKind };

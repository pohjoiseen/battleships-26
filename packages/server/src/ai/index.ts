import { simpleAi } from './simple.ts';
import type { AiPlayer } from './types.ts';

export type { AiPlayer, ShotRequest } from './types.ts';

export const AI_PLAYERS = { simple: simpleAi } satisfies Record<string, AiPlayer>;

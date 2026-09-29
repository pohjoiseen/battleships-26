import { z } from 'zod';
import { CELL_COUNT } from './geometry.ts';
import type { PlayerView } from './views.ts';

const cell = z
  .number()
  .int()
  .min(0)
  .max(CELL_COUNT - 1);

const placement = z.object({
  shipId: z.number().int(),
  orientation: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
});

export const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('draft'), layout: z.array(placement).max(10) }),
  z.object({ t: z.literal('ready'), layout: z.array(placement).max(10) }),
  z.object({ t: z.literal('toggleShot'), cell }),
  /** Where the shooter's cursor is, relayed live to the opponent. */
  z.object({ t: z.literal('cursor'), cell: cell.nullable() }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

export type ServerMessage =
  | { t: 'view'; view: PlayerView }
  | { t: 'cursor'; cell: number | null }
  | { t: 'error'; message: string; fatal?: boolean };

/** The computer players: the original's, our density AI and ACE, our Monte Carlo AI. */
export const AI_KINDS = ['original', 'simple', 'strong'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** GET /api/ais: the computer players this server offers (ACE may be off on small servers). */
export interface AisResponse {
  ais: AiKind[];
}

export const createGameRequest = z.object({
  mode: z.enum(['1p', '2p']),
  salvo: z.boolean().default(true),
  /** The computer player in a one-player game: the original's, or one of ours. */
  ai: z.enum(AI_KINDS).default('simple'),
});

export type CreateGameRequest = z.infer<typeof createGameRequest>;

export interface CreateGameResponse {
  url: string;
}

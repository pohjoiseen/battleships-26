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
  z.object({ t: z.literal('fire') }),
  /** Where the shooter's cursor is, relayed live to the opponent. */
  z.object({ t: z.literal('cursor'), cell: cell.nullable() }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

export type ServerMessage =
  | { t: 'view'; view: PlayerView }
  | { t: 'cursor'; cell: number | null }
  | { t: 'error'; message: string; fatal?: boolean };

export const createGameRequest = z.object({
  mode: z.enum(['1p', '2p']),
  salvo: z.boolean().default(true),
});

export type CreateGameRequest = z.infer<typeof createGameRequest>;

export interface CreateGameResponse {
  url: string;
}

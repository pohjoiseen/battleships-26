import { fileURLToPath } from 'node:url';
import { AI_KINDS, type AiKind } from '@bs/shared';
import { buildApp } from './app.ts';

const env = process.env;

/** BS_AIS: the computer players to offer, e.g. "original,simple" to leave out ACE (strong). */
function parseAis(value: string | undefined): AiKind[] | undefined {
  if (!value) return undefined;
  const ais = value.split(',').map((s) => s.trim());
  const unknown = ais.filter((a) => !(AI_KINDS as readonly string[]).includes(a));
  if (unknown.length || ais.length === 0) {
    throw new Error(`BS_AIS: unknown ${unknown.join(', ')}; choose from ${AI_KINDS.join(', ')}`);
  }
  return ais as AiKind[];
}
const ais = parseAis(env.BS_AIS);
const { app } = await buildApp({
  timeScale: Number(env.BS_TIME_SCALE ?? 1),
  ...(env.BS_SEED ? { seed: Number(env.BS_SEED) } : {}),
  idleMs: 24 * 60 * 60 * 1000,
  clientDir: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  logger: env.NODE_ENV === 'production',
  ...(ais ? { ais } : {}),
});

const port = Number(env.PORT ?? 3000);
await app.listen({ port, host: env.HOST ?? '127.0.0.1' });
console.log(`Battleships server on http://localhost:${port}`);

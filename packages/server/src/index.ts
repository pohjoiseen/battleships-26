import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const env = process.env;
const { app } = await buildApp({
  timeScale: Number(env.BS_TIME_SCALE ?? 1),
  ...(env.BS_SEED ? { seed: Number(env.BS_SEED) } : {}),
  idleMs: 24 * 60 * 60 * 1000,
  clientDir: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  logger: env.NODE_ENV === 'production',
});

const port = Number(env.PORT ?? 3000);
await app.listen({ port, host: env.HOST ?? '127.0.0.1' });
console.log(`Battleships server on http://localhost:${port}`);

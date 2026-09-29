import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  AI_KINDS,
  type AiKind,
  type AisResponse,
  clientMessage,
  createGameRequest,
  type CreateGameResponse,
  type HiscoresResponse,
  type ServerMessage,
} from '@bs/shared';
import Fastify from 'fastify';
import { Sessions, type SessionOptions } from './sessions.ts';

export interface AppOptions extends SessionOptions {
  /** Built client to serve (production). In development Vite serves the client instead. */
  clientDir?: string;
  logger?: boolean;
  /** The computer players offered; all by default. */
  ais?: readonly AiKind[];
}

export async function buildApp(opts: AppOptions) {
  const ais = opts.ais ?? AI_KINDS;
  const app = Fastify({ logger: opts.logger ?? false });
  const sessions = new Sessions(opts);
  await app.register(fastifyWebsocket);

  app.post('/api/games', async (req, reply) => {
    const parsed = createGameRequest.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad request' });
    const { mode, salvo, ai } = parsed.data;
    if (mode === '1p' && !ais.includes(ai)) {
      return reply.code(400).send({ error: `computer player ${ai} is not available here` });
    }
    const token = sessions.create(mode, { salvo }, ai);
    return { url: `/g/${token}` } satisfies CreateGameResponse;
  });

  app.get<{ Params: { invite: string } }>('/join/:invite', async (req, reply) => {
    const token = sessions.redeemInvite(req.params.invite);
    if (!token) {
      return reply
        .code(410)
        .type('text/html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>Battleships</title>' +
            '<p>This invite link has already been used or has expired. ' +
            '<a href="/">Start a new game</a></p>',
        );
    }
    return reply.redirect(`/g/${token}`, 302);
  });

  app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, (socket, req) => {
    const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));
    const seat = sessions.seat(req.query.token ?? '');
    if (!seat) {
      send({ t: 'error', message: 'Game not found. It may have expired.', fatal: true });
      socket.close();
      return;
    }
    const conn = { send: (data: string) => socket.send(data) };
    seat.room.connect(seat.player, conn);
    socket.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(String(raw));
      } catch {
        return send({ t: 'error', message: 'bad message' });
      }
      const msg = clientMessage.safeParse(json);
      if (!msg.success) return send({ t: 'error', message: 'bad message' });
      seat.room.handle(seat.player, msg.data, conn);
    });
    socket.on('close', () => seat.room.disconnect(seat.player, conn));
  });

  app.get('/api/ais', async () => ({ ais: [...ais] }) satisfies AisResponse);

  app.get(
    '/api/hiscores',
    async () => ({ tables: sessions.tables([...ais, 'human']) }) satisfies HiscoresResponse,
  );

  app.get('/api/health', async () => ({ ok: true, rooms: sessions.roomCount }));

  const clientDir = opts.clientDir;
  if (clientDir && existsSync(resolve(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: resolve(clientDir) });
    app.get('/g/:token', (_req, reply) => reply.sendFile('game.html'));
  }

  const sweeper = setInterval(() => sessions.sweep(), 10 * 60 * 1000);
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    sessions.close();
  });

  return { app, sessions };
}

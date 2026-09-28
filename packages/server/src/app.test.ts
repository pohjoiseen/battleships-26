import type { AddressInfo } from 'node:net';
import { isValidLayout, type PlayerView, type ServerMessage } from '@bs/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from './app.ts';

type App = Awaited<ReturnType<typeof buildApp>>['app'];
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start() {
  const built = await buildApp({ timeScale: 0.01, seed: 1, idleMs: 1000 });
  app = built.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
    sessions: built.sessions,
  };
}

/** A test client that records every message and can wait for one matching a predicate. */
function client(url: string) {
  const socket = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as ServerMessage;
    messages.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const next = (pred: (m: ServerMessage) => boolean, timeoutMs = 3000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const found = messages.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  const view = (pred: (v: PlayerView) => boolean = () => true) =>
    next((m) => m.t === 'view' && pred(m.view)).then((m) => (m as { view: PlayerView }).view);
  const send = (msg: object) => socket.send(JSON.stringify(msg));
  return { socket, messages, next, view, send, opened: new Promise((r) => socket.once('open', r)) };
}

async function createGame(base: string, mode: '1p' | '2p', salvo = true) {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, salvo }),
  });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return url.replace('/g/', '');
}

describe('server', () => {
  it('redeems an invite once and redirects to a fresh player-2 URL', async () => {
    const { base, ws } = await start();
    const token1 = await createGame(base, '2p');
    const p1 = client(`${ws}/ws?token=${token1}`);
    const first = await p1.view();
    expect(first.inviteUrl).toMatch(/^\/join\//);
    expect(first.opponent.joined).toBe(false);

    const res = await fetch(`${base}${first.inviteUrl}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^\/g\//);
    expect(location).not.toContain(token1);

    const again = await fetch(`${base}${first.inviteUrl}`, { redirect: 'manual' });
    expect(again.status).toBe(410);

    const joined = await p1.view((v) => v.opponent.joined);
    expect(joined.inviteUrl).toBeUndefined();
    p1.socket.close();
  });

  it('rejects unknown tokens', async () => {
    const { ws } = await start();
    const c = client(`${ws}/ws?token=nope`);
    const msg = await c.next((m) => m.t === 'error');
    expect(msg).toMatchObject({ fatal: true });
  });

  it('plays a 2-player turn: ready, cursor relay, shots, auto-fire, resolve', async () => {
    const { base, ws } = await start();
    const token1 = await createGame(base, '2p');
    const p1 = client(`${ws}/ws?token=${token1}`);
    const { inviteUrl } = await p1.view();
    const res = await fetch(`${base}${inviteUrl}`, { redirect: 'manual' });
    const token2 = res.headers.get('location')!.replace('/g/', '');
    const p2 = client(`${ws}/ws?token=${token2}`);

    const v1 = await p1.view((v) => v.opponent.connected);
    const v2 = await p2.view();
    expect(isValidLayout(v1.yourLayout)).toBe(true);
    p1.send({ t: 'ready', layout: v1.yourLayout });
    await p2.view((v) => v.ready[0]);
    p2.send({ t: 'ready', layout: v2.yourLayout });

    const aiming = await p1.view((v) => v.phase === 'aiming');
    const shooter = aiming.turn === 0 ? p1 : p2;
    const watcher = aiming.turn === 0 ? p2 : p1;

    shooter.send({ t: 'cursor', cell: 42 });
    expect(await watcher.next((m) => m.t === 'cursor')).toEqual({ t: 'cursor', cell: 42 });

    // the watcher may not shoot
    watcher.send({ t: 'toggleShot', cell: 1 });
    expect(await watcher.next((m) => m.t === 'error')).toMatchObject({ message: 'not your turn' });

    for (let cell = 0; cell < aiming.shotsAllowed; cell++) shooter.send({ t: 'toggleShot', cell });
    // the last shot fires the salvo by itself; the shots can't be changed while it goes
    shooter.send({ t: 'toggleShot', cell: 0 });
    const seen = await watcher.view((v) => v.pendingShots.length === aiming.shotsAllowed);
    expect(seen.pendingShots).toHaveLength(24);
    expect(await shooter.next((m) => m.t === 'error')).toMatchObject({
      message: 'the salvo is on its way',
    });

    const resolving = await watcher.view((v) => v.phase === 'resolving');
    expect(resolving.lastSalvo!.shots).toHaveLength(24);
    const next = await watcher.view((v) => v.phase === 'aiming' && v.turnNumber === 2);
    expect(next.turn).not.toBe(aiming.turn);
    p1.socket.close();
    p2.socket.close();
  });

  it('lets the AI place its fleet and take its turn in 1-player mode', async () => {
    const { base, ws } = await start();
    const token = await createGame(base, '1p');
    const p1 = client(`${ws}/ws?token=${token}`);
    const v = await p1.view();
    expect(v.opponent.kind).toBe('ai');
    expect(v.ready[1]).toBe(true);
    p1.send({ t: 'ready', layout: v.yourLayout });

    const view = await p1.view((x) => x.phase === 'aiming');
    if (view.turn === 0) {
      for (let cell = 0; cell < view.shotsAllowed; cell++) p1.send({ t: 'toggleShot', cell });
      await p1.view((x) => x.phase === 'aiming' && x.turn === 1);
    }
    // watch the AI aim (cursor messages) and fire
    await p1.next((m) => m.t === 'cursor' && m.cell !== null);
    const after = await p1.view((x) => x.phase === 'resolving' && x.lastSalvo?.shooter === 1);
    expect(after.lastSalvo!.shots).toHaveLength(24);
    expect(after.seas[0].shots.filter((s) => s !== 0)).toHaveLength(24);
    p1.socket.close();
  });

  it('keeps the game going across a reconnect', async () => {
    const { base, ws } = await start();
    const token = await createGame(base, '1p');
    const a = client(`${ws}/ws?token=${token}`);
    const v = await a.view();
    a.send({ t: 'ready', layout: v.yourLayout });
    await a.view((x) => x.phase === 'aiming');
    a.socket.close();
    const b = client(`${ws}/ws?token=${token}`);
    const again = await b.view();
    expect(again.phase).not.toBe('placing');
    expect(again.yourLayout).toEqual(v.yourLayout);
    b.socket.close();
  });

  it('sweeps idle rooms nobody is connected to', async () => {
    const { base, sessions } = await start();
    await createGame(base, '1p');
    expect(sessions.roomCount).toBe(1);
    sessions.sweep(Date.now() + 2000);
    expect(sessions.roomCount).toBe(0);
  });
});

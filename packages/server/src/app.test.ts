import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidLayout,
  occupancy,
  type HiscoresResponse,
  type PlayerView,
  type ServerMessage,
} from '@bs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from './app.ts';
import { sqliteStore } from './store.ts';

type App = Awaited<ReturnType<typeof buildApp>>['app'];
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(opts: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const built = await buildApp({ timeScale: 0.01, seed: 1, idleMs: 1000, ...opts });
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

async function createGame(base: string, mode: '1p' | '2p', salvo = true, ai?: string) {
  const res = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, salvo, ai }),
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

  it('offers only the computer players it is configured with', async () => {
    const all = await start();
    expect(await (await fetch(`${all.base}/api/ais`)).json()).toEqual({
      ais: ['original', 'simple', 'strong'],
    });
    await app!.close();

    const { base } = await start({ ais: ['original', 'simple'] });
    expect(await (await fetch(`${base}/api/ais`)).json()).toEqual({ ais: ['original', 'simple'] });
    const post = (ai: string) =>
      fetch(`${base}/api/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: '1p', ai }),
      });
    expect((await post('strong')).status).toBe(400);
    expect((await post('original')).status).toBe(200);
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

  it.each(['simple', 'original', 'strong'])(
    'lets the %s AI place its fleet and take its turn in 1-player mode',
    async (ai) => {
      const { base, ws } = await start();
      const token = await createGame(base, '1p', true, ai);
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
    },
  );

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

describe('restarting the server', () => {
  let dir: string;
  let db: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bs-test-'));
    db = join(dir, 'games.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Stops the running server and starts another on the same database. */
  async function restart(opts: Partial<Parameters<typeof buildApp>[0]> = {}) {
    await app?.close();
    return start({ store: sqliteStore(db), ...opts });
  }

  /** Creates a 2-player game with both players joined; returns their tokens. */
  async function twoPlayers(base: string, ws: string) {
    const token1 = await createGame(base, '2p');
    const p1 = client(`${ws}/ws?token=${token1}`);
    const inviteUrl = (await p1.view()).inviteUrl!;
    p1.socket.close();
    const res = await fetch(`${base}${inviteUrl}`, { redirect: 'manual' });
    return { token1, token2: res.headers.get('location')!.replace('/g/', ''), inviteUrl };
  }

  it('carries on a 2-player game where it was, shots placed and all', async () => {
    let { base, ws } = await restart();
    const { token1, token2, inviteUrl } = await twoPlayers(base, ws);
    const p1 = client(`${ws}/ws?token=${token1}`);
    const p2 = client(`${ws}/ws?token=${token2}`);
    p1.send({ t: 'ready', layout: (await p1.view()).yourLayout });
    p2.send({ t: 'ready', layout: (await p2.view()).yourLayout });
    const aiming = await p1.view((v) => v.phase === 'aiming');
    const shooter = aiming.turn === 0 ? p1 : p2;
    for (const cell of [5, 6, 7]) shooter.send({ t: 'toggleShot', cell });
    await p1.view((v) => v.pendingShots.length === 3);

    ({ base, ws } = await restart());
    const q1 = client(`${ws}/ws?token=${token1}`);
    const q2 = client(`${ws}/ws?token=${token2}`);
    const back = await q1.view((v) => v.opponent.connected);
    expect(back).toMatchObject({ phase: 'aiming', turn: aiming.turn, pendingShots: [5, 6, 7] });
    expect(back.yourLayout).toEqual(aiming.yourLayout);
    expect(back.opponent.joined).toBe(true);
    expect((await fetch(`${base}${inviteUrl}`, { redirect: 'manual' })).status).toBe(410);

    const shooterNow = aiming.turn === 0 ? q1 : q2;
    for (let cell = 8; cell < 8 + aiming.shotsAllowed - 3; cell++) {
      shooterNow.send({ t: 'toggleShot', cell });
    }
    const next = await q2.view((v) => v.phase === 'aiming' && v.turnNumber === 2);
    expect(next.lastSalvo!.shots).toHaveLength(aiming.shotsAllowed);
    for (const c of [p1, p2, q1, q2]) c.socket.close();
  });

  it('keeps an unused invite working', async () => {
    const first = await restart();
    const token1 = await createGame(first.base, '2p');
    const { base, ws } = await restart();
    const p1 = client(`${ws}/ws?token=${token1}`);
    const { inviteUrl } = await p1.view();
    expect((await fetch(`${base}${inviteUrl}`, { redirect: 'manual' })).status).toBe(302);
    await p1.view((v) => v.opponent.joined);
    p1.socket.close();
  });

  it('has the computer take its turn again when it was interrupted', async () => {
    const first = await restart({ timeScale: 0.05 });
    const token = await createGame(first.base, '1p', true, 'original');
    const a = client(`${first.ws}/ws?token=${token}`);
    a.send({ t: 'ready', layout: (await a.view()).yourLayout });
    const aiming = await a.view((v) => v.phase === 'aiming');
    if (aiming.turn === 0) {
      for (let cell = 0; cell < aiming.shotsAllowed; cell++) a.send({ t: 'toggleShot', cell });
    }
    // restart as soon as it is the computer's turn, before it has fired
    await a.view((v) => v.phase === 'aiming' && v.turn === 1);
    const { ws } = await restart({ timeScale: 0.05 });
    const b = client(`${ws}/ws?token=${token}`);
    const fired = await b.view((v) => v.phase === 'resolving' && v.lastSalvo?.shooter === 1);
    expect(fired.lastSalvo!.shots).toHaveLength(24);
    a.socket.close();
    b.socket.close();
  });

  it('forgets swept rooms, and drops saved rooms it cannot read', async () => {
    const { base, sessions } = await restart();
    await createGame(base, '1p');
    expect(sessions.roomCount).toBe(1);
    sessions.sweep(Date.now() + 2000);
    const store = sqliteStore(db);
    store.put('junk', '{"v":0}');
    store.close();
    const again = await restart();
    expect(again.sessions.roomCount).toBe(0);
    await app!.close();
    const left = sqliteStore(db);
    expect(left.all()).toEqual([]);
    left.close();
    app = undefined;
  });
});

describe('hi-scores', () => {
  /**
   * A 2-player game where player 2 sinks player 1's fleet with one salvo (the test knows where
   * player 1's ships are); if player 1 shoots first, they fire at the corner cells and miss.
   */
  async function playToTheEnd(base: string, ws: string) {
    const token1 = await createGame(base, '2p');
    const p1 = client(`${ws}/ws?token=${token1}`);
    const { inviteUrl } = await p1.view();
    const res = await fetch(`${base}${inviteUrl}`, { redirect: 'manual' });
    const token2 = res.headers.get('location')!.replace('/g/', '');
    const p2 = client(`${ws}/ws?token=${token2}`);
    const fleet1 = (await p1.view()).yourLayout;
    p1.send({ t: 'ready', layout: fleet1 });
    p2.send({ t: 'ready', layout: (await p2.view()).yourLayout });
    const first = await p1.view((v) => v.phase === 'aiming');
    if (first.turn === 0) {
      const own = occupancy((await p2.view()).yourLayout);
      const misses = own.flatMap((ship, cell) => (ship < 0 ? [cell] : [])).slice(-24);
      for (const cell of misses) p1.send({ t: 'toggleShot', cell });
      await p2.view((v) => v.phase === 'aiming' && v.turn === 1);
    }
    const targets = occupancy(fleet1).flatMap((ship, cell) => (ship >= 0 ? [cell] : []));
    const spare = occupancy(fleet1).findIndex((ship) => ship < 0);
    for (const cell of [...targets, spare]) p2.send({ t: 'toggleShot', cell });
    await p1.view((v) => v.phase === 'over' && !!v.hiscores);
    return { p1, p2, token2 };
  }

  it('scores both players of a finished game and lets them name their scores', async () => {
    const { base, ws } = await start();
    const { p1, p2 } = await playToTheEnd(base, ws);
    const won = await p2.view((v) => v.phase === 'over' && !!v.hiscores);
    expect(won.hiscores!.board).toBe('human');
    expect(won.hiscores!.yours).toMatchObject({ won: true, hits: 23, rank: 1, name: 'PLAYER 2' });
    const lost = await p1.view((v) => v.phase === 'over' && !!v.hiscores);
    expect(lost.hiscores!.yours).toMatchObject({ won: false, rank: 2, name: 'PLAYER 1' });
    expect(lost.hiscores!.entries.map((e) => [e.name, !!e.you])).toEqual([
      ['PLAYER 2', false],
      ['PLAYER 1', true],
    ]);

    // a name that isn't one changes nothing; a good one shows up for both players
    p2.send({ t: 'name', name: '<script>' });
    p2.send({ t: 'name', name: ' captain  nemo ' });
    const named = await p1.view((v) => v.hiscores?.entries[0]?.name === 'CAPTAIN NEMO');
    expect(named.hiscores!.entries).toHaveLength(2);
    expect(
      p2.messages.filter((m) => m.t === 'view' && m.view.hiscores?.entries[0]?.name === '<SCRIPT>'),
    ).toEqual([]);

    const { tables } = (await (await fetch(`${base}/api/hiscores`)).json()) as HiscoresResponse;
    expect(tables.map((t) => t.board)).toEqual([
      'original',
      'original-single',
      'simple',
      'simple-single',
      'strong',
      'strong-single',
      'human',
      'human-single',
    ]);
    const human = tables.find((t) => t.board === 'human')!;
    expect(human.entries.map((e) => e.name)).toEqual(['CAPTAIN NEMO', 'PLAYER 1']);
    expect(human.entries[0]).not.toHaveProperty('you');
    p1.socket.close();
    p2.socket.close();
  });

  it('keeps the tables, and your place in them, across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bs-test-'));
    try {
      const db = join(dir, 'games.db');
      const { base, ws } = await start({ store: sqliteStore(db) });
      const { p1, p2, token2 } = await playToTheEnd(base, ws);
      p2.send({ t: 'name', name: 'nemo' });
      await p1.view((v) => v.hiscores?.entries[0]?.name === 'NEMO');
      p1.socket.close();
      p2.socket.close();
      await app!.close();
      const again = await start({ store: sqliteStore(db) });
      const back = client(`${again.ws}/ws?token=${token2}`);
      const view = await back.view();
      expect(view.hiscores!.yours).toMatchObject({ name: 'NEMO', rank: 1, won: true });
      back.socket.close();
      const { tables } = (await (
        await fetch(`${again.base}/api/hiscores`)
      ).json()) as HiscoresResponse;
      expect(tables.find((t) => t.board === 'human')!.entries).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

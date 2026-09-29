import { randomBytes } from 'node:crypto';
import {
  cleanName,
  createRng,
  type GameHiscores,
  type GameSettings,
  hiscoreBoard,
  type HiscoreTable,
  type Opponent,
  type PlayerIndex,
  playerScore,
  randomSeed,
  type ScoreDetails,
} from '@bs/shared';
import { AI_PLAYERS, type AiKind } from './ai/index.ts';
import { Room, type RoomData } from './room.ts';
import { memoryStore, type ScoreRow, type Store } from './store.ts';

export interface SessionOptions {
  timeScale: number;
  /** When set, room N is seeded with seed + N, making games reproducible (tests). */
  seed?: number;
  /** Rooms nobody is connected to are dropped after this long without activity. */
  idleMs: number;
  /** Where rooms are saved, so games survive a restart; by default nowhere. */
  store?: Store;
}

interface Seat {
  room: Room;
  player: PlayerIndex;
}

/** A room with what the sessions know about it: how it was set up, and who holds which seat. */
interface Entry {
  id: string;
  room: Room;
  settings: GameSettings;
  ai: AiKind | null;
  chartSeed: number;
  inviteUrl?: string;
  /** Token → seat. */
  seats: Record<string, PlayerIndex>;
  /** Player 2's invite while it hasn't been used. */
  invite: string | null;
  /** Each human player's score from this game, once it's over. */
  scoreIds: [number | null, number | null];
}

/** How many places a hi-score table shows. */
export const TABLE_SIZE = 10;

/** How an entry is stored; `v` changes when the format does, and older rooms are dropped. */
interface SavedEntry extends Omit<Entry, 'room'> {
  v: typeof FORMAT;
  room: RoomData;
}
const FORMAT = 1;

const boardOf = (entry: Entry) => hiscoreBoard(entry.ai ?? 'human', entry.settings.salvo);

/** 128 bits of randomness, URL-safe. Knowing a token is what makes you that player. */
const newToken = () => randomBytes(16).toString('base64url');

export class Sessions {
  private readonly seats = new Map<string, Seat>();
  private readonly invites = new Map<string, Entry>();
  private readonly entries = new Map<string, Entry>();
  private readonly store: Store;
  private created = 0;
  /** After close; sockets still closing may stir their rooms, which then leave the store be. */
  private closed = false;

  constructor(private readonly opts: SessionOptions) {
    this.store = opts.store ?? memoryStore();
    for (const row of this.store.all()) {
      try {
        this.restore(JSON.parse(row.data) as SavedEntry);
      } catch (e) {
        console.warn(`dropping saved room ${row.id}:`, e);
        this.store.remove(row.id);
      }
    }
  }

  /** Creates a game and returns player 1's token. */
  create(mode: '1p' | '2p', settings: GameSettings, ai: AiKind = 'simple'): string {
    const seed = this.opts.seed !== undefined ? this.opts.seed + this.created : randomSeed();
    this.created++;
    const invite = mode === '2p' ? newToken() : null;
    const token = newToken();
    const entry: Omit<Entry, 'room'> = {
      id: newToken(),
      settings,
      ai: mode === '1p' ? ai : null,
      // derived from the seed rather than drawn from the rng, so seeded games play the same
      chartSeed: (seed ^ 0x5bd1e995) >>> 0,
      ...(invite ? { inviteUrl: `/join/${invite}` } : {}),
      seats: { [token]: 0 },
      invite,
      scoreIds: [null, null],
    };
    this.add(entry, createRng(seed));
    return token;
  }

  /**
   * Exchanges an invite for player 2's own token. The invite works once, so player 1 can't
   * reuse the link they shared to look at player 2's screen.
   */
  redeemInvite(invite: string): string | null {
    const entry = this.invites.get(invite);
    if (!entry) return null;
    this.invites.delete(invite);
    entry.invite = null;
    const token = newToken();
    entry.seats[token] = 1;
    this.seats.set(token, { room: entry.room, player: 1 });
    // this saves the entry too
    entry.room.markPlayer2Joined();
    return token;
  }

  seat(token: string): Seat | undefined {
    return this.seats.get(token);
  }

  /** Drops rooms that are idle and have nobody connected. */
  sweep(now = Date.now()): void {
    for (const entry of this.entries.values()) {
      const room = entry.room;
      if (room.connectionCount === 0 && now - room.lastActivity > this.opts.idleMs) {
        room.dispose();
        this.entries.delete(entry.id);
        for (const token of Object.keys(entry.seats)) this.seats.delete(token);
        if (entry.invite) this.invites.delete(entry.invite);
        this.store.remove(entry.id);
      }
    }
  }

  get roomCount(): number {
    return this.entries.size;
  }

  /** The top of each table, for these opponents, salvo fire on and off. */
  tables(opponents: readonly Opponent[]): HiscoreTable[] {
    return opponents.flatMap((opponent) =>
      [true, false].map((salvo) => {
        const board = hiscoreBoard(opponent, salvo);
        return {
          board,
          entries: this.store.topScores(board, TABLE_SIZE).map(({ name, score, created }) => ({
            name,
            score,
            date: created,
          })),
        };
      }),
    );
  }

  /** The game is over: every human player's score goes in the table, named after their seat. */
  private scoreGame(entry: Entry): void {
    if (this.closed) return;
    const state = entry.room.state;
    const board = boardOf(entry);
    for (const player of entry.ai ? ([0] as const) : ([0, 1] as const)) {
      const { score, ...details } = playerScore(state, player);
      entry.scoreIds[player] = this.store.addScore({
        board,
        name: `PLAYER ${player + 1}`,
        score,
        details: JSON.stringify(details),
      });
    }
  }

  private hiscores(entry: Entry, player: PlayerIndex): GameHiscores | undefined {
    if (this.closed) return undefined;
    const board = boardOf(entry);
    const id = entry.scoreIds[player];
    const mine: ScoreRow | undefined = id === null ? undefined : this.store.score(id);
    return {
      board,
      entries: this.store.topScores(board, TABLE_SIZE).map((r) => ({
        name: r.name,
        score: r.score,
        date: r.created,
        ...(r.id === id ? { you: true } : {}),
      })),
      yours: mine
        ? {
            ...(JSON.parse(mine.details) as ScoreDetails),
            score: mine.score,
            name: mine.name,
            rank: this.store.rank(mine.id),
          }
        : null,
    };
  }

  private rename(entry: Entry, player: PlayerIndex, raw: string): void {
    const name = cleanName(raw);
    const id = entry.scoreIds[player];
    if (name && id !== null && !this.closed) this.store.renameScore(id, name);
  }

  /** Stops every room's timers; the store keeps them for next time. */
  close(): void {
    for (const entry of this.entries.values()) entry.room.dispose();
    this.closed = true;
    this.store.close();
  }

  private restore(saved: SavedEntry): void {
    if (saved.v !== FORMAT) throw new Error(`format ${saved.v}, expected ${FORMAT}`);
    const { room, ...entry } = saved;
    delete (entry as Partial<SavedEntry>).v;
    entry.scoreIds ??= [null, null];
    this.add(entry, createRng(room.rng), room);
  }

  /** Builds the entry's room (new, or from saved data), indexes it and saves it. */
  private add(fields: Omit<Entry, 'room'>, rng: ReturnType<typeof createRng>, saved?: RoomData) {
    const entry = fields as Entry;
    entry.room = new Room({
      settings: fields.settings,
      rng,
      ai: fields.ai ? AI_PLAYERS[fields.ai](saved?.ai ?? undefined) : null,
      timeScale: this.opts.timeScale,
      chartSeed: fields.chartSeed,
      ...(fields.inviteUrl ? { inviteUrl: fields.inviteUrl } : {}),
      ...(saved ? { saved } : {}),
      onChange: () => this.save(entry),
      onOver: () => this.scoreGame(entry),
      hiscores: (player) => this.hiscores(entry, player),
      rename: (player, name) => this.rename(entry, player, name),
    });
    this.entries.set(entry.id, entry);
    for (const [token, player] of Object.entries(entry.seats)) {
      this.seats.set(token, { room: entry.room, player });
    }
    if (entry.invite) this.invites.set(entry.invite, entry);
    this.save(entry);
  }

  private save(entry: Entry): void {
    // a new room saves itself while it is being built, before it's indexed
    if (!entry.room || this.closed) return;
    const { room, ...fields } = entry;
    const saved: SavedEntry = { v: FORMAT, ...fields, room: room.data() };
    this.store.put(entry.id, JSON.stringify(saved));
  }
}

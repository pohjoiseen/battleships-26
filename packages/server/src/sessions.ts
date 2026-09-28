import { randomBytes } from 'node:crypto';
import { createRng, type GameSettings, type PlayerIndex, randomSeed } from '@bs/shared';
import { AI_PLAYERS } from './ai/index.ts';
import { Room } from './room.ts';

export interface SessionOptions {
  timeScale: number;
  /** When set, room N is seeded with seed + N, making games reproducible (tests). */
  seed?: number;
  /** Rooms nobody is connected to are dropped after this long without activity. */
  idleMs: number;
}

interface Seat {
  room: Room;
  player: PlayerIndex;
}

/** 128 bits of randomness, URL-safe. Knowing a token is what makes you that player. */
const newToken = () => randomBytes(16).toString('base64url');

export class Sessions {
  private readonly seats = new Map<string, Seat>();
  private readonly invites = new Map<string, Room>();
  private readonly rooms = new Set<Room>();
  private created = 0;

  constructor(private readonly opts: SessionOptions) {}

  /** Creates a game and returns player 1's token. */
  create(mode: '1p' | '2p', settings: GameSettings): string {
    const seed = this.opts.seed !== undefined ? this.opts.seed + this.created : randomSeed();
    this.created++;
    const invite = mode === '2p' ? newToken() : null;
    const room = new Room({
      settings,
      rng: createRng(seed),
      ai: mode === '1p' ? AI_PLAYERS.simple : null,
      timeScale: this.opts.timeScale,
      ...(invite ? { inviteUrl: `/join/${invite}` } : {}),
    });
    const token = newToken();
    this.rooms.add(room);
    this.seats.set(token, { room, player: 0 });
    if (invite) this.invites.set(invite, room);
    return token;
  }

  /**
   * Exchanges an invite for player 2's own token. The invite works once, so player 1 can't
   * reuse the link they shared to look at player 2's screen.
   */
  redeemInvite(invite: string): string | null {
    const room = this.invites.get(invite);
    if (!room) return null;
    this.invites.delete(invite);
    const token = newToken();
    this.seats.set(token, { room, player: 1 });
    room.markPlayer2Joined();
    return token;
  }

  seat(token: string): Seat | undefined {
    return this.seats.get(token);
  }

  /** Drops rooms that are idle and have nobody connected. */
  sweep(now = Date.now()): void {
    for (const room of this.rooms) {
      if (room.connectionCount === 0 && now - room.lastActivity > this.opts.idleMs) {
        room.dispose();
        this.rooms.delete(room);
        for (const [token, seat] of this.seats) if (seat.room === room) this.seats.delete(token);
        for (const [invite, r] of this.invites) if (r === room) this.invites.delete(invite);
      }
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}

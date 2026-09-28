import {
  type Action,
  AI_SHOT_DELAY_MS,
  AI_THINK_DELAY_MS,
  applyAction,
  type ClientMessage,
  createGame,
  type GameSettings,
  type GameState,
  other,
  type PlayerIndex,
  playerView,
  type Rng,
  salvoDurationMs,
  type ServerMessage,
  shotsAllowed,
} from '@bs/shared';
import type { AiPlayer } from './ai/index.ts';

/** The part of a WebSocket the room needs; keeps the room testable without a network. */
export interface Connection {
  send(data: string): void;
}

export interface RoomOptions {
  settings: GameSettings;
  rng: Rng;
  /** Player 2 is played by this AI, or is a human who joins through the invite link. */
  ai: AiPlayer | null;
  /** Scales all waits (salvo animation, AI pacing); tests run with a small value. */
  timeScale: number;
  inviteUrl?: string;
}

/** One game: owns the state, applies player actions, and keeps every connection up to date. */
export class Room {
  readonly state: GameState;
  private readonly connections: [Set<Connection>, Set<Connection>] = [new Set(), new Set()];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private aiBusy = false;
  player2Joined: boolean;
  lastActivity = Date.now();

  constructor(private readonly opts: RoomOptions) {
    this.state = createGame(opts.settings, opts.rng);
    this.player2Joined = opts.ai !== null;
    if (opts.ai) {
      const result = this.apply({ type: 'ready', player: 1, layout: opts.ai.placeFleet(opts.rng) });
      if (!result.ok) throw new Error(`AI placed an invalid fleet: ${result.error}`);
    }
  }

  get connectionCount(): number {
    return this.connections[0].size + this.connections[1].size;
  }

  connect(player: PlayerIndex, conn: Connection): void {
    this.connections[player].add(conn);
    this.touch();
    this.broadcast();
  }

  disconnect(player: PlayerIndex, conn: Connection): void {
    this.connections[player].delete(conn);
    this.broadcast();
  }

  markPlayer2Joined(): void {
    this.player2Joined = true;
    this.broadcast();
  }

  handle(player: PlayerIndex, msg: ClientMessage, from: Connection): void {
    this.touch();
    if (msg.t === 'cursor') {
      if (this.state.phase === 'aiming' && this.state.turn === player) {
        this.sendTo(other(player), { t: 'cursor', cell: msg.cell });
      }
      return;
    }
    const action: Action =
      msg.t === 'draft' || msg.t === 'ready'
        ? { type: msg.t, player, layout: msg.layout }
        : msg.t === 'toggleShot'
          ? { type: 'toggleShot', player, cell: msg.cell }
          : { type: 'fire', player };
    const result = this.apply(action);
    if (!result.ok) {
      from.send(JSON.stringify({ t: 'error', message: result.error } satisfies ServerMessage));
      // resync the sender, whose local state may have run ahead of the server's
      from.send(JSON.stringify({ t: 'view', view: this.viewFor(player) } satisfies ServerMessage));
    }
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private apply(action: Action) {
    const result = applyAction(this.state, action, this.opts.rng);
    if (!result.ok) return result;
    // Drafts only matter to the player moving ships around, who already has them locally.
    if (action.type !== 'draft') this.broadcast();
    if (action.type === 'fire') {
      const duration = salvoDurationMs(this.state.lastSalvo!, this.opts.timeScale);
      this.later(duration, () => this.apply({ type: 'advance' }));
    }
    this.driveAi();
    return result;
  }

  /** Plays the AI's turn at a human-watchable pace: think, then place shots one by one, fire. */
  private driveAi(): void {
    const ai = this.opts.ai;
    if (!ai || this.aiBusy || this.state.phase !== 'aiming' || this.state.turn !== 1) return;
    this.aiBusy = true;
    const enemy = this.state.players[0];
    const shots = ai.chooseShots(
      { sea: [...enemy.sea], damage: [...enemy.damage], count: shotsAllowed(this.state, 1) },
      this.opts.rng,
    );
    const step = (i: number) => {
      if (i < shots.length) {
        this.sendTo(0, { t: 'cursor', cell: shots[i]! });
        applyAction(this.state, { type: 'toggleShot', player: 1, cell: shots[i]! }, this.opts.rng);
        this.broadcast();
        this.later(AI_SHOT_DELAY_MS * this.opts.timeScale, () => step(i + 1));
      } else {
        this.sendTo(0, { t: 'cursor', cell: null });
        this.aiBusy = false;
        this.apply({ type: 'fire', player: 1 });
      }
    };
    this.later(AI_THINK_DELAY_MS * this.opts.timeScale, () => step(0));
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private viewFor(player: PlayerIndex) {
    const human = this.opts.ai === null;
    return playerView(this.state, player, {
      opponent: {
        kind: player === 0 && !human ? 'ai' : 'human',
        joined: player === 1 || this.player2Joined,
        connected: player === 0 && !human ? true : this.connections[other(player)].size > 0,
      },
      inviteUrl: this.opts.inviteUrl,
      timeScale: this.opts.timeScale,
    });
  }

  private sendTo(player: PlayerIndex, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const conn of this.connections[player]) conn.send(data);
  }

  private broadcast(): void {
    for (const player of [0, 1] as const) {
      if (this.connections[player].size > 0) {
        this.sendTo(player, { t: 'view', view: this.viewFor(player) });
      }
    }
  }
}

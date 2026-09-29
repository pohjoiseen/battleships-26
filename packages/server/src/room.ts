import {
  type Action,
  AI_SHOT_DELAY_MS,
  AI_THINK_DELAY_MS,
  FIRING_MS,
  RESULTS_MS,
  turnIntroMs,
  applyAction,
  type ClientMessage,
  createGame,
  type GameSettings,
  type GameHiscores,
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
  /** Seeds cosmetic things both players should see alike, such as the charts' coastlines. */
  chartSeed?: number;
  /** A room saved before a restart (see Room.data), to carry on with instead of a new game. */
  saved?: RoomData;
  /** Called after anything worth saving has changed. */
  onChange?: () => void;
  /** Called once when the game ends, before anyone is told. */
  onOver?: () => void;
  /** The hi-scores to show a player once the game is over. */
  hiscores?: (player: PlayerIndex) => GameHiscores | undefined;
  /** A player names their score. */
  rename?: (player: PlayerIndex, name: string) => void;
}

/** What changes as a room plays, as JSON; with its options, enough to rebuild it. */
export interface RoomData {
  state: GameState;
  /** The rng's state (Rng.state). */
  rng: number;
  /** The AI's memory (AiPlayer.save), if it has any. */
  ai: unknown;
  player2Joined: boolean;
  lastActivity: number;
}

/** One game: owns the state, applies player actions, and keeps every connection up to date. */
export class Room {
  readonly state: GameState;
  private readonly connections: [Set<Connection>, Set<Connection>] = [new Set(), new Set()];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private aiBusy = false;
  /** Between the last shot of a turn being placed and the salvo going. */
  private firing = false;
  player2Joined: boolean;
  lastActivity = Date.now();

  constructor(private readonly opts: RoomOptions) {
    if (opts.saved) {
      this.state = opts.saved.state;
      this.player2Joined = opts.saved.player2Joined;
      this.lastActivity = opts.saved.lastActivity;
      this.resume();
      return;
    }
    this.state = createGame(opts.settings, opts.rng);
    this.player2Joined = opts.ai !== null;
    if (opts.ai) {
      const result = this.apply({ type: 'ready', player: 1, layout: opts.ai.placeFleet(opts.rng) });
      if (!result.ok) throw new Error(`AI placed an invalid fleet: ${result.error}`);
    }
  }

  data(): RoomData {
    return {
      state: this.state,
      rng: this.opts.rng.state(),
      ai: this.opts.ai?.save?.() ?? null,
      player2Joined: this.player2Joined,
      lastActivity: this.lastActivity,
    };
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
    this.opts.onChange?.();
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
    if (msg.t === 'name') {
      if (this.state.phase === 'over') {
        this.opts.rename?.(player, msg.name);
        this.broadcast();
      }
      return;
    }
    const action: Action =
      msg.t === 'toggleShot'
        ? { type: 'toggleShot', player, cell: msg.cell }
        : { type: msg.t, player, layout: msg.layout };
    const result: { ok: true } | { ok: false; error: string } = this.firing
      ? { ok: false, error: 'the salvo is on its way' }
      : this.apply(action);
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
    if (action.type === 'advance' && this.state.phase === 'over') this.opts.onOver?.();
    this.opts.onChange?.();
    // Drafts only matter to the player moving ships around, who already has them locally.
    if (action.type !== 'draft') this.broadcast();
    if (action.type === 'fire') {
      // the animation, then a look at the results
      const duration = salvoDurationMs(this.state.lastSalvo!, this.opts.timeScale);
      this.later(duration + RESULTS_MS * this.opts.timeScale, () =>
        this.apply({ type: 'advance' }),
      );
    }
    // the last shot of a turn fires the salvo, after the shots have flashed on the chart
    const s = this.state;
    if (
      action.type === 'toggleShot' &&
      s.phase === 'aiming' &&
      s.pendingShots.length === shotsAllowed(s, s.turn)
    ) {
      this.fireAfterFlash();
    }
    this.driveAi();
    return result;
  }

  /** The shots flash on the chart for a moment, then the salvo goes. */
  private fireAfterFlash(): void {
    const shooter = this.state.turn;
    this.firing = true;
    this.later(FIRING_MS * this.opts.timeScale, () => {
      this.firing = false;
      this.apply({ type: 'fire', player: shooter });
    });
  }

  /**
   * Picks a restored game up where it was: whatever was waiting on a timer is started again,
   * and an AI caught halfway through placing its shots starts its turn over.
   */
  private resume(): void {
    const s = this.state;
    if (s.phase === 'resolving') {
      const duration = salvoDurationMs(s.lastSalvo!, this.opts.timeScale);
      this.later(duration + RESULTS_MS * this.opts.timeScale, () =>
        this.apply({ type: 'advance' }),
      );
    } else if (s.phase === 'aiming') {
      if (this.opts.ai && s.turn === 1) {
        s.pendingShots = [];
        this.driveAi();
      } else if (s.pendingShots.length === shotsAllowed(s, s.turn)) {
        this.fireAfterFlash();
      }
    }
  }

  /** Plays the AI's turn at a human-watchable pace: think, then place shots one by one, fire. */
  private driveAi(): void {
    const ai = this.opts.ai;
    if (!ai || this.aiBusy || this.state.phase !== 'aiming' || this.state.turn !== 1) return;
    this.aiBusy = true;
    const enemy = this.state.players[0];
    const shots = ai.chooseShots(
      {
        sea: [...enemy.sea],
        damage: [...enemy.damage],
        count: shotsAllowed(this.state, 1),
        fleet: enemy.layout!,
      },
      this.opts.rng,
    );
    // the last shot fires the salvo (see apply)
    const step = (i: number) => {
      this.sendTo(0, { t: 'cursor', cell: shots[i]! });
      const last = i === shots.length - 1;
      if (last) {
        this.sendTo(0, { t: 'cursor', cell: null });
        this.aiBusy = false;
      }
      this.apply({ type: 'toggleShot', player: 1, cell: shots[i]! });
      if (!last) this.later(AI_SHOT_DELAY_MS * this.opts.timeScale, () => step(i + 1));
    };
    // wait for the turn's banner and title, which the human watches first
    const intro = turnIntroMs(1, shots.length);
    this.later((intro + AI_THINK_DELAY_MS) * this.opts.timeScale, () => step(0));
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
      chartSeed: this.opts.chartSeed ?? 0,
      hiscores: this.state.phase === 'over' ? this.opts.hiscores?.(player) : undefined,
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

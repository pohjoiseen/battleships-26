import {
  type ClientMessage,
  cellIndex,
  clampPlacement,
  conflictingShips,
  createRng,
  indexCell,
  type Layout,
  other,
  placementIndices,
  type PlayerIndex,
  type PlayerView,
  randomLayout,
  randomSeed,
  rotatePlacement,
  SEA_HIT,
  SEA_UNKNOWN,
  TURN_BANNER_MS,
  turnTitle,
  TYPE_MS,
} from '@bs/shared';
import { drawText, textWidth } from '../gfx/font.ts';
import { FIRE_BEEP_MS, sound, TYPE_UNIT_MS } from '../gfx/sound.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { LH, LW, type Screen } from '../gfx/screen.ts';
import {
  blink,
  type Button,
  buttonAt,
  buttonRow,
  drawButton,
  drawHint,
  drawMessageBox,
  drawPanel,
  drawSea,
  drawTitle,
  type ShipMarks,
} from './draw.ts';
import { cellAt, cellCentre, type Geometry, geometry, slotAt } from './geometry.ts';
import { drawReport, drawSailPast, sailPastDuration, sailPastSounds } from './sailpast.ts';
import { drawSalvo, salvoSounds, timeline } from './salvo.ts';

type ScreenName =
  | 'connecting'
  | 'placing'
  | 'aiming'
  | 'salvo'
  | 'over-message'
  | 'winners'
  | 'sailpast'
  | 'report';

/** The screens after the last salvo, in order; each moves on by itself or on a click. */
type OverStage = 'over-message' | 'winners' | 'sailpast' | 'report';
const OVER_STAGES: readonly OverStage[] = ['over-message', 'winners', 'sailpast', 'report'];

const OVER_MESSAGE_MS = 4000;
const WINNERS_MS = 7000;
const CURSOR_SEND_MS = 50;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'S'}`;

/**
 * The game page. Draws whatever the latest server view says, and turns input into messages.
 * Local state covers only what must feel instant: dragging ships, the cursor, and shots placed
 * but not yet confirmed by the server.
 */
export class App {
  view: PlayerView | null = null;
  fatalError: string | null = null;
  connected = false;
  send: (msg: ClientMessage) => void = () => {};

  private now = 0;
  private g: Geometry = geometry(false);
  private buttons: Button[] = [];

  // placement
  private draft: Layout | null = null;
  private selected: number | null = 0;
  private drag: { shipId: number; dx: number; dy: number } | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  // aiming
  private cursor: number | null = null;
  private opponentCursor: number | null = null;
  private localPending: number[] = [];
  /** Shot toggles sent but not yet reflected in a view; until then, local shots win. */
  private outstanding = 0;
  private cursorSentAt = 0;
  /** When this turn's last shot went down, and the shots began flashing before the salvo. */
  private firing = { turn: 0, since: 0 };
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;

  // sequencing
  private bannerUntil = 0;
  private typing = { id: '', count: 0, unit: -1 };
  private sfx = { key: '', at: 0 };
  private toast = '';
  private toastUntil = 0;
  private lastTurn = 0;
  private salvoKey = '';
  private salvoStart = 0;
  private events: ReturnType<typeof timeline> = [];
  private overStage: OverStage = 'over-message';
  private stageStart = 0;

  constructor(private readonly screen: Screen) {}

  // ---- server events ----

  onView(v: PlayerView): void {
    const prev = this.view;
    this.view = v;
    const now = performance.now();

    if (v.phase === 'placing') {
      if (!this.draft || v.ready[v.you]) this.draft = v.yourLayout;
      if (v.ready[v.you]) this.selected = null;
    } else {
      this.draft = null;
      this.drag = null;
    }

    if (this.outstanding > 0) this.outstanding--;
    if (this.outstanding === 0) this.localPending = [...v.pendingShots];

    if (v.phase === 'aiming' && v.turnNumber !== this.lastTurn) {
      this.lastTurn = v.turnNumber;
      this.bannerUntil = now + TURN_BANNER_MS;
      this.opponentCursor = null;
      this.localPending = [...v.pendingShots];
      this.outstanding = 0;
      if (v.turn === v.you && this.cursor === null) this.cursor = cellIndex({ x: 10, y: 10 });
    }

    if (v.phase === 'resolving' && v.lastSalvo) {
      const key = `${v.lastSalvo.turnNumber}:${v.lastSalvo.shooter}`;
      if (key !== this.salvoKey) {
        this.salvoKey = key;
        this.salvoStart = now;
        this.events = timeline(v.lastSalvo);
      }
    }

    if (v.phase === 'over' && prev?.phase !== 'over') {
      this.overStage = 'over-message';
      this.stageStart = now;
    }
  }

  /**
   * The server rejected something (it resends the view right after). Drop local guesses so the
   * view wins.
   */
  onServerError(): void {
    this.outstanding = 0;
  }

  onConnection(connected: boolean): void {
    this.connected = connected;
    // anything sent while the link was down is lost; the fresh view on reconnect is the truth
    if (connected) this.onServerError();
  }

  onCursor(cell: number | null): void {
    this.opponentCursor = cell;
  }

  // ---- drawing ----

  screenName(): ScreenName {
    const v = this.view;
    if (!v) return 'connecting';
    switch (v.phase) {
      case 'placing':
        return 'placing';
      case 'aiming':
        return 'aiming';
      case 'resolving':
        return 'salvo';
      case 'over':
        return this.overStage;
    }
  }

  frame(now: number): void {
    this.now = now;
    this.advanceOverStage();
    const ctx = this.screen.ctx;
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, LW, LH);
    this.buttons = [];
    const v = this.view;

    if (!v) {
      const text = this.fatalError ?? 'CONNECTING...';
      drawText(ctx, text, LW / 2, LH / 2 - 4, this.fatalError ? C.brightRed : C.brightCyan, {
        align: 'center',
      });
    } else {
      switch (this.screenName()) {
        case 'placing':
          this.drawPlacement(ctx, v);
          break;
        case 'aiming':
          this.drawAiming(ctx, v);
          break;
        case 'salvo':
          drawSalvo(
            ctx,
            v.lastSalvo!,
            this.events,
            other(v.lastSalvo!.shooter),
            v.seas[other(v.lastSalvo!.shooter)].damage,
            now - this.salvoStart,
          );
          break;
        case 'over-message':
        case 'winners':
          this.drawOver(ctx, v);
          break;
        case 'sailpast':
          drawSailPast(ctx, v.winner!, v.seas[v.winner!].damage, now - this.stageStart);
          drawText(ctx, 'CLICK TO SKIP', LW / 2, LH - 10, C.grey, { align: 'center' });
          break;
        case 'report':
          drawReport(ctx, v, now - this.stageStart);
          this.buttons = [
            { id: 'new', label: 'NEW GAME', x: LW / 2 - 60, y: 210, w: 120, h: 16, enabled: true },
          ];
          break;
        default:
      }
      for (const b of this.buttons) drawButton(ctx, b);
      this.playSounds(v);
    }

    if (this.now < this.toastUntil) {
      const w = textWidth(this.toast, {}) + 12;
      ctx.fillStyle = C.black;
      ctx.fillRect(LW / 2 - w / 2, LH / 2 - 8, w, 16);
      drawText(ctx, this.toast, LW / 2, LH / 2 - 4, C.brightWhite, { align: 'center' });
    }

    if (v && !this.connected) {
      drawText(ctx, this.fatalError ?? 'RECONNECTING...', LW - 4, LH - 10, C.brightRed, {
        align: 'right',
      });
    }
    this.screen.present();
  }

  /**
   * How many characters of a typing-out text to show, `start` ms in; each new character
   * chatters like a teletype.
   */
  private typeOut(id: string, parts: [string, string][], start: number): number {
    const total = parts.reduce((n, [text]) => n + text.length, 0);
    const n = Math.min(total, Math.max(0, Math.floor((this.now - start) / TYPE_MS)));
    if (id !== this.typing.id) this.typing = { id, count: 0, unit: -1 };
    // one burst of chatter after another for as long as characters keep coming
    const unit = Math.floor((this.now - start) / TYPE_UNIT_MS);
    if (n > 0 && this.typing.count < total && unit !== this.typing.unit) {
      sound.play('type');
      this.typing.unit = unit;
    }
    this.typing.count = n;
    return n;
  }

  /** Sounds for whatever happened since the last frame, on screens that make any. */
  private playSounds(v: PlayerView): void {
    const screen = this.screenName();
    const key =
      screen === 'salvo'
        ? `salvo ${this.salvoKey}`
        : this.isOver(screen)
          ? `${screen} ${this.stageStart}`
          : screen;
    const start = screen === 'salvo' ? this.salvoStart : this.stageStart;
    const elapsed = this.now - start;
    const fresh = key !== this.sfx.key;
    const prev = fresh ? -1 : this.sfx.at;
    this.sfx = { key, at: elapsed };
    // after the tab was hidden, don't catch up with a burst of everything that was missed
    if (!fresh && elapsed - prev > 500) return;
    if (screen === 'salvo' && v.lastSalvo) {
      salvoSounds(v.lastSalvo, this.events, prev, elapsed);
    } else if (screen === 'winners' && fresh) {
      sound.play('drone');
    } else if (screen === 'sailpast') {
      sailPastSounds(v.winner!, v.seas[v.winner!].damage, prev, elapsed);
    }
  }

  private opponentName(v: PlayerView): string {
    return v.opponent.kind === 'ai' ? 'THE COMPUTER' : `PLAYER ${other(v.you) + 1}`;
  }

  /** Overrides the hint line when the other human has dropped out. */
  private opponentProblem(v: PlayerView): string | null {
    if (v.opponent.kind !== 'human') return null;
    if (!v.opponent.joined) return 'WAITING FOR PLAYER 2 TO JOIN';
    if (!v.opponent.connected) return `PLAYER ${other(v.you) + 1} HAS DISCONNECTED`;
    return null;
  }

  private drawPlacement(ctx: CanvasRenderingContext2D, v: PlayerView) {
    const me = v.you;
    const ready = v.ready[me];
    const layout = this.draft ?? v.yourLayout;
    const conflicts = ready ? new Set<number>() : conflictingShips(layout);
    this.g = geometry(me === 1);

    const ships: ShipMarks[] = layout.map((p) => ({
      cells: placementIndices(p).filter((i) => i >= 0 && i < 400),
      colour:
        conflicts.has(p.shipId) && blink(this.now, 300)
          ? C.brightWhite
          : p.shipId === this.selected && !ready
            ? C.brightBlue
            : C.magenta,
    }));
    drawTitle(ctx, [
      [`PLAYER ${me + 1}`, playerColour(me)],
      [ready ? ' IS READY' : ' POSITION YOUR SHIPS', C.brightCyan],
    ]);
    drawSea(
      ctx,
      this.g,
      { owner: me, chartSeed: v.chartSeed, shots: v.seas[me].shots, ships },
      this.now,
    );
    drawPanel(
      ctx,
      this.g,
      { owner: me, damage: v.seas[me].damage, selected: ready ? null : this.selected, conflicts },
      this.now,
    );

    if (!ready) {
      this.buttons = buttonRow(this.g, [
        { id: 'rotate', label: 'ROTATE', enabled: this.selected !== null },
        { id: 'random', label: 'RANDOM', enabled: true },
        { id: 'end', label: 'END', enabled: conflicts.size === 0 },
      ]);
    }

    const opponentReady = v.ready[other(me)];
    const problem = this.opponentProblem(v);
    let hint: string;
    if (ready) {
      hint = problem ?? `WAITING FOR ${this.opponentName(v)}`;
    } else if (conflicts.size > 0) {
      hint = 'SHIPS MAY NOT TOUCH, NOT EVEN AT CORNERS';
    } else if (Math.floor(this.now / 3000) % 2 === 1) {
      hint =
        problem ??
        (opponentReady
          ? `${this.opponentName(v)} IS READY`
          : `${this.opponentName(v)} IS PLACING SHIPS`);
    } else {
      hint = 'DRAG TO MOVE, R/RIGHT-CLICK TO ROTATE';
    }
    drawHint(ctx, this.g, hint, problem && ready ? C.brightRed : C.white);
  }

  private drawAiming(ctx: CanvasRenderingContext2D, v: PlayerView) {
    const shooter = v.turn;
    const defender = other(shooter);
    const mine = shooter === v.you;
    const aiming = this.canAim();
    const placed = mine ? this.localPending : v.pendingShots;
    this.g = geometry(defender === 1);

    // the last shot fires the salvo: first the shots flash on the chart, with three beeps
    const firing = placed.length === v.shotsAllowed;
    if (firing && this.firing.turn !== v.turnNumber) {
      this.firing = { turn: v.turnNumber, since: this.now };
      sound.play('fire');
    }
    // on with each beep, and off long enough in between to see
    const flash = (this.now - this.firing.since) % FIRE_BEEP_MS < 150;
    const pending = firing && !flash ? [] : placed;

    // the title types out once the READY banner has gone, as in the original
    const [name, rest] = turnTitle(shooter, v.shotsAllowed);
    const title: [string, string][] = [
      [name, playerColour(shooter)],
      [rest, C.brightCyan],
    ];
    drawTitle(ctx, title, this.typeOut(`turn ${v.turnNumber}`, title, this.bannerUntil));
    drawSea(
      ctx,
      this.g,
      {
        owner: defender,
        chartSeed: v.chartSeed,
        shots: v.seas[defender].shots,
        pending,
        cursor: firing ? null : aiming ? this.cursor : mine ? null : this.opponentCursor,
      },
      this.now,
    );
    drawPanel(ctx, this.g, { owner: defender, damage: v.seas[defender].damage }, this.now);

    const left = v.shotsAllowed - placed.length;
    const problem = this.opponentProblem(v);
    if (firing) {
      drawHint(ctx, this.g, 'FIRE!', C.brightYellow);
    } else if (mine) {
      drawHint(
        ctx,
        this.g,
        problem ?? `${plural(left, 'SHOT')} LEFT TO PLACE`,
        problem ? C.brightRed : C.white,
      );
    } else {
      drawHint(
        ctx,
        this.g,
        problem ?? `${this.opponentName(v)} IS TAKING AIM`,
        problem ? C.brightRed : C.white,
      );
    }

    if (this.now < this.bannerUntil) {
      drawMessageBox(ctx, this.g, [
        ['READY', C.black],
        [`PLAYER ${shooter + 1}`, C.black],
      ]);
    }
  }

  private drawOver(ctx: CanvasRenderingContext2D, v: PlayerView) {
    const winner = v.winner!;
    const loser = other(winner);
    if (this.screenName() === 'over-message') {
      this.g = geometry(loser === 1);
      drawSea(
        ctx,
        this.g,
        { owner: loser, chartSeed: v.chartSeed, shots: v.seas[loser].shots },
        this.now,
      );
      drawPanel(ctx, this.g, { owner: loser, damage: v.seas[loser].damage }, this.now);
      const lines: [string, string][] =
        loser === v.you
          ? [
              [`PLAYER ${loser + 1}`, C.black],
              ['YOUR FLEET', C.black],
              ['IS SUNK.', C.black],
              ['YOU LOSE', C.black],
            ]
          : [
              [`PLAYER ${winner + 1}`, C.black],
              ['ENEMY FLEET', C.black],
              ['IS SUNK.', C.black],
              ['YOU WIN!', C.black],
            ];
      drawMessageBox(ctx, this.g, lines, this.typeOut('over', lines, this.stageStart));
      return;
    }

    this.g = geometry(winner === 1);
    const shots = v.seas[winner].shots;
    const ships: ShipMarks[] = (v.revealed?.[winner] ?? []).map((p) => ({
      cells: placementIndices(p).filter((i) => shots[i] !== SEA_HIT),
      colour: C.magenta,
    }));
    drawTitle(ctx, [['THE WINNERS FLEET', C.brightCyan]]);
    drawSea(ctx, this.g, { owner: winner, chartSeed: v.chartSeed, shots, ships }, this.now);
    drawPanel(ctx, this.g, { owner: winner, damage: v.seas[winner].damage }, this.now);
    this.buttons = buttonRow(this.g, [{ id: 'new', label: 'NEW GAME', enabled: true }]);
    drawHint(
      ctx,
      this.g,
      winner === v.you ? 'VICTORY!' : `PLAYER ${winner + 1} WINS`,
      playerColour(winner),
    );
  }

  private isOver(screen: ScreenName): screen is OverStage {
    return (OVER_STAGES as readonly string[]).includes(screen);
  }

  /** Moves on through the end screens when each has run its time. */
  private advanceOverStage(): void {
    const v = this.view;
    if (v?.phase !== 'over') return;
    const elapsed = this.now - this.stageStart;
    const limit =
      this.overStage === 'over-message'
        ? OVER_MESSAGE_MS
        : this.overStage === 'winners'
          ? WINNERS_MS
          : this.overStage === 'sailpast'
            ? sailPastDuration(v.winner!, v.seas[v.winner!].damage)
            : Infinity;
    if (elapsed >= limit) this.nextOverStage();
  }

  private nextOverStage(): void {
    const k = OVER_STAGES.indexOf(this.overStage);
    if (k < OVER_STAGES.length - 1) {
      this.overStage = OVER_STAGES[k + 1]!;
      this.stageStart = this.now;
    }
  }

  // ---- input ----

  pointerDown(x: number, y: number, button: number): void {
    const v = this.view;
    if (!v) return;
    const b = buttonAt(this.buttons, x, y);
    if (b) {
      if (b.enabled) this.press(b.id);
      return;
    }
    const screen = this.screenName();
    if (screen === 'placing' && this.canEdit()) {
      const cell = cellAt(this.g, x, y);
      const hit = cell ? this.shipAt(cellIndex(cell)) : null;
      if (hit !== null && cell) {
        this.selected = hit;
        if (button === 2) {
          this.rotate(hit);
        } else {
          const p = this.draft![hit]!;
          this.drag = { shipId: hit, dx: cell.x - p.x, dy: cell.y - p.y };
        }
        return;
      }
      const slot = slotAt(this.g, x, y);
      if (slot !== null) this.selected = slot;
    } else if (screen === 'aiming' && this.canAim()) {
      const cell = cellAt(this.g, x, y);
      if (cell) {
        this.setCursor(cellIndex(cell));
        this.toggleShot(cellIndex(cell));
      }
    } else if (this.isOver(screen)) {
      this.nextOverStage();
    }
  }

  pointerMove(x: number, y: number): void {
    const v = this.view;
    if (!v) return;
    if (this.drag && this.draft) {
      const cell = cellAt(this.g, x, y);
      if (!cell) return;
      const p = this.draft[this.drag.shipId]!;
      const moved = clampPlacement({ ...p, x: cell.x - this.drag.dx, y: cell.y - this.drag.dy });
      if (moved.x !== p.x || moved.y !== p.y) this.updateShip(moved);
    } else if (this.screenName() === 'aiming' && this.canAim()) {
      const cell = cellAt(this.g, x, y);
      if (cell) this.setCursor(cellIndex(cell));
    }
  }

  pointerUp(): void {
    this.drag = null;
  }

  /** Right-click or mouse wheel: rotate the ship under the pointer, or the selected one. */
  rotateAt(x: number, y: number, direction: 1 | -1 = 1): void {
    if (this.screenName() !== 'placing' || !this.canEdit()) return;
    const cell = cellAt(this.g, x, y);
    const hit = cell ? this.shipAt(cellIndex(cell)) : null;
    if (hit !== null) this.selected = hit;
    if (this.selected !== null) this.rotate(this.selected, direction);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'm' || e.key === 'M') {
      this.toast = sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON';
      this.toastUntil = this.now + 1200;
      return true;
    }
    const v = this.view;
    if (!v) return false;
    const screen = this.screenName();
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const arrow = arrows[e.key];
    if (screen === 'placing' && this.canEdit()) {
      if (arrow && this.selected !== null) {
        const p = this.draft![this.selected]!;
        this.updateShip(clampPlacement({ ...p, x: p.x + arrow[0], y: p.y + arrow[1] }));
      } else if (e.key === 'Tab') {
        this.selected = ((this.selected ?? -1) + (e.shiftKey ? 5 : 1)) % 6;
      } else if (/^[1-6]$/.test(e.key)) {
        this.selected = Number(e.key) - 1;
      } else if ((e.key === 'r' || e.key === 'R' || e.key === ' ') && this.selected !== null) {
        this.rotate(this.selected, e.shiftKey ? -1 : 1);
      } else if (e.key === 'x' || e.key === 'X') {
        this.press('random');
      } else if (e.key === 'Enter') {
        this.press('end');
      } else return false;
      return true;
    }
    if (screen === 'aiming' && this.canAim()) {
      if (arrow) {
        const c = indexCell(this.cursor ?? cellIndex({ x: 10, y: 10 }));
        const n = {
          x: Math.min(19, Math.max(0, c.x + arrow[0])),
          y: Math.min(19, Math.max(0, c.y + arrow[1])),
        };
        this.setCursor(cellIndex(n));
      } else if ((e.key === ' ' || e.key === 'Enter') && this.cursor !== null) {
        this.toggleShot(this.cursor);
      } else return false;
      return true;
    }
    if (this.isOver(screen) && (e.key === 'Enter' || e.key === ' ')) {
      if (screen === 'report') this.press('new');
      else this.nextOverStage();
      return true;
    }
    return false;
  }

  private press(id: string): void {
    switch (id) {
      case 'rotate':
        if (this.selected !== null) this.rotate(this.selected);
        break;
      case 'random':
        if (!this.canEdit()) return;
        this.draft = randomLayout(createRng(randomSeed()));
        this.scheduleDraftSync();
        break;
      case 'end':
        if (this.canEdit() && conflictingShips(this.draft!).size === 0) {
          clearTimeout(this.draftTimer);
          this.send({ t: 'ready', layout: this.draft! });
          this.selected = null;
        }
        break;
      case 'new':
        location.href = '/';
        break;
    }
  }

  /** Whether we are the shooter and still placing shots (the last one fires the salvo). */
  private canAim(): boolean {
    const v = this.view;
    return (
      !!v && v.phase === 'aiming' && v.turn === v.you && this.localPending.length < v.shotsAllowed
    );
  }

  private canEdit(): boolean {
    const v = this.view;
    return !!v && v.phase === 'placing' && !v.ready[v.you] && this.draft !== null;
  }

  private shipAt(cell: number): number | null {
    for (const p of this.draft ?? []) if (placementIndices(p).includes(cell)) return p.shipId;
    return null;
  }

  private rotate(shipId: number, direction: 1 | -1 = 1): void {
    if (!this.canEdit()) return;
    this.updateShip(rotatePlacement(this.draft![shipId]!, direction));
  }

  private updateShip(p: Layout[number]): void {
    this.draft = this.draft!.map((q) => (q.shipId === p.shipId ? p : q));
    this.scheduleDraftSync();
  }

  /** The server keeps the draft so a refresh doesn't lose it; no need to send every drag step. */
  private scheduleDraftSync(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      if (this.canEdit()) this.send({ t: 'draft', layout: this.draft! });
    }, 300);
  }

  private toggleShot(cell: number): void {
    const v = this.view!;
    const defender = other(v.turn);
    if (v.seas[defender].shots[cell] !== SEA_UNKNOWN) return;
    const at = this.localPending.indexOf(cell);
    if (at >= 0) this.localPending.splice(at, 1);
    else if (this.localPending.length < v.shotsAllowed) this.localPending.push(cell);
    else return;
    this.outstanding++;
    this.send({ t: 'toggleShot', cell });
  }

  /** Moves our cursor and tells the opponent, at most every CURSOR_SEND_MS. */
  private setCursor(cell: number): void {
    if (cell === this.cursor) return;
    this.cursor = cell;
    const flush = () => {
      this.cursorSentAt = performance.now();
      this.cursorTimer = undefined;
      this.send({ t: 'cursor', cell: this.cursor });
    };
    const wait = CURSOR_SEND_MS - (performance.now() - this.cursorSentAt);
    if (wait <= 0) flush();
    else if (!this.cursorTimer) this.cursorTimer = setTimeout(flush, wait);
  }

  // ---- test hooks ----

  /** Where on the page a sea cell is, on the sea currently shown. */
  cellPoint(index: number): { x: number; y: number } {
    const c = cellCentre(this.g, index);
    return this.screen.toClient(c.x, c.y);
  }

  buttonPoint(id: string): { x: number; y: number; enabled: boolean } | null {
    const b = this.buttons.find((x) => x.id === id);
    if (!b) return null;
    return { ...this.screen.toClient(b.x + b.w / 2, b.y + b.h / 2), enabled: b.enabled };
  }

  get opponentCursorCell(): number | null {
    return this.opponentCursor;
  }

  get localDraft(): Layout | null {
    return this.draft;
  }

  get you(): PlayerIndex | null {
    return this.view?.you ?? null;
  }
}

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
} from '@bs/shared';
import { drawText } from '../gfx/font.ts';
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
import { drawSalvo, timeline } from './salvo.ts';

type ScreenName = 'connecting' | 'placing' | 'aiming' | 'salvo' | 'over-message' | 'winners';

const BANNER_MS = 1400;
const OVER_MESSAGE_MS = 4000;
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
  /** Turn number we pressed FIRE on; input stays locked until the server moves on. */
  private firedTurn = 0;
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;

  // sequencing
  private bannerUntil = 0;
  private lastTurn = 0;
  private salvoKey = '';
  private salvoStart = 0;
  private events: ReturnType<typeof timeline> = [];
  private overStart = 0;
  private skipOverMessage = false;

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
      this.bannerUntil = now + BANNER_MS;
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
      this.overStart = now;
      this.skipOverMessage = false;
    }
  }

  /**
   * The server rejected something (it resends the view right after). Drop local guesses so the
   * view wins, and unlock FIRE in case that was what failed.
   */
  onServerError(): void {
    this.outstanding = 0;
    this.firedTurn = 0;
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
        return !this.skipOverMessage && this.now - this.overStart < OVER_MESSAGE_MS
          ? 'over-message'
          : 'winners';
    }
  }

  frame(now: number): void {
    this.now = now;
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
        default:
      }
      for (const b of this.buttons) drawButton(ctx, b);
    }

    if (v && !this.connected) {
      drawText(ctx, this.fatalError ?? 'RECONNECTING...', LW - 4, LH - 10, C.brightRed, {
        align: 'right',
      });
    }
    this.screen.present();
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
    const pending = mine ? this.localPending : v.pendingShots;
    this.g = geometry(defender === 1);

    drawTitle(ctx, [
      [`PLAYER ${shooter + 1}`, playerColour(shooter)],
      [` FIRE ${plural(v.shotsAllowed, 'SHOT')} AT NME`, C.brightCyan],
    ]);
    drawSea(
      ctx,
      this.g,
      {
        owner: defender,
        chartSeed: v.chartSeed,
        shots: v.seas[defender].shots,
        pending,
        cursor: aiming ? this.cursor : mine ? null : this.opponentCursor,
      },
      this.now,
    );
    drawPanel(ctx, this.g, { owner: defender, damage: v.seas[defender].damage }, this.now);

    const left = v.shotsAllowed - pending.length;
    const problem = this.opponentProblem(v);
    if (mine) {
      this.buttons = buttonRow(this.g, [
        { id: 'fire', label: 'FIRE', enabled: left === 0 && aiming },
      ]);
      drawHint(
        ctx,
        this.g,
        problem ??
          (left > 0 ? `${plural(left, 'SHOT')} LEFT TO PLACE` : 'ALL SHOTS PLACED - FIRE!'),
        problem ? C.brightRed : left === 0 && blink(this.now, 600) ? C.brightYellow : C.white,
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
      drawMessageBox(ctx, this.g, lines);
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
    } else if (screen === 'over-message') {
      this.skipOverMessage = true;
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
      } else if (e.key === ' ' && this.cursor !== null) {
        this.toggleShot(this.cursor);
      } else if (e.key === 'Enter') {
        this.press('fire');
      } else return false;
      return true;
    }
    if (screen === 'over-message' && (e.key === 'Enter' || e.key === ' ')) {
      this.skipOverMessage = true;
      return true;
    }
    return false;
  }

  private press(id: string): void {
    const v = this.view!;
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
      case 'fire':
        if (this.canAim() && this.localPending.length === v.shotsAllowed) {
          this.firedTurn = v.turnNumber;
          this.send({ t: 'fire' });
        }
        break;
      case 'new':
        location.href = '/';
        break;
    }
  }

  /** Whether we are the shooter and haven't fired yet this turn. */
  private canAim(): boolean {
    const v = this.view;
    return !!v && v.phase === 'aiming' && v.turn === v.you && this.firedTurn !== v.turnNumber;
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

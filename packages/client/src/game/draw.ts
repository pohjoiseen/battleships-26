import {
  BOARD_SIZE,
  FLEET,
  indexCell,
  type PlayerIndex,
  SEA_HIT,
  SEA_MISS,
  shipSize,
} from '@bs/shared';
import { drawChart } from '../gfx/chart.ts';
import { drawDigits, drawText, textWidth } from '../gfx/font.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { drawShipCentred, factionOf, type ShipLook } from '../gfx/ships.ts';
import { cellOrigin, type Geometry, slotRect } from './geometry.ts';

export interface ShipMarks {
  cells: number[];
  colour: string;
}

export interface SeaContent {
  owner: PlayerIndex;
  /** The game's chart seed (see PlayerView). */
  chartSeed: number;
  shots: number[];
  pending?: readonly number[];
  ships?: ShipMarks[];
  cursor?: number | null;
}

const SEA_W = 12 * BOARD_SIZE;

/** Time-based blink, on for half of each period. */
export const blink = (t: number, periodMs = 500) => Math.floor(t / (periodMs / 2)) % 2 === 0;

export function drawSea(ctx: CanvasRenderingContext2D, g: Geometry, sea: SeaContent, t: number) {
  const { seaX, seaY, cell } = g;
  // each player's sea gets its own coastline
  drawChart(ctx, g, (sea.chartSeed + sea.owner * 7919) >>> 0);

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const i = y * BOARD_SIZE + x;
      const o = cellOrigin(g, { x, y });
      const s = sea.shots[i];
      if (s === SEA_MISS || s === SEA_HIT) {
        ctx.fillStyle = s === SEA_HIT ? C.red : C.blue;
        ctx.fillRect(o.x + 1, o.y + 1, cell - 1, cell - 1);
      }
    }
  }
  for (const ship of sea.ships ?? []) {
    ctx.fillStyle = ship.colour;
    for (const i of ship.cells) {
      const o = cellOrigin(g, indexCell(i));
      ctx.fillRect(o.x + 1, o.y + 1, cell - 1, cell - 1);
    }
  }
  // dotted grid, as on the Spectrum
  ctx.fillStyle = C.blue;
  for (let k = 0; k <= BOARD_SIZE; k++) {
    for (let d = 0; d <= SEA_W; d += 2) {
      ctx.fillRect(seaX + k * cell, seaY + d, 1, 1);
      ctx.fillRect(seaX + d, seaY + k * cell, 1, 1);
    }
  }
  for (const i of sea.pending ?? []) drawCross(ctx, g, i, C.blue);
  if (sea.cursor != null) {
    const o = cellOrigin(g, indexCell(sea.cursor));
    ctx.fillStyle = blink(t, 400) ? C.brightWhite : C.black;
    ctx.fillRect(o.x + 1, o.y + 1, cell - 1, cell - 1);
    // the cursor hides the cell under it, so show the shot mark in it if there is one
    if (sea.pending?.includes(sea.cursor)) {
      drawCross(ctx, g, sea.cursor, blink(t, 400) ? C.black : C.brightWhite);
    }
  }

  for (let k = 0; k < BOARD_SIZE; k++) {
    drawDigits(ctx, k, seaX + k * cell + cell / 2, seaY + SEA_W + 3, C.black, 'center');
    const rowY = cellOrigin(g, { x: 0, y: k }).y + 4;
    drawDigits(ctx, k, g.mirrored ? seaX + SEA_W + 3 : seaX - 10, rowY, C.black);
  }
  // the name sits on a dark patch where it overlaps the chart's lower edge
  const name = `SEA OF PLAYER ${sea.owner + 1}`;
  const nameOpts = { align: 'center', bold: true } as const;
  const nameW = textWidth(name, nameOpts);
  ctx.fillStyle = C.black;
  ctx.fillRect(Math.round(seaX + SEA_W / 2 - nameW / 2) - 3, seaY + SEA_W + 10, nameW + 6, 11);
  drawText(ctx, name, seaX + SEA_W / 2, seaY + SEA_W + 12, playerColour(sea.owner), nameOpts);
}

function drawCross(ctx: CanvasRenderingContext2D, g: Geometry, i: number, colour: string) {
  const o = cellOrigin(g, indexCell(i));
  const m = Math.floor(g.cell / 2);
  ctx.fillStyle = colour;
  ctx.fillRect(o.x + 2, o.y + m, g.cell - 3, 1);
  ctx.fillRect(o.x + m, o.y + 2, 1, g.cell - 3);
}

export interface PanelOptions {
  owner: PlayerIndex;
  damage: readonly number[];
  selected?: number | null;
  conflicts?: ReadonlySet<number>;
}

/** The side panel with a picture of each ship of the sea's owner, showing its damage. */
export function drawPanel(ctx: CanvasRenderingContext2D, g: Geometry, p: PanelOptions, t: number) {
  for (const spec of FLEET) {
    const r = slotRect(g, spec.id);
    const look: ShipLook = {
      cls: spec.cls,
      faction: factionOf(p.owner),
      hits: p.damage[spec.id]!,
      size: shipSize(spec.id),
      flip: g.mirrored,
    };
    if (p.selected === spec.id) look.outline = C.brightCyan;
    if (p.conflicts?.has(spec.id) && blink(t, 300)) look.tint = C.brightWhite;
    drawShipCentred(ctx, look, r.x + r.w / 2, r.y + r.h - 8, t);
  }
}

export interface Button {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

/** Lays out buttons left to right along the row under the panel. */
export function buttonRow(
  g: Geometry,
  items: { id: string; label: string; enabled: boolean }[],
): Button[] {
  const gap = 4;
  const r = g.buttons;
  const w = Math.floor((r.w - gap * (items.length - 1)) / items.length);
  return items.map((it, k) => ({ ...it, x: r.x + k * (w + gap), y: r.y, w, h: r.h }));
}

export function drawButton(ctx: CanvasRenderingContext2D, b: Button) {
  ctx.fillStyle = b.enabled ? C.green : C.black;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = b.enabled ? C.brightWhite : C.grey;
  ctx.fillRect(b.x, b.y, b.w, 1);
  ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h);
  ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  drawText(
    ctx,
    b.label,
    b.x + b.w / 2,
    b.y + Math.floor(b.h / 2) - 4,
    b.enabled ? C.brightWhite : C.grey,
    {
      align: 'center',
    },
  );
}

export function buttonAt(buttons: readonly Button[], x: number, y: number): Button | null {
  return buttons.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ?? null;
}

/**
 * Title in segments, e.g. [['PLAYER 1', red], [' FIRE 24 SHOTS AT NME', cyan]], centred. In
 * portrait it is too wide for one line, so what follows the first segment goes on a second.
 */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  segments: [string, string][],
  /** Only this many characters, while it types out. */
  chars = Infinity,
) {
  const opts = { scale: 2 };
  const lines =
    g.portrait && segments.length > 1 ? [segments.slice(0, 1), segments.slice(1)] : [segments];
  let left = chars;
  lines.forEach((line, k) => {
    if (k > 0 && line[0]![0].startsWith(' ')) {
      // the space between the lines is typed, but not drawn
      line = [[line[0]![0].slice(1), line[0]![1]], ...line.slice(1)];
      left--;
    }
    const full = line.map((s) => s[0]).join('');
    let x = Math.round((g.w - textWidth(full, opts)) / 2);
    for (const [text, colour] of line) {
      drawText(ctx, text.slice(0, Math.max(0, left)), x, g.titleY + k * 18, colour, opts);
      x += textWidth(text, opts);
      left -= text.length;
    }
  });
}

export function drawHint(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  text: string,
  colour: string = C.white,
) {
  const x = g.portrait ? g.w / 2 : g.seaX + SEA_W / 2;
  drawText(ctx, text, x, g.hintY, colour, { align: 'center' });
}

/** A framed box in the middle of the sea, like the original's "READY PLAYER 2". */
export function drawMessageBox(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  lines: [string, string][],
  /** Only this many characters, while it types out. */
  chars = Infinity,
) {
  const lineH = 20;
  const w = Math.max(...lines.map(([s]) => textWidth(s, { scale: 2 }))) + 24;
  const h = lines.length * lineH + 16;
  const x = Math.round(g.seaX + SEA_W / 2 - w / 2);
  const y = Math.round(g.seaY + SEA_W / 2 - h / 2);
  ctx.fillStyle = C.brightWhite;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x, y, w, h);
  let left = chars;
  lines.forEach(([text, colour], k) => {
    // typed from where the finished line will start, so it doesn't shift as it grows
    const lx = x + w / 2 - textWidth(text, { scale: 2 }) / 2;
    drawText(ctx, text.slice(0, Math.max(0, left)), lx, y + 10 + k * lineH, colour, { scale: 2 });
    left -= text.length;
  });
}

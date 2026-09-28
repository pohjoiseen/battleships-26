import {
  BOARD_SIZE,
  FLEET,
  indexCell,
  type PlayerIndex,
  SEA_HIT,
  SEA_MISS,
  shipSize,
} from '@bs/shared';
import { drawDigits, drawText, textWidth } from '../gfx/font.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { LW } from '../gfx/screen.ts';
import { drawShip } from '../gfx/ships.ts';
import { cellOrigin, type Geometry, slotRect } from './geometry.ts';

export interface ShipMarks {
  cells: number[];
  colour: string;
}

export interface SeaContent {
  owner: PlayerIndex;
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
  // the chart's paper edge, with room for the axis labels
  const labelSide = g.mirrored ? seaX + SEA_W : seaX - 12;
  ctx.fillStyle = C.cyan;
  ctx.fillRect(Math.min(seaX, labelSide) - 2, seaY - 4, SEA_W + 16, SEA_W + 14);

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
  drawText(
    ctx,
    `SEA OF PLAYER ${sea.owner + 1}`,
    seaX + SEA_W / 2,
    seaY + SEA_W + 12,
    playerColour(sea.owner),
    {
      align: 'center',
      bold: true,
    },
  );
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
    let colour = playerColour(p.owner);
    if (p.selected === spec.id) colour = C.brightBlue;
    if (p.conflicts?.has(spec.id) && blink(t, 300)) colour = C.brightWhite;
    const damage = p.damage[spec.id]! / shipSize(spec.id);
    drawShip(ctx, spec.cls, r.x + 12, r.y + r.h - 8, colour, damage, 1, g.mirrored);
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
  const w = Math.floor((g.panelW - gap * (items.length - 1)) / items.length);
  return items.map((it, k) => ({ ...it, x: g.panelX + k * (w + gap), y: g.buttonsY, w, h: 16 }));
}

export function drawButton(ctx: CanvasRenderingContext2D, b: Button) {
  ctx.fillStyle = b.enabled ? C.green : C.black;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = b.enabled ? C.brightWhite : C.grey;
  ctx.fillRect(b.x, b.y, b.w, 1);
  ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h);
  ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  drawText(ctx, b.label, b.x + b.w / 2, b.y + 4, b.enabled ? C.brightWhite : C.grey, {
    align: 'center',
  });
}

export function buttonAt(buttons: readonly Button[], x: number, y: number): Button | null {
  return buttons.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ?? null;
}

/** Title in segments, e.g. [['PLAYER 1', red], [' FIRE 24 SHOTS AT NME', cyan]], centred. */
export function drawTitle(ctx: CanvasRenderingContext2D, segments: [string, string][]) {
  const opts = { scale: 2 };
  const full = segments.map((s) => s[0]).join('');
  let x = Math.round((LW - textWidth(full, opts)) / 2);
  for (const [text, colour] of segments) {
    drawText(ctx, text, x, 6, colour, opts);
    x += textWidth(text, opts);
  }
}

export function drawHint(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  text: string,
  colour: string = C.white,
) {
  drawText(ctx, text, g.seaX + SEA_W / 2, 291, colour, { align: 'center' });
}

/** A framed box in the middle of the sea, like the original's "READY PLAYER 2". */
export function drawMessageBox(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  lines: [string, string][],
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
  lines.forEach(([text, colour], k) => {
    drawText(ctx, text, x + w / 2, y + 10 + k * lineH, colour, { scale: 2, align: 'center' });
  });
}

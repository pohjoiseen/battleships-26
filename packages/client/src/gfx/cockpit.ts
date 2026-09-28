import { createRng } from '@bs/shared';
import { drawDigits, drawText, textWidth } from './font.ts';
import { C } from './palette.ts';
import { LH, LW } from './screen.ts';

/**
 * The bridge of our ship for the salvo scene, after the original: a window onto the enemy
 * fleet framed by instrument panels, with a console under it. The metal and the instrument
 * housings are drawn once; needles, lamps and readouts move every frame.
 */

/** The window the scene is seen through. */
export const WIN = { x: 38, y: 30, w: 324, h: 196 } as const;

const NOTCH = { x: 124, y: 0, w: 152, h: 24 };
const DISPLAY = { x: 132, y: 234, w: 136, h: 62 };
const LEFT_BOX = { x: 40, y: 234, w: 86, h: 62 };
const RIGHT_BOX = { x: 274, y: 234, w: 86, h: 62 };

type Rect = { x: number; y: number; w: number; h: number };

interface Instrument {
  kind: 'gauge' | 'counter' | 'lamps' | 'bars';
  x: number;
  y: number;
}

/** Instruments down the two side columns, top to bottom. */
const COLUMN: Instrument['kind'][] = [
  'gauge',
  'lamps',
  'counter',
  'bars',
  'gauge',
  'counter',
  'lamps',
  'bars',
];
const INSTRUMENT_H = 34;
const instruments: Instrument[] = [3, 367].flatMap((x) =>
  COLUMN.map((kind, k) => ({ kind, x, y: 12 + k * INSTRUMENT_H })),
);

let frame: HTMLCanvasElement | null = null;

function frameImage(): HTMLCanvasElement {
  if (frame) return frame;
  const c = document.createElement('canvas');
  c.width = LW;
  c.height = LH;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, 1, 1);
  };

  // metal body: plain cyan, riveted along the top bar and the console
  ctx.fillStyle = C.cyan;
  ctx.fillRect(0, 0, LW, LH);
  for (const y of [3, 25, 229, 297]) {
    for (let x = 4; x < LW - 2; x += 8) {
      px(x, y, C.brightWhite);
      px(x + 1, y + 1, C.blue);
    }
  }

  // the window's bevel: dithered shadow on the top and left, highlight on the bottom and right
  const B = 7;
  for (let k = 0; k < B; k++) {
    const x0 = WIN.x - B + k;
    const y0 = WIN.y - B + k;
    const x1 = WIN.x + WIN.w + B - 1 - k;
    const y1 = WIN.y + WIN.h + B - 1 - k;
    for (let x = x0; x <= x1; x++) {
      px(x, y0, (x + k) % 2 === 0 ? C.black : C.blue);
      px(x, y1, k === 0 ? C.brightWhite : (x + k) % 2 === 0 ? C.brightCyan : C.cyan);
    }
    for (let y = y0; y <= y1; y++) {
      px(x0, y, (y + k) % 2 === 0 ? C.black : C.blue);
      px(x1, y, k === 0 ? C.brightWhite : (y + k) % 2 === 0 ? C.brightCyan : C.cyan);
    }
  }
  ctx.clearRect(WIN.x, WIN.y, WIN.w, WIN.h);

  // the notch in the top bar, holding the shooter's name
  box(ctx, NOTCH, C.black, C.brightCyan);
  ctx.fillStyle = C.blue;
  ctx.fillRect(NOTCH.x + 2, NOTCH.y + NOTCH.h - 3, NOTCH.w - 4, 1);

  // side columns
  for (const x of [1, 365])
    box(ctx, { x, y: 8, w: 34, h: COLUMN.length * INSTRUMENT_H + 4 }, C.grey, C.brightWhite);
  for (const ins of instruments) {
    const r = { x: ins.x, y: ins.y, w: 30, h: INSTRUMENT_H - 4 };
    box(ctx, r, C.black, C.white);
    if (ins.kind === 'gauge') {
      circle(ctx, ins.x + 15, ins.y + 15, 11, C.white);
      circle(ctx, ins.x + 15, ins.y + 15, 12, C.grey);
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        px(
          Math.round(ins.x + 15 + Math.cos(t) * 9),
          Math.round(ins.y + 15 + Math.sin(t) * 9),
          C.brightWhite,
        );
      }
    } else if (ins.kind === 'bars') {
      for (const bx of [6, 18]) {
        ctx.fillStyle = C.white;
        ctx.fillRect(ins.x + bx, ins.y + 3, 6, 24);
        ctx.fillStyle = C.black;
        ctx.fillRect(ins.x + bx + 1, ins.y + 4, 4, 22);
        for (let ty = 5; ty < 26; ty += 3) px(ins.x + bx - 2, ins.y + ty, C.white);
      }
    }
  }

  // console: the two readout boxes and the display
  for (const r of [LEFT_BOX, RIGHT_BOX]) {
    box(ctx, r, C.grey, C.brightWhite);
    box(ctx, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: 26 }, C.black, C.white);
    box(ctx, { x: r.x + 4, y: r.y + 34, w: r.w - 8, h: 24 }, C.black, C.white);
    for (let k = 0; k <= 16; k++) {
      ctx.fillStyle = C.brightWhite;
      const tx = r.x + 8 + k * 4.4;
      ctx.fillRect(Math.round(tx), r.y + 38, 1, k % 4 === 0 ? 5 : 3);
      ctx.fillRect(Math.round(tx), r.y + 51, 1, k % 4 === 0 ? 4 : 2);
    }
  }
  box(
    ctx,
    { x: DISPLAY.x - 3, y: DISPLAY.y - 3, w: DISPLAY.w + 6, h: DISPLAY.h + 6 },
    C.blue,
    C.brightCyan,
  );
  box(ctx, DISPLAY, C.green, C.black);
  return (frame = c);
}

function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, edge: string) {
  ctx.fillStyle = edge;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  for (let a = 0; a < r * 8; a++) {
    const t = (a / (r * 8)) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1);
  }
}

export interface CockpitState {
  /** The shooter's name and colour, in the notch at the top. */
  title: string;
  titleColour: string;
  shotsLeft: number;
  hits: number;
  /** Time in ms, for the moving needles and lamps. */
  t: number;
}

/** Draws the frame around the window, and everything on it that moves. */
export function drawCockpit(ctx: CanvasRenderingContext2D, s: CockpitState) {
  ctx.drawImage(frameImage(), 0, 0);

  drawText(ctx, s.title, LW / 2, NOTCH.y + 5, s.titleColour, { align: 'center', scale: 2 });

  for (const [k, ins] of instruments.entries()) {
    // each instrument drifts on its own slow cycle
    const rng = createRng(k + 1);
    const phase = rng.next() * 1000;
    const speed = 0.0004 + rng.next() * 0.0012;
    const v = (Math.sin((s.t + phase * 7) * speed) + 1) / 2;
    if (ins.kind === 'gauge') {
      const a = -Math.PI * 0.8 + v * Math.PI * 1.6 - Math.PI / 2;
      ctx.fillStyle = C.brightRed;
      for (let r = 0; r < 8; r++)
        ctx.fillRect(
          Math.round(ins.x + 15 + Math.cos(a) * r),
          Math.round(ins.y + 15 + Math.sin(a) * r),
          1,
          1,
        );
      ctx.fillStyle = C.brightWhite;
      ctx.fillRect(ins.x + 14, ins.y + 14, 3, 3);
    } else if (ins.kind === 'lamps') {
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const on =
            createRng(k * 97 + j * 3 + i + Math.floor((s.t + phase) / (700 + i * 130))).next() <
            0.5;
          ctx.fillStyle = on ? (j === 1 ? C.brightBlue : C.brightRed) : j === 1 ? C.blue : C.red;
          ctx.fillRect(ins.x + 3 + i * 9, ins.y + 3 + j * 9, 7, 7);
        }
    } else if (ins.kind === 'counter') {
      ctx.fillStyle = C.white;
      ctx.fillRect(ins.x + 3, ins.y + 9, 24, 11);
      drawDigits(
        ctx,
        100 + (Math.floor((s.t + phase * 50) / 900) % 900),
        ins.x + 15,
        ins.y + 12,
        C.black,
        'center',
      );
    } else {
      for (const [n, bx] of [6, 18].entries()) {
        const level = Math.round(22 * ((Math.sin((s.t + phase * 3) * speed * (n + 1)) + 1) / 2));
        ctx.fillStyle = n === 0 ? C.brightRed : C.brightGreen;
        ctx.fillRect(ins.x + bx + 1, ins.y + 26 - level, 4, level);
      }
    }
  }

  // shots still to fly on the left, hits on the right
  readout(ctx, LEFT_BOX, 'SHOTS', s.shotsLeft, s.t, 0);
  readout(ctx, RIGHT_BOX, 'HITS', s.hits, s.t, 1);

  const lines = ['LAUNCH', 'OFFENSIVE', 'STRIKE'];
  lines.forEach((line, k) => {
    const y = DISPLAY.y + 5 + k * 19;
    drawText(ctx, line, LW / 2 + 1, y + 1, C.black, { align: 'center', scale: 2 });
    drawText(ctx, line, LW / 2, y, C.brightYellow, { align: 'center', scale: 2 });
  });
}

function readout(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  value: number,
  t: number,
  k: number,
) {
  drawText(ctx, label, r.x + 8, r.y + 8, C.brightCyan);
  const text = String(value).padStart(2, '0');
  drawText(ctx, text, r.x + r.w - 8 - textWidth(text, { scale: 2 }), r.y + 12, C.brightGreen, {
    scale: 2,
  });
  // a needle wandering along the scale
  const v = (Math.sin(t * (0.0011 + k * 0.0004) + k * 2) + 1) / 2;
  ctx.fillStyle = C.brightRed;
  ctx.fillRect(Math.round(r.x + 8 + v * 70), r.y + 43, 2, 8);
}

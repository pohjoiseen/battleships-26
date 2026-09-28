import type { ShipClass } from '@bs/shared';
import { C } from './palette.ts';
import { drawText } from './font.ts';

/**
 * Placeholder side-on ship silhouettes, built from rectangles. Width is ~100px at scale 1. The
 * art milestone replaces these with proper USA/USSR pixel art and per-hit damage stages.
 */
const PARTS: Record<ShipClass, { hull: number; parts: [number, number, number, number][] }> = {
  // [x, height, width, y-offset above deck]
  carrier: {
    hull: 104,
    parts: [
      [4, 3, 96, 0],
      [62, 6, 10, 3],
      [66, 5, 2, 9],
    ],
  },
  cruiser: {
    hull: 96,
    parts: [
      [14, 4, 10, 0],
      [30, 5, 18, 0],
      [38, 8, 4, 5],
      [54, 4, 12, 0],
      [72, 4, 10, 0],
    ],
  },
  submarine: {
    hull: 88,
    parts: [
      [38, 6, 12, 0],
      [42, 5, 2, 6],
    ],
  },
  destroyer: {
    hull: 80,
    parts: [
      [12, 3, 8, 0],
      [26, 6, 14, 0],
      [32, 6, 3, 6],
      [46, 5, 6, 0],
      [60, 3, 8, 0],
    ],
  },
  torpedo: {
    hull: 60,
    parts: [
      [16, 4, 18, 0],
      [24, 4, 3, 4],
      [40, 2, 8, 0],
    ],
  },
};

/** Width of the longest ship; ships are drawn from the left of a slot this wide. */
const SLOT_W = 104;

/**
 * Draws a ship with its bow to the right. `damage` (0..1) knocks pixels out and lowers the ship
 * in the water; a sunk ship is drawn as an SOS lifebuoy instead.
 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  cls: ShipClass,
  x: number,
  waterline: number,
  colour: string,
  damage: number,
  scale = 1,
  flip = false,
): void {
  if (damage >= 1) {
    // centred on the slot rather than the ship, so a column of wrecks lines up
    drawSos(ctx, x + (SLOT_W * scale) / 2, waterline - 8 * scale, scale);
    return;
  }
  const spec = PARTS[cls];
  const hullH = cls === 'submarine' ? 3 : 5;
  const sink = Math.round(damage * hullH);
  const px = (lx: number, w: number) => (flip ? x + (spec.hull - lx - w) * scale : x + lx * scale);
  ctx.fillStyle = colour;
  // hull: rows from the keel up, tapering towards the bottom (more at the bow); a damaged ship
  // sits lower, so its bottom rows are under water
  for (let row = sink; row < hullH; row++) {
    const taper = hullH - 1 - row;
    const w = spec.hull - taper * 3;
    ctx.fillRect(px(taper, w), waterline - (row - sink + 1) * scale, w * scale, scale);
  }
  const deck = waterline - (hullH - sink) * scale;
  for (const [lx, h, w, off] of spec.parts) {
    ctx.fillRect(px(lx, w), deck - (h + off) * scale, w * scale, h * scale);
  }
  // damage: holes punched through, deterministic per ship class
  if (damage > 0) {
    ctx.fillStyle = C.black;
    const holes = Math.ceil(damage * 10);
    for (let i = 0; i < holes; i++) {
      const hx = (i * 37 + spec.hull * 7) % (spec.hull - 8);
      ctx.fillRect(px(hx + 4, 2), deck - ((i * 5) % 6) * scale, 2 * scale, 2 * scale);
    }
  }
}

export function drawSos(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 1): void {
  ctx.fillStyle = C.brightWhite;
  const r = 7 * scale;
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    const ring = a % 16 < 4 ? C.brightRed : C.brightWhite;
    ctx.fillStyle = ring;
    ctx.fillRect(
      Math.round(cx + Math.cos(t) * r) - scale,
      Math.round(cy + Math.sin(t) * r * 0.6) - scale,
      2 * scale,
      2 * scale,
    );
  }
  drawText(ctx, 'SOS', cx, cy + 8 * scale, C.brightWhite, { align: 'center', scale });
}

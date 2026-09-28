import type { PlayerIndex, ShipClass } from '@bs/shared';
import { createRng } from '@bs/shared';
import { C } from './palette.ts';
import { drawText } from './font.ts';
import { buildSprite, type Faction, Ink, PALETTES, type Sprite } from './shipart.ts';

/** Player 1 sails the Soviet-looking fleet (red band), player 2 the American one (yellow). */
export const factionOf = (p: PlayerIndex): Faction => (p === 0 ? 'ussr' : 'usa');

/** Width of the longest ship; ships are drawn from the left of a slot this wide. */
export const SLOT_W = 106;

export interface ShipLook {
  cls: ShipClass;
  faction: Faction;
  /** Hits taken and the ship's size in cells. */
  hits: number;
  size: number;
  /** Draw the whole silhouette in one colour (hit flash). */
  tint?: string;
  /** Ring the ship with a 1px line of this colour (selection). */
  outline?: string;
  /** Bow to the left. */
  flip?: boolean;
  scale?: number;
}

const sprites = new Map<string, Sprite>();
const images = new Map<string, HTMLCanvasElement>();

function sprite(faction: Faction, cls: ShipClass): Sprite {
  const key = `${faction}/${cls}`;
  let s = sprites.get(key);
  if (!s) sprites.set(key, (s = buildSprite(faction, cls)));
  return s;
}

/** The order hit spots light up in, fixed per class so damage builds up the same way each game. */
function hitOrder(s: Sprite, cls: ShipClass): [number, number][] {
  return createRng(cls.length * 7919 + s.w).shuffle([...s.hitSpots]);
}

/** Rows lost under the water after `hits` of `size` hits. */
function sinkRows(s: Sprite, hits: number, size: number): number {
  return Math.round((hits / size) * s.hullH * 0.6);
}

/** Burns holes and knocks bits off the sprite for each hit. */
function damaged(s: Sprite, cls: ShipClass, hits: number): Uint8Array {
  const px = s.px.slice();
  const rng = createRng(s.w * 31 + cls.length);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < s.w && y < s.h ? y * s.w + x : -1);
  for (const [hx, hy] of hitOrder(s, cls).slice(0, hits)) {
    // wreckage above the hit: most things up there are shot away
    for (let x = hx - 3; x <= hx + 3; x++) {
      for (let y = hy + 3; y < s.h; y++) {
        const i = at(x, y);
        if (i >= 0 && rng.next() < 0.55 - Math.abs(x - hx) * 0.08) px[i] = Ink.None;
      }
    }
    // a scorched hole with a glowing core
    for (let y = hy - 2; y <= hy + 2; y++) {
      for (let x = hx - 3; x <= hx + 3; x++) {
        const i = at(x, y);
        if (i < 0 || px[i] === Ink.None) continue;
        const d = Math.abs(x - hx) / 3 + Math.abs(y - hy) / 2;
        if (d < 0.5) px[i] = Ink.Ember;
        else if (d < 1.2 && rng.next() < 1.3 - d) px[i] = Ink.Scorch;
      }
    }
  }
  return px;
}

function image(look: ShipLook): HTMLCanvasElement {
  const { cls, faction, hits, size, tint = '', outline = '', flip = false } = look;
  const key = `${faction}/${cls}/${hits}/${size}/${tint}/${outline}/${flip ? 1 : 0}`;
  let img = images.get(key);
  if (img) return img;
  const s = sprite(faction, cls);
  const px = damaged(s, cls, hits);
  const sink = sinkRows(s, hits, size);
  const pal = PALETTES[faction];
  // one spare pixel all round for the outline; the bottom one is cut off at the waterline
  img = document.createElement('canvas');
  img.width = s.w + 2;
  img.height = s.h + 1;
  const ctx = img.getContext('2d')!;
  const solid = (x: number, y: number) =>
    x >= 0 && x < s.w && y >= sink && y < s.h && px[y * s.w + x] !== Ink.None;
  // row y of the sprite sits (y - sink) rows above the waterline
  const put = (x: number, y: number) =>
    ctx.fillRect(1 + (flip ? s.w - 1 - x : x), s.h - (y - sink), 1, 1);
  for (let y = sink; y <= s.h; y++) {
    for (let x = -1; x <= s.w; x++) {
      if (solid(x, y)) {
        ctx.fillStyle = tint || pal[px[y * s.w + x]!]!;
        put(x, y);
      } else if (
        outline &&
        (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
      ) {
        ctx.fillStyle = outline;
        put(x, y);
      }
    }
  }
  images.set(key, img);
  return img;
}

/**
 * Draws a ship with its bow to the right (left if flipped), sitting on `waterline`. Each hit
 * leaves a scorched hole, shoots away what's above it and lowers the ship in the water; hit
 * spots burn and smoke over time `t` (ms). A sunk ship is drawn as an SOS lifebuoy instead.
 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  look: ShipLook,
  x: number,
  waterline: number,
  t = 0,
): void {
  const scale = look.scale ?? 1;
  if (look.hits >= look.size) {
    // centred on the slot rather than the ship, so a column of wrecks lines up
    drawSos(ctx, x + (SLOT_W * scale) / 2, waterline - 8 * scale, scale);
    return;
  }
  const img = image(look);
  ctx.drawImage(
    img,
    x - scale,
    waterline - (img.height - 1) * scale,
    img.width * scale,
    img.height * scale,
  );
  if (look.tint || look.hits === 0) return;

  const s = sprite(look.faction, look.cls);
  const sink = sinkRows(s, look.hits, look.size);
  const toScreen = (sx: number, sy: number) => ({
    x: x + (look.flip ? s.w - 1 - sx : sx) * scale,
    y: waterline - (sy - sink + 1) * scale,
  });
  hitOrder(s, look.cls)
    .slice(0, look.hits)
    .forEach(([hx, hy], k) => {
      if (hy - sink < 0) return;
      const base = toScreen(hx, hy + 1);
      drawFire(ctx, base.x, base.y, t + k * 377, scale, look.flip ? 1 : -1);
    });
}

/** Flickering flames and smoke drifting astern (`drift` is the screen direction of the stern). */
function drawFire(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  scale: number,
  drift: number,
) {
  const period = 1600;
  for (let k = 0; k < 4; k++) {
    const p = ((t + (k * period) / 4) % period) / period;
    const px = x + Math.round(drift * p * 9) * scale;
    const py = y - Math.round(p * 14) * scale;
    const r = p < 0.3 ? 1 : p < 0.75 ? 2 : 1;
    ctx.fillStyle = p < 0.5 ? '#3a3a3a' : '#5c5c5c';
    ctx.fillRect(px - (r >> 1) * scale, py - (r >> 1) * scale, r * scale, r * scale);
  }
  const f = Math.floor(t / 90) % 3;
  ctx.fillStyle = C.brightYellow;
  ctx.fillRect(x, y - (f === 0 ? 1 : 0) * scale, scale, scale);
  ctx.fillStyle = '#ff7a00';
  ctx.fillRect(x + (f === 1 ? -1 : 1) * scale, y, scale, scale);
  if (f !== 2) ctx.fillRect(x, y - 2 * scale, scale, scale);
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

import { BOARD_SIZE, createRng } from '@bs/shared';
import type { Geometry } from '../game/geometry.ts';
import { C } from './palette.ts';
import { LH, LW } from './screen.ts';
import { SLOT_W } from './ships.ts';

/**
 * The chart paper under the sea: cyan, with a ragged coastline edge fraying into dithered
 * dots, as in the original. The coastline comes from a seed, so each game (and each player's
 * sea) gets its own, the same on both players' screens.
 */

/** Space kept clear for the title above the sea and the text below it. */
const TOP_LIMIT = 22;
const BOTTOM_LIMIT = 283;
/** The furthest the coast reaches out from the paper the sea needs. */
const MAX_REACH = 16;
/** Dots of the fringe can go this far past the coast. */
const FRINGE = 4;

const cache = new Map<string, HTMLCanvasElement>();

export function drawChart(ctx: CanvasRenderingContext2D, g: Geometry, seed: number) {
  const key = `${seed}/${g.seaX}`;
  let img = cache.get(key);
  if (!img) cache.set(key, (img = renderChart(g, seed)));
  ctx.drawImage(img, 0, 0);
}

function renderChart(g: Geometry, seed: number): HTMLCanvasElement {
  const seaW = g.cell * BOARD_SIZE;
  // the paper everything on the chart needs: the grid, and the axis labels on one side and below
  const x0 = g.mirrored ? g.seaX - 1 : g.seaX - 12;
  const x1 = g.mirrored ? g.seaX + seaW + 12 : g.seaX + seaW;
  const y0 = g.seaY - 2;
  const y1 = g.seaY + seaW + 9;
  const w = x1 - x0;
  const h = y1 - y0;
  const perimeter = 2 * (w + h);

  // things the coast must stay clear of: the ship pictures and the buttons
  const blocked = [
    { x: g.panelX + 8, y: 0, w: SLOT_W + 4, h: g.seaY + seaW },
    { x: g.panelX - 1, y: g.buttonsY - 2, w: g.panelW + 2, h: 20 },
  ];
  const free = (x: number, y: number) =>
    x >= 0 &&
    x < LW &&
    y >= TOP_LIMIT &&
    y <= BOTTOM_LIMIT &&
    !blocked.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

  // the room there is outside each point of the perimeter (clockwise from the top-left corner),
  // taking the tightest spot nearby so the coast bends away from obstacles smoothly
  const pointAt = (t: number) => {
    if (t < w) return { x: x0 + t, y: y0, dx: 0, dy: -1 };
    if (t < w + h) return { x: x1, y: y0 + (t - w), dx: 1, dy: 0 };
    if (t < 2 * w + h) return { x: x1 - (t - w - h), y: y1, dx: 0, dy: 1 };
    return { x: x0, y: y1 - (t - 2 * w - h), dx: -1, dy: 0 };
  };
  const rawRoom = Array.from({ length: perimeter }, (_, t) => {
    const p = pointAt(t);
    let k = 0;
    while (k < MAX_REACH + FRINGE && free(p.x + p.dx * (k + 1), p.y + p.dy * (k + 1))) k++;
    return k;
  });
  const roomAt = (t: number) => {
    let m = Infinity;
    for (let k = -10; k <= 10; k++)
      m = Math.min(m, rawRoom[(((t + k) % perimeter) + perimeter) % perimeter]!);
    return m;
  };
  const room = rawRoom.map((_, t) => roomAt(t));

  // the coast's reach, as smooth noise along the perimeter, pushed towards bays and headlands
  const rng = createRng(seed);
  const knots = (spacing: number) => {
    const n = Math.ceil(perimeter / spacing);
    const v = Array.from({ length: n }, () => rng.next());
    return (t: number) => {
      const f = t / spacing;
      const i = Math.floor(f);
      const k = (1 - Math.cos((f - i) * Math.PI)) / 2;
      return v[((i % n) + n) % n]! * (1 - k) + v[(((i + 1) % n) + n) % n]! * k;
    };
  };
  const coarse = knots(22);
  const medium = knots(9);
  const fine = knots(3);
  const noise = (t: number) => {
    const n = 0.6 * coarse(t) + 0.28 * medium(t) + 0.12 * fine(t);
    return Math.min(1, Math.max(0, (n - 0.5) * 2 + 0.5));
  };

  const img = document.createElement('canvas');
  img.width = LW;
  img.height = LH;
  const ctx = img.getContext('2d')!;
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x0, y0, w + 1, h + 1);

  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const cx = Math.min(Math.max(x, x0), x1);
      const cy = Math.min(Math.max(y, y0), y1);
      if (cx === x && cy === y) continue; // on the paper
      const d = Math.hypot(x - cx, y - cy);
      // position of the nearest paper edge point along the perimeter
      let t: number;
      if (cy === y0 && cx > x0) t = cx - x0;
      else if (cx === x1 && cy < y1) t = w + (cy - y0);
      else if (cy === y1 && cx < x1) t = w + h + (x1 - cx);
      else t = 2 * w + h + (y1 - cy);
      const space = Math.max(0, room[Math.min(t, perimeter - 1)]! - 2);
      const reach = Math.min(MAX_REACH, space) * noise(t) + 0.5;
      if (d <= reach && free(x, y)) {
        ctx.fillStyle = C.cyan;
        ctx.fillRect(x, y, 1, 1);
        continue;
      }
      // beyond the coast: a fringe of dots thinning out, never past the room there is
      const beyond = d - reach;
      if (beyond > FRINGE || !free(x, y)) continue;
      if ((x + y) % 2 !== 0) continue;
      if (hash(x, y, seed) < beyond / FRINGE) continue;
      ctx.fillStyle = C.cyan;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return img;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

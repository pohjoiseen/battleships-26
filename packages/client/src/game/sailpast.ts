import {
  createRng,
  FLEET,
  other,
  type PlayerIndex,
  type PlayerView,
  SEA_HIT,
  SEA_UNKNOWN,
  SHIP_NAMES,
  shipSize,
} from '@bs/shared';
import { drawText, textWidth } from '../gfx/font.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { LH, LW } from '../gfx/screen.ts';
import { drawShip, drawSos, factionOf, shipWidth, spriteX0 } from '../gfx/ships.ts';

/**
 * The victory sail past: the winner's surviving ships steam across a sunset in line ahead,
 * burning where they were hit, with lifebuoys for the ships they lost trailing behind. It ends
 * on the battle report.
 */

const HORIZON = 150;
const WATERLINE = 236;
const SCALE = 2;
/** Logical pixels per ms. */
const SPEED = 0.055;
const GAP = 36;
const BUOY_GAP = 44;
const TITLE = 'VICTORY SAIL PAST';
const TYPE_MS = 70;

const SUN = { x: 300, r: 22 };

interface Column {
  kind: 'ship' | 'buoy';
  shipId: number;
  /** Distance behind the head of the line, and the width it takes up. */
  offset: number;
  w: number;
}

function column(winner: PlayerIndex, damage: readonly number[]): Column[] {
  const faction = factionOf(winner);
  const out: Column[] = [];
  let offset = 0;
  for (const spec of FLEET) {
    if (damage[spec.id]! >= shipSize(spec.id)) continue;
    const w = shipWidth(faction, spec.cls) * SCALE;
    out.push({ kind: 'ship', shipId: spec.id, offset, w });
    offset += w + GAP;
  }
  for (const spec of FLEET) {
    if (damage[spec.id]! < shipSize(spec.id)) continue;
    out.push({ kind: 'buoy', shipId: spec.id, offset, w: 20 });
    offset += 20 + BUOY_GAP;
  }
  return out;
}

/** How long the sail past runs, until the last of the line has left the screen. */
export function sailPastDuration(winner: PlayerIndex, damage: readonly number[]): number {
  const col = column(winner, damage);
  const last = col[col.length - 1]!;
  // the head starts just off the left edge; the tail has to clear the right edge
  const travel = LW + col[0]!.w + last.offset;
  return Math.round(travel / SPEED) + 600;
}

let backdrop: HTMLCanvasElement | null = null;

/** Sky, sun and sea; drawn once. */
function backdropImage(): HTMLCanvasElement {
  if (backdrop) return backdrop;
  const c = document.createElement('canvas');
  c.width = LW;
  c.height = LH;
  const ctx = c.getContext('2d')!;
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  // the sky darkens upwards through sunset colours, dithered like the Spectrum would
  const bands = [C.black, C.blue, C.magenta, C.red, C.brightYellow];
  const glow = 56;
  for (let y = 0; y < HORIZON; y++) {
    const f = Math.max(0, (y - (HORIZON - glow)) / glow) * (bands.length - 1);
    const i = Math.min(bands.length - 2, Math.floor(f));
    const frac = f - i;
    for (let x = 0; x < LW; x++) {
      ctx.fillStyle = frac * 16 > bayer[(y % 4) * 4 + (x % 4)]! ? bands[i + 1]! : bands[i]!;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const rng = createRng(1987);
  for (let k = 0; k < 60; k++) {
    ctx.fillStyle = rng.next() < 0.3 ? C.brightWhite : C.grey;
    ctx.fillRect(rng.int(LW), rng.int(HORIZON - glow - 4), 1, 1);
  }
  // the setting sun, with the stripes of the heat haze across its lower half
  for (let j = 0; j <= SUN.r; j++) {
    const half = Math.round(Math.sqrt(SUN.r * SUN.r - j * j));
    const y = HORIZON - 1 - j;
    if (j < 12 && j % 4 === 1) continue;
    ctx.fillStyle = j < 8 ? C.brightRed : j < 14 ? '#ff7a00' : C.brightYellow;
    ctx.fillRect(SUN.x - half, y, half * 2 + 1, 1);
  }
  ctx.fillStyle = C.blue;
  ctx.fillRect(0, HORIZON, LW, LH - HORIZON);
  ctx.fillStyle = C.magenta;
  ctx.fillRect(0, HORIZON, LW, 1);
  return (backdrop = c);
}

/** The backdrop plus the moving water: wave dashes, and the sun's glitter path. */
function drawScene(ctx: CanvasRenderingContext2D, t: number) {
  ctx.drawImage(backdropImage(), 0, 0);
  const rng = createRng(3);
  for (let k = 0; k < 110; k++) {
    const depth = rng.next() ** 1.5;
    const y = Math.round(HORIZON + 2 + depth * (LH - HORIZON - 4));
    const len = 2 + Math.round(depth * 9);
    const x = (((rng.next() * LW - t * 0.006 * (1 + depth * 3)) % LW) + LW) % LW;
    ctx.fillStyle = rng.next() < 0.25 ? C.cyan : C.brightBlue;
    ctx.fillRect(Math.round(x), y, len, 1);
  }
  // glitter under the sun, widening towards us
  for (let y = HORIZON + 1; y < LH; y += 2) {
    const spread = 6 + (y - HORIZON) * 0.35;
    const n = 1 + Math.floor((y - HORIZON) / 25);
    for (let k = 0; k < n; k++) {
      const r = createRng(y * 31 + k + Math.floor(t / 180) * 977);
      const x = SUN.x + (r.next() - 0.5) * 2 * spread;
      ctx.fillStyle = r.next() < 0.5 ? C.brightYellow : '#ff7a00';
      ctx.fillRect(Math.round(x), y, 2 + Math.round((y - HORIZON) / 30), 1);
    }
  }
}

export function drawSailPast(
  ctx: CanvasRenderingContext2D,
  winner: PlayerIndex,
  damage: readonly number[],
  elapsed: number,
) {
  drawScene(ctx, elapsed);
  const faction = factionOf(winner);
  const col = column(winner, damage);
  const head = -col[0]!.w + elapsed * SPEED;
  for (const item of col) {
    const x = Math.round(head - item.offset);
    if (x > LW || x + item.w < 0) continue;
    const bob = Math.round(Math.sin(elapsed / 500 + item.offset) * 0.6);
    if (item.kind === 'buoy') {
      drawSos(ctx, x + 10, WATERLINE - 10 + bob, 1);
      continue;
    }
    const spec = FLEET[item.shipId]!;
    drawWake(ctx, x, item.w, elapsed);
    // drawShip places the sprite's box; line its visible pixels up with x
    const look = {
      cls: spec.cls,
      faction,
      hits: damage[spec.id]!,
      size: shipSize(spec.id),
      scale: SCALE,
    };
    drawShip(ctx, look, x - spriteX0(faction, spec.cls) * SCALE, WATERLINE + bob, elapsed);
    const name = SHIP_NAMES[spec.cls];
    drawText(ctx, name, x + item.w / 2, WATERLINE + 8, C.white, { align: 'center' });
  }

  const typed = TITLE.slice(0, Math.floor(elapsed / TYPE_MS));
  drawText(ctx, typed, LW / 2 - textWidth(TITLE, { scale: 2 }) / 2, 16, playerColour(winner), {
    scale: 2,
  });
  if (elapsed > TITLE.length * TYPE_MS + 300) {
    drawText(ctx, `THE FLEET OF PLAYER ${winner + 1}`, LW / 2, 38, C.white, { align: 'center' });
  }
}

/** Foam along the waterline and a wake streaming out astern. */
function drawWake(ctx: CanvasRenderingContext2D, x: number, w: number, t: number) {
  const rng = createRng(Math.floor(t / 120));
  ctx.fillStyle = C.brightWhite;
  for (let k = 0; k < 40; k++) {
    const d = rng.next() ** 1.6 * 70;
    const wx = x - d;
    const wy = WATERLINE + 1 + Math.round(rng.next() * (1 + d / 14));
    ctx.fillRect(Math.round(wx), wy, 1 + (d < 20 ? 1 : 0), 1);
  }
  for (let k = 0; k < 8; k++) {
    ctx.fillRect(Math.round(x + w - 4 + rng.next() * 8), WATERLINE + 1 - rng.int(2), 1, 1);
  }
  ctx.fillStyle = C.white;
  for (let wx = x; wx < x + w; wx += 3) ctx.fillRect(wx, WATERLINE + 1, 1, 1);
}

export interface Report {
  shots: [number, number];
  hits: [number, number];
  afloat: [number, number];
}

/** Each player's shooting and what's left of their fleet, from the final view. */
export function report(v: PlayerView): Report {
  const at = (p: PlayerIndex) => v.seas[other(p)].shots;
  const players = [0, 1] as const;
  return {
    shots: players.map((p) => at(p).filter((s) => s !== SEA_UNKNOWN).length) as [number, number],
    hits: players.map((p) => at(p).filter((s) => s === SEA_HIT).length) as [number, number],
    afloat: players.map(
      (p) => FLEET.filter((s) => v.seas[p].damage[s.id]! < shipSize(s.id)).length,
    ) as [number, number],
  };
}

/** The battle report over the sunset, where the hi-score table will go. */
export function drawReport(ctx: CanvasRenderingContext2D, v: PlayerView, elapsed: number) {
  drawScene(ctx, elapsed + 1e6);
  const winner = v.winner!;
  const r = report(v);
  const box = { x: 60, y: 40, w: 280, h: 150 };
  ctx.fillStyle = C.brightWhite;
  ctx.fillRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  ctx.fillStyle = C.black;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  drawText(ctx, 'BATTLE REPORT', LW / 2, box.y + 10, C.brightCyan, { align: 'center', scale: 2 });
  const c1 = box.x + 186;
  const c2 = box.x + 246;
  drawText(ctx, 'P1', c1, box.y + 40, playerColour(0), { align: 'center', bold: true });
  drawText(ctx, 'P2', c2, box.y + 40, playerColour(1), { align: 'center', bold: true });
  const pct = (h: number, s: number) => (s === 0 ? '-' : `${Math.round((100 * h) / s)}%`);
  const rows: [string, string, string][] = [
    ['SHOTS FIRED', String(r.shots[0]), String(r.shots[1])],
    ['HITS', String(r.hits[0]), String(r.hits[1])],
    ['ACCURACY', pct(r.hits[0], r.shots[0]), pct(r.hits[1], r.shots[1])],
    ['SHIPS AFLOAT', String(r.afloat[0]), String(r.afloat[1])],
  ];
  rows.forEach(([label, a, b], k) => {
    const y = box.y + 56 + k * 14;
    drawText(ctx, label, box.x + 16, y, C.white);
    drawText(ctx, a, c1, y, C.white, { align: 'center' });
    drawText(ctx, b, c2, y, C.white, { align: 'center' });
  });
  const verdict = winner === v.you ? 'VICTORY!' : `PLAYER ${winner + 1} WINS`;
  drawText(ctx, verdict, LW / 2, box.y + box.h - 20, playerColour(winner), {
    align: 'center',
    scale: 2,
  });
}

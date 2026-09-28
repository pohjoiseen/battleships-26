import {
  createRng,
  FLEET,
  other,
  type PlayerIndex,
  type PlayerView,
  type Rng,
  shipSize,
} from '@bs/shared';
import { drawCockpit, WIN } from '../gfx/cockpit.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { drawShipCentred, factionOf, type ShipLook, shipWidth } from '../gfx/ships.ts';
import type { Faction } from '../gfx/shipart.ts';

type SalvoView = NonNullable<PlayerView['lastSalvo']>;

/**
 * The salvo scene, after the original: from our bridge we watch the shells leave the bow gun one
 * after another and come down among the enemy fleet. A hit flashes the sky, blows debris up and
 * leaves the ship burning; a miss throws up a column of water. A ship that takes its last hit
 * goes down.
 */

export interface ShotEvent {
  launch: number;
  impact: number;
  /** When the splash or explosion is over. */
  end: number;
  /** Ship id for a hit, null for a miss. */
  ship: number | null;
  /** Where the shell comes down, and which row of ships it's among (0 far, 1 near). */
  x: number;
  y: number;
  row: 0 | 1;
}

// Nominal timings, scaled to the server's duration. With INTRO + OUTRO = 2000 they add up to
// salvoDurationMs(): 350 per shot and 900 more per hit.
const INTRO = 800;
const OUTRO = 1200;
const MISS_GAP = 350;
const HIT_GAP = 1250;
const FLIGHT = 650;
const MISS_FX = 700;
const HIT_FX = 1100;
const SINK_DELAY = 250;
const SINK_TIME = 1400;

const HORIZON = WIN.y + 80;
const ROWS = [HORIZON + 2, HORIZON + 52];
const CENTRES = [WIN.x + 56, WIN.x + WIN.w / 2, WIN.x + WIN.w - 56];

/** Where the six ships lie: carrier, destroyer, cruiser far off; destroyer, torpedo boat, submarine near. */
const SLOTS = [0, 1].flatMap((row) =>
  CENTRES.map((cx) => ({ cx, waterline: ROWS[row]!, row: row as 0 | 1 })),
);
const SLOT_OF_SHIP = [0, 2, 5, 1, 3, 4];
const slotOf = (shipId: number) => SLOTS[SLOT_OF_SHIP[shipId]!]!;

/** Our bow: its tip, and the gun the shells leave from. */
const BOW_TIP = { x: WIN.x + WIN.w / 2, y: WIN.y + WIN.h - 44 };
const MUZZLE = { x: BOW_TIP.x, y: BOW_TIP.y + 20 };

/**
 * Shells land in a shuffled order, so the animation shows which ship each hit struck without
 * giving away which of the placed shots it was.
 */
export function timeline(salvo: SalvoView): ShotEvent[] {
  const rng = createRng(salvo.seed);
  const faction = factionOf(other(salvo.shooter));
  const hits = [...salvo.shipHits];
  const kinds = rng.shuffle([
    ...hits.map(() => 'hit' as const),
    ...salvo.shots.filter((s) => !s.hit).map(() => 'miss' as const),
  ]);
  const k = salvo.durationMs / nominalOf(salvo);
  let t = INTRO;
  return kinds.map((kind) => {
    const launch = t;
    t += kind === 'hit' ? HIT_GAP : MISS_GAP;
    const ship = kind === 'hit' ? hits.shift()! : null;
    const spot = ship !== null ? hitSpot(rng, ship, faction) : missSpot(rng, faction);
    return {
      launch: launch * k,
      impact: (launch + FLIGHT) * k,
      end: (launch + FLIGHT + (kind === 'hit' ? HIT_FX : MISS_FX)) * k,
      ship,
      ...spot,
    };
  });
}

function hitSpot(rng: Rng, shipId: number, faction: Faction) {
  const slot = slotOf(shipId);
  const w = shipWidth(faction, FLEET[shipId]!.cls);
  return {
    x: Math.round(slot.cx + (rng.next() - 0.5) * w * 0.6),
    y: slot.waterline - 3 - rng.int(5),
    row: slot.row,
  };
}

function missSpot(rng: Rng, faction: Faction) {
  if (rng.next() < 0.6) {
    // just short of, beyond, or beside one of the ships
    const id = rng.int(FLEET.length);
    const slot = slotOf(id);
    const half = shipWidth(faction, FLEET[id]!.cls) / 2;
    const side = rng.int(2) === 0 ? -1 : 1;
    const x = slot.cx + side * (half + 4 + rng.int(16));
    return {
      x: Math.round(Math.min(WIN.x + WIN.w - 8, Math.max(WIN.x + 8, x))),
      y: slot.waterline + rng.int(5) - 1,
      row: slot.row,
    };
  }
  // open water
  const y = HORIZON + 6 + rng.int(70);
  return {
    x: WIN.x + 10 + rng.int(WIN.w - 20),
    y,
    row: y < ROWS[1]! - 14 ? (0 as const) : (1 as const),
  };
}

export function drawSalvo(
  ctx: CanvasRenderingContext2D,
  salvo: SalvoView,
  events: ShotEvent[],
  defender: PlayerIndex,
  damageAfter: readonly number[],
  elapsed: number,
) {
  const faction = factionOf(defender);
  const k = salvo.durationMs / nominalOf(salvo);
  const struck = events.filter((e) => e.ship !== null && elapsed >= e.impact);
  const sinceHit = Math.min(...struck.map((e) => elapsed - e.impact));

  ctx.save();
  ctx.beginPath();
  ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h);
  ctx.clip();

  // sky and sea; the sky flashes yellow the moment a shell hits
  ctx.fillStyle = sinceHit < 60 ? C.brightYellow : C.black;
  ctx.fillRect(WIN.x, WIN.y, WIN.w, HORIZON - WIN.y);
  ctx.fillStyle = C.blue;
  ctx.fillRect(WIN.x, HORIZON, WIN.w, WIN.y + WIN.h - HORIZON);
  drawWaves(ctx, elapsed);
  drawPlanes(ctx, salvo.seed, salvo.durationMs, elapsed, faction);

  // damage before the salvo, then each hit as it lands
  const before = FLEET.map(
    (s) => damageAfter[s.id]! - salvo.shipHits.filter((h) => h === s.id).length,
  );
  const landed = FLEET.map(() => 0);
  const sunkAt: (number | null)[] = FLEET.map(() => null);
  for (const e of events) {
    if (e.ship === null || elapsed < e.impact) continue;
    landed[e.ship]!++;
    if (before[e.ship]! + landed[e.ship]! >= shipSize(e.ship)) sunkAt[e.ship] = e.impact;
  }

  for (const row of [0, 1] as const) {
    for (const spec of FLEET) {
      const slot = slotOf(spec.id);
      if (slot.row !== row || before[spec.id]! >= shipSize(spec.id)) continue;
      const size = shipSize(spec.id);
      const look: ShipLook = {
        cls: spec.cls,
        faction,
        hits: Math.min(before[spec.id]! + landed[spec.id]!, size - 1),
        size,
      };
      // the flash turns every ship into a silhouette, then yellow; the one hit keeps flickering
      const mine = struck.filter((e) => e.ship === spec.id).map((e) => elapsed - e.impact);
      const since = Math.min(...mine);
      if (sinceHit < 60) look.tint = C.black;
      else if (sinceHit < 160) look.tint = C.brightYellow;
      else if (since < 450 && Math.floor(since / 60) % 2 === 0) look.tint = C.brightCyan;
      const shake = since < 300 ? (Math.floor(since / 40) % 2 === 0 ? 1 : -1) : 0;
      const sunk = sunkAt[spec.id];
      if (sunk !== null && sunk !== undefined) {
        const p = (elapsed - sunk - SINK_DELAY * k) / (SINK_TIME * k);
        if (p >= 1) continue;
        drawSinking(ctx, look, slot.cx + shake, slot.waterline, Math.max(0, p), elapsed);
        continue;
      }
      drawWake(ctx, slot.cx, slot.waterline, shipWidth(faction, spec.cls));
      drawShipCentred(ctx, look, slot.cx + shake, slot.waterline, elapsed);
    }
    for (const [n, e] of events.entries()) {
      if (e.row !== row || elapsed < e.impact || elapsed > e.end) continue;
      const p = (elapsed - e.impact) / (e.end - e.impact);
      if (e.ship === null) drawSplash(ctx, e.x, e.y, p, row, salvo.seed + n);
      else drawExplosion(ctx, e.x, e.y, p, salvo.seed + n);
    }
  }

  const firing = events.find((e) => elapsed >= e.launch && elapsed < e.launch + 120);
  drawBow(ctx, factionOf(salvo.shooter), firing ? elapsed - firing.launch : null);
  for (const e of events) {
    if (elapsed < e.launch || elapsed >= e.impact) continue;
    drawShell(ctx, e, (elapsed - e.launch) / (e.impact - e.launch));
  }
  ctx.restore();

  drawCockpit(ctx, {
    title: `PLAYER ${salvo.shooter + 1}`,
    titleColour: playerColour(salvo.shooter),
    shotsLeft: events.filter((e) => e.launch > elapsed).length,
    hits: struck.length,
    t: elapsed,
  });
}

const nominalOf = (salvo: SalvoView) =>
  INTRO + OUTRO + MISS_GAP * salvo.shots.length + (HIT_GAP - MISS_GAP) * salvo.shipHits.length;

/** Short dashes of lighter water, longer and faster nearer to us. */
function drawWaves(ctx: CanvasRenderingContext2D, t: number) {
  const rng = createRng(7);
  for (let k = 0; k < 90; k++) {
    const depth = rng.next() ** 1.4;
    const y = Math.round(HORIZON + 3 + depth * (WIN.h - (HORIZON - WIN.y) - 6));
    const len = 2 + Math.round(depth * 7);
    const x0 = rng.next() * WIN.w;
    const x = WIN.x + ((((x0 + t * 0.004 * (1 + depth * 3)) % WIN.w) + WIN.w) % WIN.w);
    ctx.fillStyle = rng.next() < 0.2 ? C.cyan : C.brightBlue;
    ctx.fillRect(Math.round(x), y, len, 1);
  }
}

/** Foam along a ship's waterline. */
function drawWake(ctx: CanvasRenderingContext2D, cx: number, waterline: number, w: number) {
  ctx.fillStyle = C.white;
  for (let x = Math.round(cx - w / 2 - 5); x < cx + w / 2 + 5; x += 2)
    ctx.fillRect(x, waterline + 1, 1, 1);
}

/** A ship going down: it settles by the stern, sliding under, with bubbles where it was. */
function drawSinking(
  ctx: CanvasRenderingContext2D,
  look: ShipLook,
  cx: number,
  waterline: number,
  p: number,
  t: number,
) {
  const drop = Math.round(p * p * 34);
  ctx.save();
  ctx.beginPath();
  ctx.rect(WIN.x, WIN.y, WIN.w, waterline + 1 - WIN.y);
  ctx.clip();
  drawShipCentred(ctx, look, cx, waterline + drop, t);
  ctx.restore();
  const rng = createRng(Math.round(cx));
  ctx.fillStyle = C.brightWhite;
  for (let k = 0; k < 14; k++) {
    const bx = cx + (rng.next() - 0.5) * 70 * (0.4 + p);
    const phase = (t / 300 + rng.next()) % 1;
    if (phase < 0.5) ctx.fillRect(Math.round(bx), waterline + 1 - Math.round(phase * 4), 1, 1);
  }
}

function drawShell(ctx: CanvasRenderingContext2D, e: ShotEvent, p: number) {
  const arc = e.row === 0 ? 86 : 64;
  const at = (q: number) => ({
    x: Math.round(MUZZLE.x + (e.x - MUZZLE.x) * q),
    y: Math.round(MUZZLE.y + (e.y - MUZZLE.y) * q - Math.sin(q * Math.PI) * arc),
  });
  // a dotted smoke trail behind it
  for (let k = 2; k <= 16; k += 2) {
    const q = p - k * 0.022;
    if (q <= 0) break;
    const s = at(q);
    ctx.fillStyle = k < 8 ? C.white : C.grey;
    ctx.fillRect(s.x, s.y, 1, 1);
  }
  const s = at(p);
  ctx.fillStyle = C.brightWhite;
  ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
}

/** A column of water thrown up by a miss, falling back as spray. */
function drawSplash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  row: 0 | 1,
  seed: number,
) {
  const rng = createRng(seed);
  const size = row === 0 ? 14 : 20;
  const rise = Math.sin(Math.min(p * 1.6, 1) * Math.PI);
  for (let dx = -3; dx <= 3; dx++) {
    const h = Math.round(size * rise * (1 - Math.abs(dx) / 4.5) * (0.7 + rng.next() * 0.3));
    if (h <= 0) continue;
    ctx.fillStyle = Math.abs(dx) === 3 ? C.brightCyan : C.brightWhite;
    ctx.fillRect(x + dx, y - h, 1, h);
  }
  // spray falling back after the column peaks
  if (p > 0.3) {
    const q = (p - 0.3) / 0.7;
    for (let k = 0; k < 10; k++) {
      const vx = (rng.next() - 0.5) * 16;
      const top = size * (0.6 + rng.next() * 0.5);
      const sy = y - top + q * q * (top + 4);
      if (sy > y) continue;
      ctx.fillStyle = k % 2 ? C.brightCyan : C.brightWhite;
      ctx.fillRect(Math.round(x + vx * q), Math.round(sy), 1, 1);
    }
  }
  // foam spreading on the water
  ctx.fillStyle = C.brightWhite;
  const foam = Math.round(3 + p * 8);
  for (let fx = -foam; fx <= foam; fx += 2) ctx.fillRect(x + fx, y + 1, 1, 1);
}

/** A fireball, burning debris flying out on arcs, and smoke. */
function drawExplosion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  seed: number,
) {
  const rng = createRng(seed);
  if (p < 0.3) {
    const r = 3 + (p / 0.3) * 9;
    for (let j = -Math.ceil(r); j <= r; j++)
      for (let i = -Math.ceil(r); i <= r; i++) {
        const d = Math.hypot(i, j * 1.3) / r;
        if (d > 1 || (d > 0.7 && (i + j) % 2 !== 0)) continue;
        ctx.fillStyle = d < 0.35 ? C.brightWhite : d < 0.7 ? C.brightYellow : '#ff7a00';
        ctx.fillRect(x + i, y + j, 1, 1);
      }
  }
  const t = p * 1.4;
  for (let k = 0; k < 22; k++) {
    const vx = (rng.next() - 0.5) * 90;
    const vy = -40 - rng.next() * 80;
    const age = t - rng.next() * 0.15;
    if (age <= 0) continue;
    const px = x + vx * age;
    const py = y + vy * age + 70 * age * age;
    if (py > y + 3) continue;
    const colour =
      age < 0.35 ? C.brightYellow : age < 0.7 ? '#ff7a00' : age < 1 ? C.brightRed : C.grey;
    ctx.fillStyle = colour;
    // a short streak along its path
    ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    ctx.fillRect(Math.round(px - vx * 0.02), Math.round(py - (vy + 140 * age) * 0.02), 1, 1);
  }
  if (p > 0.25) {
    const q = (p - 0.25) / 0.75;
    for (let k = 0; k < 6; k++) {
      const sx = x + (rng.next() - 0.5) * 10 - q * 6;
      const sy = y - 4 - q * (14 + rng.next() * 10);
      const r = q < 0.7 ? 2 : 1;
      ctx.fillStyle = k % 2 ? '#3a3a3a' : '#5c5c5c';
      ctx.fillRect(Math.round(sx), Math.round(sy), r, r);
    }
  }
}

/** Our own bow in the foreground, with the gun and the jack of the shooter's side. */
function drawBow(ctx: CanvasRenderingContext2D, faction: Faction, sinceFire: number | null) {
  const { x: cx, y: tip } = BOW_TIP;
  const bottom = WIN.y + WIN.h;
  for (let y = tip; y < bottom; y++) {
    const half = Math.round(104 * ((y - tip) / (bottom - tip)) ** 0.85);
    for (let x = cx - half; x <= cx + half; x++) {
      const edge = x === cx - half || x === cx + half;
      let colour: string;
      if (edge) colour = C.brightWhite;
      else if (x < cx) colour = C.white;
      else if (x === cx) colour = C.grey;
      else colour = (x + y) % 2 === 0 ? C.white : C.grey;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // anchor chains from the hawse pipes back to the capstans
  for (const side of [-1, 1]) {
    for (let k = 0; k <= 12; k += 2) {
      ctx.fillStyle = C.grey;
      ctx.fillRect(cx + side * (3 + Math.round(k * 0.5)), tip + 5 + k, 1, 1);
    }
    const capX = cx + side * 10;
    ctx.fillStyle = C.grey;
    ctx.fillRect(capX - 2, tip + 18, 5, 3);
    ctx.fillStyle = C.brightWhite;
    ctx.fillRect(capX - 1, tip + 18, 3, 1);
  }
  // the breakwater, a chevron pointing forward
  for (let i = -34; i <= 34; i++) {
    const y = tip + 24 + Math.round(Math.abs(i) * 0.3);
    ctx.fillStyle = C.brightWhite;
    ctx.fillRect(cx + i, y, 1, 1);
    ctx.fillStyle = C.grey;
    ctx.fillRect(cx + i, y + 1, 1, 2);
  }
  // the gun: a rounded turret with its barrel pointing out over the bow; it kicks back when it fires
  const top = tip + 33;
  const widths = [12, 18, 22, 24, 26, 26, 26, 26, 26, 26, 26];
  widths.forEach((w, j) => {
    const x0 = cx - w / 2;
    ctx.fillStyle = C.grey;
    ctx.fillRect(x0, top + j, w, 1);
    ctx.fillStyle = C.white;
    ctx.fillRect(x0 + 1, top + j, Math.round(w * 0.55), 1);
  });
  ctx.fillStyle = C.brightWhite;
  ctx.fillRect(cx - 5, top, 6, 1);
  const kick = sinceFire !== null && sinceFire < 80 ? 2 : 0;
  ctx.fillStyle = C.grey;
  ctx.fillRect(cx - 1, MUZZLE.y + kick, 3, top - MUZZLE.y - kick);
  ctx.fillStyle = C.white;
  ctx.fillRect(cx - 1, MUZZLE.y + kick, 1, top - MUZZLE.y - kick);
  ctx.fillStyle = C.black;
  ctx.fillRect(cx, MUZZLE.y + kick, 1, 1);
  if (sinceFire !== null && sinceFire < 110) {
    ctx.fillStyle = sinceFire < 50 ? C.brightWhite : C.brightYellow;
    ctx.fillRect(cx - 2, MUZZLE.y - 4, 5, 3);
    ctx.fillRect(cx - 1, MUZZLE.y - 6, 3, 2);
    ctx.fillStyle = '#ff7a00';
    ctx.fillRect(cx - 3, MUZZLE.y - 2, 1, 1);
    ctx.fillRect(cx + 3, MUZZLE.y - 2, 1, 1);
  }
  // jackstaff at the stem, flying the shooter's jack
  ctx.fillStyle = C.grey;
  ctx.fillRect(cx, tip - 7, 1, 7);
  drawJack(ctx, cx - 5, tip - 7, faction);
}

function drawJack(ctx: CanvasRenderingContext2D, x: number, y: number, faction: Faction) {
  if (faction === 'ussr') {
    ctx.fillStyle = '#e0251b';
    ctx.fillRect(x, y, 5, 3);
    ctx.fillStyle = '#ffd200';
    ctx.fillRect(x, y, 1, 1);
  } else {
    ctx.fillStyle = '#e0251b';
    ctx.fillRect(x, y, 5, 3);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(x, y + 1, 3, 1);
    ctx.fillStyle = '#2a4bb8';
    ctx.fillRect(x + 3, y, 2, 2);
  }
}

/** A jet fighter in side view; '#' is the airframe, 'o' the canopy. */
const PLANE = ['#..........', '##.....o...', '##########.', '.##########', '...###.....'];

/** One or two planes crossing the sky; they take no part in the battle, as in the original. */
function drawPlanes(
  ctx: CanvasRenderingContext2D,
  seed: number,
  duration: number,
  t: number,
  faction: Faction,
) {
  const rng = createRng(seed ^ 0x51ed);
  const count = 1 + rng.int(2);
  for (let k = 0; k < count; k++) {
    const start = rng.next() * duration * 0.6;
    const dir = rng.int(2) === 0 ? 1 : -1;
    const y = WIN.y + 10 + rng.int(40);
    const speed = 0.06 + rng.next() * 0.04;
    const travel = (t - start) * speed;
    if (travel < 0) continue;
    const x = dir === 1 ? WIN.x - 14 + travel : WIN.x + WIN.w + 14 - travel;
    PLANE.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === 'o' ? C.brightCyan : faction === 'usa' ? C.white : '#a3aeb7';
        ctx.fillRect(Math.round(dir === 1 ? x + i : x + PLANE[0]!.length - 1 - i), y + j, 1, 1);
      }),
    );
  }
}

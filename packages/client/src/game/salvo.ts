import { createRng, FLEET, type PlayerIndex, type PlayerView, shipSize } from '@bs/shared';
import { drawText } from '../gfx/font.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { LH, LW } from '../gfx/screen.ts';
import { drawShip } from '../gfx/ships.ts';

type SalvoView = NonNullable<PlayerView['lastSalvo']>;

interface ShotEvent {
  start: number;
  impact: number;
  end: number;
  /** Ship id for a hit, null for a miss. */
  ship: number | null;
  /** Where a miss splashes. */
  splashX: number;
  splashY: number;
}

// Nominal timings; they add up to salvoDurationMs() and are scaled to the server's duration.
const INTRO = 1000;
const MISS = 350;
const HIT = 1250;
const HORIZON = 118;

/** Fixed positions for the six ships: three far away, three closer. */
const SLOTS = [
  { x: 14, waterline: 140, scale: 1 },
  { x: 150, waterline: 136, scale: 1 },
  { x: 290, waterline: 140, scale: 1 },
  { x: 40, waterline: 196, scale: 1 },
  { x: 170, waterline: 192, scale: 1 },
  { x: 300, waterline: 200, scale: 1 },
];

/**
 * Slot for each ship id, arranged as in the original: carrier, destroyer, cruiser at the back;
 * destroyer, torpedo boat, submarine in front.
 */
const SLOT_OF_SHIP = [0, 2, 5, 1, 3, 4];
const slotOf = (shipId: number) => SLOTS[SLOT_OF_SHIP[shipId]!]!;

/**
 * Shots land in a shuffled order, so the animation shows which ship each hit struck without
 * giving away which of the placed shots it was.
 */
export function timeline(salvo: SalvoView): ShotEvent[] {
  const rng = createRng(salvo.seed);
  const hits = [...salvo.shipHits];
  const kinds = rng.shuffle([
    ...hits.map(() => 'hit' as const),
    ...salvo.shots.filter((s) => !s.hit).map(() => 'miss' as const),
  ]);
  const nominal = 2000 + MISS * salvo.shots.length + (HIT - MISS) * hits.length;
  const k = salvo.durationMs / nominal;
  let t = INTRO;
  return kinds.map((kind) => {
    const len = kind === 'hit' ? HIT : MISS;
    const slot = SLOTS[rng.int(SLOTS.length)]!;
    const ev: ShotEvent = {
      start: t * k,
      impact: (t + 280) * k,
      end: (t + len) * k,
      ship: kind === 'hit' ? hits.shift()! : null,
      splashX: slot.x + (rng.int(2) === 0 ? -6 : 106) + rng.int(10),
      splashY: slot.waterline + rng.int(6),
    };
    t += len;
    return ev;
  });
}

export function drawSalvo(
  ctx: CanvasRenderingContext2D,
  salvo: SalvoView,
  events: ShotEvent[],
  defender: PlayerIndex,
  damageAfter: readonly number[],
  elapsed: number,
) {
  const flash = events.some(
    (e) => e.ship !== null && elapsed >= e.impact && elapsed < e.impact + 90,
  );
  ctx.fillStyle = flash ? C.brightWhite : C.black;
  ctx.fillRect(0, 0, LW, HORIZON);
  ctx.fillStyle = flash ? C.brightCyan : C.blue;
  ctx.fillRect(0, HORIZON, LW, LH - HORIZON);

  // a plane or two drifting over, just for the look (as in the original, they don't do anything)
  const planeX = ((elapsed * 0.06 + (salvo.seed % 300)) % (LW + 80)) - 40;
  drawPlane(ctx, planeX, 40 + (salvo.seed % 30));

  const landed = FLEET.map(() => 0);
  for (const e of events) if (e.ship !== null && elapsed >= e.impact) landed[e.ship]!++;
  const before = FLEET.map(
    (s) => damageAfter[s.id]! - salvo.shipHits.filter((h) => h === s.id).length,
  );

  for (const spec of FLEET) {
    const slot = slotOf(spec.id);
    const struck = events.find(
      (e) => e.ship === spec.id && elapsed >= e.impact && elapsed < e.impact + 400,
    );
    const colour =
      struck && Math.floor(elapsed / 60) % 2 === 0 ? C.brightWhite : playerColour(defender);
    const damage = (before[spec.id]! + landed[spec.id]!) / shipSize(spec.id);
    // a sunk ship just leaves empty sea here (the side panel is where its SOS shows)
    if (damage >= 1) continue;
    drawShip(ctx, spec.cls, slot.x, slot.waterline, colour, damage, slot.scale);
  }

  for (const [n, e] of events.entries()) {
    if (elapsed < e.start || elapsed > e.end) continue;
    const target =
      e.ship !== null
        ? { x: slotOf(e.ship).x + 50, y: slotOf(e.ship).waterline - 6 }
        : { x: e.splashX, y: e.splashY };
    if (elapsed < e.impact) {
      // shell in flight from our bow
      const p = (elapsed - e.start) / (e.impact - e.start);
      const x = 200 + (target.x - 200) * p;
      const y = 250 + (target.y - 250) * p - Math.sin(p * Math.PI) * 60;
      ctx.fillStyle = C.brightYellow;
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    } else if (e.ship === null) {
      drawSplash(ctx, target.x, target.y, (elapsed - e.impact) / (e.end - e.impact));
    } else {
      drawDebris(
        ctx,
        target.x,
        target.y,
        (elapsed - e.impact) / (e.end - e.impact),
        salvo.seed + n,
      );
    }
  }

  drawBow(ctx);
  drawText(
    ctx,
    `PLAYER ${salvo.shooter + 1} LAUNCHES OFFENSIVE STRIKE`,
    LW / 2,
    6,
    playerColour(salvo.shooter),
    {
      align: 'center',
      bold: true,
    },
  );
}

function drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, p: number) {
  const h = Math.round(Math.sin(Math.min(p * 1.4, 1) * Math.PI) * 18);
  ctx.fillStyle = C.brightWhite;
  for (const dx of [-3, 0, 3])
    ctx.fillRect(Math.round(x + dx), y - h + Math.abs(dx), 1, h - Math.abs(dx));
}

function drawDebris(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, seed: number) {
  const rng = createRng(seed);
  const t = p * 1.6;
  for (let k = 0; k < 18; k++) {
    const vx = (rng.next() - 0.5) * 120;
    const vy = -40 - rng.next() * 80;
    const px = x + vx * t;
    const py = y + vy * t + 90 * t * t;
    ctx.fillStyle = k % 3 === 0 ? C.brightYellow : k % 3 === 1 ? C.brightRed : C.brightWhite;
    ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
  }
}

function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = C.white;
  const X = Math.round(x);
  ctx.fillRect(X, y, 18, 2);
  ctx.fillRect(X + 6, y - 3, 3, 8);
  ctx.fillRect(X, y - 2, 2, 3);
}

function drawBow(ctx: CanvasRenderingContext2D) {
  for (let row = 0; row < 60; row++) {
    const half = row * 1.6;
    ctx.fillStyle = row % 4 === 0 ? C.grey : C.white;
    ctx.fillRect(Math.round(200 - half), 240 + row, Math.round(half * 2), 1);
  }
}

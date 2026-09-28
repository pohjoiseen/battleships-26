import { FLEET, SHIP_NAMES, shipSize } from '@bs/shared';
import { drawText } from '../gfx/font.ts';
import { C } from '../gfx/palette.ts';
import { drawShip } from '../gfx/ships.ts';
import type { Faction } from '../gfx/shipart.ts';

/**
 * Development page (/art.html): every ship of both fleets at every damage stage, on the black
 * panel and on the salvo scene's sea. `?scale=n` zooms, `?t=ms` freezes the fire animation.
 */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('scale') ?? 3);
const frozen = params.has('t') ? Number(params.get('t')) : null;

const classes = FLEET.filter((s, i) => FLEET.findIndex((o) => o.cls === s.cls) === i);
const COL_W = 118;
const ROW_H = 48;
const factions: Faction[] = ['ussr', 'usa'];
const cols = 7; // up to 6 hits + intact
const W = COL_W * cols + 8;
const H = 14 + factions.length * classes.length * ROW_H;

const canvas = document.querySelector<HTMLCanvasElement>('#sheet')!;
canvas.width = W;
canvas.height = H;
canvas.style.width = `${W * zoom}px`;
canvas.style.height = `${H * zoom}px`;
const ctx = canvas.getContext('2d')!;

function frame(now: number) {
  const t = frozen ?? now;
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, H);
  let row = 0;
  for (const faction of factions) {
    for (const spec of classes) {
      const size = shipSize(spec.id);
      const y = 14 + row * ROW_H;
      // alternate backgrounds: black panel, and the salvo scene's sky over sea
      if (row % 2 === 1) {
        ctx.fillStyle = C.blue;
        ctx.fillRect(0, y + ROW_H - 8, W, 8);
      }
      drawText(ctx, `${faction.toUpperCase()} ${SHIP_NAMES[spec.cls]}`, 4, y + 1, C.white);
      for (let hits = 0; hits <= size; hits++) {
        drawShip(ctx, { cls: spec.cls, faction, hits, size }, 4 + hits * COL_W, y + ROW_H - 8, t);
      }
      row++;
    }
  }
  if (frozen === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

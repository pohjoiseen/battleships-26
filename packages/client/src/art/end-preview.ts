import type { PlayerView } from '@bs/shared';
import { drawReport, drawSailPast, sailPastDuration } from '../game/sailpast.ts';
import { LH, LW } from '../gfx/screen.ts';

/**
 * Development page (/end.html): the victory sail past, then the battle report, in a loop.
 * `?t=ms` freezes it, `?scale=n` zooms, `?winner=1` lets player 2 win.
 */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('scale') ?? 3);
const frozen = params.has('t') ? Number(params.get('t')) : null;
const winner = params.get('winner') === '1' ? 1 : 0;

// the winner lost the submarine and the torpedo boat, and the rest took some hits
const damage = [
  [2, 3, 4, 0, 1, 2],
  [6, 5, 4, 3, 3, 2],
];
const shots = (hits: number, misses: number) =>
  Array.from({ length: 400 }, (_, i) => (i < hits ? 2 : i < hits + misses ? 1 : 0));
const view = {
  you: 0,
  winner,
  seas: [
    { shots: shots(12, 150), damage: damage[winner]! },
    { shots: shots(23, 120), damage: damage[1 - winner]! },
  ],
} as unknown as PlayerView;
const sail = sailPastDuration(winner, damage[winner]!);

const canvas = document.querySelector<HTMLCanvasElement>('#sheet')!;
canvas.width = LW;
canvas.height = LH;
canvas.style.width = `${LW * zoom}px`;
canvas.style.height = `${LH * zoom}px`;
const ctx = canvas.getContext('2d')!;
const start = performance.now();

function frame(now: number) {
  const t = frozen ?? (now - start) % (sail + 4000);
  if (t < sail) drawSailPast(ctx, winner, damage[winner]!, t);
  else drawReport(ctx, view, t - sail);
  if (frozen === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

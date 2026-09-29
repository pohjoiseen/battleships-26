import type { HiscoreEntry, PlayerView } from '@bs/shared';
import { drawSailPast, sailPastDuration } from '../game/sailpast.ts';
import { drawReport, reportLayout } from '../game/report.ts';
import { LH, LW } from '../gfx/screen.ts';

/**
 * Development page (/end.html): the victory sail past, then the battle report, in a loop.
 * `?t=ms` freezes it, `?scale=n` zooms, `?winner=1` lets player 2 win, `?portrait` shows the
 * report as on a phone, `?rank=n` puts your score at that place in the table.
 */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('scale') ?? 3);
const frozen = params.has('t') ? Number(params.get('t')) : null;
const winner = params.get('winner') === '1' ? 1 : 0;
const portrait = params.has('portrait');
const rank = Number(params.get('rank') ?? 3);

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
  hiscores: {
    board: 'original',
    entries: ['NEMO', 'CAPTAIN AHAB', 'NELSON', 'HORNBLOWER', 'DRAKE', 'NIMITZ', 'YAMAMOTO']
      .map((name, k): HiscoreEntry => ({ name, score: 3200 - k * 310, date: 0 }))
      .toSpliced(rank - 1, 0, { name: 'PLAYER 1', score: 1234, date: 0, you: true })
      .slice(0, 10),
    yours: {
      score: 1234,
      name: 'PLAYER 1',
      rank,
      won: winner === 0,
      shots: 143,
      hits: 23,
      sunk: 6,
      afloat: 4,
      salvos: 9,
    },
  },
} as unknown as PlayerView;
const sail = sailPastDuration(winner, damage[winner]!);

const canvas = document.querySelector<HTMLCanvasElement>('#sheet')!;
// the size of the report, which is taller in portrait; the sail past sits at the top
const size = portrait ? reportLayout(true) : { w: LW, h: LH };
canvas.width = size.w;
canvas.height = size.h;
canvas.style.width = `${size.w * zoom}px`;
canvas.style.height = `${size.h * zoom}px`;
const ctx = canvas.getContext('2d')!;
const start = performance.now();

function frame(now: number) {
  const t = frozen ?? (now - start) % (sail + 4000);
  if (t < sail) drawSailPast(ctx, winner, damage[winner]!, t);
  else drawReport(ctx, view, t - sail, portrait);
  if (frozen === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

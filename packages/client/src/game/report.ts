import {
  FLEET,
  other,
  type PlayerIndex,
  type PlayerView,
  POINTS,
  SEA_HIT,
  SEA_UNKNOWN,
  shipSize,
} from '@bs/shared';
import { drawText } from '../gfx/font.ts';
import { C, playerColour } from '../gfx/palette.ts';
import { LW } from '../gfx/screen.ts';
import type { Rect } from './geometry.ts';
import { boardLabel, drawTable, ordinal, ROW_H, TABLE_ROWS } from './hiscores.ts';
import { drawScene } from './sailpast.ts';

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

/**
 * Where things go on the report screen: side by side in landscape (the battle and your score
 * on the left, the table on the right), one under the other in portrait.
 */
interface ReportLayout {
  w: number;
  h: number;
  box: Rect;
  battle: { x: number; y: number; w: number };
  score: { x: number; y: number; w: number };
  table: { x: number; y: number; w: number };
  button: Rect;
}

const LANDSCAPE: ReportLayout = {
  w: LW,
  h: 300,
  box: { x: 10, y: 6, w: 380, h: 260 },
  battle: { x: 22, y: 40, w: 168 },
  score: { x: 22, y: 128, w: 168 },
  table: { x: 206, y: 40, w: 172 },
  button: { x: LW / 2 - 60, y: 276, w: 120, h: 18 },
};

const PORTRAIT: ReportLayout = {
  w: 264,
  h: 482,
  box: { x: 6, y: 6, w: 252, h: 432 },
  battle: { x: 18, y: 40, w: 228 },
  score: { x: 18, y: 120, w: 228 },
  table: { x: 18, y: 212, w: 228 },
  button: { x: 32, y: 448, w: 200, h: 24 },
};

export const reportLayout = (portrait: boolean) => (portrait ? PORTRAIT : LANDSCAPE);

/** The end of the game: who won, how the battle went, your score and the hi-score table. */
export function drawReport(
  ctx: CanvasRenderingContext2D,
  v: PlayerView,
  elapsed: number,
  portrait = false,
) {
  const L = reportLayout(portrait);
  // the sunset, with the sun kept in view on the narrow screen
  ctx.save();
  ctx.translate(Math.round((L.w - LW) / 2), 0);
  drawScene(ctx, elapsed + 1e6, L.h);
  ctx.restore();

  const { box } = L;
  ctx.fillStyle = C.brightWhite;
  ctx.fillRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  ctx.fillStyle = C.black;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const winner = v.winner!;
  const verdict = winner === v.you ? 'VICTORY!' : `PLAYER ${winner + 1} WINS`;
  drawText(ctx, verdict, L.w / 2, box.y + 10, playerColour(winner), { align: 'center', scale: 2 });

  drawBattle(ctx, v, L.battle);
  const flash = Math.floor(elapsed / 300) % 2 === 0;
  const yours = v.hiscores?.yours;
  if (yours) drawScore(ctx, yours, L.score);

  const t = L.table;
  const centre = t.x + t.w / 2;
  drawText(ctx, 'HI-SCORES', centre, t.y, C.brightCyan, { align: 'center', bold: true });
  if (v.hiscores) {
    drawText(ctx, boardLabel(v.hiscores.board), centre, t.y + 12, C.white, { align: 'center' });
    drawTable(ctx, v.hiscores.entries, t.x, t.y + 30, t.w, flash);
    // below the top places, a line for a score that didn't make it
    if (yours && yours.rank > TABLE_ROWS) {
      const y = t.y + 30 + TABLE_ROWS * ROW_H + 4;
      drawText(ctx, `${yours.rank}.`, t.x + 18, y, C.brightYellow, { align: 'right' });
      drawText(ctx, yours.name, t.x + 24, y, C.brightYellow);
      drawText(ctx, String(yours.score), t.x + t.w, y, C.brightYellow, { align: 'right' });
    }
  }
}

function drawBattle(
  ctx: CanvasRenderingContext2D,
  v: PlayerView,
  at: { x: number; y: number; w: number },
) {
  const r = report(v);
  const c2 = at.x + at.w - 6;
  const c1 = c2 - 38;
  drawText(ctx, 'BATTLE REPORT', at.x, at.y, C.brightCyan, { bold: true });
  drawText(ctx, 'P1', c1, at.y, playerColour(0), { align: 'center', bold: true });
  drawText(ctx, 'P2', c2, at.y, playerColour(1), { align: 'center', bold: true });
  const pct = (h: number, s: number) => (s === 0 ? '-' : `${Math.round((100 * h) / s)}%`);
  const rows: [string, string, string][] = [
    ['SHOTS FIRED', String(r.shots[0]), String(r.shots[1])],
    ['HITS', String(r.hits[0]), String(r.hits[1])],
    ['ACCURACY', pct(r.hits[0], r.shots[0]), pct(r.hits[1], r.shots[1])],
    ['SHIPS AFLOAT', String(r.afloat[0]), String(r.afloat[1])],
  ];
  rows.forEach(([label, a, b], k) => {
    const y = at.y + 16 + k * 13;
    drawText(ctx, label, at.x, y, C.white);
    drawText(ctx, a, c1, y, C.white, { align: 'center' });
    drawText(ctx, b, c2, y, C.white, { align: 'center' });
  });
}

/** How the viewer's score adds up. */
function drawScore(
  ctx: CanvasRenderingContext2D,
  s: NonNullable<NonNullable<PlayerView['hiscores']>['yours']>,
  at: { x: number; y: number; w: number },
) {
  drawText(ctx, 'YOUR SCORE', at.x, at.y, C.brightCyan, { bold: true });
  const lines: [string, number][] = [
    [`${s.hits} HITS`, s.hits * POINTS.hit],
    [`${s.sunk} SHIPS SUNK`, s.sunk * POINTS.sink],
  ];
  if (s.won) {
    lines.push(
      ['VICTORY', POINTS.win],
      [`${s.afloat} SHIPS AFLOAT`, s.afloat * POINTS.afloat],
      [
        `ACCURACY ${Math.round((100 * s.hits) / s.shots)}%`,
        Math.round((POINTS.accuracy * s.hits) / s.shots),
      ],
    );
  }
  const right = at.x + at.w - 6;
  lines.forEach(([label, points], k) => {
    const y = at.y + 16 + k * 11;
    drawText(ctx, label, at.x, y, C.white);
    drawText(ctx, String(points), right, y, C.white, { align: 'right' });
  });
  const y = at.y + 16 + lines.length * 11 + 2;
  ctx.fillStyle = C.grey;
  ctx.fillRect(right - 36, y - 3, 36, 1);
  drawText(ctx, `${ordinal(s.rank)} PLACE`, at.x, y + 2, C.brightYellow, { bold: true });
  drawText(ctx, String(s.score), right, y + 2, C.brightYellow, { align: 'right', bold: true });
}

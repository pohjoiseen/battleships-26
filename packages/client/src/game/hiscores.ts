import type { HiscoreEntry } from '@bs/shared';
import { drawText } from '../gfx/font.ts';
import { C } from '../gfx/palette.ts';

/** Who a table is for, as its heading says (boards come from hiscoreBoard). */
export function boardLabel(board: string): string {
  const [opponent, single] = board.split('-');
  const who =
    {
      original: 'VS COMPUTER 1987',
      simple: 'VS COMPUTER 2026',
      strong: 'VS ACE',
      human: '2 PLAYERS',
    }[opponent!] ?? opponent!.toUpperCase();
  return single ? `${who}, SALVO OFF` : who;
}

/** 1ST, 2ND, 3RD, 4TH, ..., 11TH, 12TH, 13TH, 21ST... */
export function ordinal(n: number): string {
  const teen = Math.floor(n / 10) % 10 === 1;
  const suffix = teen ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${n}${suffix}`;
}

export const TABLE_ROWS = 10;
export const ROW_H = 12;

/**
 * A table's rows, `w` wide from `x`: place, name, score. Empty places show dots, and the
 * viewer's own row is yellow, flashing while `flash` is on.
 */
export function drawTable(
  ctx: CanvasRenderingContext2D,
  entries: readonly HiscoreEntry[],
  x: number,
  y: number,
  w: number,
  flash = false,
) {
  for (let k = 0; k < TABLE_ROWS; k++) {
    const e = entries[k];
    const ry = y + k * ROW_H;
    const colour = e?.you ? (flash ? C.brightWhite : C.brightYellow) : e ? C.white : C.grey;
    drawText(ctx, `${k + 1}.`, x + 18, ry, colour, { align: 'right' });
    if (e) {
      drawText(ctx, e.name, x + 24, ry, colour);
      drawText(ctx, String(e.score), x + w, ry, colour, { align: 'right' });
    } else {
      drawText(ctx, '. . . . . . . . .', x + 24, ry, colour);
    }
  }
}

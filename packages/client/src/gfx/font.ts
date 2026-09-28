/** 5x7 glyphs in a 6x8 cell, rows top to bottom. Placeholder until the art pass. */
const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 10001 01010 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 00100 01000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  "'": '00100 00100 01000 00000 00000 00000 00000',
  '/': '00000 00001 00010 00100 01000 10000 00000',
  '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '=': '00000 00000 11111 00000 11111 00000 00000',
  '>': '01000 00100 00010 00001 00010 00100 01000',
  '<': '00010 00100 01000 10000 01000 00100 00010',
  '*': '00000 00100 10101 01110 10101 00100 00000',
  '%': '11000 11001 00010 00100 01000 10011 00011',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

/** 3x5 digits for the sea's axis labels, which have to fit two digits in one 12px cell. */
const DIGITS = [
  '111 101 101 101 111',
  '010 110 010 010 111',
  '111 001 111 100 111',
  '111 001 111 001 111',
  '101 101 111 001 001',
  '111 100 111 001 111',
  '111 100 111 101 111',
  '111 001 010 010 010',
  '111 101 111 101 111',
  '111 101 111 001 111',
];

const parse = (rows: string) => rows.split(' ').map((r) => [...r].map((b) => b === '1'));
const GLYPH_BITS = new Map(Object.entries(GLYPHS).map(([k, v]) => [k, parse(v)]));
const DIGIT_BITS = DIGITS.map(parse);

export interface TextOptions {
  scale?: number;
  /** Draws each glyph twice, one pixel apart, for the chunky Spectrum look. */
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export const GLYPH_W = 6;
export const GLYPH_H = 8;

export function textWidth(text: string, opts: TextOptions = {}): number {
  const scale = opts.scale ?? 1;
  return text.length * (GLYPH_W + (opts.bold ? 1 : 0)) * scale;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  opts: TextOptions = {},
): void {
  const scale = opts.scale ?? 1;
  const advance = (GLYPH_W + (opts.bold ? 1 : 0)) * scale;
  const w = textWidth(text, opts);
  let cx = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
  cx = Math.round(cx);
  ctx.fillStyle = colour;
  for (const ch of text.toUpperCase()) {
    const bits = GLYPH_BITS.get(ch) ?? GLYPH_BITS.get('?')!;
    for (let r = 0; r < bits.length; r++) {
      const row = bits[r]!;
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        ctx.fillRect(cx + c * scale, y + r * scale, scale * (opts.bold ? 2 : 1), scale);
      }
    }
    cx += advance;
  }
}

/** Draws a small number in the 3x5 digits (axis labels), optionally centred on x. */
export function drawDigits(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  colour: string,
  align: 'left' | 'center' = 'left',
): void {
  const text = String(value);
  const w = text.length * 4 - 1;
  let cx = align === 'center' ? Math.round(x - w / 2) : x;
  ctx.fillStyle = colour;
  for (const ch of text) {
    const bits = DIGIT_BITS[Number(ch)]!;
    bits.forEach((row, r) => row.forEach((on, c) => on && ctx.fillRect(cx + c, y + r, 1, 1)));
    cx += 4;
  }
}

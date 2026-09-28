/**
 * Generates packages/client/public/logo.svg: "BATTLE SHIPS" in chunky pixel letters, slanted,
 * dithered from yellow down to red with a blue 3D extrusion, in the spirit of the original's
 * title screen. Run with `npx tsx scripts/make-logo.ts` after changing it.
 */
import { writeFileSync } from 'node:fs';

const GLYPHS: Record<string, string[]> = {
  A: [
    '.#####.',
    '##...##',
    '##...##',
    '##...##',
    '#######',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
  ],
  B: [
    '######.',
    '##...##',
    '##...##',
    '##..##.',
    '######.',
    '##...##',
    '##...##',
    '##...##',
    '######.',
  ],
  T: [
    '#######',
    '#######',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
  ],
  L: [
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
    '#######',
    '#######',
  ],
  E: [
    '#######',
    '##.....',
    '##.....',
    '##.....',
    '######.',
    '##.....',
    '##.....',
    '##.....',
    '#######',
  ],
  S: [
    '.######',
    '##.....',
    '##.....',
    '##.....',
    '.#####.',
    '.....##',
    '.....##',
    '.....##',
    '######.',
  ],
  H: [
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '#######',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
  ],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  P: [
    '######.',
    '##...##',
    '##...##',
    '##...##',
    '######.',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
  ],
};
const TEXT = 'BATTLE SHIPS';
const SCALE = 3;
const GAP = 3;
const SPACE = 12;
const EXTRUDE = 3;
const SLANT = 4; // one pixel to the right for every this many rows up
const PAD = 2;

const glyphH = 9 * SCALE;
// lay the letters out on an upright grid first
const cells: [number, number][] = [];
let x = 0;
for (const ch of TEXT) {
  if (ch === ' ') {
    x += SPACE;
    continue;
  }
  const g = GLYPHS[ch]!;
  g.forEach((row, r) =>
    [...row].forEach((c, col) => {
      if (c !== '#') return;
      for (let dy = 0; dy < SCALE; dy++)
        for (let dx = 0; dx < SCALE; dx++) cells.push([x + col * SCALE + dx, r * SCALE + dy]);
    }),
  );
  x += g[0]!.length * SCALE + GAP;
}
const textW = x - GAP;
const slantW = Math.ceil(glyphH / SLANT);
const W = textW + slantW + EXTRUDE + PAD * 2 + 2;
const H = glyphH + EXTRUDE + PAD * 2 + 2;

const grid: string[][] = Array.from({ length: H }, () => Array<string>(W).fill(''));
const letter = new Set<string>();
const key = (x: number, y: number) => `${x},${y}`;
for (const [cx, cy] of cells) {
  const sx = cx + Math.floor((glyphH - 1 - cy) / SLANT) + PAD + 1;
  letter.add(key(sx, cy + PAD + 1));
}
const inLetter = (x: number, y: number) => letter.has(key(x, y));

const YELLOW = '#ffff00';
const RED = '#ff0000';
const DARK_RED = '#d70000';
const WHITE = '#ffffff';
const BLUE = '#0000d7';
const BRIGHT_BLUE = '#0000ff';
const BLACK = '#000000';

// the extrusion, down and to the right
for (let k = EXTRUDE; k >= 1; k--)
  for (const p of letter) {
    const [lx, ly] = p.split(',').map(Number) as [number, number];
    grid[ly + k]![lx + k] = k === 1 ? BRIGHT_BLUE : BLUE;
  }
// the letters: yellow at the top dithering down to red, a white highlight along top edges
for (const p of letter) {
  const [lx, ly] = p.split(',').map(Number) as [number, number];
  const f = (ly - PAD - 1) / (glyphH - 1);
  const bayer = [0, 2, 3, 1][(lx % 2) + (ly % 2) * 2]! / 4;
  let c =
    f < 0.3
      ? YELLOW
      : f < 0.7
        ? (f - 0.3) / 0.4 > bayer
          ? RED
          : YELLOW
        : f < 0.9
          ? RED
          : DARK_RED;
  if (!inLetter(lx, ly - 1)) c = WHITE;
  grid[ly]![lx] = c;
}
// a black outline round the lot, so it reads on any background
const filled = (x: number, y: number) =>
  grid[y]?.[x] !== undefined && grid[y]![x] !== '' && grid[y]![x] !== BLACK;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (filled(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) near = true;
    if (near) grid[y]![x] = BLACK;
  }

// one rect per horizontal run of a colour
const rects: string[] = [];
for (let y = 0; y < H; y++) {
  let x0 = 0;
  while (x0 < W) {
    const c = grid[y]![x0]!;
    let x1 = x0 + 1;
    while (x1 < W && grid[y]![x1] === c) x1++;
    if (c) rects.push(`<rect x="${x0}" y="${y}" width="${x1 - x0}" height="1" fill="${c}"/>`);
    x0 = x1;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">
<title>Battle Ships</title>
${rects.join('\n')}
</svg>
`;
writeFileSync(new URL('../packages/client/public/logo.svg', import.meta.url), svg);
console.log(`logo.svg: ${W}x${H}, ${rects.length} rects`);

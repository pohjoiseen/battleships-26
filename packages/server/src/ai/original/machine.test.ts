import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type AiState, BOARD, pickTarget, placeFleet, type Pos } from './machine.ts';

/**
 * What the original Z80 code did in the same situations, recorded by running it in an emulator
 * (scripts/original-ai/fixtures.py).
 */
interface Fixtures {
  placements: { rng: number; board: string; rngAfter: number }[];
  picks: {
    board: string;
    planned: [number, number][];
    cursor: [number, number];
    enemyShips: number;
    enemyTorpedoCells: number;
    state: Omit<AiState, 'anchor' | 'resume'> & {
      anchor: [number, number];
      resume: [number, number];
    };
    target: [number, number] | null;
    after: Fixtures['picks'][number]['state'];
  }[];
}

const fixtures = JSON.parse(
  gunzipSync(readFileSync(new URL('./fixtures.json.gz', import.meta.url))).toString(),
) as Fixtures;

const decode = (s: string) =>
  Uint8Array.from(s, (ch) =>
    ch === '.' ? 0 : ch === 'x' ? 0xff : ch >= 'a' ? 0x80 | (ch.charCodeAt(0) - 96) : Number(ch),
  );
const encode = (b: Uint8Array) =>
  [...b]
    .map((v) =>
      v === 0 ? '.' : v === 0xff ? 'x' : v & 0x80 ? 'abcdef'[(v & 0x7f) - 1] : String(v),
    )
    .join('');
const pos = ([d, e]: [number, number]): Pos => ({ d, e });
const pair = (p: Pos): [number, number] => [p.d, p.e];

describe('original AI, against the Z80 code', () => {
  it('places the fleet like the original', () => {
    for (const f of fixtures.placements) {
      const st = { rng: f.rng } as AiState;
      expect(encode(placeFleet(st))).toBe(f.board);
      expect(st.rng).toBe(f.rngAfter);
    }
  });

  it(`picks the same targets in ${fixtures.picks.length} situations`, () => {
    expect(fixtures.picks.length).toBeGreaterThan(0);
    for (const [i, f] of fixtures.picks.entries()) {
      const st: AiState = {
        ...f.state,
        anchor: pos(f.state.anchor),
        resume: pos(f.state.resume),
        shipMark: [...f.state.shipMark],
      };
      const target = pickTarget(st, {
        board: decode(f.board),
        planned: f.planned.map(pos),
        cursor: pos(f.cursor),
        enemyShips: f.enemyShips,
        enemyTorpedoCells: f.enemyTorpedoCells,
      });
      const got = {
        target: target && pair(target),
        after: { ...st, anchor: pair(st.anchor), resume: pair(st.resume) },
      };
      expect(got, `case ${i}`).toEqual({ target: f.target, after: f.after });
    }
  });

  it('decodes boards as 20x20', () => {
    expect(decode(fixtures.picks[0]!.board).length).toBe(BOARD * BOARD);
  });
});

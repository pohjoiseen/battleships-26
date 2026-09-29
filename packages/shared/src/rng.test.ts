import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('rng', () => {
  it('carries on from a saved state', () => {
    const rng = createRng(1234);
    for (let i = 0; i < 10; i++) rng.next();
    const copy = createRng(rng.state());
    expect([copy.next(), copy.next(), copy.int(100)]).toEqual([
      rng.next(),
      rng.next(),
      rng.int(100),
    ]);
  });
});

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): T[];
}

/** Small seeded PRNG (mulberry32), good enough for games and reproducible tests. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[int(items.length)]!;
    },
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [items[i], items[j]] = [items[j]!, items[i]!];
      }
      return items;
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import {
  applyAction,
  CELL_COUNT,
  conflictingShips,
  createGame,
  createRng,
  FLEET,
  type Layout,
  occupancy,
  ORIENTATIONS,
  other,
  placementInBounds,
  placementIndices,
  randomLayout,
  type Rng,
  SEA_HIT,
  SEA_MISS,
  shipSize,
  shotsAllowed,
} from '@bs/shared';
import { createOriginalAi } from './original/index.ts';
import { simpleAi } from './simple.ts';
import { chooseShotsStrong, DEFAULT_STRONG, strongAi } from './strong.ts';
import type { AiPlayer } from './types.ts';

/**
 * Compares the AIs, in parallel over all cores. `npm run bench:ai [N]` (default 240; the
 * strong AI takes a few minutes per column at that). With N games, win rates are good to about
 * +-45/sqrt(N) points and salvo counts to about +-1.6/sqrt(N).
 *
 *   salvos:  mean 24-shot salvos to sink a fleet, random or hugging the edge like people's
 *   vs 2026: win rate against our density AI, both placing their own fleets
 *   vs human-ish: against an opponent who places like a person (hugging the edge) and aims
 *            like the density AI
 *   vs 1987: against the original's AI, which cheats
 */

const AIS: Record<string, () => AiPlayer> = {
  '1987': createOriginalAi,
  '2026': () => simpleAi,
  'ace, no lookahead': () => ({
    placeFleet: randomLayout,
    chooseShots: (request, rng) =>
      chooseShotsStrong(request, rng, { ...DEFAULT_STRONG, candidates: [8] }),
  }),
  ace: () => strongAi,
};

const COLUMNS = ['salvos, random', 'salvos, edgy', 'vs 2026', 'vs human-ish', 'vs 1987'] as const;
type Column = (typeof COLUMNS)[number];

const edge = (i: number) => {
  const x = i % 20;
  const y = Math.floor(i / 20);
  return x === 0 || y === 0 || x === 19 || y === 19;
};

/** Like a person who likes the rim: each ship goes against the edge 75% of the time. */
function edgyLayout(rng: Rng): Layout {
  for (;;) {
    const placed: Layout = [];
    let ok = true;
    for (const spec of FLEET) {
      const wantEdge = rng.next() < 0.75;
      let done = false;
      for (let a = 0; a < 2000 && !done; a++) {
        const p = {
          shipId: spec.id,
          orientation: rng.int(ORIENTATIONS[spec.cls].length),
          x: rng.int(20),
          y: rng.int(20),
        };
        if (!placementInBounds(p)) continue;
        if (wantEdge && !placementIndices(p).some(edge)) continue;
        if (conflictingShips([...placed, p]).size === 0) {
          placed.push(p);
          done = true;
        }
      }
      if (!done) {
        ok = false;
        break;
      }
    }
    if (ok) return placed;
  }
}

function salvosToSink(layout: Layout, ai: AiPlayer, rng: Rng): number {
  const owner = occupancy(layout);
  const sea = new Array<number>(CELL_COUNT).fill(0);
  const damage = FLEET.map(() => 0);
  let salvos = 0;
  while (FLEET.some((s) => damage[s.id]! < shipSize(s.id))) {
    salvos++;
    const left = sea.filter((s) => s === 0).length;
    const request = {
      sea: [...sea],
      damage: [...damage],
      count: Math.min(24, left),
      fleet: layout,
    };
    for (const c of ai.chooseShots(request, rng)) {
      if (owner[c]! >= 0) {
        sea[c] = SEA_HIT;
        damage[owner[c]!]!++;
      } else sea[c] = SEA_MISS;
    }
  }
  return salvos;
}

/** A full game; 1 if `a` wins. Who goes first alternates with the seed. */
function game(a: AiPlayer, b: AiPlayer, seed: number): number {
  const rng = createRng(seed);
  const g = createGame({ salvo: true }, rng);
  g.firstPlayer = seed % 2 === 0 ? 0 : 1;
  const ais = [a, b];
  applyAction(g, { type: 'ready', player: 0, layout: a.placeFleet(rng) }, rng);
  applyAction(g, { type: 'ready', player: 1, layout: b.placeFleet(rng) }, rng);
  while (g.phase !== 'over') {
    const p = g.turn;
    const enemy = g.players[other(p)];
    const request = {
      sea: [...enemy.sea],
      damage: [...enemy.damage],
      count: shotsAllowed(g, p),
      fleet: enemy.layout!,
    };
    for (const cell of ais[p]!.chooseShots(request, rng)) {
      applyAction(g, { type: 'toggleShot', player: p, cell }, rng);
    }
    applyAction(g, { type: 'fire', player: p }, rng);
    applyAction(g, { type: 'advance' }, rng);
  }
  return g.winner === 0 ? 1 : 0;
}

/** Sum over cases [from, to) of one column for one AI. */
function run(name: string, column: Column, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const ai = AIS[name]!();
    if (column === 'salvos, random' || column === 'salvos, edgy') {
      const layout = (column === 'salvos, random' ? randomLayout : edgyLayout)(createRng(1000 + i));
      sum += salvosToSink(layout, ai, createRng(i));
    } else {
      const opponent =
        column === 'vs 2026'
          ? simpleAi
          : column === 'vs 1987'
            ? createOriginalAi()
            : { placeFleet: edgyLayout, chooseShots: simpleAi.chooseShots };
      sum += game(ai, opponent, i);
    }
  }
  return sum;
}

if (process.argv[2] === 'worker') {
  const [name, column, from, to] = process.argv.slice(3);
  process.send!(run(name!, column as Column, Number(from), Number(to)));
} else {
  const N = Number(process.argv[2] ?? 240);
  const workers = cpus().length;
  const part = (name: string, column: Column, w: number) =>
    new Promise<number>((resolve, reject) => {
      const from = Math.floor((N * w) / workers);
      const to = Math.floor((N * (w + 1)) / workers);
      const args = ['worker', name, column, String(from), String(to)];
      const child = fork(new URL(import.meta.url).pathname, args, {
        execArgv: ['--import', 'tsx'],
      });
      child.on('message', (m) => resolve(m as number));
      child.on('error', reject);
    });
  console.log(`${N} fleets or games per cell\n`);
  console.log(['AI'.padEnd(20), ...COLUMNS.map((c) => c.padStart(15))].join(''));
  for (const name of Object.keys(AIS)) {
    const cells: string[] = [];
    for (const column of COLUMNS) {
      const parts = await Promise.all(
        Array.from({ length: workers }, (_, w) => part(name, column, w)),
      );
      const total = parts.reduce((a, b) => a + b, 0);
      cells.push(
        column.startsWith('salvos') ? (total / N).toFixed(2) : `${((total / N) * 100).toFixed(1)}%`,
      );
    }
    console.log([name.padEnd(20), ...cells.map((c) => c.padStart(15))].join(''));
  }
}

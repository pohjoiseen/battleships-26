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
import { chooseShotsByDensity, DEFAULT_DENSITY, simple2Ai, simpleAi } from './simple.ts';
import { chooseShotsStrong, DEFAULT_STRONG, strong2Ai, strongAi } from './strong.ts';
import type { AiPlayer } from './types.ts';

/**
 * Compares the AIs, in parallel over all cores:
 *   npm run bench:ai -- [N] [--no-salvo] [--only name,name]
 * N defaults to 240 (ACE takes a few minutes per column at that). --no-salvo plays with salvo
 * fire off: 4 shots a turn, also in the salvos-to-sink columns (which then count turns). With N games, win rates are good to about
 * +-45/sqrt(N) points and salvo counts to about +-1.6/sqrt(N).
 *
 *   salvos:  mean 24-shot salvos to sink a fleet, random, hugging the edge like people's, or
 *            cornered: the straight ships in the corners, carrier and submarine mid-sea, which
 *            the greedy AIs left alone for turns
 *   1st hit, corn.: mean salvos until the first hit on a cornered fleet
 *   vs 2026: win rate against our density AI, both placing their own fleets
 *   vs human-ish: against an opponent who places like a person (hugging the edge) and aims
 *            like the density AI
 *   vs 1987: against the original's AI, which cheats
 */

const AIS: Record<string, () => AiPlayer> = {
  '1987': createOriginalAi,
  '2026': () => simpleAi,
  '2027': () => simple2Ai,
  'ace-no-lookahead': () => ({
    placeFleet: randomLayout,
    chooseShots: (request, rng) =>
      chooseShotsStrong(request, rng, { ...DEFAULT_STRONG, candidates: [8] }),
  }),
  ace: () => strongAi,
  'ace 2': () => strong2Ai,
};
// trying out hunt powers: --power 1,2,4 adds 2026^1, ace^1, ...
const powers = process.argv.includes('--power')
  ? process.argv[process.argv.indexOf('--power') + 1]!.split(',').map(Number)
  : [];
for (const p of powers) {
  AIS[`2026^${p}`] = () => ({
    placeFleet: randomLayout,
    chooseShots: (request, rng) =>
      chooseShotsByDensity(request, rng, { ...DEFAULT_DENSITY, huntPower: p }),
  });
  AIS[`ace^${p}`] = () => ({
    placeFleet: randomLayout,
    chooseShots: (request, rng) =>
      chooseShotsStrong(request, rng, { ...DEFAULT_STRONG, huntPower: p }),
  });
}

const COLUMNS = [
  'salvos, random',
  'salvos, edgy',
  'salvos, cornered',
  '1st hit, corn.',
  'vs 2026',
  'vs human-ish',
  'vs 1987',
] as const;
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

/** A person exploiting the greedy AIs: straight ships in the corners, the others mid-sea. */
function corneredLayout(rng: Rng): Layout {
  const corners = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = rng.int(i + 1);
    [corners[i], corners[j]] = [corners[j]!, corners[i]!];
  }
  for (;;) {
    const placed: Layout = [];
    for (const spec of FLEET) {
      const straight = spec.cls !== 'carrier' && spec.cls !== 'submarine';
      for (let a = 0; a < 2000; a++) {
        const orientation = rng.int(ORIENTATIONS[spec.cls].length);
        const p = straight
          ? { shipId: spec.id, orientation, x: 0, y: 0 }
          : { shipId: spec.id, orientation, x: 5 + rng.int(8), y: 5 + rng.int(8) };
        if (straight) {
          // put the ship's cell nearest the corner into it
          const corner = corners[placed.filter((q) => q.shipId !== 0 && q.shipId !== 2).length]!;
          const cells = placementIndices(p).map((c) => ({ x: c % 20, y: Math.floor(c / 20) }));
          const cx = corner & 1 ? 19 : 0;
          const cy = corner & 2 ? 19 : 0;
          const end = cells.find((c) =>
            cells.every(
              (d) =>
                Math.abs(d.x - cx) + Math.abs(d.y - cy) >= Math.abs(c.x - cx) + Math.abs(c.y - cy),
            ),
          )!;
          p.x = cx - end.x;
          p.y = cy - end.y;
        }
        if (!placementInBounds(p)) continue;
        if (conflictingShips([...placed, p]).size === 0) {
          placed.push(p);
          break;
        }
      }
    }
    if (placed.length === FLEET.length) return placed;
  }
}

function salvosToSink(layout: Layout, ai: AiPlayer, rng: Rng, toFirstHit = false): number {
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
      count: Math.min(SALVO ? 24 : 4, left),
      fleet: layout,
    };
    for (const c of ai.chooseShots(request, rng)) {
      if (owner[c]! >= 0) {
        sea[c] = SEA_HIT;
        damage[owner[c]!]!++;
      } else sea[c] = SEA_MISS;
    }
    if (toFirstHit && sea.includes(SEA_HIT)) break;
  }
  return salvos;
}

/** A full game; 1 if `a` wins. Who goes first alternates with the seed. */
function game(a: AiPlayer, b: AiPlayer, seed: number): number {
  const rng = createRng(seed);
  const g = createGame({ salvo: SALVO }, rng);
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
    if (column.startsWith('salvos') || column.startsWith('1st hit')) {
      const place =
        column === 'salvos, random'
          ? randomLayout
          : column === 'salvos, edgy'
            ? edgyLayout
            : corneredLayout;
      sum += salvosToSink(place(createRng(1000 + i)), ai, createRng(i), column.startsWith('1st'));
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

const flags = process.argv.slice(2);
const SALVO = !flags.includes('--no-salvo');
const only = flags.includes('--only') ? flags[flags.indexOf('--only') + 1]!.split(',') : null;

if (flags[0] === 'worker') {
  const [name, column, from, to] = flags.slice(1);
  process.send!(run(name!, column as Column, Number(from), Number(to)));
} else {
  const N = Number(flags.find((f) => /^\d+$/.test(f)) ?? 240);
  const workers = cpus().length;
  const part = (name: string, column: Column, w: number) =>
    new Promise<number>((resolve, reject) => {
      const from = Math.floor((N * w) / workers);
      const to = Math.floor((N * (w + 1)) / workers);
      const args = [
        'worker',
        name,
        column,
        String(from),
        String(to),
        ...(SALVO ? [] : ['--no-salvo']),
        ...(powers.length ? ['--power', powers.join()] : []),
      ];
      const child = fork(new URL(import.meta.url).pathname, args, {
        execArgv: ['--import', 'tsx'],
      });
      child.on('message', (m) => resolve(m as number));
      child.on('error', reject);
    });
  console.log(`${N} fleets or games per cell, salvo fire ${SALVO ? 'on' : 'off'}\n`);
  console.log(['AI'.padEnd(20), ...COLUMNS.map((c) => c.padStart(15))].join(''));
  for (const name of Object.keys(AIS).filter((n) => !only || only.includes(n))) {
    const cells: string[] = [];
    for (const column of COLUMNS) {
      const parts = await Promise.all(
        Array.from({ length: workers }, (_, w) => part(name, column, w)),
      );
      const total = parts.reduce((a, b) => a + b, 0);
      cells.push(
        !column.startsWith('vs') ? (total / N).toFixed(2) : `${((total / N) * 100).toFixed(1)}%`,
      );
    }
    console.log([name.padEnd(20), ...cells.map((c) => c.padStart(15))].join(''));
  }
}

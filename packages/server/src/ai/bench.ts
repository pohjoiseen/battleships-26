import {
  applyAction,
  CELL_COUNT,
  createGame,
  conflictingShips,
  createRng,
  FLEET,
  type Layout,
  occupancy,
  ORIENTATIONS,
  placementInBounds,
  placementIndices,
  other,
  randomLayout,
  type Rng,
  shotsAllowed,
  SEA_HIT,
  SEA_MISS,
  shipSize,
} from '@bs/shared';
import { chooseShotsByDensity, type DensityOptions } from './simple.ts';

/**
 * Compares AI settings: mean number of 24-shot salvos it needs to
 * sink a whole fleet, for random fleets and for fleets that hug the edge like people tend to.
 * Run with `npm run bench:ai [fleets per kind]`.
 */

const edge = (i: number) => {
  const x = i % 20,
    y = Math.floor(i / 20);
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

function salvosToSink(layout: Layout, opts: DensityOptions, rng: Rng): number {
  const owner = occupancy(layout);
  const sea = new Array(CELL_COUNT).fill(0);
  const damage = FLEET.map(() => 0);
  let salvos = 0;
  while (FLEET.some((s) => damage[s.id]! < shipSize(s.id))) {
    salvos++;
    const left = sea.filter((s) => s === 0).length;
    for (const c of chooseShotsByDensity({ sea, damage, count: Math.min(24, left) }, rng, opts)) {
      if (owner[c]! >= 0) {
        sea[c] = SEA_HIT;
        damage[owner[c]!]!++;
      } else sea[c] = SEA_MISS;
    }
  }
  return salvos;
}

const N = Number(process.argv[2] ?? 300);
const kinds = { random: randomLayout, edgy: edgyLayout };
const fleets = Object.fromEntries(
  Object.entries(kinds).map(([k, gen]) => [
    k,
    Array.from({ length: N }, (_, i) => gen(createRng(1000 + i))),
  ]),
);
const edgeShare = (ls: Layout[]) =>
  ls.reduce((s, l) => s + l.filter((p) => placementIndices(p).some(edge)).length, 0) /
  (ls.length * 6);
console.log(
  `ships touching the edge: random ${(edgeShare(fleets.random!) * 100).toFixed(0)}%, edgy ${(edgeShare(fleets.edgy!) * 100).toFixed(0)}%`,
);
const configs: [string, DensityOptions][] = [
  ['random hunt + finish off', { edgeBonus: 1, huntRandomly: true }],
  ...[1, 1.5, 2, 3, 4].map((edgeBonus): [string, DensityOptions] => [
    `density, edge bonus ${edgeBonus}`,
    { edgeBonus },
  ]),
];
console.log(
  'AI                        | random fleets | edge-hugging fleets   (mean salvos of 24 to sink all)',
);
for (const [name, opts] of configs) {
  const row = Object.values(fleets).map((ls) => {
    const r = ls.map((l, i) => salvosToSink(l, opts, createRng(i)));
    return (r.reduce((a, b) => a + b, 0) / r.length).toFixed(2);
  });
  console.log(`${name.padEnd(25)} | ${row[0]!.padEnd(13)} | ${row[1]}`);
}

/**
 * Full games between two AIs on random fleets, taking turns to go first. Shot counts drop as
 * ships are lost, so this is closer to real play than salvos-to-sink.
 */
function headToHead(a: DensityOptions, b: DensityOptions, games: number) {
  let aWins = 0;
  let salvos = 0;
  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const g = createGame({ salvo: true }, rng);
    g.firstPlayer = seed % 2 === 0 ? 0 : 1;
    applyAction(g, { type: 'ready', player: 0, layout: randomLayout(rng) }, rng);
    applyAction(g, { type: 'ready', player: 1, layout: randomLayout(rng) }, rng);
    const ais = [a, b];
    while (g.phase !== 'over') {
      const p = g.turn;
      const enemy = g.players[other(p)];
      const request = { sea: [...enemy.sea], damage: [...enemy.damage], count: shotsAllowed(g, p) };
      for (const cell of chooseShotsByDensity(request, rng, ais[p]!)) {
        applyAction(g, { type: 'toggleShot', player: p, cell }, rng);
      }
      applyAction(g, { type: 'fire', player: p }, rng);
      applyAction(g, { type: 'advance' }, rng);
    }
    if (g.winner === 0) aWins++;
    salvos += g.turnNumber / 2;
  }
  return { aWins, meanSalvos: salvos / games };
}

const current = configs.find(([n]) => n.endsWith('edge bonus 3'))![1];
console.log(`\nHead to head, ${N} games each (current AI = density, edge bonus 3):`);
for (const [name, opts] of configs) {
  if (opts === current) continue;
  const { aWins, meanSalvos } = headToHead(current, opts, N);
  console.log(
    `current vs ${name.padEnd(25)} wins ${String(aWins).padStart(3)}/${N} ` +
      `(${((aWins / N) * 100).toFixed(0)}%), ~${meanSalvos.toFixed(1)} salvos each`,
  );
}

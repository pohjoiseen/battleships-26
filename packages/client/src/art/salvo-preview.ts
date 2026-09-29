import { type Salvo, salvoDurationMs } from '@bs/shared';
import { drawSalvo, timeline } from '../game/salvo.ts';
import { cockpitLayout } from '../gfx/cockpit.ts';

/**
 * Development page (/salvo.html): plays a made-up salvo in a loop. `?t=ms` freezes it at that
 * moment, `?scale=n` zooms, `?shooter=1` swaps the sides, `?portrait` shows the tall bridge.
 */
const params = new URLSearchParams(location.search);
const zoom = Number(params.get('scale') ?? 3);
const frozen = params.has('t') ? Number(params.get('t')) : null;
const shooter = params.get('shooter') === '1' ? 1 : 0;
const portrait = params.has('portrait');
const { w, h } = cockpitLayout(portrait);

// 24 shots, 5 hits; the torpedo boat takes its second hit and sinks
const shipHits = [5, 1, 5, 3, 0];
const shots = Array.from({ length: 24 }, (_, i) => ({ cell: i * 13, hit: i < shipHits.length }));
const base: Salvo = { shooter, turnNumber: 3, shots, shipHits, sunk: [5], seed: 42 };
const salvo = { ...base, durationMs: salvoDurationMs(base) };
const damageAfter = [1, 1, 0, 1, 0, 2];
const events = timeline(salvo);

const canvas = document.querySelector<HTMLCanvasElement>('#sheet')!;
canvas.width = w;
canvas.height = h;
canvas.style.width = `${w * zoom}px`;
canvas.style.height = `${h * zoom}px`;
const ctx = canvas.getContext('2d')!;
const start = performance.now();

function frame(now: number) {
  const t = frozen ?? (now - start) % (salvo.durationMs + 1000);
  drawSalvo(ctx, salvo, events, shooter === 0 ? 1 : 0, damageAfter, t, portrait);
  if (frozen === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for poking at from the console
Object.assign(window, { salvoEvents: events });

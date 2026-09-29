import type { AiKind, AisResponse, CreateGameResponse } from '@bs/shared';
import { drawScene } from './game/sailpast.ts';
import { drawSplash } from './game/salvo.ts';
import { drawText } from './gfx/font.ts';
import { C } from './gfx/palette.ts';
import { isPortrait, LH, LW, Screen } from './gfx/screen.ts';
import { drawShipCentred } from './gfx/ships.ts';
import { sound } from './gfx/sound.ts';

/**
 * The title and menu, drawn like the game on a 400x300 screen scaled to the window: the logo
 * over the sunset, a Soviet and an American cruiser trading shots, and the original's numbered
 * menu. Invisible buttons lie over the menu rows, so it works with screen readers and tabbing.
 * In a portrait window the screen is taller, with bigger rows that are easier to tap.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const status = document.querySelector<HTMLElement>('#status')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('#menu button')];
const screen = new Screen(canvas);
const ctx = screen.ctx;

const logo = new Image();
logo.src = '/logo.svg';

let salvo = true;
/** The computer players, as the menu names them: the original's, ported from the Z80 code, and ours. */
let AIS: readonly { id: AiKind; label: string }[] = [
  { id: 'original', label: '1987' },
  { id: 'simple', label: '2026' },
  { id: 'strong', label: 'ACE' },
];
let ai = 0;

// the server may offer fewer (ACE is heavy for a small server); if it can't say, offer all
void fetch('/api/ais')
  .then((res) => (res.ok ? (res.json() as Promise<AisResponse>) : null))
  .then((offered) => {
    const ais = offered && AIS.filter((a) => offered.ais.includes(a.id));
    if (ais?.length) {
      AIS = ais;
      ai = 0;
      syncButtons();
    }
  })
  .catch(() => {});

let selected = 0;
const touch = matchMedia('(pointer: coarse)').matches;
let message = '';

interface Layout {
  h: number;
  menu: { x: number; y: number; w: number; h: number };
  rowH: number;
  /** Top of the credits band at the bottom. */
  creditsY: number;
}
const LANDSCAPE: Layout = {
  h: LH,
  menu: { x: 64, y: 172, w: 272, h: 80 },
  rowH: 15,
  creditsY: 256,
};
const PORTRAIT: Layout = {
  h: 410,
  menu: { x: 44, y: 190, w: 312, h: 160 },
  rowH: 30,
  creditsY: 366,
};
let L = LANDSCAPE;
const rowY = (i: number) => L.menu.y + 5 + i * L.rowH;

const items = () => [
  '1 PLAYER',
  '2 PLAYERS',
  `COMPUTER   - ${AIS[ai]!.label}`,
  `SALVO FIRE - ${salvo ? 'ON' : 'OFF'}`,
  `SOUND      - ${sound.muted ? 'OFF' : 'ON'}`,
];

/** Picks the layout for the window; the buttons sit over their rows, in percentages of the screen. */
function layOut() {
  L = isPortrait() ? PORTRAIT : LANDSCAPE;
  screen.setSize(LW, L.h);
  buttons.forEach((b, i) => {
    Object.assign(b.style, {
      left: `${(L.menu.x / LW) * 100}%`,
      top: `${((rowY(i) - 1) / L.h) * 100}%`,
      width: `${(L.menu.w / LW) * 100}%`,
      height: `${(L.rowH / L.h) * 100}%`,
    });
  });
}
layOut();
window.addEventListener('resize', layOut);

buttons.forEach((b, i) => {
  b.addEventListener('pointerenter', () => select(i));
  b.addEventListener('focus', () => select(i));
  b.addEventListener('click', () => activate(i));
});

function select(i: number) {
  if (i !== selected) sound.play('type');
  selected = i;
}

function activate(i: number) {
  sound.unlock();
  select(i);
  if (i === 0) void start('1p');
  else if (i === 1) void start('2p');
  else if (i === 2) ai = (ai + 1) % AIS.length;
  else if (i === 3) salvo = !salvo;
  else sound.toggleMute();
  syncButtons();
}

/** Keeps the toggles' labels and pressed states in step with the drawn menu. */
function syncButtons() {
  buttons[3]!.setAttribute('aria-pressed', String(salvo));
  buttons[4]!.setAttribute('aria-pressed', String(!sound.muted));
  for (const i of [2, 3, 4]) buttons[i]!.textContent = items()[i]!.replace(/ +/g, ' ');
}
syncButtons();

async function start(mode: '1p' | '2p') {
  message = 'STARTING...';
  status.textContent = message;
  try {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, salvo, ai: AIS[ai]!.id }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { url } = (await res.json()) as CreateGameResponse;
    location.href = url;
  } catch {
    message = 'COULD NOT REACH THE SERVER';
    status.textContent = message;
  }
}

// Keys as on the original menu: the numbers pick an item; arrows move, Enter chooses (on the
// focused button); C, S and M toggle the computer player, salvo fire and sound.
window.addEventListener('keydown', (e) => {
  sound.unlock();
  const n = Number(e.key);
  if (n >= 1 && n <= buttons.length) activate(n - 1);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const i = (selected + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[i]!.focus();
    select(i);
  } else if (e.key === 'c' || e.key === 'C') activate(2);
  else if (e.key === 's' || e.key === 'S') activate(3);
  else if (e.key === 'm' || e.key === 'M') activate(4);
  else return;
  e.preventDefault();
});
window.addEventListener('pointerdown', () => sound.unlock());

// ---- drawing ----

const SHIPS = [
  { cx: 92, faction: 'ussr' as const, flip: false },
  { cx: 312, faction: 'usa' as const, flip: true },
];
const WATERLINE = 168;
const VOLLEY_MS = 3000;

/** Every few seconds one cruiser fires at the other, and the shell falls just short. */
function drawDuel(t: number) {
  const volley = Math.floor(t / VOLLEY_MS);
  const p = t % VOLLEY_MS;
  const from = SHIPS[volley % 2]!;
  const to = SHIPS[(volley + 1) % 2]!;
  const dir = from.flip ? -1 : 1;
  SHIPS.forEach((s, k) => {
    const bob = Math.round(Math.sin(t / 700 + k * 2) * 0.6);
    drawShipCentred(
      ctx,
      { cls: 'cruiser', faction: s.faction, hits: 0, size: 5, flip: s.flip },
      s.cx,
      WATERLINE + bob,
      t,
    );
  });
  const gun = { x: from.cx + dir * 34, y: WATERLINE - 10 };
  const fall = { x: to.cx - dir * (58 + (volley % 3) * 6), y: WATERLINE + 2 };
  if (p < 120) {
    ctx.fillStyle = p < 60 ? C.brightWhite : C.brightYellow;
    ctx.fillRect(gun.x - 1 + dir * 2, gun.y - 2, 4, 3);
  }
  const flight = [100, 1100];
  if (p >= flight[0]! && p < flight[1]!) {
    const q = (p - flight[0]!) / (flight[1]! - flight[0]!);
    const at = (r: number) => ({
      x: Math.round(gun.x + (fall.x - gun.x) * r),
      y: Math.round(gun.y + (fall.y - gun.y) * r - Math.sin(r * Math.PI) * 50),
    });
    for (let k = 2; k <= 12; k += 2) {
      const r = q - k * 0.025;
      if (r <= 0) break;
      const s = at(r);
      ctx.fillStyle = k < 6 ? C.white : C.grey;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    const s = at(q);
    ctx.fillStyle = C.brightWhite;
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
  } else if (p >= flight[1]! && p < flight[1]! + 800) {
    drawSplash(ctx, fall.x, fall.y, (p - flight[1]!) / 800, 1, volley);
  }
}

function drawMenu() {
  const menu = L.menu;
  ctx.fillStyle = C.red;
  ctx.fillRect(menu.x - 2, menu.y - 2, menu.w + 4, menu.h + 4);
  ctx.fillStyle = C.black;
  ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
  items().forEach((label, i) => {
    if (i === selected) {
      ctx.fillStyle = C.red;
      ctx.fillRect(menu.x + 4, rowY(i) - 1, menu.w - 8, L.rowH);
    }
    // the text sits in the middle of its row
    const y = rowY(i) + Math.floor((L.rowH - 15) / 2);
    const colour = i === selected ? C.brightWhite : C.white;
    drawText(ctx, String(i + 1), menu.x + 14, y, i === selected ? C.brightYellow : C.brightCyan, {
      scale: 2,
    });
    drawText(ctx, label, menu.x + 44, y, colour, { scale: 2 });
  });
}

function drawCredits() {
  const y = L.creditsY;
  ctx.fillStyle = C.blue;
  ctx.fillRect(0, y + 2, LW, L.h - y - 2);
  ctx.fillStyle = C.brightCyan;
  ctx.fillRect(0, y + 2, LW, 1);
  ctx.fillStyle = C.black;
  ctx.fillRect(0, y, LW, 2);
  const line = (text: string, dy: number, colour: string) =>
    drawText(ctx, text, LW / 2, y + dy, colour, { align: 'center' });
  line('A REMAKE OF BATTLE SHIPS - HIT-PAK 1987', 8, C.brightWhite);
  line('FOR THE ZX SPECTRUM', 19, C.brightCyan);
  line(
    message || (touch ? 'TAP 1 OR 2 TO PLAY' : 'PRESS 1 OR 2 TO PLAY, M FOR SOUND'),
    31,
    message ? C.brightYellow : C.white,
  );
}

function frame(t: number) {
  drawScene(ctx, t, L.h);
  if (logo.complete && logo.naturalWidth) {
    ctx.drawImage(logo, Math.round((LW - logo.naturalWidth) / 2), 30);
  }
  drawDuel(t);
  drawMenu();
  drawCredits();
  screen.present();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

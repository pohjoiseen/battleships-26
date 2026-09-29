import {
  type AiKind,
  type AisResponse,
  type CreateGameResponse,
  hiscoreBoard,
  type HiscoresResponse,
  type HiscoreTable,
} from '@bs/shared';
import { boardLabel, drawTable } from './game/hiscores.ts';
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
 * In a portrait window the screen is taller, with bigger rows that are easier to tap. The last
 * item shows the hi-score tables, one at a time, in place of the menu.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const status = document.querySelector<HTMLElement>('#status')!;
const menuNav = document.querySelector<HTMLElement>('#menu')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('#menu button')];
const scoresNav = document.querySelector<HTMLElement>('#scores')!;
const [prevButton, nextButton, backButton] = [
  ...document.querySelectorAll<HTMLButtonElement>('#scores button'),
] as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
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

type Rect = { x: number; y: number; w: number; h: number };

interface Layout {
  h: number;
  menu: Rect;
  rowH: number;
  /** The hi-scores box, and the height of its rows with something to tap (arrows, BACK). */
  scores: Rect;
  navH: number;
  /** Top of the credits band at the bottom, and its line spacing. */
  creditsY: number;
  creditsLine: number;
}
const LANDSCAPE: Layout = {
  h: LH,
  menu: { x: 64, y: 166, w: 272, h: 95 },
  rowH: 15,
  scores: { x: 64, y: 90, w: 272, h: 171 },
  navH: 16,
  creditsY: 263,
  creditsLine: 10,
};
const PORTRAIT: Layout = {
  h: 430,
  menu: { x: 44, y: 190, w: 312, h: 190 },
  rowH: 30,
  scores: { x: 44, y: 182, w: 312, h: 198 },
  navH: 28,
  creditsY: 386,
  creditsLine: 12,
};
let L = LANDSCAPE;
const rowY = (i: number) => L.menu.y + 5 + i * L.rowH;

const items = () => [
  '1 PLAYER',
  '2 PLAYERS',
  `COMPUTER   - ${AIS[ai]!.label}`,
  `SALVO FIRE - ${salvo ? 'ON' : 'OFF'}`,
  `SOUND      - ${sound.muted ? 'OFF' : 'ON'}`,
  'HI-SCORES',
];

// ---- the hi-scores page ----

let page: 'menu' | 'scores' = 'menu';
let tables: HiscoreTable[] | null = null;
let tableIndex = 0;
let scoresError = false;

/** Where the hi-score box's parts are: the row with the arrows, the table, the BACK row. */
const scoresParts = () => {
  const b = L.scores;
  const nav = { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: L.navH };
  const table = { x: b.x + 14, y: nav.y + nav.h + 6, w: b.w - 28 };
  const back = { x: b.x + 4, y: b.y + b.h - 4 - L.navH, w: b.w - 8, h: L.navH };
  return { nav, table, back };
};

function openScores() {
  page = 'scores';
  menuNav.hidden = true;
  scoresNav.hidden = false;
  nextButton.focus();
  scoresError = false;
  void fetch('/api/hiscores')
    .then((res) => (res.ok ? (res.json() as Promise<HiscoresResponse>) : Promise.reject()))
    .then((r) => {
      tables = r.tables;
      // start on the table for the game the menu is set up for
      const board = hiscoreBoard(AIS[ai]!.id, salvo);
      tableIndex = Math.max(
        0,
        tables.findIndex((t) => t.board === board),
      );
      announceTable();
    })
    .catch(() => {
      scoresError = true;
      status.textContent = 'COULD NOT LOAD THE HI-SCORES';
    });
}

function closeScores() {
  page = 'menu';
  scoresNav.hidden = true;
  menuNav.hidden = false;
  buttons[5]!.focus();
}

function turnTable(step: 1 | -1) {
  if (!tables?.length) return;
  sound.play('type');
  tableIndex = (tableIndex + step + tables.length) % tables.length;
  announceTable();
}

/** Reads the table out to screen readers. */
function announceTable() {
  const t = tables?.[tableIndex];
  if (!t) return;
  const rows = t.entries.map((e, k) => `${k + 1}. ${e.name}, ${e.score}`);
  status.textContent = `${boardLabel(t.board)}: ${rows.join('; ') || 'no scores yet'}`;
}

prevButton.addEventListener('click', () => turnTable(-1));
nextButton.addEventListener('click', () => turnTable(1));
backButton.addEventListener('click', closeScores);

function drawScores(t: number) {
  const b = L.scores;
  const { nav, table, back } = scoresParts();
  ctx.fillStyle = C.red;
  ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
  ctx.fillStyle = C.black;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  const mid = (r: { y: number; h: number }) => r.y + Math.floor((r.h - 8) / 2);
  const current = tables?.[tableIndex];
  const heading = current
    ? boardLabel(current.board)
    : scoresError
      ? 'NO CONNECTION'
      : 'LOADING...';
  drawText(ctx, '<', nav.x + 8, mid(nav), C.brightYellow, { bold: true });
  drawText(ctx, '>', nav.x + nav.w - 8, mid(nav), C.brightYellow, { bold: true, align: 'right' });
  drawText(ctx, heading, b.x + b.w / 2, mid(nav), C.brightCyan, { align: 'center', bold: true });
  drawTable(ctx, current?.entries ?? [], table.x, table.y, table.w);
  const focused = document.activeElement === backButton || Math.floor(t / 600) % 2 === 0;
  ctx.fillStyle = focused ? C.red : C.black;
  ctx.fillRect(back.x, back.y, back.w, back.h);
  drawText(ctx, 'BACK', b.x + b.w / 2, mid(back), C.brightWhite, { align: 'center', bold: true });
}

/** Picks the layout for the window; the buttons sit over their rows, in percentages of the screen. */
function layOut() {
  L = isPortrait() ? PORTRAIT : LANDSCAPE;
  screen.setSize(LW, L.h);
  const place = (b: HTMLElement, r: Rect) =>
    Object.assign(b.style, {
      left: `${(r.x / LW) * 100}%`,
      top: `${(r.y / L.h) * 100}%`,
      width: `${(r.w / LW) * 100}%`,
      height: `${(r.h / L.h) * 100}%`,
    });
  buttons.forEach((b, i) => place(b, { ...L.menu, y: rowY(i) - 1, h: L.rowH }));
  const { nav, back } = scoresParts();
  place(prevButton, { ...nav, w: nav.w / 3 });
  place(nextButton, { ...nav, x: nav.x + (nav.w * 2) / 3, w: nav.w / 3 });
  place(backButton, back);
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
  else if (i === 4) sound.toggleMute();
  else openScores();
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
  if (page === 'scores') {
    if (e.key === 'ArrowLeft') turnTable(-1);
    else if (e.key === 'ArrowRight') turnTable(1);
    else if (e.key === 'Escape' || e.key === 'Backspace') closeScores();
    else return;
    e.preventDefault();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= buttons.length) activate(n - 1);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const i = (selected + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[i]!.focus();
    select(i);
  } else if (e.key === 'c' || e.key === 'C') activate(2);
  else if (e.key === 's' || e.key === 'S') activate(3);
  else if (e.key === 'm' || e.key === 'M') activate(4);
  else if (e.key === 'h' || e.key === 'H') activate(5);
  else return;
  e.preventDefault();
});
window.addEventListener('pointerdown', () => sound.unlock());

// ---- drawing ----

const SHIPS = [
  { cx: 92, faction: 'ussr' as const, flip: false },
  { cx: 312, faction: 'usa' as const, flip: true },
];
const WATERLINE = 162;
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
  const line = (text: string, k: number, colour: string) =>
    drawText(ctx, text, LW / 2, y + 7 + k * L.creditsLine, colour, { align: 'center' });
  line('A REMAKE OF BATTLE SHIPS - HIT-PAK 1987', 0, C.brightWhite);
  line('FOR THE ZX SPECTRUM', 1, C.brightCyan);
  const hint =
    page === 'scores'
      ? touch
        ? 'TAP < OR > FOR THE OTHER TABLES'
        : 'LEFT/RIGHT: OTHER TABLES, ESC: BACK'
      : touch
        ? 'TAP 1 OR 2 TO PLAY'
        : 'PRESS 1 OR 2 TO PLAY, M FOR SOUND';
  line(message || hint, 2, message ? C.brightYellow : C.white);
}

function frame(t: number) {
  drawScene(ctx, t, L.h);
  if (logo.complete && logo.naturalWidth) {
    ctx.drawImage(logo, Math.round((LW - logo.naturalWidth) / 2), 30);
  }
  if (page === 'scores') {
    drawScores(t);
  } else {
    drawDuel(t);
    drawMenu();
  }
  drawCredits();
  screen.present();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

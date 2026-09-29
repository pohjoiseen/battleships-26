import type { PlayerView } from '@bs/shared';
import { Screen } from '../gfx/screen.ts';
import { sound } from '../gfx/sound.ts';
import { App } from './app.ts';
import { Net } from './net.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const invite = document.querySelector<HTMLElement>('#invite')!;
const inviteLink = document.querySelector<HTMLInputElement>('#invite-link')!;
const copyButton = document.querySelector<HTMLButtonElement>('#invite-copy')!;
const shareButton = document.querySelector<HTMLButtonElement>('#invite-share')!;

const token = location.pathname.split('/').filter(Boolean)[1] ?? '';
const screen = new Screen(canvas);
const app = new App(screen);

function showInvite(view: PlayerView) {
  const hidden = !view.inviteUrl;
  if (view.inviteUrl) inviteLink.value = new URL(view.inviteUrl, location.origin).href;
  if (hidden === invite.hidden) return;
  invite.hidden = hidden;
  fitAroundInvite();
}

/** Shrinks the game to leave room for the invite under it. */
function fitAroundInvite() {
  screen.reserve = invite.hidden ? 0 : invite.offsetHeight + 16;
  screen.resize();
}
window.addEventListener('resize', fitAroundInvite);

// phones can hand the link straight to a messenger
shareButton.hidden = !navigator.share;
shareButton.addEventListener('click', () => {
  navigator.share({ title: 'Battleships', url: inviteLink.value }).catch(() => {});
});

const net = new Net(token, {
  view: (view) => {
    app.onView(view);
    showInvite(view);
    document.title = `Battleships - Player ${view.you + 1}`;
  },
  cursor: (cell) => app.onCursor(cell),
  error: (message, fatal) => {
    if (fatal) app.fatalError = message.toUpperCase();
    else console.warn('server:', message);
    app.onServerError();
  },
  connection: (connected) => app.onConnection(connected),
});
app.send = (msg) => net.send(msg);

copyButton.addEventListener('click', async () => {
  inviteLink.select();
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copyButton.textContent = 'COPIED';
  } catch {
    document.execCommand('copy');
  }
});

// ---- input ----
const at = (e: { clientX: number; clientY: number }) => screen.toLogical(e.clientX, e.clientY);
canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  canvas.setPointerCapture(e.pointerId);
  const p = at(e);
  app.pointerDown(p.x, p.y, e.button, e.pointerType !== 'mouse');
});
canvas.addEventListener('pointermove', (e) => {
  const p = at(e);
  app.pointerMove(p.x, p.y);
});
canvas.addEventListener('pointerup', () => app.pointerUp());
canvas.addEventListener('pointercancel', () => app.pointerUp(true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = at(e);
    app.rotateAt(p.x, p.y, e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  sound.unlock();
  if (app.key(e)) e.preventDefault();
});

const loop = (t: number) => {
  app.frame(t);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// For end-to-end tests: lets them find cells and buttons on the canvas (see test-hooks.d.ts).
window.__bs = {
  view: () => app.view,
  screen: () => app.screenName(),
  cellPoint: (i) => app.cellPoint(i),
  buttonPoint: (id) => app.buttonPoint(id),
  draft: () => app.localDraft,
  opponentCursor: () => app.opponentCursorCell,
};

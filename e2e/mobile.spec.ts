import { expect, type Page, test } from '@playwright/test';
import { playToTheEnd, screenName, startGame, view, waitForScreen } from './helpers.ts';

// a phone held upright (the iPhone 13's viewport), in Chromium
test.use({
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

async function tapButton(page: Page, id: string) {
  await page.waitForFunction((i) => window.__bs!.buttonPoint(i)?.enabled, id, { timeout: 5000 });
  const b = await page.evaluate((i) => window.__bs!.buttonPoint(i), id);
  await page.touchscreen.tap(b!.x, b!.y);
}

/** A finger that stays down between steps, which page.touchscreen.tap can't do. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  return {
    down: (p: { x: number; y: number }) => send('touchStart', p),
    move: (p: { x: number; y: number }) => send('touchMove', p),
    up: () => send('touchEnd'),
  };
}

const cellPoint = (page: Page, i: number) => page.evaluate((c) => window.__bs!.cellPoint(c), i);

test('a whole game on a phone in portrait, by touch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, '1p');
  const box = (await page.locator('#screen').boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width * 1.5);

  await tapButton(page, 'end');
  await waitForScreen(page, 'aiming');
  await page.waitForFunction(() => window.__bs!.view()!.turn === window.__bs!.view()!.you);

  // the shot goes where the finger lifts, not where it came down
  const f = await finger(page);
  await f.down(await cellPoint(page, 0));
  await f.move(await cellPoint(page, 21));
  await f.up();
  await expect.poll(async () => (await view(page)).pendingShots).toEqual([21]);
  // sliding off the sea before lifting places nothing
  await f.down(await cellPoint(page, 42));
  await f.move({ x: 5, y: 5 });
  await f.up();
  // tapping a placed shot takes it back
  const placed = await cellPoint(page, 21);
  await page.touchscreen.tap(placed.x, placed.y);
  await expect.poll(async () => (await view(page)).pendingShots).toEqual([]);

  await playToTheEnd(page, 'touch');
  expect(await screenName(page)).toBe('over-message');
  await page.touchscreen.tap(200, 300);
  await waitForScreen(page, 'winners');
  expect(errors).toEqual([]);
});

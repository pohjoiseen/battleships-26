import { expect, test } from '@playwright/test';
import { clickButton, playToTheEnd, startGame, view, waitForScreen } from './helpers.ts';

test('two players on separate browsers play a whole game', async ({ browser }) => {
  const p1 = await (await browser.newContext()).newPage();
  const p2 = await (await browser.newContext()).newPage();

  await startGame(p1, '2p');
  const invite = p1.locator('#invite-link');
  await expect(invite).toBeVisible();
  const inviteUrl = await invite.inputValue();
  expect(inviteUrl).toContain('/join/');
  expect((await view(p1)).opponent.joined).toBe(false);

  // player 2 follows the invite and ends up on a different, private URL
  await p2.goto(inviteUrl);
  await p2.waitForURL(/\/g\/[\w-]+$/);
  expect(p2.url()).not.toBe(p1.url());
  await waitForScreen(p2, 'placing');
  expect((await view(p2)).you).toBe(1);
  await expect(invite).toBeHidden();

  // the invite can't be used again, e.g. by player 1 to peek at player 2's screen
  const reuse = await p1.request.get(inviteUrl, { maxRedirects: 0 });
  expect(reuse.status()).toBe(410);

  // both place at the same time; each sees the other become ready
  await clickButton(p2, 'end');
  await p1.waitForFunction(() => window.__bs!.view()!.ready[1]);
  await clickButton(p1, 'end');
  await waitForScreen(p1, 'aiming');
  await waitForScreen(p2, 'aiming');

  // the watcher sees the shooter's cursor and shots live
  const v = await view(p1);
  const [shooter, watcher] = v.turn === 0 ? [p1, p2] : [p2, p1];
  const cell = 5 * 20 + 7;
  const pt = await shooter.evaluate((i) => window.__bs!.cellPoint(i), cell);
  await shooter.mouse.move(pt.x, pt.y);
  await watcher.waitForFunction((c) => window.__bs!.opponentCursor() === c, cell);
  await shooter.mouse.click(pt.x, pt.y);
  await watcher.waitForFunction((c) => window.__bs!.view()!.pendingShots.includes(c), cell);
  // un-place it again, so the turn helpers start from a clean slate
  await shooter.mouse.click(pt.x, pt.y);
  await watcher.waitForFunction(() => window.__bs!.view()!.pendingShots.length === 0);

  await Promise.all([playToTheEnd(p1), playToTheEnd(p2)]);
  const [e1, e2] = [await view(p1), await view(p2)];
  expect(e1.phase).toBe('over');
  expect(e1.winner).toBe(e2.winner);
  expect(e1.revealed).toEqual(e2.revealed);
});

test('an unknown game shows an error', async ({ page }) => {
  await page.goto('/g/does-not-exist');
  await page.waitForFunction(() => window.__bs?.screen() === 'connecting');
  await expect.poll(() => page.evaluate(() => window.__bs!.view())).toBeNull();
});

import { cellIndex, placementCells } from '@bs/shared';
import { expect, test } from '@playwright/test';
import {
  clickButton,
  playToTheEnd,
  screenName,
  startGame,
  view,
  waitForScreen,
} from './helpers.ts';

test('a whole game against the computer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, '1p');

  const v = await view(page);
  expect(v.opponent.kind).toBe('ai');
  expect(v.ready[1]).toBe(true);

  await clickButton(page, 'end');
  await waitForScreen(page, 'aiming');
  await playToTheEnd(page);

  expect(await screenName(page)).toBe('over-message');
  // clicking skips the message and reveals the winner's fleet
  await page.mouse.click(600, 450);
  await waitForScreen(page, 'winners');
  const end = await view(page);
  expect(end.phase).toBe('over');
  expect(end.revealed).not.toBeNull();
  // then the victory sail past, and the battle report
  await page.mouse.click(600, 450);
  await waitForScreen(page, 'sailpast');
  await page.mouse.click(600, 450);
  await waitForScreen(page, 'report');
  // the score goes in the table as PLAYER 1 until it's given a name
  expect((await view(page)).hiscores!.yours).toMatchObject({ name: 'PLAYER 1' });
  await page.getByLabel('YOUR NAME FOR THE HI-SCORES:').fill('e2e tester');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => window.__bs!.view()!.hiscores?.yours?.name === 'E2E TESTER');
  await expect(page.locator('#name-entry')).toBeHidden();
  const table = (await view(page)).hiscores!.entries;
  expect(table.find((e) => e.you)?.name).toBe('E2E TESTER');
  await clickButton(page, 'new');
  await page.waitForURL(/\/$/);
  expect(errors).toEqual([]);
});

test('placing ships: drag, rotate, randomise, invalid layouts block END', async ({ page }) => {
  await startGame(page, '1p');
  const draft = () =>
    page.evaluate(() => window.__bs!.draft()) as Promise<
      { x: number; y: number; orientation: number }[]
    >;
  const before = await draft();

  // keyboard: select the cruiser, rotate it
  await page.keyboard.press('2');
  await page.keyboard.press('r');
  expect((await draft())[1]!.orientation).toBe((before[1]!.orientation + 1) % 4);

  // drag the torpedo boat by one of its cells, one cell right (or left, if against the edge)
  const t = (await draft())[5]!;
  const grab = placementCells({ ...t, shipId: 5 })[0]!;
  const dx = t.x >= 17 ? -1 : 1;
  const from = await page.evaluate((i) => window.__bs!.cellPoint(i), cellIndex(grab));
  const to = await page.evaluate(
    (i) => window.__bs!.cellPoint(i),
    cellIndex({ x: grab.x + dx, y: grab.y }),
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  expect((await draft())[5]!.x).toBe(t.x + dx);

  // stack every ship in one corner: they overlap, so END is disabled
  for (const key of ['1', '2', '3', '4', '5', '6']) {
    await page.keyboard.press(key);
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  }
  await expect
    .poll(() => page.evaluate(() => window.__bs!.buttonPoint('end')?.enabled))
    .toBe(false);

  await clickButton(page, 'random');
  await clickButton(page, 'end');
  await waitForScreen(page, 'aiming');
});

test('a refresh keeps the game', async ({ page }) => {
  await startGame(page, '1p');
  await clickButton(page, 'end');
  await waitForScreen(page, 'aiming');
  const before = await view(page);
  const url = page.url();
  await page.reload();
  await waitForScreen(page, 'aiming', 'salvo');
  expect(page.url()).toBe(url);
  const after = await view(page);
  expect(after.yourLayout).toEqual(before.yourLayout);
  expect(after.you).toBe(0);
});

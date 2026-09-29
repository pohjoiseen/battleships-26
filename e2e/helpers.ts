import type { Page } from '@playwright/test';
import type { PlayerView } from '@bs/shared';

export const screenName = (page: Page) => page.evaluate(() => window.__bs!.screen());
export const view = (page: Page) => page.evaluate(() => window.__bs!.view()) as Promise<PlayerView>;

export async function waitForScreen(page: Page, ...names: string[]) {
  await page.waitForFunction((n) => n.includes(window.__bs?.screen() ?? ''), names, {
    timeout: 30_000,
  });
}

export type Pointer = 'mouse' | 'touch';

export async function clickCell(page: Page, index: number, pointer: Pointer = 'mouse') {
  const p = await page.evaluate((i) => window.__bs!.cellPoint(i), index);
  if (pointer === 'touch') await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Clicks a canvas button once it is drawn and enabled (buttons update on the next frame). */
export async function clickButton(page: Page, id: string) {
  await page.waitForFunction((i) => window.__bs!.buttonPoint(i)?.enabled, id, { timeout: 5000 });
  const b = await page.evaluate((i) => window.__bs!.buttonPoint(i), id);
  await page.mouse.click(b!.x, b!.y);
}

export async function startGame(page: Page, mode: '1p' | '2p') {
  await page.goto('/');
  await page.getByRole('button', { name: mode === '1p' ? '1 PLAYER' : '2 PLAYERS' }).click();
  await page.waitForURL(/\/g\/[\w-]+$/);
  await waitForScreen(page, 'placing');
}

/** Places this turn's shots on the first unshot cells, by clicking the canvas; the last fires. */
export async function takeTurn(page: Page, pointer: Pointer = 'mouse') {
  const v = await view(page);
  const sea = v.seas[v.turn === 0 ? 1 : 0].shots;
  const targets = sea.flatMap((s, i) => (s === 0 ? [i] : [])).slice(0, v.shotsAllowed);
  for (const cell of targets) await clickCell(page, cell, pointer);
  await waitForScreen(page, 'salvo', 'results', 'over-message', 'winners');
}

/** Plays whenever it is this page's turn until the game is over. */
export async function playToTheEnd(page: Page, pointer: Pointer = 'mouse') {
  for (let guard = 0; guard < 400; guard++) {
    await page.waitForFunction(
      () => {
        const bs = window.__bs!;
        const v = bs.view();
        const s = bs.screen();
        return s === 'over-message' || s === 'winners' || (s === 'aiming' && v!.turn === v!.you);
      },
      null,
      { timeout: 30_000 },
    );
    const s = await screenName(page);
    if (s === 'over-message' || s === 'winners') return;
    await takeTurn(page, pointer);
  }
  throw new Error('game did not finish');
}

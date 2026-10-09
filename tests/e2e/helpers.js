import { expect } from '@playwright/test';

export async function newPage(browser, { width = 1280, height = 860 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  // Fonts come from Google; tests do not need them (and may be offline).
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  return page;
}

/** Create a table as a guest host. Returns the table code. */
export async function createTable(page, { name = 'Hira', turn = 20, pile = 1, reveal = 3, cardsEach = 0, players = 4, showCleared = false } = {}) {
  await page.goto('/games/thulla');
  if (cardsEach) await page.evaluate(k => sessionStorage.setItem('taash:e2eCards', String(k)), cardsEach);
  await page.getByRole('button', { name: 'Create table' }).first().click();
  if (await page.locator('#ct-name').count()) await page.fill('#ct-name', name);
  await page.fill('#set-players', String(players)); await page.locator('#set-players').blur();
  await page.fill('#set-turn', String(turn));
  await page.locator('#set-pile').fill(String(pile));
  await page.locator('#set-reveal').fill(String(reveal));
  if (showCleared) await page.locator('label.switch[for=set-cleared]').click();
  await page.locator('.modal-foot .btn-primary').click();
  await page.waitForURL(/\/t\/[A-Z]{3}-[A-Z0-9]{3}$/);
  await expect(page.locator('.lobby-page')).toBeVisible();
  return page.url().split('/t/')[1];
}

export async function joinAsGuest(page, code, name) {
  await page.goto('/t/' + code);
  await page.fill('#join-name', name);
  await page.click('button[type=submit]');
  await expect(page.locator('.lobby-page')).toBeVisible();
  await page.getByRole('button', { name: 'I’m ready' }).click();
}

/** One step of a simple automatic player for this page. Returns what it did. */
export async function step(page, { give = null } = {}) {
  return page.evaluate(({ give }) => {
    const modal = [...document.querySelectorAll('.modal')].find(m => /asks for your hand/.test(m.textContent));
    if (modal) {
      const b = [...modal.querySelectorAll('button')].find(x => (give ? /^Give/ : /^Keep/).test(x.textContent));
      if (b && !b.disabled) { b.click(); return 'answered'; }
      return 'wait';
    }
    if (!document.querySelector('.tt-dock.my-turn')) return document.querySelector('.results-page') ? 'done' : 'wait';
    const c = document.querySelector('.hand .pcard.is-playable');
    if (!c) return 'wait';
    c.click(); c.click();
    return 'played';
  }, { give });
}

/** Drive every page until all show results. */
export async function playToEnd(pages, { timeout = 180_000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const states = [];
    for (const p of pages) states.push(await step(p));
    if (states.every(s => s === 'done')) return;
    if (Date.now() > end) throw new Error('game did not finish: ' + states.join(','));
    await pages[0].waitForTimeout(120);
  }
}

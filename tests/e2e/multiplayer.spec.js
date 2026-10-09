/* Real multiplayer games through the browser: several players, one server. */
import { test, expect } from '@playwright/test';
import { newPage, createTable, joinAsGuest, step, playToEnd } from './helpers.js';

test('three guests play a complete game; everyone sees the same results', async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTable(host, { name: 'Hira', cardsEach: 4, players: 3, showCleared: true });
  const a = await newPage(browser);
  const b = await newPage(browser, { width: 390, height: 844 });
  await joinAsGuest(a, code, 'Asad');
  await joinAsGuest(b, code, 'Benish');
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const p of [host, a, b]) await expect(p.locator('.tt')).toBeVisible();
  // Each player sees only their own cards: four in hand, opponents as counts.
  await expect(host.locator('.hand .pcard')).toHaveCount(4, { timeout: 10_000 });
  await expect(host.locator('.cleared')).toBeVisible();
  await playToEnd([host, a, b]);
  const orders = [];
  for (const p of [host, a, b]) {
    await expect(p.locator('.results-page')).toBeVisible();
    orders.push(await p.locator('.order-list li').allInnerTexts());
  }
  expect(orders[0].length).toBe(3);
  // Same order everywhere (names differ only by "You").
  const norm = o => o.map(t => t.replace(/\s+/g, ' ').replace(/You|Hira|Asad|Benish/, '•'));
  expect(norm(orders[1])).toEqual(norm(orders[0]));
  expect(norm(orders[2])).toEqual(norm(orders[0]));
  for (const p of [host, a, b]) expect(p.errors).toEqual([]);

  // Rematch: same table, fresh game, nothing carried over.
  await host.getByRole('button', { name: 'Play again' }).click();
  for (const p of [host, a, b]) await expect(p.locator('.tt')).toBeVisible();
  await expect(host.locator('.pile .pslot')).toHaveCount(0);
  await expect(host.locator('.baari-log, .over-card')).toHaveCount(0);
});

test('accepted hand request: the whole table sees exactly the transferred cards, for the configured time', async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTable(host, { name: 'Hira', cardsEach: 6, players: 3, reveal: 3, turn: 30 });
  const a = await newPage(browser), b = await newPage(browser);
  await joinAsGuest(a, code, 'Asad');
  await joinAsGuest(b, code, 'Benish');
  await host.getByRole('button', { name: 'Start game' }).click();
  const pages = [host, a, b];
  for (const p of pages) await expect(p.locator('.tt')).toBeVisible();

  // Play until someone leads baari 2+ and can request.
  let requester = null;
  for (let i = 0; i < 400 && !requester; i++) {
    for (const p of pages) {
      if (await p.locator('.dock-main .btn:not([hidden])', { hasText: 'Request' }).isVisible().catch(() => false)) { requester = p; break; }
    }
    if (!requester) { for (const p of pages) if ((await step(p, { stopAtRequest: true })) === 'request') { requester = p; break; } await host.waitForTimeout(100); }
  }
  expect(requester, 'a leader got the chance to request').toBeTruthy();
  await requester.locator('.dock-main .btn', { hasText: 'Request' }).click();
  await requester.getByRole('button', { name: 'Send request' }).click();

  // The target is asked; everyone else waits.
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    for (const p of pages) if (await p.getByText(/asks for your hand/).isVisible().catch(() => false)) target = p;
    if (!target) await host.waitForTimeout(100);
  }
  expect(target).toBeTruthy();
  const giverCards = (await target.locator('.hand .pcard').evaluateAll(els => els.map(e => e.dataset.card))).sort();
  await target.getByRole('button', { name: /^Give my/ }).click();

  // Every player sees the same reveal with every transferred card.
  for (const p of pages) {
    const panel = p.locator('.reveal-panel');
    await expect(panel).toBeVisible();
    const shown = (await panel.locator('.pcard').evaluateAll(els => els.map(e => e.dataset.card))).sort();
    expect(shown).toEqual(giverCards);
  }
  // It disappears after the configured 3 seconds (not before ~2.5 s).
  await host.waitForTimeout(2300);
  await expect(host.locator('.reveal-panel')).toBeVisible();
  for (const p of pages) await expect(p.locator('.reveal-panel')).toBeHidden({ timeout: 3000 });
  // The giver finished; the requester holds the cards.
  await expect(target.locator('.me-status')).toContainText(/Finished/);
  const reqHand = await requester.locator('.hand .pcard').evaluateAll(els => els.map(e => e.dataset.card));
  for (const c of giverCards) expect(reqHand).toContain(c);
});

test('a refused request transfers nothing and shows no reveal', async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTable(host, { name: 'Hira', cardsEach: 5, players: 2, turn: 30 });
  const a = await newPage(browser);
  await joinAsGuest(a, code, 'Asad');
  await host.getByRole('button', { name: 'Start game' }).click();
  const pages = [host, a];
  let requester = null;
  for (let i = 0; i < 400 && !requester; i++) {
    for (const p of pages) if (await p.locator('.dock-main .btn:not([hidden])', { hasText: 'Request' }).isVisible().catch(() => false)) { requester = p; break; }
    if (!requester) { for (const p of pages) if ((await step(p, { stopAtRequest: true })) === 'request') { requester = p; break; } await host.waitForTimeout(100); }
  }
  test.skip(!requester, 'game ended before a request was possible');
  const target = requester === host ? a : host;
  const before = await target.locator('.hand .pcard').count();
  await requester.locator('.dock-main .btn', { hasText: 'Request' }).click();
  await requester.getByRole('button', { name: 'Send request' }).click();
  await target.getByRole('button', { name: 'Keep my cards' }).click();
  await host.waitForTimeout(800);
  for (const p of pages) await expect(p.locator('.reveal-panel')).toBeHidden();
  await expect(target.locator('.hand .pcard')).toHaveCount(before);
});

test('reloading mid-game restores the same table and hand', async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTable(host, { name: 'Hira', cardsEach: 6, players: 2, turn: 60 });
  const a = await newPage(browser);
  await joinAsGuest(a, code, 'Asad');
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(a.locator('.tt')).toBeVisible();
  await expect(a.locator('.hand .pcard')).toHaveCount(6, { timeout: 10_000 });
  for (let i = 0; i < 8; i++) { await step(host); await step(a); await host.waitForTimeout(300); }
  const before = (await a.locator('.hand .pcard').evaluateAll(els => els.map(e => e.dataset.card))).sort();
  await a.reload();
  await expect(a.locator('.tt')).toBeVisible();
  await a.waitForTimeout(500);
  const after = (await a.locator('.hand .pcard').evaluateAll(els => els.map(e => e.dataset.card))).sort();
  expect(after).toEqual(before);
});

test('a table is limited to its seat count; bad codes explain themselves', async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTable(host, { name: 'Hira', players: 2 });
  const a = await newPage(browser), b = await newPage(browser);
  await joinAsGuest(a, code, 'Asad');
  await b.goto('/t/' + code);
  await b.fill('#join-name', 'Benish');
  await b.click('button[type=submit]');
  await expect(b.getByText(/is full/)).toBeVisible();
  await b.goto('/join');
  await b.fill('#join-code', 'ZZZ999');
  await b.fill('#join-name', 'Benish');
  await b.click('button[type=submit]');
  await expect(b.getByText(/No open table uses the code ZZZ-999/)).toBeVisible();
});

test('with reduced motion the game still runs to the end', async ({ browser }) => {
  const mk = async () => { const c = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1024, height: 768 } }); await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); return p; };
  const host = await mk();
  const code = await createTable(host, { name: 'Hira', cardsEach: 3, players: 2 });
  const a = await mk();
  await joinAsGuest(a, code, 'Asad');
  await host.getByRole('button', { name: 'Start game' }).click();
  await playToEnd([host, a]);
  for (const p of [host, a]) { await expect(p.locator('.results-page')).toBeVisible(); expect(p.errors).toEqual([]); }
});

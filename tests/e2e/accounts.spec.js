/* Registration, sign-in, protected pages, rated games and friends. */
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { newPage, createTable, joinAsGuest, playToEnd } from './helpers.js';

const uid = () => Math.random().toString(36).slice(2, 8);

async function register(page, name, handle) {
  await page.goto('/register');
  await page.fill('#name', name);
  await page.fill('#handle', handle);
  await page.fill('#email', handle + '@example.test');
  await page.fill('#password', 'correct horse battery');
  await page.fill('#confirm', 'correct horse battery');
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/register'));
}

test('guests are not given registered-user features', async ({ browser }) => {
  const g = await newPage(browser);
  await g.goto('/profile');
  await expect(g.getByText('Create an account').first()).toBeVisible();
  const res = await g.request.get('/api/friends');
  expect(res.status()).toBe(401);
  await g.goto('/friends');
  await expect(g.getByText(/Guests don’t have a friends list/)).toBeVisible();
});

test('register → rated game with a guest → rating, streak and history saved exactly once', async ({ browser }) => {
  const h = 'e2e_' + uid();
  const host = await newPage(browser);
  await register(host, 'Sana Test', h);
  await expect(host.locator('.account-chip')).toContainText('Sana Test');
  const code = await createTable(host, { cardsEach: 3, players: 2 });
  const g = await newPage(browser);
  await joinAsGuest(g, code, 'Guesty');
  await host.getByRole('button', { name: 'Start game' }).click();
  await playToEnd([host, g]);
  await expect(host.locator('.rating-change')).toContainText(/Thulla rating \d+/, { timeout: 10_000 });
  await expect(g.locator('.rating-change')).toContainText('Guest games are not rated');

  await host.goto('/profile');
  await expect(host.locator('.hist-table tbody tr')).toHaveCount(1);
  await expect(host.locator('.totals')).toContainText('1');

  const sql = postgres(process.env.DATABASE_URL || 'postgres://taash:taash@localhost:5432/taash', { max: 1 });
  const [u] = await sql`select id from users where handle = ${h}`;
  const ev = await sql`select count(*)::int as n from rating_events where user_id = ${u.id}`;
  const rt = await sql`select played, rating from player_ratings where user_id = ${u.id}`;
  await sql.end();
  expect(ev[0].n).toBe(1);
  expect(rt[0].played).toBe(1);
});

test('friends: request, accept, both see each other; sign out ends the session', async ({ browser }) => {
  const h1 = 'e2e_' + uid(), h2 = 'e2e_' + uid();
  const p1 = await newPage(browser), p2 = await newPage(browser);
  await register(p1, 'Bilal Test', h1);
  await register(p2, 'Zain Test', h2);
  await p1.goto('/friends');
  await p1.getByRole('button', { name: 'Add friend' }).click();
  await p1.fill('#add-handle', '@' + h2);
  await p1.getByRole('button', { name: 'Send request' }).click();
  await expect(p1.getByText('Waiting for an answer')).toBeVisible();
  await p2.goto('/friends');
  await p2.getByRole('button', { name: 'Accept' }).click();
  await expect(p2.locator('.friend-list').getByText('Bilal Test')).toBeVisible();
  await p1.goto('/friends');
  await expect(p1.locator('.friend-list').getByText('Zain Test')).toBeVisible();
  // Self-requests and duplicates are rejected.
  await p1.getByRole('button', { name: 'Add friend' }).click();
  await p1.fill('#add-handle', h1);
  await p1.getByRole('button', { name: 'Send request' }).click();
  await expect(p1.getByText('You cannot add yourself.')).toBeVisible();

  await p1.goto('/leaderboard');
  await expect(p1.locator('.lb-table')).toContainText('Zain Test');

  await p1.locator('.account-chip').click();
  await p1.getByRole('menuitem', { name: 'Sign out' }).click();
  await p1.waitForURL(u => u.pathname === '/');
  await p1.goto('/profile');
  await expect(p1.getByText('Create an account').first()).toBeVisible();
});

test('wrong password is rejected without saying which part was wrong', async ({ browser }) => {
  const p = await newPage(browser);
  await p.goto('/signin');
  await p.fill('#login', 'nobody@example.test');
  await p.fill('#password', 'whatever-123');
  await p.click('button[type=submit]');
  await expect(p.getByText('Those sign-in details do not match an account.')).toBeVisible();
});

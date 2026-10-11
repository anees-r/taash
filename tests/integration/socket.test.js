/* Socket.IO server with real auth, validation, authorization and the database.
   Needs PostgreSQL (DATABASE_URL, migrated). Run: npm run test:integration */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { encode } from 'next-auth/jwt';
import { attachRealtime } from '../../lib/realtime/socket-server.js';
import { encodeGuest, newGuestId } from '../../lib/auth/guest.js';
import { invalidateUser } from '../../lib/auth/user-cache.js';
import { recordMatch } from '../../lib/db/results.js';
import { db, sql } from '../../lib/db/client.js';
import { users } from '../../lib/db/schema.js';
import { config } from '../../lib/env.js';
import { defaultSettings } from '../../games/thulla/settings.js';

let server, rt, url;
const sockets = [];
before(async () => {
  server = createServer();
  rt = attachRealtime(server);
  await new Promise(r => server.listen(0, r));
  url = 'http://localhost:' + server.address().port;
});
after(async () => {
  sockets.forEach(s => s.disconnect());
  rt.manager.shutdown(); rt.io.close(); server.close();
  await sql.end();
});

function open(cookie) {
  const s = connect(url, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(s);
  return new Promise(res => s.once('session', sess => res({ s, sess })));
}
const guestCookie = name => 'taash.guest=' + encodeURIComponent(encodeGuest({ id: newGuestId(), name }));
const ask = (s, ev, payload, ms = 3000) => new Promise(res => s.timeout(ms).emit(ev, payload, (err, r) => res(err ? { timeout: true } : r)));

test('no cookie → anonymous; table actions are not available', async () => {
  const { s, sess } = await open();
  assert.strictEqual(sess.kind, 'anon');
  const r = await ask(s, 'table:create', { gameId: 'thulla', settings: defaultSettings() }, 400);
  assert.strictEqual(r.code, 'anon');                      // a clear answer, not a silent timeout
  assert.match(r.error, /display name/);
});

test('a tampered guest cookie is rejected', async () => {
  const good = encodeGuest({ id: newGuestId(), name: 'Rimsha' });
  const [data, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'g_aaaaaaaaaaaaaaaa', name: 'Host', v: 1 })).toString('base64url') + '.' + sig;
  const { sess } = await open('taash.guest=' + encodeURIComponent(forged));
  assert.strictEqual(sess.kind, 'anon');
  assert.ok(data);
});

test('host-only actions are enforced on the server; payloads are validated', async () => {
  const host = await open(guestCookie('Hira'));
  const other = await open(guestCookie('Asad'));
  assert.strictEqual(host.sess.kind, 'guest');
  const { code } = await ask(host.s, 'table:create', { gameId: 'thulla', settings: defaultSettings() });
  assert.match(code, /^[A-Z]{3}-[A-Z0-9]{3}$/);
  await ask(host.s, 'table:join', { code });
  const j = await ask(other.s, 'table:join', { code });
  assert.ok(j.snapshot);
  assert.strictEqual(j.snapshot.you, other.sess.playerId);
  assert.match((await ask(other.s, 'table:start', { code })).error, /Only the host/);
  assert.match((await ask(other.s, 'table:settings', { code, settings: { ...defaultSettings(), turnSeconds: 99 } })).error, /Only the host/);
  assert.match((await ask(other.s, 'table:kick', { code, playerId: host.sess.playerId })).error, /Only the host/);
  assert.strictEqual((await ask(other.s, 'game:action', { code, actionId: 'abcd1', action: { type: 'play', card: 'ZZ' } })).code, 'invalid');
  assert.strictEqual((await ask(other.s, 'table:create', { gameId: 'thulla' })).code, 'invalid');
  // A client cannot claim to be someone else: there is no player id in any payload to forge.
  assert.match((await ask(other.s, 'game:action', { code, actionId: 'abcd2', action: { type: 'play', card: 'AS' } })).error, /no game/);
});

test('each player receives only their own hand; public events carry no hands', async () => {
  const host = await open(guestCookie('Hira'));
  const other = await open(guestCookie('Asad'));
  const { code } = await ask(host.s, 'table:create', { gameId: 'thulla', settings: { ...defaultSettings(), players: 2 } });
  await ask(host.s, 'table:join', { code });
  await ask(other.s, 'table:join', { code });
  await ask(other.s, 'table:ready', { code, ready: true });
  const got = { host: [], other: [], events: [] };
  host.s.on('game:hand', d => got.host.push(d.hand));
  other.s.on('game:hand', d => got.other.push(d.hand));
  other.s.on('game:events', d => got.events.push(d));
  const snaps = [];
  other.s.on('game:snapshot', d => snaps.push(d.snapshot));
  assert.ok((await ask(host.s, 'table:start', { code })).ok);
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(got.host.length, 1);
  assert.strictEqual(got.other.length, 1);
  const h1 = new Set(got.host[0]), h2 = new Set(got.other[0]);
  assert.strictEqual(h1.size + h2.size, 52);
  for (const c of h1) assert.ok(!h2.has(c));
  const t = rt.manager.get(code);
  const seatOther = t.gamePlayers.findIndex(p => p.id === other.sess.playerId);
  assert.deepStrictEqual(got.other[0], t.match.S.players[seatOther].hand.map(c => c.id));
  for (const e of got.events) for (const c of h1) assert.ok(!JSON.stringify(e).includes('"' + c + '"'), 'host card leaked to other player');
  assert.strictEqual(snaps.length, 1);
  assert.deepStrictEqual(snaps[0].game.hand, got.other[0]);
  assert.ok(!JSON.stringify(snaps[0].game.view).includes('"hand"'));
});

test('chat is rate limited and members-only', async () => {
  const host = await open(guestCookie('Hira'));
  const stranger = await open(guestCookie('Stranger'));
  const { code } = await ask(host.s, 'table:create', { gameId: 'thulla', settings: defaultSettings() });
  await ask(host.s, 'table:join', { code });
  assert.match((await ask(stranger.s, 'chat:send', { code, text: 'hi' })).error, /Only people/);
  const replies = [];
  for (let i = 0; i < 8; i++) replies.push(await ask(host.s, 'chat:send', { code, text: 'msg ' + i }));
  assert.ok(replies.some(r => r.code === 'slow' || r.code === 'rate'));   // chat spam protection kicks in
});

test('registered session from the Auth.js cookie; bumping session_version revokes it', async () => {
  const id = randomUUID();
  const handle = 'it_' + id.slice(0, 8);
  await db.insert(users).values({ id, name: 'Integration User', handle, email: handle + '@example.test', sessionVersion: 0 });
  const salt = config.secureCookies ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const token = await encode({ token: { uid: id, sv: 0, name: 'Integration User', handle }, secret: config.authSecret, salt });
  const cookie = salt + '=' + token;
  const a = await open(cookie);
  assert.strictEqual(a.sess.kind, 'user');
  assert.strictEqual(a.sess.playerId, 'u:' + id);
  await sql`update users set session_version = session_version + 1 where id = ${id}`;
  invalidateUser(id);
  const b = await open(cookie);
  assert.strictEqual(b.sess.kind, 'anon');
  await sql`delete from users where id = ${id}`;
});

test('a match result is stored once; a duplicate does not change ratings again', async () => {
  const id = randomUUID();
  const handle = 'it_' + id.slice(0, 8);
  await db.insert(users).values({ id, name: 'Rated User', handle, email: handle + '@example.test' });
  const rec = {
    matchId: randomUUID(), gameId: 'thulla', tableCode: 'TST-001', gameNo: 1, settings: defaultSettings(), startedAt: new Date(), summary: { baaris: 3 },
    players: [
      { seat: 0, userId: id, name: 'Rated User', place: 1, isLoser: false, stats: {} },
      { seat: 1, userId: null, name: 'Guest', place: 2, isLoser: true, stats: {} },
    ],
  };
  const first = await recordMatch(rec);
  const second = await recordMatch(rec);
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.duplicate, true);
  assert.deepStrictEqual(second.ratings[id], first.ratings[id]);
  const [{ n }] = await sql`select count(*)::int as n from rating_events where user_id = ${id}`;
  const [r] = await sql`select rating, played, win_streak from player_ratings where user_id = ${id}`;
  assert.strictEqual(n, 1);
  assert.strictEqual(r.played, 1);
  assert.strictEqual(r.win_streak, 1);
  assert.strictEqual(r.rating, 1516);
  await sql`delete from matches where id = ${rec.matchId}`;
  await sql`delete from users where id = ${id}`;
});

test('sockets opened from another website are refused', async () => {
  const s = connect(url, { transports: ['polling'], extraHeaders: { origin: 'https://evil.example', cookie: guestCookie('Mallory') }, reconnection: false });
  sockets.push(s);
  const err = await new Promise(res => { s.once('connect_error', e => res(e)); s.once('session', () => res(null)); });
  assert.ok(err, 'connection should be refused');
});

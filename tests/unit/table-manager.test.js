/* Platform table lifecycle with a fake transport and mocked clock. */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TableManager, LIMITS } from '../../lib/game-engine/table-manager.js';
import { thulla } from '../../games/thulla/match.js';
import { defaultSettings } from '../../games/thulla/settings.js';

const who = (id, name, guest = false) => ({ playerId: (guest ? 'g:' : 'u:') + id, userId: guest ? null : id, name, guest, handle: guest ? null : id });
const H = who('host', 'Hira'), A = who('a', 'Asad'), B = who('b', 'Benish', true), C = who('c', 'Chaand');

function fakeTransport() {
  const log = [];
  const rooms = new Map();   // code → Set(playerId)
  return {
    log, rooms,
    broadcast: (code, ev, data) => { for (const p of rooms.get(code) || []) log.push({ to: p, ev, data }); log.push({ to: 'room:' + code, ev, data }); },
    send: (playerId, ev, data) => log.push({ to: playerId, ev, data, private: true }),
    joinRoom: (p, code) => { if (!rooms.has(code)) rooms.set(code, new Set()); rooms.get(code).add(p); },
    leaveRoom: (p, code) => rooms.get(code)?.delete(p),
    of: (p, ev) => log.filter(x => x.to === p && (!ev || x.ev === ev)),
  };
}

let tm, tr, persisted;
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  tr = fakeTransport();
  persisted = [];
  tm = new TableManager({ games: { thulla }, transport: tr, persistResult: async r => { persisted.push(r); return { ratings: { host: { before: 1500, after: 1516, delta: 16 } } }; }, now: () => Date.now(), rng: () => 0.42 });
});
afterEach(() => mock.timers.reset());

function seatAll(settings = { ...defaultSettings(), players: 4 }, players = [A, B, C]) {
  const { code } = tm.createTable(H, 'thulla', settings);
  tm.attach(H, code);
  for (const p of players) { assert.ok(tm.join(p, code).ok); tm.attach(p, code); tm.setReady(p, code, true); }
  return code;
}

test('create + join: codes, seat limit, duplicate guest names, invalid and unknown codes', () => {
  const code = seatAll({ ...defaultSettings(), players: 4 });
  assert.match(code, /^[A-Z]{3}-[A-Z0-9]{3}$/);
  assert.match(tm.join(who('d', 'Dua'), code).error, /full/);
  assert.match(tm.join(who('x', 'X'), 'ZZZ').error, /look like/);
  assert.match(tm.join(who('x', 'X'), 'ZZZ-999').error, /No open table/);
  tm.kick(H, code, C.playerId);
  assert.match(tm.join(who('z', 'hira', true), code).error, /already called/);
  assert.ok(tm.join(who('z', 'Zara', true), code.toLowerCase().replace('-', '')).ok);   // code normalised
});

test('only the host changes settings, kicks or starts; settings lock during a game', () => {
  const code = seatAll();
  assert.match(tm.updateSettings(A, code, { ...defaultSettings(), turnSeconds: 60 }).error, /Only the host/);
  assert.match(tm.kick(A, code, B.playerId).error, /Only the host/);
  assert.match(tm.start(A, code).error, /Only the host/);
  assert.match(tm.updateSettings(H, code, { ...defaultSettings(), players: 3 }).error, /already seated/);
  assert.ok(tm.updateSettings(H, code, { ...defaultSettings(), turnSeconds: 60 }).ok);
  assert.ok(tm.start(H, code).ok);
  assert.match(tm.updateSettings(H, code, defaultSettings()).error, /locked/);
  assert.match(tm.kick(H, code, B.playerId).error, /after the game/);
  assert.match(tm.join(who('d', 'Dua'), code).error, /in progress/);
});

test('start: needs 2+ seated and everyone ready; seat count is only a maximum', () => {
  const { code } = tm.createTable(H, 'thulla', { ...defaultSettings(), players: 6 });
  assert.match(tm.start(H, code).error, /At least 2/);
  tm.join(A, code);
  assert.match(tm.start(H, code).error, /Asad/);
  tm.setReady(A, code, true);
  assert.ok(tm.start(H, code).ok);
  const t = tm.get(code);
  assert.strictEqual(t.gamePlayers.length, 2);
  assert.deepStrictEqual(t.match.S.players.map(p => p.hand.length), [26, 26]);
});

test('private hands go only to their owner; public events never include hands', () => {
  const code = seatAll();
  tm.start(H, code);
  const t = tm.get(code);
  const hands = tr.log.filter(x => x.ev === 'game:hand');
  assert.strictEqual(hands.length, 4);
  for (const h of hands) {
    const seat = t.gamePlayers.findIndex(p => p.id === h.to);
    assert.deepStrictEqual(h.data.hand, t.match.S.players[seat].hand.map(c => c.id));
    assert.ok(h.private);
  }
  for (const e of tr.log.filter(x => x.ev === 'game:events')) assert.ok(!JSON.stringify(e.data).includes('"hand"'));
  // Snapshots: each player sees only their own hand.
  const snapB = tm.snapshot(t, B.playerId);
  const seatB = t.gamePlayers.findIndex(p => p.id === B.playerId);
  assert.deepStrictEqual(snapB.game.hand, t.match.S.players[seatB].hand.map(c => c.id));
  assert.ok(!JSON.stringify(snapB.game.view).includes('"hand"'));
});

function currentPlayer(t) { return [H, A, B, C].find(p => p.playerId === t.gamePlayers[t.match.S.current].id); }

test('actions: out of turn rejected; duplicate action ids applied once; deadline fires once', () => {
  const code = seatAll();
  tm.start(H, code);
  const t = tm.get(code);
  mock.timers.tick(thulla.TIMING.dealMs);                  // deal → first turn
  assert.strictEqual(t.match.sub, 'turn');
  const cur = currentPlayer(t);
  const other = [H, A, B, C].find(p => p !== cur);
  assert.match(tm.action(other, code, 'x1', { type: 'play', card: 'AS' }).error, /not your turn|not in your hand/);
  assert.ok(tm.action(cur, code, 'act-1', { type: 'play', card: 'AS' }).ok);
  const plays = () => t.match.S.baari.plays.length;
  assert.strictEqual(plays(), 1);
  const dup = tm.action(cur, code, 'act-1', { type: 'play', card: 'AS' });
  assert.ok(dup.ok && dup.duplicate);
  assert.strictEqual(plays(), 1);
  // Let the next player's timer run out: exactly one auto-play happens.
  const before = tr.log.filter(x => x.ev === 'game:events').length;
  mock.timers.tick(thulla.TIMING.playMs + 30_000 + 5);
  assert.strictEqual(plays(), 2);
  assert.ok(tr.log.filter(x => x.ev === 'game:events').length > before);
});

test('seq numbers increase with every broadcast batch', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const seqs = tr.log.filter(x => x.to === 'room:' + code && x.ev === 'game:events').map(x => x.data.seq);
  assert.deepStrictEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.strictEqual(new Set(seqs).size, seqs.length);
});

test('whole game through the manager: result broadcast and persisted exactly once; rematch resets state', async () => {
  const code = seatAll({ ...defaultSettings(), players: 4, turnSeconds: 5, pileSeconds: 1 });
  tm.start(H, code);
  const t = tm.get(code);
  // Everyone idles: the server plays every turn (timeouts, then away auto-play) until the game ends.
  for (let i = 0; i < 4000 && t.status === 'playing'; i++) mock.timers.tick(1000);
  assert.strictEqual(t.status, 'finished');
  await new Promise(r => setImmediate(r));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].players.length, 4);
  assert.strictEqual(new Set(persisted[0].players.map(p => p.place)).size, 4);
  assert.ok(t.lastResult.players.every(p => !('userId' in p)));
  assert.ok(tr.log.some(x => x.ev === 'table:result' && x.data.result.ratings));
  const firstMatch = t.matchId;
  // Rematch: no ready check, fresh match id, no leftover timers/cards/positions.
  assert.ok(tm.start(H, code).ok);
  assert.notStrictEqual(t.matchId, firstMatch);
  assert.strictEqual(t.match.S.finishOrder.length, 0);
  assert.deepStrictEqual(t.match.away, [false, false, false, false]);
  assert.strictEqual(t.lastResult, null);
});

test('host leaving the lobby hands the table to the next player; last one out closes it', () => {
  const code = seatAll();
  tm.leave(H, code);
  const t = tm.get(code);
  assert.strictEqual(t.hostId, A.playerId);
  tm.leave(A, code); tm.leave(B, code); tm.leave(C, code);
  assert.strictEqual(tm.get(code), null);
  assert.ok(tr.log.some(x => x.ev === 'table:closed'));
});

test('lobby disconnect: seat kept for the grace period, then freed', () => {
  const code = seatAll();
  tm.detach(B, code);
  mock.timers.tick(LIMITS.lobbyGraceMs - 1000);
  assert.ok(tm.seatOf(tm.get(code), B.playerId));
  mock.timers.tick(2000);
  assert.strictEqual(tm.seatOf(tm.get(code), B.playerId), null);
});

test('reconnecting within the grace period keeps the seat', () => {
  const code = seatAll();
  tm.detach(B, code);
  mock.timers.tick(10_000);
  tm.attach(B, code);
  mock.timers.tick(LIMITS.lobbyGraceMs);
  assert.ok(tm.seatOf(tm.get(code), B.playerId));
});

test('everyone disconnects mid-game: clock pauses (no auto-play to an empty room), resumes on return, closes if abandoned', () => {
  const code = seatAll();
  tm.start(H, code);
  const t = tm.get(code);
  mock.timers.tick(thulla.TIMING.dealMs);
  for (const p of [H, A, B, C]) tm.detach(p, code);
  assert.ok(t.paused);
  const plays = t.match.S.baari.plays.length;
  mock.timers.tick(5 * 60_000);
  assert.strictEqual(t.match.S.baari.plays.length, plays);
  tm.attach(A, code);
  assert.strictEqual(t.paused, false);
  tm.detach(A, code);
  mock.timers.tick(LIMITS.abandonMs + 1);
  assert.strictEqual(tm.get(code), null);
});

test('leaving mid-game: seat stays, the server plays for them', () => {
  const code = seatAll();
  tm.start(H, code);
  const t = tm.get(code);
  tm.leave(B, code);
  const seat = t.gamePlayers.findIndex(p => p.id === B.playerId);
  assert.strictEqual(t.match.away[seat], true);
  assert.ok(tm.seatOf(t, B.playerId));
});

test('chat: members only, trimmed, length-limited, plain text', () => {
  const code = seatAll();
  assert.match(tm.chat(who('q', 'Q'), code, 'hi').error, /Only players/);
  assert.match(tm.chat(A, code, '   ').error, /Type/);
  tm.chat(A, code, '<b>hi</b>' + 'x'.repeat(1000));
  const msg = tm.get(code).chat.at(-1);
  assert.strictEqual(msg.text.length, LIMITS.chatMax);
  assert.ok(msg.text.startsWith('<b>hi</b>'));      // stored as text; rendered as text, never HTML
});

test('kicked players are told and lose the seat; host can then fill it', () => {
  const code = seatAll();
  assert.ok(tm.kick(H, code, C.playerId).ok);
  assert.ok(tr.of(C.playerId, 'table:kicked').length);
  assert.ok(tm.join(who('d', 'Dua'), code).ok);
});

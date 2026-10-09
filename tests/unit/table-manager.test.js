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

test('default crypto rng produces values in [0, 1)', () => {
  const m = new TableManager({ games: { thulla }, transport: fakeTransport() });
  for (let i = 0; i < 1000; i++) { const v = m.rng(); assert.ok(v >= 0 && v < 1); }
});

test('host who left mid-game: hosting passes on at the end; departed players free their seats', async () => {
  const code = seatAll({ ...defaultSettings(), players: 4, turnSeconds: 5, pileSeconds: 1 });
  tm.start(H, code);
  const t = tm.get(code);
  tm.leave(H, code);
  tm.leave(C, code);
  for (let i = 0; i < 4000 && t.status === 'playing'; i++) mock.timers.tick(1000);
  assert.strictEqual(t.status, 'finished');
  assert.notStrictEqual(t.hostId, H.playerId);
  assert.ok([A.playerId, B.playerId].includes(t.hostId));
  mock.timers.tick(LIMITS.lobbyGraceMs + 10);
  assert.deepStrictEqual(t.players.map(p => p.id).sort(), [A.playerId, B.playerId].sort());
  assert.ok(tm.start(tm.seatOf(t, t.hostId) && [A, B].find(p => p.playerId === t.hostId), code).ok);
});

test('table options: ranked + private by default; public tables with a free seat are listed', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings());
  assert.deepStrictEqual(tm.get(code).options, { ranked: true, visibility: 'private' });
  assert.strictEqual(tm.publicTables().length, 0);
  const pub = tm.createTable(A, 'thulla', { ...defaultSettings(), players: 2 }, { visibility: 'public', ranked: false }).code;
  assert.deepStrictEqual(tm.publicTables().map(t => [t.code, t.ranked, t.seated, t.seats]), [[pub, false, 1, 2]]);
  tm.join(C, pub);
  assert.strictEqual(tm.publicTables().length, 0, 'a full table is not listed');
  // Only the host changes options, and only in the lobby.
  assert.match(tm.updateSettings(C, pub, defaultSettings(), { visibility: 'private' }).error, /Only the host/);
  assert.ok(tm.updateSettings(H, code, defaultSettings(), { visibility: 'public' }).ok);
  assert.strictEqual(tm.get(code).options.visibility, 'public');
  assert.strictEqual(tm.get(code).options.ranked, true, 'options not sent are kept');
  assert.deepStrictEqual(tm.lobbyView(tm.get(code)).options, { ranked: true, visibility: 'public' });
});

test('leaving mid-game forfeits: the game goes on, the leaver ranks last, the result is saved as ranked', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const t = tm.get(code);
  tm.leave(A, code);
  assert.strictEqual(t.status, 'playing', 'three players are still in');
  assert.ok(t.forfeits.has(A.playerId));
  tm.finish(t);
  const r = persisted[0];
  assert.strictEqual(r.ranked, true);
  const a = r.players.find(p => p.userId === 'a');
  assert.ok(a.forfeit);
  assert.strictEqual(a.place, 4);
  assert.ok(r.players.filter(p => p.userId !== 'a').every(p => !p.forfeit && p.place < 4));
});

test('coming back before the game ends cancels the forfeit', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const t = tm.get(code);
  tm.leave(A, code);
  tm.attach(A, code);
  tm.finish(t);
  assert.ok(!persisted[0].players.find(p => p.userId === 'a').forfeit);
});

test('dropping off for good counts as leaving; a short blip does not', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const t = tm.get(code);
  tm.detach(A, code);                       // gone for good
  tm.detach(C, code);                       // a blip…
  mock.timers.tick(LIMITS.dropForfeitMs - 1000);
  tm.attach(C, code);                       // …back in time
  mock.timers.tick(2000);
  tm.finish(t);
  const by = id => persisted[0].players.find(p => p.userId === id);
  assert.ok(by('a').forfeit);
  assert.ok(!by('c').forfeit);
});

test('when everyone leaves, the game ends and every leaver forfeits', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  for (const p of [A, B, C, H]) tm.leave(p, code);
  assert.strictEqual(persisted.length, 1);
  assert.ok(persisted[0].players.every(p => p.forfeit));
  assert.strictEqual(tm.get(code).lastResult.everyoneLeft, true);
});

test('a game nobody comes back to is ended with forfeits when the table closes', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  for (const p of [H, A, B, C]) tm.detach(p, code);
  mock.timers.tick(LIMITS.abandonMs);
  assert.strictEqual(tm.get(code), null);
  assert.strictEqual(persisted.length, 1);
  assert.ok(persisted[0].players.every(p => p.forfeit));
});

test('when only one player is left holding cards, the game ends early in their favour after a grace period', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  tm.leave(A, code);
  const t = tm.get(code);
  assert.strictEqual(t.status, 'playing');
  assert.ok(t.paused, 'the clock stops while waiting');
  mock.timers.tick(LIMITS.endGraceMs);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(t.lastResult.endedEarly, true);
  assert.strictEqual(t.lastResult.loser, null);
  const r = persisted[0];
  assert.deepStrictEqual(r.players.map(p => [p.userId, p.place, p.forfeit]).sort(), [['a', 2, true], ['host', 1, false]]);
});

test('unranked tables save results with ranked: false', () => {
  const { code } = tm.createTable(H, 'thulla', { ...defaultSettings(), players: 2 }, { ranked: false });
  tm.attach(H, code); tm.join(A, code); tm.attach(A, code); tm.setReady(A, code, true);
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  tm.finish(tm.get(code));
  assert.strictEqual(persisted[0].ranked, false);
  assert.strictEqual(tm.get(code).lastResult.ranked, false);
});

test('the last player leaving during the grace period forfeits too', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  tm.leave(A, code);
  mock.timers.tick(LIMITS.endGraceMs / 2);
  tm.leave(H, code);
  mock.timers.tick(LIMITS.endGraceMs);
  assert.strictEqual(persisted.length, 1, 'saved once, not again when the grace timer fires');
  assert.ok(persisted[0].players.every(p => p.forfeit));
});

test('a leaver returning during the grace period resumes the game', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  tm.leave(A, code);
  tm.attach(A, code);
  mock.timers.tick(LIMITS.endGraceMs);
  const t = tm.get(code);
  assert.strictEqual(t.status, 'playing');
  assert.ok(!t.paused);
});

test('bots: unranked tables only; they cannot make a table ranked; kicking removes them', () => {
  const { code } = tm.createTable(H, 'thulla', { ...defaultSettings(), players: 4 });
  tm.attach(H, code);
  assert.match(tm.addBot(H, code).error, /unranked/);
  assert.ok(tm.updateSettings(H, code, defaultSettings(), { ranked: false }).ok);
  assert.match(tm.addBot(A, code).error, /not seated|Only the host/);
  const b1 = tm.addBot(H, code), b2 = tm.addBot(H, code);
  assert.ok(b1.ok && b2.ok && b1.playerId !== b2.playerId);
  assert.ok(tm.get(code).players.find(p => p.id === b1.playerId).ready);
  assert.match(tm.updateSettings(H, code, defaultSettings(), { ranked: true }).error, /Bots only play at unranked/);
  assert.ok(tm.kick(H, code, b1.playerId).ok);
  assert.strictEqual(tm.get(code).players.filter(p => p.bot).length, 1);
});

test('a game with bots plays itself to the end; bots never forfeit', () => {
  const { code } = tm.createTable(H, 'thulla', { ...defaultSettings(), players: 4, turnSeconds: 5, pileSeconds: 1 }, { ranked: false });
  tm.attach(H, code);
  for (let i = 0; i < 3; i++) assert.ok(tm.addBot(H, code).ok);
  assert.ok(tm.start(H, code).ok);
  const t = tm.get(code);
  for (let i = 0; i < 4000 && t.status === 'playing'; i++) mock.timers.tick(1000);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].ranked, false);
  assert.ok(persisted[0].players.every(p => !p.forfeit));
});

test('bots answer a hello in chat', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings(), { ranked: false });
  tm.attach(H, code);
  tm.addBot(H, code);
  tm.chat(H, code, 'Salam everyone');
  mock.timers.tick(2000);
  assert.ok(tm.get(code).chat.some(m => m.bot));
});

test('the host leaving a table of bots closes it', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings(), { ranked: false });
  tm.attach(H, code);
  tm.addBot(H, code);
  tm.leave(H, code);
  assert.strictEqual(tm.get(code), null);
});

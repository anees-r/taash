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
  assert.match(tm.chat(who('q', 'Q'), code, 'hi').error, /Only people/);
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

test('table options: ranked, private, guests allowed, 4 spectators by default; public tables are listed', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings());
  assert.deepStrictEqual(tm.get(code).options, { ranked: true, visibility: 'private', allowGuests: true, spectators: 4 });
  assert.strictEqual(tm.publicTables().length, 0);
  const pub = tm.createTable(A, 'thulla', { ...defaultSettings(), players: 2 }, { visibility: 'public', ranked: false }).code;
  assert.deepStrictEqual(tm.publicTables().map(t => [t.code, t.ranked, t.seated, t.seats, t.watchOnly]), [[pub, false, 1, 2, false]]);
  tm.join(C, pub);
  assert.deepStrictEqual(tm.publicTables().map(t => [t.code, t.watchOnly]), [[pub, true]], 'a full table is still listed for watching');
  assert.match(tm.updateSettings(C, pub, defaultSettings(), { visibility: 'private' }).error, /Only the host/);
  assert.ok(tm.updateSettings(H, code, defaultSettings(), { visibility: 'public', spectators: 7 }).ok);
  assert.deepStrictEqual(tm.lobbyView(tm.get(code)).options, { ranked: true, visibility: 'public', allowGuests: true, spectators: 7 });
});

test('one table at a time: creating or joining elsewhere is refused until you leave', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings());
  const other = tm.createTable(A, 'thulla', defaultSettings()).code;
  const r = tm.createTable(H, 'thulla', defaultSettings());
  assert.strictEqual(r.code, 'elsewhere');
  assert.strictEqual(r.table, code);
  assert.strictEqual(tm.join(H, other).code, 'elsewhere');
  assert.strictEqual(tm.join(H, other, 'spectator').code, 'elsewhere');
  assert.deepStrictEqual({ ...tm.tableOf(H.playerId), seated: 0 }, { code, gameId: 'thulla', status: 'lobby', role: 'player', host: true, seated: 0, seats: 4 });
  tm.leave(H, code);
  assert.strictEqual(tm.tableOf(H.playerId), null);
  assert.ok(tm.join(H, other).ok);
});

test('guests: hosts with an account can keep them out; a guest host always lets them in', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings(), { allowGuests: false });
  assert.strictEqual(tm.join(B, code).code, 'no-guests');
  assert.ok(tm.join(A, code).ok, 'accounts are fine');
  assert.ok(tm.updateSettings(H, code, defaultSettings(), { allowGuests: true }).ok);
  assert.ok(tm.join(B, code).ok);
  assert.match(tm.updateSettings(H, code, defaultSettings(), { allowGuests: false }).error, /guests at the table/);
  const g = tm.createTable(who('z', 'Zoya', true), 'thulla', defaultSettings(), { allowGuests: false }).code;
  assert.strictEqual(tm.get(g).options.allowGuests, true);
});

test('leaving mid-game is not a forfeit: their turns are auto-played and the result counts normally', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const t = tm.get(code);
  tm.leave(A, code);
  assert.strictEqual(t.status, 'playing');
  for (let i = 0; i < 4000 && t.status === 'playing'; i++) mock.timers.tick(1000);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(persisted.length, 1);
  assert.ok(persisted[0].players.every(p => !p.forfeit));
  assert.ok(!persisted[0].forfeitEnded);
});

test('forfeit: the game ends at once, the forfeiter is last, everyone else shares the rest', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  const t = tm.get(code);
  assert.match(tm.forfeit(who('x', 'Nobody'), code).error, /Only players/);
  assert.ok(tm.forfeit(C, code).ok);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(t.lastResult.forfeit.name, 'Chaand');
  assert.ok(tr.log.some(x => x.ev === 'table:forfeit'));
  const r = persisted[0];
  assert.strictEqual(r.forfeitEnded, true);
  const c = r.players.find(p => p.userId === 'c');
  assert.ok(c.forfeit);
  assert.strictEqual(c.place, 4);
  assert.deepStrictEqual([...new Set(r.players.filter(p => !p.forfeit).map(p => p.place))], [1], 'nobody had gone out yet: the other three share 1st');
  assert.match(tm.forfeit(A, code).error, /no game/);
});

test('a game nobody comes back to is played out to its normal end, saved, and the table closes', () => {
  const code = seatAll();
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  for (const p of [H, A, B, C]) tm.detach(p, code);
  mock.timers.tick(LIMITS.abandonMs);
  assert.strictEqual(tm.get(code), null);
  assert.strictEqual(persisted.length, 1);
  assert.ok(persisted[0].players.every(p => !p.forfeit));
  assert.strictEqual(tm.tableOf(H.playerId), null, 'everyone is free to join another table');
});

test('spectators: watch a full or running table, never get a hand, can’t play; host moves people between games', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  const S1 = who('s1', 'Sana'), S2 = who('s2', 'Sobia', true);
  const full = tm.join(S1, code);
  assert.strictEqual(full.code, 'full');
  assert.ok(full.canWatch);
  assert.strictEqual(tm.join(S1, code, 'spectator').role, 'spectator');
  tm.attach(S1, code);
  tm.start(H, code);
  const t = tm.get(code);
  const snap = tr.log.find(x => x.to === S1.playerId && x.ev === 'game:snapshot');
  assert.ok(snap, 'spectators get the game snapshot');
  assert.strictEqual(snap.data.snapshot.game.you, -1);
  assert.deepStrictEqual(snap.data.snapshot.game.hand, []);
  assert.ok(!tr.log.some(x => x.to === S1.playerId && x.ev === 'game:hand'), 'no hand is ever sent to a spectator');
  assert.match(tm.action(S1, code, 'x1', { type: 'play', card: 'AS' }).error, /watching/);
  assert.strictEqual(tm.join(S2, code, 'spectator').role, 'spectator', 'watching a game in progress is fine');
  assert.match(tm.move(H, code, S1.playerId, 'player').error, /between games/);
  tm.forfeit(H, code);
  tm.backToLobby(H, code);
  assert.match(tm.move(H, code, S1.playerId, 'player').error, /Every seat is taken/);
  assert.ok(tm.move(H, code, A.playerId, 'spectator').ok);
  assert.ok(tm.move(H, code, S1.playerId, 'player').ok);
  assert.deepStrictEqual(t.players.map(p => p.id), [H.playerId, S1.playerId]);
  assert.deepStrictEqual(t.spectators.map(p => p.id).sort(), [A.playerId, S2.playerId].sort());
  assert.match(tm.move(H, code, H.playerId, 'spectator').error, /host plays/);
  assert.ok(tm.updateSettings(H, code, null, { spectators: 2 }).ok);
  assert.match(tm.updateSettings(H, code, null, { spectators: 1 }).error, /already watching/);
});

test('back to lobby: only the host, and everyone is told', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  tm.start(H, code);
  tm.forfeit(A, code);
  const t = tm.get(code);
  assert.strictEqual(t.status, 'finished');
  assert.match(tm.backToLobby(A, code).error, /Only the host/);
  assert.ok(tm.backToLobby(H, code).ok);
  assert.strictEqual(t.status, 'lobby');
  assert.ok(tr.log.some(x => x.ev === 'table:lobby' && x.to === 'room:' + code));
});

test('sound board: players only, one sound every few seconds', () => {
  const code = seatAll({ ...defaultSettings(), players: 2 }, [A]);
  const S1 = who('s1', 'Sana');
  tm.join(S1, code, 'spectator');
  assert.ok(tm.emote(A, code, 'horn').ok);
  assert.strictEqual(tm.emote(A, code, 'horn').code, 'rate');
  mock.timers.tick(LIMITS.emoteGapMs);
  assert.ok(tm.emote(A, code, 'drum').ok);
  assert.match(tm.emote(S1, code, 'horn').error, /Only players/);
});

test('unranked tables save results with ranked: false', () => {
  const { code } = tm.createTable(H, 'thulla', { ...defaultSettings(), players: 2 }, { ranked: false });
  tm.attach(H, code); tm.join(A, code); tm.attach(A, code); tm.setReady(A, code, true);
  tm.start(H, code);
  mock.timers.tick(thulla.TIMING.dealMs);
  tm.forfeit(A, code);
  assert.strictEqual(persisted[0].ranked, false);
  assert.strictEqual(tm.get(code).lastResult.ranked, false);
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

test('a game with bots plays itself to the end; bots never forfeit and stay ready', () => {
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
  assert.ok(t.players.filter(p => p.bot).every(p => p.ready), 'bots stay ready for the next game');
  assert.ok(tm.backToLobby(H, code).ok);
  assert.ok(tm.start(H, code).ok, 'the host can start again straight away');
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

test('players can move themselves to watching and back between games; not others', () => {
  const code = seatAll({ ...defaultSettings(), players: 3 }, [A, B]);
  assert.match(tm.move(A, code, B.playerId, 'spectator').error, /Only the host/);
  assert.ok(tm.move(A, code, A.playerId, 'spectator').ok);
  assert.ok(tm.watcherOf(tm.get(code), A.playerId));
  assert.ok(!tr.log.some(x => x.to === A.playerId && x.ev === 'table:moved'), 'no "the host moved you" notice for your own move');
  assert.ok(tm.move(A, code, A.playerId, 'player').ok);
  assert.ok(tm.seatOf(tm.get(code), A.playerId));
  tm.setReady(A, code, true);                  // taking a seat again means getting ready again
  assert.ok(tm.start(H, code).ok);
  assert.match(tm.move(A, code, A.playerId, 'spectator').error, /after this game/);
});

test('chat spam protection: a gap between messages, a cap per 10 seconds, no instant repeats', () => {
  const { code } = tm.createTable(H, 'thulla', defaultSettings());
  assert.ok(tm.chat(H, code, 'hello').ok);
  const fast = tm.chat(H, code, 'again');
  assert.strictEqual(fast.code, 'slow');
  assert.ok(fast.wait >= 1);
  mock.timers.tick(LIMITS.chatGapMs);
  assert.strictEqual(tm.chat(H, code, 'hello').code, 'repeat', 'the same message straight away');
  for (let i = 0; i < 4; i++) { assert.ok(tm.chat(H, code, 'msg ' + i).ok); mock.timers.tick(LIMITS.chatGapMs); }
  const burst = tm.chat(H, code, 'one too many');
  assert.strictEqual(burst.code, 'slow', 'five messages in ten seconds is the limit');
  mock.timers.tick(LIMITS.chatBurstMs);
  assert.ok(tm.chat(H, code, 'calm again').ok);
});

test('the table design in play: rank rewards beat shop tables, pricier beats cheaper, the host breaks ties', () => {
  const { code } = tm.createTable({ ...H, cosmetics: { table: 'jade' } }, 'thulla', defaultSettings());
  assert.deepStrictEqual(tm.lobbyView(tm.get(code)).cosmetics.table, { key: 'jade', name: 'Jade', by: 'Hira', byId: H.playerId });
  tm.join({ ...A, cosmetics: { table: 'galaxy' } }, code);                // 600 coins beats 300
  assert.strictEqual(tm.lobbyView(tm.get(code)).cosmetics.table.key, 'galaxy');
  tm.join({ ...C, cosmetics: { table: 'gilded' } }, code);                // a rank reward beats any shop table
  assert.deepStrictEqual(tm.lobbyView(tm.get(code)).cosmetics.table, { key: 'gilded', name: 'Gilded', by: 'Chaand', byId: C.playerId });
  const t2 = tm.createTable({ ...who('h2', 'Huma'), cosmetics: { table: 'indigo' } }, 'thulla', defaultSettings()).code;
  tm.join({ ...who('x2', 'Xara'), cosmetics: { table: 'rose' } }, t2);    // same price: the host's
  assert.strictEqual(tm.lobbyView(tm.get(t2)).cosmetics.table.key, 'indigo');
});

/**
 * Platform tables: seats, host, readiness, settings, chat, game lifecycle,
 * deadlines, disconnection/abandonment and result persistence. Game rules
 * are delegated to the game module (see interface.js).
 *
 * All state is in memory. One process owns every table, so there is no
 * locking: socket handlers run one at a time on the event loop.
 *
 * Transport (provided by lib/realtime):
 *   broadcast(code, event, data)   → everyone watching the table
 *   send(playerId, event, data)    → every socket of one player
 *   joinRoom(playerId, code) / leaveRoom(playerId, code)
 */
import { randomInt, randomUUID } from 'node:crypto';
import { log } from '../log.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-Z]{3}-[A-Z0-9]{3}$/;

export const LIMITS = {
  chatMax: 400,
  chatKeep: 100,
  lobbyGraceMs: 60_000,         // a disconnected player keeps a lobby seat this long
  abandonMs: 10 * 60_000,       // a table nobody is connected to is closed after this
  maxTables: 500,
};

/** Crypto-backed rng in [0, 1) for shuffles. */
function cryptoRng() { return randomInt(0, 2 ** 47) / 2 ** 47; }

export function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? s.slice(0, 3) + '-' + s.slice(3) : String(raw || '').toUpperCase().trim();
}

/**
 * @typedef {{playerId:string, userId:string|null, name:string, guest:boolean, handle?:string|null}} Identity
 */

export class TableManager {
  /**
   * @param {object} o
   * @param {Record<string, import('./interface.js').GameModule>} o.games
   * @param {{broadcast:Function, send:Function, joinRoom:Function, leaveRoom:Function}} o.transport
   * @param {(record:object) => Promise<{ratings:Record<string,object>}>} [o.persistResult]
   * @param {() => number} [o.now]
   * @param {() => number} [o.rng]
   */
  constructor(o) {
    this.games = o.games;
    this.t = o.transport;
    this.persistResult = o.persistResult || (async () => ({ ratings: {} }));
    this.now = o.now || Date.now;
    this.rng = o.rng || cryptoRng;
    /** @type {Map<string, any>} */
    this.tables = new Map();
  }

  /* ------------------------------------------------------------ helpers */

  generateCode() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 3; i++) id += ALPHA[randomInt(ALPHA.length)];
      id += '-';
      for (let i = 0; i < 3; i++) id += ALNUM[randomInt(ALNUM.length)];
      if (!this.tables.has(id)) return id;
    }
  }

  get(code) { return this.tables.get(normalizeCode(code)) || null; }
  seatOf(table, playerId) { return table.players.find(p => p.id === playerId) || null; }
  isHost(table, playerId) { return table.hostId === playerId; }
  gameSeat(table, playerId) { return table.gamePlayers ? table.gamePlayers.findIndex(p => p.id === playerId) : -1; }

  /** Tables a set of users are hosting/sitting at, for "friends' open tables". */
  openTablesFor(userIds) {
    const set = new Set(userIds);
    const out = [];
    for (const t of this.tables.values()) {
      if (t.status === 'playing') continue;
      const host = this.seatOf(t, t.hostId);
      if (!host || !host.userId || !set.has(host.userId)) continue;
      out.push({ code: t.code, gameId: t.gameId, host: { name: host.name, handle: host.handle }, seated: t.players.length, seats: t.settings.players });
    }
    return out;
  }

  stats() {
    let playing = 0, players = 0;
    for (const t of this.tables.values()) { if (t.status === 'playing') playing++; players += t.players.length; }
    return { tables: this.tables.size, playing, players };
  }

  /* ------------------------------------------------------------ views */

  lobbyView(table) {
    return {
      code: table.code, gameId: table.gameId, hostId: table.hostId, status: table.status,
      settings: table.settings, gamesPlayed: table.gamesPlayed,
      players: table.players.map(p => ({ id: p.id, name: p.name, guest: p.guest, handle: p.handle || null, ready: p.ready, connected: p.connections > 0, isHost: p.id === table.hostId })),
    };
  }

  snapshot(table, playerId) {
    const now = this.now();
    const game = this.games[table.gameId];
    const snap = { ...this.lobbyView(table), you: playerId, seq: table.seq, now, chat: table.chat.slice(-50), game: null, result: table.lastResult };
    if (table.match) {
      const seat = this.gameSeat(table, playerId);
      snap.game = {
        matchId: table.matchId,
        seats: table.gamePlayers.map(p => ({ id: p.id, name: p.name, guest: p.guest, isHost: p.id === table.hostId })),
        you: seat,
        view: game.publicView(table.match, now),
        hand: seat >= 0 ? game.privateView(table.match, seat).hand : [],
      };
    }
    return snap;
  }

  pushLobby(table) { this.t.broadcast(table.code, 'table:state', { code: table.code, ...this.lobbyView(table) }); }

  system(table, text) {
    const msg = { id: table.code + ':' + (++table.chatSeq), kind: 'system', text, at: this.now() };
    table.chat.push(msg);
    if (table.chat.length > LIMITS.chatKeep) table.chat.splice(0, table.chat.length - LIMITS.chatKeep);
    this.t.broadcast(table.code, 'chat:msg', { code: table.code, msg });
  }

  /* ------------------------------------------------------------ lifecycle */

  /** @param {Identity} who */
  createTable(who, gameId, rawSettings) {
    const game = this.games[gameId];
    if (!game) return { error: 'That game is not available.' };
    if (this.tables.size >= LIMITS.maxTables) return { error: 'The card room is full right now. Try again in a few minutes.' };
    const norm = game.normalizeSettings(rawSettings);
    if (!norm.ok) return { error: Object.values(norm.errors)[0], errors: norm.errors };
    const code = this.generateCode();
    const table = {
      code, gameId, hostId: who.playerId, settings: norm.settings, status: 'lobby',
      players: [], chat: [], chatSeq: 0, seq: 0, gamesPlayed: 0,
      match: null, matchId: null, gamePlayers: null, lastResult: null, startedAt: null,
      timer: null, abandonTimer: null, paused: false, recentActions: new Map(), invited: new Set(),
      createdAt: this.now(),
    };
    this.tables.set(code, table);
    this.addSeat(table, who, true);
    this.system(table, who.name + ' opened the table.');
    log.info('table created', { code, gameId });
    return { code };
  }

  addSeat(table, who, ready) {
    const seat = { id: who.playerId, userId: who.userId, name: who.name, guest: who.guest, handle: who.handle || null, ready: !!ready, connections: 0, joinedAt: this.now(), graceTimer: null };
    table.players.push(seat);
    return seat;
  }

  /**
   * Take a seat (or re-take your own). Returns the snapshot for the caller.
   * @param {Identity} who
   */
  join(who, rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return { error: 'Enter the table code your host shared.' };
    if (!CODE_RE.test(code)) return { error: 'Table codes look like ABC-123: three letters, a dash, then three letters or numbers.' };
    const table = this.tables.get(code);
    if (!table) return { error: 'No open table uses the code ' + code + '. Check the code with your host — tables close when everyone leaves.', code: 'not-found' };
    let seat = this.seatOf(table, who.playerId);
    if (!seat) {
      if (table.status === 'playing') return { error: 'A game is in progress at table ' + code + '. You can join when it ends.', code: 'in-progress' };
      if (table.players.length >= table.settings.players) return { error: 'Table ' + code + ' is full (' + table.settings.players + ' of ' + table.settings.players + ' seats taken).', code: 'full' };
      const clash = table.players.find(p => p.name.trim().toLowerCase() === who.name.trim().toLowerCase());
      if (clash && who.guest) return { error: 'Someone at this table is already called ' + clash.name + '. Pick a different display name.', code: 'name-taken' };
      seat = this.addSeat(table, who, false);
      this.system(table, who.name + (who.guest ? ' joined as a guest.' : ' joined the table.'));
      this.pushLobby(table);
    } else if (seat.name !== who.name && !table.match) {
      seat.name = who.name;   // display name changed since they sat down
      this.pushLobby(table);
    }
    return { ok: true, code };
  }

  /** A socket of `playerId` is now watching `code`. */
  attach(who, code) {
    const table = this.get(code);
    if (!table) return { error: 'This table has closed.', code: 'not-found' };
    const seat = this.seatOf(table, who.playerId);
    if (!seat) return { error: 'You are not seated at this table.', code: 'not-seated' };
    this.t.joinRoom(who.playerId, table.code);
    const wasOff = seat.connections === 0;
    seat.connections++;
    if (seat.graceTimer) { clearTimeout(seat.graceTimer); seat.graceTimer = null; }
    if (table.abandonTimer) { clearTimeout(table.abandonTimer); table.abandonTimer = null; }
    if (table.paused) this.resume(table);
    if (wasOff) this.pushLobby(table);
    return { snapshot: this.snapshot(table, who.playerId) };
  }

  /** A socket stopped watching (navigated away or disconnected). */
  detach(who, code) {
    const table = this.get(code);
    if (!table) return;
    const seat = this.seatOf(table, who.playerId);
    if (!seat || seat.connections === 0) return;
    seat.connections--;
    if (seat.connections > 0) return;
    this.pushLobby(table);
    if (table.status !== 'playing') {
      seat.graceTimer = setTimeout(() => {
        seat.graceTimer = null;
        if (seat.connections === 0 && this.tables.get(table.code) === table && table.status !== 'playing') this.removeSeat(table, seat.id, 'timeout');
      }, LIMITS.lobbyGraceMs);
      seat.graceTimer.unref?.();
    }
    if (table.players.every(p => p.connections === 0)) this.startAbandon(table);
  }

  startAbandon(table) {
    if (table.abandonTimer) return;
    if (table.match && table.status === 'playing') this.pause(table);
    table.abandonTimer = setTimeout(() => this.close(table, 'abandoned'), LIMITS.abandonMs);
    table.abandonTimer.unref?.();
  }

  close(table, reason) {
    if (this.tables.get(table.code) !== table) return;
    clearTimeout(table.timer); clearTimeout(table.abandonTimer);
    for (const p of table.players) if (p.graceTimer) clearTimeout(p.graceTimer);
    table.match = null; table.timer = null; table.abandonTimer = null;
    this.tables.delete(table.code);
    this.t.broadcast(table.code, 'table:closed', { code: table.code, reason });
    log.info('table closed', { code: table.code, reason });
  }

  removeSeat(table, playerId, reason) {
    const i = table.players.findIndex(p => p.id === playerId);
    if (i < 0) return;
    const [p] = table.players.splice(i, 1);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    this.t.leaveRoom(playerId, table.code);
    if (reason === 'kick') this.t.send(playerId, 'table:kicked', { code: table.code });
    if (!table.players.length) { this.close(table, 'empty'); return; }
    this.system(table, reason === 'kick' ? p.name + ' was removed from the table by the host.' : p.name + ' left the table.');
    if (table.hostId === playerId) {
      const next = table.players.slice().sort((a, b) => (b.connections > 0) - (a.connections > 0) || a.joinedAt - b.joinedAt)[0];
      table.hostId = next.id;
      next.ready = true;
      this.system(table, next.name + ' is now the host.');
    }
    this.pushLobby(table);
  }

  /** Leave voluntarily. Mid-game the seat stays and the server plays for them. */
  leave(who, code) {
    const table = this.get(code);
    if (!table) return { ok: true };
    const seat = this.seatOf(table, who.playerId);
    if (!seat) return { ok: true };
    if (table.status === 'playing' && table.match) {
      const gs = this.gameSeat(table, who.playerId);
      if (gs >= 0) {
        this.system(table, seat.name + ' left the game. Their turns will be played automatically.');
        this.applyOutcome(table, this.games[table.gameId].act(table.match, gs, { type: 'away' }, this.now()));
      }
      this.t.leaveRoom(who.playerId, table.code);
      seat.connections = 0;
      this.pushLobby(table);
      if (table.players.every(p => p.connections === 0)) this.startAbandon(table);
      return { ok: true };
    }
    this.removeSeat(table, who.playerId, 'leave');
    return { ok: true };
  }

  setReady(who, code, ready) {
    const table = this.get(code);
    const seat = table && this.seatOf(table, who.playerId);
    if (!seat) return { error: 'You are not seated at this table.' };
    if (table.status === 'playing') return { error: 'The game has already started.' };
    if (seat.ready === !!ready) return { ok: true };
    seat.ready = !!ready;
    this.system(table, seat.name + (seat.ready ? ' is ready.' : ' is not ready.'));
    this.pushLobby(table);
    return { ok: true };
  }

  updateSettings(who, code, raw) {
    const table = this.get(code);
    if (!table || !this.seatOf(table, who.playerId)) return { error: 'You are not seated at this table.' };
    if (!this.isHost(table, who.playerId)) return { error: 'Only the host can change the table settings.' };
    if (table.status === 'playing') return { error: 'Settings are locked while a game is in progress.' };
    const norm = this.games[table.gameId].normalizeSettings(raw, { minPlayers: table.players.length });
    if (!norm.ok) return { error: Object.values(norm.errors)[0], errors: norm.errors };
    table.settings = norm.settings;
    this.system(table, 'The host updated the table settings.');
    this.pushLobby(table);
    return { ok: true };
  }

  kick(who, code, playerId) {
    const table = this.get(code);
    if (!table || !this.isHost(table, who.playerId)) return { error: 'Only the host can remove players.' };
    if (playerId === who.playerId) return { error: 'The host cannot remove themselves. Leave the table instead.' };
    if (table.status === 'playing') return { error: 'Players can be removed after the game ends.' };
    if (!this.seatOf(table, playerId)) return { error: 'That player is not at this table.' };
    this.removeSeat(table, playerId, 'kick');
    return { ok: true };
  }

  /** Host starts a game (or a rematch after results). */
  start(who, code, opts = {}) {
    const table = this.get(code);
    if (!table || !this.seatOf(table, who.playerId)) return { error: 'You are not seated at this table.' };
    if (!this.isHost(table, who.playerId)) return { error: 'Only the host can start the game.' };
    if (table.status === 'playing') return { error: 'A game is already in progress.' };
    const game = this.games[table.gameId];
    const n = table.players.length;
    if (n < game.playerRange.min) return { error: `At least ${game.playerRange.min} players are needed to start.` };
    if (table.status === 'lobby') {
      const notReady = table.players.filter(p => p.id !== table.hostId && !p.ready);
      if (notReady.length) return { error: 'Waiting for ' + notReady.map(p => p.name.split(' ')[0]).join(', ') + ' to get ready.' };
    }
    const now = this.now();
    table.gamePlayers = table.players.map(p => ({ id: p.id, userId: p.userId, name: p.name, guest: p.guest }));
    const dealer = (table.gamesPlayed + n - 1) % n;
    const { match, outcome } = game.createMatch({ players: table.gamePlayers.map(p => ({ id: p.id, name: p.name })), settings: table.settings, rng: this.rng, dealer, now, hands: opts.hands });
    table.match = match;
    table.matchId = randomUUID();
    table.startedAt = new Date(now);
    table.status = 'playing';
    table.lastResult = null;
    table.recentActions.clear();
    this.system(table, 'Game ' + (table.gamesPlayed + 1) + ' is starting. Shuffling…');
    this.pushLobby(table);
    // Each player gets their own starting snapshot (with only their own hand),
    // then the deal events follow on the same connection, in order.
    for (const p of table.gamePlayers) this.t.send(p.id, 'game:snapshot', { code: table.code, snapshot: this.snapshot(table, p.id) });
    this.applyOutcome(table, outcome);
    log.info('game started', { code: table.code, players: n });
    return { ok: true };
  }

  /* ------------------------------------------------------------ gameplay */

  action(who, code, actionId, action) {
    const table = this.get(code);
    if (!table) return { error: 'This table has closed.' };
    if (table.status !== 'playing' || !table.match) return { error: 'No game is in progress.' };
    const seat = this.gameSeat(table, who.playerId);
    if (seat < 0) return { error: 'You are not playing in this game.' };
    // Idempotency: a retried action (same id) is acknowledged but not applied twice.
    let seen = table.recentActions.get(who.playerId);
    if (!seen) { seen = []; table.recentActions.set(who.playerId, seen); }
    if (actionId && seen.includes(actionId)) return { ok: true, duplicate: true };
    const res = this.games[table.gameId].act(table.match, seat, action, this.now());
    if (res.error) return { error: res.error };
    if (actionId) { seen.push(actionId); if (seen.length > 32) seen.shift(); }
    this.applyOutcome(table, res);
    return { ok: true };
  }

  applyOutcome(table, outcome) {
    if (!outcome || this.tables.get(table.code) !== table || !table.match) return;
    const game = this.games[table.gameId];
    if (outcome.events && outcome.events.length) {
      table.seq++;
      this.t.broadcast(table.code, 'game:events', { code: table.code, seq: table.seq, now: this.now(), events: outcome.events });
      for (const seat of new Set(outcome.handsChanged || [])) {
        const p = table.gamePlayers[seat];
        if (p) this.t.send(p.id, 'game:hand', { code: table.code, seq: table.seq, hand: game.privateView(table.match, seat).hand });
      }
    }
    if (outcome.over) { this.finish(table); return; }
    this.schedule(table);
  }

  schedule(table) {
    clearTimeout(table.timer);
    table.timer = null;
    const dl = table.match && table.match.deadline;
    if (!dl || table.paused) return;
    const id = dl.id;
    table.timer = setTimeout(() => {
      table.timer = null;
      if (!table.match || !table.match.deadline || table.match.deadline.id !== id) return;  // superseded
      try {
        this.applyOutcome(table, this.games[table.gameId].onDeadline(table.match, this.now()));
      } catch (e) {
        log.error('deadline handler failed', { code: table.code, err: e.message });
      }
    }, Math.max(0, dl.at - this.now()));
  }

  /** Nobody is connected: stop the clock instead of auto-playing to an empty room. */
  pause(table) {
    if (table.paused || !table.match || !table.match.deadline) return;
    table.paused = { remaining: Math.max(1000, table.match.deadline.at - this.now()) };
    clearTimeout(table.timer); table.timer = null;
  }

  resume(table) {
    if (!table.paused) return;
    const { remaining } = table.paused;
    table.paused = false;
    if (table.match && table.match.deadline) {
      table.match.deadline.at = this.now() + remaining;
      this.t.broadcast(table.code, 'game:deadline', { code: table.code, now: this.now(), deadline: { ...table.match.deadline } });
    }
    this.schedule(table);
  }

  finish(table) {
    clearTimeout(table.timer); table.timer = null;
    const game = this.games[table.gameId];
    const res = game.results(table.match);
    table.status = 'finished';
    table.gamesPlayed++;
    for (const p of table.players) if (p.id !== table.hostId) p.ready = false;
    const players = table.gamePlayers.map((p, seat) => {
      const o = res.order.find(x => x.seat === seat);
      return { seat, id: p.id, userId: p.userId, name: p.name, guest: p.guest, place: o.place, isLoser: res.loser === seat, stats: res.stats[seat] };
    });
    // What clients see: no internal user ids; ratings keyed by player id.
    const result = {
      matchId: table.matchId, gameId: table.gameId, gameNo: table.gamesPlayed,
      players: players.map(({ userId, ...rest }) => rest), loser: res.loser,
      summary: res.summary, ratings: null, endedAt: this.now(),
    };
    table.lastResult = result;
    const loser = res.loser != null ? table.gamePlayers[res.loser] : null;
    this.system(table, loser ? 'Game over — ' + loser.name + ' was left holding the cards.' : 'Game over.');
    this.pushLobby(table);
    this.t.broadcast(table.code, 'table:result', { code: table.code, result });
    // Durable record (+ ratings for registered players), exactly once per matchId.
    this.persistResult({
      matchId: table.matchId, gameId: table.gameId, tableCode: table.code, gameNo: table.gamesPlayed,
      settings: table.settings, startedAt: table.startedAt, summary: res.summary,
      players: players.map(p => ({ seat: p.seat, userId: p.userId, name: p.name, place: p.place, isLoser: p.isLoser, stats: p.stats })),
    }).then(stored => {
      if (table.lastResult !== result) return;
      result.ratings = Object.fromEntries(players.filter(p => p.userId && stored.ratings[p.userId]).map(p => [p.id, stored.ratings[p.userId]]));
      this.t.broadcast(table.code, 'table:result', { code: table.code, result });
    }).catch(e => log.error('saving result failed', { code: table.code, err: e.message }));
    log.info('game finished', { code: table.code, players: players.length });
  }

  /* ------------------------------------------------------------ chat */

  chat(who, code, rawText) {
    const table = this.get(code);
    const seat = table && this.seatOf(table, who.playerId);
    if (!seat) return { error: 'Only players at this table can chat here.' };
    const text = String(rawText ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, LIMITS.chatMax);
    if (!text) return { error: 'Type a message first.' };
    const msg = { id: table.code + ':' + (++table.chatSeq), kind: 'msg', from: who.playerId, name: seat.name, text, at: this.now() };
    table.chat.push(msg);
    if (table.chat.length > LIMITS.chatKeep) table.chat.splice(0, table.chat.length - LIMITS.chatKeep);
    this.t.broadcast(table.code, 'chat:msg', { code: table.code, msg });
    return { ok: true, id: msg.id };
  }

  /** Clean shutdown: stop every timer. In-memory games end with the process. */
  shutdown() {
    for (const t of this.tables.values()) {
      clearTimeout(t.timer); clearTimeout(t.abandonTimer);
      for (const p of t.players) if (p.graceTimer) clearTimeout(p.graceTimer);
      this.t.broadcast(t.code, 'table:closed', { code: t.code, reason: 'restart' });
    }
    this.tables.clear();
  }
}

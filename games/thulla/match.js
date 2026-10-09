/**
 * Thulla's server-side game module: wraps the pure rules engine with turn
 * deadlines, the agreed timeout/away policy, the public hand-transfer reveal,
 * and per-player redaction. Implements lib/game-engine/interface.js.
 *
 * Nothing here touches sockets or the database.
 */
import * as R from './engine/rules.js';
import { defaultSettings, normalizeSettings, LIMITS } from './settings.js';
import { chooseCard, seatView, PERSONALITIES } from './engine/strategy.js';
import { BOTS, BOT_BY_ID, personaOf, chatterFor, greetingReply } from './bots.js';

/** Presentation allowances (ms) added to deadlines so every client has time to
 *  animate an event before the next timer starts. Never affect outcomes. */
export const TIMING = {
  dealMs: 3800,         // shuffle (~1.7s) + deal (~1.5s) animation
  playMs: 450,          // a card flying to the pile
  slamMs: 1000,         // the Thulla raise, wind-up and slam
  clearMs: 1100,        // pile sweeping off the table
  collectMs: 1400,      // pile flying to the collector
  awayDelayMs: 1200,    // pause before playing for an away player
  answerGraceMs: 500,
};
export const AWAY_AFTER_TIMEOUTS = 3;

let deadlineSeq = 0;
function setDeadline(m, kind, at, seat = null) { m.deadline = { id: ++deadlineSeq, kind, at, seat }; return m.deadline; }

function baariInfo(S) {
  const b = S.baari;
  if (!b) return null;
  return {
    number: b.number, leader: b.leader, leadSuit: b.leadSuit, playsCount: b.plays.length,
    plays: b.plays.map(p => ({ seat: p.seat, card: p.card.id, thulla: p.thulla })),
    request: b.request ? { from: b.request.from, to: b.request.to, status: b.request.status } : null,
    requestUsed: b.requestUsed,
  };
}

function seatsInfo(m) {
  return m.S.players.map((p, i) => ({
    seat: i, count: p.hand.length, finished: p.finished, place: p.place,
    away: m.away[i], timeouts: m.timeouts[i], stats: p.stats,
  }));
}

/** How long a bot "thinks" before playing. */
function thinkMs(m, seat) {
  const [lo, hi] = BOT_BY_ID[m.bots[seat]]?.think || [900, 1600];
  return Math.round(lo + m.rng() * (hi - lo));
}

/**
 * The card the server plays: the bot's own style, or a steady player's choice for timeouts and
 * away players. The strategy only ever sees this seat's view (own hand + public table), never S.
 */
function serverCard(m, seat) {
  const view = seatView(m.S, seat);
  return m.bots[seat] ? chooseCard(view, personaOf(m.bots[seat]), m.rng) : chooseCard(view, PERSONALITIES.steady);
}

/** Start the current player's turn and announce it. */
function beginTurn(m, now, grace = 0, events = []) {
  const S = m.S;
  const seat = S.current;
  m.sub = 'turn';
  const from = now + grace;
  const dl = m.bots[seat] ? setDeadline(m, 'auto', from + thinkMs(m, seat), seat)
    : m.away[seat] ? setDeadline(m, 'auto', from + TIMING.awayDelayMs, seat)
    : setDeadline(m, 'turn', from + m.turnMs, seat);
  events.push({
    type: 'turn', seat, from, deadline: dl.at, auto: dl.kind === 'auto',
    baari: baariInfo(S),
    requestTarget: R.canRequest(S, seat) ? R.requestTarget(S, seat) : null,
  });
  return events;
}

function finishGame(m, events) {
  m.sub = 'over';
  m.deadline = null;
  const S = m.S;
  events.push({ type: 'over', loser: S.loser, finishOrder: S.finishOrder.slice(), seats: seatsInfo(m) });
  return { events, over: true };
}

function setAway(m, seat, away, events) {
  if (m.away[seat] === away) return;
  m.away[seat] = away;
  if (!away) m.timeouts[seat] = 0;
  events.push({ type: 'away', seat, away });
}

/** Play a card (by a player, or by the server on timeout/away). */
function doPlay(m, seat, id, now, how) {
  const S = m.S;
  const events = [];
  const index = S.baari.plays.length;
  const ev = R.playCard(S, seat, id);
  events.push({ type: 'play', seat, card: ev.card.id, thulla: ev.thulla, index, auto: how !== 'player', baariNumber: S.review ? S.review.number : S.baari.number });
  const handsChanged = [seat];
  if (ev.baariEnded) {
    const r = S.review;
    m.sub = 'review';
    const until = now + (ev.thulla ? TIMING.slamMs : TIMING.playMs) + m.pileMs;
    setDeadline(m, 'review', until);
    events.push({
      type: 'review', kind: r.kind, number: r.number, leadSuit: r.leadSuit, rankSuit: r.rankSuit,
      highest: r.highest ? { seat: r.highest.seat, card: r.highest.card.id } : null,
      collector: r.collector, thullaBy: r.thullaBy, notPlayed: r.notPlayed, until, pileMs: m.pileMs,
    });
    return { events, handsChanged };
  }
  beginTurn(m, now, TIMING.playMs, events);
  return { events, handsChanged };
}

function resolve(m, now) {
  const S = m.S;
  const out = R.resolveBaari(S);
  const events = [{
    type: 'resolved', kind: out.kind, number: out.number,
    cleared: out.cleared.map(c => c.id),
    collected: out.collected ? { seat: out.collected.seat, cards: out.collected.cards.map(c => c.id) } : null,
    finished: out.finished, nextLeader: out.nextLeader,
    clearedCounts: { ...S.cleared }, seats: seatsInfo(m),
  }];
  const handsChanged = out.collected ? [out.collected.seat] : [];
  if (out.gameOver) return { ...finishGame(m, events), handsChanged };
  beginTurn(m, now, out.kind === 'thulla' ? TIMING.collectMs : TIMING.clearMs + (out.finished.length ? 600 : 0), events);
  return { events, handsChanged };
}

function answer(m, accept, now, how) {
  const S = m.S;
  const req = S.baari.request;
  const res = R.answerRequest(S, accept);
  const events = [{ type: 'request-answer', from: req.from, to: req.to, accepted: res.accepted, auto: how !== 'player' }];
  if (!res.accepted) {
    beginTurn(m, now, TIMING.answerGraceMs, events);
    return { events };
  }
  const handsChanged = [req.from, req.to];
  // The one intentionally public view of a hand: every player sees exactly
  // the cards that moved from the giver to the requester.
  const until = now + m.revealMs;
  m.reveal = { id: ++deadlineSeq, from: req.to, to: req.from, cards: res.transferred.map(c => c.id), until, revealMs: m.revealMs, place: res.place };
  events.push({ type: 'transfer-reveal', ...m.reveal, seats: seatsInfo(m) });
  if (res.gameOver) return { ...finishGame(m, events), handsChanged };
  m.sub = 'reveal';
  setDeadline(m, 'reveal', until);
  return { events, handsChanged };
}

export const thulla = {
  id: 'thulla',
  playerRange: { min: LIMITS.playersMin, max: LIMITS.playersMax },
  defaultSettings,
  normalizeSettings,
  TIMING,

  /** Bots a host can seat at an unranked table. */
  bots: {
    roster: BOTS.map(b => ({ id: b.id, name: b.name, persona: PERSONALITIES[b.persona].label })),
    chatterFor,
    greetingReply,
  },

  /** @param {{players:{id:string,name:string,bot?:string|null}[], settings:object, rng?:()=>number, seed?:number, hands?:string[][], dealer?:number, now:number}} o */
  createMatch(o) {
    const S = R.createGame({ players: o.players, rng: o.rng, seed: o.seed, hands: o.hands, dealer: o.dealer });
    const n = S.players.length;
    const m = {
      S, sub: 'deal', deadline: null, reveal: null,
      away: new Array(n).fill(false), timeouts: new Array(n).fill(0),
      turnMs: o.settings.turnSeconds * 1000, pileMs: o.settings.pileSeconds * 1000,
      revealMs: o.settings.revealSeconds * 1000, showCleared: !!o.settings.showCleared,
      startedAt: o.now,
      bots: o.players.map(p => p.bot || null),    // bot id per seat, null for people
      rng: o.rng || Math.random,
    };
    setDeadline(m, 'deal', o.now + TIMING.dealMs);
    const events = [{
      type: 'deal', dealer: S.dealer, opener: S.current,
      order: S.dealSequence.map(d => d.seat), counts: S.players.map(p => p.hand.length), seats: seatsInfo(m),
    }];
    return { match: m, outcome: { events, handsChanged: S.players.map((_, i) => i) } };
  },

  /**
   * @param {object} m
   * @param {number} seat
   * @param {{type:'play', card:string}|{type:'request'}|{type:'answer', accept:boolean}|{type:'back'}} a
   */
  act(m, seat, a, now) {
    const S = m.S;
    if (m.sub === 'over') return { error: 'The game is over.' };
    if (!S.players[seat]) return { error: 'You are not playing in this game.' };
    if (a.type === 'back') {
      const events = [];
      setAway(m, seat, false, events);
      // If the server was about to play for them, give them a real turn instead.
      if (m.sub === 'turn' && S.current === seat && m.deadline && m.deadline.kind === 'auto') beginTurn(m, now, 0, events);
      else if (m.sub === 'turn' && S.baari.request && S.baari.request.status === 'pending' && S.baari.request.to === seat) setDeadline(m, 'request', now + m.turnMs, seat);
      return { events };
    }
    if (a.type === 'away') {
      // The player left the table mid-game: the server plays for them from now on.
      const events = [];
      setAway(m, seat, true, events);
      if (m.sub === 'turn' && S.current === seat && m.deadline && m.deadline.kind === 'turn' && !(S.baari.request && S.baari.request.status === 'pending')) setDeadline(m, 'auto', now + TIMING.awayDelayMs, seat);
      else if (m.sub === 'turn' && S.baari.request && S.baari.request.status === 'pending' && S.baari.request.to === seat) setDeadline(m, 'request', now + TIMING.awayDelayMs, seat);
      return { events };
    }
    if (S.players[seat].finished) return { error: 'You have already finished.' };

    if (a.type === 'answer') {
      const req = S.baari && S.baari.request;
      if (!req || req.status !== 'pending') return { error: 'There is no request to answer.' };
      if (req.to !== seat) return { error: 'That request was not sent to you.' };
      const events = [];
      setAway(m, seat, false, events);
      const res = answer(m, !!a.accept, now, 'player');
      res.events.unshift(...events);
      return res;
    }

    if (m.sub !== 'turn') return { error: m.sub === 'reveal' ? 'Wait for the cards to be shown.' : 'Wait for the baari to finish.' };
    if (S.current !== seat) return { error: 'It is not your turn.' };
    if (S.baari.request && S.baari.request.status === 'pending') return { error: 'Waiting for an answer to the request.' };

    if (a.type === 'request') {
      if (!R.canRequest(S, seat)) {
        if (S.baari.number < 2) return { error: 'No requests in the first baari.' };
        if (S.baari.plays.length) return { error: 'Only the leader can request, before leading.' };
        if (S.baari.requestUsed) return { error: 'You can request once per turn.' };
        return { error: 'You cannot request a hand now.' };
      }
      const events = [];
      setAway(m, seat, false, events);
      const { to } = R.makeRequest(S, seat);
      m.sub = 'turn';
      const dl = m.bots[to] ? setDeadline(m, 'request', now + thinkMs(m, to), to)
        : m.away[to] ? setDeadline(m, 'request', now + TIMING.awayDelayMs, to)
        : setDeadline(m, 'request', now + m.turnMs, to);
      events.push({ type: 'request', from: seat, to, deadline: dl.at, cardsInHand: S.players[to].hand.length, place: S.finishOrder.length + 1 });
      return { events };
    }

    if (a.type === 'play') {
      if (typeof a.card !== 'string') return { error: 'Choose a card.' };
      if (!S.players[seat].hand.some(c => c.id === a.card)) return { error: 'That card is not in your hand.' };
      const reason = R.illegalReason(S, seat, a.card);
      if (reason) return { error: reason };
      const events = [];
      setAway(m, seat, false, events);
      m.timeouts[seat] = 0;
      const res = doPlay(m, seat, a.card, now, 'player');
      res.events.unshift(...events);
      return res;
    }
    return { error: 'Unknown action.' };
  },

  onDeadline(m, now) {
    const S = m.S;
    const dl = m.deadline;
    if (!dl) return { events: [] };
    switch (dl.kind) {
      case 'deal': {
        m.sub = 'turn';
        return { events: beginTurn(m, now) };
      }
      case 'turn':
      case 'auto': {
        const seat = S.current;
        const events = [];
        if (dl.kind === 'turn') {
          m.timeouts[seat]++;
          events.push({ type: 'timeout', seat, count: m.timeouts[seat] });
          if (m.timeouts[seat] >= AWAY_AFTER_TIMEOUTS) setAway(m, seat, true, events);
        }
        const res = doPlay(m, seat, serverCard(m, seat), now, dl.kind);
        res.events.unshift(...events);
        return res;
      }
      case 'request':   // bots always give (it finishes them); an unanswered request counts as Keep
        return m.bots[dl.seat] ? answer(m, true, now, 'bot') : answer(m, false, now, 'timeout');
      case 'review':
        return resolve(m, now);
      case 'reveal': {
        m.reveal = null;
        return { events: beginTurn(m, now) };
      }
      default:
        return { events: [] };
    }
  },

  /** Everything any seated player or spectator may see. No hands. */
  publicView(m, now) {
    const S = m.S;
    return {
      phase: m.sub,
      current: S.current,
      seats: seatsInfo(m),
      baari: baariInfo(S),
      review: m.sub === 'review' && S.review ? {
        kind: S.review.kind, number: S.review.number, rankSuit: S.review.rankSuit, leadSuit: S.review.leadSuit,
        highest: S.review.highest ? { seat: S.review.highest.seat, card: S.review.highest.card.id } : null,
        collector: S.review.collector, thullaBy: S.review.thullaBy, until: m.deadline && m.deadline.at, pileMs: m.pileMs,
      } : null,
      reveal: m.reveal && m.reveal.until > now ? m.reveal : null,
      requestTarget: m.sub === 'turn' && R.canRequest(S, S.current) ? R.requestTarget(S, S.current) : null,
      deadline: m.deadline ? { kind: m.deadline.kind, at: m.deadline.at, seat: m.deadline.seat } : null,
      cleared: { ...S.cleared },
      finishOrder: S.finishOrder.slice(),
      loser: S.loser,
      history: S.baariHistory.slice(-12),
    };
  },

  privateView(m, seat) {
    const p = m.S.players[seat];
    return { hand: p ? p.hand.map(c => c.id) : [] };
  },

  results(m) {
    const S = m.S;
    const n = S.players.length;
    const order = S.players.map((p, seat) => ({ seat, place: p.place ?? n }));
    const top = S.players.map((p, i) => ({ i, t: p.stats.thullasGiven })).sort((a, b) => b.t - a.t)[0];
    return {
      order, loser: S.loser,
      stats: S.players.map(p => ({ ...p.stats, cardsLeft: p.hand.length })),
      summary: {
        baaris: S.baariHistory.length, thullas: S.stats.thullas, clearedBaaris: S.stats.cleared,
        biggestPile: S.stats.biggestPile, biggestPileBy: S.stats.biggestPileBy,
        requests: S.stats.requests, requestsAccepted: S.stats.requestsAccepted,
        mostThullas: top && top.t ? { seat: top.i, count: top.t } : null,
        cleared: { ...S.cleared },
      },
    };
  },
};

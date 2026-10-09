/**
 * Thulla card choice for bots and auto-play. Plain rules and card memory — no
 * AI, no randomness unless a personality asks for a little.
 *
 * No cheating, by construction: the strategy never receives the game state.
 * The server builds a seatView() for the seat that is playing — its own hand
 * plus what every player at the table can see (cards played, who gave Thulla,
 * hand sizes, cleared counts) — and chooseCard() works only from that. Other
 * players' hands are simply not in it.
 *
 * The ideas a good human player uses:
 *  - Leading: a shape someone has already given Thulla on is a trap (they will
 *    Thulla again and the leader is likely highest, so collects the pile). Lead
 *    the shape most likely to go round; shed a high card when it is safe,
 *    otherwise lead low.
 *  - Following: if a Thulla looks likely before the baari ends, duck under the
 *    current highest card. If it is safe, or someone else is already highest,
 *    shed your highest card while you can.
 *  - Out of the shape (giving Thulla, or discarding in the first baari): throw
 *    your highest card, preferring a short shape so you run out of it sooner.
 */
import { SUITS, parseCard, legalFromView } from './rules.js';

/**
 * safeRisk: how much risk still counts as "safe" (shed high cards below it).
 * memory:   chance of remembering who is out of a shape (1 = always).
 * slips:    chance of ignoring the danger altogether on a given turn.
 */
export const PERSONALITIES = {
  steady: { id: 'steady', label: 'Steady', safeRisk: 0.25, memory: 1, slips: 0 },
  cautious: { id: 'cautious', label: 'Cautious', safeRisk: 0.12, memory: 1, slips: 0 },
  sharp: { id: 'sharp', label: 'Sharp', safeRisk: 0.3, memory: 1, slips: 0 },
  reckless: { id: 'reckless', label: 'Reckless', safeRisk: 0.6, memory: 0.6, slips: 0.2 },
};

/** Public log entries a player at the table witnesses (and nothing else). */
const PUBLIC_LOG = new Set(['baari-start', 'play', 'request-answer']);

/**
 * Everything `seat` is allowed to know: its own hand and the public table.
 * Plain copies, so the strategy can't reach back into the game state.
 */
export function seatView(S, seat) {
  const b = S.baari;
  return {
    seat,
    hand: S.players[seat].hand.map(c => c.id),
    players: S.players.map(p => ({ seat: p.seat, finished: p.finished, count: p.hand.length })),
    baari: b ? {
      number: b.number, leader: b.leader, leadSuit: b.leadSuit,
      plays: b.plays.map(p => ({ seat: p.seat, card: p.card.id, thulla: p.thulla })),
      participants: b.participants.slice(),
    } : null,
    cleared: { ...S.cleared },
    log: S.log.filter(e => PUBLIC_LOG.has(e.type)).map(e => (
      e.type === 'baari-start' ? { type: e.type, number: e.number }
      : e.type === 'play' ? { type: e.type, seat: e.seat, card: e.card }
      : { type: e.type, from: e.from, to: e.to, accepted: e.accepted })),
    history: S.baariHistory.map(h => ({ number: h.number, kind: h.kind, collector: h.collector })),
  };
}

/**
 * Who is known to be out of which shape, worked out from the public log in
 * order. A player who picks up a pile, or receives a whole hand, may hold any
 * shape again, so what was known about them resets.
 */
export function readTable(view) {
  const voids = view.players.map(() => new Set());
  const histByNumber = new Map(view.history.map(b => [b.number, b]));
  let lead = null, number = 0;
  for (const e of view.log) {
    if (e.type === 'baari-start') {
      const prev = histByNumber.get(number);
      if (prev && prev.kind === 'thulla' && prev.collector != null) voids[prev.collector].clear();
      number = e.number; lead = null;
    } else if (e.type === 'play') {
      const suit = e.card.slice(-1);
      if (lead == null) lead = suit;
      else if (suit !== lead) voids[e.seat].add(lead);
    } else if (e.type === 'request-answer' && e.accepted) voids[e.from].clear();
  }
  return { voids };
}

/** Cards of each shape that must be in other players' hands: 13 minus mine, cleared and on the table. */
function heldByOthers(view) {
  const out = {};
  const onTable = view.baari ? view.baari.plays.map(p => p.card) : [];
  for (const s of SUITS) {
    const mine = view.hand.filter(id => id.slice(-1) === s).length;
    out[s] = 13 - mine - view.cleared[s] - onTable.filter(id => id.slice(-1) === s).length;
  }
  return out;
}

/** 0 (it will go round) … 1 (someone will surely Thulla) for leading/following `suit` with `opps` still to play. */
function risk(suit, opps, others, voids, persona, rng) {
  if (!opps.length) return 0;
  if (persona.slips && rng() < persona.slips) return 0;
  if (opps.some(o => voids[o].has(suit)) && (persona.memory >= 1 || rng() < persona.memory)) return 1;
  const c = others[suit];
  if (c <= 0) return 1;
  const perPlayer = c / opps.length;
  return perPlayer < 1 ? 0.75 : perPlayer < 2 ? 0.4 : perPlayer < 3 ? 0.2 : 0.08;
}

const byRankDesc = (a, b) => b.rank - a.rank;

/**
 * @param {ReturnType<typeof seatView>} view   the playing seat's view (never the game state)
 * @param {object} [persona] one of PERSONALITIES (default steady)
 * @param {() => number} [rng]
 * @returns {string|null} card id
 */
export function chooseCard(view, persona = PERSONALITIES.steady, rng = Math.random) {
  const b = view.baari;
  if (!b) return null;
  const legal = legalFromView({ number: b.number, leadSuit: b.leadSuit, playsCount: b.plays.length }, view.hand).map(parseCard);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0].id;
  const seat = view.seat;
  const { voids } = readTable(view);
  const others = heldByOthers(view);
  const count = s => view.hand.filter(id => id.slice(-1) === s).length;

  // Leading: pick the shape most likely to go round.
  if (b.plays.length === 0) {
    const opps = view.players.filter(p => !p.finished && p.seat !== seat).map(p => p.seat);
    const suits = [...new Set(legal.map(c => c.suit))].map(s => ({
      s, r: risk(s, opps, others, voids, persona, rng), top: Math.max(...legal.filter(c => c.suit === s).map(c => c.rank)),
    }));
    suits.sort((x, y) => x.r - y.r || y.top - x.top || count(y.s) - count(x.s));
    const best = suits[0];
    const cards = legal.filter(c => c.suit === best.s).sort(byRankDesc);
    return (best.r <= persona.safeRisk ? cards[0] : cards[cards.length - 1]).id;
  }

  const leadSuit = b.leadSuit;
  const following = legal.every(c => c.suit === leadSuit);

  // Out of the shape: throw the highest card, from a short shape if there is a tie.
  if (!following) {
    return legal.slice().sort((x, y) => y.rank - x.rank || count(x.suit) - count(y.suit))[0].id;
  }

  // Following.
  const played = new Set(b.plays.map(p => p.seat));
  const after = b.participants.filter(s => s !== seat && !played.has(s) && !view.players[s].finished);
  const firstBaari = b.number === 1;                       // nobody can Thulla in the first baari
  const r = firstBaari ? 0 : risk(leadSuit, after, others, voids, persona, rng);
  const tableHigh = Math.max(0, ...b.plays.map(p => parseCard(p.card)).filter(c => c.suit === leadSuit).map(c => c.rank));
  const mine = legal.slice().sort(byRankDesc);
  const below = mine.filter(c => c.rank < tableHigh);
  if (below.length === mine.length) return mine[0].id;              // someone else is highest: shed my highest
  if (r <= persona.safeRisk) return mine[0].id;                      // safe: shed my highest
  if (below.length) return below[0].id;                              // duck: highest card that stays under
  return mine[mine.length - 1].id;                                   // forced over: lowest, so others may still beat it
}

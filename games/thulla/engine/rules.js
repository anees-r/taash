/**
 * Thulla rules engine — pure game logic. No DOM, no sockets, no timers.
 * Imported by the server (authoritative) and by the browser (to dim illegal
 * cards before the server is asked). Ported from the prototype engine.
 *
 * Seat order: the `players` array is in ANTI-CLOCKWISE order. "Next" always
 * means the next seat anti-clockwise.
 *
 * Lifecycle of a baari:
 *   1. state.phase === 'turn'   — state.current must act (request or play)
 *   2. playCard(...) may end the baari → state.phase === 'review' and
 *      state.review describes what happened (the server holds it on the
 *      table for the configured pile-display duration)
 *   3. resolveBaari(state) applies the outcome (clear / collect), finishes
 *      players whose hands are empty, picks the next starter, and either
 *      starts the next baari or ends the game (state.phase === 'over').
 */

// Display order requested by the design brief: Clubs, Diamonds, Spades, Hearts.
const SUITS = ['C', 'D', 'S', 'H'];
const SUIT_NAMES = { C: 'Clubs', D: 'Diamonds', S: 'Spades', H: 'Hearts' };
const SUIT_SINGULAR = { C: 'Club', D: 'Diamond', S: 'Spade', H: 'Heart' };
const SUIT_GLYPH = { C: '♣', D: '♦', S: '♠', H: '♥' };
const RED = { D: true, H: true };
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

function rankLabel(rank) { return RANK_LABEL[rank] || String(rank); }
function rankName(rank) { return RANK_NAME[rank] || String(rank); }
function cardId(card) { return rankLabel(card.rank) + card.suit; }
function makeCard(rank, suit) { return { rank, suit, id: rankLabel(rank) + suit }; }
function parseCard(id) {
  const suit = id.slice(-1);
  const r = id.slice(0, -1);
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[r] || parseInt(r, 10);
  return makeCard(rank, suit);
}
function describeCard(card) { return rankName(card.rank) + ' of ' + SUIT_NAMES[card.suit]; }
function shortCard(card) { return rankLabel(card.rank) + SUIT_GLYPH[card.suit]; }

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(makeCard(r, s));
  return deck;
}

// Small deterministic PRNG so games (and tests) can be replayed from a seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sort helper players can use for their own hand (rules never depend on order).
function sortHand(hand, mode) {
  const suitOrder = mode === 'alt' ? { S: 0, H: 1, C: 2, D: 3 } : { C: 0, D: 1, S: 2, H: 3 };
  return hand.slice().sort((a, b) =>
    mode === 'rank'
      ? b.rank - a.rank || suitOrder[a.suit] - suitOrder[b.suit]
      : suitOrder[a.suit] - suitOrder[b.suit] || b.rank - a.rank);
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {Array<{id:string,name:string}>} opts.players  anti-clockwise seat order
 * @param {number} [opts.seed]
 * @param {number} [opts.dealer]  index of the dealer; dealing starts with the next seat
 * @param {Array<Array<string>>} [opts.hands] optional fixed hands (card ids) for tests/scenarios
 */
export function createGame(opts) {
  const n = opts.players.length;
  if (n < 2) throw new Error('Thulla needs at least two players');
  if (n > 52) throw new Error('A 52-card deck cannot seat more than 52 players');
  const seed = opts.seed != null ? opts.seed : null;
  // Server passes a crypto-backed rng; tests pass a seed for replayable deals.
  const rng = opts.rng || mulberry32(seed != null ? seed : Math.floor(Math.random() * 1e9));
  const dealer = opts.dealer != null ? opts.dealer : n - 1;

  const players = opts.players.map((p, i) => ({
    id: p.id, name: p.name, seat: i, hand: [], finished: false, place: null,
    stats: { thullasGiven: 0, pilesCollected: 0, cardsCollected: 0, requestsMade: 0, requestsAccepted: 0 },
  }));

  const dealSequence = [];
  if (opts.hands) {
    opts.hands.forEach((ids, i) => { players[i].hand = ids.map(parseCard); });
    // Synthesize a dealing order for animation purposes.
    const max = Math.max(...opts.hands.map(h => h.length));
    for (let k = 0; k < max; k++) for (let i = 0; i < n; i++) {
      const seat = (dealer + 1 + i) % n;
      if (players[seat].hand[k]) dealSequence.push({ seat, card: players[seat].hand[k] });
    }
  } else {
    // Deal one at a time, anti-clockwise, starting left of… well, next to the dealer,
    // until the deck is exhausted.
    const deck = shuffle(makeDeck(), rng);
    let seat = (dealer + 1) % n;
    for (const card of deck) {
      players[seat].hand.push(card);
      dealSequence.push({ seat, card });
      seat = (seat + 1) % n;
    }
  }

  const state = {
    seed, dealer, players, dealSequence,
    phase: 'turn',          // 'turn' | 'review' | 'over'
    baari: null,
    baariHistory: [],
    cleared: { C: 0, D: 0, S: 0, H: 0 },
    finishOrder: [],        // seats, in finishing order
    loser: null,
    log: [],
    stats: { thullas: 0, cleared: 0, requests: 0, requestsAccepted: 0, biggestPile: 0, biggestPileBy: null },
  };

  const aceHolder = players.findIndex(p => p.hand.some(c => c.id === 'AS'));
  if (aceHolder < 0) throw new Error('Nobody holds the Ace of Spades');
  startBaari(state, aceHolder, 1);
  return state;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

function activeSeats(state) {
  return state.players.filter(p => !p.finished).map(p => p.seat);
}

/** Next active (not finished) seat anti-clockwise from `seat`, excluding `seat` itself. */
function nextActive(state, seat) {
  const n = state.players.length;
  for (let k = 1; k < n; k++) {
    const s = (seat + k) % n;
    if (!state.players[s].finished) return s;
  }
  return null;
}

function isFirstBaari(state) { return state.baari && state.baari.number === 1; }

/** Card ids the given seat may legally play right now. */
function legalCards(state, seat) {
  if (state.phase !== 'turn' || state.current !== seat) return [];
  const hand = state.players[seat].hand;
  const b = state.baari;
  if (b.plays.length === 0) {
    // Leading
    if (b.number === 1) return hand.filter(c => c.id === 'AS').map(c => c.id);
    return hand.map(c => c.id);
  }
  const follow = hand.filter(c => c.suit === b.leadSuit);
  return (follow.length ? follow : hand).map(c => c.id);
}

/** Why a specific card cannot be played (for UI copy), or null if legal. */
function illegalReason(state, seat, id) {
  if (state.phase !== 'turn') return 'Wait for the baari to finish.';
  if (state.current !== seat) return 'It is not your turn.';
  if (legalCards(state, seat).includes(id)) return null;
  const b = state.baari;
  if (b.plays.length === 0 && b.number === 1) return 'The first baari opens with the Ace of Spades.';
  return 'You hold ' + SUIT_NAMES[b.leadSuit] + ' — you must follow the ' + SUIT_SINGULAR[b.leadSuit].toLowerCase() + '.';
}

/** Would playing this card give Thulla? */
function wouldGiveThulla(state, seat, id) {
  const b = state.baari;
  if (!b || b.number === 1 || b.plays.length === 0) return false;
  return parseCard(id).suit !== b.leadSuit;
}

function canRequest(state, seat) {
  const b = state.baari;
  if (state.phase !== 'turn' || state.current !== seat) return false;
  if (b.number < 2) return false;                 // never during the first baari
  if (b.plays.length > 0) return false;          // only before the leader plays
  if (b.requestUsed) return false;               // one request per turn
  const t = nextActive(state, seat);
  return t != null && t !== seat;
}

function requestTarget(state, seat) { return nextActive(state, seat); }

/** Highest card of `suit` among plays; returns the play or null. */
function highestOf(plays, suit) {
  let best = null;
  for (const p of plays) if (p.card.suit === suit && (!best || p.card.rank > best.card.rank)) best = p;
  return best;
}

function countCards(state) {
  const inHands = state.players.reduce((s, p) => s + p.hand.length, 0);
  const onTable = state.baari ? state.baari.plays.length : 0;
  const cleared = SUITS.reduce((s, k) => s + state.cleared[k], 0);
  return { inHands, onTable, cleared, total: inHands + onTable + cleared };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function startBaari(state, leader, number) {
  // Participants: every active player, in anti-clockwise order from the leader.
  state.baari = {
    number, leader, leadSuit: null, plays: [], participants: orderFrom(state, leader),
    requestUsed: false, request: null,
  };
  state.current = leader;
  state.phase = 'turn';
  state.review = null;
  log(state, { type: 'baari-start', number, leader });
}

function orderFrom(state, seat) {
  const order = [seat];
  let s = seat;
  for (;;) {
    s = nextActive(state, s);
    if (s == null || s === seat) break;
    order.push(s);
  }
  return order;
}

function log(state, entry) { state.log.push(entry); }

/**
 * Current player asks the next active player for their whole hand.
 * Returns { target } — the caller must then call answerRequest(state, accept).
 */
function makeRequest(state, seat) {
  if (!canRequest(state, seat)) throw new Error('Request not allowed now');
  const target = requestTarget(state, seat);
  state.baari.requestUsed = true;
  state.baari.request = { from: seat, to: target, status: 'pending' };
  state.players[seat].stats.requestsMade++;
  state.stats.requests++;
  log(state, { type: 'request', from: seat, to: target });
  return { from: seat, to: target };
}

/**
 * Target accepts (gives all cards and finishes) or refuses.
 * Returns { accepted, transferred:[cards], finishedSeat, place, gameOver }.
 */
function answerRequest(state, accept) {
  const req = state.baari && state.baari.request;
  if (!req || req.status !== 'pending') throw new Error('No pending request');
  req.status = accept ? 'accepted' : 'refused';
  const result = { accepted: !!accept, from: req.from, to: req.to, transferred: [], place: null, gameOver: false };
  if (accept) {
    const giver = state.players[req.to];
    const taker = state.players[req.from];
    result.transferred = giver.hand.slice();
    taker.hand.push(...giver.hand);
    giver.hand = [];
    finishPlayer(state, req.to);
    result.place = giver.place;
    taker.stats.requestsAccepted++;
    state.stats.requestsAccepted++;
    // The giver leaves the baari before anyone has played; recompute the order.
    state.baari.participants = orderFrom(state, req.from);
    if (activeSeats(state).length <= 1) { endGame(state); result.gameOver = true; }
  }
  log(state, { type: 'request-answer', from: req.from, to: req.to, accepted: !!accept });
  return result;
}

/**
 * Play a card. Returns an event:
 *  { seat, card, thulla:boolean, baariEnded:boolean }
 * When baariEnded, state.phase becomes 'review' and state.review is filled.
 */
function playCard(state, seat, id) {
  if (state.phase !== 'turn') throw new Error('Not accepting plays');
  if (state.current !== seat) throw new Error('Not this player\'s turn');
  if (!legalCards(state, seat).includes(id)) throw new Error('Illegal card ' + id + ': ' + illegalReason(state, seat, id));
  const b = state.baari;
  if (b.request && b.request.status === 'pending') throw new Error('Answer the pending request first');
  const player = state.players[seat];
  const idx = player.hand.findIndex(c => c.id === id);
  const [card] = player.hand.splice(idx, 1);

  const leading = b.plays.length === 0;
  if (leading) b.leadSuit = card.suit;
  const thulla = !leading && b.number > 1 && card.suit !== b.leadSuit;
  b.plays.push({ seat, card, thulla });
  log(state, { type: 'play', seat, card: card.id, thulla });

  if (thulla) {
    player.stats.thullasGiven++;
    state.stats.thullas++;
    prepareReview(state, 'thulla');
    return { seat, card, thulla: true, baariEnded: true };
  }
  if (b.plays.length === b.participants.length) {
    prepareReview(state, b.number === 1 ? 'first-clear' : 'clear');
    return { seat, card, thulla: false, baariEnded: true };
  }
  state.current = b.participants[b.plays.length];
  return { seat, card, thulla: false, baariEnded: false };
}

function prepareReview(state, kind) {
  const b = state.baari;
  const rankSuit = kind === 'first-clear' ? 'S' : b.leadSuit;
  const pool = kind === 'thulla' ? b.plays.filter(p => !p.thulla) : b.plays;
  const ranking = pool.filter(p => p.card.suit === rankSuit).sort((x, y) => y.card.rank - x.card.rank);
  const top = ranking[0] || null;
  state.phase = 'review';
  state.current = null;
  state.review = {
    kind,                                   // 'first-clear' | 'clear' | 'thulla'
    number: b.number,
    leadSuit: b.leadSuit,
    rankSuit,
    plays: b.plays.slice(),
    highest: top ? { seat: top.seat, card: top.card } : null,
    collector: kind === 'thulla' ? top.seat : null,
    thullaBy: kind === 'thulla' ? b.plays[b.plays.length - 1].seat : null,
    notPlayed: b.participants.filter(s => !b.plays.some(p => p.seat === s)),
    emptied: b.plays.filter(p => state.players[p.seat].hand.length === 0).map(p => p.seat),
  };
}

/**
 * Apply the reviewed baari. Returns a summary:
 * { kind, cleared:[cards], collected:{seat,cards}, finished:[{seat,place}], nextLeader, gameOver }
 */
function resolveBaari(state) {
  if (state.phase !== 'review') throw new Error('Nothing to resolve');
  const r = state.review;
  const b = state.baari;
  const cards = b.plays.map(p => p.card);
  const out = { kind: r.kind, number: r.number, cleared: [], collected: null, finished: [], nextLeader: null, gameOver: false };

  if (r.kind === 'thulla') {
    const collector = state.players[r.collector];
    collector.hand.push(...cards);                 // the Thulla card is collected too
    collector.stats.pilesCollected++;
    collector.stats.cardsCollected += cards.length;
    out.collected = { seat: r.collector, cards };
    if (cards.length > state.stats.biggestPile) { state.stats.biggestPile = cards.length; state.stats.biggestPileBy = r.collector; }
  } else {
    for (const c of cards) state.cleared[c.suit]++;
    out.cleared = cards;
    state.stats.cleared++;
  }
  b.plays = [];

  // Finishing is decided only now that the baari has resolved — in play order.
  for (const p of r.plays) {
    const pl = state.players[p.seat];
    if (!pl.finished && pl.hand.length === 0) {
      finishPlayer(state, p.seat);
      out.finished.push({ seat: p.seat, place: pl.place });
    }
  }

  state.baariHistory.push({ number: r.number, kind: r.kind, leadSuit: r.leadSuit, plays: r.plays.map(p => ({ seat: p.seat, card: p.card.id, thulla: p.thulla })), collector: r.collector, highest: r.highest && r.highest.seat });

  if (activeSeats(state).length <= 1) {
    endGame(state);
    out.gameOver = true;
    return out;
  }

  // Starter selection
  let next = null;
  if (r.kind === 'thulla') {
    next = r.collector;                             // collector always has cards
  } else {
    const ranking = r.plays.filter(p => p.card.suit === r.rankSuit).sort((x, y) => y.card.rank - x.card.rank);
    const eligible = ranking.find(p => !state.players[p.seat].finished);
    if (eligible) next = eligible.seat;
    else {
      // Everyone who played the ranking shape has finished (only possible in
      // very large first baaris): pass to the next active player anti-clockwise
      // from the top card's seat.
      next = nextActive(state, ranking.length ? ranking[0].seat : b.leader);
    }
  }
  out.nextLeader = next;
  startBaari(state, next, r.number + 1);
  return out;
}

function finishPlayer(state, seat) {
  const p = state.players[seat];
  if (p.finished) return;
  p.finished = true;
  state.finishOrder.push(seat);
  p.place = state.finishOrder.length;
  p.stats.finishedBaari = state.baari ? state.baari.number : null;   // ratings reward finishing early
  log(state, { type: 'finish', seat, place: p.place });
}

function endGame(state) {
  state.phase = 'over';
  state.current = null;
  const left = activeSeats(state);
  if (left.length === 1) {
    state.loser = left[0];
    state.players[left[0]].place = state.players.length;
  }
  log(state, { type: 'game-over', loser: state.loser });
}


/* ------------------------------------------------------------------ */
/* Timeout policy (agreed rule)                                        */
/* ------------------------------------------------------------------ */

/** Suit preference when two legal cards share the highest rank (only possible when leading). */
const AUTO_SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };

/**
 * The card the server plays for a player whose turn timer ran out, or who is
 * marked away: the highest-ranked legal card. When the player is void in the
 * required shape every card is legal, so this is a Thulla with their highest
 * card. Deterministic: ties between equal ranks go to ♠, ♥, ♦, ♣.
 */
function autoCard(state, seat) {
  const legal = legalCards(state, seat).map(parseCard);
  if (!legal.length) return null;
  legal.sort((a, b) => b.rank - a.rank || AUTO_SUIT_ORDER[a.suit] - AUTO_SUIT_ORDER[b.suit]);
  return legal[0].id;
}

/* ------------------------------------------------------------------ */
/* Client-side helpers working from the public view + own hand         */
/* ------------------------------------------------------------------ */

/**
 * Legal card ids for `hand` given the public baari info. Mirrors legalCards()
 * so the browser can dim cards; the server still validates every play.
 * @param {{number:number, leadSuit:string|null, playsCount:number}} baari
 * @param {string[]} hand card ids
 */
function legalFromView(baari, hand) {
  if (!baari) return [];
  if (baari.playsCount === 0) return baari.number === 1 ? hand.filter(id => id === 'AS') : hand.slice();
  const follow = hand.filter(id => id.slice(-1) === baari.leadSuit);
  return follow.length ? follow : hand.slice();
}
function thullaFromView(baari, id) {
  return !!baari && baari.number > 1 && baari.playsCount > 0 && id.slice(-1) !== baari.leadSuit;
}

export {
  SUITS, SUIT_NAMES, SUIT_SINGULAR, SUIT_GLYPH, RED,
  rankLabel, rankName, makeCard, parseCard, cardId, describeCard, shortCard,
  makeDeck, shuffle, mulberry32, sortHand,
  activeSeats, nextActive, isFirstBaari, legalCards, illegalReason, wouldGiveThulla,
  canRequest, requestTarget, makeRequest, answerRequest, playCard, resolveBaari, highestOf, countCards,
  autoCard, legalFromView, thullaFromView,
};

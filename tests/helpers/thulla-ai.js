/* Simple simulated players used only by tests to drive whole games. */
import * as R from '../../games/thulla/engine/rules.js';

/** Pick a card id for `seat`. */
export function chooseCard(state, seat, rng) {
  rng = rng || Math.random;
  const legal = R.legalCards(state, seat).map(R.parseCard);
  if (legal.length === 1) return legal[0].id;
  const b = state.baari;
  const hand = state.players[seat].hand;

  if (b.plays.length === 0) {
    // Leading: lead low from the longest shape (keeps high cards out of danger).
    const bySuit = {};
    for (const c of hand) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
    const suits = Object.keys(bySuit).sort((a, z) => bySuit[z].length - bySuit[a].length);
    // A little variety so games don't all look alike.
    const pick = rng() < 0.25 && suits.length > 1 ? suits[1] : suits[0];
    return bySuit[pick].sort((a, z) => a.rank - z.rank)[0].id;
  }

  const following = legal.every(c => c.suit === b.leadSuit) && legal[0].suit === b.leadSuit;
  if (following) {
    const top = R.highestOf(b.plays, b.leadSuit).card.rank;
    const sorted = legal.slice().sort((a, z) => z.rank - a.rank);
    if (b.number === 1) return sorted[0].id;           // first baari clears anyway: shed the biggest spade
    const duck = sorted.find(c => c.rank < top);         // stay under the current highest card
    return (duck || sorted[0]).id;                       // can't duck: shed the highest
  }
  // Void in the shape: give Thulla (or, in the first baari, discard) with the most dangerous card.
  return legal.slice().sort((a, z) => z.rank - a.rank)[0].id;
}

/** Should `seat` request the next player's hand? (rare; mostly for demonstration) */
export function wantsToRequest(state, seat, rng, bias) {
  rng = rng || Math.random;
  if (!R.canRequest(state, seat)) return false;
  return rng() < (bias != null ? bias : 0.08);
}

/** Simulated answer to a request. mode: 'mixed' | 'give' | 'keep' */
export function answersRequest(state, seat, mode, rng) {
  rng = rng || Math.random;
  if (mode === 'give') return true;
  if (mode === 'keep') return false;
  return rng() < 0.5;
}


/**
 * Card face model shared by the React <PlayingCard> and the imperative
 * renderer used by table animations, so both produce identical markup.
 */
export const SUIT_NAMES = { C: 'Clubs', D: 'Diamonds', S: 'Spades', H: 'Hearts' };
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

// Pip positions (x%, y%) inside the pip box; y > 50 are drawn upside down.
const L = 0, M = 50, R = 100;
export const PIPS = {
  2: [[M, 0], [M, 100]],
  3: [[M, 0], [M, 50], [M, 100]],
  4: [[L, 0], [R, 0], [L, 100], [R, 100]],
  5: [[L, 0], [R, 0], [M, 50], [L, 100], [R, 100]],
  6: [[L, 0], [R, 0], [L, 50], [R, 50], [L, 100], [R, 100]],
  7: [[L, 0], [R, 0], [M, 25], [L, 50], [R, 50], [L, 100], [R, 100]],
  8: [[L, 0], [R, 0], [M, 25], [L, 50], [R, 50], [M, 75], [L, 100], [R, 100]],
  9: [[L, 0], [R, 0], [L, 33.3], [R, 33.3], [M, 50], [L, 66.6], [R, 66.6], [L, 100], [R, 100]],
  10: [[L, 0], [R, 0], [M, 17], [L, 33.3], [R, 33.3], [L, 66.6], [R, 66.6], [M, 83], [L, 100], [R, 100]],
};

export function parseCardId(id) {
  const suit = id.slice(-1), r = id.slice(0, -1);
  return { id, suit, rank: { J: 11, Q: 12, K: 13, A: 14 }[r] || parseInt(r, 10) };
}
export function rankLabel(rank) { return RANK[rank] || String(rank); }
export function cardName(id) { const c = parseCardId(id); return (RANK_NAME[c.rank] || c.rank) + ' of ' + SUIT_NAMES[c.suit]; }
export function isRed(id) { const s = id.slice(-1); return s === 'H' || s === 'D'; }

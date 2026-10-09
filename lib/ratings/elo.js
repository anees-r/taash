/**
 * Deterministic multiplayer rating update: pairwise Elo, weighted by margin.
 *
 * Every player is compared with every other player in the game. Finishing
 * ahead of someone counts as a win against them, behind as a loss. The usual
 * Elo expectation E = 1 / (1 + 10^((Rb - Ra)/400)) is used for each pair and
 * (score − expectation) is scaled by K / (n − 1), so a game's total swing
 * does not grow with table size.
 *
 * Margin: each pair's swing is multiplied by 1 + MARGIN × gap, where gap is
 * how many baaris apart the two finished, as a share of the whole game
 * (someone still holding cards at the end "finishes" in the last baari).
 * Going out early beats players by more; finishing in the same baari is a
 * plain win. Both sides of a pair use the same multiplier, so it stays
 * zero-sum.
 *
 * Forfeits (players who left): a forfeiter loses every pair at the full
 * margin — against everyone, other leavers included, so if the whole table
 * walks out everyone goes down. Players who stayed are scored on how they
 * played: beating a leaver is an ordinary win, weighted by how early they
 * went out (the leaver counts as finishing at the very end).
 *
 * Guests have no rating: they count as a fixed 1500 opponent and are never
 * updated. Results are rounded to whole points.
 */
export const BASE_RATING = 1500;
export const K = 32;
export const MARGIN = 1;          // a wire-to-wire win counts double

/**
 * @param {{key:string, rating:number|null, place:number, finishedBaari?:number|null, forfeit?:boolean}[]} players  rating null = guest
 * @param {{baaris?:number}} [game]  total baaris played, for the margin
 * @returns {Map<string, number>} delta per rated player key
 */
export function ratingDeltas(players, game = {}) {
  const n = players.length;
  const out = new Map();
  if (n < 2) return out;
  const total = game.baaris || 0;
  const doneAt = p => (p.finishedBaari != null ? p.finishedBaari : total);
  const gap = (a, b) => (total > 0 ? Math.min(1, Math.abs(doneAt(a) - doneAt(b)) / total) : 0);
  for (const a of players) {
    if (a.rating == null) continue;
    let sum = 0;
    for (const b of players) {
      if (a === b) continue;
      const rb = b.rating ?? BASE_RATING;
      const expected = 1 / (1 + Math.pow(10, (rb - a.rating) / 400));
      if (a.forfeit) { sum += (1 + MARGIN) * (0 - expected); continue; }
      const score = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
      sum += (1 + MARGIN * gap(a, b)) * (score - expected);
    }
    out.set(a.key, Math.round((K / (n - 1)) * sum));
  }
  return out;
}

/**
 * Streak bookkeeping. Winning streak = consecutive games finished 1st.
 * Losing streak = consecutive games left holding the cards (leaving counts).
 */
export function nextStreaks(prev, { place, isLoser }) {
  const winStreak = place === 1 ? prev.winStreak + 1 : 0;
  const loseStreak = isLoser ? prev.loseStreak + 1 : 0;
  return { winStreak, loseStreak, bestWinStreak: Math.max(prev.bestWinStreak || 0, winStreak) };
}

/**
 * Deterministic multiplayer rating update (pairwise Elo).
 *
 * Every player is compared with every other player in the game. Finishing
 * ahead of someone counts as a win against them, behind as a loss. The usual
 * Elo expectation E = 1 / (1 + 10^((Rb - Ra)/400)) is used for each pair and
 * the sum of (score − expectation) is scaled by K / (n − 1), so a game's
 * total swing does not grow with table size.
 *
 * Guests have no rating: they count as a fixed 1500 opponent and are never
 * updated. Results are rounded to whole points.
 */
export const BASE_RATING = 1500;
export const K = 32;

/**
 * @param {{key:string, rating:number|null, place:number}[]} players  rating null = guest
 * @returns {Map<string, number>} delta per rated player key
 */
export function ratingDeltas(players) {
  const n = players.length;
  const out = new Map();
  if (n < 2) return out;
  for (const a of players) {
    if (a.rating == null) continue;
    let sum = 0;
    for (const b of players) {
      if (a === b) continue;
      const rb = b.rating ?? BASE_RATING;
      const expected = 1 / (1 + Math.pow(10, (rb - a.rating) / 400));
      const score = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
      sum += score - expected;
    }
    out.set(a.key, Math.round((K / (n - 1)) * sum));
  }
  return out;
}

/**
 * Streak bookkeeping. Winning streak = consecutive games finished 1st.
 * Losing streak = consecutive games left holding the cards.
 */
export function nextStreaks(prev, { place, isLoser }) {
  const winStreak = place === 1 ? prev.winStreak + 1 : 0;
  const loseStreak = isLoser ? prev.loseStreak + 1 : 0;
  return { winStreak, loseStreak, bestWinStreak: Math.max(prev.bestWinStreak || 0, winStreak) };
}

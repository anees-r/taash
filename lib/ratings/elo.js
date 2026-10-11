/**
 * Deterministic multiplayer rating update.
 *
 * A normal game: pairwise Elo weighted by margin. Every player is compared
 * with every other player. Finishing ahead of someone counts as a win against
 * them, behind as a loss. The usual Elo expectation
 * E = 1 / (1 + 10^((Rb - Ra)/400)) is used for each pair and (score − E) is
 * scaled by K / (n − 1), so a game's total swing doesn't grow with table size.
 * Each pair is weighted by 1 + MARGIN × gap, where gap is how many baaris
 * apart the two finished as a share of the game (going out early pays more).
 * Then: only the player left holding the cards can lose points. Everyone
 * who went out gains at least MIN_GAIN, even if the maths says otherwise.
 *
 * A forfeited game: the forfeiter loses as if beaten by everyone (weighted
 * FORFEIT_WEIGHT); every other player gets the same modest FORFEIT_SHARE.
 *
 * Guests have no rating: they count as a fixed 1500 opponent and are never
 * updated. Results are rounded to whole points.
 */
export const BASE_RATING = 1500;
export const K = 32;
export const MARGIN = 1;            // a wire-to-wire win counts double
export const MIN_GAIN = 1;          // going out never costs points
export const FORFEIT_WEIGHT = 1.5;
export const FORFEIT_SHARE = 6;     // what each remaining player gets when someone forfeits

const expect = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

/**
 * @param {{key:string, rating:number|null, place:number, isLoser?:boolean, finishedBaari?:number|null, forfeit?:boolean}[]} players  rating null = guest
 * @param {{baaris?:number, forfeitEnded?:boolean}} [game]
 * @returns {Map<string, number>} delta per rated player key
 */
export function ratingDeltas(players, game = {}) {
  const n = players.length;
  const out = new Map();
  if (n < 2) return out;
  const scale = K / (n - 1);

  if (game.forfeitEnded) {
    for (const a of players) {
      if (a.rating == null) continue;
      if (!a.forfeit) { out.set(a.key, FORFEIT_SHARE); continue; }
      let sum = 0;
      for (const b of players) if (b !== a) sum += FORFEIT_WEIGHT * (0 - expect(a.rating, b.rating ?? BASE_RATING));
      out.set(a.key, Math.min(-1, Math.round(scale * sum)));
    }
    return out;
  }

  const total = game.baaris || 0;
  const doneAt = p => (p.finishedBaari != null ? p.finishedBaari : total);
  const gap = (a, b) => (total > 0 ? Math.min(1, Math.abs(doneAt(a) - doneAt(b)) / total) : 0);
  for (const a of players) {
    if (a.rating == null) continue;
    let sum = 0;
    for (const b of players) {
      if (a === b) continue;
      const score = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
      sum += (1 + MARGIN * gap(a, b)) * (score - expect(a.rating, b.rating ?? BASE_RATING));
    }
    const raw = Math.round(scale * sum);
    out.set(a.key, a.isLoser ? Math.min(-1, raw) : Math.max(MIN_GAIN, raw));
  }
  return out;
}

/**
 * Streak bookkeeping. Winning streak = consecutive games finished 1st.
 * Losing streak = consecutive games left holding the cards (forfeiting counts).
 */
export function nextStreaks(prev, { place, isLoser }) {
  const winStreak = place === 1 ? prev.winStreak + 1 : 0;
  const loseStreak = isLoser ? prev.loseStreak + 1 : 0;
  return { winStreak, loseStreak, bestWinStreak: Math.max(prev.bestWinStreak || 0, winStreak) };
}

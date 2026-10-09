/**
 * Persisting a finished game: match row, participants, rating + streak
 * updates — all in one transaction, exactly once per match id.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client.js';
import { matches, matchPlayers, playerRatings, ratingEvents } from './schema.js';
import { ratingDeltas, nextStreaks, BASE_RATING } from '../ratings/elo.js';

/**
 * @param {object} r
 * @param {string} r.matchId           uuid chosen when the game started
 * @param {string} r.gameId
 * @param {string} r.tableCode
 * @param {number} r.gameNo
 * @param {object} r.settings
 * @param {boolean} [r.ranked]       false: saved to history, ratings untouched
 * @param {Date} r.startedAt
 * @param {object} r.summary
 * @param {{seat:number, userId:string|null, name:string, place:number, isLoser:boolean, forfeit?:boolean, stats:object}[]} r.players
 * @returns {Promise<{duplicate:boolean, ratings: Record<string,{before:number, after:number, delta:number}>}>}
 */
export async function recordMatch(r) {
  return db.transaction(async tx => {
    const inserted = await tx.insert(matches).values({
      id: r.matchId, gameId: r.gameId, tableCode: r.tableCode, gameNo: r.gameNo, settings: { ...r.settings, ranked: r.ranked !== false },
      playerCount: r.players.length, summary: r.summary, startedAt: r.startedAt,
    }).onConflictDoNothing().returning({ id: matches.id });

    if (!inserted.length) {
      // Already processed (a retry or a duplicate event): report what was stored, change nothing.
      const prev = await tx.select().from(ratingEvents).where(eq(ratingEvents.matchId, r.matchId));
      return { duplicate: true, ratings: Object.fromEntries(prev.map(e => [e.userId, { before: e.before, after: e.after, delta: e.delta }])) };
    }

    await tx.insert(matchPlayers).values(r.players.map(p => ({
      matchId: r.matchId, seat: p.seat, userId: p.userId, displayName: p.name.slice(0, 40),
      place: p.place, isLoser: p.isLoser, stats: { ...p.stats, forfeit: !!p.forfeit },
    })));

    const userIds = [...new Set(r.players.filter(p => p.userId).map(p => p.userId))];
    const ratings = {};
    if (!userIds.length || r.ranked === false) return { duplicate: false, ratings };

    // Lock the rows we are about to change so concurrent games serialise.
    const rows = await tx.select().from(playerRatings)
      .where(and(eq(playerRatings.gameId, r.gameId), inArray(playerRatings.userId, userIds)))
      .for('update');
    const byUser = new Map(rows.map(x => [x.userId, x]));
    const current = uid => byUser.get(uid) || { rating: BASE_RATING, peak: BASE_RATING, played: 0, firsts: 0, losses: 0, winStreak: 0, loseStreak: 0, bestWinStreak: 0 };

    const deltas = ratingDeltas(r.players.map(p => ({
      key: p.userId ? 'u:' + p.userId : 's:' + p.seat, rating: p.userId ? current(p.userId).rating : null,
      place: p.place, finishedBaari: p.stats?.finishedBaari ?? null, forfeit: !!p.forfeit,
    })), { baaris: r.summary?.baaris });

    for (const p of r.players) {
      if (!p.userId) continue;
      const cur = current(p.userId);
      const delta = deltas.get('u:' + p.userId) || 0;
      const after = cur.rating + delta;
      const streaks = nextStreaks(cur, { place: p.place, isLoser: p.isLoser || !!p.forfeit });
      const next = {
        rating: after, peak: Math.max(cur.peak, after), played: cur.played + 1,
        firsts: cur.firsts + (p.place === 1 && !p.forfeit ? 1 : 0), losses: cur.losses + (p.isLoser || p.forfeit ? 1 : 0),
        ...streaks, updatedAt: new Date(),
      };
      await tx.insert(playerRatings).values({ userId: p.userId, gameId: r.gameId, ...next })
        .onConflictDoUpdate({ target: [playerRatings.userId, playerRatings.gameId], set: next });
      await tx.insert(ratingEvents).values({ matchId: r.matchId, userId: p.userId, gameId: r.gameId, before: cur.rating, after, delta });
      ratings[p.userId] = { before: cur.rating, after, delta };
    }
    return { duplicate: false, ratings };
  });
}


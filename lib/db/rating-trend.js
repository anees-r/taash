import { and, eq, desc } from 'drizzle-orm';
import { db } from './client.js';
import { ratingEvents } from './schema.js';

/** Ratings after each of the last `n` games, oldest → newest (for the sparkline). */
export async function ratingTrend(userId, gameId = 'thulla', n = 20) {
  const rows = await db.select({ before: ratingEvents.before, after: ratingEvents.after }).from(ratingEvents)
    .where(and(eq(ratingEvents.userId, userId), eq(ratingEvents.gameId, gameId))).orderBy(desc(ratingEvents.createdAt)).limit(n);
  if (!rows.length) return [];
  rows.reverse();
  return [rows[0].before, ...rows.map(r => r.after)];
}

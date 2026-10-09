/**
 * Small per-process cache of the auth-relevant user fields, so validating a
 * session (is it still current? what is the display name now?) costs at most
 * one primary-key lookup per user every 30 seconds.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

const TTL = 30_000;
const g = globalThis;
const cache = g.__taashUserCache || (g.__taashUserCache = new Map());

/** @returns {Promise<{sv:number, name:string, handle:string} | null>} */
export async function getUserAuthInfo(uid) {
  if (!uid) return null;
  const hit = cache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.v;
  const [row] = await db.select({ sv: users.sessionVersion, name: users.name, handle: users.handle }).from(users).where(eq(users.id, uid)).limit(1);
  const v = row || null;
  cache.set(uid, { v, exp: Date.now() + TTL });
  if (cache.size > 5000) { for (const k of cache.keys()) { cache.delete(k); if (cache.size < 4000) break; } }
  return v;
}

export function invalidateUser(uid) { cache.delete(uid); }

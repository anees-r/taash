/**
 * "Forgot password" tokens: 32 random bytes sent by email, stored only as a
 * SHA-256 hash. One live token per account (asking again replaces it), single
 * use, valid for RESET_MINUTES. Using one signs the account out everywhere.
 */
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, passwordResets } from '../db/schema.js';

export const RESET_MINUTES = 30;
const PER_ACCOUNT_PER_HOUR = 3;

const hashToken = t => createHash('sha256').update(String(t)).digest('hex');

/** Account for an email or username (with or without @). */
export async function findAccount(login) {
  const v = String(login || '').trim().toLowerCase();
  if (!v) return null;
  const byEmail = v.includes('@') && !v.startsWith('@');
  const key = byEmail ? v : v.replace(/^@/, '');
  const [u] = await db.select({ id: users.id, name: users.name, handle: users.handle, email: users.email }).from(users)
    .where(byEmail ? dsql`lower(${users.email}) = ${key}` : dsql`lower(${users.handle}) = ${key}`).limit(1);
  return u || null;
}

/** A new reset token for the user, or null if they asked too often in the last hour. */
export async function createReset(userId) {
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const [{ n }] = await db.select({ n: dsql`count(*)::int` }).from(passwordResets)
    .where(and(eq(passwordResets.userId, userId), gt(passwordResets.createdAt, hourAgo)));
  if (n >= PER_ACCOUNT_PER_HOUR) return null;
  const token = randomBytes(32).toString('base64url');
  await db.transaction(async tx => {
    await tx.update(passwordResets).set({ usedAt: new Date() })                   // older links stop working
      .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
    await tx.insert(passwordResets).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
  });
  return token;
}

/** Is this link still usable? Returns the account it belongs to, or null. */
export async function checkReset(token) {
  if (!token || String(token).length > 200) return null;
  const [row] = await db.select({ userId: passwordResets.userId, handle: users.handle, name: users.name })
    .from(passwordResets).innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
    .limit(1);
  return row || null;
}

/** Set the new password and burn the token, atomically. Returns the user id, or null if the link is no good. */
export async function redeemReset(token, passwordHash) {
  if (!token || String(token).length > 200) return null;
  return db.transaction(async tx => {
    const [row] = await tx.select({ id: passwordResets.id, userId: passwordResets.userId }).from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
      .for('update').limit(1);
    if (!row) return null;
    await tx.update(users).set({ passwordHash, sessionVersion: dsql`${users.sessionVersion} + 1` }).where(eq(users.id, row.userId));
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)));
    return row.userId;
  });
}

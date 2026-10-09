/**
 * Guest identity: a random id + display name in an httpOnly cookie, signed
 * with AUTH_SECRET so it cannot be forged or edited. Guests get no account,
 * rating, history or friends — this only lets the server recognise the same
 * guest across reconnects.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../env.js';

export const GUEST_COOKIE = 'taash.guest';
export const GUEST_MAX_AGE = 60 * 60 * 24 * 30;   // 30 days

const b64 = s => Buffer.from(s).toString('base64url');
const sign = data => createHmac('sha256', config.authSecret).update('guest:' + data).digest('base64url');

export function newGuestId() { return 'g_' + randomBytes(12).toString('base64url'); }

export function encodeGuest({ id, name }) {
  const data = b64(JSON.stringify({ id, name, v: 1 }));
  return data + '.' + sign(data);
}

/** @returns {{id:string, name:string} | null} */
export function decodeGuest(value) {
  if (!value || typeof value !== 'string') return null;
  const [data, sig] = value.split('.');
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const o = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (typeof o.id !== 'string' || !/^g_[\w-]{10,32}$/.test(o.id) || typeof o.name !== 'string') return null;
    return { id: o.id, name: o.name };
  } catch { return null; }
}

export function guestCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: GUEST_MAX_AGE };
}

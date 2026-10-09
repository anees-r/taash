/**
 * Who is making a request: a registered user (Auth.js session), a guest
 * (signed guest cookie), or nobody. Used by pages, server actions and the
 * Socket.IO handshake. Identity always comes from cookies the server signed,
 * never from ids sent by the browser.
 */
import { decode } from 'next-auth/jwt';
import { config } from '../env.js';
import { decodeGuest, GUEST_COOKIE } from './guest.js';
import { getUserAuthInfo } from './user-cache.js';

const SESSION_COOKIE = config.secureCookies ? '__Secure-authjs.session-token' : 'authjs.session-token';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

/**
 * @typedef {{kind:'user', playerId:string, userId:string, name:string, handle:string, guest:false}
 *         | {kind:'guest', playerId:string, userId:null, name:string, guest:true, handle:null}
 *         | {kind:'anon'}} Viewer
 */

/** Resolve a viewer from a raw Cookie header (Socket.IO handshake). @returns {Promise<Viewer>} */
export async function viewerFromCookieHeader(header) {
  const c = parseCookies(header);
  let token = c[SESSION_COOKIE];
  if (!token && c[SESSION_COOKIE + '.0']) {           // chunked cookie
    token = ''; for (let i = 0; c[SESSION_COOKIE + '.' + i]; i++) token += c[SESSION_COOKIE + '.' + i];
  }
  if (token) {
    try {
      const jwt = await decode({ token, secret: config.authSecret, salt: SESSION_COOKIE });
      if (jwt && jwt.uid) {
        const info = await getUserAuthInfo(jwt.uid);
        if (info && info.sv === jwt.sv) return userViewer(jwt.uid, info.name, info.handle);
      }
    } catch { /* invalid or expired token: fall through */ }
  }
  return guestViewer(decodeGuest(c[GUEST_COOKIE]));
}

export function userViewer(uid, name, handle) {
  return { kind: 'user', playerId: 'u:' + uid, userId: uid, name, handle, guest: false };
}
export function guestViewer(g) {
  return g ? { kind: 'guest', playerId: 'g:' + g.id, userId: null, name: g.name, guest: true, handle: null } : { kind: 'anon' };
}

'use client';
/**
 * One Socket.IO connection per browser tab, opened lazily. Same origin as the
 * page, so the session/guest cookies authenticate it. Reconnects automatically.
 */
import { io } from 'socket.io-client';

let socket = null;
let identity = null;      // which signed-in user / guest the current socket belongs to

/**
 * Called during render by <Providers> with the server-decided viewer. If the
 * identity changed (signed in, signed out, became a guest), the old connection
 * is dropped so the next one authenticates with the new cookies.
 */
export function setSocketIdentity(key) {
  if (identity !== null && identity !== key) resetSocket();
  identity = key;
}

export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
  }
  return socket;
}

/** Call after sign-in, sign-out or guest-name changes so the server sees the new cookies. */
export function resetSocket() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}

/** Emit with an acknowledgement. Resolves to the server's reply or {error}. */
export function call(event, payload, timeout = 8000) {
  const s = getSocket();
  return new Promise(resolve => {
    s.timeout(timeout).emit(event, payload, (err, res) => {
      if (err) resolve({ error: s.connected ? 'The server did not answer. Try again.' : 'You are offline. Reconnecting…', code: 'timeout' });
      else resolve(res || { ok: true });
    });
  });
}

let counter = 0;
export function actionId() { return Date.now().toString(36) + '-' + (++counter).toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

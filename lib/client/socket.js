'use client';
/**
 * One Socket.IO connection per browser tab, opened lazily. Same origin as the
 * page, so the session/guest cookies authenticate it. Reconnects automatically.
 */
import { io } from 'socket.io-client';

let socket = null;

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

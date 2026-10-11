/** Read-only access to live, in-memory state owned by the realtime server. */
import 'server-only';

export function isOnline(userId) { return !!globalThis.__taashPresence?.get(userId); }
export function tableManager() { return globalThis.__taashTables || null; }
export function openTablesOf(userIds) { const m = tableManager(); return m ? m.openTablesFor(userIds) : []; }
export function publicTables() { const m = tableManager(); return m ? m.publicTables() : []; }
/** Push an event to every open tab of a signed-in user (friend requests and the like). */
export function notifyUser(userId, event, data) { globalThis.__taashNotify?.(userId, event, data); }
export function tableOf(playerId) { const m = tableManager(); return m && playerId ? m.tableOf(playerId) : null; }

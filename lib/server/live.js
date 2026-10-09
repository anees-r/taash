/** Read-only access to live, in-memory state owned by the realtime server. */
import 'server-only';

export function isOnline(userId) { return !!globalThis.__taashPresence?.get(userId); }
export function tableManager() { return globalThis.__taashTables || null; }
export function openTablesOf(userIds) { const m = tableManager(); return m ? m.openTablesFor(userIds) : []; }

/**
 * Resource check: plays many complete games through the TableManager (no
 * network, no database) and reports heap use, so leaks across repeated games,
 * rematches and table cleanup show up as growth.   node scripts/soak.js [games]
 */
import { TableManager } from '../lib/game-engine/table-manager.js';
import { thulla } from '../games/thulla/match.js';
import { defaultSettings } from '../games/thulla/settings.js';

const GAMES = Number(process.argv[2] || 300);
let now = 1e12;
const pending = [];
const realSetTimeout = setTimeout;
// Virtual clock: run timers instantly in order.
globalThis.setTimeout = (fn, ms) => { const t = { at: now + (ms || 0), fn, cleared: false, unref() {} }; pending.push(t); return t; };
globalThis.clearTimeout = t => { if (t) t.cleared = true; };
function runAll(limit = 1e6) {
  for (let i = 0; i < limit && pending.length; i++) {
    pending.sort((a, b) => a.at - b.at);
    const t = pending.shift();
    if (t.cleared) continue;
    now = Math.max(now, t.at);
    t.fn();
  }
}
const transport = { broadcast() {}, send() {}, joinRoom() {}, leaveRoom() {} };
const tm = new TableManager({ games: { thulla }, transport, persistResult: async () => ({ ratings: {} }), now: () => now });
const who = i => ({ playerId: 'g:' + i, userId: null, name: 'P' + i, guest: true });

const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576 * 10) / 10;
global.gc?.();
const start = mb();
for (let g = 0; g < GAMES; g++) {
  const n = 2 + (g % 5);
  const { code } = tm.createTable(who(0), 'thulla', { ...defaultSettings(), players: n, turnSeconds: 5, pileSeconds: 1 });
  tm.attach(who(0), code);
  for (let i = 1; i < n; i++) { tm.join(who(i), code); tm.attach(who(i), code); tm.setReady(who(i), code, true); }
  tm.start(who(0), code);
  runAll(20000);
  if (tm.get(code).status !== 'finished') throw new Error('game did not finish');
  tm.start(who(0), code);          // rematch
  runAll(20000);
  for (let i = 0; i < n; i++) tm.leave(who(i), code);
  await new Promise(r => setImmediate(r));   // let result-saving promises settle
  if ((g + 1) % 100 === 0) { global.gc?.(); console.log(`${g + 1} tables × 2 games: heap ${mb()} MB, live tables ${tm.tables.size}, pending timers ${pending.filter(t => !t.cleared).length} (queue ${pending.length})`); }
}
global.gc?.();
console.log(`heap before ${start} MB, after ${mb()} MB`);
void realSetTimeout;

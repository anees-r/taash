/**
 * Taash server: Next.js and Socket.IO in ONE Node process on ONE port.
 *
 *   node server.js            (dev, with hot reload)
 *   NODE_ENV=production node server.js
 *
 * There is no separate realtime service to deploy: Coolify runs this single
 * container; WebSocket upgrades on /socket.io go through the same proxy and
 * port as every page request.
 */
import { createServer } from 'node:http';
import nextEnv from '@next/env';

const dev = process.env.NODE_ENV !== 'production';
nextEnv.loadEnvConfig(process.cwd(), dev);

const { default: next } = await import('next');
const { config } = await import('./lib/env.js');
const { log } = await import('./lib/log.js');
const { attachRealtime } = await import('./lib/realtime/socket-server.js');
const { sql } = await import('./lib/db/client.js');

const app = next({ dev, hostname: 'localhost', port: config.port });
const handle = app.getRequestHandler();
await app.prepare();

let realtime;
const server = createServer(async (req, res) => {
  // Liveness/readiness for Coolify: process up and database reachable.
  if (req.url === '/healthz') {
    try {
      await sql`select 1`;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...realtime.manager.stats(), uptime: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1048576) }));
    } catch {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"ok":false,"db":false}');
    }
    return;
  }
  handle(req, res);
});

realtime = attachRealtime(server);

// Next's own upgrade handling (dev hot reload). Socket.IO handles /socket.io.
const upgrade = app.getUpgradeHandler();
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/socket.io')) upgrade(req, socket, head);
});

server.listen(config.port, config.host, () => {
  log.info(`Taash ready on ${config.appUrl} (listening ${config.host}:${config.port}, ${dev ? 'development' : 'production'})`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  realtime.manager.shutdown();
  realtime.io.close();
  server.close();
  await sql.end({ timeout: 5 }).catch(() => {});
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

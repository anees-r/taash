/**
 * One small connection pool per process. Kept on globalThis so Next's
 * bundled server code and the custom server share the same pool.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../env.js';
import * as schema from './schema.js';

const g = globalThis;
if (!g.__taashDb) {
  const sql = postgres(config.databaseUrl, {
    max: config.dbPoolMax,
    idle_timeout: 30,          // seconds: release idle connections on a quiet server
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {},
  });
  g.__taashDb = { sql, db: drizzle(sql, { schema }) };
}

export const sql = g.__taashDb.sql;
export const db = g.__taashDb.db;
export { schema };

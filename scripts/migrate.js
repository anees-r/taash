/**
 * Applies pending Drizzle migrations. Safe to run on every deploy: only
 * migrations not yet recorded in drizzle.__drizzle_migrations are applied,
 * each inside a transaction. It never drops data on its own.
 */
import nextEnv from '@next/env';
import { fileURLToPath } from 'node:url';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const { db, sql } = await import('../lib/db/client.js');
const url = new URL(process.env.DATABASE_URL || 'postgres://localhost/taash');
console.log(`Applying migrations to ${url.hostname}/${url.pathname.slice(1)}…`);
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../lib/db/migrations', import.meta.url)) });
console.log('Migrations up to date.');
await sql.end();

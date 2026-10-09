/** @type {import('drizzle-kit').Config} */
export default {
  schema: './lib/db/schema.js',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL || 'postgres://taash:taash@localhost:5432/taash' },
};

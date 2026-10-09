# Deploying to Arcanum with Coolify

Taash is **one container** (Next.js + Socket.IO on port 3000) plus **PostgreSQL**. Socket.IO is not a separate service: WebSockets use the same domain and port as the pages, at `/socket.io`. Coolify's proxy (Traefik or Caddy) forwards WebSocket upgrades automatically. No extra configuration is needed.

> Nothing in this repository deploys anything by itself. Follow these steps when you are ready.

## 1. PostgreSQL

In Coolify: **+ New → Database → PostgreSQL 16**, in the same project/environment as the app.
- Note the **internal** connection URL (`postgres://…@<service-name>:5432/<db>`). The app connects over Coolify's internal network; the database does not need a public port.
- Turn on Coolify's **scheduled backups** for it (see *Backups* below).

## 2. The app

**+ New → Application → (your Git repository)**, then:

| Setting | Value |
| --- | --- |
| Build pack | **Dockerfile** (uses `./Dockerfile`) |
| Port | `3000` |
| Domain | `https://taash.nezden.com` |
| Health check path | `/healthz` (port 3000) |
| Replicas | **1** (games live in memory; see ARCHITECTURE.md) |

Environment variables (Coolify → app → Environment Variables):

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://taash.nezden.com` |
| `AUTH_URL` | `https://taash.nezden.com` |
| `AUTH_SECRET` | 32+ random bytes, e.g. `openssl rand -base64 32`. **Keep it secret and stable**: changing it signs everyone out and resets guest identities. |
| `DATABASE_URL` | the internal PostgreSQL URL from step 1 |
| `AUTH_TRUST_HOST` | `true` |
| `DB_POOL_MAX` | `8` (optional) |
| `LOG_LEVEL` | `info` (optional) |
| `NODE_OPTIONS` | `--max-old-space-size=256` (optional cap for small servers) |

Do **not** set `TAASH_E2E` in production.

The domain is never hard-coded: auth callbacks, cookies, share links and the socket origin check all come from `APP_URL`. Because `APP_URL` is `https://…`, all cookies are marked `Secure` (the session cookie also gets the `__Secure-` prefix). Coolify terminates HTTPS and forwards `X-Forwarded-*` headers, which `AUTH_TRUST_HOST=true` lets Auth.js use.

**Migrations run on every start** (`scripts/start.sh` → `node scripts/migrate.js`). They only apply migrations that haven't been applied, each in a transaction, and never drop data. To run them yourself instead, set `RUN_MIGRATIONS=false` and run `node scripts/migrate.js` from Coolify's terminal.

## 3. Deploy and check

1. Deploy. The build takes a few minutes the first time.
2. Open `https://taash.nezden.com/healthz`. You should see `{"ok":true,…}`.
3. Create a table in one browser and join from another (or a phone) with the code. A full round trip confirms WebSockets work through the proxy.

If the table page stays on "Taking your seat…", WebSockets are being blocked by something in front of Coolify (for example a Cloudflare setting). Socket.IO falls back to long-polling over HTTP, which also works with a single replica.

## Updating

Push to the branch Coolify watches, or click **Redeploy**. A redeploy restarts the process, so **games in progress end** (finished games, accounts and ratings are safe). Redeploy when nobody is mid-game. `/healthz` shows `playing` (tables with a game running).

## Backups

- **Coolify:** database → **Backups** → enable scheduled backups (daily is plenty) and, ideally, an S3-compatible destination off the server.
- **Manual dump** (from Coolify's terminal for the database, or any machine that can reach it):
  ```sh
  pg_dump --format=custom --no-owner "$DATABASE_URL" > taash-$(date +%F).dump
  ```
- **Restore** into an empty database:
  ```sh
  pg_restore --no-owner --dbname "$DATABASE_URL" taash-YYYY-MM-DD.dump
  ```
  Then start the app; migrations bring the schema up to date.
- Only PostgreSQL needs backing up. The app container is stateless.

## Schema changes

1. Edit `lib/db/schema.js`.
2. `npm run db:generate` → review the new SQL in `lib/db/migrations/`.
3. Commit and deploy; the migration runs on start.

Avoid destructive migrations (dropping or renaming columns with data) without a backup and a two-step change (add new → backfill → remove old in a later release).

## Local production-like run with Docker Desktop

```powershell
docker compose --profile app up --build
# → http://localhost:3000  (PostgreSQL in the db service; migrations run automatically)
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/healthz` returns 503 | `DATABASE_URL` is wrong or the database is down |
| Sign-in redirects to the wrong host | `APP_URL`/`AUTH_URL` must match the public domain exactly (https, no trailing slash) |
| Everyone signed out after a deploy | `AUTH_SECRET` changed; keep it fixed |
| "origin not allowed" in the browser console | `APP_URL` does not match the site's address |
| Memory creeping up | Check `/healthz` → `tables`; idle tables close after 10 minutes with nobody connected. `npm run soak` reproduces long sessions locally. |

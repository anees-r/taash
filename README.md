# Taash

Traditional card games with friends, in the browser. The first game is **Thulla**.

- **One app, one port.** Next.js (App Router) and Socket.IO run in the same Node process (`server.js`). There is no separate realtime service to deploy.
- **JavaScript only** (`.js` / `.jsx`, JSDoc for types).
- **PostgreSQL + Drizzle** for durable data (accounts, friends, match history, ratings). Games in progress live in server memory.
- **Auth.js (NextAuth v5)** for accounts, with email + password (Argon2id). Guests play with just a display name.
- **Server-authoritative**: the server shuffles, deals, validates every action, and runs every timer. Browsers only send actions and animate the server's events.

More detail is in [`docs/`](docs):
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md): how it fits together, the realtime protocol, security, and resource use.
- [`RULES-AND-DECISIONS.md`](docs/RULES-AND-DECISIONS.md): the Thulla rules as implemented, the timeout and away policy, and the rating method.
- [`DEPLOYMENT.md`](docs/DEPLOYMENT.md): Coolify on Arcanum, backups, migrations and monitoring.

---

## Local development on Windows

You need **Node.js 22 LTS** (20.9+ works) and **Docker Desktop** (for PostgreSQL). Use PowerShell or Windows Terminal.

```powershell
# 1. Install dependencies
npm install

# 2. Start PostgreSQL in Docker (data persists in a Docker volume)
docker compose up -d db

# 3. Configure the environment
copy .env.example .env
# then edit .env and set AUTH_SECRET to a long random string, e.g. the output of:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 4. Create the tables
npm run db:migrate

# 5. Run the app (Next.js + Socket.IO with hot reload)
npm run dev
# → http://localhost:3000
```

The defaults in `.env.example` match the `db` service in `docker-compose.yml` (`postgres://taash:taash@localhost:5432/taash`). If you already have PostgreSQL installed natively, create a `taash` user and database and point `DATABASE_URL` at it instead.

To try multiplayer on one machine, open a second browser profile or a private window and join with the table code. Each window is its own player.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload (`node server.js`) |
| `npm run build` | Production build (`next build`) |
| `npm start` | Production server (`NODE_ENV=production node server.js`) |
| `npm run db:migrate` | Apply pending migrations (safe to run repeatedly) |
| `npm run db:generate` | Create a migration after changing `lib/db/schema.js` |
| `npm run db:studio` | Browse the database with Drizzle Studio |
| `npm test` | Unit tests: rules engine, game module, table manager, ratings |
| `npm run test:integration` | Socket.IO + auth + database tests (needs PostgreSQL) |
| `npm run test:e2e` | Browser tests: full multiplayer games, hand reveal, accounts, all 52 cards (needs `npm run build` first) |
| `npm run soak` | Plays thousands of games in memory and reports heap use (leak check) |

### Running the end-to-end tests

```powershell
npm run build
npx playwright install chromium   # first time only
npm run test:e2e
```

Playwright starts its own production server on port 3100 with `TAASH_E2E=1`. That setting lets tests ask for short deals (a few cards each) and enables the `/dev/cards` card sheet. **Never set `TAASH_E2E` in production.**

---

## Project layout

```
server.js                    Next.js + Socket.IO on one HTTP server; /healthz; graceful shutdown
app/                         Routes (App Router): home, games/thulla, rules, join, t/[code], profile,
                             u/[handle], friends, leaderboard, signin, register, api/*, actions/*
components/platform/         Shared platform UI (top bar, modal, chat, lobby, results, profile…)
components/game/             PlayingCard + card model shared by every standard-deck game
games/
  catalog.js                 Game list shown on the platform (Thulla playable; others "in the workshop")
  server-registry.js         Server-side game modules
  client-registry.js         Browser-side game modules (settings form, table view)
  thulla/
    engine/rules.js          Pure rules engine (no DOM, no sockets) — the source of truth
    match.js                 Server game module: deadlines, timeout/away policy, reveal, redaction
    settings.js              Settings defaults, limits and server-side validation
    client/                  Table view (animations), settings form, How to Play guide
lib/
  game-engine/               Table manager (seats, host, lobby, timers, results) + module interface
  realtime/                  Socket.IO server: auth handshake, validation, rate limits
  auth/                      Auth.js config, guest cookie, password hashing, viewer helpers
  db/                        Drizzle schema, migrations, queries
  ratings/                   Rating and streak calculations
  client/                    Browser helpers (socket, DOM, sound, toasts)
styles/                      The prototype's stylesheets (unchanged except the card fix) + app.css
tests/unit|integration|e2e   Automated tests
```

## Adding another game

1. Create `games/<id>/` with a pure rules engine and a server module that implements `lib/game-engine/interface.js` (`createMatch`, `act`, `onDeadline`, `publicView`, `privateView`, `results`, settings validation).
2. Register it in `games/server-registry.js`, `games/client-registry.js` (settings form and table view), and `games/catalog.js` (status `playable`).
3. Add a row to the `games` table with a migration.

Tables, lobby, invites, chat, results, ratings (stored per game), leaderboards and profiles work unchanged.

## What restarts mean

Games in progress live in memory. If the server restarts during a game, that game ends: players see "The server restarted…" and can open a new table. Finished games, accounts, friends and ratings are in PostgreSQL and are not affected. See *Trade-offs* in `docs/ARCHITECTURE.md`.

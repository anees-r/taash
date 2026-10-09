# Architecture

## One process

```
Browser ──HTTP──▶ ┌──────────────────────── server.js (Node 22) ───────────────────────┐
         ──WS───▶ │  Next.js request handler        Socket.IO (/socket.io)             │
                  │   pages, server actions,        identity from signed cookies       │
                  │   Auth.js routes                zod validation · rate limits       │
                  │          │                              │                          │
                  │          │ read-only                    ▼                          │
                  │          └──────────────▶  TableManager (in memory)                │
                  │                              seats · host · chat · deadlines       │
                  │                              ─▶ game module (games/thulla/match)   │
                  │                                   ─▶ pure rules (engine/rules.js)  │
                  │                                         │ at game end              │
                  └──────────────────────────────────────── ▼ ─────────────────────────┘
                                                      PostgreSQL (Drizzle)
```

- **Next.js** renders pages on the server (most screens are server components: home, profile, leaderboard, friends) and handles server actions (sign-up, sign-in, profile, friends).
- **Socket.IO** is attached to the same HTTP server. `/socket.io` WebSocket upgrades are handled by Socket.IO; any other upgrade (Next's dev hot reload) goes to Next.
- **TableManager** (`lib/game-engine/table-manager.js`) owns every live table. It is game-agnostic and talks to a game only through the module interface (`lib/game-engine/interface.js`).
- **Thulla** is a pure engine (`games/thulla/engine/rules.js`, the prototype's engine as an ES module) wrapped by `games/thulla/match.js`. The wrapper adds deadlines, the timeout/away policy, the public hand-transfer reveal, and per-player redaction.

## Identity and authorization

| Who | How the server knows | Can |
| --- | --- | --- |
| Registered user | Auth.js session cookie (JWT, signed with `AUTH_SECRET`) | everything |
| Guest | `taash.guest` cookie: random id + display name, HMAC-signed | create/join tables, play, chat |
| Anonymous | no valid cookie | browse; must pick a name or sign in to sit down |

- Socket connections are authenticated once, in the handshake, from those cookies. **No payload ever carries a player id that the server trusts.** Table, host and turn checks use the handshake identity.
- Every socket event is validated with zod (`lib/realtime/socket-server.js`) and rate-limited per player.
- Host-only actions (settings, start, kick, rematch) are checked in the TableManager. Settings are locked while a game is in progress.
- Cross-site WebSocket connections are refused (Origin check).
- **Sessions:** Auth.js needs the JWT strategy for credentials. Each token carries `session_version`, which is checked against the database (cached for 30 s) on every use. "Sign out everywhere" and password changes increment it, so old tokens stop working everywhere.
- Passwords use Argon2id (`@node-rs/argon2`). Unknown emails take the same time as wrong passwords, so timing does not reveal which emails have accounts.
- Server actions only ever modify the signed-in user's own rows. Friend actions check that the user is the addressee (accept/decline) or a party to the friendship (remove).

## Realtime protocol

Client → server (all acknowledged with `{ok}` or `{error}`):

| Event | Payload |
| --- | --- |
| `table:create` | `{gameId, settings}` |
| `table:join` / `table:sync` / `table:unwatch` / `table:leave` | `{code}` |
| `table:ready` | `{code, ready}` |
| `table:settings` (host) | `{code, settings}` |
| `table:kick` (host) | `{code, playerId}` |
| `table:start` (host) | `{code}` |
| `table:invite` | `{code, userIds}`: friends only, checked in the database |
| `game:action` | `{code, actionId, action}`, where `action` is `play {card}`, `request`, `answer {accept}` or `back` |
| `chat:send` | `{code, text}` (≤ 400 chars, plain text) |

Server → client:

| Event | To | Contains |
| --- | --- | --- |
| `table:state` | table | seats, readiness, host, settings, status |
| `game:snapshot` | one player | starting snapshot: public view + **that player's hand only** |
| `game:events` | table | `{seq, now, events[]}`: public events in order |
| `game:hand` | one player | `{seq, hand}`: the player's own hand after it changed |
| `game:deadline` | table | a re-based deadline after a pause |
| `table:result` | table | finishing order, summary, rating changes (keyed by player id) |
| `chat:msg` | table | `{id, kind, from, name, text, at}` |
| `table:closed` / `table:kicked` / `invite` | table / player | |

**Private vs public.** Public views and events never contain hands. Each player's hand goes only to that player's own sockets (`p:<playerId>` room). The one exception is deliberate: an accepted hand request emits a public `transfer-reveal` event with exactly the transferred cards and the reveal's end time.

**Ordering, duplicates and reconnects.** Each event batch has an increasing `seq`. The browser ignores batches it has already seen and asks for a fresh snapshot (`table:sync`) if it detects a gap. Actions carry an `actionId`, and a retried action is acknowledged without being applied twice. Reconnecting players get a snapshot that includes the current phase, deadline, any baari on the table, and the remaining time of a reveal in progress.

**Timers.** Each table has at most one pending deadline (turn, request answer, pile display, reveal, deal) and one `setTimeout`. Deadlines are absolute server times; browsers show them with a CSS transition plus a 1-second tick for the number. A timeout and a player action can never both apply: both run on the same thread, and the deadline handler checks that its deadline id is still current.

## Data model

| Table | Purpose |
| --- | --- |
| `users` | Display name, unique handle and email (case-insensitive unique indexes), Argon2 hash, `session_version`, prefs |
| `accounts`, `sessions`, `verification_tokens` | Auth.js adapter tables (ready for OAuth providers) |
| `games` | Catalogue (`thulla` playable; `rung`, `bluff`, `seep` planned) |
| `friendships` | One row per pair (unique on `least/greatest` of the two ids), `pending`/`accepted`, no self-friendship (check constraint) |
| `matches` | One per finished game. Primary key is a UUID chosen when the game **starts**, so a retried save conflicts instead of duplicating |
| `match_players` | Seat, place, loser flag, stats. `user_id` is null for guests (display name kept for history) |
| `player_ratings` | Per user and game: rating, peak, played, firsts, losses, win/lose streaks. Indexed for leaderboards |
| `rating_events` | Primary key (`match_id`, `user_id`): the exactly-once guard for rating changes |

A finished game is written in **one transaction**: insert the match (or stop if it already exists), insert the players, lock the players' rating rows, compute deltas, then update ratings and insert rating events.

## Resource efficiency (sized for a home server)

| Decision | Why |
| --- | --- |
| Single process; no Redis, queues, workers or microservices | Nothing to coordinate; one container to watch |
| Game state in memory, written to PostgreSQL once per finished game | No database writes per card or per tick |
| One timer per table, none per client; no polling anywhere | Idle tables cost nothing |
| Clock pauses when nobody at a table is connected; abandoned tables close after 10 min; empty lobbies close immediately | No CPU spent auto-playing to an empty room |
| Small event batches; hands sent only to their owner and only when they change | Low bandwidth; the full state is sent only on join/reconnect |
| Socket.IO without per-message compression, 16 KB message cap | Less CPU per message; oversized payloads rejected |
| PostgreSQL pool capped (`DB_POOL_MAX`, default 8) with 30 s idle release | Few connections on a small server |
| Selective, indexed queries; leaderboards paged (50); history limited (20) | No full-history scans on page loads |
| Animations in CSS/WAAPI; the turn ring and bar are CSS transitions; one 1 s tick only while a deadline is visible | No `requestAnimationFrame` loops |
| Most pages are server components; the table view is plain DOM (the prototype's) inside one React host | Little client JavaScript; the hand isn't re-rendered by React on every event |
| Dependencies kept to: next, react, next-auth, drizzle, postgres, socket.io, zod, argon2 | No UI framework or duplicate libraries |

Measured locally: about 120–130 MB RSS at idle after start. `npm run soak` played 1,000 tables × 2 games each, and the heap stayed flat (4–5 MB of game data) with no leftover timers or tables.

### Monitoring

- `GET /healthz` → `{ok, tables, playing, players, uptime, rssMb}`; returns 503 if the database is unreachable. Coolify uses it as the health check.
- `docker stats` (or Coolify's resource graphs) for CPU and memory of the container.
- PostgreSQL connections: `select count(*) from pg_stat_activity where datname = 'taash';` (should stay ≤ `DB_POOL_MAX`).
- Logs are JSON lines in production (`LOG_LEVEL=info`). They contain table codes and counts, never passwords, tokens, cookies or cards.
- To cap Node's heap on a very small box: set `NODE_OPTIONS=--max-old-space-size=256`.

## Trade-offs

- **In-memory games end on restart.** Deploys and crashes end games in progress (players are told). Persisting live state after every action would add constant database writes for a rare event. If this becomes a problem, the natural next step is to snapshot `match` objects on graceful shutdown and restore them on start. The engine state is plain data, so that is straightforward.
- **One instance only.** Tables live in one process, so do not scale the app horizontally (Coolify: keep replicas at 1). A single Node process comfortably serves hundreds of concurrent tables.
- **Guests' history is not kept.** Guests appear by display name in registered players' history; they have no profile of their own.

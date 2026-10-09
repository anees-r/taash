# Thulla: rules as implemented, and decisions

The engine is `games/thulla/engine/rules.js` (pure, deterministic once shuffled). Server policy (timers, away, reveal) is in `games/thulla/match.js`. Tests: `tests/unit/thulla-*.test.js`.

## Rules

- **Deck:** 52 cards, no jokers. A K Q J 10 … 2, high to low. No trump.
- **Deal:** the server shuffles (crypto-backed random), then deals one card at a time anti-clockwise, starting with the seat after the dealer, until the deck runs out. Uneven counts differ by at most one card. The dealer rotates each game.
- **First baari:** the A♠ holder must open with the A♠. Everyone must follow Spades if they can; anyone without Spades discards any card, and that is **never** a Thulla. The whole baari is cleared. No requests are allowed. The highest Spade (the A♠ player) starts baari 2.
- **Later baaris:** the leader plays any card, which sets the shape. Players must follow it if they can (the server rejects an off-shape card from anyone holding the shape). The first off-shape card is a **Thulla**: the baari stops at once, and players who haven't played keep their cards. The highest card **of the shape played before the Thulla** collects the whole pile, Thulla card included, and leads next. If nobody gives Thulla, the pile is cleared for good and the highest card leads next.
- **Finishing:** a player who plays their last card finishes only when the baari resolves. If they must collect a Thulla pile, they stay in. Several players finishing in one baari finish in play order. The last player holding cards loses.
- **Next starter when the winner has finished:** the player with the next-highest card of the shape in that baari. If none of them is still in, the next active player anti-clockwise. *(Confirmed.)*
- **Hand requests:** from baari 2, only the **leader, before leading**, may ask the next active player (finished players are skipped) for their whole hand, once per turn. *(Confirmed.)*
  - **Give:** every card moves to the requester and the giver finishes in the next place. **The whole table sees exactly those cards** for the host's reveal duration. No one can play during the reveal; then the requester leads.
  - **Keep:** nothing moves and nothing is revealed. The requester leads.
  - **No answer in time:** counts as **Keep**. *(Confirmed.)*
  - A Cross is not required.
- **Cleared counters (optional):** count cards from the first baari and from normally cleared baaris. Thulla pickups and handed-over hands are not cleared. Values come from the server.

## Settings (host, validated on the server, locked during a game)

| Setting | Range | Default |
| --- | --- | --- |
| Seats (maximum players) | 2–52; the host may start with 2+ seated *(confirmed)* | 4 |
| Turn time | 5 s – 10 min (entered in seconds or minutes, stored as seconds, used as ms) | 30 s |
| Baari pile display | 1–10 s, half-second steps | 3 s |
| Hand reveal | 2–20 s, half-second steps | 5 s |
| Cleared counts | on/off | off |

## Timeout and away policy *(confirmed)*

When a turn's time runs out (or the player is away or has left), the server plays the card a **steady** player would choose (`games/thulla/engine/strategy.js`, see Bots below). It only uses public information: the player's own hand and every card played so far. In the first baari, the A♠ is the only legal opener. The server never makes a request on a player's behalf.

*(Changed: this used to be "the highest legal card", which kept leading a shape someone had already given Thulla on.)*

**Three consecutive turn timeouts** mark the player **away**. Away players' turns are played automatically after a short pause (1.2 s, so others can follow), and requests sent to them are kept. Playing a card, answering a request, or pressing **I'm back** clears away. Leaving a game mid-way marks the player away immediately. Their seat stays, so the game always finishes.

## Leaving a game

- **One player leaves while holding cards:** they **forfeit**. The game goes on (their turns are auto-played), they rank below everyone who stayed, and they take the largest rating loss (see Ratings). Players who stayed are scored on how they played, as usual.
- **Dropping off counts as leaving** if the player is still disconnected 30 s after the game ends. Coming back before the end (opening the table again) cancels the forfeit.
- **Leaving after going out** (no cards left) is not a forfeit.
- **Only one player still in:** the clock pauses for 20 s. If nobody comes back, the game ends early: the remaining player finishes ahead of the leavers and nobody is "left holding the cards".
- **Everyone leaves** (including the last player during that pause): the game ends there and **everyone who left while holding cards forfeits** and loses rating.
- **Everyone disconnects** without leaving: the clock pauses instead of auto-playing to an empty room. It resumes when someone returns. After 10 minutes with nobody back, the game ends with everyone still holding cards forfeiting, and the table closes.

## Table options

- **Ranked / unranked** (default ranked). Unranked games are saved to history but never change ratings, streaks or leaderboard counts.
- **Public / private** (default private). Public tables with a free seat are listed under **Open rooms** (home, Thulla and Join pages, refreshed every 5 s) for anyone to join. Private tables are joined by code, link or invite.
- The host can change both in the lobby; they are locked during a game.

## Bots

- **Unranked tables only.** The host adds bots from the lobby (an empty seat's **Bot** button, or **Add a bot**). A table with bots cannot be switched to ranked; remove them first. Bots are always ready, never leave, and never keep a table open on their own.
- **No AI.** Bots follow the rules with a fixed strategy and remember every card played. They never see another player's hand.
  - **Enforced, not promised:** the strategy is never given the game state. The server builds a *seat view* (`seatView()` in `engine/strategy.js`): the bot's own hand plus what everyone at the table sees (cards played, Thulla history, hand sizes, cleared counts). A test re-deals the other players' cards at random at over a thousand decision points and checks the view, and so the bot's choice, never changes.
  - **Leading:** avoid any shape an active opponent has given Thulla on (they are out of it, so the leader would likely collect). Prefer shapes with plenty of cards still out. Shed the highest card when that shape looks safe; otherwise lead low.
  - **Following:** if someone already played higher, or nobody left to play can Thulla, shed the highest card. If a Thulla looks likely, duck under the current highest; if forced over it, play the lowest.
  - **Out of the shape:** throw the highest card, preferring a short shape so it runs out sooner.
  - **Requests:** bots never ask for a hand and always give theirs when asked (giving finishes them).
- **Personalities:** Bashir Chacha (cautious), Rani Apa (sharp), Pappu (reckless: sometimes forgets who is out of a shape, takes bigger risks) and Nano (steady). They "think" for about a second before playing.
- **Chat:** each bot has hand-written lines for the start of a game, giving Thulla, picking up a pile, going out and losing, and answers a hello. At most one line per bot every few seconds.

## Ratings and streaks

- **Method:** pairwise Elo across the finishing order, weighted by margin. Each registered player is compared with every other player in the game: finishing ahead scores 1, behind 0. Expected score is `1 / (1 + 10^((Rb − Ra) / 400))`. Each pair is weighted by `1 + gap`, where `gap` is how many baaris apart the two finished as a share of the whole game (a player still holding cards counts as finishing in the last baari). The delta is `round(K / (n − 1) × Σ weight × (score − expected))` with K = 32. Everyone starts at 1500.
- **Going out early pays:** finishing in the same baari as someone is a plain win (×1); going out at the very start while they hold cards to the end counts double (×2). Both sides of a pair use the same weight, so it stays zero-sum.
- **Forfeits:** a player who left loses every pair at the full ×2 weight, against everyone (other leavers included, so a table that all walks out all goes down: −32 at equal ratings). Players who stayed beat a leaver as an ordinary win, weighted by how early they went out. A forfeit also counts as a loss for streaks.
- **Unranked games** change nothing.
- **Guests** count as 1500-rated opponents and are never rated.
- With equal ratings at a 4-player table where everyone goes out in the same baari, the results are +16, +5, −5 and −16. Wider margins move up to twice as much.
- **Winning streak** = consecutive 1st places; **losing streak** = consecutive games left holding the cards.
- **Exactly once:** keyed by the match id (chosen at game start) and the `rating_events (match_id, user_id)` primary key, inside one transaction. The client never sends results or ratings.

## Edge cases covered by tests

Out-of-turn plays; cards not in hand; off-shape while holding the shape; Thulla attempts in the first baari; requests in the first baari, after leading, twice in a turn, and to finished players; duplicate and retried acceptances; refusals; unanswered requests; players disconnecting during their turn or with a request pending; reconnecting during a reveal (remaining time is kept); a timeout and an action racing; a potential finisher collecting a pile; skipping finished players; a finished starter; the seat limit; settings changes during a game; the host leaving; abandoned tables; rematches with no leftover state; guests and anonymous users trying registered features; duplicate result saves; duplicate, stale and out-of-order event delivery (seq / resync).

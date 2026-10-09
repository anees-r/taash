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

When a turn's time runs out, the server plays **the highest-ranked legal card**. When following and holding the shape, that is the highest card of the shape. When void in the shape, every card is legal, so it is a **Thulla with the highest card in hand**. When leading, it is the highest card in hand; equal ranks are broken by suit order ♠ ♥ ♦ ♣. In the first baari, the A♠ is the only legal opener. The server never makes a request on a player's behalf.

**Three consecutive turn timeouts** mark the player **away**. Away players' turns are played automatically after a short pause (1.2 s, so others can follow), and requests sent to them are kept. Playing a card, answering a request, or pressing **I'm back** clears away. Leaving a game mid-way marks the player away immediately. Their seat stays, so the game always finishes.

If **everyone** at a table disconnects, the clock pauses instead of auto-playing to an empty room. It resumes when someone returns. After 10 minutes with nobody connected, the table closes without saving a result.

## Ratings and streaks

- **Method:** pairwise Elo across the finishing order. Each registered player is compared with every other player in the game: finishing ahead scores 1, behind 0. Expected score is `1 / (1 + 10^((Rb − Ra) / 400))`. The delta is `round(K / (n − 1) × Σ(score − expected))` with K = 32. Everyone starts at 1500.
- **Guests** count as 1500-rated opponents and are never rated.
- With equal ratings at a 4-player table, the results are +16, +5, −5 and −16.
- **Winning streak** = consecutive 1st places; **losing streak** = consecutive games left holding the cards.
- **Exactly once:** keyed by the match id (chosen at game start) and the `rating_events (match_id, user_id)` primary key, inside one transaction. The client never sends results or ratings.

## Edge cases covered by tests

Out-of-turn plays; cards not in hand; off-shape while holding the shape; Thulla attempts in the first baari; requests in the first baari, after leading, twice in a turn, and to finished players; duplicate and retried acceptances; refusals; unanswered requests; players disconnecting during their turn or with a request pending; reconnecting during a reveal (remaining time is kept); a timeout and an action racing; a potential finisher collecting a pile; skipping finished players; a finished starter; the seat limit; settings changes during a game; the host leaving; abandoned tables; rematches with no leftover state; guests and anonymous users trying registered features; duplicate result saves; duplicate, stale and out-of-order event delivery (seq / resync).

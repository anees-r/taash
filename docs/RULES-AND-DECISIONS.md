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

## Leaving, forfeiting and away

- **Leaving or disconnecting never ends the game.** The player's turns are auto-played and they finish wherever the cards put them; their result counts like anyone else's (they can win or lose).
- **Forfeit** (a button on the table, confirmed in a dialog) is the only way to end a game early. The game stops at once: the forfeiter is last and loses rating; players who had already gone out keep their places; everyone else shares the next place. The table sees a white flag, a grey seat and a round of boos.
- **Away:** a player can mark themselves away from the table's corner (or the Table info drawer on phones). Auto-play takes their turns straight away instead of after three missed turns; **I'm back** returns control.
- **Everyone disconnects:** the clock pauses instead of auto-playing to an empty room, and resumes when someone returns. If nobody is back within 10 minutes, the rest of the game is auto-played to its normal end, saved, and the table closes.
- **One table at a time:** a person is seated at or watching at most one table. Creating or joining another is refused with a link back; the home screen shows a "Return to your table" banner and the Create button becomes "Return to table".

## Table options

- **Ranked / unranked** (default ranked). Unranked games are saved to history but never change ratings, coins, streaks or leaderboard counts. Bots are allowed only at unranked tables.
- **Public / private** (default private). Public tables with a free seat (or room to watch) are listed under **Open rooms** (home, Thulla and Join pages, refreshed every 5 s). Private tables are joined by code, link or invite.
- **Allow guests** (default on): a host with an account can make the table accounts-only. A guest host always allows guests.
- **Spectators** (0–20, default 4): watchers see every card played and the public table state, never a hand. They can watch a full table or a game in progress. Between games the host can move anyone between seats and spectators, and anyone can move themselves (Watch instead / Take a seat).
- The host can change every option and setting in the lobby, and from the results screen between games; they are locked during a game.

## Sound board

- Sounds are the MP3 files in `public/sounds`: `drum-roll.mp3` shows as "Drum Roll". The list is re-read every few seconds; the server only relays sounds that exist. With no files, the sound-board button is hidden.
- Everyone at the table hears a sound (sound is **on by default**; the switch is remembered per device) and it pops up by the player's seat. Players only, one sound every 2.5 s each.
- **Who played what:** each sound also shows "Name played Sound" in a short feed (bottom left on wide screens, under the top bar on smaller ones), and the player's row in the mixer keeps their last sound.
- **End of game:** on the results screen players hear `public/sounds/victory.mp3` if they got rid of their cards, `defeat.mp3` if they were left holding them or forfeited. Once per game (a reload stays quiet), spectators hear nothing, and the sound switch applies. These two files are kept off the sound board.
- **Volume mixer** (in the sound-board popover, spectators included): one slider for all sounds plus one per other player, each with a mute button. Settings are personal and stay on that device (remembered per account, or per seat for guests); they never change what anyone else hears.

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

## Ratings, coins and streaks

- **Method:** pairwise Elo across the finishing order, weighted by margin. Each registered player is compared with every other player: finishing ahead scores 1, behind 0, expected score `1 / (1 + 10^((Rb − Ra) / 400))`. Each pair is weighted by `1 + gap`, where `gap` is how many baaris apart the two finished as a share of the game (a player still holding cards counts as finishing in the last baari). The delta is `round(K / (n − 1) × Σ weight × (score − expected))` with K = 32. Everyone starts at 1500.
- **Only the player left holding the cards loses points.** Everyone who went out gains at least +1, even when the maths alone would take a little away (e.g. 3rd of 4 at equal ratings: +1 instead of −5). With equal ratings at 4 players, all out in the same baari: +16, +5, +1, −16.
- **Going out early pays:** finishing in the same baari as someone is a plain win (×1); going out at the very start while they hold cards to the end counts double (×2).
- **Forfeits:** the forfeiter loses as if beaten by everyone at ×1.5 (−24 at equal ratings); every other player gets the same +6, whatever their place.
- **Coins** (ranked games only, accounts only, paid once per match): 1st 40, 2nd 30, 3rd 20, then 10; 5 for holding the cards; after a forfeit everyone else gets 15 and the forfeiter 0.
- **Unranked games** change nothing. **Guests** count as 1500-rated opponents and are never rated or paid.
- **Winning streak** = consecutive 1st places; **losing streak** = consecutive games left holding the cards (a forfeit counts).
- **Exactly once:** keyed by the match id (chosen at game start), the `rating_events (match_id, user_id)` primary key and the `coin_events (match_id, user_id)` unique index, inside one transaction. The client never sends results, ratings or coins.

## Shop and rank rewards

- **Shop:** table designs and card designs bought with coins (`lib/cosmetics/catalog.js`). **Rank rewards** unlock with a player's peak Thulla rating (1550 Rising … 1900 Legend) and can never be bought.
- **Everyone sees them:** a card design has a back (on the player's face-down hand, seen by everyone) and a front (paper, watermark, frame and ink on every card they play), so whose card is whose is easy to see. Table designs are card-back motifs across the felt.
- **Whose table:** of the table designs the seated players own, the most prestigious is used: rank rewards first (highest rank), then shop tables by price; the host wins ties. The game shows it as e.g. "Truck art · Ali's table", and the lobby and Table info say whose it is.
- Equipped items are re-checked whenever they are read, so a design can't be shown by someone who no longer qualifies.

## Edge cases covered by tests

Out-of-turn plays; cards not in hand; off-shape while holding the shape; Thulla attempts in the first baari; requests in the first baari, after leading, twice in a turn, and to finished players; duplicate and retried acceptances; refusals; unanswered requests; players disconnecting during their turn or with a request pending; reconnecting during a reveal (remaining time is kept); a timeout and an action racing; a potential finisher collecting a pile; skipping finished players; a finished starter; the seat limit; settings changes during a game; the host leaving; abandoned tables; rematches with no leftover state; guests and anonymous users trying registered features; duplicate result saves; duplicate, stale and out-of-order event delivery (seq / resync).

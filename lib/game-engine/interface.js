/**
 * The contract between the platform and a game module.
 *
 * The platform (tables, seats, lobby, chat, timers, sockets, results,
 * ratings) never looks inside a game's state. It only calls the functions
 * below. A future game adds a folder under games/ that exports an object of
 * this shape and registers it in games/server-registry.js.
 *
 * Timing model: a game exposes at most one pending deadline at a time
 * (`match.deadline = {id, at, kind}`). The platform keeps one setTimeout per
 * table for it and calls `onDeadline` when it fires. Because every action and
 * every deadline is handled synchronously on one thread, a timeout and a
 * player's action can never both apply: whichever arrives first changes the
 * state, and the other is rejected or ignored (deadline ids are checked).
 *
 * @typedef {object} GameEvent       a public, JSON-serialisable event, e.g. {type:'play', seat, card}
 *
 * @typedef {object} Outcome
 * @property {GameEvent[]} events          public events, in order, sent to the whole table
 * @property {number[]} [handsChanged]     seats whose private hand changed (each gets its own update)
 * @property {boolean} [over]              the game has ended
 *
 * @typedef {object} GameModule
 * @property {string} id
 * @property {{min:number, max:number}} playerRange
 * @property {() => object} defaultSettings
 * @property {(raw:any, ctx?:{minPlayers?:number}) => {ok:boolean, settings?:object, errors?:object}} normalizeSettings
 * @property {(opts:{players:{id:string,name:string}[], settings:object, rng:() => number, now:number}) => {match:object, outcome:Outcome}} createMatch
 * @property {(match:object, seat:number, action:object, now:number) => Outcome | {error:string}} act
 * @property {(match:object, now:number) => Outcome} onDeadline
 * @property {(match:object, now:number) => object} publicView     never contains hidden cards
 * @property {(match:object, seat:number) => object} privateView   what only `seat` may see
 * @property {(match:object) => MatchResult} results
 *
 * @typedef {object} MatchResult
 * @property {{seat:number, place:number}[]} order   every seat with its finishing place (1 = first out)
 * @property {number|null} loser                      seat left holding cards
 * @property {object[]} stats                         per-seat stats, indexed by seat
 * @property {object} summary                         game-wide numbers for the results screen
 */
export {};

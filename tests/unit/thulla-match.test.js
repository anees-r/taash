/* Thulla server module: deadlines, timeout policy, away, requests, the public
   hand-transfer reveal, redaction. Deterministic: fixed hands or seeds only. */
import { test } from 'node:test';
import assert from 'node:assert';
import * as R from '../../games/thulla/engine/rules.js';
import { thulla, TIMING, AWAY_AFTER_TIMEOUTS } from '../../games/thulla/match.js';
import { normalizeSettings, defaultSettings } from '../../games/thulla/settings.js';
import * as AI from '../helpers/thulla-ai.js';

const P4 = ['A', 'B', 'C', 'D'].map(n => ({ id: n, name: n }));
const SET = { ...defaultSettings(), turnSeconds: 20, pileSeconds: 2, revealSeconds: 4 };

function start(hands, settings = SET, now = 1000) {
  const { match, outcome } = thulla.createMatch({ players: P4.slice(0, hands.length), settings, hands, now });
  return { m: match, outcome };
}
/** Fire whatever deadline is pending (as the table's timer would). */
function fire(m) { return thulla.onDeadline(m, m.deadline.at); }
function play(m, seat, card) { const r = thulla.act(m, seat, { type: 'play', card }, m.now = (m.now || 5000) + 1); assert.ok(!r.error, r.error); return r; }

/* ------------------------------------------------------------ engine extras */

test('deck: 52 unique cards, 13 per suit, no jokers, rank order A K Q J 10 … 2', () => {
  const deck = R.makeDeck();
  assert.strictEqual(deck.length, 52);
  assert.strictEqual(new Set(deck.map(c => c.id)).size, 52);
  for (const s of R.SUITS) assert.strictEqual(deck.filter(c => c.suit === s).length, 13);
  const spades = deck.filter(c => c.suit === 'S').sort((a, b) => b.rank - a.rank).map(c => c.id);
  assert.deepStrictEqual(spades, ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S']);
});

test('same seed deals the same hands; different seeds differ', () => {
  const a = R.createGame({ players: P4, seed: 42 }), b = R.createGame({ players: P4, seed: 42 }), c = R.createGame({ players: P4, seed: 43 });
  assert.deepStrictEqual(a.players.map(p => p.hand.map(x => x.id)), b.players.map(p => p.hand.map(x => x.id)));
  assert.notDeepStrictEqual(a.players.map(p => p.hand.map(x => x.id)), c.players.map(p => p.hand.map(x => x.id)));
});

test('7 players: deck divided as evenly as possible (3 get 8, 4 get 7)', () => {
  const s = R.createGame({ players: Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'p' + i })), seed: 9 });
  assert.deepStrictEqual(s.players.map(p => p.hand.length).sort(), [7, 7, 7, 7, 8, 8, 8]);
});

test('first baari: a player holding a Spade cannot play another suit, and nobody can give Thulla', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '2H'], ['KS', '3H'], ['4H', '5H'], ['6H', '7H']] });
  R.playCard(s, 0, 'AS');
  assert.match(R.illegalReason(s, 1, '3H'), /must follow/);
  assert.throws(() => R.playCard(s, 1, '3H'));
  R.playCard(s, 1, 'KS');
  const ev = R.playCard(s, 2, '4H');
  assert.strictEqual(ev.thulla, false);
  assert.strictEqual(ev.baariEnded, false);       // C had no spade: discard, the baari continues
  R.playCard(s, 3, '6H');
  assert.strictEqual(s.review.kind, 'first-clear');
});

test('Thulla card is collected but never counts as the highest card, even if it outranks', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '2D', '9C'], ['KS', '5D'], ['QS', 'AH', '3C'], ['JS', '4D']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => R.playCard(s, i, c));
  R.resolveBaari(s);
  R.playCard(s, 0, '2D'); R.playCard(s, 1, '5D');
  const ev = R.playCard(s, 2, 'AH');              // void in Diamonds: Thulla with an Ace
  assert.strictEqual(ev.thulla, true);
  assert.strictEqual(s.review.collector, 1);       // 5♦ is the highest Diamond
  const out = R.resolveBaari(s);
  assert.deepStrictEqual(out.collected.cards.map(c => c.id).sort(), ['2D', '5D', 'AH']);
  assert.ok(s.players[1].hand.some(c => c.id === 'AH'));
  assert.strictEqual(s.players[3].hand.length, 1); // D never played this baari
});

test('cleared counters: first baari and normal clears count; Thulla pickups and transfers do not', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '2D', '3D', '9C'], ['KS', '5D', '6C'], ['QS', 'AH', '7C'], ['JS', '4D', 'KC']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => R.playCard(s, i, c));
  R.resolveBaari(s);
  assert.deepStrictEqual(s.cleared, { C: 0, D: 0, S: 4, H: 0 });
  R.playCard(s, 0, '2D'); R.playCard(s, 1, '5D'); R.playCard(s, 2, 'AH'); // Thulla
  R.resolveBaari(s);
  assert.deepStrictEqual(s.cleared, { C: 0, D: 0, S: 4, H: 0 });      // collected, not cleared
  R.makeRequest(s, 1); R.answerRequest(s, true);                        // B takes C's hand
  assert.deepStrictEqual(s.cleared, { C: 0, D: 0, S: 4, H: 0 });
  assert.strictEqual(R.countCards(s).total, 13);                       // every dealt card still accounted for
});

test('a player who played their last card but must collect the Thulla pile stays in', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '9D', '2C'], ['KS', 'KD'], ['QS', '3C', '4C'], ['JS', '5C', '6C']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => R.playCard(s, i, c));
  R.resolveBaari(s);                       // A leads
  R.playCard(s, 0, '9D');
  R.playCard(s, 1, 'KD');                  // B's last card, and highest
  R.playCard(s, 2, '3C');                  // Thulla
  const out = R.resolveBaari(s);
  assert.strictEqual(out.finished.length, 0);
  assert.strictEqual(s.players[1].finished, false);
  assert.strictEqual(s.players[1].hand.length, 3);
  assert.strictEqual(s.current, 1);
});

test('when the winner of a normal clear has finished, the next-highest card starts', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '2H', '3C'], ['KS', 'AH'], ['QS', 'KH', '4C'], ['JS', '5H', '5C']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => R.playCard(s, i, c));
  R.resolveBaari(s);
  R.playCard(s, 0, '2H'); R.playCard(s, 1, 'AH'); R.playCard(s, 2, 'KH'); R.playCard(s, 3, '5H');
  const out = R.resolveBaari(s);
  assert.deepStrictEqual(out.finished, [{ seat: 1, place: 1 }]);
  assert.strictEqual(out.nextLeader, 2);   // K♥, the next-highest Heart
});

test('autoCard: highest legal card; when void, a Thulla with the highest card; ties ♠ ♥ ♦ ♣', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '2D', 'KH', 'KC'], ['KS', '5D', '9D'], ['QS', 'AH', 'AC'], ['JS', '4D', '3H']] });
  assert.strictEqual(R.autoCard(s, 0), 'AS');                 // only legal opener
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => R.playCard(s, i, c));
  R.resolveBaari(s);
  assert.strictEqual(R.autoCard(s, 0), 'KH');                 // K♥ beats K♣ on suit order
  R.playCard(s, 0, '2D');
  assert.strictEqual(R.autoCard(s, 1), '9D');                 // following: highest Diamond
  R.playCard(s, 1, '9D');
  assert.strictEqual(R.autoCard(s, 2), 'AH');                 // void: Thulla with highest (A♥ over A♣)
});

test('legalFromView mirrors the server rules for the browser', () => {
  assert.deepStrictEqual(R.legalFromView({ number: 1, leadSuit: null, playsCount: 0 }, ['2H', 'AS']), ['AS']);
  assert.deepStrictEqual(R.legalFromView({ number: 3, leadSuit: 'H', playsCount: 2 }, ['2H', 'AS']), ['2H']);
  assert.deepStrictEqual(R.legalFromView({ number: 3, leadSuit: 'D', playsCount: 2 }, ['2H', 'AS']), ['2H', 'AS']);
  assert.strictEqual(R.thullaFromView({ number: 3, leadSuit: 'D', playsCount: 2 }, '2H'), true);
  assert.strictEqual(R.thullaFromView({ number: 1, leadSuit: 'S', playsCount: 2 }, '2H'), false);
});

/* ------------------------------------------------------------ settings */

test('settings: validated and normalised on the server', () => {
  assert.strictEqual(normalizeSettings({ ...defaultSettings(), turnSeconds: 2 }).ok, false);
  assert.strictEqual(normalizeSettings({ ...defaultSettings(), players: 1 }).ok, false);
  assert.strictEqual(normalizeSettings({ ...defaultSettings(), players: 3 }, { minPlayers: 4 }).ok, false);
  assert.strictEqual(normalizeSettings({ ...defaultSettings(), revealSeconds: 60 }).ok, false);
  const r = normalizeSettings({ players: '6', turnSeconds: 44.6, pileSeconds: 2.3, revealSeconds: 7.74, showCleared: 'yes', extra: 1 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.settings, { players: 6, turnSeconds: 45, turnUnit: 's', pileSeconds: 2.5, revealSeconds: 7.5, showCleared: false });
});

/* ------------------------------------------------------------ match module */

const HANDS = [['AS', '2D', '3D', '9C'], ['KS', '5D', '6C'], ['QS', 'AH', '7C'], ['JS', '4D', 'KC']];

test('match: deal → first turn; turn deadline uses the configured turn time', () => {
  const { m, outcome } = start(HANDS);
  assert.strictEqual(outcome.events[0].type, 'deal');
  assert.strictEqual(m.deadline.kind, 'deal');
  const r = fire(m);
  const turn = r.events.find(e => e.type === 'turn');
  assert.strictEqual(turn.seat, 0);
  assert.strictEqual(m.deadline.at - turn.from, 20000);
});

test('match: rejects out-of-turn plays, cards not owned, and off-suit while holding the suit', () => {
  const { m } = start(HANDS); fire(m);
  assert.match(thulla.act(m, 1, { type: 'play', card: 'KS' }, 1).error, /not your turn/);
  assert.match(thulla.act(m, 0, { type: 'play', card: 'KS' }, 1).error, /not in your hand/);
  assert.match(thulla.act(m, 0, { type: 'play', card: '2D' }, 1).error, /Ace of Spades/);
  play(m, 0, 'AS');
  assert.match(thulla.act(m, 1, { type: 'play', card: '5D' }, 1).error, /must follow/);
  assert.match(thulla.act(m, 1, { type: 'request' }, 1).error, /first baari/i);
});

test('match: turn timeout plays the highest legal card; 3 in a row marks the player away', () => {
  const { m } = start([['AS', '2D', '3D', '4D', '5D', '6D'], ['KS', '7D', '8D', '9D', '10D', 'JD'], ['QS', 'QD', 'KD', 'AD', '2H', '3H'], ['JS', '4H', '5H', '6H', '7H', '8H']]);
  fire(m);                                     // deal → A's turn
  let r = fire(m);                             // A times out
  assert.ok(r.events.some(e => e.type === 'timeout' && e.seat === 0 && e.count === 1));
  assert.ok(r.events.some(e => e.type === 'play' && e.card === 'AS' && e.auto));
  ['KS', 'QS', 'JS'].forEach((c, i) => play(m, i + 1, c));
  fire(m);                                     // review → resolve; A leads baari 2
  assert.strictEqual(m.S.current, 0);
  r = fire(m);                                 // timeout 2: leads highest card 6♦
  assert.ok(r.events.some(e => e.type === 'play' && e.card === '6D'));
  assert.strictEqual(m.away[0], false);
  play(m, 1, 'JD'); play(m, 2, 'AD');
  r = fire(m);                                 // D void in Diamonds: timeout → Thulla with 8♥
  assert.ok(r.events.some(e => e.type === 'play' && e.seat === 3 && e.card === '8H' && e.thulla));
  fire(m);                                     // C collects, leads
  play(m, 2, '2H'); r = fire(m);               // D times out (2nd), plays 7♥
  play(m, 0, '5D');                            // A void in Hearts → Thulla
  fire(m);                                     // D (7♥) collects and leads
  assert.strictEqual(m.S.current, 3);
  r = fire(m);                                 // D third timeout in a row → away
  assert.ok(r.events.some(e => e.type === 'away' && e.seat === 3 && e.away === true));
  assert.strictEqual(m.away[3], true);
});

test('match: away players are auto-played quickly; acting again clears away', () => {
  const { m } = start(HANDS);
  fire(m);
  m.away[0] = true;
  // Re-announce A's turn as an away turn.
  const r = thulla.act(m, 0, { type: 'back' }, 2000);
  assert.ok(r.events.some(e => e.type === 'away' && e.away === false));
  assert.strictEqual(m.deadline.kind, 'turn');
  m.away[1] = true;
  play(m, 0, 'AS');
  assert.strictEqual(m.deadline.kind, 'auto');
  assert.ok(m.deadline.at - m.now <= TIMING.playMs + TIMING.awayDelayMs);
});

function toBaari2(hands = HANDS) {
  const { m } = start(hands); fire(m);
  ['AS', 'KS', 'QS', 'JS'].forEach((c, i) => play(m, i, c));
  fire(m);  // resolve
  return m;
}

test('match: unanswered request counts as Keep — no transfer, no reveal', () => {
  const m = toBaari2();
  const r1 = thulla.act(m, 0, { type: 'request' }, 10000);
  assert.ok(!r1.error);
  assert.strictEqual(m.deadline.kind, 'request');
  const handsBefore = m.S.players.map(p => p.hand.length);
  const r = fire(m);
  const ans = r.events.find(e => e.type === 'request-answer');
  assert.strictEqual(ans.accepted, false);
  assert.ok(!r.events.some(e => e.type === 'transfer-reveal'));
  assert.deepStrictEqual(m.S.players.map(p => p.hand.length), handsBefore);
  assert.strictEqual(m.S.current, 0);
  assert.match(thulla.act(m, 0, { type: 'request' }, 1).error, /once per turn/);
});

test('match: accepted request publicly reveals exactly the transferred cards for the configured time', () => {
  const m = toBaari2();
  const giverHand = m.S.players[1].hand.map(c => c.id);
  thulla.act(m, 0, { type: 'request' }, 10000);
  assert.match(thulla.act(m, 2, { type: 'answer', accept: true }, 10001).error, /not sent to you/);
  const r = thulla.act(m, 1, { type: 'answer', accept: true }, 10002);
  const rev = r.events.find(e => e.type === 'transfer-reveal');
  assert.deepStrictEqual(rev.cards, giverHand);
  assert.strictEqual(rev.from, 1); assert.strictEqual(rev.to, 0);
  assert.strictEqual(rev.until - 10002, 4000);
  assert.strictEqual(rev.place, 1);
  assert.deepStrictEqual(r.handsChanged.sort(), [0, 1]);
  assert.strictEqual(m.S.players[1].finished, true);
  assert.strictEqual(m.S.players[1].hand.length, 0);
  assert.ok(giverHand.every(id => m.S.players[0].hand.some(c => c.id === id)));
  // Duplicate / retried acceptance is rejected and changes nothing.
  assert.match(thulla.act(m, 1, { type: 'answer', accept: true }, 10003).error, /finished|no request/i);
  // Nobody can play during the reveal; it ends at the configured time.
  assert.match(thulla.act(m, 0, { type: 'play', card: '2D' }, 10004).error, /shown/);
  const view = thulla.publicView(m, 12000);
  assert.deepStrictEqual(view.reveal.cards, giverHand);             // reconnecting players see it, with its end time
  assert.strictEqual(view.reveal.until, rev.until);
  assert.strictEqual(thulla.publicView(m, rev.until + 1).reveal, null);
  const after = fire(m);
  assert.ok(after.events.some(e => e.type === 'turn' && e.seat === 0));
  assert.strictEqual(thulla.act(m, 0, { type: 'play', card: '2D' }, rev.until + 10).error, undefined);
});

test('match: a refused request transfers nothing and has no reveal', () => {
  const m = toBaari2();
  thulla.act(m, 0, { type: 'request' }, 10000);
  const r = thulla.act(m, 1, { type: 'answer', accept: false }, 10001);
  assert.ok(!r.events.some(e => e.type === 'transfer-reveal'));
  assert.strictEqual(m.reveal, null);
});

test('match: a late action after its deadline already fired is rejected (timeout wins)', () => {
  const { m } = start(HANDS); fire(m);
  fire(m);                                       // A timed out, A♠ auto-played
  const r = thulla.act(m, 0, { type: 'play', card: 'AS' }, 99999);
  assert.ok(r.error);
});

test('match: public view never contains hands; private view only the seat\'s own', () => {
  const m = toBaari2();
  const pub = JSON.stringify(thulla.publicView(m, 0));
  assert.ok(!/"hand"/.test(pub));
  for (const id of m.S.players.flatMap(p => p.hand.map(c => c.id))) {
    assert.ok(!pub.includes('"' + id + '"'), 'public view leaked ' + id);
  }
  assert.deepStrictEqual(thulla.privateView(m, 2).hand, m.S.players[2].hand.map(c => c.id));
});

test('match: whole games via the module (random players, timeouts, requests) always finish', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const n = 2 + (seed % 6);
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const { match: m } = thulla.createMatch({ players, settings: SET, seed, now: 0 });
    const rng = R.mulberry32(seed);
    let now = 0, guard = 0;
    while (m.sub !== 'over' && guard++ < 4000) {
      const S = m.S;
      const pend = S.baari && S.baari.request && S.baari.request.status === 'pending';
      const roll = rng();
      if (m.sub === 'turn' && pend && roll < 0.6) thulla.act(m, S.baari.request.to, { type: 'answer', accept: rng() < 0.5 }, ++now);
      else if (m.sub === 'turn' && !pend && roll < 0.08 && R.canRequest(S, S.current)) thulla.act(m, S.current, { type: 'request' }, ++now);
      else if (m.sub === 'turn' && !pend && roll < 0.8) {
        const r = thulla.act(m, S.current, { type: 'play', card: AI.chooseCard(S, S.current, rng) }, ++now);
        assert.ok(!r.error, r.error);
      } else { now = m.deadline.at; thulla.onDeadline(m, now); }
      const c = R.countCards(m.S);
      assert.strictEqual(c.inHands + c.onTable + c.cleared, 52);
    }
    assert.strictEqual(m.sub, 'over', 'seed ' + seed);
    const res = thulla.results(m);
    assert.strictEqual(new Set(res.order.map(o => o.place)).size, n);
  }
});


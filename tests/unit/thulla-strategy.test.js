/* Bot / auto-play card choice: rules plus public card memory only. */
import { test } from 'node:test';
import assert from 'node:assert';
import * as R from '../../games/thulla/engine/rules.js';
import { chooseCard, readTable, seatView, PERSONALITIES } from '../../games/thulla/engine/strategy.js';

const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const play = (S, seat, id) => { const ev = R.playCard(S, seat, id); if (ev.baariEnded) R.resolveBaari(S); };

/** Baari 1 clears; in baari 2 seat 2 gives Thulla on Hearts, so seat 1 collects and leads next. */
function afterHeartsThulla() {
  const S = R.createGame({ players: players(3), hands: [
    ['AS', '2H', '3C', '9D'],
    ['KS', '5H', '7C', '8D', 'QH'],
    ['QS', '4C', 'JD', '6C'],
  ] });
  play(S, 0, 'AS'); play(S, 1, 'KS'); play(S, 2, 'QS');
  play(S, 0, '2H'); play(S, 1, '5H'); play(S, 2, '4C');     // Thulla: seat 1 (5♥) collects
  return S;
}

test('the table remembers who is out of a shape', () => {
  const S = afterHeartsThulla();
  assert.ok(readTable(seatView(S, 0)).voids[2].has('H'));
  assert.strictEqual(S.current, 1);
});

test('leading: never into a shape someone has given Thulla on', () => {
  const S = afterHeartsThulla();
  for (const p of Object.values(PERSONALITIES).filter(p => !p.slips)) {
    const card = chooseCard(seatView(S, 1), p);
    assert.notStrictEqual(card.slice(-1), 'H', p.id + ' led ' + card);
  }
});

test('following: ducks under the table when a Thulla is coming, sheds high cards when safe', () => {
  // Seat 0 leads 9♦; seat 1 follows; seat 2 is known to be out of Hearts but holds Diamonds.
  const S = R.createGame({ players: players(3), hands: [
    ['AS', '9D', '2C', '3C', '4C'],
    ['KS', '10D', '2D', 'KD', '5C', '6C'],
    ['QS', 'JD', '7C', '8C', '9C', 'AD'],
  ] });
  play(S, 0, 'AS'); play(S, 1, 'KS'); play(S, 2, 'QS');
  play(S, 0, '9D');
  // Plenty of Diamonds still out and no known voids: safe, so seat 1 sheds its highest Diamond.
  assert.strictEqual(chooseCard(seatView(S, 1), PERSONALITIES.steady), 'KD');
  // A cautious player still sheds when nobody is left to play after them.
  play(S, 1, '2D');
  assert.strictEqual(chooseCard(seatView(S, 2), PERSONALITIES.cautious), 'AD');
});

test('out of the shape: throws the highest card', () => {
  const S = R.createGame({ players: players(2), hands: [
    ['AS', '2H', '3H'],
    ['KS', 'QD', '4C', '9H'],
  ] });
  play(S, 0, 'AS'); play(S, 1, 'KS');
  play(S, 0, '2H');
  play(S, 1, '9H');
  // Seat 1 (9♥ highest) leads; give seat 0 nothing but Hearts and make it follow Clubs.
  assert.strictEqual(S.current, 1);
  play(S, 1, '4C');
  assert.strictEqual(chooseCard(seatView(S, 0), PERSONALITIES.steady), '3H');
});

test('only legal cards are ever chosen', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const S = R.createGame({ players: players(4), seed });
    let guard = 0;
    while (S.phase !== 'over' && guard++ < 400) {
      if (S.phase === 'review') { R.resolveBaari(S); continue; }
      const seat = S.current;
      const p = Object.values(PERSONALITIES)[seed % 4];
      const card = chooseCard(seatView(S, seat), p, () => (seed * 7919 % 100) / 100);
      assert.ok(R.legalCards(S, seat).includes(card));
      R.playCard(S, seat, card);
    }
    assert.strictEqual(S.phase, 'over', 'seed ' + seed + ' finished');
  }
});

/** Deal the opponents' cards out again at random, keeping how many each holds. */
function reshuffleOthers(S, seat, rnd) {
  const T = structuredClone(S);
  const others = T.players.filter(p => p.seat !== seat);
  const pool = others.flatMap(p => p.hand);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let k = 0;
  for (const p of others) p.hand = pool.slice(k, k += p.hand.length);
  return T;
}

test('no cheating: what other players hold never changes a decision', () => {
  const rnd = R.mulberry32(99);
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const S = R.createGame({ players: players(4), seed });
    let guard = 0;
    while (S.phase !== 'over' && guard++ < 400) {
      if (S.phase === 'review') { R.resolveBaari(S); continue; }
      const seat = S.current;
      const view = seatView(S, seat);
      const persona = Object.values(PERSONALITIES)[seed % 4];
      const pick = () => chooseCard(view, persona, R.mulberry32(seed));
      for (let t = 0; t < 3; t++) {
        const T = reshuffleOthers(S, seat, rnd);
        // The view is identical whatever the others hold…
        assert.deepStrictEqual(seatView(T, seat), view);
        // …so the decision is too.
        assert.strictEqual(chooseCard(seatView(T, seat), persona, R.mulberry32(seed)), pick());
        checked++;
      }
      R.playCard(S, seat, pick());
    }
  }
  assert.ok(checked > 1000);
});

test('a seat view holds only its own cards and public information', () => {
  const S = R.createGame({ players: players(4), seed: 7 });
  const view = seatView(S, 2);
  assert.deepStrictEqual(view.hand, S.players[2].hand.map(c => c.id));
  assert.deepStrictEqual(view.players.map(p => Object.keys(p).sort()), S.players.map(() => ['count', 'finished', 'seat']));
  // Before anyone plays, no other player's card appears anywhere in the view.
  const json = JSON.stringify(view);
  for (const p of S.players) if (p.seat !== 2) for (const c of p.hand) assert.ok(!json.includes('"' + c.id + '"'), c.id + ' leaked');
});

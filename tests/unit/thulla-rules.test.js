/* Thulla rules engine — ported from the prototype's test suite. Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert';
import * as R from '../../games/thulla/engine/rules.js';
import * as AI from '../helpers/thulla-ai.js';

const P4 = ['A', 'B', 'C', 'D'].map(n => ({ id: n, name: n }));
const ids = hand => hand.map(c => c.id).sort();


test('deals the whole deck, 13 each for four players, anti-clockwise one at a time', () => {
  const s = R.createGame({ players: P4, seed: 1, dealer: 3 });
  assert.deepStrictEqual(s.players.map(p => p.hand.length), [13, 13, 13, 13]);
  assert.strictEqual(s.dealSequence[0].seat, 0);
  assert.strictEqual(s.dealSequence[1].seat, 1);
  assert.strictEqual(R.countCards(s).total, 52);
});

test('uneven player counts get as equal a share as possible', () => {
  const s = R.createGame({ players: P4.concat([{ id: 'E', name: 'E' }]), seed: 2 });
  const sizes = s.players.map(p => p.hand.length).sort();
  assert.deepStrictEqual(sizes, [10, 10, 10, 11, 11]);
});

test('A♠ holder leads the first baari and may only play A♠; no requests', () => {
  const s = R.createGame({ players: P4, seed: 3 });
  const lead = s.current;
  assert.ok(s.players[lead].hand.some(c => c.id === 'AS'));
  assert.deepStrictEqual(R.legalCards(s, lead), ['AS']);
  assert.strictEqual(R.canRequest(s, lead), false);
});

// Fixed hands for scenario tests
const H = {
  A: ['AS', '4H', '2C', '3D'],
  B: ['KS', '6H', '5C', '4D'],
  C: ['QS', '9H', '6C', '5D'],
  D: ['7C', '8C', 'AC', '6D'],   // no spades, no hearts
};
function scenario() { return R.createGame({ players: P4, hands: [H.A, H.B, H.C, H.D] }); }

test('first baari: off-suit play is not Thulla, everything clears, highest spade leads next', () => {
  const s = scenario();
  assert.strictEqual(s.current, 0);
  R.playCard(s, 0, 'AS');
  assert.deepStrictEqual(R.legalCards(s, 1), ['KS']);       // must follow spades
  assert.throws(() => R.playCard(s, 1, '6H'));
  R.playCard(s, 1, 'KS');
  R.playCard(s, 2, 'QS');
  assert.strictEqual(R.wouldGiveThulla(s, 3, 'AC'), false);
  const ev = R.playCard(s, 3, 'AC');                        // D has no spades
  assert.strictEqual(ev.thulla, false);
  assert.strictEqual(s.review.kind, 'first-clear');
  const out = R.resolveBaari(s);
  assert.strictEqual(out.cleared.length, 4);
  assert.deepStrictEqual(s.cleared, { C: 1, D: 0, S: 3, H: 0 });
  assert.strictEqual(out.nextLeader, 0);                    // A♠ was highest spade
  assert.strictEqual(s.baari.number, 2);
});

test('requests become available from the second baari, before the leader plays', () => {
  const s = scenario();
  ['AS', 'KS', 'QS', 'AC'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  assert.strictEqual(R.canRequest(s, 0), true);
  assert.strictEqual(R.requestTarget(s, 0), 1);
  R.playCard(s, 0, '4H');
  assert.strictEqual(R.canRequest(s, 0), false);
});

test('Thulla ends the baari immediately; highest valid card collects the whole pile incl. the Thulla card', () => {
  const s = scenario();
  ['AS', 'KS', 'QS', 'AC'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  R.playCard(s, 0, '4H');
  R.playCard(s, 1, '6H');
  R.playCard(s, 2, '9H');
  assert.strictEqual(R.wouldGiveThulla(s, 3, '8C'), true);
  const ev = R.playCard(s, 3, '8C');
  assert.strictEqual(ev.thulla, true);
  assert.strictEqual(s.review.collector, 2);
  const before = s.players[2].hand.length;
  const out = R.resolveBaari(s);
  assert.strictEqual(s.players[2].hand.length, before + 4);
  assert.ok(s.players[2].hand.some(c => c.id === '8C'));
  assert.deepStrictEqual(s.cleared, { C: 1, D: 0, S: 3, H: 0 }); // nothing cleared by Thulla
  assert.strictEqual(out.nextLeader, 2);
  assert.strictEqual(R.countCards(s).total, 16);
});

test('Thulla mid-baari: later players keep their cards and do not play', () => {
  const s = R.createGame({ players: P4, hands: [['AS', '4H', '2D'], ['KS', '3C', '9D'], ['QS', '5H', '3D'], ['JS', '6H', '4D']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);                    // A leads again
  R.playCard(s, 0, '4H');
  R.playCard(s, 1, '3C');               // B has no hearts → Thulla right away
  assert.deepStrictEqual(s.review.notPlayed, [2, 3]);
  R.resolveBaari(s);
  assert.deepStrictEqual(ids(s.players[0].hand), ['2D', '3C', '4H']);
  assert.strictEqual(s.players[2].hand.length, 2);
  assert.strictEqual(s.players[3].hand.length, 2);
});

test('emptying your hand does not finish you until the baari resolves; a Thulla collector stays in', () => {
  // After first baari: A leads with 9H (last card). B follows 2H, C gives Thulla → A collects, stays in.
  const s = R.createGame({ players: P4, hands: [['AS', '9H'], ['KS', '2H', '5D'], ['QS', '3C'], ['JS', '4H', '6D']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  R.playCard(s, 0, '9H');
  assert.strictEqual(s.players[0].hand.length, 0);
  assert.strictEqual(s.players[0].finished, false);
  R.playCard(s, 1, '2H');
  R.playCard(s, 2, '3C');               // Thulla; C emptied too
  const out = R.resolveBaari(s);
  assert.strictEqual(s.players[0].finished, false);
  assert.strictEqual(s.players[0].hand.length, 3);
  assert.deepStrictEqual(out.finished, [{ seat: 2, place: 1 }]); // C gave its last card and finishes
});

test('normal clear finishes emptied players; starter skips finished players by rank', () => {
  const s = R.createGame({ players: P4, hands: [['AS', 'AH'], ['KS', 'KH', '2C'], ['QS', 'QH', '3C'], ['JS', 'JH', '4C']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  ['AH', 'KH', 'QH', 'JH'].forEach((id, i) => R.playCard(s, i, id));
  const out = R.resolveBaari(s);
  assert.deepStrictEqual(out.finished, [{ seat: 0, place: 1 }]);
  assert.strictEqual(out.nextLeader, 1);   // A (AH) finished → K♥ holder starts
  assert.strictEqual(s.baari.participants.includes(0), false);
});

test('request goes to next ACTIVE player; accept transfers cards and finishes the giver', () => {
  const s = R.createGame({ players: P4, hands: [['AS', 'AH'], ['KS', '2C', '3C'], ['QS', 'QH', '4C'], ['JS', 'JH', '5C']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  R.playCard(s, 0, 'AH');
  R.playCard(s, 1, '2C');                  // Thulla → A collects
  R.resolveBaari(s);
  assert.strictEqual(s.current, 0);
  R.makeRequest(s, 0);
  const res = R.answerRequest(s, true);
  assert.strictEqual(res.to, 1);
  assert.strictEqual(s.players[1].finished, true);
  assert.strictEqual(s.players[1].place, 1);
  assert.strictEqual(s.players[0].hand.length, 2 + 1);
  assert.strictEqual(R.canRequest(s, 0), false);        // one request per turn
  assert.deepStrictEqual(s.baari.participants, [0, 2, 3]);
  assert.strictEqual(R.countCards(s).total, 11);
});

test('request skips finished players; refuse lets the requester play', () => {
  const s = R.createGame({ players: P4, hands: [['AS', 'AH'], ['KS', '2C', '3C'], ['QS', 'QH', '4C'], ['JS', 'JH', '5C']] });
  ['AS', 'KS', 'QS', 'JS'].forEach((id, i) => R.playCard(s, i, id));
  R.resolveBaari(s);
  R.playCard(s, 0, 'AH'); R.playCard(s, 1, '2C'); R.resolveBaari(s);
  R.makeRequest(s, 0); R.answerRequest(s, true);          // B finished
  R.playCard(s, 0, '3C'); R.playCard(s, 2, '4C'); R.playCard(s, 3, '5C');
  R.resolveBaari(s);                                       // D leads (5C)
  assert.strictEqual(s.current, 3);
  assert.strictEqual(R.requestTarget(s, 3), 0);            // D → A (B is finished)
  R.makeRequest(s, 3);
  const res = R.answerRequest(s, false);
  assert.strictEqual(res.accepted, false);
  assert.ok(R.legalCards(s, 3).length > 0);
});

test('game ends when one player still holds cards — that player loses', () => {
  let games = 0;
  for (let seed = 1; seed <= 300; seed++) {
    for (const n of [2, 3, 4, 5, 6, 8]) {
      const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
      const s = R.createGame({ players, seed });
      const rng = R.mulberry32(seed * 7 + n);
      let guard = 0;
      while (s.phase !== 'over' && guard++ < 5000) {
        if (s.phase === 'review') { R.resolveBaari(s); continue; }
        const seat = s.current;
        if (AI.wantsToRequest(s, seat, rng, 0.15)) {
          R.makeRequest(s, seat);
          R.answerRequest(s, rng() < 0.5);
          if (s.phase === 'over') break;
        }
        const id = AI.chooseCard(s, seat, rng);
        R.playCard(s, seat, id);
        const c = R.countCards(s);
        assert.strictEqual(c.total, 52, 'card conservation');
      }
      assert.strictEqual(s.phase, 'over', 'game must terminate (n=' + n + ', seed=' + seed + ')');
      const left = s.players.filter(p => !p.finished);
      assert.ok(left.length <= 1);
      if (left.length === 1) assert.strictEqual(s.loser, left[0].seat);
      assert.strictEqual(s.baariHistory[0].kind, 'first-clear');
      assert.ok(s.baariHistory.slice(1).every(b => b.kind !== 'first-clear'));
      games++;
    }
  }
  assert.strictEqual(games, 1800);
});


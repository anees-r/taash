import { test } from 'node:test';
import assert from 'node:assert';
import { ratingDeltas, nextStreaks, FORFEIT_SHARE } from '../../lib/ratings/elo.js';

const four = () => [1, 2, 3, 4].map(p => ({ key: 'p' + p, rating: 1500, place: p, isLoser: p === 4 }));

test('only the player left holding the cards loses points', () => {
  const d = ratingDeltas(four());
  assert.deepStrictEqual([...d.values()], [16, 5, 1, -16]);   // 3rd would be −5 by the maths: going out never costs points
});

test('everyone going out together: nobody loses', () => {
  const d = ratingDeltas([1, 2, 3].map(p => ({ key: 'p' + p, rating: 1500, place: p })));
  for (const v of d.values()) assert.ok(v >= 1);
});

test('deterministic and independent of input order; upsets move more', () => {
  const ps = [{ key: 'a', rating: 1610, place: 3, isLoser: true }, { key: 'b', rating: 1420, place: 1 }, { key: 'c', rating: 1500, place: 2 }];
  const d1 = ratingDeltas(ps), d2 = ratingDeltas(ps.slice().reverse());
  for (const k of ['a', 'b', 'c']) assert.strictEqual(d1.get(k), d2.get(k));
  assert.ok(d1.get('b') > 16 && d1.get('a') < -16);
});

test('guests are opponents at 1500 but never rated', () => {
  const d = ratingDeltas([{ key: 'u', rating: 1500, place: 1 }, { key: 'g', rating: null, place: 2, isLoser: true }]);
  assert.strictEqual(d.get('u'), 16);
  assert.ok(!d.has('g'));
});

test('margin: going out early wins more than going out late', () => {
  const game = { baaris: 20 };
  const early = ratingDeltas([{ key: 'w', rating: 1500, place: 1, finishedBaari: 3 }, { key: 'l', rating: 1500, place: 2, isLoser: true }], game);
  const late = ratingDeltas([{ key: 'w', rating: 1500, place: 1, finishedBaari: 19 }, { key: 'l', rating: 1500, place: 2, isLoser: true }], game);
  assert.ok(early.get('w') > late.get('w'));
  assert.ok(early.get('w') <= 32, 'never more than a double win');
});

test('forfeit: the forfeiter loses; everyone else gets the same modest gain', () => {
  const ps = [
    { key: 'a', rating: 1500, place: 1 },
    { key: 'b', rating: 1700, place: 2 },
    { key: 'c', rating: 1400, place: 2 },
    { key: 'x', rating: 1500, place: 4, forfeit: true },
  ];
  const d = ratingDeltas(ps, { forfeitEnded: true, baaris: 6 });
  assert.strictEqual(d.get('a'), FORFEIT_SHARE);
  assert.strictEqual(d.get('b'), FORFEIT_SHARE);
  assert.strictEqual(d.get('c'), FORFEIT_SHARE);
  assert.ok(d.get('x') <= -20 && d.get('x') >= -32, 'a real but bounded penalty: ' + d.get('x'));
});

test('streaks: firsts extend winning streak; holding the cards extends losing streak', () => {
  let s = { winStreak: 0, loseStreak: 0, bestWinStreak: 0 };
  s = nextStreaks(s, { place: 1, isLoser: false });
  s = nextStreaks(s, { place: 1, isLoser: false });
  assert.deepStrictEqual(s, { winStreak: 2, loseStreak: 0, bestWinStreak: 2 });
  s = nextStreaks(s, { place: 4, isLoser: true });
  s = nextStreaks(s, { place: 4, isLoser: true });
  assert.deepStrictEqual(s, { winStreak: 0, loseStreak: 2, bestWinStreak: 2 });
  s = nextStreaks(s, { place: 2, isLoser: false });
  assert.deepStrictEqual(s, { winStreak: 0, loseStreak: 0, bestWinStreak: 2 });
});

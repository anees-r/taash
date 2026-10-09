import { test } from 'node:test';
import assert from 'node:assert';
import { ratingDeltas, nextStreaks } from '../../lib/ratings/elo.js';

test('equal ratings: winner gains, loser loses, symmetric and zero-sum', () => {
  const d = ratingDeltas([1, 2, 3, 4].map(p => ({ key: 'p' + p, rating: 1500, place: p })));
  assert.deepStrictEqual([...d.values()], [16, 5, -5, -16]);
  assert.strictEqual([...d.values()].reduce((a, b) => a + b, 0), 0);
});

test('deterministic and independent of input order', () => {
  const ps = [{ key: 'a', rating: 1610, place: 3 }, { key: 'b', rating: 1420, place: 1 }, { key: 'c', rating: 1500, place: 2 }];
  const d1 = ratingDeltas(ps), d2 = ratingDeltas(ps.slice().reverse());
  for (const k of ['a', 'b', 'c']) assert.strictEqual(d1.get(k), d2.get(k));
  assert.ok(d1.get('b') > 16 && d1.get('a') < -16);   // upset moves more
});

test('guests are opponents at 1500 but never rated', () => {
  const d = ratingDeltas([{ key: 'u', rating: 1500, place: 1 }, { key: 'g', rating: null, place: 2 }]);
  assert.strictEqual(d.get('u'), 16);
  assert.ok(!d.has('g'));
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

test('margin: going out early beats players by more than going out late', () => {
  const game = { baaris: 20 };
  const early = ratingDeltas([{ key: 'w', rating: 1500, place: 1, finishedBaari: 3 }, { key: 'l', rating: 1500, place: 2, finishedBaari: null }], game);
  const late = ratingDeltas([{ key: 'w', rating: 1500, place: 1, finishedBaari: 19 }, { key: 'l', rating: 1500, place: 2, finishedBaari: null }], game);
  assert.ok(early.get('w') > late.get('w'));
  assert.strictEqual(early.get('w'), -early.get('l'), 'still zero-sum');
  assert.ok(early.get('w') <= 32, 'never more than a double win');
  // Finishing in the same baari is a plain win.
  const same = ratingDeltas([{ key: 'a', rating: 1500, place: 1, finishedBaari: 7 }, { key: 'b', rating: 1500, place: 2, finishedBaari: 7 }], game);
  assert.strictEqual(same.get('a'), 16);
});

test('forfeits: the leaver loses at full margin; players who stayed score on their own performance', () => {
  const ps = [
    { key: 'a', rating: 1500, place: 1, finishedBaari: 5 },
    { key: 'b', rating: 1500, place: 2, finishedBaari: null },
    { key: 'x', rating: 1500, place: 3, forfeit: true },
  ];
  const d = ratingDeltas(ps, { baaris: 10 });
  assert.strictEqual(d.get('x'), -32);                          // lost both pairs at double weight
  assert.ok(d.get('a') > 0, 'the winner gains');
  assert.ok(d.get('a') > d.get('b'), 'going out early beats holding on');
  assert.ok(d.get('b') > -8, 'the player who stayed is not hurt by the leaver');
});

test('when the whole table leaves, everyone loses rating', () => {
  const d = ratingDeltas([1, 2, 3].map(p => ({ key: 'p' + p, rating: 1500, place: p, forfeit: true })), { baaris: 6 });
  for (const v of d.values()) assert.strictEqual(v, -32);    // the same as leaving on your own
});

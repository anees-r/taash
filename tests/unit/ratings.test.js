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

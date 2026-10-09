/* Acceptance check: a word the brief rules out must not appear anywhere in the project. */
import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORD = ['pat', 'akh'].join('');
const SKIP = new Set(['node_modules', '.next', '.git', 'test-results', 'playwright-report']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|jsx|mjs|css|md|json|sql|html|yml|sh)$/.test(name) || name === 'Dockerfile') yield p;
  }
}

test('the word is not used in code, UI text, styles or docs', () => {
  const hits = [];
  for (const f of files(process.cwd())) if (readFileSync(f, 'utf8').toLowerCase().includes(WORD)) hits.push(f);
  assert.deepStrictEqual(hits, []);
});

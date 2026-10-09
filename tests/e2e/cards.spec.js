/* Every card, at small to large sizes: corner index never overlaps pips, court frames or the ace. */
import { test, expect } from '@playwright/test';

for (const [w, h] of [[1280, 900], [360, 780]]) {
  test(`52 cards render without rank/suit overlap at ${w}px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await ctx.newPage();
    await page.goto('/dev/cards?sizes=34,48,64,92,120');
    await expect(page.getByTestId('card-sheet')).toBeVisible();
    const problems = await page.evaluate(() => {
      const out = [];
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const cards = [...document.querySelectorAll('[data-testid=card-sheet] .pcard:not(.mini)')];
      for (const c of cards) {
        const id = c.dataset.card;
        const idx = [...c.querySelectorAll('.idx')].map(e => e.getBoundingClientRect());
        const faces = [...c.querySelectorAll('.pip, .court, .ace svg')].map(e => e.getBoundingClientRect());
        for (const i of idx) for (const f of faces) if (hit(i, f)) out.push(id + '@' + c.style.getPropertyValue('--cw') + ' overlaps');
        const rank = c.querySelector('.idx .r');
        if (rank.scrollWidth > rank.clientWidth + 1) out.push(id + '@' + c.style.getPropertyValue('--cw') + ' rank clipped');
        const face = c.getBoundingClientRect();
        for (const i of idx) if (i.left < face.left || i.right > face.right || i.top < face.top || i.bottom > face.bottom) out.push(id + ' index outside card');
      }
      return { checked: cards.length, out };
    });
    expect(problems.checked).toBe(52 * 5);
    expect(problems.out).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('cards.png'), fullPage: true });
    await ctx.close();
  });
}

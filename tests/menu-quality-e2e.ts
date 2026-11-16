/** Entry-page quality storyboard; offline server, no model calls. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from './harness';
import { menuStoryboard } from './menu-storyboard';

export async function qualityStoryboard(out = 'shots/storyboards/menu-quality') {
  mkdirSync(out, { recursive: true });
  const h = await startHarness({ portBase: 7300 });
  const checks: string[] = [];
  try {
    const page = await h.browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${h.url}/?debug=1`);
    const group = page.getByRole('group', { name: 'Graphics quality' });
    await group.getByRole('button', { name: 'Low', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ac.quality')), 'low');
    await page.reload();
    assert.equal(await group.getByRole('button', { name: 'Low', exact: true }).getAttribute('aria-pressed'), 'true');
    checks.push('Low can be selected before a shift and survives a reload');
    await page.goto(`${h.url}/?debug=1&quality=high`);
    await group.getByRole('button', { name: 'Low', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get('quality'), 'low');
    assert.equal(new URL(page.url()).searchParams.get('debug'), '1');
    checks.push('A new selection replaces the quality URL override and preserves other URL settings');
    for (const [name, width] of [['desktop', 1440], ['narrow', 800]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await group.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const level of ['Low', 'Medium', 'High', 'Ultra']) assert.ok(await group.getByRole('button', { name: level, exact: true }).isVisible());
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    }
    checks.push('All four controls are visible without horizontal page overflow at both viewport sizes');
    await page.getByRole('button', { name: 'New game →', exact: true }).click();
    await page.waitForFunction(async () => {
      const modulePath = '/src/world/render/quality.ts';
      return (await import(modulePath)).activeQuality() === 'low';
    }, undefined, { timeout: 60_000 });
    checks.push('The first 3D renderer uses Low');
    assert.deepEqual(errors, []);
    checks.push('No browser runtime errors');
    await menuStoryboard(h.browser, out, 'Entry-page graphics quality', checks);
    for (const check of checks) console.log(`✓ ${check}`);
  } finally { await h.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await qualityStoryboard();

/**
 * Every character's head, seen from behind, the sides and above, is whole, and so is every neckline
 * where a head meets an outfit (client/src/dev/lineup.ts ?check=holes on the real GPU): each figure is
 * drawn as the game draws it, then with every surface double-sided; pixels only the second pass covers
 * are holes that show what is behind — a head modeled for wear under a hood or cap swapped onto
 * another body (Male_Adult_18 on Marcus Hill's scrubs), missing parts, flipped faces, a worn neck that
 * ends above a lower collar (the inside of the neck at the nape) or leaves an open neckline bare
 * (a turtleneck's head on an open shirt). Covers the authored cast and every model's head as a head
 * swap would wear it on plain scrubs (heads listed in casting.ts HEAD_NEEDS_OWN_BODY keep their own
 * body). Writes the sheets (heads: back / left / right / top; necklines: front / ¾, back / ¾ rear) and
 * holes.json.
 *
 *   npx tsx tests/heads-e2e.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startHarness } from './harness';

const out = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/heads');
mkdirSync(out, { recursive: true });
/** share of a view's pixels that may show through: anti-aliased silhouette edges and hair-card fringes stay well below */
const MAX = 0.015;

const h = await startHarness({ portBase: 7300, dev: true });
const all: { set: string; view: string; key: string; shot: string; frac: number; px: number }[] = [];
try {
  for (const view of ['head', 'bust', 'nape'])
    for (const set of ['all', 'donors']) {
      const page = await h.browser.newPage({ viewport: { width: 1900, height: 1200 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${h.url}/src/dev/lineup.html?set=${set}&view=${view}&check=holes&light=waiting`);
      await page.waitForFunction(() => (window as { __lineup?: { ready: boolean } }).__lineup?.ready, null, { timeout: 300000 });
      const r = await page.evaluate(() => (window as unknown as { __lineup: { failed: number; holes: { key: string; shot: string; frac: number; px: number }[] } }).__lineup);
      await page.locator('#wrap').screenshot({ path: `${out}/${view === 'head' ? 'heads' : view}-${set}.png` });
      const what = view === 'head' ? 'head' : view === 'bust' ? 'neckline (front)' : 'neckline (back)';
      h.check(`${set}/${view}: every model loaded`, r.failed === 0, `${r.failed} failed`);
      h.check(`${set}/${view}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
      for (const x of r.holes) all.push({ set, view, ...x });
      const worst = [...r.holes].sort((a, b) => b.frac - a.frac);
      const bad = worst.filter((x) => x.frac > MAX);
      h.check(`${set}: ${r.holes.length} ${what} views, none see-through`, bad.length === 0, bad.map((x) => `${x.key}/${x.shot} ${(x.frac * 100).toFixed(1)}%`).join(', ') || `worst ${worst[0]?.key}/${worst[0]?.shot} ${((worst[0]?.frac ?? 0) * 100).toFixed(2)}%`);
      await page.close();
    }
} finally {
  writeFileSync(`${out}/holes.json`, JSON.stringify(all, null, 1));
  await h.close();
}
console.log(`${h.failed() ? '✗' : '✓'} heads and necklines → ${out}`);
process.exit(h.failed() ? 1 : 0);

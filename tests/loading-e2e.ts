/**
 * The start-up loading screen during a real start: comic panels, wordmark, ECG, no progress bar.
 *
 *   npx tsx tests/loading-e2e.ts [outDir=shots/loading]
 *
 * Starts Night Shift on a private server (tests/harness.ts, never port 5317) at 1600×900 and 390×844,
 * screenshots the loading screen while the world starts, and checks that it fades out on the first
 * clean frames. Also checks the bundled font (no font CDN), and that reduced motion stops all
 * animation. Everything it starts is closed again.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const out = process.argv[2] ?? 'shots/loading';
mkdirSync(out, { recursive: true });
const h = await startHarness({ portBase: 7300, dev: true });

async function startShift(page: Page) {
  await page.goto(`${h.url}/?debug=1`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
}

try {
  for (const [name, width, height] of [['1600x900', 1600, 900], ['390x844', 390, 844]] as const) {
    const ctx = await h.browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 3 : 1 });
    const page = await ctx.newPage();
    const external: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(u.href);
    });
    const t0 = Date.now();
    await startShift(page);
    await page.waitForSelector('.loading-screen .ls-panel.ready', { timeout: 30000 });
    const stages = new Set<string>();
    const poll = setInterval(() => void page.$eval('.ls-stage', (e) => e.textContent ?? '').then((s) => stages.add(s), () => undefined), 150);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/real-start-${name}.png` });
    const info = await page.evaluate(() => {
      const ls = document.querySelector('.loading-screen')!;
      const img = ls.querySelector<HTMLImageElement>('.ls-panel.ready');
      return {
        logo: !!ls.querySelector('svg[aria-label="GTAgentClinic"]'),
        title: ls.querySelector('.ls-title')?.textContent ?? '',
        bar: !!ls.querySelector('[role="progressbar"]') || /\d\s*%/.test(ls.textContent ?? ''),
        panel: img ? `${img.naturalWidth}×${img.naturalHeight}` : '',
        font: document.fonts.check('40px Anton'),
        ecg: document.getAnimations().filter((a) => a instanceof Animation && (a.effect as KeyframeEffect | null)?.target?.closest?.('.ls-ecg')).length,
      };
    });
    h.check(`${name}: wordmark and shift title`, info.logo && /night shift/i.test(info.title), info.title);
    h.check(`${name}: no progress bar or percentage`, !info.bar);
    h.check(`${name}: a 2560×1440 comic panel is up`, info.panel === '2560×1440', info.panel);
    h.check(`${name}: Anton is the bundled font`, info.font);
    h.check(`${name}: the ECG trace and pen are animating`, info.ecg >= 2, `${info.ecg} animations`);
    await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 60000 });
    clearInterval(poll);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    h.check(`${name}: fades out once the world is up`, true, `${secs} s after Start; stages: ${[...stages].join(' → ')}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/real-start-${name}-after.png` });
    h.check(`${name}: no outside requests (fonts, CDNs)`, external.length === 0, external.slice(0, 3).join(' '));
    await ctx.close();
  }

  // reduced motion: nothing moves (panel, pan, ECG)
  const ctx = await h.browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await startShift(page);
  await page.waitForSelector('.loading-screen .ls-panel.ready', { timeout: 30000 });
  await page.waitForTimeout(600);
  const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect as KeyframeEffect | null)?.target?.closest?.('.loading-screen')).length);
  h.check('reduced motion: no running animations on the loading screen', moving === 0, `${moving}`);
  await page.screenshot({ path: `${out}/real-start-1600x900-reduced-motion.png` });
  await ctx.close();
} finally {
  await h.close();
}
console.log(h.failed() ? `${h.failed()} check(s) failed` : 'all loading-screen checks passed');
process.exit(h.failed() ? 1 : 0);

// Usage: node tests/shot.mjs <url> <out.png> [waitMs=2500] [width=1440] [height=900] [--keys=w:800,e:0] [--click=x,y]
// Takes a screenshot with headless Chromium (WebGL via SwiftShader). Prints console errors.
import { chromium } from 'playwright';
const [url, out, waitMs = '2500', width = '1440', height = '900', ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(+waitMs);
if (opts.click) { const [x, y] = opts.click.split(',').map(Number); await page.mouse.click(x, y); await page.waitForTimeout(400); }
if (opts.keys) {
  for (const k of opts.keys.split(',')) {
    const [key, hold = '0'] = k.split(':');
    await page.keyboard.down(key); await page.waitForTimeout(+hold); await page.keyboard.up(key); await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
}
await page.screenshot({ path: out });
console.log(`saved ${out}`);
if (errors.length) console.log('console:\n' + errors.slice(0, 30).join('\n'));
await browser.close();

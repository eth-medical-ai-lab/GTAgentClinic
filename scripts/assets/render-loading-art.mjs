#!/usr/bin/env node
/**
 * Renders the loading screen's comic panels (client/public/res/loading/*.webp) from the game's own
 * Rocketbox avatars and procedural props, with the ink/halftone pipeline in
 * client/src/dev/loadingArt.ts.
 *
 *   node scripts/assets/render-loading-art.mjs                    all panels → client/public/res/loading
 *   node scripts/assets/render-loading-art.mjs --only=crew,clear
 *   node scripts/assets/render-loading-art.mjs --out=/tmp/art --png --w=1280 --h=720   previews
 *   node scripts/assets/render-loading-art.mjs --only=lab --png --params=who:vic,pose:paddlesX,view:face
 *
 * Starts a private Vite dev server (never port 5317) and a headless Chromium on the real GPU, renders
 * each panel in the dev page, and closes both again. No network access is needed.
 *
 * Panels are 2560×1440 in 8 grey levels, stored as lossless WebP with `cwebp` (≈100–200 KB each;
 * without cwebp the browser's lossy encoder is used, ≈3× larger).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
    }),
);
const outDir = path.resolve(args.out ?? path.join(ROOT, 'client/public/res/loading'));
const png = args.png === 'true';
const w = Number(args.w ?? 2560);
const h = Number(args.h ?? 1440);
const quality = Number(args.q ?? 0.8);
const ss = Number(args.ss ?? 2);
const style = args.style ? JSON.parse(args.style) : undefined;
// --params=who:rex,pose:cross  (panel parameters; the pose lab uses them)
const params = args.params ? Object.fromEntries(args.params.split(',').map((kv) => kv.split(':'))) : undefined;

const cwebp = spawnSync('cwebp', ['-version'], { stdio: 'ignore' }).status === 0;
if (!png && !cwebp) console.warn('cwebp not found: falling back to the browser\'s lossy WebP encoder');

const port = 7340 + Math.floor(Math.random() * 40);
const server = await createServer({
  configFile: path.join(ROOT, 'vite.config.ts'),
  logLevel: 'warn',
  server: { port, strictPort: false, host: '127.0.0.1', hmr: false },
});
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${port}/`;
  // "chromium" channel = new headless mode on the real GPU (as in tests/harness.ts)
  browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/PCFSoftShadowMap/.test(m.text()) && console.error(`[${m.type()}] ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && console.error(`[${r.status()}] ${r.url()}`));
  await page.goto(`${base}src/dev/loading-art.html?api=1`);
  await page.waitForFunction(() => !!window.__art, null, { timeout: 120000 });
  const all = await page.evaluate(() => window.__art.panels);
  const only = args.only ? args.only.split(',') : all;
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const name of only) {
    const t0 = Date.now();
    const lossless = !png && cwebp;
    const type = png || lossless ? 'image/png' : 'image/webp';
    const url = await page.evaluate(([n, o]) => window.__art.render(n, o), [name, { w, h, ss, type, quality, style, params }]);
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    const file = path.join(outDir, `${name}.${png ? 'png' : 'webp'}`);
    if (lossless) {
      const tmp = `${file}.tmp.png`;
      writeFileSync(tmp, buf);
      const r = spawnSync('cwebp', ['-quiet', '-lossless', '-z', '9', '-metadata', 'none', tmp, '-o', file], { stdio: 'inherit' });
      rmSync(tmp, { force: true });
      if (r.status !== 0) throw new Error(`cwebp failed for ${name}`);
    } else writeFileSync(file, buf);
    const size = statSync(file).size;
    total += size;
    console.log(`${path.relative(ROOT, file)}  ${(size / 1024).toFixed(0)} KB  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  console.log(`total ${(total / 1024).toFixed(0)} KB`);
} finally {
  await browser?.close().catch(() => undefined);
  await server.close();
}

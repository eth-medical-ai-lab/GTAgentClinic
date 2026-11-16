/**
 * Art-direction screenshots on the real GPU (WebGPU when the browser has it).
 * Boots the server, starts a Night Shift per viewpoint (patients arrive via a time skip),
 * and saves one PNG per view plus FPS / renderer stats.
 *
 *   npx tsx tests/visual.ts [outDir] [--views=hub,bay4,station] [--prod] [--wait=7000] [--quality=high] [--map="Orientation Day"] [--port-base=5480]
 *
 * --map overrides every view's map, e.g. to shoot the exterior views by day (Orientation Day
 * runs at 13:00) instead of the Night Shift (~22:00).
 * --prod serves the built client (run `npm run build` first); default is the Vite dev
 * middleware so edits show up without a build. Views are defined below as
 * x, z (meters), yaw (deg; 0 = facing south/+z, 90 = east), pitch (deg), camera mode.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** map: menu card to start (default Night Shift); the outpatient clinic is open on Orientation Day (13:00) */
type View = { x: number; z: number; yaw: number; pitch: number; cam: 'first' | 'third' | 'top'; map?: string };
const VIEWS: Record<string, View> = {
  hub: { x: 3.0, z: 11.2, yaw: 90, pitch: -3, cam: 'first' },
  bay4: { x: 14.0, z: 6.4, yaw: 180, pitch: -14, cam: 'first' },
  bay2: { x: 6.2, z: 6.4, yaw: 180, pitch: -14, cam: 'first' },
  station: { x: 21.0, z: 14.3, yaw: 180, pitch: -5, cam: 'first' },
  waiting: { x: 5.0, z: 15.9, yaw: 0, pitch: -6, cam: 'first' },
  resus: { x: 28.0, z: 6.6, yaw: 180, pitch: -8, cam: 'first' },
  // Resus 1 + 2 by the ambulance entrance: each from its door toward the head of the trolley, the
  // ambulance doors from the bay (Resus 1 through them), and the corridor between the rooms
  resus1: { x: 39.35, z: 21.9, yaw: -137, pitch: -10, cam: 'first' },
  resus2: { x: 43.65, z: 21.9, yaw: 137, pitch: -10, cam: 'first' },
  resusDoor: { x: 45.2, z: 26.4, yaw: -132, pitch: 2, cam: 'first' },
  emsHall: { x: 41.6, z: 16.4, yaw: 0, pitch: -4, cam: 'first' },
  exterior: { x: 36.0, z: 36.0, yaw: 160, pitch: 4, cam: 'first' },
  third: { x: 11.0, z: 12.4, yaw: 117, pitch: -8, cam: 'third' },
  top: { x: 14.0, z: 9.0, yaw: 180, pitch: 0, cam: 'top' },
  bed2side: { x: 7.4, z: 3.1, yaw: -100, pitch: -24, cam: 'first' },
  nurses: { x: 22.6, z: 11.0, yaw: -90, pitch: -12, cam: 'first' },
  face: { x: 5.75, z: 5.0, yaw: -108, pitch: -16, cam: 'first' },
  hubEast: { x: 24.5, z: 12.8, yaw: 75, pitch: -4, cam: 'first' },
  ft1: { x: 17.5, z: 16.4, yaw: 0, pitch: -14, cam: 'first' },
  face2: { x: 14.85, z: 1.75, yaw: -95, pitch: -38, cam: 'first' },
  // east wing
  streetEast: { x: 46.6, z: 11.5, yaw: 90, pitch: 0, cam: 'first' },
  cafeteria: { x: 57.9, z: 8.35, yaw: 138, pitch: -9, cam: 'first' },
  restrooms: { x: 68.45, z: 8.2, yaw: 176, pitch: -8, cam: 'first' },
  stalls: { x: 68.2, z: 2.9, yaw: 90, pitch: -12, cam: 'first' },
  restroomAcc: { x: 70.25, z: 12.45, yaw: 150, pitch: -16, cam: 'first' },
  lobby: { x: 53.5, z: 11.8, yaw: 180, pitch: -4, cam: 'first' },
  stairs: { x: 48.75, z: 8.4, yaw: 180, pitch: 14, cam: 'first' },
  clinic: { x: 54.2, z: 23.0, yaw: 165, pitch: -7, cam: 'first', map: 'Orientation Day' },
  exam1: { x: 60.95, z: 19.3, yaw: 18, pitch: -12, cam: 'first', map: 'Orientation Day' },
  clinicExt: { x: 58.0, z: 36.5, yaw: 172, pitch: 4, cam: 'first' },
  wingTop: { x: 60.0, z: 12.0, yaw: 180, pitch: 0, cam: 'top' },
  // exterior: ambulance close-up, the bay under the canopy, the parking lot, the entrance from the drive
  ambulance: { x: 45.2, z: 33.6, yaw: -144, pitch: -6, cam: 'first' },
  ambulanceBay: { x: 36.4, z: 30.2, yaw: 128, pitch: 6, cam: 'first' },
  lot: { x: 6.0, z: 38.6, yaw: 108, pitch: -2, cam: 'first' },
  entrance: { x: 41.0, z: 41.0, yaw: 180, pitch: 3, cam: 'first' },
  // parked cars close-up, and the ambulance from behind (rear doors, chevrons)
  cars: { x: 24.5, z: 37.4, yaw: -138, pitch: -9, cam: 'first' },
  ambulanceRear: { x: 36.6, z: 25.5, yaw: 100, pitch: 2, cam: 'first' },
  // what's around the hospital: across the street (river, far bank, arch bridge), and west down the lot
  // past the campus fence to the medical office building and the hospital tower
  river: { x: 40.0, z: 41.0, yaw: 32, pitch: 2, cam: 'first' },
  lotWest: { x: 66.0, z: 38.0, yaw: -98, pitch: 3, cam: 'first' },
};

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/visual';
const opt = (k: string) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a === undefined ? undefined : a.slice(a.indexOf('=') + 1);
};
const prod = args.includes('--prod');
const waitMs = Number(opt('wait') ?? 7000);
const quality = opt('quality');
const mapOverride = opt('map');
const names = (opt('views') ?? Object.keys(VIEWS).join(',')).split(',').filter((n) => VIEWS[n]);
mkdirSync(out, { recursive: true });

// --port-base=N picks the server port from N..N+39 (parallel runs by different people/agents don't collide)
const PORT = Number(opt('port-base') ?? 5480) + Math.floor(Math.random() * 40);
const serverArgs = ['tsx', 'server/index.ts', '--port', String(PORT), '--llm', 'offline', '--tts', 'off'];
if (!prod) serverArgs.push('--dev');
// spawn node directly (not via npx) so kill() reaches the server itself and no orphan is left behind
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), ...serverArgs.slice(1)], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start:\n' + log)), 60000);
  const iv = setInterval(() => {
    if (log.includes('[server]')) {
      clearInterval(iv);
      clearTimeout(t);
      resolve();
    }
  }, 200);
});

// "chromium" channel = new headless mode, which uses the real GPU (Metal on macOS) and exposes WebGPU on localhost
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const report: Record<string, unknown> = {};
try {
  for (const name of names) {
    const v = VIEWS[name];
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const logs: string[] = [];
    // (skip the Rocketbox clip-binding warnings: they're harmless and would crowd out real errors)
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[world]')) && !m.text().includes('PropertyBinding: No target node') && logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    const q = new URLSearchParams({ debug: '1', wdebug: '1', wpos: `${v.x},${v.z},${v.yaw},${v.pitch}` });
    if (quality) q.set('quality', quality);
    // pass art-direction tuning knobs straight through (e.g. --tune=exp=0.8,hemi=0.1)
    for (const kv of (opt('tune') ?? '').split(',').filter(Boolean)) {
      const [k, v] = kv.split('=');
      q.set(k, v);
    }
    await page.goto(`http://127.0.0.1:${PORT}/?${q}`);
    await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    await page.click(`text=${mapOverride ?? v.map ?? 'Night Shift'}`);
    await page.click('button.start');
    await page.waitForSelector('.hud-clock', { timeout: 60000 });
    await page.evaluate(`__ac.client.act({ type: 'wait', minutes: 14 })`);
    if (v.cam !== 'first') await page.evaluate(`__ac.store.set({ camera: '${v.cam}' })`);
    await page.waitForTimeout(waitMs);
    // (string, not a function: tsx/esbuild would inject a `__name` helper the page doesn't have)
    const fps = (await page.evaluate(`new Promise((resolve) => {
      let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); };
      requestAnimationFrame(tick);
    })`)) as number;
    // hide HUD chrome so the shot shows the world
    await page.addStyleTag({ content: '.hud, .toasts, .wl-hint { visibility: hidden !important; }' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}.png` });
    report[name] = { fps, logs: logs.slice(0, 12) };
    console.log(`📸 ${out}/${name}.png  ${fps} fps${logs.length ? `\n   ${logs.slice(0, 6).join('\n   ')}` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
process.exit(0);

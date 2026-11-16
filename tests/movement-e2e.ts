/**
 * Player movement on the real GPU: walk, run (Shift+W and double-tap W), jump with the in-air
 * tuck, and the third-person camera staying under the ceiling however far it is zoomed out.
 * Boots a private server on a random port and stops it at the end.
 *
 *   npx tsx tests/movement-e2e.ts [outDir]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/movement';
mkdirSync(out, { recursive: true });

const PORT = 5520 + Math.floor(Math.random() * 40);
// spawn node directly (not via npx) so kill() reaches the server itself and no orphan is left behind
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), 'server/index.ts', '--port', String(PORT), '--llm', 'offline', '--tts', 'off', '--dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};
type St = { x: number; z: number; y: number; grounded: boolean; speed: number; moving: boolean; camY: number; cutaway: boolean; clip: string | null; toes: [number, number, number][]; bob: { x: number; y: number } | null };
/** per animation frame, in the page, for `ms`: toe joints, position, speed and head bob */
const sample = (page: Page, ms: number) =>
  page.evaluate(`new Promise((resolve) => {
    const out = []; const t0 = performance.now();
    const tick = () => { const s = __acWorld.state(); out.push({ t: (performance.now() - t0) / 1000, toes: s.toes, speed: s.speed, bob: s.bob, clip: s.clip });
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(out); };
    requestAnimationFrame(tick);
  })`) as Promise<{ t: number; toes: [number, number, number][]; speed: number; bob: { x: number; y: number } | null; clip: string | null }[]>;
/**
 * Foot sliding: median horizontal speed of a toe joint while it is planted (within 1.5 cm of its
 * lowest point). 0 = feet stick to the floor; a skating / "flying" look is a large share of body
 * speed. Median, because a walking foot skims ~1–2 cm above the floor mid-swing.
 */
function stanceSlip(frames: Awaited<ReturnType<typeof sample>>): number {
  const slips: number[] = [];
  for (const foot of [0, 1]) {
    const hs = frames.map((f) => f.toes[foot]?.[1] ?? NaN).filter(Number.isFinite);
    if (hs.length < 10) continue;
    const floor = Math.min(...hs);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].toes[foot];
      const b = frames[i].toes[foot];
      if (!a || !b || a[1] > floor + 0.015 || b[1] > floor + 0.015) continue;
      const dt = frames[i].t - frames[i - 1].t;
      if (dt > 0) slips.push(Math.hypot(b[0] - a[0], b[2] - a[2]) / dt);
    }
  }
  slips.sort((p, q) => p - q);
  return slips.length ? slips[Math.floor(slips.length / 2)] : NaN;
}
const st = (page: Page) => page.evaluate('__acWorld.state()') as Promise<St>;
/** peak speed over a short window (the controller's speed is per-frame) */
async function speedWhile(page: Page, ms: number): Promise<{ max: number; clip: string | null }> {
  let max = 0;
  let clip: string | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await st(page);
    if (s.speed > max) max = s.speed;
    clip = s.clip;
    await page.waitForTimeout(60);
  }
  return { max, clip };
}

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const errors: string[] = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForTimeout(7000); // renderer + avatars
  await page.addStyleTag({ content: '.hud, .toasts, .wl-hint { visibility: hidden !important; }' });
  await page.evaluate(`__ac.store.set({ camera: 'third' })`);
  await page.waitForTimeout(400);

  // walk east along the hub
  await page.evaluate('__acWorld.teleport(4, 11, 90, -8)');
  await page.keyboard.down('KeyW');
  const walk = await speedWhile(page, 1200);
  await page.keyboard.up('KeyW');
  check('walk ≈ 2.1 m/s', walk.max > 1.8 && walk.max < 2.4, `${walk.max.toFixed(2)} m/s, clip ${walk.clip}`);

  // planted feet while walking (third person)
  await page.evaluate('__acWorld.teleport(4, 11, 90, -8)');
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  const walkSlip = stanceSlip(await sample(page, 1300));
  await page.keyboard.up('KeyW');
  check('walking: planted feet stay put', walkSlip < 0.35, `planted toe moves ${walkSlip.toFixed(2)} m/s at 2.1 m/s`);

  // Shift+W runs on the fast-run mocap cycle at a human cadence, feet planted
  await page.evaluate('__acWorld.teleport(4, 11, 90, -8)');
  await page.waitForTimeout(500);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  const run = await speedWhile(page, 900);
  const runFrames = await sample(page, 1100);
  await page.screenshot({ path: `${out}/run.png` });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  const runSlip = stanceSlip(runFrames);
  check('Shift+W runs ≈ 5 m/s', run.max > 4.6 && run.max < 5.3, `${run.max.toFixed(2)} m/s`);
  check('the run plays the fast-run mocap cycle', !!run.clip && run.clip.endsWith('_run_fast'), `clip ${run.clip}`);
  check('running: planted feet stay put (no skating)', runSlip < 0.6, `planted toe moves ${runSlip.toFixed(2)} m/s at 5 m/s`);

  // first person: the view bounces in step with the footfalls
  await page.evaluate(`__ac.store.set({ camera: 'first' })`);
  await page.evaluate('__acWorld.teleport(4, 11, 90, -4)');
  await page.waitForTimeout(500);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  const fpFrames = await sample(page, 1000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  const bobs = fpFrames.map((f) => f.bob?.y).filter((v): v is number => typeof v === 'number');
  const bobAmp = bobs.length ? Math.max(...bobs) - Math.min(...bobs) : 0;
  check('first person: running bounces the view (mocap head motion)', bobAmp > 0.02 && bobAmp < 0.14, `${(bobAmp * 100).toFixed(1)} cm peak-to-peak`);
  await page.evaluate(`__ac.store.set({ camera: 'third' })`);
  await page.waitForTimeout(300);

  // double-tap W and hold also runs
  await page.evaluate('__acWorld.teleport(4, 11, 90, -8)');
  await page.waitForTimeout(500);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(70);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(110);
  await page.keyboard.down('KeyW');
  const tap = await speedWhile(page, 1200);
  await page.keyboard.up('KeyW');
  check('double-tap W and hold runs', tap.max > 4.6, `${tap.max.toFixed(2)} m/s`);
  await page.waitForTimeout(300);
  const after = await speedWhile(page, 300);
  check('releasing W stops the run', after.max < 0.5, `${after.max.toFixed(2)} m/s`);

  // jump: ~0.4 m standing jump, lands again
  await page.evaluate('__acWorld.teleport(8, 11, 135, -10)');
  await page.waitForTimeout(600);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  let peak = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    const s = await st(page);
    peak = Math.max(peak, s.y);
    await page.waitForTimeout(15);
  }
  const landed = await st(page);
  check('Space jumps ~0.4 m', peak > 0.25 && peak < 0.55, `peak ${peak.toFixed(2)} m`);
  check('and lands', landed.grounded && landed.y < 0.01, `y ${landed.y.toFixed(3)}`);
  // a second jump for the picture (the shot itself takes a few hundred ms, so it lands mid-air or close)
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await page.waitForTimeout(40);
  await page.screenshot({ path: `${out}/jump.png` });

  // stairs (when the layout has them): up flight 1, across the half-landing, up flight 2
  const climb = async (x: number, z: number, yaw: number, ms: number) => {
    await page.evaluate(`__acWorld.teleport(${x}, ${z}, ${yaw}, -10)`);
    await page.waitForTimeout(250);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(ms);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);
    return (await st(page)) as St;
  };
  // the dog-leg core of the east wing: flight 1 rises north at x≈48.8 from z≈3.9 to the half-landing
  const foot = await climb(48.76, 5.6, 180, 200);
  if (Math.abs(foot.x - 48.76) < 0.5) {
    const half = await climb(48.76, 4.6, 180, 1900);
    check('stairs: flight 1 climbs to the half-landing (1.5 m)', Math.abs(half.y - 1.5) < 0.12 && half.z < 1.45, `y ${half.y.toFixed(2)} at z ${half.z.toFixed(2)}`);
    await page.evaluate(`__ac.store.set({ camera: 'third' })`);
    const across = await climb(half.x, 0.8, 90, 700); // east along the half-landing
    const upper = await climb(50.24, 1.0, 0, 2300); // flight 2 rises south to the upper landing
    check('stairs: flight 2 climbs to the upper landing (3.0 m)', Math.abs(upper.y - 3.0) < 0.12 && upper.z > 3.9, `across at y ${across.y.toFixed(2)}; y ${upper.y.toFixed(2)} at z ${upper.z.toFixed(2)}`);
    await page.screenshot({ path: `${out}/stairs-upper.png` });
    const fence = await climb(50.24, 4.6, 0, 1500); // walk south toward the upper landing's open edge
    check("stairs: the upper landing's guardrail holds you", fence.y > 2.9 && fence.z < 5.25, `y ${fence.y.toFixed(2)} at z ${fence.z.toFixed(2)}`);
  } else console.log('   (no east-wing stair core in this layout — stair checks skipped)');

  // over the shoulder, zooming all the way out looking down: the camera stays under the ceiling (no
  // view through the roof); the top-down camera is the one that opens the rooms like a dollhouse
  await page.evaluate('__acWorld.teleport(14, 11, 160, -42)');
  await page.mouse.move(800, 450);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(900);
  const high = await st(page);
  await page.screenshot({ path: `${out}/zoomed-out.png` });
  check('third person zoomed out stays under the ceiling', high.camY < 2.9 && !high.cutaway, `camY ${high.camY.toFixed(2)} cutaway ${high.cutaway}`);
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(700);
  const low = await st(page);
  check('zooming back in keeps the ceilings', !low.cutaway && low.camY < 3, `camY ${low.camY.toFixed(2)} cutaway ${low.cutaway}`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all movement checks passed'} · screenshots in ${out}/`);
process.exit(failed ? 1 : 0);

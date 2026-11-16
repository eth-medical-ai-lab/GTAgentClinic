/**
 * The soundscape in the real client (headless Chromium, real Web Audio): boots a private server on
 * a random port (offline NPCs, TTS off) and checks that
 *  - no AudioContext exists before the first click, and the soundscape starts after it
 *  - the bedside monitor's QRS tone follows the monitored HR, pitched by SpO₂
 *  - walking makes footsteps, the waiting room's sliding door opens, the API works
 *  - the 🎚 setting turns it off (and the context sleeps), a hidden tab suspends it
 *  - nothing throws
 * and reports the main-thread cost per frame and the browser's CPU with ambience on vs off.
 * Stops the server and the browser at the end.
 *
 *   npx tsx tests/audio-e2e.ts [outDir]            (Vite dev server: no build needed)
 *   npx tsx tests/audio-e2e.ts [outDir] --built    (the built client in dist/: run `npm run build` first)
 *
 * With outDir, it also saves close-ups of a live bedside monitor and the waiting-room TV.
 * --voices also turns NPC voices on (Kokoro; the model must be cached or it downloads ~326 MB) and
 * checks the spoken ambience: an overhead page and the waiting-room TV.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
if (out) mkdirSync(out, { recursive: true });

const PORT = 5600 + Math.floor(Math.random() * 60);
// spawn node directly (not via npx) so kill() reaches the server itself and no orphan is left behind
const dev = !process.argv.includes('--built');
const voices = process.argv.includes('--voices');
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), 'server/index.ts', '--port', String(PORT), '--llm', 'offline', '--tts', voices ? 'kokoro' : 'off', ...(dev ? ['--dev'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
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

interface MonStat {
  bay: string;
  patientId: string;
  hr: number;
  spo2: number;
  toneHz: number;
  alarm: string | null;
  beeps: number;
  bursts: number;
}
interface Stats {
  started: boolean;
  context: string;
  level: string;
  room: string | null;
  monitors: MonStat[];
  radio: { playing: boolean; track: string | null; tracks: number; error?: string; at?: number; broadcast?: string } | null;
  counts: Record<string, number>;
  doors: { x: number; z: number; open: boolean; exterior: boolean; by: string }[];
  frameMs: number;
  frameMsMax: number;
  framesPerSec: number;
}
const stats = (page: Page) => page.evaluate('__acSound.stats()') as Promise<Stats | null>;
const count = (s: Stats | null, k: string) => s?.counts[k] ?? 0;

/** cumulative CPU seconds of this test's browser processes (children of this node process) */
function browserCpuSeconds(): number {
  const kids = (pid: number): number[] => {
    try {
      const out = execFileSync('pgrep', ['-P', String(pid)]).toString().trim();
      const direct = out ? out.split('\n').map(Number) : [];
      return direct.flatMap((k) => [k, ...kids(k)]);
    } catch {
      return [];
    }
  };
  const serverTree = new Set([server.pid!, ...kids(server.pid!)]);
  const pids = kids(process.pid).filter((p) => !serverTree.has(p));
  if (!pids.length) return 0;
  const out = execFileSync('ps', ['-o', 'time=', '-p', pids.join(',')]).toString().trim().split('\n');
  let sec = 0;
  for (const line of out) {
    const parts = line.trim().split(':').map(Number);
    sec += parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  return sec;
}

async function cpuPercent(page: Page, ms: number): Promise<number> {
  const c0 = browserCpuSeconds();
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  return ((browserCpuSeconds() - c0) / ((Date.now() - t0) / 1000)) * 100;
}

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.waitForTimeout(500);
  check('no AudioContext before the first click', (await page.evaluate('__acSound.context()')) === 'none');

  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForTimeout(6000);
  let s = await stats(page);
  check('the soundscape starts after the first click', !!s?.started && s.context === 'running', `context ${s?.context}, level ${s?.level}`);

  // patients arrive (Brunner +4, Keller +12); put both on the monitor
  await page.evaluate(`__ac.client.act({ type: 'wait', minutes: 14 })`);
  await page.waitForTimeout(1500);
  for (const pid of ['p_keller', 'p_brunner']) await page.evaluate(`__ac.client.act({ type: 'order', patientId: '${pid}', code: 'monitor' })`);
  await page.evaluate(`__ac.client.act({ type: 'wait', minutes: 8 })`);
  await page.waitForTimeout(2000);
  const mons = (await page.evaluate('Object.keys(__ac.store.get().view.monitors)')) as string[];
  check('patients are on the monitor', mons.length >= 1, mons.join(', '));

  // stand at the foot of Bed 2 and count QRS beeps against the HR
  const bay = mons.includes('bed_2') ? 'bed_2' : mons[0];
  const bayX = { bed_1: 2, bed_2: 6, bed_3: 10, bed_4: 14, bed_5: 18, bed_6: 22 }[bay as 'bed_2'] ?? 6;
  await page.evaluate(`__acWorld.teleport(${bayX}, 4.6, 180)`);
  await page.waitForTimeout(2500);
  s = await stats(page);
  const m0 = s?.monitors.find((m) => m.bay === bay);
  const t0 = Date.now();
  // the monitored HR moves a little from reading to reading: average it over the window
  const hrs: number[] = [];
  let minFps = Infinity;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const st = await stats(page);
    const h = st?.monitors.find((m) => m.bay === bay)?.hr;
    if (h) hrs.push(h);
    if (st) minFps = Math.min(minFps, st.framesPerSec);
  }
  s = await stats(page);
  const m1 = s?.monitors.find((m) => m.bay === bay);
  if (m0 && m1) {
    const min = (Date.now() - t0) / 60000;
    const rate = (m1.beeps - m0.beeps) / min;
    const hr = hrs.reduce((a, b) => a + b, 0) / Math.max(1, hrs.length);
    check('QRS tone follows the HR', Math.abs(rate - hr) <= Math.max(4, hr * 0.08), `${rate.toFixed(1)} beeps/min at a mean HR of ${hr.toFixed(1)} (${Math.min(...hrs)}–${Math.max(...hrs)}), ${bay}; sound frames/s ≥ ${minFps.toFixed(1)}`);
    const expectHz = 662 * 2 ** ((Math.min(100, Math.max(50, Math.round(m1.spo2))) - 100) / 24);
    check('beep pitch follows SpO₂ (662 Hz at 100 %, an octave per 24 %)', Math.abs(m1.toneHz - expectHz) < 1.5, `SpO₂ ${m1.spo2} % → ${m1.toneHz} Hz`);
    console.log(`  monitors: ${s!.monitors.map((m) => `${m.bay} HR ${m.hr} SpO₂ ${m.spo2} alarm ${m.alarm ?? '—'} bursts ${m.bursts}`).join(' · ')}`);
  } else check('QRS tone follows the HR', false, `no monitor stats for ${bay}`);
  if (out) {
    // the live monitor: R waves on the sweep, the same beats the tone beeps on
    await page.addStyleTag({ content: '.hud, .toasts, .wl-hint, .wl-crosshair { visibility: hidden !important; }' });
    await page.evaluate(`__acWorld.teleport(${bayX + 1.05}, 1.75, 180, 2)`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/monitor-${bay}.png` });
    await page.evaluate(`__acSound.tvPreview('weather', 'Clear tonight, low 41°F')`);
    await page.evaluate('__acWorld.teleport(2.6, 19.6, -90, 6)');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/waiting-tv.png` });
    await page.addStyleTag({ content: '.hud, .toasts { visibility: visible !important; }' });
    console.log(`  📸 ${out}/monitor-${bay}.png, ${out}/waiting-tv.png`);
  }

  // footsteps and the waiting room's sliding door
  // walk east across the parking lot (open ground, asphalt; the corridors may be crowded)
  const steps0 = count(s, 'step.player');
  await page.evaluate('__acWorld.teleport(16, 31, 90, -5)');
  await page.waitForTimeout(400);
  const p0 = (await page.evaluate('__acWorld.state()')) as { x: number; z: number };
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200);
  await page.keyboard.up('KeyW');
  const p1 = (await page.evaluate('__acWorld.state()')) as { x: number; z: number };
  s = await stats(page);
  const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const steps = count(s, 'step.player') - steps0;
  // ~1 m steps at the player's 2.1 m/s walk (cadence 1.55 + 0.25 × speed)
  check('walking makes footsteps', walked > 1 && Math.abs(steps - walked / (2.1 / 2.075)) <= 2, `${steps} steps over ${walked.toFixed(1)} m, ${s?.room ?? '?'}`);
  // the waiting room's sliding door (north wall, x 4.7): open while someone is in it, closed after
  const door = () => s?.doors.find((d) => Math.abs(d.x - 4.7) < 0.3 && Math.abs(d.z - 15) < 0.3);
  await page.evaluate('__acWorld.teleport(4.7, 15.1, 180, 0)');
  await page.waitForTimeout(1200);
  s = await stats(page);
  const openWhileIn = !!door()?.open;
  await page.evaluate('__acWorld.teleport(4.7, 21.5, 180, 0)');
  let closed = false;
  for (let i = 0; i < 12 && !closed; i++) {
    await page.waitForTimeout(500);
    s = await stats(page);
    closed = door()?.open === false;
  }
  check('the waiting room door opens for you and closes after', openWhileIn && (closed || door()?.by !== ''), `open ${openWhileIn}, closed later ${closed}${closed ? '' : ` (held open by ${door()?.by || 'nobody'})`}`);

  // the API other systems will use
  const apiOk = await page.evaluate(`(async () => {
    const S = __acSound;
    const h = S.playSound('phone.mobile', { at: { x: 3, z: 19 }, loop: true });
    const v = S.playSound('phone.vibrate', { npc: 'vis_1', loop: true, gain: 0.8 });
    S.startAmbience('test-earbuds', { sound: 'earbuds', at: { x: 2.5, z: 18.2 }, gain: 0.7 });
    S.playSound('thud', { at: { x: 5, z: 16 } });
    S.playSound({ url: '/res/audio/radio/goldberg-var19.mp3' }, { at: { x: 22, z: 11 }, gain: 0.2 });
    S.overheadPage('Respiratory therapy to the emergency department, please.');
    S.stopAmbience('tv');
    S.startAmbience('tv');
    await new Promise((r) => setTimeout(r, 1500));
    const playing = h.playing;
    h.stop(0.2);
    v.stop();
    S.stopAmbience('test-earbuds');
    S.playSound('siren.pass');
    return playing;
  })()`);
  await page.waitForTimeout(800);
  s = await stats(page);
  check('API: positional loop, NPC-attached sound, ambience, page, siren', apiOk === true && count(s, 'siren.pass') >= 1, `loop playing ${apiOk}, sirens ${count(s, 'siren.pass')}`);

  if (voices) {
    // spoken ambience: voices on, wait for the model, then a page and the waiting-room TV
    await page.evaluate(`__ac.client.settings({ tts: true })`);
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await page.waitForTimeout(1000);
      ready = (await page.evaluate(`fetch('/api/tts').then((r) => r.json()).then((j) => j.status)`)) === 'ready';
    }
    check('Kokoro is ready for the spoken ambience', ready);
    const pages0 = count(await stats(page), 'page');
    await page.evaluate(`__acSound.overheadPage('Respiratory therapy to the emergency department, please.')`);
    let pages = 0;
    for (let i = 0; i < 40 && !pages; i++) {
      await page.waitForTimeout(1000);
      pages = count(await stats(page), 'page') - pages0;
    }
    check('an overhead page is spoken through the PA chain', pages >= 1, `${pages} page(s)`);
    await page.evaluate('__acWorld.teleport(3.5, 19.6, -90, 4)');
    let tv = 0;
    for (let i = 0; i < 45 && !tv; i++) {
      await page.waitForTimeout(1000);
      tv = count(await stats(page), 'tv.line');
    }
    check('the waiting-room TV talks (and shows the headline)', tv >= 1, `${tv} line(s)`);
    if (out) await page.screenshot({ path: `${out}/waiting-tv-live.png` });
    await page.evaluate(`__ac.client.settings({ tts: false })`);
  }

  // the station: radio (CC0 recordings) and the hum of the workstations
  await page.evaluate('__acWorld.teleport(24.5, 13.3, 0, 0)');
  let radio = null as Stats['radio'];
  // a gap between pieces is at most 10 s
  for (let i = 0; i < 30 && !radio?.playing; i++) {
    await page.waitForTimeout(500);
    radio = (await stats(page))?.radio ?? null;
  }
  check('the station radio plays (CC0 recordings)', !!radio?.playing && radio.tracks >= 1, `${radio?.tracks} tracks, playing ${radio?.playing} at ${radio?.at} s; on air: ${radio?.broadcast}${radio?.error ? `; ${radio.error}` : ''}`);

  // cost: main thread per frame (steady state, after the idle-time pre-rendering), and the browser's
  // CPU with ambience on vs off (same spot, same view)
  await page.waitForTimeout(6000);
  s = await stats(page);
  const frameMs = s?.frameMs ?? NaN;
  const frameMsMax = s?.frameMsMax ?? NaN;
  const cpuOn = await cpuPercent(page, 15000);
  // the HUD control: cycle to Off
  for (let i = 0; i < 4 && (await stats(page))?.level !== 'off'; i++) await page.click('.hud-right button:has-text("🎚")');
  await page.waitForTimeout(1500);
  s = await stats(page);
  check('🎚 Off stops the soundscape and lets the audio thread sleep (voices off)', s?.level === 'off' && s.context === 'suspended', `level ${s?.level}, context ${s?.context}`);
  const cpuOff = await cpuPercent(page, 15000);
  // the same with the context awake but nothing connected: the cost of the graph itself vs a live audio thread
  await page.evaluate('__acSound.wake()');
  await page.waitForTimeout(500);
  const cpuIdle = await cpuPercent(page, 15000);
  console.log(`  cost: main thread ${frameMs.toFixed(3)} ms per sound frame (median; worst ${frameMsMax.toFixed(2)} ms), 30/s ≈ ${((frameMs * 30) / 10).toFixed(2)} % of a core`);
  console.log(`        browser CPU (all its processes, rendering included): ambience on ${cpuOn.toFixed(1)} % · off, audio suspended ${cpuOff.toFixed(1)} % · off, audio thread awake ${cpuIdle.toFixed(1)} %`);
  for (let i = 0; i < 4 && (await stats(page))?.level !== 'medium'; i++) await page.click('.hud-right button:has-text("🎚")');
  await page.waitForTimeout(1200);
  s = await stats(page);
  check('🎚 back on resumes it', s?.level === 'medium' && s.context === 'running', `level ${s?.level}, context ${s?.context}`);

  // a hidden tab suspends the context; visible again resumes it
  const hidden = await page.evaluate(`(async () => {
    const set = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); };
    set(true);
    await new Promise((r) => setTimeout(r, 600));
    const a = __acSound.context();
    set(false);
    await new Promise((r) => setTimeout(r, 600));
    return [a, __acSound.context()];
  })()`) as string[];
  check('hidden tab suspends, visible resumes', hidden[0] === 'suspended' && hidden[1] === 'running', hidden.join(' → '));
  s = await stats(page);
  console.log(`  events: ${Object.entries(s?.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (count(s, 'step.player') < 5) console.log('  (the counts restarted: Vite reloaded the page during the run, another process saved a client file)');
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all soundscape checks passed'}`);
process.exit(failed ? 1 : 0);

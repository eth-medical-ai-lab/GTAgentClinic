/**
 * Workstation logins on the real GPU (client/src/world/workstation.ts, client/src/ui/EhrTransition.tsx):
 * sit down, badge in, zoom into AgentChart and back out, in first person, third person and
 * top-down; skipping; reduced motion; walking past never logs in; the cart, the med cabinet (MAR);
 * staff-only and occupied computers refuse; the other ways into AgentChart still open it directly;
 * and the frame rate on High at 1600×900. Screenshot series (real-time screencast frames) go to outDir.
 *
 *   npx tsx tests/workstation-e2e.ts [outDir] [--only=third,registration]
 *
 * Boots a private dev server on a random port (6600–6639) and stops it, and the browser, at the end.
 * Other people's edits make the dev server hot-reload the page; a step that sees a reload is re-run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CDPSession, Page } from 'playwright';
import { startHarness } from './harness';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/workstation';
mkdirSync(out, { recursive: true });

type Ws = {
  phase: string;
  led: boolean;
  red: boolean;
  ring: number[] | null;
  notice: string | null;
  screen: string | null;
  seated: boolean;
  posture: string;
  camY: number;
  fov: number;
  quad: [number, number][] | null;
  badge: number[] | null;
  reader: number[] | null;
  player: { x: number; z: number; facing: number };
  devices: {
    id: string;
    kind: string;
    access: string;
    label: string;
    seat: string | null;
    user: string | null;
    screen: { x: number; y: number; z: number };
    rot: number;
    /** its desk chair: rolled back (m), swivelled (rad), solid, where its seat is */
    chair: { push: number; turn: number; solid: boolean; x: number; z: number } | null;
  }[];
};
type St = { x: number; z: number; camY: number; cutaway: boolean };

const h = await startHarness({ portBase: 6600, dev: true });
const errors: string[] = [];
let page: Page;
let loads = 0;
const ws = (opts = '') => page.evaluate(`__acWorld.workstation(${opts})`) as Promise<Ws>;
const st = () => page.evaluate('__acWorld.state()') as Promise<St>;
const panel = () => page.evaluate('(() => { const p = __ac.store.get().panel; return p ? p.kind : null; })()') as Promise<string | null>;
const ehrOpen = () => page.evaluate(`!!document.querySelector('.ehr-root')`) as Promise<boolean>;
const prompt = () => page.evaluate(`document.querySelector('.hud-prompt')?.textContent ?? null`) as Promise<string | null>;

/** (the generic "click to look around" hint comes back for 8 s on every camera switch; it would cover the shots) */
const SHOT_STYLE = '.toasts, .wl-hint { visibility: hidden !important; }';

/** wait until the world is back after a (hot) reload */
async function ready() {
  await page.waitForFunction('!!window.__acWorld && !!window.__ac', undefined, { timeout: 60000 });
  await page.addStyleTag({ content: SHOT_STYLE }).catch(() => undefined);
  await page.waitForTimeout(6000);
}

/** the same world as when the step began? (a hot reload, or a crash in someone's half-saved code, makes a new one) */
const sameWorld = async () => (await page.evaluate('!!window.__acWorld && window.__acWorld.__step === 1').catch(() => false)) as boolean;

/** a step's checks, held until we know the world stayed up through it */
let pending: [string, boolean, string][] | null = null;
const check = (name: string, ok: boolean, detail = '') => (pending ? pending.push([name, ok, detail]) : h.check(name, ok, detail));

/** --only=third,registration runs just the steps whose names contain one of those */
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');

/** run a step; if the page reloaded or the world was rebuilt meanwhile, its checks don't count: run it again (twice at most) */
async function step(name: string, fn: () => Promise<void>) {
  if (only && !only.some((o) => name.includes(o))) return;
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    const before = loads;
    // a clean start: no panel left open (a rebuilt world keeps the store's), nothing still signing out
    await page.evaluate('window.__ac && window.__ac.store.set({ panel: null })').catch(() => undefined);
    await untilIdle(2500).catch(() => -1);
    await page.evaluate('window.__acWorld && (window.__acWorld.__step = 1)').catch(() => undefined);
    pending = [];
    let err: unknown = null;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    const held = pending;
    pending = null;
    if (loads === before && (await sameWorld())) {
      for (const c of held) h.check(...c);
      if (err) throw err;
      return;
    }
    console.log(`   (the page reloaded or the world was rebuilt during "${name}", running it again)`);
    await ready();
  }
  h.check(`${name}: ran without the world being rebuilt (other edits kept reloading it)`, false);
}

/** stand `back` m behind where you'd sit (or stand) at a device, looking at its screen */
async function faceDevice(id: string, back = 0.42) {
  const w = await ws();
  const d = w.devices.find((v) => v.id === id)!;
  const nx = Math.sin(d.rot);
  const nz = Math.cos(d.rot);
  const dist = (d.seat ? 0.72 : 0.62) + back;
  const x = d.screen.x + nx * dist;
  const z = d.screen.z + nz * dist;
  const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
  const pitch = (Math.atan2(d.screen.y - 1.65, dist) * 180) / Math.PI;
  await page.evaluate(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
  await page.waitForTimeout(700);
  return d;
}

async function camera(mode: 'first' | 'third' | 'top') {
  await page.evaluate(`__ac.store.set({ camera: '${mode}' })`);
  await page.waitForTimeout(350);
}

/** real-time frames (the compositor's screencast), kept ~every 80 ms, written as name-NN-<ms>.jpg */
async function screencast(cdp: CDPSession, name: string, ms: number, t0 = Date.now()) {
  const frames: { t: number; data: string }[] = [];
  const onFrame = (f: { data: string; sessionId: number }) => {
    frames.push({ t: Date.now(), data: f.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
  return async () => {
    const left = ms - (Date.now() - t0);
    if (left > 0) await page.waitForTimeout(left);
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', onFrame);
    let last = -1e9;
    let n = 0;
    for (const f of frames) {
      if (f.t - last < 80) continue;
      last = f.t;
      writeFileSync(`${out}/${name}-${String(n++).padStart(2, '0')}-${Math.max(0, f.t - t0)}ms.jpg`, Buffer.from(f.data, 'base64'));
    }
    return n;
  };
}

async function fps(ms = 2000): Promise<number> {
  return (await page.evaluate(`new Promise((resolve) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); };
    requestAnimationFrame(tick);
  })`)) as number;
}

/** until the login is idle again (or `ms` passed) */
async function untilIdle(ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await ws()).phase === 'idle' && !(await ehrOpen())) return Date.now() - t0;
    await page.waitForTimeout(50);
  }
  return -1;
}

try {
  ({ page } = await h.nightShift('quality=high', 9000));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('load', () => loads++);
  await page.addStyleTag({ content: SHOT_STYLE });
  const cdp = await page.context().newCDPSession(page);

  // ── every computer can be used with E (or says why not) ──
  await step('inventory', async () => {
    const w = await ws();
    const ids = w.devices.map((d) => d.id);
    check('every computer, both carts and the med cabinet are workstations', ['st_pc_1', 'st_pc_6', 'w_pc', 'tr_pc', 'wr_pc_a', 'cl_pc', 'clh_pc', 'ex1_pc', 'wow0', 'wow1', 'med_disp'].every((id) => ids.includes(id)), `${ids.length} devices`);
    check('registration and clinic reception are staff-only, the station clinical', w.devices.find((d) => d.id === 'w_pc')?.access === 'staff' && w.devices.find((d) => d.id === 'cl_pc')?.access === 'staff' && w.devices.find((d) => d.id === 'st_pc_3')?.access === 'clinical');
  });

  // ── first person: a free station workstation, E → sit, badge, zoom, AgentChart; Esc reverses it ──
  await step('first-person login and logout', async () => {
    let enterMs = -1;
    await camera('first');
    await faceDevice('st_pc_3');
    const p = await prompt();
    check('aiming at a free station computer prompts a login', !!p && /Log in to Workstation 3/.test(p), `prompt ${p}`);
    const t0 = Date.now();
    const done = await screencast(cdp, 'first-login', 2600, t0);
    await page.keyboard.press('e');
    const phases: string[] = [];
    let led = false;
    let seated = false;
    let badgeOnReader = Infinity;
    while (Date.now() - t0 < 2500) {
      const s = await ws();
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
      led ||= s.led;
      seated ||= s.seated && s.posture === 'sit';
      if (s.badge && s.reader) badgeOnReader = Math.min(badgeOnReader, Math.hypot(s.badge[0] - s.reader[0], s.badge[1] - s.reader[1], s.badge[2] - s.reader[2]));
      if (s.phase === 'open' && enterMs < 0) enterMs = Date.now() - t0;
      await page.waitForTimeout(40);
    }
    const n = await done();
    check('the login plays: sit down, badge in, zoom, hand over', phases.includes('enter') && phases.includes('open'), phases.join(' → '));
    check('you sit at the chair', seated);
    check('the badge lands on the reader', badgeOnReader < 0.03, `${(badgeOnReader * 100).toFixed(1)} cm`);
    check('the reader LED turns green', led);
    check('AgentChart takes over in about 1.5–2 s', enterMs > 1000 && enterMs < 2300, `${enterMs} ms to 'open' (+0.38 s morph)`);
    const open = await page.evaluate(`(() => { const r = document.querySelector('.ehr-root'); return r ? { tf: r.style.transform, board: !!document.querySelector('.ehr-ptab.board.on') } : null; })()`) as { tf: string; board: boolean } | null;
    check('AgentChart is open on the tracking board, the morph finished (no transform left)', !!open && open.board && !open.tf, JSON.stringify(open));
    console.log(`   screenshot series: ${n} frames → ${out}/first-login-*.jpg`);

    // ── closing reverses it ──
    check('AgentChart is open, ready to close', await ehrOpen());
    const t1 = Date.now();
    const done2 = await screencast(cdp, 'first-logout', 2600, t1);
    await page.keyboard.press('Escape');
    let sawExit = false;
    let ledOff = false;
    let idleAt = -1;
    while (Date.now() - t1 < 3200) {
      const s = await ws();
      sawExit ||= s.phase === 'exit';
      if (s.phase === 'exit' && !s.led) ledOff = true;
      if (sawExit && s.phase === 'idle') {
        idleAt = Date.now() - t1;
        break;
      }
      await page.waitForTimeout(40);
    }
    await done2();
    const s = await ws();
    const pos = await st();
    check('closing shrinks AgentChart back into the monitor, signs out (LED off), you get up', sawExit && ledOff && s.phase === 'idle' && s.posture === 'stand', `exit ${sawExit}, LED off ${ledOff}, back in ${idleAt} ms, now ${s.phase}/${s.posture}`);
    check('the camera is yours again: first-person eye height and field of view', Math.abs(pos.camY - 1.65) < 0.08 && Math.abs(s.fov - 72) < 0.5, `camY ${pos.camY.toFixed(2)} fov ${s.fov.toFixed(1)}`);
    // you end facing the room: walk off into it
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyW');
    const moved = await st();
    check('and you can walk away', Math.hypot(moved.x - pos.x, moved.z - pos.z) > 0.3, `${Math.hypot(moved.x - pos.x, moved.z - pos.z).toFixed(2)} m`);
  });

  // ── getting up from a desk chair: roll back, rise, step clear, face the room; the chair rolls back in later ──
  for (const [mode, id] of [['first', 'st_pc_3'], ['third', 'st_pc_3'], ['first', 'wr_pc_b'], ['third', 'wr_pc_b']] as const) {
    await step(`stand-up ${mode} ${id}`, async () => {
      await camera(mode);
      const d = await faceDevice(id);
      await page.evaluate(`__acWorld.workstation({ use: '${id}' })`);
      for (let i = 0; i < 80 && (await ws()).phase !== 'open'; i++) await page.waitForTimeout(50);
      await page.waitForTimeout(600);
      // the camera's height every frame while you get up: it must ease, never jump
      await page.evaluate(`(() => { window.__camTrace = []; const t0 = performance.now(); const tick = () => { window.__camTrace.push([performance.now(), __acWorld.state().camY]); if (performance.now() - t0 < 2800) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
      const t0 = Date.now();
      const done = await screencast(cdp, `standup-${mode}-${id}`, 2600, t0);
      await page.keyboard.press('Escape');
      const idle = await untilIdle(3000);
      await done();
      // vertical speed of the eye, frame to frame (a long frame mustn't read as a jump; a snap is many m/s)
      const trace = (await page.evaluate('window.__camTrace')) as [number, number][];
      let speed = 0;
      let jump = 0;
      for (let i = 1; i < trace.length; i++) {
        const dy = Math.abs(trace[i][1] - trace[i - 1][1]);
        jump = Math.max(jump, dy);
        speed = Math.max(speed, dy / Math.max(1e-3, (trace[i][0] - trace[i - 1][0]) / 1000));
      }
      const endY = trace[trace.length - 1][1];
      const s = await ws();
      const chair = s.devices.find((v) => v.id === id)!.chair!;
      const clearOf = Math.hypot(s.player.x - chair.x, s.player.z - chair.z);
      const faceErr = Math.abs(Math.atan2(Math.sin(s.player.facing - d.rot), Math.cos(s.player.facing - d.rot)));
      check(`${mode}, ${d.label}: you roll the chair back, rise, step clear and face the room`, idle > 0 && chair.push > 0.3 && chair.solid && clearOf >= 0.5 && faceErr < 0.25, `${idle} ms, chair back ${chair.push} m, you ${clearOf.toFixed(2)} m from it, facing ${(faceErr * 57.3).toFixed(0)}° off`);
      if (mode === 'first') check(`${mode}, ${d.label}: your eye height rises smoothly (no snap)`, speed < 1.6 && Math.abs(endY - 1.65) < 0.08, `at most ${speed.toFixed(2)} m/s (${(jump * 100).toFixed(1)} cm in a frame), ends at ${endY.toFixed(2)} m`);
      // walk off: it rolls back in; and a chair is solid while you stand
      await page.evaluate(`__acWorld.teleport(${chair.x + Math.sin(d.rot) * 2.2}, ${chair.z + Math.cos(d.rot) * 2.2}, ${(Math.atan2(-Math.sin(d.rot), -Math.cos(d.rot)) * 180) / Math.PI}, -20)`);
      await page.waitForTimeout(1900);
      const home = (await ws()).devices.find((v) => v.id === id)!.chair!;
      check(`${mode}, ${d.label}: the chair rolls back in once you've walked off`, home.push < 0.02, `push ${home.push}`);
    });
  }
  await step('chairs are solid', async () => {
    await camera('first');
    const w = await ws();
    const d = w.devices.find((v) => v.id === 'wr_pc_c')!;
    const chair = d.chair!;
    // behind Resident workstation 2's chair, walking at it
    const nx = Math.sin(d.rot);
    const nz = Math.cos(d.rot);
    await page.evaluate(`__acWorld.teleport(${chair.x + nx * 1.2}, ${chair.z + nz * 1.2}, ${(Math.atan2(-nx, -nz) * 180) / Math.PI}, -25)`);
    await page.waitForTimeout(400);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
    const p = await st();
    const gap = Math.hypot(p.x - chair.x, p.z - chair.z);
    check('a desk chair blocks you while you stand (no walking through it)', gap > 0.4, `stopped ${gap.toFixed(2)} m from its seat`);
  });

  // ── E skips ahead ──
  await step('skip', async () => {
    await camera('first');
    await faceDevice('st_pc_3');
    await page.keyboard.press('e');
    await page.waitForTimeout(250);
    const t0 = Date.now();
    await page.keyboard.press('e');
    let ms = -1;
    while (Date.now() - t0 < 1500) {
      if ((await ws()).phase === 'open') {
        ms = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(25);
    }
    check('E during the login skips straight to AgentChart', ms >= 0 && ms < 400, `${ms} ms`);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const t1 = Date.now();
    await page.mouse.click(800, 450);
    const idle = await untilIdle(1500);
    check('a click skips the logout too', idle >= 0 && Date.now() - t1 < 900, `${Date.now() - t1} ms`);
  });

  // ── reduced motion: instant ──
  await step('reduced motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await camera('first');
    await faceDevice('st_pc_3');
    const t0 = Date.now();
    await page.keyboard.press('e');
    let ms = -1;
    while (Date.now() - t0 < 1500) {
      if (await ehrOpen()) {
        ms = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(20);
    }
    const tf = await page.evaluate(`document.querySelector('.ehr-root')?.style.transform ?? null`);
    check('reduced motion: AgentChart opens at once, no zoom', ms >= 0 && ms < 450 && !tf, `${ms} ms, transform '${tf}'`);
    await page.keyboard.press('Escape');
    const idle = await untilIdle(1500);
    const pos = await st();
    check('reduced motion: closing is instant too, the camera back', idle >= 0 && idle < 400 && Math.abs(pos.camY - 1.65) < 0.08, `${idle} ms, camY ${pos.camY.toFixed(2)}`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  // ── walking past never logs in ──
  await step('walk past', async () => {
    await camera('first');
    // inside the station island, behind the north chairs, heading west past the workstations
    await page.evaluate('__acWorld.teleport(26.6, 11.0, 270, -10)');
    await page.waitForTimeout(400);
    const xs: number[] = [];
    let login = false;
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      xs.push((await st()).x);
      login ||= (await ws()).phase !== 'idle';
    }
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);
    const s = await ws();
    check('walking past the workstations never starts a login', !login && s.phase === 'idle' && s.posture === 'stand' && !(await ehrOpen()) && Math.min(...xs) < 24.2, `walked x ${xs[0].toFixed(1)} → ${Math.min(...xs).toFixed(1)}, ${s.phase}`);
  });

  // ── third person and top-down ──
  for (const mode of ['third', 'top'] as const) {
    await step(`${mode} login`, async () => {
      await camera(mode);
      await faceDevice('st_pc_3');
      const before = await st();
      const t0 = Date.now();
      const done = await screencast(cdp, `${mode}-login`, 2400, t0);
      await page.evaluate(`__acWorld.workstation({ use: 'st_pc_3' })`);
      let open = -1;
      while (Date.now() - t0 < 2300) {
        if (open < 0 && (await ws()).phase === 'open') open = Date.now() - t0;
        await page.waitForTimeout(40);
      }
      await done();
      check(`${mode}: the login opens AgentChart`, open > 0 && (await ehrOpen()), `${open} ms`);
      const t1 = Date.now();
      const done2 = await screencast(cdp, `${mode}-logout`, 1700, t1);
      await page.keyboard.press('Escape');
      const idle = await untilIdle(2500);
      await done2();
      await page.waitForTimeout(500);
      const s = await ws();
      const pos = await st();
      const fov = mode === 'third' ? 64 : 34;
      check(`${mode}: closing puts the camera back`, idle >= 0 && Math.abs(s.fov - fov) < 0.5 && Math.abs(pos.camY - before.camY) < 0.6 && pos.cutaway === before.cutaway, `fov ${s.fov.toFixed(1)} camY ${before.camY.toFixed(2)} → ${pos.camY.toFixed(2)}, cutaway ${before.cutaway} → ${pos.cutaway}`);
    });
  }

  // ── the workstation on wheels: standing, and F still describes it ──
  await step('cart', async () => {
    await camera('first');
    await faceDevice('wow0', 0.5);
    const p = await prompt();
    check('the cart prompts a login (and F to inspect)', !!p && /workstation on wheels/.test(p) && /\[F\]/.test(p), `prompt ${p}`);
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    const card = await page.evaluate(`(() => { const i = __ac.store.get().inspect; return i ? i.title : null; })()`);
    check('F on the cart still describes it', card === 'Workstation on wheels', `${card}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const t0 = Date.now();
    const done = await screencast(cdp, 'cart-login', 2300, t0);
    await page.keyboard.press('e');
    await page.waitForTimeout(2300);
    await done();
    const s = await ws();
    check('E on the cart: a standing login into AgentChart', s.phase === 'open' && !s.seated && (await ehrOpen()), `${s.phase}, seated ${s.seated}`);
    await page.keyboard.press('Escape');
    await untilIdle(2500);
  });

  // ── the med cabinet: the MAR, with the nurse's part spelled out ──
  await step('med cabinet', async () => {
    await camera('first');
    await faceDevice('med_disp', 0.5);
    const t0 = Date.now();
    const done = await screencast(cdp, 'cabinet-login', 2300, t0);
    await page.keyboard.press('e');
    await page.waitForTimeout(2300);
    await done();
    const mar = await page.evaluate(`(() => ({ nav: document.querySelector('.ehr-navb.on')?.textContent ?? '', note: document.querySelector('.ehr-notice')?.textContent ?? '' }))()`) as { nav: string; note: string };
    check('the med cabinet opens AgentChart on the MAR, noting that the nurse pulls verified doses', /MAR/.test(mar.nav) && /nurse pulls/.test(mar.note), JSON.stringify(mar));
    await page.screenshot({ path: `${out}/cabinet-mar.png` });
    await page.keyboard.press('Escape');
    await untilIdle(2500);
  });

  // ── staff-only: registration refuses a doctor's badge ──
  await step('registration refusal', async () => {
    await camera('first');
    const clerk = (await ws()).devices.find((d) => d.id === 'w_pc')?.user ?? null;
    // (0.3 m back keeps you off the waiting room's east wall, which would hide the clerk's speech bubble)
    await faceDevice('w_pc', 0.3);
    await page.evaluate(`__acWorld.workstation({ use: 'w_pc' })`);
    // the clerk's line, while it is up (his own small talk can follow it)
    let bubble = '';
    let red = false;
    for (let i = 0; i < 10 && !(red && /registration only/.test(bubble)); i++) {
      bubble = (await page.evaluate(`[...document.querySelectorAll('.wl-bubble.on')].map((b) => b.textContent).join(' | ')`)) as string;
      // (the LED blinks red twice)
      red ||= (await ws()).red;
      await page.waitForTimeout(40);
    }
    const s = await ws();
    // (the notice and the bubble fade in)
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/refusal-registration.png` });
    check('registration: "staff only", red LED, no login', s.phase === 'idle' && !!s.notice && /Registration workstation \(staff only\): your badge has no access here/.test(s.notice) && red && !(await ehrOpen()), `${s.notice} · red LED ${red}`);
    if (clerk) check(`the clerk (${clerk}) says so`, /registration only/.test(bubble), bubble);
    else console.log('   (nobody at the registration desk just now — no one to say so)');
  });

  // ── occupied: a nurse is charting at a station computer ──
  await step('occupied', async () => {
    await camera('first');
    const w = await ws();
    const busy = w.devices.find((d) => d.id.startsWith('st_pc') && d.user);
    if (!busy) {
      check('a nurse sits at one of the station computers (to test "in use")', false);
      return;
    }
    await faceDevice(busy.id, 0.6);
    await page.evaluate(`__acWorld.workstation({ use: '${busy.id}' })`);
    await page.waitForTimeout(400);
    const s = await ws();
    await page.screenshot({ path: `${out}/refusal-in-use.png` });
    check(`${busy.label}: "In use by ${busy.user}", pointing to a free one`, s.phase === 'idle' && !!s.notice && s.notice.includes(`In use by ${busy.user}`) && /is free ·/.test(s.notice) && !!s.ring, `${s.notice}`);
  });

  // ── other ways into AgentChart don't sit you down ──
  await step('board and tablet', async () => {
    await camera('first');
    await page.evaluate('__acWorld.teleport(20.0, 14.0, 180, -5)');
    await page.waitForTimeout(400);
    await page.keyboard.press('Tab');
    const row = await page.waitForSelector('.th-list .th-row', { timeout: 5000 }).catch(() => null);
    if (row) await row.click();
    await page.waitForTimeout(500);
    const s = await ws();
    check('Tab → the tablet → a patient opens AgentChart at once (no sit-down)', (await panel()) === 'ehr' && s.phase === 'idle' && s.posture === 'stand', `${await panel()} ${s.phase} ${s.posture}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const npc = (await page.evaluate(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.visible); return n ? n.id : null; })()`)) as string | null;
    if (npc) {
      await page.evaluate(`__ac.store.set({ panel: { kind: 'npc', npcId: '${npc}', tab: 'bedside' } })`);
      const btn = await page.waitForSelector('.bedside-order', { timeout: 5000 }).catch(() => null);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(500);
        const s2 = await ws();
        const sec = await page.evaluate(`(() => { const p = __ac.store.get().panel; return p && p.kind === 'ehr' ? p.section : null; })()`);
        check("the tablet's order button opens AgentChart's order entry at once", (await panel()) === 'ehr' && s2.phase === 'idle' && /order/.test(String(sec)), `${await panel()} ${sec} ${s2.phase}`);
        await page.keyboard.press('Escape');
      } else console.log("   (no order button on this patient's tablet — skipped)");
    }
  });

  // ── frame rate on High at 1600×900: walking about, and while a login plays ──
  await step('fps', async () => {
    await page.evaluate(`__ac.store.set({ panel: null })`);
    await camera('first');
    await faceDevice('st_pc_3', 1.2);
    await page.waitForTimeout(2500);
    // the better of two samples: a one-off stall (a texture upload elsewhere) isn't the frame rate
    const fpsIdle = Math.max(await fps(1500), await fps(1500));
    await faceDevice('st_pc_3');
    await page.waitForTimeout(1000);
    await page.keyboard.press('e');
    const during = await fps(1450);
    await page.waitForTimeout(600);
    const open = await fps(1000);
    await page.keyboard.press('Escape');
    const leaving = await fps(1100);
    await untilIdle(2500);
    check('≥ 50 fps on High at 1600×900 (walking about / logging in / AgentChart open / logging out)', Math.min(fpsIdle, during, open, leaving) >= 50, `${fpsIdle} / ${during} / ${open} / ${leaving} fps`);
  });
} finally {
  await h.close();
}
h.check('no browser errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(`\n${h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all workstation checks passed'} · screenshots in ${out}/`);
process.exit(h.failed() ? 1 : 0);

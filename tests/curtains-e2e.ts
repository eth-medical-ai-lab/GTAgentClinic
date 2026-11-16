/**
 * Bay curtains on the real GPU (client/src/world/curtains.ts): a closed curtain stops the player in
 * first-person, third-person and top-down view (the observation gap too); within reach the prompt
 * says "[E] Open curtain", E reaches out and the curtain slides open, you step through and close it
 * behind you from inside; in top-down click-to-walk the route pulls it open, passes and draws it
 * closed with the same reach; a nurse walking into a closed bay stops, pulls it open, steps in and
 * closes it behind her, and walks out the same way. Every frame, nobody (the player, any NPC) crosses
 * a curtain line where fabric hangs (curtainAudit). Plus fps on High at 1600×900 and screenshots,
 * close views of the fabric and the mesh band among them (no black-and-white AO speckle).
 *
 *   npx tsx tests/curtains-e2e.ts [outDir] [--only=block,use,route,npc,fps,views]
 *
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'shots/curtains');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
mkdirSync(out, { recursive: true });

interface CurtainState {
  id: string;
  state: string;
  edge: number;
  goal: number;
  open: number;
  closed: number;
  rule: string;
  override: string | null;
  line: { ax: number; az: number; dx: number; dz: number; nx: number; nz: number; span: number };
}
interface Audit {
  crossings: number;
  violations: { who: string; curtain: string; u: number; edge: number; t: number }[];
  pulls: number;
  closes: number;
  holds: number;
  passages: { who: string; curtain: string; phase: string }[];
  player: { curtain: string; phase: string } | null;
}

const h = await startHarness({ portBase: 7500, dev: true });
try {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // other edits in the tree mid-run must not hot-reload the world under the test
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  // the shift stands still (no server moves); everything client-side keeps running
  await ev(`__ac.client.settings({ paused: true })`);
  await page.addStyleTag({ content: '.toasts, .wl-hint { visibility: hidden !important; }' });
  const hideHud = (on: boolean) => ev(`document.querySelectorAll('.hud, .wl-crosshair, .wl-layer').forEach((e) => (e.style.visibility = '${on ? 'hidden' : ''}'))`);
  const shot = async (name: string) => {
    await page.waitForTimeout(60);
    const f = `${out}/${name}.png`;
    await page.screenshot({ path: f });
    console.log(`📸 ${f}`);
  };
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const curtain = async (id: string) => (await ev<CurtainState[]>('__acWorld.curtains()')).find((c) => c.id === id)!;
  const set = (id: string, s: string) => ev(`__acWorld.curtain('${id}', '${s}')`);
  const state = () => ev<{ x: number; z: number }>('__acWorld.state()');
  const audit = (reset = false) => ev<Audit>(`__acWorld.curtainAudit(${reset})`);
  const prompt = () => ev<string | null>('__ac.store.get().prompt');
  const fps = (ms = 2500) =>
    ev<number>(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); })`);
  /** hold a key for ms while sampling the player's z (the deepest it got) */
  const holdKey = async (key: string, ms: number) => {
    await page.keyboard.down(key);
    let minZ = Infinity;
    let maxZ = -Infinity;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await state();
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
      await page.waitForTimeout(40);
    }
    await page.keyboard.up(key);
    return { minZ, maxZ, end: await state() };
  };
  // Bed 2's curtain line: z 6.94, x 4.12 (the doorway end, by the hand rub) … 7.88; drawn, its edge
  // stops GAP short of the wall
  const LINE = 6.94;
  const GAP = 0.25;
  await audit(true);

  // ── a closed curtain stops the player, in every camera mode (and at the observation gap) ──
  if (want('block')) {
    await set('bed_2', 'snap-closed');
    for (const [mode, key] of [['first', 'KeyW'], ['third', 'KeyW'], ['top', 'KeyW']] as const) {
      await cam(mode);
      await ev(`__acWorld.teleport(6.0, 8.3, 180, -6)`);
      // third person: the camera behind you, looking north at the curtain (look(): camera yaw)
      if (mode === 'third') await ev(`__acWorld.look(0, -10, 2.6)`);
      await page.waitForTimeout(500);
      const r = await holdKey(key, 1800);
      h.check(`${mode === 'top' ? 'top-down' : `${mode} person`}: a closed curtain stops you (walking into it for 1.8 s)`, r.minZ > LINE + 0.3, `closest z ${r.minZ.toFixed(3)} (line ${LINE}, stopped ${(r.minZ - LINE).toFixed(2)} m out)`);
      await hideHud(true);
      await shot(`block-${mode}`);
      await hideHud(false);
    }
    // the 25 cm observation gap at the doorway end is no way through
    await cam('first');
    await ev(`__acWorld.teleport(4.4, 8.0, 180, -6)`);
    await page.waitForTimeout(300);
    const g = await holdKey('KeyW', 1500);
    h.check('the observation gap is too narrow to squeeze through', g.minZ > LINE + 0.2, `closest z ${g.minZ.toFixed(3)}`);
  }

  // ── E within reach: open, step through, close from inside ──
  if (want('use')) {
    await set('bed_2', 'snap-closed');
    await cam('first');
    await ev(`__acWorld.teleport(5.0, 7.75, 180, -4)`);
    await page.waitForTimeout(600);
    const p0 = await prompt();
    h.check('within reach: "[E] Open curtain"', p0 === '[E] Open curtain', String(p0));
    // looking away a little: still offered within reach
    await ev(`__acWorld.teleport(5.0, 7.75, 215, 10)`);
    await page.waitForTimeout(400);
    const p1 = await prompt();
    h.check('the prompt shows within reach without aiming at the fabric', p1 === '[E] Open curtain', String(p1));
    await ev(`__acWorld.teleport(5.0, 7.75, 180, -4)`);
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(260);
    const hands = await ev<{ who: string }[]>('__acWorld.curtainHands()');
    h.check('E: the hand goes out to the curtain', hands.some((x) => x.who === '__player'), JSON.stringify(hands));
    await hideHud(true);
    await shot('use-1-reach-first-person');
    await page.waitForTimeout(450);
    await shot('use-2-sliding-open');
    await page.waitForTimeout(2300);
    await shot('use-3-open');
    await hideHud(false);
    const c1 = await curtain('bed_2');
    h.check('the curtain slid open about a metre at its edge', c1.edge > GAP + 0.9 && c1.edge < GAP + 1.8 && c1.state !== 'opening', `${c1.state} edge ${c1.edge}`);
    // walk in
    const w = await holdKey('KeyW', 1600);
    h.check('open: you walk through', w.end.z < LINE - 0.6, `z ${w.end.z.toFixed(2)}`);
    // inside, turned round: the edge is within reach, close it behind you
    await ev(`__acWorld.teleport(5.2, 6.25, 0, -4)`);
    await page.waitForTimeout(500);
    const p2 = await prompt();
    h.check('turned round inside: "[E] Close curtain"', p2 === '[E] Close curtain', String(p2));
    await cam('third');
    await ev(`__acWorld.look(150, -12, 2.4)`);
    await page.waitForTimeout(600);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(330);
    await hideHud(true);
    await shot('use-4-close-from-inside-third-person');
    await page.waitForTimeout(2200);
    await shot('use-5-closed-from-inside');
    await hideHud(false);
    const c2 = await curtain('bed_2');
    h.check('closed from inside', c2.state === 'closed', `${c2.state} edge ${c2.edge}`);
    // and it holds you in until you open it
    await cam('first');
    await ev(`__acWorld.teleport(6.0, 6.2, 0, -4)`);
    await page.waitForTimeout(300);
    const o = await holdKey('KeyW', 1500);
    h.check('closed: it keeps you in too', o.maxZ < LINE - 0.3, `farthest z ${o.maxZ.toFixed(3)}`);
  }

  // ── top-down click-to-walk through a closed curtain: opened, passed, closed behind ──
  if (want('route')) {
    await set('bed_3', 'snap-closed');
    await cam('top');
    await ev(`__acWorld.teleport(10.6, 10.2, 180)`);
    await page.waitForTimeout(900);
    await ev(`__acWorld.walkTo(9.4, 4.4)`);
    let maxEdge = 0;
    let held = false;
    let reached = false;
    const shots: [string, (s: { phase?: string; edge: number }) => boolean][] = [
      ['route-1-pull', (s) => s.phase === 'pull'],
      ['route-2-through', (s) => s.phase === 'through' && s.edge > 0.9],
      ['route-3-close', (s) => s.phase === 'close'],
    ];
    await hideHud(true);
    const t0 = Date.now();
    while (Date.now() - t0 < 14000) {
      const a = await audit();
      const c = await curtain('bed_3');
      maxEdge = Math.max(maxEdge, c.edge);
      if (a.player?.phase === 'pull') held = true;
      const s = await state();
      if (Math.hypot(s.x - 9.4, s.z - 4.4) < 0.3) reached = true;
      const next = shots[0];
      if (next && next[1]({ phase: a.player?.phase, edge: c.edge })) {
        await shot(next[0]);
        shots.shift();
      }
      if (reached && !a.player && c.state === 'closed') break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(400);
    await shot('route-4-inside-closed');
    await hideHud(false);
    const c = await curtain('bed_3');
    h.check('top-down route: held at the curtain while the hand pulls it open', held);
    h.check('top-down route: pulled open about a metre', maxEdge > 0.9 && maxEdge < 2.0, `widest edge ${maxEdge.toFixed(2)} m`);
    h.check('top-down route: got there', reached);
    h.check('top-down route: drawn closed behind you', c.state === 'closed', c.state);
  }

  // ── a nurse into a closed bay and out again ──
  if (want('npc')) {
    await set('bed_4', 'snap-closed');
    await ev(`__acWorld.curtainMode('relaxed')`);
    const nurse = await ev<string | null>(`(() => { const v = __ac.store.get().view; const ids = __acWorld.npcIds(); const n = v.npcs.find((x) => x.role === 'nurse' && x.visible && ids.includes(x.id)); return n ? n.id : null; })()`);
    h.check('a nurse to walk with', !!nurse, String(nurse));
    if (nurse) {
      // to the hub in front of Bed 4 first, out of the way of the camera
      await ev(`__acWorld.walkNpc('${nurse}', 13.9, 9.5, 180)`);
      for (let i = 0; i < 60; i++) {
        const n = await ev<{ x: number; z: number } | null>(`__acWorld.npc('${nurse}')`);
        if (n && Math.hypot(n.x - 13.9, n.z - 9.5) < 0.4) break;
        await page.waitForTimeout(250);
      }
      await cam('first');
      // looking at Bed 4's doorway end from the hub, a little to the east
      await ev(`__acWorld.teleport(15.6, 10.2, 210, -6)`);
      await page.waitForTimeout(800);
      await hideHud(true);
      await ev(`__acWorld.walkNpc('${nurse}', 12.8, 3.0, 90)`);
      const order: [string, (p: string | undefined, e: number) => boolean][] = [
        ['npc-1-stops-and-reaches', (p) => p === 'pull'],
        ['npc-2-pulled-open', (p, e) => p === 'pull' && e > 0.8],
        ['npc-3-steps-in', (p) => p === 'through'],
        ['npc-4-draws-it-closed', (p) => p === 'close'],
      ];
      let phases = new Set<string>();
      let pulledTo = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const a = await audit();
        const ps = a.passages.find((x) => x.who === nurse);
        if (ps) phases.add(ps.phase);
        const c = await curtain('bed_4');
        pulledTo = Math.max(pulledTo, c.edge);
        if (order[0] && order[0][1](ps?.phase, c.edge)) {
          await shot(order[0][0]);
          order.shift();
        }
        const n = await ev<{ x: number; z: number }>(`__acWorld.npc('${nurse}')`);
        if (Math.hypot(n.x - 12.8, n.z - 3.0) < 0.4 && !ps && c.state === 'closed') break;
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(500);
      await shot('npc-5-closed-behind-her');
      const cIn = await curtain('bed_4');
      h.check('nurse in: stopped at the curtain and pulled it open', phases.has('pull'), [...phases].join(','));
      h.check('nurse in: about a metre', pulledTo > 0.9 && pulledTo < 2.0, `widest ${pulledTo.toFixed(2)} m`);
      h.check('nurse in: drew it closed behind her', phases.has('close') && cIn.state === 'closed', `${[...phases].join(',')} → ${cIn.state}`);
      // and out again
      phases = new Set();
      await ev(`__acWorld.walkNpc('${nurse}', 14.6, 9.4, 180)`);
      let outShot = false;
      const t1 = Date.now();
      while (Date.now() - t1 < 20000) {
        const a = await audit();
        const ps = a.passages.find((x) => x.who === nurse);
        if (ps) phases.add(ps.phase);
        if (!outShot && ps?.phase === 'through') {
          await shot('npc-6-steps-out');
          outShot = true;
        }
        const n = await ev<{ x: number; z: number }>(`__acWorld.npc('${nurse}')`);
        const c = await curtain('bed_4');
        if (Math.hypot(n.x - 14.6, n.z - 9.4) < 0.4 && !ps && c.state === 'closed') break;
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(400);
      await shot('npc-7-out-closed-again');
      await hideHud(false);
      const cOut = await curtain('bed_4');
      h.check('nurse out: pulled it open, stepped out, closed it again', phases.has('pull') && phases.has('close') && cOut.state === 'closed', `${[...phases].join(',')} → ${cOut.state}`);
    }
    await ev(`__acWorld.curtainMode('auto')`);
  }

  // ── nobody went through fabric, all along ──
  {
    const a = await audit();
    h.check('no one (player or NPC) crossed a curtain line where the fabric hung', a.violations.length === 0, `${a.crossings} crossings, ${a.violations.length} through fabric ${JSON.stringify(a.violations.slice(0, 3))}`);
  }

  // ── close views: fabric and mesh band (no black-and-white AO speckle), and fps ──
  if (want('views')) {
    await hideHud(true);
    await set('bed_2', 'snap-closed');
    await set('bed_3', 'snap-closed');
    await cam('first');
    for (const [name, x, z, yaw, pitch] of [
      ['view-hub-bays', 7.5, 10.4, 200, -4],
      ['view-fabric-closest', 6.0, 7.2, 180, -6],
      ['view-glancing', 7.3, 7.32, 262, 2],
      ['view-band-and-gap-from-hub', 5.0, 8.6, 180, 24],
      ['view-band-from-inside', 6.2, 5.6, 0, 26],
    ] as [string, number, number, number, number][]) {
      await ev(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
      await page.waitForTimeout(1400);
      await shot(name);
    }
    await cam('third');
    await ev(`__acWorld.teleport(6.0, 6.1, 0, -8)`);
    await ev(`__acWorld.look(0, -8, 3.5)`);
    await page.waitForTimeout(1400);
    await shot('view-third-person-boom-inside-closed-bay');
    await cam('top');
    await ev(`__acWorld.teleport(10.0, 9.0, 180)`);
    await page.waitForTimeout(1400);
    await shot('view-top-down');
    await hideHud(false);
  }
  if (want('fps')) {
    await ev(`__ac.client.settings({ paused: false })`);
    await cam('first');
    for (const [name, x, z, yaw, pitch] of [
      ['bays', 7.5, 10.4, 200, -4],
      ['in a bay', 6.0, 4.4, 180, -6],
      ['hub', 3.0, 11.2, 90, -3],
    ] as [string, number, number, number, number][]) {
      await ev(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
      await page.waitForTimeout(2500);
      const n = Math.max(await fps(), await fps());
      h.check(`${name}: ≥ 50 fps on High at 1600×900`, n >= 50, `${n} fps`);
    }
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);
void (null as unknown as Page);

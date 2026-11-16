/**
 * The CT suite and the X-ray room on the real GPU (client/src/world/imaging.ts, imagingLife.ts):
 *
 *  static  the scan room, the control room through the lead glass, the console's screens up close,
 *          the X-ray room wide and in detail, the doors from the hub (warning lights, signs)
 *  ct      Night Shift's Mrs Brunner sent for a CT abdomen/pelvis with contrast: she lies on the
 *          couch, the couch rises and carries her into the gantry (her pelvis moves with the cradle,
 *          into the bore), the warning light is on exactly while the beam is, the radiographer is at
 *          the console during the scan; then she is back in her bay. The audit (visualAudit.ts) finds
 *          her body resting on the pad and no skin inside the gantry
 *  xray    Mr Okafor's chest film at the wall stand (standing, facing the detector, the tube at 180 cm,
 *          turned for the lateral), then his ankle on the table (the tube over the ankle)
 *  walk    the player walks (real WASD) from the hub into the scan room, the control room, through
 *          the connecting door, into the X-ray room and its booth
 *
 *   npx tsx tests/imaging-e2e.ts [outDir] [--only=static,ct,xray,walk] [--port-base=8700]
 *
 * Boots a private dev server (tests/harness.ts; never the player's 5317) and stops it at the end.
 * The dev server's hot reload is cut off for the page (other work in the tree would rebuild it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/imaging';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 8700);
mkdirSync(out, { recursive: true });

type V3 = [number, number, number];
interface Cradle { top: number; padTop: number; headZ: number; footZ: number; x: number; planeZ: number; boreY: number; boreR: number; frontZ: number; backZ: number }
interface ImgState {
  t: number;
  scale: number;
  ct: { visit: { id: string; code: string; since: number; until: number; settled: number | null } | null; phase: string; u: number; lift: number; travel: number; spin: number; beam: boolean; lasers: boolean; breath: string | null; contrast: number; warn: boolean[]; lamp: boolean; line: boolean; cradle: Cradle; timeline: { phase: string; t0: number; t1: number }[] | null };
  xr: { visit: { id: string; code: string; settled: number | null } | null; phase: string; view: number; taken: number; tube: { x: number; y: number; z: number; tilt: number }; standY: number; turn: number; light: boolean; prep: boolean; beam: boolean; warn: boolean[] };
  techs: { id: string; x: number; z: number; posture: string; walking: boolean; at: string }[];
}
interface NpcPose { x: number; z: number; yaw: number; posture: string; walking: boolean; location: string; spot: string; pelvis: V3 | null; head: V3 }
interface Finding { who: string; kind: string; what: string; dist: number; detail: string }

const h = await startHarness({ portBase, dev: true });
const summary: Record<string, unknown> = {};
try {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  let hudHidden = false;
  const shot = async (name: string) => {
    if (!hudHidden) {
      await page.addStyleTag({ content: '.hud, .toasts, .wl-hint, .wl-crosshair { visibility: hidden !important; }' });
      hudHidden = true;
    }
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const cam = (pos: V3 | null, at?: V3) => ev(`__acWorld.cam(${JSON.stringify(pos)}, ${JSON.stringify(at ?? null)})`);
  const img = () => ev<ImgState>('__acWorld.imaging()');
  const npc = (id: string) => ev<NpcPose | null>(`__acWorld.npc('${id}')`);
  const act = (a: object) => ev<{ ok: boolean; message?: string }>(`__ac.client.act(${JSON.stringify(a)})`);
  const settings = (s: object) => ev(`__ac.client.settings(${JSON.stringify(s)})`);
  const audit = (x: number, z: number, r: number) => ev<{ findings: Finding[] }>(`__acWorld.audit({ x: ${x}, z: ${z}, r: ${r} })`);
  /** the player out of the way (the fixed cameras film without them) */
  const park = () => ev('__acWorld.teleport(20, 13.6, 0)');

  // ───────────────────────────── static views ─────────────────────────────
  if (want('static')) {
    await park();
    await ev(`__ac.store.set({ camera: 'first' })`);
    await page.waitForTimeout(800);
    const views: [string, V3, V3][] = [
      ['ct-scanroom-wide', [32.45, 1.75, 6.5], [35.0, 0.95, 2.2]],
      ['ct-scanroom-couch-to-gantry', [34.55, 1.55, 5.9], [34.55, 1.0, 1.6]],
      ['ct-scanroom-gantry-front', [35.6, 1.35, 3.6], [34.4, 1.15, 1.75]],
      ['ct-scanroom-to-window', [33.0, 1.6, 5.6], [37.2, 1.3, 2.4]],
      ['ct-control-through-glass', [39.55, 1.62, 4.4], [34.9, 1.0, 1.9]],
      ['ct-control-room', [39.3, 1.7, 6.3], [37.8, 1.0, 1.4]],
      ['ct-console-close', [38.3, 1.3, 1.1], [37.6, 0.98, 2.05]],
      ['ct-injector', [34.6, 1.45, 3.9], [33.5, 1.0, 2.75]],
      ['hub-ct-doors', [36.0, 1.6, 11.0], [37.0, 1.8, 7.0]],
      ['xray-wide', [40.7, 1.8, 6.4], [45.0, 1.2, 2.0]],
      ['xray-table-tube', [42.2, 1.65, 4.6], [44.0, 1.2, 2.2]],
      ['xray-wallstand', [45.1, 1.6, 4.3], [47.7, 1.3, 3.4]],
      ['xray-booth', [44.4, 1.65, 6.6], [46.9, 1.0, 4.9]],
      ['xray-corner-aids', [44.2, 1.5, 3.4], [41.0, 1.1, 0.6]],
      ['hub-xray-door', [42.2, 1.6, 11.0], [42.4, 1.8, 7.0]],
    ];
    for (const [name, pos, at] of views) {
      await cam(pos, at);
      await page.waitForTimeout(name.includes('console') ? 900 : 600);
      await shot(`static-${name}`);
    }
    await cam(null);
  }

  // ───────────────────────────── a CT abdomen/pelvis ─────────────────────────────
  if (want('ct')) {
    await park();
    await act({ type: 'wait', minutes: 6 });
    const pid = 'pt_p_brunner';
    const ord = await act({ type: 'order', patientId: 'p_brunner', code: 'ct_abd_iv' });
    h.check('CT ordered', ord.ok, ord.message);
    // the CT is scheduled 35–75 min out: run the clock to just short of that, then a minute at a time
    await act({ type: 'wait', minutes: 33 });
    let sent = false;
    for (let i = 0; i < 50 && !sent; i++) {
      const p = await npc(pid);
      if (p?.location === 'ct') sent = true;
      else {
        await act({ type: 'wait', minutes: 1 });
        await page.waitForTimeout(250);
      }
    }
    h.check('Brunner is sent to CT', sent);
    const s0 = await img();
    h.check('the view carries the study and its slot', !!s0.ct.visit && s0.ct.visit.code === 'ct_abd_iv' && s0.ct.visit.until - s0.ct.visit.since === 720, JSON.stringify(s0.ct.visit));
    // she walks over and lies on the couch
    let settled = false;
    for (let i = 0; i < 120 && !settled; i++) {
      await page.waitForTimeout(500);
      const s = await img();
      settled = s.ct.visit?.settled != null;
    }
    const lying = await npc(pid);
    const s1 = await img();
    h.check('she lies on the couch', settled && lying?.posture === 'lie' && !lying.walking, JSON.stringify({ posture: lying?.posture, walking: lying?.walking }));
    const c1 = s1.ct.cradle;
    if (lying?.pelvis) {
      const [px, py, pz] = lying.pelvis;
      h.check('her pelvis is on the cradle (over its midline, on the pad, between its ends)', Math.abs(px - c1.x) < 0.12 && py - c1.padTop > 0.03 && py - c1.padTop < 0.3 && pz > c1.headZ && pz < c1.footZ, JSON.stringify({ pelvis: lying.pelvis, cradle: c1 }));
    }
    await cam([36.2, 1.6, 4.8], [34.55, 0.9, 2.6]);
    await shot('ct-1-patient-on-couch');
    // sample the scan: the pelvis follows the cradle, the light follows the beam, the radiographer is at the console
    const samples: { t: number; phase: string; travel: number; top: number; pelvis: V3 | null; beam: boolean; warn: boolean; lamp: boolean; tech: string; techSeated: boolean }[] = [];
    const shots = new Set<string>();
    let lastPhase = '';
    for (let i = 0; i < 900; i++) {
      const s = await img();
      const p = await npc(pid);
      const tech = s.techs.find((t) => t.id === 'img_ct_jordan')!;
      samples.push({ t: s.t, phase: s.ct.phase, travel: s.ct.travel, top: s.ct.cradle.top, pelvis: p?.pelvis ?? null, beam: s.ct.beam, warn: s.ct.warn.some(Boolean), lamp: s.ct.lamp, tech: tech.at, techSeated: tech.posture === 'sit' });
      if (s.ct.phase !== lastPhase) {
        console.log(`  ${s.t.toFixed(0)} s  ${s.ct.phase}  lift ${s.ct.lift}  travel ${s.ct.travel}  beam ${s.ct.beam}`);
        lastPhase = s.ct.phase;
      }
      // a few moments on film, paused so the views hold still
      const moment = s.ct.phase === 'position' && s.ct.lasers && !shots.has('lasers') ? 'lasers' : s.ct.phase === 'scan' && s.ct.beam && s.ct.travel > 1.25 && !shots.has('scan') ? 'scan' : s.ct.phase === 'inject' && s.ct.contrast > 0.3 && !shots.has('inject') ? 'inject' : s.ct.phase === 'scout' && s.ct.beam && !shots.has('scout') ? 'scout' : null;
      if (moment) {
        shots.add(moment);
        await settings({ paused: true });
        await page.waitForTimeout(400);
        if (moment === 'lasers') {
          await cam([35.75, 1.5, 3.9], [34.55, 0.95, 2.6]);
          await shot('ct-2-positioning-lasers');
        } else if (moment === 'scout') {
          await cam([39.55, 1.62, 4.4], [34.9, 1.0, 1.9]);
          await shot('ct-3-scout-from-control-room');
        } else if (moment === 'inject') {
          await cam([33.0, 1.55, 4.4], [34.0, 1.0, 2.6]);
          await shot('ct-4-injection');
          await cam([38.3, 1.3, 1.1], [37.6, 0.98, 2.05]);
          await shot('ct-4-console-during-injection');
        } else {
          const au = await audit(34.55, 2.2, 1.6);
          const mine = au.findings.filter((f) => f.who === pid);
          summary.scanAudit = au.findings;
          h.check('mid-scan: no skin inside the gantry, her body resting on the pad (audit)', !mine.some((f) => f.kind === 'clipping' || f.kind === 'unsupported' || f.kind === 'sunk'), JSON.stringify(mine.slice(0, 6)));
          await cam([36.4, 1.5, 3.4], [34.55, 1.0, 1.7]);
          await shot('ct-5-mid-scan-in-bore');
          await cam([34.55, 1.45, 4.6], [34.55, 1.05, 1.7]);
          await shot('ct-5-mid-scan-down-the-couch');
          await cam([39.55, 1.62, 4.4], [34.9, 1.0, 1.9]);
          await shot('ct-5-mid-scan-control-room');
          await cam([38.3, 1.3, 1.1], [37.6, 0.98, 2.05]);
          await shot('ct-5-mid-scan-console');
          await cam([36.0, 1.6, 11.0], [36.4, 2.3, 7.0]);
          await shot('ct-5-mid-scan-warning-light');
        }
        await settings({ paused: false });
      }
      const p2 = await npc(pid);
      if (p2 && p2.location !== 'ct') break;
      if (s.ct.phase === 'done' && !shots.has('done')) {
        shots.add('done');
        await cam([38.3, 1.3, 1.1], [37.6, 0.98, 2.05]);
        await shot('ct-6-console-images');
      }
      await page.waitForTimeout(120);
    }
    summary.ctSamples = samples.length;
    // the light and the lamp exactly with the beam
    const mism = samples.filter((x) => x.warn !== x.beam || x.lamp !== x.beam);
    h.check('the warning light and the gantry lamp are on exactly while the beam is', samples.some((x) => x.beam) && mism.length === 0, `${samples.filter((x) => x.beam).length} beam samples, ${mism.length} mismatched`);
    // the pelvis moves with the cradle: Δz of the pelvis = −Δtravel, Δy = Δtop
    const lie = samples.filter((x) => x.pelvis && x.phase !== 'arrive' && x.phase !== 'done');
    let worst = 0;
    for (let i = 1; i < lie.length; i++) {
      const a = lie[i - 1];
      const b = lie[i];
      const dz = b.pelvis![2] - a.pelvis![2];
      const dy = b.pelvis![1] - a.pelvis![1];
      worst = Math.max(worst, Math.abs(dz + (b.travel - a.travel)), Math.abs(dy - (b.top - a.top)));
    }
    h.check('her pelvis moves with the cradle (z with the travel, y with the lift; within 3 cm per sample)', lie.length > 20 && worst < 0.03, `worst ${worst.toFixed(3)} m over ${lie.length} samples`);
    const deepest = lie.reduce((m, x) => (x.travel > m.travel ? x : m), lie[0]);
    const c = s1.ct.cradle;
    h.check('…into the bore (the pelvis inside the gantry at the deepest travel)', !!deepest && deepest.pelvis![2] < c.frontZ && deepest.pelvis![2] > c.backZ && Math.hypot(deepest.pelvis![0] - c.x, deepest.pelvis![1] - c.boreY) < c.boreR, JSON.stringify({ travel: deepest?.travel, pelvis: deepest?.pelvis }));
    const beaming = samples.filter((x) => x.beam);
    h.check('the radiographer is at the console whenever the beam is on', beaming.length > 0 && beaming.every((x) => x.tech === 'seat'), JSON.stringify(beaming.slice(0, 3)));
    const back = await npc(pid);
    h.check('afterwards she goes back to her bay', back?.location === 'bed_4', back?.location);
  }

  // ───────────────────────────── a chest film and an ankle ─────────────────────────────
  if (want('xray')) {
    await park();
    const pid = 'pt_p_okafor';
    for (const code of ['xr_chest', 'xr_ankle']) {
      const ord = await act({ type: 'order', patientId: 'p_okafor', code });
      h.check(`${code} ordered`, ord.ok, ord.message);
      await act({ type: 'wait', minutes: 19 });
      let sent = false;
      for (let i = 0; i < 40 && !sent; i++) {
        const p = await npc(pid);
        if (p?.location === 'xray') sent = true;
        else {
          await act({ type: 'wait', minutes: 1 });
          await page.waitForTimeout(250);
        }
      }
      h.check(`Okafor is sent to X-ray (${code})`, sent);
      let settled = false;
      for (let i = 0; i < 120 && !settled; i++) {
        await page.waitForTimeout(500);
        settled = (await img()).xr.visit?.settled != null;
      }
      const p = await npc(pid);
      const erect = code === 'xr_chest';
      h.check(erect ? 'he stands at the wall stand, facing it' : 'he lies on the table', settled && (erect ? p?.posture === 'stand' && Math.abs(Math.sin(p.yaw) - 1) < 0.2 && p.x > 46.9 : p?.posture === 'lie'), JSON.stringify(p && { x: p.x, z: p.z, yaw: p.yaw, posture: p.posture }));
      const seen = new Set<string>();
      const samples: { prep: boolean; beam: boolean; warn: boolean }[] = [];
      for (let i = 0; i < 700; i++) {
        const s = await img();
        samples.push({ prep: s.xr.prep, beam: s.xr.beam, warn: s.xr.warn.some(Boolean) });
        const key = `${s.xr.phase}|${s.xr.view}`;
        if (!seen.has(key)) {
          seen.add(key);
          console.log(`  ${s.t.toFixed(0)} s  ${key}  tube ${JSON.stringify(s.xr.tube)}  light ${s.xr.light}`);
        }
        const moment = s.xr.phase === 'position' && s.xr.light && !seen.has('m:pos') ? 'pos' : s.xr.phase === 'expose' && s.xr.prep && !seen.has(`m:exp${s.xr.view}`) ? `exp${s.xr.view}` : null;
        if (moment) {
          seen.add(`m:${moment}`);
          await settings({ paused: true });
          await page.waitForTimeout(400);
          const st = await img();
          if (moment === 'pos') {
            if (erect) {
              const tz = st.xr.tube.z;
              h.check('the tube faces the wall stand at 180 cm, centred on him', st.xr.tube.tilt > 0.95 && Math.abs(47.42 - st.xr.tube.x - 1.8) < 0.05 && Math.abs(tz - (p?.z ?? 0)) < 0.1, JSON.stringify(st.xr.tube));
              await cam([45.0, 1.7, 5.4], [47.0, 1.3, 3.5]);
              await shot('xr-1-cxr-positioning');
            } else {
              h.check('the tube points down over his ankle at 100 cm', st.xr.tube.tilt < 0.05 && st.xr.tube.x > 43.9 && st.xr.tube.x < 44.5 && Math.abs(st.xr.tube.y - 1.67) < 0.05, JSON.stringify(st.xr.tube));
              await cam([45.6, 1.7, 3.9], [44.0, 0.9, 2.35]);
              await shot('xr-4-ankle-positioning');
            }
          } else {
            const au = await audit(erect ? 47.2 : 43.3, erect ? 3.6 : 2.35, 1.4);
            const mine = au.findings.filter((f) => f.who === pid && (f.kind === 'clipping' || f.kind === 'unsupported' || f.kind === 'sunk'));
            h.check(`${code} ${moment}: nothing intersecting him (audit)`, mine.length === 0, JSON.stringify(mine.slice(0, 4)));
            if (erect) {
              await cam([44.9, 1.6, 2.4], [47.3, 1.35, 3.6]);
              await shot(`xr-2-cxr-${st.xr.view ? 'lateral' : 'pa'}-exposure`);
              await cam([45.0, 1.75, 6.6], [46.8, 1.1, 4.4]);
              await shot(`xr-3-cxr-${st.xr.view ? 'lateral' : 'pa'}-from-booth`);
            } else {
              await cam([42.6, 1.6, 4.3], [44.1, 1.0, 2.35]);
              await shot(`xr-5-ankle-${st.xr.view}-exposure`);
            }
          }
          await settings({ paused: false });
        }
        const p2 = await npc(pid);
        if (p2 && p2.location !== 'xray') break;
        await page.waitForTimeout(120);
      }
      const mism = samples.filter((x) => x.warn !== (x.prep || x.beam));
      h.check(`${code}: the warning light is on exactly while the generator is prepared or exposing`, samples.some((x) => x.beam) && mism.length === 0, `${samples.filter((x) => x.prep || x.beam).length} on, ${mism.length} mismatched`);
      await cam([46.7, 1.3, 6.0], [46.5, 1.0, 5.0]);
      await shot(`xr-6-${code}-console`);
      const back = await npc(pid);
      h.check(`after the ${code} he goes back to Fast Track 1`, back?.location === 'ft_1', back?.location);
    }
  }

  // ───────────────────────────── walking in with WASD ─────────────────────────────
  if (want('walk')) {
    await cam(null);
    await ev(`__ac.store.set({ camera: 'first' })`);
    const where = () => ev<{ x: number; z: number }>('__acWorld.state()');
    const walk = async (from: [number, number, number], ms: number) => {
      await ev(`__acWorld.teleport(${from[0]}, ${from[1]}, ${from[2]}, 0)`);
      await page.waitForTimeout(300);
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(ms);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(300);
      return where();
    };
    await page.click('.wl-input', { position: { x: 800, y: 450 } }).catch(() => undefined);
    const legs: [string, [number, number, number], number, (p: { x: number; z: number }) => boolean][] = [
      ['hub → CT scan room', [35.5, 10.0, 180], 2600, (p) => p.z < 6.3 && p.x > 32.2 && p.x < 37.1],
      ['hub → CT control room', [38.4, 10.0, 180], 2600, (p) => p.z < 6.3 && p.x > 37.3],
      ['control room → scan room (connecting door)', [38.6, 4.9, -90], 1500, (p) => p.x < 37.0],
      ['hub → X-ray room', [41.5, 10.0, 180], 2600, (p) => p.z < 6.3 && p.x > 40.1 && p.x < 47.9],
      ['X-ray room → the booth', [44.6, 6.3, 90], 1300, (p) => p.x > 45.7 && p.z > 4.85],
    ];
    for (const [name, from, ms, ok] of legs) {
      const p = await walk(from, ms);
      h.check(`walk ${name}`, ok(p), `ended at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
    }
    // NPCs route there too
    const routes: [string, number, number][] = [
      ['the CT table side', 35.3, 3.0],
      ['the CT console', 38.6, 2.4],
      ['the X-ray booth', 46.6, 5.95],
      ['the wall stand', 46.6, 3.9],
    ];
    for (const [name, x, z] of routes) {
      await ev(`__acWorld.walkNpc('tech_marcus', ${x}, ${z})`);
      let arrived = false;
      for (let i = 0; i < 80 && !arrived; i++) {
        await page.waitForTimeout(250);
        const m = await npc('tech_marcus');
        arrived = !!m && !m.walking && Math.hypot(m.x - x, m.z - z) < 0.6;
      }
      const m = await npc('tech_marcus');
      h.check(`an NPC walks from the ED to ${name}`, arrived, m ? `${m.x.toFixed(2)}, ${m.z.toFixed(2)}` : 'no npc');
    }
  }

  h.check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

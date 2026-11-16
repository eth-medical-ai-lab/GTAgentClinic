/**
 * Phones in hands and the player's jump, on the real GPU (client/src/world/phone.ts, jump.ts):
 *   - texting crowd members (seated, waiting room) and spawned test people (standing, a left-hander,
 *     a phone call): the thumb's pad comes down onto the glass when it taps, no skin goes in through
 *     the screen, the fingers stay out of the case, the screen faces the eyes; at the ear no head or
 *     hair inside the phone. Close-ups from the side, the front and over the shoulder.
 *   - the jump: a short push-off (≤ 0.12 s), a dip before it, ~0.4 m up, the knees absorbing the landing
 *     (pelvis 8–15 cm down, back up within ~0.35 s), a running leap, the first-person dip on landing.
 *     Side-view frame sequences (CDP screencast).
 * Boots a private server (tests/harness.ts) and stops it at the end.
 *
 *   npx tsx tests/anim-e2e.ts [outDir] [--only=crowd,spawn,jump]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/anim';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
mkdirSync(out, { recursive: true });

type Phone = { id: string; at: number[]; side: 'R' | 'L'; act: string; use: number; call: number; app: string; kb: number; press: number; eyeDist: number; facing: number; centre: number[]; normal: number[]; fwd: [number, number] };
type Check = { glass: number; glassWorst: string; finger: number; fingerWorst: string; palm: number; thumb: number; screen: number; pad: number; head: number };
type Jump = { phase: string; t: number; drop: number; run: number; impact: number; rootY: number; pelvisY: number; lead: string; fall: boolean };

const h = await startHarness({ portBase: 7100, dev: true });
try {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // the dev server's hot reload is cut off for this page (other edits to the tree mid-run would reload it)
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '.hud, .toasts, .wl-hint, .wl-layer, .crosshair { visibility: hidden !important; }' });
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const shot = async (name: string) => {
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const phones = () => ev<Phone[]>('__acAnim.phones()');
  const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`;

  /**
   * Watch phone holder i for `secs`: the skin against the phone at ~8 samples a second (the deepest
   * through the glass, the fingers, the thumb pad's lowest at presses), how the screen faces the eyes.
   */
  async function watch(i: number, secs: number) {
    let glass = 0;
    let glassBone = '';
    let finger = Infinity;
    let head = Infinity;
    let padPress = Infinity;
    let presses = 0;
    let facing = 0;
    let eye = 0;
    let n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      const [c, p] = await ev<[Check, Phone]>(`[__acAnim.phoneCheck(${i}), __acAnim.phones()[${i}]]`);
      if (c.glass < glass) {
        glass = c.glass;
        glassBone = c.glassWorst;
      }
      finger = Math.min(finger, c.finger);
      head = Math.min(head, c.head);
      if (p.press > 0.85) {
        presses++;
        padPress = Math.min(padPress, Math.abs(c.pad));
      }
      // (how it faces the eyes: while it's up — the takes lower it and raise it again now and then)
      if (p.use > 0.9) {
        facing = Math.max(facing, p.facing);
        eye += p.eyeDist;
        n++;
      }
      await page.waitForTimeout(60);
    }
    return { glass, glassBone, finger, head, padPress, presses, facing, eye: n ? eye / n : NaN, n };
  }

  /** close-ups of phone holder i: from its side, from in front, over the shoulder (screen) */
  async function closeUps(i: number, tag: string, call = false) {
    const p = (await phones())[i];
    const [cx, cy, cz] = p.centre;
    const [nx, , nz] = p.normal;
    // the way the person faces, on the floor
    const [fx, fz] = p.fwd;
    // their right (facing f, y up: f × up), and the phone hand's side
    const rx = -fz;
    const rz = fx;
    const hand = p.side === 'R' ? 1 : -1;
    // the eyes: back along the screen's normal by the reading distance
    const [ex, ey, ez] = [cx + p.normal[0] * p.eyeDist, cy + p.normal[1] * p.eyeDist, cz + p.normal[2] * p.eyeDist];
    const views: [string, number[]][] = call
      ? [
          ['side', [cx + nx * -0.42 + fx * 0.05, cy + 0.04, cz + nz * -0.42 + fz * 0.05]],
          ['front', [cx + fx * 0.55 + nx * -0.2, cy + 0.02, cz + fz * 0.55 + nz * -0.2]],
        ]
      : [
          // side: from the phone hand's side, level with the phone
          ['side', [cx + rx * hand * 0.4 + fx * 0.04, cy + 0.04, cz + rz * hand * 0.4 + fz * 0.04]],
          // front: from in front of the person, a little above
          ['front', [cx + fx * 0.42, cy + 0.14, cz + fz * 0.42]],
          // over the shoulder: behind and above the eyes, over the phone hand's shoulder
          ['over-shoulder', [ex - fx * 0.16 + rx * hand * 0.3, ey + 0.22, ez - fz * 0.16 + rz * hand * 0.3]],
        ];
    for (const [name, c] of views) {
      await ev(`__acOutdoor.camera([${c.join(',')}], [${cx},${cy},${cz}])`);
      await page.waitForTimeout(350);
      await shot(`${tag}-${name}`);
    }
    await ev(`__acOutdoor.camera(null)`);
  }

  if (want('crowd')) {
    // waiting room: texting crowd members (the sim decides who; let time pass until a few are)
    await cam('first');
    await ev(`__acWorld.teleport(5.0, 16.4, 0, -10)`);
    type V = { id: string; posture: string; ambient?: { crowd: boolean; act?: string; props?: string[] } };
    let texting: V[] = [];
    for (let k = 0; k < 60 && texting.length < 2; k++) {
      texting = await ev<V[]>(`__ac.store.get().view.npcs.filter((n) => n.ambient?.crowd && n.ambient.act === 'phone_text' && n.ambient.props?.includes('phone')).map((n) => ({ id: n.id, posture: n.posture }))`);
      if (texting.length >= 2) break;
      await ev(`__ac.client.act({ type: 'wait', minutes: 1 })`);
      await page.waitForTimeout(450);
    }
    h.check('crowd members texting in the waiting room', texting.length >= 1, texting.map((n) => `${n.id}:${n.posture}`).join(' '));
    await ev(`__ac.client.settings({ paused: true })`);
    // what posing the phones costs a frame, the waiting room in view (everyone's phone animating)
    await ev(`__acWorld.teleport(5.0, 14.6, 0, -8)`);
    await page.waitForTimeout(1500);
    await ev('__acAnim.cost()');
    const frames = await ev<number>(`new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })`);
    const c = await ev<{ ms: number; calls: number; perCall: number }>('__acAnim.cost()');
    h.check('posing the phones costs little a frame', c.ms / frames < 1.5, `${(c.ms / frames).toFixed(2)} ms/frame over ${frames} frames, ${c.calls} poses (${c.perCall.toFixed(2)} ms each), ${(await phones()).length} phones`);
    for (const n of texting.slice(0, 3)) {
      const np = await ev<{ x: number; z: number; yaw: number }>(`__acWorld.npc('${n.id}')`);
      // stand 1.6 m in front of them, looking at them (they stay in view and animate at full rate)
      const px = np.x + Math.sin(np.yaw) * 1.6;
      const pz = np.z + Math.cos(np.yaw) * 1.6;
      await ev(`__acWorld.teleport(${px}, ${pz}, ${((Math.atan2(np.x - px, np.z - pz) * 180) / Math.PI).toFixed(1)}, -20)`);
      await page.waitForTimeout(2500);
      const all = await phones();
      const i = all.findIndex((p) => Math.hypot(p.at[0] - np.x, p.at[2] - np.z) < 0.5);
      if (i < 0) {
        h.check(`${n.id}: phone holder found`, false);
        continue;
      }
      const w = await watch(i, 7);
      h.check(`${n.id} (${n.posture}, ${all[i].side} hand): nothing through the screen`, w.glass > -0.0015, `deepest ${mm(w.glass)} ${w.glassBone}`);
      h.check(`${n.id}: fingers outside the case`, w.finger > -0.0015, mm(w.finger));
      h.check(`${n.id}: the thumb pad reaches the glass when it taps`, w.presses === 0 || w.padPress < 0.0025, `${w.presses} press samples, pad within ${mm(w.padPress)}`);
      h.check(`${n.id}: screen to the eyes, at reading distance`, w.n === 0 || (w.facing < 30 && w.eye > 0.25 && w.eye < 0.46), `${w.n} samples up: ≤ ${w.facing.toFixed(0)}° off, ${(w.eye * 100).toFixed(0)} cm`);
      await closeUps(i, `crowd-${n.id}-${n.posture}`);
    }
    await ev(`__ac.client.settings({ paused: false })`);
  }

  if (want('spawn')) {
    // test people in the hub: a standing right-handed texter, a left-handed one, a caller of each sex
    await cam('first');
    await ev(`__acWorld.teleport(6.5, 11.2, 90, -12)`);
    await page.waitForTimeout(800);
    const people: [string, number, number, number, string, 'R' | 'L', string][] = [
      ['Female_Adult_04', 9.6, 10.6, -90, 'phone_text', 'R', 'stand-text-R'],
      ['Male_Adult_08', 9.6, 12.0, -90, 'phone_text', 'L', 'stand-text-L'],
      ['Male_Adult_05', 11.2, 10.6, -90, 'phone_call', 'R', 'call-m'],
      ['Female_Adult_03', 11.2, 12.0, -90, 'phone_call', 'R', 'call-f'],
    ];
    for (const [cast, x, z, yaw, act, hand] of people) await ev(`__acAnim.spawn('${cast}', ${x}, ${z}, ${yaw}, '${act}', '${hand}').then(() => true)`);
    await page.waitForTimeout(9000); // the phone takes raise the phone over the first seconds
    const all = await phones();
    for (const [cast, x, z, , act, hand, tag] of people) {
      const i = all.findIndex((p) => Math.hypot(p.at[0] - x, p.at[2] - z) < 0.3);
      if (i < 0) {
        h.check(`${tag}: spawned with a phone`, false);
        continue;
      }
      // look at them (keeps them in view: they're culled like anything else)
      await ev(`__acWorld.teleport(${x - 1.6}, ${z}, 90, -10)`);
      await page.waitForTimeout(600);
      const w = await watch(i, act === 'phone_call' ? 3 : 7);
      const p = (await phones())[i];
      // (asked for the left hand it's always the left; otherwise about one in ten are left-handed, by a hash)
      if (hand === 'L') h.check(`${tag} (${cast}): held in the left hand (mirrored takes)`, p.side === 'L', p.side);
      else console.log(`   ${tag} (${cast}) holds it in the ${p.side === 'L' ? 'left' : 'right'} hand`);
      if (act === 'phone_call') {
        h.check(`${tag}: the phone at the ear`, p.call > 0.8, `at-ear ${p.call.toFixed(2)}`);
        h.check(`${tag}: no head or hair inside the phone`, w.head > -0.003, `deepest ${mm(w.head)}`);
        h.check(`${tag}: fingers outside the case`, w.finger > -0.0015, mm(w.finger));
        await closeUps(i, tag, true);
      } else {
        h.check(`${tag}: nothing through the screen`, w.glass > -0.0015, `deepest ${mm(w.glass)} ${w.glassBone}`);
        h.check(`${tag}: fingers outside the case`, w.finger > -0.0015, mm(w.finger));
        h.check(`${tag}: the thumb pad reaches the glass when it taps`, w.presses > 0 && w.padPress < 0.0025, `${w.presses} press samples, pad within ${mm(w.padPress)}`);
        h.check(`${tag}: screen to the eyes, at reading distance`, w.n > 0 && w.facing < 30 && w.eye > 0.25 && w.eye < 0.46, `${w.n} samples up: ≤ ${w.facing.toFixed(0)}° off, ${(w.eye * 100).toFixed(0)} cm`);
        await closeUps(i, tag);
      }
    }
  }

  if (want('jump')) {
    await cam('third');
    /** per animation frame in the page: the jump layer, the controller, the camera height */
    const record = (ms: number) =>
      ev(`(() => { window.__jl = []; const t0 = performance.now(); const tick = () => { const j = __acAnim.jump(); const s = __acWorld.state(); window.__jl.push({ t: (performance.now() - t0) / 1000, j, y: s.y, g: s.grounded, camY: s.camY, x: s.x }); if (window.__follow) __acOutdoor.camera([s.x, 0.95, s.z + 2.6], [s.x, 0.8, s.z]); if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
    type Row = { t: number; j: Jump | null; y: number; g: boolean; camY: number; x: number };
    const screencast = async (name: string, run: boolean, cx: number) => {
      const x0 = run ? cx - 5.2 : cx;
      await ev(`__acWorld.teleport(${x0}, 11, 90, -6)`);
      await page.waitForTimeout(900);
      // a side camera, 2.6 m off, at hip height (following a run along x: seen from a fixed spot, a
      // sprint's kicked-up heel foreshortens into what looks like a knee on the floor)
      await ev(`window.__follow = ${run}; __acOutdoor.camera([${x0}, 0.95, ${11 + 2.6}], [${x0}, 0.8, 11])`);
      await page.waitForTimeout(500);
      const cdp = await page.context().newCDPSession(page);
      const frames: { t: number; data: string }[] = [];
      cdp.on('Page.screencastFrame', async (f) => {
        frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, data: f.data });
        await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
      await record(2400);
      const tPress = await (async () => {
        if (run) {
          await page.keyboard.down('Shift');
          await page.keyboard.down('KeyW');
          await page.waitForTimeout(700);
        } else await page.waitForTimeout(250);
        const t = Date.now() / 1000;
        await page.keyboard.down('Space');
        await page.keyboard.up('Space');
        return t;
      })();
      // (running: keep running through the landing)
      await page.waitForTimeout(run ? 950 : 1100);
      if (run) {
        await page.keyboard.up('KeyW');
        await page.keyboard.up('Shift');
      }
      await page.waitForTimeout(900);
      await cdp.send('Page.stopScreencast');
      await cdp.detach();
      await ev(`window.__follow = false; __acOutdoor.camera(null)`);
      const rows = await ev<Row[]>('window.__jl');
      let k = 0;
      for (const f of frames) {
        if (f.t < tPress - 0.15 || f.t > tPress + 1.2) continue;
        writeFileSync(`${out}/jump-${name}-${String(k++).padStart(3, '0')}-${(f.t - tPress).toFixed(3)}.jpg`, Buffer.from(f.data, 'base64'));
      }
      console.log(`🎞  ${k} frames: ${out}/jump-${name}-*.jpg`);
      return rows;
    };
    const analyse = (rows: Row[], label: string, run: boolean) => {
      const press = rows.findIndex((r) => !r.g);
      const lift = rows.findIndex((r, i) => i > press && r.y > 0.004);
      const air = rows.filter((r) => r.j?.phase === 'air');
      const land = rows.findIndex((r, i) => i > lift && r.g);
      const wind = rows.filter((r) => r.j?.phase === 'wind');
      const peak = Math.max(...rows.map((r) => r.y));
      const dip = Math.max(0, ...wind.map((r) => r.j!.drop));
      const after = rows.filter((r, i) => i >= land && r.j?.phase === 'land');
      const absorb = Math.max(0, ...after.map((r) => r.j!.drop));
      const settled = rows.findIndex((r, i) => i > land && r.j?.phase === 'idle');
      const delay = lift > 0 && press >= 0 ? rows[lift].t - rows[press].t : NaN;
      h.check(`${label}: takes off within 0.12 s of the key`, delay > 0 && delay <= 0.125, `${(delay * 1000).toFixed(0)} ms`);
      h.check(`${label}: ${run ? 'a quick plant' : 'dips (knees and hips) before the push'}`, run ? dip >= 0 : dip > 0.03, `pelvis down ${(dip * 100).toFixed(1)} cm`);
      h.check(`${label}: ~0.4 m up`, peak > 0.3 && peak < 0.55, `peak ${peak.toFixed(2)} m`);
      h.check(`${label}: in the air ${run ? 'as a leap' : 'with the knees up'}`, air.length > 10 && (!run || (air[0].j?.run ?? 0) > 0.6), `${air.length} air frames, run ${(air[0]?.j?.run ?? 0).toFixed(2)}`);
      h.check(`${label}: the knees take the landing (pelvis 8–15 cm down${run ? '; running on, ~6 cm' : ''})`, absorb > (run ? 0.05 : 0.08) && absorb < 0.16, `${(absorb * 100).toFixed(1)} cm`);
      const rec = settled > 0 && land > 0 ? rows[settled].t - rows[land].t : NaN;
      h.check(`${label}: back up within ~0.35 s`, rec > 0.15 && rec < 0.45, `${(rec * 1000).toFixed(0)} ms`);
      return { delay, dip, peak, absorb, rec };
    };
    const stand = await screencast('standing', false, 9);
    const s = analyse(stand, 'standing jump', false);
    const runRows = await screencast('running', true, 9);
    const r = analyse(runRows, 'running jump', true);
    // a drop off a 1 m edge: no push-off, no tuck, legs reaching; a harder landing absorbs deeper
    await ev(`__acWorld.teleport(9, 11, 90, -6)`);
    await page.waitForTimeout(600);
    await record(1600);
    await ev(`__acWorld.teleportY(9, 11, 1.0, 90, -6)`);
    await page.waitForTimeout(1700);
    const dropRows = await ev<Row[]>('window.__jl');
    const fell = dropRows.filter((q) => q.j?.phase === 'air');
    const dropAbsorb = Math.max(0, ...dropRows.filter((q) => q.j?.phase === 'land').map((q) => q.j!.drop));
    const impact = Math.max(0, ...dropRows.map((q) => q.j?.impact ?? 0));
    h.check('a 1 m drop: falls without a tuck', fell.length > 5 && fell.every((q) => q.j!.fall), `${fell.length} air frames`);
    h.check('a 1 m drop: the knees absorb deeper than after a jump (≤ 16 cm)', dropAbsorb > s.absorb + 0.02 && dropAbsorb <= 0.161, `${(dropAbsorb * 100).toFixed(1)} cm at ${impact.toFixed(1)} m/s vs ${(s.absorb * 100).toFixed(1)} cm`);
    writeFileSync(`${out}/jump-numbers.json`, JSON.stringify({ standing: s, running: r, drop: { absorb: dropAbsorb, impact } }, null, 1));
    // first person: the eyes sink on landing (and a little in the push-off)
    await cam('first');
    await ev(`__acWorld.teleport(9, 11, 90, -4)`);
    await page.waitForTimeout(700);
    await record(1500);
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.waitForTimeout(1600);
    const fp = await ev<Row[]>('window.__jl');
    const eyeAt = fp.map((q) => q.camY - q.y);
    const rest = eyeAt[0];
    const landI = fp.findIndex((q, i) => i > 5 && q.g && fp[i - 1] && !fp[i - 1].g);
    const dipAfter = landI > 0 ? rest - Math.min(...eyeAt.slice(landI, landI + 30)) : 0;
    h.check('first person: the view dips on landing', dipAfter > 0.02 && dipAfter < 0.1, `${(dipAfter * 100).toFixed(1)} cm`);
    await cam('third');
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);
void (null as unknown as Page);

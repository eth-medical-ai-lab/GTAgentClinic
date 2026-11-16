/**
 * The player's body on the real GPU (client/src/world/gesture.ts, care.ts):
 *
 *  - gestures: an elevator call button and a car panel pressed while facing away and glancing off
 *    with the camera; a curtain pulled from inside and from outside the bay; a look away mid-gesture;
 *    first person; walking off mid-gesture. Every frame the hand is out, the reaching wrist stays in
 *    front of the shoulders (in the body's frame) and on its own side; the body faces the target
 *    within ±25° when the hand gets there; the curtain only starts to slide once the hand has hold.
 *  - the bedside: the tablet open for the patient in Bed 4, on a resus stretcher, a ward patient
 *    upstairs (third person; first person keeps the view): the body faces the patient within ±20°,
 *    a palm rests within 4 cm of the rail's top, and the skinned body is clear of the mattress, the
 *    rails, the boards, the patient and the curtains; an exam's hand goes to the body; walking off
 *    lets go.
 *
 *   npx tsx tests/body-e2e.ts [outDir] [--only=elevator,curtain,walkoff,fp,care,exam,ward] [--port-base=7900]
 *
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LAYOUTS } from '../shared/layout';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'shots/body');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 7900);
mkdirSync(out, { recursive: true });

type V3 = [number, number, number];
interface Body {
  t: number;
  x: number;
  z: number;
  facing: number;
  yaw: number;
  moving: boolean;
  LS: V3;
  RS: V3;
  LH: V3;
  RH: V3;
  g: { active: boolean; arm?: 'R' | 'L'; turning?: boolean; weight?: number; pressed?: boolean; pressFacing?: number | null; pressBearing?: number | null; target?: V3 };
  edge?: number;
}
interface Care {
  phase: string;
  visit?: string | null;
  patient?: string;
  bed?: string;
  kind?: string;
  side?: number;
  facing?: number;
  bearing?: number;
  off?: number;
  w?: number;
  lean?: number;
  restK?: number;
  rail?: { side: string; along: string; palm: V3 | null; top: V3 | null; gap: number | null; height: number | null } | null;
  exam?: { maneuver: string; t: number; side: string | null; w: number; lean: number; gap: number | null } | null;
  stance?: [number, number];
  at?: [number, number];
}
type Clear = { vertices: number; worst: Record<string, { gap: number; bone: string }> } | null;

const h = await startHarness({ portBase, dev: true });
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
  // the urosepsis patient is in Bed 4 four minutes in; then the shift stands still (client-side keeps running)
  await ev(`__ac.client.act({ type: 'wait', minutes: 9 })`);
  await page.waitForTimeout(2500);
  await ev(`__ac.client.settings({ paused: true })`);
  await page.addStyleTag({ content: '.toasts, .wl-hint { visibility: hidden !important; }' });
  const hideHud = (on: boolean) => ev(`document.querySelectorAll('.hud, .wl-crosshair, .wl-layer, .tablet, .npc-panel').forEach((e) => (e.style.visibility = '${on ? 'hidden' : ''}'))`);
  const shot = async (name: string) => {
    await hideHud(true);
    await page.waitForTimeout(80);
    const f = `${out}/${name}.png`;
    await page.screenshot({ path: f });
    await hideHud(false);
    console.log(`📸 ${f}`);
  };
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  /** a fixed camera on the third-person body (null: the normal camera) */
  const fix = (pos: V3 | null, at?: V3) => ev(`__acWorld.cam(${JSON.stringify(pos)}, ${JSON.stringify(at ?? null)})`);
  const state = () => ev<{ x: number; z: number; yaw: number; pitch: number; facing: number; moving: boolean }>('__acWorld.state()');
  // sample the body every frame (after the frame's own work) for ms, running `during(t)` in the page
  await ev(`window.__sample = (ms, during, curtain) => new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { setTimeout(() => { const t = performance.now() - t0; if (during) during(t); const s = { t, ...__acWorld.body(), g: __acWorld.gesture() }; if (curtain) s.edge = __acWorld.curtains().find((c) => c.id === curtain).edge; out.push(s); if (t < ms) requestAnimationFrame(tick); else res(out); }, 0); }; requestAnimationFrame(tick); })`);
  const key = (code: string, down: boolean) => `window.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { code: '${code}', key: '${code.slice(-1).toLowerCase()}' }))`;

  /** the wrist of `side` in the body's frame, from the shoulders' midpoint: forward and to the body's right (m) */
  const wrist = (b: Body, side: 'R' | 'L') => {
    const fx = Math.sin(b.facing);
    const fz = Math.cos(b.facing);
    const mx = (b.LS[0] + b.RS[0]) / 2;
    const mz = (b.LS[2] + b.RS[2]) / 2;
    const H = side === 'R' ? b.RH : b.LH;
    const dx = H[0] - mx;
    const dz = H[2] - mz;
    return { fwd: dx * fx + dz * fz, right: dx * -fz + dz * fx };
  };
  /**
   * The checks every gesture must pass: while the hand is out (weight > 0.25) the reaching wrist is
   * in front of the shoulders and on its own side (not across the body); at the press the body faces
   * the target within ±25°. Returns the samples' worst values.
   */
  const judge = (name: string, s: Body[], opts: { press?: boolean } = {}) => {
    let minFwd = Infinity;
    let cross = -Infinity;
    let n = 0;
    let arm: 'R' | 'L' | undefined;
    let at = '';
    for (const b of s) {
      if (!b.g.arm || (b.g.weight ?? 0) < 0.25) continue;
      arm = b.g.arm;
      const w = wrist(b, arm);
      n++;
      minFwd = Math.min(minFwd, w.fwd);
      // across the body: the right wrist to the left of the midline (or the left one to the right)
      const c = arm === 'R' ? -w.right : w.right;
      if (c > cross) {
        cross = c;
        const tg = b.g.target;
        const rel = tg ? ((((Math.atan2(tg[0] - b.x, tg[2] - b.z) - b.facing) * 180) / Math.PI + 540) % 360) - 180 : NaN;
        at = `at ${b.t.toFixed(0)} ms, weight ${b.g.weight}, the target ${rel.toFixed(0)}° off the facing, ${tg ? Math.hypot(tg[0] - b.x, tg[2] - b.z).toFixed(2) : '?'} m away`;
      }
    }
    h.check(`${name}: the hand went out (${arm ?? '?'} arm, ${n} frames)`, n > 3);
    h.check(`${name}: the wrist stays in front of the shoulders`, n > 0 && minFwd > 0.04, `min ${minFwd.toFixed(3)} m ahead`);
    h.check(`${name}: the wrist stays on its own side`, n > 0 && cross < 0.06, `${cross.toFixed(3)} m past the midline, ${at}`);
    if (opts.press !== false) {
      const last = s[s.length - 1].g;
      const off = last.pressFacing !== null && last.pressFacing !== undefined && last.pressBearing !== null && last.pressBearing !== undefined ? Math.abs(((last.pressFacing - last.pressBearing + 540) % 360) - 180) : NaN;
      h.check(`${name}: the body faces the target at the press (±25°)`, off <= 25, `${Number.isNaN(off) ? 'no press' : `${off.toFixed(0)}° off`}`);
    }
    return { minFwd, cross, arm };
  };

  // ───────── elevator ─────────
  if (want('elevator')) {
    await cam('third');
    await fix(null);
    // hall call, Floor 1: the button (53.5, 1.13, 0.15) behind you; the camera glancing off to the side
    await ev(`__acWorld.teleport(53.35, 1.05, 0, -8)`);
    await ev(`__acWorld.look(150, -10, 2.6)`);
    await page.waitForTimeout(1200);
    let s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:call:0'); return await __sample(1500); })()`);
    judge('elevator call, facing away + camera glancing off', s);
    // again, for the picture: the camera off to the side, the shot when the finger is on the button
    await ev(`__acWorld.teleport(53.35, 1.05, 0, -8)`);
    await page.waitForTimeout(900);
    await fix([55.3, 1.75, 2.6], [53.5, 1.15, 0.7]);
    await page.waitForTimeout(400);
    s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:call:0'); return await __sample(700); })()`);
    await shot('elevator-call-glance-after');
    await page.waitForTimeout(900);
    await fix(null);
    // a glance away mid-gesture (the camera swung round while the hand is out): the body stays on the button
    await ev(`__acWorld.teleport(53.35, 1.35, 180, -8)`);
    await ev(`__acWorld.look(180, -10, 2.6)`);
    await page.waitForTimeout(900);
    s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:call:0'); return await __sample(1100, (t) => { if (t > 150 && t < 190) __acWorld.look(0, -10, 2.6); }); })()`);
    const facings = s.filter((b) => (b.g.weight ?? 0) > 0.25).map((b) => (b.facing * 180) / Math.PI);
    judge('elevator call, the camera swung round mid-gesture', s);
    h.check('…the body keeps facing the button while the hand is out', facings.length > 3 && Math.max(...facings) - Math.min(...facings) < 12, `facing ${Math.min(...facings).toFixed(0)}…${Math.max(...facings).toFixed(0)}°`);
    // inside car A: the panel on the side wall; facing the doors (right hand) and facing the back (left hand)
    for (const [yaw, side] of [[0, 'R'], [180, 'L']] as const) {
      await ev(`__acWorld.teleport(52.35, -1.2, ${yaw}, -6)`);
      await ev(`__acWorld.look(${yaw + 140}, -10, 2.0)`);
      await page.waitForTimeout(900);
      s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:car:A'); return await __sample(1300); })()`);
      const r = judge(`car panel, facing ${yaw ? 'the back wall' : 'the doors'}`, s);
      h.check(`…the ${side === 'R' ? 'right' : 'left'} hand (the panel's side)`, r.arm === side, `arm ${r.arm}`);
      await page.waitForTimeout(600);
    }
  }

  // ───────── curtains ─────────
  if (want('curtain')) {
    await cam('third');
    // Bed 2's curtain: line z 6.94, the doorway end at x 4.12; drawn, the edge 0.25 m along (x 4.37)
    const scenes: [string, V3, number, number, V3, V3][] = [
      // inside the bay, facing in (the edge behind you), the camera glancing back at the curtain
      ['curtain-inside', [4.62, 6.55, 180], 330, -1, [5.55, 1.6, 6.55], [4.45, 1.15, 6.8]],
      // outside, beside the edge, facing along the corridor away from it
      ['curtain-outside', [4.8, 7.35, 90], 40, 1, [3.3, 1.6, 8.4], [4.5, 1.15, 7.1]],
    ];
    for (const [name, p, look, , camPos, camAt] of scenes) {
      await ev(`__acWorld.curtain('bed_2', 'snap-closed')`);
      await page.waitForTimeout(300);
      await ev(`__acWorld.teleport(${p[0]}, ${p[1]}, ${p[2]}, -8)`);
      await ev(`__acWorld.look(${look}, -12, 2.4)`);
      await fix(camPos, camAt);
      await page.waitForTimeout(1200);
      const s = await ev<Body[]>(`(async () => { __acWorld.useCurtain('curtain:bed_2'); return await __sample(1700, null, 'bed_2'); })()`);
      judge(name, s);
      // the cloth starts to slide when the hand takes hold, not before
      const pressAt = s.find((b) => b.g.pressed)?.t ?? Infinity;
      const edge0 = s[0].edge ?? 0;
      const early = Math.max(0, ...s.filter((b) => b.t < pressAt - 20).map((b) => Math.abs((b.edge ?? edge0) - edge0)));
      const moved = Math.max(...s.map((b) => Math.abs((b.edge ?? edge0) - edge0)));
      h.check(`${name}: the cloth slides only once the hand has hold`, early < 0.01 && moved > 0.2, `moved ${early.toFixed(3)} m before the hand got there (press at ${pressAt.toFixed(0)} ms), ${moved.toFixed(2)} m in all`);
      // the picture: the hand on the edge
      await ev(`__acWorld.curtain('bed_2', 'snap-closed')`);
      await ev(`__acWorld.teleport(${p[0]}, ${p[1]}, ${p[2]}, -8)`);
      await page.waitForTimeout(900);
      await ev(`__acWorld.useCurtain('curtain:bed_2')`);
      for (let i = 0; i < 40; i++) {
        const g = await ev<Body['g']>('__acWorld.gesture()');
        if (g.pressed) break;
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(60);
      await shot(`${name}-after`);
      await page.waitForTimeout(1500);
      await fix(null);
    }
  }

  // ───────── walking off mid-gesture ─────────
  if (want('walkoff')) {
    await cam('third');
    await fix(null);
    await ev(`__acWorld.teleport(53.35, 1.35, 180, -8)`);
    await ev(`__acWorld.look(180, -10, 2.6)`);
    await page.waitForTimeout(1000);
    const s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:call:0'); return await __sample(1000, (t) => { if (t > 140 && t < 170) { __acWorld.look(30, -10, 2.6); ${key('KeyW', true)}; } if (t > 900) ${key('KeyW', false)}; }); })()`);
    await ev(key('KeyW', false));
    judge('press, then walk off at once', s, { press: false });
    const g = s[s.length - 1].g;
    h.check('…the press is still made', !!g.pressed);
    const outAt = s.find((b) => b.moving && b.t > 140)?.t ?? 0;
    const gone = s.find((b) => b.t > outAt && (b.g.weight ?? 0) < 0.02)?.t ?? Infinity;
    h.check('…the hand lets go within 0.3 s of walking off', gone - outAt < 300, `${(gone - outAt).toFixed(0)} ms`);
  }

  // ───────── first person ─────────
  if (want('fp')) {
    await cam('first');
    await fix(null);
    await ev(`__acWorld.teleport(53.35, 1.05, 0, -4)`);
    await page.waitForTimeout(900);
    const s = await ev<Body[]>(`(async () => { __acWorld.press('elev:east:call:0'); return await __sample(1300, (t) => { if (t > 800 && t < 830) __acWorld.look(40, -4); }); })()`);
    const g = s[s.length - 1].g;
    const off = g.pressFacing !== null && g.pressFacing !== undefined && g.pressBearing !== null && g.pressBearing !== undefined ? Math.abs(((g.pressFacing - g.pressBearing + 540) % 360) - 180) : NaN;
    h.check('first person: the view turns to the button, the body faces it at the press (±25°)', off <= 25, `${off.toFixed(0)}°`);
    const st = await state();
    h.check('first person: after the hand is back the body follows the view again', Math.abs(((((st.facing - st.yaw - Math.PI) * 180) / Math.PI + 540) % 360) - 180) < 2);
    // the panel on your left in a car (facing the back wall): the left hand, mirrored. A car called down
    // and open first (one may have gone up above in the checks before)
    await ev(`__acWorld.teleport(53.5, 1.4, 180, -6)`);
    await ev(`__acWorld.press('elev:east:call:0')`);
    type Cars = { elevator: { cars: { id: string; level: number; phase: string; moving: boolean }[] } };
    let car = 'A';
    for (let i = 0; i < 140; i++) {
      await page.waitForTimeout(100);
      const open = (await ev<Cars>('__acWorld.floors()')).elevator.cars.find((c) => c.level === 0 && c.phase === 'open' && !c.moving);
      if (open) {
        car = open.id;
        break;
      }
    }
    await ev(`__acWorld.teleport(${car === 'A' ? 52.35 : 54.65}, -1.2, 200, -6)`);
    await page.waitForTimeout(700);
    await ev(`__acWorld.press('elev:east:car:${car}')`);
    for (let i = 0; i < 60; i++) {
      if ((await ev<Body['g']>('__acWorld.gesture()')).pressed) break;
      await page.waitForTimeout(20);
    }
    const lg = await ev<Body['g']>('__acWorld.gesture()');
    h.check('first person: the panel on your left gets the left hand', lg.arm === 'L', `arm ${lg.arm}`);
    await shot('fp-left-hand-press-after');
    await page.waitForTimeout(900);
  }

  // ───────── the bedside ─────────
  /** the tablet open for `npc`; wait for the pose; the numbers; shots from `views` */
  const bedside = async (label: string, npc: string, views: [string, V3, V3][], opts: { fp?: boolean; visit?: boolean; sitting?: boolean } = {}) => {
    if (opts.visit) await ev(`__acWorld.careVisit('${npc}')`);
    else await ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${npc}', tab: 'talk' }, tabletMin: false })`);
    let c: Care = { phase: 'off' };
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(100);
      c = await ev<Care>('__acWorld.care()');
      if (c.phase === 'on' && (c.w ?? 0) > 0.97) break;
    }
    await page.waitForTimeout(500);
    c = await ev<Care>('__acWorld.care()');
    h.check(`${label}: at the bedside, turned to the patient (±20°)`, c.phase === 'on' && (c.off ?? 99) <= 20, `${c.phase} ${c.kind} side ${c.side}, facing ${c.facing}° vs ${c.bearing}° (${c.off}° off), stance ${JSON.stringify(c.stance)} at ${JSON.stringify(c.at)}`);
    if (!opts.fp) {
      // (someone sitting on the edge: you stand in front of them, nothing between you to rest a hand on)
      if (!opts.sitting) h.check(`${label}: a palm on the rail's top (≤ 4 cm)`, !!c.rail && c.rail.gap !== null && c.rail.gap <= 0.04, `${c.rail ? `${c.rail.side} hand on the ${c.rail.along}, ${c.rail.gap} m from its top (${c.rail.height} m above)` : 'no rail'}; lean ${c.lean}°, reach ${c.restK}`);
      const cl = await ev<Clear>('__acWorld.careClearance()');
      const w = cl?.worst ?? {};
      const bad = Object.entries(w).filter(([k, v]) => (k === 'restHandOnRail' ? v.gap < -0.02 : v.gap < -0.01));
      h.check(`${label}: no clipping into the bed, rails, patient or curtains`, !!cl && bad.length === 0, bad.length ? bad.map(([k, v]) => `${k} ${v.gap} m (${v.bone})`).join(', ') : `${cl?.vertices} vertices clear${w.restHandOnRail ? `, palm on the rail ${w.restHandOnRail.gap} m` : ''}`);
      for (const [name, pos, at] of views) {
        await fix(pos, at);
        await page.waitForTimeout(350);
        await shot(name);
      }
      await fix(null);
    }
    return c;
  };
  const patientIn = (room: string) => ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.location === '${room}' && x.posture === 'lie'); return n ? n.id : null; })()`);

  if (want('care') || want('exam')) {
    await cam('third');
    const bed4 = await patientIn('bed_4');
    h.check('a patient in Bed 4', !!bed4, String(bed4));
    if (bed4) {
      await ev(`__acWorld.curtain('bed_4', 'snap-open')`);
      // walked into the bay and stopped at the foot of the bed, facing the curtain (the wall) beside it
      await ev(`__acWorld.teleport(14.9, 4.3, 30, -8)`);
      await ev(`__acWorld.look(200, -14, 2.6)`);
      await page.waitForTimeout(1200);
      await fix([12.2, 1.65, 4.9], [14.6, 1.0, 2.6]);
      await page.waitForTimeout(300);
      await shot('care-bed4-0-tablet-closed');
      await fix(null);
      const c = await bedside('Bed 4', bed4, [
        ['care-bed4-after-across', [12.75, 1.55, 1.9], [15.0, 1.05, 2.3]],
        ['care-bed4-after-foot', [14.2, 1.7, 5.2], [14.9, 1.0, 2.2]],
      ]);
      // the third-person camera itself, from behind the shoulder
      await ev(`__acWorld.look(${((c.facing ?? 0) + 180 + 25) % 360}, -16, 2.4)`);
      await page.waitForTimeout(600);
      await shot('care-bed4-after-third-person-camera');
      if (want('exam')) {
        for (const [m, name] of [['cv_auscultate', 'exam-auscultate'], ['abd_palpate', 'exam-palpate'], ['msk_lat_malleolus', 'exam-ankle']] as const) {
          const pid = await ev<string>(`__ac.store.get().view.npcs.find((n) => n.id === '${bed4}').patientId`);
          const r = await ev<{ ok: boolean }>(`__ac.client.act({ type: 'examine', patientId: '${pid}', maneuver: '${m}' })`);
          let e: Care['exam'] = null;
          for (let i = 0; i < 30 && !(e && e.w > 0.98); i++) {
            await page.waitForTimeout(60);
            e = (await ev<Care>('__acWorld.care()')).exam ?? null;
          }
          h.check(`exam ${m}: the hand goes out (from the server's finding)`, !!e && e.w > 0.98, `${JSON.stringify(r).slice(0, 80)} → ${JSON.stringify(e)}`);
          // the arm's own easing (hands.ts) catches up a moment later: then the hand is on the body
          let best = Infinity;
          for (let i = 0; i < 12; i++) {
            await page.waitForTimeout(60);
            const g = (await ev<Care>('__acWorld.care()')).exam?.gap;
            if (g !== null && g !== undefined) best = Math.min(best, g);
          }
          const where = await ev<Care>('__acWorld.care()');
          h.check(`exam ${m}: the hand reaches the body (≤ 5 cm)`, best <= 0.05, `${best.toFixed(3)} m, bent ${e?.lean}°, standing ${where.kind} at ${JSON.stringify(where.at)}${(where as { passedOver?: string[] }).passedOver?.length ? `, passed over ${(where as { passedOver?: string[] }).passedOver!.join('; ')}` : ''}`);
          const cl = await ev<Clear>('__acWorld.careClearance()');
          const bad = Object.entries(cl?.worst ?? {}).filter(([k, v]) => (k === 'restHandOnRail' ? v.gap < -0.02 : v.gap < -0.01));
          h.check(`exam ${m}: no clipping`, bad.length === 0, bad.map(([k, v]) => `${k} ${v.gap} m (${v.bone})`).join(', ') || 'clear');
          await fix(m === 'msk_lat_malleolus' ? [12.6, 1.6, 4.8] : [12.75, 1.6, 2.1], m === 'msk_lat_malleolus' ? [14.6, 0.9, 3.0] : [15.0, 1.0, 2.2]);
          await page.waitForTimeout(250);
          await shot(`${name}-after`);
          await fix(null);
          await page.waitForTimeout(2600);
        }
      }
      // walking off lets go
      await ev(key('KeyS', true));
      await page.waitForTimeout(700);
      await ev(key('KeyS', false));
      await page.waitForTimeout(300);
      const off = await ev<Care>('__acWorld.care()');
      h.check('walking off lets go of the bedside', off.phase === 'off', off.phase);
      // first person: the view stays where it is; the (unseen) body turns to the patient
      await ev(`__ac.store.set({ panel: null })`);
      await page.waitForTimeout(300);
      await cam('first');
      await ev(`__acWorld.teleport(15.0, 3.0, 20, -10)`);
      await page.waitForTimeout(600);
      const before = await state();
      await bedside('Bed 4, first person', bed4, [], { fp: true });
      const after = await state();
      h.check('first person: the view is not moved', Math.abs(after.yaw - before.yaw) < 1e-3 && Math.abs(after.pitch - before.pitch) < 1e-3 && Math.hypot(after.x - before.x, after.z - before.z) < 1e-3, `yaw ${before.yaw.toFixed(3)} → ${after.yaw.toFixed(3)}, at ${before.x.toFixed(2)},${before.z.toFixed(2)} → ${after.x.toFixed(2)},${after.z.toFixed(2)}`);
      // an exam in first person, stood up at the bedside (from a metre and a quarter off no hand reaches a
      // chest, and the view doesn't walk you there): the view leans in and the hand comes into view
      if (want('exam')) {
        await ev(`__ac.store.set({ panel: null })`);
        await page.waitForTimeout(200);
        await ev(`__acWorld.teleport(14.85, 2.4, 250, -10)`);
        await page.waitForTimeout(300);
        await ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${bed4}', tab: 'exam' }, tabletMin: false })`);
        await page.waitForTimeout(900);
        // (the picture: the view on her chest; first person a view yaw y looks along bearing y − 180°)
        const b = (await ev<Care>('__acWorld.care()')).bearing ?? 0;
        await ev(`__acWorld.look(${b + 180}, -32)`);
        await page.waitForTimeout(300);
        await ev(`__acWorld.careExam('cv_auscultate')`);
        await page.waitForTimeout(650);
        const c = await ev<Care & { fpHand?: boolean; fpHandAt?: V3 | null }>('__acWorld.care()');
        const camAt = await ev<{ x: number; z: number; camY: number }>('__acWorld.state()');
        h.check('first person: the exam hand comes into view', !!c.fpHand && !!c.exam && !!c.fpHandAt, JSON.stringify({ fpHand: c.fpHand, at: c.fpHandAt, eye: [camAt.x, camAt.camY, camAt.z].map((v) => +v.toFixed(2)), exam: c.exam?.maneuver }));
        await shot('exam-first-person-after');
        await page.waitForTimeout(3000);
      }
      await ev(`__ac.store.set({ panel: null })`);
      await cam('third');
    }
    // the fast-track patient sitting on her stretcher's edge: in front of her, turned to her
    const sitter = await ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.location === 'ft_1' && x.posture === 'sit'); return n ? n.id : null; })()`);
    if (sitter) {
      type Np = { x: number; z: number; yaw: number };
      const s0 = (await ev<Np>(`__acWorld.npc('${sitter}')`))!;
      const fx = Math.sin(s0.yaw);
      const fz = Math.cos(s0.yaw);
      // come in from the door and stop a metre and a half off, beside her, facing the wall
      await ev(`__acWorld.teleport(${s0.x + fx * 1.4 + fz * 0.9}, ${s0.z + fz * 1.4 - fx * 0.9}, ${(Math.atan2(fz, -fx) * 180) / Math.PI}, -8)`);
      await page.waitForTimeout(1200);
      await bedside('Fast Track 1, sitting on the stretcher', sitter, [
        ['care-sitting-after-side', [s0.x + fx * 0.6 + fz * 1.9, 1.6, s0.z + fz * 0.6 - fx * 1.9], [s0.x + fx * 0.5, 1.15, s0.z + fz * 0.5]],
        ['care-sitting-after-behind-her', [s0.x - fx * 0.9 + fz * 0.5, 1.75, s0.z - fz * 0.9 - fx * 0.5], [s0.x + fx * 0.8, 1.2, s0.z + fz * 0.8]],
      ], { sitting: true });
      if (want('exam')) {
        await ev(`__acWorld.careExam('pulm_auscultate')`);
        let best = Infinity;
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(60);
          const g = (await ev<Care>('__acWorld.care()')).exam?.gap;
          if (g !== null && g !== undefined) best = Math.min(best, g);
        }
        h.check('sitting: an exam hand reaches her (≤ 5 cm)', best <= 0.05, `${best.toFixed(3)} m`);
        await fix([s0.x + fx * 0.6 + fz * 1.9, 1.6, s0.z + fz * 0.6 - fx * 1.9], [s0.x + fx * 0.5, 1.15, s0.z + fz * 0.5]);
        await page.waitForTimeout(150);
        await shot('exam-sitting-after');
        await fix(null);
        await page.waitForTimeout(2500);
      }
      await ev(`__ac.store.set({ panel: null })`);
      await page.waitForTimeout(400);
    }
    // a resus stretcher: Resus 1's (37.37, 19.0, head to the outer wall at −x); the fast-track patient laid on it
    const pt = (await patientIn('ft_1')) ?? (await ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.visible); return n ? n.id : null; })()`));
    h.check('a patient for the resus stretcher', !!pt, String(pt));
    if (pt) {
      await ev(`__acWorld.layNpc('${pt}', 37.37, 19.0, 90)`);
      await ev(`__acWorld.teleport(38.6, 20.6, 60, -8)`);
      await page.waitForTimeout(1500);
      await bedside('Resus 1 stretcher', pt, [
        ['care-resus-after-across', [37.0, 1.6, 17.3], [37.2, 1.0, 19.8]],
        ['care-resus-after-foot', [39.4, 1.7, 19.6], [37.3, 1.0, 19.6]],
      ]);
      await ev(`__ac.store.set({ panel: null })`);
      await page.waitForTimeout(500);
    }
  }

  // ───────── every bed and stretcher downstairs, every ward patient upstairs: the numbers ─────────
  if (want('allbeds')) {
    await cam('third');
    await fix(null);
    const pt = await patientIn('bed_4');
    const beds = LAYOUTS.ed.props.filter((p) => p.kind === 'bed' || p.kind === 'stretcher');
    let ok = 0;
    const bad: string[] = [];
    for (const b of pt ? beds : []) {
      const rot = b.rot ?? 0;
      // the patient in it; you, a step off its long side by the foot, facing away
      await ev(`__ac.store.set({ panel: null })`);
      await ev(`__acWorld.layNpc('${pt}', ${b.x}, ${b.z}, ${(rot * 180) / Math.PI})`);
      for (const c of ['bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'bed_6']) if (b.room === c) await ev(`__acWorld.curtain('${c}', 'snap-open')`);
      // a metre off its long side (the bed's +x), toward the foot, facing away from it
      const [x, z] = [b.x + 1.15 * Math.cos(rot) + 0.55 * Math.sin(rot), b.z - 1.15 * Math.sin(rot) + 0.55 * Math.cos(rot)];
      await ev(`__acWorld.teleport(${x}, ${z}, ${((rot + Math.PI / 2) * 180) / Math.PI}, -8)`);
      await page.waitForTimeout(650);
      await ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${pt}', tab: 'talk' }, tabletMin: false })`);
      let c: Care = { phase: 'off' };
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        c = await ev<Care>('__acWorld.care()');
        if (c.phase === 'on' && (c.w ?? 0) > 0.97) break;
      }
      await page.waitForTimeout(400);
      c = await ev<Care>('__acWorld.care()');
      const cl = await ev<Clear>('__acWorld.careClearance()');
      const clip = Object.entries(cl?.worst ?? {}).filter(([k, v]) => (k === 'restHandOnRail' ? v.gap < -0.02 : v.gap < -0.01));
      const line = `${b.id}: ${c.kind} side ${c.side}, ${c.off}° off, palm ${c.rail?.gap ?? 'none'} m${clip.length ? `, CLIPS ${clip.map(([k, v]) => `${k} ${v.gap} (${v.bone})`).join(' ')}` : ''}`;
      console.log(`   ${line}`);
      if (c.phase === 'on' && (c.off ?? 99) <= 20 && c.rail && (c.rail.gap ?? 1) <= 0.04 && !clip.length) ok++;
      else bad.push(line);
    }
    h.check(`every ED bed and stretcher: turned to the patient, a palm on the rail, no clipping`, !!pt && ok === beds.length, `${ok}/${beds.length}${bad.length ? `; ${bad.join(' | ')}` : ''}`);
    await ev(`__ac.store.set({ panel: null })`);
    // the ward's four patients
    const ward = await ev<{ id: string; x: number; z: number }[]>('__acWorld.wardPatients()');
    let wok = 0;
    const wbad: string[] = [];
    for (const w of ward) {
      await ev(`__acWorld.teleportY(${w.x + 0.3}, ${w.z + (w.z < 10 ? 1.6 : -1.6)}, 3, 0, -8)`);
      await page.waitForTimeout(1200);
      await ev(`__acWorld.careVisit('${w.id}')`);
      let c: Care = { phase: 'off' };
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        c = await ev<Care>('__acWorld.care()');
        if (c.phase === 'on' && (c.w ?? 0) > 0.97) break;
      }
      await page.waitForTimeout(400);
      c = await ev<Care>('__acWorld.care()');
      const cl = await ev<Clear>('__acWorld.careClearance()');
      const clip = Object.entries(cl?.worst ?? {}).filter(([k, v]) => (k === 'restHandOnRail' ? v.gap < -0.02 : v.gap < -0.01));
      const line = `${w.id}: ${c.kind} side ${c.side}, ${c.off}° off, palm ${c.rail?.gap ?? 'none'} m${clip.length ? `, CLIPS ${clip.map(([k, v]) => `${k} ${v.gap} (${v.bone})`).join(' ')}` : ''}`;
      console.log(`   ${line}`);
      if (c.phase === 'on' && (c.off ?? 99) <= 20 && c.rail && (c.rail.gap ?? 1) <= 0.04 && !clip.length) wok++;
      else wbad.push(line);
      await ev(key('KeyS', true));
      await page.waitForTimeout(300);
      await ev(key('KeyS', false));
    }
    h.check(`every ward patient: turned to them, a palm on the rail, no clipping`, ward.length === 4 && wok === ward.length, `${wok}/${ward.length}${wbad.length ? `; ${wbad.join(' | ')}` : ''}`);
    await ev(`__acWorld.teleportY(53.5, 4.0, 0, 0, -8)`);
    await page.waitForTimeout(800);
  }

  // ───────── a ward patient upstairs ─────────
  if (want('ward')) {
    await cam('third');
    const ward = await ev<{ id: string; x: number; z: number }[]>('__acWorld.wardPatients()');
    const p = ward.find((w) => w.id.endsWith('204')) ?? ward[0];
    h.check('a ward patient', !!p, JSON.stringify(ward));
    if (p) {
      // come in from the door side: a metre and a half off the bed's long side (the bed's head is at the west wall)
      await ev(`__acWorld.teleportY(${p.x + 0.3}, ${p.z + 1.6}, 3, 200, -8)`);
      await page.waitForTimeout(2500);
      await bedside(`ward ${p.id}`, p.id, [
        ['care-ward-after-across', [p.x - 0.2, 4.6, p.z - 1.45], [p.x - 0.3, 3.95, p.z + 0.9]],
        ['care-ward-after-foot', [p.x + 2.1, 4.7, p.z + 0.4], [p.x - 0.3, 3.9, p.z + 0.6]],
      ], { visit: true });
      await ev(key('KeyD', true));
      await page.waitForTimeout(500);
      await ev(key('KeyD', false));
      await page.waitForTimeout(200);
      const c = await ev<Care>('__acWorld.care()');
      h.check('ward: walking off ends the visit', c.phase === 'off' && !c.visit, JSON.stringify({ phase: c.phase }));
    }
  }

  // ───────── an NPC doctor's bedside pose (the AI doctor's code path: World's careNpcs, care.ts NpcCare) ─────────
  if (want('npc')) {
    await cam('third');
    await ev(`__ac.store.set({ panel: null })`);
    const nurse = await ev<string | null>(`(() => { const v = __ac.store.get().view; const ids = __acWorld.npcIds(); const n = v.npcs.find((x) => ['nurse', 'tech', 'attending', 'resident'].includes(x.role) && x.visible && ids.includes(x.id)); return n ? n.id : null; })()`);
    const pt = await ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.visible && x.location === 'bed_4'); return n ? n.id : null; })()`);
    h.check('an NPC (a nurse) and a patient for the NPC bedside pose', !!nurse && !!pt, `${nurse} ${pt}`);
    if (nurse && pt) {
      await ev(`__acWorld.layNpc('${pt}', 14, 2.3, 0)`);
      await ev(`__acWorld.curtain('bed_4', 'snap-open')`);
      await ev(`__acWorld.careNpc('${nurse}')`);
      await ev(`__acWorld.teleport(16.5, 5.6, 200, -8)`);
      // at the side of Bed 4 by the patient's chest (World's destination for the AI doctor), turned askew
      await ev(`__acWorld.standNpc('${nurse}', 14.74, 2.04, 225)`);
      type NC = { patient: string; bed: string; kind: string; w: number; facing: number } | null;
      let nc: NC = null;
      for (let i = 0; i < 60 && !(nc && nc.w > 0.95); i++) {
        await page.waitForTimeout(150);
        nc = await ev<NC>(`__acWorld.npcCare('${nurse}')`);
      }
      await page.waitForTimeout(900);
      const n = await ev<{ x: number; z: number; yaw: number } | null>(`__acWorld.npc('${nurse}')`);
      const p = await ev<{ pelvis: V3 | null; head: V3 } | null>(`__acWorld.npc('${pt}')`);
      const chest = p?.pelvis ? [(p.pelvis[0] + p.head[0]) / 2, (p.pelvis[2] + p.head[2]) / 2] : null;
      const off = n && chest ? Math.abs(((((n.yaw - Math.atan2(chest[0] - n.x, chest[1] - n.z)) * 180) / Math.PI + 540) % 360) - 180) : NaN;
      h.check('an NPC doctor at the bedside takes the pose, turned to the patient (±25°)', !!nc && nc.w > 0.95 && off <= 25, `${JSON.stringify(nc)}, ${off.toFixed(0)}° off`);
      await fix([12.75, 1.55, 1.9], [15.0, 1.05, 2.3]);
      await page.waitForTimeout(350);
      await shot('care-npc-doctor-after');
      await fix(null);
      // its exams: the chest from beside it, the hand gets there; an ankle from beside the chest is out of
      // its reach (an NPC doesn't step along the bed): looked at, no arm stretched out into the air
      type NE = { exam: string | null; far: boolean; examW: number; gap: number | null } | null;
      h.check('an NPC doctor: an exam starts', await ev<boolean>(`__acWorld.npcExam('${nurse}', 'cv_auscultate')`));
      let ne: NE = null;
      let bestGap = Infinity;
      for (let i = 0; i < 14; i++) {
        await page.waitForTimeout(150);
        ne = await ev<NE>(`__acWorld.npcCare('${nurse}')`);
        if (ne?.examW === 1 && ne.gap !== null) bestGap = Math.min(bestGap, ne.gap);
      }
      h.check('an NPC doctor: the stethoscope gets to the chest (≤ 5 cm)', !!ne && !ne.far && bestGap <= 0.05, `${bestGap.toFixed(3)} m ${JSON.stringify(ne)}`);
      await fix([12.75, 1.55, 1.9], [15.0, 1.05, 2.3]);
      await page.waitForTimeout(150);
      await shot('exam-npc-doctor-after');
      await fix(null);
      for (let i = 0; i < 30 && ne?.exam; i++) {
        await page.waitForTimeout(150);
        ne = await ev<NE>(`__acWorld.npcCare('${nurse}')`);
      }
      await ev(`__acWorld.npcExam('${nurse}', 'msk_lat_malleolus')`);
      await page.waitForTimeout(900);
      ne = await ev<NE>(`__acWorld.npcCare('${nurse}')`);
      h.check('an NPC doctor: an ankle out of its reach is looked at, not reached for', !!ne && ne.exam === 'msk_lat_malleolus' && ne.far, JSON.stringify(ne));
    }
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
  await page.close();

  // ───────── the AI doctor's body at a bedside (observe mode, the scripted demo agent) ─────────
  if (want('npc')) {
    const p2 = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errs: string[] = [];
    p2.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
    await p2.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
    await p2.goto(`${h.url}/?debug=1&quality=high`);
    await p2.waitForSelector('.watch-ai', { timeout: 60000 });
    await p2.waitForTimeout(800);
    await p2.getByRole('button', { name: 'Clinical actions' }).click();
    await p2.selectOption('.watch-ai select', 'night_shift');
    await p2.click('.watch-ai button:has-text("Scripted demo")');
    await p2.waitForTimeout(300);
    await p2.click('.watch-ai button:has-text("Watch the AI doctor")');
    await p2.waitForSelector('.hud-clock', { timeout: 60000 });
    await p2.waitForSelector('.loading-screen.done', { timeout: 180000 }).catch(() => undefined);
    const e2 = <T = unknown>(s: string) => p2.evaluate(s) as Promise<T>;
    await p2.addStyleTag({ content: '.toasts, .wl-hint, .hud, .wl-crosshair, .wl-layer, .ob-panel { visibility: hidden !important; }' });
    type Npc = { x: number; z: number; yaw: number; posture: string; pelvis: V3 | null; head: V3 } | null;
    type NC = { patient: string; bed: string; kind: string; w: number; exam: string | null; facing: number } | null;
    let posed: NC = null;
    let doc: Npc = null;
    const t0 = Date.now();
    let lastSeen = '';
    // how long its body has stood still at a bedside spot (the demo agent paces itself by the wall clock:
    // some runs it moves on before its body has walked there)
    let settledFor = 0;
    let bestOff = 999;
    let lastT = Date.now();
    while (Date.now() - t0 < 240000) {
      posed = await e2<NC>(`__acWorld.npcCare('ai_doctor')`);
      const st = await e2<{ walking: boolean; spot: string; location: string } | null>(`__acWorld.npc('ai_doctor')`);
      const now = Date.now();
      settledFor = st && !st.walking && /^bedside/.test(st.spot) && /^(bed_|ft_|resus)/.test(st.location) ? settledFor + (now - lastT) : 0;
      lastT = now;
      if (settledFor > 4000 && !(posed && posed.w > 0.95)) break;
      const where = await e2<string>(`(() => { const d = __ac.store.get().view.npcs.find((n) => n.id === 'ai_doctor'); const n = __acWorld.npc('ai_doctor'); return d ? d.location + '|' + d.spot + '|' + d.posture + (n ? ' @' + n.x.toFixed(2) + ',' + n.z.toFixed(2) : '') : 'none'; })()`);
      if (where.split(' @')[0] !== lastSeen) {
        lastSeen = where.split(' @')[0];
        console.log(`   ai_doctor ${((Date.now() - t0) / 1000).toFixed(0)} s: ${where}`);
      }
      if (posed && posed.w > 0.95) {
        // its facing, sampled only while it is posed (the same instant: the demo agent moves on within
        // seconds, and a body already turning to walk off is not the pose)
        const sample = async () => {
          const s = await e2<{ c: NC; d: Npc; q: Npc }>(`({ c: __acWorld.npcCare('ai_doctor'), d: __acWorld.npc('ai_doctor'), q: __acWorld.npc('${posed!.patient}') })`);
          if (!s.c || s.c.w < 0.95 || !s.d || !s.q?.pelvis) return null;
          const ch = [(s.q.pelvis[0] + s.q.head[0]) / 2, (s.q.pelvis[2] + s.q.head[2]) / 2];
          const o = Math.abs(((((s.d.yaw - Math.atan2(ch[0] - s.d.x, ch[1] - s.d.z)) * 180) / Math.PI + 540) % 360) - 180);
          if (o < bestOff) {
            bestOff = o;
            doc = s.d;
          }
          return o;
        };
        await sample();
        // the picture at once: across from it, at the patient
        const d0 = await e2<Npc>(`__acWorld.npc('ai_doctor')`);
        const q0 = await e2<Npc>(`__acWorld.npc('${posed.patient}')`);
        if (d0 && q0) {
          const ux = q0.x - d0.x;
          const uz = q0.z - d0.z;
          const ul = Math.hypot(ux, uz) || 1;
          await e2(`__acWorld.cam([${d0.x + (ux / ul) * 2.4 - (uz / ul) * 0.9}, 1.65, ${d0.z + (uz / ul) * 2.4 + (ux / ul) * 0.9}], [${d0.x + (ux / ul) * 0.4}, 1.05, ${d0.z + (uz / ul) * 0.4}])`);
          await p2.waitForTimeout(220);
          await p2.screenshot({ path: `${out}/care-ai-doctor-after.png` });
          console.log(`📸 ${out}/care-ai-doctor-after.png`);
          await e2(`__acWorld.cam(null)`);
        }
        // (its yaw eases round to the patient: the best of a second while the pose holds)
        for (let k = 0; k < 8; k++) {
          await p2.waitForTimeout(150);
          if ((await sample()) === null) break;
        }
        if (doc) break;
      }
      await p2.waitForTimeout(500);
    }
    const why = posed && doc ? '' : await e2<string>(`(() => { const v = __ac.store.get().view; const d = v.npcs.find((n) => n.id === 'ai_doctor'); const pts = v.npcs.filter((n) => n.role === 'patient' && d && n.location === d.location).map((n) => JSON.stringify({ id: n.id, ...__acWorld.npc(n.id), toes: undefined, pelvis: undefined, head: undefined })); return JSON.stringify({ ...__acWorld.npc('ai_doctor'), toes: undefined, pelvis: undefined, head: undefined }) + ' patients ' + pts.join(' '); })()`);
    if (posed && doc) h.check('observe mode: the AI doctor takes the bedside pose at a patient', true, JSON.stringify(posed));
    else if (settledFor > 4000) h.check('observe mode: the AI doctor takes the bedside pose at a patient', false, `stood at a bedside ${(settledFor / 1000).toFixed(1)} s unposed: ${why}`);
    else console.log(`   (observe mode: the demo agent never stood at a bedside long enough in ${((Date.now() - t0) / 1000).toFixed(0)} s to judge; the same pose is checked on an NPC above)`);
    if (posed && doc) {
      // (the patient's chest: between the pelvis and the head)
      h.check('observe mode: the AI doctor faces the patient (±25°)', bestOff <= 25, `${bestOff.toFixed(0)}° (${posed.kind} at ${posed.bed})`);
    }
    h.check('observe mode: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await p2.close();
  }
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

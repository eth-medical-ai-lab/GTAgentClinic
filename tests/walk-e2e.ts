/**
 * NPC walking on the real GPU (client/src/world/steering.ts): the waiting room's called patient
 * gets up, steps forward off the chair, walks the aisle between the rows round to the triage nurse
 * and on through the door — never through a chair or a person. Seed 15's second call is from row B
 * (amb_wrist, chair at 1.95, 20.90) with seven people seated in the rows: the clock jumps to just
 * before it, then everyone's position is recorded every frame.
 *
 * Checks: ≥ 0.3 m (body centre) from every chair footprint and every person's footprint, and from
 * seated people's actual toe joints; at the nurse before she greets; capped turn rate. Then ~30
 * NPCs are sent walking at once and the steering's own per-frame cost is read. Writes a top-down
 * trajectory plot (SVG + PNG), screenshots and summary.json.
 *
 *   npx tsx tests/walk-e2e.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { LAYOUTS } from '../shared/layout';
import { footprintDistance, type Footprint } from '../client/src/world/pathfinding';
import { startHarness } from './harness';
import { callScenes, chairFootprint, personDiscs } from './navSim';
import { navWorld } from './navWorld';

const out = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots/walk');
mkdirSync(out, { recursive: true });

const SEED = 15;
const MEET = { x: 4.3, z: 16.55 };
const { plan, scale, scenes } = callScenes(SEED);
const call = scenes.find((s) => s.id === 'amb_wrist' && Math.abs(s.seat.at.x - 1.95) < 0.01)!;
const PATIENT = call.id;
const greet = plan.lines.filter((l) => l.scene === call.scene.id && l.who === 'nurse')[1];

type Rec = { t: number; gt: number; n: Record<string, [number, number, number, number, number[] | null]>; p: [number, number] };

const h = await startHarness({ portBase: 7200, dev: true });
const summary: Record<string, unknown> = { seed: SEED, patient: PATIENT, seat: call.seat.at };
type Recording = { frames: Rec[]; routes: { t: number; length: number; pts: [number, number][]; radii: number[] }[]; reloaded?: boolean };
const shots: string[] = [];

/**
 * One take of the call: a fresh shift, the clock jumped to just before it, everyone recorded each frame.
 * The dev server hot-reloads when other files change (other work in the same tree): a reload rebuilds
 * the world with everyone placed where they are headed, so a take with one is thrown away.
 */
async function take(n: number): Promise<{ page: Page; errors: string[]; rec: Recording; jumpTo: number } | null> {
  const { page, errors } = await h.nightShift(`seed=${SEED}`, 6000);
  const ev = <T>(js: string) => page.evaluate(js) as Promise<T>;
  const t = await ev<number>('__ac.store.get().view.t');
  // out of everyone's way, the top-down camera over the waiting room
  await ev(`__acWorld.teleport(9.35, 17.6, -90, -10)`);
  await ev(`__ac.store.set({ camera: 'top' })`);
  // jump to a second before the nurse sets off for the door to call the name (whichever nurse plays it):
  // a short take, so the dev server's hot reloads from other work in the tree rarely land in it
  const atCall = (g: { at: { x: number; z: number } }) => Math.abs(g.at.x - 4.7) < 0.01 && Math.abs(g.at.z - 15.95) < 0.01;
  const jumpTo = Math.min(...[call.scene.lena, call.scene.float].map((segs) => segs.find(atCall)?.t0 ?? Infinity)) - scale;
  await ev(`__ac.client.act({ type: 'wait', minutes: ${((jumpTo - t) / 60).toFixed(4)} })`);
  await page.waitForTimeout(500);
  const seated = await ev<{ x: number; z: number; posture: string } | null>(`__acWorld.npc('${PATIENT}')`);
  h.check(`take ${n}: the waiting room is seed ${SEED}'s (the patient in the planned chair)`, !!seated && seated.posture === 'sit' && Math.hypot(seated.x - call.seat.at.x, seated.z - call.seat.at.z) < 0.02, JSON.stringify(seated));
  await ev(`(() => {
    const token = Math.random();
    __acWorld.__take = token;
    window.__rec = { frames: [], t0: performance.now(), on: true, routes: [], reloaded: false };
    let k = 0;
    const tick = () => {
      if (!window.__rec.on) return;
      if (__acWorld.__take !== token) __rec.reloaded = true;
      const t = (performance.now() - __rec.t0) / 1000;
      const f = { t, gt: __ac.store.get().view?.t ?? 0, n: {}, p: [0, 0] };
      const me = __acWorld.npc('${PATIENT}');
      for (const id of __acWorld.npcIds()) {
        const s = id === '${PATIENT}' ? me : __acWorld.npc(id);
        if (!s || s.x < -1 || s.x > 34 || s.z < 6 || s.z > 26) continue;
        // seated people's toes, near the walker (the real feet, for the check)
        const near = me && Math.hypot(s.x - me.x, s.z - me.z) < 2.5;
        const toes = s.posture === 'sit' && near && k % 2 === 0 ? s.toes.flatMap((p) => [p[0], p[2]]) : null;
        f.n[id] = [s.x, s.z, s.yaw, s.posture === 'sit' ? 1 : s.posture === 'lie' ? 2 : 0, toes];
      }
      const st = __acWorld.state();
      f.p = [st.x, st.z];
      __rec.frames.push(f);
      if (k++ % 10 === 0) {
        const r = __acWorld.navRoute('${PATIENT}');
        const last = __rec.routes[__rec.routes.length - 1];
        if (r && (!last || last.length !== r.length)) __rec.routes.push({ t, ...r });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  // follow the walk: screenshots in the aisle (top-down, then over the shoulder), round the row's end, at the
  // nurse — on the game clock (the server's), seconds into the walk to her; done once through the door
  const walkGt = plan.people.get(PATIENT)!.segs.find((g) => Math.abs(g.at.x - MEET.x) < 0.01 && Math.abs(g.at.z - MEET.z) < 0.01)!.t0;
  const marks = [
    { at: 1.2, file: '01-top-aisle.png' },
    { at: 2.0, file: '02-third-aisle.png', third: true },
    { at: 3.6, file: '03-top-row-end.png' },
    { at: 6.4, file: '04-top-at-nurse.png' },
  ];
  shots.length = 0;
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(60);
    const el = (Date.now() - t0) / 1000;
    const into = ((await ev<number>('__ac.store.get().view?.t ?? 0')) - walkGt) / scale;
    const m = marks.find((x) => !shots.includes(x.file) && into >= x.at);
    if (m && m.third) {
      // over the shoulder from the south-east corner, looking up the aisle (well off the route)
      await ev(`__acWorld.teleport(8.9, 22.7, -125, -14)`);
      await ev(`__ac.store.set({ camera: 'third' })`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/${m.file}` });
      await ev(`__ac.store.set({ camera: 'top' })`);
      await ev(`__acWorld.teleport(9.35, 17.6, -90, -10)`);
      shots.push(m.file);
    } else if (m) {
      await page.screenshot({ path: `${out}/${m.file}` });
      shots.push(m.file);
    }
    const p = await ev<{ x: number; z: number } | null>(`__acWorld.npc('${PATIENT}')`).catch(() => null);
    // through the door into the corridor: done
    if ((p && p.z < 14.6) || el > 60) break;
  }
  await page.waitForTimeout(1200);
  const rec = await ev<Recording | undefined>('(() => { if (!window.__rec) return undefined; window.__rec.on = false; return window.__rec; })()');
  if (!rec || rec.reloaded) {
    console.log(`take ${n}: the page hot-reloaded during the walk (files changed under the dev server) — again`);
    await page.close();
    return null;
  }
  return { page, errors, rec, jumpTo };
}

try {
  let got: Awaited<ReturnType<typeof take>> = null;
  for (let n = 1; n <= 8 && !got; n++) got = await take(n);
  if (!got) throw new Error('no take without a hot reload');
  const { page, errors, rec, jumpTo } = got;
  const ev = <T>(js: string) => page.evaluate(js) as Promise<T>;
  const realOf = (gt: number) => (gt - jumpTo) / scale;
  summary.frames = rec.frames.length;
  writeFileSync(`${out}/track.json`, JSON.stringify({ patient: PATIENT, frames: rec.frames.map((f) => ({ t: f.t, gt: f.gt, me: f.n[PATIENT] ?? null })), routes: rec.routes }));

  // ── the walk: from standing up to the door ──
  const frames = rec.frames;
  const iUp = frames.findIndex((f) => f.n[PATIENT] && f.n[PATIENT][3] === 0 && frames.some((g) => g.t < f.t && g.n[PATIENT]?.[3] === 1));
  const own = LAYOUTS.ed.props.find((p) => p.kind === 'chair' && Math.hypot(p.x - call.seat.at.x, p.z - call.seat.at.z) < 0.05)!;
  const chairs = LAYOUTS.ed.props.filter((p) => p.kind === 'chair' && p.room === 'waiting' && p !== own);
  const fps = chairs.map((c) => [c.id, chairFootprint(c)] as const);
  let chairMin = Infinity;
  let chairAt = '';
  let personMin = Infinity;
  let personAt = '';
  let toeMin = Infinity;
  let toeAt = '';
  let maxTurn = 0;
  let maxSpeed = 0;
  let arrive = NaN;
  const greetReal = frames.find((f) => f.gt >= greet.t)?.t ?? realOf(greet.t);
  const lastToes: Record<string, number[]> = {};
  for (let i = Math.max(1, iUp); i < frames.length; i++) {
    const f = frames[i];
    const g = frames[i - 1];
    for (const [id, v] of Object.entries(f.n)) if (v[4]) lastToes[id] = v[4];
    const me = f.n[PATIENT];
    const prev = g.n[PATIENT];
    if (!me || !prev || me[1] < 14.6) continue;
    // over 5 frames (≈ 80 ms): single frames' timestamps jitter by a few ms against the world's own clock
    const h5 = frames[i - 5]?.n[PATIENT];
    const dt5 = f.t - (frames[i - 5]?.t ?? f.t);
    if (h5 && dt5 > 0 && dt5 < 0.2) {
      const dy = Math.abs(Math.atan2(Math.sin(me[2] - h5[2]), Math.cos(me[2] - h5[2])));
      maxTurn = Math.max(maxTurn, dy / dt5);
      maxSpeed = Math.max(maxSpeed, Math.hypot(me[0] - h5[0], me[1] - h5[1]) / dt5);
    }
    if (Number.isNaN(arrive) && Math.hypot(me[0] - MEET.x, me[1] - MEET.z) < 0.05) arrive = f.t;
    // the step off the chair starts inside its own footprint; everything after keeps clear
    for (const [cid, fp] of fps) {
      const d = footprintDistance(fp, me[0], me[1]);
      if (d < chairMin) {
        chairMin = d;
        chairAt = `${cid} t=${f.t.toFixed(2)} (${me[0].toFixed(2)}, ${me[1].toFixed(2)})`;
      }
    }
    for (const [id, o] of Object.entries(f.n)) {
      if (id === PATIENT || o[3] === 2) continue;
      for (const disc of personDiscs({ x: o[0], z: o[1], posture: o[3] === 1 ? 'sit' : 'stand', yaw: o[2] })) {
        const d = Math.hypot(me[0] - disc.x, me[1] - disc.z) - disc.r;
        if (d < personMin) {
          personMin = d;
          personAt = `${id} t=${f.t.toFixed(2)}`;
        }
      }
      const toes = o[3] === 1 ? lastToes[id] : null;
      if (toes) {
        for (let k = 0; k < toes.length; k += 2) {
          const d2 = Math.hypot(me[0] - toes[k], me[1] - toes[k + 1]);
          if (d2 < toeMin) {
            toeMin = d2;
            toeAt = `${id} t=${f.t.toFixed(2)}`;
          }
        }
      }
    }
  }
  h.check('the called patient stood up', iUp > 0, `at t=${frames[iUp]?.t.toFixed(1)} s`);
  h.check('≥ 0.3 m from every chair footprint (body centre)', chairMin >= 0.3, `${chairMin.toFixed(3)} m, ${chairAt}`);
  h.check('≥ 0.3 m from every other person (standing: 0.25 m disc; seated: knees and feet discs)', personMin >= 0.3, `${personMin.toFixed(3)} m, ${personAt}`);
  h.check('≥ 0.3 m from seated people’s toe joints', toeMin >= 0.3, `${toeMin.toFixed(3)} m, ${toeAt}`);
  h.check('at the nurse before she greets', !Number.isNaN(arrive) && arrive <= greetReal + 0.25, `arrived ${arrive.toFixed(2)} s, greeting ${greetReal.toFixed(2)} s`);
  h.check('turns no faster than the cap (4.5 rad/s), walking or turning to look', maxTurn <= 4.7, `${maxTurn.toFixed(2)} rad/s; top speed ${maxSpeed.toFixed(2)} m/s`);
  Object.assign(summary, { chairMin, chairAt, personMin, personAt, toeMin, toeAt, arrive, greetReal, maxTurn, maxSpeed, routes: rec.routes.map((r) => ({ t: r.t, length: r.length, radii: r.radii })) });

  // ── ~30 NPCs walking at once: the steering's per-frame cost ──
  // everyone, bed patients too (they get up and walk): about 30 people walking at once
  const ids = await ev<string[]>('__acWorld.npcIds()');
  summary.stressNpcs = ids.length;
  const world = navWorld(LAYOUTS.ed);
  const nav = world.grid.npcLayer(world.footprints);
  let seed = 9;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const spot = () => {
    for (;;) {
      // the hub corridor and the waiting room
      const inHub = rand() < 0.6;
      const x = inHub ? 1 + rand() * 32 : 0.6 + rand() * 9;
      const z = inHub ? 7.6 + rand() * 6.8 : 16 + rand() * 7.5;
      if (nav.cellFree(x, z, false) && nav.clearance(x, z) > 0.45) return [x, z];
    }
  };
  await ev(`__ac.store.set({ camera: 'top' })`);
  await ev(`__acWorld.teleport(16, 12.5, 0, -10)`);
  const send = async () => {
    for (const id of ids) {
      const r = await ev<unknown>(`__acWorld.navRoute('${id}')`);
      if (r) continue;
      const [x, z] = spot();
      await ev(`__acWorld.walkNpc('${id}', ${x.toFixed(2)}, ${z.toFixed(2)}, 0)`);
    }
  };
  await send();
  await page.waitForTimeout(1500);
  await ev('__acWorld.navStats(true)');
  const fps0 = await ev<number>(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })`);
  for (let k = 0; k < 12; k++) {
    await page.waitForTimeout(1000);
    await send();
    if (k === 5) {
      await page.screenshot({ path: `${out}/05-top-30-walkers.png` });
      shots.push('05-top-30-walkers.png');
    }
  }
  const stats = await ev<{ meanMs: number; p95Ms: number; maxMs: number; meanWalkers: number; maxWalkers: number; planMeanMs: number; planMaxMs: number; routes: number; replans: number; failed: number; sharp: number; corners: number; fallback: number; frames: number }>('__acWorld.navStats()');
  summary.perf = { ...stats, fpsDuringTest: fps0 };
  h.check('~30 walking at once', stats.meanWalkers >= 25, `mean ${stats.meanWalkers.toFixed(1)}, max ${stats.maxWalkers} (of ${ids.length} sent)`);
  h.check('steering ≤ 0.5 ms a frame (mean, p95)', stats.meanMs <= 0.5 && stats.p95Ms <= 0.5, `mean ${stats.meanMs.toFixed(3)} ms, p95 ${stats.p95Ms.toFixed(3)} ms, max ${stats.maxMs.toFixed(2)} ms over ${stats.frames} frames`);
  const misses = await ev<unknown[]>('__acWorld.navMisses()');
  summary.misses = misses;
  h.check('every walk got a route', stats.failed === 0, `${stats.routes} routes, ${stats.fallback} walls-only fallbacks (${JSON.stringify(misses).slice(0, 300)}), ${stats.replans} re-plans; route planning ${stats.planMeanMs.toFixed(2)} ms mean`);
  h.check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ── the trajectory plot ──
  const svg = plot(rec.frames, rec.routes, iUp, await ev<Footprint[]>('__acWorld.navFootprints()'), world.colliders, { chairMin, personMin, toeMin, arrive, greetReal, stats });
  writeFileSync(`${out}/trajectory.svg`, svg);
  const pp = await h.browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });
  await pp.setContent(`<!doctype html><html><body style="margin:0;background:#f9f9f7">${svg}</body></html>`);
  await (await pp.$('svg'))!.screenshot({ path: `${out}/trajectory.png` });
  await pp.close();
  summary.shots = shots.map((x) => `${out}/${x}`);
  summary.plot = `${out}/trajectory.png`;
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nplot: ${out}/trajectory.png\nshots: ${shots.map((x) => `${out}/${x}`).join('\n       ')}`);
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

// ───────────────────────────── plot ─────────────────────────────

function plot(
  frames: Rec[],
  routes: { t: number; length: number; pts: [number, number][] }[],
  iUp: number,
  furniture: Footprint[],
  walls: import('three').Box3[],
  m: { chairMin: number; personMin: number; toeMin: number; arrive: number; greetReal: number; stats: { meanMs: number; p95Ms: number; meanWalkers: number } },
): string {
  // the waiting room, triage and the corridor outside; x right, z down (north up), metres
  const X0 = -0.7;
  const X1 = 14.2;
  const Z0 = 12.3;
  const Z1 = 24.7;
  const S = 62;
  const L = 40;
  const T = 92;
  const W = Math.round((X1 - X0) * S) + L + 250;
  const H = Math.round((Z1 - Z0) * S) + T + 40;
  const px = (x: number) => (L + (x - X0) * S).toFixed(1);
  const pz = (z: number) => (T + (z - Z0) * S).toFixed(1);
  const C = { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', base: '#c3c2b7', patient: '#2a78d6', nurse: '#eb6834', other: '#1baf7a' };
  const parts: string[] = [];
  const rect = (f: Footprint, attrs: string) => {
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    const pts = [
      [-f.hw, -f.hd],
      [f.hw, -f.hd],
      [f.hw, f.hd],
      [-f.hw, f.hd],
    ].map(([lx, lz]) => `${px(f.x + lx * c + lz * s)},${pz(f.z - lx * s + lz * c)}`);
    parts.push(`<polygon points="${pts.join(' ')}" ${attrs}/>`);
  };
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.surface}"/>`);
  // everything on the plan is clipped to it (routes run on down the corridor)
  parts.push(`<defs><clipPath id="plan"><rect x="${px(X0)}" y="${pz(Z0)}" width="${((X1 - X0) * S).toFixed(1)}" height="${((Z1 - Z0) * S).toFixed(1)}"/></clipPath></defs><g clip-path="url(#plan)">`);
  // rooms: a hairline floor outline and their names
  for (const r of LAYOUTS.ed.rooms) {
    const { x, z, w, d } = r.rect;
    if (x > X1 || x + w < X0 || z > Z1 || z + d < Z0 || r.kind === 'exterior') continue;
    parts.push(`<text x="${px(Math.max(X0 + 0.2, x + 0.25))}" y="${pz(Math.max(Z0 + 0.45, z + 0.45))}" font-size="12" fill="${C.muted}">${r.label}</text>`);
  }
  // 1 m grid, recessive
  for (let x = Math.ceil(X0); x <= X1; x++) parts.push(`<line x1="${px(x)}" y1="${pz(Z0)}" x2="${px(x)}" y2="${pz(Z1)}" stroke="${C.grid}" stroke-width="0.6"/>`);
  for (let z = Math.ceil(Z0); z <= Z1; z++) parts.push(`<line x1="${px(X0)}" y1="${pz(z)}" x2="${px(X1)}" y2="${pz(z)}" stroke="${C.grid}" stroke-width="0.6"/>`);
  // walls and solid props
  for (const b of walls) {
    if (b.max.x < X0 || b.min.x > X1 || b.max.z < Z0 || b.min.z > Z1) continue;
    const x0 = Math.max(X0, b.min.x);
    const z0 = Math.max(Z0, b.min.z);
    const x1 = Math.min(X1, b.max.x);
    const z1 = Math.min(Z1, b.max.z);
    parts.push(`<rect x="${px(x0)}" y="${pz(z0)}" width="${((x1 - x0) * S).toFixed(1)}" height="${((z1 - z0) * S).toFixed(1)}" fill="${C.ink2}"/>`);
  }
  // furniture as built, with the 0.3 m band walkers keep from it
  const inView = (f: Footprint) => f.x > X0 - 1 && f.x < X1 + 1 && f.z > Z0 - 1 && f.z < Z1 + 1;
  for (const f of furniture.filter(inView)) rect({ ...f, hw: f.hw + 0.3, hd: f.hd + 0.3 }, `fill="none" stroke="${C.base}" stroke-width="0.8" stroke-dasharray="3 3"`);
  for (const f of furniture.filter(inView)) rect(f, `fill="${C.grid}" stroke="${C.muted}" stroke-width="1"`);
  // everyone else when the patient stood up: seated (body on the chair, legs out), standing
  const at = frames[Math.max(0, iUp)];
  for (const [id, o] of Object.entries(at?.n ?? {})) {
    if (id === PATIENT) continue;
    const seated = o[3] === 1;
    if (seated) for (const legs of personDiscs({ x: o[0], z: o[1], posture: 'sit', yaw: o[2] })) parts.push(`<circle cx="${px(legs.x)}" cy="${pz(legs.z)}" r="${(legs.r * S).toFixed(1)}" fill="none" stroke="${C.muted}" stroke-width="1" stroke-dasharray="2 2"/>`);
    parts.push(`<circle cx="${px(o[0])}" cy="${pz(o[1])}" r="${(0.22 * S).toFixed(1)}" fill="${C.muted}" fill-opacity="0.55" stroke="${C.surface}" stroke-width="2"/>`);
  }
  // planned routes (the smoothed curves), then the walked tracks
  for (const r of routes) parts.push(`<polyline points="${r.pts.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="none" stroke="${C.patient}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.7"/>`);
  const track = (id: string) => frames.slice(Math.max(0, iUp - 30)).map((f) => f.n[id]).filter((v): v is NonNullable<typeof v> => !!v && v[0] >= X0 && v[0] <= X1 && v[1] >= Z0 && v[1] <= Z1);
  const moved = (pts: ReturnType<typeof track>) => pts.length > 1 && pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0) > 0.5;
  const nurseId = ['rn_lena', 'amb_float_rn'].find((id) => moved(track(id)));
  const others = Object.keys(at?.n ?? {}).filter((id) => id !== PATIENT && id !== nurseId && moved(track(id)));
  const line = (pts: ReturnType<typeof track>, color: string, w: number) => parts.push(`<polyline points="${pts.map((p) => `${px(p[0])},${pz(p[1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const id of others) line(track(id), C.other, 2);
  if (nurseId) line(track(nurseId), C.nurse, 2);
  const pt = track(PATIENT);
  line(pt, C.patient, 3);
  // a tick every second along the patient's walk
  const fr = frames.slice(Math.max(0, iUp));
  for (let k = 0, next = fr[0]?.t ?? 0; k < fr.length; k++) {
    const v = fr[k].n[PATIENT];
    if (!v || fr[k].t < next || v[1] < Z0) continue;
    next = fr[k].t + 1;
    parts.push(`<circle cx="${px(v[0])}" cy="${pz(v[1])}" r="4" fill="${C.patient}" stroke="${C.surface}" stroke-width="2"/>`);
  }
  if (pt.length) {
    parts.push(`<circle cx="${px(pt[0][0])}" cy="${pz(pt[0][1])}" r="6" fill="${C.surface}" stroke="${C.patient}" stroke-width="3"/>`);
    parts.push(`<text x="${(Number(px(pt[0][0])) - 10).toFixed(1)}" y="${(Number(pz(pt[0][1])) + 26).toFixed(1)}" font-size="13" font-weight="600" fill="${C.ink}" text-anchor="end">called patient</text>`);
  }
  if (nurseId) {
    const nt = track(nurseId);
    const end = nt[nt.length - 1];
    parts.push(`<text x="${(Number(px(4.7)) - 16).toFixed(1)}" y="${(Number(pz(15.95)) + 5).toFixed(1)}" font-size="13" font-weight="600" fill="${C.ink}" text-anchor="end">triage nurse</text>`);
    void end;
  }
  parts.push('</g>');
  // scale bar
  parts.push(`<line x1="${px(X0 + 0.3)}" y1="${pz(Z1 - 0.3)}" x2="${px(X0 + 1.3)}" y2="${pz(Z1 - 0.3)}" stroke="${C.ink2}" stroke-width="2"/><text x="${px(X0 + 0.3)}" y="${(Number(pz(Z1 - 0.3)) - 6).toFixed(1)}" font-size="12" fill="${C.ink2}">1 m</text>`);
  // title, subtitle
  const fmt = (v: number) => v.toFixed(2);
  parts.push(`<text x="${L}" y="34" font-size="20" font-weight="600" fill="${C.ink}">Called patient’s walk: up from row B, along the aisle, round the row’s end to the nurse, out the door</text>`);
  parts.push(`<text x="${L}" y="58" font-size="13.5" fill="${C.ink2}">Night shift, seed ${SEED}, recorded every frame in the browser. Closest: ${fmt(m.chairMin)} m to a chair footprint, ${fmt(m.personMin)} m to a person, ${fmt(m.toeMin)} m to a seated person’s toes.</text>`);
  parts.push(`<text x="${L}" y="77" font-size="13.5" fill="${C.ink2}">At the nurse ${fmt(m.greetReal - m.arrive)} s before her greeting. Steering with ~${Math.round(m.stats.meanWalkers)} walkers: ${m.stats.meanMs.toFixed(3)} ms a frame (p95 ${m.stats.p95Ms.toFixed(3)} ms).</text>`);
  // legend
  const lx = Number(px(X1)) + 24;
  let ly = T + 10;
  const item = (svgMark: string, label: string) => {
    parts.push(`<g transform="translate(${lx},${ly})">${svgMark}<text x="34" y="5" font-size="13" fill="${C.ink}">${label}</text></g>`);
    ly += 28;
  };
  item(`<line x1="0" y1="0" x2="24" y2="0" stroke="${C.patient}" stroke-width="3"/>`, 'called patient (walked)');
  item(`<line x1="0" y1="0" x2="24" y2="0" stroke="${C.patient}" stroke-width="1.5" stroke-dasharray="5 4"/>`, 'planned route (smoothed)');
  item(`<circle cx="12" cy="0" r="4" fill="${C.patient}"/>`, 'one second apart');
  item(`<line x1="0" y1="0" x2="24" y2="0" stroke="${C.nurse}" stroke-width="2"/>`, 'triage nurse');
  if (others.length) item(`<line x1="0" y1="0" x2="24" y2="0" stroke="${C.other}" stroke-width="2"/>`, 'others walking');
  item(`<rect x="4" y="-7" width="16" height="14" fill="${C.grid}" stroke="${C.muted}"/>`, 'furniture footprint');
  item(`<rect x="1" y="-10" width="22" height="20" fill="none" stroke="${C.base}" stroke-dasharray="3 3"/>`, '0.3 m clearance');
  item(`<circle cx="12" cy="0" r="8" fill="${C.muted}" fill-opacity="0.55"/>`, 'person (seated or standing)');
  item(`<circle cx="12" cy="0" r="8" fill="none" stroke="${C.muted}" stroke-dasharray="2 2"/>`, 'seated: knees, feet');
  item(`<rect x="2" y="-6" width="20" height="12" fill="${C.ink2}"/>`, 'wall, solid fixture');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}</svg>`;
}

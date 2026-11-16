/**
 * The corridor wheelchair on the real GPU (world/wheelchair.ts): E on it with something in your hands
 * (refused: put it down with G), F inspects it, E sits you in it (walked round to its front, turned,
 * lowered; no snap), the seated pose (hips on the seat, back on the backrest, soles on the footplates,
 * all measured on the CPU-skinned body), the eye height; then driving: cruising and Shift speeds,
 * strokes, wheels turned by the distance rolled, hands on the rims, no footsteps but the rolling
 * sound; turning on the spot (casters swing round); a wall and a person stop it; the stairs stop it
 * (with a hint); through the waiting room's sliding door (it opens; the server learns the room); into
 * an elevator, up to Floor 2 and out; Space doesn't jump; first person, third person and top-down;
 * getting out (in front of it, clear of it), and back in from behind it.
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 *
 *   npx tsx tests/wheelchair-e2e.ts [outDir] [--only=hands,in,drive,turn,bump,door,stairs,elevator,views,out]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/wheelchair';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
mkdirSync(out, { recursive: true });

type V3 = [number, number, number];
interface Rider {
  pelvis: V3 | null;
  ankles: V3[];
  toes: V3[];
  palms: Record<string, V3>;
  rimGap: Record<string, number>;
  hands: Record<string, { phi: number; lift: number; contact: boolean }>;
  clip: string;
  posture: string;
}
interface Wc {
  state: string;
  x: number;
  z: number;
  y: number;
  heading: number;
  v: number;
  w: number;
  odo: number;
  wheels: { L: number; R: number };
  casters: { L: number; R: number };
  flip: number;
  stroke: { phase: string; kind: string; count: number };
  footprint: [number, number][];
  dims: { wheelR: number; track: number; seatTop: number; seatFront: number; backFront: number; plateTop: number; plateZ: number; rootZ: number; rimR: number; rimX: number };
  eye: V3;
  armsOn: boolean;
  rolling: boolean;
  rollGain: number;
  rider: Rider | null;
}
interface St {
  x: number;
  z: number;
  y: number;
  grounded: boolean;
  speed: number;
  camY: number;
  yaw: number;
  facing: number;
}
interface Clearance {
  seat: number;
  thighs: number;
  back: number;
  feet: number;
  floor: number;
  sideFrame: number;
}

const h = await startHarness({ portBase: 7300, dev: true });
const { check } = h;

/** distance from a point to the footprint rectangle (corners in order), 0 inside */
function toRect(px: number, pz: number, c: [number, number][]): number {
  const inside = (() => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i];
      const [bx, bz] = c[(i + 1) % 4];
      const cr = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
      if (cr !== 0) {
        if (s === 0) s = Math.sign(cr);
        else if (Math.sign(cr) !== s) return false;
      }
    }
    return true;
  })();
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i];
    const [bx, bz] = c[(i + 1) % 4];
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    best = Math.min(best, Math.hypot(px - (ax + t * (bx - ax)), pz - (az + t * (bz - az))));
  }
  return best;
}

try {
  // Night Shift on High; the dev server's hot reload is cut off (other edits mid-run would rebuild the world)
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
  await page.addStyleTag({ content: '.hud, .toasts, .wl-crosshair { visibility: hidden !important; } .wl-hint { opacity: 0 !important; }' });
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const wc = () => ev<Wc>('__acWorld.wheelchair()');
  const st = () => ev<St>('__acWorld.state()');
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const hintText = () => ev<string>(`document.querySelector('.wl-hint')?.textContent ?? ''`);
  const focus = () => ev<{ key: string; label: string } | null>('__acWorld.focus()');
  const shot = async (name: string, settle = 150) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`  📸 ${out}/${name}.png`);
  };
  const until = async (pred: () => Promise<boolean>, ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await pred()) return true;
      await page.waitForTimeout(80);
    }
    return false;
  };
  /** per animation frame, in the page, for `ms`: the chair and the player */
  const sample = (ms: number) =>
    page.evaluate(`new Promise((resolve) => {
      const out = []; const t0 = performance.now();
      const tick = () => { const w = __acWorld.wheelchair(); const s = __acWorld.state();
        out.push({ t: (performance.now() - t0) / 1000, T: performance.now() / 1000, gt: w.time, v: w.v, w: w.w, x: s.x, z: s.z, y: s.y, facing: s.facing, odo: w.odo, phase: w.stroke.phase, count: w.stroke.count, state: w.state, heading: w.heading, gaps: w.rider ? w.rider.rimGap : null, contact: w.rider ? w.rider.hands : null, fp: w.footprint });
        if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(out); };
      requestAnimationFrame(tick);
    })`) as Promise<{ t: number; T: number; gt: number; v: number; w: number; x: number; z: number; y: number; facing: number; odo: number; phase: string; count: number; state: string; heading: number; gaps: Record<string, number> | null; contact: Record<string, { contact: boolean }> | null; fp: [number, number][] }[]>;
  const hold = async (keys: string[], ms: number) => {
    for (const k of keys) await page.keyboard.down(k);
    const s = await sample(ms);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    return s;
  };
  const steps = async () => (await ev<{ counts: Record<string, number> } | null>('__acSound.stats()'))?.counts['step.player'] ?? 0;
  /** get into the chair from where you are (first person, aiming at it), back to the camera you were in */
  const getIn = async (mode: 'first' | 'third' = 'third') => {
    await cam('first');
    await page.waitForTimeout(250);
    await page.keyboard.press('KeyE');
    await cam(mode);
    return until(async () => (await wc()).state === 'riding', 6000);
  };
  const stopped = () => until(async () => Math.abs((await wc()).v) < 0.01, 4000);

  // stand still a moment (the chair measures your feet standing), then in front of it, aiming at it
  await cam('first');
  await ev('__acWorld.teleport(8.6, 12.85, 0, -35)');
  await page.waitForTimeout(2500);
  const home = await wc();
  check('the wheelchair is parked in the corridor by the waiting room', home.state === 'parked' && Math.abs(home.x - 8.6) < 0.01 && Math.abs(home.z - 14.3) < 0.01, `at ${home.x}, ${home.z}`);
  const f0 = await focus();
  check('E on it: "Sit in the wheelchair"', !!f0 && f0.key === 'use:wc:sit' && /^Sit in the wheelchair/.test(f0.label), JSON.stringify(f0));

  if (want('hands')) {
    // something in your hands: refused, with the G hint
    const items = await ev<{ id: string; kind: string; label: string; caseItemId?: string }[]>('__acWorld.listItems()');
    const loose = items.filter((i) => !i.caseItemId);
    const thing = loose.find((i) => ['pen', 'clipboard', 'coffeeMug', 'gloveBox'].includes(i.kind)) ?? loose[0];
    await ev(`__acWorld.pickUp('${thing.id}')`);
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    const ht = await hintText();
    check("holding something: not seated, hint \"Put down what you're holding first (G)\"", (await wc()).state === 'parked' && /Put down what you're holding first \(G\)/.test(ht), `${thing.label}; hint "${ht}"`);
    // put it down out of the way (G only: E is for using things)
    await ev('__acWorld.teleport(6.4, 12.4, -90, -40)');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(400);
    check('G puts it down', (await ev<{ held: unknown[] }>('__acWorld.amenities()')).held.length === 0);
    // F on the chair: what it is
    await ev('__acWorld.teleport(8.6, 12.85, 0, -35)');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(300);
    const insp = await ev<{ title: string } | null>('__ac.store.get().inspect');
    check('F on it inspects it', insp?.title === 'Wheelchair', JSON.stringify(insp));
    await page.keyboard.press('KeyF');
    await ev('__ac.store.set({ inspect: null })');
  }

  if (want('in') || want('drive') || want('turn') || want('bump') || want('door') || want('stairs') || want('elevator') || want('views') || want('out')) {
    // ── getting in: walked to its front, turned round, lowered into the seat; never a jump ──
    await ev('__acWorld.teleport(8.6, 12.85, 0, -35)');
    await page.waitForTimeout(300);
    const before = await st();
    await page.keyboard.press('KeyE');
    await cam('third');
    await ev('__acWorld.look(150, -12, 2.6)');
    const tr = await sample(900);
    await shot('01-getting-in-turning', 0);
    const tr2 = await sample(800);
    await shot('02-getting-in-sitting', 0);
    const tr3 = await sample(1500);
    // speeds frame to frame on the world's own clock (screenshots in between included): never faster than
    // a brisk step, never a snap (a teleport would be metres in one frame)
    const all = [...tr, ...tr2, ...tr3];
    let speed = 0;
    let turnRate = 0;
    let at = '';
    for (let i = 1; i < all.length; i++) {
      const dt = all[i].gt - all[i - 1].gt;
      if (dt < 1e-4) continue; // the same frame sampled twice
      const sp = Math.hypot(all[i].x - all[i - 1].x, all[i].z - all[i - 1].z) / dt;
      if (sp > speed) {
        speed = sp;
        at = `${all[i].state}, frame of ${(dt * 1000).toFixed(0)} ms`;
      }
      turnRate = Math.max(turnRate, Math.abs(Math.atan2(Math.sin(all[i].facing - all[i - 1].facing), Math.cos(all[i].facing - all[i - 1].facing))) / dt);
    }
    const seated = await wc();
    check('E sits you in it', seated.state === 'riding', seated.state);
    check('no teleport snap: you walk there, turn round and sit, smoothly', speed < 2.6 && turnRate < 8, `fastest ${speed.toFixed(2)} m/s (${at}), fastest turn ${((turnRate * 180) / Math.PI).toFixed(0)}°/s (from ${before.x.toFixed(2)}, ${before.z.toFixed(2)})`);
    check('back to the chair: facing the way it faces', Math.abs(Math.sin(((seated.heading * Math.PI) / 180 - (await st()).facing) / 2)) < 0.02);
  }

  if (want('in')) {
    // into the open hub to look at the pose (facing +x: its left is −z)
    await ev('__acWorld.wheelchairTo(14, 11.0, 90)');
    await page.waitForTimeout(1600);
    const w = await wc();
    const r = w.rider!;
    const D = w.dims;
    const c = await ev<Clearance>('__acWorld.wheelchairClearance()');
    console.log('  rider', JSON.stringify({ pelvis: r.pelvis, ankles: r.ankles, toes: r.toes }), 'skin', JSON.stringify(c));
    check('hips on the seat: pelvis over the seat, ~0.1 m above the sagging sling', !!r.pelvis && r.pelvis[1] > D.seatTop + 0.03 && r.pelvis[1] < D.seatTop + 0.1 && r.pelvis[2] > D.backFront + 0.12 && r.pelvis[2] < D.seatFront - 0.15 && Math.abs(r.pelvis[0]) < 0.03, `pelvis ${JSON.stringify(r.pelvis)}, seat top ${D.seatTop.toFixed(3)}`);
    check('back against the backrest, not through it (skin within 0–4 cm of it)', c.back > -0.01 && c.back < 0.045, `nearest ${(c.back * 100).toFixed(1)} cm`);
    check('soles on the footplates (skin 0–2 cm above them)', c.feet > -0.01 && c.feet < 0.02 && r.toes.every((t) => Math.abs(t[1] - D.plateTop - 0.02) < 0.025), `nearest ${(c.feet * 100).toFixed(1)} cm, toe joints ${r.toes.map((t) => t[1].toFixed(3)).join(', ')}`);
    check('feet over the plates (between their front and back edges)', r.ankles.every((a) => a[2] > D.plateZ - 0.09 && a[2] < D.plateZ + 0.09 && Math.abs(Math.abs(a[0]) - 0.105) < 0.04));
    check('nothing below the floor', c.floor > 0.02, `lowest skin ${c.floor.toFixed(3)} m`);
    for (const [name, yaw, pitch, dist] of [
      ['03-seated-side-right', 0, -6, 2.0],
      ['04-seated-side-left', 180, -6, 2.0],
      ['05-seated-front', 90, -6, 2.0],
      ['06-seated-back', -90, -10, 1.8],
      ['06b-seated-side-low', 20, 14, 1.5],
    ] as [string, number, number, number][]) {
      await ev(`__acWorld.look(${yaw}, ${pitch}, ${dist})`);
      await shot(name, 600);
    }
    // the eye, first person
    await cam('first');
    await page.waitForTimeout(500);
    const s = await st();
    check('first person: seated eye height ≈ 1.2–1.3 m', s.camY > 1.15 && s.camY < 1.34, `${s.camY.toFixed(3)} m`);
    await ev(`__acWorld.look(${w.heading + 180}, -62)`);
    await shot('07-first-person-looking-down', 600);
    await ev(`__acWorld.look(${w.heading + 180}, -8)`);
    await shot('08-first-person-ahead', 400);
    await cam('third');
  }

  if (want('drive')) {
    // ── speeds: along the parking lot's aisle, heading east (open asphalt, nobody about at night) ──
    await ev('__acWorld.wheelchairTo(-6, 37, 90)');
    await ev('__acWorld.look(90 + 180, -8, 2.7)');
    await page.waitForTimeout(800);
    const w0 = await wc();
    const s0 = await steps();
    const cruise = await hold(['KeyW'], 6500);
    const w1 = await wc();
    const vmax = Math.max(...cruise.map((f) => f.v));
    const late = cruise.filter((f) => f.t > 3.5);
    const mean = late.reduce((a, f) => a + f.v, 0) / Math.max(1, late.length);
    // strokes: the speed rises during each push and falls while coasting (a peak: the fastest within ±0.25 s, 2 cm/s above both ends)
    let peaks = 0;
    for (let i = 0; i < cruise.length; i++) {
      const f = cruise[i];
      if (f.t < 1 || f.t > cruise[cruise.length - 1].t - 0.25) continue;
      const win = cruise.filter((g) => Math.abs(g.t - f.t) <= 0.25);
      if (win.some((g) => g.v > f.v || (g.v === f.v && g.t < f.t))) continue;
      const lo = Math.min(...win.filter((g) => g.t < f.t).map((g) => g.v));
      const hi = Math.min(...win.filter((g) => g.t > f.t).map((g) => g.v));
      if (f.v - lo > 0.02 && f.v - hi > 0.02) peaks++;
    }
    check('W: cruising 0.8–1.1 m/s', mean > 0.8 && mean < 1.1 && vmax < 1.2, `mean ${mean.toFixed(2)} m/s after 3.5 s, max ${vmax.toFixed(2)}`);
    check('speed comes in strokes (~1 s cycle), coasting between', w1.stroke.count - w0.stroke.count >= 5 && peaks >= 4, `${w1.stroke.count - w0.stroke.count} pushes in 6.5 s, ${peaks} speed peaks`);
    const first = cruise.filter((f) => f.t < 1.0);
    check('the first push gets you going (≈0.5–0.7 m/s)', Math.max(...first.map((f) => f.v)) > 0.4 && Math.max(...first.map((f) => f.v)) < 0.8, `${Math.max(...first.map((f) => f.v)).toFixed(2)} m/s after the first push`);
    // the wheels turn by the distance rolled (straight: both alike)
    const dist = w1.odo - w0.odo;
    const turnL = (w1.wheels.L - w0.wheels.L) * w1.dims.wheelR;
    const turnR = (w1.wheels.R - w0.wheels.R) * w1.dims.wheelR;
    const moved = Math.hypot(cruise[cruise.length - 1].x - cruise[0].x, cruise[cruise.length - 1].z - cruise[0].z);
    check('the big wheels turn by the distance rolled (r = 0.31 m)', Math.abs(turnL - dist) < 0.005 * dist && Math.abs(turnR - dist) < 0.005 * dist && Math.abs(moved - dist) < 0.03 * dist + 0.02, `rolled ${dist.toFixed(3)} m (moved ${moved.toFixed(3)} m), wheels ${turnL.toFixed(3)} / ${turnR.toFixed(3)} m of tread`);
    // hands on the rims while pushing
    const contact = cruise.filter((f) => f.phase === 'push' && f.gaps && f.t > 0.5);
    const gaps = contact.map((f) => Math.max(f.gaps!.L, f.gaps!.R)).sort((a, b) => a - b);
    const gap = gaps[gaps.length - 1] ?? 1;
    const p90 = gaps[Math.floor(gaps.length * 0.9)] ?? 1;
    const worstF = contact.find((f) => Math.max(f.gaps!.L, f.gaps!.R) === gap);
    check('pushing: both palms on the push rims (grip point within 2.5 cm of the rim; 4 cm at worst)', contact.length > 10 && p90 < 0.025 && gap < 0.04, `${contact.length} frames: median ${((gaps[gaps.length >> 1] ?? 0) * 100).toFixed(1)} cm, 90th ${(p90 * 100).toFixed(1)} cm, worst ${(gap * 100).toFixed(1)} cm at rim angle ${JSON.stringify(worstF?.contact?.L)}`);
    const recov = cruise.filter((f) => f.phase === 'recover' && f.gaps && f.t > 0.5);
    check('between pushes the hands come off the rims and back', recov.length > 5 && Math.max(...recov.map((f) => Math.max(f.gaps!.L, f.gaps!.R))) > 0.05);
    check('rolling forward, the casters trail behind their stems', Math.abs(w1.casters.L) < 12 && Math.abs(w1.casters.R) < 12, `L ${w1.casters.L.toFixed(1)}°, R ${w1.casters.R.toFixed(1)}° (0 = trailing straight back)`);
    check('no footsteps while rolling', (await steps()) === s0, `${(await steps()) - s0} steps`);
    check('a soft rolling sound while moving', w1.rolling && w1.rollGain > 0.2, `playing ${w1.rolling}, gain ${w1.rollGain.toFixed(2)}`);
    // Shift: quicker, harder strokes, top speed ≈ 2.7 (new tuning, not yet measured on the GPU; issue #21)
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    const fast = await sample(5000);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    const fmax = Math.max(...fast.map((f) => f.v));
    const flate = fast.filter((f) => f.t > 2.5);
    const fmean = flate.reduce((a, f) => a + f.v, 0) / Math.max(1, flate.length);
    check('Shift: faster strokes, top speed ≈ 2.7 m/s (never above 2.7)', fmax > 2.3 && fmax <= 2.701 && fmean > 1.9,`max ${fmax.toFixed(2)}, mean ${fmean.toFixed(2)} m/s`);
    // letting go: it rolls on a little, then the hands on the rims stop it
    const coast = await sample(2500);
    const v0 = coast[0].v;
    const stopAt = coast.find((f) => f.v < 0.02);
    check('letting go: coasts, then stops within ~2 m', !!stopAt && stopAt.t > 0.4 && Math.abs(stopAt.x - coast[0].x) < 2.2, `from ${v0.toFixed(2)} m/s, stopped after ${stopAt?.t.toFixed(2)} s, ${stopAt ? Math.abs(stopAt.x - coast[0].x).toFixed(2) : '?'} m`);
    // backwards
    await stopped();
    const back = await hold(['KeyS'], 3000);
    const bmin = Math.min(...back.map((f) => f.v));
    check('S: pushes backwards, slowly', bmin < -0.25 && bmin > -0.66, `${bmin.toFixed(2)} m/s`);
    await stopped();
    // Space doesn't jump
    const y0 = await st();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const y1 = await st();
    check("Space doesn't jump while seated", y1.y === y0.y && y1.grounded && (await wc()).state === 'riding', `feet ${y0.y} → ${y1.y}`);
    // mid-stroke, from the side (the hospital street, east, along its north wall: the camera has the street)
    await ev(`__acWorld.wheelchairTo(50.0, 9.75, 90)`);
    await ev('__acWorld.look(0, -14, 2.4)');
    await page.waitForTimeout(500);
    await page.keyboard.down('KeyW');
    await until(async () => (await wc()).stroke.count >= 3, 4000);
    await until(async () => (await wc()).stroke.phase === 'push', 1500);
    await page.waitForTimeout(110);
    await shot('09-mid-stroke-push', 0);
    await until(async () => (await wc()).stroke.phase === 'recover', 1500);
    await page.waitForTimeout(220);
    await shot('10-mid-stroke-recovery', 0);
    await page.keyboard.up('KeyW');
    await stopped();
  }

  if (want('turn')) {
    // open floor in the hub, west of the station
    await ev('__acWorld.wheelchairTo(9.0, 10.9, 90)');
    await ev('__acWorld.look(140, -35, 2.8)');
    await page.waitForTimeout(500);
    const t0 = await wc();
    const spin = await hold(['KeyA'], 1600);
    await shot('11-turning-on-the-spot', 0);
    const spin2 = await sample(500);
    const t1 = await wc();
    const turned = (((t1.heading - t0.heading + 540) % 360) - 180);
    const drift = Math.max(...[...spin, ...spin2].map((f) => Math.hypot(f.x - spin[0].x, f.z - spin[0].z)));
    if (drift > 0.2) console.log('  spin trace', JSON.stringify([...spin, ...spin2].filter((_, i) => i % 6 === 0).map((f) => [f.t.toFixed(2), f.v.toFixed(2), f.w.toFixed(2), f.phase])));
    check('A: turns to the left on the spot (one rim forward, one back)', turned > 50 && turned < 200 && drift < 0.2, `${turned.toFixed(0)}° in ~2 s, the seat moved ${(drift * 100).toFixed(1)} cm`);
    check('the wheels turned opposite ways', (t1.wheels.L - t0.wheels.L) * (t1.wheels.R - t0.wheels.R) < 0, `L ${(t1.wheels.L - t0.wheels.L).toFixed(2)} rad, R ${(t1.wheels.R - t0.wheels.R).toFixed(2)} rad`);
    check('the casters swung round to trail the turn', Math.abs(((t1.casters.L - t0.casters.L + 540) % 360) - 180) > 30 || Math.abs(((t1.casters.R - t0.casters.R + 540) % 360) - 180) > 30, `L ${t0.casters.L.toFixed(0)}° → ${t1.casters.L.toFixed(0)}°, R ${t0.casters.R.toFixed(0)}° → ${t1.casters.R.toFixed(0)}°`);
    // W + D: a curve to the right
    await stopped();
    const c0 = await wc();
    await hold(['KeyW', 'KeyD'], 2500);
    const c1 = await wc();
    const curve = (((c1.heading - c0.heading + 540) % 360) - 180);
    check('W + D: rolls in a curve to the right', curve < -25 && Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.8, `${curve.toFixed(0)}° over ${Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(2)} m`);
    await stopped();
    // S + A: reversing steers the rear to the left (negative heading delta, same sign as W + D)
    const r0 = await wc();
    await hold(['KeyS', 'KeyA'], 2500);
    const r1 = await wc();
    const revCurve = (((r1.heading - r0.heading + 540) % 360) - 180);
    check('S + A: reverses in a curve to the left', revCurve < -15 && Math.hypot(r1.x - r0.x, r1.z - r0.z) > 0.4, `${revCurve.toFixed(0)}° over ${Math.hypot(r1.x - r0.x, r1.z - r0.z).toFixed(2)} m`);
    await stopped();
  }

  if (want('bump')) {
    // a wall: the waiting room's north wall, west of its door
    const face = Math.min(...(await ev<number[][]>('__acWorld.collidersNear(1.9, 14.8, 0.5)')).filter((b) => b[3] - b[1] < 0.4 && b[2] - b[0] > 1).map((b) => b[1]));
    await ev('__acWorld.wheelchairTo(1.9, 12.6, 0)');
    await ev('__acWorld.look(-90, -10, 2.4)');
    await page.waitForTimeout(400);
    const wall = await hold(['KeyW'], 4000);
    const end = await wc();
    const maxZ = Math.max(...wall.flatMap((f) => f.fp.map((p) => p[1])));
    check('a wall stops it: the footprint never enters the wall', Number.isFinite(face) && maxZ <= face + 0.003 && maxZ > face - 0.05 && Math.abs(end.v) < 0.05, `front reached z ${maxZ.toFixed(3)} (wall face ${face.toFixed(3)}), speed ${end.v.toFixed(2)}`);
    await shot('12-stopped-at-a-wall');
    // someone seated in the waiting room: roll up to them, face on; the chair stops at their legs (feet ~0.6 m out)
    type N = { id: string; posture: string; ambient?: { props?: string[] } };
    const seatedIds = (await ev<N[]>(`__ac.store.get().view.npcs.filter((n) => n.visible && n.location === 'waiting' && n.posture === 'sit').map((n) => ({ id: n.id, posture: n.posture, ambient: n.ambient }))`)).filter((n) => !n.ambient?.props?.includes('wheelchair'));
    let bumped: string | null = null;
    for (const s of seatedIds) {
      const n = await ev<{ x: number; z: number; yaw: number; posture: string } | null>(`__acWorld.npc('${s.id}')`);
      if (!n || n.posture !== 'sit') continue;
      const fx = Math.sin(n.yaw);
      const fz = Math.cos(n.yaw);
      // the chair 2.2 m in front of them, facing them; its way there clear of furniture
      const cx = n.x + fx * 2.2;
      const cz = n.z + fz * 2.2;
      const mid = await ev<number[][]>(`__acWorld.collidersNear(${n.x + fx * 1.3}, ${n.z + fz * 1.3}, 0.45)`);
      const at = await ev<number[][]>(`__acWorld.collidersNear(${cx}, ${cz}, 0.7)`);
      if (mid.length || at.length) continue;
      await ev(`__acWorld.wheelchairTo(${cx}, ${cz}, ${((Math.atan2(-fx, -fz) * 180) / Math.PI).toFixed(1)})`);
      await ev(`__acWorld.look(${((Math.atan2(-fz, fx) * 180) / Math.PI).toFixed(1)}, -14, 2.4)`);
      await page.waitForTimeout(400);
      const bump = await hold(['KeyW'], 3500);
      const n1 = await ev<{ x: number; z: number }>(`__acWorld.npc('${s.id}')`);
      const last = bump[bump.length - 1];
      const rolled = Math.hypot(last.x - bump[0].x, last.z - bump[0].z);
      const gapNow = toRect(n1.x, n1.z, last.fp);
      const nearest = Math.min(...bump.map((f) => toRect(n1.x, n1.z, f.fp)));
      if (rolled < 0.25) continue;
      bumped = s.id;
      check('someone seated in the way stops it at their legs', last.v < 0.05 && nearest > 0.55 && gapNow < 0.95, `${s.id}: rolled ${rolled.toFixed(2)} m, stopped with its front ${(gapNow * 100).toFixed(0)} cm from them (feet reach ~60–80 cm); closest ${(nearest * 100).toFixed(0)} cm, end speed ${last.v.toFixed(2)} m/s`);
      await shot('12b-stopped-at-someones-feet');
      break;
    }
    if (!bumped) check('someone seated in the way stops it at their legs', false, `no seated person with room in front of them (${seatedIds.length} seated)`);
  }

  if (want('door')) {
    // the outpatient clinic's automatic sliding door (x 52–54.4 on the hospital street; closed at night, nobody inside)
    await ev('__acWorld.wheelchairTo(53.2, 10.4, 0)');
    await ev('__acWorld.look(180, -10, 2.6)');
    await page.waitForTimeout(800);
    const room0 = await ev<string>('__ac.store.get().view.player.location');
    await page.keyboard.down('KeyW');
    let opened = false;
    const t0 = Date.now();
    let shotTaken = false;
    while (Date.now() - t0 < 7000) {
      const s = await ev<{ doors: { x: number; z: number; open: boolean; by: string }[] } | null>('__acSound.stats()');
      const d = s?.doors.find((dd) => Math.abs(dd.x - 53.2) < 0.3 && Math.abs(dd.z - 13) < 0.3);
      if (d?.open && d.by === 'player') opened = true;
      const w = await wc();
      if (!shotTaken && w.z > 12.75) {
        await shot('13-through-the-sliding-door', 0);
        shotTaken = true;
      }
      if (w.z > 15.2) break;
      await page.waitForTimeout(100);
    }
    await page.keyboard.up('KeyW');
    const w = await wc();
    const rear = Math.min(...w.footprint.map((p) => p[1]));
    check('through the automatic sliding door (it opens for you)', rear > 13.1 && opened, `footprint's rear at z ${rear.toFixed(2)} (door line 13), opened by you: ${opened}`);
    const reported = await until(async () => (await ev<string>('__ac.store.get().view.player.location')) === 'clinic', 5000);
    check('the server learns your room as you roll in', reported, `${room0} → ${await ev<string>('__ac.store.get().view.player.location')}`);
    await stopped();
  }

  if (want('stairs')) {
    // Stair 1's core at ground level, facing the first flight (its foot at z 3.92)
    await ev('__acWorld.wheelchairTo(48.76, 5.4, 180)');
    await ev('__acWorld.look(90, -14, 2.2)');
    await page.waitForTimeout(500);
    const go = await hold(['KeyW'], 3500);
    const w = await wc();
    const minZ = Math.min(...go.flatMap((f) => f.fp.map((p) => p[1])));
    const ht = await hintText();
    check("the stairs stop it, with a hint (it can't take them)", minZ > 3.92 - 0.03 && Math.max(...go.map((f) => f.y)) < 0.01 && /stairs/.test(ht), `front reached z ${minZ.toFixed(3)} (first step at 3.92), feet ≤ ${Math.max(...go.map((f) => f.y)).toFixed(3)} m, hint "${ht}"`);
    // from behind and above (the stair core is narrow: a short boom)
    await ev('__acWorld.look(0, -38, 1.6)');
    await shot('14-stopped-at-the-stairs', 500);
    void w;
  }

  if (want('elevator')) {
    type Car = { id: string; y: number; level: number; door: number; phase: string; moving: boolean };
    const cars = async () => (await ev<{ elevator: { cars: Car[] } }>('__acWorld.floors()')).elevator.cars;
    const CAR_X: Record<string, number> = { A: 52.35, B: 54.65 };
    await ev('__acWorld.wheelchairTo(53.5, 3.2, 180)');
    await page.waitForTimeout(400);
    await ev(`__acWorld.press('elev:east:call:0')`);
    let car: Car | undefined;
    await until(async () => {
      car = (await cars()).find((c) => c.level === 0 && c.phase === 'open' && !c.moving);
      return !!car;
    }, 15000);
    check('called a car to the lobby', !!car, car?.id);
    if (car) {
      await ev(`__acWorld.wheelchairTo(${CAR_X[car.id]}, 1.7, 180)`);
      await ev('__acWorld.look(-20, -16, 2.6)');
      await page.waitForTimeout(400);
      await page.keyboard.down('KeyW');
      let shotTaken = false;
      await until(async () => {
        const w = await wc();
        if (!shotTaken && w.z < 0.3) {
          await shot('15-rolling-into-the-elevator', 0);
          shotTaken = true;
        }
        return w.z < -1.15;
      }, 7000);
      await page.keyboard.up('KeyW');
      await stopped();
      const inCar = await wc();
      const rearZ = Math.max(...inCar.footprint.map((p) => p[1]));
      check('rolled all the way into the car (behind the doors)', rearZ < -0.25, `footprint's rear at z ${rearZ.toFixed(2)}`);
      await ev('__acWorld.look(0, -20, 1.6)');
      await shot('16-in-the-elevator', 500);
      await ev(`__acWorld.press('elev:east:car:${car.id}')`);
      const up = await until(async () => {
        const c = (await cars()).find((cc) => cc.id === car!.id)!;
        return c.level === 1 && c.phase === 'open' && !c.moving;
      }, 25000);
      const w = await wc();
      check('the elevator takes it (and you) to Floor 2', up && Math.abs(w.y - 3) < 0.05 && Math.abs((await st()).y - 3) < 0.05, `chair at y ${w.y.toFixed(2)}`);
      // back out onto the ward's lobby
      await page.keyboard.down('KeyS');
      await until(async () => (await wc()).z > 1.4, 9000);
      await page.keyboard.up('KeyS');
      await stopped();
      const f = await ev<{ level: number; room: string }>('__acWorld.floors()');
      check('backed out onto Floor 2', f.level === 1 && f.room === 'f2_lobby', `level ${f.level}, ${f.room}`);
      await ev('__acWorld.look(150, -12, 2.6)');
      await shot('17-out-on-floor-2', 600);
      // and back down (the debug placement): the rest happens on the ground floor
      await ev('__acWorld.wheelchairTo(14, 11.0, 90, 0)');
      await page.waitForTimeout(800);
    }
  }

  if (want('views')) {
    await ev('__acWorld.wheelchairTo(20, 8.4, 90)');
    // third person: the boom pivots lower than standing
    await cam('third');
    await ev('__acWorld.look(90 + 180, -6, 2.7)');
    await page.waitForTimeout(500);
    const s3 = await st();
    check('third person: the camera rides lower than standing (~1.3 m)', s3.camY > 1.05 && s3.camY < 1.6, `camera at ${s3.camY.toFixed(2)} m`);
    await shot('18-third-person-behind');
    // top-down: drive a bit
    await cam('top');
    await page.waitForTimeout(600);
    const a = await wc();
    await hold(['KeyW'], 1500);
    const b = await wc();
    check('top-down: W still pushes the chair', Math.hypot(b.x - a.x, b.z - a.z) > 0.5, `${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m`);
    await shot('19-top-down');
    // first person while pushing: arms reaching down to the rims
    await cam('first');
    await page.waitForTimeout(400);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await ev(`__acWorld.look(${(await wc()).heading + 180}, -50)`);
    await shot('20-first-person-pushing', 0);
    await page.keyboard.up('KeyW');
    await stopped();
    await cam('third');
  }

  if (want('out')) {
    await ev('__acWorld.wheelchairTo(14, 11.0, 90)');
    // first person, looking up at the ceiling: nothing in sight
    await cam('first');
    await ev('__acWorld.look(-90, 40)');
    await page.waitForTimeout(500);
    const before = await wc();
    const f = await focus();
    check('E with nothing in sight: "Get out of the wheelchair"', f?.label === 'Get out of the wheelchair', JSON.stringify(f));
    await page.keyboard.press('KeyE');
    await cam('third');
    await ev('__acWorld.look(15, -8, 2.6)');
    const rise = await sample(700);
    await shot('21-standing-up', 0);
    await until(async () => (await wc()).state === 'parked', 3000);
    await page.waitForTimeout(600);
    await shot('22-stood-up');
    const after = await wc();
    const s = await st();
    let jump = 0;
    const r2 = [...rise];
    for (let i = 1; i < r2.length; i++) jump = Math.max(jump, Math.hypot(r2[i].x - r2[i - 1].x, r2[i].z - r2[i - 1].z));
    const clear = toRect(s.x, s.z, after.footprint);
    check('E gets you out: standing in front of it, clear of it', after.state === 'parked' && clear > 0.29 && jump < 0.09, `you ${s.x.toFixed(2)}, ${s.z.toFixed(2)}: ${(clear * 100).toFixed(0)} cm from its footprint, largest step ${(jump * 100).toFixed(1)} cm`);
    check('the chair stays where you left it', Math.hypot(after.x - before.x, after.z - before.z) < 0.001 && Math.abs(after.heading - before.heading) < 0.01);
    // walking now: the chair is solid
    await cam('first');
    await ev(`__acWorld.teleport(${after.x - 1.6}, ${after.z}, 90, -10)`);
    await page.waitForTimeout(300);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    const p = await st();
    check('walking into the parked chair: it is solid', toRect(p.x, p.z, after.footprint) > 0.2, `${(toRect(p.x, p.z, after.footprint) * 100).toFixed(0)} cm from it`);
    // and in again from behind it (you walk round to its front)
    await ev(`__acWorld.teleport(${after.x - 1.5}, ${after.z + 0.3}, 90, -30)`);
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    const again = await until(async () => (await wc()).state === 'riding', 7000);
    check('E on it again later (from behind): in again', again, (await wc()).state);
    const w2 = await wc();
    check('…without moving it', Math.hypot(w2.x - after.x, w2.z - after.z) < 0.001);
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all wheelchair checks passed');
process.exit(h.failed() ? 1 : 0);

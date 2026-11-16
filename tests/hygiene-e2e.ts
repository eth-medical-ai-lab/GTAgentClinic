/**
 * Hand hygiene and masks on the real GPU (client/src/world/hygiene.ts, shared/hygiene.ts): the
 * dispensers the rule placed at the entrances, the sinks and the mask stations; an alcohol rub at a
 * bay's corridor dispenser and a hand wash at a bay's sink, held at their moments, in first and third
 * person (in first, the arms as your own would look: forearms that turn no further than an arm can,
 * shoulders out of view over the sink, the towel within reach), and walking off mid-rub (the arms let go in front of you); a wash at the restroom's long
 * counter in third person (the sleeves pushed up first and down again after, walks to the towels and
 * to the bin by the door), its towels taken in first person; a surgical mask put on, worn (front and side close-ups on a man's and a woman's face) and
 * taken off with M; a room on droplet precautions (the stand, the nurse's reminder); the record on the
 * server and the debrief's infection-control section. Boots a private server (tests/harness.ts) and
 * stops it at the end.
 *
 *   npx tsx tests/hygiene-e2e.ts [outDir] [--only=fixtures,rub,wash,restroom,wash-female,gloves,mask,female,precautions,debrief] [--port-base=7800]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';
import { Human, StepLog, installReader, type V3 } from './human';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/hygiene';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 7800);
mkdirSync(out, { recursive: true });

type Hy = { action: string | null; t: number | null; masked: boolean; maskOnFace: boolean; fpHands: boolean; water: boolean; stands: { room: string; kind: string; at: number[] }[]; counts: Record<string, number>; gloves: { on: boolean; bundle: boolean; sources: number; pinch: { hand: string; dist: number } | null; shown: { fp: boolean[]; tp: boolean[] } } };
/** first person: each arm's shoulder, elbow and wrist in the view's frame (m: right, up, ahead); world: the eyes, the shoulders before any pull toward a hand out of reach, the wrists */
type FpArm = { pitch: number; vfov: number; aspect: number; eye: number[]; sh0: Record<'R' | 'L', number[]>; R: Joints | null; L: Joints | null };
type Joints = { sh: number[]; el: number[]; wr: number[]; wrist: number[]; reach: number; cuff: { out: number; at: number } };
/** first person: how far the furthest drawn hand is beyond its arm's reach from where its shoulder is (m; ≤ 0 within reach, the shoulder not pulled after it) */
function overReach(g: FpArm | null): number {
  let over = -1;
  for (const side of ['R', 'L'] as const) {
    const j = g?.[side];
    if (!g || !j) continue;
    const d = Math.hypot(...g.sh0[side].map((v, i) => v - j.wrist[i]));
    over = Math.max(over, d - 0.97 * j.reach);
  }
  return over;
}
type Ic = { actions: { kind: string; room: string; at?: string }[]; moment1: { met: number; of: number }; moment4: { met: number; of: number }; masks: { masked: boolean }[] };

type WashDbg = {
  t: number;
  phase: string;
  water: boolean;
  outlet: number[];
  basinY: number;
  streamBottom: number | null;
  streamHit: string | null;
  tips: Record<'R' | 'L', { index: number[]; middle: number[]; thumb: number[] }>;
  nozzle: number[];
  press: number[];
  plate: number;
  cup: { hand: string; palm: number[]; heel: number[] };
  lever: number | null;
  leverTouch: number | null;
  gel: { visible: boolean };
  total: { R: number; L: number };
  wet: number;
  towel: { tipsToTail: { index: number; thumb: number } | null; tail: boolean; sheet: { visible: boolean; attached: boolean; top: number[] | null }; slot: number[] | null } | null;
  bin: { pedal: number; lid: number } | null;
};

const h = await startHarness({ portBase, dev: true });
/**
 * A hand wash at Bed 4's sink, first person then third, held at its moments: every contact checked in
 * numbers off the hands as drawn (hygiene.ts debugState().wash: handwash.ts), and a frame sequence
 * (wet, under the nozzle, two lather steps, the rinse, the towel's tail, drying, the bin).
 */
/** a wash's moment the fingertips take the towel's tail (handwash.ts WASH.grab, a little after) */
const WASH_GRAB = 11.58;

async function washRun(page: Page, who: string) {
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const hy = () => ev<Hy & { wash: WashDbg | null; ikErr?: (number | null)[] }>('__acWorld.hygiene()');
  await page.addStyleTag({ content: '.hud, .toasts, .wl-hint, .prompt, .hud-prompt { visibility: hidden !important; }' });
  const holdAt = async (t: number | null) => {
    await ev(`__acWorld.hygieneOp('hold', ${t === null ? 'null' : t})`);
    if (t === null) return;
    for (let i = 0; i < 400; i++) {
      const s = await hy();
      if (s.action && (s.t ?? 0) >= t - 0.001) break;
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(420);
  };
  const W = { tap: 0.95, wet: 1.75, before: 3.1, dose: 3.17, after: 3.42, rinse: [9.12, 9.55, 10.05, 10.3], off: 10.82, grab: WASH_GRAB, out: 12.25, dry: 13.0, bin: 14.22 };
  const flat = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  // third person: the camera beside the hands, between the body and the wall (Bed 4's sink: the wall at x 15.88)
  const tpCam: Record<string, [[number, number, number], [number, number, number]]> = {
    wet: [[15.42, 1.3, 6.3], [15.6, 0.86, 5.62]],
    nozzle: [[15.4, 1.42, 6.32], [15.74, 1.1, 5.7]],
    lather: [[15.38, 1.36, 6.3], [15.5, 0.98, 5.6]],
    towel: [[15.58, 1.42, 5.78], [15.74, 1.12, 5.03]],
    dry: [[15.62, 1.45, 5.72], [15.55, 1.08, 5.04]],
    bin: [[15.5, 1.78, 4.82], [15.68, 0.5, 5.03]],
  };
  for (const mode of ['first', 'third'] as const) {
    const m = mode === 'first' ? 'fp' : 'tp';
    await ev(`__ac.store.set({ camera: '${mode}' })`);
    await ev(`__acWorld.teleport(14.6, 5.4, 90, -20)`);
    await page.waitForTimeout(1500);
    await ev(`__acWorld.use('wash:bed_4_sink')`);
    const shot = async (name: string, view?: keyof typeof tpCam) => {
      if (mode === 'third' && view) await ev(`__acWorld.cam(${JSON.stringify(tpCam[view][0])}, ${JSON.stringify(tpCam[view][1])})`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/wash-${m}-${who}-${name}.png` });
      console.log(`📸 ${out}/wash-${m}-${who}-${name}.png`);
      if (mode === 'third') await ev(`__acWorld.cam(null)`);
    };
    const tag = `${who}, ${mode} person`;
    // the tap: the back of the wrist under the lever, lifting it
    await holdAt(W.tap);
    let s = (await hy()).wash!;
    h.check(`${tag}: the back of the wrist on the tap's lever as it lifts`, s.leverTouch !== null && s.leverTouch <= 0.02, `${s.leverTouch} m, lever ${s.lever}`);
    // wet: both hands' fingertips in the falling water, which stops at them
    await holdAt(W.wet);
    s = (await hy()).wash!;
    const inStream = (side: 'R' | 'L') => Math.min(...(['index', 'middle'] as const).map((k) => (s.tips[side][k][1] > s.basinY && s.tips[side][k][1] < s.outlet[1] ? flat(s.tips[side][k], s.outlet) : 9)));
    h.check(`${tag}: both hands' fingertips in the stream (within its 5 mm + a fingertip's 9 mm of its axis)`, inStream('R') <= 0.018 && inStream('L') <= 0.018, `R ${inStream('R').toFixed(3)} L ${inStream('L').toFixed(3)} m`);
    h.check(`${tag}: the stream stops at the hands (runs off them into the bowl)`, !!s.streamHit && (s.streamBottom ?? 0) > s.basinY + 0.02, `${s.streamHit} at ${s.streamBottom}`);
    await shot('1-wet', 'wet');
    // soap: nothing in the hand until it's under the nozzle; the dose falls into the cupped palm as the other hand presses the plate
    await holdAt(W.before);
    s = (await hy()).wash!;
    h.check(`${tag}: no soap in the hand before the dose`, !s.gel.visible);
    await holdAt(W.dose);
    s = (await hy()).wash!;
    const dy = s.nozzle[1] - s.cup.palm[1];
    h.check(`${tag}: the cupped palm within 3 cm under the nozzle as the dose falls`, s.gel.visible && flat(s.cup.palm, s.nozzle) <= 0.03 && dy >= 0 && dy <= 0.03, `${flat(s.cup.palm, s.nozzle).toFixed(3)} m across, ${dy.toFixed(3)} m under (${s.cup.hand} hand)`);
    const heel = Math.hypot(s.cup.heel[0] - s.press[0], s.cup.heel[1] - s.press[1], s.cup.heel[2] - s.press[2]);
    h.check(`${tag}: the other hand's heel on the plate, pressed in`, heel <= 0.02 && s.plate >= 0.9, `${heel.toFixed(3)} m, plate ${s.plate}`);
    await shot(mode === 'first' ? '2-nozzle-pressed' : '2-nozzle', 'nozzle');
    if (mode === 'first') {
      await holdAt(W.after);
      await shot('2b-soap-in-palm');
    }
    // lather: more of the skin covered after each step
    const totals: number[] = [];
    const arms: FpArm[] = [];
    for (let i = 0; i < 6; i++) {
      await holdAt(4.0 + 0.8 * (i + 1) - 0.03);
      const st = await ev<{ wash: WashDbg; fpArm: FpArm | null }>('__acWorld.hygiene()');
      totals.push(st.wash.total.R + st.wash.total.L);
      if (st.fpArm) arms.push(st.fpArm);
      if (i === 0) await shot('3-lather-palms', 'lather');
      if (i === 1) await shot('4-lather-backs', 'lather');
    }
    h.check(`${tag}: the foam covers more of the skin after every step`, totals.every((v, i) => i === 0 || v > totals[i - 1] + 0.02), totals.map((v) => v.toFixed(2)).join(' → '));
    if (mode === 'first') {
      // looking down into the sink, the head bowed over it: the shoulders behind the eyes, below the
      // view's bottom edge (with the eyes over them, the view looked straight down both upper arms), and
      // each forearm coming up into the view from below to the hands (not flat in from the side, elbows winged)
      let below = 90;
      let rise = 90;
      let poke = -1;
      let n = 0;
      for (const g of arms)
        for (const j of [g.R, g.L]) {
          if (!j) continue;
          n++;
          poke = Math.max(poke, j.cuff.out);
          below = Math.min(below, (Math.atan2(-j.sh[1], j.sh[2]) * 180) / Math.PI - g.vfov / 2);
          const [ex, ey, wx, wy] = [j.el[0] / j.el[2], j.el[1] / j.el[2], j.wr[0] / j.wr[2], j.wr[1] / j.wr[2]];
          rise = Math.min(rise, (Math.atan2(wy - ey, Math.abs(wx - ex)) * 180) / Math.PI);
        }
      h.check(`${tag}: the shoulders out of view below it, the forearms coming up into it from below`, n === 12 && below > 0 && rise >= 20, `${n} arms · shoulders ${below.toFixed(1)}° past the view's bottom edge at the least · forearms rising ${rise.toFixed(0)}° at the least (pitch ${arms.map((g) => g.pitch).join(' ')}°)`);
      // (the forearm's muscle once came through the sleeve bunched at the elbow, a triangle of skin on it)
      h.check(`${tag}: no skin through the sleeve bunched at the elbow`, n === 12 && poke <= 0, `${(poke * 1000).toFixed(1)} mm out of it at the most`);
    }
    // rinse: it goes where the water runs, a little at a time
    const rin: number[] = [];
    for (const t of W.rinse) {
      await holdAt(t);
      const w = (await hy()).wash!;
      rin.push(w.total.R + w.total.L);
      if (t === W.rinse[1]) await shot('5-rinse', 'wet');
    }
    h.check(`${tag}: the foam washes off through the rinse, not all at once`, rin[0] > rin[1] && rin[1] > rin[2] && rin[2] > rin[3] && rin[3] < 0.02 && rin[1] > 0.05, rin.map((v) => v.toFixed(2)).join(' → '));
    // the tap off with the inside of the wrist
    await holdAt(W.off);
    s = (await hy()).wash!;
    h.check(`${tag}: the tap off with the wrist on the lever, not a clean hand`, s.leverTouch !== null && s.leverTouch <= 0.02, `${s.leverTouch} m`);
    // the towel: the fingertips close on the hanging tail
    await holdAt(W.grab);
    s = (await hy()).wash!;
    const tt = s.towel?.tipsToTail;
    h.check(`${tag}: thumb and index within 2 cm of the towel's hanging tail as they take it`, !!tt && tt.index <= 0.02 && tt.thumb <= 0.02, JSON.stringify(tt));
    if (mode === 'first') {
      // (stood where the arm reaches the towel: once out of reach, the arm went out straight and its
      // shoulder was pulled after the hand)
      const over = overReach((await ev<{ fpArm: FpArm | null }>('__acWorld.hygiene()')).fpArm);
      h.check(`${tag}: the towel within the arm's reach from where you stand`, over <= 0.02, `${(over * 100).toFixed(1)} cm beyond it`);
    }
    await shot('6-towel-grab', 'towel');
    await holdAt(W.out);
    s = (await hy()).wash!;
    const sh = s.towel?.sheet;
    h.check(`${tag}: the towel pulled out of the slot, the next tail in place`, !!sh && sh.visible && !sh.attached && !!sh.top && !!s.towel?.slot && sh.top[1] < s.towel.slot[1] - 0.03 && !!s.towel?.tail, JSON.stringify({ top: sh?.top, slot: s.towel?.slot, tail: s.towel?.tail }));
    await holdAt(W.dry);
    s = (await hy()).wash!;
    h.check(`${tag}: patting the hands dry (the sheen going)`, s.wet < 1 && s.wet > 0, `${s.wet}`);
    await shot('7-dry', 'dry');
    await holdAt(W.bin);
    s = (await hy()).wash!;
    h.check(`${tag}: the pedal down, the bin's lid open for the towel`, !!s.bin && s.bin.pedal > 0.5 && s.bin.lid < -0.5, JSON.stringify(s.bin));
    await shot('8-bin', 'bin');
    await holdAt(null);
    for (let i = 0; i < 200 && (await hy()).action; i++) await page.waitForTimeout(100);
    h.check(`${tag}: the water off after the wash`, !(await hy()).water);
  }
}


/** a Night Shift on High, the dev server's hot reload cut off (edits elsewhere mid-run would rebuild the world under the test) */
async function shift(query = ''): Promise<{ page: Page; errors: string[] }> {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high${query}`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  return { page, errors };
}

try {
  const { page, errors } = await shift();
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  let hudHidden = false;
  const shot = async (name: string, hideHud = true) => {
    if (hideHud !== hudHidden) {
      await page.evaluate((hide) => {
        let s = document.getElementById('hy-hide');
        if (!s) {
          s = document.createElement('style');
          s.id = 'hy-hide';
          document.head.appendChild(s);
        }
        s.textContent = hide ? '.hud, .toasts, .wl-hint, .prompt, .hud-prompt { visibility: hidden !important; }' : '';
      }, hideHud);
      hudHidden = hideHud;
    }
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const hy = () => ev<Hy>('__acWorld.hygiene()');
  const hintText = () => ev<string>(`document.querySelector('.wl-hint')?.textContent ?? ''`);
  const tp = (x: number, z: number, yaw: number, pitch = -8) => ev(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
  const shotCam = (o: Record<string, unknown> | null) => ev(`__acWorld.amenity('cam', ${o ? JSON.stringify(o) : 'null'})`);
  /** hold the act at t s (null: let it run) and wait until it's there */
  const holdAt = async (t: number | null) => {
    await ev(`__acWorld.hygieneOp('hold', ${t === null ? 'null' : t})`);
    if (t === null) return;
    for (let i = 0; i < 400; i++) {
      const s = await hy();
      if (s.action && (s.t ?? 0) >= t - 0.001) break;
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(260);
  };
  const untilIdle = async (ms = 15000) => {
    for (let i = 0; i < ms / 100 && (await hy()).action; i++) await page.waitForTimeout(100);
  };
  const ic = () => ev<Ic>(`fetch('/api/sessions/' + __ac.store.get().view.sessionId + '/debrief').then((r) => r.json()).then((d) => d.infectionControl)`);
  await ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);

  const s0 = await hy();
  h.check('fixtures: rub dispensers, wash stations, mask boxes and bins collected', s0.counts.rubs >= 40 && s0.counts.washes >= 20 && s0.counts.masks >= 3 && s0.counts.bins >= 20, JSON.stringify(s0.counts));

  if (want('fixtures')) {
    await cam('first');
    for (const [name, x, z, yaw, pitch] of [
      ['fixtures-bay-noses', 9.6, 9.3, 160, -8],
      ['fixtures-bay1-hub-wall', 2.0, 8.9, -150, -8],
      ['fixtures-ft1-door', 17.6, 13.2, 0, -8],
      ['fixtures-triage-door', 12.4, 13.3, 0, -8],
      ['fixtures-resus3-door', 28.6, 9.8, 180, -8],
      ['fixtures-ct-xray-doors', 41.0, 9.6, 180, -8],
      ['fixtures-resus1-inside', 37.6, 19.6, 90, -6],
      ['fixtures-exam1-door', 62.4, 16.6, 0, -8],
      ['fixtures-walkin-station', 5.6, 21.0, -45, -12],
      ['fixtures-station-maskbox', 14.9, 11.9, 85, -18],
      ['fixtures-ems-maskbox', 41.6, 21.6, 30, -8],
      ['fixtures-bay-sink', 14.6, 5.5, 90, -18],
      ['fixtures-ft-sink', 18.7, 17.1, 90, -16],
      ['fixtures-exam-sink', 62.3, 19.85, 180, -16],
      ['fixtures-resus2-sink', 44.9, 17.6, -90, -14],
    ] as [string, number, number, number, number][]) {
      await tp(x, z, yaw, pitch);
      await page.waitForTimeout(1300);
      await shot(name);
    }
  }

  if (want('rub')) {
    // Bed 3's corridor dispenser, on the partition's nose by its doorway; first person
    await cam('first');
    await tp(8.05, 8.15, 180, -20);
    await page.waitForTimeout(1500);
    const focus = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('aiming at the corridor dispenser offers the rub', !!focus && focus.key === 'use:rub:rub_bed_3_out', JSON.stringify(focus));
    // holding something: put it down first
    const items = await ev<{ id: string; kind: string; x: number; z: number }[]>('__acWorld.listItems()');
    const near = items.filter((i) => Math.hypot(i.x - 12, i.z - 8) < 30).find((i) => i.kind === 'clipboard' || i.kind === 'pen');
    if (near) {
      await ev(`__acWorld.pickUp('${near.id}')`);
      await page.waitForTimeout(400);
      await ev(`__acWorld.use('rub:rub_bed_3_out')`);
      await page.waitForTimeout(200);
      const hint = await hintText();
      h.check('holding something: the G hint first', /Put down what you.re holding first \(G\)/.test(hint) && !(await hy()).action, hint);
      await page.keyboard.press('KeyG');
      await page.waitForTimeout(600);
    }
    // (each forearm's turn as drawn, every frame of it: fpArms.ts)
    await ev(`(() => {
      const w = (window.__fpTurn = []);
      window.__fpStop = false;
      const tick = () => {
        w.push(__acWorld.hygiene().fpTurn);
        if (!window.__fpStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);
    await ev(`__acWorld.use('rub:rub_bed_3_out')`);
    for (const [t, name] of [
      [0.95, 'rub-fp-1-pump'],
      [1.85, 'rub-fp-2-palms'],
      [2.55, 'rub-fp-3-backs'],
      [3.35, 'rub-fp-4-interlaced'],
      [4.05, 'rub-fp-5-fingerbacks'],
      [4.75, 'rub-fp-6-thumbs'],
      [5.5, 'rub-fp-7-fingertips'],
    ] as [number, string][]) {
      await holdAt(t);
      if (t === 0.95) h.check('first person: the hands are in view', (await hy()).fpHands);
      await shot(name);
    }
    await holdAt(null);
    await untilIdle();
    await ev('window.__fpStop = true');
    // the forearms turn as an arm can (a little past palm-down or palm-up at most) and never snap round
    const ft = await ev<({ step: number; roll: number } | null)[][]>('window.__fpTurn');
    let snap = 0;
    let furthest = 0;
    for (let i = 1; i < ft.length; i++)
      for (const k of [0, 1]) {
        const a = ft[i - 1]?.[k];
        const b = ft[i]?.[k];
        if (a && b) snap = Math.max(snap, Math.abs(b.step - a.step));
        if (b) furthest = Math.max(furthest, Math.abs(b.step));
      }
    h.check('first person: the forearms turn no further than an arm can, and never snap round', ft.length > 60 && snap <= 40 && furthest <= 111, `${ft.length} frames · the most a forearm turned in a frame ${snap}°, the furthest from palm-in ${furthest}°`);
    await page.waitForTimeout(800);
    let rec = await ic();
    h.check('the rub reached the server, at the corridor dispenser, in the corridor', rec.actions.some((a) => a.kind === 'rub' && a.at === 'rub_bed_3_out' && a.room === 'hub'), JSON.stringify(rec.actions));
    // third person, Bed 3's again
    await cam('third');
    await tp(8.05, 8.4, 180, -10);
    await page.waitForTimeout(1500);
    await ev(`__acWorld.use('rub:rub_bed_3_out')`);
    await holdAt(0.95);
    await shotCam({ around: 'pelvis', yaw: 150, pitch: 12, dist: 1.6, fov: 45, up: 0.38 });
    await shot('rub-tp-1-pump');
    for (const [t, name] of [
      [1.85, 'rub-tp-2-palms'],
      [2.55, 'rub-tp-3-backs'],
      [4.05, 'rub-tp-5-fingerbacks'],
      [4.75, 'rub-tp-6-thumbs'],
    ] as [number, string][]) {
      await holdAt(t);
      // (facing the wall: from the right side, a little behind)
      await shotCam({ around: 'pelvis', yaw: 100, pitch: 14, dist: 1.15, fov: 42, up: 0.42 });
      await shot(name);
    }
    await shotCam(null);
    await holdAt(null);
    await untilIdle();
    // Bed 4's: a workstation cart is parked in front of it, so you step in beside the cart
    await tp(12.05, 8.6, 180, -10);
    await page.waitForTimeout(1200);
    await ev(`__acWorld.use('rub:rub_bed_4_out')`);
    await holdAt(0.95);
    await shotCam({ around: 'pelvis', yaw: 150, pitch: 12, dist: 1.6, fov: 45, up: 0.38 });
    await shot('rub-tp-beside-the-cart');
    await shotCam(null);
    await holdAt(null);
    await untilIdle();
    const st = await ev<{ x: number; z: number }>('__acWorld.state()');
    h.check('stepped in beside the cart, within reach of the nozzle', Math.hypot(st.x - 12.0, st.z - 7.07) < 0.95, `${st.x.toFixed(2)}, ${st.z.toFixed(2)}`);
    // walking off mid-rub: not counted; the arms let go in front of you (the wrists, in the body's
    // frame, every frame: no further behind the hips than walking on swings them)
    await ev(`__acWorld.use('rub:rub_bed_4_out')`);
    await page.waitForTimeout(1200);
    await ev(`(() => {
      const w = (window.__walkOff = []);
      const t0 = performance.now();
      const tick = () => {
        const s = __acWorld.hygiene();
        w.push({ t: (performance.now() - t0) / 1000, action: s.action, wrists: s.wrists });
        if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(800);
    rec = await ic();
    h.check('walking off mid-rub stops it and records nothing', !(await hy()).action && rec.actions.filter((a) => a.kind === 'rub').length === 3, `${rec.actions.filter((a) => a.kind === 'rub').length} rubs`);
    const wo = await ev<{ t: number; action: string | null; wrists: (number[] | null)[] }[]>('window.__walkOff');
    const stop = wo.find((e) => !e.action)?.t ?? 0;
    const back = (from: number, to: number) => Math.min(...wo.filter((e) => !e.action && e.t - stop >= from && e.t - stop < to).flatMap((e) => e.wrists.filter((x): x is number[] => !!x).map((x) => x[0])));
    const [early, later] = [back(0, 0.5), back(0.7, 1.4)];
    h.check('walking off mid-rub: the arms let go in front of you, not dragged behind your back', Number.isFinite(early) && Number.isFinite(later) && early >= later - 0.06, `letting go ${early.toFixed(3)} m, walking on ${later.toFixed(3)} m (in front of the feet)`);
  }

  if (want('wash')) {
    // Bed 4's sink, a man's hands: every contact at the fixture, first person and third
    await washRun(page, 'male');
    await page.waitForTimeout(800);
    const rec = await ic();
    h.check('the wash reached the server, at Bed 4’s sink', rec.actions.some((a) => a.kind === 'wash' && a.at === 'bed_4_sink' && a.room === 'bed_4'), JSON.stringify(rec.actions.map((a) => [a.kind, a.at, a.room])));
  }

  if (want('gloves')) {
    // gloves from the box at Bed 4's sink, with real keys: E on, G off (an item in hand: G puts it down first)
    const gl = async () => (await hy()).gloves;
    const held = () => ev<{ id: string }[]>('__acWorld.amenities().held');
    // (third person: the crosshair's ray starts at the camera behind you, so aim as a person does, with the mouse: tests/human.ts)
    await installReader(page);
    const me = new Human(page, new StepLog(undefined, true), { width: 1600, height: 900 });
    const box = await ev<V3>(`(() => { const c = __acRead.hygiene.targets().find((x) => x.key === 'use:gloves:bed_4_sink_gloves').center; return [c.x, c.y, c.z]; })()`);
    // (the camera orbits behind you as you turn, so a few corrections, as a hand on a mouse makes them)
    const aim = async () => {
      for (let i = 0; i < 8; i++) if (await me.aimAt(box)) break;
      await page.waitForTimeout(400);
    };
    for (const mode of ['first', 'third'] as const) {
      const m = mode === 'first' ? 'fp' : 'tp';
      await cam(mode);
      await tp(15.15, 5.4, 90, -24);
      await page.waitForTimeout(1500);
      if (mode === 'third') await aim();
      const f0 = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
      h.check(`${mode} person: aiming at the glove box offers gloves, and [F] Inspect`, !!f0 && f0.key === 'use:gloves:bed_4_sink_gloves' && /\[F\] Inspect/.test(f0.label), JSON.stringify(f0));
      await page.keyboard.press('KeyE');
      await holdAt(0.8);
      const p = (await gl()).pinch;
      h.check(`${mode} person: the hand at the box's hole as it takes a glove (pinch within 2 cm of it)`, !!p && p.dist <= 0.02, JSON.stringify(p));
      // (third person: a fixed camera on the room side of the sink, as the wash's frames)
      if (mode === 'third') await ev(`__acWorld.cam([15.45, 1.7, 6.3], [15.72, 1.28, 5.42])`);
      await shot(`gloves-${m}-1-take`);
      await holdAt(1.4);
      await shot(`gloves-${m}-2-pulling-on`);
      await holdAt(3.0);
      h.check(`${mode} person: gloves on both hands`, (await gl()).shown[m].every(Boolean), JSON.stringify((await gl()).shown));
      await shot(`gloves-${m}-3-on`);
      if (mode === 'third') await ev(`__acWorld.cam(null)`);
      await holdAt(null);
      await untilIdle();
      h.check(`${mode} person: gloves on`, (await gl()).on);
      await page.waitForTimeout(700);
      // at the bedside, gloved (third person: the avatar's own hands, blue to the cuffs)
      if (mode === 'third') {
        await tp(13.6, 6.6, 0, -12);
        await page.waitForTimeout(1500);
        h.check('third person: the gloves stay on the hands at the bedside', (await gl()).shown.tp.every(Boolean), JSON.stringify((await gl()).shown));
        await shotCam({ around: 'pelvis', yaw: 35, pitch: 12, dist: 1.1, fov: 45, up: 0.3 });
        await shot('gloves-tp-4-bedside');
        await shotCam({ around: 'pelvis', yaw: 20, pitch: 25, dist: 0.75, fov: 40, up: 0.2 });
        await shot('gloves-tp-4b-bedside-hands');
        await shotCam(null);
        await tp(15.15, 5.4, 90, -24);
        await page.waitForTimeout(1200);
      }
      // G with something in hand: that goes down first, the gloves stay on
      const items = await ev<{ id: string; kind: string; x: number; z: number }[]>('__acWorld.listItems()');
      const it = items.filter((i) => Math.hypot(i.x - 15, i.z - 6) < 30).find((i) => i.kind === 'clipboard' || i.kind === 'pen');
      if (it) {
        await ev(`__acWorld.pickUp('${it.id}')`);
        await page.waitForTimeout(500);
        await page.keyboard.press('KeyG');
        await page.waitForTimeout(700);
        h.check(`${mode} person: G with something in hand puts that down first, the gloves still on`, (await held()).length === 0 && (await gl()).on && !(await hy()).action, JSON.stringify({ held: await held(), gloves: await gl() }));
      }
      // G, the pedal bin beside you: off inside out, into it
      await page.keyboard.press('KeyG');
      await holdAt(0.85);
      if (mode === 'third') await shotCam({ around: 'pelvis', yaw: 50, pitch: 18, dist: 1.1, fov: 45, up: 0.45 });
      await shot(`gloves-${m}-5-off-peeling`);
      await holdAt(1.75);
      await shot(`gloves-${m}-6-off-second`);
      if (mode === 'third') await shotCam(null);
      await holdAt(null);
      await untilIdle();
      const g2 = await gl();
      h.check(`${mode} person: G took the gloves off into the bin`, !g2.on && !g2.bundle, JSON.stringify(g2));
      await page.waitForTimeout(800);
    }
    const rec = await ic();
    h.check('gloves on and off reached the server, off into the bin by the sink', rec.actions.filter((a) => a.kind === 'gloves_on').length >= 2 && rec.actions.some((a) => a.kind === 'gloves_off' && a.at === 'bed_4_sink_bin'), JSON.stringify(rec.actions.filter((a) => /gloves/.test(a.kind)).map((a) => [a.kind, a.at])));
    // no bin in reach: the pair stays in the hand until you're beside one
    await cam('third');
    await tp(15.15, 5.4, 90, -24);
    await page.waitForTimeout(1200);
    await aim();
    await page.keyboard.press('KeyE');
    await untilIdle();
    h.check('third person: gloves on again (a fresh pair)', (await gl()).on);
    await tp(9.6, 9.3, 0, -8);
    await page.waitForTimeout(1200);
    await page.keyboard.press('KeyG');
    await untilIdle();
    h.check('no bin in reach: the used pair stays in the hand', (await gl()).bundle);
    await tp(15.2, 5.2, 90, -24);
    await page.waitForTimeout(1200);
    await page.keyboard.press('KeyG');
    await untilIdle();
    h.check('beside a bin, G drops the pair in it', !(await gl()).bundle);
  }

  if (want('mask')) {
    // the box of masks on the station's end counter; third person
    await cam('third');
    await tp(15.62, 11.62, 90, -10);
    await page.waitForTimeout(1500);
    await ev(`__acWorld.use('mask:mask_station')`);
    for (const [t, name, o] of [
      [0.9, 'mask-tp-1-take', { around: 'pelvis', yaw: 120, pitch: 10, dist: 1.6, fov: 45, up: 0.5 }],
      [1.5, 'mask-tp-2-hold', { around: 'head', yaw: 25, pitch: 2, dist: 0.9, fov: 40 }],
      [2.15, 'mask-tp-3-loops', { around: 'head', yaw: 60, pitch: 2, dist: 0.8, fov: 40 }],
      [2.65, 'mask-tp-4-nose-wire', { around: 'head', yaw: 20, pitch: 2, dist: 0.7, fov: 40 }],
    ] as [number, string, Record<string, number | string>][]) {
      await holdAt(t);
      await shotCam(o);
      await shot(name);
    }
    await holdAt(null);
    await untilIdle();
    await page.waitForTimeout(600);
    const st = await hy();
    h.check('the mask is on the face', st.masked && st.maskOnFace);
    await shotCam({ around: 'head', yaw: 0, pitch: 0, dist: 0.55, fov: 32 });
    await shot('mask-male-front');
    await shotCam({ around: 'head', yaw: 90, pitch: 0, dist: 0.55, fov: 32 });
    await shot('mask-male-side');
    await shotCam({ around: 'head', yaw: -40, pitch: 8, dist: 0.6, fov: 32 });
    await shot('mask-male-three-quarter');
    await shotCam(null);
    // first person: worn, nothing in view; the HUD says so
    await cam('first');
    await tp(15.2, 12.6, 0, -6);
    await page.waitForTimeout(1200);
    await shot('mask-fp-wearing', false);
    const chip = await ev<string>(`document.querySelector('.hud-mask')?.textContent ?? ''`);
    h.check('first person: the HUD shows the mask', /mask/i.test(chip), chip);
    let rec = await ic();
    h.check('mask on recorded', rec.actions.some((a) => a.kind === 'mask_on' && a.at === 'mask_station'));
    // M: off by the loops, into the nearest bin
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(500);
    await shot('mask-fp-off');
    await untilIdle();
    await page.waitForTimeout(800);
    rec = await ic();
    h.check('M takes the mask off and bins it', !(await hy()).masked && rec.actions.some((a) => a.kind === 'mask_off'));
    // first person, putting one on at the walk-in stand
    await tp(4.4, 23.0, -90, -12);
    await page.waitForTimeout(1300);
    await ev(`__acWorld.use('mask:mask_walkin')`);
    await holdAt(0.95);
    await shot('mask-fp-1-take');
    await holdAt(1.6);
    await shot('mask-fp-2-up-to-the-face');
    await holdAt(null);
    await untilIdle();
    h.check('masked again (a fresh one)', (await hy()).masked);
    await page.keyboard.press('KeyM');
    await untilIdle();
  }

  if (want('precautions')) {
    // a bay on droplet precautions (none of the shipped cases needs it: forced here)
    await cam('first');
    await ev(`__acWorld.hygieneOp('precautions', { bed_2: 'droplet', bed_4: 'contact' })`);
    await page.waitForTimeout(300);
    const st = await hy();
    h.check('isolation stands go up at the rooms', st.stands.length === 2, JSON.stringify(st.stands));
    await tp(4.25, 9.3, -160, -12);
    await page.waitForTimeout(1300);
    await shot('precautions-droplet-stand');
    await tp(11.9, 9.3, -160, -12);
    await page.waitForTimeout(1300);
    await shot('precautions-contact-stand');
    // a mask from the droplet stand, then off again
    await tp(3.6, 8.3, 180, -14);
    await page.waitForTimeout(900);
    await ev(`__acWorld.use('mask:iso_bed_2')`);
    await untilIdle();
    h.check('a mask from the stand outside the droplet room', (await hy()).masked);
    await page.keyboard.press('KeyM');
    await untilIdle();
    // into Bed 2 without a mask: a nurse reminds you
    await tp(4.8, 7.6, 180, -6);
    await page.waitForTimeout(700);
    await tp(4.8, 6.0, 180, -6);
    await page.waitForTimeout(1200);
    const hint = await hintText();
    h.check('into a droplet room without a mask: the reminder', /droplet precautions: a mask on before you go in/.test(hint), hint);
    await shot('precautions-reminder', false);
    await ev(`__acWorld.hygieneOp('precautions', null)`);
  }

  if (want('debrief')) {
    // an examination with a rub before and none after, then the shift's end
    await cam('first');
    await ev(`__ac.client.act({ type: 'wait', minutes: 14 })`);
    await page.waitForTimeout(1500);
    await tp(12.05, 8.4, 180, -10);
    await page.waitForTimeout(1200);
    await ev(`__acWorld.use('rub:rub_bed_4_out')`);
    await untilIdle();
    await tp(13.0, 5.5, 0, -10);
    await page.waitForTimeout(1500);
    const r = await ev<{ ok: boolean; message?: string }>(`__ac.client.act({ type: 'examine', patientId: 'p_brunner', maneuver: 'abd_palpate' })`);
    h.check('examined Brunner in Bed 4', r.ok, r.message);
    await tp(12.05, 9.0, 180, -10);
    await page.waitForTimeout(800);
    await tp(21.0, 11.0, 0, -10);
    await page.waitForTimeout(1500);
    const rec = await ic();
    h.check('moment 1 met, moment 4 missed', rec.moment1.met >= 1 && rec.moment4.of >= 1 && rec.moment4.met < rec.moment4.of, JSON.stringify([rec.moment1, rec.moment4]));
    await ev(`__ac.client.act({ type: 'end_shift' })`);
    await page.waitForSelector('.debrief', { timeout: 30000 });
    await page.waitForTimeout(800);
    const sec = await page.$('.db-ic');
    h.check('the debrief has the infection-control section', !!sec);
    if (sec) {
      await sec.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await sec.screenshot({ path: `${out}/debrief-infection-control.png` });
      console.log(`📸 ${out}/debrief-infection-control.png`);
    }
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
  await page.close();

  if (want('restroom')) {
    // the all-gender restroom's long counter, third person: the coat's sleeves pushed up first; the
    // towels at the counter's end and the bin by the door out of reach, so you walk to each
    const r = await shift();
    const re = <T = unknown>(s: string) => r.page.evaluate(s) as Promise<T>;
    type Rh = { action: string | null; t: number | null; walking: string | null; legs: { kind: string; len: number; done: boolean; to: number[] }[] | null; bin: string | null; pos: number[]; sleeves: { ok: boolean; up: boolean[]; push: number | null }; wrists: (number[] | null)[] };
    const rh = () => re<Rh>('__acWorld.hygiene()');
    await re(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    await re(`__ac.store.set({ camera: 'third' })`);
    await re(`__acWorld.teleport(67.84, 2.45, -90, -20)`);
    await r.page.waitForTimeout(1500);
    // (the op builds the sleeves for the avatar first: nothing has asked for them yet)
    const sv = await re<{ ok: boolean; arms: Record<string, { up: boolean } | null> } | null>(`__acWorld.hygieneOp('sleeves')`);
    h.check('restroom: the coat’s sleeves can go up, and are down', !!sv?.ok && !sv.arms.R?.up && !sv.arms.L?.up, JSON.stringify(sv));
    await re(`__acWorld.use('wash:rr_vanity#2')`);
    await r.page.waitForTimeout(250);
    const s2 = await rh();
    h.check('restroom: the sleeves go up before the wash starts', s2.action === 'wash' && s2.sleeves.push !== null && (s2.t ?? 0) === 0, JSON.stringify({ t: s2.t, sleeves: s2.sleeves }));
    h.check('restroom: walks to the towels at the counter’s end, then to the bin by the door', !!s2.legs && s2.legs.length === 2 && s2.legs[0].kind === 'towel' && s2.legs[1].kind === 'bin' && s2.bin === 'rr_trash', JSON.stringify({ legs: s2.legs, bin: s2.bin }));
    // the whole wash, sampled: how fast you move, where your hands are while you walk
    let fastest = 0;
    let handsBack = Infinity;
    const walked = new Set<string>();
    let prev: { at: number[]; ms: number } | null = null;
    let last = s2;
    let pulledDown = false;
    for (let i = 0; i < 900; i++) {
      const s = await rh();
      if (!s.action) break;
      if (s.action === 'sleevesDown') pulledDown = true;
      last = s;
      const ms = Date.now();
      if (s.walking) {
        walked.add(s.walking);
        for (const w of s.wrists) if (w) handsBack = Math.min(handsBack, w[0]);
        if (prev && ms > prev.ms) fastest = Math.max(fastest, Math.hypot(s.pos[0] - prev.at[0], s.pos[1] - prev.at[1]) / ((ms - prev.ms) / 1000));
      }
      prev = { at: s.pos, ms };
      await r.page.waitForTimeout(40);
    }
    h.check('restroom: walked to the towels and to the bin at a walking pace (no sliding)', walked.has('towel') && walked.has('bin') && fastest > 0.3 && fastest < 1.7, `${[...walked].join(', ')} · fastest ${fastest.toFixed(2)} m/s`);
    h.check('restroom: the hands in front of you while you walk', handsBack > 0.02, `${handsBack.toFixed(3)} m in front of the feet`);
    const end = await rh();
    h.check('restroom: the wash ends beside the bin, the sleeves pulled back down after it', !end.action && Math.hypot(end.pos[0] - 67.45, end.pos[1] - 6.2) < 0.75 && pulledDown && !end.sleeves.up.some(Boolean), JSON.stringify({ pos: end.pos, last: last.t, pulledDown, sleeves: end.sleeves.up }));
    // first person at the counter's other end: stood where the arm reaches the towels (from where the
    // third person stands it didn't: straight out, its shoulder pulled after the hand), the fingertips
    // closing on the tail
    await re(`__ac.store.set({ camera: 'first' })`);
    await re(`__acWorld.teleport(67.84, 4.25, -90, -20)`);
    await r.page.waitForTimeout(1500);
    await re(`__acWorld.hygieneOp('hold', ${WASH_GRAB})`);
    await re(`__acWorld.use('wash:rr_vanity#0')`);
    for (let i = 0; i < 600; i++) {
      const s = await rh();
      if (s.action && !s.walking && (s.t ?? 0) >= WASH_GRAB - 0.006) break;
      await r.page.waitForTimeout(25);
    }
    await r.page.waitForTimeout(300);
    const fpg = await re<{ fpArm: FpArm | null; wash: WashDbg | null }>('__acWorld.hygiene()');
    const ftt = fpg.wash?.towel?.tipsToTail;
    const fover = overReach(fpg.fpArm);
    h.check('restroom, first person: walked to the towels, the arm within reach of them, thumb and index on the tail', fover <= 0.02 && !!ftt && ftt.index <= 0.02 && ftt.thumb <= 0.02, `${(fover * 100).toFixed(1)} cm beyond its reach · ${JSON.stringify(ftt)}`);
    await re(`__acWorld.hygieneOp('hold', null)`);
    for (let i = 0; i < 600 && (await rh()).action; i++) await r.page.waitForTimeout(50);
    await r.page.waitForTimeout(800);
    const rr = await re<Ic>(`fetch('/api/sessions/' + __ac.store.get().view.sessionId + '/debrief').then((x) => x.json()).then((d) => d.infectionControl)`);
    h.check('restroom: the wash reached the server', rr.actions.some((a) => a.kind === 'wash' && a.at === 'rr_vanity#2'), JSON.stringify(rr.actions));
    const rerr = r.errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
    h.check('no page errors (restroom)', rerr.length === 0, rerr.slice(0, 4).join(' | '));
    await r.page.close();
  }

  if (want('wash-female')) {
    // the same wash with a woman's hands (Medical_Female_02)
    const f = await shift('&playerAvatar=Medical_Female_02');
    await washRun(f.page, 'female');
    const fr = f.errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
    h.check('no page errors (female wash)', fr.length === 0, fr.slice(0, 4).join(' | '));
    await f.page.close();
  }

  if (want('female')) {
    // a woman's face: the mask's drape and loops on Medical_Female_02 (the dev aid ?playerAvatar)
    const f = await shift('&playerAvatar=Medical_Female_02');
    const fe = <T = unknown>(s: string) => f.page.evaluate(s) as Promise<T>;
    await fe(`__ac.store.set({ camera: 'third' })`);
    await fe(`__acWorld.teleport(15.62, 11.62, 90, -10)`);
    await f.page.waitForTimeout(2500);
    await fe(`__acWorld.use('mask:mask_station')`);
    for (let i = 0; i < 80 && (await fe<Hy>('__acWorld.hygiene()')).action; i++) await f.page.waitForTimeout(100);
    await f.page.waitForTimeout(600);
    h.check('her mask is on', (await fe<Hy>('__acWorld.hygiene()')).maskOnFace);
    await f.page.addStyleTag({ content: '.hud, .toasts, .wl-hint { visibility: hidden !important; }' });
    for (const [name, o] of [
      ['mask-female-front', { around: 'head', yaw: 0, pitch: 0, dist: 0.55, fov: 32 }],
      ['mask-female-side', { around: 'head', yaw: 90, pitch: 0, dist: 0.55, fov: 32 }],
      ['mask-female-three-quarter', { around: 'head', yaw: -40, pitch: 8, dist: 0.6, fov: 32 }],
    ] as [string, Record<string, number | string>][]) {
      await fe(`__acWorld.amenity('cam', ${JSON.stringify(o)})`);
      await f.page.waitForTimeout(500);
      await f.page.screenshot({ path: `${out}/${name}.png` });
      console.log(`📸 ${out}/${name}.png`);
    }
    const fr = f.errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
    h.check('no page errors (female player)', fr.length === 0, fr.slice(0, 4).join(' | '));
    await f.page.close();
  }
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);

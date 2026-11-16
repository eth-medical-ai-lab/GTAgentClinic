/**
 * Bed positions on the real GPU: the articulated beds (client/src/world/bedRig.ts), the patient on
 * them (avatars.ts layInBed), the blanket (bedding.ts) and the bedside pose (care.ts), driven by the
 * server's bed position (server/sim/bedPosition.ts).
 *
 *  - each case's patient at its default (Night Shift, seed 2024: STEMI 45°, AF 60° while the rate is
 *    fast, urosepsis 35°, the ankle on the stretcher's edge and then, after ice and elevation, reclined
 *    with the right leg on a pillow; Orientation: appendicitis 30° with the knees bent), and a ward bed
 *    upstairs. For each: the backrest within ±5° of the server's angle and the trunk turned up with it
 *    (±5°); the hip joints at the backrest's crease (on its bisector within 2 cm); no body part through
 *    the mattress (its foam may give 2 cm), the side rails or the boards (CPU-skinned); the blanket over
 *    the body with nothing through it; the bedside pose's targets (the gaze's face, the chest) within
 *    5 cm of the face and the sternum on the skin. Screenshots from the side and the foot.
 *  - a transition: an abdominal exam lays Bed 4 flat (knees bent), then she goes back up
 *  - the bedside pose at a patient sitting up: turned to them, a palm on the rail, an exam's hand on the
 *    chest, nothing clipping; an NPC doctor's (the AI doctor's code path) too
 *  - the frame rate with every bed's shapes out of the static merge
 *  - no z-fighting on a bed or a stretcher with its backrest at 45° and 80° (tests/zfight-scan.ts)
 *
 *   npx tsx tests/bed-position-e2e.ts [outDir] [--only=cases,transition,care,npc,ankle,ward,perf,zfight,appendix] [--port-base=8300]
 *
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'shots/bedpos');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 8300);
mkdirSync(out, { recursive: true });

type V3 = [number, number, number];
interface BedPos {
  headDeg: number;
  sitting?: 'edge' | 'upright';
  knees?: boolean;
  legUp?: 'L' | 'R';
  reason?: string;
}
interface InBed {
  bed: string;
  headDeg: number;
  goalDeg: number;
  moving: boolean;
  trunkTilt: number;
  trunkRise: number;
  hip: { along: number; over: number; offBisector: number };
  into: { mattress: number; rails: number; boards: number; deepest: { mattress: Record<string, { d: number; at: number[] }>; rails: Record<string, { d: number }>; boards: Record<string, { d: number }> } };
  blanket: { least: number; at: number[]; cells: number } | null;
  face: V3 | null;
  chest: V3 | null;
  back: { low: { u: number; h: number }; up: { u: number; h: number }; trunkDeg: number };
  aims: { face: number | null; chest: number | null };
  feetPastEnd: number;
  legPillow: V3 | null;
  server: BedPos | null;
  posture: string;
}
interface Bed {
  id: string;
  head: number;
  goal: number;
  moving: boolean;
  x: number;
  y: number;
  z: number;
  rot: number;
  footStep?: V3 | null;
}

const h = await startHarness({ portBase, dev: true });
const dist = (a: number[] | null | undefined, b: number[] | null | undefined) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);

/** a page with a shift started (seeded), the HUD hidden for pictures, the shift's clock stood still once everyone is in */
async function shift(title: string, minutes: number): Promise<{ page: Page; errors: string[] }> {
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // other edits in the tree mid-run must not hot-reload the world under the test
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high&seed=2024`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click(`text=${title}`);
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.evaluate(`__ac.client.act({ type: 'wait', minutes: ${minutes} })`);
  await page.waitForTimeout(2500);
  await page.evaluate(`__ac.client.settings({ paused: true })`);
  await page.addStyleTag({ content: '.toasts, .wl-hint { visibility: hidden !important; }' });
  await page.evaluate(`__ac.store.set({ camera: 'third' })`);
  return { page, errors };
}

try {
  const { page, errors } = await shift('Night Shift', 35);
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const hideHud = (on: boolean) => ev(`document.querySelectorAll('.hud, .wl-crosshair, .wl-layer, .tablet, .npc-panel').forEach((e) => (e.style.visibility = '${on ? 'hidden' : ''}'))`);
  const shot = async (name: string, p: Page = page) => {
    await p.evaluate(`document.querySelectorAll('.hud, .wl-crosshair, .wl-layer, .tablet, .npc-panel').forEach((e) => (e.style.visibility = 'hidden'))`);
    await p.waitForTimeout(120);
    const f = `${out}/${name}.png`;
    await p.screenshot({ path: f });
    await p.evaluate(`document.querySelectorAll('.hud, .wl-crosshair, .wl-layer, .tablet, .npc-panel').forEach((e) => (e.style.visibility = ''))`);
    console.log(`📸 ${f}`);
  };
  void hideHud;
  const npcOf = (p: Page, room: string) => p.evaluate(`(() => { const n = __ac.store.get().view.npcs.find((x) => x.role === 'patient' && x.location === '${room}'); return n ? n.id : null; })()`) as Promise<string | null>;
  const bedOf = async (p: Page, id: string) => (await p.evaluate(`__acWorld.beds()`) as Bed[]).find((b) => b.id === id)!;
  /** a point in a bed's frame (x across, z toward the foot) in the world */
  const world = (b: Bed, lx: number, ly: number, lz: number): V3 => [b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot), b.y + ly, b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot)];
  /** a fixed third-person camera from the bed's side (s: which side) and from its foot */
  const views = (b: Bed, s = 1): { side: [V3, V3]; foot: [V3, V3] } => ({ side: [world(b, s * 1.85, 1.45, 0.15), world(b, 0, 0.9, -0.15)], foot: [world(b, 0.25, 1.6, 2.9), world(b, 0, 0.8, -0.3)] });
  const fix = (p: Page, v: [V3, V3] | null) => p.evaluate(`__acWorld.cam(${JSON.stringify(v?.[0] ?? null)}, ${JSON.stringify(v?.[1] ?? null)})`);
  /** the server's position as expected (the view in), the patient's bed done moving there; then its numbers */
  const settled = async (p: Page, id: string, expect?: Partial<BedPos>, ms = 15000): Promise<InBed | null> => {
    type Quick = { server: BedPos | null; goal: number; moving: boolean } | null;
    const t0 = Date.now();
    let r: InBed | null = null;
    while (Date.now() - t0 < ms) {
      r = (await p.evaluate(`__acWorld.inBed('${id}')`)) as InBed | null;
      const q: Quick = r ? { server: r.server, goal: r.goalDeg, moving: r.moving } : null;
      const matches = !!q?.server && (!expect || Object.entries(expect).every(([k, v]) => (q.server as unknown as Record<string, unknown>)[k] === v));
      if (q && matches && !q.moving && Math.abs(q.goal - q.server!.headDeg) < 0.5) break;
      await p.waitForTimeout(250);
    }
    // (the body and its blanket a moment to catch up)
    await p.waitForTimeout(700);
    return (await p.evaluate(`__acWorld.inBed('${id}')`)) as InBed | null;
  };
  /** the numbers every patient in bed must meet */
  const judge = async (p: Page, label: string, id: string, expect?: Partial<BedPos>) => {
    const r = await settled(p, id, expect);
    h.check(`${label}: lying in an articulated bed`, !!r && !!r.server, JSON.stringify(r?.server));
    if (!r || !r.server) return null;
    if (expect) h.check(`${label}: the server's position (${JSON.stringify(expect)})`, Object.entries(expect).every(([k, v]) => (r.server as unknown as Record<string, unknown>)[k] === v), JSON.stringify(r.server));
    const goal = r.server.headDeg;
    h.check(`${label}: the backrest within ±5° of the server's ${goal}°`, Math.abs(r.headDeg - goal) <= 5, `${r.headDeg}° (${r.server.reason})`);
    // the trunk as it lies, from the skin: the line touching the back at the sacrum and at the shoulder blades
    const trunk = goal + (r.server.sitting === 'upright' ? 9.74 : 0);
    h.check(`${label}: the back on the backrest at its angle (the line on the back's skin ±5°)`, Math.abs(r.back.trunkDeg - trunk) <= 5 && r.back.up.h < 0.025, `${r.back.trunkDeg}° (sacrum ${r.back.low.h} m, shoulder blades ${r.back.up.h} m over the mattress)`);
    h.check(`${label}: the hip joints at the crease (on its bisector ±2 cm)`, r.hip.offBisector <= 0.02 && Math.abs(r.hip.along) <= 0.14, `${r.hip.along} m along the bed from it, ${r.hip.over} m over the mattress, ${r.hip.offBisector} m off its bisector`);
    // (the hair under the pillow is soft and hidden: not a body part through the mattress)
    const body = Object.entries(r.into.deepest.mattress).filter(([k]) => !k.startsWith('hair:'));
    const deepest = body.reduce((a, [, v]) => Math.min(a, v.d), 0);
    h.check(`${label}: no body part through the mattress (its foam gives ≤ 2 cm)`, deepest >= -0.02, `${deepest} m${body.length ? ` (${body.slice(0, 2).map(([k, v]) => `${k} ${v.d}${deepest < -0.02 ? ` at ${JSON.stringify(v.at)}` : ''}`).join(', ')})` : ''}${deepest < -0.02 ? ` legs (knee, ankle, toes) ${JSON.stringify((r as unknown as { legs: unknown }).legs)}` : ''}`);
    h.check(`${label}: clear of the side rails and the boards`, r.into.rails >= -0.005 && r.into.boards >= -0.005, `rails ${r.into.rails} m, boards ${r.into.boards} m ${JSON.stringify(r.into.deepest.rails)}${JSON.stringify(r.into.deepest.boards)}`);
    h.check(`${label}: the feet on the mattress (not past its foot end)`, r.feetPastEnd <= 0, `${r.feetPastEnd} m past it`);
    h.check(`${label}: the blanket over the body, nothing through it`, !!r.blanket && r.blanket.cells > 60 && r.blanket.least > 0.002, JSON.stringify(r.blanket));
    // where care mode aims (care.ts): the gaze at the face, an exam at the chest
    h.check(`${label}: the bedside gaze within 5 cm of the face's skin`, r.aims.face !== null && r.aims.face <= 0.05, `${r.aims.face} m`);
    h.check(`${label}: the chest's exam point within 5 cm of the sternum`, r.aims.chest !== null && r.aims.chest <= 0.05, `${r.aims.chest} m`);
    // the visual audit round the bed (visualAudit.ts): the hands on the clothes, the head on the pillow, nothing sunk past 3 cm
    const bed = await bedOf(p, r.bed);
    type F = { who: string; kind: string; what: string; dist: number; detail: string };
    const a = (await p.evaluate(`__acWorld.audit(${JSON.stringify({ x: bed.x, z: bed.z, r: 1.3, y: bed.y })})`)) as { findings: F[] } | null;
    const mine = (a?.findings ?? []).filter((f) => f.who === id);
    const hands = mine.filter((f) => /^hand/.test(f.what));
    h.check(`${label}: the hands on the clothes, not inside the trunk (audit)`, !!a && !hands.some((f) => f.kind === 'clipping'), JSON.stringify(hands));
    h.check(`${label}: head, back and legs on the mattress and the pillow (audit: none sunk past 3 cm or unsupported)`, !!a && !mine.some((f) => f.kind === 'sunk' || f.kind === 'unsupported' || (f.kind === 'clipping' && !/^hand/.test(f.what))), JSON.stringify(mine.map((f) => `${f.kind} ${f.what}: ${f.detail}`)));
    return r;
  };
  const pictures = async (p: Page, name: string, bedId: string, s = 1) => {
    const b = await bedOf(p, bedId);
    const v = views(b, s);
    await fix(p, v.side);
    await p.waitForTimeout(500);
    await shot(`${name}-side`, p);
    await fix(p, v.foot);
    await p.waitForTimeout(500);
    await shot(`${name}-foot`, p);
    // the hands close (on the belly once the backrest is up): from the side and from over the foot
    await fix(p, [world(b, s * 0.85, 1.5, 0.2), world(b, 0, 0.88, -0.2)]);
    await p.waitForTimeout(400);
    await shot(`${name}-hands-side`, p);
    await fix(p, [world(b, s * 0.15, 1.55, 0.6), world(b, 0, 0.86, -0.2)]);
    await p.waitForTimeout(400);
    await shot(`${name}-hands-top`, p);
    await fix(p, null);
  };
  await ev(`__acWorld.teleport(26, 10, 0, -8)`);
  for (const c of ['bed_2', 'bed_3', 'bed_4']) await ev(`__acWorld.curtain('${c}', 'snap-open')`);
  await page.waitForTimeout(1200);
  const keller = (await npcOf(page, 'bed_2'))!;
  const kellner = (await npcOf(page, 'bed_3'))!;
  const brunner = (await npcOf(page, 'bed_4'))!;
  const okafor = (await npcOf(page, 'ft_1'))!;

  // ───────── each case at its default ─────────
  if (want('cases')) {
    await judge(page, 'STEMI (Bed 2)', keller, { headDeg: 45, reason: 'case default' });
    await pictures(page, 'stemi-45', 'bed_2_bed');
    await judge(page, 'AF with RVR (Bed 3)', kellner, { headDeg: 60 });
    await pictures(page, 'afib-60', 'bed_3_bed');
    await judge(page, 'urosepsis (Bed 4)', brunner, { headDeg: 35 });
    await pictures(page, 'urosepsis-35', 'bed_4_bed');
    // the ankle waits on the stretcher's edge, the backrest up behind him
    const o = (await ev(`__acWorld.npc('${okafor}')`)) as { posture: string; seatKind: string; x: number; z: number } | null;
    const ft = await bedOf(page, 'ft_1_bed');
    h.check('ankle sprain (Fast Track 1): sitting on the stretcher’s edge, on its seat (toward the foot of the crease)', o?.posture === 'sit' && o.seatKind === 'bed' && Math.abs(ft.head - 30) < 1, JSON.stringify({ o, head: ft.head }));
    // his feet don't reach the floor: on a step stool
    let step: V3 | null = null;
    for (let i = 0; i < 20 && !step; i++) {
      await page.waitForTimeout(200);
      step = ((await bedOf(page, 'ft_1_bed')) as Bed & { footStep: V3 | null }).footStep;
    }
    const toes = ((await ev(`__acWorld.npc('${okafor}')`)) as { toes: V3[] }).toes;
    const soles = Math.min(...toes.map((t) => t[1])) - 0.025;
    h.check('ankle sprain on the edge: his feet on a step stool (the soles on its top ±2 cm)', !!step && Math.abs(step[1] - soles) <= 0.02, `step ${JSON.stringify(step)}, soles ~${soles.toFixed(3)} m up`);
    await pictures(page, 'ankle-edge', 'ft_1_bed');
  }

  // ───────── a transition: flat for the abdominal exam, then back up ─────────
  if (want('transition')) {
    const pid = (await ev(`__ac.store.get().view.npcs.find((n) => n.id === '${brunner}').patientId`)) as string;
    const before = await bedOf(page, 'bed_4_bed');
    await ev(`__ac.client.act({ type: 'examine', patientId: '${pid}', maneuver: 'abd_palpate' })`);
    const b4 = await bedOf(page, 'bed_4_bed');
    const v = views(b4);
    await fix(page, v.side);
    // half way down
    let mid: Bed | null = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);
      mid = await bedOf(page, 'bed_4_bed');
      if (mid.goal === 0 && mid.head < before.head * 0.6) break;
    }
    await shot('transition-1-going-flat');
    const flat = await judge(page, 'urosepsis, abdominal exam', brunner, { headDeg: 0, knees: true, reason: 'abdominal exam' });
    h.check('the transition took a few seconds (eased, not a snap)', !!mid && mid.head > 2 && mid.head < before.head - 2, `${before.head}° → ${mid?.head}° on the way`);
    void flat;
    await fix(page, v.side);
    await page.waitForTimeout(300);
    await shot('transition-2-flat-knees-side');
    await fix(page, v.foot);
    await page.waitForTimeout(300);
    await shot('transition-2-flat-knees-foot');
    // two game minutes on: back up
    await ev(`__ac.client.act({ type: 'wait', minutes: 3 })`);
    // (her own position now: the case's 35°, or what her vitals call for by then)
    let after: BedPos | null = null;
    for (let i = 0; i < 20 && (!after || after.reason === 'abdominal exam'); i++) {
      await page.waitForTimeout(150);
      after = (await ev(`__ac.store.get().view.npcs.find((n) => n.id === '${brunner}').bedPosition`)) as BedPos;
    }
    const up = await judge(page, 'urosepsis, back up after the exam', brunner, { reason: after?.reason });
    h.check('back up after the exam', !!up && up.server?.reason !== 'abdominal exam' && (up.server?.headDeg ?? 0) > 20, JSON.stringify(up?.server));
    await fix(page, v.side);
    await page.waitForTimeout(300);
    await shot('transition-3-back-up');
    await fix(page, null);
  }

  // ───────── the bedside pose at a patient sitting up ─────────
  if (want('care')) {
    type Care = { phase: string; off?: number; w?: number; kind?: string; rail?: { gap: number | null } | null; exam?: { maneuver: string; w: number; gap: number | null } | null };
    // walked into the bay, stopped a step from the bed's foot on its right (as body-e2e comes to Bed 4)
    await ev(`__acWorld.teleport(10.9, 4.3, 200, -8)`);
    await page.waitForTimeout(800);
    await ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${kellner}', tab: 'talk' }, tabletMin: false })`);
    let c: Care = { phase: 'off' };
    for (let i = 0; i < 80 && !(c.phase === 'on' && (c.w ?? 0) > 0.97); i++) {
      await page.waitForTimeout(100);
      c = (await ev('__acWorld.care()')) as Care;
    }
    await page.waitForTimeout(500);
    c = (await ev('__acWorld.care()')) as Care;
    h.check('bedside (AF, 60°): at his side, turned to him (±20°)', c.phase === 'on' && c.kind === 'side' && (c.off ?? 99) <= 20, JSON.stringify({ phase: c.phase, kind: c.kind, off: c.off }));
    h.check('bedside (AF, 60°): a palm on the rail’s top (≤ 4 cm)', !!c.rail && c.rail.gap !== null && c.rail.gap <= 0.04, JSON.stringify(c.rail));
    type Clear = { vertices: number; worst: Record<string, { gap: number; bone: string }> } | null;
    const clear = async (label: string) => {
      const cl = (await ev('__acWorld.careClearance()')) as Clear;
      const bad = Object.entries(cl?.worst ?? {}).filter(([k, v]) => (k === 'restHandOnRail' ? v.gap < -0.02 : v.gap < -0.01));
      h.check(`${label}: no clipping into the bed, rails, patient or curtains`, !!cl && bad.length === 0, bad.map(([k, v]) => `${k} ${v.gap} m (${v.bone})`).join(', ') || `${cl?.vertices} vertices clear`);
    };
    await clear('bedside (AF, 60°)');
    const b3 = await bedOf(page, 'bed_3_bed');
    await fix(page, [world(b3, 1.9, 1.55, 0.9), world(b3, 0, 1.0, -0.2)]);
    await page.waitForTimeout(400);
    await shot('care-afib-60-bedside');
    // the stethoscope to his chest, up where the backrest has it
    await ev(`__acWorld.careExam('cv_auscultate')`);
    let best = Infinity;
    let e: Care['exam'] = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(60);
      e = ((await ev('__acWorld.care()')) as Care).exam ?? null;
      if (e?.gap !== null && e?.gap !== undefined && e.w > 0.9) best = Math.min(best, e.gap);
    }
    h.check('bedside (AF, 60°): the stethoscope on his chest (≤ 5 cm)', best <= 0.05, `${best.toFixed(3)} m`);
    await clear('bedside (AF, 60°), listening to the heart');
    await fix(page, [world(b3, 1.9, 1.55, 0.9), world(b3, 0, 1.0, -0.2)]);
    await page.waitForTimeout(150);
    await shot('care-afib-60-auscultation');
    await fix(page, null);
    await page.waitForTimeout(2500);
    await ev(`__ac.store.set({ panel: null })`);
    await page.waitForTimeout(500);
  }

  // ───────── an NPC doctor at a bedside (the AI doctor's code path) ─────────
  if (want('npc')) {
    type NC = { patient: string; w: number; exam: string | null; examW: number; gap: number | null; far: boolean } | null;
    const nurse = (await ev(`(() => { const v = __ac.store.get().view; const ids = __acWorld.npcIds(); const n = v.npcs.find((x) => ['nurse', 'tech', 'resident'].includes(x.role) && x.visible && ids.includes(x.id)); return n ? n.id : null; })()`)) as string | null;
    h.check('an NPC for the bedside pose', !!nurse, String(nurse));
    if (nurse) {
      await ev(`__acWorld.careNpc('${nurse}')`);
      await ev(`__acWorld.teleport(16.5, 5.6, 200, -8)`);
      await ev(`__acWorld.standNpc('${nurse}', 6.74, 2.1, 225)`);
      let nc: NC = null;
      for (let i = 0; i < 60 && !(nc && nc.w > 0.95); i++) {
        await page.waitForTimeout(150);
        nc = (await ev(`__acWorld.npcCare('${nurse}')`)) as NC;
      }
      h.check('an NPC doctor at the bedside of a patient at 45° takes the pose', !!nc && nc.w > 0.95 && nc.patient === keller, JSON.stringify(nc));
      await ev(`__acWorld.npcExam('${nurse}', 'cv_auscultate')`);
      let gap = Infinity;
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(150);
        nc = (await ev(`__acWorld.npcCare('${nurse}')`)) as NC;
        if (nc?.examW === 1 && nc.gap !== null) gap = Math.min(gap, nc.gap);
      }
      h.check('an NPC doctor: the stethoscope gets to the raised chest (≤ 5 cm)', gap <= 0.05, `${gap.toFixed(3)} m ${JSON.stringify(nc)}`);
      const b2 = await bedOf(page, 'bed_2_bed');
      await fix(page, [world(b2, -1.8, 1.55, 0.6), world(b2, 0, 1.0, -0.2)]);
      await page.waitForTimeout(250);
      await shot('npc-doctor-stemi-45');
      await fix(page, null);
    }
  }

  // ───────── the ankle after ice and elevation: on the stretcher, the right leg up on a pillow ─────────
  if (want('ankle')) {
    const pid = (await ev(`__ac.store.get().view.npcs.find((n) => n.id === '${okafor}').patientId`)) as string;
    const ordered = (await ev(`__ac.client.act({ type: 'order', patientId: '${pid}', code: 'ice_elevate' })`)) as { ok: boolean; message?: string };
    h.check('ankle: ice and elevation ordered', !!ordered?.ok, JSON.stringify(ordered));
    let pos: BedPos | null = null;
    for (let i = 0; i < 60 && !pos?.legUp; i++) {
      await ev(`__ac.client.act({ type: 'wait', minutes: 1 })`);
      await page.waitForTimeout(300);
      pos = (await ev(`__ac.store.get().view.npcs.find((n) => n.id === '${okafor}').bedPosition`)) as BedPos;
    }
    const r = await judge(page, 'ankle sprain after ice and elevation', okafor, { headDeg: 40, legUp: 'R' });
    h.check('ankle: a pillow under the raised right leg', !!r?.legPillow && r.legPillow[0] < 0, JSON.stringify(r?.legPillow));
    await pictures(page, 'ankle-leg-up', 'ft_1_bed');
  }

  // ───────── a ward bed upstairs ─────────
  if (want('ward')) {
    const wardBeds = ((await ev(`__acWorld.beds()`)) as Bed[]).filter((b) => b.y > 1);
    const w = (await ev(`__acWorld.wardPatients()`)) as { id: string; x: number; z: number; level: number }[];
    const y = wardBeds[0]?.y ?? 3;
    for (const [pid, room, name] of [['ward_pt_202', 'f2_room_202_bed', 'ward-202-heart-failure-45'], ['ward_pt_204', 'f2_room_204_bed', 'ward-204-leg-up-20']] as const) {
      const p = w.find((x) => x.id === pid);
      const b = wardBeds.find((x) => x.id === room);
      h.check(`ward: ${pid} in ${room}`, !!p && !!b, JSON.stringify({ p, b }));
      if (!p || !b) continue;
      // up there (the ward draws, its people animate, while you are on its storey)
      await ev(`__acWorld.teleportY(${world(b, 1.4, 0, 0.6)[0]}, ${world(b, 1.4, 0, 0.6)[2]}, ${y}, 0, -8)`);
      await page.waitForTimeout(2500);
      await judge(page, `ward ${pid.slice(-3)}`, pid);
      await pictures(page, name, room, 1);
    }
    await ev(`__acWorld.teleportY(26, 10, 0, 0, -8)`);
    await page.waitForTimeout(1500);
  }

  // ───────── performance: every bed's shapes are their own meshes now ─────────
  if (want('perf')) {
    await ev(`__acWorld.teleport(13.8, 6.4, 180, -6)`);
    await page.waitForTimeout(1500);
    const stats = (await ev(`__acWorld.renderStats()`)) as { calls: number; triangles: number } | null;
    const fps = (await ev(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); })`)) as number;
    console.log(`  perf: ${JSON.stringify(stats)} draw calls/triangles at the bays, ${fps} fps (1600×900, High)`);
    h.check('perf: frames keep coming (≥ 20 fps on High)', fps >= 20, `${fps} fps`);
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('Night Shift: no page errors', real.length === 0, real.slice(0, 4).join(' | '));
  await page.close();

  // ───────── no z-fighting on a bent bed: the project's scan (tests/zfight-scan.ts) of beds built with the backrest up ─────────
  if (want('zfight')) {
    const zp = await h.browser.newPage();
    await zp.routeWebSocket((u) => !u.pathname.startsWith('/ws'), () => undefined);
    await zp.goto(`${h.url}/?debug=1`);
    await zp.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
    const scan = `/@fs${path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'zfight-scan.ts')}`;
    for (const deg of [45, 80]) {
      type G = { tier: string; count: number; owners: string[]; example: { gap: number; area: number; a: { geo: string }; b: { geo: string } } };
      const res = (await zp.evaluate(`(async () => { const rig = await import('/src/world/bedRig.ts'); rig.buildBedsAt(${deg}); try { const m = await import(${JSON.stringify(scan)}); return await m.scan({ kinds: ['bed', 'stretcher'], world: false }); } finally { rig.buildBedsAt(0); } })()`)) as { groups: G[]; stats: Record<string, number> };
      const bad = res.groups.filter((g) => g.tier === 'zfight' || g.tier === 'near');
      h.check(`no z-fighting on a bed or a stretcher with its backrest at ${deg}°`, bad.length === 0, bad.length ? bad.map((g) => `${g.tier} ${g.count}× ${g.example.a.geo} × ${g.example.b.geo} gap ${(g.example.gap * 1000).toFixed(2)} mm`).join('; ') : JSON.stringify(res.stats));
    }
    await zp.close();
  }

  // ───────── appendicitis (Orientation): 30°, knees bent ─────────
  if (want('appendix')) {
    const s = await shift('Orientation Day', 8);
    const p = s.page;
    await p.evaluate(`__acWorld.teleport(26, 10, 0, -8)`);
    await p.evaluate(`__acWorld.curtain('bed_5', 'snap-open')`);
    await p.waitForTimeout(1500);
    const thompson = await npcOf(p, 'bed_5');
    h.check('a patient in Bed 5 (Orientation)', !!thompson, String(thompson));
    if (thompson) {
      await judge(p, 'appendicitis (Bed 5)', thompson, { headDeg: 30, knees: true, reason: 'case default' });
      await pictures(p, 'appendicitis-30-knees', 'bed_5_bed');
    }
    const real2 = s.errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
    h.check('Orientation: no page errors', real2.length === 0, real2.slice(0, 4).join(' | '));
    await p.close();
  }
} finally {
  await h.close();
}
console.log(h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all checks passed');
process.exit(h.failed() ? 1 : 0);

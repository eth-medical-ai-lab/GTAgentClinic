/**
 * Storyboards: every scripted scene filmed on the real GPU from fixed camera rigs (third person) and
 * from the player's eyes, at moments across its whole length, as one contact sheet per scene. Each
 * moment also gets a numeric audit (client/src/world/visualAudit.ts, sampled twice ≥ 0.5 s apart):
 * bodies and loose items resting on something, skin inside furniture or walls, a pusher's hands on
 * the handles. The checklist and the workflow rule: docs/VISUAL_QA.md.
 *
 *   npx tsx tests/storyboard.ts [--scene=faint,crowd] [outDir] [--port-base=8400] [--quality=high] [--list]
 *   npm run storyboard -- --scene=faint
 *
 * Writes <outDir>/<scene>.png (the sheet), <outDir>/<scene>/ (frames, sheet.html, audit.json,
 * findings.md) and <outDir>/index.md (every scene's findings). Default outDir: shots/storyboards.
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright';
import { CASES, SCENARIOS } from '../content/scenarios';
import { resolveScenario } from '../server/sim/shiftRoster';
import { planAmbient } from '../server/sim/ambient';
import { LAYOUTS } from '../shared/layout';
import { applyInput, playInputs } from '../agents/embodiedControls';
import { startHarness } from './harness';
import { checkMarcusRecording, checkDemoTouch, checkStaticRequests, checkTourDefaults, clipsPlayed, demoAnswer, startDemoHost, watchDemoSpeech } from './browser-demo-host';

const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'shots/storyboards');
const pick = args.find((a) => a.startsWith('--scene='))?.slice(8).split(',').filter(Boolean);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 8400);
const quality = args.find((a) => a.startsWith('--quality='))?.slice(10) ?? 'high';
const W = 1280;
const H = 720;

type V3 = [number, number, number];
type Region = { x: number; z: number; r: number; y?: number };

/** a camera: fixed in the world, beside an NPC, framed on the player, or the player's own eyes */
type Rig =
  | { name: string; pos: V3; at: V3 }
  /** beside an NPC (its frame: right, up, forward), looking at `look` m up, `aim` m in front of it */
  | { name: string; follow: string; off: V3; look?: number; aim?: number }
  | { name: string; around: 'head' | 'pelvis' | 'feet'; yaw: number; pitch: number; dist: number; fov?: number; up?: number }
  | { name: string; eyes: true; look?: V3 | string };

interface Finding {
  who: string;
  kind: string;
  what: string;
  dist: number;
  detail: string;
  /** seen in both samples (≥ 0.5 s apart) */
  persistent?: boolean;
}

interface Audit {
  ms: number;
  subjects: { id: string; posture: string; act?: string; moving: boolean; x: number; z: number; props: string[]; seg: Record<string, { low: V3; gap: number | null; on: string; rule?: string }> }[];
  items: { id: string; kind: string; label: string; at: V3; gap: number | null; on: string }[];
  findings: Finding[];
  stats: { tris: number; vertices: number; dynamicMeshes: number };
}

interface BeatRow {
  idx: number;
  label: string;
  /** scene clock (s at the default speed) and game clock */
  t: number | null;
  clock: string;
  frames: { rig: string; file: string | null }[];
  findings: Finding[];
  notes: string[];
  audits: (Audit | null)[];
}

interface Ctx {
  page: Page;
  ev<T = unknown>(js: string): Promise<T>;
  wait(ms: number): Promise<void>;
  /** film the rigs now (all, or the named ones; frames of a label already filmed join its row) */
  shoot(label: string, o?: { rigs?: string[]; region?: Region & { skin?: boolean }; t?: number | null; checks?: () => Promise<Finding[]>; target?: string }): Promise<void>;
  gameT(): Promise<number>;
  /** wait until the game clock reaches t (game s) */
  untilGameT(t: number, timeoutMs?: number): Promise<boolean>;
  cam(mode: 'first' | 'third'): Promise<void>;
  tp(x: number, z: number, yawDeg: number, pitchDeg?: number): Promise<void>;
  note(text: string): void;
  until(pred: () => Promise<boolean>, ms: number, step?: number): Promise<boolean>;
}

interface Scene {
  id: string;
  title: string;
  /** what it shows and what to look for */
  about: string;
  /** a feature another agent is changing: film it, report findings, don't fix here */
  owner?: string;
  map?: string;
  seed?: number;
  selectAtMenu?: (page: Page) => Promise<void>;
  region: Region;
  rigs: Rig[];
  /** keep the game's interface in frame when it is part of the scene */
  showUI?: boolean;
  /** the rigs a moment is filmed from unless it names its own (default: every rig) */
  defaults?: string[];
  run(c: Ctx): Promise<void>;
}

const HIDE = '.hud, .toasts, .wl-hint, .wl-crosshair, .wl-layer, .tablet, .tablet-dock, .ob-panel, .phone-overlay, .ehr-backdrop { visibility: hidden !important; }';
const deg = (r: number) => (r * 180) / Math.PI;

// ───────────────────────────── the faint (server/sim/ambient.ts planCollapse) ─────────────────────────────

/** a Night Shift seed with the waiting-room faint, and its key times (game s) from the plan itself */
function faintPlan() {
  const sc = SCENARIOS.night_shift;
  for (let seed = 1; seed < 400; seed++) {
    const p = planAmbient({ seed, mapId: sc.id, layout: LAYOUTS[sc.layoutId], durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart });
    if (!p || p.collapseAt === undefined || p.collapseAt > 100 * 60) continue;
    const pat = p.people.get('amb_faint')!.segs;
    const B = pat.find((s) => s.act === 'buckle')!.t0;
    // when security takes the corridor's wheelchair (s from the buckle)
    const takes = ((p.people.get('sec_dave')!.segs.find((s) => s.t0 > B && s.props?.includes('wheelchair'))?.t0 ?? B) - B) / sc.defaultTimeScale;
    return { seed, tc: p.collapseAt, B, scale: sc.defaultTimeScale, pat, end: pat[pat.length - 1].t1, takes };
  }
  throw new Error('no Night Shift seed with a faint in the first 100 minutes');
}

const FALL = { x: 5.75, z: 22.6 };

const faint: Scene = {
  id: 'faint',
  title: 'Waiting room: a vasovagal faint',
  about:
    'Walks in pale, knees buckle, sinks to the floor; friend shouts; security kneels and radios; the nurse checks him, keeps him flat with the legs raised (on something, or held); he comes round, the legs come down, he sits up, is helped up, sits into the wheelchair and is pushed away seated. Look for: legs resting on a support, kneelers on their knees (not floating), the wheelchair under him while he is pushed, the pusher’s hands on the handles.',
  map: 'night_shift',
  region: { x: 5.9, z: 22.2, r: 3.2 },
  rigs: [
    // low from his left (west, between the last row of chairs and the wall): the team on his right faces it
    { name: 'side', pos: [3.3, 1.15, 22.45], at: [6.0, 0.4, 22.15] },
    { name: 'high', pos: [3.2, 2.45, 19.45], at: [5.95, 0.25, 22.3] },
    { name: 'eyes', eyes: true, look: [5.9, 0.45, 22.3] },
    // in front of him once he is wheeled away (his frame: right, up, forward)
    { name: 'ride', follow: 'amb_faint', off: [0.45, 1.45, 2.4], look: 0.75 },
    // the corridor, where the wheelchair is parked by the waiting room's wall (8.6, 14.3)
    { name: 'corridor', pos: [5.6, 1.7, 12.9], at: [8.6, 0.6, 14.3] },
  ],
  defaults: ['side', 'high', 'eyes'],
  async run(c) {
    const f = faintPlan();
    faint.seed = f.seed;
    const at = (s: number) => f.B + s * f.scale;
    // to 10 s (real) before he walks in; the player watches from the east side of the room
    const target = f.tc - 10 * f.scale;
    let now = await c.gameT();
    while (target - now > 60) {
      const mins = Math.min(120, (target - now) / 60);
      await c.ev(`__ac.client.act({ type: 'wait', minutes: ${mins.toFixed(3)} })`);
      await c.wait(400);
      now = await c.gameT();
    }
    await c.cam('first');
    await c.tp(8.4, 17.6, deg(Math.atan2(FALL.x - 8.4, FALL.z - 17.6)), -12);
    c.note(`seed ${f.seed}: he walks in at game ${(f.tc / 60).toFixed(1)} min, knees buckle at ${(f.B / 60).toFixed(2)} min`);
    const beats: [number, string, string[]?][] = [
      [-9, 'walks in, towel round his forearm'],
      [-3.5, 'prodrome: pale, unsteady'],
      [0.5, 'knees buckle', ['side', 'high']],
      [3, 'on the floor; friend shouts for help'],
      [7.5, 'security kneels, radios for a nurse'],
      [15, 'security with him; the nurse on her way'],
      [24, 'nurse kneels: response, breathing, pulse'],
      [31, 'nurse asks; friend answers'],
      [39.5, 'friend takes his ankles'],
      [+(f.takes + 1).toFixed(1), 'security takes the corridor wheelchair', ['corridor', 'high']],
      [44, 'legs raised, held (passive leg raise)'],
      [49, 'comes round, legs still held up'],
      [57, 'the wheelchair parked beside him, held'],
      [63.5, 'legs lowered'],
      [65.5, 'sits up slowly'],
      [67.2, 'helped up, a hand under his arm'],
      [68.5, 'a step to the wheelchair', ['side', 'high']],
      [69.8, 'turns, sits down into it'],
      [71.5, 'seated; nurse to the handles'],
      [74.5, 'pushed away, seated', ['side', 'high', 'ride']],
      [78, 'through the waiting room', ['high', 'ride', 'eyes']],
      [83, 'down the corridor', ['ride']],
      [88, 'the room settles', ['side', 'high', 'eyes']],
    ];
    for (const [s, label, rigs] of beats.sort((a, b) => a[0] - b[0])) {
      if (!(await c.untilGameT(at(s), 150000))) {
        c.note(`clock never reached +${s} s`);
        break;
      }
      const moving = s >= 74;
      const region = moving ? await npcRegion(c, 'amb_faint', 2.2) : label.startsWith('security takes') ? { x: 8.8, z: 14.3, r: 2 } : undefined;
      await c.shoot(label, {
        t: s,
        rigs,
        region,
        checks: s >= 69.8 && s < 86 ? () => wheelchairChecks(c) : undefined,
      });
    }
  },
};

async function npcRegion(c: Ctx, id: string, r: number): Promise<Region | undefined> {
  const n = await c.ev<{ x: number; z: number } | null>(`__acWorld.npc('${id}')`);
  return n ? { x: n.x, z: n.z, r } : undefined;
}

/** in the wheelchair: seated, hips over its seat, feet on its footrests (pushed or parked) */
async function wheelchairChecks(c: Ctx, patient = 'amb_faint'): Promise<Finding[]> {
  // (accessories.ts wheelchair: seat top 0.4975 m, centred 5 cm forward of its origin; footplates' tops 0.117 m)
  const r = await c.ev<{ posture: string; hasChair: boolean; pelvis: V3 | null; seat: V3 | null; toes: V3[]; plates: number | null; moving: boolean; pusher: string | null } | null>(`(() => {
    const n = __acWorld.npc('${patient}'); if (!n) return null;
    const v = __ac.store.get().view.npcs.find((x) => x.id === '${patient}');
    const b = __acWorld.bones('${patient}');
    const p = __acWorld.propOf('${patient}', 'wheelchair');
    const seat = p ? [p.at[0] + Math.sin(p.yaw) * 0.05, p.at[1] + 0.4975, p.at[2] + Math.cos(p.yaw) * 0.05] : null;
    return { posture: n.posture, hasChair: !!(v && v.ambient && v.ambient.props && v.ambient.props.includes('wheelchair')), pelvis: b ? b.Pelvis : null, seat, plates: p ? p.at[1] + 0.117 : null, toes: n.toes, moving: n.walking, pusher: v && v.ambient ? v.ambient.pushedBy || null : null };
  })()`);
  const out: Finding[] = [];
  if (!r) return out;
  if (!r.hasChair) return out;
  if (r.posture !== 'sit') out.push({ who: patient, kind: 'not-seated', what: 'wheelchair', dist: 0, detail: `posture "${r.posture}" with the wheelchair (it rolls in front of him as if he pushed it)${r.moving ? ', walking' : ''}`, persistent: true });
  if (r.pelvis && r.seat) {
    const dxz = Math.hypot(r.pelvis[0] - r.seat[0], r.pelvis[2] - r.seat[2]);
    const dy = r.pelvis[1] - r.seat[1];
    if (dxz > 0.12 || dy < 0.03 || dy > 0.16) out.push({ who: patient, kind: 'off-seat', what: 'pelvis', dist: +Math.max(dxz, Math.abs(dy - 0.09)).toFixed(3), detail: `pelvis ${(dxz * 100).toFixed(0)} cm from the seat centre, ${(dy * 100).toFixed(0)} cm above the seat top`, persistent: true });
  }
  if (r.plates !== null && r.toes.length) {
    const hi = Math.max(...r.toes.map((t) => Math.abs(t[1] - r.plates! - 0.02)));
    if (hi > 0.05) out.push({ who: patient, kind: 'feet-off-footrests', what: 'feet', dist: +hi.toFixed(3), detail: `toe joints ${r.toes.map((t) => t[1].toFixed(2)).join(', ')} m vs footrests ${r.plates.toFixed(2)} m`, persistent: true });
  }
  return out;
}

// ───────────────────────────── the other scenes ─────────────────────────────

/** the crowd scene's seed, and the moments its close-ups are filmed at (from the ambient plan) */
const CROWD_SEED = 11;
function crowdMoments() {
  const sc = SCENARIOS.night_shift;
  const p = planAmbient({ seed: CROWD_SEED, mapId: sc.id, layout: LAYOUTS[sc.layoutId], durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
  const quiet = p.collapseAt !== undefined ? p.collapseAt - 300 : Infinity;
  /** the first seated stretch (≥ 25 s, after 2 min, before the faint) doing `act` (null: anything but `not`) */
  const when = (id: string, act: string | null, not?: string) => {
    for (const s of p.people.get(id)?.segs ?? []) {
      if (s.posture !== 'sit' || s.t0 < 120 || s.t1 - s.t0 < 25 || s.t0 > quiet) continue;
      // the middle of the stretch: a time jump lands a little late
      if (act ? s.act === act : s.act !== not) return s.t0 + Math.min(60, (s.t1 - s.t0) / 2);
    }
    return null;
  };
  const out: { id: string; what: string; t: number }[] = [];
  const add = (id: string, what: string, t: number | null) => t !== null && out.push({ id, what, t });
  add('vis_2', 'face and hands, one skin tone', when('vis_2', null, '__'));
  add('amb_dog', 'texting, a phone in her hand', when('amb_dog', 'phone_text'));
  add('vis_3', 'paper folded on his lap', when('vis_3', null, 'read'));
  add('vis_3', 'reading the open paper', when('vis_3', 'read'));
  add('amb_cut_partner', 'paper folded on his lap', when('amb_cut_partner', null, 'read'));
  add('amb_cut_partner', 'reading the open paper', when('amb_cut_partner', 'read'));
  add('vis_1', 'laptop closed on her lap', when('vis_1', null, 'laptop'));
  add('vis_1', 'typing on the laptop', when('vis_1', 'laptop'));
  return out.sort((a, b) => a.t - b.t);
}

const crowd: Scene = {
  id: 'crowd',
  title: 'Waiting room: the crowd idling',
  about: 'People waiting early in the shift: phones, a broadsheet held open or folded on the lap, a laptop on a lap, a mask, a dog carrier, a walker; then close-ups of the readers, the laptop, the texter and one face against the hands. Look for: hands on what they hold, a phone in every texting hand, papers and laptops on the thighs (not floating, not through them), long hair outside the open paper, feet on the floor, nobody inside a chair, one skin tone per person.',
  map: 'night_shift',
  seed: CROWD_SEED,
  region: { x: 3.4, z: 19.6, r: 3.6 },
  rigs: [
    { name: 'aisle', pos: [6.4, 1.25, 19.55], at: [2.4, 0.75, 19.55] },
    { name: 'corner', pos: [8.7, 2.45, 16.1], at: [3.0, 0.6, 19.8] },
    { name: 'west', pos: [0.75, 1.3, 19.55], at: [4.0, 0.7, 19.55] },
    { name: 'eyes', eyes: true, look: [2.8, 0.85, 19.6] },
    // close-ups of whoever a moment is about (shoot's target): the face, the lap from the front and from the side
    { name: 'face', follow: '*', off: [0.1, 1.22, 0.62], look: 1.18, aim: 0.05 },
    { name: 'front', follow: '*', off: [0.12, 1.0, 1.15], look: 0.62, aim: 0.3 },
    { name: 'side', follow: '*', off: [0.72, 0.95, 0.72], look: 0.6, aim: 0.3 },
    // beside the head of someone reading: hair and face against the open paper
    { name: 'hair', follow: '*', off: [0.62, 1.38, 0.2], look: 1.12, aim: 0.18 },
  ],
  defaults: ['aisle', 'corner', 'west', 'eyes'],
  async run(c) {
    await c.cam('first');
    await c.tp(7.0, 17.2, -60, -10);
    await c.wait(2500);
    for (const [i, label] of ['settled', 'a few seconds on'].entries()) {
      await c.shoot(label, { t: i * 6, region: { ...crowd.region, skin: true } });
      await c.wait(4000);
    }
    // close-ups: jump to each moment (the plan is the server's own, same seed)
    await c.tp(9.5, 16.2, -90, -10);
    for (const m of crowdMoments()) {
      const now = await c.gameT();
      if (m.t > now + 30) {
        await c.ev(`__ac.client.act({ type: 'wait', minutes: ${((m.t - now) / 60).toFixed(3)} })`);
        await c.wait(6000);
      }
      const n = await c.ev<{ x: number; z: number } | null>(`__acWorld.npc('${m.id}')`);
      if (!n) {
        c.note(`${m.id} not there for "${m.what}"`);
        continue;
      }
      const act = await c.ev<string | null>(`(() => { const v = __ac.store.get().view.npcs.find((x) => x.id === '${m.id}'); return v && v.ambient ? v.ambient.act || null : null; })()`);
      await c.shoot(`${m.id}: ${m.what}${act ? ` (${act})` : ''}`, { rigs: [act === 'read' ? 'hair' : 'face', 'front', 'side'], target: m.id, region: { x: n.x, z: n.z, r: 1.2, skin: true }, t: null });
    }
  },
};

const rollator: Scene = {
  id: 'rollator',
  title: 'Waiting room: the man with a rollator',
  about: 'Harold (amb_walker) gets up, walks with his rollator across the room and turns, stands, then sits down in another chair. Look for: both hands on the grips while he walks, turns and stands; the rollator a step ahead of his hips, turning with him, its wheels rolling; seated, the rollator parked beside his chair, not across his knees.',
  map: 'night_shift',
  seed: CROWD_SEED,
  region: { x: 3.4, z: 19.6, r: 3.6 },
  rigs: [
    { name: 'side', follow: 'amb_walker', off: [-1.5, 1.15, 0.5], look: 0.75, aim: 0.3 },
    { name: 'front', follow: 'amb_walker', off: [0.5, 1.25, 1.9], look: 0.8, aim: 0.3 },
    { name: 'corner', pos: [8.7, 2.45, 16.1], at: [3.4, 0.6, 19.8] },
  ],
  async run(c) {
    await c.cam('first');
    await c.tp(9.5, 16.2, -90, -10);
    await c.wait(1500);
    const at = async () => c.ev<{ x: number; z: number; yaw: number; posture: string; walking: boolean } | null>(`__acWorld.npc('amb_walker')`);
    const me = await at();
    if (!me || me.posture !== 'sit') {
      c.note(`amb_walker is not seated in the waiting room (${JSON.stringify(me)})`);
      return;
    }
    const near = async (r = 1.8): Promise<Region> => {
      const n = await at();
      return { x: n?.x ?? 3.4, z: n?.z ?? 19.6, r };
    };
    await c.shoot('seated, the rollator parked beside his chair', { region: await near(), t: null });
    // up and across the room's east aisle, turning to face back down it
    await c.ev(`__acWorld.walkNpc('amb_walker', 6.3, 17.2, 90)`);
    await c.wait(1800);
    await c.shoot('getting up, hands to the grips', { region: await near(), t: null });
    await c.wait(1200);
    await c.shoot('walking', { region: await near(), t: null });
    await c.wait(1500);
    // (filmed on the way: walkNpc leaves the server's seat as his destination, so arriving would sit him back down there)
    await c.shoot('walking on, turning', { region: await near(), t: null });
    // then into a free chair: the first of the front row's with nobody in it or about to sit there
    const chair = await c.ev<{ x: number; z: number; rot: number } | null>(`(() => {
      const ids = __acWorld.npcIds();
      const busy = (x, z) => ids.some((id) => { const n = __acWorld.npc(id); return n && Math.hypot(n.x - x, n.z - z) < 0.45; });
      for (const z of [18.2, 20.9]) for (let i = 5; i >= 0; i--) { const x = 1.2 + i * 0.75; if (!busy(x, z) && !busy(x + 0.75, z) && !busy(x - 0.75, z)) return { x, z, rot: z < 19 ? 0 : Math.PI }; }
      return null;
    })()`);
    if (!chair) {
      c.note('no free chair with a free neighbour for the rollator');
      return;
    }
    // (the server still has him seated, so sitNpc walks him there, turns him and lowers him in: client-side)
    await c.ev(`__acWorld.sitNpc('amb_walker', ${chair.x}, ${chair.z}, ${(chair.rot * 180) / Math.PI})`);
    await c.wait(1600);
    await c.shoot('walking to a free chair', { region: await near(), t: null });
    await c.until(async () => {
      const n = await at();
      return !!n && n.posture === 'sit';
    }, 25000, 100);
    await c.shoot('turned, sitting down', { region: await near(), t: null });
    await c.until(async () => !(await at())?.walking, 8000, 100);
    await c.wait(1500);
    await c.shoot('seated, the rollator parked beside him', { region: await near(), t: null });
    c.note(`the chair he sits down in: ${chair.x.toFixed(2)}, ${chair.z.toFixed(2)}`);
  },
};

/** the crowd seed's first two calls of a name (server/sim/ambient.ts callScene): key times (game s) */
function callPlan() {
  const sc = SCENARIOS.night_shift;
  const p = planAmbient({ seed: CROWD_SEED, mapId: sc.id, layout: LAYOUTS[sc.layoutId], durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
  return {
    scale: sc.defaultTimeScale,
    calls: p.scenes
      .filter((s) => s.kind === 'call')
      .slice(0, 2)
      .map((s) => {
        const said = p.lines.filter((l) => l.scene === s.id && l.who === 'nurse').map((l) => l.t);
        return { id: s.id, t0: s.t0, up: s.lena[1].t0, fltUp: s.float[1].t0, call: said[0], greet: said[1] ?? said[0], go: s.lena[2].t0, door: s.lena[3].t0, home: s.lena[3].t1, gone: s.float[s.float.length - 1].t1 };
      }),
  };
}

const TRIAGE_DESK = { x: 13.65, z: 19.0 };
const CALLING = { x: 4.7, z: 15.95 };

const nurses: Scene = {
  id: 'nurses',
  title: 'Triage: the nurse at her desk, calling the next name',
  about:
    'Lena (rn_lena) at the triage desk, up out of her chair, to the waiting room’s corridor door with her clipboard, calling a name, greeting the patient, back to her desk and into her chair; then the stand-in (Jo Bauer, amb_float_rn) calling the next name while you are in triage. Look for: a chair under her (not sitting in the air), facing her screen; the chair left where it stands when she walks off; the clipboard in her hand while she calls, her eyes on it or on the room (not on her empty hands, not on the floor).',
  map: 'night_shift',
  seed: CROWD_SEED,
  region: { x: TRIAGE_DESK.x, z: TRIAGE_DESK.z, r: 1.4 },
  rigs: [
    { name: 'deskN', pos: [12.35, 1.5, 17.55], at: [13.8, 0.7, 19.0] },
    { name: 'deskS', pos: [12.3, 1.45, 20.55], at: [13.8, 0.7, 19.0] },
    // low from the north, square to her side: hips on the seat, feet on the floor, knees under the desk
    { name: 'deskSide', pos: [13.55, 0.95, 17.75], at: [13.7, 0.55, 19.0] },
    { name: 'call', pos: [6.7, 1.5, 18.0], at: [4.7, 1.05, 16.0] },
    { name: 'callW', pos: [2.3, 1.6, 16.8], at: [4.7, 1.1, 15.95] },
    // in front of whoever the moment is about (shoot's target): face, hands and clipboard
    { name: 'nurse', follow: '*', off: [0.35, 1.45, 1.25], look: 1.15, aim: 0.15 },
    { name: 'eyes', eyes: true, look: [4.7, 1.2, 15.95] },
    { name: 'eyesDesk', eyes: true, look: [13.75, 0.85, 19.0] },
  ],
  defaults: ['deskN', 'deskS'],
  async run(c) {
    const { scale, calls } = callPlan();
    const [a, b] = calls;
    const s = (t: number, secs: number) => t + secs * scale;
    const t0 = Date.now();
    const mark = async (what: string) => c.note(`${what}: game ${(await c.gameT()).toFixed(0)} s, real +${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const jump = async (target: number) => {
      let now = await c.gameT();
      while (target - now > 60) {
        await c.ev(`__ac.client.act({ type: 'wait', minutes: ${Math.min(120, (target - now) / 60).toFixed(3)} })`);
        await c.wait(400);
        now = await c.gameT();
      }
    };
    /** who plays the nurse right now: whoever has the clipboard out */
    const nurse = async () =>
      c.ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v && v.npcs.find((x) => (x.id === 'rn_lena' || x.id === 'amb_float_rn') && x.ambient && x.ambient.props && x.ambient.props.includes('clipboard')); return n ? n.id : null; })()`);
    const at = async (id: string, r: number, fallback: { x: number; z: number }) => (await npcRegion(c, id, r)) ?? { ...fallback, r };
    c.note(`calls (game min): ${calls.map((k) => `${k.id} ${(k.t0 / 60).toFixed(1)}`).join(', ')}`);
    await c.cam('first');
    await c.tp(7.6, 17.3, -70, -8);
    // ── the first call: Lena (you are in the waiting room, she is free) ──
    await jump(a.t0 - 30);
    await c.untilGameT(s(a.t0, 5), 60000);
    const desk = await c.ev<{ seat: string | null; user: string | null } | null>(`(() => { const d = __acWorld.workstation().devices.find((x) => x.id === 'tr_pc'); return d ? { seat: d.seat, user: d.user } : null; })()`);
    c.note(`the triage computer's chair: ${desk?.seat ?? 'none'}; in use by: ${desk?.user ?? 'nobody'}`);
    await c.shoot('Lena at her desk', { t: null, target: 'rn_lena', rigs: ['deskN', 'deskS', 'deskSide'] });
    const beats: [number, string, string[], 'desk' | 'call' | 'her'][] = [
      [s(a.up, 0.9), 'up out of her chair', ['deskN', 'deskS', 'deskSide'], 'desk'],
      [s(a.up, 3.5), 'out of triage', ['deskN', 'nurse'], 'her'],
      [s(a.call, -1.5), 'at the door, reading the clipboard', ['call', 'nurse'], 'call'],
      [s(a.call, 0.6), 'calling the name', ['call', 'callW', 'nurse', 'eyes'], 'call'],
      [s(a.call, 3.5), 'waiting for them to come', ['call', 'nurse'], 'call'],
      [s(a.greet, 0.4), 'greeting the patient', ['call', 'callW', 'nurse'], 'call'],
      [s(a.go, 2.5), 'back toward triage', ['call', 'nurse'], 'her'],
      [s(a.door, 3.2), 'back at her desk', ['deskN', 'deskS', 'deskSide'], 'desk'],
      [s(a.home, 2), 'seated again', ['deskN', 'deskS', 'deskSide'], 'desk'],
    ];
    for (const [t, label, rigs, where] of beats) {
      if (!(await c.untilGameT(t, 90000))) {
        c.note(`clock never reached "${label}"`);
        break;
      }
      const who = (await nurse()) ?? 'rn_lena';
      const region = where === 'desk' ? { ...nurses.region } : where === 'call' ? { ...CALLING, r: 1.6 } : await at(who, 1.2, CALLING);
      await c.shoot(`${who === 'rn_lena' ? 'Lena' : who}: ${label}`, { t: null, rigs, target: who, region });
      if (label === 'back at her desk') {
        // the moment she sits back down (turned to her screen, into the chair from its side)
        const sits = await c.until(async () => (await c.ev<{ posture: string } | null>(`__acWorld.npc('rn_lena')`))?.posture === 'sit', 20000, 40);
        if (sits) await c.shoot('Lena: sitting back down', { t: null, rigs: ['deskN', 'deskS', 'deskSide'], target: 'rn_lena', region: { ...nurses.region } });
      }
    }
    // ── the second call: you are in triage, so the stand-in comes from the treatment area ──
    await jump(b.t0 - 40);
    await c.tp(12.3, 17.4, 120, -6);
    await c.ev(`__ac.client.act({ type: 'move', to: 'triage' })`);
    await mark('in triage');
    // back out to the waiting room once the stand-in is cast (latched when the call starts)
    await c.untilGameT(s(b.t0, 1), 60000);
    await c.tp(7.6, 17.3, -70, -8);
    await c.ev(`__ac.client.act({ type: 'move', to: 'waiting' })`);
    await mark('back in the waiting room');
    const beats2: [number, string, string[], 'call' | 'her'][] = [
      [s(b.fltUp, 4), 'on her way in from the treatment area', ['nurse'], 'her'],
      [s(b.call, -1.5), 'at the door, reading the clipboard', ['call', 'nurse'], 'call'],
      [s(b.call, 0.6), 'calling the name', ['call', 'callW', 'nurse', 'eyes'], 'call'],
      [s(b.call, 3.5), 'waiting for them to come', ['call', 'nurse'], 'call'],
      [s(b.greet, 0.4), 'greeting the patient', ['call', 'callW', 'nurse'], 'call'],
      [s(b.go, 2.5), 'off to the back', ['call', 'nurse'], 'her'],
    ];
    for (const [t, label, rigs, where] of beats2) {
      if (!(await c.untilGameT(t, 90000))) {
        c.note(`clock never reached "${label}"`);
        break;
      }
      if ((await c.gameT()) > t + 4 * scale) await mark(`late for "${label}"`);
      const who = (await nurse()) ?? 'amb_float_rn';
      const region = where === 'call' ? { ...CALLING, r: 1.6 } : await at(who, 1.2, CALLING);
      await c.shoot(`${who === 'rn_lena' ? 'Lena' : who === 'amb_float_rn' ? 'Jo' : who}: ${label}`, { t: null, rigs, target: who, region });
    }
    // ── you in triage with Lena at her desk: you see her in her chair, and her computer is hers ──
    await c.tp(12.2, 17.3, 50, -14);
    await c.ev(`__ac.client.act({ type: 'move', to: 'triage' })`);
    await c.wait(2500);
    await c.shoot('you in triage, Lena at her desk', { t: null, target: 'rn_lena', rigs: ['deskN', 'deskS', 'eyesDesk'] });
    const busy = await c.ev<{ seat: string | null; user: string | null } | null>(`(() => { const d = __acWorld.workstation().devices.find((x) => x.id === 'tr_pc'); return d ? { seat: d.seat, user: d.user } : null; })()`);
    c.note(`with her at it, the triage computer is in use by: ${busy?.user ?? 'nobody'}`);
  },
};

const ems: Scene = {
  id: 'ems',
  title: 'EMS arrival (Bed 4, by ambulance)',
  about: 'Night Shift: the urosepsis patient arrives by EMS at 4 min. Filmed: the ambulance entrance and Bed 4 before, at and after the arrival. Look for: where the patient comes from (a stretcher wheeled in by a crew, not out of thin air), the ambulance lights.',
  map: 'night_shift',
  region: { x: 14, z: 2.6, r: 2.6 },
  rigs: [
    { name: 'bay', pos: [12.35, 1.65, 5.9], at: [14.1, 0.75, 2.4] },
    { name: 'entrance', pos: [41.6, 1.7, 16.2], at: [41.6, 0.9, 22.5] },
    { name: 'outside', pos: [44.5, 2.2, 33.5], at: [41.6, 1.0, 26.0] },
    { name: 'eyes', eyes: true, look: [14.0, 0.8, 2.4] },
  ],
  async run(c) {
    await c.ev(`__acWorld.curtain('bed_4', 'snap-open')`);
    await c.cam('first');
    await c.tp(14.9, 8.6, 180, -12);
    await c.wait(1500);
    const beats: [number, string][] = [
      [3.55 * 60, 'before: the bay is empty'],
      [3.95 * 60, 'just before the arrival'],
      [4.02 * 60, 'arrival'],
      [4.2 * 60, 'a moment later'],
      [4.8 * 60, 'settled'],
    ];
    for (const [t, label] of beats) {
      if (!(await c.untilGameT(t, 120000))) break;
      await c.shoot(label, { t: null });
    }
  },
};

const coffee: Scene = {
  id: 'coffee',
  title: 'Coffee: cafeteria machine and table, workroom machine',
  about: 'The cafeteria self-serve machine (cup placed, pouring, ready, taken), paid for at the till with a phone tap, carried to a table, seated with it, a sip; then the workroom machine. Look for: where the cup comes from (a stack), the cup on the drip tray and under the spout, the hand round the cup from its side (not through it), the phone on the terminal and the paying arm whole to the shoulder, on the table (not beside it, not floating), in the hand, the rim on the lip.',
  owner: 'cafeteria cups and payment (amenities.ts)',
  map: 'night_shift',
  region: { x: 64.6, z: 1.6, r: 3.4 },
  rigs: [
    { name: 'right', around: 'pelvis', yaw: 105, pitch: 12, dist: 1.7, fov: 48, up: 0.35 },
    { name: 'behind', around: 'pelvis', yaw: 160, pitch: 18, dist: 1.9, fov: 48, up: 0.45 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    await c.cam('first');
    await c.tp(65.3, 1.2, 180, -24);
    await c.wait(3500);
    await c.ev(`__acWorld.use('coffee:caf_coffee')`);
    await c.wait(1300);
    await c.shoot('cup placed on the tray');
    await c.wait(4500);
    await c.shoot('pouring');
    await c.until(async () => (await c.ev<{ machines: { id: string; state: string }[] }>('__acWorld.amenities()')).machines.find((m) => m.id === 'coffee:caf_coffee')?.state === 'ready', 20000, 300);
    await c.shoot('ready');
    await c.ev(`__acWorld.use('coffee:caf_coffee')`);
    await c.wait(900);
    await c.shoot('taken: in the hand');
    // paid for at the till: the phone out of the free hand's pocket and on the counter's terminal (the
    // arm's sleeve once showed a hole by the shoulder, the arm hung after a hand parked out of reach)
    await c.tp(62.75, 3.0, 180, -24);
    await c.wait(800);
    await c.ev(`__acWorld.amenity('hold', 1.35)`);
    await c.ev(`__acWorld.use('pay:till')`);
    await c.until(async () => ((await c.ev<{ pay: { act: { t: number } | null } }>('__acWorld.amenities()')).pay.act?.t ?? 0) >= 1.34, 6000, 30);
    await c.wait(250);
    await c.shoot('paying at the till: the phone on the terminal', { region: { x: 62.75, z: 2.7, r: 2.0 } });
    await c.ev(`__acWorld.amenity('hold', null)`);
    await c.until(async () => !(await c.ev<{ pay: { act: unknown } }>('__acWorld.amenities()')).pay.act, 6000, 100);
    // to table 2: chair 5 is north of it, facing it
    await c.tp(63.1, 3.2, 0, -10);
    await c.wait(600);
    await c.ev(`__acWorld.use('sit:caf_chair_5')`);
    await c.wait(1800);
    await c.shoot('seated at the café table, cup on it', { region: { x: 63.1, z: 3.9, r: 2.2 } });
    await c.ev('__acWorld.sipNow()');
    await c.wait(1500);
    await c.shoot('a sip', { region: { x: 63.1, z: 3.9, r: 2.2 } });
    await c.wait(2600);
    await c.ev(`__acWorld.use('stand')`);
    await c.wait(1500);
    // the workroom's machine
    await c.cam('first');
    await c.tp(29.85, 15.45, 90, -24);
    await c.wait(3000);
    await c.ev(`__acWorld.use('coffee:wr_coffee')`);
    await c.wait(4500);
    await c.shoot('workroom: pouring', { region: { x: 30.2, z: 15.5, r: 2.2 } });
    await c.until(async () => (await c.ev<{ machines: { id: string; state: string }[] }>('__acWorld.amenities()')).machines.find((m) => m.id === 'coffee:wr_coffee')?.state === 'ready', 20000, 300);
    await c.ev(`__acWorld.use('coffee:wr_coffee')`);
    await c.wait(900);
    await c.shoot('workroom: mug in the hand', { region: { x: 30.2, z: 15.5, r: 2.2 } });
  },
};

/** a held act (hygiene.ts) at t s: the hold, then wait until it is there */
async function holdHygiene(c: Ctx, t: number | null) {
  await c.ev(`__acWorld.hygieneOp('hold', ${t === null ? 'null' : t})`);
  if (t === null) return;
  await c.until(async () => {
    const s = await c.ev<{ action: string | null; t?: number }>('__acWorld.hygiene()');
    return !!s.action && (s.t ?? 0) >= t - 0.001;
  }, 8000, 20);
  await c.wait(260);
}

async function untilIdle(c: Ctx) {
  await c.until(async () => !(await c.ev<{ action: string | null }>('__acWorld.hygiene()')).action, 15000, 100);
}

/** an act run twice: third-person rigs, then the player's eyes, held at the same moments */
async function twoPasses(c: Ctx, start: () => Promise<void>, beats: [number, string][], third: string[], o: { region?: Region } = {}) {
  await c.cam('third');
  await start();
  for (const [t, label] of beats) {
    await holdHygiene(c, t);
    await c.shoot(label, { rigs: third, t, region: o.region });
  }
  await holdHygiene(c, null);
  await untilIdle(c);
  await c.cam('first');
  await start();
  for (const [t, label] of beats) {
    await holdHygiene(c, t);
    await c.shoot(label, { rigs: ['eyes'], t, region: o.region });
  }
  await holdHygiene(c, null);
  await untilIdle(c);
}

const handrub: Scene = {
  id: 'handrub',
  title: 'Hand rub at a corridor dispenser',
  about: 'Bed 3’s corridor dispenser: the pump, then the steps of the rub. Look for: the hand under the nozzle when it pumps, both hands meeting (not through each other), the arm in front of the body.',
  owner: 'hand washing (hygiene.ts, fpHands.ts, hands.ts)',
  map: 'night_shift',
  region: { x: 8.05, z: 8.0, r: 1.6 },
  rigs: [
    { name: 'right', around: 'pelvis', yaw: 100, pitch: 14, dist: 1.15, fov: 42, up: 0.42 },
    { name: 'behind', around: 'pelvis', yaw: 150, pitch: 12, dist: 1.6, fov: 45, up: 0.38 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    const start = async () => {
      await c.tp(8.05, 8.4, 180, -10);
      await c.wait(1300);
      await c.ev(`__acWorld.use('rub:rub_bed_3_out')`);
    };
    await twoPasses(c, start, [
      [0.95, 'pump'],
      [1.85, 'palms'],
      [2.55, 'backs of the hands'],
      [3.35, 'fingers interlaced'],
      [4.75, 'thumbs'],
      [5.5, 'fingertips'],
    ], ['right', 'behind']);
  },
};

const handwash: Scene = {
  id: 'handwash',
  title: 'Hand wash at Bed 4’s sink',
  about: 'Tap on, wet, soap, lather, rinse, paper towel, dry, bin. Look for: the hands under the running water, the soap from the dispenser, the towel from the dispenser (not from thin air), into the bin.',
  owner: 'hand washing (hygiene.ts, fpHands.ts, hands.ts)',
  map: 'night_shift',
  region: { x: 14.9, z: 5.2, r: 1.6 },
  rigs: [
    { name: 'right', around: 'pelvis', yaw: 55, pitch: 14, dist: 1.25, fov: 45, up: 0.4 },
    { name: 'behind', around: 'pelvis', yaw: 140, pitch: 16, dist: 1.6, fov: 45, up: 0.4 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    const start = async () => {
      await c.tp(14.75, 5.2, 90, -20);
      await c.wait(1300);
      await c.ev(`__acWorld.use('wash:bed_4_sink')`);
    };
    // (moments of handwash.ts WASH: the wash runs 14.8 s)
    await twoPasses(c, start, [
      [0.95, 'tap on'],
      [1.75, 'wet at the tap'],
      [3.17, 'soap'],
      [4.5, 'lather'],
      [9.55, 'rinse'],
      [10.82, 'tap off'],
      [11.58, 'paper towel'],
      [13.0, 'dry'],
      [14.22, 'into the bin'],
    ], ['right', 'behind']);
  },
};

/**
 * A wash's moments, the walks included (hygiene.ts): `walk` holds you that many seconds into the walk
 * that starts at t (to the towels, to the bin), else the wash is held at t.
 */
async function washBeats(c: Ctx, beats: { t: number; label: string; walk?: number }[], rigs: string[], region?: Region) {
  for (const b of beats) {
    await c.ev(`__acWorld.hygieneOp('holdWalk', ${b.walk ?? 'null'})`);
    if (b.walk === undefined) {
      await holdHygiene(c, b.t);
    } else {
      await c.ev(`__acWorld.hygieneOp('hold', ${b.t})`);
      const ok = await c.until(async () => {
        const s = await c.ev<{ walking: string | null; legs: { u: number; done: boolean }[] | null }>('__acWorld.hygiene()');
        return !!s.walking && !!s.legs?.some((l) => !l.done && l.u >= b.walk! - 0.001);
      }, 10000, 20);
      if (!ok) c.note(`${b.label}: no walk under way at ${b.t} s`);
      await c.wait(260);
    }
    await c.shoot(b.label, { rigs, t: b.t, region });
  }
  await c.ev(`__acWorld.hygieneOp('holdWalk', null)`);
  await holdHygiene(c, null);
  await untilIdle(c);
}

const restroomWash: Scene = {
  id: 'handwash-restroom',
  title: 'Hand wash at the restroom counter',
  about: 'The all-gender restroom’s long counter: the towels at its right-hand end, the bin by the door. Wash, walk over to the towels with wet hands held in front, pull one, dry on the way to the bin, drop it in. Look for: walking (not sliding), turning to the towels and the bin, no arm stretched across the room, hands in front of the body, the foam patchy with skin between the bubbles, the sleeves pushed up.',
  owner: 'hand washing (hygiene.ts, handwash.ts, handPose.ts)',
  map: 'night_shift',
  region: { x: 68.3, z: 3.8, r: 3.2 },
  rigs: [
    { name: 'room', pos: [70.0, 2.1, 7.6], at: [67.6, 0.9, 3.9] },
    // (from your right and a little behind: at the counter, the towels and the bin you face the wall,
    // and your right is the room's side; walking to the bin the room's camera has you)
    { name: 'right', around: 'pelvis', yaw: 105, pitch: 16, dist: 1.35, fov: 48, up: 0.35 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    // rr_vanity: three basins along the west wall (#0 north of #1 north of #2), facing −x
    const start = async (basin: number) => {
      await c.tp(67.84, 3.35 - 0.9 * (basin - 1), -90, -20);
      await c.wait(1300);
      await c.ev(`__acWorld.use('wash:rr_vanity#${basin}')`);
    };
    const beats = [
      { t: 5.2, label: 'lather' },
      { t: 9.4, label: 'rinse' },
      { t: 10.95, label: 'off the tap, dripping' },
      { t: 11.0, walk: 0.9, label: 'walking to the towels' },
      { t: 11.58, label: 'the towel' },
      { t: 12.9, label: 'dry' },
      { t: 13.8, walk: 1.4, label: 'drying, to the bin' },
      { t: 14.22, label: 'into the bin' },
    ];
    await c.cam('third');
    await start(2);
    await washBeats(c, beats, ['room', 'right'], this.region);
    await c.shoot('done', { rigs: ['room', 'right'] });
    await c.cam('first');
    await start(0);
    await washBeats(c, beats, ['eyes'], this.region);
  },
};

const sleevesUp: Scene = {
  id: 'sleeves-up',
  title: 'Sleeves pushed up for a hand rub, and down again',
  about: 'Third person in the long-sleeved coat, at the walk-in entrance’s respiratory station: before the rub one hand pushes the other sleeve up to mid-forearm, then the other way round; after it they’re pulled back down the same way (sleeves.ts). Look for: the hand on the sleeve (not through the arm), the bare forearm the colour of the hand with no gap at the wrist, the fabric bunched at the hem, nothing of the sleeve left at the wrist (wet or lathered), the sleeves back to the wrist at the end.',
  owner: 'hand washing (hygiene.ts, sleeves.ts)',
  map: 'night_shift',
  // (the player only: people wait on the chairs nearby)
  region: { x: 3.9, z: 23.1, r: 0.8 },
  rigs: [
    { name: 'front', around: 'pelvis', yaw: 40, pitch: 14, dist: 1.35, fov: 42, up: 0.2 },
    { name: 'side', around: 'pelvis', yaw: 95, pitch: 10, dist: 1.25, fov: 42, up: 0.2 },
    { name: 'arms', around: 'pelvis', yaw: -40, pitch: 40, dist: 0.9, fov: 40, up: 0.15 },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    await c.cam('third');
    await c.tp(3.95, 23.13, -90, -10);
    await c.wait(1300);
    await c.shoot('sleeves down');
    // the rub held at its start: the push runs first
    await c.ev(`__acWorld.hygieneOp('hold', 0)`);
    await c.ev(`__acWorld.use('rub:mask_walkin_rub')`);
    for (const [t, label] of [[0.25, 'the left forearm out'], [0.44, 'pushing the left sleeve'], [0.62, 'left sleeve up'], [0.98, 'pushing the right sleeve'], [1.25, 'both up']] as [number, string][]) {
      await c.ev(`__acWorld.hygieneOp('holdPush', ${t})`);
      const ok = await c.until(async () => ((await c.ev<{ sleeves: { push: number | null } }>('__acWorld.hygiene()')).sleeves.push ?? -1) >= t - 0.001, 6000, 20);
      if (!ok) c.note(`${label}: no push under way`);
      await c.wait(260);
      await c.shoot(label);
    }
    await c.ev(`__acWorld.hygieneOp('holdPush', null)`);
    await holdHygiene(c, 1.85);
    await c.shoot('palms, sleeves up');
    // the rub done: the sleeves pulled back down, held at its moments
    await c.ev(`__acWorld.hygieneOp('hold', null)`);
    for (const [t, label] of [[0.42, 'pulling the left sleeve down'], [0.9, 'pulling the right sleeve down']] as [number, string][]) {
      const ok = await c.until(async () => (await c.ev<{ action: string | null }>('__acWorld.hygiene()')).action === 'sleevesDown', 12000, 20);
      if (!ok) c.note(`${label}: the sleeves weren't pulled down`);
      await holdHygiene(c, t);
      await c.shoot(label);
    }
    await holdHygiene(c, null);
    await untilIdle(c);
    await c.wait(600);
    await c.shoot('after: down to the wrists again');
  },
};

const rubWalkOff: Scene = {
  id: 'handrub-walk-off',
  title: 'Walking off in the middle of a hand rub',
  about: 'Bed 3’s corridor dispenser: rubbing, then walking away before it’s done (it doesn’t count). Look for: the arms letting go in front of the body as you walk off, never pulled back behind it; no snap upright.',
  owner: 'hand washing (hygiene.ts, hands.ts)',
  map: 'night_shift',
  region: { x: 8.05, z: 9.0, r: 2.6 },
  rigs: [
    { name: 'side', around: 'pelvis', yaw: 90, pitch: 10, dist: 2.0, fov: 48, up: 0.3 },
    { name: 'behind', around: 'pelvis', yaw: 160, pitch: 12, dist: 2.2, fov: 48, up: 0.3 },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    await c.cam('third');
    await c.tp(8.05, 8.4, 180, -10);
    await c.wait(1300);
    await c.ev(`__acWorld.use('rub:rub_bed_3_out')`);
    await c.until(async () => ((await c.ev<{ t: number | null }>('__acWorld.hygiene()')).t ?? 0) >= 2.6, 8000, 20);
    await c.shoot('rubbing', { rigs: ['side', 'behind'] });
    // walk away from the dispenser (back the way you came), the wrists in the body's frame every frame
    await c.ev(`(() => {
      const w = (window.__walkOff = []);
      const t0 = performance.now();
      const tick = () => {
        const s = __acWorld.hygiene();
        w.push({ t: (performance.now() - t0) / 1000, action: s.action, wrists: s.wrists, facing: s.pos[2] });
        if (performance.now() - t0 < 2600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`);
    await c.page.keyboard.down('KeyS');
    await c.wait(60);
    await c.shoot('walking off', { rigs: ['side', 'behind'] });
    await c.wait(800);
    await c.page.keyboard.up('KeyS');
    await c.wait(600);
    const log = await c.ev<{ t: number; action: string | null; facing: number; wrists: ([number, number, number] | null)[] }[]>('window.__walkOff');
    const stop = log.find((e) => !e.action)?.t ?? 0;
    const fwd = (e: (typeof log)[number]) => Math.min(...e.wrists.filter((w): w is [number, number, number] => !!w).map((w) => w[0]));
    const back = (from: number, to: number) => Math.min(...log.filter((e) => !e.action && e.t - stop >= from && e.t - stop < to).map(fwd));
    // (a walking arm swings behind the hips anyway: letting go should go no further back than walking on does)
    const early = back(0, 0.5);
    const later = back(0.7, 1.8);
    const f0 = log.find((e) => !e.action)?.facing ?? 0;
    const series = log.filter((e, i) => !e.action && e.t - stop < 0.7 && i % 3 === 0).map((e) => `${(e.t - stop).toFixed(2)}s ${(fwd(e) * 100).toFixed(0)}cm ${(((e.facing - f0) * 180) / Math.PI).toFixed(0)}°`);
    c.note(`walking off: the wrists' furthest back (m in front of the feet) letting go (first 0.5 s) ${early.toFixed(3)}, walking on ${later.toFixed(3)}`);
    c.note(`after it stopped (time, the wrist furthest back, the body's turn): ${series.join(' · ')}`);
    if (early < later - 0.06) c.note('✗ a wrist went further behind the back letting go than walking does');
    await c.shoot('let go', { rigs: ['side', 'behind'] });
  },
};

const mask: Scene = {
  id: 'mask',
  title: 'Mask on, from the station’s box',
  about: 'A mask taken from the box on the station’s end counter, held to the face, loops over the ears, the nose wire pinched. Look for: the mask from the box, loops behind the ears, the mask on the face (not through it).',
  owner: 'hand washing (hygiene.ts, fpHands.ts, hands.ts)',
  map: 'night_shift',
  region: { x: 15.6, z: 11.6, r: 1.6 },
  rigs: [
    { name: 'side', around: 'pelvis', yaw: 120, pitch: 10, dist: 1.6, fov: 45, up: 0.5 },
    { name: 'face', around: 'head', yaw: 35, pitch: 2, dist: 0.85, fov: 40 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    let pass = 0;
    const start = async () => {
      // the second pass (first person) starts bare-faced: M takes the first mask off (into a bin)
      if (pass++ > 0 && (await c.ev<{ maskOnFace?: boolean }>('__acWorld.hygiene()')).maskOnFace) {
        await c.page.keyboard.press('KeyM');
        await untilIdle(c);
        await c.wait(600);
      }
      await c.tp(15.62, 11.62, 90, -10);
      await c.wait(1300);
      await c.ev(`__acWorld.use('mask:mask_station')`);
    };
    await twoPasses(c, start, [
      [0.9, 'take one from the box'],
      [1.5, 'to the face'],
      [2.15, 'loops over the ears'],
      [2.65, 'nose wire'],
    ], ['side', 'face']);
    await c.cam('third');
    await c.wait(800);
    await c.shoot('on', { rigs: ['side', 'face'] });
  },
};

const sit: Scene = {
  id: 'sit',
  title: 'Sitting: café chair, sofa, desk chair, wheelchair',
  about: 'The player sits on a café chair, the workroom sofa, a station desk chair (a workstation login) and the corridor wheelchair. Look for: hips on the seat (not in it, not above it), the back against the backrest, both feet on the floor or the footrests.',
  map: 'night_shift',
  region: { x: 63.1, z: 3.6, r: 1.6 },
  rigs: [
    { name: 'side', around: 'pelvis', yaw: 90, pitch: 8, dist: 1.7, fov: 48, up: 0.15 },
    { name: 'front', around: 'pelvis', yaw: 30, pitch: 10, dist: 1.9, fov: 48, up: 0.2 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    // café chair 5 at table 2 (63.1, 4.4)
    await c.cam('third');
    await c.tp(63.1, 3.2, 0, -10);
    await c.wait(2500);
    await c.ev(`__acWorld.use('sit:caf_chair_5')`);
    await c.wait(450);
    await c.shoot('café chair: sitting down', { rigs: ['side', 'front'] });
    await c.wait(1600);
    await c.shoot('café chair: seated', { region: { x: 63.1, z: 3.6, r: 1.4 } });
    await c.ev(`__acWorld.use('stand')`);
    await c.wait(1500);
    // the workroom sofa
    await c.cam('third');
    await c.tp(26.6, 21.0, -90, -12);
    await c.wait(2500);
    await c.ev(`__acWorld.use('sofa:wr_sofa')`);
    await c.wait(2200);
    await c.shoot('sofa: seated', { region: { x: 26.0, z: 20.8, r: 1.4 } });
    await c.ev(`__acWorld.use('stand')`);
    await c.wait(1500);
    // a station desk chair (workstation 3)
    await c.tp(22.4, 12.1, 180, -10);
    await c.wait(2000);
    // the login takes the camera to the screen once seated: slowed down, filmed as the hips reach the seat
    await c.ev(`__acWorld.workstation({ slow: 4, use: 'st_pc_3' })`);
    await c.until(async () => !!(await c.ev<{ seated: boolean }>('__acWorld.workstation()')).seated, 20000, 100);
    await c.shoot('desk chair: seated, logging in', { region: { x: 22.4, z: 10.6, r: 1.4 } });
    await c.page.keyboard.press('Escape').catch(() => undefined);
    await c.page.keyboard.press('KeyS').catch(() => undefined);
    await c.wait(2500);
    // the corridor wheelchair: E on it from in front (first person, aiming at it)
    await c.cam('first');
    await c.tp(8.6, 12.85, 0, -35);
    await c.wait(2500);
    await c.page.keyboard.press('KeyE');
    await c.cam('third');
    await c.until(async () => (await c.ev<{ state: string }>('__acWorld.wheelchair()')).state === 'riding', 8000, 100);
    await c.ev('__acWorld.wheelchairTo(14, 11.0, 90)');
    await c.wait(1800);
    await c.shoot('wheelchair: seated', { region: { x: 14, z: 11, r: 1.4 } });
  },
};

const curtain: Scene = {
  id: 'curtain',
  title: 'Curtains: pulled by the player, then by a nurse',
  about: 'Bed 2’s curtain from inside the bay (the player), then a nurse walking into Bed 4 through its closed curtain and out again. Look for: the hand on the curtain’s edge before the cloth moves, the reaching arm in front of the body and on its own side, nobody walking through the fabric.',
  map: 'night_shift',
  region: { x: 4.6, z: 6.9, r: 1.8 },
  rigs: [
    { name: 'inside', pos: [5.55, 1.6, 6.55], at: [4.45, 1.15, 6.8] },
    { name: 'outside', pos: [3.3, 1.6, 8.4], at: [4.5, 1.15, 7.1] },
    { name: 'eyes', eyes: true },
    // the nurse at Bed 4: from the hub, and from inside the bay
    { name: 'n-hub', pos: [15.9, 1.65, 9.6], at: [12.6, 1.0, 7.0] },
    { name: 'n-in', pos: [14.9, 1.6, 4.6], at: [12.9, 1.05, 7.0] },
  ],
  defaults: ['inside', 'outside', 'eyes'],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    // from inside Bed 2, facing in (the edge behind you): replayed once per rig, so each frame is the same moment
    await replay(
      c,
      async () => {
        await c.ev(`__acWorld.curtain('bed_2', 'snap-closed')`);
        await c.tp(4.62, 6.55, 180, -8);
        await c.wait(1200);
        await c.ev(`__acWorld.useCurtain('curtain:bed_2')`);
      },
      () => c.wait(2200),
      [
        [250, 'player: turning, reaching'],
        [650, 'player: hand on the edge'],
        [1500, 'player: drawn open'],
      ],
      ['inside', 'outside', 'eyes'],
    );
    // a nurse into Bed 4 through its closed curtain, and out again (curtains-e2e)
    await c.ev(`__acWorld.curtain('bed_4', 'snap-closed')`);
    await c.ev(`__acWorld.curtainMode('relaxed')`);
    const nurse = await c.ev<string | null>(`(() => { const v = __ac.store.get().view; const ids = __acWorld.npcIds(); const n = v.npcs.find((x) => x.role === 'nurse' && x.visible && ids.includes(x.id)); return n ? n.id : null; })()`);
    if (!nurse) {
      c.note('no nurse to walk with');
      return;
    }
    await c.ev(`__acWorld.walkNpc('${nurse}', 13.9, 9.5, 180)`);
    await c.until(async () => {
      const n = await c.ev<{ x: number; z: number } | null>(`__acWorld.npc('${nurse}')`);
      return !!n && Math.hypot(n.x - 13.9, n.z - 9.5) < 0.4;
    }, 20000, 250);
    await c.cam('first');
    await c.tp(15.6, 10.2, 210, -6);
    await c.wait(800);
    await c.ev(`__acWorld.walkNpc('${nurse}', 12.8, 3.0, 90)`);
    const seen = new Set<string>();
    const t0 = Date.now();
    const region = { x: 12.9, z: 6.6, r: 2.0 };
    while (Date.now() - t0 < 20000) {
      const a = await c.ev<{ passages: { who: string; phase: string }[] }>('__acWorld.curtainAudit()');
      const ps = a.passages.find((x) => x.who === nurse);
      if (ps && !seen.has(ps.phase)) {
        seen.add(ps.phase);
        await c.shoot(`nurse in: ${ps.phase}`, { rigs: ['n-hub', 'n-in', 'eyes'], region });
      }
      const n = await c.ev<{ x: number; z: number }>(`__acWorld.npc('${nurse}')`);
      const cs = await c.ev<{ id: string; state: string }[]>('__acWorld.curtains()');
      if (Math.hypot(n.x - 12.8, n.z - 3.0) < 0.4 && !ps && cs.find((x) => x.id === 'bed_4')?.state === 'closed') break;
      await c.wait(40);
    }
    await c.wait(400);
    await c.shoot('nurse in: closed behind her', { rigs: ['n-hub', 'n-in', 'eyes'], region });
    await c.ev(`__acWorld.curtainMode('auto')`);
  },
};

const elevator: Scene = {
  id: 'elevator',
  title: 'Elevator call button',
  about: 'The east elevators’ hall call button on the ground floor. Look for: the turn to the panel, the finger on the button (not short of it, not through the wall), the arm in front of the shoulders and on its own side.',
  map: 'night_shift',
  region: { x: 53.35, z: 1.0, r: 1.6 },
  rigs: [
    { name: 'side', around: 'pelvis', yaw: 95, pitch: 8, dist: 1.5, fov: 45, up: 0.5 },
    { name: 'behind', around: 'pelvis', yaw: 150, pitch: 14, dist: 1.6, fov: 45, up: 0.5 },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    // standing a step off the panel, turned away from it (the turn is part of the gesture)
    await replay(
      c,
      async () => {
        await c.tp(53.35, 1.35, 180, -8);
        await c.wait(1500);
        await c.ev(`__acWorld.press('elev:east:call:0')`);
      },
      () => c.wait(2500),
      [
        [200, 'turning to the panel'],
        [450, 'reaching'],
        [750, 'finger on the button'],
        [1500, 'hand back'],
      ],
      ['side', 'behind', 'eyes'],
    );
  },
};

/** a short act (a button, a curtain) replayed once per rig and moment, each frame `ms` after it starts */
async function replay(c: Ctx, start: () => Promise<void>, settle: () => Promise<void>, beats: [number, string][], rigs: string[]) {
  for (const rig of rigs) {
    for (const [ms, label] of beats) {
      await c.cam(rig === 'eyes' ? 'first' : 'third');
      await start();
      await c.wait(ms);
      await c.shoot(label, { rigs: [rig], t: ms / 1000 });
      await settle();
    }
  }
}

const bedside: Scene = {
  id: 'bedside',
  title: 'Bedside: the tablet open at Bed 4, then an exam',
  about: 'The player at Bed 4’s bedside with the tablet open (turned to the patient, a palm on the rail), then auscultation, abdominal palpation and the ankle. Look for: the palm on the rail’s top, the exam hand on the body (not through the blanket or the patient), nobody through the mattress or rails.',
  owner: 'inclined beds (props.ts beds, avatars lying pose, bedding.ts, care.ts)',
  map: 'night_shift',
  region: { x: 14.4, z: 2.8, r: 2.0 },
  rigs: [
    { name: 'across', pos: [12.75, 1.55, 1.9], at: [15.0, 1.05, 2.3] },
    { name: 'foot', pos: [14.2, 1.7, 5.2], at: [14.9, 1.0, 2.2] },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 6 })`);
    await c.wait(1500);
    const bed4 = await c.ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.location === 'bed_4' && x.posture === 'lie'); return n ? n.id : null; })()`);
    if (!bed4) {
      c.note('no patient lying in Bed 4');
      return;
    }
    await c.ev(`__acWorld.curtain('bed_4', 'snap-open')`);
    await c.cam('third');
    await c.tp(14.9, 4.3, 30, -8);
    await c.wait(1500);
    await c.shoot('at the foot of the bed, tablet closed', { rigs: ['across', 'foot'] });
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${bed4}', tab: 'talk' }, tabletMin: false })`);
    await c.until(async () => {
      const s = await c.ev<{ phase: string; w?: number }>('__acWorld.care()');
      return s.phase === 'on' && (s.w ?? 0) > 0.97;
    }, 9000, 100);
    await c.wait(500);
    await c.shoot('tablet open: turned to her, a palm on the rail', { rigs: ['across', 'foot'] });
    const pid = await c.ev<string>(`__ac.store.get().view.npcs.find((n) => n.id === '${bed4}').patientId`);
    for (const [m, label] of [['cv_auscultate', 'exam: auscultation'], ['abd_palpate', 'exam: abdomen'], ['msk_lat_malleolus', 'exam: ankle']] as const) {
      await c.ev(`__ac.client.act({ type: 'examine', patientId: '${pid}', maneuver: '${m}' })`);
      await c.until(async () => ((await c.ev<{ exam?: { w: number } | null }>('__acWorld.care()')).exam?.w ?? 0) > 0.98, 4000, 60);
      await c.wait(700);
      await c.shoot(label, { rigs: ['across', 'foot'] });
      await c.wait(2600);
    }
    // first person: the exam hand in view
    await c.ev(`__ac.store.set({ panel: null })`);
    await c.wait(300);
    await c.cam('first');
    await c.tp(14.85, 2.4, 250, -10);
    await c.wait(400);
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${bed4}', tab: 'exam' }, tabletMin: false })`);
    await c.wait(900);
    const b = (await c.ev<{ bearing?: number }>('__acWorld.care()')).bearing ?? 0;
    await c.ev(`__acWorld.look(${b + 180}, -32)`);
    await c.wait(300);
    await c.ev(`__acWorld.careExam('cv_auscultate')`);
    await c.wait(700);
    await c.shoot('exam: auscultation', { rigs: ['eyes'] });
    await c.ev(`__ac.store.set({ panel: null })`);
  },
};

const examUltrasound: Scene = {
  id: 'exam-ultrasound',
  title: 'Bedside ultrasound as views in the Examine tab',
  about: 'At Bed 5 (appendicitis, Orientation), the tablet’s Examine tab filtered to its "Bedside ultrasound" group, then the RLQ and IVC views: the reads appear with the other findings. Look for: no ultrasound cart parked in Bed 5’s bay, the doctor standing at the bedside with no exam hand on the body for a view (no probe, no palm on the belly), and Resus 1’s own ultrasound cart still in place as scenery.',
  map: 'orientation', seed: 9, showUI: true,
  region: { x: 18.4, z: 2.8, r: 2.0 },
  rigs: [
    { name: 'across', pos: [16.75, 1.55, 1.9], at: [19.0, 1.05, 2.3] },
    { name: 'foot', pos: [18.2, 1.7, 5.2], at: [18.9, 1.0, 2.2] },
    { name: 'eyes', eyes: true },
    { name: 'resus', pos: [36.2, 1.6, 20.6], at: [37.97, 0.9, 23.3] },
  ],
  defaults: ['across', 'foot'],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 6 })`);
    await c.wait(1500);
    const bed5 = await c.ev<string | null>(`(() => { const v = __ac.store.get().view; const n = v.npcs.find((x) => x.role === 'patient' && x.location === 'bed_5' && x.posture === 'lie'); return n ? n.id : null; })()`);
    if (!bed5) {
      c.note('no patient lying in Bed 5');
      return;
    }
    const pid = await c.ev<string>(`__ac.store.get().view.npcs.find((n) => n.id === '${bed5}').patientId`);
    await c.ev(`__acWorld.curtain('bed_5', 'snap-open')`);
    await c.cam('third');
    await c.tp(18.9, 4.3, 30, -8);
    await c.wait(1500);
    await c.shoot('Bed 5: no ultrasound cart parked in the bay');
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${bed5}', tab: 'exam' }, tabletMin: false })`);
    await c.until(async () => {
      const s = await c.ev<{ phase: string; w?: number }>('__acWorld.care()');
      return s.phase === 'on' && (s.w ?? 0) > 0.97;
    }, 9000, 100);
    await c.page.locator('.exam-filter').fill('ultrasound');
    await c.wait(500);
    await c.shoot('Examine: the "Bedside ultrasound" group');
    for (const [m, label] of [['pocus_rlq', 'view: RLQ / appendix'], ['pocus_ivc', 'view: IVC']] as const) {
      await c.ev(`__ac.client.act({ type: 'examine', patientId: '${pid}', maneuver: '${m}' })`);
      await c.until(async () => (await c.ev<number>(`(__ac.store.get().view.examFindings['${pid}'] ?? []).filter((f) => f.maneuver === '${m}').length`)) > 0, 4000, 60);
      await c.wait(900);
      const gesture = await c.ev<{ exam?: unknown }>('__acWorld.care()');
      if (gesture.exam) c.note(`${m}: an exam gesture played (${JSON.stringify(gesture.exam)})`);
      await c.shoot(label);
    }
    // first person: what you see with the tablet open after the views
    await c.ev(`__ac.store.set({ panel: null })`);
    await c.wait(300);
    await c.cam('first');
    await c.tp(18.85, 2.4, 250, -10);
    await c.wait(400);
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', npcId: '${bed5}', tab: 'exam' }, tabletMin: false })`);
    await c.wait(900);
    await c.shoot('first person: the reads in the Examine tab', { rigs: ['eyes'] });
    await c.ev(`__ac.store.set({ panel: null })`);
    await c.wait(300);
    await c.shoot('Resus 1: its own ultrasound cart, scenery', { rigs: ['resus'] });
  },
};

const embodiedBedside: Scene = {
  id: 'embodied-bedside',
  title: 'Embodied doctor speaks to a Fast Track patient',
  about: 'Observe the reply at the bedside, then close the conversation and open the patient list as one plan between observations.',
  map: 'orientation', seed: 9, showUI: true,
  region: { x: 17.8, z: 20, r: 1.8 },
  rigs: [
    { name: 'eyes', eyes: true, look: [17.5, 1.15, 20.4] },
    { name: 'foot', pos: [16.4, 1.7, 18.1], at: [17.9, 1.05, 20.4] },
  ],
  async run(c) {
    await c.tp(18.8, 19.6, -60, -12);
    const patient = await c.ev<string>("__ac.store.get().view.npcs.find(n => n.role === 'patient' && n.location === 'ft_1').id");
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', tab: 'talk', npcId: ${JSON.stringify(patient)} } })`);
    await c.page.locator('.chat-input textarea').waitFor();
    await c.wait(900);
    const result = await applyInput(c.page, { kind: 'speak', text: 'Where does it hurt?' });
    if (result !== 'Spoke.') throw Error(result);
    await c.page.locator('.talk').getByText('Where does it hurt?', { exact: true }).waitFor();
    await c.shoot('At the bedside after a spoken question');
    await playInputs(c.page, [{ kind: 'key', key: 'Escape', ms: 0 }, { kind: 'key', key: 'Tab', ms: 0 }], (input, result) => c.note(JSON.stringify(input) + ': ' + result));
    await c.page.locator('.th-list').waitFor();
    await c.shoot('Next observation after Escape and Tab');
  },
};

const bedsideDisposition: Scene = {
  id: 'bedside-disposition',
  title: 'From the bedside plan to Diagnosis & Dispo',
  about: 'Open Plan in Fast Track 1 and follow its shortcut. Check that the patient in the chart banner is the one at the bedside and the disposition form is visible.',
  map: 'orientation',
  seed: 9,
  showUI: true,
  region: { x: 17.8, z: 20, r: 1.8 },
  rigs: [
    { name: 'eyes', eyes: true, look: [17.5, 1.15, 20.4] },
    { name: 'foot', pos: [16.4, 1.7, 18.1], at: [17.9, 1.05, 20.4] },
  ],
  async run(c) {
    // A higher-acuity patient arrives in Bed 5. Falling back to the first chart would open hers.
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 3 })`);
    await c.page.waitForFunction('__ac.store.get().view.board.length === 2');
    const patient = await c.ev<{ npcId: string; chartName: string }>(`(() => {
      const view = __ac.store.get().view;
      const row = view.board.find(r => r.bed === 'ft_1');
      return { npcId: view.npcs.find(n => n.role === 'patient' && n.patientId === row.id).id, chartName: row.name };
    })()`);
    await c.tp(18.8, 19.6, -60, -12);
    await c.ev(`__ac.store.set({ panel: { kind: 'npc', npcId: ${JSON.stringify(patient.npcId)} }, tabletMin: false })`);
    await c.page.locator('.tablet .sp-tabs').getByRole('button', { name: /Plan/ }).click();
    const shortcut = c.page.getByRole('button', { name: 'Open Diagnosis & Dispo' });
    await shortcut.waitFor();
    await c.shoot('Disposition shortcut on the Plan tab');
    await shortcut.click();
    await c.page.locator('.ehr-banner').getByText(patient.chartName, { exact: true }).waitFor();
    await c.page.getByRole('button', { name: 'Submit disposition', exact: true }).waitFor();
    await c.shoot('Same patient in Diagnosis and Dispo');
  },
};

function dischargeScene(mobility: 'walking' | 'wheelchair'): Scene {
  const chair = mobility === 'wheelchair';
  return {
    id: `discharge-${mobility}`,
    title: chair ? 'Discharge with a wheelchair escort' : 'Discharge on foot',
    about: 'Sign Daniel’s discharge in Fast Track 1. Follow the assigned nurse to the bedside and Daniel through the public exit.',
    map: 'orientation',
    seed: 9,
    showUI: true,
    region: { x: 18.0, z: 20.1, r: 2.1 },
    rigs: [
      { name: 'bed', pos: [16.4, 1.7, 18.1], at: [17.9, 1.05, 20.4] },
      { name: 'side', follow: 'pt_p_okafor', off: [2.4, 1.7, 1.2], look: 1.0 },
      { name: 'front', follow: 'pt_p_okafor', off: [-0.6, 1.7, 3.5], look: 1.0 },
      { name: 'exit', pos: [6.9, 1.7, 28.1], at: [5.0, 1.0, 23.7] },
      { name: 'door', pos: [18.3, 2.1, 12.1], at: [17.4, 1.1, 15.5] },
    ],
    async run(c) {
      const pid = 'p_okafor';
      const npc = `pt_${pid}`;
      const row = `__ac.store.get().view.board.find(r => r.id === '${pid}')`;
      const patient = `__acWorld.npc('${npc}')`;
      const nurse = `__acWorld.npc(${row}.discharge.nurseId)`;
      const waitFor = (condition: string, timeout = 90000) =>
        c.page.waitForFunction(condition, undefined, { polling: 100, timeout });

      await c.tp(29, 13.6, 0); // leave the west corridor clear for the patient and the camera
      await c.ev(`__ac.client.settings({ timeScale: 6 })`);
      await c.ev(`__ac.store.set({ panel: { kind: 'ehr', patientId: '${pid}', section: 'dx' } })`);
      await c.page.locator('.ehr-dx-input input').fill('Right ankle sprain');
      await c.page.locator('.ehr-dx-input button.ehr-btn').click();
      await c.page.getByRole('radio', { name: 'Discharge home' }).check();
      await c.page.getByRole('textbox', { name: /discharge instructions/i }).fill('Use the ankle brace as discussed. See the return precautions in your discharge plan.');
      if (chair) await c.page.getByRole('checkbox', { name: /wheelchair/i }).check();
      await c.page.getByRole('button', { name: 'Submit disposition' }).click();
      await c.page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await waitFor(`${row}.discharge?.phase === 'paperwork' && ${row}.discharge.mobility === '${mobility}'`);
      await c.page.locator('.ehr-decided').getByText(/preparing discharge paperwork/i).waitFor();
      await c.shoot('Discharge signed in the chart', { rigs: ['bed'] });
      await c.page.keyboard.press('Escape');
      await c.page.addStyleTag({ content: HIDE });
      // Observe real-time transitions. Advancing the game clock would miss a nurse
      // still walking to the bay, or a patient vanishing at the bedside.
      let ready = false;
      let lastHandoff: unknown;
      await c.until(async () => {
        const sample = await c.ev<{ phase: string; distance: number; facing: number; seated: boolean; walking: boolean; clipboard: boolean; remaining: number }>(`(() => {
          const p = ${patient}, n = ${nurse};
          const d = ${row}.discharge;
          const distance = p?.visible && n?.visible ? Math.hypot(p.x - n.x, p.z - n.z) : Infinity;
          return { phase: d.phase, distance, facing: n && p ? ((p.x - n.x) * Math.sin(n.yaw) + (p.z - n.z) * Math.cos(n.yaw)) / distance : -1,
            seated: p?.posture === 'sit', walking: n?.walking, clipboard: !!__acWorld.propOf(d.nurseId, 'clipboard'), remaining: d.until - __ac.store.get().view.t,
            patient: [p?.x, p?.z], nurse: [n?.x, n?.z] };
        })()`);
        if (sample.phase === 'handoff' && sample.remaining > 24) {
          lastHandoff = sample;
          ready = sample.distance < 2.3 && sample.facing > Math.cos(0.25) && sample.seated && !sample.walking && sample.clipboard;
        }
        return ready || sample.phase === 'leaving' || sample.phase === 'departed';
      }, 180000, 150);
      if (!ready) throw new Error(`Nurse never settled facing Daniel with his paperwork: ${JSON.stringify(lastHandoff)}`);
      await c.wait(850); // let the nurse turn toward the patient and lift the paperwork
      await c.shoot('Nurse reviews discharge at the bedside', { rigs: ['bed', 'side'] });
      await waitFor(`${row}.discharge.phase === 'leaving'`);
      const overlap = await c.ev<string | null>(`__acWorld.dischargeRouteAudit('${npc}')`);
      if (overlap) throw new Error(`Discharge route overlap check: ${overlap}`);
      // Reproduce the ordinary 1× exit, including turning down the clock during the trip.
      await c.ev('__ac.client.settings({timeScale: 1})');
      await waitFor('__ac.store.get().view.settings.timeScale === 1');
      if (chair) {
        await c.wait(600);
        const read = () => c.ev<number[]>(`(() => { const p = ${patient}, n = ${nurse}; return [performance.now(), p.x, p.z, n.x, n.z]; })()`);
        const before = await read();
        await c.wait(1800);
        const after = await read();
        const seconds = (after[0] - before[0]) / 1000;
        const speed = (i: number) => Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1]) / seconds;
        if (speed(1) < 0.65 || speed(1) > 1.8 || Math.abs(speed(1) - speed(3)) > 0.45) {
          throw new Error(`1× transport pace: wheelchair ${speed(1).toFixed(2)}, nurse ${speed(3).toFixed(2)} m/s`);
        }
        console.log(`    1× transport: wheelchair ${speed(1).toFixed(2)}, nurse ${speed(3).toFixed(2)} m/s`);
      }
      await waitFor(`${patient}?.z < 16.2`);
      await c.shoot('Clearing the open Fast Track door', { rigs: ['door'], region: await npcRegion(c, npc, 1.3) });
      await waitFor(`(() => {
        const p = ${patient}, n = ${nurse};
        if (${row}.discharge.phase !== 'leaving' || !p?.visible || p.x >= 12 || p.z >= 15) return false;
        const wheelchair = __acWorld.propOf('${npc}', 'wheelchair');
        return ${chair ? "p.posture === 'sit' && wheelchair && n?.visible && Math.hypot(p.x - n.x, p.z - n.z) < 1.5" : "p.posture === 'stand' && !wheelchair"};
      })()`);
      await c.shoot(chair ? 'Nurse wheels Daniel along the corridor' : 'Daniel walks along the corridor', {
        rigs: ['side', 'front'], region: await npcRegion(c, npc, 1.65),
        checks: chair ? () => wheelchairChecks(c, npc) : undefined,
      });
      if (chair) {
        await c.ev(`__ac.client.settings({ paused: true })`);
        await waitFor('__ac.store.get().view.settings.paused');
        await c.wait(160); // capture the first fully rendered stationary pose
        const positions = () => c.ev<number[]>(`(() => { const p = ${patient}, n = ${nurse}; return [p.x, p.z, n.x, n.z]; })()`);
        const before = await positions();
        await c.wait(1200);
        const after = await positions();
        await c.ev(`__ac.client.settings({ paused: false })`);
        if (Math.hypot(after[0] - before[0], after[1] - before[1]) > 0.05 || Math.hypot(after[2] - before[2], after[3] - before[3]) > 0.05) {
          throw new Error(`Wheelchair or nurse moved while paused: ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
        }
      }
      // The south face of the waiting room at z=24 is the public entrance.
      await waitFor(`(() => { const p = ${patient}; return p?.visible && p.z > 24 && Math.abs(p.x - 5) < 1.5; })()`);
      await c.shoot('Through the public exit', { rigs: ['exit', 'side'], region: await npcRegion(c, npc, 1.65) });
      await waitFor(`${row}.flowStatus === 'Departed' && !${patient}?.visible`);
      await c.shoot('Patient has left the department', { rigs: ['exit'], region: { x: 5, z: 24.5, r: 1.8 } });
    },
  };
}

const stretcher: Scene = {
  id: 'stretcher',
  title: 'A patient on a resus stretcher (head of the bed raised)',
  about: 'A patient laid on Resus 1’s stretcher. Asked for: the head of the stretcher raised (semi-recumbent), the body following the backrest. Look for: the back on the backrest, the head on the pillow, heels on the mattress, nothing through the rails.',
  owner: 'inclined beds (props.ts beds, avatars lying pose, bedding.ts, care.ts)',
  map: 'night_shift',
  region: { x: 37.4, z: 19.0, r: 1.8 },
  rigs: [
    { name: 'side', pos: [37.0, 1.6, 17.3], at: [37.2, 0.85, 19.4] },
    { name: 'foot', pos: [39.4, 1.7, 19.6], at: [37.3, 0.85, 19.1] },
    { name: 'eyes', eyes: true, look: [37.3, 0.9, 19.0] },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);
    await c.wait(1000);
    const pt = await c.ev<string | null>(`(() => { const v = __ac.store.get().view; const ids = __acWorld.npcIds(); const n = v.npcs.find((x) => x.role === 'patient' && x.location === 'ft_1' && ids.includes(x.id)) || v.npcs.find((x) => x.role === 'patient' && x.visible && ids.includes(x.id)); return n ? n.id : null; })()`);
    if (!pt) {
      c.note('no patient to lay on the stretcher');
      return;
    }
    await c.ev(`__acWorld.layNpc('${pt}', 37.37, 19.0, 90)`);
    await c.cam('first');
    await c.tp(39.0, 21.2, -125, -12);
    await c.wait(2500);
    await c.shoot('lying on the stretcher');
    await c.wait(3000);
    await c.shoot('a few seconds on');
  },
};

// ───────────────────────────── a belonging back to its owner (itemSystem.ts giveTarget / handOver) ─────────────────────────────

/** Bed 4's bed and the spot a handed-back belonging lies on (itemSystem.ts bedSpot: beside the hip, the doctor's side) */
const BED4 = { x: 14.0, z: 2.3 };

const handbag: Scene = {
  id: 'handbag',
  title: 'A handbag back to its owner (Bed 4)',
  about:
    "Mrs. Brunner's handbag picked up from beside the visitor chair (E), looked into (F), then handed back to her in bed (E aimed at her): the hand that holds it reaches to the bed and leaves it beside her hip; then the same in first person. Look for: the bag in the hand (not through the body or the leg), the arm reaching to the bed, the bag standing on the blanket beside her (not sunk in it, not floating, not on her or her arm).",
  map: 'night_shift',
  region: { x: 14.6, z: 2.6, r: 2.0 },
  rigs: [
    { name: 'across', pos: [12.75, 1.55, 1.9], at: [15.0, 1.05, 2.3] },
    { name: 'foot', pos: [14.2, 1.7, 5.2], at: [14.9, 1.0, 2.2] },
    { name: 'close', pos: [13.1, 1.3, 3.25], at: [14.35, 0.7, 2.5] },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    await c.ev(`__ac.client.act({ type: 'wait', minutes: 6 })`);
    await c.wait(1500);
    const here = await c.ev<boolean>(`!!__ac.store.get().view.npcs.find((n) => n.id === 'pt_p_brunner' && n.location === 'bed_4')`);
    if (!here) {
      c.note('Mrs. Brunner is not in Bed 4');
      return;
    }
    await c.ev(`__acWorld.curtain('bed_4', 'snap-open')`);
    const bag = () => c.ev<{ id: string; x: number; y: number; z: number } | undefined>(`__acWorld.listItems().find((i) => i.caseItemId === 'brunner_handbag')`);
    const b0 = await bag();
    if (!b0) {
      c.note('no handbag in the world');
      return;
    }
    const key = async (k: string, ms = 700) => {
      await c.page.keyboard.press(k);
      await c.wait(ms);
    };
    // first person: put the crosshair on a point (the camera looks along yaw: forward = (−sin, −cos))
    const aim = async (p: V3) => {
      const s = await c.ev<{ x: number; z: number; camY: number }>('__acWorld.state()');
      const dx = p[0] - s.x;
      const dz = p[2] - s.z;
      await c.ev(`__acWorld.look(${deg(Math.atan2(-dx, -dz))}, ${deg(Math.atan2(p[1] - s.camY, Math.hypot(dx, dz)))})`);
      await c.wait(250);
    };
    const focus = () => c.ev<{ key: string; label: string } | null>('__acWorld.focus()');
    // ── pick it up from the floor by the chair (E), and look inside (F) ──
    await c.cam('first');
    const ux = BED4.x - b0.x;
    const uz = BED4.z - b0.z;
    const ul = Math.hypot(ux, uz) || 1;
    await c.tp(b0.x + (ux / ul) * 0.75, b0.z + (uz / ul) * 0.75, deg(Math.atan2(-ux, -uz)), -50);
    await c.wait(500);
    await aim([b0.x, b0.y + 0.12, b0.z]);
    c.note(`aimed at the bag: ${JSON.stringify(await focus())}`);
    await c.shoot('the handbag by the chair, aimed at', { rigs: ['eyes'] });
    await key('KeyE');
    await c.shoot('picked up (E)', { rigs: ['eyes'] });
    await key('KeyF', 900);
    await c.shoot('looking inside (F)', { rigs: ['eyes'] });
    await key('KeyF', 500);
    // ── third person: hand it back (E on her) ──
    await c.cam('third');
    await c.tp(15.55, 3.05, deg(Math.atan2(BED4.x - 15.55, BED4.z + 0.1 - 3.05)), -14);
    await c.wait(700);
    const f = await focus();
    c.note(`aimed at Mrs. Brunner (third person): ${JSON.stringify(f)}`);
    if (!f?.key.startsWith('use:give:')) {
      // the third-person crosshair is over the shoulder: look a little to her middle
      for (const yawOff of [-12, -6, 6, 12]) {
        const s = await c.ev<{ facing: number }>('__acWorld.state()');
        await c.ev(`__acWorld.look(${deg(s.facing) - 180 + yawOff}, -16)`);
        await c.wait(250);
        if ((await focus())?.key.startsWith('use:give:')) break;
      }
      c.note(`after aiming again: ${JSON.stringify(await focus())}`);
    }
    await c.shoot('holding the bag, aimed at her', { rigs: ['across', 'foot', 'close'] });
    await c.page.keyboard.press('KeyE');
    await c.until(async () => (await c.ev<{ weight?: number }>('__acWorld.gesture()')).weight! > 0.95, 9000, 40);
    c.note(`walked up to hand it over: ${JSON.stringify(await c.ev('(() => { const s = __acWorld.state(); return [+s.x.toFixed(2), +s.z.toFixed(2)]; })()'))}`);
    await c.shoot('handing it over: the hand at the bed', { rigs: ['close', 'across'] });
    await c.wait(1600);
    const given = await c.ev<boolean>(`!!__ac.store.get().view.items.find((i) => i.id === 'brunner_handbag')?.given`);
    c.note(`server: given = ${given}`);
    await c.shoot('the bag beside her on the bed', { rigs: ['across', 'foot', 'close'] });
    // ── first person: take it off the bed again and hand it back (the bag hangs from the reaching hand) ──
    await c.cam('first');
    const b1 = await bag();
    await c.tp(14.95, 3.05, deg(Math.atan2(BED4.x - 14.95, BED4.z - 3.05)), -40);
    await c.wait(500);
    if (b1) await aim([b1.x, b1.y + 0.12, b1.z]);
    c.note(`aimed at the bag on the bed: ${JSON.stringify(await focus())}`);
    await key('KeyE');
    await aim([BED4.x, 0.85, BED4.z - 0.3]);
    c.note(`aimed at her (first person): ${JSON.stringify(await focus())}`);
    await c.page.keyboard.press('KeyE');
    await c.until(async () => (await c.ev<{ weight?: number }>('__acWorld.gesture()')).weight! > 0.6, 9000, 30);
    await c.shoot('first person: handing it over', { rigs: ['eyes'] });
    await c.wait(1800);
    await c.shoot('first person: left beside her', { rigs: ['eyes', 'close'] });
  },
};

const manualSave: Scene = {
  id: 'save-slots', title: 'Saving and returning to rounds',
  about: 'An independent named checkpoint in a solo shift. The student returns to the same place and clock.',
  map: 'orientation', showUI: true, region: { x: 8.4, z: 17.6, r: 0.75 },
  rigs: [{ name: 'hall', pos: [7, 1.8, 16], at: [8.4, 1.1, 17.6] }, { name: 'eyes', eyes: true }],
  async run(c) {
    await c.tp(8.4, 17.6, 90);
    await c.ev('__ac.client.settings({paused:true})');
    await c.page.waitForFunction('__ac.store.get().view.settings.paused');
    const clock = await c.gameT();
    const held = await c.ev<string>(`(() => {
      const it = __acWorld.listItems().find(i => i.caseItemId);
      __acWorld.pickUp(it.id);
      return JSON.stringify(__acWorld.amenities().held);
    })()`);
    if (held === '[]') throw new Error('No belonging in hand before saving');
    await c.page.getByRole('button', { name: 'Save game', exact: true }).click();
    const dialog = c.page.getByRole('dialog');
    await dialog.locator('.slot-row').first().click();
    await dialog.getByLabel('Save name').fill('Before rounds');
    await c.shoot('Choose a checkpoint');
    await dialog.getByRole('button', { name: 'Save game', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await c.ev("__ac.client.act({type:'wait',minutes:15})");
    await c.ev('__ac.client.leaveSolo()');
    await c.page.getByRole('button', { name: 'Load game' }).click();
    await dialog.getByRole('button', { name: /Before rounds/ }).click();
    await dialog.getByRole('button', { name: 'Load game', exact: true }).click();
    await c.page.waitForSelector('.hud-clock');
    await c.page.waitForSelector('.loading-screen.done', { timeout: 120000 });
    if (await c.gameT() !== clock) throw new Error('Loaded a different shift time');
    const pose = await c.ev<{x:number; z:number}>('__acWorld.state()');
    if (Math.hypot(pose.x - 8.4, pose.z - 17.6) > 0.15) throw new Error('Loaded a different player position');
    if (await c.ev('JSON.stringify(__acWorld.amenities().held)') !== held) throw new Error('Held item changed');
    await c.shoot('Back on rounds');
    await c.ev(`__ac.client.act({type:'disposition',patientId:__ac.store.get().view.board[0].id,decision:'discharge',diagnoses:['ankle sprain']})`);
    await c.ev("__ac.client.act({type:'end_shift'})");
    const locker = c.page.locator('.rotation-card');
    await locker.waitFor();
    const xp = await c.ev<number>('__ac.store.get().rotation.xp');
    if (!xp) throw new Error('Case earned no XP');
    await locker.getByRole('button', { name: 'Save game' }).click();
    await dialog.locator('.slot-row').nth(1).click();
    await dialog.getByLabel('Save name').fill('After rounds');
    await dialog.getByRole('button', { name: 'Save game', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await c.page.getByRole('button', { name: 'Main menu', exact: true }).click();
    await c.page.getByRole('button', { name: 'Load game' }).click();
    await dialog.getByRole('button', { name: /After rounds/ }).click();
    await dialog.getByRole('button', { name: 'Load game', exact: true }).click();
    await locker.waitFor();
    if (await c.ev('__ac.store.get().rotation.xp') !== xp) throw new Error('Debrief load changed XP');
    c.note('Held belonging, independent debrief save and XP round-trip verified.');
  },
};

const rotationRounds: Scene = {
  id: 'rotation-rounds', title: 'Earning rotation XP at the bedside',
  about: 'The next bedside goal is visible on arrival. Taking a history and examining the ankle advance the rotation during the shift.',
  map: 'orientation', seed: 9, showUI: true, region: { x: 17.8, z: 20, r: 1.2 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'foot', pos: [16.4, 1.7, 18.1], at: [17.9, 1.05, 20.4] }],
  async run(c) {
    const hud = c.page.getByRole('region', { name: 'Rotation progress' });
    await hud.getByText('0 XP', { exact: true }).waitFor();
    await c.tp(18.8, 19.6, -60, -12);
    await c.shoot('First bedside goal');
    await c.ev(`__ac.store.set({panel:{kind:'npc',npcId:'pt_p_okafor'},tabletMin:false})`);
    const chat = c.page.locator('.talk textarea');
    await chat.fill('How did the injury happen?');
    await chat.press('Enter');
    await hud.getByText('15 XP', { exact: true }).waitFor();
    await c.page.locator('.tablet .sp-tabs').getByRole('button', { name: /Exam/ }).click();
    await c.page.getByRole('button', { name: 'Ankle inspection', exact: true }).click();
    await hud.getByText('25 XP', { exact: true }).waitFor();
    await hud.locator('summary').click();
    await c.shoot('Bedside goals credited');
  },
};

const radioStory: Scene = {
  id: 'radio-story', title: 'The hospital radio', map: 'night_shift', seed: 9, showUI: true,
  about: 'Find the tune through an ordinary chat, follow the two leads, and see the pin in the locker.',
  region: { x: 0, z: 0, r: 0.8 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'counter', follow: 'caf_luis', off: [1.3, 1.7, 1.6], look: 1.2 },
    { name: 'waiting-room', pos: [8, 1.9, 18.8], at: [5.8, 1.2, 23.4] }],
  defaults: ['eyes', 'counter'],
  async run(c) {
    for (const [npc, question, reply] of [
      ['caf_luis', 'Hi — how is your shift going?', 'took the requests'],
      ['sec_dave', 'Luis said you took requests. Who made the last one?', 'last waltz'],
      ['caf_rn_mei', 'Dave told me about the waltz. Did your dad get to hear it?', 'Night frequency pin is yours'],
    ]) {
      const at = await c.ev<{x:number; z:number; yaw:number}>(`__acWorld.npc('${npc}')`);
      if (npc === 'sec_dave') {
        await c.page.keyboard.press('Escape');
        await c.page.getByText(/Find Dave Morrison in the ED waiting room/).waitFor();
        await c.cam('first');
        await c.tp(4.7, 13.8, 0, -5);
        await c.ev('__acWorld.walkTo(6.6,21.95)');
        if (!await c.until(() => c.ev<boolean>("__acWorld.focus()?.key === 'npc:sec_dave'"), 16000)) {
          throw new Error('Could not approach Dave from the corridor: ' + JSON.stringify(await c.ev('__acWorld.state()')));
        }
        await c.shoot('Dave by the parking-lot doors', { rigs: ['eyes', 'waiting-room'], region: { x: at.x, z: at.z, r: 0.6 } });
        await c.page.keyboard.press('KeyE');
      } else {
        await c.tp(at.x + 1.2 * Math.sin(at.yaw), at.z + 1.2 * Math.cos(at.yaw), deg(at.yaw) + 180);
        await c.ev(`__ac.store.set({panel:{kind:'npc',npcId:'${npc}'},tabletMin:false})`);
      }
      const tablet = c.page.locator('.tablet .talk');
      if (npc === 'caf_luis') await tablet.getByText(/hums them back/).waitFor();
      await tablet.getByRole('button', { name: question, exact: true }).click();
      await tablet.locator('.bubble.npc').filter({ hasText: reply }).waitFor();
      if (npc === 'caf_rn_mei') {
        await tablet.getByRole('status').filter({ hasText: 'Night frequency pin' }).waitFor();
        await c.page.getByRole('button', { name: /My locker/ }).click();
        await c.page.getByRole('dialog', { name: 'My locker' }).getByText('Night frequency pin', { exact: true }).waitFor();
      }
      await c.shoot(npc === 'caf_luis' ? 'A tune at the till' : npc === 'sec_dave' ? 'The last request' : 'Pin received', { target: npc, region: { x: at.x, z: at.z, r: 0.6 } });
    }
  },
};

const nurseCollision: Scene = {
  id: 'nurse-collision', title: 'Passing a nurse in the main corridor', map: 'orientation', seed: 9,
  about: 'Walk up to the charge nurse, then take the open route around her.',
  region: { x: 13, z: 11, r: 1 },
  rigs: [{ name: 'side', pos: [12.2, 1.5, 13.6], at: [12.8, 0.95, 11] },
    { name: 'hall', pos: [15.1, 1.6, 12.2], at: [12.9, 0.9, 11] },
    { name: 'ward-side', pos: [61.2, 4.5, 12.7], at: [61.25, 3.95, 11] },
    { name: 'ward-hall', pos: [63.8, 4.6, 10.1], at: [61.25, 3.95, 11] }],
  defaults: ['side', 'hall'],
  async run(c) {
    await c.ev("__acWorld.standNpc('rn_rosa', 13, 11, -90)");
    for (const mode of ['first', 'third'] as const) {
      await c.cam(mode);
      await c.tp(11.5, 11, 90, 0);
      await c.page.keyboard.down('ShiftLeft');
      await c.page.keyboard.down('KeyW');
      try { await c.wait(1300); } finally {
        await c.page.keyboard.up('KeyW');
        await c.page.keyboard.up('ShiftLeft');
      }
      const at = await c.ev<{ x: number; z: number }>('__acWorld.state()');
      if (at.x < 12.33 || at.x > 12.5 || Math.abs(at.z - 11) > 0.08)
        throw new Error(mode + ' allowed the resident to pass through the nurse: ' + JSON.stringify(at));
    }
    await c.shoot('Stopped in front of the charge nurse');
    await c.tp(11.5, 11, 90, 0);
    await c.ev('__acWorld.walkTo(14.5, 11)');
    if (!await c.until(async () => {
      const at = await c.ev<{ x: number; z: number }>('__acWorld.state()');
      if (Math.hypot(at.x - 13, at.z - 11) < 0.52) throw new Error('Click route crossed the nurse');
      return Math.hypot(at.x - 14.5, at.z - 11) < 0.18;
    }, 12000, 50)) throw new Error('Failed to walk around the nurse');
    await c.shoot('On the far side of the nurse');

    await c.ev('__acWorld.teleportY(53.5, 4.0, 3, 90, 0)');
    await c.page.waitForFunction('__acWorld.floors().level === 1');
    if (!await c.ev("__acWorld.walkNpc('ward_theo', 60, 11, 90)")) throw new Error('Ward nurse is missing');
    const nurse = () => c.ev<{ x: number; z: number; walking: boolean }>(
      "__acWorld.floors().ward.find(n => n.id === 'ward_theo')");
    if (!await c.until(async () => { const n = await nurse(); return !n.walking && Math.abs(n.x - 60) < 0.1; }, 45000))
      throw new Error('Ward nurse did not reach the corridor: ' + JSON.stringify(await nurse()));
    await c.ev('__acWorld.teleportY(61.5, 11, 3, -90, 0)');
    await c.ev("__acWorld.walkNpc('ward_theo', 63, 11, 90)");
    if (!await c.until(async () => (await nurse()).x > 60.85, 6000)) throw new Error('Ward nurse did not approach');
    await c.wait(1300);
    const held = await nurse();
    if (held.x >= 61.1 || !held.walking) throw new Error('Ward nurse walked through the stationary resident');
    await c.shoot('The ward nurse waits for the resident to pass', { rigs: ['ward-side', 'ward-hall'], region: { x: 61.5, z: 11, r: 0.7 } });
    await c.ev('__acWorld.teleportY(61.5, 12, 3, -90, 0)');
    if (!await c.until(async () => !(await nurse()).walking, 6000)) throw new Error('Ward nurse did not resume her round');
  },
};

const waitingCollision: Scene = {
  id: 'waiting-collisions', title: 'Walking through the waiting room', map: 'orientation', seed: 9,
  about: 'Walk into an empty steel chair, a seated visitor and a standing guard, then use the aisle to pass the chairs.',
  region: { x: 4, z: 18.2, r: 0.65 },
  rigs: [{ name: 'aisle', pos: [8.2, 2.5, 17.2], at: [3.8, 0.9, 18.2] }, { name: 'eyes', eyes: true }],
  async run(c) {
    await c.cam('first');
    const drive = async () => {
      await c.page.keyboard.down('KeyW');
      try { await c.wait(1700); } finally { await c.page.keyboard.up('KeyW'); }
      return c.ev<{x:number; z:number}>('__acWorld.state()');
    };
    const chairX = 3.45;
    await c.tp(chairX, 16.9, 0);
    const empty = await drive();
    if (empty.z < 17.35 || empty.z > 17.75) throw new Error('Empty chair did not stop the walk: ' + JSON.stringify(empty));
    await c.shoot('Stopped at an empty chair');
    const seated = await c.ev<{x:number;z:number;yaw:number}>("__acWorld.npc('vis_1')");
    const fx = Math.sin(seated.yaw), fz = Math.cos(seated.yaw);
    await c.tp(seated.x + 1.6 * fx, seated.z + 1.6 * fz, deg(seated.yaw) + 180);
    const knees = await drive();
    const clearance = (knees.x - seated.x) * fx + (knees.z - seated.z) * fz;
    if (clearance < 1.10 || clearance > 1.48) throw new Error('Walk entered the seated visitor’s feet: ' + clearance);
    const guard = await c.ev<{x:number;z:number}>("__acWorld.npc('sec_dave')");
    await c.tp(guard.x, guard.z - 1.45, 0);
    const standing = await drive();
    if (standing.z > guard.z - 0.48 || standing.z < guard.z - 0.9) throw new Error('Standing guard clearance: ' + JSON.stringify(standing));
    await c.shoot('Stopped beside the guard', {region:{ x:guard.x, z:guard.z, r:0.55 }});
    await c.tp(5.65, 16.95, 0);
    await c.ev('__acWorld.walkTo(5.65,19.45)');
    if (!await c.until(async () => {
      const here = await c.ev<{x:number;z:number}>('__acWorld.state()');
      return Math.hypot(here.x - 5.65, here.z - 19.45) < 0.22;
    }, 18000)) throw new Error('Click-to-walk did not get around the row');
    await c.shoot('Through the aisle');
  },
};

const rotationLocker: Scene = {
  id: 'rotation-locker', title: 'The resident’s locker', map: 'orientation', seed: 9, showUI: true,
  about: 'Read the directions from the rotation HUD, find the numbered door and open it to see this rotation’s souvenirs.',
  region: { x: 49.8, z: 14.1, r: 0.85 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'shelf', pos: [49.69, 4.55, 14.37], at: [49.8, 4.25, 13.4] }],
  async run(c) {
    const panel = c.page.getByRole('dialog', { name: 'My locker' });
    await c.page.getByRole('button', { name: 'My locker', exact: true }).click();
    await panel.getByText(/Your locker is empty/).waitFor();
    await panel.getByRole('button', { name: 'Close' }).click();
    const items = ['Night frequency pin', 'Tiny brass key', 'Surgeon’s vest'];
    // A returning resident's rotation, as loaded from a slot.
    await c.ev(`__ac.store.set({rotation:{...__ac.store.get().rotation,xp:100,items:${JSON.stringify(items)}}})`);
    await c.cam('first');
    await c.ev('__acWorld.teleportY(49.8,14.85,3,180,-8)');
    await c.wait(650);
    const door = () => c.ev<string | null>('__acWorld.focus()?.key');
    if (!await c.until(async () => await door() === 'cab:f2_lng_lockers:2', 3500)) throw new Error('Resident door focus: ' + await door());
    await c.shoot('Find locker 13');
    await c.ev('__acWorld.teleportY(49.8,14.30,3,180,-8)');
    await c.wait(250);
    await c.page.keyboard.press('KeyE');
    for (const item of items) await panel.getByText(item, { exact: true }).waitFor();
    await c.wait(1100);
    await c.shoot('Open the collection');
    // Walk into the space previously swept by the door to look at the pin at eye level.
    await c.ev('__acWorld.teleportY(49.8,14.65,3,180,0)');
    const opening = () => c.ev<number>("__acWorld.cabinets().units.find(u => u.id === 'f2_lng_lockers').parts[2].open");
    if (await opening() < 0.999) throw new Error('Locker 13 did not open fully');
    await c.page.keyboard.down('KeyW');
    try {
      if (!await c.until(async () => {
        if (await opening() < 0.999) throw new Error('Open locker door swung back toward the pin');
        return await c.ev<boolean>('__acWorld.state().z < 14.02');
      }, 3000)) throw new Error('Could not step up to the shelf');
    } finally { await c.page.keyboard.up('KeyW'); }
    await c.wait(450);
    if (await opening() < 0.999) throw new Error('Locker door moved while reading the shelf');
    await c.shoot('Step closer to the pin');
    await c.page.keyboard.press('Escape');
    await c.shoot('Keepsakes on the shelf');

    await c.page.getByRole('button', { name: /My locker/ }).click();
    await c.page.getByRole('button', { name: 'Save game', exact: true }).click();
    const save = c.page.getByRole('dialog', { name: 'Save game' });
    await save.locator('.slot-row').first().click();
    await save.getByLabel('Save name').fill('Resident collection');
    await save.getByRole('button', { name: 'Save game', exact: true }).click();
    await save.waitFor({ state: 'hidden' });
    await c.ev('__ac.client.leaveSolo()');
    await c.page.getByRole('button', { name: 'Load game' }).click();
    const load = c.page.getByRole('dialog', { name: 'Load game' });
    await load.getByRole('button', { name: /Resident collection/ }).click();
    await load.getByRole('button', { name: 'Load game', exact: true }).click();
    await c.page.waitForSelector('.loading-screen.done', { timeout: 120000 });
    for (const item of items) await panel.getByText(item, { exact: true }).waitFor();
    await c.shoot('After loading the slot');

    // Back straight away from the open door, with the collection still on screen.
    const start = await c.ev<{ x: number; z: number }>('__acWorld.state()');
    await c.page.keyboard.down('KeyS');
    try {
      await panel.waitFor({ state: 'hidden', timeout: 5000 });
      if (!await c.until(async () => {
        const pos = await c.ev<{ x: number; z: number }>('__acWorld.state()');
        return Math.hypot(pos.x - start.x, pos.z - start.z) > 2.5;
      }, 3000)) throw new Error('Holding S stopped moving when the locker panel closed');
    } finally { await c.page.keyboard.up('KeyS'); }
    await c.shoot('Walk away from the locker');
  },
};

const laptopCart: Scene = {
  id: 'laptop-cart', title: 'The mobile charting cart', map: 'orientation', seed: 9,
  about: 'The desktop holds the laptop and its flat badge reader.',
  region: { x: 15.6, z: 10.15, r: 0.5 },
  rigs: [{ name: 'front', pos: [14.68, 1.48, 10.48], at: [15.6, 1.04, 10.15] },
    { name: 'side', pos: [15.08, 1.54, 9.51], at: [15.6, 1.04, 10.15] }],
  async run(c) { await c.shoot('Laptop and badge reader'); },
};

const stationSupplies: Scene = {
  id: 'station-supplies', title: 'Supplies beside the staff phone', map: 'orientation', seed: 9,
  about: 'Pick up the phone from the south counter and recover the free hand from an older shift.',
  region: { x: 20, z: 12.25, r: 1.8 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'counter', pos: [21.4, 1.8, 13.8], at: [19.8, 1.07, 12.25] }],
  async run(c) {
    const phone = await c.ev<{id:string; x:number; y:number; z:number}>("__acWorld.listItems().find(i => i.kind === 'phoneMobile' && Math.abs(i.z - 12.25) < 0.2)");
    const pack = await c.ev<{id:string}>("__acWorld.listItems().find(i => i.kind === 'gauzePack' && Math.abs(i.z - 12.25) < 0.2)");
    const hasShears = () => c.ev<boolean>(`__acWorld.listItems().some(i => i.kind === 'traumaShears')
      || __acWorld.cabinets().units.some(u => u.parts.some(p => p.stowed.includes('traumaShears')))`);
    if (!phone || !pack || await hasShears()) throw new Error('Unexpected station or cart stock');
    await c.cam('first');
    await c.tp(phone.x, phone.z + 1.0, 180, -30);
    await c.shoot('Phone and gauze on the counter');
    const { camY } = await c.ev<{camY:number}>('__acWorld.state()');
    await c.ev(`__acWorld.look(0,${deg(Math.atan2(phone.y - camY, 1))})`);
    if (!await c.until(() => c.ev<boolean>(`__acWorld.focus()?.label === 'Pick up mobile phone'`), 3000)) throw new Error('Cannot reach the phone');
    await c.page.keyboard.press('KeyE');
    const phoneInHand = () => c.ev<boolean>(`__acWorld.amenities().held.length === 1 && __acWorld.amenities().held[0].id === '${phone.id}'`);
    if (!await phoneInHand()) throw new Error('Phone pickup failed');

    // Restore an old checkpoint with the counter shears in the left hand and another pair in a closed cart.
    const sessionId = await c.ev<string>('__ac.store.get().view.sessionId');
    await c.ev(`(async () => {
      const { playerSave, saveOwner } = await import('/src/rotation.ts');
      const player = playerSave();
      const counter = player.world.items.find(item => item.key === '${pack.id}');
      const cart = player.world.cabinets.filter(unit => unit.id.includes('crash')).flatMap(unit => unit.parts)
        .flatMap(part => part.contents).find(item => item.kind === 'gauzePack');
      for (const item of [counter, cart]) Object.assign(item, { kind: 'traumaShears', label: 'trauma shears' });
      Object.assign(counter, { hand: 'L', order: 1 });
      __ac.client.send({ type: 'save_slot', owner: saveOwner(), slot: 1, revision: null, name: 'Previous stock', player });
    })()`);
    if (!await c.until(() => c.ev<boolean>("__ac.store.get().lastSave?.name === 'Previous stock'"), 5000)) throw new Error('Legacy slot was not written');
    await c.ev('__ac.client.loadSlot(1)');
    if (!await c.until(() => c.ev<boolean>(`!!__ac.store.get().view && __ac.store.get().view.sessionId !== '${sessionId}'`), 5000)) throw new Error('Legacy slot was not loaded');
    await c.page.waitForSelector('.loading-screen.done', { timeout: 120000 });
    if (await hasShears() || !await phoneInHand() || await c.ev<boolean>(`__acWorld.listItems().some(i => i.id === '${pack.id}')`)) {
      throw new Error('The old checkpoint did not restore the phone with the other hand free');
    }
    await c.ev('__acWorld.look(0,-10)');
    await c.shoot('Phone in hand after loading');
  },
};

/** A case has no home room: film the actual patient in the bay the seeded intake assigned. */
function catalogScene(solo: boolean): Scene {
  const id = solo ? 'single-case' : 'mixed-shift';
  const complaint = 'Pain below the right ribs after dinner';
  return {
    id, title: solo ? 'A presentation from the case catalog' : 'A fresh intake on the mixed shift',
    about: 'Check that each selected chart has the matching person and bedside furniture in the assigned bay.',
    seed: 314, map: solo ? 'practice' : 'mixed_shift',
    region: { x: 0, z: 0, r: 1 },
    rigs: [
      { name: 'side', follow: '', off: [1.65, 1.5, 0.8], look: 1 },
      { name: 'foot', follow: '', off: [0.65, 1.65, 2.3], look: 1 },
    ],
    selectAtMenu: solo ? async page => {
      await page.getByRole('button', { name: /Single case practice/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Choose a practice case' });
      const search = dialog.getByRole('searchbox');
      await search.fill('no such chief complaint');
      await dialog.getByText('No matching cases.').waitFor();
      await dialog.getByRole('checkbox').check();
      await search.fill('biliary_colic');
      await dialog.getByRole('button', { name: /Pain below the right ribs after dinner/ }).waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 3000 });
      await page.getByRole('button', { name: /Single case practice/ }).click();
      await search.fill('right ribs');
      const row = dialog.getByRole('button', { name: new RegExp(complaint) });
      await row.waitFor();
      await dialog.screenshot({ path: path.join(out, id, 'picker.png') });
      await row.click();
      await page.getByRole('button', { name: /Single case practice.*Pain below the right ribs/ }).waitFor();
    } : undefined,
    async run(c) {
      type Row = { id: string; bed: string; bedLabel: string; chiefComplaint: string; arrivedAt: number };
      const intake = () => c.ev<Row[]>('__ac.store.get().view.board.filter(p => p.departedAt == null)');
      const shoot = async (row: Row) => {
        const npc = 'pt_' + row.id;
        await c.ev(`__acWorld.curtain(${JSON.stringify(row.bed)}, 'snap-open')`);
        const region = await npcRegion(c, npc, 0.85);
        if (!region) throw new Error('Missing avatar in ' + row.bedLabel);
        await c.shoot(row.bedLabel + ': ' + row.chiefComplaint, { target: npc, region });
      };
      const first = await intake();
      if (solo && (first.length !== 1 || first[0].chiefComplaint !== complaint)) throw new Error('Practice opened a different case');
      if (!solo && first.length < 2) throw new Error('Mixed shift did not open with concurrent patients');
      await shoot(first[0]);
      if (solo) {
        const sessionId = await c.ev<string>('__ac.store.get().view.sessionId');
        const endpoint = new URL('/api/sessions/' + sessionId + '/debrief', c.page.url()).href;
        if ((await c.page.request.get(endpoint)).status() !== 409) throw new Error('The case answer is accessible before shift end');
        await c.ev("__ac.client.act({ type: 'end_shift' })");
        await c.page.waitForFunction(() => !!(window as any).__ac.store.get().debrief);
        const result = await (await c.page.request.get(endpoint)).json();
        if (result.cases?.length !== 1 || result.cases[0].origin?.kind !== 'original') throw new Error('Completed case is missing its attribution');
      } else {
        await c.ev(`__ac.client.act({ type: 'wait', minutes: 18 })`);
        const newer = () => intake().then(rows => rows.find(row => !first.some(old => old.id === row.id)));
        if (!await c.until(async () => !!await newer(), 5000)) throw new Error('Next arrival missing');
        const rows = await intake();
        if (new Set(rows.map(row => row.bed)).size !== rows.length) throw new Error('A bay has two active patients');
        await shoot((await newer())!);
      }
    },
  };
}

/** Keep the third case ambulatory as the catalog grows, and use the actual seeded intake. */
function walkInScene(): Scene {
  let seed = 1;
  while (seed < 500) {
    const candidate = resolveScenario('mixed_shift', seed)!.patients[2];
    if (candidate && CASES[candidate.caseId].presentation.walkToBed) break;
    seed++;
  }
  return {
    id: 'walk-in-arrival', title: 'A walk-in comes through the ED entrance and takes a bay',
    about: 'The same patient walks through the department and becomes available for care at the bedside.',
    map: 'mixed_shift', seed, region: { x: 5, z: 22, r: 1.2 },
    rigs: [
      { name: 'side', follow: '', off: [1.9, 1.55, 0.6], look: 1 },
      { name: 'front', follow: '', off: [0.45, 1.58, 1.35], look: 1 },
    ],
    async run(c) {
      const slot = resolveScenario('mixed_shift', seed)!.patients[2];
      const start = slot.arriveAtMin * 60;
      const t = await c.gameT();
      if (t < start) await c.ev(`__ac.client.act({ type: 'wait', minutes: ${(start - t) / 60} })`);
      type Walk = { id: string; walkIn: { patientId: string; since: number; until: number; bed: string } };
      const inbound = () => c.ev<Walk | undefined>('__ac.store.get().view.npcs.find(n => n.walkIn)');
      if (!await c.until(async () => !!await inbound(), 7500)) throw new Error('No walk-in at the scheduled time');
      const { id, walkIn: walk } = (await inbound())!;
      const idArg = JSON.stringify(id), pidArg = JSON.stringify(walk.patientId);
      const shoot = async (label: string) => {
        const region = await npcRegion(c, id, 0.9);
        if (!region) throw new Error('Walk-in avatar disappeared');
        await c.shoot(label, { region, target: id });
      };
      await c.page.waitForFunction(`__acWorld.npc(${idArg})?.walking`, undefined, { timeout: 10000 });
      const overlap = await c.ev<string | null>(`__acWorld.dischargeRouteAudit(${idArg})`);
      if (overlap) throw new Error('Blocked intake path: ' + overlap);
      if (await c.ev(`__ac.store.get().view.board.some(r => r.id === ${pidArg})`)) throw new Error('Patient already roomed at the door');
      await shoot('Through the public entrance');
      if (!await c.untilGameT(walk.since + 0.48 * (walk.until - walk.since), 90000)) throw new Error('Walk-in stopped');
      await shoot('Crossing to the treatment bays');
      await c.page.waitForFunction(`__ac.store.get().view.npcs.some(n => n.id === ${idArg} && n.talkable && n.spot === 'bed')`, undefined, { timeout: 90000 });
      const row = await c.ev<{ bed: string }>(`__ac.store.get().view.board.find(r => r.id === ${pidArg})`);
      if (row.bed !== walk.bed) throw new Error('Assigned bed changed during arrival');
      await c.ev(`__acWorld.curtain(${JSON.stringify(row.bed)}, 'snap-open')`);
      await c.wait(1400);
      await shoot('Roomed and ready for assessment');
    },
  };
}

const surgeCensus: Scene = {
  id: 'surge-census', title: 'Full Roster at shift change', map: 'mixed_roster', seed: 19,
  about: 'The ED rooms and three hallway stretchers are occupied. The resident can open another stretcher immediately.',
  showUI: true, region: { x: 5.35, z: 10.5, r: 0.85 },
  rigs: [{ name: 'corridor', pos: [10.3, 2.1, 12.15], at: [4.2, 0.95, 10.45] },
    { name: 'bedside', pos: [6.2, 1.55, 12.2], at: [5.3, 0.9, 10.5] },
    { name: 'east', pos: [34.4, 1.6, 13.0], at: [32.4, 1, 11.1] },
    { name: 'head', pos: [30.6, 1.55, 11.9], at: [32.4, 0.95, 11.1] }],
  async run(c) {
    await c.ev('__ac.client.settings({ paused: true })');
    const active = () => c.ev<{ bed: string; id: string }[]>('__ac.store.get().view.board.filter(r => r.departedAt == null)');
    const census = await active();
    if (census.length !== 14 || new Set(census.map(r => r.bed)).size !== 14) throw new Error('Opening census incomplete');
    await c.page.locator('.hud-clock').screenshot({ path: path.join(out, 'surge-census', 'control.png') });
    await c.page.addStyleTag({ content: '.hud > :not(.hud-clock), .wl-hint { visibility: hidden !important; }' });
    await c.shoot('Three occupied stretchers in the main corridor', { rigs: ['corridor', 'bedside'] });
    await c.page.getByRole('button', { name: '+ Patient', exact: true }).click();
    await c.page.waitForFunction('__ac.store.get().view.board.length === 15');
    const added = (await active()).find(p => !census.some(a => a.id === p.id))!;
    if (added.bed !== 'hall_4') throw new Error('Wrong overflow stretcher');
    if (!await c.until(() => c.ev<boolean>("!!__acWorld.npcCare('rn_hall')"),15000))
      throw new Error('The hallway nurse never reached the patient for assessment');
    await c.shoot('Immediate admission on the fourth hallway stretcher', { rigs: ['east','head'], region: { x: 32.3, z: 11.1, r: 0.85 } });
  },
};

function surgeArrival(mode: 'ambulance' | 'walking' | 'wheelchair'): Scene {
  const ems = mode === 'ambulance';
  let seed = 1;
  const rows = (n: number) => resolveScenario('mixed_roster', n)!.patients;
  const first = (n: number) => rows(n).find(r => r.arriveAtMin > 0)!;
  while (seed < 500) {
    const c = CASES[first(seed).caseId].presentation;
    if (ems ? c.arrivalMode === 'EMS' : c.arrivalMode === 'Walk-in' && c.esi >= 3 && !!c.walkToBed === (mode === 'walking')) break;
    seed++;
  }
  return { id: ems ? 'surge-ambulance' : mode === 'walking' ? 'surge-waiting' : 'surge-wheelchair', map: 'mixed_roster', seed,
    title: ems ? 'From the ambulance to an occupied department' : mode === 'walking' ? 'From registration to a surge bed' : 'Wheelchair transport from registration',
    about: 'Follow one arriving patient from the entrance through intake and into the assigned treatment space.',
    region: {x: 0, z: 0, r: 1},
    rigs: [{ name: 'side', follow: '', off: [2.1,1.6,0.6], look: 0.95 }, { name: 'rear', follow: '', off: [-0.75,2.0,1.65], look: 0.85 }],
    async run(c) {
      const start = first(seed).arriveAtMin * 60;
      const t = await c.gameT();
      if (t < start) await c.ev(`__ac.client.act({type:'wait',minutes:${(start-t)/60}})`);
      const incoming = () => c.ev<{id:string;walkIn:{patientId:string;stage:string;until:number;since:number}} | null>(
        "__ac.store.get().view.npcs.find(n=>n.role==='patient' && n.walkIn?.stage==='intake') ?? null");
      if (!await c.until(async()=>!!await incoming(),4000)) throw new Error('Arrival missing');
      const { id, walkIn } = (await incoming())!;
      const shoot = async (label: string) => {
        const region = await npcRegion(c,id,1.05);
        if (!region) throw new Error('Missing arrival actor');
        await c.shoot(label,{ target:id,region });
      };
      await c.ev('__ac.client.settings({ paused: true })');
      await c.wait(450);
      const issue = await c.ev(`__acWorld.dischargeRouteAudit('${id}')`);
      if (issue) throw new Error('No clear route from entrance: ' + issue);
      if (ems && !(await c.ev(`__acWorld.npc('${id}').posture === 'lie'`))) throw new Error('EMS patient is not lying on the trolley');
      await shoot(ems ? 'Crew at the ambulance entrance' : 'Patient at the public entrance');
      await c.ev(`__ac.client.act({type:'wait',minutes:${(walkIn.until - await c.gameT() + 2)/60}})`);
      await c.page.waitForFunction(`__ac.store.get().view.npcs.find(n=>n.id==='${id}')?.walkIn?.stage==='bed'`);
      const leg = await c.ev<{since:number;until:number}>(`__ac.store.get().view.npcs.find(n=>n.id==='${id}').walkIn`);
      await c.ev(`__ac.client.act({type:'wait',minutes:${(leg.until-leg.since)*0.55/60}})`);
      await c.wait(300);
      if (await c.ev(`__acWorld.dischargeRouteAudit('${id}')`)) throw new Error('Transport has no clear route: '+await c.ev(`__acWorld.dischargeRouteAudit('${id}')`));
      await shoot('Passing through the department');
      await c.ev(`__ac.client.act({type:'wait',minutes:${(leg.until - await c.gameT() + 2)/60}})`);
      await c.page.waitForFunction(`__ac.store.get().view.board.some(p=>p.id==='${walkIn.patientId}')`);
      await c.wait(600);
      await shoot('Same patient in the assigned bed');
      if (mode !== 'walking') {
        const crew = 'intake_escort_' + walkIn.patientId;
        const tripHome = await c.ev<{since:number;until:number;stage:string}>(`__ac.store.get().view.npcs.find(n=>n.id==='${crew}').walkIn`);
        if (tripHome.stage !== 'return') throw new Error('Transport crew did not return for another arrival');
        await c.ev(`__ac.client.act({type:'wait',minutes:${(tripHome.until-tripHome.since)*0.45/60}})`);
        await c.wait(250);
        const route = await c.ev(`__acWorld.dischargeRouteAudit('${crew}')`);
        if (route) throw new Error('Empty transport cannot return: '+route);
      }
    }
  };
}

const surgeVisitors: Scene = {
  id: 'surge-visitors', title: 'Family, nurses and restroom traffic on Full Roster', map: 'mixed_roster', seed: 19,
  about: 'Look in on a visitor at the bedside, the occupied waiting room and a visitor walking from there to the public restrooms.',
  region: { x: 4, z: 18, r: 1 },
  rigs: [{ name: 'room', pos: [7.45,1.65,5.95], at:[5.8,1,3.25] },
    { name: 'other-side', pos: [4.45,1.7,1.5], at:[6.1,1.0,3.5] },
    { name: 'lobby', pos: [6.65, 2.2, 22.55], at: [3.45, 0.9, 18.35] },
    { name: 'desk', pos: [7.4, 1.8, 17.25], at: [3.6, 1, 20.2] },
    { name: 'door', pos: [68.55,1.64,5.2], at:[69.45,1,3.42] },
    { name: 'sink', pos: [68.0,1.55,2.0], at:[69.65,1,3.45] }],
  async run(c) {
    const family = await c.ev<string>("__ac.store.get().view.npcs.find(n=>n.role==='family' && n.location==='bed_2').id");
    await c.shoot('Family at the bedside', { target: family, rigs:['room','other-side'], region: await npcRegion(c,family,0.6) });
    await c.shoot('Visitors in the waiting room', { rigs:['lobby','desk'], region:{x:3.55,z:18.2,r:0.55} });
    const def = resolveScenario('mixed_roster',19)!;
    const plan = planAmbient({seed:19,mapId:def.id,layout:LAYOUTS[def.layoutId],durationMin:def.durationMin,timeScale:def.defaultTimeScale,shiftStart:def.shiftStart})!;
    const visit = plan.people.get('vis_3')!.segs.find(v=>v.room==='restrooms')!;
    await c.ev('__ac.client.settings({paused:true})');
    const t = await c.gameT();
    if (t < visit.t0+2) await c.ev(`__ac.client.act({type:'wait',minutes:${(visit.t0+2-t)/60}})`);
    if (!await c.until(() => c.ev<boolean>("__acWorld.npc('vis_3').x > 68.9 && __acWorld.npc('vis_3').z < 4.3"), 150000))
      throw new Error('Visitor did not physically reach the public restroom: '+JSON.stringify(await c.ev("__acWorld.npc('vis_3')")));
    await c.shoot('The waiting room visitor reaches the restroom', { rigs:['door','sink'], region:{ x:69.65,z:3.45,r:1 } });
    const home = plan.people.get('vis_3')!.segs.find(v=>v.t0>visit.t1 && v.room==='waiting' && v.posture==='sit')!;
    await c.ev(`__ac.client.act({type:'wait',minutes:${(home.t0+2-await c.gameT())/60}})`);
    if (!await c.until(() => c.ev<boolean>("__acWorld.npc('vis_3').posture==='sit' && __acWorld.npc('vis_3').x < 10"),150000))
      throw new Error('The visitor never returned to the waiting room chair');
  }
};

const browserDemo: Scene = {
  id: 'browser-demo', map: 'browser_demo', title: 'A walk through the browser demo',
  about: 'Enter from the public demo menu, approach the ED tech and speak to a patient at the bedside.',
  showUI: true, region: { x: 14, z: 11, r: 2.1 },
  rigs: [
    { name: 'corridor', pos: [15.3, 1.65, 8.15], at: [13.3, 1.05, 11.3] },
    { name: 'bedside', pos: [7.65, 1.7, 4.9], at: [5.9, 1, 2.8] },
    { name: 'eyes', eyes: true },
  ],
  async run(c) {
    const { page } = c;
    await checkTourDefaults(page);
    await page.screenshot({ path: path.join(out, 'browser-demo', 'entry-desktop.png') });
    await c.cam('third'); // restore the tour camera after each shot from a fixed rig
    const { x, z } = await c.ev<{x: number; z: number}>('__acWorld.state()');
    await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(`Math.hypot(__acWorld.state().x - ${x}, __acWorld.state().z - ${z}) > 0.65`, undefined, { timeout: 10000 });
    } finally { await page.keyboard.up('KeyW'); }
    await page.waitForFunction("__acWorld.focus()?.key === 'npc:tech_marcus'");
    await c.shoot('Meet the ED tech in the corridor', { rigs: ['corridor', 'eyes'] });
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: 'Where should I start?' }).click();
    const reply = page.locator('.tablet .bubble.npc .bubble-text').last();
    await reply.filter({ hasText: /nurses' station/ }).waitFor();
    await checkMarcusRecording(page);
    await page.keyboard.press('Escape');
    await page.locator('.tablet').waitFor({ state: 'hidden' });

    // Stage the next camera at the right rail. E still has to pick the live patient's body.
    await c.cam('first');
    await c.tp(7.2, 2.9, -116, -30);
    const patient = await c.ev<string>("__ac.store.get().view.npcs.find(n => n.role === 'patient' && n.patientId === 'p_keller').id");
    await page.waitForFunction(`__acWorld.focus()?.key === ${JSON.stringify('npc:' + patient)}`);
    await page.keyboard.press('KeyE');
    const question = 'What brings you in today?';
    const first = demoAnswer('pt_p_keller', question);
    const input = page.locator('.tablet textarea');
    await input.fill(question);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.tablet .bubble.player').getByText(question, { exact: true }).waitFor();
    await reply.filter({ hasText: /elephant.*chest/ }).waitFor();
    await page.locator('.tablet .bubble.npc .bubble-text:not(.dictating)').filter({ hasText: first.text }).waitFor();
    await clipsPlayed(page, first.clips);
    const answer = await reply.innerText();
    await c.shoot('Robert answers at the bedside', { rigs: ['bedside', 'eyes'], region: { x: 6, z: 2.4, r: 1.65 },
      checks: async () => {
        const blanket = await c.ev<{ least: number; cells: number } | null>(`__acWorld.inBed(${JSON.stringify(patient)})?.blanket`);
        if (!blanket || blanket.cells <= 60) throw new Error('Patient blanket was not measured');
        return blanket.least > 0.002 ? [] : [{ who: patient, kind: 'clipping', what: 'blanket',
          dist: Math.max(0, -blanket.least), detail: `blanket clears body by ${(blanket.least * 100).toFixed(1)} cm`, persistent: true }];
      },
    });
    await page.keyboard.press('Escape');
    await page.locator('.tablet').waitFor({ state: 'hidden' });
    await page.waitForFunction(`__acWorld.focus()?.key === ${JSON.stringify('npc:' + patient)}`);
    await page.keyboard.press('KeyE');
    const transcript = page.locator('.tablet .transcript');
    await transcript.evaluate((el, fullAnswer) => {
      const observer = new MutationObserver(() => {
        const old = el.querySelector('.bubble.npc');
        if (old?.querySelector('.bubble-text:not(.dictating)')?.textContent !== fullAnswer)
          el.setAttribute('data-old-answer-changed', 'yes');
      });
      observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    }, answer);
    await input.fill(question);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const replies = page.locator('.tablet .bubble.npc');
    await replies.nth(1).locator('.bubble-text.dictating').waitFor();
    if (await replies.count() !== 2 || await replies.first().locator('.bubble-text:not(.dictating)').textContent({ timeout: 1000 }) !== answer)
      throw new Error('The earlier answer changed when the patient repeated it');
    // asked again, he answers in short ("Like I said…"), in his recorded voice
    const again = demoAnswer('pt_p_keller', question, [question, first.text]);
    await replies.nth(1).locator('.bubble-text:not(.dictating)').filter({ hasText: again.text }).waitFor();
    if (await transcript.getAttribute('data-old-answer-changed')) throw new Error('The first answer restarted while the second streamed');
    await clipsPlayed(page, first.clips, 1);
    await clipsPlayed(page, again.clips, 1);
    if (await c.ev("globalThis.__demoSpoken.some(line => /elephant/i.test(line.text))"))
      throw new Error("Web Speech read Robert's recorded lines");
    c.note('Repeated a bedside question after returning. He answered in short ("Like I said"), only the new reply streamed, and each was spoken once in his recorded voice.');
    await page.getByRole('button', { name: /Examine$/ }).click();
    await page.getByRole('button', { name: /Jugular venous pressure/i }).click();
    await page.locator('.exam-findings').getByText(/JVP elevated/).waitFor();
    await page.getByRole('button', { name: /Plan$/ }).click();
    await page.getByPlaceholder('Add a working diagnosis…').fill('Chest pain');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.dx-row').filter({ hasText: 'Chest pain' }).waitFor();
    await page.getByRole('button', { name: 'Review ECG' }).click();
    await page.locator('.ehr-ecg-svg').waitFor();
    await page.getByPlaceholder('Rate, rhythm', { exact: false }).fill('Reviewed the 12-lead tracing.');
    await page.getByRole('button', { name: 'Sign interpretation' }).click();
    await page.locator('.ehr-signed').filter({ hasText: 'Reviewed the 12-lead tracing.' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(`__acWorld.focus()?.key === ${JSON.stringify('npc:' + patient)}`);
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: /Plan$/ }).click();
    await page.getByRole('button', { name: 'Open Diagnosis & Dispo' }).click();
    await page.locator('.ehr-dx-name').filter({ hasText: 'Chest pain' }).waitFor();
    c.note('Examined the patient and carried a working diagnosis from the Plan tab into the chart.');
    await page.keyboard.press('Escape');
    await c.ev("__ac.store.set({ panel: { kind: 'npc', npcId: 'rn_tom', tab: 'talk' } })");
    await page.getByRole('button', { name: 'How is Robert doing?' }).click();
    await clipsPlayed(page, demoAnswer('rn_tom', 'How is Robert doing?').clips);
    if (await c.ev("globalThis.__demoSpoken.some(line => /still describing pressure/i.test(line.text))"))
      throw new Error("Web Speech repeated Tom’s recording");
    await page.keyboard.press('Escape');
    await c.tp(6.05, 5.3, -90, -16);
    await page.waitForFunction("__acWorld.focus()?.key === 'npc:fam_linda'");
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: 'What did you notice?' }).click();
    await page.waitForFunction(`globalThis.__demoSpoken.some(line => /television/i.test(line.text) && line.voice === 'Samantha')`);
    await page.getByTitle('Voice', { exact: true }).click();
    await page.getByRole('button', { name: 'How did you get here?' }).click();
    await reply.filter({ hasText: 'I drove.' }).waitFor();
    if (await c.ev("__demoSpoken.some(line => /I drove/i.test(line.text))")) throw new Error('Muted reply was still voiced');
    await page.keyboard.press('Escape');
    // Closing a tablet restores captured look; free the cursor before using the HUD.
    if (await c.ev('!!document.pointerLockElement')) {
      await page.mouse.click(W / 2, H / 2, { button: 'right' });
      await page.waitForFunction('!document.pointerLockElement');
    }
    await page.getByRole('button', { name: 'Leave demo' }).click();
    await page.getByRole('button', { name: 'Enter the ED' }).waitFor();
  },
};

const tabletObjects: Scene = {
  id: 'tablet-objects', title: 'Object clicks beside an open tablet', map: 'orientation', seed: 9, showUI: true,
  about: 'With the nurse tablet open, click a nearby curtain, pick up the staff phone and log in at a workstation. Distant clicks and a drag must not interact or start walking.',
  region: { x: 5, z: 7.75, r: 0.65 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'hall', pos: [3.9, 1.9, 9.1], at: [5, 1.2, 7.1] }],
  async run(c) {
    await c.cam('first');
    const open = async () => {
      await c.ev("__ac.store.set({panel:{kind:'npc',npcId:'rn_rosa',tab:'talk'},tabletMin:false})");
      await c.page.locator('.tablet').waitFor();
      await c.wait(300);
    };
    await open();
    await c.ev("__acWorld.curtain('bed_2','snap-closed')");
    await c.tp(5, 10.75, 180, -4);
    await c.page.mouse.click(W / 2, H / 2);
    await c.wait(200);
    if (await c.ev("__acWorld.curtains().find(c => c.id === 'bed_2').state !== 'closed' || __acWorld.state().moving"))
      throw new Error('A distant tablet click interacted or started walking');
    await c.tp(5, 7.75, 180, -4);
    await c.wait(300);
    await c.page.mouse.move(W / 2, H / 2);
    await c.page.mouse.down();
    await c.page.mouse.move(W / 2 + 40, H / 2, { steps: 4 });
    await c.page.mouse.up();
    if (await c.ev("__acWorld.curtains().find(c => c.id === 'bed_2').state !== 'closed'"))
      throw new Error('Dragging with the tablet open interacted with the curtain');
    await c.tp(5, 7.75, 180, -4);
    await c.shoot('Tablet open beside the closed curtain');
    await c.page.mouse.click(W / 2, H / 2);
    if (!await c.until(() => c.ev("__acWorld.curtains().find(c => c.id === 'bed_2').state !== 'closed'"), 2500))
      throw new Error('Tablet click did not open the nearby curtain');
    await c.wait(1800);
    await c.shoot('Curtain opened with a scene click');

    const phone = await c.ev<{id:string;x:number;y:number;z:number}>("__acWorld.listItems().find(i => i.kind === 'phoneMobile' && Math.abs(i.z - 12.25) < 0.2)");
    if (!phone) throw new Error('Station phone missing');
    await c.tp(phone.x, phone.z + 1, 180, -30);
    const { camY } = await c.ev<{camY:number}>('__acWorld.state()');
    await c.ev(`__acWorld.look(0,${deg(Math.atan2(phone.y - camY, 1))})`);
    await c.wait(300);
    await c.page.mouse.click(W / 2, H / 2);
    if (!await c.until(() => c.ev(`__acWorld.amenities().held.some(i => i.id === '${phone.id}')`), 2500))
      throw new Error('Tablet click did not pick up the nearby phone');
    await c.page.keyboard.press('KeyG');
    await c.wait(300);

    const device = await c.ev<{screen:{x:number;y:number;z:number};rot:number}>("__acWorld.workstation().devices.find(d => d.id === 'st_pc_3')");
    const distance = 1.14, nx = Math.sin(device.rot), nz = Math.cos(device.rot);
    await c.tp(device.screen.x + nx * distance, device.screen.z + nz * distance,
      deg(Math.atan2(-nx, -nz)), deg(Math.atan2(device.screen.y - 1.65, distance)));
    await open();
    await c.wait(300);
    await c.page.mouse.click(W / 2, H / 2);
    await c.page.locator('.ehr-root').waitFor({ timeout: 8000 });
    c.note('Actual scene clicks opened the curtain, picked up the phone and started workstation login. Distant clicks and drag did not interact.');
  },
};

const settingsMenu: Scene = {
  id: 'settings-menu', title: 'Settings on Esc', map: 'orientation', seed: 9, showUI: true,
  about: 'Esc with nothing open shows the in-game settings over the hall. Closing restores the previous look-around or free-cursor mode when capture is permitted. The crosshair goes while settings are open; at 2× the same mouse movement turns the view twice as far.',
  region: { x: 8.4, z: 17.6, r: 0.75 },
  rigs: [{ name: 'eyes', eyes: true }, { name: 'hall', pos: [7, 1.8, 16], at: [8.4, 1.1, 17.6] }],
  async run(c) {
    await c.cam('first');
    await c.tp(8.4, 17.6, 90, -4);
    await c.wait(400);
    if (await c.ev('__ac.store.get().panel !== null')) throw new Error('Startup opened a panel');
    await c.page.locator('.wl-control-hint').getByText(/Esc: settings and controls/).waitFor();
    await c.shoot('Startup: capture or click fallback, Esc hint, no popup');
    await c.page.keyboard.press('Escape');
    await c.page.locator('.settings-panel').waitFor();
    if (await c.ev<string>("getComputedStyle(document.querySelector('.wl-crosshair')).visibility") !== 'hidden') throw new Error('The crosshair stayed while the settings were open');
    await c.shoot('Esc: the settings');
    await c.page.locator('.settings-panel input[type=range]').fill('2');
    if ((await c.page.textContent('.settings-slider b'))?.trim() !== '2.00×') throw new Error('The slider did not show 2×');
    await c.shoot('Mouse sensitivity at 2×');
    await c.page.keyboard.press('Escape');
    await c.page.locator('.settings-panel').waitFor({ state: 'hidden' });
    const before = await c.ev<number>('__acWorld.state().yaw');
    await c.ev("window.dispatchEvent(new CustomEvent('ac-doctor-look', { detail: { dx: 150, dy: 0 } }))");
    const turned = before - await c.ev<number>('__acWorld.state().yaw');
    if (Math.abs(turned - 150 * 0.0023 * 2) > 1e-6) throw new Error(`Turned ${turned} rad at 2×`);
    await c.wait(300);
    await c.shoot('Esc again: closed, the view turned at 2×');
    await c.page.mouse.click(400, 450, { button: 'right' });
    await c.wait(200);
    if (!await c.ev<boolean>('__acWorld.state().cursorMode && __ac.store.get().panel === null')) throw new Error('Right-click opened settings or failed to free the cursor');
    await c.shoot('Right-click: free cursor, settings closed', { rigs: ['eyes'] });
    await c.wait(5500);
    if (!await c.ev<boolean>('__acWorld.state().cursorMode')) throw new Error('The cursor mode timed out');
    await c.page.keyboard.press('Escape');
    await c.page.locator('.settings-panel').waitFor();
    await c.shoot('Esc from cursor mode: settings still work');

    c.note(`150 px of mouse movement turned the view ${deg(turned).toFixed(1)}° at 2× (${deg(150 * 0.0023).toFixed(1)}° at 1×).`);
  },
};

// ───────────────────────────── the title screen's online/offline switch (client/src/ui/LlmMode.tsx) ─────────────────────────────

/** what /api/llm-mode answers in this scene: fixed, so the frames never depend on what this machine has set up, and no probe runs */
const LLM_MODE_OPTIONS = {
  api: { ready: true, use: 'api', model: 'claude-haiku-5-5', label: 'Key configured · ANTHROPIC_API_KEY' },
  openai: { ready: true, use: 'openai-api', model: 'gpt-6-luna', label: 'Key configured · OPENAI_API_KEY' },
  claude: { ready: true, use: 'claude-code', model: 'haiku', label: 'Claude Code · your claude.ai login (Pro plan)', needsConsent: true, plan: true },
  codex: { ready: true, use: 'codex', model: 'gpt-6-luna', label: 'Codex · your Codex login', needsConsent: true },
  vllm: { ready: false, use: 'vllm', model: '', hint: 'No custom API: nothing answers at the default URL.' },
  none: { ready: true, use: 'none', label: 'Scripted NPCs, unless a shift picks one' },
};
const LLM_MODE_OFFLINE = {
  online: false, current: null, switching: false, canSwitch: true,
  status: { provider: 'offline', label: 'Offline NPCs (scripted, no LLM)', ok: true },
  options: LLM_MODE_OPTIONS,
  custom: { baseUrl: 'http://127.0.0.1:8000/v1', model: '' },
};

const llmMode: Scene = {
  id: 'llm-mode', title: 'Title screen: select, configure, apply', map: 'orientation', seed: 9, showUI: true,
  about: 'One settings form at a time, model choice on every connection, custom URL only for custom APIs, login consent, failed checks, and desktop/mobile layout. All requests use fixtures.',
  region: { x: 8.4, z: 17.6, r: 0.75 },
  rigs: [{ name: 'menu', eyes: true }],
  async run(c) {
    await c.page.setViewportSize({ width: 1280, height: 900 });
    let view: any = structuredClone(LLM_MODE_OFFLINE);
    const posts: { online: boolean; use?: string; model?: string; baseUrl?: string; consent?: string }[] = [];
    await c.page.route('**/api/llm-mode*', (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ json: view });
      const body = r.request().postDataJSON();
      posts.push(body);
      if (!body.online) {
        view = { ...view, online: false, current: null, status: LLM_MODE_OFFLINE.status };
      } else if (body.model === 'missing-model') {
        return r.fulfill({ status: 503, json: { error: 'The API server does not serve model "missing-model".' } });
      } else {
        const key = Object.keys(view.options).find((k) => view.options[k].use === body.use)!;
        const option = view.options[key];
        if (option.needsConsent && body.consent !== body.use) throw new Error('Login selected without consent.');
        const status = body.use === 'none' ? { provider: 'offline', label: 'Online · no default LLM', ok: true }
          : { provider: body.use === 'api' ? 'anthropic-api' : body.use, label: key === 'openai' ? 'OpenAI API' : key === 'vllm' ? 'Custom API' : option.label,
              model: body.model === 'haiku' && key === 'claude' ? 'Claude Haiku (latest)' : body.model, ok: true };
        view = { ...view, online: true, current: body.use, status,
          options: { ...view.options, [key]: { ...option, ready: true, needsConsent: false, model: body.model } },
          ...(body.use === 'vllm' ? { custom: { baseUrl: body.baseUrl, model: body.model } } : {}) };
      }
      return r.fulfill({ json: view });
    });
    await c.ev('__ac.client.leaveSolo()');
    const card = c.page.locator('.llm-mode');
    const summary = c.page.locator('.llm-summary');
    const openSettings = async () => {
      await summary.getByRole('button', { name: 'Change…', exact: true }).click();
      await card.waitFor({ state: 'visible' });
    };
    const applied = async () => {
      await card.waitFor({ state: 'hidden' });
      await openSettings();
    };
    await summary.getByRole('button', { name: 'Online', exact: true }).waitFor();
    await c.page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.llm-toggle button:last-child')?.disabled);
    const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); };
    const layoutAtWidth = new Map<string, { gridTop: number; logoTop: number }>();
    const fits = async (): Promise<Finding[]> => {
      const box = await summary.evaluate((el) => {
        const menu = document.querySelector('.menu')!;
        const grid = document.querySelector('.menu-grid')!;
        const logo = document.querySelector('.menu-logo')!;
        const header = document.querySelector('.menu-head')!;
        const dialog = document.querySelector('dialog.llm-mode')!;
        const rect = el.getBoundingClientRect();
        return { width: innerWidth, summaryText: el.textContent, gridTop: grid.getBoundingClientRect().top + menu.scrollTop,
          logoTop: logo.getBoundingClientRect().top + menu.scrollTop,
          topOffset: innerWidth >= 1100 ? logo.getBoundingClientRect().top - rect.top : 0,
          headerGap: header.getBoundingClientRect().bottom - Math.max(logo.getBoundingClientRect().bottom, rect.bottom),
          contentGap: grid.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
          summaryHeight: rect.height,
          overflow: Math.max(el.scrollWidth - el.clientWidth, dialog.hasAttribute('open') ? dialog.scrollWidth - dialog.clientWidth : 0),
          disclaimerInTitle: !!logo.querySelector('.menu-disclaimer') };
      });
      const key = `${box.width}:${box.summaryText}`;
      const base = layoutAtWidth.get(key);
      if (!base) layoutAtWidth.set(key, box);
      const out: Finding[] = [];
      const issue = (what: string, px: number) => out.push({ who: 'llm-mode', kind: 'overflow', what, dist: px / 100, detail: `${px} px` });
      if (Math.abs(box.topOffset) > 1) issue('title and connection card are not top-aligned', Math.abs(box.topOffset));
      if (box.overflow > 1) issue('connection controls spill sideways', box.overflow);
      if (box.headerGap > 1 || box.contentGap > 35) issue('empty space reserved under the header', box.headerGap + box.contentGap);
      if (box.summaryHeight > 130) issue('connection summary is not compact', box.summaryHeight);
      if (base && Math.abs(box.gridTop - base.gridTop) > 1) issue('opening settings moves the content below', Math.abs(box.gridTop - base.gridTop));
      if (base && Math.abs(box.logoTop - base.logoTop) > 1) issue('opening settings moves the title', Math.abs(box.logoTop - base.logoTop));
      check('Disclaimer remains beneath the title', box.disclaimerInTitle);
      check(out.map((f) => `${f.what}: ${f.detail}`).join('; '), out.length === 0);
      return out;
    };
    const apply = async (closes = true) => {
      await card.getByRole('button', { name: /^Apply( and go online)?$/ }).click();
      if (closes && !await card.locator('.llm-consent').count()) await applied();
    };
    check('Connection settings are hidden initially', !await card.isVisible());
    await c.shoot('Compact controls: no reserved space beneath the header', { checks: fits });
    await summary.getByRole('button', { name: 'Online', exact: true }).click();
    await card.waitFor({ state: 'visible' });
    check('Online without a previous connection opens setup without activating one', posts.length === 0);
    await c.page.keyboard.press('Escape');
    await card.waitFor({ state: 'hidden' });
    check('Escape returns focus to the Online button', await summary.getByRole('button', { name: 'Online', exact: true }).evaluate((el) => el === document.activeElement));
    await openSettings();
    await card.locator('.llm-options').waitFor();
    const model = (name: string) => card.getByLabel(`Default ${name} model`);
    const assertForm = async (name: string, custom = false) => {
      check('Exactly one connection form is open', await card.locator('form').count() === 1);
      check('Only the selected connection has fields', await card.locator('input').count() === (custom ? 2 : 1));
      await model(name).waitFor();
    };
    check('No model fields before Use', await card.locator('input').count() === 0);
    check('Toggle stays outside connection settings', await card.getByRole('button', { name: 'Online', exact: true }).count() === 0);
    await c.shoot('Offline: select a connection before showing fields', { checks: fits });

    // Keyboard selection, no request until confirmation; drafts stay with their connection.
    await card.getByRole('button', { name: 'Use Claude Code login', exact: true }).focus();
    await c.page.keyboard.press('Enter');
    await assertForm('Claude Code login');
    check('Claude model uses an editable ID', await model('Claude Code login').inputValue() === 'haiku');
    await model('Claude Code login').fill('sonnet');
    await apply();
    await card.getByRole('dialog', { name: 'Use your Claude Code login?' }).waitFor();
    check('Opening and asking have not switched Online', posts.length === 0);
    await c.shoot('Claude Code: consent includes the chosen model', { checks: fits });
    await card.getByRole('button', { name: 'Not now' }).click();
    await card.getByRole('button', { name: 'Use Codex login', exact: true }).click();
    await model('Codex login').fill('gpt-6.1-sol');
    await card.getByRole('button', { name: 'Use Claude Code login', exact: true }).click();
    check('Switching forms preserves the Claude draft', await model('Claude Code login').inputValue() === 'sonnet');
    await apply();
    await card.getByRole('button', { name: 'Use my login' }).click();
    await applied();
    await card.getByRole('button', { name: 'Edit Claude Code login', exact: true }).waitFor();
    check('Consent applies to the selected model', posts.at(-1)?.model === 'sonnet' && posts.at(-1)?.consent === 'claude-code');
    await card.getByRole('button', { name: 'Edit Claude Code login', exact: true }).click();
    await model('Claude Code login').fill('haiku');
    await apply();
    await card.locator('form').waitFor({ state: 'detached' });
    await card.getByRole('button', { name: 'Edit Claude Code login', exact: true }).click();
    check('Display label is never used as model ID', await model('Claude Code login').inputValue() === 'haiku');

    await card.getByRole('button', { name: 'Use Codex login', exact: true }).click();
    await assertForm('Codex login');
    check('Codex draft survived another connection being applied', await model('Codex login').inputValue() === 'gpt-6.1-sol');
    await apply();
    await card.getByRole('dialog', { name: 'Use your Codex login?' }).waitFor();
    await c.shoot('Codex: model selection and its own login consent', { checks: fits });
    const headerViewport = c.page.viewportSize()!;
    for (const width of [1100, 1024, 560, 390]) {
      await c.page.setViewportSize({ width, height: 900 });
      await c.shoot(`Header at ${width}px: tallest consent state`, { checks: fits });
      await card.getByRole('button', { name: 'Not now' }).click();
      await c.shoot(`Header at ${width}px: shorter state stays in place`, { checks: fits });
      await apply();
    }
    await c.page.setViewportSize(headerViewport);
    await card.getByRole('button', { name: 'Use my login' }).click();
    await applied();
    await card.getByRole('button', { name: 'Edit Codex login', exact: true }).waitFor();
    check('Codex model reaches the server', posts.at(-1)?.model === 'gpt-6.1-sol' && posts.at(-1)?.consent === 'codex');

    for (const [name, chosen] of [['Anthropic API', 'claude-sonnet-5-5'], ['OpenAI API', 'gpt-6-luna']]) {
      await card.getByRole('button', { name: `Use ${name}`, exact: true }).click();
      await assertForm(name);
      await model(name).fill(chosen);
      await c.shoot(`${name}: model field without a URL`, { checks: fits });
      await apply();
      await card.getByRole('button', { name: `Edit ${name}`, exact: true }).waitFor();
      check(`${name} model reaches the server`, posts.at(-1)?.model === chosen && !posts.at(-1)?.baseUrl);
    }

    await card.getByRole('button', { name: 'Use Custom API (OpenAI-compatible)', exact: true }).click();
    await assertForm('Custom API (OpenAI-compatible)', true);
    await card.getByLabel('Default custom API URL').fill('https://custom.example:8443/api/v1');
    await model('Custom API (OpenAI-compatible)').fill('missing-model');
    const beforeClose = posts.length;
    await c.page.keyboard.press('Escape');
    await card.waitFor({ state: 'hidden' });
    await c.shoot('Closing setup leaves the compact menu unchanged', { checks: fits });
    await openSettings();
    check('Closing setup preserves the URL and model draft without applying it', posts.length === beforeClose && await model('Custom API (OpenAI-compatible)').inputValue() === 'missing-model' && await card.getByLabel('Default custom API URL').inputValue() === 'https://custom.example:8443/api/v1');
    c.note('One HTTP 503 console entry is expected: the fixture rejects missing-model to check failure handling.');
    await apply(false);
    await card.getByRole('alert').waitFor();
    check('Failed check retains the old default', view.current === 'openai-api');
    check('Failed check retains the draft', await model('Custom API (OpenAI-compatible)').inputValue() === 'missing-model');
    await c.shoot('Custom API: URL and model, failed check preserves the default', { checks: fits });
    const viewport = c.page.viewportSize()!;
    await c.page.setViewportSize({ width: 390, height: 844 });
    await c.shoot('Mobile: custom API fields fit within the panel', { checks: fits });
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await card.getByRole('button', { name: 'Close', exact: true }).click();
    await c.shoot('Mobile: compact menu after closing settings', { checks: fits });
    await openSettings();
    await card.getByRole('button', { name: 'Use Custom API (OpenAI-compatible)', exact: true }).click();
    await c.page.setViewportSize(viewport);
    await model('Custom API (OpenAI-compatible)').fill('qwen3-8b');
    await apply();
    await card.getByRole('button', { name: 'Edit Custom API (OpenAI-compatible)', exact: true }).waitFor();
    check('Custom URL is submitted', posts.at(-1)?.baseUrl === 'https://custom.example:8443/api/v1');
    await card.getByRole('button', { name: 'Edit Custom API (OpenAI-compatible)', exact: true }).click();
    check('Applied custom URL is retained', await card.getByLabel('Default custom API URL').inputValue() === 'https://custom.example:8443/api/v1');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await card.getByRole('button', { name: 'Close', exact: true }).click();
    await summary.getByRole('button', { name: 'Offline', exact: true }).click();
    await c.page.waitForFunction(() => document.querySelector('.llm-toggle button:first-child')?.getAttribute('aria-pressed') === 'true');
    await summary.getByRole('button', { name: 'Online', exact: true }).click();
    await c.page.waitForFunction(() => document.querySelector('.llm-toggle button:last-child')?.getAttribute('aria-pressed') === 'true');
    check('Online restores the applied custom connection, not an unfinished draft', posts.at(-1)?.use === 'vllm' && posts.at(-1)?.model === 'qwen3-8b' && posts.at(-1)?.baseUrl === 'https://custom.example:8443/api/v1');
    check('Restoring a connection does not open setup', !await card.isVisible());
    await openSettings();
    await card.getByRole('button', { name: 'Use No default', exact: true }).click();
    await applied();
    check('No default applies directly without fields', view.current === 'none' && await card.locator('form').count() === 0);
    await c.shoot('Online without a default: per-shift choices remain available', { checks: fits });

    // Another tab changes the default; refresh the displayed state without touching draft text.
    view = { ...view, current: 'api', status: { provider: 'anthropic-api', label: 'Anthropic API', model: 'claude-haiku-5-5', ok: true }, options: { ...view.options, api: { ...view.options.api, model: 'claude-haiku-5-5' } } };
    await c.ev(`__ac.store.set({ online: true, llm: ${JSON.stringify(view.status)} })`);
    await card.getByRole('button', { name: 'Edit Anthropic API', exact: true }).click();
    check('Another tab updates editable model settings', await model('Anthropic API').inputValue() === 'claude-haiku-5-5');
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    view = { ...view, options: { ...view.options, api: { ...view.options.api, ready: false, hint: 'Key missing: set ANTHROPIC_API_KEY, then restart.' } } };
    await Promise.all([c.page.waitForResponse((r) => r.url().includes('refresh=1')), card.getByRole('button', { name: 'Check again', exact: true }).click()]);
    await card.getByRole('button', { name: 'Edit Anthropic API', exact: true }).click();
    check('Missing credentials block Apply', await card.getByRole('button', { name: 'Apply', exact: true }).isDisabled());
    await c.shoot('Missing API key: setup instructions, no activation', { checks: fits });
  },
};


function costScene(provider: 'codex' | 'openai-api'): Scene {
  const codex = provider === 'codex';
  const name = codex ? 'Codex' : 'OpenAI API';
  const priced = codex ? 'codexPricedCalls' : 'openaiPricedCalls';
  const unpriced = codex ? 'codexUnpricedCalls' : 'openaiUnpricedCalls';
  return {
    id: codex ? 'codex-costs' : 'openai-costs', title: `${name} estimated costs`, map: 'orientation', seed: 9, showUI: true,
    about: 'Simulated usage only: estimates, unknown prices, and partial historical totals. No model calls.',
    region: { x: 8.4, z: 17.6, r: 0.75 },
    rigs: [{ name: 'eyes', eyes: true }, { name: 'hall', pos: [7, 1.8, 16], at: [8.4, 1.1, 17.6] }],
    async run(c) {
      await c.cam('first');
      await c.tp(8.4, 17.6, 90, -4);
      await c.ev(`(() => {
        const totals = { calls: 6, requests: 6, inputTokens: 71000, outputTokens: 351, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 29400, costUSD: 0.0072755, ${priced}: 6, ${unpriced}: 0 };
        globalThis.__costFixture = { provider: ${JSON.stringify(provider)}, models: ['gpt-6-luna'], apiEquivalent: ${codex}, session: totals,
          byNpc: [{ key: 'fixture', name: 'Patient', totals }], today: { ...totals, calls: 10 }, process: totals,
          agent: ${codex} ? { ...totals, label: 'Codex gpt-6-luna', model: 'gpt-6-luna', billing: 'unknown', final: false, at: Date.now() } : undefined };
        const update = () => { const state = __ac.store.get(); if (state.view && state.view.usage !== globalThis.__costFixture) __ac.store.set({ view: { ...state.view, usage: globalThis.__costFixture } }); };
        globalThis.__stopCostFixture = __ac.store.subscribe(update); update();
      })()`);
      await c.page.mouse.click(400, 450, { button: 'right' });
      await c.page.locator('.usage-chip').click();
      await c.page.getByRole('dialog', { name: 'LLM usage' }).getByText(codex ? 'Estimated API-equivalent cost' : 'Estimated API cost', { exact: true }).first().waitFor();
      await c.shoot(`Known ${name} costs are clearly estimated`);
      await c.page.locator('.usage-pop').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await c.shoot('AI physician and historical subtotal labels');
      await c.ev(`(() => {
        const old = globalThis.__costFixture;
        const totals = { ...old.session, costUSD: 0, ${priced}: 0, ${unpriced}: 6 };
        globalThis.__costFixture = { ...old, models: ['unknown-model'], costAvailable: false, session: totals, byNpc: [{ key: 'fixture', name: 'Patient', totals }], agent: undefined };
        __ac.store.set({ view: { ...__ac.store.get().view, usage: globalThis.__costFixture } });
      })()`);
      await c.page.locator('.usage-pop').evaluate(el => { el.scrollTop = 0; });
      await c.page.getByRole('dialog', { name: 'LLM usage' }).getByText('Unavailable', { exact: true }).first().waitFor();
      await c.shoot('Unknown model stays unavailable');
      await c.ev('globalThis.__stopCostFixture()');
    },
  };
}

const codexCosts = costScene('codex');
const openaiCosts = costScene('openai-api');

const SCENES: Scene[] = [codexCosts, openaiCosts, llmMode, tabletObjects, settingsMenu, browserDemo, surgeVisitors, surgeCensus, surgeArrival('ambulance'), surgeArrival('walking'), surgeArrival('wheelchair'), nurseCollision, walkInScene(), catalogScene(true), catalogScene(false), laptopCart, stationSupplies, rotationLocker, waitingCollision, radioStory, rotationRounds, manualSave, faint, ems, crowd, rollator, nurses, coffee, handrub, handwash, restroomWash, sleevesUp, rubWalkOff, mask, sit, curtain, elevator, bedside, examUltrasound, embodiedBedside, bedsideDisposition, dischargeScene('walking'), dischargeScene('wheelchair'), stretcher, handbag];

// ───────────────────────────── running a scene ─────────────────────────────

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

const key = (f: Finding) => `${f.who}|${f.kind}|${f.what}`;
const SEVERE = new Set(['unsupported', 'clipping', 'hands-off', 'floating-item', 'sunk-item', 'no-phone', 'clipboard', 'skin-mismatch', 'not-seated', 'off-seat', 'feet-off-footrests']);
const failsAudit = (sc: Scene, f: Finding) => f.persistent && (sc === browserDemo || SEVERE.has(f.kind));

/** findings seen in both samples are persistent; the rest are transient (one sample) */
function mergeAudits(a: Audit | null, b: Audit | null): Finding[] {
  const A = new Map((a?.findings ?? []).map((f) => [key(f), f]));
  const B = new Map((b?.findings ?? []).map((f) => [key(f), f]));
  const out: Finding[] = [];
  for (const [k, f] of A) {
    const g = B.get(k);
    out.push(g ? { ...f, dist: Math.min(f.dist, g.dist), detail: f.dist <= g.dist ? f.detail : g.detail, persistent: true } : { ...f, persistent: false });
  }
  for (const [k, g] of B) if (!A.has(k)) out.push({ ...g, persistent: false });
  return out.sort((x, y) => Number(!!y.persistent) - Number(!!x.persistent) || Number(SEVERE.has(y.kind)) - Number(SEVERE.has(x.kind)) || y.dist - x.dist);
}

async function openShift(context: BrowserContext, url: string, sc: Scene): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // the dev server's hot reload is cut off for this page: other edits to the tree mid-run would rebuild the world under the film
  if (sc === browserDemo) {
    await checkStaticRequests(page, url, errors);
    await watchDemoSpeech(page, true);
  } else await page.routeWebSocket((u) => !u.pathname.endsWith('/ws'), () => undefined);
  const q = new URLSearchParams({ debug: '1', quality, map: sc.map ?? 'night_shift' });
  if (sc.seed !== undefined) q.set('seed', String(sc.seed));
  try {
    await page.goto(`${url.replace(/\/$/, '')}/?${q}`);
    if (sc === browserDemo) {
      const start = page.getByRole('button', { name: 'Enter the ED' });
      await start.waitFor();
      await page.screenshot({ path: path.join(out, sc.id, 'menu.png') });
      await start.click();
      await page.waitForFunction('!!globalThis.__acWorld?.npc("tech_marcus")', undefined, { timeout: 120000 });
    } else {
      await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
      await sc.selectAtMenu?.(page);
      await page.click('button.start');
      await page.waitForSelector('.hud-clock', { timeout: 60000 });
    }
  } catch (e) {
    await page.close().catch(() => undefined);
    throw new Error(`the shift did not start (${(e as Error).message.split('\n').slice(0, 4).join(' ')})${errors.length ? `; page errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  }
  if (sc === browserDemo) await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
  else await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  if (!sc.showUI) await page.addStyleTag({ content: HIDE });
  return { page, errors };
}

async function film(context: BrowserContext, url: string, sc: Scene): Promise<{ rows: BeatRow[]; notes: string[]; errors: string[]; seconds: number }> {
  const dir = path.join(out, sc.id);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  // the faint picks its seed from the plan before the shift starts
  if (sc.id === 'faint') sc.seed = faintPlan().seed;
  let opened: { page: Page; errors: string[] };
  try {
    opened = await openShift(context, url, sc);
  } catch (e) {
    process.exitCode = 1;
    console.log(`  ✗ ${sc.id}: ${(e as Error).message}`);
    return { rows: [], notes: [(e as Error).message], errors: [], seconds: Math.round((Date.now() - t0) / 1000) };
  }
  const { page, errors } = opened;
  const rows: BeatRow[] = [];
  const notes: string[] = [];
  let mode: 'first' | 'third' | null = null;
  let prevItems = new Map<string, { at: V3; on: string; label: string }>();
  let prevRegion = '';
  let prevProps = new Map<string, string[]>();
  const ev = <T = unknown>(js: string) => page.evaluate(js) as Promise<T>;
  const wait = (ms: number) => page.waitForTimeout(ms);
  const cam = async (m: 'first' | 'third') => {
    if (m === mode) return;
    await ev(`__ac.store.set({ camera: '${m}' })`);
    mode = m;
    await wait(120);
  };
  const gameT = () => ev<number>('__ac.store.get().view ? __ac.store.get().view.t : 0');
  const clock = () => ev<string>(`(() => { const v = __ac.store.get().view; if (!v) return ''; const [h, m] = v.clockStart.split(':').map(Number); const s = Math.round(v.t) + (h * 60 + m) * 60; const hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60, ss = s % 60; return [hh, mm, ss].map((x) => String(x).padStart(2, '0')).join(':'); })()`);
  const until = async (pred: () => Promise<boolean>, ms: number, step = 80) => {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await pred()) return true;
      await wait(step);
    }
    return false;
  };
  const untilGameT = (t: number, ms = 60000) => until(async () => (await gameT()) >= t, ms, 50);
  const tp = (x: number, z: number, yaw: number, pitch = -8) => ev(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`) as Promise<void>;
  const resetCams = async () => {
    await ev('__acWorld.cam(null)');
    await ev(`__acWorld.amenity('cam', null)`);
  };
  /** returns false when the rig cannot be placed (an NPC not there); `target` stands in for a follow rig's NPC */
  const applyRig = async (rig: Rig, target?: string): Promise<boolean> => {
    if ('eyes' in rig) {
      await resetCams();
      await cam('first');
      if (rig.look) {
        const target = typeof rig.look === 'string' ? await ev<V3 | null>(`(() => { const n = __acWorld.npc('${rig.look}'); return n ? [n.x, 0.9, n.z] : null; })()`) : rig.look;
        if (target) {
          const s = await ev<{ x: number; z: number; camY: number }>('__acWorld.state()');
          const yaw = deg(Math.atan2(target[0] - s.x, target[2] - s.z));
          const pitch = deg(Math.atan2(target[1] - s.camY, Math.hypot(target[0] - s.x, target[2] - s.z)));
          await ev(`__acWorld.look(${yaw - 180}, ${pitch})`);
        }
      }
      return true;
    }
    await cam('third');
    if ('around' in rig) {
      await ev('__acWorld.cam(null)');
      await ev(`__acWorld.amenity('cam', ${JSON.stringify({ around: rig.around, yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist, fov: rig.fov ?? 45, up: rig.up ?? 0 })})`);
      return true;
    }
    await ev(`__acWorld.amenity('cam', null)`);
    if ('follow' in rig) {
      const n = await ev<{ x: number; z: number; yaw: number } | null>(`__acWorld.npc('${target ?? rig.follow}')`);
      if (!n) return false;
      const fx = Math.sin(n.yaw);
      const fz = Math.cos(n.yaw);
      const [right, up, fwd] = rig.off;
      const pos: V3 = [n.x + fx * fwd - fz * right, up, n.z + fz * fwd + fx * right];
      const aim = rig.aim ?? 0;
      await ev(`__acWorld.cam(${JSON.stringify(pos)}, ${JSON.stringify([n.x + fx * aim, rig.look ?? 0.8, n.z + fz * aim])})`);
      return true;
    }
    await ev(`__acWorld.cam(${JSON.stringify(rig.pos)}, ${JSON.stringify(rig.at)})`);
    return true;
  };
  const audit = (region: Region) => ev<Audit | null>(`(() => { try { return __acWorld.audit(${JSON.stringify(region)}); } catch (e) { return { error: String(e && e.stack || e) }; } })()`).then((a) => {
    if (a && (a as unknown as { error?: string }).error) {
      notes.push(`audit failed: ${(a as unknown as { error: string }).error.slice(0, 300)}`);
      return null;
    }
    return a;
  });
  const shoot: Ctx['shoot'] = async (label, o = {}) => {
    const names = o.rigs ?? sc.defaults ?? sc.rigs.map((r) => r.name);
    const want = sc.rigs.filter((r) => names.includes(r.name));
    let row = rows.find((r) => r.label === label);
    if (!row) {
      row = { idx: rows.length + 1, label, t: o.t ?? null, clock: await clock(), frames: [], findings: [], notes: [], audits: [] };
      rows.push(row);
    }
    const region = o.region ?? sc.region;
    let a1: Audit | null = null;
    let a1At = 0;
    const before = mode;
    for (const rig of want) {
      const ok = await applyRig(rig, o.target);
      if (!ok) {
        row.frames.push({ rig: rig.name, file: null });
        continue;
      }
      await wait('eyes' in rig ? 260 : 200);
      const file = path.join(dir, `${String(row.idx).padStart(2, '0')}-${slug(label)}-${rig.name}.png`);
      await page.screenshot({ path: file });
      row.frames.push({ rig: rig.name, file });
      // the numbers, taken while a third-person view is up (in first person the player's body is not drawn)
      if (!a1 && !('eyes' in rig)) {
        a1 = await audit(region);
        a1At = Date.now();
      }
    }
    if (!a1) {
      a1 = await audit(region);
      a1At = Date.now();
    }
    const since = Date.now() - a1At;
    if (since < 600) await wait(600 - since);
    const a2 = await audit(region);
    const found = mergeAudits(a1, a2);
    if (o.checks) found.push(...(await o.checks()));
    row.findings.push(...found.filter((f) => !row!.findings.some((g) => key(g) === key(f))));
    row.audits.push(a1, a2);
    // what appeared or vanished since the last moment (things must come from somewhere)
    const last = a2 ?? a1;
    if (last) {
      const items = new Map(last.items.map((i) => [i.id, { at: i.at, on: i.on, label: i.label }]));
      // (only between moments audited over the same place: a new region's items aren't "new")
      const regionKey = `${region.x},${region.z},${region.r}`;
      const sameRegion = prevRegion === regionKey;
      prevRegion = regionKey;
      if (sameRegion && (rows.length > 1 || row.audits.length > 2)) {
        for (const [id, i] of items) if (!prevItems.has(id)) row.notes.push(`appeared: ${i.label} at ${i.at.map((v) => v.toFixed(2)).join(', ')} (on ${i.on})`);
        for (const [id, i] of prevItems) if (!items.has(id)) row.notes.push(`gone: ${i.label} (was at ${i.at.map((v) => v.toFixed(2)).join(', ')})`);
      }
      prevItems = items;
      const props = new Map(last.subjects.map((s) => [s.id, s.props ?? []]));
      for (const [id, ps] of props) {
        const was = prevProps.get(id);
        if (!was) continue;
        const add = ps.filter((p) => !was.includes(p));
        const del = was.filter((p) => !ps.includes(p));
        const s = last.subjects.find((x) => x.id === id)!;
        if (add.length || del.length) row.notes.push(`${id}${add.length ? ` +${add.join(', +')}` : ''}${del.length ? ` −${del.join(', −')}` : ''} at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} (${s.posture}${s.act ? `, ${s.act}` : ''})`);
      }
      for (const [id, ps] of props) prevProps.set(id, ps);
    }
    // back to the scene's own camera
    await resetCams();
    if (before) await cam(before);
    const bad = found.filter((f) => failsAudit(sc, f));
    console.log(`  ${String(row.idx).padStart(2)} ${label}${o.t !== undefined && o.t !== null ? ` (+${o.t} s)` : ''}: ${bad.length ? `✗ ${bad.map((f) => `${f.who} ${f.kind} ${f.what} ${(f.dist * 100).toFixed(0)} cm`).join('; ')}` : '✓'}`);
  };
  const ctx: Ctx = {
    page,
    ev,
    wait,
    shoot,
    gameT,
    untilGameT,
    cam,
    tp,
    note: (t) => notes.push(t),
    until,
  };
  try {
    await sc.run(ctx);
  } catch (e) {
    process.exitCode = 1;
    notes.push(`scene stopped: ${(e as Error).message.split('\n')[0]}`);
    console.log(`  ✗ ${sc.id}: ${(e as Error).stack ?? String(e)}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { rows, notes, errors, seconds: Math.round((Date.now() - t0) / 1000) };
}

// ───────────────────────────── the contact sheet ─────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

async function sheet(context: BrowserContext, sc: Scene, res: Awaited<ReturnType<typeof film>>): Promise<string> {
  const dir = path.join(out, sc.id);
  const rigs = [...new Set(res.rows.flatMap((r) => r.frames.map((f) => f.rig)))];
  const cw = rigs.length > 3 ? 400 : 480;
  const ch = Math.round((cw * H) / W);
  const finding = (f: Finding) => `<div class="f ${f.persistent ? (SEVERE.has(f.kind) ? 'bad' : 'warn') : 'transient'}">${f.persistent ? '' : '(one sample) '}<b>${esc(f.who)}</b> ${esc(f.kind)} · ${esc(f.what)} · ${(f.dist * 100).toFixed(1)} cm — ${esc(f.detail)}</div>`;
  const rows = res.rows
    .map((r) => {
      const cells = rigs
        .map((rig) => {
          const fr = r.frames.find((f) => f.rig === rig);
          return `<div class="cell">${fr?.file ? `<img src="${esc(path.basename(fr.file))}">` : '<div class="none"></div>'}<span class="rig">${esc(rig)}</span></div>`;
        })
        .join('');
      const sev = r.findings.filter((f) => failsAudit(sc, f)).length;
      const warn = r.findings.filter((f) => f.persistent && !SEVERE.has(f.kind)).length;
      const status = sev ? `<span class="badge bad">✗ ${sev}</span>` : warn ? `<span class="badge warn">! ${warn}</span>` : '<span class="badge ok">✓ audit clean</span>';
      const shown = r.findings.filter((f) => f.persistent || SEVERE.has(f.kind)).slice(0, 8);
      const more = r.findings.length - shown.length;
      return `<div class="row"><div class="lab"><div class="n">${r.idx}</div><div class="l">${esc(r.label)}</div><div class="t">${r.t !== null ? `${r.t >= 0 ? '+' : ''}${r.t} s · ` : ''}${esc(r.clock)}</div>${status}</div>${cells}<div class="finds">${shown.map(finding).join('')}${more > 0 ? `<div class="f transient">+${more} more in findings.md</div>` : ''}${r.notes.map((n) => `<div class="f note">${esc(n)}</div>`).join('')}</div></div>`;
    })
    .join('');
  const total = res.rows.flatMap((r) => r.findings).filter((f) => failsAudit(sc, f)).length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sc.title)}</title><style>
  body { margin: 0; background: #15171a; color: #e8e8e8; font: 13px/1.35 -apple-system, system-ui, sans-serif; width: ${150 + rigs.length * (cw + 6) + 40}px; }
  header { padding: 14px 18px 10px; } h1 { font-size: 20px; margin: 0 0 6px; } .about { color: #b9bec4; max-width: ${rigs.length * (cw + 6)}px; }
  .meta { color: #8fa0b3; margin-top: 6px; font-size: 12px; } .owner { color: #f6c86b; }
  .row { display: grid; grid-template-columns: 150px repeat(${rigs.length}, ${cw}px); gap: 6px; padding: 8px 18px; border-top: 1px solid #2c3036; }
  .lab .n { font: 600 18px monospace; color: #6fb3ff; } .lab .l { font-weight: 600; margin: 2px 0; } .lab .t { font-family: monospace; color: #9aa7b4; font-size: 12px; }
  .cell { position: relative; width: ${cw}px; height: ${ch}px; background: #000; } .cell img { width: ${cw}px; height: ${ch}px; display: block; object-fit: cover; }
  .cell .none { width: 100%; height: 100%; background: repeating-linear-gradient(45deg, #222, #222 8px, #1a1a1a 8px, #1a1a1a 16px); }
  .rig { position: absolute; left: 5px; top: 5px; background: rgba(0,0,0,.65); padding: 1px 6px; font-size: 11px; border-radius: 3px; }
  .finds { grid-column: 2 / -1; } .f { font-size: 12px; } .bad { color: #ff8a80; } .warn { color: #ffd180; } .transient { color: #8a939c; } .note { color: #9fd3ff; }
  .badge { display: inline-block; margin-top: 6px; padding: 1px 6px; border-radius: 3px; font-size: 12px; } .badge.bad { background: #5a1f1f; } .badge.warn { background: #4d3d14; } .badge.ok { background: #1d4024; color: #9be39b; }
  </style></head><body><header><h1>${esc(sc.title)}</h1><div class="about">${esc(sc.about)}</div>
  <div class="meta">scene <b>${sc.id}</b> · ${esc(sc.map ?? 'night_shift')}${sc.seed !== undefined ? ` · seed ${sc.seed}` : ''} · ${res.rows.length} moments × ${rigs.length} rigs · ${total} persistent problems · filmed ${new Date().toISOString().slice(0, 16).replace('T', ' ')} in ${res.seconds} s${sc.owner ? ` · <span class="owner">being changed by: ${esc(sc.owner)}</span>` : ''}</div>
  ${res.notes.map((n) => `<div class="meta">${esc(n)}</div>`).join('')}${res.errors.length ? `<div class="meta bad">${res.errors.length} page errors: ${esc(res.errors.slice(0, 3).join(' | '))}</div>` : ''}</header>${rows}</body></html>`;
  const htmlPath = path.join(dir, 'sheet.html');
  writeFileSync(htmlPath, html);
  const p = await context.newPage();
  try {
    await p.setViewportSize({ width: 150 + rigs.length * (cw + 6) + 40, height: 800 });
    await p.goto(pathToFileURL(htmlPath).href);
    await p.waitForLoadState('load');
    const png = path.join(out, `${sc.id}.png`);
    await p.screenshot({ path: png, fullPage: true });
    return png;
  } finally {
    await p.close();
  }
}

function findingsTable(sc: Scene, res: Awaited<ReturnType<typeof film>>): string {
  const lines = [`## ${sc.title} (\`${sc.id}\`)`, '', sc.owner ? `Being changed by: ${sc.owner}. Report only.\n` : ''];
  for (const n of res.notes) lines.push(`- ${n}`);
  const all = res.rows.flatMap((r) => r.findings.map((f) => ({ r, f })));
  const shown = all.filter(({ f }) => f.persistent);
  if (!shown.length) lines.push('', 'Support audit clean on every moment (persistent findings: none).');
  else {
    lines.push('', '| # | moment | who / what | problem | distance | detail | frame |', '|---|---|---|---|---|---|---|');
    for (const { r, f } of shown) {
      const fr = r.frames.find((x) => x.file)?.file;
      lines.push(`| ${r.idx} | ${r.label}${r.t !== null ? ` (+${r.t} s)` : ''} | ${f.who} · ${f.what} | ${f.kind} | ${(f.dist * 100).toFixed(1)} cm | ${f.detail.replace(/\|/g, '/')} | ${fr ? path.relative(out, fr) : ''} |`);
    }
  }
  const notes = res.rows.flatMap((r) => r.notes.map((n) => `- ${r.idx} ${r.label}: ${n}`));
  if (notes.length) lines.push('', 'Appeared, vanished, changed hands:', ...notes);
  const transient = all.filter(({ f }) => !f.persistent && SEVERE.has(f.kind)).length;
  if (transient) lines.push('', `${transient} more in one sample only (transitions; see audit.json).`);
  return lines.join('\n') + '\n';
}

// ───────────────────────────── main ─────────────────────────────

if (args.includes('--list')) {
  console.log('llm-sources  Independent model sources (menu, desktop and narrow viewport)');
  console.log('menu-quality  Entry-page graphics quality (menu, desktop and narrow viewport)');
  for (const s of SCENES) console.log(`${s.id.padEnd(10)} ${s.title}${s.owner ? `  [${s.owner}]` : ''}`);
  process.exit(0);
}
const selected = pick ? SCENES.filter((s) => pick.includes(s.id)) : SCENES;
const menus = ['llm-sources', 'menu-quality'].filter((id) => !pick || pick.includes(id));
const known = [...SCENES.map((s) => s.id), 'llm-sources', 'menu-quality'];
if (pick?.some((id) => !known.includes(id))) throw new Error(`unknown scene: ${pick.filter((id) => !known.includes(id)).join(', ')} (known: ${known.join(', ')})`);
mkdirSync(out, { recursive: true });
for (const id of menus) {
  if (id === 'llm-sources') {
    const { sourceStoryboard } = await import('./llm-sources-e2e');
    await sourceStoryboard(path.join(out, id));
  } else {
    const { qualityStoryboard } = await import('./menu-quality-e2e');
    await qualityStoryboard(path.join(out, id));
  }
}
const menuIndex = menus.map((id) => `- [${id} contact sheet](${id}.png) · [findings](${id}/findings.md)`);
if (!selected.length) {
  writeFileSync(path.join(out, 'index.md'), ['# Menu storyboards', '', ...menuIndex, ''].join('\n'));
  process.exit(0);
}
const index: string[] = [`# Storyboards (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`, '', ...menuIndex, ''];
let problems = 0;
async function record(scenes: Scene[], h: Awaited<ReturnType<typeof startDemoHost>>) {
  try {
    for (const sc of scenes) {
      // Each scene starts with its own player preferences and save slots.
      const context = await h.browser.newContext({ viewport: { width: W, height: H } });
      console.log(`▶ ${sc.id}: ${sc.title}`);
      const res = await film(context, h.url, sc);
      if (sc === browserDemo && !process.exitCode) {
        try {
          await checkDemoTouch(h.browser, h.url, path.join(out, sc.id), res.errors);
          res.notes.push('Desktop and touch tours started in third person with voiced replies. The touchscreen camera control opened the tap-to-walk overhead view.');
        } catch (err) { res.errors.push('Touch tour: ' + (err as Error).message); }
      }
      writeFileSync(path.join(out, sc.id, 'audit.json'), JSON.stringify({ scene: sc.id, seed: sc.seed, notes: res.notes, errors: res.errors, rows: res.rows }, null, 1));
      const table = findingsTable(sc, res);
      writeFileSync(path.join(out, sc.id, 'findings.md'), table);
      index.push(table);
      const png = res.rows.length ? await sheet(context, sc, res) : null;
      const bad = res.rows.flatMap((r) => r.findings).filter((f) => failsAudit(sc, f)).length;
      problems += bad;
      if (sc === browserDemo) {
        const findings = res.rows.flatMap(row => row.findings.filter(f => f.persistent).map(f => f.who + ': ' + f.detail));
        if (res.rows.some(row => row.audits.some(a => !a?.subjects.length))) findings.push('Missing support audit');
        if (res.errors.length || findings.length) {
          console.error('Demo release check failed.', ...new Set([...res.errors, ...findings]));
          process.exitCode = 1;
        }
      }
      console.log(`  ${png ? `🎞  ${png}` : 'no frames'} · ${bad} persistent problems${res.errors.length ? ` · ${res.errors.length} page errors` : ''}`);
      await context.close();
    }
  } finally {
    writeFileSync(path.join(out, 'index.md'), index.join('\n'));
    await h.close();
  }
}
if (selected.includes(browserDemo)) await record([browserDemo], await startDemoHost());
const localScenes = selected.filter(s => s !== browserDemo);
if (localScenes.length) await record(localScenes, await startHarness({ portBase, dev: true }));
console.log(`\n${selected.length} scenes · ${problems} persistent problems · ${path.join(out, 'index.md')}`);

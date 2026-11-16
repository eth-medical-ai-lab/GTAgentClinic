/**
 * The CT suite and the X-ray room as timelines: where the couch, the tube and the radiographer are,
 * when the lasers and the X-rays are on, from game time alone. Pure (no three.js): imagingLife.ts plays
 * it, tests/imaging.test.ts checks it.
 *
 * The server only says that a patient is in the room, for which study, and from when to when
 * (NpcView.scan); everything here is presentation of that slot, never sent back. A study's steps run
 * on game time from the moment the patient is on the table (or at the wall stand), so pausing the
 * game pauses the scan, and they are squeezed to end before the simulation sends the patient back.
 *
 * CT, as it is done: the radiographer raises the couch, switches the positioning lasers on (eyes
 * closed) and moves the landmark to them, connects the power injector to the patient's IV for a
 * contrast study, goes behind the lead glass, takes the scout (topogram: the tube parked, the couch
 * gliding through), plans the range on it, starts the injection, and after the delay (portal venous
 * phase ~70 s for an abdomen; bolus tracking for an angiogram) the helical scan runs on a breath hold
 * while the couch carries the patient through the spinning gantry. X-ray: tube and detector to the
 * region, collimator light on it, behind the screen, "breathe in and hold", a two-stage exposure
 * (prepare: the anode spins up; expose), the next projection, the images checked on the console.
 */

/** the CT gantry and couch in the scanner prop's frame: origin = the scan plane's centre on the floor, +z toward the couch's foot */
export const CT = {
  /** bore: centre height, radius (a 78 cm bore) */
  isoY: 1.08,
  boreR: 0.39,
  /** housing: half depth (front cover at +, back at −), width, height */
  gantryHalf: 0.46,
  gantryW: 2.2,
  gantryH: 1.92,
  /** tabletop (carbon fibre cradle): width, length, thickness; its head end at home; the pad on it */
  cradleW: 0.46,
  cradleLen: 2.25,
  cradleT: 0.05,
  cradleHome: 0.52,
  padT: 0.04,
  /** the tabletop's top at the loading height and at the scanning height (the couch lifts between) */
  topLoad: 0.55,
  topScan: 0.9,
  /** the patient's hips (their root) at home, from the scan plane: the head 10 cm from the cradle's end */
  hipsHome: 1.46,
  /** the external positioning lasers' plane, on the front cover */
  laserZ: 0.5,
  /** couch travel into the gantry (m) */
  travelMax: 1.7,
} as const;

/** lying surface on the couch at its loading height (props.ts surfaceHeight('ctScanner')) */
export const CT_LOAD_SURFACE = CT.topLoad + CT.padT;

/** the X-ray room: the wall stand's detector face, the table's top, the bucky's detector and the tube's park */
export const XR = {
  /** the detector's front face on the wall stand (its x; the stand is on the east wall) */
  standFace: 47.42,
  /** the chest film's source-to-image distance (180 cm), the table's (100 cm) */
  sidStand: 1.8,
  sidTable: 1.0,
  /** the tabletop and the pad on it; the detector in the bucky tray under the top */
  top: 0.74,
  pad: 0.03,
  bucky: 0.67,
  /** the tube parked out of the way, over the table's head end */
  park: { x: 42.25, z: 1.75, y: 2.15, tilt: 0 },
  /** ceiling rails: the bridge runs along x between these, the carriage along z on the bridge */
  railX: [40.95, 47.55] as const,
  railZ: [1.05, 4.15] as const,
  /** the rails' underside (ceiling) */
  railY: 2.9,
} as const;

/** lying surface on the X-ray table (props.ts surfaceHeight('xrayTable')) */
export const XR_SURFACE = XR.top + XR.pad;

// ───────────────────────────── studies ─────────────────────────────

export type CtRegion = 'head' | 'chest' | 'abdomen' | 'aorta';

export interface CtProtocol {
  code: string;
  /** as the console's protocol list shows it */
  name: string;
  region: CtRegion;
  /** the scan range along the body: from (toward the head) to, in fractions of the patient's height from the hips (− = toward the head) */
  range: [number, number];
  contrast: boolean;
  /** injection: mL of contrast, then of saline, at mL/s; seconds from the injection's start to the scan */
  ml?: number;
  flush?: number;
  rate?: number;
  delay: number;
  /** tracking the bolus (an angiogram): low-dose monitoring scans at one level until the artery enhances */
  tracking?: boolean;
  breathHold: boolean;
  kv: number;
  /** effective tube current (reference mAs, dose-modulated), rotation (s), pitch, collimation */
  mas: number;
  rot: number;
  pitch: number;
  /** CTDIvol (mGy) and DLP (mGy·cm) for an average adult, shown when the scan is done */
  ctdi: number;
  dlp: number;
}

export const CT_PROTOCOLS: Record<string, CtProtocol> = {
  ct_head: { code: 'ct_head', name: 'CT Head without contrast', region: 'head', range: [-0.475, -0.33], contrast: false, delay: 0, breathHold: false, kv: 120, mas: 300, rot: 1.0, pitch: 0.55, ctdi: 52, dlp: 900 },
  ct_abd_iv: { code: 'ct_abd_iv', name: 'CT Abdomen/Pelvis with IV contrast', region: 'abdomen', range: [-0.205, 0.03], contrast: true, ml: 90, flush: 40, rate: 3, delay: 70, breathHold: true, kv: 120, mas: 200, rot: 0.5, pitch: 0.98, ctdi: 11, dlp: 520 },
  cta_chest: { code: 'cta_chest', name: 'CTA Chest, pulmonary embolism protocol', region: 'chest', range: [-0.31, -0.13], contrast: true, ml: 60, flush: 40, rate: 4.5, delay: 18, tracking: true, breathHold: true, kv: 100, mas: 120, rot: 0.33, pitch: 1.2, ctdi: 6, dlp: 210 },
  cta_aorta: { code: 'cta_aorta', name: 'CTA Chest/Abdomen/Pelvis, aorta', region: 'aorta', range: [-0.31, 0.04], contrast: true, ml: 90, flush: 40, rate: 4, delay: 22, tracking: true, breathHold: true, kv: 100, mas: 150, rot: 0.33, pitch: 1.2, ctdi: 9, dlp: 650 },
};

/** a study's protocol (an unknown CT code scans like an abdomen; an MRI order in the CT room gets none) */
export function ctProtocol(code: string): CtProtocol {
  return CT_PROTOCOLS[code] ?? { ...CT_PROTOCOLS.ct_abd_iv, code, name: code };
}

export interface XrStudy {
  code: string;
  name: string;
  /** standing at the wall stand (chest) or lying on the table (a limb) */
  erect: boolean;
  /** the projections, in order */
  views: string[];
  /** where on the body the beam is centred: fraction of the height from the hips (+ toward the feet) */
  at: number;
  kv: number;
  mas: number;
  /** collimated field (m): across, along the body */
  field: [number, number];
}

export const XR_STUDIES: Record<string, XrStudy> = {
  xr_chest: { code: 'xr_chest', name: 'XR Chest PA and lateral', erect: true, views: ['PA', 'LAT'], at: -0.2, kv: 120, mas: 2, field: [0.38, 0.42] },
  xr_ankle: { code: 'xr_ankle', name: 'XR Ankle, 3 views', erect: false, views: ['AP', 'Mortise', 'LAT'], at: 0.49, kv: 55, mas: 4, field: [0.22, 0.3] },
  xr_foot: { code: 'xr_foot', name: 'XR Foot, 3 views', erect: false, views: ['AP', 'Oblique', 'LAT'], at: 0.52, kv: 52, mas: 4, field: [0.22, 0.32] },
};

export function xrStudy(code: string): XrStudy {
  return XR_STUDIES[code] ?? { code, name: code, erect: false, views: ['AP', 'LAT'], at: 0.0, kv: 70, mas: 10, field: [0.3, 0.35] };
}

// ───────────────────────────── timelines ─────────────────────────────

export interface Seg<P extends string> {
  phase: P;
  t0: number;
  t1: number;
  /** X-ray: the projection this step is about */
  view?: number;
}

const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
/** smoothstep of u between a and b */
export const ease = (u: number, a = 0, b = 1) => {
  const x = clamp01((u - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/**
 * Lay out nominal steps (game seconds) from `start`, squeezed to fit `room` seconds when there isn't
 * the time (never below a fifth of their length).
 */
function layOut<P extends string>(steps: { phase: P; dur: number; view?: number }[], start: number, room: number): Seg<P>[] {
  const total = steps.reduce((s, x) => s + x.dur, 0);
  const k = Math.max(0.2, Math.min(1, room / total));
  const out: Seg<P>[] = [];
  let t = start;
  for (const s of steps) {
    out.push({ phase: s.phase, t0: t, t1: t + s.dur * k, ...(s.view !== undefined ? { view: s.view } : {}) });
    t += s.dur * k;
  }
  return out;
}

function segAt<P extends string>(tl: Seg<P>[], t: number): { seg: Seg<P> | null; u: number; i: number } {
  if (!tl.length || t < tl[0].t0) return { seg: null, u: 0, i: -1 };
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i];
    if (t < s.t1) return { seg: s, u: (t - s.t0) / Math.max(1e-6, s.t1 - s.t0), i };
  }
  return { seg: null, u: 1, i: tl.length };
}

// ── CT ──

export type CtPhase = 'arrive' | 'position' | 'toConsole' | 'scout' | 'plan' | 'inject' | 'scan' | 'recon' | 'return' | 'unload' | 'done';

/** a contrast study's injection: contrast, then the saline flush (s) */
export function injectionSecs(p: CtProtocol): { contrast: number; flush: number } {
  if (!p.contrast || !p.rate) return { contrast: 0, flush: 0 };
  return { contrast: (p.ml ?? 0) / p.rate, flush: (p.flush ?? 0) / p.rate };
}

/**
 * The CT study's steps from `settled` (game s: the patient on the couch) to the slot's end. The
 * margin leaves the patient lying a moment before the simulation sends them back.
 */
export function ctTimeline(p: CtProtocol, settled: number, until: number, margin = 25): Seg<CtPhase>[] {
  const scan = p.region === 'aorta' ? 34 : p.region === 'abdomen' ? 30 : 22;
  const steps: { phase: CtPhase; dur: number }[] = [
    { phase: 'arrive', dur: 12 },
    { phase: 'position', dur: 80 },
    { phase: 'toConsole', dur: 30 },
    { phase: 'scout', dur: 24 },
    { phase: 'plan', dur: 36 },
    ...(p.contrast ? [{ phase: 'inject' as CtPhase, dur: p.delay }] : []),
    { phase: 'scan', dur: scan },
    { phase: 'recon', dur: 30 },
    { phase: 'return', dur: 30 },
    { phase: 'unload', dur: 25 },
  ];
  return layOut(steps, settled, until - settled - margin);
}

export interface CtState {
  phase: CtPhase | 'idle';
  /** progress through the phase, 0..1 */
  u: number;
  /** couch: 0 at the loading height, 1 at the scanning height; cradle travel into the gantry (m) */
  lift: number;
  travel: number;
  /** the tabletop's top (m above the floor) */
  top: number;
  lasers: boolean;
  /** X-rays on (the scout or the helical; the monitoring scans while tracking a bolus) */
  beam: boolean;
  /** rotor speed 0..1 (the scout is taken with the tube parked: no rotation) */
  spin: number;
  /** the breathing instruction on the gantry's display */
  breath: 'hold' | 'breathe' | null;
  /** the injector: connected to the IV; contrast and saline delivered (0..1 of each) */
  connected: boolean;
  contrast: number;
  saline: number;
  /** acquisitions done: the scout, the helical (0..1) */
  scout: number;
  scan: number;
  /** where the radiographer should be */
  tech: 'table' | 'console';
}

const IDLE_CT: CtState = { phase: 'idle', u: 0, lift: 0, travel: 0, top: CT.topLoad, lasers: false, beam: false, spin: 0, breath: null, connected: false, contrast: 0, saline: 0, scout: 0, scan: 0, tech: 'console' };

/** the cradle travel (m) that puts a point of the body (fraction of height from the hips) in the scan plane */
export function travelFor(o: number, height: number): number {
  return Math.max(0, Math.min(CT.travelMax, CT.hipsHome + o * height));
}

/**
 * The CT room at game time t during a study (`tl` from ctTimeline; `height` = the patient's, m). Before
 * the patient is settled (no timeline yet) the radiographer is at the table to meet them.
 */
export function ctStateAt(p: CtProtocol, tl: Seg<CtPhase>[] | null, t: number, height: number): CtState {
  if (!tl) return { ...IDLE_CT, phase: 'arrive', tech: 'table' };
  const { seg, u } = segAt(tl, t);
  const done = !seg && t >= tl[tl.length - 1].t1;
  if (!seg && !done) return { ...IDLE_CT, phase: 'arrive', tech: 'table' };
  const ph: CtPhase = done ? 'done' : seg!.phase;
  const [o0, o1] = p.range;
  // landmark: the top of the range at the external lasers; scout from a little above to a little below the range
  const land = Math.max(0, travelFor(o0, height) - (CT.laserZ + 0.04));
  const scout0 = travelFor(o0 - 0.04, height);
  const scout1 = travelFor(o1 + 0.05, height);
  const scan0 = travelFor(o0, height);
  const scan1 = travelFor(o1, height);
  const s: CtState = { ...IDLE_CT, phase: ph, u: done ? 1 : u, tech: 'table' };
  const inj = injectionSecs(p);
  switch (ph) {
    case 'arrive':
      break;
    case 'position':
      s.lift = ease(u, 0.05, 0.25);
      s.lasers = u > 0.3 && u < 0.95;
      s.travel = land * ease(u, 0.55, 0.8);
      s.connected = p.contrast && u > 0.42;
      break;
    case 'toConsole':
      s.lift = 1;
      s.travel = land;
      s.connected = p.contrast;
      s.tech = 'console';
      break;
    case 'scout': {
      s.lift = 1;
      s.connected = p.contrast;
      s.tech = 'console';
      // to the start (no beam), then through the range with the tube parked
      if (u < 0.28) s.travel = land + (scout0 - land) * ease(u, 0, 0.28);
      else s.travel = scout0 + (scout1 - scout0) * ease(u, 0.32, 0.82);
      s.beam = u > 0.32 && u < 0.82;
      s.breath = p.breathHold && u > 0.22 && u < 0.86 ? 'hold' : p.breathHold && u >= 0.86 ? 'breathe' : null;
      s.scout = ease(u, 0.32, 0.82);
      break;
    }
    case 'plan':
      s.lift = 1;
      s.connected = p.contrast;
      s.tech = 'console';
      s.scout = 1;
      // back to the start of the helical, a little short of it (the run-up); the rotor spins up
      s.travel = scout1 + (scan0 - 0.04 - scout1) * ease(u, 0.45, 0.8);
      s.spin = ease(u, 0.6, 1);
      break;
    case 'inject': {
      s.lift = 1;
      s.connected = true;
      s.tech = 'console';
      s.scout = 1;
      s.spin = 1;
      s.travel = scan0 - 0.04;
      const ts = u * p.delay;
      s.contrast = clamp01(ts / Math.max(1e-6, inj.contrast));
      s.saline = clamp01((ts - inj.contrast) / Math.max(1e-6, inj.flush));
      // bolus tracking: a low-dose monitoring scan every ~2 s at one level, from ~8 s in
      if (p.tracking) s.beam = ts > 8 && ts % 2.4 < 0.5;
      s.breath = p.breathHold && u > 0.8 ? 'hold' : null;
      break;
    }
    case 'scan': {
      s.lift = 1;
      s.connected = p.contrast;
      s.tech = 'console';
      s.scout = 1;
      s.spin = 1;
      const ts = p.delay + u * 30;
      s.contrast = p.contrast ? 1 : 0;
      s.saline = p.contrast ? clamp01((ts - inj.contrast) / Math.max(1e-6, inj.flush)) : 0;
      s.travel = scan0 - 0.04 + (scan1 - scan0 + 0.04) * ease(u, 0.12, 0.85);
      s.beam = u > 0.14 && u < 0.85;
      s.scan = ease(u, 0.14, 0.85);
      s.breath = p.breathHold ? (u < 0.88 ? 'hold' : 'breathe') : null;
      break;
    }
    case 'recon':
      s.lift = 1;
      s.connected = p.contrast;
      s.tech = 'console';
      s.scout = s.scan = 1;
      s.contrast = s.saline = p.contrast ? 1 : 0;
      s.spin = 1 - ease(u, 0, 0.6);
      s.travel = scan1 * (1 - ease(u, 0.1, 0.6));
      s.breath = p.breathHold && u < 0.3 ? 'breathe' : null;
      break;
    case 'return':
      s.lift = 1;
      s.connected = p.contrast;
      s.scout = s.scan = 1;
      s.contrast = s.saline = p.contrast ? 1 : 0;
      s.tech = u < 0.15 ? 'console' : 'table';
      break;
    case 'unload':
      s.lift = 1 - ease(u, 0.15, 0.55);
      s.connected = p.contrast && u < 0.1;
      s.scout = s.scan = 1;
      s.contrast = s.saline = p.contrast ? 1 : 0;
      break;
    case 'done':
      s.scout = s.scan = 1;
      s.contrast = s.saline = p.contrast ? 1 : 0;
      break;
  }
  s.top = CT.topLoad + (CT.topScan - CT.topLoad) * s.lift;
  return s;
}

/** the CT study's overall progress for the console's bar, 0..1 */
export function ctProgress(tl: Seg<CtPhase>[] | null, t: number): number {
  if (!tl || !tl.length) return 0;
  const a = tl[0].t0;
  const b = tl[tl.length - 1].t1;
  return clamp01((t - a) / Math.max(1e-6, b - a));
}

// ── X-ray ──

export type XrPhase = 'arrive' | 'position' | 'toBooth' | 'expose' | 'reposition' | 'review' | 'done';

export function xrTimeline(st: XrStudy, settled: number, until: number, margin = 15): Seg<XrPhase>[] {
  const steps: { phase: XrPhase; dur: number; view?: number }[] = [
    { phase: 'arrive', dur: 10 },
    { phase: 'position', dur: 50, view: 0 },
    { phase: 'toBooth', dur: 18, view: 0 },
  ];
  st.views.forEach((_, i) => {
    if (i > 0) steps.push({ phase: 'reposition', dur: 40, view: i });
    steps.push({ phase: 'expose', dur: 12, view: i });
  });
  steps.push({ phase: 'review', dur: 18, view: st.views.length - 1 });
  return layOut(steps, settled, until - settled - margin);
}

/** where the tube's focal spot is, and its tilt: 0 = beam straight down (the table), 1 = horizontal toward +x (the wall stand) */
export interface TubePose {
  x: number;
  z: number;
  y: number;
  tilt: number;
}

export interface XrState {
  phase: XrPhase | 'idle';
  u: number;
  /** the projection being done or just done (index into the study's views) */
  view: number;
  /** projections taken so far */
  taken: number;
  tube: TubePose;
  /** the collimator's light field on the patient */
  light: boolean;
  /** prepared (the anode spinning up), and the exposure itself; the warning light is on for both */
  prep: boolean;
  beam: boolean;
  /** the wall stand's detector centre height; the bucky tray's position along the table (x) */
  standY: number;
  buckyX: number;
  tech: 'patient' | 'booth';
  /** added to the patient's facing (rad): the lateral chest film turns them 90° */
  turn: number;
}

/** where a study's tube goes: the wall stand (chest) or over the limb on the table */
export function xrTarget(st: XrStudy, patient: { x: number; z: number; height: number }): { tube: TubePose; standY: number; buckyX: number } {
  if (st.erect) {
    // detector centre about 7 cm below the shoulders' top: the lungs on the plate
    const standY = Math.max(1.0, Math.min(1.7, 0.73 * patient.height));
    return { tube: { x: XR.standFace - XR.sidStand, z: patient.z, y: standY, tilt: 1 }, standY, buckyX: patient.x };
  }
  // lying head west on the table: + toward the feet is +x
  const x = patient.x + st.at * patient.height;
  return { tube: { x, z: patient.z, y: XR.bucky + XR.sidTable, tilt: 0 }, standY: 1.35, buckyX: x };
}

const lerpPose = (a: TubePose, b: TubePose, k: number): TubePose => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k, tilt: a.tilt + (b.tilt - a.tilt) * k });

/**
 * The X-ray room at game time t (`tl` from xrTimeline, `target` from xrTarget). Before the patient
 * is settled the radiographer comes out to meet them.
 */
export function xrStateAt(st: XrStudy, tl: Seg<XrPhase>[] | null, t: number, target: { tube: TubePose; standY: number; buckyX: number }): XrState {
  const park = XR.park;
  const idle: XrState = { phase: 'idle', u: 0, view: 0, taken: 0, tube: { ...park }, light: false, prep: false, beam: false, standY: 1.35, buckyX: target.buckyX, tech: 'booth', turn: 0 };
  if (!tl) return { ...idle, phase: 'arrive', tech: 'patient' };
  const { seg, u, i } = segAt(tl, t);
  const done = !seg && t >= tl[tl.length - 1].t1;
  if (!seg && !done) return { ...idle, phase: 'arrive', tech: 'patient' };
  const ph: XrPhase = done ? 'done' : seg!.phase;
  const view = done ? st.views.length - 1 : (seg!.view ?? 0);
  // projections taken: every expose step that has ended
  let taken = 0;
  for (let j = 0; j < tl.length; j++) if (tl[j].phase === 'expose' && (j < i || done || (j === i && u >= 0.7))) taken++;
  const s: XrState = { ...idle, phase: ph, u: done ? 1 : u, view, taken, tube: { ...target.tube }, standY: target.standY, buckyX: target.buckyX, tech: 'booth' };
  // the lateral chest film: they turn 90° (left side to the plate) during the second positioning
  const lat = st.erect ? st.views.findIndex((v) => v === 'LAT') : -1;
  const turnTo = -Math.PI / 2;
  switch (ph) {
    case 'arrive':
      s.tube = { ...park };
      s.standY = 1.35;
      s.tech = 'patient';
      break;
    case 'position': {
      const k = ease(u, 0.05, 0.45);
      s.tube = lerpPose(park, target.tube, k);
      s.standY = 1.35 + (target.standY - 1.35) * ease(u, 0.1, 0.4);
      s.light = u > 0.5;
      s.tech = 'patient';
      break;
    }
    case 'toBooth':
      s.light = u < 0.3;
      break;
    case 'expose':
      s.prep = u < 0.7;
      s.beam = u > 0.5 && u < 0.7;
      break;
    case 'reposition':
      s.tech = u < 0.7 ? 'patient' : 'booth';
      s.light = u > 0.4 && u < 0.75;
      if (view === lat) s.turn = turnTo * ease(u, 0.3, 0.55);
      break;
    case 'review':
    case 'done':
      s.tech = ph === 'done' ? 'patient' : 'booth';
      if (ph === 'done') s.tube = lerpPose(target.tube, park, ease(u, 0, 1));
      break;
  }
  if (lat >= 0 && (view > lat || (view === lat && ph !== 'reposition'))) s.turn = turnTo;
  if (ph === 'done') s.tube = { ...park };
  return s;
}

/** both rooms' plans for a study code: which room's player handles it */
export function suiteFor(code: string, modality: string): 'ct' | 'xray' | null {
  if (modality === 'CT') return 'ct';
  if (modality === 'XR') return 'xray';
  return null;
}

export { erectStudy } from '../../../shared/imaging';

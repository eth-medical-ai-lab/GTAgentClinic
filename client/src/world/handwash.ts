/**
 * A hand wash at a sink, as WHO teaches it, every contact at the real fixture (props.ts marks the
 * tap's outlet and lever, the soap's nozzle and plate, the towel's tail and the bin's pedal; the
 * hands are placed so that a point on them, a fingertip, the palm, the heel of the hand or the back of
 * the wrist, lands exactly there):
 *
 *    0.35  the back of the wrist under the tap's lever, lifting it: the water runs (a sensor tap
 *          runs while hands are under it)
 *    1.05  wet: both hands into the stream, fingertips first and pointing down; palms, then backs
 *          turned through it. The stream stops where a hand interrupts it, runs off the fingertips
 *          and splashes; the skin turns glossy
 *    2.55  soap: one hand cupped under the nozzle, the heel of the other pressing the plate in; a
 *          dose falls into the palm (nothing there before)
 *    4.0   lather: the six WHO steps (palm to palm, backs, interlaced, backs of the fingers, thumbs,
 *          fingertips), foam spreading over the skin each step rubs
 *    8.8   rinse: back under the stream, the foam washing off where the water runs
 *   10.4   the lever pressed down with the inside of the wrist (never a clean hand on it); the wet
 *          hands drip from their fingertips until they're dried
 *   11.0   the towel: a step over to the dispenser (further, a walk there with the wet hands held in
 *          front: the clock waits while you walk, WashWalk), the near hand closes on the hanging tail
 *          and pulls the towel down and out of the slot; the next tail drops into place
 *   12.6   pat both hands dry (the sheen goes). No towels: shaken off over the basin, then rubbed
 *   13.8   into the pedal bin: the pedal down, the lid up, the towel dropped in (a bin out of reach:
 *          a walk there first, drying on the way)
 *   14.8   done (WHO's 40–60 s, compressed; plus any walks)
 */
import * as THREE from 'three';
import { OPEN } from './fpHands';
import type { HandSide } from './hands';
import { REGIONS, REGION_AREA, type HandPoint, type HandRig, type HandShape, type LatherRegion } from './handLayers';
import { CUP, FLAT, PINCH, PINCH_OPEN, STEPS, UP, blend, clamp01, palmQuat, pose, ramp, rubPoses, type Frame, type HandPose } from './handPose';
import { G, lambert } from './materials';

// ───────────────────────────── the timeline (s) ─────────────────────────────

export const WASH = {
  tapReach: 0.35,
  tapLift: 0.72,
  water: 0.86,
  tapOn: 1.0,
  wet: 1.05,
  wetIn: 1.38,
  wetOut: 2.3,
  soap: 2.55,
  cupped: 2.95,
  press: 3.0,
  dose: 3.16,
  land: 3.27,
  release: 3.34,
  lather: 4.0,
  step: 0.8,
  rinse: 8.8,
  rinseIn: 9.1,
  rinseOut: 10.2,
  tapOff: 10.4,
  offReach: 10.62,
  waterOff: 10.76,
  offDown: 10.86,
  towel: 11.0,
  reach: 11.42,
  grab: 11.56,
  closed: 11.66,
  out: 12.12,
  nextTail: 12.32,
  dry: 12.6,
  bin: 13.8,
  over: 14.1,
  drop: 14.18,
  landBin: 14.44,
  close: 14.6,
  end: 14.8,
};

/** the phase a moment is in (debugging, tests) */
export function washPhase(t: number): string {
  const W = WASH;
  const order: [number, string][] = [
    [W.end, 'done'],
    [W.bin, 'bin'],
    [W.dry, 'dry'],
    [W.towel, 'towel'],
    [W.tapOff, 'tapOff'],
    [W.rinse, 'rinse'],
    [W.lather, 'lather'],
    [W.soap, 'soap'],
    [W.wet, 'wet'],
    [0, 'tap'],
  ];
  for (const [at, name] of order) if (t >= at) return name;
  return 'tap';
}

// ───────────────────────────── the fixture ─────────────────────────────

/**
 * A sink as built (props.ts hygMark): positions are read off the meshes. Moving parts are the objects
 * themselves (turned, pressed, hidden here); `press` and `grab` are markers on them.
 */
export interface WashFixture {
  /** where the water leaves the spout; the basin's surface it lands on, and its radius */
  outlet: THREE.Vector3;
  basin: THREE.Vector3;
  basinR: number;
  /** the sink's front (out of the wall, horizontal) and its right as you face it */
  f: THREE.Vector3;
  r: THREE.Vector3;
  /** the tap's lever: its hinge turns about its x from `off` to `on`; null: a sensor tap */
  lever: { hinge: THREE.Object3D; len: number; off: number; on: number } | null;
  /** the soap: the nozzle's tip, the dispenser's front, the point pressed (on the plate), the plate (moves `travel` in, or down) */
  soap: {
    nozzle: THREE.Vector3;
    n: THREE.Vector3;
    press: THREE.Object3D;
    plate: THREE.Object3D | null;
    travel: number;
    down: boolean;
  };
  /** paper towels: the slot, its front, along it, the hanging tail and where a hand takes it */
  towel: {
    slot: THREE.Vector3;
    n: THREE.Vector3;
    across: THREE.Vector3;
    tail: THREE.Object3D | null;
    grab: THREE.Object3D;
  } | null;
  /** the pedal bin: its opening, lid and pedal */
  bin: {
    into: THREE.Vector3;
    lid: THREE.Object3D | null;
    pedal: THREE.Object3D | null;
  } | null;
}

const wpos = (o: THREE.Object3D, out = new THREE.Vector3()) => {
  o.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(o.matrixWorld);
};

/** a point on the lever at angle θ: `along` its length (0..1), `up` off its middle (+ top, − underside) */
function leverPoint(L: NonNullable<WashFixture['lever']>, theta: number, along: number, up: number, out: THREE.Vector3): THREE.Vector3 {
  const h = L.hinge;
  const parent = h.parent!;
  parent.updateWorldMatrix(true, false);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const z = along * L.len;
  return out.set(h.position.x, h.position.y + up * c - z * s, h.position.z + up * s + z * c).applyMatrix4(parent.matrixWorld);
}

export function leverAngle(fx: WashFixture, t: number): number | null {
  const L = fx.lever;
  if (!L) return null;
  const W = WASH;
  const k = ramp(t, W.tapLift, W.tapOn) * (1 - ramp(t, W.offReach, W.offDown));
  return L.off + (L.on - L.off) * k;
}

/** the water: a lever tap from half open to half closed; a sensor tap while hands are under it */
export function waterOn(fx: WashFixture, t: number): boolean {
  const W = WASH;
  if (fx.lever) return t >= W.water && t < W.waterOff;
  return (t >= W.wetIn - 0.2 && t < W.wetOut + 0.25) || (t >= W.rinseIn - 0.2 && t < W.rinseOut + 0.15);
}

/** how far the soap's plate is pressed (0..1) */
export function plateK(t: number): number {
  const W = WASH;
  return ramp(t, W.press, W.dose - 0.02) * (1 - ramp(t, W.release, W.release + 0.12));
}

/** the bin's pedal pressed (0..1): the lid opens with it */
export function pedalK(t: number): number {
  const W = WASH;
  return ramp(t, W.bin, W.bin + 0.14) * (1 - ramp(t, W.close, W.close + 0.12));
}

/** the hand that cups under the soap's nozzle: the one on the far side of it (the near one presses the plate) */
export function soapHand(fx: WashFixture): HandSide {
  return fx.soap.nozzle.clone().sub(fx.outlet).dot(fx.r) > 0 ? 'L' : 'R';
}

/** the hand on the towel dispenser's side of the sink: it takes the towel and bins it (the bin is under it) */
export function towelHand(fx: WashFixture): HandSide {
  return fx.towel && fx.towel.slot.clone().sub(fx.outlet).dot(fx.r) < 0 ? 'L' : 'R';
}

// ───────────────────────────── lather and wet ─────────────────────────────

/** foam per region on one hand, at t: grows over what each WHO step rubs, washes off in the rinse */
export function coverage(side: HandSide, t: number): Record<LatherRegion, number> {
  const W = WASH;
  const c: Record<LatherRegion, number> = {
    palm: 0,
    back: 0,
    fingers: 0,
    thumb: 0,
    tips: 0,
  };
  const tt = Math.min(t, W.rinse);
  const add = (region: LatherRegion, amount: number, a: number, b: number) => {
    c[region] += amount * ramp(tt, a, b);
  };
  for (let i = 0; i < STEPS; i++) {
    const s0 = W.lather + i * W.step;
    const s1 = s0 + W.step;
    const mid = (s0 + s1) / 2;
    switch (i) {
      case 0:
        // palm to palm (the soap in the right palm spreads first)
        add('palm', 0.8, s0 + 0.04, s1);
        add('fingers', 0.12, s0, s1);
        add('thumb', 0.05, s0, s1);
        break;
      case 1: {
        // a palm over the other hand's back, fingers interlaced: the left's back first, then the right's
        const first = side === 'L';
        add('back', 0.85, first ? s0 + 0.04 : mid, first ? mid : s1);
        add('fingers', 0.2, s0, s1);
        break;
      }
      case 2:
        add('fingers', 0.45, s0, s1);
        add('palm', 0.2, s0, s1);
        break;
      case 3:
        add('fingers', 0.3, s0, s1);
        add('back', 0.1, s0, s1);
        break;
      case 4: {
        // the left thumb in the right fist first, then the right's
        const first = side === 'L';
        add('thumb', 0.85, first ? s0 + 0.04 : mid, first ? mid : s1);
        add('fingers', 0.05, s0, s1);
        break;
      }
      default: {
        // the right fingertips in the left palm first, then the left's
        const first = side === 'R';
        add('tips', 0.9, first ? s0 + 0.04 : mid, first ? mid : s1);
        add('palm', 0.05, s0, s1);
      }
    }
  }
  for (const k of REGIONS) c[k] = Math.min(1, c[k]);
  if (t <= W.rinse) return c;
  // rinse: each region's foam goes while it's under the water (rinsePoses turns it there); the
  // fingertips the whole time (it all runs off them)
  const ri = W.rinseIn;
  const win: Record<LatherRegion, [number, number]> = {
    palm: [ri, ri + 0.34],
    back: [ri + 0.3, ri + 0.64],
    thumb: [ri + 0.58, ri + 0.88],
    fingers: [ri + 0.12, ri + 0.92],
    tips: [ri - 0.05, ri + 1.05],
  };
  for (const k of REGIONS) c[k] *= 1 - ramp(t, win[k][0], win[k][1]);
  return c;
}

/** a hand's foam over its whole skin (0..1) */
export function totalCoverage(c: Record<LatherRegion, number>): number {
  return REGIONS.reduce((s, k) => s + REGION_AREA[k] * c[k], 0);
}

/** wet skin (0..1): from the stream on, mostly gone once patted dry (shaken off and rubbed: still damp) */
export function wetness(t: number, towel = true): number {
  const W = WASH;
  return ramp(t, W.wetIn - 0.12, W.wetIn + 0.25) * (1 - (towel ? 0.85 : 0.5) * ramp(t, W.dry, W.bin));
}

/**
 * A wash's walks (hygiene.ts): with the towels or the bin out of reach of the basin you walk over
 * (a restroom's long counter: the dispenser at one end, the bin by the door). The script waits at
 * the walk's moment while you go: wet hands held in front over to the towels, drying them on the
 * way to the bin.
 */
export interface WashWalk {
  /** walked over to the towels, to the bin (the hands come from in front of you, not the basin) */
  towel: boolean;
  bin: boolean;
  /** walking now: which way, how far into it (s), how long it takes */
  leg: { kind: 'towel' | 'bin'; u: number; dur: number } | null;
}
export const STAY: WashWalk = { towel: false, bin: false, leg: null };

// ───────────────────────────── the hands ─────────────────────────────

/** where a point is on a hand, in the hand's own frame (m): measured off the hand being drawn */
export type Offsets = (side: HandSide, p: HandPoint) => THREE.Vector3;

/**
 * Both hands at t. Hands are placed by a contact: `put` turns "this point of the hand here, the hand
 * turned so" into a wrist position. `F` is the frame for poses in front of the body (drying, the
 * rest); `ts` the hand that takes the towel.
 */
export function washPoses(t: number, fx: WashFixture, F: Frame, rest: Record<HandSide, HandPose>, off: Offsets, ts: HandSide, walk: WashWalk = STAY): Record<HandSide, HandPose> {
  const W = WASH;
  const { f, r } = fx;
  const into = f.clone().negate();
  /** a direction in the sink's frame: right, up, toward you */
  const D = (x: number, y: number, z: number) => new THREE.Vector3().addScaledVector(r, x).addScaledVector(UP, y).addScaledVector(f, z).normalize();
  const put = (side: HandSide, p: HandPoint, at: THREE.Vector3, q: THREE.Quaternion, fingers = FLAT, w = 1, extra: Partial<HandPose> = {}): HandPose => ({
    p: at.clone().sub(off(side, p).clone().applyQuaternion(q)),
    q,
    fingers,
    w,
    ...extra,
  });
  const two = (R: HandPose, L: HandPose): Record<HandSide, HandPose> => ({
    R,
    L,
  });
  const mix = (a: Record<HandSide, HandPose>, b: Record<HandSide, HandPose>, k: number) => (k <= 0 ? a : k >= 1 ? b : { R: blend(a.R, b.R, k), L: blend(a.L, b.L, k) });

  // ── the tap's lever (right hand): the back of the wrist under it, lifting; later the inside of the wrist on it, pressing down
  const lever = fx.lever;
  const tapHand = (theta: number, top: boolean, near: number): HandPose => {
    const c = leverPoint(lever!, theta, 0.84, top ? 0.0068 : -0.0068, new THREE.Vector3());
    // short of it until `near` = 1
    c.addScaledVector(UP, (top ? 1 : -1) * 0.04 * (1 - near));
    const q = top ? palmQuat('R', D(-0.75, 0.32, 0.4), D(0, -1, -0.1)) : palmQuat('R', D(-0.8, -0.42, 0.18), D(0, -1, 0.12));
    return put('R', top ? 'wristVolar' : 'wristBack', c, q, pose(0.18, 0.04, 0.15, 0.1));
  };
  // a hand waiting, wet, over the basin's side (dripping into it)
  const drip = (side: HandSide): HandPose => {
    const s = side === 'R' ? 1 : -1;
    const at = fx.basin
      .clone()
      .addScaledVector(r, s * 0.11)
      .addScaledVector(f, 0.1)
      .addScaledVector(UP, 0.12);
    return put(side, 'tipMiddle', at, palmQuat(side, D(s * 0.15, -1, 0.25), D(-s, 0, 0.2)), pose(0.12, 0.05, 0.15, 0.1));
  };
  // no towels: the water shaken off over the basin (a few flicks from the wrist, fingers down)
  const shake = (side: HandSide, u: number): HandPose => {
    const h = drip(side);
    const env = ramp(u, 0, 0.12) * (1 - ramp(u, 0.5, 0.75));
    const ph = u * Math.PI * 2 * 4.2 + (side === 'R' ? 0 : 0.7);
    h.p.addScaledVector(UP, 0.022 * Math.sin(ph) * env);
    h.q = h.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.32 * Math.sin(ph + 0.9) * env));
    return h;
  };
  // walking with wet hands: held in front of you, fingertips forward and down so it drips off them;
  // they sway a little with the stride (`swing` 0..1: none as you set off and arrive)
  const carry = (side: HandSide, u = 0, swing = 0): HandPose => {
    const s = side === 'R' ? 1 : -1;
    const bob = 0.007 * Math.sin(u * Math.PI * 2 * 1.8 + (s > 0 ? 0 : Math.PI)) * swing;
    const p = F.c
      .clone()
      .addScaledVector(F.r, s * 0.1)
      .addScaledVector(F.u, -0.08 + bob)
      .addScaledVector(F.f, -0.03);
    const fingers = F.f.clone().multiplyScalar(0.75).addScaledVector(F.u, -0.6).addScaledVector(F.r, -s * 0.18);
    const palm = F.r.clone().multiplyScalar(-s).addScaledVector(F.u, -0.35);
    return { p, q: palmQuat(side, fingers, palm), fingers: pose(0.24, 0.05, 0.2, 0.15), w: 1 };
  };

  // ── in the stream: fingertips at its sides, pointing down; `turn` (rad) rolls palms → backs to it
  const streamTip = (side: HandSide, h: number) => {
    const s = side === 'R' ? 1 : -1;
    // (the two hands' fingertips touching under it)
    return new THREE.Vector3(fx.outlet.x, h, fx.outlet.z).addScaledVector(r, s * 0.005);
  };
  const tipY = fx.basin.y + Math.min(0.085, (fx.outlet.y - fx.basin.y) * 0.45);
  const inStream = (side: HandSide, turn: number, lift: number, out = 0): HandPose => {
    const s = side === 'R' ? 1 : -1;
    const fd = D(-s * 0.2, -0.92, -0.22);
    const palm = D(-s, 0, 0).applyAxisAngle(fd, s * turn);
    const q = palmQuat(side, fd, palm);
    const at = streamTip(side, tipY + lift)
      .addScaledVector(r, s * out)
      .addScaledVector(f, out * 0.4);
    return put(side, 'tipMiddle', at, q, pose(0.06, 0.07, 0.1, 0.1));
  };

  // ── soap: the right hand cupped under the nozzle (its palm 2.2 cm under the tip), the heel of the left on the plate
  const sn = fx.soap.n;
  // (the hand on the far side cups under the nozzle, the near one presses: neither arm crosses the nozzle)
  const cs: HandSide = soapHand(fx);
  const ps: HandSide = cs === 'R' ? 'L' : 'R';
  const sc = cs === 'R' ? 1 : -1;
  const cup = (gap: number): HandPose => {
    const at = fx.soap.nozzle.clone().addScaledVector(UP, -0.022 - gap);
    const q = palmQuat(cs, r.clone().multiplyScalar(-0.9 * sc).addScaledVector(sn, -0.25).addScaledVector(UP, 0.12), UP.clone().addScaledVector(sn, 0.12));
    return put(cs, 'palm', at, q, CUP);
  };
  const pressHand = (gap: number): HandPose => {
    const press = wpos(fx.soap.press);
    if (fx.soap.down) {
      // a counter pump: the palm's heel on its head, from above
      const q = palmQuat(ps, sn.clone().negate().addScaledVector(r, -0.3 * sc), UP.clone().negate());
      return put(ps, 'heel', press.addScaledVector(UP, gap), q, pose(0.15, 0.03, 0.1, 0.05));
    }
    const q = palmQuat(ps, UP.clone().multiplyScalar(0.9).addScaledVector(r, -0.28 * sc).addScaledVector(sn, 0.08), sn.clone().negate());
    return put(ps, 'heel', press.addScaledVector(sn, gap), q, pose(0.1, 0.03, 0.1, 0.05));
  };
  const soapPair = (c: HandPose, p: HandPose) => (cs === 'R' ? two(c, p) : two(p, c));

  // ── lathering over the basin: the WHO steps, centred a hand's height over it
  const lf: Frame = {
    ...F,
    c: fx.basin
      .clone()
      .addScaledVector(UP, Math.max(0.13, 0.98 - fx.basin.y))
      .addScaledVector(f, 0.07),
    r: r.clone(),
    u: UP.clone(),
    f: into.clone(),
  };

  // ── rinsing: palms to the water, backs, sides (thumbs), then fingertips; a little rubbing
  const rinseTurn = (u: number) => {
    // u: seconds into the rinse proper
    const a = ramp(u, 0.26, 0.4); // palms → backs
    const b = ramp(u, 0.56, 0.66); // backs → sides
    const c = ramp(u, 0.86, 0.98); // sides → palms
    return Math.PI * a - (Math.PI / 2) * b - (Math.PI / 2) * c;
  };

  // ── the towel: the near hand's thumb and index meet on the tail's edge; it pulls the towel down and out
  const tw = fx.towel;
  const towelHandPose = (k: number, closed: number): HandPose => {
    const s = ts === 'R' ? 1 : -1;
    const grab = wpos(tw!.grab);
    const at = grab
      .clone()
      // (as far as the sheet is long: pulled further, the hand came away from its end)
      .addScaledVector(UP, -0.19 * k)
      // (the thumb's in front of the sheet, the index behind it: the pinch a little toward the wall)
      .addScaledVector(tw!.n, 0.07 * k - 0.004);
    const q = palmQuat(
      ts,
      UP.clone()
        .addScaledVector(tw!.n, 0.12)
        .addScaledVector(r, -s * 0.1),
      r.clone().multiplyScalar(-s),
    );
    return put(
      ts,
      'pinch',
      at,
      q,
      closed >= 1
        ? PINCH
        : closed <= 0
          ? PINCH_OPEN
          : {
              curl: PINCH_OPEN.curl + (PINCH.curl - PINCH_OPEN.curl) * closed,
              spread: 0.03,
              thumb: PINCH_OPEN.thumb + (PINCH.thumb - PINCH_OPEN.thumb) * closed,
              oppose: PINCH_OPEN.oppose + (PINCH.oppose - PINCH_OPEN.oppose) * closed,
            },
      1,
      { reach: 0.8 },
    );
  };

  // ── drying: palm to palm round the towel in front of you, then each back patted
  const dryPoses = (u: number): Record<HandSide, HandPose> => {
    const P = rubPoses(F, Math.min(0.5, Math.max(0, u * 0.6)), 0.8);
    const osc = Math.sin(u * Math.PI * 2 * 2.4);
    P.R.p.addScaledVector(F.u, 0.03 + 0.012 * osc).addScaledVector(F.r, 0.012);
    P.L.p.addScaledVector(F.u, 0.03 - 0.012 * osc).addScaledVector(F.r, -0.012);
    P.R.fingers = pose(0.22, 0.04, 0.22, 0.2);
    P.L.fingers = pose(0.22, 0.04, 0.22, 0.2);
    if (u > 0.62) {
      // patting the back of the other hand with the towel (the towel hand over it)
      const top = ts;
      const bot: HandSide = ts === 'R' ? 'L' : 'R';
      const sb = bot === 'R' ? 1 : -1;
      const pb = F.c
        .clone()
        .addScaledVector(F.r, sb * 0.04)
        .addScaledVector(F.u, 0.0);
      const B: HandPose = {
        p: pb,
        q: palmQuat(bot, F.f.clone().addScaledVector(F.r, -sb * 0.3), F.u.clone().negate()),
        fingers: pose(0.15, 0.05, 0.1, 0.1),
        w: 1,
      };
      const pat = Math.abs(Math.sin((u - 0.62) * Math.PI * 2 * 2.2));
      const T: HandPose = {
        p: pb
          .clone()
          .addScaledVector(F.u, 0.035 + 0.025 * pat)
          .addScaledVector(F.r, -sb * 0.01),
        q: palmQuat(top, F.f.clone().addScaledVector(F.r, sb * 0.25), F.u.clone().negate()),
        fingers: pose(0.3, 0.04, 0.3, 0.25),
        w: 1,
      };
      const k = ramp(u, 0.62, 0.78);
      const pat2 = { R: top === 'R' ? T : B, L: top === 'L' ? T : B };
      return { R: blend(P.R, pat2.R, k), L: blend(P.L, pat2.L, k) };
    }
    return P;
  };

  // ── the bin: the towel hand over the opening, palm down, lets go
  const binHand = (open: number): HandPose => {
    // (let go of it from waist height: it drops in)
    const into2 = fx.bin!.into.clone().addScaledVector(UP, 0.42);
    const q = palmQuat(ts, fx.f.clone().negate().addScaledVector(UP, -0.5), UP.clone().negate());
    return put(ts, 'palm', into2, q, open > 0.5 ? OPEN : pose(0.45, 0.02, 0.4, 0.4));
  };

  // ───── the timeline ─────
  const restBoth = two(rest.R, rest.L);
  // walking (the script waits at the walk's moment): over to the towels with wet hands held in
  // front, or to the bin drying them on the way
  if (walk.leg) {
    const { kind, u, dur } = walk.leg;
    const swing = ramp(u, 0.15, 0.5) * (1 - ramp(u, dur - 0.45, dur - 0.1));
    if (kind === 'towel') {
      const before = washPoses(t, fx, F, rest, off, ts, { ...walk, leg: null });
      return mix(before, two(carry('R', u, swing), carry('L', u, swing)), ramp(u, 0, 0.45));
    }
    const u0 = W.bin - W.dry;
    return mix(dryPoses(u0 + u), dryPoses(u0), ramp(u, dur - 0.4, dur));
  }
  // 1. the tap (a sensor tap: the hands go straight to the stream)
  if (t < W.wet) {
    if (!lever) return mix(restBoth, two(inStream('R', 0, 0.07, 0.03), inStream('L', 0, 0.07, 0.03)), ramp(t, 0.3, W.wet));
    const theta = leverAngle(fx, t)!;
    const R = tapHand(theta, false, ramp(t, W.tapReach + 0.15, W.tapLift));
    return two(blend(rest.R, R, ramp(t, 0.15, W.tapReach + 0.2)), blend(rest.L, inStream('L', 0, 0.07, 0.03), ramp(t, W.tapLift, W.wet + 0.1)));
  }
  // 2. wet: into the stream fingertips first, then turned
  if (t < W.soap) {
    const u = t - W.wetIn;
    const turn = u > 0 ? Math.PI * 0.62 * Math.sin(Math.PI * 2 * 0.95 * u) * ramp(u, 0, 0.15) : 0;
    const bob = u > 0 ? 0.012 * Math.sin(Math.PI * 2 * 0.7 * u) : 0;
    const down = ramp(t, W.wet, W.wetIn);
    const inR = inStream('R', turn, 0.07 * (1 - down) + bob, 0.03 * (1 - down));
    const inL = inStream('L', -turn * 0.9, 0.07 * (1 - down) - bob, 0.03 * (1 - down));
    let P = two(inR, inL);
    if (lever && t < W.wetIn) P.R = blend(tapHand(leverAngle(fx, t)!, false, 1), inR, ramp(t, W.wet - 0.05, W.wetIn - 0.05));
    // out of it, toward the soap
    if (t > W.wetOut) P = mix(P, soapPair(cup(0.05), pressHand(0.03)), ramp(t, W.wetOut, W.soap + 0.15));
    return P;
  }
  // 3. soap
  if (t < W.lather) {
    const gap = 1 - ramp(t, W.soap + 0.05, W.cupped);
    const P = soapPair(cup(0.05 * gap), pressHand(t < W.press ? 0.03 * (1 - ramp(t, W.soap + 0.1, W.press)) : 0));
    const lather0 = rubPoses(lf, 0, W.step);
    return mix(P, lather0, ramp(t, W.release, W.lather));
  }
  // 4. lather
  if (t < W.rinse) return rubPoses(lf, t - W.lather, W.step);
  // 5. rinse
  if (t < W.tapOff) {
    const u = t - W.rinseIn;
    const turn = rinseTurn(u);
    const rub = u > 0 ? Math.sin(Math.PI * 2 * 1.6 * u) : 0;
    const inR = inStream('R', turn, 0.02 + 0.01 * rub, 0);
    const inL = inStream('L', -turn, 0.02 - 0.01 * rub, 0);
    let P = two(inR, inL);
    if (t < W.rinseIn) P = mix(rubPoses(lf, STEPS * W.step - 0.001, W.step), P, ramp(t, W.rinse, W.rinseIn));
    if (t > W.rinseOut) P = mix(P, two(lever ? tapHand(fx.lever!.on, true, 0) : drip('R'), drip('L')), ramp(t, W.rinseOut, W.tapOff));
    return P;
  }
  // 6. the tap off: the inside of the right wrist on the lever, pressing it down; the left drips
  if (t < W.towel) {
    const R = lever ? tapHand(leverAngle(fx, t)!, true, ramp(t, W.tapOff, W.offReach)) : drip('R');
    return two(R, drip('L'));
  }
  // 7. the towel: the near hand to the tail, closes on it, pulls; the other waits
  const os: HandSide = ts === 'R' ? 'L' : 'R';
  const dry = dryPoses(Math.max(0, t - W.dry));
  if (t < W.dry) {
    if (!tw) {
      // no towels here: shaken off over the basin, then rubbed together
      const P = two(shake('R', t - W.towel), shake('L', t - W.towel));
      return mix(P, dry, ramp(t, W.towel + 0.72, W.dry + 0.15));
    }
    const k = ramp(t, W.closed, W.out);
    const closed = ramp(t, W.grab, W.closed);
    const H = towelHandPose(k, closed);
    // approach: from below and in front of the tail, then onto it; from the basin, or from in front of
    // you when you walked over
    const pre = towelHandPose(0, 0);
    pre.p.addScaledVector(UP, -0.05).addScaledVector(tw.n, 0.05);
    const from = walk.towel ? carry(ts) : ts === 'R' ? (lever ? tapHand(lever.off, true, 1) : drip('R')) : drip('L');
    let T = t < W.reach ? blend(from, pre, ramp(t, W.towel, W.reach)) : t < W.grab ? blend(pre, H, ramp(t, W.reach, W.grab)) : H;
    // after it's out: over to the other hand
    if (t > W.out) T = blend(H, dry[ts], ramp(t, W.out, W.dry));
    const other = blend(walk.towel ? carry(os) : drip(os), dry[os], ramp(t, W.out - 0.1, W.dry));
    // (in third person the other arm hangs from the shoulder while it waits, wet hands held still)
    if (t < W.out - 0.1) other.w = 1 - ramp(t, W.towel, W.towel + 0.4) * 0.999;
    return ts === 'R' ? two(T, other) : two(other, T);
  }
  // 8. dry
  if (t < W.bin) return dry;
  // 9. the bin: the towel hand over it, lets go; both down
  if (!fx.bin) return mix(dry, restBoth, ramp(t, W.bin, W.end));
  const B = binHand(ramp(t, W.drop - 0.04, W.drop + 0.04));
  const T = blend(blend(dry[ts], B, ramp(t, W.bin, W.over)), rest[ts], ramp(t, W.landBin, W.end));
  const O = blend(dry[os], rest[os], ramp(t, W.bin, W.over + 0.1));
  return ts === 'R' ? two(T, O) : two(O, T);
}

/** where the eyes go at t (first person: the view follows the work) */
export function washFocus(t: number, fx: WashFixture, hands: THREE.Vector3): THREE.Vector3 {
  const W = WASH;
  // (a little up the stream from the hands: the view less steep, the tap and the hands both in it)
  const stream = fx.outlet.clone().lerp(fx.basin, 0.38).addScaledVector(fx.f, -0.04);
  const lever = fx.lever ? leverPoint(fx.lever, fx.lever.off, 0.7, 0, new THREE.Vector3()) : stream;
  const nozzle = fx.soap.nozzle.clone().addScaledVector(UP, -0.04).addScaledVector(fx.soap.n, 0.03);
  const lather = fx.basin.clone().addScaledVector(UP, 0.12).addScaledVector(fx.f, 0.07);
  const grab = fx.towel ? wpos(fx.towel.grab).addScaledVector(UP, -0.13).addScaledVector(fx.towel.n, 0.04) : hands;
  const into = fx.bin ? fx.bin.into.clone().addScaledVector(UP, 0.1) : hands;
  const keys: [number, THREE.Vector3][] = [
    [0, fx.lever ? lever : stream],
    [W.wet - 0.1, stream],
    [W.soap, nozzle],
    [W.release + 0.2, lather],
    [W.rinse, stream],
    [W.tapOff, fx.lever ? lever.clone().lerp(stream, 0.3) : stream],
    [W.towel, grab],
    [W.out + 0.1, hands],
    [W.bin, into],
    [W.end, into],
  ];
  for (let i = keys.length - 1; i >= 0; i--) {
    if (t < keys[i][0]) continue;
    const [t0, a] = keys[i];
    const b = keys[i + 1]?.[1] ?? a;
    const t1 = keys[i + 1]?.[0] ?? t0 + 1;
    // hold, then move on in the last 0.35 s before the next
    return a.clone().lerp(b, ramp(t, t1 - 0.35, t1));
  }
  return stream;
}

/** how far the body leans over the sink at t (rad): more to reach the soap or the tap, less drying */
export function washLean(t: number, fx: WashFixture): number {
  const W = WASH;
  // (the spine's three bones share it: the shoulders come ~0.22 m forward per radian; you lean deepest
  // for the soap on the wall behind the basin)
  const tap = fx.lever ? 0.56 : 0.38;
  const keys: [number, number][] = [
    [0, 0],
    [0.35, tap],
    [W.wet, 0.38],
    [W.soap, 0.7],
    [W.release + 0.2, 0.7],
    [W.lather, 0.32],
    [W.rinse, 0.38],
    [W.tapOff, tap],
    [W.towel, 0.3],
    [W.reach - 0.1, 0.55],
    [W.out, 0.2],
    [W.dry, 0.1],
    [W.bin, 0.32],
    [W.landBin, 0.25],
    [W.end, 0],
  ];
  let v = 0;
  for (let i = 0; i < keys.length; i++) {
    const [t0, a] = keys[i];
    if (t < t0) break;
    const [t1, b] = keys[i + 1] ?? [t0 + 1, a];
    v = a + (b - a) * ramp(t, t0, t1);
  }
  return v;
}

/** how far to the side the body shifts toward the soap while taking it (m, along the sink's right; 0..1 of it at t) */
export function soapShift(t: number): number {
  const W = WASH;
  return ramp(t, W.wetOut - 0.2, W.soap + 0.15) * (1 - ramp(t, W.release, W.lather));
}

// ───────────────────────────── what you see ─────────────────────────────

let wadGeo: THREE.BufferGeometry | null = null;
/**
 * A used paper towel: a crumpled wad (unit size, scaled where it's held). The bumps hash each corner's
 * position, so faces sharing a corner move it alike and the wad stays closed.
 */
function wadGeometry(): THREE.BufferGeometry {
  if (wadGeo) return wadGeo;
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const q = (n: number) => Math.round(n * 1e4);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(q(v.x) * 0.0129898 + q(v.y) * 0.078233 + q(v.z) * 0.037719) * 43758.5453;
    v.multiplyScalar(0.74 + 0.4 * (h - Math.floor(h)));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  wadGeo = g;
  return g;
}

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  s: number;
  /** where it lands: the basin under it, or the floor */
  floor: number;
}

/** where drops come from this frame: a point, how many a second, thrown up and out how hard */
interface Emit {
  at: THREE.Vector3;
  rate: number;
  up: number;
  spread: number;
  floor?: number;
}

const MAX_DROPS = 72;
/** a paper towel's length out of the dispenser (m) */
const SHEET = 0.24;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** the highest point on a hand straight under (x, z), between `top` and `bottom` (the water's radius `rs`) */
function hitDown(x: number, z: number, top: number, bottom: number, s: HandShape, rs: number): { y: number; region: LatherRegion } | null {
  let best: { y: number; region: LatherRegion } | null = null;
  // the palm, a box: the ray (x, top, z) → down, in its frame (slab test)
  const P = s.palm;
  const o = _v.set(x, top, z).sub(P.c);
  const ax = [P.x, P.y, P.z];
  const h = [P.hx + rs, P.hy + rs, P.hz + rs];
  let t0 = 0;
  let t1 = top - bottom;
  let ok = true;
  for (let i = 0; i < 3 && ok; i++) {
    const oi = o.dot(ax[i]);
    const di = -ax[i].y;
    if (Math.abs(di) < 1e-6) {
      if (Math.abs(oi) > h[i]) ok = false;
      continue;
    }
    let ta = (-h[i] - oi) / di;
    let tb = (h[i] - oi) / di;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) ok = false;
  }
  if (ok) {
    // which face: palm side up → palm, else back
    best = { y: top - t0, region: P.y.y > 0 ? 'palm' : 'back' };
  }
  // fingers and thumb: capsules, sampled along their length
  for (const c of s.caps) {
    const R = c.r + rs;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const px = c.a.x + (c.b.x - c.a.x) * u;
      const py = c.a.y + (c.b.y - c.a.y) * u;
      const pz = c.a.z + (c.b.z - c.a.z) * u;
      const d = Math.hypot(px - x, pz - z);
      if (d >= R) continue;
      const y = py + Math.sqrt(R * R - d * d);
      if (y > top || y < bottom) continue;
      if (!best || y > best.y) best = { y, region: c.region };
    }
  }
  return best;
}

export interface WashDebug {
  t: number;
  phase: string;
  water: boolean;
  outlet: number[];
  basinY: number;
  streamBottom: number | null;
  streamHit: string | null;
  tips: Record<HandSide, { index: number[]; middle: number[]; thumb: number[] }>;
  palm: Record<HandSide, number[]>;
  heel: Record<HandSide, number[]>;
  wristBack: number[];
  wristVolar: number[];
  nozzle: number[];
  /** the hand cupped under the nozzle, its palm, and the pressing hand's heel */
  cup: { hand: HandSide; palm: number[]; heel: number[] };
  press: number[];
  plate: number;
  lever: number | null;
  leverTouch: number | null;
  gel: { visible: boolean; at: number[] | null };
  coverage: Record<HandSide, Record<LatherRegion, number>>;
  total: Record<HandSide, number>;
  wet: number;
  towel: {
    hand: HandSide;
    grab: number[] | null;
    pinch: number[] | null;
    tipsToTail: { index: number; thumb: number } | null;
    tail: boolean;
    sheet: { visible: boolean; attached: boolean; top: number[] | null };
    slot: number[] | null;
  } | null;
  bin: { pedal: number; lid: number } | null;
}

const r3 = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(4));

/**
 * The water, the soap, the towel and the fixture's moving parts during a wash, and the skin's state
 * (handed to the hands being drawn). Everything follows t, so a wash held at a moment (tests) holds.
 */
export class WashEffects {
  private stream: THREE.Mesh;
  private runoff: THREE.Mesh[];
  private splash: THREE.Mesh[];
  private drops: THREE.InstancedMesh;
  private dropState: Drop[] = [];
  private spawnAcc = 0;
  private gel: THREE.Mesh;
  private sheet: THREE.Mesh;
  private wad: THREE.Mesh;
  private all: THREE.Object3D[];
  dbg: WashDebug | null = null;

  constructor(private scene: THREE.Scene) {
    const water = new THREE.MeshStandardMaterial({
      color: '#cfe6f2',
      roughness: 0.04,
      metalness: 0.1,
      emissive: '#5d7f92',
      emissiveIntensity: 0.28,
    });
    // (opaque: a transparent column would stamp the AO's normals)
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0052, 1, 10, 1, true).translate(0, -0.5, 0), water);
    this.runoff = [0, 1].map(() => new THREE.Mesh(new THREE.CylinderGeometry(0.0024, 0.0031, 1, 8, 1, true).translate(0, -0.5, 0), water));
    this.splash = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        G.circle(0.03, 18),
        new THREE.MeshStandardMaterial({
          color: '#dceef6',
          roughness: 0.05,
          emissive: '#5d7f92',
          emissiveIntensity: 0.22,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      return m;
    });
    this.drops = new THREE.InstancedMesh(G.sphere(1, 7, 5), water, MAX_DROPS);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.gel = new THREE.Mesh(
      G.sphere(0.0085, 14, 10),
      new THREE.MeshStandardMaterial({
        color: '#e9eef5',
        roughness: 0.06,
        metalness: 0,
        emissive: '#9fb2c4',
        emissiveIntensity: 0.12,
      }),
    );
    // the towel: a sheet hanging from its top edge (scaled to how much of it is out)
    // (paper scatters light: a fair bit of its own, or a sheet hanging by the wall reads as grey card in the AO)
    const paper = lambert('#f4f2ec', { roughness: 0.95, emissive: '#f4f2ec', emissiveIntensity: 0.45 });
    this.sheet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.0016).translate(0, -0.5, 0), paper);
    this.wad = new THREE.Mesh(
      wadGeometry(),
      lambert('#f3f1ea', {
        roughness: 0.95,
        flat: true,
        emissive: '#f3f1ea',
        emissiveIntensity: 0.12,
      }),
    );
    this.all = [this.stream, ...this.runoff, ...this.splash, this.drops, this.gel, this.sheet, this.wad];
    for (const o of this.all) {
      o.visible = false;
      o.castShadow = false;
      scene.add(o);
    }
  }

  /** the fixture's moving parts back at rest (a wash done or cut off) */
  restore(fx: WashFixture) {
    if (fx.lever) fx.lever.hinge.rotation.x = fx.lever.off;
    if (fx.soap.plate) fx.soap.plate.position.set(0, 0, 0);
    if (fx.towel?.tail) {
      fx.towel.tail.visible = true;
      fx.towel.tail.scale.set(1, 1, 1);
    }
    if (fx.bin?.pedal) fx.bin.pedal.rotation.x = 0;
    if (fx.bin?.lid) fx.bin.lid.rotation.x = 0;
  }

  hide() {
    for (const o of this.all) o.visible = false;
    this.dropState = [];
    this.drops.count = 0;
  }

  /** `ts` takes the towel; `rig` the hands being drawn (first person or the avatar's); `ground` the floor you stand on */
  update(t: number, dt: number, fx: WashFixture, rig: HandRig, ts: HandSide, ground = fx.basin.y - 0.75) {
    const W = WASH;
    // ── the fixture
    const theta = leverAngle(fx, t);
    if (fx.lever && theta !== null) fx.lever.hinge.rotation.x = theta;
    const kp = plateK(t);
    if (fx.soap.plate) fx.soap.plate.position.set(0, fx.soap.down ? -fx.soap.travel * kp : 0, fx.soap.down ? 0 : -fx.soap.travel * kp);
    const kb = pedalK(t);
    if (fx.bin?.pedal) fx.bin.pedal.rotation.x = 0.28 * kb;
    if (fx.bin?.lid) fx.bin.lid.rotation.x = -1.15 * kb;
    if (fx.towel?.tail) {
      fx.towel.tail.visible = !(t >= W.grab + 0.04 && t < W.out);
      fx.towel.tail.scale.set(1, t >= W.out && t < W.nextTail ? 0.12 + 0.88 * ramp(t, W.out, W.nextTail) : 1, 1);
    }
    // ── the skin
    const cov = { R: coverage('R', t), L: coverage('L', t) };
    const wet = wetness(t, !!fx.towel);
    for (const side of ['R', 'L'] as HandSide[]) {
      for (const k of REGIONS) rig.setLather(side, k, cov[side][k]);
      rig.setWet(side, wet);
    }
    // ── the water
    const running = waterOn(fx, t);
    const shapes: Record<HandSide, HandShape | null> = {
      R: rig.shape('R'),
      L: rig.shape('L'),
    };
    const ox = fx.outlet.x;
    const oz = fx.outlet.z;
    const bottom = fx.basin.y + 0.002;
    let hit: { y: number; region: LatherRegion; side: HandSide } | null = null;
    const near: HandSide[] = [];
    for (const side of ['R', 'L'] as HandSide[]) {
      const s = shapes[side];
      if (!s) continue;
      const h = hitDown(ox, oz, fx.outlet.y - 0.004, bottom, s, 0.0045);
      if (h && (!hit || h.y > hit.y)) hit = { ...h, side };
      // within a finger's width of the stream: water runs down it too
      if (h || hitDown(ox, oz, fx.outlet.y - 0.004, bottom, s, 0.02)) near.push(side);
    }
    this.stream.visible = running;
    for (const m of this.runoff) m.visible = false;
    for (const m of this.splash) m.visible = false;
    const emit: Emit[] = [];
    // off the tap, wet hands drip from their lowest fingertips (into the basin, or onto the floor
    // walking over to the towels) until they're dried; shaken off, the drops fly
    if (!running && t > W.rinseIn && t < W.dry + 0.3) {
      const shaking = !fx.towel && t > W.towel && t < W.towel + 0.7;
      for (const side of ['R', 'L'] as HandSide[]) {
        const s = shapes[side];
        if (!s) continue;
        let low: THREE.Vector3 | null = null;
        for (const c of s.caps) if ((c.region === 'tips' || c.region === 'thumb') && (!low || c.b.y < low.y)) low = c.b;
        if (!low) continue;
        const over = Math.hypot(low.x - fx.basin.x, low.z - fx.basin.z) < fx.basinR + 0.04;
        emit.push({
          at: low.clone().addScaledVector(UP, -0.006),
          rate: (shaking ? 34 : 6) * (1 - ramp(t, W.dry - 0.3, W.dry + 0.3)),
          up: shaking ? 0.5 : 0,
          spread: shaking ? 0.55 : 0.02,
          floor: over ? fx.basin.y + 0.002 : ground + 0.002,
        });
      }
    }
    if (running) {
      const end = hit ? hit.y : bottom;
      const len = Math.max(0.01, fx.outlet.y - end);
      this.stream.position.copy(fx.outlet);
      this.stream.scale.set(1, len, 1);
      if (hit) {
        emit.push({
          at: new THREE.Vector3(ox, hit.y + 0.002, oz),
          rate: 130,
          up: 0.32,
          spread: 0.45,
        });
        // runs off the lowest fingertip of each hand in it, down to the basin
        near.slice(0, 2).forEach((side, i) => {
          const s = shapes[side]!;
          let low: THREE.Vector3 | null = null;
          for (const c of s.caps) if (c.region === 'tips' && (!low || c.b.y < low.y)) low = c.b;
          if (!low || Math.hypot(low.x - ox, low.z - oz) > 0.08 || low.y > hit!.y) low = new THREE.Vector3(ox, hit!.y - 0.01, oz);
          const m = this.runoff[i];
          const from = low.clone().addScaledVector(UP, -0.004);
          const l2 = Math.max(0.005, from.y - bottom);
          m.visible = l2 > 0.006;
          m.position.copy(from);
          m.scale.set(1, l2, 1);
          const sp = this.splash[i];
          sp.visible = true;
          sp.position.set(from.x, bottom + 0.0015, from.z);
          sp.scale.setScalar(0.55);
          emit.push({
            at: new THREE.Vector3(from.x, bottom + 0.004, from.z),
            rate: 45,
            up: 0.2,
            spread: 0.3,
          });
        });
      } else {
        const sp = this.splash[2];
        sp.visible = true;
        sp.position.set(ox, bottom + 0.0015, oz);
        sp.scale.setScalar(1);
        emit.push({
          at: new THREE.Vector3(ox, bottom + 0.004, oz),
          rate: 40,
          up: 0.22,
          spread: 0.3,
        });
      }
    }
    this.droplets(dt, emit, bottom);
    // ── the soap: out of the nozzle as the plate goes in, falling into the cupped palm, rubbed in
    // (into the palm of the hand cupped under the nozzle)
    const cs = soapHand(fx);
    const palmR = rig.point(cs, 'palm', new THREE.Vector3());
    const qR = new THREE.Quaternion();
    const hasR = rig.frame(cs, _w, qR);
    const g = this.gel;
    g.visible = false;
    if (t >= W.dose && t < W.lather + 0.5) {
      g.visible = true;
      const noz = fx.soap.nozzle;
      if (t < W.dose + 0.05) {
        // the dose swelling at the tip
        g.position.copy(noz).addScaledVector(UP, -0.006);
        g.quaternion.identity();
        g.scale.setScalar(0.35 + 0.65 * ramp(t, W.dose, W.dose + 0.05));
      } else if (t < W.land) {
        // falling (a little faster than free fall: it's pushed out) to the palm
        const k = clamp01((t - W.dose - 0.05) / (W.land - W.dose - 0.05));
        const target = palmR.clone().addScaledVector(UP, 0.004);
        g.position.copy(noz).lerp(target, k * k);
        g.quaternion.identity();
        g.scale.set(0.9, 1.15, 0.9);
      } else {
        // in the palm: a flattened blob (rubbed in through the first step)
        if (hasR) g.quaternion.copy(qR);
        const pn = _v.set(0, 1, 0).applyQuaternion(g.quaternion);
        g.position.copy(palmR).addScaledVector(pn, 0.0035);
        const k = 1 - ramp(t, W.lather, W.lather + 0.45);
        g.scale.set(1.6 * k, 0.5 * k, 1.5 * k);
        g.visible = k > 0.02;
      }
    }
    // ── the towel: pulled out of the slot by its tail, held, crumpled to dry the hands, binned
    const sheet = this.sheet;
    const wad = this.wad;
    sheet.visible = wad.visible = false;
    const tw = fx.towel;
    let tipsToTail: { index: number; thumb: number } | null = null;
    let sheetTop: THREE.Vector3 | null = null;
    let attached = false;
    if (tw) {
      const pinch = rig.point(ts, 'pinch', new THREE.Vector3());
      if (t >= W.grab + 0.04 && t < W.out) {
        // still in the slot: from the slot down to the fingers, its edge between them (run on past
        // them, the sheet hid the hand behind it, as if it grabbed into the paper)
        attached = true;
        const d = pinch.clone().sub(tw.slot);
        const L = Math.min(SHEET, d.length() + 0.012);
        this.hang(tw.slot, d.normalize(), tw.across, L);
        sheetTop = tw.slot.clone();
      } else if (t >= W.out && t < W.dry + 0.12) {
        // out: hanging from the fingers, crumpling as the hands come together
        const crumple = ramp(t, W.dry - 0.25, W.dry + 0.1);
        const top = pinch.clone().addScaledVector(UP, 0.012);
        this.hang(top, _v.set(0, -1, 0).addScaledVector(fx.f, 0.15).normalize(), tw.across, SHEET * (1 - 0.7 * crumple), 1 - 0.65 * crumple);
        sheetTop = top;
      }
      // the wad: between the palms drying, then in the towel hand, then into the bin
      if (t >= W.dry - 0.05 && (t < W.landBin || !fx.bin)) {
        const q = new THREE.Quaternion();
        rig.frame(ts, _w, q);
        const ball = ramp(t, W.bin - 0.2, W.bin + 0.2);
        wad.scale.set(0.15 - 0.1 * ball, 0.034 + 0.008 * ball, 0.14 - 0.088 * ball).multiplyScalar(ramp(t, W.dry - 0.05, W.dry + 0.08));
        wad.quaternion.copy(q);
        const pR = rig.point('R', 'palm', new THREE.Vector3());
        const pL = rig.point('L', 'palm', new THREE.Vector3());
        const between = pR.add(pL).multiplyScalar(0.5);
        const held = rig.point(ts, 'palm', new THREE.Vector3()).add(_v.set(0, 0.022, 0).applyQuaternion(q));
        wad.position.copy(between).lerp(held, ramp(t, W.bin, W.bin + 0.15));
        if (t >= W.drop && fx.bin) {
          const k = ramp(t, W.drop, W.landBin);
          wad.position.lerp(fx.bin.into.clone().addScaledVector(UP, -0.05), k * k);
        }
        wad.visible = true;
      }
      // (tests) how close the grabbing fingertips are to the tail
      if (tw.grab.parent) {
        const hang = tw.grab.parent;
        const d = (p: THREE.Vector3) => {
          const l = hang.worldToLocal(p.clone());
          const dx = Math.max(0, Math.abs(l.x) - 0.09);
          const dy = Math.max(0, Math.abs(l.y + 0.035) - 0.035);
          return Math.hypot(dx, dy, l.z);
        };
        tipsToTail = {
          index: +d(rig.point(ts, 'tipIndex', new THREE.Vector3())).toFixed(4),
          thumb: +d(rig.point(ts, 'tipThumb', new THREE.Vector3())).toFixed(4),
        };
      }
    }
    // ── for tests
    const tip = (side: HandSide) => ({
      index: r3(rig.point(side, 'tipIndex', new THREE.Vector3())),
      middle: r3(rig.point(side, 'tipMiddle', new THREE.Vector3())),
      thumb: r3(rig.point(side, 'tipThumb', new THREE.Vector3())),
    });
    const leverTouch =
      fx.lever && theta !== null
        ? (() => {
            const top = t >= W.rinseOut;
            const c = leverPoint(fx.lever!, theta, 0.84, top ? 0.0068 : -0.0068, new THREE.Vector3());
            return +c.distanceTo(rig.point('R', top ? 'wristVolar' : 'wristBack', new THREE.Vector3())).toFixed(4);
          })()
        : null;
    this.dbg = {
      t: +t.toFixed(3),
      phase: washPhase(t),
      water: running,
      outlet: r3(fx.outlet),
      basinY: +fx.basin.y.toFixed(4),
      streamBottom: running ? +(hit ? hit.y : bottom).toFixed(4) : null,
      streamHit: running && hit ? `${hit.side}:${hit.region}` : null,
      tips: { R: tip('R'), L: tip('L') },
      palm: {
        R: r3(rig.point('R', 'palm', new THREE.Vector3())),
        L: r3(rig.point('L', 'palm', new THREE.Vector3())),
      },
      heel: {
        R: r3(rig.point('R', 'heel', new THREE.Vector3())),
        L: r3(rig.point('L', 'heel', new THREE.Vector3())),
      },
      wristBack: r3(rig.point('R', 'wristBack', new THREE.Vector3())),
      wristVolar: r3(rig.point('R', 'wristVolar', new THREE.Vector3())),
      nozzle: r3(fx.soap.nozzle),
      cup: { hand: cs, palm: r3(palmR), heel: r3(rig.point(cs === 'R' ? 'L' : 'R', 'heel', new THREE.Vector3())) },
      press: r3(wpos(fx.soap.press)),
      plate: +kp.toFixed(3),
      lever: theta === null ? null : +theta.toFixed(3),
      leverTouch,
      gel: { visible: g.visible, at: g.visible ? r3(g.position) : null },
      coverage: { R: roundCover(cov.R), L: roundCover(cov.L) },
      total: {
        R: +totalCoverage(cov.R).toFixed(3),
        L: +totalCoverage(cov.L).toFixed(3),
      },
      wet: +wet.toFixed(3),
      towel: tw
        ? {
            hand: ts,
            grab: r3(wpos(tw.grab)),
            pinch: r3(rig.point(ts, 'pinch', new THREE.Vector3())),
            tipsToTail,
            tail: !!tw.tail?.visible,
            sheet: {
              visible: sheet.visible,
              attached,
              top: sheetTop ? r3(sheetTop) : null,
            },
            slot: r3(tw.slot),
          }
        : null,
      bin: fx.bin
        ? {
            pedal: +kb.toFixed(3),
            lid: fx.bin.lid ? +fx.bin.lid.rotation.x.toFixed(3) : 0,
          }
        : null,
    };
  }

  /** the towel sheet hanging from `top` along `down`, `len` long, its width along `across` */
  private hang(top: THREE.Vector3, down: THREE.Vector3, across: THREE.Vector3, len: number, width = 1) {
    const y = down.clone().negate();
    const x = across.clone().addScaledVector(y, -across.dot(y)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    this.sheet.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
    this.sheet.position.copy(top);
    this.sheet.scale.set(width, Math.max(0.01, len), 1);
    this.sheet.visible = true;
  }

  /** splashes: drops thrown off where the water hits a hand or the basin */
  private droplets(dt: number, emit: Emit[], floor: number) {
    let seed = (this.spawnAcc * 9301 + 49297) % 233280;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (const e of emit) {
      this.spawnAcc += e.rate * dt;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.dropState.length >= MAX_DROPS) this.dropState.shift();
        const a = rnd() * Math.PI * 2;
        const sp = e.spread * (0.4 + 0.6 * rnd());
        // (a drip falls until it lands: a floor 0.9 m down is ~0.45 s away)
        const drip = e.up === 0;
        this.dropState.push({
          p: e.at.clone(),
          v: new THREE.Vector3(Math.cos(a) * sp, e.up * (0.3 + 0.7 * rnd()), Math.sin(a) * sp),
          life: drip ? 0.8 : 0.25 + 0.3 * rnd(),
          s: drip ? 0.0018 + 0.0008 * rnd() : 0.0011 + 0.0013 * rnd(),
          floor: e.floor ?? floor,
        });
      }
    }
    this.spawnAcc = Math.min(this.spawnAcc, 4);
    let n = 0;
    const keep: Drop[] = [];
    for (const d of this.dropState) {
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.life <= 0 || d.p.y < d.floor) continue;
      keep.push(d);
      _m.compose(d.p, _q.identity(), _w.setScalar(d.s));
      this.drops.setMatrixAt(n++, _m);
    }
    this.dropState = keep;
    this.drops.count = n;
    this.drops.visible = n > 0;
    this.drops.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const o of this.all) o.removeFromParent();
  }
}

function roundCover(c: Record<LatherRegion, number>): Record<LatherRegion, number> {
  return {
    palm: +c.palm.toFixed(3),
    back: +c.back.toFixed(3),
    fingers: +c.fingers.toFixed(3),
    thumb: +c.thumb.toFixed(3),
    tips: +c.tips.toFixed(3),
  };
}

/**
 * The choreography's vocabulary for hand hygiene (hygiene.ts, handwash.ts): a pose per hand (the
 * wrist in the world, the hand bone's orientation, its fingers), the frames poses are built in, the
 * WHO rub steps, and the easing used to move between poses. One pose drives the first-person hands
 * (fpHands.ts) and the avatar's arms (hands.ts) alike: both use the Rocketbox hand frame, X along the
 * fingers, Y out of the palm, Z toward the thumb (left hand: −Z).
 */
import * as THREE from 'three';
import { OPEN, type FingerPose } from './fpHands';
import { handQuat, type HandSide } from './hands';

export const UP = new THREE.Vector3(0, 1, 0);
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 over [a, b] (smoothstep) */
export const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
export const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);

/** first person: the most a hand reaches from its shoulder (m) */
export const FP_REACH = 0.66;

/** one hand at one moment: the wrist (world), the hand bone's orientation, its fingers */
export interface HandPose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  fingers: FingerPose;
  /** third person: how much the arm follows (0..1) and where the elbow points */
  w: number;
  pole?: THREE.Vector3;
  /** first person: a longer reach than FP_REACH (leaning out for something beside you) */
  reach?: number;
}

/** a hand turned so its fingers point along `fingers` and its palm faces `palm` */
export function palmQuat(side: HandSide, fingers: THREE.Vector3, palm: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const x = fingers.clone().normalize();
  const y = palm.clone().addScaledVector(x, -palm.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return handQuat(side, x, z.multiplyScalar(side === 'R' ? 1 : -1), out);
}

export const pose = (curl: number, spread = 0.05, thumb = 0.15, oppose = 0.1): FingerPose => ({ curl, spread, thumb, oppose });
export const FLAT = pose(0.02, 0.04, 0.05, 0.05);
export const CUP = pose(0.38, 0.02, 0.35, 0.35);
export const SPREAD = pose(0.05, 0.22, 0.1, 0.05);
export const HOOK = pose(0.75, 0.05, 0.5, 0.3);
export const PINCH = pose(0.55, 0.02, 0.65, 0.75);
/** thumb and index apart, ready to close on an edge */
export const PINCH_OPEN = pose(0.3, 0.04, 0.15, 0.55);

/**
 * The frame poses are built in: a point between the hands (`c`) and three axes, right, up and
 * forward. Third person: in front of the chest, the body's axes. First person: in the bottom of the
 * view, the camera's axes (so the rubbing stays in sight wherever you look).
 */
export interface Frame {
  c: THREE.Vector3;
  r: THREE.Vector3;
  u: THREE.Vector3;
  f: THREE.Vector3;
  /** a shoulder per side (poles), and how big the body is (1 = 1.78 m) */
  sh: Record<HandSide, THREE.Vector3>;
  k: number;
  tp: boolean;
}

/**
 * WHO steps 2–7 (palm to palm … fingertips), a pose for both hands at time s into the rubbing. Each
 * step eases in from where the last one left off (the hands move from one grip to the next, they
 * don't jump), its rubbing swells once the hands have met and settles before the next; a step done
 * one hand then the other (backs, thumbs, fingertips) lets go and changes over halfway, the hands
 * drawing apart as they swap. The pair also drifts a little as a whole, as real hands do.
 */
export const STEPS = 6;
/** how much of a step goes on moving into it from the last one */
const STEP_IN = 0.25;
export function rubPoses(F: Frame, s: number, step: number): Record<HandSide, HandPose> {
  const i = Math.min(STEPS - 1, Math.max(0, Math.floor(s / step)));
  const ph = clamp01((s - i * step) / step);
  let P = rubStep(F, i, ph);
  if (i > 0 && ph < STEP_IN) {
    // from one grip to the next round each other, not through: blended straight across, the hands
    // scissored through each other in an X, fingers splayed (palm to palm into one palm over a back)
    const k = smooth(ph / STEP_IN);
    P = blend2(rubStep(F, i - 1, 1), P, k);
    apart(P, F, Math.sin(Math.PI * k));
  }
  // the pair together: a slow drift up and down and to and fro (the same for both: the grip holds)
  const drift = F.u.clone().multiplyScalar(0.006 * Math.sin(s * 2 * Math.PI * 0.55)).addScaledVector(F.f, 0.005 * Math.sin(s * 2 * Math.PI * 0.37 + 1.1));
  P.R.p.add(drift);
  P.L.p.add(drift);
  return P;
}

/** one WHO step at phase ph (0..1): its grip, the rubbing on top (none at either end: steps join at rest) */
function rubStep(F: Frame, i: number, ph: number): Record<HandSide, HandPose> {
  const { c, r, u, f } = F;
  const P = (x: number, y: number, z: number) => c.clone().addScaledVector(r, x).addScaledVector(u, y).addScaledVector(f, z);
  const d = (x: number, y: number, z: number) => new THREE.Vector3().addScaledVector(r, x).addScaledVector(u, y).addScaledVector(f, z).normalize();
  const turn = (v: THREE.Vector3, axis: THREE.Vector3, a: number) => v.applyAxisAngle(axis, a);
  const two = i === 1 || i >= 4;
  // the rubbing: swells once the grip is made, settles before the next (and, done one hand then the
  // other, while the hands change over halfway)
  const swap = two ? ramp(ph, 0.4, 0.6) : 0;
  const env = ramp(ph, STEP_IN * 0.5, STEP_IN + 0.12) * (1 - ramp(ph, 0.86, 1)) * (two ? 1 - ramp(ph, 0.32, 0.42) * (1 - ramp(ph, 0.58, 0.68)) : 1);
  const w = ph * Math.PI * 2;
  const osc = Math.sin(w * 2.2) * env;
  const osc2 = Math.sin(w * 2.2 + 1.3) * env;
  const pair = (half: 0 | 1): Record<HandSide, HandPose> => {
    const out = {} as Record<HandSide, HandPose>;
    const set = (side: HandSide, p: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, fp: FingerPose) => {
      out[side] = { p, q: palmQuat(side, fingers, palm), fingers: fp, w: 1 };
    };
    switch (i) {
      case 0: {
        // palm to palm, fingers forward and up: the hands slide along each other and turn a little
        // about the palms as they go (a rub, not a pump)
        const fd = d(0, 0.55, 0.85);
        const a = 0.15 * osc2;
        set('R', P(0.016, 0, 0).addScaledVector(fd, -0.055 + osc * 0.022), turn(fd.clone(), r, a), d(-1, 0, 0), FLAT);
        set('L', P(-0.016, 0, 0).addScaledVector(fd, -0.055 - osc * 0.022), turn(fd.clone(), r, -a), d(1, 0, 0), FLAT);
        break;
      }
      case 1: {
        // one palm over the other hand's back, fingers interlaced (right over left, then left over
        // right): the top hand strokes up and down the back, the one under gives a little
        const top: HandSide = half ? 'L' : 'R';
        const bot: HandSide = half ? 'R' : 'L';
        const sb = bot === 'R' ? 1 : -1;
        const fb = d(-sb * 0.35, -0.15, 1);
        set(bot, P(sb * 0.05, -0.012, -0.05 - 0.005 * osc), fb, d(0, -1, 0), SPREAD);
        const ft = d(-sb * 0.2, -0.2, 1);
        set(top, P(sb * 0.045 + sb * 0.01 * osc, 0.026, -0.065 + 0.025 * osc), turn(ft, u, 0.08 * osc2), d(0, -1, 0), pose(0.12, 0.2, 0.1, 0.05));
        break;
      }
      case 2: {
        // palm to palm, fingers interlaced and spread, the right hand a finger's width over: the
        // fingers slide in and out between each other
        const fd = d(0, 0.35, 1);
        set('R', P(0.017, 0.006 + osc * 0.012, -0.055 + 0.006 * osc2), fd, d(-1, 0, 0), SPREAD);
        set('L', P(-0.017, -0.006 - osc * 0.012, -0.055 - 0.006 * osc2), fd, d(1, 0, 0), SPREAD);
        break;
      }
      case 3: {
        // the backs of the fingers in the opposing palm, fingers interlocked (right palm down, left
        // palm up): side to side, the locked fingers rocking with it
        const rock = 0.12 * osc;
        set('R', P(0.06 + osc * 0.012, 0.022, -0.035), turn(d(-1, -0.3, 0.45), f, rock), d(0, -1, 0.1), HOOK);
        set('L', P(-0.06 + osc * 0.012, -0.022, -0.035), turn(d(1, 0.3, 0.45), f, rock), d(0, 1, 0.1), HOOK);
        break;
      }
      case 4: {
        // each thumb clasped in the other hand's fist and rubbed round (left thumb in the right
        // hand, then the right): the fist turns about the thumb as it circles
        const grip: HandSide = half ? 'L' : 'R';
        const held: HandSide = half ? 'R' : 'L';
        const sh = held === 'R' ? 1 : -1;
        const a = ph * Math.PI * 2 * 3;
        const twist = 0.35 * Math.sin(a) * env;
        const axis = d(-sh * 0.5, 0.15, 1);
        set(held, P(sh * 0.07, -0.01, -0.06), d(-sh * 0.5, 0.15, 1), d(-sh * 0.6, 0.6, 0), pose(0.25, 0.04, 0.0, 0.0));
        set(grip, P(-sh * 0.01 + 0.012 * Math.cos(a) * env, 0.035 + 0.012 * Math.sin(a) * env, -0.04), turn(d(sh * 0.4, -0.5, 1), axis, twist), turn(d(sh * 0.5, -0.4, 0.2), axis, twist), pose(0.7, 0.02, 0.6, 0.7));
        break;
      }
      default: {
        // the fingertips of one hand circled in the other palm, back and forth (right in left, then
        // left in right): the cupped palm turns to meet them
        const tips: HandSide = half ? 'L' : 'R';
        const cup: HandSide = half ? 'R' : 'L';
        const sc = cup === 'R' ? 1 : -1;
        const a = ph * Math.PI * 2 * 3;
        set(cup, P(sc * 0.07, -0.03, -0.06), turn(d(-sc * 0.6, 0.1, 1), u, 0.1 * Math.sin(a) * env), d(0, 1, 0), pose(0.25, 0.05, 0.2, 0.2));
        set(tips, P(-sc * 0.04 + 0.012 * Math.cos(a) * env, 0.05, -0.08 + 0.012 * Math.sin(a) * env), turn(d(sc * 0.2, -1, 0.35), u, 0.18 * Math.cos(a) * env), d(0, 0.2, 1), pose(0.55, 0.0, 0.5, 0.6));
        break;
      }
    }
    return out;
  };
  if (!two) return pair(0);
  if (swap <= 0) return pair(0);
  if (swap >= 1) return pair(1);
  // changing over: from the first hand's grip to the other's, drawn apart on the way
  const out = blend2(pair(0), pair(1), swap);
  apart(out, F, Math.sin(Math.PI * swap));
  return out;
}

/** both hands drawn apart sideways and back toward you, `a` of the way (0..1): between two grips they don't pass through each other */
function apart(P: Record<HandSide, HandPose>, F: Frame, a: number) {
  P.R.p.addScaledVector(F.r, 0.04 * a).addScaledVector(F.f, -0.02 * a).addScaledVector(F.u, 0.012 * a);
  P.L.p.addScaledVector(F.r, -0.04 * a).addScaledVector(F.f, -0.02 * a).addScaledVector(F.u, 0.012 * a);
}

/**
 * A first-person frame with the body's axes: up is up and forward the view's, levelled, its middle
 * still in the view. The rub's grips are the body's (palm down over the other hand's back is palm to
 * the floor): turned with the view instead, looking down at them saw the hands edge-on, stacked like
 * fists. (Third person: the frame as it is.)
 */
export function levelled(F: Frame): Frame {
  if (F.tp) return F;
  const r = F.r.clone().setY(0).normalize();
  return { ...F, r, u: UP.clone(), f: new THREE.Vector3().crossVectors(UP, r) };
}

/** where a hand rests, off to the side (third person: weight 0, the mocap has it; first person: out of view, below) */
export function restPose(F: Frame, side: HandSide): HandPose {
  const s = side === 'R' ? 1 : -1;
  const p = F.c
    .clone()
    .addScaledVector(F.r, s * 0.22)
    .addScaledVector(F.u, F.tp ? -0.25 : -0.38)
    .addScaledVector(F.f, F.tp ? -0.05 : -0.05);
  return {
    p,
    q: palmQuat(side, F.f.clone().addScaledVector(F.u, 0.4), F.r.clone().multiplyScalar(-s)),
    fingers: OPEN,
    w: 0,
  };
}

export function blend(a: HandPose, b: HandPose, k: number): HandPose {
  const lerp = (x: number, y: number) => x + (y - x) * k;
  return {
    p: lerpV(a.p, b.p, k),
    q: a.q.clone().slerp(b.q, k),
    fingers: {
      curl: lerp(a.fingers.curl, b.fingers.curl),
      spread: lerp(a.fingers.spread, b.fingers.spread),
      thumb: lerp(a.fingers.thumb, b.fingers.thumb),
      oppose: lerp(a.fingers.oppose, b.fingers.oppose),
    },
    w: lerp(a.w, b.w),
    pole: b.pole ?? a.pole,
    ...(a.reach || b.reach ? { reach: lerp(a.reach ?? FP_REACH, b.reach ?? FP_REACH) } : {}),
  };
}

/** both hands blended between two pairs of poses */
export function blend2(a: Record<HandSide, HandPose>, b: Record<HandSide, HandPose>, k: number): Record<HandSide, HandPose> {
  return { R: blend(a.R, b.R, k), L: blend(a.L, b.L, k) };
}

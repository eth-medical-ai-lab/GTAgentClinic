/**
 * Hands doing things with things (amenities.ts, payment.ts): a cup taken off a stack, a lid pressed
 * on, a phone held to a card reader. Each moment is a pose per hand, the same world pose in either
 * camera: the wrist and the hand bone's turn (hands.ts handQuat frame: X along the fingers, Y out of
 * the palm, Z toward the thumb; the left hand's thumb is −Z). In third person the avatar's arm
 * reaches it (two-bone IK, hands.ts) and the fingers close as asked; in first person a hand comes
 * into view from the shoulder (fpHands.ts), never further out than an arm's length.
 *
 * What a hand holds hangs off a grip point in that frame (GRIP), read back from the hand as drawn
 * after the pose (third person: the avatar's hand bone after the IK), so a cup never floats free of
 * the fingers even where the arm falls a little short.
 */
import * as THREE from 'three';
import { FpHands, OPEN, type FingerPose } from './fpHands';
import { fpShoulders } from './fpArms';
import { handQuat, type HandSide, type PlayerHands } from './hands';

export const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** first person: the most a hand reaches from its shoulder (m) */
export const FP_REACH = 0.72;

export interface HandPose {
  /** the wrist (world) and the hand's turn */
  p: THREE.Vector3;
  q: THREE.Quaternion;
  fingers: FingerPose;
  /** how much the arm follows (third person, 0..1); first person: drawn above ~0 */
  w: number;
  /** third person: where the elbow points */
  pole?: THREE.Vector3;
}

/** the body's frame for a moment: chest-height middle, right, up, forward (horizontal), the shoulders */
export interface Frame {
  c: THREE.Vector3;
  r: THREE.Vector3;
  f: THREE.Vector3;
  sh: Record<HandSide, THREE.Vector3>;
  /** grip metres → world metres (the avatar's scale; 1 in first person) */
  s: number;
  tp: boolean;
}

/** finger poses (fpHands.ts terms; third person maps them onto the avatar's fingers) */
export const FINGERS = {
  open: OPEN,
  /** round a cup's body */
  wrap: { curl: 0.62, spread: 0.02, thumb: 0.55, oppose: 0.55 } as FingerPose,
  /** fingertips round a rim, from above */
  claw: { curl: 0.5, spread: 0.12, thumb: 0.45, oppose: 0.45 } as FingerPose,
  /** a phone or a card reader, held flat */
  phone: { curl: 0.5, spread: 0.04, thumb: 0.35, oppose: 0.3 } as FingerPose,
  /** pressing a button: fingers straight, together */
  press: { curl: 0.12, spread: 0.0, thumb: 0.25, oppose: 0.2 } as FingerPose,
};

/**
 * Grip points in the hand's frame (m at 1.78 m): where the held thing's anchor sits.
 *   side(r)  a cup's middle, held from the side (hands.ts's upright hold: 8 cm along the fingers, its
 *            radius + 12 mm out of the palm), anchor = the cup's grip centre
 *   claw     a rim from above, palm down: anchor = the rim's centre, 3 cm under the palm
 *   lid      a lid pinched from above: anchor = the lid's top centre
 *   tip      the middle fingertips (pressing a button)
 */
export const GRIP = {
  side: (r: number) => new THREE.Vector3(0.08, r + 0.012, 0),
  claw: new THREE.Vector3(0.078, 0.032, 0),
  lid: new THREE.Vector3(0.082, 0.022, 0),
  tip: new THREE.Vector3(0.178, 0.004, 0.006),
};

/** a hand turned so its fingers point along `fingers` and its palm faces `palm` */
export function palmQuat(side: HandSide, fingers: THREE.Vector3, palm: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const x = fingers.clone().normalize();
  const y = palm.clone().addScaledVector(x, -palm.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return handQuat(side, x, z.multiplyScalar(side === 'R' ? 1 : -1), out);
}

/** a grip point (given for the right hand) in a hand's bone frame: the left hand's thumb is −Z */
export function handed(side: HandSide, g: THREE.Vector3): THREE.Vector3 {
  return side === 'R' ? g.clone() : new THREE.Vector3(g.x, g.y, -g.z);
}

/** the wrist that puts grip point `g` (right-hand frame, mirrored for the left) at `at` (world) with the hand turned `q` */
export function wristFor(side: HandSide, at: THREE.Vector3, q: THREE.Quaternion, g: THREE.Vector3, s: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(handed(side, g)).multiplyScalar(s).applyQuaternion(q).negate().add(at);
}

/** palm down over something, the fingers reaching away from the shoulder toward it */
export function fromAbove(side: HandSide, F: Frame, at: THREE.Vector3): THREE.Quaternion {
  const d = at.clone().sub(F.sh[side]).setY(0);
  if (d.lengthSq() < 1e-4) d.copy(F.f);
  return palmQuat(side, d.normalize().addScaledVector(DOWN, 0.35), DOWN);
}

/**
 * Round a cup from its near side, as you take a glass off a counter: the fingers reach along toward it
 * (a little across), the palm turned in to it (toward the body's middle), the thumb up. The cup can
 * stand right against a wall or a machine; the hand never goes round behind it.
 */
export function fromSide(side: HandSide, F: Frame, at: THREE.Vector3): THREE.Quaternion {
  const sg = side === 'R' ? 1 : -1;
  const d = at.clone().sub(F.sh[side]).setY(0);
  if (d.lengthSq() < 1e-4) d.copy(F.f);
  d.normalize();
  const fingers = d.clone().addScaledVector(F.r, -sg * 0.2).normalize();
  return palmQuat(side, fingers, F.r.clone().multiplyScalar(-sg));
}

/** where the hand rests (third person: the arm's own pose, weight 0; first person: just under the view) */
export function restPose(F: Frame, side: HandSide): HandPose {
  const s = side === 'R' ? 1 : -1;
  const p = F.c.clone().addScaledVector(F.r, s * 0.22).addScaledVector(UP, F.tp ? -0.25 : -0.45).addScaledVector(F.f, F.tp ? -0.05 : 0.05);
  return { p, q: palmQuat(side, F.f.clone().addScaledVector(UP, 0.4), F.r.clone().multiplyScalar(-s)), fingers: OPEN, w: 0 };
}

export function blend(a: HandPose, b: HandPose, k: number): HandPose {
  const lerp = (x: number, y: number) => x + (y - x) * k;
  return {
    p: a.p.clone().lerp(b.p, k),
    q: a.q.clone().slerp(b.q, k),
    fingers: { curl: lerp(a.fingers.curl, b.fingers.curl), spread: lerp(a.fingers.spread, b.fingers.spread), thumb: lerp(a.fingers.thumb, b.fingers.thumb), oppose: lerp(a.fingers.oppose, b.fingers.oppose) },
    w: lerp(a.w, b.w),
    pole: b.pole ?? a.pole,
  };
}

export const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
/** 0 before a, 1 after b, eased between */
export const ramp = (t: number, a: number, b: number) => smooth((t - a) / Math.max(1e-6, b - a));

/**
 * Poses the hands for one thing in progress and reads back where they are. One per user (amenities,
 * payment); its first-person hands are its own.
 */
export class Hands {
  readonly fp: FpHands;
  private shown = false;
  private readonly q = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private hands: PlayerHands,
    private tp: () => boolean,
  ) {
    this.fp = new FpHands(scene);
  }

  /** the body's frame now: third person from the avatar, first person from the eyes */
  frame(): Frame | null {
    if (this.tp()) {
      const o = new THREE.Vector3();
      const f = new THREE.Vector3();
      const r = new THREE.Vector3();
      const { k } = this.hands.body(o, f, r);
      const sR = this.hands.shoulder('R', new THREE.Vector3());
      const sL = this.hands.shoulder('L', new THREE.Vector3());
      if (!sR || !sL) return null;
      const c = sR.clone().add(sL).multiplyScalar(0.5).addScaledVector(UP, -0.3 * k).addScaledVector(f, 0.3 * k);
      return { c, r, f, sh: { R: sR, L: sL }, s: this.hands.scale, tp: true };
    }
    const cam = this.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    // the body's forward is the view's, levelled (looking down doesn't swing the shoulders forward)
    const f = new THREE.Vector3(-e[8], 0, -e[10]);
    if (f.lengthSq() < 1e-6) f.set(-e[4], 0, -e[6]);
    f.normalize();
    // the right hand's side (hands.ts body(): facing +z, the right is −x)
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const c = cam.position.clone().addScaledVector(UP, -0.45).addScaledVector(f, 0.3);
    return { c, r, f, sh: fpShoulders(cam), s: 1, tp: false };
  }

  /** this frame's pose for one hand (before hands.apply in third person; after the camera in first) */
  pose(side: HandSide, h: HandPose, F: Frame) {
    if (F.tp) {
      if (h.w < 0.01) return;
      const sg = side === 'R' ? 1 : -1;
      this.hands.reach(side, { target: h.p, quat: h.q, pole: h.pole ?? F.sh[side].clone().addScaledVector(UP, -0.55).addScaledVector(F.f, -0.25).addScaledVector(F.r, sg * 0.35), weight: h.w });
      // (Rocketbox fingers: a cup grip is about 1; flat hands straighten the mocap's relaxed ones)
      this.hands.fingers(side, h.fingers.curl * 2.2 - 0.35, h.fingers.thumb * 2 - 0.2);
      return;
    }
    const sh = F.sh[side];
    // (out of sight: not drawn. Parked under the view, out of reach, the arm hung after it, its shoulder
    // pulled down into the view)
    if (h.w < 0.02) this.fp.hideSide(side);
    else {
      const d = h.p.distanceTo(sh);
      this.fp.set(side, d > FP_REACH ? sh.clone().lerp(h.p, FP_REACH / d) : h.p, h.q, h.fingers, sh);
    }
    this.shown = true;
  }

  /** first person: nothing posed this frame */
  hide() {
    if (this.shown) this.fp.hide();
    this.shown = false;
  }

  /**
   * Where a grip point of a hand is now, world, and the hand's turn: third person the avatar's hand
   * bone (after the IK), first person the drawn hand. False before the avatar is in.
   */
  grip(side: HandSide, g: THREE.Vector3, out: THREE.Vector3, quat?: THREE.Quaternion): boolean {
    const q = quat ?? this.q;
    if (this.tp()) {
      if (!this.hands.handFrame(side, out, q)) return false;
      out.add(handed(side, g).multiplyScalar(this.hands.scale).applyQuaternion(q));
      return true;
    }
    if (!this.fp.quat(side, q)) return false;
    // (fpHands' local() takes z toward the thumb on either hand)
    this.fp.local(side, g.x, g.y, g.z, out);
    return true;
  }

  dispose() {
    this.fp.dispose();
  }
}

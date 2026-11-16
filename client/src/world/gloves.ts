/**
 * Non-sterile examination gloves (hygiene.ts), on from the box and off as WHO teaches it:
 *
 *   on   (~3.2 s) the right hand pinches a glove out of the box's hole (the fixture's own slot) and
 *        holds it open in front of you; the left hand goes in and the right pulls the cuff up over the
 *        wrist; the gloved left takes the second glove and pulls it onto the right the same way.
 *   off  (~2.3 s) the right hand pinches the left glove on the palm side of the wrist and peels it off
 *        inside out, balling it in the fist (glove to glove); a bare left finger goes under the right
 *        cuff and peels that glove off over the first (skin to skin): the pair inside out in the left
 *        hand. Into the bin if one's in reach (~0.7 s more), else held until you bin it.
 *
 * Each glove covers its hand from the fingertips to a cuff over the wrist as it goes on, and comes off
 * from the cuff down to the fingertips (the hands' setGloves: fpHands.ts, handLayers.ts).
 */
import * as THREE from 'three';
import type { HandSide } from './hands';
import type { HandRig } from './handLayers';
import { FLAT, HOOK, PINCH, PINCH_OPEN, UP, blend, palmQuat, pose, ramp, type Frame, type HandPose } from './handPose';
import type { Offsets } from './handwash';
import { G, lambert } from './materials';

export const G_ON = { reach: 0.35, pinch: 0.72, closed: 0.82, out: 1.08, slide: 1.16, onL: 1.55, tug: 1.72, reach2: 1.8, pinch2: 2.1, closed2: 2.18, out2: 2.42, slide2: 2.48, onR: 2.88, tug2: 3.02, end: 3.22 };
export const G_OFF = { up: 0.35, pinch: 0.55, peeled: 1.05, ball: 1.22, under: 1.48, peeled2: 1.98, held: 2.2, end: 2.3, over: 2.62, drop: 2.7, land: 2.96, endBin: 3.06 };

/** a box of gloves: where its hole is, which way it faces, where to stand */
export interface GloveSource {
  id: string;
  level: number;
  slot: THREE.Vector3;
  n: THREE.Vector3;
  box: THREE.Box3;
  center: THREE.Vector3;
  stand: { x: number; z: number } | null;
}

/** third person: the lean toward the box while a hand takes a glove out of it (rad; the arm then reaches from where the shoulder is) */
export function gloveLean(t: number): number {
  const W = G_ON;
  const first = ramp(t, 0.1, W.pinch - 0.1) * (1 - ramp(t, W.closed, W.slide));
  const second = ramp(t, W.reach2 - 0.15, W.pinch2 - 0.1) * (1 - ramp(t, W.closed2, W.slide2));
  return 0.2 * Math.max(first, second);
}

/** how much of a hand is gloved at t, putting them on (fingertips first) */
export function gloveOnK(side: HandSide, t: number): number {
  return side === 'L' ? ramp(t, G_ON.slide, G_ON.onL) : ramp(t, G_ON.slide2, G_ON.onR);
}

/** … and taking them off (the cuff first, the fingertips last) */
export function gloveOffK(side: HandSide, t: number): number {
  return side === 'L' ? 1 - ramp(t, G_OFF.pinch, G_OFF.peeled) : 1 - ramp(t, G_OFF.under, G_OFF.peeled2);
}

const pinchBlend = (k: number) => ({
  curl: PINCH_OPEN.curl + (PINCH.curl - PINCH_OPEN.curl) * k,
  spread: 0.03,
  thumb: PINCH_OPEN.thumb + (PINCH.thumb - PINCH_OPEN.thumb) * k,
  oppose: PINCH_OPEN.oppose + (PINCH.oppose - PINCH_OPEN.oppose) * k,
});

/** a hand placed by a point on it (the wrist from where that point should be, the hand turned so) */
function putter(off: Offsets) {
  return (side: HandSide, p: Parameters<Offsets>[1], at: THREE.Vector3, q: THREE.Quaternion, fingers = FLAT, extra: Partial<HandPose> = {}): HandPose => ({
    p: at.clone().sub(off(side, p).clone().applyQuaternion(q)),
    q,
    fingers,
    w: 1,
    ...extra,
  });
}

/** where a point of a posed hand is (world), from its pose and the hand's measurements */
function pointOf(h: HandPose, off: THREE.Vector3): THREE.Vector3 {
  return h.p.clone().add(off.clone().applyQuaternion(h.q));
}

/** both hands putting gloves on, at t */
export function glovesOnPoses(t: number, src: GloveSource, F: Frame, rest: Record<HandSide, HandPose>, off: Offsets): Record<HandSide, HandPose> {
  const W = G_ON;
  const put = putter(off);
  const n = src.n;
  // the hand taking a glove: its pinch at the hole (`k`: drawn out of it 0 → 1, `closed` the fingers on it)
  const take = (side: HandSide, k: number, closed: number): HandPose => {
    const at = src.slot.clone().addScaledVector(n, 0.004 + 0.13 * k).addScaledVector(UP, -0.03 * k);
    const q = palmQuat(side, n.clone().negate().addScaledVector(UP, -0.18), UP.clone().negate());
    return put(side, 'pinch', at, q, pinchBlend(closed), { reach: 0.8 });
  };
  // the hand going in: in front of the chest, fingers across toward the other, palm down
  const recv = (side: HandSide): HandPose => {
    const s = side === 'R' ? 1 : -1;
    const at = F.c.clone().addScaledVector(F.r, s * 0.13).addScaledVector(F.u, 0.03);
    const q = palmQuat(side, F.r.clone().multiplyScalar(-s).addScaledVector(F.f, 0.45), F.u.clone().negate());
    return { p: at, q, fingers: pose(0.05, 0.08, 0.1, 0.1), w: 1 };
  };
  // the other hand's pinch on the glove's cuff, from the fingertips (0) to the wrist (1) of the hand going in
  const pull = (holder: HandSide, into: HandPose, k: number, tug = 0): HandPose => {
    const wearer: HandSide = holder === 'R' ? 'L' : 'R';
    const tip = pointOf(into, off(wearer, 'tipMiddle'));
    const wrist = pointOf(into, off(wearer, 'wristBack'));
    const along = tip.clone().sub(wrist).normalize();
    const at = tip.lerp(wrist, k).addScaledVector(F.u, 0.014).addScaledVector(along, -0.02 * tug);
    const q = palmQuat(holder, along.clone().negate().addScaledVector(F.u, -0.2), F.u.clone().negate());
    return put(holder, 'pinch', at, q, PINCH);
  };
  const two = (R: HandPose, L: HandPose) => ({ R, L });
  const mix = (a: Record<HandSide, HandPose>, b: Record<HandSide, HandPose>, k: number) => (k <= 0 ? a : k >= 1 ? b : { R: blend(a.R, b.R, k), L: blend(a.L, b.L, k) });
  const tugK = (a: number, b: number) => Math.sin(Math.PI * ramp(t, a, b));
  // 1. the right hand takes the first
  if (t < W.out) {
    const R = t < W.pinch - 0.12 ? blend(rest.R, take('R', 0.3, 0), ramp(t, 0.15, W.pinch - 0.12)) : t < W.closed ? take('R', 0.3 * (1 - ramp(t, W.pinch - 0.12, W.pinch)), ramp(t, W.pinch, W.closed)) : take('R', ramp(t, W.closed, W.out), 1);
    return two(R, rest.L);
  }
  // 2. the left goes in, the right pulls it on
  const L1 = recv('L');
  if (t < W.reach2) {
    const R = t < W.slide ? blend(take('R', 1, 1), pull('R', L1, 0), ramp(t, W.out, W.slide)) : pull('R', L1, ramp(t, W.slide, W.onL), tugK(W.onL, W.tug));
    return two(R, blend(rest.L, L1, ramp(t, W.out - 0.2, W.slide)));
  }
  // 3. the gloved left takes the second
  const R1 = recv('R');
  if (t < W.out2) {
    const L = t < W.pinch2 - 0.12 ? blend(L1, take('L', 0.3, 0), ramp(t, W.reach2 - 0.08, W.pinch2 - 0.12)) : t < W.closed2 ? take('L', 0.3 * (1 - ramp(t, W.pinch2 - 0.12, W.pinch2)), ramp(t, W.pinch2, W.closed2)) : take('L', ramp(t, W.closed2, W.out2), 1);
    return two(blend(pull('R', L1, 1), R1, ramp(t, W.tug, W.reach2 + 0.2)), L);
  }
  // 4. the right goes in, the left pulls it on; then both down
  const L = t < W.slide2 ? blend(take('L', 1, 1), pull('L', R1, 0), ramp(t, W.out2, W.slide2)) : pull('L', R1, ramp(t, W.slide2, W.onR), tugK(W.onR, W.tug2));
  return mix(two(R1, L), two(rest.R, rest.L), ramp(t, W.tug2, W.end));
}

/** both hands taking gloves off, at t; `bin`: the opening to drop them in (null: kept in the hand) */
export function glovesOffPoses(t: number, F: Frame, rest: Record<HandSide, HandPose>, off: Offsets, bin: THREE.Vector3 | null): Record<HandSide, HandPose> {
  const W = G_OFF;
  const put = putter(off);
  const two = (R: HandPose, L: HandPose) => ({ R, L });
  // the left held out first, palm down; the right's pinch under its wrist (the glove's palm side), peeling toward the fingers
  const showL: HandPose = { p: F.c.clone().addScaledVector(F.r, -0.06).addScaledVector(F.u, 0.03), q: palmQuat('L', F.f.clone().multiplyScalar(0.8).addScaledVector(F.r, 0.45), F.u.clone().negate()), fingers: pose(0.06, 0.06, 0.1, 0.1), w: 1 };
  const xL = new THREE.Vector3(1, 0, 0).applyQuaternion(showL.q);
  const cuffL = pointOf(showL, off('L', 'wristVolar'));
  const peelL = (k: number): HandPose => put('R', 'pinch', cuffL.clone().addScaledVector(xL, 0.02 + 0.2 * k).addScaledVector(F.u, -0.006 - 0.04 * k), palmQuat('R', xL.clone().addScaledVector(F.u, 0.15), F.u.clone()), PINCH);
  // then the right, its fist round the first glove; a bare left finger under its cuff, peeling it over the first
  const showR: HandPose = { p: F.c.clone().addScaledVector(F.r, 0.05).addScaledVector(F.u, 0.03), q: palmQuat('R', F.f.clone().multiplyScalar(0.8).addScaledVector(F.r, -0.45), F.u.clone().negate()), fingers: HOOK, w: 1 };
  const xR = new THREE.Vector3(1, 0, 0).applyQuaternion(showR.q);
  const cuffR = pointOf(showR, off('R', 'wristVolar'));
  const peelR = (k: number): HandPose => put('L', 'tipIndex', cuffR.clone().addScaledVector(xR, 0.01 + 0.2 * k).addScaledVector(F.u, -0.004 - 0.04 * k), palmQuat('L', xR.clone().addScaledVector(F.u, 0.2), F.u.clone()), pose(0.3, 0.02, 0.4, 0.3));
  const holdL: HandPose = { p: F.c.clone().addScaledVector(F.r, -0.08).addScaledVector(F.u, -0.02).addScaledVector(F.f, -0.02), q: palmQuat('L', F.f.clone().addScaledVector(F.r, 0.4), F.u.clone()), fingers: pose(0.5, 0.02, 0.45, 0.4), w: 1 };
  if (t < W.pinch) {
    const k = ramp(t, 0.1, W.pinch - 0.05);
    return two(blend(rest.R, peelL(0), k), blend(rest.L, showL, k));
  }
  if (t < W.ball) {
    const R = t < W.peeled ? peelL(ramp(t, W.pinch, W.peeled)) : blend(peelL(1), { ...showR, fingers: pose(0.4, 0.02, 0.4, 0.3) }, ramp(t, W.peeled, W.ball));
    return two(R, showL);
  }
  if (t < W.held) {
    const L = t < W.under ? blend(showL, peelR(0), ramp(t, W.ball - 0.05, W.under)) : peelR(ramp(t, W.under, W.peeled2));
    const R = t < W.peeled2 ? showR : blend(showR, rest.R, ramp(t, W.peeled2, W.held));
    return two(R, t < W.peeled2 ? L : blend(L, holdL, ramp(t, W.peeled2, W.held)));
  }
  if (!bin) return two(blend(showR, rest.R, 1), holdL);
  // into the bin: the left hand over it, palm down, lets go
  const over = put('L', 'palm', bin.clone().addScaledVector(UP, 0.42), palmQuat('L', F.f.clone().addScaledVector(UP, -0.5), UP.clone().negate()), t < W.drop ? pose(0.45, 0.02, 0.4, 0.4) : pose(0.05, 0.1, 0.1, 0.1));
  return two(rest.R, blend(blend(holdL, over, ramp(t, W.held, W.over)), rest.L, ramp(t, W.land, W.endBin)));
}

/**
 * What the hands hold with gloves: a glove drawn out of the box, hanging from the pinch as it's
 * pulled on (it becomes the glove on the hand), and the pair taken off inside out (a crumpled blue
 * ball), into the bin.
 */
export class GloveEffects {
  readonly dangle = new THREE.Group();
  readonly bundle: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene, mat: THREE.MeshStandardMaterial) {
    this.mat = mat;
    // a limp glove hanging by its cuff from (0, 0, 0): the palm, four fingers and the thumb, flat
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
      const m = new THREE.Mesh(geo, this.mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      m.castShadow = false;
      this.dangle.add(m);
    };
    add(G.rbox(0.085, 0.1, 0.008, 0.004), 0, -0.06, 0);
    [-0.03, -0.01, 0.01, 0.03].forEach((x, i) => add(G.capsule(0.0075, 0.05 + (i === 1 || i === 2 ? 0.01 : 0), 3, 8), x, -0.14 - (i === 1 || i === 2 ? 0.005 : 0), 0));
    add(G.capsule(0.008, 0.04, 3, 8), 0.05, -0.085, 0, 0.6);
    add(G.cyl(0.034, 0.04, 0.03, 14, ), 0, -0.012, 0);
    this.dangle.scale.set(1, 1, 0.5);
    this.dangle.visible = false;
    // the pair, inside out (the inside a paler blue)
    const ball = new THREE.IcosahedronGeometry(0.5, 1);
    const p = ball.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const q = (x: number) => Math.round(x * 1e4);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const h = Math.sin(q(v.x) * 0.0119 + q(v.y) * 0.0731 + q(v.z) * 0.0417) * 43758.5453;
      v.multiplyScalar(0.72 + 0.42 * (h - Math.floor(h)));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    ball.computeVertexNormals();
    this.bundle = new THREE.Mesh(ball, lambert('#8db4ea', { roughness: 0.5, flat: true }));
    this.bundle.castShadow = false;
    this.bundle.visible = false;
    scene.add(this.dangle, this.bundle);
  }

  hide() {
    this.dangle.visible = false;
    this.bundle.visible = false;
  }

  /** putting them on: the glove hanging from the pinch until the hand it goes on is in it */
  on(t: number, rig: HandRig) {
    const W = G_ON;
    this.bundle.visible = false;
    const first = t >= W.closed && t < W.onL - 0.1;
    const second = t >= W.closed2 && t < W.onR - 0.1;
    this.dangle.visible = first || second;
    if (!this.dangle.visible) return;
    const holder: HandSide = first ? 'R' : 'L';
    const wearer: HandSide = first ? 'L' : 'R';
    const pinch = rig.point(holder, 'pinch', new THREE.Vector3());
    this.dangle.position.copy(pinch);
    // limp until the other hand's in it, then along that hand (it's going on)
    const k = first ? ramp(t, W.slide, W.onL - 0.1) : ramp(t, W.slide2, W.onR - 0.1);
    const tip = rig.point(wearer, 'tipMiddle', new THREE.Vector3());
    const down = new THREE.Vector3(0, -1, 0).lerp(tip.sub(pinch).normalize(), ramp(k, 0, 0.3));
    this.dangle.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), down.normalize());
    this.dangle.scale.set(1 - 0.6 * k, 1 - 0.75 * k, 0.5);
  }

  /** taking them off: the first balled in the right fist, the pair in the left, into the bin */
  off(t: number, rig: HandRig, bin: THREE.Vector3 | null) {
    const W = G_OFF;
    this.dangle.visible = false;
    const b = this.bundle;
    b.visible = t >= W.pinch + 0.1 && (!bin || t < W.land);
    if (!b.visible) return;
    const grow = ramp(t, W.pinch + 0.1, W.peeled);
    const both = ramp(t, W.under, W.peeled2);
    const r = rig.point('R', t < W.peeled ? 'pinch' : 'palm', new THREE.Vector3());
    const l = rig.point('L', t < W.peeled2 ? 'tipIndex' : 'palm', new THREE.Vector3());
    b.position.copy(r).lerp(l, ramp(t, W.under + 0.15, W.held));
    const s = 0.035 + 0.02 * grow + 0.012 * both;
    b.scale.set(s * 1.2, s, s);
    if (bin && t >= W.drop) {
      const k = ramp(t, W.drop, W.land);
      b.position.lerp(bin.clone().addScaledVector(UP, -0.06), k * k);
    }
  }

  /** binning a pair held in the hand (a toss, `k` 0 → 1) */
  toss(from: THREE.Vector3, bin: THREE.Vector3, k: number) {
    const b = this.bundle;
    b.visible = k < 1;
    b.scale.set(0.08, 0.067, 0.067);
    b.position.copy(from).lerp(bin.clone().addScaledVector(UP, -0.06), k);
    b.position.y += Math.sin(Math.PI * k) * 0.12;
  }

  dispose() {
    this.dangle.removeFromParent();
    this.bundle.removeFromParent();
  }
}

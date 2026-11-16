/**
 * A phone in the hand (the crowd's `phone` prop, accessories.ts), fitted to each avatar's own hand and
 * posed after the mocap (avatars.ts runs it once the clip and the act's upper-body layer are applied).
 *
 * Why it needs this: the Rocketbox phone takes (m/f_cell_phone_textmessage, _talk) were shot with a
 * small, thick phone held in the fingers — the ring and little fingers curl up into the palm and the
 * thumb hovers ~6 cm above it. A modern phone laid flat on that palm had those fingers straight through
 * its screen and a thumb tapping the air; the men's take also holds the screen ~50° away from the eyes.
 *
 *   - the grip is measured from the GLB at load (bind pose: the palm's surface, each finger's bones and
 *     its own skin): the phone's back rests on the palm, its long side diagonal across it (35° from the
 *     fingers toward the thumb), so the index finger props the back and the middle, ring and little
 *     fingers wrap the far edge. Each finger curls joint by joint until its skin touches the case.
 *   - texting: the thumb works the screen — bursts of taps on the keyboard, a send, swipes through a
 *     feed — with a hinge-true thumb IK that rests the lowest skin of the pad on the glass and keeps the
 *     rest of the thumb out of the case; the wrist turns the screen toward the eyes (arm IK from the
 *     clip's own reach), and the head bends to look at it
 *   - a call: the earpiece on the ear canal, the glass just clear of this avatar's ear and hair (measured
 *     from the head and hair meshes), the bottom angled toward the mouth; the thumb along the side
 *   - filming: held up, screen to the eyes, a camera viewfinder on it
 *   - otherwise just held, screen dark
 * Left-handed people (one in ten, by a hash of who they are) hold it in the left hand: the phone takes
 * (all right-handed mocap) are mirrored onto the other side of the body.
 *
 * Bones (Rocketbox): hands X along the fingers, Y out of the palm, Z toward the thumb (left: −Z); finger
 * bones run along their own +X, and their middle and end joints (and the thumb's) hinge about +Z
 * (positive = flexion) on both hands. The head: X up, Y forward, Z left. Bone units are centimetres.
 */
import * as THREE from 'three';
import type { AmbientAct } from '../../../shared/types';
import { buildProp, PHONE, phoneScreen, setPhoneCase, type PhoneScreen } from './accessories';
import { armBones, reachArm, type ArmBones } from './hands';
import { jumpDebugAll } from './jump';

const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** a small seeded generator (visual variety stays deterministic: never Math.random, never the sim's stream) */
function mulberry(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** about one person in ten holds their phone in the left hand (by a hash of who they are) */
export function leftHanded(seed: number): boolean {
  return seed % 10 === 3;
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Bone | null {
  let hit: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o as THREE.Bone;
  });
  return hit;
}

const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** turn a bone about a world axis through its joint */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-6) return;
  bone.parent.getWorldQuaternion(_q2);
  const a = axis.clone().applyQuaternion(_q2.clone().invert()).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(a, angle));
  bone.updateMatrixWorld(true);
}

// ───────────────────────────── measuring the avatar ─────────────────────────────

const usedCache = new WeakMap<THREE.BufferGeometry, Uint8Array | null>();
/** which vertices a geometry's triangles use (Rocketbox meshes share one vertex buffer); null: all */
function usedVertices(g: THREE.BufferGeometry): Uint8Array | null {
  if (usedCache.has(g)) return usedCache.get(g)!;
  const idx = g.index;
  let used: Uint8Array | null = null;
  if (idx) {
    used = new Uint8Array(g.attributes.position.count);
    for (let i = 0; i < idx.count; i++) used[idx.getX(i)] = 1;
  }
  usedCache.set(g, used);
  return used;
}

interface Measured {
  /** bind-pose points of the hand (bone units, in its frame) */
  palm: THREE.Vector3[];
  /** per finger bone: its skin in its own frame (thinned to ~3 mm apart) */
  skin: Map<string, THREE.Vector3[]>;
  /** the pad's thickness on the palm side (+Y) toward the end of the segment, and how far the skin reaches */
  padSide: Map<string, number>;
  reach: Map<string, number>;
  /** rest local rotations and offsets (from the inverse bind matrices) */
  restQ: Map<string, THREE.Quaternion>;
  restP: Map<string, THREE.Vector3>;
  /** every vertex the thumb moves (the ball of the thumb included), skinned like the GPU does it */
  thumbSkin: BlendPoint[];
}

/**
 * A skin vertex blended over the hand and the thumb's three bones: its bind position in each bone's
 * frame and its weights (renormalised over those four). Posed: Σ wᵢ·(jointᵢ + qᵢ·pᵢ) in the hand frame.
 */
interface BlendPoint {
  w: [number, number, number, number];
  p: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

/** keep one point per `cell` (bone units) cube: the shape, without thousands of points */
function thin(pts: THREE.Vector3[], cell: number): THREE.Vector3[] {
  const seen = new Set<string>();
  const out: THREE.Vector3[] = [];
  for (const p of pts) {
    const k = `${Math.round(p.x / cell)},${Math.round(p.y / cell)},${Math.round(p.z / cell)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Bind-pose skin of `model` around one hand: every vertex mostly weighted to the hand or one of its
 * fingers, in that bone's own frame (bone units). Also the rest pose of those bones.
 */
function measureHand(model: THREE.Object3D, side: 'R' | 'L'): Measured | null {
  let body: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!body && m.isSkinnedMesh && (m.material as THREE.Material).name === 'body') body = m;
  });
  const m = body as THREE.SkinnedMesh | null;
  if (!m) return null;
  const sk = m.skeleton;
  const re = new RegExp(`_${side}_(Hand|Finger\\d+)$`);
  const handI = sk.bones.findIndex((b) => new RegExp(`_${side}_Hand$`).test(b.name));
  if (handI < 0) return null;
  const toBone = sk.bones.map((_, i) => new THREE.Matrix4().copy(sk.boneInverses[i]).multiply(m.bindMatrix));
  const pos = m.geometry.attributes.position;
  const si = m.geometry.attributes.skinIndex;
  const sw = m.geometry.attributes.skinWeight;
  const out: Measured = { palm: [], skin: new Map(), padSide: new Map(), reach: new Map(), restQ: new Map(), restP: new Map(), thumbSkin: [] };
  const per = new Map<number, THREE.Vector3[]>();
  // the thumb's bones (hand, base, knuckle, tip joint) for the blended skin
  const tb = ['Hand', 'Finger0', 'Finger01', 'Finger02'].map((n) => sk.bones.findIndex((b) => new RegExp(`_${side}_${n}$`).test(b.name)));
  const seenThumb = new Set<string>();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (tb.every((b) => b >= 0)) {
      const w = [0, 0, 0, 0] as [number, number, number, number];
      for (let j = 0; j < 4; j++) {
        const k = tb.indexOf(si.getComponent(i, j));
        if (k >= 0) w[k] += sw.getComponent(i, j);
      }
      const onThumb = w[1] + w[2] + w[3];
      if (onThumb >= 0.12 && w[0] + onThumb > 0.6) {
        const sum = w[0] + onThumb;
        const ph = tmp.fromBufferAttribute(pos, i).applyMatrix4(toBone[tb[0]]);
        const key = `${Math.round(ph.x / 0.3)},${Math.round(ph.y / 0.3)},${Math.round(ph.z / 0.3)}`;
        if (!seenThumb.has(key)) {
          seenThumb.add(key);
          const p = tb.map((b) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toBone[b])) as BlendPoint['p'];
          out.thumbSkin.push({ w: w.map((x) => x / sum) as BlendPoint['w'], p });
        }
      }
    }
  }
  for (let i = 0; i < pos.count; i++) {
    let best = -1;
    let bw = 0;
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, j);
      }
    }
    if (best < 0 || bw < 0.4 || !re.test(sk.bones[best]?.name ?? '')) continue;
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toBone[best]);
    if (best === handI) out.palm.push(p);
    else (per.get(best) ?? per.set(best, []).get(best)!).push(p);
  }
  for (const [bi, pts] of per) {
    const name = sk.bones[bi].name;
    out.skin.set(name, thin(pts, 0.3));
    const x = pts.map((p) => p.x).sort((a, b) => a - b);
    const xEnd = x[Math.floor(x.length * 0.96)] ?? 2;
    out.reach.set(name, xEnd);
    const pad = pts.filter((p) => p.x > xEnd * 0.35 && p.x < xEnd * 0.9).map((p) => p.y).sort((a, b) => a - b);
    if (pad.length > 4) out.padSide.set(name, pad[Math.floor(pad.length * 0.95)]);
  }
  // rest pose: local = P⁻¹·B with B = inverse(boneInverse)
  sk.bones.forEach((b, i) => {
    if (!re.test(b.name)) return;
    const pi = sk.bones.indexOf(b.parent as THREE.Bone);
    if (pi < 0) return;
    const local = new THREE.Matrix4().copy(sk.boneInverses[pi]).multiply(new THREE.Matrix4().copy(sk.boneInverses[i]).invert());
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    local.decompose(p, q, new THREE.Vector3());
    out.restQ.set(b.name, q);
    out.restP.set(b.name, b.position.clone());
  });
  return out;
}

/**
 * The right (or left) side of the head, in the head bone's frame (bone units): bind-pose skin of the
 * head and hair meshes, and the ear (the most lateral bulge behind the eyes, at about eye height).
 */
/** a vertex near the ear, re-skinned live during a call (hair blended with the neck, the face as it talks) */
interface LiveVertex {
  mesh: THREE.SkinnedMesh;
  i: number;
}

function measureHead(model: THREE.Object3D, head: THREE.Bone, side: 'R' | 'L'): { pts: THREE.Vector3[]; ear: THREE.Vector3; live: LiveVertex[] } | null {
  const pts: THREE.Vector3[] = [];
  const near: { v: LiveVertex; p: THREE.Vector3 }[] = [];
  const s = side === 'R' ? -1 : 1; // the right side of the head is −Z
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !['head', 'hair', 'body'].includes((m.material as THREE.Material).name)) return;
    const sk = m.skeleton;
    const hi = sk.bones.indexOf(head);
    if (hi < 0) return;
    const toHead = new THREE.Matrix4().copy(sk.boneInverses[hi]).multiply(m.bindMatrix);
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    const used = usedVertices(m.geometry);
    for (let i = 0; i < pos.count; i++) {
      if (used && !used[i]) continue;
      let w = 0;
      for (let j = 0; j < 4; j++) {
        const b = sk.bones[si.getComponent(i, j)];
        // the skull, face and neck (facial bones hang off the head)
        if (b && (b === head || b.parent === head || /_Neck$/.test(b.name) || b.parent?.parent === head)) w += sw.getComponent(i, j);
      }
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toHead);
      if (w >= 0.5) pts.push(p);
      // anything on this side of the head and neck (hair, collar too) may come under the phone
      if (w > 0.05 && p.z * s > 1.5) near.push({ v: { mesh: m, i }, p });
    }
  });
  if (pts.length < 50) return null;
  // eyes, for scale and where to look for the ear (fallback: typical adult offsets)
  const eyeR = findBone(head, /REye$/);
  const eyeL = findBone(head, /LEye$/);
  const eye = new THREE.Vector3(7, 9, 0);
  if (eyeR && eyeL) eye.copy(eyeR.position).add(eyeL.position).multiplyScalar(0.5);
  const zone = pts.filter((p) => p.x > eye.x - 6 && p.x < eye.x + 1.5 && p.y > eye.y - 13 && p.y < eye.y - 5 && p.z * s > 3);
  let ear = new THREE.Vector3(eye.x - 2, eye.y - 9, s * 7.5);
  if (zone.length >= 5) {
    zone.sort((a, b) => b.z * s - a.z * s);
    const top = zone.slice(0, Math.max(3, Math.floor(zone.length * 0.08)));
    ear = top.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / top.length);
  }
  // the phone reaches ~2 cm above the ear and ~14 cm below toward the mouth: watch what's within reach of it
  const seen = new Set<string>();
  const live: LiveVertex[] = [];
  for (const { v, p } of near) {
    if (p.distanceTo(ear) > 17) continue;
    const k = `${Math.round(p.x / 0.5)},${Math.round(p.y / 0.5)},${Math.round(p.z / 0.5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    live.push(v);
  }
  return { pts, ear, live };
}

// ───────────────────────────── the grip ─────────────────────────────

/** a finger or the thumb: three bones, their rest pose, and their skin */
interface Digit {
  bones: [THREE.Bone, THREE.Bone, THREE.Bone];
  restQ: [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion];
  restP: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** bind-pose skin of each segment, in its bone's frame (bone units) */
  skin: [THREE.Vector3[], THREE.Vector3[], THREE.Vector3[]];
  /** (the thumb) its skin blended across its joints and the hand, as drawn */
  blend: BlendPoint[];
  /** fullest skin radius about each segment's axis (what must clear the case) */
  rad: [number, number, number];
  /** along the last segment: the pad's centre, and its thickness on the palm side */
  tip: number;
  pad: number;
  /** the grip: flexion (rad) at each joint about the bone's +Z */
  bend: [number, number, number];
}

/** a box in the hand frame (bone units): centre, axes (x, y, z), half sizes */
class Box {
  constructor(
    readonly c: THREE.Vector3,
    readonly ax: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    readonly half: THREE.Vector3,
  ) {}
  /** the point in the box's own axes (relative to its centre) */
  local(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const d = _v.copy(p).sub(this.c);
    return out.set(d.dot(this.ax[0]), d.dot(this.ax[1]), d.dot(this.ax[2]));
  }
  /** signed distance from p to the box (negative inside) */
  sdf(p: THREE.Vector3): number {
    const l = this.local(p, _s);
    const qx = Math.abs(l.x) - this.half.x;
    const qy = Math.abs(l.y) - this.half.y;
    const qz = Math.abs(l.z) - this.half.z;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  }
}

/** a digit's pose in the hand frame: joints and bone orientations */
interface Pose {
  j: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  q: [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion];
}

function digitPose(d: Digit, q0: THREE.Quaternion, a1: number, a2: number): Pose {
  const j0 = d.restP[0].clone();
  const j1 = j0.clone().add(d.restP[1].clone().applyQuaternion(q0));
  const q1 = q0.clone().multiply(d.restQ[1]).multiply(new THREE.Quaternion().setFromAxisAngle(Z, a1));
  const j2 = j1.clone().add(d.restP[2].clone().applyQuaternion(q1));
  const q2 = q1.clone().multiply(d.restQ[2]).multiply(new THREE.Quaternion().setFromAxisAngle(Z, a2));
  return { j: [j0, j1, j2], q: [q0, q1, q2] };
}

/** a finger's base rotation for a knuckle flexion */
const fingerQ0 = (d: Digit, a0: number) => d.restQ[0].clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z, a0));

/** a point `x` along segment k's axis */
function along(p: Pose, k: number, x: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, 0).applyQuaternion(p.q[k]).add(p.j[k]);
}

/** how deep the skin of segments from..to goes into the box (bone units; ≤ 0: clear) */
function skinDepth(d: Digit, p: Pose, box: Box, from: number, to = 2): number {
  let worst = -Infinity;
  for (let k = from; k <= to; k++) {
    for (const s of d.skin[k]) {
      _w.copy(s).applyQuaternion(p.q[k]).add(p.j[k]);
      worst = Math.max(worst, -box.sdf(_w));
    }
  }
  return worst;
}

/**
 * Like skinDepth, split by where it goes in: through the glass (the face at +z: the visible fault) or
 * through the back and sides (a thumb pressed against the side, soft tissue, out of sight).
 */
function skinDepthByFace(d: Digit, p: Pose, box: Box, k: number): { glass: number; side: number } {
  let glass = -Infinity;
  let side = -Infinity;
  const l = new THREE.Vector3();
  for (const s of d.skin[k]) {
    _w.copy(s).applyQuaternion(p.q[k]).add(p.j[k]);
    const dd = -box.sdf(_w);
    if (dd <= -1) continue;
    box.local(_w, l);
    // inside: the nearest face is where it went in
    const toTop = box.half.z - l.z;
    const toOther = Math.min(box.half.x - Math.abs(l.x), box.half.y - Math.abs(l.y), box.half.z + l.z);
    if (dd > 0 && toTop <= toOther) glass = Math.max(glass, dd);
    else side = Math.max(side, dd);
  }
  return { glass, side };
}

/**
 * The thumb's blended skin (base, knuckle, the ball of the thumb; not the tip, whose pad is meant to
 * touch) against the case: how far any of it sits under the glass within the picture, and how deep it
 * presses into the case anywhere else (bone units; ≤ 0: clear).
 */
function blendDepth(th: Digit, p: Pose, box: Box): { glass: number; side: number } {
  let glass = -Infinity;
  let side = -Infinity;
  const l = new THREE.Vector3();
  const v = new THREE.Vector3();
  const gx = (PHONE.dispW * 100) / 2 - 0.3;
  const gy = (PHONE.dispH * 100) / 2 - 0.3;
  for (const b of th.blend) {
    if (b.w[3] > 0.5) continue;
    v.copy(b.p[0]).multiplyScalar(b.w[0]);
    for (let k = 0; k < 3; k++) if (b.w[k + 1] > 0) v.addScaledVector(_w.copy(b.p[k + 1]).applyQuaternion(p.q[k]).add(p.j[k]), b.w[k + 1]);
    const dd = -box.sdf(v);
    if (dd <= -1) continue;
    box.local(v, l);
    if (Math.abs(l.x) < gx && Math.abs(l.y) < gy && l.z > 0) glass = Math.max(glass, box.half.z - l.z);
    else side = Math.max(side, dd);
  }
  return { glass, side };
}

/** a face of the case: an axis of the box (0 x, 1 y, 2 z) and which way out (±1) */
interface Face {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

/**
 * The lowest skin of segment k over a face of the case, measured off that face (bone units; points
 * not over the face don't count), or Infinity.
 */
function skinOver(d: Digit, p: Pose, k: number, box: Box, face: Face): number {
  let low = Infinity;
  const l = new THREE.Vector3();
  const h = [box.half.x, box.half.y, box.half.z];
  const a = face.axis;
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;
  for (const s of d.skin[k]) {
    _w.copy(s).applyQuaternion(p.q[k]).add(p.j[k]);
    box.local(_w, l);
    // over the face: within its extent, and on its outer side (skin under the phone doesn't count)
    if (Math.abs(l.getComponent(b)) > h[b] || Math.abs(l.getComponent(c)) > h[c] || face.sign * l.getComponent(a) < 0) continue;
    low = Math.min(low, face.sign * l.getComponent(a) - h[a]);
  }
  return low;
}

/** thumb joint ranges (rad, flexion about +Z from rest): knuckle, tip joint */
const THUMB_MCP: [number, number] = [-20 * D2R, 60 * D2R];
const THUMB_IP: [number, number] = [-15 * D2R, 85 * D2R];

interface ThumbSolution {
  q0: THREE.Quaternion;
  a1: number;
  a2: number;
  /** the knuckle's direction from the base (hand frame) */
  dir: THREE.Vector3;
  /** how deep the thumb would go into the case (≤ 0: clear) */
  depth: number;
  /** how well it does: the pad off the target (cm², across the face) plus the pad skin's height error */
  cost: number;
}

/**
 * Thumb IK in the hand's frame (bone units), hinge-true. The base of the thumb picks where the knuckle
 * goes (up, beside the case, within comfortable reach of the target, never inside the case) and turns so
 * the knuckle's hinge lies across the reach: the thumb arches over the face and bends down onto it. The
 * tip joint then bends for the distance, and the knuckle sets the lowest skin of the pad `hover` off the
 * face (0: resting on it) as near the target as it gets. If the thumb would still touch the case
 * anywhere else, the next-best knuckle position is tried.
 *
 * @param G the target point on the face (hand frame)
 */
export function solveThumb(th: Digit, box: Box, G: THREE.Vector3, face: Face, hover: number, prev: THREE.Vector3 | null): ThumbSolution {
  const up = box.ax[face.axis].clone().multiplyScalar(face.sign);
  const T = G.clone().addScaledVector(up, hover + th.pad);
  const C0 = th.restP[0];
  const L0 = th.restP[1].length();
  const L1 = th.restP[2].length();
  const L2 = th.tip;
  const restDir = new THREE.Vector3(1, 0, 0).applyQuaternion(th.restQ[0]);
  const e1 = restDir;
  const e2 = up.clone().addScaledVector(e1, -up.dot(e1)).normalize();
  const e3 = new THREE.Vector3().crossVectors(e1, e2);
  const dirAt = (yaw: number, pitch: number) =>
    e1
      .clone()
      .multiplyScalar(Math.cos(yaw) * Math.cos(pitch))
      .addScaledVector(e3, Math.sin(yaw) * Math.cos(pitch))
      .addScaledVector(e2, Math.sin(pitch))
      .normalize();
  // the pad's nearest to the knuckle (tip joint fully bent)
  const pz = digitPose(th, th.restQ[0], 0, THUMB_IP[1]);
  const near = along(pz, 2, L2).distanceTo(pz.j[1]);
  const score = (d: THREE.Vector3) => {
    const M = _w.copy(C0).addScaledVector(d, L0);
    const reach = M.distanceTo(T);
    const clear = box.sdf(M) - th.rad[1];
    let s = (reach - 0.82 * (L1 + L2)) ** 2 + 20 * Math.max(0, near + 0.4 - reach) ** 2 + 40 * Math.max(0, 0.3 - clear) ** 2 + 2 * (1 - d.dot(e1)) - 0.8 * d.dot(up);
    if (prev) s += 20 * (1 - d.dot(prev));
    return s;
  };
  /** knuckle direction d, pad centre aimed exactly at Tp: twist, tip joint, knuckle */
  const aim = (d: THREE.Vector3, Tp: THREE.Vector3) => {
    let q0 = new THREE.Quaternion().setFromUnitVectors(restDir, d).multiply(th.restQ[0]);
    const M = C0.clone().addScaledVector(d, L0);
    // twist about the knuckle's direction: its hinge across the reach, bending toward the face
    const toT = Tp.clone().sub(M).normalize();
    const hWant = new THREE.Vector3().crossVectors(toT, up.clone().negate()).normalize();
    const h0 = new THREE.Vector3(0, 0, 1).applyQuaternion(th.restQ[1]).applyQuaternion(q0);
    const a = h0.addScaledVector(d, -h0.dot(d));
    const b = hWant.clone().addScaledVector(d, -hWant.dot(d));
    if (a.lengthSq() > 1e-8 && b.lengthSq() > 1e-8) {
      a.normalize();
      b.normalize();
      const ang = Math.atan2(d.dot(new THREE.Vector3().crossVectors(a, b)), a.dot(b));
      q0 = new THREE.Quaternion().setFromAxisAngle(d, ang).multiply(q0);
    }
    // tip joint: bend until the pad is as far from the knuckle as the target (the distance falls as it bends)
    const D = clamp(M.distanceTo(Tp), Math.abs(L1 - L2) + 0.05, L1 + L2 - 0.02);
    let lo = THUMB_IP[0];
    let hi = THUMB_IP[1];
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      const p = digitPose(th, q0, 0, mid);
      if (along(p, 2, L2).distanceTo(p.j[1]) > D) lo = mid;
      else hi = mid;
    }
    const a2 = (lo + hi) / 2;
    // knuckle: about its hinge until the pad lines up with the target
    const p0 = digitPose(th, q0, 0, a2);
    const hinge = new THREE.Vector3(0, 0, 1).applyQuaternion(p0.q[1]).normalize();
    const v1 = along(p0, 2, L2).sub(p0.j[1]);
    const v2 = Tp.clone().sub(p0.j[1]);
    v1.addScaledVector(hinge, -v1.dot(hinge));
    v2.addScaledVector(hinge, -v2.dot(hinge));
    const a1 = clamp(Math.atan2(hinge.dot(new THREE.Vector3().crossVectors(v1, v2)), v1.dot(v2)), THUMB_MCP[0], THUMB_MCP[1]);
    return { q0, a1, a2 };
  };
  const solveWith = (d: THREE.Vector3): ThumbSolution => {
    // the lowest skin of the pad `hover` off the face: aim, see how far the skin dips below that,
    // lift the aim by as much, again (the pad's tilt decides which skin is lowest)
    const Tp = T.clone();
    let s = aim(d, Tp);
    let pose = digitPose(th, s.q0, s.a1, s.a2);
    for (let i = 0; i < 3; i++) {
      const low = skinOver(th, pose, 2, box, face);
      if (!Number.isFinite(low) || Math.abs(low - hover) < 0.03) break;
      Tp.addScaledVector(up, hover - low);
      s = aim(d, Tp);
      pose = digitPose(th, s.q0, s.a1, s.a2);
    }
    // anywhere else in the case? Never through the glass; the base and knuckle may press the case's
    // side a little, as a real thumb clamps it (soft tissue, out of sight)
    // the base, the knuckle and the ball of the thumb as skinned (blended across the joints), 0.5 mm off
    // the glass; the tip by its own skin (its pad is meant to touch)
    const fb = blendDepth(th, pose, box);
    const f2 = skinDepthByFace(th, pose, box, 2);
    const depth = Math.max(fb.glass + 0.05, f2.glass - 0.03, fb.side - 0.3, f2.side - 0.08);
    // how well it does: the pad over the target, its skin at the right height
    const pad = along(pose, 2, L2).sub(T);
    const across = pad.clone().addScaledVector(up, -pad.dot(up)).lengthSq();
    const low = skinOver(th, pose, 2, box, face);
    const h = Number.isFinite(low) ? low - hover : pad.dot(up);
    const cost = 400 * Math.max(0, depth) ** 2 + across + 4 * h * h + 40 * Math.max(0, -h) ** 2;
    return { ...s, dir: d, depth, cost };
  };
  // a coarse search around the rest direction, then refine (so the choice moves smoothly)
  const cands: { yaw: number; pitch: number; s: number }[] = [];
  for (let yaw = -90; yaw <= 90; yaw += 10) for (let pitch = -60; pitch <= 90; pitch += 10) cands.push({ yaw: yaw * D2R, pitch: pitch * D2R, s: score(dirAt(yaw * D2R, pitch * D2R)) });
  cands.sort((a, b) => a.s - b.s);
  let best: ThumbSolution | null = null;
  for (const c of cands.slice(0, 6)) {
    let { yaw, pitch, s } = c;
    for (const step of [5 * D2R, 2.5 * D2R, 1.25 * D2R]) {
      for (const [dy, dp] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const t = score(dirAt(yaw + dy, pitch + dp));
        if (t < s) {
          s = t;
          yaw += dy;
          pitch += dp;
        }
      }
    }
    const sol = solveWith(dirAt(yaw, pitch));
    if (!best || sol.cost < best.cost) best = sol;
    if (sol.depth <= 0 && sol.cost < 0.05) break;
  }
  return best!;
}

export interface PhoneFit {
  side: 'R' | 'L';
  /** the phone's frame (origin: middle of its back) in the hand's frame, bone units */
  inHand: THREE.Matrix4;
  /** the phone's box (with the case) in the hand frame */
  box: Box;
  fingers: Digit[];
  thumb: Digit;
  /** the palm's skin (hand frame, thinned): what the case's back rests on */
  palm: THREE.Vector3[];
}

/** how the phone lies in the palm (tuned with scratch sweeps over the Rocketbox hands; see fitPhone) */
export interface GripShape {
  /** the long side's angle from the fingers toward the thumb (deg) */
  alpha: number;
  /** where the fingers' edge crosses the little finger, past its knuckle (cm) */
  edge: number;
  /** the bottom edge relative to the thumb's base, along the long side (cm; + = higher up) */
  bottom: number;
  /** rolled about the long side, the thumb's edge down into the ball of the thumb (deg) */
  roll: number;
}
/**
 * Searched over four Rocketbox hands (two men, two women) for how many keyboard targets the thumb can
 * press without touching the case anywhere else (≈ 80 %) while all fingers stay clear of it. The roll
 * matters most: the rig's thumb base sits ~2 cm below a phone lying flat on the palm and could only
 * reach the bottom corner; held as people do, the thumb's edge sunk in the hand, it reaches across.
 */
export const GRIP: GripShape = { alpha: 50, edge: 0.5, bottom: 2.8, roll: 30 };

/** fit the phone to this hand (see the file comment); null if the bones aren't there */
export function fitPhone(model: THREE.Object3D, side: 'R' | 'L', shape: GripShape = GRIP): PhoneFit | null {
  const meas = measureHand(model, side);
  if (!meas || meas.palm.length < 30) return null;
  const digit = (k: number): Digit | null => {
    const bones = ['', '1', '2'].map((s) => findBone(model, new RegExp(`_${side}_Finger${k}${s}$`)));
    if (bones.some((b) => !b)) return null;
    const names = bones.map((b) => b!.name);
    const rq = names.map((n) => meas.restQ.get(n));
    const rp = names.map((n) => meas.restP.get(n));
    const skin = names.map((n) => meas.skin.get(n));
    if (rq.some((q) => !q) || rp.some((p) => !p) || skin.some((s) => !s?.length)) return null;
    const rad = skin.map((pts) => {
      const r = pts!.map((p) => Math.hypot(p.y, p.z)).sort((a, b) => a - b);
      return r[Math.floor(r.length * 0.9)] ?? 0.9;
    }) as [number, number, number];
    const reach = meas.reach.get(names[2]) ?? 2.2;
    const pad = meas.padSide.get(names[2]) ?? rad[2];
    return {
      bones: bones as [THREE.Bone, THREE.Bone, THREE.Bone],
      restQ: rq as [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion],
      restP: rp as [THREE.Vector3, THREE.Vector3, THREE.Vector3],
      skin: skin as [THREE.Vector3[], THREE.Vector3[], THREE.Vector3[]],
      blend: k === 0 ? meas.thumbSkin : [],
      rad,
      // the pad's centre a little short of the skin's end
      tip: Math.max(1.2, reach - pad * 0.7),
      pad,
      bend: [0, 0, 0],
    };
  };
  const fingers = [1, 2, 3, 4].map(digit);
  const thumb = digit(0);
  if (fingers.some((f) => !f) || !thumb) return null;
  const sZ = side === 'R' ? 1 : -1;
  const W = PHONE.w * 100;
  const H = PHONE.h * 100;
  const T = PHONE.t * 100;
  // long side diagonal (alpha from the fingers toward the thumb); screen out of the palm
  const alpha = shape.alpha * D2R;
  const up = new THREE.Vector3(Math.cos(alpha), 0, sZ * Math.sin(alpha));
  const n0 = new THREE.Vector3(0, 1, 0);
  const x0 = new THREE.Vector3().crossVectors(up, n0).normalize();
  // rolled about the long side: the thumb's edge (+x for the right hand, −x for the left) goes down
  const roll = sZ * shape.roll * D2R;
  const x = x0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(n0, -Math.sin(roll));
  const n = n0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(x0, Math.sin(roll));
  const toFingers = x0.clone().multiplyScalar(-sZ); // toward the edge the fingers wrap (across the palm)
  // that edge crosses the little finger just past its knuckle; the bottom edge sits by the thumb's
  // base, so the bottom corner rests in the heel of the hand
  const little = fingers[3]!.restP[0];
  const edge = little.clone().add(new THREE.Vector3(shape.edge, 0, 0));
  const tb = thumb.restP[0];
  const sBottom = tb.clone().sub(edge).dot(up) + shape.bottom;
  const c = edge.clone().addScaledVector(toFingers, -W / 2).addScaledVector(up, sBottom + H / 2);
  c.y = 0;
  // the back rests on the palm: just clear of the highest skin under the footprint
  let back = -Infinity;
  for (const p of meas.palm) {
    const d = p.clone().sub(c);
    if (Math.abs(d.dot(x)) < W / 2 + 0.2 && Math.abs(d.dot(up)) < H / 2 + 0.2) back = Math.max(back, d.dot(n));
  }
  if (!Number.isFinite(back)) back = 2.2;
  // (+2.5 mm: skin near the wrist and knuckles shifts a little as they move)
  const origin = c.clone().addScaledVector(n, back + 0.25);
  const inHand = new THREE.Matrix4().makeBasis(x, up, n).setPosition(origin);
  const box = new Box(origin.clone().addScaledVector(n, T / 2), [x, up, n], new THREE.Vector3(W / 2, H / 2, T / 2));
  // each finger curls joint by joint (knuckle, middle, end) until its skin touches the case; one that
  // touches it already (curved in the rest pose) first straightens, from the knuckle out, until clear
  const LIMIT = [80 * D2R, 100 * D2R, 80 * D2R];
  const STEP = 1 * D2R;
  for (const f of fingers as Digit[]) {
    const a: [number, number, number] = [0, 0, 0];
    const depth = (from: number) => skinDepth(f, digitPose(f, fingerQ0(f, a[0]), a[1], a[2]), box, from);
    for (let j = 0; j < 3 && depth(0) > -0.03; j++) {
      const floor = j === 0 ? -30 * D2R : -12 * D2R;
      while (a[j] > floor && depth(0) > -0.03) a[j] -= STEP;
    }
    let touched = false;
    for (let j = 0; j < 3; j++) {
      while (a[j] < LIMIT[j]) {
        a[j] += STEP;
        if (depth(j) > -0.03) {
          a[j] -= STEP;
          touched = true;
          break;
        }
      }
    }
    // a finger that never reaches the case (the little finger, under a phone held tipped): loosely
    // curled beneath it rather than a fist
    if (!touched) {
      const rest: [number, number, number] = [35 * D2R, 45 * D2R, 25 * D2R];
      for (let i = 0; i < 20 && skinDepth(f, digitPose(f, fingerQ0(f, rest[0]), rest[1], rest[2]), box, 0) > -0.03; i++) rest.forEach((v, k) => (rest[k] = v * 0.9));
      a.splice(0, 3, ...rest);
    }
    f.bend = a;
  }
  return { side, inHand, box, fingers: fingers as Digit[], thumb, palm: thin(meas.palm, 0.3) };
}

// ───────────────────────────── left-handed: the takes mirrored ─────────────────────────────

/** what the phone takes move (avatars.ts's upper-body layer), less the lower spine the legs hang off */
const MIRRORED = /_(Spine1|Spine2|Neck|Head|[LR]_(Clavicle|UpperArm|Forearm|Hand|Finger\d+))$/;

/**
 * Left↔right mirror of the upper body after the mixer (body frame: the character faces +z, +x is its
 * left). Each bone's turn away from its bind pose, expressed in the body's frame, is reflected across
 * the body's midplane and given to its mirror twin (spine, neck and head to themselves). The bind pose
 * is symmetric, so a right-handed take becomes the same take done left-handed.
 */
class Mirror {
  private bones: THREE.Bone[] = [];
  private twin = new Map<THREE.Bone, THREE.Bone>();
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private ok = false;

  constructor(private model: THREE.Object3D) {
    let body: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!body && m.isSkinnedMesh && (m.material as THREE.Material).name === 'body') body = m;
    });
    const mesh = body as THREE.SkinnedMesh | null;
    if (!mesh) return;
    const byName = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    // parents before children
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone && MIRRORED.test(o.name)) this.bones.push(o as THREE.Bone);
    });
    const sk = mesh.skeleton;
    for (const b of this.bones) {
      const twinName = b.name.replace(/_L_/, '_@_').replace(/_R_/, '_L_').replace(/_@_/, '_R_');
      const t = byName.get(twinName);
      const i = sk.bones.indexOf(b);
      if (!t || i < 0) return;
      this.twin.set(b, t);
      // bind orientation in the model's frame: bindMatrix · (inverse bind)⁻¹
      const q = new THREE.Quaternion();
      new THREE.Matrix4().copy(mesh.bindMatrix).multiply(new THREE.Matrix4().copy(sk.boneInverses[i]).invert()).decompose(_w, q, _s);
      this.rest.set(b, q);
    }
    this.ok = this.bones.length > 10;
  }

  /** mirror the pose the mixer just set, blended by w */
  apply(w: number) {
    if (!this.ok || w < 0.001) return;
    this.model.updateMatrixWorld(true);
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const modelInv = modelQ.clone().invert();
    // every bone's turn from its bind pose, in the model's frame, before anything changes
    const delta = new Map<THREE.Bone, THREE.Quaternion>();
    for (const b of this.bones) {
      const q = modelInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
      delta.set(b, q.multiply(this.rest.get(b)!.clone().invert()));
    }
    // top-down: the twin's turn, reflected across the midplane (x ↦ −x: (x, y, z, w) ↦ (x, −y, −z, w))
    const now = new Map<THREE.Object3D, THREE.Quaternion>();
    const inModel = (o: THREE.Object3D): THREE.Quaternion => now.get(o) ?? modelInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    for (const b of this.bones) {
      const d = delta.get(this.twin.get(b)!)!;
      const m = new THREE.Quaternion(d.x, -d.y, -d.z, d.w).multiply(this.rest.get(b)!);
      const parent = b.parent!;
      const local = inModel(parent).clone().invert().multiply(m);
      b.quaternion.slerp(local, w);
      now.set(b, inModel(parent).clone().multiply(b.quaternion));
    }
    this.model.updateMatrixWorld(true);
  }
}

// ───────────────────────────── texting: what the thumb does ─────────────────────────────

/** display coordinates (m, origin at its centre, y up) of things to tap */
const PX = PHONE.dispW / 160;
const KB_TOP = -PHONE.dispH / 2 + 144 * PX;
const KEY_ROWS = [40.5, 64.5, 88.5].map((p) => KB_TOP - p * PX);
const SPACE_Y = KB_TOP - 112.5 * PX;
const SEND = new THREE.Vector2(66 * PX, KB_TOP - 13 * PX);

type Gesture = 'read' | 'type' | 'send' | 'swipe';

/**
 * The thumb's script while texting (seeded per person): read a while, type a burst on the keyboard,
 * send, read the reply; or in the feed, read and swipe up. Gives the thumb's target on the glass, how
 * hard it presses (0 hovering … 1 on the glass) and what the screen does.
 */
class Texting {
  app: 'chat' | 'feed';
  private rand: () => number;
  private g: Gesture = 'read';
  private t = 0;
  private dur = 1;
  private taps = 0;
  private from = new THREE.Vector2();
  private to = new THREE.Vector2();
  /** the thumb's target (display m), hover height (m above the glass), press 0..1 */
  readonly at = new THREE.Vector2(0.016, -0.04);
  press = 0;
  hover = 0.012;
  kb = 0;
  scroll = 0;
  private fling = 0;
  private sinceSwitch = 0;
  private switchAfter: number;
  private scrollTo = 0;
  /** the thumb's side of the screen: +1 right hand, −1 left */
  private hand: number;
  /** keys this thumb can't press cleanly (learned), and the one aimed at now */
  private bad = new Set<string>();
  private keyId = '';

  constructor(seed: number, side: 'R' | 'L') {
    this.rand = mulberry(seed);
    this.hand = side === 'R' ? 1 : -1;
    this.app = this.rand() < 0.55 ? 'chat' : 'feed';
    this.scroll = Math.floor(this.rand() * 900);
    this.scrollTo = this.scroll;
    this.switchAfter = 40 + this.rand() * 50;
    this.at.x *= this.hand;
    this.next('read');
  }

  /**
   * A key to press: on the thumb's side of the keyboard (the far keys are a stretch one-handed), and
   * not one this thumb has already failed to press cleanly (markBad).
   */
  private key(): THREE.Vector2 {
    const kw = (160 - 6 - 27) / 10;
    let pick = new THREE.Vector2(0.01 * this.hand, SPACE_Y);
    for (let tries = 0; tries < 8; tries++) {
      if (this.rand() < 0.14) {
        this.keyId = 'space';
        pick = new THREE.Vector2((this.rand() * 0.012 + 0.002) * this.hand, SPACE_Y);
      } else {
        const row = Math.floor(this.rand() * 3);
        const cols = row === 0 ? 10 : row === 1 ? 9 : 7;
        const off = row === 1 ? kw / 2 + 1.5 : row === 2 ? kw * 1.5 + 4.5 : 0;
        const i = cols - 1 - Math.floor(this.rand() * Math.ceil(cols * 0.7));
        this.keyId = `${row}:${i}`;
        pick = new THREE.Vector2((3 + off + i * (kw + 3) + kw / 2 - 80) * PX * this.hand, KEY_ROWS[row]);
      }
      if (!this.bad.has(this.keyId)) break;
    }
    return pick;
  }

  /** the key being pressed now is out of this thumb's clean reach: don't pick it again */
  markBad() {
    if (this.g === 'type' && this.keyId !== 'space') this.bad.add(this.keyId);
  }

  private next(g: Gesture) {
    this.g = g;
    this.t = 0;
    this.from.copy(this.at);
    const r = this.rand;
    if (g === 'read') {
      this.dur = this.app === 'feed' ? 1.2 + r() * 2.6 : 0.9 + r() * 2.4;
      this.to.set((0.014 + r() * 0.006) * this.hand, this.app === 'feed' ? -0.03 : -0.044);
    } else if (g === 'type') {
      this.taps = 3 + Math.floor(r() * 9);
      this.to.copy(this.key());
      this.dur = 0.13 + r() * 0.05;
    } else if (g === 'send') {
      this.to.copy(SEND);
      this.dur = 0.22;
    } else {
      // a swipe up through the feed: touch low, drag up, let go
      this.from.set((0.012 + r() * 0.006) * this.hand, -0.046 + r() * 0.008);
      this.to.set((0.006 + r() * 0.006) * this.hand, -0.008 + r() * 0.012);
      this.dur = 0.5;
    }
  }

  update(dt: number) {
    this.t += dt;
    this.sinceSwitch += dt;
    const u = clamp(this.t / this.dur, 0, 1);
    if (this.g === 'read') {
      this.at.lerpVectors(this.from, this.to, sstep(0, 0.35, u));
      this.press = 0;
      this.hover = 0.012;
      // a long read in the thread: the keyboard goes down after a while
      if (this.app === 'chat') this.kb = this.t > 1.6 ? Math.max(0, this.kb - dt * 6) : this.kb;
      else this.kb = Math.max(0, this.kb - dt * 6);
      if (u >= 1) {
        if (this.sinceSwitch > this.switchAfter) {
          this.app = this.app === 'chat' ? 'feed' : 'chat';
          this.sinceSwitch = 0;
          this.switchAfter = 40 + this.rand() * 50;
          this.next('read');
        } else this.next(this.app === 'chat' ? (this.rand() < 0.8 ? 'type' : 'read') : this.rand() < 0.75 ? 'swipe' : 'read');
      }
    } else if (this.g === 'type' || this.g === 'send') {
      this.kb = Math.min(1, this.kb + dt * 7);
      // travel to the key (lifting a little), press, let go
      const travel = 0.55;
      this.at.lerpVectors(this.from, this.to, sstep(0, travel, u));
      const down = u < travel ? 0 : Math.sin(Math.PI * clamp((u - travel) / (1 - travel), 0, 1));
      this.press = this.kb > 0.9 ? down : 0;
      this.hover = 0.008;
      if (u >= 1) {
        if (this.g === 'send') {
          // the message goes up into the thread
          this.scrollTo += 28 + Math.floor(this.rand() * 18);
          this.next('read');
        } else if (--this.taps > 0) this.next('type');
        else this.next('send');
      }
    } else {
      // swipe: down onto the glass, drag up (the feed follows the thumb), lift off; a little fling after
      this.kb = Math.max(0, this.kb - dt * 6);
      const touch = sstep(0, 0.12, u) * (1 - sstep(0.78, 0.92, u));
      const drag = sstep(0.14, 0.78, u);
      const before = this.at.y;
      this.at.lerpVectors(this.from, this.to, drag);
      this.press = touch;
      this.hover = 0.008;
      if (touch > 0.9) {
        const dy = (this.at.y - before) / PX;
        this.scroll += dy;
        this.scrollTo = this.scroll;
        this.fling = dy / Math.max(dt, 1e-3);
      }
      if (u >= 1) this.next('read');
    }
    // the feed glides on after a swipe; a sent message scrolls the thread up
    if (Math.abs(this.fling) > 1) {
      this.scroll += this.fling * dt * 0.6;
      this.scrollTo = this.scroll;
      this.fling *= Math.exp(-dt / 0.3);
    } else this.scroll += (this.scrollTo - this.scroll) * Math.min(1, dt * 10);
  }
}

// ───────────────────────────── the hold ─────────────────────────────

const holds = new Set<PhoneHold>();
/** time spent posing phones (ms, calls) since the test hook last read it */
const cost = { ms: 0, n: 0 };

export interface PhoneDebug {
  id: string;
  /** where the holder is (their root, world m) */
  at: [number, number, number];
  side: 'R' | 'L';
  act: string;
  /** how much the phone is in use (texting/filming in front of the eyes; at the ear for a call) */
  use: number;
  call: number;
  app: string;
  kb: number;
  press: number;
  /** the phone's centre to the eyes (m), and the angle between its screen and the line of sight (deg) */
  eyeDist: number;
  facing: number;
  /** at the ear / up to read: how far from its place the arm left the phone (m) */
  callErr: number;
  useErr: number;
  /** the phone's centre (world m) and its screen's normal, and which way the holder faces (x, z): for framing pictures */
  centre: [number, number, number];
  normal: [number, number, number];
  fwd: [number, number];
}

export class PhoneHold {
  private fit: PhoneFit | null;
  private arm: ArmBones | null;
  private head: THREE.Bone | null;
  private neck: THREE.Bone | null;
  private eyes: THREE.Bone[];
  private inner: THREE.Object3D | null;
  readonly screen: PhoneScreen | null;
  private texting: Texting;
  private mirror: Mirror | null;
  private mirrorW = 0;
  private use = 0;
  private call = 0;
  private act = '';
  private headFit: { pts: THREE.Vector3[]; ear: THREE.Vector3; live: LiveVertex[] } | null | undefined;
  /** at the ear: how far out the head and hair reach under the phone now (bone units), and when that was measured */
  private earOut = 0;
  private earAt = -1;
  private atEar: THREE.Matrix4 | null = null;
  /** last frame's thumb knuckle direction (keeps the thumb's choice steady) */
  private thumbPrev: THREE.Vector3 | null = null;
  private eyeDist = 0;
  private facing = 0;
  /** at the ear / up to read: how far from its place the arm left the phone (m) */
  private callErr = 0;
  private useErr = 0;

  constructor(
    private model: THREE.Object3D,
    readonly prop: THREE.Object3D,
    readonly side: 'R' | 'L',
    readonly id: string,
    seed: number,
  ) {
    this.fit = fitPhone(model, side);
    this.arm = armBones(model, side);
    this.head = findBone(model, /_Head$/);
    this.neck = findBone(model, /_Neck$/);
    this.eyes = [findBone(model, /_REye$/), findBone(model, /_LEye$/)].filter((b): b is THREE.Bone => !!b);
    this.inner = prop.getObjectByName('phone') ?? null;
    this.screen = phoneScreen(prop);
    this.texting = new Texting(seed, side);
    this.mirror = side === 'L' ? new Mirror(model) : null;
    setPhoneCase(prop, seed % 7);
    // the phone into the fitted grip: its frame in the prop (metres, = bone units / 100)
    if (this.fit && this.inner) {
      const m = this.fit.inHand.clone();
      m.setPosition(new THREE.Vector3().setFromMatrixPosition(m).multiplyScalar(0.01));
      m.decompose(this.inner.position, this.inner.quaternion, this.inner.scale);
    }
    holds.add(this);
  }

  dispose() {
    holds.delete(this);
  }

  /** world pose of the phone (origin: middle of its back), from the hand bone's pose now */
  private phoneWorld(out: THREE.Matrix4): THREE.Matrix4 {
    this.inner!.updateWorldMatrix(true, false);
    return out.copy(this.inner!.matrixWorld);
  }

  private eyePoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.eyes.length === 2) return this.eyes[0].getWorldPosition(out).add(this.eyes[1].getWorldPosition(_w)).multiplyScalar(0.5);
    return this.head ? this.head.localToWorld(out.set(7, 9, 0)) : out.set(0, 1.6, 0);
  }

  /** the phone's scale in the world (the avatar's size) */
  private scaleOf(m: THREE.Matrix4): number {
    return _v.setFromMatrixColumn(m, 0).length();
  }

  /**
   * After the mixer and the act's layer: mirror (left-handed), grip, arm, thumb, head and screen.
   * @param act the ambient act (phone_text / phone_call / film; anything else: just held)
   */
  update(dt: number, act: AmbientAct | undefined) {
    const t0 = performance.now();
    this.pose(dt, act);
    cost.ms += performance.now() - t0;
    cost.n++;
  }

  private pose(dt: number, act: AmbientAct | undefined) {
    const fit = this.fit;
    if (!fit || !this.inner || !this.arm) return;
    this.act = act ?? '';
    // both hands busy with something else (typing on a laptop, a broadsheet held open): put away
    const away = act === 'laptop' || act === 'read';
    this.prop.visible = !away;
    if (away) {
      this.use = this.call = this.mirrorW = 0;
      return;
    }
    const texting = act === 'phone_text';
    const filming = act === 'film';
    const calling = act === 'phone_call';
    // a left-hander does the (right-handed) phone takes mirrored
    if (this.mirror) {
      const want = texting || filming || calling ? 1 : 0;
      this.mirrorW += (want - this.mirrorW) * Math.min(1, dt * 4);
      this.mirror.apply(this.mirrorW);
    }
    this.model.updateMatrixWorld(true);
    // where the clip has the phone (before anything here moves it)
    const P0 = this.phoneWorld(new THREE.Matrix4());
    const s = this.scaleOf(P0);
    const pos0 = new THREE.Vector3();
    const rot0 = new THREE.Quaternion();
    P0.decompose(pos0, rot0, _w);
    const n0 = new THREE.Vector3(0, 0, 1).applyQuaternion(rot0);
    const centre0 = pos0.clone().addScaledVector(n0, (PHONE.t / 2) * s);
    const eye = this.eyePoint(new THREE.Vector3());
    // in use: the clip has it up in front of the face (texting, filming) or near the ear (a call)
    const wantUse = texting || filming ? sstep(0.64, 0.5, centre0.distanceTo(eye)) : 0;
    let wantCall = 0;
    if (calling && this.head) {
      if (this.headFit === undefined) this.headFit = measureHead(this.model, this.head, this.side);
      const hf = this.headFit;
      if (hf) {
        if (!this.atEar) this.earOut = this.earReach(hf, false);
        // the skin under the phone as it is now, a few times a second: out at once if it bulges, back slowly
        this.earAt -= dt;
        if (this.earAt <= 0 && this.call > 0.3) {
          this.earAt = 0.2;
          const now = this.earReach(hf, true);
          this.earOut = now > this.earOut ? now : this.earOut + (now - this.earOut) * 0.25;
        }
        this.atEar = this.earPose(hf, this.earOut);
        wantCall = sstep(0.36, 0.22, centre0.distanceTo(this.head.localToWorld(hf.ear.clone())));
      }
    }
    const k = Math.min(1, dt * 5);
    this.use += (wantUse - this.use) * k;
    this.call += (wantCall - this.call) * k;
    // ── texting / filming: look at it, hold it where it reads, screen to the eyes ──
    if (this.use > 0.01) {
      // where it reads: the clip's direction from the eyes, but at least ~32° below them (people text at
      // chest height, head bent, not with the phone at their chin), 30–42 cm off
      const eye0 = this.eyePoint(new THREE.Vector3());
      const dir = centre0.clone().sub(eye0);
      const dist = clamp(dir.length(), 0.3, 0.42);
      dir.normalize();
      const flat = Math.hypot(dir.x, dir.z);
      const dip = Math.max(Math.atan2(-dir.y, flat), 32 * D2R);
      if (flat > 1e-3) dir.set((dir.x / flat) * Math.cos(dip), -Math.sin(dip), (dir.z / flat) * Math.cos(dip));
      this.lookAt(eye0.clone().addScaledVector(dir, dist), this.use);
      const eyeNow = this.eyePoint(new THREE.Vector3());
      const target = eyeNow.clone().addScaledVector(dir, dist);
      // turn the screen to the eyes (most of the way), upright as the eyes see it
      const nWant = eyeNow.clone().sub(target).normalize();
      const rot = rot0.clone().premultiply(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(n0, nWant), 0.9));
      if (this.head) {
        const headUp = new THREE.Vector3(1, 0, 0).applyQuaternion(this.head.getWorldQuaternion(_q2)).normalize();
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
        const upNow = new THREE.Vector3(0, 1, 0).applyQuaternion(rot);
        const upWant = headUp.addScaledVector(n, -headUp.dot(n));
        if (upWant.lengthSq() > 0.25) rot.premultiply(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(upNow, upWant.normalize()), 0.6));
      }
      this.holdPhoneAt(target, rot, this.use, s);
      // (how far from its place the arm left the phone: tests)
      const at = this.phoneWorld(new THREE.Matrix4());
      const n1 = new THREE.Vector3().setFromMatrixColumn(at, 2).normalize();
      this.useErr = new THREE.Vector3().setFromMatrixPosition(at).addScaledVector(n1, (PHONE.t / 2) * s).distanceTo(target);
    }
    // ── a call: the earpiece on the ear, glass just clear of ear and hair ──
    if (this.call > 0.01 && this.atEar && this.head) {
      const W = this.head.matrixWorld.clone().multiply(this.atEar);
      const p = new THREE.Vector3();
      const r = new THREE.Quaternion();
      W.decompose(p, r, _w);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(r);
      // brought in from the side, as people do: the arm takes it early, ~6 cm out from the ear, and
      // closes in (blending straight from the take's path toward the ear would cut through the head)
      p.addScaledVector(n, -(1 - this.call) * 0.06);
      const want = p.clone();
      this.holdPhoneAt(p.addScaledVector(n, (PHONE.t / 2) * s), r, sstep(0, 0.45, this.call), s);
      // (how far from its place the arm left the phone: tests)
      this.phoneWorld(new THREE.Matrix4()).decompose(p, r, _w);
      this.callErr = p.distanceTo(want);
    }
    // ── the grip ──
    for (const f of fit.fingers) this.setDigit(f);
    // ── the thumb: on the glass texting; resting at the edge of it, or along the side at the ear ──
    if (texting || filming) {
      const tx = this.texting;
      if (texting && this.use > 0.5) tx.update(dt);
      const on = filming ? new THREE.Vector2(0, -PHONE.dispH / 2 + 0.012) : tx.at;
      const press = texting && this.use > 0.5 ? tx.press : 0;
      // (a press stops a hair short of the glass: the skinned pad flattens a little past the bones' reckoning)
      const sol = this.thumbTo(on.x, on.y, Math.max(0.0008, (1 - press) * (filming ? 0.006 : tx.hover)));
      // a key the thumb can't press cleanly (it would touch the case, or fall short): not again
      if (press > 0.85 && (sol.depth > 0.05 || sol.cost > 0.5)) tx.markBad();
    } else if (calling && this.call > 0.3) this.thumbAlongSide();
    else this.thumbTo((this.side === 'R' ? 1 : -1) * (PHONE.dispW / 2 - 0.004), -0.03, 0.004);
    // ── the screen ──
    const scr = this.screen;
    if (scr) {
      if (texting && this.use > 0.4) {
        scr.app = this.texting.app;
        scr.kb = this.texting.app === 'chat' ? this.texting.kb : 0;
        scr.scroll = this.texting.scroll;
      } else if (filming && this.use > 0.4) scr.app = 'camera';
      else scr.app = 'off';
      scr.update();
    }
    // (the eyes where they are now: the head may have bent to look)
    this.measure(this.eyePoint(eye));
  }

  /** bend the head (and a little the neck) so the eyes look at p */
  private lookAt(p: THREE.Vector3, w: number) {
    const head = this.head;
    if (!head) return;
    const eye = this.eyePoint(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const want = p.clone().sub(eye).normalize();
    const ang = fwd.angleTo(want);
    if (ang < 0.01) return;
    // at most ~45°, most of it in the head (the arms hang off the neck)
    const k = (Math.min(ang, 45 * D2R) / ang) * w * 0.85;
    const axis = new THREE.Vector3().crossVectors(fwd, want).normalize();
    if (this.neck) rotateWorld(this.neck, axis, ang * k * 0.25);
    rotateWorld(head, axis, ang * k * 0.75);
  }

  /** move the hand (two-bone arm IK + wrist) so the phone's centre is at `centre` with orientation `rot` */
  private holdPhoneAt(centre: THREE.Vector3, rot: THREE.Quaternion, w: number, s: number) {
    const arm = this.arm!;
    // phone pose → hand pose: hand = phone · (phone in the prop)⁻¹ (the prop's own scale makes up the rest)
    const back = centre.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(rot), (-PHONE.t / 2) * s);
    const handM = new THREE.Matrix4().compose(back, rot, new THREE.Vector3(s, s, s)).multiply(_m.copy(this.inner!.matrix).invert());
    const handPos = new THREE.Vector3();
    const handRot = new THREE.Quaternion();
    handM.decompose(handPos, handRot, _w);
    // the elbow where the clip had it, a little out
    const elbow = arm.fore.getWorldPosition(new THREE.Vector3());
    const mid = arm.upper.getWorldPosition(new THREE.Vector3()).lerp(arm.hand.getWorldPosition(_v), 0.5);
    const pole = elbow.clone().add(elbow.clone().sub(mid).multiplyScalar(0.6));
    reachArm(arm, handPos, pole, w, handRot);
  }

  /** a finger to its grip (rest × flexion about +Z) */
  private setDigit(d: Digit) {
    for (let j = 0; j < 3; j++) d.bones[j].quaternion.copy(d.restQ[j]).multiply(_q.setFromAxisAngle(Z, d.bend[j]));
    d.bones[0].updateMatrixWorld(true);
  }

  private setThumb(sol: ThumbSolution) {
    const [b0, b1, b2] = this.fit!.thumb.bones;
    const th = this.fit!.thumb;
    b0.quaternion.copy(sol.q0);
    b1.quaternion.copy(th.restQ[1]).multiply(_q.setFromAxisAngle(Z, sol.a1));
    b2.quaternion.copy(th.restQ[2]).multiply(_q.setFromAxisAngle(Z, sol.a2));
    b0.updateMatrixWorld(true);
  }

  /** the thumb's pad `hover` (m) over the glass at display point (x, y) (m) */
  private thumbTo(x: number, y: number, hover: number): ThumbSolution {
    const fit = this.fit!;
    const G = new THREE.Vector3(x * 100, y * 100, PHONE.t * 100).applyMatrix4(fit.inHand);
    const sol = solveThumb(fit.thumb, fit.box, G, { axis: 2, sign: 1 }, hover * 100, this.thumbPrev);
    this.thumbPrev = sol.dir;
    this.setThumb(sol);
    return sol;
  }

  /** at the ear: the thumb along the phone's side (off the glass, which is against the cheek) */
  private thumbAlongSide() {
    const fit = this.fit!;
    const sx = this.side === 'R' ? 1 : -1;
    const G = new THREE.Vector3((sx * PHONE.w * 100) / 2, -3.0, (PHONE.t * 100) / 2).applyMatrix4(fit.inHand);
    const sol = solveThumb(fit.thumb, fit.box, G, { axis: 0, sign: sx as 1 | -1 }, 0.05, this.thumbPrev);
    this.thumbPrev = sol.dir;
    this.setThumb(sol);
  }

  /** the phone at the ear, in the head bone's frame (bone units): earpiece on the ear, glass just clear */
  /** the phone's axes at the ear, in the head's frame: across, up (earpiece end), out of the screen (into the head) */
  private earAxes(): { x: THREE.Vector3; up: THREE.Vector3; n: THREE.Vector3 } {
    const s = this.side === 'R' ? -1 : 1;
    // the top toward the back of the head, the bottom toward the mouth (35° off vertical), screen to the head
    const beta = 35 * D2R;
    const up = new THREE.Vector3(Math.cos(beta), -Math.sin(beta), 0);
    const n = new THREE.Vector3(0, 0, -s);
    const x0 = new THREE.Vector3().crossVectors(up, n).normalize();
    // the bottom tipped 10° off the cheek
    const tilt = new THREE.Quaternion().setFromAxisAngle(x0, 10 * D2R);
    up.applyQuaternion(tilt);
    n.applyQuaternion(tilt);
    return { x: new THREE.Vector3().crossVectors(up, n).normalize(), up, n };
  }

  /**
   * How far out from the ear (along the screen's normal, bone units) the head and hair reach under the
   * phone: from the bind pose, or — `live` — from the skin as it is now (hair blended with the neck,
   * the cheeks as they talk), re-skinned on the CPU.
   */
  private earReach(hf: { pts: THREE.Vector3[]; ear: THREE.Vector3; live: LiveVertex[] }, live: boolean): number {
    const { x, up, n } = this.earAxes();
    const W = PHONE.w * 100;
    const H = PHONE.h * 100;
    const spk = (PHONE.glassH / 2 - PHONE.speaker) * 100;
    let out = -Infinity;
    const d = new THREE.Vector3();
    const test = (p: THREE.Vector3) => {
      d.copy(p).sub(hf.ear);
      if (Math.abs(d.dot(x)) > W / 2 + 0.6 || Math.abs(d.dot(up) + spk) > H / 2 + 0.6) return;
      out = Math.max(out, -d.dot(n));
    };
    if (live && this.head) {
      const toHead = this.head.matrixWorld.clone().invert();
      const v = new THREE.Vector3();
      const skeletons = new Set<THREE.Skeleton>();
      for (const lv of hf.live) {
        if (!skeletons.has(lv.mesh.skeleton)) {
          skeletons.add(lv.mesh.skeleton);
          lv.mesh.skeleton.update();
        }
        lv.mesh.getVertexPosition(lv.i, v);
        test(v.applyMatrix4(lv.mesh.matrixWorld).applyMatrix4(toHead));
      }
    } else for (const p of hf.pts) test(p);
    return Number.isFinite(out) ? out : 1.5;
  }

  /** the phone at the ear, in the head bone's frame (bone units): earpiece on the ear, glass `out` + 3 mm clear */
  private earPose(hf: { ear: THREE.Vector3 }, out: number): THREE.Matrix4 {
    const { x, up, n } = this.earAxes();
    const spk = (PHONE.glassH / 2 - PHONE.speaker) * 100;
    const glass = hf.ear.clone().addScaledVector(n, -(out + 0.3));
    const back = glass.addScaledVector(n, -PHONE.screenZ * 100).addScaledVector(up, -spk);
    // (the phone's own frame is in metres: scale 100 into bone units)
    return new THREE.Matrix4().makeBasis(x, up, n).scale(new THREE.Vector3(100, 100, 100)).setPosition(back);
  }

  /** the numbers debug() reports */
  private measure(eye: THREE.Vector3) {
    const P = this.phoneWorld(new THREE.Matrix4());
    const s = this.scaleOf(P);
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    P.decompose(pos, rot, _w);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
    const c = pos.addScaledVector(n, (PHONE.t / 2) * s);
    this.eyeDist = c.distanceTo(eye);
    this.facing = (n.angleTo(eye.clone().sub(c).normalize()) * 180) / Math.PI;
  }

  debug(): PhoneDebug {
    const p = this.model.getWorldPosition(new THREE.Vector3());
    const P = this.phoneWorld(new THREE.Matrix4());
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    P.decompose(pos, rot, _w);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
    const c = pos.addScaledVector(n, (PHONE.t / 2) * this.scaleOf(P));
    return {
      id: this.id,
      at: [p.x, p.y, p.z],
      side: this.side,
      act: this.act,
      use: this.use,
      call: this.call,
      app: this.screen?.app ?? 'off',
      kb: this.screen?.kb ?? 0,
      press: this.texting.press,
      eyeDist: this.eyeDist,
      facing: this.facing,
      callErr: this.callErr,
      useErr: this.useErr,
      centre: [c.x, c.y, c.z],
      normal: [n.x, n.y, n.z],
      fwd: ((f) => [f.x / (Math.hypot(f.x, f.z) || 1), f.z / (Math.hypot(f.x, f.z) || 1)] as [number, number])(new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()))),
    };
  }

  /**
   * Skin against the phone (tests; costly: CPU skinning of the whole body): how deep any vertex of the
   * holding hand goes into the case, how close any comes to the glass from above (the thumb's pad
   * alone too), and — at the ear — the deepest head or hair vertex.
   */
  check(): PhoneCheck {
    const P = this.phoneWorld(new THREE.Matrix4());
    const s = this.scaleOf(P);
    const inv = P.clone().invert();
    const half = new THREE.Vector3(PHONE.w / 2, PHONE.h / 2, PHONE.t / 2);
    /** signed distance to the case (m, world size); `local` keeps the point in the phone's frame (m) */
    const local = new THREE.Vector3();
    const sdf = (pw: THREE.Vector3) => {
      const p = local.copy(pw).applyMatrix4(inv);
      const qx = Math.abs(p.x) - half.x;
      const qy = Math.abs(p.y) - half.y;
      const qz = Math.abs(p.z - PHONE.t / 2) - half.z;
      return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0)) * s;
    };
    const mm = (p: THREE.Vector3): [number, number, number] => [Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 10000) / 10];
    const handRe = new RegExp(`_${this.side}_(Hand|Finger\\d+)$`);
    const palmRe = new RegExp(`_${this.side}_Hand$`);
    const thumbRe = new RegExp(`_${this.side}_Finger0\\d*$`);
    const tipRe = new RegExp(`_${this.side}_Finger02$`);
    let finger = Infinity;
    let palm = Infinity;
    let thumb = Infinity;
    let head = Infinity;
    let fingerWorst = '';
    let fingerAt: [number, number, number] = [0, 0, 0];
    let thumbAt: [number, number, number] = [0, 0, 0];
    let glass = Infinity;
    let glassWorst = '';
    let screen = Infinity;
    let pad = Infinity;
    let headWorst = '';
    let headAt: [number, number, number] = [0, 0, 0];
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const kind = (m.material as THREE.Material).name;
      m.skeleton.update();
      const pos = m.geometry.attributes.position;
      const si = m.geometry.attributes.skinIndex;
      const sw = m.geometry.attributes.skinWeight;
      const v = new THREE.Vector3();
      // a Rocketbox avatar's meshes share one vertex buffer: only the vertices this mesh draws are its own
      const used = usedVertices(m.geometry);
      for (let i = 0; i < pos.count; i++) {
        if (used && !used[i]) continue;
        let best = -1;
        let bw = 0;
        for (let j = 0; j < 4; j++) {
          const w = sw.getComponent(i, j);
          if (w > bw) {
            bw = w;
            best = si.getComponent(i, j);
          }
        }
        const name = m.skeleton.bones[best]?.name ?? '';
        const inHand = kind === 'body' && handRe.test(name);
        const inHead = this.call > 0.5 && (kind === 'head' || kind === 'hair');
        if (!inHand && !inHead) continue;
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        const d = sdf(v);
        if (inHand) {
          // over the display: how far above the glass (negative: below it)
          if (Math.abs(local.x) < PHONE.dispW / 2 && Math.abs(local.y) < PHONE.dispH / 2 && local.z > PHONE.t / 2) {
            const h = (local.z - PHONE.screenZ) * s;
            screen = Math.min(screen, h);
            if (tipRe.test(name)) pad = Math.min(pad, h);
          }
          // under the glass within the picture (3 mm in from its edge), in the case's top half: skin
          // showing through the screen (the fault that shows; a hand round the case's edge is how it's held)
          if (Math.abs(local.x) < PHONE.dispW / 2 - 0.003 && Math.abs(local.y) < PHONE.dispH / 2 - 0.003 && local.z > PHONE.t / 2 && local.z < PHONE.screenZ) {
            const h = (local.z - PHONE.screenZ) * s;
            if (h < glass) {
              glass = h;
              glassWorst = name;
            }
          }
          if (thumbRe.test(name)) {
            if (d < thumb) {
              thumb = d;
              thumbAt = mm(local);
            }
          } else if (palmRe.test(name)) palm = Math.min(palm, d);
          else if (d < finger) {
            finger = d;
            fingerWorst = name;
            fingerAt = mm(local);
          }
        }
        if (inHead && d < head) {
          head = d;
          headWorst = `${kind}:${name}`;
          headAt = mm(local);
        }
      }
    });
    return { glass: Math.min(0, glass), glassWorst, finger, fingerWorst, fingerAt, palm, thumb, thumbAt, screen, pad, head, headWorst, headAt };
  }
}

export interface PhoneCheck {
  /**
   * deepest any skin of the holding hand sits under the glass within the picture (m, ≤ 0; 0 = none):
   * fingers or thumb through the screen. (The case's edge, held in the hand, doesn't count.)
   */
  glass: number;
  glassWorst: string;
  /** deepest any finger vertex (not the thumb, not the palm) goes into the case, any face (m; < 0 inside); which bone; where (phone frame, mm) */
  finger: number;
  fingerWorst: string;
  fingerAt: [number, number, number];
  /** the palm against the case's back (it compresses there, out of sight) */
  palm: number;
  /** the thumb, any face (its base presses the case's side a little, as a real thumb clamps a phone) */
  thumb: number;
  thumbAt: [number, number, number];
  /** the lowest skin over the display, above the glass (m), and the thumb tip's alone (≈ 0 when it presses) */
  screen: number;
  pad: number;
  /** at the ear: the deepest head or hair vertex inside the phone (m), which mesh and bone, where (phone frame, mm) */
  head: number;
  headWorst: string;
  headAt: [number, number, number];
}

// ───────────────────────────── test hooks (?debug=1) ─────────────────────────────

/** people made by the test hook (spawn): updated here every frame */
const spawned: { av: { update(dt: number, t: number, moving: boolean, speed: number): void; root: THREE.Object3D }; last: number }[] = [];
function tickSpawned() {
  const now = performance.now();
  for (const s of spawned) {
    s.av.update(Math.min(0.05, (now - s.last) / 1000), now / 1000, false, 0);
    s.last = now;
  }
  if (spawned.length) requestAnimationFrame(tickSpawned);
}

if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__acAnim = {
    /** everyone holding a phone: where, which hand, act, eyes, screen */
    phones: () => [...holds].map((h) => h.debug()),
    /** what posing the phones cost since the last call: total ms, calls, ms per call */
    cost() {
      const r = { ms: cost.ms, calls: cost.n, perCall: cost.n ? cost.ms / cost.n : 0 };
      cost.ms = cost.n = 0;
      return r;
    },
    /** skin vs phone for the i-th holder (CPU skinning: slow) */
    phoneCheck: (i: number) => [...holds][i]?.check() ?? null,
    /** the player's jump (jump.ts): phase, pelvis drop, heights */
    jump: () => jumpDebugAll()[0] ?? null,
    /**
     * A test person with a phone (left- or right-handed), standing at (x, z) facing yawDeg, doing `act`
     * (phone_text / phone_call / film): for pictures and checks of what the crowd may not be doing now.
     * `withPhone` false: no phone (a test brings its own). Resolves to the person (in the page).
     */
    async spawn(cast: string, x: number, z: number, yawDeg: number, act: AmbientAct, hand: 'R' | 'L' = 'R', withPhone = true) {
      const scene = [...holds].map((h) => h.prop).find((p) => p.parent)?.parent;
      let root: THREE.Object3D | null | undefined = scene;
      while (root?.parent) root = root.parent;
      if (!root) return false;
      const { AvatarCharacter } = await import('./avatars');
      const av = new AvatarCharacter({ id: cast } as never, { height: /Female/.test(cast) ? 1.66 : 1.78 });
      await new Promise<void>((res) => {
        const wait = () => (av.ready || av.failed ? res() : setTimeout(wait, 50));
        wait();
      });
      av.root.position.set(x, 0, z);
      av.root.rotation.y = (yawDeg * Math.PI) / 180;
      av.act = act;
      const prop = withPhone ? buildProp('phone', { mount: hand === 'L' ? 'handL' : 'handR' }) : null;
      if (prop) av.attach(prop.obj, prop.mount);
      root.add(av.root);
      spawned.push({ av, last: performance.now() });
      if (spawned.length === 1) requestAnimationFrame(tickSpawned);
      return av;
    },
  };
}

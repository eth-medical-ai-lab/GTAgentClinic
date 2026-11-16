/**
 * Bedside care. At a patient's bed or stretcher, talking or examining (the patient's tablet is open
 * for them, a ward patient you went to see, or an exam runs), the doctor:
 *
 *  - turns fully to the patient: across the bed's long side at about chest level (a little toward
 *    the foot if someone stands there), at the foot or the head end if that is where you are, or in
 *    front of someone sitting on the bed's edge. Third person and top-down step there first when the
 *    spot is free and a short walk away, and the body stands up against the bed (a step in of 11 cm
 *    the controller's radius doesn't allow: the body only). First person keeps the view where it is;
 *    the unseen body still turns (others see it).
 *  - rests the foot-side hand on the side rail (two-bone IK, the palm on the rail's top; on the
 *    footboard at the foot end), leans in a little and looks at the patient's face: the eyes jump
 *    (saccades) between the face and the body and the head follows, a slow sway, now and then the hand
 *    shifting along the rail.
 *  - on an exam (a new finding for this patient in the server view), the hand nearer the region goes
 *    to it for a moment: the stethoscope's chest piece (tubing to the neck) to the chest, the palm on
 *    the abdomen, fingertips to a wrist or an ankle, a penlight over the eyes; bending over the rail at
 *    the hips as far as it must (the legs stay planted), after a step along the bed for the belly or
 *    the legs. First person: the hand comes into view.
 *
 * Walking off (moving always wins) or closing the tablet lets go smoothly. An AI doctor's body at a
 * bedside (observe mode) takes the same stance and pose: `stanceFor` places it (World's NPC
 * destination), `NpcCare` poses it.
 *
 * Beds are props.ts's (sizes from bedding.ts's BedSpec): head toward −z in the bed's frame, split
 * side rails 3 cm thick centred W/2 + 2.5 cm out, tops 0.90 m (head section, z −0.87…0.03; a bed's
 * foot section 0.86 m, z 0.21…0.83). The rails stay on the frame; the backrest between them hinges
 * (bedRig.ts), and a patient's trunk, head and arms turn up with it: the points aimed at follow.
 */
import * as THREE from 'three';
import type { LayoutDef } from '../../../shared/layout';
import { upperLevels } from '../../../shared/floors';
import type { CameraMode, PlayerView } from '../../../shared/types';
import type { AvatarCharacter } from './avatars';
import { bedSpec, type BedKind } from './bedding';
import type { Character } from './characters';
import { lerpAngle, type PlayerController } from './controls';
import { armBones, handQuat, reachArm, type ArmBones, type HandSide, type PlayerHands } from './hands';
import { G, lambert } from './materials';
import { Reach } from './reach';

// ───────────────────────────── beds ─────────────────────────────

export interface Bed {
  id: string;
  kind: BedKind;
  x: number;
  z: number;
  rot: number;
  /** floor level of its storey, and the storey */
  y: number;
  level: number;
  room: string;
}

/** a bed's sizes (props.ts / bedding.ts) */
interface BedGeo {
  W: number;
  L: number;
  /** mattress half width, foot end, top */
  hw: number;
  zFoot: number;
  top: number;
  /** side rails: centre line, outer face; the sections a hand can rest on (z from, z to, top) */
  railX: number;
  railOut: number;
  railTop: number;
  railZ: [number, number];
  rails: [number, number, number][];
  /** the collider box's half length (boards, push handle) */
  halfL: number;
  /** footboard (bed) / push handle (stretcher): its line and top */
  footZ: number;
  footTop: number;
}

const GEO: Partial<Record<BedKind, BedGeo>> = {};
function geo(kind: BedKind): BedGeo {
  const have = GEO[kind];
  if (have) return have;
  const s = bedSpec(kind);
  const g: BedGeo = {
    W: s.W,
    L: s.L,
    hw: s.hw,
    zFoot: s.zFoot,
    top: s.top,
    railX: s.W / 2 + 0.025,
    railOut: s.W / 2 + 0.04,
    railTop: 0.9,
    railZ: [-0.8, -0.06],
    // the head section (0.9 m long, top 0.90); a bed's foot section too (0.62 m, top 0.86)
    rails: kind === 'bed' ? [[-0.8, -0.06, 0.9], [0.27, 0.77, 0.86]] : [[-0.8, -0.06, 0.9]],
    halfL: s.L / 2 + 0.05,
    footZ: s.L / 2 + 0.02,
    footTop: kind === 'bed' ? 0.8 : 0.936,
  };
  GEO[kind] = g;
  return g;
}

/** every bed and stretcher on every storey */
export function bedsOf(layout: LayoutDef): Bed[] {
  const out: Bed[] = [];
  const take = (props: LayoutDef['props'], y: number, level: number) => {
    for (const p of props) if (p.kind === 'bed' || p.kind === 'stretcher') out.push({ id: p.id, kind: p.kind, x: p.x, z: p.z, rot: p.rot ?? 0, y, level, room: p.bay ?? p.room });
  };
  take(layout.props, 0, 0);
  for (const L of upperLevels(layout)) take(L.props, L.y, L.index);
  return out;
}

/** a bed's frame: local (x across, z along, head at −z) ↔ world */
class Frame {
  readonly c: number;
  readonly s: number;
  constructor(readonly bed: Bed) {
    this.c = Math.cos(bed.rot);
    this.s = Math.sin(bed.rot);
  }
  world(lx: number, lz: number, ly: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.bed.x + lx * this.c + lz * this.s, this.bed.y + ly, this.bed.z - lx * this.s + lz * this.c);
  }
  dir(lx: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(lx * this.c + lz * this.s, 0, -lx * this.s + lz * this.c);
  }
  local(wx: number, wz: number): { lx: number; lz: number } {
    const dx = wx - this.bed.x;
    const dz = wz - this.bed.z;
    return { lx: dx * this.c - dz * this.s, lz: dx * this.s + dz * this.c };
  }
}

// ───────────────────────────── bones ─────────────────────────────

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const q4 = new THREE.Quaternion();

type Bones = Record<string, THREE.Object3D | undefined>;
const boneCache = new WeakMap<THREE.Object3D, Bones>();
/** a Rocketbox skeleton's bones by short name ('Spine2', 'L_Hand', 'Head', 'LEye'…) */
function bonesOf(root: THREE.Object3D): Bones {
  let b = boneCache.get(root);
  if (b) return b;
  b = {};
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone || !o.name.startsWith('Bip01_')) return;
    const k = o.name.slice(6);
    if (!b![k]) b![k] = o;
  });
  // (not cached until the model is in)
  if (b.Head) boneCache.set(root, b);
  return b;
}

/** the thumb's way for a hand palm-down with its fingers along `fingers` (handQuat: the left thumb is −Z) */
function palmDownThumb(side: HandSide, fingers: THREE.Vector3): THREE.Vector3 {
  return fingers.clone().cross(side === 'R' ? new THREE.Vector3(0, -1, 0) : UP);
}

/** the thumb's way for a hand whose palm faces along `palm` (Rocketbox hands: Y out of the palm) */
function palmThumb(side: HandSide, fingers: THREE.Vector3, palm: THREE.Vector3): THREE.Vector3 {
  return fingers.clone().cross(palm).multiplyScalar(side === 'R' ? 1 : -1);
}

/** rotate a bone by a world-space rotation (applied in its parent's frame) */
function turnWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  if (!bone.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(q2);
  q3.copy(q2).invert().multiply(q).multiply(q2);
  bone.quaternion.premultiply(q3);
  bone.updateMatrixWorld(true);
}

/**
 * A forward bend shared out down the trunk: a hinge at the hips (the pelvis tips forward, the thighs
 * turned back so the legs stay planted; Rocketbox thighs hang from Bip01_Spine) and the rest in the
 * spine, as you bend over a bed.
 */
const SPINE: [string, number][] = [
  ['Pelvis', 0.45],
  ['Spine', 0.25],
  ['Spine1', 0.18],
  ['Spine2', 0.12],
];

/** bend the trunk forward (+) about the body's right axis (and sideways a touch: `side`) */
function leanSpine(b: Bones, yaw: number, angle: number, side = 0) {
  if (Math.abs(angle) < 1e-4 && Math.abs(side) < 1e-4) return;
  // the body's right (−cos, sin): a turn about it by +a lifts the front, so a forward bend is −a
  const r = v1.set(-Math.cos(yaw), 0, Math.sin(yaw));
  const f = v2.set(Math.sin(yaw), 0, Math.cos(yaw));
  // what the thighs' ancestors (pelvis, first spine bone) turned, to turn them back by
  const legs = q4.identity();
  for (const [k, share] of SPINE) {
    const bone = b[k];
    if (!bone) continue;
    q1.setFromAxisAngle(r, -angle * share);
    if (side && k !== 'Pelvis') q1.premultiply(q3.setFromAxisAngle(f, side * share));
    if (k === 'Pelvis' || k === 'Spine') legs.premultiply(q1);
    turnWorld(bone, q1);
    if (k === 'Spine') {
      q1.copy(legs).invert();
      for (const t of [b.L_Thigh, b.R_Thigh]) if (t) turnWorld(t, q1);
    }
  }
}

/**
 * Turn neck and head (and the eyes, the rest of the way) to look at `at`, by weight w; the head's
 * turn is limited to what a neck does (yaw ±65° off the body, pitch −55°…+20°). Rocketbox heads: Y
 * out of the face (hands.ts facePoint).
 */
function lookAt(b: Bones, bodyYaw: number, at: THREE.Vector3, w: number, eyesAt?: THREE.Vector3) {
  const head = b.Head;
  if (!head || w < 1e-3) return;
  head.updateWorldMatrix(true, false);
  const f = v1.set(0, 1, 0).applyQuaternion(head.getWorldQuaternion(q1));
  const eye = head.getWorldPosition(v2).addScaledVector(UP, 0.07).addScaledVector(f, 0.07);
  const d = v3.copy(at).sub(eye).normalize();
  const curYaw = Math.atan2(f.x, f.z);
  const curPitch = Math.asin(clamp(f.y, -1, 1));
  const wantYaw = bodyYaw + clamp(wrap(Math.atan2(d.x, d.z) - bodyYaw), -1.13, 1.13);
  const wantPitch = clamp(Math.asin(clamp(d.y, -1, 1)), -0.96, 0.35);
  const dy = wrap(wantYaw - curYaw) * w;
  const dp = (wantPitch - curPitch) * w;
  const r = v4.set(-Math.cos(curYaw + dy), 0, Math.sin(curYaw + dy));
  for (const [bone, k] of [[b.Neck, 0.4], [head, 0.6]] as [THREE.Object3D | undefined, number][]) {
    if (!bone) continue;
    q1.setFromAxisAngle(UP, dy * k).premultiply(q2.setFromAxisAngle(r, dp * k));
    turnWorld(bone, q1);
  }
  // the eyes: the rest of the way to where they look (saccades are theirs; the head follows slowly)
  const e = eyesAt ?? at;
  const eyes = [b.LEye, b.REye].filter((x): x is THREE.Object3D => !!x);
  if (!eyes.length) return;
  head.updateWorldMatrix(true, false);
  const f2 = v1.set(0, 1, 0).applyQuaternion(head.getWorldQuaternion(q1));
  const eye2 = head.getWorldPosition(v2).addScaledVector(UP, 0.07).addScaledVector(f2, 0.07);
  const d2 = v3.copy(e).sub(eye2).normalize();
  const ey = clamp(wrap(Math.atan2(d2.x, d2.z) - Math.atan2(f2.x, f2.z)), -0.3, 0.3) * w;
  const ep = clamp(Math.asin(clamp(d2.y, -1, 1)) - Math.asin(clamp(f2.y, -1, 1)), -0.25, 0.2) * w;
  const r2 = v4.set(-Math.cos(Math.atan2(f2.x, f2.z)), 0, Math.sin(Math.atan2(f2.x, f2.z)));
  for (const eb of eyes) {
    q1.setFromAxisAngle(UP, ey).premultiply(q2.setFromAxisAngle(r2, ep));
    turnWorld(eb, q1);
  }
}

// ───────────────────────────── the patient's body ─────────────────────────────

/** what an exam touches (or only looks at), and how long the hand stays */
type Region = 'heart' | 'lungs' | 'abdomen' | 'ruq' | 'rlq' | 'llq' | 'eyes' | 'mouth' | 'neck' | 'wrist' | 'arm' | 'shin' | 'ankle' | 'flank' | 'shoulder' | 'face' | 'chest' | 'legs';
interface ExamDef {
  region: Region;
  /** s the hand stays (0 = only a look) */
  hold: number;
  motion?: 'steth' | 'press' | 'sweep';
}
const EXAM: Record<string, ExamDef> = {
  gen_appearance: { region: 'face', hold: 0 },
  gen_mental: { region: 'face', hold: 0 },
  skin_inspect: { region: 'arm', hold: 0 },
  skin_capref: { region: 'wrist', hold: 1.3, motion: 'press' },
  heent_mucosa: { region: 'mouth', hold: 1.2 },
  heent_pupils: { region: 'eyes', hold: 1.5, motion: 'sweep' },
  neck_jvp: { region: 'neck', hold: 0 },
  neck_stiffness: { region: 'neck', hold: 1.4 },
  cv_auscultate: { region: 'heart', hold: 2.4, motion: 'steth' },
  cv_pulses: { region: 'wrist', hold: 1.6 },
  cv_bp_both_arms: { region: 'arm', hold: 1.8 },
  cv_edema: { region: 'shin', hold: 1.3, motion: 'press' },
  pulm_effort: { region: 'chest', hold: 0 },
  pulm_auscultate: { region: 'lungs', hold: 2.6, motion: 'steth' },
  pulm_percuss: { region: 'lungs', hold: 1.8, motion: 'press' },
  abd_inspect: { region: 'abdomen', hold: 0 },
  abd_auscultate: { region: 'abdomen', hold: 1.8, motion: 'steth' },
  abd_palpate: { region: 'abdomen', hold: 2.4, motion: 'press' },
  abd_rebound: { region: 'abdomen', hold: 1.4, motion: 'press' },
  abd_mcburney: { region: 'rlq', hold: 1.3, motion: 'press' },
  abd_rovsing: { region: 'llq', hold: 1.3, motion: 'press' },
  abd_psoas: { region: 'rlq', hold: 1.2 },
  abd_obturator: { region: 'rlq', hold: 1.2 },
  abd_murphy: { region: 'ruq', hold: 1.6, motion: 'press' },
  back_cva: { region: 'flank', hold: 1.3, motion: 'press' },
  neuro_gcs: { region: 'shoulder', hold: 1.2 },
  neuro_focal: { region: 'wrist', hold: 1.8 },
  neuro_cam: { region: 'face', hold: 0 },
  neuro_gait: { region: 'legs', hold: 0 },
  msk_ankle_inspect: { region: 'ankle', hold: 0 },
  msk_lat_malleolus: { region: 'ankle', hold: 1.2, motion: 'press' },
  msk_med_malleolus: { region: 'ankle', hold: 1.2, motion: 'press' },
  msk_5th_mt: { region: 'ankle', hold: 1.1, motion: 'press' },
  msk_navicular: { region: 'ankle', hold: 1.1, motion: 'press' },
  msk_weight_bearing: { region: 'legs', hold: 0 },
  msk_ant_drawer: { region: 'ankle', hold: 1.3 },
  msk_squeeze: { region: 'shin', hold: 1.2, motion: 'press' },
  msk_thompson: { region: 'shin', hold: 1.2, motion: 'press' },
  msk_neurovascular: { region: 'ankle', hold: 1.4 },
};

/** the regions on the legs: they lie along the bed whatever the backrest does */
const LEGS = new Set<Region>(['wrist', 'shin', 'ankle', 'legs']);

/**
 * Lying, the face is where the head has it: from between the eyes (the head bone is at the skull's base),
 * looking out where the head looks (Rocketbox heads: +Y out of the face; its chin a little down on the
 * pillow, turned to whoever it watches). Sitting on the edge: as it was (the head bone, their facing).
 */
function faceOut(b: Bones, sitting: boolean, out: THREE.Vector3) {
  if (!b.Head || sitting) return;
  ax.out.set(0, 1, 0).applyQuaternion(b.Head.getWorldQuaternion(q1));
  if (b.LEye && b.REye) out.copy(b.LEye.getWorldPosition(rp1)).add(b.REye.getWorldPosition(v4)).multiplyScalar(0.5).addScaledVector(ax.out, -0.02);
}

/**
 * A point on a patient's body (world): from the skeleton where it has one (blanket included: a few
 * cm over the body), else from the bed. Supine (head toward the bed's −z, face up: their left is the
 * bed's +x; the trunk turned up with the backrest, bedRig.ts) or sitting on the bed's edge (their own
 * facing: `sitting`). `near` is the side of them the doctor is on (+1: their left); `phase` cycles the
 * auscultation / palpation points.
 */
const rp1 = new THREE.Vector3();
const ax = { left: new THREE.Vector3(), feet: new THREE.Vector3(), out: new THREE.Vector3() };
function regionPoint(region: Region, pt: Character, fr: Frame, near: number, phase: number, out: THREE.Vector3, sitting = false): THREE.Vector3 {
  const b = bonesOf(pt.root);
  pt.root.updateMatrixWorld(true);
  // the body's own axes: their left, toward their feet along the trunk, out of their front
  if (sitting) {
    const p = pt.root.rotation.y;
    ax.left.set(Math.cos(p), 0, -Math.sin(p));
    ax.feet.set(0, -1, 0);
    ax.out.set(Math.sin(p), 0, Math.cos(p));
  } else {
    // the trunk (and the head, the arms along it) as far up as the backrest has turned it; the legs flat
    const tilt = LEGS.has(region) ? 0 : trunkTilt(pt);
    fr.dir(1, 0, ax.left);
    fr.dir(0, Math.cos(tilt), ax.feet).addScaledVector(UP, -Math.sin(tilt));
    fr.dir(0, Math.sin(tilt), ax.out).addScaledVector(UP, Math.cos(tilt));
  }
  const at = (k: string, fx: number, fz: number) => {
    const bone = b[k];
    if (bone) bone.getWorldPosition(out);
    else if (sitting) out.copy(pt.root.position).addScaledVector(UP, 0.55 - fz * 0.6).addScaledVector(ax.left, fx);
    else fr.world(fx, fz, 0.72, out);
    return out;
  };
  const side = (k: number) => out.addScaledVector(ax.left, k);
  const along = (k: number) => out.addScaledVector(ax.feet, k);
  const front = (k: number) => out.addScaledVector(ax.out, k);
  // how far out from a trunk bone this body's front is, lying in a bed (avatars.ts measures it on the skin),
  // and a little over it (more over the belly: a blanket can be on it); else the usual
  const skin = (bone: 'Pelvis' | 'Spine' | 'Spine1' | 'Spine2', usual: number, over: number) => {
    const d = (pt as Partial<AvatarCharacter>).frontOf?.(bone);
    return d !== undefined ? d + over : usual;
  };
  const nearK = near >= 0 ? 'L' : 'R';
  switch (region) {
    case 'heart':
      at('Spine2', 0, -0.36);
      side(0.05 + 0.03 * Math.sin(phase * 2.1));
      along(0.05 + 0.04 * Math.cos(phase * 2.1));
      return front(skin('Spine2', 0.115, 0.012));
    case 'lungs':
    case 'chest': {
      at('Spine2', 0, -0.36);
      const k = region === 'lungs' ? (Math.floor(phase) % 2 ? 1 : -1) : 0;
      side(0.085 * k);
      along(-0.02 + (Math.floor(phase / 2) % 2) * 0.07);
      return front(skin('Spine2', 0.11, 0.008));
    }
    case 'abdomen':
      at('Spine', 0, -0.08);
      side(near * 0.04 + 0.06 * Math.sin(phase * 1.7));
      along(0.07 + 0.05 * Math.cos(phase * 1.3));
      return front(skin('Spine', 0.13, 0.02));
    case 'ruq':
      at('Spine1', 0, -0.2);
      side(-0.08);
      along(0.06);
      return front(skin('Spine1', 0.12, 0.02));
    case 'rlq':
    case 'llq':
      at('Pelvis', 0, 0.05);
      side(region === 'rlq' ? -0.08 : 0.08);
      along(-0.05);
      return front(skin('Pelvis', 0.13, 0.02));
    case 'eyes':
      at('Head', 0, -0.75);
      faceOut(b, sitting, out);
      side(0.035 * Math.sin(phase * 3));
      return front(0.2);
    case 'face':
    case 'mouth':
      at('Head', 0, -0.75);
      faceOut(b, sitting, out);
      along(region === 'mouth' ? 0.05 : 0);
      return front(region === 'mouth' ? 0.1 : 0.035);
    case 'neck':
      at('Neck', 0, -0.62);
      side(near * 0.04);
      return front(0.07);
    case 'shoulder':
      at(`${nearK}_UpperArm`, near * 0.2, -0.5);
      return out.addScaledVector(sitting ? ax.left : ax.out, sitting ? near * 0.06 : 0.07);
    case 'wrist':
      at(`${nearK}_Hand`, near * 0.24, 0.05);
      return out.addScaledVector(UP, 0.045);
    case 'arm': {
      at(`${nearK}_UpperArm`, near * 0.22, -0.4);
      const e = b[`${nearK}_Forearm`];
      if (e) out.lerp(e.getWorldPosition(rp1), 0.45);
      return out.addScaledVector(sitting ? ax.left : ax.out, sitting ? near * 0.06 : 0.06);
    }
    case 'shin':
      at(`${nearK}_Calf`, near * 0.1, 0.45);
      if (!sitting) along(0.12);
      return front(0.08);
    case 'ankle':
    case 'legs':
      at(`${nearK}_Foot`, near * 0.1, 0.85);
      if (!sitting) along(-0.04);
      return front(region === 'legs' ? 0.1 : 0.08);
    case 'flank':
      at('Spine1', 0, -0.2);
      side(near * 0.15);
      return sitting ? out.addScaledVector(ax.out, -0.05) : front(0.04);
  }
}

// ───────────────────────────── stances ─────────────────────────────

/** feet this far out from the rails' outer faces (the player's 0.3 m from the bed's box, and a little) */
const STAND = 0.31;
/**
 * Posed, the body stands this much closer than the controller may (its 0.3 m radius): up against the
 * bed, a hand's width between the thighs and the rail. Only the body moves (eased; the camera and
 * your position don't), so walking off never pops.
 */
const STEP_IN = 0.115;
/** a step to the bedside is "quick" up to this walk (m) */
const STEP_MAX = 2.6;
/** first person: how far the view leans in for an exam's hand (m) */
const FP_LEAN = 0.4;

export interface Stance {
  bed: Bed;
  kind: 'side' | 'foot' | 'head' | 'here' | 'front';
  /** the patient sits on the bed's edge (front: in front of them) */
  sitting?: boolean;
  /** the bed's side (+1: its +x) for a side stance */
  s: number;
  x: number;
  z: number;
  facing: number;
  /** where the resting hand goes (null: nothing to rest it on within reach) */
  rest: { side: HandSide; lx: number; lz: number; ly: number; along: 'rail' | 'board'; span: [number, number] } | null;
}

const xz = (v: THREE.Vector3): [number, number] => [v.x, v.z];

/**
 * The patient's chest along the bed (local z), from the skeleton if it is in: sitting up with the
 * backrest, its front (which faces down the bed) rather than its bone
 */
function chestZ(pt: Character | null, fr: Frame): number {
  const b = pt ? bonesOf(pt.root) : null;
  if (b?.Spine2) {
    pt!.root.updateMatrixWorld(true);
    const p = b.Spine2.getWorldPosition(v1);
    return clamp(fr.local(p.x, p.z).lz + 0.12 * Math.sin(trunkTilt(pt)), -0.6, 0.1);
  }
  return -0.36;
}

/** how far up the backrest has the patient's trunk (rad; 0 flat or without a bed that moves) */
const trunkTilt = (pt: Character | null) => (pt as Partial<AvatarCharacter> | null)?.trunkTilt ?? 0;

/**
 * A stance at a bed: one long side (s = ±1) at about chest level (or at `atZ` along the bed: an exam
 * of the legs), the foot or the head end. `npc`: no controller radius to keep, it stands right there.
 */
export function stanceAt(bed: Bed, kind: 'side' | 'foot' | 'head', s: number, pt: Character | null, atZ?: number, npc = false, aimZ?: number): Stance {
  const g = geo(bed.kind);
  const fr = new Frame(bed);
  const cz = chestZ(pt, fr);
  const off = npc ? STAND - STEP_IN : STAND;
  let lx = 0;
  let lz = 0;
  const ax = 0;
  let az = cz;
  if (kind === 'side') {
    lx = s * (g.railOut + off);
    lz = atZ !== undefined ? clamp(atZ, -0.62, g.zFoot - 0.25) : clamp(cz + 0.06, -0.62, 0.12);
    // squared up to the bed, turned a little toward the head: the face is what you talk to (the legs' exam: what you
    // examine); sitting up, the face is over the chest
    az = aimZ ?? cz - 0.2 * Math.cos(trunkTilt(pt));
  } else if (kind === 'foot') lz = g.halfL + off;
  else lz = -(g.halfL + off);
  const p = fr.world(lx, lz, 0, new THREE.Vector3());
  const t = fr.world(ax, az, 0, new THREE.Vector3());
  const facing = Math.atan2(t.x - p.x, t.z - p.z);
  return { bed, kind, s: kind === 'side' ? s : 0, x: p.x, z: p.z, facing, rest: restFor(bed, kind, s, lz, facing) };
}

/** where a hand rests: the foot-side hand on the rail beside you, or on the footboard / push handle at the foot */
function restFor(bed: Bed, kind: Stance['kind'], s: number, lz: number, facing: number): Stance['rest'] {
  const g = geo(bed.kind);
  const fr = new Frame(bed);
  // the body's right, in the bed's frame
  const r = fr.local(bed.x - Math.cos(facing), bed.z + Math.sin(facing));
  if (kind === 'side') {
    // the arm toward the foot end (+z) rests on the rail just outside its shoulder, on the section there:
    // the forearm comes in beside the hip, not across it (where a long coat's front would cover it)
    const side: HandSide = r.lz > 0 ? 'R' : 'L';
    const want = lz + 0.24;
    let best: [number, number, number] | null = null;
    let bd = 0.3;
    for (const sec of g.rails) {
      const d = Math.abs(clamp(want, sec[0], sec[1]) - want);
      if (d < bd) {
        bd = d;
        best = sec;
      }
    }
    return best ? { side, lx: s * g.railX, lz: clamp(want, best[0], best[1]), ly: best[2], along: 'rail', span: [best[0], best[1]] } : null;
  }
  if (kind === 'foot') {
    const side: HandSide = 'R';
    return { side, lx: (r.lx > 0 ? 1 : -1) * 0.17, lz: g.footZ, ly: g.footTop, along: 'board', span: [g.footZ, g.footZ] };
  }
  return null;
}

/**
 * The AI doctor's spot at a bed (World: an NPC destination): its bedside spot's side at chest
 * level, or the foot / head end; null when (x, z) isn't at a bed (in `room`, when given).
 */
export function stanceFor(beds: Bed[], room: string | null, x: number, z: number, level = 0): Stance | null {
  let best: Bed | null = null;
  let bd = room ? 3 : 2.4;
  for (const b of beds) {
    if ((room && b.room !== room) || b.level !== level) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  if (!best) return null;
  const g = geo(best.kind);
  const l = new Frame(best).local(x, z);
  if (Math.abs(l.lx) > g.W / 2 + 0.1) return stanceAt(best, 'side', l.lx > 0 ? 1 : -1, null, undefined, true);
  return stanceAt(best, l.lz > 0 ? 'foot' : 'head', 0, null, undefined, true);
}

/** the bed someone sits on the edge of (whatever way they face), on their storey */
function bedNear(beds: Bed[], x: number, z: number, level: number): Bed | null {
  let best: Bed | null = null;
  let bd = 0.7;
  for (const b of beds) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (b.level === level && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** in front of a patient sitting on a bed's edge (their knees half that far out), turned to them; or a little to either side */
function frontStances(pt: CarePatient, bed: Bed | null): Stance[] {
  const p = pt.yaw;
  const fx = Math.sin(p);
  const fz = Math.cos(p);
  return [0, 0.32, -0.32].map((k) => {
    const x = pt.x + fx * 0.88 - Math.cos(p) * k;
    const z = pt.z + fz * 0.88 + Math.sin(p) * k;
    const facing = Math.atan2(pt.x + fx * 0.05 - x, pt.z + fz * 0.05 - z);
    return { bed: bed ?? { id: '', kind: 'stretcher', x: pt.x, z: pt.z, rot: p, y: 0, level: pt.level, room: '' }, kind: 'front', s: 0, x, z, facing, rest: null, sitting: true } as Stance;
  });
}

/** the bed a lying patient is in (centred under them, turned their way), on their storey */
function bedUnder(beds: Bed[], x: number, z: number, yaw: number, level: number): Bed | null {
  let best: Bed | null = null;
  let bd = 0.8;
  for (const b of beds) {
    if (b.level !== level) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd && Math.abs(wrap(b.rot - yaw)) < 0.4) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/**
 * Tests (BedsideCare.clearance): a patient's skin as on the flat bed (bedRig.ts's Bend.unmap), as the
 * highest point over the mattress top in each 3 cm cell across and along it: a doctor's hand checked
 * against the body itself when the backrest is up (the flat body's box no longer fits it).
 */
function patientTops(root: THREE.Object3D, fr: Frame, bedY: number, bend: { unmap(y: number, z: number, out: number[]): number[] }) {
  const C = 0.02;
  const top = geo(fr.bed.kind).top;
  const cells = new Map<number, number>();
  const key = (i: number, j: number) => (i + 1000) * 4000 + (j + 1000);
  const v = new THREE.Vector3();
  const f = [0, 0];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      const l = fr.local(v.x, v.z);
      bend.unmap(v.y - bedY, l.lz, f);
      const k = key(Math.round(l.lx / C), Math.round(f[1] / C));
      if (f[0] - top > (cells.get(k) ?? -9)) cells.set(k, f[0] - top);
    }
  });
  return {
    /** the skin's top over the mattress at (x, z) (its 2 cm cell), or undefined where there is none */
    at(x: number, z: number): number | undefined {
      return cells.get(key(Math.round(x / C), Math.round(z / C)));
    },
  };
}

// ───────────────────────────── the stethoscope ─────────────────────────────

/** the chest piece in the hand and its tubing up to the neck, while listening */
class Stethoscope {
  /** on the hand bone (attach scales it so that its units are metres), the chest piece inside */
  private holder = new THREE.Group();
  readonly piece = new THREE.Group();
  private tube: THREE.Mesh | null = null;
  private mat = lambert('#24292d', { roughness: 0.55 });
  private on: THREE.Object3D | null = null;
  constructor(private scene: THREE.Scene) {
    const steel = lambert('#c3c8cc', { roughness: 0.25, metalness: 0.85 });
    // diaphragm (its membrane toward the palm's side: the patient), stem, the tube's start
    const d = new THREE.Mesh(G.cyl(0.021, 0.021, 0.011, 20), steel);
    const m = new THREE.Mesh(G.cyl(0.0185, 0.0185, 0.002, 20), lambert('#1d2226', { roughness: 0.4 }));
    m.position.y = 0.0062;
    const stem = new THREE.Mesh(G.cyl(0.0045, 0.0045, 0.03, 8), steel);
    stem.rotation.z = Math.PI / 2;
    stem.position.set(-0.024, -0.002, 0);
    this.piece.add(d, m, stem);
    this.holder.add(this.piece);
    this.holder.visible = false;
  }
  /** show it in a hand bone (avatars.ts attach scales it to the model) */
  hold(av: AvatarCharacter, side: HandSide) {
    const want = bonesOf(av.root)[`${side}_Hand`] ?? null;
    if (this.on !== want) {
      this.holder.removeFromParent();
      av.attach(this.holder, side === 'R' ? 'handR' : 'handL');
      this.on = want;
    }
    // under the palm between the index and middle fingers, membrane out (Rocketbox hands: X along the fingers, Y out of the palm)
    this.piece.position.set(0.1, 0.034, side === 'R' ? 0.004 : -0.004);
    this.holder.visible = true;
  }
  /** the tubing from the chest piece to the neck (rebuilt each frame it shows) */
  drape(from: THREE.Vector3, neck: THREE.Vector3, up: number) {
    const mid = from.clone().lerp(neck, 0.5).addScaledVector(UP, -0.06 + up);
    const curve = new THREE.CatmullRomCurve3([from.clone().addScaledVector(UP, 0.01), from.clone().addScaledVector(UP, 0.07), mid, neck.clone()], false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, 18, 0.0042, 6, false);
    if (!this.tube) {
      this.tube = new THREE.Mesh(geo, this.mat);
      this.tube.castShadow = false;
      this.scene.add(this.tube);
    } else {
      this.tube.geometry.dispose();
      this.tube.geometry = geo;
    }
    this.tube.visible = true;
  }
  hide() {
    this.holder.visible = false;
    if (this.tube) this.tube.visible = false;
  }
  dispose() {
    this.holder.removeFromParent();
    if (this.tube) {
      this.scene.remove(this.tube);
      this.tube.geometry.dispose();
    }
  }
}

// ───────────────────────────── a pose at the bedside (the player's and an NPC's) ─────────────────────────────

interface Exam {
  def: ExamDef;
  maneuver: string;
  t: number;
  side: HandSide | null;
  lean: number;
  /** out of arm's reach from where the body stands (an NPC's, Pose.lookOnly): looked at, no hand */
  far?: boolean;
  /** how far out of reach it was at the full bend (m; tests) */
  short?: number;
}

/** the timeline of an exam's hand: out, hold, back */
const EX_OUT = 0.55;
const EX_BACK = 0.5;
const examLength = (e: Exam) => (e.def.hold > 0 ? EX_OUT + e.def.hold + EX_BACK : 1.8);
const examWeight = (e: Exam) => {
  if (e.def.hold <= 0) return 0;
  if (e.t < EX_OUT) return smooth(e.t / EX_OUT);
  if (e.t < EX_OUT + e.def.hold) return 1;
  return 1 - smooth((e.t - EX_OUT - e.def.hold) / EX_BACK);
};

/**
 * The bedside pose on one body: lean, look (saccades), the resting hand, an exam's hand. The player's
 * goes through PlayerHands (it eases the arms and knows what they hold); an NPC's straight to IK.
 */
class Pose {
  w = 0;
  exam: Exam | null = null;
  /** gaze: what the eyes are on, where the head is turned to (it follows them), next saccade */
  private gaze = new THREE.Vector3();
  private head = new THREE.Vector3();
  private gazeInit = false;
  private nextSaccade = 0;
  private gazeAt: 'face' | 'body' | 'region' = 'face';
  private jitter = new THREE.Vector3();
  /** the resting hand drifts along the rail now and then */
  private slide = 0;
  private slideGoal = 0;
  private nextSlide = 4;
  private clock = Math.random() * 10;
  /** the lean now (rad; tests) */
  lean = 0;
  /**
   * An NPC's pose: an exam out of arm's reach (it talks from where its walk ended, across from someone
   * sitting; an ankle from beside the chest) is looked at, not reached for. (The player steps along
   * the bed first: BedsideCare.exam.)
   */
  lookOnly = false;
  /** how far the wrist target stayed out of reach at the last leanFor's full bend (m; 0 = reached) */
  private shortBy = 0;
  private steth: Stethoscope | null = null;
  // (own scratch: the helpers above use the module's)
  private exPoint = new THREE.Vector3();
  private face = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private sh = new THREE.Vector3();

  constructor(private scene: THREE.Scene | null) {}

  /** the exam's clock where nothing is posed (first person: the body isn't drawn) */
  tick(dt: number) {
    if (!this.exam) return;
    this.exam.t += dt;
    if (this.exam.t > examLength(this.exam)) {
      this.exam = null;
      this.gazeAt = 'face';
    }
  }

  startExam(maneuver: string) {
    const def = EXAM[maneuver];
    if (!def) return false;
    this.exam = { def, maneuver, t: 0, side: null, lean: 0 };
    this.gazeAt = 'region';
    this.nextSaccade = this.clock + 0.4;
    return true;
  }

  /**
   * Pose `root` (after its animation) at the stance by weight `w`: `arms` does the IK (the player:
   * PlayerHands.reach; an NPC: reachArm), `ms` is the model's scale (a hand's metres). `busy` hands
   * are left alone. The wrists' targets come first, the lean they need from them, then the head and
   * the arms on the leaned body.
   */
  apply(dt: number, root: THREE.Object3D, yaw: number, ms: number, st: Stance, pt: Character, arms: (side: HandSide, target: THREE.Vector3, quat: THREE.Quaternion, pole: THREE.Vector3, w: number) => void, busy: { R: boolean; L: boolean }, av: AvatarCharacter | null) {
    this.clock += dt;
    const b = bonesOf(root);
    if (!b.Head) return;
    const fr = new Frame(st.bed);
    if (this.exam) {
      this.exam.t += dt;
      if (this.exam.t > examLength(this.exam)) {
        this.exam = null;
        this.gazeAt = 'face';
      }
    }
    const w = this.w;
    if (w < 0.002 && !this.exam) {
      this.steth?.hide();
      return;
    }
    root.updateMatrixWorld(true);
    // the side of them you're on (in front of someone sitting: their left, your right hand's side)
    const sit = !!st.sitting;
    const near = sit ? 1 : st.s || (fr.local(root.position.x, root.position.z).lx >= 0 ? 1 : -1);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    // ── the exam: its point on the body, which hand, that hand's wrist ──
    const ex = this.exam;
    const exPoint = this.exPoint;
    let ew = 0;
    let exWrist: THREE.Vector3 | null = null;
    let exQ: THREE.Quaternion | null = null;
    if (ex) {
      regionPoint(ex.def.region, pt, fr, near, ex.def.motion ? ex.t * 1.6 : 0, exPoint, sit);
      // (pressed in: down, or into the trunk as the backrest has it)
      if (ex.def.motion === 'press') exPoint.addScaledVector(sit ? UP : ax.out, -0.012 * Math.max(0, Math.sin(ex.t * 7)));
      ew = examWeight(ex) * w;
      if (ex.def.hold > 0 && ex.side === null) {
        // the hand whose shoulder is nearer (the free one if the other holds something)
        const dR = b.R_UpperArm ? b.R_UpperArm.getWorldPosition(this.sh).distanceTo(exPoint) : Infinity;
        const dL = b.L_UpperArm ? b.L_UpperArm.getWorldPosition(this.sh).distanceTo(exPoint) : Infinity;
        let side: HandSide = dR <= dL ? 'R' : 'L';
        if (busy[side] && !busy[side === 'R' ? 'L' : 'R']) side = side === 'R' ? 'L' : 'R';
        ex.side = side;
      }
      if (ex.side && ex.def.hold > 0) {
        // palm onto the body (down onto someone lying, toward someone sitting), fingers across it and a little toward the head
        const into = ax.out.clone().negate();
        const fingers = ax.left.clone().multiplyScalar(-near * 0.85).addScaledVector(ax.feet, -0.45).addScaledVector(into, ex.def.region === 'eyes' ? 0.6 : 0.2).normalize();
        exQ = handQuat(ex.side, fingers, palmThumb(ex.side, fingers, into), new THREE.Quaternion());
        const palmOff = ex.def.motion === 'steth' ? new THREE.Vector3(0.1, 0.05, 0) : new THREE.Vector3(0.085, 0.01, 0);
        exWrist = exPoint.clone().sub(palmOff.applyQuaternion(exQ).multiplyScalar(ms));
        // the bend it takes (measured once, on the body as the animation has it)
        // (down to a foot on a low bed: further)
        const legs = ex.def.region === 'ankle' || ex.def.region === 'shin' || ex.def.region === 'legs';
        if (ex.lean === 0) {
          ex.lean = Math.max(1e-3, this.leanFor(b, yaw, ex.side, exWrist, legs ? 1.05 : 0.85, 0.03));
          // an NPC (no step along the bed; often shorter than the player): a deeper bend if that is all it takes
          if (this.lookOnly && this.shortBy > 0 && !legs) ex.lean = Math.max(1e-3, this.leanFor(b, yaw, ex.side, exWrist, 1.05, 0.03));
          ex.short = this.shortBy;
          if (this.lookOnly && this.shortBy > 0.04) ex.far = true;
        }
        if (ex.far) {
          exWrist = null;
          ew = 0;
        }
      }
    }
    // ── the resting hand: the palm on the top of the rail (a few mm over its rounded top), fingers over it toward the bed ──
    const rs = st.rest;
    const restW = rs && !busy[rs.side] ? w * (ex && !ex.far && ex.side === rs.side ? 1 - examWeight(ex) : 1) : 0;
    let restWrist: THREE.Vector3 | null = null;
    let restQ: THREE.Quaternion | null = null;
    if (rs && restW > 0.001) {
      if (this.clock > this.nextSlide) {
        this.slideGoal = rs.along === 'rail' ? (Math.random() - 0.5) * 0.1 : 0;
        this.nextSlide = this.clock + 6 + Math.random() * 6;
      }
      this.slide += (this.slideGoal - this.slide) * Math.min(1, dt * 1.5);
      const lz = rs.along === 'rail' ? clamp(rs.lz + this.slide, rs.span[0], rs.span[1]) : rs.lz;
      const palm = fr.world(rs.lx, lz, rs.ly + 0.01, new THREE.Vector3());
      const inward = rs.along === 'rail' ? fr.dir(-near, 0, new THREE.Vector3()) : fr.dir(0, -1, new THREE.Vector3());
      const fingers = inward.multiplyScalar(0.85).addScaledVector(UP, -0.5).normalize();
      restQ = handQuat(rs.side, fingers, palmDownThumb(rs.side, fingers), new THREE.Quaternion());
      restWrist = palm.sub(new THREE.Vector3(0.085, 0.01, 0).applyQuaternion(restQ).multiplyScalar(ms));
      // the bend that lets the arm rest there with the elbow a little bent (smoothed: the mocap sways)
      const need = Math.max(0, this.leanFor(b, yaw, rs.side, restWrist, 0.45, 0.035) - 0.1);
      this.restLean += (need - this.restLean) * Math.min(1, dt * 3);
    }
    // ── lean: a little toward the bed, a slow sway; as far as the resting hand or an exam's needs ──
    const sway = 0.02 * Math.sin(this.clock * 0.63) + 0.01 * Math.sin(this.clock * 1.71 + 1.3);
    const base = (0.1 + sway + (rs ? this.restLean : 0)) * w;
    const lean = ex && ex.lean > 0 ? base + Math.max(0, ex.lean - base) * ew : base;
    this.lean = lean;
    leanSpine(b, yaw, lean, 0.015 * Math.sin(this.clock * 0.41) * w);
    root.updateMatrixWorld(true);
    // ── look: the face (saccades: the eyes jump, the head follows), the body now and then, the exam's region ──
    regionPoint('face', pt, fr, near, 0, this.face, sit);
    if (this.clock >= this.nextSaccade) {
      if (this.gazeAt !== 'region' || !ex) this.gazeAt = Math.random() < 0.78 ? 'face' : 'body';
      this.jitter.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06);
      this.nextSaccade = this.clock + (this.gazeAt === 'face' ? 0.5 + Math.random() * 1.9 : 0.4 + Math.random() * 0.6);
    }
    const goal = this.goal;
    if (this.gazeAt === 'region' && ex) goal.copy(exPoint);
    else if (this.gazeAt === 'body') regionPoint('chest', pt, fr, near, 0, goal, sit);
    else goal.copy(this.face);
    goal.add(this.jitter);
    if (!this.gazeInit) {
      this.head.copy(goal);
      this.gazeInit = true;
    }
    this.gaze.copy(goal);
    this.head.lerp(goal, 1 - Math.exp(-dt * 4.5));
    lookAt(b, yaw, this.head, Math.max(w, ew) * 0.92, this.gaze);
    root.updateMatrixWorld(true);
    // ── the arms, on the leaned body ──
    if (rs && restWrist && restQ) {
      const S = b[`${rs.side}_UpperArm`];
      if (S) {
        const sh = S.getWorldPosition(new THREE.Vector3());
        const sideOut = right.clone().multiplyScalar(rs.side === 'R' ? 1 : -1);
        // the elbow out to the side and a little back, so the forearm stays outside the coat
        const pole = sh.clone().addScaledVector(UP, -0.45).addScaledVector(sideOut, 0.6).addScaledVector(fwd, -0.12);
        // out of reach (stood back from the bed): no resting hand
        const k = clamp((this.armLength(b, rs.side) + 0.015 - sh.distanceTo(restWrist)) / 0.05, 0, 1);
        this.restK = k;
        arms(rs.side, restWrist, restQ, pole, restW * k);
      }
    }
    if (ex && ex.side && exWrist && exQ && ew > 0.001) {
      const side = ex.side;
      const S = b[`${side}_UpperArm`];
      const sh = S ? S.getWorldPosition(new THREE.Vector3()) : exWrist.clone().addScaledVector(UP, 0.5);
      const pole = sh.clone().addScaledVector(UP, -0.4).addScaledVector(right, side === 'R' ? 0.45 : -0.45);
      arms(side, exWrist, exQ, pole, ew);
      if (ex.def.motion === 'steth' && av && this.scene && ew > 0.25) {
        this.steth ??= new Stethoscope(this.scene);
        this.steth.hold(av, side);
        this.steth.piece.updateWorldMatrix(true, false);
        const neck = b.Neck ? b.Neck.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.07).addScaledVector(UP, -0.1) : null;
        if (neck) this.steth.drape(this.steth.piece.getWorldPosition(new THREE.Vector3()), neck, 0.02);
      } else this.steth?.hide();
    } else this.steth?.hide();
  }

  /** the resting hand's reach factor (tests: 1 = it is on the rail) */
  restK = 0;

  /** the point the exam's hand goes to (tests) */
  get examPoint(): THREE.Vector3 {
    return this.exPoint;
  }

  /** how much more lean the resting hand needs to reach the rail (rad), measured at the stance */
  restLean = 0;

  private armLength(b: Bones, side: HandSide): number {
    const S = b[`${side}_UpperArm`];
    const E = b[`${side}_Forearm`];
    const H = b[`${side}_Hand`];
    if (!S || !E || !H) return 0.55;
    const s = S.getWorldPosition(new THREE.Vector3());
    const e = E.getWorldPosition(new THREE.Vector3());
    return s.distanceTo(e) + e.distanceTo(H.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * The forward bend (rad, up to `max`) that brings `side`'s shoulder within `slack` of a straight
   * arm's reach of the wrist target: the bend simulated down the spine as leanSpine shares it out.
   */
  leanFor(b: Bones, yaw: number, side: HandSide, wrist: THREE.Vector3, max: number, slack = 0.03): number {
    const S = b[`${side}_UpperArm`];
    if (!S) return 0;
    const pivots = SPINE.map(([k]) => b[k]?.getWorldPosition(new THREE.Vector3()) ?? null);
    const sh0 = S.getWorldPosition(new THREE.Vector3());
    const reach = this.armLength(b, side) - slack;
    this.shortBy = 0;
    const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const q = new THREE.Quaternion();
    const pts = [...pivots.map((p) => p?.clone() ?? null), sh0.clone()];
    for (let a = 0; a <= max + 1e-6; a += 0.02) {
      for (let i = 0; i < pts.length; i++) pts[i] = i < pivots.length ? (pivots[i]?.clone() ?? null) : sh0.clone();
      // each spine bone turns what is above it about its own joint
      SPINE.forEach(([, share], i) => {
        const piv = pts[i];
        if (!piv) return;
        q.setFromAxisAngle(r, -a * share);
        for (let j = i + 1; j < pts.length; j++) pts[j]?.sub(piv).applyQuaternion(q).add(piv);
      });
      if (pts[pts.length - 1]!.distanceTo(wrist) <= reach) return a;
    }
    this.shortBy = pts[pts.length - 1]!.distanceTo(wrist) - reach;
    return max;
  }

  dispose() {
    this.steth?.dispose();
  }
}

// ───────────────────────────── the player ─────────────────────────────

/** a lying patient, wherever they are (the ED's NPCs, the ward's people) */
export interface CarePatient {
  id: string;
  /** the patient record (exam findings are keyed by it) */
  patientId?: string;
  ch: Character;
  x: number;
  z: number;
  yaw: number;
  lying: boolean;
  /** sitting on a bed's or stretcher's edge, legs over the side */
  sitting?: boolean;
  /** their storey */
  level: number;
}

export interface CareDeps {
  scene: THREE.Scene;
  layout: LayoutDef;
  controller: () => PlayerController;
  mode: () => CameraMode;
  avatar: () => AvatarCharacter | null;
  hands: PlayerHands;
  patient: (id: string) => CarePatient | null;
  /** the storey you are on */
  level: () => number;
  /** a walk to (x, z) on your storey (null: no way there) */
  path: (x: number, z: number) => THREE.Vector2[] | null;
  /** could you stand at (x, z): clear of walls and furniture by a body's width, and of people (but `except`) where the body will be */
  clear: (x: number, z: number, except?: string, body?: { x: number; z: number }) => boolean;
  /** a gesture holds the body (gesture.ts): the pose steps aside meanwhile */
  gesturing: () => boolean;
  /** hands holding something */
  busy: () => { R: boolean; L: boolean };
  /** tests: the drawn curtains' boxes (no clipping) */
  curtainBoxes?: () => THREE.Box3[];
}

type Phase = 'off' | 'step' | 'turn' | 'on';

export class BedsideCare {
  readonly beds: Bed[];
  /** the tablet is open for this NPC / a ward patient you went to see (no tablet) */
  private tablet: string | null = null;
  private visitId: string | null = null;
  private phase: Phase = 'off';
  private st: Stance | null = null;
  private pt: CarePatient | null = null;
  private held = 0;
  private stepPath: THREE.Vector2[] | null = null;
  private stepWait = 0;
  /** standing still near the bed with the tablet still open: the pose comes back */
  private still = 0;
  private pose: Pose;
  /** exam findings seen per patient (new ones are exams) */
  private seen = new Map<string, number>();
  private pending: { pid: string; maneuver: string; at: number } | null = null;

  constructor(private d: CareDeps) {
    this.beds = bedsOf(d.layout);
    this.pose = new Pose(d.scene);
  }

  /** the tablet is open for this NPC (null: closed) */
  setTablet(id: string | null) {
    if (id === this.tablet) return;
    this.tablet = id;
    if (this.phase !== 'off' && this.pt?.id !== id) this.release();
    if (id) this.engage(id, true);
  }

  /** E on a patient you have no tablet for (the ward's): go to the bedside */
  visit(id: string) {
    this.visitId = id;
    this.engage(id, true);
  }

  /** the body's facing while the bedside holds it (World applies it before posing the avatar); null = none */
  get facing(): number | null {
    return this.phase === 'turn' || this.phase === 'on' ? this.held : null;
  }

  get engaged(): boolean {
    return this.phase !== 'off';
  }

  private engage(id: string, allowStep: boolean, atZ?: number, aimZ?: number, legs = false): boolean {
    const pt = this.d.patient(id);
    if (!pt || !(pt.lying || pt.sitting)) return false;
    const bed = pt.lying ? bedUnder(this.beds, pt.x, pt.z, pt.yaw, pt.level) : bedNear(this.beds, pt.x, pt.z, pt.level);
    const c = this.d.controller();
    let st: Stance | null = null;
    let path: THREE.Vector2[] | null = null;
    if (pt.sitting) {
      // sitting on the edge: in front of them (a short step there if it's free), else turned to them where you are
      const canStep = allowStep && this.d.mode() !== 'first' && !c.ride;
      this.why = [];
      for (const cand of frontStances(pt, bed)) {
        if (Math.hypot(cand.x - c.pos.x, cand.z - c.pos.y) < 0.15) {
          st = cand;
          break;
        }
        if (!canStep) continue;
        if (!this.d.clear(cand.x, cand.z, pt.id)) {
          this.why.push(`front@${cand.x.toFixed(2)},${cand.z.toFixed(2)}: taken`);
          continue;
        }
        const p = this.d.path(cand.x, cand.z);
        let len = 0;
        let px = c.pos.x;
        let pz = c.pos.y;
        for (const q of p ?? []) {
          len += Math.hypot(q.x - px, q.y - pz);
          px = q.x;
          pz = q.y;
        }
        if (!p?.length || len > STEP_MAX || Math.hypot(px - cand.x, pz - cand.z) > 0.15) {
          this.why.push(`front@${cand.x.toFixed(2)},${cand.z.toFixed(2)}: ${p?.length ? `${len.toFixed(1)} m walk` : 'no way'}`);
          continue;
        }
        st = cand;
        path = p;
        break;
      }
      st ??= { ...frontStances(pt, bed)[0], kind: 'here', x: c.pos.x, z: c.pos.y, facing: Math.atan2(pt.x - c.pos.x, pt.z - c.pos.y) };
    } else if (bed) {
      const g = geo(bed.kind);
      const fr = new Frame(bed);
      const me = fr.local(c.pos.x, c.pos.y);
      const s = me.lx >= 0 ? 1 : -1;
      const atFoot = me.lz > g.L / 2 - 0.1 && Math.abs(me.lx) < g.railOut + 0.35;
      const atHead = me.lz < -g.L / 2 + 0.1 && Math.abs(me.lx) < g.railOut + 0.35;
      // the near side at chest level (or along the bed a little toward the foot when something stands
      // there); at the foot or the head end, that end
      const sides = (k: number) => (atZ !== undefined ? [atZ, atZ - 0.2, atZ + 0.15] : [undefined, chestZ(pt.ch, fr) + 0.36, chestZ(pt.ch, fr) + 0.62]).map((z) => stanceAt(bed, 'side', k, pt.ch, z, false, aimZ));
      // (the legs: from the foot end when the near side is taken there)
      const order: Stance[] = atZ !== undefined ? [...sides(s).slice(0, 1), ...(legs ? [stanceAt(bed, 'foot', 0, pt.ch)] : []), ...sides(s).slice(1), ...sides(-s)] : atFoot ? [stanceAt(bed, 'foot', 0, pt.ch), ...sides(s)] : atHead ? [stanceAt(bed, 'head', 0, pt.ch), ...sides(s)] : [...sides(s), ...sides(-s).slice(0, 1), stanceAt(bed, 'foot', 0, pt.ch)];
      const canStep = allowStep && this.d.mode() !== 'first' && !c.ride;
      this.why = [];
      for (const cand of order) {
        const dist = Math.hypot(cand.x - c.pos.x, cand.z - c.pos.y);
        if (dist < 0.12) {
          st = cand;
          break;
        }
        if (!canStep) continue;
        const into = cand.kind === 'side' ? fr.dir(-cand.s * STEP_IN, 0, new THREE.Vector3()) : cand.kind === 'foot' ? fr.dir(0, -STEP_IN, new THREE.Vector3()) : fr.dir(0, STEP_IN, new THREE.Vector3());
        if (!this.d.clear(cand.x, cand.z, pt.id, { x: cand.x + into.x, z: cand.z + into.z })) {
          this.why.push(`${cand.kind}@${cand.x.toFixed(2)},${cand.z.toFixed(2)}: taken`);
          continue;
        }
        const p = this.d.path(cand.x, cand.z);
        if (!p?.length) {
          this.why.push(`${cand.kind}@${cand.x.toFixed(2)},${cand.z.toFixed(2)}: no way`);
          continue;
        }
        let len = 0;
        let px = c.pos.x;
        let pz = c.pos.y;
        for (const q of p) {
          len += Math.hypot(q.x - px, q.y - pz);
          px = q.x;
          pz = q.y;
        }
        if (len > STEP_MAX || Math.hypot(px - cand.x, pz - cand.z) > 0.15) {
          this.why.push(`${cand.kind}@${cand.x.toFixed(2)},${cand.z.toFixed(2)}: ${len.toFixed(1)} m walk`);
          continue;
        }
        st = cand;
        path = p;
        break;
      }
      if (!st) {
        // stay where you are, turned to the patient (a hand on the rail if it is within reach)
        const cz = chestZ(pt.ch, fr);
        const t = fr.world(0, cz - 0.1, 0, new THREE.Vector3());
        const facing = Math.atan2(t.x - c.pos.x, t.z - c.pos.y);
        const side = Math.abs(me.lx) > g.W / 2;
        st = { bed, kind: 'here', s: side ? s : 0, x: c.pos.x, z: c.pos.y, facing, rest: side ? restFor(bed, 'side', s, clamp(me.lz, -0.62, 0.12), facing) : atFoot ? restFor(bed, 'foot', 0, me.lz, facing) : null };
      }
    } else {
      // no bed under them (a stretcher in a corridor, a scanner table): just turn to them
      const facing = Math.atan2(pt.x - c.pos.x, pt.z - c.pos.y);
      st = { bed: { id: '', kind: 'stretcher', x: pt.x, z: pt.z, rot: pt.yaw, y: 0, level: pt.level, room: '' }, kind: 'here', s: 0, x: c.pos.x, z: c.pos.y, facing, rest: null };
    }
    this.pt = pt;
    this.st = st;
    this.still = 0;
    if (path) {
      c.path = path;
      this.stepPath = path;
      this.stepWait = 0;
      this.phase = 'step';
    } else {
      this.stepPath = null;
      this.held = this.d.mode() === 'first' ? c.yaw + Math.PI : c.facing;
      this.phase = 'turn';
    }
    // how far the resting hand needs the body to lean (once, from the pose as it stands)
    this.pose.restLean = 0;
    return true;
  }

  /** let go: the pose eases out, the body is yours again */
  private release() {
    if (this.phase === 'step' && this.d.controller().path === this.stepPath) this.d.controller().path = null;
    this.phase = 'off';
    this.stepPath = null;
    this.still = 0;
  }

  /** per frame, after the controller moved you (and before World applies the held facing) */
  update(dt: number) {
    const id = this.tablet ?? this.visitId;
    const c = this.d.controller();
    if (!id) {
      if (this.phase !== 'off') this.release();
      return;
    }
    const pt = this.d.patient(id);
    if (!pt || !(pt.lying || pt.sitting) || pt.level !== this.d.level()) {
      if (this.phase !== 'off') this.release();
      if (this.visitId && !pt) this.visitId = null;
      return;
    }
    // the patient moved (rolled out on a stretcher, got up): let go
    if (this.pt && this.phase !== 'off' && Math.hypot(pt.x - this.pt.x, pt.z - this.pt.z) > 0.3) this.release();
    // moving wins: the keys, a jump, a walk somewhere else (a click, tagging along), riding; once
    // posed, any movement at all (pushed by someone, carried off by a curtain's route)
    const foreign = !!c.path && c.path !== this.stepPath;
    if (c.steering || foreign || !c.grounded || c.ride || (c.moving && this.phase !== 'step')) {
      if (this.phase !== 'off') {
        this.release();
        // a visit ends when you walk off; the tablet's patient gets the pose back when you stop by the bed again
        this.visitId = null;
      }
      return;
    }
    if (this.phase === 'off') {
      if (c.moving) {
        this.still = 0;
        return;
      }
      this.still += dt;
      if (this.still > 0.4 && this.tablet === id) {
        const bed = pt.lying ? bedUnder(this.beds, pt.x, pt.z, pt.yaw, pt.level) : null;
        const near = bed ? this.nearBed(bed, c.pos.x, c.pos.y, 1.1) : Math.hypot(pt.x - c.pos.x, pt.z - c.pos.y) < 1.8;
        if (near) this.engage(id, false);
        else this.still = -1e9; // (out of reach: wait for a walk)
      }
      return;
    }
    if (this.phase === 'step') {
      // the path done (or stuck): turn to the patient from wherever that left you. A path held aside
      // (a curtain's hand on the way: curtains.ts) comes back: wait for it a little
      if (c.path) {
        this.stepWait = 0;
        return;
      }
      const there = !!this.st && Math.hypot(this.st.x - c.pos.x, this.st.z - c.pos.y) < 0.25;
      this.stepWait += dt;
      if (!there && this.stepWait < 2.5) return;
      this.stepPath = null;
      if (!there) this.engage(id, false);
      else {
        this.held = c.facing;
        this.phase = 'turn';
      }
      return;
    }
    // turning to the patient (a quarter turn in ~0.4 s), then holding it
    const st = this.st!;
    // a walk ends up to 12 cm short of its last point (controls.ts): settle onto the stance as you turn
    if (st.kind !== 'here') {
      const dx = st.x - c.pos.x;
      const dz = st.z - c.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > 0.005 && d < 0.3) {
        const k = Math.min(1, (dt * 0.7) / d);
        c.pos.x += dx * k;
        c.pos.y += dz * k;
      }
    }
    const d = wrap(st.facing - this.held);
    const step = Math.min(Math.abs(d), dt * (1.2 + Math.abs(d) * 4.2));
    this.held += Math.sign(d) * step;
    if (this.phase === 'turn' && Math.abs(wrap(st.facing - this.held)) < 0.02) {
      this.phase = 'on';
      // an exam that waited for the step along the bed
      if (this.examAfter) {
        this.pose.startExam(this.examAfter);
        this.examAfter = null;
      }
    }
  }

  private nearBed(bed: Bed, x: number, z: number, r: number): boolean {
    const g = geo(bed.kind);
    const l = new Frame(bed).local(x, z);
    return Math.abs(l.lx) < g.railOut + r && Math.abs(l.lz) < g.halfL + r;
  }

  /** the server view: a new exam finding for the patient you're with is an exam (its hand goes out) */
  view(view: PlayerView) {
    const agent = view.driver?.kind === 'agent';
    for (const [pid, list] of Object.entries(view.examFindings ?? {})) {
      const n = list.length;
      const was = this.seen.get(pid);
      this.seen.set(pid, n);
      if (was === undefined || n <= was || agent) continue;
      const m = list[n - 1].maneuver;
      if (this.pt?.patientId === pid && this.phase !== 'off') this.exam(m);
      else this.pending = { pid, maneuver: m, at: performance.now() };
    }
  }

  /** an exam on the patient you're with (tests; the view's new findings call it too) */
  exam(maneuver: string): boolean {
    const def = EXAM[maneuver];
    if (this.phase === 'off' || !def || !this.st || !this.pt) return false;
    // the legs from beside the chest (or the chest from down by the legs): a step along the bed first,
    // in third person and top-down (first person keeps the view); the hand goes out once you're there
    const st = this.st;
    if ((st.kind === 'side' || st.kind === 'here') && !st.sitting && st.bed.id && this.d.mode() !== 'first' && def.hold > 0) {
      const fr = new Frame(st.bed);
      // where along the bed to stand: the legs a little head-ward of the region, the belly at it, the rest at the chest
      const at = fr.local(...xz(regionPoint(def.region, this.pt.ch, fr, st.s || 1, 0, new THREE.Vector3()))).lz;
      const legs = def.region === 'shin' || def.region === 'ankle' || def.region === 'legs';
      const belly = def.region === 'abdomen' || def.region === 'ruq' || def.region === 'rlq' || def.region === 'llq' || def.region === 'flank';
      const want = legs ? at - 0.12 : belly ? at - 0.08 : clamp(chestZ(this.pt.ch, fr) + 0.06, -0.62, 0.12);
      const now = fr.local(this.d.controller().pos.x, this.d.controller().pos.y).lz;
      if (Math.abs(want - now) > 0.28 && this.engage(this.pt.id, true, legs || belly ? want : undefined, legs || belly ? at : undefined, legs)) {
        this.examAfter = maneuver;
        return true;
      }
    }
    return this.pose.startExam(maneuver);
  }
  private examAfter: string | null = null;
  /** tests: the stances passed over at the last engage, and why */
  private why: string[] = [];

  /**
   * Posed, the body steps in against the bed (STEP_IN; eased with the pose): the offset World adds to
   * the avatar's position. Never past where the stance would have stood it.
   */
  offset(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const st = this.st;
    const w = this.pose.w;
    if (!st || !st.bed.id || st.sitting || w < 0.001) return out;
    const g = geo(st.bed.kind);
    const fr = new Frame(st.bed);
    const c = this.d.controller();
    const me = fr.local(c.pos.x, c.pos.y);
    if (Math.abs(me.lx) > g.W / 2 && Math.abs(me.lz) < g.halfL) {
      const k = clamp(Math.abs(me.lx) - (g.railOut + STAND - STEP_IN), 0, STEP_IN);
      return fr.dir(-Math.sign(me.lx) * k * w, 0, out);
    }
    if (Math.abs(me.lx) < g.railOut && Math.abs(me.lz) > g.halfL) {
      const k = clamp(Math.abs(me.lz) - (g.halfL + STAND - STEP_IN), 0, STEP_IN);
      return fr.dir(0, -Math.sign(me.lz) * k * w, out);
    }
    return out;
  }

  /** after the avatar's animation, before the held-things pose (PlayerHands.apply): lean, look, hands */
  apply(dt: number) {
    const av = this.d.avatar();
    // an exam asked for before the pose was on (the tablet opened, the exam clicked at once)
    if (this.pending && this.phase === 'on' && this.pt?.patientId === this.pending.pid) {
      if (performance.now() - this.pending.at < 6000) this.exam(this.pending.maneuver);
      this.pending = null;
    }
    const on = this.phase === 'on' && !this.d.gesturing();
    const target = on ? 1 : 0;
    this.pose.w += (target - this.pose.w) * Math.min(1, dt * (target > this.pose.w ? 3.2 : 4.5));
    if (!av?.ready || !av.root.visible || !this.st || !this.pt) {
      // first person: the exam runs on (its hand is the first-person one: camera())
      this.pose.tick(dt);
      return;
    }
    if (this.pose.w < 0.002 && !this.pose.exam) return;
    const st = this.st;
    const hands = this.d.hands;
    this.pose.apply(dt, av.root, av.root.rotation.y, hands.scale, st, this.pt.ch, (side, target, quat, pole, w) => hands.reach(side, { target, quat, pole, weight: w }), this.d.busy(), av);
  }

  /** first person: an exam's hand comes into view to the region (the body isn't drawn); after the camera is placed */
  camera(camera: THREE.PerspectiveCamera, dt: number) {
    const e = this.pose.exam;
    const first = this.d.mode() === 'first';
    if (first && e && e.def.hold > 0 && this.st?.bed.id && this.pt && this.fpExam !== e) {
      this.fpExam = e;
      this.fp ??= new Reach(this.d.scene);
      const fr = new Frame(this.st.bed);
      const c = this.d.controller();
      const near = this.st.s || (fr.local(c.pos.x, c.pos.y).lx >= 0 ? 1 : -1);
      const p = regionPoint(e.def.region, this.pt.ch, fr, near, 0, new THREE.Vector3(), !!this.st.sitting);
      // the hand on the region's side of you; only within reach of a lean (the view bends in: below)
      const rel = wrap(Math.atan2(p.x - c.pos.x, p.z - c.pos.y) - (c.yaw + Math.PI));
      if (p.distanceTo(camera.position) < FP_LEAN + 0.95) this.fp.start(p, () => undefined, { arm: rel > 0.1 ? 'L' : 'R', hold: e.def.hold + 0.25 });
    }
    if (!this.fp) return;
    if (e && this.fpExam === e && this.st && this.pt) {
      const fr = new Frame(this.st.bed);
      const c = this.d.controller();
      const near = this.st.s || (fr.local(c.pos.x, c.pos.y).lx >= 0 ? 1 : -1);
      const p = regionPoint(e.def.region, this.pt.ch, fr, near, e.def.motion ? e.t * 1.6 : 0, new THREE.Vector3(), !!this.st.sitting);
      this.fp.retarget(p);
      // the view leans in over the patient as the hand goes out (a body can't reach a chest a metre off upright)
      if (first && this.fp.active) {
        const d = p.distanceTo(camera.position);
        camera.position.addScaledVector(p.sub(camera.position).normalize(), Math.min(FP_LEAN, Math.max(0, d - 0.85)) * this.fp.weight());
      }
    }
    this.fp.update(dt);
    this.fp.applyCamera(camera, first && this.fp.active);
  }
  private fp: Reach | null = null;
  private fpExam: Exam | null = null;

  /** tests: the stance, the facing against the bearing to the patient, the resting palm against the rail's top */
  debug() {
    const c = this.d.controller();
    const st = this.st;
    const pt = this.pt;
    const deg = (r: number) => Math.round((wrap(r) * 180) / Math.PI);
    if (!st || !pt) return { phase: this.phase, tablet: this.tablet, visit: this.visitId };
    const fr = new Frame(st.bed);
    const chest = regionPoint('chest', pt.ch, fr, st.s || 1, 0, new THREE.Vector3(), !!st.sitting);
    const bearing = Math.atan2(chest.x - c.pos.x, chest.z - c.pos.y);
    let rail: unknown = null;
    if (st.rest) {
      const g = geo(st.bed.kind);
      const palm = this.d.hands.palm(st.rest.side, new THREE.Vector3()) ?? new THREE.Vector3(NaN, NaN, NaN);
      const l = Number.isNaN(palm.x) ? null : fr.local(palm.x, palm.z);
      // the nearest point of the rail's top (or the board's) to the palm
      const top = l ? fr.world(st.rest.lx, st.rest.along === 'rail' ? clamp(l.lz, st.rest.span[0] - 0.06, st.rest.span[1] + 0.06) : st.rest.lz, st.rest.ly, new THREE.Vector3()) : null;
      rail = { side: st.rest.side, along: st.rest.along, palm: Number.isNaN(palm.x) ? null : palm.toArray().map((v) => +v.toFixed(3)), top: top?.toArray().map((v) => +v.toFixed(3)) ?? null, gap: top ? +palm.distanceTo(top).toFixed(3) : null, height: top ? +(palm.y - top.y).toFixed(3) : null };
    }
    return {
      phase: this.phase,
      tablet: this.tablet,
      visit: this.visitId,
      patient: pt.id,
      bed: st.bed.id,
      kind: st.kind,
      side: st.s,
      stance: [+st.x.toFixed(3), +st.z.toFixed(3)],
      at: [+c.pos.x.toFixed(3), +c.pos.y.toFixed(3)],
      facing: deg(c.facing),
      bearing: deg(bearing),
      off: Math.abs(deg(c.facing - bearing)),
      w: +this.pose.w.toFixed(2),
      lean: +((this.pose.lean * 180) / Math.PI).toFixed(1),
      restK: +this.pose.restK.toFixed(2),
      passedOver: this.why,
      /** first person: an exam's hand in view (and where it is drawn) */
      fpHand: !!this.fp?.active,
      fpHandAt: this.fp?.shownAt()?.toArray().map((v) => +v.toFixed(3)) ?? null,
      rail,
      exam: this.pose.exam ? { maneuver: this.pose.exam.maneuver, t: +this.pose.exam.t.toFixed(2), side: this.pose.exam.side, w: +examWeight(this.pose.exam).toFixed(2), lean: +((this.pose.exam.lean * 180) / Math.PI).toFixed(1), gap: this.examGap() } : null,
    };
  }

  /** tests: where the bedside pose aims on a patient in bed (world m): the gaze's face, the chest, an exam's points */
  targets(id: string): Record<string, number[]> | null {
    const pt = this.d.patient(id);
    const bed = pt?.lying ? bedUnder(this.beds, pt.x, pt.z, pt.yaw, pt.level) : null;
    if (!pt || !bed) return null;
    const fr = new Frame(bed);
    const out: Record<string, number[]> = {};
    for (const r of ['face', 'eyes', 'chest', 'heart', 'abdomen', 'rlq', 'neck', 'ankle'] as Region[]) out[r] = regionPoint(r, pt.ch, fr, 1, 0, new THREE.Vector3()).toArray().map((v) => +v.toFixed(3));
    return out;
  }

  /** tests: how far the exam's hand (its palm, or the stethoscope's chest piece) is from the point examined (m) */
  private examGap(): number | null {
    const av = this.d.avatar();
    const e = this.pose.exam;
    if (!av?.ready || !e?.side || e.def.hold <= 0) return null;
    const hand = bonesOf(av.root)[`${e.side}_Hand`];
    if (!hand) return null;
    hand.updateWorldMatrix(true, false);
    const off = e.def.motion === 'steth' ? new THREE.Vector3(0.1, 0.05, 0) : new THREE.Vector3(0.085, 0.01, 0);
    const p = hand.getWorldPosition(new THREE.Vector3()).add(off.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(this.d.hands.scale));
    return +p.distanceTo(this.pose.examPoint).toFixed(3);
  }

  /**
   * Tests: the player's skinned surface (CPU-skinned) against the bed (mattress, rails, boards), the
   * patient lying in it, and drawn curtains: the deepest a vertex goes into each (m; < 0 = into it).
   * The resting palm's contact with its rail and an exam hand's with the patient are allowed.
   */
  clearance() {
    const av = this.d.avatar();
    const st = this.st;
    if (!av?.ready || !st) return null;
    const g = geo(st.bed.kind);
    const fr = new Frame(st.bed);
    av.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const worst: Record<string, { gap: number; bone: string }> = {};
    const note = (k: string, gap: number, bone: string) => {
      if (!worst[k] || gap < worst[k].gap) worst[k] = { gap: +gap.toFixed(3), bone };
    };
    const restHand = st.rest && this.pose.w > 0.5 ? st.rest.side : null;
    const examHand = this.pose.exam?.side ?? null;
    const curtains = this.d.curtainBoxes?.() ?? [];
    // the backrest up (bedRig.ts): the mattress and the patient on it measured as on the flat bed, the patient
    // by their own skin (sitting up, the arms on the belly: nothing lies along the mattress's edges any more)
    const bend = (this.pt?.ch as Partial<AvatarCharacter> | undefined)?.bed?.rig.bend ?? null;
    const flat = [0, 0];
    const skinTop = bend && bend.head > 0.05 && this.pt ? patientTops(this.pt.ch.root, fr, st.bed.y, bend) : null;
    let n = 0;
    av.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      m.skeleton.update();
      const pos = m.geometry.getAttribute('position');
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      for (let i = 0; i < pos.count; i += 3) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        n++;
        let bone = '';
        let bw = -1;
        for (let j = 0; j < 4; j++)
          if (sw.getComponent(i, j) > bw) {
            bw = sw.getComponent(i, j);
            bone = m.skeleton.bones[si.getComponent(i, j)]?.name ?? '';
          }
        const hand = /_(L|R)_(Hand|Finger)/.exec(bone)?.[1] as HandSide | undefined;
        // (an exam's forearm may rest on the patient too)
        const exArm = examHand && new RegExp(`_${examHand}_(Hand|Finger|Forearm)`).test(bone);
        const l = fr.local(v.x, v.z);
        const y = v.y - st.bed.y;
        // the mattress (and the patient's body on it, up to 0.24 m over it)
        if (bend) bend.unmap(y, l.lz, flat);
        const fy = bend ? flat[0] : y;
        const fz = bend ? flat[1] : l.lz;
        const inX = g.hw - Math.abs(l.lx);
        const inZ = g.zFoot - Math.abs(fz);
        const over = skinTop ? Math.max(0, (skinTop.at(l.lx, fz) ?? -1) + 0.005) : 0.07 + 0.17 * clamp((g.hw - Math.abs(l.lx)) / 0.2, 0, 1);
        if (!st.sitting && inX > 0 && inZ > 0 && fy < g.top + over && fy > 0.45) {
          const depth = Math.min(inX, inZ, g.top + over - fy);
          if (!exArm) note(fy < g.top ? 'mattress' : 'patient', -depth, bone);
        }
        // the side rails (head section; the bed's foot section too)
        for (const s of [-1, 1]) {
          const dx = 0.015 + 0.004 - Math.abs(l.lx - s * g.railX);
          const spans: [number, number, number][] = [[-0.87, 0.03, g.railTop]];
          if (st.bed.kind === 'bed') spans.push([0.21, 0.83, 0.86]);
          for (const [z0, z1, top] of spans) {
            const dz = Math.min(l.lz - z0, z1 - l.lz);
            const dy = Math.min(y - 0.66, top - y);
            if (dx > 0 && dz > 0 && dy > 0) {
              const depth = Math.min(dx, dz, dy);
              note(hand && hand === restHand ? 'restHandOnRail' : 'rails', -depth, bone);
            }
          }
        }
        // head- and footboard (bed) / push handle at the foot (stretcher)
        if (Math.abs(l.lx) < g.W / 2 && y > 0.44 && y < (st.bed.kind === 'bed' ? 0.8 : 0.95) && (st.bed.kind === 'bed' || l.lz > 0)) {
          const dz = 0.035 - Math.abs(Math.abs(l.lz) - g.footZ);
          if (dz > 0 && !(hand && hand === restHand && st.rest?.along === 'board')) note('boards', -dz, bone);
        }
        for (const cb of curtains) if (cb.containsPoint(v)) note('curtains', -Math.min(v.x - cb.min.x, cb.max.x - v.x, v.z - cb.min.z, cb.max.z - v.z), bone);
      }
    });
    return { vertices: n, worst };
  }

  dispose() {
    this.pose.dispose();
    this.fp?.dispose(this.d.scene);
  }
}

// ───────────────────────────── an AI doctor's body at a bedside ─────────────────────────────

/** the slice of World's NPC state this reads */
/** an NPC posed at a bedside: its pose, its spot (`since`: s since the spot was last re-derived) */
interface NpcLive {
  pose: Pose;
  st: Stance;
  pt: string;
  av: AvatarCharacter;
  fn: (a: AvatarCharacter, dt: number) => void;
  since: number;
}

export interface CareNpc {
  v: { id: string; location: string; spot: string };
  ch: Character;
  pos: THREE.Vector2;
  yaw: number;
  path: unknown;
}

/**
 * An NPC (the AI doctor in observe mode) at a bedside spot: World sends it to `stanceFor` (its NPC
 * destination); once there and still, this turns it to the patient and poses it on its animation
 * frames (AvatarCharacter.postPose: lean, look, a hand on the rail, an exam's hand).
 */
export class NpcCare {
  private live = new Map<string, NpcLive>();
  private queued = new Map<string, { maneuver: string; until: number }>();
  private seen = new Map<string, number>();

  constructor(
    private beds: Bed[],
    private scene: THREE.Scene,
  ) {}

  /** per frame for a care-capable NPC (`settled`: arrived, or stopped at the end of its walk): true while it stands posed at a bed */
  step(n: CareNpc, patient: CarePatient | null, dt: number, settled = !n.path): boolean {
    const av = n.ch as AvatarCharacter;
    // (the procedural stand-in body has no skeleton to pose)
    if (typeof av.attach !== 'function' || !('ready' in av)) return false;
    let L = this.live.get(n.v.id);
    let at: Stance | null = null;
    if (settled && n.ch.posture === 'stand' && patient) {
      // lying: at its stance by the bed (World sends it there); sitting on the edge: where it stands, turned to them
      if (patient.lying) at = stanceFor(this.beds, null, n.pos.x, n.pos.y, patient.level);
      else if (patient.sitting && Math.hypot(patient.x - n.pos.x, patient.z - n.pos.y) < 2.2) at = { ...frontStances(patient, bedNear(this.beds, patient.x, patient.z, patient.level))[0], kind: 'here', x: n.pos.x, z: n.pos.y, facing: Math.atan2(patient.x - n.pos.x, patient.z - n.pos.y) };
    }
    if (!at || !patient || Math.hypot(at.x - n.pos.x, at.z - n.pos.y) > 0.6 || (L && L.pt !== patient.id)) {
      // walking off: the pose eases out over a few frames, then the mocap is all there is
      if (L) {
        L.pose.exam = null;
        L.pose.w = Math.max(0, L.pose.w - dt * 5);
        if (L.pose.w <= 0) {
          if (av.postPose === L.fn) av.postPose = undefined;
          L.pose.dispose();
          this.live.delete(n.v.id);
        }
      }
      return false;
    }
    if (!L) {
      const pose = new Pose(this.scene);
      pose.lookOnly = true;
      const st = at.sitting ? at : stanceAt(at.bed, at.kind === 'here' ? 'side' : (at.kind as 'side' | 'foot' | 'head'), at.s, patient.ch, undefined, true);
      const arms: Partial<Record<HandSide, ArmBones | null>> = {};
      const pc = patient.ch;
      const rec: NpcLive = { pose, st, pt: patient.id, av, fn: () => undefined, since: 0 };
      rec.fn = (a: AvatarCharacter, adt: number) =>
        pose.apply(adt, a.root, a.root.rotation.y, a.height / 1.78, rec.st, pc, (side, target, quat, pole, w) => {
          const arm = (arms[side] ??= armBones(a.root, side));
          if (arm) reachArm(arm, target, pole, w, quat);
        }, { R: false, L: false }, a);
      L = rec;
      this.live.set(n.v.id, L);
      av.postPose = rec.fn;
    } else if (!L.st.sitting && (L.since += dt) > 0.25) {
      // the spot follows the patient's chest: a body just laid down still has the bones it had standing
      // (its animation catches up a frame or more later), and people shift in bed
      L.since = 0;
      L.st = stanceAt(L.st.bed, L.st.kind as 'side' | 'foot' | 'head', L.st.s, patient.ch, undefined, true);
    }
    // turned to the patient (the spot's own facing is the room's, not the patient's)
    n.yaw = lerpAngle(n.yaw, L.st.facing, Math.min(1, dt * 4));
    // and up to the bed: its route ends a little short of the spot (the nav grid keeps a body's
    // radius off the bed), the last bit a slow shuffle in, as the player's settle (BedsideCare.update)
    if (!L.st.sitting) {
      const dx = L.st.x - n.pos.x;
      const dz = L.st.z - n.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const k = Math.min(1, (0.6 * dt) / d);
        n.pos.x += dx * k;
        n.pos.y += dz * k;
      }
    }
    L.pose.w = Math.min(1, L.pose.w + dt * 2.5);
    const q = this.queued.get(n.v.id);
    if (q && L.pose.w > 0.6) {
      this.queued.delete(n.v.id);
      if (performance.now() < q.until) L.pose.startExam(q.maneuver);
    }
    return true;
  }

  /** the server view (observe mode): the AI doctor's exams, posed when it is at that patient's bed */
  view(view: PlayerView, doctorId: string, patientOf: (pid: string) => string | null) {
    if (view.driver?.kind !== 'agent') return;
    for (const [pid, list] of Object.entries(view.examFindings ?? {})) {
      const n = list.length;
      const was = this.seen.get(pid);
      this.seen.set(pid, n);
      if (was === undefined || n <= was) continue;
      const npc = patientOf(pid);
      const L = this.live.get(doctorId);
      if (L && npc === L.pt && L.pose.w > 0.6) L.pose.startExam(list[n - 1].maneuver);
      // (still walking there: when it has arrived)
      else this.queued.set(doctorId, { maneuver: list[n - 1].maneuver, until: performance.now() + 9000 });
    }
  }

  /** tests: an exam by a posed NPC (the AI doctor's come from the server view) */
  exam(id: string, maneuver: string): boolean {
    const L = this.live.get(id);
    return !!L && L.pose.w > 0.6 && L.pose.startExam(maneuver);
  }

  debug(id: string) {
    const L = this.live.get(id);
    if (!L) return null;
    // the exam hand's palm (or chest piece) to the point examined (m), while it is out
    const e = L.pose.exam;
    let gap: number | null = null;
    let reach = 0;
    const hand = e?.side && e.def.hold > 0 && L.av.ready ? bonesOf(L.av.root)[`${e.side}_Hand`] : undefined;
    if (e && hand) {
      reach = +examWeight(e).toFixed(2);
      hand.updateWorldMatrix(true, false);
      const off = e.def.motion === 'steth' ? new THREE.Vector3(0.1, 0.05, 0) : new THREE.Vector3(0.085, 0.01, 0);
      const p = hand.getWorldPosition(new THREE.Vector3()).add(off.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(L.av.height / 1.78));
      gap = +p.distanceTo(L.pose.examPoint).toFixed(3);
    }
    const r = L.av.root.position;
    return { patient: L.pt, bed: L.st.bed.id, kind: L.st.kind, w: +L.pose.w.toFixed(2), exam: e?.maneuver ?? null, far: !!e?.far, short: e?.short === undefined ? null : +e.short.toFixed(3), examW: reach, gap, facing: Math.round((L.st.facing * 180) / Math.PI), stance: [+L.st.x.toFixed(3), +L.st.z.toFixed(3)], at: [+r.x.toFixed(3), +r.z.toFixed(3)], lean: +((L.pose.lean * 180) / Math.PI).toFixed(1) };
  }

  dispose() {
    for (const L of this.live.values()) L.pose.dispose();
    this.live.clear();
  }
}

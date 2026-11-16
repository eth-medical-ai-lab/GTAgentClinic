/**
 * The player's hands in third person: what each hand holds, and the arm pose that goes with it.
 *
 * Things are mounted on a grip in the palm of the Rocketbox hand bone (8–9 cm along the fingers
 * from the wrist joint, just off the palm), so they move with the hand instead of floating at the
 * wrist. Arms are posed after the mocap with a two-bone IK (upper arm + forearm) plus a hand
 * orientation, eased in and out:
 *   - hand-sized things: elbow bent, the hand in front at waist height (how you carry a coffee)
 *   - long things (a clipboard, a binder): held at the side, the arm a little away from the leg
 *   - two-handed things (a tray): carried in front in both hands
 *   - others (amenities.ts: brewing, sipping, rubbing hands) can ask for any reach for one frame
 *     with `reach()`; it wins over the carry pose
 * Cups and cans stay level whatever the hand does (but a sip tips them: `tilt()`), and a hand
 * holding one closes round it; bags hang from the hand. For a sip, `lowerLip()` is where the rim
 * goes (the face rig's bottom-lip bone) and `settleHead()` turns the face to the cup.
 *
 * Rocketbox (3ds Max biped) hands: X along the fingers, Y out of the palm, Z toward the thumb
 * (left hand: −Z); see accessories.ts. Grip offsets are in the grip's frame, i.e. metres scaled
 * with the avatar; held things are scaled back to their real size.
 */
import * as THREE from 'three';
import type { AvatarCharacter } from './avatars';

export type HandSide = 'R' | 'L';
/**
 * how a thing is held: can = gripped round its middle, longest axis toward the thumb; flat = like a
 * phone, longest axis along the fingers; side = a long thing hanging at the side; upright = a drink,
 * always level; bag = hangs from the hand by its handle; both = carried in front in both hands
 */
export type GripStyle = 'can' | 'flat' | 'side' | 'upright' | 'bag' | 'both';

export interface ArmGoal {
  /** where the wrist (hand bone origin) should be, world metres */
  target: THREE.Vector3;
  /** world orientation for the hand bone (see handQuat) */
  quat?: THREE.Quaternion;
  /** world point the elbow should bend toward */
  pole?: THREE.Vector3;
  /** 0..1 (default 1) */
  weight?: number;
}

interface Arm {
  side: HandSide;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  grip: THREE.Group;
  /** this frame's request (cleared after apply) */
  goal: ArmGoal | null;
  /**
   * the last goal used, for easing out: in the body's frame (the avatar root's), so an arm letting go
   * as you walk off stays where it was relative to you (in the world it fell behind: the hand was
   * pulled back behind the body)
   */
  last: { target: THREE.Vector3; quat: THREE.Quaternion; hasQuat: boolean; pole: THREE.Vector3; hasPole: boolean };
  /** the fingers asked for with the last goal (eased out with the arm), or none */
  lastFingers: { flex: number; thumb: number } | null;
  /** the carry pose, reused every frame */
  carry: { target: THREE.Vector3; quat: THREE.Quaternion; pole: THREE.Vector3; weight: number };
  w: number;
  /** a hanging arm held a little away from the leg (side/bag styles), eased 0..1 */
  abduct: number;
}

interface Mounted {
  obj: THREE.Object3D;
  side: HandSide | 'both';
  style: GripStyle;
  /** the thing's bounding box size and centre in its own frame (metres, scale 1) */
  size: THREE.Vector3;
  center: THREE.Vector3;
  /** extra yaw for upright/bag things (radians about world up) */
  yaw: number;
  /** upright things: tipped toward the face by this much (radians), e.g. a sip */
  tilt: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** extra flexion (rad) of each finger's three joints round a cup, and of the thumb's */
const FINGER_CURL = [0.42, 0.55, 0.3];
const THUMB_CURL = [0, 0.18, 0.15];

// scratch (never held across calls)
const t1 = new THREE.Vector3();
const t2 = new THREE.Vector3();
const t3 = new THREE.Vector3();
const t4 = new THREE.Vector3();
const t5 = new THREE.Vector3();
const t6 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

/** rotate a bone so that a world direction `from` (unit) turns toward `to` (unit), by weight w */
function turnBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
  if (!bone.parent) return;
  q1.setFromUnitVectors(from, to);
  if (w < 1) q1.copy(q3.identity().slerp(q1, w));
  bone.parent.getWorldQuaternion(q2);
  // world delta → the bone's parent frame: P⁻¹·Δ·P
  q3.copy(q2).invert().multiply(q1).multiply(q2);
  bone.quaternion.premultiply(q3);
}

/** set a bone's world orientation, blended by w */
function orientBone(bone: THREE.Object3D, q: THREE.Quaternion, w: number) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(q2);
  q3.copy(q2).invert().multiply(q);
  bone.quaternion.slerp(q3, w);
}

/** world orientation of a hand bone from where its fingers and thumb should point */
export function handQuat(side: HandSide, fingers: THREE.Vector3, thumb: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const x = t4.copy(fingers).normalize();
  const z = t5.copy(thumb).multiplyScalar(side === 'R' ? 1 : -1);
  const y = t6.crossVectors(z, x).normalize();
  z.crossVectors(x, y).normalize();
  m1.makeBasis(x, y, z);
  return out.setFromRotationMatrix(m1);
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

/** a Rocketbox arm: upper arm, forearm and hand bones (null until the model is in) */
export interface ArmBones {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
}

export function armBones(root: THREE.Object3D, side: HandSide): ArmBones | null {
  const upper = findBone(root, new RegExp(`_${side}_UpperArm$`));
  const fore = findBone(root, new RegExp(`_${side}_Forearm$`));
  const hand = findBone(root, new RegExp(`_${side}_Hand$`));
  return upper && fore && hand ? { upper, fore, hand } : null;
}

/**
 * Two-bone IK after the animation: bend the elbow toward `pole` and put the wrist at `target`
 * (world), then turn the hand to `quat` if given; all blended by w. Call once per animation update
 * (the turns are relative to the pose the mixer just set).
 */
export function reachArm(arm: ArmBones, target: THREE.Vector3, pole: THREE.Vector3, w: number, quat?: THREE.Quaternion) {
  solveTwoBone(arm.upper, arm.fore, arm.hand, target, pole, w);
  if (quat) {
    orientBone(arm.hand, quat, w);
    arm.hand.updateMatrixWorld(true);
  }
}

function solveTwoBone(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = fore.getWorldPosition(t1);
  const W = hand.getWorldPosition(t2);
  const a = S.distanceTo(E);
  const b = E.distanceTo(W);
  const dir = t3.copy(target).sub(S);
  const d = clamp(dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  dir.normalize();
  const pd = t4.copy(pole).sub(S);
  pd.addScaledVector(dir, -pd.dot(dir));
  if (pd.lengthSq() < 1e-8) pd.set(0, -1, 0);
  pd.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const elbow = t5.copy(S).addScaledVector(dir, a * cosA).addScaledVector(pd, a * sinA);
  turnBone(upper, t6.copy(E).sub(S).normalize(), elbow.sub(S).normalize(), w);
  upper.updateMatrixWorld(true);
  const E2 = fore.getWorldPosition(t1);
  const W2 = hand.getWorldPosition(t2);
  const reach = t5.copy(S).addScaledVector(dir, d);
  turnBone(fore, t6.copy(W2).sub(E2).normalize(), reach.sub(E2).normalize(), w);
  fore.updateMatrixWorld(true);
}

/** item axes → grip axes for a box of `size`: can = longest toward the thumb; flat/side = longest along the fingers */
function gripRotation(side: HandSide, size: THREE.Vector3, style: GripStyle): THREE.Quaternion {
  const order = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const [big, mid, small] = order;
  const thumb = new THREE.Vector3(0, 0, side === 'R' ? 1 : -1);
  const fingers = new THREE.Vector3(1, 0, 0);
  const palm = new THREE.Vector3(0, 1, 0);
  const img: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  img[big] = style === 'can' ? thumb : fingers;
  img[mid] = style === 'can' ? fingers : thumb;
  img[small] = palm;
  const m = new THREE.Matrix4().makeBasis(img[0], img[1], img[2]);
  // a mirror would turn the thing inside out: flip the middle axis instead
  if (m.determinant() < 0) {
    img[mid].negate();
    m.makeBasis(img[0], img[1], img[2]);
  }
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export class PlayerHands {
  private arms: Record<HandSide, Arm> | null = null;
  private mounted = new Map<THREE.Object3D, Mounted>();
  /** world scale of the grips (the avatar's model scale) */
  private ms = 1;
  /** body size relative to a 1.78 m adult */
  private k = 1;
  /** seated: no carry pose (the arms rest unless something asks) */
  seated = false;

  constructor(private avatar: () => AvatarCharacter | null) {}

  /** true once the rigged avatar is in (bones found, grips on the hands) */
  ready(): boolean {
    if (this.arms) return true;
    const av = this.avatar();
    if (!av || !av.ready) return false;
    const root = av.root;
    const arm = (s: HandSide): Arm | null => {
      const upper = findBone(root, new RegExp(`_${s}_UpperArm$`));
      const fore = findBone(root, new RegExp(`_${s}_Forearm$`));
      const hand = findBone(root, new RegExp(`_${s}_Hand$`));
      if (!upper || !fore || !hand) return null;
      const grip = new THREE.Group();
      grip.name = `grip:${s}`;
      av.attach(grip, s === 'R' ? 'handR' : 'handL');
      return {
        side: s,
        upper,
        fore,
        hand,
        grip,
        goal: null,
        last: { target: new THREE.Vector3(), quat: new THREE.Quaternion(), hasQuat: false, pole: new THREE.Vector3(), hasPole: false },
        lastFingers: null,
        carry: { target: new THREE.Vector3(), quat: new THREE.Quaternion(), pole: new THREE.Vector3(), weight: 1 },
        w: 0,
        abduct: 0,
      };
    };
    const R = arm('R');
    const L = arm('L');
    if (!R || !L) return false;
    this.arms = { R, L };
    root.updateMatrixWorld(true);
    this.ms = R.grip.getWorldScale(t1).x || 1;
    this.k = av.height / 1.78;
    return true;
  }

  /** the body's frame: feet position, forward and right (world, horizontal), and its size factor */
  body(o: THREE.Vector3, f: THREE.Vector3, r: THREE.Vector3): { yaw: number; k: number } {
    const av = this.avatar();
    const yaw = av ? av.root.rotation.y : 0;
    if (av) o.copy(av.root.position);
    f.set(Math.sin(yaw), 0, Math.cos(yaw));
    r.set(-Math.cos(yaw), 0, Math.sin(yaw));
    return { yaw, k: this.k };
  }

  /** world position of a shoulder joint (upper-arm bone), null before the avatar is in */
  shoulder(side: HandSide, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.ready()) return null;
    return this.arms![side].upper.getWorldPosition(out);
  }

  /** how far an arm reaches, shoulder to wrist (upper arm + forearm, world m); null before the avatar is in */
  armReach(side: HandSide): number | null {
    if (!this.ready()) return null;
    const a = this.arms![side];
    const S = a.upper.getWorldPosition(new THREE.Vector3());
    const E = a.fore.getWorldPosition(new THREE.Vector3());
    return S.distanceTo(E) + E.distanceTo(a.hand.getWorldPosition(new THREE.Vector3()));
  }

  /** world position of the grip point in a palm, where a held cup's side touches */
  palm(side: HandSide, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.ready()) return null;
    return this.arms![side].grip.localToWorld(out.set(0.085, 0.01, 0));
  }

  /** world position of the head bone (sipping), null before the avatar is in */
  head(out: THREE.Vector3): THREE.Vector3 | null {
    const av = this.avatar();
    if (!av || !av.ready) return null;
    return av.head.getWorldPosition(out);
  }

  /** the grips' world scale: metres in a grip's frame are this many world metres */
  get scale(): number {
    return this.ms;
  }

  /**
   * A point on the face, world: (up, forward) metres from the head bone in the head's own frame,
   * scaled with the avatar. Rocketbox head bones: X up the head, Y out of the face, Z to the left
   * (accessories.ts TO_BONE). The adult heads' lips are at about (0.02, 0.121), the chin at (0, 0.118),
   * the nose tip at (0.08, 0.132) (accessories.ts MASK_DRAPE). `fwd` and `up` get the face's axes.
   */
  facePoint(up: number, forward: number, out: THREE.Vector3, fwd?: THREE.Vector3, upAxis?: THREE.Vector3): THREE.Vector3 | null {
    const av = this.avatar();
    if (!av || !av.ready) return null;
    const head = av.head;
    head.updateWorldMatrix(true, false);
    head.getWorldQuaternion(q1);
    head.getWorldPosition(out);
    const s = this.ready() ? this.ms : av.height / 1.78;
    const u = t1.set(1, 0, 0).applyQuaternion(q1);
    const f = t2.set(0, 1, 0).applyQuaternion(q1);
    out.addScaledVector(u, up * s).addScaledVector(f, forward * s);
    fwd?.copy(f);
    upAxis?.copy(u);
    return out;
  }

  /**
   * Where a cup's rim rests on the lower lip, world: in front of the Rocketbox face rig's bottom-lip
   * bone (on the lip's outer surface); a fixed point in front of the head bone on a model without one.
   * `fwd` gets the face's forward axis.
   */
  lowerLip(out: THREE.Vector3, fwd?: THREE.Vector3): THREE.Vector3 | null {
    const av = this.avatar();
    if (!av || !av.ready) return null;
    this.face ??= { lip: findBone(av.root, /_MBottomLip$/) ?? null, eyes: [findBone(av.root, /_LEye$/), findBone(av.root, /_REye$/)].filter((b): b is THREE.Object3D => !!b) };
    const lip = this.face.lip;
    if (!lip) return this.facePoint(0.011, 0.125, out, fwd);
    const f = t4;
    this.facePoint(0, 0, t6, f);
    lip.updateWorldMatrix(true, false);
    lip.getWorldPosition(out).addScaledVector(f, 0.006 * (this.ready() ? this.ms : 1));
    fwd?.copy(f);
    return out;
  }

  /** the point between the eyes (the face rig's eye bones), world; null without them */
  eyes(out: THREE.Vector3): THREE.Vector3 | null {
    const av = this.avatar();
    if (!av || !av.ready) return null;
    this.face ??= { lip: findBone(av.root, /_MBottomLip$/) ?? null, eyes: [findBone(av.root, /_LEye$/), findBone(av.root, /_REye$/)].filter((b): b is THREE.Object3D => !!b) };
    const e = this.face.eyes;
    if (e.length < 2) return null;
    e[0].updateWorldMatrix(true, false);
    e[1].updateWorldMatrix(true, false);
    return out.copy(e[0].getWorldPosition(t5)).add(e[1].getWorldPosition(t6)).multiplyScalar(0.5);
  }
  private face: { lip: THREE.Object3D | null; eyes: THREE.Object3D[] } | undefined;

  /** the extra yaw an upright thing was mounted with (radians, relative to the body) */
  mountYaw(obj: THREE.Object3D): number {
    return this.mounted.get(obj)?.yaw ?? 0;
  }

  /**
   * For this frame: turn the face toward the body's front and pitch it to `pitch` (radians, + = face
   * up), by weight w (0 = as the animation has it), neck and head sharing the turn (a sip: you face
   * the cup, and tip your head back for the last of it). Call after the avatar's animation update;
   * the mixer sets the bones again next frame.
   */
  settleHead(w: number, pitch: number) {
    const av = this.avatar();
    if (!av || !av.ready || w < 1e-3) return;
    this.neck ??= findBone(av.root, /_Neck$/) ?? null;
    const yaw = av.root.rotation.y;
    av.head.updateWorldMatrix(true, false);
    const f = t1.set(0, 1, 0).applyQuaternion(av.head.getWorldQuaternion(q1));
    let dy = yaw - Math.atan2(f.x, f.z);
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - Math.asin(clamp(f.y, -1, 1));
    // about world up, then about the body's right axis (a positive turn lifts the face)
    const r = t3.set(-Math.cos(yaw), 0, Math.sin(yaw));
    for (const [bone, k] of [[this.neck, 0.4], [av.head, 0.6]] as [THREE.Object3D | null, number][]) {
      if (!bone?.parent) continue;
      bone.parent.updateWorldMatrix(true, false);
      q1.setFromAxisAngle(UP, dy * w * k).premultiply(q2.setFromAxisAngle(r, dp * w * k));
      bone.parent.getWorldQuaternion(q2);
      q3.copy(q2).invert().multiply(q1).multiply(q2);
      bone.quaternion.premultiply(q3);
      bone.updateMatrixWorld(true);
    }
  }
  private neck: THREE.Object3D | null | undefined;

  /**
   * For this frame: bend the spine forward by `angle` (radians, the chest toward the body's front),
   * shared over its three bones (hand hygiene: leaning over a sink, reaching up to a dispenser). Call
   * after the avatar's animation update and before `apply`, so the arms reach from where the
   * shoulders are now; the mixer sets the bones again next frame.
   */
  lean(angle: number) {
    const av = this.avatar();
    if (!av || !av.ready || Math.abs(angle) < 1e-4) return;
    this.spine ??= [/_Spine$/, /_Spine1$/, /_Spine2$/].map((re) => findBone(av.root, re)).filter((b): b is THREE.Object3D => !!b);
    if (!this.spine.length) return;
    const yaw = av.root.rotation.y;
    // about up × forward: a positive turn tips the top of the spine forward
    const axis = t1.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const per = angle / this.spine.length;
    for (const bone of this.spine) {
      if (!bone.parent) continue;
      bone.parent.updateWorldMatrix(true, false);
      q1.setFromAxisAngle(axis, per);
      bone.parent.getWorldQuaternion(q2);
      q3.copy(q2).invert().multiply(q1).multiply(q2);
      bone.quaternion.premultiply(q3);
      bone.updateMatrixWorld(true);
    }
  }
  private spine: THREE.Object3D[] | undefined;

  /** for this frame only: put a hand somewhere (wins over the carry pose) */
  reach(side: HandSide, goal: ArmGoal | null) {
    if (this.ready()) this.arms![side].goal = goal;
  }

  /**
   * For this frame only: flex the fingers by `flex` times a cup grip (negative straightens the
   * mocap's relaxed, half-open hand: flat palms for rubbing them together), the thumb by `thumb`
   * (hygiene.ts). Applied after the arm's pose.
   */
  fingers(side: HandSide, flex: number, thumb = flex) {
    this.fingerGoal[side] = { flex, thumb };
  }
  private fingerGoal: Partial<Record<HandSide, { flex: number; thumb: number }>> = {};

  /** the hand bone's world position (the wrist) and orientation (handQuat's frame); false before the avatar is in */
  handFrame(side: HandSide, pos: THREE.Vector3, quat?: THREE.Quaternion): boolean {
    if (!this.ready()) return false;
    const h = this.arms![side].hand;
    h.updateWorldMatrix(true, false);
    h.getWorldPosition(pos);
    if (quat) h.getWorldQuaternion(quat);
    return true;
  }

  /** the elbow joint (forearm bone) as drawn, world; false before the avatar is in */
  elbow(side: HandSide, out: THREE.Vector3): boolean {
    if (!this.ready()) return false;
    const f = this.arms![side].fore;
    f.updateWorldMatrix(true, false);
    f.getWorldPosition(out);
    return true;
  }

  /** the carry pose for a hand-sized thing: elbow bent, the hand in front at waist height */
  carryGoal(side: HandSide): ArmGoal | null {
    if (!this.ready()) return null;
    const arm = this.arms![side];
    const S = arm.upper.getWorldPosition(t1);
    const f = t2;
    const r = t3;
    const { k } = this.body(t4, f, r);
    const sgn = side === 'R' ? 1 : -1;
    const c = arm.carry;
    c.target.copy(S).addScaledVector(UP, -0.36 * k).addScaledVector(f, 0.27 * k).addScaledVector(r, -0.05 * sgn * k);
    c.pole.copy(S).addScaledVector(UP, -0.5).addScaledVector(f, -0.3).addScaledVector(r, 0.3 * sgn);
    const fingers = t1.copy(f).multiplyScalar(0.9).addScaledVector(r, -0.42 * sgn);
    handQuat(side, fingers, UP, c.quat);
    c.weight = 1;
    return c;
  }

  /**
   * Hold `obj` (an item's root, origin at its bottom centre) in a hand with a grip style.
   * Returns false without a rigged avatar (the procedural fallback body): keep it elsewhere then.
   */
  mount(side: HandSide | 'both', obj: THREE.Object3D, style: GripStyle, size: THREE.Vector3, center: THREE.Vector3, yaw = 0): boolean {
    if (!this.ready()) return false;
    const both = style === 'both' || side === 'both';
    const m: Mounted = { obj, side: both ? 'both' : side, style: both ? 'both' : style, size: size.clone(), center: center.clone(), yaw, tilt: 0 };
    this.mounted.set(obj, m);
    obj.removeFromParent();
    if (both) {
      this.avatar()!.root.add(obj);
      obj.scale.setScalar(1);
    } else {
      this.arms![side as HandSide].grip.add(obj);
      obj.scale.setScalar(1 / this.ms);
      if (style !== 'upright' && style !== 'bag') {
        const q = gripRotation(side as HandSide, size, style);
        obj.quaternion.copy(q);
        // the thing's centre to the grip point (long things hang on past the fingertips)
        const c = t1.copy(center).applyQuaternion(q).divideScalar(this.ms);
        const thick = Math.min(size.x, size.y, size.z) / this.ms;
        const along = style === 'side' ? Math.max(size.x, size.y, size.z) / 2 / this.ms - 0.05 : 0.085;
        obj.position.set(along, thick / 2 + 0.008, 0).sub(c);
      }
    }
    this.place(m);
    return true;
  }

  unmount(obj: THREE.Object3D) {
    if (!this.mounted.delete(obj)) return;
    obj.removeFromParent();
    obj.scale.setScalar(1);
  }

  isMounted(obj: THREE.Object3D) {
    return this.mounted.has(obj);
  }

  /** tip an upright thing toward the face (a sip), radians */
  tilt(obj: THREE.Object3D, angle: number) {
    const m = this.mounted.get(obj);
    if (m) m.tilt = angle;
  }

  /** what a hand is busy with (for its pose) */
  private styleIn(side: HandSide): GripStyle | null {
    for (const m of this.mounted.values()) {
      if (m.side === 'both') return 'both';
      if (m.side === side) return m.style;
    }
    return null;
  }

  /** after the avatar's animation update, before rendering */
  apply(dt: number) {
    if (!this.ready()) return;
    const av = this.avatar()!;
    const arms = this.arms!;
    if (!av.root.visible) {
      arms.R.goal = arms.L.goal = null;
      this.fingerGoal = {};
      return;
    }
    av.root.updateMatrixWorld(true);
    const f = new THREE.Vector3();
    const r = new THREE.Vector3();
    this.body(t1, f, r);
    // the body's frame: goals are kept in it while an arm eases out (Arm.last)
    const toBody = this.toBody.copy(av.root.matrixWorld).invert();
    const bodyQ = av.root.getWorldQuaternion(this.bodyQ);
    const target = this.target;
    const pole = this.pole;
    const quat = this.quat;
    for (const side of ['R', 'L'] as HandSide[]) {
      const arm = arms[side];
      const sgn = side === 'R' ? 1 : -1;
      let goal = arm.goal;
      arm.goal = null;
      const style = this.styleIn(side);
      // (fingers asked for with this frame's reach ease out with the arm; a reach without any, a carry
      // or an arm that has let go: none)
      const reach = !!goal;
      if (reach) arm.lastFingers = this.fingerGoal[side] ?? null;
      if (!goal && !this.seated) {
        if (style === 'both') goal = this.bothGoal(side);
        else if (style === 'can' || style === 'flat' || style === 'upright') goal = this.carryGoal(side);
      }
      if (!reach && (goal || arm.w < 0.05)) arm.lastFingers = null;
      // a hanging arm a few degrees away from the leg (a clipboard or a bag at your side)
      const wantAbduct = !goal && (style === 'side' || style === 'bag') && !this.seated ? 1 : 0;
      arm.abduct += (wantAbduct - arm.abduct) * Math.min(1, dt * 6);
      if (arm.abduct > 0.01) {
        const S = arm.upper.getWorldPosition(t2);
        const E = arm.fore.getWorldPosition(t3);
        const from = t4.copy(E).sub(S).normalize();
        const to = t5.copy(from).applyAxisAngle(f, -0.16 * sgn * arm.abduct).normalize();
        turnBone(arm.upper, from, to, 1);
        arm.upper.updateMatrixWorld(true);
      }
      const want = goal ? (goal.weight ?? 1) : 0;
      arm.w += (want - arm.w) * Math.min(1, dt * (want > arm.w ? 7 : 5));
      if (goal) {
        arm.last.target.copy(goal.target).applyMatrix4(toBody);
        arm.last.hasQuat = !!goal.quat;
        if (goal.quat) arm.last.quat.copy(bodyQ).invert().multiply(goal.quat);
        arm.last.hasPole = !!goal.pole;
        if (goal.pole) arm.last.pole.copy(goal.pole).applyMatrix4(toBody);
      }
      if (arm.w < 0.005) continue;
      target.copy(arm.last.target).applyMatrix4(av.root.matrixWorld);
      if (arm.last.hasPole) pole.copy(arm.last.pole).applyMatrix4(av.root.matrixWorld);
      else arm.upper.getWorldPosition(pole).addScaledVector(UP, -0.5).addScaledVector(f, -0.3).addScaledVector(r, 0.3 * sgn);
      this.solve(arm, target, pole, arm.w);
      if (arm.last.hasQuat) {
        orientBone(arm.hand, quat.copy(bodyQ).multiply(arm.last.quat), arm.w);
        arm.hand.updateMatrixWorld(true);
      }
    }
    // a hand holding a drink closes round it (the mocap's hands are relaxed, half open)
    for (const side of ['R', 'L'] as HandSide[]) if (this.styleIn(side) === 'upright') this.curl(side, av.root);
    // fingers asked for this frame (hand hygiene: flat for rubbing, cupped under a nozzle), or with the
    // last goal while the arm lets go (they relax with it rather than snapping back)
    for (const side of ['R', 'L'] as HandSide[]) {
      const g = this.fingerGoal[side] ?? arms[side].lastFingers;
      if (g && arms[side].w > 0.05) this.curl(side, av.root, g.flex * arms[side].w, g.thumb * arms[side].w);
    }
    this.fingerGoal = {};
    for (const m of this.mounted.values()) this.place(m);
  }

  // (apply's scratch: the body's frame and a goal brought back to the world from it)
  private toBody = new THREE.Matrix4();
  private bodyQ = new THREE.Quaternion();
  private target = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  /** finger bones per hand: index to little finger, three segments each, then the thumb's */
  private fingerBones: Partial<Record<HandSide, { fingers: THREE.Object3D[][]; thumb: THREE.Object3D[] }>> = {};

  /**
   * Close a hand round a cup: each finger's segments flex about their own Z (Rocketbox fingers: X
   * along the finger, Y out of its palm side), a little more at the middle joint; the thumb less.
   * On top of the animation's pose, for this frame.
   */
  private curl(side: HandSide, root: THREE.Object3D, k = 1, kThumb = k) {
    let fb = this.fingerBones[side];
    if (!fb) {
      const seg = (n: string) => [findBone(root, new RegExp(`_${side}_${n}$`)), findBone(root, new RegExp(`_${side}_${n}1$`)), findBone(root, new RegExp(`_${side}_${n}2$`))].filter((b): b is THREE.Object3D => !!b);
      fb = { fingers: ['Finger1', 'Finger2', 'Finger3', 'Finger4'].map(seg), thumb: seg('Finger0') };
      this.fingerBones[side] = fb;
    }
    for (const f of fb.fingers) f.forEach((b, j) => b.rotateZ(FINGER_CURL[j] * k));
    fb.thumb.forEach((b, j) => b.rotateZ(THUMB_CURL[j] * kThumb));
    this.arms![side].hand.updateMatrixWorld(true);
  }

  /** both hands on the sides of a two-handed thing carried in front */
  private bothGoal(side: HandSide): ArmGoal | null {
    let m: Mounted | undefined;
    for (const x of this.mounted.values()) if (x.side === 'both') m = x;
    if (!m) return null;
    const arm = this.arms![side];
    const f = t2;
    const r = t3;
    this.body(t4, f, r);
    const sgn = side === 'R' ? 1 : -1;
    const width = Math.max(m.size.x, m.size.z);
    const c = arm.carry;
    m.obj.getWorldPosition(c.target).addScaledVector(r, sgn * (width / 2 + 0.03)).addScaledVector(UP, m.size.y * 0.5 + 0.015).addScaledVector(f, -0.03);
    arm.upper.getWorldPosition(c.pole).addScaledVector(UP, -0.5).addScaledVector(f, -0.2).addScaledVector(r, 0.35 * sgn);
    const fingers = t1.copy(f).addScaledVector(UP, -0.3).addScaledVector(r, -0.25 * sgn);
    const thumb = t5.copy(r).multiplyScalar(-0.3 * sgn).add(UP);
    handQuat(side, fingers, thumb, c.quat);
    c.weight = 1;
    return c;
  }

  private solve(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
    // reaching further than the arm is long: the shoulder blade comes forward first (the clavicle turns
    // toward the target, up to ~26°, about 7 cm more reach), as a real reach does
    const clav = arm.upper.parent;
    if (clav && /Clavicle$/.test(clav.name)) {
      const S = arm.upper.getWorldPosition(t1);
      const len = S.distanceTo(arm.fore.getWorldPosition(t2)) + t2.distanceTo(arm.hand.getWorldPosition(t3));
      const excess = S.distanceTo(target) - len * 0.985;
      if (excess > 0) {
        const C = clav.getWorldPosition(t2);
        const from = t3.copy(S).sub(C);
        const cl = from.length();
        from.normalize();
        const to = t4.copy(target).sub(C).normalize();
        const full = from.angleTo(to);
        if (cl > 1e-4 && full > 1e-4) {
          turnBone(clav, from, to, w * Math.min(1, Math.min(0.45, (excess * 1.3) / cl) / full));
          clav.updateMatrixWorld(true);
        }
      }
    }
    solveTwoBone(arm.upper, arm.fore, arm.hand, target, pole, w);
  }

  /** keep upright things level and bags hanging; two-handed things in front of the body */
  private place(m: Mounted) {
    const av = this.avatar();
    if (!av) return;
    if (m.side === 'both') {
      // the avatar root's frame (metres): in front of the belly at waist height, the long side across
      const k = this.k;
      const across = m.size.x >= m.size.z ? 0 : Math.PI / 2;
      m.obj.rotation.set(0, across, 0);
      const c = t1.copy(m.center).applyEuler(m.obj.rotation);
      m.obj.position.set(-c.x, 0.9 * k - (m.center.y - m.size.y / 2), 0.36 * k - c.z);
      return;
    }
    if (m.style !== 'upright' && m.style !== 'bag') return;
    const grip = m.obj.parent;
    if (!grip) return;
    grip.updateWorldMatrix(true, false);
    grip.getWorldQuaternion(q1);
    q2.setFromAxisAngle(UP, av.root.rotation.y + m.yaw);
    // tipped about the body's left–right axis, its top toward the face
    if (m.tilt) q2.premultiply(q3.setFromAxisAngle(t2.set(Math.cos(av.root.rotation.y), 0, -Math.sin(av.root.rotation.y)), -m.tilt));
    m.obj.quaternion.copy(q1.invert().multiply(q2));
    // the thing's centre (upright: beside the palm) or its top (bag: in the fingers) at the grip point
    const anchor = t1.copy(m.center);
    if (m.style === 'bag') anchor.y = m.center.y + m.size.y / 2 - 0.02;
    anchor.applyQuaternion(m.obj.quaternion).divideScalar(this.ms);
    const radius = Math.min(m.size.x, m.size.z) / 2 / this.ms;
    if (m.style === 'bag') m.obj.position.set(0.075, 0.025, 0).sub(anchor);
    else m.obj.position.set(0.08, radius + 0.012, 0).sub(anchor);
  }

  dispose() {
    for (const obj of [...this.mounted.keys()]) this.unmount(obj);
    if (this.arms) for (const s of ['R', 'L'] as HandSide[]) this.arms[s].grip.removeFromParent();
    this.arms = null;
    this.neck = undefined;
    this.face = undefined;
    this.spine = undefined;
    this.fingerBones = {};
  }
}

/**
 * Hands where they hold (the waiting-room faint, server/sim/ambient.ts; crowd.ts calls these after
 * the mocap, through AvatarCharacter.postPose): a friend squatting past his heels with his ankles in
 * her hands while his legs are raised, a nurse's hands on his arm as he gets up and sits down, and a
 * pusher's hands on a wheelchair's handles. Two-bone IK (hands.ts reachArm), blended by w.
 */
import * as THREE from 'three';
import type { AvatarCharacter } from './avatars';
import { armBones, handQuat, reachArm, type ArmBones } from './hands';

type Side = 'R' | 'L';

interface Rig {
  arm: Record<Side, ArmBones>;
  /** thigh, calf and foot as a two-bone chain (the same solver as the arms) */
  leg: Record<Side, ArmBones>;
  spine: THREE.Object3D[];
  foot: Record<Side, THREE.Object3D>;
  toe: Partial<Record<Side, THREE.Object3D>>;
  upper: Record<Side, THREE.Object3D>;
  fore: Record<Side, THREE.Object3D>;
  head?: THREE.Object3D;
  neck?: THREE.Object3D;
}

const rigs = new WeakMap<THREE.Object3D, Rig | null>();

function bone(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

function rigOf(av: AvatarCharacter): Rig | null {
  if (!av.ready) return null;
  const have = rigs.get(av.root);
  if (have !== undefined) return have;
  const R = armBones(av.root, 'R');
  const L = armBones(av.root, 'L');
  const spine = [bone(av.root, /_Spine1$/), bone(av.root, /_Spine2$/)].filter((b): b is THREE.Object3D => !!b);
  const fL = bone(av.root, /_L_Foot$/);
  const fR = bone(av.root, /_R_Foot$/);
  const uL = bone(av.root, /_L_UpperArm$/);
  const uR = bone(av.root, /_R_UpperArm$/);
  const eL = bone(av.root, /_L_Forearm$/);
  const eR = bone(av.root, /_R_Forearm$/);
  const tL = bone(av.root, /_L_Thigh$/);
  const tR = bone(av.root, /_R_Thigh$/);
  const cL = bone(av.root, /_L_Calf$/);
  const cR = bone(av.root, /_R_Calf$/);
  const rig =
    R && L && fL && fR && uL && uR && eL && eR && tL && tR && cL && cR
      ? { arm: { R, L }, leg: { L: { upper: tL, fore: cL, hand: fL }, R: { upper: tR, fore: cR, hand: fR } }, spine, foot: { L: fL, R: fR }, toe: { L: bone(av.root, /_L_Toe0$/), R: bone(av.root, /_R_Toe0$/) }, upper: { L: uL, R: uR }, fore: { L: eL, R: eR }, head: bone(av.root, /_Head$/), neck: bone(av.root, /_Neck$/) }
      : null;
  rigs.set(av.root, rig);
  return rig;
}

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _fing = new THREE.Vector3();
const _thumb = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** a body's forward and left (world, level) */
function frame(av: AvatarCharacter) {
  av.root.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
  _l.set(1, 0, 0).applyQuaternion(_q).setY(0).normalize();
}

/** turn a bone about a world axis (after the mocap) */
function turnWorld(b: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!b.parent || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_qp);
  _a.copy(axis).applyQuaternion(_qp.invert()).normalize();
  b.quaternion.premultiply(_q.setFromAxisAngle(_a, angle));
  b.updateMatrixWorld(true);
}

/** lean the upper body forward (spine bones) so the shoulders come over the hands, at most `max` rad */
function leanToward(rig: Rig, targets: THREE.Vector3[], w: number, max = 0.45) {
  const sh = rig.arm.R.upper.getWorldPosition(_a).add(rig.arm.L.upper.getWorldPosition(_b)).multiplyScalar(0.5);
  const reach = rig.arm.R.upper.getWorldPosition(_b).distanceTo(rig.arm.R.fore.getWorldPosition(_t)) + rig.arm.R.fore.getWorldPosition(_t).distanceTo(rig.arm.R.hand.getWorldPosition(_pole));
  let need = 0;
  for (const t of targets) need = Math.max(need, sh.distanceTo(t) - reach * 0.9);
  if (need <= 0 || !rig.spine.length) return;
  const base = rig.spine[0].getWorldPosition(_t);
  const lever = Math.max(0.2, sh.distanceTo(base));
  const angle = Math.min(max, need / lever) * w;
  for (const s of rig.spine) turnWorld(s, _l, angle / rig.spine.length);
}

/**
 * His ankles in her hands (she squats past his heels, facing him): each palm under the heel on her
 * side, fingers along the back of the leg, thumb out. Returns how far each wrist is from its target
 * (m) after the IK, for the audit and the legs' own easing.
 */
export function holdAnkles(holder: AvatarCharacter, patient: AvatarCharacter, w: number): number {
  const rig = rigOf(holder);
  const pr = rigOf(patient);
  if (!rig || !pr || w < 0.005) return Infinity;
  holder.root.updateMatrixWorld(true);
  patient.root.updateMatrixWorld(true);
  frame(holder);
  const pos = holder.root.getWorldPosition(new THREE.Vector3());
  const ankles = (['L', 'R'] as Side[]).map((s) => pr.foot[s].getWorldPosition(new THREE.Vector3()));
  // her right hand takes the ankle on her right (−left)
  const onRight = ankles[0].clone().sub(pos).dot(_l) < ankles[1].clone().sub(pos).dot(_l) ? 0 : 1;
  const targets: Record<Side, THREE.Vector3> = { R: ankles[onRight], L: ankles[1 - onRight] };
  // the wrist a palm's length back from under the heel (the heel ~6 cm below the ankle joint)
  const wrist = (s: Side) => targets[s].clone().addScaledVector(UP, -0.085).addScaledVector(_f, -0.07);
  leanToward(rig, [wrist('R'), wrist('L')], w);
  let gap = 0;
  for (const side of ['R', 'L'] as Side[]) {
    const out = side === 'R' ? -1 : 1;
    const arm = rig.arm[side];
    const t = wrist(side);
    arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.35).addScaledVector(_l, out * 0.3).addScaledVector(_f, -0.1);
    _fing.copy(_f).multiplyScalar(0.85).addScaledVector(UP, 0.35).normalize();
    _thumb.copy(_l).multiplyScalar(out);
    reachArm(arm, t, _pole, w, handQuat(side, _fing, _thumb, new THREE.Quaternion()));
    gap = Math.max(gap, arm.hand.getWorldPosition(_a).distanceTo(t));
  }
  return gap;
}

/**
 * A nurse's hands on his arm as he gets up and sits down: the near hand under his upper arm, the
 * other on his forearm. Only while she is near enough to reach (the caller eases w by distance).
 */
export function steadyArm(helper: AvatarCharacter, patient: AvatarCharacter, w: number): number {
  const rig = rigOf(helper);
  const pr = rigOf(patient);
  if (!rig || !pr || w < 0.005) return Infinity;
  helper.root.updateMatrixWorld(true);
  patient.root.updateMatrixWorld(true);
  frame(helper);
  const pos = helper.root.getWorldPosition(new THREE.Vector3());
  // his arm nearer to her
  const near: Side = pr.upper.L.getWorldPosition(_a).distanceTo(pos) < pr.upper.R.getWorldPosition(_b).distanceTo(pos) ? 'L' : 'R';
  const shoulder = pr.upper[near].getWorldPosition(new THREE.Vector3());
  const elbow = pr.fore[near].getWorldPosition(new THREE.Vector3());
  // under the upper arm, a hand's breadth below the shoulder; the other hand on the forearm just past the elbow
  const armpit = shoulder.clone().lerp(elbow, 0.35).addScaledVector(UP, -0.06);
  const fore = elbow.clone().lerp(pr.arm[near].hand.getWorldPosition(_t), 0.3);
  // which of her hands goes under: the one on the side his arm is (in her frame)
  const side: Side = armpit.clone().sub(pos).dot(_l) > 0 ? 'L' : 'R';
  const other: Side = side === 'L' ? 'R' : 'L';
  const toHim = armpit.clone().sub(pos).setY(0).normalize();
  let gap = 0;
  for (const [s, target, palmUp] of [
    [side, armpit, true],
    [other, fore, false],
  ] as [Side, THREE.Vector3, boolean][]) {
    const out = s === 'R' ? -1 : 1;
    const arm = rig.arm[s];
    const t = target.clone().addScaledVector(toHim, -0.06);
    arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.4).addScaledVector(_l, out * 0.3).addScaledVector(_f, -0.15);
    if (palmUp) {
      // palm up under his arm, fingers toward him, thumb out
      _fing.copy(toHim).addScaledVector(UP, 0.25).normalize();
      _thumb.copy(_l).multiplyScalar(out).addScaledVector(UP, -0.2).normalize();
    } else {
      // palm on his forearm, fingers up round it, thumb in
      _fing.copy(UP).multiplyScalar(0.8).addScaledVector(toHim, 0.3).normalize();
      _thumb.copy(_l).multiplyScalar(-out);
    }
    reachArm(arm, t, _pole, w, handQuat(s, _fing, _thumb, new THREE.Quaternion()));
    gap = Math.max(gap, arm.hand.getWorldPosition(_a).distanceTo(t));
  }
  return gap;
}

/**
 * A nurse calling the next name reads it off her clipboard: the board held up in her left hand by its
 * left edge, a forearm's length in front of her chest, tilted back toward her eyes, and her head bent
 * to it; `up` (0..1) she looks up at the room (as she calls), the board a little lower. The board's
 * mount on the hand (accessories.ts, carried at her side) is blended to that pose by w and back.
 */
export function readClipboard(av: AvatarCharacter, board: THREE.Object3D, w: number, up: number) {
  const rig = rigOf(av);
  const mesh = board.children[0];
  if (!rig || !mesh || !board.parent) return;
  const home = (board.userData.mount ??= { p: board.position.clone(), q: board.quaternion.clone(), s: board.scale.clone() }) as { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };
  board.position.copy(home.p);
  board.quaternion.copy(home.q);
  board.scale.copy(home.s);
  if (w < 0.005) return;
  av.root.updateMatrixWorld(true);
  frame(av);
  // the board: centre ahead of the chest, its face (+z, the paper) toward her eyes, its clip (+y) away from her
  const sh = rig.arm.R.upper.getWorldPosition(new THREE.Vector3()).add(rig.arm.L.upper.getWorldPosition(_a)).multiplyScalar(0.5);
  // (read: ~30 cm below her eyes and 25 cm in front of them, its face square to them; up: lower and flatter)
  const c = sh.addScaledVector(_f, 0.36 - 0.04 * up).addScaledVector(UP, -0.12 - 0.08 * up).addScaledVector(_l, 0.05);
  const tilt = 0.9 + 0.35 * up;
  const n = new THREE.Vector3().copy(_f).multiplyScalar(-Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
  const y = new THREE.Vector3().copy(_f).multiplyScalar(Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt));
  const x = new THREE.Vector3().copy(_l).negate();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
  // her left hand under its left edge, a little below the middle: palm to the board's back, fingers
  // across under it, thumb along the edge; the wrist just outside the edge
  const grip = c.clone().addScaledVector(x, -0.115).addScaledVector(y, -0.04);
  const arm = rig.arm.L;
  const wrist = grip.clone().addScaledVector(x, -0.04).addScaledVector(n, -0.035);
  arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.45).addScaledVector(_l, 0.25).addScaledVector(_f, -0.05);
  _fing.copy(x).multiplyScalar(0.9).addScaledVector(y, 0.3).normalize();
  reachArm(arm, wrist, _pole, w, handQuat('L', _fing, y, new THREE.Quaternion()));
  // the board where it is read (its mesh's offset in the mount kept), blended from where the hand carries it
  board.updateMatrixWorld(true);
  const carried = new THREE.Vector3();
  const carriedQ = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  board.matrixWorld.decompose(carried, carriedQ, scale);
  const want = new THREE.Matrix4().compose(c, q, scale).multiply(new THREE.Matrix4().copy(mesh.matrix).invert());
  const wantP = new THREE.Vector3();
  const wantQ = new THREE.Quaternion();
  want.decompose(wantP, wantQ, _b);
  const world = new THREE.Matrix4().compose(carried.lerp(wantP, w), carriedQ.slerp(wantQ, w), scale);
  new THREE.Matrix4().copy(board.parent.matrixWorld).invert().multiply(world).decompose(board.position, board.quaternion, board.scale);
  board.updateMatrixWorld(true);
  // eyes on it (head and neck bend; ~60 % of the way, the eyes do the rest), up to the room as she calls
  if (rig.head && rig.neck) {
    const eye = rig.head.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, 0.08).addScaledVector(_f, 0.08);
    const g = c.clone().sub(eye);
    const aim = Math.atan2(-g.y, Math.hypot(g.x, g.z));
    // (a Rocketbox head bone: X up, Y forward, Z left)
    const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.head.getWorldQuaternion(_q));
    const now = Math.atan2(-fwd.y, Math.hypot(fwd.x, fwd.z));
    const bend = Math.max(-0.2, Math.min(0.7, (aim - now) * 0.6)) * w * (1 - up);
    turnWorld(rig.neck, _l, bend * 0.4);
    turnWorld(rig.head, _l, bend * 0.6);
  }
}

/** a wheelchair prop's push grips (accessories.ts: at (±0.22, 0.965, −0.37) in the chair's frame) */
export function handleGrips(chair: THREE.Object3D, out: { R: THREE.Vector3; L: THREE.Vector3 }, g: Grips = WHEELCHAIR_GRIPS) {
  chair.updateWorldMatrix(true, false);
  // the prop's own right is its −x; whoever pushes it from behind faces the way it faces
  chair.localToWorld(out.R.set(-g.x, g.y, g.z));
  chair.localToWorld(out.L.set(g.x, g.y, g.z));
  return out;
}

/** push grips in a prop's own frame (x across, z ahead): the wheelchair's here, the rollator's in accessories.ts */
export type Grips = { x: number; y: number; z: number };
export const WHEELCHAIR_GRIPS: Grips = { x: 0.22, y: 0.965, z: -0.37 };

const _grips = { R: new THREE.Vector3(), L: new THREE.Vector3() };

/**
 * A wheelchair rider's feet on its footplates (accessories.ts: tops 0.117 m up at (±0.12, 0.43) in the
 * chair's frame; its left is +x): each ankle a heel's height over its plate, knee forward. Returns
 * the ankles' gap (m).
 */
export function feetOnPlates(rider: AvatarCharacter, chair: THREE.Object3D, w: number): number {
  const rig = rigOf(rider);
  if (!rig || w < 0.005) return Infinity;
  rider.root.updateMatrixWorld(true);
  chair.updateWorldMatrix(true, false);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.getWorldQuaternion(_q)).setY(0).normalize();
  const plateY = chair.localToWorld(_t.set(0, 0.117, 0)).y;
  let gap = 0;
  for (const side of ['L', 'R'] as Side[]) {
    const leg = rig.leg[side];
    // the ankle a heel's height over the plate's middle (the heel then on its back half, the ball on its front)
    const shoe = rider.plantedFeet[side];
    // The diagonal frame tube runs along each plate's outer edge. Leave room there for the shoe.
    const t = chair.localToWorld(new THREE.Vector3(side === 'L' ? 0.09 : -0.09, 0.117 + (shoe?.ankle ?? 0.07), 0.43 - 0.01));
    leg.upper.getWorldPosition(_pole).addScaledVector(fwd, 0.6).addScaledVector(UP, 0.25);
    reachArm(leg, t, _pole, w);
    // the sole flat on it: turn the foot about the ankle until the toe joint is ~3 cm over the plate
    const toe = rig.toe[side];
    if (shoe && leg.hand.parent) {
      // The standing shoe is flat in pitch and roll, including the heel on this particular model.
      const world = rider.root.getWorldQuaternion(_q).multiply(shoe.rotation);
      leg.hand.parent.getWorldQuaternion(_qp).invert();
      leg.hand.quaternion.slerp(_qp.multiply(world), w);
      leg.hand.updateMatrixWorld(true);
    } else if (toe) {
      leg.hand.updateMatrixWorld(true);
      const A = leg.hand.getWorldPosition(new THREE.Vector3());
      const T = toe.getWorldPosition(new THREE.Vector3());
      const d1 = T.clone().sub(A);
      const len = d1.length();
      const drop = A.y - (plateY + 0.03);
      if (len > 0.05 && Math.abs(drop) < len) {
        const flat = Math.sqrt(len * len - drop * drop);
        const h = d1.clone().setY(0);
        if (h.lengthSq() > 1e-6) {
          const d2 = h.normalize().multiplyScalar(flat).setY(-drop).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(d1.normalize(), d2);
          if (w < 1) q.slerp(new THREE.Quaternion(), 1 - w);
          leg.hand.parent!.getWorldQuaternion(_qp);
          const local = _qp.clone().invert().multiply(q).multiply(_qp);
          leg.hand.quaternion.premultiply(local);
          leg.hand.updateMatrixWorld(true);
        }
      }
    }
    gap = Math.max(gap, leg.hand.getWorldPosition(_a).distanceTo(t));
  }
  return gap;
}

/** both hands on the push handles: palms down over the grips, thumbs in. Returns the wrists' gap (m). */
export function gripHandles(pusher: AvatarCharacter, chair: THREE.Object3D, w: number, g: Grips = WHEELCHAIR_GRIPS): number {
  const rig = rigOf(pusher);
  if (!rig || w < 0.005) return Infinity;
  pusher.root.updateMatrixWorld(true);
  frame(pusher);
  handleGrips(chair, _grips, g);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.getWorldQuaternion(_q)).setY(0).normalize();
  const wrist = (s: Side) => _grips[s].clone().addScaledVector(fwd, -0.055).addScaledVector(UP, 0.06);
  leanToward(rig, [wrist('R'), wrist('L')], w, 0.3);
  let gap = 0;
  for (const side of ['R', 'L'] as Side[]) {
    const out = side === 'R' ? -1 : 1;
    const arm = rig.arm[side];
    const t = wrist(side);
    arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.45).addScaledVector(_l, out * 0.35).addScaledVector(_f, -0.25);
    _fing.copy(fwd).multiplyScalar(0.7).addScaledVector(UP, -0.7).normalize();
    _thumb.copy(_l).multiplyScalar(-out);
    reachArm(arm, t, _pole, w, handQuat(side, _fing, _thumb, new THREE.Quaternion()));
    gap = Math.max(gap, arm.hand.getWorldPosition(_a).distanceTo(t));
  }
  return gap;
}

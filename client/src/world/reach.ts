/**
 * Pressing a button, taking hold of a curtain's edge. Third person: one of the avatar's arms reaches
 * for it (two-bone IK on the Rocketbox arm, blended over the mocap, ~0.8 s). First person: a hand in
 * a white coat sleeve comes up into view (the right one, or a mirrored left one), the index finger to
 * the button, and the camera leans in a few centimetres. The press itself happens when the finger
 * arrives (onPress), so the button lights under your finger.
 *
 * The player's gestures go through gesture.ts, which turns the body to the target first and picks
 * the arm; NPCs' (curtains.ts) call this directly.
 */
import * as THREE from 'three';
import { G, add, lambert } from './materials';

const REACH = 0.3; // s to the button
const HOLD = 0.16;
const BACK = 0.36;
/** let go early (walking off): the hand comes back in this long from wherever it is */
const RELEASE = 0.22;
/** first person: the fingertip at most this far from the shoulder (m; shoulder to fingertip, a 1.78 m adult) */
export const FP_REACH = 0.8;
/**
 * Taking hold of a handle (cabinets.ts) rather than pressing: the fingers close round it, so the wrist
 * stops this far short of it (third person) and the first-person hand's curled fingers are on it. A
 * 'bar' (a vertical handle) is taken thumb up, palm to the side; a 'pull' (horizontal) palm down.
 */
export type GripKind = 'bar' | 'pull';
const GRIP_WRIST = 0.085;
/** first person: where a handle sits in the curled fingers (hand frame, right hand; x mirrored for the left) */
const GRIP_AT = new THREE.Vector3(0.004, -0.03, -0.044);
const TIP_AT = new THREE.Vector3(-0.028, 0.002, -0.132);

export class Reach {
  private t = -1;
  private target = new THREE.Vector3();
  private onPress: (() => void) | null = null;
  private bones: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D } | null = null;
  private bonesOf: THREE.Object3D | null = null;
  /** first-person hands: the right one, and a mirrored left one (made when first needed) */
  private hands: Partial<Record<'R' | 'L', THREE.Group>> = {};
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private qp = new THREE.Quaternion();
  private lean = new THREE.Vector3();
  /** letting go early: weight when it started, and time since (−1 = not letting go) */
  private relW = 0;
  private relT = -1;

  constructor(
    private scene: THREE.Scene,
    private skin = '#d9a47f',
  ) {
    this.handFor('R');
  }

  /** a first-person hand: palm, a pointing index finger, curled fingers, thumb, a white coat cuff (the left one mirrored) */
  private handFor(side: 'R' | 'L'): THREE.Group {
    const have = this.hands[side];
    if (have) return have;
    const hand = new THREE.Group();
    const m = side === 'R' ? 1 : -1;
    const s = lambert(this.skin, { roughness: 0.62 });
    const coat = lambert('#f1f2f0', { roughness: 0.8 });
    const scrub = lambert('#5d8fbf', { roughness: 0.75 });
    add(hand, G.rbox(0.085, 0.03, 0.095, 0.013), s, 0, 0, 0);
    // the index finger: pointing (a button) or curled with the others (a handle: applyCamera bends it)
    add(hand, G.capsule(0.009, 0.072, 4, 8), s, -0.028 * m, 0.002, -0.088, Math.PI / 2, 0, 0).name = 'index';
    for (const [x, r] of [[-0.006, 0.0105], [0.016, 0.0102], [0.034, 0.0095]] as [number, number][]) add(hand, G.capsule(r, 0.03, 4, 8), s, x * m, -0.012, -0.05, Math.PI / 2.6, 0, 0);
    add(hand, G.capsule(0.011, 0.045, 4, 8), s, -0.05 * m, -0.006, -0.012, Math.PI / 2, 0, 0.9 * m);
    add(hand, G.cyl(0.036, 0.04, 0.09, 14), scrub, 0.004 * m, 0.0, 0.085, Math.PI / 2, 0, 0);
    // the coat sleeve runs back past the edge of the view (a short one ended in mid-air)
    add(hand, G.cyl(0.048, 0.058, 0.52, 16), coat, 0.006 * m, 0.0, 0.38, Math.PI / 2, 0, 0);
    hand.visible = false;
    hand.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
    this.scene.add(hand);
    this.hands[side] = hand;
    return hand;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  /** the hand is on its way back (or gone): pressed and past the hold */
  get returning(): boolean {
    return this.t < 0 || this.relT >= 0 || this.t > REACH + this.hold;
  }

  /** which arm reaches (third person; first person shows the matching hand) */
  private arm: 'R' | 'L' = 'R';
  private hold = HOLD;
  /** taking hold of a handle (null: pressing with a fingertip) */
  private grip: GripKind | null = null;

  get side(): 'R' | 'L' {
    return this.arm;
  }

  /**
   * reach for `target` (world); `onPress` fires when the finger gets there. `arm` picks the side
   * (gesture.ts: the hand on the target's side; curtains.ts: an NPC's hand on the edge's side);
   * `hold` keeps the hand there longer (s)
   */
  start(target: THREE.Vector3, onPress: () => void, opts: { arm?: 'R' | 'L'; hold?: number; grip?: GripKind } = {}) {
    // a second press while the hand is still out presses straight away
    if (this.t >= 0 && this.onPress) this.onPress();
    this.target.copy(target);
    this.onPress = onPress;
    this.t = 0;
    this.relT = -1;
    this.hold = opts.hold ?? HOLD;
    this.grip = opts.grip ?? null;
    const arm = opts.arm ?? 'R';
    if (arm !== this.arm) {
      this.arm = arm;
      this.bones = null;
      this.bonesOf = null;
      for (const h of Object.values(this.hands)) if (h) h.visible = false;
    }
  }

  /** move the target while the hand is out (a curtain's edge sliding along under the fingers) */
  retarget(target: THREE.Vector3) {
    this.target.copy(target);
  }

  /**
   * Let go now (walking off): a press not yet made is made, and the hand comes straight back from
   * wherever it is instead of finishing the reach.
   */
  release() {
    if (this.t < 0 || this.relT >= 0) return;
    const w = this.weight();
    if (this.onPress) {
      const f = this.onPress;
      this.onPress = null;
      f();
    }
    this.relW = w;
    this.relT = 0;
  }

  /** 0 → 1 → 0 over the gesture */
  weight(): number {
    const t = this.t;
    if (t < 0) return 0;
    if (this.relT >= 0) return this.relW * (1 - smooth(this.relT / RELEASE));
    if (t < REACH) return smooth(t / REACH);
    if (t < REACH + this.hold) return 1;
    return 1 - smooth(Math.min(1, (t - REACH - this.hold) / BACK));
  }

  update(dt: number) {
    if (this.t < 0) return;
    if (this.relT >= 0) {
      this.relT += dt;
      if (this.relT >= RELEASE) {
        this.t = -1;
        this.relT = -1;
      }
      return;
    }
    const before = this.t;
    this.t += dt;
    if (before < REACH && this.t >= REACH && this.onPress) {
      const f = this.onPress;
      this.onPress = null;
      f();
    }
    if (this.t > REACH + this.hold + BACK) {
      this.t = -1;
      if (this.onPress) {
        const f = this.onPress;
        this.onPress = null;
        f();
      }
    }
  }

  /** third person: bend the arm (right unless start() picked the left) toward the button (after the mixer has posed the avatar) */
  applyArm(root: THREE.Object3D | null) {
    const w = this.weight();
    if (!root || w <= 0.001) return;
    if (this.bonesOf !== root || !this.bones) {
      const find = (re: RegExp) => {
        let hit: THREE.Object3D | undefined;
        root.traverse((o) => {
          if (!hit && re.test(o.name)) hit = o;
        });
        return hit;
      };
      const upper = find(new RegExp(`_${this.arm}_UpperArm$`));
      const fore = find(new RegExp(`_${this.arm}_Forearm$`));
      const hand = find(new RegExp(`_${this.arm}_Hand$`));
      this.bonesOf = root;
      this.bones = upper && fore && hand ? { upper, fore, hand } : null;
      if (!this.bones) return;
    }
    const { upper, fore, hand } = this.bones;
    root.updateMatrixWorld(true);
    const S = upper.getWorldPosition(new THREE.Vector3());
    const E = fore.getWorldPosition(new THREE.Vector3());
    const H = hand.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    // the wrist goes ~12 cm short of the button (the hand and finger do the rest), ~8.5 cm short of a
    // handle it takes hold of (the fingers round it)
    const toT = this.v1.copy(this.target).sub(S);
    const reach = Math.min(a + b - 0.02, Math.max(Math.abs(a - b) + 0.05, toT.length() - (this.grip ? GRIP_WRIST : 0.12)));
    const dir = toT.normalize();
    const T = S.clone().addScaledVector(dir, reach);
    // elbow: law of cosines in the plane of the shoulder, the target and "down and out"
    const cosA = Math.max(-1, Math.min(1, (a * a + reach * reach - b * b) / (2 * a * reach)));
    const pole = this.v2.set(0, -1, 0).addScaledVector(dir, -dir.y).normalize();
    const side = this.v3.crossVectors(dir, pole).normalize();
    const bend = new THREE.Vector3().crossVectors(side, dir).normalize();
    const Ed = S.clone().addScaledVector(dir, a * cosA).addScaledVector(bend, a * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
    // rotate the upper arm so the elbow lands at Ed, then the forearm so the wrist lands at T (blended by w)
    this.turn(upper, E.clone().sub(S).normalize(), Ed.clone().sub(S).normalize(), w);
    root.updateMatrixWorld(true);
    const E2 = fore.getWorldPosition(new THREE.Vector3());
    const H2 = hand.getWorldPosition(new THREE.Vector3());
    this.turn(fore, H2.sub(E2).normalize(), T.clone().sub(E2).normalize(), w);
  }

  /** rotate a bone by the world rotation taking `from` to `to`, scaled by w */
  private turn(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
    const full = new THREE.Quaternion().setFromUnitVectors(from, to);
    this.q.identity().slerp(full, w);
    bone.parent!.getWorldQuaternion(this.qp);
    const local = this.qp.clone().invert().multiply(this.q).multiply(this.qp);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  }

  /**
   * First person: the hand in view and a small lean toward the button (call after the controller set
   * the camera). `bodyYaw` (the body's facing, atan2(x, z) convention) puts the shoulder the arm comes
   * from on the body rather than the camera: looking away mid-gesture, the hand stays on the button
   * and the arm still comes from where your shoulder is.
   */
  applyCamera(camera: THREE.PerspectiveCamera, firstPerson: boolean, bodyYaw?: number) {
    const w = this.weight();
    const hand = this.handFor(this.arm);
    for (const h of Object.values(this.hands)) if (h && h !== hand) h.visible = false;
    hand.visible = firstPerson && w > 0.01;
    if (!firstPerson || w <= 0.001) return;
    const m = this.arm === 'R' ? 1 : -1;
    // the hand comes up from the shoulder (below a bottom corner of the view), so the arm is seen at
    // an angle; aimed along the view ray it showed only the end of the sleeve, a white disc
    const shoulder = this.v1;
    const shoulderAt = () => {
      camera.updateMatrixWorld();
      if (bodyYaw === undefined) return shoulder.set(0.2 * m, -0.3, 0.08).applyMatrix4(camera.matrixWorld);
      // the body's frame: forward (sin, cos), its right (−cos, sin)
      const fx = Math.sin(bodyYaw);
      const fz = Math.cos(bodyYaw);
      return shoulder.copy(camera.position).add(this.v2.set(-fz * 0.2 * m - fx * 0.06, -0.3, fx * 0.2 * m - fz * 0.06));
    };
    // lean toward the button: 5 cm, and as much more (up to 30 cm) as the arm needs to reach it
    const short = Math.min(0.3, Math.max(0, shoulderAt().distanceTo(this.target) - FP_REACH + 0.02));
    this.lean.copy(this.target).sub(camera.position);
    this.lean.normalize();
    camera.position.addScaledVector(this.lean, (0.05 + short) * w);
    shoulderAt();
    const arm = this.v2.copy(this.target).sub(shoulder);
    // never further than an arm's length from the shoulder: a button out of reach gets a hand reaching
    // toward it (the sleeve, 0.5 m, would otherwise end in mid-air short of the shoulder)
    const aim = shoulder.clone().addScaledVector(arm, Math.min(1, FP_REACH / Math.max(1e-3, arm.length())));
    arm.normalize();
    const rest = this.v3.set(0.22 * m, -0.34, -0.32).applyMatrix4(camera.matrixWorld);
    // orient: the index finger (local −z) along the arm toward the button, palm down; a vertical
    // handle is taken thumb up (the palm turned to the side)
    const mx = new THREE.Matrix4().lookAt(aim.clone().addScaledVector(arm, -1), aim, camera.up);
    hand.quaternion.setFromRotationMatrix(mx);
    hand.rotateZ((this.grip === 'bar' ? -1.45 : -0.35) * m);
    // pointing, or curled round the handle with the other fingers
    const index = hand.getObjectByName('index');
    if (index) {
      if (this.grip) {
        index.position.set(-0.028 * m, -0.012, -0.05);
        index.rotation.set(Math.PI / 2.6, 0, 0);
        index.scale.set(1, 0.62, 1);
      } else {
        index.position.set(-0.028 * m, 0.002, -0.088);
        index.rotation.set(Math.PI / 2, 0, 0);
        index.scale.set(1, 1, 1);
      }
    }
    // the fingertip (or, round a handle, the curled fingers) ends on it
    hand.position.set(0, 0, 0);
    hand.updateMatrixWorld();
    const tip = hand.localToWorld(this.touchLocal(m));
    const touch = aim.sub(tip);
    hand.position.lerpVectors(rest, touch, w);
  }

  /** where the first-person hand touches: the index fingertip, or where a handle sits in the curled fingers */
  private touchLocal(m: number): THREE.Vector3 {
    const p = this.grip ? GRIP_AT : TIP_AT;
    return new THREE.Vector3(p.x * m, p.y, p.z);
  }

  /** tests: where the first-person hand is drawn (world), null while hidden */
  shownAt(): THREE.Vector3 | null {
    for (const h of Object.values(this.hands)) if (h?.visible) return h.position.clone();
    return null;
  }

  /** tests: the first-person hand's touch point (world): fingertip, or the grip of the curled fingers; null while hidden */
  touchAt(): THREE.Vector3 | null {
    const h = this.hands[this.arm];
    if (!h?.visible) return null;
    h.updateMatrixWorld();
    return h.localToWorld(this.touchLocal(this.arm === 'R' ? 1 : -1));
  }

  dispose(scene: THREE.Scene) {
    for (const h of Object.values(this.hands)) if (h) scene.remove(h);
    this.hands = {};
  }
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * The player reaching for something: an elevator button (floors.ts), a curtain's edge (curtains.ts).
 * One body, one hand out at a time, so everything the player reaches for goes through here:
 *
 *  1. turn: the body squares up to the target first: in third person and top-down the body turns,
 *     in first person the view does (and tips toward it only if it is well out of view). A quarter
 *     turn takes ~0.35 s, a half turn ~0.6 s; the hand starts out as the turn settles.
 *  2. reach: the hand on the target's side goes out (the right one when it is straight ahead, or
 *     the free one when a hand is full): two-bone IK on the avatar's arm, a right or mirrored left
 *     first-person hand (reach.ts). `onPress` fires when the hand gets there.
 *  3. hold and back: the body keeps facing the target until the hand is back, whatever the camera
 *     does: looking away mid-gesture never swings the body round under an arm still on the button
 *     (World applies `facing` last, after the controller and the tag-along rule). The first-person
 *     hand comes from the body's shoulder, not the camera's.
 *
 * Walking off ends it early and naturally: a press not yet made is made, the hand comes straight
 * back, and the body turns where you walk. A second gesture does the same to the first. In a
 * wheelchair the body can't turn: the near hand just reaches.
 */
import * as THREE from 'three';
import type { CameraMode } from '../../../shared/types';
import { lerpAngle, type PlayerController } from './controls';
import { Reach, type GripKind } from './reach';

export type ArmSide = 'R' | 'L';

export interface GestureDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: () => PlayerController;
  mode: () => CameraMode;
  /** the player's avatar root (third-person arm) */
  avatarRoot: () => THREE.Object3D | null;
  /** hands holding something: the other one reaches when it can */
  busy?: () => { R: boolean; L: boolean };
}

/** a gesture in progress, as the system that asked for it sees it */
export interface Gesture {
  readonly arm: ArmSide;
  /** still turning to the target (the hand not out yet) */
  readonly turning: boolean;
  /** s since the hand started out (0 while turning) */
  readonly t: number;
  readonly pressed: boolean;
  /** the hand is back (or the gesture was cut short and has let go) */
  readonly done: boolean;
  /** move the target while the hand is on it (a curtain's edge sliding along under the fingers) */
  retarget(at: THREE.Vector3): void;
}

/** the target ends ~10° to the reaching arm's side of straight ahead */
const ARM_OFFSET = 0.17;
/** straight ahead (within ~7°): the right hand */
const AHEAD = 0.12;
/** the hand may start out when this much of the turn is left (rad): the motions overlap */
const OVERLAP = 0.22;
/** first person: a view within ~20° of the target (and pitched within ~17°) is kept */
const FP_KEEP = 0.35;
const FP_PITCH = 0.3;
const EYE = 1.65;
/** the body follows a sliding target (a curtain's edge) at most this fast (rad/s) */
const FOLLOW = 6;
/** a target that has slid this far round from the facing (rad): let go rather than reach behind */
const BEHIND = 1.75;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

class Live implements Gesture {
  arm: ArmSide = 'R';
  turning = true;
  t = 0;
  pressed = false;
  done = false;
  /** the turn: time, length, body facing from → to, view yaw/pitch (first person) */
  tt = 0;
  dur = 0;
  /** how far the turn the hand waits for goes (rad): the body's, or in first person the view's */
  turnOff = 0;
  f0 = 0;
  f1 = 0;
  view: { y0: number; y1: number; p0: number; p1: number | null } | null = null;
  /** the body's facing now (held until the hand is back) */
  f = 0;
  /** no facing held (a wheelchair; or cut short: you walk) */
  free = false;
  cut = false;
  /** world-space facing / press records for tests */
  pressFacing = NaN;
  pressBearing = NaN;
  readonly at = new THREE.Vector3();
  constructor(
    private owner: PlayerGestures,
    readonly hold: number,
    readonly onPress: () => void,
    /** taking hold of a handle rather than pressing (cabinets.ts) */
    readonly grip: GripKind | null = null,
  ) {}
  retarget(at: THREE.Vector3) {
    this.owner.retargeted(this, at);
  }
}

export class PlayerGestures {
  private reach: Reach;
  private g: Live | null = null;
  /** the last finished gesture (tests) */
  private last: Live | null = null;

  constructor(private d: GestureDeps) {
    this.reach = new Reach(d.scene);
  }

  get active(): boolean {
    return !!this.g;
  }

  /** which hands hold something */
  busyHands(): { R: boolean; L: boolean } {
    return this.d.busy?.() ?? { R: false, L: false };
  }

  /** the body's facing while a gesture holds it (World applies it just before posing the avatar); null = none */
  get facing(): number | null {
    const g = this.g;
    return g && !g.free ? g.f : null;
  }

  /**
   * Reach for `at` (world): turn to it, then the hand goes out; `onPress` when the hand gets there.
   * `hold` keeps the hand on it longer (s).
   */
  start(at: THREE.Vector3, onPress: () => void, opts: { hold?: number; grip?: GripKind; arm?: ArmSide } = {}): Gesture {
    // a second gesture while one is going: the first presses at once and lets go
    if (this.g) {
      this.cut(this.g);
      this.finish();
    }
    const c = this.d.controller();
    const first = this.d.mode() === 'first';
    const g = new Live(this, opts.hold ?? 0.16, onPress, opts.grip ?? null);
    g.at.copy(at);
    const f0 = first ? c.yaw + Math.PI : c.facing;
    const bearing = Math.atan2(at.x - c.pos.x, at.z - c.pos.y);
    const rel = wrap(bearing - f0);
    // the hand on the target's side (rel > 0: to the left), the right one straight ahead; the free one when a hand is full
    // (handing something over: the hand that holds it, `arm`)
    let arm: ArmSide = opts.arm ?? (rel > AHEAD ? 'L' : 'R');
    const busy = this.d.busy?.();
    if (!opts.arm && busy?.[arm] && !busy[arm === 'R' ? 'L' : 'R']) arm = arm === 'R' ? 'L' : 'R';
    g.arm = arm;
    g.f0 = f0;
    g.f = f0;
    g.f1 = bearing + (arm === 'L' ? -ARM_OFFSET : ARM_OFFSET);
    if (c.ride) {
      // seated in a wheelchair: no turning on the spot, the near hand just reaches
      g.free = true;
      g.f1 = f0;
    }
    const off = Math.abs(wrap(g.f1 - f0));
    if (first) {
      // the view: kept if the target is already in it; else it turns to look straight at it, and tips only if it is well out of view
      const want = Math.atan2(at.y - (c.y + EYE), Math.hypot(at.x - c.pos.x, at.z - c.pos.y));
      const p1 = Math.abs(want - c.pitch) > FP_PITCH ? Math.max(-0.7, Math.min(0.5, want)) : null;
      const vOff = Math.abs(wrap(bearing - f0));
      if (!c.ride && (vOff > FP_KEEP || p1 !== null)) g.view = { y0: c.yaw, y1: bearing - Math.PI, p0: c.pitch, p1 };
    }
    // ~0.35 s for a quarter turn, ~0.6 s for a half turn; a few degrees are next to instant. The hand
    // goes out as the turn settles (the last OVERLAP of it); in first person with the target in view
    // (only the unseen body turns) at once
    g.turnOff = first ? (g.view ? Math.abs(wrap(g.view.y1 - g.view.y0)) : 0) : off;
    g.dur = Math.max(off, g.turnOff) < 0.03 ? 0 : 0.1 + (Math.max(off, g.turnOff) / Math.PI) * 0.5;
    // (no turn to make: already facing it)
    if (g.dur === 0) g.f = g.f1;
    this.g = g;
    if (g.turnOff <= OVERLAP) this.out(g);
    return g;
  }

  /** the hand goes out (the turn has settled, or nearly) */
  private out(g: Live) {
    if (!g.turning) return;
    g.turning = false;
    g.t = 0;
    this.reach.start(g.at, () => this.pressed(g), { arm: g.arm, hold: g.hold, grip: g.grip ?? undefined });
  }

  private pressed(g: Live) {
    if (g.pressed) return;
    g.pressed = true;
    const c = this.d.controller();
    g.pressFacing = g.free ? c.facing : g.f;
    g.pressBearing = Math.atan2(g.at.x - c.pos.x, g.at.z - c.pos.y);
    g.onPress();
  }

  /** a gesture cut short (walking off, another gesture): the press is made now, the hand comes back */
  private cut(g: Live) {
    if (g.cut) return;
    g.cut = true;
    g.free = true;
    if (g.turning) {
      g.turning = false;
      this.pressed(g);
      g.done = true;
      if (this.g === g) this.finish();
      return;
    }
    if (this.g === g) this.reach.release();
    else this.pressed(g);
  }

  private finish() {
    const g = this.g;
    if (!g) return;
    g.done = true;
    this.last = g;
    this.g = null;
  }

  /** (Gesture.retarget) the hand follows the target until it lets go; coming back it comes from where it let go */
  retargeted(g: Live, at: THREE.Vector3) {
    if (this.g !== g || (!g.turning && this.reach.returning)) return;
    g.at.copy(at);
    if (!g.turning) this.reach.retarget(at);
  }

  /** per frame, after the controller moved you: the turn, walking off, the hand's clock */
  update(dt: number) {
    const g = this.g;
    if (!g) return;
    const c = this.d.controller();
    // walking off: the press is made, the hand comes straight back, the body goes where you walk
    if (!g.cut && (c.moving || c.steering)) this.cut(g);
    if (!this.g) return;
    if (!g.free) {
      if (g.tt < g.dur) {
        g.tt += dt;
        const s = smooth(g.tt / g.dur);
        g.f = lerpAngle(g.f0, g.f1, s);
        const v = g.view;
        if (v && this.d.mode() === 'first') {
          c.yaw = lerpAngle(v.y0, v.y1, s);
          if (v.p1 !== null) c.pitch = v.p0 + (v.p1 - v.p0) * s;
        }
        if (g.turning && (g.tt >= g.dur || g.turnOff * (1 - s) < OVERLAP)) this.out(g);
      } else if (g.turning) this.out(g);
      if (!g.turning && g.tt >= g.dur) {
        // the target slides (a curtain's edge): the body follows it round, a little
        const bearing = Math.atan2(g.at.x - c.pos.x, g.at.z - c.pos.y);
        const want = bearing + (g.arm === 'L' ? -ARM_OFFSET : ARM_OFFSET);
        const d = wrap(want - g.f);
        if (Math.hypot(g.at.x - c.pos.x, g.at.z - c.pos.y) > 0.25) g.f += Math.max(-FOLLOW * dt, Math.min(FOLLOW * dt, d));
        // slid round behind you: let go
        if (Math.abs(wrap(bearing - g.f)) > BEHIND) this.cut(g);
      }
    }
    if (!g.turning) {
      g.t += dt;
      this.reach.update(dt);
      if (!this.reach.active) this.finish();
    }
  }

  /** after the camera is placed: the first-person hand (from the body's shoulder) */
  camera() {
    const first = this.d.mode() === 'first';
    const g = this.g;
    this.reach.applyCamera(this.d.camera, first && !!g, g && !g.free ? g.f : undefined);
  }

  /** first person: where the reaching hand's fingers are (world; itemSystem.ts hangs a bag being handed over there), null while hidden */
  fpTouch(): THREE.Vector3 | null {
    return this.d.mode() === 'first' && this.g ? this.reach.touchAt() : null;
  }

  /** third person: the arm, after the avatar's animation and the held-things pose (hands.ts) */
  afterPose() {
    if (this.d.mode() === 'first' || !this.g) return;
    this.reach.applyArm(this.d.avatarRoot());
  }

  /** tests: what the hand is doing, and where the body faced when it pressed (degrees) */
  debug() {
    const g = this.g ?? this.last;
    const deg = (r: number) => Math.round((wrap(r) * 180) / Math.PI);
    return g
      ? { active: !!this.g, arm: g.arm, turning: g.turning, t: Math.round(g.t * 100) / 100, pressed: g.pressed, cut: g.cut, weight: Math.round(this.reach.weight() * 100) / 100, target: g.at.toArray().map((v) => Math.round(v * 1000) / 1000), facing: deg(g.f), pressFacing: Number.isNaN(g.pressFacing) ? null : deg(g.pressFacing), pressBearing: Number.isNaN(g.pressBearing) ? null : deg(g.pressBearing), grip: g.grip, fp: this.reach.touchAt()?.toArray() ?? null }
      : { active: false };
  }

  dispose() {
    this.g = null;
    this.reach.dispose(this.d.scene);
  }
}

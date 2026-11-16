/**
 * The player's jump, layered over whatever mocap clip plays (avatars.ts runs it after the clip and the
 * posture placement). Neither anims.glb nor the Rocketbox library has a jump, land or fall take, so
 * the whole jump is procedural:
 *
 *   - anticipation: hips and knees flex with the feet planted (the pelvis dips ~8 cm), the trunk leans
 *     in, the arms swing back
 *   - push-off: the legs extend, the heels come up (plantarflexion), the arms swing forward and up;
 *     the feet leave the floor with the legs straight and the toes pointed
 *   - flight, standing: the knees come up toward the apex and the arms come down and out to balance,
 *     then the legs reach for the floor
 *   - flight out of a run: a leap — the lead knee drives forward, the trail leg folds behind, the arms
 *     in opposition to the legs
 *   - stepping off an edge: no tuck, the legs reach for the floor
 *   - landing: forefoot first, then the knees absorb (the pelvis drops 7–16 cm by the impact speed)
 *     and recover over ~0.2–0.35 s; arms forward for balance
 *
 * The controller (controls.ts) keeps the feet on the floor for a short push-off (JUMP_WIND) before it
 * lets the body fly, and sets `grounded` false from the key press. The avatar never sees the
 * controller: it reads `airborne` (World: 1 from the key press until the feet are down again) and how
 * its root rises and falls. Legs on the floor are placed with a two-bone IK onto where the clip puts
 * the feet, so they stay planted however deep the dip.
 *
 * Rocketbox (3ds Max biped): the thighs hang off Bip01_Spine, the arms off the neck; the trunk bends
 * at Spine1/Spine2 without moving the legs. The body faces local +z, +x is the character's left.
 */
import * as THREE from 'three';

/** takeoff speed (m/s): a ~0.42 m standing jump under the controller's 11.5 m/s² */
export const JUMP_V = 3.1;
/** the push-off on the floor before the feet leave it (s): standing (dip + extension), and out of a run (one planted step) */
export const JUMP_WIND = 0.1;
export const JUMP_WIND_RUN = 0.06;
/** how long the push-off lasts at this ground speed (the controller and the avatar agree on it) */
export function jumpWind(speed: number): number {
  return speed > 3 ? JUMP_WIND_RUN : JUMP_WIND;
}

const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** smoothstep from a to b (a > b runs it backwards) */
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
  toe: THREE.Object3D | null;
  /** +1 left, −1 right (the character's left is +x) */
  side: number;
  // where the clip has this foot this frame (world), for planting
  ankle: THREE.Vector3;
  footQ: THREE.Quaternion;
  toeP: THREE.Vector3;
  toeQ: THREE.Quaternion;
}

interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  side: number;
}

/** arm angles (deg): shoulder flexion (0 hanging, 90 forward, 180 overhead; negative behind), abduction, elbow */
interface ArmPose {
  flex: number;
  abd: number;
  elbow: number;
}
/** leg angles (deg) for the air: hip flexion (+ forward), knee flexion, ankle plantarflexion */
interface LegPose {
  hip: number;
  knee: number;
  pf: number;
}

export type JumpPhase = 'idle' | 'wind' | 'air' | 'land';

/** what tests read (window.__acAnim) */
export interface JumpDebug {
  phase: JumpPhase;
  /** seconds in this phase */
  t: number;
  /** pelvis drop below where the clip has it (m; negative = raised onto the toes) */
  drop: number;
  /** 0 standing … 1 out of a run */
  run: number;
  /** speed (m/s) of the last landing */
  impact: number;
  rootY: number;
  pelvisY: number;
  lead: 'L' | 'R';
  fall: boolean;
}

// scratch (never held across calls)
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** rotate a bone so that world direction `from` turns toward `to` (unit vectors), by weight w */
function turnBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
  if (!bone.parent || w <= 0) return;
  _q1.setFromUnitVectors(from, to);
  if (w < 1) _q1.copy(_q3.identity().slerp(_q1, w));
  bone.parent.getWorldQuaternion(_q2);
  // world delta → the parent's frame: P⁻¹·Δ·P
  _q3.copy(_q2).invert().multiply(_q1).multiply(_q2);
  bone.quaternion.premultiply(_q3);
  bone.updateMatrixWorld(true);
}

/** turn a bone about a world axis (through its own joint) */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_q2);
  _f.copy(axis).applyQuaternion(_q2.invert()).normalize();
  bone.quaternion.premultiply(_q1.setFromAxisAngle(_f, angle));
  bone.updateMatrixWorld(true);
}

/** set a bone's world orientation, blended by w */
function orientBone(bone: THREE.Object3D, q: THREE.Quaternion, w: number) {
  if (!bone.parent || w <= 0) return;
  bone.parent.getWorldQuaternion(_q2);
  _q3.copy(_q2).invert().multiply(q);
  bone.quaternion.slerp(_q3, w);
  bone.updateMatrixWorld(true);
}

/** a bone's world direction toward a child joint (unit) */
function boneDir(from: THREE.Object3D, to: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return to.getWorldPosition(out).sub(from.getWorldPosition(_f)).normalize();
}

/**
 * Two-bone IK (hip–knee–ankle): bend toward `pole` and put the end joint at `target` (world), blended
 * by w. The turns are relative to the pose the mixer just set.
 */
function twoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const W = end.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E);
  const b = E.distanceTo(W);
  const dir = target.clone().sub(S);
  const d = clamp(dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  dir.normalize();
  const pd = pole.clone().sub(S);
  pd.addScaledVector(dir, -pd.dot(dir));
  if (pd.lengthSq() < 1e-8) pd.copy(_fwd);
  pd.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const knee = S.clone().addScaledVector(dir, a * cosA).addScaledVector(pd, a * sinA);
  turnBone(upper, E.clone().sub(S).normalize(), knee.sub(S).normalize(), w);
  const E2 = lower.getWorldPosition(new THREE.Vector3());
  const W2 = end.getWorldPosition(new THREE.Vector3());
  const reach = S.clone().addScaledVector(dir, d);
  turnBone(lower, W2.sub(E2).normalize(), reach.sub(E2).normalize(), w);
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

const restArm = (): ArmPose => ({ flex: 0, abd: 8, elbow: 15 });
const restLeg = (): LegPose => ({ hip: 0, knee: 0, pf: 0 });

/** every jump layer made (in practice the player's), for the test hooks */
const layers = new Set<JumpLayer>();
export function jumpDebugAll(): JumpDebug[] {
  return [...layers].map((l) => l.debug());
}

export class JumpLayer {
  private legs: Leg[] = [];
  private arms: Arm[] = [];
  private spine: THREE.Object3D[] = [];
  private head: THREE.Object3D | null;
  private pelvis: THREE.Object3D | null;
  private ok: boolean;

  private phase: JumpPhase = 'idle';
  private t = 0;
  private y0 = 0;
  private prevY = NaN;
  private vy = 0;
  private lastAirVy = 0;
  /** 0 standing … 1 out of a run */
  private run = 0;
  /** index (0 left, 1 right) of the leg that leads a leap */
  private lead = 0;
  private wind = JUMP_WIND;
  /** in the air without a push-off (stepped off an edge): no tuck */
  private fall = false;
  private impact = 0;
  /** a landing still settling when a new jump starts: its dip fades out under the new one */
  private carry = 0;
  /** out of a run: the cycle and its time when the push-off began */
  private stride: { action: THREE.AnimationAction; t: number } | null = null;
  private drop = 0;
  // smoothed angles per arm / leg, so phase changes never snap
  private armS: ArmPose[] = [restArm(), restArm()];
  private legS: LegPose[] = [restLeg(), restLeg()];
  private fresh = true;

  constructor(model: THREE.Object3D, private body: THREE.Object3D) {
    for (const [s, side] of [['L', 1], ['R', -1]] as const) {
      const thigh = findBone(model, new RegExp(`_${s}_Thigh$`));
      const calf = findBone(model, new RegExp(`_${s}_Calf$`));
      const foot = findBone(model, new RegExp(`_${s}_Foot$`));
      if (thigh && calf && foot) this.legs.push({ thigh, calf, foot, toe: findBone(model, new RegExp(`_${s}_Toe0$`)), side, ankle: new THREE.Vector3(), footQ: new THREE.Quaternion(), toeP: new THREE.Vector3(), toeQ: new THREE.Quaternion() });
      const upper = findBone(model, new RegExp(`_${s}_UpperArm$`));
      const fore = findBone(model, new RegExp(`_${s}_Forearm$`));
      const hand = findBone(model, new RegExp(`_${s}_Hand$`));
      if (upper && fore && hand) this.arms.push({ upper, fore, hand, side });
    }
    for (const re of [/_Spine1$/, /_Spine2$/]) {
      const b = findBone(model, re);
      if (b) this.spine.push(b);
    }
    this.head = findBone(model, /_Head$/);
    this.pelvis = findBone(model, /_Pelvis$/);
    this.ok = this.legs.length === 2;
    layers.add(this);
  }

  dispose() {
    layers.delete(this);
  }

  /** still doing something (pushing off, in the air, or a landing still settling) */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  debug(): JumpDebug {
    return {
      phase: this.phase,
      t: this.t,
      drop: this.drop,
      run: this.run,
      impact: this.impact,
      rootY: Number.isFinite(this.prevY) ? this.prevY : 0,
      pelvisY: this.pelvis ? this.pelvis.getWorldPosition(_a).y : 0,
      lead: this.lead === 0 ? 'L' : 'R',
      fall: this.fall,
    };
  }

  /**
   * After the mixer (and the posture placement): advance the jump and pose it.
   * @param airborne World's flag (1 from the key press until the feet are down)
   * @param rootY the root's world height this frame (the standing clip's feet level)
   * @param speed ground speed (m/s)
   * @param clip the clip playing (a run: it resumes on the leading leg after a leap)
   */
  update(dt: number, airborne: number, rootY: number, speed: number, clip?: THREE.AnimationAction | null) {
    if (!this.ok || dt <= 0) return;
    const vyNow = Number.isFinite(this.prevY) ? (rootY - this.prevY) / dt : 0;
    this.prevY = rootY;
    this.vy = vyNow;
    const up = airborne > 0.5;
    this.t += dt;
    if (up && (this.phase === 'idle' || this.phase === 'land')) {
      this.carry = this.phase === 'land' ? this.drop : 0;
      this.phase = 'wind';
      this.t = 0;
      this.y0 = rootY;
      this.run = clamp((speed - 1.2) / 2.6, 0, 1);
      this.wind = jumpWind(speed);
      this.fall = false;
      // out of a run the foot on the floor pushes off; the swinging one leads
      this.lead = this.footHeight(0, rootY) > this.footHeight(1, rootY) ? 0 : 1;
      // where the run cycle is now (the push-off leg planted): half a cycle on, the leading leg is
      this.stride = this.run > 0.5 && clip ? { action: clip, t: clip.time } : null;
    } else if (this.phase === 'wind') {
      if (!up) this.toLand(0);
      // stepped off an edge (no push-off): a fall
      else if (rootY < this.y0 - 0.015 || vyNow < -0.8) this.toAir(true);
      else if (vyNow > 2.4 || (this.t > this.wind - 0.03 && rootY > this.y0 + 0.003) || this.t > this.wind + 0.25) this.toAir(false);
    } else if (this.phase === 'air') {
      if (!up) {
        this.toLand(Math.max(0, -this.lastAirVy, -vyNow));
        // landing a leap still running: the cycle picks up with the leading leg down (where the clip
        // happened to be after the flight would plant whichever foot it liked, often the trailing one)
        const st = this.stride;
        if (st && clip === st.action && clip.isRunning()) {
          const d = clip.getClip().duration;
          clip.time = (st.t + d / 2) % d;
        }
        this.stride = null;
      } else this.lastAirVy = vyNow;
    }
    if (this.phase === 'land' && this.t > this.landEnd()) this.phase = 'idle';
    if (this.phase === 'idle') {
      this.fresh = true;
      this.drop = 0;
      return;
    }
    this.pose(dt);
  }

  private toAir(fall: boolean) {
    this.phase = 'air';
    this.t = 0;
    this.fall = fall;
    this.lastAirVy = this.vy;
  }

  private toLand(impact: number) {
    this.phase = 'land';
    this.t = 0;
    this.impact = impact;
  }

  /** compression and recovery times of this landing (s) */
  private landTimes(): [number, number] {
    const i = this.impact;
    return [0.06 + 0.012 * i, Math.min(0.34, 0.17 + 0.028 * i)];
  }

  private landEnd(): number {
    const [tc, tr] = this.landTimes();
    return tc + tr + 0.02;
  }

  private footHeight(i: number, rootY: number): number {
    const l = this.legs[i];
    return (l.toe ?? l.foot).getWorldPosition(_a).y - rootY;
  }

  private pose(dt: number) {
    const run = this.run;
    const leadI = this.lead;
    const trailI = 1 - leadI;
    const t = this.t;
    // ── this frame's targets ──
    let drop = 0; // pelvis down (m); negative = up onto the toes
    let back = 0; // hips back (m)
    let lean = 0; // trunk forward (rad)
    const heel = [0, 0]; // heel lift per planted leg (m)
    let groundW = 0; // legs IK'd onto the clip's feet
    let airW = 0; // legs posed by angle
    let armW = 0;
    const legT: LegPose[] = [restLeg(), restLeg()];
    const armT: ArmPose[] = [restArm(), restArm()];
    /** a standing pose blends into the leap by `run` */
    const mixArm = (i: number, stand: ArmPose, leap: ArmPose) => {
      armT[i] = { flex: lerp(stand.flex, leap.flex, run), abd: lerp(stand.abd, leap.abd, run), elbow: lerp(stand.elbow, leap.elbow, run) };
    };
    const mixLeg = (i: number, stand: LegPose, leap: LegPose) => {
      legT[i] = { hip: lerp(stand.hip, leap.hip, run), knee: lerp(stand.knee, leap.knee, run), pf: lerp(stand.pf, leap.pf, run) };
    };
    if (this.phase === 'wind') {
      const u = clamp(t / this.wind, 0, 1);
      const c = sstep(0, 0.55, u); // the dip
      const p = sstep(0.45, 1, u); // the push
      // standing: a quick countermovement, then up onto the toes; out of a run: barely a dip
      drop = lerp(0.08, 0.03, run) * c * (1 - p) - lerp(0.045, 0.03, run) * p + this.carry * (1 - sstep(0, 0.6, u));
      back = 0.035 * c * (1 - p) * (1 - run);
      lean = lerp(0.32 * c * (1 - 0.7 * p), 0.16 + 0.06 * p, run);
      groundW = 1;
      heel[0] = heel[1] = 0.05 * p * (1 - run);
      heel[trailI] = Math.max(heel[trailI], 0.06 * p * run);
      // out of a run the leading leg is swinging already: its knee drives up through the push
      airW = run;
      legT[trailI] = restLeg();
      mixLeg(leadI, restLeg(), { hip: 62 * sstep(0, 1, u), knee: 92 * sstep(0, 0.7, u), pf: 10 });
      armW = sstep(0, 0.3, u);
      for (const i of [0, 1]) {
        const stand = { flex: lerp(-55 * c, 85, p), abd: 10, elbow: 20 + 12 * p };
        // opposition: the arm on the lead leg's side swings back, the other forward
        const leap = i === leadI ? { flex: -35 * sstep(0, 1, u), abd: 12, elbow: 70 } : { flex: 60 * sstep(0, 1, u), abd: 10, elbow: 80 };
        mixArm(i, stand, leap);
      }
    } else if (this.phase === 'air') {
      const s = clamp(this.vy / JUMP_V, -1.6, 1);
      const ext = this.fall ? 0 : sstep(0.45, 0.95, s); // the takeoff's straight legs and pointed toes
      const tuck = this.fall ? 0 : Math.exp(-(((s - 0.05) / 0.55) ** 2)) * 0.9;
      const reach = this.fall ? 0.6 + 0.4 * sstep(0, 0.6, -s) : sstep(0.15, 0.9, -s);
      const g = sstep(1, -1, s); // 0 at takeoff … 1 back down at takeoff height
      drop = -lerp(0.045, 0.03, run) * ext;
      lean = lerp(0.1, 0.18, run) * (this.fall ? 0.5 : 1);
      airW = 1;
      for (const i of [0, 1]) {
        const stand = { hip: 52 * tuck + 14 * reach, knee: 88 * tuck + 22 * reach, pf: 38 * ext + 15 * tuck + 8 * reach };
        const leap =
          i === leadI
            ? { hip: lerp(62, 38, g), knee: lerp(92, 18, sstep(0.15, 1, g)), pf: lerp(12, 6, g) }
            : { hip: lerp(-20, -8, g) - 10 * Math.sin(Math.PI * g), knee: lerp(25, 80, sstep(0, 0.45, g)), pf: 45 };
        mixLeg(i, stand, this.fall ? stand : leap);
      }
      armW = this.fall ? 0.7 : lerp(1, 0.9, run);
      // the arm swing peaks just after takeoff, then the arms drop and open out for balance
      const flexUp = this.fall ? 40 : s > 0.75 ? lerp(110, 85, (s - 0.75) / 0.25) : s > 0.35 ? lerp(45, 110, (s - 0.35) / 0.4) : lerp(18, 45, clamp((s + 1) / 1.35, 0, 1));
      for (const i of [0, 1]) {
        // (elbows soften as the arms come down: bent ones held forward read as arms held out)
        const stand = { flex: flexUp, abd: this.fall ? 28 : lerp(12, 34, clamp(reach + 0.6 * tuck, 0, 1)), elbow: s > 0.35 ? 28 : lerp(14, 28, clamp((s + 1) / 1.35, 0, 1)) };
        const leap = i === leadI ? { flex: lerp(-35, -15, g), abd: 15, elbow: 70 } : { flex: lerp(60, 40, g), abd: 14, elbow: 80 };
        mixArm(i, stand, this.fall ? stand : leap);
      }
    } else {
      // landing
      const [tc, tr] = this.landTimes();
      // (running on, the stride carries some of it: shallower)
      const depth = clamp(0.03 + 0.024 * this.impact, 0.07, 0.16) * (1 - 0.4 * run);
      const k = t < tc ? Math.sin((Math.PI / 2) * (t / tc)) : 0.5 * (1 + Math.cos(Math.PI * clamp((t - tc) / tr, 0, 1)));
      drop = depth * k;
      back = 0.3 * drop * (1 - 0.5 * run);
      lean = Math.min(0.42, 0.32 * (drop / 0.1)) * (1 - 0.4 * run);
      groundW = sstep(0, 0.035, t);
      // forefoot first: the heels come down in the first few hundredths
      heel[0] = heel[1] = 0.035 * (1 - sstep(0, 0.07, t));
      // the air pose hands over to the planted legs (it keeps its last angles while it fades)
      airW = 1 - sstep(0, 0.09, t);
      armW = 1 - sstep(tc * 0.5, tc + tr, t);
      for (const i of [0, 1]) {
        legT[i] = { ...this.legS[i] };
        const stand = { flex: 32, abd: 22, elbow: 28 };
        const leap = i === leadI ? { flex: -20, abd: 14, elbow: 60 } : { flex: 45, abd: 12, elbow: 70 };
        mixArm(i, stand, leap);
      }
    }
    this.drop = drop;
    // smooth the angles: snappy, but no snaps when a phase hands over
    const k = this.fresh ? 1 : Math.min(1, dt * 45);
    for (const i of [0, 1]) {
      const a = this.armS[i];
      a.flex += (armT[i].flex - a.flex) * k;
      a.abd += (armT[i].abd - a.abd) * k;
      a.elbow += (armT[i].elbow - a.elbow) * k;
      const l = this.legS[i];
      l.hip += (legT[i].hip - l.hip) * k;
      l.knee += (legT[i].knee - l.knee) * k;
      l.pf += (legT[i].pf - l.pf) * k;
    }
    this.fresh = false;

    // ── apply ──
    const body = this.body;
    body.updateMatrixWorld(true);
    body.getWorldQuaternion(_bq);
    _side.copy(X).applyQuaternion(_bq);
    _fwd.set(0, 0, 1).applyQuaternion(_bq);
    // where the clip has the feet, before the hips move
    for (const l of this.legs) {
      l.foot.getWorldPosition(l.ankle);
      l.foot.getWorldQuaternion(l.footQ);
      if (l.toe) {
        l.toe.getWorldPosition(l.toeP);
        l.toe.getWorldQuaternion(l.toeQ);
      }
    }
    // hips: down (or up onto the toes), and back as the trunk leans in
    body.position.y -= drop;
    body.position.z -= back;
    body.updateMatrixWorld(true);
    // the trunk leans at the lower back (the legs hang off Bip01_Spine, below it); the head stays level
    for (const b of this.spine) rotateWorld(b, _side, lean / this.spine.length);
    if (this.head) rotateWorld(this.head, _side, -0.75 * lean);
    // legs in the air: by angle
    if (airW > 0.001) for (const [i, l] of this.legs.entries()) this.poseLeg(l, this.legS[i], airW);
    // legs on the floor: onto the clip's feet (heels lifted by `heel`), knees forward
    if (groundW > 0.001) {
      for (const [i, l] of this.legs.entries()) {
        // out of a run the leading leg is swinging already: only the push-off leg stays planted
        const w = this.phase === 'wind' && i === leadI ? groundW * (1 - run) : groundW;
        if (w > 0.001) this.plant(l, heel[i], w);
      }
    }
    // arms: by angle, relative to the leaning trunk
    if (armW > 0.001) for (const [i, a] of this.arms.entries()) this.poseArm(a, this.armS[i], lean, armW);
  }

  /** a leg by hip/knee/ankle angles (body frame), blended over the clip by w */
  private poseLeg(l: Leg, p: LegPose, w: number) {
    const hip = p.hip * D2R;
    const knee = p.knee * D2R;
    const abd = 5 * D2R;
    // thigh: down, swung forward by the hip angle, a little out
    const thighDir = new THREE.Vector3(l.side * Math.sin(abd), -Math.cos(hip) * Math.cos(abd), Math.sin(hip) * Math.cos(abd)).applyQuaternion(_bq);
    turnBone(l.thigh, boneDir(l.thigh, l.calf, _a), thighDir, w);
    // shin: the thigh's direction bent back by the knee angle (in the leg's sagittal plane)
    const ahead = _b.crossVectors(thighDir, _side).normalize();
    const shinDir = _c.copy(thighDir).multiplyScalar(Math.cos(knee)).addScaledVector(ahead, -Math.sin(knee)).normalize();
    turnBone(l.calf, boneDir(l.calf, l.foot, _d), shinDir, w);
    // ankle: toes pointed (a turn about the side axis takes the toes down)
    rotateWorld(l.foot, _side, p.pf * D2R * w);
  }

  /** a planted leg: the ankle onto the clip's (lifted by `heel`), the foot flat, or turned up onto its toes */
  private plant(l: Leg, heel: number, w: number) {
    const target = l.ankle.clone().addScaledVector(UP, heel);
    const pole = l.calf.getWorldPosition(new THREE.Vector3()).addScaledVector(_fwd, 0.6).addScaledVector(_side, l.side * 0.08);
    twoBone(l.thigh, l.calf, l.foot, target, pole, w);
    // the foot keeps the clip's orientation (flat on the floor) …
    orientBone(l.foot, l.footQ, w);
    // … or turns about the ball of the foot as the heel comes up
    if (l.toe && heel > 0.002) {
      const ankle = l.foot.getWorldPosition(_a);
      const cur = l.toe.getWorldPosition(_b).sub(ankle).normalize();
      const want = _c.copy(l.toeP).sub(ankle).normalize();
      turnBone(l.foot, cur, want, w);
    }
    if (l.toe) orientBone(l.toe, l.toeQ, w);
  }

  /** an arm by shoulder/elbow angles relative to the trunk (leaning by `lean`), over the clip by w */
  private poseArm(a: Arm, p: ArmPose, lean: number, w: number) {
    const flex = p.flex * D2R;
    const abd = p.abd * D2R;
    const elbow = p.elbow * D2R;
    // body frame, tipped forward with the trunk
    const tilt = _q1.setFromAxisAngle(X, lean);
    const upperDir = new THREE.Vector3(a.side * Math.sin(abd), -Math.cos(flex) * Math.cos(abd), Math.sin(flex) * Math.cos(abd)).applyQuaternion(tilt).applyQuaternion(_bq).normalize();
    turnBone(a.upper, boneDir(a.upper, a.fore, _a), upperDir, w);
    // the elbow folds the forearm toward the front of the upper arm
    const front = _b.crossVectors(upperDir, _side).normalize();
    const foreDir = _c.copy(upperDir).multiplyScalar(Math.cos(elbow)).addScaledVector(front, Math.sin(elbow)).normalize();
    turnBone(a.fore, boneDir(a.fore, a.hand, _d), foreDir, w);
  }
}

/**
 * The corridor wheelchair (details.ts builds it), which you can sit in and push yourself.
 *
 *   [E] on it    you walk round to its front, turn your back to it and sit down: footplates up,
 *                down again under your feet, hands to the push rims
 *   W / S        push forward / back (S while rolling forward grabs the rims and brakes)
 *   A / D        turn: one hand pushes harder, or (standing still) one forward and one back, on the spot
 *   Shift        quicker, harder strokes: cruising ≈ 1 m/s, up to ≈ 2.7 m/s
 *   [E]          get out (no prompt on screen): it stops, you stand up in front
 *
 * Speed comes in strokes (a ~1 s cycle: grab the rim behind its top, push forward, let go, bring the
 * hand back over the rim), with coasting and rolling resistance in between. The hands follow the
 * rims (arm IK); in contact they move with the rim. The big wheels turn by the distance each one
 * rolls (r = 0.31 m, exactly the axle height), the casters swing round to trail, the feet stay on
 * the footplates (leg IK). The footprint (0.68 × 1.05 m) stops at walls, furniture and people; a
 * step (the stairs) stops it with a hint; the elevators take it. Driving takes both hands: put down
 * what you hold first (G). First person: your body is drawn (not the head), eyes at seated height.
 *
 * Client-only and off the record: nothing here reaches the server, the score or the agents (the
 * room you roll into is reported like any other move). No randomness from the simulation.
 */
import * as THREE from 'three';
import type { CameraMode } from '../../../shared/types';
import { playSound, type SoundHandle } from '../audio/soundscape';
import { biquad, brown, burst, mix, mulberry, normalize, seamless, tone, white } from '../audio/synth';
import { sharedAudio } from '../ui/speech';
import type { AvatarCharacter } from './avatars';
import { mergeInto, type BuiltWorld } from './builder';
import { lerpAngle, type PlayerController, type Ride } from './controls';
import { wheelchairModel, type WheelchairModel } from './details';
import { handQuat, reachArm, type HandSide, type PlayerHands } from './hands';
import type { InteractTarget } from './index';
import type { ItemSystem } from './itemSystem';

/** an NPC as World keeps it (NpcState): enough to know where its body and legs are */
export interface NpcLike {
  v: { visible: boolean; ambient?: { act?: string; props?: readonly string[] } };
  ch: { posture: string };
  pos: THREE.Vector2;
  yaw: number;
}

export interface WheelchairDeps {
  scene: THREE.Scene;
  controller: PlayerController;
  built: BuiltWorld;
  items: ItemSystem;
  hands: PlayerHands;
  avatar(): AvatarCharacter | null;
  cameraMode(): CameraMode;
  hint(text: string, ms?: number): void;
  /** floor height at (x, z) for someone at y (floors.ts: stairs, storeys, elevator cars) */
  groundAt(x: number, z: number, y?: number): number;
  /** the floor of the storey you are on */
  floorY(): number;
  /** the people on your storey */
  npcs(): Iterable<NpcLike>;
}

export interface WheelchairTarget {
  key: string;
  target: InteractTarget;
  box: THREE.Box3;
  center: THREE.Vector3;
}

type State = 'parked' | 'approach' | 'in' | 'riding' | 'out';
type Phase = 'rest' | 'reach' | 'push' | 'recover' | 'brake';
type Kind = 'cruise' | 'fast' | 'back' | 'spin';

/** the driving footprint in the chair frame (m): the chair, the rider's toes, a little air */
const FOOT = { rear: -0.41, front: 0.64, half: 0.34 };
const FOOT_ZC = (FOOT.rear + FOOT.front) / 2;
const FOOT_HL = (FOOT.front - FOOT.rear) / 2;
/** the parked chair as walkers bump into it (its frame and footplates) */
const BODY = { rear: -0.39, front: 0.55, half: 0.335 };
/** where you stand in front of it, getting in and out (on foot: radius 0.3) */
const STAND_Z = 0.86;
/** the hip joint sits this far in front of the backrest's face (the sit pose leans back: the back then rests on it) */
const PELVIS_BACK = 0.215;
/** the sling seat gives under you (and so do you): the hips sit this much lower than on a hard seat */
const SINK = 0.04;
/** the feet on the footplates: centred on each plate, the ankle a little behind its middle */
const FOOT_X = 0.105;

/** rolling: resistance on sheet vinyl (μ ≈ 0.015), hands on the rims to stop, limits */
const ROLL = { friction: 0.15, settle: 0.9, settleAfter: 0.35, brake: 2.2, maxFwd: 2.7, maxBack: 0.65, maxTurn: 2.2, turnFriction: 1.0, straighten: 3.0, holdStraight: 8.0 };
/**
 * Strokes: push and recovery time (s), the hand's top speed on the rim (m/s; rad/s for a spin)
 * and how hard a push accelerates (m/s² at rest). Cruising settles at ≈ 0.97–1.06 m/s after
 * three or four strokes (the first gets you to ≈ 0.6), Shift at ≈ 2.7 m/s (cap; not measured on the GPU yet; was 1.5), backwards ≈ 0.45.
 */
const STROKE: Record<Kind, { push: number; recover: number; hand: number; accel: number }> = {
  cruise: { push: 0.42, recover: 0.58, hand: 1.22, accel: 3.4 },
  fast: { push: 0.34, recover: 0.42, hand: 2.8, accel: 5.5 },
  back: { push: 0.45, recover: 0.6, hand: -0.6, accel: 2.4 },
  spin: { push: 0.36, recover: 0.46, hand: 2.2, accel: 9 },
};
/** turning while rolling: the yaw rate a stroke aims for (rad/s) and how hard */
const TURN_MOVING = { hand: 1.6, accel: 6 };
/** hand positions on the rim (rad from its top, + forward) */
const RIM = { grab: -0.45, release: 0.8, pullGrab: 0.72, pullRelease: -0.4, rest: 0.3, brake: 0.12 };

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
/** rotate a bone so that a world direction `from` turns toward `to`, by weight w */
function turnBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
  if (!bone.parent) return;
  _q1.setFromUnitVectors(from, to);
  if (w < 1) _q1.copy(_q3.identity().slerp(_q1, w));
  bone.parent.getWorldQuaternion(_q2);
  _q3.copy(_q2).invert().multiply(_q1).multiply(_q2);
  bone.quaternion.premultiply(_q3);
  bone.updateMatrixWorld(true);
}

const _v = new THREE.Vector3();
/** turn a bone about a world axis (after the animation) */
function turnAbout(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_q2);
  _v.copy(axisWorld).applyQuaternion(_q2.invert()).normalize();
  bone.quaternion.premultiply(_q1.setFromAxisAngle(_v, angle));
  bone.updateMatrixWorld(true);
}

/** merge a part's meshes by material in its own frame (it keeps moving as one) */
function mergeLocal(g: THREE.Object3D) {
  const parent = g.parent;
  const p = g.position.clone();
  const q = g.quaternion.clone();
  const s = g.scale.clone();
  parent?.remove(g);
  g.position.set(0, 0, 0);
  g.quaternion.identity();
  g.scale.set(1, 1, 1);
  mergeInto(g as THREE.Group);
  g.position.copy(p);
  g.quaternion.copy(q);
  g.scale.copy(s);
  parent?.add(g);
  // already merged: a parent's merge must leave it alone
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.noMerge = true;
  });
}

// ───────────────────────────── sound (synthesized once, like the rest of the soundscape) ─────────────────────────────

/** tyres rolling on sheet vinyl: a soft low rumble, a faint grainy hiss, a little caster flutter (a 2.1 s loop) */
function rollingLoop(sr: number): Float32Array {
  const rand = mulberry(9157);
  const n = Math.round(2.4 * sr);
  const rumble = biquad(brown(n, rand), sr, 'lowpass', 240, 0.7);
  const hiss = biquad(white(n, rand), sr, 'bandpass', 2300, 0.6);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const flutter = 0.88 + 0.12 * Math.sin(2 * Math.PI * 2.5 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.42 * t));
    x[i] = rumble[i] * flutter + hiss[i] * 0.045;
  }
  // grit under the tyres
  for (let t = 0.05; t < 2.3; t += 0.09 + rand() * 0.3) mix(x, burst(sr, rand, 0.012, 0.003, 1800 + rand() * 2600, 'bandpass', 1.1), t * sr, 0.04);
  return normalize(seamless(x, sr, 0.3), 0.9);
}

/** a palm taking hold of a metal push rim: a soft slap with a faint ring */
function rimTouch(sr: number): Float32Array {
  const rand = mulberry(4409);
  const x = new Float32Array(Math.round(0.14 * sr));
  mix(x, burst(sr, rand, 0.06, 0.014, 650, 'lowpass', 0.8), 0, 0.9);
  mix(x, burst(sr, rand, 0.02, 0.004, 2600, 'bandpass', 1.0), 0.002 * sr, 0.25);
  mix(x, tone(sr, 0.1, 2350, 2310, 0.025, 0.001), 0.003 * sr, 0.06);
  return normalize(x, 0.8);
}

// ───────────────────────────── the chair ─────────────────────────────

interface Hand {
  side: HandSide;
  /** +1 the rider's left (+x in the chair frame), −1 the right */
  s: number;
  /** rim angle (rad from the top, + forward) and how far off the rim the hand is (0..1) */
  phi: number;
  lift: number;
  contact: boolean;
  /** this stroke: +1 pushing forward, −1 pulling back; where it takes hold and lets go */
  dir: number;
  grab: number;
  release: number;
  /** at the start of the phase: the hand's angle, and the wheel's (no slip while pushing) */
  phiFrom: number;
  wheelAt: number;
}

export class Wheelchair {
  readonly model: WheelchairModel;
  private state: State = 'parked';
  /** lent out (the waiting room's faint: a guard wheels it to him, crowd.ts draws it meanwhile): not here */
  private lent = false;
  /** pose: origin on the floor under the seat; front = (sin heading, cos heading) */
  x: number;
  z: number;
  y = 0;
  heading: number;
  /** speed of the rear axle's midpoint (m/s, + forward) and the turn rate (rad/s, + to the left) */
  v = 0;
  /** direction (±1) the chair was last stopped in by someone or something it can't push (0: free); pushing that way gains nothing */
  private blocked = 0;
  w = 0;
  private wheel = { L: 0, R: 0 };
  private caster = { L: { a: Math.PI, spin: 0 }, R: { a: Math.PI, spin: 0 } };
  /** footplates: 0 down … 1 folded up */
  private flip = 0;
  /** distance rolled by the axle midpoint (signed), for tests */
  private odo = 0;
  /** measured from the chair's geometry (chair frame) */
  private readonly seatTop: number;
  private readonly seatFront: number;
  private readonly backFront: number;
  private readonly plateTop: number;
  private readonly plateZ: number;
  private readonly rootZ: number;
  // the rider: where the script / the ride puts the controller (pos, facing, feet height)
  private rx = 0;
  private rz = 0;
  private rf = 0;
  private lastRf = 0;
  // getting in / out
  private tr = 0;
  private from = { x: 0, z: 0, f: 0 };
  private sat = false;
  private stood = false;
  private standAt = new THREE.Vector2();
  private exitPending = false;
  private approachT = 0;
  // the body
  private legW = 0;
  private hover = 0;
  private lean = 0;
  private armsOn = false;
  private foot = { ankleH: 0.085, toeH: 0.025, len: 0.14 };
  /** each foot's orientation relative to the body when standing (sole flat) */
  private footRel: Record<HandSide, THREE.Quaternion> = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  private footRelOk = false;
  private idleFor = 0;
  private feetAt = -1e9;
  /** the head's forward in its own frame, and the eyes relative to the base of the neck (body frame), standing */
  private headFwd = new THREE.Vector3(0, 0, 1);
  private neckEye = new THREE.Vector3(0, 0.18, 0.1);
  private headOk = false;
  /** 0..1: the head turned to look where you're going (the sit clip looks about) */
  private ahead = 0;
  private eyeInit = false;
  private bones: { thigh: Record<HandSide, THREE.Object3D>; calf: Record<HandSide, THREE.Object3D>; foot: Record<HandSide, THREE.Object3D>; toe: Record<HandSide, THREE.Object3D>; spine?: THREE.Object3D; neck?: THREE.Object3D; head?: THREE.Object3D } | null = null;
  private headScale = new THREE.Vector3(1, 1, 1);
  private fpOn = false;
  private readonly eye = new THREE.Vector3(0, 1.22, 0.06);
  // strokes
  private st = { phase: 'rest' as Phase, t: 0, dur: 0, kind: 'cruise' as Kind, f: 0, turn: 0, idle: 0, count: 0, fast: false };
  private readonly handsState: Record<HandSide, Hand>;
  // collisions
  private readonly boxes: THREE.Box3[] = [];
  private readonly people: { x: number; z: number; r: number }[] = [];
  private poseKey = '';
  private readonly box = new THREE.Box3();
  private readonly center = new THREE.Vector3();
  // hints, sound
  private hintAt = new Map<string, number>();
  /** seconds stopped in the chair, and whether the "get out" hint has shown for this stop */
  private stillT = 0;
  private stopHinted = false;
  private time = 0;
  private roll: SoundHandle | null = null;
  private rollAt = -10;
  private rollGain = -1;
  private bufs: { roll?: AudioBuffer; touch?: AudioBuffer } = {};
  private stuckT = 0;
  readonly ride: Ride;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();

  constructor(private d: WheelchairDeps) {
    const m = wheelchairModel();
    this.model = m;
    // measure the seat, backrest and footplates in the chair frame (the model is at the origin now)
    m.root.updateMatrixWorld(true);
    const seat = new THREE.Box3().setFromObject(m.seat, true);
    const back = new THREE.Box3().setFromObject(m.back, true);
    const plate = new THREE.Box3().setFromObject(m.plates.L, true);
    this.seatTop = seat.max.y;
    this.seatFront = seat.max.z;
    this.backFront = back.max.z;
    this.plateTop = plate.max.y;
    this.plateZ = (plate.min.z + plate.max.z) / 2;
    this.rootZ = this.backFront + PELVIS_BACK - 0.02;
    // one mesh per material and moving part (≈ 20 draw calls instead of ~90)
    for (const s of ['L', 'R'] as HandSide[]) {
      mergeLocal(m.casters[s].wheel);
      mergeLocal(m.casters[s].swivel);
      mergeLocal(m.wheels[s]);
      mergeLocal(m.plates[s]);
    }
    mergeLocal(m.body);
    m.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    d.scene.add(m.root);
    const home = d.built.details.wheelchairHome;
    this.x = home.x;
    this.z = home.z;
    this.heading = home.rot;
    this.y = d.groundAt(home.x, home.z, 0);
    // walkers bump into the parked chair: its footprint as a few small boxes (they turn with it)
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Box3();
      this.boxes.push(b);
      d.built.colliders.push(b);
    }
    const hand = (side: HandSide): Hand => ({ side, s: side === 'L' ? 1 : -1, phi: RIM.rest, lift: 0, contact: false, dir: 1, grab: RIM.grab, release: RIM.release, phiFrom: RIM.rest, wheelAt: 0 });
    this.handsState = { L: hand('L'), R: hand('R') };
    const self = this;
    this.ride = {
      drive: (dt, f, turn, fast) => this.drive(dt, f, turn, fast),
      eye: this.eye,
      get pivot() {
        return Math.max(1.0, self.eye.y - 0.03);
      },
    };
    this.place();
    this.updateBoxes();
  }

  /** you are in it (getting in, riding, or getting out) */
  get seated(): boolean {
    return this.state === 'in' || this.state === 'riding' || this.state === 'out';
  }

  /** the avatar's own clip shouldn't walk: you're carried (or being lowered into the seat) */
  get holdsPose(): boolean {
    return this.seated;
  }

  // ───────────────────────────── frames ─────────────────────────────

  private local(lx: number, lz: number, out: THREE.Vector2, x = this.x, z = this.z, h = this.heading): THREE.Vector2 {
    const s = Math.sin(h);
    const c = Math.cos(h);
    return out.set(x + lx * c + lz * s, z - lx * s + lz * c);
  }

  /** a chair-frame point (x to the rider's left, y up, z ahead) in world space */
  private toWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return out.set(this.x + lx * c + lz * s, this.y + ly, this.z - lx * s + lz * c);
  }

  /** a chair-frame direction in world space */
  private dirWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    return out.set(lx * c + lz * s, ly, -lx * s + lz * c);
  }

  // ───────────────────────────── targets ─────────────────────────────

  /** what the aim ray can hit: the parked chair on your storey */
  targets(): WheelchairTarget[] {
    if (this.lent || this.state !== 'parked' || Math.abs(this.y - this.d.floorY()) > 1.2) return [];
    return [{ key: 'use:wc:sit', target: { kind: 'use', id: 'wc:sit', label: 'Sit in the wheelchair · [F] Inspect' }, box: this.box, center: this.center }];
  }

  find(key: string): WheelchairTarget | undefined {
    return this.targets().find((t) => t.key === key);
  }

  /** with nothing in sight while riding: [E] gets you out (the same id as a café chair's "stand") */
  idleTarget(): { key: string; target: InteractTarget } | null {
    if (this.state !== 'riding') return null;
    return { key: 'use:stand', target: { kind: 'use', id: 'stand', label: 'Get out of the wheelchair' } };
  }

  /** E on one of ours: true if handled */
  interact(id: string): boolean {
    if (id === 'wc:sit') {
      this.sit();
      return true;
    }
    if (id === 'stand' && this.state === 'riding') {
      this.getOut();
      return true;
    }
    return false;
  }

  /** things you can't do from the wheelchair (sit on a chair, log in at a computer): true = refused */
  refuses(t: InteractTarget): boolean {
    if (!this.seated) return false;
    if (t.kind === 'computer' || (t.kind === 'use' && t.id.startsWith('sit:'))) {
      this.d.hint('Get out of the wheelchair first', 2600);
      return true;
    }
    return false;
  }

  // ───────────────────────────── getting in ─────────────────────────────

  snapshot() {
    return { x: this.x, y: this.y, z: this.z, heading: this.heading, riding: this.state === 'riding' || this.state === 'in', lent: this.lent };
  }

  restore(saved: ReturnType<Wheelchair['snapshot']>) {
    this.x = saved.x; this.y = saved.y; this.z = saved.z; this.heading = saved.heading;
    this.lent = saved.lent;
    if (saved.riding) {
      this.beginIn();
      this.tr = 3;
      this.inFrame(0);
      this.applyRider();
    }
    this.updateBoxes();
  }

  private sit() {
    if (this.state !== 'parked') return;
    if (this.d.items.heldItems().length) {
      this.d.hint("Put down what you're holding first (G)", 2800);
      return;
    }
    const ctl = this.d.controller;
    // someone standing where you'd sit
    this.gatherPeople(4);
    if (this.peopleDepth(this.x, this.z, this.heading, 0.8) > 0.05) {
      this.d.hint('Someone is in the way', 1800);
      return;
    }
    // walk round to its front (past its side if you're beside or behind it), then sit down
    const p = ctl.pos;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const lx = (p.x - this.x) * c - (p.y - this.z) * s;
    const lz = (p.x - this.x) * s + (p.y - this.z) * c;
    const way: THREE.Vector2[] = [];
    if (lz < 0.62) {
      const sides = Math.abs(lx) > 0.05 ? [Math.sign(lx), -Math.sign(lx)] : [1, -1];
      for (const side of sides) {
        const pts = lz < -0.25 ? [this.local(side * 0.85, -0.15, new THREE.Vector2()), this.local(side * 0.85, 0.62, new THREE.Vector2())] : [this.local(side * 0.85, 0.62, new THREE.Vector2())];
        if (pts.every((q) => this.free(q.x, q.y, 0.3, false))) {
          way.push(...pts);
          break;
        }
      }
    }
    way.push(this.local(0, STAND_Z, new THREE.Vector2()));
    ctl.path = way;
    ctl.pathRun = false;
    this.state = 'approach';
    this.approachT = 0;
  }

  private approachFrame(dt: number) {
    const ctl = this.d.controller;
    this.approachT += dt;
    const f = this.local(0, STAND_Z, new THREE.Vector2());
    const d = Math.hypot(ctl.pos.x - f.x, ctl.pos.y - f.y);
    if (ctl.steering) {
      // walked off
      ctl.path = null;
      this.state = 'parked';
      return;
    }
    if (!ctl.path || this.approachT > 5) {
      ctl.path = null;
      if (d < 1.4) this.beginIn();
      else {
        this.state = 'parked';
        this.d.hint("Can't get to the wheelchair from here", 2200);
      }
    }
  }

  private beginIn() {
    const ctl = this.d.controller;
    this.state = 'in';
    this.tr = 0;
    this.sat = false;
    this.from = { x: ctl.pos.x, z: ctl.pos.y, f: ctl.facing };
    this.rx = ctl.pos.x;
    this.rz = ctl.pos.y;
    this.rf = this.lastRf = ctl.facing;
    ctl.path = null;
    ctl.ride = this.ride;
    this.d.hands.seated = true;
    this.v = this.w = 0;
    this.exitPending = false;
    this.st.phase = 'rest';
    this.st.idle = 0;
    this.eyeInit = false;
    this.updateBoxes();
  }

  /**
   * The feet as they stand still (soles flat on the floor): ankle and toe heights, ankle to toe, and
   * each foot's turn relative to the body. On the footplates they rest the same way. Measured while
   * you stand idle (never mid-step: a walking foot rolls heel to toe).
   */
  private measureFeet(av: AvatarCharacter, dt: number) {
    const ctl = this.d.controller;
    const still = !ctl.moving && ctl.grounded && /_idle/.test(av.clip) && av.posture === 'stand';
    this.idleFor = still ? this.idleFor + dt : 0;
    if (this.idleFor < 0.8 || (this.footRelOk && this.time - this.feetAt < 3)) return;
    const b = this.bones!;
    av.root.updateMatrixWorld(true);
    const ankle = av.root.worldToLocal(b.foot.L.getWorldPosition(this.v1));
    const toe = av.root.worldToLocal(b.toe.L.getWorldPosition(this.v2));
    if (ankle.y < 0.04 || ankle.y > 0.16 || toe.y > 0.06) return;
    this.foot = { ankleH: ankle.y, toeH: Math.max(0.012, toe.y), len: clamp(Math.hypot(toe.x - ankle.x, toe.z - ankle.z), 0.1, 0.19) };
    av.root.getWorldQuaternion(this.q1).invert();
    for (const side of ['L', 'R'] as HandSide[]) b.foot[side].getWorldQuaternion(this.footRel[side]).premultiply(this.q1);
    this.footRelOk = true;
    this.feetAt = this.time;
    // the head looking ahead (its forward, in its own frame) and the eyes from the base of the neck (body frame)
    if (b.head && b.neck) {
      const fwd = this.v3.set(Math.sin(av.root.rotation.y), 0, Math.cos(av.root.rotation.y));
      b.head.getWorldQuaternion(this.q1);
      this.headFwd.copy(fwd).applyQuaternion(this.q1.invert());
      const eye = this.eyeOf(b.head, fwd, this.v1);
      const neck = b.neck.getWorldPosition(this.v2);
      const d = eye.sub(neck);
      this.neckEye.set(d.x * Math.cos(av.root.rotation.y) - d.z * Math.sin(av.root.rotation.y), d.y, d.x * fwd.x + d.z * fwd.z);
      this.headOk = true;
    }
  }

  /** the eyes: 9 cm above the head joint, 8 cm ahead of it */
  private eyeOf(head: THREE.Object3D, fwd: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return head.getWorldPosition(out).addScaledVector(UP, 0.09).addScaledVector(fwd, 0.08);
  }

  /** the scripted part of getting in: turn your back to it, sit, feet onto the footplates */
  private inFrame(dt: number) {
    // a half turn takes ~0.8 s (stepping round), sitting down ~0.8 s, feet up onto the plates ~0.5 s
    const T_TURN = 0.8;
    const T_SIT = 0.8;
    const T_SETTLE = 0.5;
    this.tr += dt;
    const t = this.tr;
    const s0 = this.local(0, 0.42, new THREE.Vector2());
    const s1 = this.local(0, this.rootZ, new THREE.Vector2());
    if (t < T_TURN) {
      const k = smooth(t / T_TURN);
      this.rf = lerpAngle(this.from.f, this.heading, k);
      this.rx = this.from.x + (s0.x - this.from.x) * k;
      this.rz = this.from.z + (s0.y - this.from.z) * k;
      this.flip = Math.max(this.flip, smooth(t / 0.3));
      return;
    }
    if (!this.sat) {
      this.sat = true;
      const av = this.d.avatar();
      if (av) {
        av.seatKind = 'chair';
        av.setPosture('sit', undefined, this.seatTop - SINK);
      }
    }
    this.rf = this.heading;
    const k = smooth((t - T_TURN) / T_SIT);
    this.rx = s0.x + (s1.x - s0.x) * k;
    this.rz = s0.y + (s1.y - s0.y) * k;
    const u = t - T_TURN - T_SIT;
    if (u > 0) {
      // feet up, footplates down under them, feet down onto them; hands to the rims
      this.legW = smooth(u / 0.2);
      this.flip = 1 - smooth((u - 0.1) / 0.25);
      this.hover = 0.07 * (1 - smooth((u - 0.3) / 0.15));
      this.armsOn = true;
    }
    if (u >= T_SETTLE) {
      this.state = 'riding';
      this.flip = 0;
      this.legW = 1;
      this.hover = 0;
      this.d.hint('In the wheelchair · W/S push · A/D turn · Shift: faster strokes', 5500);
    }
  }

  // ───────────────────────────── getting out ─────────────────────────────

  private getOut() {
    // stop first: hands on the rims, then out
    if (Math.abs(this.v) > 0.03 || Math.abs(this.w) > 0.05) {
      this.exitPending = true;
      return;
    }
    this.beginOut();
  }

  private beginOut() {
    // room to stand in front of it (never through it): straight ahead, a little to either side, further out
    this.gatherPeople(4);
    const spots: [number, number][] = [
      [0, STAND_Z],
      [0, STAND_Z + 0.1],
      [0.22, STAND_Z + 0.05],
      [-0.22, STAND_Z + 0.05],
      [0, STAND_Z + 0.2],
    ];
    const q = new THREE.Vector2();
    const ok = spots.find(([lx, lz]) => {
      this.local(lx, lz, q);
      return this.free(q.x, q.y, 0.32, true) && this.clearOfChair(q.x, q.y, 0.31);
    });
    if (!ok) {
      this.d.hint('No room to stand up here: roll back from the wall a little', 2600);
      return;
    }
    this.local(ok[0], ok[1], this.standAt);
    this.state = 'out';
    this.tr = 0;
    this.stood = false;
    this.v = this.w = 0;
  }

  private outFrame(dt: number) {
    const T_FEET = 0.5;
    const T_RISE = 0.85;
    this.tr += dt;
    const t = this.tr;
    if (t < T_FEET) {
      // feet up off the plates, plates folded up, feet down to the floor; hands off the rims
      this.hover = 0.07 * smooth(t / 0.15);
      this.flip = Math.max(this.flip, smooth((t - 0.1) / 0.25));
      this.legW = 1 - smooth((t - 0.3) / 0.2);
      this.armsOn = false;
      return;
    }
    this.legW = 0;
    this.hover = 0;
    if (!this.stood) {
      this.stood = true;
      this.d.avatar()?.setPosture('stand');
    }
    const s1 = this.local(0, this.rootZ, new THREE.Vector2());
    const k = smooth((t - T_FEET) / T_RISE);
    this.rx = s1.x + (this.standAt.x - s1.x) * k;
    this.rz = s1.y + (this.standAt.y - s1.y) * k;
    this.rf = this.heading;
    if (t >= T_FEET + T_RISE) this.finishOut();
  }

  private finishOut() {
    const ctl = this.d.controller;
    this.state = 'parked';
    ctl.ride = null;
    ctl.pos.set(this.rx, this.rz);
    ctl.facing = this.rf;
    this.d.hands.seated = false;
    this.armsOn = false;
    this.legW = 0;
    this.fpBody(false);
    this.updateBoxes();
    const held = this.d.items.held;
    this.d.hint(held ? `Holding the ${held.label} · [F] inspect · [G] put down` : 'Stood up', 2200);
  }

  // ───────────────────────────── riding ─────────────────────────────

  /** the controller's riding mode calls this every frame (controls.ts Ride) */
  private drive(dt: number, f: number, turn: number, fast: boolean) {
    const ctl = this.d.controller;
    // moved from outside (the debug teleport): the chair comes along
    if (this.state === 'riding' && Math.hypot(ctl.pos.x - this.rx, ctl.pos.y - this.rz) > 0.3) {
      this.heading = ctl.facing;
      const s = Math.sin(this.heading);
      const c = Math.cos(this.heading);
      this.x = ctl.pos.x - s * this.rootZ;
      this.z = ctl.pos.y - c * this.rootZ;
      this.y = this.d.groundAt(this.x, this.z, ctl.y);
      this.halt();
      this.rf = this.lastRf = this.heading;
    }
    if (this.state === 'in') this.inFrame(dt);
    else if (this.state === 'out') this.outFrame(dt);
    else if (this.state === 'riding') this.rideFrame(dt, f, turn, fast);
    if (this.state === 'parked') return;
    // the floor under it, rolling or not (an elevator car takes it up or down)
    this.y = this.d.groundAt(this.x + Math.sin(this.heading) * FOOT_ZC, this.z + Math.cos(this.heading) * FOOT_ZC, this.y);
    // the view turns with you (first person throughout, third while driving: the camera stays behind)
    const df = wrap(this.rf - this.lastRf);
    if (this.state === 'riding' || this.d.cameraMode() === 'first') ctl.yaw += df;
    this.lastRf = this.rf;
    this.applyRider();
  }

  private applyRider() {
    const ctl = this.d.controller;
    ctl.pos.set(this.rx, this.rz);
    ctl.facing = this.rf;
    ctl.y = this.y;
  }

  private rideFrame(dt: number, f: number, turn: number, fast: boolean) {
    const ctl = this.d.controller;
    if (this.exitPending) f = turn = 0;
    if ((f || turn) && this.d.items.heldItems().length) {
      this.hintOnce('hands', "Put down what you're holding first (G)", 2600);
      f = turn = 0;
    }
    // click to move (top-down) and walking to something you clicked: the chair steers along the path
    if (!f && !turn && ctl.path && !this.exitPending) {
      const p = this.follow(dt);
      f = p.f;
      turn = p.turn;
    } else this.stuckT = 0;
    this.gatherPeople(3.5);
    // stopped for a moment: say how to get out (once per stop)
    if (!f && !turn && Math.abs(this.v) < 0.03 && Math.abs(this.w) < 0.05) {
      this.stillT += dt;
      if (this.stillT >= 1 && !this.stopHinted) {
        this.stopHinted = true;
        this.d.hint('[E] get out of the wheelchair', 3000);
      }
    } else {
      this.stillT = 0;
      this.stopHinted = false;
    }
    this.strokes(dt, f, turn, fast);
    this.move(dt);
    this.handsFrame(dt);
    const r = this.local(0, this.rootZ, new THREE.Vector2());
    this.rx = r.x;
    this.rz = r.y;
    this.rf = this.heading;
    if (this.exitPending && Math.abs(this.v) < 0.03 && Math.abs(this.w) < 0.05) {
      this.exitPending = false;
      this.v = this.w = 0;
      this.beginOut();
    }
  }

  /** along controller.path: turn toward the next point (on the spot when it's well off), push when lined up */
  private follow(dt: number): { f: number; turn: number } {
    const ctl = this.d.controller;
    const path = ctl.path!;
    const p = path[0];
    const dx = p.x - ctl.pos.x;
    const dz = p.y - ctl.pos.y;
    const dist = Math.hypot(dx, dz);
    if (dist < (path.length > 1 ? 0.4 : 0.2)) {
      path.shift();
      if (!path.length) ctl.path = null;
      return { f: 0, turn: 0 };
    }
    const err = wrap(Math.atan2(dx, dz) - this.heading);
    this.stuckT = Math.abs(this.v) < 0.05 && Math.abs(this.w) < 0.05 ? this.stuckT + dt : 0;
    if (this.stuckT > 2.5) {
      ctl.path = null;
      this.stuckT = 0;
      return { f: 0, turn: 0 };
    }
    return { f: Math.abs(err) < 0.45 ? 1 : 0, turn: clamp(err * 2, -1, 1) };
  }

  /** stopped dead (put somewhere else): no speed, no stroke under way, hands back to rest */
  private halt() {
    this.v = this.w = 0;
    this.st.phase = 'rest';
    this.st.t = 0;
    this.st.dur = 0;
    this.st.idle = 0;
    for (const h of Object.values(this.handsState)) {
      h.lift = 0;
      h.phiFrom = h.phi;
    }
  }

  private hintOnce(key: string, text: string, ms: number) {
    if (this.time - (this.hintAt.get(key) ?? -1e9) < 3) return;
    this.hintAt.set(key, this.time);
    this.d.hint(text, ms);
  }

  // ───────────────────────────── strokes ─────────────────────────────

  private phase(p: Phase, f = 0, turn = 0, fast = false) {
    const st = this.st;
    st.phase = p;
    st.t = 0;
    for (const h of Object.values(this.handsState)) {
      h.phiFrom = h.phi;
      h.wheelAt = this.wheel[h.side];
    }
    if (p === 'reach' || p === 'push') {
      st.f = f;
      st.turn = turn;
      st.fast = fast;
      st.kind = f > 0 ? (fast ? 'fast' : 'cruise') : f < 0 ? 'back' : 'spin';
      for (const h of Object.values(this.handsState)) {
        // forward: both push; backward: both pull; on the spot: one each way
        h.dir = f !== 0 ? Math.sign(f) : h.side === 'R' ? Math.sign(turn) : -Math.sign(turn);
        h.grab = h.dir > 0 ? RIM.grab : RIM.pullGrab;
        h.release = h.dir > 0 ? RIM.release : RIM.pullRelease;
      }
      // (from the lap, the hands take longer to get to the rims than from resting on them)
      st.dur = p === 'reach' ? (this.armsOn ? 0.18 : 0.42) : STROKE[st.kind].push;
      if (p === 'push') {
        st.count++;
        this.touch();
      }
    } else if (p === 'recover') st.dur = STROKE[st.kind].recover;
    else st.dur = 0;
  }

  private strokes(dt: number, f: number, turn: number, fast: boolean) {
    const st = this.st;
    const intent = f !== 0 || turn !== 0;
    st.idle = intent ? 0 : st.idle + dt;
    const opposing = f !== 0 && Math.abs(this.v) > 0.06 && Math.sign(f) !== Math.sign(this.v);
    const settling = (!intent && st.idle > ROLL.settleAfter && (Math.abs(this.v) > 0.02 || Math.abs(this.w) > 0.03)) || this.exitPending;
    st.t += dt;
    // a hand already where the next stroke takes hold (else it reaches there first)
    const ready = (h: Hand) => {
      const dir = f !== 0 ? Math.sign(f) : h.side === 'R' ? Math.sign(turn) : -Math.sign(turn);
      return Math.abs(h.phi - (dir > 0 ? RIM.grab : RIM.pullGrab)) < 0.2;
    };
    switch (st.phase) {
      case 'rest':
        if (opposing || settling) this.phase('brake');
        else if (intent) this.phase('reach', f, turn, fast);
        break;
      case 'reach':
        if (!intent) this.phase('rest');
        else if (st.t >= st.dur) this.phase('push', f, turn, fast);
        break;
      case 'push': {
        const hs = Object.values(this.handsState);
        if (st.t >= st.dur || hs.every((h) => h.dir * (h.phi - h.release) >= -0.01)) this.phase('recover');
        break;
      }
      case 'recover':
        if (st.t >= st.dur) {
          if (opposing || settling) this.phase('brake');
          else if (intent) {
            const sameWay = (f !== 0 ? Math.sign(f) : 0) === (st.f !== 0 ? Math.sign(st.f) : 0) && (f !== 0 || Math.sign(turn) === Math.sign(st.turn));
            this.phase(sameWay && Object.values(this.handsState).every(ready) ? 'push' : 'reach', f, turn, fast);
          } else this.phase('rest');
        }
        break;
      case 'brake':
        if (!opposing && !settling) this.phase(intent ? 'reach' : 'rest', f, turn, fast);
        break;
    }
    // a push: accelerates toward the hands' top speed, harder the slower you go
    if (st.phase === 'push') {
      const sh = Math.sin(Math.PI * clamp01(st.t / st.dur));
      // (pushing against someone or the stairs: the hands push, the chair doesn't gain speed)
      if (st.f !== 0 && Math.sign(STROKE[st.kind].hand) !== this.blocked) {
        const S = STROKE[st.kind];
        const k = Math.max(0, (S.hand - this.v) / S.hand);
        this.v += S.accel * sh * k * Math.sign(S.hand) * (st.turn ? 0.8 : 1) * dt;
      }
      if (st.turn !== 0) {
        // reversing: A/D steers the rear the way you're going (like a car), not the front
        const turnDir = st.f < 0 ? -st.turn : st.turn;
        const target = turnDir * (st.f ? TURN_MOVING.hand : STROKE.spin.hand);
        const k = Math.max(0, (target - this.w) / target);
        this.w += (st.f ? TURN_MOVING.accel : STROKE.spin.accel) * sh * k * Math.sign(target) * dt;
      }
    }
    // rolling resistance; hands on the rims to brake or settle; a turn straightens when you let go of A/D
    const fr = ROLL.friction + (st.phase === 'brake' ? (opposing ? ROLL.brake : ROLL.settle) : 0);
    this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), fr * dt);
    // pushing straight on: the heading is held hard, so a little drift from one hand doesn't carry on as a curve
    const fw = turn !== 0 && st.phase !== 'brake' ? ROLL.turnFriction : f !== 0 ? ROLL.holdStraight : ROLL.straighten;
    this.w -= Math.sign(this.w) * Math.min(Math.abs(this.w), fw * dt);
    this.v = clamp(this.v, -ROLL.maxBack, ROLL.maxFwd);
    this.w = clamp(this.w, -ROLL.maxTurn, ROLL.maxTurn);
  }

  /** where each hand is on its rim this frame (the IK goes there after the avatar's animation) */
  private handsFrame(dt: number) {
    const st = this.st;
    const u = st.dur > 0 ? clamp01(st.t / st.dur) : 1;
    for (const h of Object.values(this.handsState)) {
      switch (st.phase) {
        case 'push': {
          // in contact: moves with the rim, never slower than the stroke's own pace
          const travel = h.dir * (this.wheel[h.side] - h.wheelAt);
          const arc = Math.abs(h.release - h.grab) * u;
          h.phi = h.grab + h.dir * Math.min(Math.abs(h.release - h.grab), Math.max(travel, arc));
          h.lift = 0;
          h.contact = true;
          break;
        }
        case 'recover': {
          // off the rim and back over it
          const target = h.dir > 0 ? RIM.grab : RIM.pullGrab;
          h.phi = h.phiFrom + (target - h.phiFrom) * smooth(u);
          h.lift = Math.sin(Math.PI * u);
          h.contact = false;
          break;
        }
        case 'reach':
          h.phi = h.phiFrom + (h.grab - h.phiFrom) * smooth(u);
          h.lift = 0.6 * Math.sin(Math.PI * u);
          h.contact = false;
          break;
        case 'brake':
          h.phi += (RIM.brake - h.phi) * Math.min(1, dt * 10);
          h.lift *= Math.max(0, 1 - dt * 12);
          h.contact = true;
          break;
        default:
          h.phi += (RIM.rest - h.phi) * Math.min(1, dt * 6);
          h.lift *= Math.max(0, 1 - dt * 8);
          h.contact = h.lift < 0.05;
      }
    }
    // hands rest in the lap after a while standing still
    this.armsOn = this.state === 'riding' && !(st.phase === 'rest' && st.idle > 2.5 && Math.abs(this.v) < 0.02);
  }

  // ───────────────────────────── moving, with collisions ─────────────────────────────

  /** would rolling 1 cm straight that way run into someone or a step (what stops it, rather than sliding)? */
  private blockedToward(dir: number): boolean {
    const th = this.heading;
    const s = dir * 0.01;
    const res = this.resolveWalls(this.x + Math.sin(th) * s, this.z + Math.cos(th) * s, th);
    if (this.stepAt(res.x, res.z, th) && !this.stepAt(this.x, this.z, th)) return true;
    return this.peopleDepth(res.x, res.z, th) > this.peopleDepth(this.x, this.z, th) + 0.002;
  }

  private move(dt: number) {
    const D = this.model.dims;
    // still pushing against whoever stopped it? (they moved, or you turned: free again)
    if (this.blocked && !this.blockedToward(this.blocked)) this.blocked = 0;
    const th0 = this.heading;
    const x0 = this.x;
    const z0 = this.z;
    // integrate about the rear axle's midpoint (differential drive)
    const ax = x0 + Math.sin(th0) * D.axleZ;
    const az = z0 + Math.cos(th0) * D.axleZ;
    const ds = this.v * dt;
    const dth = this.w * dt;
    if (Math.abs(ds) < 1e-6 && Math.abs(dth) < 1e-6) {
      this.v = Math.abs(this.v) < 1e-4 ? 0 : this.v;
      return;
    }
    let mid = th0 + dth / 2;
    let th1 = th0 + dth;
    let dthA = dth;
    const pose = (h: number, m: number, s: number) => this.resolveWalls(ax + Math.sin(m) * s - Math.sin(h) * D.axleZ, az + Math.cos(m) * s - Math.cos(h) * D.axleZ, h);
    // walls and furniture: rolling into one stops it there (at an angle it slides along it)
    let res = pose(th1, mid, ds);
    // turning into one: the turn goes as far as it can (the footprint swings round to the clear angle),
    // rather than being cancelled whole, which left a chair against a counter unable to turn at all
    if (Math.abs(dth) > 1e-6 && res.push > Math.abs(ds) * 0.95 + 0.002 && pose(th1, th1, 0).push > 0.002) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) / 2;
        if (pose(th0 + dth * m, th0 + dth * m, 0).push <= 0.002) lo = m;
        else hi = m;
      }
      th1 = th0 + dth * lo;
      mid = (th0 + th1) / 2;
      dthA = th1 - th0;
      this.w = 0;
      res = pose(th1, mid, ds);
    }
    // (already in something, e.g. put there: let it out)
    let ok = res.push <= Math.abs(ds) + 0.002 || this.resolveWalls(x0, z0, th0).push > 0.002;
    // a step (the stairs) or someone in the way stops it
    if (ok && this.stepAt(res.x, res.z, th1) && !this.stepAt(x0, z0, th0)) {
      ok = false;
      this.hintOnce('stairs', "A wheelchair can't take the stairs: the elevators are in the lobby", 3200);
    }
    if (ok && this.peopleDepth(res.x, res.z, th1) > this.peopleDepth(x0, z0, th0) + 0.002) ok = false;
    if (!ok) {
      if (Math.abs(ds) > 1e-6) this.blocked = Math.sign(ds);
      this.v = 0;
      this.w = 0;
      return;
    }
    this.blocked = 0;
    // what really rolled (a wall takes the speed into it)
    const ax1 = res.x + Math.sin(th1) * D.axleZ;
    const az1 = res.z + Math.cos(th1) * D.axleZ;
    const along = (ax1 - ax) * Math.sin(mid) + (az1 - az) * Math.cos(mid);
    if (res.push > 0.001) {
      const v = along / Math.max(dt, 1e-4);
      this.v = Math.sign(this.v) === Math.sign(v) ? Math.sign(v) * Math.min(Math.abs(v), Math.abs(this.v)) : 0;
      this.w *= 0.5;
    }
    // each wheel turns by the distance it rolls (left wheel on the inside of a left turn)
    const sL = along - dthA * D.wheelX;
    const sR = along + dthA * D.wheelX;
    this.wheel.L += sL / D.axleY;
    this.wheel.R += sR / D.axleY;
    this.odo += along;
    // casters: each swings round to trail its stem's motion, and rolls
    for (const side of ['L', 'R'] as HandSide[]) {
      const sx = (side === 'L' ? 1 : -1) * 0.25;
      const p0 = this.local(sx, 0.33, new THREE.Vector2(), x0, z0, th0);
      const p1 = this.local(sx, 0.33, new THREE.Vector2(), res.x, res.z, th1);
      const mx = p1.x - p0.x;
      const mz = p1.y - p0.y;
      const dist = Math.hypot(mx, mz);
      if (dist < 1e-5) continue;
      // in the chair frame (after the move)
      const s = Math.sin(th1);
      const c = Math.cos(th1);
      const lx = mx * c - mz * s;
      const lz = mx * s + mz * c;
      const want = Math.atan2(lx, lz);
      const cs = this.caster[side];
      let e = wrap(cs.a - want);
      // dead behind: a nudge decides which way it swings (always the same way for a side)
      if (Math.abs(e) > Math.PI - 0.05) e = (Math.PI - 0.05) * (side === 'L' ? 1 : -1);
      const turnBy = (dist / D.casterTrail) * Math.sin(e);
      cs.a = wrap(cs.a - Math.sign(turnBy) * Math.min(Math.abs(turnBy), Math.abs(e)));
      cs.spin += (dist * Math.cos(wrap(cs.a - want))) / D.casterR;
    }
    this.x = res.x;
    this.z = res.z;
    this.heading = wrap(th1);
    this.y = this.d.groundAt(this.x + Math.sin(this.heading) * FOOT_ZC, this.z + Math.cos(this.heading) * FOOT_ZC, this.y);
  }

  /** push the footprint out of the colliders on this storey (separating axes, three passes) */
  private resolveWalls(x: number, z: number, th: number): { x: number; z: number; push: number } {
    const ux = Math.sin(th);
    const uz = Math.cos(th);
    const hl = FOOT_HL;
    const hw = FOOT.half;
    const ex = Math.abs(ux) * hl + Math.abs(uz) * hw;
    const ez = Math.abs(uz) * hl + Math.abs(ux) * hw;
    const y0 = this.y + 0.05;
    const y1 = this.y + 1.3;
    let px = x;
    let pz = z;
    const out = { x: 0, z: 0 };
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (const b of this.d.built.colliders) {
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        const cx = px + ux * FOOT_ZC;
        const cz = pz + uz * FOOT_ZC;
        if (cx + ex <= b.min.x || cx - ex >= b.max.x || cz + ez <= b.min.z || cz - ez >= b.max.z) continue;
        if (this.boxes.includes(b)) continue;
        if (!sat(cx, cz, ux, uz, hl, hw, b, out)) continue;
        px += out.x;
        pz += out.z;
        any = true;
      }
      if (!any) break;
    }
    const bd = this.d.built.bounds;
    const cx = px + ux * FOOT_ZC;
    const cz = pz + uz * FOOT_ZC;
    px += clamp(cx, bd.minX, bd.maxX) - cx;
    pz += clamp(cz, bd.minZ, bd.maxZ) - cz;
    return { x: px, z: pz, push: Math.hypot(px - x, pz - z) };
  }

  /** a step under the footprint (stairs): any corner, edge or wheel on another height */
  private stepAt(x: number, z: number, th: number): boolean {
    const s = Math.sin(th);
    const c = Math.cos(th);
    const hw = FOOT.half;
    const pts: [number, number][] = [
      [-hw, FOOT.rear], [hw, FOOT.rear], [-hw, FOOT.front], [hw, FOOT.front],
      [0, FOOT.rear], [0, FOOT.front], [-hw, FOOT_ZC], [hw, FOOT_ZC],
      [-0.3, -0.05], [0.3, -0.05], [-0.25, 0.3], [0.25, 0.3], [0, FOOT_ZC],
    ];
    for (const [lx, lz] of pts) {
      const g = this.d.groundAt(x + lx * c + lz * s, z - lx * s + lz * c, this.y);
      if (Math.abs(g - this.y) > 0.03) return true;
    }
    return false;
  }

  /** the people near you as discs: standing (0.25 m), seated (body, knees, feet), on the floor, in a wheelchair */
  private gatherPeople(range: number) {
    const ps = this.people;
    ps.length = 0;
    const cx = this.x;
    const cz = this.z;
    for (const n of this.d.npcs()) {
      if (!n.v.visible) continue;
      const x = n.pos.x;
      const z = n.pos.y;
      if (Math.abs(x - cx) > range || Math.abs(z - cz) > range) continue;
      const fx = Math.sin(n.yaw);
      const fz = Math.cos(n.yaw);
      const amb = n.v.ambient;
      if (n.ch.posture === 'sit' && amb?.props?.includes('wheelchair')) ps.push({ x: x + fx * 0.15, z: z + fz * 0.15, r: 0.42 });
      else if (n.ch.posture === 'sit') {
        ps.push({ x, z, r: 0.24 });
        ps.push({ x: x + fx * 0.32, z: z + fz * 0.32, r: 0.24 });
        ps.push({ x: x + fx * 0.6, z: z + fz * 0.6, r: 0.2 });
      } else if (n.ch.posture === 'lie') {
        if (amb?.act === 'floor' || amb?.act === 'come_round') ps.push({ x: x + fx * 0.75, z: z + fz * 0.75, r: 0.6 });
      } else ps.push({ x, z, r: 0.25 });
    }
  }

  /** how deep the footprint overlaps someone (m, 0 = clear) */
  private peopleDepth(x: number, z: number, th: number, scale = 1): number {
    const ux = Math.sin(th);
    const uz = Math.cos(th);
    const cx = x + ux * FOOT_ZC;
    const cz = z + uz * FOOT_ZC;
    const hl = FOOT_HL * scale;
    const hw = FOOT.half * scale;
    let worst = 0;
    for (const p of this.people) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const lz = dx * ux + dz * uz;
      const lx = dx * uz - dz * ux;
      const qx = clamp(lx, -hw, hw);
      const qz = clamp(lz, -hl, hl);
      const pen = qx === lx && qz === lz ? p.r + Math.min(hw - Math.abs(lx), hl - Math.abs(lz)) : p.r - Math.hypot(lx - qx, lz - qz);
      if (pen > worst) worst = pen;
    }
    return worst;
  }

  /** room for someone on foot (radius r) at (x, z): no wall or furniture, a flat floor, nobody there */
  private free(x: number, z: number, r: number, people: boolean): boolean {
    const y0 = this.y + 0.05;
    const y1 = this.y + 1.8;
    for (const b of this.d.built.colliders) {
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const qx = clamp(x, b.min.x, b.max.x);
      const qz = clamp(z, b.min.z, b.max.z);
      if ((qx - x) ** 2 + (qz - z) ** 2 < r * r) return false;
    }
    if (Math.abs(this.d.groundAt(x, z, this.y) - this.y) > 0.03) return false;
    if (people) for (const p of this.people) if (Math.hypot(p.x - x, p.z - z) < p.r + r - 0.05) return false;
    return true;
  }

  // ───────────────────────────── per frame (World) ─────────────────────────────

  /** after the controller and the storeys moved: the chair, its colliders, the sound */
  frame(dt: number) {
    this.time += dt;
    if (this.state === 'approach') this.approachFrame(dt);
    // keep the rider where the ride put them (another system may have turned the body meanwhile)
    if (this.seated) this.applyRider();
    // a parked chair in an elevator car rides along with it
    if (this.state === 'parked') {
      const g = this.d.groundAt(this.x, this.z, this.y);
      if (Math.abs(g - this.y) > 1e-4 && Math.abs(g - this.y) < 1.6) this.y = g;
    }
    this.place();
    this.updateBoxes();
    this.soundFrame();
  }

  /** the model where the chair is: wheels turned, casters swivelled, footplates up or down */
  private place() {
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.heading;
    m.wheels.L.rotation.x = this.wheel.L;
    m.wheels.R.rotation.x = this.wheel.R;
    for (const side of ['L', 'R'] as HandSide[]) {
      m.casters[side].swivel.rotation.y = this.caster[side].a;
      m.casters[side].wheel.rotation.x = this.caster[side].spin;
      m.plates[side].rotation.z = -(side === 'L' ? 1 : -1) * (Math.PI / 2) * 0.94 * smooth(this.flip);
    }
    // on your storey only (a chair left upstairs isn't drawn from downstairs, nor in its cutaway)
    m.root.visible = !this.lent && (Math.abs(this.y - this.d.floorY()) < 1.5 || this.seated);
    m.root.updateMatrixWorld(true);
  }

  /** the parked chair's footprint as 2 × 3 boxes, so a turned chair is covered closely (walkers bump into them) */
  private cells(out: THREE.Box3[]) {
    const q = new THREE.Vector2();
    const p = new THREE.Vector3();
    const ws = [-BODY.half, 0, BODY.half];
    const ls = [BODY.rear, BODY.rear + (BODY.front - BODY.rear) / 3, BODY.rear + ((BODY.front - BODY.rear) * 2) / 3, BODY.front];
    let i = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 3; b++) {
        const box = out[i++];
        box.makeEmpty();
        for (const lx of [ws[a], ws[a + 1]])
          for (const lz of [ls[b], ls[b + 1]]) {
            this.local(lx, lz, q);
            box.expandByPoint(p.set(q.x, this.y, q.y));
          }
        box.max.y = this.y + 1.0;
      }
  }

  /** someone on foot (radius r) at (x, z) clear of the parked chair's boxes */
  private clearOfChair(x: number, z: number, r: number): boolean {
    const tmp = Array.from({ length: 6 }, () => new THREE.Box3());
    this.cells(tmp);
    return tmp.every((b) => (clamp(x, b.min.x, b.max.x) - x) ** 2 + (clamp(z, b.min.z, b.max.z) - z) ** 2 >= r * r);
  }

  /** the parked chair's boxes for walkers (off while someone is in it), its aim box */
  private updateBoxes() {
    const key = `${this.state === 'parked' && !this.lent ? 1 : 0}|${this.x.toFixed(3)}|${this.z.toFixed(3)}|${this.y.toFixed(3)}|${this.heading.toFixed(3)}`;
    if (key === this.poseKey) return;
    this.poseKey = key;
    const parked = (this.state === 'parked' || this.state === 'approach') && !this.lent;
    this.cells(this.boxes);
    this.box.makeEmpty();
    for (const b of this.boxes) {
      this.box.union(b);
      if (!parked) b.set(this.v1.set(1e6, -1e6, 1e6), this.v2.set(1e6, -1e6, 1e6));
    }
    this.box.getCenter(this.center);
  }

  /** NPC steering: the chair you ride (a bigger player), or the parked one (something to walk round) */
  steerPlayer(): { x: number; z: number; r: number } | null {
    if (!this.seated) return null;
    const c = this.local(0, FOOT_ZC, new THREE.Vector2());
    return { x: c.x, z: c.y, r: 0.55 };
  }

  /**
   * Lend the parked chair (out: a guard wheels it to someone who fainted; crowd.ts draws theirs) or
   * have it back. Only an empty chair standing at home, within a couple of metres of whoever takes it;
   * returns its pose when lent (their copy starts from there), else null.
   */
  lend(out: boolean, near?: { x: number; z: number }): { x: number; z: number; rot: number } | null {
    if (!out) {
      if (this.lent) {
        this.lent = false;
        this.place();
        this.updateBoxes();
      }
      return null;
    }
    const home = this.d.built.details.wheelchairHome;
    if (this.lent || this.state !== 'parked' || Math.hypot(this.x - home.x, this.z - home.z) > 0.05) return null;
    if (near && Math.hypot(near.x - this.x, near.z - this.z) > 2.5) return null;
    this.lent = true;
    this.place();
    this.updateBoxes();
    return { x: this.x, z: this.z, rot: this.heading };
  }

  obstacles(): { x: number; z: number; r: number }[] {
    if (this.lent || this.seated || this.y > 1.5) return [];
    const a = this.local(0, -0.12, new THREE.Vector2());
    const b = this.local(0, 0.34, new THREE.Vector2());
    return [
      { x: a.x, z: a.y, r: 0.38 },
      { x: b.x, z: b.y, r: 0.32 },
    ];
  }

  // ───────────────────────────── the body (after the avatar's animation) ─────────────────────────────

  private rig(av: AvatarCharacter): boolean {
    if (this.bones) return true;
    const r = av.root;
    const get = (re: RegExp) => findBone(r, re);
    const thighL = get(/_L_Thigh$/);
    const thighR = get(/_R_Thigh$/);
    const calfL = get(/_L_Calf$/);
    const calfR = get(/_R_Calf$/);
    const footL = get(/_L_Foot$/);
    const footR = get(/_R_Foot$/);
    const toeL = get(/_L_Toe0$/);
    const toeR = get(/_R_Toe0$/);
    if (!thighL || !thighR || !calfL || !calfR || !footL || !footR || !toeL || !toeR) return false;
    const head = get(/_Head$/);
    this.bones = { thigh: { L: thighL, R: thighR }, calf: { L: calfL, R: calfR }, foot: { L: footL, R: footR }, toe: { L: toeL, R: toeR }, spine: get(/_Spine$/), neck: get(/_Neck$/), head };
    if (head) this.headScale.copy(head.scale);
    return true;
  }

  /** first person while you're in it: your body is drawn (knees, hands on the rims), your head isn't */
  private fpBody(on: boolean) {
    const av = this.d.avatar();
    const head = this.bones?.head;
    if (!av || !head) return;
    if (on) {
      head.scale.copy(this.headScale).multiplyScalar(0.001);
      av.root.visible = true;
    } else if (this.fpOn) {
      head.scale.copy(this.headScale);
      av.root.visible = this.d.cameraMode() !== 'first';
    }
    this.fpOn = on;
  }

  /** World: right after the avatar's animation update (and before the arms are posed: hands.ts) */
  afterAvatar(dt: number) {
    const av = this.d.avatar();
    const seatedNow = this.seated;
    if (!av || !av.ready || !this.rig(av)) {
      if (seatedNow) this.eye.set(0, this.sat || this.state === 'riding' ? 1.21 : 1.62, 0.06);
      return;
    }
    if (!seatedNow) {
      if (this.fpOn) this.fpBody(false);
      this.measureFeet(av, dt);
      return;
    }
    this.fpBody(this.d.cameraMode() === 'first');
    av.root.updateMatrixWorld(true);
    // a lean into each push (and back a touch when braking hard)
    const st = this.st;
    const want = this.state !== 'riding' ? 0 : st.phase === 'push' ? (st.fast ? 0.12 : 0.08) * Math.sin(Math.PI * clamp01(st.t / Math.max(0.01, st.dur))) : st.phase === 'brake' ? -0.02 : 0;
    this.lean += (want - this.lean) * Math.min(1, dt * 10);
    const b = this.bones!;
    const left = this.dirWorld(1, 0, 0, this.v3);
    if (b.spine && Math.abs(this.lean) > 0.002) {
      b.spine.parent!.getWorldQuaternion(this.q1);
      const axis = this.v1.copy(left).applyQuaternion(this.q1.invert()).normalize();
      b.spine.quaternion.premultiply(_q1.setFromAxisAngle(axis, this.lean));
      b.spine.updateMatrixWorld(true);
    }
    // feet on the footplates
    if (this.legW > 0.001) {
      for (const side of ['L', 'R'] as HandSide[]) {
        const s = side === 'L' ? 1 : -1;
        const ankleZ = this.plateZ - this.foot.len / 2 + 0.005;
        const ankle = this.toWorld(s * FOOT_X, this.plateTop + this.foot.ankleH + this.hover, ankleZ, new THREE.Vector3());
        const toe = this.toWorld(s * (FOOT_X + 0.008), this.plateTop + this.foot.toeH + this.hover, ankleZ + this.foot.len, new THREE.Vector3());
        const hip = b.thigh[side].getWorldPosition(new THREE.Vector3());
        const pole = hip.clone().add(this.dirWorld(s * 0.12, 0.25, 1.0, this.v2));
        reachArm({ upper: b.thigh[side], fore: b.calf[side], hand: b.foot[side] }, ankle, pole, this.legW);
        // sole flat on the plate: the foot turned as it was standing (else: its toes pointed where they should)
        const fb = b.foot[side];
        if (this.footRelOk && fb.parent) {
          av.root.getWorldQuaternion(this.q1).multiply(this.footRel[side]);
          fb.parent.getWorldQuaternion(_q2).invert();
          fb.quaternion.slerp(_q2.multiply(this.q1), this.legW);
          fb.updateMatrixWorld(true);
        } else {
          const a = fb.getWorldPosition(this.v1);
          const cur = b.toe[side].getWorldPosition(this.v2).sub(a).normalize();
          turnBone(fb, cur, toe.sub(ankle).normalize(), this.legW);
        }
      }
    }
    // hands on the push rims
    if (this.armsOn) this.reachRims();
    // looking where you're going while you push (the sit clip looks about)
    const pushing = this.state === 'riding' && (Math.abs(this.v) > 0.08 || Math.abs(this.w) > 0.15 || st.phase === 'push' || st.phase === 'recover');
    this.ahead += ((pushing && this.headOk ? 0.85 : 0) - this.ahead) * Math.min(1, dt * 3);
    if (this.ahead > 0.01 && b.head && b.neck) {
      const hf = this.v1.copy(this.headFwd).applyQuaternion(b.head.getWorldQuaternion(this.q1));
      const bf = this.dirWorld(0, 0, 1, this.v2);
      const ang = Math.atan2(hf.z * bf.x - hf.x * bf.z, hf.x * bf.x + hf.z * bf.z) * this.ahead;
      turnAbout(b.neck, UP, ang * 0.4);
      turnAbout(b.head, UP, ang * 0.6);
    }
    // the eyes for the first-person camera (body frame: x to the left, y above the feet, z ahead): from the base
    // of the neck as they were standing (the head's idle sway left out, the lean into a push kept), smoothed
    const ctl = this.d.controller;
    const s = Math.sin(ctl.facing);
    const c = Math.cos(ctl.facing);
    const p = this.headOk && b.neck ? b.neck.getWorldPosition(this.v1) : b.head ? this.eyeOf(b.head, this.dirWorld(0, 0, 1, this.v2), this.v1) : null;
    if (p) {
      const off = this.headOk && b.neck ? this.neckEye : this.v2.set(0, 0, 0);
      const dx = p.x - ctl.pos.x;
      const dz = p.z - ctl.pos.y;
      const ex = dx * c - dz * s + off.x;
      const ey = p.y - ctl.y + off.y;
      const ez = dx * s + dz * c + off.z;
      if (!this.eyeInit) this.eye.set(ex, ey, ez);
      else {
        const k = Math.min(1, dt * 10);
        this.eye.set(this.eye.x + (ex - this.eye.x) * k, this.eye.y + (ey - this.eye.y) * k, this.eye.z + (ez - this.eye.z) * k);
      }
      this.eyeInit = true;
    }
  }

  /** the arm IK goals: each hand on (or just off) its rim, palm on the rim's top, elbow back and out */
  private reachRims() {
    const busy = new Set(this.d.items.heldItems().map((i) => this.d.items.slotOf(i)));
    for (const h of Object.values(this.handsState)) {
      if (busy.has(h.side) || busy.has('both')) continue;
      const sh = this.d.hands.shoulder(h.side, new THREE.Vector3());
      if (!sh) continue;
      // in contact the palm must be on the rim: where the grab point is out of reach (the sit clip sways the
      // shoulder back a little), the hand takes hold a little further along the rim, as a real push does
      const reach = this.d.hands.armReach(h.side);
      if (h.contact && reach) {
        // the nearest reachable spot on the rim: further along at the grab (behind), a little back at the release (in front)
        const ok = (phi: number) => this.rimGoal(h, phi).target.distanceTo(sh) <= reach * 0.985;
        if (!ok(h.phi))
          for (let i = 1; i <= 12; i++) {
            if (ok(h.phi + h.dir * 0.03 * i)) {
              h.phi += h.dir * 0.03 * i;
              break;
            }
            if (ok(h.phi - h.dir * 0.03 * i)) {
              h.phi -= h.dir * 0.03 * i;
              break;
            }
          }
      }
      const { target, q } = this.rimGoal(h, h.phi);
      const pole = sh.add(this.dirWorld(h.s * 0.35, -0.3, -0.5, this.v4));
      this.d.hands.reach(h.side, { target, quat: q, pole, weight: 1 });
    }
  }

  /** a hand's IK goal at rim angle `phi`: the wrist placed so the palm's grip point is on the rim's tube */
  private rimGoal(h: Hand, phi: number): { target: THREE.Vector3; q: THREE.Quaternion } {
    const D = this.model.dims;
    const s = h.s;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    // chair frame: n out from the rim's centre, t along it (forward), l outboard
    const nY = c;
    const nZ = sn;
    const pY = D.axleY + D.rimR * c + nY * 0.075 * h.lift;
    const pZ = D.axleZ + D.rimR * sn + nZ * 0.075 * h.lift;
    const pX = s * (D.rimX + 0.03 * h.lift);
    // fingers forward along the rim and over its outer side; the thumb side inboard
    const fx = s * 0.42;
    const fy = -sn * 0.75 - nY * 0.38;
    const fz = c * 0.75 - nZ * 0.38;
    const fl = Math.hypot(fx, fy, fz);
    const fingers = this.dirWorld(fx / fl, fy / fl, fz / fl, new THREE.Vector3());
    const thumb = this.dirWorld(-s * 0.9, nY * 0.3, nZ * 0.3, new THREE.Vector3()).normalize();
    const q = handQuat(h.side, fingers, thumb, new THREE.Quaternion());
    // the wrist: the palm (its grip point 8.5 cm along the fingers, 1 cm out of the palm) on the rim's tube
    const target = this.toWorld(pX, pY + nY * 0.019, pZ + nZ * 0.019, new THREE.Vector3()).addScaledVector(fingers, -0.085);
    return { target, q };
  }

  // ───────────────────────────── sound ─────────────────────────────

  private buffer(name: 'roll' | 'touch'): AudioBuffer | null {
    const a = sharedAudio(false);
    if (!a) return null;
    const have = this.bufs[name];
    if (have) return have;
    const pcm = name === 'roll' ? rollingLoop(a.ctx.sampleRate) : rimTouch(a.ctx.sampleRate);
    const b = a.ctx.createBuffer(1, pcm.length, a.ctx.sampleRate);
    b.getChannelData(0).set(pcm);
    this.bufs[name] = b;
    return b;
  }

  /** a soft roll while moving (at your ears: you're sitting on it), louder with speed */
  private soundFrame() {
    if (!this.seated) {
      if (this.roll) {
        this.roll.stop(0.3);
        this.roll = null;
      }
      return;
    }
    if (!this.roll || (!this.roll.playing && this.time - this.rollAt > 2)) {
      const b = this.buffer('roll');
      if (!b) return;
      this.roll?.stop(0);
      this.roll = playSound(b, { loop: true, gain: 0, name: 'wheelchair rolling' });
      this.rollAt = this.time;
      this.rollGain = 0;
    }
    const speed = Math.abs(this.v) + Math.abs(this.w) * 0.25;
    const g = speed < 0.02 ? 0 : 0.55 * Math.pow(Math.min(1.5, speed), 0.8);
    if (Math.abs(g - this.rollGain) > 0.01) {
      this.roll.setGain(g);
      this.rollGain = g;
    }
  }

  /** a hand taking hold of the rim */
  private touch() {
    const b = this.buffer('touch');
    if (!b) return;
    const k = this.st.count;
    playSound(b, { gain: 0.3 + 0.08 * ((k * 7) % 3), rate: 0.94 + 0.04 * ((k * 5) % 4), name: 'wheelchair push rim' });
  }

  // ───────────────────────────── tests and debugging (?debug=1) ─────────────────────────────

  /** put the chair somewhere (with you in it if you are): x, z of its seat, heading in degrees (0 = facing +z) */
  moveTo(x: number, z: number, headingDeg: number, y?: number) {
    this.heading = (headingDeg * Math.PI) / 180;
    this.x = x;
    this.z = z;
    this.y = y ?? this.d.groundAt(x, z, this.d.controller.y);
    this.halt();
    if (this.seated) {
      const r = this.local(0, this.rootZ, new THREE.Vector2());
      this.rx = r.x;
      this.rz = r.y;
      this.rf = this.lastRf = this.heading;
      this.applyRider();
      this.d.controller.yaw = this.heading - Math.PI;
    }
    this.place();
    this.updateBoxes();
  }

  /** the colliders on your storey within r of (x, z), as [minX, minZ, maxX, maxZ] (tests) */
  collidersNear(x: number, z: number, r: number): number[][] {
    const out: number[][] = [];
    for (const b of this.d.built.colliders) {
      if (b.max.y <= this.y + 0.05 || b.min.y >= this.y + 1.3 || this.boxes.includes(b)) continue;
      if ((clamp(x, b.min.x, b.max.x) - x) ** 2 + (clamp(z, b.min.z, b.max.z) - z) ** 2 > r * r) continue;
      out.push([b.min.x, b.min.z, b.max.x, b.max.z].map((v) => +v.toFixed(3)));
    }
    return out;
  }

  debug() {
    const av = this.d.avatar();
    const inChair = (p: THREE.Vector3) => {
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      const s = Math.sin(this.heading);
      const c = Math.cos(this.heading);
      return [+(dx * c - dz * s).toFixed(3), +(p.y - this.y).toFixed(3), +(dx * s + dz * c).toFixed(3)];
    };
    let rider: Record<string, unknown> | null = null;
    if (av?.ready && this.bones) {
      av.root.updateMatrixWorld(true);
      const b = this.bones;
      const pel = findBone(av.root, /_Pelvis$/);
      const D = this.model.dims;
      const palms: Record<string, number[]> = {};
      const rimGap: Record<string, number> = {};
      for (const side of ['L', 'R'] as HandSide[]) {
        const p = this.d.hands.palm(side, new THREE.Vector3());
        if (!p) continue;
        const l = inChair(p);
        palms[side] = l;
        // distance from the palm's grip point to the rim's tube (a circle in the plane x = ±rimX)
        const s = side === 'L' ? 1 : -1;
        const radial = Math.hypot(l[1] - D.axleY, l[2] - D.axleZ);
        rimGap[side] = +Math.hypot(l[0] - s * D.rimX, radial - D.rimR).toFixed(3);
      }
      rider = {
        pelvis: pel ? inChair(pel.getWorldPosition(new THREE.Vector3())) : null,
        ankles: (['L', 'R'] as HandSide[]).map((s) => inChair(b.foot[s].getWorldPosition(new THREE.Vector3()))),
        toes: (['L', 'R'] as HandSide[]).map((s) => inChair(b.toe[s].getWorldPosition(new THREE.Vector3()))),
        head: b.head ? inChair(b.head.getWorldPosition(new THREE.Vector3())) : null,
        palms,
        rimGap,
        hands: Object.fromEntries(Object.values(this.handsState).map((h) => [h.side, { phi: +h.phi.toFixed(3), lift: +h.lift.toFixed(3), contact: h.contact }])),
        clip: av.clip,
        posture: av.posture,
      };
    }
    const D = this.model.dims;
    const corners = [
      [-FOOT.half, FOOT.rear],
      [FOOT.half, FOOT.rear],
      [FOOT.half, FOOT.front],
      [-FOOT.half, FOOT.front],
    ].map(([lx, lz]) => {
      const q = this.local(lx, lz, new THREE.Vector2());
      return [+q.x.toFixed(3), +q.y.toFixed(3)];
    });
    return {
      state: this.state,
      /** the world's clock (s of frame time; what moved you is per this) */
      time: this.time,
      x: this.x,
      z: this.z,
      y: this.y,
      heading: (this.heading * 180) / Math.PI,
      v: this.v,
      w: this.w,
      odo: this.odo,
      wheels: { ...this.wheel },
      casters: { L: (this.caster.L.a * 180) / Math.PI, R: (this.caster.R.a * 180) / Math.PI },
      flip: this.flip,
      stroke: { phase: this.st.phase, kind: this.st.kind, count: this.st.count, t: this.st.t, f: this.st.f, turn: this.st.turn, idle: this.st.idle },
      path: this.d.controller.path?.length ?? 0,
      exitPending: this.exitPending,
      footprint: corners,
      dims: { wheelR: D.axleY, track: D.wheelX * 2, seatTop: this.seatTop, seatFront: this.seatFront, backFront: this.backFront, plateTop: this.plateTop, plateZ: this.plateZ, rootZ: this.rootZ, rimR: D.rimR, rimX: D.rimX, axleY: D.axleY, axleZ: D.axleZ },
      eye: this.eye.toArray(),
      armsOn: this.armsOn,
      legW: this.legW,
      rolling: !!this.roll?.playing,
      rollGain: this.rollGain,
      rider,
    };
  }

  /**
   * Skin-level clearances (tests): the rider's skinned surface, CPU-skinned, against the seat, the
   * backrest, the footplates and the side frame, in the chair frame (m; negative = into it).
   */
  clearance(detail = false) {
    const av = this.d.avatar();
    if (!av?.ready) return null;
    av.root.updateMatrixWorld(true);
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const v = new THREE.Vector3();
    const worst: Record<string, { gap: number; at: number[]; mesh: string; bone: string }> = {};
    /** the bone that moves a vertex most */
    const boneOf = (m: THREE.SkinnedMesh, i: number) => {
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      let best = -1;
      let bone = '';
      for (let j = 0; j < 4; j++)
        if (sw.getComponent(i, j) > best) {
          best = sw.getComponent(i, j);
          bone = m.skeleton.bones[si.getComponent(i, j)]?.name ?? '';
        }
      return bone;
    };
    const note = (k: string, gap: number, m: THREE.SkinnedMesh, i: number, at: number[]) => {
      if (worst[k] && worst[k].gap <= gap) return;
      worst[k] = { gap, at: at.map((x) => +x.toFixed(3)), mesh: m.name, bone: detail ? boneOf(m, i) : '' };
    };
    let side = 0;
    let n = 0;
    // the back's profile: the rearmost point (|x| < 0.17) in 5 cm bands from the seat up
    const profile = new Array(12).fill(Infinity) as number[];
    const thighs = new Set(['Bip01_L_Thigh', 'Bip01_R_Thigh']);
    av.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      m.skeleton.update();
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 2) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        const dx = v.x - this.x;
        const dz = v.z - this.z;
        const lx = dx * c - dz * s;
        const ly = v.y - this.y;
        const lz = dx * s + dz * c;
        const at = [lx, ly, lz];
        n++;
        note('floor', ly, m, i, at);
        if (Math.abs(lx) < 0.2 && lz > -0.14 && lz < this.seatFront - 0.03 && ly < 0.75) note('seat', ly - this.seatTop, m, i, at);
        // the thighs' undersides (what rests on the seat; the coat's skirt hangs where it likes)
        if (Math.abs(lx) < 0.2 && lz > 0 && lz < this.seatFront - 0.02 && ly < 0.75 && thighs.has(boneOf(m, i))) note('thighs', ly - this.seatTop, m, i, at);
        if (Math.abs(lx) < 0.17 && ly > 0.62 && ly < 0.93 && lz < 0.1) note('back', lz - this.backFront, m, i, at);
        if (detail && Math.abs(lx) < 0.17 && ly > this.seatTop && ly < this.seatTop + 0.6) {
          const k = Math.floor((ly - this.seatTop) / 0.05);
          profile[k] = Math.min(profile[k], lz - this.backFront);
        }
        if (ly < 0.3 && lz > this.plateZ - 0.09 && lz < this.plateZ + 0.09 && Math.abs(lx) < 0.18) note('feet', ly - this.plateTop, m, i, at);
        if (ly > 0.45 && ly < 0.6 && lz > -0.15 && lz < this.seatFront && Math.abs(lx) > 0.238 && Math.abs(lx) < 0.295) side++;
      }
    });
    const g = (k: string) => (worst[k] ? +worst[k].gap.toFixed(3) : null);
    return { seat: g('seat'), thighs: g('thighs'), back: g('back'), feet: g('feet'), floor: g('floor'), sideFrame: side, vertices: n, ...(detail ? { worst, backProfile: profile.map((z) => +z.toFixed(3)) } : {}) };
  }

  dispose() {
    this.roll?.stop(0);
    this.roll = null;
    if (this.seated) {
      this.d.controller.ride = null;
      this.fpBody(false);
    }
    this.model.root.removeFromParent();
    const cs = this.d.built.colliders;
    for (const b of this.boxes) {
      const i = cs.indexOf(b);
      if (i >= 0) cs.splice(i, 1);
    }
  }
}

/** separating-axis test of the footprint (centre, forward axis u, half length/width) against a box; out = the push out of it */
function sat(cx: number, cz: number, ux: number, uz: number, hl: number, hw: number, b: THREE.Box3, out: { x: number; z: number }): boolean {
  const bx = (b.min.x + b.max.x) / 2;
  const bz = (b.min.z + b.max.z) / 2;
  const ex = (b.max.x - b.min.x) / 2;
  const ez = (b.max.z - b.min.z) / 2;
  const dx = cx - bx;
  const dz = cz - bz;
  let best = Infinity;
  let ax = 0;
  let az = 0;
  // the box's axes, the footprint's forward axis and its left axis (uz, −ux)
  const axes = [1, 0, 0, 1, ux, uz, uz, -ux];
  for (let k = 0; k < 8; k += 2) {
    const a0 = axes[k];
    const a1 = axes[k + 1];
    const rr = hl * Math.abs(ux * a0 + uz * a1) + hw * Math.abs(uz * a0 - ux * a1);
    const rb = ex * Math.abs(a0) + ez * Math.abs(a1);
    const d = dx * a0 + dz * a1;
    const o = rr + rb - Math.abs(d);
    if (o <= 0) return false;
    if (o < best) {
      best = o;
      const sg = d < 0 ? -1 : 1;
      ax = a0 * sg;
      az = a1 * sg;
    }
  }
  out.x = ax * (best + 1e-4);
  out.z = az * (best + 1e-4);
  return true;
}

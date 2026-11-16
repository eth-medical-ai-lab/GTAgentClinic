/**
 * Logging into a workstation: every computer in the ED, the workstations on wheels in the corridor
 * and the medication dispensing cabinet (plans: workstationPlan.ts; screen art: workstationScreen.ts).
 *
 *   E → sit down at its chair (or step up to it where there is none) → the hand taps the badge on
 *   the reader beside the keyboard: its LED goes green with a soft beep → the monitor signs you in
 *   → the camera eases toward the screen → AgentChart (React, ui/EhrTransition.tsx) grows out of
 *   the monitor's projected rectangle. Closing plays it backwards: the UI shrinks into the monitor,
 *   you're signed out (LED off) and stand up.
 *
 * Only clinical workstations take a doctor's badge (access classes: workstationPlan.ts). Front desks
 * and admin screens are staff-only: the reader flashes red with an error beep and whoever works it
 * says so. One somebody is sitting at is in use: you're pointed to the nearest free one.
 *
 * About 1.8 s; E, Esc or a click skips ahead, and with reduced motion it is instant. In first person
 * you drop to seated eye height and see your own hand tap the badge; third person and top-down end
 * over your shoulder. The player's input is held for the whole login and handed back as the UI last
 * asked (World.setInputMode), and every way out restores the camera, so it is never stranded.
 * Walking past a computer never starts it: only E or a click on one does.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LayoutDef } from '../../../shared/layout';
import type { CameraMode } from '../../../shared/types';
import { playSound } from '../audio/soundscape';
import * as S from '../audio/synth';
import { castVoiceOf, neuralVoicesOn, sharedAudio } from '../ui/speech';
import type { BuiltWorld, Interactable } from './builder';
import type { Character } from './characters';
import { lerpAngle, type PlayerController } from './controls';
import type { InteractTarget, WorkstationPhase, WorkstationUi } from './index';
import { G, basic, lambert, own, trackGeo } from './materials';
import type { NavGrid } from './pathfinding';
import { DeskChair, deskChairs } from './workstationChairs';
import { READER, planWorkstations, type WowPlacement, type WsPlan } from './workstationPlan';
import { badgeTexture, disposeLoginScreens, loginScreen, readerFaceTexture, type LoginScreen, type LoginState } from './workstationScreen';
import './workstation.css';

export type ComputerTarget = Extract<InteractTarget, { kind: 'computer' }>;

/** someone in the world: who, and whether they sit (a seated NPC at a workstation is using it) */
export interface Person {
  id: string;
  name: string;
  title: string;
  seated: boolean;
}

export interface WorkstationDeps {
  layout: LayoutDef;
  built: BuiltWorld;
  camera: THREE.PerspectiveCamera;
  controller: PlayerController;
  avatar: Character;
  container: HTMLElement;
  nav: NavGrid;
  /** the carts details.ts parked in the corridor */
  wows: WowPlacement[];
  mode(): CameraMode;
  ceilingAt(x: number, z: number): number;
  /** "HH:MM" on the game clock */
  clock(): string;
  /** the people (NPCs, not walking) within r m of (x, z), nearest first */
  people(x: number, z: number, r: number): Person[];
  /** an NPC's speech bubble */
  say(npcId: string, text: string): void;
  /** take the player's input away (true), or give it back as the UI last asked (false) */
  holdInput(on: boolean): void;
  /** App: 'check' = may the player log in at all (would AgentChart open for them); 'begin' = it starts */
  onBegin(phase: 'check' | 'begin', t: ComputerTarget): boolean;
  /** App: open AgentChart, the zoom has reached the monitor */
  onOpen(t: ComputerTarget): void;
}

interface Device {
  plan: WsPlan;
  /** its E target; the label follows who is using it ("· in use by …") */
  target: ComputerTarget;
  label: string;
  /** the surface the sign-in shows on: the prop's own screen mesh, or (carts) a plane we lay over the laptop's */
  screen: THREE.Mesh;
  overlay: boolean;
  /** the LED's world position and the layer it lives in (station counters are in the cutaway's tall layer) */
  led: THREE.Vector3;
  layer: THREE.Object3D;
  /** where the reader's face is: the badge lands here */
  contact: THREE.Vector3;
  /** its desk chair (rolls back when you get up: workstationChairs.ts) */
  chair?: DeskChair;
}

interface Spot {
  x: number;
  z: number;
  yaw: number;
  seated: boolean;
  /** seat height above the floor */
  seatY: number;
  standUp: { x: number; z: number };
}

interface Session {
  dev: Device;
  spot: Spot;
  phase: 'walk' | 'enter' | 'handoff' | 'open' | 'exit';
  /** timeline origin (s, performance clock): enter = sit-down start, exit = the UI closed */
  t0: number;
  from: { x: number; z: number; facing: number };
  reduced: boolean;
  skipped: boolean;
  sat: boolean;
  stood: boolean;
  ledOn: boolean;
  beeped: boolean;
  /** when the badge was read (s) */
  authAt: number;
  shown: LoginState | null;
  drawnAt: number;
  login: LoginScreen;
  idleMat: THREE.Material | THREE.Material[];
  /** the animated wrist where the tap started, and whether the card is in hand */
  tapFrom: THREE.Vector3 | null;
  card: boolean;
  /** first person: the look-at point eases from the badge reader up to the screen */
  look: THREE.Vector3;
  /** walking up: the path we gave the controller (another path, e.g. a floor click, calls it off) */
  walkPath?: THREE.Vector2[];
  /** sitting down: the chair swivels toward the side you step in from (±1), and was this far out still */
  inSide: number;
  chairFrom: { push: number; turn: number };
  /** getting up from a desk chair: push back and rise, step clear, turn to face the room */
  up?: GetUp;
}

/** getting up from a desk chair: which side you step out to, where you end, facing out from the desk */
interface GetUp {
  stage: 'back' | 'step' | 'turn';
  t0: number;
  side: number;
  to: { x: number; z: number };
  facing: number;
  from?: { x: number; z: number; facing: number };
  path?: THREE.Vector2[];
  /** first person: the view's pitch when you stepped off (it levels out as you go) */
  pitch0?: number;
}

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  fov: number;
}

// ── timing (s) ──
/** from the moment you start sitting down (or squaring up to a standing workstation) */
const SEATED = { settle: 0.45, tap: 0.34, zoom: 0.92, open: 1.48 };
const STANDING = { settle: 0.3, tap: 0.14, zoom: 0.76, open: 1.3 };
/** the badge tap: reach, press, return */
const TAP = { reach: 0.27, hold: 0.11, back: 0.27 };
/** from the moment the UI has shrunk back into the monitor (standing workstations) */
const EXIT = { led: 0.06, cam: 0.5, standing: 0.58 };
/**
 * Getting up from a desk chair, from the same moment: roll the chair back from the desk (swivelling
 * toward the side you'll step out), rise out of it, step clear of it, turn to face the room.
 */
const RISE = { push0: 0.06, push1: 0.44, rise0: 0.32, rise1: 0.84, stepMax: 0.85, turn: 0.36 };
/** how far the chair rolls back (m), how far it swivels (rad); sitting down it rolls out and back in by `IN` */
const PUSH = 0.36;
const SWIVEL = 0.42;
const IN = { push: 0.2, swivel: 0.35 };
/** how long the safety net waits for the UI to take over before logging out again */
const HANDOFF_TIMEOUT = 1.6;

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const newPose = (): Pose => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 });

function mixPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.p.lerpVectors(a.p, b.p, t);
  out.q.slerpQuaternions(a.q, b.q, t);
  out.fov = a.fov + (b.fov - a.fov) * t;
  return out;
}

const _m = new THREE.Matrix4();
function lookPose(out: Pose, from: THREE.Vector3, to: THREE.Vector3, fov: number): Pose {
  out.p.copy(from);
  _m.lookAt(from, to, UP);
  out.q.setFromRotationMatrix(_m);
  out.fov = fov;
  return out;
}

/** vertical field of view (deg) that makes a w × h screen at `dist` fill `fill` of the view */
function fillFov(dist: number, w: number, h: number, aspect: number, fill: number): number {
  const v = 2 * Math.atan(h / 2 / (fill * dist));
  const hz = 2 * Math.atan(w / 2 / (fill * dist) / Math.max(0.3, aspect));
  return THREE.MathUtils.radToDeg(Math.max(v, hz));
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/** turn `bone` (in world space) so that its direction `from` points along `to` */
function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (!bone.parent || from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_a.copy(from).normalize(), _b.copy(to).normalize());
  bone.parent.getWorldQuaternion(_pq);
  // local' = P⁻¹ · q · P · local
  const pInv = _pq.clone().invert();
  bone.quaternion.premultiply(pInv.multiply(_q).multiply(_pq));
  bone.updateMatrixWorld(true);
}

function turnAbout(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_pq);
  _a.copy(axisWorld).applyQuaternion(_pq.invert()).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(_a, angle));
  bone.updateMatrixWorld(true);
}

/** the right arm of a Rocketbox (3ds Max biped) skeleton, plus the bones the tap leans and hides */
interface Rig {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  spine?: THREE.Object3D;
  head?: THREE.Object3D;
  headScale: THREE.Vector3;
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

/** the badge held in the right hand. Natural frame (x toward the thumb, y along the fingers, z out
 *  of the palm) turned into the hand bone's (X fingers, Y palm, Z thumb), as accessories.ts does. */
const CARD = { x: 0.006, y: 0.138, z: 0.022, w: 0.054, h: 0.086 };
const TO_BONE = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));

export class Workstations implements WorkstationUi {
  private devices = new Map<string, Device>();
  private s: Session | null = null;
  private ledOn: THREE.Mesh;
  private card: THREE.Group | null = null;
  private rig: Rig | null | undefined;
  /** the field of view the current camera mode wants (World.applyMode sets it) */
  private liveFov: number;
  private lastMode: CameraMode;
  private live = newPose();
  private target = newPose();
  private view = newPose();
  private cam = newPose();
  private zoom: Pose | null = null;
  private overriding = false;
  private eye = new THREE.Vector3();
  private eyeInit = false;
  private eyeUp = 0.08;
  private bodyShown = false;
  private beeps: { in: AudioBuffer; out: AudioBuffer; deny: AudioBuffer } | null = null;
  private chairs: { x: number; z: number }[];
  /** the desk chairs that roll (by prop id), and the ones pushed back from their desks just now */
  private deskChairs: Map<string, DeskChair>;
  private displaced = new Set<DeskChair>();
  /** refusals: the reader's red LED, a ring on the floor at a free workstation, a line of text */
  private ledRed: THREE.Mesh;
  private ring: THREE.Mesh;
  private noticeEl: HTMLDivElement;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private fx = { redFrom: -1, ringFrom: -1 };
  /** when the E prompts last caught up with who is sitting where (performance clock, s) */
  private usersAt = 0;
  /** debug (?debug=1 → __acWorld.workstation({ slow })): play the login this many times slower, for screenshots */
  private slow = 1;
  private clockAt = { real: performance.now() / 1000, t: performance.now() / 1000 };

  constructor(private d: WorkstationDeps) {
    this.liveFov = d.camera.fov;
    this.lastMode = d.mode();
    this.chairs = d.layout.props.filter((p) => p.kind === 'chair' || p.kind === 'stool' || p.kind === 'cafeChair' || p.kind === 'sofa').map((p) => ({ x: p.x, z: p.z }));
    // desk chairs block you while you stand (after the NPC nav grid was built: NPCs route round their footprints)
    this.deskChairs = deskChairs(d.built.root, d.built.colliders);
    // the chairs are solid now: walks (to a workstation, a floor click) go round them, not into them
    // (a route through Workstation 4's chair stalled the walk to Workstation 3)
    d.nav.addBlockers([...this.deskChairs.values()].map((ch) => ch.box.clone()), 0.18);
    const byKey = new Map(d.built.interactables.map((i) => [i.key, i]));
    const readers = { tall: [] as THREE.BufferGeometry[][], low: [] as THREE.BufferGeometry[][] };
    for (const plan of planWorkstations(d.layout, d.wows)) {
      const target: ComputerTarget = {
        kind: 'computer',
        propId: plan.id,
        label: plan.staff ? `${plan.staff.name} · staff only` : plan.kind === 'desk' ? `Log in to ${plan.label}` : `Log in to the ${plan.label.toLowerCase()} · [F] Inspect`,
        bedside: plan.bedside,
        section: plan.section,
      };
      // the screen: the prop's own, or a sign-in surface laid over the cart's laptop
      let screen = d.built.screens.find((s) => s.prop.id === plan.id)?.mesh;
      let overlay = false;
      if (!screen) {
        screen = new THREE.Mesh(G.plane(plan.screen.w, plan.screen.h), basic('#0b0f12'));
        screen.position.set(plan.screen.x + Math.sin(plan.rot) * 0.004, plan.screen.y, plan.screen.z + Math.cos(plan.rot) * 0.004);
        screen.rotation.y = plan.rot;
        screen.visible = false;
        d.built.root.add(screen);
        overlay = true;
      }
      // a station counter's things hide with the tall layer in the cutaway view, like its computer
      const tall = plan.kind === 'desk' && plan.y > 0.9;
      const layer = tall ? d.built.tall : d.built.root;
      const parts = readerParts(plan);
      (tall ? readers.tall : readers.low).push(parts.geos);
      this.devices.set(plan.id, { plan, target, label: target.label, screen, overlay, led: parts.led, layer, contact: parts.contact, chair: plan.seat ? this.deskChairs.get(plan.seat.id) : undefined });
      // E on it: the computers that were dead, the cart and the cabinet (look-only before) all log in now
      const it = byKey.get(`prop:${plan.id}`) ?? byKey.get(`fx:${plan.id}`);
      if (it) it.target = target;
      else {
        const box = deviceBox(plan);
        d.built.interactables.push({ key: `prop:${plan.id}`, target, box, center: box.getCenter(new THREE.Vector3()) } satisfies Interactable);
      }
    }
    // readers: three merged meshes per layer (body, face, dark LED), however many workstations
    const bodyMat = lambert('#2b3135', { roughness: 0.42 });
    const faceMat = own(new THREE.MeshStandardMaterial({ map: readerFaceTexture(), roughness: 0.38 }));
    const ledOffMat = lambert('#1d2a22', { roughness: 0.25, emissive: '#0b1a10', emissiveIntensity: 0.4 });
    for (const [key, list] of Object.entries(readers)) {
      if (!list.length) continue;
      const layer = key === 'tall' ? d.built.tall : d.built.root;
      [bodyMat, faceMat, ledOffMat].forEach((mat, i) => {
        const g = mergeGeometries(list.map((parts) => parts[i]), false);
        list.forEach((parts) => parts[i].dispose());
        if (!g) return;
        const m = new THREE.Mesh(trackGeo(g), mat);
        m.name = `ws-readers-${key}-${i}`;
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
        layer.add(m);
      });
    }
    // the one LED that is lit: the signed-in reader's
    const on = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 3.4, 0.9), toneMapped: true });
    this.ledOn = new THREE.Mesh(G.box(0.0165, 0.0042, 0.0075), own(on));
    this.ledOn.visible = false;
    this.ledOn.name = 'ws-led-on';
    // access denied: the same LED, red
    this.ledRed = new THREE.Mesh(G.box(0.0165, 0.0042, 0.0075), own(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.18, 0.12) })));
    this.ledRed.visible = false;
    this.ledRed.name = 'ws-led-red';
    // "that one's free": a soft ring on the floor where you'd sit
    const ringMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 1.45), transparent: true, opacity: 0, depthWrite: false }));
    this.ring = new THREE.Mesh(G.torus(0.36, 0.022, 6, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.name = 'ws-free-ring';
    d.built.root.add(this.ring);
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'ws-notice';
    d.container.appendChild(this.noticeEl);
  }

  // ───────────────────────────── API for World ─────────────────────────────

  /** E (or a click) on a computer: start logging in. false = not ours (or not allowed now). */
  begin(t: ComputerTarget): boolean {
    const dev = this.devices.get(t.propId);
    if (!dev) return false;
    if (this.s && this.s.phase !== 'walk') return true;
    // a new E calls off a walk-up in progress
    if (this.s) {
      this.s = null;
      this.d.controller.path = null;
      this.listen(false);
    }
    if (!this.d.onBegin('check', dev.target)) return false;
    // a front desk or admin screen: your badge has no access there
    if (dev.plan.access === 'staff') {
      this.s = null;
      this.refuse(dev, null);
      return true;
    }
    // someone is working at it
    const user = this.userAt(dev);
    if (user) {
      this.s = null;
      this.refuse(dev, user);
      return true;
    }
    const spot = this.chooseSpot(dev.plan);
    const c = this.d.controller;
    // a desk chair is sat in from its side (or front), never through its back
    const to = this.approach(dev, spot);
    const dist = Math.hypot(to.x - c.pos.x, to.z - c.pos.y);
    const reduced = reducedMotion();
    this.s = null;
    if (!reduced && dist > 0.45) {
      // walk up first, as an ordinary walk: steering with WASD takes over and calls it off
      const path = this.d.nav.findPath(c.pos.x, c.pos.y, to.x, to.z);
      if (path && path.length) {
        c.path = path;
        c.pathRun = false;
        this.s = { ...this.session(dev, spot, 'walk', reduced), walkPath: path };
        // E, Esc or a click skips ahead from here too
        this.listen(true);
        return true;
      }
      if (dist > 1.6) return false;
    }
    return this.start(dev, spot, reduced);
  }

  /** per frame, after the avatar has animated: body, badge tap, screen, camera */
  frame(dt: number) {
    if (this.fx.redFrom >= 0 || this.fx.ringFrom >= 0) this.effects();
    // a chair you got up from rolls back in once you've walked off (or someone comes to sit in it)
    if (this.displaced.size) {
      const c = this.d.controller;
      const real = performance.now() / 1000;
      for (const ch of this.displaced) {
        if (this.s && this.s.phase !== 'walk' && this.s.dev.chair === ch) continue;
        const away = Math.hypot(ch.home.x - c.pos.x, ch.home.z - c.pos.y) > 1.05 && real - ch.leftAt > 0.8;
        ch.settle(real, away || this.d.people(ch.home.x, ch.home.z, 0.7).length > 0);
        if (ch.push <= 1e-4 && Math.abs(ch.turn) <= 1e-4 && !ch.rollIn) this.displaced.delete(ch);
      }
    }
    // twice a second: a workstation somebody sits at says so in its E prompt
    const real = performance.now() / 1000;
    if (real - this.usersAt > 0.5) {
      this.usersAt = real;
      for (const dev of this.devices.values()) {
        if (dev.plan.access !== 'clinical') continue;
        const user = this.userAt(dev);
        dev.target.label = user ? `${dev.plan.label} · in use by ${user.name}` : dev.label;
      }
    }
    const s = this.s;
    if (!s) return;
    const now = this.now();
    if (s.phase === 'walk') return this.walk(s);
    const mode = this.d.mode();
    // a camera-mode switch resets the field of view to that mode's (World.applyMode); take it as the base
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.liveFov = this.d.camera.fov;
      this.zoom = null;
    }
    const cam = this.d.camera;
    this.live.p.copy(cam.position);
    this.live.q.copy(cam.quaternion);
    this.live.fov = this.liveFov;
    if (s.phase === 'enter') this.enter(s, now, dt, mode);
    else if (s.phase === 'exit') this.exit(s, now, dt, mode);
    else this.hold(s, now, dt, mode);
  }

  /**
   * Where to walk to before sitting down: the seat itself if you're at it or in front of it, else the
   * side of its desk chair you're on (stepping in sideways as it swivels), never through its back.
   */
  private approach(dev: Device, spot: Spot): { x: number; z: number } {
    const c = this.d.controller;
    if (!spot.seated || !dev.chair) return { x: spot.x, z: spot.z };
    const rot = dev.plan.rot;
    const dx = c.pos.x - spot.x;
    const dz = c.pos.y - spot.z;
    const behind = dx * Math.sin(rot) + dz * Math.cos(rot);
    if (Math.hypot(dx, dz) <= 0.35 || behind < -0.1) return { x: spot.x, z: spot.z };
    const side = this.chairSide(dev, IN.push, dx * Math.cos(rot) - dz * Math.sin(rot) < 0 ? -1 : 1);
    return side ?? { x: spot.x, z: spot.z };
  }

  /**
   * The side of a desk chair you step in from or out to: beside its seat with the chair rolled back
   * `push` m, clear of it, of furniture and of people; the side `prefer` first, then the other, then
   * behind it. Null if all three are taken.
   */
  private chairSide(dev: Device, push: number, prefer: number): { side: number; x: number; z: number } | null {
    const pl = dev.plan;
    if (!pl.seat) return null;
    const nx = Math.sin(pl.rot);
    const nz = Math.cos(pl.rot);
    const tx = Math.cos(pl.rot);
    const tz = -Math.sin(pl.rot);
    const cx = pl.seat.x + nx * push;
    const cz = pl.seat.z + nz * push;
    const ok = (x: number, z: number) => this.clear(x, z, 0.3, dev.chair) && Math.hypot(x - cx, z - cz) >= 0.55 && !this.d.people(x, z, 0.5).length;
    // the side with room ahead (into the room) wins: you step out, turn, and can walk off
    const room = (x: number, z: number) => [0.55, 0.9].filter((d) => this.clear(x + nx * d, z + nz * d, 0.3, dev.chair)).length;
    const first = prefer < 0 ? -1 : 1;
    let best: { side: number; x: number; z: number; room: number } | null = null;
    for (const side of [first, -first]) {
      const x = cx + tx * side * 0.6 - nx * 0.05;
      const z = cz + tz * side * 0.6 - nz * 0.05;
      if (!ok(x, z)) continue;
      const r = room(x, z);
      if (!best || r > best.room) best = { side, x, z, room: r };
    }
    if (best) return best;
    const bx = cx + nx * 0.66;
    const bz = cz + nz * 0.66;
    return ok(bx, bz) ? { side: first, x: bx, z: bz } : null;
  }

  /** the cutaway (dollhouse) view while we fly the camera: walls come back once it is under the ceiling */
  cutaway(): boolean | null {
    if (!this.overriding) return null;
    const p = this.cam.p;
    return p.y > this.d.ceilingAt(p.x, p.z) - 0.08;
  }

  /**
   * World.setInputMode asks first: true = the login holds the input (World applies the mode when it
   * is over). A full-screen panel opening mid-login calls the login off and stands you back up.
   */
  holdsInput(mode: 'full' | 'walk' | 'none'): boolean {
    const s = this.s;
    if (!s) return false;
    if (s.phase === 'walk') {
      if (mode === 'none') {
        this.s = null;
        this.listen(false);
      }
      return false;
    }
    if (s.phase === 'enter' && mode !== 'full') {
      this.release(true);
      return false;
    }
    return true;
  }

  /** F on a device that used to be look-only (cart, dispenser): its description */
  inspectSubject(propId: string): string | null {
    return this.devices.get(propId)?.plan.inspect ?? null;
  }

  // ───────────────────────────── API for the UI (WorkstationUi) ─────────────────────────────

  phase(): WorkstationPhase {
    const p = this.s?.phase;
    return !p || p === 'walk' ? 'idle' : p;
  }

  screenQuad(): [number, number][] | null {
    const s = this.s;
    if (!s || (s.phase !== 'handoff' && s.phase !== 'open' && s.phase !== 'exit')) return null;
    const m = s.dev.screen;
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox!;
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    m.updateMatrixWorld();
    const r = this.d.container.getBoundingClientRect();
    return ([[b.min.x, b.max.y], [b.max.x, b.max.y], [b.max.x, b.min.y], [b.min.x, b.min.y]] as const).map(([x, y]) => {
      const v = _e.set(x, y, 0).applyMatrix4(m.matrixWorld).project(cam);
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height] as [number, number];
    });
  }

  morphMs(dir: 'in' | 'out'): number {
    const s = this.s;
    if (!s || s.reduced) return 0;
    return (dir === 'in' ? (s.skipped ? 160 : 380) : 300) * this.slow;
  }

  ui(state: 'open' | 'closed' | 'abort') {
    const s = this.s;
    if (!s || s.phase === 'walk') return;
    if (state === 'open') {
      if (s.phase === 'handoff') s.phase = 'open';
    } else if (state === 'abort') this.release(true);
    else if (s.phase === 'open' || s.phase === 'handoff') {
      if (s.reduced) return this.release(true);
      s.phase = 'exit';
      s.t0 = this.now();
      this.listen(true);
      const c = this.d.controller;
      // from a chair: roll back, rise, step clear, turn to the room (planned now, where there's room)
      if (s.spot.seated) {
        s.up = this.getUp(s, s.t0);
        if (this.d.mode() === 'third') c.pitch = -0.16;
        return;
      }
      // standing: you'll be looking at the screen
      c.yaw = s.spot.yaw + Math.PI;
      const pl = s.dev.plan;
      c.pitch = Math.max(-0.62, Math.min(0.05, Math.atan2(pl.screen.y - (c.y + 1.65), Math.hypot(pl.screen.x - s.spot.x, pl.screen.z - s.spot.z))));
      if (this.d.mode() === 'third') c.pitch = -0.16;
    }
  }

  /** for tests (?debug=1); `slow` plays the login that many times slower (screenshots of each step) */
  debug(opts: { slow?: number; use?: string } = {}) {
    if (opts.slow !== undefined) this.slow = Math.max(1, opts.slow);
    // as if E were pressed on it (tests in third person / top-down, where aiming the crosshair is fiddly)
    const use = opts.use ? this.devices.get(opts.use) : undefined;
    if (use) this.begin(use.target);
    const s = this.s;
    const av = this.d.avatar as Character & { clip?: string };
    const pel = av.root.getObjectByName('Bip01_Pelvis') ?? findBone(av.root, /_Pelvis$/);
    const v3 = (o: THREE.Object3D | null | undefined) => (o ? o.getWorldPosition(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)) : null);
    const c = this.d.controller;
    return {
      player: { x: +c.pos.x.toFixed(3), z: +c.pos.y.toFixed(3), facing: +c.facing.toFixed(3) },
      notice: this.noticeEl.classList.contains('on') ? this.noticeEl.textContent : null,
      red: this.ledRed.visible,
      ring: this.ring.visible ? this.ring.position.toArray().map((n) => +n.toFixed(2)) : null,
      hand: v3(this.rig?.hand),
      badge: this.card?.parent ? v3(this.card.children[0]) : null,
      reader: s ? s.dev.contact.toArray().map((n) => +n.toFixed(3)) : null,
      phase: s?.phase ?? 'idle',
      id: s?.dev.plan.id ?? null,
      seated: s?.spot.seated ?? false,
      led: this.ledOn.visible,
      screen: s?.shown ?? null,
      posture: av.posture,
      clip: av.clip ?? null,
      pelvisY: pel ? pel.getWorldPosition(new THREE.Vector3()).y : null,
      camY: this.d.camera.position.y,
      fov: this.d.camera.fov,
      quad: this.screenQuad(),
      devices: [...this.devices.values()].map((v) => ({ id: v.plan.id, kind: v.plan.kind, access: v.plan.access, label: v.plan.label, seat: v.plan.seat?.id ?? null, user: this.userAt(v)?.name ?? null, screen: { x: v.plan.screen.x, y: v.plan.screen.y, z: v.plan.screen.z }, rot: v.plan.rot, chair: v.chair ? { push: +v.chair.push.toFixed(3), turn: +v.chair.turn.toFixed(3), solid: v.chair.solid, ...v.chair.center() } : null })),
    };
  }

  dispose() {
    this.listen(false);
    this.d.container.classList.remove('ws-on');
    clearTimeout(this.noticeTimer);
    this.noticeEl.remove();
    disposeLoginScreens();
    this.s = null;
  }

  // ───────────────────────────── the sequence ─────────────────────────────

  /** the login's clock (s): real time, or slowed down for screenshots */
  private now(): number {
    const real = performance.now() / 1000;
    this.clockAt.t += (real - this.clockAt.real) / this.slow;
    this.clockAt.real = real;
    return this.clockAt.t;
  }

  private session(dev: Device, spot: Spot, phase: Session['phase'], reduced: boolean): Session {
    const c = this.d.controller;
    const geo = dev.screen.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    return {
      dev,
      spot,
      phase,
      t0: this.now(),
      from: { x: c.pos.x, z: c.pos.y, facing: c.facing },
      reduced,
      skipped: false,
      sat: false,
      stood: false,
      ledOn: false,
      beeped: false,
      authAt: 0,
      shown: null,
      drawnAt: 0,
      login: loginScreen(bb.max.x - bb.min.x, bb.max.y - bb.min.y),
      idleMat: dev.screen.material,
      tapFrom: null,
      card: false,
      look: new THREE.Vector3(),
      inSide: 0,
      chairFrom: { push: dev.chair?.push ?? 0, turn: dev.chair?.turn ?? 0 },
    };
  }

  /** walking up to it (an ordinary walk); sit down once there */
  private walk(s: Session) {
    const c = this.d.controller;
    // steering, a panel taking the input, or a walk somewhere else (a floor click) calls it off
    if (c.steering || !c.enabled || (c.path && c.path !== s.walkPath)) {
      this.s = null;
      this.listen(false);
      return;
    }
    if (c.path) return;
    this.s = null;
    this.listen(false);
    // got stuck on the way? say so (it used to give up without a word)
    if (Math.hypot(s.spot.x - c.pos.x, s.spot.z - c.pos.y) > 1.3) {
      this.notice('↪', `Couldn't get to ${s.dev.label} from here`, 'Walk up to it and press E again');
      return;
    }
    this.start(s.dev, this.chooseSpot(s.dev.plan), s.reduced);
  }

  private start(dev: Device, spot: Spot, reduced: boolean): boolean {
    // taken while you walked up?
    const user = this.userAt(dev);
    if (user) {
      this.s = null;
      this.refuse(dev, user);
      return true;
    }
    if (!this.d.onBegin('begin', dev.target)) {
      this.s = null;
      return false;
    }
    const s = this.session(dev, spot, 'enter', reduced);
    this.s = s;
    // a desk chair: you're in it now (it stops blocking you); it swivels toward the side you step in from
    const chair = spot.seated ? dev.chair : undefined;
    if (chair) {
      chair.rollIn = null;
      this.displaced.delete(chair);
      chair.setSolid(false);
      const c = this.d.controller;
      const lat = (c.pos.x - spot.x) * Math.cos(dev.plan.rot) - (c.pos.y - spot.z) * Math.sin(dev.plan.rot);
      s.inSide = Math.abs(lat) > 0.2 ? Math.sign(lat) : 0;
    }
    this.d.holdInput(true);
    this.d.container.classList.add('ws-on');
    this.liveFov = this.d.camera.fov;
    this.lastMode = this.d.mode();
    this.zoom = null;
    this.eyeInit = false;
    // how far your eyes sit above the head bone (measured standing; the first-person camera is at 1.65 m)
    const av = this.d.avatar as Character & { ready?: boolean };
    if (av.ready) {
      av.root.updateMatrixWorld(true);
      const hy = av.head.getWorldPosition(_a).y - this.d.controller.y;
      this.eyeUp = Math.max(0, Math.min(0.15, 1.65 - hy));
    }
    // the screen wakes to the sign-in, the cart's laptop gets its overlay
    dev.screen.material = s.login.material;
    dev.screen.visible = true;
    this.draw(s, 'lock', 0);
    this.listen(true);
    if (reduced) this.finishEnter(s);
    return true;
  }

  private enter(s: Session, now: number, dt: number, mode: CameraMode) {
    const T = s.spot.seated ? SEATED : STANDING;
    const t = now - s.t0;
    const c = this.d.controller;
    // ── body: onto the seat (or square up), turning to the screen ──
    const k = ease(t / T.settle);
    let sx = s.spot.x;
    let sz = s.spot.z;
    let swivel = 0;
    const chair = s.spot.seated ? s.dev.chair : undefined;
    if (chair) {
      // the chair rolls out a little and turns to you as you step in, then rolls in with you
      const bump = Math.sin(Math.PI * clamp01(t / T.settle));
      chair.pose(IN.push * bump + s.chairFrom.push * (1 - k), -s.inSide * IN.swivel * bump + s.chairFrom.turn * (1 - k), { x: Math.sin(s.dev.plan.rot), z: Math.cos(s.dev.plan.rot) });
      ({ x: sx, z: sz } = chair.center());
      swivel = chair.turn * 0.85;
    }
    this.place(s.from.x + (sx - s.from.x) * k, s.from.z + (sz - s.from.z) * k, lerpAngle(s.from.facing, s.spot.yaw + swivel, k), mode);
    if (s.spot.seated && !s.sat) {
      const av = this.d.avatar;
      av.seatKind = 'desk';
      av.setPosture('sit', undefined, s.spot.seatY);
      s.sat = true;
    }
    if (mode === 'third') {
      // swing the camera round behind you, looking at the desk
      c.yaw = lerpAngle(c.yaw, s.spot.yaw + Math.PI, Math.min(1, dt * 6));
      c.pitch += (-0.2 - c.pitch) * Math.min(1, dt * 6);
    }
    // ── the badge ──
    this.tap(s, now, t - T.tap, mode);
    // ── the screen ──
    if (s.ledOn && s.shown === 'auth' && now - s.drawnAt > 0.045) this.draw(s, 'auth', clamp01((now - s.authAt) / 0.32));
    if (t >= T.zoom + 0.03 && s.shown !== 'chart') this.draw(s, 'chart', 1);
    // ── the camera ──
    const zk = easeInOut((t - T.zoom) / (T.open - T.zoom));
    if (zk > 0 && !this.zoom) this.zoom = this.zoomPose(s, mode);
    let w: number;
    if (mode === 'first') {
      this.eyeView(s, dt, t < T.tap + TAP.reach + 0.1 ? 0 : clamp01((t - (T.tap + TAP.reach + 0.1)) / 0.32), this.view);
      if (zk > 0 && this.zoom) mixPose(this.view, this.zoom, zk, this.target);
      else copyPose(this.view, this.target);
      w = ease(t / T.settle);
    } else {
      if (this.zoom) copyPose(this.zoom, this.target);
      w = zk;
    }
    this.apply(w);
    if (t >= T.open) this.handoff(s, now);
  }

  /** the UI has (or is about to have) the screen: hold the view on the monitor */
  private hold(s: Session, now: number, dt: number, mode: CameraMode) {
    this.place(s.spot.x, s.spot.z, s.spot.yaw, mode);
    this.firstPersonBody(false);
    if (!this.zoom) this.zoom = this.zoomPose(s, mode);
    copyPose(this.zoom, this.target);
    this.apply(1);
    void dt;
    // safety net: nobody took over (App refused): sign out again
    if (s.phase === 'handoff' && now - s.t0 > HANDOFF_TIMEOUT) this.ui('closed');
  }

  private exit(s: Session, now: number, dt: number, mode: CameraMode) {
    if (s.up) return this.getUpFrame(s, s.up, now, dt, mode);
    // a standing workstation: off the monitor, and you're back
    const t = now - s.t0;
    if (t >= EXIT.led && s.ledOn) {
      this.signOut(s);
      this.draw(s, 'signout', 1);
    }
    this.place(s.spot.x, s.spot.z, s.spot.yaw, mode);
    if (!this.zoom) this.zoom = this.zoomPose(s, mode);
    let w: number;
    if (mode === 'first') {
      this.eyeView(s, dt, 1, this.view);
      mixPose(this.zoom, this.view, easeInOut(t / EXIT.cam), this.target);
      w = 1 - ease((t - 0.22) / 0.34);
    } else {
      copyPose(this.zoom, this.target);
      w = 1 - easeInOut(t / 0.5);
    }
    this.apply(w);
    if (t >= EXIT.standing) this.release(false);
  }

  /** plan getting up: the side with room to step out (the one you came in from first), facing the room */
  private getUp(s: Session, now: number): GetUp {
    const pl = s.dev.plan;
    const facing = Math.atan2(Math.sin(pl.rot), Math.cos(pl.rot));
    const out = this.chairSide(s.dev, PUSH, s.inSide || 1);
    if (out) return { stage: 'back', t0: now, side: out.side, to: { x: out.x, z: out.z }, facing };
    // boxed in on both sides and behind (people standing about): straight back, as far as it's free
    const nx = Math.sin(pl.rot);
    const nz = Math.cos(pl.rot);
    let d = 0.66;
    while (d < 1.2 && !this.clear(s.spot.x + nx * (PUSH + d), s.spot.z + nz * (PUSH + d), 0.3, s.dev.chair)) d += 0.06;
    return { stage: 'back', t0: now, side: s.inSide || 1, to: { x: s.spot.x + nx * (PUSH + d), z: s.spot.z + nz * (PUSH + d) }, facing };
  }

  /**
   * Getting up from a desk chair: roll it back from the desk, swivelling toward the side you'll step
   * out; rise out of it over your feet (the camera rises with your eyes in first person); step clear
   * of it (an ordinary walk, legs and all); turn to face the room.
   */
  private getUpFrame(s: Session, u: GetUp, now: number, dt: number, mode: CameraMode) {
    const c = this.d.controller;
    const pl = s.dev.plan;
    const chair = s.dev.chair;
    const t = now - u.t0;
    if (!this.zoom) this.zoom = this.zoomPose(s, mode);
    if (u.stage === 'back') {
      if (t >= EXIT.led && s.ledOn) {
        this.signOut(s);
        this.draw(s, 'signout', 1);
      }
      const kp = easeInOut((t - RISE.push0) / (RISE.push1 - RISE.push0));
      const swivel = -u.side * SWIVEL * kp;
      const n = { x: Math.sin(pl.rot), z: Math.cos(pl.rot) };
      let cx = s.spot.x + n.x * PUSH * kp;
      let cz = s.spot.z + n.z * PUSH * kp;
      if (chair) {
        chair.pose(PUSH * kp, swivel, n);
        ({ x: cx, z: cz } = chair.center());
      }
      if (t >= RISE.rise0 && !s.stood) {
        this.d.avatar.setPosture('stand');
        s.stood = true;
      }
      const kr = ease((t - RISE.rise0) / (RISE.rise1 - RISE.rise0));
      const facing = s.spot.yaw + swivel * 0.85;
      this.place(cx + Math.sin(facing) * 0.2 * kr, cz + Math.cos(facing) * 0.2 * kr, facing, mode);
      let w: number;
      if (mode === 'first') {
        this.eyeView(s, dt, 1, this.view);
        mixPose(this.zoom, this.view, easeInOut(t / EXIT.cam), this.target);
        w = 1;
      } else {
        copyPose(this.zoom, this.target);
        w = 1 - easeInOut(t / 0.6);
      }
      this.apply(w);
      if (t >= RISE.rise1) {
        const path = [new THREE.Vector2(u.to.x, u.to.z)];
        c.path = path;
        c.pathRun = false;
        u.path = path;
        u.stage = 'step';
        u.t0 = now;
        // first person: from looking at the screen to looking ahead, on the way
        u.pitch0 = Math.asin(Math.max(-1, Math.min(1, this.d.camera.getWorldDirection(_e).y)));
      }
      return;
    }
    if (u.stage === 'step') {
      // the controller walks you there; first person turns toward the room on the way
      if (mode === 'first') c.yaw = lerpAngle(c.yaw, u.facing + Math.PI, Math.min(1, dt * 5));
      if (mode === 'first') {
        const p0 = u.pitch0 ?? -0.3;
        this.eyeAlong(s, dt, c.facing, p0 + (-0.06 - p0) * ease(clamp01(t / RISE.stepMax) * 1.6), this.target);
        this.apply(1);
      } else this.apply(0);
      if (!c.path || c.path !== u.path || t > RISE.stepMax) {
        c.path = null;
        u.from = { x: c.pos.x, z: c.pos.y, facing: c.facing };
        u.stage = 'turn';
        u.t0 = now;
        c.pitch = -0.06;
      }
      return;
    }
    // turn to face the room (and into your own camera again)
    const k = ease(t / RISE.turn);
    const f = u.from!;
    const facing = lerpAngle(f.facing, u.facing, k);
    this.place(f.x + (u.to.x - f.x) * k, f.z + (u.to.z - f.z) * k, facing, mode);
    c.pitch = -0.06;
    if (mode === 'first') {
      this.eyeAlong(s, dt, facing, -0.06, this.target);
      this.apply(1 - k);
    } else this.apply(0);
    if (t >= RISE.turn) this.release(false);
  }

  /** E / Esc / click: jump to the end of whatever is playing */
  private skip() {
    const s = this.s;
    if (!s) return;
    if (s.phase === 'walk') {
      // still walking up: sit down and log in at once
      this.s = null;
      this.d.controller.path = null;
      this.start(s.dev, this.chooseSpot(s.dev.plan), s.reduced);
      if (this.s && (this.s as Session).phase === 'enter') this.finishEnter(this.s);
    } else if (s.phase === 'enter') this.finishEnter(s);
    else if (s.phase === 'exit') this.release(true);
  }

  /** the end of the login, at once (skipped, or reduced motion) */
  private finishEnter(s: Session) {
    const mode = this.d.mode();
    s.skipped = true;
    this.endTap(s);
    if (s.spot.seated && !s.sat) {
      this.d.avatar.seatKind = 'desk';
      this.d.avatar.setPosture('sit', undefined, s.spot.seatY);
      s.sat = true;
    }
    if (s.spot.seated) s.dev.chair?.pose(0, 0);
    this.place(s.spot.x, s.spot.z, s.spot.yaw, mode);
    if (!s.ledOn) this.signIn(s, this.now());
    this.draw(s, 'chart', 1);
    this.zoom = this.zoomPose(s, mode);
    copyPose(this.zoom, this.target);
    this.live.p.copy(this.d.camera.position);
    this.live.q.copy(this.d.camera.quaternion);
    this.live.fov = this.liveFov;
    this.apply(1);
    this.handoff(s, this.now());
  }

  private handoff(s: Session, now: number) {
    this.endTap(s);
    s.phase = 'handoff';
    s.t0 = now;
    this.listen(false);
    this.d.onOpen(s.dev.target);
  }

  /** put everything back; `instant` = from wherever we are (aborted, skipped, reduced motion) */
  private release(instant: boolean) {
    const s = this.s;
    if (!s) return;
    this.listen(false);
    this.endTap(s);
    if (s.ledOn) this.signOut(s, !instant);
    s.dev.screen.material = s.idleMat;
    if (s.dev.overlay) s.dev.screen.visible = false;
    const av = this.d.avatar;
    if (av.posture !== 'stand') av.setPosture('stand');
    const mode = this.d.mode();
    const c = this.d.controller;
    if (s.phase !== 'walk') {
      if (s.spot.seated) {
        // out of the chair: beside it (or behind it), facing the room; the chair stays rolled back for now
        const u = s.up ?? this.getUp(s, this.now());
        const chair = s.dev.chair;
        if (chair) {
          if (instant || u.stage === 'back') chair.pose(PUSH, -u.side * SWIVEL, { x: Math.sin(s.dev.plan.rot), z: Math.cos(s.dev.plan.rot) });
          chair.setSolid(true);
          chair.leftAt = performance.now() / 1000;
          this.displaced.add(chair);
        }
        this.place(u.to.x, u.to.z, u.facing, mode);
        c.pitch = mode === 'third' ? -0.16 : -0.06;
      } else {
        this.place(s.spot.x, s.spot.z, s.spot.yaw, mode);
        if (instant) {
          c.yaw = s.spot.yaw + Math.PI;
          c.pitch = mode === 'third' ? -0.16 : -0.22;
        }
      }
    }
    av.root.visible = mode !== 'first';
    const cam = this.d.camera;
    cam.fov = this.liveFov;
    cam.updateProjectionMatrix();
    this.overriding = false;
    this.zoom = null;
    this.d.container.classList.remove('ws-on');
    this.s = null;
    this.d.holdInput(false);
  }

  // ───────────────────────────── pieces ─────────────────────────────

  /** where you'll be: the chair if it's free, else standing in front, else beside it */
  private chooseSpot(pl: WsPlan): Spot {
    const nx = Math.sin(pl.rot);
    const nz = Math.cos(pl.rot);
    if (pl.seat && !this.d.people(pl.seat.x, pl.seat.z, 0.42).length) {
      // (getting up is planned when you do: getUp())
      return { x: pl.seat.x, z: pl.seat.z, yaw: pl.seat.yaw, seated: true, seatY: pl.seat.y, standUp: { x: pl.seat.x, z: pl.seat.z } };
    }
    // standing: straight in front first, then to either side; clear of furniture, chairs and people.
    // A cabinet is faced squarely, between its screen and its reader.
    const tx = Math.cos(pl.rot);
    const tz = -Math.sin(pl.rot);
    const ox = pl.kind === 'cabinet' ? pl.stand.x - nx * ((pl.stand.x - pl.screen.x) * nx + (pl.stand.z - pl.screen.z) * nz) : pl.screen.x;
    const oz = pl.kind === 'cabinet' ? pl.stand.z - nz * ((pl.stand.x - pl.screen.x) * nx + (pl.stand.z - pl.screen.z) * nz) : pl.screen.z;
    const near = pl.kind === 'wow' ? 0.5 : pl.kind === 'cabinet' ? 0.6 : 0.42;
    for (const side of [0, 0.55, -0.55, 0.8, -0.8]) {
      for (let dd = near; dd <= 1.25; dd += 0.05) {
        const x = ox + nx * dd + tx * side;
        const z = oz + nz * dd + tz * side;
        if (!this.clear(x, z, 0.24) || this.chairs.some((ch) => Math.hypot(ch.x - x, ch.z - z) < 0.4) || this.d.people(x, z, 0.45).length) continue;
        const yaw = pl.kind === 'cabinet' ? pl.rot + Math.PI : Math.atan2(pl.screen.x - x, pl.screen.z - z);
        return { x, z, yaw, seated: false, seatY: 0, standUp: { x, z } };
      }
    }
    return { x: pl.stand.x, z: pl.stand.z, yaw: pl.stand.yaw, seated: false, seatY: 0, standUp: { x: pl.stand.x, z: pl.stand.z } };
  }

  /** no wall or solid furniture within r of (x, z) on your storey (`ignore`: a desk chair you're dealing with) */
  private clear(x: number, z: number, r: number, ignore?: DeskChair): boolean {
    const y0 = this.d.controller.y + 0.05;
    const y1 = this.d.controller.y + 2.0;
    for (const b of this.d.built.colliders) {
      if (b === ignore?.box || x < b.min.x - r || x > b.max.x + r || z < b.min.z - r || z > b.max.z + r) continue;
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
    }
    return true;
  }

  /** the player's body at (x, z) facing `facing` — controller and avatar, this frame */
  private place(x: number, z: number, facing: number, mode: CameraMode) {
    const c = this.d.controller;
    c.path = null;
    c.pos.set(x, z);
    c.facing = facing;
    if (mode === 'first') c.yaw = facing + Math.PI;
    const av = this.d.avatar;
    av.root.position.set(x, c.y, z);
    av.root.rotation.y = facing;
    av.root.visible = mode !== 'first' || this.bodyShown;
  }

  /** the badge tap: reach to the reader, press, back to the keys (inverse kinematics on the right arm) */
  private tap(s: Session, now: number, tt: number, mode: CameraMode) {
    const total = TAP.reach + TAP.hold + TAP.back;
    if (tt >= TAP.reach && !s.ledOn) this.signIn(s, now);
    if (tt < 0 || tt > total || s.skipped) {
      if (tt > total) this.endTap(s);
      return;
    }
    const rig = this.armRig();
    if (!rig) return;
    const av = this.d.avatar as Character & { attach?: (o: THREE.Object3D, m: 'handR') => void };
    // first person: show your own body for the tap (head hidden, the camera is in it)
    this.firstPersonBody(mode === 'first');
    av.root.updateMatrixWorld(true);
    if (!s.tapFrom) s.tapFrom = rig.hand.getWorldPosition(new THREE.Vector3());
    if (!s.card && av.attach) {
      av.attach(this.badge(), 'handR');
      s.card = true;
    }
    const pl = s.dev.plan;
    const wall = pl.reader.mount === 'wall';
    const fwd = new THREE.Vector3(Math.sin(s.spot.yaw), 0, Math.cos(s.spot.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // into the cabinet's face (wall readers)
    const inward = new THREE.Vector3(-Math.sin(pl.rot), 0, -Math.cos(pl.rot));
    // the hand's target frame: X along the fingers, Y out of the palm, Z = X × Y (toward the thumb)
    const shoulder = rig.upper.getWorldPosition(new THREE.Vector3());
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    if (wall) {
      // fingers up and a little in, palm to the reader
      X.set(0, 1, 0).addScaledVector(inward, 0.25).normalize();
      Y.copy(inward);
    } else {
      // fingers toward the reader and a little down, palm down
      X.set(s.dev.contact.x - shoulder.x, 0, s.dev.contact.z - shoulder.z).normalize();
      X.y = -0.22;
      X.normalize();
      Y.set(0, -1, 0);
    }
    Y.addScaledVector(X, -Y.dot(X)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const scale = this.d.avatar.height / 1.78;
    // the wrist where the badge's centre meets the reader's face
    const press = wall ? inward : new THREE.Vector3(0, -1, 0);
    const wristAt = s.dev.contact.clone().addScaledVector(X, -CARD.y * scale).addScaledVector(Y, -CARD.z * scale).addScaledVector(Z, -CARD.x * scale);
    // path: up and over (an arc), a short press, and back
    const lift = wall ? inward.clone().multiplyScalar(-0.08).add(new THREE.Vector3(0, 0.04, 0)) : new THREE.Vector3(0, 0.15, 0).addScaledVector(right, 0.02);
    const from = s.tapFrom;
    const ctrl = from.clone().add(wristAt).multiplyScalar(0.5).add(lift);
    let goal: THREE.Vector3;
    let w: number;
    if (tt < TAP.reach) {
      const k = easeInOut(tt / TAP.reach);
      goal = bezier(from, ctrl, wristAt, k);
      w = ease(tt / (TAP.reach * 0.45));
    } else if (tt < TAP.reach + TAP.hold) {
      goal = wristAt.clone().addScaledVector(press, 0.004 * Math.sin((Math.PI * (tt - TAP.reach)) / TAP.hold));
      w = 1;
    } else {
      const k = easeInOut((tt - TAP.reach - TAP.hold) / TAP.back);
      goal = bezier(wristAt, ctrl, from, k);
      w = 1 - ease((k - 0.45) / 0.55);
    }
    // standing (or a long reach): lean in from the waist
    if (rig.spine) {
      const elbow = rig.fore.getWorldPosition(new THREE.Vector3());
      const reach = shoulder.distanceTo(elbow) + elbow.distanceTo(rig.hand.getWorldPosition(new THREE.Vector3()));
      const lean = Math.max(0, Math.min(s.spot.seated ? 0.2 : 0.6, (shoulder.distanceTo(wristAt) - 0.9 * reach) / 0.4));
      turnAbout(rig.spine, right, -lean * w);
    }
    // elbow down and out
    const pole = new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.75).addScaledVector(fwd, -0.2);
    solveArm(rig, goal, pole, X, Y, Z, w);
  }

  private endTap(s: Session) {
    if (s.card && this.card) {
      const av = this.d.avatar as Character & { detach?: (o: THREE.Object3D) => void };
      if (av.detach) av.detach(this.card);
      else this.card.removeFromParent();
    }
    s.card = false;
    this.firstPersonBody(false);
  }

  /** first person, during the tap: your body is drawn (so your hand taps the badge), your head isn't */
  private firstPersonBody(on: boolean) {
    const rig = this.rig;
    if (on === this.bodyShown) return;
    this.bodyShown = on;
    if (rig?.head) {
      rig.head.scale.copy(rig.headScale);
      if (on) rig.head.scale.multiplyScalar(0.001);
    }
    this.d.avatar.root.visible = this.d.mode() !== 'first' || on;
  }

  private armRig(): Rig | null {
    if (this.rig !== undefined && this.rig !== null) return this.rig;
    const av = this.d.avatar as Character & { ready?: boolean; failed?: boolean };
    if (!av.ready || av.failed) return null;
    const r = av.root;
    const upper = findBone(r, /_R_UpperArm$/);
    const fore = findBone(r, /_R_Forearm$/);
    const hand = findBone(r, /_R_Hand$/);
    if (!upper || !fore || !hand) {
      this.rig = null;
      return null;
    }
    const head = findBone(r, /_Head$/);
    this.rig = { upper, fore, hand, spine: findBone(r, /_Spine1$/) ?? findBone(r, /_Spine$/), head, headScale: head ? head.scale.clone() : new THREE.Vector3(1, 1, 1) };
    return this.rig;
  }

  private badge(): THREE.Group {
    if (this.card) return this.card;
    const front = own(new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.4 }));
    const back = lambert('#f4f6f6', { roughness: 0.45 });
    const inner = new THREE.Group();
    const f = new THREE.Mesh(G.plane(CARD.w, CARD.h), front);
    f.position.z = 0.0005;
    const b = new THREE.Mesh(G.plane(CARD.w, CARD.h), back);
    b.rotation.y = Math.PI;
    inner.add(f, b);
    inner.position.set(CARD.x, CARD.y, CARD.z);
    inner.applyMatrix4(TO_BONE);
    const g = new THREE.Group();
    g.name = 'ws-badge';
    g.add(inner);
    g.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.card = g;
    return g;
  }

  /** the reader has read your badge: LED green, a soft beep, the screen says hello */
  private signIn(s: Session, now: number) {
    s.ledOn = true;
    s.authAt = now;
    this.ledOn.position.copy(s.dev.led);
    // a cabinet's reader stands up: its LED strip turns with it
    this.ledOn.rotation.set(s.dev.plan.reader.mount === 'wall' ? Math.PI / 2 : 0, s.dev.plan.rot, 0, 'YXZ');
    if (this.ledOn.parent !== s.dev.layer) s.dev.layer.add(this.ledOn);
    this.ledOn.visible = true;
    if (!s.beeped) {
      s.beeped = true;
      this.beep('in', s.dev.contact);
    }
    if (s.shown !== 'chart') this.draw(s, 'auth', 0);
  }

  private signOut(s: Session, sound = true) {
    s.ledOn = false;
    this.ledOn.visible = false;
    if (sound) this.beep('out', s.dev.contact);
  }

  private beep(kind: 'in' | 'out' | 'deny', at: THREE.Vector3) {
    if (!this.beeps) {
      const a = sharedAudio(false);
      if (!a) return;
      const sr = a.ctx.sampleRate;
      const buffer = (x: Float32Array<ArrayBuffer>) => {
        S.normalize(x, 0.9);
        const buf = a.ctx.createBuffer(1, x.length, sr);
        buf.copyToChannel(x, 0);
        return buf;
      };
      // a reader's chirp: two short sine blips, up for a good read, down for signing out
      const chirp = (f1: number, f2: number) => {
        const x = new Float32Array(Math.round(sr * 0.24));
        S.mix(x, S.fades(S.tone(sr, 0.07, f1, f1, 0.06, 0.004), sr, 0.004, 0.02), 0, 0.8);
        S.mix(x, S.fades(S.tone(sr, 0.12, f2, f2, 0.08, 0.004), sr, 0.004, 0.05), 0.085 * sr, 0.8);
        return buffer(x);
      };
      // access denied: two short, low, buzzy beeps (fundamental + odd harmonics)
      const deny = () => {
        const x = new Float32Array(Math.round(sr * 0.32));
        for (const t of [0, 0.16]) {
          for (const [h, g] of [[1, 1], [3, 0.33], [5, 0.16]] as const) S.mix(x, S.fades(S.tone(sr, 0.11, 415 * h, 415 * h, 1, 0.003), sr, 0.004, 0.02), t * sr, 0.6 * g);
        }
        return buffer(x);
      };
      this.beeps = { in: chirp(1568, 2093), out: chirp(1760, 1319), deny: deny() };
    }
    playSound(this.beeps[kind], { at: { x: at.x, y: at.y, z: at.z }, gain: kind === 'in' ? 0.55 : kind === 'deny' ? 0.5 : 0.4, range: 14, name: kind === 'deny' ? 'badge reader: access denied' : 'badge reader beep' });
  }

  // ───────────────────────────── refusals ─────────────────────────────

  /** where its user sits (or stands, without a chair) */
  private userSpot(dev: Device): { x: number; z: number } {
    return dev.plan.seat ?? dev.plan.stand;
  }

  /** someone seated at it (within ~0.8 m of its chair): it's in use */
  private userAt(dev: Device): Person | null {
    const at = this.userSpot(dev);
    return this.d.people(at.x, at.z, 0.8).find((p) => p.seated) ?? null;
  }

  /**
   * No login: a staff-only screen (user = null: the reader flashes red with an error beep, and whoever
   * works it says so) or one in use (user: you're pointed to the nearest free clinical workstation).
   */
  private refuse(dev: Device, user: Person | null) {
    const now = this.now();
    if (!user) {
      const st = dev.plan.staff ?? { name: dev.plan.label, line: "Sorry, Doc, that one's staff only." };
      this.notice('🔒', `${st.name} (staff only): your badge has no access here.`);
      this.ledRed.position.copy(dev.led);
      this.ledRed.rotation.set(dev.plan.reader.mount === 'wall' ? Math.PI / 2 : 0, dev.plan.rot, 0, 'YXZ');
      if (this.ledRed.parent !== dev.layer) dev.layer.add(this.ledRed);
      this.fx.redFrom = now;
      this.beep('deny', dev.contact);
      const at = this.userSpot(dev);
      const owner = this.d.people(at.x, at.z, 1.8)[0];
      if (owner) this.speak(owner, st.line);
      return;
    }
    const free = this.nearestFree(dev);
    this.notice('⏳', `In use by ${user.name}${user.title ? ` (${user.title})` : ''}`, free ? `${free.plan.label} is free · ${this.whereIs(this.userSpot(free))}` : undefined);
    if (free) {
      const at = this.userSpot(free);
      this.ring.position.set(at.x, this.d.controller.groundAt(at.x, at.z) + 0.02, at.z);
      this.fx.ringFrom = now;
    }
  }

  /** the nearest clinical workstation nobody is using */
  private nearestFree(not: Device): Device | null {
    const c = this.d.controller;
    let best: Device | null = null;
    let bd = Infinity;
    for (const dev of this.devices.values()) {
      if (dev === not || dev.plan.access !== 'clinical' || this.userAt(dev)) continue;
      const at = this.userSpot(dev);
      const d = Math.hypot(at.x - c.pos.x, at.z - c.pos.y);
      if (d < bd) {
        bd = d;
        best = dev;
      }
    }
    return best;
  }

  /** "4 m to your right" from where you stand and look */
  private whereIs(p: { x: number; z: number }): string {
    const c = this.d.controller;
    const dx = p.x - c.pos.x;
    const dz = p.z - c.pos.y;
    const m = Math.max(1, Math.round(Math.hypot(dx, dz)));
    const f = c.facing;
    const ahead = dx * Math.sin(f) + dz * Math.cos(f);
    const side = -dx * Math.cos(f) + dz * Math.sin(f);
    const dir = Math.abs(side) < Math.abs(ahead) * 0.7 ? (ahead > 0 ? 'ahead of you' : 'behind you') : side > 0 ? 'to your right' : 'to your left';
    return `${m} m ${dir}`;
  }

  /** a line of text under the crosshair for a few seconds */
  private notice(icon: string, text: string, sub?: string) {
    const el = this.noticeEl;
    el.replaceChildren();
    const main = document.createElement('div');
    main.className = 'ws-notice-main';
    main.textContent = `${icon} ${text}`;
    el.appendChild(main);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'ws-notice-sub';
      s.textContent = sub;
      el.appendChild(s);
    }
    el.classList.add('on');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => el.classList.remove('on'), 3600);
  }

  /** the owner of a staff-only screen says so: a speech bubble, and their voice when voices are on */
  private speak(p: Person, line: string) {
    this.d.say(p.id, line);
    const voice = castVoiceOf(p.id);
    const a = sharedAudio(false);
    if (!voice || !a || !neuralVoicesOn()) return;
    void fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: line, voice, speed: 1 }) })
      .then(async (r) => (r.ok ? await a.ctx.decodeAudioData(await r.arrayBuffer()) : null))
      .then((buf) => {
        if (buf) playSound(buf, { npc: p.id, gain: 1.6, name: 'staff voice (their workstation)' });
      })
      .catch(() => {});
  }

  /** the red LED's two blinks and the free workstation's ring, once a frame while they last */
  private effects() {
    const now = this.now();
    if (this.fx.redFrom >= 0) {
      const t = now - this.fx.redFrom;
      this.ledRed.visible = t < 1.1 && (t < 0.3 || (t > 0.45 && t < 1.1));
      if (t >= 1.1) this.fx.redFrom = -1;
    }
    if (this.fx.ringFrom >= 0) {
      const t = now - this.fx.ringFrom;
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      this.ring.visible = t < 3.6;
      mat.opacity = Math.min(1, t / 0.25, (3.6 - t) / 0.6) * (0.65 + 0.35 * Math.sin(t * 7));
      const k = 1 + 0.08 * Math.sin(t * 7);
      this.ring.scale.set(k, k, k);
      if (t >= 3.6) this.fx.ringFrom = -1;
    }
  }

  private draw(s: Session, state: LoginState, progress: number) {
    s.shown = state;
    s.drawnAt = this.now();
    const opens = s.dev.plan.section === 'mar' ? 'mar' : s.dev.target.bedside ? 'patient' : 'board';
    s.login.draw(state, { label: s.dev.plan.label, clock: this.d.clock(), progress, opens, cabinet: s.dev.plan.kind === 'cabinet' });
  }

  /** where your eyes are (first person): from the avatar's head bone, smoothed; an estimate before it loads */
  private eyePos(s: Session, dt: number): THREE.Vector3 {
    const av = this.d.avatar as Character & { ready?: boolean };
    const fx = Math.sin(this.d.controller.facing);
    const fz = Math.cos(this.d.controller.facing);
    if (av.ready) {
      av.root.updateMatrixWorld(true);
      av.head.getWorldPosition(_e);
      _e.y += this.eyeUp;
      _e.x += fx * 0.07;
      _e.z += fz * 0.07;
    } else {
      const c = this.d.controller;
      _e.set(c.pos.x + fx * 0.12, c.y + (av.posture === 'sit' ? s.spot.seatY + 0.77 : 1.65), c.pos.y + fz * 0.12);
    }
    if (!this.eyeInit) {
      this.eye.copy(_e);
      this.eyeInit = true;
    } else this.eye.lerp(_e, Math.min(1, dt * 14));
    return this.eye;
  }

  /** first person, seated or standing: your eyes, looking from the badge reader (k = 0) up to the screen (k = 1) */
  private eyeView(s: Session, dt: number, k: number, out: Pose): Pose {
    const pl = s.dev.plan;
    const eye = this.eyePos(s, dt);
    const tapAt = pl.reader.mount === 'wall' ? _a.set(pl.screen.x, pl.screen.y, pl.screen.z).lerp(s.dev.contact, 0.55) : _a.set(pl.keyboard.x, pl.keyboard.y, pl.keyboard.z).lerp(s.dev.contact, 0.62);
    s.look.copy(tapAt).lerp(_b.set(pl.screen.x, pl.screen.y, pl.screen.z), ease(k));
    return lookPose(out, eye, s.look, this.liveFov);
  }

  /** first person, getting up: your eyes (they rise and step with your head), looking along `yaw` at `pitch` */
  private eyeAlong(s: Session, dt: number, yaw: number, pitch: number, out: Pose): Pose {
    const eye = this.eyePos(s, dt);
    s.look.set(eye.x + Math.sin(yaw) * Math.cos(pitch), eye.y + Math.sin(pitch), eye.z + Math.cos(yaw) * Math.cos(pitch));
    return lookPose(out, eye, s.look, this.liveFov);
  }

  /** where the camera ends up: in front of the screen (first person), or over your right shoulder */
  private zoomPose(s: Session, mode: CameraMode): Pose {
    const pl = s.dev.plan;
    const n = _a.set(Math.sin(pl.rot), 0, Math.cos(pl.rot));
    const sc = new THREE.Vector3(pl.screen.x, pl.screen.y, pl.screen.z);
    const aspect = this.d.camera.aspect;
    const out = newPose();
    if (mode === 'first') {
      const dist = Math.max(0.24, 1.38 * pl.screen.h);
      return lookPose(out, sc.clone().addScaledVector(n, dist), sc, fillFov(dist, pl.screen.w, pl.screen.h, aspect, 0.64));
    }
    const fx = Math.sin(s.spot.yaw);
    const fz = Math.cos(s.spot.yaw);
    const av = this.d.avatar as Character & { ready?: boolean };
    const head = av.ready ? av.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(s.spot.x, this.d.controller.y + (s.spot.seated ? s.spot.seatY + 0.68 : 1.58), s.spot.z);
    const p = head.clone().add(new THREE.Vector3(-fz, 0, fx).multiplyScalar(0.27)).addScaledVector(n, 0.14);
    p.y += 0.1;
    return lookPose(out, p, sc, fillFov(p.distanceTo(sc), pl.screen.w, pl.screen.h, aspect, 0.56));
  }

  /** camera = live pose blended toward the target by w */
  private apply(w: number) {
    const cam = this.d.camera;
    mixPose(this.live, this.target, clamp01(w), this.cam);
    cam.position.copy(this.cam.p);
    cam.quaternion.copy(this.cam.q);
    if (Math.abs(cam.fov - this.cam.fov) > 1e-3) {
      cam.fov = this.cam.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.overriding = w > 0.001;
  }

  private listen(on: boolean) {
    window.removeEventListener('keydown', this.onKey, true);
    this.d.container.removeEventListener('pointerdown', this.onPointer, true);
    if (!on) return;
    window.addEventListener('keydown', this.onKey, true);
    this.d.container.addEventListener('pointerdown', this.onPointer, true);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.code !== 'KeyE' && e.key !== 'Escape')) return;
    if (!this.s || (this.s.phase !== 'walk' && this.s.phase !== 'enter' && this.s.phase !== 'exit')) return;
    e.preventDefault();
    e.stopPropagation();
    this.skip();
  };

  private onPointer = (e: PointerEvent) => {
    if (!this.s || (this.s.phase !== 'walk' && this.s.phase !== 'enter' && this.s.phase !== 'exit')) return;
    e.stopPropagation();
    this.skip();
  };
}

function copyPose(a: Pose, out: Pose): Pose {
  out.p.copy(a.p);
  out.q.copy(a.q);
  out.fov = a.fov;
  return out;
}

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t;
  return new THREE.Vector3().copy(a).multiplyScalar(u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t);
}

/**
 * Two-bone IK: the wrist to `goal` (blended from the animated pose by w), the elbow bending toward
 * `pole`, then the hand turned to the frame (X fingers, Y palm, Z thumb).
 */
function solveArm(rig: Rig, goal: THREE.Vector3, pole: THREE.Vector3, X: THREE.Vector3, Y: THREE.Vector3, Z: THREE.Vector3, w: number) {
  if (w <= 0.001) return;
  const S0 = rig.upper.getWorldPosition(new THREE.Vector3());
  const E0 = rig.fore.getWorldPosition(new THREE.Vector3());
  const W0 = rig.hand.getWorldPosition(new THREE.Vector3());
  const a = S0.distanceTo(E0);
  const b = E0.distanceTo(W0);
  const T = W0.clone().lerp(goal, w);
  const st = T.clone().sub(S0);
  const d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.004, st.length()));
  const dir = st.normalize();
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
  pp.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const elbow = S0.clone().addScaledVector(dir, a * cosA).addScaledVector(pp, a * Math.sqrt(1 - cosA * cosA));
  swing(rig.upper, E0.clone().sub(S0), elbow.sub(S0));
  const E1 = rig.fore.getWorldPosition(new THREE.Vector3());
  const W1 = rig.hand.getWorldPosition(new THREE.Vector3());
  swing(rig.fore, W1.sub(E1), S0.clone().addScaledVector(dir, d).sub(E1));
  // the hand: blend its world rotation toward the target frame
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  const cur = rig.hand.getWorldQuaternion(new THREE.Quaternion());
  cur.slerp(want, w);
  (rig.hand.parent ?? rig.fore).getWorldQuaternion(_pq);
  rig.hand.quaternion.copy(_pq.invert().multiply(cur));
  rig.hand.updateMatrixWorld(true);
}

/** a badge reader's three parts in world space (body, face, dark LED), the LED spot and the face centre */
function readerParts(pl: WsPlan): { geos: THREE.BufferGeometry[]; led: THREE.Vector3; contact: THREE.Vector3 } {
  const { w, h, d } = READER;
  const r = pl.reader;
  const m = new THREE.Matrix4().makeRotationY(pl.rot).setPosition(r.x, r.y, r.z);
  const part = (g: THREE.BufferGeometry, local: THREE.Matrix4) => {
    const out = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    out.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, local));
    for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
    return out;
  };
  const T = (x: number, y: number, z: number, rx = 0) => new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z);
  if (r.mount === 'flat') {
    // lying on the desk: a slim puck, the contactless face on top, the LED at its front edge
    return {
      geos: [part(G.rbox(w, h, d, 0.009), T(0, h / 2, 0)), part(G.plane(w - 0.016, d - 0.03), T(0, h + 0.0007, -0.006, -Math.PI / 2)), part(G.box(0.014, 0.0035, 0.006), T(0, h + 0.0004, d / 2 - 0.011))],
      led: new THREE.Vector3(0, h + 0.0009, d / 2 - 0.011).applyMatrix4(m),
      contact: new THREE.Vector3(0, h + 0.003, -0.004).applyMatrix4(m),
    };
  }
  // on a cabinet's face: standing up, the face toward you, the LED along its top
  return {
    geos: [part(G.rbox(w, d, h, 0.009), T(0, 0, h / 2)), part(G.plane(w - 0.016, d - 0.03), T(0, -0.006, h + 0.0007)), part(G.box(0.014, 0.006, 0.0035), T(0, d / 2 - 0.011, h + 0.0004))],
    led: new THREE.Vector3(0, d / 2 - 0.011, h + 0.0009).applyMatrix4(m),
    contact: new THREE.Vector3(0, -0.004, h + 0.003).applyMatrix4(m),
  };
}

/** an E target around a computer that had none (props.ts 'computer': LCD 0.58 × 0.36 on a stand, keyboard in front) */
function deviceBox(pl: WsPlan): THREE.Box3 {
  const m = new THREE.Matrix4().makeRotationY(pl.rot).setPosition(pl.x, pl.y, pl.z);
  const box = new THREE.Box3();
  for (const x of [-0.31, 0.31]) for (const y of [0, 0.52]) for (const z of [-0.1, 0.28]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(m));
  return box.expandByScalar(0.12);
}

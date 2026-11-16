import type { SavedAmenities } from '../../../shared/saveGame';
/**
 * Things you can use around the hospital. All of it is client-side: nothing here reaches the
 * server, the score or the AI agents' observations.
 *
 *   coffee       the cafeteria's self-serve machine and the staff workroom's. [E]: the hand takes the
 *                top paper cup off the stack beside the machine (a mug off the workroom's rack; or the
 *                empty cup or mug you hold), puts it under the spout and presses the button; about
 *                15 s of grinding, pouring and steam while the cup fills. Then [E] again: in the
 *                cafeteria a lid off the lid stack goes on first, then you take the cup. Nothing comes
 *                to hand that the hand didn't fetch (cupStacks.ts holds the stacks and the rack). The
 *                cafeteria's coffee is $2.25, owed from the moment it pours until you pay at the till
 *                (payment.ts); the workroom's is free
 *   café chairs  [E] on a free chair sits you at the table; what you hold goes on the table, and you
 *                sip your drink every 10–40 s (lift, sip, set down). The level drops with every sip
 *                until it's empty (8–12 sips), and the steam fades as it cools. [E] or WASD stands you
 *                up, and your cup comes along
 *   sofas        the staff workroom's and Floor 2's (the lounge, the patient rooms): [E] walks you to
 *                the nearest free seat, you turn and sit back into it. What you hold stays in your
 *                hands; a drink is sipped from the hand every 10–40 s. [E] or WASD: you rise over your
 *                feet and step clear of the sofa
 *   bins         [E] throws away the cup or can in your hand
 *   vending      the waiting room's machine: [E] picks a drink and you tap your phone on its card
 *                reader (payment.ts); then the can drops into the flap and you take it. [F]: what it is
 *   (hand rub, hand washing and masks: hygiene.ts)
 *
 * A sip: the rim rests on the lower lip and the cup turns about it, tipped just enough for the drink
 * to reach the lip (a full cup ~20°, the last sips ~70°, the head tipped back a little). The drink's
 * surface stays level in the cup whichever way it is tipped.
 *
 * Drinks are ordinary held things otherwise (itemSystem.ts): put them down with G, pick them up again.
 */
import * as THREE from 'three';
import { upperLevels } from '../../../shared/floors';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import type { CameraMode } from '../../../shared/types';
import { playSound } from '../audio/soundscape';
import * as SND from '../audio/amenities';
import { sharedAudio } from '../ui/speech';
import type { AvatarCharacter } from './avatars';
import { lerpAngle, type PlayerController } from './controls';
import { CupStack, LidStack, LID_SEAT, LID_TOP, MugRack, PAPER, buildLid, type RackMug } from './cupStacks';
import { SURF_MAX, levelFor, surfaceOutline, writeSurface } from './drinkLevel';
import { finePath } from './finePath';
import { blend, FINGERS, fromAbove, fromSide, GRIP, Hands, palmQuat, ramp, restPose, wristFor, type Frame, type HandPose } from './handPoses';
import { handQuat, type HandSide, type PlayerHands } from './hands';
import type { InteractTarget } from './index';
import type { ItemSystem } from './itemSystem';
import type { ItemInstance } from './items';
import { G, canvasTexture, emitter, glass, lambert, makeCanvas, own, trackGeo } from './materials';
import { COFFEE_PRICE, Payment, type NpcErrands } from './payment';

export interface AmenityDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: PlayerController;
  layout: LayoutDef;
  items: ItemSystem;
  hands: PlayerHands;
  avatar(): AvatarCharacter | null;
  cameraMode(): CameraMode;
  hint(text: string, ms?: number): void;
  /** someone (an NPC) is within r metres of (x, z) on that storey (0 = ground), or on the way to sit there */
  occupied(x: number, z: number, r: number, level?: number): boolean;
  /**
   * the player's colliders (the world's own array): a sofa you sit in stops being solid until you
   * stand up clear of it, and getting up checks there's room to stand
   */
  colliders?: THREE.Box3[];
  /** a walk from where you stand to (x, z) on your storey's nav grid (null: no way there) */
  path?(x: number, z: number): THREE.Vector2[] | null;
  /** payment.ts: the world's overlay (what you owe), NPCs for the cashier's errand, a line said by an NPC */
  container?: HTMLElement;
  npcs?: NpcErrands;
  say?(id: string, text: string): void;
}

export interface AmenityTarget {
  key: string;
  target: InteractTarget;
  box: THREE.Box3;
  center: THREE.Vector3;
  /** the storey it is on (floors.ts pickable); 0 when absent */
  level?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** deterministic per-cup variety without touching any shared random stream */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** a prop's local point (x along its width, y up, z toward its front) in world space */
function onProp(p: PropDef, lx: number, y: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = p.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return out.set(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c);
}

/** world AABB of a box given in a prop's frame (props are turned in quarter turns) */
function propBox(p: PropDef, cx: number, cz: number, w: number, d: number, y0: number, y1: number): THREE.Box3 {
  const c = onProp(p, cx, 0, cz);
  const quarter = Math.abs(Math.sin(p.rot ?? 0)) > 0.5;
  const hx = (quarter ? d : w) / 2;
  const hz = (quarter ? w : d) / 2;
  return new THREE.Box3(new THREE.Vector3(c.x - hx, y0, c.z - hz), new THREE.Vector3(c.x + hx, y1, c.z + hz));
}

// ───────────────────────────── drinks ─────────────────────────────

type Vessel = 'paper' | 'mug' | 'can';

interface Soda {
  name: string;
  label: string;
  color: string;
  accent: string;
  sugar: number;
}

/** generic flavours; sugar per 330 mL can (cola ≈ 10.6 g/100 mL, like the cafeteria fridge's sign says) */
const SODAS: Soda[] = [
  { name: 'cola', label: 'COLA', color: '#b3221e', accent: '#f4f0e8', sugar: 35 },
  { name: 'orange soda', label: 'ORANGE', color: '#e8781c', accent: '#fff3d6', sugar: 40 },
  { name: 'lemon-lime soda', label: 'LEMON·LIME', color: '#2f9e44', accent: '#f2ffe0', sugar: 33 },
  { name: 'sparkling water', label: 'SPARKLING', color: '#2e78b8', accent: '#e8f4ff', sugar: 0 },
];

interface Drink {
  inst: ItemInstance;
  vessel: Vessel;
  soda?: Soda;
  /** 0..1 of a full serving */
  fill: number;
  sips: number;
  sipsTotal: number;
  /** °C */
  temp: number;
  surface: THREE.Mesh | null;
  /** inner radius at the bottom/top and the fill height of a full cup (m) */
  r0: number;
  r1: number;
  hFull: number;
  base: number;
  steam: Steam | null;
  opened: boolean;
  lastFill: number;
  /** world up in the cup's frame when its surface was last shaped */
  lastUp: THREE.Vector3;
  /** a paper cup's lid, once one is on (its drinking slot turned to whoever drinks) */
  lid: THREE.Object3D | null;
}

/** coffee in a paper cup is ~80 °C fresh; Newton cooling toward the room (paper cup, no lid) */
const ROOM_C = 22;
const COOL_K = 0.0026;

let puffTex: THREE.Texture | null = null;
function steamTexture(): THREE.Texture {
  if (puffTex) return puffTex;
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTex = canvasTexture(canvas);
  return puffTex;
}

/**
 * Wisps rising off a hot drink: a few soft camera-facing puffs, in world space. The scene pass also
 * writes view normals and depth for the AO (render/renderer.ts), unblended: a puff that wrote its
 * normal over the wall's depth behind it made the AO darken a square there. So a puff writes its own
 * depth too (only its visible core: the alpha test drops the clear corners), and the AO sees a small
 * thing floating in free air, which nothing occludes.
 */
class Steam {
  readonly group = new THREE.Group();
  private puffs: { m: THREE.Mesh; mat: THREE.Material; phase: number; speed: number }[] = [];
  private t = 0;
  constructor(scene: THREE.Scene, seed: number) {
    const geo = G.plane(1, 1);
    for (let i = 0; i < 6; i++) {
      const mat = own(new THREE.MeshBasicMaterial({ map: steamTexture(), color: '#f3f4f4', transparent: true, depthWrite: true, alphaTest: 0.02, opacity: 0 }));
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.group.add(m);
      this.puffs.push({ m, mat, phase: (i / 6 + hash01(`${seed}:${i}`) * 0.1) % 1, speed: 0.36 + hash01(`${seed}/${i}`) * 0.14 });
    }
    this.group.visible = false;
    scene.add(this.group);
  }
  update(top: THREE.Vector3, radius: number, intensity: number, dt: number, camera: THREE.Camera) {
    this.t += dt;
    this.group.visible = intensity > 0.01;
    if (!this.group.visible) return;
    for (const p of this.puffs) {
      const age = (this.t * p.speed + p.phase) % 1;
      const sway = Math.sin(this.t * 1.7 + p.phase * 9) * 0.012 * age;
      p.m.position.set(top.x + sway + (p.phase - 0.5) * radius * 0.8, top.y + 0.01 + age * 0.17, top.z + Math.cos(this.t * 1.3 + p.phase * 7) * 0.01 * age);
      // narrow wisps that widen as they rise and thin out
      const s = radius * 0.8 + age * 0.06;
      p.m.scale.set(s * 0.75, s * 1.35, s);
      p.m.quaternion.copy(camera.quaternion);
      p.mat.opacity = intensity * 0.22 * Math.sin(Math.PI * age) * (1 - age * 0.35);
    }
  }
  dispose() {
    this.group.removeFromParent();
  }
}

/** the drink's surface: a triangle fan rebuilt as the cup tips (drinkLevel.ts), in the cup's own frame */
function surfaceGeometry(r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SURF_MAX * 9), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(SURF_MAX * 9), 3).setUsage(THREE.DynamicDrawUsage));
  // fixed bounds: the inside of the cup (a held thing's grip is measured from its bounds)
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-r, 0, -r), new THREE.Vector3(r, h, r));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h / 2, 0), Math.hypot(r, h / 2));
  g.setDrawRange(0, 0);
  return trackGeo(g);
}

/** the workroom's mugs: plain glazes (body, band), no prints */
const MUG_GLAZES: [string, string][] = [
  ['#f1efe9', '#2bb3a3'],
  ['#2c3e66', '#e9e4d8'],
  ['#d4a02a', '#f3ead6'],
  ['#7f9c86', '#f1efe9'],
  ['#b5583b', '#f1e3d3'],
  ['#8b9196', '#f1efe9'],
];

/** a paper cup (cafeteria) or a ceramic mug (staff room), with the coffee's surface inside */
function buildCup(vessel: 'paper' | 'mug', glaze = MUG_GLAZES[0]): { root: THREE.Group; surface: THREE.Mesh; r0: number; r1: number; hFull: number; base: number } {
  const root = new THREE.Group();
  const lathe = (pts: [number, number][], mat: THREE.Material, seg = 28) => new THREE.Mesh(trackGeo(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)), mat);
  let r0: number;
  let r1: number;
  let H: number;
  let base: number;
  if (vessel === 'paper') {
    r0 = 0.029;
    r1 = 0.0425;
    H = 0.115;
    base = 0.006;
    const paper = lambert('#f6f4ee', { roughness: 0.85, side: THREE.DoubleSide });
    root.add(lathe([[0, 0], [r0, 0], [r0, 0.004], [r1, H], [r1 + 0.0016, H + 0.0012], [r1 + 0.0004, H + 0.0026], [r1 - 0.0008, H]], paper));
    const kraft = lambert('#9c6b3d', { roughness: 0.92 });
    const at = (y: number) => r0 + ((r1 - r0) * y) / H + 0.0011;
    root.add(lathe([[at(0.032), 0.032], [at(0.084), 0.084]], kraft));
    // printed band
    root.add(lathe([[at(0.092), 0.092], [at(0.1), 0.1]], lambert('#2bb3a3', { roughness: 0.6 })));
  } else {
    r0 = 0.038;
    r1 = 0.038;
    H = 0.095;
    base = 0.009;
    const ceramic = lambert(glaze[0], { roughness: 0.22 });
    root.add(lathe([[0, 0], [0.039, 0], [0.0415, 0.004], [0.0415, H], [0.0395, H + 0.002], [0.038, H], [0.038, base], [0, base]], ceramic));
    root.add(lathe([[0.0418, 0.058], [0.0418, 0.07]], lambert(glaze[1], { roughness: 0.4 })));
    const handle = new THREE.Mesh(G.torus(0.024, 0.0065, 8, 18, Math.PI), ceramic);
    handle.position.set(0.0415, 0.05, 0);
    handle.rotation.set(0, 0, -Math.PI / 2);
    root.add(handle);
  }
  // the surface is built in the cup's own frame (drinkLevel.ts), facing up
  const surface = new THREE.Mesh(surfaceGeometry(r1, H), own(new THREE.MeshStandardMaterial({ color: '#2a1408', roughness: 0.1, metalness: 0 })));
  surface.visible = false;
  root.add(surface);
  for (const c of root.children) {
    c.castShadow = true;
    c.receiveShadow = true;
  }
  return { root, surface, r0, r1, hFull: (H - base) * 0.88, base };
}

/** a 330 mL can (66 mm × 115 mm) with its flavour's printed wrap */
function buildCan(s: Soda): THREE.Group {
  const root = new THREE.Group();
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = s.color;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = s.accent;
  ctx.fillRect(0, 86, 256, 6);
  ctx.font = '800 34px ui-sans-serif, system-ui, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.label, 14, 50, 228);
  ctx.font = '600 13px ui-sans-serif, system-ui, Arial, sans-serif';
  ctx.fillText(`330 mL · sugar ${s.sugar} g`, 14, 108, 228);
  const wrap = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.32, metalness: 0.55 }));
  const body = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.033, 0.033, 0.098, 24, 1, true)), wrap);
  body.position.y = 0.06;
  const alu = lambert('#c9ced3', { roughness: 0.28, metalness: 0.9 });
  const top = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.027, 0.033, 0.009, 24)), alu);
  top.position.y = 0.1135;
  const bottom = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.033, 0.026, 0.011, 24)), alu);
  bottom.position.y = 0.0055;
  const tab = new THREE.Mesh(G.box(0.012, 0.0015, 0.02), alu);
  tab.position.set(0, 0.1185, 0.004);
  root.add(body, top, bottom, tab);
  for (const c of root.children) {
    c.castShadow = true;
    c.receiveShadow = true;
  }
  return root;
}

// ───────────────────────────── a sip ─────────────────────────────

/** the rim point that rests on the lip: its radius and height in the vessel's frame (buildCup, buildCan) */
const RIM: Record<Vessel, { r: number; h: number }> = {
  paper: { r: 0.0436, h: 0.1172 },
  mug: { r: 0.0405, h: 0.0966 },
  can: { r: 0.0275, h: 0.1178 },
};
/** a paper cup with its lid on: the lip on the lid's raised ring, at the drinking slot (cupStacks.ts) */
const RIM_LID = { r: 0.041, h: PAPER.H - LID_SEAT + 0.0115 };

/**
 * How far a drink is tipped for a sip (rad from upright): just until it reaches the lip. A full cup
 * ~20° (the coffee is a centimetre under the rim), the last sips ~70°; a can's opening is small and
 * off-centre, so a little more.
 */
function sipTilt(v: Vessel, fill: number): number {
  const [full, empty] = v === 'can' ? [0.46, 1.36] : [0.34, 1.22];
  return full + (empty - full) * Math.pow(clamp01(1 - fill), 1.2);
}

/** a sip's timeline (s): take it (off the table), up to the lip, tip, the sip, tip back, down, put it back */
interface SipTimes {
  take: number;
  up: number;
  tip: number;
  drink: number;
  untip: number;
  down: number;
  put: number;
  end: number;
}
const SIP_TABLE: SipTimes = { take: 0.55, up: 1.25, tip: 1.55, drink: 1.7, untip: 2.0, down: 2.25, put: 2.95, end: 3.4 };
const SIP_TABLE_FP: SipTimes = { take: 0, up: 0.6, tip: 0.85, drink: 1.0, untip: 1.4, down: 1.62, put: 2.2, end: 2.3 };
const SIP_HAND: SipTimes = { take: 0, up: 0.7, tip: 1.0, drink: 1.15, untip: 1.45, down: 1.7, put: 2.4, end: 2.45 };

/**
 * First person: where the rim meets the mouth, camera frame (m). The mouth itself is out of view
 * (~8 cm under the eyes); this is a little further out and lower, just under the bottom of the view,
 * so the cup comes up into the bottom middle with its rim toward you and its far rim no higher than
 * your mouth: you see its outside and a glimpse of the drink, never its opening held up at your eyes.
 */
const FP_LIP = new THREE.Vector3(0, -0.128, -0.15);
/** first person: the most a cup tips toward the view; past that the head tips back instead (up to FP_HEAD) */
const FP_MAX_TIP = 0.62;
const FP_HEAD = 0.3;

// ───────────────────────────── places ─────────────────────────────

interface Machine {
  id: string;
  prop: PropDef;
  mug: boolean;
  /** world: the cup's bottom centre on the drip tray, the spout's outlet, the button */
  cup: THREE.Vector3;
  spout: THREE.Vector3;
  button: THREE.Vector3;
  /** the way the machine faces (yaw) */
  yaw: number;
  box: THREE.Box3;
  center: THREE.Vector3;
  light: THREE.Mesh;
  stream: THREE.Mesh;
  state: 'idle' | 'brewing' | 'ready';
  t: number;
  drink: Drink | null;
  sound: { stop(f?: number): void } | null;
  /** where the cups come from: paper cups and lids beside it (the cafeteria), a rack of mugs (the workroom) */
  stack: CupStack | null;
  lids: LidStack | null;
  rack: MugRack | null;
  /** where you stand to use it (in front of the counter, within reach of all of it), facing it */
  stand: THREE.Vector2;
  facing: number;
}

interface Chair {
  id: string;
  x: number;
  z: number;
  rot: number;
  /** toward the table centre (unit, horizontal) */
  dir: THREE.Vector3;
  /** the table top's height */
  top: number;
  /** the table edge's distance from the chair centre */
  edge: number;
  box: THREE.Box3;
  center: THREE.Vector3;
}

/**
 * The sofa (props.ts 'sofa'): 1.8 m wide, two 0.7 m seat cushions centred 0.4 m either side with
 * their top at 0.46 m, back cushions whose face is 0.08 m behind the middle, a 0.82 m high frame,
 * arms 18 cm wide and 0.62 m high, the front 0.41 m in front of the middle. Its frame: x along the
 * width, z toward the front.
 */
const SOFA = {
  /** where you can sit across it: on either cushion, or in the middle while both are free */
  seats: [-0.4, 0, 0.4],
  /** the cushions' top: what you sit on */
  top: 0.46,
  front: 0.41,
  back: -0.42,
  half: 0.9,
  /**
   * The hips (the pelvis bone, 10 cm above the cushion) this far from the middle: the sitting
   * avatar's back is 12.5 cm behind its hip joints, the back cushions' face at −0.08, and its knees
   * (39 cm in front of the hips) then just clear the cushions' edge.
   */
  hipZ: 0.065,
  /** how close someone may be to a seat before it's taken (people sit ~0.45 m apart at the least) */
  taken: 0.45,
};
/** the player's collision radius (controls.ts) */
const PLAYER_R = 0.3;
/** standing up from a sofa: rising over your feet and stepping clear (s) */
const RISE_T = 0.6;
/** sitting down on a sofa: turning, and sitting back into it (s) */
const DOWN_T = 0.8;

interface Sofa {
  id: string;
  prop: PropDef;
  /** the storey (0 = ground) and its floor height */
  level: number;
  y: number;
  /** the aim box (the seat, below the backrest's top) */
  box: THREE.Box3;
  center: THREE.Vector3;
  /** its collider in the player's colliders, and that box as built (it is emptied while you sit in it) */
  collider: THREE.Box3 | null;
  solid: THREE.Box3 | null;
}

/** where you sit: a café chair at its table, or a place on a sofa */
interface Seat {
  kind: 'chair' | 'sofa';
  id: string;
  /** the avatar root while seated (world), and its floor height */
  x: number;
  z: number;
  y: number;
  /** the way you face, sitting */
  rot: number;
  /** the seat's height above the floor (avatars.ts seatY) */
  seatY: number;
  chair?: Chair;
  sofa?: Sofa;
  /** a sofa: the place across it (its frame's x) */
  lx: number;
  /** where you stand up to (a sofa: in front of the seat, clear of it; also where you sit down from) */
  out: { x: number; z: number };
}

interface Bin {
  id: string;
  label: string;
  /** world point a thing is dropped into */
  into: THREE.Vector3;
  /** recycling slot (cans) on the cafeteria's waste station */
  recycle?: THREE.Vector3;
  box: THREE.Box3;
  center: THREE.Vector3;
}

interface Vending {
  prop: PropDef;
  button: THREE.Vector3;
  flap: THREE.Vector3;
  box: THREE.Box3;
  center: THREE.Vector3;
  busy: boolean;
  sold: number;
}

/** a sip: from the table in front of you (`spot`), or from your hand (`spot` null, on a sofa) */
interface SipAction {
  kind: 'sip';
  t: number;
  d: Drink;
  inst: ItemInstance;
  side: HandSide;
  spot: Spot | null;
  /** third person when it began (switching camera mid-sip ends it) */
  tp: boolean;
  times: SipTimes;
  /** how far it tips (rad), from the fill when it began */
  tilt: number;
  took: boolean;
  drank: boolean;
  back: boolean;
  /** the rim point on the lip, in the cup's frame (checks) */
  rim: THREE.Vector3;
}

/**
 * A coffee's timelines (s). Making one: the hand to the cup (off the stack by its rim from above, off
 * the rack round its middle, or the empty one already in your hand), the cup taken (`grab`), lifted
 * clear, over the drip tray, set down (`place`), the hand off it and to the button, pressed (`press`),
 * the hand back. Taking it: a lid off the lid stack, over the cup and pressed on (`lidOn`; the
 * cafeteria's paper cups only), the hand round the cup (`grip`), out from under the spout and to
 * where you carry a cup (`carry`).
 */
interface MakeTimes {
  reach: number;
  grab: number;
  lift: number;
  over: number;
  place: number;
  button: number;
  press: number;
  back: number;
}
const MAKE: Record<'stack' | 'rack' | 'own' | 'placed', MakeTimes> = {
  stack: { reach: 0.55, grab: 0.72, lift: 1.12, over: 1.7, place: 1.98, button: 2.45, press: 2.62, back: 3.15 },
  rack: { reach: 0.55, grab: 0.68, lift: 1.0, over: 1.6, place: 1.88, button: 2.35, press: 2.52, back: 3.05 },
  own: { reach: 0, grab: 0, lift: 0, over: 0.6, place: 0.88, button: 1.35, press: 1.52, back: 2.05 },
  placed: { reach: 0, grab: 0, lift: 0, over: 0, place: 0, button: 0.5, press: 0.67, back: 1.2 },
};
interface TakeTimes {
  lid: number;
  lidGrab: number;
  lidUp: number;
  lidOver: number;
  lidOn: number;
  toCup: number;
  grip: number;
  pull: number;
  carry: number;
}
const TAKE: Record<'lid' | 'plain', TakeTimes> = {
  lid: { lid: 0.5, lidGrab: 0.62, lidUp: 0.88, lidOver: 1.35, lidOn: 1.6, toCup: 2.05, grip: 2.15, pull: 2.55, carry: 3.05 },
  plain: { lid: 0, lidGrab: 0, lidUp: 0, lidOver: 0, lidOn: 0, toCup: 0.5, grip: 0.6, pull: 1.0, carry: 1.5 },
};

/** the body's turn to it before the hand goes out: third person the body, first person the view (only if it's out of view) */
interface Turn {
  t: number;
  dur: number;
  f0: number;
  f1: number;
  y0: number;
  y1: number;
  p0: number;
  p1: number | null;
}

interface MakeAction {
  kind: 'make';
  t: number;
  m: Machine;
  side: HandSide;
  from: 'stack' | 'rack' | 'own' | 'placed';
  /** the cup, once the hand has it (off a stack: made where the top cup stood) */
  d: Drink | null;
  /** off the rack: which place, and the mug standing there */
  slot: number;
  mug: RackMug | null;
  T: MakeTimes;
  grabbed: boolean;
  placed: boolean;
  pressed: boolean;
  /** where the hand takes the cup: the top cup's rim (stack), the mug's middle (rack), your cup's middle (own) */
  grabAt: THREE.Vector3 | null;
  /** where the cup was against the hand's grip when the hand took it: eased away over the lift */
  slip: THREE.Vector3;
  /** first walking up to the counter (the player's path), then turning to it */
  approach: THREE.Vector2[] | null;
  approachT: number;
  turn: Turn | null;
}

interface TakeAction {
  kind: 'take';
  t: number;
  m: Machine;
  side: HandSide;
  d: Drink;
  T: TakeTimes;
  /** the lid on its way from the stack to the cup, and where its top was on the stack */
  lid: THREE.Object3D | null;
  lidAt: THREE.Vector3 | null;
  lidTaken: boolean;
  lidOn: boolean;
  gripped: boolean;
  slip: THREE.Vector3;
  /** the cup's yaw on the tray (it turns to how a hand carries it on the way out) */
  yaw0: number;
  approach: THREE.Vector2[] | null;
  approachT: number;
  turn: Turn | null;
}

/** something the player is doing with their hands right now (animated; cancelled by walking off) */
type Action =
  | MakeAction
  | TakeAction
  | SipAction
  | { kind: 'vend'; t: number; d: Drink | null; side: HandSide; slot: THREE.Vector3; pressed: boolean; dropped: boolean; took: boolean; paying: boolean; paid: number | null; approach: THREE.Vector2[] | null; approachT: number }
  | { kind: 'toss'; t: number; inst: ItemInstance; from: THREE.Vector3; to: THREE.Vector3; can: boolean };

/** where the player's things are on the table while seated */
interface Spot {
  inst: ItemInstance;
  drink: Drink | null;
  pos: THREE.Vector3;
  yaw: number;
  side: HandSide;
}

const SEAT_Y = 0.46;
/**
 * Seated eyes (measured on the sitting avatar, sit clip): 0.82 m above the seat and 0.15 m in front
 * of the hips, with the head's idle motion averaged out (the seat's root is 2 cm behind the pelvis).
 */
const SEATED_EYE = { up: 0.825, fwd: 0.15 };
/** standing eye height (controls.ts EYE) */
const EYE = 1.65;
const DISPOSABLE = new Set(['coffeeCup', 'sodaCan', 'paperCup', 'waterCup', 'pillCup', 'sandwich']);
/** held things that rest in your lap on a sofa (long things lie along the thigh; bags and trays as they are) */
const LAP_STYLES = new Set(['upright', 'can', 'flat']);

export class Amenities {
  private drinks = new Map<ItemInstance, Drink>();
  private machines: Machine[] = [];
  private chairs: Chair[] = [];
  private sofas: Sofa[] = [];
  private bins: Bin[] = [];
  private vending: Vending | null = null;
  private action: Action | null = null;
  /**
   * sitting: at a café table (`spots`: your things on it) or on a sofa (your things stay in hand).
   * `down` while you're still sitting down on a sofa (turning, sitting back): where the body is now.
   */
  private seated: { seat: Seat; spots: Spot[]; nextSip: number; mode: CameraMode; down: { t: number; from: THREE.Vector2; facing: number; yaw: number; pitch: number; x: number; z: number; sat: boolean } | null } | null = null;
  /** on the way to a sofa seat (the controller walks you to stand in front of it), and how long that may take */
  private approach: { seat: Seat; path: THREE.Vector2[]; t: number; limit: number } | null = null;
  /** standing up from a sofa: the body rises from `from` to where the controller already is */
  private rising: { seat: Seat; t: number; from: THREE.Vector2; eye: THREE.Vector3 } | null = null;
  private seq = 0;
  private time = 0;
  private extras: THREE.Object3D[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private markers: THREE.Mesh[] | null = null;
  /** tests: a sip's clock stops here (null = runs) */
  private holdT: number | null = null;
  /** tests: a camera framed on the avatar (debugOp 'cam'), and the field of view to go back to */
  private shotCam: { around: 'head' | 'pelvis' | 'feet'; yaw: number; pitch: number; dist: number; fov: number; up: number } | null = null;
  private fovBefore = 0;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  /** paying at the till, the cashier, the vending machine's reader (payment.ts) */
  readonly payment: Payment;
  /** the hands for fetching cups and lids (third person: the avatar's arms; first person: their own) */
  private reachHands: Hands;
  /** the workroom's mugs as built (their coffee surface, sizes), until one is taken and becomes a drink */
  private rackCups = new Map<THREE.Object3D, ReturnType<typeof buildCup>>();
  /** tests: what the hands just did, with measurements (a cup taken off the stack, put under the spout, a lid…) */
  private events: Record<string, unknown>[] = [];
  /** tests: the coffee hand's last third-person target, its shoulder and how far apart (m) */
  private lastReach: Record<string, unknown> | null = null;

  constructor(private d: AmenityDeps) {
    const L = d.layout;
    this.reachHands = new Hands(d.scene, d.camera, d.hands, () => this.thirdPerson());
    for (const p of L.props) {
      if (p.kind === 'coffeeStation') {
        const mx = -(p.w ?? 1.6) / 2 + 0.3;
        // (aimed at, the stacks beside it count as the machine)
        // (the cup stands on the drip tray right under the spout's outlet, just clear of the machine's front)
        const m = this.machine(p, false, [mx, 0.966, 0.215], [mx, 1.2, 0.215], [mx, 1.432, 0.176], propBox(p, mx + 0.2, 0, 1.0, 0.72, 0.9, 1.7), [mx + 0.08, (p.d ?? 0.7) / 2 + 0.33]);
        // the lids and the paper cups stand on the counter just to the machine's right, near its front edge:
        // the (low) lids next to it, the (tall) stack of cups beyond, each within an easy reach from in front
        m.lids = new LidStack(d.scene, onProp(p, mx + 0.3, 0.94, 0.26));
        m.stack = new CupStack(d.scene, onProp(p, mx + 0.41, 0.94, 0.25));
        this.machines.push(m);
      } else if (p.kind === 'coffee') {
        // the workroom's machine: a drip tray and a spout of its own (the counter prop has a plain body),
        // and the staff's mugs on a rack beside it
        const m = this.machine(p, true, [-0.15, 0.946, 0.205], [-0.15, 1.118, 0.203], [-0.15, 1.24, 0.168], propBox(p, 0.04, 0.06, 0.86, 0.5, 0.9, 1.45), [-0.02, 0.25 + 0.34]);
        m.rack = new MugRack(d.scene, onProp(p, 0.24, 0.93, 0.1), p.rot ?? 0, (i) => {
          const c = buildCup('mug', MUG_GLAZES[i % MUG_GLAZES.length]);
          this.rackCups.set(c.root, c);
          return { root: c.root };
        });
        this.machines.push(m);
        const tray = new THREE.Mesh(G.rbox(0.16, 0.014, 0.09, 0.004), lambert('#2a2d30', { roughness: 0.35, metalness: 0.6 }));
        tray.position.copy(onProp(p, -0.15, 0.937, 0.205));
        tray.rotation.y = p.rot ?? 0;
        // (the head from the machine's front out over the tray, the nozzle over a cup's middle)
        const head = new THREE.Mesh(G.rbox(0.07, 0.045, 0.075, 0.008), lambert('#1f2225', { roughness: 0.3 }));
        head.position.copy(onProp(p, -0.15, 1.142, 0.1985));
        head.rotation.y = p.rot ?? 0;
        const nozzle = new THREE.Mesh(G.cyl(0.006, 0.008, 0.012, 10), lambert('#b9bec3', { roughness: 0.25, metalness: 0.9 }));
        nozzle.position.copy(onProp(p, -0.15, 1.115, 0.203));
        for (const o of [tray, head, nozzle]) {
          o.castShadow = true;
          d.scene.add(o);
          this.extras.push(o);
        }
      } else if (p.kind === 'cafeChair' && p.room === 'cafeteria') {
        const table = L.props.filter((t) => t.kind === 'cafeTable' && t.room === 'cafeteria').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (!table) continue;
        const dir = new THREE.Vector3(table.x - p.x, 0, table.z - p.z);
        const dist = dir.length();
        dir.normalize();
        const half = (table.w ?? 0.8) / 2;
        this.chairs.push({ id: p.id, x: p.x, z: p.z, rot: p.rot ?? 0, dir, top: (table.h ?? 0.75) + 0.002, edge: dist - half, box: new THREE.Box3(new THREE.Vector3(p.x - 0.23, 0, p.z - 0.23), new THREE.Vector3(p.x + 0.23, 0.9, p.z + 0.23)), center: new THREE.Vector3(p.x, 0.45, p.z) });
      } else if (p.kind === 'sofa') {
        this.addSofa(p, 0, 0);
      } else if (p.kind === 'trash') {
        this.bins.push({ id: p.id, label: 'bin', into: new THREE.Vector3(p.x, 0.62, p.z), box: new THREE.Box3(new THREE.Vector3(p.x - 0.22, 0, p.z - 0.22), new THREE.Vector3(p.x + 0.22, 0.62, p.z + 0.22)), center: new THREE.Vector3(p.x, 0.3, p.z) });
      } else if (p.kind === 'wasteStation') {
        const W = p.w ?? 1.2;
        const box = propBox(p, 0, 0, W, p.d ?? 0.5, 0, 1.05);
        this.bins.push({ id: p.id, label: 'landfill bin', into: onProp(p, -W / 3, 0.86, (p.d ?? 0.5) / 2 - 0.05), recycle: onProp(p, 0, 0.86, (p.d ?? 0.5) / 2 - 0.05), box, center: box.getCenter(new THREE.Vector3()) });
      } else if (p.kind === 'vending' && !this.vending) {
        const box = propBox(p, 0, 0, 1.0, 0.84, 0, 1.9);
        this.vending = { prop: p, button: onProp(p, 0.33, 1.22, 0.43), flap: onProp(p, -0.1, 0.17, 0.33), box, center: box.getCenter(new THREE.Vector3()), busy: false, sold: 0 };
        // the delivery flap at the bottom of the glass front
        const recess = new THREE.Mesh(G.box(0.5, 0.17, 0.03), lambert('#0d0f11', { roughness: 0.8 }));
        recess.position.copy(onProp(p, -0.1, 0.215, 0.402));
        recess.rotation.y = p.rot ?? 0;
        const flap = new THREE.Mesh(G.box(0.48, 0.15, 0.008), glass('#202a33', 0.55));
        flap.position.copy(onProp(p, -0.1, 0.215, 0.42));
        flap.rotation.y = p.rot ?? 0;
        const label = new THREE.Mesh(G.box(0.2, 0.025, 0.004), emitter('#ffd9a0', 0.6));
        label.position.copy(onProp(p, -0.1, 0.33, 0.418));
        label.rotation.y = p.rot ?? 0;
        for (const o of [recess, flap, label]) {
          d.scene.add(o);
          this.extras.push(o);
        }
      }
    }
    // the storeys above: the ward's sofas (the staff lounge, the patient rooms)
    for (const lv of upperLevels(L)) for (const p of lv.props) if (p.kind === 'sofa') this.addSofa(p, lv.index, lv.y);
    this.payment = new Payment({
      scene: d.scene,
      camera: d.camera,
      controller: d.controller,
      layout: L,
      items: d.items,
      hands: d.hands,
      avatar: d.avatar,
      cameraMode: d.cameraMode,
      hint: d.hint,
      sound: (name, render, at, gain, range) => void this.sound(name, render, at, gain, range),
      container: d.container,
      npcs: d.npcs,
      say: d.say,
      path: d.path,
      // paid: the cups say so when you look at them
      onSettled: () => {
        for (const dr of this.drinks.values()) this.describe(dr);
      },
    });
  }

  private addSofa(p: PropDef, level: number, y: number) {
    // aimed at below the backrest's top: the seat, the arms, the front
    const box = propBox(p, 0, (SOFA.front + SOFA.back) / 2, SOFA.half * 2, SOFA.front - SOFA.back, y, y + 0.66);
    // its collider: the box the builder made from the sofa's bounds (floor to the backrest's top)
    const want = propBox(p, 0, (SOFA.front + SOFA.back) / 2, SOFA.half * 2, SOFA.front - SOFA.back, y, y + 0.82);
    let collider: THREE.Box3 | null = null;
    let best = 0.12;
    for (const b of this.d.colliders ?? []) {
      const e = Math.abs(b.min.x - want.min.x) + Math.abs(b.max.x - want.max.x) + Math.abs(b.min.z - want.min.z) + Math.abs(b.max.z - want.max.z) + Math.abs(b.min.y - y);
      if (e < best) {
        best = e;
        collider = b;
      }
    }
    this.sofas.push({ id: p.id, prop: p, level, y, box, center: box.getCenter(new THREE.Vector3()), collider, solid: collider ? collider.clone() : null });
  }

  private machine(p: PropDef, mug: boolean, cup: [number, number, number], spout: [number, number, number], button: [number, number, number], box: THREE.Box3, stand: [number, number]): Machine {
    const yaw = p.rot ?? 0;
    const st = onProp(p, stand[0], 0, stand[1]);
    const light = new THREE.Mesh(G.plane(0.06, 0.028), emitter('#ffcf73', 2.2));
    light.position.copy(onProp(p, button[0], button[1], button[2] + 0.002));
    light.rotation.y = yaw;
    light.visible = false;
    // opaque on purpose: a transparent mesh would stamp its normal into the AO's normal target
    const stream = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.0022, 0.0028, 1, 8, 1, true).translate(0, -0.5, 0)),
      own(new THREE.MeshStandardMaterial({ color: '#5a2c10', roughness: 0.06, emissive: '#2a1206', emissiveIntensity: 0.6 })),
    );
    stream.position.copy(onProp(p, spout[0], spout[1], spout[2]));
    stream.visible = false;
    this.d.scene.add(light, stream);
    this.extras.push(light, stream);
    return {
      id: `coffee:${p.id}`,
      prop: p,
      mug,
      cup: onProp(p, ...cup),
      spout: onProp(p, ...spout),
      button: onProp(p, ...button),
      yaw,
      box,
      center: box.getCenter(new THREE.Vector3()),
      light,
      stream,
      state: 'idle',
      t: 0,
      drink: null,
      sound: null,
      stack: null,
      lids: null,
      rack: null,
      stand: new THREE.Vector2(st.x, st.z),
      // (you face the machine: its front faces `yaw`)
      facing: yaw + Math.PI,
    };
  }

  // ───────────────────────────── drinks ─────────────────────────────

  /** an empty cup as a drink: a new paper cup (off the stack), or a mug as built for the rack */
  private newCoffee(mug: boolean, built?: ReturnType<typeof buildCup>): Drink {
    const n = ++this.seq;
    const vessel = mug ? 'mug' : 'paper';
    const c = built ?? buildCup(vessel);
    const inst: ItemInstance = { id: `drink${n}`, kind: 'coffeeCup', label: mug ? 'mug' : 'paper cup', desc: '', pickable: true, root: c.root, box: new THREE.Box3() };
    // 8–12 sips to the bottom of a 12 oz cup (≈ 25–35 mL a sip)
    const sips = 8 + Math.floor(hash01(`cup${n}`) * 5);
    const d: Drink = { inst, vessel, fill: 0, sips: 0, sipsTotal: sips, temp: 82, surface: c.surface, r0: c.r0, r1: c.r1, hFull: c.hFull, base: c.base, steam: null, opened: true, lastFill: -1, lastUp: new THREE.Vector3(0, 1, 0), lid: null };
    this.drinks.set(inst, d);
    this.describe(d);
    return d;
  }

  private newSoda(flavour?: string): Drink {
    const n = ++this.seq;
    const soda = SODAS.find(s => s.name === flavour) ?? SODAS[(this.vending?.sold ?? 0) % SODAS.length];
    const root = buildCan(soda);
    const inst: ItemInstance = { id: `drink${n}`, kind: 'sodaCan', label: `can of ${soda.name}`, desc: '', pickable: true, root, box: new THREE.Box3() };
    const d: Drink = { inst, vessel: 'can', soda, fill: 1, sips: 0, sipsTotal: 9 + Math.floor(hash01(`can${n}`) * 4), temp: 5, surface: null, r0: 0.033, r1: 0.033, hFull: 0.1, base: 0.01, steam: null, opened: false, lastFill: 1, lastUp: new THREE.Vector3(0, 1, 0), lid: null };
    this.drinks.set(inst, d);
    this.describe(d);
    return d;
  }

  snapshot(): SavedAmenities {
    const st = this.seated;
    const seated = st && (() => {
      const { chair, sofa, ...seat } = st.seat;
      return { seat, furniture: (chair ?? sofa)!.id, nextSip: st.nextSip - this.time,
        spots: st.spots.map(p => ({ item: p.inst.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, side: p.side, yaw: p.yaw })) };
    })();
    return { seq: this.seq, sold: this.vending?.sold ?? 0, bills: this.payment.bills(), seated: seated ?? undefined,
      drinks: Array.from(this.drinks.values(), d => ({ id: d.inst.id, vessel: d.vessel, fill: d.fill, sips: d.sips,
        soda: d.soda?.name, temp: d.temp, sipsTotal: d.sipsTotal, opened: d.opened, lid: !!d.lid })),
      machines: this.machines.map(m => ({ id: m.id, drink: m.drink?.inst.id, state: m.state, t: m.t,
        cups: m.stack?.count, lids: m.lids?.count, rack: m.rack?.slots.map(s => !!s.mug) })) };
  }

  restore(saved: SavedAmenities) {
    const pool = new Map<string, ItemInstance>();
    for (const bill of saved.bills) this.payment.charge(bill.id, bill.what, bill.amount);
    for (const row of saved.drinks) {
      const d = row.vessel === 'can' ? this.newSoda(row.soda) : this.newCoffee(row.vessel === 'mug');
      Object.assign(d, { fill: row.fill, sips: row.sips, sipsTotal: row.sipsTotal, temp: row.temp, opened: row.opened });
      if (row.lid) {
        d.lid = buildLid();
        d.lid.position.y = PAPER.H - LID_SEAT;
        d.inst.root.add(d.lid);
      }
      d.inst.id = row.id;
      this.describe(d);
      pool.set(row.id, d.inst);
    }
    this.seq = saved.seq;
    if (this.vending) this.vending.sold = saved.sold;
    for (const row of saved.machines) {
      const m = this.machines.find(machine => machine.id === row.id);
      if (!m) continue;
      if (m.stack && row.cups !== undefined) while (m.stack.count > row.cups && m.stack.take()) {}
      if (m.lids && row.lids !== undefined) while (m.lids.count > row.lids && m.lids.take()) {}
      row.rack?.forEach((full, i) => {
        if (!full && m.rack?.slots[i]?.mug) { m.rack.slots[i].mug!.root.removeFromParent(); m.rack.take(i); }
      });
      const item = row.drink && pool.get(row.drink);
      if (item) this.placeCup(m, this.drinks.get(item)!);
      m.state = row.state;
      m.t = row.t;
    }
    return pool;
  }

  restoreSeat(saved: SavedAmenities['seated']) {
    if (!saved) return;
    const chair = this.chairs.find(c => c.id === saved.furniture);
    const sofa = this.sofas.find(s => s.id === saved.furniture);
    if (!chair && !sofa) return;
    const seat = { ...saved.seat, chair, sofa };
    const spots = saved.spots.flatMap(p => {
      const inst = this.d.items.items.get(p.item);
      return inst ? [{ inst, drink: this.drinks.get(inst) ?? null, pos: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, side: p.side }] : [];
    });
    this.seated = { seat, spots, nextSip: this.time + saved.nextSip, mode: this.d.cameraMode(), down: null };
    if (sofa) this.setSolid(sofa, false);
    this.d.hands.seated = true;
    const av = this.d.avatar();
    if (av) { av.seatKind = 'chair'; av.setPosture('sit', undefined, seat.seatY); }
  }

  /** label + inspect text follow the fill and the temperature */
  private describe(d: Drink) {
    const i = d.inst;
    if (d.vessel === 'can') {
      const s = d.soda!;
      i.label = d.fill <= 0.001 ? 'empty can' : `can of ${s.name}`;
      i.desc =
        d.fill <= 0.001
          ? 'Empty. Cans go in recycling.'
          : `${d.opened ? (d.fill > 0.66 ? 'Most of it left' : d.fill > 0.33 ? 'About half left' : 'Nearly finished') : 'Unopened, cold'}. ${s.sugar ? `${s.sugar} g of sugar a can, about ${Math.round(s.sugar / 4)} teaspoons.` : 'No sugar.'}`;
      return;
    }
    const cup = d.vessel === 'mug' ? 'mug' : 'paper cup';
    const owed = this.payment?.owes(i.id) ? ` Not paid for yet: $${COFFEE_PRICE.toFixed(2)} at the till.` : '';
    if (d.fill <= 0.001) {
      i.label = d.vessel === 'mug' ? 'empty mug' : 'empty paper cup';
      i.desc = (d.vessel === 'mug' ? 'Empty. A ring of coffee at the bottom. Rinse it before the next one.' : 'Empty. Paper cups are lined with plastic, so they go to landfill, not recycling.') + owed;
      return;
    }
    i.label = d.vessel === 'mug' ? 'mug of coffee' : 'coffee';
    const amount = d.fill > 0.85 ? 'Full' : d.fill > 0.6 ? 'About two-thirds left' : d.fill > 0.35 ? 'About half left' : 'A few sips left';
    const heat = d.temp > 62 ? 'hot' : d.temp > 48 ? 'warm' : d.temp > 35 ? 'lukewarm' : 'cold';
    i.desc = `${amount} in the ${cup}${d.lid ? ' (lid on)' : ''}, ${heat}. Caffeine's half-life is about 5 hours, so the 3 a.m. cup is still with you at 8.${owed}`;
  }

  private drinkFrame(d: Drink, dt: number) {
    // (a lid keeps it hot a while longer)
    d.temp = ROOM_C + (d.temp - ROOM_C) * Math.exp(-(d.lid ? COOL_K * 0.6 : COOL_K) * dt);
    // held, a lid's drinking slot is toward you (in first person the cup's +z faces the view; held by the
    // avatar, its −z faces the body); a sip turns it to the lip itself (rimPoint)
    if (d.lid && this.d.items.slotOf(d.inst) && !(this.action?.kind === 'sip' && this.action.d === d)) d.lid.rotation.y = this.d.cameraMode() === 'first' ? 0 : Math.PI;
    const root = d.inst.root;
    if (d.surface) {
      // world up in the cup's frame: the surface stays level however the cup is tipped
      root.updateWorldMatrix(true, false);
      const n = this.v2.copy(UP).applyQuaternion(root.getWorldQuaternion(this.q1).invert());
      const refill = Math.abs(d.fill - d.lastFill) > 1e-4;
      if (refill || n.angleTo(d.lastUp) > 0.003) {
        d.lastUp.copy(n);
        d.surface.visible = d.fill > 0.004;
        if (d.surface.visible) writeSurface(d.surface.geometry, surfaceOutline(d, d.fill, n), n);
        if (refill) {
          d.lastFill = d.fill;
          this.describe(d);
        }
      }
    }
    // steam: hot coffee only, fading as it cools; drawn only near the camera
    if (d.vessel === 'can') return;
    const intensity = d.fill > 0.02 && root.parent ? clamp01((d.temp - 44) / 30) : 0;
    if (intensity <= 0) {
      d.steam?.update(this.v1, 0, 0, dt, this.d.camera);
      return;
    }
    root.updateWorldMatrix(true, false);
    // with a lid on, a thin wisp out of its drinking slot
    const top = d.lid ? d.lid.localToWorld(this.v1.set(0, 0.0135, 0.038)) : root.localToWorld(this.v1.set(0, d.base + d.hFull * 1.02, 0));
    if (top.distanceToSquared(this.d.camera.position) > 14 * 14) {
      d.steam?.update(top, 0, 0, dt, this.d.camera);
      return;
    }
    d.steam ??= new Steam(this.d.scene, this.seq);
    d.steam.update(top, d.lid ? 0.014 : d.r1, d.lid ? intensity * 0.4 : intensity, dt, this.d.camera);
    if (d.inst.label === '' || d.fill !== d.lastFill) this.describe(d);
  }

  private disposeDrink(d: Drink) {
    d.steam?.dispose();
    this.drinks.delete(d.inst);
  }

  // ───────────────────────────── targets ─────────────────────────────

  /** what can be used right now (the world adds these to its aim ray) */
  targets(): AmenityTarget[] {
    const out: AmenityTarget[] = [];
    const items = this.d.items;
    const held = items.heldItems();
    const busy = !!this.action;
    for (const m of this.machines) {
      const refill = this.refillable(m);
      const label =
        m.state === 'brewing'
          ? `Coffee brewing… ${Math.max(1, Math.ceil(SND.BREW.done - m.t))} s`
          : m.state === 'ready'
            ? `Take your ${m.mug ? 'mug of coffee' : 'coffee'}`
            : m.drink
              ? 'Start the coffee'
              : refill
                ? `Refill your ${refill.vessel === 'mug' ? 'mug' : 'cup'}`
                : m.stack && !m.stack.count
                  ? 'Out of cups · more on the way'
                  : m.mug
                    ? 'Make a coffee (staff machine)'
                    : `Make a coffee · $${COFFEE_PRICE.toFixed(2)}`;
      out.push({ key: `use:${m.id}`, target: { kind: 'use', id: m.id, label }, box: m.box, center: m.center });
    }
    // what you owe, at the till
    for (const t of this.payment.targets()) out.push(t);
    if (!this.seated) {
      const drink = held.some((i) => this.drinks.has(i));
      for (const c of this.chairs) {
        if (this.d.occupied(c.x, c.z, 0.38)) continue;
        out.push({ key: `use:sit:${c.id}`, target: { kind: 'use', id: `sit:${c.id}`, label: drink ? 'Sit down with your drink' : 'Sit down' }, box: c.box, center: c.center });
      }
      const ctl = this.d.controller;
      for (const s of this.sofas) {
        // (only the ones near you, on your storey)
        if (Math.abs(s.y - ctl.y) > 1.5 || Math.hypot(s.center.x - ctl.pos.x, s.center.z - ctl.pos.y) > 6) continue;
        if (!this.sofaSeat(s)) continue;
        out.push({ key: `use:sofa:${s.id}`, target: { kind: 'use', id: `sofa:${s.id}`, label: drink ? 'Sit down with your drink' : 'Sit on the sofa' }, box: s.box, center: s.center, level: s.level });
      }
    }
    const trash = [...held].reverse().find((i) => DISPOSABLE.has(i.kind));
    if (trash && !busy) for (const b of this.bins) out.push({ key: `use:bin:${b.id}`, target: { kind: 'use', id: `bin:${b.id}`, label: `Throw away the ${trash.label}` }, box: b.box, center: b.center });
    // (F on it: what it is, World.ts; as the wheelchair's prompt says)
    if (this.vending) out.push({ key: 'use:vend', target: { kind: 'use', id: 'vend', label: this.vending.busy ? 'Vending…' : 'Buy a drink · [F] Inspect' }, box: this.vending.box, center: this.vending.center });
    return out;
  }

  /** E on this NPC pays what you owe (the cafeteria's cashier), in place of talking to them; null: talk */
  npcTarget(id: string): Extract<InteractTarget, { kind: 'use' }> | null {
    return this.payment.npcTarget(id);
  }

  /** a world interactable that steps aside for one of ours just now (the till's card while you owe: you pay) */
  shadows(key: string): boolean {
    return key === 'fx:caf_till' && this.payment.targets().length > 0;
  }

  find(key: string): AmenityTarget | undefined {
    const hit = this.targets().find((t) => t.key === key);
    if (hit) return hit;
    // the cashier you owe (a click from afar walks you up to him first: World's resolvePending)
    const id = key.startsWith('use:pay:') ? key.slice(8) : null;
    const n = id ? this.d.npcs?.get(id) : null;
    const target = id ? this.npcTarget(id) : null;
    if (!n || !target) return undefined;
    const center = new THREE.Vector3(n.x, 0.9, n.z);
    return { key, target, box: new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(0.66, 1.8, 0.66)), center };
  }

  /** with nothing in sight: standing up from a café chair or a sofa */
  idleTarget(): { key: string; target: InteractTarget } | null {
    if (!this.seated) return null;
    return { key: 'use:stand', target: { kind: 'use', id: 'stand', label: 'Stand up' } };
  }

  /**
   * An empty cup or mug in your hand, to refill: a mug anywhere, but a paper cup is used once (with its
   * lid on it doesn't go back under a spout): the cafeteria's machine gives you a fresh one
   */
  private refillable(m?: Machine): Drink | null {
    for (const i of this.d.items.heldItems()) {
      const d = this.drinks.get(i);
      if (d && d.vessel !== 'can' && d.fill <= 0.001 && (d.vessel === 'mug' || !m?.stack)) return d;
    }
    return null;
  }

  interact(id: string) {
    if (id === 'stand') return this.standUp();
    if ((this.action && this.action.kind !== 'sip') || this.payment.busy) {
      this.d.hint('One thing at a time', 1500);
      return;
    }
    if (id.startsWith('coffee:')) return this.useMachine(this.machines.find((m) => m.id === id)!);
    if (id.startsWith('sit:')) return this.sit(this.chairs.find((c) => `sit:${c.id}` === id)!);
    if (id.startsWith('sofa:')) return this.sitSofa(this.sofas.find((s) => `sofa:${s.id}` === id)!);
    if (id.startsWith('bin:')) return this.toss(this.bins.find((b) => `bin:${b.id}` === id)!);
    if (id === 'vend') return this.buy();
    if (id.startsWith('pay:')) {
      if (this.seated) this.standUp();
      if (this.action?.kind === 'sip') this.finishSip(this.action);
      return this.payment.interact(id);
    }
  }

  /** busy with something in your hands (hygiene.ts waits: one thing at a time) */
  get handAction() { return !!this.action || this.payment.busy || !!this.seated?.down || !!this.rising; }

  get busy(): boolean {
    return (!!this.action && this.action.kind !== 'sip') || this.payment.busy;
  }

  // ───────────────────────────── coffee ─────────────────────────────

  private useMachine(m: Machine) {
    if (!m) return;
    const items = this.d.items;
    if (m.state === 'brewing') {
      this.d.hint(`Still pouring: about ${Math.max(1, Math.ceil(SND.BREW.done - m.t))} s`, 1600);
      return;
    }
    if (this.seated) this.standUp();
    if (this.action?.kind === 'sip') this.finishSip(this.action);
    // ready: take it (the cafeteria's paper cup gets a lid off the lid stack first)
    if (m.state === 'ready' && m.drink) {
      const side = this.freeSide();
      if (!side) {
        this.d.hint('Hands full: put something down first (G)', 2800);
        return;
      }
      const d = m.drink;
      const lid = !!m.lids && d.vessel === 'paper' && !d.lid;
      this.begin({ kind: 'take', t: 0, m, side, d, T: lid ? TAKE.lid : TAKE.plain, lid: null, lidAt: null, lidTaken: false, lidOn: !lid, gripped: false, slip: new THREE.Vector3(), yaw0: d.inst.root.rotation.y, approach: null, approachT: 0, turn: null });
      return;
    }
    // a cup already under the spout (you walked off before pressing): just the button
    if (m.drink) {
      this.begin(this.makeAction(m, this.freeSide() ?? 'R', 'placed'));
      return;
    }
    const own = this.refillable(m);
    const full = items.heldItems().find((i) => {
      const x = this.drinks.get(i);
      return x && x.vessel !== 'can' && x.fill > 0.001;
    });
    if (!own && full) {
      this.d.hint('Finish the coffee you have first (or put it down: G)', 2600);
      return;
    }
    if (own) {
      // your own empty cup or mug, from your hand to the tray
      const a = this.makeAction(m, items.slotOf(own.inst) === 'L' ? 'L' : 'R', 'own');
      a.d = own;
      this.begin(a);
      return;
    }
    if (!items.hasFreeHand()) {
      this.d.hint('Hands full: put something down first (G)', 2800);
      return;
    }
    if (m.stack && !m.stack.count) {
      this.d.hint('Out of paper cups: more are on the way', 2400);
      return;
    }
    if (m.rack && !m.rack.count) {
      this.d.hint('No clean mugs on the rack: they come back from the dishwasher now and then', 2600);
      return;
    }
    this.begin(this.makeAction(m, items.hands.R ? 'L' : 'R', m.rack ? 'rack' : 'stack'));
  }

  private freeSide(): HandSide | null {
    const h = this.d.items.hands;
    return !h.R ? 'R' : !h.L ? 'L' : null;
  }

  private makeAction(m: Machine, side: HandSide, from: MakeAction['from']): MakeAction {
    return { kind: 'make', t: 0, m, side, from, d: from === 'placed' ? m.drink : null, slot: -1, mug: null, T: MAKE[from], grabbed: from === 'own' || from === 'placed', placed: from === 'placed', pressed: false, grabAt: null, slip: new THREE.Vector3(), approach: null, approachT: 0, turn: null };
  }

  /** a coffee action starts: up to the counter first if you're not there, then a turn to it */
  private begin(a: MakeAction | TakeAction) {
    const ctl = this.d.controller;
    const m = a.m;
    this.action = a;
    if (Math.hypot(ctl.pos.x - m.stand.x, ctl.pos.y - m.stand.y) > 0.3) {
      const path = this.wayTo(m.stand.x, m.stand.y, ctl.y, true);
      if (!path || !path.length) {
        this.action = null;
        this.d.hint("Can't get to the machine from here", 1600);
        return;
      }
      ctl.path = path;
      ctl.pathRun = false;
      a.approach = path;
      return;
    }
    this.started(a);
  }

  /** at the counter: turn to it; your own empty cup leaves the item system for this hand to carry */
  private started(a: MakeAction | TakeAction) {
    const m = a.m;
    const ctl = this.d.controller;
    const first = this.d.cameraMode() === 'first';
    const f0 = first ? ctl.yaw + Math.PI : ctl.facing;
    const f1 = m.facing;
    const off = Math.abs(Math.atan2(Math.sin(f1 - f0), Math.cos(f1 - f0)));
    // first person: the view turns (and tips) to the drip tray only if it's out of view
    const at = m.cup;
    const bearing = Math.atan2(at.x - ctl.pos.x, at.z - ctl.pos.y);
    const vOff = Math.abs(Math.atan2(Math.sin(bearing - f0), Math.cos(bearing - f0)));
    const want = Math.atan2(at.y - (ctl.y + 1.65), Math.hypot(at.x - ctl.pos.x, at.z - ctl.pos.y));
    const p1 = first && Math.abs(want - ctl.pitch) > 0.35 ? Math.max(-0.9, Math.min(0.3, want + 0.1)) : null;
    const y1 = first && vOff > 0.4 ? bearing - Math.PI : ctl.yaw;
    a.turn = { t: 0, dur: Math.max(off, first ? vOff : 0) < 0.03 ? 0 : 0.12 + (Math.max(off, first ? vOff : 0) / Math.PI) * 0.5, f0, f1, y0: ctl.yaw, y1, p0: ctl.pitch, p1 };
    if (a.kind === 'take') {
      a.lidAt = a.lidOn ? null : (m.lids?.lidTop(new THREE.Vector3()) ?? null);
      // (no lid left on the stack: it goes without)
      if (!a.lidAt && !a.lidOn) {
        a.lidOn = true;
        a.T = TAKE.plain;
      }
      return;
    }
    if (a.from === 'stack') a.grabAt = m.stack?.rim(new THREE.Vector3()) ?? null;
    else if (a.from === 'rack') {
      const n = m.rack?.next();
      if (!n) {
        this.action = null;
        return;
      }
      a.slot = n.i;
      a.mug = n.mug;
      const r = n.mug.root;
      // the mug's grip centre as it stands on the rack (its bounds' middle, measured as hands.ts does)
      const tmp: ItemInstance = { id: 'rack', kind: 'coffeeCup', label: '', desc: '', pickable: true, root: r, box: new THREE.Box3() };
      a.grabAt = this.d.items.gripOf(tmp).center.clone().applyAxisAngle(UP, r.rotation.y).add(r.position);
    } else if (a.from === 'own' && a.d) {
      // out of your hand as it is drawn now: this hand carries it on from there
      const root = a.d.inst.root;
      root.updateWorldMatrix(true, false);
      const at0 = root.getWorldPosition(new THREE.Vector3());
      this.d.items.release(a.d.inst);
      root.position.copy(at0);
      root.rotation.set(0, first ? ctl.yaw : ctl.facing, 0);
      this.d.scene.add(root);
      a.d.temp = 82;
      a.d.sips = 0;
      a.grabAt = this.cupCentre(a.d, at0, root.rotation.y);
    }
  }

  private turnFrame(a: MakeAction | TakeAction, dt: number) {
    const ctl = this.d.controller;
    if (this.d.cameraMode() !== 'first') {
      // the body turns to what the hand is going for, which ends a little to the reaching arm's side
      // (gesture.ts), at a turn's pace: the stack, then the drip tray and the button
      const f = this.focusOf(a);
      const want = Math.atan2(f.x - ctl.pos.x, f.z - ctl.pos.y) + (a.side === 'L' ? -0.17 : 0.17);
      ctl.facing = lerpAngle(ctl.facing, want, Math.min(1, dt * 5));
      return;
    }
    const tn = a.turn;
    if (!tn || tn.t >= tn.dur) return;
    tn.t += dt;
    const k = smooth(tn.t / Math.max(1e-3, tn.dur));
    ctl.yaw = lerpAngle(tn.y0, tn.y1, k);
    if (tn.p1 !== null) ctl.pitch = tn.p0 + (tn.p1 - tn.p0) * k;
  }

  /** what the hand is going for now: the cup (stack, rack, your hand), the lid stack, the drip tray */
  private focusOf(a: MakeAction | TakeAction): THREE.Vector3 {
    const m = a.m;
    if (a.kind === 'make') return a.t < a.T.lift && a.grabAt ? a.grabAt : m.cup;
    return !a.lidOn && a.lidAt && a.t < a.T.lidUp ? a.lidAt : m.cup;
  }

  /** the way from you to the machine (horizontal) */
  private toMachine(m: Machine): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(m.facing), 0, Math.cos(m.facing));
  }

  /** a cup's grip centre (its bounds' middle, as hands.ts holds it) for its root at `at`, turned `yaw` */
  private cupCentre(d: Drink, at: THREE.Vector3, yaw: number): THREE.Vector3 {
    return this.d.items.gripOf(d.inst).center.clone().applyAxisAngle(UP, yaw).add(at);
  }

  private cupRadius(d: Drink): number {
    const g = this.d.items.gripOf(d.inst);
    return Math.min(g.size.x, g.size.z) / 2;
  }

  private claw(side: HandSide, F: Frame, at: THREE.Vector3, g = GRIP.claw, fingers = FINGERS.claw): HandPose {
    const q = fromAbove(side, F, at);
    return { p: wristFor(side, at, q, g, F.s), q, fingers, w: 1 };
  }

  private sideGrip(side: HandSide, F: Frame, at: THREE.Vector3, r: number, fingers = FINGERS.wrap): HandPose {
    const q = fromSide(side, F, at);
    return { p: wristFor(side, at, q, GRIP.side(r), F.s), q, fingers, w: 1 };
  }

  /** the middle fingertips on a button (palm down, fingers toward it), `push` metres in */
  private tip(side: HandSide, F: Frame, m: Machine, push: number): HandPose {
    const into = this.toMachine(m);
    const at = m.button.clone().addScaledVector(into, push);
    const q = palmQuat(side, into, new THREE.Vector3(0, -1, 0));
    return { p: wristFor(side, at, q, GRIP.tip, F.s), q, fingers: FINGERS.press, w: 1 };
  }

  /** where the cup goes on the drip tray: its rim (taken from above) or its grip centre (round the side) */
  private trayAnchor(a: MakeAction, d: Drink | null): THREE.Vector3 {
    const m = a.m;
    if (a.from === 'stack' || !d) return m.cup.clone().addScaledVector(UP, PAPER.H);
    return this.cupCentre(d, m.cup, this.trayYaw(m, d));
  }

  private trayYaw(m: Machine, d: Drink): number {
    return m.yaw + (d.vessel === 'mug' ? Math.PI / 2 : 0);
  }

  /** the hand at this moment of making a coffee */
  private makePose(a: MakeAction, F: Frame): HandPose {
    const { m, side, T, t } = a;
    const rest = restPose(F, side);
    const back = this.toMachine(m).negate();
    const fromAboveIt = a.from === 'stack';
    const d = a.d;
    const r = d ? this.cupRadius(d) : PAPER.r1;
    const hold = (at: THREE.Vector3, fingers?: typeof FINGERS.wrap) => (fromAboveIt ? this.claw(side, F, at, GRIP.claw, fingers ?? FINGERS.claw) : this.sideGrip(side, F, at, r, fingers ?? FINGERS.wrap));
    const g0 = a.grabAt ?? this.trayAnchor(a, d);
    const tray = this.trayAnchor(a, d);
    const btnOut = this.tip(side, F, m, -0.03);
    const btnIn = this.tip(side, F, m, 0.012);
    // after the button: back to rest
    if (t >= T.press) return t < T.press + 0.12 ? blend(btnIn, btnOut, ramp(t, T.press, T.press + 0.12)) : blend(btnOut, { ...rest, w: 0 }, ramp(t, T.press + 0.12, T.back));
    if (t >= T.button) return blend(btnOut, btnIn, ramp(t, T.button, T.press));
    if (a.from === 'placed') return blend(rest, btnOut, ramp(t, 0, T.button));
    // off the cup once it's down, and over to the button
    const off = fromAboveIt ? this.claw(side, F, tray.clone().addScaledVector(UP, 0.07).addScaledVector(back, 0.04), GRIP.claw, FINGERS.open) : this.sideGrip(side, F, tray.clone().addScaledVector(back, 0.08), r, FINGERS.open);
    if (t >= T.place + 0.2) return blend(off, btnOut, ramp(t, T.place + 0.2, T.button));
    if (t >= T.place) return blend(hold(tray), off, ramp(t, T.place, T.place + 0.2));
    const over = tray.clone().addScaledVector(UP, 0.045);
    if (t >= T.over) return blend(hold(over), hold(tray), ramp(t, T.over, T.place));
    if (a.from === 'own') return blend(hold(g0), hold(over), ramp(t, 0, T.over));
    // fetched: off the stack (lifted straight out of it) or off the rack (up and out toward you)
    const lifted = fromAboveIt ? g0.clone().addScaledVector(UP, 0.135) : g0.clone().addScaledVector(UP, 0.035).addScaledVector(back, 0.12);
    if (t >= T.lift) return blend(hold(lifted), hold(over), ramp(t, T.lift, T.over));
    if (t >= T.grab) return blend(hold(g0), hold(lifted), ramp(t, T.grab, T.lift));
    const near = fromAboveIt ? g0.clone().addScaledVector(UP, 0.07) : g0.clone().addScaledVector(back, 0.07);
    const open = hold(near, FINGERS.open);
    if (t >= T.reach) return blend(open, hold(g0), ramp(t, T.reach, T.grab));
    return blend(rest, open, ramp(t, 0, T.reach));
  }

  /** the hand at this moment of taking the coffee (a lid on first) */
  private takePose(a: TakeAction, F: Frame): HandPose {
    const { m, side, T, t, d } = a;
    const rest = restPose(F, side);
    const back = this.toMachine(m).negate();
    const r = this.cupRadius(d);
    const cupC = this.cupCentre(d, m.cup, a.yaw0);
    // (the open hand beside the cup on its own side, where the grip holds it, and in from there: brought
    // in from in front, its fingers went through the cup to wrap round its far side)
    const sg = side === 'R' ? 1 : -1;
    const near = this.sideGrip(side, F, cupC.clone().addScaledVector(F.r, sg * 0.06).addScaledVector(back, 0.03), r, FINGERS.open);
    const pulled = cupC.clone().addScaledVector(UP, 0.015).addScaledVector(back, 0.16);
    if (t >= T.pull) return blend(this.sideGrip(side, F, pulled, r), this.carryPose(a, F), ramp(t, T.pull, T.carry));
    if (t >= T.grip) return blend(this.sideGrip(side, F, cupC, r), this.sideGrip(side, F, pulled, r), ramp(t, T.grip, T.pull));
    if (t >= T.toCup) return blend(near, this.sideGrip(side, F, cupC, r), ramp(t, T.toCup, T.grip));
    if (!a.lidAt) return blend(rest, near, ramp(t, 0, T.toCup));
    // the lid: off its stack from above, over the cup, pressed on
    const pinch = (at: THREE.Vector3, fingers = FINGERS.claw) => this.claw(side, F, at, GRIP.lid, fingers);
    const seated = m.cup.clone().addScaledVector(UP, PAPER.H - LID_SEAT + LID_TOP);
    const pressed = pinch(seated.clone().addScaledVector(UP, -0.003), FINGERS.press);
    if (t >= T.lidOn) {
      const up = pinch(seated.clone().addScaledVector(UP, 0.05).addScaledVector(back, 0.03), FINGERS.open);
      const mid = T.lidOn + (T.toCup - T.lidOn) * 0.4;
      return t < mid ? blend(pressed, up, ramp(t, T.lidOn, mid)) : blend(up, near, ramp(t, mid, T.toCup));
    }
    const over = pinch(seated.clone().addScaledVector(UP, 0.035));
    if (t >= T.lidOver) return blend(over, pressed, ramp(t, T.lidOver, T.lidOn));
    const lid0 = a.lidAt;
    const lifted = pinch(lid0.clone().addScaledVector(UP, 0.07));
    if (t >= T.lidUp) return blend(lifted, over, ramp(t, T.lidUp, T.lidOver));
    if (t >= T.lidGrab) return blend(pinch(lid0), lifted, ramp(t, T.lidGrab, T.lidUp));
    const above = pinch(lid0.clone().addScaledVector(UP, 0.06), FINGERS.open);
    if (t >= T.lid) return blend(above, pinch(lid0), ramp(t, T.lid, T.lidGrab));
    return blend(rest, above, ramp(t, 0, T.lid));
  }

  /** where a hand carries a cup: third person hands.ts's carry pose, first person the view's lower corner */
  private carryPose(a: TakeAction, F: Frame): HandPose {
    const side = a.side;
    if (F.tp) {
      const c = this.d.hands.carryGoal(side);
      if (c?.quat) return { p: c.target.clone(), q: c.quat.clone(), fingers: FINGERS.wrap, w: 1, pole: c.pole?.clone() };
    }
    const at = this.fpSocket(side, a.d);
    return this.sideGrip(side, F, at, this.cupRadius(a.d));
  }

  /** first person: where itemSystem.ts shows a cup held in this hand (its grip centre) */
  private fpSocket(side: HandSide, d: Drink): THREE.Vector3 {
    const at = this.d.camera.localToWorld(new THREE.Vector3(side === 'R' ? 0.21 : -0.21, -0.23, -0.45));
    return this.cupCentre(d, at, this.d.controller.yaw);
  }

  private placeCup(m: Machine, d: Drink) {
    this.d.hands.unmount(d.inst.root);
    d.inst.root.position.copy(m.cup);
    d.inst.root.rotation.set(0, this.trayYaw(m, d), 0);
    d.inst.root.scale.setScalar(1);
    if (d.inst.root.parent !== this.d.scene) this.d.scene.add(d.inst.root);
    this.sound('cupDown', SND.cupDown, m.cup, 0.6, 8);
    m.drink = d;
  }

  private startBrew(m: Machine) {
    m.state = 'brewing';
    m.t = 0;
    m.light.visible = true;
    m.sound = this.sound('brew', SND.brew, m.spout, 1.5, 16);
    // the cafeteria's coffee is owed for from the moment it pours (payment.ts)
    if (!m.mug && m.drink) {
      this.payment.charge(m.drink.inst.id);
      this.describe(m.drink);
    }
  }

  /** before hands.apply: walking up, the turn, the clock; third person, the arm */
  private coffeeFrame(a: MakeAction | TakeAction, dt: number) {
    const ctl = this.d.controller;
    if (a.approach) {
      a.approachT += dt;
      if (ctl.steering || (ctl.path && ctl.path !== a.approach) || a.approachT > 8) {
        if (ctl.path === a.approach) ctl.path = null;
        this.action = null;
        return;
      }
      if (ctl.path) return;
      a.approach = null;
      if (Math.hypot(ctl.pos.x - a.m.stand.x, ctl.pos.y - a.m.stand.y) > 0.6) {
        this.action = null;
        this.d.hint("Can't get to the machine from here", 1600);
        return;
      }
      this.started(a);
    }
    // walking off: whatever the hand has is kept (a cup in hand, a cup left under the spout)
    if (ctl.steering || ctl.path) return this.cutCoffee(a);
    a.t = this.holdT !== null ? Math.min(a.t + dt, this.holdT) : a.t + dt;
    this.turnFrame(a, dt);
    if (!this.thirdPerson()) return;
    const F = this.reachHands.frame();
    if (!F) return;
    const h = a.kind === 'make' ? this.makePose(a, F) : this.takePose(a, F);
    // reaching over the counter: lean in a little (hands.ts), so the arm needn't stretch straight
    const reach = h.p.clone().sub(F.sh[a.side]).setY(0).length();
    if (h.w > 0.2) (this.d.hands as PlayerHands & { lean?(angle: number): void }).lean?.(Math.min(0.2, Math.max(0, reach - 0.3) * 0.9) * h.w);
    this.reachHands.pose(a.side, h, F);
    // (tests: how far the arm has to reach now)
    this.lastReach = { wrist: h.p.toArray().map((x) => +x.toFixed(3)), shoulder: F.sh[a.side].toArray().map((x) => +x.toFixed(3)), dist: +h.p.distanceTo(F.sh[a.side]).toFixed(3), facing: +this.d.controller.facing.toFixed(3) };
  }

  /** walked off mid-way: the cup stays where the hand had got it to */
  private cutCoffee(a: MakeAction | TakeAction) {
    const m = a.m;
    this.action = null;
    this.reachHands.hide();
    if (a.kind === 'make') {
      const d = a.d;
      if (!d) return;
      if (!a.placed && a.grabbed) {
        // (an empty cup: in your hand)
        if (!this.d.items.give(d.inst, true)) this.placeCup(m, d);
      } else if (a.placed && !a.pressed) m.drink = d;
      return;
    }
    if (a.lid && !a.lidOn) this.lidOn(a);
    if (a.gripped) this.d.items.give(a.d.inst);
  }

  /** after the arms are posed: first person, the hand; then what the hand holds, and what it just did */
  private coffeeAfter(a: MakeAction | TakeAction) {
    if (a.approach) return;
    const tp = this.thirdPerson();
    const F = this.reachHands.frame();
    if (!F) return;
    if (!tp) this.reachHands.pose(a.side, a.kind === 'make' ? this.makePose(a, F) : this.takePose(a, F), F);
    else this.reachHands.hide();
    if (a.kind === 'make') this.makeEvents(a, F);
    else this.takeEvents(a, F);
  }

  private makeEvents(a: MakeAction, F: Frame) {
    const m = a.m;
    const T = a.T;
    const t = a.t;
    const claw = a.from === 'stack';
    const anchor = new THREE.Vector3();
    const has = this.reachHands.grip(a.side, claw ? GRIP.claw : GRIP.side(a.d ? this.cupRadius(a.d) : 0.042), anchor);
    // the hand at the cup: it is taken (off the stack where the top cup stood; off the rack)
    if (!a.grabbed && t >= T.grab) {
      a.grabbed = true;
      if (claw && m.stack) {
        const before = m.stack.count;
        const at = m.stack.top(new THREE.Vector3())!;
        const d = this.newCoffee(false);
        d.inst.root.position.copy(at);
        d.inst.root.rotation.set(0, m.yaw, 0);
        this.d.scene.add(d.inst.root);
        m.stack.take();
        a.d = d;
        const rim = at.clone().addScaledVector(UP, PAPER.H);
        a.slip.copy(rim).sub(anchor);
        this.event({ kind: 'grab', from: 'stack', hand: has ? +anchor.distanceTo(rim).toFixed(4) : null, before, after: m.stack.count, tp: F.tp });
        this.sound('cupPull', SND.cupPull, rim, 0.5, 6);
      } else if (m.rack && a.mug) {
        const before = m.rack.count;
        const built = this.rackCups.get(a.mug.root);
        this.rackCups.delete(a.mug.root);
        m.rack.take(a.slot);
        const d = this.newCoffee(true, built);
        a.d = d;
        const c = this.cupCentre(d, d.inst.root.position, d.inst.root.rotation.y);
        a.slip.copy(c).sub(anchor);
        this.event({ kind: 'grab', from: 'rack', hand: has ? +anchor.distanceTo(c).toFixed(4) : null, before, after: m.rack.count, tp: F.tp });
        this.sound('mugLift', SND.mugLift, c, 0.5, 6);
      }
    }
    const d = a.d;
    // carried: from the hand as drawn, the slip at the grab eased away as it comes up
    if (d && a.grabbed && !a.placed) {
      const root = d.inst.root;
      const k = a.from === 'own' ? ramp(t, 0, 0.35) : ramp(t, T.grab, T.lift);
      const yaw = a.from === 'own' ? root.rotation.y : root.rotation.y;
      const pos = claw ? anchor.clone().addScaledVector(UP, -PAPER.H) : anchor.clone().sub(this.d.items.gripOf(d.inst).center.clone().applyAxisAngle(UP, yaw));
      pos.addScaledVector(a.slip, 1 - k);
      // the last moment before it's down: exactly onto the tray
      const settle = ramp(t, T.place - 0.16, T.place);
      if (settle > 0) pos.lerp(m.cup, settle);
      root.position.copy(pos);
      root.rotation.set(0, settle > 0 ? lerpAngle(yaw, this.trayYaw(m, d), settle) : yaw, 0);
    }
    if (d && !a.placed && t >= T.place) {
      a.placed = true;
      this.placeCup(m, d);
      const axis = Math.hypot(d.inst.root.position.x - m.spout.x, d.inst.root.position.z - m.spout.z);
      this.event({ kind: 'place', spout: +axis.toFixed(4), tray: +Math.abs(d.inst.root.position.y - m.cup.y).toFixed(4), cup: d.inst.root.position.toArray().map((x) => +x.toFixed(3)) });
    }
    if (!a.pressed && t >= T.press) {
      a.pressed = true;
      if (!m.drink && d) m.drink = d;
      const tipAt = new THREE.Vector3();
      const hasTip = this.reachHands.grip(a.side, GRIP.tip, tipAt);
      this.startBrew(m);
      this.event({ kind: 'press', hand: hasTip ? +tipAt.distanceTo(m.button).toFixed(4) : null });
      if (!F.tp) this.d.hint("Brewing… caffeine's half-life is about 5 hours, so the 3 a.m. cup is still with you at 8", 4000);
    }
    if (t >= T.back) {
      this.action = null;
      this.reachHands.hide();
    }
  }

  private takeEvents(a: TakeAction, F: Frame) {
    const m = a.m;
    const T = a.T;
    const t = a.t;
    const d = a.d;
    const lids = m.lids;
    // the lid: off the top of the lid stack when the fingers get there
    if (!a.lidTaken && !a.lidOn && lids && t >= T.lidGrab) {
      a.lidTaken = true;
      const before = lids.count;
      const at = lids.top(new THREE.Vector3());
      const lid = buildLid();
      if (at) lid.position.copy(at);
      this.d.scene.add(lid);
      lids.take();
      a.lid = lid;
      const top = (at ?? new THREE.Vector3()).clone().addScaledVector(UP, LID_TOP);
      const hand = new THREE.Vector3();
      const has = this.reachHands.grip(a.side, GRIP.lid, hand);
      a.slip.copy(top).sub(hand);
      this.event({ kind: 'lidGrab', hand: has ? +hand.distanceTo(top).toFixed(4) : null, before, after: lids.count, tp: F.tp });
    }
    if (a.lid && !a.lidOn) {
      const hand = new THREE.Vector3();
      this.reachHands.grip(a.side, GRIP.lid, hand);
      const k = ramp(t, T.lidGrab, T.lidUp);
      const pos = hand.addScaledVector(UP, -LID_TOP).addScaledVector(a.slip, 1 - k);
      const seat = m.cup.clone().addScaledVector(UP, PAPER.H - LID_SEAT);
      const settle = ramp(t, T.lidOn - 0.12, T.lidOn);
      if (settle > 0) pos.lerp(seat, settle);
      a.lid.position.copy(pos);
      a.lid.rotation.set(0, m.yaw + Math.PI, 0);
      if (t >= T.lidOn) this.lidOn(a);
    }
    if (!a.gripped && t >= T.grip) {
      a.gripped = true;
      m.state = 'idle';
      m.drink = null;
      const hand = new THREE.Vector3();
      const has = this.reachHands.grip(a.side, GRIP.side(this.cupRadius(d)), hand);
      const c = this.cupCentre(d, d.inst.root.position, d.inst.root.rotation.y);
      a.slip.copy(c).sub(hand);
      this.event({ kind: 'grip', hand: has ? +hand.distanceTo(c).toFixed(4) : null });
    }
    if (a.gripped) {
      const hand = new THREE.Vector3();
      this.reachHands.grip(a.side, GRIP.side(this.cupRadius(d)), hand);
      // the cup turns from how it stood on the tray to how a hand carries it (the body's way, hands.ts)
      const yaw1 = F.tp ? (this.d.avatar()?.root.rotation.y ?? this.d.controller.facing) : this.d.controller.yaw;
      const yaw = lerpAngle(a.yaw0, yaw1, ramp(t, T.pull, T.carry));
      const k = ramp(t, T.grip, T.pull);
      d.inst.root.position.copy(hand.sub(this.d.items.gripOf(d.inst).center.clone().applyAxisAngle(UP, yaw)).addScaledVector(a.slip, 1 - k));
      d.inst.root.rotation.set(0, yaw, 0);
    }
    if (t >= T.carry) {
      this.action = null;
      this.reachHands.hide();
      if (this.d.items.give(d.inst)) this.event({ kind: 'inHand', lid: !!d.lid, owed: this.payment.owes(d.inst.id) });
      else this.placeCup(m, d);
    }
  }

  /** the lid pressed onto the cup's rim: it's the cup's now */
  private lidOn(a: TakeAction) {
    const lid = a.lid;
    a.lidOn = true;
    if (!lid) return;
    const d = a.d;
    const root = d.inst.root;
    root.updateWorldMatrix(true, false);
    const seat = root.localToWorld(new THREE.Vector3(0, PAPER.H - LID_SEAT, 0));
    const gap = lid.position.distanceTo(seat);
    lid.removeFromParent();
    root.add(lid);
    lid.position.set(0, PAPER.H - LID_SEAT, 0);
    lid.rotation.set(0, Math.PI, 0);
    d.lid = lid;
    // its bounds (and so its grip) now include the lid
    delete (root.userData as { grip?: unknown }).grip;
    this.describe(d);
    this.sound('lidSnap', SND.lidSnap, seat, 0.55, 6);
    this.event({ kind: 'lid', gap: +gap.toFixed(4), onCup: true });
  }

  private event(e: Record<string, unknown>) {
    this.events.push({ ...e, t: +this.time.toFixed(2) });
    if (this.events.length > 40) this.events.shift();
  }

  private machineFrame(m: Machine, dt: number) {
    if (m.state !== 'brewing') {
      m.stream.visible = false;
      return;
    }
    m.t += dt;
    const B = SND.BREW;
    const d = m.drink;
    const pour = clamp01((m.t - B.pourAt) / (B.pourEnd - B.pourAt));
    if (d) {
      // the cup fills along the pour, a little faster at first (the stream is strongest then)
      d.fill = Math.max(d.fill, 1 - Math.pow(1 - pour, 1.25));
      d.temp = Math.max(d.temp, 82);
    }
    const pouring = m.t > B.pourAt && m.t < B.pourEnd + 0.15;
    m.stream.visible = pouring;
    if (pouring && d) {
      const surfaceY = m.cup.y + d.base + levelFor(d, d.fill);
      const len = Math.max(0.01, m.spout.y - surfaceY);
      const thin = m.t > B.pourEnd - 0.4 ? clamp01((B.pourEnd + 0.15 - m.t) / 0.55) : 1;
      m.stream.scale.set(0.6 + 0.4 * thin, len, 0.6 + 0.4 * thin);
      m.stream.position.set(m.spout.x + Math.sin(this.time * 37) * 0.0006, m.spout.y, m.spout.z + Math.cos(this.time * 29) * 0.0006);
    }
    m.light.visible = Math.floor(m.t * 1.6) % 2 === 0 || m.t > B.pourEnd;
    if (m.t >= B.done) {
      m.state = 'ready';
      m.light.visible = false;
      m.stream.visible = false;
      m.sound = null;
      if (d) {
        // (it stays on the tray, the machine's to hand over: [E] on the machine takes it, a lid on first)
        d.fill = 1;
        const near = Math.hypot(this.d.controller.pos.x - m.cup.x, this.d.controller.pos.y - m.cup.z) < 4;
        if (near) this.d.hint(`Your ${m.mug ? 'mug of coffee is' : 'coffee is'} ready · [E] take it`, 3500);
      }
    }
  }

  // ───────────────────────────── sitting ─────────────────────────────

  private sit(c: Chair) {
    if (!c) return;
    if (this.d.occupied(c.x, c.z, 0.38)) {
      this.d.hint('Someone is sitting there', 1500);
      return;
    }
    this.approach = null;
    const items = this.d.items;
    const ctl = this.d.controller;
    // what you hold goes on the table in front of you: right hand on the right, left on the left
    const right = this.v2.set(-Math.cos(c.rot), 0, Math.sin(c.rot));
    const spots: Spot[] = [];
    for (const inst of [...items.heldItems()]) {
      const slot = items.slotOf(inst);
      const side: HandSide = slot === 'L' ? 'L' : 'R';
      const lateral = slot === 'both' ? 0 : side === 'R' ? 0.13 : -0.13;
      const pos = new THREE.Vector3(c.x, c.top, c.z).addScaledVector(c.dir, c.edge + 0.15).addScaledVector(right, lateral);
      const yaw = c.rot + (this.drinks.get(inst)?.vessel === 'mug' ? Math.PI / 2 : 0.4);
      items.placeAt(inst, pos, yaw);
      spots.push({ inst, drink: this.drinks.get(inst) ?? null, pos, yaw, side });
    }
    ctl.path = null;
    ctl.pos.set(c.x, c.z);
    ctl.facing = c.rot;
    ctl.yaw = c.rot - Math.PI;
    ctl.pitch = -0.32;
    const av = this.d.avatar();
    if (av) {
      av.seatKind = 'chair';
      av.setPosture('sit', undefined, SEAT_Y);
    }
    this.d.hands.seated = true;
    const seat: Seat = { kind: 'chair', id: c.id, x: c.x, z: c.z, y: 0, rot: c.rot, seatY: SEAT_Y, chair: c, lx: 0, out: { x: c.x - c.dir.x * 0.12, z: c.z - c.dir.z * 0.12 } };
    this.seated = { seat, spots, nextSip: this.time + 4 + hash01(`${c.id}:${this.seq}`) * 4, mode: this.d.cameraMode(), down: null };
    const drinking = spots.some((s) => s.drink && s.drink.fill > 0.001);
    this.d.hint(drinking ? 'Sitting down with your drink · [E] or WASD to stand up' : 'Sitting down · [E] or WASD to stand up', 4000);
  }

  /** a place on a sofa that nobody sits on or is about to (people sit ~0.45 m apart at the least) */
  private sofaFree(s: Sofa, lx: number): boolean {
    const hip = onProp(s.prop, lx, s.y, SOFA.hipZ, this.v1);
    return !this.d.occupied(hip.x, hip.z, SOFA.taken, s.level);
  }

  /** the free place on a sofa nearest to you, or null (sofaSeats) */
  private sofaSeat(s: Sofa, withOut = false): Seat | null {
    return this.sofaSeats(s, withOut)[0] ?? null;
  }

  /**
   * The free places on a sofa, nearest to you first (a cushion; the middle only while nobody is on
   * either). `out` (where you stand to sit down and to get up) only when asked: it looks for room,
   * and a seat with no room in front of it (a chair pushed up to it) comes only if every seat is so.
   */
  private sofaSeats(s: Sofa, withOut = false): Seat[] {
    const ctl = this.d.controller;
    const all: { seat: Seat; d: number; room: boolean }[] = [];
    for (const lx of SOFA.seats) {
      if (!this.sofaFree(s, lx)) continue;
      const front = onProp(s.prop, lx, s.y, SOFA.front + 0.35, this.v2);
      // (all else equal, a cushion rather than the seam between them)
      const d = Math.hypot(front.x - ctl.pos.x, front.z - ctl.pos.y) + (lx === 0 ? 0.08 : 0);
      // the avatar puts the pelvis 2 cm in front of its root (avatars.ts)
      const root = onProp(s.prop, lx, s.y, SOFA.hipZ - 0.02);
      const spot = withOut ? this.standSpot(s, lx) : null;
      const out = spot ?? (withOut ? onProp(s.prop, lx, s.y, SOFA.front + PLAYER_R + 0.03) : root);
      all.push({ seat: { kind: 'sofa', id: `${s.id}@${lx}`, x: root.x, z: root.z, y: s.y, rot: s.prop.rot ?? 0, seatY: SOFA.top, sofa: s, lx, out: { x: out.x, z: out.z } }, d, room: !withOut || !!spot });
    }
    const roomy = all.filter((x) => x.room);
    return (roomy.length ? roomy : all).sort((p, q) => p.d - q.d).map((x) => x.seat);
  }

  /** in front of a sofa seat with room to stand (clear of the sofa and anything else solid), world; null: none */
  private standSpot(s: Sofa, lx: number): { x: number; z: number } | null {
    const p = this.v1;
    for (const [dx, dz] of [[0, 0], [0, 0.12], [0, 0.26], [0.3, 0.05], [-0.3, 0.05], [0.3, 0.26], [-0.3, 0.26]]) {
      onProp(s.prop, lx + dx, s.y, SOFA.front + PLAYER_R + 0.03 + dz, p);
      if (this.roomAt(p.x, p.z, s.y, s.collider)) return { x: p.x, z: p.z };
    }
    return null;
  }

  /** room for the player to stand at (x, z) on the floor at y: nothing solid within reach (but `skip`) */
  private roomAt(x: number, z: number, y: number, skip: THREE.Box3 | null): boolean {
    for (const b of this.d.colliders ?? []) {
      if (b === skip || b.isEmpty() || b.max.y <= y + 0.05 || b.min.y >= y + 2) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < (PLAYER_R - 0.01) ** 2) return false;
    }
    return true;
  }

  /** E on a sofa: to the nearest free seat you can get to; you walk up to stand in front of it, then turn and sit */
  private sitSofa(s: Sofa) {
    if (!s) return;
    const seats = this.sofaSeats(s, true);
    if (!seats.length) {
      this.d.hint('No room on the sofa', 1600);
      return;
    }
    const ctl = this.d.controller;
    if (Math.hypot(ctl.pos.x - seats[0].out.x, ctl.pos.y - seats[0].out.z) > 0.3) {
      // round whatever is in the way (a straight line ran into a patient room's bed or wall on
      // Floor 2); a seat you can't get to, the next one
      let seat = seats[0];
      let path: THREE.Vector2[] | null = null;
      for (const x of seats) {
        path = this.wayTo(x.out.x, x.out.z, s.y);
        seat = x;
        if (path?.length) break;
      }
      if (!path || !path.length) {
        this.d.hint("Can't get to the sofa from here", 1600);
        return;
      }
      let len = 0;
      let px = ctl.pos.x;
      let pz = ctl.pos.y;
      for (const q of path) {
        len += Math.hypot(q.x - px, q.y - pz);
        px = q.x;
        pz = q.y;
      }
      ctl.path = path;
      ctl.pathRun = false;
      // (time enough to walk it, at 2.1 m/s, and a little more)
      this.approach = { seat, path, t: 0, limit: 3 + len / 1.6 };
      return;
    }
    this.sitDown(seats[0]);
  }

  /**
   * Your walk to (x, z) on the floor at y, or null if there's no way: through furniture as tight as
   * you fit and straight up to the spot (finePath.ts; the storey's nav grid is too coarse for a
   * patient room, and its last cell can lie past the spot: a step back at the end), else on that
   * grid (`gridIfNone`: also when the fine search finds no way, as before it).
   */
  private wayTo(x: number, z: number, y: number, gridIfNone = false): THREE.Vector2[] | null {
    const ctl = this.d.controller;
    const fine = this.d.colliders ? finePath(this.d.colliders, y, { x: ctl.pos.x, z: ctl.pos.y }, { x, z }) : undefined;
    if (fine || (fine === null && !gridIfNone)) return fine;
    return this.d.path ? this.d.path(x, z) : [new THREE.Vector2(x, z)];
  }

  /** walking up to a sofa seat: sit once there; walking off (or another path) calls it off */
  private approachFrame(dt: number) {
    const ap = this.approach!;
    const ctl = this.d.controller;
    ap.t += dt;
    if (ctl.steering || (ctl.path && ctl.path !== ap.path) || ap.t > ap.limit) {
      if (ctl.path === ap.path) ctl.path = null;
      this.approach = null;
      return;
    }
    if (ctl.path) return;
    // there (or stuck on the way: close enough is fine, the turn covers the rest)
    this.approach = null;
    if (Math.hypot(ctl.pos.x - ap.seat.out.x, ctl.pos.y - ap.seat.out.z) < 0.6) this.sitDown(ap.seat);
    else this.d.hint("Can't get to the sofa from here", 1600);
  }

  /** a sofa: turn your back to it and sit back into it (DOWN_T); what you hold stays in your hands */
  private sitDown(seat: Seat) {
    const s = seat.sofa!;
    if (!this.sofaFree(s, seat.lx)) {
      this.d.hint('Someone is sitting there', 1500);
      return;
    }
    const ctl = this.d.controller;
    const from = new THREE.Vector2(ctl.pos.x, ctl.pos.y);
    this.seated = {
      seat,
      spots: [],
      nextSip: this.time + 4 + hash01(`${seat.id}:${this.seq}`) * 4,
      mode: this.d.cameraMode(),
      down: { t: 0, from, facing: ctl.facing, yaw: ctl.yaw, pitch: ctl.pitch, x: from.x, z: from.y, sat: false },
    };
    this.rising = null;
    // you're in it from now on: it stops being solid for you until you stand up clear of it (the
    // controller is at the seat, inside its box, and would push you out through the nearest side)
    this.setSolid(s, false);
    ctl.path = null;
    ctl.pos.set(seat.x, seat.z);
    this.d.hands.seated = true;
    const drinking = this.d.items.heldItems().some((i) => (this.drinks.get(i)?.fill ?? 0) > 0.001);
    this.d.hint(drinking ? 'Sitting down with your drink · [E] or WASD to stand up' : 'Sitting down · [E] or WASD to stand up', 4000);
  }

  private setSolid(s: Sofa, on: boolean) {
    if (!s.collider || !s.solid) return;
    if (on) s.collider.copy(s.solid);
    else s.collider.makeEmpty();
  }

  standUp() {
    const st = this.seated;
    if (!st) return;
    if (this.action?.kind === 'sip') this.finishSip(this.action);
    this.seated = null;
    this.d.hands.seated = false;
    const av = this.d.avatar();
    if (av) av.setPosture('stand');
    const ctl = this.d.controller;
    const seat = st.seat;
    if (seat.sofa) {
      // You rise over your feet and step clear (risingFrame). The controller is there already, so
      // nothing pushes you anywhere and you walk on from there; the sofa is solid again.
      const from = new THREE.Vector2(st.down ? st.down.x : seat.x, st.down ? st.down.z : seat.z);
      const eye = this.seatedEye(seat, from.x, from.y, new THREE.Vector3());
      if (st.down) eye.lerp(new THREE.Vector3(st.down.from.x, seat.y + EYE, st.down.from.y), 1 - smooth((st.down.t - 0.1) / (DOWN_T - 0.15)));
      this.setSolid(seat.sofa, true);
      ctl.pos.set(seat.out.x, seat.out.z);
      if (this.d.cameraMode() !== 'first') ctl.facing = seat.rot;
      this.rising = { seat, t: 0, from, eye };
      this.risingFrame(0);
    } else {
      // a step back from the table, so you don't stand inside it
      ctl.pos.set(seat.out.x, seat.out.z);
      // your drinks come along (whatever still sits where you left it)
      for (const s of st.spots) {
        if (!s.drink) continue;
        if (this.d.items.slotOf(s.inst) || !s.inst.root.parent || s.inst.root.position.distanceTo(s.pos) > 0.05) continue;
        this.d.items.give(s.inst, true);
      }
    }
    const held = this.d.items.held;
    this.d.hint(held ? `Holding the ${held.label} · [F] inspect · [G] put down` : 'Stood up', 2600);
  }

  isSeated(): boolean {
    return !!this.seated;
  }

  /** first person, seated at (x, z) on a seat: where your eyes are */
  private seatedEye(seat: Seat, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x + Math.sin(seat.rot) * SEATED_EYE.fwd, seat.y + seat.seatY + SEATED_EYE.up, z + Math.cos(seat.rot) * SEATED_EYE.fwd);
  }

  /**
   * This frame only: the body (and in first person the eyes) somewhere other than where the
   * controller put them, while you sit down or get up (the controller is at the end point already).
   */
  private placeBody(x: number, z: number, facing: number | null, eye: THREE.Vector3 | null) {
    const av = this.d.avatar();
    if (av) {
      av.root.position.x = x;
      av.root.position.z = z;
      if (facing !== null) av.root.rotation.y = facing;
      av.root.updateMatrixWorld(true);
    }
    if (eye && this.d.cameraMode() === 'first') {
      const cam = this.d.camera;
      const ctl = this.d.controller;
      cam.position.copy(eye);
      cam.rotation.set(ctl.pitch, ctl.yaw, 0, 'YXZ');
      cam.updateMatrixWorld();
    }
  }

  private seatedFrame(dt: number) {
    const st = this.seated!;
    const ctl = this.d.controller;
    const seat = st.seat;
    // walking off (keys, or a click to walk somewhere), or jumping, stands you up
    if (ctl.steering || ctl.path || !ctl.grounded) {
      this.standUp();
      return;
    }
    const fp = this.d.cameraMode() === 'first';
    ctl.pos.set(seat.x, seat.z);
    if (st.down) {
      // sitting down on a sofa: turn your back to it, then sit back into it
      const D = st.down;
      D.t += dt;
      const turn = smooth(D.t / 0.45);
      const back = smooth((D.t - 0.1) / (DOWN_T - 0.15));
      D.x = D.from.x + (seat.x - D.from.x) * back;
      D.z = D.from.y + (seat.z - D.from.y) * back;
      const facing = lerpAngle(D.facing, seat.rot, turn);
      if (fp) {
        ctl.yaw = lerpAngle(D.yaw, seat.rot - Math.PI, turn);
        ctl.pitch = D.pitch + (-0.12 - D.pitch) * turn;
      } else ctl.facing = facing;
      const av = this.d.avatar();
      if (D.t >= 0.12 && !D.sat) {
        D.sat = true;
        if (av) {
          av.seatKind = 'sofa';
          av.setPosture('sit', undefined, seat.seatY);
        }
      }
      const eye = this.seatedEye(seat, D.x, D.z, this.v1).lerp(this.v2.set(D.from.x, seat.y + EYE, D.from.y), 1 - back);
      this.placeBody(D.x, D.z, facing, eye);
      if (D.t >= DOWN_T) st.down = null;
    } else {
      // the camera switched while you sit: first person looks out the way you face; third person
      // on a sofa (its back to a wall, often) looks at you from the front, a little to the side
      const mode = this.d.cameraMode();
      if (mode !== st.mode) {
        st.mode = mode;
        if (fp) {
          ctl.yaw = seat.rot - Math.PI;
          ctl.pitch = -0.12;
        } else if (mode === 'third' && seat.kind === 'sofa') {
          ctl.yaw = seat.rot + 0.45;
          ctl.pitch = -0.2;
        }
      }
      if (!fp) ctl.facing = seat.rot;
      if (fp) {
        // eyes at sitting height (before anything is placed relative to the camera)
        this.placeBody(seat.x, seat.z, null, this.seatedEye(seat, seat.x, seat.z, this.v1));
      }
    }
    // on a sofa, what you hold rests in your lap (third person; a sip takes the hand meanwhile)
    if (seat.kind === 'sofa' && this.thirdPerson()) {
      for (const inst of this.d.items.heldItems()) {
        const slot = this.d.items.slotOf(inst);
        if (slot !== 'R' && slot !== 'L') continue;
        if (this.action?.kind === 'sip' && this.action.inst === inst) continue;
        if (!LAP_STYLES.has(this.d.items.gripOf(inst).style)) continue;
        const lap = this.lapPose(slot, inst, seat);
        if (lap) this.d.hands.reach(slot, { target: lap.wrist, quat: lap.quat, pole: lap.pole });
      }
    }
    // a sip every 10–40 s while there's something to drink: in front of you, or in your hand
    if (!this.action && !st.down && this.time >= st.nextSip) {
      st.nextSip = this.time + 10 + hash01(`${seat.id}:${this.time.toFixed(1)}`) * 30;
      const tp = this.thirdPerson();
      if (seat.kind === 'chair') {
        const spot = st.spots.find((s) => s.drink && s.drink.fill > 0.001 && !this.d.items.slotOf(s.inst) && s.inst.root.parent && s.inst.root.position.distanceTo(s.pos) < 0.05);
        if (spot) this.startSip(spot.drink!, spot.side, spot, tp);
      } else {
        const inst = this.d.items.heldItems().find((i) => (this.drinks.get(i)?.fill ?? 0) > 0.001 && this.d.items.slotOf(i) !== 'both');
        if (inst) this.startSip(this.drinks.get(inst)!, this.d.items.slotOf(inst) === 'L' ? 'L' : 'R', null, tp);
      }
    }
  }

  /** getting up from a sofa: rise over your feet, step clear (the controller is there already) */
  private risingFrame(dt: number) {
    const R = this.rising!;
    R.t += dt;
    const ctl = this.d.controller;
    // the hips go forward over the feet first, then up (the avatar's clip rises over ~0.5 s)
    const k = 1 - (1 - clamp01(R.t / RISE_T)) ** 2;
    const x = R.from.x + (ctl.pos.x - R.from.x) * k;
    const z = R.from.y + (ctl.pos.y - R.from.y) * k;
    const eye = this.v1.copy(R.eye).lerp(this.v2.set(ctl.pos.x, ctl.y + EYE, ctl.pos.y), k);
    this.placeBody(x, z, null, eye);
    if (R.t >= RISE_T) this.rising = null;
  }

  /** third person, on a sofa: a held thing in your lap, a hand's width above the thigh, toward its own side */
  private lapPose(side: HandSide, inst: ItemInstance, seat: Seat): { wrist: THREE.Vector3; quat: THREE.Quaternion; pole: THREE.Vector3 } | null {
    const hands = this.d.hands;
    const S = hands.shoulder(side, new THREE.Vector3());
    if (!S) return null;
    const { o, f, r } = this.body();
    const sg = side === 'R' ? 1 : -1;
    const g = this.d.items.gripOf(inst);
    const quat = handQuat(side, f.clone().multiplyScalar(0.5).addScaledVector(r, -sg * 0.86), UP, new THREE.Quaternion());
    // (the thing's middle: its bottom ~16 cm over the cushion, on the thigh)
    const c = o.clone().addScaledVector(UP, seat.seatY + 0.16 + g.size.y / 2).addScaledVector(f, 0.29).addScaledVector(r, sg * 0.1);
    const wrist = this.wristFor(c, quat, Math.min(g.size.x, g.size.z) / 2);
    const pole = S.addScaledVector(UP, -0.5).addScaledVector(f, -0.1).addScaledVector(r, sg * 0.35);
    return { wrist, quat, pole };
  }

  // ───────────────────────────── per frame ─────────────────────────────

  private thirdPerson(): boolean {
    return this.d.cameraMode() !== 'first' && !!this.d.avatar()?.ready;
  }

  update(dt: number) {
    this.time += dt;
    for (const m of this.machines) {
      this.machineFrame(m, dt);
      // the stacks are topped up (and mugs come back) while nobody's hand is at them
      const here = this.action && (this.action.kind === 'make' || this.action.kind === 'take') && this.action.m === m;
      m.stack?.update(dt, !!here);
      m.lids?.update(dt, !!here);
      m.rack?.update(dt, !!here, Math.hypot(this.d.controller.pos.x - m.stand.x, this.d.controller.pos.y - m.stand.y) < 1.8);
    }
    if (this.approach) this.approachFrame(dt);
    if (this.seated) this.seatedFrame(dt);
    if (this.rising) this.risingFrame(dt);
    if (this.action) this.actionFrame(this.action, dt);
    this.payment.update(dt);
  }

  /** after the arms are posed (hands.ts): levels, cooling and steam where the cups really are now */
  afterPose(dt: number) {
    if (this.shotCam) this.placeShotCam(this.shotCam);
    const a = this.action;
    if (a && (a.kind === 'make' || a.kind === 'take')) this.coffeeAfter(a);
    else this.reachHands.hide();
    this.payment.afterPose(dt);
    for (const dr of this.drinks.values()) this.drinkFrame(dr, dt);
    if (this.markers) this.placeMarkers();
  }

  /**
   * The wrist for a hand turned to `q` holding an upright thing whose middle (its grip anchor) is at
   * `c`: as hands.ts places it, 8 cm along the fingers and its radius + 12 mm out of the palm (grip
   * metres, scaled with the avatar).
   */
  private wristFor(c: THREE.Vector3, q: THREE.Quaternion, radius: number): THREE.Vector3 {
    const ms = this.d.hands.scale;
    return c
      .clone()
      .addScaledVector(this.v1.set(1, 0, 0).applyQuaternion(q), -0.08 * ms)
      .addScaledVector(this.v2.set(0, 1, 0).applyQuaternion(q), -(radius + 0.012 * ms));
  }

  private actionFrame(a: Action, dt: number) {
    // (the coffee's own clock: walking up to the counter first, and tests can hold it still)
    if (a.kind === 'make' || a.kind === 'take') {
      this.coffeeFrame(a, dt);
      if (this.action === a && a.kind === 'make' && a.t >= a.T.press && a.t < a.T.press + 0.6 && this.thirdPerson()) this.d.hint("Brewing… caffeine's half-life is about 5 hours, so the 3 a.m. cup is still with you at 8", 4000);
      return;
    }
    a.t += dt;
    // (tests: a sip held still at a moment, for a screenshot)
    if (a.kind === 'sip' && this.holdT !== null) a.t = Math.min(a.t, this.holdT);
    const tp = this.thirdPerson();
    switch (a.kind) {
      case 'sip':
        this.sipFrame(a, tp);
        return;
      case 'vend':
        this.vendFrame(a, tp, dt);
        return;
      case 'toss': {
        const k = clamp01(a.t / 0.42);
        const p = a.inst.root.position.copy(a.from).lerp(a.to, k);
        p.y += Math.sin(Math.PI * k) * 0.28;
        a.inst.root.rotation.x += dt * 5;
        if (k >= 1) {
          this.sound(a.can ? 'tossCan' : 'toss', a.can ? SND.tossCan : SND.toss, a.to, 0.8, 10);
          a.inst.root.removeFromParent();
          const dr = this.drinks.get(a.inst);
          if (dr) this.disposeDrink(dr);
          this.action = null;
        }
        return;
      }
    }
  }

  // ───────────────────────────── a sip ─────────────────────────────

  private startSip(d: Drink, side: HandSide, spot: Spot | null, tp: boolean) {
    const times = spot ? (tp ? SIP_TABLE : SIP_TABLE_FP) : SIP_HAND;
    this.action = { kind: 'sip', t: 0, d, inst: d.inst, side, spot, tp, times, tilt: sipTilt(d.vessel, d.fill), took: false, drank: false, back: false, rim: new THREE.Vector3() };
  }

  /** the rim point toward `toward` (a unit vector in the cup's frame, horizontal), in the cup's frame */
  private rimPoint(d: Drink, toward: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const rim = d.lid ? RIM_LID : RIM[d.vessel];
    // a lid's drinking slot goes where the lip is
    if (d.lid) d.lid.rotation.y = Math.atan2(toward.x, toward.z);
    return out.set(toward.x * rim.r, rim.h, toward.z * rim.r);
  }

  /**
   * Third person: hold a drink with its rim on the lower lip, tipped by `tilt` toward the face. The
   * cup turns about that rim, not its middle, and the hand turns with it. The cup's frame is the
   * body's yaw plus `cupYaw` (as hands.ts mounts it), tipped about the body's right axis.
   */
  private lipPose(a: SipAction, lip: THREE.Vector3, tilt: number, cupYaw: number, qBase: THREE.Quaternion): { wrist: THREE.Vector3; quat: THREE.Quaternion } {
    const { f, r } = this.body();
    const qt = new THREE.Quaternion().setFromAxisAngle(r, tilt);
    const qCup = new THREE.Quaternion().setFromAxisAngle(UP, cupYaw).premultiply(qt);
    const toward = f.clone().negate().applyAxisAngle(UP, -cupYaw);
    this.rimPoint(a.d, toward, a.rim);
    const g = this.d.items.gripOf(a.inst);
    // its middle (the grip's anchor) from the rim on the lip
    const c = lip.clone().sub(a.rim.clone().sub(g.center).applyQuaternion(qCup));
    // the hand turns with it (fingers closed round it: hands.ts)
    const quat = qBase.clone().premultiply(qt);
    return { wrist: this.wristFor(c, quat, Math.min(g.size.x, g.size.z) / 2), quat };
  }

  private sipFrame(a: SipAction, tp: boolean) {
    const { d, inst, spot } = a;
    const items = this.d.items;
    const hands = this.d.hands;
    const T = a.times;
    // switching the camera mid-sip: it goes back where it was
    if (tp !== a.tp) {
      this.finishSip(a);
      return;
    }
    // someone took it off the table meanwhile, or you put it down (G): nothing to sip
    if ((spot && !a.took && (items.slotOf(inst) || !inst.root.parent)) || (!spot && !items.slotOf(inst))) {
      hands.tilt(inst.root, 0);
      this.action = null;
      return;
    }
    const t = a.t;
    // up to the lip and down again (0..1), and tipped (0..1)
    const up = t < T.take ? 0 : t < T.up ? smooth((t - T.take) / (T.up - T.take)) : t < T.down ? 1 : 1 - smooth((t - T.down) / (T.put - T.down));
    const tip = t < T.up ? 0 : t < T.tip ? smooth((t - T.up) / (T.tip - T.up)) : t < T.untip ? 1 : 1 - smooth((t - T.untip) / (T.down - T.untip));
    if (tp) this.sipThird(a, up, tip);
    else this.sipFirst(a, up, tip);
    if (t >= T.drink && !a.drank) this.drink(d, a);
    if (spot && t >= T.put && !a.back) {
      a.back = true;
      hands.tilt(inst.root, 0);
      hands.unmount(inst.root);
      items.placeAt(inst, spot.pos.clone(), spot.yaw);
      this.sound('cupDown', SND.cupDown, spot.pos, 0.45, 6);
    }
    if (t >= T.end) {
      if (!spot) this.backInHand(a);
      this.action = null;
    }
  }

  /** third person: the hand takes the cup (off the table, or from the lap) up to the lip, tips it, and back */
  private sipThird(a: SipAction, up: number, tip: number) {
    const { inst, spot } = a;
    const items = this.d.items;
    const hands = this.d.hands;
    const { f, r } = this.body();
    const yaw = this.d.avatar()?.root.rotation.y ?? 0;
    const sg = a.side === 'R' ? 1 : -1;
    const g = items.gripOf(inst);
    const radius = Math.min(g.size.x, g.size.z) / 2;
    // fingers forward and round the cup's far side, thumb up
    const qBase = handQuat(a.side, f.clone().multiplyScalar(0.8).addScaledVector(r, -sg * 0.6), UP, new THREE.Quaternion());
    const tilt = a.tilt * tip;
    // you face the cup as it comes up, the head about level, tipped back a little for the last sips
    // (before the lip is found)
    hands.settleHead(up, -0.06 + Math.max(0, a.tilt - 0.8) * 0.5 * tip);
    const lip = hands.lowerLip(new THREE.Vector3());
    const cupYaw = yaw + (spot ? spot.yaw - yaw : hands.mountYaw(inst.root));
    // where it rests: on the table (the hand round it), or in the lap
    let rest: { wrist: THREE.Vector3; quat: THREE.Quaternion };
    if (spot) {
      const c = spot.pos.clone().add(g.center.clone().applyAxisAngle(UP, spot.yaw));
      rest = { wrist: this.wristFor(c, qBase, radius), quat: qBase };
    } else rest = this.lapPose(a.side, inst, this.seated?.seat ?? ({ seatY: SOFA.top } as Seat)) ?? { wrist: hands.palm(a.side, new THREE.Vector3()) ?? new THREE.Vector3(), quat: qBase };
    const at = lip ? this.lipPose(a, lip, tilt, cupYaw, qBase) : rest;
    const S = hands.shoulder(a.side, new THREE.Vector3());
    const pole = S ? S.clone().addScaledVector(UP, -0.4).addScaledVector(r, sg * 0.4) : undefined;
    const target = rest.wrist.clone().lerp(at.wrist, up);
    const quat = rest.quat.clone().slerp(at.quat, up);
    // (off the table: the hand goes out to it first)
    const reachIn = spot ? smooth(a.t / (a.times.take - 0.1)) : 1;
    hands.reach(a.side, { target, quat, pole, weight: reachIn });
    if (spot && a.t >= a.times.take && !a.took) {
      a.took = true;
      items.remove(inst);
      hands.mount(a.side, inst.root, 'upright', g.size, g.center, spot.yaw - yaw);
    }
    if (a.took || !spot) hands.tilt(inst.root, tilt);
  }

  /**
   * First person: the cup comes up into the bottom middle of the view, its rim toward your mouth
   * just under the camera, and tips toward you; your head comes up level for it (and tips back a
   * little for the last sips). Off the table, or from where your hand holds it.
   */
  private sipFirst(a: SipAction, up: number, tip: number) {
    const { inst, spot } = a;
    const items = this.d.items;
    const cam = this.d.camera;
    const ctl = this.d.controller;
    if (spot && !a.took) {
      a.took = true;
      items.remove(inst);
      this.d.scene.add(inst.root);
    }
    // the head: level for a sip, back a little for the last ones (the cup tips no further than FP_MAX_TIP)
    const want = -0.04 + Math.min(FP_HEAD, Math.max(0, a.tilt - FP_MAX_TIP + 0.04) * tip);
    const pitch = ctl.pitch + (want - ctl.pitch) * 0.85 * up;
    cam.rotation.x = pitch;
    cam.updateMatrixWorld();
    // the cup in the camera's frame: level in the world on the way up, then tipped toward you
    const phi = -pitch + (Math.min(FP_MAX_TIP, a.tilt - pitch) + pitch) * tip;
    const handleYaw = a.side === 'R' ? 0 : Math.PI;
    const qc = new THREE.Quaternion().setFromAxisAngle(UP, handleYaw).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), phi));
    this.rimPoint(a.d, new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, -handleYaw), a.rim);
    const local = FP_LIP.clone().sub(a.rim.clone().applyQuaternion(qc));
    const camQ = cam.getWorldQuaternion(new THREE.Quaternion());
    const atPos = cam.localToWorld(local);
    const atQ = camQ.clone().multiply(qc);
    // from where it rests: the table, or your hand at the bottom of the view (held level)
    let fromPos: THREE.Vector3;
    let fromQ: THREE.Quaternion;
    const parent = inst.root.parent;
    if (spot) {
      fromPos = spot.pos.clone();
      fromQ = new THREE.Quaternion().setFromAxisAngle(UP, spot.yaw);
    } else {
      if (!parent) return;
      parent.updateWorldMatrix(true, false);
      fromPos = parent.getWorldPosition(new THREE.Vector3());
      fromQ = new THREE.Quaternion().setFromAxisAngle(UP, ctl.yaw);
    }
    const pos = fromPos.lerp(atPos, up);
    if (spot) pos.y += Math.sin(Math.PI * up) * 0.03;
    const q = fromQ.slerp(atQ, up);
    if (spot) {
      inst.root.position.copy(pos);
      inst.root.quaternion.copy(q);
    } else if (parent) {
      inst.root.position.copy(parent.worldToLocal(pos));
      inst.root.quaternion.copy(parent.getWorldQuaternion(this.q1).invert().multiply(q));
    }
  }

  /** a sip from the hand is over (or cut short): the cup back as the hand holds it */
  private backInHand(a: SipAction) {
    const hands = this.d.hands;
    hands.tilt(a.inst.root, 0);
    // first person: back to where the view shows it (itemSystem levels it again next frame)
    if (!hands.isMounted(a.inst.root) && a.inst.root.parent && a.inst.root.parent !== this.d.scene) a.inst.root.position.set(0, 0, 0);
  }

  private drink(d: Drink, a: { drank: boolean }) {
    a.drank = true;
    if (d.vessel === 'can' && !d.opened) {
      d.opened = true;
      this.sound('canOpen', SND.canOpen, d.inst.root.getWorldPosition(new THREE.Vector3()), 0.5, 6);
    }
    d.sips++;
    d.fill = d.sips >= d.sipsTotal ? 0 : Math.max(0, d.fill - 1 / d.sipsTotal);
    if (d.vessel !== 'can') d.temp -= 0.6;
    this.sound('sip', SND.sip, d.inst.root.getWorldPosition(new THREE.Vector3()), 0.25, 4);
    this.describe(d);
    if (d.fill <= 0.001) this.d.hint(d.vessel === 'can' ? 'Finished the can · [E] at a bin to throw it away' : `Finished the ${d.vessel === 'mug' ? 'mug' : 'coffee'} · take the empty cup to a bin, or put it down`, 4000);
  }

  private finishSip(a: SipAction) {
    if (a.spot) {
      if (a.took && !a.back) {
        this.d.hands.tilt(a.inst.root, 0);
        this.d.hands.unmount(a.inst.root);
        this.d.items.placeAt(a.inst, a.spot.pos.clone(), a.spot.yaw);
      }
    } else this.backInHand(a);
    this.action = null;
  }

  private body() {
    const o = new THREE.Vector3();
    const f = new THREE.Vector3();
    const r = new THREE.Vector3();
    this.d.hands.body(o, f, r);
    return { o, f, r };
  }

  // ───────────────────────────── bins ─────────────────────────────

  private toss(b: Bin) {
    if (!b) return;
    const items = this.d.items;
    const inst = [...items.heldItems()].reverse().find((i) => DISPOSABLE.has(i.kind));
    if (!inst) return;
    if (this.seated) this.standUp();
    const from = inst.root.getWorldPosition(new THREE.Vector3());
    items.remove(inst);
    inst.root.position.copy(from);
    inst.root.rotation.set(0, 0, 0);
    this.d.scene.add(inst.root);
    const can = inst.kind === 'sodaCan';
    this.action = { kind: 'toss', t: 0, inst, from, to: (can && b.recycle ? b.recycle : b.into).clone(), can };
    const d = this.drinks.get(inst);
    this.d.hint(can && b.recycle ? 'Into recycling' : d && d.fill > 0.001 ? 'Threw it away (with coffee still in it)' : 'Threw it away', 1600);
  }

  // ───────────────────────────── vending ─────────────────────────────

  private buy() {
    const v = this.vending;
    if (!v) return;
    if (v.busy) return;
    if (!this.d.items.hasFreeHand()) {
      this.d.hint('Hands full: put something down first (G)', 2800);
      return;
    }
    if (this.seated) this.standUp();
    if (this.action?.kind === 'sip') this.finishSip(this.action);
    v.busy = true;
    const side: HandSide = this.d.items.hands.R ? 'L' : 'R';
    // a product slot behind the glass (rows 0.55 + 0.24 r, columns −0.32 + 0.15 c)
    const n = v.sold + 1;
    const slot = onProp(v.prop, -0.32 + ((n * 3) % 4) * 0.15, 0.62 + (n % 4) * 0.24, 0.3);
    // up to the machine first (where the paying hand reaches its reader), then the keypad
    const ctl = this.d.controller;
    const stand = this.payment.readerStand(side);
    let approach: THREE.Vector2[] | null = null;
    if (stand && Math.hypot(ctl.pos.x - stand.x, ctl.pos.y - stand.y) > 0.3) {
      approach = this.wayTo(stand.x, stand.y, ctl.y, true);
      if (approach?.length) {
        ctl.path = approach;
        ctl.pathRun = false;
      } else approach = null;
    }
    this.action = { kind: 'vend', t: 0, d: null, side, slot, pressed: false, dropped: false, took: false, paying: false, paid: null, approach, approachT: 0 };
  }

  /** paid: the machine vends (its sound, the can behind the glass about to drop) */
  private dispense(a: Extract<Action, { kind: 'vend' }>) {
    const v = this.vending!;
    const d = this.newSoda();
    v.sold++;
    d.inst.root.position.copy(a.slot);
    d.inst.root.rotation.set(0, (v.prop.rot ?? 0) + Math.PI / 2, 0);
    d.inst.root.visible = false;
    this.d.scene.add(d.inst.root);
    this.sound('vend', SND.vend, v.button, 1.2, 14);
    a.d = d;
    a.paid = a.t;
  }

  private vendFrame(a: Extract<Action, { kind: 'vend' }>, tp: boolean, dt: number) {
    const v = this.vending!;
    const hands = this.d.hands;
    const ctl = this.d.controller;
    // walking up to it first (walking off calls it off)
    if (a.approach) {
      a.approachT += dt;
      a.t = 0;
      if (ctl.steering || (ctl.path && ctl.path !== a.approach) || a.approachT > 8) {
        if (ctl.path === a.approach) ctl.path = null;
        v.busy = false;
        this.action = null;
        return;
      }
      if (ctl.path) return;
      a.approach = null;
    }
    const toMachine = new THREE.Vector3(v.button.x - ctl.pos.x, 0, v.button.z - ctl.pos.y).normalize();
    // the drink picked on the keypad, then your phone at the card reader above it (payment.ts)
    if (a.paid === null || !a.d) {
      if (tp && a.t < 0.75) {
        const q = handQuat(a.side, toMachine, UP, new THREE.Quaternion());
        const btn = v.button.clone().addScaledVector(toMachine, -0.17);
        hands.reach(a.side, { target: btn.addScaledVector(toMachine, a.t > 0.3 && a.t < 0.45 ? 0.012 : 0), quat: q, weight: smooth(a.t / 0.3) * (1 - smooth((a.t - 0.5) / 0.2)) });
      }
      if (a.t >= 0.36 && !a.pressed) {
        a.pressed = true;
        this.sound('pick', SND.payBeep, v.button, 0.18, 6);
      }
      if (a.t >= 0.55 && !a.paying) {
        a.paying = true;
        if (!this.payment.payVending(() => this.dispense(a))) {
          v.busy = false;
          this.action = null;
        }
        return;
      }
      // walked off before paying (the reader times out): nothing bought
      if ((a.paying && !this.payment.busy) || (!a.paying && ctl.steering)) {
        v.busy = false;
        this.action = null;
      }
      return;
    }
    const tv = a.t - a.paid;
    const root = a.d.inst.root;
    // the can falls from its slot into the flap
    const fall = SND.VEND.drop - 0.42;
    if (tv >= fall && !a.dropped) {
      root.visible = true;
      const k = clamp01((tv - fall) / 0.42);
      root.position.copy(a.slot).lerp(v.flap, k * k);
      if (k >= 1) {
        a.dropped = true;
        root.position.copy(v.flap);
        root.rotation.set(0, (v.prop.rot ?? 0) + Math.PI / 2, Math.PI / 2);
      }
    }
    // (the phone goes back in the pocket meanwhile; the hand goes in as soon as the can has landed)
    const takeAt = SND.VEND.drop + 0.2;
    if (tv < takeAt || this.payment.busy) return;
    const av = this.d.avatar();
    if (tp && av) {
      const t2 = tv - takeAt;
      // crouch, reach into the flap, stand up with it
      av.act = t2 < 1.2 ? 'crouch' : undefined;
      if (t2 > 0.35 && t2 < 0.95) {
        const q = handQuat(a.side, toMachine.clone().addScaledVector(UP, -0.6), UP, new THREE.Quaternion());
        hands.reach(a.side, { target: v.flap.clone().addScaledVector(toMachine, -0.12).addScaledVector(UP, 0.05), quat: q, weight: 1 });
      }
      if (t2 > 0.7 && !a.took) {
        a.took = true;
        root.rotation.set(0, 0, 0);
        this.d.items.give(a.d.inst, true);
      }
      if (t2 > 1.25) this.endVend(a);
      return;
    }
    // first person: the can comes up from the flap into your hand
    const k = clamp01((tv - takeAt) / 0.5);
    if (!a.took) {
      const hand = this.d.camera.localToWorld(new THREE.Vector3(a.side === 'R' ? 0.21 : -0.21, -0.23, -0.45));
      root.position.copy(v.flap).lerp(hand, smooth(k));
      root.rotation.z = (Math.PI / 2) * (1 - smooth(k));
      if (k >= 1) {
        a.took = true;
        root.rotation.set(0, 0, 0);
        this.d.items.give(a.d.inst, true);
        this.endVend(a);
      }
    }
  }

  private endVend(a: Extract<Action, { kind: 'vend' }>) {
    const av = this.d.avatar();
    if (av) av.act = undefined;
    if (a.d && !a.took) this.d.items.give(a.d.inst, true);
    this.vending!.busy = false;
    this.action = null;
    if (a.d) this.d.hint(`Holding the ${a.d.inst.label} · [F] inspect · [G] put down`, 3500);
  }

  // ───────────────────────────── sound ─────────────────────────────

  private sound(name: string, render: (sr: number) => Float32Array, at: THREE.Vector3, gain: number, range: number) {
    const a = sharedAudio(false);
    if (!a) return null;
    let b = this.buffers.get(name);
    if (!b) {
      const pcm = render(a.ctx.sampleRate);
      b = a.ctx.createBuffer(1, pcm.length, a.ctx.sampleRate);
      b.getChannelData(0).set(pcm);
      this.buffers.set(name, b);
    }
    return playSound(b, { at: { x: at.x, y: at.y, z: at.z }, gain, range });
  }

  // ───────────────────────────── tests and debugging ─────────────────────────────

  /** tests and debugging (?debug=1) */
  debugState() {
    const st = this.seated;
    const a = this.action;
    return {
      seated: st ? (st.seat.chair?.id ?? st.seat.sofa?.id ?? null) : null,
      seat: st ? { kind: st.seat.kind, id: st.seat.id, x: +st.seat.x.toFixed(3), z: +st.seat.z.toFixed(3), y: st.seat.y, seatY: st.seat.seatY, down: !!st.down, out: [+st.seat.out.x.toFixed(3), +st.seat.out.z.toFixed(3)] } : null,
      rising: !!this.rising,
      riseT: this.rising ? +this.rising.t.toFixed(2) : null,
      downT: st?.down ? +st.down.t.toFixed(2) : null,
      approach: !!this.approach,
      action: a?.kind ?? null,
      machines: this.machines.map((m) => ({ id: m.id, state: m.state, t: +m.t.toFixed(2), fill: m.drink ? +m.drink.fill.toFixed(3) : null, onTray: !!m.drink, cups: m.stack?.count ?? null, lids: m.lids?.count ?? null, mugs: m.rack?.count ?? null, stand: [+m.stand.x.toFixed(2), +m.stand.y.toFixed(2)] })),
      drinks: [...this.drinks.values()].map((d) => ({ id: d.inst.id, label: d.inst.label, fill: +d.fill.toFixed(3), sips: d.sips, of: d.sipsTotal, temp: +d.temp.toFixed(1), steam: !!d.steam?.group.visible, held: this.d.items.slotOf(d.inst), lid: !!d.lid, unpaid: this.payment.owes(d.inst.id), at: d.inst.root.parent ? d.inst.root.getWorldPosition(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)) : null })),
      coffee: a && (a.kind === 'make' || a.kind === 'take') ? { kind: a.kind, from: a.kind === 'make' ? a.from : null, t: +a.t.toFixed(2), approach: !!a.approach, side: a.side, reach: this.lastReach } : null,
      events: this.events.slice(-30),
      pay: this.payment.debugState(),
      camera: this.d.camera.position.toArray().map((x) => +x.toFixed(2)),
      t: a ? +a.t.toFixed(2) : null,
      held: this.d.items.heldItems().map((i) => ({ id: i.id, label: i.label, slot: this.d.items.slotOf(i) })),
      sofas: this.sofas.map((s) => ({ id: s.id, level: s.level, solid: !!s.collider && !s.collider.isEmpty(), collider: !!s.collider })),
    };
  }

  /**
   * Tests and debugging: 'fill' sets every drink's fill (0..1); 'pose' reports where the lip, the
   * cup's rim on it, the hips, the head and the feet are (world, m) and how far the cup is tipped;
   * 'markers' shows the lip (red) and the rim point (green) as dots; 'hold' stops a sip's clock at
   * that many seconds (null: runs on); 'targets' lists what is on offer now; 'cam' frames the avatar
   * for a screenshot (null gives the camera back); 'sofaWay' (a sofa's id): the seat E would walk you
   * to from here, the spot in front of it, the walk, and what is solid round that spot; 'way' ([x, z],
   * or nothing for the vending machine's reader): your walk there, and the nav grid's.
   */
  debugOp(op: string, arg?: unknown): unknown {
    if (op === 'hold') {
      // (a sip, a coffee being made or taken, or a tap to pay, held still t s in)
      this.holdT = typeof arg === 'number' ? arg : null;
      this.payment.hold(this.holdT);
      return this.holdT;
    }
    // where the card terminals' tap points and the phone's antenna are now (world, m)
    if (op === 'payWhere') return this.payment.where();
    // a brew's wait skipped: done in a moment (the cup full)
    if (op === 'brewNow') {
      for (const m of this.machines) if (m.state === 'brewing') m.t = Math.max(m.t, SND.BREW.done - 0.05);
      return true;
    }
    // the stacks and the rack, full again
    if (op === 'restock') {
      for (const m of this.machines) {
        m.stack?.refill();
        m.lids?.refill();
      }
      return true;
    }
    // where the top cup's rim and the top lid are (world, m)
    if (op === 'stacks') {
      const r3 = (v: THREE.Vector3 | null | undefined) => (v ? v.toArray().map((x) => +x.toFixed(3)) : null);
      return this.machines.map((m) => ({ id: m.id, rim: r3(m.stack?.rim()), lid: r3(m.lids?.lidTop()), cup: r3(m.cup), spout: r3(m.spout), button: r3(m.button), next: r3(m.rack?.next()?.at) }));
    }
    if (op === 'targets') return this.targets().map((t) => t.key);
    // a sofa (by id): the seat you'd get from where you stand, the spot in front of it, the walk there
    // your walk to [x, z] (wayTo), and the nav grid's; [x, z] omitted: to where you'd pay at the vending machine
    if (op === 'way') {
      const ctl = this.d.controller;
      const to = Array.isArray(arg) ? new THREE.Vector2(arg[0], arg[1]) : this.payment.readerStand(this.d.items.hands.R ? 'L' : 'R');
      if (!to) return null;
      const r2 = (p: THREE.Vector2[] | null) => (p ? p.map((q) => [+q.x.toFixed(3), +q.y.toFixed(3)]) : null);
      return { from: [+ctl.pos.x.toFixed(3), +ctl.pos.y.toFixed(3)], to: [+to.x.toFixed(3), +to.y.toFixed(3)], fine: r2(this.wayTo(to.x, to.y, ctl.y)), grid: r2(this.d.path ? this.d.path(to.x, to.y) : null) };
    }
    if (op === 'sofaWay') {
      const s = this.sofas.find((x) => x.id === arg);
      const seats = s ? this.sofaSeats(s, true) : [];
      const seat = (s && seats.find((x) => this.wayTo(x.out.x, x.out.z, s.y)?.length)) || seats[0];
      if (!s || !seat) return null;
      const path = this.wayTo(seat.out.x, seat.out.z, s.y);
      // (what solid is within a metre of the spot, at that storey: [min x, min z, max x, max z, min y, max y])
      const near = (this.d.colliders ?? []).filter((b) => !b.isEmpty() && b.max.y > s.y + 0.05 && b.min.y < s.y + 2 && Math.hypot(Math.max(b.min.x, Math.min(seat.out.x, b.max.x)) - seat.out.x, Math.max(b.min.z, Math.min(seat.out.z, b.max.z)) - seat.out.z) < 1);
      return { lx: seat.lx, seat: [+seat.x.toFixed(3), +seat.z.toFixed(3)], out: [+seat.out.x.toFixed(3), +seat.out.z.toFixed(3)], from: [+this.d.controller.pos.x.toFixed(3), +this.d.controller.pos.y.toFixed(3)], path: path ? path.map((q) => [+q.x.toFixed(2), +q.y.toFixed(2)]) : null, solid: near.map((b) => [b.min.x, b.min.z, b.max.x, b.max.z, b.min.y, b.max.y].map((v) => +v.toFixed(2))) };
    }
    if (op === 'cam') {
      // a camera framed on the avatar for screenshots: { around, yaw (deg from its front, + = its
      // right), pitch (deg, + = from above), dist (m), fov (deg), up (m) }; null gives it back
      const cam = this.d.camera;
      if (arg && typeof arg === 'object') {
        if (!this.shotCam) this.fovBefore = cam.fov;
        const o = arg as Partial<NonNullable<Amenities['shotCam']>>;
        this.shotCam = { around: o.around ?? 'head', yaw: o.yaw ?? 0, pitch: o.pitch ?? 0, dist: o.dist ?? 1, fov: o.fov ?? 35, up: o.up ?? 0 };
      } else if (this.shotCam) {
        this.shotCam = null;
        cam.fov = this.fovBefore;
        cam.updateProjectionMatrix();
      }
      return !!this.shotCam;
    }
    if (op === 'fill') {
      const f = clamp01(Number(arg));
      for (const d of this.drinks.values()) {
        d.fill = f;
        d.sips = Math.round((1 - f) * d.sipsTotal);
        d.lastFill = -1;
        this.describe(d);
      }
      return f;
    }
    if (op === 'markers') {
      const on = arg !== false;
      if (on && !this.markers) {
        this.markers = ['#ff2a2a', '#22dd44'].map((c) => {
          const m = new THREE.Mesh(G.sphere(0.0045, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
          m.renderOrder = 10;
          this.d.scene.add(m);
          return m;
        });
      } else if (!on && this.markers) {
        for (const m of this.markers) m.removeFromParent();
        this.markers = null;
      }
      return on;
    }
    if (op === 'pose') {
      const av = this.d.avatar();
      const r3 = (v: THREE.Vector3 | null | undefined) => (v ? v.toArray().map((x) => +x.toFixed(3)) : null);
      const lip = this.d.hands.lowerLip(new THREE.Vector3());
      const a = this.action?.kind === 'sip' ? this.action : null;
      let rim: THREE.Vector3 | null = null;
      let tilt: number | null = null;
      if (a) {
        a.inst.root.updateWorldMatrix(true, false);
        rim = a.inst.root.localToWorld(a.rim.clone());
        tilt = (UP.clone().applyQuaternion(a.inst.root.getWorldQuaternion(new THREE.Quaternion())).angleTo(UP) * 180) / Math.PI;
      }
      const bone = (re: RegExp) => {
        let hit: THREE.Object3D | undefined;
        av?.root.traverse((o) => {
          if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
        });
        return hit?.getWorldPosition(new THREE.Vector3()) ?? null;
      };
      const cam = this.d.camera;
      cam.updateMatrixWorld();
      const rimCam = rim ? cam.worldToLocal(rim.clone()) : null;
      // where the face is on screen (0..1 from the top left), for close-ups
      const headAt = av?.head.getWorldPosition(new THREE.Vector3()).project(cam);
      return {
        screen: headAt ? [+((headAt.x + 1) / 2).toFixed(3), +((1 - headAt.y) / 2).toFixed(3)] : null,
        lip: r3(lip),
        rim: r3(rim),
        gap: lip && rim && this.thirdPerson() ? +lip.distanceTo(rim).toFixed(4) : null,
        rimCam: r3(rimCam),
        tilt: tilt === null ? null : +tilt.toFixed(1),
        head: r3(av?.head.getWorldPosition(new THREE.Vector3())),
        eyes: r3(this.d.hands.eyes(new THREE.Vector3())),
        pelvis: r3(bone(/_Pelvis$/)),
        toes: [r3(bone(/_L_Toe0$/)), r3(bone(/_R_Toe0$/))],
        // the legs, in the body's frame (m: right, up, forward from the root)
        legs: av
          ? ['L_Thigh', 'L_Calf', 'L_Foot', 'L_Toe0', 'Spine2', 'Neck'].map((n) => {
              const p = bone(new RegExp(`_${n}$`));
              if (!p) return null;
              const d = p.sub(av.root.position);
              const ry = av.root.rotation.y;
              return [n, +(-d.x * Math.cos(ry) + d.z * Math.sin(ry)).toFixed(3), +d.y.toFixed(3), +(d.x * Math.sin(ry) + d.z * Math.cos(ry)).toFixed(3)];
            })
          : null,
        root: r3(av?.root.position),
        posture: av?.posture ?? null,
        camera: r3(cam.position),
      };
    }
    return null;
  }

  private placeShotCam(s: NonNullable<Amenities['shotCam']>) {
    const av = this.d.avatar();
    if (!av?.ready) return;
    const cam = this.d.camera;
    const target = new THREE.Vector3();
    if (s.around === 'head') av.head.getWorldPosition(target);
    else if (s.around === 'feet') target.copy(av.root.position).setY(av.root.position.y + 0.3);
    else {
      let hit: THREE.Object3D | undefined;
      av.root.traverse((o) => {
        if (!hit && (o as THREE.Bone).isBone && /_Pelvis$/.test(o.name)) hit = o;
      });
      if (hit) hit.getWorldPosition(target);
      else target.copy(av.root.position).setY(av.root.position.y + 0.6);
    }
    target.y += s.up;
    const yaw = av.root.rotation.y - (s.yaw * Math.PI) / 180;
    const p = (s.pitch * Math.PI) / 180;
    cam.position.set(target.x + Math.sin(yaw) * Math.cos(p) * s.dist, target.y + Math.sin(p) * s.dist, target.z + Math.cos(yaw) * Math.cos(p) * s.dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    if (cam.fov !== s.fov) {
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  private placeMarkers() {
    const [lipM, rimM] = this.markers!;
    const lip = this.d.hands.lowerLip(lipM.position);
    lipM.visible = !!lip && this.thirdPerson();
    const a = this.action?.kind === 'sip' ? this.action : null;
    rimM.visible = !!a;
    if (a) {
      a.inst.root.updateWorldMatrix(true, false);
      rimM.position.copy(a.inst.root.localToWorld(a.rim.clone()));
    }
  }

  /** for tests: sip now (while seated) */
  sipNow() {
    if (this.seated) this.seated.nextSip = this.time;
  }

  dispose() {
    for (const o of this.extras) o.removeFromParent();
    for (const d of this.drinks.values()) d.steam?.dispose();
    for (const m of this.machines) {
      m.sound?.stop(0.1);
      m.stack?.dispose();
      m.lids?.dispose();
      m.rack?.dispose();
    }
    this.payment.dispose();
    this.reachHands.dispose();
    for (const m of this.markers ?? []) m.removeFromParent();
    for (const s of this.sofas) this.setSolid(s, true);
    this.drinks.clear();
  }
}

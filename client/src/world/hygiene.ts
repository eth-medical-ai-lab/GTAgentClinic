/**
 * Hand hygiene and masks, for the player in first and third person (shared/hygiene.ts puts the
 * dispensers, sinks' stations and mask boxes in the layout).
 *
 *   rub      [E] on an alcohol hand-rub dispenser: you step up to it, cup one hand under the nozzle
 *            and press the plate with the heel of the other (the pump), then rub as WHO teaches it,
 *            compressed to ~6 s: palm to palm, each palm over the other hand's back with the fingers
 *            interlaced, palm to palm interlaced, the backs of the fingers in the other palm, each
 *            thumb rotated in the other fist, the fingertips circled in the other palm; until dry
 *   wash     [E] on a sink's soap dispenser (or the sink): ~15 s at the real fixture (handwash.ts):
 *            the wrist lifts the tap's lever, both hands into the stream fingertips first, soap from
 *            the nozzle into the cupped palm while the other hand presses the plate, the six steps with
 *            the foam spreading over the skin, rinsed off under the water, the lever down with the
 *            wrist, a step over to the towels and the hanging tail pulled out, patted dry, into the
 *            pedal bin. You stand close and lean over the sink. Restroom basins: a sensor tap and the
 *            counter's pump
 *   masks    [E] on a mask box: one surgical mask out of the slot, up to the face in both hands, the
 *            loops behind the ears, the nose wire pinched. On the avatar's face (fitted to the face:
 *            accessories.ts), not drawn in first person (it sits ~50° below the line of sight, outside
 *            the 72° view; the HUD says you wear one). Off: [M] anywhere, [E] on the box again or on a
 *            bin: by the loops, into the nearest bin. A fresh one each time
 *
 * First person: a pair of hands (fpHands.ts) comes into view; third person: the avatar's arms reach
 * by IK (hands.ts) and its fingers flex. The same choreography drives both: one world pose per hand
 * and moment. Holding something: "Put down what you're holding first (G)". Walking off cancels it
 * (nothing recorded). Each finished rub, wash, mask on or off goes to the server ('hygiene' action,
 * 0 min): the debrief's infection-control section (unscored).
 *
 * Rooms on precautions (the board's `precautions`, CaseDef.precautions): an isolation stand beside the
 * corridor dispenser with the sign (and masks for droplet/airborne). Going into one on droplet or
 * airborne precautions without a mask, the nearest nurse reminds you.
 */
import * as THREE from 'three';
import { upperLevels } from '../../../shared/floors';
import { hygienePlan, type HygieneEntrance } from '../../../shared/hygiene';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import type { CameraMode, HygieneKind, PlayerView, PrecautionKind } from '../../../shared/types';
import { playSound } from '../audio/soundscape';
import * as SND from '../audio/amenities';
import { sharedAudio } from '../ui/speech';
import { buildProp, maskFitFor } from './accessories';
import type { AvatarCharacter } from './avatars';
import type { PlayerController } from './controls';
import { FpHands, OPEN } from './fpHands';
import { FpArms, fpShoulders } from './fpArms';
import type { HandSide, PlayerHands } from './hands';
import type { AmenityTarget } from './amenities';
import type { ItemSystem } from './itemSystem';
import { G, add, canvasTexture, lambert, makeCanvas, own, rboxB } from './materials';
import { CUP, FP_REACH, PINCH, STEPS, UP, blend, clamp01, lerpV, levelled, palmQuat, pose, ramp, restPose, rubPoses, smooth, type Frame, type HandPose } from './handPose';
import { TpHandLayers, gloveMaterial, type HandPoint, type HandRig } from './handLayers';
import { G_OFF, G_ON, GloveEffects, gloveLean, gloveOffK, gloveOnK, glovesOffPoses, glovesOnPoses, type GloveSource } from './gloves';
import { WASH, WashEffects, soapShift, towelHand, washFocus, washLean, washPoses, waterOn, wetness, type WashFixture, type WashWalk } from './handwash';
import { SleeveRoll } from './sleeves';

export interface HygieneDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: PlayerController;
  layout: LayoutDef;
  items: ItemSystem;
  hands: PlayerHands;
  avatar(): AvatarCharacter | null;
  cameraMode(): CameraMode;
  hint(text: string, ms?: number): void;
  /** the room you're in (the world's location report) */
  room(): string;
  /** to the server: a rub, a wash, a mask on or off (the 'hygiene' action) */
  record(kind: HygieneKind, at: string): void;
  /** nurses on the ground floor now (a reminder at a room on precautions) */
  nurses(): { id: string; name: string; x: number; z: number }[];
  say(npcId: string, text: string): void;
  /** sitting somewhere (amenities.ts): stand up first; or busy there (a coffee on its way): later */
  seated(): boolean;
  standUp(): void;
  busy(): boolean;
  /** the player's colliders (the world's array): the isolation stands go in */
  colliders: THREE.Box3[];
  /** the built world (the pedal bins' lids, props.ts pedalBin) */
  root: THREE.Object3D;
  /** the player's face (avatar id): which mask drape fits (accessories.ts) */
  face(): string;
}

// ───────────────────────────── fixtures ─────────────────────────────

interface Dispenser {
  id: string;
  level: number;
  /** under the nozzle, the push plate (world), the wall's normal (out of it, horizontal) */
  nozzle: THREE.Vector3;
  plate: THREE.Vector3;
  n: THREE.Vector3;
  box: THREE.Box3;
  center: THREE.Vector3;
  /** where to stand (a sink's: in front of the sink) */
  stand: { x: number; z: number } | null;
}

interface Bin {
  id: string;
  level: number;
  room: string;
  /** where things go in (the opening), the lid's hinge (pedal bins) */
  into: THREE.Vector3;
  lid: THREE.Object3D | null;
  box: THREE.Box3;
  center: THREE.Vector3;
}

interface Wash {
  id: string;
  level: number;
  /** the basin's middle (its floor), the spout's tip, the tap lever (null: a sensor tap) */
  basin: THREE.Vector3;
  spout: THREE.Vector3;
  lever: THREE.Vector3 | null;
  soap: Dispenser;
  towel: { slot: THREE.Vector3; n: THREE.Vector3 } | null;
  bin: Bin | null;
  /** the sink as built: every contact of a wash (handwash.ts), read off the meshes */
  fx: WashFixture;
  /** all its marks found (a storey built later: looked for again when a wash starts) */
  complete: boolean;
  rebuild: () => { fx: WashFixture; complete: boolean };
  /** facing the sink: where you stand, which way */
  stand: { x: number; z: number };
  /** the sink's front (horizontal, out of the wall) and its across (+x of the sink) */
  f: THREE.Vector3;
  r: THREE.Vector3;
  box: THREE.Box3;
  center: THREE.Vector3;
  sinkBox: THREE.Box3 | null;
}

interface MaskSource {
  id: string;
  level: number;
  /** the slot, and the way the box faces (horizontal: where you stand to take one) */
  slot: THREE.Vector3;
  n: THREE.Vector3;
  /** a box lying on a counter: the slot faces up */
  top?: boolean;
  box: THREE.Box3;
  center: THREE.Vector3;
}

/** a prop's local point (x along its width, y up, z toward its front) in world space (amenities.ts onProp) */
function onProp(p: PropDef, lx: number, y: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = p.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return out.set(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c);
}
const frontOf = (p: PropDef) => new THREE.Vector3(Math.sin(p.rot ?? 0), 0, Math.cos(p.rot ?? 0));
/** world AABB of a box in a prop's frame (quarter turns) */
function propBox(p: PropDef, cx: number, cz: number, w: number, d: number, y0: number, y1: number): THREE.Box3 {
  const c = onProp(p, cx, 0, cz);
  const quarter = Math.abs(Math.sin(p.rot ?? 0)) > 0.5;
  const hx = (quarter ? d : w) / 2;
  const hz = (quarter ? w : d) / 2;
  return new THREE.Box3(new THREE.Vector3(c.x - hx, y0, c.z - hz), new THREE.Vector3(c.x + hx, y1, c.z + hz));
}

/** a point on a hand in its own frame (m), as the first-person hand has it (fpHands.ts), relaxed */
function nominal(side: HandSide, p: HandPoint): THREE.Vector3 {
  const z = side === 'R' ? 1 : -1;
  const at: Record<HandPoint, [number, number, number]> = {
    wrist: [0, 0, 0],
    palm: [0.055, 0.016, 0],
    heel: [0.022, 0.016, 0],
    back: [0.05, -0.019, 0],
    wristBack: [-0.014, -0.023, 0],
    wristVolar: [-0.016, 0.02, 0],
    tipIndex: [0.18, 0.004, 0.027],
    tipMiddle: [0.19, 0.004, 0.009],
    tipRing: [0.183, 0.004, -0.009],
    tipLittle: [0.16, 0.004, -0.026],
    tipThumb: [0.1, 0.02, 0.07],
    pinch: [0.14, 0.012, 0.048],
  };
  const [x, y, zz] = at[p];
  return new THREE.Vector3(x, y, zz * z);
}

// ───────────────────────────── timelines (s) ─────────────────────────────

/** stepping up to it: how long the body takes to get there and turn */
const STEP_IN = 0.35;
/** first person at the towels: how much of the wash's lean the eyes keep (the dispenser's on the wall right there) */
const TOWEL_LEAN_FP = 0.7;
const RUB = {
  reach: STEP_IN,
  press: 0.78,
  pump: 0.92,
  release: 1.08,
  gather: 1.42,
  step: 0.72,
  end: 0,
};
RUB.end = RUB.gather + STEPS * RUB.step + 0.4;
const MASK_ON = {
  reach: STEP_IN,
  take: 0.85,
  lift: 1.2,
  don: 1.8,
  on: 2.3,
  pinch: 2.4,
  down: 2.9,
  end: 3.25,
};
const MASK_OFF = { ears: 0.45, lift: 0.9, toss: 1.05, land: 1.45, end: 1.6 };
/**
 * Sleeves up before a rub or a wash (third person, a long-sleeved coat; sleeves.ts): the left forearm
 * held out, the right hand from its cuff up to mid-forearm, then the other way round; each sleeve goes
 * up as the hand pushing it gets halfway (`up`). The act waits for it.
 */
const PUSH = { held: 0.3, left: [0.3, 0.62], swap: 0.8, right: [0.8, 1.12], up: [0.46, 0.96], end: 1.34 };
/**
 * And down again after it: the left forearm held out, the right hand from its rolled sleeve down to the
 * wrist, then the other way round; each sleeve comes down as the hand pulling it gets halfway (`down`)
 */
const PULL = { held: 0.25, left: [0.25, 0.55], swap: 0.73, right: [0.73, 1.03], down: [0.4, 0.88], end: 1.25 };
type SleeveTiming = { held: number; left: number[]; swap: number; right: number[]; end: number };

/** a spot to stand and the way you face there */
type Spot = { x: number; z: number; facing: number };

/**
 * A walk inserted into a wash (handwash.ts WashWalk): over to the towels when they're out of reach
 * of the basin, then to the bin when it's out of reach of where you dried your hands. The wash's
 * clock waits at `at` while you walk a smoothed path at a walking pace, turning to it as you set off
 * and to the towels or the bin as you arrive.
 */
interface Leg {
  kind: 'towel' | 'bin';
  at: number;
  /** the path (x, z) and the distance along it at each point */
  pts: { x: number; z: number }[];
  cum: number[];
  len: number;
  /** facing as you set off and as you arrive */
  f0: number;
  f1: number;
  dur: number;
  /** how far into it (s), and walked */
  u: number;
  done: boolean;
}
/** a step to the towels shorter than this is a side step at the basin (no walk) */
const SIDE_STEP = 0.45;
/** walking pace (m/s), and the time setting off and stopping take */
const PACE = 1.2;
const SET_OFF = 0.4;

type Act =
  | { kind: 'rub'; t: number; d: Dispenser; pumped: boolean; sound: boolean }
  | {
      kind: 'wash';
      t: number;
      w: Wash;
      /** the sink as used this time (its bin left out when there's no way to it) */
      fx: WashFixture;
      flags: Set<string>;
      ts: HandSide;
      base: Spot;
      step: Spot | null;
      water: boolean;
      /** walks over to the towels and to the bin, and the one under way */
      legs: Leg[];
      leg: Leg | null;
    }
  | { kind: 'maskOn'; t: number; src: MaskSource; flags: Set<string> }
  | { kind: 'maskOff'; t: number; bin: Bin | null; flags: Set<string> }
  | { kind: 'glovesOn'; t: number; src: GloveSource; flags: Set<string> }
  | { kind: 'glovesOff'; t: number; bin: Bin | null; flags: Set<string> }
  | { kind: 'gloveToss'; t: number; bin: Bin; from: THREE.Vector3; flags: Set<string> }
  /** third person, after a rub or a wash: the sleeves pulled back down (sleeves.ts) */
  | { kind: 'sleevesDown'; t: number };

export class HandHygiene {
  private rubs: Dispenser[] = [];
  private washes: Wash[] = [];
  private maskSources: MaskSource[] = [];
  private bins: Bin[] = [];
  private entrances: HygieneEntrance[] = [];
  private act: Act | null = null;
  private approach: {
    from: { x: number; z: number; facing: number; yaw: number; pitch: number };
    to: { x: number; z: number; facing: number; yaw: number; pitch: number };
    t: number;
  } | null = null;
  private fp: FpHands;
  private masked = false;
  /** the mask on your face (a child of the head bone) or in your hands */
  private maskObj: THREE.Object3D | null = null;
  private flatMask: THREE.Group;
  /** the rub's gel in the palm */
  private gel: THREE.Mesh;
  /** a wash's water, soap, towel and the fixture's moving parts (handwash.ts) */
  private washFx: WashEffects;
  /** the avatar's hands for a wash in third person (handLayers.ts), built for the avatar in use */
  private tpRig: TpHandLayers | null = null;
  private tpRigFor: THREE.Object3D | null = null;
  /** its coat's sleeves, pushed up for hand hygiene and left up (sleeves.ts) */
  private sleeves: SleeveRoll | null = null;
  /** pushing the sleeves up before a rub or a wash (third person): how far into it (s) */
  private prep: { t: number } | null = null;
  /** first person: where the view looks during a wash (eased) */
  private look: { yaw: number; pitch: number } | null = null;
  /** a scripted step (the towel): the body walks (World plays the walk while true) */
  stepping = false;
  /** the skin's wet sheen after a wash, drying off (third person) */
  private wetAfter = 0;
  private water: { stop(f?: number): void } | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private holdT: number | null = null;
  /** the isolation stands up now: room → its stand */
  private stands = new Map<
    string,
    {
      kind: PrecautionKind;
      group: THREE.Group;
      collider: THREE.Box3;
      mask: MaskSource | null;
    }
  >();
  private precautions = new Map<string, PrecautionKind>();
  private nurseOf = new Map<string, string>();
  private lastRoom = '';
  private reminded = new Map<string, number>();
  private time = 0;
  private viewMasked: boolean | undefined;
  /** boxes of examination gloves (props.ts gloveHolder, resusGear.ts gloveStation) */
  private gloveSources: GloveSource[] = [];
  /** non-sterile gloves on; a used pair held (taken off with no bin in reach) */
  private gloved = false;
  private bundle = false;
  private viewGloved: boolean | undefined;
  private gloveFx: GloveEffects;
  /** third person: the used pair in the left hand */
  private bundleObj: THREE.Mesh | null = null;
  /** every fixture's named points and moving parts (props.ts hygMark), by prop id */
  private parts = new Map<string, Map<string, THREE.Object3D>>();
  /** third person: where each wrist was asked to go this frame (tests: how far the arm fell short) */
  private ikWant: Partial<Record<HandSide, THREE.Vector3>> = {};
  /** every prop's kind by id (the info card F shows: items.ts FIXTURE_INFO) */
  private kindOf = new Map<string, string>();
  /** the fixtures' marks found (tests: none missing on a fresh build) */
  private markers: { found: number; missing: string[] } = {
    found: 0,
    missing: [],
  };
  private readonly v1 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();

  constructor(private d: HygieneDeps) {
    this.fp = new FpHands(d.scene);
    this.collect();
    // the rub's gel in the palm; a wash's water, soap and towel
    this.gel = new THREE.Mesh(
      G.sphere(0.011, 12, 9),
      new THREE.MeshStandardMaterial({
        color: '#d9f2ee',
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.75,
      }),
    );
    this.gel.visible = false;
    this.gel.castShadow = false;
    d.scene.add(this.gel);
    this.washFx = new WashEffects(d.scene);
    this.gloveFx = new GloveEffects(d.scene, gloveMaterial());
    this.flatMask = new THREE.Group();
    const blue = lambert('#8cc0e3', { roughness: 0.92 });
    add(this.flatMask, G.rbox(0.175, 0.095, 0.006, 0.003), blue);
    for (const y of [-0.02, 0.0, 0.02]) add(this.flatMask, G.box(0.17, 0.004, 0.002), lambert('#77abd2', { roughness: 0.9 }), 0, y, 0.0035);
    this.flatMask.visible = false;
    d.scene.add(this.flatMask);
  }

  // ───────────────────────────── the fixtures in the layout ─────────────────────────────

  private collect() {
    const L = this.d.layout;
    const lids = new Map<string, THREE.Object3D>();
    // every fixture's named points and moving parts (props.ts hygMark), by prop id
    this.scanParts();
    this.d.root.traverse((o) => {
      if (o.userData.lidOf) lids.set(o.userData.lidOf as string, o);
    });
    const part = (id: string | undefined, name: string) => (id ? (this.parts.get(id)?.get(name) ?? null) : null);
    const wpos = (o: THREE.Object3D) => {
      o.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    };
    /** a stand-in where a fixture lacks the mark (an old build): a point, not drawn */
    const loose = (v: THREE.Vector3) => {
      const o = new THREE.Object3D();
      o.position.copy(v);
      o.updateMatrixWorld(true);
      return o;
    };
    this.markers = { found: 0, missing: [] };
    const need = (o: THREE.Object3D | null, what: string) => {
      if (o) this.markers.found++;
      else this.markers.missing.push(what);
      return o;
    };
    const levels: { index: number; y: number; props: PropDef[] }[] = [
      { index: 0, y: 0, props: L.props },
      ...upperLevels(L).map((lv) => ({
        index: lv.index,
        y: lv.y,
        props: lv.props,
      })),
    ];
    for (const lv of levels) {
      const byId = new Map(lv.props.map((p) => [p.id, p]));
      for (const p of lv.props) this.kindOf.set(p.id, p.kind);
      const at = (v: THREE.Vector3) => v.setY(v.y + lv.y);
      const dispenser = (p: PropDef, stand: { x: number; z: number } | null = null): Dispenser => {
        const y = p.y ?? 1.1;
        const box = propBox(p, 0, 0.05, 0.13, 0.14, lv.y + y - 0.05, lv.y + y + 0.26);
        const nz = part(p.id, 'nozzle');
        const pr = part(p.id, 'press');
        return {
          id: p.id,
          level: lv.index,
          nozzle: nz ? wpos(nz) : at(onProp(p, 0, y - 0.011, 0.074)),
          plate: pr ? wpos(pr) : at(onProp(p, 0, y + 0.048, 0.115)),
          n: frontOf(p),
          box,
          center: box.getCenter(new THREE.Vector3()),
          stand,
        };
      };
      const binOf = (p: PropDef): Bin => {
        const pedal = p.kind === 'pedalBin';
        const h = pedal ? 0.44 : p.kind === 'trash' ? 0.62 : 1.0;
        const box = pedal ? propBox(p, 0, 0, 0.3, 0.28, lv.y, lv.y + h) : new THREE.Box3(new THREE.Vector3(p.x - 0.22, lv.y, p.z - 0.22), new THREE.Vector3(p.x + 0.22, lv.y + h, p.z + 0.22));
        const into = part(p.id, 'into');
        return {
          id: p.id,
          level: lv.index,
          room: p.room,
          into: into ? wpos(into) : new THREE.Vector3(p.x, lv.y + h + 0.02, p.z),
          lid: lids.get(p.id) ?? null,
          box,
          center: box.getCenter(new THREE.Vector3()),
        };
      };
      const binFx = (b: Bin | null): WashFixture['bin'] => (b ? { into: b.into.clone(), lid: b.lid, pedal: part(b.id, 'pedal') } : null);
      for (const p of lv.props) {
        if (p.kind !== 'pedalBin' && p.kind !== 'trash') continue;
        const b = binOf(p);
        this.bins.push(b);
        // a pedal bin is solid for the player (not a layout collider: NPC routes stay as the server times them)
        if (p.kind === 'pedalBin') this.d.colliders.push(b.box.clone());
      }
      for (const p of lv.props) {
        if (p.kind === 'handRub') {
          // a sink's rub: stand in front of the sink
          const sink = p.id.endsWith('_rub') ? byId.get(p.id.slice(0, -4)) : undefined;
          this.rubs.push(dispenser(p, sink && sink.kind === 'sink' ? this.standAt(sink, 0.62) : null));
        } else if (p.kind === 'maskBox') {
          const counter = p.label === 'counter';
          const y = p.y ?? 1.24;
          const slot = at(counter ? onProp(p, 0, y + 0.095, 0) : onProp(p, 0, y + 0.09, 0.13));
          const box = counter ? propBox(p, 0, 0, 0.24, 0.16, lv.y + y - 0.02, lv.y + y + 0.16) : propBox(p, 0, 0.065, 0.3, 0.15, lv.y + y - 0.03, lv.y + y + 0.2);
          this.maskSources.push({
            id: p.id,
            level: lv.index,
            slot,
            n: frontOf(p),
            top: counter,
            box,
            center: box.getCenter(new THREE.Vector3()),
          });
        } else if (p.kind === 'gloveHolder' || p.kind === 'gloveStation') {
          // a box of gloves: its hole (the fixture's own mark), where to stand (a sink's: at the sink)
          const station = p.kind === 'gloveStation';
          const sl = part(p.id, 'slot');
          const y = p.y ?? (station ? 1.0 : 1.3);
          const slot = sl ? wpos(sl) : at(onProp(p, station ? -0.32 : 0, y + (station ? 0.29 : 0.07), station ? 0.055 : 0.127));
          const box = station ? propBox(p, -0.32, 0.055, 0.44, 0.12, lv.y + y, lv.y + y + 0.32) : propBox(p, 0, 0.06, 0.27, 0.14, lv.y + y - 0.01, lv.y + y + 0.15);
          const sink = p.id.endsWith('_gloves') ? byId.get(p.id.slice(0, -7)) : undefined;
          this.gloveSources.push({ id: p.id, level: lv.index, slot, n: frontOf(p), box, center: box.getCenter(new THREE.Vector3()), stand: sink && sink.kind === 'sink' ? this.standAt(sink, 0.37) : null });
        } else if (p.kind === 'maskStation') {
          // the stand: its box at 1.2 m and its dispenser at 0.92 m, on the post's front
          const slot = at(onProp(p, 0, 1.2 + 0.09, 0.155));
          const box = propBox(p, 0, 0.09, 0.3, 0.16, lv.y + 1.17, lv.y + 1.4);
          this.maskSources.push({
            id: p.id,
            level: lv.index,
            slot,
            n: frontOf(p),
            box,
            center: box.getCenter(new THREE.Vector3()),
          });
          const rb = propBox(p, 0, 0.075, 0.13, 0.13, lv.y + 0.88, lv.y + 1.18);
          const nz = part(p.id, 'nozzle');
          const pr = part(p.id, 'press');
          this.rubs.push({
            id: `${p.id}_rub`,
            level: lv.index,
            nozzle: nz ? wpos(nz) : at(onProp(p, 0, 0.9, 0.1)),
            plate: pr ? wpos(pr) : at(onProp(p, 0, 0.975, 0.137)),
            n: frontOf(p),
            box: rb,
            center: rb.getCenter(new THREE.Vector3()),
            stand: null,
          });
          // solid for the player (not for NPC routes: the server times the waiting room without it)
          this.d.colliders.push(propBox(p, 0, 0, 0.44, 0.44, lv.y, lv.y + 1.9));
        } else if (p.kind === 'sink') {
          const soap = byId.get(`${p.id}_soap`);
          if (!soap) continue;
          const towel = byId.get(`${p.id}_towel`);
          const binP = byId.get(`${p.id}_bin`);
          const f = frontOf(p);
          const r = new THREE.Vector3(Math.cos(p.rot ?? 0), 0, -Math.sin(p.rot ?? 0));
          // close in, the body against the counter's edge (you lean over a sink; the arms reach the tap and the soap)
          const stand = this.standAt(p, 0.37);
          const near = binP ? binOf(binP) : this.nearestBin(onProp(p, -0.6, 0, -0.1), lv.index, 1.6);
          const sinkBox = propBox(p, 0, 0, 0.7, 0.58, lv.y, lv.y + 1.0);
          const soapD = dispenser(soap, stand);
          const build = () => {
            const outlet = need(part(p.id, 'outlet'), `${p.id}:outlet`);
            const basin = need(part(p.id, 'basin'), `${p.id}:basin`);
            const lever = need(part(p.id, 'lever'), `${p.id}:lever`);
            const plate = need(part(soap.id, 'plate'), `${soap.id}:plate`);
            const press = need(part(soap.id, 'press'), `${soap.id}:press`);
            const nozzle = need(part(soap.id, 'nozzle'), `${soap.id}:nozzle`);
            const tail = towel ? need(part(towel.id, 'tail'), `${towel.id}:tail`) : null;
            const grab = towel ? need(part(towel.id, 'grab'), `${towel.id}:grab`) : null;
            const slot = towel ? need(part(towel.id, 'slot'), `${towel.id}:slot`) : null;
            const slotAt = slot ? wpos(slot) : towel ? at(onProp(towel, 0, (towel.y ?? 1.2) - 0.002, 0.085)) : null;
            const fx: WashFixture = {
              outlet: outlet ? wpos(outlet) : at(onProp(p, 0, 1.074, -0.04)),
              basin: basin ? wpos(basin) : at(onProp(p, 0, 0.886, 0.02)),
              basinR: (basin?.userData.r as number | undefined) ?? 0.19,
              f,
              r,
              lever: lever
                ? {
                    hinge: lever,
                    len: lever.userData.len as number,
                    off: lever.userData.off as number,
                    on: lever.userData.on as number,
                  }
                : null,
              soap: {
                nozzle: nozzle ? wpos(nozzle) : soapD.nozzle.clone(),
                n: frontOf(soap),
                press: press ?? loose(soapD.plate),
                plate,
                travel: (plate?.userData.travel as number | undefined) ?? 0.008,
                down: plate?.userData.axis === 1,
              },
              towel:
                towel && slotAt
                  ? {
                      slot: slotAt,
                      n: frontOf(towel),
                      across: new THREE.Vector3(Math.cos(towel.rot ?? 0), 0, -Math.sin(towel.rot ?? 0)),
                      tail,
                      grab: grab ?? loose(slotAt.clone().addScaledVector(UP, -0.054)),
                    }
                  : null,
              bin: binFx(near),
            };
            return {
              fx,
              complete: !!(outlet && basin && lever && nozzle && press && (!towel || (tail && grab))),
            };
          };
          const { fx, complete } = build();
          this.washes.push({
            id: p.id,
            level: lv.index,
            basin: fx.basin.clone(),
            spout: fx.outlet.clone(),
            lever: fx.lever ? wpos(fx.lever.hinge) : null,
            soap: soapD,
            towel: fx.towel ? { slot: fx.towel.slot.clone(), n: fx.towel.n.clone() } : null,
            bin: near,
            fx,
            complete,
            rebuild: build,
            stand,
            f,
            r,
            box: soapD.box,
            center: soapD.center,
            sinkBox,
          });
        } else if (p.kind === 'vanity') {
          // restroom basins: a sensor tap, the counter's soap pump, the vanity's towels
          const W = p.w ?? 1.8;
          const D = 0.55;
          const n = Math.max(1, Math.round(W / 0.9));
          const f = frontOf(p);
          const r = new THREE.Vector3(Math.cos(p.rot ?? 0), 0, -Math.sin(p.rot ?? 0));
          const slot = part(p.id, 'slot');
          const slotAt = slot ? wpos(slot) : W >= 1.5 ? at(onProp(p, W / 2 + 0.28, 1.198, 0.085)) : null;
          // the counter (wall-hung, not solid: a walk to the towels or the bin goes round it)
          const counter = propBox(p, 0, D / 2, W, D, lv.y, lv.y + 0.9);
          // the bin for the towels: the room's own, the one nearest the towels (a restroom's is by the door)
          const towelsAt = slotAt ?? onProp(p, 0, 0, D);
          const roomBin = this.bins.filter((b) => b.level === lv.index && b.room === p.room).sort((x, y) => Math.hypot(x.into.x - towelsAt.x, x.into.z - towelsAt.z) - Math.hypot(y.into.x - towelsAt.x, y.into.z - towelsAt.z))[0];
          for (let i = 0; i < n; i++) {
            const bx = -W / 2 + (W / n) * (i + 0.5);
            const build = () => {
              const tail = part(p.id, 'tail');
              const grab = part(p.id, 'grab');
              const nz = need(part(p.id, `nozzle:${i}`), `${p.id}:nozzle:${i}`);
              const pr = need(part(p.id, `press:${i}`), `${p.id}:press:${i}`);
              const plate = part(p.id, `plate:${i}`);
              const outlet = need(part(p.id, `outlet:${i}`), `${p.id}:outlet:${i}`);
              const basin = part(p.id, `basin:${i}`);
              const nozzle = nz ? wpos(nz) : at(onProp(p, bx + 0.23, 0.949, 0.123));
              const pressAt = pr ? wpos(pr) : at(onProp(p, bx + 0.23, 0.958, 0.08));
              const box = propBox(p, bx, D * 0.55, 0.5, 0.4, lv.y + 0.8, lv.y + 1.1);
              const sp = onProp(p, bx, 0, D + 0.17);
              const stand = { x: sp.x, z: sp.z };
              const soap: Dispenser = {
                id: `${p.id}#${i}`,
                level: lv.index,
                nozzle,
                plate: pressAt,
                n: f.clone(),
                box,
                center: box.getCenter(new THREE.Vector3()),
                stand,
              };
              const bin = roomBin ?? this.nearestBin(onProp(p, 0, 0, D), lv.index, 2);
              const fx: WashFixture = {
                outlet: outlet ? wpos(outlet) : at(onProp(p, bx, 1.022, 0.2)),
                basin: basin ? wpos(basin) : at(onProp(p, bx, 0.7, D * 0.55)),
                basinR: (basin?.userData.r as number | undefined) ?? 0.13,
                f,
                r,
                lever: null,
                soap: {
                  nozzle: nozzle.clone(),
                  n: f.clone(),
                  press: pr ?? loose(pressAt),
                  plate,
                  travel: (plate?.userData.travel as number | undefined) ?? 0.01,
                  down: true,
                },
                towel: slotAt
                  ? {
                      slot: slotAt,
                      n: f.clone(),
                      across: r.clone(),
                      tail,
                      grab: grab ?? loose(slotAt.clone().addScaledVector(UP, -0.054)),
                    }
                  : null,
                bin: binFx(bin),
              };
              return {
                fx,
                soap,
                stand,
                box,
                bin,
                complete: !!(nz && pr && outlet),
              };
            };
            const { fx, soap, stand, box, bin, complete } = build();
            this.washes.push({
              id: `${p.id}#${i}`,
              level: lv.index,
              basin: fx.basin.clone(),
              spout: fx.outlet.clone(),
              lever: null,
              soap,
              towel: fx.towel ? { slot: fx.towel.slot.clone(), n: fx.towel.n.clone() } : null,
              bin,
              fx,
              complete,
              rebuild: () => build(),
              stand,
              f,
              r,
              box,
              center: soap.center,
              sinkBox: counter,
            });
          }
        }
      }
    }
    this.entrances = hygienePlan(L.rooms, L.props).entrances;
  }

  /** find every fixture's marks in the built world (again: a storey may have been built since) */
  private scanParts() {
    this.parts.clear();
    this.d.root.updateMatrixWorld(true);
    this.d.root.traverse((o) => {
      const name = o.userData.hygPart as string | undefined;
      if (!name) return;
      let a: THREE.Object3D | null = o.parent;
      while (a && a.userData.propId === undefined) a = a.parent;
      if (!a) return;
      const id = a.userData.propId as string;
      let m = this.parts.get(id);
      if (!m) this.parts.set(id, (m = new Map()));
      if (!m.has(name)) m.set(name, o);
    });
  }

  /** where you stand to use a sink: `out` m in front of its middle */
  private standAt(sink: PropDef, out: number): { x: number; z: number } {
    const p = onProp(sink, 0, 0, out);
    return { x: p.x, z: p.z };
  }

  private nearestBin(p: THREE.Vector3, level: number, r: number): Bin | null {
    let best: Bin | null = null;
    let bd = r;
    for (const b of this.bins) {
      if (b.level !== level) continue;
      const dist = Math.hypot(b.into.x - p.x, b.into.z - p.z);
      if (dist < bd) {
        bd = dist;
        best = b;
      }
    }
    return best;
  }

  // ───────────────────────────── targets ─────────────────────────────

  targets(): AmenityTarget[] {
    const out: AmenityTarget[] = [];
    // (each says F shows what it is: E uses it, F reads its card)
    const F = ' · [F] Inspect';
    for (const r of this.rubs)
      out.push({
        key: `use:rub:${r.id}`,
        target: {
          kind: 'use',
          id: `rub:${r.id}`,
          label: `Disinfect your hands (alcohol rub)${F}`,
        },
        box: r.box,
        center: r.center,
        level: r.level,
      });
    for (const w of this.washes) {
      out.push({
        key: `use:wash:${w.id}`,
        target: {
          kind: 'use',
          id: `wash:${w.id}`,
          label: `Wash your hands (soap and water)${F}`,
        },
        box: w.box,
        center: w.center,
        level: w.level,
      });
      if (w.sinkBox)
        out.push({
          key: `use:wash:${w.id}:sink`,
          target: {
            kind: 'use',
            id: `wash:${w.id}`,
            label: `Wash your hands at the sink${F}`,
          },
          box: w.sinkBox,
          center: w.sinkBox.getCenter(new THREE.Vector3()),
          level: w.level,
        });
    }
    const label = this.masked ? 'Take off your mask (into the bin)' : 'Put on a surgical mask';
    for (const m of this.allMaskSources())
      out.push({
        key: `use:mask:${m.id}`,
        target: { kind: 'use', id: `mask:${m.id}`, label: `${label}${F}` },
        box: m.box,
        center: m.center,
        level: m.level,
      });
    if (this.masked && !this.act)
      for (const b of this.bins)
        out.push({
          key: `use:maskbin:${b.id}`,
          target: {
            kind: 'use',
            id: `maskbin:${b.id}`,
            label: `Take off your mask into the bin${F}`,
          },
          box: b.box,
          center: b.center,
          level: b.level,
        });
    const gl = this.gloved ? 'Gloves on: [G] takes them off' : 'Put on gloves (non-sterile nitrile)';
    for (const g of this.gloveSources) out.push({ key: `use:gloves:${g.id}`, target: { kind: 'use', id: `gloves:${g.id}`, label: `${gl}${F}` }, box: g.box, center: g.center, level: g.level });
    if (this.bundle && !this.act) for (const b of this.bins) out.push({ key: `use:glovebin:${b.id}`, target: { kind: 'use', id: `glovebin:${b.id}`, label: `Drop the used gloves in the bin${F}` }, box: b.box, center: b.center, level: b.level });
    return out;
  }

  /**
   * F on one of ours (a target's key): the subject of its info card (items.ts FIXTURE_INFO), or null.
   * E still does what the prompt says.
   */
  inspectSubject(key: string): string | null {
    const [use, kind, ...rest] = key.split(':');
    if (use !== 'use') return null;
    const ref = rest.join(':');
    if (kind === 'rub') {
      if (this.kindOf.get(ref) === 'handRub') return 'handRub';
      return ref.endsWith('_rub') && this.kindOf.get(ref.slice(0, -4)) === 'maskStation' ? 'maskStation' : this.rubs.some((r) => r.id === ref) ? 'handRub' : null;
    }
    if (kind === 'wash') {
      const sink = ref.endsWith(':sink');
      const id = sink ? ref.slice(0, -5) : ref;
      if (!this.washes.some((w) => w.id === id)) return null;
      if (id.includes('#')) return 'vanity';
      return sink ? 'sink' : 'soapDispenser';
    }
    if (kind === 'mask') {
      if (!this.allMaskSources().some((m) => m.id === ref)) return null;
      return this.kindOf.get(ref) === 'maskStation' ? 'maskStation' : 'maskBox';
    }
    if (kind === 'maskbin' || kind === 'glovebin') return this.kindOf.get(ref) === 'trash' ? 'trash' : 'pedalBin';
    if (kind === 'gloves') return this.gloveSources.some((g) => g.id === ref) ? 'gloveHolder' : null;
    return null;
  }

  private allMaskSources(): MaskSource[] {
    const out = [...this.maskSources];
    for (const s of this.stands.values()) if (s.mask) out.push(s.mask);
    return out;
  }

  find(key: string): AmenityTarget | undefined {
    return this.targets().find((t) => t.key === key);
  }

  /** E on one of ours: true when it was ours */
  interact(id: string): boolean {
    const [kind, ...rest] = id.split(':');
    const ref = rest.join(':');
    // hands busy with gloves: bare hands for hand hygiene, the used pair binned first
    if ((kind === 'rub' || kind === 'wash' || kind === 'mask' || kind === 'gloves') && this.bundle && !this.act) {
      this.d.hint('Bin the used gloves first (E on a bin, or [G] beside one)', 2800);
      return true;
    }
    if ((kind === 'rub' || kind === 'wash') && this.gloved && !this.act) {
      this.d.hint('Take your gloves off first ([G]): hand hygiene is for bare hands, and rubbing gloves isn’t it', 3200);
      return true;
    }
    if (kind === 'gloves') {
      const g = this.gloveSources.find((x) => x.id === ref);
      if (!g) return false;
      if (this.gloved) this.d.hint('Gloves on already: [G] takes them off (inside out, into the bin)', 2800);
      else this.start({ kind: 'glovesOn', t: 0, src: g, flags: new Set() }, g.stand ?? this.standFor(g.slot, g.n, 0.5), g.slot, g.n);
      return true;
    }
    if (kind === 'glovebin') {
      const b = this.bins.find((x) => x.id === ref);
      if (b && this.bundle) this.tossGloves(b);
      return !!b;
    }
    if (kind === 'rub') {
      const d = this.rubs.find((r) => r.id === ref);
      if (d) this.start({ kind: 'rub', t: 0, d, pumped: false, sound: false }, d.stand ?? this.standFor(d.nozzle, d.n, 0.55), d.nozzle, d.n);
      return !!d;
    }
    if (kind === 'wash') {
      const w = this.washes.find((x) => x.id === ref);
      if (w && !w.complete) {
        this.scanParts();
        const b = w.rebuild();
        w.fx = b.fx;
        w.complete = b.complete;
      }
      if (w)
        this.start(
          {
            kind: 'wash',
            t: 0,
            w,
            fx: w.fx,
            flags: new Set(),
            ts: towelHand(w.fx),
            base: { x: w.stand.x, z: w.stand.z, facing: 0 },
            step: null,
            water: false,
            legs: [],
            leg: null,
          },
          w.stand,
          w.basin,
          w.f,
        );
      return !!w;
    }
    if (kind === 'mask') {
      const m = this.allMaskSources().find((x) => x.id === ref);
      if (!m) return false;
      if (this.masked) this.takeOff();
      else this.start({ kind: 'maskOn', t: 0, src: m, flags: new Set() }, this.standFor(m.slot, m.n, 0.5), m.slot, m.n);
      return true;
    }
    if (kind === 'maskbin') {
      if (this.masked) this.takeOff(this.bins.find((b) => b.id === ref) ?? null);
      return true;
    }
    return false;
  }

  /** M: off with the mask, wherever you are (the nearest bin within reach, else the next one you pass) */
  maskKey() {
    this.interrupt();
    if (this.act) return;
    if (!this.masked) {
      this.d.hint('No mask on. Masks: the boxes at the entrances, the station, and outside rooms on precautions', 3500);
      return;
    }
    this.takeOff();
  }

  private takeOff(bin: Bin | null = null) {
    this.interrupt();
    if (this.act) {
      this.d.hint('One thing at a time', 1500);
      return;
    }
    const pos = new THREE.Vector3(this.d.controller.pos.x, 0, this.d.controller.pos.y);
    const b = bin ?? this.nearestBin(pos, this.level(), 2.2);
    this.act = { kind: 'maskOff', t: 0, bin: b, flags: new Set() };
  }

  /** a spot `out` m in front of a wall point, at the player's floor */
  private standFor(at: THREE.Vector3, n: THREE.Vector3, out: number): { x: number; z: number } {
    return { x: at.x + n.x * out, z: at.z + n.z * out };
  }

  private level(): number {
    const y = this.d.controller.y;
    let best = 0;
    for (const lv of upperLevels(this.d.layout)) if (y > lv.y - 1.2) best = lv.index;
    return best;
  }

  private start(a: Act, stand: { x: number; z: number } | null, look: THREE.Vector3, n: THREE.Vector3) {
    this.interrupt();
    if (this.act || this.d.busy()) {
      this.d.hint('One thing at a time', 1500);
      return;
    }
    if (this.d.items.heldItems().length) {
      this.d.hint(a.kind === 'maskOn' ? "Put down what you're holding first (G), then put on a mask" : a.kind === 'glovesOn' ? "Put down what you're holding first (G), then put on gloves" : `Put down what you're holding first (G), then ${a.kind === 'wash' ? 'wash' : 'rub'} your hands`, 2800);
      return;
    }
    if (this.d.seated()) this.d.standUp();
    const ctl = this.d.controller;
    // step up to it (a short slide and a turn): where you'd stand, or beside it if a cart is parked
    // there; stay put when you're there already or nothing's free
    const to = { x: ctl.pos.x, z: ctl.pos.y };
    // (at a sink you stand against the counter, inside the body's usual margin: the feet must be clear)
    const spot = stand ? (a.kind === 'wash' && this.clear(stand.x, stand.z, 0.12, ctl.y + 0.5) ? stand : this.freeSpot(stand, look, n)) : null;
    if (spot && Math.hypot(spot.x - ctl.pos.x, spot.z - ctl.pos.y) > 0.1 && Math.hypot(spot.x - ctl.pos.x, spot.z - ctl.pos.y) < 2.8) Object.assign(to, spot);
    const facing = Math.atan2(look.x - to.x, look.z - to.z);
    const eye = new THREE.Vector3(to.x, ctl.y + 1.62, to.z);
    const dy = look.y - eye.y;
    const flat = Math.hypot(look.x - to.x, look.z - to.z);
    const pitch = THREE.MathUtils.clamp(Math.atan2(dy, flat) + (a.kind === 'wash' ? 0.12 : 0.05), -1.05, 0.2);
    this.approach = {
      from: {
        x: ctl.pos.x,
        z: ctl.pos.y,
        facing: ctl.facing,
        yaw: ctl.yaw,
        pitch: ctl.pitch,
      },
      to: { x: to.x, z: to.z, facing, yaw: facing - Math.PI, pitch },
      t: 0,
    };
    ctl.path = null;
    if (a.kind === 'wash') {
      // (shorter arms: a few cm closer to the counter)
      const arm = this.tp() ? (this.d.hands.armReach('R') ?? 0.549) : 0.549;
      const closer = THREE.MathUtils.clamp((0.549 - arm) * 0.9, 0, 0.05);
      to.x -= a.w.f.x * closer;
      to.z -= a.w.f.z * closer;
      a.base = { x: to.x, z: to.z, facing };
      this.approach.to.x = to.x;
      this.approach.to.z = to.z;
      a.step = this.towelStep(a.w, a.base, a.ts);
      this.planWalks(a);
      this.look = null;
    }
    this.act = a;
    this.prep = null;
    this.sleevesFirst(a);
    const say = {
      rub: 'Alcohol hand rub: a palmful, palms, backs, between the fingers, thumbs, fingertips, until dry (20–30 s)',
      wash: 'Hand wash: wet, soap, 40–60 s in all: every surface, rinse, tap off with the wrist, dry with a towel',
      maskOn: 'Surgical mask: coloured side out, nose wire up, loops behind the ears, pinch the wire, cover the chin',
      maskOff: '',
      glovesOn: 'Gloves: clean hands first; one from the box, the cuff pulled up over the wrist, then the other',
      glovesOff: 'Gloves off: pinch one at the wrist and peel it inside out; a bare finger under the other cuff, peel it over the first',
      gloveToss: '',
      sleevesDown: '',
    }[a.kind];
    if (say) this.d.hint(say, 5000);
  }

  /**
   * Where to stand: the spot asked for if it's clear, else the nearest clear one in a fan in front of
   * the thing (its normal `n`), 0.5–0.85 m out and up to 60° to either side.
   */
  private freeSpot(ideal: { x: number; z: number }, at: THREE.Vector3, n: THREE.Vector3): { x: number; z: number } | null {
    if (this.free(ideal.x, ideal.z)) return ideal;
    const base = Math.hypot(ideal.x - at.x, ideal.z - at.z);
    for (const extra of [0, 0.12, 0.25])
      for (const deg of [20, -20, 35, -35, 50, -50, 62, -62]) {
        const dir = n
          .clone()
          .setY(0)
          .normalize()
          .applyAxisAngle(UP, (deg * Math.PI) / 180);
        const x = at.x + dir.x * (base + extra);
        const z = at.z + dir.z * (base + extra);
        if (this.free(x, z)) return { x, z };
      }
    return null;
  }

  /** nothing solid where you'd stand (the player's radius) */
  private free(x: number, z: number): boolean {
    return this.clear(x, z, 0.28, this.d.controller.y + 0.5);
  }

  /** no collider within r of (x, z) at height y (the ground floor's by default) */
  private clear(x: number, z: number, r: number, y = 0.5): boolean {
    for (const b of this.d.colliders) if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r && y > b.min.y && y < b.max.y) return false;
    return true;
  }

  /**
   * Where to step to take the towel: the body facing the tail, the near shoulder just outside it and
   * the hand's reach to it comfortable (≤ 0.5 m shoulder to wrist), clear of the sink, the bin and
   * anything solid; the least walking that does. Null when the towel's in reach already or nothing fits.
   */
  private towelStep(w: Wash, base: { x: number; z: number; facing: number }, ts: HandSide): { x: number; z: number; facing: number } | null {
    const tw = w.fx.towel;
    if (!tw) return null;
    const grab = tw.grab.getWorldPosition(new THREE.Vector3());
    const s = ts === 'R' ? 1 : -1;
    const k = (this.d.avatar()?.height ?? 1.78) / 1.78;
    const y0 = this.d.controller.y;
    const fp = !this.tp();
    // the wrist as the hand pinches the tail: the avatar's, or the first-person hand's (lower and nearer
    // the wall, measured)
    const wristAt = fp ? grab.clone().addScaledVector(UP, -0.135).addScaledVector(tw.n, -0.063) : grab.clone().addScaledVector(UP, -0.1).addScaledVector(tw.n, 0.02);
    // the near shoulder as the avatar has it (Rocketbox: 0.205 m out, 1.44 m up; leaning, ~0.22 m forward
    // and ~0.08 m down per radian), the body leaning toward the towels as it reaches (washLean). First
    // person: under the eyes (1.64 m up; fpShoulders: 0.3 m down, 0.2 m out and, looking down at the tail,
    // 0.15 m behind them), the eyes leaning in as washCameraFp has them. Placed for the third person's
    // shoulder, the first person's arm couldn't reach the towel: straight out, its shoulder pulled after it
    const lean = washLean(WASH.reach, w.fx);
    const reachFrom = (x: number, z: number, facing: number) => {
      const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
      const right = new THREE.Vector3(-Math.cos(facing), 0, Math.sin(facing));
      const sh = fp
        ? new THREE.Vector3(x, y0 + 1.64 - 0.3, z).addScaledVector(right, s * 0.2).addScaledVector(fwd, 0.45 * Math.sin(lean * TOWEL_LEAN_FP) - 0.15)
        : new THREE.Vector3(x, y0 + (1.44 - 0.08 * lean) * k, z).addScaledVector(right, s * 0.205 * k).addScaledVector(fwd, 0.22 * lean * k);
      return sh.distanceTo(wristAt);
    };
    // (shoulder to wrist: the avatar's own arm, a little bent; ~0.55 m for a 1.78 m adult)
    const REACH = (fp ? (FpArms.peek(this.d.scene)?.armLength(ts) ?? 0.549 * k) : (this.d.hands.armReach(ts) ?? 0.549 * k)) * 0.95;
    const facingTo = (x: number, z: number) => {
      // toward the tail, at most 35° off square to the wall
      const wall = Math.atan2(-tw.n.x, -tw.n.z);
      let a = Math.atan2(grab.x - x, grab.z - z) - wall;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return wall + THREE.MathUtils.clamp(a, -0.61, 0.61);
    };
    if (reachFrom(base.x, base.z, base.facing) <= REACH) return null;
    // (the counter's at hip height: clear of it by the body; the bin's knee-high: by the legs, leaning over it)
    const boxes: [THREE.Box3, number][] = [];
    if (w.sinkBox) boxes.push([w.sinkBox, 0.19]);
    if (w.bin) boxes.push([w.bin.box, 0.12]);
    const clearOf = (x: number, z: number) => boxes.every(([b, r]) => Math.max(b.min.x - x, 0, x - b.max.x) ** 2 + Math.max(b.min.z - z, 0, z - b.max.z) ** 2 >= r * r);
    let best: { x: number; z: number; facing: number } | null = null;
    let score = Infinity;
    // (out of reach from anywhere clear: as near as it gets. A step that falls short beats none)
    let nearest: { x: number; z: number; facing: number } | null = null;
    let least = Infinity;
    for (let lat = -0.1; lat <= 0.36; lat += 0.03)
      for (let out = fp ? 0.22 : 0.3; out <= 0.8; out += 0.025) {
        // `lat` toward the sink from the tail (the near shoulder outside it), `out` from the wall
        const x = grab.x - w.r.x * s * lat + tw.n.x * out;
        const z = grab.z - w.r.z * s * lat + tw.n.z * out;
        if (!clearOf(x, z) || !this.clear(x, z, 0.12, y0 + 0.5)) continue;
        const facing = facingTo(x, z);
        const reach = reachFrom(x, z, facing);
        if (reach < least) {
          least = reach;
          nearest = { x, z, facing };
        }
        if (reach > REACH) continue;
        // comfortable (a little bent) and as little walking as it takes; walking over anyway (further
        // than a side step), a spot back from the wall matters more than a few steps (close in, you
        // lean in with the dispenser at your face, and dry your hands against the wall). First person,
        // closer in: from back there the arm couldn't reach, the eyes leaning in less
        const walk = Math.hypot(x - base.x, z - base.z);
        const sc = Math.abs(reach - 0.44 * k) * 2 + (walk > SIDE_STEP ? 0.3 * walk + Math.max(0, (fp ? 0.34 : 0.56) * k - out) * 4 : walk);
        if (sc < score) {
          score = sc;
          best = { x, z, facing };
        }
      }
    return best ?? nearest;
  }

  /**
   * A wash's walks: over to the towels when they're further than a side step from the basin, then to
   * the bin when it's out of reach of where you dried your hands (a restroom: the dispenser at the
   * counter's end, the bin by the door). With no way to the bin, this wash goes without one.
   */
  private planWalks(a: Extract<Act, { kind: 'wash' }>) {
    a.legs = [];
    a.leg = null;
    a.fx = a.w.fx;
    let at: Spot = a.base;
    // (no clear way over to the towels: the side step as before)
    if (a.step && Math.hypot(a.step.x - a.base.x, a.step.z - a.base.z) > SIDE_STEP) {
      const leg = this.planLeg('towel', WASH.towel, a.base, a.step, a.w);
      if (leg) a.legs.push(leg);
    }
    if (a.step) at = a.step;
    const bin = a.fx.bin;
    // (no towels: nothing to throw away)
    if (bin && !a.fx.towel) a.fx = { ...a.fx, bin: null };
    this.binPlan = { bin: bin ? 1 : 0, towel: a.fx.towel ? 1 : 0, dist: bin ? +Math.hypot(bin.into.x - at.x, bin.into.z - at.z).toFixed(2) : -1 };
    if (!bin || !a.fx.towel || Math.hypot(bin.into.x - at.x, bin.into.z - at.z) <= 0.85) return;
    const stand = this.binStand(a.w, at, a.ts);
    if (stand) a.legs.push(stand);
    else a.fx = { ...a.fx, bin: null };
  }
  /** tests: why the last wash's walk to the bin was or wasn't planned (candidates turned down, and why) */
  private binPlan: Record<string, number | string> = {};
  private blocked = '';

  /** where to stand to drop the towel in the bin (beside it, the bin a little to the towel hand's side), and the walk there */
  private binStand(w: Wash, from: Spot, ts: HandSide): Leg | null {
    const bin = w.fx.bin!;
    const s = ts === 'R' ? 1 : -1;
    const y = this.d.controller.y + 0.5;
    let best: Leg | null = null;
    const why: Record<string, number> = {};
    const no = (k: string) => (why[k] = (why[k] ?? 0) + 1);
    for (let k = 0; k < 24; k++)
      for (const rr of [0.42, 0.5]) {
        const ang = (k / 24) * Math.PI * 2;
        const x = bin.into.x + Math.sin(ang) * rr;
        const z = bin.into.z + Math.cos(ang) * rr;
        if (!this.clear(x, z, 0.18, y)) {
          no('solid');
          continue;
        }
        if (w.sinkBox && boxNear(w.sinkBox, x, z) < 0.22) {
          no('counter');
          continue;
        }
        // (facing the bin, turned a little away from the towel hand: the bin's in front of it)
        const facing = Math.atan2(bin.into.x - x, bin.into.z - z) + s * 0.3;
        const leg = this.planLeg('bin', WASH.bin, from, { x, z, facing }, w);
        if (!leg) no('no way');
        else if (!best || leg.len < best.len) best = leg;
      }
    this.binPlan = { ...why, len: best ? +best.len.toFixed(2) : -1, blocked: this.blocked };
    return best && best.len < 7 ? best : null;
  }

  /**
   * A walk from one spot to another past the sink: straight when nothing's in the way, else stepping
   * back from the counter to a lane along it first, and in again at the end; the corners rounded.
   * Null when neither way is clear.
   */
  private planLeg(kind: Leg['kind'], at: number, from: Spot, to: Spot, w: Wash): Leg | null {
    const f = w.f;
    // how far in front of the basin a point is, and the counter's front
    const out = (x: number, z: number) => (x - w.basin.x) * f.x + (z - w.basin.z) * f.z;
    let front = 0.3;
    if (w.sinkBox) {
      const b = w.sinkBox;
      front = Math.max(...[b.min.x, b.max.x].flatMap((x) => [b.min.z, b.max.z].map((z) => out(x, z))));
    }
    const lane = front + 0.38;
    const straight = [from, to];
    const via: { x: number; z: number }[] = [from];
    const o0 = out(from.x, from.z);
    const o1 = out(to.x, to.z);
    if (o0 < lane - 0.05) via.push({ x: from.x + f.x * (lane - o0), z: from.z + f.z * (lane - o0) });
    if (o1 < lane - 0.05) via.push({ x: to.x + f.x * (lane - o1), z: to.z + f.z * (lane - o1) });
    via.push(to);
    for (const way of [straight, via]) {
      const pts = roundCorners(way);
      if (!this.wayClear(pts, w)) continue;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const len = cum[cum.length - 1];
      // (a turn of more than ~70° to set off or to arrive takes a moment longer)
      const head0 = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
      const n = pts.length - 1;
      const head1 = Math.atan2(pts[n].x - pts[n - 1].x, pts[n].z - pts[n - 1].z);
      const turns = Math.max(0, Math.abs(angleDiff(from.facing, head0)) - 1.2) + Math.max(0, Math.abs(angleDiff(head1, to.facing)) - 1.2);
      return { kind, at, pts, cum, len, f0: from.facing, f1: to.facing, dur: SET_OFF * 1.4 + len / PACE + turns / 3, u: 0, done: false };
    }
    return null;
  }

  /**
   * nothing solid within a body's half-width of a walk (bar its first and last steps: you start
   * against the counter and end beside the bin); the counter, hip-high, within the hips' half-width
   */
  private wayClear(pts: { x: number; z: number }[], w: Wash): boolean {
    const y = this.d.controller.y + 0.5;
    const a = pts[0];
    const b = pts[pts.length - 1];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.08));
      for (let j = 0; j <= n; j++) {
        const x = p.x + ((q.x - p.x) * j) / n;
        const z = p.z + ((q.z - p.z) * j) / n;
        if (Math.hypot(x - a.x, z - a.z) < 0.3 || Math.hypot(x - b.x, z - b.z) < 0.3) continue;
        const why = !this.clear(x, z, 0.18, y) ? 'solid' : w.sinkBox && boxNear(w.sinkBox, x, z) < 0.16 ? 'counter' : w.bin && boxNear(w.bin.box, x, z) < 0.18 ? 'bin' : null;
        if (why) {
          this.blocked = `${why} at ${x.toFixed(2)}, ${z.toFixed(2)}`;
          return false;
        }
      }
    }
    return true;
  }

  /** where a walk has you at u s into it: speeding up, at a walking pace, slowing down; your facing and speed */
  private legAt(l: Leg, u: number): Spot & { speed: number } {
    const T = l.dur;
    const ta = Math.min(SET_OFF, T / 2);
    const v = l.len / Math.max(1e-3, T - ta);
    const s = u < ta ? (0.5 * v * u * u) / ta : u < T - ta ? 0.5 * v * ta + v * (u - ta) : l.len - (0.5 * v * (T - u) ** 2) / ta;
    const speed = u < ta ? (v * u) / ta : u < T - ta ? v : (v * (T - u)) / ta;
    let i = 1;
    while (i < l.pts.length - 1 && l.cum[i] < s) i++;
    const p = l.pts[i - 1];
    const q = l.pts[i];
    const k = THREE.MathUtils.clamp((s - l.cum[i - 1]) / Math.max(1e-6, l.cum[i] - l.cum[i - 1]), 0, 1);
    const head = Math.atan2(q.x - p.x, q.z - p.z);
    // turned to the way as you set off, to the towels or the bin as you arrive
    const turn = Math.min(0.55, T / 2);
    const facing = u < turn ? lerpAngle(l.f0, head, smooth(u / turn)) : u > T - turn ? lerpAngle(head, l.f1, smooth((u - T + turn) / turn)) : head;
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, facing, speed };
  }

  // ───────────────────────────── per frame ─────────────────────────────

  private tp(): boolean {
    return this.d.cameraMode() !== 'first' && !!this.d.avatar()?.ready;
  }

  update(dt: number) {
    this.time += dt;
    this.remind();
    const a = this.act;
    this.syncGloves();
    if (!a) {
      this.syncMask();
      this.easeBody(dt);
      // the skin dries off after a wash
      if (this.wetAfter > 0) {
        this.wetAfter = Math.max(0, this.wetAfter - dt / 6);
        for (const side of ['R', 'L'] as HandSide[]) this.tpRig?.setWet(side, this.wetAfter);
      }
      return;
    }
    this.sleevesFirst(a);
    // the sleeves coming down: each as the hand pulling it gets halfway (in first person, at once)
    if (a.kind === 'sleevesDown') {
      if (a.t >= PULL.down[0] || !this.tp()) this.sleeves?.set('L', false);
      if (a.t >= PULL.down[1] || !this.tp()) this.sleeves?.set('R', false);
      if (!this.tp()) a.t = PULL.end;
    }
    if (this.prep) this.tickPrep(dt);
    else if (a.kind === 'wash') this.tickWash(a, dt);
    else a.t = this.holdT !== null ? Math.min(a.t + dt, this.holdT) : a.t + dt;
    const ctl = this.d.controller;
    // stepping up to it
    if (this.approach) {
      const ap = this.approach;
      ap.t = Math.min(STEP_IN, ap.t + dt);
      const k = smooth(ap.t / STEP_IN);
      ctl.pos.set(ap.from.x + (ap.to.x - ap.from.x) * k, ap.from.z + (ap.to.z - ap.from.z) * k);
      ctl.facing = lerpAngle(ap.from.facing, ap.to.facing, k);
      if (this.d.cameraMode() === 'first') {
        ctl.yaw = lerpAngle(ap.from.yaw, ap.to.yaw, k);
        ctl.pitch = ap.from.pitch + (ap.to.pitch - ap.from.pitch) * k;
      }
      if (ap.t >= STEP_IN) this.approach = null;
    } else if (ctl.moving && a.kind !== 'maskOff' && !this.stepping) {
      // walked off: it didn't happen
      this.cancel();
      return;
    }
    if (a.kind === 'wash' && !this.approach) this.washBody(a);
    if (a.kind === 'glovesOn' || a.kind === 'glovesOff') this.ensureTpRig();
    // (third person: a lean toward the box as a hand takes a glove; shorter arms a little further)
    if (a.kind === 'glovesOn' && this.tp()) {
      this.body = { lean: gloveLean(a.t) * THREE.MathUtils.clamp(0.549 / (this.d.hands.armReach('R') ?? 0.549), 1, 1.3), head: 0 };
      this.d.hands.lean(this.body.lean);
    }
    this.events(a);
    if (this.tp()) this.poseTp(a);
    if (a.t >= this.length(a)) this.finish(a);
  }

  /**
   * Third person in a long-sleeved coat: the sleeves pushed up before a rub or a wash (bare below the
   * elbows). Also once the avatar's in, if it wasn't as the act began and the act has hardly started.
   */
  private sleevesFirst(a: Act) {
    if (this.prep || (a.kind !== 'rub' && a.kind !== 'wash') || a.t > 0.2 || !this.tp()) return;
    this.rigAvatar();
    if (this.sleeves?.ok && !this.sleeves.allUp) this.prep = { t: 0 };
  }

  /** the sleeves going up before the act (its clock waits): each up as the hand pushing it gets halfway */
  private tickPrep(dt: number) {
    const p = this.prep!;
    const s = this.sleeves;
    // (tests: 'holdPush' stops it partway)
    p.t = Math.min(p.t + dt, this.holdPush ?? Infinity);
    if (s && p.t >= PUSH.up[0]) s.set('L', true);
    if (s && p.t >= PUSH.up[1]) s.set('R', true);
    // (in first person the arms you see are bare already: no need to show it)
    if (p.t >= PUSH.end || !this.tp()) {
      s?.set('L', true);
      s?.set('R', true);
      this.prep = null;
    }
  }
  /** tests: the sleeves' push held this many seconds in (null: goes on) */
  private holdPush: number | null = null;

  /**
   * Third person, the sleeves pushed up (or pulled back down, `down`): one forearm held out across the
   * waist, palm down; the other hand on its sleeve's top, from the cuff to mid-forearm (down: from the
   * roll to the wrist), where the forearm is as drawn (the hand follows it as it comes up); then the
   * other way round, then the hands down. `T` the timing (PUSH, PULL).
   */
  private sleevePoses(t: number, F: Frame, rest: Record<HandSide, HandPose>, T: SleeveTiming, down: boolean): Record<HandSide, HandPose> {
    const off = this.offsets(this.tpRig);
    const k0 = F.k;
    const d = (x: number, y: number, z: number) => new THREE.Vector3().addScaledVector(F.r, x).addScaledVector(F.u, y).addScaledVector(F.f, z).normalize();
    // the forearm held out across the waist, palm down, its sleeve's top up to the other hand
    const held = (side: HandSide): HandPose => {
      const s = side === 'R' ? 1 : -1;
      const p = F.c.clone().addScaledVector(F.r, s * 0.04 * k0).addScaledVector(F.u, -0.06 * k0).addScaledVector(F.f, 0.04 * k0);
      return { p, q: palmQuat(side, d(-s * 0.55, 0.02, 0.83), d(0, -1, 0)), fingers: pose(0.2, 0.05, 0.15, 0.1), w: 1, pole: F.sh[side].clone().addScaledVector(UP, -0.6).addScaledVector(F.r, s * 0.35) };
    };
    // the other hand over that wrist, ready to take hold (it waits there while the arm comes up)
    const hover = (side: HandSide): HandPose => {
      const s = side === 'R' ? 1 : -1;
      const other = held(side === 'R' ? 'L' : 'R');
      const p = other.p.clone().addScaledVector(UP, 0.08 * k0).addScaledVector(F.r, s * 0.05 * k0).addScaledVector(F.f, -0.03 * k0);
      return { p, q: palmQuat(side, d(-s * 0.8, -0.3, 0.45), d(0, -1, 0)), fingers: pose(0.3, 0.03, 0.25, 0.2), w: 1, pole: F.sh[side].clone().addScaledVector(UP, -0.5).addScaledVector(F.r, s * 0.3) };
    };
    // between two poses, bowed out in front (a hand going across the body doesn't go through it)
    const via = (a: HandPose, b: HandPose, k: number, out = 0.07): HandPose => {
      const h = blend(a, b, k);
      h.p.addScaledVector(F.f, out * k0 * Math.sin(Math.PI * k));
      return h;
    };
    // a hand on the other arm's sleeve, `u` of the way from the wrist to the elbow, palm down on it,
    // fingers round it toward its far side (the other arm as it was drawn last frame: this frame's
    // bones are the animation's until the arms are solved; before there is one, hovering)
    const push = (side: HandSide, u: number): HandPose => {
      const other: HandSide = side === 'R' ? 'L' : 'R';
      const k = this.d.hands.scale || 1;
      const drawn = this.armDrawn[other];
      if (!drawn) return hover(side);
      const { W, E, Q } = drawn;
      const ax = E.clone().sub(W);
      const L = ax.length();
      if (L < 1e-3) return hover(side);
      ax.divideScalar(L);
      // the top of the forearm: the back of that hand's side, square to the forearm
      const top = new THREE.Vector3(0, -1, 0).applyQuaternion(Q);
      top.addScaledVector(ax, -top.dot(ax)).normalize();
      if (top.y < 0) top.negate();
      // (a coat sleeve's top: ~4–5 cm out from the bones)
      const at = W.clone().addScaledVector(ax, u * L).addScaledVector(top, (0.045 + 0.012 * Math.max(0, u)) * k);
      const across = new THREE.Vector3().crossVectors(ax, top);
      if (across.dot(F.r) * (side === 'R' ? 1 : -1) > 0) across.negate();
      const q = palmQuat(side, across.addScaledVector(top, -0.35), top.clone().negate());
      return { p: at.sub(off(side, 'palm').clone().applyQuaternion(q)), q, fingers: pose(0.42, 0.03, 0.35, 0.3), w: 1, pole: F.sh[side].clone().addScaledVector(UP, -0.5).addScaledVector(F.r, (side === 'R' ? 1 : -1) * 0.3) };
    };
    const hem = (side: HandSide) => (this.sleeves?.hem(side) ?? 0.55) + 0.03;
    // where on the other arm a hand starts and ends: up, from the cuff to the hem; down, the other way
    const from = (side: HandSide) => (down ? hem(side === 'R' ? 'L' : 'R') : -0.05);
    const to = (side: HandSide) => (down ? -0.05 : hem(side === 'R' ? 'L' : 'R'));
    // a hand's way along the other arm: taking hold (hovering, then on it), then up or down it
    const along = (side: HandSide, [a, b]: number[]): HandPose => {
      const u = from(side) + (to(side) - from(side)) * smooth((t - a) / (b - a));
      return blend(hover(side), push(side, u), ramp(t, a, a + (down ? 0.1 : 0.07)));
    };
    const hL = held('L');
    const hR = held('R');
    // the left forearm out, the right hand over it, then along its sleeve
    if (t < T.held) return { L: via(rest.L, hL, ramp(t, 0, T.held)), R: via(rest.R, hover('R'), ramp(t, 0.06, T.held)) };
    if (t < T.left[1]) return { L: hL, R: along('R', T.left) };
    // changing over: the right hand lets go and comes back for its own arm's turn, then the left
    // hand goes over to the right arm (one after the other: they don't cross)
    if (t < T.right[0]) {
      const R = push('R', to('R'));
      return { R: via(R, hR, ramp(t, T.left[1], T.swap - 0.04), 0.1), L: via(hL, hover('L'), ramp(t, T.left[1] + 0.08, T.swap)) };
    }
    if (t < T.right[1]) return { R: hR, L: along('L', T.right) };
    // and the hands down
    const k = ramp(t, T.right[1], T.end);
    return { R: blend(hR, rest.R, k), L: via(push('L', to('L')), rest.L, k) };
  }
  /** third person, pushing the sleeves up: each arm as drawn (wrist, elbow, hand), for the next frame's push */
  private armDrawn: Partial<Record<HandSide, { W: THREE.Vector3; E: THREE.Vector3; Q: THREE.Quaternion }>> = {};

  /** a wash's clock: it waits at a walk's moment while you walk (tests: 'holdWalk' stops you partway) */
  private tickWash(a: Extract<Act, { kind: 'wash' }>, dt: number) {
    const l = a.leg;
    if (l) {
      l.u = Math.min(l.u + dt, this.holdWalk ?? Infinity);
      if (l.u >= l.dur) {
        l.u = l.dur;
        l.done = true;
        a.leg = null;
      }
      return;
    }
    const t = this.holdT !== null ? Math.min(a.t + dt, this.holdT) : a.t + dt;
    const next = a.legs.find((x) => !x.done && t >= x.at);
    if (next) {
      a.t = next.at;
      a.leg = next;
      next.u = 0;
    } else a.t = t;
  }
  /** tests: a walk held this many seconds in (null: walks on) */
  private holdWalk: number | null = null;
  /** walking now (a wash's step or walk): how fast, for the stride (World) */
  stepSpeed = 0;

  /** what the hands know of the walks (handwash.ts) */
  private walkOf(a: Extract<Act, { kind: 'wash' }>): WashWalk {
    const done = (kind: Leg['kind']) => a.legs.some((l) => l.kind === kind && l.done);
    return { towel: done('towel'), bin: done('bin'), leg: a.leg ? { kind: a.leg.kind, u: a.leg.u, dur: a.leg.dur } : null };
  }

  /**
   * A wash moves the body: toward the soap while taking it, a side step or a walk over to the towels
   * and a walk to the bin (World plays the walk while `stepping`), and in third person the lean over
   * the sink (the spine, so the arms reach from the shoulders where they are) with the head bowed to
   * the hands; walking, upright.
   */
  private washBody(a: Extract<Act, { kind: 'wash' }>) {
    const ctl = this.d.controller;
    const W = WASH;
    const t = a.t;
    // over toward the soap while taking it (it's behind the basin's right or left): a shuffle, no step
    const fx = a.fx;
    const lat = THREE.MathUtils.clamp(fx.soap.nozzle.clone().sub(new THREE.Vector3(a.base.x, 0, a.base.z)).dot(fx.r) * 1.1, -0.16, 0.16) * soapShift(t);
    let at: Spot = { x: a.base.x + fx.r.x * lat, z: a.base.z + fx.r.z * lat, facing: a.base.facing };
    let walking = false;
    this.stepSpeed = 0;
    if (a.step && !a.legs.some((l) => l.kind === 'towel')) {
      // the towels a step away: a side step over to them
      const k = ramp(t, W.towel + 0.04, W.towel + 0.46);
      walking = k > 0.001 && k < 0.999 && this.holdT === null;
      if (walking) this.stepSpeed = 1.1;
      at = { x: at.x + (a.step.x - at.x) * k, z: at.z + (a.step.z - at.z) * k, facing: lerpAngle(a.base.facing, a.step.facing, ramp(t, W.towel, W.towel + 0.5)) };
    }
    // walks: the one under way, or where the last one ended
    for (const l of a.legs) {
      if (a.leg === l) {
        const p = this.legAt(l, l.u);
        at = p;
        walking = true;
        this.stepSpeed = Math.max(0.45, p.speed);
      } else if (l.done) {
        const end = l.pts[l.pts.length - 1];
        at = { x: end.x, z: end.z, facing: l.f1 };
      }
    }
    this.stepping = walking;
    ctl.pos.set(at.x, at.z);
    ctl.facing = at.facing;
    if (!this.tp()) return;
    this.ensureTpRig();
    // (shorter arms lean a little further: the dispensers are where they are; walking, you're upright
    // and look where you're going)
    const arm = this.d.hands.armReach('R') ?? 0.549;
    const kw = this.walking(a);
    this.body.lean = washLean(t, fx) * THREE.MathUtils.clamp(0.549 / arm, 1, 1.3) * (1 - 0.8 * kw);
    this.body.head = 0.65 * (1 - 0.6 * kw);
    this.d.hands.lean(this.body.lean);
    this.d.hands.settleHead(this.body.head, -0.5);
  }

  /** how much a wash is walking now (0..1: eased in as you set off and out as you arrive) */
  private walking(a: Extract<Act, { kind: 'wash' }>): number {
    const l = a.leg;
    return l ? ramp(l.u, 0, 0.35) * (1 - ramp(l.u, l.dur - 0.35, l.dur)) : 0;
  }

  /** third person: the last act's lean over the sink and bowed head (eased out when it's cut off) */
  private body = { lean: 0, head: 0 };
  private easeBody(dt: number) {
    const b = this.body;
    if (b.lean < 1e-3 && b.head < 1e-3) return;
    const k = Math.exp(-dt * 7);
    b.lean *= k;
    b.head *= k;
    if (!this.tp()) return;
    this.d.hands.lean(b.lean);
    this.d.hands.settleHead(b.head, -0.5);
  }

  /**
   * Where each point of a hand is in the hand's own frame (m), off the hand being drawn now; until it
   * has been drawn, the first-person hand's measurements.
   */
  /** third person: each point of each hand in its hand's frame, as drawn (afterPose), for the next frame's contacts */
  private tpOff = new Map<string, THREE.Vector3>();
  private tpOffFor: HandRig | null = null;
  private measureTp(rig: HandRig) {
    if (this.tpOffFor !== rig) {
      this.tpOff.clear();
      this.tpOffFor = rig;
    }
    const W = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const points: HandPoint[] = ['wrist', 'palm', 'heel', 'back', 'wristBack', 'wristVolar', 'tipIndex', 'tipMiddle', 'tipRing', 'tipLittle', 'tipThumb', 'pinch'];
    for (const side of ['R', 'L'] as HandSide[]) {
      if (!rig.frame(side, W, Q)) continue;
      Q.invert();
      for (const p of points) {
        const key = side + p;
        const v = this.tpOff.get(key) ?? new THREE.Vector3();
        this.tpOff.set(key, v.copy(rig.point(side, p, P)).sub(W).applyQuaternion(Q));
      }
    }
  }

  private offsets(rig: HandRig | null): (side: HandSide, p: HandPoint) => THREE.Vector3 {
    const W = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    const cache = new Map<string, THREE.Vector3>();
    // (third person: as drawn last frame, the fingers curled as asked; before the arms are solved, the
    // bones hold the animation's relaxed fingers and a pinch would land a few centimetres short)
    const drawn = rig && rig === this.tpRig && rig === this.tpOffFor ? this.tpOff : null;
    return (side, p) => {
      const key = side + p;
      let v = cache.get(key) ?? drawn?.get(key);
      if (v) return v;
      if (rig && rig.frame(side, W, Q)) v = rig.point(side, p, new THREE.Vector3()).sub(W).applyQuaternion(Q.invert());
      else v = nominal(side, p);
      cache.set(key, v);
      return v;
    };
  }

  private length(a: Act): number {
    if (a.kind === 'glovesOn') return G_ON.end;
    if (a.kind === 'glovesOff') return a.bin ? G_OFF.endBin : G_OFF.end;
    if (a.kind === 'gloveToss') return 0.95;
    if (a.kind === 'sleevesDown') return PULL.end;
    return a.kind === 'rub' ? RUB.end : a.kind === 'wash' ? WASH.end : a.kind === 'maskOn' ? MASK_ON.end : MASK_OFF.end;
  }

  /** sounds, things appearing and going (once each) */
  private events(a: Act) {
    const once = (flags: Set<string>, k: string, at: number, fn: () => void) => {
      if (a.t >= at && !flags.has(k)) {
        flags.add(k);
        fn();
      }
    };
    if (a.kind === 'rub') {
      if (a.t >= RUB.pump && !a.pumped) {
        a.pumped = true;
        this.sound('pump', SND.pump, a.d.nozzle, 0.6, 8);
      }
      if (a.t >= RUB.gather - 0.1 && !a.sound) {
        a.sound = true;
        this.sound('rub6', (sr) => SND.rub(sr, STEPS * RUB.step + 0.3), a.d.nozzle, 0.42, 6);
      }
      return;
    }
    if (a.kind === 'wash') {
      const w = a.w;
      const fx = a.fx;
      const f = a.flags;
      const W = WASH;
      const leverAt = fx.lever ? fx.lever.hinge.getWorldPosition(new THREE.Vector3()) : w.basin;
      if (fx.lever) once(f, 'on', W.water - 0.06, () => this.sound('lever', SND.lever, leverAt, 0.5, 6));
      // the water: on and off as the tap (or a sensor) says
      const on = waterOn(fx, a.t);
      if (on !== a.water) {
        a.water = on;
        if (on) {
          this.water?.stop(0.05);
          const a2 = sharedAudio(false);
          if (a2) {
            let b = this.buffers.get('water');
            if (!b) {
              const pcm = SND.water(a2.ctx.sampleRate);
              b = a2.ctx.createBuffer(1, pcm.length, a2.ctx.sampleRate);
              b.getChannelData(0).set(pcm);
              this.buffers.set('water', b);
            }
            this.water = playSound(b, {
              at: { x: w.basin.x, y: w.basin.y, z: w.basin.z },
              gain: 0.5,
              range: 9,
              loop: true,
            });
          }
        } else {
          this.water?.stop(0.25);
          this.water = null;
        }
      }
      once(f, 'pump', W.press + 0.1, () => this.sound('pump', SND.pump, fx.soap.nozzle, 0.55, 8));
      once(f, 'lather', W.lather + 0.1, () => this.sound('lather', (sr) => SND.lather(sr, STEPS * W.step), w.basin, 0.5, 6));
      if (fx.lever) once(f, 'off', W.waterOff - 0.05, () => this.sound('lever', SND.lever, leverAt, 0.5, 6));
      if (fx.towel) once(f, 'towel', W.closed, () => this.sound('towel', SND.towel, fx.towel!.slot, 0.5, 6));
      if (fx.bin) once(f, 'lid', W.close + 0.08, () => this.sound('binLid', SND.binLid, fx.bin!.into, 0.5, 8));
      return;
    }
    if (a.kind === 'maskOn') {
      once(a.flags, 'loopR', MASK_ON.on - 0.12, () => this.sound('elastic', SND.elastic, this.headPos(), 0.35, 4));
      once(a.flags, 'loopL', MASK_ON.on + 0.02, () => this.sound('elastic', SND.elastic, this.headPos(), 0.3, 4));
      return;
    }
    if (a.kind === 'glovesOn') {
      once(a.flags, 'snapL', G_ON.tug, () => this.sound('elastic', SND.elastic, this.headPos().setY(this.headPos().y - 0.4), 0.3, 4));
      once(a.flags, 'snapR', G_ON.tug2, () => this.sound('elastic', SND.elastic, this.headPos().setY(this.headPos().y - 0.4), 0.3, 4));
      return;
    }
    if (a.kind === 'glovesOff') {
      if (a.bin?.lid) once(a.flags, 'lid', G_OFF.land, () => this.sound('binLid', SND.binLid, a.bin!.into, 0.5, 8));
      return;
    }
    if (a.kind === 'gloveToss') {
      if (a.bin.lid) once(a.flags, 'lid', 0.82, () => this.sound('binLid', SND.binLid, a.bin.into, 0.5, 8));
      return;
    }
    if (a.kind === 'maskOff' && a.bin?.lid) once(a.flags, 'lid', MASK_OFF.end - 0.05, () => this.sound('binLid', SND.binLid, a.bin!.into, 0.5, 8));
  }

  private finish(a: Act) {
    this.act = null;
    this.fp.hide();
    if (a.kind === 'sleevesDown') {
      this.sleevesDown();
      return;
    }
    this.hideEffects();
    this.recordedAt = this.time;
    if (a.kind === 'rub') {
      this.d.record('rub', a.d.id);
      this.d.hint('Hands clean (alcohol rub). Before and after every patient: WHO moments 1 and 4', 3500);
    } else if (a.kind === 'wash') {
      this.water?.stop(0.2);
      this.water = null;
      this.d.record('wash', a.w.id);
      this.d.hint("Hands washed and dried. Soap and water when they're soiled, and for C. diff or norovirus", 3500);
    } else if (a.kind === 'glovesOn') {
      this.gloved = true;
      this.d.record('gloves_on', a.src.id);
      this.d.hint('Gloves on, a fresh pair · [G] takes them off (inside out, into the bin)', 4000);
    } else if (a.kind === 'glovesOff') {
      this.gloved = false;
      if (a.bin?.lid) a.bin.lid.rotation.x = 0;
      if (a.bin) {
        this.d.record('gloves_off', a.bin.id);
        this.d.hint('Gloves off inside out and binned. Now clean your hands: an alcohol rub', 4200);
      } else {
        this.d.record('gloves_off', 'held');
        this.bundle = true;
        this.d.hint('Gloves off inside out: bin them (E on a bin, or [G] beside one), then clean your hands', 5000);
      }
    } else if (a.kind === 'gloveToss') {
      this.bundle = false;
      if (a.bin.lid) a.bin.lid.rotation.x = 0;
      this.d.hint('In the bin. Now clean your hands: an alcohol rub', 3500);
    } else if (a.kind === 'maskOn') {
      this.masked = true;
      this.wearMask(true);
      this.d.record('mask_on', a.src.id);
      this.d.hint('Mask on · [M] to take it off (it goes in the bin: a fresh one next time)', 4500);
    } else {
      this.masked = false;
      this.dropMask();
      this.d.record('mask_off', a.bin?.id ?? 'bin');
      this.d.hint(a.bin ? 'Mask off by the loops and into the bin. Now clean your hands' : 'Mask off by the loops and binned. Now clean your hands', 4000);
    }
    if (a.kind === 'wash') this.endWash(a);
    if (a.kind === 'maskOff' && a.bin?.lid) a.bin.lid.rotation.x = 0;
    // done with your hands: the sleeves back down (in third person you see it done)
    if ((a.kind === 'rub' || a.kind === 'wash') && this.sleeves?.anyUp) {
      if (this.tp()) this.act = { kind: 'sleevesDown', t: 0 };
      else this.sleevesDown();
    }
  }

  /** the sleeves down now: pulled down (that act done or cut short), or out of sight in first person */
  private sleevesDown() {
    this.sleeves?.set('L', false);
    this.sleeves?.set('R', false);
  }

  /** something else to do while the sleeves are being pulled down: they're down, and it goes ahead */
  private interrupt() {
    if (this.act?.kind !== 'sleevesDown') return;
    this.act = null;
    this.sleevesDown();
  }

  /** a wash over (done or cut off): the fixture back at rest, no foam left, the skin drying off */
  private endWash(a: Extract<Act, { kind: 'wash' }>) {
    this.washFx.restore(a.w.fx);
    this.washFx.hide();
    this.stepping = false;
    this.look = null;
    for (const side of ['R', 'L'] as HandSide[])
      for (const k of ['palm', 'back', 'fingers', 'thumb', 'tips'] as const) {
        this.tpRig?.setLather(side, k, 0);
        this.fp.setLather(side, k, 0);
      }
    this.wetAfter = wetness(Math.min(a.t, WASH.end), !!a.fx.towel);
    this.stepSpeed = 0;
    for (const side of ['R', 'L'] as HandSide[]) this.tpRig?.setWet(side, this.wetAfter);
  }

  private cancel() {
    const a = this.act;
    this.act = null;
    this.approach = null;
    this.prep = null;
    if (a?.kind === 'sleevesDown' || a?.kind === 'rub' || a?.kind === 'wash') this.sleevesDown();
    if (a?.kind === 'sleevesDown') {
      this.fp.hide();
      return;
    }
    this.fp.hide();
    this.hideEffects();
    this.water?.stop(0.15);
    this.water = null;
    if (a?.kind === 'maskOn' && !this.masked) this.dropMask();
    // (gloves half on or half off: as they were)
    if ((a?.kind === 'glovesOff' || a?.kind === 'gloveToss') && 'bin' in a && a.bin?.lid) a.bin.lid.rotation.x = 0;
    if (a?.kind === 'wash') this.endWash(a);
    this.d.hint(a?.kind === 'maskOn' ? 'Stopped: no mask on' : 'Stopped before you were done: not counted', 2200);
  }

  /**
   * G with nothing in your hands (World): gloves off, inside out, into a bin within reach; a used pair
   * held: into a bin beside you. True when it was ours.
   */
  get handAction() { return !!this.act; }
  get usedGloves() { return this.bundle; }
  set usedGloves(held: boolean) { this.bundle = held; }

  dropKey(): boolean {
    this.interrupt();
    if (this.act) return this.gloved || this.bundle || this.act.kind === 'gloveToss';
    const pos = new THREE.Vector3(this.d.controller.pos.x, this.d.controller.y, this.d.controller.pos.y);
    if (this.gloved) {
      const bin = this.nearestBin(pos, this.level(), 2.2);
      // (in front of you, at chest height: the hands come up there)
      const f = new THREE.Vector3(Math.sin(this.d.controller.facing), 0, Math.cos(this.d.controller.facing));
      this.start({ kind: 'glovesOff', t: 0, bin, flags: new Set() }, null, pos.clone().addScaledVector(f, 1).setY(pos.y + 1.1), f.clone().negate());
      return true;
    }
    if (this.bundle) {
      const bin = this.nearestBin(pos, this.level(), 2.2);
      if (bin) this.tossGloves(bin);
      else this.d.hint('No bin in reach: go to one, then [G] (or E on it)', 2600);
      return true;
    }
    return false;
  }

  /** the used pair into a bin (from the hand) */
  private tossGloves(bin: Bin) {
    if (this.act) return;
    const from = this.bundleObj?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(this.d.controller.pos.x, this.d.controller.y + 1.0, this.d.controller.pos.y);
    this.act = { kind: 'gloveToss', t: 0, bin, from, flags: new Set() };
    this.approach = null;
  }

  /** a toss into the bin: the hand out toward it, letting go */
  private tossFrame(t: number, F: Frame, rest: Record<HandSide, HandPose>, bin: Bin): Record<HandSide, HandPose> {
    const to = bin.into.clone().addScaledVector(UP, 0.42);
    const sh = F.sh.L;
    const reach = sh.clone().lerp(to, Math.min(1, 0.5 / Math.max(0.01, sh.distanceTo(to))));
    const out: HandPose = { p: reach, q: palmQuat('L', to.clone().sub(sh).setY(-0.3), UP.clone().negate()), fingers: t < 0.45 ? pose(0.45, 0.02, 0.4, 0.4) : pose(0.05, 0.1, 0.1, 0.1), w: 1 };
    return { R: rest.R, L: blend(blend(rest.L, out, ramp(t, 0, 0.4)), rest.L, ramp(t, 0.6, 0.95)) };
  }

  /** where the glove-taking hand's pinch is, as it takes one (tests) */
  private glovePinch: { hand: string; pinch: number[]; slot: number[]; dist: number } | null = null;

  /** the gloves on the hands as they go on or come off, what's held, the bin's lid */
  private gloveEffects(a: Extract<Act, { kind: 'glovesOn' | 'glovesOff' | 'gloveToss' }>, tp: boolean) {
    const rig: HandRig | null = tp ? this.tpRig : this.fp;
    if (!rig) return;
    const t = a.t;
    if (a.kind === 'glovesOn') {
      for (const side of ['R', 'L'] as HandSide[]) rig.setGloves(side, gloveOnK(side, t));
      this.gloveFx.on(t, rig);
      const taking: HandSide = t < G_ON.tug ? 'R' : 'L';
      const p = rig.point(taking, 'pinch', new THREE.Vector3());
      const r3 = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(4));
      this.glovePinch = { hand: taking, pinch: r3(p), slot: r3(a.src.slot), dist: +p.distanceTo(a.src.slot).toFixed(4) };
    } else if (a.kind === 'glovesOff') {
      for (const side of ['R', 'L'] as HandSide[]) rig.setGloves(side, gloveOffK(side, t));
      this.gloveFx.off(t, rig, a.bin?.into ?? null);
      if (a.bin?.lid) a.bin.lid.rotation.x = -1.15 * ramp(t, G_OFF.over - 0.15, G_OFF.over) * (1 - ramp(t, G_OFF.land + 0.05, G_OFF.endBin));
    } else {
      this.gloveFx.toss(a.from, a.bin.into, ramp(t, 0.45, 0.82));
      if (this.bundleObj) this.bundleObj.visible = t < 0.45;
      if (a.bin.lid) a.bin.lid.rotation.x = -1.15 * ramp(t, 0.2, 0.4) * (1 - ramp(t, 0.85, 0.95));
    }
  }

  /** the third-person hands' layers for this avatar (gloves stay on between acts), and its sleeves */
  private ensureTpRig() {
    if (!this.tp()) return;
    this.rigAvatar();
  }

  /** the hands' layers and the sleeves, built for the avatar in use (again when it changes) */
  private rigAvatar() {
    const av = this.d.avatar();
    if (!av?.ready) return;
    if (!this.tpRig || this.tpRigFor !== av.root) {
      this.tpRig?.dispose();
      this.sleeves?.dispose();
      this.tpRig = new TpHandLayers(av.root, av.height / 1.78);
      this.sleeves = new SleeveRoll(av.root);
      this.tpRigFor = av.root;
    }
  }

  /** between acts: gloves as they are (and as the server has them after a reload), a used pair in the hand */
  private syncGloves() {
    if (!this.act && this.viewGloved !== undefined && this.time - this.recordedAt > 3 && this.viewGloved !== this.gloved) this.gloved = this.viewGloved;
    if (this.act && (this.act.kind === 'glovesOn' || this.act.kind === 'glovesOff')) return;
    if (this.gloved || this.tpRig) {
      this.ensureTpRig();
      for (const side of ['R', 'L'] as HandSide[]) this.tpRig?.setGloves(side, this.gloved ? 1 : 0);
    }
    // the used pair in the left hand (third person)
    const hold = this.bundle && !(this.act?.kind === 'gloveToss' && this.act.t >= 0.45);
    if (hold && !this.bundleObj && this.tp()) {
      // (at its real size: a held thing is scaled back to metres in the grip)
      const b = new THREE.Mesh(this.gloveFx.bundle.geometry.clone().scale(0.08, 0.067, 0.067), this.gloveFx.bundle.material);
      if (this.d.hands.mount('L', b, 'can', new THREE.Vector3(0.08, 0.067, 0.067), new THREE.Vector3(0, 0, 0))) this.bundleObj = b;
      else b.geometry.dispose();
    } else if ((!hold || !this.tp()) && this.bundleObj) {
      this.d.hands.unmount(this.bundleObj);
      this.bundleObj.geometry.dispose();
      this.bundleObj = null;
    }
  }

  private hideEffects() {
    this.gel.visible = false;
    this.gloveFx.hide();
    this.washFx.hide();
    this.flatMask.visible = false;
  }

  // ───────────────────────────── frames ─────────────────────────────

  private frameTp(): Frame | null {
    const hands = this.d.hands;
    const o = new THREE.Vector3();
    const f = new THREE.Vector3();
    const r = new THREE.Vector3();
    const { k } = hands.body(o, f, r);
    const sR = hands.shoulder('R', new THREE.Vector3());
    const sL = hands.shoulder('L', new THREE.Vector3());
    if (!sR || !sL) return null;
    const c = sR
      .clone()
      .add(sL)
      .multiplyScalar(0.5)
      .addScaledVector(UP, -0.3 * k)
      .addScaledVector(f, 0.3 * k);
    return { c, r, u: UP.clone(), f, sh: { R: sR, L: sL }, k, tp: true };
  }

  private frameFp(): Frame {
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const r = new THREE.Vector3(e[0], e[1], e[2]);
    const u = new THREE.Vector3(e[4], e[5], e[6]);
    const f = new THREE.Vector3(-e[8], -e[9], -e[10]);
    const c = cam.position.clone().addScaledVector(u, -0.11).addScaledVector(f, 0.4);
    // the shoulders hang below the eyes whichever way you look, further behind them the further down
    return { c, r, u, f, sh: fpShoulders(cam), k: 1, tp: false };
  }

  /** both hands at this moment of the act, in a frame; `rig` the hands drawn (where their points are) */
  private poses(a: Act, F: Frame, rig: HandRig | null = null): Record<HandSide, HandPose> {
    const rest = { R: restPose(F, 'R'), L: restPose(F, 'L') };
    const t = a.t;
    if (this.prep && F.tp) return this.sleevePoses(this.prep.t, F, rest, PUSH, false);
    if (a.kind === 'sleevesDown') return F.tp ? this.sleevePoses(t, F, rest, PULL, true) : rest;
    if (a.kind === 'rub') return this.rubFrame(t, F, rest, a.d);
    if (a.kind === 'wash') return washPoses(t, a.fx, F, rest, this.offsets(rig), a.ts, this.walkOf(a));
    if (a.kind === 'glovesOn') return glovesOnPoses(t, a.src, F, rest, this.offsets(rig));
    if (a.kind === 'glovesOff') return glovesOffPoses(t, F, rest, this.offsets(rig), a.bin?.into ?? null);
    if (a.kind === 'gloveToss') return this.tossFrame(t, F, rest, a.bin);
    if (a.kind === 'maskOn') return this.maskOnFrame(t, F, rest, a.src);
    return this.maskOffFrame(t, F, rest, a.bin);
  }

  /**
   * At a dispenser: the right hand cupped palm up under the nozzle, fingers toward the wall; the heel
   * of the left on the push plate, fingers up, pressing it in by `push` (0..1).
   */
  private pumpPoses(F: Frame, d: Dispenser, push: number): Record<HandSide, HandPose> {
    const n = d.n;
    const side = new THREE.Vector3().crossVectors(UP, n).normalize(); // along the wall, to the left as you face it
    const cup: HandPose = {
      p: d.nozzle.clone().addScaledVector(UP, -0.075).addScaledVector(n, 0.07).addScaledVector(side, -0.01),
      q: palmQuat('R', n.clone().negate().addScaledVector(side, -0.25), UP),
      fingers: CUP,
      w: 1,
      pole: F.sh.R.clone().addScaledVector(UP, -0.6).addScaledVector(F.r, 0.3),
    };
    const pr: HandPose = {
      p: d.plate
        .clone()
        .addScaledVector(UP, -0.045)
        .addScaledVector(n, 0.03 - 0.016 * push)
        .addScaledVector(side, 0.012),
      q: palmQuat('L', UP.clone().addScaledVector(n, 0.15), n.clone().negate()),
      fingers: pose(0.12, 0.03, 0.1, 0.05),
      w: 1,
      pole: F.sh.L.clone().addScaledVector(UP, -0.6).addScaledVector(F.r, -0.3),
    };
    return { R: cup, L: pr };
  }

  /** the pump and the rub: reach (from `rest`), press, gather the hands, the six steps, until dry */
  private rubFrame(t: number, F: Frame, rest: Record<HandSide, HandPose>, d: Dispenser): Record<HandSide, HandPose> {
    const R = RUB;
    const push = t > R.press && t < R.release ? Math.sin(Math.PI * clamp01((t - R.press) / (R.release - R.press))) : 0;
    const pump = this.pumpPoses(F, d, push);
    if (t < R.release) {
      const k = ramp(t, R.reach * 0.5, R.press - 0.08);
      return { R: blend(rest.R, pump.R, k), L: blend(rest.L, pump.L, k) };
    }
    const rubs = rubPoses(levelled(F), Math.max(0, t - R.gather), R.step);
    if (t < R.gather) {
      const k = ramp(t, R.release, R.gather);
      return { R: blend(pump.R, rubs.R, k), L: blend(pump.L, rubs.L, k) };
    }
    // until dry: apart a little, then down
    const k = ramp(t, R.end - 0.45, R.end);
    return { R: blend(rubs.R, rest.R, k), L: blend(rubs.L, rest.L, k) };
  }

  private headPos(): THREE.Vector3 {
    const av = this.d.avatar();
    if (av?.ready) return av.head.getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3(this.d.controller.pos.x, this.d.controller.y + 1.62, this.d.controller.pos.y);
  }

  /** the face: where the mask goes, which way it looks, its up (the head bone; first person: the camera) */
  private face(F: Frame): {
    p: THREE.Vector3;
    f: THREE.Vector3;
    u: THREE.Vector3;
    r: THREE.Vector3;
  } {
    const hands = this.d.hands;
    const fwd = new THREE.Vector3();
    const up = new THREE.Vector3();
    // (in the head bone's frame the lips are ~12 cm forward, 2 cm up: hands.ts facePoint)
    const p = F.tp ? hands.facePoint(0.04, 0.115, new THREE.Vector3(), fwd, up) : null;
    if (p) {
      const r = new THREE.Vector3().crossVectors(fwd, up).normalize();
      return { p, f: fwd, u: up, r };
    }
    const cam = this.d.camera;
    return {
      p: cam.position.clone().addScaledVector(F.u, -0.075).addScaledVector(F.f, 0.06),
      f: F.f.clone(),
      u: F.u.clone(),
      r: F.r.clone(),
    };
  }

  /** a surgical mask: out of the box, up to the face, the loops over the ears, the nose wire pinched */
  private maskOnFrame(t: number, F: Frame, rest: Record<HandSide, HandPose>, src: MaskSource): Record<HandSide, HandPose> {
    const M = MASK_ON;
    const face = this.face(F);
    // a pinch at the slot: from the front (a wall box), from above (a box on a counter)
    const into = src.top ? UP.clone().negate().addScaledVector(src.n, -0.3).normalize() : src.n.clone().negate();
    const takeP = src.slot
      .clone()
      .addScaledVector(into, -0.075)
      .addScaledVector(UP, src.top ? 0 : -0.015);
    const take: HandPose = {
      p: takeP,
      q: palmQuat('R', into.clone().addScaledVector(UP, src.top ? 0 : -0.15), new THREE.Vector3().crossVectors(UP, src.n).normalize().negate()),
      fingers: PINCH,
      w: 1,
    };
    // holding it up in front of the face by its two loops
    const hold = (side: HandSide, out: number, spread: number): HandPose => {
      const s = side === 'R' ? 1 : -1;
      // (r: the face's right as seen from behind; the right hand on the right)
      const p = face.p
        .clone()
        .addScaledVector(face.f, out)
        .addScaledVector(face.r, s * spread)
        .addScaledVector(face.u, -0.03);
      return {
        p,
        q: palmQuat(side, face.u.clone().addScaledVector(face.f, 0.3), face.r.clone().multiplyScalar(-s)),
        fingers: PINCH,
        w: 1,
        pole: F.sh[side]
          .clone()
          .addScaledVector(UP, -0.4)
          .addScaledVector(F.r, s * 0.5),
      };
    };
    // at the ears: fingertips up and back over the top of each ear, hooking the loop behind it
    const ear = (side: HandSide): HandPose => {
      const s = side === 'R' ? 1 : -1;
      const fingers = face.u.clone().multiplyScalar(0.6).addScaledVector(face.f, -0.7).normalize();
      const tip = face.p
        .clone()
        .addScaledVector(face.r, s * 0.095)
        .addScaledVector(face.f, -0.115)
        .addScaledVector(face.u, 0.055);
      const p = tip.addScaledVector(fingers, -0.135).addScaledVector(face.r, s * 0.015);
      return {
        p,
        q: palmQuat(side, fingers, face.r.clone().multiplyScalar(-s)),
        fingers: PINCH,
        w: 1,
        pole: F.sh[side]
          .clone()
          .addScaledVector(face.r, s * 0.4)
          .addScaledVector(UP, -0.25),
      };
    };
    // the nose wire: the index fingertips pressing it either side of the bridge, palms to the face
    const nose = (side: HandSide): HandPose => {
      const s = side === 'R' ? 1 : -1;
      const fingers = face.u
        .clone()
        .addScaledVector(face.r, -s * 0.35)
        .addScaledVector(face.f, 0.1)
        .normalize();
      const bridge = face.p
        .clone()
        .addScaledVector(face.u, 0.065)
        .addScaledVector(face.f, 0.012)
        .addScaledVector(face.r, s * 0.02);
      const p = bridge.addScaledVector(fingers, -0.15).addScaledVector(face.f, 0.02);
      return {
        p,
        q: palmQuat(
          side,
          fingers,
          face.f
            .clone()
            .negate()
            .addScaledVector(face.r, -s * 0.3),
        ),
        fingers: pose(0.22, 0.02, 0.35, 0.3),
        w: 1,
        pole: F.sh[side]
          .clone()
          .addScaledVector(UP, -0.5)
          .addScaledVector(F.r, s * 0.25),
      };
    };
    // (first person: held a little further off and wider, so the mask shows between the hands)
    const [far, near, wide] = F.tp ? [0.2, 0.06, 0.06] : [0.3, 0.1, 0.1];
    if (t < M.take)
      return {
        R: blend(rest.R, take, ramp(t, M.reach * 0.5, M.take - 0.05)),
        L: rest.L,
      };
    if (t < M.lift) {
      const k = ramp(t, M.take, M.lift);
      return {
        R: blend(take, hold('R', far, wide), k),
        L: blend(rest.L, hold('L', far, wide), ramp(t, M.take + 0.1, M.lift)),
      };
    }
    if (t < M.don) {
      const k = ramp(t, M.lift, M.don);
      return {
        R: blend(hold('R', far, wide), hold('R', near, wide + 0.03), k),
        L: blend(hold('L', far, wide), hold('L', near, wide + 0.03), k),
      };
    }
    if (t < M.on) {
      const k = ramp(t, M.don, M.on);
      return {
        R: blend(hold('R', near, wide + 0.03), ear('R'), k),
        L: blend(hold('L', near, wide + 0.03), ear('L'), k),
      };
    }
    if (t < M.down) {
      const k = ramp(t, M.on, M.pinch + 0.15);
      const press = Math.sin(Math.PI * clamp01((t - M.pinch - 0.1) / 0.35)) * 0.008;
      const nR = nose('R');
      const nL = nose('L');
      nR.p.addScaledVector(face.r, -press);
      nL.p.addScaledVector(face.r, press);
      return { R: blend(ear('R'), nR, k), L: blend(ear('L'), nL, k) };
    }
    const k = ramp(t, M.down, M.end);
    return { R: blend(nose('R'), rest.R, k), L: blend(nose('L'), rest.L, k) };
  }

  /** off by the loops (never the front), held away, into the bin */
  private maskOffFrame(t: number, F: Frame, rest: Record<HandSide, HandPose>, bin: Bin | null): Record<HandSide, HandPose> {
    const M = MASK_OFF;
    const face = this.face(F);
    const ear = (side: HandSide, out: number): HandPose => {
      const s = side === 'R' ? 1 : -1;
      const p = face.p
        .clone()
        .addScaledVector(face.r, s * (0.11 - out * 0.2))
        .addScaledVector(face.f, -0.13 + out)
        .addScaledVector(face.u, 0.03 - out * 0.2);
      return {
        p,
        q: palmQuat(side, face.u.clone().addScaledVector(face.f, 0.4), face.r.clone().multiplyScalar(-s)),
        fingers: PINCH,
        w: 1,
        pole: F.sh[side]
          .clone()
          .addScaledVector(face.r, s * 0.4)
          .addScaledVector(UP, -0.1),
      };
    };
    if (t < M.ears)
      return {
        R: blend(rest.R, ear('R', 0), ramp(t, 0, M.ears)),
        L: blend(rest.L, ear('L', 0), ramp(t, 0, M.ears)),
      };
    if (t < M.toss) {
      const k = ramp(t, M.ears, M.lift);
      return {
        R: blend(ear('R', 0), ear('R', 0.28), k),
        L: blend(ear('L', 0), ear('L', 0.28), k),
      };
    }
    const drop: HandPose = bin
      ? {
          p: bin.into.clone().addScaledVector(UP, 0.3),
          q: palmQuat('R', bin.into.clone().sub(F.sh.R).setY(-0.5), UP.clone().negate()),
          fingers: OPEN,
          w: 1,
        }
      : rest.R;
    const k = ramp(t, M.toss, M.land);
    return {
      R: blend(ear('R', 0.28), drop, k),
      L: blend(ear('L', 0.28), rest.L, ramp(t, M.toss, M.toss + 0.3)),
    };
  }

  /** third person: the arms and fingers, before the hands are solved (hands.apply) */
  private poseTp(a: Act) {
    const F = this.frameTp();
    if (!F) return;
    const P = this.poses(a, F, a.kind === 'wash' || a.kind === 'glovesOn' || a.kind === 'glovesOff' ? this.tpRig : null);
    for (const side of ['R', 'L'] as HandSide[]) {
      const h = P[side];
      if (h.w < 0.01) continue;
      if (h.w > 0.5) this.ikWant[side] = h.p.clone();
      this.d.hands.reach(side, {
        target: h.p,
        quat: h.q,
        pole:
          h.pole ??
          F.sh[side]
            .clone()
            .addScaledVector(UP, -0.55)
            .addScaledVector(F.f, -0.25)
            .addScaledVector(F.r, (side === 'R' ? 1 : -1) * 0.35),
        weight: h.w,
      });
      // (Rocketbox fingers: a cup grip is curl ≈ 1; flat hands straighten the mocap's relaxed ones)
      this.d.hands.fingers(side, h.fingers.curl * 2.2 - 0.35, h.fingers.thumb * 2 - 0.2);
    }
  }

  /** after the arms are posed and the camera placed: first-person hands, gel, water, foam, towel, the mask */
  afterPose(dt: number) {
    const a = this.act;
    const tp = this.tp();
    if (!a) {
      this.fp.hide();
      return;
    }
    let P: Record<HandSide, HandPose> | null = null;
    if (!tp) {
      if (a.kind === 'wash') this.washCameraFp(a, dt);
      const F = this.frameFp();
      // a wash places hands by what they touch: a second pass with the fingers as they're posed now
      const contacts = a.kind === 'wash' || a.kind === 'glovesOn' || a.kind === 'glovesOff';
      for (let pass = 0; pass < (contacts ? 2 : 1); pass++) {
        P = this.poses(a, F, contacts ? this.fp : null);
        for (const side of ['R', 'L'] as HandSide[]) {
          const h = P[side];
          // (at the ears or the nose the hands are beside the eyes, out of sight: not drawn)
          const near = h.p.clone().sub(this.d.camera.position).dot(F.f) < 0.12;
          if ((h.w < 0.02 && a.kind !== 'maskOff') || near) this.fp.hideSide(side);
          else {
            // never further than an arm's length from the shoulder (something in the way kept you back)
            const sh = F.sh[side];
            const d = h.p.distanceTo(sh);
            const reach = h.reach ?? FP_REACH;
            this.fp.set(side, d > reach ? sh.clone().lerp(h.p, reach / d) : h.p, h.q, h.fingers, sh);
          }
        }
      }
    } else this.fp.hide();
    const palm = (side: HandSide, out = new THREE.Vector3()) => {
      if (!tp) return this.fp.palm(side, out);
      const q = new THREE.Quaternion();
      if (!this.d.hands.handFrame(side, out, q)) return out;
      return out.add(new THREE.Vector3(0.075 * this.d.hands.scale, 0.02 * this.d.hands.scale, 0).applyQuaternion(q));
    };
    // the rub's gel in the right palm, spreading as it's rubbed in
    if (a.kind === 'rub') {
      const k = a.t >= RUB.pump && a.t < RUB.gather + RUB.step * 2 ? 1 - ramp(a.t, RUB.pump + 0.4, RUB.gather + RUB.step * 2) : 0;
      this.gel.visible = k > 0.02;
      if (this.gel.visible) {
        palm('R', this.gel.position);
        this.gel.scale.setScalar(0.4 + 0.6 * k);
      }
    }
    if (a.kind === 'wash') {
      const rig: HandRig | null = tp ? this.tpRig : this.fp;
      if (rig) this.washFx.update(a.t, dt, a.fx, rig, a.ts, this.d.controller.y);
    }
    if (tp && this.tpRig && (a.kind === 'wash' || a.kind === 'glovesOn' || a.kind === 'glovesOff')) this.measureTp(this.tpRig);
    // the sleeves pushed up or pulled down: where each arm is now that it's solved (the hand follows it next frame)
    if (tp && (this.prep || a.kind === 'sleevesDown')) {
      for (const side of ['R', 'L'] as HandSide[]) {
        const d = (this.armDrawn[side] ??= { W: new THREE.Vector3(), E: new THREE.Vector3(), Q: new THREE.Quaternion() });
        if (!this.d.hands.handFrame(side, d.W, d.Q) || !this.d.hands.elbow(side, d.E)) delete this.armDrawn[side];
      }
    } else this.armDrawn = {};
    if (a.kind === 'glovesOn' || a.kind === 'glovesOff' || a.kind === 'gloveToss') this.gloveEffects(a, tp);
    // (gloved hands stay gloved whatever else they do)
    else if (!tp) for (const side of ['R', 'L'] as HandSide[]) this.fp.setGloves(side, this.gloved ? 1 : 0);
    if (a.kind === 'maskOn' || a.kind === 'maskOff') this.maskEffects(a, P, palm);
  }

  /**
   * First person at a sink: the eyes go where leaning over it puts them (forward, a little down), and
   * the view follows the work (the stream, the nozzle, the towel's tail, the bin), eased.
   */
  private washCameraFp(a: Extract<Act, { kind: 'wash' }>, dt: number) {
    const fx = a.fx;
    const cam = this.d.camera;
    const ctl = this.d.controller;
    // (at the towels the eyes don't go as far forward: the dispenser's on the wall right there;
    // walking over, you're upright)
    const W = WASH;
    const lean = washLean(a.t, fx) * (1 - (1 - TOWEL_LEAN_FP) * ramp(a.t, W.towel - 0.2, W.towel + 0.3) * (1 - ramp(a.t, W.bin, W.bin + 0.3))) * (1 - this.walking(a));
    const into = fx.f.clone().negate();
    cam.position.addScaledVector(into, 0.45 * Math.sin(lean)).addScaledVector(UP, -0.45 * (1 - Math.cos(lean)));
    const hands = cam.position.clone().addScaledVector(into, 0.35).addScaledVector(UP, -0.5);
    const d = washFocus(a.t, fx, hands).sub(cam.position);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.35, 0.4);
    if (!this.look) this.look = { yaw: ctl.yaw, pitch: ctl.pitch };
    const k = 1 - Math.exp(-dt * (this.holdT !== null ? 20 : 8));
    this.look.yaw = lerpAngle(this.look.yaw, yaw, k);
    this.look.pitch += (pitch - this.look.pitch) * k;
    ctl.yaw = this.look.yaw;
    ctl.pitch = this.look.pitch;
    cam.rotation.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }

  /** a hand's world orientation as drawn now (its +Y out of the palm): first-person hands or the avatar's */
  private handQuat(side: HandSide, out: THREE.Quaternion): boolean {
    if (!this.tp()) return this.fp.quat(side, out);
    return this.d.hands.handFrame(side, this.v1, out);
  }

  private fpOff(side: HandSide) {
    // out of view: park it under the camera
    const F = this.frameFp();
    const r = restPose(F, side);
    this.fp.set(side, r.p.addScaledVector(F.u, -0.3), r.q, OPEN, F.sh[side]);
  }

  private maskEffects(a: Extract<Act, { kind: 'maskOn' | 'maskOff' }>, P: Record<HandSide, HandPose> | null, palm: (side: HandSide, out?: THREE.Vector3) => THREE.Vector3) {
    const tp = this.tp();
    const fm = this.flatMask;
    const cam = this.d.camera;
    /** the folded mask across both palms, facing the camera (first person) */
    const between = () => {
      const pR = palm('R', new THREE.Vector3());
      const pL = palm('L', new THREE.Vector3());
      fm.position.copy(pR).add(pL).multiplyScalar(0.5);
      fm.quaternion.copy(cam.quaternion);
      const dist = fm.position.distanceTo(cam.position);
      fm.visible = dist > 0.13;
    };
    if (a.kind === 'maskOn') {
      const M = MASK_ON;
      if (a.t >= M.take - 0.08 && a.t < M.lift) {
        fm.visible = true;
        palm('R', fm.position);
        if (tp) this.d.hands.handFrame('R', this.v1, fm.quaternion);
        else fm.quaternion.copy(P?.R.q ?? this.q1);
        fm.rotateY(Math.PI / 2);
      } else if (!tp && a.t >= M.lift && a.t < M.on) between();
      else fm.visible = false;
      if (a.t >= M.lift) {
        this.wearMask(false);
        this.offsetMask((1 - ramp(a.t, M.lift + 0.15, M.on)) * 0.17);
      }
      return;
    }
    const M = MASK_OFF;
    if (a.t < M.ears || !this.maskObj) return;
    if (a.t < M.toss) {
      this.offsetMask(ramp(a.t, M.ears, M.lift) * 0.22);
      if (!tp) between();
      return;
    }
    // let go over the bin: it drops in
    const k = ramp(a.t, M.toss, M.land);
    if (tp) {
      this.offsetMask(0.22, a.bin ? a.bin.into : null, k);
      this.maskObj.visible = k < 0.98;
    } else {
      const from = palm('R', new THREE.Vector3());
      if (a.bin) fm.position.copy(from).lerp(a.bin.into, k);
      fm.visible = !!a.bin && k < 0.98;
    }
    if (a.bin?.lid) a.bin.lid.rotation.x = -1.15 * (ramp(a.t, M.ears, M.toss) * (1 - ramp(a.t, M.land, M.end)));
  }

  // ───────────────────────────── the mask on the face ─────────────────────────────

  /** the fitted mask on the head bone (onFace: as worn; false: held in front, offsetMask places it) */
  private wearMask(onFace: boolean) {
    const av = this.d.avatar();
    if (!av?.ready) return;
    if (!this.maskObj) {
      const prop = buildProp('mask', { fit: maskFitFor(this.d.face()) });
      if (!prop) return;
      this.maskObj = prop.obj;
      this.maskObj.name = 'player:mask';
      av.attach(this.maskObj, 'head');
      this.maskBase = this.maskObj.position.clone();
    }
    if (onFace) {
      this.maskObj.position.copy(this.maskBase);
      // (first person never shows it: the avatar is hidden)
      this.maskObj.visible = true;
    }
  }
  private maskBase = new THREE.Vector3();

  /**
   * Hold the worn mask `out` m in front of the face (the head bone's forward), or carry it toward a
   * point (`to`, world) by k: off the face into the bin.
   */
  private offsetMask(out: number, to: THREE.Vector3 | null = null, k = 0) {
    const m = this.maskObj;
    const head = this.d.avatar()?.head;
    if (!m || !head || !m.parent) return;
    head.updateWorldMatrix(true, false);
    const bs = head.getWorldScale(this.v1).x || 1;
    // the head bone: Y forward (accessories.ts TO_BONE), units of its own scale
    const local = new THREE.Vector3(0, out / bs, (-out * 0.25) / bs);
    if (to && k > 0) {
      const target = head.worldToLocal(to.clone());
      local.lerp(target, k);
    }
    m.position.copy(this.maskBase).add(local);
  }

  /** off the face: gone (into the bin) */
  private dropMask() {
    if (!this.maskObj) return;
    const av = this.d.avatar();
    if (av) av.detach(this.maskObj);
    else this.maskObj.removeFromParent();
    this.maskObj = null;
  }

  /** a reload (or another tab) wore one: put it on without the show; the server's view is the truth */
  private syncMask() {
    if (this.masked && !this.maskObj) this.wearMask(true);
    // (just put on or taken off here: the server's view catches up in a moment)
    if (this.viewMasked === undefined || this.act || this.time - this.recordedAt < 3) return;
    if (this.viewMasked && !this.masked) {
      this.masked = true;
      this.wearMask(true);
    } else if (!this.viewMasked && this.masked) {
      this.masked = false;
      this.dropMask();
    }
  }
  private recordedAt = -1e9;

  /** the view from the server: precautions on the board, the mask (after a reload) */
  view(v: PlayerView) {
    this.viewMasked = !!v.player.masked;
    this.viewGloved = !!v.player.gloved;
    const want = new Map<string, PrecautionKind>();
    this.nurseOf.clear();
    for (const r of v.board) {
      if (r.precautions && !r.dispo) want.set(r.bed, r.precautions);
      if (r.nurse) this.nurseOf.set(r.bed, r.nurse);
    }
    if (!this.forced) this.setPrecautions(want);
  }
  private forced = false;

  get isMasked(): boolean {
    return this.masked;
  }

  // ───────────────────────────── precautions: stands and reminders ─────────────────────────────

  private setPrecautions(want: Map<string, PrecautionKind>) {
    for (const [room, s] of this.stands) {
      if (want.get(room) === s.kind) continue;
      s.group.removeFromParent();
      const i = this.d.colliders.indexOf(s.collider);
      if (i >= 0) this.d.colliders.splice(i, 1);
      this.stands.delete(room);
    }
    for (const [room, kind] of want) {
      if (this.stands.has(room)) continue;
      const e = this.entrances.find((x) => x.room === room);
      if (!e?.out) continue;
      this.stands.set(room, this.buildStand(room, kind, e));
    }
    this.precautions = want;
  }

  /**
   * An isolation stand in the corridor beside the room's corridor dispenser, away from the doorway:
   * the sign (kind, what to wear), and for droplet or airborne precautions a box of masks (N95/FFP2
   * respirators for airborne: the same mask model stands in for them here).
   */
  private buildStand(room: string, kind: PrecautionKind, e: HygieneEntrance) {
    const out = e.out!;
    const n = new THREE.Vector3(e.nx, 0, e.nz);
    // along the wall away from the doorway: the dispenser sits on its latch side, or at a bay's doorway end
    const wall = new THREE.Vector3(Math.sin(out.rot), 0, Math.cos(out.rot));
    const along = new THREE.Vector3().crossVectors(UP, wall).normalize();
    const roomC = this.roomCenter(room);
    if (roomC && along.dot(new THREE.Vector3(roomC.x - out.x, 0, roomC.z - out.z)) > 0) along.negate();
    // clear of anything parked there (a workstation cart by a bay's partition)
    let pos = new THREE.Vector3(out.x, 0, out.z).addScaledVector(wall, 0.55).addScaledVector(along, 0.45);
    search: for (const a of [0.45, 0.8, 1.15, 1.5])
      for (const o of [0.55, 0.8]) {
        const p = new THREE.Vector3(out.x, 0, out.z).addScaledVector(wall, o).addScaledVector(along, a);
        if (this.clear(p.x, p.z, 0.26)) {
          pos = p;
          break search;
        }
      }
    const g = new THREE.Group();
    g.position.copy(pos);
    // facing the corridor, the way people come to the room
    g.rotation.y = Math.atan2(wall.x, wall.z);
    g.name = `isolation:${room}`;
    const COLORS: Record<PrecautionKind, string> = {
      contact: '#c77d12',
      droplet: '#2f7d3b',
      airborne: '#2f5ea8',
    };
    const TEXT: Record<PrecautionKind, [string, string[]]> = {
      contact: ['CONTACT PRECAUTIONS', ['Clean hands in and out', 'Gown and gloves for', 'any contact with the', 'patient or the bed space']],
      droplet: ['DROPLET PRECAUTIONS', ['Clean hands in and out', 'Mask required', 'within the room', 'Visitors: see the nurse']],
      airborne: ['AIRBORNE PRECAUTIONS', ['N95/FFP2 respirator', 'before entering', 'Keep the door closed', 'Clean hands in and out']],
    };
    const [title, lines] = TEXT[kind];
    const { canvas, ctx } = makeCanvas(300, 380);
    ctx.fillStyle = '#fdfcf8';
    ctx.fillRect(0, 0, 300, 380);
    ctx.fillStyle = COLORS[kind];
    ctx.fillRect(0, 0, 300, 92);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px ui-sans-serif, system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    for (const [i, w] of title.split(' ').entries()) ctx.fillText(w, 150, 38 + i * 32);
    ctx.fillStyle = '#1f2a33';
    ctx.font = '700 23px ui-sans-serif, system-ui, Arial, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 150, 150 + i * 46));
    ctx.fillStyle = COLORS[kind];
    ctx.fillRect(40, 340, 220, 8);
    const sign = own(
      new THREE.MeshStandardMaterial({
        map: canvasTexture(canvas),
        roughness: 0.45,
      }),
    );
    const grey = lambert('#3a4046', { roughness: 0.45 });
    const alu = lambert('#b9bfc4', { roughness: 0.35, metalness: 0.8 });
    const white = lambert('#eef0f1', { roughness: 0.3 });
    rboxB(g, 0.42, 0.025, 0.42, 0.01, grey, 0, 0, 0);
    rboxB(g, 0.05, 1.86, 0.05, 0.004, alu, 0, 0.025, 0);
    rboxB(g, 0.36, 0.46, 0.012, 0.006, white, 0, 1.38, 0.031);
    add(g, G.plane(0.34, 0.43), sign, 0, 1.61, 0.0392);
    let mask: MaskSource | null = null;
    if (kind !== 'contact') {
      // a box of masks on the post (the slot to the front)
      const box = buildPropBox();
      box.position.set(0, 1.12, 0.025);
      g.add(box);
      const slot = new THREE.Vector3(0, 1.21, 0.15).applyAxisAngle(UP, g.rotation.y).add(pos);
      const mb = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 1.2, 0.09).applyAxisAngle(UP, g.rotation.y).add(pos), new THREE.Vector3(0.3, 0.22, 0.3));
      mask = {
        id: `iso_${room}`,
        level: 0,
        slot,
        n: wall.clone(),
        box: mb,
        center: mb.getCenter(new THREE.Vector3()),
      };
    } else {
      // gloves for contact precautions
      rboxB(g, 0.27, 0.14, 0.12, 0.01, lambert('#d8dde0', { roughness: 0.4 }), 0, 1.12, 0.085);
      rboxB(g, 0.24, 0.12, 0.1, 0.01, lambert('#4d79c7', { roughness: 0.7 }), 0, 1.13, 0.098);
    }
    g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
    this.d.scene.add(g);
    const collider = new THREE.Box3().setFromCenterAndSize(pos.clone().setY(0.95), new THREE.Vector3(0.44, 1.9, 0.44));
    this.d.colliders.push(collider);
    return { kind, group: g, collider, mask };
  }

  private roomCenter(room: string): { x: number; z: number } | null {
    const r = this.d.layout.rooms.find((x) => x.id === room);
    return r ? { x: r.rect.x + r.rect.w / 2, z: r.rect.z + r.rect.d / 2 } : null;
  }

  /** into a room on droplet or airborne precautions without a mask: a nurse nearby says so (once a minute) */
  private remind() {
    const room = this.d.room();
    const entered = room !== this.lastRoom;
    this.lastRoom = room;
    if (!entered) return;
    const kind = this.precautions.get(room);
    const needsMask = (kind === 'droplet' || kind === 'airborne') && !this.masked && this.act?.kind !== 'maskOn';
    const needsGloves = kind === 'contact' && !this.gloved && this.act?.kind !== 'glovesOn';
    if (!needsMask && !needsGloves) return;
    if (this.time - (this.reminded.get(room) ?? -1e9) < 60) return;
    this.reminded.set(room, this.time);
    const label = this.d.layout.rooms.find((r) => r.id === room)?.label ?? room;
    const what = kind === 'airborne' ? 'an N95 respirator' : 'a mask';
    const line = needsGloves
      ? `${label} is on contact precautions: gloves on before you touch her, please, and an apron or gown. The gloves are by the sink.`
      : `${label} is on ${kind} precautions: ${what} on before you go in, please. They're on the stand right outside.`;
    const nurses = this.d.nurses();
    const own = this.nurseOf.get(room);
    const pos = this.d.controller.pos;
    const who =
      nurses.find((n) => n.name === own && Math.hypot(n.x - pos.x, n.z - pos.y) < 14) ??
      nurses.filter((n) => Math.hypot(n.x - pos.x, n.z - pos.y) < 14).sort((p, q) => Math.hypot(p.x - pos.x, p.z - pos.y) - Math.hypot(q.x - pos.x, q.z - pos.y))[0];
    if (who) this.d.say(who.id, line);
    this.d.hint(`${who ? `${who.name}: ` : ''}${line}`, 6000);
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

  private fpArmDebug() {
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorld.clone().invert();
    // (the camera looks down its −z: ahead is +)
    const view = (p: THREE.Vector3) => {
      const v = p.clone().applyMatrix4(inv);
      return [+v.x.toFixed(3), +v.y.toFixed(3), +(-v.z).toFixed(3)];
    };
    // (the scene's one pair of arms, whoever posed them: a rub, a coffee, a phone at the till)
    const arms = FpArms.peek(this.d.scene);
    const arm = (side: HandSide) => {
      const j = arms?.joints(side);
      return j ? { sh: view(j.sh), el: view(j.el), wr: view(j.wr), end: view(j.end), wrist: j.wr.toArray().map((x) => +x.toFixed(3)), reach: +j.reach.toFixed(3), cuff: { out: +j.cuff.out.toFixed(4), at: +j.cuff.at.toFixed(3) } } : null;
    };
    const e = cam.matrixWorld.elements;
    // (and, world: the eyes, and where the shoulders are before any pull toward a hand out of reach)
    const sh0 = fpShoulders(cam);
    const w3 = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(3));
    return { pitch: Math.round((Math.asin(THREE.MathUtils.clamp(-e[9], -1, 1)) * 180) / Math.PI), vfov: (cam as THREE.PerspectiveCamera).fov, aspect: +(cam as THREE.PerspectiveCamera).aspect.toFixed(3), eye: w3(cam.position), sh0: { R: w3(sh0.R), L: w3(sh0.L) }, R: arm('R'), L: arm('L') };
  }

  debugState() {
    const a = this.act;
    return {
      action: a?.kind ?? null,
      t: a ? +a.t.toFixed(2) : null,
      masked: this.masked,
      maskOnFace: !!this.maskObj?.parent,
      fpHands: this.fp.visible,
      // first person: each forearm's turn about its own axis (deg, from the arm as modeled)
      fpTurn: (['R', 'L'] as HandSide[]).map((s) => {
        const r = this.fp.forearmTurn(s);
        return r === null ? null : { step: Math.round((r.step * 180) / Math.PI), roll: Math.round((r.roll * 180) / Math.PI) };
      }),
      // first person: each arm's shoulder, elbow and wrist in the view's frame (m: right, up, ahead)
      fpArm: this.tp() ? null : this.fpArmDebug(),
      water: !!this.water,
      stands: [...this.stands.entries()].map(([room, s]) => ({
        room,
        kind: s.kind,
        at: s.group.position.toArray().map((x) => +x.toFixed(2)),
      })),
      counts: {
        rubs: this.rubs.length,
        washes: this.washes.length,
        masks: this.maskSources.length,
        bins: this.bins.length,
      },
      // a wash now: where the hands touch, the water, the soap, the foam, the towel (handwash.ts)
      wash: a?.kind === 'wash' ? this.washFx.dbg : null,
      rig: a ? (this.tp() ? 'tp' : 'fp') : null,
      stepping: this.stepping,
      gloves: { on: this.gloved, bundle: this.bundle, sources: this.gloveSources.length, pinch: this.glovePinch, shown: { fp: [this.fp.glovesShown('R'), this.fp.glovesShown('L')], tp: [this.tpRig?.glovesShown('R') ?? false, this.tpRig?.glovesShown('L') ?? false] } },
      step: a?.kind === 'wash' ? a.step : null,
      // a wash's walks (to the towels, to the bin) and where you are
      legs: a?.kind === 'wash' ? a.legs.map((l) => ({ kind: l.kind, at: l.at, len: +l.len.toFixed(2), dur: +l.dur.toFixed(2), u: +l.u.toFixed(2), done: l.done, to: [+l.pts[l.pts.length - 1].x.toFixed(2), +l.pts[l.pts.length - 1].z.toFixed(2)] })) : null,
      walking: a?.kind === 'wash' && a.leg ? a.leg.kind : null,
      binPlan: this.binPlan,
      // the coat's sleeves (third person): can they go up, are they up, pushing them now
      sleeves: { ok: !!this.sleeves?.ok, up: [!!this.sleeves?.isUp('R'), !!this.sleeves?.isUp('L')], push: this.prep ? +this.prep.t.toFixed(2) : null },
      pos: [+this.d.controller.pos.x.toFixed(2), +this.d.controller.pos.y.toFixed(2), +this.d.controller.facing.toFixed(2)],
      bin: a?.kind === 'wash' ? (a.fx.bin ? (a.w.bin?.id ?? 'bin') : null) : null,
      layers: this.tpRig?.summary ?? null,
      arm: (['R', 'L'] as HandSide[]).map((side) => {
        const sh = this.d.hands.shoulder(side, new THREE.Vector3());
        const want = this.ikWant[side];
        return sh ? { sh: sh.toArray().map((x) => +x.toFixed(3)), reach: +(this.d.hands.armReach(side) ?? 0).toFixed(3), need: want ? +sh.distanceTo(want).toFixed(3) : null } : null;
      }),
      // third person: each wrist in the body's frame (m forward, to the right, up from the feet): an
      // arm letting go never goes behind the back
      wrists: (['R', 'L'] as HandSide[]).map((side) => {
        const av = this.d.avatar();
        const at = new THREE.Vector3();
        if (!av?.ready || !this.tp() || !this.d.hands.handFrame(side, at)) return null;
        const f = av.root.rotation.y;
        const dx = at.x - av.root.position.x;
        const dz = at.z - av.root.position.z;
        return [+(dx * Math.sin(f) + dz * Math.cos(f)).toFixed(3), +(-dx * Math.cos(f) + dz * Math.sin(f)).toFixed(3), +(at.y - av.root.position.y).toFixed(3)];
      }),
      ikErr: (['R', 'L'] as HandSide[]).map((side) => {
        const want = this.ikWant[side];
        const at = new THREE.Vector3();
        return want && this.tp() && this.d.hands.handFrame(side, at) ? +at.distanceTo(want).toFixed(4) : null;
      }),
      markers: {
        found: this.markers.found,
        missing: this.markers.missing.slice(0, 12),
      },
    };
  }

  /**
   * Tests and debugging: 'hold' stops an act's clock at that many seconds (null: runs on);
   * 'precautions' puts up stands as if the board said so ({ bed_4: 'droplet' }; null: back to the
   * board's); 'targets' lists ids; 'fixtures' where things are (rub ids with their nozzle, washes).
   */
  debugOp(op: string, arg?: unknown): unknown {
    if (op === 'hold') {
      this.holdT = typeof arg === 'number' ? arg : null;
      return this.holdT;
    }
    if (op === 'holdWalk') {
      this.holdWalk = typeof arg === 'number' ? arg : null;
      return this.holdWalk;
    }
    if (op === 'holdPush') {
      this.holdPush = typeof arg === 'number' ? arg : null;
      return this.holdPush;
    }
    // the coat's sleeves: up (true), down (false); what they leave out of the body (sleeves.ts)
    if (op === 'sleeves') {
      this.rigAvatar();
      if (typeof arg === 'boolean') for (const s of ['L', 'R'] as HandSide[]) this.sleeves?.set(s, arg);
      return this.sleeves?.debug() ?? null;
    }
    // the player's solids within r of (x, z) at waist height
    if (op === 'solids') {
      const { x, z, r } = arg as { x: number; z: number; r: number };
      const y = this.d.controller.y + 0.5;
      return this.d.colliders
        .filter((b) => boxNear(b, x, z) < r && y > b.min.y && y < b.max.y)
        .map((b) => ({ name: (b as THREE.Box3 & { name?: string }).name ?? '', min: [+b.min.x.toFixed(2), +b.min.z.toFixed(2)], max: [+b.max.x.toFixed(2), +b.max.z.toFixed(2)] }));
    }
    if (op === 'precautions') {
      this.forced = !!arg;
      this.setPrecautions(new Map(Object.entries((arg as Record<string, PrecautionKind>) ?? {})));
      return [...this.stands.keys()];
    }
    if (op === 'targets') return this.targets().map((t) => t.key);
    // test cleanup: a used pair still in hand goes away (as if binned; nothing recorded)
    if (op === 'binGloves') {
      if (this.act?.kind === 'gloveToss') return false;
      // (the next update lets go of the one in the hand: syncGloves)
      this.bundle = false;
      return true;
    }
    if (op === 'fixtures') {
      const r3 = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(3));
      return {
        rubs: this.rubs.map((r) => ({
          id: r.id,
          level: r.level,
          nozzle: r3(r.nozzle),
          n: r3(r.n),
        })),
        washes: this.washes.map((w) => ({
          id: w.id,
          level: w.level,
          stand: w.stand,
          basin: r3(w.basin),
          towel: !!w.towel,
          bin: w.bin?.id ?? null,
        })),
        masks: this.maskSources.map((m) => ({ id: m.id, slot: r3(m.slot) })),
        entrances: this.entrances,
      };
    }
    return null;
  }

  dispose() {
    this.water?.stop(0.05);
    this.fp.dispose();
    this.dropMask();
    for (const o of [this.gel, this.flatMask]) o.removeFromParent();
    this.washFx.dispose();
    this.gloveFx.dispose();
    this.bundleObj?.removeFromParent();
    this.tpRig?.dispose();
    this.tpRig = null;
    this.sleeves?.dispose();
    this.sleeves = null;
    for (const s of this.stands.values()) s.group.removeFromParent();
    this.stands.clear();
  }
}

/** a wall mask-box holder for a stand (props.ts maskBox: rebuilt here, as stands come and go) */
function buildPropBox(): THREE.Group {
  const g = new THREE.Group();
  const white = lambert('#eef0f1', { roughness: 0.3 });
  rboxB(g, 0.28, 0.17, 0.012, 0.004, white, 0, 0, 0.006);
  for (const s of [-1, 1]) rboxB(g, 0.014, 0.17, 0.12, 0.004, white, s * 0.133, 0, 0.06);
  rboxB(g, 0.28, 0.014, 0.12, 0.004, white, 0, 0, 0.06);
  rboxB(g, 0.25, 0.14, 0.11, 0.004, lambert('#f4f7fa', { roughness: 0.6 }), 0, 0.016, 0.068);
  add(g, G.rbox(0.085, 0.004, 0.045, 0.0018), lambert('#8cc0e3', { roughness: 0.92 }), 0, 0.083, 0.14).rotation.x = 0.55;
  return g;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** b − a, wrapped to (−π, π] */
function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** how far a point is from a box, across the floor (0 inside it) */
function boxNear(b: THREE.Box3, x: number, z: number): number {
  return Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
}

/** a path with its corners rounded (Chaikin's cut, three times over), its ends kept */
function roundCorners(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  let p = pts.map((q) => ({ x: q.x, z: q.z }));
  for (let it = 0; it < 3 && p.length > 2; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < p.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

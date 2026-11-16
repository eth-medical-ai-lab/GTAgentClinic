import type { SavedCabinet } from '../../../shared/saveGame';
/**
 * Every cabinet, cupboard, wardrobe, drawer and cart opens (the models: cabinetModels.ts).
 *
 *   [E] on a door, drawer or cover: your hand goes to its handle (gesture.ts: the turn to it, the
 *       near hand), and when it is there the door swings out, the drawer slides, the cover rolls
 *       up, the hand on the handle for the first part of it. [E] again closes it the same way.
 *       Standing where it would swing or slide into you, you step back out of its way first. An
 *       open one closes itself a few seconds after you have walked away from it.
 *   [F] what it is (the info card), as before.
 *
 * What's inside is modelled (supplies, linen, a patient's clothes, drugs in a crash cart's
 * drawers, the medication fridge's insulin); a few things in the ground floor's cupboards and
 * carts are real items you can take (itemSystem.ts), and what you put back inside goes in with it.
 *
 * Locks:
 *   - the controlled-drug cupboard (both medication rooms) is locked. The first try rattles it and
 *     says who has the key: the nurse in charge (Rosa in the ED; Ana on Ward 2 East). [E] again
 *     asks her: she walks over (an errand of this client's: World or ward.ts walks her, and she
 *     goes back to where the server has her afterwards), turns her key in the lock, reminds you of
 *     the register and the witness, and goes back. Busy, she comes in a minute. It stays unlocked
 *     while you are in the room and locks again behind you
 *   - crash carts carry a numbered breakaway seal: opening one breaks it (an emergency is reason
 *     enough); pharmacy checks and restocks the cart and fits a new seal once you have gone
 *   - the medication dispenser (workstation.ts) keeps its badge login: its drawers stay shut
 *   - staff lockers are their owners' (all but the spare one)
 *
 * Off the record, like the amenities: no game time, nothing scored, nothing sent to the server
 * (a nurse's line is voiced as an aside), so AI-doctor runs stay deterministic.
 */
import * as THREE from 'three';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import { levelAtHeight, upperLevels } from '../../../shared/floors';
import type { CameraMode } from '../../../shared/types';
import type { BuiltWorld, Interactable } from './builder';
import type { PlayerController } from './controls';
import type { Gesture, PlayerGestures } from './gesture';
import type { ItemSystem } from './itemSystem';
import { FIXTURE_INFO, makeItem, type ItemInstance } from './items';
import type { NpcErrands } from './payment';
import { Reach } from './reach';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { residentLockerId, buildLockerDisplay, drawSeal, redrawLabel, sealNumber, type CabRole, type PartTag, type UnitTag } from './cabinetModels';
import { lambert } from './materials';
import { BUILTIN_SOUNDS, playSound } from '../audio/soundscape';
import * as S from '../audio/synth';

// ───────────────────────────── tuning ─────────────────────────────

/** seconds to swing a door fully open / slide a drawer / roll a cover */
const DUR = { door: 0.85, drawer: 0.5, shutter: 1.1 } as const;
/** the hand stays on the handle this long after it takes hold (s) */
const HOLD = { door: 0.42, drawer: 0.36, shutter: 0.5 } as const;
/** the wrist stops this far short of the handle (m): the fingers close round it (reach.ts) */
const GRIP = 0.085;
/** an open part closes itself when you have been this far from it (m) for this long (s) */
const AWAY_M = 3.2;
const AWAY_S = 6;
/** a body (yours, an NPC's) as a door's swing sees it: radius (m) */
const BODY_R = 0.26;
/** doors stop this short of walls and neighbours (rad) */
const MARGIN = 0.05;
/** pharmacy re-seals a crash cart this long after you've left it (s) */
const RESEAL_S = 75;
/** a busy nurse comes anyway after this long (s) */
const BUSY_MAX = 40;
/** the handle within this far (m, on the floor plan) of where you stand: an arm's reach (reach.ts takes it from there) */
const REACH = 0.56;
/** a handle lower than this (m above your feet) you crouch for: standing, the hand doesn't get down there */
const CROUCH_BELOW = 0.9;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ───────────────────────────── what F says ─────────────────────────────

const INFO: Partial<Record<CabRole, { title: string; desc: string }>> = {
  supply: {
    title: 'Supply cabinet',
    desc: 'Gloves on the top shelf, then giving sets and flushes, dressings and gauze, cannulas, needles and syringes, bulk boxes at the bottom. First in, first out: new stock goes to the back so the earliest expiry date is used first. A sterile pack is sterile only while it is dry, sealed and in date. Restock what you take.',
  },
  linen: {
    title: 'Linen cupboard',
    desc: 'Clean linen: sheets, pillowcases, patient gowns, cellular blankets, towels and spare scrubs. Clean and used linen never share a cupboard or a trolley. Used linen goes straight into the bag at the bedside, never on the floor, and is never shaken out: shaking it spreads what is on it.',
  },
  wardrobe: {
    title: 'Wardrobe',
    desc: "The patient's own clothes, shoes and bag. Belongings are listed on the property record at admission and valuables go to the hospital safe. A spare pillow and blanket on the shelf.",
  },
  lockers: {
    title: 'Staff lockers',
    desc: "Each one is a colleague's own, and locked. The spare one has its key in the lock: take the key with you if you use it.",
  },
  files: {
    title: 'Lateral filing cabinet',
    desc: "Request forms, printer paper, and hanging files of policies and rotas. Patient records live in AgentChart, not in here.",
  },
  cart: {
    title: 'Supply cart',
    desc: 'Four drawers: IV start kits and flushes, dressings and gauze, cannulas and syringes, blood tubes and ECG electrodes. Restock what you use before the next patient needs it.',
  },
  medFridge: {
    title: 'Medication fridge',
    desc: 'Kept at 2–8 °C: insulin, vaccines, rocuronium, suxamethonium, lorazepam, oxytocin. The minimum and maximum are read and logged every day; if it has been out of range, quarantine the stock and ask pharmacy before anything is used. No food and no specimens in here.',
  },
  cd: {
    title: 'Controlled-drug cupboard',
    desc: 'Morphine, fentanyl, oxycodone, hydromorphone and methadone, in a locked steel cupboard fixed to the wall; the light on top shows while it is open. The key stays with the nurse in charge. Every withdrawal goes in the controlled-drug register beside it: date, patient, drug and dose, the balance left, and two signatures, yours and a witness who sees it drawn up and given. Count and sign the balance; report a discrepancy the same day.',
  },
};
const SEAL_NOTE = ' Sealed with a numbered breakaway seal: in an emergency you break it and open the cart. Afterwards pharmacy checks and restocks it, fits a new seal and logs its number.';

/** what F shows for a unit: its role's card, the existing fixture card for the rest */
function infoFor(u: Unit): { title: string; desc: string } {
  const own = INFO[u.tag.role];
  const subject = u.tag.role === 'linenCart' ? 'linenCart' : u.tag.role === 'isolation' ? 'isolationCart' : u.tag.role === 'staffFridge' ? 'fridge' : u.kind;
  const base = own ?? FIXTURE_INFO[subject] ?? { title: u.tag.noun, desc: '' };
  if (u.tag.role === 'wardrobe' && !u.occupied) return { title: base.title, desc: 'Empty, ready for the next admission: bare hangers, and a spare pillow and blanket on the shelf.' };
  return u.tag.lock === 'seal' ? { title: base.title, desc: base.desc + SEAL_NOTE } : base;
}

// ───────────────────────────── types ─────────────────────────────

/** the nurse who keeps the controlled-drug key on a storey */
export interface Keyholder {
  level: number;
  id: string;
  name: string;
  /** "the charge nurse", "the nurse in charge" */
  role: string;
  npcs: NpcErrands;
  /** what keeps her (a task's name), or null when she can come */
  busy(): string | null;
}

export interface CabinetDeps {
  onOpenLocker?(): void;
  scene: THREE.Scene;
  built: BuiltWorld;
  layout: LayoutDef;
  controller: PlayerController;
  gestures: PlayerGestures;
  items: ItemSystem;
  mode(): CameraMode;
  hint(text: string, ms?: number): void;
  /** the storey you're on (0 = ground) and the room you're in */
  level(): number;
  room(): string;
  /** a free spot to stand on your storey's nav grid */
  free(x: number, z: number): boolean;
  /** a walk for you on your storey's nav grid (null: no way) */
  path(x: number, z: number): THREE.Vector2[] | null;
  keyholders: Keyholder[];
  /** a line said by an NPC (voiced as an aside when it can be) */
  say(id: string, text: string): void;
  /** NPCs near (x, z) on a storey: a door stops short of them */
  bodies(x: number, z: number, level: number): { x: number; z: number }[];
  /** the player's avatar root (third-person hand measurements in tests) */
  avatarRoot(): THREE.Object3D | null;
  /** the player's avatar, to crouch for a low drawer (avatars.ts act 'crouch'); first person dips the view instead */
  avatar(): { act?: string } | null;
  camera: THREE.PerspectiveCamera;
}

interface Stowed {
  inst: ItemInstance;
  /** where it sits, in its holder's frame (a drawer's inner group, or the unit) */
  pos: THREE.Vector3;
  yaw: number;
}

interface Part {
  unit: Unit;
  i: number;
  g: THREE.Group;
  tag: PartTag;
  /** closed position (drawers slide from it) */
  base: THREE.Vector3;
  /** 0..1 now (linear), what it's going to, and the eased value shown */
  t: number;
  goal: 0 | 1;
  shown: number;
  /** the opening reachable here (rad / m / share), after walls and neighbours */
  max: number;
  inner: THREE.Object3D[];
  cover: THREE.Object3D | null;
  roll: THREE.Object3D | null;
  /** a locked rattle in progress (s) */
  rattle: number;
  /** the part's meshes (shown while anything on the unit moves; the unit's shell otherwise) */
  meshes: THREE.Mesh[];
  stowed: Stowed[];
  out: { inst: ItemInstance; at: THREE.Vector3 }[];
  holder: THREE.Object3D;
  it: Interactable;
  /** closed: the part's box and the depth behind it (world) */
  closedBox: THREE.Box3;
  /** the top drawer: its target runs up over the top of the cart (world y) */
  reachTop?: number;
  hand: Gesture | null;
}

interface Unit {
  id: string;
  kind: string;
  tag: UnitTag;
  g: THREE.Group;
  level: number;
  room: string;
  prop?: PropDef;
  parts: Part[];
  /** where it is (world), which way its front faces (world, unit vector) */
  center: THREE.Vector3;
  /** its body (world), shut */
  body: THREE.Box3;
  front: THREE.Vector3;
  across: THREE.Vector3;
  occupied: boolean;
  /** time since you were last near it (s) */
  away: number;
  /** a crash cart's seal */
  seal: { obj: THREE.Object3D | null; broken: THREE.Object3D[]; intact: boolean; no: string; n: number; gone: number } | null;
  /** the controlled-drug lock */
  lock: { state: 'locked' | 'tried' | 'asked' | 'open'; barrel: THREE.Object3D | null; key: THREE.Object3D | null; led: THREE.Mesh | null; angle: number; want: number; outFor: number } | null;
  /** a combined mesh of all its closed parts (fewer draw calls while nothing moves) */
  shell: THREE.Group | null;
  busy: boolean;
}

interface Errand {
  unit: Unit;
  kh: Keyholder;
  phase: 'wait' | 'walk' | 'unlock' | 'back' | 'remote';
  t: number;
  spot: { x: number; z: number; rot: number };
  arm: 'R' | 'L';
  reach: Reach | null;
  pressed: number;
  lockAt: THREE.Vector3;
  said: boolean;
}

interface Pending {
  part: Part;
  act: () => void;
  t: number;
}

// ───────────────────────────── the system ─────────────────────────────

export class Cabinets {
  readonly units: Unit[] = [];
  private byKey = new Map<string, Part>();
  private errand: Errand | null = null;
  private pending: Pending | null = null;
  private now = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private box = new THREE.Box3();
  /** tests: the last grab (the hand's distance to the handle, held), the errand's steps */
  private lastGrab: { part: string; handle: number[]; fp: number | null; tp: number | null; frames: number } | null = null;
  private log: string[] = [];
  /** tests: open things stay open however far away you are (the clearance audit opens every door at once) */
  private holdOpen = false;
  private handBones: { root: THREE.Object3D; side: 'R' | 'L'; bones: THREE.Object3D[] } | null = null;
  /** down to a low handle: the gesture it lasts for, how far down now (0..1), the view's dip (first person, m) */
  private crouch: { g: Gesture; hold: number; w: number; dip: number; mine: boolean } | null = null;

  private lockerDisplay?: THREE.Group;

  setLockerContents(items: readonly string[]) {
    for (const model of this.lockerDisplay?.children ?? []) model.visible = items.includes(model.name);
  }

  private isResidentDoor(p: Part) {
    return !!this.d.onOpenLocker && p.unit.id === residentLockerId && !p.tag.personal;
  }

  constructor(private d: CabinetDeps) {
    this.scan();
    const locker = this.units.find(u => u.id === residentLockerId);
    if (locker && d.onOpenLocker) {
      this.lockerDisplay = buildLockerDisplay();
      locker.g.add(this.lockerDisplay);
    }
    // the cabinets' own targets replace their inspect boxes (F still shows the card)
    const mine = new Set(this.units.map((u) => `fx:${u.id}`));
    for (let i = d.built.interactables.length - 1; i >= 0; i--) if (mine.has(d.built.interactables[i].key)) d.built.interactables.splice(i, 1);
    for (const u of this.units) for (const p of u.parts) d.built.interactables.push(p.it);
  }

  // ───────── finding the units in the built world ─────────

  private scan() {
    const roots = [this.d.built.root, ...this.d.scene.children.filter((o) => o.name === 'floors')];
    const groups: THREE.Group[] = [];
    for (const r of roots) {
      r.updateMatrixWorld(true);
      r.traverse((o) => {
        if (o.userData.cabUnit) groups.push(o as THREE.Group);
      });
    }
    const props: (PropDef & { level: number })[] = [...this.d.layout.props.map((p) => ({ ...p, level: 0 })), ...upperLevels(this.d.layout).flatMap((L) => L.props.map((p) => ({ ...p, level: L.index })))];
    for (const g of groups) {
      const tag = g.userData.cabUnit as UnitTag;
      const at = g.getWorldPosition(new THREE.Vector3());
      // a layout prop: by its id (props.ts tags it), else (resus carts) by where it stands
      let prop = props.find((p) => p.id === (g.userData.propId ?? tag.id));
      if (!prop && !tag.id) prop = props.find((p) => Math.hypot(p.x - at.x, p.z - at.z) < 0.05 && Math.abs((p.y ?? 0) + levelY(this.d.layout, p.level) - at.y) < 0.2);
      const id = tag.id ?? prop?.id;
      if (!id || this.units.some((u) => u.id === id)) continue;
      const level = prop?.level ?? levelAtHeight(this.d.layout, at.y + 0.1);
      const q = g.getWorldQuaternion(new THREE.Quaternion());
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const room = prop?.room ?? this.roomAt(at.x, at.z);
      const u: Unit = {
        id,
        kind: prop?.kind ?? tag.role,
        tag,
        g,
        level,
        room,
        prop,
        parts: [],
        center: new THREE.Vector3(),
        body: new THREE.Box3(),
        front,
        across,
        occupied: false,
        away: 0,
        seal: null,
        lock: null,
        shell: null,
        busy: false,
      };
      // its body (the merge took its meshes: the tag says where it was)
      const [x0, y0, z0, x1, y1, z1] = tag.box;
      for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) u.body.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld));
      u.body.getCenter(u.center);
      // (Ward 2 East's patients: ward.ts)
      if (tag.role === 'wardrobe') u.occupied = /^f2_room_20[1245]/.test(id);
      const parts: THREE.Group[] = [];
      g.traverse((o) => {
        if (o.userData.cabPart && o !== g) parts.push(o as THREE.Group);
      });
      parts.forEach((pg, i) => u.parts.push(this.makePart(u, pg, i)));
      // its body with its doors and handles shut (its own collider is that box: a door never hits it)
      for (const p of u.parts) u.body.union(p.closedBox);
      // a cart's top drawer answers for the top of the cart too (the defibrillator on it, its push handle)
      const top = u.parts.filter((p) => p.tag.kind === 'drawer').sort((a, b) => b.closedBox.max.y - a.closedBox.max.y)[0];
      if (top) {
        top.reachTop = u.body.max.y;
        this.deepen(top);
      }
      // the seal, the lock, the light, the key
      g.traverse((o) => {
        if (o.userData.cabSeal) u.seal = { obj: o, broken: [], intact: true, no: String(o.userData.cabSeal), n: 0, gone: 0 };
      });
      if (u.seal) g.traverse((o) => o.userData.cabSealBroken && u.seal!.broken.push(o));
      if (tag.lock === 'key') {
        let barrel: THREE.Object3D | null = null;
        let key: THREE.Object3D | null = null;
        let led: THREE.Mesh | null = null;
        g.traverse((o) => {
          if (o.userData.cabLock === 'cd') barrel = o;
          if (o.userData.cabKey) key = o;
          if (o.userData.cabLed) o.traverse((m) => ((m as THREE.Mesh).isMesh ? (led = m as THREE.Mesh) : undefined));
        });
        u.lock = { state: 'locked', barrel, key, led, angle: 0, want: 0, outFor: 0 };
      }
      this.units.push(u);
      // (the prompts now know about the seal and the lock)
      for (const p of u.parts) {
        this.byKey.set(p.it.key, p);
        this.relabel(p);
      }
      this.makeShell(u);
      this.stock(u);
    }
    // how far each door can swing before a wall or a neighbour
    for (const u of this.units) for (const p of u.parts) if (p.tag.kind === 'door') p.max = this.clearance(p);
  }

  private roomAt(x: number, z: number): string {
    let hit = '';
    for (const r of this.d.layout.rooms) if (x >= r.rect.x && x <= r.rect.x + r.rect.w && z >= r.rect.z && z <= r.rect.z + r.rect.d && (!hit || r.kind !== 'corridor')) hit = r.id;
    return hit;
  }

  private makePart(u: Unit, g: THREE.Group, i: number): Part {
    const tag = g.userData.cabPart as PartTag;
    const inner: THREE.Object3D[] = [];
    let cover: THREE.Object3D | null = null;
    let roll: THREE.Object3D | null = null;
    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => {
      if (o.userData.cabInner) inner.push(o);
      if (o.userData.cabCover) cover = o;
      if (o.userData.cabRoll) roll = o;
    });
    for (const c of g.children) if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
    for (const o of inner) o.visible = false;
    g.updateMatrixWorld(true);
    const closedBox = this.partBox(g);
    const key = `cab:${u.id}:${i}`;
    const it: Interactable = { key, target: { kind: 'use', id: key, label: '' }, box: closedBox.clone(), center: closedBox.getCenter(new THREE.Vector3()), level: u.level || undefined };
    const p: Part = { unit: u, i, g, tag, base: g.position.clone(), t: 0, goal: 0, shown: 0, max: tag.max, inner, cover, roll, rattle: 0, meshes, stowed: [], out: [], holder: inner[0] ?? u.g, it, closedBox, hand: null };
    // aiming at the cupboard's side or the cart's flank finds the nearest part: its box runs back through the unit
    this.deepen(p);
    p.it.target = { kind: 'use', id: key, label: this.label(p) };
    return p;
  }

  /** a part's world box (its meshes, not what's inside) */
  private partBox(g: THREE.Object3D): THREE.Box3 {
    const b = new THREE.Box3();
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !visibleUnder(m, g)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      b.union(this.box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
    });
    return b;
  }

  /** the part's target: its closed box, run back into the unit and out over where it goes when open */
  private deepen(p: Part) {
    const u = p.unit;
    const depth = p.tag.kind === 'drawer' ? p.tag.size[2] : u.tag.role === 'cd' ? 0.28 : 0.42;
    // No two parts' boxes may overlap: World.pick lets a box that overlaps a bigger one win, so a
    // neighbour's would take the aim from an open door or drawer. Each box runs back through the unit
    // from 1.2 cm behind the part's back face (a door swung open reaches 7 mm behind its hinge, a
    // neighbour's never this far), across exactly the part's width and height. The ray goes through
    // the door to it; open, the part's own swung or pulled-out box is added.
    const f = u.front;
    const b = p.closedBox.clone();
    const backD = Math.min(b.min.x * f.x, b.max.x * f.x) + Math.min(b.min.z * f.z, b.max.z * f.z);
    const cut = backD - 0.012;
    for (const ax of ['x', 'z'] as const) {
      const k = f[ax];
      if (Math.abs(k) < 0.5) continue;
      // along the front axis: from cut − depth to cut
      const lo = k > 0 ? cut - depth : -cut;
      const hi = k > 0 ? cut : -(cut - depth);
      b.min[ax] = lo;
      b.max[ax] = hi;
    }
    if (p.reachTop !== undefined) b.max.y = Math.max(b.max.y, p.reachTop + 0.02);
    p.it.box.copy(b);
    if (p.shown > 0.01) p.it.box.union(this.partBox(p.g).expandByScalar(0.01));
    p.it.box.getCenter(p.it.center);
  }

  // ───────── fewer draw calls: one shell per unit while it is shut ─────────

  /** every part's meshes (closed) merged by material in the unit's frame; parts shown only while it moves */
  private makeShell(u: Unit) {
    if (u.parts.length < 2) return;
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    u.g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(u.g.matrixWorld).invert();
    for (const p of u.parts)
      for (const m of p.meshes) {
        const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        let arr = buckets.get(m.material as THREE.Material);
        if (!arr) buckets.set(m.material as THREE.Material, (arr = []));
        arr.push(geo.index ? geo.toNonIndexed() : geo);
      }
    const shell = new THREE.Group();
    shell.name = 'cab-shell';
    for (const [mat, geos] of buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      shell.add(mesh);
    }
    u.g.add(shell);
    u.shell = shell;
    this.showParts(u, false);
  }

  private showParts(u: Unit, moving: boolean) {
    if (!u.shell) return;
    u.shell.visible = !moving;
    for (const p of u.parts) for (const m of p.meshes) m.visible = moving;
  }

  // ───────── things you can take ─────────

  /** the ground floor's slots get a real item (pickable once the part is open) */
  private stock(u: Unit) {
    if (u.level !== 0) return;
    const slots: { o: THREE.Object3D; part: Part | null }[] = [];
    u.g.traverse((o) => {
      if (!o.userData.cabSlot) return;
      let part: Part | null = null;
      for (let a: THREE.Object3D | null = o.parent; a && a !== u.g; a = a.parent) {
        const hit = u.parts.find((p) => p.g === a);
        if (hit) part = hit;
      }
      slots.push({ o, part });
    });
    for (const [stockIndex, { o, part }] of slots.entries()) {
      // a door cupboard's things are on its shelves: they go with the door nearest them
      const p = part ?? this.nearestPart(u, o.getWorldPosition(this.tmp));
      if (!p) continue;
      const inst = makeItem(o.userData.cabSlot as string);
      inst.id = u.id + '-stock-' + stockIndex;
      const holder = p.tag.kind === 'drawer' ? p.holder : u.g;
      const pos = holder.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
      const yaw = o.rotation.y;
      this.stow(p, { inst, pos, yaw }, holder);
    }
  }

  snapshot(): SavedCabinet[] {
    return this.units.map(u => ({ id: u.id, away: u.away,
      lock: u.lock ? { state: u.lock.state, outFor: u.lock.outFor } : undefined,
      seal: u.seal ? { intact: u.seal.intact, n: u.seal.n, gone: u.seal.gone } : undefined,
      parts: u.parts.map(p => ({ goal: p.goal, t: p.t, contents: p.stowed.map(({ inst, pos, yaw }) => ({
        key: inst.id, kind: inst.kind, label: inst.label, desc: inst.desc, x: pos.x, y: pos.y, z: pos.z, yaw, order: -1,
      })) })),
    }));
  }

  restore(saved: SavedCabinet[], items: Map<string, ItemInstance>) {
    for (const u of this.units) for (const p of u.parts) {
      for (const { inst } of p.stowed) { items.set(inst.id, inst); inst.root.removeFromParent(); }
      p.stowed = [];
    }
    for (const row of saved) {
      const u = this.units.find(unit => unit.id === row.id);
      if (!u) continue;
      u.away = row.away;
      if (u.seal && row.seal) {
        Object.assign(u.seal, row.seal);
        const number = sealNumber(u.id, u.seal.n);
        redrawLabel(`seal|${u.seal.no}`, drawSeal(number));
        u.seal.no = number;
        if (u.seal.obj) u.seal.obj.visible = u.seal.intact;
        for (const bit of u.seal.broken) bit.visible = !u.seal.intact;
      }
      if (u.lock && row.lock) {
        Object.assign(u.lock, row.lock);
        if (u.lock.state === 'asked') { u.lock.state = 'tried'; this.ask(u); }
        if (u.lock.state === 'open') u.lock.angle = u.lock.want = -Math.PI / 2;
      }
      row.parts.forEach((part, i) => {
        const p = u.parts[i];
        if (!p) return;
        p.goal = part.goal;
        p.t = part.t;
        p.shown = smooth(p.t);
        this.pose(p, p.shown, 0);
        for (const c of part.contents) {
          if (c.kind === 'traumaShears') continue;
          const inst = items.get(c.key) ?? makeItem(c.kind);
          inst.id = c.key;
          inst.label = c.label; inst.desc = c.desc;
          this.stow(p, { inst, pos: new THREE.Vector3(c.x, c.y, c.z), yaw: c.yaw });
        }
        this.deepen(p);
        this.relabel(p);
      });
      u.busy = u.parts.some(p => p.t > 0 || !!p.goal);
      this.showParts(u, u.busy);
    }
  }

  private nearestPart(u: Unit, at: THREE.Vector3): Part | null {
    let best: Part | null = null;
    let bd = Infinity;
    for (const p of u.parts) {
      const d = p.closedBox.distanceToPoint(at);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private stow(p: Part, s: Stowed, holder = p.tag.kind === 'drawer' ? p.holder : p.unit.g) {
    s.inst.root.removeFromParent();
    s.inst.root.position.copy(s.pos);
    s.inst.root.rotation.set(0, s.yaw, 0);
    s.inst.root.scale.setScalar(1);
    holder.add(s.inst.root);
    // behind a shut door it isn't drawn
    s.inst.root.visible = p.shown > 0.01;
    p.stowed.push(s);
  }

  /** open: the things inside become real items where they are */
  private release(p: Part) {
    for (const s of p.stowed) {
      const at = s.inst.root.getWorldPosition(new THREE.Vector3());
      const yaw = new THREE.Euler().setFromQuaternion(s.inst.root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      this.d.items.placeAt(s.inst, at, yaw);
      p.out.push({ inst: s.inst, at: at.clone() });
    }
    p.stowed = [];
  }

  /** closing: whatever lies inside (left there, or put in) goes in with it */
  private reclaim(p: Part) {
    const u = p.unit;
    const vol = this.insideVolume(p);
    const holder = p.tag.kind === 'drawer' ? p.holder : u.g;
    for (const inst of [...this.d.items.items.values()]) {
      if (this.d.items.slotOf(inst) || inst.root.parent !== this.d.scene || inst.caseItemId) continue;
      const at = inst.root.position;
      if (!vol.containsPoint(at)) continue;
      const yaw = inst.root.rotation.y;
      this.d.items.remove(inst);
      const pos = holder.worldToLocal(at.clone());
      const local = yaw - new THREE.Euler().setFromQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      this.stow(p, { inst, pos, yaw: local }, holder);
    }
    p.out = [];
  }

  /** the space a part closes over: a drawer's tray (out), a cupboard's inside behind its door */
  private insideVolume(p: Part): THREE.Box3 {
    const u = p.unit;
    if (p.tag.kind === 'drawer' && p.inner[0]) return this.partBoxOf(p.inner[0]).expandByScalar(0.03);
    // inside its body
    return u.body.clone().expandByScalar(-0.015);
  }

  private partBoxOf(o: THREE.Object3D): THREE.Box3 {
    const b = new THREE.Box3();
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      b.union(this.box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
    });
    return b;
  }

  // ───────── doors: walls, neighbours, bodies ─────────

  /** a door's hinge (world, on the floor plane) and its panel's direction at angle a (world xz) */
  private doorLine(p: Part, a: number, out: { hx: number; hz: number; dx: number; dz: number; w: number }) {
    const u = p.unit;
    const s = p.tag.hinge === 'L' ? 1 : -1;
    const hinge = this.tmp.copy(p.base).applyMatrix4(u.g.matrixWorld);
    // closed the panel runs along the unit's +x (L) or −x (R); open it turns out toward the front
    const ax = u.across.x * s;
    const az = u.across.z * s;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    out.hx = hinge.x;
    out.hz = hinge.z;
    out.dx = ax * c + u.front.x * sn;
    out.dz = az * c + u.front.z * sn;
    out.w = p.tag.size[0];
    return out;
  }

  /** the widest angle the door reaches before a wall or another piece of furniture (a little short of it) */
  private clearance(p: Part): number {
    const u = p.unit;
    u.g.updateMatrixWorld(true);
    const y0 = (p.tag.y0 ?? 0) + u.g.getWorldPosition(this.tmp2).y;
    const y1 = y0 + p.tag.size[1];
    const own = u.body.clone().expandByScalar(0.06);
    const blockers = this.d.built.colliders.filter((b) => b.max.y > y0 + 0.02 && b.min.y < y1 - 0.02 && b.distanceToPoint(u.center) < 2.5 && !own.containsBox(b));
    // other cabinets too (a fridge beside a bench, a cart parked by a cupboard)
    for (const v of this.units) if (v !== u && v.level === u.level && v.center.distanceTo(u.center) < 2.5) blockers.push(v.body.clone());
    const line = { hx: 0, hz: 0, dx: 0, dz: 0, w: 0 };
    const step = 0.02;
    for (let a = step; a <= p.tag.max + 1e-6; a += step) {
      this.doorLine(p, a, line);
      for (let k = 1; k <= 6; k++) {
        const x = line.hx + line.dx * line.w * (k / 6);
        const z = line.hz + line.dz * line.w * (k / 6);
        for (const b of blockers) if (x > b.min.x - 0.012 && x < b.max.x + 0.012 && z > b.min.z - 0.012 && z < b.max.z + 0.012) return Math.max(0.35, a - step - MARGIN);
      }
    }
    return p.tag.max;
  }

  /** Only the arc the door is about to sweep can be blocked. People can stand behind an open door. */
  private bodyLimit(p: Part, from: number, upTo: number): number {
    const u = p.unit;
    const bodies = this.bodiesNear(u);
    if (!bodies.length) return upTo;
    const line = { hx: 0, hz: 0, dx: 0, dz: 0, w: 0 };
    const step = 0.03;
    for (let prev = from; prev < upTo; prev += step) {
      const a = Math.min(prev + step, upTo);
      this.doorLine(p, a, line);
      for (const b of bodies) if (segDist(b.x, b.z, line.hx, line.hz, line.hx + line.dx * line.w, line.hz + line.dz * line.w) < BODY_R) return prev;
    }
    return upTo;
  }

  private bodiesNear(u: Unit): { x: number; z: number }[] {
    const c = this.d.controller;
    const out: { x: number; z: number }[] = [];
    if (this.d.level() === u.level && Math.hypot(c.pos.x - u.center.x, c.pos.y - u.center.z) < 2.2) out.push({ x: c.pos.x, z: c.pos.y });
    for (const b of this.d.bodies(u.center.x, u.center.z, u.level)) if (Math.hypot(b.x - u.center.x, b.z - u.center.z) < 2.2) out.push(b);
    return out;
  }

  // ───────── E ─────────

  /** E on one of our targets (true: it was ours) */
  use(id: string): boolean {
    const p = this.byKey.get(id);
    if (!p) return false;
    const u = p.unit;
    this.pending = null;
    if (p.tag.personal) {
      this.reach(p, () => {
        p.rattle = 0.32;
        this.sound('lock.rattle', p);
        this.d.hint(`${cap(p.tag.name)}: a colleague's own, and locked.`, 3500);
      }, false);
      return true;
    }
    if (u.lock && u.lock.state !== 'open') {
      if (u.lock.state === 'locked') {
        this.reach(p, () => {
          p.rattle = 0.35;
          this.sound('lock.rattle', p);
          if (u.lock) u.lock.state = 'tried';
          const kh = this.keyholder(u.level);
          this.d.hint(`Locked: controlled drugs. The key is with ${kh ? `${kh.role} (${kh.name})` : 'the nurse in charge'}.`, 6000);
          this.relabel(p);
        }, false);
      } else if (u.lock.state === 'tried') this.ask(u);
      else {
        const kh = this.keyholder(u.level);
        this.d.hint(`${kh?.name ?? 'The nurse in charge'} is bringing the key.`, 2500);
      }
      return true;
    }
    if (p.goal === 1) {
      this.act(p, () => this.reach(p, () => this.move(p, 0)), false);
      return true;
    }
    if (u.seal?.intact) {
      this.act(p, () => this.reach(p, () => {
        this.breakSeal(u);
        this.move(p, 1);
      }), true);
      return true;
    }
    this.act(p, () => this.reach(p, () => {
      this.move(p, 1);
      if (this.isResidentDoor(p)) this.d.onOpenLocker?.();
    }), true);
    return true;
  }

  /** F on one of our targets: its card (true: it was ours) */
  inspect(id: string): boolean {
    const p = this.byKey.get(id);
    if (!p) return false;
    if (this.isResidentDoor(p)) {
      this.d.onOpenLocker?.();
      return true;
    }
    const info = infoFor(p.unit);
    this.d.items.openFixture(info.title, info.desc);
    return true;
  }

  /** a step first if you aren't where you can do it: within reach of the handle and (opening) out of its way */
  private act(p: Part, fn: () => void, opening: boolean) {
    const spot = this.standSpot(p, opening);
    if (!spot) {
      fn();
      return;
    }
    const path = this.d.path(spot.x, spot.z);
    if (!path) {
      fn();
      return;
    }
    this.d.controller.path = path.length ? path : [new THREE.Vector2(spot.x, spot.z)];
    this.pending = { part: p, act: fn, t: 0 };
  }

  /**
   * Where to stand to work a part: the handle within an arm's reach (REACH m from where you stand)
   * and, opening it, out of where it will swing or slide. Null: where you are will do.
   */
  private standSpot(p: Part, opening: boolean): { x: number; z: number } | null {
    const c = this.d.controller;
    const u = p.unit;
    const me = { x: c.pos.x, z: c.pos.y };
    const handle = this.handleWorld(p, new THREE.Vector3());
    const ok = (x: number, z: number) => Math.hypot(x - handle.x, z - handle.z) <= REACH && !(opening && this.inSwing(p, x, z));
    if (ok(me.x, me.z)) return null;
    // candidates in front of the handle, nearest to you first
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const out of [0.3, 0.38, 0.46, 0.54])
      for (let side = -0.6; side <= 0.6 + 1e-6; side += 0.1) {
        const x = handle.x + u.front.x * out + u.across.x * side;
        const z = handle.z + u.front.z * out + u.across.z * side;
        if (!ok(x, z) || !this.d.free(x, z)) continue;
        const dd = Math.hypot(x - me.x, z - me.z);
        if (dd < bd) {
          bd = dd;
          best = { x, z };
        }
      }
    return best;
  }

  /** would the part, opening, pass where a body at (x, z) stands */
  private inSwing(p: Part, x: number, z: number): boolean {
    const u = p.unit;
    if (p.tag.kind === 'shutter') return false;
    if (p.tag.kind === 'drawer') {
      // the drawer's front, out to its full travel, and a body's width round it
      const rel = this.tmp.set(x, 0, z).sub(this.tmp2.copy(p.closedBox.getCenter(this.tmp2)).setY(0));
      const ahead = rel.dot(u.front);
      const side = Math.abs(rel.x * u.across.x + rel.z * u.across.z);
      const half = Math.max(p.closedBox.max.x - p.closedBox.min.x, p.closedBox.max.z - p.closedBox.min.z) / 2;
      // (you stand where it stops a hand's width short of you: a drawer comes toward the one pulling it)
      return ahead > -0.05 && ahead < p.tag.max + 0.2 && side < half + BODY_R;
    }
    const line = { hx: 0, hz: 0, dx: 0, dz: 0, w: 0 };
    for (let a = 0.1; a <= p.max + 1e-6; a += 0.1) {
      this.doorLine(p, a, line);
      if (segDist(x, z, line.hx, line.hz, line.hx + line.dx * line.w, line.hz + line.dz * line.w) < BODY_R + 0.05) return true;
    }
    return false;
  }

  /** the hand to the part's handle; `onPress` when it is there; the hand stays on it a moment as it moves */
  private reach(p: Part, onPress: () => void, follow = true) {
    const at = this.handleWorld(p, new THREE.Vector3());
    const kind = p.tag.kind;
    const hold = follow ? HOLD[kind] : 0.22;
    const g = this.d.gestures.start(at, () => {
      onPress();
      this.lastGrab = { part: p.it.key, handle: at.toArray().map(r3), fp: null, tp: null, frames: 0 };
    }, { hold, grip: p.tag.grip === 'bar' ? 'bar' : 'pull' });
    p.hand = g;
    // a low drawer or a cover's bottom edge: down on your haunches for it (the view dips as far in first person)
    const low = at.y - this.d.controller.y;
    if (low < CROUCH_BELOW) this.crouch = { g, hold, w: this.crouch?.w ?? 0, dip: Math.min(0.6, (CROUCH_BELOW + 0.1 - low) * 0.95), mine: this.crouch?.mine ?? false };
  }

  /** the crouch for a low handle: down as the hand goes out, up as it comes back */
  private crouchStep(dt: number) {
    const cr = this.crouch;
    if (!cr) return;
    const g = cr.g;
    const down = !g.done && (g.turning || g.t < 0.3 + cr.hold) && !this.d.controller.moving;
    cr.w = down ? Math.min(1, cr.w + dt / 0.3) : Math.max(0, cr.w - dt / 0.4);
    const av = this.d.avatar();
    if (av) {
      if (cr.w > 0.15 && this.d.mode() !== 'first') {
        if (!av.act) {
          av.act = 'crouch';
          cr.mine = true;
        }
      } else if (cr.mine && av.act === 'crouch') {
        av.act = undefined;
        cr.mine = false;
      }
    }
    // first person: your eyes go down with you (after the controller placed the camera, before the hand's lean)
    if (this.d.mode() === 'first' && cr.w > 0) this.d.camera.position.y -= cr.dip * smooth(cr.w);
    if (!down && cr.w <= 0) {
      if (cr.mine && av?.act === 'crouch') av.act = undefined;
      this.crouch = null;
    }
  }

  /** start a part opening (1) or closing (0) */
  private move(p: Part, goal: 0 | 1) {
    if (p.goal === goal) return;
    const u = p.unit;
    p.goal = goal;
    if (goal === 0) this.reclaim(p);
    this.sound(p.tag.kind === 'door' ? (goal ? 'cab.open' : 'cab.close') : p.tag.kind === 'drawer' ? (goal ? 'drawer.open' : 'drawer.close') : 'shutter.roll', p);
    u.away = 0;
    if (!u.busy) {
      u.busy = true;
      this.showParts(u, true);
    }
    this.relabel(p);
  }

  private breakSeal(u: Unit) {
    const s = u.seal;
    if (!s || !s.intact) return;
    s.intact = false;
    s.gone = 0;
    if (s.obj) s.obj.visible = false;
    for (const b of s.broken) b.visible = true;
    this.sound('seal.snap', u.parts[u.parts.length - 1]);
    this.d.hint(`Seal no. ${s.no} broken. Note it on the check log: pharmacy will check and restock the cart and fit a new numbered seal.`, 8000);
    this.log.push(`seal ${u.id} ${s.no} broken`);
    for (const p of u.parts) this.relabel(p);
  }

  /** pharmacy has checked it: a new seal (a new number) */
  private reseal(u: Unit) {
    const s = u.seal;
    if (!s || s.intact) return;
    s.n++;
    const no = sealNumber(u.id, s.n);
    redrawLabel(`seal|${s.no}`, drawSeal(no));
    s.no = no;
    s.intact = true;
    if (s.obj) s.obj.visible = true;
    for (const b of s.broken) b.visible = false;
    this.log.push(`seal ${u.id} resealed ${no}`);
    for (const p of u.parts) this.relabel(p);
  }

  // ───────── the controlled-drug key ─────────

  private keyholder(level: number): Keyholder | null {
    return this.d.keyholders.find((k) => k.level === level) ?? null;
  }

  /** ask the nurse in charge for the key */
  private ask(u: Unit) {
    if (!u.lock) return;
    const kh = this.keyholder(u.level);
    u.lock.state = 'asked';
    for (const p of u.parts) this.relabel(p);
    const lockAt = (u.lock.barrel ?? u.g).getWorldPosition(new THREE.Vector3());
    const e: Errand = { unit: u, kh: kh!, phase: 'wait', t: 0, spot: { x: 0, z: 0, rot: 0 }, arm: 'R', reach: null, pressed: -1, lockAt, said: false };
    if (!kh) {
      // nobody to send for: the key comes up in a while
      e.phase = 'remote';
      this.errand = e;
      this.d.hint('The nurse in charge will bring the key in a minute.', 5000);
      return;
    }
    this.errand = e;
    const why = kh.busy();
    if (why || !kh.npcs.get(kh.id)) {
      this.d.hint(`${kh.name} is busy${why && why !== 'away' ? ` (${why.toLowerCase()})` : ''}: she'll bring the key in a minute.`, 5000);
      this.log.push(`ask ${kh.id}: busy`);
    } else {
      this.d.hint(`You ask ${kh.name} for the controlled-drug key. She's on her way.`, 4500);
      this.log.push(`ask ${kh.id}: coming`);
      this.go(e);
    }
  }

  /** the nurse sets off: where she'll stand to reach the lock, clear of you */
  private go(e: Errand) {
    const u = e.unit;
    const L = e.lockAt;
    const c = this.d.controller;
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const out of [0.48, 0.6, 0.72])
      for (const along of [0.42, 0.62, -0.42, -0.62, 0.22, -0.22]) {
        const x = L.x + u.front.x * out + u.across.x * along;
        const z = L.z + u.front.z * out + u.across.z * along;
        if (!this.d.free(x, z)) continue;
        const me = Math.hypot(x - c.pos.x, z - c.pos.y);
        if (me < 0.62) continue;
        // not in the door's swing either (she'll walk off as you open it, but she shouldn't stand there)
        const inDoor = u.parts.some((p) => this.inSwing(p, x, z));
        const cost = Math.hypot(along, out) + (inDoor ? 0.6 : 0);
        if (cost < bd) {
          bd = cost;
          best = { x, z };
        }
      }
    const spot = best ?? { x: L.x + u.front.x * 0.6, z: L.z + u.front.z * 0.6 };
    const rot = Math.atan2(L.x - spot.x, L.z - spot.z);
    e.spot = { x: spot.x, z: spot.z, rot };
    // the hand on the lock's side (right of her facing is (−cos, sin) of rot)
    const rx = -Math.cos(rot);
    const rz = Math.sin(rot);
    e.arm = (L.x - spot.x) * rx + (L.z - spot.z) * rz >= 0 ? 'R' : 'L';
    e.phase = 'walk';
    e.t = 0;
    e.kh.npcs.go(e.kh.id, spot.x, spot.z, rot, 1.35);
    e.kh.npcs.get(e.kh.id);
  }

  private errandStep(dt: number) {
    const e = this.errand;
    if (!e) return;
    e.t += dt;
    const u = e.unit;
    const lock = u.lock!;
    // you walked out (or went to another floor) before she got here: she goes back
    const gone = this.d.level() !== u.level || (this.d.room() !== u.room && this.youAway(u) > 3);
    if (gone && e.phase !== 'back' && e.phase !== 'unlock') {
      if (e.phase === 'walk') e.kh.npcs.home(e.kh.id);
      this.errand = null;
      lock.state = 'locked';
      for (const p of u.parts) this.relabel(p);
      this.log.push('errand: you left');
      return;
    }
    switch (e.phase) {
      case 'remote':
        if (e.t > 20) {
          this.unlock(u);
          this.d.hint('The nurse in charge has unlocked the controlled-drug cupboard for you.', 4000);
          this.errand = null;
        }
        break;
      case 'wait':
        if (e.t > BUSY_MAX || (!e.kh.busy() && e.kh.npcs.get(e.kh.id))) {
          if (!e.kh.npcs.get(e.kh.id)) {
            // she isn't anywhere you can see (off the floor): the key comes anyway
            e.phase = 'remote';
            e.t = 15;
            break;
          }
          this.d.hint(`${e.kh.name} is on her way with the key.`, 3500);
          this.go(e);
        }
        break;
      case 'walk': {
        const st = e.kh.npcs.get(e.kh.id);
        if (!st) {
          e.phase = 'remote';
          e.t = 10;
          break;
        }
        const there = Math.hypot(st.x - e.spot.x, st.z - e.spot.z) < 0.4;
        if ((there && !st.walking) || (there && e.t > 25)) {
          e.kh.npcs.face(e.kh.id, e.spot.rot);
          e.phase = 'unlock';
          e.t = 0;
          const reach = new Reach(this.d.scene);
          e.reach = reach;
          reach.start(e.lockAt, () => (e.pressed = e.t), { arm: e.arm, hold: 1.05 });
          this.log.push(`errand: ${e.kh.id} at the cupboard`);
        } else if (e.t > 50) {
          // never got through: she unlocks it when she can
          e.kh.npcs.home(e.kh.id);
          e.phase = 'remote';
          e.t = 18;
        }
        break;
      }
      case 'unlock': {
        e.kh.npcs.face(e.kh.id, e.spot.rot);
        e.reach?.update(dt);
        if (e.pressed >= 0) {
          const k = e.t - e.pressed;
          if (lock.key) lock.key.visible = k < 0.95;
          lock.want = k > 0.15 ? -Math.PI / 2 : 0;
          if (k > 0.45 && lock.state !== 'open') {
            this.unlock(u);
            this.log.push(`errand: unlocked by ${e.kh.id}`);
          }
          if (k > 0.6 && !e.said) {
            e.said = true;
            this.d.say(e.kh.id, "There you go, Doc. Sign the register when you take anything out, and a second nurse has to witness it and sign too.");
          }
        }
        if (e.reach && !e.reach.active && e.pressed >= 0) {
          if (lock.key) lock.key.visible = false;
          e.phase = 'back';
          e.t = 0;
          e.reach.dispose(this.d.scene);
          e.reach = null;
        }
        break;
      }
      case 'back':
        if (e.t > 1.2) {
          e.kh.npcs.home(e.kh.id);
          this.errand = null;
          this.log.push(`errand: ${e.kh.id} back`);
        }
        break;
    }
  }

  private unlock(u: Unit) {
    const lock = u.lock;
    if (!lock || lock.state === 'open') return;
    lock.state = 'open';
    lock.want = -Math.PI / 2;
    this.sound('lock.turn', u.parts[0]);
    for (const p of u.parts) this.relabel(p);
  }

  private relock(u: Unit) {
    const lock = u.lock;
    if (!lock || lock.state === 'locked') return;
    lock.state = 'locked';
    lock.want = 0;
    this.sound('lock.turn', u.parts[0]);
    this.log.push(`relock ${u.id}`);
    for (const p of u.parts) this.relabel(p);
  }

  // ───────── per frame ─────────

  /** seconds you've been away from (out of reach of) a unit */
  private youAway(u: Unit): number {
    return u.away;
  }

  update(dt: number) {
    this.now += dt;
    const c = this.d.controller;
    const lvl = this.d.level();
    const room = this.d.room();
    // a step out of the way, then the hand goes out
    const pd = this.pending;
    if (pd) {
      pd.t += dt;
      if (c.steering || pd.t > 4) this.pending = null;
      else if (!c.path) {
        this.pending = null;
        pd.act();
      }
    }
    this.errandStep(dt);
    this.crouchStep(dt);
    for (const u of this.units) {
      const near = lvl === u.level && Math.hypot(c.pos.x - u.center.x, c.pos.y - u.center.z) < AWAY_M;
      u.away = near ? 0 : u.away + dt;
      const open = u.parts.some((p) => p.goal === 1);
      // walked away from it: it closes itself (no hand)
      if (open && u.away > AWAY_S && !this.holdOpen) for (const p of u.parts) if (p.goal === 1) this.move(p, 0);
      // the controlled drugs lock again behind you (out of the room a moment): the door shuts, then the lock
      if (u.lock) {
        const out = lvl !== u.level || room !== u.room;
        u.lock.outFor = out ? u.lock.outFor + dt : 0;
        if (u.lock.state === 'open' && !this.errand && u.lock.outFor > 1.2) {
          for (const p of u.parts) if (p.goal === 1) this.move(p, 0);
          if (u.parts.every((p) => p.shown < 0.01)) {
            this.relock(u);
            this.d.hint('The controlled-drug cupboard has locked again behind you.', 3500);
          }
        }
        // asked and then walked off before she came: forgotten
        if ((u.lock.state === 'tried' || u.lock.state === 'asked') && !this.errand && u.lock.outFor > 2) {
          u.lock.state = 'locked';
          for (const p of u.parts) this.relabel(p);
        }
      }
      if (u.lock) {
        // the lock turns, the light shows while the door is open
        const L = u.lock;
        L.angle += Math.max(-dt * 6, Math.min(dt * 6, L.want - L.angle));
        if (L.barrel) L.barrel.rotation.z = L.angle;
        if (L.led) {
          const on = u.parts.some((p) => p.shown > 0.02);
          const m = L.led.material as THREE.MeshStandardMaterial;
          if (on !== !!L.led.userData.on) {
            L.led.userData.on = on;
            L.led.material = on ? ledOn() : ledOff(m);
          }
        }
      }
      if (u.seal && !u.seal.intact) {
        u.seal.gone = u.away > 0 && u.parts.every((p) => p.goal === 0) ? u.seal.gone + dt : 0;
        if (u.seal.gone > RESEAL_S) this.reseal(u);
      }
      if (u.busy) this.animate(u, dt);
    }
  }

  private animate(u: Unit, dt: number) {
    let moving = false;
    for (const p of u.parts) {
      const k = p.tag.kind;
      const before = p.t;
      p.t += (p.goal ? 1 : -1) * (dt / DUR[k]);
      p.t = Math.max(0, Math.min(1, p.t));
      let shown = smooth(p.t);
      if (k === 'door' && p.t > before) {
        const target = p.max * shown;
        const allowed = this.bodyLimit(p, p.max * smooth(before), target);
        if (allowed < target) {
          p.t = Math.max(before, inverseSmooth(allowed / p.max));
          shown = smooth(p.t);
        }
      }
      if (p.rattle > 0) p.rattle -= dt;
      const rattle = p.rattle > 0 ? Math.sin(p.rattle * 70) * 0.012 * (p.rattle / 0.35) : 0;
      p.shown = shown;
      this.pose(p, shown, rattle);
      // fully open: the things inside are yours to take
      if (p.goal === 1 && before < 0.999 && p.t >= 0.999) this.release(p);
      const vis = shown > 0.004;
      for (const o of p.inner) o.visible = vis;
      for (const s of p.stowed) s.inst.root.visible = vis || p.tag.kind === 'drawer';
      if (p.t !== before || p.rattle > 0 || (p.hand && !p.hand.done)) moving = true;
      if (p.hand && !p.hand.done) p.hand.retarget(this.handleWorld(p, this.tmp));
      else p.hand = null;
      if (p.t !== before || p.rattle > 0) this.deepen(p);
    }
    const anyOpen = u.parts.some((p) => p.shown > 0.0005 || p.goal === 1);
    if (!moving && !anyOpen) {
      u.busy = false;
      for (const p of u.parts) this.pose(p, 0, 0);
      this.showParts(u, false);
      // shut: the stowed things aren't drawn
      for (const p of u.parts) for (const s of p.stowed) s.inst.root.visible = false;
    }
  }

  /** put a part where `v` (0..1) of its opening says */
  private pose(p: Part, v: number, rattle: number) {
    const k = p.tag.kind;
    if (k === 'door') {
      const s = p.tag.hinge === 'L' ? -1 : 1;
      p.g.rotation.y = s * (v * p.max + rattle);
    } else if (k === 'drawer') {
      p.g.position.copy(p.base).addScaledVector(Z, v * p.max + rattle * 0.3);
    } else {
      const share = v * p.max;
      if (p.cover) p.cover.scale.y = Math.max(0.02, 1 - share);
      // the roll grows by what has wound onto it (8 mm of cover)
      if (p.roll) {
        const r = Math.sqrt(1 + (share * p.tag.size[1] * 0.008) / (Math.PI * 0.025 * 0.025));
        p.roll.scale.set(1, r, r);
      }
    }
    p.g.updateMatrixWorld(true);
  }

  /** the handle's world position now */
  private handleWorld(p: Part, out: THREE.Vector3): THREE.Vector3 {
    const h = p.tag.handle;
    if (p.tag.kind === 'shutter') {
      // the bottom edge of the cover, wherever it has rolled to
      const share = p.shown * p.max;
      out.set(h[0], -p.tag.size[1] * (1 - share) + 0.04, h[2]);
    } else out.set(h[0], h[1], h[2]);
    p.g.updateMatrixWorld(true);
    return out.applyMatrix4(p.g.matrixWorld);
  }

  /** the nurses' arms on the lock, after their animation (World.frame: after stepNpcs, gestures.afterPose) */
  afterPose() {
    const e = this.errand;
    if (e?.reach && e.phase === 'unlock') {
      const st = e.kh.npcs.get(e.kh.id);
      const c = this.d.controller;
      // only on a frame its animation was updated (in view, near you): else the IK would stack
      if (st && st.ch.root.visible && Math.hypot(st.x - c.pos.x, st.z - c.pos.y) < 12) {
        e.reach.applyArm(st.ch.root);
        // the key turns: the wrist rolls a quarter turn with the barrel
        if (e.pressed >= 0) this.twist(st.ch.root, e.arm, Math.min(1, Math.max(0, (e.t - e.pressed - 0.12) / 0.3)) * (e.t - e.pressed < 0.85 ? 1 : Math.max(0, 1 - (e.t - e.pressed - 0.85) / 0.2)));
      }
    }
    this.measureGrab();
  }

  private twist(root: THREE.Object3D, arm: 'R' | 'L', k: number) {
    if (k <= 0) return;
    let hand: THREE.Object3D | undefined;
    let fore: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (!hand && new RegExp(`_${arm}_Hand$`).test(o.name)) hand = o;
      if (!fore && new RegExp(`_${arm}_Forearm$`).test(o.name)) fore = o;
    });
    if (!hand || !fore) return;
    const a = fore.getWorldPosition(new THREE.Vector3());
    const b = hand.getWorldPosition(new THREE.Vector3());
    const axis = b.sub(a).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, (arm === 'R' ? -1 : 1) * k * 1.3);
    const qp = hand.parent!.getWorldQuaternion(new THREE.Quaternion());
    const local = qp.clone().invert().multiply(q).multiply(qp);
    hand.quaternion.premultiply(local);
    hand.updateMatrixWorld(true);
  }

  /** tests: while the hand holds a handle, how close the hand is to it (first person: the drawn hand; third: the bones) */
  private measureGrab() {
    const g = this.lastGrab;
    if (!g) return;
    const dbg = this.d.gestures.debug() as { active: boolean; weight?: number; pressed?: boolean; fp?: number[] | null };
    if (!dbg.active || !dbg.pressed || (dbg.weight ?? 0) < 0.97 || g.frames > 40) return;
    const p = this.byKey.get(g.part);
    if (!p) return;
    const handle = this.handleWorld(p, new THREE.Vector3());
    g.handle = handle.toArray().map(r3);
    g.frames++;
    if (this.d.mode() === 'first') {
      const fp = dbg.fp;
      if (fp) {
        const dd = Math.hypot(fp[0] - handle.x, fp[1] - handle.y, fp[2] - handle.z);
        g.fp = g.fp === null ? dd : Math.min(g.fp, dd);
      }
      return;
    }
    // third person: the nearest point of the hand's bones (wrist and finger joints) to the handle
    const root = this.d.avatarRoot();
    const arm = (this.d.gestures.debug() as { arm?: 'R' | 'L' }).arm ?? 'R';
    if (!root) return;
    if (!this.handBones || this.handBones.root !== root || this.handBones.side !== arm) {
      const bones: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (new RegExp(`_${arm}_(Hand|Finger\\d+)$`).test(o.name)) bones.push(o);
      });
      this.handBones = { root, side: arm, bones };
    }
    let best = Infinity;
    const pts = this.handBones.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    for (const b of this.handBones.bones) {
      const pa = b.getWorldPosition(new THREE.Vector3());
      for (const c of b.children) {
        if (!this.handBones.bones.includes(c)) continue;
        const pb = c.getWorldPosition(new THREE.Vector3());
        best = Math.min(best, segDist3(handle, pa, pb));
      }
    }
    for (const q of pts) best = Math.min(best, q.distanceTo(handle));
    if (Number.isFinite(best)) g.tp = g.tp === null ? best : Math.min(g.tp, best);
  }

  // ───────── labels ─────────

  private relabel(p: Part) {
    const label = this.label(p);
    if (label !== p.it.target.label) p.it.target = { kind: 'use', id: p.it.key, label };
  }

  private label(p: Part): string {
    const u = p.unit;
    if (this.isResidentDoor(p)) return (p.goal ? 'Close' : 'Open') + ' your locker · 13 · [F] View collection';
    const F = ' · [F] Inspect';
    const name = u.parts.length > 1 && p.tag.kind === 'door' && u.tag.role !== 'staffFridge' ? ` (${p.tag.name})` : '';
    if (p.tag.personal) return `${cap(p.tag.name)}: someone's own, locked${F}`;
    const lock = u.lock;
    if (lock && lock.state !== 'open') {
      const kh = this.keyholder(u.level);
      if (lock.state === 'tried') return `Ask ${kh?.name ?? 'the nurse in charge'} for the key${F}`;
      if (lock.state === 'asked') return `${kh?.name ?? 'The nurse in charge'} is bringing the key${F}`;
      return `Open the ${u.tag.noun}${F}`;
    }
    const noun = u.tag.role === 'staffFridge' ? (p.tag.name === 'freezer door' ? 'freezer' : 'fridge') : u.tag.role === 'lockers' ? p.tag.name : u.tag.noun;
    if (p.tag.kind === 'shutter') return `${p.goal ? 'Roll the cover down' : 'Roll up the cover'}${F}`;
    if (p.tag.kind === 'drawer') {
      const what = /^drawer [A-Z]/.test(p.tag.name) ? p.tag.name : `the ${p.tag.name}`;
      if (p.goal) return `Close ${what.replace(/:.*/, '')}${F}`;
      if (u.seal?.intact) return `Break the seal and open ${what} (emergency)${F}`;
      return `Open ${what}${F}`;
    }
    return `${p.goal ? 'Close' : 'Open'} the ${noun}${name}${F}`;
  }

  // ───────── sound ─────────

  private sound(name: string, p: Part | undefined) {
    if (!p) return;
    const at = p.closedBox.getCenter(this.tmp2);
    playSound(name, { at: { x: at.x, y: at.y, z: at.z }, gain: 0.9, range: 12 });
  }

  // ───────── tests ─────────

  debug() {
    const c = this.d.controller;
    return {
      units: this.units.map((u) => ({
        id: u.id,
        role: u.tag.role,
        level: u.level,
        room: u.room,
        center: u.center.toArray().map(r3),
        front: u.front.toArray().map(r3),
        lock: u.lock ? { state: u.lock.state, angle: r3(u.lock.angle) } : null,
        seal: u.seal ? { intact: u.seal.intact, no: u.seal.no } : null,
        busy: u.busy,
        shell: !!u.shell,
        parts: u.parts.map((p) => ({
          key: p.it.key,
          kind: p.tag.kind,
          name: p.tag.name,
          hinge: p.tag.hinge ?? null,
          goal: p.goal,
          open: r3(p.shown),
          max: r3(p.max),
          angleDeg: p.tag.kind === 'door' ? Math.round((p.shown * p.max * 180) / Math.PI) : null,
          travel: p.tag.kind === 'drawer' ? r3(p.shown * p.max) : null,
          label: p.it.target.label,
          handle: this.handleWorld(p, new THREE.Vector3()).toArray().map(r3),
          stowed: p.stowed.map((s) => s.inst.kind),
          out: p.out.map((o) => o.inst.id),
          box: [...p.it.box.min.toArray(), ...p.it.box.max.toArray()].map(r3),
        })),
      })),
      errand: this.errand ? { who: this.errand.kh.id, phase: this.errand.phase, t: r3(this.errand.t), spot: this.errand.spot, arm: this.errand.arm } : null,
      pending: !!this.pending,
      grab: this.lastGrab,
      log: this.log.slice(-20),
      you: { x: r3(c.pos.x), z: r3(c.pos.y) },
    };
  }

  /**
   * tests: 'audit' (each open door's panel against walls, neighbours and you), 'snap' ({ key, open }:
   * put a part open/closed at once), 'reseal' (unit id), 'grab' (clear the grab record), 'hold' (true:
   * nothing closes itself), 'blockers' (part key: what its swing would meet)
   */
  debugOp(op: string, arg?: unknown): unknown {
    if (op === 'audit') return this.audit();
    if (op === 'grab') {
      this.lastGrab = null;
      return true;
    }
    if (op === 'hold') {
      this.holdOpen = !!arg;
      return true;
    }
    if (op === 'snap') {
      const a = arg as { key: string; open: number };
      const p = this.byKey.get(a.key);
      if (!p) return false;
      p.goal = a.open > 0.5 ? 1 : 0;
      p.t = a.open;
      p.unit.busy = true;
      this.showParts(p.unit, true);
      if (p.goal === 1) this.release(p);
      this.relabel(p);
      return true;
    }
    if (op === 'blockers') {
      // what a door's swing would meet first (debugging clearances)
      const p = this.byKey.get(arg as string);
      if (!p || p.tag.kind !== 'door') return null;
      const u = p.unit;
      const own = u.body.clone().expandByScalar(0.06);
      const line = { hx: 0, hz: 0, dx: 0, dz: 0, w: 0 };
      const hits: unknown[] = [];
      for (let a = 0.02; a <= p.tag.max; a += 0.1) {
        this.doorLine(p, a, line);
        const x = line.hx + line.dx * line.w;
        const z = line.hz + line.dz * line.w;
        for (const b of this.d.built.colliders) if (x > b.min.x - 0.012 && x < b.max.x + 0.012 && z > b.min.z - 0.012 && z < b.max.z + 0.012 && !own.containsBox(b)) hits.push({ a: r3(a), at: [r3(x), r3(z)], box: [...b.min.toArray(), ...b.max.toArray()].map(r3) });
        if (hits.length > 3) break;
      }
      return { own: [...own.min.toArray(), ...own.max.toArray()].map(r3), hinge: [r3(line.hx), r3(line.hz)], hits };
    }
    if (op === 'reseal') {
      const u = this.units.find((x) => x.id === arg);
      if (u) this.reseal(u);
      return !!u;
    }
    return null;
  }

  /** every open door's panel (sampled along its length and height) inside a wall, a neighbour, or a body */
  private audit() {
    const out: { key: string; angleDeg: number; walls: number; neighbours: number; player: number; minClear: number }[] = [];
    const c = this.d.controller;
    for (const u of this.units) {
      u.g.updateMatrixWorld(true);
      const own = u.body.clone().expandByScalar(0.06);
      for (const p of u.parts) {
        if (p.tag.kind !== 'door' || p.shown < 0.01) continue;
        const y0 = (p.tag.y0 ?? 0) + u.g.getWorldPosition(this.tmp2).y;
        const y1 = y0 + p.tag.size[1];
        const walls = this.d.built.colliders.filter((b) => b.max.y > y0 + 0.02 && b.min.y < y1 - 0.02 && b.distanceToPoint(u.center) < 2.5 && !own.containsBox(b));
        const others = this.units.filter((v) => v !== u && v.level === u.level && v.center.distanceTo(u.center) < 2.5).map((v) => v.body.clone());
        const line = { hx: 0, hz: 0, dx: 0, dz: 0, w: 0 };
        this.doorLine(p, p.shown * p.max, line);
        let wn = 0;
        let nn = 0;
        let pl = 0;
        let minClear = Infinity;
        for (let k = 1; k <= 10; k++) {
          const x = line.hx + line.dx * line.w * (k / 10);
          const z = line.hz + line.dz * line.w * (k / 10);
          for (const b of walls) {
            if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) wn++;
            minClear = Math.min(minClear, Math.max(b.min.x - x, x - b.max.x, b.min.z - z, z - b.max.z));
          }
          for (const b of others) if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) nn++;
        }
        if (this.d.level() === u.level && segDist(c.pos.x, c.pos.y, line.hx, line.hz, line.hx + line.dx * line.w, line.hz + line.dz * line.w) < BODY_R - 0.02) pl++;
        out.push({ key: p.it.key, angleDeg: Math.round((p.shown * p.max * 180) / Math.PI), walls: wn, neighbours: nn, player: pl, minClear: r3(minClear) });
      }
    }
    return out;
  }

  dispose() {
    if (this.errand?.reach) this.errand.reach.dispose(this.d.scene);
    this.errand = null;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const Z = new THREE.Vector3(0, 0, 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function levelY(layout: LayoutDef, level: number): number {
  return level === 0 ? 0 : (upperLevels(layout).find((l) => l.index === level)?.y ?? 0);
}

/** distance from (px, pz) to the segment a–b */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function segDist3(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

function inverseSmooth(y: number): number {
  // smoothstep's inverse on [0, 1] (bisection: called rarely)
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (smooth(m) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** drawn: nothing between it and `top` is hidden (a drawer's inner group is, while it's shut) */
function visibleUnder(o: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a && a !== top; a = a.parent) if (a.userData.cabInner || a.userData.keep) return false;
  return true;
}

/** the controlled-drug cupboard's door-open light */
const ledOn = () => lambert('#ff3b30', { emissive: '#ff3b30', emissiveIntensity: 2.2, roughness: 0.3 });
const ledOff = (m: THREE.MeshStandardMaterial) => (m.emissiveIntensity > 0.5 ? lambert('#5a1512', { roughness: 0.3 }) : m);

// ───────────────────────────── sounds ─────────────────────────────

/** a cupboard door: the latch letting go, a little hinge creak */
function cabOpen(sr: number, rand: S.Rand): S.Pcm {
  const x = new Float32Array(Math.round(0.6 * sr));
  S.mix(x, S.burst(sr, rand, 0.02, 0.004, 2600, 'bandpass', 1.4), 0, 0.7);
  S.mix(x, S.burst(sr, rand, 0.05, 0.02, 700, 'bandpass', 0.9), 0.012 * sr, 0.35);
  const n = Math.round(0.32 * sr);
  const creak = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    ph += (2 * Math.PI * (430 + 160 * t + 30 * Math.sin(t * 40))) / sr;
    creak[i] = Math.sin(ph) * Math.sin(Math.PI * t) * 0.18 * (0.6 + 0.4 * Math.sin(t * 90));
  }
  S.mix(x, creak, 0.06 * sr, 1);
  return S.normalize(x, 0.8);
}
/** shut: a soft thud and the latch */
function cabClose(sr: number, rand: S.Rand): S.Pcm {
  const x = new Float32Array(Math.round(0.45 * sr));
  S.mix(x, S.tone(sr, 0.18, 120, 80, 0.05), 0, 0.7);
  S.mix(x, S.burst(sr, rand, 0.08, 0.02, 600, 'lowpass', 0.8), 0, 0.5);
  S.mix(x, S.burst(sr, rand, 0.02, 0.003, 3000, 'bandpass', 1.4), 0.03 * sr, 0.45);
  return S.normalize(x, 0.8);
}
/** a drawer on its runners, the contents shifting */
function drawerRun(open: boolean) {
  return (sr: number, rand: S.Rand): S.Pcm => {
    const dur = 0.45;
    const n = Math.round(dur * sr);
    const x = S.biquad(S.pink(n, rand), sr, 'bandpass', 900, 0.8);
    for (let i = 0; i < n; i++) x[i] *= Math.sin((Math.PI * i) / n) * 0.5;
    for (let t = 0.04; t < dur - 0.05; t += 0.03 + rand() * 0.05) S.mix(x, S.burst(sr, rand, 0.012, 0.003, 2400 + rand() * 1800, 'bandpass', 2), t * sr, 0.2);
    S.mix(x, S.burst(sr, rand, 0.03, 0.008, open ? 1200 : 700, 'bandpass', 1), (open ? dur - 0.03 : dur - 0.05) * sr, 0.6);
    return S.normalize(x, 0.8);
  };
}
/** the breakaway seal snapping */
function sealSnap(sr: number, rand: S.Rand): S.Pcm {
  const x = new Float32Array(Math.round(0.25 * sr));
  S.mix(x, S.burst(sr, rand, 0.012, 0.0025, 4200, 'highpass', 0.9), 0, 1);
  S.mix(x, S.burst(sr, rand, 0.03, 0.006, 1800, 'bandpass', 1.2), 0.004 * sr, 0.5);
  return S.normalize(x, 0.9);
}
/** a key turning in a cam lock: two clicks */
function lockTurn(sr: number, rand: S.Rand): S.Pcm {
  const x = new Float32Array(Math.round(0.4 * sr));
  S.mix(x, S.burst(sr, rand, 0.015, 0.003, 3400, 'bandpass', 2), 0, 0.8);
  S.mix(x, S.burst(sr, rand, 0.02, 0.004, 2200, 'bandpass', 1.6), 0.16 * sr, 1);
  S.mix(x, S.tone(sr, 0.06, 1900, 1700, 0.02), 0.162 * sr, 0.15);
  return S.normalize(x, 0.8);
}
/** a locked door pulled against its lock */
function lockRattle(sr: number, rand: S.Rand): S.Pcm {
  const x = new Float32Array(Math.round(0.35 * sr));
  for (let k = 0; k < 4; k++) S.mix(x, S.burst(sr, rand, 0.025, 0.006, 1500 + rand() * 900, 'bandpass', 1.1), (0.02 + k * 0.07 + rand() * 0.02) * sr, 0.7 - k * 0.12);
  return S.normalize(x, 0.8);
}
/** a vinyl cover rolling up */
function shutterRoll(sr: number, rand: S.Rand): S.Pcm {
  const dur = 1.0;
  const n = Math.round(dur * sr);
  const x = S.biquad(S.pink(n, rand), sr, 'bandpass', 1200, 0.6);
  for (let i = 0; i < n; i++) x[i] *= Math.pow(Math.sin((Math.PI * i) / n), 1.2) * 0.45;
  return S.normalize(x, 0.75);
}
const SOUNDS: Record<string, [(sr: number, r: S.Rand) => S.Pcm, number, string]> = {
  'cab.open': [cabOpen, -30, 'a cupboard door opening (cabinets.ts)'],
  'cab.close': [cabClose, -28, 'a cupboard door shutting (cabinets.ts)'],
  'drawer.open': [drawerRun(true), -30, 'a drawer sliding out (cabinets.ts)'],
  'drawer.close': [drawerRun(false), -29, 'a drawer sliding shut (cabinets.ts)'],
  'seal.snap': [sealSnap, -27, "a crash cart's breakaway seal snapping (cabinets.ts)"],
  'lock.turn': [lockTurn, -30, 'a key turning in a cupboard lock (cabinets.ts)'],
  'lock.rattle': [lockRattle, -29, 'a locked door pulled against its lock (cabinets.ts)'],
  'shutter.roll': [shutterRoll, -31, "a linen cart's cover rolling up (cabinets.ts)"],
};
for (const [k, [render, db, note]] of Object.entries(SOUNDS)) if (!BUILTIN_SOUNDS[k]) BUILTIN_SOUNDS[k] = { render, db, note };

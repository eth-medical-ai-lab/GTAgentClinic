import type { SavedItem } from '../../../shared/saveGame';
/**
 * Runtime for things you can pick up and inspect (see items.ts for the catalog).
 *
 *   [E] on an object     → pick it up into a free hand (right first, then left). A full hand never
 *                          swaps: with both hands full (or a two-handed thing) you get a hint instead.
 *                          A patient's belongings too: aimed at their owner, [E] hands them back (giveTarget).
 *   [F]                  → inspect what you last picked up: it floats in front of the camera, drag to rotate.
 *                          On a thing lying around with your hands empty: look at it there (it goes back).
 *   [G]                  → put the last thing you picked up on the surface you look at (or at your feet)
 *   [E] on equipment     → inspect in place (text only; closes when you walk away)
 *
 * In first person held things show at the bottom of the view (right hand lower right, left hand lower
 * left); in third person they sit in the avatar's palm with an arm pose to match (hands.ts).
 */
import * as THREE from 'three';
import { roomById, type LayoutDef } from '../../../shared/layout';
import type { ItemView, NpcView } from '../../../shared/types';
import { bedNear } from './bedding';
import type { BuiltWorld } from './builder';
import type { PlayerController } from './controls';
import type { GripStyle, HandSide, PlayerHands } from './hands';
import { FIXTURE_INFO, ITEM_KINDS, makeItem, scatterDecor, type ItemInstance } from './items';
import { accelerateRaycasts, warmRaycastGrids } from './rayGrid';

/** a label without its aside: "Margarethe Brunner's handbag (EMS brought it along)" → "Margarethe Brunner's handbag" */
const bare = (label: string) => label.replace(/\s*\([^)]*\)/g, '');

export interface InspectInfo {
  title: string;
  desc: string;
  /** server-side belonging: inspecting calls the `inspect` action (reveals history) */
  caseItemId?: string;
  /** true when a held object is shown in the 3D close-up */
  closeUp: boolean;
}

export interface ItemSystemDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: PlayerController;
  built: BuiltWorld;
  layout: LayoutDef;
  container: HTMLElement;
  input: HTMLElement;
  /** world-space right-hand position of the player's avatar (third person), or null */
  handWorld(out: THREE.Vector3): THREE.Vector3 | null;
  /** the player's hands (third person: things in the palm, arm poses); absent = old socket */
  hands?: PlayerHands;
  cameraMode(): 'first' | 'third' | 'top';
  onInspect(info: InspectInfo | null): void;
  hint(text: string, ms?: number): void;
}

/** a slot: one hand, or both for a two-handed thing */
export type Slot = HandSide | 'both';

/**
 * How things are held when the shape alone doesn't say: drinks stay level, bags hang by the
 * handle. Everything else: longer than 30 cm → at your side; 30 cm wide as well → both hands.
 */
const GRIP: Record<string, GripStyle> = {
  coffeeMug: 'upright',
  paperCup: 'upright',
  coffeeCup: 'upright',
  sodaCan: 'upright',
  waterCup: 'upright',
  urineCup: 'upright',
  pillCup: 'upright',
  waterBottle: 'upright',
  sanitizer: 'upright',
  tongueDepressors: 'upright',
  specimenTubes: 'upright',
  pillBottle: 'upright',
  napkins: 'upright',
  handbag: 'bag',
  sportsBag: 'bag',
  medBag: 'bag',
};

/** first-person view model: where each hand's things show (camera frame, metres) */
const FP: Record<Slot, { pos: [number, number, number]; rot: [number, number, number] }> = {
  R: { pos: [0.21, -0.23, -0.45], rot: [0.25, -0.35, 0] },
  L: { pos: [-0.21, -0.23, -0.45], rot: [0.25, 0.35, 0] },
  both: { pos: [0, -0.3, -0.5], rot: [0.45, 0, 0] },
};

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** ms after a belonging is set on a bed when it is set down again on what is under it */
const RESEAT = [300, 1000, 3000, 8000, 20000];
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _box = new THREE.Box3();

interface Hold {
  slot: Slot;
  style: GripStyle;
  size: THREE.Vector3;
  center: THREE.Vector3;
  /** where it is shown right now */
  shown: 'fp' | 'hand' | 'fallback' | null;
}

/** whose a belonging is (from the server view) */
interface Belonging {
  patientId: string;
  location: string;
  /** handed back (give_item): it lies on the bed beside them */
  given: boolean;
}

export class ItemSystem {
  readonly items = new Map<string, ItemInstance>();
  /** what each hand holds (a two-handed thing is in both) */
  readonly hands: Record<HandSide, ItemInstance | null> = { R: null, L: null };
  /** held things in the order they were picked up (last = most recent) */
  private order: ItemInstance[] = [];
  private holds = new Map<ItemInstance, Hold>();
  /** the close-up or a fixture's card; `from`: a thing looked at where it lay goes back there */
  private inspecting: { item?: ItemInstance; at: THREE.Vector2; from?: { pos: THREE.Vector3; yaw: number } } | null = null;
  private caseIds = new Map<string, string>(); // case item id → instance id
  private sockets: Record<Slot, THREE.Group> = { R: new THREE.Group(), L: new THREE.Group(), both: new THREE.Group() };
  /** no rigged avatar (procedural fallback body): things follow the hand position in the scene */
  private fallback = new THREE.Group();
  private dim: HTMLDivElement;
  private drag: { x: number; y: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private wasEnabled = true;

  constructor(private d: ItemSystemDeps) {
    for (const s of Object.keys(FP) as Slot[]) {
      this.sockets[s].position.set(...FP[s].pos);
      this.sockets[s].rotation.set(...FP[s].rot);
    }
    d.scene.add(this.fallback);
    if (!d.camera.parent) d.scene.add(d.camera);
    // decor clutter
    for (const [i, { inst, pos, yaw }] of scatterDecor(d.layout, d.built.details.surfaces).entries()) {
      inst.id = 'decor-' + i;
      this.place(inst, pos, yaw);
    }
    this.dim = document.createElement('div');
    this.dim.className = 'wl-inspect-dim';
    d.container.appendChild(this.dim);
    const down = (e: PointerEvent) => {
      if (!this.inspecting?.item) return;
      this.drag = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!this.drag || !this.inspecting?.item) return;
      const r = this.inspecting.item.root;
      r.rotation.y += (e.clientX - this.drag.x) * 0.012;
      r.rotation.x = Math.max(-1.4, Math.min(1.4, r.rotation.x + (e.clientY - this.drag.y) * 0.012));
      this.drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => (this.drag = null);
    d.input.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.disposers.push(() => {
      d.input.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.dim.remove();
    });
    // the world's raycast grids, built in the background so putting a thing down never waits for them
    this.disposers.push(warmRaycastGrids(d.built.root));
  }

  private disposers: (() => void)[] = [];
  /** the patients' belongings (instance id → owner) */
  private belong = new Map<string, Belonging>();
  /**
   * belongings handed back, on a bed: set down again on whatever is under them a few times after (the
   * patient's blanket drapes once their avatar is in; before that the probe finds the sheet)
   */
  private onBed = new Map<ItemInstance, { t: number; n: number }>();
  /** being handed over: first person, it hangs from the reaching hand (`at`) until it is let go */
  private handing: { inst: ItemInstance; at: () => THREE.Vector3 | null } | null = null;

  /** put a thing in the world at pos (its bottom centre), turned to yaw; it can be aimed at and picked up */
  placeAt(inst: ItemInstance, pos: THREE.Vector3, yaw: number) {
    this.release(inst);
    this.place(inst, pos, yaw);
  }

  private place(inst: ItemInstance, pos: THREE.Vector3, yaw: number) {
    inst.root.removeFromParent();
    inst.root.position.copy(pos);
    inst.root.rotation.set(0, yaw, 0);
    inst.root.scale.setScalar(1);
    this.d.scene.add(inst.root);
    inst.root.updateMatrixWorld(true);
    inst.box.setFromObject(inst.root).expandByScalar(0.035);
    this.items.set(inst.id, inst);
  }

  /** belongings from the server view: create/remove to match */
  sync(views: ItemView[] | undefined) {
    const want = new Set((views ?? []).map((v) => v.id));
    for (const v of views ?? []) {
      const known = this.caseIds.get(v.id);
      if (known) {
        // handed back (by you, or by the AI doctor): onto the bed beside them, unless it is in your hands
        const own = this.belong.get(known);
        const inst = this.items.get(known);
        if (own && inst && v.given && !own.given) {
          own.given = true;
          if (!this.holds.has(inst) && this.inspecting?.item !== inst) this.toBed(inst);
        }
        continue;
      }
      const spot = this.d.built.details.bedside.get(v.location);
      const inst = makeItem(v.kind, { label: v.label, caseItemId: v.id });
      inst.id = 'belonging-' + v.id;
      inst.desc = v.label;
      const pos = (spot ? (v.where === 'bedside' ? spot.table : v.where === 'chair' ? spot.chair : spot.foot) : new THREE.Vector3(0, 0, 0)).clone();
      this.caseIds.set(v.id, inst.id);
      this.belong.set(inst.id, { patientId: v.patientId, location: v.location, given: !!v.given });
      this.place(inst, pos, Math.PI * 0.15);
      if (v.given) this.toBed(inst);
    }
    for (const [caseId, instId] of this.caseIds) {
      if (want.has(caseId)) continue;
      const inst = this.items.get(instId);
      if (inst) {
        if (this.inspecting?.item === inst) this.close();
        if (this.handing?.inst === inst) this.handing = null;
        this.release(inst);
        inst.root.removeFromParent();
        this.items.delete(instId);
        this.onBed.delete(inst);
      }
      this.belong.delete(instId);
      this.caseIds.delete(caseId);
    }
  }

  snapshot(): SavedItem[] {
    return [...this.items.values()].map(inst => {
      const from = this.inspecting?.item === inst ? this.inspecting.from : undefined;
      const { x, y, z } = from?.pos ?? inst.root.position;
      return { key: inst.id, kind: inst.kind, label: inst.label, desc: inst.desc, x, y, z,
        yaw: from?.yaw ?? inst.root.rotation.y, hand: this.slotOf(inst) ?? undefined, order: this.order.indexOf(inst) };
    });
  }

  restore(saved: SavedItem[], extras: Map<string, ItemInstance>) {
    const old = new Map(this.items);
    for (const item of old.values()) this.remove(item);
    for (const row of [...saved].sort((a, b) => a.order - b.order)) {
      // Old slots can have the retired shears in either hand or lying on a surface.
      if (row.kind === 'traumaShears') continue;
      const item = old.get(row.key) ?? extras.get(row.key) ?? makeItem(row.kind);
      item.id = row.key;
      item.label = row.label;
      item.desc = row.desc;
      item.root.visible = true;
      this.place(item, new THREE.Vector3(row.x, row.y, row.z), row.yaw);
      if (row.hand) this.give(item, true, row.hand);
    }
  }

  /** candidates for the aim ray (everything lying around: not in a hand, not in the close-up) */
  targets(): ItemInstance[] {
    return [...this.items.values()].filter((i) => !this.holds.has(i) && i !== this.inspecting?.item);
  }

  /** the prompt for a thing lying around: a belonging says F looks inside it */
  targetLabel(it: ItemInstance): string {
    if (!it.pickable) return `Inspect ${it.label}`;
    return this.belong.has(it.id) ? `Pick up ${bare(it.label)} · [F] look inside` : `Pick up ${it.label}`;
  }

  /**
   * Holding a belonging of this patient and aiming at them: E hands it back (World: the hand holding
   * it goes to the bed beside them, handOver() leaves it there and the server hears give_item).
   */
  giveTarget(v: NpcView): { kind: 'use'; id: string; label: string } | null {
    if (v.role !== 'patient' || !v.patientId) return null;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const inst = this.order[i];
      if (this.belong.get(inst.id)?.patientId !== v.patientId || this.inspecting?.item === inst || this.handing?.inst === inst) continue;
      return { kind: 'use', id: `give:${inst.id}`, label: `Give the ${ITEM_KINDS[inst.kind]?.label ?? 'bag'} back to ${v.name}` };
    }
    return null;
  }

  isInspecting() {
    return !!this.inspecting;
  }

  // ───────────────────────────── hands ─────────────────────────────

  /** the thing picked up last (G puts this down first), or null */
  get held(): ItemInstance | null {
    return this.order[this.order.length - 1] ?? null;
  }

  /** everything in your hands, oldest first */
  heldItems(): readonly ItemInstance[] {
    return this.order;
  }

  slotOf(inst: ItemInstance): Slot | null {
    return this.holds.get(inst)?.slot ?? null;
  }

  /** how a thing is held, from its kind or its size (cached on the root) */
  gripOf(inst: ItemInstance): { style: GripStyle; size: THREE.Vector3; center: THREE.Vector3 } {
    const ud = inst.root.userData as { grip?: { style: GripStyle; size: THREE.Vector3; center: THREE.Vector3 } };
    if (ud.grip) return ud.grip;
    // measure in its own frame
    const r = inst.root;
    const parent = r.parent;
    const p = r.position.clone();
    const q = r.quaternion.clone();
    const s = r.scale.clone();
    r.removeFromParent();
    r.position.set(0, 0, 0);
    r.quaternion.identity();
    r.scale.setScalar(1);
    r.updateMatrixWorld(true);
    _box.setFromObject(r);
    const size = _box.getSize(new THREE.Vector3());
    const center = _box.getCenter(new THREE.Vector3());
    r.position.copy(p);
    r.quaternion.copy(q);
    r.scale.copy(s);
    parent?.add(r);
    const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
    const style: GripStyle = GRIP[inst.kind] ?? (dims[1] >= 0.3 ? 'both' : dims[0] > 0.3 ? 'side' : dims[2] < 0.35 * dims[1] ? 'flat' : 'can');
    ud.grip = { style, size, center };
    return ud.grip;
  }

  /** a free slot for this thing (right hand first), or null with the reason */
  freeSlot(inst: ItemInstance): { slot: Slot | null; why?: string } {
    const both = this.gripOf(inst).style === 'both';
    if (both) return this.hands.R || this.hands.L ? { slot: null, why: `The ${inst.label} needs both hands: put down what you're holding first (G)` } : { slot: 'both' };
    if (!this.hands.R) return { slot: 'R' };
    if (!this.hands.L) return { slot: 'L' };
    return { slot: null, why: 'Hands full: put something down first (G)' };
  }

  /** at least one hand free */
  hasFreeHand(): boolean {
    return !this.hands.R || !this.hands.L;
  }

  /**
   * Put a thing into a free hand (it may be lying in the world or brand new, e.g. a coffee from the
   * machine). Returns the slot, or null when the hands are full (the hint says why).
   */
  give(inst: ItemInstance, quiet = false, restoredSlot?: Slot): Slot | null {
    if (this.holds.has(inst)) return this.holds.get(inst)!.slot;
    const { slot: free, why } = this.freeSlot(inst);
    const slot = restoredSlot ?? free;
    if (!slot) {
      if (!quiet && why) this.d.hint(why, 3500);
      return null;
    }
    const g = this.gripOf(inst);
    inst.root.removeFromParent();
    this.onBed.delete(inst);
    this.items.set(inst.id, inst);
    this.holds.set(inst, { slot, style: g.style, size: g.size, center: g.center, shown: null });
    if (slot === 'both') this.hands.R = this.hands.L = inst;
    else this.hands[slot] = inst;
    this.order.push(inst);
    this.show(inst);
    if (!quiet) this.holdingHint();
    return slot;
  }

  /** out of the hands without putting it anywhere (amenities: a sip, the bin); stays in `items` */
  release(inst: ItemInstance) {
    const h = this.holds.get(inst);
    if (!h) return;
    this.d.hands?.unmount(inst.root);
    inst.root.removeFromParent();
    inst.root.scale.setScalar(1);
    this.holds.delete(inst);
    if (this.hands.R === inst) this.hands.R = null;
    if (this.hands.L === inst) this.hands.L = null;
    this.order = this.order.filter((x) => x !== inst);
  }

  /** gone for good (thrown away): out of the hands and the world */
  remove(inst: ItemInstance) {
    if (this.inspecting?.item === inst) this.close();
    this.release(inst);
    inst.root.removeFromParent();
    this.items.delete(inst.id);
  }

  /** a short line about what's in your hands */
  private holdingHint() {
    const [a, b] = this.order;
    if (!a) return;
    const last = this.held!;
    // a patient's belonging: what F does to it, and how it gets back to them
    if (!b && this.belong.has(a.id)) {
      this.d.hint(`Holding ${bare(a.label)} · [F] look inside · aim at the patient and [E] to give it back · [G] put down`, 6000);
      return;
    }
    this.d.hint(b ? `Holding the ${a.label} and the ${b.label} · [F] inspect · [G] put down the ${last.label}` : `Holding the ${a.label} · [F] inspect · [G] put down`, 4500);
  }

  /** show a held thing in its hand: first person at the bottom of the view, else in the palm */
  private show(inst: ItemInstance) {
    const h = this.holds.get(inst);
    if (!h || this.inspecting?.item === inst) return;
    const fp = this.d.cameraMode() === 'first';
    const want = fp ? 'fp' : 'hand';
    if (h.shown === want) return;
    this.d.hands?.unmount(inst.root);
    inst.root.removeFromParent();
    inst.root.scale.setScalar(1);
    if (fp) {
      const sock = this.sockets[h.slot];
      if (sock.parent !== this.d.camera) this.d.camera.add(sock);
      sock.add(inst.root);
      inst.root.position.set(0, 0, 0);
      inst.root.rotation.set(0, 0, 0);
      h.shown = 'fp';
      return;
    }
    if (this.d.hands?.mount(h.slot, inst.root, h.style, h.size, h.center)) {
      h.shown = 'hand';
      return;
    }
    this.fallback.add(inst.root);
    inst.root.position.set(h.slot === 'L' ? 0.3 : h.slot === 'R' ? -0.3 : 0, 0, 0);
    inst.root.rotation.set(0, 0, 0);
    h.shown = 'fallback';
  }

  // ───────────────────────────── keys ─────────────────────────────

  /** E on an item: pick it up into a free hand (or, for something you can't carry, just look) */
  interact(id: string) {
    const inst = this.items.get(id);
    if (!inst) return;
    if (!inst.pickable) {
      this.openFixture(inst.label, inst.desc);
      return;
    }
    // (a patient's belonging too: F looks inside it, and aimed at its owner E gives it back. It used to
    // open straight into the close-up and jump back, so a confused patient asking for her handbag
    // could never be given it)
    this.give(inst);
  }

  inspectKey() {
    if (this.inspecting) return this.close();
    if (this.held) this.openCloseUp(this.held);
  }

  /** F on a thing lying around, hands empty: the close-up, and back where it lay after. true if it did */
  lookAt(id: string): boolean {
    const inst = this.items.get(id);
    if (!inst || !inst.pickable || this.holds.has(inst) || !inst.root.parent) return false;
    const from = { pos: inst.root.position.clone(), yaw: inst.root.rotation.y };
    this.openCloseUp(inst);
    if (this.inspecting) this.inspecting.from = from;
    return true;
  }

  /** G: put the last thing you picked up on the surface you look at (ndc: the top-down mouse aim), or at your feet */
  dropKey(ndc?: THREE.Vector2) {
    const it = this.inspecting?.item;
    if (it) {
      this.close();
      // a belonging went back where it was; a held thing goes down below
      if (!this.holds.has(it)) return;
      this.putDown(it, false, ndc);
      return;
    }
    if (this.held) this.putDown(this.held, false, ndc);
  }

  /** (debug hook) put the last thing down where you aim (surface or floor). true if it did */
  putDownAimed(ndc?: THREE.Vector2): boolean {
    const it = this.held;
    if (!it) return false;
    if (this.inspecting?.item === it) this.close();
    this.putDown(it, false, ndc);
    return true;
  }

  /** equipment / non-portable: text only, closes when you walk away */
  openFixture(title: string, desc: string) {
    this.inspecting = { at: new THREE.Vector2(this.d.controller.pos.x, this.d.controller.pos.y) };
    this.d.onInspect({ title, desc, closeUp: false });
  }

  inspectSubject(subject: string) {
    const info = FIXTURE_INFO[subject];
    this.openFixture(info?.title ?? subject, info?.desc ?? '');
  }

  private openCloseUp(inst: ItemInstance) {
    if (this.inspecting?.item) this.close();
    this.inspecting = { item: inst, at: new THREE.Vector2(this.d.controller.pos.x, this.d.controller.pos.y) };
    this.wasEnabled = this.d.controller.enabled;
    this.d.controller.setEnabled(false);
    this.d.controller.allowItemKeys = true;
    // float in front of the camera, scaled to ~28 cm
    this.d.hands?.unmount(inst.root);
    inst.root.removeFromParent();
    const h = this.holds.get(inst);
    if (h) h.shown = null;
    this.d.camera.add(inst.root);
    inst.root.position.set(0, -0.02, -0.55);
    inst.root.rotation.set(0.5, 0.6, 0);
    inst.root.scale.setScalar(1);
    inst.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(inst.root).getSize(_v).length();
    inst.root.scale.setScalar(Math.min(4, 0.3 / Math.max(0.02, size)));
    // center it on its own bounding box
    inst.root.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(inst.root).getCenter(new THREE.Vector3());
    const local = this.d.camera.worldToLocal(c.clone());
    inst.root.position.x -= local.x;
    inst.root.position.y -= local.y + 0.02;
    this.dim.classList.add('on');
    this.d.onInspect({ title: inst.label, desc: inst.desc, caseItemId: inst.caseItemId, closeUp: true });
  }

  close() {
    const closing = this.inspecting;
    const it = closing?.item;
    this.inspecting = null;
    this.dim.classList.remove('on');
    if (it) {
      it.root.removeFromParent();
      it.root.scale.setScalar(1);
      const from = closing?.from;
      if (this.holds.has(it)) {
        // back to its hand
        this.show(it);
      } else if (from) {
        // looked at where it lay: back there
        this.place(it, from.pos, from.yaw);
        if (this.belong.get(it.id)?.given) this.onBed.set(it, { t: 0, n: 0 });
      } else if (this.items.has(it.id)) {
        // nowhere to go (shouldn't happen): at your feet rather than lost
        this.putDown(it, true);
      }
      this.d.controller.allowItemKeys = false;
      this.d.controller.setEnabled(this.wasEnabled);
    }
    this.d.onInspect(null);
  }

  /** where the crosshair (or the mouse in top-down) meets a surface you could put something on, within reach */
  aimedSurface(ndc?: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc ?? new THREE.Vector2(0, 0), this.d.camera);
    const top = this.d.cameraMode() === 'top';
    this.raycaster.far = top ? 200 : 2.8 + (this.d.cameraMode() === 'third' ? this.d.controller.thirdDist : 0);
    accelerateRaycasts(this.d.built.root);
    const hits = this.raycaster.intersectObject(this.d.built.root, true);
    for (const h of hits) {
      if (!visibleChain(h.object)) continue;
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (n && n.y > 0.6 && h.point.y < 2.0) {
        // within arm's reach of the player (third person and top-down aim from further away)
        if (Math.hypot(h.point.x - this.d.controller.pos.x, h.point.z - this.d.controller.pos.y) > 2.2) return null;
        return h.point.clone().setY(h.point.y + 0.002);
      }
      return null; // first visible hit is a wall/side face
    }
    return null;
  }

  /**
   * A free spot on a table, desk or counter within arm's reach (its top 0.6–1.25 m above your floor,
   * not a bed or stretcher), nearest a hand held out in front of you: straight-down probes in a
   * half-circle 0.45–0.9 m out, each needing the top to continue 5 cm all round (not hanging off an
   * edge) and no other thing already standing there.
   */
  private nearbySurface(): THREE.Vector3 | null {
    const c = this.d.controller;
    const floor = c.y;
    const rc = this.probe;
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    // (the world's merged meshes span the building: without the grid each probe tested every triangle)
    accelerateRaycasts(this.d.built.root);
    const topAt = (x: number, z: number): number | null => {
      rc.set(from.set(x, floor + 1.6, z), down);
      rc.far = 1.6;
      for (const h of rc.intersectObject(this.d.built.root, true)) {
        if (!visibleChain(h.object)) continue;
        const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
        return n && n.y > 0.9 ? h.point.y : null;
      }
      return null;
    };
    const hx = c.pos.x + Math.sin(c.facing) * 0.5;
    const hz = c.pos.y + Math.cos(c.facing) * 0.5;
    // best first (nearest the hand, then straightest ahead), so the first spot that passes is the one;
    // the sort is stable, so equal scores keep this order
    const spots: { x: number; z: number; score: number }[] = [];
    for (const r of [0.45, 0.6, 0.75, 0.9])
      for (let a = -80; a <= 80; a += 20) {
        const ang = c.facing + (a * Math.PI) / 180;
        const x = c.pos.x + Math.sin(ang) * r;
        const z = c.pos.y + Math.cos(ang) * r;
        spots.push({ x, z, score: Math.hypot(x - hx, z - hz) + Math.abs(a) / 400 });
      }
    spots.sort((p, q) => p.score - q.score);
    for (const { x, z } of spots) {
      const y = topAt(x, z);
      if (y === null || y - floor < 0.6 || y - floor > 1.25) continue;
      if (this.d.built.surfaces.some((s) => x >= s.box.min.x && x <= s.box.max.x && z >= s.box.min.z && z <= s.box.max.z)) continue;
      if ([[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]].some(([dx, dz]) => {
        const y2 = topAt(x + dx, z + dz);
        return y2 === null || Math.abs(y2 - y) > 0.01;
      })) continue;
      let taken = false;
      for (const it of this.items.values()) {
        if (!it.root.parent || this.holds.has(it)) continue;
        const p = it.root.getWorldPosition(from);
        if (Math.hypot(p.x - x, p.z - z) < 0.12 && Math.abs(p.y - y) < 0.3) {
          taken = true;
          break;
        }
      }
      if (taken) continue;
      return new THREE.Vector3(x, y + 0.002, z);
    }
    return null;
  }
  private probe = new THREE.Raycaster();

  /** put a held thing down on the surface under the aim (≤ reach), else at your feet */
  private putDown(inst: ItemInstance, atFeet: boolean, ndc?: THREE.Vector2) {
    if (!this.holds.has(inst)) return;
    this.release(inst);
    let pos = atFeet ? null : this.aimedSurface(ndc);
    // looking at the floor (or nothing) with a table, desk or counter in reach: it goes on that, as anyone
    // would put a coffee down, not on the floor beside the table. (A top-down click on the floor is kept.)
    if (!atFeet && !ndc && (!pos || pos.y - this.d.controller.y < 0.3)) pos = this.nearbySurface() ?? pos;
    if (!pos) {
      const yaw = this.d.controller.facing;
      pos = new THREE.Vector3(this.d.controller.pos.x + Math.sin(yaw) * 0.55, this.d.controller.y + 0.002, this.d.controller.pos.y + Math.cos(yaw) * 0.55);
    }
    this.place(inst, pos, this.d.controller.facing);
    this.d.hint(this.order.length ? `Put down the ${inst.label} · still holding the ${this.held!.label}` : `Put down the ${inst.label}`, 1800);
  }

  // ───────────────────────────── handing a belonging back ─────────────────────────────

  /**
   * Where a belonging handed back lies: on the mattress beside the patient's hip and upper thigh, on
   * the side the doctor stands at (the room's bedside spot), its long side along the bed. That keeps
   * it clear of the backrest's hinge (5 cm toward the foot from the middle) and of elbows by the waist.
   * Its height is probed straight down (the blanket, else the sheet). `stand`: where you hand it over
   * from, beside the bed level with it. null if the bed isn't found.
   */
  bedSpot(instId: string): { pos: THREE.Vector3; yaw: number; stand: THREE.Vector2 } | null {
    const own = this.belong.get(instId);
    const room = own ? roomById(this.d.layout, own.location) : undefined;
    const at = room?.spots.bed;
    const bed = at ? bedNear(at.x, at.z) : null;
    if (!room || !bed) return null;
    // the bed's frame: head at local −z; its right (cos, −sin), toward the foot (sin, cos)
    const c = Math.cos(bed.rot);
    const sn = Math.sin(bed.rot);
    const doc = room.spots.bedside;
    const side = doc ? Math.sign((doc.x - bed.x) * c - (doc.z - bed.z) * sn) || 1 : 1;
    const out = Math.min(0.31, bed.spec.hw - 0.09) * side;
    const along = 0.24;
    const x = bed.x + c * out + sn * along;
    const z = bed.z - sn * out + c * along;
    const y = this.topBelow(x, z);
    // (a body's width out from the rail)
    const so = (bed.spec.W / 2 + 0.32) * side;
    const stand = new THREE.Vector2(bed.x + c * so + sn * along, bed.z - sn * so + c * along);
    return y === null ? null : { pos: new THREE.Vector3(x, y + 0.002, z), yaw: bed.rot - Math.PI / 2, stand };
  }

  /** the top of whatever is under (x, z) 0.3–1.3 m up: a blanket, a sheet (not a body, not one of these things) */
  private topBelow(x: number, z: number): number | null {
    const rc = this.probe;
    rc.set(new THREE.Vector3(x, 1.3, z), DOWN);
    rc.far = 1.0;
    rc.camera = this.d.camera;
    const mine = new Set<THREE.Object3D>();
    for (const it of this.items.values()) mine.add(it.root);
    const ours = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (mine.has(p)) return true;
      return false;
    };
    accelerateRaycasts(this.d.scene);
    for (const h of rc.intersectObject(this.d.scene, true)) {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !visibleChain(m) || ours(m)) continue;
      // (a blanket is double-sided: its face normal may point down)
      const n = h.face?.normal.clone().transformDirection(m.matrixWorld);
      if (!n || Math.abs(n.y) < 0.5) continue;
      return h.point.y;
    }
    return null;
  }

  /** a handed-back belonging onto the bed beside its owner; false if the bed isn't found (it stays put) */
  private toBed(inst: ItemInstance): boolean {
    const spot = this.bedSpot(inst.id);
    if (!spot) return false;
    this.release(inst);
    this.place(inst, spot.pos, spot.yaw);
    this.onBed.set(inst, { t: performance.now(), n: 0 });
    return true;
  }

  /**
   * E on the patient while holding their belonging (giveTarget): where the hand goes (where the handle
   * will be once it stands on the bed) and which hand. World reaches (gesture.ts) and calls handOver()
   * when the hand gets there; in first person it hangs from the reaching hand (`fpHand`) meanwhile.
   */
  handOverStart(instId: string, fpHand: () => THREE.Vector3 | null): { at: THREE.Vector3; arm: HandSide } | null {
    const inst = this.items.get(instId);
    const h = inst ? this.holds.get(inst) : undefined;
    const spot = inst && h ? this.bedSpot(instId) : null;
    if (!inst || !h || !spot) return null;
    if (this.inspecting?.item === inst) this.close();
    this.handing = { inst, at: fpHand };
    return { at: spot.pos.clone().setY(spot.pos.y + h.size.y), arm: h.slot === 'L' ? 'L' : 'R' };
  }

  /** the hand got there: it stays on the bed. Returns its case item id (for give_item), or null */
  handOver(instId: string): string | null {
    const inst = this.items.get(instId);
    if (inst && this.handing?.inst === inst) this.handing = null;
    if (!inst || !this.holds.has(inst) || !this.toBed(inst)) return null;
    this.d.hint(`Gave ${bare(inst.label)} back`, 2500);
    return inst.caseItemId ?? null;
  }

  /** per frame: held things in the view / in the palms; auto-close fixture text when you walk off */
  update() {
    const fp = this.d.cameraMode() === 'first';
    const hd = this.handing;
    const hangAt = hd && fp ? hd.at() : null;
    for (const inst of this.order) {
      const h = this.holds.get(inst)!;
      if (this.inspecting?.item === inst) continue;
      if (hangAt && hd!.inst === inst) {
        // handing it over in first person: it hangs from the reaching hand's fingers by its handle, not
        // from the corner of the view (third person: it is in the palm, and the arm reaches)
        if (inst.root.parent !== this.d.scene) {
          this.d.hands?.unmount(inst.root);
          inst.root.removeFromParent();
          inst.root.scale.setScalar(1);
          this.d.scene.add(inst.root);
          h.shown = null;
        }
        inst.root.position.set(hangAt.x, hangAt.y - h.size.y + 0.012, hangAt.z);
        inst.root.rotation.set(0, this.d.controller.facing - Math.PI / 2, 0);
        continue;
      }
      // third person before the avatar is in: near the hand position until the palm can take it
      const waiting = !fp && h.shown === 'fallback' && !this.d.hands?.ready();
      if (h.shown !== (fp ? 'fp' : 'hand') && !waiting) this.show(inst);
      // first person: drinks stay level whatever the head does
      if (h.shown === 'fp' && h.style === 'upright') {
        inst.root.parent!.getWorldQuaternion(_q);
        _q2.setFromAxisAngle(UP, this.d.controller.yaw);
        inst.root.quaternion.copy(_q.invert().multiply(_q2));
      }
    }
    // fallback (no rigged avatar): things near the hand position, turned with the body
    if (this.fallback.children.length) {
      const p = this.d.handWorld(_v);
      if (p) this.fallback.position.copy(p);
      else this.fallback.position.set(this.d.controller.pos.x + Math.sin(this.d.controller.facing) * 0.3, 0.95, this.d.controller.pos.y + Math.cos(this.d.controller.facing) * 0.3);
      this.fallback.rotation.set(0, this.d.controller.facing, 0);
    }
    if (this.inspecting && !this.inspecting.item) {
      const d = Math.hypot(this.d.controller.pos.x - this.inspecting.at.x, this.d.controller.pos.y - this.inspecting.at.y);
      if (d > 2.5) this.close();
    }
    // things handed back: set down again on what is under them 0.3, 1, 3, 8 and 20 s after (the
    // blanket drapes once the patient's avatar is in), then left alone
    if (this.onBed.size) {
      const now = performance.now();
      for (const [inst, b] of this.onBed) {
        if (now - b.t < RESEAT[b.n]) continue;
        b.n++;
        if (b.n >= RESEAT.length) this.onBed.delete(inst);
        if (!inst.root.parent || this.holds.has(inst)) continue;
        const p = inst.root.position;
        const y = this.topBelow(p.x, p.z);
        if (y !== null && Math.abs(y + 0.002 - p.y) > 0.002) this.place(inst, p.clone().setY(y + 0.002), inst.root.rotation.y);
      }
    }
  }

  dispose() {
    for (const f of this.disposers) f();
    for (const s of Object.values(this.sockets)) s.removeFromParent();
    this.fallback.removeFromParent();
  }
}

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

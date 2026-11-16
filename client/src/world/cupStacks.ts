/**
 * Where the cups come from (amenities.ts): beside the cafeteria's self-serve machine a stack of paper
 * cups and a stack of lids, and in the staff workroom a rack of mugs. You take the top one and the
 * stack gets one shorter. The cafeteria restocks a stack that runs low (or empty) after a while, and
 * a washed mug comes back to the rack now and then; never while your hand is there.
 *
 * Paper cups nest: each sits 12 mm higher than the one it stands in, so a stack is the bottom cup
 * with a 12 mm band of each cup above it (rim over rim), and you look into the top one. Only the top
 * cup can be taken, by its rim. Lids nest 4 mm apart. Each stack is one lathe, rebuilt when it
 * changes (a few hundred vertices), so a stack is one draw whatever its height.
 */
import * as THREE from 'three';
import { G, lambert, trackGeo } from './materials';

/** the cafeteria's 12 oz paper cup (amenities.ts buildCup): bottom and top radius, height (m) */
export const PAPER = { r0: 0.029, r1: 0.0425, H: 0.115 };
/** how much higher each cup in a stack stands than the one it is in */
export const CUP_STEP = 0.012;
/** lids stack tighter */
export const LID_STEP = 0.0042;
/** a lid on a cup: its skirt reaches this far below the rim */
export const LID_SEAT = 0.0015;

const rAt = (y: number) => PAPER.r0 + ((PAPER.r1 - PAPER.r0) * y) / PAPER.H;
const V = (pts: [number, number][]) => pts.map(([r, y]) => new THREE.Vector2(r, y));

/** a stack of n nested cups, rim over rim, and the inside of the top one (stack frame: bottom centre, y up) */
function cupStackProfile(n: number): THREE.Vector2[] {
  const { r0, r1, H } = PAPER;
  const pts: [number, number][] = [[0, 0], [r0, 0], [r0, 0.004], [r1, H], [r1 + 0.0016, H + 0.0012], [r1 + 0.0004, H + 0.0026]];
  for (let i = 1; i < n; i++) {
    const y0 = i * CUP_STEP;
    // the next cup's wall comes up out of the rim below it
    const ye = (i - 1) * CUP_STEP + H + 0.0026;
    pts.push([rAt(ye - y0) - 0.0002, ye], [r1, y0 + H], [r1 + 0.0016, y0 + H + 0.0012], [r1 + 0.0004, y0 + H + 0.0026]);
  }
  const top = (n - 1) * CUP_STEP;
  pts.push([r1 - 0.0008, top + H], [r0 - 0.0004, top + 0.006], [0, top + 0.006]);
  return V(pts);
}

/** one lid (its frame: the bottom of the skirt, y up): skirt, the raised drinking ring, the recess */
const LID_PROFILE: [number, number][] = [
  [0.0444, 0],
  [0.0462, 0.0015],
  [0.0465, 0.0065],
  [0.0455, 0.0095],
  [0.0405, 0.0125],
  [0.036, 0.0125],
  [0.0335, 0.0085],
  [0.031, 0.0045],
  [0, 0.0045],
];
export const LID_TOP = 0.0125;

function lidStackProfile(n: number): THREE.Vector2[] {
  const pts: [number, number][] = [[0, 0], [0.0446, 0]];
  for (let i = 0; i < n; i++) {
    const y = i * LID_STEP;
    pts.push([0.0462, y + 0.0012], [0.0467, y + 0.0028], [0.046, y + LID_STEP - 0.0002]);
  }
  const yt = (n - 1) * LID_STEP;
  for (const [r, y] of LID_PROFILE.slice(2)) pts.push([r, yt + y]);
  return V(pts);
}

// (materials.ts caches these by their look; the world's dispose frees them)
// (lathes: both faces, whichever way the profile winds)
const lidMaterial = () => lambert('#24211f', { roughness: 0.42, side: THREE.DoubleSide });
const paperMat = () => lambert('#f6f4ee', { roughness: 0.85, side: THREE.DoubleSide });

/** a lid for a paper cup (its frame: the skirt's bottom; the drinking slot faces +z) */
export function buildLid(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lid';
  const body = new THREE.Mesh(trackGeo(new THREE.LatheGeometry(V(LID_PROFILE), 32)), lidMaterial());
  const slot = new THREE.Mesh(G.box(0.011, 0.0012, 0.0035), lambert('#050505', { roughness: 0.9 }));
  slot.position.set(0, LID_TOP + 0.0002, 0.0383);
  g.add(body, slot);
  for (const c of g.children) {
    c.castShadow = true;
    c.receiveShadow = true;
  }
  return g;
}

interface Restock {
  /** s since the stack last changed */
  idle: number;
}

/**
 * Nested things standing on a counter (cups or lids): `count` of them, the top one taken by hand.
 * Its frame is the counter point under the stack's middle; yaw turns it with the counter.
 */
abstract class Stack {
  readonly group = new THREE.Group();
  protected mesh: THREE.Mesh;
  count: number;
  /** how many it holds when full */
  readonly full: number;
  private restock: Restock = { idle: 0 };
  /** restocks so far (tests) */
  restocked = 0;

  constructor(
    scene: THREE.Scene,
    readonly base: THREE.Vector3,
    full: number,
    mat: THREE.Material,
  ) {
    this.full = full;
    this.count = full;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.position.copy(base);
    scene.add(this.group);
    this.rebuild();
  }

  protected abstract profile(n: number): THREE.Vector2[];
  /** height of the top one's bottom above the base */
  protected abstract topAt(n: number): number;

  protected rebuild() {
    this.mesh.geometry.dispose();
    this.mesh.visible = this.count > 0;
    this.mesh.geometry = this.count > 0 ? new THREE.LatheGeometry(this.profile(this.count), 28) : new THREE.BufferGeometry();
  }

  /** where the top one stands (its bottom centre), world; null when empty */
  top(out = new THREE.Vector3()): THREE.Vector3 | null {
    if (this.count <= 0) return null;
    return out.copy(this.base).setY(this.base.y + this.topAt(this.count));
  }

  /** the top one has been taken: one fewer */
  take(): boolean {
    if (this.count <= 0) return false;
    this.count--;
    this.restock.idle = 0;
    this.rebuild();
    return true;
  }

  /**
   * Per frame: a stack running low is topped up after a while, an empty one sooner (someone from the
   * counter restocks it), but never while a hand is at it (`busy`).
   */
  update(dt: number, busy: boolean) {
    this.restock.idle = busy ? 0 : this.restock.idle + dt;
    const wait = this.count === 0 ? 6 : this.count <= 3 ? 25 : Infinity;
    if (this.restock.idle >= wait) this.refill();
  }

  /** topped up to full */
  refill() {
    this.count = this.full;
    this.restock.idle = 0;
    this.restocked++;
    this.rebuild();
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/** paper cups, nested rim over rim; the bottom one's printed sleeve shows */
export class CupStack extends Stack {
  private sleeve: THREE.Group;

  constructor(scene: THREE.Scene, base: THREE.Vector3, full = 18) {
    super(scene, base, full, paperMat());
    // the bottom cup's kraft sleeve and printed band (the others' are hidden inside it)
    this.sleeve = new THREE.Group();
    const at = (y: number) => rAt(y) + 0.0011;
    const lathe = (pts: [number, number][], mat: THREE.Material) => {
      const m = new THREE.Mesh(trackGeo(new THREE.LatheGeometry(V(pts), 28)), mat);
      m.castShadow = true;
      return m;
    };
    this.sleeve.add(lathe([[at(0.032), 0.032], [at(0.084), 0.084]], lambert('#9c6b3d', { roughness: 0.92 })), lathe([[at(0.092), 0.092], [at(0.1), 0.1]], lambert('#2bb3a3', { roughness: 0.6 })));
    this.group.add(this.sleeve);
    this.rebuild();
  }

  protected profile(n: number) {
    return cupStackProfile(n);
  }

  protected topAt(n: number) {
    return (n - 1) * CUP_STEP;
  }

  protected rebuild() {
    super.rebuild();
    if (this.sleeve) this.sleeve.visible = this.count > 0;
  }

  /** the top cup's rim centre, world (where the fingers take it) */
  rim(out = new THREE.Vector3()): THREE.Vector3 | null {
    const t = this.top(out);
    return t ? t.setY(t.y + PAPER.H) : null;
  }
}

/** lids for the paper cups, nested */
export class LidStack extends Stack {
  constructor(scene: THREE.Scene, base: THREE.Vector3, full = 30) {
    super(scene, base, full, lidMaterial());
  }

  protected profile(n: number) {
    return lidStackProfile(n);
  }

  protected topAt(n: number) {
    return (n - 1) * LID_STEP;
  }

  /** the top lid's top centre, world (where the fingers take it) */
  lidTop(out = new THREE.Vector3()): THREE.Vector3 | null {
    const t = this.top(out);
    return t ? t.setY(t.y + LID_TOP) : null;
  }
}

/** a mug as amenities.ts builds it (its root's origin: the bottom centre) */
export interface RackMug {
  root: THREE.Group;
}

/**
 * The staff workroom's mug rack: a small two-shelf wooden rack on the counter beside the machine,
 * three mugs a shelf, handles to the back. Mugs are taken from the front of the top shelf first.
 * A washed mug comes back to an empty place every minute or so, while nobody is at the rack.
 */
export class MugRack {
  readonly group = new THREE.Group();
  /** places for mugs (world: bottom centre) and what stands there */
  readonly slots: { at: THREE.Vector3; mug: RackMug | null }[] = [];
  private idle = 0;
  /** mugs put back so far (tests) */
  returned = 0;
  private made = 0;

  constructor(
    private scene: THREE.Scene,
    /** the rack's base centre on the counter (world), the counter's yaw */
    readonly base: THREE.Vector3,
    readonly yaw: number,
    private make: (i: number) => RackMug,
  ) {
    const wood = lambert('#a4774f', { roughness: 0.62 });
    const W = 0.33;
    const D = 0.17;
    const SHELF = 0.135;
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(G.rbox(w, h, d, 0.003), wood);
      m.position.set(x, y + h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    };
    add(W, 0.012, D, 0, 0, 0);
    add(W, 0.012, D, 0, SHELF, 0);
    for (const s of [-1, 1]) add(0.012, SHELF + 0.05, D, s * (W / 2 - 0.006), 0, 0);
    // a low rail along the back of each shelf
    for (const y of [0.012, SHELF + 0.012]) add(W - 0.024, 0.022, 0.01, 0, y, -D / 2 + 0.005);
    this.group.position.copy(base);
    this.group.rotation.y = yaw;
    scene.add(this.group);
    this.group.updateMatrixWorld(true);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // top shelf first (the front row a hand reaches first), then the bottom one
    for (const y of [SHELF + 0.012, 0.012])
      for (const lx of [-0.1, 0, 0.1]) {
        const lz = 0.012;
        const at = new THREE.Vector3(base.x + lx * c + lz * s, base.y + y, base.z - lx * s + lz * c);
        this.slots.push({ at, mug: null });
      }
    for (let i = 0; i < this.slots.length; i++) this.fill(i);
  }

  private fill(i: number) {
    const slot = this.slots[i];
    if (slot.mug) return;
    const mug = this.make(this.made++);
    mug.root.position.copy(slot.at);
    // handles to the back of the rack (amenities.ts: the mug's handle is on its +x)
    mug.root.rotation.set(0, this.yaw + Math.PI / 2, 0);
    this.scene.add(mug.root);
    slot.mug = mug;
  }

  get count(): number {
    return this.slots.filter((s) => s.mug).length;
  }

  /** the mug a hand takes next (front of the top shelf first), or null */
  next(): { i: number; mug: RackMug; at: THREE.Vector3 } | null {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.mug) return { i, mug: s.mug, at: s.at };
    }
    return null;
  }

  /** a mug has been taken off the rack (it is the caller's now) */
  take(i: number) {
    this.slots[i].mug = null;
    this.idle = 0;
  }

  update(dt: number, busy: boolean, playerNear: boolean) {
    this.idle = busy || playerNear ? 0 : this.idle + dt;
    if (this.idle < 60) return;
    const empty = this.slots.findIndex((s) => !s.mug);
    this.idle = 0;
    if (empty < 0) return;
    this.fill(empty);
    this.returned++;
  }

  dispose() {
    this.group.removeFromParent();
    for (const s of this.slots) s.mug?.root.removeFromParent();
  }
}

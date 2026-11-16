/**
 * Grid A* over the floor plan (rasterized from collider boxes, inflated by the agent
 * radius) with line-of-sight path smoothing. Used for NPC walking and top-down
 * click-to-move.
 *
 * NPCs walk on a second layer (npcLayer(), NpcNav below): furniture blocks their paths by its
 * real footprint (chairs, stools, beds, desks, carts…: `Footprint`, from the built geometry), on
 * top of the walls and solid props. A clearance field (exact distance to the nearest obstacle on
 * 10 cm cells) keeps walkers ≥ 0.3 m from furniture and people; routes are A* on the coarse grid
 * (preferring the middle of an aisle), string-pulled, their corners rounded with 0.22–0.8 m arcs
 * (as large as the room allows), and resampled every 10 cm with curvature, a speed limit and the
 * free room on either side. steering.ts walks them. The player keeps the plain layer.
 */
import * as THREE from 'three';

export class NavGrid {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;
  /** the boxes it was built from (the NPC layer's clearance field starts from them) */
  readonly colliders: THREE.Box3[];
  private npc: NpcNav | null = null;

  constructor(colliders: THREE.Box3[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, cell = 0.35, radius = 0.27) {
    this.cell = cell;
    this.colliders = colliders;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.maxX = bounds.maxX;
    this.maxZ = bounds.maxZ;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const b of colliders) this.mark(b, radius);
  }

  /**
   * Things that became solid after the grid was built (the desk chairs, made solid by
   * workstationChairs.ts after the world's nav grid exists): routes go round them from now on.
   */
  addBlockers(boxes: THREE.Box3[], radius: number) {
    for (const b of boxes) this.mark(b, radius);
  }

  private mark(b: THREE.Box3, radius: number) {
    const cell = this.cell;
    const x0 = b.min.x - radius;
    const x1 = b.max.x + radius;
    const z0 = b.min.z - radius;
    const z1 = b.max.z + radius;
    const c0 = Math.max(0, Math.floor((x0 - this.minX) / cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.minX) / cell));
    const r0 = Math.max(0, Math.floor((z0 - this.minZ) / cell));
    const r1 = Math.min(this.rows - 1, Math.floor((z1 - this.minZ) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = this.minX + (c + 0.5) * cell;
        const cz = this.minZ + (r + 0.5) * cell;
        if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) this.blocked[r * this.cols + c] = 1;
      }
    }
  }

  /** A click route gets the current crowd as well as the fixed furniture. The next click sees a fresh crowd. */
  withPeople(people: readonly Disc[], radius: number): NavGrid {
    if (!people.length) return this;
    const grid = new NavGrid([], this, this.cell);
    grid.blocked.set(this.blocked);
    for (const p of people) {
      const clearance = p.r + radius;
      const [c0, r0] = this.toCell(p.x - clearance, p.z - clearance);
      const [c1, r1] = this.toCell(p.x + clearance, p.z + clearance);
      for (let r = Math.max(0, r0); r <= Math.min(r1, this.rows - 1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(c1, this.cols - 1); c++) {
          const [x, z] = this.center(c, r);
          if (Math.hypot(x - p.x, z - p.z) <= clearance) grid.blocked[r * this.cols + c] = 1;
        }
      }
    }
    return grid;
  }

  /** the NPC layer (furniture by footprint, clearance field, smoothed routes); built once, on first call */
  npcLayer(footprints: Footprint[] = []): NpcNav {
    this.npc ??= new NpcNav(this, footprints);
    return this.npc;
  }

  private inside(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  isFree(c: number, r: number) {
    return this.inside(c, r) && this.blocked[r * this.cols + c] === 0;
  }

  isFreeAt(x: number, z: number) {
    const [c, r] = this.toCell(x, z);
    return this.isFree(c, r);
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }

  center(c: number, r: number): [number, number] {
    return [this.minX + (c + 0.5) * this.cell, this.minZ + (r + 0.5) * this.cell];
  }

  nearestFree(c: number, r: number, maxRing = 12): [number, number] | null {
    if (this.isFree(c, r)) return [c, r];
    for (let ring = 1; ring <= maxRing; ring++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          if (this.isFree(c + dc, r + dr)) {
            const d = dc * dc + dr * dr;
            if (d < bestD) {
              bestD = d;
              best = [c + dc, r + dr];
            }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (this.cell * 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps);
      const [c, r] = this.toCell(ax + dx * t, az + dz * t);
      if (!this.isFree(c, r)) return false;
    }
    return true;
  }

  /** Returns world-space waypoints (excluding the start, including the exact target), or null. */
  findPath(sx: number, sz: number, tx: number, tz: number): THREE.Vector2[] | null {
    const s0 = this.nearestFree(...this.toCell(sx, sz));
    const t0 = this.nearestFree(...this.toCell(tx, tz));
    if (!s0 || !t0) return null;
    const [sc, sr] = s0;
    const [tc, tr] = t0;
    const N = this.cols * this.rows;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const start = sr * this.cols + sc;
    const goal = tr * this.cols + tc;
    g[start] = 0;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - tc);
      const dr = Math.abs(r - tr);
      return Math.max(dx, dr) + 0.4142 * Math.min(dx, dr);
    };
    heap.push(start, h(sc, sr));
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 60000) {
      const cur = heap.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = (cur - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.isFree(nc, nr)) continue;
          if (dr && dc && (!this.isFree(cc + dc, cr) || !this.isFree(cc, cr + dr))) continue; // no corner cutting
          const ni = nr * this.cols + nc;
          if (closed[ni]) continue;
          const ng = g[cur] + (dr && dc ? 1.4142 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            heap.push(ni, ng + h(nc, nr));
          }
        }
      }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let i = goal; i !== -1; i = came[i]) {
      const c = i % this.cols;
      cells.push(this.center(c, (i - c) / this.cols));
      if (i === start) break;
    }
    cells.reverse();
    // string-pull smoothing
    const pts: [number, number][] = [[sx, sz], ...cells.slice(1)];
    const out: THREE.Vector2[] = [];
    let anchor = pts[0];
    let i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.lineOfSight(anchor[0], anchor[1], pts[j + 1][0], pts[j + 1][1])) j++;
      out.push(new THREE.Vector2(pts[j][0], pts[j][1]));
      anchor = pts[j];
      i = j + 1;
    }
    out.push(new THREE.Vector2(tx, tz));
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  clear() {
    this.ids.length = 0;
    this.keys.length = 0;
  }
  push(id: number, key: number) {
    const a = this.ids;
    const k = this.keys;
    a.push(id);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.ids;
    const k = this.keys;
    const top = a[0];
    const lastId = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastId;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

// ───────────────────────────── NPC layer ─────────────────────────────

/** an oriented rectangle on the floor: centre, half sizes along its own x (across) and z (forward), yaw as a prop's rot */
export interface Footprint {
  name?: string;
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}

/** someone standing or sitting still, as a disc to keep clear of */
export interface Disc {
  x: number;
  z: number;
  r: number;
}

export interface SeatRef {
  x: number;
  z: number;
  rot: number;
}

export interface RouteOpts {
  /** people standing or sitting still: planned around (clearance from their disc) */
  people?: Disc[];
  /** body-centre clearance kept from walls, furniture and people (≥ NPC_CLEARANCE) */
  clearance?: number;
  /** sitting down at the end: the route ends at the approach point in front of this seat */
  seat?: SeatRef;
  /** starting in this seat: the first step goes straight out of its front */
  fromSeat?: SeatRef;
}

/**
 * A walkable route: samples every ROUTE_DS m along a smooth curve (straight runs joined by
 * circular arcs), with tangents, curvature (1/m), the speed allowed there (turns, the stop at
 * the end) and the free room left/right of the line (for stepping aside for people).
 */
export interface Route {
  n: number;
  length: number;
  px: Float32Array;
  pz: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  k: Float32Array;
  vmax: Float32Array;
  roomL: Float32Array;
  roomR: Float32Array;
  /** [0, head) steps out of a seat or an obstacle, [tail, length] into a spot inside one: slow, no stepping aside */
  head: number;
  tail: number;
  /** where it ends (the approach point when sitting down) */
  end: { x: number; z: number };
  /** the curve itself (straight runs and arcs) and the arc length each piece starts at: routeAt() walks it exactly */
  prims: RoutePrim[];
  primS: Float32Array;
  /** plots/tests: the string-pulled corners (x, z pairs) and the arc radius fitted at each (0 = left sharp) */
  corners: number[];
  radii: number[];
  /** planned on the walls-only layer (no NPC route existed): straight lines, no clearance guarantee */
  fallback?: boolean;
}

export const ROUTE_DS = 0.1;
const FIELD_RES = 0.1;
const FIELD_CAP = 1.2;
/** what an NPC keeps clear of: body centre to furniture, walls and other people's footprint (m) */
export const NPC_CLEARANCE = 0.3;
/** from people's discs: the same, and 2 mm for the sampling between checks */
const PEOPLE_NEED = NPC_CLEARANCE + 0.002;
/** string-pulling keeps up to this much clearance where the A* corridor had it */
const SOFT_CLEARANCE = 0.5;
/** A* prefers cells with at least this much clearance (the middle of an aisle) */
const PREF_CLEARANCE = 0.65;
/** corner arcs tried, largest first (m) */
const ARC_RADII = [0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.28, 0.22];
/** lateral acceleration allowed in a turn and the braking the speed profile plans with (m/s²) */
const A_LAT = 1.15;
const B_PLAN = 0.8;
/** walking speed through a corner no arc fits (m/s) */
const SHARP_V = 0.22;
/** speed out of / into a seat or an obstacle (m/s) */
const EXEMPT_V = 0.5;
/** approach point in front of a seat's centre: chair front ≈ 0.27 m + 0.3 m clear + a little */
export const SEAT_APPROACH = 0.62;
/** furniture that stands on the floor and blocks NPC paths by its footprint (solid props are colliders already) */
export const NAV_FURNITURE = new Set(['chair', 'stool', 'cafeChair', 'cafeTable', 'sofa', 'desk', 'counter', 'bed', 'stretcher', 'cart', 'crashCart', 'examTable', 'sink', 'ivPole', 'toilet', 'vanity', 'trash', 'plant', 'cabinet', 'ultrasound', 'vitalsMachine', 'scale', 'coffee', 'xrayTable', 'pedalBin', 'maskStation']);

/** A built prop's real footprint: its geometry's bounds in its own frame, placed and rotated with it. */
export function footprintOf(group: THREE.Object3D, rot: number): Footprint | null {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const m = new THREE.Matrix4();
  group.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!(o as THREE.Mesh).isMesh || !geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    part.copy(geo.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    box.union(part);
  });
  if (box.isEmpty()) return null;
  const c = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2).applyMatrix4(group.matrixWorld);
  return { x: c.x, z: c.z, hw: (box.max.x - box.min.x) / 2, hd: (box.max.z - box.min.z) / 2, rot };
}

/** distance from (x, z) to a footprint (0 inside) */
export function footprintDistance(f: Footprint, x: number, z: number): number {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const dx = x - f.x;
  const dz = z - f.z;
  const ex = Math.max(0, Math.abs(dx * c - dz * s) - f.hw);
  const ez = Math.max(0, Math.abs(dx * s + dz * c) - f.hd);
  return Math.hypot(ex, ez);
}

type Pt = [number, number];
/** a straight run or a circular arc (centre, radius, start angle, signed sweep) */
export type RoutePrim = { arc: false; ax: number; az: number; bx: number; bz: number; len: number; exempt: boolean } | { arc: true; cx: number; cz: number; r: number; a0: number; sweep: number; len: number; exempt: false };
type Prim = RoutePrim;

/** the point and unit tangent at arc length s along a route (exact: on its lines and arcs) */
export function routeAt(r: Route, s: number, out: { x: number; z: number; tx: number; tz: number }): void {
  const ps = r.primS;
  let lo = 0;
  let hi = r.prims.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ps[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const p = r.prims[lo];
  if (!p) {
    out.x = r.px[0];
    out.z = r.pz[0];
    out.tx = r.tx[0];
    out.tz = r.tz[0];
    return;
  }
  const u = Math.max(0, Math.min(1, (s - ps[lo]) / Math.max(1e-9, p.len)));
  if (p.arc) {
    const ang = p.a0 + p.sweep * u;
    const dir = Math.sign(p.sweep);
    out.x = p.cx + Math.cos(ang) * p.r;
    out.z = p.cz + Math.sin(ang) * p.r;
    out.tx = -Math.sin(ang) * dir;
    out.tz = Math.cos(ang) * dir;
  } else {
    out.x = p.ax + (p.bx - p.ax) * u;
    out.z = p.az + (p.bz - p.az) * u;
    out.tx = (p.bx - p.ax) / p.len;
    out.tz = (p.bz - p.az) / p.len;
  }
}

const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The NPC layer of a NavGrid. Static obstacles: the grid's colliders (walls, solid props, stairs;
 * nothing overhead) and furniture footprints. People are passed per route.
 */
export class NpcNav {
  readonly grid: NavGrid;
  readonly footprints: Footprint[];
  /** clearance field: distance to the nearest obstacle (m, capped at FIELD_CAP) on FIELD_RES cells */
  readonly field: Float32Array;
  /** fine cells inside a wall or solid prop: a step out of a seat may not cross one */
  readonly hard: Uint8Array;
  readonly fcols: number;
  readonly frows: number;
  /** coarse cells: centre clearance (a cell is free for a walker that keeps `c` clear when it is ≥ c) */
  readonly cclr: Float32Array;
  private dyn: Uint32Array;
  private gen = 1;
  private sgen = 1;
  private gcost: Float32Array;
  private came: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private heap = new MinHeap();
  private people: Disc[] = [];
  private near: Disc[] = [];
  private needGrid = NPC_CLEARANCE;
  /** planning statistics (ms of CPU, routes, failures, corners left sharp) */
  readonly stats = { routes: 0, ms: 0, maxMs: 0, failed: 0, fallback: 0, sharp: 0, corners: 0 };
  /** why the last route() returned null: no way out of where it stands, no free goal, or no connection */
  lastFail: 'start' | 'goal' | 'path' | '' = '';

  constructor(grid: NavGrid, footprints: Footprint[]) {
    this.grid = grid;
    this.footprints = footprints;
    this.fcols = Math.ceil((grid.maxX - grid.minX) / FIELD_RES);
    this.frows = Math.ceil((grid.maxZ - grid.minZ) / FIELD_RES);
    this.field = new Float32Array(this.fcols * this.frows).fill(FIELD_CAP);
    this.hard = new Uint8Array(this.fcols * this.frows);
    // things above head height (door heads, signs) don't block walking
    for (const b of grid.colliders) if (b.min.y < 1.6) this.stampBox(b.min.x, b.min.z, b.max.x, b.max.z);
    for (const f of footprints) this.stampFootprint(f);
    const n = grid.cols * grid.rows;
    this.cclr = new Float32Array(n);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const d = this.clearance(grid.minX + (c + 0.5) * grid.cell, grid.minZ + (r + 0.5) * grid.cell);
        this.cclr[r * grid.cols + c] = d;
      }
    }
    this.dyn = new Uint32Array(n);
    this.gcost = new Float32Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  private stampBox(x0: number, z0: number, x1: number, z1: number) {
    const cap = FIELD_CAP;
    const fx0 = this.grid.minX;
    const fz0 = this.grid.minZ;
    const c0 = Math.max(0, Math.floor((x0 - cap - fx0) / FIELD_RES));
    const c1 = Math.min(this.fcols - 1, Math.floor((x1 + cap - fx0) / FIELD_RES));
    const r0 = Math.max(0, Math.floor((z0 - cap - fz0) / FIELD_RES));
    const r1 = Math.min(this.frows - 1, Math.floor((z1 + cap - fz0) / FIELD_RES));
    for (let r = r0; r <= r1; r++) {
      const pz = fz0 + (r + 0.5) * FIELD_RES;
      const dz = Math.max(0, z0 - pz, pz - z1);
      if (dz >= cap) continue;
      const row = r * this.fcols;
      for (let c = c0; c <= c1; c++) {
        const px = fx0 + (c + 0.5) * FIELD_RES;
        const dx = Math.max(0, x0 - px, px - x1);
        const d = dx === 0 ? dz : dz === 0 ? dx : Math.sqrt(dx * dx + dz * dz);
        const i = row + c;
        if (d < this.field[i]) this.field[i] = d;
        if (d === 0) this.hard[i] = 1;
      }
    }
  }

  private stampFootprint(f: Footprint) {
    const R = Math.hypot(f.hw, f.hd) + FIELD_CAP;
    const fx0 = this.grid.minX;
    const fz0 = this.grid.minZ;
    const cs = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    const c0 = Math.max(0, Math.floor((f.x - R - fx0) / FIELD_RES));
    const c1 = Math.min(this.fcols - 1, Math.floor((f.x + R - fx0) / FIELD_RES));
    const r0 = Math.max(0, Math.floor((f.z - R - fz0) / FIELD_RES));
    const r1 = Math.min(this.frows - 1, Math.floor((f.z + R - fz0) / FIELD_RES));
    for (let r = r0; r <= r1; r++) {
      const dz = fz0 + (r + 0.5) * FIELD_RES - f.z;
      const row = r * this.fcols;
      for (let c = c0; c <= c1; c++) {
        const dx = fx0 + (c + 0.5) * FIELD_RES - f.x;
        const ex = Math.max(0, Math.abs(dx * cs - dz * sn) - f.hw);
        const ez = Math.max(0, Math.abs(dx * sn + dz * cs) - f.hd);
        const d = Math.sqrt(ex * ex + ez * ez);
        if (d < this.field[row + c]) this.field[row + c] = d;
      }
    }
  }

  /** static clearance at (x, z): distance to the nearest wall, solid prop or furniture (bilinear; 0 outside) */
  clearance(x: number, z: number): number {
    const gx = (x - this.grid.minX) / FIELD_RES - 0.5;
    const gz = (z - this.grid.minZ) / FIELD_RES - 0.5;
    const c = Math.floor(gx);
    const r = Math.floor(gz);
    if (c < 0 || r < 0 || c >= this.fcols - 1 || r >= this.frows - 1) return 0;
    const fx = gx - c;
    const fz = gz - r;
    const f = this.field;
    const i = r * this.fcols + c;
    const j = i + this.fcols;
    return (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fz) + (f[j] * (1 - fx) + f[j + 1] * fx) * fz;
  }

  /** coarse cell index at (x, z), or -1 outside */
  cellIndex(x: number, z: number): number {
    const g = this.grid;
    const c = Math.floor((x - g.minX) / g.cell);
    const r = Math.floor((z - g.minZ) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
  }

  /** the coarse cell at (x, z) is free of furniture, walls (and, while planning, people) */
  cellFree(x: number, z: number, people = true): boolean {
    const i = this.cellIndex(x, z);
    return i >= 0 && this.cclr[i] >= this.needGrid && (!people || this.dyn[i] !== this.gen);
  }

  private hardAt(x: number, z: number): boolean {
    const c = Math.floor((x - this.grid.minX) / FIELD_RES);
    const r = Math.floor((z - this.grid.minZ) / FIELD_RES);
    if (c < 0 || r < 0 || c >= this.fcols || r >= this.frows) return true;
    return this.hard[r * this.fcols + c] === 1;
  }

  /** the step a→b runs into a wall or solid prop (stepping out of the one it starts in doesn't count) */
  private crossesHard(ax: number, az: number, bx: number, bz: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05));
    let out = !this.hardAt(ax, az);
    for (let i = 1; i <= n; i++) {
      const h = this.hardAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      if (h && out) return true;
      if (!h) out = true;
    }
    return false;
  }

  private nearPeople(x0: number, z0: number, x1: number, z1: number, pad: number): Disc[] {
    const out = this.near;
    out.length = 0;
    for (const p of this.people) if (p.x + p.r + pad >= x0 && p.x - p.r - pad <= x1 && p.z + p.r + pad >= z0 && p.z - p.r - pad <= z1) out.push(p);
    return out;
  }

  private peopleOk(x: number, z: number, list: Disc[], need: number): boolean {
    for (const p of list) if (Math.hypot(x - p.x, z - p.z) - p.r < need) return false;
    return true;
  }

  /** free for this walker: a free cell, `need` from walls and furniture, and clear of people */
  private pointOk(x: number, z: number, need: number): boolean {
    return this.cellFree(x, z) && this.clearance(x, z) >= need && this.peopleOk(x, z, this.people, PEOPLE_NEED);
  }

  private walkable(c: number, r: number): boolean {
    const g = this.grid;
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return false;
    const i = r * g.cols + c;
    return this.cclr[i] >= this.needGrid && this.dyn[i] !== this.gen;
  }

  /** every coarse cell the segment passes through is walkable (exact grid traversal; a corner touched counts both sides) */
  cellsOk(ax: number, az: number, bx: number, bz: number): boolean {
    const g = this.grid;
    let c = Math.floor((ax - g.minX) / g.cell);
    let r = Math.floor((az - g.minZ) / g.cell);
    const c1 = Math.floor((bx - g.minX) / g.cell);
    const r1 = Math.floor((bz - g.minZ) / g.cell);
    const dx = bx - ax;
    const dz = bz - az;
    const sc = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sr = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdc = sc ? g.cell / Math.abs(dx) : Infinity;
    const tdr = sr ? g.cell / Math.abs(dz) : Infinity;
    let tmc = sc ? (g.minX + (c + (sc > 0 ? 1 : 0)) * g.cell - ax) / dx : Infinity;
    let tmr = sr ? (g.minZ + (r + (sr > 0 ? 1 : 0)) * g.cell - az) / dz : Infinity;
    for (let guard = 0; guard < 100000; guard++) {
      if (!this.walkable(c, r)) return false;
      if ((c === c1 && r === r1) || (tmc > 1 && tmr > 1)) return true;
      if (Math.abs(tmc - tmr) < 1e-9) {
        if (!this.walkable(c + sc, r) || !this.walkable(c, r + sr)) return false;
        c += sc;
        r += sr;
        tmc += tdc;
        tmr += tdr;
      } else if (tmc < tmr) {
        c += sc;
        tmc += tdc;
      } else {
        r += sr;
        tmr += tdr;
      }
    }
    return false;
  }

  private segOk(ax: number, az: number, bx: number, bz: number, need: number): boolean {
    if (!this.cellsOk(ax, az, bx, bz)) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.05));
    const near = this.nearPeople(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), NPC_CLEARANCE + 0.05);
    for (let i = 0; i <= n; i++) {
      const x = ax + (dx * i) / n;
      const z = az + (dz * i) / n;
      if (this.clearance(x, z) < need || !this.peopleOk(x, z, near, PEOPLE_NEED)) return false;
    }
    return true;
  }

  private stampDyn(p: Disc, need: number) {
    const g = this.grid;
    const R = p.r + need;
    const c0 = Math.max(0, Math.floor((p.x - R - g.minX) / g.cell));
    const c1 = Math.min(g.cols - 1, Math.floor((p.x + R - g.minX) / g.cell));
    const r0 = Math.max(0, Math.floor((p.z - R - g.minZ) / g.cell));
    const r1 = Math.min(g.rows - 1, Math.floor((p.z + R - g.minZ) / g.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (Math.hypot(g.minX + (c + 0.5) * g.cell - p.x, g.minZ + (r + 0.5) * g.cell - p.z) < R) this.dyn[r * g.cols + c] = this.gen;
      }
    }
  }

  /** the nearest free point (a cell centre) within ~2.5 m whose straight step from (x, z) crosses no wall */
  private nearestOk(x: number, z: number, need: number, maxRing = 7): Pt | null {
    const g = this.grid;
    const c0 = Math.floor((x - g.minX) / g.cell);
    const r0 = Math.floor((z - g.minZ) / g.cell);
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const cx = g.minX + (c0 + dc + 0.5) * g.cell;
          const cz = g.minZ + (r0 + dr + 0.5) * g.cell;
          const d = Math.hypot(cx - x, cz - z);
          if (d >= bestD || !this.pointOk(cx, cz, need) || this.crossesHard(x, z, cx, cz)) continue;
          best = [cx, cz];
          bestD = d;
        }
      }
      // a ring further out can't hold anything nearer than ring·cell − half a cell
      if (best && bestD < (ring + 0.5) * g.cell) break;
    }
    return best;
  }

  /** where to step out to from (x, z), inside an obstacle's clearance: straight out of the seat's front when seated */
  private exitPoint(x: number, z: number, need: number, seat?: SeatRef): Pt | null {
    if (seat) {
      const fx = Math.sin(seat.rot);
      const fz = Math.cos(seat.rot);
      for (const d of [SEAT_APPROACH, 0.72, 0.85, 1.0, 1.2]) {
        const px = seat.x + fx * d;
        const pz = seat.z + fz * d;
        if (this.pointOk(px, pz, need) && !this.crossesHard(x, z, px, pz)) return [px, pz];
      }
    }
    return this.nearestOk(x, z, need);
  }

  /** where to stand before sitting down: in front of the seat, else beside or behind it (desk chairs) */
  approachPoint(seat: SeatRef, need = NPC_CLEARANCE): Pt | null {
    const fx = Math.sin(seat.rot);
    const fz = Math.cos(seat.rot);
    for (const d of [SEAT_APPROACH, 0.72, 0.85, 1.0]) if (this.pointOk(seat.x + fx * d, seat.z + fz * d, need)) return [seat.x + fx * d, seat.z + fz * d];
    for (const [ax, az] of [[-fz, fx], [fz, -fx], [-fx, -fz]]) {
      for (const d of [0.7, 0.85, 1.0]) if (this.pointOk(seat.x + ax * d, seat.z + az * d, need) && !this.crossesHard(seat.x, seat.z, seat.x + ax * d, seat.z + az * d)) return [seat.x + ax * d, seat.z + az * d];
    }
    return this.nearestOk(seat.x + fx * SEAT_APPROACH, seat.z + fz * SEAT_APPROACH, need);
  }

  private astar(sc: number, sr: number, tc: number, tr: number): number[] | null {
    const g = this.grid;
    const cols = g.cols;
    const rows = g.rows;
    const start = sr * cols + sc;
    const goal = tr * cols + tc;
    const sg = ++this.sgen;
    const heap = this.heap;
    heap.clear();
    const walk = (i: number) => this.cclr[i] >= this.needGrid && this.dyn[i] !== this.gen;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - tc);
      const dr = Math.abs(r - tr);
      return Math.max(dx, dr) + 0.4142 * Math.min(dx, dr);
    };
    this.gcost[start] = 0;
    this.seen[start] = sg;
    this.came[start] = -1;
    heap.push(start, h(sc, sr));
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 90000) {
      const cur = heap.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === sg) continue;
      this.closed[cur] = sg;
      const cc = cur % cols;
      const cr = (cur - cc) / cols;
      for (let k = 0; k < 8; k++) {
        const dc = DC[k];
        const dr = DR[k];
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (this.closed[ni] === sg || (!walk(ni) && ni !== goal)) continue;
        if (dc && dr && (!walk(cr * cols + nc) || !walk(nr * cols + cc))) continue; // no corner cutting
        const clr = this.cclr[ni];
        const pen = clr < PREF_CLEARANCE ? 1 + (1.6 * (PREF_CLEARANCE - clr)) / PREF_CLEARANCE : 1;
        const ng = this.gcost[cur] + (dc && dr ? 1.4142 : 1) * pen;
        if (this.seen[ni] !== sg || ng < this.gcost[ni]) {
          this.seen[ni] = sg;
          this.gcost[ni] = ng;
          this.came[ni] = cur;
          heap.push(ni, ng + h(nc, nr));
        }
      }
    }
    if (!found) return null;
    const out: number[] = [];
    for (let i = goal; i !== -1; i = this.came[i]) {
      out.push(i);
      if (i === start) break;
    }
    return out.reverse();
  }

  /** string-pull: farthest visible point, keeping the clearance the A* corridor had (up to SOFT_CLEARANCE) */
  private pull(pts: Pt[], clr: number[], need: number, dense = false): Pt[] {
    const out: Pt[] = [pts[0]];
    const n = pts.length;
    // can i see j, keeping the corridor's clearance (min over i..j, up to SOFT_CLEARANCE)?
    const sees = (i: number, j: number) => {
      let m = Infinity;
      for (let k = i; k <= j; k++) if (clr[k] < m) m = clr[k];
      return this.segOk(pts[i][0], pts[i][1], pts[j][0], pts[j][1], Math.max(need, Math.min(SOFT_CLEARANCE, m - 0.05)));
    };
    let i = 0;
    while (i < n - 1) {
      // the farthest point it sees: gallop, then halve (seeing along a path is near-monotonic)
      let lo = i + 1;
      let step = 1;
      while (lo + step < n && sees(i, lo + step)) {
        lo += step;
        step *= 2;
      }
      let hi = Math.min(n, lo + step);
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (sees(i, mid)) lo = mid;
        else hi = mid;
      }
      out.push(pts[lo]);
      i = lo;
    }
    // pull again through points every 25 cm along that line: shortcuts the greedy pass missed (it may
    // only turn at A* cell centres, which leaves little jogs)
    if (!dense) {
      const pts2: Pt[] = [out[0]];
      const clr2: number[] = [this.clearance(out[0][0], out[0][1])];
      for (let k = 1; k < out.length; k++) {
        const [ax, az] = out[k - 1];
        const [bx, bz] = out[k];
        const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.25));
        for (let q = 1; q <= steps; q++) {
          const p: Pt = [ax + ((bx - ax) * q) / steps, az + ((bz - az) * q) / steps];
          pts2.push(p);
          clr2.push(this.clearance(p[0], p[1]));
        }
      }
      return this.pull(pts2, clr2, need, true);
    }
    // drop corners a direct line can skip (the greedy pass stops at the first blocked look)
    for (let k = 1; k < out.length - 1; ) {
      if (this.segOk(out[k - 1][0], out[k - 1][1], out[k + 1][0], out[k + 1][1], need + 0.02)) out.splice(k, 1);
      else k++;
    }
    return out;
  }

  /** the largest arc (radius, tangent points) that fits the corner a→b→c and keeps clear; null = none */
  private fitArc(a: Pt, b: Pt, c: Pt, availA: number, availC: number, need: number, check = true): { r: number; cx: number; cz: number; a0: number; sweep: number; t1: Pt; t2: Pt } | null {
    const la = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (la < 1e-4 || lc < 1e-4) return null;
    const ux = (b[0] - a[0]) / la;
    const uz = (b[1] - a[1]) / la;
    const wx = (c[0] - b[0]) / lc;
    const wz = (c[1] - b[1]) / lc;
    const turn = Math.atan2(Math.abs(ux * wz - uz * wx), ux * wx + uz * wz);
    if (turn < 0.02 || turn > Math.PI - 0.05) return null;
    // inner bisector: from the corner into the turn
    let bx = wx - ux;
    let bz = wz - uz;
    const bl = Math.hypot(bx, bz);
    bx /= bl;
    bz /= bl;
    for (const r of ARC_RADII) {
      if (!check && r > 0.45) continue;
      const t = r * Math.tan(turn / 2);
      if (t > availA || t > availC) continue;
      const cd = r / Math.cos(turn / 2);
      const cx = b[0] + bx * cd;
      const cz = b[1] + bz * cd;
      const t1: Pt = [b[0] - ux * t, b[1] - uz * t];
      const t2: Pt = [b[0] + wx * t, b[1] + wz * t];
      const a0 = Math.atan2(t1[1] - cz, t1[0] - cx);
      let sweep = Math.atan2(t2[1] - cz, t2[0] - cx) - a0;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      // the arc as 2.5 cm chords (within 0.4 mm of it): every cell they cross walkable, every point clear
      const steps = Math.max(2, Math.ceil((r * Math.abs(sweep)) / 0.025));
      let ok = check;
      if (!check) return { r, cx, cz, a0, sweep, t1, t2 };
      let px = t1[0];
      let pz = t1[1];
      for (let i = 0; i <= steps && ok; i++) {
        const ang = a0 + (sweep * i) / steps;
        const x = cx + Math.cos(ang) * r;
        const z = cz + Math.sin(ang) * r;
        if (!this.cellsOk(px, pz, x, z) || this.clearance(x, z) < need || !this.peopleOk(x, z, this.people, PEOPLE_NEED)) ok = false;
        px = x;
        pz = z;
      }
      if (ok) return { r, cx, cz, a0, sweep, t1, t2 };
    }
    return null;
  }

  /**
   * An NPC route from (sx, sz) to (tx, tz): out of a seat/obstacle if starting in one, A* round
   * furniture and still people, string-pulled, corners rounded, resampled. Null if there is none.
   */
  route(sx: number, sz: number, tx: number, tz: number, o: RouteOpts = {}): Route | null {
    const t0 = now();
    const r = this.plan(sx, sz, tx, tz, o);
    this.needGrid = NPC_CLEARANCE;
    const ms = now() - t0;
    this.stats.routes++;
    this.stats.ms += ms;
    this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    if (!r) this.stats.failed++;
    return r;
  }

  private fail(why: 'start' | 'goal' | 'path'): null {
    this.lastFail = why;
    return null;
  }

  private plan(sx: number, sz: number, tx: number, tz: number, o: RouteOpts): Route | null {
    this.lastFail = '';
    // (a tight spot may ask for less: 0.2 m between the desk chairs of the nurses' station)
    const need = Math.max(0.2, o.clearance ?? NPC_CLEARANCE);
    this.needGrid = need;
    this.gen++;
    this.people = o.people ?? [];
    for (const p of this.people) this.stampDyn(p, NPC_CLEARANCE);
    const g = this.grid;
    // ── start: step out first if inside an obstacle's (or a person's) clearance ──
    let head: Pt[] = [];
    let S: Pt = [sx, sz];
    if (!this.pointOk(sx, sz, need)) {
      const e = this.exitPoint(sx, sz, need, o.fromSeat);
      if (!e) return this.fail('start');
      head = [[sx, sz], e];
      S = e;
    }
    // ── goal: the approach point of a seat; a spot inside an obstacle is stepped into; one taken by a person, stopped short of ──
    let tail: Pt[] = [];
    let G: Pt = [tx, tz];
    if (o.seat) {
      const a = this.approachPoint(o.seat, need);
      if (!a) return this.fail('goal');
      G = a;
      // a desk chair whose front is its desk is sat in from the side: the last steps in beside it, slowly,
      // so the slide into the seat is half a metre (a metre and more where the desk keeps the approach out)
      const d = Math.hypot(a[0] - o.seat.x, a[1] - o.seat.z);
      const ahead = ((a[0] - o.seat.x) * Math.sin(o.seat.rot) + (a[1] - o.seat.z) * Math.cos(o.seat.rot)) / Math.max(d, 1e-6);
      if (d > 0.6 && Math.abs(ahead) < 0.3) {
        const near: Pt = [o.seat.x + ((a[0] - o.seat.x) / d) * 0.5, o.seat.z + ((a[1] - o.seat.z) / d) * 0.5];
        if (!this.hardAt(near[0], near[1]) && !this.crossesHard(a[0], a[1], near[0], near[1])) tail = [a, near];
      }
    } else if (!this.pointOk(tx, tz, need)) {
      const f = this.nearestOk(tx, tz, need);
      if (!f) return this.fail('goal');
      const staticOk = this.cellFree(tx, tz, false) && this.clearance(tx, tz) >= need;
      if (!staticOk && Math.hypot(f[0] - tx, f[1] - tz) > 0.02) tail = [f, [tx, tz]];
      G = f;
    }
    const si = this.cellIndex(S[0], S[1]);
    const gi = this.cellIndex(G[0], G[1]);
    if (si < 0 || gi < 0) return this.fail(si < 0 ? 'start' : 'goal');
    const cells = si === gi ? [si] : this.astar(si % g.cols, Math.floor(si / g.cols), gi % g.cols, Math.floor(gi / g.cols));
    if (!cells) return this.fail('path');
    const pts: Pt[] = [S];
    const clr: number[] = [this.clearance(S[0], S[1])];
    for (let i = 1; i < cells.length - 1; i++) {
      const c = cells[i] % g.cols;
      const rr = (cells[i] - c) / g.cols;
      pts.push([g.minX + (c + 0.5) * g.cell, g.minZ + (rr + 0.5) * g.cell]);
      clr.push(this.cclr[cells[i]]);
    }
    pts.push(G);
    clr.push(this.clearance(G[0], G[1]));
    const corners = this.pull(pts, clr, need);
    return this.build(corners, head, tail, need);
  }

  /** corners → straight runs and arcs (vertices moved out a little where no arc fits) → samples */
  private build(v: Pt[], head: Pt[], tail: Pt[], need: number): Route {
    const m = v.length;
    // vertices with no room for an arc: shift outward (away from the inner obstacle) while the legs stay clear
    for (let i = 1; i < m - 1; i++) {
      const a = v[i - 1];
      const b = v[i];
      const c = v[i + 1];
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      let bestRadius = this.fitArc(a, b, c, i === 1 ? la * 0.95 : la * 0.5, i === m - 2 ? lc * 0.95 : lc * 0.5, need + 0.01)?.r ?? 0;
      if (bestRadius >= 0.35) continue;
      const ux = (b[0] - a[0]) / la;
      const uz = (b[1] - a[1]) / la;
      const wx = (c[0] - b[0]) / lc;
      const wz = (c[1] - b[1]) / lc;
      const bl = Math.hypot(wx - ux, wz - uz);
      if (bl < 1e-3) continue;
      // Near a doorway, pushing the corner outwards can run directly into its leaf.
      // Sliding it along the longer leg can also make room to turn; test both adjoining segments.
      const directions = [[(ux - wx) / bl, (uz - wz) / bl], la < lc ? [wx, wz] : [-ux, -uz]];
      for (const [dx, dz] of directions) {
        for (const d of [0.05, 0.1, 0.2, 0.3]) {
          const nb: Pt = [b[0] + dx * d, b[1] + dz * d];
          if (!this.segOk(a[0], a[1], nb[0], nb[1], need) || !this.segOk(nb[0], nb[1], c[0], c[1], need)) break;
          const nla = Math.hypot(nb[0] - a[0], nb[1] - a[1]);
          const nlc = Math.hypot(c[0] - nb[0], c[1] - nb[1]);
          const arc = this.fitArc(a, nb, c, i === 1 ? nla * 0.95 : nla * 0.5, i === m - 2 ? nlc * 0.95 : nlc * 0.5, need + 0.01);
          if (arc && arc.r > bestRadius) {
            v[i] = nb;
            bestRadius = arc.r;
            if (bestRadius >= 0.35) break;
          }
        }
        if (bestRadius >= 0.35) break;
      }
    }
    const prims: Prim[] = [];
    const line = (a: Pt, b: Pt, exempt: boolean) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-4) prims.push({ arc: false, ax: a[0], az: a[1], bx: b[0], bz: b[1], len, exempt });
    };
    if (head.length) line(head[0], head[1], true);
    const radii: number[] = [];
    let from: Pt = v[0];
    for (let i = 1; i < m - 1; i++) {
      const a = v[i - 1];
      const b = v[i];
      const c = v[i + 1];
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      // the previous arc used up to half of this leg; the first and last legs are all ours
      const usedA = Math.hypot(from[0] - a[0], from[1] - a[1]);
      const arc = this.fitArc(a, b, c, i === 1 ? la * 0.95 : Math.min(la * 0.5, la - usedA), i === m - 2 ? lc * 0.95 : lc * 0.5, need + 0.01);
      this.stats.corners++;
      if (!arc) {
        this.stats.sharp++;
        radii.push(0);
        line(from, b, false);
        from = b;
        continue;
      }
      radii.push(arc.r);
      line(from, arc.t1, false);
      prims.push({ arc: true, cx: arc.cx, cz: arc.cz, r: arc.r, a0: arc.a0, sweep: arc.sweep, len: arc.r * Math.abs(arc.sweep), exempt: false });
      from = arc.t2;
    }
    line(from, v[m - 1], false);
    if (tail.length) line(tail[0], tail[1], true);
    const corners = v.flatMap((p) => [p[0], p[1]]);
    return sampleRoute(prims, corners, radii, (x, z, tx, tz) => this.room(x, z, tx, tz, need));
  }

  /** free room to the right and left of (x, z) across the direction (tx, tz), up to 0.8 m (static obstacles only) */
  private room(x: number, z: number, tx: number, tz: number, need: number): [number, number] {
    const out: [number, number] = [0, 0];
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1;
      // right of the walking direction: (-tz, tx)
      const nx = -tz * s;
      const nz = tx * s;
      let d = 0;
      for (let k = 1; k <= 16; k++) {
        const q = k * 0.05;
        if (!this.cellFree(x + nx * q, z + nz * q, false) || this.clearance(x + nx * q, z + nz * q) < need) break;
        d = q;
      }
      out[side] = d;
    }
    return out;
  }

  /**
   * A route along a walls-only polyline, when furniture leaves no NPC route (desk chairs tucked in at
   * the nurses' station): corners rounded (≤ 0.45 m, inside the walls' 0.27 m margin), no stepping aside.
   */
  fallbackRoute(points: { x: number; y: number }[], sx: number, sz: number): Route {
    const v: Pt[] = [[sx, sz]];
    for (const p of points) if (Math.hypot(p.x - v[v.length - 1][0], p.y - v[v.length - 1][1]) > 1e-4) v.push([p.x, p.y]);
    const prims: Prim[] = [];
    const line = (a: Pt, b: Pt) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-4) prims.push({ arc: false, ax: a[0], az: a[1], bx: b[0], bz: b[1], len, exempt: true });
    };
    let from: Pt = v[0];
    for (let i = 1; i < v.length - 1; i++) {
      const la = Math.hypot(v[i][0] - v[i - 1][0], v[i][1] - v[i - 1][1]);
      const lc = Math.hypot(v[i + 1][0] - v[i][0], v[i + 1][1] - v[i][1]);
      const arc = this.fitArc(v[i - 1], v[i], v[i + 1], (i === 1 ? la : la * 0.5) - Math.hypot(from[0] - v[i - 1][0], from[1] - v[i - 1][1]) * (i === 1 ? 1 : 0), i === v.length - 2 ? lc * 0.95 : lc * 0.5, 0, false);
      if (!arc) {
        line(from, v[i]);
        from = v[i];
        continue;
      }
      line(from, arc.t1);
      prims.push({ arc: true, cx: arc.cx, cz: arc.cz, r: arc.r, a0: arc.a0, sweep: arc.sweep, len: arc.r * Math.abs(arc.sweep), exempt: false });
      from = arc.t2;
    }
    line(from, v[v.length - 1]);
    this.stats.fallback++;
    const r = sampleRoute(prims, [], [], () => [0, 0], false);
    r.fallback = true;
    return r;
  }
}

/** resample runs and arcs every ROUTE_DS m: positions, tangents, curvature, speed limits, room */
function sampleRoute(prims: Prim[], corners: number[], radii: number[], room: (x: number, z: number, tx: number, tz: number) => [number, number], slowExempt = true): Route {
  const total = prims.reduce((s, p) => s + p.len, 0);
  const n = Math.max(2, Math.floor(total / ROUTE_DS) + 2);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const k = new Float32Array(n);
  const vmax = new Float32Array(n);
  const roomL = new Float32Array(n);
  const roomR = new Float32Array(n);
  const exempt = new Uint8Array(n);
  let head = 0;
  let tail = total;
  {
    let acc = 0;
    let seenMain = false;
    for (const p of prims) {
      if (p.exempt && !seenMain) head = acc + p.len;
      else seenMain = true;
      acc += p.len;
    }
    acc = total;
    for (let i = prims.length - 1; i >= 0 && prims[i].exempt && head < acc - prims[i].len + 1e-6; i--) {
      acc -= prims[i].len;
      tail = acc;
    }
    if (prims.every((p) => p.exempt)) {
      head = 0;
      tail = 0;
    }
  }
  let pi = 0;
  let base = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(total, i * ROUTE_DS);
    while (pi < prims.length - 1 && s > base + prims[pi].len) {
      base += prims[pi].len;
      pi++;
    }
    const p = prims[pi];
    if (!p) {
      px[i] = px[Math.max(0, i - 1)];
      pz[i] = pz[Math.max(0, i - 1)];
      continue;
    }
    const u = Math.max(0, Math.min(1, (s - base) / Math.max(1e-6, p.len)));
    if (p.arc) {
      const ang = p.a0 + p.sweep * u;
      px[i] = p.cx + Math.cos(ang) * p.r;
      pz[i] = p.cz + Math.sin(ang) * p.r;
      const dir = Math.sign(p.sweep);
      tx[i] = -Math.sin(ang) * dir;
      tz[i] = Math.cos(ang) * dir;
      k[i] = 1 / p.r;
    } else {
      px[i] = p.ax + (p.bx - p.ax) * u;
      pz[i] = p.az + (p.bz - p.az) * u;
      tx[i] = (p.bx - p.ax) / p.len;
      tz[i] = (p.bz - p.az) / p.len;
    }
    exempt[i] = p.exempt ? 1 : 0;
  }
  // an arc shorter than a sample step (a slight bend at r 0.8 m: a few cm) can fall between two samples
  // that both lie on straight runs: give the samples round every arc its curvature, so the turn between
  // them is explained (and the walker eases through it) rather than read as a kink
  {
    let s0 = 0;
    for (const p of prims) {
      if (p.arc) {
        const i0 = Math.max(0, Math.floor(s0 / ROUTE_DS));
        const i1 = Math.min(n - 1, Math.ceil((s0 + p.len) / ROUTE_DS));
        for (let i = i0; i <= i1; i++) k[i] = Math.max(k[i], 1 / p.r);
      }
      s0 += p.len;
    }
  }
  // corners with no arc (and the step out of a seat into the aisle): the heading jumps more than
  // the curvature explains — a sharp turn, walked slowly
  for (let i = 1; i < n; i++) {
    const turn = Math.acos(Math.max(-1, Math.min(1, tx[i] * tx[i - 1] + tz[i] * tz[i - 1])));
    if (turn > Math.max(k[i], k[i - 1]) * ROUTE_DS * 1.25 + 0.08) {
      k[i] = Math.max(k[i], 10);
      k[i - 1] = Math.max(k[i - 1], 10);
    }
  }
  for (let i = 0; i < n; i++) {
    let v = 9;
    if (k[i] >= 10) v = SHARP_V;
    else if (k[i] > 1e-3) v = Math.sqrt(A_LAT / k[i]);
    if (exempt[i] && slowExempt) v = Math.min(v, EXEMPT_V);
    vmax[i] = v;
  }
  vmax[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.max(0, Math.min(total, (i + 1) * ROUTE_DS) - i * ROUTE_DS);
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] * vmax[i + 1] + 2 * B_PLAN * ds));
  }
  // room to step aside: none on the exempt legs; looking ahead ~0.8 m so a narrowing is met in time
  const rr = new Float32Array(n);
  const rl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (exempt[i]) continue;
    const [r, l] = room(px[i], pz[i], tx[i], tz[i]);
    rr[i] = r;
    rl[i] = l;
  }
  for (let i = 0; i < n; i++) {
    let r = rr[i];
    let l = rl[i];
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 8); j++) {
      r = Math.min(r, rr[j]);
      l = Math.min(l, rl[j]);
    }
    // back onto the line by the end: a sidestep fades out over the last metres (slower than it can step back)
    const toEnd = 0.45 * Math.max(0, Math.min(total, tail) - i * ROUTE_DS);
    roomR[i] = Math.min(r, toEnd);
    roomL[i] = Math.min(l, toEnd);
  }
  const last = prims[prims.length - 1];
  const end = last ? (last.arc ? { x: px[n - 1], z: pz[n - 1] } : { x: last.bx, z: last.bz }) : { x: px[0], z: pz[0] };
  const primS = new Float32Array(prims.length);
  for (let i = 1; i < prims.length; i++) primS[i] = primS[i - 1] + prims[i - 1].len;
  return { n, length: total, px, pz, tx, tz, k, vmax, roomL, roomR, head, tail, end, corners, radii, prims, primS };
}

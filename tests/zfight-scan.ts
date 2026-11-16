/**
 * Coplanar-face (z-fighting) scan. Runs inside a game page served by the Vite dev server; the
 * Node runner is tests/zfight.ts (see there for usage).
 *
 * Passes:
 * - world: the whole hospital from buildWorld(), plus the upper floors (upperFloor.ts) when that
 *   code is there, left unmerged (every Object3D gets userData.noMerge while it builds), so each
 *   mesh is still the part a builder made. Every add() is recorded with its call stack, which the
 *   runner maps back to file:line.
 * - isolated: each prop kind from buildProp() with default sizes, with the floor and the walls
 *   around its first placement.
 * - selfTest(): known cases, among them the two flickers the owner found by eye.
 *
 * For every pair of meshes it finds faces that are visible from the same side (same facing, or
 * a double-sided face), parallel, within 1.5 mm of the same plane and overlapping by more than
 * 1 cm² (rotations, scales and mirroring via world matrices). Not counted, as nobody can see
 * them: an overlap pressed against an opaque face that looks the other way (a back plate on a
 * wall), one enclosed in another closed solid (a glass edge inside its frame), faces looking down
 * at their storey's floor height, and meshes the main camera doesn't draw (not on layer 0).
 */
import * as THREE from 'three';
import { buildWorld } from '../client/src/world/builder';
import { G, add, lambert, rboxB } from '../client/src/world/materials';
import { buildProp } from '../client/src/world/props';
import { LAYOUTS, type PropDef, type PropKind } from '../shared/layout';

/** overlaps smaller than this (1 cm²) don't read as flicker */
const MIN_AREA = 1e-4;
/** ≤ 0.5 mm apart (+ float slack): flickers at any distance */
const ZFIGHT_GAP = 0.00055;
/** ≤ 1.5 mm: flickers from ~25 m away (24-bit depth, near plane 0.05 m) */
const NEAR_GAP = 0.0015;
/** parallel within ~0.6° */
const COS_PARALLEL = 0.99995;

export interface ScanFrame {
  fn: string;
  url: string;
  line: number;
  col: number;
}
export interface ScanMesh {
  /** geometry + size */
  geo: string;
  /** material type, color, flags */
  mat: string;
  /** innermost game-code frames of the add() that created the mesh */
  frames: ScanFrame[];
  /** mesh position in its owner's (prop's) frame */
  pos: [number, number, number];
}
export type Tier = 'zfight' | 'near' | 'same-material' | 'glass';
export interface ScanFinding {
  pass: 'world' | 'isolated';
  tier: Tier;
  /** prop id + kind, a set-dressing builder, or a loose builder function; "a | b" across owners */
  owner: string;
  cross: boolean;
  /** both faces look the same way, or one of them is double-sided */
  facing: 'same' | 'double-sided';
  a: ScanMesh;
  b: ScanMesh;
  /** world normal of the shared plane, and a point in the overlap (world and owner frame) */
  normal: [number, number, number];
  at: [number, number, number];
  local: [number, number, number];
  /** distance between the planes (m) and overlapping area (m²) */
  gap: number;
  area: number;
}
/** findings from one pair of builder calls (a prop used in eight bays is one entry) */
export interface ScanGroup {
  tier: Tier;
  count: number;
  passes: ('world' | 'isolated')[];
  owners: string[];
  /** the largest overlap */
  example: ScanFinding;
}
export interface ScanResult {
  groups: ScanGroup[];
  stats: Record<string, number>;
}

const kindOf = (owner: string) => owner.replace(/ @ .*$/, '').replace(/^\S+ \(([A-Za-z]+)\)$/, '$1').replace(/ \(default size\)$/, '');
const at = (f: ScanFrame | undefined) => (f ? `${f.url.replace(/\?.*$/, '')}:${f.line}:${f.col}` : '?');

// ───────────────────────────── instrumentation ─────────────────────────────

const born = new WeakMap<THREE.Object3D, Error>();
const bornSeq = new WeakMap<THREE.Object3D, number>();
let seq = 0;
let forceNoMerge = false;
let instrumented = false;

/** record who adds each object, and (while forceNoMerge) flag every new object noMerge */
function instrument() {
  if (instrumented) return;
  instrumented = true;
  Error.stackTraceLimit = 16;
  const proto = THREE.Object3D.prototype as unknown as { add: (...objs: THREE.Object3D[]) => THREE.Object3D };
  const orig = proto.add;
  proto.add = function (this: THREE.Object3D, ...objs: THREE.Object3D[]) {
    const e = new Error('add');
    for (const o of objs) {
      if (!born.has(o)) born.set(o, e);
      bornSeq.set(o, seq++);
    }
    return orig.apply(this, objs);
  };
  // Object3D's constructor assigns this.userData = {}: a setter on the prototype sees every new object
  type UD = { __zfUserData?: Record<string, unknown> };
  Object.defineProperty(THREE.Object3D.prototype, 'userData', {
    configurable: true,
    get(this: UD) {
      return this.__zfUserData;
    },
    set(this: UD, v: Record<string, unknown>) {
      if (forceNoMerge && v && typeof v === 'object') v.noMerge = true;
      this.__zfUserData = v;
    },
  });
}

const frameCache = new WeakMap<THREE.Object3D, ScanFrame[]>();
function framesOf(o: THREE.Object3D): ScanFrame[] {
  const hit = frameCache.get(o);
  if (hit) return hit;
  const e = born.get(o);
  const out: ScanFrame[] = [];
  frameCache.set(o, out);
  for (const line of (e?.stack ?? '').split('\n').slice(1)) {
    const m = /at (?:(.*?) \()?(https?:\/\/[^\s)]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const url = m[2];
    if (/zfight-scan|node_modules|\/@vite|\/@react-refresh|\/world\/materials\.ts/.test(url)) continue;
    out.push({ fn: m[1] ?? '(anonymous)', url, line: Number(m[3]), col: Number(m[4]) });
    if (out.length >= 4) break;
  }
  return out;
}

// ───────────────────────────── meshes → planar facets ─────────────────────────────

const LAYER_BASE = 0;
const LAYER_TALL = 1;
const LAYER_LOW = 2;

interface Rec {
  mesh: THREE.Mesh;
  /** prop / set-dressing group, or null for a loose mesh */
  owner: THREE.Object3D | null;
  ownerKey: string;
  layer: number;
  /** storey (0 = ground floor) and its floor height */
  storey: number;
  floorY: number;
}

interface Facet {
  rec: number;
  mat: THREE.Material;
  /** canonical unit normal (first non-zero component positive) and offset n·p */
  nx: number;
  ny: number;
  nz: number;
  d: number;
  /** 1: visible from the +n side, 2: from the −n side */
  vis: number;
  /** world-space triangles, 9 numbers each */
  tris: Float64Array;
  area: number;
  min: [number, number, number];
  max: [number, number, number];
}

const opaque = (m: THREE.Material) => !(m.transparent && (m.opacity < 1 || !m.depthWrite)) && m.depthWrite !== false && !(m.alphaTest > 0);

function facetsOf(ri: number, mesh: THREE.Mesh, floorY: number, out: Facet[]) {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const idx = geo.getIndex();
  const total = idx ? idx.count : pos.count;
  const e = mesh.matrixWorld.elements;
  const mirrored = mesh.matrixWorld.determinant() < 0;
  const mats = Array.isArray(mesh.material) ? mesh.material : null;
  const ranges: [number, number, THREE.Material | undefined][] = mats
    ? geo.groups.map((g) => [g.start, Math.min(g.count, total - g.start), mats[g.materialIndex ?? 0]])
    : [[geo.drawRange.start, Math.min(geo.drawRange.count, total - geo.drawRange.start), mesh.material as THREE.Material]];
  const acc = new Map<string, { nx: number; ny: number; nz: number; d: number; vis: number; mat: THREE.Material; tris: number[]; area: number }>();
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [start, count, mat] of ranges) {
    if (!mat || !mat.visible || mat.colorWrite === false) continue;
    const side = mat.side;
    const visFront = side === THREE.BackSide ? 2 : side === THREE.DoubleSide ? 3 : 1;
    for (let t = start; t + 2 < start + count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k;
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        v[k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        v[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        v[k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const ux = v[3] - v[0];
      const uy = v[4] - v[1];
      const uz = v[5] - v[2];
      const wx = v[6] - v[0];
      const wy = v[7] - v[1];
      const wz = v[8] - v[2];
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-10) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      // a mirrored mesh is drawn with the front face flipped
      let vis = visFront;
      if (mirrored) vis = ((vis & 1) << 1) | ((vis & 2) >> 1);
      let d = nx * v[0] + ny * v[1] + nz * v[2];
      // canonical orientation: parallel faces of either facing share one normal
      const eps = 1e-7;
      if (nx < -eps || (Math.abs(nx) <= eps && (ny < -eps || (Math.abs(ny) <= eps && nz < 0)))) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        d = -d;
        vis = ((vis & 1) << 1) | ((vis & 2) >> 1);
      }
      const key = `${Math.round(nx * 1e3)},${Math.round(ny * 1e3)},${Math.round(nz * 1e3)},${Math.round(d * 1e3)},${vis},${mat.id}`;
      let f = acc.get(key);
      if (!f) acc.set(key, (f = { nx, ny, nz, d, vis, mat, tris: [], area: 0 }));
      for (let k = 0; k < 9; k++) f.tris.push(v[k]);
      f.area += len / 2;
    }
  }
  for (const f of acc.values()) {
    if (f.area < MIN_AREA) continue;
    // a face looking down at its storey's floor height (a base on the floor): it can only be seen
    // from below, and no camera goes under the ground floor (an upper storey is hidden from the one below)
    if (Math.abs(f.ny) > 0.999 && Math.abs(f.d - floorY) < 0.001 && f.vis === 2) continue;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < f.tris.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], f.tris[i + k]);
        max[k] = Math.max(max[k], f.tris[i + k]);
      }
    out.push({ rec: ri, mat: f.mat, nx: f.nx, ny: f.ny, nz: f.nz, d: f.d, vis: f.vis, tris: Float64Array.from(f.tris), area: f.area, min, max });
  }
}

// ───────────────────────────── 2-D overlap in the shared plane ─────────────────────────────

/** orthonormal (u, v, n): plane coordinates for one bucket of parallel faces */
interface Basis {
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  nx: number;
  ny: number;
  nz: number;
}
function basisFor(f: Facet): Basis {
  // u = n × a, v = n × u (a = x axis unless n is close to it)
  const [ax, ay, az] = Math.abs(f.nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = f.ny * az - f.nz * ay;
  let uy = f.nz * ax - f.nx * az;
  let uz = f.nx * ay - f.ny * ax;
  const l = Math.hypot(ux, uy, uz);
  ux /= l;
  uy /= l;
  uz /= l;
  return { ux, uy, uz, vx: f.ny * uz - f.nz * uy, vy: f.nz * ux - f.nx * uz, vz: f.nx * uy - f.ny * ux, nx: f.nx, ny: f.ny, nz: f.nz };
}
interface Projected {
  p: Float64Array;
  bb: Float64Array;
}
/** triangles in 2-D (6 numbers each, counter-clockwise) + per-triangle bounds (4 each) */
function project(f: Facet, b: Basis): Projected {
  const n = f.tris.length / 9;
  const p = new Float64Array(n * 6);
  const bb = new Float64Array(n * 4);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const x = f.tris[t * 9 + k * 3];
      const y = f.tris[t * 9 + k * 3 + 1];
      const z = f.tris[t * 9 + k * 3 + 2];
      p[t * 6 + k * 2] = x * b.ux + y * b.uy + z * b.uz;
      p[t * 6 + k * 2 + 1] = x * b.vx + y * b.vy + z * b.vz;
    }
    const o = t * 6;
    const s = (p[o + 2] - p[o]) * (p[o + 5] - p[o + 1]) - (p[o + 4] - p[o]) * (p[o + 3] - p[o + 1]);
    if (s < 0) {
      // swap vertices 1 and 2 → counter-clockwise
      const x1 = p[o + 2];
      const y1 = p[o + 3];
      p[o + 2] = p[o + 4];
      p[o + 3] = p[o + 5];
      p[o + 4] = x1;
      p[o + 5] = y1;
    }
    bb[t * 4] = Math.min(p[o], p[o + 2], p[o + 4]);
    bb[t * 4 + 1] = Math.min(p[o + 1], p[o + 3], p[o + 5]);
    bb[t * 4 + 2] = Math.max(p[o], p[o + 2], p[o + 4]);
    bb[t * 4 + 3] = Math.max(p[o + 1], p[o + 3], p[o + 5]);
  }
  return { p, bb };
}
/** clip a convex polygon (flat x,y list) by a counter-clockwise triangle (Sutherland–Hodgman) */
function clip(poly: number[], tri: Float64Array, o: number): number[] {
  let cur = poly;
  for (let e = 0; e < 3 && cur.length >= 6; e++) {
    const ax = tri[o + e * 2];
    const ay = tri[o + e * 2 + 1];
    const bx = tri[o + ((e + 1) % 3) * 2];
    const by = tri[o + ((e + 1) % 3) * 2 + 1];
    const side = (x: number, y: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const next: number[] = [];
    const n = cur.length / 2;
    for (let i = 0; i < n; i++) {
      const px = cur[i * 2];
      const py = cur[i * 2 + 1];
      const qx = cur[((i + 1) % n) * 2];
      const qy = cur[((i + 1) % n) * 2 + 1];
      const sp = side(px, py);
      const sq = side(qx, qy);
      if (sp >= 0) next.push(px, py);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push(px + (qx - px) * t, py + (qy - py) * t);
      }
    }
    cur = next;
  }
  return cur;
}
function polyArea(p: number[]): number {
  let s = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) s += p[i * 2] * p[((i + 1) % n) * 2 + 1] - p[((i + 1) % n) * 2] * p[i * 2 + 1];
  return Math.abs(s) / 2;
}

interface Overlap {
  area: number;
  polys: number[][];
  cx: number;
  cy: number;
}
function overlap(pa: Projected, pb: Projected, keepPolys: boolean): Overlap {
  const out: Overlap = { area: 0, polys: [], cx: 0, cy: 0 };
  const na = pa.p.length / 6;
  const nb = pb.p.length / 6;
  if (na * nb > 2e5) {
    // two huge faces (terrain, ground layers): the overlap of their bounding rectangles will do
    const box = (q: Projected) => {
      const r = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < q.bb.length; i += 4) {
        r[0] = Math.min(r[0], q.bb[i]);
        r[1] = Math.min(r[1], q.bb[i + 1]);
        r[2] = Math.max(r[2], q.bb[i + 2]);
        r[3] = Math.max(r[3], q.bb[i + 3]);
      }
      return r;
    };
    const a = box(pa);
    const b = box(pb);
    const x0 = Math.max(a[0], b[0]);
    const y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[2], b[2]);
    const y1 = Math.min(a[3], b[3]);
    if (x1 > x0 && y1 > y0) {
      out.area = (x1 - x0) * (y1 - y0);
      out.cx = (x0 + x1) / 2;
      out.cy = (y0 + y1) / 2;
      if (keepPolys) out.polys.push([x0, y0, x1, y0, x1, y1, x0, y1]);
    }
    return out;
  }
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      if (pa.bb[i * 4] >= pb.bb[j * 4 + 2] || pb.bb[j * 4] >= pa.bb[i * 4 + 2] || pa.bb[i * 4 + 1] >= pb.bb[j * 4 + 3] || pb.bb[j * 4 + 1] >= pa.bb[i * 4 + 3]) continue;
      const poly = clip(Array.from(pa.p.subarray(i * 6, i * 6 + 6)), pb.p, j * 6);
      if (poly.length < 6) continue;
      const a = polyArea(poly);
      if (a < 1e-9) continue;
      out.area += a;
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < poly.length; k += 2) {
        sx += poly[k];
        sy += poly[k + 1];
      }
      out.cx += (sx / (poly.length / 2)) * a;
      out.cy += (sy / (poly.length / 2)) * a;
      if (keepPolys) out.polys.push(poly);
    }
  }
  if (out.area > 0) {
    out.cx /= out.area;
    out.cy /= out.area;
  }
  return out;
}
/** area of the polygons covered by a facet's triangles */
function covered(polys: number[][], w: Projected): number {
  let s = 0;
  const nw = w.p.length / 6;
  for (const poly of polys) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < poly.length; k += 2) {
      x0 = Math.min(x0, poly[k]);
      y0 = Math.min(y0, poly[k + 1]);
      x1 = Math.max(x1, poly[k]);
      y1 = Math.max(y1, poly[k + 1]);
    }
    for (let j = 0; j < nw; j++) {
      if (x0 >= w.bb[j * 4 + 2] || w.bb[j * 4] >= x1 || y0 >= w.bb[j * 4 + 3] || w.bb[j * 4 + 1] >= y1) continue;
      const c = clip(poly, w.p, j * 6);
      if (c.length >= 6) s += polyArea(c);
    }
  }
  return s;
}

// ───────────────────────────── the pair search ─────────────────────────────

function describeGeo(m: THREE.Mesh): string {
  const g = m.geometry as THREE.BufferGeometry & { parameters?: Record<string, unknown> };
  const p = g.parameters ?? {};
  const n = (k: string) => {
    const x = p[k];
    return typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : '?';
  };
  let s: string;
  switch (g.type) {
    case 'BoxGeometry':
      s = `box ${n('width')}×${n('height')}×${n('depth')}`;
      break;
    case 'RoundedBoxGeometry':
      s = `rbox ${n('width')}×${n('height')}×${n('depth')} r${n('radius')}`;
      break;
    case 'CylinderGeometry':
      s = `cyl r${n('radiusTop')}/${n('radiusBottom')} h${n('height')}`;
      break;
    case 'PlaneGeometry':
      s = `plane ${n('width')}×${n('height')}`;
      break;
    case 'CircleGeometry':
      s = `circle r${n('radius')}`;
      break;
    case 'TorusGeometry':
      s = `torus r${n('radius')} t${n('tube')}`;
      break;
    default:
      s = g.type.replace('Geometry', '').toLowerCase() || 'geometry';
  }
  const sc = m.scale;
  if (sc.x !== 1 || sc.y !== 1 || sc.z !== 1) s += ` scaled ${+sc.x.toFixed(3)},${+sc.y.toFixed(3)},${+sc.z.toFixed(3)}`;
  return s;
}
function describeMat(mat: THREE.Material): string {
  const m = mat as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null; emissive?: THREE.Color; emissiveIntensity?: number };
  let s = mat.type.replace('Material', '');
  if (m.color) s += ` #${m.color.getHexString()}`;
  if (m.map) s += ' +map';
  if (m.emissive && m.emissive.getHex() && (m.emissiveIntensity ?? 0) > 0) s += ' emissive';
  if (!opaque(mat)) s += ' transparent';
  if (mat.side === THREE.DoubleSide) s += ' double-sided';
  return s;
}
const r3 = (v: THREE.Vector3): [number, number, number] => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];

function scanRecs(recs: Rec[], pass: 'world' | 'isolated', stats: Record<string, number>, all: boolean): ScanFinding[] {
  const t0 = performance.now();
  const facets: Facet[] = [];
  recs.forEach((r, i) => facetsOf(i, r.mesh, r.floorY, facets));
  stats[`${pass}.facets`] = (stats[`${pass}.facets`] ?? 0) + facets.length;
  if (pass === 'world') console.info(`[zfight] ${recs.length} meshes → ${facets.length} facets (${Math.round(performance.now() - t0)} ms)`);
  // buckets of parallel faces by canonical normal (2e-3 cells; a face near a cell edge goes in both)
  const q = 0.002;
  const buckets = new Map<string, number[]>();
  const cells = (c: number) => {
    const s = c / q;
    const f = s - Math.floor(s);
    return Math.abs(f - 0.5) < 0.05 ? [Math.floor(s), Math.floor(s) + 1] : [Math.round(s)];
  };
  facets.forEach((f, i) => {
    for (const a of cells(f.nx))
      for (const b of cells(f.ny))
        for (const c of cells(f.nz)) {
          const k = `${a},${b},${c}`;
          let arr = buckets.get(k);
          if (!arr) buckets.set(k, (arr = []));
          arr.push(i);
        }
  });
  const near = (A: Facet, B: Facet, pad: number) =>
    !(A.min[0] > B.max[0] + pad || B.min[0] > A.max[0] + pad || A.min[1] > B.max[1] + pad || B.min[1] > A.max[1] + pad || A.min[2] > B.max[2] + pad || B.min[2] > A.max[2] + pad);
  /** an overlapping pair of faces (first found), its bucket, and the side(s) both show */
  interface Raw {
    a: number;
    b: number;
    bucket: string;
    common: number;
  }
  const seen = new Set<string>();
  const raw = new Map<string, Raw>();
  let pairs = 0;
  for (const [bkey, list] of buckets) {
    list.sort((i, j) => facets[i].d - facets[j].d);
    const cache = new Map<number, Projected>();
    let basis: Basis | null = null;
    const projected = (fi: number) => {
      let p = cache.get(fi);
      if (!p) cache.set(fi, (p = project(facets[fi], basis!)));
      return p;
    };
    for (let ii = 0; ii < list.length; ii++) {
      const A = facets[list[ii]];
      for (let jj = ii + 1; jj < list.length; jj++) {
        const B = facets[list[jj]];
        const gap = B.d - A.d;
        if (gap > NEAR_GAP) break;
        if (A.rec === B.rec) continue;
        const ra = recs[A.rec];
        const rb = recs[B.rec];
        if ((ra.layer === LAYER_TALL && rb.layer === LAYER_LOW) || (ra.layer === LAYER_LOW && rb.layer === LAYER_TALL)) continue;
        const common = A.vis & B.vis;
        if (!common) continue;
        if (A.nx * B.nx + A.ny * B.ny + A.nz * B.nz < COS_PARALLEL) continue;
        if (!near(A, B, NEAR_GAP)) continue;
        const [lo, hi] = list[ii] < list[jj] ? [list[ii], list[jj]] : [list[jj], list[ii]];
        const pk = `${lo}:${hi}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        pairs++;
        basis ??= basisFor(A);
        const ov = overlap(projected(list[ii]), projected(list[jj]), false);
        if (ov.area < MIN_AREA) continue;
        const [fa, fb] = A.rec < B.rec ? [list[ii], list[jj]] : [list[jj], list[ii]];
        const key = `${facets[fa].rec}|${facets[fb].rec}|${Math.round(A.nx * 1000)},${Math.round(A.ny * 1000)},${Math.round(A.nz * 1000)}|${Math.round(A.d * 1000)}|${common}`;
        if (!raw.has(key)) raw.set(key, { a: fa, b: fb, bucket: bkey, common });
      }
    }
  }
  stats[`${pass}.pairsTested`] = (stats[`${pass}.pairsTested`] ?? 0) + pairs;
  if (pass === 'world') console.info(`[zfight] ${pairs} pairs tested, ${raw.size} overlaps (${Math.round(performance.now() - t0)} ms, heap ${Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6)} MB)`);

  // closed opaque solids (boxes, rounded boxes, cylinders) for the "enclosed" test, in world bounds
  const solids: { rec: number; inv: THREE.Matrix4; hx: number; hy: number; hz: number; cyl: [number, number] | null; box: THREE.Box3 }[] = [];
  recs.forEach((rec, i) => {
    const m = rec.mesh;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || !opaque(mat)) return;
    const g = m.geometry as THREE.BufferGeometry & { parameters?: Record<string, number | boolean> };
    const p = g.parameters ?? {};
    let hx = 0;
    let hy = 0;
    let hz = 0;
    let cyl: [number, number] | null = null;
    if (g.type === 'BoxGeometry' || g.type === 'RoundedBoxGeometry') {
      // a rounded box is short of its bounds at the edges: shrink by a third of the radius
      const r = g.type === 'RoundedBoxGeometry' ? Number(p.radius ?? 0) / 3 : 0;
      hx = Number(p.width) / 2 - r;
      hy = Number(p.height) / 2 - r;
      hz = Number(p.depth) / 2 - r;
    } else if (g.type === 'CylinderGeometry' && !p.openEnded && Number(p.thetaLength ?? Math.PI * 2) >= Math.PI * 2 - 1e-6) {
      hy = Number(p.height) / 2;
      cyl = [Number(p.radiusTop), Number(p.radiusBottom)];
      hx = hz = Math.max(cyl[0], cyl[1]);
    } else return;
    if (!(hx > 0 && hy > 0 && hz > 0)) return;
    solids.push({ rec: i, inv: m.matrixWorld.clone().invert(), hx, hy, hz, cyl, box: new THREE.Box3().setFromObject(m) });
  });
  const tmp = new THREE.Vector3();
  const enclosedBy = (p: THREE.Vector3, skipA: number, skipB: number) => {
    for (const s of solids) {
      if (s.rec === skipA || s.rec === skipB || !s.box.containsPoint(p)) continue;
      tmp.copy(p).applyMatrix4(s.inv);
      if (Math.abs(tmp.y) > s.hy) continue;
      if (s.cyl) {
        // cylinder radius shrinks/grows linearly from bottom (−hy) to top (+hy); facets cut inside the circle
        const r = (s.cyl[1] + ((tmp.y + s.hy) / (2 * s.hy)) * (s.cyl[0] - s.cyl[1])) * 0.97;
        if (Math.hypot(tmp.x, tmp.z) <= r) return true;
      } else if (Math.abs(tmp.x) <= s.hx && Math.abs(tmp.z) <= s.hz) return true;
    }
    return false;
  };

  const findings: ScanFinding[] = [];
  let buried = 0;
  let enclosed = 0;
  for (const r of raw.values()) {
    const A = facets[r.a];
    const B = facets[r.b];
    const sameMat = A.mat === B.mat && (!(A.mat as THREE.MeshStandardMaterial).map || !!A.mat.userData?.worldUV);
    const glassy = !opaque(A.mat) && !opaque(B.mat);
    if (!all && (glassy || sameMat)) {
      // nothing to see; counted without the visibility tests
      const t = glassy ? 'glass' : 'same-material';
      stats[`${pass}.${t}`] = (stats[`${pass}.${t}`] ?? 0) + 1;
      continue;
    }
    // exact geometry in A's own plane: overlap polygons, and B's distance at their centre
    const basis = basisFor(A);
    const ov = overlap(project(A, basis), project(B, basis), true);
    if (ov.area < MIN_AREA) continue;
    const n = new THREE.Vector3(A.nx, A.ny, A.nz);
    const u = new THREE.Vector3(basis.ux, basis.uy, basis.uz);
    const v = new THREE.Vector3(basis.vx, basis.vy, basis.vz);
    const onA = (x: number, y: number, lift = 0) => u.clone().multiplyScalar(x).addScaledVector(v, y).addScaledVector(n, A.d + lift);
    const c = onA(ov.cx, ov.cy);
    const nB = new THREE.Vector3(B.nx, B.ny, B.nz);
    const offB = (B.d - nB.dot(c)) / n.dot(nB); // B's plane, along A's normal from c
    const gap = Math.abs(offB);
    if (gap > NEAR_GAP) continue;
    const tier: Tier = glassy ? 'glass' : sameMat ? 'same-material' : gap <= ZFIGHT_GAP ? 'zfight' : 'near';
    // two storeys, faces looking down (the ceiling below vs the bases upstairs): only seen from
    // below, and floors.ts shows a storey only when you are on it or above
    const downOnly = (r.common === 2 && A.ny > 0.999) || (r.common === 1 && A.ny < -0.999);
    if (recs[A.rec].storey !== recs[B.rec].storey && downOnly) {
      stats[`${pass}.storeyHidden`] = (stats[`${pass}.storeyHidden`] ?? 0) + 1;
      continue;
    }
    // buried: pressed against an opaque face that looks the other way (a floor, a wall, a desk top);
    // the overlap can only be seen from inside that solid
    const behind = 3 & ~r.common;
    if (behind) {
      const lo = Math.min(A.d, B.d) - ZFIGHT_GAP;
      const hi = Math.max(A.d, B.d) + ZFIGHT_GAP;
      let cov = 0;
      const list = buckets.get(r.bucket) ?? [];
      // the bucket is sorted by d: start at the first face at or above lo
      let k0 = 0;
      for (let k1 = list.length; k0 < k1; ) {
        const mid = (k0 + k1) >> 1;
        if (facets[list[mid]].d < lo) k0 = mid + 1;
        else k1 = mid;
      }
      for (let k = k0; k < list.length && facets[list[k]].d <= hi; k++) {
        const W = facets[list[k]];
        if (W.rec === A.rec || W.rec === B.rec || W.vis !== behind || !opaque(W.mat) || W.mat.side === THREE.DoubleSide) continue;
        if (!near(A, W, NEAR_GAP) || !near(B, W, NEAR_GAP)) continue;
        cov += covered(ov.polys, project(W, basis));
        if (cov >= ov.area * 0.9) break;
      }
      if (cov >= ov.area * 0.9) {
        buried++;
        continue;
      }
    }
    // enclosed: just off the faces, on every side they show, is the inside of another closed solid
    // (a glass edge inside its frame, a panel end inside a post)
    const polys = [...ov.polys].sort((x, y) => polyArea(y) - polyArea(x)).slice(0, 8);
    const samples: [number, number][] = [];
    for (const poly of polys) {
      let sx = 0;
      let sy = 0;
      const k = poly.length / 2;
      for (let i = 0; i < poly.length; i += 2) {
        sx += poly[i] / k;
        sy += poly[i + 1] / k;
      }
      samples.push([sx, sy]);
      for (let i = 0; i < poly.length && samples.length < 24; i += 2) samples.push([poly[i] + (sx - poly[i]) * 0.25, poly[i + 1] + (sy - poly[i + 1]) * 0.25]);
    }
    const top = Math.max(0, offB) + 0.001;
    const bottom = Math.min(0, offB) - 0.001;
    const sides = [r.common & 1 ? top : null, r.common & 2 ? bottom : null].filter((x): x is number => x !== null);
    if (sides.every((lift) => samples.every(([x, y]) => enclosedBy(onA(x, y, lift), A.rec, B.rec)))) {
      enclosed++;
      continue;
    }
    const ra = recs[A.rec];
    const rb = recs[B.rec];
    const at = c.clone().addScaledVector(n, offB / 2);
    // the normal the shared faces show (not the canonical one) when they look one way
    const shown = r.common === 2 ? n.clone().negate() : n;
    const owner = ra.owner ?? rb.owner;
    const toLocal = (o: THREE.Object3D | null, p: THREE.Vector3) => (o ? o.worldToLocal(p.clone()) : p.clone());
    const meshInfo = (rec: Rec, mat: THREE.Material): ScanMesh => ({
      geo: describeGeo(rec.mesh),
      mat: describeMat(mat),
      frames: framesOf(rec.mesh),
      pos: r3(toLocal(rec.owner, rec.mesh.getWorldPosition(new THREE.Vector3()))),
    });
    const cross = ra.ownerKey !== rb.ownerKey;
    findings.push({
      pass,
      tier,
      owner: cross ? `${ra.ownerKey} | ${rb.ownerKey}` : ra.ownerKey,
      cross,
      facing: A.vis === 3 || B.vis === 3 ? 'double-sided' : 'same',
      a: meshInfo(ra, A.mat),
      b: meshInfo(rb, B.mat),
      normal: [Math.round(shown.x * 1000) / 1000, Math.round(shown.y * 1000) / 1000, Math.round(shown.z * 1000) / 1000],
      at: r3(at),
      local: r3(toLocal(owner, at)),
      gap,
      area: ov.area,
    });
  }
  stats[`${pass}.buried`] = (stats[`${pass}.buried`] ?? 0) + buried;
  stats[`${pass}.enclosed`] = (stats[`${pass}.enclosed`] ?? 0) + enclosed;
  if (pass === 'world') console.info(`[zfight] ${findings.length} findings, ${buried} buried, ${enclosed} enclosed (${Math.round(performance.now() - t0)} ms)`);
  stats[`${pass}.ms`] = (stats[`${pass}.ms`] ?? 0) + Math.round(performance.now() - t0);
  return findings;
}

/** meshes under `root` that can be seen (InstancedMesh/SkinnedMesh/lines skipped), with their owner */
function collect(root: THREE.Object3D, containers: Set<THREE.Object3D>, label: (owner: THREE.Object3D | null, mesh: THREE.Mesh) => string, layerOf: (o: THREE.Object3D) => number, stats: Record<string, number>, storeyOf: (o: THREE.Object3D) => [number, number] = () => [0, 0]): Rec[] {
  const recs: Rec[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (!m.isMesh) return;
    if (m.isInstancedMesh || m.isSkinnedMesh) {
      stats.skippedInstanced = (stats.skippedInstanced ?? 0) + 1;
      return;
    }
    // not on layer 0: the main camera never draws it (e.g. vehicles.ts's sun-shadow twins on layer 1)
    if (!(m.layers.mask & 1)) return;
    // hidden branches (except the top-down layer, which is its own layer)
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible && layerOf(p) !== LAYER_LOW) return;
    let owner: THREE.Object3D | null = null;
    for (let p: THREE.Object3D | null = m; p && p.parent; p = p.parent)
      if (containers.has(p.parent)) {
        owner = p === m ? null : p;
        break;
      }
    const [storey, floorY] = storeyOf(m);
    recs.push({ mesh: m, owner, ownerKey: label(owner, m), layer: layerOf(m), storey, floorY });
  });
  return recs;
}

const fileFn = (o: THREE.Object3D) => {
  const f = framesOf(o)[0];
  return f ? `${f.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').replace(/^.*\//, '')}:${f.fn}` : '?';
};

// ───────────────────────────── self-test ─────────────────────────────

/**
 * The detector on known cases: the two flickers the owner spotted by eye (as they were before
 * their fix), one of them turned and moved (world matrices), a poster flush on its board, and two
 * that must stay quiet (the fixed glove box, two bases on the floor).
 */
export function selfTest(): { name: string; ok: boolean; found: number }[] {
  instrument();
  const a = lambert('#eef1f2');
  const b = lambert('#0f6e6e');
  const cases: [string, boolean, (g: THREE.Group) => void][] = [
    ['dispenser header band as it was (body width and top)', true, (g) => {
      rboxB(g, 1.1, 1.9, 0.62, 0.03, a, 0, 0, 0);
      rboxB(g, 1.1, 0.25, 0.64, 0.03, b, 0, 1.65, 0);
    }],
    ['the same band, turned 40° and moved', true, (g) => {
      g.position.set(12.3, 0, -4.1);
      g.rotation.y = 0.7;
      rboxB(g, 1.1, 1.9, 0.62, 0.03, a, 0, 0, 0);
      rboxB(g, 1.1, 0.25, 0.64, 0.03, b, 0, 1.65, 0);
    }],
    ['sink glove box as it was (front flush with its holder)', true, (g) => {
      rboxB(g, 0.27, 0.14, 0.12, 0.01, a, -0.2, 1.3, -0.2);
      rboxB(g, 0.24, 0.12, 0.1, 0.01, b, -0.2, 1.31, -0.19);
    }],
    ['poster plane flush on its board', true, (g) => {
      add(g, G.box(0.64, 0.84, 0.02), a, 0, 1.5, 0);
      add(g, G.plane(0.6, 0.8), b, 0, 1.5, 0.01);
    }],
    ['glove box 3 mm proud of its holder (fixed)', false, (g) => {
      rboxB(g, 0.27, 0.14, 0.12, 0.01, a, -0.2, 1.3, -0.2);
      rboxB(g, 0.24, 0.12, 0.1, 0.01, b, -0.2, 1.31, -0.187);
    }],
    ['a plinth inside a cabinet, both bases on the floor', false, (g) => {
      add(g, G.box(0.5, 0.4, 0.5), a, 0, 0.2, 0);
      add(g, G.box(0.3, 0.1, 0.3), b, 0, 0.05, 0);
    }],
  ];
  return cases.map(([name, expect, build]) => {
    const scene = new THREE.Group();
    const g = new THREE.Group();
    scene.add(g);
    build(g);
    scene.updateMatrixWorld(true);
    const recs = collect(scene, new Set([scene]), (owner) => (owner ? 'case' : '(scene)'), () => LAYER_BASE, {});
    const found = scanRecs(recs, 'isolated', {}, false).filter((f) => f.tier === 'zfight').length;
    return { name, ok: found > 0 === expect, found };
  });
}

// ───────────────────────────── entry ─────────────────────────────

export async function scan(o: { kinds: PropKind[]; world?: boolean; isolated?: boolean; all?: boolean }): Promise<ScanResult> {
  instrument();
  const stats: Record<string, number> = {};
  const groups = new Map<string, ScanGroup>();
  /** every flicker candidate, grouped by the two builder calls; the invisible tiers (same material, glass on glass) are counted, and listed with `all` */
  const keep = (f: ScanFinding) => {
    const k = `${f.pass}.${f.tier}`;
    stats[k] = (stats[k] ?? 0) + 1;
    if (f.tier !== 'zfight' && f.tier !== 'near' && !o.all) return;
    const sites = [at(f.a.frames[0]), at(f.b.frames[0])].sort().join(' × ');
    const key = `${f.tier}|${sites}|${f.owner.split(' | ').map(kindOf).join(' | ')}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { tier: f.tier, count: 1, passes: [f.pass], owners: [f.owner], example: f });
      return;
    }
    g.count++;
    if (!g.passes.includes(f.pass)) g.passes.push(f.pass);
    if (g.owners.length < 6 && !g.owners.includes(f.owner)) g.owners.push(f.owner);
    if (f.area > g.example.area) g.example = f;
  };
  const layout = LAYOUTS.ed;
  /** first placed group of each prop kind, and the loose architecture (walls, floors) around it */
  const placed = new Map<string, THREE.Object3D>();
  const architecture: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];

  if (o.world !== false) {
    const t0 = performance.now();
    forceNoMerge = true;
    let built: ReturnType<typeof buildWorld>;
    try {
      built = buildWorld(layout);
    } finally {
      forceNoMerge = false;
    }
    stats.buildMs = Math.round(performance.now() - t0);
    console.info(`[zfight] world built in ${stats.buildMs} ms`);
    const root = built.root;
    const staticRoot = root.children[0];
    const tallStatic = built.tall.children[0];
    const lowStatic = built.low.children[0];
    const containers = new Set<THREE.Object3D>([root, staticRoot, built.tall, tallStatic, built.low, lowStatic]);
    const talls = new Set<THREE.Object3D>([built.tall]);
    const lows = new Set<THREE.Object3D>([built.low]);
    /** each storey's prop containers, its props and its floor height */
    const storeys: { statics: THREE.Object3D[]; props: PropDef[]; y: number }[] = [{ statics: [staticRoot, tallStatic], props: layout.props, y: 0 }];
    const storeyRoots = new Map<THREE.Object3D, [number, number]>();
    // upper floors (World.ts adds them through floors.ts): built the same way when that code is there.
    // Loaded by URL so this check keeps working (without them) if that API changes.
    try {
      const here = new URL(import.meta.url);
      const floorsUrl = new URL('../shared/floors.ts', here).pathname;
      const upperUrl = '/src/world/upperFloor.ts';
      type Upper = { base: THREE.Group; tall: THREE.Group; low: THREE.Group; shell: THREE.Group };
      const fm = (await import(/* @vite-ignore */ floorsUrl)) as { upperLevels?: (l: typeof layout) => { y: number; props: PropDef[] }[] };
      const um = (await import(/* @vite-ignore */ upperUrl)) as { buildUpperLevel?: (l: typeof layout, L: unknown) => Upper };
      if (fm.upperLevels && um.buildUpperLevel) {
        for (const L of fm.upperLevels(layout)) {
          forceNoMerge = true;
          let up: Upper;
          try {
            up = um.buildUpperLevel(layout, L);
          } finally {
            forceNoMerge = false;
          }
          root.add(up.base, up.tall, up.low, up.shell);
          for (const g of [up.base, up.tall, up.low, up.shell]) storeyRoots.set(g, [storeys.length, L.y]);
          const [bs, ts, ls] = [up.base.children[0], up.tall.children[0], up.low.children[0]];
          for (const c of [up.base, up.tall, up.low, up.shell, bs, ts, ls]) if (c) containers.add(c);
          talls.add(up.tall);
          lows.add(up.low);
          storeys.push({ statics: [bs, ts].filter(Boolean), props: L.props ?? [], y: L.y });
          stats.upperLevels = (stats.upperLevels ?? 0) + 1;
        }
      }
    } catch (e) {
      console.info(`[zfight] upper floors skipped: ${(e as Error).message}`);
    }
    root.updateMatrixWorld(true);
    // prop groups are added in layout order (signs build no group): name them after their PropDef
    const names = new Map<THREE.Object3D, string>();
    for (const st of storeys) {
      const groups = st.statics.flatMap((c) => c.children).filter((c) => !(c as THREE.Mesh).isMesh).sort((a, b) => (bornSeq.get(a) ?? 0) - (bornSeq.get(b) ?? 0));
      let gi = 0;
      for (const p of st.props) {
        if (p.kind === 'sign') continue;
        const g = groups[gi];
        if (!g) break;
        const ok = Math.abs(g.position.x - p.x) < 1e-6 && Math.abs(g.position.z - p.z) < 1e-6 && Math.abs(g.position.y - st.y - (p.y ?? 0)) < 1e-6;
        if (!ok) {
          stats.unmatchedPropGroups = (stats.unmatchedPropGroups ?? 0) + 1;
          console.info(`[zfight] no group for prop ${p.id} (${p.kind}) at its position`);
          continue;
        }
        names.set(g, `${p.id} (${p.kind})`);
        if (!placed.has(p.kind)) placed.set(p.kind, g);
        gi++;
      }
      for (const g of groups.slice(gi)) {
        let first: THREE.Object3D | null = null;
        g.traverse((c) => {
          if (!first && (c as THREE.Mesh).isMesh) first = c;
        });
        names.set(g, `set dressing ${first ? fileFn(first) : '?'} @ ${g.position.x.toFixed(2)},${g.position.z.toFixed(2)}`);
      }
    }
    const layerOf = (obj: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = obj; p; p = p.parent) {
        if (lows.has(p)) return LAYER_LOW;
        if (talls.has(p)) return LAYER_TALL;
      }
      return LAYER_BASE;
    };
    const storeyOf = (obj: THREE.Object3D): [number, number] => {
      for (let p: THREE.Object3D | null = obj; p; p = p.parent) {
        const s = storeyRoots.get(p);
        if (s) return s;
      }
      return [0, 0];
    };
    const recs = collect(root, containers, (owner, mesh) => (owner ? names.get(owner) ?? `group ${fileFn(owner)}` : `loose ${fileFn(mesh)}`), layerOf, stats, storeyOf);
    stats.worldMeshes = recs.length;
    for (const r of recs) if (!r.owner && r.layer !== LAYER_LOW) architecture.push({ mesh: r.mesh, box: new THREE.Box3().setFromObject(r.mesh) });
    for (const f of scanRecs(recs, 'world', stats, !!o.all)) keep(f);
  }

  if (o.isolated !== false) {
    // each kind with default sizes, on a floor (bottoms resting on it are buried)
    const floorMat = new THREE.MeshStandardMaterial({ color: '#808080' });
    for (const kind of o.kinds) {
      const scene = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const built = buildProp({ id: `iso_${kind}`, kind, room: 'iso', x: 0, z: 0 } as PropDef);
      scene.add(built.group);
      // the walls/floor around the kind's first placement, in the prop's frame: a back plate
      // against a wall is buried there, as in the game
      const g = placed.get(kind);
      if (g) {
        const near = new THREE.Box3().setFromObject(g).expandByScalar(0.01);
        const inv = g.matrixWorld.clone().invert();
        for (const a of architecture) {
          if (!a.box.intersectsBox(near)) continue;
          const c = new THREE.Mesh(a.mesh.geometry, a.mesh.material);
          c.matrixAutoUpdate = false;
          c.matrix.multiplyMatrices(inv, a.mesh.matrixWorld);
          scene.add(c);
        }
      }
      scene.updateMatrixWorld(true);
      const recs = collect(scene, new Set([scene]), (owner) => (owner === built.group ? `${kind} (default size)` : '(surroundings)'), () => LAYER_BASE, stats);
      for (const f of scanRecs(recs, 'isolated', stats, !!o.all)) if (f.owner === `${kind} (default size)`) keep(f);
      floor.geometry.dispose();
    }
  }
  return { groups: [...groups.values()], stats };
}

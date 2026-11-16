/**
 * Visual QA in numbers (tests/storyboard.ts, docs/VISUAL_QA.md): what a screenshot shows, measured.
 * Only reachable through the ?debug=1 hook (World.ts: __acWorld.audit, __acWorld.bones).
 *
 *  - support: every body's lowest skin, per body segment (CPU-skinned, like care.ts clearance()),
 *    rests on something: the floor, a seat, a bed, a prop, or another person's hand. Which segments
 *    must rest depends on the posture: feet standing; buttocks and feet seated; pelvis, back, head
 *    and legs lying (raised legs on a prop or in someone's hands)
 *  - items: every loose thing lies on a surface (within 1 cm), unless it is in a hand
 *  - clipping: skinned vertices inside closed static geometry (walls, furniture, the floor) deeper
 *    than 2 cm, found with vertical rays: the first face above, seen from behind, means "inside"
 *  - contact: whoever pushes a wheelchair has hands on its handles
 *
 * Static geometry (the merged world, the storeys) is read once per region into a grid of its
 * non-vertical triangles; everything else (props, items, wheelchairs, bedding) is read per call.
 */
import * as THREE from 'three';
import type { NpcView } from '../../../shared/types';
import type { Character } from './characters';

type V3 = [number, number, number];

export interface AuditRegion {
  x: number;
  z: number;
  /** radius (m) around (x, z): bodies and items inside it are audited */
  r: number;
  /** floor height of the storey (0 ground floor, 3 Floor 2) */
  y?: number;
  /** every n-th skinned vertex (default 2) */
  stride?: number;
  /** skip the clipping test (faster) */
  noClip?: boolean;
  /** also compare each face's skin with the hands' (texels under the vertices; slower the first time) */
  skin?: boolean;
}

export interface AuditDeps {
  scene: THREE.Scene;
  /** big static groups: the built world, the storeys */
  staticRoots(): THREE.Object3D[];
  player(): { ch: Character; x: number; z: number; y: number; moving: boolean; airborne: boolean; visible: boolean };
  npcs(): Iterable<{ v: NpcView; ch: Character; pos: THREE.Vector2; yaw: number; path: unknown }>;
  items(): { all: Iterable<{ id: string; kind: string; label: string; root: THREE.Object3D }>; held: readonly { id: string }[] };
  /** layout props, to name what something rests on or clips into */
  props(): { id: string; kind: string; x: number; z: number; y?: number; w?: number; d?: number }[];
}

export interface SegmentReport {
  /** lowest skin point (world m) */
  low: V3;
  /** low[1] minus the surface under it (m; < 0 = sunk into it); null = nothing under it */
  gap: number | null;
  /** what it rests on: 'floor', 'chair 0.48 m', 'prop:wheelchair', 'hand of amb_faint_friend', 'nothing' */
  on: string;
  /** what the posture asks of it */
  rule?: 'rest' | 'rest-or-hand' | 'one-of' | 'info';
  /** the gap to a surface itself (gap may count a hand or the other leg) */
  floorGap?: number | null;
}

export interface Finding {
  who: string;
  kind: 'unsupported' | 'gap' | 'sunk' | 'clipping' | 'floating-item' | 'sunk-item' | 'hands-off' | 'no-phone' | 'clipboard' | 'skin-mismatch';
  what: string;
  /** distance that broke the rule (m) */
  dist: number;
  detail: string;
}

export interface SubjectReport {
  id: string;
  role: string;
  posture: string;
  act?: string;
  /** the mocap clip playing */
  anim?: string;
  moving: boolean;
  x: number;
  z: number;
  props: string[];
  seg: Record<string, SegmentReport>;
  clip: { seg: string; depth: number; at: V3; near: string }[];
}

export interface AuditReport {
  t: number;
  ms: number;
  region: AuditRegion;
  subjects: SubjectReport[];
  items: { id: string; kind: string; label: string; at: V3; gap: number | null; on: string }[];
  findings: Finding[];
  stats: { tris: number; vertices: number; dynamicMeshes: number };
}

// ───────────────────────────── body segments ─────────────────────────────

const SEGS = ['head', 'back', 'pelvis', 'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR', 'armL', 'armR', 'handL', 'handR'] as const;
type Seg = (typeof SEGS)[number];
const SEG_INDEX = new Map(SEGS.map((s, i) => [s, i]));
/** segments a body's weight goes through (seat, mattress, floor) */
const LOAD = new Set(['head', 'back', 'pelvis', 'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR'].map((s) => SEG_INDEX.get(s as Seg)!));

function segOfBone(name: string): Seg | null {
  if (/_Head$|_Neck$|HeadNub|Ponytail|_Hair/i.test(name)) return 'head';
  if (/_Spine\d?$|_Clavicle$/.test(name)) return 'back';
  if (/_Pelvis$|^Bip01$/.test(name)) return 'pelvis';
  const side = /_L_/.test(name) ? 'L' : /_R_/.test(name) ? 'R' : null;
  if (!side) return null;
  if (/_Thigh$/.test(name)) return `thigh${side}`;
  if (/_Calf$/.test(name)) return `calf${side}`;
  if (/_Foot$|_Toe\d/.test(name)) return `foot${side}`;
  if (/_UpperArm$|_Forearm$/.test(name)) return `arm${side}`;
  if (/_Hand$|_Finger/.test(name)) return `hand${side}`;
  return null;
}

/**
 * The vertices a mesh draws (those its index uses), cached on the mesh. An avatar's body, head and hair are
 * primitives sharing one vertex buffer, each drawing only its own part of it: every vertex of the buffer
 * taken for each of them counted skin that isn't drawn there (a head and back 5–8 cm inside a mattress).
 */
function drawnVertices(m: THREE.SkinnedMesh): Uint8Array {
  const cached = m.userData.__auditOwn as Uint8Array | undefined;
  if (cached) return cached;
  const g = m.geometry;
  const out = new Uint8Array(g.getAttribute('position').count);
  if (g.index) for (let k = 0; k < g.index.count; k++) out[g.index.getX(k)] = 1;
  else out.fill(1);
  m.userData.__auditOwn = out;
  return out;
}

/** each vertex's segment (from its heaviest bone), cached on the mesh */
function vertexSegments(m: THREE.SkinnedMesh): Int8Array {
  const cached = m.userData.__auditSeg as Int8Array | undefined;
  if (cached) return cached;
  const si = m.geometry.getAttribute('skinIndex');
  const sw = m.geometry.getAttribute('skinWeight');
  const out = new Int8Array(m.geometry.getAttribute('position').count).fill(-1);
  const byBone = m.skeleton.bones.map((b) => {
    const s = segOfBone(b.name);
    return s ? SEG_INDEX.get(s)! : -1;
  });
  for (let i = 0; i < out.length; i++) {
    let best = -1;
    let bone = -1;
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j);
      if (w > best) {
        best = w;
        bone = si.getComponent(i, j);
      }
    }
    out[i] = byBone[bone] ?? -1;
  }
  m.userData.__auditSeg = out;
  return out;
}

/** acts done with a phone in the hand */
const PHONE_ACTS = new Set(['phone_text', 'phone_call', 'film']);

// ───────────────────────────── skin: the face against the hands ─────────────────────────────

const texels = new WeakMap<THREE.Texture, { d: Uint8ClampedArray; w: number; h: number } | null>();

/** a texture's pixels, read back once through a 2D canvas at ≤ 256 px (mean skin tones need no more) */
function pixelsOf(t: THREE.Texture): { d: Uint8ClampedArray; w: number; h: number } | null {
  if (texels.has(t)) return texels.get(t)!;
  const img = t.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  let out: { d: Uint8ClampedArray; w: number; h: number } | null = null;
  if (img && img.width && img.height) {
    const k = Math.min(1, 256 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.drawImage(img, 0, 0, c.width, c.height);
      out = { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    }
  }
  texels.set(t, out);
  return out;
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
const skinLike = (h: number, s: number, v: number) => (h <= 50 || h >= 340) && s >= 0.1 && s <= 0.85 && v >= 0.08;
const greyLike = (s: number, v: number) => s < 0.08 && v > 0.25;

/**
 * The face's own texels (the front of the head, from the brows to the chin) and the hands', from each
 * mesh's own texture: mean colour of the skin-like ones, and how much of the face is grey.
 */
function skinTones(ch: Character): { face: [number, number, number]; hands: [number, number, number]; grey: number; n: [number, number] } | null {
  ch.root.updateMatrixWorld(true);
  let head: THREE.Object3D | undefined;
  ch.root.traverse((o) => {
    if (!head && (o as THREE.Bone).isBone && /_Head$/.test(o.name)) head = o;
  });
  if (!head) return null;
  const hp = head.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(Math.sin(ch.root.rotation.y), 0, Math.cos(ch.root.rotation.y));
  const v = new THREE.Vector3();
  // texel samples per orientation (the atlas may be stored either way up): [faceSkin, faceAll, …]
  const acc = [0, 1].map(() => ({ face: [0, 0, 0, 0], hands: [0, 0, 0, 0], grey: 0, all: 0 }));
  const headSeg = SEG_INDEX.get('head')!;
  ch.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !worldVisible(m)) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const kind = mat?.name;
    if (!mat?.map || !(kind === 'head' || kind === 'body' || kind === 'skin')) return;
    const px = pixelsOf(mat.map);
    const uv = m.geometry.getAttribute('uv');
    if (!px || !uv) return;
    const segs = vertexSegments(m);
    // the fingers only: always skin (a hand's vertices take in a sleeve's cuff)
    const bones = vertexBones(m);
    const finger = m.skeleton.bones.map((b) => /_Finger/.test(b.name));
    let upper = false;
    for (let i = 0; i < uv.count; i += 2) {
      const sg = segs[i];
      const isFace = kind === 'head' && sg === headSeg;
      const isHand = kind !== 'head' && finger[bones[i]];
      if (!isFace && !isHand) continue;
      if (isFace) {
        // the front of the head from the chin to the forehead; grey counts above the mouth (a grey beard is a beard)
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).sub(hp);
        if (v.dot(fwd) < 0.05 || v.y < -0.11 || v.y > 0.14) continue;
        upper = v.y > -0.03;
      }
      for (let k = 0; k < 2; k++) {
        const u = uv.getX(i) - Math.floor(uv.getX(i));
        let w = uv.getY(i) - Math.floor(uv.getY(i));
        if (k) w = 1 - w;
        const o4 = (Math.min(px.h - 1, Math.floor(w * px.h)) * px.w + Math.min(px.w - 1, Math.floor(u * px.w))) * 4;
        const r = px.d[o4] / 255;
        const g = px.d[o4 + 1] / 255;
        const b = px.d[o4 + 2] / 255;
        const [h, s, val] = hsv(r, g, b);
        const a = acc[k];
        if (isFace && upper) {
          a.all++;
          if (greyLike(s, val)) a.grey++;
        }
        if (!skinLike(h, s, val)) continue;
        const t = isFace ? a.face : a.hands;
        t[0] += r;
        t[1] += g;
        t[2] += b;
        t[3]++;
      }
    }
  });
  // the orientation whose face texels are mostly skin
  const k = acc[0].face[3] >= acc[1].face[3] ? 0 : 1;
  const a = acc[k];
  if (a.face[3] < 20 || a.hands[3] < 20) return null;
  const mean = (t: number[]) => [t[0] / t[3], t[1] / t[3], t[2] / t[3]] as [number, number, number];
  return { face: mean(a.face), hands: mean(a.hands), grey: a.all ? a.grey / a.all : 0, n: [a.face[3], a.hands[3]] };
}

/**
 * One skin tone per person. Face textures carry more baked shading than hands (eye sockets, nostrils):
 * their skin averages ~0.65–1 of the fingers' brightness with the same hue. Outside 0.5–1.25, a hue
 * 25° off, or a quarter of the upper face grey (a scalp's grey spread onto the skin), is two tones.
 */
function toneProblem(t: NonNullable<ReturnType<typeof skinTones>>): { dist: number; detail: string } | null {
  const [hf, sf, vf] = hsv(...t.face);
  const [hh, sh, vh] = hsv(...t.hands);
  const dh = Math.min(Math.abs(hf - hh), 360 - Math.abs(hf - hh));
  const ratio = vf / Math.max(1e-3, vh);
  const hex = (c: number[]) => `#${c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
  const what = `face ${hex(t.face)} vs fingers ${hex(t.hands)} (brightness ${vf.toFixed(2)} vs ${vh.toFixed(2)}, hue ${hf.toFixed(0)}° vs ${hh.toFixed(0)}°); ${(t.grey * 100).toFixed(0)} % of the upper face grey`;
  if (t.grey > 0.25) return { dist: t.grey, detail: `a grey face: ${what}` };
  if (ratio < 0.5 || ratio > 1.25) return { dist: Math.abs(1 - ratio), detail: `face and hands two tones: ${what}` };
  if (dh > 25 && Math.min(sf, sh) > 0.2) return { dist: dh / 100, detail: `face and hands two hues: ${what}` };
  return null;
}

/** each vertex's heaviest bone (index into its skeleton), cached on the mesh */
function vertexBones(m: THREE.SkinnedMesh): Int16Array {
  const cached = m.userData.__auditBone as Int16Array | undefined;
  if (cached) return cached;
  const si = m.geometry.getAttribute('skinIndex');
  const sw = m.geometry.getAttribute('skinWeight');
  const out = new Int16Array(m.geometry.getAttribute('position').count);
  for (let i = 0; i < out.length; i++) {
    let best = -1;
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j);
      if (w > best) {
        best = w;
        out[i] = si.getComponent(i, j);
      }
    }
  }
  m.userData.__auditBone = out;
  return out;
}

const worldVisible = (o: THREE.Object3D) => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

/** something you could rest on or bump into (not a decal, a contact shadow or a hidden pick box) */
function solidMaterial(m: THREE.Material | THREE.Material[], includeGlass = false): THREE.Material | null {
  const mat = Array.isArray(m) ? m[0] : m;
  if (!mat || !mat.visible) return null;
  // Clear drinkware has a physical base even though its glass skips depth writes.
  if (mat.depthWrite === false && !(includeGlass && mat instanceof THREE.MeshPhysicalMaterial)) return null;
  if (mat.transparent && mat.opacity < 0.05) return null;
  return mat;
}

// ───────────────────────────── triangles on vertical lines ─────────────────────────────

/**
 * Non-vertical triangles in world space, binned by their x–z extent. A vertical line through a
 * point meets a triangle where the point lies inside its x–z projection; the height comes from the
 * barycentric weights. flags: 1 = faces up, 2 = double-sided (support either way, never "inside").
 */
class TriSet {
  pos: number[] = [];
  flags: number[] = [];
  near: number[] = [];
  n = 0;

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, double: boolean, near: number): void {
    const e1x = bx - ax;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2z = cz - az;
    const ny = e1z * e2x - e1x * e2z;
    // (a wall, seen from above, is a line: no vertical line meets it)
    const l1 = Math.hypot(e1x, by - ay, e1z);
    const l2 = Math.hypot(e2x, cy - ay, e2z);
    if (Math.abs(ny) < 0.02 * l1 * l2 || Math.abs(ny) < 1e-9) return;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.flags.push((ny > 0 ? 1 : 0) | (double ? 2 : 0));
    this.near.push(near);
    this.n++;
  }
}

class TriGrid {
  readonly cell = 0.2;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  private start: Int32Array;
  private list: Int32Array;
  private p: Float32Array;
  readonly f: Uint8Array;
  readonly near: Int32Array;

  constructor(
    readonly set: TriSet,
    readonly region: { x0: number; z0: number; x1: number; z1: number },
  ) {
    this.x0 = region.x0;
    this.z0 = region.z0;
    this.nx = Math.max(1, Math.ceil((region.x1 - region.x0) / this.cell));
    this.nz = Math.max(1, Math.ceil((region.z1 - region.z0) / this.cell));
    this.p = new Float32Array(set.pos);
    this.f = new Uint8Array(set.flags);
    this.near = new Int32Array(set.near);
    const count = new Int32Array(this.nx * this.nz + 1);
    const span = (i: number) => {
      const o = i * 9;
      const xs = [this.p[o], this.p[o + 3], this.p[o + 6]];
      const zs = [this.p[o + 2], this.p[o + 5], this.p[o + 8]];
      return [this.ix(Math.min(...xs)), this.iz(Math.min(...zs)), this.ix(Math.max(...xs)), this.iz(Math.max(...zs))];
    };
    for (let i = 0; i < set.n; i++) {
      const [a, b, c, d] = span(i);
      for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) count[z * this.nx + x + 1]++;
    }
    for (let k = 1; k < count.length; k++) count[k] += count[k - 1];
    this.start = count;
    this.list = new Int32Array(count[count.length - 1]);
    const fill = new Int32Array(this.nx * this.nz);
    for (let i = 0; i < set.n; i++) {
      const [a, b, c, d] = span(i);
      for (let z = b; z <= d; z++)
        for (let x = a; x <= c; x++) {
          const k = z * this.nx + x;
          this.list[this.start[k] + fill[k]++] = i;
        }
    }
  }

  private ix(x: number) {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / this.cell)));
  }
  private iz(z: number) {
    return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / this.cell)));
  }

  /** |n.y| of triangle i's unit normal (1 = level, 0 = a wall) */
  flatness(i: number): number {
    const p = this.p;
    const o = i * 9;
    const e1x = p[o + 3] - p[o];
    const e1y = p[o + 4] - p[o + 1];
    const e1z = p[o + 5] - p[o + 2];
    const e2x = p[o + 6] - p[o];
    const e2y = p[o + 7] - p[o + 1];
    const e2z = p[o + 8] - p[o + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    return Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
  }

  /** every crossing of the vertical line at (x, z): calls fn(y, flags, triangle) */
  each(x: number, z: number, fn: (y: number, flags: number, tri: number) => void): void {
    if (x < this.region.x0 || x > this.region.x1 || z < this.region.z0 || z > this.region.z1) return;
    const k = this.iz(z) * this.nx + this.ix(x);
    const p = this.p;
    for (let j = this.start[k]; j < this.start[k + 1]; j++) {
      const i = this.list[j];
      const o = i * 9;
      const y = crossY(p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], p[o + 5], p[o + 6], p[o + 7], p[o + 8], x, z);
      if (y !== null) fn(y, this.f[i], i);
    }
  }
}

/** height where the vertical line at (px, pz) meets triangle abc, or null if it misses */
function crossY(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, px: number, pz: number): number | null {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
  const wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
  const wc = 1 - wa - wb;
  const e = -1e-6;
  if (wa < e || wb < e || wc < e) return null;
  return wa * ay + wb * by + wc * cy;
}

/** a dynamic mesh's triangles in world space (props, items, wheelchairs, bedding), read once per call */
interface DynMesh {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  name: string;
  owner: string;
  tris: Float32Array | null;
  double: boolean;
}

function meshTris(m: THREE.Mesh): Float32Array {
  const g = m.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const k = idx ? idx.getX(i) : i;
    v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** a readable name for a prop mesh: its own or its nearest named ancestor's */
function nameOf(o: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name && !/^Bip01|^mixamo/.test(p.name)) return p.name;
  return o.type;
}

// ───────────────────────────── the audit ─────────────────────────────

export function createVisualAudit(d: AuditDeps) {
  let grid: { key: string; g: TriGrid; names: string[] } | null = null;
  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();

  /** the static triangles around the region (cached while the region stays the same) */
  function staticGrid(rg: AuditRegion): TriGrid {
    const pad = 1.5;
    const key = `${rg.x.toFixed(2)},${rg.z.toFixed(2)},${rg.r.toFixed(2)}`;
    if (grid?.key === key) return grid.g;
    const R = { x0: rg.x - rg.r - pad, z0: rg.z - rg.r - pad, x1: rg.x + rg.r + pad, z1: rg.z + rg.r + pad };
    const set = new TriSet();
    const names: string[] = [];
    const nameIdx = new Map<string, number>();
    for (const root of d.staticRoots()) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || !worldVisible(m)) return;
        // (kept out of the merge because they move: a bed's hinged backrest, a desk chair that rolls; read per call)
        // The lot's ground uses its own wet-pavement shader but is a fixed support, including the exit sidewalk.
        if (m.userData.noMerge && m.userData.xpart !== 'ground') return;
        const mat = solidMaterial(m.material);
        if (!mat) return;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        box.copy(g.boundingBox!).applyMatrix4(m.matrixWorld);
        if (box.max.x < R.x0 || box.min.x > R.x1 || box.max.z < R.z0 || box.min.z > R.z1) return;
        const nm = mat.name || nameOf(m);
        let ni = nameIdx.get(nm);
        if (ni === undefined) {
          ni = names.push(nm) - 1;
          nameIdx.set(nm, ni);
        }
        const pos = g.getAttribute('position');
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const id = m.matrixWorld.equals(new THREE.Matrix4());
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const double = mat.side === THREE.DoubleSide;
        for (let i = 0; i + 2 < n; i += 3) {
          const ia = idx ? idx.getX(i) : i;
          const ib = idx ? idx.getX(i + 1) : i + 1;
          const ic = idx ? idx.getX(i + 2) : i + 2;
          a.fromBufferAttribute(pos, ia);
          b.fromBufferAttribute(pos, ib);
          c.fromBufferAttribute(pos, ic);
          if (!id) {
            a.applyMatrix4(m.matrixWorld);
            b.applyMatrix4(m.matrixWorld);
            c.applyMatrix4(m.matrixWorld);
          }
          if (Math.max(a.x, b.x, c.x) < R.x0 || Math.min(a.x, b.x, c.x) > R.x1 || Math.max(a.z, b.z, c.z) < R.z0 || Math.min(a.z, b.z, c.z) > R.z1) continue;
          set.add(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, double, ni);
        }
      });
    }
    grid = { key, g: new TriGrid(set, R), names };
    return grid.g;
  }

  /** props, items, wheelchairs, bedding: everything solid that is not static and not a body */
  function dynamicMeshes(rg: AuditRegion): DynMesh[] {
    const statics = new Set(d.staticRoots());
    const out: DynMesh[] = [];
    const owners = new Map<THREE.Object3D, string>();
    for (const st of d.npcs()) owners.set(st.ch.root, st.v.id);
    owners.set(d.player().ch.root, 'player');
    const visit = (o: THREE.Object3D, owner: string, inStatic = false) => {
      // The interaction highlight is drawn around the selected object or person's feet.
      if (!o.visible || o.name === 'interaction-focus-ring') return;
      const fixed = inStatic || statics.has(o);
      const own = owners.get(o) ?? owner;
      const m = o as THREE.Mesh;
      // static geometry is in the grid, except what moves (noMerge: a bed's backrest, a rolling desk chair)
      if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !(m as THREE.InstancedMesh).isInstancedMesh && (!fixed || m.userData.noMerge)) {
        const mat = solidMaterial(m.material);
        if (mat && m.geometry.getAttribute('position')) {
          const g = m.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const b = g.boundingBox!.clone().applyMatrix4(m.matrixWorld);
          const size = b.getSize(tmp);
          const near = b.max.x > rg.x - rg.r - 1 && b.min.x < rg.x + rg.r + 1 && b.max.z > rg.z - rg.r - 1 && b.min.z < rg.z + rg.r + 1;
          // (no sky domes or ground planes the size of the map: the static grid has the ground)
          if (near && size.x < 40 && size.z < 40) out.push({ mesh: m, box: b, name: nameOf(m), owner: own, tris: null, double: mat.side === THREE.DoubleSide });
        }
      }
      for (const c of o.children) visit(c, own, fixed);
    };
    d.scene.updateMatrixWorld();
    for (const c of d.scene.children) visit(c, '');
    return out;
  }

  /** the highest surface under (x, y0, z): static faces facing up, dynamic ones (excluding `skip`) */
  function surfaceBelow(g: TriGrid, dyn: DynMesh[], x: number, y0: number, z: number, skip?: (m: DynMesh) => boolean): { y: number; on: string } | null {
    let best = -Infinity;
    let on = 'nothing';
    let tri = -1;
    g.each(x, z, (y, f, i) => {
      if (y <= y0 && y > best && f & 3) {
        best = y;
        tri = i;
      }
    });
    if (tri >= 0) on = `static:${grid!.names[g.near[tri]]}`;
    for (const m of dyn) {
      if (x < m.box.min.x || x > m.box.max.x || z < m.box.min.z || z > m.box.max.z || m.box.min.y > y0 || m.box.max.y < best) continue;
      if (skip?.(m)) continue;
      const t = (m.tris ??= meshTris(m.mesh));
      for (let i = 0; i + 8 < t.length; i += 9) {
        const y = crossY(t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5], t[i + 6], t[i + 7], t[i + 8], x, z);
        if (y === null || y > y0 || y <= best) continue;
        const ny = (t[i + 5] - t[i + 2]) * (t[i + 6] - t[i]) - (t[i + 3] - t[i]) * (t[i + 8] - t[i + 2]);
        if (ny <= 0 && !m.double) continue;
        best = y;
        on = m.owner ? `${m.name} (${m.owner})` : m.name;
      }
    }
    return Number.isFinite(best) ? { y: best, on } : null;
  }

  /** the face straight above the last insideV() point: its height and how flat it is (|n.y|, 1 = level) */
  const lastUp = { y: Infinity, flat: 0 };

  /**
   * Inside closed static geometry? The first face straight above must face up (seen from behind) and
   * the first below face down; under the lowest floor, only the first holds. Returns the vertical depth.
   */
  function insideV(g: TriGrid, x: number, y: number, z: number): number {
    let up = Infinity;
    let upF = 0;
    let upT = -1;
    let dn = -Infinity;
    let dnF = 0;
    g.each(x, z, (ty, f, i) => {
      if (f & 2) return;
      if (ty > y && ty < up) {
        up = ty;
        upF = f;
        upT = i;
      } else if (ty <= y && ty > dn) {
        dn = ty;
        dnF = f;
      }
    });
    lastUp.y = up;
    lastUp.flat = upT >= 0 ? g.flatness(upT) : 0;
    if (!Number.isFinite(up) || !(upF & 1)) return 0;
    if (Number.isFinite(dn) && dnF & 1) return 0;
    return Math.min(up - y, Number.isFinite(dn) ? y - dn : Infinity);
  }

  /**
   * Depth inside static geometry (m), at least as deep as the 4 horizontal probes say (2, 4, 8 cm);
   * `soft`: the level top of a raised surface (a seat, a mattress) is right above it.
   */
  function depthAt(g: TriGrid, x: number, y: number, z: number, floorY: number): { depth: number; soft: boolean } {
    const v = insideV(g, x, y, z);
    if (v < 0.02) return { depth: 0, soft: false };
    const soft = lastUp.flat > 0.85 && lastUp.y > floorY + 0.15 && lastUp.y - y <= 0.051;
    let h = 0;
    for (const s of [0.02, 0.04, 0.08]) {
      if (insideV(g, x + s, y, z) > 0 && insideV(g, x - s, y, z) > 0 && insideV(g, x, y, z + s) > 0 && insideV(g, x, y, z - s) > 0) h = s;
      else break;
    }
    return { depth: Math.min(v, h), soft };
  }

  /** the nearest movable surface (pillow, backrest, prop) within 3 cm of a segment's skin, in any direction */
  function touching(b: { p: Float32Array; s: Int8Array; n: number }, k: number, dyn: DynMesh[], skip: (m: DynMesh) => boolean): { d: number; on: string } | null {
    const bb = new THREE.Box3();
    for (let i = 0; i < b.n; i++) if (b.s[i] === k) bb.expandByPoint(tmp.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]));
    if (bb.isEmpty()) return null;
    bb.expandByScalar(0.03);
    const tri = new THREE.Triangle();
    const q = new THREE.Vector3();
    const pt = new THREE.Vector3();
    let best: { d: number; on: string } | null = null;
    for (const m of dyn) {
      if (!m.box.intersectsBox(bb) || skip(m)) continue;
      const t = (m.tris ??= meshTris(m.mesh));
      for (let i = 0; i < b.n; i += 3) {
        if (b.s[i] !== k) continue;
        pt.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]);
        for (let j = 0; j + 8 < t.length; j += 9) {
          tri.a.set(t[j], t[j + 1], t[j + 2]);
          tri.b.set(t[j + 3], t[j + 4], t[j + 5]);
          tri.c.set(t[j + 6], t[j + 7], t[j + 8]);
          const d = tri.closestPointToPoint(pt, q).distanceTo(pt);
          if (d <= 0.03 && (!best || d < best.d)) best = { d, on: m.owner ? `${m.name} (${m.owner})` : m.name };
        }
        if (best && best.d < 0.01) return best;
      }
    }
    return best;
  }

  /**
   * Hands inside the trunk (a hand on the belly in bed, arms folded): skin of a hand nearer the spine's line
   * (pelvis to neck) than the trunk's own skin reaches in that direction, per 2 cm up the trunk and 10° round
   * it. The deepest point of each hand that is more than 1.5 cm in.
   */
  function handsIntoTrunk(b: Body): { side: 'handL' | 'handR'; depth: number }[] {
    const bone = (n: string) => b.ch.root.getObjectByName(`Bip01_${n}`)?.getWorldPosition(new THREE.Vector3());
    const P = bone('Pelvis');
    const N = bone('Neck');
    const L = bone('L_Thigh');
    const R = bone('R_Thigh');
    if (!P || !N || !L || !R) return [];
    const up = N.clone().sub(P);
    const len = up.length();
    if (len < 0.2) return [];
    up.divideScalar(len);
    const across = L.sub(R);
    across.addScaledVector(up, -across.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(across, up);
    const NS = Math.ceil(len / 0.02) + 1;
    const NA = 36;
    const reach = new Float32Array(NS * NA);
    const rel = new THREE.Vector3();
    const polar = (i: number): [number, number, number] | null => {
      rel.set(b.p[i * 3] - P.x, b.p[i * 3 + 1] - P.y, b.p[i * 3 + 2] - P.z);
      const s = rel.dot(up);
      if (s < 0 || s > len) return null;
      const a = rel.dot(across);
      const f = rel.dot(fwd);
      const ang = Math.floor(((Math.atan2(f, a) + Math.PI) / (2 * Math.PI)) * NA) % NA;
      return [Math.floor(s / 0.02), ang, Math.hypot(a, f)];
    };
    const trunk = new Set([SEG_INDEX.get('back')!, SEG_INDEX.get('pelvis')!]);
    for (let i = 0; i < b.n; i++) {
      if (!trunk.has(b.s[i])) continue;
      const q = polar(i);
      if (q) reach[q[0] * NA + q[1]] = Math.max(reach[q[0] * NA + q[1]], q[2]);
    }
    const out: { side: 'handL' | 'handR'; depth: number }[] = [];
    for (const side of ['handL', 'handR'] as const) {
      const k = SEG_INDEX.get(side)!;
      let deep = 0;
      for (let i = 0; i < b.n; i++) {
        if (b.s[i] !== k) continue;
        const q = polar(i);
        if (!q) continue;
        // the trunk's skin there: the least of this cell and the ones beside it that have skin (no false alarm at an edge)
        let r = Infinity;
        for (const [ds, da] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const s = q[0] + ds;
          if (s < 0 || s >= NS) continue;
          const v = reach[s * NA + ((q[1] + da + NA) % NA)];
          if (v > 0) r = Math.min(r, v);
        }
        if (r < Infinity) deep = Math.max(deep, r - q[2]);
      }
      if (deep > 0.015) out.push({ side, depth: deep });
    }
    return out;
  }

  function nearestProp(x: number, z: number): string {
    let best = '';
    let bd = 1.2;
    for (const p of d.props()) {
      const dd = Math.hypot(p.x - x, p.z - z);
      if (dd < bd) {
        bd = dd;
        best = `${p.id} (${p.kind})`;
      }
    }
    return best || 'wall or floor';
  }

  interface Body {
    id: string;
    role: string;
    ch: Character;
    posture: string;
    act?: string;
    moving: boolean;
    airborne: boolean;
    x: number;
    z: number;
    props: string[];
    legsUp: boolean;
    seatKind?: string;
    pushedBy?: string;
    /** sampled skin: xyz per vertex, and its segment */
    p: Float32Array;
    s: Int8Array;
    n: number;
  }

  function skin(ch: Character, stride: number): { p: Float32Array; s: Int8Array; n: number } {
    ch.root.updateMatrixWorld(true);
    const meshes: THREE.SkinnedMesh[] = [];
    ch.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && worldVisible(m)) meshes.push(m);
    });
    let total = 0;
    for (const m of meshes) total += Math.ceil(m.geometry.getAttribute('position').count / stride);
    const p = new Float32Array(total * 3);
    const s = new Int8Array(total);
    let n = 0;
    for (const m of meshes) {
      const segs = vertexSegments(m);
      const own = drawnVertices(m);
      const count = m.geometry.getAttribute('position').count;
      for (let i = 0; i < count; i += stride) {
        if (!own[i]) continue;
        m.getVertexPosition(i, tmp);
        tmp.applyMatrix4(m.matrixWorld);
        p[n * 3] = tmp.x;
        p[n * 3 + 1] = tmp.y;
        p[n * 3 + 2] = tmp.z;
        s[n] = segs[i];
        n++;
      }
    }
    return { p, s, n };
  }

  function bodies(rg: AuditRegion, stride: number): Body[] {
    const out: Body[] = [];
    const y0 = rg.y ?? 0;
    const pl = d.player();
    const inRegion = (x: number, z: number, y: number) => Math.hypot(x - rg.x, z - rg.z) <= rg.r && Math.abs(y - y0) < 2.5;
    if (pl.visible && inRegion(pl.x, pl.z, pl.y)) {
      const sk = skin(pl.ch, stride);
      out.push({ id: 'player', role: 'player', ch: pl.ch, posture: pl.ch.posture, act: (pl.ch as { act?: string }).act, moving: pl.moving, airborne: pl.airborne, x: pl.x, z: pl.z, props: [], legsUp: false, seatKind: pl.ch.seatKind, ...sk });
    }
    for (const st of d.npcs()) {
      if (!st.v.visible || !inRegion(st.pos.x, st.pos.y, st.ch.root.position.y)) continue;
      const a = st.v.ambient;
      const sk = skin(st.ch, stride);
      if (!sk.n) continue;
      out.push({ id: st.v.id, role: st.v.role, ch: st.ch, posture: st.ch.posture, act: a?.act, moving: !!st.path, airborne: false, x: st.pos.x, z: st.pos.y, props: a?.props ?? [], legsUp: !!a?.legsUp, seatKind: st.ch.seatKind, pushedBy: a?.pushedBy, ...sk });
    }
    return out;
  }

  function run(rg: AuditRegion): AuditReport {
    const t0 = performance.now();
    const stride = Math.max(1, rg.stride ?? 2);
    const g = staticGrid(rg);
    const dyn = dynamicMeshes(rg);
    const bs = bodies(rg, stride);
    const findings: Finding[] = [];
    const subjects: SubjectReport[] = [];
    let vertices = 0;
    // everyone's hands (for legs held up, a hand under an arm)
    const hands = bs.map((b) => {
      const pts: number[] = [];
      for (let i = 0; i < b.n; i++) if (b.s[i] === SEG_INDEX.get('handL') || b.s[i] === SEG_INDEX.get('handR')) pts.push(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]);
      return { id: b.id, pts };
    });
    for (const b of bs) {
      vertices += b.n;
      // lowest skin per segment, and the underside (within 3 cm of it) for the hand test
      const low = SEGS.map(() => ({ y: Infinity, i: -1 }));
      for (let i = 0; i < b.n; i++) {
        const k = b.s[i];
        if (k >= 0 && b.p[i * 3 + 1] < low[k].y) low[k] = { y: b.p[i * 3 + 1], i };
      }
      const seg: Record<string, SegmentReport> = {};
      const own = (m: DynMesh) => m.owner === b.id && !/prop:wheelchair|prop:walker|prop:carrier/.test(m.name);
      const report = (name: Seg): SegmentReport | null => {
        const k = SEG_INDEX.get(name)!;
        const l = low[k];
        if (l.i < 0) return null;
        let x = b.p[l.i * 3];
        let y = b.p[l.i * 3 + 1];
        let z = b.p[l.i * 3 + 2];
        // the whole underside (within 2 cm of the lowest point): a sole on a footplate with its toe past the edge rests
        let s: { y: number; on: string } | null = null;
        let gap: number | null = null;
        let tried = 0;
        for (let i = 0; i < b.n && tried < 14; i++) {
          if (b.s[i] !== k || b.p[i * 3 + 1] > l.y + 0.02 || (i !== l.i && (i * 7919) % 5 !== 0)) continue;
          tried++;
          const vx = b.p[i * 3];
          const vy = b.p[i * 3 + 1];
          const vz = b.p[i * 3 + 2];
          const si = surfaceBelow(g, dyn, vx, vy + 0.1, vz, own);
          const gi = si ? vy - si.y : null;
          if (gi !== null && (gap === null || Math.max(0, gi) < Math.max(0, gap))) {
            s = si;
            gap = gi;
            x = vx;
            y = vy;
            z = vz;
          }
        }
        let on = s ? describe(s.on, s.y, x, z) : 'nothing';
        // what it rests on itself, before a hand or the other leg is counted
        const floorGap = gap;
        // held: another person's hand within 5 cm of the underside
        if (gap === null || gap > 0.03) {
          let bestD = Infinity;
          let who = '';
          for (const h of hands) {
            if (h.id === b.id) continue;
            for (let j = 0; j < h.pts.length; j += 3) {
              const dd = Math.hypot(h.pts[j] - x, h.pts[j + 1] - y, h.pts[j + 2] - z);
              if (dd < bestD) {
                bestD = dd;
                who = h.id;
              }
            }
          }
          if (bestD <= 0.05) {
            on = `hand of ${who} (${(bestD * 100).toFixed(1)} cm)`;
            gap = 0;
          }
        }
        // a head or back against a raised backrest or a pillow is borne from behind, not from below:
        // any surface within 3 cm of its skin, in any direction
        if ((gap === null || gap > 0.03) && (name === 'head' || name === 'back')) {
          const near = touching(b, k, dyn, own);
          if (near) {
            on = `against ${near.on} (${(near.d * 100).toFixed(1)} cm)`;
            gap = 0;
          }
        }
        // seated with the legs crossed: this leg rests across the other one
        const other = /L$/.test(name) ? 'R' : 'L';
        if ((gap === null || gap > 0.03) && b.posture === 'sit' && /^(foot|calf)/.test(name)) {
          const mine = new Set([SEG_INDEX.get(`calf${name.slice(-1)}` as Seg)!, SEG_INDEX.get(`foot${name.slice(-1)}` as Seg)!]);
          const theirs = new Set([SEG_INDEX.get(`thigh${other}` as Seg)!, SEG_INDEX.get(`calf${other}` as Seg)!]);
          let near = Infinity;
          for (let i = 0; i < b.n && near > 0.035; i += 2) {
            if (!mine.has(b.s[i])) continue;
            for (let j = 0; j < b.n; j += 3) {
              if (!theirs.has(b.s[j])) continue;
              near = Math.min(near, Math.hypot(b.p[i * 3] - b.p[j * 3], b.p[i * 3 + 1] - b.p[j * 3 + 1], b.p[i * 3 + 2] - b.p[j * 3 + 2]));
              if (near <= 0.035) break;
            }
          }
          if (near <= 0.035) {
            on = 'the other leg (legs crossed)';
            gap = 0;
          }
        }
        return { low: [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], gap: gap === null ? null : +gap.toFixed(3), on, floorGap: floorGap === null ? null : +floorGap.toFixed(3) };
      };
      for (const name of SEGS) {
        if (name.startsWith('arm') || name.startsWith('hand')) continue;
        const r = report(name);
        if (r) seg[name] = r;
      }
      // seated: the hip joint over what is under it (skin can't say: a coat's skirt hangs past the seat)
      if (b.posture === 'sit') {
        let pel: THREE.Object3D | undefined;
        b.ch.root.traverse((o) => {
          if (!pel && (o as THREE.Bone).isBone && /_Pelvis$/.test(o.name)) pel = o;
        });
        if (pel) {
          const pp = pel.getWorldPosition(new THREE.Vector3());
          const s = surfaceBelow(g, dyn, pp.x, pp.y, pp.z, own);
          seg.seat = { low: [+pp.x.toFixed(3), +pp.y.toFixed(3), +pp.z.toFixed(3)], gap: s ? +(pp.y - s.y).toFixed(3) : null, on: s ? describe(s.on, s.y, pp.x, pp.z) : 'nothing' };
        }
      }
      rules(b, seg, findings);
      // clipping into static geometry
      const clip: SubjectReport['clip'] = [];
      if (!rg.noClip) {
        const worst = new Map<number, { depth: number; at: V3; soft: boolean }>();
        const floorY = rg.y ?? 0;
        for (let i = 0; i < b.n; i++) {
          const x = b.p[i * 3];
          const y = b.p[i * 3 + 1];
          const z = b.p[i * 3 + 2];
          const k = b.s[i];
          const dp = depthAt(g, x, y, z, floorY);
          // what a body rests on gives a little: hips, thighs, back, head or legs up to 5 cm into a seat
          // cushion or a mattress (a level top over 15 cm up) reads as the padding giving way
          const soft = dp.soft && LOAD.has(k);
          if (dp.depth < (soft ? 0.05 : 0.02)) continue;
          const w = worst.get(k);
          if (!w || dp.depth > w.depth) worst.set(k, { depth: dp.depth, at: [x, y, z], soft });
        }
        for (const [k, w] of worst) {
          const near = nearestProp(w.at[0], w.at[2]);
          clip.push({ seg: k >= 0 ? SEGS[k] : 'other', depth: +w.depth.toFixed(3), at: w.at.map((v) => +v.toFixed(3)) as V3, near });
          findings.push({ who: b.id, kind: 'clipping', what: k >= 0 ? SEGS[k] : 'skin', dist: +w.depth.toFixed(3), detail: `${(w.depth * 100).toFixed(1)} cm ${w.soft ? 'sunk into the padding of' : 'into static geometry near'} ${near} at ${w.at.map((v) => v.toFixed(2)).join(', ')}` });
        }
      }
      // pushing a wheelchair: hands on its handles
      if (b.act === 'push') {
        const rider = bs.find((o) => o.pushedBy === b.id);
        const chairOwner = rider ? rider.id : b.id;
        const chair = dyn.filter((m) => m.owner === chairOwner && /prop:wheelchair/.test(m.name));
        if (chair.length) {
          for (const side of ['handL', 'handR'] as const) {
            let best = Infinity;
            for (let i = 0; i < b.n; i++) {
              if (b.s[i] !== SEG_INDEX.get(side)) continue;
              for (const m of chair) {
                const t = (m.tris ??= meshTris(m.mesh));
                for (let j = 0; j < t.length; j += 3) best = Math.min(best, Math.hypot(t[j] - b.p[i * 3], t[j + 1] - b.p[i * 3 + 1], t[j + 2] - b.p[i * 3 + 2]));
              }
            }
            if (best > 0.06) findings.push({ who: b.id, kind: 'hands-off', what: side, dist: +best.toFixed(3), detail: `${side === 'handL' ? 'left' : 'right'} hand ${(best * 100).toFixed(0)} cm from the wheelchair it pushes${rider ? ` (${rider.id} in it)` : ''}` });
          }
        }
      }
      // a rollator (accessories.ts walker), up and about: both palms on its grips (within 4 cm of the grip,
      // 0.019 m round its axis), and walking, its front wheels 0.5–0.8 m ahead of the hips
      const rollator = b.props.includes('walker') && b.posture !== 'sit' ? b.ch.root.getObjectByName('prop:walker') : undefined;
      if (rollator) {
        rollator.updateWorldMatrix(true, false);
        const seg = new THREE.Line3();
        const q = new THREE.Vector3();
        for (const side of ['L', 'R'] as const) {
          const sx = side === 'L' ? 0.27 : -0.27;
          seg.set(rollator.localToWorld(new THREE.Vector3(sx, 0.875, -0.1)), rollator.localToWorld(new THREE.Vector3(sx, 0.875, 0.06)));
          let best = Infinity;
          for (let i = 0; i < b.n; i++) {
            if (b.s[i] !== SEG_INDEX.get(side === 'L' ? 'handL' : 'handR')) continue;
            tmp.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]);
            best = Math.min(best, seg.closestPointToPoint(tmp, true, q).distanceTo(tmp) - 0.019);
          }
          if (best > 0.04) findings.push({ who: b.id, kind: 'hands-off', what: `rollator grip ${side}`, dist: +best.toFixed(3), detail: `${side === 'L' ? 'left' : 'right'} hand ${(best * 100).toFixed(0)} cm off the rollator's grip (${b.moving ? 'walking' : 'standing'})` });
        }
        let pel: THREE.Object3D | undefined;
        b.ch.root.traverse((o) => {
          if (!pel && (o as THREE.Bone).isBone && /_Pelvis$/.test(o.name)) pel = o;
        });
        if (pel && b.moving) {
          const pp = pel.getWorldPosition(new THREE.Vector3());
          const axle = rollator.localToWorld(new THREE.Vector3(0, 0.05, 0.22));
          const yaw = b.ch.root.rotation.y;
          const ahead = (axle.x - pp.x) * Math.sin(yaw) + (axle.z - pp.z) * Math.cos(yaw);
          if (ahead < 0.5 || ahead > 0.8) findings.push({ who: b.id, kind: 'hands-off', what: 'rollator distance', dist: +Math.abs(ahead - 0.65).toFixed(3), detail: `the rollator's front wheels ${(ahead * 100).toFixed(0)} cm ahead of the hips (0.5–0.8 m while walking)` });
        }
      }
      // reading the open broadsheet: no hair or face inside it
      const open = b.act === 'read' ? b.ch.root.getObjectByName('prop:newspaper')?.getObjectByName('open') : undefined;
      if (open && worldVisible(open)) {
        const pb = new THREE.Box3().setFromObject(open).expandByScalar(-0.005);
        let inside = 0;
        for (let i = 0; i < b.n; i++) if (b.s[i] === SEG_INDEX.get('head') && pb.containsPoint(tmp.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]))) inside++;
        if (inside) findings.push({ who: b.id, kind: 'clipping', what: 'head or hair', dist: inside / 100, detail: `${inside} head or hair vertices inside the open newspaper` });
      }
      // texting, a call, filming: a phone in that hand, drawn
      if (b.act && PHONE_ACTS.has(b.act)) {
        const ph = b.ch.root.getObjectByName('prop:phone');
        if (!ph || !worldVisible(ph)) findings.push({ who: b.id, kind: 'no-phone', what: b.act, dist: 0, detail: `${b.act} with no phone in hand${ph ? ' (the phone is hidden)' : ''}` });
        else {
          const at = ph.getWorldPosition(new THREE.Vector3());
          let best = Infinity;
          for (let i = 0; i < b.n; i++) if (b.s[i] === SEG_INDEX.get('handL') || b.s[i] === SEG_INDEX.get('handR')) best = Math.min(best, Math.hypot(b.p[i * 3] - at.x, b.p[i * 3 + 1] - at.y, b.p[i * 3 + 2] - at.z));
          if (best > 0.08) findings.push({ who: b.id, kind: 'no-phone', what: b.act, dist: +best.toFixed(3), detail: `${b.act}: the phone is ${(best * 100).toFixed(0)} cm from either hand` });
        }
      }
      // calling a name off a clipboard, standing still: the board in her left hand (within 4 cm of its
      // edge), up in front of her chest and turned to her eyes (not hanging at her side, not face down)
      if (b.act === 'clipboard' && !b.moving && b.posture === 'stand') {
        const cb = b.ch.root.getObjectByName('prop:clipboard');
        const mesh = cb?.children[0];
        if (!cb || !mesh || !worldVisible(cb)) findings.push({ who: b.id, kind: 'clipboard', what: 'missing', dist: 0, detail: 'calling a name with no clipboard in her hand' });
        else {
          mesh.updateWorldMatrix(true, false);
          const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
          const half = new THREE.Vector3(0.115, 0.155, 0.003);
          const q = new THREE.Vector3();
          let best = Infinity;
          for (let i = 0; i < b.n; i++) {
            if (b.s[i] !== SEG_INDEX.get('handL')) continue;
            q.set(b.p[i * 3], b.p[i * 3 + 1], b.p[i * 3 + 2]).applyMatrix4(inv);
            best = Math.min(best, Math.hypot(Math.max(0, Math.abs(q.x) - half.x), Math.max(0, Math.abs(q.y) - half.y), Math.max(0, Math.abs(q.z) - half.z)));
          }
          if (best > 0.04) findings.push({ who: b.id, kind: 'clipboard', what: 'hand', dist: +best.toFixed(3), detail: `the clipboard ${(best * 100).toFixed(0)} cm from her left hand` });
          const at = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
          const face = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
          let head: THREE.Object3D | undefined;
          let pel: THREE.Object3D | undefined;
          b.ch.root.traverse((o) => {
            if (!(o as THREE.Bone).isBone) return;
            if (!head && /_Head$/.test(o.name)) head = o;
            if (!pel && /_Pelvis$/.test(o.name)) pel = o;
          });
          if (head && pel) {
            const hp = head.getWorldPosition(new THREE.Vector3());
            const pp = pel.getWorldPosition(new THREE.Vector3());
            const yaw = b.ch.root.rotation.y;
            const ahead = (at.x - pp.x) * Math.sin(yaw) + (at.z - pp.z) * Math.cos(yaw);
            const toEyes = hp.clone().sub(at).normalize().dot(face);
            if (ahead < 0.15 || at.y < pp.y + 0.1 || at.y > hp.y - 0.05 || toEyes < 0.5)
              findings.push({ who: b.id, kind: 'clipboard', what: 'not up', dist: +Math.max(0, 0.15 - ahead).toFixed(3), detail: `the clipboard is not up where she can read it: ${(ahead * 100).toFixed(0)} cm in front of her hips, ${((at.y - pp.y) * 100).toFixed(0)} cm above them, its face ${toEyes < 0.5 ? 'away from' : 'toward'} her eyes` });
          }
        }
      }
      // hands on the body (on the belly in bed, arms folded) rest on the clothes, not inside them
      for (const h of handsIntoTrunk(b)) findings.push({ who: b.id, kind: 'clipping', what: h.side, dist: +h.depth.toFixed(3), detail: `${h.side === 'handL' ? 'left' : 'right'} hand ${(h.depth * 100).toFixed(1)} cm inside the trunk (through the clothes)` });
      if (rg.skin) {
        const tone = skinTones(b.ch);
        if (tone) {
          const msg = toneProblem(tone);
          if (msg) findings.push({ who: b.id, kind: 'skin-mismatch', what: 'face vs hands', dist: +msg.dist.toFixed(3), detail: msg.detail });
        }
      }
      subjects.push({ id: b.id, role: b.role, posture: b.posture, act: b.act, anim: (b.ch as { clip?: string }).clip, moving: b.moving, x: +b.x.toFixed(2), z: +b.z.toFixed(2), props: b.props, seg, clip });
    }
    // loose items
    const items: AuditReport['items'] = [];
    const its = d.items();
    const held = new Set(its.held.map((h) => h.id));
    for (const it of its.all) {
      if (held.has(it.id) || !worldVisible(it.root)) continue;
      it.root.updateMatrixWorld(true);
      box.makeEmpty();
      const meshes = new Set<THREE.Object3D>();
      it.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !solidMaterial(m.material, true)) return;
        meshes.add(m);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
      });
      if (box.isEmpty()) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      if (Math.hypot(cx - rg.x, cz - rg.z) > rg.r || Math.abs(box.min.y - (rg.y ?? 0)) > 2.5) continue;
      const s = surfaceBelow(g, dyn, cx, box.min.y + Math.min(0.05, (box.max.y - box.min.y) / 2), cz, (m) => meshes.has(m.mesh));
      const gap = s ? box.min.y - s.y : null;
      const on = s ? describe(s.on, s.y, cx, cz) : 'nothing';
      items.push({ id: it.id, kind: it.kind, label: it.label, at: [+cx.toFixed(3), +box.min.y.toFixed(3), +cz.toFixed(3)], gap: gap === null ? null : +gap.toFixed(3), on });
      if (gap === null || gap > 0.01) findings.push({ who: it.id, kind: 'floating-item', what: it.label, dist: gap ?? Infinity, detail: gap === null ? 'nothing under it' : `${(gap * 100).toFixed(1)} cm above ${on}` });
      else if (gap < -0.01) findings.push({ who: it.id, kind: 'sunk-item', what: it.label, dist: -gap, detail: `${(-gap * 100).toFixed(1)} cm into ${on}` });
    }
    return { t: performance.now() / 1000, ms: Math.round(performance.now() - t0), region: rg, subjects, items, findings, stats: { tris: g.set.n, vertices, dynamicMeshes: dyn.length } };
  }

  /** "floor", "chair 0.48 m", or the prop's name */
  function describe(on: string, y: number, x: number, z: number): string {
    if (!on.startsWith('static:')) return on;
    const floorY = [0, 3, 6].find((f) => Math.abs(y - f) < 0.03);
    if (floorY !== undefined) return floorY ? `floor ${floorY / 3 + 1}` : 'floor';
    return `${nearestProp(x, z)} top ${y.toFixed(2)} m`;
  }

  /** what this posture asks of each segment; findings for what breaks it */
  function rules(b: Body, seg: Record<string, SegmentReport>, out: Finding[]) {
    if (b.airborne) return;
    const crouch = b.act === 'crouch' || b.act === 'crouch_talk' || b.act === 'buckle';
    const need = (names: string[], rule: SegmentReport['rule'], label: string, tol = 0.03) => {
      const rs = names.map((n) => seg[n]).filter((r): r is SegmentReport => !!r);
      if (!rs.length) return;
      for (const r of rs) r.rule = rule;
      if (rule === 'info') return;
      // one-of: the best of them must rest (a walking stride, a crossed leg); rest: each of them
      const check = rule === 'one-of' ? [rs.reduce((a, c) => (gapOf(c) < gapOf(a) ? c : a))] : rs;
      for (const r of check) {
        const gp = gapOf(r);
        const nm = rule === 'one-of' ? label : (Object.entries(seg).find(([, v]) => v === r)?.[0] ?? label);
        if (gp > 0.1) out.push({ who: b.id, kind: 'unsupported', what: nm, dist: +gp.toFixed(3), detail: `${nm} ${r.gap === null ? 'over nothing' : `${(gp * 100).toFixed(0)} cm above ${r.on}`} (${b.posture}${b.act ? `, ${b.act}` : ''})` });
        else if (gp > tol) out.push({ who: b.id, kind: 'gap', what: nm, dist: +gp.toFixed(3), detail: `${nm} ${(gp * 100).toFixed(1)} cm above ${r.on} (${b.posture}${b.act ? `, ${b.act}` : ''})` });
        else if (r.gap !== null && r.gap < -0.03) out.push({ who: b.id, kind: 'sunk', what: nm, dist: +(-r.gap).toFixed(3), detail: `${nm} ${(-r.gap * 100).toFixed(1)} cm into ${r.on}` });
      }
    };
    const gapOf = (r: SegmentReport) => (r.gap === null ? Infinity : Math.max(0, r.gap));
    if (b.posture === 'lie') {
      need(['pelvis', 'back', 'head'], 'rest', 'trunk');
      // a leg hinges at the hip: it is borne if its calf or its foot rests, or is in someone's hands
      // (a straight leg held at the ankle spans like a beam; nothing under the calf is needed)
      need(['calfL', 'footL'], 'one-of', 'left leg');
      need(['calfR', 'footR'], 'one-of', 'right leg');
    } else if (b.posture === 'sit') {
      // (also while wheeled along) the hip joint 5–16 cm over the seat under it: the buttocks on it
      const st = seg.seat;
      if (st) {
        st.rule = 'rest';
        const h = st.gap;
        const tag = `(sit${b.act ? `, ${b.act}` : ''})`;
        if (h === null || h > 0.22) out.push({ who: b.id, kind: 'unsupported', what: 'hips over the seat', dist: h ?? Infinity, detail: `hip joint ${h === null ? 'over nothing' : `${(h * 100).toFixed(0)} cm above ${st.on}`}: sitting on air ${tag}` });
        else if (h > 0.16) out.push({ who: b.id, kind: 'gap', what: 'hips over the seat', dist: +(h - 0.1).toFixed(3), detail: `hip joint ${(h * 100).toFixed(0)} cm above ${st.on} (about 10 expected) ${tag}` });
        else if (h < 0.03) out.push({ who: b.id, kind: 'sunk', what: 'hips into the seat', dist: +(0.1 - h).toFixed(3), detail: `hip joint ${(h * 100).toFixed(0)} cm above ${st.on}: the buttocks are in it ${tag}` });
      }
      // sitting on a bed's edge, the legs hang free; everywhere else the soles rest (floor or footrest),
      // one of them maybe on the other leg (legs crossed), but never both off the floor
      if (b.seatKind === 'bed') need(['footL', 'footR'], 'info', 'feet');
      else {
        need(['footL'], 'rest', 'left foot', 0.04);
        need(['footR'], 'rest', 'right foot', 0.04);
        const own = [seg.footL, seg.footR].filter((r): r is SegmentReport => !!r).map((r) => (r.floorGap === null || r.floorGap === undefined ? Infinity : Math.max(0, r.floorGap)));
        const best = Math.min(...own);
        if (own.length && best > 0.1 && !out.some((f) => f.who === b.id && /foot/.test(f.what) && f.kind === 'unsupported')) out.push({ who: b.id, kind: 'unsupported', what: 'both feet', dist: +best.toFixed(3), detail: `both feet off the floor (the nearer ${(best * 100).toFixed(0)} cm up), legs crossed or held out (sit${b.act ? `, ${b.act}` : ''})` });
      }
    } else if (crouch) need(['footL', 'footR', 'calfL', 'calfR'], 'one-of', 'feet or knees');
    else if (b.moving) need(['footL', 'footR'], 'one-of', 'a foot on the ground', 0.05);
    else {
      need(['footL', 'footR'], 'one-of', 'a foot on the ground');
      for (const s of ['footL', 'footR']) if (seg[s] && gapOf(seg[s]) > 0.1) out.push({ who: b.id, kind: 'gap', what: s, dist: +gapOf(seg[s]).toFixed(3), detail: `standing still with the ${s === 'footL' ? 'left' : 'right'} foot ${(gapOf(seg[s]) * 100).toFixed(0)} cm up` });
    }
  }

  /** world positions of the bones a pose is judged by (player or an NPC id) */
  function bones(id: string): Record<string, V3> | null {
    const ch = id === 'player' ? d.player().ch : [...d.npcs()].find((s) => s.v.id === id)?.ch;
    if (!ch) return null;
    ch.root.updateMatrixWorld(true);
    const out: Record<string, V3> = {};
    const want = /^Bip01_(Pelvis|Spine\d?|Neck|Head|[LR]_(Thigh|Calf|Foot|Toe0|UpperArm|Forearm|Hand))$/;
    ch.root.traverse((o) => {
      if (want.test(o.name) && !out[o.name.slice(6)]) out[o.name.slice(6)] = o.getWorldPosition(tmp).toArray().map((v) => +v.toFixed(3)) as V3;
    });
    return out;
  }

  /** where an NPC's prop is ('prop:wheelchair' …): its origin and the way it faces (rad, 0 = +z) */
  function prop(id: string, kind: string): { at: V3; yaw: number } | null {
    const st = [...d.npcs()].find((s) => s.v.id === id);
    const o = st?.ch.root.getObjectByName(`prop:${kind}`);
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    return { at: o.getWorldPosition(tmp).toArray().map((v) => +v.toFixed(3)) as V3, yaw: +Math.atan2(e[8], e[10]).toFixed(4) };
  }

  return { run, bones, prop };
}

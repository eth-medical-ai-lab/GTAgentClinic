/**
 * Hospital bedding.
 *
 * Every bed and stretcher (props.ts) is made up: a fitted sheet that rolls over the mattress edges
 * and is tucked under, a soft pillow with a head dent, and a neatly folded blanket at the foot.
 *
 * A patient lying in one (avatars.ts) gets a blanket draped over the lying body's actual shape:
 * - the skinned body is sampled on the CPU into a heightfield over the mattress (the toes tent it,
 *   knees, hips and hands raise it), together with the mattress and the folded blanket under it
 * - the cloth is laid over that: slope-limited like cloth hanging from a high point, smoothed (its
 *   stiffness), sagging between the supports
 * - folds along the fall line where it hangs (radiating from the toes and knees), lengthwise where it
 *   spans the gap between the legs, fine noise everywhere; vertical folds and a wavy hem where it
 *   falls over the mattress sides and the foot end, to just above the deck, inside the side rails,
 *   their posts and the footboard (BedSpec below is what props.ts builds)
 * - a white top sheet turned down over its top edge across the chest, the edges with some thickness
 * - with the backrest up (bedRig.ts), all of that on the bed as if it were flat (the body unbent onto
 *   it), then bent with the bed like the sheet under it; turned down lower, to the waist, sitting up
 * It is rebuilt only when the pose, the bed, its backrest or the lying height changes (a few ms; ~3.8k triangles).
 *
 * Materials are procedural (no texture files): a pale cellular-weave hospital blanket and white cotton.
 */
import * as THREE from 'three';
import type { PropDef } from '../../../shared/layout';
import { own, trackGeo, trackTexture } from './materials';

// ───────────────────────────── the beds ─────────────────────────────

export type BedKind = 'bed' | 'stretcher';

/** a bed or stretcher in its own frame: origin on the floor at its centre, head toward −z, foot toward +z */
export interface BedSpec {
  kind: BedKind;
  /** frame: width and length */
  W: number;
  L: number;
  /** mattress: half width, foot end (+z; the head end is −zFoot), top, bottom, edge radius */
  hw: number;
  zFoot: number;
  top: number;
  bottom: number;
  r: number;
  /** clear half width inside the side rails and their posts */
  railIn: number;
  /** clear z inside the footboard (bed) or the push handle (stretcher) */
  footIn: number;
  /** deck top: a hanging hem stays above it */
  deck: number;
  /** pillow: centre z, width, depth, puff */
  pillow: { z: number; w: number; d: number; h: number };
  /** the folded blanket at the foot: centre z, width, depth, folded layers, layer thickness */
  stack: { z: number; w: number; d: number; n: number; t: number };
  /** the backrest's crease across the mattress top, under the patient's hips (bedRig.ts): z, and the radius it rounds with */
  hinge: { z: number; r: number };
}

/** fitted sheet over the mattress */
const SHEET = 0.004;

/** the backrest goes up to 80° (bedRig.ts) */
export const HEAD_MAX = (80 * Math.PI) / 180;

/**
 * Rows across the mattress round the backrest's crease (z, 2 cm apart, as far as the crease's fillet
 * reaches at the most the backrest goes up). The mattress, its deck and the fitted sheet all have them,
 * so their bent surfaces stay parallel there (bedRig.ts).
 */
export function creaseRows(s: BedSpec): number[] {
  const half = s.hinge.r * Math.tan(HEAD_MAX / 2) + 0.008;
  const n = Math.ceil(half / 0.02);
  return Array.from({ length: 2 * n + 1 }, (_, i) => s.hinge.z + (i - n) * 0.02);
}

/** z rows (ascending) with the crease rows in place of any that fall among them */
function withCrease(zs: number[], s: BedSpec): number[] {
  const c = creaseRows(s);
  const lo = c[0] - 0.01;
  const hi = c[c.length - 1] + 0.01;
  return [...zs.filter((z) => z < lo || z > hi), ...c].sort((a, b) => a - b);
}

export function bedSpec(kind: BedKind): BedSpec {
  const W = kind === 'stretcher' ? 0.8 : 0.96;
  const L = 2.05;
  const zFoot = L / 2 - 0.04;
  return {
    kind,
    W,
    L,
    hw: (W - 0.04) / 2,
    zFoot,
    top: 0.63,
    bottom: 0.49,
    r: 0.035,
    // rails 3 cm thick centred at W/2 + 0.025 (inner faces W/2 + 0.01), posts at the same x
    railIn: W / 2 + 0.006,
    // the footboard's inner face is at L/2 − 0.01; a stretcher's push handle stands clear of that too
    footIn: L / 2 - 0.014,
    deck: 0.49,
    pillow: { z: -zFoot + 0.23, w: W * 0.6, d: 0.4, h: 0.085 },
    stack: { z: zFoot - 0.19, w: W * 0.64, d: 0.3, n: 3, t: 0.021 },
    // a patient's hip joints lie 0–8 cm toward the foot from the middle (avatars.ts lays them on it)
    hinge: { z: 0.05, r: 0.05 },
  };
}

const beds = new Map<string, { kind: BedKind; x: number; z: number; rot: number }>();
/** each made-up bed's folded blanket (makeUpBed), put away while a patient lies in the bed: it is the one over them */
const stacks = new Map<string, THREE.Object3D[]>();

/** the bed's folded blanket that is drawn (a bed is also built to be measured, never joining a scene: not that one) */
function stackOf(id: string): THREE.Object3D | null {
  const list = stacks.get(id);
  for (let i = (list?.length ?? 0) - 1; i >= 0; i--) {
    let o = list![i];
    while (o.parent) o = o.parent;
    if ((o as THREE.Scene).isScene) return list![i];
  }
  return null;
}

/** props.ts: where each bed and stretcher stands (a lying patient's blanket drapes over the one under them) */
export function registerBed(p: PropDef, kind: BedKind) {
  beds.set(p.id, { kind, x: p.x, z: p.z, rot: p.rot ?? 0 });
}

/** the bed or stretcher standing nearest (x, z), within 1.5 m (itemSystem.ts: a belonging handed back goes on it) */
export function bedNear(x: number, z: number): { x: number; z: number; rot: number; spec: BedSpec } | null {
  let best: { x: number; z: number; rot: number; spec: BedSpec } | null = null;
  let bd = 1.5;
  for (const b of beds.values()) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd) {
      bd = d;
      best = { x: b.x, z: b.z, rot: b.rot, spec: bedSpec(b.kind) };
    }
  }
  return best;
}

interface BedFit {
  spec: BedSpec;
  key: string;
  /** the bed's centre in the patient's (root) frame */
  dx: number;
  dz: number;
  /** its folded blanket (put away while the patient lies there), if it has one */
  stack: THREE.Object3D | null;
}

/** the bed or stretcher under a lying patient's root (centred under it and turned the same way), or null */
function bedUnder(root: THREE.Object3D): BedFit | null {
  const e = root.matrixWorld.elements;
  const yaw = Math.atan2(e[8], e[10]);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let best: BedFit | null = null;
  let bd = 0.2;
  for (const [id, b] of beds) {
    const wx = b.x - e[12];
    const wz = b.z - e[14];
    if (Math.abs(wx) > 1 || Math.abs(wz) > 1) continue;
    const da = Math.atan2(Math.sin(b.rot - yaw), Math.cos(b.rot - yaw));
    if (Math.abs(da) > 0.3) continue;
    const dx = wx * c - wz * s;
    const dz = wx * s + wz * c;
    const d = Math.hypot(dx, dz);
    if (d < bd) {
      bd = d;
      const stack = stackOf(id);
      const spec = bedSpec(b.kind);
      // (no folded blanket at the foot to drape over: it is the blanket)
      best = { spec: stack ? { ...spec, stack: { ...spec.stack, n: 0 } } : spec, key: `${id}|${b.kind}`, dx, dz, stack };
    }
  }
  return best;
}

/** no known bed under the patient (a CT or X-ray table): a stretcher-sized drape with room around it */
function looseSpec(): BedSpec {
  const s = bedSpec('stretcher');
  return { ...s, railIn: s.hw + 0.08, footIn: s.zFoot + 0.08, deck: s.top - 0.15, stack: { ...s.stack, n: 0 } };
}

// ───────────────────────────── noise ─────────────────────────────

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** smoothstep from a to b (a > b runs it backwards) */
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smooth value noise in −1..1; an integer `period` makes it tile */
function vnoise(x: number, y: number, s: number, period = 0): number {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  if (period) {
    x0 = ((x0 % period) + period) % period;
    y0 = ((y0 % period) + period) % period;
    x1 = (x0 + 1) % period;
    y1 = (y0 + 1) % period;
  }
  const a = hash(x0, y0, s);
  const b = hash(x1, y0, s);
  const c = hash(x0, y1, s);
  const d = hash(x1, y1, s);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

// ───────────────────────────── materials ─────────────────────────────

interface Kit {
  /** on the props (merged into the static world): front faces only */
  blanket: THREE.MeshStandardMaterial;
  sheet: THREE.MeshStandardMaterial;
  /** a patient's blanket and its turn-down: both faces (the inside of a drape can show from low down) */
  blanket2: THREE.MeshStandardMaterial;
  sheet2: THREE.MeshStandardMaterial;
}
let kit: Kit | null = null;

/** a tiling canvas texture of `tile` metres (geometry UVs are in metres) */
function canvasTex(N: number, tile: number, srgb: boolean, fill: (d: Uint8ClampedArray) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return trackTexture(t);
}

/** tangent-space normal map from a tiling heightfield (k: slope gain) */
function normalFill(N: number, h: Float32Array, k: number) {
  return (d: Uint8ClampedArray) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
        const hy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
        // canvas rows run down, texture v up
        const nx = -hx * k;
        const ny = hy * k;
        const l = Math.hypot(nx, ny, 1);
        const o = (y * N + x) * 4;
        d[o] = (nx / l) * 127.5 + 127.5;
        d[o + 1] = (ny / l) * 127.5 + 127.5;
        d[o + 2] = (1 / l) * 127.5 + 127.5;
        d[o + 3] = 255;
      }
  };
}

function grayFill(N: number, a: Float32Array) {
  return (d: Uint8ClampedArray) => {
    for (let i = 0; i < N * N; i++) {
      const v = clamp(a[i], 0, 1) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  };
}

/** UV metres per tile: the cellular blanket (8 × 8 cells of 6 mm) and cotton */
const CELL_TILE = 0.048;
const COTTON_TILE = 0.02;

/**
 * Cellular hospital blanket: open square cells between thick, round, twisted yarn bundles that go over
 * and under each other at the crossings. Cotton: a fine plain weave with a soft mottle.
 */
function weaveTextures() {
  const N = 256;
  const ch = new Float32Array(N * N);
  const ca = new Float32Array(N * N);
  const cs = N / 8;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = (x % cs) / cs;
      const v = (y % cs) / cs;
      const du = Math.min(u, 1 - u);
      const dv = Math.min(v, 1 - v);
      const yw = 0.32;
      const warp = du < yw ? Math.sqrt(1 - (du / yw) ** 2) : 0;
      const weft = dv < yw ? Math.sqrt(1 - (dv / yw) ** 2) : 0;
      const over = ((Math.round(x / cs) + Math.round(y / cs)) & 1) * 2 - 1;
      const fuzz = 0.07 * vnoise(x / 4, y / 4, 3, N / 4) + 0.04 * vnoise(x / 2, y / 2, 4, N / 2);
      let h: number;
      if (warp <= 0 && weft <= 0) h = -0.45;
      else {
        const tw = 0.13 * Math.sin((v * 2 + u * 0.5) * Math.PI * 4) * warp;
        const tf = 0.13 * Math.sin((u * 2 + v * 0.5) * Math.PI * 4) * weft;
        h = Math.max(warp * (1 + 0.28 * over * weft) + tw, weft * (1 - 0.28 * over * warp) + tf);
      }
      ch[y * N + x] = h + fuzz;
      ca[y * N + x] = h < 0 ? 0.64 + fuzz * 0.4 : 0.85 + 0.15 * Math.min(1, h) + fuzz * 0.5;
    }
  const th = new Float32Array(N * N);
  const ta = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const plain = 0.5 * (Math.cos((x / 4) * Math.PI * 2) + Math.cos((y / 4) * Math.PI * 2));
      const mottle = vnoise(x / 16, y / 16, 5, N / 16);
      th[y * N + x] = 0.22 * plain + 0.35 * mottle + 0.25 * vnoise(x / 64, y / 64, 6, N / 64);
      ta[y * N + x] = 0.965 + 0.028 * vnoise(x / 16, y / 16, 8, N / 16) + 0.01 * plain;
    }
  return {
    cellColor: canvasTex(N, CELL_TILE, true, grayFill(N, ca)),
    cellNormal: canvasTex(N, CELL_TILE, false, normalFill(N, ch, 1.6)),
    cottonColor: canvasTex(N, COTTON_TILE, true, grayFill(N, ta)),
    cottonNormal: canvasTex(N, COTTON_TILE, false, normalFill(N, th, 1.1)),
  };
}

/** the bedding materials (procedural, made once; they go with the world's other materials) */
export function beddingMaterials(): Kit {
  if (kit) return kit;
  const t = weaveTextures();
  const blanket = (side: THREE.Side) =>
    own(new THREE.MeshStandardMaterial({ color: '#b6cfe0', map: t.cellColor, normalMap: t.cellNormal, normalScale: new THREE.Vector2(0.85, 0.85), roughness: 0.96, metalness: 0, side }));
  const sheet = (side: THREE.Side) =>
    own(new THREE.MeshStandardMaterial({ color: '#e8ebe9', map: t.cottonColor, normalMap: t.cottonNormal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.84, metalness: 0, side }));
  const k: Kit = { blanket: blanket(THREE.FrontSide), sheet: sheet(THREE.FrontSide), blanket2: blanket(THREE.DoubleSide), sheet2: sheet(THREE.DoubleSide) };
  k.blanket.name = k.blanket2.name = 'bedding-blanket';
  k.sheet.name = k.sheet2.name = 'bedding-sheet';
  for (const m of Object.values(k)) m.addEventListener('dispose', () => (kit = null));
  return (kit = k);
}

// ───────────────────────────── grid meshes ─────────────────────────────

/** smooth normals of a rows × cols grid of points: n = tJ × tI (J: the next row, I: the next column) */
function gridNormals(P: Float32Array, rows: number, cols: number): Float32Array {
  const out = new Float32Array(rows * cols * 3);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = ((j < rows - 1 ? j + 1 : j) * cols + i) * 3;
      const b = ((j > 0 ? j - 1 : j) * cols + i) * 3;
      const c = (j * cols + (i < cols - 1 ? i + 1 : i)) * 3;
      const d = (j * cols + (i > 0 ? i - 1 : i)) * 3;
      const jx = P[a] - P[b];
      const jy = P[a + 1] - P[b + 1];
      const jz = P[a + 2] - P[b + 2];
      const ix = P[c] - P[d];
      const iy = P[c + 1] - P[d + 1];
      const iz = P[c + 2] - P[d + 2];
      const nx = jy * iz - jz * iy;
      const ny = jz * ix - jx * iz;
      const nz = jx * iy - jy * ix;
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (j * cols + i) * 3;
      out[o] = nx / l;
      out[o + 1] = ny / l;
      out[o + 2] = nz / l;
    }
  return out;
}

const dist3 = (P: Float32Array, a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);

/** UVs in metres of cloth: u along each row from column ci, v down each column from the first row */
function gridUVs(P: Float32Array, rows: number, cols: number, ci: number): Float32Array {
  const U = new Float32Array(rows * cols * 2);
  for (let j = 0; j < rows; j++) {
    const o = j * cols;
    for (let i = ci + 1; i < cols; i++) U[(o + i) * 2] = U[(o + i - 1) * 2] + dist3(P, o + i - 1, o + i);
    for (let i = ci - 1; i >= 0; i--) U[(o + i) * 2] = U[(o + i + 1) * 2] - dist3(P, o + i + 1, o + i);
  }
  for (let i = 0; i < cols; i++)
    for (let j = 1; j < rows; j++) U[(j * cols + i) * 2 + 1] = U[((j - 1) * cols + i) * 2 + 1] + dist3(P, (j - 1) * cols + i, j * cols + i);
  return U;
}

/** collects grid patches into one indexed geometry, one draw group per material */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[][] = [[], []];

  /** rows j0..j1 of a grid (points, normals, uvs); triangles face along tJ × tI */
  grid(P: Float32Array, Nn: Float32Array, U: Float32Array, cols: number, j0: number, j1: number, mat = 0) {
    const base = this.pos.length / 3;
    for (let j = j0; j <= j1; j++)
      for (let i = 0; i < cols; i++) {
        const o = j * cols + i;
        this.pos.push(P[o * 3], P[o * 3 + 1], P[o * 3 + 2]);
        this.nor.push(Nn[o * 3], Nn[o * 3 + 1], Nn[o * 3 + 2]);
        this.uv.push(U[o * 2], U[o * 2 + 1]);
      }
    const ix = this.idx[mat];
    for (let j = 0; j < j1 - j0; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = base + j * cols + i;
        const b = a + cols;
        ix.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }

  /** a whole grid with its own normals and UVs */
  patch(P: Float32Array, rows: number, cols: number, mat = 0, ci = 0) {
    this.grid(P, gridNormals(P, rows, cols), gridUVs(P, rows, cols, ci), cols, 0, rows - 1, mat);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const [a, b] = this.idx;
    g.setIndex(a.concat(b));
    if (b.length) {
      g.addGroup(0, a.length, 0);
      g.addGroup(a.length, b.length, 1);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** smooth 3 × 3 passes that never take the cloth below its supports */
function relax(C: Float32Array, S: Float32Array, nx: number, nz: number, iters: number) {
  const T = new Float32Array(C.length);
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < nz; j++) {
      const r0 = (j > 0 ? j - 1 : j) * nx;
      const r1 = j * nx;
      const r2 = (j < nz - 1 ? j + 1 : j) * nx;
      for (let i = 0; i < nx; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < nx - 1 ? i + 1 : i;
        const v = (C[r0 + i0] + 2 * C[r0 + i] + C[r0 + i1] + 2 * (C[r1 + i0] + C[r1 + i1]) + 4 * C[r1 + i] + C[r2 + i0] + 2 * C[r2 + i] + C[r2 + i1]) / 16;
        T[r1 + i] = v > S[r1 + i] ? v : S[r1 + i];
      }
    }
    C.set(T);
  }
}

/** cloth hanging from high points drops no faster than k per cell (two chamfer sweeps each way) */
function cone(C: Float32Array, nx: number, nz: number, k: number) {
  const k2 = k * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        let v = C[q];
        if (i > 0 && C[q - 1] - k > v) v = C[q - 1] - k;
        if (j > 0) {
          if (C[q - nx] - k > v) v = C[q - nx] - k;
          if (i > 0 && C[q - nx - 1] - k2 > v) v = C[q - nx - 1] - k2;
          if (i < nx - 1 && C[q - nx + 1] - k2 > v) v = C[q - nx + 1] - k2;
        }
        C[q] = v;
      }
    for (let j = nz - 1; j >= 0; j--)
      for (let i = nx - 1; i >= 0; i--) {
        const q = j * nx + i;
        let v = C[q];
        if (i < nx - 1 && C[q + 1] - k > v) v = C[q + 1] - k;
        if (j < nz - 1) {
          if (C[q + nx] - k > v) v = C[q + nx] - k;
          if (i < nx - 1 && C[q + nx + 1] - k2 > v) v = C[q + nx + 1] - k2;
          if (i > 0 && C[q + nx - 1] - k2 > v) v = C[q + nx - 1] - k2;
        }
        C[q] = v;
      }
  }
}

// ───────────────────────────── the patient's blanket ─────────────────────────────

/**
 * A bed whose backrest is up (bedRig.ts Bend), in its own frame: the flat bed's points onto the bent
 * one and back. The blanket is draped on the flat bed and bent with it, like the sheet under it.
 */
export interface BedBendLike {
  /** the backrest's angle (rad) */
  readonly head: number;
  /** flat (y, z) → bent: out[0] y, out[1] z, out[2] the turn about +x there (rad, for normals) */
  map(y: number, z: number, out: number[]): number[];
  /** bent (y, z) → the flat point it comes from (the nearest, in the crease's fold): out[0] y, out[1] z */
  unmap(y: number, z: number, out: number[]): number[];
}

export interface DrapeInput {
  /** the lying body's skin, in the bed's frame (x across, y up, z toward the foot): xyz triplets; with a `bend`, as on the flat bed (Bend.unmap) */
  pts: ArrayLike<number>;
  /** and its triangles (indices into pts), when it is a mesh */
  tris?: ArrayLike<number>;
  /** bed-frame z of the pelvis and of the base of the neck (the top sheet turns down across the chest between them) */
  pelvisZ: number;
  neckZ: number;
  spec: BedSpec;
  /** the lying surface's offset from the spec's (0.64 m): the mattress top is spec.top + dy */
  dy: number;
  seed: number;
  /** the backrest is up: the blanket is bent onto the bed as it is, and turned down lower (sitting up, to the waist) */
  bend?: BedBendLike;
}

/** bend a geometry's positions and normals (bed frame) onto a bent bed */
export function bendGeometry(g: THREE.BufferGeometry, bend: BedBendLike) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const o = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    bend.map(pos.getY(i), pos.getZ(i), o);
    pos.setY(i, o[0]);
    pos.setZ(i, o[1]);
    if (nor && o[2]) {
      const c = Math.cos(o[2]);
      const s = Math.sin(o[2]);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      nor.setY(i, ny * c - nz * s);
      nor.setZ(i, ny * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  // (the box too: a copy of the flat shape carries the flat box, and raycasts and the visual audit go by it)
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

/** above the mattress top: the fitted sheet and its wrinkles, plus half the blanket's thickness */
const ON_MATTRESS = SHEET + 0.0125;
/** the turn-down's lift off the blanket and the blanket's thickness at its hem */
const TURN = 0.0045;
const HEM = 0.004;

/**
 * The blanket's geometry in the bed frame: group 0 the cellular blanket, group 1 the white turn-down.
 * Pure (no DOM), so tests can drape synthetic bodies.
 */
export function drapeBlanket(inp: DrapeInput): THREE.BufferGeometry {
  const s = inp.spec;
  const seed = inp.seed;
  const top = s.top + inp.dy;
  const deck = s.deck + inp.dy;
  const { hw, r } = s;
  const zF = s.zFoot;
  // the mattress's flat top: |x| ≤ xIn, z ≤ zIn
  const xIn = hw - r;
  const zIn = zF - r;
  // turned down across the chest; sitting up (the backrest past 30°), at the waist, under the hands
  // resting on the belly (avatars.ts)
  const up = inp.bend ? smooth(0.17, 0.52, inp.bend.head) : 0;
  const zTop = Math.min(zIn - 0.35, inp.pelvisZ + (0.5 - 0.38 * up) * (inp.neckZ - inp.pelvisZ));
  const pts = inp.pts;

  // ── the support: mattress under the fitted sheet, the folded blanket at the foot, the body ──
  const H = 0.015;
  let bodyZ = -9; // the soles (a tall patient's feet reach the foot end)
  for (let k = 0; k < pts.length; k += 3) if (Math.abs(pts[k]) < hw && pts[k + 2] > bodyZ && pts[k + 1] > top) bodyZ = pts[k + 2];
  const gz0 = zTop - 0.045;
  const nx = Math.round((2 * hw) / H) + 1;
  const nz = Math.round((Math.max(zF, bodyZ) + 0.03 - gz0) / H) + 1;
  const N = nx * nz;
  const X = (i: number) => -hw + i * H;
  const Z = (j: number) => gz0 + j * H;
  const S = new Float32Array(N);
  const R = r + ON_MATTRESS;
  for (let j = 0; j < nz; j++) {
    const ez = Math.max(0, Z(j) - zIn);
    for (let i = 0; i < nx; i++) {
      const ex = Math.max(0, Math.abs(X(i)) - xIn);
      const e2 = ex * ex + ez * ez;
      S[j * nx + i] = e2 < R * R ? top - r + Math.sqrt(R * R - e2) : top - r - 0.3;
    }
  }
  const st = s.stack;
  if (st.n > 0) {
    const sTop = top + SHEET + 0.002 + st.n * st.t + 0.007;
    const rho = st.t * 0.9;
    const w = st.w / 2 + 0.012 - rho;
    const d = st.d / 2 + 0.012 - rho;
    for (let j = 0; j < nz; j++) {
      const ez = Math.max(0, Math.abs(Z(j) - st.z) - d);
      if (ez >= rho) continue;
      for (let i = 0; i < nx; i++) {
        const ex = Math.max(0, Math.abs(X(i)) - w);
        const e2 = ex * ex + ez * ez;
        const q = j * nx + i;
        if (e2 < rho * rho) S[q] = Math.max(S[q], sTop - rho + Math.sqrt(rho * rho - e2));
      }
    }
  }
  const pz = inp.pelvisZ;
  const B0 = new Float32Array(N).fill(-9);
  const put = (x: number, y: number, z: number) => {
    const i = Math.round((x + hw) / H);
    const j = Math.round((z - gz0) / H);
    if (i < 0 || i >= nx || j < 0 || j >= nz) return;
    // clearance over the skin; more over the chest and belly, which rise and fall with breathing
    const v = y + 0.014 + 0.012 * smooth(pz + 0.02, pz - 0.14, z);
    if (v > B0[j * nx + i]) B0[j * nx + i] = v;
  };
  for (let k = 0; k < pts.length; k += 3) put(pts[k], pts[k + 1], pts[k + 2]);
  // the skin's triangles over the cells they cover (a skirt spans the legs in a few big ones)
  const tr = inp.tris;
  if (tr)
    for (let t = 0; t + 2 < tr.length; t += 3) {
      const a = tr[t] * 3;
      const b = tr[t + 1] * 3;
      const c = tr[t + 2] * 3;
      const ax = pts[a];
      const ay = pts[a + 1];
      const az = pts[a + 2];
      const bx = pts[b];
      const by = pts[b + 1];
      const bz = pts[b + 2];
      const cx = pts[c];
      const cy = pts[c + 1];
      const cz = pts[c + 2];
      const ylo = Math.min(ay, by, cy);
      const yhi = Math.max(ay, by, cy);
      if (Math.max(az, bz, cz) < gz0 || yhi < top) continue;
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue; // edge-on from above: its corners are in already
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) + hw) / H));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) + hw) / H));
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - gz0) / H));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - gz0) / H));
      for (let j = j0; j <= j1; j++) {
        const z = Z(j);
        const lift = 0.014 + 0.012 * smooth(pz + 0.02, pz - 0.14, z);
        for (let i = i0; i <= i1; i++) {
          const x = X(i);
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const v = clamp(l1 * ay + l2 * by + l3 * cy, ylo, yhi) + lift;
          const q = j * nx + i;
          if (v > B0[q]) B0[q] = v;
        }
      }
    }
  // grown by a cell, so the cloth clears the skin between the samples too
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      let v = -9;
      for (let jj = Math.max(0, j - 1); jj <= Math.min(nz - 1, j + 1); jj++)
        for (let ii = Math.max(0, i - 1); ii <= Math.min(nx - 1, i + 1); ii++) if (B0[jj * nx + ii] > v) v = B0[jj * nx + ii];
      const q = j * nx + i;
      if (v > S[q]) S[q] = v;
    }

  // ── the cloth: tents from the high points, stiffness, sag between the supports ──
  const C = S.slice();
  cone(C, nx, nz, 1.0 * H);
  relax(C, S, nx, nz, 6);
  for (let q = 0; q < N; q++) {
    const f = C[q] - S[q];
    if (f > 0.01) C[q] -= 0.25 * f * smooth(0.01, 0.08, f);
  }
  relax(C, S, nx, nz, 3);

  // ── folds: noise smeared along the fall line (lengthwise where the cloth spans a valley) ──
  const free = new Float32Array(N);
  const grad = new Float32Array(N);
  const dirX = new Float32Array(N);
  const dirZ = new Float32Array(N);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      const i0 = i > 0 ? q - 1 : q;
      const i1 = i < nx - 1 ? q + 1 : q;
      const j0 = j > 0 ? q - nx : q;
      const j1 = j < nz - 1 ? q + nx : q;
      const gx = (C[i1] - C[i0]) / (H * ((i1 - i0) || 1));
      const gz = (C[j1] - C[j0]) / (H * ((j1 - j0) / nx || 1));
      const g2 = gx * gx + gz * gz;
      const g = Math.sqrt(g2);
      grad[q] = g;
      free[q] = smooth(0.003, 0.03, C[q] - S[q]);
      // undirected: blend orientations by their doubled angle (cos 2θ, sin 2θ), toward lengthwise (+z: (−1, 0)) where it's flat
      const w = smooth(0.06, 0.3, g);
      const bx = g2 > 1e-12 ? (w * (gx * gx - gz * gz)) / g2 - (1 - w) : -1;
      const bz = g2 > 1e-12 ? (w * 2 * gx * gz) / g2 : 0;
      const bl = Math.sqrt(bx * bx + bz * bz);
      const c2 = bl > 1e-9 ? bx / bl : -1;
      dirX[q] = Math.sqrt(Math.max(0, (1 + c2) / 2));
      dirZ[q] = Math.sqrt(Math.max(0, (1 - c2) / 2)) * (bz < 0 ? -1 : 1);
    }
  // folds: value noise (fold spacing ~2·FW), smeared along those directions (line integral convolution)
  const FW = 0.042;
  const NZ = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) NZ[j * nx + i] = vnoise(X(i) / FW, Z(j) / FW, seed);
  const noiseAt = (x: number, z: number) => {
    const fx = clamp((x + hw) / H, 0, nx - 1.001);
    const fz = clamp((z - gz0) / H, 0, nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const q = j * nx + i;
    return (NZ[q] * (1 - u) + NZ[q + 1] * u) * (1 - v) + (NZ[q + nx] * (1 - u) + NZ[q + nx + 1] * u) * v;
  };
  const lic = new Float32Array(N);
  let m1 = 0;
  let m2 = 0;
  let cnt = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      if (free[q] <= 0.01) continue;
      let sum = NZ[q];
      let n = 1;
      for (let sg = 1; sg >= -1; sg -= 2) {
        let x = X(i);
        let z = Z(j);
        let lx = dirX[q] * sg;
        let lz = dirZ[q] * sg;
        for (let k = 0; k < 6; k++) {
          x += lx * H * 1.5;
          z += lz * H * 1.5;
          const c = clamp(Math.round((z - gz0) / H), 0, nz - 1) * nx + clamp(Math.round((x + hw) / H), 0, nx - 1);
          const flip = dirX[c] * lx + dirZ[c] * lz < 0 ? -1 : 1;
          lx = dirX[c] * flip;
          lz = dirZ[c] * flip;
          sum += noiseAt(x, z);
          n++;
        }
      }
      lic[q] = sum / n;
      if (free[q] > 0.5) {
        m1 += lic[q];
        m2 += lic[q] * lic[q];
        cnt++;
      }
    }
  const mean = cnt ? m1 / cnt : 0;
  const sd = cnt ? Math.sqrt(Math.max(1e-8, m2 / cnt - mean * mean)) : 1;
  const D = new Float32Array(N);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      const fold = free[q] > 0.01 ? clamp((lic[q] - mean) / sd, -2.2, 2.2) : 0;
      const amp = 0.0105 * free[q] * (0.45 + 0.55 * Math.min(1, grad[q] / 0.5));
      const fine = 0.0012 * vnoise(X(i) / 0.014, Z(j) / 0.014, seed + 7);
      D[q] = Math.max(S[q], C[q] + amp * fold + fine);
    }
  const sample = (x: number, z: number) => {
    const fx = clamp((x + hw) / H, 0, nx - 1.001);
    const fz = clamp((z - gz0) / H, 0, nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const q = j * nx + i;
    return (D[q] * (1 - u) + D[q + 1] * u) * (1 - v) + (D[q + nx] * (1 - u) + D[q + nx + 1] * u) * v;
  };

  // ── the mesh: the top over the mattress, the overhang falling over the sides, foot end and corners ──
  const Nc = 26;
  const xs = new Float32Array(Nc);
  for (let c = 0; c < Nc; c++) {
    const t = -1 + (2 * c) / (Nc - 1);
    xs[c] = xIn * (0.5 * t + 0.5 * t * t * t);
  }
  const Nr = Math.max(12, Math.round((zIn - zTop) / 0.03) + 1);
  const dzr = (zIn - zTop) / (Nr - 1);
  const zs = new Float32Array(Nr);
  for (let k = 0; k < Nr; k++) zs[k] = zTop + dzr * k;
  const nb = Math.max(3, Math.round(0.17 / dzr)); // rows under the turn-down
  const K = 5; // overhang steps: three round the mattress edge, two down to the hem
  const TR = 0.6;
  const NC = Nc + 2 * K;
  const NR = Nr + K;
  const xHang = Math.min(hw + 0.013, s.railIn - 0.0125);
  const zHang = clamp(Math.max(zF + 0.013, bodyZ + 0.012), zF + 0.008, s.footIn - 0.0125);
  const rs = xHang - xIn;
  const rf = zHang - zIn;
  const rr = (rs + rf) / 2;
  const FOLD = 0.0045;
  /** arc length round the hem (right side from the head, the foot end, the left side back): drape folds run on it */
  const arc = (side: number, x: number, z: number, alpha: number) => {
    if (alpha <= 1e-6) return side > 0 ? z : zIn + Math.PI * rr + 2 * xIn + (zIn - z);
    if (alpha >= Math.PI / 2 - 1e-6) return zIn + (Math.PI / 2) * rr + (xIn - x);
    return side > 0 ? zIn + alpha * rr : zIn + (Math.PI / 2) * rr + 2 * xIn + (Math.PI / 2 - alpha) * rr;
  };
  const hemY = (sa: number) => deck + 0.017 + 0.006 * Math.sin((sa / 0.43) * Math.PI * 2 + 1.3) + 0.004 * vnoise(sa / 0.13, 0.5, seed + 9);
  /** the overhang: round the mattress edge from an anchor on its flat top (t 0..TR), then hanging to the hem (t TR..1) */
  const hang = (out: Float32Array, o: number, ax: number, az: number, side: number, alpha: number, t: number) => {
    const yA = sample(ax, az);
    const rv = Math.max(r + ON_MATTRESS, yA - (top - r));
    const sa = arc(side, ax, az, alpha);
    let reach = 1;
    let y: number;
    let fold = 0;
    if (t <= TR) {
      const ph = (t / TR) * (Math.PI / 2);
      reach = Math.sin(ph);
      y = yA - rv * (1 - Math.cos(ph));
    } else {
      const f = (t - TR) / (1 - TR);
      const y0 = yA - rv;
      y = y0 - f * (y0 - hemY(sa));
      // vertical folds, deeper toward the hem
      fold = FOLD * f * (0.7 * Math.sin((sa / 0.11) * Math.PI * 2 + 0.7) + 0.3 * vnoise(sa / 0.05, 2.5, seed + 11));
    }
    out[o] = ax + side * Math.cos(alpha) * (rs * reach + fold);
    out[o + 1] = y;
    out[o + 2] = az + Math.sin(alpha) * (rf * reach + fold);
  };
  const V = new Float32Array(NC * NR * 3);
  for (let J = 0; J < NR; J++)
    for (let I = 0; I < NC; I++) {
      const o = (J * NC + I) * 3;
      const kS = I < K ? K - I : I >= K + Nc ? I - (K + Nc) + 1 : 0;
      const side = I < K ? -1 : 1;
      const kF = J >= Nr ? J - Nr + 1 : 0;
      if (!kS && !kF) {
        const x = xs[I - K];
        V[o] = x;
        V[o + 1] = sample(x, zs[J]);
        V[o + 2] = zs[J];
      } else if (!kF) hang(V, o, side * xIn, zs[J], side, 0, kS / K);
      else if (!kS) hang(V, o, xs[I - K], zIn, 1, Math.PI / 2, kF / K);
      else hang(V, o, side * xIn, zIn, side, Math.atan2(kF, kS), Math.max(kS, kF) / K);
    }
  // the mesh is coarser than the heightfield: where one of its triangles would pass under a support
  // (a toe, a knuckle), lift that triangle's corners just enough (each corner its share)
  const lift = new Float32Array(NC * NR);
  const tk = [0, 0, 0];
  const tw = [0, 0, 0];
  for (let j = 0, r0 = 0; j < nz; j++) {
    const z = Z(j);
    if (z < zTop || z > zIn) continue;
    while (r0 < Nr - 2 && zs[r0 + 1] <= z) r0++;
    const v = (z - zs[r0]) / (zs[r0 + 1] - zs[r0]);
    for (let i = 0, c0 = 0; i < nx; i++) {
      const x = X(i);
      if (x < -xIn || x > xIn) continue;
      while (c0 < Nc - 2 && xs[c0 + 1] <= x) c0++;
      const u = (x - xs[c0]) / (xs[c0 + 1] - xs[c0]);
      const a = r0 * NC + K + c0; // vertex (row r0, column c0) of V
      if (u + v <= 1) {
        tk[0] = a;
        tw[0] = 1 - u - v;
        tk[1] = a + NC;
        tw[1] = v;
        tk[2] = a + 1;
        tw[2] = u;
      } else {
        tk[0] = a + NC;
        tw[0] = 1 - u;
        tk[1] = a + 1;
        tw[1] = 1 - v;
        tk[2] = a + NC + 1;
        tw[2] = u + v - 1;
      }
      const y = tw[0] * V[tk[0] * 3 + 1] + tw[1] * V[tk[1] * 3 + 1] + tw[2] * V[tk[2] * 3 + 1];
      const need = S[j * nx + i] - y;
      if (need <= 0) continue;
      const w2 = tw[0] * tw[0] + tw[1] * tw[1] + tw[2] * tw[2];
      for (let n = 0; n < 3; n++) lift[tk[n]] = Math.max(lift[tk[n]], (need * tw[n]) / w2);
    }
  }
  for (let k = 0; k < NC * NR; k++) V[k * 3 + 1] += lift[k];
  const Vn = gridNormals(V, NR, NC);
  const Vu = gridUVs(V, NR, NC, K + (Nc >> 1));
  const acc = new Acc();
  // the blanket, from under the turn-down's edge
  acc.grid(V, Vn, Vu, NC, nb - 1, NR - 1, 0);

  // its hem: the cloth's thickness along the sides and the foot end
  const loop: number[] = [];
  for (let J = nb - 1; J < NR; J++) loop.push(J * NC);
  for (let I = 1; I < NC; I++) loop.push((NR - 1) * NC + I);
  for (let J = NR - 2; J >= nb - 1; J--) loop.push(J * NC + NC - 1);
  const hem = new Float32Array(loop.length * 6);
  loop.forEach((v, c) => {
    for (let a = 0; a < 3; a++) {
      hem[c * 3 + a] = V[v * 3 + a];
      hem[(loop.length + c) * 3 + a] = V[v * 3 + a] - Vn[v * 3 + a] * HEM;
    }
  });
  acc.patch(hem, 2, loop.length, 0);

  // the turn-down: the top sheet folded back over the blanket's top edge, lying on it
  const tRows = 4 + nb + 1 + 1;
  const T = new Float32Array(tRows * NC * 3);
  for (let I = 0; I < NC; I++) {
    const v0 = I * 3;
    const v1 = (NC + I) * 3;
    let tx = V[v1] - V[v0];
    let ty = V[v1 + 1] - V[v0 + 1];
    let tz = V[v1 + 2] - V[v0 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const put = (row: number, x: number, y: number, z: number) => {
      const o = (row * NC + I) * 3;
      T[o] = x;
      T[o + 1] = y;
      T[o + 2] = z;
    };
    // under the blanket's edge, round the fold (out toward the head), up onto the blanket
    put(0, V[v1] - Vn[v1] * TURN, V[v1 + 1] - Vn[v1 + 1] * TURN, V[v1 + 2] - Vn[v1 + 2] * TURN);
    [180, 120, 60].forEach((deg, k) => {
      const c = Math.cos((deg * Math.PI) / 180) * TURN;
      const sn = Math.sin((deg * Math.PI) / 180) * TURN * 1.15;
      put(1 + k, V[v0] + Vn[v0] * c - tx * sn, V[v0 + 1] + Vn[v0 + 1] * c - ty * sn, V[v0 + 2] + Vn[v0 + 2] * c - tz * sn);
    });
    for (let J = 0; J <= nb; J++) {
      const v = (J * NC + I) * 3;
      put(4 + J, V[v] + Vn[v] * TURN, V[v + 1] + Vn[v + 1] * TURN, V[v + 2] + Vn[v + 2] * TURN);
    }
    // its edge, down onto the blanket
    const v = (nb * NC + I) * 3;
    put(5 + nb, V[v] + Vn[v] * 0.0008, V[v + 1] + Vn[v + 1] * 0.0008, V[v + 2] + Vn[v + 2] * 0.0008);
  }
  acc.patch(T, tRows, NC, 1, K + (Nc >> 1));
  const out = acc.geometry();
  // draped on the flat bed: onto the bed as it is, like the sheet under it
  if (inp.bend && inp.bend.head > 1e-4) bendGeometry(out, inp.bend);
  return out;
}

// ───────────────────────────── on the bed: fitted sheet, pillow, folded blanket ─────────────────────────────

/** fitted sheet: over the mattress top, round its edges, down the sides, tucked under; slight wrinkles */
function fittedSheet(s: BedSpec): THREE.BufferGeometry {
  const { hw, r, top, bottom } = s;
  const xIn = hw - r;
  const zIn = s.zFoot - r;
  const R = r + SHEET;
  const Nc = 15;
  const TK = [1 / 6, 2 / 6, 0.5, 0.69, 0.88, 1];
  const K = TK.length;
  const NC = Nc + 2 * K;
  // denser toward the edges, where the wrinkles are; and round the backrest's crease, where it bends (bedRig.ts)
  const spread = (t: number) => 0.62 * t + 0.38 * Math.sin((Math.PI / 2) * t);
  const xs = Array.from({ length: Nc }, (_, c) => xIn * spread(-1 + (2 * c) / (Nc - 1)));
  const zs = withCrease(Array.from({ length: 31 }, (_, c) => zIn * spread(-1 + (2 * c) / 30)), s);
  const Nr = zs.length;
  const NR = Nr + 2 * K;
  const crease = (x: number, z: number) => {
    // drawn toward each corner by the elastic: soft creases fanning diagonally into the corners
    let h = 0;
    for (const [cx, cz] of [[xIn, zIn], [-xIn, zIn], [xIn, -zIn], [-xIn, -zIn]]) {
      for (const [off, len, turn] of [[-0.055, 0.26, -0.22], [0.0, 0.34, 0], [0.05, 0.22, 0.25]]) {
        const a = Math.atan2(-Math.sign(cz), -Math.sign(cx)) + turn * Math.sign(cx * cz);
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        const px = x - cx - -uz * off;
        const pz = z - cz - ux * off;
        const along = px * ux + pz * uz;
        if (along < 0 || along > len) continue;
        const across = px * -uz + pz * ux;
        h += 0.004 * Math.exp(-((across / 0.026) ** 2)) * Math.sin((Math.PI * along) / len) ** 0.6;
      }
    }
    return h;
  };
  // broad, shallow undulation where it was smoothed over the mattress, finer rumples, the corner creases
  // (all rising off the sheet's 4 mm, never toward the vinyl: those two would flicker)
  const topY = (x: number, z: number) =>
    top +
    SHEET +
    (0.0035 * (0.5 + 0.5 * vnoise(x / 0.17, z / 0.23, 21)) + 0.0012 * (0.5 + 0.5 * vnoise(x / 0.06, z / 0.08, 22)) + crease(x, z)) *
      smooth(0, 0.05, xIn - Math.abs(x)) *
      smooth(0, 0.05, zIn - Math.abs(z));
  const V = new Float32Array(NC * NR * 3);
  for (let J = 0; J < NR; J++)
    for (let I = 0; I < NC; I++) {
      const o = (J * NC + I) * 3;
      const kS = I < K ? K - I : I >= K + Nc ? I - (K + Nc) + 1 : 0;
      const kE = J < K ? K - J : J >= K + Nr ? J - (K + Nr) + 1 : 0;
      const sx = I < K ? -1 : 1;
      const sz = J < K ? -1 : 1;
      const ax = kS ? sx * xIn : xs[I - K];
      const az = kE ? sz * zIn : zs[J - K];
      if (!kS && !kE) {
        V[o] = ax;
        V[o + 1] = topY(ax, az);
        V[o + 2] = az;
        continue;
      }
      const a = kS / K;
      const b = kE / K;
      const alpha = Math.atan2(b, a);
      const t = TK[Math.max(kS, kE) - 1];
      let reach: number;
      let y: number;
      if (t <= 0.5) {
        const ph = (t / 0.5) * (Math.PI / 2);
        reach = R * Math.sin(ph);
        y = top - r + R * Math.cos(ph);
      } else if (t <= 0.88) {
        reach = R;
        y = top - r - ((t - 0.5) / 0.38) * (top - r - bottom - 0.016);
      } else {
        const ps = ((t - 0.88) / 0.12) * (Math.PI / 2);
        reach = R - 0.012 * (1 - Math.cos(ps));
        y = bottom + 0.016 - 0.012 * Math.sin(ps);
      }
      // elastic gathers along the bottom of the sides, strongest by the corners
      const along = alpha < 0.05 ? az : alpha > Math.PI / 2 - 0.05 ? ax : 0;
      const near = alpha < 0.05 ? smooth(zIn - 0.3, zIn, Math.abs(az)) : alpha > Math.PI / 2 - 0.05 ? smooth(xIn - 0.22, xIn, Math.abs(ax)) : 1;
      reach += 0.0022 * smooth(0.5, 1, t) * (0.35 + 0.65 * near) * Math.sin((along + alpha * 0.06) * (Math.PI * 2) / 0.07 + 0.4);
      V[o] = ax + sx * Math.cos(alpha) * reach;
      V[o + 1] = y;
      V[o + 2] = az + sz * Math.sin(alpha) * reach;
    }
  // rows run head → foot over the sheet and columns left → right, so tJ × tI points out everywhere
  // (up on top, −z down the head end, +x down the right side, …)
  const acc = new Acc();
  acc.patch(V, NR, NC, 0, NC >> 1);
  return acc.geometry();
}

/** pillow: puffy, thin at the seam, a dent where the head lies, creases into the corners; a short skirt under the seam */
function pillowGeo(s: BedSpec): THREE.BufferGeometry {
  const p = s.pillow;
  const base = s.top + SHEET + 0.001;
  const seam = 0.024;
  const nu = 23;
  const nv = 17;
  const zd = p.z + 0.055; // the head lies a little toward the foot of the pillow
  const xy = (u: number, v: number): [number, number] => [(p.w / 2) * u * (1 + 0.035 * (1 - v * v)), p.z + (p.d / 2) * v * (1 + 0.03 * (1 - u * u))];
  const yAt = (u: number, v: number) => {
    const [x, z] = xy(u, v);
    const puff = Math.pow(Math.max(0, (1 - Math.abs(u) ** 2.4) * (1 - Math.abs(v) ** 2.4)), 0.5);
    const g1 = Math.exp(-((x / 0.11) ** 2) - ((z - zd) / 0.095) ** 2);
    const g2 = Math.exp(-((x / 0.2) ** 2) - ((z - zd) / 0.17) ** 2);
    const dent = 0.072 * (g1 - 0.3 * g2);
    // pillowcase creases running into the corners, and a soft one along its length
    let cr = 0;
    for (const [cu, cv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const du = u - cu * 0.62;
      const dv = v - cv * 0.55;
      const along = (du * cu + dv * cv) / Math.SQRT2;
      const across = (du * cv - dv * cu) / Math.SQRT2;
      cr += 0.004 * Math.exp(-((across / 0.1) ** 2) - ((along / 0.4) ** 2));
    }
    cr += 0.0025 * Math.exp(-(((v + 0.35) / 0.12) ** 2)) * (1 - u * u) + 0.0015 * vnoise(u * 2.2, v * 2.2, 31);
    return base + seam + p.h * puff * (1 - 0.15 * g2) - dent * puff + cr * puff;
  };
  const acc = new Acc();
  const P = new Float32Array(nu * nv * 3);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const u = -1 + (2 * i) / (nu - 1);
      const v = -1 + (2 * j) / (nv - 1);
      const [x, z] = xy(u, v);
      const o = (j * nu + i) * 3;
      P[o] = x;
      P[o + 1] = yAt(u, v);
      P[o + 2] = z;
    }
  acc.patch(P, nv, nu, 0, nu >> 1);
  // the skirt: from the seam, bulging out, then in under the pillow (right edge head-ward, head edge leftward, …)
  const ring: [number, number][] = [];
  for (let j = nv - 1; j > 0; j--) ring.push([nu - 1, j]);
  for (let i = nu - 1; i > 0; i--) ring.push([i, 0]);
  for (let j = 0; j < nv - 1; j++) ring.push([0, j]);
  for (let i = 0; i < nu - 1; i++) ring.push([i, nv - 1]);
  ring.push(ring[0]);
  const Q = new Float32Array(ring.length * 3 * 3);
  ring.forEach(([i, j], c) => {
    const o = (j * nu + i) * 3;
    const x = P[o];
    const z = P[o + 2];
    const ox = x / (p.w / 2);
    const oz = (z - p.z) / (p.d / 2);
    const l = Math.hypot(ox, oz) || 1;
    const nxo = ox / l;
    const nzo = oz / l;
    Q.set([x, P[o + 1], z], c * 3);
    Q.set([x + nxo * 0.006, base + 0.012, z + nzo * 0.006], (ring.length + c) * 3);
    Q.set([x - nxo * 0.01, base - 0.002, z - nzo * 0.01], (2 * ring.length + c) * 3);
  });
  acc.patch(Q, 3, ring.length, 0);
  return acc.geometry();
}

/** the folded blanket at the foot: stacked folded layers, rounded where folded, slightly askew */
function stackGeo(s: BedSpec): THREE.BufferGeometry {
  const st = s.stack;
  const acc = new Acc();
  const y0 = s.top + SHEET + 0.002;
  const layers: [number, number, number, number][] = [
    // dx, dz, width shrink, depth shrink: each fold a little smaller and not quite square on the one below
    [0, 0, 0, 0],
    [0.009, -0.011, 0.016, 0.012],
    [-0.006, 0.008, 0.03, 0.022],
  ];
  for (let L = 0; L < Math.min(st.n, layers.length); L++) {
    const [dx, dz, dw, dd] = layers[L];
    const w = st.w - dw;
    const d = st.d - dd;
    const t = st.t;
    const yb = y0 + L * t * 0.94;
    const rho = t / 2;
    const zc = st.z + dz;
    // profile across the depth, front (foot) bottom → round the front fold → over the top → round the back fold → back bottom
    const prof: [number, number][] = [];
    for (let k = 0; k <= 4; k++) {
      const a = -Math.PI / 2 + (k / 4) * Math.PI;
      prof.push([zc + d / 2 - rho + Math.cos(a) * rho, yb + rho + Math.sin(a) * rho]);
    }
    for (let k = 1; k <= 7; k++) prof.push([zc + d / 2 - rho - ((d - 2 * rho) * k) / 8, yb + t]);
    for (let k = 0; k <= 4; k++) {
      const a = Math.PI / 2 + (k / 4) * Math.PI;
      prof.push([zc - d / 2 + rho + Math.cos(a) * rho, yb + rho + Math.sin(a) * rho]);
    }
    const ns = 12;
    const np = prof.length;
    const P = new Float32Array(ns * np * 3);
    for (let j = 0; j < ns; j++) {
      const sx = j / (ns - 1);
      const e = Math.abs(2 * sx - 1);
      // the ends round off where the folded layers' open edges lie
      const end = Math.pow(Math.max(0, 1 - e ** 6), 0.35);
      const x = dx + (sx - 0.5) * w;
      for (let k = 0; k < np; k++) {
        const [z, y] = prof[k];
        const onTop = y > yb + t * 0.75 ? 1 : 0;
        // the top fold's crease across the middle (where it was folded in half), a slight sag, rumples
        const crease = L === Math.min(st.n, layers.length) - 1 ? 0.0028 * Math.exp(-(((z - zc) / 0.012) ** 2)) : 0;
        const sag = onTop * (-0.0018 * Math.sin(Math.PI * sx) - crease * end + 0.0009 * vnoise(sx * 5, z * 18, 40 + L));
        const o = (j * np + k) * 3;
        P[o] = x;
        P[o + 1] = yb + (y - yb) * end + sag;
        P[o + 2] = zc + (z - zc) * (0.92 + 0.08 * end) + 0.002 * vnoise(sx * 7, k * 0.3, 50 + L);
      }
    }
    // rows run −x → +x along the stack, columns over the profile from the front: tJ × tI = x × −z = +y on top
    acc.patch(P, ns, np, 0, np >> 1);
  }
  return acc.geometry();
}

const propGeos = new Map<string, THREE.BufferGeometry>();
function propGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = propGeos.get(key);
  if (!g) {
    g = trackGeo(make());
    propGeos.set(key, g);
    g.addEventListener('dispose', () => propGeos.delete(key));
  }
  return g;
}

/** a made-up bed's linen (shared by every bed of the kind): fitted sheet, pillow, folded blanket */
export function bedLinen(kind: BedKind) {
  const s = bedSpec(kind);
  return {
    sheet: propGeo(`sheet|${kind}`, () => fittedSheet(s)),
    pillow: propGeo(`pillow|${kind}`, () => pillowGeo(s)),
    stack: propGeo(`stack|${kind}`, () => stackGeo(s)),
  };
}

/**
 * props.ts: the folded blanket at the foot of a made-up bed or stretcher (its mattress is 2·hw × 2·zFoot,
 * edge radius r: bedSpec). The fitted sheet and the pillow bend with the backrest: bedRig.ts has them.
 */
export function makeUpBed(g: THREE.Group, kind: BedKind, id?: string) {
  const stack = new THREE.Mesh(bedLinen(kind).stack, beddingMaterials().blanket);
  // out of the static merge: a patient lying in the bed has it over them (PatientBlanket puts it away)
  stack.name = 'bedStack';
  stack.userData.noMerge = true;
  g.add(stack);
  if (!id) return;
  const list = stacks.get(id) ?? [];
  list.push(stack);
  stacks.set(id, list.slice(-4));
}

// ───────────────────────────── on a lying patient ─────────────────────────────

const BONES = ['Pelvis', 'Neck', 'L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Foot', 'R_Foot', 'L_Toe0', 'R_Toe0', 'L_Forearm', 'R_Forearm', 'L_Hand', 'R_Hand', 'L_UpperArm', 'R_UpperArm'];
const _inv = new THREE.Matrix4();
const _a = new THREE.Matrix4();
const _v = new THREE.Vector3();
const live = new Set<PatientBlanket>();
const stats = { builds: 0, ms: 0, maxMs: 0 };

/**
 * The body's skin (material 'body') posed by its skeleton, in the frame `toLocal` maps world into:
 * its vertices (xyz triplets) and its triangles (indices into them). A skirt or a sleeve is a few
 * large triangles, so the drape needs the triangles, not just the vertices.
 */
function skinPoints(model: THREE.Object3D, toLocal: THREE.Matrix4): { pts: number[]; tris: number[] } {
  const out: number[] = [];
  const tris: number[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || Array.isArray(m.material) || (m.material as THREE.Material).name !== 'body') return;
    const g = m.geometry;
    const pos = g.attributes.position;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    const sk = m.skeleton;
    // three's skinning: bindMatrixInverse · Σ w · bone.matrixWorld · boneInverse · bindMatrix · p, then the mesh's world matrix
    _a.multiplyMatrices(toLocal, m.matrixWorld).multiply(m.bindMatrixInverse);
    const T = sk.bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[j]).premultiply(_a).multiply(m.bindMatrix).elements);
    const idx = g.index;
    // vertex → its point (−1: not yet skinned); the vertex buffer is shared with the head's primitives
    const at = new Int32Array(pos.count).fill(-1);
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx.getX(k) : k;
      if (at[i] >= 0) {
        tris.push(at[i]);
        continue;
      }
      at[i] = out.length / 3;
      tris.push(at[i]);
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let ox = 0;
      let oy = 0;
      let oz = 0;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (!w) continue;
        const e = T[si.getComponent(i, c)];
        if (!e) continue;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      out.push(ox, oy, oz);
    }
  });
  return { pts: out, tris };
}

/**
 * The blanket over a patient lying in bed (avatars.ts). Hangs off the avatar's root (the bed's frame
 * when the patient lies in one); update() looks at the pose four times a second and drapes the
 * blanket again only when the legs, feet, hands, the bed or the lying height have moved.
 */
export class PatientBlanket {
  private readonly mesh: THREE.Mesh;
  private bones: THREE.Object3D[] | null = null;
  private sig: Float32Array | null = null;
  private key = '';
  private surfaceY = NaN;
  private wait = 0;
  private tris = 0;
  private model: THREE.Object3D | null = null;
  /** the bed's backrest at the last drape (rad) */
  private head = 0;
  /** the bed's folded blanket, put away while this one is over the patient */
  private stack: THREE.Object3D | null = null;

  constructor(private readonly root: THREE.Object3D) {
    const k = beddingMaterials();
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), [k.blanket2, k.sheet2]);
    this.mesh.name = 'blanket';
    this.mesh.receiveShadow = true;
    root.add(this.mesh);
    live.add(this);
    // the NPC is gone (discharged, world torn down): free the GPU buffers (they come back if it is drawn again)
    root.addEventListener('removed', () => {
      this.mesh.geometry.dispose();
      this.putAway(null);
      live.delete(this);
    });
    root.addEventListener('added', () => live.add(this));
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    if (v && !this.mesh.visible) this.wait = 0; // lying down again: check the pose right away
    this.mesh.visible = v;
    if (!v) this.putAway(null);
  }

  /** the bed's folded blanket off the bed while this one is over the patient (null: folded at the foot again) */
  private putAway(stack: THREE.Object3D | null) {
    if (stack === this.stack) return;
    if (this.stack) this.stack.visible = true;
    this.stack = stack;
    if (stack) stack.visible = false;
  }

  /**
   * each frame while the patient lies in bed (after the body is placed); `bend`: the bed's backrest is
   * up (bedRig.ts): the body is draped as it would lie on the flat bed, then the blanket bent with the bed
   */
  update(dt: number, model: THREE.Object3D | null, surfaceY: number, bend: BedBendLike | null = null) {
    this.wait -= dt;
    if (!model || this.wait > 0) return;
    const head = bend?.head ?? 0;
    // the backrest moving: drape a little more often (the body moves with it)
    this.wait = Math.abs(head - this.head) > 0.004 ? 0.1 : 0.25;
    this.bones ??= BONES.map((n) => model.getObjectByName(`Bip01_${n}`)).filter((b): b is THREE.Object3D => !!b);
    if (this.bones.length !== BONES.length) return;
    this.root.updateMatrixWorld(true);
    _inv.copy(this.root.matrixWorld).invert();
    const sig = new Float32Array(BONES.length * 3);
    this.bones.forEach((b, i) => {
      _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(_inv);
      sig[i * 3] = _v.x;
      sig[i * 3 + 1] = _v.y;
      sig[i * 3 + 2] = _v.z;
    });
    const bed = bedUnder(this.root);
    this.putAway(this.mesh.visible ? (bed?.stack ?? null) : null);
    const key = `${bed?.key ?? 'loose'}|${head.toFixed(3)}`;
    let moved = !this.sig || key !== this.key || Math.abs(surfaceY - this.surfaceY) > 0.005;
    for (let i = 0; !moved && i < sig.length; i++) moved = Math.abs(sig[i] - this.sig![i]) > 0.012;
    if (!moved) return;
    const t0 = performance.now();
    const ox = bed?.dx ?? 0;
    const oz = bed?.dz ?? 0;
    const { pts, tris } = skinPoints(model, _inv);
    if (pts.length < 300) return;
    const flat = bend && head > 1e-4 ? bend : null;
    const o = [0, 0];
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] -= ox;
      pts[i + 2] -= oz;
      if (flat) {
        flat.unmap(pts[i + 1], pts[i + 2], o);
        pts[i + 1] = o[0];
        pts[i + 2] = o[1];
      }
    }
    // the pelvis and the neck as on the flat bed (the turn-down goes between them)
    const along = (k: number) => (flat ? flat.unmap(sig[k * 3 + 1], sig[k * 3 + 2] - oz, o)[1] : sig[k * 3 + 2] - oz);
    const geo = drapeBlanket({ pts, tris, pelvisZ: along(0), neckZ: along(1), spec: bed?.spec ?? looseSpec(), dy: surfaceY - 0.64, seed: this.root.id * 7919, bend: flat ?? undefined });
    geo.translate(ox, 0, oz);
    this.head = head;
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    let casts = false;
    model.traverse((o) => (casts ||= (o as THREE.SkinnedMesh).isSkinnedMesh && o.castShadow));
    this.mesh.castShadow = casts;
    this.sig = sig;
    this.key = key;
    this.surfaceY = surfaceY;
    this.model = model;
    this.tris = (geo.index?.count ?? 0) / 3;
    const ms = performance.now() - t0;
    stats.builds++;
    stats.ms += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
  }

  info() {
    const p = this.root.getWorldPosition(new THREE.Vector3());
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), bed: this.key, head: +this.head.toFixed(3), tris: this.tris, visible: this.mesh.visible, castShadow: this.mesh.castShadow };
  }

  /** debug: the blanket's mesh and the body's skin as it is now, both in the root's frame */
  dump(model: THREE.Object3D | null = this.model) {
    if (!model) return null;
    this.root.updateMatrixWorld(true);
    const g = this.mesh.geometry;
    const skin = skinPoints(model, _inv.copy(this.root.matrixWorld).invert());
    return {
      pos: Array.from(g.getAttribute('position')?.array ?? []),
      index: Array.from(g.index?.array ?? []),
      groups: g.groups,
      skin: skin.pts,
      skinTris: skin.tris,
      sig: Array.from(this.sig ?? []),
    };
  }

  sceneRoot(): THREE.Object3D {
    let o: THREE.Object3D = this.root;
    while (o.parent) o = o.parent;
    return o;
  }
}

// debug (?debug=1 → __acBedding.stats()): blankets, their beds and triangles, how often and how long they were draped
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  (globalThis as unknown as Record<string, unknown>).__acBedding = {
    stats: () => ({ blankets: [...live].map((b) => b.info()), builds: stats.builds, avgMs: stats.builds ? +(stats.ms / stats.builds).toFixed(2) : 0, maxMs: +stats.maxMs.toFixed(2) }),
    /** the scene a blanket is in (tests put an extra patient on a stretcher) */
    scene: () => [...live].map((b) => b.sceneRoot()).find((o) => (o as THREE.Scene).isScene) ?? null,
    /** blanket i's mesh and its patient's skin as posed now (root frame) */
    dump: (i = 0) => [...live][i]?.dump() ?? null,
  };
}

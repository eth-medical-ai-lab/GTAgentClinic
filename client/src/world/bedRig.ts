/**
 * Articulated beds. The backrest of every bed and stretcher hinges, 0–80°, and the deck, the mattress,
 * the fitted sheet and the pillow bend with it.
 *
 * The bend: the lying surface folds along a crease across the mattress top, under the patient's hips
 * (BedSpec.hinge); the head side turns about it as one piece. Round the crease the mattress top follows
 * a fillet (BedSpec.hinge.r) and every layer above or below it the offset of that (the mattress's
 * bottom and the deck a wider arc, the sheet a slightly tighter one): one continuous map of the flat
 * bed (its frame: x across, y up, z toward the foot) onto the bent one, so there is no gap at the
 * hinge and nothing folds through itself. A layer higher over the top than the fillet's radius (a
 * blanket over the lap) rounds the crease with a radius of its own: the cloth bunches there.
 *
 * Rigs: props.ts builds each bed's deck, mattress and linen (sheet and pillow) as meshes of their own,
 * out of the static merge, on flat shapes shared per kind; a rig bends its own copies while its
 * backrest is up. World sets where a patient's backrest should be (the server's BedPosition) and steps
 * the rigs; the backrest moves like an electric bed's (about 12°/s, eased), and the patient on it
 * follows the rig's angle (avatars.ts), as does their blanket (bedding.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropDef } from '../../../shared/layout';
import { HEAD_MAX, bedLinen, bedSpec, beddingMaterials, bendGeometry, creaseRows, type BedBendLike, type BedKind, type BedSpec } from './bedding';
import { G, lambert, trackGeo } from './materials';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
/** the backrest's pace (rad/s) and the shortest move (s) */
const PACE = 12 * DEG;
const MIN_MOVE = 1.2;
/** a bed nobody has asked for lately settles flat (s) */
const CLAIM_S = 3;

// ───────────────────────────── the bend ─────────────────────────────

/**
 * The flat bed onto the bent one, in the bed's frame (BedBendLike). A point h over the mattress top at
 * z: on the seat and legs side of the crease (z ≥ hinge + reach) unchanged; on the backrest's side
 * turned about the crease (zH, top) by the backrest's angle; in between round an arc about the fillet's
 * centre, the fillet radius max(r, h + 4 mm).
 */
export class Bend implements BedBendLike {
  readonly head: number;
  readonly zH: number;
  /** the mattress top (the crease's height) */
  readonly T: number;
  readonly r: number;
  private readonly c: number;
  private readonly s: number;
  private readonly t2: number;

  constructor(spec: BedSpec, head: number) {
    this.head = clamp(head, 0, HEAD_MAX);
    this.zH = spec.hinge.z;
    this.T = spec.top;
    this.r = spec.hinge.r;
    this.c = Math.cos(this.head);
    this.s = Math.sin(this.head);
    this.t2 = Math.tan(this.head / 2);
  }

  get flat(): boolean {
    return this.head < 1e-4;
  }

  /** the crease's fillet radius for a layer h over the mattress top */
  private rho(h: number): number {
    return Math.max(this.r, h + 0.004);
  }

  map(y: number, z: number, out: number[]): number[] {
    const h = y - this.T;
    const u = z - this.zH;
    out[2] = 0;
    if (this.flat) {
      out[0] = y;
      out[1] = z;
      return out;
    }
    const rho = this.rho(h);
    const reach = rho * this.t2;
    if (u >= reach) {
      out[0] = y;
      out[1] = z;
    } else if (u <= -reach) {
      // the backrest: turned about the crease (a turn about +x lifts the head end, −z)
      out[0] = this.T - u * this.s + h * this.c;
      out[1] = this.zH + u * this.c + h * this.s;
      out[2] = this.head;
    } else {
      // round the crease: about the fillet's centre (on the crease's bisector), from the backrest's end to the seat's
      const phi = (1 - (u + reach) / (2 * reach)) * this.head;
      const R = rho - h;
      out[0] = this.T + rho - R * Math.cos(phi);
      out[1] = this.zH + reach - R * Math.sin(phi);
      out[2] = phi;
    }
    return out;
  }

  unmap(y: number, z: number, out: number[]): number[] {
    if (this.flat) {
      out[0] = y;
      out[1] = z;
      return out;
    }
    const dz = z - this.zH;
    const dy = y - this.T;
    // the fillet of the mattress top's own radius: every layer up to it (and everything under the top)
    const reach = this.r * this.t2;
    const az = reach - dz;
    const ay = this.r - dy;
    const phi = Math.atan2(az, ay);
    const ha = this.r - Math.hypot(az, ay);
    if (phi >= -1e-6 && phi <= this.head + 1e-6 && ha < this.r - 0.004) {
      out[0] = this.T + ha;
      out[1] = this.zH - reach + (1 - phi / this.head) * 2 * reach;
      return out;
    }
    // the seat's side as it is, the backrest's turned back; in the crease's fold (a layer over the
    // fillet, no flat point maps there) the nearer of the two, at the edge of its own side
    const hb = dz * this.s + dy * this.c;
    const ub = dz * this.c - dy * this.s;
    const seat = dz >= this.rho(dy) * this.t2;
    const back = ub <= -this.rho(hb) * this.t2;
    if (seat && (!back || dy <= hb)) {
      out[0] = y;
      out[1] = z;
    } else if (back) {
      out[0] = this.T + hb;
      out[1] = this.zH + ub;
    } else if (dy <= hb) {
      out[0] = y;
      out[1] = this.zH + this.rho(dy) * this.t2;
    } else {
      out[0] = this.T + hb;
      out[1] = this.zH - this.rho(hb) * this.t2;
    }
    return out;
  }
}

// ───────────────────────────── the flat shapes ─────────────────────────────

/**
 * A slab with rounded edges and corners (the inner box grown by r): rings across it along z, the
 * crease's rows among them so it bends smoothly. UVs in tiles of `tile` m round its girth and along it.
 */
function slabGeo(hw: number, y0: number, y1: number, zHalf: number, r: number, rows: number[], tile: number): THREE.BufferGeometry {
  const a = hw - r;
  const yt = y1 - r;
  const yb = y0 + r;
  const zi = zHalf - r;
  // the profile: inner point and outward normal, clockwise seen from +z (the top from −x to +x, …), closed
  const prof: [number, number, number, number][] = [[-a, yt, 0, 1], [0, yt, 0, 1]];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let k = 0; k <= 4; k++) {
      const t = a0 + ((a1 - a0) * k) / 4;
      prof.push([cx, cy, Math.cos(t), Math.sin(t)]);
    }
  };
  arc(a, yt, Math.PI / 2, 0);
  arc(a, yb, 0, -Math.PI / 2);
  prof.push([0, yb, 0, -1]);
  arc(-a, yb, -Math.PI / 2, -Math.PI);
  arc(-a, yt, Math.PI, Math.PI / 2);
  const P = prof.length;
  // the girth's length at each profile point (u)
  const girth: number[] = [0];
  for (let k = 1; k < P; k++) {
    const [ax, ay, anx, any] = prof[k - 1];
    const [bx, by, bnx, bny] = prof[k];
    girth.push(girth[k - 1] + Math.hypot(bx + r * bnx - ax - r * anx, by + r * bny - ay - r * any));
  }
  // the rings, in z order: the head end's rounding, the straight part (the crease's rows among ~10 cm ones), the foot end's
  const straight = [...Array.from({ length: 21 }, (_, i) => -zi + (2 * zi * i) / 20).filter((z) => !rows.some((c) => Math.abs(c - z) < 0.03)), ...rows.filter((z) => Math.abs(z) < zi - 0.005)].sort((p, q) => p - q);
  const BETA = [90, 67.5, 45, 22.5].map((d) => d * DEG);
  const rings: { z: number; k: number; sb: number }[] = [
    ...BETA.map((b) => ({ z: -(zi + r * Math.sin(b)), k: Math.cos(b), sb: -Math.sin(b) })),
    ...straight.map((z) => ({ z, k: 1, sb: 0 })),
    ...[...BETA].reverse().map((b) => ({ z: zi + r * Math.sin(b), k: Math.cos(b), sb: Math.sin(b) })),
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const ring of rings)
    for (let k = 0; k < P; k++) {
      const [qx, qy, nx, ny] = prof[k];
      pos.push(qx + r * ring.k * nx, qy + r * ring.k * ny, ring.z);
      nor.push(nx * ring.k, ny * ring.k, ring.sb);
      uv.push(girth[k] / tile, ring.z / tile);
    }
  const idx: number[] = [];
  for (let j = 0; j < rings.length - 1; j++)
    for (let k = 0; k < P - 1; k++) {
      const p = j * P + k;
      const q = p + P;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  // the flat ends, fans from their middles
  for (const [ring, out] of [[0, -1], [rings.length - 1, 1]] as const) {
    const c = pos.length / 3;
    pos.push(0, (yt + yb) / 2, out * zHalf);
    nor.push(0, 0, out);
    uv.push(0, 0);
    for (let k = 0; k < P - 1; k++) {
      const p = ring * P + k;
      if (out > 0) idx.push(c, p + 1, p);
      else idx.push(c, p, p + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** a puffy pillow lying lengthwise under a raised leg (centred, its bottom at y 0): w across, d along, h high */
function legPillowGeo(w: number, d: number, h: number): THREE.BufferGeometry {
  const nu = 11;
  const nv = 15;
  const seam = 0.028;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const top of [true, false]) {
    const base = pos.length / 3;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const u = -1 + (2 * i) / (nu - 1);
        const v = -1 + (2 * j) / (nv - 1);
        const puff = Math.pow(Math.max(0, (1 - Math.abs(u) ** 2.4) * (1 - Math.abs(v) ** 2.4)), 0.5);
        const x = (w / 2) * u * (1 + 0.04 * (1 - v * v));
        const z = (d / 2) * v * (1 + 0.03 * (1 - u * u));
        // the top puffs up; the bottom sags onto the mattress
        pos.push(x, top ? seam + (h - seam) * puff : seam * (1 - puff), z);
        uv.push(x, z);
      }
    for (let j = 0; j < nv - 1; j++)
      for (let i = 0; i < nu - 1; i++) {
        const p = base + j * nu + i;
        const q = p + nu;
        // rows run +z, columns +x: q × (p+1) faces up on the top
        if (top) idx.push(p, q, p + 1, p + 1, q, q + 1);
        else idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** the leg pillow's size: across, along, height (with its seam and puff) */
export const LEG_PILLOW = { w: 0.34, d: 0.56, h: 0.13 };

const shapes = new Map<string, THREE.BufferGeometry>();
function shape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = shapes.get(key);
  if (!g) {
    g = trackGeo(make());
    shapes.set(key, g);
    g.addEventListener('dispose', () => shapes.delete(key));
  }
  return g;
}

/** a kind's flat deck, mattress and linen (sheet and pillow in one: one material) */
function flatShapes(kind: BedKind) {
  const s = bedSpec(kind);
  const rows = creaseRows(s);
  return {
    deck: shape(`deck|${kind}`, () => slabGeo(s.W / 2, 0.44, 0.49, s.L / 2, 0.02, rows, 1)),
    mattress: shape(`mattress|${kind}`, () => slabGeo(s.hw, s.bottom, s.top, s.zFoot, s.r, rows, 0.35)),
    linen: shape(`linen|${kind}`, () => {
      const l = bedLinen(kind);
      return mergeGeometries([l.sheet, l.pillow], false)!;
    }),
  };
}

// ───────────────────────────── the head pillow under a patient ─────────────────────────────

/** cells of a PillowPress (m) */
const PRESS_CELL = 0.02;

/** the underside of what lies on the pillow, as on the flat bed: per 2 cm cell from (x0, z0), the lowest skin over it (Infinity: none) */
export interface PillowPress {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  y: Float32Array;
}

/**
 * The pillow (in the merged linen, flat) pressed down to the body on it, never thinner than 1 cm: a head
 * sinks into a pillow, it doesn't go through it. Normals redone where it gave way (kept facing as they did).
 */
function pressPillow(g: THREE.BufferGeometry, pr: PillowPress, part: { v0: number; i0: number; base: number }): number {
  const P = g.getAttribute('position').array as Float32Array;
  const N = g.getAttribute('normal').array as Float32Array;
  const n = P.length / 3;
  const floor = part.base + 0.01;
  const moved = new Uint8Array(n);
  let count = 0;
  for (let i = part.v0; i < n; i++) {
    const cx = Math.floor((P[i * 3] - pr.x0) / PRESS_CELL);
    const cz = Math.floor((P[i * 3 + 2] - pr.z0) / PRESS_CELL);
    if (cx < 0 || cz < 0 || cx >= pr.nx || cz >= pr.nz) continue;
    // (4 mm under the skin: breathing and a glance aside don't bring it through)
    const lim = Math.max(floor, pr.y[cz * pr.nx + cx] - 0.004);
    if (P[i * 3 + 1] <= lim) continue;
    P[i * 3 + 1] = lim;
    moved[i] = 1;
    count++;
  }
  if (!count) return 0;
  const was = new Float32Array(N);
  for (let i = 0; i < n; i++) if (moved[i]) N[i * 3] = N[i * 3 + 1] = N[i * 3 + 2] = 0;
  const idx = g.index!.array;
  for (let t = part.i0; t + 2 < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (!moved[a] && !moved[b] && !moved[c]) continue;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      if (!moved[k]) continue;
      N[k * 3] += fx;
      N[k * 3 + 1] += fy;
      N[k * 3 + 2] += fz;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!moved[i]) continue;
    let x = N[i * 3];
    let y = N[i * 3 + 1];
    let z = N[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l < 1e-12) {
      N.set(was.subarray(i * 3, i * 3 + 3), i * 3);
      continue;
    }
    // (whichever way the faces wind: out of the pillow, as before)
    const s = x * was[i * 3] + y * was[i * 3 + 1] + z * was[i * 3 + 2] < 0 ? -1 / l : 1 / l;
    x *= s;
    y *= s;
    z *= s;
    N[i * 3] = x;
    N[i * 3 + 1] = y;
    N[i * 3 + 2] = z;
  }
  return count;
}

/** per skinned mesh: the vertices that can lie on a pillow (head, hair, neck, upper back, shoulders) */
function upperVertices(m: THREE.SkinnedMesh): Int32Array {
  const g = m.geometry;
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const pos = g.getAttribute('position');
  if (!si || !sw || !pos) return new Int32Array(0);
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '';
  const all = mat === 'head' || mat === 'hair';
  const bones = m.skeleton.bones.map((b) => /_Head$|_Neck$|_Spine2$|_Clavicle$|_UpperArm$|Hair|Ponytail|HeadNub/i.test(b.name));
  // (the primitives share one vertex buffer: this mesh's own vertices are the ones its index uses)
  const own = new Uint8Array(pos.count);
  if (g.index) for (let k = 0; k < g.index.count; k++) own[g.index.getX(k)] = 1;
  else own.fill(1);
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (!own[i]) continue;
    if (all) {
      out.push(i);
      continue;
    }
    let bi = 0;
    for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, bi)) bi = j;
    if (bones[si.getComponent(i, bi)]) out.push(i);
  }
  return new Int32Array(out);
}

const _pa = new THREE.Matrix4();
const _pb = new THREE.Matrix4();

/**
 * The underside of a lying patient's head, neck and shoulders over the head pillow, as on the flat bed
 * (BedRig.press): CPU-skinned as three's shader skins them, each cell the lowest skin over it and its
 * neighbours (the skin's vertices are a couple of cm apart). `cache` keeps each mesh's upperVertices.
 */
export function pillowPress(model: THREE.Object3D, rig: BedRig, cache: Map<THREE.SkinnedMesh, Int32Array>): PillowPress | null {
  const pl = rig.spec.pillow;
  const x0 = -pl.w / 2 - 0.05;
  const z0 = pl.z - pl.d / 2 - 0.05;
  const nx = Math.ceil((pl.w + 0.1) / PRESS_CELL);
  const nz = Math.ceil((pl.d + 0.1) / PRESS_CELL);
  const low = new Float32Array(nx * nz).fill(Infinity);
  rig.group.updateWorldMatrix(true, false);
  const toBed = _pb.copy(rig.group.matrixWorld).invert();
  const bend = rig.bend;
  const o = [0, 0];
  let hits = 0;
  model.traverse((obj) => {
    const m = obj as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    let sel = cache.get(m);
    if (!sel) cache.set(m, (sel = upperVertices(m)));
    if (!sel.length) return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const sk = m.skeleton;
    // three's skinning: bindMatrixInverse · Σ w · bone.matrixWorld · boneInverse · bindMatrix · p, then the mesh's world matrix
    _pa.multiplyMatrices(toBed, m.matrixWorld).multiply(m.bindMatrixInverse);
    const T = sk.bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[j]).premultiply(_pa).multiply(m.bindMatrix).elements);
    for (let q = 0; q < sel.length; q++) {
      const i = sel[q];
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let bx = 0;
      let by = 0;
      let bz = 0;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (!w) continue;
        const e = T[si.getComponent(i, c)];
        if (!e) continue;
        bx += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        by += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        bz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      const cx = Math.floor((bx - x0) / PRESS_CELL);
      if (cx < 0 || cx >= nx) continue;
      if (!bend.flat) {
        bend.unmap(by, bz, o);
        by = o[0];
        bz = o[1];
      }
      const cz = Math.floor((bz - z0) / PRESS_CELL);
      if (cz < 0 || cz >= nz) continue;
      const k = cz * nx + cx;
      if (by < low[k]) low[k] = by;
      hits++;
    }
  });
  if (!hits) return null;
  const y = new Float32Array(nx * nz).fill(Infinity);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      let v = Infinity;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz) v = Math.min(v, low[b * nx + a]);
        }
      y[j * nx + i] = v;
    }
  return { x0, z0, nx, nz, y };
}

// ───────────────────────────── a bed's rig ─────────────────────────────

interface Part {
  mesh: THREE.Mesh;
  flat: THREE.BufferGeometry;
  own: THREE.BufferGeometry | null;
}

const rigs = new Set<BedRig>();

export class BedRig {
  readonly spec: BedSpec;
  /** the backrest now (rad) */
  head = 0;
  /** where it is going, from where, how far along (s) and how long the move takes */
  private goal = 0;
  private from = 0;
  private t = 0;
  private dur = 0;
  private bent: Bend;
  private parts: Part[];
  /** The foot rail on the side where a seated patient places their legs. */
  entryRail?: { mesh: THREE.Mesh; raisedY: number };
  private pillow: THREE.Mesh | null = null;
  private scene: THREE.Object3D | null = null;
  /** performance.now() of the last want() (World: the patient on it) */
  claimed = -1e9;
  /** the head pillow in the merged linen (hingedBed): its first vertex and index, and its underside's height */
  pillowPart: { v0: number; i0: number; base: number } | null = null;
  /** what the head pillow gives way to (press) */
  private pressed: PillowPress | null = null;
  private pressDirty = false;
  /** tests: how many of the pillow's vertices the last press moved */
  pressedVerts = 0;

  constructor(
    readonly id: string,
    readonly kind: BedKind,
    readonly group: THREE.Object3D,
    meshes: THREE.Mesh[],
  ) {
    this.spec = bedSpec(kind);
    this.bent = new Bend(this.spec, 0);
    this.parts = meshes.map((mesh) => ({ mesh, flat: mesh.geometry, own: null }));
  }

  /** tests: held at this angle (degrees), whatever is asked; null lets go */
  hold: number | null = null;

  /** the backrest's angle to go to (degrees); it moves there at an electric bed's pace */
  want(deg: number, sittingOnEdge = false) {
    this.claimed = performance.now();
    if (this.entryRail) this.entryRail.mesh.position.y = this.entryRail.raisedY - (sittingOnEdge ? 0.33 : 0);
    const goal = clamp((this.hold ?? deg) * DEG, 0, HEAD_MAX);
    if (Math.abs(goal - this.goal) < 1e-4) return;
    this.goal = goal;
    this.from = this.head;
    this.t = 0;
    this.dur = Math.max(MIN_MOVE, Math.abs(goal - this.head) / PACE);
  }

  /** straight there (tests, a bed built bent) */
  snap(deg: number) {
    this.want(deg);
    this.t = this.dur;
    this.step(0);
  }

  get goalDeg(): number {
    return this.goal / DEG;
  }

  get moving(): boolean {
    return Math.abs(this.head - this.goal) > 1e-4;
  }

  /** the bend as the bed is now */
  get bend(): Bend {
    return this.bent;
  }

  /**
   * avatars.ts: the underside of the head, neck and shoulders of the patient lying on the head pillow, as
   * on the flat bed (null: nobody on it). The pillow gives way under them instead of going through them.
   */
  press(p: PillowPress | null) {
    if (!p && !this.pressed) return;
    this.pressed = p;
    this.pressDirty = true;
  }

  get pressing(): boolean {
    return !!this.pressed;
  }

  /** per frame: the backrest along its move (eased in and out), the bed's shapes bent to it, the pillow pressed */
  step(dt: number) {
    const turning = this.moving || this.bent.head !== this.head;
    if (!turning && !this.pressDirty) return;
    if (turning) {
      this.t = Math.min(this.dur, this.t + dt);
      const k = this.dur > 0 ? this.t / this.dur : 1;
      this.head = this.from + (this.goal - this.from) * k * k * (3 - 2 * k);
      if (k >= 1) this.head = this.goal;
      this.bent = new Bend(this.spec, this.head);
    }
    this.pressDirty = false;
    for (const p of this.parts) {
      const linen = p.mesh.name === 'bedLinen';
      // (only a new press: only the linen changes)
      if (!turning && !linen) continue;
      const press = linen && this.pillowPart ? this.pressed : null;
      if (this.bent.flat && !press) {
        p.mesh.geometry = p.flat;
        continue;
      }
      if (!p.own) {
        p.own = trackGeo(p.flat.clone());
        p.own.addEventListener('dispose', () => (p.own = null));
      }
      // from the flat shape every time (bends don't add up)
      for (const k of ['position', 'normal']) (p.own.getAttribute(k).array as Float32Array).set(p.flat.getAttribute(k).array as Float32Array);
      if (linen) this.pressedVerts = press ? pressPillow(p.own, press, this.pillowPart!) : 0;
      if (this.bent.flat) {
        p.own.getAttribute('position').needsUpdate = true;
        p.own.getAttribute('normal').needsUpdate = true;
        p.own.computeBoundingSphere();
        p.own.computeBoundingBox();
      } else bendGeometry(p.own, this.bent);
      p.mesh.geometry = p.own;
    }
  }

  /**
   * A pillow under a raised leg (avatars.ts: an elevated ankle), centred at (x, z) in the bed's frame on
   * the mattress (null: none). It lies on the seat and legs' side, which the backrest never moves.
   */
  legPillow(at: { x: number; z: number } | null) {
    if (!at) {
      if (this.pillow) this.pillow.visible = false;
      return;
    }
    if (!this.pillow) {
      this.pillow = new THREE.Mesh(shape('legPillow', () => legPillowGeo(LEG_PILLOW.w, LEG_PILLOW.d, LEG_PILLOW.h)), beddingMaterials().sheet);
      this.pillow.name = 'legPillow';
      this.pillow.castShadow = true;
      this.pillow.receiveShadow = true;
      this.pillow.userData.noMerge = true;
      this.group.add(this.pillow);
    }
    this.pillow.visible = true;
    this.pillow.position.set(at.x, this.spec.top + 0.0045, at.z);
  }

  /** the pillow under a leg now (tests): its centre in the bed's frame, or null */
  legPillowAt(): [number, number, number] | null {
    return this.pillow?.visible ? (this.pillow.position.toArray() as [number, number, number]) : null;
  }

  /**
   * A step stool under the feet of someone sitting on the bed's edge whose feet don't reach the floor
   * (World: an ankle in Fast Track): its top's middle in the bed's frame, and its height (null: put away).
   */
  footStep(at: { x: number; z: number; top: number } | null) {
    if (!at || at.top < 0.04) {
      if (this.stool) this.stool.visible = false;
      return;
    }
    if (!this.stool) {
      // a moulded plastic step (its long side along the bed), a rubber tread on top
      const g = new THREE.Group();
      g.name = 'footStep';
      const body = new THREE.Mesh(G.rbox(0.3, 1, 0.46, 0.02), lambert('#c9cfd3', { roughness: 0.5 }));
      const tread = new THREE.Mesh(G.rbox(0.26, 0.012, 0.42, 0.005), lambert('#2b3034', { roughness: 0.9 }));
      body.name = 'stepBody';
      tread.name = 'stepTread';
      for (const m of [body, tread]) {
        m.castShadow = m.receiveShadow = true;
        m.userData.noMerge = true;
      }
      g.add(body, tread);
      this.group.add(g);
      this.stool = g;
    }
    const [body, tread] = this.stool.children as THREE.Mesh[];
    const h = Math.min(0.3, at.top);
    // (the body a unit high, scaled to the step's height; the tread on it, 2 mm proud)
    body.scale.y = h - 0.01;
    body.position.y = (h - 0.01) / 2;
    tread.position.y = h - 0.006;
    this.stool.position.set(at.x, 0, at.z);
    this.stool.visible = true;
  }

  /** the step stool now (tests): its top's middle in the bed's frame, or null */
  footStepAt(): [number, number, number] | null {
    if (!this.stool?.visible) return null;
    const tread = this.stool.children[1];
    return [this.stool.position.x, tread.position.y + 0.006, this.stool.position.z];
  }
  private stool: THREE.Group | null = null;

  /** the scene this bed is drawn in (null: a build that only measured a box) */
  sceneRoot(): THREE.Object3D | null {
    if (this.scene) return this.scene;
    let o: THREE.Object3D = this.group;
    while (o.parent) o = o.parent;
    if ((o as THREE.Scene).isScene) this.scene = o;
    return this.scene;
  }

  /** where it stands: its centre (floor level) and turn in the world (beds don't move: kept once it is in its scene) */
  where(): { x: number; y: number; z: number; rot: number } {
    if (this.placed) return this.placed;
    this.group.updateWorldMatrix(true, false);
    const e = this.group.matrixWorld.elements;
    const w = { x: e[12], y: e[13], z: e[14], rot: Math.atan2(e[8], e[10]) };
    if (!this.mobile && this.sceneRoot()) this.placed = w;
    return w;
  }
  mobile = false;
  private placed: { x: number; y: number; z: number; rot: number } | null = null;

  /** a world point → the bed's frame */
  toBed(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return this.group.worldToLocal(out.copy(p));
  }

  /** a bed-frame point → the world */
  toWorld(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return this.group.localToWorld(out.copy(p));
  }

  dispose() {
    for (const p of this.parts) p.own?.dispose();
    rigs.delete(this);
  }
}

/**
 * props.ts: a bed's or stretcher's deck, mattress and made-up linen (fitted sheet, pillow) on `g`, the
 * prop's group, as meshes that bend with its backrest (kept out of the static merge: three draw calls).
 */
export function hingedBed(g: THREE.Group, p: PropDef, kind: BedKind, mats: { deck: THREE.Material; mattress: THREE.Material }): BedRig {
  const f = flatShapes(kind);
  const deck = new THREE.Mesh(f.deck, mats.deck);
  const mattress = new THREE.Mesh(f.mattress, mats.mattress);
  const linen = new THREE.Mesh(f.linen, beddingMaterials().sheet);
  mattress.userData.castShadow = true;
  for (const m of [deck, mattress, linen]) m.userData.noMerge = true;
  deck.name = 'bedDeck';
  mattress.name = 'bedMattress';
  linen.name = 'bedLinen';
  g.add(deck, mattress, linen);
  const rig = new BedRig(p.id, kind, g, [deck, mattress, linen]);
  // (the pillow follows the sheet in the merged linen)
  const sheet = bedLinen(kind).sheet;
  const v0 = sheet.getAttribute('position').count;
  const lp = f.linen.getAttribute('position');
  let base = Infinity;
  for (let i = v0; i < lp.count; i++) base = Math.min(base, lp.getY(i));
  if (sheet.index && f.linen.index && Number.isFinite(base)) rig.pillowPart = { v0, i0: sheet.index.count, base };
  rigs.add(rig);
  // tests can build every bed with its backrest up (zfight scans of the bent shapes)
  if (buildAt) rig.snap(buildAt);
  return rig;
}

let buildAt = 0;
/** tests: beds built from now on have their backrest at this angle (degrees; 0 = flat) */
export function buildBedsAt(deg: number) {
  buildAt = deg;
}

// ───────────────────────────── the beds in a world ─────────────────────────────

/** the rigs of the beds drawn in this scene (a build that only measured a box never joins one) */
export function rigsIn(scene: THREE.Object3D): BedRig[] {
  const out: BedRig[] = [];
  for (const r of rigs) if (r.sceneRoot() === scene) out.push(r);
  return out;
}

/** the bed in `scene` centred within `r` m of a world point (same storey), turned `yaw` (±0.4 rad); null if none */
export function rigAt(scene: THREE.Object3D, x: number, y: number, z: number, yaw: number, r = 0.4): BedRig | null {
  let best: BedRig | null = null;
  let bd = r;
  for (const rig of rigs) {
    if (rig.sceneRoot() !== scene) continue;
    const w = rig.where();
    if (Math.abs(w.y - y) > 1.2) continue;
    const d = Math.hypot(w.x - x, w.z - z);
    const da = Math.abs(Math.atan2(Math.sin(w.rot - yaw), Math.cos(w.rot - yaw)));
    if (d < bd && da < 0.4) {
      bd = d;
      best = rig;
    }
  }
  return best;
}

/** per frame: every bed's backrest along its move; a bed nobody asked for lately settles flat, its step stool put away */
export function stepRigs(scene: THREE.Object3D, dt: number) {
  const now = performance.now();
  for (const r of rigs) {
    if (r.sceneRoot() !== scene) continue;
    if (now - r.claimed > CLAIM_S * 1000 && (r.goalDeg !== 0 || r.footStepAt() || r.pressing)) {
      r.want(0);
      r.footStep(null);
      r.press(null);
    }
    r.step(dt);
  }
}

/** the world is going: its beds' rigs (and builds that never joined a scene) are let go */
export function disposeRigs(scene: THREE.Object3D) {
  for (const r of [...rigs]) {
    const s = r.sceneRoot();
    if (s === scene || !s) r.dispose();
  }
}

// ───────────────────────────── tests ─────────────────────────────

/** tests: hold a bed's backrest at an angle (degrees; `snap`: straight there), or let it go (null) */
export function holdBed(scene: THREE.Object3D, id: string, deg: number | null, snap = false): boolean {
  const r = rigsIn(scene).find((x) => x.id === id);
  if (!r) return false;
  r.hold = deg;
  if (deg !== null && snap) r.snap(deg);
  else if (deg !== null) r.want(deg);
  return true;
}

/** every bed in the scene: its backrest now and where it is going (degrees), where it stands */
export function bedDebug(scene: THREE.Object3D) {
  return rigsIn(scene).map((r) => {
    const w = r.where();
    return { id: r.id, kind: r.kind, head: +((r.head * 180) / Math.PI).toFixed(2), goal: +r.goalDeg.toFixed(2), moving: r.moving, x: +w.x.toFixed(2), y: +w.y.toFixed(2), z: +w.z.toFixed(2), rot: +w.rot.toFixed(3), legPillow: r.legPillowAt(), footStep: r.footStepAt(), pressing: r.pressing, pressedVerts: r.pressedVerts, stack: r.group.getObjectByName('bedStack')?.visible ?? null };
  });
}

/** a skinned body's vertices (CPU-skinned, world) with their material's name and their main bone, every `step`th */
function skinned(root: THREE.Object3D, step: number, fn: (v: THREE.Vector3, mat: string, bone: string) => void) {
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible || Array.isArray(m.material)) return;
    m.skeleton.update();
    const mat = (m.material as THREE.Material).name;
    const pos = m.geometry.getAttribute('position');
    const si = m.geometry.getAttribute('skinIndex');
    const sw = m.geometry.getAttribute('skinWeight');
    // a Rocketbox avatar's primitives share one vertex buffer: this mesh's own vertices are the ones its index uses
    const idx = m.geometry.index;
    const own = new Uint8Array(pos.count);
    if (idx) for (let k = 0; k < idx.count; k++) own[idx.getX(k)] = 1;
    else own.fill(1);
    for (let i = 0; i < pos.count; i += step) {
      if (!own[i]) continue;
      m.getVertexPosition(i, v);
      let bone = '';
      let bw = -1;
      for (let j = 0; j < 4; j++)
        if (sw.getComponent(i, j) > bw) {
          bw = sw.getComponent(i, j);
          bone = m.skeleton.bones[si.getComponent(i, j)]?.name.replace('Bip01_', '') ?? '';
        }
      fn(v.applyMatrix4(m.matrixWorld), mat, bone);
    }
  });
}

/**
 * Tests: a patient lying in this bed, measured against it (bed frame; m and degrees):
 *  - trunk: how far the trunk (hip joints to the neck) is turned up from lying flat (its rise less the
 *    clip's own tilt of that line), against the backrest's angle
 *  - hip: the hip joints against the crease (along the bed, over the mattress, off the crease's bisector)
 *  - into: the deepest the skin goes into the mattress (as on the flat bed), the side rails, the boards
 *  - blanket: the least the blanket clears the skin under it (as on the flat bed; < 0 = through it)
 *  - face, chest: where they are, from the skin (the face's front along the head's facing; the sternum)
 */
export function inBedReport(root: THREE.Object3D, rig: BedRig, blanket: { pos: number[]; index: number[]; groups: { start: number; count: number }[] } | null, aims: Record<string, number[]> | null = null) {
  const bend = rig.bend;
  const s = rig.spec;
  const deg = (r: number) => +((r * 180) / Math.PI).toFixed(2);
  root.updateMatrixWorld(true);
  const bone = (n: string) => root.getObjectByName(`Bip01_${n}`);
  const at = (n: string) => {
    const b = bone(n);
    return b ? rig.toBed(b.getWorldPosition(new THREE.Vector3())) : null;
  };
  const neck = at('Neck');
  const lt = at('L_Thigh');
  const rt = at('R_Thigh');
  if (!neck || !lt || !rt) return null;
  const hip = lt.clone().add(rt).multiplyScalar(0.5);
  const rise = Math.atan2(neck.y - hip.y, hip.z - neck.z);
  // the same line in the body's own frame (the clip): its tilt there, lying flat
  const body = root.children[0];
  const nb = body.worldToLocal(bone('Neck')!.getWorldPosition(new THREE.Vector3()));
  const hb = body.worldToLocal(bone('L_Thigh')!.getWorldPosition(new THREE.Vector3()).add(bone('R_Thigh')!.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5));
  const own = Math.atan2(nb.z - hb.z, nb.y - hb.y);
  const half = bend.head / 2;
  const hipR = { along: +(hip.z - bend.zH).toFixed(3), over: +(hip.y - bend.T).toFixed(3), offBisector: +Math.abs((hip.z - bend.zH) * Math.cos(half) - (hip.y - bend.T) * Math.sin(half)).toFixed(3) };
  // the skin against the mattress, the rails, the boards (bed frame, the mattress as flat): the deepest per bone
  const into: Record<'mattress' | 'rails' | 'boards', Record<string, { d: number; at: number[] }>> = { mattress: {}, rails: {}, boards: {} };
  const note = (k: 'mattress' | 'rails' | 'boards', d: number, what: string, p: THREE.Vector3) => {
    if (d < (into[k][what]?.d ?? 0)) into[k][what] = { d: +d.toFixed(3), at: [p.x, p.y, p.z].map((x) => +x.toFixed(3)) };
  };
  const f = [0, 0];
  const railIn = s.W / 2 + 0.01;
  const pts: number[] = [];
  const head: THREE.Vector3[] = [];
  // the back's lowest skin (as on the flat bed: along the bed, over the mattress) at the sacrum and at the shoulder blades
  const backLow = { u: 0, h: 9 };
  const backUp = { u: 0, h: 9 };
  // how far the feet reach toward the bed's foot end (bed frame z)
  let feet = -9;
  skinned(root, 2, (w, mat, b) => {
    const p = rig.toBed(w);
    if (mat === 'head') head.push(p.clone());
    if (mat === 'body') pts.push(p.x, p.y, p.z);
    if (/Foot|Toe/.test(b)) feet = Math.max(feet, p.z);
    bend.unmap(p.y, p.z, f);
    if (mat === 'body' && Math.abs(p.x) < 0.12) {
      const zone = /^(Pelvis|Spine)$/.test(b) ? backLow : /^(Spine2|Spine3|Neck)$/.test(b) ? backUp : null;
      if (zone && f[0] - s.top < zone.h) {
        zone.h = f[0] - s.top;
        zone.u = f[1];
      }
    }
    const what = `${mat}:${b}`;
    if (Math.abs(p.x) < s.hw - 0.01 && Math.abs(f[1]) < s.zFoot - 0.01) note('mattress', f[0] - s.top, what, p);
    const rails: [number, number, number][] = [[-0.87, 0.03, 0.9]];
    if (rig.kind === 'bed') rails.push([0.21, 0.83, 0.86]);
    for (const [z0, z1, top] of rails) if (p.z > z0 && p.z < z1 && p.y > 0.66 && p.y < top && Math.abs(p.x) > railIn) note('rails', railIn - Math.abs(p.x), what, p);
    // a bed's head- and footboard; a stretcher's push handle at the foot (its bar 0.5–0.94 m up)
    const boardIn = s.L / 2 - 0.01;
    if (rig.kind === 'bed' && Math.abs(p.x) < s.W / 2 && p.y > 0.44 && p.y < (p.z > 0 ? 0.8 : 1.02) && Math.abs(p.z) > boardIn) note('boards', boardIn - Math.abs(p.z), what, p);
    if (rig.kind === 'stretcher' && Math.abs(p.x) < s.W / 2 && p.y > 0.49 && p.y < 0.94 && p.z > s.L / 2) note('boards', s.L / 2 - p.z, what, p);
  });
  const worst = (k: 'mattress' | 'rails' | 'boards') => Object.values(into[k]).reduce((a, x) => Math.min(a, x.d), 0);
  const top3 = (k: 'mattress' | 'rails' | 'boards') => Object.fromEntries(Object.entries(into[k]).sort((a, b) => a[1].d - b[1].d).slice(0, 4));
  // the blanket over the skin, as on the flat bed: its highest layer over each 1.5 cm cell
  let gap: { least: number; at: number[]; cells: number } | null = null;
  if (blanket && blanket.groups.length) {
    const H = 0.015;
    const nx = Math.ceil((2 * s.hw) / H) + 1;
    const z0 = -s.zFoot;
    const nz = Math.ceil((2 * s.zFoot) / H) + 1;
    const top = new Float32Array(nx * nz).fill(-9);
    const toFlat = (k: number, out: THREE.Vector3) => {
      const p = rig.toBed(root.localToWorld(out.set(blanket.pos[k * 3], blanket.pos[k * 3 + 1], blanket.pos[k * 3 + 2])), out);
      bend.unmap(p.y, p.z, f);
      return out.set(p.x, f[0], f[1]);
    };
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const C = new THREE.Vector3();
    const g0 = blanket.groups[0];
    let uMin = 9;
    for (let t = g0.start; t < g0.start + g0.count; t += 3) {
      toFlat(blanket.index[t], A);
      toFlat(blanket.index[t + 1], B);
      toFlat(blanket.index[t + 2], C);
      uMin = Math.min(uMin, A.z, B.z, C.z);
      const det = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
      if (Math.abs(det) < 1e-10) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(A.x, B.x, C.x) + s.hw) / H));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(A.x, B.x, C.x) + s.hw) / H));
      const j0 = Math.max(0, Math.ceil((Math.min(A.z, B.z, C.z) - z0) / H));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(A.z, B.z, C.z) - z0) / H));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = -s.hw + i * H;
          const z = z0 + j * H;
          const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / det;
          const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * A.y + l2 * B.y + l3 * C.y;
          if (y > top[j * nx + i]) top[j * nx + i] = y;
        }
    }
    // the body under it: over the mattress's flat top, from 20 cm below the turn-down to the foot end
    gap = { least: 1, at: [], cells: 0 };
    for (let k = 0; k < pts.length; k += 3) {
      bend.unmap(pts[k + 1], pts[k + 2], f);
      const [x, y, z] = [pts[k], f[0], f[1]];
      if (Math.abs(x) > s.hw - s.r - 0.02 || z < uMin + 0.2 || z > s.zFoot - s.r || y < s.top + 0.02) continue;
      const c = top[Math.round((z - z0) / H) * nx + Math.round((x + s.hw) / H)];
      if (c < -1) continue;
      gap.cells++;
      if (c - y < gap.least) {
        gap.least = +(c - y).toFixed(4);
        gap.at = [pts[k], pts[k + 1], pts[k + 2]].map((v) => +v.toFixed(3));
      }
    }
  }
  // the face (the head's skin furthest along its facing: Rocketbox heads face +Y) and the sternum (the trunk's front)
  const hd = bone('Head');
  const hc = at('Head');
  let face: number[] | null = null;
  let faceGap: number | null = null;
  if (hd && hc && head.length) {
    // the head's own facing (Rocketbox heads: +Y out of the face), in the bed's frame
    const fwd = rig.toBed(hd.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0).applyQuaternion(hd.getWorldQuaternion(new THREE.Quaternion())))).sub(hc).normalize();
    const own = head.filter((p) => p.distanceTo(hc) < 0.16);
    let best = -9;
    for (const p of own) best = Math.max(best, p.clone().sub(hc).dot(fwd));
    const front = own.filter((p) => p.clone().sub(hc).dot(fwd) > best - 0.03);
    if (front.length) face = rig.toWorld(front.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / front.length)).toArray().map((v) => +v.toFixed(3));
    // the gaze's aim against the face's skin (the front half of the head): the nearest point of it
    if (aims?.face) {
      const a = rig.toBed(new THREE.Vector3(...aims.face));
      faceGap = Infinity;
      for (const p of own) if (p.clone().sub(hc).dot(fwd) > 0.02) faceGap = Math.min(faceGap, p.distanceTo(a));
    }
  }
  const sp = at('Spine2');
  let chest: number[] | null = null;
  if (sp) {
    // the sternum: the skin straight out in front of the chest's bone (within 2.5 cm of that line)
    const up = neck.clone().sub(hip).normalize();
    const out = new THREE.Vector3(1, 0, 0).cross(up).normalize();
    let best = -9;
    let at2: THREE.Vector3 | null = null;
    for (let k = 0; k < pts.length; k += 3) {
      const p = new THREE.Vector3(pts[k], pts[k + 1], pts[k + 2]);
      const d = p.clone().sub(sp);
      const along = d.dot(out);
      if (along <= 0 || d.addScaledVector(out, -along).length() > 0.025) continue;
      if (along > best) {
        best = along;
        at2 = p;
      }
    }
    if (at2) chest = rig.toWorld(at2).toArray().map((v) => +v.toFixed(3));
  }
  // the back's line (sacrum to shoulder blades) against the backrest: the trunk's own angle on the bed
  const lean = Math.atan2(backUp.h - backLow.h, Math.max(0.05, backLow.u - backUp.u));
  return {
    bed: rig.id,
    headDeg: deg(bend.head),
    goalDeg: +rig.goalDeg.toFixed(2),
    moving: rig.moving,
    trunkRise: deg(rise),
    trunkTilt: deg(rise - own),
    /** the back's lowest skin at the sacrum and at the shoulder blades (u along the flat bed, h over the mattress), and the line's angle to the bed's floor */
    back: { low: { u: +backLow.u.toFixed(3), h: +backLow.h.toFixed(3) }, up: { u: +backUp.u.toFixed(3), h: +backUp.h.toFixed(3) }, trunkDeg: deg(bend.head + lean) },
    aims: { face: faceGap === null ? null : +faceGap.toFixed(3), chest: aims?.chest && chest ? +Math.hypot(aims.chest[0] - chest[0], aims.chest[1] - chest[1], aims.chest[2] - chest[2]).toFixed(3) : null },
    hip: hipR,
    into: { mattress: worst('mattress'), rails: worst('rails'), boards: worst('boards'), deepest: { mattress: top3('mattress'), rails: top3('rails'), boards: top3('boards') } },
    blanket: gap,
    face,
    chest,
    /** the feet's farthest skin past the mattress's foot end (m; ≤ 0: on it) */
    feetPastEnd: +(feet - s.zFoot).toFixed(3),
    legPillow: rig.legPillowAt(),
    /** the legs' joints (bed frame: knee, ankle, toes) */
    legs: ['L', 'R'].map((s) => ['Calf', 'Foot', 'Toe0'].map((n) => at(`${s}_${n}`)?.toArray().map((v) => +v.toFixed(3)) ?? null)),
  };
}

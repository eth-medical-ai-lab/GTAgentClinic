/**
 * Fast raycasts against the world's big meshes.
 *
 * The static world is merged by material (builder.ts, vehicles.ts and others): a few hundred meshes,
 * about 2 M triangles, most of them spanning the whole building. three's Mesh.raycast culls by
 * bounding sphere and then tests every triangle, so one ray into the world cost 60–90 ms, and putting
 * a thing down with G (itemSystem.ts: up to 180 straight-down probes for a free spot on a table)
 * froze the game for seconds. Here such a mesh gets a grid of its triangles over x–z, built on its
 * first raycast (and again if its vertices change), and a ray tests only the triangles in the cells it
 * crosses. The hits are three's: same side culling, near/far, point, distance and face normal.
 */
import * as THREE from 'three';

/** three's own raycast is cheap enough for a mesh under this many triangles, or one this small (m) */
const MIN_TRIS = 128;
const MIN_RADIUS = 2;
/** cell size (m), coarser when the grid would pass MAX_CELLS (or MAX_SIDE cells along one side) */
const CELL = 1;
const MAX_CELLS = 1 << 16;
const MAX_SIDE = 1024;
/** triangles go into every cell their x–z box touches, widened by this much (float safety) */
const EPS = 1e-3;

interface Grid {
  pos: number;
  index: number;
  minX: number;
  minZ: number;
  cell: number;
  nx: number;
  nz: number;
  /** triangles of cell c: tris[start[c] .. start[c + 1]) */
  start: Uint32Array;
  tris: Uint32Array;
}

const grids = new WeakMap<THREE.BufferGeometry, Grid>();

/** give every big mesh under root the grid raycast (once each; cheap to call again for meshes added since) */
export function accelerateRaycasts(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (eligible(m)) m.raycast = gridRaycast;
  });
}

/**
 * Build the grids under root ahead of time, a few milliseconds at a time, so the first thing put
 * down doesn't wait for them. Returns a cancel.
 */
export function warmRaycastGrids(root: THREE.Object3D): () => void {
  accelerateRaycasts(root);
  const todo = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.raycast === gridRaycast) todo.add(m.geometry);
  });
  const queue = [...todo];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 4) gridOf(queue.pop()!);
    timer = queue.length ? setTimeout(step, 30) : undefined;
  };
  timer = setTimeout(step, 1000);
  return () => clearTimeout(timer);
}

/** a plain triangle mesh (no skinning, instances, morphs, groups or draw range: three keeps those), big and wide */
function eligible(m: THREE.Mesh): boolean {
  const o = m as THREE.Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (!m.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || Array.isArray(m.material)) return false;
  if (m.raycast !== THREE.Mesh.prototype.raycast) return false;
  const g = m.geometry;
  if (!g.attributes.position || g.groups.length || g.morphAttributes.position || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (triCount(g) < MIN_TRIS) return false;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g.boundingSphere!.radius * m.matrixWorld.getMaxScaleOnAxis() >= MIN_RADIUS;
}

function triCount(g: THREE.BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
}

/** vertex index of corner k (0–2) of triangle f */
const corner = (index: THREE.BufferAttribute | null, f: number, k: number) => (index ? index.getX(f * 3 + k) : f * 3 + k);

function gridOf(g: THREE.BufferGeometry): Grid {
  // (rebuilt when the vertices change: curtains and blankets move theirs)
  const pos = g.attributes.position;
  const ver = (pos as THREE.BufferAttribute).version ?? 0;
  const iver = g.index?.version ?? -1;
  const have = grids.get(g);
  if (have && have.pos === ver && have.index === iver) return have;
  const grid = buildGrid(g);
  grid.pos = ver;
  grid.index = iver;
  grids.set(g, grid);
  return grid;
}

/** x and z of every vertex (x0, z0, x1, z1, …), straight from the array when it is plain floats */
function vertsXZ(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(pos.count * 2);
  const plain = !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3;
  const a = pos.array;
  for (let v = 0; v < pos.count; v++) {
    out[v * 2] = plain ? a[v * 3] : pos.getX(v);
    out[v * 2 + 1] = plain ? a[v * 3 + 2] : pos.getZ(v);
  }
  return out;
}

/** the triangles of g binned over x–z (in the geometry's own space) */
export function buildGrid(g: THREE.BufferGeometry): Grid {
  const xz = vertsXZ(g.attributes.position);
  // (its own bounds, not geometry.boundingBox, which may predate a change to the vertices)
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < xz.length; v += 2) {
    const x = xz[v], z = xz[v + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(minX <= maxX && minZ <= maxZ)) minX = maxX = minZ = maxZ = 0;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cell = Math.max(CELL, Math.sqrt((w * d) / MAX_CELLS), w / MAX_SIDE, d / MAX_SIDE);
  const nx = Math.max(1, Math.ceil(w / cell));
  const nz = Math.max(1, Math.ceil(d / cell));
  const idx = g.index?.array;
  const T = triCount(g);
  const ci = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const ck = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / cell)));
  // the cell range of each triangle, kept for the fill pass
  const range = new Uint16Array(T * 4);
  const count = new Uint32Array(nx * nz);
  for (let f = 0; f < T; f++) {
    const a = (idx ? idx[f * 3] : f * 3) * 2;
    const b = (idx ? idx[f * 3 + 1] : f * 3 + 1) * 2;
    const c = (idx ? idx[f * 3 + 2] : f * 3 + 2) * 2;
    const i0 = ci(Math.min(xz[a], xz[b], xz[c]) - EPS), i1 = ci(Math.max(xz[a], xz[b], xz[c]) + EPS);
    const k0 = ck(Math.min(xz[a + 1], xz[b + 1], xz[c + 1]) - EPS), k1 = ck(Math.max(xz[a + 1], xz[b + 1], xz[c + 1]) + EPS);
    range[f * 4] = i0;
    range[f * 4 + 1] = i1;
    range[f * 4 + 2] = k0;
    range[f * 4 + 3] = k1;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) count[k * nx + i]++;
  }
  const start = new Uint32Array(nx * nz + 1);
  for (let c = 0; c < nx * nz; c++) start[c + 1] = start[c] + count[c];
  const fill = start.slice(0, nx * nz);
  const tris = new Uint32Array(start[nx * nz]);
  for (let f = 0; f < T; f++) {
    const i0 = range[f * 4], i1 = range[f * 4 + 1], k0 = range[f * 4 + 2], k1 = range[f * 4 + 3];
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) tris[fill[k * nx + i]++] = f;
  }
  return { pos: 0, index: 0, minX, minZ, cell, nx, nz, start, tris };
}

const _inv = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _end = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Mesh.raycast for a gridded mesh (this = the mesh): the same hits as three's, from fewer triangles */
function gridRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, out: THREE.Intersection[]) {
  const geo = this.geometry;
  const mat = this.material as THREE.Material | undefined;
  if (!mat) return;
  // the bounding sphere first, as three does
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  _sphere.copy(geo.boundingSphere!).applyMatrix4(this.matrixWorld);
  _ray.copy(raycaster.ray).recast(raycaster.near);
  if (!_sphere.containsPoint(_ray.origin)) {
    if (_ray.intersectSphere(_sphere, _p) === null) return;
    if (_ray.origin.distanceToSquared(_p) > (raycaster.far - raycaster.near) ** 2) return;
  }
  // the ray in the geometry's space, and how far along it `far` reaches there
  _inv.copy(this.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  let tEnd = Infinity;
  if (Number.isFinite(raycaster.far)) tEnd = _ray.origin.distanceTo(_end.copy(raycaster.ray.direction).multiplyScalar(raycaster.far).add(raycaster.ray.origin).applyMatrix4(_inv));
  const grid = gridOf(geo);
  const index = geo.index;
  const pos = geo.attributes.position;
  const side = mat.side;
  const seen = new Set<number>();
  const test = (f: number) => {
    const ia = corner(index, f, 0), ib = corner(index, f, 1), ic = corner(index, f, 2);
    _a.fromBufferAttribute(pos, ia);
    _b.fromBufferAttribute(pos, ib);
    _c.fromBufferAttribute(pos, ic);
    const hit = side === THREE.BackSide ? _ray.intersectTriangle(_c, _b, _a, true, _p) : _ray.intersectTriangle(_a, _b, _c, side === THREE.FrontSide, _p);
    if (!hit) return;
    _w.copy(_p).applyMatrix4(this.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(_w);
    if (distance < raycaster.near || distance > raycaster.far || seen.has(f)) return;
    seen.add(f);
    const normal = THREE.Triangle.getNormal(_a, _b, _c, new THREE.Vector3());
    out.push({ distance, point: _w.clone(), object: this, face: { a: ia, b: ib, c: ic, normal, materialIndex: 0 }, faceIndex: f });
  };
  walk(grid, _ray, tEnd, (c) => {
    for (let j = grid.start[c]; j < grid.start[c + 1]; j++) test(grid.tris[j]);
  });
}

/** visit (in order) every cell the ray crosses over x–z for t in [0, tEnd] */
export function walk(grid: Grid, ray: THREE.Ray, tEnd: number, visit: (cell: number) => void) {
  const { minX, minZ, cell, nx, nz } = grid;
  const maxX = minX + nx * cell;
  const maxZ = minZ + nz * cell;
  const ox = ray.origin.x, oz = ray.origin.z, dx = ray.direction.x, dz = ray.direction.z;
  // clip the ray to the grid's x–z box (slab test)
  let t0 = 0;
  let t1 = tEnd;
  for (const [o, dd, lo, hi] of [[ox, dx, minX, maxX], [oz, dz, minZ, maxZ]]) {
    if (dd === 0) {
      if (o < lo - EPS || o > hi + EPS) return;
      continue;
    }
    let ta = (lo - o) / dd;
    let tb = (hi - o) / dd;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return;
  // step cell to cell (Amanatides & Woo); a straight-down ray stays in one cell
  const clampI = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  let i = clampI((ox + dx * t0 - minX) / cell, nx);
  let k = clampI((oz + dz * t0 - minZ) / cell, nz);
  const si = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sk = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  let tx = si > 0 ? (minX + (i + 1) * cell - ox) / dx : si < 0 ? (minX + i * cell - ox) / dx : Infinity;
  let tz = sk > 0 ? (minZ + (k + 1) * cell - oz) / dz : sk < 0 ? (minZ + k * cell - oz) / dz : Infinity;
  const ddx = si ? cell / Math.abs(dx) : Infinity;
  const ddz = sk ? cell / Math.abs(dz) : Infinity;
  for (;;) {
    visit(k * nx + i);
    const next = Math.min(tx, tz);
    if (!(next <= t1) || next === Infinity) return;
    if (tx < tz) {
      i += si;
      tx += ddx;
      if (i < 0 || i >= nx) return;
    } else {
      k += sk;
      tz += ddz;
      if (k < 0 || k >= nz) return;
    }
  }
}

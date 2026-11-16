#!/usr/bin/env node
/**
 * Fits the surgical mask (client/src/world/accessories.ts, MASK_DRAPE) to real Rocketbox faces.
 *
 *   node scripts/assets/mask-fit.mjs [Male_Adult_13 Male_Adult_14 …]
 *
 * It reads each character's GLB from client/public/res/chars and puts every vertex skinned to the head
 * bone or its children (facial bones, eyes) into the head bone's frame in the bind pose, using the
 * skin's inverse bind matrix. Units are cm. The frame is the one accessories.ts calls "natural":
 * x = wearer's left, y = up, z = forward.
 *
 * Then it drapes a sheet over the upper envelope of all the faces:
 * 1. Dilate the envelope (fabric can't follow narrow dips).
 * 2. Lift it by the clearance.
 * 3. Relax it: alternate blurring and taking the max with the lifted envelope. The sheet rests on the
 *    nose tip and chin and spans the lips and philtrum without dipping into them.
 *
 * Prints the 1 cm table pasted into accessories.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['Male_Adult_04', 'Male_Adult_05', 'Male_Adult_09', 'Male_Adult_12', 'Male_Adult_13', 'Male_Adult_14'];
const CLEAR = 0.35; // cm between skin and fabric
const DILATE = 0.9; // cm
const X0 = -8, X1 = 8, Y0 = -3, Y1 = 11, STEP = 0.25;

function glb(file) {
  const b = readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8')), bin: b.subarray(20 + jsonLen + 8) };
}
const COMP = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(g, ai) {
  const a = g.json.accessors[ai];
  const bv = g.json.bufferViews[a.bufferView];
  const [size, fn] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const norm = a.normalized ? (size === 1 ? 255 : 65535) : 1;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: n }, (_, k) => g.bin[fn](base + i * stride + k * size) / norm));
}
const mul = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

function facePoints(id) {
  const g = glb(path.join(ROOT, 'client/public/res/chars', `${id}.glb`));
  const nodes = g.json.nodes;
  const skin = g.json.skins[0];
  const head = skin.joints.find((j) => /Head$/i.test(nodes[j].name ?? ''));
  const ibm = read(g, skin.inverseBindMatrices)[skin.joints.indexOf(head)];
  const under = new Set([head]);
  const stack = [head];
  while (stack.length) for (const c of nodes[stack.pop()].children ?? []) if (!under.has(c)) (under.add(c), stack.push(c));
  const headJ = new Set(skin.joints.map((j, i) => (under.has(j) ? i : -1)).filter((i) => i >= 0));
  const pts = [];
  for (const mesh of g.json.meshes)
    for (const prim of mesh.primitives) {
      if (prim.attributes.JOINTS_0 === undefined) continue;
      const P = read(g, prim.attributes.POSITION), J = read(g, prim.attributes.JOINTS_0), W = read(g, prim.attributes.WEIGHTS_0);
      for (let i = 0; i < P.length; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (headJ.has(J[i][k])) w += W[i][k];
        if (w < 0.5) continue;
        const l = mul(ibm, P[i]);
        pts.push([l[2], l[0], l[1]]); // natural frame: left, up, forward (cm)
      }
    }
  return pts;
}

const nx = Math.round((X1 - X0) / STEP) + 1, ny = Math.round((Y1 - Y0) / STEP) + 1;
const env = new Float32Array(nx * ny).fill(-Infinity);
for (const id of ids) {
  for (const [x, y, z] of facePoints(id)) {
    if (z < 0) continue; // inside the mouth, the back of the head
    const i0 = Math.max(0, Math.floor((x - DILATE - X0) / STEP)), i1 = Math.min(nx - 1, Math.ceil((x + DILATE - X0) / STEP));
    const j0 = Math.max(0, Math.floor((y - DILATE - Y0) / STEP)), j1 = Math.min(ny - 1, Math.ceil((y + DILATE - Y0) / STEP));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = X0 + i * STEP - x, dy = Y0 + j * STEP - y;
        if (dx * dx + dy * dy <= DILATE * DILATE) env[j * nx + i] = Math.max(env[j * nx + i], z);
      }
  }
}
// cells with no face nearby (under the jaw, beside the cheeks): continue the slope outward
for (let pass = 0; pass < 40; pass++)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (env[j * nx + i] > -Infinity) continue;
      const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < nx && b < ny).map(([a, b]) => env[b * nx + a]).filter((v) => v > -Infinity);
      if (nb.length) env[j * nx + i] = Math.max(...nb) - 0.6 * STEP * 4;
    }
const floor = env.map((v) => v + CLEAR);
// The fabric behaves differently by direction:
// - Vertically, near the middle, it's a taut string over the profile (upper concave hull of (y, z)):
//   it tents from the nose bridge over the nose tip and runs straight to the chin, spanning the lips.
// - Toward the sides, the ear loops pull it onto the cheeks, so it follows the (lifted) face.
const hullCol = (i) => {
  const pts = [];
  for (let j = 0; j < ny; j++) pts.push([Y0 + j * STEP, floor[j * nx + i]]);
  const h = [];
  for (const p of pts) {
    while (h.length >= 2) {
      const [o, a] = [h[h.length - 2], h[h.length - 1]];
      if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) >= 0) h.pop();
      else break;
    }
    h.push(p);
  }
  const out = new Float32Array(ny);
  let k = 0;
  for (let j = 0; j < ny; j++) {
    const y = Y0 + j * STEP;
    while (k < h.length - 2 && h[k + 1][0] < y) k++;
    const [a, b] = [h[k], h[k + 1] ?? h[k]];
    out[j] = b[0] === a[0] ? a[1] : a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]);
  }
  return out;
};
const smoothstep = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
let sheet = new Float32Array(floor.length);
for (let i = 0; i < nx; i++) {
  const hull = hullCol(i);
  const w = 1 - smoothstep(1.5, 5.0, Math.abs(X0 + i * STEP));
  for (let j = 0; j < ny; j++) sheet[j * nx + i] = Math.max(floor[j * nx + i], w * hull[j] + (1 - w) * floor[j * nx + i]);
}
// a light relax so the blend has no creases; never below the lifted face
for (let it = 0; it < 4; it++) {
  const b = new Float32Array(sheet.length);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di, c = j + dj;
          if (a < 0 || c < 0 || a >= nx || c >= ny) continue;
          s += sheet[c * nx + a];
          n++;
        }
      b[j * nx + i] = Math.max(s / n, floor[j * nx + i]);
    }
  sheet = b;
}
const at = (x, y) => sheet[Math.round((y - Y0) / STEP) * nx + Math.round((x - X0) / STEP)];
const rows = [];
for (let y = Y1; y >= Y0; y--) rows.push(`  [${Array.from({ length: X1 - X0 + 1 }, (_, k) => at(X0 + k, y).toFixed(1)).join(', ')}], // y ${y}`);
console.log(`// mask drape, cm forward of the head bone: rows y = ${Y1}…${Y0} (up), columns x = ${X0}…${X1} (left); heads: ${ids.join(', ')}`);
console.log(`const MASK_DRAPE: number[][] = [\n${rows.join('\n')}\n];`);

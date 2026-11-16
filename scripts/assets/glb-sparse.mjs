/**
 * Re-encodes the morph targets of a GLB as glTF sparse accessors (Node, no dependencies).
 *
 * The Rocketbox facial blendshapes (lip-sync visemes, blinks, brows) move only the face, yet the
 * exporter stores every target densely for every vertex of the avatar: ~1.3 MB of a ~2 MB file.
 * About 60 % of those deltas are exactly zero and most of the rest are float noise from the FBX
 * (< 1 µm). Keeping only the deltas larger than `eps` (in the mesh's own units: centimetres for
 * these avatars, so 1e-3 = 10 µm) and storing them sparsely shrinks an avatar to ~45 % of its size.
 * three.js's GLTFLoader expands sparse accessors on load, so the runtime sees the same dense
 * morph attributes as before. Everything else in the file is copied byte for byte.
 */

const ALIGN = 4;
const pad = (n) => (n + ALIGN - 1) & ~(ALIGN - 1);

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binHeader = 20 + jsonLen;
  const bin = binHeader + 8 <= buf.length ? buf.subarray(binHeader + 8, binHeader + 8 + buf.readUInt32LE(binHeader)) : Buffer.alloc(0);
  return { json, bin };
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc(pad(bin.length) - bin.length)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonPadded.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPadded.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, jsonPadded, bh, binPadded]);
}

/**
 * @param {Buffer} glb
 * @param {{ eps?: number }} [opts]
 * @returns {{ glb: Buffer, before: number, after: number, kept: number, total: number }}
 */
export function sparsifyMorphs(glb, opts = {}) {
  const eps = opts.eps ?? 1e-3;
  const { json, bin } = parseGlb(glb);
  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];
  // morph-target accessors (any attribute of any target)
  const targets = new Set();
  for (const m of json.meshes ?? []) for (const p of m.primitives) for (const t of p.targets ?? []) for (const a of Object.values(t)) targets.add(a);

  // the new binary: every bufferView we keep, then the sparse data
  const chunks = [];
  let at = 0;
  const newViews = [];
  const viewMap = new Map();
  const push = (data, extra = {}) => {
    const off = at;
    chunks.push(data);
    at += data.length;
    const p = pad(at) - at;
    if (p) {
      chunks.push(Buffer.alloc(p));
      at += p;
    }
    newViews.push({ buffer: 0, byteOffset: off, byteLength: data.length, ...extra });
    return newViews.length - 1;
  };
  const used = new Set();
  accessors.forEach((a, i) => {
    if (a.bufferView !== undefined && !targets.has(i)) used.add(a.bufferView);
    if (a.sparse) {
      used.add(a.sparse.indices.bufferView);
      used.add(a.sparse.values.bufferView);
    }
  });
  for (const im of json.images ?? []) if (im.bufferView !== undefined) used.add(im.bufferView);
  views.forEach((v, i) => {
    if (!used.has(i)) return;
    const { byteOffset = 0, byteLength, ...rest } = v;
    viewMap.set(i, push(Buffer.from(bin.subarray(byteOffset, byteOffset + byteLength)), rest));
  });
  const remap = (i) => {
    const n = viewMap.get(i);
    if (n === undefined) throw new Error(`bufferView ${i} dropped while still in use`);
    return n;
  };
  for (const a of accessors) {
    if (a.sparse) {
      a.sparse.indices.bufferView = remap(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = remap(a.sparse.values.bufferView);
    }
  }
  for (const im of json.images ?? []) if (im.bufferView !== undefined) im.bufferView = remap(im.bufferView);

  let before = 0;
  let after = 0;
  let kept = 0;
  let total = 0;
  accessors.forEach((a, i) => {
    if (!targets.has(i)) {
      if (a.bufferView !== undefined) a.bufferView = remap(a.bufferView);
      return;
    }
    if (a.bufferView === undefined || a.componentType !== 5126 || a.sparse) {
      // already sparse / not float: keep as is
      if (a.bufferView !== undefined) {
        const v = views[a.bufferView];
        if (!viewMap.has(a.bufferView)) viewMap.set(a.bufferView, push(Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))));
        a.bufferView = remap(a.bufferView);
      }
      return;
    }
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const v = views[a.bufferView];
    const stride = v.byteStride ?? size * 4;
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const idx = [];
    const vals = [];
    const min = new Array(size).fill(Infinity);
    const max = new Array(size).fill(-Infinity);
    for (let k = 0; k < a.count; k++) {
      const off = base + k * stride;
      const comp = [];
      let big = 0;
      for (let c = 0; c < size; c++) {
        const x = bin.readFloatLE(off + c * 4);
        comp.push(x);
        big = Math.max(big, Math.abs(x));
      }
      if (big > eps) {
        idx.push(k);
        vals.push(...comp);
        for (let c = 0; c < size; c++) {
          min[c] = Math.min(min[c], comp[c]);
          max[c] = Math.max(max[c], comp[c]);
        }
      }
    }
    // the vertices left out are exactly zero
    if (idx.length < a.count) for (let c = 0; c < size; c++) (min[c] = Math.min(min[c], 0)), (max[c] = Math.max(max[c], 0));
    before += a.count * size * 4;
    total += a.count;
    kept += idx.length;
    delete a.bufferView;
    delete a.byteOffset;
    // a target that moves nothing needs no data at all (zeros by definition)
    if (idx.length) {
      const big = a.count > 65535;
      const ib = Buffer.alloc(idx.length * (big ? 4 : 2));
      idx.forEach((n, k) => (big ? ib.writeUInt32LE(n, k * 4) : ib.writeUInt16LE(n, k * 2)));
      const vb = Buffer.alloc(vals.length * 4);
      vals.forEach((x, k) => vb.writeFloatLE(x, k * 4));
      a.sparse = { count: idx.length, indices: { bufferView: push(ib), componentType: big ? 5125 : 5123 }, values: { bufferView: push(vb) } };
      after += ib.length + vb.length;
    } else delete a.sparse;
    if (a.min) a.min = min;
    if (a.max) a.max = max;
  });
  json.bufferViews = newViews;
  const newBin = Buffer.concat(chunks);
  if (json.buffers?.[0]) json.buffers[0].byteLength = newBin.length;
  return { glb: writeGlb(json, newBin), before, after, kept, total };
}

/**
 * What a hand wash leaves on the skin, and where a hand is, for both bodies hand hygiene drives:
 * the first-person hands (fpHands.ts) and the avatar's own hands in third person (here).
 *
 *   lather   a foam layer on the skin, per region (palm, back, fingers, thumb, fingertips): it grows
 *            over the surfaces each WHO step rubs and washes off where the water runs. The foam is a
 *            noise in the texture's alpha cut at 1 − coverage, so patches spread rather than fade in.
 *   wet      the skin turns glossy and a little darker, and dries off.
 *   points   where the palm, its heel, the back of the wrist and the fingertips are, world: hands are
 *            placed so that one of these touches the real fixture (a nozzle, a lever, a towel's tail).
 *   shape    the hand as a box (the palm) and capsules (fingers, thumb): what the falling water hits.
 *
 * Third person: the layers are cut from the avatar's own skin. Triangles of the body mesh weighted to
 * a hand's bones are copied into skinned meshes of their own, bound to the same skeleton: a foam layer
 * per region (pushed out ~2 mm along the normals) and a wet copy (the body's own texture, glossier and
 * darker, ~0.4 mm out), so both follow every finger exactly.
 */
import * as THREE from 'three';
import type { HandSide } from './hands';

export type LatherRegion = 'palm' | 'back' | 'fingers' | 'thumb' | 'tips';
export const REGIONS: LatherRegion[] = ['palm', 'back', 'fingers', 'thumb', 'tips'];
/** how much of a hand's skin each region is (for a hand's overall coverage) */
export const REGION_AREA: Record<LatherRegion, number> = {
  palm: 0.24,
  back: 0.24,
  fingers: 0.32,
  thumb: 0.1,
  tips: 0.1,
};

export type HandPoint = 'wrist' | 'palm' | 'heel' | 'back' | 'wristBack' | 'wristVolar' | 'tipIndex' | 'tipMiddle' | 'tipRing' | 'tipLittle' | 'tipThumb' | 'pinch';

/** a hand's solid shape now (world): the palm as a box, fingers and thumb as capsules */
export interface HandShape {
  palm: {
    c: THREE.Vector3;
    x: THREE.Vector3;
    y: THREE.Vector3;
    z: THREE.Vector3;
    hx: number;
    hy: number;
    hz: number;
  };
  caps: {
    a: THREE.Vector3;
    b: THREE.Vector3;
    r: number;
    region: LatherRegion;
  }[];
}

/** a pair of hands hand hygiene can place, read and dress (first-person or the avatar's) */
export interface HandRig {
  /** the wrist (the hand bone's origin) and the hand's orientation, world; false when there's none */
  frame(side: HandSide, pos: THREE.Vector3, quat: THREE.Quaternion): boolean;
  point(side: HandSide, p: HandPoint, out: THREE.Vector3): THREE.Vector3;
  shape(side: HandSide): HandShape | null;
  setLather(side: HandSide, region: LatherRegion, c: number): void;
  setWet(side: HandSide, k: number): void;
  /** gloves on a hand (0 bare … 1 gloved to the cuff over the wrist; in between: the fingertips first) */
  setGloves(side: HandSide, k: number): void;
}

// ───────────────────────────── the foam ─────────────────────────────

let foamTex: THREE.DataTexture | null = null;

/**
 * Foam, tileable (5 cm of skin a tile): clusters of soap bubbles with skin between them, not a coat
 * of paint. Alpha says when a texel shows as the foam builds up (the layer is cut at the coverage by
 * alphaTest: setCoverage):
 *   - where it is: a smooth noise of patches, the thick ones first; bubbles crowd there and thin out
 *     between them, where the skin always shows through
 *   - a bubble's wall shows before its middle: a thin film is clear, so a bubble reads as a bright
 *     ring with the skin seen through it, and fills in white only where the lather is thick
 *   - the thickest patches close up into solid foam last
 * RGB: a cool white, each bubble's wall a little grey toward its edge, a highlight on it; the gaps
 * carry the foam's colour too, so mipmaps never darken the edges.
 */
export function foamTexture(): THREE.DataTexture {
  if (foamTex) return foamTex;
  const N = 256;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  // value noise on wrapped lattices (64, 32 and 16 px cells), smoothly interpolated
  const lattice = (cells: number) => {
    const v = new Float32Array(cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    return (x: number, y: number) => {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o1 = lattice(4);
  const o2 = lattice(8);
  const o3 = lattice(16);
  const o4 = lattice(32);
  const raw = new Float32Array(N * N);
  let lo = 1;
  let hi = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // (the finer octaves break up the patches' edges: foam, not spilt paint)
      const n = o1(x, y) * 0.42 + o2(x, y) * 0.28 + o3(x, y) * 0.2 + o4(x, y) * 0.1;
      raw[y * N + x] = n;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
  /** how thick the foam gets here (0..1): where it builds up first */
  const thick = (x: number, y: number) => (raw[(((Math.floor(y) % N) + N) % N) * N + (((Math.floor(x) % N) + N) % N)] - lo) / (hi - lo);
  const base: [number, number, number] = [0.92, 0.94, 0.95];
  const rgb = new Float32Array(N * N * 3);
  const alpha = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    rgb.set(base, i * 3);
    // the thickest patches: solid foam between the bubbles, last of all
    const n = (raw[i] - lo) / (hi - lo);
    alpha[i] = Math.max(0, (n - 0.66) / 0.34) * 0.45;
  }
  const put = (px: number, py: number, a: number, c: [number, number, number]) => {
    const k = (((py % N) + N) % N) * N + (((px % N) + N) % N);
    // (a bubble over another: its clear middle shows the one behind's wall through it)
    if (a < alpha[k]) return;
    alpha[k] = a;
    rgb.set(c, k * 3);
  };
  for (let i = 0; i < 3400; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const n = thick(x, y);
    // crowded where the foam is thick, a few small ones where it's thin
    if (rnd() > 0.06 + 0.94 * n ** 1.6) continue;
    const r = 1.1 + rnd() ** 2.4 * (2.5 + 6 * n);
    const grow = 0.24 + 0.76 * n;
    const solid = r < 2.3;
    for (let py = Math.floor(y - r - 1); py <= Math.ceil(y + r + 1); py++)
      for (let px = Math.floor(x - r - 1); px <= Math.ceil(x + r + 1); px++) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        const dd = Math.hypot(dx, dy) / r;
        if (dd > 1) continue;
        // the highlight, up and to the left of the middle; the wall greying toward its edge
        const hl = Math.hypot(dx / r + 0.38, dy / r + 0.38) < 0.2;
        if (hl) put(px, py, grow, [1, 1, 1]);
        else if (solid || dd > 0.66) {
          const g = 1 - 0.2 * Math.max(0, (dd - 0.75) / 0.25);
          put(px, py, grow, [0.97 * g, 0.98 * g, 0.99 * g]);
        } else put(px, py, grow * 0.42, [0.95, 0.965, 0.975]);
      }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(rgb[i * 3] * 255);
    data[i * 4 + 1] = Math.round(rgb[i * 3 + 1] * 255);
    data[i * 4 + 2] = Math.round(rgb[i * 3 + 2] * 255);
    data[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  foamTex = t;
  return t;
}

/** a texture's pixels (at most 512² of them) to read colours at UVs, or null if it can't be read */
export function texels(t: THREE.Texture): { w: number; h: number; d: Uint8ClampedArray; flipY: boolean } | null {
  const img = t.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  const s = Math.min(1, 512 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data, flipY: t.flipY };
  } catch {
    return null;
  }
}

/** a foam layer's material: nothing shows at coverage 0 (alphaTest > 1), all of it at 1 */
let gloveMat: THREE.MeshStandardMaterial | null = null;
/** blue nitrile (a little sheen): the gloves on either body's hands */
export function gloveMaterial(): THREE.MeshStandardMaterial {
  return (gloveMat ??= new THREE.MeshStandardMaterial({ color: '#4f86d4', roughness: 0.4, metalness: 0, emissive: '#1b3c6e', emissiveIntensity: 0.15 }));
}

/** how far a glove has to be on before it covers each region (it goes on from the fingertips) */
export const GLOVE_ORDER: Record<LatherRegion, number> = { tips: 0.15, fingers: 0.38, thumb: 0.45, palm: 0.65, back: 0.65 };

export function latherMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: foamTexture(),
    // (wet bubbles: sharp highlights)
    roughness: 0.3,
    metalness: 0,
    alphaTest: 1.01,
    emissive: '#d6dade',
    emissiveIntensity: 0.08,
  });
}

/**
 * coverage 0..1 → the material's cut (never 0: the cut-out shader stays the same). Fully lathered
 * still stops short of the texture's faintest texels: bubbles' clear middles where the foam is thin,
 * and the skin between them (foamTexture)
 */
export function setCoverage(mat: THREE.MeshStandardMaterial, c: number): void {
  mat.alphaTest = c <= 0.002 ? 1.01 : Math.max(0.2, 1 - c * 0.82);
}

// ───────────────────────────── third person: the avatar's hands ─────────────────────────────

interface TpHand {
  side: HandSide;
  hand: THREE.Object3D;
  /** index → little, three segments each */
  fingers: THREE.Object3D[][];
  /** metacarpal, proximal, distal */
  thumb: THREE.Object3D[];
  lather: Partial<Record<LatherRegion, { mesh: THREE.SkinnedMesh; mat: THREE.MeshStandardMaterial }>>;
  wet: {
    mesh: THREE.SkinnedMesh;
    mat: THREE.MeshStandardMaterial;
    rough: number;
    color: THREE.Color;
  } | null;
  /** a glove's layer per region, and its cuff (on the forearm, over the wrist) */
  gloves: Partial<Record<LatherRegion, THREE.SkinnedMesh>>;
  cuff: THREE.Object3D | null;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();

function boneBy(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

/**
 * The avatar's hands for hand hygiene in third person: its bones (points, shape) and layers on its
 * skin (lather, wet). Built once per avatar model; `ok` is false on a model without hand bones.
 */
export class TpHandLayers implements HandRig {
  readonly ok: boolean;
  private hands: Partial<Record<HandSide, TpHand>> = {};
  private meshes: THREE.Object3D[] = [];

  /** `model` the avatar's root; `k` its size against a 1.78 m adult */
  constructor(
    readonly model: THREE.Object3D,
    private k: number,
  ) {
    for (const side of ['R', 'L'] as HandSide[]) {
      const hand = boneBy(model, new RegExp(`_${side}_Hand$`));
      if (!hand) continue;
      const seg = (n: string) => [boneBy(model, new RegExp(`_${side}_${n}$`)), boneBy(model, new RegExp(`_${side}_${n}1$`)), boneBy(model, new RegExp(`_${side}_${n}2$`))];
      const fingers = ['Finger1', 'Finger2', 'Finger3', 'Finger4'].map(seg);
      const thumb = seg('Finger0');
      if (fingers.some((f) => f.some((b) => !b)) || thumb.some((b) => !b)) continue;
      this.hands[side] = {
        side,
        hand,
        fingers: fingers as THREE.Object3D[][],
        thumb: thumb as THREE.Object3D[],
        lather: {},
        wet: null,
        gloves: {},
        cuff: null,
      };
    }
    this.ok = !!this.hands.R && !!this.hands.L;
    if (this.ok) this.buildLayers();
  }

  /** cut the hands out of the body's skinned meshes: a foam layer per region and a wet copy per hand */
  private buildLayers() {
    const bodies: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !Array.isArray(m.material) && (m.material as THREE.Material).name === 'body') bodies.push(m);
    });
    for (const body of bodies) {
      const geo = body.geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
      const sw = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
      if (!pos || !nor || !si || !sw) continue;
      const bones = body.skeleton.bones;
      const idx = new Map(bones.map((b, i) => [b as THREE.Object3D, i]));
      // each bone index on a hand: its side and the region its triangles belong to (the hand bone: palm or back by the normal)
      const of = new Map<number, { side: HandSide; region: LatherRegion | 'hand' }>();
      for (const h of Object.values(this.hands)) {
        if (!h) continue;
        const put = (b: THREE.Object3D, region: LatherRegion | 'hand') => {
          const i = idx.get(b);
          if (i !== undefined) of.set(i, { side: h.side, region });
        };
        put(h.hand, 'hand');
        h.fingers.forEach((f) => f.forEach((b, j) => put(b, j === 2 ? 'tips' : 'fingers')));
        h.thumb.forEach((b) => put(b, 'thumb'));
      }
      if (!of.size) continue;
      // mesh units → metres, and each hand bone's frame at bind (palm side = +Y)
      body.updateMatrixWorld(true);
      // (the bind matrix's own inverse: in 'attached' mode three.js keeps bindMatrixInverse at the mesh's
      // current world matrix, not at the bind)
      const bindInv = body.bindMatrix.clone().invert();
      const unit = (() => {
        const h = this.hands.R!;
        const i0 = idx.get(h.hand);
        const i1 = idx.get(h.fingers[1][0]);
        if (i0 === undefined || i1 === undefined) return 0.01;
        const p0 = new THREE.Vector3().setFromMatrixPosition(_m.copy(body.skeleton.boneInverses[i0]).invert().premultiply(bindInv));
        const p1 = new THREE.Vector3().setFromMatrixPosition(_m.copy(body.skeleton.boneInverses[i1]).invert().premultiply(bindInv));
        const meshD = p0.distanceTo(p1);
        const worldD = h.hand.getWorldPosition(_a).distanceTo(h.fingers[1][0].getWorldPosition(_b));
        return meshD > 1e-6 ? worldD / meshD : 0.01;
      })();
      // (bone frames have units of their own: Rocketbox bones work in centimetres)
      const unitBone = (() => {
        const h = this.hands.R!;
        const local = h.fingers[1][0].position.length();
        const worldD = h.hand.getWorldPosition(_a).distanceTo(h.fingers[1][0].getWorldPosition(_b));
        return local > 1e-6 ? worldD / local : 0.01;
      })();
      const toBone: Partial<Record<HandSide, THREE.Matrix4>> = {};
      for (const side of ['R', 'L'] as HandSide[]) {
        const i = idx.get(this.hands[side]!.hand);
        if (i !== undefined) toBone[side] = new THREE.Matrix4().multiplyMatrices(body.skeleton.boneInverses[i], body.bindMatrix);
      }
      const buckets = new Map<string, number[]>();
      const tri = [0, 0, 0];
      const count = geo.index ? geo.index.count : pos.count;
      const vid = (k: number) => (geo.index ? geo.index.getX(k) : k);
      const weightOn = (v: number) => {
        const w: Record<HandSide, number> = { R: 0, L: 0 };
        let best = -1;
        let bw = 0;
        for (let c = 0; c < 4; c++) {
          const bi = si.getComponent(v, c);
          const wt = sw.getComponent(v, c);
          const o = of.get(bi);
          if (!o || wt <= 0) continue;
          w[o.side] += wt;
          if (wt > bw) {
            bw = wt;
            best = bi;
          }
        }
        return { w, best };
      };
      // the skin only: a coat's cuff hangs past the wrist, painted on the same mesh and held by the hand,
      // and wet or lathered (or gloved) it read as a strap round the wrist, the sleeve getting wet
      const px = (body.material as THREE.MeshStandardMaterial).map ? texels((body.material as THREE.MeshStandardMaterial).map!) : null;
      const cloth = () => {
        if (!px || !uv) return false;
        const u = (uv.getX(tri[0]) + uv.getX(tri[1]) + uv.getX(tri[2])) / 3;
        const v = (uv.getY(tri[0]) + uv.getY(tri[1]) + uv.getY(tri[2])) / 3;
        const x = Math.min(px.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * px.w)));
        const yy = (((v % 1) + 1) % 1) * px.h;
        const y = Math.min(px.h - 1, Math.max(0, Math.floor(px.flipY ? px.h - 1 - yy : yy)));
        const i = (y * px.w + x) * 4;
        // (skin and nails are warm, red over blue; a white, grey or coloured coat isn't)
        return px.d[i] - px.d[i + 2] < 10 || px.d[i] < px.d[i + 1] - 8;
      };
      for (let k = 0; k + 2 < count; k += 3) {
        tri[0] = vid(k);
        tri[1] = vid(k + 1);
        tri[2] = vid(k + 2);
        const ws = tri.map(weightOn);
        const side: HandSide | null = ws.every((x) => x.w.R >= 0.5) ? 'R' : ws.every((x) => x.w.L >= 0.5) ? 'L' : null;
        if (!side || cloth()) continue;
        // the region: the bone weighing most on the triangle's corners
        const tally = new Map<number, number>();
        for (const x of ws) if (x.best >= 0) tally.set(x.best, (tally.get(x.best) ?? 0) + 1);
        let bi = ws[0].best;
        let bc = 0;
        for (const [b, c] of tally)
          if (c > bc) {
            bc = c;
            bi = b;
          }
        let region = of.get(bi)?.region ?? 'fingers';
        if (region === 'hand') {
          _a.set(0, 0, 0);
          for (const v of tri) _a.add(_b.fromBufferAttribute(nor, v));
          _a.applyMatrix3(_n.setFromMatrix4(toBone[side]!)).normalize();
          region = _a.y >= 0 ? 'palm' : 'back';
        }
        const key = `${side}|${region}`;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(tri[0], tri[1], tri[2]);
        let all = buckets.get(`${side}|*`);
        if (!all) buckets.set(`${side}|*`, (all = []));
        all.push(tri[0], tri[1], tri[2]);
      }
      const tile = 0.05;
      const make = (verts: number[], push: number, side: HandSide, foamUv: boolean): THREE.BufferGeometry => {
        const n = verts.length;
        const P = new Float32Array(n * 3);
        const Nn = new Float32Array(n * 3);
        const U = new Float32Array(n * 2);
        const SI = new Float32Array(n * 4);
        const SW = new Float32Array(n * 4);
        const toB = toBone[side]!;
        verts.forEach((v, i) => {
          _b.fromBufferAttribute(nor, v).normalize();
          _a.fromBufferAttribute(pos, v).addScaledVector(_b, push / unit);
          P.set([_a.x, _a.y, _a.z], i * 3);
          Nn.set([_b.x, _b.y, _b.z], i * 3);
          if (foamUv) {
            // planar in the hand bone's frame: along the fingers and across the hand, a 5 cm tile
            _c.fromBufferAttribute(pos, v).applyMatrix4(toB).multiplyScalar(unitBone);
            U[i * 2] = (_c.x + 0.4 * _c.y) / tile;
            U[i * 2 + 1] = (_c.z - 0.3 * _c.y) / tile;
          } else if (uv) {
            U[i * 2] = uv.getX(v);
            U[i * 2 + 1] = uv.getY(v);
          }
          for (let c = 0; c < 4; c++) {
            SI[i * 4 + c] = si.getComponent(v, c);
            SW[i * 4 + c] = sw.getComponent(v, c);
          }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
        g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
        return g;
      };
      const mount = (g: THREE.BufferGeometry, mat: THREE.Material): THREE.SkinnedMesh => {
        const m = new THREE.SkinnedMesh(g, mat);
        m.bindMode = body.bindMode;
        m.bind(body.skeleton, body.bindMatrix);
        m.position.copy(body.position);
        m.quaternion.copy(body.quaternion);
        m.scale.copy(body.scale);
        m.frustumCulled = false;
        m.castShadow = false;
        m.receiveShadow = false;
        m.visible = false;
        body.parent?.add(m);
        this.meshes.push(m);
        return m;
      };
      for (const side of ['R', 'L'] as HandSide[]) {
        const h = this.hands[side]!;
        for (const region of REGIONS) {
          const verts = buckets.get(`${side}|${region}`);
          if (!verts?.length || h.lather[region]) continue;
          const mat = latherMaterial();
          h.lather[region] = {
            mesh: mount(make(verts, 0.0019, side, true), mat),
            mat,
          };
        }
        // the glove, 0.8 mm out (over the wet copy, under the foam)
        for (const region of REGIONS) {
          const verts = buckets.get(`${side}|${region}`);
          if (!verts?.length || h.gloves[region]) continue;
          h.gloves[region] = mount(make(verts, 0.0008, side, true), gloveMaterial());
        }
        const all = buckets.get(`${side}|*`);
        if (all?.length && !h.wet && uv) {
          const src = body.material as THREE.MeshStandardMaterial;
          const mat = src.clone();
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = -1;
          mat.polygonOffsetUnits = -1;
          h.wet = {
            mesh: mount(make(all, 0.0004, side, false), mat),
            mat,
            rough: src.roughness ?? 0.8,
            color: src.color.clone(),
          };
        }
      }
    }
  }

  frame(side: HandSide, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    const h = this.hands[side];
    if (!h) return false;
    h.hand.updateWorldMatrix(true, false);
    h.hand.getWorldPosition(pos);
    h.hand.getWorldQuaternion(quat);
    return true;
  }

  /** a bone's world position */
  private at(b: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  /** a fingertip: past the last bone by most of the middle segment's length, a little to its pad */
  private tip(chain: THREE.Object3D[], out: THREE.Vector3): THREE.Vector3 {
    const p1 = this.at(chain[1], _a);
    const p2 = this.at(chain[2], _b);
    const len = p1.distanceTo(p2) * 0.88;
    chain[2].getWorldQuaternion(_q);
    out.copy(p2).add(_c.set(1, 0, 0).applyQuaternion(_q).multiplyScalar(len));
    return out.add(
      _c
        .set(0, 1, 0)
        .applyQuaternion(_q)
        .multiplyScalar(0.003 * this.k),
    );
  }

  point(side: HandSide, p: HandPoint, out: THREE.Vector3): THREE.Vector3 {
    const h = this.hands[side];
    if (!h) return out.set(0, 0, 0);
    const k = this.k;
    const W = this.at(h.hand, new THREE.Vector3());
    h.hand.getWorldQuaternion(_q);
    const X = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    const Y = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    const knuckles = () => {
      const c = new THREE.Vector3();
      for (const f of h.fingers) c.add(this.at(f[0], _a));
      return c.multiplyScalar(0.25);
    };
    switch (p) {
      case 'wrist':
        return out.copy(W);
      case 'palm':
        return out
          .copy(W)
          .multiplyScalar(0.45)
          .addScaledVector(knuckles(), 0.55)
          .addScaledVector(Y, 0.014 * k);
      case 'heel':
        return out
          .copy(W)
          .addScaledVector(X, 0.024 * k)
          .addScaledVector(Y, 0.014 * k);
      case 'back':
        return out
          .copy(W)
          .add(knuckles())
          .multiplyScalar(0.5)
          .addScaledVector(Y, -0.017 * k);
      case 'wristBack':
        return out
          .copy(W)
          .addScaledVector(X, -0.015 * k)
          .addScaledVector(Y, -0.022 * k);
      case 'wristVolar':
        return out
          .copy(W)
          .addScaledVector(X, -0.018 * k)
          .addScaledVector(Y, 0.019 * k);
      case 'tipIndex':
        return this.tip(h.fingers[0], out);
      case 'tipMiddle':
        return this.tip(h.fingers[1], out);
      case 'tipRing':
        return this.tip(h.fingers[2], out);
      case 'tipLittle':
        return this.tip(h.fingers[3], out);
      case 'tipThumb':
        return this.tip(h.thumb, out);
      case 'pinch': {
        const t = this.tip(h.thumb, new THREE.Vector3());
        return this.tip(h.fingers[0], out).add(t).multiplyScalar(0.5);
      }
    }
    return out;
  }

  shape(side: HandSide): HandShape | null {
    const h = this.hands[side];
    if (!h) return null;
    const k = this.k;
    const W = this.at(h.hand, new THREE.Vector3());
    h.hand.getWorldQuaternion(_q);
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
    const K = h.fingers.map((f) => this.at(f[0], new THREE.Vector3()));
    const kc = K.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(0.25);
    const along = kc.clone().sub(W).dot(x);
    const caps: HandShape['caps'] = [];
    h.fingers.forEach((f) => {
      const p = f.map((b) => this.at(b, new THREE.Vector3()));
      const t = this.tip(f, new THREE.Vector3());
      caps.push({ a: p[0], b: p[1], r: 0.0092 * k, region: 'fingers' }, { a: p[1], b: p[2], r: 0.0088 * k, region: 'fingers' }, { a: p[2], b: t, r: 0.0084 * k, region: 'tips' });
    });
    const tp = h.thumb.map((b) => this.at(b, new THREE.Vector3()));
    caps.push(
      { a: tp[0], b: tp[1], r: 0.012 * k, region: 'thumb' },
      { a: tp[1], b: tp[2], r: 0.0105 * k, region: 'thumb' },
      {
        a: tp[2],
        b: this.tip(h.thumb, new THREE.Vector3()),
        r: 0.0098 * k,
        region: 'thumb',
      },
    );
    return {
      palm: {
        c: W.clone().addScaledVector(x, along / 2),
        x,
        y,
        z,
        hx: along / 2 + 0.006 * k,
        hy: 0.014 * k,
        hz: K[0].distanceTo(K[3]) / 2 + 0.01 * k,
      },
      caps,
    };
  }

  setLather(side: HandSide, region: LatherRegion, c: number) {
    const l = this.hands[side]?.lather[region];
    if (!l) return;
    l.mesh.visible = c > 0.002;
    setCoverage(l.mat, c);
  }

  setGloves(side: HandSide, k: number) {
    const h = this.hands[side];
    if (!h) return;
    for (const region of REGIONS) {
      const m = h.gloves[region];
      if (m) m.visible = k > GLOVE_ORDER[region];
    }
    if (!h.cuff) h.cuff = this.makeCuff(h);
    if (h.cuff) h.cuff.visible = k > 0.9;
  }

  /** a glove on this hand right now, to the cuff (tests) */
  glovesShown(side: HandSide): boolean {
    const h = this.hands[side];
    return !!h && !!h.cuff?.visible && Object.values(h.gloves).some((m) => m?.visible);
  }

  /**
   * Draw a hand's layers or not, whatever is on it: first-person arms (fpArms.ts) go out of view with
   * their foam and their glove still on, and come back with them.
   */
  setShown(side: HandSide, shown: boolean) {
    const h = this.hands[side];
    if (!h) return;
    const each = (o?: THREE.Object3D | null) => o?.traverse((x) => (shown ? x.layers.enable(0) : x.layers.disable(0)));
    for (const l of Object.values(h.lather)) each(l?.mesh);
    each(h.wet?.mesh);
    for (const g of Object.values(h.gloves)) each(g);
    each(h.cuff);
  }

  /** a glove's cuff: a short sleeve of nitrile round the end of the forearm, over the wrist */
  private makeCuff(h: TpHand): THREE.Object3D | null {
    const fore = h.hand.parent;
    if (!fore) return null;
    fore.updateWorldMatrix(true, false);
    const len = this.at(fore, new THREE.Vector3()).distanceTo(this.at(h.hand, new THREE.Vector3()));
    const bws = fore.getWorldScale(new THREE.Vector3()).x || 1;
    const k = this.k;
    const g = new THREE.Group();
    g.scale.setScalar(1 / bws);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * k, 0.034 * k, 0.07 * k, 18, 1, true), gloveMaterial());
    m.material.side = THREE.DoubleSide;
    m.rotation.z = -Math.PI / 2;
    m.position.x = len - 0.03 * k;
    m.castShadow = false;
    g.add(m);
    g.visible = false;
    fore.add(g);
    this.meshes.push(m);
    return g;
  }

  setWet(side: HandSide, k: number) {
    const w = this.hands[side]?.wet;
    if (!w) return;
    w.mesh.visible = k > 0.01;
    w.mat.roughness = w.rough + (0.2 - w.rough) * k;
    w.mat.color.copy(w.color).multiplyScalar(1 - 0.16 * k);
  }

  /** the layers there are (tests): regions per hand with a foam layer, and whether there's a wet copy */
  get summary(): Record<HandSide, { regions: string[]; wet: boolean }> {
    const s = (side: HandSide) => ({
      regions: Object.keys(this.hands[side]?.lather ?? {}),
      wet: !!this.hands[side]?.wet,
    });
    return { R: s('R'), L: s('L') };
  }

  dispose() {
    for (const m of this.meshes) {
      m.removeFromParent();
      (m as THREE.Mesh).geometry.dispose();
      ((m as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.meshes = [];
  }
}

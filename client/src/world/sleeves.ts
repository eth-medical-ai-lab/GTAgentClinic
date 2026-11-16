/**
 * Sleeves pushed up for hand hygiene, third person: a long-sleeved coat's cuffs go up to mid-forearm
 * before the hands are rubbed or washed (bare below the elbows; hygiene.ts plays the push, one hand
 * sliding the other's sleeve up), and they stay there.
 *
 * A Rocketbox avatar is one skinned mesh with its clothes painted on, so a sleeve can't slide. Pushed
 * up, an arm's sleeve below its hem ring is left out of the body (the body drawn with a second index
 * over the same vertices), and two layers bound to the same skeleton take its place:
 *   - the bare forearm, the colour of the hand's skin: from the wrist, where it follows the outline of
 *     the hand's skin all round, filling out into a forearm, to under the hem; weighted to the hand at
 *     the wrist as the arm it replaces is (it bends with the wrist)
 *   - the pushed-up fabric bunched in a roll round the forearm at the hem, in folds, following the
 *     sleeve's own outline: the coat's own material and fabric, bound to the forearm
 * Which triangles go: the forearm's from the cuff (it hangs a little past the wrist) to the hem whose
 * texels aren't skin, and the hand's own skin from just short of the wrist joint (the texture's edge
 * between hand and cuff lining doesn't follow the triangles: the forearm takes over from a clean
 * edge). A short-sleeved body has no fabric there: nothing to push (`ok` false).
 */
import * as THREE from 'three';
import { texels } from './handLayers';
import type { HandSide } from './hands';

const SIDES: HandSide[] = ['R', 'L'];
/** where the hem goes, along the forearm from the wrist (0) to the elbow (1): the highest sleeve ring below this */
const HEM_MAX = 0.62;
/** the hand's own skin ends this far along (just short of the wrist joint): the bare forearm starts there */
const WRIST_CUT = -0.06;

interface Body {
  mesh: THREE.SkinnedMesh;
  full: THREE.BufferGeometry;
  /** per side, the triangles (index / 3) left out with its sleeve up */
  cut: Partial<Record<HandSide, Set<number>>>;
  /** the body without those sleeves ('R', 'L', 'RL'), made when first wanted */
  variants: Map<string, THREE.BufferGeometry>;
}

interface Arm {
  up: boolean;
  /** the bare forearm and the bunched fabric */
  layers: THREE.Object3D[];
  /** the hem, along the forearm (0 wrist … 1 elbow) */
  hem: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function boneBy(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

/** do a geometry's morph targets move any vertex its own triangles use */
function ownMorphs(g: THREE.BufferGeometry): boolean {
  const targets = g.morphAttributes.position;
  if (!targets?.length || !g.index) return false;
  const idx = g.index;
  const used = new Set<number>();
  for (let k = 0; k < idx.count; k++) used.add(idx.getX(k));
  const base = g.getAttribute('position') as THREE.BufferAttribute;
  for (const t of targets)
    for (const i of used) {
      const dx = g.morphTargetsRelative ? Math.abs(t.getX(i)) + Math.abs(t.getY(i)) + Math.abs(t.getZ(i)) : Math.abs(t.getX(i) - base.getX(i)) + Math.abs(t.getY(i) - base.getY(i)) + Math.abs(t.getZ(i) - base.getZ(i));
      if (dx > 1e-4) return true;
    }
  return false;
}

export class SleeveRoll {
  /** both sleeves can be pushed up (a long-sleeved body) */
  readonly ok: boolean;
  private bodies: Body[] = [];
  private arms: Partial<Record<HandSide, Arm>> = {};
  private made: THREE.Mesh[] = [];
  private skinMat: THREE.MeshStandardMaterial | null = null;

  constructor(readonly model: THREE.Object3D) {
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && !Array.isArray(m.material) && (m.material as THREE.Material).name === 'body' && m.geometry.index) meshes.push(m);
    });
    const map = meshes.map((m) => (m.material as THREE.MeshStandardMaterial).map).find((t): t is THREE.Texture => !!t);
    const px = map ? texels(map) : null;
    const ready = meshes.filter((m) => ['position', 'uv', 'skinIndex', 'skinWeight'].every((a) => m.geometry.getAttribute(a)));
    this.pieces = ready.length;
    if (px && ready.length) {
      const bodies: Body[] = ready.map((mesh) => ({ mesh, full: mesh.geometry, cut: {}, variants: new Map() }));
      for (const side of SIDES) this.buildArm(side, bodies, px);
      this.bodies = bodies.filter((b) => b.cut.R || b.cut.L);
    }
    this.ok = !!this.arms.R && !!this.arms.L;
  }

  /** is this sleeve pushed up */
  isUp(side: HandSide): boolean {
    return !!this.arms[side]?.up;
  }

  /** both up (or there's nothing to push) */
  get allUp(): boolean {
    return !this.ok || SIDES.every((s) => this.isUp(s));
  }

  /** either up */
  get anyUp(): boolean {
    return SIDES.some((s) => this.isUp(s));
  }

  /** push a sleeve up (true) or let it down */
  set(side: HandSide, up: boolean) {
    const a = this.arms[side];
    if (!a || a.up === up) return;
    a.up = up;
    for (const l of a.layers) l.visible = up;
    for (const b of this.bodies) {
      const key = SIDES.filter((s) => this.arms[s]?.up && b.cut[s]?.size).join('');
      b.mesh.geometry = key ? this.variant(b, key) : b.full;
    }
  }

  /** the hem, along the forearm (0 at the wrist, 1 at the elbow) */
  hem(side: HandSide): number {
    return this.arms[side]?.hem ?? 0.55;
  }

  /** tests: the body's pieces, the triangles each sleeve leaves out of them, what's drawn now */
  debug() {
    return {
      ok: this.ok,
      pieces: this.pieces,
      arms: Object.fromEntries(SIDES.map((s) => [s, this.arms[s] ? { up: this.arms[s]!.up, hem: +this.arms[s]!.hem.toFixed(3) } : null])),
      bodies: this.bodies.map((b) => ({ tris: b.full.index!.count / 3, cut: { R: b.cut.R?.size ?? 0, L: b.cut.L?.size ?? 0 }, drawn: b.mesh.geometry === b.full ? 'full' : b.mesh.geometry.name })),
    };
  }
  private pieces = 0;

  /**
   * the body without some sleeves: the same vertices (and buffers), its own index. Its morph targets
   * (the face's) only if they move any of this piece's own vertices: they cost a texture per geometry,
   * and most bodies' pieces have none of their own
   */
  private variant(b: Body, key: string): THREE.BufferGeometry {
    let g = b.variants.get(key);
    if (g) return g;
    const cut = new Set<number>();
    for (const s of key) for (const k of b.cut[s as HandSide] ?? []) cut.add(k);
    const src = b.full.index!;
    const keep: number[] = [];
    for (let k = 0; k * 3 + 2 < src.count; k++) if (!cut.has(k)) keep.push(src.getX(k * 3), src.getX(k * 3 + 1), src.getX(k * 3 + 2));
    g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(b.full.attributes)) g.setAttribute(name, attr);
    if (ownMorphs(b.full)) {
      g.morphAttributes = b.full.morphAttributes;
      g.morphTargetsRelative = b.full.morphTargetsRelative;
    }
    g.setIndex(keep);
    g.boundingBox = b.full.boundingBox?.clone() ?? null;
    g.boundingSphere = b.full.boundingSphere?.clone() ?? null;
    g.userData = b.full.userData;
    g.name = `${b.full.name}|sleeves:${key}`;
    b.variants.set(key, g);
    return g;
  }

  /**
   * One arm's sleeve over all the body's pieces (a coat's cuff can be a piece of its own): where its
   * hem is, which triangles of each piece are sleeve below it, and the bare forearm and the roll that
   * stand in for them (bound to the piece with most of the sleeve)
   */
  private buildArm(side: HandSide, bodies: Body[], px: NonNullable<ReturnType<typeof texels>>) {
    const main = bodies[0].mesh;
    const bones = main.skeleton.bones;
    const idx = new Map(bones.map((b, i) => [b as THREE.Object3D, i]));
    const handB = boneBy(this.model, new RegExp(`_${side}_Hand$`));
    const foreB = boneBy(this.model, new RegExp(`_${side}_Forearm$`));
    const hi = handB ? idx.get(handB) : undefined;
    const fi = foreB ? idx.get(foreB) : undefined;
    if (!handB || !foreB || hi === undefined || fi === undefined) return;
    const family = new Set<number>();
    bones.forEach((b, i) => {
      if (new RegExp(`_${side}_(Hand|Finger)`).test(b.name)) family.add(i);
    });
    main.updateMatrixWorld(true);
    // the forearm in the mesh's own (bind) space: wrist to elbow, and the hand's axes there
    // (the bind matrix's own inverse: in 'attached' mode three keeps bindMatrixInverse at the mesh's current world matrix)
    const bindInv = main.bindMatrix.clone().invert();
    const boneInGeo = (i: number) => new THREE.Matrix4().copy(main.skeleton.boneInverses[i]).invert().premultiply(bindInv);
    const hm = boneInGeo(hi);
    const W = new THREE.Vector3().setFromMatrixPosition(hm);
    const E = new THREE.Vector3().setFromMatrixPosition(boneInGeo(fi));
    const L = W.distanceTo(E);
    if (L < 1e-6) return;
    // the mesh's units in metres (Rocketbox: centimetres)
    const unit = handB.getWorldPosition(new THREE.Vector3()).distanceTo(foreB.getWorldPosition(new THREE.Vector3())) / L;
    const ax = E.clone().sub(W).normalize();
    // across the forearm toward the thumb, and out of the palm (the wrist's frame at bind)
    const thumb = new THREE.Vector3().setFromMatrixColumn(hm, 2).normalize();
    thumb.addScaledVector(ax, -thumb.dot(ax)).normalize();
    const palm = new THREE.Vector3().crossVectors(ax, thumb).normalize();
    const colour = (u: number, v: number, out: THREE.Color) => {
      const x = Math.min(px.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * px.w)));
      const yy = (((v % 1) + 1) % 1) * px.h;
      const y = Math.min(px.h - 1, Math.max(0, Math.floor(px.flipY ? px.h - 1 - yy : yy)));
      const k = (y * px.w + x) * 4;
      return out.setRGB(px.d[k] / 255, px.d[k + 1] / 255, px.d[k + 2] / 255);
    };
    // every piece's vertices of this arm: how far along the forearm (NaN: not this arm's)
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    const pieces = bodies.map((b) => {
      const g = b.full;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
      const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
      const index = g.index!;
      const along = new Float32Array(pos.count).fill(NaN);
      const used = new Uint8Array(pos.count);
      for (let k = 0; k < index.count; k++) used[index.getX(k)] = 1;
      for (let i = 0; i < pos.count; i++) {
        if (!used[i]) continue;
        let wf = 0;
        let wh = 0;
        for (let k = 0; k < 4; k++) {
          const bi = si.getComponent(i, k);
          const w = sw.getComponent(i, k);
          if (bi === fi) wf += w;
          else if (family.has(bi)) wh += w;
        }
        if (wf + wh < 0.6) continue;
        along[i] = v.fromBufferAttribute(pos, i).sub(W).dot(ax) / L;
      }
      return { b, pos, uv, index, along };
    });
    type Piece = (typeof pieces)[number];
    const arm = (p: Piece, i: number) => !Number.isNaN(p.along[i]);
    // the skin: the hand's own colour (the back of the hand and the palm, away from the cuff)
    const skin: number[][] = [];
    for (const p of pieces) for (let i = 0; i < p.along.length; i++) if (arm(p, i) && p.along[i] < -0.15 && p.along[i] > -0.6) skin.push(colour(p.uv.getX(i), p.uv.getY(i), c).toArray());
    if (skin.length < 8) return;
    const med = [0, 1, 2].map((ch) => skin.map((s) => s[ch]).sort((a, b) => a - b)[skin.length >> 1]);
    const ref = new THREE.Color(med[0], med[1], med[2]);
    const isSkin = (u: number, w: number) => {
      colour(u, w, c);
      // (skin is warm: red over green over blue; a white, grey or coloured coat isn't, near the hand's own)
      return c.r - c.b > 0.05 && c.r >= c.g - 0.02 && Math.hypot(c.r - ref.r, c.g - ref.g, c.b - ref.b) < 0.3;
    };
    const fabric = (p: Piece, i: number) => !isSkin(p.uv.getX(i), p.uv.getY(i));
    // the hem: the highest ring of fabric up the forearm, short of the elbow
    let hem = -1;
    for (const p of pieces) for (let i = 0; i < p.along.length; i++) if (arm(p, i) && p.along[i] > 0.3 && p.along[i] <= HEM_MAX && fabric(p, i)) hem = Math.max(hem, p.along[i]);
    if (hem < 0) return;
    // the sleeve below it, on every piece: fabric triangles of this arm from the cuff (past the wrist) to the hem
    let low = 0;
    let most: Piece | null = null;
    let mostN = 0;
    for (const p of pieces) {
      const cut = new Set<number>();
      const { index, uv } = p;
      for (let k = 0; k * 3 + 2 < index.count; k++) {
        const t = [index.getX(k * 3), index.getX(k * 3 + 1), index.getX(k * 3 + 2)];
        if (!t.every((i) => arm(p, i))) continue;
        const us = t.map((i) => p.along[i]);
        if (Math.max(...us) > hem + 0.005 || Math.min(...us) < -0.3) continue;
        const cu = (uv.getX(t[0]) + uv.getX(t[1]) + uv.getX(t[2])) / 3;
        const cv = (uv.getY(t[0]) + uv.getY(t[1]) + uv.getY(t[2])) / 3;
        // (round the cuff, the hand's skin too: the texture's edge between the hand and the cuff's lining
        // isn't on the triangles' edges, and the bare forearm takes over from a clean edge short of the
        // wrist)
        if (isSkin(cu, cv) && Math.max(...us) <= WRIST_CUT && !(Math.max(...us) > -0.12 && t.some((i) => fabric(p, i)))) continue;
        cut.add(k);
        if (Math.min(...us) < 0.2) low++;
      }
      if (cut.size) p.b.cut[side] = cut;
      if (cut.size > mostN) {
        mostN = cut.size;
        most = p;
      }
    }
    // (a short sleeve: nothing near the wrist to push)
    if (!most || !low) {
      for (const p of pieces) delete p.b.cut[side];
      return;
    }
    // the wrist's skin and the sleeve's hem: how far out from the forearm's axis they are, all round it
    // (by angle: neither is round, and the forearm and the roll have to meet them all round)
    const BINS = 24;
    const dirAt = (th: number, out = new THREE.Vector3()) => out.copy(thumb).multiplyScalar(Math.cos(th)).addScaledVector(palm, Math.sin(th));
    const profile = (pick: (p: Piece, i: number) => boolean) => {
      const outer = new Array<number>(BINS).fill(NaN);
      const uvs: [number, number][] = [];
      for (const p of pieces)
        for (let i = 0; i < p.along.length; i++) {
          if (!arm(p, i) || !pick(p, i)) continue;
          v.fromBufferAttribute(p.pos, i).sub(W).addScaledVector(ax, -p.along[i] * L);
          const th = Math.atan2(v.dot(palm), v.dot(thumb));
          const b = ((Math.round((th / (Math.PI * 2)) * BINS) % BINS) + BINS) % BINS;
          // (the outside of it: the furthest out at each angle)
          if (!(v.length() <= outer[b])) outer[b] = v.length();
          uvs.push([p.uv.getX(i), p.uv.getY(i)]);
        }
      if (outer.every(Number.isNaN)) return null;
      // angles with nothing: from their nearest neighbours either side; then smoothed round
      let r = outer.map((x, i) => {
        if (!Number.isNaN(x)) return x;
        let a = 1;
        while (Number.isNaN(outer[(i - a + BINS) % BINS])) a++;
        let b = 1;
        while (Number.isNaN(outer[(i + b) % BINS])) b++;
        return outer[(i - a + BINS) % BINS] + ((outer[(i + b) % BINS] - outer[(i - a + BINS) % BINS]) * a) / (a + b);
      });
      for (let k = 0; k < 2; k++) r = r.map((x, i) => (r[(i + BINS - 1) % BINS] + 2 * x + r[(i + 1) % BINS]) / 4);
      return {
        at: (th: number) => {
          const f = ((((th / (Math.PI * 2)) * BINS) % BINS) + BINS) % BINS;
          const i0 = Math.floor(f) % BINS;
          return r[i0] + (r[(i0 + 1) % BINS] - r[i0]) * (f - Math.floor(f));
        },
        mean: r.reduce((x, y) => x + y, 0) / BINS,
        uv: uvs[uvs.length >> 1],
      };
    };
    const hemP = profile((p, i) => p.along[i] > hem - 0.06 && p.along[i] <= hem + 0.005 && fabric(p, i));
    if (!hemP) return;
    const wristP = profile((p, i) => p.along[i] > WRIST_CUT - 0.05 && p.along[i] <= WRIST_CUT + 0.005 && !fabric(p, i));
    const rw = wristP?.mean ?? hemP.mean * 0.5;
    // the bare forearm, `u` along it (0 wrist … 1 elbow), at angle th round it: the wrist's own outline
    // where it starts (a hair outside it, over the cut's edge), filling out into a forearm's flattened
    // round, well inside the sleeve near its hem
    const gap = 0.0005 / unit;
    const armAt = (u: number, th: number, out: THREE.Vector3) => {
      // (its very start tucked under the hand's skin: no edge shows where it comes out)
      const rs = (wristP ? wristP.at(th) : rw) + gap - (0.003 / unit) * (1 - smooth((u - (WRIST_CUT - 0.035)) / 0.025));
      const re = rw * (1 + 0.42 * smooth(u / 0.65));
      const flat = 0.9 + 0.08 * smooth(u / 0.6);
      const k = smooth((u - WRIST_CUT) / 0.3);
      const c = Math.cos(th);
      const sn = Math.sin(th);
      let r = rs + (Math.hypot(c * 1.08, sn * flat) * re - rs) * k;
      r = Math.min(r, hemP.at(th) * 0.85 + (1 - smooth((u - (hem - 0.25)) / 0.1)) * 1e3);
      return out.copy(W).addScaledVector(ax, u * L).addScaledVector(dirAt(th), r);
    };
    const armR = (u: number, th: number) => armAt(u, th, v).sub(W).addScaledVector(ax, -u * L).length();
    this.skinMat ??= new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(ref.r, ref.g, ref.b, THREE.SRGBColorSpace), roughness: 0.62, metalness: 0 });
    const body = most.b.mesh;
    const layers: THREE.Object3D[] = [];
    const p0 = new THREE.Vector3();
    // the bare forearm: a tube from inside the hand's skin at the wrist (where the cuff was cut away)
    // to under the roll
    {
      const rings = 16;
      const seg = BINS;
      const u0 = WRIST_CUT - 0.035;
      const u1 = hem + 0.04;
      const P: number[] = [];
      const I: number[] = [];
      const SI: number[] = [];
      const SW: number[] = [];
      for (let i = 0; i <= rings; i++) {
        const u = u0 + ((u1 - u0) * i) / rings;
        // at the wrist it bends with the hand, as the arm it replaces did
        const wh = Math.max(0, Math.min(0.8, 0.5 - u * 3.3));
        for (let j = 0; j < seg; j++) {
          armAt(u, (j / seg) * Math.PI * 2, p0);
          P.push(p0.x, p0.y, p0.z);
          SI.push(hi, fi, 0, 0);
          SW.push(wh, 1 - wh, 0, 0);
        }
      }
      for (let i = 0; i < rings; i++)
        for (let j = 0; j < seg; j++) {
          const a = i * seg + j;
          const b = i * seg + ((j + 1) % seg);
          I.push(a, b, a + seg, b, b + seg, a + seg);
        }
      layers.push(this.mount(body, P, I, SI, SW, null, this.skinMat));
    }
    // the roll: the sleeve's fabric bunched round the forearm at the hem, in folds: tucked against the
    // skin below, a fat roll the sleeve's own shape round, its top inside the sleeve's hem
    {
      const rings = 18;
      const seg = 32;
      const ua = hem - 0.17;
      const ub = hem + 0.05;
      const P: number[] = [];
      const I: number[] = [];
      const SI: number[] = [];
      const SW: number[] = [];
      const U: number[] = [];
      const [u0, v0] = hemP.uv;
      for (let i = 0; i <= rings; i++) {
        const s = i / rings;
        const u = ua + (ub - ua) * s;
        const bulge = Math.sin(Math.PI * Math.pow(s, 0.85));
        for (let j = 0; j < seg; j++) {
          const th = (j / seg) * Math.PI * 2;
          const fold = 1 + bulge * (0.05 * Math.sin(3 * th + 1.7 + 5 * s) + 0.03 * Math.sin(7 * th + 0.4 - 3 * s));
          const outer = hemP.at(th) * (1.03 + 0.14 * bulge + 0.04 * Math.sin(s * Math.PI * 3) ** 2) * fold;
          const r0 = armR(u, th) + 0.004 / unit;
          const rr = r0 + (outer - r0) * smooth(s / 0.3);
          p0.copy(W).addScaledVector(ax, u * L).addScaledVector(dirAt(th), rr);
          P.push(p0.x, p0.y, p0.z);
          SI.push(fi, 0, 0, 0);
          SW.push(1, 0, 0, 0);
          // (the sleeve's own fabric: a little patch of it round its hem)
          U.push(u0 + 0.006 * Math.cos(th), v0 + 0.006 * Math.sin(th) + 0.004 * s);
        }
      }
      for (let i = 0; i < rings; i++)
        for (let j = 0; j < seg; j++) {
          const a = i * seg + j;
          const b = i * seg + ((j + 1) % seg);
          I.push(a, b, a + seg, b, b + seg, a + seg);
        }
      layers.push(this.mount(body, P, I, SI, SW, U, body.material as THREE.Material));
    }
    this.arms[side] = { up: false, layers, hem };
  }

  /** a layer in the body's space, bound to its skeleton (hidden until its sleeve goes up) */
  private mount(body: THREE.SkinnedMesh, P: number[], I: number[], SI: number[], SW: number[], U: number[] | null, mat: THREE.Material): THREE.SkinnedMesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U ?? new Array((P.length / 3) * 2).fill(0), 2));
    g.setAttribute('skinIndex', new THREE.Float32BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    g.setIndex(I);
    // (rings run up the arm, each round from the thumb's side to the palm's: that winding faces out)
    g.computeVertexNormals();
    const m = new THREE.SkinnedMesh(g, mat);
    m.name = 'sleeve-layer';
    m.bindMode = body.bindMode;
    m.bind(body.skeleton, body.bindMatrix);
    m.position.copy(body.position);
    m.quaternion.copy(body.quaternion);
    m.scale.copy(body.scale);
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.visible = false;
    body.parent?.add(m);
    this.made.push(m);
    return m;
  }

  /** back as it was: the sleeves down, the layers gone */
  dispose() {
    for (const s of SIDES) this.set(s, false);
    for (const m of this.made) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.made = [];
    this.skinMat?.dispose();
  }
}

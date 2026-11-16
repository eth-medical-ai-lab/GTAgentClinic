/**
 * First-person hands for hand hygiene (hygiene.ts): the avatar is hidden in first person, so a pair
 * of hands comes into view to pump the dispenser, rub, wash and put on a mask.
 *
 * Each hand is built at real size in the Rocketbox hand bone's frame (hands.ts): origin at the wrist,
 * X along the fingers, Y out of the palm, Z toward the thumb (the left hand: −Z), so one world
 * orientation (handQuat) drives both this hand and the avatar's in third person. Fingers are three
 * phalanges on hinges that flex toward the palm (`curl`) and fan out (`spread`); the thumb has its
 * own curl and swings across the palm (`oppose`). The white coat's sleeve is pushed up to mid-forearm,
 * bare below the elbows as for any hand hygiene. No shadows; hidden unless something poses them.
 *
 * A wash shows on them (handLayers.ts): each hand's skin turns glossy and darker when wet; a foam
 * layer per region (a lens on the palm and on the back, a sleeve on each phalanx and the thumb) grows
 * as it's rubbed and washes off under the water, with bubbles on the skin along the contact lines.
 */
import * as THREE from 'three';
import { FpArms, type JointTurns } from './fpArms';
import type { HandSide } from './hands';
import { G, lambert } from './materials';
import { gloveMaterial, latherMaterial, setCoverage, REGIONS, type HandPoint, type HandRig, type HandShape, type LatherRegion } from './handLayers';

export interface FingerPose {
  /** 0 = straight, 1 = a loose fist */
  curl: number;
  /** fingers fanned apart (rad between neighbours, about) */
  spread: number;
  /** thumb flexion 0..1 */
  thumb: number;
  /** thumb across the palm 0..1 */
  oppose: number;
}

export const OPEN: FingerPose = {
  curl: 0.08,
  spread: 0.05,
  thumb: 0.1,
  oppose: 0.1,
};

/**
 * The finger pose a real avatar's hand is modeled in (its rest pose: a relaxed, open hand). The real
 * first-person arms (fpArms.ts) turn each joint away from its rest by as much as this rig's hinge is
 * turned away from this pose.
 */
const REAL_REST: FingerPose = { curl: 0.1, spread: 0.08, thumb: 0.15, oppose: 0.1 };

interface Rig {
  root: THREE.Group;
  /** the forearm and the sleeve, from the wrist back toward the shoulder (−X) */
  arm: THREE.Group;
  /** [finger][joint] hinges (index → little), thumb hinges */
  fingers: THREE.Group[][];
  thumb: THREE.Group[];
  skin: THREE.MeshStandardMaterial;
  lather: Record<LatherRegion, THREE.MeshStandardMaterial>;
  latherMeshes: Record<LatherRegion, THREE.Mesh[]>;
  bubbles: { mesh: THREE.Mesh; region: LatherRegion; th: number }[];
  /** skin meshes a glove covers, in the order it goes on (fingertips first: `order` 0..1), and its cuff */
  gloved: { mesh: THREE.Mesh; order: number; nail?: boolean }[];
  cuff: THREE.Mesh;
}

/** phalanx lengths (m), index → little, and their radii */
const LEN = [
  [0.043, 0.025, 0.021],
  [0.047, 0.028, 0.022],
  [0.044, 0.027, 0.021],
  [0.035, 0.021, 0.019],
];
const RAD = [0.0103, 0.0099, 0.0094, 0.0084];
/** across the palm (toward the thumb +), along it where each finger starts */
const BASE_Z = [0.027, 0.009, -0.009, -0.026];
const BASE_X = [0.093, 0.096, 0.093, 0.087];
/** how far each joint flexes at curl 1 */
const FLEX = [1.0, 1.25, 0.8];
/** the thumb's segments: metacarpal, proximal, distal */
const TL = [0.045, 0.031, 0.025];
const SKIN = '#d9a47f';
const SKIN_ROUGH = 0.6;

function capsuleX(r: number, len: number): THREE.BufferGeometry {
  return G.capsule(r, Math.max(0.001, len - 2 * r), 4, 10);
}

let lensGeo: THREE.BufferGeometry | null = null;
/**
 * A thin dome (unit footprint, height 0.5 at its middle, +Y), planar UVs two tiles across: the foam
 * on a palm or on the back of a hand, scaled to it.
 */
function lens(): THREE.BufferGeometry {
  if (lensGeo) return lensGeo;
  const g = new THREE.RingGeometry(0.0001, 0.5, 28, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.min(1, Math.hypot(x, z) / 0.5);
    p.setY(i, 0.5 * Math.sqrt(Math.max(0, 1 - r * r)));
    uv.setXY(i, (x + 0.5) * 2, (z + 0.5) * 2);
  }
  g.computeVertexNormals();
  lensGeo = g;
  return g;
}

function buildHand(side: HandSide, nail: THREE.Material, sleeve: THREE.Material, bubbleMat: THREE.Material): Rig {
  const zs = side === 'R' ? 1 : -1;
  const root = new THREE.Group();
  root.name = `fpHand:${side}`;
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN,
    roughness: SKIN_ROUGH,
    metalness: 0,
  });
  const lather = Object.fromEntries(REGIONS.map((r) => [r, latherMaterial()])) as Record<LatherRegion, THREE.MeshStandardMaterial>;
  const latherMeshes = Object.fromEntries(REGIONS.map((r) => [r, [] as THREE.Mesh[]])) as Record<LatherRegion, THREE.Mesh[]>;
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  };
  const foam = (geo: THREE.BufferGeometry, region: LatherRegion, parent: THREE.Object3D) => {
    const m = mesh(geo, lather[region], parent);
    m.visible = false;
    latherMeshes[region].push(m);
    return m;
  };
  // palm: a little thicker at the heel, the knuckles rounded
  const gloved: Rig['gloved'] = [];
  const palm = mesh(G.rbox(0.096, 0.03, 0.084, 0.0145, 3), skin, root);
  gloved.push({ mesh: palm, order: 0.62 });
  palm.position.set(0.048, -0.002, 0.002 * zs);
  // the knuckles' ridge, so the fingers grow out of the hand rather than off its edge
  const knuckles = mesh(G.capsule(0.0125, 0.055, 4, 10), skin, root);
  gloved.push({ mesh: knuckles, order: 0.5 });
  knuckles.rotation.x = Math.PI / 2;
  knuckles.position.set(0.091, -0.003, 0.0);
  const heel = mesh(G.sphere(0.022, 12, 10), skin, root);
  gloved.push({ mesh: heel, order: 0.66 });
  heel.position.set(0.018, 0.004, -0.018 * zs);
  heel.scale.set(1.2, 0.75, 1.0);
  // foam on the palm and on the back: thin domes on the skin (their rims just under it)
  const pl = foam(lens(), 'palm', root);
  pl.position.set(0.05, 0.012, 0.001 * zs);
  pl.scale.set(0.1, 0.009, 0.088);
  const bk = foam(lens(), 'back', root);
  bk.position.set(0.05, -0.016, 0.001 * zs);
  bk.rotation.x = Math.PI;
  bk.scale.set(0.1, 0.009, 0.088);
  // wrist and forearm (tapered, a little flattened), then the coat sleeve pushed up: their own group,
  // turned toward the shoulder each frame (the wrist bends; the forearm points at the elbow)
  const armG = new THREE.Group();
  armG.name = `fpArm:${side}`;
  const wristBall = mesh(G.sphere(0.026, 12, 10), skin, armG);
  gloved.push({ mesh: wristBall, order: 0.82 });
  // a glove's cuff over the wrist (shown once the glove's on)
  const gcuff = mesh(G.cyl(0.0335, 0.0368, 0.075, 16), gloveMaterial(), armG);
  gcuff.rotation.z = Math.PI / 2;
  gcuff.position.set(-0.045, 0, 0);
  gcuff.scale.set(1, 1, 0.84);
  gcuff.visible = false;
  wristBall.scale.set(1, 0.8, 1);
  const fore = mesh(G.cyl(0.027, 0.034, 0.3, 14), skin, armG);
  fore.rotation.z = Math.PI / 2;
  fore.position.set(-0.14, 0, 0);
  fore.scale.set(1, 1, 0.82);
  const cuff = mesh(G.torus(0.046, 0.012, 8, 20), sleeve, armG);
  cuff.rotation.y = Math.PI / 2;
  cuff.position.set(-0.27, 0, 0);
  const arm = mesh(G.cyl(0.05, 0.058, 0.5, 16), sleeve, armG);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.53, 0, 0);
  armG.visible = false;
  const fingers: THREE.Group[][] = [];
  for (let f = 0; f < 4; f++) {
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = root;
    let x = BASE_X[f];
    for (let j = 0; j < 3; j++) {
      const hinge = new THREE.Group();
      hinge.position.set(j === 0 ? x : LEN[f][j - 1], j === 0 ? -0.002 : 0, j === 0 ? BASE_Z[f] * zs : 0);
      parent.add(hinge);
      const r = RAD[f] * (1 - j * 0.07);
      const ph = mesh(capsuleX(r, LEN[f][j] + r), skin, hinge);
      gloved.push({ mesh: ph, order: [0.4, 0.26, 0.12][j] });
      ph.rotation.z = -Math.PI / 2;
      ph.position.x = LEN[f][j] / 2;
      ph.scale.set(1, 1, 0.92);
      // the foam's sleeve on this segment (1.7 mm proud)
      const sh = foam(capsuleX(r + 0.0017, LEN[f][j] + r + 0.0017), j === 2 ? 'tips' : 'fingers', hinge);
      sh.rotation.z = -Math.PI / 2;
      sh.position.x = LEN[f][j] / 2;
      sh.scale.set(1, 1, 0.92);
      if (j === 2) {
        // the nail on the back of the fingertip (−Y)
        const n = mesh(G.rbox(0.011, 0.002, 0.0115, 0.0009), nail, hinge);
        gloved.push({ mesh: n, order: 0.12, nail: true });
        n.position.set(LEN[f][j] - 0.006, -r + 0.0006, 0);
      }
      chain.push(hinge);
      parent = hinge;
      x = 0;
    }
    fingers.push(chain);
  }
  // thumb: metacarpal from the heel of the palm, out toward the thumb side, then two phalanges
  const thumb: THREE.Group[] = [];
  const t0 = new THREE.Group();
  t0.position.set(0.016, 0.006, 0.03 * zs);
  t0.rotation.set(0.35 * zs, -0.62 * zs, 0.12);
  root.add(t0);
  const meta = mesh(capsuleX(0.0128, 0.05), skin, t0);
  gloved.push({ mesh: meta, order: 0.52 });
  meta.rotation.z = -Math.PI / 2;
  meta.position.x = 0.024;
  const metaFoam = foam(capsuleX(0.0145, 0.0517), 'thumb', t0);
  metaFoam.rotation.z = -Math.PI / 2;
  metaFoam.position.x = 0.024;
  let tp: THREE.Object3D = t0;
  for (let j = 1; j < 3; j++) {
    const hinge = new THREE.Group();
    hinge.position.set(TL[j - 1], 0, 0);
    tp.add(hinge);
    const r = 0.0105 - j * 0.0006;
    const ph = mesh(capsuleX(r, TL[j] + 0.01), skin, hinge);
    gloved.push({ mesh: ph, order: j === 2 ? 0.28 : 0.42 });
    ph.rotation.z = -Math.PI / 2;
    ph.position.x = TL[j] / 2;
    const tf = foam(capsuleX(r + 0.0017, TL[j] + 0.0117), 'thumb', hinge);
    tf.rotation.z = -Math.PI / 2;
    tf.position.x = TL[j] / 2;
    if (j === 2) {
      const n = mesh(G.rbox(0.012, 0.002, 0.012, 0.0009), nail, hinge);
      gloved.push({ mesh: n, order: 0.28, nail: true });
      n.position.set(TL[j] - 0.007, -0.0094, 0);
    }
    thumb.push(hinge);
    tp = hinge;
  }
  thumb.unshift(t0);
  // bubbles where two hands rub (the palm's edges, the webs between the fingers, the knuckles, the
  // thumb's web), on the skin: each shows once its region's foam is thick enough
  const bubbles: Rig['bubbles'] = [];
  const spots: [number, number, number, LatherRegion][] = [
    [0.028, 0.0125, 0.043, 'palm'],
    [0.052, 0.0135, 0.0445, 'palm'],
    [0.077, 0.0125, 0.041, 'palm'],
    [0.034, 0.0125, -0.043, 'palm'],
    [0.064, 0.013, -0.044, 'palm'],
    [0.05, 0.0155, 0.012, 'palm'],
    [0.101, 0.006, 0.018, 'fingers'],
    [0.103, 0.006, 0.0, 'fingers'],
    [0.1, 0.006, -0.018, 'fingers'],
    [0.083, -0.0175, 0.012, 'back'],
    [0.064, -0.0185, -0.01, 'back'],
    [0.04, -0.018, 0.02, 'back'],
    [0.03, 0.007, 0.05, 'thumb'],
  ];
  spots.forEach(([x, y, z, region], i) => {
    const m = mesh(G.sphere(0.0021 + ((i * 7) % 5) * 0.0004, 8, 6), bubbleMat, root);
    m.position.set(x, y, z * zs);
    m.visible = false;
    bubbles.push({ mesh: m, region, th: 0.3 + ((i * 11) % 7) * 0.07 });
  });
  root.visible = false;
  return {
    root,
    arm: armG,
    fingers,
    thumb,
    skin,
    lather,
    latherMeshes,
    bubbles,
    gloved,
    cuff: gcuff,
  };
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

export class FpHands implements HandRig {
  private rigs: Record<HandSide, Rig>;
  private base: Record<HandSide, THREE.Euler>;
  private cover: Record<HandSide, Record<LatherRegion, number>> = {
    R: { palm: 0, back: 0, fingers: 0, thumb: 0, tips: 0 },
    L: { palm: 0, back: 0, fingers: 0, thumb: 0, tips: 0 },
  };
  private gloves: Record<HandSide, number> = { R: 0, L: 0 };
  private wet: Record<HandSide, number> = { R: 0, L: 0 };
  private bubbleMat: THREE.MeshStandardMaterial;
  private nail: THREE.Material;
  private sleeve: THREE.Material;
  /** a real avatar's arms wearing this rig's poses (fpArms.ts); once they are in, the rig itself isn't drawn */
  private real: FpArms;
  private realOn = false;
  /** each hinge's orientation in the hand's frame at REAL_REST, and its turn away from that right now */
  private rest: Record<HandSide, JointTurns>;
  private turns: Record<HandSide, JointTurns>;

  constructor(private scene: THREE.Scene) {
    this.nail = lambert('#e6b9a6', { roughness: 0.35 });
    this.sleeve = lambert('#f1f2f0', { roughness: 0.82 });
    this.bubbleMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.12,
      metalness: 0,
      emissive: '#e3eaee',
      emissiveIntensity: 0.18,
    });
    this.rigs = {
      R: buildHand('R', this.nail, this.sleeve, this.bubbleMat),
      L: buildHand('L', this.nail, this.sleeve, this.bubbleMat),
    };
    this.base = {
      R: this.rigs.R.thumb[0].rotation.clone(),
      L: this.rigs.L.thumb[0].rotation.clone(),
    };
    scene.add(this.rigs.R.root, this.rigs.L.root, this.rigs.R.arm, this.rigs.L.arm);
    this.real = FpArms.of(scene);
    const empty = (): JointTurns => ({ fingers: this.rigs.R.fingers.map((c) => c.map(() => new THREE.Quaternion())), thumb: this.rigs.R.thumb.map(() => new THREE.Quaternion()) });
    this.rest = { R: empty(), L: empty() };
    this.turns = { R: empty(), L: empty() };
    for (const side of ['R', 'L'] as HandSide[]) {
      this.fingers(side, REAL_REST);
      this.inHand(side, this.rest[side]);
    }
  }

  /** the hinges of a hand to a finger pose */
  private fingers(side: HandSide, pose: FingerPose) {
    const rig = this.rigs[side];
    const zs = side === 'R' ? 1 : -1;
    rig.fingers.forEach((chain, f) => {
      chain.forEach((h, j) => {
        h.rotation.z = FLEX[j] * pose.curl;
        // fanned out from the middle finger (about the palm's normal)
        if (j === 0) h.rotation.y = -zs * (f - 1.3) * pose.spread;
      });
    });
    const b = this.base[side];
    rig.thumb[0].rotation.set(b.x + 0.5 * pose.oppose * zs, b.y + 0.7 * pose.oppose * zs, b.z + 0.25 * pose.thumb);
    rig.thumb[1].rotation.z = 0.5 * pose.thumb;
    rig.thumb[2].rotation.z = 0.7 * pose.thumb;
  }

  /** every hinge's orientation in the hand's own frame, as the hinges stand */
  private inHand(side: HandSide, out: JointTurns) {
    const rig = this.rigs[side];
    const walk = (chain: THREE.Group[], q: THREE.Quaternion[]) => {
      _q.identity();
      chain.forEach((h, j) => q[j].copy(_q.multiply(h.quaternion)));
    };
    rig.fingers.forEach((chain, f) => walk(chain, out.fingers[f]));
    walk(rig.thumb, out.thumb);
  }

  /**
   * Put a hand somewhere (world: the wrist, and the hand bone's orientation) with a finger pose; the
   * forearm runs from the wrist toward `shoulder` (world), so the arm comes in from the edge of the
   * view whatever the hand is doing.
   */
  set(side: HandSide, wrist: THREE.Vector3, quat: THREE.Quaternion, pose: FingerPose = OPEN, shoulder?: THREE.Vector3) {
    const rig = this.rigs[side];
    rig.root.visible = true;
    rig.root.position.copy(wrist);
    rig.root.quaternion.copy(quat);
    rig.arm.visible = true;
    rig.arm.position.copy(wrist);
    if (shoulder) {
      // the arm's +X from the shoulder to the wrist; its up as close to the hand's back as it gets
      _x.copy(wrist).sub(shoulder).normalize();
      _y.set(0, -1, 0).applyQuaternion(quat);
      _y.addScaledVector(_x, -_y.dot(_x));
      if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0).addScaledVector(_x, -_x.y);
      _y.normalize();
      _z.crossVectors(_x, _y);
      rig.arm.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    } else rig.arm.quaternion.copy(quat);
    this.fingers(side, pose);
    rig.root.updateMatrixWorld(true);
    if (!this.real.ready) return;
    // the real arms wear the pose: each joint turned from its rest as the hinge is from REAL_REST. The
    // rig stays where it is, undrawn: its points and shapes are what the choreography measures by
    if (!this.realOn) {
      this.realOn = true;
      for (const r of [this.rigs.R, this.rigs.L]) for (const o of [r.root, r.arm]) o.traverse((x) => x.layers.disable(0));
      for (const s of ['R', 'L'] as HandSide[]) {
        for (const region of REGIONS) this.real.setLather(s, region, this.cover[s][region]);
        this.real.setGloves(s, this.gloves[s]);
        this.real.setWet(s, this.wet[s]);
      }
    }
    const now = this.turns[side];
    const rest = this.rest[side];
    this.inHand(side, now);
    now.fingers.forEach((chain, f) => chain.forEach((q, j) => q.multiply(_q.copy(rest.fingers[f][j]).invert())));
    now.thumb.forEach((q, j) => q.multiply(_q.copy(rest.thumb[j]).invert()));
    this.real.set(side, wrist, quat, now, shoulder);
  }

  /** a point in a hand's frame (m), world */
  local(side: HandSide, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.rigs[side].root.localToWorld(out.set(x, y, z * (side === 'R' ? 1 : -1)));
  }

  /** the middle of the palm's surface (where gel, soap or a towel sits), world */
  palm(side: HandSide, out: THREE.Vector3): THREE.Vector3 {
    return this.local(side, 0.055, 0.016, 0, out);
  }

  /** a hand's world orientation (false while hidden) */
  quat(side: HandSide, out: THREE.Quaternion): boolean {
    const r = this.rigs[side].root;
    if (!r.visible) return false;
    out.copy(r.quaternion);
    return true;
  }

  frame(side: HandSide, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    const r = this.rigs[side].root;
    if (!r.visible) return false;
    pos.copy(r.position);
    quat.copy(r.quaternion);
    return true;
  }

  /** a fingertip's pad (just short of the tip, a little toward the palm), world */
  private tip(side: HandSide, f: number, out: THREE.Vector3): THREE.Vector3 {
    const rig = this.rigs[side];
    if (f < 0) return rig.thumb[2].localToWorld(out.set(TL[2] + 0.003, 0.002, 0));
    const r = RAD[f] * 0.86;
    return rig.fingers[f][2].localToWorld(out.set(LEN[f][2] + r * 0.5 - 0.002, 0.002, 0));
  }

  point(side: HandSide, p: HandPoint, out: THREE.Vector3): THREE.Vector3 {
    switch (p) {
      case 'wrist':
        return out.copy(this.rigs[side].root.position);
      case 'palm':
        return this.local(side, 0.055, 0.016, 0, out);
      case 'heel':
        return this.local(side, 0.022, 0.016, 0, out);
      case 'back':
        return this.local(side, 0.05, -0.019, 0, out);
      case 'wristBack':
        return this.local(side, -0.014, -0.023, 0, out);
      case 'wristVolar':
        return this.local(side, -0.016, 0.02, 0, out);
      case 'tipIndex':
        return this.tip(side, 0, out);
      case 'tipMiddle':
        return this.tip(side, 1, out);
      case 'tipRing':
        return this.tip(side, 2, out);
      case 'tipLittle':
        return this.tip(side, 3, out);
      case 'tipThumb':
        return this.tip(side, -1, out);
      case 'pinch': {
        const t = this.tip(side, -1, new THREE.Vector3());
        return this.tip(side, 0, out).add(t).multiplyScalar(0.5);
      }
    }
    return out;
  }

  shape(side: HandSide): HandShape | null {
    const rig = this.rigs[side];
    if (!rig.root.visible) return null;
    const zs = side === 'R' ? 1 : -1;
    const q = rig.root.quaternion;
    const caps: HandShape['caps'] = [];
    rig.fingers.forEach((chain, f) => {
      chain.forEach((h, j) => {
        const r = RAD[f] * (1 - j * 0.07);
        const a = h.localToWorld(new THREE.Vector3(0, 0, 0));
        const b = h.localToWorld(new THREE.Vector3(LEN[f][j] + (j === 2 ? r * 0.5 : 0), 0, 0));
        caps.push({ a, b, r, region: j === 2 ? 'tips' : 'fingers' });
      });
    });
    const t = rig.thumb;
    caps.push({
      a: t[0].localToWorld(new THREE.Vector3()),
      b: t[1].localToWorld(new THREE.Vector3()),
      r: 0.0128,
      region: 'thumb',
    });
    caps.push({
      a: t[1].localToWorld(new THREE.Vector3()),
      b: t[2].localToWorld(new THREE.Vector3()),
      r: 0.0099,
      region: 'thumb',
    });
    caps.push({
      a: t[2].localToWorld(new THREE.Vector3()),
      b: t[2].localToWorld(new THREE.Vector3(TL[2] + 0.005, 0, 0)),
      r: 0.0093,
      region: 'thumb',
    });
    return {
      palm: {
        c: rig.root.localToWorld(new THREE.Vector3(0.048, -0.002, 0.002 * zs)),
        x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        y: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        z: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
        hx: 0.05,
        hy: 0.015,
        hz: 0.043,
      },
      caps,
    };
  }

  setLather(side: HandSide, region: LatherRegion, c: number) {
    const rig = this.rigs[side];
    this.cover[side][region] = c;
    setCoverage(rig.lather[region], c);
    for (const m of rig.latherMeshes[region]) m.visible = c > 0.002;
    for (const b of rig.bubbles) if (b.region === region) b.mesh.visible = c > b.th;
    this.real.setLather(side, region, c);
  }

  /** wet skin: glossier and a little darker (0 dry … 1 dripping) */
  /** a glove on this hand right now, to the cuff (tests) */
  glovesShown(side: HandSide): boolean {
    const r = this.rigs[side];
    return r.root.visible && r.cuff.visible;
  }

  /** gloves on a hand (0 bare … 1 to the cuff): nitrile over the skin from the fingertips up, the nails under it */
  setGloves(side: HandSide, k: number) {
    const rig = this.rigs[side];
    for (const g of rig.gloved) {
      if (g.nail) g.mesh.visible = k <= g.order;
      else g.mesh.material = k > g.order ? gloveMaterial() : rig.skin;
    }
    rig.cuff.visible = k > 0.9;
    // (no foam or bubbles on a glove)
    if (k > 0.05) for (const r of REGIONS) this.setLather(side, r, 0);
    this.gloves[side] = k;
    this.real.setGloves(side, k);
  }

  setWet(side: HandSide, k: number) {
    const s = this.rigs[side].skin;
    s.roughness = SKIN_ROUGH - 0.44 * k;
    s.color.set(SKIN).multiplyScalar(1 - 0.12 * k);
    this.wet[side] = k;
    this.real.setWet(side, k);
  }

  hide() {
    this.hideSide('R');
    this.hideSide('L');
  }

  /** one hand (and its arm) out of view */
  hideSide(side: HandSide) {
    const r = this.rigs[side];
    // (only if this rig had it out: the real arms are shared with the scene's other rigs)
    if (r.root.visible) this.real.hideSide(side);
    r.root.visible = r.arm.visible = false;
  }

  /** tests: how far each forearm is turned about its own axis as drawn (rad; null before the real arms are in) */
  forearmTurn(side: HandSide): { step: number; roll: number } | null {
    if (!this.realOn || !this.rigs[side].root.visible) return null;
    return { step: this.real.turned[side] ?? 0, roll: this.real.rolled[side] ?? 0 };
  }

  get visible(): boolean {
    return this.rigs.R.root.visible || this.rigs.L.root.visible;
  }

  dispose() {
    this.hide();
    this.real.release();
    this.scene.remove(this.rigs.R.root, this.rigs.L.root, this.rigs.R.arm, this.rigs.L.arm);
    for (const r of [this.rigs.R, this.rigs.L]) {
      r.skin.dispose();
      for (const m of Object.values(r.lather)) m.dispose();
    }
    this.bubbleMat.dispose();
  }
}

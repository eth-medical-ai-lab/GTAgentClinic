/**
 * Your own arms in first person, drawn from a real avatar.
 *
 * The first-person hands (fpHands.ts) are a rig of hinges with capsules on them: right for placing a
 * fingertip on a tap, but as a picture they were a mannequin's, one flat skin color on tubes. Here the
 * same poses are worn by a real body: a short-sleeved scrubs avatar of the player's sex, in the
 * player's skin tone and scrub color, of which only the arms are drawn (bare below the elbows, as for
 * any hand hygiene). Its upper arm is put at the shoulder the pose comes from, a two-bone IK takes
 * the wrist to the pose's wrist, the hand bone takes the pose's orientation (fpHands and the avatars
 * share the Rocketbox hand frame), and every finger joint turns as its hinge in the rig does.
 *
 * Lather, wet skin and gloves are the avatar's own layers (handLayers.ts TpHandLayers), as in third
 * person. One body serves every FpHands of a scene (hygiene, amenities): only one of
 * them has hands in view at a time.
 */
import * as THREE from 'three';
import { AvatarCharacter, avatarInfo } from './avatars';
import { CAST, firstPersonArms } from './casting';
import { TpHandLayers, type LatherRegion } from './handLayers';
import { armBones, reachArm, type ArmBones, type HandSide } from './hands';

/** a hand's finger joints as turns in the hand's own frame, away from the reference pose: [finger][joint] index → little, then the thumb */
export interface JointTurns {
  fingers: THREE.Quaternion[][];
  thumb: THREE.Quaternion[];
}

interface Side {
  mesh: THREE.SkinnedMesh;
  /** the scrub top's sleeve, from above the elbow up the upper arm and on out of view */
  sleeve: THREE.Group;
  /** the sleeve bunched round the top of the forearm */
  cuff: THREE.Group;
  arm: ArmBones;
  /** arm's length, shoulder to wrist (m) */
  reach: number;
  /** [finger][joint] bones and each one's orientation in the hand's frame at rest */
  fingers: { bone: THREE.Object3D; rest: THREE.Quaternion }[][];
  thumb: { bone: THREE.Object3D; rest: THREE.Quaternion }[];
  twist: Twist | null;
  /** each arm bone's own rotation as modeled: every pose starts from it (no clip plays: a bone keeps whatever it was last given) */
  rest: { upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion };
  /** the sleeve tube's length as last posed (m, from its hem) */
  len: number;
}

/**
 * How a forearm turns with its hand: about its own axis (forearm frame, toward the wrist), by as much as
 * the hand is turned about that axis away from `rest`, the hand's turn against the forearm as the body
 * was modeled.
 */
interface Twist {
  axis: THREE.Vector3;
  rest: THREE.Quaternion;
  /** the hand's palm side in the forearm's frame at rest, square to its axis */
  palm: THREE.Vector3;
}

const ARM_BONE = /_([LR])_(UpperArm|Forearm|Hand|Finger\d+)$/;
const UP = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _h = new THREE.Quaternion();
const _prev = new THREE.Quaternion();
const _x = new THREE.Vector3();
const _e = new THREE.Vector3();
const _a = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _mw = new THREE.Matrix4();
const _ml = new THREE.Matrix4();
/** the most the forearm's bone turns from palm-in, either way (rad: ~110°; past palm-down or palm-up only for a hand no arm could turn so far) */
const TURN_MAX = (110 * Math.PI) / 180;
/** the most of a turn left to the wrist (rad, ~30°: more, and its skin would pinch) */
const WRIST_MAX = (30 * Math.PI) / 180;
/** a hand turned further than this from palm-in is on its way round (rad, ~140°) */
const PALM_OUT = (140 * Math.PI) / 180;
/** how fast a forearm turns at most (rad/s, ~720°/s) */
const FORE_SPEED = 4 * Math.PI;
/** how much of the hand's turn the forearm's one bone takes (the wrist the rest) */
const FORE_SHARE = 0.7;
/** how far out to its own side an elbow is pushed (m, at the arm's middle; see set()) */
const ELBOW_OUT = 0.07;
/** how far a shoulder may come down after a hand out of reach (m; see set()) */
const DRAG_DOWN = 0.06;

/**
 * A short sleeve as a tube along +X from its hem. The body is cut where the upper arm leaves the
 * collar bone's hold (see vertexSide), a ragged edge with nothing above it: the sleeve runs on over
 * it (SLEEVE_PAST) and ends there closed and rounded, as a shoulder is. Left open, its end showed as a
 * hole when an arm hung below the view and the upper arm pointed back up at the eyes.
 */
function sleeveTube(color: string): THREE.Group {
  const g = new THREE.Group();
  // (both faces: you look into the hem round the arm)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  // (made at its longest: each pose sizes it to the arm, set())
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, SLEEVE_LEN, 20, 1, true), mat);
  tube.rotation.z = -Math.PI / 2;
  tube.position.x = HEM + SLEEVE_LEN / 2;
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 8, 24), mat);
  hem.rotation.y = Math.PI / 2;
  hem.position.x = HEM;
  // (a half sphere of the tube's own width, its pole along +X; set() puts it at the tube's end)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  cap.rotation.z = -Math.PI / 2;
  cap.position.x = HEM + SLEEVE_LEN;
  for (const m of [tube, hem, cap]) {
    m.castShadow = false;
    m.receiveShadow = true;
    g.add(m);
  }
  g.visible = false;
  return g;
}
/**
 * where the sleeve's hem is, along the upper arm from the elbow (m): just past the joint (the sleeve
 * pushed up to the elbow, as for hand washing)
 */
const HEM = -0.02;
/** the sleeve tube's longest (m) */
const SLEEVE_LEN = 0.9;
/** how far the sleeve runs on past the shoulder before its rounded end (m): over the body's cut edge there */
const SLEEVE_PAST = 0.1;

/**
 * The sleeve bunched round the top of the forearm, along it from the elbow (+X): the forearm leaves the
 * upper arm's sleeve at the elbow's angle, and its cut edge at the crease showed past the hem when the
 * elbow bent. This follows the forearm, so the cut stays covered at any angle.
 */
function sleeveCuff(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // (lathed round its axis, +Y, laid along +X)
  const tube = new THREE.Mesh(new THREE.LatheGeometry(CUFF_R.map(([t, r]) => new THREE.Vector2(r, t)), 20), mat);
  tube.rotation.z = -Math.PI / 2;
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.005, 8, 24), mat);
  hem.rotation.y = Math.PI / 2;
  hem.position.x = CUFF;
  for (const m of [tube, hem]) {
    m.castShadow = false;
    m.receiveShadow = true;
    g.add(m);
  }
  g.visible = false;
  return g;
}
/** how far the bunched sleeve reaches down the forearm from the elbow (m) */
const CUFF = 0.055;
/**
 * The bunched sleeve's radius down the forearm from the elbow, [m along it, m round]: fuller in its
 * middle, over the forearm's muscle. That stands 6.4 cm from the bone 2–3 cm below the elbow, and a
 * straight cuff (5.9 cm widening to 6.2) let a triangle of it through whenever it turned toward you.
 */
const CUFF_R: [number, number][] = [
  [0, 0.061],
  [0.015, 0.066],
  [0.028, 0.067],
  [0.045, 0.065],
  [CUFF, 0.062],
];
/** the bunched sleeve's radius that far down the forearm (m) */
function cuffRadius(t: number): number {
  for (let i = 1; i < CUFF_R.length; i++) {
    const [t1, r1] = CUFF_R[i];
    if (t > t1) continue;
    const [t0, r0] = CUFF_R[i - 1];
    return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
  }
  return CUFF_R[CUFF_R.length - 1][1];
}

/**
 * Where your shoulders are in first person, for this view (world): below the eyes, out to either side
 * and a little behind them. Looking down bows the head, and the eyes go forward over what the hands do
 * while the shoulders stay with the body, further behind. With the shoulders where they are for a level
 * look, a look down at a sink looked straight along both upper arms: their sleeves filled the bottom
 * corners of the view.
 */
export function fpShoulders(cam: THREE.Camera): Record<HandSide, THREE.Vector3> {
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  // the body's right is the view's, levelled (no camera rolls); its forward square to that
  const r = new THREE.Vector3(e[0], 0, e[2]).normalize();
  const f = new THREE.Vector3().crossVectors(UP, r);
  // how far the view looks down (rad: the camera's forward is −z)
  const down = Math.asin(THREE.MathUtils.clamp(e[9], -1, 1));
  const k = THREE.MathUtils.smoothstep(down, 0.25, 1.3);
  const back = 0.05 + 0.1 * k;
  const at = (sg: number) => new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).addScaledVector(r, sg * 0.2).addScaledVector(UP, -0.3).addScaledVector(f, -back);
  return { R: at(1), L: at(-1) };
}

const shared = new WeakMap<THREE.Scene, FpArms>();

export class FpArms {
  /** the body is in and its arms cut out: until then (or if it never loads) the rig's own hands are drawn */
  ready = false;
  private ch: AvatarCharacter | null = null;
  private layers: TpHandLayers | null = null;
  private sides: Partial<Record<HandSide, Side>> = {};
  /**
   * an arm is out (set() since its last hideSide()). Its layers are drawn only then: lather, gloves or
   * wet skin set while it is away would otherwise show on an arm nobody posed, in the middle of a room
   */
  private shown: Record<HandSide, boolean> = { R: false, L: false };
  private disposed = false;

  private users = 0;

  /** the scene's arms, if any are in (no new user) */
  static peek(scene: THREE.Scene): FpArms | null {
    return shared.get(scene) ?? null;
  }

  /** an arm's length, shoulder to wrist (m; null until the body is in) */
  armLength(side: HandSide): number | null {
    return this.sides[side]?.reach ?? null;
  }

  /** the one set of arms of a scene (release() it when done) */
  static of(scene: THREE.Scene): FpArms {
    let a = shared.get(scene);
    if (!a) shared.set(scene, (a = new FpArms(scene)));
    a.users++;
    return a;
  }

  /** one user fewer; the last one takes the body with it */
  release() {
    if (--this.users <= 0) this.dispose();
  }

  private constructor(private scene: THREE.Scene) {
    const player = CAST.player;
    const cast = firstPersonArms(player);
    // the player's own skin tone on the borrowed arms (your hands look the same in either camera)
    void avatarInfo(player.head ?? player.id).then((info) => {
      if (this.disposed) return;
      const ch = new AvatarCharacter({ ...cast, skin: player.skin ?? info?.skin ?? undefined }, { onReady: () => this.build() });
      this.ch = ch;
      ch.root.visible = false;
      scene.add(ch.root);
    });
  }

  /** once the model is in: its hand layers, then the body reduced to two arms (in the rest pose: no clip ever plays) */
  private build() {
    const ch = this.ch;
    if (!ch || this.disposed || ch.failed) return;
    const model = ch.root;
    model.updateMatrixWorld(true);
    const before: THREE.Mesh[] = [];
    model.traverse((o) => (o as THREE.Mesh).isMesh && before.push(o as THREE.Mesh));
    const body = before.find((m) => (m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material) && (m.material as THREE.Material).name === 'body') as THREE.SkinnedMesh | undefined;
    const arms = { R: armBones(model, 'R'), L: armBones(model, 'L') };
    if (!body || !arms.R || !arms.L || !body.geometry.index) return;
    // (the layers are cut from the whole body, so before it is hidden)
    const color = CAST.player.scrubs ?? '#5d8fbf';
    const layers = new TpHandLayers(model, ch.height / 1.78);
    if (!layers.ok) return;
    layers.setShown('R', false);
    layers.setShown('L', false);
    this.layers = layers;
    for (const m of before) m.visible = false;
    const geo = body.geometry;
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    const index = geo.index!;
    const sideOf = body.skeleton.bones.map((b) => (ARM_BONE.exec(b.name)?.[1] ?? null) as HandSide | null);
    /** which arm a vertex belongs to: most of its weight on that arm's bones */
    const vertexSide = (v: number): HandSide | null => {
      let r = 0;
      let l = 0;
      for (let k = 0; k < 4; k++) {
        const s = sideOf[si.getComponent(v, k)];
        if (s === 'R') r += sw.getComponent(v, k);
        else if (s === 'L') l += sw.getComponent(v, k);
      }
      return r >= 0.5 ? 'R' : l >= 0.5 ? 'L' : null;
    };
    // ── the forearm turns as a whole ──
    // Turned about the forearm (palms together, palms up), the hand turned at the wrist alone: the skin
    // there, held half by each bone, collapsed into a thin, twisted neck (linear skinning's "candy
    // wrapper"). Spread along the forearm by a twist bone, it thinned the middle of the forearm instead:
    // a skin blended between two turns that far apart (up to ~150°) is pulled toward the axis. So the
    // forearm turns with the hand as a whole (set()), as it does when the radius rolls round the ulna,
    // and its skin follows the forearm alone up to the elbow's crease: the twist is at the elbow, under
    // the sleeve, and the wrist only bends.
    const bones = body.skeleton.bones;
    const inverses = body.skeleton.boneInverses;
    const twists: Partial<Record<HandSide, Twist & { upper: number; fore: number }>> = {};
    for (const side of ['R', 'L'] as HandSide[]) {
      const arm = arms[side]!;
      const upper = bones.indexOf(arm.upper as THREE.Bone);
      const fore = bones.indexOf(arm.fore as THREE.Bone);
      const hand = bones.indexOf(arm.hand as THREE.Bone);
      if (upper < 0 || fore < 0 || hand < 0) continue;
      // the hand against the forearm as bound (the skin's own rest, whatever pose the nodes are in)
      const at = new THREE.Vector3();
      const rest = new THREE.Quaternion();
      new THREE.Matrix4().copy(inverses[fore]).multiply(new THREE.Matrix4().copy(inverses[hand]).invert()).decompose(at, rest, new THREE.Vector3());
      at.normalize();
      // (and the hand's palm side in the forearm's frame, square to it)
      twists[side] = { axis: at, rest, palm: new THREE.Vector3(0, 1, 0).applyQuaternion(rest).projectOnPlane(at).normalize(), upper, fore };
    }
    // The arms' own weights: only their own arm's bones, scaled back up to 1, the upper arm's share
    // given to the forearm. The body stays behind, unposed, wherever it stands: a vertex the spine or a
    // collar bone held even a little was pulled out of the arm toward it (2% of ten metres is a 20 cm
    // shard)
    const IndexArray = (si.array as Uint16Array).constructor as Uint16ArrayConstructor;
    const armIndices = new THREE.BufferAttribute(new IndexArray(si.count * 4), 4);
    const armWeights = new THREE.BufferAttribute(new Float32Array(sw.count * 4), 4);
    const share = new Map<number, number>();
    for (let v = 0; v < sw.count; v++) {
      const side = vertexSide(v);
      const tw = side ? twists[side] : undefined;
      share.clear();
      for (let k = 0; k < 4; k++) {
        let b = si.getComponent(v, k);
        const w = sw.getComponent(v, k);
        if (!side || w <= 0 || sideOf[b] !== side) continue;
        if (tw && b === tw.upper) b = tw.fore;
        share.set(b, (share.get(b) ?? 0) + w);
      }
      const pairs = [...share].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = pairs.reduce((s, p) => s + p[1], 0);
      for (let k = 0; k < 4; k++) {
        const p = k < pairs.length ? pairs[k] : null;
        armIndices.setComponent(v, k, p ? p[0] : 0);
        armWeights.setComponent(v, k, sum > 0 ? (p ? p[1] / sum : 0) : k === 0 ? 1 : 0);
      }
    }
    /** how much of a vertex the forearm, the hand and the fingers hold (0: upper arm only) */
    const lower = body.skeleton.bones.map((b) => /_(Forearm|Hand|Finger\d+)$/.test(b.name));
    const below = (v: number): number => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (lower[si.getComponent(v, k)]) w += sw.getComponent(v, k);
      return w;
    };
    for (const side of ['R', 'L'] as HandSide[]) {
      const tris: number[] = [];
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        // from the elbow's crease down (the forearm holds most of each corner): the upper arm is inside the
        // sleeve, and the back of a sharply bent elbow, held by the upper arm, bulged out past it as a flap
        if (vertexSide(a) === side && vertexSide(b) === side && vertexSide(c) === side && below(a) >= 0.5 && below(b) >= 0.5 && below(c) >= 0.5) tris.push(a, b, c);
      }
      // the body's own vertices with the arms' weights, this arm's triangles (no face shapes: an arm has none)
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(geo.attributes)) g.setAttribute(name, name === 'skinWeight' ? armWeights : name === 'skinIndex' ? armIndices : geo.getAttribute(name));
      g.setIndex(tris);
      const mesh = new THREE.SkinnedMesh(g, body.material);
      mesh.name = `fpArm:${side}`;
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      mesh.scale.copy(body.scale);
      body.parent?.add(mesh);
      mesh.bind(body.skeleton, body.bindMatrix);
      // posed far from where the body stands: its bounds say nothing
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.visible = false;
      const arm = arms[side]!;
      const hq = arm.hand.getWorldQuaternion(new THREE.Quaternion()).invert();
      const joint = (name: string) => {
        const bone = model.getObjectByName(`Bip01_${side}_${name}`);
        return bone ? { bone, rest: hq.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())) } : null;
      };
      const chain = (n: string) => [joint(n), joint(`${n}1`), joint(`${n}2`)].filter((j): j is NonNullable<typeof j> => !!j);
      const reach = arm.upper.getWorldPosition(_s).distanceTo(arm.fore.getWorldPosition(_d)) + _d.distanceTo(arm.hand.getWorldPosition(_p));
      const sleeve = sleeveTube(color);
      const cuff = sleeveCuff((sleeve.children[0] as THREE.Mesh).material as THREE.Material);
      this.scene.add(sleeve, cuff);
      const tw = twists[side];
      this.sides[side] = { mesh, sleeve, cuff, arm, reach, fingers: ['Finger1', 'Finger2', 'Finger3', 'Finger4'].map(chain), thumb: chain('Finger0'), twist: tw ? { axis: tw.axis, rest: tw.rest, palm: tw.palm } : null, rest: { upper: arm.upper.quaternion.clone(), fore: arm.fore.quaternion.clone(), hand: arm.hand.quaternion.clone() }, len: SLEEVE_LEN };
    }
    model.visible = true;
    this.ready = true;
  }

  /**
   * An arm from `shoulder` to a hand at `wrist` turned to `quat` (all world), its finger joints turned
   * as `turns` says (fpHands.ts jointTurns).
   */
  set(side: HandSide, wrist: THREE.Vector3, quat: THREE.Quaternion, turns: JointTurns, shoulder?: THREE.Vector3) {
    const s = this.sides[side];
    if (!s) return;
    s.mesh.visible = true;
    if (!this.shown[side]) {
      this.shown[side] = true;
      this.layers?.setShown(side, true);
    }
    // no shoulder given: the forearm straight behind the hand, the elbow a little low
    if (shoulder) _s.copy(shoulder);
    else _s.set(-1, 0, 0).applyQuaternion(quat).multiplyScalar(s.reach * 0.9).add(wrist).addScaledVector(UP, -0.1);
    // a pose may ask for a hand further out than this arm is long: the shoulder (out of view) comes along
    // as a lean brings it, forward or to the side and only a little down, and what it can't make up the
    // hand falls short. Pulled down after a hand parked out of sight below, the shoulder dropped half a
    // metre into the view and the upper arm pointed back up at the eyes
    _d.copy(wrist).sub(_s);
    const far = _d.length();
    if (far > s.reach * 0.97) _s.add(_d.multiplyScalar(1 - (s.reach * 0.97) / far).setY(Math.max(_d.y, -DRAG_DOWN)));
    const parent = s.arm.upper.parent!;
    parent.updateWorldMatrix(true, false);
    s.arm.upper.quaternion.copy(s.rest.upper);
    s.arm.fore.quaternion.copy(s.rest.fore);
    s.arm.hand.quaternion.copy(s.rest.hand);
    s.arm.upper.position.copy(parent.worldToLocal(_p.copy(_s)));
    s.arm.upper.updateMatrixWorld(true);
    // the elbow: below the line from shoulder to wrist, a little out to its own side. It hangs: pushed
    // further out, a look down at hands held together saw both forearms come in flat from the sides,
    // elbows winged like a barrel hug's
    const sg = side === 'R' ? 1 : -1;
    const dir = _d.copy(wrist).sub(_s).normalize();
    _r.crossVectors(dir, UP);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize().multiplyScalar(sg);
    _p.copy(_s).add(wrist).multiplyScalar(0.5).addScaledVector(UP, -0.35).addScaledVector(_r, ELBOW_OUT);
    // the way the arm bends (toward that point), and so the elbow's hinge, square to it: it holds even
    // when the arm is near straight
    const bend = _e1.copy(_p).sub(_s).projectOnPlane(dir).normalize();
    reachArm(s.arm, wrist, _p, 1, quat);
    // The forearm's turn about its own axis. A forearm turns its hand from palm-in (thumb up: the
    // elbow's hinge says which way is in) toward palm-down or palm-up, ~90° either way: the hand's turn
    // is read off the pose from there. The forearm's skin is held by its one bone and turns as a whole:
    // the bone takes FORE_SHARE of the turn (a real forearm turns from nothing at the elbow to all of it
    // at the wrist: this is its middle) and the wrist the rest, too little to pinch its skin. Each pose
    // starts from the arm as modeled (above): nothing carries over from the last, the turn included
    const tw = s.twist;
    if (tw) {
      const ax = _a.copy(s.arm.hand.getWorldPosition(_w)).sub(s.arm.fore.getWorldPosition(_e)).normalize();
      const neutral = _m.crossVectors(bend, dir).multiplyScalar(-sg).projectOnPlane(ax).normalize();
      const pp = _w.set(0, 1, 0).applyQuaternion(quat).projectOnPlane(ax).normalize();
      const turn = sg * Math.atan2(_n.crossVectors(neutral, pp).dot(ax), neutral.dot(pp));
      // the wrist takes its share, never more than WRIST_MAX; the forearm the rest, as far as it goes.
      // Round toward palm-out (no arm turns a hand that far: it's on its way from one grip to another)
      // the forearm stays at the end it's at, rather than flipping to the other; and it turns at most
      // FORE_SPEED, so a hand that changes grip turns its forearm round, it doesn't snap
      const prev = this.forePrev[side];
      const wristShare = THREE.MathUtils.clamp(turn * (1 - FORE_SHARE), -WRIST_MAX, WRIST_MAX);
      let fore = THREE.MathUtils.clamp(turn - wristShare, -TURN_MAX, TURN_MAX);
      if (prev !== undefined && Math.abs(turn) > PALM_OUT && Math.abs(prev) > 0.3 && Math.sign(fore) !== Math.sign(prev)) fore = Math.sign(prev) * TURN_MAX;
      const now = performance.now();
      if (prev !== undefined) {
        const step = FORE_SPEED * THREE.MathUtils.clamp((now - (this.foreAt[side] ?? now)) / 1000, 1 / 240, 0.05);
        fore = prev + THREE.MathUtils.clamp(fore - prev, -step, step);
      }
      this.forePrev[side] = fore;
      this.foreAt[side] = now;
      // the forearm bone: its own axis along the forearm, its palm side turned that far from palm-in
      const side2 = _c.copy(neutral).applyAxisAngle(ax, sg * fore);
      _y.copy(tw.palm);
      _mw.makeBasis(ax, side2, _z.crossVectors(ax, side2));
      _ml.makeBasis(tw.axis, _y, _x.crossVectors(tw.axis, _y));
      _q.setFromRotationMatrix(_mw).multiply(_h.setFromRotationMatrix(_ml).invert());
      s.arm.fore.quaternion.copy(s.arm.upper.getWorldQuaternion(_h).invert().multiply(_q));
      s.arm.fore.updateMatrixWorld(true);
      // the hand as the pose has it: what's left of its turn is at the wrist
      s.arm.hand.quaternion.copy(s.arm.fore.getWorldQuaternion(_h).invert().multiply(quat));
      s.arm.hand.updateMatrixWorld(true);
      // (tests: the hand's turn from palm-in, and the forearm's)
      this.rolled[side] = turn;
      this.turned[side] = fore;
    }
    // the sleeve: from the elbow along the upper arm, and on past the shoulder over the body's cut edge.
    // No further: run on (as it once did, 0.6 m) it went past the eyes when an arm pointed back toward them
    s.arm.fore.getWorldPosition(_p);
    s.sleeve.position.copy(_p);
    _d.copy(_s).sub(_p);
    const len = Math.min(SLEEVE_LEN, _d.length() + SLEEVE_PAST - HEM);
    const tube = s.sleeve.children[0];
    s.len = len;
    tube.scale.y = len / SLEEVE_LEN;
    tube.position.x = HEM + len / 2;
    s.sleeve.children[2].position.x = HEM + len;
    s.sleeve.quaternion.setFromUnitVectors(_x.set(1, 0, 0), _d.normalize());
    s.sleeve.visible = true;
    // and bunched round the top of the forearm, toward the wrist
    s.cuff.position.copy(_p);
    s.cuff.quaternion.setFromUnitVectors(_x.set(1, 0, 0), _d.copy(wrist).sub(_p).normalize());
    s.cuff.visible = true;
    // each joint: its rest in the hand's frame, turned as the rig's hinge is; into its parent's frame
    const pose = (chain: Side['fingers'][number], q: THREE.Quaternion[]) => {
      _prev.identity();
      chain.forEach((j, i) => {
        _h.copy(q[i] ?? _q.identity()).multiply(j.rest);
        j.bone.quaternion.copy(_prev).invert().multiply(_h);
        _prev.copy(_h);
      });
    };
    s.fingers.forEach((chain, f) => pose(chain, turns.fingers[f] ?? []));
    pose(s.thumb, turns.thumb);
    s.arm.hand.updateMatrixWorld(true);
  }

  /**
   * tests: an arm's shoulder, elbow and wrist as drawn (world), its length, and how far its skin stands
   * out of the bunched sleeve at the most (m: ≤ 0 all inside it) and where (m down the forearm); null
   * when it isn't drawn
   */
  joints(side: HandSide): { sh: THREE.Vector3; el: THREE.Vector3; wr: THREE.Vector3; reach: number; cuff: { out: number; at: number }; end: THREE.Vector3 } | null {
    const s = this.sides[side];
    if (!s?.mesh.visible) return null;
    const el = s.arm.fore.getWorldPosition(new THREE.Vector3());
    const wr = s.arm.hand.getWorldPosition(new THREE.Vector3());
    const ax = wr.clone().sub(el).normalize();
    const v = new THREE.Vector3();
    const cuff = { out: -1, at: 0 };
    for (const k of new Set(s.mesh.geometry.index!.array)) {
      s.mesh.localToWorld(s.mesh.getVertexPosition(k, v)).sub(el);
      const t = v.dot(ax);
      if (t < 0 || t > CUFF) continue;
      const out = v.addScaledVector(ax, -t).length() - cuffRadius(t);
      if (out > cuff.out) Object.assign(cuff, { out, at: t });
    }
    // (and where the sleeve tube ends, past the shoulder)
    const end = s.sleeve.localToWorld(new THREE.Vector3(HEM + s.len, 0, 0));
    return { sh: s.arm.upper.getWorldPosition(new THREE.Vector3()), el, wr, reach: s.reach, cuff, end };
  }

  /** tests: each forearm's turn from palm-in as last drawn, and its hand's (rad, + toward palm-up) */
  turned: Partial<Record<HandSide, number>> = {};
  rolled: Partial<Record<HandSide, number>> = {};
  /** each forearm's turn from palm-in last frame, and when (performance.now ms) */
  private forePrev: Partial<Record<HandSide, number>> = {};
  private foreAt: Partial<Record<HandSide, number>> = {};

  setLather(side: HandSide, region: LatherRegion, c: number) {
    this.layers?.setLather(side, region, c);
  }

  setWet(side: HandSide, k: number) {
    this.layers?.setWet(side, k);
  }

  setGloves(side: HandSide, k: number) {
    this.layers?.setGloves(side, k);
    // (a glove's cuff is made the first time it is needed, drawn whether its arm is out or not)
    this.layers?.setShown(side, this.shown[side]);
  }

  hideSide(side: HandSide) {
    delete this.forePrev[side];
    const s = this.sides[side];
    if (s) s.mesh.visible = s.sleeve.visible = s.cuff.visible = false;
    if (!this.shown[side]) return;
    this.shown[side] = false;
    this.layers?.setShown(side, false);
  }

  private dispose() {
    this.disposed = true;
    shared.delete(this.scene);
    this.layers?.dispose();
    for (const s of Object.values(this.sides)) {
      if (!s) continue;
      // (the arm's geometry is not disposed: its vertex buffers are the body model's, which other people
      // in the scene may wear; disposing it would free those too)
      s.mesh.removeFromParent();
      this.scene.remove(s.sleeve, s.cuff);
      // (the cuff shares the sleeve's material)
      for (const g of [s.sleeve, s.cuff])
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
    }
    if (this.ch) {
      this.scene.remove(this.ch.root);
      this.ch.dispose?.();
    }
  }
}

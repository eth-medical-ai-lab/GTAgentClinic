/**
 * Waiting-room reading and typing (content/ambient.ts): an old-school broadsheet held open in both
 * hands, a page turned now and then; a laptop open on the lap, typed on. Both are floor props of the
 * crowd (accessories.ts, mount 'root'), posed each frame by crowd.ts with the functions below, and the
 * arms follow them with the same two-bone IK as the player's hands (hands.ts).
 *
 * Off the act (talking, looking at the TV, standing, walking) the paper is folded on the lap or carried
 * at the side, and the laptop closed on the lap or carried at the side.
 *
 * Sizes are real: a broadsheet page 0.375 × 0.57 m, a 13" laptop 0.31 × 0.215 m.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AvatarCharacter } from './avatars';
import { armBones, handQuat, reachArm, type ArmBones, type HandSide } from './hands';
import { canvasTexture, makeCanvas, own, trackGeo } from './materials';

const PAGE_W = 0.375;
const PAGE_H = 0.57;
/** the pages make a shallow V toward the reader; the spread leans back a little */
const PAGE_ANGLE = 0.2;
const TILT = 0.16;
/** a turn swings the right page from its angle through the reader's side onto the left page's angle */
const SWEEP = Math.PI - 2 * PAGE_ANGLE;

// ───────────────────────────── textures ─────────────────────────────

let paperMat: THREE.MeshStandardMaterial | null = null;
type PageKind = 'front' | 'inside' | 'back';
/** where each page is in the atlas (thirds, left to right) */
const PAGE_U: Record<PageKind, number> = { front: 0, inside: 1 / 3, back: 2 / 3 };

/** one atlas: the front page, an inside page and the back page (sport), side by side */
function newsprint(): THREE.MeshStandardMaterial {
  if (paperMat) return paperMat;
  const { canvas, ctx } = makeCanvas(1536, 768);
  const page = (x0: number, kind: PageKind) => {
    const front = kind === 'front';
    ctx.fillStyle = '#e9e6dc';
    ctx.fillRect(x0, 0, 512, 768);
    ctx.fillStyle = '#1b1b1b';
    const line = (x: number, y: number, w: number, h = 3) => ctx.fillRect(x0 + x, y, w, h);
    if (front) {
      ctx.font = '700 46px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.fillText('The Evening Courier', x0 + 256, 62, 480);
      line(16, 76, 480, 2);
      ctx.font = '500 13px Georgia, serif';
      ctx.fillText('THURSDAY · LATE EDITION · $2.00', x0 + 256, 94);
      line(16, 102, 480, 2);
      ctx.font = '700 34px Georgia, serif';
      ctx.fillText('River bridge to close', x0 + 256, 146, 470);
      ctx.fillText('for repairs in spring', x0 + 256, 184, 470);
      ctx.fillStyle = '#8f8c86';
      ctx.fillRect(x0 + 20, 204, 300, 190);
      ctx.fillStyle = '#6d6a65';
      ctx.fillRect(x0 + 40, 300, 260, 94);
    } else if (kind === 'back') {
      // the back page: sport, a big photo, the scores
      ctx.font = '700 40px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText('SPORT', x0 + 18, 50);
      line(16, 62, 480, 3);
      ctx.font = '700 30px Georgia, serif';
      ctx.fillText('Late goal sends City', x0 + 18, 104, 470);
      ctx.fillText('into the cup final', x0 + 18, 140, 470);
      ctx.fillStyle = '#8f8c86';
      ctx.fillRect(x0 + 18, 158, 476, 220);
      ctx.fillStyle = '#6d6a65';
      ctx.fillRect(x0 + 60, 250, 180, 128);
      ctx.fillRect(x0 + 290, 230, 150, 148);
    } else {
      ctx.font = '700 22px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText('CITY & REGION', x0 + 18, 38);
      line(16, 48, 480, 2);
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText('New buses for the night routes', x0 + 18, 86, 470);
      ctx.fillStyle = '#8f8c86';
      ctx.fillRect(x0 + 330, 104, 160, 120);
    }
    ctx.fillStyle = '#4a4844';
    // body text: columns of grey lines
    const cols = front
      ? [[336, 204, 160], [20, 410, 150], [180, 410, 150], [340, 410, 150]]
      : kind === 'back'
        ? [[18, 392, 150], [180, 392, 150], [340, 392, 150]]
        : [[18, 104, 150], [176, 104, 140], [18, 250, 150], [176, 250, 150], [334, 250, 160]];
    for (const [x, y, w] of cols) for (let yy = y + 6; yy < 740; yy += 11) if ((yy * 7 + x) % 97 > 6) line(x, yy, w - ((yy * 13 + x) % 31 < 4 ? 40 : 0), 4);
    if (kind === 'back') {
      // results table, bottom right
      ctx.fillStyle = '#e9e6dc';
      ctx.fillRect(x0 + 336, 560, 158, 170);
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 340, 560, 150, 166);
      ctx.font = '700 18px Georgia, serif';
      ctx.fillStyle = '#1b1b1b';
      ctx.fillText('RESULTS', x0 + 360, 590);
      ctx.fillStyle = '#4a4844';
      for (let i = 0; i < 9; i++) line(350, 604 + i * 13, 130 - ((i * 29) % 40), 4);
    } else if (!front) {
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 340, 560, 150, 160);
      ctx.font = '700 20px Georgia, serif';
      ctx.fillStyle = '#1b1b1b';
      ctx.fillText('WEATHER', x0 + 360, 596);
    }
  };
  page(0, 'front');
  page(512, 'inside');
  page(1024, 'back');
  paperMat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.93, metalness: 0 }));
  return paperMat;
}

let laptopMats: { body: THREE.MeshStandardMaterial; keys: THREE.MeshStandardMaterial; screen: THREE.MeshStandardMaterial } | null = null;
function laptopMaterials() {
  if (laptopMats) return laptopMats;
  const k = makeCanvas(256, 160);
  k.ctx.fillStyle = '#2b2e33';
  k.ctx.fillRect(0, 0, 256, 160);
  k.ctx.fillStyle = '#121417';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 13; c++) k.ctx.fillRect(10 + c * 18.5, 8 + r * 17, 15, 14);
  k.ctx.fillRect(60, 8 + 5 * 17, 130, 14);
  k.ctx.fillStyle = '#34383e';
  k.ctx.fillRect(84, 112, 88, 44);
  const s = makeCanvas(256, 160);
  s.ctx.fillStyle = '#f4f6f8';
  s.ctx.fillRect(0, 0, 256, 160);
  s.ctx.fillStyle = '#2a5ea8';
  s.ctx.fillRect(0, 0, 256, 16);
  s.ctx.fillStyle = '#dfe5ec';
  s.ctx.fillRect(0, 16, 64, 144);
  s.ctx.fillStyle = '#9aa6b3';
  for (let i = 0; i < 9; i++) s.ctx.fillRect(8, 26 + i * 14, 46, 5);
  s.ctx.fillStyle = '#4a5562';
  for (let i = 0; i < 10; i++) s.ctx.fillRect(74, 26 + i * 12, i === 0 ? 120 : 150 - ((i * 37) % 60), 4);
  laptopMats = {
    body: own(new THREE.MeshStandardMaterial({ color: '#8b9097', roughness: 0.35, metalness: 0.7 })),
    keys: own(new THREE.MeshStandardMaterial({ map: canvasTexture(k.canvas), roughness: 0.6, metalness: 0.2 })),
    screen: own(new THREE.MeshStandardMaterial({ color: '#0b0f14', emissive: '#ffffff', emissiveMap: canvasTexture(s.canvas), emissiveIntensity: 0.95, roughness: 0.25 })),
  };
  return laptopMats;
}

// ───────────────────────────── geometry ─────────────────────────────

/** one page: two faces back to back (outside: the given page, away from the reader; inside: an inside page), centred at x */
function pageGeo(cx: number, outside: PageKind): THREE.BufferGeometry {
  const face = (kind: PageKind, flip: boolean) => {
    const g = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 1, 1);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, PAGE_U[kind] + uv.getX(i) / 3);
    if (flip) g.rotateY(Math.PI);
    g.translate(cx, 0, flip ? -0.0008 : 0.0008);
    return g;
  };
  return mergeGeometries([face(outside, false), face('inside', true)], false)!;
}

/** a broadsheet: the open spread, a page that turns, and the paper folded in four */
export function buildNewspaper(): THREE.Group {
  const mat = newsprint();
  const g = new THREE.Group();
  const open = new THREE.Group();
  open.name = 'open';
  // the reader's left page (+x) and right page (−x); outer edges angled toward the reader (−z).
  // Opened like a book, the front page's leaf swings over to the reader's left: the masthead is on the
  // outside of the LEFT page (on the right as you face the reader), the back page on the other.
  const left = new THREE.Mesh(trackGeo(pageGeo(PAGE_W / 2, 'front').rotateY(PAGE_ANGLE)), mat);
  const right = new THREE.Mesh(trackGeo(pageGeo(-PAGE_W / 2, 'back').rotateY(-PAGE_ANGLE)), mat);
  right.name = 'rightPage';
  open.add(left, right);
  // a page turn is an inner leaf (inside pages both sides) swinging over on the reader's side: the outer
  // sheet stays put, so from the front the paper doesn't change. Its hinge sits 4 mm toward the reader,
  // so the leaf never shares a plane with the pages it starts and lands on (no flicker)
  const turn = new THREE.Group();
  turn.name = 'turn';
  turn.position.z = -0.004;
  turn.add(new THREE.Mesh(trackGeo(pageGeo(-PAGE_W / 2, 'inside')), mat));
  turn.visible = false;
  open.add(turn);
  g.add(open);
  // folded in four, the top half of the front page (the masthead) shows
  const fold = new THREE.BoxGeometry(PAGE_W * 0.78, 0.012, PAGE_H / 2 + 0.01);
  const fuv = fold.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, PAGE_U.front + (0.11 + fuv.getX(i) * 0.78) / 3, 0.5 + fuv.getY(i) * 0.5);
  const folded = new THREE.Mesh(trackGeo(fold), mat);
  folded.name = 'folded';
  g.add(folded);
  return g;
}

/** a 13-inch laptop: base with keyboard, a lid on a hinge at the back with a lit screen */
export function buildLaptop(): THREE.Group {
  const m = laptopMaterials();
  const g = new THREE.Group();
  const base = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.31, 0.015, 0.215)), m.body);
  base.position.y = 0.0075;
  const keys = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.29, 0.18).rotateX(-Math.PI / 2)), m.keys);
  keys.position.set(0, 0.0152, 0.005);
  const lid = new THREE.Group();
  lid.name = 'lid';
  // hinge on the far edge of the base; closed, the lid lies on the base reaching toward the user (−z)
  lid.position.set(0, 0.015, 0.1075);
  const shell = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.31, 0.006, 0.215)), m.body);
  shell.position.set(0, 0.003, -0.1075);
  const screen = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.28, 0.18).rotateX(Math.PI / 2)), m.screen);
  screen.position.set(0, -0.0002, -0.1075);
  lid.add(shell, screen);
  g.add(base, keys, lid);
  return g;
}

/** World.dispose (via accessories.disposeProps): materials are freed with the caches, so build new ones next time */
export function disposeReading() {
  paperMat = null;
  laptopMats = null;
}

// ───────────────────────────── poses ─────────────────────────────

/** dev aid: ?pageturn=fast turns a page every 6 s (screenshots) */
const FAST_TURNS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('pageturn') === 'fast';

/** how far through a page turn (0 = none) for a reader, from the clock: one turn every 18–40 s */
export function turnPhase(seed: number, now: number): number {
  const period = FAST_TURNS ? 6 : 18 + (seed % 23);
  const t = (now / 1000 + (seed % 97) * 0.37) % period;
  return t < 1.5 ? t / 1.5 : 0;
}

interface Lap {
  thighs: THREE.Object3D[];
  calves: THREE.Object3D[];
  /** the top of the thigh above the hip–knee line where things rest on it (m, measured once on the skin) */
  top?: number;
}
const laps = new WeakMap<AvatarCharacter, Lap | null>();
const LAP_AT = 0.6;

function lapOf(av: AvatarCharacter): Lap | null {
  if (laps.has(av)) return laps.get(av)!;
  if (!av.ready) return null;
  const find = (re: RegExp) => {
    let hit: THREE.Object3D | undefined;
    av.root.traverse((o) => {
      if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
    });
    return hit;
  };
  const thighs = [find(/_L_Thigh$/), find(/_R_Thigh$/)];
  const calves = [find(/_L_Calf$/), find(/_R_Calf$/)];
  const lap = thighs.every(Boolean) && calves.every(Boolean) ? { thighs: thighs as THREE.Object3D[], calves: calves as THREE.Object3D[] } : null;
  laps.set(av, lap);
  return lap;
}

/** how high the thigh's skin is over the hip–knee line at the lap point: the highest vertex the thigh moves there */
function thighTop(av: AvatarCharacter, lap: Lap): number {
  if (lap.top !== undefined) return lap.top;
  av.root.updateMatrixWorld(true);
  const H = lap.thighs[0].getWorldPosition(new THREE.Vector3());
  const K = lap.calves[0].getWorldPosition(new THREE.Vector3());
  const HK = K.clone().sub(H);
  const L2 = HK.lengthSq();
  const v = new THREE.Vector3();
  let best = -Infinity;
  av.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const bi = m.skeleton.bones.indexOf(lap.thighs[0] as THREE.Bone);
    if (bi < 0) return;
    const si = m.geometry.getAttribute('skinIndex');
    const sw = m.geometry.getAttribute('skinWeight');
    const n = m.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      let top = 0;
      let w = -1;
      for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) > w) ((w = sw.getComponent(i, j)), (top = si.getComponent(i, j)));
      if (top !== bi) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      const t = v.clone().sub(H).dot(HK) / L2;
      if (Math.abs(t - LAP_AT) > 0.06) continue;
      best = Math.max(best, v.y - (H.y + HK.y * t));
    }
  });
  // (clothes included: whatever the thigh's top is, a coat's skirt or trousers)
  lap.top = Number.isFinite(best) && best > 0.03 && best < 0.2 ? best : 0.08;
  return lap.top;
}

const _h = new THREE.Vector3();
const _k = new THREE.Vector3();

/**
 * Rest something flat on the thighs (in the body's root frame): across both, LAP_AT of the way from
 * hip to knee, tilted with them, its underside `bottom` below its origin and `lift` over the cloth.
 * false until the skeleton is in (the caller keeps a fixed pose meanwhile).
 */
export function onLap(av: AvatarCharacter, obj: THREE.Object3D, bottom: number, lift: number, yawExtra = 0): boolean {
  const lap = lapOf(av);
  if (!lap) return false;
  av.root.updateMatrixWorld(true);
  const top = thighTop(av, lap);
  let px = 0;
  let pz = 0;
  let py = -Infinity;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (let i = 0; i < 2; i++) {
    const H = av.root.worldToLocal(lap.thighs[i].getWorldPosition(_h));
    const K = av.root.worldToLocal(lap.calves[i].getWorldPosition(_k));
    px += (H.x + (K.x - H.x) * LAP_AT) / 2;
    pz += (H.z + (K.z - H.z) * LAP_AT) / 2;
    // a crossed leg is higher: it rests on that one
    py = Math.max(py, H.y + (K.y - H.y) * LAP_AT);
    dx += K.x - H.x;
    dy += K.y - H.y;
    dz += K.z - H.z;
  }
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  obj.position.set(px, py + top + bottom + lift, pz);
  obj.rotation.set(-pitch, Math.atan2(dx, dz) + yawExtra, 0, 'YXZ');
  return true;
}

/** place the paper: open in front of the face (reading), folded on the lap (seated), at the side (standing) */
export function poseNewspaper(obj: THREE.Object3D, mode: 'read' | 'lap' | 'carry', k: number, phase: number, av?: AvatarCharacter) {
  const open = obj.getObjectByName('open')!;
  const folded = obj.getObjectByName('folded')!;
  const turn = obj.getObjectByName('turn')!;
  open.visible = mode === 'read';
  folded.visible = mode !== 'read';
  if (mode === 'read') {
    obj.position.set(0, 1.05 * k, 0.41 * k);
    obj.rotation.set(-TILT, 0, 0);
    // an inner leaf lifts off the reader's right page, swings over toward the reader and lands on the left
    turn.visible = phase > 0;
    turn.rotation.y = -PAGE_ANGLE - SWEEP * Math.sin((Math.PI / 2) * phase) ** 2;
  } else if (mode === 'lap') {
    // folded on the thighs themselves (the folded box is 12 mm thick, centred): a few millimetres over the cloth
    if (!av || !onLap(av, obj, 0.006, 0.006, 0.25)) {
      obj.position.set(0.04, 0.615 * k, 0.24 * k);
      obj.rotation.set(0, 0.25, 0);
    }
  } else {
    obj.position.set(-0.235 * k, 0.75 * k, 0.04);
    obj.rotation.set(0, Math.PI / 2, Math.PI / 2);
  }
}

/** place the laptop: open on the lap (typing), closed on the lap (seated), closed at the side (standing) */
export function poseLaptop(obj: THREE.Object3D, mode: 'type' | 'lap' | 'carry', k: number, av?: AvatarCharacter) {
  const lid = obj.getObjectByName('lid')!;
  if (mode === 'carry') {
    obj.position.set(-0.24 * k, 0.72 * k, 0.03);
    obj.rotation.set(0, Math.PI / 2, Math.PI / 2);
    lid.rotation.x = 0;
    return;
  }
  // its base on the thighs themselves (origin at the base's underside)
  if (!av || !onLap(av, obj, 0, 0.004)) {
    obj.position.set(0, 0.612 * k, 0.29 * k);
    obj.rotation.set(-0.05, 0, 0);
  }
  // open about 110°; closed on the lap otherwise
  const want = mode === 'type' ? 1.92 : 0;
  lid.rotation.x += (want - lid.rotation.x) * 0.2;
}

interface Rig {
  R: ArmBones;
  L: ArmBones;
  head: THREE.Object3D | null;
}
const rigs = new WeakMap<AvatarCharacter, Rig | null>();
function rigOf(av: AvatarCharacter): Rig | null {
  if (rigs.has(av)) return rigs.get(av)!;
  if (!av.ready) return null;
  const R = armBones(av.root, 'R');
  const L = armBones(av.root, 'L');
  const rig = R && L ? { R, L, head: av.head } : null;
  rigs.set(av, rig);
  return rig;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * After the mocap (AvatarCharacter.postPose): both hands on the paper's outer edges (the right one
 * follows the page as it turns), or on the laptop's keyboard, typing. w eases the hold in and out.
 */
export function holdPose(av: AvatarCharacter, obj: THREE.Object3D, what: 'read' | 'type', w: number, t: number, seed: number) {
  const rig = rigOf(av);
  if (!rig || w < 0.01) return;
  obj.updateWorldMatrix(true, false);
  av.root.getWorldQuaternion(_qr);
  _f.set(0, 0, 1).applyQuaternion(_qr);
  _x.set(1, 0, 0).applyQuaternion(_qr); // the character's left
  for (const side of ['R', 'L'] as HandSide[]) {
    const arm = rig[side];
    const s = side === 'R' ? -1 : 1; // the character's right is −x
    if (what === 'read') {
      // the wrist just outside and behind the outer edge, a little below the middle; the palm faces the
      // paper's middle, the fingers wrap round the edge to the front, thumb up. Mid-turn the right hand
      // follows the turning page's edge
      const edge = side === 'R' ? turnEdge(obj, _t) : null;
      const local = edge ?? _t.set(s * (PAGE_W * Math.cos(PAGE_ANGLE) + 0.045), -0.06, -PAGE_W * Math.sin(PAGE_ANGLE) - 0.06);
      if (!edge) obj.localToWorld(local);
      arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.35).addScaledVector(_x, s * 0.35).addScaledVector(_f, -0.1);
      handQuat(side, _p.copy(_f).multiplyScalar(0.75).addScaledVector(_x, -s * 0.55), UP, _q);
      reachArm(arm, local, _pole, w, _q);
    } else {
      // wrists at the front of the keyboard; fingers tap
      const tap = 0.006 * Math.max(0, Math.sin(t * 15 + seed + (side === 'R' ? 0 : 1.7))) * (Math.sin(t * 0.7 + seed) > -0.6 ? 1 : 0);
      const local = _t.set(s * 0.075, 0.035 + tap, -0.085);
      obj.localToWorld(local);
      arm.upper.getWorldPosition(_pole).addScaledVector(UP, -0.4).addScaledVector(_x, s * 0.25).addScaledVector(_f, -0.2);
      handQuat(side, _p.copy(_f).addScaledVector(_x, -s * 0.15).addScaledVector(UP, -0.12), _x.clone().multiplyScalar(-s), _q);
      reachArm(arm, local, _pole, w, _q);
    }
  }
  // eyes on the page / the screen
  const head = rig.head;
  if (head?.parent) {
    const pitch = (what === 'type' ? 0.38 : 0.08) * w;
    const side = _p.set(1, 0, 0).applyQuaternion(_qr);
    head.parent.getWorldQuaternion(_q);
    const axis = side.applyQuaternion(_q.invert()).normalize();
    head.quaternion.premultiply(_q.setFromAxisAngle(axis, pitch));
  }
}

/** the turning page's free edge (world), while a page turns; null otherwise */
function turnEdge(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 | null {
  const turn = obj.getObjectByName('turn');
  if (!turn?.visible) return null;
  // past halfway the right hand lets go (the page falls onto the left one)
  if ((-PAGE_ANGLE - turn.rotation.y) / SWEEP > 0.55) return null;
  return turn.localToWorld(out.set(-PAGE_W - 0.045, -0.06, -0.05));
}

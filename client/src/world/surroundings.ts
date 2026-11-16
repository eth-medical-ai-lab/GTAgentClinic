/**
 * What you see beyond the hospital lot, in every direction:
 *
 *   north   the rest of the campus behind the ED: the main tower (rooftop sign, helipad with
 *           edge lights, mechanical penthouse) and a lower wing, a service road
 *   east    a five-level parking garage with a lit stair tower, office and apartment blocks
 *   west    a medical office building, apartment blocks
 *   south   past the street: a riverside park and promenade with lanterns, a quay with a railing,
 *           the river (moving ripples that streak the reflections), the far bank's buildings in
 *           two rows and a tied-arch road bridge strung with lights
 *   sides   the campus edge: brick piers, a low brick wall with a steel picket fence, a hedge
 *   beyond  a procedural city skyline band in the sky for everything past the camera's far plane
 *
 * Cheap at a distance: every building is a box in one merged mesh with one procedural façade
 * shader (one draw call; the style is a vertex attribute, no textures), plain parts share two
 * vertex-coloured paints, nothing far casts shadows, and the façades and the water receive none
 * and see only the sun and the reflection probe. Only the fence + hedge next to the lot cast sun
 * shadows, and only the street lights in front of the hospital are real lights.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial, type Node as TslNode } from 'three/webgpu';
import { abs, asin, atan, attribute, cameraViewMatrix, clamp, float, floor, fract, fwidth, int, max, mix, normalWorld, positionWorld, pow, select, sin, smoothstep, step, time, uniform, uniformArray, vec3, vec4 } from 'three/tsl';
import type { ExtLight } from './exterior';
import { G, add, canvasTexture, makeCanvas, own, pbr, trackGeo } from './materials';
import { outdoor, solid } from './vehicles';

/** what the surroundings need to know about the lot */
export interface SurroundInput {
  W: number;
  D: number;
  lotX0: number;
  lotX1: number;
  perimZ1: number;
  streetZ0: number;
  streetZ1: number;
  /** driveway spans along x (no poles in them) */
  driveways: [number, number][];
}

export interface Surroundings {
  colliders: THREE.Box3[];
  lights: ExtLight[];
  setNight(night: boolean): void;
}

type F1 = TslNode<'float'>;
type V3 = TslNode<'vec3'>;
type V4 = TslNode<'vec4'>;

/** hash of two cell indices + a seed → 0..1 (TSL) */
function hash2(a: F1, b: F1, seed: number | F1): F1 {
  return fract(sin(a.mul(127.1).add(b.mul(311.7)).add(seed)).mul(43758.5453)) as F1;
}

/** anti-aliased 1 inside [a, b] of a repeating 0..1 coordinate */
function band(f: F1, a: number | F1, b: number | F1): F1 {
  const w = max(fwidth(f), 0.0008);
  const A = typeof a === 'number' ? float(a) : a;
  const B = typeof b === 'number' ? float(b) : b;
  return smoothstep(A.sub(w), A.add(w), f).mul(float(1).sub(smoothstep(B.sub(w), B.add(w), f))) as F1;
}

export interface FacadeStyle {
  /** window bay width and floor height (m) */
  bay: number;
  floor: number;
  /** window opening inside a bay / floor cell (fractions) */
  win: [number, number, number, number];
  wall: string;
  glass: string;
  /** share of window groups lit at night, share of those with warm light */
  lit: number;
  warm: number;
  /** bays switched on and off together at night (open-plan offices light whole zones) */
  group: number;
  /** glass roughness (garage decks are matte, and get no shopfronts) */
  glassRough?: number;
}

export const STYLE_KEYS = ['hospital', 'office', 'apartment', 'brick', 'garage', 'tower'] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export const STYLES: Record<StyleKey, FacadeStyle> = {
  hospital: { bay: 1.6, floor: 4.2, win: [0.04, 0.96, 0.3, 0.74], wall: '#d8d5ce', glass: '#2c3943', lit: 0.62, warm: 0.4, group: 2 },
  office: { bay: 1.5, floor: 4.0, win: [0.06, 0.94, 0.14, 0.86], wall: '#3d4852', glass: '#3b4d5a', lit: 0.24, warm: 0.15, group: 4 },
  apartment: { bay: 3.3, floor: 3.0, win: [0.22, 0.78, 0.3, 0.86], wall: '#c7beaf', glass: '#2a3137', lit: 0.4, warm: 0.85, group: 1 },
  brick: { bay: 2.9, floor: 3.1, win: [0.25, 0.75, 0.28, 0.84], wall: '#8c5442', glass: '#262d33', lit: 0.38, warm: 0.85, group: 1 },
  garage: { bay: 8.4, floor: 3.2, win: [0.05, 0.95, 0.4, 0.97], wall: '#a6a49d', glass: '#15171a', lit: 0.97, warm: 0.0, group: 1, glassRough: 0.95 },
  tower: { bay: 1.5, floor: 3.8, win: [0.05, 0.95, 0.1, 0.9], wall: '#2f3a44', glass: '#455c6c', lit: 0.28, warm: 0.12, group: 5 },
};

/**
 * One procedural façade shader for every building (one pipeline, one draw call). Each vertex
 * carries `facade` = (style index + 0.25 + building random / 2, grid origin x, grid origin z,
 * roof height); the style's numbers come from a uniform array. A world-space window grid (u runs
 * along whichever horizontal axis the wall faces, v is height), shopfronts on the ground floor,
 * glossy glass that reflects the probe, matte walls. At night each window group is lit or dark
 * by hash, warm or cool, brighter toward its ceiling.
 */
export function facadeMaterial(): { mat: THREE.MeshStandardMaterial; night: { value: number } } {
  const vals: THREE.Vector4[] = [];
  for (const key of STYLE_KEYS) {
    const st = STYLES[key];
    const wall = new THREE.Color(st.wall);
    const glass = new THREE.Color(st.glass);
    vals.push(new THREE.Vector4(st.bay, st.floor, st.win[0], st.win[1]), new THREE.Vector4(st.win[2], st.win[3], st.lit, st.warm));
    vals.push(new THREE.Vector4(wall.r, wall.g, wall.b, st.glassRough ?? 0.06), new THREE.Vector4(glass.r, glass.g, glass.b, st.group));
  }
  const P = uniformArray(vals, 'vec4');
  const fa = attribute('facade', 'vec4');
  const si = floor(fa.x);
  const rb = fract(fa.x).sub(0.25).mul(2);
  const i0 = int(si).mul(4);
  const el = (i: TslNode<'int'>) => P.element(i) as unknown as V4;
  const s0 = el(i0);
  const s1 = el(i0.add(1));
  const s2 = el(i0.add(2));
  const s3 = el(i0.add(3));
  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const uNight = uniform(1);
  const p = positionWorld;
  const n = normalWorld;
  const side = abs(n.x).greaterThan(abs(n.z));
  const u = select(side, p.z.sub(fa.z), p.x.sub(fa.y)) as F1;
  const cu = u.div(s0.x) as F1;
  const cv = p.y.div(s0.y) as F1;
  const iu = floor(cu) as F1;
  const iv = floor(cv) as F1;
  const fv = fract(cv) as F1;
  // ground floor: tall shopfront glazing (not on the garage)
  const shop = step(cv, 1).mul(step(s2.w, 0.5));
  const gx0 = mix(s0.z, 0.08, shop) as F1;
  const gx1 = mix(s0.w, 0.92, shop) as F1;
  const gy0 = mix(s1.x, 0.06, shop) as F1;
  const gy1 = mix(s1.y, 0.8, shop) as F1;
  const roof = step(0.7, abs(n.y));
  // whole windows only: none that would run into the parapet
  const fits = step(iv.add(gy1).mul(s0.y), fa.w.sub(0.8));
  const win = band(fract(cu) as F1, gx0, gx1).mul(band(fv, gy0, gy1)).mul(float(1).sub(roof)).mul(fits);
  const seed = si.mul(17.3).add(rb.mul(61.7)).add(select(side, float(7.7), float(0))).add(n.x.add(n.z).sign().mul(3.1)) as F1;
  const h = hash2(floor(iu.div(s3.w)) as F1, iv, seed);
  const h2 = hash2(iv, iu, seed.add(7.3) as F1);
  // by day some windows show drawn blinds (lighter), the rest dark reflective glass
  const glass = mix(s3.xyz, vec3(0.62, 0.6, 0.55), step(0.82, h2).mul(0.6));
  m.colorNode = vec4(mix(s2.xyz.mul(rb.mul(0.12).add(0.94)), glass, win), 1);
  m.roughnessNode = mix(float(0.86), s2.w, win);
  const lit = step(float(1).sub(s1.z), h).max(shop.mul(step(0.45, h2)));
  const tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.74, 0.46), step(float(1).sub(s1.w), h2));
  const prof = mix(float(0.7), float(1.15), smoothstep(gy0, gy1, fv));
  m.emissiveNode = tint.mul(win.mul(lit).mul(float(0.3).add(h2.mul(0.55))).mul(prof).mul(uNight).mul(0.9));
  outdoor(m, 1);
  m.userData.farLights = true;
  return { mat: m as unknown as THREE.MeshStandardMaterial, night: uNight };
}

/**
 * River water: dark, glossy, with slow ripples (four directional waves, flowing along +x) that
 * break up the reflections of the lit far bank and the bridge into streaks.
 */
export function waterMaterial(): THREE.MeshStandardMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.07, metalness: 0 });
  const p = positionWorld.xz;
  let sx: F1 = float(0);
  let sz: F1 = float(0);
  for (const [dx, dz, k, sp, a] of [
    [1, 0.15, 0.9, 0.7, 0.05],
    [0.6, 0.8, 1.7, 1.1, 0.03],
    [-0.4, 1.0, 3.1, 1.6, 0.018],
    [0.95, -0.3, 5.3, 2.2, 0.01],
  ]) {
    const ph = p.x.mul(dx * k).add(p.y.mul(dz * k)).sub(time.mul(sp));
    const c = ph.cos().mul(a * k);
    sx = sx.add(c.mul(dx)) as F1;
    sz = sz.add(c.mul(dz)) as F1;
  }
  const nW = vec3(sx.negate(), 1, sz.negate()).normalize();
  m.normalNode = cameraViewMatrix.mul(vec4(nW, 0)).xyz.normalize();
  m.colorNode = vec4(0.018, 0.04, 0.046, 1);
  outdoor(m, 1.3);
  m.userData.farLights = true;
  return m as unknown as THREE.MeshStandardMaterial;
}

const h1 = (x: F1) => fract(sin(x.mul(12.9898)).mul(43758.5453)) as F1;

/**
 * A city skyline painted into the sky right above the horizon (everything past the camera's far
 * plane): low-rise, mid-rise and a few towers with aviation lights, denser toward the river (south).
 * Returns the band's color and coverage for a world direction; by day the buildings are a little
 * darker than the haze, at night dark with lit windows.
 */
export function skylineBand(dirN: V3, uNight: { value: number }, haze: V3): { color: V3; cover: F1 } {
  const nightU = uNight as unknown as F1;
  const e = asin(clamp(dirN.y, -1, 1)).mul(180 / Math.PI) as F1;
  const a = atan(dirN.z, dirN.x).div(Math.PI * 2).add(0.5) as F1;
  const dens = float(0.45).add(max(float(0), a.sub(0.75).mul(Math.PI * 2).cos()).mul(0.55));
  const i1 = floor(a.mul(170)) as F1;
  const hBig = select(h1(i1).greaterThan(0.3), float(0.35).add(pow(h1(i1.add(0.37)), 2).mul(2.4)).mul(dens), float(0));
  const i2 = floor(a.mul(560)) as F1;
  const hLow = float(0.15).add(h1(i2.add(0.71)).mul(0.8)).mul(dens.mul(0.4).add(0.6));
  const i3 = floor(a.mul(90)) as F1;
  const tall = h1(i3.add(0.13)).greaterThan(0.84);
  const hTower = select(tall, float(2.4).add(h1(i3.add(0.53)).mul(3.4)).mul(dens), float(0));
  const h = max(max(hBig, hLow), hTower) as F1;
  const cover = step(e, h).mul(step(-0.7, e)) as F1;
  // windows: a fine grid of small dots, a quarter of them lit
  const wa = a.mul(1800);
  const we = e.mul(6);
  const lit = step(0.74, hash2(floor(wa) as F1, floor(we) as F1, 3.1)).mul(step(fract(wa), 0.55)).mul(step(fract(we), 0.5));
  // aviation lights blink on the towers' tops
  const onTop = step(h.sub(0.1), e).mul(step(abs(fract(a.mul(90)).sub(0.5)), 0.05)).mul(select(tall, float(1), float(0)));
  const blink = step(0.5, fract(time.mul(0.5).add(h1(i3))));
  const day = haze.mul(vec3(0.8, 0.83, 0.88));
  const night = vec3(0.006, 0.006, 0.007).add(vec3(0.85, 0.7, 0.48).mul(lit.mul(0.32))).add(vec3(1.0, 0.06, 0.03).mul(onTop.mul(blink).mul(1.8)));
  return { color: mix(day, night, nightU) as V3, cover };
}

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
}

/**
 * A building in the shared façade shader: a box snapped to whole window bays (about its centre),
 * so no window is cut at a corner, plus a roof slab that hides the box top. Bottom at y0.
 * Returns the snapped extents.
 */
function block(k: Kit, st: StyleKey, x0: number, z0: number, x1: number, z1: number, h: number, y0 = 0): Box {
  const bay = STYLES[st].bay;
  const snap = (a: number, b: number): [number, number] => {
    const w = Math.max(1, Math.round((b - a) / bay)) * bay;
    return [(a + b) / 2 - w / 2, (a + b) / 2 + w / 2];
  };
  [x0, x1] = snap(x0, x1);
  [z0, z1] = snap(z0, z1);
  const g = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
  g.translate((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
  const v = STYLE_KEYS.indexOf(st) + 0.25 + k.rnd() * 0.5;
  const n = g.getAttribute('position').count;
  const fa = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) fa.set([v, x0, z0, y0 + h], i * 4);
  g.setAttribute('facade', new THREE.BufferAttribute(fa, 4));
  k.boxes.push(g);
  paint(k.far, G.box(x1 - x0 + 0.5, 0.6, z1 - z0 + 0.5), ROOF, false, (x0 + x1) / 2, y0 + h + 0.3, (z0 + z1) / 2);
  // obstruction lights on the roof corners of tall buildings
  if (y0 + h > 40) for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) add(k.far, G.sphere(0.3, 8, 6), k.red, x, y0 + h + 0.85, z);
  return { x0, z0, x1, z1, h };
}

const ROOF = '#55595c';

/** a plain painted box (penthouse, plant room) with a roof slab */
function solidBlock(k: Kit, color: string, x0: number, z0: number, x1: number, z1: number, h: number, y0 = 0) {
  paint(k.far, G.box(x1 - x0, h, z1 - z0), color, false, (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
  paint(k.far, G.box(x1 - x0 + 0.5, 0.6, z1 - z0 + 0.5), ROOF, false, (x0 + x1) / 2, y0 + h + 0.3, (z0 + z1) / 2);
}

/** canvas sign (lit at night through its emissive map) */
function signMat(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void, glow: number): THREE.MeshStandardMaterial {
  const px = 1024;
  const { canvas, ctx } = makeCanvas(px, Math.max(32, Math.round((px * h) / w)));
  draw(ctx, canvas.width, canvas.height);
  const t = canvasTexture(canvas);
  const m = own(outdoor(new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: glow, roughness: 0.5 })));
  m.userData.glow = glow;
  return m;
}

interface Kit {
  far: THREE.Object3D;
  /** façade boxes, merged into one mesh at the end */
  boxes: THREE.BufferGeometry[];
  glowMats: THREE.MeshStandardMaterial[];
  /** red obstruction lights */
  red: THREE.MeshStandardMaterial;
  rnd: () => number;
}

/** main tower behind the ED (sign, helipad, penthouse, obstruction lights) and the lower wing */
function campusNorth(k: Kit, s: SurroundInput) {
  const { far } = k;
  const { x0: tx0, x1: tx1, z0: tz0, z1: tz1, h: th } = block(k, 'hospital', s.W * 0.1, -46, s.W * 0.7, -22, 7 * 4.2 + 1.0);
  // projecting crown band, mechanical penthouse
  paint(far, G.box(tx1 - tx0 + 0.8, 1.3, tz1 - tz0 + 0.8), '#c4c1ba', false, (tx0 + tx1) / 2, th + 0.65, (tz0 + tz1) / 2);
  solidBlock(k, '#5a5f63', (tx0 + tx1) / 2 - 7, tz0 + 6, (tx0 + tx1) / 2 + 7, tz1 - 5, 4.6, th + 1.3);
  // rooftop sign facing the ED and the lot
  const sw = Math.min(26, (tx1 - tx0) * 0.62);
  const sign = signMat(sw, 2.6, (ctx, W, H) => {
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, W, H);
    // the name fills the space right of the red square, shrunk to fit (it is longer than the old one)
    const box = H * 0.52;
    const left = W * 0.03 + box + H * 0.22;
    const room = W * 0.97 - left;
    const name = 'Grand Therapies Medical Center';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = Math.round(H * 0.62);
    ctx.font = `700 ${px}px "Helvetica Neue", Arial, sans-serif`;
    const tw = ctx.measureText(name).width;
    if (tw > room) {
      px = Math.floor((px * room) / tw);
      ctx.font = `700 ${px}px "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.fillText(name, left + room / 2, H * 0.54);
    ctx.fillStyle = '#d23b33';
    ctx.fillRect(W * 0.03, H * 0.24, box, box);
    // the brand's A in the red square (a white cross on red would read as a national flag / protected emblem)
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(H * 0.46)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('A', W * 0.03 + H * 0.26, H * 0.52);
  }, 1.4);
  k.glowMats.push(sign);
  add(far, G.plane(sw, 2.6), sign, (tx0 + tx1) / 2, th - 2.2, tz1 + 0.06);
  // helipad on the west half of the roof: pad, H marking, green edge lights, wind sock
  const hx = tx0 + 9;
  const hz = (tz0 + tz1) / 2;
  const hy = th + 1.35;
  paint(far, G.cyl(7.6, 7.6, 0.3, 40), '#3b3f42', false, hx, hy, hz);
  const pad = signMat(14, 14, (ctx, W, H) => {
    ctx.fillStyle = '#3b3f42';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f2f2ee';
    ctx.lineWidth = W * 0.035;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(W * 0.36, H * 0.3, W * 0.07, H * 0.4);
    ctx.fillRect(W * 0.57, H * 0.3, W * 0.07, H * 0.4);
    ctx.fillRect(W * 0.36, H * 0.465, W * 0.28, H * 0.07);
  }, 0);
  add(far, G.circle(7.0, 40), pad, hx, hy + 0.16, hz, -Math.PI / 2, 0, 0);
  const green = solid('#9cff9c', 0.4, 0, { emissive: '#3dff6a', ei: 3 });
  const red = k.red;
  k.glowMats.push(green);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add(far, G.box(0.25, 0.18, 0.25), green, hx + Math.cos(a) * 7.7, hy + 0.2, hz + Math.sin(a) * 7.7);
  }
  paint(far, G.cyl(0.05, 0.05, 3.5, 6), '#cfd2d4', true, hx + 9.5, hy + 1.75, hz + 5);
  paint(far, G.cone(0.25, 1.4, 10), '#f07a1a', false, hx + 9.5 + 0.7, hy + 3.3, hz + 5, 0, 0, -Math.PI / 2);
  for (const [x, z] of [[tx0 + 0.4, tz1 - 0.4], [tx1 - 0.4, tz1 - 0.4], [tx0 + 0.4, tz0 + 0.4], [tx1 - 0.4, tz0 + 0.4]]) add(far, G.sphere(0.22, 10, 6), red, x, th + 1.55, z);
  // lower wing to the east
  block(k, 'hospital', tx1 - 2, -44, Math.max(tx1 + 24, s.W * 1.22), -22.8, 4 * 4.2 + 1.0);
}

/** parking garage east of the lot (stair tower, P sign), office + apartments beyond */
function campusEast(k: Kit, s: SurroundInput) {
  const { far } = k;
  const gar = block(k, 'garage', s.lotX1 + 10, -5, s.lotX1 + 48, Math.min(s.streetZ0 - 8, 40), 5 * 3.2 + 0.9);
  const gx0 = gar.x0;
  const gz1 = gar.z1;
  const core = block(k, 'office', gx0 - 0.6, gz1 - 7, gx0 + 6, gz1 + 0.6, 5 * 4.0 + 1.0);
  const p = signMat(3, 3, (ctx, W, H) => {
    ctx.fillStyle = '#1e5aa8';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(H * 0.78)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', W / 2, H * 0.54);
  }, 1.2);
  k.glowMats.push(p);
  add(far, G.plane(3, 3), p, (core.x0 + core.x1) / 2, core.h - 3.4, core.z1 + 0.06);
  block(k, 'tower', s.lotX1 + 66, -36, s.lotX1 + 92, -6, 11 * 3.8 + 1.0);
  block(k, 'apartment', s.lotX1 + 62, 6, s.lotX1 + 98, s.streetZ0 - 8, 8 * 3.0 + 0.8);
  block(k, 'office', s.W + 4, -100, s.W + 50, -64, 8 * 4.0 + 1.0);
}

/** medical office building west of the lot, apartment blocks further out */
function campusWest(k: Kit, s: SurroundInput) {
  block(k, 'office', s.lotX0 - 54, -24, s.lotX0 - 18, 20, 5 * 4.0 + 1.0);
  block(k, 'apartment', s.lotX0 - 118, -42, s.lotX0 - 74, -12, 7 * 3.0 + 0.8);
  block(k, 'brick', s.lotX0 - 116, 2, s.lotX0 - 80, s.streetZ0 - 8, 6 * 3.1 + 0.9);
  block(k, 'apartment', -36, -96, -4, -66, 9 * 3.0 + 0.8);
}

/**
 * Plain painted parts far away (roofs, poles, rails, the bridge arches…) share two vertex-coloured
 * materials, matte and metal: one draw call each instead of one per colour.
 */
const paints = new Map<boolean, THREE.MeshStandardMaterial>();
function paintMat(metal: boolean): THREE.MeshStandardMaterial {
  let m = paints.get(metal);
  if (!m) {
    m = own(outdoor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: metal ? 0.42 : 0.85, metalness: metal ? 0.7 : 0 })));
    m.addEventListener('dispose', () => paints.delete(metal));
    paints.set(metal, m);
  }
  return m;
}
function paint(g: THREE.Object3D, geo: THREE.BufferGeometry, color: string, metal: boolean, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const c = new THREE.Color(color);
  const pg = geo.clone();
  const n = pg.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return add(g, trackGeo(pg), paintMat(metal), x, y, z, rx, ry, rz);
}

type ShrubFn = (parent: THREE.Object3D, x: number, z: number, r: number, h: number, seed: number, y0?: number) => void;
type TreeFn = (parent: THREE.Object3D, x: number, z: number, o: { h: number; r: number; seed: number; cards?: number }) => void;

const ext = <T extends THREE.Material>(m: T) => outdoor(m);
function flat(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  return trackGeo(g);
}

/** campus edge along x: low brick wall, brick piers every 6 m, steel pickets, a hedge outside */
function campusEdge(near: THREE.Object3D, x: number, z0: number, z1: number, out: 1 | -1, shrub: ShrubFn, colliders: THREE.Box3[]) {
  const brick = ext(pbr('brick', { color: '#c9b8a6', tile: 1.25, roughness: 0.9, tag: 'ext' }));
  const cap = ext(pbr('sidewalk', { color: '#e3dfd6', tile: 1.2, roughness: 0.8, tag: 'ext' }));
  const steel = solid('#1b1d1f', 0.45, 0.6);
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  add(near, G.box(0.3, 0.6, len), brick, x, 0.3, zc);
  add(near, G.box(0.38, 0.06, len), cap, x, 0.63, zc);
  const n = Math.max(1, Math.round(len / 6));
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    const z = z0 + i * step;
    add(near, G.box(0.5, 1.75, 0.5), brick, x, 0.875, z);
    add(near, G.box(0.6, 0.08, 0.6), cap, x, 1.79, z);
    if (i === n) break;
    for (const y of [0.74, 1.56]) add(near, G.box(0.03, 0.04, step - 0.5), steel, x, y, z + step / 2);
    for (let p = z + 0.36; p < z + step - 0.3; p += 0.13) add(near, G.box(0.022, 0.96, 0.022), steel, x, 1.14, p);
  }
  // clipped hedge outside the fence: a rounded block of foliage (cheap: no cut-out cards), with a
  // few loose leafy tufts breaking its top line
  const hedge = ext(pbr('grass', { color: '#5f7d47', tile: 0.7, roughness: 0.95, tag: 'ext' }));
  add(near, G.rbox(1.1, 1.35, len - 0.2, 0.25, 2), hedge, x + out * 1.1, 0.675, zc);
  for (let z = z0 + 1.2, i = 0; z < z1 - 0.9; z += 2.1 + ((i * 7) % 3) * 0.4, i++) shrub(near, x + out * (1.1 + (((i * 5) % 3) - 1) * 0.12), z, 0.55, 0.42, 9000 + i * 13 + Math.round(x), 1.1);
  for (const z of [z0 + 0.25, z1 - 0.25]) shrub(near, x + out * 1.1, z, 0.72, 1.32, 9500 + Math.round(z * 7 + x), 0);
  colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.3, 0, z0), new THREE.Vector3(x + 0.3, 2, z1)));
}

/** cobra-head street lights: pole, mast arm over the road, glowing head */
function streetLight(g: THREE.Object3D, x: number, z: number, toward: 1 | -1, glow: THREE.Material) {
  paint(g, G.cyl(0.08, 0.11, 8.2, 10), '#7c8287', true, x, 4.1, z);
  paint(g, G.box(0.08, 0.08, 2.0), '#7c8287', true, x, 8.05, z + toward * 0.95);
  paint(g, G.rbox(0.36, 0.14, 0.7, 0.05), '#5d6368', true, x, 7.98, z + toward * 2.0);
  add(g, G.box(0.26, 0.02, 0.5), glow, x, 7.9, z + toward * 2.0);
}

/** promenade lantern: slim post, glass lantern head under a small cap */
function lantern(g: THREE.Object3D, x: number, z: number, glow: THREE.Material) {
  paint(g, G.cyl(0.055, 0.08, 4.0, 8), STEEL, true, x, 2.0, z);
  paint(g, G.cyl(0.11, 0.11, 0.08, 8), STEEL, true, x, 4.04, z);
  add(g, G.cyl(0.17, 0.12, 0.42, 8), glow, x, 4.29, z);
  paint(g, G.cone(0.26, 0.2, 8), STEEL, true, x, 4.6, z);
}
const STEEL = '#2a2d30';

/** where the river is: quay edge (z) on this side, on the far side, and the bridge's centre line (x) */
export function riverPlan(s: { lotX1: number; streetZ1: number }) {
  const Q = s.streetZ1 + 11.2;
  return { Q, Qf: Q + 118, bx: s.lotX1 + 64, bridgeHalf: 8 };
}

/** river south of the street: park + promenade, quay with railing, water, far bank, a lit bridge */
function riverfront(k: Kit, s: SurroundInput, tree: TreeFn, glow: THREE.Material) {
  const { far } = k;
  const rnd = rng(77);
  const { Q, Qf, bx } = riverPlan(s);
  const X0 = s.lotX0 - 175;
  const X1 = s.lotX1 + 175;
  const L = X1 - X0;
  const cx = (X0 + X1) / 2;
  const paving = ext(pbr('sidewalk', { color: '#cfcac0', tile: 1.6, roughness: 0.9, tag: 'ext' }));
  const concrete = ext(pbr('concrete', { color: '#9d9a92', tile: 3, roughness: 0.95, tag: 'ext' }));
  far.add(new THREE.Mesh(flat(X0, Q - 3.6, X1, Q, 0.0), paving));
  for (const [a, b] of [[X0, bx - 8.2], [bx + 8.2, X1]] as [number, number][]) add(far, G.box(b - a, 0.14, 0.5), paving, (a + b) / 2, 0.07, Q + 0.25);
  // railing (gap at the bridge), quay walls, water, far bank
  for (const [a, b] of [[X0, bx - 9], [bx + 9, X1]] as [number, number][]) {
    for (const y of [0.62, 1.12]) paint(far, G.box(b - a, y > 1 ? 0.06 : 0.04, 0.06), STEEL, true, (a + b) / 2, y, Q + 0.2);
    for (let x = a + 1; x < b; x += 2.4) paint(far, G.box(0.06, 1.0, 0.06), STEEL, true, x, 0.64, Q + 0.2);
  }
  for (let x = X0 + 9; x < X1; x += 16) if (Math.abs(x - bx) > 11) lantern(far, x, Q - 0.45, glow);
  add(far, G.box(L, 2.9, 0.7), concrete, cx, -1.45, Q + 0.6);
  far.add(new THREE.Mesh(flat(X0, Q + 0.9, X1, Qf + 0.2, -2.6), own(waterMaterial())));
  add(far, G.box(L, 2.9, 0.7), concrete, cx, -1.45, Qf + 0.55);
  far.add(new THREE.Mesh(flat(X0, Qf + 0.9, X1, Qf + 130, 0.0), paving));
  for (let x = X0 + 6; x < X1; x += 20) {
    if (Math.abs(x - bx) > 11) lantern(far, x, Qf + 2.2, glow);
    const t = { h: 7 + rnd() * 2, r: 2.3 + rnd(), seed: Math.floor(rnd() * 1e6), cards: 0.35 };
    if (rnd() < 0.55 && Math.abs(x + 10 - bx) > 11) tree(far, x + 10, Qf + 6.5, t);
  }
  // far-bank skyline: a varied row of offices, towers and apartment blocks
  const styles: StyleKey[] = ['office', 'tower', 'apartment', 'brick', 'tower', 'office', 'apartment'];
  // (the bridge road carries on into a street between the blocks: keep its axis clear)
  const clearOfBridge = (x: number, w: number) => (x < bx + 10 && x + w > bx - 10 ? bx + 10 : x);
  for (let x = s.lotX0 - 120; x < s.lotX1 + 120; ) {
    const w = 16 + rnd() * 26;
    x = clearOfBridge(x, w);
    const st = styles[Math.floor(rnd() * styles.length)];
    const tall = st === 'tower' || (st === 'office' && rnd() < 0.5);
    const fl = STYLES[st].floor;
    const floors = tall ? Math.round((28 + Math.pow(rnd(), 1.4) * 52) / fl) : Math.round((13 + rnd() * 14) / fl);
    const z0 = Qf + 12 + rnd() * 18;
    const b = block(k, st, x, z0, x + w, z0 + 14 + rnd() * 12, floors * fl + 1.0);
    x = b.x1 + 3 + rnd() * 7;
  }
  // a second row behind: fewer, taller towers between the gaps
  for (let x = s.lotX0 - 100 + rnd() * 20; x < s.lotX1 + 100; x += 38 + rnd() * 30) {
    x = clearOfBridge(x, 30);
    const st: StyleKey = rnd() < 0.6 ? 'tower' : 'office';
    const fl = STYLES[st].floor;
    const z0 = Qf + 50 + rnd() * 16;
    block(k, st, x, z0, x + 18 + rnd() * 12, z0 + 18, Math.round((45 + rnd() * 50) / fl) * fl + 1.0);
  }
  // road bridge: deck and parapets, an approach from the street
  const deckZ0 = Q - 0.6;
  const deckZ1 = Qf + 1.2;
  const dz = (deckZ0 + deckZ1) / 2;
  far.add(new THREE.Mesh(flat(bx - 8, s.streetZ1, bx + 8, deckZ0, 0.012), ext(pbr('lot_asphalt', { color: '#8d8d92', tile: 3.4, roughness: 0.92, tag: 'ext' }))));
  add(far, G.box(16, 1.4, deckZ1 - deckZ0), concrete, bx, -0.68, dz);
  add(far, G.box(15.4, 0.02, deckZ1 - deckZ0 - 0.006), ext(pbr('lot_asphalt', { color: '#8d8d92', tile: 3.4, roughness: 0.92, tag: 'ext' })), bx, 0.03, dz);
  for (const sx of [-1, 1]) add(far, G.box(0.35, 1.0, deckZ1 - deckZ0), concrete, bx + sx * 7.8, 0.5, dz);
  // a tied steel arch over each edge of the deck (no piers in the river), hangers, a string of
  // lights along each arch that the river mirrors at night, wind bracing near the crown
  const arch = '#d9dcdf';
  const half = (deckZ1 - deckZ0) / 2 - 4;
  const rise = 19;
  const archY = (t: number) => 1.0 + rise * (1 - t * t);
  for (const sx of [-1, 1]) {
    const x = bx + sx * 7.4;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) pts.push(new THREE.Vector3(x, archY(i / 8 - 1), dz + (i / 8 - 1) * half));
    paint(far, trackGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.42, 6, false)), arch, true);
    for (let z = dz - half + 7; z < dz + half - 6; z += 7) {
      const y = archY((z - dz) / half);
      paint(far, G.box(0.07, y - 1.0, 0.07), arch, true, x, (y + 1.0) / 2, z);
    }
    for (let i = 1; i < 24; i++) add(far, G.sphere(0.3, 8, 6), glow, x, archY(i / 12 - 1) + 0.6, dz + (i / 12 - 1) * half);
  }
  for (const t of [-0.5, -0.2, 0.2, 0.5]) paint(far, G.box(14.8, 0.32, 0.32), arch, true, bx, archY(t), dz + t * half);
}

/**
 * Builds everything beyond the lot. `near` casts sun shadows (campus fence + hedge next to the lot),
 * `far` doesn't (and shouldn't receive them either: the rig turns that off).
 */
export function buildSurroundings(near: THREE.Object3D, far: THREE.Object3D, s: SurroundInput, f: { shrub: ShrubFn; tree: TreeFn; glow: THREE.Material }): Surroundings {
  const red = solid('#ff6b5b', 0.4, 0, { emissive: '#ff1d10', ei: 3 });
  const k: Kit = { far, boxes: [], glowMats: [red], red, rnd: rng(901) };
  campusNorth(k, s);
  campusEast(k, s);
  campusWest(k, s);
  for (const m of k.glowMats) if (m.userData.glow === undefined) m.userData.glow = m.emissiveIntensity;
  const colliders: THREE.Box3[] = [];
  const lights: ExtLight[] = [];
  campusEdge(near, s.lotX0 - 0.55, -2, s.perimZ1 - 0.2, -1, f.shrub, colliders);
  campusEdge(near, s.lotX1 + 0.55, -2, s.perimZ1 - 0.2, 1, f.shrub, colliders);
  // service road behind the ED (from the medical office building to past the garage)
  far.add(new THREE.Mesh(flat(s.lotX0 - 16, -18.5, s.lotX1 + 60, -7.5, 0.0), ext(pbr('lot_asphalt', { color: '#8d8d92', tile: 3.4, roughness: 0.92, tag: 'ext' }))));
  for (let x = s.lotX0 - 14; x < s.lotX1 + 58; x += 6) paint(far, G.box(3, 0.004, 0.12), '#d8d6ce', false, x, 0.006, -13);
  // near-side street lights, staggered with the far side; real lights only in front of the hospital
  const zl = s.perimZ1 + 1.5;
  for (let x0 = Math.ceil((s.lotX0 - 170) / 32) * 32 + 16; x0 < s.lotX1 + 170; x0 += 32) {
    // step out of driveways
    const dw = s.driveways.find(([a, b]) => x0 > a - 2 && x0 < b + 2);
    const x = dw ? (x0 - dw[0] < dw[1] - x0 ? dw[0] - 2.2 : dw[1] + 2.2) : x0;
    streetLight(far, x, zl, 1, f.glow);
    if (x > s.lotX0 - 8 && x < s.lotX1 + 8) lights.push({ kind: 'spot', pos: new THREE.Vector3(x, 7.8, zl + 2.0), target: new THREE.Vector3(x, 0, zl + 5.0), color: '#ffd9ae', intensity: 70, distance: 24, angle: 1.05, penumbra: 0.7 });
  }
  riverfront(k, s, f.tree, f.glow);
  // every façade in one mesh, one draw call (kept whole by the exterior's merge: it carries the style attribute)
  const fac = facadeMaterial();
  const merged = mergeGeometries(k.boxes, false);
  k.boxes.forEach((g) => g.dispose());
  if (merged) {
    const facades = new THREE.Mesh(trackGeo(merged), own(fac.mat));
    facades.userData.keep = true;
    far.add(facades);
  }
  return {
    colliders,
    lights,
    setNight(night: boolean) {
      fac.night.value = night ? 1 : 0;
      for (const m of k.glowMats) m.emissiveIntensity = (m.userData.glow as number) * (night ? 1 : 0.06);
    },
  };
}

/** deterministic PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


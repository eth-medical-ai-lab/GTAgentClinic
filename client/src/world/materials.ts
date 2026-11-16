/**
 * Physically based materials + shared geometry caches.
 *
 * Every surface is a MeshStandardMaterial (or Physical for glass). Large surfaces use CC0
 * photo-scanned texture sets from /res/tex (see scripts/assets/fetch-textures.mjs) mapped
 * in world space: a material with `userData.worldUV = metersPerTile` gets box-projected
 * UVs when the builder merges static geometry, so tiles keep their physical size on any
 * wall, floor or counter. Sharing materials is also what lets the builder merge static
 * geometry by material (few draw calls). disposeCaches() releases everything.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const mats = new Map<string, THREE.Material>();
const geos = new Map<string, THREE.BufferGeometry>();
const textures = new Set<THREE.Texture>();

export interface MatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  side?: THREE.Side;
  flat?: boolean;
  roughness?: number;
  metalness?: number;
  /** never merge meshes using this material (e.g. day/night recolored materials) */
  tag?: string;
}

/**
 * Plain PBR material from a color. (Kept under the historical name used by the prop and
 * character builders; it is a MeshStandardMaterial, not Lambert.)
 */
export function lambert(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `S|${color}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}|${o.opacity ?? ''}|${o.side ?? ''}|${o.flat ?? ''}|${o.roughness ?? ''}|${o.metalness ?? ''}|${o.tag ?? ''}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.72,
      metalness: o.metalness ?? 0,
      emissive: o.emissive ?? '#000000',
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.opacity !== undefined && o.opacity < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      flatShading: o.flat ?? false,
    });
    if (o.opacity !== undefined && o.opacity < 1) m.depthWrite = false;
    mats.set(key, m);
  }
  return m;
}
export const std = lambert;

export function basic(color: string, o: { opacity?: number; side?: THREE.Side; tag?: string } = {}): THREE.MeshBasicMaterial {
  const key = `B|${color}|${o.opacity ?? ''}|${o.side ?? ''}|${o.tag ?? ''}`;
  let m = mats.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: o.opacity !== undefined && o.opacity < 1, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide });
    if (o.opacity !== undefined && o.opacity < 1) m.depthWrite = false;
    mats.set(key, m);
  }
  return m;
}

// ───────────────────────────── texture sets ─────────────────────────────

/** which maps each set in /res/tex provides (must match scripts/assets/fetch-textures.mjs) */
const SETS = {
  floor_vinyl: ['color', 'normal', 'rough'],
  floor_alt: ['color', 'normal', 'rough'],
  wall_paint: ['normal', 'rough'],
  fabric_curtain: ['normal', 'rough'],
  fabric_seat: ['color', 'normal', 'rough'],
  vinyl: ['normal', 'rough'],
  steel: ['color', 'normal', 'rough', 'metal'],
  plastic: ['normal', 'rough'],
  asphalt: ['color', 'normal', 'rough'],
  concrete: ['color', 'normal', 'rough'],
  wood: ['color', 'normal', 'rough'],
  rubber: ['normal', 'rough'],
  // exterior (exterior.ts / vehicles.ts)
  lot_asphalt: ['color', 'normal', 'rough'],
  sidewalk: ['color', 'normal', 'rough'],
  grass: ['color', 'normal', 'rough'],
  bark: ['color', 'normal', 'rough'],
  leaves: ['color', 'alpha'],
  brick: ['color', 'normal', 'rough'],
  tread_plate: ['color', 'normal', 'rough'],
} as const;
export type TexSet = keyof typeof SETS;

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
let anisotropy = 8;
export function setMaxAnisotropy(n: number) {
  anisotropy = Math.max(1, Math.min(16, n));
}

/** one map of a texture set (shared, repeat-wrapped); for node materials that sample sets themselves */
export function texMap(set: TexSet, map: 'color' | 'normal' | 'rough' | 'metal' | 'alpha'): THREE.Texture {
  return tex(set, map);
}

function tex(set: TexSet, map: string): THREE.Texture {
  const url = `/res/tex/${set}/${map}.webp`;
  let t = texCache.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    texCache.set(url, t);
    textures.add(t);
  }
  return t;
}

export interface PbrOpts extends MatOpts {
  /** multiplies the color map (or is the base color when the set has none) */
  color?: string;
  /** meters per texture tile for world-space UVs (default 1) */
  tile?: number;
  normalScale?: number;
  /** set false to skip world-space UV generation (geometry keeps its own UVs) */
  worldUV?: boolean;
  physical?: boolean;
  clearcoat?: number;
}

/** Textured PBR material from a CC0 texture set. Cached by all options. */
export function pbr(set: TexSet, o: PbrOpts = {}): THREE.MeshStandardMaterial {
  const key = `P|${set}|${JSON.stringify(o)}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  const maps = SETS[set] as readonly string[];
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: o.color ?? '#ffffff',
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? (maps.includes('metal') ? 1 : 0),
    side: o.side ?? THREE.FrontSide,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
  };
  if (maps.includes('color')) params.map = tex(set, 'color');
  if (maps.includes('normal')) {
    params.normalMap = tex(set, 'normal');
    params.normalScale = new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1);
  }
  if (maps.includes('rough')) params.roughnessMap = tex(set, 'rough');
  if (maps.includes('metal')) params.metalnessMap = tex(set, 'metal');
  if (maps.includes('alpha')) {
    // cut-out (leaves): alphaMap + alphaTest also shape the shadow pass
    params.alphaMap = tex(set, 'alpha');
    params.alphaTest = 0.5;
  }
  if (o.emissive) {
    params.emissive = new THREE.Color(o.emissive);
    params.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  if (o.physical || o.clearcoat) {
    const pm = new THREE.MeshPhysicalMaterial({ ...params, clearcoat: o.clearcoat ?? 0, clearcoatRoughness: 0.25 });
    m = pm;
  } else m = new THREE.MeshStandardMaterial(params);
  if (o.worldUV !== false) m.userData.worldUV = o.tile ?? 1;
  mats.set(key, m);
  return m;
}

/** Simple glass: thin, glossy, mostly transparent; reflects the environment. */
export function glass(tint = '#cfe6ee', opacity = 0.22): THREE.MeshPhysicalMaterial {
  const key = `G|${tint}|${opacity}`;
  let m = mats.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.04, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 });
    mats.set(key, m);
  }
  return m;
}

/** Emissive light-panel diffuser (drives bloom). */
export function emitter(color = '#fff6ea', intensity = 6): THREE.MeshStandardMaterial {
  const key = `E|${color}|${intensity}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: intensity, roughness: 0.9 });
    mats.set(key, m);
  }
  return m;
}

/** A unique material (not cached) — tracked for disposal. */
export function own<T extends THREE.Material>(m: T): T {
  mats.set(`own|${mats.size}|${Math.random()}`, m);
  return m;
}

export function trackTexture<T extends THREE.Texture>(t: T): T {
  textures.add(t);
  return t;
}

function cachedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}

const r = (n: number) => Math.round(n * 1000) / 1000;

export const G = {
  box: (w: number, h: number, d: number) => cachedGeo(`box|${r(w)}|${r(h)}|${r(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  /** box with rounded edges — catches highlights like real manufactured objects */
  rbox: (w: number, h: number, d: number, radius = 0.02, seg = 2) =>
    cachedGeo(`rbox|${r(w)}|${r(h)}|${r(d)}|${r(radius)}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(radius, Math.min(w, h, d) / 2 - 1e-4))),
  cyl: (rt: number, rb: number, h: number, seg = 12) => cachedGeo(`cyl|${r(rt)}|${r(rb)}|${r(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  sphere: (rad: number, ws = 12, hs = 9) => cachedGeo(`sph|${r(rad)}|${ws}|${hs}`, () => new THREE.SphereGeometry(rad, ws, hs)),
  capsule: (rad: number, len: number, cs = 4, rs = 10) => cachedGeo(`cap|${r(rad)}|${r(len)}|${cs}|${rs}`, () => new THREE.CapsuleGeometry(rad, len, cs, rs)),
  torus: (rad: number, tube: number, rs = 8, ts = 20, arc = Math.PI * 2) => cachedGeo(`tor|${r(rad)}|${r(tube)}|${rs}|${ts}|${r(arc)}`, () => new THREE.TorusGeometry(rad, tube, rs, ts, arc)),
  plane: (w: number, h: number) => cachedGeo(`pln|${r(w)}|${r(h)}`, () => new THREE.PlaneGeometry(w, h)),
  cone: (rad: number, h: number, seg = 12) => cachedGeo(`cone|${r(rad)}|${r(h)}|${seg}`, () => new THREE.ConeGeometry(rad, h, seg)),
  circle: (rad: number, seg = 24) => cachedGeo(`circ|${r(rad)}|${seg}`, () => new THREE.CircleGeometry(rad, seg)),
};

/** register a one-off geometry for disposal */
export function trackGeo<T extends THREE.BufferGeometry>(g: T): T {
  geos.set(`own|${geos.size}|${Math.random()}`, g);
  return g;
}

export function disposeCaches() {
  mats.forEach((m) => {
    const anyM = m as THREE.Material & { map?: THREE.Texture | null };
    if (anyM.map && !texCache.has((anyM.map.image as { src?: string } | undefined)?.src ?? '')) anyM.map.dispose?.();
    m.dispose();
  });
  mats.clear();
  geos.forEach((g) => g.dispose());
  geos.clear();
  textures.forEach((t) => t.dispose());
  textures.clear();
  texCache.clear();
}

/** Add a mesh to parent. (x, y, z) is the CENTER of the geometry. */
export function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** Box whose bottom sits at yBottom. */
export function boxB(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, yBottom: number, z: number, ry = 0): THREE.Mesh {
  return add(parent, G.box(w, h, d), mat, x, yBottom + h / 2, z, 0, ry, 0);
}

/** Rounded box whose bottom sits at yBottom. */
export function rboxB(parent: THREE.Object3D, w: number, h: number, d: number, radius: number, mat: THREE.Material, x: number, yBottom: number, z: number, ry = 0): THREE.Mesh {
  return add(parent, G.rbox(w, h, d, radius), mat, x, yBottom + h / 2, z, 0, ry, 0);
}

/** Vertical cylinder whose bottom sits at yBottom. */
export function cylB(parent: THREE.Object3D, rad: number, h: number, mat: THREE.Material, x: number, yBottom: number, z: number, seg = 12, radBottom?: number): THREE.Mesh {
  return add(parent, G.cyl(rad, radBottom ?? rad, h, seg), mat, x, yBottom + h / 2, z);
}

/** A tube along a polyline (rails, cables, IV lines). */
export function tube(parent: THREE.Object3D, points: [number, number, number][], radius: number, mat: THREE.Material, segments = 24, radial = 8): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const m = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, segments, radius, radial, false)), mat);
  parent.add(m);
  return m;
}

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return trackTexture(t);
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/**
 * Box-project world-space UVs onto a (non-indexed, world-space) geometry: each triangle
 * picks the axis its normal points along, so walls, floors and counter tops all tile at
 * `metersPerTile` without stretching.
 */
export function applyWorldUVs(g: THREE.BufferGeometry, metersPerTile: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  if (!pos || !nor) return;
  let uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  const k = 1 / metersPerTile;
  for (let i = 0; i < pos.count; i += 3) {
    // face normal = average of the three vertex normals
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let j = 0; j < 3 && i + j < pos.count; j++) {
      nx += nor.getX(i + j);
      ny += nor.getY(i + j);
      nz += nor.getZ(i + j);
    }
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    for (let j = 0; j < 3 && i + j < pos.count; j++) {
      const x = pos.getX(i + j);
      const y = pos.getY(i + j);
      const z = pos.getZ(i + j);
      if (ay >= ax && ay >= az) uv.setXY(i + j, x * k, z * k);
      else if (ax >= az) uv.setXY(i + j, z * k, y * k);
      else uv.setXY(i + j, x * k, y * k);
    }
  }
  uv.needsUpdate = true;
}

/**
 * Vehicles for the hospital's outside: a modern US Type III ambulance (cutaway van cab +
 * modular aluminium box, dual rear wheels, real-world dimensions) and a few parked cars.
 *
 * Local frame: origin on the ground at the vehicle's center, front facing +z, +x = driver
 * side (US). Bodies are extruded side profiles with rounded edges; paint is a clear-coated
 * MeshPhysicalMaterial, trim is chrome / stainless / textured black plastic, glass is tinted
 * and lets you see a simple cab (and patient-compartment) interior. Livery is drawn on canvas
 * (reflective stripes, chevrons, Star of Life, mirrored AMBULANCE).
 *
 * Every vehicle is merged by material into a few meshes that cast sun shadows (the builder
 * keeps them as they are: userData.noMerge). Materials are flagged userData.outdoor, so the
 * lighting rig gives them the exterior reflection probe instead of the interior environment.
 */
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, add, applyWorldUVs, canvasTexture, makeCanvas, own, pbr, trackGeo } from './materials';

// ───────────────────────────── shared helpers (also used by exterior.ts) ─────────────────────────────

/** mark a material as outdoor (exterior reflection probe, see render/lighting.ts) */
export function outdoor<T extends THREE.Material>(m: T, envIntensity = 1): T {
  m.userData.outdoor = true;
  m.userData.envIntensity = envIntensity;
  return m;
}

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = own(make());
    cache.set(key, m);
    m.addEventListener('dispose', () => cache.delete(key));
  }
  return m;
}

/** clear-coated automotive paint (metallic flake via metalness when `metallic`) */
export function carPaint(color: string, metallic = false, rough = metallic ? 0.38 : 0.3): THREE.MeshPhysicalMaterial {
  return cached(`paint|${color}|${metallic}|${rough}`, () =>
    outdoor(new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.55 : 0.02, roughness: Math.max(rough, 0.34), clearcoat: 1, clearcoatRoughness: 0.13 }), 1.15),
  );
}

/**
 * The same clear-coat paint with the colour in the vertices instead (parked cars): every car of a
 * finish shares one material, so all of them merge into one draw call.
 */
export function carPaintVC(metallic: boolean): THREE.MeshPhysicalMaterial {
  return cached(`paintvc|${metallic}`, () =>
    outdoor(new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, metalness: metallic ? 0.55 : 0.02, roughness: metallic ? 0.38 : 0.34, clearcoat: 1, clearcoatRoughness: 0.13 }), 1.15),
  );
}

/** plain outdoor PBR material (cached) */
export function solid(color: string, rough: number, metal = 0, o: { emissive?: string; ei?: number; envI?: number } = {}): THREE.MeshStandardMaterial {
  return cached(`solid|${color}|${rough}|${metal}|${o.emissive ?? ''}|${o.ei ?? ''}|${o.envI ?? ''}`, () =>
    outdoor(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: o.emissive ?? '#000000', emissiveIntensity: o.ei ?? 1 }), o.envI ?? 1),
  );
}

export const VM = {
  chrome: () => solid('#f2f2f2', 0.07, 1, { envI: 1.2 }),
  stainless: () => solid('#c9ccce', 0.3, 1),
  trim: () => solid('#151617', 0.62, 0),
  gloss: () => solid('#0c0d0e', 0.16, 0),
  rubber: () => outdoor(pbr('rubber', { color: '#1b1c1d', tile: 0.25, roughness: 0.92, tag: 'ext', worldUV: false })),
  underbody: () => solid('#1d1f20', 0.8, 0.2),
  // (constant metalness, no metal map: the clustered lights + shadow maps share the 16-texture budget)
  tread: () => outdoor(pbr('tread_plate', { tile: 0.35, roughness: 0.5, metalness: 0.85, tag: 'ext' })),
};

/** tinted automotive glass: see-through enough for the interior, reflective at grazing angles */
export function autoGlass(tint = '#1a242b', opacity = 0.42): THREE.MeshPhysicalMaterial {
  return cached(`glass|${tint}|${opacity}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.03, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1, envMapIntensity: 1.6 });
    m.userData.noShadow = true;
    return outdoor(m, 1.6);
  });
}

/** lamp lens over an emitter: color, glow color and resting glow (0 = off) */
export function lens(color: string, glow: string, ei: number): THREE.MeshPhysicalMaterial {
  return cached(`lens|${color}|${glow}|${ei}`, () =>
    outdoor(new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, emissive: glow, emissiveIntensity: ei }), 1.2),
  );
}

/**
 * Merge every mesh under `src` (a group at identity) into one mesh per material. Meshes with
 * userData.keep or userData.noMerge stay separate (they are re-parented as they are: the
 * z-fighting scan flags every mesh noMerge, so it sees each builder call). The result casts
 * shadows (except materials flagged userData.noShadow) and is skipped by the builder's own merge.
 */
export function mergeByMaterial(src: THREE.Object3D, o: { castShadow?: boolean } = {}): THREE.Group {
  src.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Mesh[] = [];
  src.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    if (m.userData.keep || m.userData.noMerge) {
      keep.push(m);
      return;
    }
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const mat = m.material as THREE.Material;
    const wantColor = !!(mat as THREE.MeshStandardMaterial).vertexColors;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(wantColor ? ['color'] : [])].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    // texture sets tile in world space (like the builder's merge)
    const tile = mat.userData.worldUV as number | undefined;
    if (tile) applyWorldUVs(g, tile);
    let arr = buckets.get(mat);
    if (!arr) buckets.set(mat, (arr = []));
    arr.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((x) => x.dispose());
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(trackGeo(g), mat);
    mesh.userData.noMerge = true;
    mesh.receiveShadow = true;
    out.add(mesh);
    // Sun shadows come from a twin on layer 1 (same geometry): only the sun's shadow camera renders
    // layer 1, so these big merged meshes never land in the interior exam lights' shadow maps.
    if (o.castShadow !== false && !mat.userData.noShadow && !(mat as THREE.Material & { transparent?: boolean }).transparent) {
      const twin = new THREE.Mesh(mesh.geometry, mat);
      twin.layers.set(1);
      twin.castShadow = true;
      twin.userData.castShadow = true;
      twin.userData.noMerge = true;
      out.add(twin);
    }
  }
  // the meshes themselves move (not clones), in their world placement
  for (const m of keep) {
    m.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.userData.noMerge = true;
    out.add(m);
  }
  return out;
}

/**
 * Side-profile extrusion: `pts` are (z, y) pairs of the outline (counter-clockwise), extruded
 * across x by `width` with rounded edges of radius `r`. Returns a geometry centered on x = 0.
 */
export function profileGeo(pts: [number, number][] | THREE.Shape, width: number, r = 0.05, curveSegs = 6): THREE.BufferGeometry {
  const shape = pts instanceof THREE.Shape ? pts : new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const bt = Math.min(r, width / 4);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, width - 2 * bt), bevelEnabled: r > 0, bevelThickness: bt, bevelSize: r, bevelOffset: -r, bevelSegments: 3, curveSegments: curveSegs });
  g.translate(0, 0, -(width - 2 * bt) / 2);
  g.rotateY(-Math.PI / 2);
  return trackGeo(g);
}


// ───────────────────────────── ambulance livery (canvas) ─────────────────────────────

const RED = '#c4122f';
const BLUE = '#1c3f94';
const LIME = '#cfee16'; // fluorescent yellow-green (rear chevrons)
const FONT = '"Helvetica Neue", "Arial Narrow", Arial, sans-serif';
export const UNIT = 'MEDIC 12';
export const AGENCY = 'AgentClinic EMS';

/** Star of Life: blue six-armed star with a white border and the white Rod of Asclepius */
export function starOfLife(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const arm = (fill: string, grow: number) => {
    ctx.fillStyle = fill;
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((k * Math.PI) / 3);
      const w = s * 0.34 + grow * 2;
      const h = s + grow * 2;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, s * 0.02);
      ctx.fill();
      ctx.restore();
    }
  };
  arm('#ffffff', s * 0.035);
  arm('#1f5fb8', 0);
  // rod + serpent
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.38);
  ctx.lineTo(cx, cy + s * 0.4);
  ctx.stroke();
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = cy + s * 0.3 - t * s * 0.6;
    const x = cx + Math.sin(t * Math.PI * 3.2) * s * 0.075 * (1 - t * 0.35);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.03, cy - s * 0.32, s * 0.035, s * 0.022, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, o: { color: string; weight?: number; align?: CanvasTextAlign; mirror?: boolean; maxW?: number; spacing?: number }) {
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.font = `${o.weight ?? 800} ${Math.round(size)}px ${FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx && o.spacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing}px`;
  ctx.translate(x, y);
  if (o.mirror) ctx.scale(-1, 1);
  if (o.maxW) {
    const w = ctx.measureText(s).width;
    if (w > o.maxW) ctx.scale(o.maxW / w, 1);
  }
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** white paint with a little road grime toward the bottom and around the wheel arch */
function paintBase(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, 'rgba(120,112,98,0)');
  g.addColorStop(1, 'rgba(120,112,98,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const y = h * (0.6 + rnd() * 0.4);
    ctx.fillStyle = `rgba(95,88,76,${0.02 + rnd() * 0.05})`;
    ctx.fillRect(rnd() * w, y, 1 + rnd() * 3, 1 + rnd() * 6);
  }
}

/** decal material: clear-coated like the paint it sits on; `cut` = alpha-tested window holes */
function decalMat(key: string, canvas: HTMLCanvasElement, cut = false): THREE.MeshPhysicalMaterial {
  return cached(`decal|${key}`, () => {
    const t = canvasTexture(canvas);
    t.anisotropy = 8;
    const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.035, alphaTest: cut ? 0.5 : 0, transparent: false });
    return outdoor(m, 1.15);
  });
}

/** box side, flat part (len × h m). frontOnLeft: canvas x = 0 at the front. door = side-entry window [z0, z1, y0, y1] from the front/bottom */
function boxSideLivery(len: number, h: number, frontOnLeft: boolean, door: [number, number, number, number] | null, y0: number) {
  const PX = 470;
  const W = Math.round(len * PX);
  const H = Math.round(h * PX);
  const { canvas, ctx } = makeCanvas(W, H);
  paintBase(ctx, W, H, frontOnLeft ? 7 : 11);
  const X = (fromFront: number) => (frontOnLeft ? fromFront : len - fromFront) * PX;
  const Y = (y: number) => (y0 + h - y) * PX;
  // reflective red band with a blue pinstripe, the classic US ambulance stripe
  ctx.fillStyle = RED;
  ctx.fillRect(0, Y(1.33), W, (1.33 - 1.02) * PX);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, Y(1.395), W, 0.032 * PX);
  ctx.fillStyle = RED;
  ctx.fillRect(0, Y(2.66), W, 0.05 * PX);
  text(ctx, 'AMBULANCE', X(0.45) + (frontOnLeft ? 0 : 0), Y(1.175), 0.2 * PX, { color: '#ffffff', align: frontOnLeft ? 'left' : 'right', spacing: 4 });
  starOfLife(ctx, X(1.15), Y(1.98), 0.62 * PX);
  const tx = X(1.62);
  text(ctx, AGENCY, tx, Y(2.12), 0.24 * PX, { color: RED, align: frontOnLeft ? 'left' : 'right', weight: 900, maxW: 2.1 * PX });
  text(ctx, 'EMERGENCY MEDICAL SERVICES', tx, Y(1.84), 0.085 * PX, { color: BLUE, align: frontOnLeft ? 'left' : 'right', weight: 700, spacing: 3, maxW: 2.1 * PX });
  text(ctx, UNIT, X(len - 0.25), Y(2.42), 0.15 * PX, { color: '#1d2125', align: frontOnLeft ? 'right' : 'left', weight: 800 });
  text(ctx, 'ADVANCED LIFE SUPPORT', X(len - 0.25), Y(1.55), 0.07 * PX, { color: BLUE, align: frontOnLeft ? 'right' : 'left', weight: 700, spacing: 2 });
  if (door) {
    // side-entry door window: tinted glass with a black rubber surround (a glass plane adds the reflections)
    const [f0, f1, wy0, wy1] = door;
    const x = Math.min(X(f0), X(f1));
    const w = Math.abs(X(f1) - X(f0));
    ctx.fillStyle = '#101214';
    ctx.fillRect(x - 0.025 * PX, Y(wy1) - 0.025 * PX, w + 0.05 * PX, (wy1 - wy0 + 0.05) * PX);
    const gl = ctx.createLinearGradient(0, Y(wy1), 0, Y(wy0));
    gl.addColorStop(0, '#2a3036');
    gl.addColorStop(1, '#14181b');
    ctx.fillStyle = gl;
    ctx.fillRect(x, Y(wy1), w, (wy1 - wy0) * PX);
  }
  return decalMat(`side|${frontOnLeft}|${!!door}`, canvas);
}

/** rear face: chevrons (red / fluorescent yellow-green, 45°), AMBULANCE, unit; window holes */
function rearLivery(w: number, h: number, y0: number, windows: [number, number, number, number][]) {
  const PX = 440;
  const W = Math.round(w * PX);
  const H = Math.round(h * PX);
  const { canvas, ctx } = makeCanvas(W, H);
  paintBase(ctx, W, H, 5);
  const Y = (y: number) => (y0 + h - y) * PX;
  const top = Y(1.6);
  const bot = H;
  const sw = 0.15 * PX * Math.SQRT2;
  for (const s of [-1, 1]) {
    // each half on its own: stripes slope down and away from the centerline (an inverted V)
    ctx.save();
    ctx.beginPath();
    ctx.rect(s < 0 ? 0 : W / 2, top, W / 2, bot - top);
    ctx.clip();
    for (let i = -24; i < 24; i++) {
      ctx.fillStyle = (i & 1) === 0 ? RED : LIME;
      const x0 = W / 2 + s * i * sw;
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x0 + s * sw, top);
      ctx.lineTo(x0 + s * sw + s * (bot - top), bot);
      ctx.lineTo(x0 + s * (bot - top), bot);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  text(ctx, 'AMBULANCE', W / 2, Y(1.72), 0.15 * PX, { color: RED, align: 'center', weight: 900, spacing: 6 });
  text(ctx, AGENCY.toUpperCase(), W / 2, Y(2.6), 0.07 * PX, { color: BLUE, align: 'center', weight: 800, spacing: 3 });
  text(ctx, UNIT.replace('MEDIC ', ''), W / 2, Y(2.2), 0.3 * PX, { color: '#1d2125', align: 'center', weight: 900 });
  for (const [x0, x1, wy0, wy1] of windows) ctx.clearRect((x0 + w / 2) * PX, Y(wy1), (x1 - x0) * PX, (wy1 - wy0) * PX);
  return decalMat('rear', canvas, true);
}

/** mirrored AMBULANCE (reads correctly in a rear-view mirror), transparent background */
function mirroredWord(key: string, w: number, h: number, color = RED) {
  const PX = 512;
  const { canvas, ctx } = makeCanvas(Math.round(w * PX), Math.round(h * PX));
  text(ctx, 'AMBULANCE', canvas.width / 2, canvas.height / 2, canvas.height * 0.78, { color, align: 'center', weight: 900, mirror: true, maxW: canvas.width * 0.96, spacing: 4 });
  return decalMat(`mirror|${key}`, canvas, true);
}

/** cab door below the window: the stripe continues from the box, small star + agency */
function cabDoorLivery(frontOnLeft: boolean, len: number, h: number, y0: number) {
  const PX = 420;
  const { canvas, ctx } = makeCanvas(Math.round(len * PX), Math.round(h * PX));
  const Y = (y: number) => (y0 + h - y) * PX;
  const W = canvas.width;
  ctx.fillStyle = RED;
  ctx.fillRect(0, Y(1.33), W, (1.33 - 1.02) * PX);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, Y(1.395), W, 0.032 * PX);
  starOfLife(ctx, frontOnLeft ? W * 0.24 : W * 0.76, Y(0.84), 0.26 * PX);
  text(ctx, AGENCY, frontOnLeft ? W * 0.36 : W * 0.64, Y(0.86), 0.075 * PX, { color: BLUE, align: frontOnLeft ? 'left' : 'right', weight: 800, maxW: W * 0.58 });
  return decalMat(`cab|${frontOnLeft}`, canvas, true);
}

// ───────────────────────────── ambulance ─────────────────────────────

/** Type III (E-450-class cutaway, 176" wheelbase, 14' module) */
const AMB = {
  box: { hw: 1.22, y0: 0.86, y1: 2.82, z0: -3.2, z1: 1.15, r: 0.085 },
  cab: { hw: 1.0, back: 1.18, belt: 1.31 },
  axleF: 2.9,
  axleR: -1.57,
  tire: { R: 0.372, W: 0.225, Rr: 0.203 },
};

/** sides of an extrusion only (ExtrudeGeometry group 1): an open tube along z */
function tubeOnly(shape: THREE.Shape, len: number): THREE.BufferGeometry {
  const ex = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 8 });
  const grp = ex.groups.find((gr) => gr.materialIndex === 1) ?? ex.groups[0];
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = ex.getAttribute(name) as THREE.BufferAttribute;
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
  }
  ex.dispose();
  return trackGeo(out);
}

function roundedRect(hw: number, y0: number, y1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, y0);
  s.lineTo(hw - r, y0);
  s.quadraticCurveTo(hw, y0, hw, y0 + r);
  s.lineTo(hw, y1 - r);
  s.quadraticCurveTo(hw, y1, hw - r, y1);
  s.lineTo(-hw + r, y1);
  s.quadraticCurveTo(-hw, y1, -hw, y1 - r);
  s.lineTo(-hw, y0 + r);
  s.quadraticCurveTo(-hw, y0, -hw + r, y0);
  return s;
}

/** (z, y) profile with an arc over a wheel: center (zc, yc), radius r, cut at height yCut */
function archPts(zc: number, yc: number, r: number, yCut: number, steps = 14): [number, number][] {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (yCut - yc) / r)));
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - a0 - ((Math.PI - 2 * a0) * i) / steps;
    pts.push([zc + Math.cos(a) * r, yc + Math.sin(a) * r]);
  }
  return pts; // from the rear side of the arch (low z) over the top to the front side
}

/** a thin dark seam strip on a surface facing ±x at x, from (z0,y0) to (z1,y1) */
function seam(g: THREE.Object3D, x: number, z0: number, y0: number, z1: number, y1: number, mat: THREE.Material, w = 0.007) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  add(g, G.box(0.004, w, len), mat, x, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(y1 - y0, z1 - z0) * -1, 0, 0);
}

function ambulanceCab(g: THREE.Group, white: THREE.Material) {
  const { hw, back, belt } = AMB.cab;
  const dark = VM.gloss();
  const trim = VM.trim();
  const chrome = VM.chrome();
  // lower body: rocker, front wheel arch, grille face, hood, cowl, beltline (solid extrusion)
  const lower: [number, number][] = [
    [back, 0.6],
    ...archPts(AMB.axleF, 0.37, 0.5, 0.6),
    [3.6, 0.6],
    [3.65, 0.63],
    [3.62, 1.0],
    [3.585, 1.065],
    [3.5, 1.11],
    [3.1, 1.18],
    [2.78, 1.255],
    [2.72, 1.28],
    [2.62, belt],
    [back, belt],
  ];
  add(g, profileGeo(lower, hw * 2, 0.06, 10), white);
  // greenhouse: roof cap, cab back wall (B-pillars), A-pillars, glass
  add(g, profileGeo([[2.06, 1.955], [1.99, 2.02], [1.88, 2.055], [1.3, 2.08], [1.22, 2.07], [back, 2.03], [back, 1.94], [2.0, 1.92]], hw * 2, 0.05, 6), white);
  add(g, G.rbox(hw * 2, 0.66, 0.16, 0.04), white, 0, belt + 0.33, back + 0.08);
  const ws = { z0: 2.72, y0: 1.28, z1: 2.04, y1: 1.965 };
  const slope = Math.atan2(ws.y1 - ws.y0, ws.z0 - ws.z1); // tilt from vertical
  const wsLen = Math.hypot(ws.z0 - ws.z1, ws.y1 - ws.y0);
  for (const s of [-1, 1]) add(g, G.rbox(0.09, wsLen + 0.03, 0.07, 0.025), white, s * (hw - 0.04), (ws.y0 + ws.y1) / 2, (ws.z0 + ws.z1) / 2 + 0.005, -(Math.PI / 2 - slope), 0, 0);
  const tilt = -(Math.PI / 2 - slope);
  const onSlope = (t: number, out = 0.006) => ({ z: ws.z0 + (ws.z1 - ws.z0) * t + Math.sin(slope) * out, y: ws.y0 + (ws.y1 - ws.y0) * t + Math.cos(slope) * out });
  const mid = onSlope(0.5, 0.008);
  add(g, G.plane(hw * 2 - 0.14, wsLen - 0.03), autoGlass('#1d282f', 0.3), 0, mid.y, mid.z, tilt, 0, 0);
  // black frit border on the inside of the glass (top + bottom bands), 2 mm behind it
  for (const [t, h] of [[0.04, 0.07], [0.965, 0.06]] as [number, number][]) {
    const p = onSlope(t, 0.004);
    add(g, G.box(hw * 2 - 0.14, h, 0.004), dark, 0, p.y, p.z, tilt, 0, 0);
  }
  // wipers parked on the glass
  for (const [x, l] of [[-0.42, 0.62], [0.3, 0.66]] as [number, number][]) {
    const p = onSlope(0.07, 0.02);
    add(g, G.box(l, 0.014, 0.02), trim, x, p.y, p.z, tilt, 0, 0.05);
  }
  // side door glass (front edge follows the A-pillar) with a black rubber surround
  const win: [number, number][] = [[1.34, belt + 0.01], [2.6, belt + 0.01], [2.07, 1.925], [1.34, 1.935]];
  const cz = win.reduce((a, p) => a + p[0], 0) / 4;
  const cy = win.reduce((a, p) => a + p[1], 0) / 4;
  const poly = (sign: number, grow: number) => win.map(([z, y]) => new THREE.Vector2(sign * (z + (z - cz) * grow), y + (y - cy) * grow * 1.6));
  const winGeo = (sign: 1 | -1, ring: boolean) => {
    const sh = new THREE.Shape(poly(sign, ring ? 0.06 : 0));
    if (ring) sh.holes.push(new THREE.Path(poly(sign, -0.005)));
    return trackGeo(new THREE.ShapeGeometry(sh));
  };
  for (const s of [-1, 1] as const) {
    // +x side: shape x = −z and a +90° turn faces +x; −x side: shape x = z and −90°
    const ry = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    // (the surround lies over the door livery at +0.002 and the A-pillar's side at +0.005: it
    // keeps 3 mm off both, and the glass 3 mm off it)
    add(g, winGeo(s > 0 ? -1 : 1, true), dark, s * (hw + 0.008), 0, 0, 0, ry, 0);
    add(g, winGeo(s > 0 ? -1 : 1, false), autoGlass('#1d282f', 0.36), s * (hw + 0.011), 0, 0, 0, ry, 0);
    // door seams, handle, mirror (west-coast style on two arms), step
    seam(g, s * (hw + 0.003), 1.32, 0.7, 1.32, belt, dark);
    seam(g, s * (hw + 0.003), 2.48, 0.7, 2.6, belt, dark);
    seam(g, s * (hw + 0.003), 1.32, 0.7, 2.48, 0.7, dark);
    add(g, G.rbox(0.03, 0.04, 0.15, 0.012), chrome, s * (hw + 0.012), 1.21, 1.5);
    // west-coast mirror: a tall head out past the module's side (the driver sees down the box), on
    // two stainless arms from the door's front edge; flat glass over a convex spotter, all facing
    // back and turned a little toward the driver
    const mx = s * (AMB.box.hw + 0.13);
    const my = 1.66;
    const mz = 2.43;
    const yaw = s * 0.14;
    const head = new THREE.Group();
    head.position.set(mx, my, mz);
    head.rotation.y = yaw;
    g.add(head);
    add(head, G.rbox(0.22, 0.47, 0.075, 0.025), dark, 0, 0, 0);
    add(head, G.plane(0.185, 0.27), solid('#9aa3a8', 0.02, 1, { envI: 1.4 }), 0, 0.085, -0.041, 0, Math.PI, 0);
    add(head, G.plane(0.185, 0.125), solid('#7d878d', 0.04, 1, { envI: 1.4 }), 0, -0.145, -0.041, 0, Math.PI, 0);
    const inner = Math.abs(mx) - 0.11 * Math.cos(yaw);
    const len = inner - (hw - 0.01);
    for (const y of [my + 0.17, my - 0.17]) {
      add(g, G.cyl(0.012, 0.012, len, 8), VM.stainless(), s * (hw - 0.01 + len / 2), y, mz + 0.01, 0, 0, Math.PI / 2);
      add(g, G.rbox(0.03, 0.06, 0.07, 0.01), VM.stainless(), s * (hw + 0.008), y, mz + 0.01);
    }
    add(g, G.rbox(0.24, 0.035, 0.62, 0.012), trim, s * (hw - 0.04), 0.43, 1.92);
  }
  // cab interior seen through the glass: dash, wheel (driver side +x), seats, back wall
  const inner = solid('#2a2d30', 0.75);
  add(g, G.rbox(hw * 2 - 0.1, 0.2, 0.42, 0.06), inner, 0, belt + 0.03, 2.52);
  add(g, G.torus(0.19, 0.018, 8, 28), trim, 0.46, belt + 0.2, 2.2, 0.52, 0, 0);
  add(g, G.cyl(0.03, 0.03, 0.28, 8), trim, 0.46, belt + 0.11, 2.36, 0.52, 0, 0);
  for (const x of [-0.5, 0.46]) {
    add(g, G.rbox(0.52, 0.62, 0.14, 0.05), solid('#3a3f44', 0.9), x, belt + 0.12, 1.5, -0.12, 0, 0);
    add(g, G.rbox(0.3, 0.2, 0.1, 0.04), solid('#3a3f44', 0.9), x, belt + 0.55, 1.45, -0.12, 0, 0);
  }
  add(g, G.plane(hw * 2 - 0.08, 0.64), solid('#1d2023', 0.9), 0, belt + 0.33, back + 0.164);
  // rubber boot between cab and module
  add(g, G.box(1.7, 1.42, 0.06), dark, 0, belt + 0.03, back - 0.015);
}

/** LED warning-module face: a dark housing with two rows of reflector cups (map + emissive map) */
function ledTexture(): THREE.CanvasTexture {
  const key = 'ledtex';
  const hit = texCache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = '#26282a';
  ctx.fillRect(0, 0, 256, 128);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 6; c++) {
      const x = 24 + c * 41.6;
      const y = 34 + r * 60;
      const g = ctx.createRadialGradient(x, y, 2, x, y, 19);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, '#f1f1f1');
      g.addColorStop(0.6, '#9a9a9a');
      g.addColorStop(1, '#3a3a3a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 19, 0, Math.PI * 2);
      ctx.fill();
    }
  const t = canvasTexture(canvas);
  texCache.set(key, t);
  return t;
}
const texCache = new Map<string, THREE.CanvasTexture>();

/** flashing warning-light lens (the world drives emissiveIntensity: red vs white phase by color) */
function warnMat(kind: 'red' | 'white' | 'amber'): THREE.MeshStandardMaterial {
  const c = { red: ['#ff4636', '#ff2414'], white: ['#e4eaf3', '#f3f7ff'], amber: ['#ffb43a', '#ff9d14'] }[kind];
  return cached(`warn|${kind}`, () => {
    const t = ledTexture();
    return outdoor(new THREE.MeshStandardMaterial({ color: c[0], map: t, emissive: c[1], emissiveMap: t, emissiveIntensity: 0.12, roughness: 0.18, metalness: 0.1 }), 1.2);
  });
}

/** a light module on a face: black bezel + lens; normal along +z unless ry turns it */
function lightModule(g: THREE.Object3D, mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry = 0) {
  const bz = Math.cos(ry);
  const bx = Math.sin(ry);
  add(g, G.rbox(w + 0.03, h + 0.03, 0.03, 0.01), VM.gloss(), x - bx * 0.0, y, z - bz * 0.0, 0, ry, 0);
  add(g, G.rbox(w, h, 0.02, 0.008), mat, x + bx * 0.012, y, z + bz * 0.012, 0, ry, 0);
}

function plateMaterial(textLine: string): THREE.MeshStandardMaterial {
  return cached(`plate|${textLine}`, () => {
    const { canvas, ctx } = makeCanvas(512, 256);
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#1f3c80';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 496, 240);
    text(ctx, 'MEDICAL  ·  EXEMPT', 256, 42, 30, { color: '#1f3c80', align: 'center', weight: 700 });
    text(ctx, textLine, 256, 150, 120, { color: '#1b2a4a', align: 'center', weight: 800, maxW: 460 });
    const t = canvasTexture(canvas);
    return outdoor(new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.3 }), 0.8);
  });
}

function ambulanceFront(g: THREE.Group, warn: { red: THREE.Material; white: THREE.Material }) {
  const chrome = VM.chrome();
  const dark = VM.gloss();
  const trim = VM.trim();
  const lean = -0.081; // the grille face leans back ~4.5°
  // grille: black mesh insert, chrome surround and three chrome bars
  add(g, G.rbox(1.02, 0.31, 0.05, 0.02), solid('#0e0f10', 0.5, 0.2), 0, 0.82, 3.628, lean, 0, 0);
  for (const y of [0.66, 0.98]) add(g, G.rbox(1.1, 0.035, 0.05, 0.012), chrome, 0, y, 3.64 - (y - 0.82) * 0.08, lean, 0, 0);
  for (const s of [-1, 1]) add(g, G.rbox(0.035, 0.35, 0.05, 0.012), chrome, s * 0.535, 0.82, 3.64, lean, 0, 0);
  for (const y of [0.74, 0.82, 0.9]) add(g, G.rbox(0.98, 0.022, 0.02, 0.008), chrome, 0, y, 3.662 - (y - 0.82) * 0.08, lean, 0, 0);
  // grille warning lights (red / white)
  lightModule(g, warn.red, 0.16, 0.07, -0.3, 0.82, 3.665);
  lightModule(g, warn.white, 0.16, 0.07, 0.3, 0.82, 3.665);
  for (const s of [-1, 1]) {
    // composite headlamp: black housing, two chrome reflector bowls with projectors, clear lens
    const x = s * 0.755;
    add(g, G.rbox(0.36, 0.16, 0.06, 0.03), dark, x, 0.925, 3.6, lean, 0, 0);
    for (const dx of [-0.085, 0.075]) {
      add(g, G.circle(0.055, 20), chrome, x + dx * s, 0.93, 3.633, lean, 0, 0);
      add(g, G.sphere(0.022, 12, 8), lens('#f6f3ea', '#fff4e0', 0.04), x + dx * s, 0.93, 3.636);
    }
    add(g, G.rbox(0.355, 0.155, 0.012, 0.03), autoGlass('#eef3f5', 0.16), x, 0.925, 3.642, lean, 0, 0);
    // amber turn lamp under it, amber side marker on the fender, red intersection light
    add(g, G.rbox(0.24, 0.05, 0.03, 0.012), lens('#ff9f2e', '#ff9a20', 0.05), x, 0.8, 3.64, lean, 0, 0);
    add(g, G.box(0.006, 0.045, 0.1), lens('#ff9f2e', '#ff9a20', 0.15), s * 1.003, 0.95, 3.38);
    lightModule(g, warn.red, 0.16, 0.07, s * 1.006, 0.99, 3.18, s * Math.PI / 2);
  }
  // chrome bumper with rubber end caps, air dam, front plate
  add(g, G.rbox(1.86, 0.22, 0.2, 0.05), chrome, 0, 0.47, 3.74);
  for (const s of [-1, 1]) add(g, G.rbox(0.16, 0.22, 0.2, 0.05), trim, s * 1.0, 0.47, 3.72);
  add(g, G.rbox(1.9, 0.08, 0.12, 0.03), trim, 0, 0.33, 3.64);
  add(g, G.plane(0.305, 0.152), plateMaterial('EMS 2481'), 0, 0.47, 3.845);
  // hood seams (cowl line + hood edges) on the sloped hood
  const hoodY = (z: number) => (z > 3.1 ? 1.11 + ((3.5 - z) / 0.4) * 0.07 : 1.18 + ((3.1 - z) / 0.32) * 0.075);
  for (const s of [-1, 1]) {
    for (const [za, zb] of [[3.48, 3.1], [3.1, 2.8]] as [number, number][]) {
      const len = za - zb;
      add(g, G.box(0.007, 0.004, len), dark, s * 0.9, (hoodY(za) + hoodY(zb)) / 2 + 0.002, (za + zb) / 2, Math.atan2(hoodY(zb) - hoodY(za), len), 0, 0);
    }
  }
  add(g, G.box(1.8, 0.004, 0.008), dark, 0, hoodY(2.8) + 0.003, 2.8);
  // mirrored AMBULANCE on the hood (text tops toward the windshield)
  add(g, G.plane(1.3, 0.22), mirroredWord('hood', 1.3, 0.22), 0, hoodY(3.2) + 0.006, 3.2, -Math.PI / 2 + Math.atan2(0.07, 0.4), 0, 0);
}

/** compartment / entry doors on a box side: [z0, z1, y0, y1], hinge at 'f'ront / 'r'ear / 't'op edge */
type BoxDoor = [number, number, number, number, 'f' | 'r' | 't'];
const DOORS_STREET: BoxDoor[] = [
  [0.22, 1.02, 0.96, 2.56, 'f'],
  [-0.9, 0.14, 1.58, 2.56, 't'],
  [-0.9, 0.14, 0.96, 1.5, 'f'],
  [-2.1, -1.04, 1.02, 1.92, 't'],
  [-3.06, -2.18, 0.96, 2.56, 'r'],
];
const DOORS_CURB: BoxDoor[] = [
  [-0.27, 0.72, 0.92, 2.6, 'f'], // side entry door
  [-1.0, -0.36, 0.96, 2.56, 'f'],
  [-2.1, -1.04, 1.02, 1.92, 't'],
  [-3.06, -2.18, 0.96, 2.56, 'r'],
];

function ambulanceBox(g: THREE.Group, white: THREE.Material, warn: { red: THREE.Material; white: THREE.Material; amber: THREE.Material }) {
  const { hw, y0, y1, z0, z1, r } = AMB.box;
  const dark = solid('#2b2e31', 0.6);
  const chrome = VM.chrome();
  const stainless = VM.stainless();
  // shell: an open tube (walls, roof, floor) + front panel; the rear face is the livery itself
  add(g, tubeOnly(roundedRect(hw, y0, y1, r), z1 - z0), white, 0, 0, z0);
  const face = trackGeo(new THREE.ShapeGeometry(roundedRect(hw, y0, y1, r), 6));
  {
    // shape UVs → 0..1 over the face, for the rear livery
    const uv = face.getAttribute('uv') as THREE.BufferAttribute;
    const pos = face.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + hw) / (2 * hw), (pos.getY(i) - y0) / (y1 - y0));
  }
  add(g, face, white, 0, 0, z1);
  const rearWin: [number, number, number, number][] = [[-0.79, -0.25, 1.92, 2.38], [0.25, 0.79, 1.92, 2.38]];
  add(g, face, rearLivery(hw * 2, y1 - y0, y0, rearWin), 0, 0, z0, 0, Math.PI, 0);
  // skirt below the box with the rear wheel arch, diamond-plate rub rails, stainless arch trim
  const skirt: [number, number][] = [[z0 + 0.05, 0.52], ...archPts(AMB.axleR, 0.36, 0.5, 0.52), [z1 - 0.05, 0.52], [z1 - 0.05, y0 + 0.01], [z0 + 0.05, y0 + 0.01]];
  add(g, profileGeo(skirt, hw * 2 - 0.02, 0.02, 10), white);
  for (const s of [-1, 1]) {
    add(g, G.box(0.026, 0.07, z1 - z0 - 0.12), VM.tread(), s * (hw + 0.004), y0 + 0.02, (z0 + z1) / 2);
    add(g, G.torus(0.5, 0.02, 6, 28, Math.PI - 2 * Math.asin(0.32)), stainless, s * (hw - 0.002), 0.36, AMB.axleR, 0, Math.PI / 2, Math.asin(0.32));
  }
  // side livery decals over the flat walls
  const dz0 = z0 + r + 0.012;
  const dz1 = z1 - r - 0.012;
  const dy0 = y0 + r + 0.012;
  const dy1 = y1 - r - 0.012;
  const dLen = dz1 - dz0;
  const dH = dy1 - dy0;
  add(g, G.plane(dLen, dH), boxSideLivery(dLen, dH, true, null, dy0), hw + 0.002, (dy0 + dy1) / 2, (dz0 + dz1) / 2, 0, Math.PI / 2, 0);
  add(g, G.plane(dLen, dH), boxSideLivery(dLen, dH, false, [dz1 - 0.6, dz1 + 0.13, 1.78, 2.42], dy0), -hw - 0.002, (dy0 + dy1) / 2, (dz0 + dz1) / 2, 0, -Math.PI / 2, 0);
  // compartment doors: seams, paddle latches, piano hinges
  for (const [s, doors] of [[1, DOORS_STREET], [-1, DOORS_CURB]] as [number, BoxDoor[]][]) {
    const x = s * (hw + 0.004);
    for (const [a, b, c, d, hinge] of doors) {
      seam(g, x, a, c, b, c, dark);
      seam(g, x, a, d, b, d, dark);
      seam(g, x, a, c, a, d, dark);
      seam(g, x, b, c, b, d, dark);
      const latchZ = hinge === 'f' ? a + 0.07 : hinge === 'r' ? b - 0.07 : (a + b) / 2;
      const latchY = hinge === 't' ? c + 0.08 : (c + d) / 2;
      add(g, G.rbox(0.022, 0.07, 0.12, 0.008), dark, s * (hw + 0.006), latchY, latchZ);
      add(g, G.rbox(0.03, 0.03, 0.09, 0.01), chrome, s * (hw + 0.016), latchY, latchZ);
      if (hinge === 't') add(g, G.box(0.012, 0.016, b - a - 0.04), stainless, s * (hw + 0.008), d - 0.012, (a + b) / 2);
      else add(g, G.box(0.012, d - c - 0.04, 0.016), stainless, s * (hw + 0.008), (c + d) / 2, hinge === 'f' ? b - 0.012 : a + 0.012);
    }
  }
  // curb side entry door: window (dark glass over the painted-dark opening), grab handle, fold-down step
  add(g, G.plane(0.72, 0.62), autoGlass('#202a31', 0.55), -hw - 0.005, 2.1, 0.235, 0, -Math.PI / 2, 0);
  add(g, G.cyl(0.016, 0.016, 0.72, 10), chrome, -hw - 0.06, 1.48, 0.86);
  for (const y of [1.12, 1.84]) add(g, G.box(0.06, 0.03, 0.03), chrome, -hw - 0.03, y, 0.86);
  add(g, G.rbox(0.26, 0.04, 0.86, 0.01), VM.tread(), -hw - 0.1, 0.5, 0.23);
  // upper warning lights (red) at the corners + mid side, white scene lights, low marker lamps
  const scene = lens('#eef2f6', '#ffffff', 0.0);
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.002);
    const ry = s * Math.PI / 2;
    for (const z of [z1 - 0.2, -1.05, z0 + 0.22]) lightModule(g, warn.red, 0.24, 0.11, x, y1 - 0.17, z, ry);
    for (const z of [0.42, -2.4]) lightModule(g, scene, 0.2, 0.09, x, y1 - 0.17, z, ry);
    add(g, G.box(0.012, 0.04, 0.07), lens('#ff9f2e', '#ff9a20', 0.6), x + s * 0.006, 1.02, z1 - 0.08);
    add(g, G.box(0.012, 0.04, 0.07), lens('#c81d1d', '#ff2a1a', 0.6), x + s * 0.006, 1.02, z0 + 0.08);
  }
  // box front (above the cab): red corners, white center, amber clearance lamps, mirrored AMBULANCE
  for (const s of [-1, 1]) lightModule(g, warn.red, 0.26, 0.12, s * 0.98, y1 - 0.17, z1 + 0.002);
  lightModule(g, warn.white, 0.42, 0.12, 0, y1 - 0.17, z1 + 0.002);
  for (const x of [-0.22, 0, 0.22]) add(g, G.rbox(0.07, 0.035, 0.03, 0.01), lens('#ff9f2e', '#ff9a20', 0.8), x, y1 - 0.04, z1 + 0.01);
  add(g, G.plane(1.5, 0.24), mirroredWord('front', 1.5, 0.24), 0, 2.34, z1 + 0.004);
  // rear: header lights, door seams, hinges, handles, corner light stacks, step bumper
  const zr = z0 - 0.003;
  for (const s of [-1, 1]) {
    lightModule(g, warn.red, 0.26, 0.12, s * 0.95, 2.66, zr, Math.PI);
    lightModule(g, scene, 0.2, 0.09, s * 0.56, 2.66, zr, Math.PI);
    add(g, G.box(0.007, 2.5 - 0.92, 0.004), dark, s * 1.02, (0.92 + 2.5) / 2, zr);
    for (const y of [1.15, 1.85, 2.38]) add(g, G.rbox(0.05, 0.1, 0.03, 0.01), stainless, s * 1.045, y, zr - 0.01);
    const px = s * 1.12;
    add(g, G.rbox(0.15, 0.66, 0.03, 0.02), VM.gloss(), px, 1.33, zr);
    add(g, G.rbox(0.12, 0.09, 0.02, 0.01), lens('#eef2f6', '#ffffff', 0.02), px, 1.06, zr - 0.012);
    add(g, G.rbox(0.12, 0.11, 0.02, 0.01), lens('#ff9f2e', '#ff9a20', 0.05), px, 1.18, zr - 0.012);
    add(g, G.rbox(0.12, 0.15, 0.02, 0.01), lens('#b5141c', '#ff2016', 0.35), px, 1.33, zr - 0.012);
    add(g, G.rbox(0.12, 0.13, 0.02, 0.01), warn.red, px, 1.53, zr - 0.012);
    // corner guards over the step: their bottoms sit 3 mm up inside it, not flush with its underside
    add(g, G.rbox(0.15, 0.14, 0.1, 0.03), VM.trim(), s * 1.0, 0.523, z0 - 0.06);
  }
  lightModule(g, warn.amber, 0.32, 0.11, 0, 2.66, zr, Math.PI);
  add(g, G.box(0.007, 2.5 - 0.92, 0.004), dark, 0, (0.92 + 2.5) / 2, zr);
  add(g, G.box(2.04, 0.007, 0.004), dark, 0, 2.5, zr);
  add(g, G.box(2.04, 0.007, 0.004), dark, 0, 0.92, zr);
  add(g, G.rbox(0.04, 0.17, 0.04, 0.012), chrome, -0.14, 1.5, zr - 0.02);
  add(g, G.rbox(0.03, 0.12, 0.035, 0.01), chrome, 0.14, 1.5, zr - 0.018);
  add(g, G.rbox(2.1, 0.1, 0.32, 0.02), VM.tread(), 0, 0.5, z0 - 0.16);
  for (const [x0, x1, wy0, wy1] of rearWin) add(g, G.plane(x1 - x0 - 0.01, wy1 - wy0 - 0.01), autoGlass('#1e272e', 0.32), (x0 + x1) / 2, (wy0 + wy1) / 2, z0 - 0.006, 0, Math.PI, 0);
  // roof: A/C condenser, antennas
  add(g, G.rbox(1.15, 0.2, 0.78, 0.05), white, 0, y1 + 0.1, 0.45);
  add(g, G.cyl(0.006, 0.006, 0.42, 6), VM.trim(), 0.6, y1 + 0.21, -0.6);
}

/**
 * Builds the ambulance into `out.group` (merged by material) and returns its warning lights in
 * `out.lightBar` (merged per lens color; the world flashes red vs white phases on EMS arrival).
 */
export function buildAmbulance(out: { group: THREE.Group; lightBar: THREE.Mesh[] }) {
  const src = new THREE.Group();
  const white = carPaint('#f3f3ef');
  const warn = { red: warnMat('red'), white: warnMat('white'), amber: warnMat('amber') };
  ambulanceCab(src, white);
  ambulanceFront(src, warn);
  ambulanceBox(src, white, warn);
  ambulanceInterior(src);
  // cab doors: the stripe continues from the module
  const door = { z0: 1.33, z1: 2.47, y0: 0.71, y1: AMB.cab.belt - 0.01 };
  for (const s of [-1, 1]) {
    const mat = cabDoorLivery(s > 0, door.z1 - door.z0, door.y1 - door.y0, door.y0);
    add(src, G.plane(door.z1 - door.z0, door.y1 - door.y0), mat, s * (AMB.cab.hw + 0.002), (door.y0 + door.y1) / 2, (door.z0 + door.z1) / 2, 0, s * Math.PI / 2, 0);
  }
  // chassis: frame rails, axles + differential, leaf springs, exhaust, mud flaps, under-cab fill
  const under = VM.underbody();
  for (const s of [-1, 1]) {
    add(src, G.box(0.08, 0.2, 6.3), under, s * 0.43, 0.55, 0.2);
    add(src, G.box(0.07, 0.06, 1.3), under, s * 0.43, 0.47, AMB.axleR);
    add(src, G.box(0.3, 0.34, 0.012), VM.rubber(), s * 0.84, 0.36, AMB.axleR - 0.55);
    add(src, G.box(0.26, 0.3, 0.012), VM.rubber(), s * 0.84, 0.44, AMB.axleF - 0.55);
  }
  add(src, G.cyl(0.07, 0.07, 1.62, 12), under, 0, 0.362, AMB.axleR, 0, 0, Math.PI / 2);
  add(src, G.sphere(0.15, 14, 10), under, 0, 0.35, AMB.axleR);
  add(src, G.cyl(0.05, 0.05, 1.55, 10), under, 0, 0.36, AMB.axleF, 0, 0, Math.PI / 2);
  add(src, G.box(1.9, 0.08, 2.3), under, 0, 0.58, 2.35);
  add(src, G.cyl(0.035, 0.035, 0.5, 10), under, -0.9, 0.46, -0.95, 0, 0, Math.PI / 2);
  add(src, G.cyl(0.045, 0.04, 0.14, 14), VM.chrome(), -1.2, 0.46, -0.95, 0, 0, Math.PI / 2);
  // wheels: chrome simulators up front, dual rear wheels
  const t = { ...AMB.tire, label: 'AGENTTREAD   LT225/75R16   LOAD RANGE E   M+S' };
  for (const s of [-1, 1] as const) {
    wheel(src, s * 0.876, 0.362, AMB.axleF, s, { ...t, style: 'simulator' });
    wheel(src, s * 0.7, 0.362, AMB.axleR, s, { ...t, style: 'dualInner' });
    wheel(src, s * 0.955, 0.362, AMB.axleR, s, { ...t, style: 'dualOuter' });
  }
  const merged = mergeByMaterial(src);
  const warnSet = new Set<THREE.Material>([warn.red, warn.white, warn.amber]);
  for (const m of merged.children as THREE.Mesh[]) if (warnSet.has(m.material as THREE.Material)) out.lightBar.push(m);
  merged.userData.xpart = 'amb';
  out.group.add(merged);
}

/** the patient compartment seen through the rear windows: cabinets, ceiling light, stretcher */
function ambulanceInterior(g: THREE.Group) {
  const { y0, y1, z0, z1 } = AMB.box;
  const wall = cached('ambwall', () => {
    const { canvas, ctx } = makeCanvas(512, 256);
    ctx.fillStyle = '#e9edf0';
    ctx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#cdd5db';
      ctx.fillRect(10 + i * 84, 14, 74, 92);
      ctx.fillStyle = 'rgba(120,150,170,0.35)';
      ctx.fillRect(16 + i * 84, 20, 62, 80);
      ctx.fillStyle = '#9aa5ad';
      ctx.fillRect(70 + i * 84, 56, 4, 14);
    }
    ctx.fillStyle = '#2f6fa8';
    ctx.fillRect(0, 118, 512, 10);
    ctx.fillStyle = '#d8dde1';
    ctx.fillRect(0, 140, 512, 116);
    return outdoor(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.6, side: THREE.BackSide }), 0.5);
  });
  const inner = new THREE.BoxGeometry(2.2, y1 - y0 - 0.12, z1 - z0 - 0.12);
  add(g, trackGeo(inner), wall, 0, (y0 + y1) / 2, (z0 + z1) / 2);
  add(g, G.plane(1.2, 0.25), solid('#ffffff', 0.5, 0, { emissive: '#f2f5ff', ei: 1.6 }), 0, y1 - 0.075, -1.6, Math.PI / 2, 0, 0);
  add(g, G.rbox(0.62, 0.16, 1.95, 0.04), solid('#2d3236', 0.5, 0.3), 0.32, 1.12, -1.9);
  add(g, G.rbox(0.56, 0.1, 1.85, 0.05), solid('#3d6fa2', 0.7), 0.32, 1.25, -1.9);
  add(g, G.rbox(0.5, 0.42, 1.7, 0.06), solid('#3f5866', 0.85), -0.82, 1.15, -1.7);
}

// ───────────────────────────── parked cars ─────────────────────────────

type Pt = [number, number];
interface CarSpec {
  L: number;
  W: number;
  axF: number;
  axR: number;
  tire: { R: number; W: number; Rr: number };
  bottom: number;
  /** lower body above the bottom edge: front face → hood → beltline → rear (z, y), front first */
  upper: Pt[];
  /** greenhouse polygon (glass), front-bottom first */
  glass: Pt[];
  roof: Pt[];
  bPillar: number;
  cPillar?: Pt[];
  doors: number[];
  rim: WheelStyle;
  bed?: [number, number, number];
  /** windshield edge (base → top) for the A-pillars */
  aPillar: [Pt, Pt];
  /** black plastic lower cladding + arch flares (SUVs, trucks) */
  cladding?: boolean;
  /** lamp / grille / rear plate positions (z, y) */
  head: Pt;
  tail: Pt;
  grille: Pt;
  plateR: Pt;
}

const CARS: Record<'sedan' | 'suv' | 'hatch' | 'pickup', CarSpec> = {
  sedan: {
    L: 4.85, W: 1.84, axF: 1.47, axR: -1.36, tire: { R: 0.335, W: 0.225, Rr: 0.216 }, bottom: 0.3,
    upper: [[2.36, 0.3], [2.42, 0.34], [2.45, 0.42], [2.46, 0.52], [2.455, 0.6], [2.43, 0.67], [2.38, 0.72], [2.3, 0.755], [2.1, 0.79], [1.8, 0.825], [1.45, 0.865], [1.1, 0.905], [0.92, 0.94], [0.5, 0.955], [-0.5, 0.97], [-1.5, 0.985], [-1.78, 0.99], [-2.0, 0.995], [-2.2, 0.985], [-2.33, 0.965], [-2.4, 0.93], [-2.44, 0.86], [-2.46, 0.74], [-2.465, 0.6], [-2.45, 0.47], [-2.42, 0.38], [-2.36, 0.3]],
    glass: [[0.92, 0.935], [0.62, 1.07], [0.3, 1.24], [0.05, 1.36], [-0.25, 1.415], [-0.65, 1.43], [-1.0, 1.41], [-1.3, 1.32], [-1.55, 1.16], [-1.78, 0.985], [-1.4, 0.975], [0.4, 0.95]],
    roof: [[0.06, 1.355], [-0.25, 1.432], [-0.65, 1.447], [-1.0, 1.427], [-1.06, 1.405], [-0.65, 1.425], [-0.25, 1.41], [0.08, 1.34]],
    aPillar: [[0.92, 0.935], [0.05, 1.36]], bPillar: -0.28, cPillar: [[-1.25, 0.975], [-1.0, 1.41], [-1.3, 1.32], [-1.55, 1.16], [-1.78, 0.985]], doors: [0.9, -0.28, -1.25], rim: 'alloy',
    head: [2.38, 0.69], tail: [-2.42, 0.87], grille: [2.45, 0.52], plateR: [-2.46, 0.6],
  },
  suv: {
    L: 4.75, W: 1.9, axF: 1.4, axR: -1.45, tire: { R: 0.37, W: 0.235, Rr: 0.229 }, bottom: 0.42,
    upper: [[2.3, 0.42], [2.36, 0.46], [2.39, 0.56], [2.4, 0.7], [2.39, 0.84], [2.35, 0.95], [2.27, 1.0], [2.0, 1.04], [1.6, 1.07], [1.2, 1.1], [0.98, 1.12], [0.3, 1.13], [-1.0, 1.15], [-2.0, 1.16], [-2.2, 1.15], [-2.3, 1.1], [-2.35, 0.98], [-2.37, 0.8], [-2.37, 0.62], [-2.34, 0.48], [-2.28, 0.42]],
    glass: [[0.98, 1.115], [0.7, 1.3], [0.42, 1.5], [0.2, 1.62], [-0.2, 1.665], [-1.2, 1.68], [-1.9, 1.67], [-2.1, 1.6], [-2.2, 1.38], [-2.26, 1.16], [-1.0, 1.145], [0.4, 1.128]],
    roof: [[0.22, 1.615], [-0.2, 1.68], [-1.2, 1.695], [-1.9, 1.685], [-2.1, 1.615], [-2.13, 1.6], [-1.9, 1.67], [-1.2, 1.682], [-0.2, 1.667], [0.24, 1.6]],
    aPillar: [[0.98, 1.115], [0.2, 1.62]], bPillar: -0.42, cPillar: [[-1.55, 1.15], [-1.45, 1.68], [-1.9, 1.67], [-2.1, 1.6], [-2.2, 1.38], [-2.26, 1.16]], doors: [0.92, -0.42, -1.48], rim: 'alloy6',
    head: [2.33, 0.93], tail: [-2.33, 1.02], grille: [2.39, 0.76], plateR: [-2.37, 0.76], cladding: true,
  },
  hatch: {
    L: 4.3, W: 1.78, axF: 1.32, axR: -1.33, tire: { R: 0.315, W: 0.205, Rr: 0.203 }, bottom: 0.32,
    upper: [[2.1, 0.32], [2.16, 0.37], [2.19, 0.46], [2.19, 0.57], [2.16, 0.66], [2.1, 0.72], [1.95, 0.77], [1.6, 0.82], [1.25, 0.88], [1.0, 0.92], [0.3, 0.94], [-1.0, 0.97], [-1.82, 0.99], [-2.02, 0.98], [-2.1, 0.92], [-2.14, 0.78], [-2.16, 0.6], [-2.14, 0.45], [-2.1, 0.32]],
    glass: [[1.0, 0.915], [0.72, 1.07], [0.45, 1.23], [0.18, 1.37], [-0.15, 1.43], [-1.2, 1.445], [-1.62, 1.42], [-1.85, 1.28], [-2.0, 1.0], [-1.0, 0.965], [0.3, 0.935]],
    roof: [[0.2, 1.365], [-0.15, 1.442], [-1.2, 1.458], [-1.62, 1.433], [-1.66, 1.415], [-1.2, 1.445], [-0.15, 1.428], [0.22, 1.35]],
    aPillar: [[1.0, 0.915], [0.18, 1.37]], bPillar: -0.32, cPillar: [[-1.28, 0.97], [-1.2, 1.44], [-1.62, 1.42], [-1.85, 1.28], [-2.0, 1.0]], doors: [0.95, -0.32, -1.22], rim: 'alloy',
    head: [2.14, 0.7], tail: [-2.12, 0.86], grille: [2.19, 0.5], plateR: [-2.16, 0.6],
  },
  pickup: {
    L: 5.75, W: 2.0, axF: 1.95, axR: -1.75, tire: { R: 0.39, W: 0.265, Rr: 0.254 }, bottom: 0.48,
    upper: [[2.83, 0.48], [2.88, 0.55], [2.9, 0.7], [2.9, 0.95], [2.88, 1.08], [2.8, 1.16], [2.5, 1.2], [1.8, 1.24], [1.25, 1.27], [0.0, 1.28], [-0.66, 1.29], [-0.72, 1.31], [-2.86, 1.31], [-2.9, 1.25], [-2.91, 0.9], [-2.9, 0.6], [-2.85, 0.48]],
    glass: [[1.25, 1.265], [0.95, 1.45], [0.68, 1.68], [0.45, 1.84], [0.2, 1.88], [-0.55, 1.885], [-0.62, 1.8], [-0.66, 1.29], [0.0, 1.275]],
    roof: [[0.47, 1.83], [0.2, 1.895], [-0.55, 1.9], [-0.6, 1.88], [-0.55, 1.883], [0.2, 1.878], [0.49, 1.815]],
    aPillar: [[1.25, 1.265], [0.45, 1.84]], bPillar: -0.1, doors: [1.2, -0.1, -0.62], rim: 'steelie', bed: [-0.72, -2.86, 1.315],
    head: [2.88, 1.02], tail: [-2.92, 1.08], grille: [2.9, 0.88], plateR: [-2.93, 0.72], cladding: true,
  },
};

/**
 * Shape an extruded body: narrow toward the bumpers in plan view (last `ez` m of each end by up to
 * `kz`) and lean the sides in above `y0` (by `ky` at `y1`: tumblehome).
 */
function taper(g: THREE.BufferGeometry, halfL: number, ez: number, kz: number, y0: number, y1: number, ky: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = Math.abs(pos.getZ(i));
    const y = pos.getY(i);
    const e = Math.max(0, (z - (halfL - ez)) / ez);
    let k = 1 - kz * e * e;
    if (ky > 0 && y > y0) k *= 1 - ky * Math.min(1, (y - y0) / Math.max(0.01, y1 - y0));
    pos.setX(i, pos.getX(i) * k);
  }
  return smoothNormals(g);
}

/** smooth normals across gentle warps, crisp edges kept (non-indexed geometry would come out faceted) */
function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = toCreasedNormals(g, (50 * Math.PI) / 180);
  if (out !== g) g.dispose();
  return trackGeo(out);
}

/**
 * Round a body's cross-section: tuck the sides in toward the sill, keep the shoulder at the
 * beltline full width, and crown the hood / trunk / roof toward the centerline.
 */
function section(g: THREE.BufferGeometry, hw: number, bottom: number, belt: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - bottom) / Math.max(0.05, (belt - bottom) * 0.55)));
    const tuck = 0.935 + 0.065 * t * t * (3 - 2 * t);
    const u = Math.min(1, Math.abs(x) / hw);
    pos.setX(i, x * tuck);
    if (y > belt - 0.2) pos.setY(i, y + 0.03 * (1 - u * u) * Math.min(1, (y - (belt - 0.2)) / 0.2));
  }
  return smoothNormals(g);
}

const PLATES = ['7KDL 482', 'HXR 2219', '4MNA 915', 'BTZ 6043', 'GRV 3170', '9PLF 228'];

/** a parked car (unmerged: the exterior merges all cars together), local frame like the ambulance */
export function buildCar(kind: keyof typeof CARS, color: string, metallic: boolean, seed: number): THREE.Group {
  const s = CARS[kind];
  const g = new THREE.Group();
  const paint = carPaint(color, metallic);
  const glassMat = cached('carglass', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: '#141b20', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.68, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1 });
    m.userData.noShadow = true;
    return outdoor(m, 2.6);
  });
  const trim = VM.trim();
  const dark = VM.gloss();
  const hw = s.W / 2;
  // lower body: bottom edge with both wheel arches, then the upper outline (front → rear)
  const arch = (ax: number) => archPts(ax, s.tire.R - 0.005, s.tire.R + 0.065, s.bottom);
  const lower: Pt[] = [...arch(s.axR), ...arch(s.axF), ...s.upper];
  add(g, section(taper(profileGeo(lower, s.W, 0.085, 10), s.L / 2, 0.9, 0.14, 0, 0, 0), s.W / 2, s.bottom, s.glass[0][1]), paint);
  // greenhouse with tumblehome (sides lean in toward the roof), roof skin, pillars
  const belt = s.glass[0][1];
  const roofY = s.roof[2][1];
  // front + rear details fitted to the body as built: the extrusion narrows toward the bumpers
  // (taper) and tucks in toward the sill (section), and its corners are rounded
  const halfL = s.L / 2;
  const kTaper = (z: number) => {
    const e = Math.max(0, (Math.abs(z) - (halfL - 0.9)) / 0.9);
    return 1 - 0.14 * e * e;
  };
  const tuck = (y: number) => {
    const t = Math.min(1, Math.max(0, (y - s.bottom) / Math.max(0.05, (belt - s.bottom) * 0.55)));
    return 0.935 + 0.065 * t * t * (3 - 2 * t);
  };
  const halfW = (z: number, y: number) => hw * kTaper(z) * tuck(y);
  /** the front (+z) or rear (−z) face of the body at height y (centreline of the side profile) */
  const faceZ = (front: boolean, y: number) => {
    let best = front ? -Infinity : Infinity;
    for (let i = 0; i + 1 < s.upper.length; i++) {
      const [z0, y0] = s.upper[i];
      const [z1, y1] = s.upper[i + 1];
      if (y0 === y1 || (y0 - y) * (y1 - y) > 0) continue;
      const z = z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
      best = front ? Math.max(best, z) : Math.min(best, z);
    }
    return best;
  };
  add(g, taper(profileGeo(s.glass, s.W * 0.88, 0.06, 6), s.L / 2, 0.75, 0.06, belt, roofY, 0.13), glassMat);
  add(g, taper(profileGeo(s.roof, s.W * 0.88, 0.04, 6), s.L / 2, 0.75, 0.06, belt, roofY, 0.13), paint);
  const gw = s.W * 0.44;
  const [ws0, ws1] = s.aPillar;
  const sl = Math.atan2(ws1[1] - ws0[1], ws0[0] - ws1[0]);
  const wl = Math.hypot(ws1[1] - ws0[1], ws0[0] - ws1[0]);
  // greenhouse parts are placed, then leaned in with the same tumblehome as the glass
  const lean = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx: number, ry: number) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
    const gg = geo.clone().applyMatrix4(m);
    add(g, trackGeo(taper(gg.index ? gg.toNonIndexed() : gg, s.L / 2, 0.75, 0.06, belt, roofY, 0.13)), mat);
  };
  for (const sx of [-1, 1]) {
    lean(G.rbox(0.1, wl + 0.03, 0.06, 0.025), paint, sx * (gw - 0.036), (ws0[1] + ws1[1]) / 2, (ws0[0] + ws1[0]) / 2 + 0.012, -(Math.PI / 2 - sl), 0);
    const topY = roofY - 0.04;
    lean(G.box(0.012, topY - belt, 0.09), dark, sx * (gw + 0.003), (topY + belt) / 2, s.bPillar, 0, 0);
    // bright window trim along the beltline (sedans), black lower cladding (SUVs / trucks)
    if (kind === 'sedan') add(g, G.box(0.012, 0.018, s.aPillar[0][0] - (s.cPillar?.[0][0] ?? -1)), VM.chrome(), sx * (gw + 0.002), belt + 0.012, (s.aPillar[0][0] + (s.cPillar?.[0][0] ?? -1)) / 2);
    if (s.cladding) add(g, G.rbox(0.03, 0.16, s.axF - s.axR - 2 * (s.tire.R + 0.12), 0.012), trim, sx * (hw + 0.005), s.bottom + 0.11, (s.axF + s.axR) / 2);
    if (s.cPillar) {
      const shp = new THREE.Shape(s.cPillar.map(([z, y]) => new THREE.Vector2(sx > 0 ? -z : z, y)));
      lean(new THREE.ShapeGeometry(shp), paint, sx * (gw + 0.006), 0, 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // door seams, handles, mirror
    const beltY = s.glass[0][1];
    // door shut lines follow the body's tuck toward the sill (a straight line floated off it)
    const sideSeam = (z0: number, y0: number, z1: number, y1: number) => {
      const n = 6;
      const at = (k: number) => {
        const z = z0 + ((z1 - z0) * k) / n;
        const y = y0 + ((y1 - y0) * k) / n;
        return new THREE.Vector3(sx * (halfW(z, y) + 0.0025), y, z);
      };
      for (let k = 0; k < n; k++) {
        // each piece runs from surface point to surface point, so it neither sinks in nor floats off
        const a = at(k);
        const b = at(k + 1);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
        const e = new THREE.Euler().setFromQuaternion(q);
        const c = a.clone().add(b).multiplyScalar(0.5);
        add(g, G.box(0.004, 0.006, a.distanceTo(b) + 0.002), dark, c.x, c.y, c.z, e.x, e.y, e.z);
      }
    };
    for (const z of s.doors) sideSeam(z, s.bottom + 0.08, z, beltY - 0.01);
    sideSeam(s.doors[0], s.bottom + 0.08, s.doors[s.doors.length - 1], s.bottom + 0.08);
    for (let i = 0; i + 1 < s.doors.length; i++) add(g, G.rbox(0.025, 0.03, 0.13, 0.01), kind === 'pickup' ? trim : paint, sx * (hw + 0.012), beltY - 0.12, s.doors[i + 1] + 0.18);
    const mz = s.glass[0][0] - 0.17;
    const my = beltY + 0.075;
    const yaw = sx * 0.12;
    add(g, G.rbox(0.07, 0.08, 0.13, 0.02), dark, sx * (hw - 0.005), beltY + 0.035, mz + 0.01);
    add(g, G.rbox(0.05, 0.035, 0.06, 0.012), dark, sx * (hw + 0.035), my - 0.035, mz);
    add(g, G.rbox(0.2, 0.12, 0.085, 0.035), paint, sx * (hw + 0.13), my, mz, 0, yaw, 0);
    add(g, G.plane(0.17, 0.092), solid('#8e979c', 0.03, 1, { envI: 1.3 }), sx * (hw + 0.13) - Math.sin(yaw) * 0.0445, my, mz - Math.cos(yaw) * 0.0445, 0, Math.PI + yaw, 0);
  }
  // windshield: a black ceramic frit border on the glass (hides the glass/body joints like on real
  // cars), the cowl panel where the hood meets the glass, parked wipers, the rear-view mirror
  {
    const tilt = -(Math.PI / 2 - sl);
    const onWs = (t: number, out: number) => ({ z: ws0[0] + (ws1[0] - ws0[0]) * t + Math.sin(sl) * out, y: ws0[1] + (ws1[1] - ws0[1]) * t + Math.cos(sl) * out });
    const b0 = onWs(0.045, 0.004);
    lean(G.box(gw * 2 - 0.06, 0.08, 0.004), dark, 0, b0.y, b0.z, tilt, 0);
    const b1 = onWs(0.955, 0.004);
    lean(G.box(gw * 2 - 0.08, 0.06, 0.004), dark, 0, b1.y, b1.z, tilt, 0);
    const bm = onWs(0.5, 0.004);
    for (const sx of [-1, 1]) lean(G.box(0.05, wl * 0.92, 0.004), dark, sx * (gw - 0.1), bm.y, bm.z, tilt, 0);
    lean(G.rbox(gw * 2 - 0.1, 0.05, 0.15, 0.015), trim, 0, ws0[1] + 0.005, ws0[0] + 0.05, 0, 0);
    for (const [x, l] of [[-0.3, 0.5], [0.24, 0.55]] as [number, number][]) {
      const p = onWs(0.09, 0.018);
      add(g, G.box(l, 0.012, 0.018), trim, x, p.y, p.z, tilt, 0, 0.06);
    }
    const mi = onWs(0.86, -0.05);
    add(g, G.rbox(0.2, 0.06, 0.025, 0.012), dark, 0, mi.y, mi.z, tilt, 0, 0);
  }
  // front + rear details, fitted to the body (helpers above)
  const zH = faceZ(true, s.head[1]);
  const flatH = halfW(zH, s.head[1]) - 0.1; // flat part of the front face, inside the rounded corners
  const lampW = Math.min(0.46, flatH * 0.6);
  const hxC = flatH - lampW / 2 - 0.02;
  const zG = faceZ(true, s.grille[1]);
  add(g, G.rbox(Math.max(0.3, 2 * (hxC - lampW / 2 - 0.04)), 0.17, 0.06, 0.03), dark, 0, s.grille[1], zG - 0.022);
  const yI = s.bottom + 0.12;
  const zI = faceZ(true, yI);
  // its face stands 4 mm proud of the nose's foremost point over its height (the hatch's nose is
  // vertical just above it: 7 mm proud of the centre was 0.3 mm off that)
  const zIf = Math.max(...[-0.045, -0.0225, 0, 0.0225, 0.045].map((d) => faceZ(true, yI + d))) + 0.004;
  add(g, G.rbox(2 * (halfW(zI, yI) - 0.22), 0.09, 0.05, 0.02), trim, 0, yI, zIf - 0.025);
  const yT = s.tail[1];
  const zT = faceZ(false, yT);
  const flatT = halfW(zT, yT) - 0.1;
  const tailW = Math.min(0.44, flatT * 0.62);
  const txC = flatT - tailW / 2 + 0.02;
  // lamps sit on the nose / tail, which slope back: tilt each assembly to the face's local slope
  const faceTilt = (front: boolean, y: number) => {
    const d = (faceZ(front, y + 0.04) - faceZ(front, y - 0.04)) * (front ? -1 : 1);
    return front ? -Math.atan2(d, 0.08) : Math.atan2(d, 0.08);
  };
  const lampGroup = (x: number, y: number, z: number, rx: number) => {
    const gr = new THREE.Group();
    gr.position.set(x, y, z);
    gr.rotation.x = rx;
    g.add(gr);
    return gr;
  };
  for (const sx of [-1, 1]) {
    // headlamp: black housing, chrome reflector, projector, LED daytime strip, clear lens
    const hl = lampGroup(sx * hxC, s.head[1], zH, faceTilt(true, s.head[1]));
    add(hl, G.rbox(lampW, 0.12, 0.1, 0.04), dark, 0, 0, -0.042);
    add(hl, G.rbox(lampW - 0.03, 0.095, 0.02, 0.03), VM.chrome(), 0, 0, 0.004);
    add(hl, G.sphere(0.03, 12, 8), lens('#f6f3ea', '#fff4e0', 0.03), sx * lampW * 0.22, 0, 0.018);
    add(hl, G.box(lampW - 0.07, 0.012, 0.01), lens('#f2f4f6', '#ffffff', 0.05), 0, -0.042, 0.018);
    add(hl, G.rbox(lampW - 0.01, 0.11, 0.012, 0.035), autoGlass('#eef3f5', 0.16), 0, 0, 0.032);
    // fog lamp in the lower bumper
    const yF = s.bottom + 0.16;
    const zF = faceZ(true, yF);
    add(g, G.cyl(0.04, 0.04, 0.02, 14), lens('#e9edef', '#ffffff', 0.0), sx * (halfW(zF, yF) - 0.2), yF, zF + 0.006, Math.PI / 2, 0, 0);
    // tail lamp on the rear face, a sliver of it wrapping onto the side
    add(lampGroup(sx * txC, yT, zT, faceTilt(false, yT)), G.rbox(tailW, 0.11, 0.05, 0.025), lens('#7e0b12', '#ff2216', 0.05), 0, 0, 0.012);
    add(g, G.box(0.012, 0.1, 0.13), lens('#7e0b12', '#ff2216', 0.05), sx * (halfW(zT + 0.16, yT) + 0.002), yT, zT + 0.16);
  }
  // bumper split lines front + rear, inside the body's outline
  const yS = s.grille[1] + 0.13;
  add(g, G.box(2 * (halfW(faceZ(true, yS), yS) - 0.12), 0.006, 0.01), dark, 0, yS, faceZ(true, yS) + 0.002);
  const yR = s.plateR[1] + 0.16;
  add(g, G.box(2 * (halfW(faceZ(false, yR), yR) - 0.12), 0.006, 0.01), dark, 0, yR, faceZ(false, yR) - 0.002);
  // cabin seen through the glass: seats with headrests, dash, steering wheel
  const seat = solid('#25282b', 0.85);
  const zs = [s.bPillar + 0.25, s.bPillar - 0.55];
  // headrests stay well under the roof (they used to poke through it on the sedan)
  const headY = Math.min(belt + 0.3, roofY - 0.21);
  for (const [i, z] of zs.entries()) {
    if (kind === 'pickup' && i === 1) continue;
    for (const x of [-0.38, 0.38]) {
      add(g, G.rbox(0.48, 0.55, 0.13, 0.05), seat, x, headY - 0.36, z, -0.15, 0, 0);
      add(g, G.rbox(0.26, 0.17, 0.1, 0.04), seat, x, headY, z - 0.05, -0.15, 0, 0);
    }
  }
  add(g, G.rbox(s.W - 0.3, 0.16, 0.38, 0.05), seat, 0, belt + 0.02, s.aPillar[0][0] - 0.28);
  add(g, G.torus(0.17, 0.016, 8, 24), dark, 0.38, belt + 0.16, s.aPillar[0][0] - 0.55, 0.5, 0, 0);
  const plate = plateMaterial(PLATES[seed % PLATES.length]);
  // plates stand just proud of the body (front: over the lower grille)
  const yPF = s.grille[1] - 0.07;
  add(g, G.plane(0.305, 0.152), plate, 0, yPF, Math.max(faceZ(true, yPF), zG + 0.008) + 0.012);
  add(g, G.plane(0.305, 0.152), plate, 0, s.plateR[1], faceZ(false, s.plateR[1]) - 0.012, 0, Math.PI, 0);
  if (s.bed) add(g, G.box(s.W - 0.16, 0.012, s.bed[0] - s.bed[1] - 0.08), trim, 0, s.bed[2] + 0.006, (s.bed[0] + s.bed[1]) / 2);
  if (kind === 'suv') for (const sx of [-1, 1]) add(g, G.box(0.04, 0.035, 1.6), trim, sx * s.W * 0.36, s.roof[2][1] + 0.03, (s.roof[1][0] + s.roof[2][0]) / 2);
  // underbody, dark wheel-arch liners (seen around the tires), wheels
  add(g, G.box(s.W - 0.2, 0.1, s.L - 0.9), VM.underbody(), 0, s.bottom + 0.02, 0);
  const liner = cached('archliner', () => outdoor(new THREE.MeshStandardMaterial({ color: '#0e0f10', roughness: 0.9, side: THREE.DoubleSide }), 0.3));
  const lg = trackGeo(new THREE.CylinderGeometry(s.tire.R + 0.055, s.tire.R + 0.055, s.W - 0.12, 18, 1, true, 0, Math.PI));
  for (const az of [s.axF, s.axR]) add(g, lg, liner, 0, s.tire.R - 0.005, az, 0, 0, Math.PI / 2);
  const t = { ...s.tire, style: s.rim, rim: kind === 'pickup' ? '#2c2f31' : seed % 3 === 0 ? '#3b3f43' : undefined, label: 'AGENTTREAD  TOURING  M+S' };
  for (const sx of [-1, 1] as const) for (const az of [s.axF, s.axR]) wheel(g, sx * (hw - s.tire.W / 2 - 0.035), s.tire.R - 0.008, az, sx, t);
  // the body colour moves into the vertices: one shared paint per finish for the whole lot
  const vc = carPaintVC(metallic);
  const c = new THREE.Color(color);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.material !== paint) return;
    const geo = m.geometry.clone();
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.geometry = trackGeo(geo);
    m.material = vc;
  });
  return g;
}

// ───────────────────────────── wheels ─────────────────────────────

/** rubber with a tread band (circumferential grooves + sipes) and raised sidewall lettering */
function tireMaterial(label: string): THREE.MeshStandardMaterial {
  return cached(`tire|${label}`, () => {
    const W = 1024;
    const H = 128;
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, W, H);
    // tread band (middle of the profile): grooves along u, sipes across
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, H * 0.36, W, H * 0.28);
    ctx.fillStyle = '#0d0d0d';
    for (const f of [0.4, 0.47, 0.53, 0.6]) ctx.fillRect(0, H * f, W, H * 0.018);
    for (let i = 0; i < 96; i++) {
      const x = (i / 96) * W;
      ctx.fillRect(x, H * 0.37, 2, H * 0.25);
    }
    // sidewall lettering, both sides
    ctx.fillStyle = '#3a3a3a';
    ctx.font = `700 ${H * 0.1}px ui-sans-serif, Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const [v, flip] of [[0.2, false], [0.8, true]] as [number, boolean][]) {
      for (let k = 0; k < 2; k++) {
        ctx.save();
        ctx.translate(k * W * 0.5 + W * 0.06, H * v);
        if (flip) ctx.scale(1, -1);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    const t = canvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    return outdoor(new THREE.MeshStandardMaterial({ map: t, roughness: 0.86, metalness: 0 }), 0.6);
  });
}

/** tire around the x axis: outer radius R, section width W, rim radius Rr (lathe of a bulged section) */
function tireGeo(R: number, W: number, Rr: number): THREE.BufferGeometry {
  const key = `tire|${R}|${W}|${Rr}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const h = W / 2;
  const sw = R - Rr;
  const prof: [number, number][] = [
    [Rr - 0.004, -h * 0.8],
    [Rr + sw * 0.08, -h * 0.94],
    [Rr + sw * 0.45, -h * 1.0],
    [Rr + sw * 0.8, -h * 0.97],
    [R - 0.012, -h * 0.86],
    [R, -h * 0.66],
    [R + 0.002, -h * 0.2],
    [R + 0.002, h * 0.2],
    [R, h * 0.66],
    [R - 0.012, h * 0.86],
    [Rr + sw * 0.8, h * 0.97],
    [Rr + sw * 0.45, h * 1.0],
    [Rr + sw * 0.08, h * 0.94],
    [Rr - 0.004, h * 0.8],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), 56);
  g.rotateZ(Math.PI / 2);
  geoCache.set(key, trackGeo(g));
  return g;
}
const geoCache = new Map<string, THREE.BufferGeometry>();

/** lathe around the x axis from (radius, axial offset) pairs (outer face toward +x) */
function latheX(key: string, prof: [number, number][], seg = 40): THREE.BufferGeometry {
  const hit = geoCache.get(key);
  if (hit) return hit;
  // (lathe normals follow the profile direction: list points so the visible side faces +x)
  const g = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), seg);
  g.rotateZ(-Math.PI / 2);
  geoCache.set(key, trackGeo(g));
  return g;
}

export type WheelStyle = 'simulator' | 'dualOuter' | 'dualInner' | 'alloy' | 'alloy6' | 'steelie';

/**
 * A wheel at (x, y, z) with its outer face toward `side` (±x): tire + rim + hub + lug nuts.
 * `simulator` / `dualOuter` = chrome wheel simulators of an ambulance; `alloy` = 5-spoke car rim.
 */
export function wheel(parent: THREE.Object3D, x: number, y: number, z: number, side: 1 | -1, o: { R: number; W: number; Rr: number; style: WheelStyle; rim?: string; label?: string }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (side < 0) g.rotation.y = Math.PI;
  parent.add(g);
  const { R, W, Rr } = o;
  add(g, tireGeo(R, W, Rr), tireMaterial(o.label ?? 'ALL SEASON  M+S  RADIAL TUBELESS'));
  const h = W / 2;
  const chrome = VM.chrome();
  const rimMat = o.rim ? solid(o.rim, 0.32, 0.85) : solid('#b9bcbe', 0.35, 0.9);
  // barrel (inside the tire) + lip ring
  add(g, latheX(`barrel|${Rr}|${W}`, [[Rr * 0.96, h * 0.7], [Rr * 0.98, -h * 0.85]], 32), solid('#5d6266', 0.5, 0.7));
  add(g, G.torus(Rr - 0.004, 0.009, 6, 40), o.style === 'alloy' || o.style === 'alloy6' ? rimMat : chrome, h * 0.74, 0, 0, 0, Math.PI / 2, 0);
  if (o.style === 'dualInner') return g;
  if (o.style === 'simulator' || o.style === 'dualOuter') {
    // polished stainless wheel simulator: a shallow (front) or deep (rear dual) bowl with vent slots
    const deep = o.style === 'dualOuter' ? 0.11 : 0.035;
    add(g, latheX(`sim|${Rr}|${deep}|${h}`, [[Rr - 0.006, h * 0.72], [Rr * 0.86, h * 0.72 - deep * 0.35], [Rr * 0.55, h * 0.72 - deep], [Rr * 0.4, h * 0.72 - deep * 0.95], [Rr * 0.36, h * 0.72 - deep * 0.6]], 40), chrome);
    const slotMat = VM.gloss();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = Rr * 0.7;
      add(g, G.box(0.006, 0.05, 0.022), slotMat, h * 0.72 - deep * 0.62, Math.sin(a) * rr, Math.cos(a) * rr, Math.PI / 2 - a, 0, 0);
    }
    // hub with a domed cap and 8 lug nuts
    const hubX = h * 0.72 - deep * 0.6;
    add(g, latheX(`hub|${Rr}`, [[0.075, 0], [0.072, 0.03], [0.05, 0.05], [0.001, 0.058]], 28), chrome, hubX, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, G.cyl(0.011, 0.011, 0.03, 6), chrome, hubX + 0.01, Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0, 0, Math.PI / 2);
    }
    return g;
  }
  // car rims: spokes from a center hub to the barrel
  const spokes = o.style === 'alloy6' ? 6 : o.style === 'steelie' ? 0 : 5;
  const face = h * 0.62;
  add(g, latheX(`disc|${Rr}|${o.style}`, [[Rr * 0.34, face + 0.005], [Rr * 0.3, face + 0.02], [Rr * 0.2, face + 0.03], [0.001, face + 0.034]], 32), rimMat);
  if (spokes === 0) {
    add(g, latheX(`steel|${Rr}`, [[Rr * 0.97, face - 0.03], [Rr * 0.7, face - 0.01], [Rr * 0.36, face + 0.005]], 32), rimMat);
  } else {
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      for (const da of [-0.11, 0.11]) {
        const rr = Rr * 0.64;
        add(g, G.box(0.03, Rr * 0.64, 0.026), rimMat, face - 0.006, Math.cos(a + da) * rr * 0.98, Math.sin(a + da) * rr * 0.98, a + da, 0, 0);
      }
    }
    // dark inner barrel visible between the spokes + brake disc behind
    add(g, G.cyl(Rr * 0.62, Rr * 0.62, 0.012, 28), solid('#4b4f52', 0.45, 0.85), -0.02, 0, 0, 0, 0, Math.PI / 2);
  }
  add(g, G.cyl(0.032, 0.032, 0.012, 16), solid('#2b2e31', 0.35, 0.3), face + 0.034, 0, 0, 0, 0, Math.PI / 2);
  return g;
}

/**
 * Hospital props. Each builder returns a Group in local space: origin on the floor at the
 * prop's (x, z), front facing +z. Shapes use rounded/bevelled geometry and physically based
 * materials (brushed steel, vinyl, woven fabric, laminate, powder-coated metal, glass) so they
 * catch light like real equipment. Meshes flagged userData.noMerge stay separate (screens with
 * live textures, flashing light bars); everything else is merged by the builder.
 */
import * as THREE from 'three';
import type { PropDef } from '../../../shared/layout';
import { G, add, basic, boxB, canvasTexture, cylB, emitter, glass, lambert, makeCanvas, own, pbr, rboxB, trackGeo, tube } from './materials';
import { buildAmbulance } from './vehicles';
import { lampPost } from './exterior';
import { buildResusProp } from './resusGear';
import { buildImagingProp } from './imaging';
import { CT_LOAD_SURFACE, XR_SURFACE } from './imagingPlan';
import { buildCabinet, buildCdCupboard, buildFridge, crashCartDrawers, linenCart, supplyCartDrawers } from './cabinetModels';
import { bedSpec, makeUpBed, registerBed } from './bedding';
import { hingedBed } from './bedRig';

export type ScreenKind = 'monitor' | 'board' | 'computer' | 'tv' | 'whiteboard' | 'small';

export interface BuiltProp {
  group: THREE.Group;
  /** screen meshes that get a canvas texture assigned by the world */
  screens: { mesh: THREE.Mesh; kind: ScreenKind }[];
  /** flashing light bar segments (ambulance) */
  lightBar: THREE.Mesh[];
  /** emitting point light (lamp posts) anchor in local space */
  lampAnchor?: THREE.Vector3;
}

// ── material palette ──
const M = {
  steel: () => pbr('steel', { tile: 0.4, roughness: 0.8 }),
  chrome: () => lambert('#d9dde0', { roughness: 0.16, metalness: 1 }),
  alu: () => lambert('#b9bfc4', { roughness: 0.35, metalness: 0.85 }),
  plastic: (c: string, rough = 0.42) => pbr('plastic', { color: c, tile: 0.3, roughness: rough, normalScale: 0.3, worldUV: true }),
  paint: (c: string, rough = 0.38) => lambert(c, { roughness: rough, metalness: 0.15 }),
  vinyl: (c: string) => pbr('vinyl', { color: c, tile: 0.35, roughness: 0.85, normalScale: 0.5 }),
  fabric: (c: string) => pbr('fabric_seat', { color: c, tile: 0.4, roughness: 1 }),
  linen: (c: string) => pbr('fabric_curtain', { color: c, tile: 0.25, roughness: 1, normalScale: 0.6 }),
  wood: (c = '#ffffff') => pbr('wood', { color: c, tile: 1.2, roughness: 0.75 }),
  laminate: (c: string) => lambert(c, { roughness: 0.45 }),
  solidSurface: (c: string) => lambert(c, { roughness: 0.28 }),
  rubber: () => pbr('rubber', { color: '#2a2d30', tile: 0.2, roughness: 0.9 }),
  dark: () => lambert('#2b3034', { roughness: 0.45 }),
  black: () => lambert('#16191b', { roughness: 0.32 }),
};

const noMerge = (m: THREE.Mesh) => {
  m.userData.noMerge = true;
  return m;
};
const caster = (m: THREE.Mesh) => {
  m.userData.castShadow = true;
  return m;
};

/**
 * A named point on a fixture that hand hygiene reads off the built mesh (hygiene.ts): a tap's outlet,
 * a dispenser's nozzle, a towel's tail, a bin's opening. A bare Object3D survives the static merge
 * (builder.ts mergeInto drops only empty Groups), so it stays where the geometry is; `buildProp`
 * tags the prop's group with its id.
 */
function hygMark(parent: THREE.Object3D, part: string, x: number, y: number, z: number, data: Record<string, number> = {}): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.userData.hygPart = part;
  Object.assign(o.userData, data);
  parent.add(o);
  return o;
}

/** a moving part of a fixture (its meshes kept out of the merge): a lever, a push plate, a pedal, a towel's tail */
function hygPart(parent: THREE.Object3D, part: string, x: number, y: number, z: number, data: Record<string, number> = {}): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.hygPart = part;
  Object.assign(g.userData, data);
  parent.add(g);
  return g;
}

/**
 * A clinical hand-wash sink, 64 × 52 cm: a laminate cabinet, a solid-surface counter (68 × 56 cm,
 * its top at 88 cm) with a stainless bowl let into it, 16 cm deep, a rim round it and the drain at
 * its floor. The cabinet's top stops under the bowl; panels round its top close it in.
 */
function clinicalSink(g: THREE.Group) {
  const lam = M.laminate('#dfe3e0');
  rboxB(g, 0.64, 0.7, 0.52, 0.02, lam, 0, 0, 0);
  // the panels round the top, 6 mm proud of the cabinet (a seam where they meet it)
  boxB(g, 0.652, 0.13, 0.02, lam, 0, 0.705, 0.256);
  for (const s of [-1, 1]) boxB(g, 0.02, 0.13, 0.5, lam, s * 0.316, 0.705, -0.01);
  boxB(g, 0.62, 0.13, 0.02, lam, 0, 0.705, -0.25);
  // the counter, a slab with the bowl's (elliptical) hole
  const shape = new THREE.Shape();
  shape.moveTo(-0.34, -0.28);
  shape.lineTo(0.34, -0.28);
  shape.lineTo(0.34, 0.28);
  shape.lineTo(-0.34, 0.28);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, 0.02, 0.206, 0.176, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole);
  const top = trackGeo(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 36 }));
  top.rotateX(Math.PI / 2);
  add(g, top, M.solidSurface('#f2f2ef'), 0, 0.88, 0);
  // the bowl, brushed steel (the profile runs from the drain up to the rim, so its faces look into it), and its
  // rim, covering the hole's edge
  const bowlGeo = trackGeo(new THREE.LatheGeometry([[0.001, -0.157], [0.085, -0.152], [0.145, -0.128], [0.18, -0.085], [0.196, -0.035], [0.2, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 36));
  const bowl = add(g, bowlGeo, M.steel(), 0, 0.879, 0.02);
  bowl.scale.z = 0.855;
  const rim = add(g, G.torus(0.203, 0.0065, 8, 40), lambert('#d3d7da', { roughness: 0.25, metalness: 0.8 }), 0, 0.8815, 0.02, Math.PI / 2, 0, 0);
  rim.scale.y = 0.857;
  add(g, G.circle(0.024, 18), M.chrome(), 0, 0.7256, 0.02, -Math.PI / 2, 0, 0);
}

/**
 * The hand-wash sink's tap lever: a long chrome blade on the faucet's right, hinged at its base and
 * pointing out over the counter's right half. Lifted (the back of the wrist under it) the water runs;
 * pressed down (the wrist on top) it stops, so a clean hand never touches it. hygiene.ts turns the
 * hinge about its x (`off` → `on`) and puts the wrist `len` × 0.7 along its +z.
 */
function sinkLever(g: THREE.Group) {
  const yaw = new THREE.Group();
  yaw.position.set(0.045, 0.975, -0.2);
  yaw.rotation.y = 0.52;
  g.add(yaw);
  add(yaw, G.cyl(0.013, 0.013, 0.03, 14), M.chrome(), 0, 0, 0, 0, 0, Math.PI / 2);
  const hinge = hygPart(yaw, 'lever', 0, 0, 0, { len: 0.17, off: 0.06, on: -0.62 });
  hinge.rotation.x = 0.06;
  noMerge(add(hinge, G.rbox(0.014, 0.01, 0.15, 0.004), M.chrome(), 0, 0, 0.085));
  noMerge(add(hinge, G.rbox(0.034, 0.007, 0.045, 0.003), M.chrome(), 0, 0.0015, 0.148));
}

function screenMesh(parent: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, kind: ScreenKind, out: BuiltProp, ry = 0) {
  const m = new THREE.Mesh(G.plane(w, h), basic('#0b0f12'));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  noMerge(m);
  parent.add(m);
  out.screens.push({ mesh: m, kind });
  return m;
}

/** twin-wheel hospital casters with a swivel fork */
function casters(g: THREE.Group, xs: number[], zs: number[], r = 0.05) {
  for (const x of xs)
    for (const z of zs) {
      add(g, G.cyl(r, r, 0.035, 16), M.rubber(), x - 0.012, r, z, 0, 0, Math.PI / 2);
      add(g, G.cyl(r, r, 0.035, 16), M.rubber(), x + 0.028, r, z, 0, 0, Math.PI / 2);
      boxB(g, 0.03, 0.05, 0.035, M.chrome(), x + 0.008, r * 1.6, z);
    }
}

function bed(p: PropDef, out: BuiltProp, stretcher = false, mobile = false) {
  const g = out.group;
  const kind = stretcher ? 'stretcher' : 'bed';
  // sizes shared with the bedding (bedding.ts drapes a lying patient's blanket inside these rails)
  const sp = bedSpec(kind);
  if (!mobile) registerBed(p, kind);
  const W = sp.W;
  const L = sp.L;
  const frame = M.paint('#e9ecee', 0.35);
  const accent = M.plastic('#5d8fb1', 0.38);
  // base + column lift
  if (stretcher) {
    rboxB(g, 0.58, 0.1, 1.5, 0.03, frame, 0, 0.1, 0);
    cylB(g, 0.08, 0.3, M.chrome(), 0, 0.2, -0.35, 20);
    cylB(g, 0.08, 0.3, M.chrome(), 0, 0.2, 0.35, 20);
    rboxB(g, 0.5, 0.06, 1.4, 0.025, M.plastic('#d9dee1'), 0, 0.12, 0);
    casters(g, [-0.24, 0.24], [-0.66, 0.66], 0.06);
  } else {
    rboxB(g, W - 0.1, 0.14, L - 0.25, 0.04, frame, 0, 0.18, 0);
    rboxB(g, W - 0.3, 0.07, L - 0.5, 0.03, M.plastic('#c9d0d4'), 0, 0.1, 0);
    casters(g, [-W / 2 + 0.12, W / 2 - 0.12], [-L / 2 + 0.18, L / 2 - 0.18], 0.06);
  }
  // deck + vinyl mattress, made up (bedding.ts): fitted sheet tucked under, pillow with a head dent, folded blanket at the foot.
  // The backrest hinges under the patient's hips (bedRig.ts): deck, mattress, sheet and pillow bend with it
  const rig = hingedBed(g, p, kind, { deck: M.alu(), mattress: M.vinyl('#3f6f8f') });
  makeUpBed(g, kind, mobile ? undefined : p.id);
  // split side rails (head section raised), plastic panels on steel posts
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.025);
    caster(rboxB(g, 0.03, 0.24, 0.9, 0.012, accent, x, 0.66, -0.42));
    for (const z of [-0.8, -0.04]) boxB(g, 0.025, 0.22, 0.03, M.alu(), x, 0.47, z);
    if (!stretcher) {
      const rail = rboxB(g, 0.03, 0.2, 0.62, 0.012, accent, x, 0.66, 0.52);
      if (s > 0) rig.entryRail = { mesh: noMerge(rail), raisedY: rail.position.y };
    }
  }
  if (!stretcher) {
    // head + foot boards (moulded plastic with a hand-hold)
    rboxB(g, W, 0.58, 0.06, 0.03, M.plastic('#dfe5e8'), 0, 0.44, -L / 2 - 0.02);
    rboxB(g, W, 0.36, 0.06, 0.03, M.plastic('#dfe5e8'), 0, 0.44, L / 2 + 0.02);
    rboxB(g, W * 0.5, 0.04, 0.065, 0.02, accent, 0, 0.7, L / 2 + 0.02);
  } else {
    // push handle at the foot end (clear of the mattress and a hanging blanket), O2 cylinder under the
    // deck, IV pole in its socket at the head corner (outside the mattress)
    tube(g, [[-W / 2 + 0.06, 0.5, L / 2 + 0.012], [-W / 2 + 0.06, 0.92, L / 2 + 0.022], [W / 2 - 0.06, 0.92, L / 2 + 0.022], [W / 2 - 0.06, 0.5, L / 2 + 0.012]], 0.016, M.chrome(), 24, 8);
    cylB(g, 0.012, 1.25, M.chrome(), W / 2 + 0.022, 0.5, -L / 2 + 0.035, 8);
    add(g, G.cyl(0.05, 0.05, 0.55, 14), lambert('#3f8f4a', { roughness: 0.35, metalness: 0.4 }), -0.19, 0.33, 0.62, Math.PI / 2, 0, 0);
  }
  return rig;
}

/** The wheeled EMS trolley uses the same deck, pillow, rails and foot-end push bar as the ED stretchers. */
export function transportStretcher(id: string) {
  const group = new THREE.Group();
  group.name = 'transport-stretcher';
  const rig = bed({ id, kind: 'stretcher', room: 'ems', x: 0, z: 0 }, { group, screens: [], lightBar: [] }, true, true);
  rig.mobile = true;
  const grips = new THREE.Group();
  grips.rotation.y = Math.PI;
  group.add(grips);
  return { group, rig, grips };
}

function waitingChair(g: THREE.Group, seat: string) {
  // steel sled frame, upholstered seat and back
  const s = M.fabric(seat);
  caster(rboxB(g, 0.5, 0.08, 0.48, 0.035, s, 0, 0.4, 0.02));
  caster(rboxB(g, 0.5, 0.46, 0.07, 0.035, s, 0, 0.5, -0.22));
  const fr = M.chrome();
  // the sled's runners rest ON the floor (on small glides): with the tube's centre 1 cm up, most of it
  // was below the floor line and the frame looked sunk into it
  const glide = M.black();
  for (const x of [-0.25, 0.25]) {
    tube(g, [[x, 0.02, 0.24], [x, 0.02, -0.22], [x, 0.4, -0.2], [x, 0.94, -0.25]], 0.012, fr, 16, 6);
    tube(g, [[x, 0.4, 0.22], [x, 0.62, 0.18], [x, 0.62, -0.18]], 0.012, fr, 12, 6);
    for (const z of [0.2, -0.18]) rboxB(g, 0.032, 0.009, 0.06, 0.003, glide, x, 0, z);
  }
}

function officeChair(g: THREE.Group) {
  const mesh = M.fabric('#3c4247');
  caster(rboxB(g, 0.5, 0.08, 0.48, 0.035, mesh, 0, 0.44, 0.02));
  caster(rboxB(g, 0.46, 0.5, 0.06, 0.04, mesh, 0, 0.58, -0.24));
  cylB(g, 0.025, 0.36, M.chrome(), 0, 0.1, 0, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(g, G.rbox(0.3, 0.03, 0.04, 0.012), M.black(), Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15, 0, -a, 0);
    add(g, G.sphere(0.03, 8, 6), M.black(), Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29);
  }
}

// ───────────────────────────── east wing: canvas signage helpers ─────────────────────────────

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const canvasMats = new Map<string, THREE.MeshStandardMaterial>();

/** Material with a canvas drawn once per key (inspectable props are built twice); leaves the cache when disposed. */
function canvasMat(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, o: { emissive?: number; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const hit = canvasMats.get(key);
  if (hit) return hit;
  const { canvas, ctx } = makeCanvas(w, h);
  draw(ctx, w, h);
  const map = canvasTexture(canvas);
  const m = own(new THREE.MeshStandardMaterial({ map, roughness: o.roughness ?? 0.5 }));
  if (o.emissive) {
    m.emissive.set('#ffffff');
    m.emissiveMap = map;
    m.emissiveIntensity = o.emissive;
  }
  canvasMats.set(key, m);
  m.addEventListener('dispose', () => canvasMats.delete(key));
  return m;
}

/** fillText shrunk until it fits maxW */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, align: CanvasTextAlign = 'left') {
  let s = Math.round(size);
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 8) ctx.font = `${weight} ${--s}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** solid wayfinding arrow centered at (cx, cy) */
function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, dir: 'l' | 'r' | 'u' | 'd') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate({ r: 0, d: Math.PI / 2, l: Math.PI, u: -Math.PI / 2 }[dir]);
  ctx.beginPath();
  for (const [x, y] of [[0.5, 0], [0, -0.45], [0, -0.16], [-0.5, -0.16], [-0.5, 0.16], [0, 0.16], [0, 0.45]]) ctx.lineTo(x * s, y * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** International Symbol of Access (seated wheelchair user), s = overall height */
function drawISA(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx - s * 0.04, cy);
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(-s * 0.08, -s * 0.39, s * 0.085, 0, Math.PI * 2);
  ctx.fill();
  const path = (pts: number[][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.stroke();
  };
  path([[-0.1, -0.24], [-0.12, 0.04], [0.14, 0.04], [0.24, 0.3], [0.33, 0.3]]); // back, seat, shin, foot
  path([[-0.11, -0.13], [0.08, -0.13]]); // arm
  ctx.beginPath();
  ctx.arc(-s * 0.08, s * 0.16, s * 0.24, -Math.PI * 0.12, Math.PI * 1.22); // wheel
  ctx.stroke();
  ctx.restore();
}

/** toilet in profile — neutral restroom pictogram */
function drawWC(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillRect(-0.3, -0.45, 0.16, 0.4); // tank
  ctx.fillRect(-0.3, -0.06, 0.6, 0.07); // seat
  ctx.beginPath();
  ctx.moveTo(-0.26, 0.03);
  ctx.lineTo(0.3, 0.03);
  ctx.quadraticCurveTo(0.28, 0.26, 0.06, 0.3);
  ctx.lineTo(0.1, 0.45);
  ctx.lineTo(-0.2, 0.45);
  ctx.lineTo(-0.18, 0.28);
  ctx.quadraticCurveTo(-0.26, 0.2, -0.26, 0.03);
  ctx.fill();
  ctx.restore();
}

/** a baby lying on a changing table */
function drawBaby(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillRect(-0.45, 0.14, 0.9, 0.09);
  ctx.fillRect(-0.4, 0.23, 0.08, 0.22);
  ctx.beginPath();
  ctx.arc(-0.28, -0.03, 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.08, 0.02, 0.25, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const ARROWS: Record<string, 'l' | 'r' | 'u' | 'd'> = { '←': 'l', '→': 'r', '↑': 'u', '↓': 'd' };

/**
 * Sign panel rows. A leading arrow is drawn solid on the side it points to; '@wc' '@isa' '@baby'
 * rows are pictograms (double height); a leading '<' left-aligns a row.
 */
function drawRows(ctx: CanvasRenderingContext2D, w: number, h: number, rows: string[], bg: string, fg: string, o: { rules?: boolean; title?: boolean } = {}) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const weights = rows.map((r) => (r.startsWith('@') ? 2 : 1));
  const unit = h / weights.reduce((a, b) => a + b, 0);
  const pad = Math.min(w, h) * 0.07;
  const arrowed = rows.some((r) => ARROWS[r[0]]);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  let y = 0;
  rows.forEach((row, i) => {
    const rh = unit * weights[i];
    const cy = y + rh / 2;
    const s = Math.min(rh * 0.6, w * 0.16);
    const big = o.title && i === 0;
    if (row === '@wc') drawWC(ctx, w / 2, cy, rh * 0.8);
    else if (row === '@isa') drawISA(ctx, w / 2, cy, rh * 0.8);
    else if (row === '@baby') drawBaby(ctx, w / 2, cy, rh * 0.8);
    else {
      const dir = ARROWS[row[0]];
      const left = row.startsWith('<');
      const text = dir || left ? row.slice(1).trim() : row;
      const size = rh * (big ? 0.62 : 0.5);
      const weight = big ? 800 : 600;
      if (dir === 'r') {
        drawArrow(ctx, w - pad - s / 2, cy, s, dir);
        fitText(ctx, text, w - pad * 2 - s, cy, w - pad * 3 - s, size, weight, 'right');
      } else if (dir || arrowed) {
        if (dir) drawArrow(ctx, pad + s / 2, cy, s, dir);
        fitText(ctx, text, pad * 2 + s, cy, w - pad * 3 - s, size, weight);
      } else if (left) fitText(ctx, text, pad, cy, w - pad * 2, size, weight);
      else fitText(ctx, text, w / 2, cy, w - pad * 2, size, weight, 'center');
    }
    if (o.rules && i > 0) {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(pad, y - 1, w - pad * 2, 2);
      ctx.globalAlpha = 1;
    }
    y += rh;
  });
}

// ───────────────────────────── east wing: signs + exterior ─────────────────────────────
// Wall-mounted props have their origin on the wall face (local z = 0) with the bottom at p.y.

/** double-sided ceiling-hung blade sign; label "front rows||back rows" (rows split by '|') */
function hangingSign(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 1.5;
  const H = p.h ?? 0.42;
  const [front = '', back] = (p.label ?? '').split('||');
  const face = (text: string) => canvasMat(`hang|${W}|${H}|${text}`, 1024, Math.round((1024 * H) / W), (ctx, w, h) => drawRows(ctx, w, h, text.split('|'), '#0f4c5c', '#ffffff', { rules: true }), { roughness: 0.35 });
  rboxB(g, W + 0.04, H + 0.04, 0.03, 0.01, M.alu(), 0, -0.02, 0);
  add(g, G.plane(W, H), face(front), 0, H / 2, 0.02);
  add(g, G.plane(W, H), face(back ?? front), 0, H / 2, -0.02, 0, Math.PI, 0);
  // drop rods up to the ceiling grid (3 m)
  const rod = Math.max(0.05, 3.0 - (p.y ?? 2.3) - H - 0.02);
  for (const s of [-1, 1]) {
    cylB(g, 0.006, rod, M.chrome(), s * (W / 2 - 0.18), H + 0.02, 0, 8);
    cylB(g, 0.028, 0.012, M.chrome(), s * (W / 2 - 0.18), H + 0.008 + rod, 0, 14);
  }
}

/** printed wall plaque with rows of text / pictograms */
function wallSign(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.4;
  const H = p.h ?? 0.4;
  const bg = p.color ?? '#0f4c5c';
  const px = W > 0.8 ? 1024 : 512;
  const mat = canvasMat(`wall|${W}|${H}|${bg}|${p.label}`, px, Math.round((px * H) / W), (ctx, w, h) => drawRows(ctx, w, h, (p.label ?? '').split('|'), bg, '#ffffff', { title: true }), { roughness: 0.4 });
  rboxB(g, W + 0.02, H + 0.02, 0.012, 0.004, lightPaint(), 0, -0.01, 0.006);
  add(g, G.plane(W, H), mat, 0, H / 2, 0.016);
}

/** paper poster: label "TITLE|line|line…" under an accent band */
function poster(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.42;
  const H = p.h ?? 0.56;
  const accent = p.color ?? '#1f6f8b';
  const [title = '', ...lines] = (p.label ?? '').split('|');
  const mat = canvasMat(`poster|${W}|${H}|${accent}|${p.label}`, 384, Math.round((384 * H) / W), (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.19);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, title, w * 0.06, h * 0.095, w * 0.88, h * 0.075, 800);
    ctx.fillStyle = '#26323a';
    lines.forEach((l, i) => fitText(ctx, l, w * 0.06, h * 0.28 + i * h * 0.1, w * 0.88, h * 0.052, 600));
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.06, h * 0.92, w * 0.3, h * 0.012);
  }, { roughness: 0.6 });
  rboxB(g, W + 0.03, H + 0.03, 0.01, 0.003, M.alu(), 0, -0.015, 0.005);
  add(g, G.plane(W, H), mat, 0, H / 2, 0.014);
}

/** illuminated sign: glowing letters on a dark plate */
function litSign(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 3;
  const H = p.h ?? 0.45;
  const c = p.color ?? '#ffffff';
  const mat = canvasMat(`lit|${W}|${H}|${c}|${p.label}`, 1024, Math.round((1024 * H) / W), (ctx, w, h) => {
    ctx.fillStyle = '#101316';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = h * 0.1;
    fitText(ctx, p.label ?? '', w / 2, h * 0.53, w * 0.92, h * 0.72, 700, 'center');
  }, { emissive: 1.8, roughness: 0.4 });
  rboxB(g, W + 0.06, H + 0.06, 0.05, 0.01, M.black(), 0, -0.03, -0.02);
  add(g, G.plane(W, H), mat, 0, H / 2, 0.012);
}

/** entrance canopy cantilevered from the façade (origin on the façade face): slab, fascia, posts, downlights */
function canopy(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 6;
  const D = p.d ?? 2.8;
  const conc = pbr('concrete', { color: '#dfe2e3', tile: 2 });
  caster(rboxB(g, W, 0.24, D - 0.12, 0.02, conc, 0, 2.86, (D - 0.12) / 2));
  rboxB(g, W + 0.1, 0.6, 0.12, 0.015, M.dark(), 0, 2.7, D - 0.06);
  for (const s of [-1, 1]) {
    cylB(g, 0.07, 2.86, pbr('steel', { tile: 1, color: '#c8ccce' }), s * (W / 2 - 0.35), 0, D - 0.4, 20);
    cylB(g, 0.11, 0.04, M.dark(), s * (W / 2 - 0.35), 0, D - 0.4, 20);
  }
  for (const x of [-W / 4, 0, W / 4]) add(g, G.circle(0.1, 20), emitter('#fff1d6', 3), x, 2.855, D / 2, Math.PI / 2, 0, 0);
}

/** painted parking bays: lines every 3 m across w; label 'accessible' = blue bay with the access symbol + sign post */
function parking(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 12;
  if (p.label === 'accessible') {
    const bay = canvasMat('bay|isa', 256, 384, (ctx, w, h) => {
      ctx.fillStyle = '#1f5fa8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4f0';
      ctx.strokeStyle = '#f4f4f0';
      drawISA(ctx, w / 2, h * 0.62, w * 0.62);
    }, { roughness: 0.85 });
    add(g, G.plane(W - 0.14, 4.4), bay, 0, 0.002, 0, -Math.PI / 2, 0, 0);
    // "reserved" sign post at the head of the bay
    cylB(g, 0.03, 2.1, M.paint('#9aa2a8', 0.5), 0, 0, -2.45, 10);
    const plate = canvasMat('bay|sign', 128, 192, (ctx, w, h) => drawRows(ctx, w, h, ['@isa', 'RESERVED'], '#1f5fa8', '#ffffff'), { roughness: 0.4 });
    add(g, G.plane(0.3, 0.45), plate, 0, 1.85, -2.41);
    rboxB(g, 0.32, 0.47, 0.012, 0.004, lightPaint(), 0, 1.615, -2.425);
    return;
  }
  const line = lambert('#e7e3d4', { roughness: 0.8 });
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += 3) add(g, G.box(0.1, 0.01, 4.6), line, x, 0.004, 0);
}

/** corridor handrail on steel brackets at 0.9 m (as the builder puts on corridor walls); origin on the wall face, length w */
function handrail(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 2;
  rboxB(g, W, 0.05, 0.07, 0.02, pbr('wood', { color: '#d9b98f', tile: 0.8, roughness: 0.55 }), 0, 0.875, 0.075);
  const nb = Math.max(2, Math.round(W / 1.2));
  for (let i = 0; i < nb; i++) boxB(g, 0.03, 0.08, 0.07, pbr('steel', { tile: 0.3 }), -W / 2 + 0.2 + ((W - 0.4) * i) / (nb - 1), 0.81, 0.035);
}

// ───────────────────────────── east wing: stairs + elevators ─────────────────────────────

/** satin stainless (elevator doors, grab bars, servery): light and only partly metallic so it reads under point lights */
const brushed = () => lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 });
/** shared east-wing whites/greys (each distinct material is one more draw call once the statics are merged) */
const whitePlastic = () => M.plastic('#eef0f1', 0.3);
const lightPaint = () => M.paint('#e2e6e8', 0.4);

/** bed elevator landing door (1.3 × 2.2 m clear): stainless frame + centre-opening leaves, floor indicator */
function elevatorDoor(p: PropDef, g: THREE.Group) {
  const car = p.label ?? 'A';
  const ss = brushed();
  const OW = 1.3;
  const OH = 2.2;
  for (const s of [-1, 1]) rboxB(g, 0.1, OH + 0.1, 0.05, 0.01, ss, s * (OW / 2 + 0.05), 0, 0.025);
  rboxB(g, OW + 0.2, 0.1, 0.05, 0.01, ss, 0, OH, 0.025);
  for (const s of [-1, 1]) caster(rboxB(g, OW / 2 - 0.006, OH - 0.01, 0.03, 0.006, ss, s * (OW / 4 + 0.003), 0.005, 0.016));
  add(g, G.box(OW + 0.1, 0.008, 0.1), M.alu(), 0, 0.004, 0.05);
  // hall indicator: car letter + status in amber
  const ind = canvasMat(`elev|${car}`, 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#07090b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffb02e';
    fitText(ctx, car, w * 0.1, h * 0.52, w * 0.14, h * 0.72, 800, 'center');
    fitText(ctx, 'OUT OF SERVICE', w * 0.59, h * 0.54, w * 0.74, h * 0.4, 700, 'center');
  }, { emissive: 1.3, roughness: 0.3 });
  rboxB(g, 0.56, 0.16, 0.04, 0.01, M.black(), 0, OH + 0.16, 0.02);
  add(g, G.plane(0.5, 0.125), ind, 0, OH + 0.24, 0.042);
  if (car !== 'A') return;
  // paper notice taped to car A's left leaf
  const note = canvasMat('elev|note', 256, 360, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b3261e';
    fitText(ctx, 'OUT OF SERVICE', w / 2, h * 0.11, w * 0.88, h * 0.085, 800, 'center');
    ctx.fillStyle = '#222';
    ['Elevators A + B are', 'closed tonight.', '', 'Levels 2–4 (inpatient', 'wards): not in this build.', '', '← Stair 1 is by the', 'corridor entrance.'].forEach((l, i) => fitText(ctx, l, w / 2, h * (0.27 + i * 0.085), w * 0.88, h * 0.058, 600, 'center'));
  }, { roughness: 0.85 });
  add(g, G.plane(0.21, 0.297), note, -OW / 4, 1.42, 0.035);
}

/** hall call station: one ▲ button (lowest floor) and the firefighters' recall key switch */
function callPanel(g: THREE.Group) {
  const face = canvasMat('elev|call', 128, 336, (ctx, w, h) => {
    ctx.fillStyle = '#c3c8cb';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b8231f';
    fitText(ctx, 'FIRE', w / 2, h * 0.07, w * 0.8, h * 0.05, 800, 'center');
    ctx.fillStyle = '#2b3034';
    fitText(ctx, 'CALL', w / 2, h * 0.5, w * 0.8, h * 0.045, 700, 'center');
    for (let i = 0; i < 6; i++) ctx.fillRect(w * (0.38 + (i % 2) * 0.16), h * (0.79 + Math.floor(i / 2) * 0.04), 5, 5); // braille dots
  }, { roughness: 0.45 });
  rboxB(g, 0.13, 0.34, 0.012, 0.004, brushed(), 0, 0, 0.006);
  // printed face 3 mm proud of the 12 mm plate (1.5 mm flickered from across the lobby)
  add(g, G.plane(0.12, 0.315), face, 0, 0.17, 0.015);
  add(g, G.cyl(0.026, 0.026, 0.012, 24), M.chrome(), 0, 0.12, 0.019, Math.PI / 2, 0, 0);
  add(g, G.circle(0.013, 3), M.dark(), 0, 0.122, 0.027, 0, 0, Math.PI / 2);
  add(g, G.torus(0.03, 0.003, 6, 24), lambert('#4a4f54', { emissive: '#ff9a2e', emissiveIntensity: 0.12 }), 0, 0.12, 0.016);
  add(g, G.cyl(0.015, 0.015, 0.012, 16), lambert('#b8231f', { roughness: 0.35, metalness: 0.3 }), 0, 0.27, 0.019, Math.PI / 2, 0, 0);
  add(g, G.box(0.004, 0.016, 0.004), M.dark(), 0, 0.27, 0.026);
}

/** closed fire door (self-closing, panic bar, wired-glass vision panel); label "title|subtitle" on the leaf */
function fireDoor(p: PropDef, g: THREE.Group) {
  const DW = 0.92;
  const DH = 2.1;
  const frame = M.paint('#6d7479', 0.4);
  const ss = brushed();
  for (const s of [-1, 1]) rboxB(g, 0.06, DH + 0.06, 0.1, 0.01, frame, s * (DW / 2 + 0.03), 0, 0.05);
  rboxB(g, DW + 0.12, 0.06, 0.1, 0.01, frame, 0, DH, 0.05);
  caster(rboxB(g, DW - 0.01, DH - 0.01, 0.045, 0.006, lambert('#9c2f2a', { roughness: 0.42, metalness: 0.2 }), 0, 0.005, 0.03));
  rboxB(g, 0.14, 0.62, 0.05, 0.004, lambert('#1d2328', { roughness: 0.08, metalness: 0.4 }), 0.24, 1.25, 0.03);
  rboxB(g, 0.72, 0.05, 0.05, 0.02, ss, 0, 0.95, 0.085);
  for (const s of [-1, 1]) rboxB(g, 0.06, 0.09, 0.04, 0.01, ss, s * 0.34, 0.93, 0.07);
  rboxB(g, 0.3, 0.06, 0.06, 0.01, M.paint('#b9bfc4', 0.4), -0.2, DH - 0.13, 0.085);
  tube(g, [[-0.06, DH - 0.1, 0.115], [0.12, DH - 0.06, 0.115], [0.3, DH + 0.02, 0.105]], 0.008, M.paint('#b9bfc4', 0.4), 8, 6);
  const [title = '', sub = ''] = (p.label ?? '').split('|');
  const sign = canvasMat(`fire|${p.label}`, 384, 256, (ctx, w, h) => drawRows(ctx, w, h, [title, sub, 'FIRE DOOR — KEEP CLOSED'], '#f4f1ea', '#1f2328', { title: true }), { roughness: 0.5 });
  add(g, G.plane(0.42, 0.28), sign, -0.1, 1.55, 0.056);
}

/** public-access AED in a glazed wall cabinet */
function aedCabinet(g: THREE.Group) {
  const white = whitePlastic();
  rboxB(g, 0.42, 0.52, 0.02, 0.006, white, 0, 0, 0.01);
  for (const s of [-1, 1]) rboxB(g, 0.02, 0.52, 0.16, 0.006, white, s * 0.2, 0, 0.08);
  for (const y of [0, 0.5]) rboxB(g, 0.42, 0.02, 0.16, 0.006, white, 0, y, 0.08);
  caster(rboxB(g, 0.28, 0.3, 0.09, 0.03, M.plastic('#2f9e44', 0.4), 0, 0.08, 0.066));
  rboxB(g, 0.12, 0.03, 0.03, 0.012, M.plastic('#26823a', 0.4), 0, 0.38, 0.066);
  // glass door 2 mm clear of the side, top and bottom panels (its edges lay in their inner faces)
  noMerge(add(g, G.box(0.376, 0.476, 0.006), glass('#e9f7ff', 0.25), 0, 0.26, 0.155));
  const label = canvasMat('aed|label', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'AED ♥', w / 2, h * 0.55, w * 0.9, h * 0.7, 800, 'center');
  }, { roughness: 0.4 });
  rboxB(g, 0.4, 0.11, 0.01, 0.003, white, 0, 0.545, 0.005);
  add(g, G.plane(0.38, 0.09), label, 0, 0.6, 0.013);
}

// ───────────────────────────── east wing: cafeteria ─────────────────────────────

const walnut = () => pbr('wood', { color: '#8a6446', tile: 1.0, roughness: 0.6 });
const frameBlack = () => M.paint('#2f3438', 0.45);

/** café table: laminate top on a pedestal (or four legs when long / low, e.g. a waiting-room coffee table) */
function cafeTable(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.8;
  const D = p.d ?? 0.8;
  const H = p.h ?? 0.75;
  caster(rboxB(g, W, 0.03, D, 0.01, pbr('wood', { color: '#e2cdb0', tile: 1.2, roughness: 0.55 }), 0, H - 0.03, 0));
  const metal = frameBlack();
  if (Math.max(W, D) > 1.0 || H < 0.6) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylB(g, 0.018, H - 0.03, metal, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06), 10);
  } else {
    cylB(g, 0.035, H - 0.08, metal, 0, 0.02, 0, 14);
    cylB(g, 0.24, 0.022, metal, 0, 0, 0, 28, 0.25);
    cylB(g, 0.13, 0.03, metal, 0, H - 0.06, 0, 20);
  }
}

/** café chair: bent-plywood seat and back on a black steel frame (seat 0.46 m) */
function cafeChair(p: PropDef, g: THREE.Group) {
  const wood = pbr('wood', { color: p.color ?? '#c99a68', tile: 0.8, roughness: 0.6 });
  const frame = frameBlack();
  caster(rboxB(g, 0.44, 0.03, 0.42, 0.012, wood, 0, 0.43, 0.02));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylB(g, 0.011, 0.43, frame, sx * 0.19, 0, 0.02 + sz * 0.17, 8);
  for (const sx of [-1, 1]) tube(g, [[sx * 0.19, 0.43, -0.15], [sx * 0.19, 0.66, -0.19], [sx * 0.185, 0.86, -0.22]], 0.011, frame, 8, 6);
  const back = caster(rboxB(g, 0.42, 0.17, 0.022, 0.01, wood, 0, 0.67, -0.205));
  back.rotation.x = -0.14;
}

/** hot/cold serving counter: walnut front, tray slide, refrigerated display with a sneeze guard over the west part */
function servingCounter(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 4;
  const D = p.d ?? 0.8;
  const H = p.h ?? 0.92;
  const ss = brushed();
  rboxB(g, W, H - 0.14, D - 0.04, 0.01, walnut(), 0, 0.1, 0);
  boxB(g, W - 0.04, 0.1, D - 0.12, M.rubber(), 0, 0, -0.02);
  rboxB(g, W + 0.04, 0.04, D + 0.02, 0.01, M.solidSurface('#e8e4dc'), 0, H - 0.04, 0);
  for (let i = 0; i < 3; i++) add(g, G.cyl(0.012, 0.012, W - 0.1, 10), ss, 0, H - 0.07, D / 2 + 0.09 + i * 0.07, 0, 0, Math.PI / 2);
  for (let x = -W / 2 + 0.3; x <= W / 2 - 0.29; x += 1.0) boxB(g, 0.03, 0.03, 0.26, ss, x, H - 0.1, D / 2 + 0.13);
  // display: stainless cold well, tilted sneeze guard, glass shelf with an LED strip under its front edge
  const L = W - 1.7;
  const cx = -W / 2 + 0.2 + L / 2;
  rboxB(g, L, 0.03, D - 0.1, 0.005, ss, cx, H, -0.02);
  for (const s of [-1, 1]) boxB(g, 0.02, 0.47, D - 0.14, ss, cx + s * (L / 2 + 0.01), H, -0.02);
  // guard and shelf glass stop 2 mm short of the end panels (their ends lay in the panels' faces);
  // the LED strip hangs 3 mm under the shelf
  noMerge(add(g, G.box(L - 0.004, 0.42, 0.008), glass('#e6f3f6', 0.2), cx, H + 0.25, D / 2 - 0.12, -0.2, 0, 0));
  noMerge(add(g, G.box(L - 0.004, 0.008, 0.34), glass('#e6f3f6', 0.28), cx, H + 0.45, -0.1));
  add(g, G.box(L - 0.04, 0.008, 0.025), emitter('#fff3e2', 1.4), cx, H + 0.439, 0.05);
  // food: sandwich packs, salad bowls and fruit cups in the well; wraps and cakes on the shelf
  const bread = lambert('#d9b98a', { roughness: 0.7 });
  const lid = glass('#f4fbff', 0.45);
  // few distinct colours: every material is one more draw call in the merged static mesh
  const cups = ['#e94f37', '#f6c445'].map((c) => lambert(c, { roughness: 0.5 }));
  let k = 0;
  for (let x = cx - L / 2 + 0.12; x < cx + L / 2 - 0.08; x += 0.15, k++) {
    const kind = k % 3;
    if (kind === 0) {
      for (const dz of [-0.2, 0.0]) rboxB(g, 0.12, 0.085, 0.07, 0.01, bread, x, H + 0.03, dz);
    } else if (kind === 1) {
      for (const dz of [-0.2, 0.0]) {
        cylB(g, 0.065, 0.06, lambert('#5c9a3c', { roughness: 0.8 }), x, H + 0.03, dz, 16, 0.055);
        // the lid fits 3 mm down over the rim (bottom flush with the bowl's top, they flickered)
        cylB(g, 0.068, 0.012, lid, x, H + 0.087, dz, 16);
      }
    } else for (const dz of [-0.22, -0.1, 0.02]) cylB(g, 0.036, 0.085, cups[(k + Math.round(dz * 10)) & 1], x, H + 0.03, dz, 12, 0.031);
    if (k % 2 === 0) add(g, G.cyl(0.03, 0.03, 0.2, 12), lambert('#e8d4a8', { roughness: 0.8 }), x + 0.05, H + 0.48, -0.12, 0, 0, Math.PI / 2);
    else rboxB(g, 0.11, 0.07, 0.11, 0.01, lambert('#7b4a2e', { roughness: 0.7 }), x, H + 0.456, -0.12); // 2 mm above the glass shelf's top
  }
}

/** cashier till on the counter: cash drawer, tilted touchscreen for the cashier, customer display, card reader */
function till(g: THREE.Group) {
  rboxB(g, 0.42, 0.1, 0.4, 0.01, M.dark(), 0, 0, -0.02);
  cylB(g, 0.025, 0.14, M.dark(), 0, 0.1, -0.08, 12);
  const pos = canvasMat('till|pos', 256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#0d1b24';
    ctx.fillRect(0, 0, w, h);
    const tiles = ['#2e86ab', '#3fa34d', '#e0a10b', '#8e5ec4', '#c0392b', '#2a8f86'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = tiles[i % tiles.length];
      ctx.fillRect(10 + (i % 3) * 52, 34 + Math.floor(i / 3) * 50, 46, 42);
    }
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'ORDER', 10, 16, 120, 16, 700);
    fitText(ctx, '$ 6.40', w - 10, 60, 80, 22, 800, 'right');
    ctx.fillStyle = '#3fa34d';
    ctx.fillRect(176, 140, 70, 40);
  }, { emissive: 0.9, roughness: 0.3 });
  const head = new THREE.Group();
  head.position.set(0, 0.32, -0.08);
  head.rotation.set(0.3, Math.PI, 0);
  g.add(head);
  rboxB(head, 0.32, 0.24, 0.03, 0.01, M.black(), 0, -0.12, -0.016);
  add(head, G.plane(0.29, 0.21), pos, 0, 0, 0.0015);
  const cust = canvasMat('till|cust', 128, 48, (ctx, w, h) => {
    ctx.fillStyle = '#06110b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7dff9c';
    fitText(ctx, 'TOTAL  $6.40', w / 2, h / 2, w * 0.9, h * 0.5, 700, 'center');
  }, { emissive: 1.1, roughness: 0.3 });
  add(head, G.plane(0.14, 0.05), cust, 0, 0.06, -0.034, 0, Math.PI, 0);
  // (the customer's card terminal on its stand at the counter's edge, and the cashier's handheld in its
  // dock, are payment.ts's: their screens change as you pay)
  rboxB(g, 0.14, 0.12, 0.18, 0.02, M.plastic('#2a2e31', 0.4), -0.3, 0, -0.05);
}

/** self-serve coffee: bean-to-cup machine, two pump airpots, cup towers, lids and a condiment caddy */
function coffeeStation(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 1.6;
  const D = p.d ?? 0.7;
  const ss = brushed();
  rboxB(g, W, 0.86, D - 0.04, 0.012, walnut(), 0, 0.04, 0);
  rboxB(g, W + 0.02, 0.04, D, 0.008, M.solidSurface('#2b2f33'), 0, 0.9, 0);
  const mx = -W / 2 + 0.3;
  caster(rboxB(g, 0.42, 0.62, 0.48, 0.04, M.black(), mx, 0.94, -0.07));
  rboxB(g, 0.34, 0.025, 0.12, 0.006, ss, mx, 0.94, 0.2);
  // the spout head stands out over the drip tray, its outlet over the middle of a cup on it (amenities.ts)
  boxB(g, 0.09, 0.07, 0.09, ss, mx, 1.2, 0.215);
  const ui = canvasMat('coffee|ui', 192, 128, (ctx, w, h) => {
    ctx.fillStyle = '#10161a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8d2a8';
    ['Coffee', 'Latte', 'Hot water'].forEach((t, i) => fitText(ctx, t, w / 2, h * (0.25 + i * 0.25), w * 0.8, h * 0.17, 600, 'center'));
  }, { emissive: 0.8, roughness: 0.3 });
  add(g, G.plane(0.18, 0.12), ui, mx, 1.4, 0.172);
  // two pump airpots, right of where the cups and lids stand by the machine (amenities.ts: a stack of
  // paper cups and a stack of lids, taken from by hand)
  for (const [i, c] of [[0, '#2b2f33'], [1, '#7a2e2a']] as [number, string][]) {
    const x = mx + 0.6 + i * 0.2;
    caster(cylB(g, 0.08, 0.34, i ? lambert(c, { roughness: 0.3, metalness: 0.5 }) : brushed(), x, 0.94, -0.1, 20));
    cylB(g, 0.05, 0.06, M.black(), x, 1.28, -0.1, 16);
    boxB(g, 0.03, 0.03, 0.09, M.black(), x, 1.24, -0.03);
  }
  rboxB(g, 0.24, 0.1, 0.16, 0.01, M.dark(), W / 2 - 0.2, 0.94, -0.12);
  for (const dx of [-0.06, 0.06]) cylB(g, 0.032, 0.11, ss, W / 2 - 0.2 + dx, 1.04, -0.12, 14);
  const sign = canvasMat('coffee|sign', 512, 96, (ctx, w, h) => drawRows(ctx, w, h, ['SELF-SERVE COFFEE · TEA'], '#2b2f33', '#e8d2a8'), { roughness: 0.4 });
  add(g, G.plane(0.9, 0.17), sign, 0.15, 1.72, -D / 2 + 0.004);
}

/** glass-door merchandiser: lit header, wire shelves of bottles and cans, LED side strips */
function drinksFridge(g: THREE.Group) {
  const W = 0.75;
  const H = 2.0;
  const D = 0.72;
  const body = lambert('#1d2125', { roughness: 0.35, metalness: 0.3 });
  // lit back wall: 3 mm in from the cabinet's back and its ends inside the side walls (it shared
  // the back plane and the outer side faces with the cabinet, and flickered)
  rboxB(g, W - 0.006, H - 0.32, 0.04, 0.01, lightPaint(), 0, 0.1, -D / 2 + 0.023);
  for (const s of [-1, 1]) caster(rboxB(g, 0.04, H, D, 0.01, body, s * (W / 2 - 0.02), 0, 0));
  rboxB(g, W, 0.24, D, 0.01, body, 0, H - 0.24, 0);
  rboxB(g, W, 0.1, D, 0.01, body, 0, 0, 0);
  const head = canvasMat('fridge|head', 256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#0d5f8a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'COLD DRINKS', w / 2, h * 0.54, w * 0.86, h * 0.56, 800, 'center');
  }, { emissive: 1.2, roughness: 0.4 });
  add(g, G.plane(W - 0.1, 0.17), head, 0, H - 0.12, D / 2 + 0.003);
  const wire = M.chrome();
  const colors = ['#f39c34', '#d6342c', '#3fa34d'];
  for (let r = 0; r < 5; r++) {
    const y = 0.12 + r * 0.33;
    if (r) boxB(g, W - 0.09, 0.012, D - 0.12, wire, 0, y - 0.012, -0.02);
    for (let c = 0; c < 5; c++) {
      const x = -W / 2 + 0.1 + c * 0.135;
      const mat = r === 0 ? glass('#dff1fb', 0.55) : lambert(colors[(r + c) % colors.length], { roughness: 0.3 });
      if (r === 4) cylB(g, 0.033, 0.12, M.chrome(), x, y, 0.08, 12);
      else for (const z of [0.1, -0.06]) cylB(g, 0.03, 0.2, mat, x, y, z, 12, 0.032);
    }
  }
  for (const s of [-1, 1]) add(g, G.box(0.012, H - 0.44, 0.012), emitter('#eef7ff', 1.6), s * (W / 2 - 0.05), 0.1 + (H - 0.44) / 2, D / 2 - 0.07);
  // door glass starts 2 mm above the plinth (its bottom edge lay in the plinth's top)
  noMerge(add(g, G.box(W - 0.06, H - 0.362, 0.01), glass('#e6f3f8', 0.16), 0, 0.102 + (H - 0.362) / 2, D / 2 - 0.006));
  boxB(g, 0.025, 0.8, 0.03, M.chrome(), W / 2 - 0.09, 0.7, D / 2 + 0.02);
}

/** tray rack: stacked trays, cutlery bins and a napkin dispenser on a stainless stand */
function trayRack(g: THREE.Group) {
  const ss = brushed();
  rboxB(g, 0.9, 0.84, 0.45, 0.012, ss, 0, 0.06, 0);
  boxB(g, 0.86, 0.06, 0.4, M.rubber(), 0, 0, 0);
  rboxB(g, 0.92, 0.02, 0.47, 0.006, ss, 0, 0.9, 0);
  const tray = lambert('#6b4a33', { roughness: 0.5 });
  for (let i = 0; i < 9; i++) rboxB(g, 0.36, 0.016, 0.44, 0.006, tray, -0.22, 0.92 + i * 0.019, 0);
  const handles = [lambert('#20262b', { roughness: 0.5 }), M.chrome()];
  for (let i = 0; i < 3; i++) {
    const x = 0.1 + i * 0.12;
    rboxB(g, 0.1, 0.08, 0.24, 0.01, whitePlastic(), x, 0.92, -0.08);
    for (let j = 0; j < 4; j++) boxB(g, 0.012, 0.08, 0.004, handles[(i + j) & 1], x - 0.03 + j * 0.02, 0.98, -0.08 + (j % 2) * 0.04);
  }
  rboxB(g, 0.13, 0.15, 0.1, 0.02, M.chrome(), 0.22, 0.92, 0.14);
  boxB(g, 0.1, 0.012, 0.004, lambert('#ffffff', { roughness: 0.9 }), 0.22, 1.07, 0.19);
}

/** waste station with a tray-return top: landfill · recycling · compost */
function wasteStation(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 1.2;
  const D = p.d ?? 0.5;
  rboxB(g, W, 1.0, D, 0.012, walnut(), 0, 0, 0);
  rboxB(g, W + 0.02, 0.03, D + 0.02, 0.008, M.solidSurface('#2b2f33'), 0, 1.0, 0);
  const bins: [string, string][] = [['LANDFILL', '#5d6569'], ['RECYCLING', '#1f5fa8'], ['COMPOST', '#3f8f4a']];
  const face = canvasMat('waste|face', 576, 216, (ctx, w, h) => {
    ctx.fillStyle = '#6f4f36';
    ctx.fillRect(0, 0, w, h);
    bins.forEach(([label, c], i) => {
      const x0 = (w / 3) * i;
      ctx.fillStyle = '#0d0f10';
      ctx.fillRect(x0 + 18, 14, w / 3 - 36, h * 0.34);
      ctx.fillStyle = c;
      ctx.fillRect(x0 + 12, h * 0.52, w / 3 - 24, h * 0.36);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, label, x0 + w / 6, h * 0.7, w / 3 - 40, h * 0.16, 800, 'center');
    });
  }, { roughness: 0.5 });
  add(g, G.plane(W - 0.04, (W - 0.04) * (216 / 576)), face, 0, 0.78, D / 2 + 0.004);
  for (let i = 0; i < 2; i++) rboxB(g, 0.36, 0.016, 0.44, 0.006, lambert('#6b4a33', { roughness: 0.5 }), -W / 2 + 0.24, 1.03 + i * 0.018, 0);
}

/** backlit menu board */
function menuBoard(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 3;
  const H = p.h ?? 0.95;
  const cols: [string, [string, string][]][] = [
    ['HOT FOOD  06:30–20:00', [['Soup of the day ♥', '3.80'], ['Chicken & rice bowl', '6.90'], ['Vegetable curry ♥', '6.50'], ['Mac & cheese', '5.20']]],
    ['GRAB & GO  24/7', [['Sandwiches', '4.20'], ['Salad box ♥', '5.40'], ['Fruit cup ♥', '2.50'], ['Yogurt parfait', '3.10']]],
    ['DRINKS', [['Coffee · espresso', '2.25'], ['Tea · herbal tea', '1.80'], ['Orange juice', '2.60'], ['Water 500 mL', '1.50']]],
  ];
  const mat = canvasMat(`menu|${W}|${H}`, 1536, Math.round((1536 * H) / W), (ctx, w, h) => {
    ctx.fillStyle = '#18262b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2c14e';
    fitText(ctx, 'CAFÉ · OPEN 24/7', w * 0.03, h * 0.11, w * 0.5, h * 0.12, 800);
    ctx.fillStyle = '#cfe3e0';
    fitText(ctx, 'Staff: 20% off hot food with your badge', w * 0.97, h * 0.11, w * 0.42, h * 0.06, 600, 'right');
    cols.forEach(([title, items], c) => {
      const x0 = w * (0.03 + c * 0.33);
      const cw = w * 0.29;
      ctx.fillStyle = '#f2c14e';
      fitText(ctx, title, x0, h * 0.28, cw, h * 0.075, 700);
      ctx.fillRect(x0, h * 0.335, cw, 3);
      items.forEach(([name, price], i) => {
        const y = h * (0.43 + i * 0.125);
        ctx.fillStyle = '#ffffff';
        fitText(ctx, name, x0, y, cw * 0.76, h * 0.064, 600);
        fitText(ctx, price, x0 + cw, y, cw * 0.22, h * 0.064, 700, 'right');
      });
    });
    ctx.fillStyle = '#9fb7b3';
    fitText(ctx, '♥ lower-salt choice (under 600 mg sodium)', w * 0.03, h * 0.94, w * 0.6, h * 0.048, 500);
  }, { emissive: 0.5, roughness: 0.3 });
  rboxB(g, W + 0.06, H + 0.06, 0.04, 0.01, M.black(), 0, -0.03, 0.02);
  add(g, G.plane(W, H), mat, 0, H / 2, 0.044);
}

// ───────────────────────────── east wing: restrooms ─────────────────────────────

const ceramic = () => lambert('#f6f7f6', { roughness: 0.12 });

/** wall-hung WC (seat ≈ 0.43 m) in front of a cistern duct whose face is at local z = zf */
function wc(g: THREE.Group, x: number, zf: number) {
  const c = ceramic();
  rboxB(g, 0.3, 0.22, 0.2, 0.04, c, x, 0.2, zf + 0.1);
  const bowl = caster(add(g, G.cyl(0.18, 0.13, 0.26, 24), c, x, 0.29, zf + 0.42));
  bowl.scale.z = 1.4;
  const seat = add(g, G.torus(0.15, 0.026, 8, 28), lambert('#fbfbfa', { roughness: 0.25 }), x, 0.425, zf + 0.44, Math.PI / 2, 0, 0);
  seat.scale.y = 1.32;
  const water = add(g, G.circle(0.1, 20), lambert('#c9d8de', { roughness: 0.05, metalness: 0.2 }), x, 0.424, zf + 0.44, -Math.PI / 2, 0, 0);
  water.scale.y = 1.3;
  const lid = rboxB(g, 0.36, 0.4, 0.025, 0.012, lambert('#fbfbfa', { roughness: 0.25 }), x, 0.44, zf + 0.03);
  lid.rotation.x = -0.06;
  rboxB(g, 0.22, 0.15, 0.012, 0.006, brushed(), x, 0.88, zf + 0.006);
  for (const dx of [-0.045, 0.045]) rboxB(g, 0.08, 0.1, 0.008, 0.004, M.chrome(), x + dx, 0.905, zf + 0.014);
}

/** cistern duct + toilet-paper holder helper */
function duct(g: THREE.Group, w: number, zb: number) {
  rboxB(g, w, 1.05, 0.15, 0.01, lightPaint(), 0, 0, zb + 0.075);
  rboxB(g, w, 0.03, 0.17, 0.008, M.solidSurface('#eef0ef'), 0, 1.05, zb + 0.085);
}
function paperHolder(g: THREE.Group, x: number, z: number, side: number) {
  rboxB(g, 0.08, 0.16, 0.24, 0.01, M.chrome(), x - side * 0.04, 0.62, z);
  for (const dz of [-0.06, 0.06]) add(g, G.cyl(0.055, 0.055, 0.09, 16), lambert('#fbfbf6', { roughness: 0.9 }), x - side * 0.075, 0.64, z + dz, Math.PI / 2, 0, 0);
}

/** a row of full-height toilet stalls (n ≈ w / 1 m); local −x end is the room wall, +z is the front with the doors */
function toiletStall(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 5;
  const D = p.d ?? 1.6;
  const n = Math.max(1, Math.round(W / 1.0));
  const sw = W / n;
  const hpl = lambert('#8aa0b0', { roughness: 0.45 });
  const doorMat = hpl;
  const zb = -D / 2;
  const zf = D / 2;
  const PH = 2.3;
  duct(g, W, zb);
  rboxB(g, W, 0.18, 0.03, 0.006, hpl, 0, 2.12, zf - 0.015);
  // head rail ends 3 mm inside the end pilasters (flush, its end faces flickered on theirs)
  boxB(g, W - 0.006, 0.04, 0.05, M.alu(), 0, 2.08, zf - 0.01);
  // vacant stalls: doors on gravity hinges rest open (inward), so the WCs show
  const ajar = [1.3, 1.5, 1.05, 1.45, 1.2, 1.4];
  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + i * sw;
    rboxB(g, 0.025, PH, D - 0.03, 0.006, hpl, x0 + sw, 0.02, -0.015);
    for (const px of [x0 + 0.04, x0 + sw - 0.04]) rboxB(g, 0.08, 2.08, 0.03, 0.006, hpl, px, 0.02, zf - 0.015);
    const dw = sw - 0.16;
    const pivot = new THREE.Group();
    pivot.position.set(x0 + 0.08, 0, zf - 0.015);
    pivot.rotation.y = ajar[i % ajar.length];
    g.add(pivot);
    caster(rboxB(pivot, dw, 2.02, 0.025, 0.006, doorMat, dw / 2, 0.05, 0));
    rboxB(pivot, 0.05, 0.03, 0.02, 0.008, lambert('#2f9e44', { roughness: 0.4 }), dw - 0.07, 1.02, 0.022);
    boxB(pivot, 0.02, 0.14, 0.03, M.chrome(), dw - 0.07, 0.9, 0.03);
    wc(g, x0 + sw / 2, zb + 0.15);
    paperHolder(g, x0 + sw - 0.0125, zb + 0.75, 1);
    boxB(g, 0.03, 0.05, 0.06, M.chrome(), x0 + sw - 0.03, 1.7, zf - 0.35);
  }
}

/** standalone wall-hung WC; label 'accessible' adds grab bars and the emergency pull cord (side wall at local x +0.45) */
function toilet(p: PropDef, g: THREE.Group) {
  duct(g, 0.64, 0);
  wc(g, 0, 0.15);
  paperHolder(g, 0.45, 0.75, 1);
  if (p.label !== 'accessible') return;
  const bar = brushed();
  add(g, G.cyl(0.019, 0.019, 1.05, 14), bar, 0.39, 0.85, 0.85, Math.PI / 2, 0, 0);
  for (const z of [0.35, 1.35]) add(g, G.cyl(0.03, 0.03, 0.06, 14), bar, 0.42, 0.85, z, 0, 0, Math.PI / 2);
  // fold-down bar on the open side (down position)
  add(g, G.cyl(0.019, 0.019, 0.72, 14), bar, -0.36, 0.8, 0.52, Math.PI / 2, 0, 0);
  rboxB(g, 0.08, 0.14, 0.06, 0.01, bar, -0.36, 0.74, 0.17);
  // emergency pull cord from the ceiling, red triangle handle near the floor
  cylB(g, 0.003, 2.8, lambert('#c8302c', { roughness: 0.6 }), 0.4, 0.17, 1.2, 6);
  add(g, G.circle(0.045, 3), lambert('#c8302c', { roughness: 0.5, side: THREE.DoubleSide }), 0.4, 0.14, 1.2, 0, -Math.PI / 2, Math.PI / 2);
}

/** wall-hung counter with undermount basins (knee space below), sensor taps, soap, a mirror; paper towels when long */
function vanity(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 1.8;
  const D = 0.55;
  const n = Math.max(1, Math.round(W / 0.9));
  const bx = (i: number) => -W / 2 + (W / n) * (i + 0.5);
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, D);
  shape.lineTo(-W / 2, D);
  shape.closePath();
  for (let i = 0; i < n; i++) {
    const h = new THREE.Path();
    h.absellipse(bx(i), D * 0.55, 0.2, 0.15, 0, Math.PI * 2, true, 0);
    shape.holes.push(h);
  }
  const geo = trackGeo(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 28 }));
  geo.rotateX(Math.PI / 2);
  add(g, geo, M.solidSurface('#eceae5'), 0, 0.86, 0);
  boxB(g, W, 0.1, 0.02, M.solidSurface('#eceae5'), 0, 0.72, D - 0.01);
  for (const s of [-1, 1]) boxB(g, 0.03, 0.22, 0.42, brushed(), s * (W / 2 - 0.12), 0.6, 0.22);
  const bowlGeo = trackGeo(new THREE.LatheGeometry([[0.2, 0], [0.19, -0.05], [0.16, -0.1], [0.1, -0.135], [0, -0.14]].map(([r, y]) => new THREE.Vector2(r, y)), 32));
  const bowlMat = lambert('#f4f5f4', { roughness: 0.15, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const x = bx(i);
    const bowl = add(g, bowlGeo, bowlMat, x, 0.82, D * 0.55);
    bowl.scale.z = 0.75;
    add(g, G.circle(0.022, 16), M.chrome(), x, 0.683, D * 0.55, -Math.PI / 2, 0, 0);
    tube(g, [[x, 0.86, 0.07], [x, 1.06, 0.08], [x, 1.08, 0.15], [x, 1.03, 0.2]], 0.012, M.chrome(), 16, 8);
    cylB(g, 0.022, 0.09, whitePlastic(), x + 0.23, 0.86, 0.08, 14);
    // the pump's head and spout go down 1 cm when pressed from the top (hygiene.ts: `axis` 1 = down)
    const head = hygPart(g, `plate:${i}`, 0, 0, 0, { travel: 0.01, axis: 1 });
    noMerge(boxB(head, 0.012, 0.012, 0.05, M.chrome(), x + 0.23, 0.95, 0.1));
    noMerge(cylB(head, 0.016, 0.012, whitePlastic(), x + 0.23, 0.946, 0.08, 14));
    hygMark(head, `press:${i}`, x + 0.23, 0.958, 0.08);
    hygMark(g, `nozzle:${i}`, x + 0.23, 0.949, 0.123);
    // the sensor tap's outlet, and the bowl's floor the water lands on
    hygMark(g, `outlet:${i}`, x, 1.022, 0.2);
    hygMark(g, `basin:${i}`, x, 0.7, D * 0.55, { r: 0.13 });
  }
  // a perfect mirror only shows the (dim) environment map; a slightly rough, partly metallic glass reads as a mirror
  const mirror = lambert('#cdd8de', { roughness: 0.14, metalness: 0.8 });
  rboxB(g, W - 0.06, 0.94, 0.014, 0.004, brushed(), 0, 0.98, 0.007);
  add(g, G.plane(W - 0.1, 0.9), mirror, 0, 1.45, 0.017);
  if (W < 1.5) return;
  // paper towels beside the mirror: the clinical dispenser, its tail hanging ready
  const td = new THREE.Group();
  td.position.set(W / 2 + 0.28, 1.2, 0);
  g.add(td);
  towelDispenser(td);
}

/** warm-air hand dryer */
function handDryer(g: THREE.Group) {
  caster(rboxB(g, 0.28, 0.26, 0.16, 0.05, whitePlastic(), 0, 0, 0.08));
  rboxB(g, 0.16, 0.03, 0.06, 0.01, M.dark(), 0, -0.01, 0.1);
  add(g, G.circle(0.012, 12), lambert('#1b2a33', { emissive: '#3fae8f', emissiveIntensity: 0.6 }), 0, 0.19, 0.1615);
}

/** fold-down baby-changing station, folded up */
function babyChange(g: THREE.Group) {
  caster(rboxB(g, 0.86, 0.56, 0.1, 0.03, whitePlastic(), 0, 0, 0.05));
  const face = canvasMat('baby|face', 256, 168, (ctx, w, h) => drawRows(ctx, w, h, ['@baby', 'BABY CHANGING'], '#d5dde1', '#2a5d7a'), { roughness: 0.4 });
  add(g, G.plane(0.4, 0.26), face, -0.14, 0.31, 0.103);
  rboxB(g, 0.16, 0.05, 0.03, 0.012, M.plastic('#7d8b94', 0.4), 0.26, 0.3, 0.11);
}

// ───────────────────────────── hand hygiene and masks (shared/hygiene.ts places them) ─────────────────────────────
// Generic dispensers and labels: no maker's name or artwork, pictograms drawn here.

/** two hands, palm to palm, with three drops over them: the hand-rub label's pictogram */
function drawHands(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + side * s * 0.13, cy + s * 0.1);
    ctx.rotate(side * 0.28);
    // palm, then four fingers and the thumb as rounded bars
    ctx.beginPath();
    ctx.roundRect(-s * 0.15, -s * 0.05, s * 0.3, s * 0.36, s * 0.08);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.roundRect(-s * 0.14 + i * s * 0.075, -s * 0.3 + Math.abs(i - 1.5) * s * 0.04, s * 0.06, s * 0.3, s * 0.03);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(side > 0 ? -s * 0.24 : s * 0.15, s * 0.02, s * 0.09, s * 0.2, s * 0.045);
    ctx.fill();
    ctx.restore();
  }
  for (const [dx, dy] of [[-0.2, -0.42], [0, -0.5], [0.2, -0.42]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * s, cy + dy * s, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** a drop with two bubbles: the soap label's pictogram */
function drawDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.32, cy - s * 0.02, cx + s * 0.28, cy + s * 0.34, cx, cy + s * 0.34);
  ctx.bezierCurveTo(cx - s * 0.28, cy + s * 0.34, cx - s * 0.32, cy - s * 0.02, cx, cy - s * 0.42);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.05;
  for (const [dx, dy, r] of [[0.32, -0.3, 0.1], [0.42, -0.05, 0.07]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** a face in profile-free outline wearing a pleated mask with ear loops */
function drawMaskFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string, mask: string) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.36, s * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  // eyes
  ctx.fillStyle = ink;
  for (const dx of [-0.13, 0.13]) {
    ctx.beginPath();
    ctx.arc(cx + dx * s, cy - s * 0.12, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  // the mask over nose and mouth, three pleats, loops to the ears
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.roundRect(cx - s * 0.3, cy - s * 0.02, s * 0.6, s * 0.34, s * 0.08);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = s * 0.025;
  for (const dy of [0.08, 0.16, 0.24]) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.24, cy + dy * s);
    ctx.lineTo(cx + s * 0.24, cy + dy * s);
    ctx.stroke();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.03;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * s * 0.3, cy + s * 0.02);
    ctx.quadraticCurveTo(cx + side * s * 0.42, cy + s * 0.12, cx + side * s * 0.3, cy + s * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

/** a dispenser's front label: a coloured band with the name, the pictogram, a line under it */
function dispenserLabel(kind: 'rub' | 'soap'): THREE.MeshStandardMaterial {
  return canvasMat(`label|${kind}`, 160, 172, (ctx, w, h) => {
    const band = kind === 'rub' ? '#1f8f80' : '#2f63a8';
    ctx.fillStyle = '#f7f8f8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h * 0.27);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, kind === 'rub' ? 'HAND RUB' : 'SOAP', w / 2, h * 0.135, w * 0.9, h * 0.17, 800, 'center');
    if (kind === 'rub') drawHands(ctx, w / 2, h * 0.6, h * 0.5, band);
    else drawDrop(ctx, w / 2 - h * 0.04, h * 0.6, h * 0.5, band);
    ctx.fillStyle = '#4a5560';
    fitText(ctx, kind === 'rub' ? 'alcohol-based' : 'liquid soap', w / 2, h * 0.92, w * 0.9, h * 0.1, 600, 'center');
  }, { roughness: 0.45 });
}

/**
 * A wall dispenser (alcohol hand rub or liquid soap), 11 × 24 × 10 cm, origin at the wall face under
 * its body: a push plate on the lower front (you press it with the heel of the hand, the other hand
 * cupped under the nozzle), the label above it, the nozzle under the front.
 */
function wallDispenser(g: THREE.Group, kind: 'rub' | 'soap', out = 0) {
  rboxB(g, 0.11, 0.24, 0.1, 0.02, whitePlastic(), 0, 0, 0.05 + out);
  // the plate's back 1 mm inside the body: no face of it in the body's front plane. It moves (pressed
  // in by `travel`: hygiene.ts), with the point the heel of the hand pushes
  const plate = hygPart(g, 'plate', 0, 0, 0, { travel: 0.008 });
  noMerge(rboxB(plate, 0.088, 0.078, 0.016, 0.006, M.plastic(kind === 'rub' ? '#c9dcd8' : '#c9d4e3', 0.35), 0, 0.016, 0.107 + out));
  hygMark(plate, 'press', 0, 0.048, 0.115 + out);
  add(g, G.plane(0.074, 0.08), dispenserLabel(kind), 0, 0.158, 0.1022 + out);
  cylB(g, 0.0055, 0.012, M.dark(), 0, -0.011, 0.074 + out, 10);
  // the nozzle's tip: the dose falls from here
  hygMark(g, 'nozzle', 0, -0.011, 0.074 + out);
}

/** wall-mounted alcohol hand-rub dispenser */
function handRub(g: THREE.Group) {
  wallDispenser(g, 'rub');
}

/** liquid-soap dispenser over a hand-wash sink */
function soapDispenser(g: THREE.Group) {
  wallDispenser(g, 'soap');
}

/**
 * Paper-towel dispenser: towels come out of a slot under the body, 3.5 cm behind its front, the next
 * one's tail hanging 7 cm out of it, ready to take (hygiene.ts: the hand closes on that tail, pulls the
 * towel down and out, and the next tail drops into place).
 */
function towelDispenser(g: THREE.Group) {
  rboxB(g, 0.3, 0.38, 0.12, 0.03, whitePlastic(), 0, 0, 0.06);
  // a tinted window on the front (the stack of towels behind it), 2 mm proud of it
  add(g, G.plane(0.2, 0.16), lambert('#9aa6ae', { roughness: 0.22, metalness: 0.1 }), 0, 0.24, 0.122);
  add(g, G.plane(0.17, 0.03), lambert('#eceae2', { roughness: 0.9 }), 0, 0.185, 0.1245);
  // the slot's dark lip: its top 2 mm inside the body, its bottom 2 mm under it
  boxB(g, 0.2, 0.004, 0.03, M.plastic('#1b1e21', 0.5), 0, -0.002, 0.085);
  hygMark(g, 'slot', 0, -0.002, 0.085);
  // the tail: hangs from inside the lip, its foot a little forward; the hand takes it at `grab`
  const tail = hygPart(g, 'tail', 0, 0, 0.085, { len: 0.07 });
  const hang = new THREE.Group();
  hang.rotation.x = -0.12;
  tail.add(hang);
  noMerge(add(hang, G.box(0.18, 0.07, 0.0016), lambert('#f4f2ec', { roughness: 0.95, emissive: '#f4f2ec', emissiveIntensity: 0.12 }), 0, -0.035, 0));
  hygMark(hang, 'grab', 0, -0.054, 0);
}

/** glove-box holder: a box of examination gloves, its front 3 mm proud of the holder's */
function gloveHolder(g: THREE.Group) {
  rboxB(g, 0.27, 0.14, 0.12, 0.01, M.paint('#d8dde0'), 0, 0, 0.06);
  rboxB(g, 0.24, 0.12, 0.1, 0.01, lambert('#4d79c7', { roughness: 0.7 }), 0, 0.01, 0.073);
  // the box's dispensing hole (2 mm proud of its front), the next glove's cuff showing in it (hygiene.ts: you pull one from here)
  add(g, G.circle(0.03, 20), M.dark(), 0, 0.07, 0.125).scale.set(1.5, 0.6, 1);
  add(g, G.sphere(0.018, 10, 8), lambert('#7aa6e6', { roughness: 0.5 }), 0.004, 0.068, 0.1255).scale.set(1.6, 0.55, 0.5);
  hygMark(g, 'slot', 0, 0.07, 0.127);
}

/**
 * Pedal bin under the towel dispenser: white body, a steel lid hinged at the back (its pivot is
 * `userData.lidOf` = the prop id: hygiene.ts opens it when a towel goes in), the pedal at the front.
 */
function pedalBin(p: PropDef, g: THREE.Group) {
  caster(rboxB(g, 0.27, 0.4, 0.25, 0.04, M.plastic('#e9eceb', 0.35), 0, 0.012, 0));
  rboxB(g, 0.25, 0.014, 0.23, 0.006, M.dark(), 0, 0, 0);
  // the pedal's top 6 mm under the 3 cm of a room's top-down floor label (level with it, they flickered);
  // hinged at its back edge (hygiene.ts presses it: the lid opens)
  const pedal = hygPart(g, 'pedal', 0, 0.024, 0.12);
  noMerge(add(pedal, G.box(0.11, 0.016, 0.06), M.dark(), 0, -0.008, 0.03));
  hygMark(g, 'into', 0, 0.445, 0);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.412, -0.125);
  hinge.userData.lidOf = p.id;
  const lid = add(hinge, G.rbox(0.28, 0.026, 0.26, 0.012), brushed(), 0, 0.013, 0.13);
  lid.userData.noMerge = true;
  g.add(hinge);
}

/** a box of surgical masks: printed card, a mask pictogram, the dispensing slot */
function maskBoxMat(): THREE.MeshStandardMaterial {
  return canvasMat('maskbox', 256, 150, (ctx, w, h) => {
    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5aa6d6';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    drawMaskFace(ctx, w * 0.2, h * 0.4, h * 0.6, '#2a5d7a', '#7fbde3');
    ctx.fillStyle = '#21495f';
    fitText(ctx, 'FACE MASKS', w * 0.64, h * 0.3, w * 0.6, h * 0.18, 800, 'center');
    ctx.fillStyle = '#4a5c68';
    fitText(ctx, 'single use · 3-ply', w * 0.64, h * 0.52, w * 0.6, h * 0.11, 600, 'center');
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'NOSE WIRE UP · CHIN COVERED', w / 2, h * 0.86, w * 0.92, h * 0.1, 700, 'center');
  }, { roughness: 0.6 });
}

/** the slot in a box's face (its local +z out of the face) and the next mask poking out of it, drooping */
function maskTip(g: THREE.Object3D, x: number, y: number, z: number, rx: number) {
  const tip = new THREE.Group();
  tip.position.set(x, y, z);
  tip.rotation.x = rx;
  // the slot 2.5 mm proud of the face
  add(tip, G.circle(0.03, 18), M.dark(), 0, 0, 0.0025).scale.set(1.5, 0.55, 1);
  // out of the slot and bending down under its own weight
  add(tip, G.rbox(0.085, 0.004, 0.045, 0.0018), lambert('#8cc0e3', { roughness: 0.92 }), 0, -0.007, 0.02).rotation.x = 0.55;
  g.add(tip);
}

/**
 * Surgical-mask box dispenser. On a wall (default): a white holder with the box lying in it, its
 * slot to the front; label 'counter': just the box on a counter, the slot on top.
 */
function maskBox(p: PropDef, g: THREE.Group, out = 0) {
  if (p.label === 'counter') {
    rboxB(g, 0.19, 0.09, 0.1, 0.006, maskBoxMat(), 0, 0, 0);
    maskTip(g, 0, 0.0905, 0, -Math.PI / 2);
    return;
  }
  // back plate and cheeks, the box resting on the holder's shelf
  rboxB(g, 0.28, 0.17, 0.012, 0.004, whitePlastic(), 0, 0, 0.006 + out);
  for (const s of [-1, 1]) rboxB(g, 0.014, 0.17, 0.12, 0.004, whitePlastic(), s * 0.133, 0, 0.06 + out);
  rboxB(g, 0.28, 0.014, 0.12, 0.004, whitePlastic(), 0, 0, 0.06 + out);
  rboxB(g, 0.25, 0.14, 0.11, 0.004, maskBoxMat(), 0, 0.016, 0.068 + out);
  maskTip(g, 0, 0.09, 0.1235 + out, 0);
}

/** the respiratory-hygiene stand inside the walk-in door: a sign, a box of masks and a hand-rub dispenser on a post */
function maskStation(p: PropDef, g: THREE.Group) {
  caster(rboxB(g, 0.44, 0.025, 0.44, 0.01, M.plastic('#3a4046', 0.45), 0, 0, 0));
  caster(boxB(g, 0.05, 1.86, 0.05, M.alu(), 0, 0.025, 0));
  // the sign, its face 2 mm in front of its panel
  caster(rboxB(g, 0.38, 0.46, 0.012, 0.006, whitePlastic(), 0, 1.44, 0.031));
  const sign = canvasMat('maskstation|sign', 300, 364, (ctx, w, h) => {
    ctx.fillStyle = '#fdfcf8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f6f8b';
    ctx.fillRect(0, 0, w, h * 0.2);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'COUGH OR FEVER?', w / 2, h * 0.1, w * 0.9, h * 0.1, 800, 'center');
    drawMaskFace(ctx, w * 0.3, h * 0.42, h * 0.3, '#1f3b4d', '#7fbde3');
    drawHands(ctx, w * 0.72, h * 0.44, h * 0.26, '#1f8f80');
    ctx.fillStyle = '#1f3b4d';
    fitText(ctx, 'Please put on a mask', w / 2, h * 0.68, w * 0.9, h * 0.075, 700, 'center');
    fitText(ctx, 'and clean your hands.', w / 2, h * 0.77, w * 0.9, h * 0.075, 700, 'center');
    ctx.fillStyle = '#5a6670';
    fitText(ctx, 'Then tell the desk.', w / 2, h * 0.89, w * 0.9, h * 0.06, 600, 'center');
  }, { roughness: 0.45 });
  add(g, G.plane(0.36, 0.44), sign, 0, 1.67, 0.0392);
  // the box and the dispenser on the post's front face (z 0.025)
  const box = new THREE.Group();
  box.position.y = 1.2;
  maskBox({ ...p, label: undefined }, box, 0.025);
  g.add(box);
  const rub = new THREE.Group();
  rub.position.y = 0.92;
  wallDispenser(rub, 'rub', 0.025);
  g.add(rub);
}

// ───────────────────────────── east wing: outpatient clinic ─────────────────────────────

/** exam table: base cabinet with drawers (local +x) and a pull-out step (foot, +z); backrest raised ~30° at the head (−z), paper roll over it */
function examTable(g: THREE.Group) {
  const white = M.laminate('#eef0ee');
  const vinyl = M.vinyl('#4a6b7f');
  const paperMat = lambert('#f7f7f2', { roughness: 0.9 });
  rboxB(g, 0.62, 0.6, 1.3, 0.02, white, 0, 0.04, 0.1);
  boxB(g, 0.58, 0.04, 1.26, M.rubber(), 0, 0, 0.1);
  for (const zc of [-0.25, 0.4]) {
    for (let r = 0; r < 3; r++) {
      rboxB(g, 0.012, 0.16, 0.5, 0.004, white, 0.316, 0.08 + r * 0.185, zc);
      boxB(g, 0.016, 0.016, 0.14, M.chrome(), 0.328, 0.2 + r * 0.185, zc);
    }
  }
  rboxB(g, 0.5, 0.05, 0.3, 0.012, white, 0, 0.2, 0.9);
  boxB(g, 0.46, 0.006, 0.26, M.rubber(), 0, 0.25, 0.9);
  rboxB(g, 0.7, 0.06, 1.9, 0.02, white, 0, 0.64, 0);
  caster(rboxB(g, 0.68, 0.1, 1.05, 0.04, vinyl, 0, 0.7, 0.425));
  rboxB(g, 0.52, 0.004, 1.04, 0.002, paperMat, 0, 0.8, 0.425);
  const back = new THREE.Group();
  back.position.set(0, 0.75, -0.1);
  back.rotation.x = 0.5;
  g.add(back);
  caster(rboxB(back, 0.68, 0.1, 0.85, 0.04, vinyl, 0, -0.05, -0.425));
  rboxB(back, 0.52, 0.004, 0.85, 0.002, paperMat, 0, 0.05, -0.425);
  add(back, G.cyl(0.055, 0.055, 0.56, 20), paperMat, 0, 0.06, -0.9, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) rboxB(back, 0.02, 0.1, 0.1, 0.005, M.chrome(), s * 0.3, 0.0, -0.9);
}

/** wall diagnostic set: otoscope + ophthalmoscope on a transformer, aneroid BP gauge with cuff, specula, sharps bin below */
function diagSet(g: THREE.Group) {
  const grey = M.paint('#8f989e', 0.4);
  rboxB(g, 0.36, 0.13, 0.07, 0.02, grey, 0.12, 0.3, 0.035);
  for (const [dx, head] of [[0.04, '#1b1e21'], [0.2, '#3a3f44']] as [number, string][]) {
    cylB(g, 0.016, 0.15, M.black(), dx, 0.43, 0.05, 12);
    cylB(g, 0.022, 0.05, head === '#1b1e21' ? M.black() : M.dark(), dx, 0.58, 0.05, 12);
    tube(g, [[dx, 0.3, 0.07], [dx + 0.025, 0.16, 0.085], [dx - 0.02, 0.08, 0.085], [dx + 0.01, 0.3, 0.075]], 0.005, M.black(), 24, 5);
  }
  const dial = canvasMat('diag|dial', 128, 128, (ctx, w) => {
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, w, w);
    ctx.translate(w / 2, w / 2);
    ctx.fillStyle = '#1b1e21';
    for (let i = 0; i <= 30; i++) {
      ctx.save();
      ctx.rotate(-Math.PI * 0.75 + (i / 30) * Math.PI * 1.5);
      ctx.fillRect(-1, -58, 2, i % 5 ? 6 : 12);
      ctx.restore();
    }
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('mmHg', 0, 26);
    ctx.fillStyle = '#c62828';
    ctx.rotate(-Math.PI * 0.75);
    ctx.fillRect(-1.5, -50, 3, 52);
  }, { roughness: 0.3 });
  rboxB(g, 0.17, 0.2, 0.05, 0.02, grey, -0.2, 0.3, 0.025);
  add(g, G.cyl(0.075, 0.075, 0.02, 32), M.chrome(), -0.2, 0.42, 0.06, Math.PI / 2, 0, 0);
  add(g, G.circle(0.067, 32), dial, -0.2, 0.42, 0.0715);
  rboxB(g, 0.22, 0.14, 0.11, 0.02, lambert('#2a4f86', { roughness: 0.75 }), -0.2, 0.08, 0.055);
  tube(g, [[-0.2, 0.33, 0.05], [-0.13, 0.25, 0.1], [-0.17, 0.2, 0.1]], 0.004, M.black(), 12, 5);
  rboxB(g, 0.08, 0.14, 0.06, 0.01, whitePlastic(), 0.37, 0.3, 0.03);
  rboxB(g, 0.26, 0.3, 0.13, 0.02, lambert('#c8302c', { roughness: 0.5 }), 0.12, -0.45, 0.065);
  rboxB(g, 0.27, 0.04, 0.14, 0.01, lambert('#f2c230', { roughness: 0.45 }), 0.12, -0.16, 0.07);
}

/** column scale with height rod */
function columnScale(g: THREE.Group) {
  const white = lightPaint();
  rboxB(g, 0.38, 0.07, 0.46, 0.02, white, 0, 0, 0.04);
  rboxB(g, 0.32, 0.012, 0.36, 0.004, M.rubber(), 0, 0.07, 0.06);
  rboxB(g, 0.07, 1.26, 0.07, 0.01, white, 0, 0.06, -0.15);
  rboxB(g, 0.3, 0.14, 0.12, 0.02, white, 0, 1.3, -0.14);
  const disp = canvasMat('scale|disp', 128, 48, (ctx, w, h) => {
    ctx.fillStyle = '#0d1a14';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9dffb8';
    fitText(ctx, '0.0 kg', w / 2, h / 2, w * 0.86, h * 0.62, 700, 'center');
  }, { emissive: 0.9, roughness: 0.3 });
  add(g, G.plane(0.13, 0.05), disp, 0, 1.38, -0.0775);
  boxB(g, 0.025, 0.62, 0.02, M.alu(), 0, 1.44, -0.205);
  rboxB(g, 0.22, 0.012, 0.07, 0.004, M.alu(), 0, 2.04, -0.17);
}

export function buildProp(p: PropDef): BuiltProp {
  const out: BuiltProp = { group: new THREE.Group(), screens: [], lightBar: [] };
  // (hand hygiene finds a fixture's named points and moving parts under its prop's group: hygMark)
  out.group.userData.propId = p.id;
  // Resus 1 + 2 equipment (pendants, ventilator, pumps, defibrillator cart, …) lives in resusGear.ts
  if (buildResusProp(p, out)) return out;
  // the CT suite and the X-ray room (gantry, couch, injector, consoles, tube crane, wall stand, …) live in imaging.ts
  if (buildImagingProp(p, out)) {
    out.group.userData.propId = p.id;
    return out;
  }
  const g = out.group;
  const w = p.w;
  const d = p.d;
  const h = p.h;
  switch (p.kind) {
    case 'bed':
      bed(p, out, false);
      break;
    case 'stretcher':
      bed(p, out, true);
      break;
    case 'monitor': {
      // wall-mounted patient monitor on an articulating arm; bottom at y (set by caller)
      rboxB(g, 0.1, 0.1, 0.06, 0.02, M.paint('#cfd4d7'), 0, 0.14, -0.22);
      tube(g, [[0, 0.19, -0.2], [0, 0.2, -0.12], [0, 0.19, -0.05]], 0.022, M.paint('#cfd4d7'), 8, 8);
      caster(rboxB(g, 0.62, 0.45, 0.09, 0.03, M.plastic('#d9dde0', 0.35), 0, -0.02, -0.01));
      rboxB(g, 0.56, 0.39, 0.02, 0.01, M.black(), 0, 0.01, 0.035);
      screenMesh(g, 0.53, 0.35, 0, 0.205, 0.047, 'monitor', out);
      rboxB(g, 0.5, 0.035, 0.05, 0.015, M.plastic('#2f6f9f'), 0, -0.06, 0.02);
      // wall rail with SpO2/BP accessories and a sharps box below
      rboxB(g, 0.28, 0.32, 0.12, 0.02, lambert('#c8302c', { roughness: 0.5 }), 0.55, -0.9, -0.17);
      rboxB(g, 0.28, 0.05, 0.13, 0.02, lambert('#f2f2f2', { roughness: 0.5 }), 0.55, -0.6, -0.17);
      // medical gas outlets (O2 green, air yellow/black, vacuum white) on the headwall
      const gas: [string, number][] = [['#2f8f46', -0.55], ['#f0c419', -0.42], ['#f2f2f2', -0.29]];
      for (const [c, x] of gas) {
        rboxB(g, 0.09, 0.12, 0.03, 0.01, M.paint('#e8ebec'), x, -0.48, -0.21);
        add(g, G.cyl(0.022, 0.022, 0.03, 12), lambert(c, { roughness: 0.4 }), x, -0.42, -0.19, Math.PI / 2, 0, 0);
      }
      break;
    }
    case 'computer': {
      // thin LCD on a stand, keyboard + mouse
      rboxB(g, 0.24, 0.015, 0.18, 0.006, M.dark(), 0, 0, -0.04);
      rboxB(g, 0.05, 0.2, 0.03, 0.01, M.dark(), 0, 0.012, -0.06);
      caster(rboxB(g, 0.58, 0.36, 0.04, 0.012, M.black(), 0, 0.14, -0.04));
      screenMesh(g, 0.54, 0.31, 0, 0.32, -0.018, 'computer', out);
      rboxB(g, 0.44, 0.018, 0.14, 0.006, M.plastic('#1d2124', 0.5), 0, 0, 0.2);
      rboxB(g, 0.06, 0.02, 0.1, 0.02, M.plastic('#1d2124', 0.4), 0.3, 0, 0.21);
      break;
    }
    case 'counter': {
      const W = w ?? 2;
      const D = d ?? 0.7;
      const H = h ?? 1.05;
      // The seated sides of the station counters need knee and toe clearance below the worktop.
      const publicSide = p.id === 'st_counter_n' ? -1 : 1;
      const recess = p.id === 'st_counter_n' || p.id === 'st_counter_s' ? 0.30 : 0;
      const baseZ = publicSide * recess / 2;
      // (the body stops under the worktop: at H - 0.05 tall from 0.08 it poked 3 cm through the top, and
      // things on the counter read as sunk into it)
      rboxB(g, W - 0.04, H - 0.13, D - 0.06 - recess, 0.01, M.laminate('#cdc4b4'), 0, 0.08, baseZ);
      // contrasting accent band (laminate reveal) along the front
      boxB(g, W - 0.03, 0.12, 0.012, M.laminate('#6f8f97'), 0, H - 0.3, publicSide * (D / 2 - 0.025));
      rboxB(g, W, 0.05, D, 0.012, M.solidSurface('#ede8df'), 0, H - 0.05, 0);
      boxB(g, W - 0.08, 0.08, D - 0.14 - recess, M.rubber(), 0, 0, baseZ);
      // transaction ledge strip
      boxB(g, W - 0.02, 0.02, 0.06, M.alu(), 0, H - 0.07, publicSide * (D / 2 - 0.02));
      break;
    }
    case 'desk': {
      const W = w ?? 1.4;
      const D = d ?? 0.7;
      const H = h ?? 0.78;
      if (H >= 1.0) {
        // reception / registration counter: closed laminate front, raised transaction top, work surface behind
        // (the front's top stops 1 cm inside the transaction top: level with it, the two tops flickered)
        rboxB(g, W - 0.04, H - 0.07, D * 0.35, 0.01, M.laminate('#cdc4b4'), 0, 0.06, D * 0.32);
        rboxB(g, W, 0.05, D * 0.42, 0.012, M.solidSurface('#ede8df'), 0, H - 0.05, D * 0.3);
        boxB(g, W - 0.03, 0.14, 0.012, M.laminate('#6f8f97'), 0, H - 0.32, D * 0.5 - 0.004);
        rboxB(g, W - 0.1, 0.035, D * 0.55, 0.01, M.laminate('#e3ddd2'), 0, 0.74, -D * 0.18);
        boxB(g, W - 0.08, 0.06, D * 0.6, M.rubber(), 0, 0, 0.0);
        for (const sx of [-1, 1]) rboxB(g, 0.04, 0.72, D * 0.55, 0.01, M.laminate('#cdc4b4'), sx * (W / 2 - 0.05), 0.02, -D * 0.18);
        break;
      }
      rboxB(g, W, 0.035, D, 0.01, M.laminate('#e3ddd2'), 0, H - 0.035, 0);
      for (const s of [-1, 1]) rboxB(g, 0.04, H - 0.035, D - 0.08, 0.01, M.paint('#9aa3a9'), s * (W / 2 - 0.04), 0, 0);
      rboxB(g, W - 0.12, 0.38, 0.02, 0.008, M.paint('#b6bdc1'), 0, H - 0.43, -D / 2 + 0.05);
      // mobile pedestal
      rboxB(g, 0.42, 0.56, D - 0.12, 0.02, M.paint('#d6dadc'), W / 2 - 0.3, 0.04, 0.02);
      break;
    }
    case 'chair':
      // a desk chair is an office chair in any room (e.g. registration in the waiting room)
      if (/^st_|wr_|desk/.test(p.id)) {
        officeChair(g);
        // it rolls: kept out of the static merge, so getting up from a workstation pushes it back (workstationChairs.ts)
        g.userData.deskChair = p.id;
        g.traverse((o) => (o.userData.noMerge = true));
      } else if (p.room === 'waiting' || p.room === 'triage') waitingChair(g, p.color ?? '#3e6a86');
      else waitingChair(g, p.color ?? '#4d6f84');
      break;
    case 'stool': {
      caster(rboxB(g, 0.38, 0.07, 0.38, 0.035, M.vinyl('#2f3a44'), 0, 0.55, 0));
      cylB(g, 0.025, 0.42, M.chrome(), 0, 0.12, 0, 10);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(g, G.rbox(0.28, 0.03, 0.04, 0.012), M.chrome(), Math.cos(a) * 0.14, 0.08, Math.sin(a) * 0.14, 0, -a, 0);
      }
      break;
    }
    case 'phone': {
      rboxB(g, 0.22, 0.05, 0.18, 0.02, M.black(), 0, 0, 0);
      rboxB(g, 0.2, 0.045, 0.06, 0.02, M.plastic('#1f2326'), 0, 0.05, -0.05);
      add(g, G.box(0.08, 0.004, 0.05), lambert('#8fe0d4', { emissive: '#58c9b9', emissiveIntensity: 1.2 }), 0.05, 0.052, 0.04);
      break;
    }
    case 'board': {
      const W = w ?? 3.2;
      const H = h ?? 0.9;
      caster(rboxB(g, W + 0.1, H + 0.1, 0.09, 0.02, M.black(), 0, -0.05, 0));
      screenMesh(g, W, H, 0, H / 2, 0.047, 'board', out);
      screenMesh(g, W, H, 0, H / 2, -0.047, 'board', out, Math.PI);
      for (const s of [-1, 1]) boxB(g, 0.025, Math.max(0.02, 3.0 - (p.y ?? 2) - H), 0.025, M.alu(), s * (W / 2 - 0.3), H, 0);
      break;
    }
    // ctScanner, xrayTable and the rest of the CT suite and X-ray room: imaging.ts (buildImagingProp above)
    case 'sink': {
      clinicalSink(g);
      // gooseneck faucet and its elbow/wrist lever (the soap, rub, gloves, towels and bin on the wall behind it: shared/hygiene.ts)
      tube(g, [[0, 0.88, -0.2], [0, 1.12, -0.2], [0, 1.18, -0.1], [0, 1.08, -0.04]], 0.014, M.chrome(), 16, 8);
      sinkLever(g);
      // where the water leaves the spout and where it lands: the bowl's floor, by the drain (hygiene.ts)
      hygMark(g, 'outlet', 0, 1.074, -0.04);
      hygMark(g, 'basin', 0, 0.724, 0.02, { r: 0.12 });
      break;
    }
    case 'cart': {
      // a ward's linen cart (its cover rolls up) is the corridor one's model (cabinetModels.ts)
      if (/linen/.test(p.id)) {
        g.add(linenCart(p.id));
        break;
      }
      caster(rboxB(g, 0.52, 0.84, 0.44, 0.03, M.plastic('#d4e2ea'), 0, 0.1, 0));
      // four drawers that slide out (cabinets.ts)
      supplyCartDrawers(g, p.id);
      rboxB(g, 0.56, 0.035, 0.48, 0.015, M.plastic('#9fb4c0'), 0, 0.94, 0);
      casters(g, [-0.2, 0.2], [-0.16, 0.16], 0.05);
      break;
    }
    case 'crashCart': {
      const red = lambert('#b8231f', { roughness: 0.32, metalness: 0.25 });
      caster(rboxB(g, 0.7, 0.94, 0.52, 0.03, red, 0, 0.1, 0));
      // drawers A (airway) … E, sealed with a numbered breakaway seal (cabinets.ts opens them)
      crashCartDrawers(g, p.id);
      rboxB(g, 0.74, 0.035, 0.56, 0.015, M.dark(), 0, 1.04, 0);
      // defibrillator on top
      caster(rboxB(g, 0.4, 0.24, 0.3, 0.04, M.plastic('#2d3236', 0.45), -0.1, 1.075, 0));
      rboxB(g, 0.16, 0.1, 0.012, 0.01, M.black(), -0.15, 1.2, 0.152);
      add(g, G.box(0.06, 0.03, 0.01), lambert('#f2c230', { emissive: '#f2c230', emissiveIntensity: 1.4 }), 0.03, 1.21, 0.155);
      // backboard on the side
      rboxB(g, 0.02, 0.9, 0.45, 0.01, lambert('#e6c35a', { roughness: 0.4 }), 0.37, 0.16, 0);
      casters(g, [-0.28, 0.28], [-0.2, 0.2], 0.05);
      break;
    }
    case 'plant': {
      add(g, G.cyl(0.2, 0.15, 0.38, 24), lambert('#3e4448', { roughness: 0.45 }), 0, 0.19, 0);
      // soil 3 mm proud of the pot's top (level with it, the two discs flickered)
      add(g, G.cyl(0.18, 0.18, 0.02, 24), lambert('#3b2c22', { roughness: 1 }), 0, 0.373, 0);
      // leaves: tilted ellipses around stems
      const leaf = lambert('#3f7a45', { roughness: 0.6, side: THREE.DoubleSide });
      const leaf2 = lambert('#4f8f4f', { roughness: 0.6, side: THREE.DoubleSide });
      for (let i = 0; i < 26; i++) {
        const a = i * 2.39996;
        const r = 0.06 + (i % 5) * 0.035;
        const y = 0.5 + (i / 26) * 0.75;
        const m = add(g, G.circle(0.11, 10), i % 2 ? leaf : leaf2, Math.cos(a) * r, y, Math.sin(a) * r, -0.9 + (i % 3) * 0.3, -a, 0);
        m.scale.set(0.45, 1.2, 1);
      }
      for (let i = 0; i < 3; i++) tube(g, [[0, 0.38, 0], [Math.cos(i * 2.1) * 0.05, 0.8, Math.sin(i * 2.1) * 0.05], [Math.cos(i * 2.1) * 0.09, 1.2, Math.sin(i * 2.1) * 0.09]], 0.01, lambert('#5a4a2e', { roughness: 0.9 }), 8, 5);
      break;
    }
    case 'cabinet':
      // a cupboard open at the front behind doors that swing (supplies, linen, a wardrobe, lockers, a file): cabinetModels.ts
      buildCabinet(p, g);
      break;
    case 'cdCupboard':
      // the medication room's locked controlled-drug cupboard, its register below
      buildCdCupboard(p, g);
      break;
    case 'ivPole': {
      cylB(g, 0.013, 1.95, M.chrome(), 0, 0.06, 0, 10);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(g, G.rbox(0.28, 0.025, 0.035, 0.01), M.plastic('#2a2e31'), Math.cos(a) * 0.13, 0.05, Math.sin(a) * 0.13, 0, -a, 0);
        add(g, G.sphere(0.025, 8, 6), M.rubber(), Math.cos(a) * 0.26, 0.025, Math.sin(a) * 0.26);
      }
      tube(g, [[-0.14, 1.95, 0], [-0.12, 2.01, 0], [0, 2.02, 0], [0.12, 2.01, 0], [0.14, 1.95, 0]], 0.008, M.chrome(), 12, 6);
      // large-volume infusion pump clamped to the pole (green "running" LED, amber display)
      caster(rboxB(g, 0.2, 0.26, 0.13, 0.025, M.plastic('#e9edef', 0.35), 0.0, 0.95, 0.07));
      rboxB(g, 0.14, 0.07, 0.01, 0.006, lambert('#1b2a24', { emissive: '#f2b134', emissiveIntensity: 0.55, roughness: 0.2 }), 0.0, 1.12, 0.136);
      add(g, G.sphere(0.008, 8, 6), lambert('#3fb950', { emissive: '#3fb950', emissiveIntensity: 2 }), 0.07, 1.0, 0.14);
      rboxB(g, 0.05, 0.05, 0.03, 0.01, M.chrome(), 0, 1.05, 0.0);
      // saline bag + drip chamber + line
      add(g, G.rbox(0.12, 0.2, 0.035, 0.015), glass('#e8f4f8', 0.55), 0.12, 1.78, 0).userData.noMerge = true;
      add(g, G.cyl(0.012, 0.012, 0.06, 8), glass('#f2f8fa', 0.6), 0.12, 1.63, 0).userData.noMerge = true;
      tube(g, [[0.12, 1.6, 0], [0.13, 1.2, 0.02], [0.05, 0.9, 0.12], [0.0, 0.7, 0.3]], 0.003, lambert('#eef4f6', { roughness: 0.3 }), 24, 5);
      break;
    }
    case 'trash': {
      add(g, G.cyl(0.19, 0.17, 0.55, 24), lambert('#7d878e', { roughness: 0.35, metalness: 0.6 }), 0, 0.275, 0);
      add(g, G.cyl(0.2, 0.2, 0.04, 24), M.black(), 0, 0.57, 0);
      break;
    }
    case 'vending': {
      caster(rboxB(g, 0.96, 1.86, 0.8, 0.03, lambert('#7c1f22', { roughness: 0.3, metalness: 0.3 }), 0, 0, 0));
      rboxB(g, 0.64, 1.32, 0.02, 0.01, emitter('#d8eef8', 1.1), -0.1, 0.4, 0.4);
      add(g, G.box(0.66, 1.34, 0.01), glass('#dff1f8', 0.25), -0.1, 1.07, 0.42).userData.noMerge = true;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) rboxB(g, 0.1, 0.13, 0.04, 0.015, lambert(['#e94f37', '#f6c445', '#3fa34d', '#2e86ab'][(r + c) % 4], { roughness: 0.3 }), -0.32 + c * 0.15, 0.55 + r * 0.24, 0.37);
      rboxB(g, 0.16, 0.4, 0.03, 0.01, M.black(), 0.33, 1.0, 0.41);
      break;
    }
    case 'sofa': {
      // Seat cushions' top at 0.46 m (seatHeight), back cushions on the frame's back: 0.44 m of seat
      // from them to the front edge, so a seated adult (amenities.ts) has the back against them, the
      // knees just past the edge and the feet flat on the floor. Arms 0.16 m above the seat.
      const W = 1.8;
      const s = M.fabric('#5f7a6c');
      const cushion = M.fabric('#6a8778');
      caster(rboxB(g, W, 0.3, 0.82, 0.06, s, 0, 0.04, 0));
      caster(rboxB(g, W, 0.6, 0.2, 0.06, s, 0, 0.22, -0.32));
      for (const sx of [-1, 1]) caster(rboxB(g, 0.18, 0.58, 0.82, 0.06, s, sx * (W / 2 - 0.09), 0.04, 0));
      for (const sx of [-1, 1]) {
        caster(rboxB(g, W / 2 - 0.2, 0.12, 0.6, 0.05, cushion, sx * (W / 4 - 0.05), 0.34, 0.06));
        caster(rboxB(g, W / 2 - 0.2, 0.34, 0.14, 0.05, cushion, sx * (W / 4 - 0.05), 0.46, -0.15));
      }
      break;
    }
    case 'ambulance':
      // detailed Type III ambulance (vehicles.ts): merged by material, warning lights in out.lightBar
      buildAmbulance(out);
      break;
    case 'medDispenser': {
      caster(rboxB(g, 1.1, 1.9, 0.62, 0.03, M.laminate('#eef1f2'), 0, 0, 0));
      // teal header band: 1 cm proud of the sides, 2 cm proud in front, top 3 cm under the cabinet's.
      // Same width and top as the body, the faces z-fought and flashed as the view moved.
      rboxB(g, 1.12, 0.22, 0.66, 0.03, lambert('#0f6e6e', { roughness: 0.4 }), 0, 1.65, 0);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) rboxB(g, 0.3, 0.17, 0.025, 0.01, M.plastic('#cfd8dc'), -0.36 + c * 0.36, 0.15 + r * 0.22, 0.31);
      screenMesh(g, 0.3, 0.2, 0.34, 1.5, 0.325, 'small', out);
      break;
    }
    case 'ultrasound': {
      caster(rboxB(g, 0.5, 0.75, 0.45, 0.05, M.plastic('#e1e6e9'), 0, 0.12, 0));
      rboxB(g, 0.56, 0.06, 0.5, 0.025, M.plastic('#a8b4bb'), 0, 0.87, 0);
      rboxB(g, 0.05, 0.4, 0.05, 0.015, M.dark(), 0, 0.93, -0.15);
      caster(rboxB(g, 0.52, 0.36, 0.04, 0.012, M.black(), 0, 1.27, -0.15));
      screenMesh(g, 0.46, 0.3, 0, 1.45, -0.128, 'small', out);
      casters(g, [-0.2, 0.2], [-0.18, 0.18], 0.05);
      break;
    }
    case 'whiteboard': {
      rboxB(g, 1.7, 1.06, 0.03, 0.012, M.alu(), 0, 0, 0);
      screenMesh(g, 1.62, 0.98, 0, 0.53, 0.017, 'whiteboard', out);
      rboxB(g, 1.6, 0.03, 0.07, 0.01, M.alu(), 0, -0.03, 0.035);
      break;
    }
    case 'tv': {
      rboxB(g, 1.16, 0.68, 0.05, 0.01, M.black(), 0, 0, 0);
      screenMesh(g, 1.1, 0.62, 0, 0.34, 0.028, 'tv', out); // 3 mm off the bezel
      break;
    }
    case 'coffee': {
      rboxB(g, 0.8, 0.9, 0.5, 0.012, M.wood('#cbb08c'), 0, 0, 0);
      rboxB(g, 0.84, 0.03, 0.54, 0.01, M.solidSurface('#ede8df'), 0, 0.9, 0);
      caster(rboxB(g, 0.32, 0.42, 0.36, 0.04, M.plastic('#1f2225', 0.3), -0.15, 0.93, -0.02));
      add(g, G.box(0.16, 0.06, 0.01), lambert('#c9a24a', { emissive: '#c9a24a', emissiveIntensity: 0.8 }), -0.15, 1.24, 0.165);
      // (the staff's mugs stand on a rack beside it: amenities.ts, cupStacks.ts)
      break;
    }
    case 'lamp':
      // LED parking-lot area light, twin heads (exterior.ts); the rig turns the anchor into a down light
      lampPost(g, true, out);
      break;
    case 'vitalsMachine': {
      cylB(g, 0.02, 1.1, M.chrome(), 0, 0.06, 0, 8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(g, G.rbox(0.26, 0.025, 0.035, 0.01), M.plastic('#2a2e31'), Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12, 0, -a, 0);
      }
      caster(rboxB(g, 0.3, 0.24, 0.15, 0.03, M.plastic('#e4e8ea'), 0, 1.1, 0));
      screenMesh(g, 0.2, 0.13, -0.02, 1.24, 0.077, 'small', out);
      rboxB(g, 0.2, 0.1, 0.1, 0.02, M.plastic('#2f6f9f'), 0, 0.95, 0.02);
      tube(g, [[0.12, 1.15, 0.06], [0.2, 0.95, 0.1], [0.12, 0.98, 0.06]], 0.006, M.black(), 12, 5);
      break;
    }
    case 'fridge':
      // a medication fridge (2–8 °C) in the medication rooms, the staff fridge-freezer in the lounge: doors that open
      buildFridge(p, g);
      break;
    case 'printer': {
      rboxB(g, 0.46, 0.24, 0.4, 0.03, M.plastic('#e2e5e7'), 0, 0, 0);
      boxB(g, 0.3, 0.012, 0.2, lambert('#ffffff', { roughness: 0.9 }), 0, 0.24, 0.05);
      add(g, G.box(0.03, 0.01, 0.02), lambert('#3fb950', { emissive: '#3fb950', emissiveIntensity: 1.5 }), 0.15, 0.245, -0.12);
      break;
    }
    case 'sign':
      // exterior signs are built by the builder (they need text textures)
      break;
    // east wing
    case 'hangingSign':
      hangingSign(p, g);
      break;
    case 'wallSign':
      wallSign(p, g);
      break;
    case 'poster':
      poster(p, g);
      break;
    case 'litSign':
      litSign(p, g);
      break;
    case 'canopy':
      canopy(p, g);
      break;
    case 'parking':
      parking(p, g);
      break;
    case 'handrail':
      handrail(p, g);
      break;
    case 'elevatorDoor':
      elevatorDoor(p, g);
      break;
    case 'callPanel':
      callPanel(g);
      break;
    case 'fireDoor':
      fireDoor(p, g);
      break;
    case 'aed':
      aedCabinet(g);
      break;
    case 'cafeTable':
      cafeTable(p, g);
      break;
    case 'cafeChair':
      cafeChair(p, g);
      break;
    case 'servingCounter':
      servingCounter(p, g);
      break;
    case 'till':
      till(g);
      break;
    case 'coffeeStation':
      coffeeStation(p, g);
      break;
    case 'drinksFridge':
      drinksFridge(g);
      break;
    case 'trayRack':
      trayRack(g);
      break;
    case 'wasteStation':
      wasteStation(p, g);
      break;
    case 'menuBoard':
      menuBoard(p, g);
      break;
    case 'toiletStall':
      toiletStall(p, g);
      break;
    case 'toilet':
      toilet(p, g);
      break;
    case 'vanity':
      vanity(p, g);
      break;
    case 'handDryer':
      handDryer(g);
      break;
    case 'babyChange':
      babyChange(g);
      break;
    case 'handRub':
      handRub(g);
      break;
    case 'soapDispenser':
      soapDispenser(g);
      break;
    case 'towelDispenser':
      towelDispenser(g);
      break;
    case 'gloveHolder':
      gloveHolder(g);
      break;
    case 'pedalBin':
      pedalBin(p, g);
      break;
    case 'maskBox':
      maskBox(p, g);
      break;
    case 'maskStation':
      maskStation(p, g);
      break;
    case 'examTable':
      examTable(g);
      break;
    case 'diagSet':
      diagSet(g);
      break;
    case 'scale':
      columnScale(g);
      break;
  }
  return out;
}

/** Height of the lying surface for bed-like props (top of the sheet). */
export function surfaceHeight(kind: string): number | undefined {
  switch (kind) {
    case 'bed':
      return 0.64;
    case 'stretcher':
      return 0.64;
    // the CT couch at its loading height (imagingLife.ts carries the patient up and into the gantry from there)
    case 'ctScanner':
      return CT_LOAD_SURFACE;
    case 'xrayTable':
      return XR_SURFACE;
    default:
      return undefined;
  }
}

/** Seat height for sittable props. */
export function seatHeight(kind: string): number | undefined {
  switch (kind) {
    case 'chair':
      return 0.48;
    case 'stool':
      return 0.62;
    case 'sofa':
      return 0.46;
    case 'cafeChair':
      return 0.46;
    default:
      return undefined;
  }
}

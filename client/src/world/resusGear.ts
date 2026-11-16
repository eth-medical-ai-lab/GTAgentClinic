/**
 * Resus 1 and 2 by the ambulance entrance, equipped like an ICU bed space: ceiling supply pendants
 * (O₂ / air / vacuum, power), a large patient monitor, an ICU ventilator on its stand, an infusion
 * tower, a crash cart with defibrillator and ABCDE drawers, an airway trolley with a video
 * laryngoscope, wall suction, ultrasound, a rapid infuser with fluid warmer, a forced-air warmer, a
 * mechanical CPR device with backboard, a procedure light, gloves and sharps, a clock with an
 * elapsed timer, a team-roles board, and a mobile X-ray parked in the corridor. No brand names.
 *
 * Builders follow props.ts: origin on the floor at the prop's (x, z) — wall props on the wall face
 * with local y measured from p.y — and the front facing +z. They use cached materials only (most
 * shared with the rest of the hospital), one-band rounded boxes, and draw every printed label and
 * every screen into two canvas atlases (printed, glowing), so once the builder has merged the statics
 * by material, both rooms together add only a handful of draw calls. Nothing here casts shadows;
 * each procedure light is a shadowless spot that replaces the room's shadowed exam light.
 *
 * Hooks: props.ts (buildResusProp), builder.ts (RESUS_TALL, resusLitRooms, dressResusSuite),
 * items.ts (RESUS_INFO), lighting.ts (the 'procedure' fixture), shared/layout.ts (placement).
 */
import * as THREE from 'three';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import type { Fixture, Interactable } from './builder';
import type { Clock } from './details';
import { G, add, basic, boxB, canvasTexture, cylB, emitter, lambert, makeCanvas, own, pbr, trackGeo, tube } from './materials';
import type { BuiltProp, ScreenKind } from './props';
import { cabPart, cabSeal, cabSealBroken, cabUnit, drawerInner, sealNumber } from './cabinetModels';

const PI = Math.PI;
type V3 = [number, number, number];

// ───────────────────────────── materials (cached; mostly shared with props.ts) ─────────────────────────────

/** same option order as props.ts M.plastic, so the cache hands back the same material (= the same draw call) */
const plastic = (c: string, rough = 0.42) => pbr('plastic', { color: c, tile: 0.3, roughness: rough, normalScale: 0.3, worldUV: true });
const C = {
  white: () => plastic('#eef0f1', 0.3),
  grey: () => plastic('#d9dde0', 0.35),
  blue: () => plastic('#5d8fb1', 0.38),
  teal: () => plastic('#2f6f9f'),
  charcoal: () => plastic('#2d3236', 0.45),
  boom: () => lambert('#e2e6e8', { roughness: 0.4, metalness: 0.15 }),
  // satin aluminium for rails, shelves and frames: the east wing's brushed steel, only partly metallic
  // so it reads light under point lights (a fully metallic one mirrors the dim environment and looks black)
  alu: () => lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 }),
  chrome: () => lambert('#d9dde0', { roughness: 0.16, metalness: 1 }),
  dark: () => lambert('#2b3034', { roughness: 0.45 }),
  black: () => lambert('#16191b', { roughness: 0.32 }),
  rubber: () => pbr('rubber', { color: '#2a2d30', tile: 0.2, roughness: 0.9 }),
  red: () => lambert('#b8231f', { roughness: 0.32, metalness: 0.25 }),
  redFront: () => lambert('#c7302b', { roughness: 0.3, metalness: 0.25 }),
  yellow: () => lambert('#e6c35a', { roughness: 0.4 }),
  sharps: () => lambert('#c8302c', { roughness: 0.5 }),
  sharpsLid: () => lambert('#f2c230', { roughness: 0.45 }),
  // US medical-gas colour code (CGA / NFPA 99): O₂ green, medical air yellow, vacuum white
  o2: () => lambert('#2f8f46', { roughness: 0.4 }),
  air: () => lambert('#f0c419', { roughness: 0.4 }),
  vac: () => lambert('#f2f2f2', { roughness: 0.4 }),
  sock: () => lambert('#f4f4f2', { roughness: 0.4 }),
  led: () => lambert('#3fb950', { emissive: '#3fb950', emissiveIntensity: 2 }),
  line: () => lambert('#eef4f6', { roughness: 0.3 }),
  cylinder: () => lambert('#e9ecee', { roughness: 0.35, metalness: 0.4 }),
  blanket: () => pbr('fabric_curtain', { color: '#9cc3d8', tile: 0.25, roughness: 1, normalScale: 0.6 }),
  // new: suction canisters / fluid bags (opaque polycarbonate look, no sorting), corrugated hoses
  canister: () => lambert('#e3eef2', { roughness: 0.22 }),
  hose: () => lambert('#9ec3d9', { roughness: 0.5 }),
};
const GLOVES: Record<string, string> = { S: '#6b4fb3', M: '#3d74c9', L: '#3aa36a' };
const glove = (s: string) => lambert(GLOVES[s], { roughness: 0.7 });

// ───────────────────────────── geometry helpers ─────────────────────────────

/** rounded box with one bevel band (108 triangles instead of 300), bottom at y0 */
function rb(g: THREE.Object3D, w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y0: number, z: number, ry = 0): THREE.Mesh {
  return add(g, G.rbox(w, h, d, r, 1), mat, x, y0 + h / 2, z, 0, ry, 0);
}
const bx = boxB;
const cyl = cylB;
/** cylinder lying along local x or z, centred at (x, y, z) */
function rod(g: THREE.Object3D, r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'z', seg = 12): THREE.Mesh {
  return add(g, G.cyl(r, r, len, seg), mat, x, y, z, axis === 'z' ? PI / 2 : 0, 0, axis === 'x' ? PI / 2 : 0);
}
/** child group (a tilted panel, a unit facing another way) */
function sub(g: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0): THREE.Group {
  const s = new THREE.Group();
  s.position.set(x, y, z);
  s.rotation.set(rx, ry, 0);
  g.add(s);
  return s;
}
/** single-wheel swivel casters */
function wheels(g: THREE.Object3D, pts: [number, number][], r = 0.045) {
  for (const [x, z] of pts) {
    add(g, G.cyl(r, r, 0.03, 12), C.rubber(), x, r, z, 0, 0, PI / 2);
    // the fork straddles the wheel (4 mm wider each side, no face shared with the wheel's hub)
    bx(g, 0.038, 0.05, 0.036, C.chrome(), x, r * 1.4, z);
  }
}
/** five-leg rolling base (IV-pole style) of radius R */
function starBase(g: THREE.Object3D, R: number) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + PI / 10;
    add(g, G.rbox(R, 0.03, 0.045, 0.01, 1), C.dark(), (Math.cos(a) * R) / 2, 0.06, (Math.sin(a) * R) / 2, 0, -a, 0);
    add(g, G.sphere(0.028, 8, 6), C.rubber(), Math.cos(a) * R, 0.028, Math.sin(a) * R);
  }
}
/** live screen: the world swaps in a canvas material (bedside monitor) */
function screen(g: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, kind: ScreenKind, out: BuiltProp) {
  const m = new THREE.Mesh(G.plane(w, h), basic('#0b0f12'));
  m.position.set(x, y, z);
  m.userData.noMerge = true;
  g.add(m);
  out.screens.push({ mesh: m, kind });
}

// ───────────────────────────── label + screen atlases ─────────────────────────────
// Every printed label is a region of one 2048² canvas, every glowing screen a region of one 1024²
// canvas: one material each, so all of them merge into two draw calls for the whole building.

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
type AtlasKind = 'print' | 'glow';
interface Atlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshStandardMaterial;
  x: number;
  y: number;
  row: number;
  regions: Map<string, [number, number, number, number]>;
}
const atlases = new Map<AtlasKind, Atlas>();

function atlas(kind: AtlasKind): Atlas {
  const hit = atlases.get(kind);
  if (hit) return hit;
  const S = kind === 'print' ? 2048 : 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = kind === 'print' ? '#e8ebec' : '#000000';
  ctx.fillRect(0, 0, S, S);
  const tex = canvasTexture(canvas);
  const mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: kind === 'print' ? 0.55 : 0.25 }));
  if (kind === 'glow') {
    mat.emissive.set('#ffffff');
    mat.emissiveMap = tex;
    mat.emissiveIntensity = 1.0;
  }
  const a: Atlas = { canvas, ctx, tex, mat, x: 0, y: 0, row: 0, regions: new Map() };
  atlases.set(kind, a);
  // disposeCaches() disposes the material when the world goes away: start a fresh atlas next time
  mat.addEventListener('dispose', () => atlases.delete(kind));
  return a;
}

/** UV rect [u0, v0, u1, v1] of a region drawn once per key (shelf-packed, 4 px gutters) */
function region(kind: AtlasKind, key: string, w: number, h: number, draw: Draw): [number, number, number, number] {
  const a = atlas(kind);
  const hit = a.regions.get(key);
  if (hit) return hit;
  const S = a.canvas.width;
  if (a.x + w + 4 > S) {
    a.x = 0;
    a.y += a.row;
    a.row = 0;
  }
  const x0 = a.x + 2;
  const y0 = a.y + 2;
  if (y0 + h > S) console.warn(`[resus] ${kind} atlas full at ${key}`);
  a.x += w + 4;
  a.row = Math.max(a.row, h + 4);
  const ctx = a.ctx;
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  draw(ctx, w, h);
  ctx.restore();
  a.tex.needsUpdate = true;
  const r: [number, number, number, number] = [(x0 + 0.5) / S, 1 - (y0 + h - 0.5) / S, (x0 + w - 0.5) / S, 1 - (y0 + 0.5) / S];
  a.regions.set(key, r);
  return r;
}

/** a w × h m plane showing an atlas region, facing +z (ry / rx turn it) */
function decal(g: THREE.Object3D, kind: AtlasKind, key: string, px: [number, number], draw: Draw, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0): THREE.Mesh {
  const [u0, v0, u1, v1] = region(kind, key, px[0], px[1], draw);
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return add(g, trackGeo(geo), atlas(kind).mat, x, y, z, rx, ry, 0);
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const MARKER = '"Marker Felt", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
const MONO = '"SF Mono", Menlo, Consolas, "Courier New", monospace';

/** fillText shrunk until it fits maxW */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, align: CanvasTextAlign = 'left', color?: string, font = FONT) {
  if (color) ctx.fillStyle = color;
  let s = Math.round(size);
  ctx.font = `${weight} ${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 6) ctx.font = `${weight} ${--s}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
/** radiation trefoil (blades at 30°, 150° and 270°) */
function trefoil(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, color: string) {
  ctx.fillStyle = color;
  for (const c of [-150, -30, 90]) {
    const a0 = ((c - 30) * PI) / 180;
    const a1 = ((c + 30) * PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.arc(cx, cy, R * 0.3, a1, a0, true);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.18, 0, PI * 2);
  ctx.fill();
}
/** simplified biohazard mark: three open rings around a hub */
function biohazard(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = R * 0.18;
  for (const c of [-90, 30, 150]) {
    const a = (c * PI) / 180;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45, R * 0.42, 0, PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.2, 0, PI * 2);
  ctx.stroke();
}
function checkbox(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y - s / 2, s, s);
}

// ── printed labels ──

const GAS: Record<'O2' | 'AIR' | 'VAC', [string, string, string]> = { O2: ['#2f8f46', '#ffffff', 'O₂'], AIR: ['#f0c419', '#1b1e21', 'AIR'], VAC: ['#f2f2f2', '#1b1e21', 'VAC'] };
const drawGas = (k: 'O2' | 'AIR' | 'VAC'): Draw => (ctx, w, h) => {
  const [bg, fg, t] = GAS[k];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1e21';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  fit(ctx, t, w / 2, h / 2 + 1, w * 0.84, h * 0.72, 800, 'center', fg);
};

const DRAWERS: Record<string, [string, string]> = { A: ['#2e8b57', 'AIRWAY'], B: ['#2a72bd', 'BREATHING'], C: ['#c0392b', 'CIRCULATION · IV / IO'], D: ['#6b4fb3', 'DRUGS'], E: ['#5b6b7a', 'EQUIPMENT'] };
/** what the prompt calls each drawer ("Open drawer C: circulation, IV and IO") */
const CRASH_NAMES: Record<string, string> = { A: 'airway', B: 'breathing', C: 'circulation, IV and IO', D: 'drugs', E: 'equipment' };
const AIRWAY_NAMES: Record<string, string> = { A: 'tracheal intubation', B: 'supraglottic airway', C: 'face-mask oxygenation', D: 'front of neck access', P: 'paediatric' };
const PLANS: Record<string, [string, string, string]> = {
  A: ['#2e8b57', 'A', 'PLAN A — TRACHEAL INTUBATION'],
  B: ['#d9a400', 'B', 'PLAN B — SUPRAGLOTTIC AIRWAY'],
  C: ['#e07020', 'C', 'PLAN C — FACE-MASK OXYGENATION'],
  D: ['#c0392b', 'D', 'PLAN D — FRONT OF NECK ACCESS'],
  P: ['#5b6b7a', 'P', 'PAEDIATRIC AIRWAY'],
};
const drawTag = (color: string, letter: string, text: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, h * 1.15, h);
  fit(ctx, letter, h * 0.575, h / 2 + 1, h, h * 0.78, 800, 'center', '#ffffff');
  fit(ctx, text, h * 1.4, h / 2 + 1, w - h * 1.55, h * 0.6, 700, 'left', '#1b1e21');
};

const drawPads: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f6f7f8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, 0, w, h * 0.22);
  fit(ctx, 'ADULT DEFIBRILLATION PADS', w / 2, h * 0.11, w * 0.92, h * 0.13, 800, 'center', '#ffffff');
  // torso outline with right-upper / left-lower (apex) pad positions
  ctx.strokeStyle = '#3a4248';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(w * 0.3, h * 0.3, w * 0.4, h * 0.6, 14);
  ctx.stroke();
  ctx.fillStyle = '#2a72bd';
  ctx.fillRect(w * 0.34, h * 0.36, w * 0.1, h * 0.14);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(w * 0.55, h * 0.6, w * 0.1, h * 0.14);
  fit(ctx, 'Exp 2028-03', w * 0.04, h * 0.92, w * 0.4, h * 0.09, 600, 'left', '#4a545b');
};
const drawDefibPanel: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#2d3236';
  ctx.fillRect(0, 0, w, h);
  // energy selector ring (the knob sits in its centre)
  ctx.strokeStyle = '#8d979e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.24, w * 0.32, 0, PI * 2);
  ctx.stroke();
  ['OFF', '50', '120', '150', '200', 'MON'].forEach((t, i) => {
    const a = -PI * 0.95 + (i / 5) * PI * 0.9;
    fit(ctx, t, w / 2 + Math.cos(a) * w * 0.43, h * 0.24 + Math.sin(a) * w * 0.43 + 2, 30, 9, 700, 'center', '#e8ebec');
  });
  fit(ctx, 'J', w / 2, h * 0.45, 20, 10, 700, 'center', '#e8ebec');
  const btn = (y: number, color: string, label: string, fg = '#1b1e21') => {
    rrect(ctx, w * 0.12, y, w * 0.76, h * 0.1, 6, color);
    fit(ctx, label, w / 2, y + h * 0.05 + 1, w * 0.7, h * 0.06, 800, 'center', fg);
  };
  btn(h * 0.52, '#c6ccd0', 'ANALYSE');
  btn(h * 0.64, '#f2c230', 'CHARGE');
  btn(h * 0.76, '#e4572e', 'SHOCK', '#ffffff');
  btn(h * 0.88, '#f4f4f2', 'SYNC');
};
const drawCheckLog: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#fbfbf6';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'CRASH CART — DAILY CHECK', w / 2, h * 0.06, w * 0.92, h * 0.05, 800, 'center', '#b8231f');
  ctx.fillStyle = '#9aa3a9';
  for (let i = 0; i < 9; i++) ctx.fillRect(w * 0.06, h * (0.16 + i * 0.09), w * 0.88, 1);
  fit(ctx, 'Date   Seal no.   Defib test   Sign', w * 0.06, h * 0.12, w * 0.88, h * 0.04, 700, 'left', '#30363b');
  [['06/11', '4471', 'pass'], ['07/11', '4471', 'pass'], ['08/11', '4502', 'pass']].forEach(([d, s, t], i) => {
    fit(ctx, `${d}   ${s}   ${t}   ✓`, w * 0.07, h * (0.205 + i * 0.09), w * 0.86, h * 0.05, 400, 'left', '#1f3f8f', MARKER);
  });
};
const drawSharps: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  biohazard(ctx, h * 0.42, h / 2, h * 0.3, '#1b1e21');
  fit(ctx, 'SHARPS ONLY', h * 0.85, h * 0.33, w - h * 0.9, h * 0.22, 800, 'left', '#1b1e21');
  fit(ctx, 'Do not fill above line', h * 0.85, h * 0.62, w - h * 0.9, h * 0.15, 600, 'left', '#1b1e21');
  ctx.fillStyle = '#1b1e21';
  ctx.fillRect(h * 0.85, h * 0.82, w - h * 1.0, 3);
};
const drawGloveBox = (s: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#f2f4f7';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = GLOVES[s];
  ctx.fillRect(0, 0, w, h * 0.3);
  fit(ctx, 'NITRILE', w / 2, h * 0.15, w * 0.9, h * 0.13, 800, 'center', '#ffffff');
  fit(ctx, s, w / 2, h * 0.58, w * 0.8, h * 0.4, 800, 'center', GLOVES[s]);
  fit(ctx, 'powder-free', w / 2, h * 0.88, w * 0.9, h * 0.09, 600, 'center', '#4a545b');
};
const drawFluidBag: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d6fb8';
  ctx.fillRect(0, 0, w, h * 0.2);
  fit(ctx, "Ringer's", w / 2, h * 0.36, w * 0.9, h * 0.15, 800, 'center', '#1d3557');
  fit(ctx, 'lactate', w / 2, h * 0.52, w * 0.9, h * 0.15, 800, 'center', '#1d3557');
  fit(ctx, '1000 mL', w / 2, h * 0.74, w * 0.9, h * 0.15, 700, 'center', '#1d3557');
};
const drawPumpFace: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#e9edef';
  ctx.fillRect(0, 0, w, h);
  // door with the line channel on the left, display (off) and keypad on the right
  rrect(ctx, w * 0.05, h * 0.08, w * 0.4, h * 0.84, 6, '#cfd5d9', '#aab3b9');
  ctx.fillStyle = '#9aa3a9';
  ctx.fillRect(w * 0.23, h * 0.12, 3, h * 0.76);
  rrect(ctx, w * 0.52, h * 0.1, w * 0.42, h * 0.3, 4, '#1c2227');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rrect(ctx, w * (0.54 + c * 0.14), h * (0.5 + r * 0.15), w * 0.1, h * 0.1, 3, '#bcc4c9');
  fit(ctx, 'VOLUMETRIC', w * 0.73, h * 0.96, w * 0.4, h * 0.07, 700, 'center', '#5b6b7a');
};
const drawSyringeFace: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#e9edef';
  ctx.fillRect(0, 0, w, h);
  rrect(ctx, w * 0.62, h * 0.12, w * 0.34, h * 0.76, 3, '#1c2227');
  for (let c = 0; c < 4; c++) rrect(ctx, w * (0.05 + c * 0.13), h * 0.28, w * 0.09, h * 0.44, 3, '#bcc4c9');
};
const drawUsKeys: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#3a4046';
  ctx.fillRect(0, 0, w, h);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) rrect(ctx, 10 + c * 38, 10 + r * 26, 32, 20, 4, '#59626a');
  ctx.strokeStyle = '#8d979e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.74, 30, 0, PI * 2);
  ctx.stroke();
  ['DEPTH', 'GAIN', 'FREEZE', 'MODE'].forEach((t, i) => {
    rrect(ctx, 14 + (i % 2) * (w - 112), h * 0.58 + Math.floor(i / 2) * 36, 84, 26, 5, i === 2 ? '#2a72bd' : '#59626a');
    fit(ctx, t, 56 + (i % 2) * (w - 112), h * 0.58 + Math.floor(i / 2) * 36 + 14, 76, 13, 700, 'center', '#e8ebec');
  });
};
const drawRiFace: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#eef0f1';
  ctx.fillRect(0, 0, w, h);
  rrect(ctx, w * 0.06, h * 0.06, w * 0.58, h * 0.36, 6, '#1c2227');
  for (let i = 0; i < 4; i++) rrect(ctx, w * 0.7, h * (0.07 + i * 0.09), w * 0.24, h * 0.07, 4, i === 3 ? '#e4572e' : '#bcc4c9');
  fit(ctx, 'RAPID INFUSER', w / 2, h * 0.52, w * 0.9, h * 0.08, 800, 'center', '#1b1e21');
  fit(ctx, 'warmed · air detection', w / 2, h * 0.61, w * 0.9, h * 0.06, 600, 'center', '#4a545b');
  // reservoir level window + pressure dome
  rrect(ctx, w * 0.08, h * 0.7, w * 0.36, h * 0.24, 6, '#cfd8dc', '#9aa3a9');
  rrect(ctx, w * 0.56, h * 0.7, w * 0.36, h * 0.24, 6, '#cfd8dc', '#9aa3a9');
};
const drawFwFace: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#d9dde0';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'FLUID', w / 2, h * 0.12, w * 0.9, h * 0.09, 800, 'center', '#1b1e21');
  fit(ctx, 'WARMER', w / 2, h * 0.22, w * 0.9, h * 0.09, 800, 'center', '#1b1e21');
  rrect(ctx, w * 0.14, h * 0.34, w * 0.72, h * 0.22, 4, '#1c2227');
  fit(ctx, 'set 41 °C', w / 2, h * 0.7, w * 0.9, h * 0.08, 600, 'center', '#4a545b');
  rrect(ctx, w * 0.3, h * 0.8, w * 0.4, h * 0.12, 4, '#bcc4c9');
};
const drawFaw: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#eef0f1';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'FORCED-AIR WARMING', w * 0.04, h * 0.18, w * 0.92, h * 0.17, 800, 'left', '#1b1e21');
  ['AMB', '32 °C', '38 °C', '43 °C'].forEach((t, i) => {
    rrect(ctx, w * (0.04 + i * 0.235), h * 0.42, w * 0.21, h * 0.3, 5, i === 3 ? '#e07020' : '#bcc4c9');
    fit(ctx, t, w * (0.145 + i * 0.235), h * 0.57 + 1, w * 0.19, h * 0.16, 700, 'center', '#1b1e21');
  });
  fit(ctx, 'Hose into the blanket — never free-hose', w * 0.04, h * 0.87, w * 0.92, h * 0.11, 600, 'left', '#b8231f');
};
const drawCprPanel: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#c3c9cd';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'MECHANICAL CPR', w * 0.05, h * 0.2, w * 0.6, h * 0.2, 800, 'left', '#1b1e21');
  ctx.strokeStyle = '#1b1e21';
  ctx.lineWidth = 2;
  ctx.strokeRect(w * 0.72, h * 0.08, w * 0.22, h * 0.22);
  ctx.fillStyle = '#3fb950';
  ctx.fillRect(w * 0.735, h * 0.11, w * 0.14, h * 0.16);
  ['ADJUST', 'PAUSE', 'ACTIVE 30:2', 'ACTIVE CONT.'].forEach((t, i) => {
    rrect(ctx, w * (0.04 + i * 0.24), h * 0.45, w * 0.22, h * 0.42, 6, i === 1 ? '#f2c230' : '#e8ebec');
    fit(ctx, t, w * (0.15 + i * 0.24), h * 0.66, w * 0.2, h * 0.16, 700, 'center', '#1b1e21');
  });
};
const drawCprBoard: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#e6c35a';
  ctx.fillRect(0, 0, w, h);
  for (const x of [0.12, 0.7]) rrect(ctx, w * x, h * 0.06, w * 0.18, h * 0.08, 8, '#2a2d30');
  fit(ctx, 'CPR BOARD', w / 2, h * 0.45, w * 0.86, h * 0.13, 800, 'center', '#1b1e21');
  fit(ctx, 'under the chest', w / 2, h * 0.58, w * 0.86, h * 0.08, 600, 'center', '#1b1e21');
};
const drawXrayWarn: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  trefoil(ctx, h * 0.5, h * 0.5, h * 0.36, '#1b1e21');
  fit(ctx, 'X-RAY', h * 0.95, h * 0.5, w - h, h * 0.36, 800, 'left', '#1b1e21');
};
const drawXraySide: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#eef0f1';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, h, h);
  trefoil(ctx, h * 0.5, h * 0.5, h * 0.36, '#1b1e21');
  fit(ctx, 'MOBILE X-RAY', h * 1.15, h * 0.34, w - h * 1.25, h * 0.3, 800, 'left', '#1b1e21');
  fit(ctx, 'Exposure: stand back 2 m', h * 1.15, h * 0.7, w - h * 1.25, h * 0.2, 600, 'left', '#4a545b');
};
const drawGauge: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#eef0f1';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.46, 0, PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1b1e21';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) {
    const a = PI * 0.75 + (i / 10) * PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a) * w * 0.3, h / 2 + Math.sin(a) * w * 0.3);
    ctx.lineTo(w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * w * 0.4);
    ctx.stroke();
  }
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2);
  ctx.lineTo(w / 2 + Math.cos(PI * 0.75) * w * 0.36, h / 2 + Math.sin(PI * 0.75) * w * 0.36);
  ctx.stroke();
  fit(ctx, 'mmHg', w / 2, h * 0.72, w * 0.5, h * 0.12, 700, 'center', '#1b1e21');
};
const drawApron: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#eef0f1';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'APRONS', w / 2, h / 2 + 1, w * 0.9, h * 0.6, 800, 'center', '#3d74c9');
};
const drawTimerKeys: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#e8ebec';
  ctx.fillRect(0, 0, w, h);
  ['START', 'STOP', 'RESET'].forEach((t, i) => fit(ctx, t, w * (0.17 + i * 0.33), h / 2 + 1, w * 0.3, h * 0.7, 700, 'center', '#30363b'));
};

/** the team-roles whiteboard: printed role tags + pre-alert (ATMIST) form, one marker note */
const drawBoard = (title: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#fbfcfb';
  ctx.fillRect(0, 0, w, h);
  // ghosting of old marker
  ctx.fillStyle = 'rgba(110,120,130,0.05)';
  for (let i = 0; i < 18; i++) ctx.fillRect((i * 197) % w, 90 + ((i * 131) % (h - 140)), 60 + ((i * 37) % 120), 10);
  ctx.fillStyle = '#0f4c5c';
  ctx.fillRect(0, 0, w, 64);
  fit(ctx, `${title} — TEAM`, 24, 34, 440, 34, 800, 'left', '#ffffff');
  fit(ctx, 'Pre-alert at ______   ETA ______', w - 24, 34, 420, 22, 600, 'right', '#cfe6ec');
  const roles: [string, string, string][] = [
    ['TEAM LEAD', '#c0392b', 'at the foot · hands off'],
    ['AIRWAY', '#2a72bd', ''],
    ['CIRCULATION', '#2e8b57', ''],
    ['MEDS', '#6b4fb3', ''],
    ['SCRIBE', '#d35400', 'times · drugs · shocks'],
  ];
  roles.forEach(([r, c, note], i) => {
    const y = 92 + i * 84;
    rrect(ctx, 24, y, 196, 54, 8, c);
    fit(ctx, r, 122, y + 28, 180, 24, 800, 'center', '#ffffff');
    ctx.fillStyle = '#9aa3a9';
    ctx.fillRect(240, y + 46, 290, 2);
    if (note) fit(ctx, note, 240, y + 70, 290, 15, 600, 'left', '#7b858c');
  });
  const x0 = 580;
  fit(ctx, 'PRE-ALERT  (ATMIST)', x0, 104, 360, 24, 800, 'left', '#1b1e21');
  ['Age / sex', 'Time of onset / injury', 'Mechanism / complaint', 'Injuries / findings', 'Signs  A B C D E', 'Treatment so far'].forEach((t, i) => {
    const y = 146 + i * 46;
    fit(ctx, t, x0, y, 196, 17, 600, 'left', '#4a545b');
    ctx.fillStyle = '#c5ccd0';
    ctx.fillRect(x0 + 206, y + 9, 150, 2);
  });
  fit(ctx, 'Weight ____ kg     Allergies ________', x0, 430, 360, 17, 600, 'left', '#4a545b');
  fit(ctx, 'Blood bank called', x0 + 26, 468, 150, 17, 600, 'left', '#4a545b');
  checkbox(ctx, x0, 468, 16, '#4a545b');
  fit(ctx, 'Major haemorrhage', x0 + 206, 468, 160, 17, 600, 'left', '#4a545b');
  checkbox(ctx, x0 + 180, 468, 16, '#4a545b');
  // the only handwriting: the night team's room check
  ctx.save();
  ctx.translate(x0 + 8, 528);
  ctx.rotate(-0.04);
  fit(ctx, 'Room checked ✓  21:30', 0, 0, 340, 30, 400, 'left', '#1e7f45', MARKER);
  ctx.restore();
  ctx.fillStyle = '#0f4c5c';
  ctx.fillRect(24, h - 50, w - 48, 2);
  fit(ctx, 'Closed loop: name → task → read back → "done"', 24, h - 26, w - 48, 19, 700, 'left', '#0f4c5c');
};

// ── glowing screens ──

const drawVent: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#081420';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#12304a';
  ctx.fillRect(0, 0, w, 44);
  fit(ctx, 'STANDBY', 14, 23, 150, 26, 800, 'left', '#ffb02e');
  fit(ctx, 'Adult · HME filter · test lung', 176, 23, w - 190, 17, 600, 'left', '#cfe6f5');
  fit(ctx, '✓ Pre-use check passed 21:30', 14, 64, w - 28, 17, 600, 'left', '#5fd38d');
  fit(ctx, 'VC-AC', 14, 98, 130, 30, 800, 'left', '#ffffff');
  fit(ctx, 'preset for intubation', 148, 100, w - 160, 16, 500, 'left', '#8fb3c9');
  const tiles: [string, string, string][] = [['VT', '450', 'mL'], ['f', '16', '/min'], ['PEEP', '5', 'cmH₂O'], ['FiO₂', '100', '%'], ['Ti', '1.0', 's'], ['Pmax', '35', 'cmH₂O']];
  tiles.forEach(([k, v, u], i) => {
    const x = 14 + (i % 3) * 142;
    const y = 124 + Math.floor(i / 3) * 84;
    ctx.fillStyle = '#10283c';
    ctx.fillRect(x, y, 132, 74);
    ctx.strokeStyle = '#2a5a7c';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, 130, 72);
    fit(ctx, k, x + 8, y + 15, 116, 15, 600, 'left', '#8fb3c9');
    fit(ctx, v, x + 8, y + 45, 84, 32, 800, 'left', '#ffffff');
    fit(ctx, u, x + 124, y + 61, 56, 13, 500, 'right', '#8fb3c9');
  });
  rrect(ctx, w - 186, h - 46, 172, 36, 6, '#1d6b3a');
  fit(ctx, 'START VENTILATION', w - 100, h - 27, 160, 15, 700, 'center', '#ffffff');
  fit(ctx, 'O₂ ✓   AIR ✓   supply OK', 14, h - 27, 220, 14, 600, 'left', '#8fb3c9');
};
const drawUs: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);
  // empty sector outline, probe icons, standby text
  ctx.strokeStyle = '#1f262c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.12);
  ctx.arc(w * 0.5, h * 0.12, h * 0.78, PI * 0.33, PI * 0.67);
  ctx.closePath();
  ctx.stroke();
  fit(ctx, 'STANDBY — select probe', w / 2, h * 0.55, w * 0.8, 18, 600, 'center', '#4c5963');
  ['PHASED', 'CURVED', 'LINEAR'].forEach((t, i) => {
    rrect(ctx, w * (0.08 + i * 0.3), h * 0.82, w * 0.24, h * 0.1, 5, '#11171c', '#2a333b');
    fit(ctx, t, w * (0.2 + i * 0.3), h * 0.87, w * 0.22, 13, 700, 'center', '#5f6d78');
  });
};
const drawTimer: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(18, h / 2);
  ctx.rotate(-PI / 2);
  fit(ctx, 'ELAPSED', 0, 0, h * 0.9, 13, 700, 'center', '#8a3a36');
  ctx.restore();
  ctx.shadowColor = '#ff3b30';
  ctx.shadowBlur = 8;
  fit(ctx, '00:00', w * 0.58, h / 2 + 2, w * 0.76, h * 0.86, 800, 'center', '#ff3b30', MONO);
  ctx.shadowBlur = 0;
};

// ───────────────────────────── equipment builders ─────────────────────────────

/** medical gas outlet with its coloured collar and label, on a surface facing +z at depth z */
function gasOutlet(g: THREE.Object3D, gas: 'O2' | 'AIR' | 'VAC', x: number, y: number, z: number) {
  rb(g, 0.07, 0.085, 0.012, 0.005, C.chrome(), x, y - 0.06, z + 0.006);
  rod(g, 0.021, 0.02, gas === 'O2' ? C.o2() : gas === 'AIR' ? C.air() : C.vac(), x, y - 0.02, z + 0.02, 'z', 14);
  // socket and label 3 mm proud of the collar / plate (closer, they flicker against them)
  add(g, G.circle(0.01, 10), C.black(), x, y - 0.02, z + 0.033);
  decal(g, 'print', `gas|${gas}`, [96, 40], drawGas(gas), 0.06, 0.025, x, y + 0.012, z + 0.015);
}
/** power socket (white, or red = emergency power) */
function socket(g: THREE.Object3D, red: boolean, x: number, y: number, z: number) {
  rb(g, 0.065, 0.08, 0.012, 0.005, red ? C.sharps() : C.sock(), x, y - 0.04, z + 0.006);
  bx(g, 0.03, 0.03, 0.004, C.dark(), x, y - 0.015, z + 0.013);
}
/** vacuum regulator with gauge above a 1 L canister and the patient tubing; faces +z, origin on the rail */
function suctionUnit(u: THREE.Object3D) {
  rb(u, 0.075, 0.11, 0.06, 0.012, C.white(), 0, 0.03, 0.03);
  rod(u, 0.031, 0.02, C.white(), 0, 0.1, 0.07, 'z', 16);
  decal(u, 'print', 'gauge', [64, 64], drawGauge, 0.05, 0.05, 0, 0.1, 0.083);
  rod(u, 0.011, 0.02, C.dark(), 0, 0.045, 0.07, 'z', 10);
  bx(u, 0.15, 0.015, 0.1, C.alu(), 0, -0.03, 0.06);
  cyl(u, 0.066, 0.22, C.canister(), 0, -0.255, 0.07, 16, 0.06);
  cyl(u, 0.072, 0.022, C.teal(), 0, -0.035, 0.07, 16);
  tube(u, [[0.03, -0.02, 0.1], [0.075, -0.2, 0.14], [0.05, -0.38, 0.13], [-0.03, -0.34, 0.11], [-0.055, -0.14, 0.1]], 0.0045, C.line(), 20, 6);
}
/** O₂ flowmeter (float tube, green knob) with a coil of oxygen tubing; faces +z, origin on the rail */
function flowmeter(u: THREE.Object3D) {
  rb(u, 0.045, 0.05, 0.04, 0.008, C.chrome(), 0, 0.0, 0.03);
  cyl(u, 0.013, 0.12, C.line(), 0, 0.05, 0.045, 10);
  cyl(u, 0.016, 0.026, C.o2(), 0, 0.17, 0.045, 10);
  tube(u, [[0, -0.005, 0.05], [0.04, -0.18, 0.08], [-0.05, -0.27, 0.08], [-0.07, -0.12, 0.07], [0.02, -0.09, 0.07]], 0.003, C.line(), 20, 5);
}
/** sharps bin with a yellow lid and its label; faces +z, bottom at y0 */
function sharpsBin(g: THREE.Object3D, x: number, y0: number, z: number, w = 0.26, h = 0.28, d = 0.14) {
  rb(g, w, h, d, 0.02, C.sharps(), x, y0, z);
  rb(g, w + 0.01, 0.04, d + 0.01, 0.012, C.sharpsLid(), x, y0 + h, z);
  decal(g, 'print', 'sharps', [160, 96], drawSharps, w * 0.8, w * 0.48, x, y0 + h * 0.5, z + d / 2 + 0.003);
}

/**
 * Ceiling supply pendant: column with gases on the front, sockets beside them and rails on both
 * sides, hung from a one-piece arm that runs back (local −z, length p.w) to its ceiling pivot.
 * label 'gas' (airway side): 2× O₂, air, 2× vacuum, two suction units, an O₂ flowmeter; the patient
 * monitor is a separate prop clamped on its drop tube. label 'infusion': O₂, air, vacuum, six
 * sockets, an IV pole with bags, a glove box and a sharps bin.
 */
function pendant(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const L = p.w ?? 1.0;
  const gasSide = p.label !== 'infusion';
  const boom = C.boom();
  const TOP = 1.9;
  cyl(g, 0.2, 0.05, boom, 0, 2.95, -L, 20);
  cyl(g, 0.07, 0.24, boom, 0, 2.71, -L, 14);
  // the joints reach 1.5 cm below the arm (flush, their bottoms flickered with the arm's)
  cyl(g, 0.11, 0.13, C.grey(), 0, 2.585, -L, 18);
  add(g, G.rbox(0.2, 0.13, L, 0.03, 1), boom, 0, 2.665, -L / 2);
  cyl(g, 0.11, 0.13, C.grey(), 0, 2.585, 0, 18);
  cyl(g, 0.065, 2.6 - TOP, boom, 0, TOP, 0, 14);
  rb(g, 0.34, 1.0, 0.3, 0.035, boom, 0, TOP - 1.0, 0);
  rb(g, 0.36, 0.03, 0.32, 0.012, C.grey(), 0, TOP - 0.015, 0);
  rb(g, 0.44, 0.03, 0.42, 0.012, C.grey(), 0, TOP - 1.03, 0.08);
  const zf = 0.15;
  const gases: ('O2' | 'AIR' | 'VAC')[] = gasSide ? ['O2', 'O2', 'AIR', 'VAC', 'VAC'] : ['O2', 'AIR', 'VAC'];
  gases.forEach((k, i) => gasOutlet(g, k, -0.085, TOP - 0.08 - i * 0.15, zf));
  const socks = gasSide ? [false, false, true, true] : [false, false, false, false, true, true];
  socks.forEach((red, i) => socket(g, red, 0.09, TOP - 0.08 - i * (gasSide ? 0.17 : 0.125), zf));
  for (const s of [-1, 1]) for (const y of [TOP - 0.42, TOP - 0.8]) bx(g, 0.02, 0.03, 0.3, C.alu(), s * 0.18, y, 0);
  if (gasSide) {
    for (const dz of [-0.075, 0.075]) suctionUnit(sub(g, -0.19, TOP - 0.785, dz, 0, -PI / 2));
    flowmeter(sub(g, 0.19, TOP - 0.405, 0.02, 0, PI / 2));
  } else {
    // IV pole off the column top, two bags with lines dropping toward the patient
    cyl(g, 0.013, 0.6, C.chrome(), 0.12, TOP, -0.06, 10);
    tube(g, [[-0.04, 2.42, -0.06], [0.02, 2.5, -0.06], [0.22, 2.5, -0.06], [0.28, 2.42, -0.06]], 0.006, C.chrome(), 12, 6);
    for (const x of [0.01, 0.23]) {
      rb(g, 0.11, 0.18, 0.03, 0.01, C.canister(), x, 2.2, -0.06);
      decal(g, 'print', 'bag', [64, 96], drawFluidBag, 0.075, 0.11, x, 2.3, -0.042);
      cyl(g, 0.01, 0.05, C.line(), x, 2.14, -0.06, 8);
      tube(g, [[x, 2.14, -0.06], [x + 0.06, 1.7, 0.12], [x + 0.12, 1.25, 0.2], [x + 0.25, 0.95, 0.32]], 0.0025, C.line(), 16, 4);
    }
    sharpsBin(sub(g, 0.19, TOP - 0.62, 0, 0, PI / 2), 0, 0, 0.07, 0.16, 0.2, 0.11);
  }
}

/** large patient monitor on a swivel arm clamped round a pendant's drop tube (origin on the tube axis, base at p.y) */
function resusMonitor(out: BuiltProp) {
  const g = out.group;
  cyl(g, 0.085, 0.08, C.grey(), 0, 0.14, 0, 16);
  rb(g, 0.07, 0.045, 0.2, 0.015, C.grey(), 0, 0.16, 0.13);
  bx(g, 0.12, 0.12, 0.02, C.dark(), 0, 0.12, 0.235);
  rb(g, 0.68, 0.48, 0.07, 0.025, C.grey(), 0, 0, 0.28);
  bx(g, 0.632, 0.432, 0.01, C.black(), 0, 0.024, 0.315);
  screen(g, 0.6, 0.4, 0, 0.24, 0.323, 'monitor', out);
  rb(g, 0.5, 0.022, 0.02, 0.008, C.teal(), 0, 0.004, 0.31);
  add(g, G.sphere(0.006, 8, 6), C.led(), 0.3, 0.015, 0.318);
  rb(g, 0.3, 0.025, 0.035, 0.01, C.grey(), 0, 0.48, 0.28);
}

/** head offset (local x) and height of the procedure light's lamp head */
const LAMP: V3 = [0.65, 2.03, 0];
/** ceiling-arm LED procedure light: mount over the trolley, the arm reaching (local +x) to a lamp head over the chest */
function procLight(out: BuiltProp) {
  const g = out.group;
  const W = C.white();
  cyl(g, 0.17, 0.06, W, 0, 2.94, 0, 24, 0.19);
  cyl(g, 0.045, 0.3, W, 0, 2.64, 0, 12);
  cyl(g, 0.075, 0.09, C.grey(), 0, 2.56, 0, 16);
  add(g, G.rbox(0.44, 0.065, 0.075, 0.025, 1), W, 0.22, 2.6, 0);
  cyl(g, 0.045, 0.1, C.grey(), 0.42, 2.53, 0, 12);
  add(g, G.rbox(0.36, 0.055, 0.065, 0.02, 1), W, 0.535, 2.43, 0, 0, 0, -0.83);
  const hx = LAMP[0];
  cyl(g, 0.025, 0.14, C.grey(), hx, 2.16, 0, 10);
  cyl(g, 0.3, 0.09, W, hx, 2.08, 0, 32, 0.33);
  add(g, G.circle(0.3, 32), emitter('#fffaf2', 2.4), hx, 2.078, 0, PI / 2, 0, 0);
  add(g, G.torus(0.19, 0.008, 6, 32), C.grey(), hx, 2.074, 0, PI / 2, 0, 0);
  add(g, G.torus(0.09, 0.008, 6, 24), C.grey(), hx, 2.074, 0, PI / 2, 0, 0);
  cyl(g, 0.028, 0.1, C.grey(), hx, 1.98, 0, 12);
}

/** ICU ventilator on its trolley: breathing unit, tilted touchscreen (standby), circuit on a support arm with HME and test lung */
function ventilator(out: BuiltProp) {
  const g = out.group;
  rb(g, 0.56, 0.07, 0.5, 0.025, C.grey(), 0, 0.08, 0);
  wheels(g, [[-0.22, -0.19], [0.22, -0.19], [-0.22, 0.19], [0.22, 0.19]]);
  rb(g, 0.11, 0.64, 0.09, 0.02, C.white(), 0, 0.15, -0.1);
  rb(g, 0.4, 0.27, 0.34, 0.03, C.white(), 0, 0.79, -0.02);
  rb(g, 0.36, 0.2, 0.012, 0.006, C.grey(), 0, 0.82, 0.152);
  rod(g, 0.022, 0.05, C.grey(), 0.1, 0.9, 0.175, 'z', 12);
  rb(g, 0.09, 0.09, 0.06, 0.012, C.dark(), -0.1, 0.84, 0.17);
  rod(g, 0.022, 0.05, C.grey(), -0.1, 0.885, 0.215, 'z', 12);
  tube(g, [[-0.2, 0.95, -0.2], [-0.2, 1.08, -0.25], [0.2, 1.08, -0.25], [0.2, 0.95, -0.2]], 0.012, C.chrome(), 16, 6);
  // gas supply hoses (O₂ green, air yellow) coiled on the back for the pendant outlets
  tube(g, [[-0.1, 0.92, -0.19], [-0.14, 0.62, -0.3], [-0.04, 0.5, -0.32], [0.04, 0.62, -0.31], [0.0, 0.9, -0.24]], 0.008, C.o2(), 20, 6);
  tube(g, [[0.06, 0.92, -0.19], [0.1, 0.66, -0.3], [0.17, 0.56, -0.31], [0.21, 0.7, -0.3], [0.14, 0.92, -0.24]], 0.008, C.air(), 20, 6);
  cyl(g, 0.03, 0.06, C.grey(), 0, 1.06, -0.04, 10);
  const pod = sub(g, 0, 1.11, -0.03, -0.22, 0);
  rb(pod, 0.42, 0.32, 0.045, 0.02, C.white(), 0, 0, 0);
  bx(pod, 0.37, 0.25, 0.008, C.black(), 0, 0.05, 0.024);
  decal(pod, 'glow', 'vent', [448, 320], drawVent, 0.355, 0.2536, 0, 0.175, 0.031);
  rod(pod, 0.026, 0.03, C.grey(), 0.165, 0.025, 0.03, 'z', 16);
  // circuit: support arm, inspiratory (blue) and expiratory (clear) limbs to the Y-piece, HME filter, test lung
  tube(g, [[0.21, 0.95, -0.06], [0.27, 1.2, -0.02], [0.36, 1.38, 0.18], [0.42, 1.36, 0.42]], 0.011, C.alu(), 20, 8);
  tube(g, [[0.1, 0.9, 0.2], [0.14, 0.7, 0.36], [0.3, 0.74, 0.5], [0.42, 1.0, 0.52], [0.42, 1.25, 0.46]], 0.011, C.hose(), 24, 8);
  tube(g, [[-0.1, 0.885, 0.24], [-0.06, 0.66, 0.4], [0.24, 0.7, 0.58], [0.45, 0.98, 0.56], [0.43, 1.25, 0.46]], 0.011, C.line(), 24, 8);
  rb(g, 0.06, 0.05, 0.05, 0.015, C.white(), 0.42, 1.24, 0.46);
  cyl(g, 0.032, 0.05, C.white(), 0.42, 1.19, 0.46, 14);
  const lung = add(g, G.sphere(0.06, 14, 10), C.rubber(), 0.42, 1.07, 0.46);
  lung.scale.set(1, 1.45, 1);
}

/** infusion tower: two volumetric pumps and three syringe drivers on a pole, bags and lines */
function pumpTower(out: BuiltProp) {
  const g = out.group;
  starBase(g, 0.3);
  cyl(g, 0.05, 0.06, C.grey(), 0, 0.05, 0, 14, 0.06);
  cyl(g, 0.016, 2.0, C.chrome(), 0, 0.1, 0, 10);
  tube(g, [[-0.19, 2.04, 0], [-0.17, 2.11, 0], [0.17, 2.11, 0], [0.19, 2.04, 0]], 0.007, C.chrome(), 12, 6);
  for (const s of [-1, 1]) {
    rb(g, 0.12, 0.2, 0.035, 0.012, C.canister(), s * 0.15, 1.83, 0);
    decal(g, 'print', 'bag', [64, 96], drawFluidBag, 0.08, 0.12, s * 0.15, 1.93, 0.0205);
    cyl(g, 0.011, 0.06, C.line(), s * 0.15, 1.76, 0, 8);
    tube(g, [[s * 0.15, 1.76, 0], [s * 0.13, 1.45, 0.1], [s * 0.06, 1.24, 0.17], [s * 0.05, 1.1, 0.18]], 0.0025, C.line(), 16, 4);
  }
  bx(g, 0.05, 0.8, 0.03, C.grey(), 0, 0.86, 0.03);
  // stacked flush on the rail (thin gaps between them only collect ambient-occlusion noise)
  for (const y0 of [0.88, 1.045]) {
    rb(g, 0.2, 0.165, 0.15, 0.02, C.white(), 0, y0, 0.11);
    decal(g, 'print', 'pumpFace', [128, 104], drawPumpFace, 0.18, 0.146, 0, y0 + 0.0825, 0.188);
    add(g, G.sphere(0.005, 6, 4), C.led(), 0.085, y0 + 0.02, 0.187);
  }
  for (const y0 of [1.21, 1.295, 1.38]) {
    rb(g, 0.28, 0.085, 0.12, 0.015, C.white(), 0, y0, 0.1);
    decal(g, 'print', 'syrFace', [128, 28], drawSyringeFace, 0.25, 0.034, 0, y0 + 0.02, 0.163);
    // 50 mL syringe in its cradle on the front, plunger in the driver's clamp
    rod(g, 0.013, 0.12, C.canister(), -0.04, y0 + 0.06, 0.175, 'x', 12);
    rod(g, 0.004, 0.07, C.white(), 0.05, y0 + 0.06, 0.175, 'x', 6);
    rod(g, 0.017, 0.006, C.white(), 0.087, y0 + 0.06, 0.175, 'x', 12);
    bx(g, 0.02, 0.026, 0.03, C.grey(), 0.11, y0 + 0.047, 0.172);
    add(g, G.sphere(0.005, 6, 4), C.led(), 0.125, y0 + 0.015, 0.161);
  }
  // extension lines looping off toward the patient
  for (const [i, y] of [0.92, 1.1, 1.3].entries()) tube(g, [[0.09, y, 0.17], [0.16, y - 0.2, 0.28], [0.08, y - 0.34, 0.36 + i * 0.03], [-0.06, y - 0.2, 0.3]], 0.0025, C.line(), 18, 4);
}

/** crash cart: ABCDE drawers, tamper seal, check log, backboard, O₂ cylinder, sharps; manual defibrillator on top */
function defibCart(out: BuiltProp, id: string) {
  const g = out.group;
  rb(g, 0.72, 0.92, 0.55, 0.03, C.red(), 0, 0.12, 0);
  const drawers: [string, number][] = [['A', 0.14], ['B', 0.14], ['C', 0.17], ['D', 0.19], ['E', 0.22]];
  let top = 1.015;
  // each drawer slides out with its tray of airway kit, drugs, cannulas… (cabinetModels.ts, cabinets.ts)
  let drawerA: THREE.Group | null = null;
  for (const [k, h] of drawers) {
    const t0 = top;
    const part = cabPart(g, { kind: 'drawer', max: 0.38, handle: [0, t0 - 0.041, 0.298], grip: 'pull', size: [0.66, h - 0.012, 0.47], name: `drawer ${k}: ${CRASH_NAMES[k]}` }, [0, 0, 0], (d) => {
      rb(d, 0.66, h - 0.012, 0.014, 0.006, C.redFront(), 0, t0 - h + 0.006, 0.282);
      bx(d, 0.32, 0.018, 0.022, C.chrome(), 0, t0 - 0.05, 0.296);
      const [col, text] = DRAWERS[k];
      decal(d, 'print', `drawer|${k}`, [320, 40], drawTag(col, k, text), 0.3, 0.0375, 0, t0 - h / 2 - 0.016, 0.292);
      drawerInner(d, 'crash', k, 0.62, 0.47, t0 - h + 0.014, h - 0.05, 0.275, id);
    });
    drawerA ??= part;
    top -= h;
  }
  // the numbered breakaway seal across drawer A's top edge: opening the cart breaks it
  cabSeal(g, 0.19, 1.012, 0.292, sealNumber(id));
  if (drawerA) cabSealBroken(drawerA, 0.19, 1.0, 0.292);
  cabUnit(g, { role: 'crash', noun: 'crash cart', lock: 'seal', box: [-0.43, 0, -0.38, 0.4, 1.4, 0.3] });
  rb(g, 0.76, 0.035, 0.58, 0.012, C.dark(), 0, 1.04, 0);
  // push handle (left), CPR board (right), O₂ cylinder + sharps bin on the back
  tube(g, [[-0.37, 0.98, -0.2], [-0.42, 0.99, -0.18], [-0.42, 0.99, 0.18], [-0.37, 0.98, 0.2]], 0.013, C.chrome(), 16, 6);
  rb(g, 0.022, 0.8, 0.46, 0.008, C.yellow(), 0.375, 0.17, 0);
  cyl(g, 0.05, 0.48, C.cylinder(), 0.2, 0.36, -0.33, 14);
  cyl(g, 0.02, 0.06, C.o2(), 0.2, 0.84, -0.33, 12, 0.05);
  bx(g, 0.03, 0.04, 0.03, C.chrome(), 0.2, 0.9, -0.33);
  for (const y of [0.5, 0.74]) bx(g, 0.13, 0.025, 0.02, C.dark(), 0.2, y, -0.385);
  sharpsBin(sub(g, -0.18, 0.62, -0.275, 0, PI), 0, 0, 0.06, 0.18, 0.22, 0.12);
  // daily check log on a clipboard (left side)
  rb(g, 0.012, 0.3, 0.22, 0.004, C.dark(), -0.367, 0.5, 0.0);
  decal(g, 'print', 'checklog', [128, 176], drawCheckLog, 0.19, 0.26, -0.376, 0.65, 0.0, -PI / 2);
  wheels(g, [[-0.29, -0.21], [0.29, -0.21], [-0.29, 0.21], [0.29, 0.21]], 0.05);
  // manual defibrillator: screen (off), energy selector, buttons, carry handle, pads, cables
  const D0 = 1.075;
  rb(g, 0.38, 0.27, 0.3, 0.035, C.charcoal(), -0.06, D0, -0.04);
  bx(g, 0.2, 0.14, 0.008, C.black(), -0.115, D0 + 0.1, 0.111);
  decal(g, 'print', 'defibPanel', [96, 160], drawDefibPanel, 0.1, 0.167, 0.068, D0 + 0.135, 0.113);
  rod(g, 0.024, 0.022, C.grey(), 0.068, D0 + 0.225, 0.122, 'z', 16);
  add(g, G.sphere(0.006, 6, 4), C.led(), -0.205, D0 + 0.045, 0.112);
  tube(g, [[-0.18, D0 + 0.26, -0.06], [-0.17, D0 + 0.33, -0.05], [0.05, D0 + 0.33, -0.05], [0.06, D0 + 0.26, -0.06]], 0.014, C.dark(), 12, 6);
  rb(g, 0.19, 0.015, 0.14, 0.006, C.white(), 0.25, D0, 0.17);
  decal(g, 'print', 'pads', [160, 120], drawPads, 0.17, 0.125, 0.25, D0 + 0.018, 0.17, 0, -PI / 2);
  tube(g, [[-0.25, D0 + 0.08, 0.02], [-0.33, D0 - 0.02, 0.12], [-0.4, D0 - 0.24, 0.2], [-0.4, D0 - 0.4, 0.1], [-0.38, D0 - 0.16, 0.03]], 0.006, C.dark(), 24, 6);
}

/** airway trolley in Difficult Airway Society plan order (A–D + paediatric), video laryngoscope on its pole */
function airwayCart(out: BuiltProp, id: string) {
  const g = out.group;
  rb(g, 0.62, 0.86, 0.5, 0.03, C.grey(), 0, 0.12, 0);
  const rows: [string, number][] = [['A', 0.15], ['B', 0.15], ['C', 0.15], ['D', 0.17], ['P', 0.18]];
  let top = 0.955;
  // each drawer slides out with its plan's kit laid out in it (cabinetModels.ts, cabinets.ts)
  for (const [k, h] of rows) {
    const t0 = top;
    cabPart(g, { kind: 'drawer', max: 0.34, handle: [0, t0 - 0.037, 0.27], grip: 'pull', size: [0.57, h - 0.012, 0.42], name: `drawer ${k}: ${AIRWAY_NAMES[k]}` }, [0, 0, 0], (d) => {
      rb(d, 0.57, h - 0.012, 0.014, 0.006, C.blue(), 0, t0 - h + 0.006, 0.257);
      bx(d, 0.24, 0.016, 0.02, C.alu(), 0, t0 - 0.045, 0.27);
      const [col, letter, text] = PLANS[k];
      decal(d, 'print', `plan|${k}`, [320, 40], drawTag(col, letter, text), 0.3, 0.0375, 0, t0 - h / 2 - 0.014, 0.267);
      drawerInner(d, 'airway', k, 0.53, 0.42, t0 - h + 0.014, h - 0.05, 0.25, id);
    });
    top -= h;
  }
  cabUnit(g, { role: 'airway', noun: 'airway trolley', box: [-0.37, 0, -0.27, 0.37, 1.55, 0.27] });
  rb(g, 0.66, 0.03, 0.54, 0.012, C.white(), 0, 0.98, 0);
  bx(g, 0.66, 0.06, 0.015, C.white(), 0, 1.01, -0.262);
  for (const s of [-1, 1]) bx(g, 0.015, 0.06, 0.54, C.white(), s * 0.322, 1.01, 0);
  // video laryngoscope: screen on a pole at the back corner, handle with hyperangulated blade in its holster
  cyl(g, 0.014, 0.42, C.alu(), 0.24, 1.01, -0.22, 10);
  const vl = sub(g, 0.24, 1.43, -0.2, -0.15, -0.35);
  rb(vl, 0.2, 0.14, 0.035, 0.012, C.dark(), 0, -0.07, 0);
  bx(vl, 0.17, 0.11, 0.006, C.black(), 0, -0.055, 0.0175);
  rb(g, 0.055, 0.12, 0.05, 0.012, C.dark(), 0.14, 1.04, -0.2);
  cyl(g, 0.016, 0.14, C.dark(), 0.14, 1.12, -0.2, 10);
  add(g, G.torus(0.06, 0.008, 6, 12, PI / 2), C.grey(), 0.14, 1.32, -0.15, 0, PI / 2, 0);
  tube(g, [[0.14, 1.27, -0.21], [0.2, 1.12, -0.25], [0.24, 1.2, -0.24], [0.24, 1.36, -0.22]], 0.004, C.dark(), 12, 5);
  // bougies in a tube on the right, capnography line coiled on the left
  cyl(g, 0.025, 0.5, C.canister(), 0.345, 0.48, 0.13, 10);
  for (const d of [-0.008, 0.008]) cyl(g, 0.0035, 0.72, C.hose(), 0.345 + d, 0.42, 0.13 + d, 6);
  tube(g, [[-0.315, 0.9, 0.1], [-0.35, 0.72, 0.05], [-0.34, 0.6, -0.08], [-0.33, 0.8, -0.14], [-0.315, 0.92, -0.05]], 0.003, C.line(), 20, 5);
  wheels(g, [[-0.26, -0.19], [0.26, -0.19], [-0.26, 0.19], [0.26, 0.19]], 0.05);
}

/** headwall rail behind the trolley (wall prop, length p.w): gas outlets and sockets, two suction units, O₂ flowmeter, sharps bin */
function suctionRail(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const W = p.w ?? 2.0;
  bx(g, W, 0.06, 0.025, C.alu(), 0, 0.07, 0.0125);
  rb(g, 0.46, 0.17, 0.012, 0.006, C.boom(), -0.3, 0.3, 0.006);
  (['O2', 'AIR', 'VAC'] as const).forEach((k, i) => gasOutlet(g, k, -0.45 + i * 0.15, 0.45, 0.012));
  rb(g, 0.4, 0.17, 0.012, 0.006, C.boom(), 0.35, 0.3, 0.006);
  [false, false, true, true].forEach((red, i) => socket(g, red, 0.2 + i * 0.1, 0.43, 0.012));
  for (const x of [-0.25, 0.1]) suctionUnit(sub(g, x, 0.1, 0.025));
  flowmeter(sub(g, 0.62, 0.1, 0.025));
  sharpsBin(g, -0.78, -0.32, 0.075);
}

/** gloves S/M/L in a wall rack, hand rub, aprons and a large sharps bin (wall prop) */
function gloveStation(out: BuiltProp) {
  const g = out.group;
  bx(g, 0.44, 0.3, 0.012, C.alu(), -0.32, 0.0, 0.006);
  ['S', 'M', 'L'].forEach((s, i) => {
    const x = -0.46 + i * 0.14;
    rb(g, 0.125, 0.26, 0.085, 0.008, glove(s), x, 0.02, 0.055);
    decal(g, 'print', `glove|${s}`, [64, 128], drawGloveBox(s), 0.1, 0.2, x, 0.15, 0.1005);
    // the next glove's cuff out of the box's top (they dispense upward)
    add(g, G.sphere(0.016, 10, 8), lambert(GLOVES[s], { roughness: 0.5 }), x, 0.282, 0.055).scale.set(1.8, 0.7, 0.9);
  });
  // where a hand takes a pair (hygiene.ts): the M box's top
  const slot = new THREE.Object3D();
  slot.position.set(-0.32, 0.29, 0.055);
  slot.userData.hygPart = 'slot';
  g.add(slot);
  bx(g, 0.44, 0.012, 0.012, C.alu(), -0.32, 0.12, 0.104);
  rb(g, 0.11, 0.24, 0.1, 0.02, C.white(), 0.06, 0.02, 0.05);
  rb(g, 0.08, 0.05, 0.03, 0.01, lambert('#2bb3a3', { roughness: 0.4 }), 0.06, 0.07, 0.105);
  rb(g, 0.3, 0.16, 0.11, 0.02, C.white(), -0.32, -0.3, 0.055);
  bx(g, 0.24, 0.012, 0.004, C.dark(), -0.32, -0.29, 0.112);
  decal(g, 'print', 'apron', [128, 48], drawApron, 0.16, 0.06, -0.32, -0.2, 0.113);
  sharpsBin(g, 0.42, -0.45, 0.1, 0.3, 0.36, 0.18);
}

/** point-of-care ultrasound cart: console with three probes, screen on its arm (standby) */
function pocus(out: BuiltProp) {
  const g = out.group;
  rb(g, 0.5, 0.08, 0.58, 0.025, C.white(), 0, 0.08, 0);
  wheels(g, [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0.24], [0.2, 0.24]]);
  rb(g, 0.16, 0.64, 0.14, 0.03, C.grey(), 0, 0.16, -0.12);
  const con = sub(g, 0, 0.8, 0.02, 0.16, 0);
  rb(con, 0.56, 0.07, 0.42, 0.03, C.white(), 0, 0, 0);
  decal(con, 'print', 'usKeys', [320, 192], drawUsKeys, 0.44, 0.264, 0, 0.073, -0.02, 0, -PI / 2);
  add(con, G.sphere(0.022, 12, 8), C.dark(), 0, 0.072, 0.075);
  // probe cups on the right of the console: phased array, curvilinear, linear
  for (const [i, head] of (['phased', 'curved', 'linear'] as const).entries()) {
    const z = -0.12 + i * 0.12;
    cyl(con, 0.026, 0.07, C.grey(), 0.31, -0.03, z, 12, 0.022);
    rb(con, 0.032, 0.11, 0.026, 0.01, C.white(), 0.31, 0.03, z);
    if (head === 'curved') add(con, trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 10, 1, false, 0, PI)), C.dark(), 0.31, 0.135, z, PI / 2, 0, -PI / 2);
    else bx(con, head === 'linear' ? 0.05 : 0.026, 0.02, 0.016, C.dark(), 0.31, 0.135, z);
    tube(con, [[0.31, -0.03, z], [0.34, -0.25, z + 0.03], [0.28, -0.4, z - 0.02], [0.12, -0.35, -0.12]], 0.0045, C.dark(), 16, 5);
  }
  cyl(g, 0.02, 0.46, C.grey(), 0, 0.86, -0.17, 10);
  const scr = sub(g, 0, 1.3, -0.15, -0.12, 0);
  rb(scr, 0.52, 0.36, 0.04, 0.015, C.dark(), 0, 0, 0);
  decal(scr, 'glow', 'us', [384, 256], drawUs, 0.48, 0.32, 0, 0.18, 0.023);
  tube(g, [[-0.2, 0.86, -0.28], [-0.2, 0.95, -0.32], [0.2, 0.95, -0.32], [0.2, 0.86, -0.28]], 0.012, C.chrome(), 16, 6);
  cyl(g, 0.024, 0.15, C.white(), -0.3, 0.68, -0.05, 12);
  cyl(g, 0.012, 0.03, C.teal(), -0.3, 0.83, -0.05, 10);
  bx(g, 0.07, 0.02, 0.07, C.grey(), -0.3, 0.66, -0.05);
}

/** rapid infuser (warmed, air detection) on its stand, with an inline fluid warmer clamped below */
function rapidInfuser(out: BuiltProp) {
  const g = out.group;
  starBase(g, 0.32);
  cyl(g, 0.055, 0.06, C.grey(), 0, 0.05, 0, 14, 0.065);
  cyl(g, 0.019, 1.95, C.chrome(), 0, 0.1, 0, 10);
  tube(g, [[-0.22, 1.98, 0], [-0.2, 2.06, 0], [0.2, 2.06, 0], [0.22, 1.98, 0]], 0.007, C.chrome(), 12, 6);
  for (const s of [-1, 1]) {
    rb(g, 0.14, 0.24, 0.04, 0.014, C.canister(), s * 0.16, 1.74, 0);
    decal(g, 'print', 'bag', [64, 96], drawFluidBag, 0.09, 0.13, s * 0.16, 1.86, 0.023);
    tube(g, [[s * 0.16, 1.72, 0], [s * 0.12, 1.62, 0.06], [s * 0.05, 1.6, 0.12]], 0.004, C.line(), 10, 5);
  }
  rb(g, 0.32, 0.36, 0.26, 0.03, C.white(), 0, 0.96, 0.12);
  decal(g, 'print', 'riFace', [192, 216], drawRiFace, 0.28, 0.315, 0, 1.14, 0.253);
  add(g, G.sphere(0.006, 6, 4), C.led(), 0.13, 0.985, 0.252);
  cyl(g, 0.065, 0.24, C.canister(), 0.08, 1.32, 0.12, 16);
  cyl(g, 0.07, 0.02, C.teal(), 0.08, 1.56, 0.12, 16);
  rb(g, 0.06, 0.26, 0.05, 0.012, C.teal(), -0.19, 0.98, 0.14);
  tube(g, [[-0.19, 0.98, 0.16], [-0.12, 0.8, 0.3], [0.05, 0.84, 0.38], [0.2, 0.96, 0.34]], 0.004, C.line(), 16, 5);
  rb(g, 0.12, 0.18, 0.08, 0.02, C.grey(), 0, 0.66, 0.055);
  decal(g, 'print', 'fwFace', [96, 144], drawFwFace, 0.104, 0.156, 0, 0.75, 0.098);
  add(g, G.sphere(0.005, 6, 4), C.led(), 0.042, 0.69, 0.097);
}

/** forced-air warming unit on a rolling stand: preset panel, coiled hose, folded blankets */
function warmer(out: BuiltProp) {
  const g = out.group;
  starBase(g, 0.24);
  cyl(g, 0.045, 0.05, C.grey(), 0, 0.05, 0, 12);
  cyl(g, 0.018, 0.64, C.chrome(), 0, 0.09, 0, 10);
  bx(g, 0.3, 0.015, 0.22, C.alu(), 0, 0.4, 0.04);
  rb(g, 0.26, 0.07, 0.19, 0.02, C.blanket(), 0, 0.415, 0.04);
  rb(g, 0.34, 0.27, 0.25, 0.04, C.white(), 0, 0.72, 0.03);
  bx(g, 0.345, 0.03, 0.255, C.blue(), 0, 0.8, 0.03);
  decal(g, 'print', 'faw', [192, 96], drawFaw, 0.26, 0.13, 0, 0.905, 0.158);
  // hose outlet clear of the accent band below it
  rod(g, 0.04, 0.05, C.grey(), 0.19, 0.852, 0.03, 'x', 14);
  tube(g, [[0.2, 0.84, 0.03], [0.32, 0.66, 0.1], [0.3, 0.38, 0.26], [0.1, 0.24, 0.32], [-0.14, 0.3, 0.28], [-0.24, 0.55, 0.16], [-0.12, 0.7, 0.08]], 0.033, C.hose(), 40, 10);
}

/** mechanical CPR device (piston arch + backplate) on a wall shelf, yellow CPR board on a hook beside it (wall prop) */
function cprDevice(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const m = p.label === 'mirror' ? -1 : 1;
  bx(g, 0.64, 0.025, 0.36, C.alu(), 0, 0.42, 0.18);
  for (const s of [-1, 1]) bx(g, 0.025, 0.12, 0.3, C.alu(), s * 0.28, 0.3, 0.15);
  rb(g, 0.58, 0.44, 0.04, 0.02, C.dark(), 0, 0.445, 0.04);
  for (const s of [-1, 1]) rb(g, 0.07, 0.48, 0.1, 0.02, C.dark(), s * 0.25, 0.445, 0.2);
  rb(g, 0.6, 0.17, 0.22, 0.05, C.dark(), 0, 0.88, 0.2);
  rb(g, 0.27, 0.12, 0.012, 0.006, C.grey(), 0, 0.905, 0.312);
  decal(g, 'print', 'cprPanel', [176, 80], drawCprPanel, 0.25, 0.114, 0, 0.965, 0.321);
  cyl(g, 0.032, 0.2, C.grey(), 0, 0.68, 0.2, 12);
  cyl(g, 0.075, 0.04, C.canister(), 0, 0.64, 0.2, 18, 0.085);
  rb(g, 0.5, 0.62, 0.025, 0.02, C.yellow(), m * 0.64, 0.32, 0.016);
  decal(g, 'print', 'cprBoard', [160, 200], drawCprBoard, 0.44, 0.55, m * 0.64, 0.63, 0.0315);
  bx(g, 0.06, 0.04, 0.05, C.alu(), m * 0.64, 0.92, 0.025);
}

/** resus clock (wall prop): analog face (live, added by dressResusSuite) over an elapsed timer, reset */
const CLOCK_Y = 0.62;
function resusClock(out: BuiltProp) {
  const g = out.group;
  rod(g, 0.18, 0.05, C.black(), 0, CLOCK_Y, 0.025, 'z', 32);
  rb(g, 0.4, 0.14, 0.05, 0.015, C.black(), 0, 0.3, 0.025);
  decal(g, 'glow', 'timer', [256, 88], drawTimer, 0.36, 0.124, 0, 0.37, 0.053);
  const keys = [C.o2(), C.sharps(), C.sock()];
  keys.forEach((mat, i) => bx(g, 0.05, 0.022, 0.012, mat, -0.09 + i * 0.09, 0.255, 0.006));
  decal(g, 'print', 'timerKeys', [192, 24], drawTimerKeys, 0.27, 0.034, 0, 0.234, 0.0125);
}

/** team-roles whiteboard (wall prop, width p.w, title p.label) */
function teamBoard(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const W = p.w ?? 1.5;
  const H = 0.95;
  rb(g, W + 0.04, H + 0.04, 0.025, 0.01, C.alu(), 0, 0, 0.0125);
  decal(g, 'print', `board|${p.label ?? 'RESUS'}`, [960, 608], drawBoard(p.label ?? 'RESUS'), W, H, 0, 0.02 + H / 2, 0.028);
  bx(g, W * 0.85, 0.022, 0.06, C.alu(), 0, -0.03, 0.04);
  [C.black(), C.sharps(), C.teal(), C.o2()].forEach((mat, i) => rod(g, 0.008, 0.12, mat, -0.45 + i * 0.16, 0.0, 0.045, 'x', 8));
  rb(g, 0.12, 0.03, 0.05, 0.01, C.dark(), 0.45, -0.008, 0.045);
}

/** mobile digital X-ray, parked: drive wheels, generator body, detector bin, column, arm, tube head and collimator */
function mobileXray(out: BuiltProp) {
  const g = out.group;
  rb(g, 0.58, 0.18, 1.15, 0.04, C.white(), 0, 0.08, 0);
  for (const s of [-1, 1]) {
    rod(g, 0.15, 0.06, C.rubber(), s * 0.31, 0.15, -0.4, 'x', 20);
    rod(g, 0.07, 0.065, C.grey(), s * 0.31, 0.15, -0.4, 'x', 14);
    add(g, G.cyl(0.055, 0.055, 0.035, 12), C.rubber(), s * 0.2, 0.055, 0.46, 0, 0, PI / 2);
    bx(g, 0.043, 0.064, 0.04, C.chrome(), s * 0.2, 0.076, 0.46);
  }
  rb(g, 0.56, 0.72, 0.6, 0.05, C.white(), 0, 0.26, -0.27);
  bx(g, 0.565, 0.05, 0.605, C.grey(), 0, 0.64, -0.27);
  rb(g, 0.5, 0.42, 0.08, 0.015, C.grey(), 0, 0.36, 0.08);
  for (const z of [0.065, 0.095]) rb(g, 0.44, 0.38, 0.02, 0.008, C.dark(), 0, 0.5, z);
  tube(g, [[-0.25, 0.92, -0.58], [-0.25, 1.04, -0.64], [0.25, 1.04, -0.64], [0.25, 0.92, -0.58]], 0.017, C.grey(), 16, 8);
  const con = sub(g, 0, 1.0, -0.47, 0.5, PI);
  rb(con, 0.3, 0.2, 0.03, 0.012, C.grey(), 0, 0, 0);
  bx(con, 0.25, 0.15, 0.006, C.black(), 0, 0.025, 0.017);
  bx(g, 0.08, 0.012, 0.006, C.led(), 0.12, 0.93, -0.576);
  rb(g, 0.13, 0.62, 0.13, 0.025, C.white(), 0, 0.98, -0.12);
  rb(g, 0.11, 0.1, 0.72, 0.03, C.white(), 0, 1.5, 0.22);
  bx(g, 0.06, 0.06, 0.06, C.grey(), 0, 1.44, 0.6);
  rod(g, 0.085, 0.3, C.white(), 0, 1.36, 0.6, 'x', 16);
  bx(g, 0.06, 0.03, 0.06, C.grey(), 0, 1.25, 0.6);
  rb(g, 0.2, 0.13, 0.19, 0.02, C.grey(), 0, 1.12, 0.6);
  bx(g, 0.13, 0.006, 0.13, C.black(), 0, 1.114, 0.6);
  for (const s of [-1, 1]) bx(g, 0.02, 0.05, 0.12, C.dark(), s * 0.11, 1.15, 0.6);
  decal(g, 'print', 'xrayWarn', [96, 72], drawXrayWarn, 0.11, 0.0825, 0, 1.185, 0.698);
  for (const s of [-1, 1]) decal(g, 'print', 'xraySide', [256, 96], drawXraySide, 0.34, 0.1275, s * 0.283, 0.84, -0.27, (s * PI) / 2);
}

/** stock bins on the resus supply shelves: label, tag colour (IV cannulae carry their ISO 10555 gauge colour) */
const BINS: [string, string][][] = [
  [['IV CANNULA 14G', '#e8822a'], ['IV CANNULA 16G', '#8d959b'], ['IV CANNULA 18G', '#3aa36a'], ['IV CANNULA 20G', '#e78fb3'], ['IO NEEDLES', '#c0392b'], ['BLOOD CULTURES', '#6b4fb3']],
  [['LIMB TOURNIQUETS', '#1b1e21'], ['PELVIC BINDER', '#2a72bd'], ['HAEMOSTATIC GAUZE', '#2e8b57'], ['CHEST DRAIN', '#d35400'], ['BLOOD TUBES', '#8e5ec4'], ['ECG ELECTRODES', '#5b6b7a']],
];
const drawBin = (text: string, tag: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tag;
  ctx.fillRect(0, 0, h * 0.5, h);
  fit(ctx, text, h * 0.62, h / 2 + 1, w - h * 0.7, h * 0.46, 700, 'left', '#1b1e21');
};

/** wall shelves with labelled stock bins (wall prop, width p.w, two rows) */
function binShelf(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const W = p.w ?? 1.3;
  const mats = [C.blue(), C.grey(), C.teal()];
  for (const s of [-1, 1]) bx(g, 0.03, 0.62, 0.03, C.alu(), s * (W / 2 - 0.02), -0.04, 0.015);
  BINS.forEach((row, r) => {
    const y = r * 0.33;
    bx(g, W, 0.02, 0.3, C.alu(), 0, y - 0.02, 0.15);
    const n = row.length;
    const bw = (W - 0.06) / n;
    row.forEach(([label, tag], i) => {
      const x = -W / 2 + 0.03 + bw * (i + 0.5);
      rb(g, bw - 0.012, 0.15, 0.27, 0.01, mats[(i + r) % mats.length], x, y, 0.15);
      decal(g, 'print', `bin|${label}`, [192, 40], drawBin(label, tag), bw - 0.03, 0.034, x, y + 0.095, 0.288);
    });
  });
}

/** vinyl stretcher bumper rail on aluminium retainer at 0.8 m (wall prop, length p.w) */
function bumperRail(p: PropDef, out: BuiltProp) {
  const g = out.group;
  const W = p.w ?? 2;
  bx(g, W, 0.12, 0.015, C.alu(), 0, 0.79, 0.0075);
  rb(g, W - 0.04, 0.1, 0.03, 0.012, C.grey(), 0, 0.8, 0.027);
  // end caps 3 mm larger than the retainer all round (flush, their faces flickered with its ends)
  for (const s of [-1, 1]) rb(g, 0.036, 0.126, 0.047, 0.012, C.dark(), s * (W / 2 - 0.015), 0.787, 0.0235);
}

const BUILDERS: Record<string, (p: PropDef, out: BuiltProp) => void> = {
  pendant,
  resusMonitor: (_p, out) => resusMonitor(out),
  procLight: (_p, out) => procLight(out),
  ventilator: (_p, out) => ventilator(out),
  pumpTower: (_p, out) => pumpTower(out),
  defibCart: (p, out) => defibCart(out, p.id),
  airwayCart: (p, out) => airwayCart(out, p.id),
  suctionRail,
  gloveStation: (_p, out) => gloveStation(out),
  pocus: (_p, out) => pocus(out),
  rapidInfuser: (_p, out) => rapidInfuser(out),
  warmer: (_p, out) => warmer(out),
  cprDevice,
  resusClock: (_p, out) => resusClock(out),
  teamBoard,
  mobileXray: (_p, out) => mobileXray(out),
  binShelf,
  bumperRail,
};

/** the prop kinds built here */
export const RESUS_KINDS = new Set(Object.keys(BUILDERS));
/** ceiling-hung / wall-mounted kinds: the builder's tall layer (hidden in the top-down cutaway, where they would float) */
export const RESUS_TALL = ['pendant', 'procLight', 'resusMonitor', 'suctionRail', 'gloveStation', 'resusClock', 'teamBoard', 'binShelf'];

/** props.ts hook: builds p if it is resus equipment (true), else leaves it to props.ts (false) */
export function buildResusProp(p: PropDef, out: BuiltProp): boolean {
  const b = BUILDERS[p.kind];
  if (!b) return false;
  b(p, out);
  return true;
}

/** rooms whose procedure light replaces the builder's exam spotlight (so they add no shadow-casting light) */
export function resusLitRooms(layout: LayoutDef): Set<string> {
  return new Set(layout.props.filter((p) => p.kind === 'procLight').map((p) => p.room));
}

// ───────────────────────────── inspect texts ─────────────────────────────

/** FIXTURE_INFO entries (items.ts) — what [E] shows for each piece of resus equipment */
export const RESUS_INFO: Record<string, { title: string; desc: string }> = {
  pendant: {
    title: 'Supply pendant',
    desc: 'Ceiling boom that brings the bed space to the head of the trolley: O₂, medical air and vacuum outlets (US colour code: green, yellow, white; each connector is gas-specific, so a hose fits only its own gas), normal and red emergency-power sockets, rails and a shelf. It swings aside, so the floor stays clear for the team, the X-ray and the stretcher.',
  },
  ventilator: {
    title: 'ICU ventilator',
    desc: 'In standby after its pre-use check, with a fresh circuit, HME filter and test lung. After intubation start lung-protective: volume control, tidal volume 6–8 mL/kg predicted body weight (PBW = 50 for men or 45.5 for women + 0.91 × (height in cm − 152.4)), PEEP 5, FiO₂ 1.0, then wean to SpO₂ 94–98%; keep the plateau pressure under 30 cmH₂O. Waveform capnography on every tube.',
  },
  pumpTower: {
    title: 'Infusion tower',
    desc: 'Two volumetric pumps and three syringe drivers on one pole, drug library loaded. Run vasopressors through their own line (central when you can) and label every line at both ends. Keep syringe drivers level with or below the patient with an anti-siphon valve: a syringe that slips out of its clamp above the patient can empty itself by gravity.',
  },
  defibCart: {
    title: 'Crash cart with defibrillator',
    desc: 'Manual biphasic defibrillator with pads, ECG, SpO₂ and EtCO₂. VF/pulseless VT: shock 150–200 J (escalate if the device allows) and go straight back to 2 min of CPR; adrenaline (epinephrine) 1 mg every 3–5 min, amiodarone 300 mg after the third shock and 150 mg after the fifth. Synchronized cardioversion: 120–150 J for AF or broad-complex tachycardia, 70–120 J for flutter and regular narrow-complex. Drawers A–E follow ABCDE; seal number and daily check are logged on the side.',
  },
  airwayCart: {
    title: 'Airway trolley',
    desc: 'Laid out in Difficult Airway Society order. A: tracheal intubation (video laryngoscope with hyperangulated and Macintosh blades, bougie, stylet, tubes 6.0–8.0). B: supraglottic airways. C: face-mask oxygenation. D: front of neck access (scalpel, bougie, 6.0 cuffed tube). Pre-oxygenate for 3 min, no more than three attempts at laryngoscopy (plus one by someone more experienced), and say "can\'t intubate, can\'t oxygenate" out loud when it is time for plan D.',
  },
  suctionRail: {
    title: 'Wall suction',
    desc: 'Two vacuum regulators with 1 L canisters and an O₂ flowmeter on the headwall. Check suction is on and connected before induction. Full vacuum with a large-bore rigid sucker for vomit or blood in the airway; through a tracheal tube, −100 to −150 mmHg (−13 to −20 kPa) for under 15 s at a time.',
  },
  pocus: {
    title: 'Ultrasound',
    desc: 'Phased-array, curvilinear and linear probes. eFAST: pericardium, hepatorenal and splenorenal spaces, pelvis, and both hemithoraces for haemothorax and pneumothorax (no lung sliding). In a haemodynamically unstable trauma patient, a positive FAST means the operating room, not the CT scanner.',
  },
  rapidInfuser: {
    title: 'Rapid infuser and fluid warmer',
    desc: 'Warms blood and fluids and pumps them at up to about 1 L/min, stopping on air detection; the inline warmer below is for ordinary lines. In major haemorrhage give blood, not crystalloid: plasma and red cells about 1:1 with platelets, and tranexamic acid 1 g within 3 h of injury. Cold fluids feed the lethal triad of hypothermia, acidosis and coagulopathy.',
  },
  warmer: {
    title: 'Forced-air warming unit',
    desc: 'Blows warm air (32, 38 or 43 °C) into a disposable blanket. Always connect it to a blanket: a hose blowing under the sheets on its own ("free-hosing") burns. Below 35 °C, trauma coagulopathy gets worse, so measure core temperature, not the forehead.',
  },
  cprDevice: {
    title: 'Mechanical CPR device',
    desc: 'Piston device on a backplate: 100–120 compressions/min at 5–6 cm, without tiring, for transport, prolonged resuscitation, the cath lab or ECPR. It is not better than good manual CPR, so keep compressing while it goes on and keep that pause under 10 s. The yellow board is for manual CPR on the soft trolley mattress.',
  },
  procLight: {
    title: 'Procedure light',
    desc: 'Ceiling-arm LED light with a cool, shadow-reduced beam and a centre handle that takes a sterile cover. Position it before you start a chest drain, a central line or a thoracotomy, not halfway through.',
  },
  mobileXray: {
    title: 'Mobile X-ray',
    desc: 'Portable digital radiography with wireless flat-panel detectors. In major trauma the chest film (and the pelvis when indicated) is taken on the trolley within minutes; a supine film hides a pneumothorax, look for a deep sulcus sign. Step at least 2 m back when the radiographer calls "X-ray": dose falls with the square of the distance.',
  },
  gloveStation: {
    title: 'Gloves and sharps',
    desc: 'Nitrile gloves S, M and L, aprons, hand rub and a sharps bin at every bed space. Gloves on before the patient arrives. Drop sharps in the bin where you use them, never re-sheathe, and close the bin at the fill line (about three-quarters full).',
  },
  resusClock: {
    title: 'Resus clock',
    desc: 'Wall clock with an elapsed timer that the scribe starts when the patient comes through the door. Times are what resus notes most often lack: arrival, intubation, every shock and drug, tourniquet on, and the 2-minute rhythm checks during CPR.',
  },
  binShelf: {
    title: 'Supply shelves',
    desc: 'Labelled bins, restocked after every patient. IV cannulae carry the standard gauge colours (14G orange, 16G grey, 18G green, 20G pink, 22G blue). In a bleeding patient, two short large-bore lines (16G or bigger): flow rises with the fourth power of the radius and falls with length (Poiseuille), so a short wide cannula outruns a long central line.',
  },
  teamBoard: {
    title: 'Team roles board',
    desc: 'Roles are given out at the pre-alert, before the patient arrives: team lead (at the foot, hands off), airway, circulation, meds and scribe, with names, so every order goes to a person ("Anna, adrenaline 1 mg IV now") and is read back when done. That is closed-loop communication.',
  },
};

// ───────────────────────────── builder.ts hook: colliders, inspect boxes, lights, clocks ─────────────────────────────

/** inspect box per kind, [x0, y0, z0, x1, y1, z1] in the prop's frame (wall props: y from p.y) */
const HIT: Record<string, number[]> = {
  pendant: [-0.36, 0.86, -0.18, 0.36, 1.95, 0.32],
  procLight: [0.3, 1.95, -0.36, 1.0, 2.2, 0.36],
  ventilator: [-0.3, 0.05, -0.3, 0.48, 1.48, 0.6],
  pumpTower: [-0.3, 0.05, -0.3, 0.3, 2.15, 0.3],
  defibCart: [-0.43, 0.05, -0.38, 0.4, 1.4, 0.3],
  airwayCart: [-0.37, 0.05, -0.27, 0.37, 1.55, 0.27],
  suctionRail: [-1.0, -0.4, 0, 1.0, 0.5, 0.2],
  gloveStation: [-0.54, -0.46, 0, 0.58, 0.3, 0.2],
  pocus: [-0.33, 0.05, -0.35, 0.36, 1.68, 0.35],
  rapidInfuser: [-0.32, 0.05, -0.32, 0.32, 2.12, 0.32],
  warmer: [-0.3, 0.05, -0.25, 0.34, 1.0, 0.34],
  cprDevice: [-0.95, 0.3, 0, 0.95, 1.06, 0.36],
  resusClock: [-0.21, 0.22, 0, 0.21, 0.8, 0.08],
  teamBoard: [-0.78, -0.05, 0, 0.78, 1.0, 0.07],
  binShelf: [-0.66, -0.05, 0, 0.66, 0.5, 0.3],
  mobileXray: [-0.34, 0.0, -0.66, 0.34, 1.6, 0.7],
};
/** floor footprint per kind, [x0, z0, x1, z1] in the prop's frame (not the pendants' arms or the ventilator's circuit) */
const FOOT: Record<string, number[]> = {
  pendant: [-0.36, -0.16, 0.3, 0.3],
  ventilator: [-0.3, -0.3, 0.3, 0.27],
  pumpTower: [-0.28, -0.28, 0.28, 0.28],
  defibCart: [-0.43, -0.38, 0.4, 0.3],
  airwayCart: [-0.37, -0.27, 0.37, 0.27],
  pocus: [-0.27, -0.33, 0.3, 0.33],
  rapidInfuser: [-0.3, -0.3, 0.3, 0.3],
  warmer: [-0.24, -0.24, 0.3, 0.32],
  cprDevice: [-0.95, 0, 0.95, 0.36],
  mobileXray: [-0.34, -0.66, 0.34, 0.7],
};

/** a point in a prop's frame → world */
function toWorld(p: PropDef, x: number, y: number, z: number): THREE.Vector3 {
  const r = p.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new THREE.Vector3(p.x + x * c + z * s, (p.y ?? 0) + y, p.z - x * s + z * c);
}
function worldBox(p: PropDef, b: number[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) box.expandByPoint(toWorld(p, x, y, z));
  return box;
}

export interface ResusExtras {
  colliders: THREE.Box3[];
  interactables: Interactable[];
  fixtures: Fixture[];
}

/**
 * builder.ts hook, after the props are built: floor colliders for the equipment (footprints only, so
 * people walk under the pendant arms), inspect boxes, the procedure lights for the lighting rig, and
 * a live analog face for each resus clock (ticked by the world with the other clocks).
 */
export function dressResusSuite(layout: LayoutDef, tall: THREE.Group, clocks: Clock[]): ResusExtras {
  const out: ResusExtras = { colliders: [], interactables: [], fixtures: [] };
  for (const p of layout.props) {
    if (!RESUS_KINDS.has(p.kind)) continue;
    const f = FOOT[p.kind];
    if (f) {
      const box = worldBox(p, [f[0], 0, f[1], f[2], 2, f[3]]);
      box.min.y = 0;
      out.colliders.push(box);
    }
    const hit = HIT[p.kind];
    const info = RESUS_INFO[p.kind];
    if (hit && info) {
      const box = worldBox(p, hit);
      out.interactables.push({ key: `fx:${p.id}`, target: { kind: 'inspect', subject: p.kind, label: `Inspect ${info.title.toLowerCase()}` }, box, center: box.getCenter(new THREE.Vector3()) });
    }
    if (p.kind === 'procLight') {
      const at = toWorld(p, LAMP[0], LAMP[1], LAMP[2]);
      out.fixtures.push({ x: at.x, y: at.y, z: at.z, room: p.room, kind: 'procedure' });
    }
    if (p.kind === 'resusClock') {
      const { canvas, ctx } = makeCanvas(256, 256);
      const tex = canvasTexture(canvas);
      const face = add(tall, G.circle(0.16, 32), own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 })), 0, 0, 0, 0, p.rot ?? 0, 0);
      face.position.copy(toWorld(p, 0, CLOCK_Y, 0.053));
      face.userData.noMerge = true;
      clocks.push({ ctx, tex, last: '' });
    }
  }
  return out;
}

/**
 * The CT suite and the X-ray room, equipped as they are in a hospital (generic, no brands):
 *
 * CT scan room: the gantry (78 cm bore with its scan-window band, front and back bezels, the couch
 * controls and an emergency stop on the front cover, the positioning lasers' apertures, a display
 * for the breathing instructions) and the couch (base, lifting column, upper body, carbon-fibre
 * cradle with its pad, head holder and straps); a dual-syringe power injector on its stand; oxygen and
 * suction; lead aprons on a rack; a supply cabinet; a hand-wash sink. A lead-lined partition with a
 * lead-glass window and a connecting door separates the control room: the console (three monitors,
 * the scan control box with its START and STOP keys, the intercom microphone, the injector's remote),
 * the radiographer's chair, a contrast warmer, supplies and the contrast-reaction card.
 *
 * X-ray room: a floating-top table with its bucky tray, a ceiling-mounted tube on rails (bridge,
 * carriage, telescopic column, tube housing and collimator with its light field), a chest wall stand,
 * a lead-screened control booth (lead glass, the acquisition console, the generator's control panel,
 * the two-stage hand switch), the generator cabinet, portable detectors, positioning aids (foam pads,
 * sandbags, a compression band), aprons, a changing cubicle. Outside both: the "X-RAY IN USE" light
 * and the radiation and pregnancy signs.
 *
 * Builders follow props.ts (origin on the floor at the prop's (x, z), front facing +z; wall props on
 * the wall face, local y from p.y) and draw every printed label into one canvas atlas. What moves —
 * the couch and cradle, the lasers, the injector's plungers and line, the tube crane, the wall stand's
 * detector, the bucky, the warning lights, the screens — is built once by dressImagingSuite (props are
 * built twice: once more for their inspect boxes) and handed to imagingLife.ts as an ImagingRig.
 *
 * Hooks: props.ts (buildImagingProp, surfaceHeight), builder.ts (IMAGING_TALL, dressImagingSuite),
 * items.ts (IMAGING_INFO), shared/layout.ts (placement), World.ts (imagingLife.ts).
 */
import * as THREE from 'three';
import type { LayoutDef, PropDef, RoomDef } from '../../../shared/layout';
import type { Interactable } from './builder';
import { G, add, boxB, canvasTexture, cylB, emitter, glass, lambert, makeCanvas, own, pbr, trackGeo, tube } from './materials';
import type { BuiltProp } from './props';
import { CT, XR } from './imagingPlan';

const PI = Math.PI;
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

// ───────────────────────────── materials (cached; shared with props.ts / resusGear.ts where the keys match) ─────────────────────────────

const plastic = (c: string, rough = 0.42) => pbr('plastic', { color: c, tile: 0.3, roughness: rough, normalScale: 0.3, worldUV: true });
const C = {
  shell: () => plastic('#eef0f1', 0.3),
  grey: () => plastic('#d9dde0', 0.35),
  panel: () => plastic('#cfd6dc', 0.35),
  slate: () => plastic('#56616b', 0.4),
  trim: () => plastic('#8d99a3', 0.38),
  charcoal: () => plastic('#2d3236', 0.45),
  carbon: () => lambert('#24282c', { roughness: 0.32, metalness: 0.25 }),
  pad: () => pbr('vinyl', { color: '#a9c2d2', tile: 0.35, roughness: 0.85, normalScale: 0.5 }),
  vinyl: (c: string) => pbr('vinyl', { color: c, tile: 0.35, roughness: 0.85, normalScale: 0.5 }),
  alu: () => lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 }),
  chrome: () => lambert('#d9dde0', { roughness: 0.16, metalness: 1 }),
  dark: () => lambert('#2b3034', { roughness: 0.45 }),
  black: () => lambert('#16191b', { roughness: 0.32 }),
  rubber: () => pbr('rubber', { color: '#2a2d30', tile: 0.2, roughness: 0.9 }),
  laminate: (c: string) => lambert(c, { roughness: 0.45 }),
  metal: (c: string) => lambert(c, { roughness: 0.4, metalness: 0.3 }),
  fabric: (c: string) => pbr('fabric_seat', { color: c, tile: 0.4, roughness: 1 }),
  linen: (c: string) => pbr('fabric_curtain', { color: c, tile: 0.25, roughness: 1, normalScale: 0.6 }),
  red: () => lambert('#c8302c', { roughness: 0.4 }),
  yellow: () => lambert('#f2c230', { roughness: 0.45 }),
  o2: () => lambert('#2f8f46', { roughness: 0.4 }),
  vac: () => lambert('#f2f2f2', { roughness: 0.4 }),
  canister: () => lambert('#e3eef2', { roughness: 0.22 }),
  led: (c = '#3fb950') => lambert(c, { emissive: c, emissiveIntensity: 2 }),
  // the builder's own wall finish, frames, door leaves, kick plates and cove base (builder.ts): the same cached materials
  wall: (c: string) => pbr('wall_paint', { color: c, tile: 1.6, roughness: 0.95, normalScale: 0.35 }),
  frame: () => lambert('#c4cbd0', { roughness: 0.38, metalness: 0.35 }),
  door: () => pbr('wood', { color: '#e8d7bd', tile: 1.6, roughness: 0.7 }),
  kick: () => pbr('steel', { tile: 0.5, roughness: 0.9 }),
  base: () => pbr('rubber', { color: '#5b6064', tile: 0.5, roughness: 0.8 }),
  // lead glass: a faint grey-amber tint
  leadGlass: () => glass('#dcdccb', 0.2),
};

// ───────────────────────────── geometry helpers ─────────────────────────────

/** rounded box with one bevel band, bottom at y0 */
function rb(g: THREE.Object3D, w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y0: number, z: number, ry = 0): THREE.Mesh {
  return add(g, G.rbox(w, h, d, r, 1), mat, x, y0 + h / 2, z, 0, ry, 0);
}
const bx = boxB;
const cyl = cylB;
/** cylinder lying along x or z, centred at (x, y, z) */
function rod(g: THREE.Object3D, r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'z', seg = 12): THREE.Mesh {
  return add(g, G.cyl(r, r, len, seg), mat, x, y, z, axis === 'z' ? PI / 2 : 0, 0, axis === 'x' ? PI / 2 : 0);
}
function sub(g: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Group {
  const s = new THREE.Group();
  s.position.set(x, y, z);
  s.rotation.set(rx, ry, rz);
  g.add(s);
  return s;
}
function wheels(g: THREE.Object3D, pts: [number, number][], r = 0.04) {
  for (const [x, z] of pts) {
    add(g, G.cyl(r, r, 0.028, 12), C.rubber(), x, r, z, 0, 0, PI / 2);
    bx(g, 0.036, 0.045, 0.034, C.chrome(), x, r * 1.4, z);
  }
}
function starBase(g: THREE.Object3D, R: number) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + PI / 10;
    add(g, G.rbox(R, 0.03, 0.045, 0.01, 1), C.dark(), (Math.cos(a) * R) / 2, 0.075, (Math.sin(a) * R) / 2, 0, -a, 0);
    wheels(g, [[Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95]], 0.032);
  }
}
/** office chair, front +z (seat top at 0.48) */
function officeChair(g: THREE.Object3D, x: number, z: number, ry: number, color = '#3c4247') {
  const c = sub(g, x, 0, z, 0, ry);
  const mesh = C.fabric(color);
  rb(c, 0.5, 0.075, 0.48, 0.03, mesh, 0, 0.405, 0.02);
  rb(c, 0.46, 0.5, 0.06, 0.04, mesh, 0, 0.56, -0.24);
  for (const s of [-1, 1]) {
    rb(c, 0.04, 0.2, 0.05, 0.015, C.black(), s * 0.27, 0.41, 0.05);
    rb(c, 0.07, 0.025, 0.26, 0.012, C.black(), s * 0.27, 0.61, 0.05);
  }
  cyl(c, 0.025, 0.3, C.chrome(), 0, 0.1, 0, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    add(c, G.rbox(0.3, 0.03, 0.04, 0.012), C.black(), Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15, 0, -a, 0);
    add(c, G.sphere(0.03, 8, 6), C.black(), Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29);
  }
}
/** a monitor's bezel and stand on a desk (screen centred at local (0, cy, 0.013) facing +z; the screen itself is the rig's) */
function monitorBody(g: THREE.Object3D, x: number, deskY: number, z: number, ry: number, w = 0.55, h = 0.355): { cy: number } {
  const m = sub(g, x, deskY, z, 0, ry);
  const cy = 0.07 + 0.02 + h / 2;
  rb(m, 0.22, 0.014, 0.17, 0.005, C.charcoal(), 0, 0, -0.03);
  rb(m, 0.05, cy - 0.02, 0.03, 0.01, C.charcoal(), 0, 0.014, -0.05);
  rb(m, w, h, 0.028, 0.01, C.black(), 0, cy - h / 2, 0);
  return { cy };
}

// ───────────────────────────── the printed-label atlas ─────────────────────────────
// Every printed label (signs, panels, button legends) is a region of one 2048² canvas: one material,
// so they all merge into a single draw call.

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
let printAtlas: Atlas | null = null;
function atlas(): Atlas {
  if (printAtlas) return printAtlas;
  const S = 2048;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#e8ebec';
  ctx.fillRect(0, 0, S, S);
  const tex = canvasTexture(canvas);
  const mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  printAtlas = { canvas, ctx, tex, mat, x: 0, y: 0, row: 0, regions: new Map() };
  mat.addEventListener('dispose', () => (printAtlas = null));
  return printAtlas;
}
function region(key: string, w: number, h: number, draw: Draw): [number, number, number, number] {
  const a = atlas();
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
  if (y0 + h > S) console.warn(`[imaging] label atlas full at ${key}`);
  a.x += w + 4;
  a.row = Math.max(a.row, h + 4);
  a.ctx.save();
  a.ctx.translate(x0, y0);
  a.ctx.beginPath();
  a.ctx.rect(0, 0, w, h);
  a.ctx.clip();
  draw(a.ctx, w, h);
  a.ctx.restore();
  a.tex.needsUpdate = true;
  const r: [number, number, number, number] = [(x0 + 0.5) / S, 1 - (y0 + h - 0.5) / S, (x0 + w - 0.5) / S, 1 - (y0 + 0.5) / S];
  a.regions.set(key, r);
  return r;
}
/** a w × h m printed plane facing +z (ry / rx turn it) */
function decal(g: THREE.Object3D, key: string, px: [number, number], draw: Draw, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0): THREE.Mesh {
  const [u0, v0, u1, v1] = region(key, px[0], px[1], draw);
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return add(g, trackGeo(geo), atlas().mat, x, y, z, rx, ry, 0);
}

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
export const MONO = '"SF Mono", Menlo, Consolas, "Courier New", monospace';

export function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, align: CanvasTextAlign = 'left', color?: string, font = FONT) {
  if (color) ctx.fillStyle = color;
  let s = Math.round(size);
  ctx.font = `${weight} ${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 6) ctx.font = `${weight} ${--s}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lw = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}
/** the radiation trefoil (ISO 361): three 60° blades around a disc, the gaps 60° */
export function trefoil(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, color: string) {
  ctx.fillStyle = color;
  for (const c of [-90, 30, 150]) {
    const a0 = ((c - 30) * PI) / 180;
    const a1 = ((c + 30) * PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.arc(cx, cy, R * 0.3, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.2, 0, PI * 2);
  ctx.fill();
}

// ── labels ──

const drawRad: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f5cf1f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = w * 0.035;
  ctx.strokeRect(w * 0.04, w * 0.04, w * 0.92, h - w * 0.08);
  trefoil(ctx, w / 2, h * 0.36, w * 0.3, '#141414');
  fit(ctx, 'CAUTION', w / 2, h * 0.72, w * 0.84, h * 0.1, 900, 'center', '#141414');
  fit(ctx, 'X-RAYS', w / 2, h * 0.85, w * 0.84, h * 0.1, 900, 'center', '#141414');
};
const drawPreg: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#fbfbf6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f5cf1f';
  ctx.fillRect(0, 0, w, h * 0.27);
  trefoil(ctx, h * 0.15, h * 0.135, h * 0.1, '#141414');
  fit(ctx, 'PREGNANT?', h * 0.3, h * 0.14, w - h * 0.36, h * 0.15, 900, 'left', '#141414');
  const lines = ['If you are or might be pregnant,', 'tell the radiographer before', 'your X-ray or CT scan.'];
  lines.forEach((l, i) => fit(ctx, l, w * 0.06, h * (0.42 + i * 0.16), w * 0.88, h * 0.105, 600, 'left', '#1d2328'));
  ctx.fillStyle = '#f5cf1f';
  ctx.fillRect(w * 0.06, h * 0.9, w * 0.3, h * 0.025);
};
const drawGas = (k: 'O2' | 'VAC'): Draw => (ctx, w, h) => {
  const [bg, fg, t] = k === 'O2' ? ['#2f8f46', '#ffffff', 'O₂'] : ['#f2f2f2', '#1b1e21', 'VAC'];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1e21';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  fit(ctx, t, w / 2, h / 2 + 1, w * 0.84, h * 0.7, 800, 'center', fg);
};
/** the couch keys on the gantry's front cover: table up/down, in/out, lasers, home */
const drawGantryKeys: Draw = (ctx, w, h) => {
  rrect(ctx, 0, 0, w, h, 10, '#3a434b');
  const key = (cx: number, cy: number, label: string, fill = '#d9dee2', fg = '#1d2328') => {
    rrect(ctx, cx - w * 0.2, cy - h * 0.065, w * 0.4, h * 0.13, 8, fill);
    fit(ctx, label, cx, cy + 1, w * 0.34, h * 0.075, 800, 'center', fg);
  };
  key(w * 0.28, h * 0.13, '▲');
  key(w * 0.72, h * 0.13, '▼');
  key(w * 0.28, h * 0.31, '◀ IN');
  key(w * 0.72, h * 0.31, 'OUT ▶');
  key(w * 0.28, h * 0.49, 'LASER', '#d9dee2', '#b8231f');
  key(w * 0.72, h * 0.49, 'HOME');
  key(w * 0.5, h * 0.67, 'MOVE', '#f2c230');
  fit(ctx, 'TABLE', w / 2, h * 0.86, w * 0.8, h * 0.07, 800, 'center', '#c9d2d9');
};
/** the console's scan control box: the big START, STOP, table and intercom keys */
const drawScanBox: Draw = (ctx, w, h) => {
  rrect(ctx, 0, 0, w, h, 14, '#2c3238');
  rrect(ctx, w * 0.05, h * 0.12, w * 0.36, h * 0.5, 22, '#f2b51c');
  fit(ctx, 'START', w * 0.23, h * 0.37, w * 0.3, h * 0.17, 900, 'center', '#2a2210');
  rrect(ctx, w * 0.45, h * 0.12, w * 0.22, h * 0.5, 18, '#c8302c');
  fit(ctx, 'STOP', w * 0.56, h * 0.37, w * 0.18, h * 0.13, 900, 'center', '#ffffff');
  rrect(ctx, w * 0.71, h * 0.12, w * 0.24, h * 0.22, 10, '#8d99a3');
  fit(ctx, 'TABLE ▲▼', w * 0.83, h * 0.23, w * 0.2, h * 0.08, 800, 'center', '#ffffff');
  rrect(ctx, w * 0.71, h * 0.4, w * 0.24, h * 0.22, 10, '#3d7cc9');
  fit(ctx, 'TALK', w * 0.83, h * 0.51, w * 0.2, h * 0.1, 900, 'center', '#ffffff');
  fit(ctx, 'X-RAY ON', w * 0.23, h * 0.8, w * 0.3, h * 0.08, 800, 'center', '#f2b51c');
  ctx.fillStyle = '#5b3c06';
  ctx.beginPath();
  ctx.arc(w * 0.08, h * 0.8, h * 0.05, 0, PI * 2);
  ctx.fill();
  fit(ctx, 'PAUSE', w * 0.56, h * 0.8, w * 0.2, h * 0.08, 800, 'center', '#c9d2d9');
  fit(ctx, 'LASER', w * 0.83, h * 0.8, w * 0.2, h * 0.08, 800, 'center', '#c9d2d9');
};
const drawVent: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#b8bfc5';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5f676e';
  for (let i = 0; i < 14; i++) ctx.fillRect(w * 0.08, h * (0.08 + i * 0.062), w * 0.84, h * 0.03);
};
const drawHv: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f5cf1f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(w / 2, 8);
  ctx.lineTo(w - 8, h * 0.62);
  ctx.lineTo(8, h * 0.62);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#141414';
  ctx.beginPath();
  ctx.moveTo(w * 0.53, h * 0.14);
  ctx.lineTo(w * 0.42, h * 0.4);
  ctx.lineTo(w * 0.52, h * 0.4);
  ctx.lineTo(w * 0.46, h * 0.58);
  ctx.lineTo(w * 0.6, h * 0.32);
  ctx.lineTo(w * 0.5, h * 0.32);
  ctx.closePath();
  ctx.fill();
  fit(ctx, 'HIGH VOLTAGE', w / 2, h * 0.76, w * 0.9, h * 0.11, 900, 'center', '#141414');
  fit(ctx, 'Authorized staff only', w / 2, h * 0.9, w * 0.9, h * 0.07, 700, 'center', '#141414');
};
const drawGenPlate: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#d8dde1';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'X-RAY GENERATOR', w * 0.06, h * 0.25, w * 0.88, h * 0.22, 900, 'left', '#2b3034');
  fit(ctx, '80 kW · 40–150 kV · 1000 mA', w * 0.06, h * 0.6, w * 0.88, h * 0.16, 600, 'left', '#3a4248');
  fit(ctx, 'Radiation-emitting device', w * 0.06, h * 0.85, w * 0.88, h * 0.13, 600, 'left', '#3a4248');
};
const drawStandFace: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#e4e8eb';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#59636b';
  ctx.lineWidth = 3;
  ctx.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.42);
  ctx.lineTo(w / 2, h * 0.58);
  ctx.moveTo(w * 0.42, h / 2);
  ctx.lineTo(w * 0.58, h / 2);
  ctx.stroke();
  // the automatic exposure control's three chambers
  for (const [x, y] of [[0.32, 0.38], [0.68, 0.38], [0.5, 0.66]]) ctx.strokeRect(w * x - 12, h * y - 12, 24, 24);
};
const drawDetector: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#c9ced2';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#59636b';
  ctx.lineWidth = 3;
  ctx.strokeRect(w * 0.07, h * 0.07, w * 0.86, h * 0.86);
  fit(ctx, '43 × 35 cm', w * 0.1, h * 0.88, w * 0.5, h * 0.06, 700, 'left', '#59636b');
  ctx.fillStyle = '#3fb950';
  ctx.fillRect(w * 0.84, h * 0.84, 10, 10);
};
const drawTag = (text: string, bg: string, fg = '#ffffff'): Draw => (ctx, w, h) => {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  fit(ctx, text, w / 2, h / 2 + 1, w * 0.9, h * 0.62, 800, 'center', fg);
};
const drawWarmerLabel: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#2b3034';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'CONTRAST WARMER', w * 0.05, h * 0.3, w * 0.6, h * 0.3, 800, 'left', '#d9dee2');
  fit(ctx, '37.0 °C', w * 0.95, h * 0.55, w * 0.3, h * 0.55, 800, 'right', '#ff4a3a', MONO);
  fit(ctx, 'Iodinated contrast, 300 mgI/mL', w * 0.05, h * 0.72, w * 0.6, h * 0.22, 600, 'left', '#9aa5ad');
};
const drawEstop: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'EMERGENCY', w / 2, h * 0.16, w * 0.9, h * 0.12, 900, 'center', '#141414');
  fit(ctx, 'STOP', w / 2, h * 0.86, w * 0.9, h * 0.12, 900, 'center', '#141414');
};
const drawApronTag: Draw = (ctx, w, h) => {
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, '0.35 mm Pb', w / 2, h * 0.38, w * 0.9, h * 0.32, 800, 'center', '#1d2328');
  fit(ctx, 'Checked 03/26', w / 2, h * 0.75, w * 0.9, h * 0.22, 600, 'center', '#4a545b');
};

// ───────────────────────────── CT ─────────────────────────────

/** rounded-rectangle outline (x centred, from y0 up), with a round hole */
function gantryShape(W: number, H: number, y0: number, rTop: number, rBot: number, holeY: number, holeR: number): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -W / 2;
  const x1 = W / 2;
  const yt = y0 + H;
  s.moveTo(x0 + rBot, y0);
  s.lineTo(x1 - rBot, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + rBot);
  s.lineTo(x1, yt - rTop);
  s.quadraticCurveTo(x1, yt, x1 - rTop, yt);
  s.lineTo(x0 + rTop, yt);
  s.quadraticCurveTo(x0, yt, x0, yt - rTop);
  s.lineTo(x0, y0 + rBot);
  s.quadraticCurveTo(x0, y0, x0 + rBot, y0);
  const hole = new THREE.Path();
  hole.absarc(0, holeY, holeR, 0, PI * 2, true);
  s.holes.push(hole);
  return s;
}

/** a bezel round the bore: (radius, axial) profile turned about the bore axis (+z) */
function bezel(g: THREE.Object3D, prof: [number, number][], mat: THREE.Material, y: number) {
  const geo = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 72);
  geo.rotateX(PI / 2);
  add(g, trackGeo(geo), mat, 0, y, 0);
}

/** gantry and couch base (the couch's moving parts are the rig's) */
function ctScanner(g: THREE.Group) {
  const { isoY, boreR, gantryW, gantryH } = CT;
  // housing: rounded outline with the bore cut out; the bevel adds 3.5 cm all round
  const housing = new THREE.ExtrudeGeometry(gantryShape(gantryW - 0.07, gantryH - 0.11, 0.075, 0.5, 0.08, isoY, 0.5), { depth: 0.8, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 40 });
  housing.translate(0, 0, -0.4);
  add(g, trackGeo(housing), C.shell(), 0, 0, 0);
  // recessed plinth (toe kick) under it
  rb(g, gantryW - 0.3, 0.075, 0.72, 0.02, C.slate(), 0, 0, 0);
  // front and back bezels running into the bore, the bore liner and its scan-window band
  const front: [number, number][] = [[0.62, 0.43], [0.6, 0.462], [0.55, 0.478], [0.49, 0.476], [0.445, 0.462], [0.41, 0.44], [0.393, 0.41], [0.39, 0.395]];
  bezel(g, front, C.shell(), isoY);
  bezel(g, front.map(([r, z]) => [r, -z] as [number, number]).reverse(), C.shell(), isoY);
  const liner = new THREE.CylinderGeometry(boreR, boreR, 0.8, 72, 1, true);
  liner.rotateX(PI / 2);
  add(g, trackGeo(liner), lambert('#e3e7ea', { roughness: 0.4, side: THREE.BackSide }), 0, isoY, 0);
  const band = new THREE.CylinderGeometry(boreR - 0.003, boreR - 0.003, 0.035, 72, 1, true);
  band.rotateX(PI / 2);
  add(g, trackGeo(band), lambert('#b9c2c9', { roughness: 0.5, side: THREE.BackSide }), 0, isoY, 0);
  // a soft blue light ring round the front bezel
  add(g, G.torus(0.555, 0.005, 6, 72), lambert('#8fd0ea', { emissive: '#6cc4e6', emissiveIntensity: 0.5, roughness: 0.3 }), 0, isoY, 0.478);
  // side panels (on the flat of the sides, below the top's curve)
  for (const s of [-1, 1]) rb(g, 0.012, 1.1, 0.6, 0.006, C.panel(), s * (gantryW / 2 + 0.0075), 0.26, 0);
  // couch keys and an emergency stop either side of the bore, on the front cover
  for (const s of [-1, 1]) {
    rb(g, 0.16, 0.25, 0.022, 0.008, C.charcoal(), s * 0.79, 0.86, 0.452);
    decal(g, 'gantryKeys', [192, 300], drawGantryKeys, 0.15, 0.234, s * 0.79, 0.985, 0.4645);
    rb(g, 0.075, 0.075, 0.01, 0.006, C.yellow(), s * 0.79, 1.148, 0.445);
    add(g, G.cyl(0.024, 0.026, 0.026, 18), C.red(), s * 0.79, 1.185, 0.463, PI / 2, 0, 0);
  }
  // the display's bezel above the bore, the positioning lasers' windows (sagittal on top, coronal at the sides)
  rb(g, 0.34, 0.15, 0.014, 0.01, C.black(), 0, 1.715, 0.446);
  rb(g, 0.1, 0.018, 0.012, 0.004, C.black(), 0, 1.865, 0.446);
  for (const s of [-1, 1]) rb(g, 0.018, 0.08, 0.012, 0.004, C.black(), s * 0.665, isoY - 0.04, 0.446);
  // couch base on the floor, its foot switches
  rb(g, 0.66, 0.11, 1.72, 0.04, C.slate(), 0, 0, 1.86);
  rb(g, 0.6, 0.012, 1.66, 0.006, C.trim(), 0, 0.11, 1.86);
  for (const s of [-1, 1]) {
    rb(g, 0.14, 0.05, 0.2, 0.015, C.charcoal(), s * 0.46, 0, 2.3);
    rb(g, 0.1, 0.012, 0.15, 0.005, C.trim(), s * 0.46, 0.05, 2.31);
  }
}

/** dual-syringe power injector on its stand; front (+z) toward the couch (the head is the rig's) */
function ctInjector(g: THREE.Group) {
  starBase(g, 0.3);
  cyl(g, 0.045, 0.06, C.dark(), 0, 0.06, 0, 16);
  cyl(g, 0.026, 0.98, C.alu(), 0, 0.1, -0.04, 14);
  // power pack with its own small display and power LED
  rb(g, 0.24, 0.3, 0.15, 0.025, C.shell(), 0, 0.42, -0.13);
  rb(g, 0.14, 0.07, 0.006, 0.004, C.black(), 0, 0.6, -0.052);
  add(g, G.sphere(0.008, 8, 6), C.led('#f29e2b'), 0.08, 0.5, -0.054);
  // the swing arm up to the head
  cyl(g, 0.034, 0.06, C.charcoal(), 0, 1.06, -0.04, 14);
  rb(g, 0.05, 0.045, 0.46, 0.015, C.shell(), 0, 1.1, 0.17);
  add(g, G.sphere(0.035, 12, 9), C.charcoal(), 0, 1.122, 0.4);
  // tubing hooks and a spare syringe pack on the arm
  rb(g, 0.1, 0.13, 0.05, 0.01, lambert('#dfe8ee', { roughness: 0.3 }), 0.06, 0.82, -0.06);
}

/** the console along the window: desk, three monitors (the screens are the rig's), keyboard, scan box, intercom, chair */
function ctConsole(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 2.6;
  const D = p.d ?? 0.8;
  const top = C.laminate('#dfe2e4');
  rb(g, W, 0.03, D, 0.01, top, 0, 0.72, 0);
  rb(g, W - 0.06, 0.62, 0.02, 0.008, C.laminate('#b8c0c6'), 0, 0.08, -D / 2 + 0.03);
  for (const s of [-1, 1]) rb(g, 0.03, 0.72, D - 0.04, 0.008, C.laminate('#c9cfd3'), s * (W / 2 - 0.03), 0, 0);
  rb(g, 0.45, 0.62, D - 0.12, 0.012, C.laminate('#d4d9dc'), W / 2 - 0.3, 0.04, 0.02);
  for (let i = 0; i < 3; i++) rb(g, 0.12, 0.015, 0.02, 0.005, C.alu(), W / 2 - 0.3, 0.6 - i * 0.2, D / 2 - 0.035);
  // three monitors in a shallow arc, their stands
  for (const [x, ry] of CONSOLE_MONITORS) monitorBody(g, x, 0.75, -0.17, ry);
  // keyboard and mouse
  rb(g, 0.44, 0.02, 0.15, 0.006, C.charcoal(), 0, 0.75, 0.12);
  for (let r = 0; r < 4; r++) bx(g, 0.4, 0.004, 0.026, C.black(), 0, 0.77, 0.07 + r * 0.032);
  rb(g, 0.06, 0.022, 0.1, 0.02, C.charcoal(), 0.3, 0.75, 0.14);
  // the scan control box, sloped toward the operator
  const box = sub(g, 0.44, 0.75, 0.13, -0.32);
  rb(box, 0.34, 0.045, 0.2, 0.012, C.charcoal(), 0, 0, 0);
  decal(box, 'scanBox', [340, 200], drawScanBox, 0.32, 0.18, 0, 0.0465, 0, 0, -PI / 2);
  // emergency stop on the desk, its yellow collar
  cyl(g, 0.045, 0.03, C.yellow(), 0.78, 0.75, 0.2, 18);
  add(g, G.cyl(0.032, 0.036, 0.04, 18), C.red(), 0.78, 0.8, 0.2);
  // intercom: gooseneck microphone on a base with its talk key
  cyl(g, 0.055, 0.03, C.charcoal(), -0.4, 0.75, 0.08, 18);
  rb(g, 0.04, 0.008, 0.03, 0.004, lambert('#3d7cc9', { roughness: 0.4 }), -0.4, 0.78, 0.115);
  tube(g, [[-0.4, 0.78, 0.07], [-0.4, 0.9, 0.06], [-0.37, 1.0, 0.1], [-0.33, 1.04, 0.17]], 0.006, C.black(), 16, 6);
  add(g, G.cyl(0.014, 0.012, 0.05, 12), C.black(), -0.325, 1.045, 0.185, PI / 2 - 0.3, 0, 0);
  // the injector's remote (its screen is the rig's) on a small stand, left of the monitors
  rb(g, 0.13, 0.012, 0.1, 0.004, C.charcoal(), INJ_REMOTE[0], 0.75, INJ_REMOTE[1] - 0.03);
  rb(g, 0.04, 0.07, 0.03, 0.008, C.charcoal(), INJ_REMOTE[0], 0.755, INJ_REMOTE[1] - 0.04);
  const rem = sub(g, INJ_REMOTE[0], 0.75 + INJ_REMOTE[2], INJ_REMOTE[1], -0.35, 0.35);
  rb(rem, 0.26, 0.18, 0.03, 0.012, C.shell(), 0, -0.09, -0.012);
  // phone, a protocol binder, a pen pot
  rb(g, 0.2, 0.05, 0.17, 0.02, C.black(), 0.98, 0.75, -0.05);
  rb(g, 0.19, 0.045, 0.06, 0.02, C.charcoal(), 0.98, 0.8, -0.1);
  rb(g, 0.25, 0.035, 0.32, 0.006, lambert('#2a5c9a', { roughness: 0.6 }), 1.0, 0.75, 0.22, 0.2);
  cyl(g, 0.035, 0.1, C.charcoal(), -1.18, 0.75, -0.25, 12);
  for (const [dx, c] of [[-0.01, '#c8302c'], [0.012, '#2a5c9a'], [0.0, '#1d2328']] as [number, string][]) cyl(g, 0.005, 0.15, lambert(c, { roughness: 0.4 }), -1.18 + dx, 0.78, -0.25 + dx, 6);
  // the radiographer's chair, facing the window
  officeChair(g, CONSOLE_SEAT[0], CONSOLE_SEAT[1], PI);
}
/** console monitors: x along the desk and their turn toward the operator */
export const CONSOLE_MONITORS: [number, number][] = [
  [-0.6, 0.2],
  [0, 0],
  [0.6, -0.2],
];
/** the injector remote's screen: x, z on the desk, height above it */
export const INJ_REMOTE: [number, number, number] = [-1.02, -0.12, 0.13];
/** the chair, in the console's frame */
export const CONSOLE_SEAT: [number, number] = [-0.05, 0.9];

/** contrast warmer on a base cabinet */
function contrastWarmer(g: THREE.Group) {
  const white = C.laminate('#eceeef');
  rb(g, 0.6, 0.84, 0.5, 0.01, white, 0, 0.02, 0);
  bx(g, 0.56, 0.08, 0.46, C.rubber(), 0, 0, -0.01);
  for (const s of [-1, 1]) {
    bx(g, 0.002, 0.74, 0.004, C.laminate('#bfc6cb'), 0, 0.08, 0.251);
    bx(g, 0.012, 0.12, 0.02, C.alu(), s * 0.04, 0.66, 0.26);
  }
  rb(g, 0.62, 0.03, 0.52, 0.008, C.laminate('#d6dadd'), 0, 0.86, 0);
  // warming cabinet, open at the front behind its glass door: back, sides, top and bottom, a header
  // with the temperature display, two shelves of contrast bottles
  const y0 = 0.89;
  const shell = C.shell();
  rb(g, 0.46, 0.5, 0.02, 0.006, shell, 0, y0, -0.21);
  bx(g, 0.42, 0.42, 0.004, C.metal('#9aa3a9'), 0, y0 + 0.02, -0.198);
  for (const s of [-1, 1]) rb(g, 0.02, 0.5, 0.4, 0.006, shell, s * 0.22, y0, -0.02);
  rb(g, 0.46, 0.02, 0.4, 0.006, shell, 0, y0, -0.02);
  rb(g, 0.46, 0.08, 0.4, 0.008, shell, 0, y0 + 0.42, -0.02);
  for (let row = 0; row < 2; row++) {
    bx(g, 0.42, 0.008, 0.34, C.alu(), 0, y0 + 0.02 + row * 0.19, -0.03);
    for (let i = 0; i < 4; i++) {
      const x = -0.135 + i * 0.09;
      cyl(g, 0.03, 0.13, lambert('#f1ecd2', { roughness: 0.15 }), x, y0 + 0.028 + row * 0.19, -0.02, 14);
      cyl(g, 0.018, 0.02, lambert('#2f6fb8', { roughness: 0.4 }), x, y0 + 0.158 + row * 0.19, -0.02, 12);
    }
  }
  add(g, G.box(0.42, 0.4, 0.006), C.leadGlass(), 0, y0 + 0.215, 0.186).userData.noMerge = true;
  rb(g, 0.02, 0.16, 0.025, 0.006, C.alu(), 0.18, y0 + 0.15, 0.2);
  decal(g, 'warmer', [320, 80], drawWarmerLabel, 0.4, 0.07, 0, y0 + 0.46, 0.1815);
}

// ───────────────────────────── shared fixtures ─────────────────────────────

/** lead apron shape (front view, origin at the shoulders' middle, hanging down) */
function apronShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.21, 0);
  s.lineTo(-0.09, 0);
  s.quadraticCurveTo(0, -0.12, 0.09, 0);
  s.lineTo(0.21, 0);
  s.lineTo(0.2, -0.05);
  s.quadraticCurveTo(0.15, -0.16, 0.24, -0.29);
  s.lineTo(0.235, -0.93);
  s.quadraticCurveTo(0, -0.96, -0.235, -0.93);
  s.lineTo(-0.24, -0.29);
  s.quadraticCurveTo(-0.15, -0.16, -0.2, -0.05);
  s.lineTo(-0.21, 0);
  return s;
}
let apronGeo: THREE.BufferGeometry | null = null;

/** wall rail of lead aprons (three on hangers) and two thyroid collars */
function apronRack(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.9;
  rb(g, W, 0.045, 0.04, 0.012, C.alu(), 0, 0.76, 0.03);
  for (const s of [-1, 1]) rb(g, 0.04, 0.12, 0.03, 0.01, C.alu(), s * (W / 2 - 0.05), 0.7, 0.015);
  if (!apronGeo) {
    const geo = new THREE.ExtrudeGeometry(apronShape(), { depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 10 });
    geo.translate(0, 0, -0.011);
    apronGeo = trackGeo(geo);
  }
  // (nylon over the lead-vinyl core: bright, a little sheen)
  const colors = ['#4a78c0', '#3a9a92', '#a8435b'];
  colors.forEach((c, i) => {
    const x = (i - 1) * (W * 0.3);
    const z = 0.07 + i * 0.035;
    // hanger: an arm out from the rail, a shoulder bar
    rb(g, 0.016, 0.016, z - 0.03, 0.005, C.chrome(), x, 0.775, 0.03 + (z - 0.03) / 2);
    rb(g, 0.4, 0.016, 0.016, 0.006, C.charcoal(), x, 0.77, z);
    add(g, apronGeo!, lambert(c, { roughness: 0.55 }), x, 0.77, z + 0.006);
    // the waist belt (velcro) and a label
    rb(g, 0.46, 0.06, 0.012, 0.004, lambert('#2d3a4a', { roughness: 0.7 }), x, 0.33, z + 0.03);
    decal(g, 'apronTag', [160, 80], drawApronTag, 0.08, 0.04, x + 0.12, 0.62, z + 0.025);
  });
  // thyroid collars on a hook at the end
  const hx = W / 2 + 0.06;
  rb(g, 0.012, 0.08, 0.06, 0.004, C.chrome(), hx, 0.7, 0.03);
  for (let i = 0; i < 2; i++) add(g, G.torus(0.07, 0.022, 6, 16, PI * 1.25), lambert(i ? '#4a78c0' : '#a8435b', { roughness: 0.55 }), hx, 0.66 - i * 0.03, 0.07 + i * 0.03, 0, 0, PI * 1.12);
}

/** printed radiation sign ('rad': CAUTION X-RAYS) or the pregnancy notice ('preg') */
function radSign(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.3;
  const H = p.h ?? 0.4;
  rb(g, W + 0.014, H + 0.014, 0.006, 0.003, C.alu(), 0, -0.007, 0.003);
  if (p.label === 'preg') decal(g, 'preg', [420, 320], drawPreg, W, H, 0, H / 2, 0.0072);
  else decal(g, 'rad', [300, 400], drawRad, W, H, 0, H / 2, 0.0072);
}

/** the warning light's housing above the door (its lens is the rig's) */
function xrayWarn(g: THREE.Group) {
  rb(g, 0.46, 0.18, 0.06, 0.012, C.charcoal(), 0, 0, 0.03);
  rb(g, 0.44, 0.012, 0.075, 0.004, C.charcoal(), 0, 0.18, 0.0375);
  cyl(g, 0.008, 0.25, C.alu(), 0.18, 0.18, 0.015, 8);
}

/** oxygen and suction at the head of the scanner: flowmeter, regulator, canister */
function gasPanel(g: THREE.Group) {
  rb(g, 0.36, 0.42, 0.035, 0.008, C.laminate('#f0f1ef'), 0, 0, 0.0175);
  decal(g, 'gasO2', [100, 56], drawGas('O2'), 0.07, 0.04, -0.09, 0.36, 0.037);
  decal(g, 'gasVAC', [100, 56], drawGas('VAC'), 0.07, 0.04, 0.09, 0.36, 0.037);
  // O2: outlet, a flowmeter (clear tube with its ball) and a bubble-free nipple
  add(g, G.cyl(0.024, 0.024, 0.025, 14), C.o2(), -0.09, 0.28, 0.048, PI / 2, 0, 0);
  rb(g, 0.04, 0.03, 0.04, 0.008, C.chrome(), -0.09, 0.25, 0.07);
  add(g, G.cyl(0.016, 0.016, 0.13, 12), C.canister(), -0.09, 0.15, 0.07);
  add(g, G.sphere(0.008, 8, 6), C.o2(), -0.09, 0.12, 0.07);
  add(g, G.cyl(0.018, 0.018, 0.02, 12), C.o2(), -0.09, 0.225, 0.07);
  cyl(g, 0.008, 0.04, C.chrome(), -0.09, 0.04, 0.07, 8);
  // vacuum: outlet, regulator dial, canister on a bracket
  add(g, G.cyl(0.024, 0.024, 0.025, 14), C.vac(), 0.09, 0.28, 0.048, PI / 2, 0, 0);
  add(g, G.cyl(0.035, 0.035, 0.03, 18), C.chrome(), 0.09, 0.22, 0.07, PI / 2, 0, 0);
  add(g, G.circle(0.03, 18), lambert('#f6f6f2', { roughness: 0.3 }), 0.09, 0.22, 0.087);
  add(g, G.cyl(0.05, 0.05, 0.16, 16), C.canister(), 0.09, 0.08, 0.1);
  add(g, G.cyl(0.052, 0.052, 0.02, 16), C.vac(), 0.09, 0.17, 0.1);
}

/** a one-step stool with a rubber tread and a hand rail */
function stepStool(g: THREE.Group) {
  for (const sx of [-0.17, 0.17]) for (const sz of [-0.11, 0.11]) cyl(g, 0.012, 0.22, C.chrome(), sx, 0, sz, 8);
  rb(g, 0.4, 0.025, 0.28, 0.01, C.chrome(), 0, 0.215, 0);
  rb(g, 0.38, 0.012, 0.26, 0.005, C.rubber(), 0, 0.24, 0);
  for (const sx of [-0.17, 0.17]) cyl(g, 0.012, 0.6, C.chrome(), sx, 0.24, -0.12, 8);
  rod(g, 0.012, 0.36, C.chrome(), 0, 0.84, -0.12, 'x', 8);
}

// ───────────────────────────── X-ray room ─────────────────────────────

/** floating-top table: base, column, tabletop with its pad, the bucky tray's handle, a compression band; long axis along z */
function xrayTable(g: THREE.Group) {
  const top = XR.top;
  rb(g, 0.62, 0.08, 1.0, 0.03, C.slate(), 0, 0, 0);
  rb(g, 0.42, top - 0.2, 0.62, 0.04, C.grey(), 0, 0.08, 0);
  // the floating top's frame and the top itself (the bucky tray rides in the frame: the rig's)
  rb(g, 0.66, 0.06, 1.7, 0.02, C.trim(), 0, top - 0.17, 0);
  rb(g, 0.8, 0.035, 2.2, 0.015, lambert('#e8ebed', { roughness: 0.32 }), 0, top - 0.035, 0);
  rb(g, 0.74, XR.pad, 2.0, 0.012, C.pad(), 0, top, 0.04);
  // the tray's slot along the radiographer's (−x) side
  rb(g, 0.012, 0.05, 1.6, 0.004, C.black(), -0.4, top - 0.12, 0);
  // compression band rolled on its bar beyond the head end, sandbags at the foot end's far corner
  rod(g, 0.022, 0.84, C.alu(), 0, top + 0.035, -1.05, 'x', 10);
  add(g, G.cyl(0.035, 0.035, 0.3, 14), C.fabric('#3a4f73'), 0.18, top + 0.035, -1.05, 0, 0, PI / 2);
  rb(g, 0.2, 0.06, 0.13, 0.03, C.linen('#c9b48a'), 0.27, top + XR.pad, 0.98, 0.3);
  rb(g, 0.18, 0.055, 0.12, 0.027, C.linen('#bba57c'), 0.28, top + XR.pad + 0.06, 0.95, -0.2);
  // foot controls: table brakes and float release
  for (const s of [-1, 1]) {
    rb(g, 0.16, 0.04, 0.2, 0.012, C.charcoal(), s * 0.42, 0, -0.62);
    rb(g, 0.12, 0.01, 0.14, 0.004, C.trim(), s * 0.42, 0.04, -0.62);
  }
}

/** the ceiling rails the tube crane runs on (the crane is the rig's); origin: the rails' middle */
function xrayTube(g: THREE.Group) {
  const L = XR.railX[1] - XR.railX[0];
  const zs = [XR.railZ[0] - 2.6, XR.railZ[1] - 2.6];
  for (const z of zs) {
    rb(g, L, 0.08, 0.1, 0.012, C.alu(), 0, XR.railY + 0.02, z);
    for (const s of [-1, 1]) rb(g, 0.04, 0.1, 0.12, 0.01, C.charcoal(), s * (L / 2 + 0.02), XR.railY - 0.002, z);
  }
}

/** the chest stand on the wall: track column, top cap, the floor mark where the patient stands; the detector holder is the rig's */
function wallStand(g: THREE.Group) {
  rb(g, 0.24, 2.18, 0.06, 0.01, C.grey(), 0, 0.02, 0.03);
  rb(g, 0.14, 2.1, 0.07, 0.012, C.panel(), 0, 0.06, 0.09);
  rb(g, 0.04, 2.02, 0.012, 0.004, C.black(), 0, 0.1, 0.13);
  rb(g, 0.28, 0.08, 0.16, 0.02, C.slate(), 0, 2.2, 0.08);
  // a non-slip mat with the feet outlined, where the patient stands
  rb(g, 0.62, 0.006, 0.5, 0.003, C.rubber(), 0, 0, 0.62);
  for (const s of [-1, 1]) rb(g, 0.1, 0.002, 0.24, 0.002, lambert('#e8c547', { roughness: 0.6 }), s * 0.1, 0.006, 0.6);
}

/** the booth's desk: the acquisition monitor (the screen is the rig's), the generator's panel, the hand switch, a stool */
function xrayConsole(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 2.1;
  const D = p.d ?? 0.55;
  rb(g, W, 0.03, D, 0.01, C.laminate('#dfe2e4'), 0, 0.73, 0);
  rb(g, W - 0.06, 0.6, 0.02, 0.008, C.laminate('#b8c0c6'), 0, 0.1, -D / 2 + 0.03);
  for (const s of [-1, 1]) rb(g, 0.03, 0.73, D - 0.04, 0.008, C.laminate('#c9cfd3'), s * (W / 2 - 0.03), 0, 0);
  monitorBody(g, XR_MONITOR[0], 0.76, XR_MONITOR[1], XR_MONITOR[2]);
  rb(g, 0.42, 0.02, 0.14, 0.006, C.charcoal(), -0.35, 0.76, 0.12);
  for (let r = 0; r < 4; r++) bx(g, 0.38, 0.004, 0.024, C.black(), -0.35, 0.78, 0.075 + r * 0.03);
  rb(g, 0.06, 0.022, 0.1, 0.02, C.charcoal(), -0.04, 0.76, 0.14);
  // generator control panel, sloped (its display is the rig's)
  const gp = sub(g, XR_GEN[0], 0.76, XR_GEN[1], -0.35);
  rb(gp, 0.44, 0.05, 0.26, 0.012, C.charcoal(), 0, 0, 0);
  // the two-stage hand switch on its coiled cord, in its holder at the desk's edge
  rb(g, 0.05, 0.08, 0.04, 0.01, C.charcoal(), 0.72, 0.66, D / 2 + 0.02);
  add(g, G.cyl(0.021, 0.021, 0.12, 12), lambert('#e6e8e9', { roughness: 0.35 }), 0.72, 0.62, D / 2 + 0.05);
  add(g, G.cyl(0.012, 0.012, 0.012, 10), lambert('#2f6fb8', { roughness: 0.4 }), 0.72, 0.686, D / 2 + 0.05);
  const coil: [number, number, number][] = [];
  for (let i = 0; i <= 36; i++) coil.push([0.72 + 0.018 * Math.cos(i * 0.9), 0.56 - i * 0.012, D / 2 + 0.05 + 0.018 * Math.sin(i * 0.9)]);
  tube(g, coil, 0.003, C.black(), 72, 4);
  // barcode scanner and a stool
  rb(g, 0.07, 0.12, 0.05, 0.015, C.charcoal(), 0.9, 0.76, -0.12, 0.3);
  const st = sub(g, XR_SEAT[0], 0, XR_SEAT[1]);
  rb(st, 0.38, 0.07, 0.38, 0.035, C.vinyl('#2f3a44'), 0, 0.55, 0);
  cyl(st, 0.025, 0.42, C.chrome(), 0, 0.12, 0, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    add(st, G.rbox(0.28, 0.03, 0.04, 0.012), C.chrome(), Math.cos(a) * 0.14, 0.08, Math.sin(a) * 0.14, 0, -a, 0);
  }
}
/** the booth monitor: x, z on the desk, turn */
export const XR_MONITOR: [number, number, number] = [-0.35, -0.12, 0];
/** the generator panel: x, z on the desk */
export const XR_GEN: [number, number] = [0.3, 0.02];
/** the booth stool, in the desk's frame */
export const XR_SEAT: [number, number] = [-0.04, 0.87];

/** the generator cabinet */
function xrayGenerator(g: THREE.Group) {
  const grey = C.metal('#c3c9ce');
  rb(g, 0.9, 1.9, 0.7, 0.012, grey, 0, 0, 0);
  rb(g, 0.86, 0.06, 0.66, 0.01, C.rubber(), 0, 0, 0);
  bx(g, 0.004, 1.72, 0.002, C.metal('#9aa3a9'), 0, 0.1, 0.351);
  decal(g, 'vent', [128, 220], drawVent, 0.24, 0.42, -0.24, 1.35, 0.3515);
  decal(g, 'vent', [128, 220], drawVent, 0.24, 0.42, 0.24, 1.35, 0.3515);
  decal(g, 'hv', [220, 220], drawHv, 0.16, 0.16, 0.24, 0.85, 0.3515);
  decal(g, 'genPlate', [400, 120], drawGenPlate, 0.3, 0.09, -0.24, 0.85, 0.3515);
  for (const [x, c] of [[-0.36, '#3fb950'], [-0.32, '#f2c230']] as [number, string][]) add(g, G.sphere(0.008, 8, 6), C.led(c), x, 1.75, 0.355);
  for (const s of [-1, 1]) rb(g, 0.02, 0.2, 0.025, 0.006, C.alu(), s * 0.04, 0.95, 0.36);
}

/** wall holder with two portable detectors and the charger */
function detectorRack(g: THREE.Group) {
  rb(g, 0.62, 0.32, 0.12, 0.01, C.metal('#d3d8dc'), 0, 0, 0.06);
  rb(g, 0.58, 0.02, 0.1, 0.006, C.rubber(), 0, 0.02, 0.06);
  for (let i = 0; i < 2; i++) {
    const z = 0.035 + i * 0.045;
    const det = sub(g, -0.04 + i * 0.07, 0.03, z, -0.05);
    rb(det, 0.46, 0.38, 0.016, 0.006, C.metal('#b9c0c5'), 0, 0, 0);
    decal(det, 'detector', [230, 190], drawDetector, 0.44, 0.36, 0, 0.19, 0.0085);
    rb(det, 0.12, 0.02, 0.018, 0.006, C.charcoal(), 0, 0.37, 0);
  }
  add(g, G.sphere(0.007, 8, 6), C.led(), 0.27, 0.28, 0.125);
}

/** open shelves of positioning aids: foam wedges and blocks, sandbags, rolled compression bands */
function aidShelf(g: THREE.Group) {
  const frame = C.metal('#dfe3e6');
  for (const sx of [-0.58, 0.58]) for (const sz of [0.03, 0.37]) bx(g, 0.03, 1.1, 0.03, frame, sx, 0, sz);
  for (const y of [0.08, 0.45, 0.82]) rb(g, 1.18, 0.02, 0.36, 0.006, frame, 0, y, 0.2);
  const foam = (c: string) => C.vinyl(c);
  // wedges (triangular prisms) and blocks on the top shelves
  const wedge = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.12, 0), new THREE.Vector2(0.12, 0), new THREE.Vector2(0.12, 0.11)]), { depth: 0.22, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
  wedge.translate(0, 0, -0.11);
  trackGeo(wedge);
  [[-0.38, 0.84, '#4a7fa8'], [-0.1, 0.84, '#7b8f9e'], [0.2, 0.47, '#4a7fa8']].forEach(([x, y, c]) => add(g, wedge, foam(c as string), x as number, (y as number) + 0.006, 0.2));
  rb(g, 0.2, 0.1, 0.2, 0.025, foam('#4a7fa8'), 0.2, 0.84, 0.2);
  rb(g, 0.16, 0.16, 0.16, 0.025, foam('#7b8f9e'), 0.42, 0.84, 0.2);
  rb(g, 0.3, 0.06, 0.12, 0.02, foam('#4a7fa8'), -0.3, 0.47, 0.17);
  rb(g, 0.3, 0.06, 0.12, 0.02, foam('#4a7fa8'), -0.3, 0.53, 0.17);
  add(g, G.cyl(0.04, 0.04, 0.2, 14), C.fabric('#3a4f73'), 0.45, 0.51, 0.2, 0, 0, PI / 2);
  // sandbags on the bottom shelf
  for (let i = 0; i < 4; i++) rb(g, 0.26, 0.07, 0.15, 0.035, C.linen(i % 2 ? '#c9b48a' : '#b9a27a'), -0.36 + i * 0.25, 0.1 + (i === 2 ? 0.07 : 0), 0.2, (i - 1.5) * 0.12);
}

/** a changing cubicle in the corner: side panel, curtain on a rail, bench, hooks, a mirror, folded gowns */
function changeCubicle(g: THREE.Group) {
  const panel = C.laminate('#dfe5e8');
  rb(g, 0.05, 2.0, 1.28, 0.008, panel, 0.6, 0.06, -0.01);
  bx(g, 0.05, 0.06, 1.28, C.alu(), 0.6, 0, -0.01);
  // curtain rail and the curtain, drawn half way (pleats from a sine)
  rod(g, 0.012, 1.18, C.alu(), -0.01, 2.05, 0.64, 'x', 8);
  const cw = 0.6;
  const curtain = new THREE.PlaneGeometry(cw, 1.72, 24, 1);
  const pos = curtain.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / cw) * PI * 9) * 0.025);
  curtain.computeVertexNormals();
  add(g, trackGeo(curtain), pbr('fabric_curtain', { color: '#7fa7b8', tile: 0.25, roughness: 1, normalScale: 0.6, side: THREE.DoubleSide }), -0.3, 1.16, 0.64);
  for (let i = 0; i < 12; i++) cyl(g, 0.006, 0.04, C.chrome(), -0.58 + i * 0.05, 2.0, 0.64, 6);
  // bench, hooks, a mirror on the panel, gowns
  rb(g, 0.95, 0.04, 0.34, 0.01, C.laminate('#c9b28f'), -0.08, 0.44, -0.47);
  for (const sx of [-0.5, 0.33]) bx(g, 0.04, 0.44, 0.3, C.metal('#9aa3a9'), sx, 0, -0.47);
  for (const z of [-0.2, 0.15]) {
    rb(g, 0.04, 0.02, 0.02, 0.006, C.chrome(), -0.58, 1.62, z);
    rb(g, 0.012, 0.05, 0.012, 0.004, C.chrome(), -0.56, 1.6, z);
  }
  rb(g, 0.012, 0.6, 0.4, 0.004, C.alu(), 0.57, 1.05, 0.1);
  add(g, G.plane(0.38, 0.58), lambert('#c9d6dc', { roughness: 0.05, metalness: 0.9 }), 0.5635, 1.35, 0.1, 0, -PI / 2, 0);
  rb(g, 0.3, 0.05, 0.22, 0.02, C.linen('#9cc3d5'), -0.3, 0.48, -0.47, 0.1);
  rb(g, 0.29, 0.04, 0.21, 0.02, C.linen('#9cc3d5'), -0.29, 0.53, -0.47, -0.05);
  // a gown on the hook
  rb(g, 0.26, 0.5, 0.04, 0.02, C.linen('#9cc3d5'), -0.555, 1.1, 0.15, PI / 2);
}

// ───────────────────────────── props.ts hook ─────────────────────────────

const BUILDERS: Record<string, (p: PropDef, g: THREE.Group, out: BuiltProp) => void> = {
  ctScanner: (_p, g) => ctScanner(g),
  ctInjector: (_p, g) => ctInjector(g),
  ctConsole: (p, g) => ctConsole(p, g),
  contrastWarmer: (_p, g) => contrastWarmer(g),
  apronRack: (p, g) => apronRack(p, g),
  radSign: (p, g) => radSign(p, g),
  xrayWarn: (_p, g) => xrayWarn(g),
  gasPanel: (_p, g) => gasPanel(g),
  stepStool: (_p, g) => stepStool(g),
  xrayTable: (_p, g) => xrayTable(g),
  xrayTube: (_p, g) => xrayTube(g),
  wallStand: (_p, g) => wallStand(g),
  xrayConsole: (p, g) => xrayConsole(p, g),
  xrayGenerator: (_p, g) => xrayGenerator(g),
  detectorRack: (_p, g) => detectorRack(g),
  aidShelf: (_p, g) => aidShelf(g),
  changeCubicle: (_p, g) => changeCubicle(g),
};
export const IMAGING_KINDS = new Set(Object.keys(BUILDERS));
/** wall-mounted and ceiling kinds: the builder's tall layer (hidden in the top-down cut-away) */
export const IMAGING_TALL = ['apronRack', 'radSign', 'xrayWarn', 'gasPanel', 'xrayTube', 'detectorRack'];

/** props.ts hook: builds p if it is imaging equipment (true), else leaves it to props.ts (false) */
export function buildImagingProp(p: PropDef, out: BuiltProp): boolean {
  const b = BUILDERS[p.kind];
  if (!b) return false;
  b(p, out.group, out);
  return true;
}

// ───────────────────────────── inspect texts ─────────────────────────────

/** FIXTURE_INFO entries (items.ts): what [F] shows for each piece of imaging equipment */
export const IMAGING_INFO: Record<string, { title: string; desc: string }> = {
  ctScanner: {
    title: 'CT scanner',
    desc: '64-slice CT with a 78 cm bore. Tube and detectors spin round the patient two to three times a second while the couch carries them through: a helical scan. The red lasers mark where the scan starts. An abdomen and pelvis is about 5–10 mSv, two to three years of natural background. Contrast studies: check the kidney function per local policy and the allergy history; women 12–55 need a pregnancy test first. An unstable patient goes with monitoring, oxygen and a nurse.',
  },
  ctInjector: {
    title: 'Power injector',
    desc: 'Two syringes: iodinated contrast (A) and saline (B). An abdomen and pelvis typically takes 80–100 mL at 2–3 mL/s and is scanned in the portal venous phase, about 70 s after the start; a CT angiogram runs 4–5 mL/s through an 18–20G line in the antecubital fossa, triggered by bolus tracking. The pressure limit stops it if the line is blocked. Watch the cannula site for the first seconds: an extravasation swells fast.',
  },
  ctConsole: {
    title: 'CT console',
    desc: 'The worklist, the protocol, the scout (topogram) the scan range is planned on, the dose (CTDIvol and DLP, saved with the study), and the START key. The radiographer talks to the patient through the intercom and watches through the lead glass for the whole scan. The red key stops the exposure and the couch at once.',
  },
  contrastWarmer: {
    title: 'Contrast warmer',
    desc: 'Contrast kept at 37 °C: warm contrast is less viscous, so it runs at the same rate with lower pressure and a lower risk of extravasation, and patients find it more comfortable.',
  },
  apronRack: {
    title: 'Lead aprons',
    desc: '0.25–0.5 mm lead-equivalent aprons and thyroid collars, for anyone who stays in the room during an exposure (holding a child, steadying a confused patient). Hang them on the rack: a folded apron cracks, and the crack lets radiation through. They are X-rayed for cracks once a year.',
  },
  radSign: {
    title: 'Radiation sign',
    desc: 'Controlled area. Nobody walks in while the light above the door is on, and women who are or may be pregnant tell the radiographer before an X-ray or CT: the ED orders a pregnancy test first for women 12–55.',
  },
  xrayWarn: {
    title: '"X-ray in use" light',
    desc: 'Lit while the generator is prepared or exposing. Stay out until it goes off: dose falls with the square of the distance, and a closed lead-lined door does the rest.',
  },
  gasPanel: {
    title: 'Oxygen and suction',
    desc: 'Wall oxygen with a flowmeter and suction with a canister at the scanner. A patient who vomits flat on the couch needs suction and to be rolled now; check both before a sick patient is scanned.',
  },
  leadGlass: {
    title: 'Lead-glass window',
    desc: 'About 2 mm lead equivalent: the radiographer sees and hears the patient for the whole scan, from behind the wall that stops the scattered radiation.',
  },
  xrayTable: {
    title: 'X-ray table',
    desc: 'Floating top: it slides in every direction so the patient is centred under the tube without being moved. The tray under it (the bucky) holds the grid and the detector; small parts such as an ankle go on a detector on the tabletop. The compression band and the sandbags hold a limb still: fewer repeats, less dose.',
  },
  xrayTube: {
    title: 'X-ray tube',
    desc: 'Ceiling-mounted tube on rails, with its collimator: the light field shows where the beam will fall, and the shutters keep it to the area that needs imaging. Source-to-image distance 100 cm on the table, 180 cm for a chest film at the wall stand, so the heart is hardly magnified.',
  },
  wallStand: {
    title: 'Chest wall stand',
    desc: 'Erect chest films: PA at 180 cm, the chest against the detector, chin up, hands on the hips and the shoulders rolled forward so the scapulae clear the lungs, on full inspiration. A PA film keeps the heart close to the detector, so its size can be judged (cardiothoracic ratio under 0.5). The lateral is taken left side to the detector, arms up.',
  },
  xrayConsole: {
    title: 'Acquisition console',
    desc: 'The exam and its projections, kV and mAs (or automatic exposure control), and the two-stage hand switch: half-pressed it prepares (the anode spins up), fully pressed it exposes. A chest film is about 120 kV and 2 mAs, an ankle about 55 kV. Each image is checked for position, exposure and markers before the patient goes.',
  },
  xrayGenerator: {
    title: 'X-ray generator',
    desc: 'High-voltage generator for the tube: up to 150 kV and 1000 mA. It is what the "X-ray in use" light is wired to.',
  },
  detectorRack: {
    title: 'Portable detectors',
    desc: 'Wireless flat-panel detectors for cross-table and portable films: in a plastic cover, wiped between patients, charged here.',
  },
  aidShelf: {
    title: 'Positioning aids',
    desc: 'Foam wedges and blocks to hold a limb at the right angle (a 15° internal rotation for the ankle mortise view), sandbags to steady it, compression bands. Immobilization means fewer repeats.',
  },
  changeCubicle: {
    title: 'Changing cubicle',
    desc: 'Gowns and a bench. Jewellery, underwired bras and anything metal off for the area being imaged: they show up on the film.',
  },
};

// ───────────────────────────── builder.ts hook: partitions, colliders, inspect boxes, the moving rig ─────────────────────────────

/** inspect box per kind, [x0, y0, z0, x1, y1, z1] in the prop's frame (wall props: y from p.y) */
const HIT: Record<string, number[]> = {
  ctInjector: [-0.32, 0.05, -0.32, 0.32, 1.3, 0.62],
  ctConsole: [-1.3, 0.7, -0.4, 1.3, 1.2, 0.4],
  contrastWarmer: [-0.31, 0.85, -0.26, 0.31, 1.4, 0.26],
  apronRack: [-0.55, -0.2, 0, 0.6, 0.85, 0.2],
  radSign: [-0.22, -0.02, 0, 0.22, 0.42, 0.05],
  xrayWarn: [-0.24, -0.02, 0, 0.24, 0.2, 0.1],
  gasPanel: [-0.19, 0, 0, 0.19, 0.43, 0.16],
  wallStand: [-0.32, 0.6, 0, 0.32, 2.25, 0.5],
  xrayConsole: [-1.05, 0.72, -0.27, 1.05, 1.2, 0.27],
  xrayGenerator: [-0.46, 0.05, -0.36, 0.46, 1.92, 0.37],
  detectorRack: [-0.32, 0, 0, 0.32, 0.42, 0.14],
  aidShelf: [-0.6, 0.05, 0, 0.6, 1.12, 0.4],
  changeCubicle: [-0.62, 0.3, -0.65, 0.65, 2.1, 0.66],
};
/** floor footprints per kind, [x0, z0, x1, z1] in the prop's frame (solid layout props get the builder's box instead) */
const FOOT: Record<string, number[][]> = {
  // gantry, and the couch the whole length of its cradle at home
  ctScanner: [[-CT.gantryW / 2, -CT.gantryHalf, CT.gantryW / 2, CT.gantryHalf], [-0.33, CT.gantryHalf, 0.33, CT.cradleHome + CT.cradleLen]],
  ctInjector: [[-0.3, -0.3, 0.3, 0.3]],
  ctConsole: [[-1.3, -0.4, 1.3, 0.4]],
  stepStool: [[-0.2, -0.14, 0.2, 0.14]],
  wallStand: [[-0.16, 0, 0.16, 0.18]],
  xrayConsole: [[-1.05, -0.27, 1.05, 0.27]],
  aidShelf: [[-0.6, 0.02, 0.6, 0.4]],
  changeCubicle: [[0.575, -0.65, 0.625, 0.63], [-0.55, -0.65, 0.4, -0.3]],
};

function toWorld(p: { x: number; z: number; y?: number; rot?: number }, x: number, y: number, z: number): THREE.Vector3 {
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

/** a live canvas screen: drawn by imagingLife.ts (screens are unlit, a little brighter than white like the others) */
export interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
}
function screen(parent: THREE.Object3D, w: number, h: number, px: [number, number], x: number, y: number, z: number, rx = 0, ry = 0): Screen {
  const { canvas, ctx } = makeCanvas(px[0], px[1]);
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, px[0], px[1]);
  const tex = canvasTexture(canvas);
  const mat = own(new THREE.MeshBasicMaterial({ map: tex }));
  mat.color.setScalar(1.45);
  const mesh = add(parent, G.plane(w, h), mat, x, y, z, rx, ry, 0);
  mesh.userData.noMerge = true;
  return { canvas, ctx, tex, mesh };
}

/** a warning light's lens: red with "X-RAY IN USE"; on = bright and glowing, off = dark red */
function warnLens(parent: THREE.Object3D, p: PropDef): THREE.MeshStandardMaterial {
  const { canvas, ctx } = makeCanvas(512, 160);
  ctx.fillStyle = '#d81f1f';
  ctx.fillRect(0, 0, 512, 160);
  fit(ctx, 'X-RAY IN USE', 256, 62, 470, 64, 900, 'center', '#ffffff');
  fit(ctx, 'DO NOT ENTER', 256, 122, 400, 34, 800, 'center', '#ffe1e1');
  const tex = canvasTexture(canvas);
  const mat = own(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.0, roughness: 0.25 }));
  mat.color.set('#5a1c1c');
  const m = add(parent, G.plane(0.42, 0.14), mat, 0, 0, 0);
  m.position.copy(toWorld(p, 0, 0.09, 0.0615));
  m.rotation.y = p.rot ?? 0;
  m.userData.noMerge = true;
  return mat;
}

export interface CtRig {
  scanner: PropDef;
  /** in the scanner's frame (a group at the prop): the couch's column (scaled in y), upper body (y), cradle (y and z) */
  frame: THREE.Group;
  column: THREE.Object3D;
  upper: THREE.Object3D;
  cradle: THREE.Object3D;
  /** positioning lasers: the axial line over the body (scaled to it), the lines on the pad, the apertures */
  lasers: THREE.Group;
  laserArc: THREE.Object3D;
  laserPad: THREE.Object3D;
  /** the gantry's X-ray-on lamp; its display (breathing instructions, couch position) */
  beamLamp: THREE.MeshStandardMaterial;
  gantry: Screen;
  /** console: worklist and protocol, exam (scout, range, progress), images; the injector's remote and head */
  console: Screen[];
  injRemote: Screen;
  injHead: Screen;
  injector: { head: THREE.Group; plunger: THREE.Object3D[]; fluid: THREE.Object3D[]; led: THREE.MeshStandardMaterial; tip: THREE.Vector3; line: THREE.Mesh; lineMat: THREE.Material };
  warn: THREE.MeshStandardMaterial[];
  /** world points: the console seat, the radiographer's place at the couch, where the scanner sounds from */
  seat: { x: number; z: number; rot: number };
  tableSide: { x: number; z: number; rot: number };
  sound: { x: number; y: number; z: number };
}

export interface XrRig {
  table: PropDef;
  stand: PropDef;
  /** the tube crane: bridge (x), carriage (z), column (inner tube scaled), yoke (y: the tube's axis), head (tilts the beam from down to +x) */
  bridge: THREE.Object3D;
  carriage: THREE.Object3D;
  inner: THREE.Object3D;
  yoke: THREE.Object3D;
  head: THREE.Object3D;
  /** collimator light on the patient: a plane placed where the beam lands */
  light: THREE.Mesh;
  /** the wall stand's detector holder (y), the bucky tray (x) */
  standCarriage: THREE.Object3D;
  bucky: THREE.Object3D;
  warn: THREE.MeshStandardMaterial[];
  console: Screen;
  gen: Screen;
  /** the tube's inspect box (moves with it) */
  tubeHit: Interactable;
  seat: { x: number; z: number; rot: number };
  sound: { x: number; y: number; z: number };
}

export interface ImagingRig {
  ct: CtRig | null;
  xr: XrRig | null;
}

export interface ImagingExtras {
  colliders: THREE.Box3[];
  occluders: THREE.Box3[];
  cameraBlockers: THREE.Box3[];
  interactables: Interactable[];
  rig: ImagingRig;
}

interface Opening {
  a: number;
  b: number;
  kind: 'door' | 'window';
  sill?: number;
  head: number;
  /** door: which jamb the open leaf hangs on ('a' | 'b') and which side it swings to (+1 / −1 of the normal) */
  hinge?: 'a' | 'b';
  swing?: 1 | -1;
}

interface PartitionDef {
  /** start and end on the floor; axis-aligned */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thick: number;
  height: number;
  color: string;
  openings: Opening[];
  /** keeps the third-person camera on its side (full-height walls) */
  cameraWall?: boolean;
  /** the window counts as "lead glass" for the inspect box */
  lead?: boolean;
}

/** the CT room's lead-lined partition, the X-ray booth's two screens */
export const PARTITIONS: PartitionDef[] = [
  {
    x1: 37.2,
    z1: 0.12,
    x2: 37.2,
    z2: 6.88,
    thick: 0.14,
    height: 3.0,
    color: '#e9ecf2',
    cameraWall: true,
    lead: true,
    openings: [
      { a: 0.48, b: 2.98, kind: 'window', sill: 0.92, head: 2.02 },
      // the connecting door, hung on its north jamb, opening into the control room (+x)
      { a: 4.28, b: 5.28, kind: 'door', head: 2.1, hinge: 'a', swing: 1 },
    ],
  },
  { x1: 45.5, z1: 4.75, x2: 47.88, z2: 4.75, thick: 0.1, height: 2.1, color: '#e2e7ec', lead: true, openings: [{ a: 0.3, b: 2.08, kind: 'window', sill: 0.95, head: 1.95 }] },
  { x1: 45.55, z1: 4.8, x2: 45.55, z2: 5.8, thick: 0.1, height: 2.1, color: '#e2e7ec', openings: [] },
];
const LOW_H = 1.05;

/** builds a partition: wall boxes with door and window openings, frames, glass, cove base, a door leaf */
function partition(d: PartitionDef, groups: { root: THREE.Group; tallStatic: THREE.Group; lowStatic: THREE.Group }, out: ImagingExtras) {
  const alongX = Math.abs(d.z2 - d.z1) < 1e-6;
  const len = alongX ? d.x2 - d.x1 : d.z2 - d.z1;
  const sx = d.x1;
  const sz = d.z1;
  const dx = alongX ? 1 : 0;
  const dz = alongX ? 0 : 1;
  const nx = alongX ? 0 : 1;
  const nz = alongX ? 1 : 0;
  const yaw = alongX ? 0 : PI / 2;
  const wall = C.wall(d.color);
  const H = d.height;
  const T = d.thick;
  const at = (t: number) => ({ x: sx + dx * t, z: sz + dz * t });
  /** a box spanning [a, b] along the partition from y0 to y1 */
  const seg = (a: number, b: number, y0: number, y1: number, low: boolean, collide: boolean) => {
    if (b - a < 0.005 || y1 - y0 < 0.005) return;
    const m = at((a + b) / 2);
    add(groups.tallStatic, G.box(b - a, y1 - y0, T), wall, m.x, (y0 + y1) / 2, m.z, 0, yaw, 0);
    if (low && y0 < LOW_H) add(groups.lowStatic, G.box(b - a, Math.min(y1, LOW_H) - y0, T), wall, m.x, (y0 + Math.min(y1, LOW_H)) / 2, m.z, 0, yaw, 0);
    const half = new THREE.Vector3(dx * (b - a) / 2 + nx * T / 2, 0, dz * (b - a) / 2 + nz * T / 2);
    const box = new THREE.Box3(new THREE.Vector3(m.x - half.x, y0, m.z - half.z), new THREE.Vector3(m.x + half.x, y1, m.z + half.z));
    if (collide) {
      out.colliders.push(box);
      out.occluders.push(box);
    }
  };
  const ops = [...d.openings].sort((p, q) => p.a - q.a);
  let cur = 0;
  for (const o of ops) {
    seg(cur, o.a, 0, H, true, true);
    if (o.kind === 'window') {
      seg(o.a, o.b, 0, o.sill ?? 0.9, true, true);
      seg(o.a, o.b, o.head, H, false, true);
      // the glass blocks walking; it doesn't hide labels or muffle much
      const m = at((o.a + o.b) / 2);
      const half = new THREE.Vector3(dx * (o.b - o.a) / 2 + nx * 0.02, 0, dz * (o.b - o.a) / 2 + nz * 0.02);
      out.colliders.push(new THREE.Box3(new THREE.Vector3(m.x - half.x, o.sill ?? 0.9, m.z - half.z), new THREE.Vector3(m.x + half.x, o.head, m.z + half.z)));
      const gl = add(groups.tallStatic, G.box(o.b - o.a - 0.02, o.head - (o.sill ?? 0.9) - 0.02, 0.012), C.leadGlass(), m.x, ((o.sill ?? 0.9) + o.head) / 2, m.z, 0, yaw, 0);
      gl.userData.noMerge = true;
      // frame on both faces
      for (const f of [-1, 1]) {
        const ox = nx * f * (T / 2 + 0.012);
        const oz = nz * f * (T / 2 + 0.012);
        const sill = o.sill ?? 0.9;
        add(groups.tallStatic, G.box(o.b - o.a + 0.08, 0.05, 0.024), C.frame(), m.x + ox, o.head + 0.012, m.z + oz, 0, yaw, 0);
        add(groups.tallStatic, G.box(o.b - o.a + 0.08, 0.05, 0.03), C.frame(), m.x + ox, sill - 0.012, m.z + oz, 0, yaw, 0);
        for (const e of [o.a - 0.015, o.b + 0.015]) {
          const p = at(e);
          add(groups.tallStatic, G.box(0.05, o.head - sill + 0.05, 0.024), C.frame(), p.x + ox, (sill + o.head) / 2, p.z + oz, 0, yaw, 0);
        }
      }
      // the inner reveal round the glass
      for (const e of [o.a + 0.005, o.b - 0.005]) {
        const p = at(e);
        add(groups.tallStatic, G.box(0.01, o.head - (o.sill ?? 0.9), T), C.frame(), p.x, ((o.sill ?? 0.9) + o.head) / 2, p.z, 0, yaw, 0);
      }
      if (d.lead) {
        const box = new THREE.Box3(new THREE.Vector3(m.x - half.x - nx * 0.15, o.sill ?? 0.9, m.z - half.z - nz * 0.15), new THREE.Vector3(m.x + half.x + nx * 0.15, o.head, m.z + half.z + nz * 0.15));
        out.interactables.push({ key: `fx:leadGlass:${d.x1},${d.z1}`, target: { kind: 'inspect', subject: 'leadGlass', label: 'Inspect lead-glass window' }, box, center: box.getCenter(new THREE.Vector3()) });
      }
    } else {
      seg(o.a, o.b, o.head, H, false, true);
      // hollow-metal frame and an open leaf
      for (const e of [o.a, o.b]) {
        const p = at(e);
        add(groups.tallStatic, G.rbox(0.06, o.head, T + 0.05, 0.012), C.frame(), p.x, o.head / 2, p.z, 0, yaw, 0);
        add(groups.tallStatic, G.box(0.065, 1.2, T + 0.06), C.kick(), p.x, 0.6, p.z, 0, yaw, 0);
      }
      const m = at((o.a + o.b) / 2);
      add(groups.tallStatic, G.rbox(o.b - o.a + 0.06, 0.06, T + 0.05, 0.012), C.frame(), m.x, o.head, m.z, 0, yaw, 0);
      const lw = o.b - o.a - 0.05;
      const hingeT = o.hinge === 'b' ? o.b - 0.03 : o.a + 0.03;
      const sw = o.swing ?? 1;
      const hp = at(hingeT);
      const lx = hp.x + nx * sw * (T / 2 + lw / 2 + 0.01);
      const lz = hp.z + nz * sw * (T / 2 + lw / 2 + 0.01);
      // the leaf stands at right angles to the wall: its face along the normal
      add(groups.tallStatic, G.rbox(0.05, o.head - 0.05, lw, 0.01), C.door(), lx, (o.head - 0.05) / 2, lz, 0, yaw, 0);
      add(groups.tallStatic, G.box(0.054, 0.25, lw - 0.04), C.kick(), lx, 0.14, lz, 0, yaw, 0);
      const vis = add(groups.tallStatic, G.box(0.054, 0.5, 0.12), C.leadGlass(), lx, 1.45, lz, 0, yaw, 0);
      vis.userData.noMerge = true;
      const leafBox = new THREE.Box3(new THREE.Vector3(lx - (alongX ? 0.03 : lw / 2), 0, lz - (alongX ? lw / 2 : 0.03)), new THREE.Vector3(lx + (alongX ? 0.03 : lw / 2), o.head, lz + (alongX ? lw / 2 : 0.03)));
      out.colliders.push(leafBox);
    }
    cur = o.b;
  }
  seg(cur, len, 0, H, true, true);
  // cove base on both faces, round the openings (none across a door)
  let c0 = 0;
  const runs: [number, number][] = [];
  for (const o of ops) {
    if (o.kind === 'door') {
      runs.push([c0, o.a]);
      c0 = o.b;
    }
  }
  runs.push([c0, len]);
  for (const [a, b] of runs) {
    if (b - a < 0.02) continue;
    const m = at((a + b) / 2);
    for (const f of [-1, 1]) add(groups.root, G.box(b - a, 0.1, 0.012), C.base(), m.x + nx * f * (T / 2 + 0.006), 0.05, m.z + nz * f * (T / 2 + 0.006), 0, yaw, 0);
  }
  if (d.cameraWall) {
    const m = at(len / 2);
    const half = new THREE.Vector3(dx * len / 2 + nx * T / 2, 0, dz * len / 2 + nz * T / 2);
    out.cameraBlockers.push(new THREE.Box3(new THREE.Vector3(m.x - half.x, 0, m.z - half.z), new THREE.Vector3(m.x + half.x, H, m.z + half.z)));
  }
}

/** an emergency stop on a wall face: yellow plate, red mushroom */
function wallEstop(g: THREE.Object3D, x: number, y: number, z: number, ry: number) {
  const s = sub(g, x, y, z, 0, ry);
  rb(s, 0.12, 0.16, 0.012, 0.004, C.yellow(), 0, -0.08, 0.006);
  decal(s, 'estop', [120, 160], drawEstop, 0.11, 0.15, 0, 0, 0.0125);
  add(s, G.cyl(0.03, 0.034, 0.035, 18), C.red(), 0, 0, 0.03, PI / 2, 0, 0);
}

/**
 * builder.ts hook, after the props: the CT room's lead-lined partition and the X-ray booth (walls,
 * lead glass, a door), floor colliders and inspect boxes for the equipment, and the parts that move
 * (the rig imagingLife.ts plays). `tallStatic`, `lowStatic` and `root`'s static meshes are merged
 * by the builder; the rig's moving meshes are kept apart (noMerge).
 */
export function dressImagingSuite(layout: LayoutDef, groups: { root: THREE.Group; staticRoot: THREE.Group; tallStatic: THREE.Group; lowStatic: THREE.Group; tall: THREE.Group }): ImagingExtras {
  const out: ImagingExtras = { colliders: [], occluders: [], cameraBlockers: [], interactables: [], rig: { ct: null, xr: null } };
  const byId = (id: string) => layout.props.find((p) => p.id === id);
  // the partitions only where their room is (another map without these rooms gets none)
  const room = (id: string): RoomDef | undefined => layout.rooms.find((r) => r.id === id);
  const inRoom = (r: RoomDef | undefined, x: number, z: number) => !!r && x >= r.rect.x && x <= r.rect.x + r.rect.w && z >= r.rect.z && z <= r.rect.z + r.rect.d;
  for (const d of PARTITIONS) {
    const r = layout.rooms.find((rr) => rr.kind === 'imaging' && inRoom(rr, (d.x1 + d.x2) / 2, (d.z1 + d.z2) / 2));
    if (!r) continue;
    partition({ ...d, color: r.wall }, { root: groups.staticRoot, tallStatic: groups.tallStatic, lowStatic: groups.lowStatic }, out);
  }
  for (const p of layout.props) {
    if (!IMAGING_KINDS.has(p.kind)) continue;
    if (!p.solid) for (const f of FOOT[p.kind] ?? []) {
      const box = worldBox(p, [f[0], 0, f[1], f[2], 2, f[3]]);
      box.min.y = 0;
      out.colliders.push(box);
    }
    const hit = HIT[p.kind];
    const info = IMAGING_INFO[p.kind];
    if (hit && info) {
      const box = worldBox(p, hit);
      // ("CT console", "X-ray tube" keep their capitals)
      const t = /^(CT|X-ray|")/.test(info.title) ? info.title : info.title.charAt(0).toLowerCase() + info.title.slice(1);
      out.interactables.push({ key: `fx:${p.id}`, target: { kind: 'inspect', subject: p.kind, label: `Inspect ${t}` }, box, center: box.getCenter(new THREE.Vector3()) });
    }
  }
  const scanner = layout.props.find((p) => p.kind === 'ctScanner');
  if (scanner && inRoom(room(scanner.room), scanner.x, scanner.z)) out.rig.ct = ctRig(layout, scanner, groups, byId);
  const table = layout.props.find((p) => p.kind === 'xrayTable');
  const stand = layout.props.find((p) => p.kind === 'wallStand');
  const crane = layout.props.find((p) => p.kind === 'xrayTube');
  if (table && stand && crane) out.rig.xr = xrRig(layout, table, stand, crane, groups, out);
  // an emergency stop beside the CT room's connecting door, scan side
  if (out.rig.ct) wallEstop(groups.tallStatic, 37.2 - 0.07, 1.45, 5.65, -PI / 2);
  return out;
}

/** the CT room's moving parts */
function ctRig(layout: LayoutDef, p: PropDef, groups: { root: THREE.Group; tall: THREE.Group }, byId: (id: string) => PropDef | undefined): CtRig {
  const frame = new THREE.Group();
  frame.position.set(p.x, 0, p.z);
  frame.rotation.y = p.rot ?? 0;
  groups.root.add(frame);
  const keep = (m: THREE.Object3D) => {
    m.traverse((o) => (o.userData.noMerge = true));
    return m;
  };
  // couch: lifting column (unit height, scaled), upper body, cradle
  const column = new THREE.Group();
  column.position.set(0, 0.11, 1.86);
  rb(column, 0.38, 1, 0.72, 0.03, C.panel(), 0, 0, 0);
  frame.add(keep(column));
  const upper = new THREE.Group();
  rb(upper, 0.54, 0.16, 1.72, 0.04, C.shell(), 0, 0, 1.86);
  rb(upper, 0.5, 0.02, 1.68, 0.008, C.trim(), 0, 0.15, 1.86);
  frame.add(keep(upper));
  const cradle = new THREE.Group();
  {
    const L = CT.cradleLen;
    // carbon tabletop: its head end at z 0, top at y 0
    rb(cradle, CT.cradleW, CT.cradleT, L, 0.02, C.carbon(), 0, -CT.cradleT, L / 2);
    // the pad from behind the head holder to the foot
    rb(cradle, CT.cradleW - 0.03, CT.padT, L - 0.32, 0.015, C.pad(), 0, 0, 0.3 + (L - 0.32) / 2);
    // head holder: a shallow scoop at pad level with low sides
    rb(cradle, 0.26, CT.padT - 0.002, 0.29, 0.01, C.panel(), 0, 0, 0.16);
    for (const s of [-1, 1]) rb(cradle, 0.02, 0.075, 0.24, 0.008, C.panel(), s * 0.13, CT.padT - 0.004, 0.17);
    rb(cradle, 0.26, 0.03, 0.02, 0.008, C.panel(), 0, CT.padT - 0.004, 0.025);
    // velcro straps hanging at the sides
    for (const z of [0.95, 1.6]) for (const s of [-1, 1]) rb(cradle, 0.006, 0.1, 0.05, 0.002, C.fabric('#2c3f66'), s * (CT.cradleW / 2 + 0.004), -0.1, z);
  }
  frame.add(keep(cradle));
  // lasers: on the front cover and over the body at the external laser plane
  const lasers = new THREE.Group();
  const red = emitter('#ff3020', 4);
  for (const [x, y] of [[0, 1.874], [-0.665, CT.isoY], [0.665, CT.isoY]] as [number, number][]) add(lasers, G.circle(0.009, 10), red, x, y, 0.4535);
  // a unit half-hoop (scaled to the body's section under it), drawn as a 4 mm band
  const arcGeo = new THREE.BufferGeometry();
  {
    const n = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * PI;
      pos.push(Math.cos(a), Math.sin(a), -0.002, Math.cos(a), Math.sin(a), 0.002);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    arcGeo.setIndex(idx);
    arcGeo.computeVertexNormals();
  }
  const redDouble = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ff3020', emissiveIntensity: 4, roughness: 0.9, side: THREE.DoubleSide }));
  const laserArc = add(lasers, trackGeo(arcGeo), redDouble, 0, 0, CT.laserZ);
  const laserPad = new THREE.Group();
  laserPad.position.set(0, 0, CT.laserZ);
  for (const s of [-1, 1]) add(laserPad, G.box(0.1, 0.002, 0.004), red, s * 0.18, 0, 0);
  // the sagittal line along the pad
  add(laserPad, G.box(0.004, 0.002, 2.1), red, 0, 0, 1.05);
  lasers.add(laserPad);
  lasers.visible = false;
  frame.add(keep(lasers));
  // the X-ray-on lamp and the gantry display
  const beamLamp = own(new THREE.MeshStandardMaterial({ color: '#4a3410', emissive: '#ffb020', emissiveIntensity: 0, roughness: 0.3 }));
  add(frame, G.cyl(0.018, 0.018, 0.01, 16), beamLamp, 0.24, 1.715 + 0.075, 0.455, PI / 2, 0, 0).userData.noMerge = true;
  const gantry = screen(frame, 0.31, 0.125, [320, 128], 0, 1.79, 0.4545);
  // the console's screens, in the console's frame
  const cons = byId('ct_console') ?? layout.props.find((q) => q.kind === 'ctConsole');
  const consoleScreens: Screen[] = [];
  let injRemote: Screen;
  let seat = { x: p.x + 4.05, z: p.z + 0.35, rot: -PI / 2 };
  if (cons) {
    const cf = new THREE.Group();
    cf.position.set(cons.x, 0, cons.z);
    cf.rotation.y = cons.rot ?? 0;
    groups.root.add(cf);
    for (const [x, ry] of CONSOLE_MONITORS) {
      const s = sub(cf, x, 0.75, -0.17, 0, ry);
      consoleScreens.push(screen(s, 0.52, 0.325, [832, 520], 0, 0.09 + 0.355 / 2, 0.016));
    }
    const rem = sub(cf, INJ_REMOTE[0], 0.75 + INJ_REMOTE[2], INJ_REMOTE[1], -0.35, 0.35);
    injRemote = screen(rem, 0.23, 0.15, [368, 240], 0, 0, 0.0045);
    const sp = toWorld(cons, CONSOLE_SEAT[0], 0, CONSOLE_SEAT[1]);
    seat = { x: sp.x, z: sp.z, rot: (cons.rot ?? 0) + PI };
  } else injRemote = screen(groups.root, 0.01, 0.01, [16, 16], 0, -10, 0);
  // the injector's head: housing tilted down toward the patient's arm, two syringes, plungers, display
  const inj = byId('ct_injector') ?? layout.props.find((q) => q.kind === 'ctInjector');
  const injFrame = new THREE.Group();
  if (inj) {
    injFrame.position.set(inj.x, 0, inj.z);
    injFrame.rotation.y = inj.rot ?? 0;
  }
  groups.root.add(injFrame);
  const head = sub(injFrame, 0, 1.12, 0.44, 0.85, 0);
  rb(head, 0.2, 0.12, 0.24, 0.03, C.shell(), 0, -0.06, -0.04);
  rb(head, 0.21, 0.02, 0.06, 0.008, C.charcoal(), 0, -0.07, 0.07);
  const injHead = screen(head, 0.13, 0.075, [208, 120], 0, 0.0615, -0.05, -PI / 2);
  const plunger: THREE.Object3D[] = [];
  const fluid: THREE.Object3D[] = [];
  for (const [x, c] of [[-0.05, '#efe3a8'], [0.05, '#dceef4']] as [number, string][]) {
    // barrel along +z from the housing's front, fluid inside (scaled to what is left), plunger behind it
    const barrel = add(head, G.cyl(0.04, 0.04, 0.2, 18), glass('#eaf4f7', 0.3), x, 0, 0.18, PI / 2, 0, 0);
    barrel.userData.noMerge = true;
    const f = new THREE.Group();
    f.position.set(x, 0, 0.28);
    add(f, G.cyl(0.036, 0.036, 1, 16), lambert(c, { roughness: 0.2 }), 0, 0, -0.5, PI / 2, 0, 0);
    head.add(f);
    fluid.push(f);
    const pl = new THREE.Group();
    pl.position.set(x, 0, 0.09);
    add(pl, G.cyl(0.037, 0.037, 0.012, 16), C.black(), 0, 0, 0, PI / 2, 0, 0);
    add(pl, G.cyl(0.008, 0.008, 0.14, 8), C.alu(), 0, 0, -0.07, PI / 2, 0, 0);
    head.add(pl);
    plunger.push(pl);
    add(head, G.cone(0.04, 0.03, 16), glass('#eaf4f7', 0.3), x, 0, 0.295, PI / 2, 0, 0).userData.noMerge = true;
  }
  const led = own(new THREE.MeshStandardMaterial({ color: '#203020', emissive: '#3fb950', emissiveIntensity: 0.4, roughness: 0.3 }));
  add(head, G.sphere(0.008, 8, 6), led, 0.085, 0.0615, -0.12);
  head.traverse((o) => (o.userData.noMerge = true));
  groups.root.updateMatrixWorld(true);
  const tip = head.localToWorld(new THREE.Vector3(0, 0, 0.32));
  // the extension line to the patient's IV: rebuilt by imagingLife.ts as the couch moves
  const lineMat = lambert('#eef4f6', { roughness: 0.3 });
  const line = new THREE.Mesh(new THREE.BufferGeometry(), lineMat);
  line.userData.noMerge = true;
  line.visible = false;
  groups.root.add(line);
  // warning lights over the doors that open on this room
  const warn = layout.props.filter((q) => q.kind === 'xrayWarn' && Math.abs(q.x - (p.x + 1.5)) < 4.5 && q.z < 8).map((q) => warnLens(groups.tall, q));
  const side = toWorld(p, 0.72, 0, CT.hipsHome - 0.15);
  return {
    scanner: p,
    frame,
    column,
    upper,
    cradle,
    lasers,
    laserArc,
    laserPad,
    beamLamp,
    gantry,
    console: consoleScreens,
    injRemote,
    injHead,
    injector: { head, plunger, fluid, led, tip, line, lineMat },
    warn,
    seat,
    tableSide: { x: side.x, z: side.z, rot: (p.rot ?? 0) - PI / 2 },
    sound: { x: p.x, y: CT.isoY, z: p.z },
  };
}

/** the X-ray room's moving parts */
function xrRig(layout: LayoutDef, table: PropDef, stand: PropDef, crane: PropDef, groups: { root: THREE.Group; tall: THREE.Group }, out: ImagingExtras): XrRig {
  const keep = (m: THREE.Object3D) => {
    m.traverse((o) => (o.userData.noMerge = true));
    return m;
  };
  // ── the tube crane: the bridge spans the rails along z and runs along x ──
  const bridge = new THREE.Group();
  const span = XR.railZ[1] - XR.railZ[0] + 0.2;
  const zMid = (XR.railZ[0] + XR.railZ[1]) / 2;
  rb(bridge, 0.18, 0.1, span, 0.015, C.alu(), 0, XR.railY - 0.1, zMid);
  for (const z of XR.railZ) rb(bridge, 0.3, 0.09, 0.18, 0.02, C.panel(), 0, XR.railY - 0.08, z);
  // the carriage on the bridge, the outer column under it
  const carriage = new THREE.Group();
  rb(carriage, 0.34, 0.14, 0.34, 0.03, C.panel(), 0, XR.railY - 0.24, 0);
  rb(carriage, 0.16, 0.42, 0.16, 0.02, C.shell(), 0, XR.railY - 0.66, 0);
  bridge.add(carriage);
  // inner column (a unit tube scaled to reach the yoke)
  const inner = new THREE.Group();
  rb(inner, 0.12, 1, 0.12, 0.015, C.grey(), 0, -1, 0);
  inner.position.set(0, XR.railY - 0.62, 0);
  carriage.add(inner);
  // the yoke at the column's foot holds the tube on its axis (along z, through the focal spot): it stays
  // put while the tube turns in it from beam-down (the table) to beam-horizontal (the wall stand)
  const yoke = new THREE.Group();
  rb(yoke, 0.1, 0.05, 0.66, 0.015, C.panel(), 0, YOKE - 0.05, 0);
  for (const s of [-1, 1]) {
    rb(yoke, 0.07, YOKE - 0.02, 0.035, 0.01, C.panel(), 0, 0.0, s * 0.3);
    add(yoke, G.cyl(0.05, 0.05, 0.03, 18), C.charcoal(), 0, 0, s * 0.275, PI / 2, 0, 0);
  }
  carriage.add(yoke);
  // the tube head: housing along z, collimator under it (beam −y), handles, the collimator's panel; tilts about z
  const head = new THREE.Group();
  add(head, G.cyl(0.11, 0.11, 0.46, 24), C.shell(), 0, 0, 0, PI / 2, 0, 0);
  for (const s of [-1, 1]) add(head, G.cyl(0.115, 0.115, 0.04, 24), C.panel(), 0, 0, s * 0.23, PI / 2, 0, 0);
  rb(head, 0.24, 0.17, 0.24, 0.025, C.panel(), 0, -0.29, 0);
  rb(head, 0.17, 0.012, 0.17, 0.004, C.black(), 0, -0.302, 0);
  for (const s of [-1, 1]) {
    rod(head, 0.012, 0.16, C.charcoal(), s * 0.16, -0.21, 0, 'z', 8);
    for (const z of [-0.07, 0.07]) rb(head, 0.05, 0.012, 0.012, 0.004, C.charcoal(), s * 0.14, -0.215, z);
  }
  rb(head, 0.18, 0.1, 0.012, 0.004, C.charcoal(), 0, -0.26, 0.124);
  add(head, G.plane(0.12, 0.05), lambert('#0d1a14', { emissive: '#3fb950', emissiveIntensity: 0.25 }), 0, -0.21, 0.1315);
  yoke.add(head);
  // collimator light: a warm rectangle with its cross-hair, placed where the beam lands
  const { canvas, ctx } = makeCanvas(256, 256);
  const g2 = ctx.createRadialGradient(128, 128, 20, 128, 128, 180);
  g2.addColorStop(0, 'rgba(255,244,214,0.95)');
  g2.addColorStop(1, 'rgba(255,236,190,0.75)');
  ctx.fillStyle = g2;
  ctx.fillRect(8, 8, 240, 240);
  ctx.fillStyle = 'rgba(40,30,10,0.85)';
  ctx.fillRect(126, 8, 4, 240);
  ctx.fillRect(8, 126, 240, 4);
  const ltex = canvasTexture(canvas);
  const lmat = own(new THREE.MeshBasicMaterial({ map: ltex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const light = add(groups.root, G.plane(1, 1), lmat, 0, -10, 0);
  light.userData.noMerge = true;
  light.visible = false;
  groups.tall.add(keep(bridge));
  bridge.position.set(XR.park.x, 0, 0);
  // ── the wall stand's detector holder (rides the column), with a grab bar above it ──
  const standCarriage = new THREE.Group();
  {
    const sf = new THREE.Group();
    sf.position.set(stand.x, 0, stand.z);
    sf.rotation.y = stand.rot ?? 0;
    groups.root.add(sf);
    rb(standCarriage, 0.14, 0.2, 0.26, 0.02, C.panel(), 0, -0.1, 0.24);
    rb(standCarriage, 0.62, 0.62, 0.1, 0.025, C.shell(), 0, -0.31, XR_STAND_FACE - 0.05);
    decal(standCarriage, 'standFace', [256, 256], drawStandFace, 0.5, 0.5, 0, 0, XR_STAND_FACE + 0.0015);
    rod(standCarriage, 0.015, 0.5, C.chrome(), 0, 0.42, XR_STAND_FACE - 0.03, 'x', 10);
    for (const s of [-1, 1]) rb(standCarriage, 0.02, 0.13, 0.02, 0.006, C.chrome(), s * 0.24, 0.3, XR_STAND_FACE - 0.04);
    sf.add(keep(standCarriage));
    standCarriage.position.y = 1.35;
  }
  // ── the bucky tray under the floating top (rides along the table's long axis) ──
  const bucky = new THREE.Group();
  {
    const tf = new THREE.Group();
    tf.position.set(table.x, 0, table.z);
    tf.rotation.y = table.rot ?? 0;
    groups.root.add(tf);
    rb(bucky, 0.56, 0.06, 0.5, 0.012, C.panel(), 0, XR.top - 0.13, 0);
    rb(bucky, 0.14, 0.035, 0.03, 0.01, C.charcoal(), -0.33, XR.top - 0.115, 0, PI / 2);
    tf.add(keep(bucky));
  }
  // ── booth screens: the acquisition monitor and the generator's panel ──
  const cons = layout.props.find((q) => q.kind === 'xrayConsole');
  let consoleScreen: Screen;
  let gen: Screen;
  let seat = { x: 46.7, z: 5.95, rot: PI };
  if (cons) {
    const cf = new THREE.Group();
    cf.position.set(cons.x, 0, cons.z);
    cf.rotation.y = cons.rot ?? 0;
    groups.root.add(cf);
    const ms = sub(cf, XR_MONITOR[0], 0.76, XR_MONITOR[1], 0, XR_MONITOR[2]);
    consoleScreen = screen(ms, 0.52, 0.325, [832, 520], 0, 0.09 + 0.355 / 2, 0.016);
    const gp = sub(cf, XR_GEN[0], 0.76, XR_GEN[1], -0.35);
    gen = screen(gp, 0.4, 0.22, [400, 220], 0, 0.0515, 0, -PI / 2);
    const sp = toWorld(cons, XR_SEAT[0], 0, XR_SEAT[1]);
    seat = { x: sp.x, z: sp.z, rot: (cons.rot ?? 0) + PI };
  } else {
    consoleScreen = screen(groups.root, 0.01, 0.01, [16, 16], 0, -10, 0);
    gen = screen(groups.root, 0.01, 0.01, [16, 16], 0, -10, 0);
  }
  const warn = layout.props.filter((q) => q.kind === 'xrayWarn' && q.x > table.x - 3.5 && q.x < table.x + 5).map((q) => warnLens(groups.tall, q));
  // the tube's inspect box: moved with the tube
  const tubeBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const tubeHit: Interactable = { key: 'fx:xray_tube', target: { kind: 'inspect', subject: 'xrayTube', label: 'Inspect X-ray tube' }, box: tubeBox, center: new THREE.Vector3() };
  out.interactables.push(tubeHit);
  void crane;
  return { table, stand, bridge, carriage, inner, yoke, head, light, standCarriage, bucky, warn, console: consoleScreen, gen, tubeHit, seat, sound: { x: table.x + 1, y: 1.6, z: table.z } };
}
/** the wall stand's detector face, from the wall (its frame: +z into the room) */
export const XR_STAND_FACE = 0.46;
/** the yoke's top above the tube's axis (the inner column ends there) */
export const YOKE = 0.24;

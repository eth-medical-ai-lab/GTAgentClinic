/**
 * What the CT console, the injector, the gantry's display and the X-ray booth show, drawn to canvases:
 * generic radiology software (no vendor's look or names). The worklist with the protocol; the exam
 * card with the scout (topogram), the planned range, the acquisition's progress and the dose; the
 * reconstructed axial images; the injector's syringes, phases and pressure; the breathing instruction
 * on the gantry; the radiography console with its projections and the generator's kV and mAs.
 *
 * The images are drawn procedurally, once each, at a believable level of anatomy for a glance through
 * a control-room window: a topogram, axial slices (abdomen and pelvis with contrast, head, a pulmonary
 * angiogram), and plain films (chest PA and lateral, ankle, foot). imagingLife.ts calls these with the
 * state of the study (imagingPlan.ts) and redraws only when something visible changed.
 */
import { fit, MONO, rrect, trefoil } from './imaging';
import type { CtProtocol, CtState, XrState, XrStudy } from './imagingPlan';
import { injectionSecs } from './imagingPlan';

const PI = Math.PI;
type Ctx = CanvasRenderingContext2D;

// ── palette: dark radiology UI ──
const UI = {
  bg: '#0d1218',
  panel: '#151d26',
  panel2: '#1b2530',
  line: '#2a3846',
  text: '#d7e1ea',
  dim: '#8293a3',
  accent: '#3d8fd6',
  ok: '#4cc38a',
  warn: '#f2b51c',
  red: '#e5484d',
  xray: '#ffcc33',
};

/** a seeded pseudo-random stream (images are the same every time) */
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

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const grey = (v: number, a = 1) => {
  const g = Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${g},${g},${g},${a})`;
};
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
/** quantum noise over the image */
function grain(ctx: Ctx, w: number, h: number, amt: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const r = rng(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() + r() - 1) * amt;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}
function blur(ctx: Ctx, c: HTMLCanvasElement, px: number) {
  const [t, tc] = canvas(c.width, c.height);
  tc.filter = `blur(${px}px)`;
  tc.drawImage(c, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(t, 0, 0);
}

// ───────────────────────────── procedural images (cached) ─────────────────────────────

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, w: number, h: number, draw: (ctx: Ctx, w: number, h: number) => void): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(w, h);
  draw(ctx, w, h);
  cache.set(key, c);
  return c;
}

/** AP topogram from the lower chest to the hips (radiograph look: bone light, air dark) */
function drawScoutBody(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  // body silhouette: lower chest, waist, hips
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, 0);
  ctx.bezierCurveTo(cx - w * 0.38, h * 0.3, cx - w * 0.33, h * 0.5, cx - w * 0.36, h * 0.72);
  ctx.bezierCurveTo(cx - w * 0.39, h * 0.85, cx - w * 0.36, h * 0.95, cx - w * 0.33, h);
  ctx.lineTo(cx + w * 0.33, h);
  ctx.bezierCurveTo(cx + w * 0.36, h * 0.95, cx + w * 0.39, h * 0.85, cx + w * 0.36, h * 0.72);
  ctx.bezierCurveTo(cx + w * 0.33, h * 0.5, cx + w * 0.38, h * 0.3, cx + w * 0.36, 0);
  ctx.closePath();
  const body = ctx.createLinearGradient(cx - w * 0.36, 0, cx + w * 0.36, 0);
  body.addColorStop(0, grey(70));
  body.addColorStop(0.5, grey(118));
  body.addColorStop(1, grey(70));
  ctx.fillStyle = body;
  ctx.fill();
  // lung bases above the diaphragm (the right dome higher), the heart's shadow
  ellipse(ctx, cx - w * 0.17, h * 0.07, w * 0.14, h * 0.13, grey(28));
  ellipse(ctx, cx + w * 0.17, h * 0.1, w * 0.14, h * 0.12, grey(28));
  ellipse(ctx, cx + w * 0.06, h * 0.06, w * 0.12, h * 0.07, grey(105));
  // liver under the right dome, a little denser
  ellipse(ctx, cx - w * 0.16, h * 0.27, w * 0.18, h * 0.12, grey(132, 0.6));
  // ribs: curves from the spine
  ctx.strokeStyle = grey(165, 0.55);
  ctx.lineWidth = w * 0.016;
  for (let i = 0; i < 5; i++) {
    const y = h * (0.02 + i * 0.07);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * w * 0.04, y);
      ctx.quadraticCurveTo(cx + s * w * 0.32, y - h * 0.02, cx + s * w * 0.3, y + h * 0.1);
      ctx.stroke();
    }
  }
  // bowel gas: colon round the frame, a few small-bowel bubbles
  const r = rng(11);
  for (let i = 0; i < 22; i++) {
    const a = r() * PI * 2;
    const rr = 0.18 + r() * 0.08;
    const x = cx + Math.cos(a) * w * rr;
    const y = h * 0.5 + Math.sin(a) * h * 0.14;
    ellipse(ctx, x, y, w * (0.015 + r() * 0.03), h * (0.008 + r() * 0.015), grey(40, 0.7), r() * PI);
  }
  // spine: vertebral bodies and discs, pedicles
  for (let i = 0; i < 9; i++) {
    const y = h * (0.02 + i * 0.075);
    rrect(ctx, cx - w * 0.055, y, w * 0.11, h * 0.058, 4, grey(190, 0.85));
    ellipse(ctx, cx - w * 0.04, y + h * 0.02, w * 0.012, h * 0.01, grey(225));
    ellipse(ctx, cx + w * 0.04, y + h * 0.02, w * 0.012, h * 0.01, grey(225));
  }
  // pelvis: iliac wings, sacrum, pubic rami, femoral heads
  ctx.fillStyle = grey(175, 0.8);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.06, h * 0.7);
    ctx.quadraticCurveTo(cx + s * w * 0.34, h * 0.62, cx + s * w * 0.31, h * 0.8);
    ctx.quadraticCurveTo(cx + s * w * 0.2, h * 0.86, cx + s * w * 0.08, h * 0.84);
    ctx.closePath();
    ctx.fill();
    ellipse(ctx, cx + s * w * 0.21, h * 0.9, w * 0.06, w * 0.06, grey(205));
    ctx.strokeStyle = grey(180, 0.8);
    ctx.lineWidth = w * 0.025;
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.02, h * 0.95);
    ctx.quadraticCurveTo(cx + s * w * 0.1, h * 0.9, cx + s * w * 0.17, h * 0.96);
    ctx.stroke();
  }
  ellipse(ctx, cx, h * 0.8, w * 0.07, h * 0.07, grey(160, 0.8));
  blur(ctx, ctx.canvas, 1.2);
  grain(ctx, w, h, 14, 5);
}

/** lateral topogram of the head */
function drawScoutHead(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.5;
  const cy = h * 0.42;
  ellipse(ctx, cx, cy, w * 0.36, h * 0.3, grey(150));
  ellipse(ctx, cx, cy, w * 0.33, h * 0.27, grey(95));
  // face and jaw to the left, skull base, cervical spine
  ctx.fillStyle = grey(120);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, cy + h * 0.1);
  ctx.quadraticCurveTo(cx - w * 0.36, cy + h * 0.35, cx - w * 0.15, cy + h * 0.45);
  ctx.lineTo(cx + w * 0.05, cy + h * 0.4);
  ctx.lineTo(cx + w * 0.1, cy + h * 0.2);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, cx - w * 0.2, cy + h * 0.1, w * 0.06, h * 0.05, grey(35));
  for (let i = 0; i < 5; i++) rrect(ctx, cx + w * 0.12, cy + h * (0.28 + i * 0.13), w * 0.12, h * 0.1, 4, grey(170));
  blur(ctx, ctx.canvas, 1);
  grain(ctx, w, h, 12, 9);
}

/** AP topogram of the chest */
function drawScoutChest(ctx: Ctx, w: number, h: number) {
  drawChestFilm(ctx, w, h, 0.9);
}

/** a plain chest film, PA (lungs black, bone white); `soft` lowers the contrast (a scout) */
function drawChestFilm(ctx: Ctx, w: number, h: number, soft = 1) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  // soft tissues of the chest wall and shoulders
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.47, h * 0.12);
  ctx.quadraticCurveTo(cx - w * 0.5, h * 0.6, cx - w * 0.42, h);
  ctx.lineTo(cx + w * 0.42, h);
  ctx.quadraticCurveTo(cx + w * 0.5, h * 0.6, cx + w * 0.47, h * 0.12);
  ctx.quadraticCurveTo(cx, h * 0.02, cx - w * 0.47, h * 0.12);
  ctx.fillStyle = grey(110 * soft);
  ctx.fill();
  // lungs
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.06, h * 0.12);
    ctx.quadraticCurveTo(cx + s * w * 0.4, h * 0.14, cx + s * w * 0.4, h * (s < 0 ? 0.72 : 0.76));
    ctx.quadraticCurveTo(cx + s * w * 0.22, h * (s < 0 ? 0.66 : 0.7), cx + s * w * 0.06, h * 0.7);
    ctx.closePath();
    const lg = ctx.createRadialGradient(cx + s * w * 0.2, h * 0.4, w * 0.05, cx + s * w * 0.2, h * 0.4, w * 0.35);
    lg.addColorStop(0, grey(22));
    lg.addColorStop(1, grey(48));
    ctx.fillStyle = lg;
    ctx.fill();
  }
  // mediastinum, heart (to the patient's left: image right), aortic knob, trachea
  ctx.fillStyle = grey(200 * soft);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.07, h * 0.1);
  ctx.lineTo(cx + w * 0.07, h * 0.1);
  ctx.quadraticCurveTo(cx + w * 0.1, h * 0.3, cx + w * 0.12, h * 0.42);
  ctx.quadraticCurveTo(cx + w * 0.28, h * 0.52, cx + w * 0.22, h * 0.72);
  ctx.lineTo(cx - w * 0.12, h * 0.72);
  ctx.quadraticCurveTo(cx - w * 0.16, h * 0.55, cx - w * 0.08, h * 0.42);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, cx + w * 0.08, h * 0.25, w * 0.04, h * 0.03, grey(205 * soft));
  ctx.fillStyle = grey(70);
  ctx.fillRect(cx - w * 0.012, h * 0.03, w * 0.024, h * 0.22);
  // hila
  for (const s of [-1, 1]) ellipse(ctx, cx + s * w * 0.11, h * 0.38, w * 0.035, h * 0.05, grey(120 * soft, 0.8));
  // diaphragm and the abdomen below it
  ctx.fillStyle = grey(175 * soft);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.42, h);
  ctx.lineTo(cx - w * 0.42, h * 0.74);
  ctx.quadraticCurveTo(cx - w * 0.22, h * 0.62, cx - w * 0.05, h * 0.72);
  ctx.quadraticCurveTo(cx + w * 0.22, h * 0.66, cx + w * 0.42, h * 0.78);
  ctx.lineTo(cx + w * 0.42, h);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, cx + w * 0.2, h * 0.79, w * 0.06, h * 0.025, grey(40, 0.9)); // gastric bubble
  // ribs (posterior, curving down and out), clavicles, spine through the heart
  ctx.strokeStyle = grey(200 * soft, 0.5);
  ctx.lineWidth = w * 0.014;
  for (let i = 0; i < 9; i++) {
    const y = h * (0.12 + i * 0.065);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * w * 0.03, y);
      ctx.bezierCurveTo(cx + s * w * 0.25, y - h * 0.04, cx + s * w * 0.42, y + h * 0.02, cx + s * w * 0.4, y + h * 0.1);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = grey(225 * soft);
  ctx.lineWidth = w * 0.022;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.05, h * 0.11);
    ctx.quadraticCurveTo(cx + s * w * 0.25, h * 0.06, cx + s * w * 0.42, h * 0.09);
    ctx.stroke();
  }
  for (let i = 0; i < 10; i++) rrect(ctx, cx - w * 0.03, h * (0.06 + i * 0.07), w * 0.06, h * 0.05, 3, grey(170 * soft, 0.35));
  blur(ctx, ctx.canvas, 1.1);
  grain(ctx, w, h, 10, 3);
}

/** lateral chest film (facing left: the sternum on the left, the spine on the right) */
function drawChestLat(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, h * 0.08);
  ctx.quadraticCurveTo(cx - w * 0.44, h * 0.6, cx - w * 0.3, h);
  ctx.lineTo(cx + w * 0.38, h);
  ctx.quadraticCurveTo(cx + w * 0.46, h * 0.5, cx + w * 0.34, h * 0.06);
  ctx.closePath();
  ctx.fillStyle = grey(105);
  ctx.fill();
  ellipse(ctx, cx, h * 0.42, w * 0.32, h * 0.32, grey(42));
  ellipse(ctx, cx - w * 0.08, h * 0.56, w * 0.18, h * 0.17, grey(165));
  for (let i = 0; i < 10; i++) rrect(ctx, cx + w * 0.24, h * (0.08 + i * 0.075), w * 0.1, h * 0.06, 3, grey(185));
  ctx.strokeStyle = grey(200);
  ctx.lineWidth = w * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.33, h * 0.12);
  ctx.quadraticCurveTo(cx - w * 0.38, h * 0.4, cx - w * 0.34, h * 0.62);
  ctx.stroke();
  ctx.fillStyle = grey(170);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.4, h);
  ctx.lineTo(cx - w * 0.4, h * 0.76);
  ctx.quadraticCurveTo(cx, h * 0.66, cx + w * 0.4, h * 0.84);
  ctx.lineTo(cx + w * 0.4, h);
  ctx.closePath();
  ctx.fill();
  blur(ctx, ctx.canvas, 1.1);
  grain(ctx, w, h, 10, 4);
}

/** ankle: AP (or the mortise, a little turned) and lateral */
function drawAnkle(ctx: Ctx, w: number, h: number, view: string) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const lat = view === 'LAT';
  // soft tissue
  ctx.fillStyle = grey(70);
  if (lat) {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.14, 0);
    ctx.lineTo(cx + w * 0.14, 0);
    ctx.quadraticCurveTo(cx + w * 0.2, h * 0.7, cx + w * 0.22, h * 0.86);
    ctx.lineTo(cx - w * 0.45, h * 0.9);
    ctx.quadraticCurveTo(cx - w * 0.4, h * 0.72, cx - w * 0.16, h * 0.62);
    ctx.closePath();
    ctx.fill();
  } else ellipse(ctx, cx, h * 0.5, w * 0.28, h * 0.62, grey(70));
  ctx.fillStyle = grey(205);
  if (lat) {
    // tibia, fibula behind it, talus dome, calcaneus, navicular
    ctx.fillRect(cx - w * 0.08, 0, w * 0.15, h * 0.55);
    ellipse(ctx, cx + w * 0.02, h * 0.62, w * 0.1, h * 0.07, grey(215));
    ellipse(ctx, cx + w * 0.06, h * 0.78, w * 0.13, h * 0.08, grey(200));
    ellipse(ctx, cx - w * 0.14, h * 0.7, w * 0.07, h * 0.05, grey(195));
    ellipse(ctx, cx - w * 0.28, h * 0.78, w * 0.12, h * 0.04, grey(185));
  } else {
    const turn = view === 'Mortise' ? 0.04 : 0;
    ctx.fillRect(cx - w * 0.16, 0, w * 0.22, h * 0.58);
    ctx.fillRect(cx + w * (0.1 - turn), 0, w * 0.06, h * 0.66);
    // the medial malleolus, the mortise's even joint space, the talus
    ellipse(ctx, cx - w * 0.14, h * 0.62, w * 0.04, h * 0.06, grey(205));
    ctx.fillStyle = grey(30);
    ctx.fillRect(cx - w * 0.12, h * 0.585, w * (0.22 - turn), h * 0.015);
    ellipse(ctx, cx - w * 0.02, h * 0.7, w * 0.13, h * 0.09, grey(212));
    ellipse(ctx, cx - w * 0.02, h * 0.86, w * 0.17, h * 0.08, grey(190));
  }
  // cortex lines
  ctx.strokeStyle = grey(240, 0.6);
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - w * (lat ? 0.08 : 0.16), -2, w * (lat ? 0.15 : 0.22), h * (lat ? 0.55 : 0.58));
  blur(ctx, ctx.canvas, 1);
  grain(ctx, w, h, 9, 6);
}

/** foot: AP / oblique (metatarsals fanning out) or lateral */
function drawFoot(ctx: Ctx, w: number, h: number, view: string) {
  if (view === 'LAT') return drawAnkle(ctx, w, h, 'LAT');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ellipse(ctx, cx, h * 0.55, w * 0.3, h * 0.48, grey(70));
  ellipse(ctx, cx, h * 0.86, w * 0.16, h * 0.1, grey(195));
  ellipse(ctx, cx - w * 0.04, h * 0.7, w * 0.12, h * 0.06, grey(200));
  for (let i = 0; i < 5; i++) {
    const x = cx - w * 0.16 + i * w * 0.08;
    ctx.save();
    ctx.translate(x, h * 0.42);
    ctx.rotate((i - 2) * (view === 'Oblique' ? 0.1 : 0.06));
    rrect(ctx, -w * 0.022, -h * 0.17, w * 0.044, h * 0.24, 6, grey(205));
    rrect(ctx, -w * 0.02, -h * 0.34, w * 0.04, h * 0.14, 6, grey(200));
    ctx.restore();
  }
  blur(ctx, ctx.canvas, 1);
  grain(ctx, w, h, 9, 8);
}

/** axial CT, soft-tissue window: abdomen at the kidneys, portal venous phase */
function drawAxialAbdomen(ctx: Ctx, w: number, h: number, slice: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.53;
  const r = rng(21 + Math.round(slice * 10));
  // the couch under the patient
  ctx.strokeStyle = grey(150);
  ctx.lineWidth = w * 0.012;
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.6, w * 0.6, h * 0.29, 0, PI * 1.12, PI * 1.88);
  ctx.stroke();
  // body: subcutaneous fat, then the muscle wall, then the abdominal cavity
  ellipse(ctx, cx, cy, w * 0.43, h * 0.31, grey(70));
  ellipse(ctx, cx, cy, w * 0.4, h * 0.28, grey(118));
  ellipse(ctx, cx, cy + h * 0.005, w * 0.37, h * 0.255, grey(68));
  // rectus muscles in front, paraspinal muscles behind
  for (const s of [-1, 1]) {
    ellipse(ctx, cx + s * w * 0.05, cy - h * 0.25, w * 0.045, h * 0.02, grey(125));
    ellipse(ctx, cx + s * w * 0.075, cy + h * 0.2, w * 0.07, h * 0.06, grey(128));
    ellipse(ctx, cx + s * w * 0.09, cy + h * 0.08, w * 0.03, h * 0.04, grey(130)); // psoas
  }
  // liver (image left = patient's right), spleen tip
  ctx.fillStyle = grey(172);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.35, cy - h * 0.05);
  ctx.quadraticCurveTo(cx - w * 0.33, cy - h * 0.2, cx - w * 0.12, cy - h * 0.18);
  ctx.quadraticCurveTo(cx - w * 0.14, cy - h * 0.02, cx - w * 0.2, cy + h * 0.08);
  ctx.quadraticCurveTo(cx - w * 0.33, cy + h * 0.1, cx - w * 0.35, cy - h * 0.05);
  ctx.fill();
  ellipse(ctx, cx + w * 0.3, cy - h * 0.02, w * 0.055, h * 0.08, grey(165), 0.3);
  // kidneys: enhancing cortex, medulla, the renal pelvis
  for (const s of [-1, 1]) {
    const kx = cx + s * w * 0.17;
    const ky = cy + h * 0.06;
    ellipse(ctx, kx, ky, w * 0.055, h * 0.075, grey(205), s * 0.5);
    ellipse(ctx, kx - s * w * 0.008, ky, w * 0.032, h * 0.05, grey(178), s * 0.5);
    ellipse(ctx, kx - s * w * 0.03, ky + h * 0.005, w * 0.012, h * 0.016, grey(60));
  }
  // vertebral body, canal, spinous process; aorta to the patient's left of it, IVC to the right
  ellipse(ctx, cx, cy + h * 0.1, w * 0.055, h * 0.06, grey(235));
  ellipse(ctx, cx, cy + h * 0.1, w * 0.04, h * 0.045, grey(200));
  ellipse(ctx, cx, cy + h * 0.18, w * 0.022, h * 0.022, grey(70));
  ellipse(ctx, cx, cy + h * 0.24, w * 0.015, h * 0.03, grey(230));
  ellipse(ctx, cx + w * 0.035, cy + h * 0.01, w * 0.025, w * 0.025, grey(222));
  ellipse(ctx, cx - w * 0.06, cy + h * 0.005, w * 0.03, w * 0.022, grey(190));
  // bowel loops: walls enhancing, fluid, a few with air; the colon at the flanks with mottled stool
  for (let i = 0; i < 26; i++) {
    const a = r() * PI * 2;
    const d = r() * 0.6;
    const x = cx + Math.cos(a) * w * 0.2 * d + w * 0.02;
    const y = cy - h * 0.09 + Math.sin(a) * h * 0.1 * d;
    const rr = w * (0.018 + r() * 0.018);
    ellipse(ctx, x, y, rr, rr * (0.7 + r() * 0.5), grey(150));
    ellipse(ctx, x, y, rr * 0.7, rr * 0.55, r() < 0.3 ? grey(10) : grey(105));
  }
  for (const s of [-1, 1]) {
    const x = cx + s * w * 0.29;
    const y = cy + h * 0.07;
    ellipse(ctx, x, y, w * 0.045, h * 0.05, grey(140));
    for (let i = 0; i < 6; i++) ellipse(ctx, x + (r() - 0.5) * w * 0.05, y + (r() - 0.5) * h * 0.05, w * 0.01, w * 0.008, grey(20));
  }
  blur(ctx, ctx.canvas, 0.8);
  grain(ctx, w, h, 16, 13 + Math.round(slice * 10));
}

/** axial CT of the head (brain window), at the lateral ventricles */
function drawAxialHead(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.5;
  ellipse(ctx, cx, cy, w * 0.32, h * 0.4, grey(250));
  ellipse(ctx, cx, cy, w * 0.29, h * 0.37, grey(118));
  // grey-white differentiation, ventricles, the falx
  ellipse(ctx, cx, cy, w * 0.24, h * 0.31, grey(104));
  for (const s of [-1, 1]) {
    ellipse(ctx, cx + s * w * 0.04, cy - h * 0.05, w * 0.02, h * 0.1, grey(40), s * 0.15);
    ellipse(ctx, cx + s * w * 0.055, cy + h * 0.08, w * 0.015, h * 0.04, grey(40), -s * 0.3);
  }
  ctx.strokeStyle = grey(160);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.37);
  ctx.lineTo(cx, cy - h * 0.16);
  ctx.moveTo(cx, cy + h * 0.16);
  ctx.lineTo(cx, cy + h * 0.37);
  ctx.stroke();
  blur(ctx, ctx.canvas, 0.8);
  grain(ctx, w, h, 12, 17);
}

/** axial CT pulmonary angiogram (mediastinal window): bright pulmonary arteries, the lungs black */
function drawAxialChest(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.52;
  ellipse(ctx, cx, cy, w * 0.44, h * 0.3, grey(110));
  for (const s of [-1, 1]) ellipse(ctx, cx + s * w * 0.2, cy, w * 0.17, h * 0.22, grey(6));
  ellipse(ctx, cx, cy - h * 0.02, w * 0.09, h * 0.12, grey(120));
  // pulmonary trunk and its branches, aorta
  ellipse(ctx, cx + w * 0.02, cy - h * 0.06, w * 0.04, w * 0.04, grey(240));
  ctx.strokeStyle = grey(235);
  ctx.lineWidth = w * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.15, cy - h * 0.02);
  ctx.quadraticCurveTo(cx, cy - h * 0.1, cx + w * 0.14, cy - h * 0.01);
  ctx.stroke();
  ellipse(ctx, cx - w * 0.04, cy - h * 0.1, w * 0.028, w * 0.028, grey(225));
  ellipse(ctx, cx + w * 0.04, cy + h * 0.1, w * 0.025, w * 0.025, grey(225));
  ellipse(ctx, cx, cy + h * 0.2, w * 0.045, h * 0.05, grey(235));
  blur(ctx, ctx.canvas, 0.8);
  grain(ctx, w, h, 14, 19);
}

export function scoutFor(p: CtProtocol): HTMLCanvasElement {
  if (p.region === 'head') return cached('scout:head', 300, 300, drawScoutHead);
  if (p.region === 'chest') return cached('scout:chest', 300, 360, drawScoutChest);
  return cached('scout:body', 260, 420, drawScoutBody);
}
export function axialFor(p: CtProtocol, k: number): HTMLCanvasElement {
  if (p.region === 'head') return cached('ax:head', 256, 256, drawAxialHead);
  if (p.region === 'chest') return cached('ax:chest', 256, 256, drawAxialChest);
  const s = Math.max(0, Math.min(3, Math.floor(k * 4)));
  return cached(`ax:abd:${s}`, 256, 256, (ctx, w, h) => drawAxialAbdomen(ctx, w, h, s));
}
export function filmFor(st: XrStudy, view: string): HTMLCanvasElement {
  if (st.code === 'xr_chest') return view === 'LAT' ? cached('film:cxrlat', 300, 330, drawChestLat) : cached('film:cxr', 330, 330, (c, w, h) => drawChestFilm(c, w, h));
  if (st.code === 'xr_foot') return cached(`film:foot:${view}`, 240, 330, (c, w, h) => drawFoot(c, w, h, view));
  return cached(`film:ankle:${view}`, 240, 330, (c, w, h) => drawAnkle(c, w, h, view));
}

// ───────────────────────────── UI pieces ─────────────────────────────

function topBar(ctx: Ctx, w: number, title: string, right: string, sub?: string) {
  ctx.fillStyle = '#1c2a38';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = UI.accent;
  ctx.fillRect(0, 42, w, 2);
  fit(ctx, title, 16, 23, w * 0.5, 22, 800, 'left', UI.text);
  if (sub) fit(ctx, sub, w * 0.42, 23, w * 0.4, 17, 600, 'left', UI.dim);
  fit(ctx, right, w - 16, 23, w * 0.25, 18, 700, 'right', UI.text, MONO);
}
function bar(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, color: string) {
  rrect(ctx, x, y, w, h, h / 2, '#0a0f14', UI.line, 1);
  if (k > 0.002) rrect(ctx, x + 1, y + 1, Math.max(h - 2, (w - 2) * Math.min(1, k)), h - 2, (h - 2) / 2, color);
}
function statusDot(ctx: Ctx, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, PI * 2);
  ctx.fill();
}
/** the radiation-on indicator: yellow with the trefoil when the beam is on */
function xrayBadge(ctx: Ctx, x: number, y: number, on: boolean, label = 'X-RAY') {
  rrect(ctx, x, y, 132, 40, 8, on ? UI.xray : '#2a3138', on ? '#fff3c4' : UI.line, 2);
  trefoil(ctx, x + 22, y + 20, 13, on ? '#141414' : '#56616b');
  fit(ctx, label, x + 82, y + 21, 84, 18, 900, 'center', on ? '#141414' : '#7b8791');
}

export interface CtScreenInfo {
  clock: string;
  /** "LASTNAME, First", the accession, age/sex when known */
  patient: { name: string; id: string; age?: number; sex?: string } | null;
  protocol: CtProtocol | null;
  st: CtState;
  progress: number;
  /** the slot: "Ordered 23:10" etc. */
  since?: string;
}

const PHASE_TEXT: Record<string, string> = {
  idle: 'Ready',
  arrive: 'Patient arriving',
  position: 'Positioning',
  toConsole: 'Ready for topogram',
  scout: 'Topogram',
  plan: 'Planning scan range',
  inject: 'Injection running',
  scan: 'Scanning',
  recon: 'Reconstructing',
  return: 'Exam complete',
  unload: 'Exam complete',
  done: 'Exam complete',
};

/** monitor 1: the worklist and the protocol */
export function drawCtWorklist(ctx: Ctx, w: number, h: number, s: CtScreenInfo) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, w, h);
  topBar(ctx, w, 'Worklist', s.clock, 'CT 1 · Emergency');
  // the scheduled exams
  const x0 = 14;
  const tw = w * 0.56;
  rrect(ctx, x0, 56, tw, h - 100, 8, UI.panel);
  fit(ctx, 'Scheduled', x0 + 14, 76, 200, 17, 800, 'left', UI.dim);
  const cols = [x0 + 14, x0 + 74, x0 + 260, x0 + 360];
  ['Time', 'Patient', 'Accession', 'Status'].forEach((c, i) => fit(ctx, c, cols[i], 102, 160, 14, 700, 'left', UI.dim));
  ctx.fillStyle = UI.line;
  ctx.fillRect(x0 + 10, 112, tw - 20, 1);
  const rows: [string, string, string, string, string][] = [
    ['21:40', 'GARCIA, Elena', 'CT26-48211', 'Done', UI.ok],
    ['22:15', 'NOWAK, Piotr', 'CT26-48230', 'Done', UI.ok],
  ];
  if (s.patient) rows.push([s.since ?? '—', s.patient.name, s.patient.id, s.st.phase === 'done' || s.st.phase === 'return' || s.st.phase === 'unload' ? 'Done' : 'In progress', s.st.phase === 'done' ? UI.ok : UI.warn]);
  rows.push(['—', 'WARD 2E, bed 204', 'CT26-48244', 'Scheduled', UI.dim]);
  rows.forEach(([t, n, a, st, col], i) => {
    const y = 134 + i * 40;
    const cur = s.patient && n === s.patient.name;
    if (cur) rrect(ctx, x0 + 6, y - 16, tw - 12, 34, 6, '#1f3b57');
    fit(ctx, t, cols[0], y, 54, 15, 600, 'left', UI.text, MONO);
    fit(ctx, n, cols[1], y, 178, 16, cur ? 800 : 600, 'left', UI.text);
    fit(ctx, a, cols[2], y, 96, 13, 600, 'left', UI.dim, MONO);
    statusDot(ctx, cols[3] + 6, y, col);
    fit(ctx, st, cols[3] + 18, y, 90, 14, 700, 'left', UI.text);
  });
  // the protocol card
  const px = x0 + tw + 12;
  const pw = w - px - 14;
  rrect(ctx, px, 56, pw, h - 100, 8, UI.panel);
  fit(ctx, 'Protocol', px + 14, 76, 200, 17, 800, 'left', UI.dim);
  const p = s.protocol;
  if (p) {
    const tree = p.region === 'head' ? 'Adult › Head' : p.region === 'chest' ? 'Adult › Chest' : p.region === 'aorta' ? 'Adult › Angio' : 'Adult › Abdomen';
    fit(ctx, tree, px + 14, 102, pw - 28, 14, 600, 'left', UI.dim);
    rrect(ctx, px + 10, 116, pw - 20, 50, 6, '#1f3b57');
    fit(ctx, p.name, px + 20, 141, pw - 40, 19, 800, 'left', '#ffffff');
    const kv: [string, string][] = [
      ['Position', p.region === 'head' ? 'Head first, supine' : 'Head first, supine, arms up'],
      ['kV / ref mAs', `${p.kv} / ${p.mas}  (dose mod.)`],
      ['Rotation / pitch', `${p.rot.toFixed(2)} s / ${p.pitch.toFixed(2)}`],
      ['Collimation', '64 × 0.6 mm'],
      ['Recon', p.region === 'head' ? '5 mm axial, brain + bone' : '3 mm + 1 mm, soft tissue'],
      ['Contrast', p.contrast ? `${p.ml} mL @ ${p.rate} mL/s, ${p.tracking ? 'bolus tracking' : `delay ${p.delay} s`}` : 'None'],
      ['Breath hold', p.breathHold ? 'Inspiration, auto voice' : '—'],
    ];
    kv.forEach(([k, v], i) => {
      const y = 190 + i * 32;
      fit(ctx, k, px + 16, y, pw * 0.38, 14, 600, 'left', UI.dim);
      fit(ctx, v, px + pw * 0.42, y, pw * 0.56, 15, 700, 'left', UI.text);
    });
  } else fit(ctx, 'No exam selected', px + 14, 140, pw - 28, 18, 600, 'left', UI.dim);
  // status line
  ctx.fillStyle = UI.panel2;
  ctx.fillRect(0, h - 34, w, 34);
  statusDot(ctx, 22, h - 17, s.st.beam ? UI.xray : s.patient ? UI.warn : UI.ok);
  fit(ctx, s.patient ? PHASE_TEXT[s.st.phase] ?? '' : 'System ready · tube warm', 38, h - 17, w * 0.6, 15, 700, 'left', UI.text);
  fit(ctx, 'Tube 42 % · Gantry OK', w - 14, h - 17, w * 0.35, 14, 600, 'right', UI.dim);
}

/** monitor 2: the exam card: scout with the planned range, the steps, progress, the X-ray indicator, dose */
export function drawCtExam(ctx: Ctx, w: number, h: number, s: CtScreenInfo) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, w, h);
  const p = s.protocol;
  topBar(ctx, w, 'Examination', s.clock, s.patient ? `${s.patient.name} · ${s.patient.id}` : '');
  // scout viewport
  const vx = 14;
  const vy = 56;
  const vw = w * 0.4;
  const vh = h - 70;
  ctx.fillStyle = '#000';
  ctx.fillRect(vx, vy, vw, vh);
  ctx.strokeStyle = UI.line;
  ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
  if (p && s.st.scout > 0) {
    const img = scoutFor(p);
    const k = Math.min(vw / img.width, vh / img.height) * 0.96;
    const iw = img.width * k;
    const ih = img.height * k;
    const ix = vx + (vw - iw) / 2;
    const iy = vy + (vh - ih) / 2;
    // the topogram builds up as the couch moves through
    const shown = Math.max(0.001, Math.min(1, s.st.scout));
    ctx.drawImage(img, 0, 0, img.width, img.height * shown, ix, iy, iw, ih * shown);
    if (s.st.scout >= 1) {
      // the planned range (and where the helical has got to)
      const [a, b] = p.region === 'head' ? [0.12, 0.88] : p.region === 'chest' ? [0.08, 0.85] : [0.06, 0.92];
      const y0 = iy + ih * a;
      const y1 = iy + ih * b;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(ix + iw * 0.08, y0, iw * 0.84, y1 - y0);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,211,77,0.08)';
      ctx.fillRect(ix + iw * 0.08, y0, iw * 0.84, y1 - y0);
      if (s.st.scan > 0 && s.st.scan < 1) {
        const y = y0 + (y1 - y0) * s.st.scan;
        ctx.fillStyle = '#4cc3ff';
        ctx.fillRect(ix + iw * 0.05, y - 1.5, iw * 0.9, 3);
      }
      fit(ctx, `${Math.round((y1 - y0) / ih * (p.region === 'head' ? 22 : p.region === 'chest' ? 32 : 46))} cm`, ix + iw * 0.9, y0 - 12, 80, 14, 700, 'right', '#ffd34d');
    }
    fit(ctx, 'R', vx + 12, vy + 18, 20, 16, 800, 'left', UI.dim);
    fit(ctx, 'Topogram AP', vx + vw - 10, vy + 18, vw * 0.6, 14, 700, 'right', UI.dim);
  } else {
    fit(ctx, p ? 'Topogram' : 'No exam', vx + vw / 2, vy + vh / 2 - 10, vw * 0.8, 20, 700, 'center', UI.dim);
    if (p) fit(ctx, 'Press START', vx + vw / 2, vy + vh / 2 + 18, vw * 0.8, 15, 600, 'center', '#56616b');
  }
  // the exam's steps
  const sx = vx + vw + 16;
  const sw = w - sx - 14;
  rrect(ctx, sx, 56, sw, 230, 8, UI.panel);
  const steps: [string, number][] = [['Topogram', s.st.scout]];
  if (p?.contrast) steps.push([p.tracking ? 'Bolus tracking' : 'Contrast', s.st.phase === 'inject' ? 0.5 : s.st.scan > 0 || ['scan', 'recon', 'return', 'unload', 'done'].includes(s.st.phase) ? 1 : 0]);
  steps.push([p ? (p.region === 'head' ? 'Head, axial' : p.region === 'chest' ? 'Chest, helical' : p.region === 'aorta' ? 'Chest-pelvis, helical' : 'Abdomen-pelvis, helical') : 'Scan', s.st.scan]);
  steps.push(['Reconstruction', ['return', 'unload', 'done'].includes(s.st.phase) ? 1 : s.st.phase === 'recon' ? s.st.u : 0]);
  steps.forEach(([name, k], i) => {
    const y = 84 + i * 50;
    const done = k >= 1;
    const busy = k > 0 && k < 1;
    rrect(ctx, sx + 10, y - 18, sw - 20, 40, 6, busy ? '#1f3b57' : UI.panel2);
    statusDot(ctx, sx + 28, y + 2, done ? UI.ok : busy ? UI.warn : '#3a4652');
    fit(ctx, name, sx + 44, y + 2, sw * 0.5, 16, 700, 'left', UI.text);
    fit(ctx, done ? 'Done' : busy ? `${Math.round(k * 100)} %` : '—', sx + sw - 22, y + 2, 90, 15, 700, 'right', done ? UI.ok : busy ? UI.warn : UI.dim, MONO);
  });
  // progress and the beam
  const by = 300;
  rrect(ctx, sx, by, sw, h - by - 14, 8, UI.panel);
  fit(ctx, s.patient ? PHASE_TEXT[s.st.phase] ?? '' : 'Ready', sx + 14, by + 24, sw * 0.6, 18, 800, 'left', UI.text);
  bar(ctx, sx + 14, by + 44, sw - 28, 18, s.progress, UI.accent);
  xrayBadge(ctx, sx + 14, by + 76, s.st.beam);
  if (s.st.breath) {
    rrect(ctx, sx + 160, by + 76, sw - 174, 40, 8, s.st.breath === 'hold' ? '#3b2f12' : '#163126', s.st.breath === 'hold' ? UI.warn : UI.ok, 2);
    fit(ctx, s.st.breath === 'hold' ? 'BREATH HOLD' : 'BREATHE', sx + 160 + (sw - 174) / 2, by + 97, sw - 190, 17, 900, 'center', s.st.breath === 'hold' ? UI.warn : UI.ok);
  }
  if (p && s.st.scan >= 1) {
    fit(ctx, `CTDIvol ${p.ctdi.toFixed(1)} mGy   DLP ${p.dlp} mGy·cm`, sx + 14, h - 36, sw - 28, 15, 700, 'left', UI.dim, MONO);
  } else if (p) fit(ctx, `${p.kv} kV · ${p.mas} mAs · ${p.rot} s · pitch ${p.pitch}`, sx + 14, h - 36, sw - 28, 15, 600, 'left', UI.dim, MONO);
}

/** monitor 3: the reconstructed images (a 2×2 of axial slices), or the viewer waiting */
export function drawCtImages(ctx: Ctx, w: number, h: number, s: CtScreenInfo) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  topBar(ctx, w, 'Viewer', s.clock, s.patient && s.protocol ? s.protocol.name : '');
  const p = s.protocol;
  const ready = p && (s.st.phase === 'recon' || ['return', 'unload', 'done'].includes(s.st.phase));
  if (!p || !ready) {
    fit(ctx, s.st.phase === 'scan' ? 'Acquiring…' : 'No images', w / 2, h / 2, w * 0.6, 22, 700, 'center', '#56616b');
    return;
  }
  const n = s.st.phase === 'recon' ? Math.max(1, Math.ceil(s.st.u * 4)) : 4;
  const cw = (w - 30) / 2;
  const ch = (h - 64) / 2;
  for (let i = 0; i < n; i++) {
    const img = axialFor(p, i / 4);
    const x = 10 + (i % 2) * (cw + 10);
    const y = 52 + Math.floor(i / 2) * (ch + 6);
    const k = Math.min(cw / img.width, ch / img.height);
    ctx.drawImage(img, x + (cw - img.width * k) / 2, y + (ch - img.height * k) / 2, img.width * k, img.height * k);
    fit(ctx, `${p.region === 'head' ? 'Brain' : 'Soft tissue'}  ${p.region === 'head' ? 'W80 L40' : 'W400 L40'}`, x + 8, y + 14, cw * 0.7, 12, 600, 'left', '#9fb0bf', MONO);
    fit(ctx, `Im ${i * 12 + 18}`, x + cw - 8, y + ch - 12, 80, 12, 600, 'right', '#9fb0bf', MONO);
  }
}

/** the injector's remote on the console */
export function drawInjector(ctx: Ctx, w: number, h: number, p: CtProtocol | null, st: CtState) {
  ctx.fillStyle = '#0e141a';
  ctx.fillRect(0, 0, w, h);
  const state = !p?.contrast ? 'IDLE' : st.contrast >= 1 && st.saline >= 1 ? 'COMPLETE' : st.contrast > 0 ? 'INJECTING' : st.connected ? 'ARMED' : 'IDLE';
  const col = state === 'INJECTING' ? UI.warn : state === 'ARMED' ? UI.ok : state === 'COMPLETE' ? UI.accent : UI.dim;
  ctx.fillStyle = '#1c2a38';
  ctx.fillRect(0, 0, w, 34);
  fit(ctx, 'INJECTOR', 12, 18, w * 0.5, 16, 900, 'left', UI.text);
  fit(ctx, state, w - 12, 18, w * 0.45, 16, 900, 'right', col);
  const a = p?.ml ?? 0;
  const b = p?.flush ?? 0;
  const left = (v: number, k: number) => Math.round(v * (1 - k));
  const gauge = (x: number, label: string, vol: number, total: number, color: string) => {
    rrect(ctx, x, 46, 70, 150, 8, '#0a0f14', UI.line, 1);
    const k = total ? vol / total : 0;
    rrect(ctx, x + 6, 52 + 138 * (1 - k), 58, Math.max(2, 138 * k), 5, color);
    fit(ctx, label, x + 35, 210, 60, 15, 900, 'center', UI.text);
    fit(ctx, `${vol} mL`, x + 35, 228, 70, 13, 700, 'center', UI.dim, MONO);
  };
  gauge(12, 'A', left(a, st.contrast), a || 1, '#e8d36a');
  gauge(92, 'B', left(b, st.saline), b || 1, '#6cc4e6');
  const tx = 178;
  if (p?.contrast) {
    fit(ctx, `1  A  ${a} mL  ${p.rate} mL/s`, tx, 58, w - tx - 10, 14, 700, 'left', UI.text, MONO);
    fit(ctx, `2  B  ${b} mL  ${p.rate} mL/s`, tx, 80, w - tx - 10, 14, 700, 'left', UI.text, MONO);
    fit(ctx, 'Limit 325 psi', tx, 104, w - tx - 10, 13, 600, 'left', UI.dim);
    // pressure curve
    const gx = tx;
    const gy = 120;
    const gw = w - tx - 12;
    const gh = 86;
    rrect(ctx, gx, gy, gw, gh, 6, '#0a0f14', UI.line, 1);
    ctx.strokeStyle = UI.red;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gx + 4, gy + 12);
    ctx.lineTo(gx + gw - 4, gy + 12);
    ctx.stroke();
    ctx.setLineDash([]);
    const inj = injectionSecs(p);
    const total = inj.contrast + inj.flush;
    const done = st.contrast * inj.contrast + st.saline * inj.flush;
    if (done > 0) {
      ctx.strokeStyle = UI.warn;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const tt = (i / n) * done;
        const pr = tt < 1.5 ? (tt / 1.5) * 0.62 : tt < inj.contrast ? 0.62 + 0.04 * Math.sin(tt) : 0.45;
        const x = gx + 4 + (tt / Math.max(1, total)) * (gw - 8);
        const y = gy + gh - 6 - pr * (gh - 20);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    fit(ctx, `${Math.round(done)} s`, gx + gw - 8, gy + gh - 10, 60, 12, 700, 'right', UI.dim, MONO);
  } else fit(ctx, 'No contrast for this exam', tx, 100, w - tx - 10, 14, 600, 'left', UI.dim);
}

/** the injector head's own small display */
export function drawInjHead(ctx: Ctx, w: number, h: number, p: CtProtocol | null, st: CtState) {
  ctx.fillStyle = '#0b1116';
  ctx.fillRect(0, 0, w, h);
  const a = p?.contrast ? Math.round((p.ml ?? 0) * (1 - st.contrast)) : 0;
  const b = p?.contrast ? Math.round((p.flush ?? 0) * (1 - st.saline)) : 0;
  fit(ctx, `A ${a}`, 10, 30, w / 2 - 14, 26, 900, 'left', '#e8d36a', MONO);
  fit(ctx, `B ${b}`, w - 10, 30, w / 2 - 14, 26, 900, 'right', '#6cc4e6', MONO);
  const state = !p?.contrast ? 'READY' : st.contrast > 0 && st.saline < 1 ? 'INJECTING' : st.saline >= 1 ? 'DONE' : st.connected ? 'ARMED' : 'READY';
  rrect(ctx, 8, h - 46, w - 16, 36, 6, state === 'INJECTING' ? '#3b2f12' : '#152a1f', state === 'INJECTING' ? UI.warn : UI.ok, 2);
  fit(ctx, state, w / 2, h - 28, w - 30, 20, 900, 'center', state === 'INJECTING' ? UI.warn : UI.ok);
}

/** the gantry's display: the patient's orientation, the couch, and the breathing instruction */
export function drawGantry(ctx: Ctx, w: number, h: number, st: CtState, travel: number, top: number, countdown: number | null) {
  ctx.fillStyle = '#071017';
  ctx.fillRect(0, 0, w, h);
  if (st.breath === 'hold' || st.breath === 'breathe') {
    const hold = st.breath === 'hold';
    // lungs pictogram
    ctx.fillStyle = hold ? UI.warn : UI.ok;
    ctx.beginPath();
    ctx.ellipse(52, 66, 18, 34, -0.2, 0, PI * 2);
    ctx.ellipse(92, 66, 18, 34, 0.2, 0, PI * 2);
    ctx.fill();
    ctx.fillRect(68, 24, 8, 30);
    fit(ctx, hold ? 'Hold your breath' : 'Breathe', 128, 50, w - 140, 26, 800, 'left', hold ? UI.warn : UI.ok);
    if (hold && countdown !== null) fit(ctx, `${countdown}`, w - 18, 96, 80, 40, 900, 'right', '#ffffff', MONO);
    return;
  }
  // orientation: a figure lying head-first toward the gantry
  ctx.fillStyle = '#7fd3ff';
  ctx.beginPath();
  ctx.arc(26, 64, 9, 0, PI * 2);
  ctx.fill();
  rrect(ctx, 38, 56, 70, 16, 6, '#7fd3ff');
  fit(ctx, 'HFS', 26, 98, 50, 16, 800, 'left', '#7fd3ff');
  fit(ctx, `H ${Math.round(top * 1000)}`, 130, 42, w - 140, 28, 800, 'left', '#e7f4ff', MONO);
  fit(ctx, `P ${(travel * 100).toFixed(1)}`, 130, 86, w - 140, 28, 800, 'left', '#e7f4ff', MONO);
  if (st.beam) xrayBadge(ctx, w - 140, 6, true);
  else if (st.lasers) fit(ctx, '● LASER', w - 12, 24, 120, 18, 900, 'right', '#ff5a4a');
}

// ───────────────────────────── X-ray booth ─────────────────────────────

export interface XrScreenInfo {
  clock: string;
  patient: { name: string; id: string } | null;
  study: XrStudy | null;
  st: XrState;
}

/** the acquisition console: the projections, the image just taken, the exposure */
export function drawXrConsole(ctx: Ctx, w: number, h: number, s: XrScreenInfo) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, w, h);
  topBar(ctx, w, 'Acquisition', s.clock, s.patient ? `${s.patient.name} · ${s.patient.id}` : 'Radiography room 1');
  const st = s.study;
  // projections down the left
  const lx = 12;
  const lw = 170;
  rrect(ctx, lx, 56, lw, h - 70, 8, UI.panel);
  fit(ctx, st ? st.name : 'No exam', lx + 10, 76, lw - 20, 14, 800, 'left', UI.dim);
  (st?.views ?? []).forEach((v, i) => {
    const y = 96 + i * 108;
    const taken = i < s.st.taken;
    const cur = i === s.st.view && !taken;
    rrect(ctx, lx + 8, y, lw - 16, 98, 6, cur ? '#1f3b57' : UI.panel2, taken ? UI.ok : cur ? UI.accent : UI.line, 2);
    if (taken && st) {
      const img = filmFor(st, v);
      const k = Math.min((lw - 30) / img.width, 64 / img.height);
      ctx.drawImage(img, lx + (lw - img.width * k) / 2, y + 6, img.width * k, img.height * k);
    } else fit(ctx, v, lx + lw / 2, y + 40, lw - 40, 24, 900, 'center', cur ? '#ffffff' : '#56616b');
    fit(ctx, `${v}${taken ? '  ✓' : ''}`, lx + lw / 2, y + 84, lw - 30, 13, 700, 'center', taken ? UI.ok : UI.dim);
  });
  // the image
  const vx = lx + lw + 10;
  const vw = w - vx - 200;
  const vy = 56;
  const vh = h - 70;
  ctx.fillStyle = '#000';
  ctx.fillRect(vx, vy, vw, vh);
  if (st && s.st.taken > 0) {
    const v = st.views[Math.min(st.views.length - 1, s.st.taken - 1)];
    const img = filmFor(st, v);
    const k = Math.min(vw / img.width, vh / img.height) * 0.96;
    ctx.drawImage(img, vx + (vw - img.width * k) / 2, vy + (vh - img.height * k) / 2, img.width * k, img.height * k);
    fit(ctx, st.erect ? (v === 'LAT' ? 'L' : 'R') : 'R', vx + 14, vy + 20, 30, 20, 900, 'left', '#ffffff');
    fit(ctx, v, vx + vw - 10, vy + 20, 120, 15, 800, 'right', '#9fb0bf');
  } else fit(ctx, st ? (s.st.prep ? 'Preparing…' : 'Ready for exposure') : 'No exam', vx + vw / 2, vy + vh / 2, vw * 0.8, 20, 700, 'center', '#56616b');
  // exposure parameters
  const rx = vx + vw + 10;
  const rw = w - rx - 12;
  rrect(ctx, rx, 56, rw, h - 70, 8, UI.panel);
  const rows: [string, string][] = st
    ? [
        ['kV', `${st.kv}`],
        ['mAs', `${st.mas.toFixed(1)}`],
        ['SID', st.erect ? '180 cm' : '100 cm'],
        ['AEC', st.erect ? 'Lateral 2' : 'Off'],
        ['Grid', st.erect ? 'Yes' : 'No'],
        ['Focus', st.erect ? 'Large' : 'Small'],
      ]
    : [];
  rows.forEach(([k, v], i) => {
    const y = 84 + i * 36;
    fit(ctx, k, rx + 12, y, rw * 0.4, 14, 600, 'left', UI.dim);
    fit(ctx, v, rx + rw - 12, y, rw * 0.55, 17, 800, 'right', UI.text, MONO);
  });
  xrayBadge(ctx, rx + (rw - 132) / 2, h - 66, s.st.beam || s.st.prep, s.st.beam ? 'X-RAY' : s.st.prep ? 'PREP' : 'X-RAY');
}

/** the generator's control panel: kV and mAs in LED digits, ready / prep / exposure lamps */
export function drawXrGen(ctx: Ctx, w: number, h: number, st: XrStudy | null, s: XrState) {
  ctx.fillStyle = '#1b2026';
  ctx.fillRect(0, 0, w, h);
  const led = (x: number, label: string, val: string, color: string) => {
    rrect(ctx, x, 16, 170, 92, 8, '#07090b', '#3a434b', 2);
    fit(ctx, val, x + 158, 64, 150, 54, 800, 'right', color, MONO);
    fit(ctx, label, x + 8, 124, 160, 16, 800, 'left', '#9aa5ad');
  };
  led(18, 'kV', st ? `${st.kv}` : '--', '#ff5a3a');
  led(212, 'mAs', st ? st.mas.toFixed(1) : '--', '#58e07a');
  const lamp = (x: number, label: string, on: boolean, color: string) => {
    ctx.fillStyle = on ? color : '#2b3238';
    ctx.beginPath();
    ctx.arc(x, 172, 13, 0, PI * 2);
    ctx.fill();
    fit(ctx, label, x, 202, 90, 14, 800, 'center', on ? color : '#6b7780');
  };
  lamp(60, 'READY', !!st && !s.prep && !s.beam, '#58e07a');
  lamp(170, 'PREP', s.prep && !s.beam, '#f2b51c');
  lamp(280, 'X-RAY', s.beam, '#ffcc33');
  trefoil(ctx, 360, 172, 14, s.beam ? '#ffcc33' : '#3a434b');
}

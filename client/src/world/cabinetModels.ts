/**
 * Cabinets, cupboards, drawers and carts that open: their geometry, built with the rest of the
 * hospital (props.ts, details.ts, resusGear.ts call in here). cabinets.ts runs them.
 *
 * A unit (a prop's group) is tagged `userData.cabUnit`; each moving part is a group tagged
 * `userData.cabPart`, its meshes merged by material in the part's own frame and kept out of the
 * builder's static merge, so it can swing, slide or roll:
 *
 *   door     origin on its hinge line at the door's back face; it turns about local y
 *            (hinge L = the unit's −x edge). Doors open outward, up to `max` (rad)
 *   drawer   origin at the unit's; it slides along the unit's +z by up to `max` (m). Its tray and
 *            what is in it (`cabInner`) are drawn only while it is out
 *   shutter  origin at the top of a roll-up cover; `cabCover` shortens from below, `cabRoll` grows
 *
 * What stands on fixed shelves is static (merged with the building: one draw call for every label
 * in the hospital, through one label atlas). Generic labels only, no brands. `cabSlot` marks a spot
 * where a thing you can pick up goes (cabinets.ts puts a real item there when the part is open).
 * Seals, locks, the door-open light and the key are their own small meshes (`keep`), toggled by
 * cabinets.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RADIO_PIN } from '../../../shared/nightRadio';
import type { PropDef } from '../../../shared/layout';
import { G, add, applyWorldUVs, boxB, canvasTexture, cylB, lambert, makeCanvas, own, pbr, rboxB, trackGeo, tube } from './materials';

// ───────────────────────────── tags ─────────────────────────────

export const residentLockerId = 'f2_lng_lockers';

export type CabRole = 'supply' | 'linen' | 'wardrobe' | 'lockers' | 'files' | 'cart' | 'linenCart' | 'isolation' | 'crash' | 'airway' | 'medFridge' | 'staffFridge' | 'cd';

export interface UnitTag {
  role: CabRole;
  /** what prompts call it: 'cabinet', 'wardrobe', 'crash cart' */
  noun: string;
  /** a numbered breakaway seal (crash carts), a key (controlled drugs) */
  lock?: 'seal' | 'key';
  /** a unit that isn't a layout prop (details.ts carts) */
  id?: string;
  /** its body in its own frame [x0, y0, z0, x1, y1, z1] (the merge takes the meshes: this is what's left of it) */
  box: [number, number, number, number, number, number];
}

export interface PartTag {
  kind: 'door' | 'drawer' | 'shutter';
  /** door: the edge it hangs on, in the unit's frame (L = −x) */
  hinge?: 'L' | 'R';
  /** door: furthest it opens (rad); drawer: travel (m); shutter: share of its height that rolls up */
  max: number;
  /** where the hand takes it, in the part's frame (closed) */
  handle: [number, number, number];
  /** bar (vertical handle), pull (horizontal), edge (no handle: the door's edge) */
  grip: 'bar' | 'pull' | 'edge';
  /** door: [width, height, thickness]; drawer: [front width, front height, tray depth]; shutter: [width, height, 0] */
  size: [number, number, number];
  /** what the prompt calls this part: 'drawer A: airway', 'left door' */
  name: string;
  /** a staff locker that is someone's own: locked, and no key for you */
  personal?: boolean;
  /** a door's lower edge and its height range (unit frame), for clearance checks */
  y0?: number;
}

// ───────────────────────────── materials ─────────────────────────────

/** same option order as props.ts M.*, so the cache hands back the same material (= the same draw call) */
const M = {
  chrome: () => lambert('#d9dde0', { roughness: 0.16, metalness: 1 }),
  alu: () => lambert('#b9bfc4', { roughness: 0.35, metalness: 0.85 }),
  // brushed handles: only partly metallic, so they read light in a dim room (a mirror finish reflects the dark and looks black)
  satin: () => lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 }),
  laminate: (c: string) => lambert(c, { roughness: 0.45 }),
  paint: (c: string, rough = 0.38) => lambert(c, { roughness: rough, metalness: 0.15 }),
  plastic: (c: string, rough = 0.42) => pbr('plastic', { color: c, tile: 0.3, roughness: rough, normalScale: 0.3, worldUV: true }),
  wood: (c: string) => pbr('wood', { color: c, tile: 1.2, roughness: 0.65 }),
  fabric: (c: string) => pbr('fabric_seat', { color: c, tile: 0.4, roughness: 1 }),
  dark: () => lambert('#2b3034', { roughness: 0.45 }),
  black: () => lambert('#16191b', { roughness: 0.32 }),
  rubber: () => pbr('rubber', { color: '#2a2d30', tile: 0.2, roughness: 0.9 }),
};
const CAB = {
  body: () => M.laminate('#e3e7ea'),
  door: () => M.laminate('#eef1f3'),
  liner: () => M.laminate('#f1f2ef'),
  tray: () => lambert('#d9dde0', { roughness: 0.5 }),
  divider: () => lambert('#c9ced2', { roughness: 0.5 }),
  recess: () => lambert('#2f3438', { roughness: 0.8 }),
};

// ───────────────────────────── label atlas ─────────────────────────────
// Every printed label on every box, drug, linen stack, seal and sign is a region of one canvas (one
// material): statics merge into one draw call for the whole hospital.

type Region = [number, number, number, number];
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
interface Atlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshStandardMaterial;
  x: number;
  y: number;
  row: number;
  regions: Map<string, Region>;
  /** pixel rect of each region (redrawn: a new seal number) */
  px: Map<string, [number, number, number, number]>;
}
let atlas: Atlas | null = null;
const S_ATLAS = 2048;

function getAtlas(): Atlas {
  if (atlas) return atlas;
  const { canvas, ctx } = makeCanvas(S_ATLAS, S_ATLAS);
  ctx.fillStyle = '#f2f2ef';
  ctx.fillRect(0, 0, S_ATLAS, S_ATLAS);
  const tex = canvasTexture(canvas);
  tex.anisotropy = 8;
  const mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }));
  const a: Atlas = { canvas, ctx, tex, mat, x: 0, y: 0, row: 0, regions: new Map(), px: new Map() };
  atlas = a;
  // disposeCaches() disposes it with the world: a fresh atlas next time
  mat.addEventListener('dispose', () => {
    if (atlas === a) atlas = null;
  });
  return a;
}

/** the material every label is printed on */
export function labelMaterial(): THREE.MeshStandardMaterial {
  return getAtlas().mat;
}

/** UV rect of a region drawn once per key (shelf-packed with 4 px gutters) */
function region(key: string, w: number, h: number, draw: Draw): Region {
  const a = getAtlas();
  const hit = a.regions.get(key);
  if (hit) return hit;
  if (a.x + w + 4 > S_ATLAS) {
    a.x = 0;
    a.y += a.row;
    a.row = 0;
  }
  const x0 = a.x + 2;
  const y0 = a.y + 2;
  if (y0 + h > S_ATLAS) console.warn(`[cabinets] label atlas full at ${key}`);
  a.x += w + 4;
  a.row = Math.max(a.row, h + 4);
  paint(a, x0, y0, w, h, draw);
  const r: Region = [(x0 + 0.5) / S_ATLAS, 1 - (y0 + h - 0.5) / S_ATLAS, (x0 + w - 0.5) / S_ATLAS, 1 - (y0 + 0.5) / S_ATLAS];
  a.regions.set(key, r);
  a.px.set(key, [x0, y0, w, h]);
  return r;
}

function paint(a: Atlas, x0: number, y0: number, w: number, h: number, draw: Draw) {
  const ctx = a.ctx;
  ctx.save();
  ctx.translate(x0, y0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  draw(ctx, w, h);
  ctx.restore();
  a.tex.needsUpdate = true;
}

/** redraw a region (cabinets.ts: a crash cart's new seal number) */
export function redrawLabel(key: string, draw: Draw) {
  const a = getAtlas();
  const p = a.px.get(key);
  if (p) paint(a, p[0], p[1], p[2], p[3], draw);
}

/** a solid colour patch (the plain faces of a box) */
function swatch(color: string): [number, number] {
  const r = region(`sw|${color}`, 12, 12, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  });
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

/** fillText shrunk until it fits maxW */
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, align: CanvasTextAlign = 'left', color?: string) {
  if (color) ctx.fillStyle = color;
  let s = Math.round(size);
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 6) ctx.font = `${weight} ${--s}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** a printed carton or peel pack: coloured band with the name, a second line, a generic barcode */
const drawPack = (title: string, sub: string, band: string, bg = '#f7f8f5', fg = '#1f262b'): Draw => (ctx, w, h) => {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h * 0.34);
  fit(ctx, title, w * 0.05, h * 0.17, w * 0.9, h * 0.22, 800, 'left', '#ffffff');
  fit(ctx, sub, w * 0.05, h * 0.52, w * 0.9, h * 0.17, 600, 'left', fg);
  // a generic barcode and a lot / expiry line
  ctx.fillStyle = '#2a2f33';
  let x = w * 0.62;
  for (let i = 0; i < 22; i++) {
    const bw = 1 + ((i * 7) % 3);
    ctx.fillRect(x, h * 0.7, bw, h * 0.22);
    x += bw + 1 + ((i * 5) % 2);
  }
  fit(ctx, 'LOT 24B17 · EXP 2027-09', w * 0.05, h * 0.84, w * 0.52, h * 0.1, 500, 'left', '#5a646b');
  ctx.fillStyle = band;
  ctx.fillRect(0, h - 3, w, 3);
};

/** a drug carton or a vial's label: white, a coloured side bar, name and strength large */
const drawDrug = (name: string, strength: string, bar: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, w * 0.07, h);
  ctx.fillRect(0, h - h * 0.08, w, h * 0.08);
  fit(ctx, name, w * 0.11, h * 0.32, w * 0.86, h * 0.28, 800, 'left', '#141a1e');
  fit(ctx, strength, w * 0.11, h * 0.66, w * 0.86, h * 0.22, 700, 'left', bar === '#f7f8f5' ? '#2c3439' : bar);
};

/** folded linen seen from the front: layers with soft fold lines */
const drawFolds = (base: string, line: string, print?: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  if (print) {
    ctx.fillStyle = print;
    for (let y = 4; y < h; y += 9) for (let x = (y % 18) / 2; x < w; x += 9) ctx.fillRect(x, y, 2, 2);
  }
  const layers = 7;
  for (let i = 1; i < layers; i++) {
    const y = (i / layers) * h;
    const g = ctx.createLinearGradient(0, y - 5, 0, y + 3);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.75, line);
    g.addColorStop(1, 'rgba(255,255,255,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 5, w, 8);
  }
  // the folded edge: rounded shading at either end
  const s = ctx.createLinearGradient(0, 0, w, 0);
  s.addColorStop(0, 'rgba(0,0,0,0.14)');
  s.addColorStop(0.08, 'rgba(0,0,0,0)');
  s.addColorStop(0.92, 'rgba(0,0,0,0)');
  s.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, w, h);
};

/** the seal's tag: a number you write in the check log */
export const drawSeal = (no: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  fit(ctx, 'SEAL', w / 2, h * 0.22, w * 0.8, h * 0.16, 800, 'center', '#1b1e21');
  fit(ctx, no, w / 2, h * 0.55, w * 0.9, h * 0.3, 800, 'center', '#1b1e21');
  ctx.fillStyle = '#1b1e21';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.86, h * 0.06, 0, Math.PI * 2);
  ctx.fill();
};

/** label set: key → how it is drawn (and its pixel size) */
interface Lbl {
  px: [number, number];
  draw: Draw;
}
const pk = (title: string, sub: string, band: string): Lbl => ({ px: [256, 128], draw: drawPack(title, sub, band) });
const dg = (name: string, strength: string, bar: string): Lbl => ({ px: [256, 96], draw: drawDrug(name, strength, bar) });
const ln = (base: string, line: string, print?: string): Lbl => ({ px: [128, 128], draw: drawFolds(base, line, print) });

/** ISO 26825-like hues for drug labels: vasopressors violet, anticholinergics green, opioids blue, antagonists blue/white */
const LABELS: Record<string, Lbl> = {
  // ── gloves, dressings, sharps ──
  glovesS: pk('NITRILE EXAM GLOVES', 'Size S · powder-free · 100', '#6b4fb3'),
  glovesM: pk('NITRILE EXAM GLOVES', 'Size M · powder-free · 100', '#3d74c9'),
  glovesL: pk('NITRILE EXAM GLOVES', 'Size L · powder-free · 100', '#3aa36a'),
  gauze: pk('GAUZE SWABS', '10 × 10 cm · 8-ply · sterile · 5', '#2a7fb8'),
  dressTp: pk('TRANSPARENT DRESSING', 'IV site · 6 × 7 cm · sterile', '#1f9e8f'),
  dressAd: pk('ADHESIVE DRESSING', 'Absorbent pad · 9 × 10 cm', '#d98a2b'),
  bandage: pk('CONFORMING BANDAGE', '7.5 cm × 4 m', '#7a8a96'),
  tape: pk('SURGICAL TAPE', 'Breathable · 2.5 cm × 9 m', '#8a6d3b'),
  syr10: pk('SYRINGE 10 mL', 'Luer lock · sterile · 100', '#4c6fa8'),
  syr5: pk('SYRINGE 5 mL', 'Luer lock · sterile · 100', '#4c6fa8'),
  ndl21: pk('HYPODERMIC NEEDLES 21G', 'Green · 40 mm · 100', '#2e8b57'),
  can20: pk('IV CANNULA 20G', 'Pink · 32 mm · 50', '#e46ba0'),
  can18: pk('IV CANNULA 18G', 'Green · 45 mm · 50', '#2e9e4f'),
  can16: pk('IV CANNULA 16G', 'Grey · 45 mm · 50', '#8c9399'),
  can14: pk('IV CANNULA 14G', 'Orange · 50 mm · 50', '#e07a25'),
  ivSet: pk('IV ADMINISTRATION SET', '20 drops/mL · 180 cm', '#3a7bd5'),
  bloodSet: pk('BLOOD ADMINISTRATION SET', '200 µm filter · 15 drops/mL', '#b3261e'),
  extSet: pk('EXTENSION SET', 'With 3-way tap · 10 cm', '#5b7f9b'),
  flush: pk('SODIUM CHLORIDE 0.9%', 'Prefilled flush · 10 mL · 30', '#2a62c9'),
  wipes: pk('ALCOHOL WIPES', '70% isopropyl alcohol · 200', '#5aa6e0'),
  tourn: pk('TOURNIQUETS', 'Single use · latex-free · 25', '#5aa6e0'),
  ecg: pk('ECG ELECTRODES', 'Adult · foam · 50', '#c0392b'),
  tubes: pk('BLOOD COLLECTION TUBES', 'Assorted · vacuum', '#8e5ec4'),
  ivStart: pk('IV START KIT', 'Tourniquet · wipe · dressing · tape', '#1f6f8b'),
  catheter: pk('URINARY CATHETER 14 Ch', 'Sterile · single use', '#d9a400'),
  splint: pk('MOULDABLE SPLINT', 'Padded · 11 × 91 cm', '#e07a25'),
  wipesSurf: pk('DISINFECTANT WIPES', 'Surfaces · 100', '#1f9e8f'),
  basin: pk('EMESIS BASINS', 'Pulp · single use · 25', '#7a8a96'),
  // ── airway, breathing ──
  opa3: pk('OROPHARYNGEAL AIRWAY', 'Size 3 · 80 mm', '#f0c419'),
  opa4: pk('OROPHARYNGEAL AIRWAY', 'Size 4 · 90 mm', '#c0392b'),
  npa: pk('NASOPHARYNGEAL AIRWAY', '6.0–7.0 mm · with lubricant', '#e07a25'),
  ett7: pk('TRACHEAL TUBE 7.0', 'Cuffed · oral · sterile', '#2e8b57'),
  ett8: pk('TRACHEAL TUBE 8.0', 'Cuffed · oral · sterile', '#2e8b57'),
  sga4: pk('SUPRAGLOTTIC AIRWAY 4', 'Second-generation · 50–90 kg', '#d9a400'),
  sga3: pk('SUPRAGLOTTIC AIRWAY 3', 'Second-generation · 30–60 kg', '#d9a400'),
  bougie: pk('INTUBATION BOUGIE', 'Adult · 60 cm · single use', '#2e8b57'),
  stylet: pk('INTUBATION STYLET', 'Adult · malleable', '#2e8b57'),
  blade: pk('LARYNGOSCOPE BLADE', 'Macintosh 3 · single use', '#5b6b7a'),
  suction: pk('YANKAUER SUCKER', 'Rigid · with tubing', '#5aa6e0'),
  nrb: pk('NON-REBREATHER MASK', 'Adult · reservoir bag · 15 L/min', '#2e9e4f'),
  neb: pk('NEBULISER KIT', 'Adult mask · tubing', '#3aa36a'),
  o2tube: pk('OXYGEN TUBING', '2 m · star lumen', '#2e9e4f'),
  faceMask: pk('ANAESTHETIC FACE MASK', 'Adult size 4 · 5', '#5aa6e0'),
  scalpel: pk('SCALPEL No. 10', 'Front-of-neck access · sterile', '#c0392b'),
  ett6: pk('TRACHEAL TUBE 6.0', 'Cuffed · front-of-neck', '#c0392b'),
  paedSga: pk('SUPRAGLOTTIC AIRWAY 2', 'Paediatric · 10–25 kg', '#5b6b7a'),
  paedEtt: pk('TRACHEAL TUBE 4.5', 'Paediatric · cuffed', '#5b6b7a'),
  // ── circulation ──
  io: pk('IO NEEDLE SET', 'Adult · 25 mm · powered driver', '#c0392b'),
  pressBag: pk('PRESSURE INFUSER', '1000 mL · with gauge', '#3a7bd5'),
  bloodCult: pk('BLOOD CULTURE BOTTLES', 'Aerobic + anaerobic pair', '#2e8b57'),
  // ── equipment ──
  pads: pk('DEFIBRILLATION PADS', 'Adult · multifunction', '#c0392b'),
  razor: pk('CLIPPERS / RAZOR', 'Chest prep · single use', '#5b6b7a'),
  probe: pk('TEMPERATURE PROBE COVERS', 'Single use · 40', '#5b6b7a'),
  // ── drugs (crash cart D) ──
  epi: dg('EPINEPHRINE', '1 mg/10 mL (0.1 mg/mL) · prefilled', '#7b3fa0'),
  amio: dg('AMIODARONE', '300 mg/10 mL · prefilled', '#c0392b'),
  aden: dg('ADENOSINE', '6 mg/2 mL · rapid IV push', '#f7f8f5'),
  atro: dg('ATROPINE', '1 mg/10 mL · prefilled', '#2e9e4f'),
  calc: dg('CALCIUM CHLORIDE 10%', '1 g/10 mL · prefilled', '#f7f8f5'),
  bicarb: dg('SODIUM BICARBONATE 8.4%', '50 mmol/50 mL', '#f7f8f5'),
  nalox: dg('NALOXONE', '0.4 mg/1 mL', '#1f6fb8'),
  gluc: dg('GLUCOSE 50%', '25 g/50 mL', '#f7f8f5'),
  mag: dg('MAGNESIUM SULFATE 50%', '2 g/4 mL', '#f7f8f5'),
  lido: dg('LIDOCAINE 1%', '100 mg/10 mL · prefilled', '#8c9399'),
  // ── refrigerated (2–8 °C) ──
  insulin: dg('INSULIN, SOLUBLE', '100 units/mL · 10 mL vial', '#d98a2b'),
  insulinLa: dg('INSULIN, LONG-ACTING', '100 units/mL · 10 mL vial', '#7b3fa0'),
  roc: dg('ROCURONIUM', '50 mg/5 mL · keep cold', '#c0392b'),
  sux: dg('SUXAMETHONIUM', '100 mg/2 mL · keep cold', '#c0392b'),
  loraz: dg('LORAZEPAM', '4 mg/1 mL · keep cold', '#e07a25'),
  oxyt: dg('OXYTOCIN', '10 units/1 mL', '#5b6b7a'),
  tetanus: dg('TETANUS / DIPHTHERIA', 'Vaccine · 0.5 mL', '#2a7fb8'),
  hepB: dg('HEPATITIS B VACCINE', 'Adult · 1 mL', '#2a7fb8'),
  // ── controlled drugs ──
  morph: dg('MORPHINE SULFATE', '10 mg/1 mL · 10 ampoules', '#1f6fb8'),
  fent: dg('FENTANYL', '100 micrograms/2 mL · 10 amp', '#1f6fb8'),
  oxyc: dg('OXYCODONE', '5 mg · 28 capsules', '#1f6fb8'),
  hydro: dg('HYDROMORPHONE', '2 mg/1 mL · 5 ampoules', '#1f6fb8'),
  methad: dg('METHADONE', '1 mg/mL oral solution', '#1f6fb8'),
  // ── isolation ──
  isoGown: pk('ISOLATION GOWNS', 'Fluid-resistant · universal · 10', '#d9a400'),
  maskIIR: pk('SURGICAL MASKS', 'Type IIR · fluid-resistant · 50', '#3d74c9'),
  ffp2: pk('FFP2 / N95 RESPIRATORS', 'Fit-check every time · 20', '#2a4f86'),
  visor: pk('EYE PROTECTION', 'Full-face visors · 10', '#5b6b7a'),
  // ── linen (front and sides of a stack) ──
  lnSheet: ln('#f4f5f1', 'rgba(150,155,150,0.55)'),
  lnBlanket: ln('#e9e4d6', 'rgba(140,130,110,0.55)', 'rgba(180,170,145,0.55)'),
  lnBlue: ln('#cfe3ee', 'rgba(90,120,140,0.5)', 'rgba(70,110,160,0.45)'),
  lnTowel: ln('#f6f6f2', 'rgba(150,150,140,0.6)', 'rgba(120,160,190,0.35)'),
  lnPillow: ln('#eef3f6', 'rgba(140,150,160,0.5)'),
  lnScrubs: ln('#3d6f9c', 'rgba(20,40,60,0.55)'),
  lnYellow: ln('#f2d36b', 'rgba(150,120,30,0.55)'),
  // ── stationery ──
  forms: pk('REQUEST FORMS', 'Laboratory · 500 sheets', '#5b6b7a'),
  paper: pk('PRINTER PAPER', 'A4 · 80 g/m² · 500 sheets', '#2a7fb8'),
  // ── staff fridge ──
  milk: pk('SEMI-SKIMMED MILK', '1 L · keep refrigerated', '#2a72bd'),
  yogurt: pk('NATURAL YOGURT', '500 g', '#3aa36a'),
};

/** UV rect for a label key (drawn on first use) */
export function label(key: string): Region {
  const l = LABELS[key];
  if (!l) throw new Error(`[cabinets] no label ${key}`);
  return region(key, l.px[0], l.px[1], l.draw);
}

/** a one-off label (a seal number, a sign) */
export function customLabel(key: string, px: [number, number], draw: Draw): Region {
  return region(key, px[0], px[1], draw);
}

// ───────────────────────────── packs: boxes and bottles with printed faces ─────────────────────────────

/** a box: which faces carry which label (the rest a plain colour) */
export interface Pack {
  w: number;
  h: number;
  d: number;
  /** base colour of the carton */
  c: string;
  front?: string;
  top?: string;
  /** label on the sides too (linen) */
  sides?: string;
  shape?: 'box' | 'vial' | 'bottle';
}

const packGeos = new Map<string, THREE.BufferGeometry>();
/** box geometry whose faces map to label regions (one atlas material) */
function packGeo(p: Pack): THREE.BufferGeometry {
  const key = `${p.shape ?? 'box'}|${p.w}|${p.h}|${p.d}|${p.c}|${p.front ?? ''}|${p.top ?? ''}|${p.sides ?? ''}`;
  const hit = packGeos.get(key);
  if (hit && hit.getAttribute('position')) return hit;
  let g: THREE.BufferGeometry;
  const plain = swatch(p.c);
  if (p.shape === 'vial' || p.shape === 'bottle') {
    // label round the body, caps plain (a vial's cap coloured)
    const r = p.w / 2;
    g = new THREE.CylinderGeometry(r, r, p.h, p.shape === 'vial' ? 10 : 14, 1);
    const reg = p.front ? label(p.front) : null;
    const cap = swatch(p.shape === 'vial' ? '#c0392b' : p.c);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const idx = g.index!;
    for (const [gi, grp] of g.groups.entries()) {
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const v = idx.getX(i);
        if (gi === 0 && reg) uv.setXY(v, reg[0] + uv.getX(v) * (reg[2] - reg[0]), reg[1] + uv.getY(v) * (reg[3] - reg[1]));
        else if (gi === 1) uv.setXY(v, cap[0], cap[1]);
        else uv.setXY(v, plain[0], plain[1]);
      }
    }
  } else {
    g = new THREE.BoxGeometry(p.w, p.h, p.d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // faces in order: +x, −x, +y, −y, +z, −z (4 vertices each)
    const faces = [p.sides, p.sides, p.top, undefined, p.front, p.sides];
    faces.forEach((k, f) => {
      const reg = k ? label(k) : null;
      for (let i = f * 4; i < f * 4 + 4; i++) {
        if (reg) uv.setXY(i, reg[0] + uv.getX(i) * (reg[2] - reg[0]), reg[1] + uv.getY(i) * (reg[3] - reg[1]));
        else uv.setXY(i, plain[0], plain[1]);
      }
    });
  }
  trackGeo(g);
  packGeos.set(key, g);
  return g;
}

/** a pack standing with its bottom at y (ry: turned about its centre) */
export function pack(parent: THREE.Object3D, p: Pack, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(packGeo(p), labelMaterial());
  m.position.set(x, y + p.h / 2, z);
  if (ry) m.rotation.y = ry;
  parent.add(m);
  return m;
}

/** deterministic pseudo-random per unit id (the same clutter every run) */
export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
type Rand = () => number;

// pack shapes (m): standing on a shelf, label to the front
const box = (w: number, h: number, d: number, c: string, front: string, top?: string): Pack => ({ w, h, d, c, front, top: top ?? front });
const P = {
  gloves: (k: string) => box(0.24, 0.07, 0.125, '#eef1f8', k),
  carton: (k: string) => box(0.2, 0.1, 0.14, '#f3f3ef', k),
  small: (k: string) => box(0.12, 0.075, 0.09, '#f3f3ef', k),
  flat: (k: string) => box(0.16, 0.035, 0.22, '#f7f8f5', k),
  gauze: (k: string) => box(0.12, 0.032, 0.12, '#f7f8f5', k),
  tall: (k: string) => box(0.11, 0.2, 0.09, '#f3f3ef', k),
  drug: (k: string) => box(0.055, 0.03, 0.13, '#fbfbf8', k),
  amp: (k: string) => box(0.11, 0.035, 0.07, '#fbfbf8', k),
  vial: (k: string): Pack => ({ w: 0.026, h: 0.055, d: 0.026, c: '#e8f1f4', front: k, shape: 'vial' }),
  bottle: (k: string, c = '#f1ede4'): Pack => ({ w: 0.06, h: 0.14, d: 0.06, c, front: k, shape: 'bottle' }),
  linen: (k: string, h: number, w = 0.34, d = 0.3): Pack => ({ w, h, d, c: '#f4f5f1', front: k, sides: k, top: undefined }),
};

/** a row of packs along a shelf, from x0 to x1, fronts 1 cm behind zFront; each entry: pack, columns, stacked */
function shelfRow(parent: THREE.Object3D, list: [Pack, number, number][], x0: number, x1: number, y: number, zFront: number, rand: Rand, gap = 0.012) {
  let x = x0 + 0.012;
  for (const [p, cols, stack] of list) {
    for (let c = 0; c < cols; c++) {
      if (x + p.w > x1 - 0.008) return x;
      for (let s = 0; s < stack; s++) pack(parent, p, x + p.w / 2 + (rand() - 0.5) * 0.006, y + s * (p.h + 0.0015), zFront - p.d / 2 - 0.012 - rand() * 0.02, (rand() - 0.5) * 0.06);
      x += p.w + gap + rand() * 0.008;
    }
  }
  return x;
}

/** a marker where a real item goes when the part is open (cabinets.ts): kind, local position, yaw */
function slot(parent: THREE.Object3D, kind: string, x: number, y: number, z: number, yaw = 0): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  o.userData.cabSlot = kind;
  parent.add(o);
  return o;
}

// ───────────────────────────── parts ─────────────────────────────

/**
 * Tag a unit (a prop's group), once its model is built: what cabinets.ts switches on its own outside
 * the moving parts (a crash cart's seal, the warning light) stays out of the builder's static merge.
 */
export function cabUnit(g: THREE.Object3D, tag: UnitTag) {
  g.userData.cabUnit = tag;
  g.traverse((o) => {
    if (!o.userData.keep || o.userData.compacted) return;
    compact(o);
    o.userData.compacted = true;
    o.traverse((m) => ((m as THREE.Mesh).isMesh ? (m.userData.noMerge = true) : undefined));
  });
}

/**
 * A moving part: a group at `at` in the unit's frame, tagged; `build` adds its meshes (positions
 * relative to the part's origin). Its meshes are merged by material (fewer draw calls) and kept out
 * of the builder's static merge; `inner(part)` groups (a drawer's tray and contents) are merged on
 * their own and drawn only while the part is open.
 */
export function cabPart(parent: THREE.Object3D, tag: PartTag, at: [number, number, number], build: (part: THREE.Group) => void): THREE.Group {
  const part = new THREE.Group();
  part.position.set(at[0], at[1], at[2]);
  part.userData.cabPart = tag;
  parent.add(part);
  build(part);
  compact(part);
  part.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.userData.noMerge = true;
      (o as THREE.Mesh).castShadow = false;
    }
  });
  return part;
}

/** a drawer's tray and what's in it: drawn only while the drawer is open */
export function cabInner(part: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.userData.cabInner = true;
  part.add(g);
  return g;
}

/** something cabinets.ts switches on its own (a seal, the lock, a light, the key) */
function keep(parent: THREE.Object3D, flag: string, value: unknown = true): THREE.Group {
  const g = new THREE.Group();
  g.userData.keep = true;
  g.userData[flag] = value;
  parent.add(g);
  return g;
}

/** merge a part's meshes by material in its own frame (inner groups and kept bits on their own) */
function compact(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.keep || c.userData.cabInner || c.userData.cabPart) {
        compact(c);
        continue;
      }
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        let geo = m.geometry.clone().applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
        if (geo.index) geo = geo.toNonIndexed();
        for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
        if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
        const mat = m.material as THREE.Material;
        // textured sets tile in the part's own frame (the grain moves with the door)
        const tile = mat.userData.worldUV as number | undefined;
        if (tile) applyWorldUVs(geo, tile);
        let arr = buckets.get(mat);
        if (!arr) buckets.set(mat, (arr = []));
        arr.push(geo);
        victims.push(m);
      }
      visit(c);
    }
  };
  visit(root);
  for (const v of victims) v.removeFromParent();
  for (const [mat, geos] of buckets) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach((x) => x.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(trackGeo(merged), mat);
    mesh.userData.noMerge = true;
    root.add(mesh);
  }
  // groups left empty by the merge
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.type === 'Group' && !o.children.length && !o.userData.keep && !o.userData.cabInner) empties.push(o);
  });
  for (const e of empties) e.removeFromParent();
}

/** a vertical bar handle on standoffs, centred at (x, y), its bar `out` m off the face at z0 */
function barHandle(parent: THREE.Object3D, x: number, y: number, z0: number, len = 0.16, out = 0.024) {
  const ch = M.satin();
  rboxB(parent, 0.012, len, 0.012, 0.005, ch, x, y - len / 2, z0 + out);
  for (const s of [-1, 1]) boxB(parent, 0.01, 0.012, out - 0.004, ch, x, y + s * (len / 2 - 0.02) - 0.006, z0 + (out - 0.004) / 2);
}

/** a horizontal pull, centred at (x, y) */
function pullHandle(parent: THREE.Object3D, x: number, y: number, z0: number, len = 0.12, out = 0.022, mat: THREE.Material = M.satin()) {
  rboxB(parent, len, 0.012, 0.012, 0.005, mat, x, y - 0.006, z0 + out);
  for (const s of [-1, 1]) boxB(parent, 0.01, 0.01, out - 0.004, mat, x + s * (len / 2 - 0.015), y - 0.005, z0 + (out - 0.004) / 2);
}

/**
 * Doors across the front of a box W wide, between y0 and y1, their backs at z0: pairs open from the
 * middle (left one hinged left), an odd last one hinged on its outer edge. `fill(i)` dresses door i.
 */
function doorRow(g: THREE.Object3D, W: number, n: number, y0: number, y1: number, z0: number, mat: THREE.Material, names: string[], o: { handleY?: number; thick?: number; max?: number; dress?: (part: THREE.Group, i: number, s: number, dw: number) => void; personal?: (i: number) => boolean; grip?: 'bar' | 'pull' | 'edge'; handle?: (s: number, dw: number) => [number, number, number] } = {}) {
  const w = W / n;
  const dw = w - 0.004;
  const T = o.thick ?? 0.019;
  const dh = y1 - y0;
  const hy = o.handleY ?? Math.min(1.05, y0 + dh * 0.62);
  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + i * w;
    const hingeL = i % 2 === 0 && !(n % 2 === 1 && i === n - 1);
    const s = hingeL ? 1 : -1;
    const hx = hingeL ? x0 + 0.002 : x0 + w - 0.002;
    const handleX = s * (dw - 0.05);
    cabPart(g, { kind: 'door', hinge: hingeL ? 'L' : 'R', max: o.max ?? 1.92, handle: o.handle?.(s, dw) ?? [handleX, hy, T + 0.024], grip: o.grip ?? 'bar', size: [dw, dh, T], name: names[i] ?? 'door', personal: o.personal?.(i), y0 }, [hx, 0, z0], (d) => {
      rboxB(d, dw, dh, T, 0.004, mat, (s * dw) / 2, y0, T / 2);
      if (o.dress) o.dress(d, i, s, dw);
      else barHandle(d, handleX, hy, T);
    });
  }
}

// ───────────────────────────── floor-standing cupboards ('cabinet') ─────────────────────────────

export function cabinetRole(p: PropDef): 'supply' | 'linen' | 'wardrobe' | 'lockers' | 'files' {
  if (p.label === 'linen') return 'linen';
  if (/wardrobe/.test(p.id)) return 'wardrobe';
  if (/locker/.test(p.id)) return 'lockers';
  if (/files/.test(p.id)) return 'files';
  return 'supply';
}

/** Ward 2 East's occupied rooms (ward.ts puts patients in these): their wardrobes have clothes */
const WARD_CLOTHES: Record<string, string[]> = {
  f2_room_201: ['#8a6f9e', '#d8c9b4', '#5d6b78'],
  f2_room_202: ['#3f4a56', '#9aa3a8', '#6b5a4a'],
  f2_room_204: ['#2f3e54', '#7d8f6a', '#b54b3c'],
  f2_room_205: ['#b98aa0', '#6f7f96', '#d9d2c4'],
};

/**
 * A floor-standing cupboard W × H × D: a carcass open at the front (sides, top, a plinth, a back,
 * shelves) behind doors that swing out. What's inside goes by role: supplies, linen, a patient's
 * clothes, staff lockers, or a lateral file with drawers.
 */
export function buildCabinet(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 1.0;
  const D = p.d ?? 0.5;
  const H = p.h ?? 1.9;
  const role = cabinetRole(p);
  const rand = rng(p.id);
  if (role === 'files') return fileCabinet(p, g, W, D, H);
  const T = 0.018;
  const PL = 0.07;
  const wood = role === 'wardrobe';
  const body = wood ? M.wood('#d9c4a2') : CAB.body();
  const liner = CAB.liner();
  // carcass: sides to the floor, top over them, a recessed plinth, bottom panel, back
  for (const s of [-1, 1]) boxB(g, T, H - T, D, body, s * (W / 2 - T / 2), 0, 0);
  boxB(g, W, T, D, body, 0, H - T, 0);
  boxB(g, W - 2 * T, PL, D - 0.06, M.dark(), 0, 0, -0.03);
  boxB(g, W - 2 * T, T, D - 0.01, liner, 0, PL, -0.005);
  boxB(g, W - 2 * T, H - PL - 2 * T, 0.008, liner, 0, PL + T, -D / 2 + 0.004);
  const n = Math.max(1, Math.round(W / 0.6));
  const w = W / n;
  // compartments: lockers one per door, the rest one per pair of doors
  const cuts: number[] = [];
  if (role === 'lockers') for (let i = 1; i < n; i++) cuts.push(-W / 2 + i * w);
  else for (let i = 2; i < n; i += 2) cuts.push(-W / 2 + i * w);
  for (const x of cuts) boxB(g, T, H - PL - 2 * T, D - 0.02, liner, x, PL + T, -0.01);
  const bounds = [-W / 2 + T, ...cuts, W / 2 - T];
  const sections = bounds.slice(0, -1).map((a, i) => [a + (i ? T / 2 : 0), bounds[i + 1] - (i < bounds.length - 2 ? T / 2 : 0)] as [number, number]);
  const yIn0 = PL + T;
  const yIn1 = H - T;
  const zFront = D / 2 - 0.03;
  const names = n === 1 ? ['door'] : n === 2 ? ['left door', 'right door'] : Array.from({ length: n }, (_, i) => `door ${i + 1}`);

  if (role === 'supply' || role === 'linen') {
    const shelves = H > 1.6 ? 4 : 2;
    const ys: number[] = [];
    for (let k = 1; k <= shelves; k++) ys.push(yIn0 + ((yIn1 - yIn0) * k) / (shelves + 1));
    for (const [a, b] of sections) for (const y of ys) boxB(g, b - a - 0.002, T, D - 0.06, liner, (a + b) / 2, y - T, -0.02);
    const levels = [yIn0, ...ys];
    sections.forEach(([a, b], si) => {
      levels.forEach((y, li) => {
        if (role === 'linen') linenShelf(g, a, b, y, zFront, li, rand);
        else supplyShelf(g, a, b, y, zFront, li, si, p.id, rand);
      });
    });
  } else if (role === 'wardrobe') {
    const yShelf = H - 0.36;
    boxB(g, W - 2 * T - 0.002, T, D - 0.06, liner, 0, yShelf, -0.02);
    // hanging rail across, 7 cm under the shelf
    add(g, G.cyl(0.012, 0.012, W - 2 * T, 12), M.chrome(), 0, yShelf - 0.07, -0.02, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) boxB(g, 0.02, 0.06, 0.03, M.chrome(), s * (W / 2 - T - 0.01), yShelf - 0.08, -0.02);
    wardrobeInside(g, p.room, W - 2 * T, yShelf, PL + T, rand);
  } else {
    // staff lockers: a hat shelf and a coat hook in each
    sections.forEach(([a, b]) => {
      boxB(g, b - a - 0.002, T, D - 0.06, liner, (a + b) / 2, H - 0.42, -0.02);
      add(g, G.capsule(0.006, 0.03, 3, 8), M.chrome(), (a + b) / 2, H - 0.52, -D / 2 + 0.03, Math.PI / 2, 0, 0);
    });
    // the spare one: a hanger on the hook
    const [a, b] = sections[Math.min(2, sections.length - 1)];
    if (p.id === residentLockerId) {
      const hook = new THREE.Group();
      hook.position.set((a + b) / 2, H - 0.51, -D / 2 + 0.05);
      hook.rotation.y = Math.PI / 2;
      g.add(hook);
      hanger(hook, 0, 0, 0, true);
    } else hanger(g, (a + b) / 2, H - 0.5, -D / 2 + 0.05 + 0.2, true);
  }

  const doorMat = wood ? M.wood('#e2d0b0') : CAB.door();
  if (role === 'lockers') {
    // numbered doors with a cylinder lock each; vents at the top; the third is the spare one (key in its lock)
    doorRow(g, W, n, PL + 0.002, H - 0.003, D / 2 + 0.002, doorMat, Array.from({ length: n }, (_, i) => `locker ${i + 11}`), {
      personal: (i) => i !== Math.min(2, n - 1),
      grip: 'pull',
      handleY: 1.12,
      // the small pull under the lock
      handle: (s, dw) => [s * (dw - 0.09), 1.12, 0.019 + 0.02],
      dress: (d, i, s, dw) => {
        const lx = s * (dw - 0.05);
        // number plate and vents
        const resident = p.id === residentLockerId && i === 2;
        const num = customLabel(resident ? 'resident-door' : `locker|${i + 11}`, [resident ? 256 : 96, 64], (ctx, cw, ch) => {
          ctx.fillStyle = resident ? '#155953' : '#f4f5f2';
          ctx.fillRect(0, 0, cw, ch);
          fit(ctx, resident ? '13  ·  RESIDENT' : String(i + 11), cw / 2, ch / 2 + 1,
            cw * 0.91, ch * 0.7, 800, 'center', resident ? '#ffffff' : '#1b1e21');
        });
        const plate = new THREE.Mesh(uvBox(resident ? 0.36 : 0.06, resident ? 0.09 : 0.04, 0.003, num), labelMaterial());
        plate.position.set(s * (dw / 2), H - 0.3, 0.019 + 0.0015);
        d.add(plate);
        for (let k = 0; k < 4; k++) boxB(d, dw * 0.5, 0.008, 0.003, M.dark(), s * (dw / 2), H - 0.2 + k * 0.025, 0.019 + 0.0015);
        // a small pull under the lock
        pullHandle(d, lx - s * 0.04, 1.12, 0.019, 0.08, 0.02);
        const lock = keep(d, 'cabLock', i);
        add(lock, G.cyl(0.011, 0.011, 0.008, 14), M.chrome(), lx, 1.2, 0.023, Math.PI / 2, 0, 0);
        boxB(lock, 0.002, 0.012, 0.002, M.black(), lx, 1.194, 0.0275);
        if (i === Math.min(2, n - 1)) {
          // the spare locker's key, left in its lock, and a tag
          const key = keep(d, 'cabSpareKey');
          boxB(key, 0.006, 0.022, 0.003, M.alu(), lx, 1.2, 0.029);
          add(key, G.torus(0.008, 0.0018, 6, 12), M.alu(), lx, 1.183, 0.0305);
          rboxB(key, 0.018, 0.026, 0.003, 0.003, lambert('#e3423b', { roughness: 0.5 }), lx, 1.148, 0.031);
        }
      },
    });
  } else {
    doorRow(g, W, n, PL + 0.002, H - 0.003, D / 2 + 0.002, doorMat, names, { handleY: H > 1.6 ? 1.05 : H * 0.72 });
  }
  cabUnit(g, { role, noun: role === 'wardrobe' ? 'wardrobe' : role === 'lockers' ? 'locker' : role === 'linen' ? 'linen cupboard' : 'cabinet', box: [-W / 2, 0, -D / 2, W / 2, H, D / 2] });
}

// Compartment 13 in the Ward 2 East locker bank. Attach after the building's static merge
// so a save-slot change or a newly earned souvenir can update each model independently.
export function buildLockerDisplay(): THREE.Group {
  const display = new THREE.Group();
  display.position.x = 0.3;
  function item(name: string) {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    display.add(group);
    return group;
  }

  const vest = item('Surgeon’s vest');
  vest.position.set(0, 1.39, -0.19);
  const outline = new THREE.Shape();
  outline.moveTo(-0.10, 0);
  outline.lineTo(-0.19, -0.045);
  outline.quadraticCurveTo(-0.13, -0.15, -0.205, -0.20);
  outline.lineTo(-0.20, -0.59);
  outline.lineTo(0.20, -0.59);
  outline.lineTo(0.205, -0.20);
  outline.quadraticCurveTo(0.13, -0.15, 0.19, -0.045);
  outline.lineTo(0.10, 0);
  outline.lineTo(0, -0.14);
  outline.closePath();
  const cloth = trackGeo(new THREE.ExtrudeGeometry(outline, { depth: 0.032, bevelEnabled: false }));
  vest.add(new THREE.Mesh(cloth, M.fabric('#547f80')));
  boxB(vest, 0.008, 0.44, 0.004, M.dark(), 0, -0.585, 0.034);
  for (const x of [-0.11, 0.11]) boxB(vest, 0.105, 0.095, 0.007, M.fabric('#436d70'), x, -0.51, 0.034);

  // Two folded display cards stand on the hat shelf with the small keepsakes pinned to them.
  const brass = lambert('#ca9c4e', { roughness: 0.4, metalness: 0.45 });
  const card = (name: string, x: number) => {
    const group = item(name);
    group.position.set(x, 1.548, 0.11);
    boxB(group, 0.145, 0.12, 0.008, M.laminate('#e6dfc9'), 0, 0, 0);
    boxB(group, 0.145, 0.005, 0.047, M.laminate('#e6dfc9'), 0, 0, -0.02);
    return group;
  };
  const pin = card(RADIO_PIN, -0.13);
  add(pin, G.cyl(0.032, 0.032, 0.008, 24), brass, 0, 0.06, 0.008, Math.PI / 2);
  add(pin, G.cyl(0.027, 0.027, 0.003, 24), M.paint('#175862'), 0, 0.06, 0.013, Math.PI / 2);
  for (const [x, h] of [[-0.01, 0.015], [0, 0.031], [0.01, 0.021]]) boxB(pin, 0.004, h, 0.002, brass, x, 0.06 - h / 2, 0.016);
  const key = card('Tiny brass key', 0.12);
  add(key, G.torus(0.012, 0.003, 6, 18), brass, -0.025, 0.073, 0.008);
  boxB(key, 0.054, 0.006, 0.005, brass, 0.011, 0.07, 0.008);
  for (const x of [0.027, 0.037]) boxB(key, 0.004, 0.012, 0.005, brass, x, 0.06, 0.008);
  return display;
}

/** supplies on one shelf level of a section (li 0 = the floor of the cupboard) */
function supplyShelf(g: THREE.Object3D, a: number, b: number, y: number, zFront: number, li: number, si: number, id: string, rand: Rand) {
  const ward = id.startsWith('f2_');
  const resus = id === 'resus_cab' || id === 'ems_cab';
  const rows: [Pack, number, number][][] = [
    // floor of the cupboard: bulk cartons
    [[P.carton('basin'), 1, 2], [P.carton('splint'), 1, 1], [P.carton('wipesSurf'), 2, 1]],
    // 1: cannulas, needles, syringes
    [[P.small(resus ? 'can16' : 'can20'), 1, 2], [P.small('can18'), 1, 2], [P.small(resus ? 'can14' : 'ndl21'), 1, 2], [P.carton('syr10'), 1, 1], [P.carton('syr5'), 1, 1]],
    // 2: dressings and gauze
    [[P.gauze('gauze'), 2, 5], [P.small('dressTp'), 1, 2], [P.small('dressAd'), 1, 2], [P.small('bandage'), 1, 1], [P.small('tape'), 1, 1]],
    // 3: giving sets, flushes, saline
    [[P.flat(resus ? 'bloodSet' : 'ivSet'), 1, 4], [P.flat('ivSet'), 1, 3], [P.small('extSet'), 1, 2], [P.carton('flush'), 1, 1], [P.small('wipes'), 1, 1]],
    // 4 (top): gloves
    [[P.gloves('glovesS'), 1, 2], [P.gloves('glovesM'), 1, 3], [P.gloves('glovesL'), 1, 2]],
  ];
  if (ward && li === 1) rows[1] = [[P.small('catheter'), 2, 2], [P.carton('syr10'), 1, 1], [P.small('ndl21'), 1, 2], [P.carton('ecg'), 1, 1]];
  const list = rows[Math.min(li, rows.length - 1)];
  // shift each section's mix a little so neighbouring sections don't look copied
  const start = (si * 2) % list.length;
  const ordered = [...list.slice(start), ...list.slice(0, start)];
  // the first section keeps room at the right end for a thing you can take (cabinets.ts puts a real
  // one there): [kind, width it needs]
  const take: [string, number] | null = ward || si !== 0 ? null : li === 4 ? ['gloveBox', 0.27] : li === 2 ? ['gauzePack', 0.16] : li === 3 ? [resus ? 'salineBag' : 'ivSet', 0.19] : li === 1 ? ['syringe', 0.14] : null;
  shelfRow(g, ordered, a, take ? b - take[1] : b, y, zFront, rand);
  if (take) slot(g, take[0], b - take[1] / 2 - 0.006, y + 0.002, zFront - 0.085, 0);
}

/** linen on one shelf level: sheets, pillowcases, gowns, blankets, towels, spare scrubs */
function linenShelf(g: THREE.Object3D, a: number, b: number, y: number, zFront: number, li: number, rand: Rand) {
  const kinds = [['lnTowel', 'lnTowel'], ['lnBlanket', 'lnBlanket'], ['lnBlue', 'lnBlue', 'lnScrubs'], ['lnSheet', 'lnSheet', 'lnPillow'], ['lnPillow', 'lnSheet']][Math.min(li, 4)];
  let x = a + 0.015;
  let k = 0;
  while (x + 0.34 < b - 0.01) {
    const kind = kinds[k % kinds.length];
    const h = kind === 'lnBlanket' ? 0.26 : kind === 'lnPillow' ? 0.12 : 0.2 + rand() * 0.06;
    pack(g, P.linen(kind, h, 0.33, 0.32), x + 0.165, y + 0.001, zFront - 0.17 - rand() * 0.015, (rand() - 0.5) * 0.05);
    x += 0.35;
    k++;
  }
}

/** a wire coat hanger hanging from the rail (x across the cupboard, garment shoulders along z) */
function hanger(g: THREE.Object3D, x: number, yRail: number, z: number, bare: boolean) {
  const wire = M.chrome();
  tube(g, [[x, yRail + 0.012, z - 0.012], [x, yRail + 0.03, z], [x, yRail + 0.012, z + 0.014], [x, yRail - 0.02, z + 0.006], [x, yRail - 0.05, z]], 0.0018, wire, 10, 4);
  tube(g, [[x, yRail - 0.05, z], [x, yRail - 0.13, z - 0.2], [x, yRail - 0.14, z + 0.2], [x, yRail - 0.05, z]], 0.0022, wire, 12, 4);
  void bare;
}

/** inside a patient-room wardrobe: their clothes on hangers, shoes and a bag (or an empty rail) */
function wardrobeInside(g: THREE.Object3D, room: string, w: number, yShelf: number, yFloor: number, rand: Rand) {
  const rail = yShelf - 0.07;
  const clothes = WARD_CLOTHES[room];
  // a spare pillow and blanket on the shelf
  pack(g, P.linen('lnPillow', 0.12, 0.5, 0.34), -w / 4, yShelf + 0.018, -0.03, 0.03);
  pack(g, P.linen('lnBlanket', 0.16, 0.42, 0.32), w / 4, yShelf + 0.018, -0.03, -0.02);
  if (!clothes) {
    for (let i = 0; i < 4; i++) hanger(g, -w / 2 + 0.25 + i * 0.07 + rand() * 0.02, rail, -0.02, true);
    return;
  }
  // a coat, a shirt or cardigan, trousers over a bar; walking shoes; a holdall
  const [c0, c1, c2] = clothes;
  const coat = M.fabric(c0);
  const shirt = M.fabric(c1);
  const trousers = M.fabric(c2);
  const xs = [-w / 2 + 0.16, -w / 2 + 0.26, -w / 2 + 0.36];
  hanger(g, xs[0], rail, -0.02, false);
  rboxB(g, 0.07, 0.86, 0.44, 0.03, coat, xs[0], rail - 0.13 - 0.86, -0.02);
  hanger(g, xs[1], rail, -0.02, false);
  rboxB(g, 0.04, 0.62, 0.4, 0.02, shirt, xs[1], rail - 0.13 - 0.62, -0.02);
  hanger(g, xs[2], rail, -0.02, false);
  rboxB(g, 0.035, 0.5, 0.3, 0.015, trousers, xs[2], rail - 0.14 - 0.5, -0.02);
  for (let i = 0; i < 2; i++) hanger(g, w / 2 - 0.3 + i * 0.07, rail, -0.02, true);
  const shoe = lambert('#2c2622', { roughness: 0.55 });
  for (const dx of [0, 0.11]) rboxB(g, 0.095, 0.08, 0.27, 0.03, shoe, -w / 2 + 0.12 + dx, yFloor, 0.0);
  rboxB(g, 0.42, 0.26, 0.24, 0.05, M.fabric('#3b4a5c'), w / 4 + 0.05, yFloor, -0.04);
  tube(g, [[w / 4 - 0.1, yFloor + 0.25, -0.04], [w / 4 + 0.05, yFloor + 0.34, -0.04], [w / 4 + 0.2, yFloor + 0.25, -0.04]], 0.008, lambert('#1d232a', { roughness: 0.6 }), 10, 5);
}

/** the nurses' station's low lateral file: three drawers of hanging files and forms */
function fileCabinet(p: PropDef, g: THREE.Group, W: number, D: number, H: number) {
  const rand = rng(p.id);
  const T = 0.018;
  const body = CAB.body();
  for (const s of [-1, 1]) boxB(g, T, H - T, D, body, s * (W / 2 - T / 2), 0, 0);
  boxB(g, W, T, D, M.laminate('#e3ddd2'), 0, H - T, 0);
  boxB(g, W - 2 * T, 0.05, D - 0.06, M.dark(), 0, 0, -0.03);
  boxB(g, W - 2 * T, H - 0.05 - T, 0.008, body, 0, 0.05, -D / 2 + 0.004);
  const n = 3;
  const y0 = 0.055;
  const fh = (H - T - y0 - 0.006) / n;
  for (let i = 0; i < n; i++) {
    const yb = y0 + i * fh;
    const name = ['bottom drawer', 'middle drawer', 'top drawer'][i];
    cabPart(g, { kind: 'drawer', max: D - 0.08, handle: [0, yb + fh - 0.08, D / 2 + 0.002 + 0.019 + 0.022], grip: 'pull', size: [W - 0.004, fh - 0.004, D - 0.04], name }, [0, 0, 0], (d) => {
      rboxB(d, W - 0.004, fh - 0.004, 0.019, 0.004, CAB.door(), 0, yb + 0.002, D / 2 + 0.002 + 0.0095);
      pullHandle(d, 0, yb + fh - 0.08, D / 2 + 0.002 + 0.019, 0.2, 0.022);
      // a label holder
      boxB(d, 0.1, 0.04, 0.004, M.alu(), 0, yb + fh - 0.05, D / 2 + 0.002 + 0.019 + 0.002);
      const inner = cabInner(d);
      tray(inner, W - 0.05, D - 0.06, yb + 0.012, fh - 0.06, D / 2 + 0.002);
      // hanging files on rails, tabs up; forms and paper in the bottom one
      if (i === 0) {
        pack(inner, P.carton('paper'), -0.2, yb + 0.018, 0.05, 0);
        pack(inner, P.carton('paper'), -0.2, yb + 0.12, 0.05, 0.03);
        pack(inner, P.carton('forms'), 0.15, yb + 0.018, 0.05, 0);
      } else {
        const files = ['#d9a400', '#3d74c9', '#3aa36a', '#c0392b', '#8e5ec4', '#5b6b7a'];
        for (let k = 0; k < 14; k++) {
          const z = D / 2 - 0.06 - k * ((D - 0.12) / 14);
          rboxB(inner, W - 0.12, fh - 0.11, 0.008, 0.002, lambert(k % 3 ? '#cbb37c' : '#bfa66d', { roughness: 0.8 }), (rand() - 0.5) * 0.02, yb + 0.03, z);
          boxB(inner, 0.07, 0.02, 0.006, lambert(files[k % files.length], { roughness: 0.5 }), -W / 2 + 0.12 + ((k * 0.13) % (W - 0.3)), yb + fh - 0.08, z);
        }
      }
    });
  }
  cabUnit(g, { role: 'files', noun: 'filing cabinet', box: [-W / 2, 0, -D / 2, W / 2, H, D / 2] });
}

/** an open tray (bottom, sides, back) of a drawer: w wide, depth deep behind zFront, h high */
function tray(inner: THREE.Object3D, w: number, depth: number, y: number, h: number, zFront: number, mat = CAB.tray()) {
  const t = 0.006;
  boxB(inner, w, t, depth, mat, 0, y, zFront - depth / 2);
  for (const s of [-1, 1]) boxB(inner, t, h, depth, mat, s * (w / 2 - t / 2), y + t, zFront - depth / 2);
  boxB(inner, w - 2 * t, h, t, mat, 0, y + t, zFront - depth + t / 2);
}

// ───────────────────────────── drawers (carts) ─────────────────────────────

/** what is in a drawer, by set and drawer: [pack, how many] laid flat in compartments, labels up */
const DRAWER_SETS: Record<string, Record<string, [Pack, number][]>> = {
  crash: {
    A: [[P.flat('ett7'), 2], [P.flat('ett8'), 2], [P.small('opa3'), 2], [P.small('opa4'), 2], [P.small('npa'), 2], [P.flat('blade'), 2], [P.flat('stylet'), 1], [P.flat('suction'), 2]],
    B: [[P.carton('nrb'), 2], [P.carton('neb'), 2], [P.flat('o2tube'), 3], [P.small('faceMask'), 2]],
    C: [[P.small('can14'), 1], [P.small('can16'), 1], [P.small('can18'), 1], [P.small('can20'), 1], [P.flat('ivSet'), 2], [P.small('io'), 1], [P.small('flush'), 2], [P.small('tourn'), 1], [P.small('bloodCult'), 1], [P.flat('pressBag'), 1]],
    D: [[P.drug('epi'), 6], [P.drug('amio'), 2], [P.drug('atro'), 2], [P.drug('lido'), 1], [P.amp('aden'), 2], [P.drug('calc'), 2], [P.amp('nalox'), 2], [P.amp('mag'), 2], [P.amp('gluc'), 1], [P.amp('bicarb'), 1]],
    E: [[P.flat('pads'), 2], [P.small('ecg'), 2], [P.small('razor'), 2], [P.small('probe'), 1], [P.small('glovesM'), 1]],
  },
  airway: {
    A: [[P.flat('ett7'), 2], [P.flat('ett8'), 2], [P.flat('blade'), 3], [P.flat('stylet'), 2], [P.flat('bougie'), 1], [P.carton('syr10'), 1]],
    B: [[P.carton('sga3'), 1], [P.carton('sga4'), 2], [P.small('npa'), 2]],
    C: [[P.small('faceMask'), 2], [P.small('opa3'), 2], [P.small('opa4'), 2], [P.flat('o2tube'), 2]],
    D: [[P.flat('scalpel'), 2], [P.flat('bougie'), 1], [P.flat('ett6'), 2]],
    P: [[P.small('paedSga'), 2], [P.flat('paedEtt'), 2], [P.small('opa3'), 1], [P.small('faceMask'), 1]],
  },
  cart: {
    '0': [[P.carton('ecg'), 2], [P.small('tubes'), 2], [P.small('bloodCult'), 1]],
    '1': [[P.small('ivStart'), 3], [P.carton('flush'), 1], [P.small('tourn'), 1]],
    '2': [[P.small('dressTp'), 2], [P.gauze('gauze'), 3], [P.small('tape'), 1], [P.small('wipes'), 1]],
    '3': [[P.small('can20'), 1], [P.small('can18'), 1], [P.small('can16'), 1], [P.carton('syr10'), 1], [P.small('ndl21'), 1]],
  },
  isolation: {
    '0': [[P.carton('visor'), 2], [P.carton('wipesSurf'), 1]],
    '1': [[P.carton('ffp2'), 2], [P.carton('maskIIR'), 1]],
    '2': [[P.gloves('glovesS'), 1], [P.gloves('glovesM'), 1], [P.gloves('glovesL'), 1]],
    '3': [[P.linen('lnYellow', 0.07, 0.3, 0.22), 3]],
  },
};
/** things you can take out of a drawer (ground floor; cabinets.ts makes them real items) */
const DRAWER_SLOTS: Record<string, Record<string, string>> = {
  crash: { C: 'ivCannula', D: 'adrenaline', E: 'gauzePack' },
  cart: { '1': 'salineFlush', '0': 'specimenTubes', '2': 'tourniquet' },
  isolation: { '3': 'isoGown', '2': 'gloveBox' },
};

/**
 * A drawer's tray and contents, in the drawer part's frame: the tray behind the front (whose back
 * face is at zFront), laid out in compartments, labels up.
 */
export function drawerInner(part: THREE.Group, set: string, key: string, w: number, depth: number, yBottom: number, h: number, zFront: number, unitId = '') {
  const inner = cabInner(part);
  tray(inner, w, depth, yBottom, h, zFront);
  const rand = rng(`${unitId}|${set}|${key}`);
  const list = DRAWER_SETS[set]?.[key] ?? [];
  const y = yBottom + 0.006;
  // rows from the back, each row as deep as its deepest pack
  let x = -w / 2 + 0.012;
  let z = zFront - depth + 0.012;
  let rowD = 0;
  const divider = CAB.divider();
  for (const [p, count] of list) {
    for (let k = 0; k < count; k++) {
      // lying flat: its footprint w × d, the label on top
      if (x + p.w > w / 2 - 0.012) {
        x = -w / 2 + 0.012;
        z += rowD + 0.012;
        rowD = 0;
        if (z < zFront - 0.02) boxB(inner, w - 0.012, Math.min(0.045, h - 0.01), 0.004, divider, 0, y, z - 0.006);
      }
      if (z + p.d > zFront - 0.01) break;
      const lie: Pack = { ...p, top: p.top ?? p.front };
      pack(inner, lie, x + p.w / 2, y, z + p.d / 2, (rand() - 0.5) * 0.04);
      x += p.w + 0.008;
      rowD = Math.max(rowD, p.d);
    }
  }
  const sl = DRAWER_SLOTS[set]?.[key];
  if (sl && x + 0.16 < w / 2) slot(inner, sl, Math.min(w / 2 - 0.09, x + 0.08), y + 0.001, Math.min(zFront - 0.08, z + 0.07), 0);
  else if (sl) slot(inner, sl, w / 2 - 0.1, y + 0.001, zFront - 0.07, 0);
  return inner;
}

/**
 * Drawers stacked in a cart's front (the body behind them is solid: each drawer's tray comes out of
 * it): fronts `fw` wide with their backs on the body's face at zFace, a dark recess behind each
 * front for when it is out. `drawers` bottom to top: [front's bottom y, front height, name, set key].
 */
export function cartDrawers(g: THREE.Group, o: { set: string; fw: number; zFace: number; depth: number; travel: number; drawers: [number, number, string, string][]; front: THREE.Material; handleW: number; handleMat?: THREE.Material; tags?: Record<string, [string, string]>; unitId?: string }) {
  const T = 0.012;
  for (const [y0, fh, name, key] of o.drawers) {
    // the recess you see behind an open drawer (2.5 mm proud of the body: no shared plane)
    boxB(g, o.fw - 0.03, fh - 0.03, 0.002, CAB.recess(), 0, y0 + 0.015, o.zFace + 0.0025);
    const hy = y0 + fh - 0.045;
    cabPart(g, { kind: 'drawer', max: o.travel, handle: [0, hy, o.zFace + 0.004 + T + 0.022], grip: 'pull', size: [o.fw, fh, o.depth], name }, [0, 0, 0], (d) => {
      rboxB(d, o.fw, fh, T, 0.005, o.front, 0, y0, o.zFace + 0.004 + T / 2);
      pullHandle(d, 0, hy, o.zFace + 0.004 + T, o.handleW, 0.022, o.handleMat ?? M.satin());
      const tag = o.tags?.[key];
      if (tag) {
        const r = customLabel(`tag|${tag[0]}|${tag[1]}`, [320, 40], drawTag(tag[0], key, tag[1]));
        const m = new THREE.Mesh(uvBox(0.26, 0.0325, 0.002, r), labelMaterial());
        m.position.set(0, y0 + fh * 0.36, o.zFace + 0.004 + T + 0.001);
        d.add(m);
      }
      drawerInner(d, o.set, key, o.fw - 0.05, o.depth, y0 + 0.012, fh - 0.04, o.zFace + 0.004, o.unitId);
    });
  }
}

/** a coloured tab with the drawer's letter, then what's in it (like resusGear's drawer tags) */
const drawTag = (color: string, letter: string, text: string): Draw => (ctx, w, h) => {
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, h * 1.15, h);
  fit(ctx, letter, h * 0.575, h / 2 + 1, h, h * 0.78, 800, 'center', '#ffffff');
  fit(ctx, text, h * 1.4, h / 2 + 1, w - h * 1.55, h * 0.6, 700, 'left', '#1b1e21');
};

/** a thin box whose front face shows a label region (a sticker: its back on the surface it sits on) */
function uvBox(w: number, h: number, d: number, r: Region): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const edge = [(r[0] + r[2]) / 2, r[1] + 0.0005];
  for (let f = 0; f < 6; f++)
    for (let i = f * 4; i < f * 4 + 4; i++) {
      if (f === 4) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
      else uv.setXY(i, edge[0], edge[1]);
    }
  return trackGeo(g);
}

/** what the prompt calls each drawer ("Open drawer C: circulation, IV and IO") */
const CRASH_NAMES: Record<string, string> = { A: 'airway', B: 'breathing', C: 'circulation, IV and IO', D: 'drugs', E: 'equipment' };
/** the A–E tags of a crash cart's drawers (resusGear.ts has the same for Resus 1 and 2) */
export const CRASH_TAGS: Record<string, [string, string]> = { A: ['#2e8b57', 'AIRWAY'], B: ['#2a72bd', 'BREATHING'], C: ['#c0392b', 'CIRCULATION · IV / IO'], D: ['#6b4fb3', 'DRUGS'], E: ['#5b6b7a', 'EQUIPMENT'] };

/**
 * A crash cart's numbered breakaway seal: a yellow tag on a strap through the top drawer's handle
 * (cabinets.ts breaks it when the cart is opened, and a new one goes on once pharmacy has checked
 * it). `broken` is the snapped strap left hanging on the drawer.
 */
export function cabSeal(parent: THREE.Object3D, x: number, y: number, z: number, no: string) {
  const seal = keep(parent, 'cabSeal', no);
  const r = customLabel(`seal|${no}`, [64, 112], drawSeal(no));
  const tag = new THREE.Mesh(uvBox(0.022, 0.038, 0.003, r), labelMaterial());
  tag.position.set(x, y - 0.03, z + 0.0035);
  seal.add(tag);
  tube(seal, [[x - 0.004, y + 0.012, z - 0.002], [x, y + 0.02, z + 0.012], [x + 0.004, y + 0.006, z + 0.006], [x, y - 0.011, z + 0.003]], 0.0012, lambert('#f2c230', { roughness: 0.45 }), 10, 4);
  return seal;
}

/** the snapped strap on the drawer (shown once the seal is broken) */
export function cabSealBroken(part: THREE.Object3D, x: number, y: number, z: number) {
  const b = keep(part, 'cabSealBroken');
  tube(b, [[x, y + 0.006, z], [x + 0.003, y - 0.01, z + 0.006], [x + 0.001, y - 0.03, z + 0.004]], 0.0012, lambert('#f2c230', { roughness: 0.45 }), 8, 4);
  b.visible = false;
  return b;
}

/** the props crash cart (Resus 3, Ward 2 East): five drawers A (top) … E, a seal on drawer A */
export function crashCartDrawers(g: THREE.Group, unitId: string) {
  const ys = [0.16, 0.325, 0.49, 0.655, 0.82];
  const keys = ['E', 'D', 'C', 'B', 'A'];
  cartDrawers(g, {
    set: 'crash',
    fw: 0.64,
    zFace: 0.26,
    depth: 0.44,
    travel: 0.34,
    drawers: ys.map((y, i) => [y, 0.155, `drawer ${keys[i]}: ${CRASH_NAMES[keys[i]]}`, keys[i]] as [number, number, string, string]),
    front: lambert('#c7302b', { roughness: 0.3, metalness: 0.25 }),
    handleW: 0.3,
    tags: CRASH_TAGS,
    unitId,
  });
  // the seal bridges drawer A's top edge and the cart's body (opening the drawer breaks it)
  cabSeal(g, 0.25, 0.975, 0.26 + 0.004 + 0.012 + 0.004, sealNumber(unitId));
  const top = g.children.filter((c) => c.userData.cabPart).pop();
  if (top) cabSealBroken(top, 0.25, 0.963, 0.26 + 0.004 + 0.012 + 0.004);
  cabUnit(g, { role: 'crash', noun: 'crash cart', lock: 'seal', box: [-0.37, 0, -0.28, 0.37, 1.36, 0.28] });
}

/** a 6-digit seal number from the cart and how many times it has been re-sealed */
export function sealNumber(id: string, n = 0): string {
  const r = rng(`${id}|${n}`);
  return String(100000 + Math.floor(r() * 899999));
}

/** the supply cart (props 'cart'): four drawers of IV starts, flushes, dressings, tubes, electrodes */
export function supplyCartDrawers(g: THREE.Group, unitId: string) {
  cartDrawers(g, {
    set: 'cart',
    fw: 0.46,
    zFace: 0.22,
    depth: 0.38,
    travel: 0.3,
    drawers: [0, 1, 2, 3].map((i) => [0.16 + i * 0.19, 0.17, ['bottom drawer', 'third drawer', 'second drawer', 'top drawer'][i], String(i)] as [number, number, string, string]),
    front: M.plastic('#c3d4de'),
    handleW: 0.12,
    handleMat: M.alu(),
    unitId,
  });
  cabUnit(g, { role: 'cart', noun: 'supply cart', box: [-0.28, 0, -0.24, 0.28, 0.98, 0.24] });
}

// ───────────────────────────── corridor carts (details.ts) ─────────────────────────────

/** the linen cart: an open steel frame, three shelves of linen, a cover that rolls up at the front */
export function linenCart(unitId: string): THREE.Group {
  const g = new THREE.Group();
  const f = lambert('#c3c9cd', { roughness: 0.32, metalness: 0.75 });
  const rand = rng(unitId);
  for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.22]) boxB(g, 0.025, 1.5, 0.025, f, x, 0.08, z);
  for (const y of [0.25, 0.75, 1.25]) {
    boxB(g, 0.88, 0.02, 0.48, f, 0, y, 0);
    const kinds = y < 0.5 ? ['lnBlanket', 'lnBlanket', 'lnTowel'] : y < 1 ? ['lnBlue', 'lnBlue', 'lnPillow'] : ['lnSheet', 'lnSheet', 'lnSheet'];
    for (let i = 0; i < 3; i++) {
      const k = kinds[i];
      const h = k === 'lnBlanket' ? 0.3 : k === 'lnPillow' ? 0.16 : 0.22 + rand() * 0.08;
      pack(g, P.linen(k, h, 0.27, 0.38), -0.29 + i * 0.29, y + 0.02, -0.01, (rand() - 0.5) * 0.06);
    }
  }
  slot(g, 'blanket', -0.15, 0.27 + 0.3, 0.06, 0);
  slot(g, 'gown', 0.15, 0.77 + 0.22, 0.06, 0);
  const cover = lambert('#5f8fb0', { roughness: 0.7 });
  // sides and back stay down (vinyl, in the frame); the front rolls up
  for (const s of [-1, 1]) boxB(g, 0.006, 1.42, 0.44, cover, s * 0.445, 0.11, 0);
  boxB(g, 0.86, 1.42, 0.006, cover, 0, 0.11, -0.245);
  boxB(g, 0.9, 0.02, 0.5, f, 0, 1.56, 0);
  const H = 1.42;
  cabPart(g, { kind: 'shutter', max: 0.9, handle: [0, -H + 0.04, 0.03], grip: 'pull', size: [0.86, H, 0], name: 'cover' }, [0, 1.53, 0.255], (d) => {
    const c = keep(d, 'cabCover');
    boxB(c, 0.86, H, 0.006, cover, 0, -H, 0);
    // a webbing pull-loop at the bottom edge
    boxB(c, 0.12, 0.03, 0.01, lambert('#2b3a48', { roughness: 0.8 }), 0, -H + 0.02, 0.006);
    // the roll it winds onto (grows as it rolls up: cabinets.ts scales it about its axis)
    const roll = keep(d, 'cabRoll');
    roll.position.set(0, 0, 0.022);
    add(roll, G.cyl(0.025, 0.025, 0.86, 14), cover, 0, 0, 0, 0, 0, Math.PI / 2);
  });
  for (const x of [-0.38, 0.38]) for (const z of [-0.2, 0.2]) add(g, G.cyl(0.05, 0.05, 0.03, 12), M.rubber(), x, 0.05, z, 0, 0, Math.PI / 2);
  cabUnit(g, { role: 'linenCart', noun: 'linen cart', id: unitId, box: [-0.45, 0, -0.25, 0.45, 1.57, 0.26] });
  return g;
}

/** the isolation cart: four drawers of eye protection, respirators, gloves, gowns; masks and gloves on top */
export function isolationCart(unitId: string): THREE.Group {
  const g = new THREE.Group();
  rboxB(g, 0.55, 1.05, 0.45, 0.03, M.plastic('#f2c230', 0.4), 0, 0.1, 0);
  cartDrawers(g, {
    set: 'isolation',
    fw: 0.5,
    zFace: 0.225,
    depth: 0.38,
    travel: 0.3,
    drawers: [0, 1, 2, 3].map((i) => [0.17 + i * 0.24, 0.22, ['bottom drawer', 'third drawer', 'second drawer', 'top drawer'][i], String(i)] as [number, number, string, string]),
    front: M.plastic('#e6b21f', 0.4),
    handleW: 0.14,
    handleMat: M.dark(),
    unitId,
  });
  rboxB(g, 0.3, 0.12, 0.2, 0.01, lambert('#e9e4ff', { roughness: 0.8 }), -0.1, 1.15, 0);
  rboxB(g, 0.2, 0.1, 0.2, 0.01, lambert('#9fd1f2', { roughness: 0.8 }), 0.15, 1.15, 0);
  for (const x of [-0.22, 0.22]) for (const z of [-0.18, 0.18]) add(g, G.cyl(0.045, 0.045, 0.03, 12), M.rubber(), x, 0.045, z, 0, 0, Math.PI / 2);
  cabUnit(g, { role: 'isolation', noun: 'isolation cart', id: unitId, box: [-0.28, 0, -0.23, 0.28, 1.25, 0.23] });
  return g;
}

// ───────────────────────────── fridges ─────────────────────────────

/** the medication rooms' fridges hold drugs; the lounge's is the staff fridge */
export function fridgeRole(p: PropDef): 'medFridge' | 'staffFridge' {
  return /med/.test(p.room) || p.room === 'medroom' ? 'medFridge' : 'staffFridge';
}

/**
 * A fridge 0.7 × 1.8 × 0.65: a white steel shell, a liner and wire shelves inside, a door with its
 * gasket and a temperature display. The medication fridge has one door and drugs kept at 2–8 °C;
 * the staff fridge a freezer on top and lunch in the bottom.
 */
export function buildFridge(p: PropDef, g: THREE.Group) {
  const role = fridgeRole(p);
  const W = 0.7;
  const H = 1.8;
  const D = 0.62;
  const T = 0.035;
  const shell = lambert('#eef0f0', { roughness: 0.3, metalness: 0.2 });
  const liner = lambert('#f6f7f6', { roughness: 0.35 });
  const wire = M.chrome();
  for (const s of [-1, 1]) boxB(g, T, H - T, D, shell, s * (W / 2 - T / 2), 0, 0);
  boxB(g, W, T, D, shell, 0, H - T, 0);
  boxB(g, W - 2 * T, 0.08, D - 0.05, M.dark(), 0, 0, -0.025);
  boxB(g, W - 2 * T, T, D - 0.01, liner, 0, 0.08, -0.005);
  boxB(g, W - 2 * T, H - 0.08 - 2 * T, 0.03, liner, 0, 0.08 + T, -D / 2 + 0.015);
  const rand = rng(p.id);
  const x0 = -W / 2 + T;
  const x1 = W / 2 - T;
  const zFront = D / 2 - 0.05;
  const shelf = (y: number) => {
    for (let k = 0; k < 9; k++) boxB(g, 0.004, 0.004, D - 0.1, wire, x0 + 0.03 + (k * (x1 - x0 - 0.06)) / 8, y, -0.01);
    boxB(g, x1 - x0 - 0.01, 0.006, 0.006, wire, 0, y, zFront - 0.005);
  };
  const doorZ = D / 2 + 0.002;
  if (role === 'medFridge') {
    const ys = [0.12 + T, 0.5, 0.86, 1.22];
    ys.slice(1).forEach(shelf);
    const rows: [Pack, number, number][][] = [
      [[P.amp('tetanus'), 2, 2], [P.amp('hepB'), 2, 1]],
      [[P.drug('insulin'), 3, 2], [P.drug('insulinLa'), 2, 2]],
      [[P.amp('roc'), 2, 2], [P.amp('sux'), 2, 2]],
      [[P.amp('loraz'), 2, 1], [P.amp('oxyt'), 1, 2], [P.vial('insulin'), 3, 1]],
    ];
    ys.forEach((y, i) => shelfRow(g, rows[i], x0, x1, y + 0.004, zFront, rand, 0.01));
    // one door, hinged left; a min/max display at the top of it
    cabPart(g, { kind: 'door', hinge: 'L', max: 1.85, handle: [W - 0.06, 1.15, 0.045 + 0.03], grip: 'bar', size: [W - 0.004, H - 0.1, 0.045], name: 'door', y0: 0.09 }, [-W / 2 + 0.002, 0, doorZ], (d) => {
      rboxB(d, W - 0.004, H - 0.1, 0.045, 0.012, shell, (W - 0.004) / 2, 0.09, 0.0225);
      // gasket inside, door bins
      boxB(d, W - 0.07, H - 0.18, 0.006, lambert('#c9cfd2', { roughness: 0.7 }), (W - 0.004) / 2, 0.13, -0.003);
      for (const y of [0.4, 0.9]) boxB(d, W - 0.16, 0.08, 0.06, liner, (W - 0.004) / 2, y, -0.04);
      barHandle(d, W - 0.06, 1.15, 0.045, 0.5, 0.03);
      const lcd = customLabel('fridge|lcd', [160, 80], (ctx, cw, chh) => {
        ctx.fillStyle = '#0d1a14';
        ctx.fillRect(0, 0, cw, chh);
        fit(ctx, '4.6 °C', cw / 2, chh * 0.42, cw * 0.86, chh * 0.5, 700, 'center', '#9dffb8');
        fit(ctx, 'MIN 3.2  MAX 6.1', cw / 2, chh * 0.8, cw * 0.9, chh * 0.18, 600, 'center', '#6fcf8f');
      });
      const m = new THREE.Mesh(uvBox(0.12, 0.06, 0.004, lcd), labelMaterial());
      m.position.set((W - 0.004) / 2, H - 0.16, 0.045 + 0.002);
      d.add(m);
    });
    cabUnit(g, { role, noun: 'medication fridge', box: [-W / 2, 0, -D / 2, W / 2, H, D / 2] });
  } else {
    // freezer on top (behind its own door), fridge below: milk, yoghurt, lunch boxes, cans, a specimen pot
    const ySplit = 1.2;
    boxB(g, W - 2 * T, 0.03, D - 0.02, liner, 0, ySplit, -0.01);
    [0.55, 0.9].forEach(shelf);
    shelfRow(g, [[box(0.075, 0.2, 0.075, '#ffffff', 'milk'), 1, 1], [box(0.11, 0.08, 0.11, '#ffffff', 'yogurt'), 1, 1]], x0, x1, 0.12 + T, zFront, rand);
    const lunch = ['#3aa36a', '#c0392b', '#2a72bd', '#e07a25'];
    for (let i = 0; i < 3; i++) rboxB(g, 0.17, 0.08, 0.13, 0.015, lambert(lunch[i], { roughness: 0.45 }), x0 + 0.11 + i * 0.19, 0.556, -0.05);
    for (let i = 0; i < 4; i++) cylB(g, 0.033, 0.12, lambert(['#b8231f', '#2a62c9', '#e0a10b', '#3aa36a'][i], { roughness: 0.25, metalness: 0.6 }), x0 + 0.06 + i * 0.075, 0.906, 0.06, 16);
    // "NO SPECIMENS" says the sign. There are specimens.
    cylB(g, 0.03, 0.075, lambert('#f4f8fb', { roughness: 0.2 }), x1 - 0.07, 0.906, 0.08, 14);
    cylB(g, 0.033, 0.014, lambert('#e2c13a', { roughness: 0.3 }), x1 - 0.07, 0.981, 0.08, 14);
    for (const [y0, y1, name] of [[0.09, ySplit - 0.004, 'fridge door'], [ySplit + 0.004, H - 0.01, 'freezer door']] as [number, number, string][]) {
      const hy = name === 'fridge door' ? 0.95 : ySplit + 0.12;
      cabPart(g, { kind: 'door', hinge: 'L', max: 1.85, handle: [W - 0.06, hy, 0.04 + 0.03], grip: 'bar', size: [W - 0.004, y1 - y0, 0.04], name, y0 }, [-W / 2 + 0.002, 0, doorZ], (d) => {
        rboxB(d, W - 0.004, y1 - y0, 0.04, 0.012, shell, (W - 0.004) / 2, y0, 0.02);
        boxB(d, W - 0.07, y1 - y0 - 0.08, 0.006, lambert('#c9cfd2', { roughness: 0.7 }), (W - 0.004) / 2, y0 + 0.04, -0.003);
        barHandle(d, W - 0.06, hy, 0.04, name === 'fridge door' ? 0.42 : 0.2, 0.03);
      });
    }
    cabUnit(g, { role, noun: 'staff fridge', box: [-W / 2, 0, -D / 2, W / 2, H, D / 2] });
  }
}

// ───────────────────────────── controlled-drug cupboard ─────────────────────────────

/**
 * A wall-mounted steel cupboard for controlled drugs (its bottom at the prop's y): one door with a
 * key lock, a warning light that shows while it is open, two shelves of ampoules and tablets; the
 * controlled-drug register on a shelf below it. Its key stays with the nurse in charge.
 */
export function buildCdCupboard(p: PropDef, g: THREE.Group) {
  const W = p.w ?? 0.6;
  const H = p.h ?? 0.7;
  const D = p.d ?? 0.3;
  const T = 0.012;
  const steel = M.paint('#e4e6e1', 0.45);
  const liner = lambert('#eceeea', { roughness: 0.5 });
  // the box, its back on the wall (local z = −D/2)
  for (const s of [-1, 1]) boxB(g, T, H, D, steel, s * (W / 2 - T / 2), 0, 0);
  boxB(g, W - 2 * T, T, D, steel, 0, H - T, 0);
  boxB(g, W - 2 * T, T, D, steel, 0, 0, 0);
  boxB(g, W - 2 * T, H - 2 * T, 0.006, liner, 0, T, -D / 2 + 0.003);
  const rand = rng(p.id);
  const ys = [T, H * 0.5];
  boxB(g, W - 2 * T - 0.002, 0.008, D - 0.04, liner, 0, ys[1] - 0.008, -0.015);
  shelfRow(g, [[P.amp('morph'), 2, 3], [P.amp('fent'), 1, 2], [P.amp('hydro'), 1, 2]], -W / 2 + T, W / 2 - T, ys[0] + 0.001, D / 2 - 0.02, rand, 0.01);
  shelfRow(g, [[P.amp('oxyc'), 2, 2], [P.bottle('methad', '#c69a5a'), 2, 1]], -W / 2 + T, W / 2 - T, ys[1], D / 2 - 0.02, rand, 0.012);
  // the warning light on top: on while the door is open
  const led = keep(g, 'cabLed');
  add(led, G.cyl(0.014, 0.014, 0.012, 14), lambert('#5a1512', { roughness: 0.3 }), W / 2 - 0.06, H + 0.006, D / 2 - 0.05);
  // the register: a bound book on a small shelf 30 cm below
  const yReg = -0.3;
  boxB(g, W * 0.85, 0.018, 0.22, M.laminate('#d8d2c4'), 0, yReg, -D / 2 + 0.11);
  for (const s of [-1, 1]) boxB(g, 0.012, 0.08, 0.16, M.alu(), s * (W * 0.38), yReg - 0.08, -D / 2 + 0.08);
  const cover = customLabel('cd|register', [256, 192], (ctx, w, h) => {
    ctx.fillStyle = '#6e1d22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d8b25a';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    fit(ctx, 'CONTROLLED DRUG', w / 2, h * 0.36, w * 0.8, h * 0.13, 800, 'center', '#f2e2b8');
    fit(ctx, 'REGISTER', w / 2, h * 0.52, w * 0.8, h * 0.13, 800, 'center', '#f2e2b8');
    fit(ctx, 'Emergency Department', w / 2, h * 0.74, w * 0.8, h * 0.08, 600, 'center', '#e8d3a0');
  });
  const book = new THREE.Mesh(uvTop(0.32, 0.045, 0.21, cover, '#6e1d22'), labelMaterial());
  book.position.set(-0.04, yReg + 0.018 + 0.0225, -D / 2 + 0.115);
  book.rotation.y = 0.06;
  g.add(book);
  // a pen on a cord beside it
  add(g, G.cyl(0.0045, 0.0045, 0.13, 8), lambert('#1f4f9f', { roughness: 0.3 }), 0.19, yReg + 0.023, -D / 2 + 0.12, 0, 0.3, Math.PI / 2);
  // the door: hinged left, a cylinder lock and a pull at its free edge, the sign
  const dw = W - 0.004;
  const dh = H - 0.004;
  const lx = dw - 0.055;
  const ly = H * 0.5;
  cabPart(g, { kind: 'door', hinge: 'L', max: 1.92, handle: [lx, ly - 0.07, 0.016 + 0.02], grip: 'pull', size: [dw, dh, 0.016], name: 'door', y0: 0.002 }, [-W / 2 + 0.002, 0, D / 2 + 0.002], (d) => {
    rboxB(d, dw, dh, 0.016, 0.004, steel, dw / 2, 0.002, 0.008);
    const sign = customLabel('cd|sign', [256, 64], (ctx, w, h) => {
      ctx.fillStyle = '#b3261e';
      ctx.fillRect(0, 0, w, h);
      fit(ctx, 'CONTROLLED DRUGS', w / 2, h / 2 + 1, w * 0.9, h * 0.55, 800, 'center', '#ffffff');
    });
    const m = new THREE.Mesh(uvBox(0.3, 0.075, 0.002, sign), labelMaterial());
    m.position.set(dw / 2 - 0.04, dh - 0.11, 0.016 + 0.001);
    d.add(m);
    pullHandle(d, lx, ly - 0.07, 0.016, 0.08, 0.02);
    // the lock: escutcheon, then the barrel (it turns a quarter when unlocked) and the key's place
    add(d, G.cyl(0.018, 0.018, 0.004, 18), M.chrome(), lx, ly, 0.018, Math.PI / 2, 0, 0);
    const lock = keep(d, 'cabLock', 'cd');
    lock.position.set(lx, ly, 0.0215);
    add(lock, G.cyl(0.011, 0.011, 0.004, 16), lambert('#c9a24a', { roughness: 0.3, metalness: 0.8 }), 0, 0, 0, Math.PI / 2, 0, 0);
    boxB(lock, 0.0025, 0.012, 0.0015, M.black(), 0, -0.006, 0.002);
    const key = keep(lock, 'cabKey');
    // a brass key and the red "CD" fob on its ring
    boxB(key, 0.007, 0.03, 0.003, lambert('#c9a24a', { roughness: 0.3, metalness: 0.8 }), 0, -0.004, 0.004 + 0.0015);
    add(key, G.torus(0.011, 0.0022, 6, 14), lambert('#c9a24a', { roughness: 0.3, metalness: 0.8 }), 0, -0.022, 0.006);
    add(key, G.torus(0.016, 0.0016, 6, 16), M.alu(), 0, -0.042, 0.007);
    rboxB(key, 0.03, 0.04, 0.004, 0.006, lambert('#c0392b', { roughness: 0.5 }), 0.004, -0.1, 0.009);
    key.visible = false;
  });
  cabUnit(g, { role: 'cd', noun: 'controlled-drug cupboard', lock: 'key', box: [-W / 2, 0, -D / 2, W / 2, H, D / 2] });
}

/** a box with a label on top and plain sides (a book lying flat) */
function uvTop(w: number, h: number, d: number, r: Region, side: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const plain = swatch(side);
  const pages = swatch('#efe8d6');
  for (let f = 0; f < 6; f++)
    for (let i = f * 4; i < f * 4 + 4; i++) {
      if (f === 2) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
      else if (f === 0 || f === 4) uv.setXY(i, pages[0], pages[1]);
      else uv.setXY(i, plain[0], plain[1]);
    }
  return trackGeo(g);
}

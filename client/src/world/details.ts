/**
 * Set dressing that makes the ED read as a real, lived-in department: equipment parked in the
 * corridor (wheelchair, linen and isolation carts, workstations on wheels, a spare stretcher,
 * a wet-floor sign), wall fixtures (AED, fire extinguishers, live analog clocks, EXIT signs,
 * paper-towel dispensers), bedside tables, and ceiling hardware (smoke detectors, sprinklers,
 * supply-air diffusers). Every piece of equipment is inspectable (see FIXTURE_INFO in items.ts).
 */
import * as THREE from 'three';
import type { LayoutDef } from '../../../shared/layout';
import type { Interactable } from './builder';
import { FIXTURE_INFO } from './items';
import { G, add, boxB, canvasTexture, emitter, glass, lambert, makeCanvas, own, pbr, rboxB, tube } from './materials';
import { isolationCart, linenCart } from './cabinetModels';

export interface Clock {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  last: string;
}

export interface Details {
  interactables: Interactable[];
  colliders: THREE.Box3[];
  clocks: Clock[];
  /** extra surfaces for decor scatter: bedside tables */
  surfaces: { id: string; x: number; z: number; y: number; rot: number; w: number; d: number; kinds: string[] }[];
  /** where case items sit per bay */
  bedside: Map<string, { table: THREE.Vector3; chair: THREE.Vector3; foot: THREE.Vector3 }>;
  /** the workstations on wheels (you log into them: workstation.ts); id = the key of their E target */
  wows: { id: string; x: number; z: number; rot: number }[];
  /** where the corridor wheelchair is parked at the start (wheelchair.ts builds and drives it: it moves) */
  wheelchairHome: { x: number; z: number; rot: number };
}

const WALL_T = 0.12;

const M = {
  frame: () => lambert('#c3c9cd', { roughness: 0.32, metalness: 0.75 }),
  chrome: () => lambert('#d9dde0', { roughness: 0.16, metalness: 1 }),
  black: () => lambert('#1b1e21', { roughness: 0.45 }),
  rubber: () => pbr('rubber', { color: '#2a2d30', tile: 0.2, roughness: 0.9 }),
  plastic: (c: string, r = 0.4) => lambert(c, { roughness: r }),
  fabric: (c: string) => pbr('fabric_seat', { color: c, tile: 0.4, roughness: 1 }),
};

function inspectable(out: Interactable[], key: string, subject: string, obj: THREE.Object3D, pad = 0.06) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj).expandByScalar(pad);
  const info = FIXTURE_INFO[subject];
  out.push({ key: `fx:${key}`, target: { kind: 'inspect', subject, label: `Inspect ${info?.title.toLowerCase() ?? subject}` }, box, center: box.getCenter(new THREE.Vector3()) });
}

function place(parent: THREE.Object3D, g: THREE.Group, x: number, y: number, z: number, rot = 0) {
  g.position.set(x, y, z);
  g.rotation.y = rot;
  parent.add(g);
  return g;
}

// ── equipment builders (origin on the floor, front +z) ──

type Side = 'L' | 'R';

/**
 * The corridor wheelchair, in parts that move (wheelchair.ts rides it). Chair frame: origin on the
 * floor under the seat's centre, front +z; the rider's left is +x (L), right −x (R).
 *   wheels    the rear wheels (tyre on a rim, spokes, hub, the push rim on six tabs), each spinning
 *             about its axle (local x)
 *   casters   front casters: `swivel` turns about the stem (local y), the wheel trails it along
 *             local −z; `wheel` spins about its axle (local x)
 *   plates    flip-up footplates hinged on their outer edge (rotation.z: −side × π/2 is up)
 */
export interface WheelchairModel {
  root: THREE.Group;
  /** everything that doesn't move (merged by wheelchair.ts) */
  body: THREE.Group;
  wheels: Record<Side, THREE.Group>;
  casters: Record<Side, { swivel: THREE.Group; wheel: THREE.Group }>;
  plates: Record<Side, THREE.Group>;
  /** the sling seat and backrest (the rider's posture is measured from them) */
  seat: THREE.Mesh;
  back: THREE.Mesh;
  /** chair-frame numbers the ride needs (m) */
  dims: { axleY: number; axleZ: number; wheelX: number; wheelR: number; rimR: number; rimX: number; casterR: number; casterTrail: number };
}

/** 24" rear wheels: the tyre's outer radius is the axle height, so they roll exactly 2π × 0.31 m a turn */
const WC = { axleY: 0.31, axleZ: -0.05, wheelX: 0.3, wheelR: 0.31, rimR: 0.26, rimOut: 0.03, casterR: 0.06, casterTrail: 0.045 };

export function wheelchairModel(): WheelchairModel {
  const root = new THREE.Group();
  root.name = 'wheelchair';
  const body = new THREE.Group();
  body.name = 'wheelchair-body';
  root.add(body);
  const f = M.frame();
  const wheels = {} as Record<Side, THREE.Group>;
  const casters = {} as Record<Side, { swivel: THREE.Group; wheel: THREE.Group }>;
  const plates = {} as Record<Side, THREE.Group>;
  for (const s of [-1, 1]) {
    const side: Side = s > 0 ? 'L' : 'R';
    // rear wheel: tyre on a metal rim, 18 spokes, hub (reaching in to the frame), the push rim 3 cm outboard on six tabs
    const w = new THREE.Group();
    w.name = `wheel-${side}`;
    w.position.set(s * WC.wheelX, WC.axleY, WC.axleZ);
    add(w, G.torus(WC.wheelR - 0.017, 0.017, 8, 36), M.rubber(), 0, 0, 0, 0, Math.PI / 2, 0);
    add(w, G.torus(WC.wheelR - 0.033, 0.007, 5, 36), f, 0, 0, 0, 0, Math.PI / 2, 0);
    add(w, G.torus(WC.rimR, 0.008, 6, 32), M.chrome(), s * WC.rimOut, 0, 0, 0, Math.PI / 2, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.26;
      add(w, G.cyl(0.004, 0.004, WC.rimOut, 4), M.chrome(), (s * WC.rimOut) / 2, Math.cos(a) * WC.rimR, Math.sin(a) * WC.rimR, 0, 0, Math.PI / 2);
    }
    add(w, G.cyl(0.035, 0.035, 0.07, 14), M.black(), -s * 0.015, 0, 0, 0, 0, Math.PI / 2);
    for (let k = 0; k < 9; k++) add(w, G.cyl(0.0025, 0.0025, 2 * (WC.wheelR - 0.035), 4), M.chrome(), 0, 0, 0, (k / 9) * Math.PI + 0.1, 0, 0);
    root.add(w);
    wheels[side] = w;
    // side frame: seat rail, backrest post with push handle and its grip
    tube(body, [[s * 0.25, 0.48, 0.32], [s * 0.25, 0.48, -0.2], [s * 0.25, 0.95, -0.25], [s * 0.22, 1.0, -0.36]], 0.012, f, 24, 6);
    add(body, G.cyl(0.017, 0.017, 0.09, 10), M.black(), s * 0.22, 1.0, -0.35, Math.PI / 2 - 0.25, 0, 0);
    // front post down to the caster housing
    tube(body, [[s * 0.25, 0.48, 0.32], [s * 0.25, 0.17, 0.33]], 0.012, f, 4, 6);
    add(body, G.cyl(0.018, 0.018, 0.04, 10), M.black(), s * 0.25, 0.165, 0.33);
    // caster: the fork turns under the stem, the wheel trails it
    const sw = new THREE.Group();
    sw.name = `caster-${side}`;
    sw.position.set(s * 0.25, 0.145, 0.33);
    add(sw, G.cyl(0.012, 0.012, 0.012, 8), f, 0, -0.004, 0);
    boxB(sw, 0.052, 0.008, 0.03, f, 0, -0.012, -WC.casterTrail * 0.35);
    for (const k of [-1, 1]) boxB(sw, 0.006, 0.085, 0.022, f, k * 0.022, 0.06 - 0.145 - 0.012, -WC.casterTrail);
    const cw = new THREE.Group();
    cw.position.set(0, WC.casterR - 0.145, -WC.casterTrail);
    add(cw, G.cyl(WC.casterR, WC.casterR, 0.03, 16), M.rubber(), 0, 0, 0, 0, 0, Math.PI / 2);
    add(cw, G.cyl(0.022, 0.022, 0.034, 10), f, 0, 0, 0, 0, 0, Math.PI / 2);
    sw.add(cw);
    // parked after backing in: casters trailing forward
    sw.rotation.y = Math.PI;
    root.add(sw);
    casters[side] = { swivel: sw, wheel: cw };
    // footrest hanger from the frame to the footplate's hinge
    tube(body, [[s * 0.25, 0.46, 0.3], [s * 0.21, 0.2, 0.41], [s * 0.185, 0.1, 0.44]], 0.01, f, 10, 6);
    // flip-up footplate, hinged on its outer edge (where the hanger ends)
    const pl = new THREE.Group();
    pl.name = `plate-${side}`;
    pl.position.set(s * 0.185, 0.095, 0.45);
    rboxB(pl, 0.145, 0.016, 0.18, 0.006, M.black(), -s * 0.0775, -0.008, 0);
    add(pl, G.cyl(0.012, 0.012, 0.18, 8), f, 0, 0, 0, Math.PI / 2, 0, 0);
    root.add(pl);
    plates[side] = pl;
    // lower side rail: front post to the rear axle housing
    tube(body, [[s * 0.25, 0.22, 0.33], [s * 0.25, 0.27, -0.05]], 0.009, f, 4, 6);
    // wheel lock: a clamp on the seat rail just ahead of the tyre, its lever standing up
    add(body, G.box(0.022, 0.03, 0.06), M.black(), s * 0.264, 0.465, 0.275);
    add(body, G.cyl(0.007, 0.007, 0.14, 8), f, s * 0.279, 0.535, 0.262, -0.3, 0, 0);
    add(body, G.capsule(0.011, 0.03, 3, 8), lambert('#b3261e', { roughness: 0.5 }), s * 0.279, 0.605, 0.24, -0.3, 0, 0);
  }
  // folding cross-brace under the seat
  tube(body, [[-0.25, 0.47, 0.05], [0.25, 0.25, 0.05]], 0.009, f, 4, 6);
  tube(body, [[0.25, 0.47, 0.05], [-0.25, 0.25, 0.05]], 0.009, f, 4, 6);
  // sling seat 0.49 m off the floor (a standard 19" chair), backrest sling above it
  const seat = rboxB(body, 0.46, 0.05, 0.44, 0.02, M.fabric('#232a33'), 0, 0.44, 0.05);
  seat.name = 'wheelchair-seat';
  const back = rboxB(body, 0.44, 0.42, 0.03, 0.015, M.fabric('#232a33'), 0, 0.5, -0.22);
  back.name = 'wheelchair-back';
  return {
    root,
    body,
    wheels,
    casters,
    plates,
    seat,
    back,
    dims: { axleY: WC.axleY, axleZ: WC.axleZ, wheelX: WC.wheelX, wheelR: WC.wheelR, rimR: WC.rimR, rimX: WC.wheelX + WC.rimOut, casterR: WC.casterR, casterTrail: WC.casterTrail },
  };
}

/** the wheelchair as one piece (parked, nothing turns) */
export function wheelchair(): THREE.Group {
  return wheelchairModel().root;
}

// the linen cart (its cover rolls up) and the isolation cart (four drawers): cabinetModels.ts, opened by cabinets.ts

function workstationOnWheels(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(g, G.rbox(0.3, 0.03, 0.05, 0.012), M.black(), Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, 0, -a, 0);
  }
  add(g, G.cyl(0.03, 0.035, 0.85, 12), M.frame(), 0, 0.5, 0);
  rboxB(g, 0.55, 0.04, 0.42, 0.015, M.plastic('#e6e9eb', 0.35), 0, 0.93, 0);
  rboxB(g, 0.34, 0.02, 0.24, 0.006, M.black(), 0, 0.97, 0.03);
  rboxB(g, 0.34, 0.23, 0.015, 0.006, M.black(), 0, 0.985, -0.1);
  add(g, G.plane(0.31, 0.2), lambert('#16324a', { emissive: '#2b6a96', emissiveIntensity: 0.5, roughness: 0.2 }), 0, 1.1, -0.09);
  return g;
}

function wetFloorSign(): THREE.Group {
  const g = new THREE.Group();
  const y = M.plastic('#f2c230', 0.45);
  const { canvas, ctx } = makeCanvas(128, 256);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#111';
  ctx.font = '900 26px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('CAUTION', 64, 60);
  ctx.font = '700 20px Arial';
  ctx.fillText('WET FLOOR', 64, 210);
  ctx.beginPath();
  ctx.moveTo(64, 90);
  ctx.lineTo(100, 160);
  ctx.lineTo(28, 160);
  ctx.closePath();
  ctx.lineWidth = 5;
  ctx.stroke();
  const face = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.45 }));
  // A-frame: each panel leans in (top toward the centre, feet out). A tilt of +s·0.28 leaned the
  // tops apart and stood the sign on its apex; the face sits ~3 mm proud of its panel.
  for (const s of [-1, 1]) {
    add(g, G.box(0.3, 0.62, 0.01), y, 0, 0.31, s * 0.09, -s * 0.28, 0, 0);
    add(g, G.plane(0.28, 0.58), face, 0, 0.31, s * 0.098, -s * 0.28, s < 0 ? Math.PI : 0, 0);
  }
  return g;
}

function aedCabinet(): THREE.Group {
  const g = new THREE.Group();
  rboxB(g, 0.42, 0.52, 0.16, 0.02, M.plastic('#f4f6f7', 0.35), 0, 0, 0);
  rboxB(g, 0.34, 0.36, 0.1, 0.03, M.plastic('#2f9e44', 0.4), 0, 0.04, 0.02);
  // glass front 3 mm proud of the cabinet (laid on its face, the two flickered)
  add(g, G.box(0.38, 0.46, 0.01), glass('#e9f7ff', 0.25), 0, 0.26, 0.088).userData.noMerge = true;
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.fillStyle = '#2f9e44';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.font = '900 40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('AED ♥', 128, 47);
  add(g, G.plane(0.38, 0.09), own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.4 })), 0, 0.6, 0.02);
  return g;
}

function extinguisherCabinet(): THREE.Group {
  const g = new THREE.Group();
  rboxB(g, 0.32, 0.7, 0.18, 0.02, M.plastic('#e7eaec', 0.4), 0, 0, 0);
  add(g, G.cyl(0.07, 0.07, 0.5, 18), lambert('#c62828', { roughness: 0.3, metalness: 0.3 }), 0, 0.3, 0.02);
  add(g, G.cyl(0.02, 0.02, 0.08, 10), M.black(), 0.02, 0.6, 0.02);
  add(g, G.box(0.28, 0.6, 0.01), glass('#f2f9ff', 0.25), 0, 0.36, 0.098).userData.noMerge = true; // 3 mm proud of the cabinet
  return g;
}

const BEDSIDE_TABLE_TOP = 0.77;

export function bedsideTable(): THREE.Group {
  const g = new THREE.Group();
  rboxB(g, 0.46, 0.68, 0.42, 0.02, lambert('#e6e1d6', { roughness: 0.5 }), 0, 0.06, 0);
  rboxB(g, 0.5, 0.03, 0.46, 0.012, lambert('#cdb38f', { roughness: 0.45 }), 0, BEDSIDE_TABLE_TOP - 0.03, 0);
  rboxB(g, 0.4, 0.16, 0.012, 0.006, lambert('#d9d3c6', { roughness: 0.5 }), 0, 0.5, 0.215);
  add(g, G.box(0.12, 0.015, 0.02), lambert('#9aa3a8', { roughness: 0.3, metalness: 0.6 }), 0, 0.58, 0.225);
  for (const x of [-0.18, 0.18]) for (const z of [-0.16, 0.16]) add(g, G.cyl(0.03, 0.03, 0.025, 10), M.rubber(), x, 0.03, z, 0, 0, Math.PI / 2);
  return g;
}

function oxygenCart(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.09, 0.09]) {
    add(g, G.cyl(0.055, 0.055, 0.66, 18), lambert('#e9ecee', { roughness: 0.35, metalness: 0.4 }), x, 0.42, 0);
    add(g, G.sphere(0.055, 14, 8), lambert('#2f8f46', { roughness: 0.35, metalness: 0.3 }), x, 0.75, 0);
    add(g, G.cyl(0.02, 0.02, 0.07, 10), M.chrome(), x, 0.82, 0);
  }
  tube(g, [[-0.2, 0.1, -0.08], [-0.2, 1.0, -0.1], [0.2, 1.0, -0.1], [0.2, 0.1, -0.08]], 0.012, M.frame(), 20, 6);
  for (const x of [-0.16, 0.16]) add(g, G.cyl(0.06, 0.06, 0.03, 12), M.rubber(), x, 0.06, 0.08, 0, 0, Math.PI / 2);
  return g;
}

/** analog wall clock whose face is a live canvas (updated by the world each game minute) */
export function wallClock(clocks: Clock[]): THREE.Group {
  const g = new THREE.Group();
  add(g, G.cyl(0.17, 0.17, 0.05, 32), M.black(), 0, 0, 0, Math.PI / 2, 0, 0);
  const { canvas, ctx } = makeCanvas(256, 256);
  const tex = canvasTexture(canvas);
  const mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
  // dial 3 mm off the case front (1 mm flickered from across a room), crystal 3 mm in front of it
  add(g, G.circle(0.155, 32), mat, 0, 0, 0.028).userData.noMerge = true;
  add(g, G.circle(0.157, 32), glass('#ffffff', 0.12), 0, 0, 0.031).userData.noMerge = true;
  clocks.push({ ctx, tex, last: '' });
  return g;
}

export function drawClock(c: Clock, hhmm: string) {
  if (c.last === hhmm) return;
  c.last = hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const ctx = c.ctx;
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128);
  for (let i = 0; i < 60; i++) {
    ctx.rotate(Math.PI / 30);
    ctx.fillStyle = '#1b1e21';
    if (i % 5 === 4) ctx.fillRect(-3, -118, 6, 22);
    else ctx.fillRect(-1, -118, 2, 9);
  }
  ctx.font = '600 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let n = 1; n <= 12; n++) {
    const a = (n / 12) * Math.PI * 2;
    ctx.fillText(String(n), Math.sin(a) * 82, -Math.cos(a) * 82);
  }
  const hand = (angle: number, len: number, w: number, color: string) => {
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -len, w, len + 14);
    ctx.restore();
  };
  hand(((h % 12) + m / 60) * (Math.PI / 6), 62, 9, '#1b1e21');
  hand(m * (Math.PI / 30), 96, 6, '#1b1e21');
  ctx.fillStyle = '#c62828';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  c.tex.needsUpdate = true;
}

export function exitSign(): THREE.Group {
  const g = new THREE.Group();
  const { canvas, ctx } = makeCanvas(256, 96);
  ctx.fillStyle = '#0d7a3a';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 54px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('EXIT', 150, 70);
  ctx.beginPath();
  ctx.moveTo(30, 48);
  ctx.lineTo(62, 26);
  ctx.lineTo(62, 70);
  ctx.closePath();
  ctx.fill();
  const tex = canvasTexture(canvas);
  rboxB(g, 0.42, 0.18, 0.06, 0.01, M.plastic('#f2f4f5', 0.4), 0, 0, 0);
  const face = own(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.4 }));
  add(g, G.plane(0.38, 0.14), face, 0, 0.09, 0.033).userData.noMerge = true; // 3 mm off the housing
  return g;
}

export function buildDetails(layout: LayoutDef, tallStatic: THREE.Group, staticRoot: THREE.Group, tall: THREE.Group): Details {
  // the wheelchair by the waiting room's wall is a dynamic object (you can sit in it and drive): wheelchair.ts
  const out: Details = { interactables: [], colliders: [], clocks: [], surfaces: [], bedside: new Map(), wows: [], wheelchairHome: { x: 8.6, z: 14.3, rot: Math.PI } };
  const solid = (obj: THREE.Object3D) => {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    b.min.y = 0;
    out.colliders.push(b);
  };

  // ── corridor equipment ──
  const linen = place(staticRoot, linenCart('linen'), 32.6, 0, 14.42, Math.PI);
  inspectable(out.interactables, 'linen', 'linenCart', linen);
  solid(linen);
  const iso = place(staticRoot, isolationCart('iso'), 45.0, 0, 14.5, Math.PI);
  inspectable(out.interactables, 'iso', 'isolationCart', iso);
  solid(iso);
  // parked at the nurses' station's closed west end, either side of the vitals machine, screens to the west:
  // in front of the bays they blocked the curtain openings (x 10.0 / 21.6) or the hand-rub dispensers
  // on the partitions (x 12.0 / 20.0)
  for (const [i, z] of [10.15, 11.85].entries()) {
    const w = place(staticRoot, workstationOnWheels(), 15.6, 0, z, -Math.PI / 2);
    inspectable(out.interactables, `wow${i}`, 'wow', w);
    out.wows.push({ id: `wow${i}`, x: 15.6, z, rot: -Math.PI / 2 });
    solid(w);
  }
  const wet = place(staticRoot, wetFloorSign(), 3.4, 0, 10.6, 0.4);
  inspectable(out.interactables, 'wet', 'wetFloor', wet);
  // (people walk round it, and a wheelchair stops at it)
  solid(wet);
  const o2 = place(staticRoot, oxygenCart(), 31.2, 0, 6.3, Math.PI);
  inspectable(out.interactables, 'o2', 'oxygen', o2);
  solid(o2);

  // ── wall fixtures ──
  const aed = place(tallStatic, aedCabinet(), 0.12 + 0.08, 1.15, 9.2, Math.PI / 2);
  inspectable(out.interactables, 'aed', 'aed', aed);
  for (const [i, [x, z, r]] of ([[47.88 - 0.09, 9.6, -Math.PI / 2], [34.4, 14.88 - 0.09, Math.PI]] as [number, number, number][]).entries()) {
    const ex = place(tallStatic, extinguisherCabinet(), x, 0.95, z, r);
    inspectable(out.interactables, `ext${i}`, 'extinguisher', ex);
  }
  // live clocks: hub, waiting, triage, resus, workroom
  const clockSpots: [number, number, number][] = [
    [30.5, 7.0 + WALL_T + 0.03, 0],
    [6.3, 15 + WALL_T + 0.03, 0],
    [14.2, 15 + WALL_T + 0.03, 0],
    [27.5, WALL_T + 0.03, 0],
    [28.0, 15 + WALL_T + 0.03, 0],
  ];
  clockSpots.forEach(([x, z, r], i) => {
    const c = place(tall, wallClock(out.clocks), x, 2.42, z, r);
    inspectable(out.interactables, `clock${i}`, 'clock', c, 0.05);
  });
  // EXIT signs over the two exterior doors
  for (const r of layout.rooms)
    for (const d of r.doors)
      if (d.exterior && d.side === 's') place(tall, exitSign(), r.rect.x + d.offset + d.width / 2, 2.38, r.rect.z + r.rect.d - WALL_T - 0.035, Math.PI);

  // ── bays: bedside table, paper towels over the sink, where belongings go ──
  for (const r of layout.rooms) {
    if (r.kind !== 'bay') continue;
    const x0 = r.rect.x;
    const bed = r.spots.bed;
    if (!bed) continue;
    const tx = x0 + 3.12;
    const tz = r.rect.z + 1.32;
    const t = place(staticRoot, bedsideTable(), tx, 0, tz, -Math.PI / 2);
    inspectable(out.interactables, `table_${r.id}`, 'bedsideTable', t);
    solid(t);
    out.surfaces.push({ id: `tbl_${r.id}`, x: tx, z: tz + 0.06, y: BEDSIDE_TABLE_TOP, rot: -Math.PI / 2, w: 0.36, d: 0.3, kinds: ['waterCup', 'tissueBox'] });
    // (paper towels by the sink: the wash station's own dispenser, shared/hygiene.ts)
    const chair = r.spots.chair;
    out.bedside.set(r.id, {
      table: new THREE.Vector3(tx - 0.1, BEDSIDE_TABLE_TOP, tz - 0.05),
      chair: new THREE.Vector3((chair ? chair.x : x0 + 0.6) + 0.05, 0.002, (chair ? chair.z : r.rect.z + 5.3) + 0.62),
      foot: new THREE.Vector3(bed.x + 0.65, 0, bed.z + 1.35),
    });
  }

  // In fast track, resus and hallway spaces belongings go on the floor by the assigned bed.
  for (const r of [...layout.rooms, ...(layout.treatmentSpaces ?? [])]) {
    const bed = r.spots.bed;
    if (!bed || out.bedside.has(r.id)) continue;
    const rot = bed.rot ?? 0;
    // bed head is at local −z: "beside" = 0.75 m to the right of the head end, "foot" = past the foot end
    const along = (d: number, side: number) => new THREE.Vector3(bed.x + Math.cos(rot) * side + Math.sin(rot) * d, 0.002, bed.z - Math.sin(rot) * side + Math.cos(rot) * d);
    const chair = r.spots.chair;
    out.bedside.set(r.id, {
      table: along(-0.6, 0.78),
      chair: chair ? new THREE.Vector3(chair.x + 0.05, 0.002, chair.z + 0.6) : along(0.4, -0.85),
      foot: along(1.35, 0.4),
    });
  }

  // ── ceiling hardware: smoke detector per room, sprinklers + supply diffusers on a grid ──
  const white = lambert('#f4f5f3', { roughness: 0.5 });
  const chrome = M.chrome();
  const grille = lambert('#e6e8e8', { roughness: 0.6, metalness: 0.2 });
  for (const r of layout.rooms) {
    if (r.kind === 'exterior' || r.kind === 'station') continue;
    // on the room's own ceiling (a double-height stair core is taller than the wall height)
    const H = r.ceilingHeight ?? layout.wallHeight;
    const cx = r.rect.x + r.rect.w / 2;
    const cz = r.rect.z + r.rect.d / 2;
    add(tallStatic, G.cyl(0.07, 0.075, 0.035, 20), white, cx + 0.9, H - 0.018, cz - 0.6);
    // status LED 2.5 mm under the detector (0.5 mm flickered)
    add(tallStatic, G.circle(0.012, 10), emitter('#ff3b30', 1.5), cx + 0.9, H - 0.038, cz - 0.6, Math.PI / 2, 0, 0);
    const nx = Math.max(1, Math.round(r.rect.w / 3.6));
    const nz = Math.max(1, Math.round(r.rect.d / 3.6));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const sx = r.rect.x + ((i + 0.5) * r.rect.w) / nx + 0.95;
        const sz = r.rect.z + ((j + 0.5) * r.rect.d) / nz - 0.85;
        add(tallStatic, G.cyl(0.012, 0.03, 0.05, 10), chrome, sx, H - 0.03, sz);
        if ((i + j) % 2 === 0) {
          // 60×60 square diffuser: frame + concentric louvres
          add(tallStatic, G.box(0.58, 0.02, 0.58), grille, sx - 0.6, H - 0.012, sz + 0.6);
          for (const s of [0.42, 0.28, 0.14]) add(tallStatic, G.box(s, 0.012, s), lambert('#cfd3d4', { roughness: 0.6 }), sx - 0.6, H - 0.025, sz + 0.6);
        }
      }
  }
  return out;
}

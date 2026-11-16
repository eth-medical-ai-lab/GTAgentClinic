/**
 * Bay cubicle curtains (the curtained sides of shared/layout.ts rooms: the six bays' fronts).
 *
 * The curtain: 24 gliders run in the ceiling track; between two of them hangs 17.5 cm of fabric, so
 * the cloth folds out of plane the closer they are (gathered at the far end when open, soft pleats
 * when drawn). A see-through mesh band at the top hangs from the gliders. Opening and closing moves
 * the leading glider (a hand on the edge); the others follow on the fabric between them (taut when
 * pulled, bunched when pushed) and even out; the hem trails a moving curtain and swings when it
 * stops. Vertices are rewritten on the CPU only while something moves (~1.7k per curtain).
 *
 * States: open (gathered at the far end), closed (drawn across, a 25 cm observation gap left at the
 * doorway end, by the bay's hand-rub dispenser), opening / closing. A drawn curtain is solid for the
 * player (a collider over the drawn part, the gathered bunch included) and for the third-person
 * camera boom; it stops short of anyone standing in its way.
 *
 * Privacy: a bay with its patient in bed is closed; an empty bay is open; a critical patient (ESI 1,
 * an unread critical page, a high-priority monitor alarm) or a crowd of staff at the bed (a
 * resuscitation) keeps it open. Whoever walks through a closed curtain opens it first: NPCs stop at
 * it (steering.ts gate), reach for the edge (reach.ts), pull it open a metre, step through and draw
 * it closed behind them when the bay should be private; late or urgent, they reach while still
 * walking and don't stop. The player: E on a curtain (the prompt shows within reach), and in
 * click-to-walk or tagging along the route opens and closes it with the same reach; the player turns
 * to the edge first and takes it with the near hand (gesture.ts), the cloth sliding once the hand
 * has hold. NPC routes go
 * through the doorway end (the rest of the line is a wall to the NPC nav grid: `navBlockers`).
 *
 * Rendering: opaque fabric with a woven print and no normal map (the AO pass gets the cloth's own
 * smooth normal), the mesh band translucent but writing depth (so depth and the normal it writes
 * into the AO's normal target agree), no shadow casting; hidden while the camera is inside the
 * fabric; in the cut-away (top-down) view only the part below the cut walls is drawn.
 */
import * as THREE from 'three';
import type { LayoutDef, Rect, RoomDef, Side } from '../../../shared/layout';
import type { CameraMode, PlayerView } from '../../../shared/types';
import { alarmPriority } from '../../../shared/alarms';
import type { Interactable } from './builder';
import type { Gesture as PlayerGesture, PlayerGestures } from './gesture';
import type { InteractTarget } from './index';
import { ROUTE_DS, type Route } from './pathfinding';
import { Reach } from './reach';
import { G, canvasTexture, lambert, makeCanvas, own, trackGeo } from './materials';
import { BUILTIN_SOUNDS, playSound } from '../audio/soundscape';
import * as S from '../audio/synth';

// ───────────────────────────── dimensions ─────────────────────────────

const WALL_T = 0.12; // builder.ts
/** gliders in the track */
export const CARRIERS = 24;
/** columns of cloth per glider interval */
const K = 5;
const COLS = (CARRIERS - 1) * K + 1;
/** glider to glider when gathered, and the fabric between two (fully drawn it would be flat) */
const PMIN = 0.028;
const FABRIC = 0.175;
/** pleat depth for a glider spacing p: 0.45·√(F² − p²) (a fold a little softer than a sharp zigzag) */
const FOLD = 0.45;
/** the observation gap a drawn curtain leaves at the doorway end, and how far a passage pulls it open */
export const GAP = 0.25;
export const PASS = 1.0;
/** cloth heights: hem, fabric/mesh seam, mesh top (hung from the gliders under the track) */
const HEM = 0.32;
const SEAM = 2.18;
/** fabric rows (a row boundary at the cut-away walls' 1.05 m), mesh-band rows */
const FAB_Y = [HEM, 0.5025, 0.685, 0.8675, 1.05, 1.2383, 1.4267, 1.615, 1.8033, 1.9917, SEAM];
const LOW_ROWS = 4;
/** print/weave repeat (m) */
const TILE = 0.62;

// ───────────────────────────── motion ─────────────────────────────

/** the hand on the edge: top speed (m/s) and acceleration (m/s²) */
const VMAX = 1.6;
const ACC = 5.5;
/** gliders: pull toward even spacing (1/s²) and damping (1/s) */
const K_SPR = 30;
const DAMP = 9;
/** the hem: trails a moving curtain (s of velocity), and swings back (rad/s, damping ratio) */
const LAG = 0.06;
const W_HEM = 3.2;
const Z_HEM = 0.32;
/** out-of-plane billow while it moves (m), its swing */
const SWAY = 0.03;
const W_SWAY = 2.8;
const Z_SWAY = 0.28;
/** the gathered bunch flares a little toward the hem */
const FLARE = 0.06;

// ───────────────────────────── choreography ─────────────────────────────

/** route scanned ahead for a curtain line (m) */
const LOOK = 2.6;
/** a walker stops this far before the line to pull it open, and this far through to pull it closed */
const STAND = 0.55;
const PAST = 0.45;
/** the edge this far beyond someone's crossing point (body radius + margin) for them to pass */
const CLEAR = 0.36;
const PLAYER_CLEAR = 0.42;
/** braking a walker plans with toward the curtain (m/s²; steering.ts eases at 1.4) */
const DECEL = 1.1;
/** reach.ts timing: the hand at the curtain, held on it while it slides, back */
const REACH_T = 0.3;
const HOLD_T = 0.34;
const BACK_T = 0.36;
/** what stopping, pulling, stepping through and pulling it closed adds to a walk (s) */
const RELAXED_EXTRA = 3.2;
/** clinical staff (a crowd of them at the bed = a resuscitation: the curtain stays open) */
const STAFF = new Set(['nurse', 'tech', 'attending', 'resident', 'consultant', 'ems']);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const stopProfile = (d: number) => Math.sqrt(2 * DECEL * Math.max(0, d));
function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ───────────────────────────── layout ─────────────────────────────

/** one curtain: its line on the floor plan (the track's plane), from the doorway end to the fixed end */
export interface CurtainDef {
  /** the room id ('bed_3'), or room:side for a room with more than one curtain */
  id: string;
  room: string;
  /** the doorway end of the run: inner face of the wall there, on the curtain's plane */
  ax: number;
  az: number;
  /** unit vector along the track, doorway end → fixed end (where it gathers when open) */
  dx: number;
  dz: number;
  /** unit normal into the room */
  nx: number;
  nz: number;
  /** usable length, wall face to wall face (m) */
  span: number;
  /** track height */
  y: number;
  rect: Rect;
}

function sideFrame(r: RoomDef, side: Side) {
  const { x, z, w, d } = r.rect;
  switch (side) {
    case 'n':
      return { sx: x, sz: z, dx: 1, dz: 0, len: w, nx: 0, nz: 1 };
    case 's':
      return { sx: x, sz: z + d, dx: 1, dz: 0, len: w, nx: 0, nz: -1 };
    case 'w':
      return { sx: x, sz: z, dx: 0, dz: 1, len: d, nx: 1, nz: 0 };
    case 'e':
      return { sx: x + w, sz: z, dx: 0, dz: 1, len: d, nx: -1, nz: 0 };
  }
}

/**
 * Every curtain in the layout. The doorway (and the observation gap) is at the start of the run (the
 * west end of a bay's front, by its hand-rub dispenser); the curtain gathers at the other end.
 */
export function curtainDefs(layout: LayoutDef): CurtainDef[] {
  const out: CurtainDef[] = [];
  for (const r of layout.rooms) {
    const sides = r.curtainSides ?? [];
    for (const side of sides) {
      const f = sideFrame(r, side);
      const walled = (sd: Side) => !r.openSides?.includes(sd) && !r.curtainSides?.includes(sd);
      const [s0, s1]: Side[] = side === 'n' || side === 's' ? ['w', 'e'] : ['n', 's'];
      const u0 = walled(s0) ? WALL_T : 0;
      const u1 = f.len - (walled(s1) ? WALL_T : 0);
      const ox = (f.nx * WALL_T) / 2;
      const oz = (f.nz * WALL_T) / 2;
      out.push({
        id: sides.length > 1 ? `${r.id}:${side}` : r.id,
        room: r.id,
        ax: f.sx + f.dx * u0 + ox,
        az: f.sz + f.dz * u0 + oz,
        dx: f.dx,
        dz: f.dz,
        nx: f.nx,
        nz: f.nz,
        span: u1 - u0,
        y: layout.wallHeight - 0.05,
        rect: { ...r.rect },
      });
    }
  }
  return out;
}

/** the part of each line NPCs may not walk through (everything but the doorway end): walls to the nav grid */
export function curtainNavBlockers(defs: CurtainDef[]): THREE.Box3[] {
  return defs.map((d) => lineBox(d, GAP + PASS, d.span + WALL_T, 0.05, 0, 2.2));
}

/** an axis-aligned box over the stretch [u0, u1] of a curtain's line, ±half across it */
function lineBox(d: CurtainDef, u0: number, u1: number, half: number, y0: number, y1: number, out = new THREE.Box3()): THREE.Box3 {
  const x0 = d.ax + d.dx * u0;
  const z0 = d.az + d.dz * u0;
  const x1 = d.ax + d.dx * u1;
  const z1 = d.az + d.dz * u1;
  const hx = Math.abs(d.nx) * half;
  const hz = Math.abs(d.nz) * half;
  out.min.set(Math.min(x0, x1) - hx, y0, Math.min(z0, z1) - hz);
  out.max.set(Math.max(x0, x1) + hx, y1, Math.max(z0, z1) + hz);
  return out;
}

// ───────────────────────────── the cloth (view) ─────────────────────────────

export interface CurtainView {
  group: THREE.Group;
  fabric: THREE.Mesh;
  band: THREE.Mesh;
  carriers: THREE.InstancedMesh;
  fabPos: Float32Array;
  fabNor: Float32Array;
  bandPos: Float32Array;
  bandNor: Float32Array;
  bandY: number[];
  /** fabric index count below the cut-away walls, and all of it */
  lowCount: number;
  fullCount: number;
}

/** what buildWorld makes: the line, and the meshes (none in headless tests) */
export interface CurtainRig {
  def: CurtainDef;
  view: CurtainView | null;
}

/** a woven print in mint and teal: vertical bands that fold with the pleats, a fine weave */
function printTexture(): THREE.Texture {
  const W = 256;
  const { canvas, ctx } = makeCanvas(W, W);
  ctx.fillStyle = '#a3d3c9';
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(40,118,106,0.2)';
  ctx.fillRect(18, 0, 72, W);
  ctx.fillStyle = 'rgba(40,118,106,0.42)';
  ctx.fillRect(104, 0, 5, W);
  ctx.fillRect(117, 0, 5, W);
  ctx.fillStyle = 'rgba(255,255,255,0.17)';
  ctx.fillRect(158, 0, 58, W);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < W; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${(0.03 + rnd() * 0.035).toFixed(3)})`;
    ctx.fillRect(0, y, W, 1);
  }
  for (let x = 1; x < W; x += 2) {
    ctx.fillStyle = `rgba(0,44,38,${(0.025 + rnd() * 0.03).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, W);
  }
  const t = canvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** the mesh band: white threads, open holes (alpha) */
function netTexture(): THREE.Texture {
  const W = 64;
  const { canvas, ctx } = makeCanvas(W, W);
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(244,246,243,0.45)';
  ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(250,251,249,1)';
  for (let k = 0; k < W; k += 8) {
    ctx.fillRect(k, 0, 2, W);
    ctx.fillRect(0, k, W, 2);
  }
  const t = canvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function curtainMaterials() {
  // no normal map: the AO pass reads the material's normal, and a fine weave normal at 10–30 cm
  // made it sparkle in the folds; the weave is in the print instead
  const fabric = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: printTexture(), roughness: 0.94, metalness: 0, side: THREE.DoubleSide }));
  // see-through, but it writes depth: the normal it writes into the AO's normal target then belongs
  // to the depth there (without, AO paired the wall's depth with the band's normal: black streaks)
  const band = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: netTexture(), transparent: true, opacity: 0.8, depthWrite: true, roughness: 0.9, side: THREE.DoubleSide }));
  const carrier = lambert('#e7e9e5', { roughness: 0.45 });
  return { fabric, band, carrier };
}

function gridGeometry(def: CurtainDef, ys: number[], flip: boolean, center: THREE.Vector3, radius: number) {
  const nv = COLS * ys.length;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  for (let r = 0; r < ys.length; r++) {
    for (let j = 0; j < COLS; j++) {
      const k = r * COLS + j;
      uv[k * 2] = ((j / K) * FABRIC) / TILE;
      uv[k * 2 + 1] = ys[r] / TILE;
    }
  }
  const idx = new Uint16Array((ys.length - 1) * (COLS - 1) * 6);
  let n = 0;
  // rows from the hem up: the first LOW_ROWS·(COLS − 1)·6 indices are the part below the cut walls
  for (let r = 0; r < ys.length - 1; r++) {
    for (let j = 0; j < COLS - 1; j++) {
      const a = r * COLS + j;
      const b = a + 1;
      const c = a + COLS + 1;
      const d = a + COLS;
      if (flip) idx.set([a, c, b, a, d, c], n);
      else idx.set([a, b, c, a, c, d], n);
      n += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // the cloth moves inside a fixed volume: no bounds recomputed
  g.boundingSphere = new THREE.Sphere(center.clone(), radius);
  g.boundingBox = lineBox(def, -0.1, def.span + 0.1, 0.3, 0, def.y + 0.05);
  void def;
  return { g: trackGeo(g), pos, nor, count: idx.length };
}

function buildView(def: CurtainDef, mats: ReturnType<typeof curtainMaterials>, parent: THREE.Object3D): CurtainView {
  const group = new THREE.Group();
  group.name = `curtain-${def.id}`;
  parent.add(group);
  // front faces into the room (the normal convention below), whichever way the side runs
  const flip = -def.dz * def.nx + def.dx * def.nz < 0;
  const center = new THREE.Vector3(def.ax + (def.dx * def.span) / 2, 1.6, def.az + (def.dz * def.span) / 2);
  const radius = Math.hypot(def.span / 2, 1.35) + 0.3;
  const top = def.y - 0.065;
  const bandY = [SEAM, SEAM + (top - SEAM) / 3, SEAM + ((top - SEAM) * 2) / 3, top];
  const fab = gridGeometry(def, FAB_Y, flip, center, radius);
  const band = gridGeometry(def, bandY, flip, center, radius);
  const fabric = new THREE.Mesh(fab.g, mats.fabric);
  const bandMesh = new THREE.Mesh(band.g, mats.band);
  const carriers = new THREE.InstancedMesh(G.rbox(0.016, 0.05, 0.022, 0.005), mats.carrier, CARRIERS);
  carriers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carriers.boundingSphere = new THREE.Sphere(new THREE.Vector3(center.x, def.y, center.z), def.span / 2 + 0.3);
  for (const m of [fabric, bandMesh, carriers]) {
    m.matrixAutoUpdate = false;
    m.userData.noMerge = true;
    group.add(m);
  }
  fabric.name = 'curtain-fabric';
  bandMesh.name = 'curtain-mesh-band';
  carriers.name = 'curtain-gliders';
  return { group, fabric, band: bandMesh, carriers, fabPos: fab.pos, fabNor: fab.nor, bandPos: band.pos, bandNor: band.nor, bandY, lowCount: LOW_ROWS * (COLS - 1) * 6, fullCount: fab.count };
}

/** buildWorld: a curtain on every curtained side, gathered open (Curtains sets each from the shift) */
export function buildCurtains(layout: LayoutDef, parent: THREE.Object3D): CurtainRig[] {
  const defs = curtainDefs(layout);
  if (!defs.length) return [];
  const mats = curtainMaterials();
  const group = new THREE.Group();
  group.name = 'curtains';
  parent.add(group);
  return defs.map((def) => {
    const rig: CurtainRig = { def, view: buildView(def, mats, group) };
    const sim = new CurtainSim(rig);
    sim.snap(sim.eOpen);
    return rig;
  });
}

// ───────────────────────────── the physics of one curtain ─────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const colS = new Float32Array(COLS);
const colN = new Float32Array(COLS);
const colSl = new Float32Array(COLS);
const colH = new Float32Array(COLS);
const colB = new Float32Array(COLS);

export class CurtainSim {
  readonly def: CurtainDef;
  readonly view: CurtainView | null;
  /** edge positions along the line: gathered open, drawn closed */
  readonly eOpen: number;
  readonly eClosed: number;
  /** the leading edge (the first glider), its speed, where the hand takes it */
  e = 0;
  ev = 0;
  goal = 0;
  /** the lowest the edge may go now: someone standing in its way (set each frame by Curtains) */
  floor = -Infinity;
  readonly c = new Float32Array(CARRIERS);
  private cv = new Float32Array(CARRIERS);
  private c0 = new Float32Array(CARRIERS);
  private h = new Float32Array(CARRIERS);
  private hv = new Float32Array(CARRIERS);
  private q = 0;
  private qv = 0;
  /** moving: vertices are rewritten each frame */
  awake = false;
  private calm = 0;

  constructor(rig: CurtainRig) {
    this.def = rig.def;
    this.view = rig.view;
    this.eOpen = rig.def.span - (CARRIERS - 1) * PMIN;
    this.eClosed = GAP;
  }

  /** put it at edge position e, settled (no animation) */
  snap(e: number) {
    this.e = this.goal = clamp(e, this.eClosed, this.eOpen);
    this.ev = this.q = this.qv = 0;
    const span = this.def.span;
    for (let i = 0; i < CARRIERS; i++) {
      this.c[i] = this.e + ((span - this.e) * i) / (CARRIERS - 1);
      this.cv[i] = this.h[i] = this.hv[i] = 0;
    }
    this.awake = false;
    this.write();
  }

  /** the hand takes the edge to `goal` */
  command(goal: number) {
    this.goal = clamp(goal, this.eClosed, this.eOpen);
    this.awake = true;
    this.calm = 0;
  }

  /** fabric hangs at u along the line (the drawn part, the bunch included) */
  covers(u: number): boolean {
    return u >= this.e - 0.01 && u <= this.def.span + 0.05;
  }

  /** open past u: the edge is (and stays) at least `clear` beyond it */
  openAt(u: number, clear: number): boolean {
    return this.e >= u + clear && Math.max(this.goal, this.floor) >= u + clear - 0.05;
  }

  get moving(): boolean {
    return this.awake && (Math.abs(this.ev) > 0.01 || Math.abs(this.goal - this.e) > 0.005);
  }

  /** world point on the edge at height y */
  edgePoint(y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.def.ax + this.def.dx * this.e, y, this.def.az + this.def.dz * this.e);
  }

  step(dt: number) {
    if (!this.awake || dt <= 0) return;
    const span = this.def.span;
    // the hand: accelerates, cruises, brakes onto the goal (or onto whoever stands in the way)
    const goal = this.goal < this.e ? Math.max(this.goal, Math.min(this.e, this.floor)) : this.goal;
    const d = goal - this.e;
    const vd = Math.sign(d) * Math.min(VMAX, Math.sqrt(2 * ACC * Math.abs(d)));
    this.ev += clamp(vd - this.ev, -ACC * 1.6 * dt, ACC * 1.6 * dt);
    if (Math.abs(d) < 0.002 && Math.abs(this.ev) < 0.06) {
      this.e = goal;
      this.ev = 0;
    } else this.e = clamp(this.e + this.ev * dt, this.eClosed, this.eOpen);
    // gliders: toward even spacing, then the fabric between them (no closer than PMIN, no farther than FABRIC)
    const n = CARRIERS;
    const rho = (span - this.e) / (n - 1);
    const c = this.c;
    for (let i = 0; i < n; i++) this.c0[i] = c[i];
    for (let i = 1; i < n - 1; i++) {
      this.cv[i] += (K_SPR * (this.e + rho * i - c[i]) - DAMP * this.cv[i]) * dt;
      c[i] += this.cv[i] * dt;
    }
    c[0] = this.e;
    c[n - 1] = span;
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < n - 1; i++) this.constrain(i);
      for (let i = n - 2; i >= 0; i--) this.constrain(i);
    }
    // exact at the end (both ends pinned, always possible): from the edge, then back from the fixed end
    for (let i = 1; i < n - 1; i++) c[i] = clamp(c[i], c[i - 1] + PMIN, c[i - 1] + FABRIC);
    for (let i = n - 2; i >= 1; i--) c[i] = clamp(c[i], c[i + 1] - FABRIC, c[i + 1] - PMIN);
    let maxV = Math.abs(this.ev);
    let maxH = 0;
    for (let i = 0; i < n; i++) {
      const v = (c[i] - this.c0[i]) / dt;
      this.cv[i] = i === 0 || i === n - 1 ? 0 : v;
      // the hem trails the glider above it, swings back when it stops
      const tgt = -LAG * v;
      this.hv[i] += (-W_HEM * W_HEM * (this.h[i] - tgt) - 2 * Z_HEM * W_HEM * this.hv[i]) * dt;
      this.h[i] = clamp(this.h[i] + this.hv[i] * dt, -0.12, 0.12);
      maxV = Math.max(maxV, Math.abs(v));
      maxH = Math.max(maxH, Math.abs(this.h[i]), Math.abs(this.hv[i]) * 0.3);
    }
    const qt = SWAY * Math.min(1, Math.abs(this.ev) / VMAX);
    this.qv += (-W_SWAY * W_SWAY * (this.q - qt) - 2 * Z_SWAY * W_SWAY * this.qv) * dt;
    this.q += this.qv * dt;
    this.write();
    const still = maxV < 0.004 && maxH < 0.003 && Math.abs(this.q) < 0.002 && Math.abs(this.qv) < 0.006 && Math.abs(goal - this.e) < 0.002;
    this.calm = still ? this.calm + 1 : 0;
    if (this.calm > 8 && goal === this.goal) {
      // the last millimetres of swing: settled (nobody sees 3 mm), and the vertices stop being rewritten
      this.awake = false;
      this.h.fill(0);
      this.hv.fill(0);
      this.q = this.qv = 0;
      this.write();
    }
  }

  private constrain(i: number) {
    const c = this.c;
    const n = CARRIERS;
    const gap = c[i + 1] - c[i];
    const err = gap < PMIN ? PMIN - gap : gap > FABRIC ? FABRIC - gap : 0;
    if (!err) return;
    if (i === 0) c[i + 1] += err;
    else if (i + 1 === n - 1) c[i] -= err;
    else {
      c[i] -= err / 2;
      c[i + 1] += err / 2;
    }
  }

  /** rewrite the cloth's vertices and the gliders from the physics */
  write() {
    const v = this.view;
    if (!v) return;
    const d = this.def;
    const span = d.span;
    const c = this.c;
    for (let j = 0; j < COLS; j++) {
      const i = Math.min(CARRIERS - 2, (j / K) | 0);
      const t = (j - i * K) / K;
      const p = Math.max(1e-4, c[i + 1] - c[i]);
      const A = FOLD * Math.sqrt(Math.max(0, FABRIC * FABRIC - p * p));
      const sg = i & 1 ? -1 : 1;
      colS[j] = c[i] + p * t;
      colN[j] = sg * A * Math.sin(Math.PI * t);
      colSl[j] = ((sg * A * Math.PI) / p) * Math.cos(Math.PI * t);
      colH[j] = this.h[i] + (this.h[i + 1] - this.h[i]) * t;
      colB[j] = clamp(1 - p / FABRIC, 0, 1);
    }
    const lead = c[0];
    const len = Math.max(0.05, span - lead);
    const mid = (lead + span) / 2;
    const top = d.y - 0.065;
    const rows = (ys: number[], pos: Float32Array, nor: Float32Array) => {
      for (let r = 0; r < ys.length; r++) {
        const y = ys[r];
        const w = Math.pow(clamp((top - y) / (top - HEM), 0, 1), 1.6);
        const relax = 1 - 0.15 * w;
        for (let j = 0; j < COLS; j++) {
          const k = (r * COLS + j) * 3;
          const s = clamp(colS[j] + colH[j] * w + (colS[j] - mid) * FLARE * colB[j] * w, 0.004, span - 0.004);
          const sway = this.q * w * (1 - 0.6 * clamp((colS[j] - lead) / len, 0, 1));
          const off = colN[j] * relax + sway;
          pos[k] = d.ax + d.dx * s + d.nx * off;
          pos[k + 1] = y;
          pos[k + 2] = d.az + d.dz * s + d.nz * off;
          // normal toward the room side: (−slope, 1) in (along, across)
          const sl = colSl[j] * relax;
          const ex = -d.dx * sl + d.nx;
          const ez = -d.dz * sl + d.nz;
          const il = 1 / Math.hypot(ex, ez);
          nor[k] = ex * il;
          nor[k + 1] = 0;
          nor[k + 2] = ez * il;
        }
      }
    };
    rows(FAB_Y, v.fabPos, v.fabNor);
    rows(v.bandY, v.bandPos, v.bandNor);
    for (const m of [v.fabric, v.band]) {
      const g = m.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('normal').needsUpdate = true;
    }
    const yaw = Math.atan2(d.dx, d.dz) - Math.PI / 2;
    _q.setFromAxisAngle(_up, yaw);
    for (let i = 0; i < CARRIERS; i++) {
      _p.set(d.ax + d.dx * c[i], d.y - 0.035, d.az + d.dz * c[i]);
      v.carriers.setMatrixAt(i, _m.compose(_p, _q, _one));
    }
    v.carriers.instanceMatrix.needsUpdate = true;
  }
}

// ───────────────────────────── the system ─────────────────────────────

/** the slice of World's player controller the curtains read and steer (controls.ts) */
export interface CurtainPlayer {
  pos: THREE.Vector2;
  path: THREE.Vector2[] | null;
  steering: boolean;
  yaw: number;
  facing: number;
}

/** the slice of World's NPC state the curtains read */
export interface CurtainNpc {
  v: { id: string; role: string; location: string; visible: boolean; ambient?: { urgent?: boolean } };
  pos: THREE.Vector2;
  yaw: number;
  path: unknown;
  ch: { root: THREE.Object3D; posture: string };
  animAcc?: number;
}

export interface CurtainDeps {
  /** for the hands (reach.ts); none = no arms (headless tests) */
  scene?: THREE.Scene | null;
  camera?: THREE.PerspectiveCamera | null;
  player?: () => CurtainPlayer | null;
  /** the player's hand: turn to the edge first, then reach (gesture.ts); none = a timer stands in for it */
  gestures?: PlayerGestures | null;
  mode?: () => CameraMode;
  npcs: () => Iterable<CurtainNpc>;
  npc: (id: string) => CurtainNpc | undefined;
  /** built.tall: hidden = the cut-away (top-down) view */
  tall?: THREE.Object3D | null;
  /** record every crossing of a curtain line (tests; ?debug=1) */
  audit?: boolean;
}

type Phase = 'approach' | 'pull' | 'through' | 'turn' | 'close' | 'done';

/** someone (an NPC or the player) going through one curtain */
interface Passage {
  who: string;
  cur: Curtain;
  route: Route | null;
  /** NPC: arc length of the crossing on its route; player: path length to it when found */
  cross: number;
  /** where along the line, which way (+1 into the room) */
  u: number;
  dir: 1 | -1;
  phase: Phase;
  t: number;
  /** this walker pulled it open (so it draws it closed behind) */
  opened: boolean;
  willClose: boolean;
  hurried: boolean;
  gesture: Gesture | null;
  face?: number;
  /** player: the path held while the hand is on the curtain */
  held?: THREE.Vector2[] | null;
}

/** a hand on the curtain: presses (takes hold) at REACH_T, done at the end */
interface Gesture {
  who: string;
  cur: Curtain;
  t: number;
  pressed: boolean;
  onPress: () => void;
  reach: Reach | null;
  arm: 'R' | 'L';
  /** grab point: the edge, or the nearest bit of fabric (fixed s along the line) */
  at: number | null;
  y: number;
  /** the player's hand (gesture.ts): it turns first, so its clock (t) starts when the hand goes out */
  player?: PlayerGesture;
}

interface Curtain extends CurtainSim {
  key: string;
  rule: 'open' | 'closed';
  /** what the rule saw, and since when (s) */
  ruleWant: 'open' | 'closed';
  ruleSince: number;
  urgent: boolean;
  override: 'open' | 'closed' | null;
  /** where the player left the edge (a curtain pulled open a metre stays a metre open) */
  overrideGoal: number | null;
  /** set by a test hook: stays until the rule changes */
  sticky: boolean;
  deviant: number;
  collider: THREE.Box3;
  camBox: THREE.Box3;
  it: Interactable;
}

const ROLE_SKIN = '#d9a47f';

export class Curtains {
  readonly list: Curtain[];
  /** to the NPC nav grid (World): the curtain lines but the doorway ends */
  readonly navBlockers: THREE.Box3[];
  private byId = new Map<string, Curtain>();
  private passages = new Map<string, Passage>();
  private gestures: Gesture[] = [];
  private pool: Reach[] = [];
  private routeSeen = new WeakMap<Route, { t: number; s: number }>();
  private now = 0;
  private dt = 1 / 60;
  private ruleAt = 0;
  private lastView: PlayerView | null = null;
  private snapped = false;
  private cut = false;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private sphere = new THREE.Sphere();
  /** 'auto' picks per walk; tests and screenshots force one */
  mode: 'auto' | 'relaxed' | 'hurried' = 'auto';
  /** audit: crossings of a curtain line, and those through fabric */
  readonly audit = { crossings: 0, violations: [] as { who: string; curtain: string; u: number; edge: number; t: number }[], pulls: 0, closes: 0, holds: 0 };
  private lastPos = new Map<string, [number, number]>();

  constructor(
    rigs: CurtainRig[],
    private deps: CurtainDeps,
  ) {
    this.list = rigs.map((rig) => {
      const sim = new CurtainSim(rig) as Curtain;
      const key = `curtain:${rig.def.id}`;
      Object.assign(sim, {
        key,
        rule: 'open',
        ruleWant: 'open',
        ruleSince: 0,
        urgent: false,
        override: null,
        overrideGoal: null,
        sticky: false,
        deviant: 0,
        collider: new THREE.Box3(),
        camBox: new THREE.Box3(),
      });
      const box = new THREE.Box3();
      sim.it = { key, target: { kind: 'use', id: key, label: 'Open curtain' }, box, center: new THREE.Vector3() };
      sim.snap(sim.eOpen);
      this.byId.set(rig.def.id, sim);
      return sim;
    });
    this.navBlockers = curtainNavBlockers(this.list.map((c) => c.def));
    for (const c of this.list) this.bounds(c);
  }

  /** after the ground nav grid is built (World): the curtains join the colliders, camera blockers and interactables */
  attach(built: { colliders: THREE.Box3[]; cameraBlockers: THREE.Box3[]; interactables: Interactable[] }) {
    for (const c of this.list) {
      built.colliders.push(c.collider);
      built.cameraBlockers.push(c.camBox);
      built.interactables.push(c.it);
    }
  }

  /** the latest server view: who is where, the board, the monitors */
  view(v: PlayerView) {
    this.lastView = v;
  }

  rest(c: Curtain): 'open' | 'closed' {
    return c.override ?? c.rule;
  }

  private goalFor(c: Curtain, s: 'open' | 'closed') {
    return s === 'open' ? c.eOpen : c.eClosed;
  }

  /** where the edge belongs now: the player's choice (as far as they pulled it), else the bay's rule */
  private restGoal(c: Curtain) {
    return c.override ? (c.overrideGoal ?? this.goalFor(c, c.override)) : this.goalFor(c, c.rule);
  }

  private setOverride(c: Curtain, s: 'open' | 'closed' | null, goal: number | null = null) {
    c.override = s;
    c.overrideGoal = s ? goal : null;
  }

  /** (u along, v across into the room) of a floor point */
  private local(c: Curtain, x: number, z: number): { u: number; v: number } {
    const d = c.def;
    const px = x - d.ax;
    const pz = z - d.az;
    return { u: px * d.dx + pz * d.dz, v: px * d.nx + pz * d.nz };
  }

  // ─────────── per frame ───────────

  /** once a frame, before the player moves (World.frame) */
  update(dt: number) {
    this.now += dt;
    this.dt = dt;
    if (!this.snapped && this.lastView) {
      // the first view: every curtain as its bay is now (no animation)
      this.rules(true);
      for (const c of this.list) c.snap(this.restGoal(c));
      this.snapped = true;
    } else if (this.now >= this.ruleAt) this.rules(false);
    this.gestureStep(dt);
    this.idleNpcs();
    this.playerRoute(dt);
    this.blockers();
    for (const c of this.list) {
      this.restore(c, dt);
      c.step(dt);
      this.bounds(c);
    }
    this.cutaway();
    if (this.deps.audit) this.auditStep();
  }

  /** the NPCs' arms on curtains, after their animation (World.frame; the player's: gesture.ts) */
  afterPose() {
    for (const g of this.gestures) {
      if (!g.reach || g.who === '__player') continue;
      const st = this.deps.npc(g.who);
      // only on a frame its animation was updated (otherwise the IK would stack on last frame's)
      if (st && st.animAcc === 0 && st.ch.root.visible) g.reach.applyArm(st.ch.root);
    }
  }

  /** after the camera is placed (World.frame): no curtain drawn round the camera */
  camera() {
    const cam = this.deps.camera;
    if (!cam) return;
    const p = cam.position;
    for (const c of this.list) {
      const v = c.view;
      if (!v) continue;
      const { u, v: across } = this.local(c, p.x, p.z);
      // the near plane inside the cloth (a pleat is up to 8 cm deep): hide it rather than draw its inside
      const inside = p.y < c.def.y && Math.abs(across) < 0.14 && u > c.e - 0.12 && u < c.def.span + 0.05;
      v.fabric.visible = !inside;
      v.band.visible = !inside && !this.cut;
    }
  }

  // ─────────── privacy rules ───────────

  private rules(first: boolean) {
    this.ruleAt = this.now + 0.25;
    const view = this.lastView;
    const npcs = [...this.deps.npcs()];
    for (const c of this.list) {
      const r = c.def.rect;
      let patient = false;
      let staff = 0;
      for (const st of npcs) {
        const v = st.v;
        if (!v.visible) continue;
        const inside = st.pos.x > r.x && st.pos.x < r.x + r.w && st.pos.y > r.z && st.pos.y < r.z + r.d;
        if (!inside || st.path) continue;
        if (v.role === 'patient' && v.location === c.def.room) patient = true;
        else if (STAFF.has(v.role)) staff++;
      }
      const row = view?.board.find((b) => b.bed === c.def.room && b.flowStatus !== 'Departed');
      const mon = view?.monitors?.[c.def.room];
      const critical = (!!row && patient && (row.esi === 1 || row.critical)) || (!!mon && alarmPriority(mon) === 'high');
      const resus = staff >= 3;
      const want = patient && !critical && !resus ? 'closed' : 'open';
      if (want !== c.ruleWant) {
        c.ruleWant = want;
        c.ruleSince = this.now;
      }
      c.urgent = critical || resus;
      // open at once (empty, critical); closed once it has held for a few seconds (a noisy alarm, someone settling in)
      const due = first || want === 'open' || this.now - c.ruleSince >= 4;
      if (due && want !== c.rule) {
        c.rule = want;
        // a new situation wins over what the player last did with it
        this.setOverride(c, null);
        c.sticky = false;
      }
    }
  }

  /** back to what the bay should be: pulled by someone there, or done where nobody sees it */
  private restore(c: Curtain, dt: number) {
    const pl = this.deps.player?.();
    const d = c.def;
    const far = !pl || Math.hypot(pl.pos.x - (d.ax + (d.dx * d.span) / 2), pl.pos.y - (d.az + (d.dz * d.span) / 2)) > 9;
    // the player's choice lapses once they have walked away (out of sight: the staff take over)
    if (c.override && !c.sticky && far && c.override !== c.rule && !this.seen(c)) this.setOverride(c, null);
    const want = this.restGoal(c);
    if (Math.abs(c.goal - want) < 0.06 || this.busy(c)) {
      c.deviant = 0;
      return;
    }
    c.deviant += dt;
    if (c.deviant < 1.2) return;
    const actor = this.actorFor(c);
    if (actor) {
      c.deviant = 0;
      this.grab(actor, c, () => this.pull(c, want), null);
      return;
    }
    if ((c.urgent && want === c.eOpen) || far || !this.seen(c)) {
      c.deviant = 0;
      this.pull(c, want);
    }
  }

  /** a passage or a hand on it, or the player in the doorway: leave it */
  private busy(c: Curtain): boolean {
    for (const p of this.passages.values()) if (p.cur === c && p.phase !== 'done') return true;
    for (const g of this.gestures) if (g.cur === c && !g.pressed) return true;
    const pl = this.deps.player?.();
    if (pl) {
      const { u, v } = this.local(c, pl.pos.x, pl.pos.y);
      if (Math.abs(v) < 1.3 && u > -0.3 && u < Math.max(GAP + PASS + 0.4, c.e + 0.4)) return true;
    }
    return false;
  }

  /** a member of staff standing within arm's reach of the edge */
  private actorFor(c: Curtain): string | null {
    const ex = c.def.ax + c.def.dx * c.e;
    const ez = c.def.az + c.def.dz * c.e;
    let best: string | null = null;
    let bd = 1.3;
    for (const st of this.deps.npcs()) {
      if (!st.v.visible || st.path || !STAFF.has(st.v.role) || st.ch.posture !== 'stand' || this.passages.has(st.v.id)) continue;
      const dd = Math.hypot(st.pos.x - ex, st.pos.y - ez);
      if (dd < bd) {
        bd = dd;
        best = st.v.id;
      }
    }
    return best;
  }

  private seen(c: Curtain): boolean {
    const cam = this.deps.camera;
    if (!cam) return false;
    cam.updateMatrixWorld();
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv, cam.coordinateSystem, cam.reversedDepth);
    const d = c.def;
    this.sphere.center.set(d.ax + (d.dx * d.span) / 2, 1.5, d.az + (d.dz * d.span) / 2);
    this.sphere.radius = d.span / 2 + 0.5;
    return this.frustum.intersectsSphere(this.sphere) && this.sphere.center.distanceTo(cam.position) < 22;
  }

  private pull(c: Curtain, goal: number) {
    const was = c.goal;
    c.command(goal);
    if (Math.abs(c.goal - was) > 0.2) {
      const p = c.edgePoint(2.3, this.tmp);
      playSound('curtain', { at: { x: p.x, y: p.y, z: p.z }, gain: 0.9, range: 14 });
    }
  }

  /** the edge stops short of anyone standing in its way */
  private blockers() {
    const pl = this.deps.player?.();
    for (const c of this.list) {
      c.floor = -Infinity;
      if (c.goal >= c.e - 0.001) continue;
      const test = (x: number, z: number, r: number) => {
        const { u, v } = this.local(c, x, z);
        if (Math.abs(v) < r + 0.12 && u + r + 0.05 > c.goal && u - r < c.e + 0.02) c.floor = Math.max(c.floor, u + r + 0.06);
      };
      if (pl) test(pl.pos.x, pl.pos.y, 0.3);
      for (const st of this.deps.npcs()) if (st.v.visible) test(st.pos.x, st.pos.y, 0.25);
    }
  }

  /** the colliders, the camera's box and the interactable follow the drawn part */
  private bounds(c: Curtain) {
    const span = c.def.span;
    // the bunch's folds reach 8 cm out; the player's 0.3 m radius goes round that
    lineBox(c.def, c.e - 0.02, span + WALL_T, 0.08, 0, 2.2, c.collider);
    // the third-person boom keeps a soft distance (≥ 0.3 m with its 0.12 m pad)
    lineBox(c.def, c.e - 0.05, span + WALL_T, 0.18, 0, c.def.y, c.camBox);
    lineBox(c.def, c.e, span, 0.16, 0.3, 2.35, c.it.box);
    c.it.box.getCenter(c.it.center);
    const label = c.goal > c.eClosed + 0.35 ? 'Close curtain' : 'Open curtain';
    if (c.it.target.label !== label) c.it.target = { kind: 'use', id: c.key, label };
  }

  private cutaway() {
    const cut = this.deps.tall ? !this.deps.tall.visible : false;
    if (cut === this.cut) return;
    this.cut = cut;
    for (const c of this.list) {
      const v = c.view;
      if (!v) continue;
      v.fabric.geometry.setDrawRange(0, cut ? v.lowCount : Infinity);
      v.band.visible = !cut;
      v.carriers.visible = !cut;
    }
  }

  // ─────────── hands ───────────

  /**
   * `who` reaches for the curtain (the edge, or fabric at s along the line); `onPress` when the hand
   * takes hold. NPCs reach with the hand on the edge's side. The player turns to the edge first and
   * reaches with the hand on its side (gesture.ts); the cloth starts to slide when that hand takes
   * hold, however long the turn took.
   */
  private grab(who: string, c: Curtain, onPress: () => void, at: number | null): Gesture {
    const g: Gesture = { who, cur: c, t: 0, pressed: false, onPress, reach: null, arm: 'R', at, y: 1.15 };
    const tgt = this.grabPoint(g, this.tmp);
    if (who === '__player') {
      g.y = 1.2;
      const hands = this.deps.gestures;
      if (hands) {
        // (an earlier gesture of the player's is let go of: gesture.ts cuts it short)
        g.player = hands.start(this.grabPoint(g, this.tmp), () => {
          if (g.pressed) return;
          g.pressed = true;
          g.onPress();
        }, { hold: HOLD_T });
        g.arm = g.player.arm;
      }
    } else {
      const st = this.deps.npc(who);
      if (st) {
        const fx = Math.sin(st.yaw);
        const fz = Math.cos(st.yaw);
        // right of facing (fx, fz) is (−fz, fx)
        g.arm = (tgt.x - st.pos.x) * -fz + (tgt.z - st.pos.y) * fx >= 0 ? 'R' : 'L';
      }
      if (this.deps.scene) g.reach = this.pool.pop() ?? new Reach(this.deps.scene, ROLE_SKIN);
    }
    g.reach?.start(this.grabPoint(g, this.tmp), () => undefined, { arm: g.arm, hold: HOLD_T });
    this.gestures.push(g);
    return g;
  }

  private grabPoint(g: Gesture, out: THREE.Vector3): THREE.Vector3 {
    const c = g.cur;
    const s = g.at === null ? c.e : clamp(g.at, c.e, c.def.span);
    return out.set(c.def.ax + c.def.dx * s, g.y, c.def.az + c.def.dz * s);
  }

  private gestureStep(dt: number) {
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i];
      if (g.player) {
        // the player's hand: gesture.ts runs its clock (the turn first) and says when it takes hold
        g.player.retarget(this.grabPoint(g, this.tmp));
        g.t = g.player.t;
        if (g.player.done) this.gestures.splice(i, 1);
        continue;
      }
      g.t += dt;
      if (!g.pressed && g.t >= REACH_T) {
        g.pressed = true;
        g.onPress();
      }
      if (g.reach) {
        // the hand stays on the edge as it slides
        g.reach.retarget(this.grabPoint(g, this.tmp));
        g.reach.update(dt);
      }
      if (g.t > REACH_T + HOLD_T + BACK_T) {
        if (g.reach && g.who !== '__player') this.pool.push(g.reach);
        this.gestures.splice(i, 1);
      }
    }
  }

  // ─────────── NPCs (steering.ts asks, once a frame per walker) ───────────

  /** the speed a walker may have (m/s; Infinity = no limit): held at a closed curtain ahead */
  readonly gate = (id: string, r: Route, s: number, pace: number): number => {
    if (!this.routeSeen.has(r)) this.routeSeen.set(r, { t: this.now, s });
    let p = this.passages.get(id);
    if (p && p.route !== r) {
      // a new route: the same crossing (re-planned round someone) keeps it; elsewhere ends it
      const x = this.scan(r, s);
      if (x && x.cur === p.cur && x.dir === p.dir && Math.abs(x.u - p.u) < 0.8) {
        p.route = r;
        p.cross = x.cross;
        p.u = x.u;
      } else {
        this.passages.delete(id);
        p = undefined;
      }
    }
    if (!p) {
      const x = this.scan(r, s);
      if (!x) return Infinity;
      const st = this.deps.npc(id);
      p = { who: id, cur: x.cur, route: r, cross: x.cross, u: x.u, dir: x.dir, phase: 'approach', t: 0, opened: false, willClose: false, hurried: st ? this.hurried(st, r, s, pace) : true, gesture: null };
      this.passages.set(id, p);
    }
    return this.npcStep(p, s);
  };

  /** the way a held walker faces (turned to the curtain's edge to pull it closed) */
  readonly gateFace = (id: string): number | undefined => {
    const p = this.passages.get(id);
    return p && (p.phase === 'turn' || p.phase === 'close') ? p.face : undefined;
  };

  /** the first curtain line the route crosses in the next LOOK metres */
  private scan(r: Route, s: number): { cur: Curtain; cross: number; u: number; dir: 1 | -1 } | null {
    const i0 = Math.max(0, Math.floor(s / ROUTE_DS));
    const i1 = Math.min(r.n - 1, Math.ceil((s + LOOK) / ROUTE_DS));
    if (i1 <= i0) return null;
    let best: { cur: Curtain; cross: number; u: number; dir: 1 | -1 } | null = null;
    for (const c of this.list) {
      const d = c.def;
      // quick reject: nowhere near this line
      const mx = d.ax + (d.dx * d.span) / 2;
      const mz = d.az + (d.dz * d.span) / 2;
      const reach = d.span / 2 + LOOK + 0.5;
      if (Math.abs(r.px[i0] - mx) > reach || Math.abs(r.pz[i0] - mz) > reach) continue;
      let pv = 0;
      let pu = 0;
      for (let i = i0; i <= i1; i++) {
        const x = r.px[i] - d.ax;
        const z = r.pz[i] - d.az;
        const u = x * d.dx + z * d.dz;
        const v = x * d.nx + z * d.nz;
        if (i > i0 && ((pv < 0 && v >= 0) || (pv > 0 && v <= 0))) {
          const f = pv / (pv - v);
          const uc = pu + (u - pu) * f;
          const cross = (i - 1 + f) * ROUTE_DS;
          if (uc > -0.3 && uc < d.span + 0.3 && cross >= s - 0.05 && (!best || cross < best.cross)) best = { cur: c, cross, u: uc, dir: v > pv ? 1 : -1 };
          break;
        }
        pv = v;
        pu = u;
      }
    }
    return best;
  }

  /** late (the walk would run over what the server allows) or urgent: reach while walking, don't stop */
  private hurried(st: CurtainNpc, r: Route, s: number, pace: number): boolean {
    if (this.mode !== 'auto') return this.mode === 'hurried';
    if (st.v.ambient?.urgent || st.v.role === 'ems' || pace >= 1.6) return true;
    const scale = this.lastView?.settings?.timeScale ?? 1;
    if (scale >= 8) return true;
    // a walk may take a few seconds over walking it straight through (the server's slack on a walk
    // between rooms, shared/layout.ts walkSeconds); the stop at the curtain uses most of that
    const seen = this.routeSeen.get(r) ?? { t: this.now, s };
    const elapsed = this.now - seen.t;
    const nominal = (r.length - seen.s) / Math.max(0.3, pace);
    const projected = elapsed + (r.length - s) / Math.max(0.3, pace) + RELAXED_EXTRA;
    return projected > nominal + 4.2;
  }

  private npcStep(p: Passage, s: number): number {
    const st = this.deps.npc(p.who);
    if (!st) return Infinity;
    const c = p.cur;
    const { u: uNow, v } = this.local(c, st.pos.x, st.pos.y);
    const past = v * p.dir;
    const dc = p.cross - s;
    p.t += this.dt;
    switch (p.phase) {
      case 'approach': {
        if (c.openAt(p.u, CLEAR)) {
          this.through(p);
          return this.npcStep(p, s);
        }
        if (p.hurried) {
          // the hand goes out early, on the move; it creeps if the curtain hasn't opened by the line
          if (dc < 1.3) this.npcPull(p);
          return Math.max(0.5, stopProfile(dc - 0.3));
        }
        if (dc - STAND < 0.08) {
          this.npcPull(p);
          return 0;
        }
        return stopProfile(dc - STAND);
      }
      case 'pull': {
        if (c.openAt(p.u, CLEAR)) {
          this.through(p);
          return this.npcStep(p, s);
        }
        // never into the fabric: at most up to 0.3 m before the line while it opens
        if (p.t > 4 && !p.gesture) this.npcPull(p);
        return p.hurried ? Math.min(0.55, stopProfile(dc - 0.3)) : Math.min(stopProfile(dc - 0.3), 0.15);
      }
      case 'through': {
        const at = p.hurried ? 0.28 : PAST;
        if (past >= at) {
          this.closeBehind(p, st, uNow);
          return this.npcStep(p, s);
        }
        // whoever will pull it closed slows into a stop just through it
        return p.willClose && !p.hurried && past > -0.2 ? stopProfile(at - past) + 0.05 : Infinity;
      }
      case 'turn': {
        const face = p.face ?? st.yaw;
        if (Math.abs(wrap(face - st.yaw)) < 0.35 || p.t > 0.9) this.npcClose(p);
        return 0;
      }
      case 'close': {
        const g = p.gesture;
        if ((g && g.pressed && g.t > REACH_T + 0.22) || p.t > 2.5) {
          this.done(p);
          return Infinity;
        }
        return p.hurried ? 0.55 : 0;
      }
      case 'done':
        if (Math.abs(past) > 1.4 || dc < -2) this.passages.delete(p.who);
        return Infinity;
    }
  }

  private through(p: Passage) {
    p.phase = 'through';
    p.t = 0;
    const c = p.cur;
    // it should be private behind them: whoever opened it, or walks through it open when it shouldn't be
    p.willClose = this.rest(c) === 'closed' && (p.opened || c.goal > c.eClosed + 0.08);
  }

  /** an NPC reaches for the edge; when the hand takes hold it pulls it open a metre (or as far as needed) */
  private npcPull(p: Passage) {
    if (p.phase === 'pull' && p.gesture) return;
    const c = p.cur;
    p.phase = 'pull';
    p.t = 0;
    p.opened = true;
    this.audit.holds++;
    p.gesture = this.grab(p.who, c, () => {
      if (this.passages.get(p.who) !== p) return;
      this.audit.pulls++;
      this.pull(c, Math.max(c.e + PASS, p.u + CLEAR + 0.12));
    }, null);
  }

  private closeBehind(p: Passage, st: CurtainNpc, uNow: number) {
    const c = p.cur;
    const should = p.willClose && this.rest(c) === 'closed' && c.goal > c.eClosed + 0.08 && Math.abs(c.e - uNow) < 1.4 && !this.follower(c, p);
    if (!should) {
      this.done(p);
      return;
    }
    p.gesture = null;
    if (p.hurried || !st.path) {
      this.npcClose(p);
      return;
    }
    // turn toward the edge (a quarter turn or so), then reach for it
    const e = c.edgePoint(0, this.tmp);
    const to = Math.atan2(e.x - st.pos.x, e.z - st.pos.y);
    const rel = clamp(wrap(to - st.yaw), -1.9, 1.9);
    p.face = st.yaw + rel;
    p.phase = 'turn';
    p.t = 0;
  }

  private npcClose(p: Passage) {
    const c = p.cur;
    p.phase = 'close';
    p.t = 0;
    p.gesture = this.grab(p.who, c, () => {
      if (this.passages.get(p.who) !== p) return;
      if (this.rest(c) !== 'closed') return;
      this.audit.closes++;
      this.pull(c, c.eClosed);
    }, null);
  }

  private done(p: Passage) {
    p.phase = 'done';
    p.t = 0;
    p.face = undefined;
  }

  /** someone right behind (another walker on their way through, the player at the doorway): leave it open for them */
  private follower(c: Curtain, p: Passage): boolean {
    for (const q of this.passages.values()) if (q !== p && q.cur === c && (q.phase === 'approach' || q.phase === 'pull' || q.phase === 'through')) return true;
    const pl = this.deps.player?.();
    if (pl) {
      const { u, v } = this.local(c, pl.pos.x, pl.pos.y);
      if (Math.abs(v) < 1.7 && u > -0.4 && u < GAP + PASS + 0.8) return true;
    }
    return false;
  }

  /** passages of NPCs that stopped walking (arrived just through the curtain, or turned back) */
  private idleNpcs() {
    for (const p of [...this.passages.values()]) {
      if (p.who === '__player') continue;
      const st = this.deps.npc(p.who);
      if (!st) {
        this.passages.delete(p.who);
        continue;
      }
      if (st.path) continue;
      const { u, v } = this.local(p.cur, st.pos.x, st.pos.y);
      const past = v * p.dir;
      p.t += this.dt;
      if (p.phase === 'through' && past > 0.25) this.closeBehind(p, st, u);
      else if (p.phase === 'close') {
        const g = p.gesture;
        if ((g && g.pressed && g.t > REACH_T + 0.22) || p.t > 2.5) this.passages.delete(p.who);
      } else this.passages.delete(p.who);
    }
  }

  // ─────────── the player ───────────

  /**
   * E on a curtain, with the hand on it: closed, it is pulled open about a metre (to just past you if
   * you stand further along it), so you step through and, turning round, find the edge within reach;
   * open, it is drawn closed
   */
  use(id: string): boolean {
    if (!id.startsWith('curtain:')) return false;
    const c = this.byId.get(id.slice(8));
    if (!c) return true;
    this.endPlayer();
    const opening = c.goal <= c.eClosed + 0.35;
    const pl = this.deps.player?.();
    const u = pl ? this.local(c, pl.pos.x, pl.pos.y).u : 0;
    const goal = opening ? clamp(Math.max(c.e + PASS, Math.min(u, c.def.span) + PLAYER_CLEAR + 0.25), c.eClosed, c.eOpen) : c.eClosed;
    // the edge if it is near, else the fabric in front of you
    const at = pl && Math.abs(u - c.e) > 0.9 ? clamp(u, c.e, c.def.span - 0.1) : null;
    this.grab('__player', c, () => {
      this.setOverride(c, opening ? 'open' : 'closed', goal);
      c.sticky = false;
      this.pull(c, goal);
    }, at);
    return true;
  }

  /** the "[E] Open curtain" prompt as soon as you are within reach of one (first and third person) */
  fallback(): { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null {
    const pl = this.deps.player?.();
    if (!pl || this.deps.mode?.() === 'top') return null;
    const fx = -Math.sin(pl.yaw);
    const fz = -Math.cos(pl.yaw);
    let best: { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null = null;
    for (const c of this.list) {
      const d = c.def;
      const { u, v } = this.local(c, pl.pos.x, pl.pos.y);
      if (Math.abs(v) > 1.3 || u < -0.5 || u > d.span + 0.3) continue;
      const gu = clamp(u, c.e, d.span);
      const gx = d.ax + d.dx * gu;
      const gz = d.az + d.dz * gu;
      const dist = Math.hypot(gx - pl.pos.x, gz - pl.pos.y);
      if (dist > 1.3) continue;
      const toward = ((gx - pl.pos.x) * fx + (gz - pl.pos.y) * fz) / Math.max(dist, 1e-3);
      if (dist > 0.65 && toward < 0.15) continue;
      if (!best || dist < best.dist) best = { key: c.key, target: c.it.target, center: new THREE.Vector3(gx, 0, gz), dist };
    }
    return best;
  }

  private playerPass: Passage | null = null;

  private endPlayer(restore = false) {
    const p = this.playerPass;
    if (!p) return;
    const pl = this.deps.player?.();
    if (restore && pl && p.held && !pl.path) pl.path = p.held;
    this.playerPass = null;
  }

  /** the first curtain line the player's path crosses in the next 2.4 m (click-to-walk, tagging along) */
  private scanPath(pl: CurtainPlayer): { cur: Curtain; cross: number; u: number; dir: 1 | -1 } | null {
    const path = pl.path;
    if (!path?.length) return null;
    let ax = pl.pos.x;
    let az = pl.pos.y;
    let acc = 0;
    let best: { cur: Curtain; cross: number; u: number; dir: 1 | -1 } | null = null;
    for (const q of path) {
      const len = Math.hypot(q.x - ax, q.y - az);
      for (const c of this.list) {
        const a = this.local(c, ax, az);
        const b = this.local(c, q.x, q.y);
        if ((a.v < 0 && b.v >= 0) || (a.v > 0 && b.v <= 0)) {
          const f = a.v / (a.v - b.v);
          const uc = a.u + (b.u - a.u) * f;
          const cross = acc + len * f;
          if (uc > -0.3 && uc < c.def.span + 0.3 && (!best || cross < best.cross)) best = { cur: c, cross, u: uc, dir: b.v > a.v ? 1 : -1 };
        }
      }
      if (best) return best;
      acc += len;
      if (acc > 2.4) break;
      ax = q.x;
      az = q.y;
    }
    return best;
  }

  /** a route through a curtain (top-down click-to-walk, tagging along): the hand opens it, and closes it behind */
  private playerRoute(dt: number) {
    const pl = this.deps.player?.();
    if (!pl) return;
    let p = this.playerPass;
    if (pl.steering) {
      // walking with the keys: your own hands (E)
      if (p) this.endPlayer(false);
      return;
    }
    if (!p) {
      const x = this.scanPath(pl);
      if (!x) return;
      p = { who: '__player', cur: x.cur, route: null, cross: x.cross, u: x.u, dir: x.dir, phase: 'approach', t: 0, opened: false, willClose: false, hurried: false, gesture: null, held: null };
      this.playerPass = p;
    }
    p.t += dt;
    const c = p.cur;
    const { u, v } = this.local(c, pl.pos.x, pl.pos.y);
    const past = v * p.dir;
    const hold = () => {
      // keep the path aside while the hand is on the curtain (a new one, e.g. tagging along, replaces it)
      if (pl.path) {
        p!.held = pl.path;
        pl.path = null;
      }
    };
    const resume = () => {
      if (p!.held && !pl.path) pl.path = p!.held;
      p!.held = null;
    };
    // (the hand turns you to the edge first and keeps you facing it until it is back: gesture.ts)
    switch (p.phase) {
      case 'approach': {
        if (!pl.path) {
          this.endPlayer();
          return;
        }
        if (c.openAt(p.u, PLAYER_CLEAR)) {
          this.through(p);
          return;
        }
        const x = this.scanPath(pl);
        if (!x || x.cur !== c) {
          this.endPlayer();
          return;
        }
        if (x.cross <= 0.75) {
          hold();
          p.phase = 'pull';
          p.t = 0;
          p.opened = true;
          this.audit.holds++;
          p.gesture = this.grab('__player', c, () => {
            this.audit.pulls++;
            this.pull(c, Math.max(c.e + PASS, p!.u + PLAYER_CLEAR + 0.12));
          }, null);
        }
        return;
      }
      case 'pull': {
        hold();
        if (c.openAt(p.u, PLAYER_CLEAR) || p.t > 3) {
          if (p.t > 3) this.pull(c, Math.max(c.e, p.u + PLAYER_CLEAR + 0.12));
          resume();
          this.through(p);
        }
        return;
      }
      case 'through': {
        if (past >= 0.5 || (!pl.path && past > 0.25)) {
          const should = p.willClose && this.rest(c) === 'closed' && c.goal > c.eClosed + 0.08 && Math.abs(c.e - u) < 1.5 && !this.npcFollower(c);
          if (!should) {
            p.phase = 'done';
            return;
          }
          hold();
          p.phase = 'close';
          p.t = 0;
          p.gesture = this.grab('__player', c, () => {
            if (this.rest(c) !== 'closed') return;
            this.audit.closes++;
            this.pull(c, c.eClosed);
          }, null);
        } else if (!pl.path && Math.abs(past) > 1.5) this.endPlayer();
        return;
      }
      case 'close': {
        hold();
        const g = p.gesture;
        if ((g && g.pressed && g.t > REACH_T + 0.2) || p.t > 2.5) {
          resume();
          p.phase = 'done';
        }
        return;
      }
      default:
        if (Math.abs(past) > 1.2 || !pl.path) this.endPlayer();
    }
  }

  private npcFollower(c: Curtain): boolean {
    for (const q of this.passages.values()) if (q.cur === c && (q.phase === 'approach' || q.phase === 'pull' || q.phase === 'through')) return true;
    return false;
  }

  // ─────────── tests ───────────

  /** every crossing of a curtain line by the player or an NPC, and whether fabric hung there */
  private auditStep() {
    const check = (who: string, x: number, z: number) => {
      const last = this.lastPos.get(who);
      this.lastPos.set(who, [x, z]);
      if (!last || Math.hypot(x - last[0], z - last[1]) > 1.5) return;
      for (const c of this.list) {
        const a = this.local(c, last[0], last[1]);
        const b = this.local(c, x, z);
        if (!((a.v < 0 && b.v >= 0) || (a.v > 0 && b.v <= 0))) continue;
        const f = a.v / (a.v - b.v);
        const u = a.u + (b.u - a.u) * f;
        if (u < -0.05 || u > c.def.span + 0.05) continue;
        this.audit.crossings++;
        if (c.covers(u)) {
          this.audit.violations.push({ who, curtain: c.def.id, u: Math.round(u * 1000) / 1000, edge: Math.round(c.e * 1000) / 1000, t: Math.round(this.now * 100) / 100 });
          if (this.audit.violations.length > 50) this.audit.violations.shift();
        }
      }
    };
    const pl = this.deps.player?.();
    if (pl) check('__player', pl.pos.x, pl.pos.y);
    for (const st of this.deps.npcs()) if (st.v.visible) check(st.v.id, st.pos.x, st.pos.y);
  }

  /** test/automation hooks (World: ?debug=1) */
  snapshot() {
    return this.list.map(c => ({ id: c.def.id, side: c.override, goal: c.overrideGoal, sticky: c.sticky }));
  }

  restoreSave(saved: ReturnType<Curtains['snapshot']>) {
    for (const row of saved) {
      const c = this.byId.get(row.id);
      if (c) { this.setOverride(c, row.side, row.goal); c.sticky = row.sticky; }
    }
  }

  debugApi() {
    const state = (c: Curtain) => (c.moving ? (c.goal > c.e ? 'opening' : 'closing') : c.e <= c.eClosed + 0.05 ? 'closed' : c.e >= c.eOpen - 0.05 ? 'open' : 'partly open');
    return {
      /** each curtain: state, edge (m from the doorway end), goal, the rule, the player's override, its line */
      curtains: () =>
        this.list.map((c) => ({
          id: c.def.id,
          state: state(c),
          edge: Math.round(c.e * 1000) / 1000,
          goal: Math.round(c.goal * 1000) / 1000,
          open: Math.round(c.eOpen * 1000) / 1000,
          closed: c.eClosed,
          rule: c.rule,
          override: c.override,
          awake: c.awake,
          line: { ax: c.def.ax, az: c.def.az, dx: c.def.dx, dz: c.def.dz, nx: c.def.nx, nz: c.def.nz, span: c.def.span },
          collider: [c.collider.min.x, c.collider.min.z, c.collider.max.x, c.collider.max.z].map((n) => Math.round(n * 1000) / 1000),
        })),
      /** set one: 'open' | 'closed' (as the player's choice, so it stays) | 'rule' (back to the bay's rule) | 'snap-open' | 'snap-closed' */
      curtain: (id: string, want: string) => {
        const c = this.byId.get(id);
        if (!c) return false;
        c.sticky = want !== 'rule';
        if (want === 'rule') this.setOverride(c, null);
        else if (want === 'snap-open' || want === 'snap-closed') {
          this.setOverride(c, want === 'snap-open' ? 'open' : 'closed');
          c.snap(this.restGoal(c));
        } else {
          this.setOverride(c, want === 'open' ? 'open' : 'closed');
          this.pull(c, this.restGoal(c));
        }
        return true;
      },
      /** crossings of curtain lines (player + NPCs) and any through fabric; pulls and closes by hand */
      curtainAudit: (reset = false) => {
        const out = { ...this.audit, violations: [...this.audit.violations], passages: [...this.passages.values()].map((p) => ({ who: p.who, curtain: p.cur.def.id, phase: p.phase, hurried: p.hurried })), player: this.playerPass ? { curtain: this.playerPass.cur.def.id, phase: this.playerPass.phase } : null };
        if (reset) Object.assign(this.audit, { crossings: 0, violations: [], pulls: 0, closes: 0, holds: 0 });
        return out;
      },
      /** 'relaxed' (stop, pull, step through, pull closed) | 'hurried' (on the move) | 'auto' */
      curtainMode: (m: 'auto' | 'relaxed' | 'hurried') => {
        this.mode = m;
        return m;
      },
      /** the hand on a curtain right now (who, how far into the gesture) */
      curtainHands: () => this.gestures.map((g) => ({ who: g.who, curtain: g.cur.def.id, t: Math.round(g.t * 100) / 100, pressed: g.pressed, arm: g.arm })),
    };
  }

  /** (tests) turn the crossing audit on */
  setAudit(on: boolean) {
    this.deps.audit = on;
  }

  dispose() {
    const scene = this.deps.scene;
    if (!scene) return;
    for (const r of this.pool) r.dispose(scene);
    for (const g of this.gestures) g.reach?.dispose(scene);
    this.pool = [];
    this.gestures = [];
  }
}

// ───────────────────────────── sound ─────────────────────────────

/** a cubicle curtain drawn along its track: a fabric swish and the hooks rattling in the rail */
function curtainSound(sr: number, rand: S.Rand): S.Pcm {
  const dur = 0.85;
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  const swish = S.biquad(S.pink(n, rand), sr, 'bandpass', 1500, 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    x[i] = swish[i] * Math.pow(Math.sin(Math.PI * t), 1.4) * 0.55;
  }
  for (let t = 0.03; t < dur - 0.08; t += 0.016 + rand() * 0.03) S.mix(x, S.burst(sr, rand, 0.012, 0.0025, 2800 + rand() * 2200, 'bandpass', 2.2), Math.round(t * sr), 0.25 + rand() * 0.3);
  return S.normalize(x, 0.85);
}
if (!BUILTIN_SOUNDS.curtain) BUILTIN_SOUNDS.curtain = { render: curtainSound, db: -27, note: 'a cubicle curtain drawn along its ceiling track (curtains.ts)' };

/**
 * Builds the static hospital from a LayoutDef: textured vinyl floors, painted walls with
 * rubber cove base and corridor handrails (full + cut-away variants for the top-down
 * camera), privacy curtains with real pleats, door frames and leaves, an acoustic tile
 * ceiling with recessed LED troffers, signage, the exterior lot and props. Produces
 * collision boxes, interactables, lying/seat surfaces and the light-fixture positions
 * the lighting rig turns into lights. Static meshes are merged by material at the end,
 * with world-space UVs for textured materials (see materials.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LayoutDef, PropDef, Rect, RoomDef, Side } from '../../../shared/layout';
import { DOOR_H, WALL_T, openDoorLeaves, sideFrame } from './doorLeaves';
import type { InteractTarget } from './index';
import { G, add, applyWorldUVs, basic, boxB, canvasTexture, emitter, glass, lambert, makeCanvas, own, pbr, trackGeo, trackTexture } from './materials';
import { buildDetails, type Details } from './details';
import { buildStairs } from './stairs';
import { buildExterior, type ExteriorBuilt } from './exterior';
import { FIXTURE_INFO } from './items';
import { buildProp, seatHeight, surfaceHeight, type ScreenKind } from './props';
import { NAV_FURNITURE, footprintOf, type Footprint } from './pathfinding';
import { RESUS_TALL, dressResusSuite, resusLitRooms } from './resusGear';
import { IMAGING_TALL, dressImagingSuite, type ImagingRig } from './imaging';
import { buildCurtains, type CurtainRig } from './curtains';
import { ELEVATOR_PROPS, upperOutlines, upperRoofHoles, wallUnderUpper } from '../../../shared/floors';

export interface Interactable {
  key: string;
  target: InteractTarget;
  box: THREE.Box3;
  center: THREE.Vector3;
  /** storey it is on (floors.ts; undefined = the ground floor) */
  level?: number;
}

export interface Seat {
  x: number;
  z: number;
  y: number;
  rot: number;
  /** 'desk' seats face a work surface (typing pose) */
  kind: 'chair' | 'desk' | 'sofa';
}

export interface Fixture {
  x: number;
  y: number;
  z: number;
  room: string;
  /** 'procedure': a resus room's ceiling-arm procedure light (resusGear.ts), a shadowless spot */
  kind: 'troffer' | 'exam' | 'downlight' | 'procedure';
  /** floors.ts: a light that only matters on this storey (lights don't stop at slabs; the rig culls by level) */
  level?: number;
}

export interface BuiltWorld {
  root: THREE.Group;
  /** hidden in top-down mode: ceilings, roof, parapet, full-height walls, signs, curtain tracks (curtains.ts cuts its cloth down itself) */
  tall: THREE.Group;
  /** shown only in top-down mode: cut-away walls, floor labels */
  low: THREE.Group;
  colliders: THREE.Box3[];
  occluders: THREE.Box3[];
  /** full-length wall lines incl. door gaps — keeps the 3rd-person camera in the player's room */
  cameraBlockers: THREE.Box3[];
  interactables: Interactable[];
  screens: { mesh: THREE.Mesh; kind: ScreenKind; prop: PropDef }[];
  lightBars: THREE.Mesh[];
  lamps: THREE.PointLight[];
  fixtures: Fixture[];
  /** set dressing: clocks to tick, bedside-table surfaces for decor, where belongings go */
  details: Details;
  surfaces: { box: THREE.Box3; y: number }[];
  seats: Seat[];
  /** floor furniture by its real footprint (chairs, stools, beds, desks…): NPC routes go round it (pathfinding.ts) */
  navFootprints: Footprint[];
  night: { groundMat: THREE.MeshStandardMaterial; lampMats: THREE.MeshStandardMaterial[]; signMats: THREE.Material[]; dimMats: { mat: THREE.MeshStandardMaterial; day: THREE.Color }[] };
  /** rooms with opening hours: their own troffer diffusers, so the lighting rig can switch them off when closed */
  roomHours: { room: string; hours: [number, number]; mats: THREE.MeshStandardMaterial[]; base: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** the outside (exterior.ts): lights for the rig, reflection probe, sun blockers, day/night */
  exterior: ExteriorBuilt;
  /** bay curtains on their tracks (curtains.ts: World runs them) */
  curtains: CurtainRig[];
  /** the CT suite's and the X-ray room's moving parts and screens (imaging.ts; imagingLife.ts plays them) */
  imaging: ImagingRig;
}

/** `outer` minus the `holes`, as non-overlapping rectangles (row runs on a compressed grid) */
function subtractRects(outer: Rect, holes: Rect[]): Rect[] {
  if (!holes.length) return [outer];
  const cuts = (lo: number, hi: number, vals: number[]) => [...new Set([lo, hi, ...vals.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = cuts(outer.x, outer.x + outer.w, holes.flatMap((h) => [h.x, h.x + h.w]));
  const zs = cuts(outer.z, outer.z + outer.d, holes.flatMap((h) => [h.z, h.z + h.d]));
  const out: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const hole = holes.some((h) => cx > h.x && cx < h.x + h.w && cz > h.z && cz < h.z + h.d);
      if (hole) {
        if (run) out.push(run);
        run = null;
      } else if (run) run.w = xs[i + 1] - run.x;
      else run = { x: xs[i], z: zs[j], w: xs[i + 1] - xs[i], d: zs[j + 1] - zs[j] };
    }
    if (run) out.push(run);
  }
  return out;
}

const LOW_H = 1.05;
/** props that belong with the full-height walls (see the props loop) */
const TALL_PROPS = new Set<string>(['board', 'tv', 'lamp', 'hangingSign', 'wallSign', 'poster', 'litSign', 'menuBoard', 'handDryer', 'handRub', 'soapDispenser', 'towelDispenser', 'gloveHolder', 'maskBox', 'diagSet', 'aed', 'callPanel', 'fireDoor', 'elevatorDoor', 'canopy']);
for (const k of RESUS_TALL) TALL_PROPS.add(k);
for (const k of IMAGING_TALL) TALL_PROPS.add(k);

/** Mineral-fiber ceiling tile with fissures; one texture = one 60 cm tile incl. half the T-bar on each edge. */
export function ceilingTileTexture(): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#f2f1ec';
  ctx.fillRect(0, 0, S, S);
  // fissures + pinholes
  for (let i = 0; i < 1600; i++) {
    const v = 205 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${v},${v},${v - 4},0.55)`;
    const w = 1 + Math.random() * (Math.random() < 0.15 ? 7 : 2);
    ctx.fillRect(Math.random() * S, Math.random() * S, w, 1 + Math.random());
  }
  // T-bar grid (exposed, slightly darker painted steel) and the tile bevel shadow
  ctx.fillStyle = '#d9dad6';
  ctx.fillRect(0, 0, S, 5);
  ctx.fillRect(0, 0, 5, S);
  ctx.fillRect(0, S - 5, S, 5);
  ctx.fillRect(S - 5, 0, 5, S);
  ctx.fillStyle = 'rgba(120,118,110,0.35)';
  ctx.fillRect(5, 5, S - 10, 2);
  ctx.fillRect(5, 5, 2, S - 10);
  const t = canvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Horizontal plane at height y covering rect (UVs are generated in world space at merge time). */
export function floorGeo(x: number, z: number, w: number, d: number, y: number, facingDown = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x + w / 2, y, z + d / 2);
  return trackGeo(g);
}

export function textCanvas(text: string, opts: { w: number; h: number; bg: string; fg: string; font?: string; border?: string; glow?: string; fill?: number }) {
  const { canvas, ctx } = makeCanvas(opts.w, opts.h);
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.w, opts.h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = Math.max(4, opts.h * 0.05);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, opts.w - ctx.lineWidth, opts.h - ctx.lineWidth);
  }
  ctx.fillStyle = opts.fg;
  let size = Math.floor(opts.h * (opts.fill ?? 0.56));
  ctx.font = opts.font ?? `700 ${size}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;
  while (ctx.measureText(text).width > opts.w * 0.9 && size > 10) {
    size -= 2;
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = opts.h * 0.12;
  }
  ctx.fillText(text, opts.w / 2, opts.h / 2 + size * 0.04);
  return canvas;
}

/** yaw that makes a +z-facing plane face along (nx, nz) */
function yawFor(nx: number, nz: number) {
  return Math.atan2(nx, nz);
}

/** Printed poster / board texture (lit like paper, not glowing). */
function posterCanvas(title: string, lines: string[], accent: string, w = 384, h = 512): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, h * 0.22);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(h * 0.07)}px ui-sans-serif, system-ui, -apple-system, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  const words = title.split(' ');
  let line = '';
  let y = h * 0.075;
  for (const wd of words) {
    if (ctx.measureText(line + wd).width > w * 0.88 && line) {
      ctx.fillText(line.trim(), w * 0.06, y);
      y += h * 0.075;
      line = '';
    }
    line += wd + ' ';
  }
  ctx.fillText(line.trim(), w * 0.06, y);
  ctx.fillStyle = '#26323a';
  ctx.font = `600 ${Math.round(h * 0.045)}px ui-sans-serif, system-ui, -apple-system, Arial, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, w * 0.06, h * 0.3 + i * h * 0.085));
  ctx.fillStyle = accent;
  ctx.fillRect(w * 0.06, h * 0.93, w * 0.3, h * 0.012);
  return canvas;
}

/** wall-mounted clinical equipment and signage for a treatment bay (head of the bed at the north wall) */
function dressBay(g: THREE.Group, r: RoomDef, H: number, posters: Map<string, THREE.Material>) {
  const bed = r.spots.bed;
  if (!bed) return;
  const zWall = r.rect.z + WALL_T; // inner face of the north wall
  const alu = lambert('#b9bfc4', { roughness: 0.35, metalness: 0.85 });
  const white = lambert('#f2f3f1', { roughness: 0.4 });
  // headwall rail + accessories
  add(g, G.rbox(2.7, 0.06, 0.035, 0.01), alu, bed.x, 1.25, zWall + 0.018);
  // suction regulator + canister
  add(g, G.rbox(0.07, 0.1, 0.06, 0.015), white, bed.x - 0.95, 1.36, zWall + 0.04);
  add(g, G.cyl(0.075, 0.075, 0.22, 20), glass('#e9f3f6', 0.45), bed.x - 0.95, 1.08, zWall + 0.09).userData.noMerge = true;
  add(g, G.cyl(0.08, 0.08, 0.03, 20), white, bed.x - 0.95, 1.2, zWall + 0.09);
  // wall diagnostic set (otoscope / ophthalmoscope) with coiled cords
  add(g, G.rbox(0.36, 0.13, 0.07, 0.02), lambert('#8f989e', { roughness: 0.4, metalness: 0.3 }), bed.x - 0.45, 1.5, zWall + 0.035);
  for (const dx of [-0.08, 0.08]) add(g, G.cyl(0.018, 0.018, 0.14, 10), lambert('#2a2e31', { roughness: 0.5 }), bed.x - 0.45 + dx, 1.62, zWall + 0.05);
  // BP cuff basket
  add(g, G.rbox(0.22, 0.14, 0.1, 0.02), lambert('#2a4f86', { roughness: 0.7 }), bed.x - 1.25, 1.15, zWall + 0.05);
  // outlets (white + red emergency-power) on the rail line
  for (const [dx, c] of [[-0.25, '#f4f4f2'], [0.25, '#f4f4f2'], [0.45, '#c8302c'], [0.65, '#c8302c']] as [number, string][]) add(g, G.rbox(0.07, 0.11, 0.012, 0.004), lambert(c, { roughness: 0.4 }), bed.x + dx, 1.02, zWall + 0.006);
  // over-bed reading light
  add(g, G.rbox(1.2, 0.07, 0.09, 0.02), white, bed.x, 2.05, zWall + 0.045);
  add(g, G.box(1.1, 0.012, 0.06), emitter('#fff3e2', 1.6), bed.x, 2.012, zWall + 0.05);
  // glove box dispenser (S/M/L) by the entrance on the west wall (the hand rub 1 m nearer the curtain: shared/hygiene.ts)
  const xW = r.rect.x + WALL_T;
  add(g, G.rbox(0.05, 0.36, 0.28, 0.01), alu, xW + 0.025, 1.4, r.rect.z + r.rect.d - 2.2, 0, 0, 0);
  ['#6b4fb3', '#3d74c9', '#3aa36a'].forEach((c, i) => add(g, G.rbox(0.09, 0.1, 0.24, 0.01), lambert(c, { roughness: 0.7 }), xW + 0.07, 1.28 + i * 0.11, r.rect.z + r.rect.d - 2.2));
  // "Your care team" board on the east wall
  const key = `care|${r.id}`;
  let pm = posters.get(key);
  if (!pm) {
    pm = own(new THREE.MeshStandardMaterial({ map: canvasTexture(posterCanvas('YOUR CARE TEAM', [`Room: ${r.label}`, 'Nurse: ______', 'Doctor: ______', 'Today is: ______', 'Pain (0–10): ___', 'Goal for today:'], '#1f6f8b')), roughness: 0.55 }));
    posters.set(key, pm);
  }
  const xE = r.rect.x + r.rect.w - WALL_T;
  // aluminium frame 2 mm into the wall (front face at xE − 0.006), poster plane 3 mm in front of it,
  // facing the room (−x). Flush with the frame face, the two z-fought and the poster flickered.
  add(g, G.box(0.008, 0.84, 0.64), alu, xE - 0.002, 1.55, r.rect.z + 3.6);
  const plane = add(g, G.plane(0.6, 0.8), pm, xE - 0.009, 1.55, r.rect.z + 3.6, 0, -Math.PI / 2, 0);
  plane.userData.noMerge = true;
  void H;
}

/** slightly lighter version of a room color — the vinyl texture already carries the speckle */
function tint(hex: string, k = 0.35): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

export function buildWorld(layout: LayoutDef): BuiltWorld {
  const root = new THREE.Group();
  const staticRoot = new THREE.Group(); // merged at the end
  const tallStatic = new THREE.Group(); // merged, hidden in top mode
  const lowStatic = new THREE.Group(); // merged, top mode only
  const tall = new THREE.Group();
  const low = new THREE.Group();
  root.add(staticRoot);
  root.add(tall);
  root.add(low);
  tall.add(tallStatic);
  low.add(lowStatic);
  low.visible = false;

  const colliders: THREE.Box3[] = [];
  const occluders: THREE.Box3[] = [];
  const cameraBlockers: THREE.Box3[] = [];
  const interactables: Interactable[] = [];
  const screens: BuiltWorld['screens'] = [];
  const lightBars: THREE.Mesh[] = [];
  const lamps: THREE.PointLight[] = [];
  const fixtures: Fixture[] = [];
  const surfaces: BuiltWorld['surfaces'] = [];
  const seats: Seat[] = [];
  const navFootprints: Footprint[] = [];
  const H = layout.wallHeight;

  // ── floors: sheet vinyl (terrazzo-like speckle), polished ──
  for (const r of layout.rooms) {
    if (r.kind === 'exterior') continue;
    const y = r.kind === 'station' ? 0.012 : 0;
    const set = r.kind === 'waiting' || r.kind === 'office' ? 'floor_alt' : 'floor_vinyl';
    const mat = pbr(set, { color: tint(r.floor, r.kind === 'station' ? 0.1 : 0.45), tile: set === 'floor_alt' ? 0.75 : 1.0, roughness: 0.62, normalScale: 0.35 });
    staticRoot.add(new THREE.Mesh(floorGeo(r.rect.x, r.rect.z, r.rect.w, r.rect.d, y), mat));
  }

  // ── wayfinding stripes in the hub (EMS → Resus in red, Waiting → beds in blue) ──
  const stripe = (x1: number, z1: number, x2: number, z2: number, color: string) => {
    const w = Math.abs(x2 - x1) + 0.12;
    const d = Math.abs(z2 - z1) + 0.12;
    add(staticRoot, G.box(w, 0.004, d), lambert(color, { roughness: 0.45 }), (x1 + x2) / 2, 0.003, (z1 + z2) / 2);
  };
  stripe(41.1, 14.6, 30.0, 14.6, '#c63b3b');
  stripe(30.0, 14.6, 30.0, 7.4, '#c63b3b');
  stripe(4.7, 14.9, 4.7, 7.9, '#2a72bd');
  stripe(4.7, 7.9, 22.0, 7.9, '#2a72bd');

  // ── walls ──
  const isBoundary = (side: Side, r: RoomDef) =>
    (side === 'n' && r.rect.z <= 0.001) ||
    (side === 's' && r.rect.z + r.rect.d >= layout.depth - 0.001) ||
    (side === 'w' && r.rect.x <= 0.001) ||
    (side === 'e' && r.rect.x + r.rect.w >= layout.width - 0.001);
  const facadeMat = pbr('concrete', { color: '#d9d2c6', tile: 3, roughness: 0.95 });
  facadeMat.userData.tag = 'night';
  const frameMat = lambert('#c4cbd0', { roughness: 0.38, metalness: 0.35 });
  const doorMat = pbr('wood', { color: '#e8d7bd', tile: 1.6, roughness: 0.7 });
  const kickMat = pbr('steel', { tile: 0.5, roughness: 0.9 });
  const baseMat = pbr('rubber', { color: '#5b6064', tile: 0.5, roughness: 0.8 });
  const railWood = pbr('wood', { color: '#d9b98f', tile: 0.8, roughness: 0.55 });
  const railBracket = pbr('steel', { tile: 0.3 });
  const glassMat = glass('#d6ecf2', 0.18);
  const railMat = pbr('steel', { tile: 0.3, roughness: 0.6 });
  // tinted glazing with warm interior light behind it (blinds half down)
  const windowMat = lambert('#1b232a', { roughness: 0.06, metalness: 0.5, emissive: '#ffd9a8', emissiveIntensity: 0.07 });

  for (const r of layout.rooms) {
    if (r.kind === 'exterior') continue;
    const wallMat = pbr('wall_paint', { color: r.wall, tile: 1.6, roughness: 0.95, normalScale: 0.35 });
    // a taller room (double-height stair core) keeps its walls up to its own ceiling
    const RH = r.ceilingHeight ?? H;
    const facadeTop = RH > H ? RH + 0.3 : H + 0.9;
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      if (r.openSides?.includes(side)) continue;
      const f = sideFrame(r, side);
      // under an upper floor the build-up stops at its slab (that floor's walls and entrances carry on)
      const facadeH = RH <= H && wallUnderUpper(layout, f.sx, f.sz, f.sx + f.dx * f.len, f.sz + f.dz * f.len) ? H : facadeTop;
      // wall centerline offset inward by half thickness
      const ox = f.nx * (WALL_T / 2);
      const oz = f.nz * (WALL_T / 2);
      const yaw = Math.atan2(f.dx, f.dz) - Math.PI / 2; // box length along local x
      if (r.curtainSides?.includes(side)) {
        // ceiling-mounted cubicle track; the curtain on it opens and closes (curtains.ts, built below)
        const cx = f.sx + f.dx * f.len / 2 + ox;
        const cz = f.sz + f.dz * f.len / 2 + oz;
        add(tallStatic, G.box(f.len - 0.06, 0.035, 0.04), railMat, cx, H - 0.05, cz, 0, yaw, 0);
        continue;
      }
      {
        const cx = f.sx + f.dx * f.len / 2 + ox;
        const cz = f.sz + f.dz * f.len / 2 + oz;
        const hx = Math.abs(f.dx) * f.len / 2 + Math.abs(f.nx) * WALL_T / 2;
        const hz = Math.abs(f.dz) * f.len / 2 + Math.abs(f.nz) * WALL_T / 2;
        cameraBlockers.push(new THREE.Box3(new THREE.Vector3(cx - hx, 0, cz - hz), new THREE.Vector3(cx + hx, RH, cz + hz)));
      }
      const doors = r.doors.filter((dd) => dd.side === side).sort((a, b) => a.offset - b.offset);
      const segs: [number, number][] = [];
      let cur = 0;
      for (const dd of doors) {
        if (dd.offset > cur) segs.push([cur, dd.offset]);
        cur = Math.max(cur, dd.offset + dd.width);
      }
      if (cur < f.len) segs.push([cur, f.len]);
      const boundary = isBoundary(side, r);
      const handrail = r.kind === 'corridor' || r.kind === 'waiting';
      for (const [a, b] of segs) {
        const len = b - a;
        if (len < 0.02) continue;
        const mid = (a + b) / 2;
        const cx = f.sx + f.dx * mid + ox;
        const cz = f.sz + f.dz * mid + oz;
        add(tallStatic, G.box(len, RH, WALL_T), wallMat, cx, RH / 2, cz, 0, yaw, 0);
        add(lowStatic, G.box(len, LOW_H, WALL_T), wallMat, cx, LOW_H / 2, cz, 0, yaw, 0);
        // rubber cove base on the room side. At a corner it stops 3 mm inside the side wall it runs
        // into: it reached that wall's far face, and flickered there where a corridor opens onto it.
        const walled = (sd: Side) => !r.openSides?.includes(sd) && !r.curtainSides?.includes(sd);
        const [startSide, endSide]: Side[] = side === 'n' || side === 's' ? ['w', 'e'] : ['n', 's'];
        const c0 = a === 0 && walled(startSide) ? 0.003 : 0;
        const c1 = b === f.len && walled(endSide) ? 0.003 : 0;
        const bt = mid + (c0 - c1) / 2;
        const bx = f.sx + f.dx * bt + ox + f.nx * (WALL_T / 2 + 0.006);
        const bz = f.sz + f.dz * bt + oz + f.nz * (WALL_T / 2 + 0.006);
        add(staticRoot, G.box(len - c0 - c1, 0.1, 0.012), baseMat, bx, 0.05, bz, 0, yaw, 0);
        // corridor handrail (wood rail on steel brackets) at 0.9 m
        if (handrail && len > 1.0) {
          const rx = cx + f.nx * (WALL_T / 2 + 0.075);
          const rz = cz + f.nz * (WALL_T / 2 + 0.075);
          add(tallStatic, G.rbox(len - 0.3, 0.05, 0.07, 0.02), railWood, rx, 0.9, rz, 0, yaw, 0);
          const nb = Math.max(2, Math.round(len / 1.2));
          for (let i = 0; i < nb; i++) {
            const t = a + 0.25 + ((len - 0.5) * i) / Math.max(1, nb - 1);
            const px = f.sx + f.dx * t + ox + f.nx * (WALL_T / 2 + 0.035);
            const pz = f.sz + f.dz * t + oz + f.nz * (WALL_T / 2 + 0.035);
            add(tallStatic, G.box(0.03, 0.08, 0.07), railBracket, px, 0.85, pz, 0, yaw, 0);
          }
        }
        if (boundary) {
          const fx = cx - f.nx * (WALL_T / 2 + 0.06);
          const fz = cz - f.nz * (WALL_T / 2 + 0.06);
          add(tallStatic, G.box(len, facadeH, 0.12), facadeMat, fx, facadeH / 2, fz, 0, yaw, 0);
          add(lowStatic, G.box(len, LOW_H, 0.12), facadeMat, fx, LOW_H / 2, fz, 0, yaw, 0);
          // street-facing façade: horizontal window bands glowing with interior light (outside only)
          if (side === 's' && len > 2.4) {
            const n = Math.floor((len - 0.8) / 2.6);
            for (let i = 0; i < n; i++) {
              const t = a + 0.4 + 1.3 + i * 2.6 + ((len - 0.8) - n * 2.6) / 2;
              const wx = f.sx + f.dx * t + ox - f.nx * (WALL_T / 2 + 0.125);
              const wz = f.sz + f.dz * t + oz - f.nz * (WALL_T / 2 + 0.125);
              add(tallStatic, G.box(2.1, 1.25, 0.03), windowMat, wx, 1.65, wz, 0, yaw, 0);
              add(tallStatic, G.box(2.22, 0.07, 0.07), frameMat, wx, 1.0, wz, 0, yaw, 0);
              add(tallStatic, G.box(2.22, 0.07, 0.07), frameMat, wx, 2.3, wz, 0, yaw, 0);
              for (const ex of [-1.08, 0, 1.08]) add(tallStatic, G.box(0.06, 1.3, 0.07), frameMat, wx + f.dx * ex, 1.65, wz + f.dz * ex, 0, yaw, 0);
            }
          }
        }
        const halfAlong = new THREE.Vector3(Math.abs(f.dx) * len / 2, 0, Math.abs(f.dz) * len / 2);
        const halfThick = new THREE.Vector3(Math.abs(f.nx) * (WALL_T / 2 + (boundary ? 0.12 : 0)), 0, Math.abs(f.nz) * (WALL_T / 2 + (boundary ? 0.12 : 0)));
        const box = new THREE.Box3(
          new THREE.Vector3(cx - halfAlong.x - halfThick.x, 0, cz - halfAlong.z - halfThick.z),
          new THREE.Vector3(cx + halfAlong.x + halfThick.x, RH, cz + halfAlong.z + halfThick.z),
        );
        colliders.push(box);
        occluders.push(box);
      }
      // lintels, frames and door leaves
      for (const dd of doors) {
        const mid = dd.offset + dd.width / 2;
        const cx = f.sx + f.dx * mid + ox;
        const cz = f.sz + f.dz * mid + oz;
        // a raised door (a double-height stair core's door onto an upper floor, floors.ts) sits on solid wall
        const y0 = dd.y ?? 0;
        if (y0 > 0) {
          add(tallStatic, G.box(dd.width, y0, WALL_T), wallMat, cx, y0 / 2, cz, 0, yaw, 0);
          add(lowStatic, G.box(dd.width, Math.min(LOW_H, y0), WALL_T), wallMat, cx, Math.min(LOW_H, y0) / 2, cz, 0, yaw, 0);
          add(staticRoot, G.box(dd.width, 0.1, 0.012), baseMat, cx + f.nx * (WALL_T / 2 + 0.006), 0.05, cz + f.nz * (WALL_T / 2 + 0.006), 0, yaw, 0);
          const hw = new THREE.Vector3(Math.abs(f.dx) * dd.width / 2 + Math.abs(f.nx) * WALL_T / 2, 0, Math.abs(f.dz) * dd.width / 2 + Math.abs(f.nz) * WALL_T / 2);
          const below = new THREE.Box3(new THREE.Vector3(cx - hw.x, 0, cz - hw.z), new THREE.Vector3(cx + hw.x, y0, cz + hw.z));
          colliders.push(below);
          occluders.push(below);
        }
        add(tallStatic, G.box(dd.width, RH - DOOR_H - y0, WALL_T), wallMat, cx, y0 + DOOR_H + (RH - DOOR_H - y0) / 2, cz, 0, yaw, 0);
        if (boundary) add(tallStatic, G.box(dd.width, facadeH - DOOR_H, 0.12), facadeMat, cx - f.nx * (WALL_T / 2 + 0.06), DOOR_H + (facadeH - DOOR_H) / 2, cz - f.nz * (WALL_T / 2 + 0.06), 0, yaw, 0);
        // hollow-metal frame (jambs + head)
        for (const e of [dd.offset, dd.offset + dd.width]) {
          const tx = f.sx + f.dx * e + ox;
          const tz = f.sz + f.dz * e + oz;
          add(tallStatic, G.rbox(0.07, DOOR_H, WALL_T + 0.05, 0.012), frameMat, tx, y0 + DOOR_H / 2, tz, 0, yaw, 0);
          // stainless corner guards on the jambs (gurneys hit these)
          add(tallStatic, G.box(0.075, 1.2, WALL_T + 0.06), kickMat, tx, y0 + 0.6, tz, 0, yaw, 0);
        }
        add(tallStatic, G.rbox(dd.width + 0.07, 0.07, WALL_T + 0.05, 0.012), frameMat, cx, y0 + DOOR_H, cz, 0, yaw, 0);
        // leaves (always open)
        if (dd.kind === 'door' || dd.kind === 'double') {
          for (const leaf of openDoorLeaves(r, dd)) {
            const { x: hx, z: hz } = leaf.getCenter(new THREE.Vector3());
            const lw = dd.side === 'n' || dd.side === 's' ? leaf.max.z - leaf.min.z : leaf.max.x - leaf.min.x;
            colliders.push(leaf);
            occluders.push(leaf);
            add(tallStatic, G.rbox(0.045, DOOR_H - 0.05, lw, 0.01), doorMat, hx, y0 + (DOOR_H - 0.05) / 2, hz, 0, yaw, 0);
            add(tallStatic, G.box(0.05, 0.25, lw - 0.04), kickMat, hx, y0 + 0.14, hz, 0, yaw, 0);
            // vision panel
            add(tallStatic, G.box(0.05, 0.6, 0.12), glassMat, hx, y0 + 1.45, hz + 0, 0, yaw, 0).userData.noMerge = true;
          }
        } else if (dd.kind === 'sliding' && !dd.pocket) {
          for (const s of [-1, 1]) {
            const t = s < 0 ? dd.offset - dd.width / 4 : dd.offset + dd.width + dd.width / 4;
            const gx = f.sx + f.dx * t + ox + f.nx * (WALL_T / 2 + 0.04);
            const gz = f.sz + f.dz * t + oz + f.nz * (WALL_T / 2 + 0.04);
            // the glass ends 3 mm inside the frame stiles (its edges lay in their outer faces and flickered)
            const leaf = add(tall, G.box(dd.width / 2 - 0.006, DOOR_H - 0.05, 0.02), glassMat, gx, (DOOR_H - 0.05) / 2, gz, 0, yaw, 0);
            leaf.userData.noMerge = true;
            // aluminium frame around each glass leaf
            for (const ex of [-1, 1]) {
              const fx = gx + f.dx * ex * (dd.width / 4 - 0.02);
              const fz = gz + f.dz * ex * (dd.width / 4 - 0.02);
              add(tallStatic, G.box(0.04, DOOR_H - 0.05, 0.05), frameMat, fx, (DOOR_H - 0.05) / 2, fz, 0, yaw, 0);
            }
            add(tallStatic, G.box(dd.width / 2, 0.06, 0.05), frameMat, gx, DOOR_H - 0.06, gz, 0, yaw, 0);
            add(tallStatic, G.box(dd.width / 2, 0.08, 0.05), frameMat, gx, 0.04, gz, 0, yaw, 0);
          }
        }
      }
    }
  }

  // ── set dressing: bay equipment, patient-facing posters ──
  const posterMats = new Map<string, THREE.Material>();
  for (const r of layout.rooms) if (r.kind === 'bay') dressBay(tallStatic, r, H, posterMats);
  const POSTERS: [string, string[], string][] = [
    ['CLEAN HANDS SAVE LIVES', ['Use the sanitizer when you', 'enter and leave a room.', '', '20–30 seconds, every time.'], '#2a8f86'],
    ['STROKE? ACT B.E. F.A.S.T.', ['Balance loss', 'Eyes: vision change', 'Face drooping', 'Arm weakness', 'Speech difficulty', 'Time to call for help'], '#c0392b'],
    ['TELL US IF YOU FEEL WORSE', ['Chest pain, trouble breathing,', 'confusion or new bleeding:', 'tell the triage nurse now.', '', 'We see the sickest first.'], '#1f5f99'],
    ['WAIT TIMES', ['Patients are seen by urgency,', 'not by arrival order.', '', 'Thank you for your patience.'], '#6b4fb3'],
  ];
  const posterAt = (i: number, x: number, z: number, yaw: number) => {
    const [title, lines, accent] = POSTERS[i % POSTERS.length];
    const key = `poster|${i}`;
    let pm = posterMats.get(key);
    if (!pm) {
      pm = own(new THREE.MeshStandardMaterial({ map: canvasTexture(posterCanvas(title, lines, accent)), roughness: 0.5 }));
      posterMats.set(key, pm);
    }
    const m = add(tall, G.plane(0.6, 0.8), pm, x, 1.55, z, 0, yaw, 0);
    m.userData.noMerge = true;
  };
  for (const r of layout.rooms) {
    if (r.kind !== 'waiting') continue;
    // north wall (inside face), facing south; east wall facing west
    posterAt(0, r.rect.x + 1.6, r.rect.z + WALL_T + 0.004, 0);
    posterAt(2, r.rect.x + 7.6, r.rect.z + WALL_T + 0.004, 0);
    posterAt(1, r.rect.x + r.rect.w - WALL_T - 0.004, r.rect.z + 3.0, -Math.PI / 2);
    posterAt(3, r.rect.x + r.rect.w - WALL_T - 0.004, r.rect.z + 6.8, -Math.PI / 2);
  }

  // ── ceilings: acoustic tile on a T-bar grid + recessed 60×120 LED troffers ──
  // How bright a lit diffuser panel is drawn (not how much light it gives: the fixtures' lights are in
  // render/lighting.ts). At 3.2 every panel was far past white, and the bloom spread it over the tiles
  const TROFFER_GLOW = 2;
  // The troffers don't light their own ceiling (lighting.ts): what the tiles show is the room's light
  // coming back up off the floor and the walls, even across a ceiling. No bounce is computed, so the
  // tiles give off that much themselves
  const CEILING_BOUNCE = 0.18;
  const tileTex = ceilingTileTexture();
  const ceilMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tileTex, roughness: 0.96, emissive: '#fff6ea', emissiveMap: tileTex, emissiveIntensity: CEILING_BOUNCE }));
  ceilMat.userData.worldUV = 0.6;
  const trofferFrame = lambert('#f1f2ef', { roughness: 0.35, metalness: 0.1 });
  const diffuser = emitter('#fff3e2', TROFFER_GLOW);
  const roomHours: BuiltWorld['roomHours'] = [];
  const procLit = resusLitRooms(layout);
  for (const r of layout.rooms) {
    if (r.kind === 'exterior' || r.kind === 'station') continue;
    const CH = r.ceilingHeight ?? H;
    // rooms with opening hours get their own diffuser material: lights off when they're closed
    let diff = diffuser;
    if (r.hours) {
      diff = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3e2', emissiveIntensity: TROFFER_GLOW, roughness: 0.9 }));
      roomHours.push({ room: r.id, hours: r.hours, mats: [diff], base: TROFFER_GLOW });
    }
    tallStatic.add(new THREE.Mesh(floorGeo(r.rect.x, r.rect.z, r.rect.w, r.rect.d, CH, true), ceilMat));
    const nx = Math.max(1, Math.round(r.rect.w / 3.2));
    const nz = Math.max(1, Math.round(r.rect.d / 3.4));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        // snap to the 60 cm grid so troffers sit in the T-bar layout
        const px = Math.round((r.rect.x + ((i + 0.5) * r.rect.w) / nx) / 0.6) * 0.6;
        const pz = Math.round((r.rect.z + ((j + 0.5) * r.rect.d) / nz) / 0.6) * 0.6 + 0.3;
        const along = r.rect.d > r.rect.w ? 0 : Math.PI / 2;
        add(tallStatic, G.box(0.62, 0.03, 1.22), trofferFrame, px, CH - 0.012, pz, 0, along, 0);
        add(tallStatic, G.box(0.56, 0.012, 1.16), diff, px, CH - 0.03, pz, 0, along, 0);
        fixtures.push({ x: px, y: CH - 0.05, z: pz, room: r.id, kind: 'troffer' });
      }
    }
    // exam light over each bed bay (Resus 1 + 2 have a shadowless procedure light instead: resusGear.ts)
    if ((r.kind === 'bay' || r.kind === 'resus') && !procLit.has(r.id)) {
      const bedSpot = r.spots.bed;
      if (bedSpot) {
        add(tallStatic, G.cyl(0.2, 0.22, 0.05, 24), trofferFrame, bedSpot.x, H - 0.025, bedSpot.z);
        add(tallStatic, G.circle(0.17, 24), emitter('#fffaf2', 2.4), bedSpot.x, H - 0.052, bedSpot.z, Math.PI / 2, 0, 0);
        fixtures.push({ x: bedSpot.x, y: H - 0.08, z: bedSpot.z, room: r.id, kind: 'exam' });
      }
    }
  }

  // ── roof & parapet (from outside) ──
  const roofMat = pbr('concrete', { color: '#8f9396', tile: 4 });
  roofMat.userData.tag = 'night';
  // one slab, with holes where a taller room (a stair core) rises through it as a tower, and where
  // an upper floor stands on it (floors.ts builds that floor's own roof)
  const towers = layout.rooms.filter((r) => r.kind !== 'exterior' && (r.ceilingHeight ?? H) > H + 0.01);
  const uppers = upperOutlines(layout);
  for (const pc of subtractRects({ x: -0.25, z: -0.25, w: layout.width + 0.5, d: layout.depth + 0.5 }, [...towers.map((r) => r.rect), ...upperRoofHoles(layout)])) {
    add(tallStatic, G.box(pc.w, 0.22, pc.d), roofMat, pc.x + pc.w / 2, H + 0.16, pc.z + pc.d / 2);
  }
  for (const r of towers) {
    const RH = r.ceilingHeight ?? H;
    const { x, z, w, d } = r.rect;
    add(tallStatic, G.box(w + 0.3, 0.22, d + 0.3), roofMat, x + w / 2, RH + 0.16, z + d / 2);
    // façade cladding where the tower clears the main roof (boundary sides already have it; sides
    // facing an upper floor are inside that floor)
    const ch = RH + 0.3 - H;
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      if (isBoundary(side, r)) continue;
      const ox = side === 'e' ? x + w + 0.3 : side === 'w' ? x - 0.3 : x + w / 2;
      const oz = side === 's' ? z + d + 0.3 : side === 'n' ? z - 0.3 : z + d / 2;
      if (uppers.some((u) => ox > u.x && ox < u.x + u.w && oz > u.z && oz < u.z + u.d)) continue;
      const alongX = side === 'n' || side === 's';
      const px = side === 'w' ? x - 0.06 : side === 'e' ? x + w + 0.06 : x + w / 2;
      const pz = side === 'n' ? z - 0.06 : side === 's' ? z + d + 0.06 : z + d / 2;
      add(tallStatic, G.box(alongX ? w + 0.24 : 0.12, ch, alongX ? 0.12 : d + 0.24), facadeMat, px, H + ch / 2, pz);
    }
  }
  // parapet + coping, cladding and windows, the ambulance canopy, roof units, the lot, site and
  // street: exterior.ts builds them from the layout (own merge, so shadow casters keep the flag)
  const exterior = buildExterior(layout, { root, tall });
  colliders.push(...exterior.colliders);

  // ── room signs (lit, not glowing: printed acrylic) ──
  const signMats: THREE.Material[] = [];
  for (const r of layout.rooms) {
    if (!r.sign) continue;
    const side = r.signSide ?? 's';
    const f = sideFrame(r, side);
    const door = r.doors.find((dd) => dd.side === side);
    const t = door ? door.offset + door.width / 2 : f.len / 2;
    const outward = -1; // outside of the room = against the inward normal
    const px = f.sx + f.dx * t + f.nx * outward * 0.016;
    const pz = f.sz + f.dz * t + f.nz * outward * 0.016;
    const wPlate = Math.min(3.4, Math.max(0.9, 0.17 * r.sign.length + 0.35));
    const canvas = textCanvas(r.sign, { w: 512, h: Math.round((512 * 0.3) / wPlate), bg: '#0f4c5c', fg: '#ffffff', border: '#e8f3f1' });
    const mat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.35, emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0 }));
    const m = add(tall, G.rbox(wPlate, 0.3, 0.02, 0.008), mat, px, 2.62, pz, 0, yawFor(-f.nx, -f.nz), 0);
    m.userData.noMerge = true;
    // floor label for top-down mode
    if (r.kind !== 'corridor') {
      const lc = textCanvas(r.label.toUpperCase(), { w: 512, h: 128, bg: 'rgba(0,0,0,0)', fg: 'rgba(15,76,92,0.55)' });
      const lm = own(new THREE.MeshBasicMaterial({ map: canvasTexture(lc), transparent: true, depthWrite: false }));
      const lw = Math.min(r.rect.w * 0.9, 3.6);
      const label = add(low, G.plane(lw, lw / 4), lm, r.rect.x + r.rect.w / 2, 0.03, r.rect.z + r.rect.d - Math.min(1.1, r.rect.d * 0.18), -Math.PI / 2, 0, 0);
      label.userData.noMerge = true;
    }
  }

  // ── exterior lot: built by exterior.ts above (ground, markings, puddles, site) ──
  const ext = layout.exterior.rect;
  const groundMat = exterior.groundMat;

  // ── props ──
  const lampMats: THREE.MeshStandardMaterial[] = [];
  const roomLabel = new Map(layout.rooms.map((r) => [r.id, r.label]));
  const roomKind = new Map(layout.rooms.map((r) => [r.id, r.kind]));
  for (const p of layout.props) {
    if (p.kind === 'sign') {
      // illuminated exterior sign on the parapet / canopy fascia (red channel letters)
      const text = p.label ?? 'EMERGENCY';
      const wPlate = Math.min(7.5, 0.42 * text.length + 0.6);
      const canvas = textCanvas(text, { w: 1024, h: Math.round((1024 * 0.62) / wPlate), bg: '#121417', fg: p.color ?? '#e0322d', glow: p.color ?? '#e0322d', fill: 0.86 });
      const map = canvasTexture(canvas);
      const mat = own(new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 2.2, roughness: 0.4 }));
      signMats.push(mat);
      const m = add(tall, G.plane(wPlate, 0.62), mat, p.x, (p.y ?? 3.1) + 0.31, p.z, 0, p.rot ?? 0, 0);
      m.userData.noMerge = true;
      continue;
    }
    // elevator entrances and call buttons: elevator.ts builds them (doors that slide, buttons that light)
    if (ELEVATOR_PROPS.has(p.kind)) continue;
    const built = buildProp(p);
    const g = built.group;
    g.position.set(p.x, p.y ?? 0, p.z);
    g.rotation.y = p.rot ?? 0;
    // wall-mounted/hanging things, full-height doors, canopies and lamps are part of the tall layer
    // (hidden in the top-down/cutaway view, where walls are cut at LOW_H and they would float)
    const hanging = TALL_PROPS.has(p.kind) || (p.y ?? 0) > 0.9;
    (hanging ? tallStatic : staticRoot).add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    if (NAV_FURNITURE.has(p.kind) && !p.solid && (p.y ?? 0) < 0.3) {
      const f = footprintOf(g, p.rot ?? 0);
      if (f) navFootprints.push({ ...f, name: p.id });
    }
    for (const s of built.screens) screens.push({ mesh: s.mesh, kind: s.kind, prop: p });
    lightBars.push(...built.lightBar);
    if (built.lampAnchor) {
      const light = new THREE.PointLight('#ffd9a0', 0, 26, 1.6);
      light.position.copy(built.lampAnchor.clone().applyMatrix4(g.matrixWorld));
      root.add(light);
      lamps.push(light);
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (o as THREE.Mesh).isMesh && m.emissive && m.emissive.getHex() !== 0 && !lampMats.includes(m)) lampMats.push(m);
      });
    }
    if (p.solid) {
      const cb = box.clone();
      cb.min.y = 0;
      colliders.push(Object.assign(cb, { name: p.id }));
    }
    const sh = surfaceHeight(p.kind);
    if (sh !== undefined) surfaces.push({ box: box.clone(), y: sh });
    const se = seatHeight(p.kind);
    if (se !== undefined) {
      const desk = p.kind === 'chair' && (roomKind.get(p.room) === 'station' || roomKind.get(p.room) === 'office' || /desk|pc|st_chair|wr_/.test(p.id));
      // (a sofa's seat is in front of its back cushions: props.ts, amenities.ts SOFA)
      const fwd = p.kind === 'sofa' ? 0.045 : 0;
      seats.push({ x: p.x + Math.sin(p.rot ?? 0) * fwd, z: p.z + Math.cos(p.rot ?? 0) * fwd, y: se, rot: p.rot ?? 0, kind: p.kind === 'sofa' ? 'sofa' : desk ? 'desk' : 'chair' });
    }
    if (p.interact) {
      let t: InteractTarget;
      switch (p.interact) {
        case 'computer':
          t = { kind: 'computer', propId: p.id, label: 'Use workstation' };
          break;
        case 'phone':
          t = { kind: 'phone', propId: p.id, label: 'Use phone' };
          break;
        case 'board':
          t = { kind: 'board', label: 'View tracking board' };
          break;
        case 'monitor':
        default:
          t = { kind: 'monitor', bay: p.bay ?? p.room, label: `View monitor — ${roomLabel.get(p.bay ?? p.room) ?? p.room}` };
          break;
      }
      const ib = box.clone().expandByScalar(0.12);
      interactables.push({ key: `prop:${p.id}`, target: t, box: ib, center: ib.getCenter(new THREE.Vector3()) });
    }
  }

  // ── set dressing + inspectable equipment ──
  const details = buildDetails(layout, tallStatic, staticRoot, tall);
  colliders.push(...details.colliders);
  interactables.push(...details.interactables);
  // Resus 1 + 2 equipment: footprint colliders, inspect boxes, procedure lights, live clock faces
  const resus = dressResusSuite(layout, tall, details.clocks);
  colliders.push(...resus.colliders);
  interactables.push(...resus.interactables);
  fixtures.push(...resus.fixtures);
  // CT suite and X-ray room: the lead-lined partitions, equipment colliders and inspect boxes, the moving rig
  const imaging = dressImagingSuite(layout, { root, staticRoot, tallStatic, lowStatic, tall });
  colliders.push(...imaging.colliders);
  occluders.push(...imaging.occluders);
  cameraBlockers.push(...imaging.cameraBlockers);
  interactables.push(...imaging.interactables);
  // (sinks, basins, hand-rub and soap dispensers, glove and mask boxes are hygiene.ts targets: E uses them, F reads their card)
  const INSPECTABLE_PROPS = new Set(['crashCart', 'bed', 'stretcher', 'ivPole', 'ultrasound', 'vitalsMachine', 'medDispenser', 'cart', 'cabinet', 'vending', 'ctScanner', 'xrayTable', 'coffee', 'fridge', 'printer', 'ambulance', 'sofa', 'elevatorDoor', 'callPanel', 'fireDoor', 'aed', 'servingCounter', 'till', 'coffeeStation', 'drinksFridge', 'trayRack', 'wasteStation', 'toiletStall', 'toilet', 'handDryer', 'babyChange', 'towelDispenser', 'pedalBin', 'examTable', 'diagSet', 'scale']);
  for (const p of layout.props) {
    if (p.interact || !INSPECTABLE_PROPS.has(p.kind) || ELEVATOR_PROPS.has(p.kind)) continue;
    const g = new THREE.Group();
    const built = buildProp(p);
    g.add(built.group);
    g.position.set(p.x, p.y ?? 0, p.z);
    g.rotation.y = p.rot ?? 0;
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g).expandByScalar(0.04);
    const info = FIXTURE_INFO[p.kind];
    interactables.push({ key: `fx:${p.id}`, target: { kind: 'inspect', subject: p.kind, label: `Inspect ${info?.title.toLowerCase() ?? p.kind}` }, box, center: box.getCenter(new THREE.Vector3()) });
  }

  // ── stairs: flights + landings from layout data (walkable via World's standHeight) ──
  colliders.push(...buildStairs(layout, staticRoot).colliders);

  // ── bay curtains: cloth on the tracks above, opened and closed at run time (curtains.ts) ──
  const curtains = buildCurtains(layout, root);

  // exterior world boundary + ambulance etc. are colliders already; add the lot edges
  const b = { minX: ext.x + 0.5, maxX: ext.x + ext.w - 0.5, minZ: -0.5, maxZ: ext.z + ext.d - 0.5 };

  // ── merge static geometry by material ──
  mergeInto(staticRoot);
  mergeInto(tallStatic);
  mergeInto(lowStatic);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    // big flat architecture doesn't need to cast (and would dominate shadow-map cost)
    m.castShadow = !!m.userData.castShadow;
  });

  return {
    root,
    tall,
    low,
    colliders,
    occluders,
    cameraBlockers,
    interactables,
    screens,
    lightBars,
    lamps,
    fixtures,
    details,
    surfaces,
    seats,
    navFootprints,
    night: { groundMat, lampMats, signMats, dimMats: [facadeMat, roofMat].map((mat) => ({ mat, day: mat.color.clone() })) },
    exterior,
    roomHours,
    bounds: b,
    curtains,
    imaging: imaging.rig,
  };
}

/** Replace all mergeable meshes under `group` with one mesh per material (+ world-space UVs where the material asks). */
export function mergeInto(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noMerge || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    // keep only shared attributes
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    const tile = mat.userData.worldUV as number | undefined;
    if (tile) applyWorldUVs(g, tile);
    let arr = buckets.get(mat);
    if (!arr) buckets.set(mat, (arr = []));
    arr.push(g);
    victims.push(m);
  });
  for (const v of victims) v.parent?.remove(v);
  const merged = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const g = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!g) continue;
    trackGeo(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    merged.add(mesh);
  }
  // group itself is at identity (children were in world space through their parents)
  group.add(merged);
  // remove empty containers
  const empties: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o !== group && o !== merged && o.type === 'Group' && o.children.length === 0) empties.push(o);
  });
  for (const e of empties) e.parent?.remove(e);
}

export { trackTexture, basic };

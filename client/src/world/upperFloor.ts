/**
 * Builds an upper storey (shared/floors.ts LevelDef) the way builder.ts builds the ground floor:
 * vinyl floors, painted walls with cove base, door frames and leaves, an acoustic tile ceiling
 * with LED troffers, room signs and props — plus what the ground floor doesn't have: windows you
 * can look out of (the town from surroundings.ts), bathroom partitions, patient-room headwalls,
 * and the storey's own outside (the exterior's façade skin, parapet and roof), so the building
 * reads as two storeys from the lot.
 *
 * Everything is at the storey's height (world coordinates). Groups:
 *   base   floors and floor-standing things (shown while you are on this storey)
 *   tall   walls, ceilings, wall-mounted things (hidden in the cutaway, like the ground floor's)
 *   low    walls cut at 1.05 m + floor labels (the cutaway)
 *   shell  façade, parapet, roof (seen from outside; casts the sun's shadows, keeps the sun out)
 */
import * as THREE from 'three';
import type { LayoutDef, PropDef, Rect, RoomDef, Side } from '../../../shared/layout';
import { HEAD, SILL, elevatorBanks, shaftExtent, type LevelDef, type PartitionDef } from '../../../shared/floors';
import { ceilingTileTexture, floorGeo, mergeInto, textCanvas, type Fixture, type Interactable, type Seat } from './builder';
import { bedsideTable, exitSign, wallClock, type Clock } from './details';
import { facadeSkin, interiorGlass, type FacadeLine } from './exterior';
import { FIXTURE_INFO } from './items';
import { G, add, canvasTexture, emitter, glass, lambert, makeCanvas, own, pbr } from './materials';
import { buildProp, seatHeight, surfaceHeight, type ScreenKind } from './props';
import { mergeByMaterial } from './vehicles';
import { buildSwingLeaf, type SwingDoor } from './swingDoors';

const WALL_T = 0.12;
const PART_T = 0.1;
const DOOR_H = 2.25;
const LOW_H = 1.05;
const TALL_PROPS = new Set<string>(['board', 'tv', 'lamp', 'hangingSign', 'wallSign', 'poster', 'litSign', 'menuBoard', 'handDryer', 'handRub', 'diagSet', 'aed', 'callPanel', 'fireDoor', 'elevatorDoor', 'canopy']);
// (sinks, basins and hand-rub dispensers are hygiene.ts targets: E uses them, F reads their card)
const INSPECTABLE = new Set(['crashCart', 'bed', 'ivPole', 'vitalsMachine', 'medDispenser', 'cart', 'cabinet', 'coffee', 'fridge', 'printer', 'sofa', 'aed', 'toilet']);

export interface UpperBuilt {
  level: LevelDef;
  base: THREE.Group;
  tall: THREE.Group;
  low: THREE.Group;
  shell: THREE.Group;
  colliders: THREE.Box3[];
  occluders: THREE.Box3[];
  cameraBlockers: THREE.Box3[];
  interactables: Interactable[];
  /** each bathroom's swinging door (swingDoors.ts): floors.ts routes E to them and updates them */
  swingDoors: SwingDoor[];
  fixtures: Fixture[];
  roomHours: { room: string; hours: [number, number]; mats: THREE.MeshStandardMaterial[]; base: number }[];
  screens: { mesh: THREE.Mesh; kind: ScreenKind; prop: PropDef }[];
  surfaces: { box: THREE.Box3; y: number }[];
  seats: Seat[];
  clocks: Clock[];
  /** a dim night light low on the wall by each patient room's door (on at night) */
  nightLights: { light: THREE.PointLight; mat: THREE.MeshStandardMaterial; room: string }[];
  /** day/night look of the storey's window glass (as the exterior's own) */
  setNight(night: boolean): void;
  /** the station's tracking-board screen (its clock follows the game clock) */
  board: WardBoard | null;
}

/** patient rooms: lights on 07–22, dark at night (patients asleep; the corridor and station stay lit) */
const PATIENT_HOURS: [number, number] = [7, 22];

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

function tint(hex: string, k = 0.35): string {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

const inRect = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d;

/** an opening in a wall run: a door (sill 0) or a window */
interface Opening {
  a: number;
  b: number;
  sill: number;
  head: number;
  trim: boolean;
  door?: { kind: string };
}

export function buildUpperLevel(layout: LayoutDef, L: LevelDef): UpperBuilt {
  const Y = L.y;
  const H = L.height;
  const base = new THREE.Group();
  const tall = new THREE.Group();
  const low = new THREE.Group();
  const shell = new THREE.Group();
  const baseStatic = new THREE.Group();
  const tallStatic = new THREE.Group();
  const lowStatic = new THREE.Group();
  base.add(baseStatic);
  tall.add(tallStatic);
  low.add(lowStatic);
  const out: UpperBuilt = {
    level: L,
    base,
    tall,
    low,
    shell,
    colliders: [],
    occluders: [],
    cameraBlockers: [],
    interactables: [],
    fixtures: [],
    roomHours: [],
    screens: [],
    surfaces: [],
    seats: [],
    clocks: [],
    nightLights: [],
    swingDoors: [],
    setNight: () => undefined,
    board: null,
  };
  const o = L.outline;
  const isBoundary = (side: Side, r: RoomDef) =>
    (side === 'n' && Math.abs(r.rect.z - o.z) < 0.01) || (side === 's' && Math.abs(r.rect.z + r.rect.d - (o.z + o.d)) < 0.01) || (side === 'w' && Math.abs(r.rect.x - o.x) < 0.01) || (side === 'e' && Math.abs(r.rect.x + r.rect.w - (o.x + o.w)) < 0.01);
  const patient = (r: RoomDef) => /^f\d_room_/.test(r.id);
  const bank = elevatorBanks(layout)[0];

  // ── materials (shared with the ground floor through the material caches) ──
  const frameMat = lambert('#c4cbd0', { roughness: 0.38, metalness: 0.35 });
  const doorMat = pbr('wood', { color: '#e8d7bd', tile: 1.6, roughness: 0.7 });
  const kickMat = pbr('steel', { tile: 0.5, roughness: 0.9 });
  const baseMat = pbr('rubber', { color: '#5b6064', tile: 0.5, roughness: 0.8 });
  const glassMat = glass('#d6ecf2', 0.18);
  const paneMat = glass('#dcecf1', 0.1);
  const boardMat = lambert('#f1f1ee', { roughness: 0.3 });
  const revealMat = lambert('#eceeec', { roughness: 0.6 });

  // ── floors: sheet vinyl; bathrooms get a darker slip-resistant sheet ──
  for (const r of L.rooms) {
    const set = r.kind === 'office' ? 'floor_alt' : 'floor_vinyl';
    const mat = pbr(set, { color: tint(r.floor, r.kind === 'station' ? 0.1 : 0.45), tile: set === 'floor_alt' ? 0.75 : 1.0, roughness: 0.62, normalScale: 0.35 });
    // 6 mm above the slab: the ground floor's troffer frames reach 3 mm into it
    baseStatic.add(new THREE.Mesh(floorGeo(r.rect.x, r.rect.z, r.rect.w, r.rect.d, Y + (r.kind === 'station' ? 0.012 : 0.006)), mat));
  }
  const bathFloor = pbr('floor_vinyl', { color: '#9fb0b8', tile: 0.6, roughness: 0.75, normalScale: 0.5 });
  const bathrooms = new Map<string, Rect>();
  for (const r of L.rooms) {
    const ps = L.partitions.filter((p) => p.room === r.id);
    if (ps.length < 2) continue;
    const x0 = Math.min(...ps.flatMap((p) => [p.x1, p.x2]));
    const z0 = Math.min(...ps.flatMap((p) => [p.z1, p.z2]));
    const x1 = Math.max(...ps.flatMap((p) => [p.x1, p.x2]));
    const z1 = Math.max(...ps.flatMap((p) => [p.z1, p.z2]));
    // the partitions are two sides of the bathroom; the room's walls are the others
    const rect = { x: x0, z: z0, w: Math.min(x1, r.rect.x + r.rect.w) - x0, d: z1 - z0 };
    bathrooms.set(r.id, rect);
    baseStatic.add(new THREE.Mesh(floorGeo(rect.x + 0.05, rect.z + 0.05, rect.w - 0.05, rect.d - 0.05, Y + 0.009), bathFloor));
  }

  // ── wall runs: solid pieces between openings, a sill below windows and a lintel above ──
  const run = (
    sx: number,
    sz: number,
    dx: number,
    dz: number,
    nx: number,
    nz: number,
    len: number,
    thick: number,
    mat: THREE.Material,
    openings: Opening[],
    opts: { boundary?: boolean; bothSides?: boolean; centered?: boolean },
  ) => {
    const ox = opts.centered ? 0 : nx * (thick / 2);
    const oz = opts.centered ? 0 : nz * (thick / 2);
    const yaw = Math.atan2(dx, dz) - Math.PI / 2;
    const extra = opts.boundary ? 0.12 : 0;
    const piece = (a: number, b: number, y0: number, y1: number) => {
      const l = b - a;
      if (l < 0.02 || y1 - y0 < 0.01) return;
      const mid = (a + b) / 2;
      const cx = sx + dx * mid + ox;
      const cz = sz + dz * mid + oz;
      add(tallStatic, G.box(l, y1 - y0, thick), mat, cx, Y + (y0 + y1) / 2, cz, 0, yaw, 0);
      if (y0 < 0.01) {
        const lh = Math.min(LOW_H, y1);
        add(lowStatic, G.box(l, lh, thick), mat, cx, Y + lh / 2, cz, 0, yaw, 0);
        // rubber cove base; at a corner it stops 3 mm inside the wall it runs into (as the ground
        // floor's: reaching that wall's far face, the two flickered where a corridor looks on)
        const c0 = a < 1e-6 ? 0.003 : 0;
        const c1 = Math.abs(b - len) < 1e-6 ? 0.003 : 0;
        const bm = mid + (c0 - c1) / 2;
        const bx = sx + dx * bm + ox;
        const bz = sz + dz * bm + oz;
        for (const s of opts.bothSides ? [1, -1] : [1]) add(baseStatic, G.box(l - c0 - c1, 0.1, 0.012), baseMat, bx + s * nx * (thick / 2 + 0.006), Y + 0.05, bz + s * nz * (thick / 2 + 0.006), 0, yaw, 0);
      }
      // outer walls: the collider also covers the façade build-up outside (0.12 m)
      const hx = Math.abs(dx) * l / 2 + Math.abs(nx) * (thick / 2 + extra / 2);
      const hz = Math.abs(dz) * l / 2 + Math.abs(nz) * (thick / 2 + extra / 2);
      const ex = -nx * extra / 2;
      const ez = -nz * extra / 2;
      const box = new THREE.Box3(new THREE.Vector3(cx + ex - hx, Y + y0, cz + ez - hz), new THREE.Vector3(cx + ex + hx, Y + y1, cz + ez + hz));
      if (y0 < 0.01) out.colliders.push(box);
      out.occluders.push(box);
    };
    const ops = openings.slice().sort((p, q) => p.a - q.a);
    let cur = 0;
    for (const op of ops) {
      if (op.a > cur) piece(cur, op.a, 0, H);
      if (op.sill > 0) piece(op.a, op.b, 0, op.sill);
      piece(op.a, op.b, op.head, H);
      cur = Math.max(cur, op.b);
    }
    if (cur < len) piece(cur, len, 0, H);
    // camera: the whole wall line, openings included (keeps the 3rd-person camera in your room)
    {
      const cx = sx + dx * len / 2 + ox;
      const cz = sz + dz * len / 2 + oz;
      const hx = Math.abs(dx) * len / 2 + Math.abs(nx) * thick / 2;
      const hz = Math.abs(dz) * len / 2 + Math.abs(nz) * thick / 2;
      out.cameraBlockers.push(new THREE.Box3(new THREE.Vector3(cx - hx, Y, cz - hz), new THREE.Vector3(cx + hx, Y + H, cz + hz)));
    }
    // door frames + leaves, window boards and reveals
    for (const op of ops) {
      const w = op.b - op.a;
      const mid = (op.a + op.b) / 2;
      const cx = sx + dx * mid + ox;
      const cz = sz + dz * mid + oz;
      if (op.door && op.trim) {
        for (const e of [op.a, op.b]) {
          const tx = sx + dx * e + ox;
          const tz = sz + dz * e + oz;
          add(tallStatic, G.rbox(0.07, op.head, thick + 0.05, 0.012), frameMat, tx, Y + op.head / 2, tz, 0, yaw, 0);
          add(tallStatic, G.box(0.075, 1.2, thick + 0.06), kickMat, tx, Y + 0.6, tz, 0, yaw, 0);
        }
        add(tallStatic, G.rbox(w + 0.07, 0.07, thick + 0.05, 0.012), frameMat, cx, Y + op.head, cz, 0, yaw, 0);
        if (op.door.kind === 'door') {
          // leaf standing open against the room side (as on the ground floor)
          const lw = w - 0.04;
          const hingeT = op.a + 0.03;
          const hx = sx + dx * hingeT + ox + nx * (lw / 2 + 0.05);
          const hz = sz + dz * hingeT + oz + nz * (lw / 2 + 0.05);
          add(tallStatic, G.rbox(0.045, op.head - 0.05, lw, 0.01), doorMat, hx, Y + (op.head - 0.05) / 2, hz, 0, yaw, 0);
          add(tallStatic, G.box(0.05, 0.25, lw - 0.04), kickMat, hx, Y + 0.14, hz, 0, yaw, 0);
          add(tallStatic, G.box(0.05, 0.6, 0.12), glassMat, hx, Y + 1.45, hz, 0, yaw, 0);
        }
      }
      if (!op.door) {
        // window: interior board, reveal linings out to the façade's frame, and the pane (seen from
        // inside; from outside the façade's interior-mapped glass shows instead)
        const depth = thick + 0.16;
        // a point `off` m inward from the wall's outer face, at this opening's middle
        const rc = (off: number): [number, number] => [cx - nx * (thick / 2) + nx * off, cz - nz * (thick / 2) + nz * off];
        const [bx, bz] = rc(depth / 2 - 0.16);
        add(tallStatic, G.rbox(w + 0.06, 0.03, depth + 0.05, 0.008), boardMat, bx + nx * 0.025, Y + op.sill + 0.015, bz + nz * 0.025, 0, yaw, 0);
        add(tallStatic, G.box(w, 0.02, depth), revealMat, bx, Y + op.head - 0.01, bz, 0, yaw, 0);
        // side linings stand on the board and end inside the head lining (no shared faces)
        const j0 = op.sill + 0.02;
        const j1 = op.head - 0.005;
        for (const e of [op.a, op.b]) {
          const s = e === op.a ? 1 : -1;
          const jx = sx + dx * (e + s * 0.01) + ox - nx * (thick / 2) + nx * (depth / 2 - 0.16);
          const jz = sz + dz * (e + s * 0.01) + oz - nz * (thick / 2) + nz * (depth / 2 - 0.16);
          add(tallStatic, G.box(0.02, j1 - j0, depth), revealMat, jx, Y + (j0 + j1) / 2, jz, 0, yaw, 0);
        }
        // (flat, apart and all one material: merged into one draw)
        const [px, pz] = rc(-0.165);
        add(tallStatic, G.plane(w - 0.04, op.head - op.sill - 0.04), paneMat, px, Y + (op.sill + op.head) / 2, pz, 0, Math.atan2(nx, nz), 0);
      }
    }
  };

  // ── room walls ──
  for (const r of L.rooms) {
    const wallMat = pbr('wall_paint', { color: r.wall, tile: 1.6, roughness: 0.95, normalScale: 0.35 });
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      if (r.openSides?.includes(side)) continue;
      const f = sideFrame(r, side);
      const openings: Opening[] = [];
      for (const d of r.doors.filter((dd) => dd.side === side)) {
        // elevator entrances: the bank builds their frames and doors
        const cxDoor = side === 'n' || side === 's' ? r.rect.x + d.offset + d.width / 2 : NaN;
        const elev = !!bank && side === 'n' && Math.abs(r.rect.z - bank.wallZ) < 0.01 && bank.cars.some((c) => Math.abs(c.x - cxDoor) < 0.1);
        openings.push({ a: d.offset, b: d.offset + d.width, sill: 0, head: DOOR_H, trim: !elev, door: { kind: elev ? 'open' : d.kind } });
      }
      for (const w of L.windows.filter((ww) => ww.room === r.id && ww.side === side)) openings.push({ a: w.offset, b: w.offset + w.width, sill: SILL, head: HEAD, trim: false });
      run(f.sx, f.sz, f.dx, f.dz, f.nx, f.nz, f.len, WALL_T, wallMat, openings, { boundary: isBoundary(side, r) });
    }
  }

  // ── bathroom partitions (full height, a door from the entry) ──
  for (const p of L.partitions) partition(p);
  function partition(p0: PartitionDef) {
    const r = L.rooms.find((rr) => rr.id === p0.room)!;
    const wallMat = pbr('wall_paint', { color: '#eef2f2', tile: 1.6, roughness: 0.9, normalScale: 0.3 });
    // an end on the room's edge stops halfway into that wall (its end face buried, not on the wall's far face)
    const clip = (v: number, lo: number, hi: number) => Math.min(hi - WALL_T / 2, Math.max(lo + WALL_T / 2, v));
    const p = {
      ...p0,
      x2: clip(p0.x2, r.rect.x, r.rect.x + r.rect.w),
      z2: clip(p0.z2, r.rect.z, r.rect.z + r.rect.d),
    };
    const len = Math.hypot(p.x2 - p.x1, p.z2 - p.z1);
    const dx = (p.x2 - p.x1) / len;
    const dz = (p.z2 - p.z1) / len;
    // the bathroom is on the side of the line its rect lies
    const br = bathrooms.get(r.id);
    let nx = dz;
    let nz = -dx;
    if (br) {
      const mx = (p.x1 + p.x2) / 2 + nx * 0.3;
      const mz = (p.z1 + p.z2) / 2 + nz * 0.3;
      if (!inRect(br, mx, mz)) {
        nx = -nx;
        nz = -nz;
      }
    }
    // the doorway is an open gap (frames drawn); its leaf swings on a hinge from the entry side
    const openings: Opening[] = (p.doors ?? []).map((d) => ({ a: d.offset, b: d.offset + d.width, sill: 0, head: 2.1, trim: true, door: { kind: 'open' } }));
    run(p.x1, p.z1, dx, dz, nx, nz, len, PART_T, wallMat, openings, { bothSides: true, centered: true });
    // (the bathroom is on the (nx, nz) side, so the leaf swings the other way, into the room)
    for (const d of p.doors ?? []) {
      const at = d.offset + 0.03;
      out.swingDoors.push(
        buildSwingLeaf({
          key: `door:${r.id}:bath`,
          parent: tall,
          lowParent: low,
          targets: { colliders: out.colliders, interactables: out.interactables },
          level: L.index,
          hinge: { x: p.x1 + dx * at, z: p.z1 + dz * at },
          along: { x: dx, z: dz },
          into: { x: -nx, z: -nz },
          leaf: d.width - 0.04,
          height: 2.05,
          y0: Y,
          paint: '#e8d7bd',
        }),
      );
    }
  }

  // ── ceilings: acoustic tile + LED troffers; patient rooms switch off at night ──
  const tileTex = ceilingTileTexture();
  const ceilMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tileTex, roughness: 0.96 }));
  ceilMat.userData.worldUV = 0.6;
  const trofferFrame = lambert('#f1f2ef', { roughness: 0.35, metalness: 0.1 });
  const diffuser = emitter('#fff3e2', 3.2);
  const CH = Y + H;
  /** ceiling fittings' footprints (half extents), so a smoke detector finds a bare tile */
  const fittings: { x: number; z: number; hx: number; hz: number }[] = [];
  const troffer = (r: RoomDef, px: number, pz: number, along: number, diff: THREE.Material, small = false) => {
    const [w, d] = small ? [0.62, 0.62] : [0.62, 1.22];
    const across = Math.abs(Math.sin(along)) > 0.5;
    fittings.push({ x: px, z: pz, hx: (across ? d : w) / 2, hz: (across ? w : d) / 2 });
    add(tallStatic, G.box(w, 0.03, d), trofferFrame, px, CH - 0.012, pz, 0, along, 0);
    add(tallStatic, G.box(w - 0.06, 0.012, d - 0.06), diff, px, CH - 0.03, pz, 0, along, 0);
    out.fixtures.push({ x: px, y: CH - 0.05, z: pz, room: r.id, kind: 'troffer', level: L.index });
  };
  for (const r of L.rooms) {
    tallStatic.add(new THREE.Mesh(floorGeo(r.rect.x, r.rect.z, r.rect.w, r.rect.d, CH, true), ceilMat));
    let diff: THREE.Material = diffuser;
    if (patient(r)) {
      const own_ = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3e2', emissiveIntensity: 3.2, roughness: 0.9 }));
      out.roomHours.push({ room: r.id, hours: PATIENT_HOURS, mats: [own_], base: 3.2 });
      diff = own_;
      // over the bed, in the window zone, the bathroom and the entry (not across the bathroom wall)
      const bed = r.spots.bed;
      const win = r.spots.sofa;
      const br = bathrooms.get(r.id);
      const along = Math.PI / 2;
      if (bed) troffer(r, r.rect.x + 1.75, bed.z, along, diff);
      if (win) troffer(r, r.rect.x + 2.0, win.z + ((bed?.z ?? win.z) - win.z) * 0.25, along, diff);
      if (br) troffer(r, br.x + br.w / 2, br.z + br.d / 2, 0, diff, true);
      if (br) troffer(r, r.rect.x + 1.05, br.z + br.d / 2, 0, diff, true);
      continue;
    }
    const nx = Math.max(1, Math.round(r.rect.w / 3.2));
    const nz = Math.max(1, Math.round(r.rect.d / 3.4));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const px = Math.round((r.rect.x + ((i + 0.5) * r.rect.w) / nx) / 0.6) * 0.6;
        const pz = Math.round((r.rect.z + ((j + 0.5) * r.rect.d) / nz) / 0.6) * 0.6 + 0.3;
        troffer(r, px, pz, r.rect.d > r.rect.w ? 0 : Math.PI / 2, diff);
      }
  }
  // as downstairs: a smoke detector per room, sprinklers on a grid, 60 × 60 supply diffusers
  const white = lambert('#f4f5f3', { roughness: 0.5 });
  const chrome = lambert('#d9dde0', { roughness: 0.16, metalness: 1 });
  const grille = lambert('#e6e8e8', { roughness: 0.6, metalness: 0.2 });
  const louvre = lambert('#cfd3d4', { roughness: 0.6 });
  for (const r of L.rooms) {
    const cx = r.rect.x + r.rect.w / 2;
    const cz = r.rect.z + r.rect.d / 2;
    const nx = Math.max(1, Math.round(r.rect.w / 3.6));
    const nz = Math.max(1, Math.round(r.rect.d / 3.6));
    const bath = bathrooms.get(r.id);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const sx = r.rect.x + ((i + 0.5) * r.rect.w) / nx + 0.45;
        const sz = r.rect.z + ((j + 0.5) * r.rect.d) / nz - 0.95;
        add(tallStatic, G.cyl(0.012, 0.03, 0.05, 10), chrome, sx, CH - 0.03, sz);
        fittings.push({ x: sx, z: sz, hx: 0.03, hz: 0.03 });
        const dx = sx - 0.95;
        const dz = sz + 0.6;
        if ((i + j) % 2 === 0 && !(bath && dx > bath.x - 0.4 && dx < bath.x + bath.w + 0.4 && dz > bath.z - 0.4 && dz < bath.z + bath.d + 0.4)) {
          add(tallStatic, G.box(0.58, 0.02, 0.58), grille, dx, CH - 0.012, dz);
          for (const s of [0.42, 0.28, 0.14]) add(tallStatic, G.box(s, 0.012, s), louvre, dx, CH - 0.025, dz);
          fittings.push({ x: dx, z: dz, hx: 0.29, hz: 0.29 });
        }
      }
    // the smoke detector on a bare tile near the middle, clear of the lights and diffusers
    const bare = (x: number, z: number) =>
      x > r.rect.x + 0.4 && x < r.rect.x + r.rect.w - 0.4 && z > r.rect.z + 0.4 && z < r.rect.z + r.rect.d - 0.4 &&
      fittings.every((f) => Math.abs(x - f.x) > f.hx + 0.2 || Math.abs(z - f.z) > f.hz + 0.2);
    const spots: [number, number][] = [[0.6, -0.6], [-0.6, 0.6], [0.6, 0.6], [-0.6, -0.6], [0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.9, -1.5], [-0.9, 1.5]];
    const [ox, oz] = spots.find(([a, b]) => bare(cx + a, cz + b)) ?? spots[0];
    add(tallStatic, G.cyl(0.07, 0.075, 0.035, 20), white, cx + ox, CH - 0.018, cz + oz);
    // status LED 2.5 mm under the detector (as downstairs: 0.5 mm flickered)
    add(tallStatic, G.circle(0.012, 10), emitter('#ff3b30', 1.5), cx + ox, CH - 0.038, cz + oz, Math.PI / 2, 0, 0);
  }

  // ── room signs (printed acrylic over the door) and floor labels for the cutaway ──
  for (const r of L.rooms) {
    if (!r.sign) continue;
    const side = r.signSide ?? 's';
    const f = sideFrame(r, side);
    const door = r.doors.find((dd) => dd.side === side);
    const t = door ? door.offset + door.width / 2 : f.len / 2;
    const px = f.sx + f.dx * t - f.nx * 0.016;
    const pz = f.sz + f.dz * t - f.nz * 0.016;
    // (narrower than downstairs: two doors share the corridor wall 2 m apart)
    const wPlate = Math.min(1.7, Math.max(0.9, 0.12 * r.sign.length + 0.3));
    const canvas = textCanvas(r.sign, { w: 512, h: Math.round((512 * 0.3) / wPlate), bg: '#0f4c5c', fg: '#ffffff', border: '#e8f3f1' });
    const mat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.35 }));
    add(tall, G.rbox(wPlate, 0.3, 0.02, 0.008), mat, px, Y + 2.62, pz, 0, Math.atan2(-f.nx, -f.nz), 0).userData.noMerge = true;
    if (r.kind !== 'corridor') {
      const lc = textCanvas(r.label.toUpperCase(), { w: 512, h: 128, bg: 'rgba(0,0,0,0)', fg: 'rgba(15,76,92,0.55)' });
      const lm = own(new THREE.MeshBasicMaterial({ map: canvasTexture(lc), transparent: true, depthWrite: false }));
      const lw = Math.min(r.rect.w * 0.9, 3.6);
      add(low, G.plane(lw, lw / 4), lm, r.rect.x + r.rect.w / 2, Y + 0.03, r.rect.z + r.rect.d / 2, -Math.PI / 2, 0, 0).userData.noMerge = true;
    }
  }

  // ── props ──
  const roomKind = new Map(L.rooms.map((r) => [r.id, r.kind]));
  const blackScreen = own(new THREE.MeshStandardMaterial({ color: '#07090b', roughness: 0.12, metalness: 0.2 }));
  const wardBoard = new WardBoard();
  out.board = wardBoard;
  for (const p of L.props) {
    const built = buildProp(p);
    const g = built.group;
    g.position.set(p.x, Y + (p.y ?? 0), p.z);
    g.rotation.y = p.rot ?? 0;
    const hanging = TALL_PROPS.has(p.kind) || (p.y ?? 0) > 0.9;
    (hanging ? tallStatic : baseStatic).add(g);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    for (const s of built.screens) {
      // patients' TVs are off at night; the rest get their screen from the world (floors.ts)
      if (s.kind === 'tv') s.mesh.material = blackScreen;
      out.screens.push({ mesh: s.mesh, kind: s.kind, prop: p });
    }
    if (p.solid) {
      const cb = box.clone();
      cb.min.y = Y;
      out.colliders.push(cb);
    }
    const sh = surfaceHeight(p.kind);
    if (sh !== undefined) out.surfaces.push({ box: box.clone(), y: Y + sh });
    const se = seatHeight(p.kind);
    if (se !== undefined) {
      const desk = p.kind === 'chair' && (roomKind.get(p.room) === 'station' || /desk/.test(p.id));
      // (a sofa's seat is in front of its back cushions: props.ts, amenities.ts SOFA)
      const fwd = p.kind === 'sofa' ? 0.045 : 0;
      out.seats.push({ x: p.x + Math.sin(p.rot ?? 0) * fwd, z: p.z + Math.cos(p.rot ?? 0) * fwd, y: Y + se, rot: p.rot ?? 0, kind: p.kind === 'sofa' ? 'sofa' : desk ? 'desk' : 'chair' });
    }
    if (INSPECTABLE.has(p.kind)) {
      const ib = box.clone().expandByScalar(0.04);
      // an accessible toilet's emergency cord hangs from the ceiling: its box would fill the washroom
      // to the ceiling and hide the basin beside it, so it ends just above the grab bars
      if (p.kind === 'toilet') ib.max.y = Math.min(ib.max.y, Y + 1.15);
      const info = FIXTURE_INFO[p.kind];
      out.interactables.push({ key: `fx:${p.id}`, target: { kind: 'inspect', subject: p.kind, label: `Inspect ${info?.title.toLowerCase() ?? p.kind}` }, box: ib, center: ib.getCenter(new THREE.Vector3()), level: L.index });
    }
  }

  // ── patient rooms: headwall (gas, suction, outlets, nurse call, reading light), bedside cabinet,
  //    a night light by the door ──
  for (const r of L.rooms) {
    if (!patient(r)) continue;
    const bed = r.spots.bed;
    if (!bed) continue;
    const hours = out.roomHours.find((h) => h.room === r.id);
    headwall(tallStatic, r.rect.x + WALL_T, Y, bed.z, hours?.mats[0] ?? diffuser);
    const tb = bedsideTable();
    const tz = bed.z + (r.spots.entry && r.spots.entry.z > bed.z ? 0.95 : -0.95) * 0.98;
    tb.position.set(r.rect.x + 0.42, Y, tz);
    tb.rotation.y = Math.PI / 2;
    baseStatic.add(tb);
    tb.updateMatrixWorld(true);
    const tbBox = new THREE.Box3().setFromObject(tb);
    out.colliders.push(tbBox);
    out.interactables.push({ key: `fx:${r.id}_table`, target: { kind: 'inspect', subject: 'bedsideTable', label: 'Inspect bedside table' }, box: tbBox.clone().expandByScalar(0.04), center: tbBox.getCenter(new THREE.Vector3()), level: L.index });
    // amber night light at 0.35 m by the door, and the dim pool of light it gives the floor
    const e = r.spots.entry!;
    const nlMat = own(new THREE.MeshStandardMaterial({ color: '#f6efe2', emissive: '#ffb45a', emissiveIntensity: 0, roughness: 0.4 }));
    const wallX = r.rect.x + WALL_T + 0.012;
    add(tallStatic, G.rbox(0.025, 0.07, 0.12, 0.008), lambert('#eef0ee', { roughness: 0.4 }), wallX, Y + 0.35, e.z, 0, 0, 0);
    // lens 3 mm proud of the housing's face (1.5 mm flickered)
    add(tall, G.plane(0.1, 0.045), nlMat, wallX + 0.0155, Y + 0.35, e.z, 0, Math.PI / 2, 0).userData.noMerge = true;
    const nl = new THREE.PointLight('#ffb766', 0, 3.2, 2);
    nl.position.set(wallX + 0.25, Y + 0.32, e.z);
    out.nightLights.push({ light: nl, mat: nlMat, room: r.id });
  }

  // ── station: the ward's tracking-board screen and a clock on the back wall; lobby: EXIT over Stair 1's door ──
  const station = L.rooms.find((r) => r.kind === 'station');
  if (station) {
    const bz = station.rect.z + station.rect.d - WALL_T;
    const bx = station.rect.x + 2.3;
    // a 2 m LCD on a wall bracket, like the ED's tracking board (unlit material: it glows)
    add(tallStatic, G.rbox(2.08, 0.98, 0.06, 0.012), lambert('#16191b', { roughness: 0.32 }), bx, Y + 1.72, bz - 0.04);
    const screen = add(tall, G.plane(2.0, 0.9), wardBoard.material, bx, Y + 1.72, bz - 0.0715, 0, Math.PI, 0);
    screen.userData.noMerge = true;
    const clock = wallClock(out.clocks);
    clock.position.set(station.rect.x + 0.75, Y + 2.38, bz - 0.03);
    clock.rotation.y = Math.PI;
    tall.add(clock);
  }
  const lobby = L.rooms.find((r) => r.doors.some((d) => d.side === 'w' && d.kind === 'open'));
  const stairDoor = lobby?.doors.find((d) => d.side === 'w');
  if (lobby && stairDoor) {
    const ex = exitSign();
    ex.position.set(lobby.rect.x + WALL_T + 0.035, Y + 2.38, lobby.rect.z + stairDoor.offset + stairDoor.width / 2);
    ex.rotation.y = Math.PI / 2;
    tall.add(ex);
  }

  // ── the storey's outside: façade skin with see-through windows, parapet, roof ──
  const shellRaw = new THREE.Group();
  const glows: { value: number }[] = [];
  const top = H + 0.95;
  const W0 = o.x;
  const W1 = o.x + o.w;
  const Z0 = o.z;
  const Z1 = o.z + o.d;
  const sides: { key: string; side: Side; O: THREE.Vector3; T: THREE.Vector3; N: THREE.Vector3; len: number; outer: boolean }[] = [
    { key: 'S2', side: 's', O: new THREE.Vector3(W0, Y, Z1), T: new THREE.Vector3(1, 0, 0), N: new THREE.Vector3(0, 0, 1), len: o.w, outer: Math.abs(Z1 - layout.depth) < 0.01 },
    { key: 'E2', side: 'e', O: new THREE.Vector3(W1, Y, Z1), T: new THREE.Vector3(0, 0, -1), N: new THREE.Vector3(1, 0, 0), len: o.d, outer: Math.abs(W1 - layout.width) < 0.01 },
    { key: 'W2', side: 'w', O: new THREE.Vector3(W0, Y, Z0), T: new THREE.Vector3(0, 0, 1), N: new THREE.Vector3(-1, 0, 0), len: o.d, outer: Math.abs(W0) < 0.01 },
    { key: 'N2', side: 'n', O: new THREE.Vector3(W1, Y, Z0), T: new THREE.Vector3(-1, 0, 0), N: new THREE.Vector3(0, 0, -1), len: o.w, outer: Math.abs(Z0) < 0.01 },
  ];
  for (const s of sides) {
    const U = (x: number, z: number) => (x - s.O.x) * s.T.x + (z - s.O.z) * s.T.z;
    const line: FacadeLine = { O: s.O, T: s.T, N: s.N, len: s.len, doors: [], holes: [], windows: [] };
    for (const w of L.windows) {
      if (w.side !== s.side) continue;
      const r = L.rooms.find((rr) => rr.id === w.room);
      if (!r || !isBoundary(w.side, r)) continue;
      const alongX = s.side === 'n' || s.side === 's';
      const a = alongX ? U(r.rect.x + w.offset, 0) : U(0, r.rect.z + w.offset);
      const b = alongX ? U(r.rect.x + w.offset + w.width, 0) : U(0, r.rect.z + w.offset + w.width);
      line.windows.push([Math.min(a, b), Math.max(a, b)]);
    }
    const cut: [number, number][] = [];
    if (bank && s.side === 'n' && Math.abs(bank.wallZ - Z0) < 0.01) {
      const sh = shaftExtent(bank);
      cut.push([Math.min(U(sh.x0, 0), U(sh.x1, 0)), Math.max(U(sh.x0, 0), U(sh.x1, 0))]);
    }
    // a side rising from the roof stops inside the ground floor's skin where it turns onto an outer
    // wall (that skin runs on up to +0.95 there; wrapping the corner, the two shared a face)
    if (!s.outer) {
      // the sides met at u = 0 and at u = len
      const [atStart, atEnd] = ({ S2: ['W2', 'E2'], E2: ['S2', 'N2'], W2: ['N2', 'S2'], N2: ['E2', 'W2'] } as Record<string, [string, string]>)[s.key];
      const outer = (k: string) => sides.find((x) => x.key === k)!.outer;
      if (outer(atStart)) cut.push([-0.3, -0.2]);
      if (outer(atEnd)) cut.push([s.len + 0.2, s.len + 0.3]);
    }
    if (cut.length) line.cut = cut;
    const seed = s.key.charCodeAt(0) * 7 + 2;
    const gl = interiorGlass(s.N, s.T, { depth: 4.2, cell: 3.6, H, y0: SILL, y1: HEAD, seed, floor: Y });
    glows.push(gl.glow);
    // outer walls continue the ground floor's skin (it ends at +0.95); others rise from the roof
    facadeSkin(shellRaw, line, gl.mat, top, seed * 13, { from: s.outer ? 0.95 : 0.27, see: true });
  }
  // parapet behind the coping, and the roof (open over a stair core that has its own)
  const par = pbr('concrete', { color: '#b9b6ae', tile: 3, roughness: 0.95 });
  const ph = top - H - 0.27;
  const py = Y + (top + H + 0.27) / 2;
  add(shellRaw, G.box(o.w + 0.3, ph, 0.22), par, W0 + o.w / 2, py, Z1 - 0.05);
  add(shellRaw, G.box(o.w + 0.3, ph, 0.22), par, W0 + o.w / 2, py, Z0 + 0.05);
  add(shellRaw, G.box(0.22, ph, o.d), par, W0 + 0.05, py, Z0 + o.d / 2);
  add(shellRaw, G.box(0.22, ph, o.d), par, W1 - 0.05, py, Z0 + o.d / 2);
  const roofMat = pbr('concrete', { color: '#8f9396', tile: 4 });
  roofMat.userData.tag = 'night';
  for (const pc of subtractRects({ x: W0 - 0.12, z: Z0 - 0.12, w: o.w + 0.24, d: o.d + 0.24 }, L.holes)) add(shellRaw, G.box(pc.w, 0.22, pc.d), roofMat, pc.x + pc.w / 2, Y + H + 0.16, pc.z + pc.d / 2);
  // a few vent stacks and an exhaust fan on the ward roof
  const vent = lambert('#c9c8c2', { roughness: 0.5, metalness: 0.4 });
  for (const [vx, vz] of [[60.5, 6.5], [66.2, 13.4], [70.1, 4.2]] as [number, number][]) {
    add(shellRaw, G.cyl(0.06, 0.06, 0.7, 10), vent, vx, Y + H + 0.62, vz);
    add(shellRaw, G.cyl(0.09, 0.09, 0.05, 10), vent, vx, Y + H + 0.98, vz);
  }
  add(shellRaw, G.cyl(0.36, 0.4, 0.5, 18), vent, 62.5, Y + H + 0.52, 15.2);
  add(shellRaw, G.cone(0.5, 0.26, 18), vent, 62.5, Y + H + 0.9, 15.2);
  shell.add(mergeByMaterial(shellRaw, { castShadow: true }));
  out.setNight = (night: boolean) => {
    for (const gv of glows) gv.value = night ? 1.0 : 0.8;
  };

  mergeInto(baseStatic);
  mergeInto(tallStatic);
  mergeInto(lowStatic);
  for (const grp of [base, tall, low])
    grp.traverse((ob) => {
      const m = ob as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      m.castShadow = !!m.userData.castShadow;
    });
  return out;
}

/** the headwall service panel over a bed whose head is against a west wall (x = face) */
function headwall(g: THREE.Group, face: number, Y: number, z: number, lamp: THREE.Material) {
  const alu = lambert('#b9bfc4', { roughness: 0.35, metalness: 0.85 });
  const white = lambert('#f2f3f1', { roughness: 0.4 });
  // horizontal trunking with the services, 1.6 m wide at 1.15–1.45 m
  add(g, G.rbox(0.05, 0.3, 1.9, 0.012), white, face + 0.025, Y + 1.3, z, 0, 0, 0);
  add(g, G.box(0.052, 0.02, 1.9), alu, face + 0.026, Y + 1.155, z);
  add(g, G.box(0.052, 0.02, 1.9), alu, face + 0.026, Y + 1.445, z);
  // medical gas outlets: oxygen (green), air (yellow / black), vacuum (white)
  const gas: [string, number][] = [['#2f8f46', -0.62], ['#f0c419', -0.48], ['#f2f2f2', -0.34]];
  for (const [c, dz] of gas) {
    add(g, G.rbox(0.03, 0.11, 0.09, 0.01), lambert('#e8ebec', { roughness: 0.4 }), face + 0.065, Y + 1.32, z + dz);
    add(g, G.cyl(0.022, 0.022, 0.03, 12), lambert(c, { roughness: 0.4 }), face + 0.09, Y + 1.32, z + dz, 0, 0, Math.PI / 2);
  }
  // O2 flowmeter + suction regulator with its canister
  add(g, G.cyl(0.025, 0.025, 0.16, 12), lambert('#dfe6e2', { roughness: 0.2 }), face + 0.12, Y + 1.38, z - 0.78);
  add(g, G.cyl(0.07, 0.07, 0.2, 18), glass('#e9f3f6', 0.45), face + 0.1, Y + 1.0, z - 0.95).userData.noMerge = true;
  // power: white + red (essential supply) outlets, nurse-call socket
  for (const [dz, c] of [[0.3, '#f4f4f2'], [0.42, '#f4f4f2'], [0.58, '#c8302c'], [0.7, '#c8302c']] as [number, string][]) add(g, G.rbox(0.012, 0.1, 0.07, 0.004), lambert(c, { roughness: 0.4 }), face + 0.056, Y + 1.3, z + dz);
  add(g, G.rbox(0.03, 0.12, 0.1, 0.012), lambert('#e7e9ea', { roughness: 0.4 }), face + 0.065, Y + 1.31, z + 0.86);
  add(g, G.cyl(0.02, 0.02, 0.012, 14), lambert('#d03a2f', { emissive: '#d03a2f', emissiveIntensity: 0.25 }), face + 0.083, Y + 1.31, z + 0.86, 0, 0, Math.PI / 2);
  // nurse-call handset on its cord, hanging over the side rail
  add(g, G.rbox(0.05, 0.16, 0.06, 0.02), lambert('#e9ecee', { roughness: 0.4 }), face + 0.62, Y + 0.84, z + 0.52, 0.2, 0, 0);
  // over-bed reading / exam light (switches with the room lights)
  add(g, G.rbox(0.09, 0.07, 1.2, 0.02), white, face + 0.045, Y + 2.05, z, 0, 0, 0);
  add(g, G.box(0.06, 0.012, 1.1), lamp, face + 0.05, Y + 2.012, z);
}

/**
 * The ward's tracking board (the ED board's look: dark, teal title bar, a clock): who is in which
 * room, why, their nurse and what the night needs. Initials only, as on a real corridor-facing board.
 */
export class WardBoard {
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private shown = '';
  constructor() {
    const { canvas, ctx } = makeCanvas(1280, 576);
    this.ctx = ctx;
    this.tex = canvasTexture(canvas);
    this.material = own(new THREE.MeshBasicMaterial({ map: this.tex }));
    // as bright as the ED's screens (World boosts those the same way)
    this.material.color.setScalar(1.55);
    this.draw('--:--');
  }

  update(hhmm: string) {
    if (hhmm !== this.shown) this.draw(hhmm);
  }

  private draw(hhmm: string) {
    this.shown = hhmm;
    const c = this.ctx;
    const W = 1280;
    const H = 576;
    c.fillStyle = '#0b1b26';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#0f6e6e';
    c.fillRect(0, 0, W, 58);
    c.fillStyle = '#ffffff';
    c.font = '700 30px ui-sans-serif, system-ui, sans-serif';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillText('Grand Therapies MC — Ward 2 East', 22, 40);
    c.font = '700 32px ui-monospace, Menlo, monospace';
    c.textAlign = 'right';
    c.fillText(hhmm, W - 22, 41);
    c.textAlign = 'left';
    const cols = [22, 120, 300, 380, 820, 940];
    c.fillStyle = '#7fa4b5';
    c.font = '700 19px ui-sans-serif, system-ui, sans-serif';
    ['ROOM', 'PATIENT', 'AGE', 'ADMITTED FOR', 'RN', 'ALERTS'].forEach((h, i) => c.fillText(h, cols[i], 92));
    const rows: [string, string, string, string, string, string, string][] = [
      ['201', 'M.K.', '78 F', 'Community-acquired pneumonia', 'Ana', 'Falls risk', '#e0a10b'],
      ['202', 'R.D.', '64 M', 'Heart failure, decompensated', 'Ana', 'Strict I/O · AM wt', '#7fa4b5'],
      ['203', '—', '', 'Clean · ready for admission', '', '', ''],
      ['204', 'J.T.', '55 M', 'Cellulitis, left leg', 'Theo', 'IV cefazolin 06:00', '#7fa4b5'],
      ['205', 'E.W.', '83 F', 'Hip fracture, post-op day 1', 'Theo', 'Delirium screen', '#e8590c'],
      ['206', '—', '', 'Clean · ready for admission', '', '', ''],
    ];
    const rowH = 64;
    rows.forEach((r, i) => {
      const y = 108 + i * rowH;
      if (i % 2 === 0) {
        c.fillStyle = 'rgba(255,255,255,0.04)';
        c.fillRect(0, y, W, rowH);
      }
      const mid = y + rowH / 2 + 9;
      const empty = r[1] === '—';
      c.fillStyle = '#ffffff';
      c.font = '700 26px ui-sans-serif, system-ui, sans-serif';
      c.fillText(r[0], cols[0], mid);
      c.fillStyle = empty ? '#5f7f8c' : '#e8f1f4';
      c.font = '600 25px ui-sans-serif, system-ui, sans-serif';
      c.fillText(r[1], cols[1], mid);
      c.fillText(r[2], cols[2], mid);
      c.fillText(r[3], cols[3], mid);
      c.fillStyle = '#9fd3c7';
      c.fillText(r[4], cols[4], mid);
      if (r[5]) {
        c.fillStyle = r[6];
        c.fillRect(cols[5], y + 18, 8, rowH - 36);
        c.fillStyle = '#e8f1f4';
        c.font = '600 22px ui-sans-serif, system-ui, sans-serif';
        c.fillText(r[5], cols[5] + 18, mid - 1);
      }
    });
    c.fillStyle = '#0f6e6e';
    c.fillRect(0, H - 50, W, 50);
    c.fillStyle = '#ffffff';
    c.font = '600 21px ui-sans-serif, system-ui, sans-serif';
    c.fillText('Charge RN Ana Lima · ext 2240      Rapid response 2222      Census 4 / 6', 22, H - 18);
    this.tex.needsUpdate = true;
  }
}

/** `outer` minus the `holes`, as non-overlapping rectangles */
function subtractRects(outer: Rect, holes: Rect[]): Rect[] {
  if (!holes.length) return [outer];
  const cuts = (lo: number, hi: number, vals: number[]) => [...new Set([lo, hi, ...vals.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = cuts(outer.x, outer.x + outer.w, holes.flatMap((h) => [h.x, h.x + h.w]));
  const zs = cuts(outer.z, outer.z + outer.d, holes.flatMap((h) => [h.z, h.z + h.d]));
  const res: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (!holes.some((h) => cx > h.x && cx < h.x + h.w && cz > h.z && cz < h.z + h.d)) res.push({ x: xs[i], z: zs[j], w: xs[i + 1] - xs[i], d: zs[j + 1] - zs[j] });
    }
  return res;
}


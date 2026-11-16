/**
 * The hospital's outside, built from the layout at runtime (building size, exterior rect, the
 * exterior doors, the ambulance / lamp / parking props), so it adapts when the plan changes:
 *
 *   ground    one wet-able PBR ground (asphalt + broom-finished concrete) with a painted
 *             markings canvas (worn stall lines, AMBULANCE ONLY, hatching, crack sealant) and a
 *             data canvas (puddles, oil stains, contact shadows, concrete mask); a street beyond.
 *   site      raised planting islands with curbs, lawn, mulch, trees and shrubs (leaf cards from
 *             a CC0 leaf atlas), bollards, benches, bins, a bike rack, manholes and drains,
 *             monument + wayfinding signs, parked cars.
 *   building  metal-panel cladding with real reveals over a brick base, punched windows whose
 *             glass shows parallax "interior-mapped" lit rooms, parapet coping, the ambulance
 *             canopy (columns with guards, fascia, LED soffit), rooftop units seen over the parapet.
 *   beyond    the street, and the town around the lot from surroundings.ts (campus fence, hospital
 *             tower, garage, offices and apartments, the river and its far bank, a skyline).
 *
 * Outdoor materials are flagged (vehicles.ts `outdoor`) so the lighting rig gives them the
 * exterior reflection probe; lights are returned as specs for the rig (LED area lights, canopy
 * downlights, wall packs, sign glow). Static geometry is merged by material here, so the parts
 * that should cast sun shadows keep that flag.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial, Node, PMREMGenerator, type NodeBuilder, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, asin, atan, cameraPosition, lights as lightsNode, clamp, dot, float, floor, fract, max, min, mix, normalMap, normalWorld, normalWorldGeometry, pmremTexture, positionWorld, pow, select, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { resUrl } from '../resCache';
import { tune } from './render/renderer';
import type { LayoutDef, PropDef, RoomDef } from '../../../shared/layout';
import { elevatorBanks, shaftExtent, upperOutlines } from '../../../shared/floors';
import { G, add, canvasTexture, makeCanvas, own, pbr, texMap, trackGeo } from './materials';
import { buildAmbulance, buildCar, mergeByMaterial, outdoor, solid } from './vehicles';
import { buildSurroundings, riverPlan, skylineBand } from './surroundings';

/** a light the rig creates for the outside (on at night unless `always`) */
export interface ExtLight {
  kind: 'spot' | 'point';
  pos: THREE.Vector3;
  /** spot lights aim here */
  target?: THREE.Vector3;
  color: string;
  /** candela */
  intensity: number;
  distance: number;
  angle?: number;
  penumbra?: number;
  /** also on by day (canopy downlights under the roof) */
  always?: boolean;
}

export interface ExteriorBuilt {
  colliders: THREE.Box3[];
  lights: ExtLight[];
  /** the ground material (kept for BuiltWorld.night.groundMat) */
  groundMat: THREE.MeshStandardMaterial;
  /** reflection probe: capture point + the box its reflections are projected onto */
  probe: { pos: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3 };
  /** hidden while the probe captures (vehicles would reflect themselves) */
  hideForProbe: THREE.Object3D[];
  /** day/night look of the materials that care (wetness, window glow, sign panels) */
  setNight(night: boolean): void;
  /** sun-shadow blockers (layer 1: only the sun's shadow camera sees them) */
  sunBlockers: THREE.Object3D;
  /** building footprint (x 0..w, z 0..d) */
  footprint: { w: number; d: number };
}

/** where things are, derived from the layout */
export interface Plan {
  W: number;
  D: number;
  H: number;
  /** façade plane (outer face of the cladding) */
  F: number;
  ext: { x: number; z: number; w: number; d: number };
  lotX0: number;
  lotX1: number;
  /** far edge of the parking lot (walkable limit) */
  lotZ1: number;
  sidewalkZ1: number;
  stripZ0: number;
  stripZ1: number;
  stallZ0: number;
  stallZ1: number;
  aisleZ1: number;
  /** perimeter planting strip + public sidewalk + street */
  perimZ1: number;
  streetZ0: number;
  streetZ1: number;
  doors: { x0: number; x1: number; room: RoomDef }[];
  ems: { x0: number; x1: number; cx: number };
  walkin: { cx: number } | null;
  clinic: { cx: number } | null;
  ambulance: PropDef | null;
  emsSign: PropDef | null;
  lamps: PropDef[];
  canopies: PropDef[];
  /** 3 m stall grid origin (aligned with the layout's parking props) */
  gridX: number;
  /** x ranges kept free of stalls / planting */
  apron: [number, number];
  dropoff: [number, number];
  clinicPlaza: [number, number];
  driveways: [number, number][];
  crossings: number[];
}

export function lotPlan(layout: LayoutDef): Plan {
  const W = layout.width;
  const D = layout.depth;
  const H = layout.wallHeight;
  const ext = layout.exterior.rect;
  const F = D + 0.22;
  const doors: Plan['doors'] = [];
  for (const r of layout.rooms)
    for (const d of r.doors)
      if (d.exterior && d.side === 's' && Math.abs(r.rect.z + r.rect.d - D) < 0.01) doors.push({ x0: r.rect.x + d.offset, x1: r.rect.x + d.offset + d.width, room: r });
  const ambulance = layout.props.find((p) => p.kind === 'ambulance') ?? null;
  // the ambulance entrance: the exterior door nearest the ambulance (or the 'ems' room's)
  const ax = ambulance?.x ?? W * 0.58;
  const emsDoor = doors.slice().sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - ax) - Math.abs((b.x0 + b.x1) / 2 - ax))[0];
  const ems = emsDoor ? { x0: emsDoor.x0, x1: emsDoor.x1, cx: (emsDoor.x0 + emsDoor.x1) / 2 } : { x0: ax - 1.6, x1: ax + 1.6, cx: ax };
  const others = doors.filter((d) => d !== emsDoor);
  const walk = others.find((d) => d.room.kind === 'waiting') ?? null;
  const clin = others.find((d) => d !== walk) ?? null;
  const parking = layout.props.filter((p) => p.kind === 'parking');
  const stallMid = parking.length ? parking[0].z : F + 7.3;
  const stallZ0 = stallMid - 2.3;
  const stallZ1 = stallMid + 2.3;
  const lotZ1 = ext.z + ext.d;
  const plain = parking.find((p) => p.label !== 'accessible');
  const gridX = plain ? plain.x - (plain.w ?? 12) / 2 : ems.cx + 26;
  const walkX = walk ? (walk.x0 + walk.x1) / 2 : null;
  const clinX = clin ? (clin.x0 + clin.x1) / 2 : null;
  return {
    W,
    D,
    H,
    F,
    ext,
    lotX0: ext.x,
    lotX1: ext.x + ext.w,
    lotZ1,
    sidewalkZ1: F + 2.25,
    stripZ0: F + 2.45,
    stripZ1: stallZ0 - 0.25,
    stallZ0,
    stallZ1,
    aisleZ1: lotZ1 - 1.4,
    perimZ1: lotZ1 + 2.2,
    streetZ0: lotZ1 + 4.2,
    streetZ1: lotZ1 + 14.2,
    doors,
    ems,
    walkin: walkX === null ? null : { cx: walkX },
    clinic: clinX === null ? null : { cx: clinX },
    ambulance,
    emsSign: layout.props.find((p) => p.kind === 'sign' && Math.abs(p.x - ems.cx) < 4) ?? null,
    lamps: layout.props.filter((p) => p.kind === 'lamp'),
    canopies: layout.props.filter((p) => p.kind === 'canopy'),
    gridX,
    apron: [ems.cx - 6.2, ems.cx + 6.2],
    dropoff: walkX === null ? [0, 0] : [walkX - 5.6, walkX + 5.6],
    clinicPlaza: clinX === null ? [0, 0] : [clinX - 3.3, clinX + 3.3],
    driveways: [
      [ems.cx - 5.0, ems.cx + 3.0],
      [ext.x + 3.0, ext.x + 9.0],
    ],
    crossings: [ems.cx - 19.0, ems.cx + 23.0],
  };
}

// ───────────────────────────── the whole outside ─────────────────────────────

/** [a, b] minus the gaps → the pieces left over (min length `min`) */
function subtractSpans(a: number, b: number, gaps: [number, number][], min = 1.2): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const [g0, g1] of gaps) {
    if (g1 <= g0) continue;
    parts = parts.flatMap(([p0, p1]): [number, number][] => (g1 <= p0 || g0 >= p1 ? [[p0, p1]] : [[p0, Math.min(p1, g0)], [Math.max(p0, g1), p1]]));
  }
  return parts.filter(([p0, p1]) => p1 - p0 >= min);
}

export function buildExterior(layout: LayoutDef, parts: { root: THREE.Group; tall: THREE.Group }): ExteriorBuilt {
  const plan = lotPlan(layout);
  const rnd = rng(2024);
  const colliders: THREE.Box3[] = [];
  const lights: ExtLight[] = [];
  const site = new THREE.Group(); // casts sun shadows
  const flat = new THREE.Group(); // ground-level surfaces
  const skin = new THREE.Group(); // building skin, canopy, roof (hidden in top-down view)
  const glow = own(outdoor(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff0d8', emissiveIntensity: 4, roughness: 0.4 })));

  // ── ground: one plane, painted + wet + occluded (see groundMaterial) ──
  const [gx0, gz0, gx1, gz1] = [plan.lotX0, plan.D, plan.lotX1, plan.streetZ0];
  const L: GroundLayers = {
    paint: new GroundCanvas(gx0, gz0, gx1 - gx0, gz1 - gz0, 4096, null),
    data: new GroundCanvas(gx0, gz0, gx1 - gx0, gz1 - gz0, 2048, null),
    mask: new GroundCanvas(gx0, gz0, gx1 - gx0, gz1 - gz0, 2048, '#000000'),
  };
  const stalls = lotStalls(plan, layout);
  const cars = parkedCars(plan, stalls);
  paintLotData(plan, L, cars, stalls);
  paintLotMarkings(plan, L.paint, stalls);
  const ground = groundMaterial(L);
  const groundMesh = new THREE.Mesh(flatGeo(gx0, gz0, gx1, gz1, 0), ground.mat);
  groundMesh.receiveShadow = true;
  groundMesh.userData.noMerge = true;
  parts.root.add(groundMesh);

  // ── planting: strip between the sidewalk and the stall heads, perimeter along the street ──
  const lampXs = plan.lamps.map((p) => p.x);
  const stripGaps: [number, number][] = [plan.dropoff, plan.apron, plan.clinicPlaza, ...plan.crossings.map((x): [number, number] => [x - 1.0, x + 1.0])];
  for (const [a, b] of subtractSpans(plan.lotX0 + 0.4, plan.lotX1 - 0.4, stripGaps)) {
    colliders.push(island(site, a, plan.stripZ0, b, plan.stripZ1, (a * 7) % 3 < 1 ? 'mulch' : 'lawn'));
    const zc = (plan.stripZ0 + plan.stripZ1) / 2;
    for (let x = a + 2.2; x < b - 2; x += 7.5 + rnd() * 2.5) {
      if (lampXs.some((lx) => Math.abs(lx - x) < 4.6)) continue;
      tree(site, x, zc, { h: 6.5 + rnd() * 2.5, r: 2.2 + rnd() * 0.9, seed: Math.floor(rnd() * 1e6) });
    }
    for (const x of [a + 0.9, b - 0.9]) if (b - a > 3) shrub(site, x, zc, 0.65, 0.8, Math.floor(rnd() * 1e6));
  }
  const poleXs: number[] = [];
  for (const [a, b] of subtractSpans(plan.lotX0, plan.lotX1, plan.driveways)) {
    colliders.push(island(site, a, plan.aisleZ1, b, plan.perimZ1, 'lawn'));
    const zc = (plan.aisleZ1 + plan.perimZ1) / 2;
    // perimeter LED area lights (single head over the aisle) every ~24 m
    for (let x = a + 5; x < b - 3; x += 24) {
      const pole = new THREE.Group();
      pole.position.set(x, 0, zc - 0.3);
      const out: { lampAnchor?: THREE.Vector3 } = {};
      lampPost(pole, false, out);
      site.add(pole);
      poleXs.push(x);
      const w = out.lampAnchor!.clone().add(pole.position);
      lights.push({ kind: 'spot', pos: w, target: w.clone().setY(0).add(new THREE.Vector3(0, 0, -2.5)), color: '#ffdcb4', intensity: 100, distance: 25, angle: 1.15, penumbra: 0.7 });
      colliders.push(boxCollider(x, zc - 0.3, 0.4, 0.4, 2));
    }
    for (let x = a + 3; x < b - 2; x += 9 + rnd() * 3) if (!poleXs.some((px) => Math.abs(px - x) < 4)) tree(site, x, zc, { h: 7 + rnd() * 2.5, r: 2.4 + rnd() * 0.8, seed: Math.floor(rnd() * 1e6) });
    for (let x = a + 1; x < b - 0.8; x += 1.25) shrub(site, x, zc + 0.35, 0.55, 0.6 + rnd() * 0.2, Math.floor(rnd() * 1e6));
  }
  // lawns + trees beside the building (west / east of the façade)
  for (const [x, z] of [[plan.lotX0 + 4, plan.D - 6], [plan.lotX0 + 5, plan.D - 15], [plan.lotX1 - 5, plan.D - 5], [plan.lotX1 - 4, plan.D - 14], [plan.lotX0 + 3, plan.D - 21]] as [number, number][]) tree(site, x, z, { h: 8 + rnd() * 2, r: 2.8, seed: Math.floor(rnd() * 1e6) });
  for (const [x0, x1] of [[plan.lotX0, -0.2], [plan.W + 0.2, plan.lotX1]] as [number, number][]) flat.add(new THREE.Mesh(flatGeo(x0 + (x0 < 0 ? 0 : 0.02), 0, x1, plan.D, 0.004), extPbr('grass', { color: '#b3bd9a', tile: 1.6, roughness: 1 })));
  for (const x of [-1.4, plan.W + 1.4]) flat.add(new THREE.Mesh(flatGeo(x - 1.0, -0.4, x + 1.0, plan.D, 0.012), extPbr('sidewalk', { color: '#d6d2ca', tile: 2.0, roughness: 0.9 })));

  // ── hardscape details: wheel stops, drains, manholes, trench drain across the apron ──
  for (const s of stalls) if (s.kind !== 'aisle') wheelStop(flat, (s.x0 + s.x1) / 2, plan.stallZ0 + 0.55);
  for (let x = plan.lotX0 + 6; x < plan.lotX1 - 4; x += 14 + rnd() * 6) if (!inRanges(x, plan.driveways, 1)) grate(flat, x, plan.aisleZ1 - 0.25, 0.9, 0.45);
  for (const x of [plan.lotX0 + 21, plan.ems.cx + 9, plan.lotX1 - 18]) manhole(flat, x, (plan.stallZ1 + plan.aisleZ1) / 2 + (rnd() - 0.5) * 2);
  grate(flat, plan.ems.cx, plan.stallZ1 + 3.9, plan.apron[1] - plan.apron[0] - 1, 0.18);
  manhole(flat, plan.ems.cx - 4.6, plan.sidewalkZ1 + 1.2, 0.3);

  // ── bollards, benches, bins, bike rack, hydrant ──
  const plazaEdge = plan.stripZ1;
  for (const [a, b] of [plan.dropoff, plan.clinicPlaza]) if (b > a) for (let x = a + 1.2; x <= b - 1.2 + 1e-3; x += 1.6) colliders.push(bollard(site, x, plazaEdge, 'steel', glow));
  for (const x of [plan.apron[0] + 0.3, plan.apron[1] - 0.3]) for (const z of [plan.sidewalkZ1 - 0.2, plan.stripZ1 + 0.4]) colliders.push(bollard(site, x, z, 'steel', glow));
  for (const x of plan.crossings) for (const dx of [-1.25, 1.25]) colliders.push(bollard(site, x + dx, plan.sidewalkZ1 + 0.1, 'light', glow));
  if (plan.walkin) {
    colliders.push(bench(site, plan.walkin.cx - 3.6, plan.F + 1.2, 0), bench(site, plan.walkin.cx + 3.6, plan.F + 1.2, 0));
    colliders.push(bin(site, plan.walkin.cx - 2.2, plan.F + 0.6), bin(site, plan.walkin.cx + 5.2, plan.F + 0.6));
  }
  if (plan.clinic) {
    colliders.push(bench(site, plan.clinic.cx + 4.6, plan.F + 1.4, 0), bin(site, plan.clinic.cx - 2.6, plan.F + 0.55));
    bikeRack(site, plan.clinic.cx - 6.8, plan.F + 1.25, 4);
    colliders.push(boxCollider(plan.clinic.cx - 5.45, plan.F + 1.25, 1.6, 0.35, 1));
  }
  colliders.push(bin(site, plan.ems.cx - 6.8, plan.F + 0.55));
  hydrant(site, plan.lotX0 + 26.5, plan.perimZ1 - 0.35, Math.PI);

  // ── signs: monument at the main driveway, wayfinding + ambulance-only posts ──
  const blue = '#1d4e89';
  const mono = signFace('monument', 2.8, 1.3, rowsDraw([{ t: 'Grand Therapies', c: '#ffffff', s: 1.0, w: 600 }, { t: 'Medical Center', c: '#dfe6ec', s: 0.62, w: 500 }, { t: 'EMERGENCY', c: '#ff4d42', s: 1.35, w: 800 }, { t: 'Outpatient Clinic', c: '#dfe6ec', s: 0.75, w: 500 }], '#1d2328', 'u'), 1.3);
  const [m0] = plan.driveways[0];
  colliders.push(monumentSign(site, m0 - 3.4, (plan.aisleZ1 + plan.perimZ1) / 2 + 0.1, 0, mono));
  colliders.push(postSign(site, plan.driveways[0][1] + 1.2, plan.aisleZ1 - 0.6, 0, 0.9, 0.9, signFace('w-er', 0.9, 0.9, rowsDraw([{ t: 'EMERGENCY', c: '#ffffff', s: 1 }, { t: 'Ambulance', c: '#ffffff', s: 0.8, w: 500 }], '#b3201c', 'u'))));
  colliders.push(postSign(site, plan.apron[0] - 0.5, plan.stripZ1 + 0.5, 0, 0.6, 0.8, signFace('w-amb', 0.6, 0.8, rowsDraw([{ t: 'NO', c: '#c4121f', s: 0.8, w: 900 }, { t: 'PARKING', c: '#c4121f', s: 0.8, w: 800 }, { t: 'AMBULANCE', c: '#1d2125', s: 0.6 }, { t: 'ONLY', c: '#1d2125', s: 0.6 }, { t: 'TOW-AWAY ZONE', c: '#1d2125', s: 0.45, w: 600 }], '#f6f6f2'))));
  if (plan.walkin) colliders.push(postSign(site, plan.dropoff[1] - 0.6, plan.stripZ1 + 0.45, 0, 0.6, 0.75, signFace('w-drop', 0.6, 0.75, rowsDraw([{ t: 'PATIENT', c: '#ffffff', s: 0.8 }, { t: 'DROP-OFF', c: '#ffffff', s: 0.8 }, { t: '15 MIN LIMIT', c: '#ffffff', s: 0.55, w: 500 }], blue))));
  if (plan.clinic) colliders.push(postSign(site, plan.lotX1 - 9, plan.aisleZ1 - 0.6, 0, 0.9, 0.7, signFace('w-cl', 0.9, 0.7, rowsDraw([{ t: 'Outpatient Clinic', c: '#ffffff', s: 1 }, { t: 'Visitor parking', c: '#ffffff', s: 0.8, w: 500 }], blue, 'u'))));

  // ── parked cars: all merged together (shared trim/glass/tire materials → few draw calls) ──
  const carGroup = new THREE.Group();
  for (const c of cars) {
    const car = buildCar(c.kind, c.color, c.metallic, c.seed);
    car.position.set(c.x, 0, c.z);
    car.rotation.y = c.rot;
    carGroup.add(car);
    colliders.push(boxCollider(c.x, c.z, c.width / 2 + 0.05, c.len / 2, 1.6));
  }
  const carsMerged = mergeByMaterial(carGroup, { castShadow: true });
  carsMerged.userData.xpart = 'cars';
  carsMerged.userData.parked = cars;
  parts.root.add(carsMerged);
  const hideForProbe: THREE.Object3D[] = [carsMerged];
  return finishExterior(layout, plan, { parts, site, flat, skin, glow, ground, colliders, lights, hideForProbe });
}

function groundMesh(root: THREE.Object3D): THREE.Object3D {
  return root.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.Material).userData?.ownLights) ?? new THREE.Object3D();
}

interface Build {
  parts: { root: THREE.Group; tall: THREE.Group };
  site: THREE.Group;
  flat: THREE.Group;
  skin: THREE.Group;
  glow: THREE.MeshStandardMaterial;
  ground: { mat: THREE.MeshStandardMaterial; wet: { value: number } };
  colliders: THREE.Box3[];
  lights: ExtLight[];
  hideForProbe: THREE.Object3D[];
}

function finishExterior(layout: LayoutDef, plan: Plan, b: Build): ExteriorBuilt {
  const { parts, site, flat, skin, glow, ground, colliders, lights } = b;
  const H = plan.H;
  const top = H + 0.95;
  // ── building skin: cladding + interior-mapped windows on every façade ──
  const glows: { value: number }[] = [];
  for (const { key, line } of facadeLines(layout, plan)) {
    const lat = line.T;
    const gl = interiorGlass(line.N, lat, { depth: 4.2, cell: 3 * MOD, H, y0: SILL, y1: HEAD, seed: key.charCodeAt(0) });
    glows.push(gl.glow);
    facadeSkin(skin, line, gl.mat, top, key.charCodeAt(0) * 13);
    // the cladding stands 10 cm proud of the builder's walls: keep people out of it
    if (key === 'S') for (const [a, c] of subtractSpans(-0.2, line.len + 0.2, line.doors.map(([d0, d1]) => [d0 - 0.1, d1 + 0.1] as [number, number]), 0.1)) colliders.push(new THREE.Box3(new THREE.Vector3(a, 0, plan.D + 0.1), new THREE.Vector3(c, top, plan.F)));
  }
  // parapet (roof side) behind the coping, all around — except where an upper floor's façade rises
  // from the outer wall (shared/floors.ts; that floor has a parapet of its own)
  const par = extPbr('concrete', { color: '#b9b6ae', tile: 3, roughness: 0.95 });
  const ph = top - H - 0.27;
  const py = (top + H + 0.27) / 2;
  const ups = upperOutlines(layout);
  const parGaps = (edge: number, alongX: boolean): [number, number][] =>
    ups.filter((u) => (alongX ? Math.abs(u.z - edge) < 0.01 || Math.abs(u.z + u.d - edge) < 0.01 : Math.abs(u.x - edge) < 0.01 || Math.abs(u.x + u.w - edge) < 0.01)).map((u) => (alongX ? [u.x, u.x + u.w] : [u.z, u.z + u.d]));
  for (const [z, edge] of [[plan.D - 0.05, plan.D], [0.05, 0]]) for (const [a, b] of subtractSpans(-0.15, plan.W + 0.15, parGaps(edge, true), 0.05)) add(skin, G.box(b - a, ph, 0.22), par, (a + b) / 2, py, z);
  // (the side runs stop 4 mm short of the corners: the builder's end walls finish flush at z 0 / D)
  for (const [x, edge] of [[0.05, 0], [plan.W - 0.05, plan.W]]) for (const [a, b] of subtractSpans(0.004, plan.D - 0.004, parGaps(edge, false), 0.05)) add(skin, G.box(0.22, ph, b - a), par, x, py, (a + b) / 2);
  const canopy = emsCanopy(skin, plan, colliders, lights);
  roofEquipment(skin, plan, layout);
  // the clinic canopy (a layout prop) gets real downlights too
  for (const c of plan.canopies) {
    const d = c.d ?? 2.8;
    for (const dx of [-(c.w ?? 6) / 4, (c.w ?? 6) / 4]) lights.push({ kind: 'spot', pos: new THREE.Vector3(c.x + dx, 2.78, c.z + d / 2), target: new THREE.Vector3(c.x + dx, 0, c.z + d / 2 + 0.3), color: '#fff1dc', intensity: 14, distance: 8, angle: 1.0, penumbra: 0.8 });
  }
  // LED wall packs over the sidewalk (skip doors and the canopy)
  const wallPack = solid('#2b2f33', 0.45, 0.5);
  for (let x = 6; x < plan.W - 3; x += 12) {
    if (inRanges(x, [[canopy.x0 - 1, canopy.x1 + 1], ...plan.doors.map((d): [number, number] => [d.x0 - 1.2, d.x1 + 1.2]), ...plan.canopies.map((c): [number, number] => [c.x - (c.w ?? 6) / 2 - 1, c.x + (c.w ?? 6) / 2 + 1])])) continue;
    add(skin, G.rbox(0.36, 0.22, 0.2, 0.03), wallPack, x, 3.25, plan.F + 0.1);
    add(skin, G.box(0.3, 0.01, 0.15), glow, x, 3.135, plan.F + 0.12);
    lights.push({ kind: 'spot', pos: new THREE.Vector3(x, 3.1, plan.F + 0.25), target: new THREE.Vector3(x, 0, plan.F + 2.6), color: '#ffe9cf', intensity: 5, distance: 9, angle: 0.95, penumbra: 0.95 });
  }
  // EMERGENCY / AMBULANCE ENTRANCE plaque beside the EMS doors, under the canopy
  const plaque = signFace('ems-plaque', 1.1, 0.5, rowsDraw([{ t: 'EMERGENCY', c: '#ffffff', s: 1, w: 800 }, { t: 'Ambulance entrance', c: '#ffffff', s: 0.75, w: 500 }], '#b3201c'), 0.6);
  add(skin, G.plane(1.1, 0.5), plaque, plan.ems.x1 + 1.0, 1.75, plan.F + 0.009);
  // ── the street, and the town around the hospital (campus, garage, river, far bank) ──
  beyondTheLot(flat, plan, glow);
  const far = new THREE.Group();
  const edge = new THREE.Group();
  const sur = !surroundOn() ? { colliders: [], lights: [], setNight() {} } : buildSurroundings(edge, far, { W: plan.W, D: plan.D, lotX0: plan.lotX0, lotX1: plan.lotX1, perimZ1: plan.perimZ1, streetZ0: plan.streetZ0, streetZ1: plan.streetZ1, driveways: plan.driveways }, { shrub, tree, glow });
  colliders.push(...sur.colliders);
  lights.push(...sur.lights);
  // ── merge (one mesh per material) ──
  const litMats = new Set<THREE.MeshStandardMaterial>();
  for (const grp of [site, flat, skin])
    grp.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.userData?.litSign) litMats.add(m);
    });
  const tag = (o: THREE.Object3D, k: string) => ((o.userData.xpart = k), o);
  parts.root.add(tag(mergeByMaterial(site, { castShadow: true }), 'site'));
  parts.root.add(tag(mergeByMaterial(flat, { castShadow: false }), 'flat'));
  parts.tall.add(tag(mergeByMaterial(skin, { castShadow: true }), 'skin'));
  tag(groundMesh(parts.root), 'ground');
  // the campus fence + hedge cast sun shadows; the surroundings beyond don't (and the rig gives
  // their façades and water sun-only lighting)
  parts.root.add(tag(mergeByMaterial(edge, { castShadow: true }), 'edge'));
  parts.root.add(tag(mergeByMaterial(far, { castShadow: false }), 'far'));
  // ── sun blockers: the roof + outer walls as shadow casters only the sun's shadow camera sees ──
  const sunBlockers = new THREE.Group();
  const bm = new THREE.MeshBasicMaterial({ color: '#000000' });
  const block = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = add(sunBlockers, G.box(w, h, d), bm, x, y, z);
    m.layers.set(1);
    m.castShadow = true;
    m.receiveShadow = false;
    m.userData.noMerge = true;
    m.userData.castShadow = true;
  };
  block(plan.W + 0.1, 0.1, plan.D + 0.1, plan.W / 2, H + 0.16, plan.D / 2);
  block(plan.W + 0.1, H + 0.2, 0.05, plan.W / 2, (H + 0.2) / 2, plan.D - 0.055);
  block(plan.W + 0.1, H + 0.2, 0.05, plan.W / 2, (H + 0.2) / 2, 0.055);
  block(0.05, H + 0.2, plan.D + 0.1, 0.055, (H + 0.2) / 2, plan.D / 2);
  block(0.05, H + 0.2, plan.D + 0.1, plan.W - 0.055, (H + 0.2) / 2, plan.D / 2);
  for (const r of layout.rooms) {
    const RH = r.ceilingHeight ?? H;
    if (r.kind === 'exterior' || RH <= H + 0.01) continue;
    const { x, z, w, d } = r.rect;
    block(w, 0.1, d, x + w / 2, RH + 0.16, z + d / 2);
    for (const [bw, bd, bx, bz] of [[w, 0.05, x + w / 2, z + 0.05], [w, 0.05, x + w / 2, z + d - 0.05], [0.05, d, x + 0.05, z + d / 2], [0.05, d, x + w - 0.05, z + d / 2]]) block(bw, RH + 0.2, bd, bx, (RH + 0.2) / 2, bz);
  }
  parts.root.add(sunBlockers);
  // ── reflection probe over the lot, reflections projected onto the lot's box ──
  const probe = {
    pos: new THREE.Vector3(plan.ems.cx - 8.5, 2.4, plan.stallZ1 + 2.6),
    min: new THREE.Vector3(plan.lotX0 - 1, -0.05, plan.F),
    max: new THREE.Vector3(plan.lotX1 + 1, 18, plan.streetZ1 + 7),
  };
  return {
    colliders,
    lights,
    groundMat: ground.mat,
    probe,
    hideForProbe: b.hideForProbe,
    sunBlockers,
    footprint: { w: plan.W, d: plan.D },
    setNight(night: boolean) {
      ground.wet.value = night ? 1.0 : 0.62;
      for (const gv of glows) gv.value = night ? 1.0 : 0.8;
      glow.emissiveIntensity = night ? 4 : 0.06;
      for (const m of litMats) m.emissiveIntensity = (m.userData.litSign as number) * (night ? 1 : 0.12);
      sur.setNight(night);
    },
  };
}

// ───────────────────────────── outdoor light rig (called by render/lighting.ts) ─────────────────────────────

/**
 * Environment lookup for outdoor materials: the reflection probe, parallax-corrected by
 * projecting the reflection (or normal) direction onto the lot's box, so puddles mirror the
 * canopy, the lit windows and the lamps roughly where they are.
 */
class BoxProjectedEnv extends Node {
  /** one PMREM lookup shared by every outdoor material and context (one texture binding each) */
  private pm: ReturnType<typeof pmremTexture>;
  constructor(
    tex: THREE.Texture,
    private bmin: THREE.Vector3,
    private bmax: THREE.Vector3,
    private center: THREE.Vector3,
  ) {
    super('vec3');
    this.pm = pmremTexture(tex);
  }
  private project(dir: ReturnType<typeof vec3>) {
    const p = positionWorld;
    const r0 = dir.normalize();
    const r = r0.add(step(abs(r0), vec3(1e-4)).mul(1e-4));
    const t1 = vec3(this.bmax.x, this.bmax.y, this.bmax.z).sub(p).div(r);
    const t2 = vec3(this.bmin.x, this.bmin.y, this.bmin.z).sub(p).div(r);
    const tf = max(t1, t2);
    const t = min(min(tf.x, tf.y), tf.z);
    const hit = p.add(r.mul(t));
    return select(t.greaterThan(0.0), hit.sub(vec3(this.center.x, this.center.y, this.center.z)).normalize(), r0);
  }
  setup(builder: NodeBuilder) {
    // the environment node asks for a reflection (radiance) or normal (irradiance) direction:
    // pass that request on, parallax-corrected
    const outer = builder.context as { getUV?: (n: unknown, b: unknown) => unknown; getTextureLevel?: (n: unknown) => unknown };
    const getUV = outer.getUV;
    const getLevel = outer.getTextureLevel;
    return this.pm.context({
      getUV: (n: unknown, b: unknown) => this.project((getUV ? getUV(n, b) : normalWorld) as ReturnType<typeof vec3>),
      getTextureLevel: getLevel ?? (() => float(0)),
    });
  }
}

export interface OutdoorRig {
  /** shadowless outdoor lights (the rig may cull them by view) */
  lights: (THREE.PointLight | THREE.SpotLight)[];
  setNight(night: boolean): void;
  update(): void;
  dispose(): void;
}

const SUN_DIR = new THREE.Vector3(-0.335, 0.743, 0.582).normalize();

export function createOutdoorRig(renderer: WebGPURenderer, scene: THREE.Scene, world: { exterior: ExteriorBuilt; lamps: THREE.PointLight[]; root: THREE.Object3D }, o: { shadows: boolean; group: THREE.Group }): OutdoorRig {
  const ext = world.exterior;
  // ── sky: Poly Haven pure-sky backgrounds (equirect, upper half), tinted + scaled per time of day ──
  const loader = new THREE.TextureLoader();
  const skies = new Map<string, THREE.Texture>();
  const sky = (k: 'night' | 'day') => {
    let t = skies.get(k);
    if (!t) {
      t = loader.load(`/res/tex/sky/${k}.webp`, () => (captureIn = Math.min(captureIn, 3)));
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = THREE.RepeatWrapping;
      skies.set(k, t);
    }
    return t;
  };
  const skyNode = texture(sky('night'));
  const uSkyI = uniform(1);
  const uTint = uniform(new THREE.Vector3(1, 1, 1));
  const uLow = uniform(new THREE.Vector3(0.02, 0.02, 0.02));
  const uRot = uniform(0);
  const dirN = normalWorldGeometry.normalize();
  const su = atan(dirN.z, dirN.x).div(Math.PI * 2).add(0.5).add(uRot);
  const sv = asin(clamp(dirN.y, -1, 1)).div(Math.PI).add(0.5);
  const below = smoothstep(0.0, -0.06, dirN.y);
  const sc = skyNode.sample(vec2(su, max(sv, 0.505))).level(float(0)).rgb;
  const uDesat = uniform(0.2);
  const scd = mix(sc, vec3(dot(sc, vec3(0.299, 0.587, 0.114))), uDesat);
  const uGlow = uniform(new THREE.Vector3(0, 0, 0));
  const horizon = pow(float(1).sub(clamp(dirN.y, 0, 1)), 6);
  // a distant city along the horizon (past the camera's far plane), hazed like the sky right above it
  const hz = skyNode.sample(vec2(su, 0.512)).level(float(0)).rgb;
  const haze = mix(hz, vec3(dot(hz, vec3(0.299, 0.587, 0.114))), uDesat).mul(uTint).mul(uSkyI).add(uGlow);
  const uCityNight = uniform(1);
  const uCityOn = uniform(1);
  const city = skylineBand(dirN, uCityNight, haze);
  const skyBg = mix(scd.mul(uTint).mul(uSkyI).add(uGlow.mul(horizon)), uLow, below);
  scene.backgroundNode = surroundOn() ? mix(skyBg, city.color, city.cover.mul(uCityOn)) : skyBg;
  const fog = new THREE.Fog('#000000', 70, 560);
  scene.fog = fog;
  // ── lights: canopy downlights, wall packs, sign glow; LED area lights replace the lamp anchors ──
  const lights: (THREE.PointLight | THREE.SpotLight)[] = [];
  const schedule: { l: THREE.Light; night: number; day: number }[] = [];
  const mk = (s: ExtLight) => {
    const l = s.kind === 'spot' ? new THREE.SpotLight(s.color, 0, s.distance, s.angle ?? 1, s.penumbra ?? 0.5, 2) : new THREE.PointLight(s.color, 0, s.distance, 2);
    l.position.copy(s.pos);
    o.group.add(l);
    if (l instanceof THREE.SpotLight) {
      l.target.position.copy(s.target ?? s.pos.clone().setY(0));
      o.group.add(l.target);
    }
    lights.push(l);
    const k = tune('extl', 4);
    schedule.push({ l, night: s.intensity * k, day: s.always ? s.intensity * k * 0.6 : 0 });
  };
  for (const s of ext.lights) mk(s);
  for (const p of world.lamps) {
    const w = p.getWorldPosition(new THREE.Vector3());
    p.parent?.remove(p);
    p.intensity = 0;
    mk({ kind: 'spot', pos: w, target: w.clone().setY(0), color: '#ffdcb4', intensity: tune('lamp', 110), distance: 27, angle: 1.18, penumbra: 0.7 });
  }
  // ── sun (high/ultra): shadows from cars, trees, canopy; the blockers keep it out of the building ──
  let sun: THREE.DirectionalLight | null = null;
  if (o.shadows) {
    const c = ext.probe.min.clone().add(ext.probe.max).multiplyScalar(0.5).setY(0);
    sun = new THREE.DirectionalLight('#fff0dc', 0);
    sun.position.copy(c).addScaledVector(SUN_DIR, 90);
    sun.target.position.copy(c);
    o.group.add(sun, sun.target);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.06;
    sun.shadow.radius = 2;
    // only layer 1 casts sun shadows: exterior shadow twins, the building blockers, and characters
    // that are outdoors (update() tags them) — not the whole cast inside the building every frame
    sun.shadow.camera.layers.set(1);
    // nothing on layer 1 moves except characters outdoors: the map is re-rendered on demand (update())
    sun.shadow.autoUpdate = false;
    const view = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0)).invert();
    view.setPosition(new THREE.Vector3().copy(sun.position).applyMatrix4(new THREE.Matrix4().extractRotation(view)).negate());
    const bb = new THREE.Box3();
    const { min: lo, max: hi } = ext.probe;
    for (const x of [lo.x - 8, hi.x + 8]) for (const y of [0, 14]) for (const z of [-2, hi.z]) bb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(view));
    const cam = sun.shadow.camera;
    cam.left = bb.min.x;
    cam.right = bb.max.x;
    cam.bottom = bb.min.y;
    cam.top = bb.max.y;
    cam.near = Math.max(0.5, -bb.max.z - 5);
    cam.far = -bb.min.z + 5;
    cam.updateProjectionMatrix();
  }
  // ── reflection probe: PMREM of the lot (cars hidden), box-projected for every outdoor material ──
  const pmrem = new PMREMGenerator(renderer);
  const empty = new THREE.Scene();
  let target = pmrem.fromScene(empty, 0, 0.1, 1, { size: 512 });
  const env = new BoxProjectedEnv(target.texture, ext.probe.min, ext.probe.max, ext.probe.pos);
  // the ground sees only the outdoor lights: no interior troffers leaking through the walls onto the
  // sidewalk, and none of the exam-light shadow maps / cluster textures (it samples six maps itself;
  // WebGPU allows 16 per stage). Everything else outdoors uses the clustered scene lights.
  const outLights = lightsNode([...(sun ? [sun] : []), ...lights]);
  // distant façades and the river: the sun (without shadow lookups) and the probe, nothing else.
  // Only these skip shadows; the other far parts keep receiving them, so they share the pipelines
  // of the same materials nearby (fewer shaders to compile).
  const farLights = lightsNode(sun ? [sun] : []);
  world.root.traverse((obj) => {
    const fm = (obj as THREE.Mesh).material as THREE.Material | undefined;
    if (fm && !Array.isArray(fm) && fm.userData?.farLights) obj.receiveShadow = false;
  });
  const outMats: THREE.MeshStandardMaterial[] = [];
  const prep = (obj: THREE.Object3D) => {
    const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || !m.userData?.outdoor || m.envMap === target.texture) return;
    outMats.push(m);
    m.envMap = target.texture;
    m.envMapIntensity = (m.userData.envIntensity as number) ?? 1;
    (m as unknown as { envNode: unknown }).envNode = env;
    if (m.userData.ownLights) (m as unknown as { lightsNode: unknown }).lightsNode = outLights;
    else if (m.userData.farLights) (m as unknown as { lightsNode: unknown }).lightsNode = farLights;
    m.needsUpdate = true;
  };
  world.root.traverse(prep);
  const xhide = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('xhide') ?? '' : '').split(',').filter(Boolean);
  if (xhide.length) world.root.traverse((obj) => xhide.includes(obj.userData.xpart) && (obj.visible = false));
  // test hook (?debug=1): show or hide parts of the outside at runtime, for in-page A/B profiling
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))
    (window as unknown as Record<string, unknown>).__acOutdoor = {
      show(part: string, on: boolean) {
        if (part === 'city') uCityOn.value = on ? 1 : 0;
        else world.root.traverse((obj) => obj.userData.xpart === part && (obj.visible = on));
        sunDirty = true;
      },
      /** sun-shadow re-render interval while characters are outdoors (frames; large = static) */
      sunEvery(n: number) {
        sunEvery = Math.max(1, Math.round(n));
      },
      /** inspection camera: eye at p looking at t, applied right before each main render (null: the player's) */
      camera(p: number[] | null, t?: number[]) {
        camOv = p && t ? { p: new THREE.Vector3(p[0], p[1], p[2]), t: new THREE.Vector3(t[0], t[1], t[2]) } : null;
      },
      /** the ambulance and the parked cars: kind, colour, position, heading (front = local +z) */
      vehicles() {
        const list: Record<string, unknown>[] = [];
        world.root.traverse((obj) => {
          if (obj.userData.xpart === 'amb') {
            const w = obj.getWorldPosition(new THREE.Vector3());
            const e = new THREE.Euler().setFromQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
            list.push({ kind: 'ambulance', x: w.x, z: w.z, rot: e.y });
          }
          if (obj.userData.parked) list.push(...(obj.userData.parked as Record<string, unknown>[]));
        });
        return list;
      },
      /** vehicles placed anywhere for close-ups ({kind, color, metallic, x, z, rot}); [] removes them */
      showroom(items: { kind: string; color?: string; metallic?: boolean; x: number; z: number; rot: number; seed?: number }[]) {
        if (showroom) o.group.remove(showroom);
        showroom = null;
        if (!items.length) return;
        showroom = new THREE.Group();
        for (const it of items) {
          let v: THREE.Group;
          if (it.kind === 'ambulance') buildAmbulance({ group: (v = new THREE.Group()), lightBar: [] });
          else v = buildCar(it.kind as Parameters<typeof buildCar>[0], it.color ?? '#e9eaea', !!it.metallic, it.seed ?? 3);
          v.position.set(it.x, 0, it.z);
          v.rotation.y = it.rot;
          v.traverse((m) => {
            m.receiveShadow = true;
            m.castShadow = false;
            prep(m);
          });
          showroom.add(v);
        }
        o.group.add(showroom);
        sunDirty = true;
      },
    };
  let camOv: { p: THREE.Vector3; t: THREE.Vector3 } | null = null;
  let showroom: THREE.Group | null = null;
  const sceneBefore = scene.onBeforeRender;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
    const before = sceneBefore.bind(scene) as (...a: unknown[]) => void;
    (scene as unknown as { onBeforeRender: (...a: unknown[]) => void }).onBeforeRender = (...a: unknown[]) => {
      before(...a);
      const cam = a[2] as THREE.PerspectiveCamera;
      // only the player's view (square shadow / probe cameras keep theirs)
      if (!camOv || !cam.isPerspectiveCamera || Math.abs(cam.aspect - 1) < 0.05) return;
      cam.position.copy(camOv.p);
      cam.up.set(0, 1, 0);
      cam.lookAt(camOv.t);
      cam.updateMatrixWorld();
    };
  }
  let captureIn = 0;
  const capture = () => {
    const hidden = ext.hideForProbe.filter((h) => h.visible);
    hidden.forEach((h) => (h.visible = false));
    const off = lights.filter((l) => !l.visible);
    off.forEach((l) => (l.visible = true));
    // reuse the current shadow maps instead of re-rendering each one for all six cube faces
    const shadowed: THREE.LightShadow[] = [];
    scene.traverse((obj) => {
      const l = obj as THREE.Light & { shadow?: THREE.LightShadow };
      if (l.isLight && l.castShadow && l.shadow && l.shadow.autoUpdate) {
        l.shadow.autoUpdate = false;
        shadowed.push(l.shadow);
      }
    });
    target = pmrem.fromScene(scene, 0, 0.15, 480, { size: 512, position: ext.probe.pos, renderTarget: target });
    shadowed.forEach((sh) => (sh.autoUpdate = true));
    hidden.forEach((h) => (h.visible = true));
    off.forEach((l) => (l.visible = false));
  };
  const later = [75];
  // sun shadow re-renders: after day/night changes, after late loads (leaf alpha, cars), and every
  // other frame while characters are outdoors (plus once when the last one goes back in)
  const sunLater = [3, 75, 240];
  /** drawn at all (the first-person player's own body is hidden, so it needs no shadow updates) */
  const shown = (o: THREE.Object3D | null) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  let sunDirty = false;
  let anyOut = false;
  /** frames between sun-shadow re-renders while characters are outdoors */
  let sunEvery = 2;
  let frame = 0;
  let skinned: THREE.Object3D[] = [];
  const tmp = new THREE.Vector3();
  const fp = ext.footprint;
  let night: boolean | null = null;
  return {
    lights,
    setNight(n: boolean) {
      if (n === night) return;
      night = n;
      skyNode.value = sky(n ? 'night' : 'day');
      uSkyI.value = n ? tune('skyn', 0.15) : tune('skyd', 1.15);
      uDesat.value = n ? 0.35 : 0.38;
      uGlow.value.set(...((n ? [0.05, 0.034, 0.022] : [0.05, 0.06, 0.07]) as [number, number, number]));
      uTint.value.set(...((n ? [1.0, 0.8, 0.66] : [1.0, 1.0, 1.0]) as [number, number, number]));
      uRot.value = n ? 0 : -0.247;
      uLow.value.set(...((n ? [0.012, 0.011, 0.012] : [0.55, 0.6, 0.66]) as [number, number, number]));
      uCityNight.value = n ? 1 : 0;
      fog.color.setRGB(...((n ? [0.022, 0.019, 0.02] : [0.82, 0.9, 1.0]) as [number, number, number]));
      for (const s of schedule) s.l.intensity = n ? s.night : s.day;
      // without a sun (medium / low presets) daylight comes from the sky probe alone: lift it
      const amb = n || sun ? 1 : tune('dayamb', 2.2);
      for (const m of outMats) m.envMapIntensity = ((m.userData.envIntensity as number) ?? 1) * amb;
      if (sun) {
        sun.intensity = n ? 0 : tune('sun', 6);
        sun.visible = !n;
        sunDirty = !n;
      }
      ext.setNight(n);
      captureIn = Math.min(captureIn || 4, 4);
    },
    update() {
      frame++;
      if (sun && sun.visible) {
        if (frame % 45 === 1) {
          skinned = [];
          scene.traverse((obj) => (obj as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(obj));
        }
        let outNow = false;
        for (const m of skinned) {
          m.getWorldPosition(tmp);
          const out = shown(m) && (tmp.x < -0.2 || tmp.x > fp.w + 0.2 || tmp.z < -0.2 || tmp.z > fp.d + 0.2);
          if (out) m.layers.enable(1);
          else m.layers.disable(1);
          outNow ||= out;
        }
        if (sunLater.length && frame >= sunLater[0]) {
          sunLater.shift();
          sunDirty = true;
        }
        if (sunDirty || (outNow && frame % sunEvery === 0) || outNow !== anyOut) sun.shadow.needsUpdate = true;
        sunDirty = false;
        anyOut = outNow;
      }
      if (later.length && frame >= later[0]) {
        later.shift();
        captureIn = 1;
      }
      if (captureIn > 0 && --captureIn === 0) capture();
    },
    dispose() {
      scene.onBeforeRender = sceneBefore;
      if (showroom) o.group.remove(showroom);
      for (const l of lights) l.parent?.remove(l);
      if (sun) o.group.remove(sun, sun.target);
      scene.backgroundNode = null;
      scene.fog = null;
      target.dispose();
      pmrem.dispose();
      skies.forEach((t) => t.dispose());
    },
  };
}

// ───────────────────────────── helpers ─────────────────────────────

/** `?surround=0` (profiling): the lot without the town around it */
function surroundOn(): boolean {
  return typeof location === 'undefined' || new URLSearchParams(location.search).get('surround') !== '0';
}

/** deterministic PRNG (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** outdoor variant of a texture-set material (tagged, so it never shares with an interior material) */
export function extPbr(set: Parameters<typeof pbr>[0], o: Parameters<typeof pbr>[1] = {}, envI = 1): THREE.MeshStandardMaterial {
  return outdoor(pbr(set, { ...o, tag: 'ext' }), envI);
}

/** inside an x range list? */
export function inRanges(x: number, ranges: [number, number][], pad = 0): boolean {
  return ranges.some(([a, b]) => x > a - pad && x < b + pad);
}

/** axis-aligned collider from center + half sizes (y from 0) */
export function boxCollider(cx: number, cz: number, hx: number, hz: number, h = 2): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(cx - hx, 0, cz - hz), new THREE.Vector3(cx + hx, h, cz + hz));
}

/** a flat horizontal quad (top face only) with world-aligned UVs, at height y */
export function flatGeo(x0: number, z0: number, x1: number, z1: number, y: number, uvScale = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
  return trackGeo(g);
}


// ───────────────────────────── stalls + parked cars ─────────────────────────────

export interface Stall {
  x0: number;
  x1: number;
  kind: 'normal' | 'accessible' | 'aisle';
}

export interface Parked {
  x: number;
  z: number;
  rot: number;
  kind: 'sedan' | 'suv' | 'hatch' | 'pickup';
  color: string;
  metallic: boolean;
  len: number;
  width: number;
  seed: number;
}

/** 3 m stalls on the layout's grid, skipping the ambulance apron and the walk-in drop-off */
export function lotStalls(plan: Plan, layout: LayoutDef): Stall[] {
  const acc = layout.props.find((p) => p.kind === 'parking' && p.label === 'accessible');
  const accX = acc ? acc.x : null;
  const out: Stall[] = [];
  const start = plan.gridX - Math.floor((plan.gridX - (plan.lotX0 + 0.8)) / 3) * 3;
  for (let x = start; x + 3 <= plan.lotX1 - 0.8 + 1e-6; x += 3) {
    const mid = x + 1.5;
    if (inRanges(mid, [plan.apron, plan.dropoff], 1.4)) continue;
    if (accX !== null && Math.abs(mid - accX) < 0.1) out.push({ x0: x, x1: x + 3, kind: 'accessible' });
    else if (accX !== null && Math.abs(mid - (accX - 3)) < 0.1) out.push({ x0: x, x1: x + 3, kind: 'aisle' });
    else out.push({ x0: x, x1: x + 3, kind: 'normal' });
  }
  return out;
}

const CAR_COLORS: [string, boolean][] = [
  ['#e9eaea', false],
  ['#16181b', true],
  ['#9ea4a8', true],
  ['#5b6066', true],
  ['#1f3554', true],
  ['#7a1218', true],
  ['#d9d6cc', true],
  ['#2b3a2f', true],
  ['#f2f1ec', false],
  ['#3a3f45', true],
];

/** which stalls hold a car (deterministic): most nose-in, a few backed in */
export function parkedCars(plan: Plan, stalls: Stall[], seed = 7): Parked[] {
  const rnd = rng(seed);
  const out: Parked[] = [];
  const kinds: Parked['kind'][] = ['sedan', 'suv', 'hatch', 'sedan', 'suv', 'pickup'];
  for (const s of stalls) {
    if (s.kind === 'aisle') continue;
    const fill = s.kind === 'accessible' ? 0.5 : 0.66;
    if (rnd() > fill) continue;
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const len = { sedan: 4.85, suv: 4.75, hatch: 4.3, pickup: 5.75 }[kind];
    const width = { sedan: 1.84, suv: 1.9, hatch: 1.78, pickup: 2.0 }[kind];
    const [color, metallic] = CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)];
    const backed = rnd() < 0.18;
    out.push({
      x: (s.x0 + s.x1) / 2 + (rnd() - 0.5) * 0.25,
      z: plan.stallZ0 + 0.45 + len / 2 + rnd() * 0.25,
      rot: (backed ? 0 : Math.PI) + (rnd() - 0.5) * 0.05,
      kind,
      color,
      metallic,
      len,
      width,
      seed: Math.floor(rnd() * 1e6),
    });
  }
  return out;
}

/** puddles, oil and tire grime, contact shadows (data) + concrete areas (mask) */
export function paintLotData(plan: Plan, L: GroundLayers, cars: Parked[], stalls: Stall[]) {
  const { data, mask } = L;
  const rnd = rng(31);
  const add = (rgb: 'r' | 'g' | 'b', a: number) => (x: number) => `rgba(${rgb === 'r' ? 255 : 0},${rgb === 'g' ? 255 : 0},${rgb === 'b' ? 255 : 0},${Math.max(0, Math.min(1, a * x))})`;
  // concrete: façade sidewalk, entrance plazas, crossings through the planting strip, public sidewalk
  mask.rect(plan.lotX0, plan.D, plan.lotX1, plan.sidewalkZ1, '#ffffff');
  for (const r of [plan.dropoff, plan.clinicPlaza]) if (r[1] > r[0]) mask.rect(r[0] + 0.6, plan.D, r[1] - 0.6, plan.stripZ1 + 0.25, '#ffffff');
  for (const x of plan.crossings) mask.rect(x - 1.0, plan.D, x + 1.0, plan.stripZ1 + 0.25, '#ffffff');
  mask.rect(plan.lotX0, plan.perimZ1, plan.lotX1, plan.perimZ1 + 1.9, '#ffffff');
  // baseline: damp everywhere after rain, dry under the canopy
  data.rect(plan.lotX0, plan.D, plan.lotX1, plan.streetZ0, 'rgb(80,0,0)');
  const cz1 = plan.emsSign ? plan.emsSign.z : plan.F + 3.4;
  data.rect(plan.apron[0] + 0.4, plan.D, plan.apron[1] - 0.4, cz1 - 0.3, 'rgb(0,0,0)');
  const c = data.ctx;
  c.globalCompositeOperation = 'lighter';
  // macro variation: large faint blotches of grime (breaks the texture tiling)
  for (let i = 0; i < 70; i++) data.blob(plan.lotX0 + rnd() * (plan.lotX1 - plan.lotX0), plan.F + rnd() * (plan.streetZ0 - plan.F), 2 + rnd() * 6, 2 + rnd() * 5, add('g', 1), 0.05 + rnd() * 0.12, rnd() * 3);
  // drip line in front of the canopy fascia, gutters along the planting curbs, low spots, drains
  data.rect(plan.apron[0] + 0.6, cz1 + 0.05, plan.apron[1] - 0.6, cz1 + 0.45, 'rgba(255,0,0,0.55)');
  for (let x = plan.lotX0 + 1; x < plan.lotX1 - 1; x += 1.3) data.blob(x, plan.stripZ1 + 0.28, 0.9 + rnd() * 0.8, 0.22, add('r', 1), 0.35 + rnd() * 0.4);
  for (let x = plan.lotX0 + 1; x < plan.lotX1 - 1; x += 1.5) data.blob(x, plan.aisleZ1 - 0.25, 1.0 + rnd(), 0.25, add('r', 1), 0.3 + rnd() * 0.4);
  const puddles: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const x = plan.lotX0 + 3 + rnd() * (plan.lotX1 - plan.lotX0 - 6);
    const z = plan.stallZ1 + 0.6 + rnd() * (plan.aisleZ1 - plan.stallZ1 - 1.2);
    puddles.push([x, z, 0.6 + rnd() * 1.3]);
  }
  puddles.push([plan.ems.cx + 3.2, plan.stallZ1 - 0.3, 2.2], [plan.ems.cx - 2.6, plan.stallZ1 + 1.4, 1.8]);
  // a broad standing puddle in front of the bay: whoever drives up sees the EMERGENCY sign in it
  for (const [dx, dz, rx, rz] of [[0.3, 2.6, 2.4, 1.2], [-1.0, 2.3, 1.6, 0.8], [1.6, 2.9, 1.5, 0.75], [0.1, 3.2, 1.8, 0.6]] as [number, number, number, number][])
    data.blob(plan.ems.cx + dx, plan.stallZ1 + dz, rx, rz, add('r', 1), 1, (rnd() - 0.5) * 0.4);
  for (const [x, z, r] of puddles) {
    // a puddle is many small overlapping lobes along a wobbly line; only the cores reach standing water
    const a0 = rnd() * Math.PI;
    for (let k = 0; k < 9; k++) {
      const t = (k / 8 - 0.5) * r * 1.6;
      const px = x + Math.cos(a0) * t + (rnd() - 0.5) * r * 0.35;
      const pz = z + Math.sin(a0) * t * 0.6 + (rnd() - 0.5) * r * 0.3;
      data.blob(px, pz, r * (0.22 + rnd() * 0.3), r * (0.16 + rnd() * 0.22), add('r', 1), 0.45 + rnd() * 0.5, rnd() * 3);
    }
  }
  // cars: contact shadow + oil drips under the engine, the ambulance too
  const shadow = (x: number, z: number, w: number, l: number, rot: number, a: number) => {
    c.save();
    c.translate(data.X(x), data.Z(z));
    c.rotate(-rot);
    c.filter = `blur(${Math.round(0.22 * data.k)}px)`;
    c.fillStyle = `rgba(0,0,255,${a})`;
    c.fillRect((-w / 2) * data.k, (-l / 2) * data.k, w * data.k, l * data.k);
    c.filter = `blur(${Math.round(0.06 * data.k)}px)`;
    c.fillRect((-w / 2 + 0.15) * data.k, (-l / 2 + 0.3) * data.k, (w - 0.3) * data.k, (l - 0.6) * data.k);
    c.restore();
  };
  for (const car of cars) {
    shadow(car.x, car.z, car.width + 0.1, car.len, car.rot, 0.7);
    const ez = car.z + Math.cos(car.rot) * (car.len / 2 - 0.9);
    data.blob(car.x + (rnd() - 0.5) * 0.3, ez, 0.35, 0.28, add('g', 1), 0.5);
  }
  for (const s of stalls) if (s.kind !== 'aisle') data.blob((s.x0 + s.x1) / 2 + (rnd() - 0.5) * 0.5, plan.stallZ0 + 1.3 + rnd() * 0.6, 0.3 + rnd() * 0.3, 0.25, add('g', 1), 0.25 + rnd() * 0.3);
  if (plan.ambulance) shadow(plan.ambulance.x, plan.ambulance.z + 0.2, 2.5, 7.1, plan.ambulance.rot ?? 0, 0.72);
  // tire grime along the aisle's driving lines
  for (const dz of [-1.1, 1.1]) data.rect(plan.lotX0, (plan.stallZ1 + plan.aisleZ1) / 2 + dz - 0.35, plan.lotX1, (plan.stallZ1 + plan.aisleZ1) / 2 + dz + 0.35, 'rgba(0,255,0,0.07)');
  // façade base + under the canopy (sky occlusion)
  const gF = c.createLinearGradient(0, data.Z(plan.F), 0, data.Z(plan.F + 0.6));
  gF.addColorStop(0, 'rgba(0,0,255,0.4)');
  gF.addColorStop(1, 'rgba(0,0,255,0)');
  c.fillStyle = gF;
  c.fillRect(0, data.Z(plan.D), data.canvas.width, data.Z(plan.F + 0.6) - data.Z(plan.D));
  data.rect(plan.apron[0] + 0.2, plan.D, plan.apron[1] - 0.2, cz1, 'rgba(0,0,255,0.12)');
  c.globalCompositeOperation = 'source-over';
  c.filter = 'none';
}

const PAINT_W = 'rgba(236,234,224,0.93)';
const PAINT_Y = 'rgba(236,190,48,0.95)';
const SAFE_Y = '#e9b52f';

/** pavement word: tall elongated letters (US style), readable for a driver heading `toward` (n = −z, s = +z) */
function groundWord(p: GroundCanvas, text: string, cx: number, cz: number, letterH: number, color: string, toward: 'n' | 's' = 'n', maxW = 99) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(p.X(cx), p.Z(cz));
  if (toward === 's') ctx.rotate(Math.PI);
  const px = letterH * p.k;
  ctx.font = `800 ${Math.round(px / 2.3)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const sx = Math.min(1, (maxW * p.k) / w);
  ctx.scale(sx, 2.3);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** straight pavement arrow pointing toward ±z (len in m) */
function groundArrow(p: GroundCanvas, cx: number, cz: number, len: number, dir: 1 | -1, color = PAINT_W) {
  const { ctx } = p;
  const k = p.k;
  ctx.save();
  ctx.translate(p.X(cx), p.Z(cz));
  ctx.scale(k, k * dir);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-0.08, -len / 2);
  ctx.lineTo(0.08, -len / 2);
  ctx.lineTo(0.08, len / 2 - 0.9);
  ctx.lineTo(0.32, len / 2 - 0.9);
  ctx.lineTo(0, len / 2);
  ctx.lineTo(-0.32, len / 2 - 0.9);
  ctx.lineTo(-0.08, len / 2 - 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** diagonal hatching inside a world rect, with a border */
function hatch(p: GroundCanvas, x0: number, z0: number, x1: number, z1: number, color: string, gap = 0.7, w = 0.1) {
  const { ctx } = p;
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.X(x0), p.Z(z0), (x1 - x0) * p.k, (z1 - z0) * p.k);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = w * p.k * Math.SQRT2;
  const span = x1 - x0 + (z1 - z0);
  for (let s = -span; s < span; s += gap) {
    ctx.beginPath();
    ctx.moveTo(p.X(x0 + s), p.Z(z0));
    ctx.lineTo(p.X(x0 + s + (z1 - z0)), p.Z(z1));
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = w * p.k;
  ctx.strokeRect(p.X(x0) + (w * p.k) / 2, p.Z(z0) + (w * p.k) / 2, (x1 - x0 - w) * p.k, (z1 - z0 - w) * p.k);
}

/** markings, joints, crack sealant; then chipped by wear */
export function paintLotMarkings(plan: Plan, P: GroundCanvas, stalls: Stall[]) {
  const { ctx } = P;
  const rnd = rng(53);
  // concrete control joints: sidewalk every 1.5 m, plazas on a grid
  ctx.fillStyle = 'rgba(40,38,34,0.55)';
  for (let x = Math.ceil(plan.lotX0 / 1.5) * 1.5; x < plan.lotX1; x += 1.5) ctx.fillRect(P.X(x) - 1, P.Z(plan.F), 2, (plan.sidewalkZ1 - plan.F) * P.k);
  for (const [a, b] of [plan.dropoff, plan.clinicPlaza]) {
    if (b <= a) continue;
    for (let z = plan.sidewalkZ1; z < plan.stripZ1 + 0.2; z += 1.5) ctx.fillRect(P.X(a + 0.6), P.Z(z) - 1, (b - a - 1.2) * P.k, 2);
    for (let x = a + 0.6; x <= b - 0.6; x += 1.5) ctx.fillRect(P.X(x) - 1, P.Z(plan.sidewalkZ1), 2, (plan.stripZ1 + 0.25 - plan.sidewalkZ1) * P.k);
  }
  for (let x = Math.ceil(plan.lotX0 / 1.5) * 1.5; x < plan.lotX1; x += 1.5) ctx.fillRect(P.X(x) - 1, P.Z(plan.perimZ1), 2, 1.9 * P.k);
  // crack sealant: dark glossy squiggles on the asphalt
  ctx.strokeStyle = 'rgba(8,8,9,0.85)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 55; i++) {
    let x = plan.lotX0 + rnd() * (plan.lotX1 - plan.lotX0);
    let z = plan.stallZ0 + rnd() * (plan.aisleZ1 - plan.stallZ0);
    let a = rnd() * Math.PI * 2;
    ctx.lineWidth = (0.025 + rnd() * 0.03) * P.k;
    ctx.beginPath();
    ctx.moveTo(P.X(x), P.Z(z));
    for (let s = 0, n = 6 + rnd() * 16; s < n; s++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * 0.35;
      z += Math.sin(a) * 0.35;
      ctx.lineTo(P.X(x), P.Z(z));
    }
    ctx.stroke();
  }
  // stall lines + accessible aisle hatching
  const edges = new Set<number>();
  for (const s of stalls) {
    edges.add(Math.round(s.x0 * 100));
    edges.add(Math.round(s.x1 * 100));
  }
  for (const e of edges) P.rect(e / 100 - 0.05, plan.stallZ0, e / 100 + 0.05, plan.stallZ1, PAINT_W);
  for (const s of stalls) if (s.kind === 'aisle') hatch(P, s.x0 + 0.05, plan.stallZ0, s.x1 - 0.05, plan.stallZ1, PAINT_W, 0.6);
  for (const s of stalls) if (s.kind === 'aisle') groundWord(P, 'NO PARKING', (s.x0 + s.x1) / 2, plan.stallZ1 - 0.9, 0.5, PAINT_W, 'n', 2.4);
  // ambulance apron: two bays outlined in yellow, AMBULANCE ONLY, hatched no-parking strip
  const [a0, a1] = plan.apron;
  const bayA = plan.ambulance?.x ?? plan.ems.cx;
  const bays = [bayA, bayA - 4.0].filter((x) => x - 1.8 > a0 - 0.01);
  for (const cx of bays) {
    for (const x of [cx - 1.8, cx + 1.8]) P.rect(x - 0.06, plan.sidewalkZ1 + 0.3, x + 0.06, plan.stallZ1 + 2.2, PAINT_Y);
    groundWord(P, 'AMBULANCE', cx, plan.stallZ1 + 0.4, 1.2, PAINT_Y, 'n', 3.2);
    groundWord(P, 'ONLY', cx, plan.stallZ1 + 1.75, 1.2, PAINT_Y, 'n', 3.0);
  }
  const hx0 = bayA + 2.0;
  if (a1 - hx0 > 1.2) hatch(P, hx0, plan.sidewalkZ1 + 0.3, a1 - 0.3, plan.stallZ0 + 1.2, PAINT_Y, 0.85, 0.1);
  P.rect(a0 + 0.2, plan.stallZ1 + 2.2, a1 - 0.2, plan.stallZ1 + 2.32, PAINT_Y);
  // walk-in drop-off lane: dashed edge, PATIENT DROP-OFF, hatched ends
  const [d0, d1] = plan.dropoff;
  if (d1 > d0) {
    for (let x = d0 + 1.4; x < d1 - 1.4; x += 1.2) P.rect(x, plan.stallZ1 - 0.06, x + 0.6, plan.stallZ1 + 0.06, PAINT_W);
    groundWord(P, 'PATIENT', (d0 + d1) / 2, plan.stallZ0 + 1.0, 0.9, PAINT_W, 'n', 4);
    groundWord(P, 'DROP-OFF', (d0 + d1) / 2, plan.stallZ0 + 2.2, 0.9, PAINT_W, 'n', 4.4);
    hatch(P, d0 + 0.2, plan.stallZ0, d0 + 1.4, plan.stallZ1, PAINT_Y, 0.6);
    hatch(P, d1 - 1.4, plan.stallZ0, d1 - 0.2, plan.stallZ1, PAINT_Y, 0.6);
  }
  // crosswalks over the aisle at the entrances, stop bars + arrows at the driveways
  for (const cx of [plan.walkin?.cx, plan.clinic?.cx].filter((v): v is number => v !== undefined)) {
    for (let z = plan.stallZ1 + 0.4; z < plan.aisleZ1 - 0.4; z += 0.9) P.rect(cx - 1.5, z, cx + 1.5, z + 0.45, PAINT_W);
  }
  for (const [x0, x1] of plan.driveways) {
    P.rect(x0 + 0.3, plan.aisleZ1 + 0.4, (x0 + x1) / 2 - 0.1, plan.aisleZ1 + 0.7, PAINT_W);
    groundWord(P, 'STOP', (x0 + 3 * ((x0 + x1) / 2)) / 4 - 0.6, plan.aisleZ1 - 0.6, 1.1, PAINT_W, 's', 2.4);
    groundArrow(P, (3 * x1 + x0) / 4, plan.aisleZ1 - 2.2, 3.0, -1);
    P.rect((x0 + x1) / 2 - 0.06, plan.aisleZ1 + 0.4, (x0 + x1) / 2 + 0.06, plan.perimZ1 + 2.6, PAINT_Y);
  }
  for (const x of [plan.lotX0 + 18, plan.ems.cx + 16, plan.lotX1 - 14]) groundArrow(P, x, (plan.stallZ1 + plan.aisleZ1) / 2, 3.2, rnd() < 0.5 ? 1 : -1);
  // chip and fade everything painted
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = wearPattern(ctx, 3);
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, 0, P.canvas.width, P.canvas.height);
  ctx.restore();
}

// ───────────────────────────── vegetation ─────────────────────────────

/**
 * Leaf-cluster atlas (2×2 variants) composed at load time from the CC0 leaf set: a color
 * canvas (map) and a white-on-black canvas (alphaMap, which also cuts the sun shadows).
 */
let leafAtlas: { color: THREE.CanvasTexture; alpha: THREE.CanvasTexture } | null = null;
function leafTextures() {
  if (leafAtlas) return leafAtlas;
  const S = 1024;
  const col = makeCanvas(S, S);
  const alp = makeCanvas(S, S);
  alp.ctx.fillStyle = '#000';
  alp.ctx.fillRect(0, 0, S, S);
  const color = canvasTexture(col.canvas);
  const alpha = canvasTexture(alp.canvas);
  alpha.colorSpace = THREE.NoColorSpace;
  leafAtlas = { color, alpha };
  // a new world after disposeCaches() composes a fresh atlas
  color.addEventListener('dispose', () => (leafAtlas = null));
  const a = new Image();
  const c = new Image();
  let n = 0;
  const done = () => {
    if (++n < 2) return;
    // leaf sprites: color with the opacity map as alpha (3×3 leaves in the source)
    const src = makeCanvas(a.width, a.height);
    src.ctx.drawImage(c, 0, 0, a.width, a.height);
    const ca = makeCanvas(a.width, a.height);
    ca.ctx.drawImage(a, 0, 0);
    const pix = src.ctx.getImageData(0, 0, a.width, a.height);
    const op = ca.ctx.getImageData(0, 0, a.width, a.height).data;
    for (let i = 0; i < pix.data.length; i += 4) pix.data[i + 3] = op[i];
    src.ctx.putImageData(pix, 0, 0);
    const white = makeCanvas(a.width, a.height);
    white.ctx.drawImage(src.canvas, 0, 0);
    white.ctx.globalCompositeOperation = 'source-in';
    white.ctx.fillStyle = '#fff';
    white.ctx.fillRect(0, 0, a.width, a.height);
    const cell = a.width / 3;
    const rnd = rng(77);
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * (S / 2);
      const oy = Math.floor(q / 2) * (S / 2);
      const R = S / 4;
      for (const [cv, im] of [[col.ctx, src.canvas], [alp.ctx, white.canvas]] as [CanvasRenderingContext2D, HTMLCanvasElement][]) {
        const r2 = rng(100 + q);
        // twig, then ~40 leaves fanning out from it
        cv.strokeStyle = cv === col.ctx ? '#4a3a2a' : '#ffffff';
        cv.lineWidth = 5;
        cv.beginPath();
        cv.moveTo(ox + R, oy + S / 2 - 10);
        cv.quadraticCurveTo(ox + R * 0.8, oy + R, ox + R * (0.9 + r2() * 0.3), oy + 30);
        cv.stroke();
        for (let i = 0; i < 44; i++) {
          const t = r2();
          const lx = ox + R + (r2() - 0.5) * R * 1.55 * (0.4 + t);
          const ly = oy + 40 + t * (S / 2 - 90);
          const k = Math.floor(r2() * 9);
          const s = (0.2 + r2() * 0.12) * (S / 2 / cell);
          cv.save();
          cv.translate(lx, ly);
          cv.rotate((r2() - 0.5) * 2.6 + (lx < ox + R ? -0.6 : 0.6));
          cv.drawImage(im, (k % 3) * cell, Math.floor(k / 3) * cell, cell, cell, (-cell * s) / 2, (-cell * s) / 2, cell * s, cell * s);
          cv.restore();
        }
      }
      void rnd;
    }
    color.needsUpdate = true;
    alpha.needsUpdate = true;
  };
  a.onload = done;
  c.onload = done;
  a.src = resUrl('/res/tex/leaves/alpha.webp');
  c.src = resUrl('/res/tex/leaves/color.webp');
  return leafAtlas;
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>();
function leafMaterial(tint: string): THREE.MeshStandardMaterial {
  let m = leafMats.get(tint);
  if (!m) {
    const t = leafTextures();
    m = own(outdoor(new THREE.MeshStandardMaterial({ color: tint, map: t.color, alphaMap: t.alpha, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.72, vertexColors: true }), 0.8));
    leafMats.set(tint, m);
    m.addEventListener('dispose', () => leafMats.delete(tint));
  }
  return m;
}

/** card quad (w × h) using atlas quadrant q, centered at the origin facing +z */
function cardGeo(w: number, h: number, q: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const ox = (q % 2) * 0.5;
  const oy = 0.5 - Math.floor(q / 2) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ox + uv.getX(i) * 0.5, oy + uv.getY(i) * 0.5);
  return g;
}

/** leaf cards filling an ellipsoid crown; normals point away from the crown center (soft, volumetric shading) */
function crown(parent: THREE.Object3D, mat: THREE.Material, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, size: number, rnd: () => number, whole?: [number, number, number, number]) {
  // [x, y, z, r] of the whole tree crown: cards deep inside it are darker (self-shadowing)
  const [wx, wy, wz, wr] = whole ?? [cx, cy, cz, Math.max(rx, rz)];
  const tmp = new THREE.Object3D();
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Vector3(cx, cy, cz);
  for (let i = 0; i < count; i++) {
    // points biased toward the crown surface
    const u = rnd() * Math.PI * 2;
    const v = Math.acos(2 * rnd() - 1);
    const rr = 0.55 + 0.45 * Math.sqrt(rnd());
    const dir = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    if (dir.y < -0.55) dir.y *= 0.5;
    const p = new THREE.Vector3(cx + dir.x * rx * rr, cy + dir.y * ry * rr, cz + dir.z * rz * rr);
    const s = size * (0.75 + rnd() * 0.5);
    const g = cardGeo(s, s, Math.floor(rnd() * 4));
    tmp.position.copy(p);
    tmp.lookAt(p.clone().add(dir).add(new THREE.Vector3((rnd() - 0.5) * 1.6, (rnd() - 0.2) * 1.2, (rnd() - 0.5) * 1.6)));
    tmp.rotateZ(rnd() * Math.PI * 2);
    tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(nrm.count * 3);
    for (let k = 0; k < nrm.count; k++) {
      const n = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(c).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
      nrm.setXYZ(k, n.x, n.y, n.z);
      const depth = Math.min(1, Math.hypot(pos.getX(k) - wx, (pos.getY(k) - wy) * 1.3, pos.getZ(k) - wz) / wr);
      const v = (0.42 + 0.58 * depth * depth) * (0.9 + rnd() * 0.2);
      col[k * 3] = v;
      col[k * 3 + 1] = v;
      col[k * 3 + 2] = v * 0.96;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  if (merged) add(parent, trackGeo(merged), mat);
}

const barkMat = () => extPbr('bark', { color: '#8a8178', tile: 0.7, roughness: 0.95, worldUV: false });

/** deciduous tree: tapered trunk, a few curved limbs, leaf-card crown */
export function tree(parent: THREE.Object3D, x: number, z: number, o: { h: number; r: number; seed: number; tint?: string; trunk?: number; cards?: number }) {
  const rnd = rng(o.seed);
  const bark = barkMat();
  const th = o.h * 0.42;
  const tr = o.trunk ?? 0.11 + o.h * 0.012;
  const trunk = new THREE.CylinderGeometry(tr * 0.72, tr, th, 10, 3);
  const uv = trunk.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * th * 1.4);
  add(parent, trackGeo(trunk), bark, x, th / 2, z, (rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.05);
  const top = new THREE.Vector3(x, th, z);
  const cy = th + (o.h - th) * 0.5;
  for (let i = 0, n = 5 + Math.floor(rnd() * 3); i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const reach = o.r * (0.45 + rnd() * 0.35);
    const pts = [top.clone(), new THREE.Vector3(x + Math.cos(a) * reach * 0.35, th + (o.h - th) * (0.25 + rnd() * 0.15), z + Math.sin(a) * reach * 0.35), new THREE.Vector3(x + Math.cos(a) * reach, cy + (rnd() - 0.2) * (o.h - th) * 0.45, z + Math.sin(a) * reach)];
    const curve = new THREE.CatmullRomCurve3(pts);
    add(parent, trackGeo(new THREE.TubeGeometry(curve, 8, tr * (0.42 + rnd() * 0.15), 6, false)), bark);
  }
  const leaves = leafMaterial(o.tint ?? '#a7b38c');
  const total = Math.round((150 + o.r * o.r * 26) * (o.cards ?? 1));
  const ry = (o.h - th) * 0.55;
  // a central mass + 4–6 lobes around it: an irregular, believable crown silhouette
  crown(parent, leaves, x, cy, z, o.r * 0.78, ry * 0.85, o.r * 0.78, Math.round(total * 0.4), 0.95 / Math.sqrt(o.cards ?? 1), rnd, [x, cy, z, o.r]);
  const lobes = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rnd() * 0.8;
    const d = o.r * (0.45 + rnd() * 0.25);
    const lr = o.r * (0.42 + rnd() * 0.18);
    crown(parent, leaves, x + Math.cos(a) * d, cy + (rnd() - 0.35) * ry * 0.7, z + Math.sin(a) * d, lr, lr * 0.85, lr, Math.round((total * 0.6) / lobes), 0.95 / Math.sqrt(o.cards ?? 1), rnd, [x, cy, z, o.r]);
  }
}

/** rounded shrub mass of leaf cards (darker, denser) */
export function shrub(parent: THREE.Object3D, x: number, z: number, r: number, h: number, seed: number, y0 = 0.12) {
  const rnd = rng(seed);
  crown(parent, leafMaterial('#86946e'), x, y0 + h * 0.45, z, r, h * 0.55, r, Math.round(24 + r * r * 60), 0.5, rnd);
}

/** raised planting island: rounded concrete curb, lawn or mulch top; returns its collider */
export function island(parent: THREE.Object3D, x0: number, z0: number, x1: number, z1: number, top: 'lawn' | 'mulch' = 'lawn'): THREE.Box3 {
  const curb = extPbr('sidewalk', { color: '#d9d6cf', tile: 1.3, roughness: 0.95 });
  const cw = 0.15;
  const ch = 0.17;
  add(parent, G.rbox(x1 - x0, ch, cw, 0.035), curb, (x0 + x1) / 2, ch / 2 - 0.02, z0 + cw / 2);
  add(parent, G.rbox(x1 - x0, ch, cw, 0.035), curb, (x0 + x1) / 2, ch / 2 - 0.02, z1 - cw / 2);
  add(parent, G.rbox(cw, ch, z1 - z0 - 2 * cw + 0.02, 0.035), curb, x0 + cw / 2, ch / 2 - 0.02, (z0 + z1) / 2);
  add(parent, G.rbox(cw, ch, z1 - z0 - 2 * cw + 0.02, 0.035), curb, x1 - cw / 2, ch / 2 - 0.02, (z0 + z1) / 2);
  const mat = top === 'lawn' ? extPbr('grass', { color: '#b3bd9a', tile: 1.6, roughness: 1 }) : extPbr('bark', { color: '#5a4a3e', tile: 0.8, roughness: 1 });
  parent.add(new THREE.Mesh(flatGeo(x0 + cw - 0.01, z0 + cw - 0.01, x1 - cw + 0.01, z1 - cw + 0.01, 0.125), mat));
  return boxCollider((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0.6);
}

// ───────────────────────────── building skin ─────────────────────────────

/**
 * Window glass that shows a lit room behind it ("interior mapping"): the view ray is traced
 * into a box (cell × wallHeight × depth) and shaded as ceiling with LED troffers, walls and
 * floor; some rooms have blinds down, a few are dark. N = outward normal, T = lateral axis.
 */
export function interiorGlass(N: THREE.Vector3, T: THREE.Vector3, o: { depth: number; cell: number; H: number; y0: number; y1: number; seed: number; floor?: number }) {
  const m = new MeshStandardNodeMaterial({ color: '#0a0e11', roughness: 0.03, metalness: 0 });
  const uGlow = uniform(1.0);
  const nN = vec3(N.x, N.y, N.z);
  const nT = vec3(T.x, T.y, T.z);
  m.emissiveNode = Fn(() => {
    const P = positionWorld;
    const V = P.sub(cameraPosition).normalize();
    const lat = dot(P, nT);
    const vl = dot(V, nT);
    const vd = max(dot(V, nN).negate(), 0.03);
    const vy = V.y;
    // height above the room's floor (an upper storey's windows: floors.ts)
    const y = P.y.sub(o.floor ?? 0);
    const ci = floor(lat.div(o.cell));
    const l0 = ci.mul(o.cell);
    const l1 = l0.add(o.cell);
    const big = float(1e4);
    const tB = float(o.depth).div(vd);
    const tS = select(vl.greaterThan(0), l1.sub(lat).div(max(vl, 1e-4)), l0.sub(lat).div(min(vl, -1e-4)));
    const tF = select(vy.lessThan(0), y.div(max(vy.negate(), 1e-4)), big);
    const tC = select(vy.greaterThan(0), float(o.H).sub(y).div(max(vy, 1e-4)), big);
    const t = min(min(tB, tS), min(tF, tC));
    const hl = lat.add(vl.mul(t)).sub(l0);
    const hy = y.add(vy.mul(t));
    const hd = vd.mul(t);
    const h1 = fract(sin(ci.mul(12.9898).add(o.seed)).mul(43758.5453));
    const h2 = fract(h1.mul(17.31).add(0.37));
    const wallCol = mix(vec3(0.8, 0.78, 0.72), vec3(0.7, 0.79, 0.77), step(0.62, h2)).mul(mix(float(0.42), float(1.0), hy.div(o.H)));
    // ceiling: two rows of 0.6 × 1.2 m troffers across the room
    const lc = hl.sub(o.cell / 2).abs();
    const panel = step(lc, 0.32).mul(min(step(hd.sub(1.2).abs(), 0.62).add(step(hd.sub(3.1).abs(), 0.62)), 1));
    const ceil = vec3(0.72, 0.72, 0.7).add(vec3(4.2, 4.0, 3.6).mul(panel));
    const floorC = vec3(0.4, 0.38, 0.34).mul(float(1).sub(step(0.96, fract(hl.mul(1.66))).mul(0.25)));
    // back wall: a darker door leaf or a pinboard
    const back = wallCol.mul(float(1).sub(step(hl.sub(h2.mul(0.5).add(0.25).mul(o.cell)).abs(), 0.45).mul(step(hy, 2.1)).mul(0.35)));
    let col = select(tC.lessThanEqual(t), ceil, select(tF.lessThanEqual(t), floorC, select(tS.lessThanEqual(t), wallCol.mul(0.85), back)));
    // warm (patient rooms) or neutral-cool (offices) LED light, brighter near the window
    const tint = mix(vec3(1.0, 0.9, 0.76), vec3(0.9, 0.95, 1.0), step(0.55, fract(h1.mul(7.7))));
    col = col.mul(float(1).sub(hd.div(o.depth * 2.6))).mul(tint).mul(1.05);
    col = col.mul(select(h1.lessThan(0.13), float(0.04), float(1)));
    // blinds lowered from the head, lit from behind (slats)
    const level = select(h2.greaterThan(0.42), h1.mul(0.85), float(0));
    const blindY = float(o.y1).sub(level.mul(o.y1 - o.y0));
    const slat = float(1).sub(step(0.85, fract(y.mul(24))).mul(0.3));
    const blind = vec3(0.9, 0.86, 0.76).mul(slat).mul(select(h1.lessThan(0.13), float(0.05), float(0.95)));
    col = select(y.greaterThan(blindY), blind, col);
    // the glass reflects more at grazing angles: less of the room shows
    const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(vd), 5)));
    return col.mul(float(1).sub(fres)).mul(uGlow);
  })();
  outdoor(m, 1.25);
  return { mat: m as unknown as THREE.MeshStandardMaterial, glow: uGlow };
}

/** one façade line: origin, lateral axis T (left → right seen from outside), outward normal N, length */
export interface FacadeLine {
  O: THREE.Vector3;
  T: THREE.Vector3;
  N: THREE.Vector3;
  len: number;
  /** openings [u0, u1, v0, v1] (doors) */
  doors: [number, number, number, number][];
  /** recesses for wall-mounted signs [u0, u1, v0, v1] */
  holes: [number, number, number, number][];
  /** window spans [u0, u1] (sill/head are shared) */
  windows: [number, number][];
  /** full-height gaps [u0, u1]: something else is built against the wall there (an elevator shaft) */
  cut?: [number, number][];
  /** no coping over [u0, u1]: an upper floor's façade carries on up there (shared/floors.ts) */
  capCut?: [number, number][];
}

/** an upper floor's skin (floors.ts): no brick base, cladding from `from`, see-through window openings */
export interface SkinOpts {
  from?: number;
  see?: boolean;
}

const SILL = 0.95;
const HEAD = 2.62;
const MOD = 1.2;

export function facadeSkin(g: THREE.Object3D, f: FacadeLine, glass: THREE.Material, top: number, seed: number, opts: SkinOpts = {}) {
  const rnd = rng(seed);
  const cut = f.cut ?? [];
  const from = opts.from ?? 0;
  const ry = Math.atan2(-f.T.z, f.T.x);
  const at = (u: number, v: number, off: number) => f.O.clone().addScaledVector(f.T, u).add(new THREE.Vector3(0, v, 0)).addScaledVector(f.N, off);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, u: number, v: number, off: number) => {
    const p = at(u, v, off);
    return add(g, geo, mat, p.x, p.y, p.z, 0, ry, 0);
  };
  const backing = solid('#17191b', 0.7);
  const brick = extPbr('brick', { color: '#c9b8a6', tile: 1.25, roughness: 0.9, normalScale: 0.9 });
  const precast = extPbr('sidewalk', { color: '#e4e0d8', tile: 1.2, roughness: 0.85 });
  const frame = solid('#2b2926', 0.38, 0.65);
  const coping = solid('#9da2a5', 0.35, 0.8);
  const panels = cachedPanels();
  // dark backing behind the cladding (shows in the reveals and behind the glass), open at the doors
  // (and, on a floor you can look out of, at the windows). A 1 mm sheet that keeps ≥ 2 mm off the
  // brick's back (0.16) and the sign reveals' (0.165), and stops inside the corner panels. At the
  // doors and cuts it opens 3 mm wider than the brick does, so its edges end inside the brick.
  const doorSpans = f.doors.map(([a, b, , d]) => [a - 0.123, b + 0.123, d + 0.45] as [number, number, number]);
  const cutWide = cut.map(([a, b]) => [a - 0.003, b + 0.003] as [number, number]);
  const backs = (gaps: [number, number][], v0: number, v1: number) => {
    for (const [a, b] of subtractSpans(-0.205, f.len + 0.205, [...gaps, ...cutWide], 0.02)) put(G.box(b - a, v1 - v0, 0.001), backing, (a + b) / 2, (v0 + v1) / 2, 0.163);
  };
  if (opts.see && f.windows.length) {
    backs(doorSpans.map(([a0, b0]) => [a0, b0] as [number, number]), from, SILL);
    backs([...doorSpans.map(([a0, b0]) => [a0, b0] as [number, number]), ...f.windows], SILL, HEAD);
    backs([], HEAD, top);
  } else backs(doorSpans.map(([a0, b0]) => [a0, b0] as [number, number]), from, top);
  for (const [a, b, h] of doorSpans) put(G.box(b - a, top - h + 0.4, 0.001), backing, (a + b) / 2, (top + h - 0.4) / 2, 0.163);
  // brick base course + precast sill band, interrupted at doors (ground floor only)
  const cuts = [...f.doors.filter(([, , c]) => c < 0.9).map(([a, b]) => [a - 0.12, b + 0.12] as [number, number]), ...cut].sort((p, q) => p[0] - q[0]);
  let u = -0.22;
  for (const [a, b] of from > 0 ? [] : [...cuts, [f.len + 0.22, f.len + 0.22] as [number, number]]) {
    if (a - u > 0.05) {
      put(G.box(a - u, 0.8, 0.06), brick, (u + a) / 2, 0.4, 0.19);
      put(G.rbox(a - u, 0.1, 0.085, 0.012), precast, (u + a) / 2, 0.85, 0.2);
    }
    u = Math.max(u, b);
  }
  // metal panels in two rows with 2 cm reveals: each solid span between openings is divided into
  // ~1.2 m modules (so panels always meet the window/door frames); slight tint variation per panel
  const rows: [number, number][] = [[from > 0 ? from : 0.9, HEAD + 0.05], [HEAD + 0.05, top]];
  for (const [v0, v1] of rows) {
    const gaps: [number, number][] = [
      ...f.doors.filter(([, , c, d]) => c < v1 && d + 0.45 > v0).map(([a, b]) => [a - 0.12, b + 0.12] as [number, number]),
      ...f.holes.filter(([, , c, d]) => c < v1 && d > v0).map(([a, b]) => [a, b] as [number, number]),
      ...(v0 < HEAD ? f.windows : []),
      ...cut,
    ];
    // corners: the S/N panels run on to 3 mm behind the face of the E/W ones, which stop against
    // their backs (so no two tints share a face; likewise where an upper floor's E/W wall rises
    // from the roof at the edge, in front of the storey below)
    const end = Math.abs(f.T.x) > 0.5 ? 0.217 : 0.18;
    for (const [a, b] of subtractSpans(-end, f.len + end, gaps, 0.06)) {
      const n = Math.max(1, Math.round((b - a) / MOD));
      const w = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const geo = G.box(w - 0.02, v1 - v0 - 0.02, 0.04).clone();
        const k = 0.95 + rnd() * 0.07;
        geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3).fill(k), 3));
        trackGeo(geo);
        put(geo, v0 >= HEAD ? panels.dark : panels.light, a + (i + 0.5) * w, (v0 + v1) / 2, 0.19);
      }
    }
  }
  // windows: recessed glass, bronze frame with a center mullion + transom, aluminium sill flashing
  for (const [a, b] of f.windows) {
    const w = b - a;
    const cu = (a + b) / 2;
    put(G.plane(w - 0.04, HEAD - SILL - 0.04), glass, cu, (SILL + HEAD) / 2, 0.168);
    for (const v of [SILL + 0.025, HEAD - 0.025, 2.18]) put(G.rbox(w, 0.05, 0.07, 0.01), frame, cu, v, 0.19);
    for (const uu of [a + 0.025, b - 0.025, ...(w > 1.7 ? [cu] : [])]) put(G.rbox(0.05, HEAD - SILL, 0.07, 0.01), frame, uu, (SILL + HEAD) / 2, 0.19);
    put(G.rbox(w + 0.08, 0.025, 0.1, 0.008), coping, cu, SILL - 0.012, 0.225);
  }
  // storefront frames around doors, glass transom above
  for (const [a, b, , d] of f.doors) {
    const cu = (a + b) / 2;
    for (const uu of [a - 0.05, b + 0.05]) put(G.rbox(0.1, d + 0.42, 0.12, 0.012), frame, uu, (d + 0.42) / 2, 0.18);
    put(G.rbox(b - a + 0.2, 0.08, 0.12, 0.012), frame, cu, d + 0.04, 0.18);
    put(G.rbox(b - a + 0.2, 0.06, 0.12, 0.012), frame, cu, d + 0.42, 0.18);
    put(G.plane(b - a, 0.3), glass, cu, d + 0.23, 0.168);
  }
  // sign recesses: a thin reveal frame
  for (const [a, b, c, d] of f.holes) {
    put(G.box(b - a, 0.03, 0.05), frame, (a + b) / 2, c, 0.19);
    put(G.box(b - a, 0.03, 0.05), frame, (a + b) / 2, d, 0.19);
  }
  // coping cap over the parapet (not where an upper floor carries on up, nor over a cut)
  for (const [a, b] of subtractSpans(-0.25, f.len + 0.25, [...(f.capCut ?? []), ...cut], 0.05)) put(G.rbox(b - a, 0.07, 0.46, 0.015), coping, (a + b) / 2, top + 0.035, 0.02);
}

/** the four façade lines with their doors, sign recesses and windows (from the rooms behind them) */
export function facadeLines(layout: LayoutDef, plan: Plan): { key: 'S' | 'E' | 'W' | 'N'; line: FacadeLine }[] {
  const { W, D } = plan;
  const sides = [
    { key: 'S' as const, side: 's' as const, O: new THREE.Vector3(0, 0, D), T: new THREE.Vector3(1, 0, 0), N: new THREE.Vector3(0, 0, 1), len: W },
    { key: 'E' as const, side: 'e' as const, O: new THREE.Vector3(W, 0, D), T: new THREE.Vector3(0, 0, -1), N: new THREE.Vector3(1, 0, 0), len: D },
    { key: 'W' as const, side: 'w' as const, O: new THREE.Vector3(0, 0, 0), T: new THREE.Vector3(0, 0, 1), N: new THREE.Vector3(-1, 0, 0), len: D },
    { key: 'N' as const, side: 'n' as const, O: new THREE.Vector3(W, 0, 0), T: new THREE.Vector3(-1, 0, 0), N: new THREE.Vector3(0, 0, -1), len: W },
  ];
  const onLine = (r: RoomDef, s: string) => (s === 's' ? Math.abs(r.rect.z + r.rect.d - D) < 0.01 : s === 'n' ? Math.abs(r.rect.z) < 0.01 : s === 'e' ? Math.abs(r.rect.x + r.rect.w - W) < 0.01 : Math.abs(r.rect.x) < 0.01);
  return sides.map((s) => {
    // u along T of a world point on this line
    const U = (x: number, z: number) => (x - s.O.x) * s.T.x + (z - s.O.z) * s.T.z;
    const line: FacadeLine = { O: s.O, T: s.T, N: s.N, len: s.len, doors: [], holes: [], windows: [] };
    // shared/floors.ts: where an upper floor's façade carries on up from this line there is no coping,
    // and the skin stops where an elevator shaft is built against the wall
    const alongX = s.side === 's' || s.side === 'n';
    const edge = s.side === 's' ? D : s.side === 'e' ? W : 0;
    const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
    for (const u of upperOutlines(layout)) {
      const touches = alongX ? Math.abs(u.z - edge) < 0.01 || Math.abs(u.z + u.d - edge) < 0.01 : Math.abs(u.x - edge) < 0.01 || Math.abs(u.x + u.w - edge) < 0.01;
      if (touches) (line.capCut ??= []).push(alongX ? span(U(u.x, 0), U(u.x + u.w, 0)) : span(U(0, u.z), U(0, u.z + u.d)));
    }
    for (const bank of elevatorBanks(layout)) {
      const sh = shaftExtent(bank);
      if (alongX && Math.abs(bank.wallZ - edge) < 0.01) (line.cut ??= []).push(span(U(sh.x0, 0), U(sh.x1, 0)));
    }
    const spans: [number, number][] = [];
    for (const r of layout.rooms) {
      if (r.kind === 'exterior' || !onLine(r, s.side)) continue;
      const along = s.side === 's' || s.side === 'n';
      const a = U(r.rect.x, r.rect.z);
      const b = along ? U(r.rect.x + r.rect.w, r.rect.z) : U(r.rect.x, r.rect.z + r.rect.d);
      const [u0, u1] = [Math.min(a, b), Math.max(a, b)];
      for (const d of r.doors) {
        if (d.side !== s.side || !d.exterior) continue;
        const da = along ? U(r.rect.x + d.offset, 0) : U(0, r.rect.z + d.offset);
        const db = along ? U(r.rect.x + d.offset + d.width, 0) : U(0, r.rect.z + d.offset + d.width);
        line.doors.push([Math.min(da, db), Math.max(da, db), 0, 2.25]);
      }
      if (s.key !== 'N' && r.kind !== 'utility' && r.kind !== 'corridor' && r.kind !== 'imaging') spans.push([u0 + 0.7, u1 - 0.7]);
    }
    // per room: as many 2.4 m windows as fit with 1.2 m piers, centered; none next to doors
    for (const [a, b] of spans) {
      const n = Math.floor((b - a + MOD) / (3 * MOD));
      const start = (a + b) / 2 - (n * 3 * MOD - MOD) / 2;
      for (let i = 0; i < n; i++) {
        const w0 = start + i * 3 * MOD;
        const w1 = w0 + 2 * MOD;
        if (line.doors.some(([d0, d1]) => w0 < d1 + 1.0 && w1 > d0 - 1.0)) continue;
        line.windows.push([w0, w1]);
      }
    }
    // wall-mounted exterior plaques on this façade's face get a recess
    for (const p of layout.props) {
      if (p.room !== 'exterior' || (p.kind !== 'wallSign' && p.kind !== 'poster')) continue;
      const off = (p.x - s.O.x) * s.N.x + (p.z - s.O.z) * s.N.z;
      if (Math.abs(off - 0.12) > 0.06) continue;
      const cu = U(p.x, p.z);
      const w = p.w ?? 0.4;
      line.holes.push([cu - w / 2 - 0.12, cu + w / 2 + 0.12, (p.y ?? 1.2) - 0.1, (p.y ?? 1.2) + (p.h ?? 0.5) + 0.1]);
    }
    return { key: s.key, line };
  });
}

/** ambulance canopy over the EMS doors: two guarded columns, fascia carrying the sign, LED soffit */
export function emsCanopy(g: THREE.Object3D, plan: Plan, colliders: THREE.Box3[], lights: ExtLight[]) {
  const x0 = plan.apron[0] + 0.4;
  const x1 = plan.apron[1] - 0.4;
  const zF = plan.emsSign ? plan.emsSign.z - 0.012 : plan.F + 3.4;
  const zB = plan.F - 0.06;
  const soffitY = 3.38;
  const fasciaB = plan.emsSign ? Math.min(2.92, (plan.emsSign.y ?? 2.98) - 0.06) : 2.92;
  const acm = solid('#2a2e32', 0.42, 0.25);
  const soffit = solid('#c9ccce', 0.45, 0.3);
  const steel = solid('#3b4146', 0.45, 0.55);
  const guard = solid(SAFE_Y, 0.5, 0.1);
  const cx = (x0 + x1) / 2;
  const w = x1 - x0;
  // roof slab + soffit panels with linear joints
  add(g, G.box(w, 0.42, zF - zB - 0.28), solid('#8e9296', 0.9), cx, soffitY + 0.21, (zB + zF - 0.28) / 2);
  add(g, G.box(w - 0.04, 0.02, zF - zB - 0.3), soffit, cx, soffitY - 0.01, (zB + zF - 0.3) / 2);
  for (let z = zB + 0.3; z < zF - 0.35; z += 0.3) add(g, G.box(w - 0.06, 0.006, 0.012), solid('#7d8286', 0.5), cx, soffitY - 0.022, z);
  // fascia band (front + returns), metal coping
  add(g, G.rbox(w + 0.3, 3.98 - fasciaB, 0.3, 0.02), acm, cx, (fasciaB + 3.98) / 2, zF - 0.15);
  for (const x of [x0 - 0.15, x1 + 0.15]) add(g, G.box(0.3, 3.98 - soffitY + 0.1, zF - zB), acm, x, (soffitY - 0.1 + 3.98) / 2, (zB + zF) / 2);
  add(g, G.rbox(w + 0.42, 0.06, 0.4, 0.012), solid('#9da2a5', 0.35, 0.8), cx, 4.01, zF - 0.15);
  // columns: round steel on a concrete plinth, safety-yellow guard sleeve, a downspout on one
  for (const x of [x0 + 0.5, x1 - 0.5]) {
    const z = zF - 0.55;
    add(g, G.cyl(0.19, 0.19, soffitY, 24), steel, x, soffitY / 2, z);
    add(g, G.cyl(0.36, 0.38, 0.16, 24), extPbr('sidewalk', { color: '#cfcac0', tile: 1 }), x, 0.08, z);
    add(g, G.cyl(0.27, 0.27, 1.15, 24), guard, x, 0.16 + 0.575, z);
    add(g, G.torus(0.27, 0.02, 6, 24), solid('#1b1c1d', 0.6), x, 0.16 + 1.15, z, Math.PI / 2, 0, 0);
    for (const y of [0.5, 0.85]) add(g, G.cyl(0.275, 0.275, 0.06, 24), solid('#1b1c1d', 0.6), x, y, z);
    colliders.push(boxCollider(x, z, 0.38, 0.38));
  }
  add(g, G.cyl(0.055, 0.055, soffitY - 0.2, 10), solid('#6f767b', 0.5, 0.5), x1 - 0.5 + 0.24, (soffitY - 0.2) / 2 + 0.1, zF - 0.55);
  // recessed LED downlights in two rows; every other one is a real light
  const lens = solid('#ffffff', 0.4, 0, { emissive: '#fff4e2', ei: 5 });
  const n = Math.max(3, Math.round(w / 2.4));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * w) / n;
    for (const [j, z] of [zB + 1.0, zF - 1.0].entries()) {
      add(g, G.cyl(0.13, 0.13, 0.03, 20), solid('#e8eaeb', 0.3, 0.6), x, soffitY - 0.02, z);
      add(g, G.circle(0.1, 20), lens, x, soffitY - 0.037, z, Math.PI / 2, 0, 0);
      if ((i + j) % 2 === 0) lights.push({ kind: 'spot', pos: new THREE.Vector3(x, soffitY - 0.08, z), target: new THREE.Vector3(x, 0, z + 0.4), color: '#fff1dc', intensity: 26, distance: 11, angle: 1.05, penumbra: 0.75, always: true });
    }
  }
  // the red EMERGENCY letters tint the bay and the wet ground
  if (plan.emsSign) lights.push({ kind: 'point', pos: new THREE.Vector3(plan.emsSign.x, 3.3, zF + 0.9), color: '#ff3a2a', intensity: 3.2, distance: 9 });
  return { zF, zB, x0, x1, soffitY };
}

/** packaged rooftop units, exhaust fans and vent pipes (seen over the parapet) */
export function roofEquipment(g: THREE.Object3D, plan: Plan, layout: LayoutDef) {
  const rnd = rng(91);
  const roofY = plan.H + 0.27;
  // (not where a stair tower or an upper floor stands on the roof)
  const towers = [...layout.rooms.filter((r) => r.kind !== 'exterior' && (r.ceilingHeight ?? plan.H) > plan.H + 0.01).map((r) => r.rect), ...upperOutlines(layout)];
  const freeAt = (x: number, z: number, r: number) => !towers.some((t) => x > t.x - r && x < t.x + t.w + r && z > t.z - r && z < t.z + t.d + r);
  const sheet = solid('#c3c2bb', 0.48, 0.45);
  const louver = louverMat();
  const curb = solid('#55595c', 0.7, 0.2);
  const dark = solid('#202224', 0.55, 0.3);
  for (let x = 6; x < plan.W - 4; x += 10 + rnd() * 4) {
    const z = plan.D * (0.42 + rnd() * 0.18);
    if (!freeAt(x, z, 2.5)) continue;
    const L = 2.6 + rnd() * 1.2;
    add(g, G.box(L + 0.2, 0.35, 1.7), curb, x, roofY + 0.175, z);
    add(g, G.rbox(L, 1.2, 1.55, 0.03), sheet, x, roofY + 0.35 + 0.6, z);
    for (const s of [-1, 1]) add(g, G.plane(L - 0.2, 0.9), louver, x, roofY + 0.95, z + s * 0.782, 0, s > 0 ? 0 : Math.PI, 0);
    for (const dx of [-L / 4, L / 4]) {
      add(g, G.cyl(0.42, 0.42, 0.12, 24), dark, x + dx, roofY + 1.61, z);
      add(g, G.torus(0.38, 0.015, 4, 24), solid('#8a8f92', 0.4, 0.8), x + dx, roofY + 1.68, z, Math.PI / 2, 0, 0);
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = 3 + rnd() * (plan.W - 6);
    const z = plan.D * (0.25 + rnd() * 0.45);
    if (!freeAt(x, z, 1)) continue;
    if (i % 3 === 0) {
      add(g, G.cyl(0.32, 0.36, 0.5, 16), sheet, x, roofY + 0.25, z);
      add(g, G.cone(0.48, 0.24, 16), sheet, x, roofY + 0.62, z);
    } else add(g, G.cyl(0.05, 0.05, 0.6, 8), solid('#d8d8d2', 0.6), x, roofY + 0.3, z);
  }
}

let louverTex: THREE.MeshStandardMaterial | null = null;
function louverMat(): THREE.MeshStandardMaterial {
  if (louverTex && louverTex.userData.outdoor) return louverTex;
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = '#b7b6ae';
  ctx.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 128; y += 8) {
    ctx.fillStyle = '#5d5f60';
    ctx.fillRect(0, y + 5, 256, 3);
  }
  louverTex = own(outdoor(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.5, metalness: 0.4 })));
  louverTex.addEventListener('dispose', () => (louverTex = null));
  return louverTex;
}

// ───────────────────────────── site furniture ─────────────────────────────

/** steel pipe bollard (stainless sleeve, domed cap) or an LED light bollard */
export function bollard(g: THREE.Object3D, x: number, z: number, kind: 'steel' | 'light', glow: THREE.Material): THREE.Box3 {
  if (kind === 'steel') {
    add(g, G.cyl(0.085, 0.085, 0.92, 16), solid('#c4c7c9', 0.22, 1), x, 0.46, z);
    add(g, G.sphere(0.085, 14, 6), solid('#c4c7c9', 0.22, 1), x, 0.92, z);
    add(g, G.cyl(0.087, 0.087, 0.05, 16), solid('#d8a531', 0.4, 0.1), x, 0.78, z);
  } else {
    add(g, G.cyl(0.1, 0.1, 0.95, 18), solid('#1d2022', 0.4, 0.5), x, 0.475, z);
    add(g, G.cyl(0.092, 0.092, 0.1, 18), glow, x, 0.86, z);
    add(g, G.cyl(0.11, 0.11, 0.04, 18), solid('#1d2022', 0.4, 0.5), x, 0.97, z);
  }
  return boxCollider(x, z, 0.1, 0.1, 1);
}

/** backless park bench: cast legs + hardwood slats */
export function bench(g: THREE.Object3D, x: number, z: number, rot: number) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  g.add(grp);
  const wood = extPbr('wood', { color: '#a8764e', tile: 0.9, roughness: 0.6 });
  const metal = solid('#26292b', 0.45, 0.6);
  for (const sx of [-0.72, 0.72]) {
    add(grp, G.rbox(0.07, 0.42, 0.5, 0.02), metal, sx, 0.21, 0);
    add(grp, G.box(0.09, 0.03, 0.56), metal, sx, 0.01, 0);
  }
  for (let i = 0; i < 4; i++) add(grp, G.rbox(1.8, 0.035, 0.1, 0.012), wood, 0, 0.45, -0.17 + i * 0.115);
  return boxCollider(x, z, 0.92, 0.92, 0.5);
}

/** steel litter receptacle with vertical bars and a dome lid */
export function bin(g: THREE.Object3D, x: number, z: number): THREE.Box3 {
  const metal = solid('#1f2224', 0.5, 0.55);
  add(g, G.cyl(0.25, 0.25, 0.04, 20), metal, x, 0.02, z);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add(g, G.box(0.03, 0.82, 0.012), metal, x + Math.cos(a) * 0.25, 0.43, z + Math.sin(a) * 0.25, 0, -a, 0);
  }
  add(g, G.cyl(0.235, 0.235, 0.78, 16, ), solid('#3a3d3f', 0.8), x, 0.42, z);
  add(g, G.sphere(0.27, 16, 6), metal, x, 0.84, z);
  return boxCollider(x, z, 0.28, 0.28, 1);
}

/** inverted-U stainless bike hoops */
export function bikeRack(g: THREE.Object3D, x: number, z: number, n: number) {
  const st = solid('#c9ccce', 0.25, 1);
  for (let i = 0; i < n; i++) {
    const cx = x + i * 0.9;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(cx, 0, z - 0.3), new THREE.Vector3(cx, 0.78, z - 0.3), new THREE.Vector3(cx, 0.9, z), new THREE.Vector3(cx, 0.78, z + 0.3), new THREE.Vector3(cx, 0, z + 0.3)], false, 'catmullrom', 0.1);
    add(g, trackGeo(new THREE.TubeGeometry(curve, 24, 0.024, 8, false)), st);
  }
}

/** round cast-iron cover (manhole / storm inlet) */
export function manhole(g: THREE.Object3D, x: number, z: number, r = 0.34) {
  add(g, G.cyl(r + 0.05, r + 0.05, 0.03, 28), solid('#3a3734', 0.75, 0.3), x, 0.0, z);
  add(g, G.cyl(r, r, 0.03, 28), ironMat(), x, 0.006, z);
}

/** rectangular slotted grate (curb inlet / trench drain) */
export function grate(g: THREE.Object3D, x: number, z: number, w: number, l: number) {
  add(g, G.box(w + 0.08, 0.02, l + 0.08), solid('#4a4642', 0.7, 0.2), x, 0.0, z);
  add(g, G.box(w, 0.02, l), solid('#0d0d0d', 0.9), x, 0.003, z);
  const bar = solid('#2e2c2a', 0.6, 0.6);
  const along = w > l;
  for (let i = 0, n = Math.floor((along ? w : l) / 0.06); i < n; i++) {
    const t = -((along ? w : l) / 2) + (i + 0.5) * 0.06;
    add(g, G.box(along ? 0.02 : w - 0.006, 0.022, along ? l - 0.006 : 0.02), bar, x + (along ? t : 0), 0.008, z + (along ? 0 : t));
  }
}

let iron: THREE.MeshStandardMaterial | null = null;
function ironMat(): THREE.MeshStandardMaterial {
  if (iron && iron.userData.outdoor) return iron;
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#2f2d2b';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#4a4744';
  ctx.lineWidth = 6;
  for (const r of [40, 75, 110]) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40);
    ctx.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110);
    ctx.stroke();
  }
  ctx.fillStyle = '#56524e';
  ctx.font = '700 22px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STORM', 128, 136);
  iron = own(outdoor(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.55, metalness: 0.65 })));
  iron.addEventListener('dispose', () => (iron = null));
  return iron;
}

/** precast concrete wheel stop at the head of a stall */
export function wheelStop(g: THREE.Object3D, x: number, z: number) {
  add(g, G.rbox(1.8, 0.12, 0.16, 0.03), extPbr('sidewalk', { color: '#c8c4bb', tile: 1.1, roughness: 0.95 }), x, 0.06, z);
  add(g, G.box(1.6, 0.004, 0.1), solid('#d9ad35', 0.7), x, 0.121, z);
}

/** US fire hydrant (barrel, bonnet, nozzles, pentagon nut) */
export function hydrant(g: THREE.Object3D, x: number, z: number, rot: number) {
  const red = solid('#b71c1c', 0.42, 0.1);
  const cap = solid('#e8e3d6', 0.42, 0.1);
  add(g, G.cyl(0.14, 0.15, 0.08, 16), red, x, 0.04, z);
  add(g, G.cyl(0.11, 0.12, 0.55, 16), red, x, 0.34, z);
  add(g, G.cyl(0.15, 0.13, 0.06, 16), red, x, 0.62, z);
  add(g, G.sphere(0.12, 16, 8), cap, x, 0.66, z);
  add(g, G.cyl(0.03, 0.03, 0.05, 5), cap, x, 0.79, z);
  for (const a of [rot, rot + Math.PI / 2, rot - Math.PI / 2]) {
    const big = a === rot;
    add(g, G.cyl(big ? 0.065 : 0.045, big ? 0.065 : 0.045, 0.12, 12), cap, x + Math.sin(a) * 0.13, 0.46, z + Math.cos(a) * 0.13, Math.PI / 2, a, 0);
  }
}

/** sign face material from rows of text (canvas), optionally lit at night */
const signMats = new Map<string, THREE.MeshStandardMaterial>();
export function signFace(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void, emissive = 0): THREE.MeshStandardMaterial {
  let m = signMats.get(key);
  if (m) return m;
  const px = 512;
  const { canvas, ctx } = makeCanvas(px, Math.max(32, Math.round((px * h) / w)));
  draw(ctx, canvas.width, canvas.height);
  const t = canvasTexture(canvas);
  t.anisotropy = 8;
  m = own(outdoor(new THREE.MeshStandardMaterial({ map: t, roughness: 0.38, metalness: 0.1, emissive: emissive ? '#ffffff' : '#000000', emissiveMap: emissive ? t : null, emissiveIntensity: emissive })));
  m.userData.litSign = emissive;
  signMats.set(key, m);
  m.addEventListener('dispose', () => signMats.delete(key));
  return m;
}

function rowsDraw(rows: { t: string; c: string; s: number; w?: number }[], bg: string, arrow?: 'l' | 'r' | 'u') {
  return (ctx: CanvasRenderingContext2D, W: number, H: number) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = H * 0.025;
    ctx.strokeRect(H * 0.04, H * 0.04, W - H * 0.08, H - H * 0.08);
    const total = rows.reduce((a, r) => a + r.s, 0);
    let y = H * 0.12;
    const avail = H * 0.76;
    for (const r of rows) {
      const rh = (avail * r.s) / total;
      ctx.fillStyle = r.c;
      ctx.font = `${r.w ?? 700} ${Math.round(rh * 0.78)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(r.t).width;
      ctx.save();
      ctx.translate(W / 2 - (arrow ? H * 0.12 : 0), y + rh / 2);
      const maxW = W * (arrow ? 0.66 : 0.86);
      if (tw > maxW) ctx.scale(maxW / tw, 1);
      ctx.fillText(r.t, 0, 0);
      ctx.restore();
      y += rh;
    }
    if (arrow) {
      ctx.save();
      ctx.translate(W - H * 0.32, H / 2);
      ctx.rotate({ r: 0, l: Math.PI, u: -Math.PI / 2 }[arrow]);
      ctx.fillStyle = '#ffffff';
      const s = H * 0.22;
      ctx.beginPath();
      for (const [px, py] of [[1, 0], [0, -0.9], [0, -0.35], [-1, -0.35], [-1, 0.35], [0, 0.35], [0, 0.9]]) ctx.lineTo(px * s, py * s);
      ctx.fill();
      ctx.restore();
    }
  };
}

/** sign panel on a square post (both faces) */
export function postSign(g: THREE.Object3D, x: number, z: number, rot: number, w: number, h: number, mat: THREE.Material, bottom = 1.6): THREE.Box3 {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  g.add(grp);
  const post = solid('#8f969b', 0.35, 0.8);
  add(grp, G.box(0.06, bottom + h + 0.08, 0.06), post, 0, (bottom + h + 0.08) / 2, -0.04);
  add(grp, G.rbox(w + 0.02, h + 0.02, 0.025, 0.006), solid('#d7dbde', 0.35, 0.6), 0, bottom + h / 2, 0);
  add(grp, G.plane(w, h), mat, 0, bottom + h / 2, 0.0155);
  return boxCollider(x, z, 0.08, 0.08, 2);
}

export function monumentSign(g: THREE.Object3D, x: number, z: number, rot: number, panel: THREE.Material): THREE.Box3 {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  g.add(grp);
  const brick = extPbr('brick', { color: '#c9b8a6', tile: 1.25, roughness: 0.9 });
  const cap = extPbr('sidewalk', { color: '#e3dfd6', tile: 1.2, roughness: 0.8 });
  add(grp, G.box(3.6, 0.5, 0.7), brick, 0, 0.25, 0);
  add(grp, G.box(0.35, 1.9, 0.6), brick, -1.62, 0.95, 0);
  add(grp, G.box(0.35, 1.9, 0.6), brick, 1.62, 0.95, 0);
  add(grp, G.rbox(3.7, 0.1, 0.78, 0.02), cap, 0, 1.95, 0);
  add(grp, G.box(2.9, 1.4, 0.36), solid('#1d2328', 0.5, 0.3), 0, 1.2, 0);
  for (const s of [-1, 1]) add(grp, G.plane(2.8, 1.3), panel, 0, 1.2, s * 0.184, 0, s > 0 ? 0 : Math.PI, 0);
  return boxCollider(x, z, 1.9, 0.5, 2.2);
}


// ───────────────────────────── beyond the lot ─────────────────────────────

export function beyondTheLot(g: THREE.Object3D, plan: Plan, glow: THREE.Material) {
  const rnd = rng(404);
  const x0 = plan.lotX0 - 170;
  const x1 = plan.lotX1 + 170;
  const cx = (x0 + x1) / 2;
  const len = x1 - x0;
  const roadY = -0.15;
  g.add(new THREE.Mesh(flatGeo(x0, plan.streetZ0, x1, plan.streetZ1, roadY), extPbr('lot_asphalt', { color: '#8d8d92', tile: 3.4, roughness: 0.92 })));
  const zc = (plan.streetZ0 + plan.streetZ1) / 2;
  const yellow = solid('#d4a12a', 0.62);
  const white = solid('#d8d6ce', 0.62);
  const [d0, d1] = plan.driveways[0];
  // the double yellow stops either side of the crosswalk (its bars would lie flush on the paint)
  for (const [a, b] of subtractSpans(x0, x1, [[d0 - 1.5, d1 + 1.5]], 0.5)) for (const dz of [-0.1, 0.1]) add(g, G.box(b - a, 0.004, 0.1), yellow, (a + b) / 2, roadY + 0.003, zc + dz);
  for (const z of [plan.streetZ0 + 0.55, plan.streetZ1 - 0.55]) add(g, G.box(len, 0.004, 0.12), white, cx, roadY + 0.003, z);
  // driveway crosswalk ladders over the street at the main driveway
  for (let x = d0 - 1; x < d1 + 1; x += 0.8) add(g, G.box(0.42, 0.004, plan.streetZ1 - plan.streetZ0 - 1.6), white, x, roadY + 0.003, zc);
  const curb = extPbr('sidewalk', { color: '#cfcbc3', tile: 1.2, roughness: 0.9 });
  for (const z of [plan.streetZ0 - 0.08, plan.streetZ1 + 0.08]) add(g, G.rbox(len, 0.17, 0.16, 0.03), curb, cx, roadY + 0.075, z);
  g.add(new THREE.Mesh(flatGeo(x0, plan.streetZ1 + 0.16, x1, plan.streetZ1 + 2.2, 0.0), extPbr('sidewalk', { color: '#d4d0c8', tile: 2.0, roughness: 0.9 })));
  // lawn north of the street (the lot covers its part), a strip of riverside park south of it
  // (the promenade, the river and the far bank are in surroundings.ts)
  const { Q, bx, bridgeHalf } = riverPlan(plan);
  const field = extPbr('grass', { color: '#9aa37e', tile: 3.5, roughness: 1 });
  g.add(new THREE.Mesh(flatGeo(x0, -220, x1, plan.streetZ0 - 0.16, -0.03), field));
  g.add(new THREE.Mesh(flatGeo(x0, plan.streetZ1 + 2.2, x1, Q - 3.5, -0.03), field));
  // cobra-head street lights along the far side (glow only); none in the bridge's approach
  const clear = (x: number, m: number) => Math.abs(x - bx) > bridgeHalf + m;
  const pole = solid('#7c8287', 0.45, 0.7);
  for (let x = Math.ceil(x0 / 32) * 32; x < x1; x += 32) {
    if (!clear(x, 1)) continue;
    const z = plan.streetZ1 + 0.9;
    add(g, G.cyl(0.08, 0.11, 8.2, 10), pole, x, 4.1, z);
    add(g, G.box(0.08, 0.08, 2.0), pole, x, 8.05, z - 0.95);
    add(g, G.rbox(0.36, 0.14, 0.7, 0.05), solid('#5d6368', 0.5, 0.5), x, 7.98, z - 2.0);
    add(g, G.box(0.26, 0.02, 0.5), glow, x, 7.9, z - 2.0);
  }
  // street trees on the far side (the riverside park)
  for (let x = Math.ceil(x0 / 17) * 17; x < x1; x += 15 + rnd() * 8) {
    const z = plan.streetZ1 + 4.5 + rnd() * 2;
    const t = { h: 7 + rnd() * 3, r: 2.6 + rnd() * 1.2, seed: Math.floor(rnd() * 1e6), cards: 0.55 };
    if (clear(x, 1.5)) tree(g, x, z, t);
  }
}

/** parking-lot LED area light: square tapered pole on a concrete base, one or two flat LED heads */
export function lampPost(g: THREE.Group, twin: boolean, out: { lampAnchor?: THREE.Vector3 }) {
  const H = 7.6;
  const pole = solid('#3a3f43', 0.42, 0.55);
  const head = solid('#2a2e31', 0.4, 0.6);
  const led = new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#fff3e0', emissiveIntensity: 0.1, roughness: 0.3 });
  outdoor(led);
  led.userData.ledLens = true;
  add(g, G.cyl(0.32, 0.36, 0.75, 18), extPbr('sidewalk', { color: '#cbc6bc', tile: 1, roughness: 0.9 }), 0, 0.375, 0);
  add(g, G.box(0.34, 0.06, 0.34), pole, 0, 0.78, 0);
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as [number, number][]) add(g, G.cyl(0.018, 0.018, 0.08, 6), solid('#9a9fa3', 0.4, 0.8), x, 0.84, z);
  const shaft = new THREE.CylinderGeometry(0.06, 0.1, H - 0.8, 4, 1);
  shaft.rotateY(Math.PI / 4);
  add(g, trackGeo(shaft), pole, 0, 0.8 + (H - 0.8) / 2, 0);
  for (const s of twin ? [-1, 1] : [-1]) {
    add(g, G.box(0.08, 0.08, 0.9), pole, 0, H - 0.08, s * 0.45);
    add(g, G.rbox(0.5, 0.09, 0.7, 0.025), head, 0, H - 0.1, s * 1.15);
    add(g, G.box(0.42, 0.012, 0.6), led, 0, H - 0.152, s * 1.15);
  }
  out.lampAnchor = new THREE.Vector3(0, H - 0.25, twin ? 0 : -1.15);
}

/** aluminium composite panels: a light field and a darker top band, both with faint rain streaks */
let panelMats: { light: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial } | null = null;
function cachedPanels() {
  if (panelMats && panelMats.light.userData.outdoor) return panelMats;
  const { canvas, ctx } = makeCanvas(256, 512);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 512);
  const rnd = rng(5);
  for (let i = 0; i < 70; i++) {
    // streaks run down from the top edge (where water collects behind the reveal) and fade out
    const x = rnd() * 256;
    const len = 60 + rnd() * 380;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(96,92,84,${0.03 + rnd() * 0.07})`);
    g.addColorStop(1, 'rgba(96,92,84,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1 + rnd() * 3, len);
  }
  const gb = ctx.createLinearGradient(0, 440, 0, 512);
  gb.addColorStop(0, 'rgba(110,104,92,0)');
  gb.addColorStop(1, 'rgba(110,104,92,0.12)');
  ctx.fillStyle = gb;
  ctx.fillRect(0, 440, 256, 72);
  const map = canvasTexture(canvas);
  const light = own(outdoor(new THREE.MeshStandardMaterial({ color: '#d0cec7', map, roughness: 0.42, metalness: 0.15, vertexColors: true }), 1.1));
  const dark = own(outdoor(new THREE.MeshStandardMaterial({ color: '#6f757a', map, roughness: 0.36, metalness: 0.45, vertexColors: true }), 1.1));
  panelMats = { light, dark };
  light.addEventListener('dispose', () => (panelMats = null));
  return panelMats;
}

// ───────────────────────────── ground canvases + material ─────────────────────────────

/** a canvas over a rectangle of the ground (canvas x → world x, canvas y → world z) */
export class GroundCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly k: number;
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly w: number,
    readonly d: number,
    width: number,
    fill: string | null,
  ) {
    const { canvas, ctx } = makeCanvas(width, Math.max(16, Math.round((width * d) / w)));
    this.canvas = canvas;
    this.ctx = ctx;
    this.k = width / w;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  X(x: number) {
    return (x - this.x0) * this.k;
  }
  Z(z: number) {
    return (z - this.z0) * this.k;
  }
  /** world rect */
  rect(x0: number, z0: number, x1: number, z1: number, style: string) {
    this.ctx.fillStyle = style;
    this.ctx.fillRect(this.X(Math.min(x0, x1)), this.Z(Math.min(z0, z1)), Math.abs(x1 - x0) * this.k, Math.abs(z1 - z0) * this.k);
  }
  /** soft round blob (radial gradient), radii in meters */
  blob(x: number, z: number, rx: number, rz: number, color: (a: number) => string, a = 1, rot = 0) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.X(x), this.Z(z));
    ctx.rotate(rot);
    ctx.scale(1, rz / rx);
    const r = rx * this.k;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, color(a));
    g.addColorStop(0.55, color(a * 0.8));
    g.addColorStop(1, color(0));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
  }
  texture(): THREE.CanvasTexture {
    const t = canvasTexture(this.canvas);
    t.anisotropy = 16;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
}

/** speckle pattern used to chip painted markings (destination-out) */
export function wearPattern(ctx: CanvasRenderingContext2D, seed: number): CanvasPattern {
  const S = 192;
  const { canvas, ctx: c } = makeCanvas(S, S);
  const rnd = rng(seed);
  for (let i = 0; i < 2600; i++) {
    const a = rnd();
    c.fillStyle = `rgba(0,0,0,${a < 0.75 ? a * 0.5 : 0.95})`;
    const s = 1 + rnd() * (rnd() < 0.1 ? 6 : 2.2);
    c.fillRect(rnd() * S, rnd() * S, s, s * (0.5 + rnd()));
  }
  return ctx.createPattern(canvas, 'repeat')!;
}

export interface GroundLayers {
  paint: GroundCanvas;
  /** R wetness (puddles 1), G dirt / oil, B contact occlusion */
  data: GroundCanvas;
  /** R concrete (1) vs asphalt (0) */
  mask: GroundCanvas;
}

/** data (wet, dirt, occlusion) + concrete mask → one linear RGBA texture (A = 0.5 + 0.5 × concrete, never 0) */
function packGround(data: GroundCanvas, mask: GroundCanvas): THREE.CanvasTexture {
  const { width: w, height: h } = data.canvas;
  const d = data.ctx.getImageData(0, 0, w, h);
  const m = mask.ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = 128 + (m[i] >> 1);
  const out = makeCanvas(w, h);
  out.ctx.putImageData(d, 0, 0);
  const t = canvasTexture(out.canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Lot ground: asphalt and concrete texture sets (world-space tiling) mixed by the mask, painted
 * markings over them, then wetness (darker, glossier, flatter; puddles are mirrors) and
 * contact occlusion. `wet` scales the wetness (rain at night, drying by day).
 */
export function groundMaterial(L: GroundLayers): { mat: THREE.MeshStandardMaterial; wet: { value: number } } {
  // texture budget: every lit material also binds the shadow maps (exam lights + sun), and WebGPU
  // allows 16 sampled textures per stage by default → paint, packed data, 2 × (color + normal) here
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const uWet = uniform(1.0);
  const { paint } = L;
  const p = positionWorld.xz;
  const luv = vec2(p.x.sub(paint.x0).div(paint.w), float(1).sub(p.y.sub(paint.z0).div(paint.d)));
  const pt = texture(L.paint.texture(), luv);
  const packed = packGround(L.data, L.mask);
  const dt = texture(packed, luv);
  const conc = smoothstep(0.7, 0.8, dt.a);
  const wet = clamp(dt.r.mul(uWet), 0, 1);
  const dirt = dt.g;
  const occ = dt.b;
  const aUV = p.div(2.9);
  const cUV = p.div(2.0);
  const aRaw = texture(texMap('lot_asphalt', 'color'), aUV).rgb;
  const cRaw = texture(texMap('sidewalk', 'color'), cUV).rgb;
  const aCol = aRaw.mul(vec3(0.82, 0.82, 0.86));
  const cCol = cRaw.mul(vec3(0.92, 0.9, 0.86));
  let base = mix(aCol, cCol, conc).mul(float(1).sub(dirt.mul(0.62)));
  base = mix(base, pt.rgb, pt.a);
  // wet surfaces darken (more on porous asphalt than on paint); standing water darkens more
  const darken = mix(mix(float(0.66), float(0.76), conc), float(0.88), pt.a);
  base = base.mul(mix(float(1), darken, smoothstep(0.05, 0.6, wet))).mul(mix(float(1), float(0.85), smoothstep(0.55, 0.95, wet)));
  m.colorNode = vec4(base.mul(float(1).sub(occ.mul(0.78))), 1);
  // roughness from the albedo: polished aggregate (light) is smoother than the binder
  const luma = (c: typeof aRaw) => dot(c, vec3(0.3, 0.59, 0.11));
  const aR = clamp(float(1.02).sub(luma(aRaw).mul(1.5)), 0.55, 0.97);
  const cR = clamp(float(0.95).sub(luma(cRaw).mul(0.35)), 0.6, 0.92);
  let r = mix(aR, cR, conc);
  r = mix(r, float(0.5), pt.a);
  r = mix(r, r.mul(0.42), smoothstep(0.05, 0.55, wet));
  m.roughnessNode = clamp(mix(r, float(0.05), smoothstep(0.45, 0.95, wet)), 0.02, 1);
  const nA = texture(texMap('lot_asphalt', 'normal'), aUV).xyz;
  const nC = texture(texMap('sidewalk', 'normal'), cUV).xyz;
  const flat = float(1).sub(wet.mul(0.92)).mul(float(1).sub(pt.a.mul(0.55)));
  m.normalNode = normalMap(mix(nA, nC, conc), vec2(flat.mul(1.15), flat.mul(1.15)));
  m.aoNode = float(1).sub(occ.mul(0.88));
  outdoor(m, 1);
  m.userData.ownLights = true;
  return { mat: m as unknown as THREE.MeshStandardMaterial, wet: uWet };
}

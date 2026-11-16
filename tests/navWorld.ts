/**
 * A node-side stand-in for the built world's walking obstacles (no DOM, no GPU): walls from the
 * layout's rooms and doors, solid props as boxes, floor furniture as footprints sized like the
 * meshes in client/src/world/props.ts. Used by tests/steering.test.ts.
 */
import * as THREE from 'three';
import { openDoorLeaves } from '../client/src/world/doorLeaves';
import type { LayoutDef, PropDef, RoomDef, Side } from '../shared/layout';
import { NAV_FURNITURE, NavGrid, type Footprint } from '../client/src/world/pathfinding';

const WALL_T = 0.12;

/** half sizes (local x, z) and centre offset along local z of props as built (props.ts); w/d overrides win */
function size(p: PropDef): [number, number, number] {
  if (p.w !== undefined && p.d !== undefined) return [p.w / 2, p.d / 2, 0];
  switch (p.kind) {
    case 'chair':
      // office chair: 5-star base r ≈ 0.32; waiting chair: frame ±0.262, seat front +0.26, back −0.262
      return /^st_|wr_|desk/.test(p.id) ? [0.32, 0.32, 0] : [0.262, 0.261, -0.001];
    case 'stool':
      return [0.29, 0.29, 0];
    case 'cafeChair':
      return [0.24, 0.26, 0];
    case 'sink':
      return [0.34, 0.28, 0];
    case 'ivPole':
      return [0.28, 0.28, 0];
    case 'vending':
      return [0.48, 0.4, 0];
    case 'plant':
      return [0.26, 0.26, 0];
    case 'trash':
      return [0.2, 0.2, 0];
    case 'vitalsMachine':
      return [0.2, 0.2, 0];
    case 'cart':
      return [0.28, 0.24, 0];
    case 'crashCart':
      return [0.38, 0.28, 0];
    case 'bed':
    case 'stretcher':
      return [0.5, 1.1, 0];
    case 'examTable':
      return [0.4, 0.95, 0];
    case 'sofa':
      return [0.9, 0.41, 0];
    case 'cabinet':
      return [0.5, 0.25, 0];
    case 'ultrasound':
      return [0.28, 0.25, 0];
    case 'coffee':
      return [0.42, 0.27, 0];
    case 'medDispenser':
      return [0.56, 0.33, 0];
    case 'fridge':
      return [0.35, 0.33, 0];
    default:
      return [(p.w ?? 0.6) / 2, (p.d ?? 0.6) / 2, 0];
  }
}

export function propFootprint(p: PropDef): Footprint {
  const [hw, hd, oz] = size(p);
  const r = p.rot ?? 0;
  return { x: p.x + Math.sin(r) * oz, z: p.z + Math.cos(r) * oz, hw, hd, rot: r };
}

function aabb(f: Footprint): THREE.Box3 {
  const c = Math.abs(Math.cos(f.rot));
  const s = Math.abs(Math.sin(f.rot));
  const ex = f.hw * c + f.hd * s;
  const ez = f.hw * s + f.hd * c;
  return new THREE.Box3(new THREE.Vector3(f.x - ex, 0, f.z - ez), new THREE.Vector3(f.x + ex, 2, f.z + ez));
}

/** wall boxes along a room's sides, door gaps cut out (open and curtained sides have none) */
function walls(r: RoomDef): THREE.Box3[] {
  if (r.kind === 'corridor' || r.kind === 'exterior' || r.kind === 'station') return [];
  const out: THREE.Box3[] = [];
  const { x, z, w, d } = r.rect;
  const sides: Side[] = ['n', 's', 'e', 'w'];
  for (const side of sides) {
    if (r.openSides?.includes(side) || r.curtainSides?.includes(side)) continue;
    const len = side === 'n' || side === 's' ? w : d;
    for (const door of r.doors) if (door.side === side && !door.y) out.push(...openDoorLeaves(r, door));
    const gaps = r.doors.filter((dd) => dd.side === side).map((dd) => [dd.offset, dd.offset + dd.width] as const).sort((a, b) => a[0] - b[0]);
    let at = 0;
    const runs: [number, number][] = [];
    for (const [g0, g1] of gaps) {
      if (g0 > at) runs.push([at, g0]);
      at = Math.max(at, g1);
    }
    if (at < len) runs.push([at, len]);
    for (const [a, b] of runs) {
      if (side === 'n') out.push(new THREE.Box3(new THREE.Vector3(x + a, 0, z - WALL_T / 2), new THREE.Vector3(x + b, 3, z + WALL_T / 2)));
      if (side === 's') out.push(new THREE.Box3(new THREE.Vector3(x + a, 0, z + d - WALL_T / 2), new THREE.Vector3(x + b, 3, z + d + WALL_T / 2)));
      if (side === 'w') out.push(new THREE.Box3(new THREE.Vector3(x - WALL_T / 2, 0, z + a), new THREE.Vector3(x + WALL_T / 2, 3, z + b)));
      if (side === 'e') out.push(new THREE.Box3(new THREE.Vector3(x + w - WALL_T / 2, 0, z + a), new THREE.Vector3(x + w + WALL_T / 2, 3, z + b)));
    }
  }
  return out;
}

export interface NavWorld {
  grid: NavGrid;
  footprints: Footprint[];
  colliders: THREE.Box3[];
}

/** the west half of the ED (rooms west of x = 36, the hub, the waiting room) as obstacles */
export function navWorld(layout: LayoutDef): NavWorld {
  const colliders: THREE.Box3[] = [];
  const footprints: Footprint[] = [];
  for (const r of layout.rooms) if (r.rect.x < 48 && r.rect.z < 25) colliders.push(...walls(r));
  for (const p of layout.props) {
    if (p.x > 48 || p.z > 25 || (p.y ?? 0) >= 0.3 || !NAV_FURNITURE.has(p.kind) && !p.solid) continue;
    const f = propFootprint(p);
    if (p.solid) colliders.push(aabb(f));
    else footprints.push(f);
  }
  const grid = new NavGrid(colliders, { minX: -1, maxX: layout.width + 1, minZ: -1, maxZ: layout.depth + 9 });
  return { grid, footprints, colliders };
}

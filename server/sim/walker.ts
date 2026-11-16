/**
 * Server-side walking for bodies the server moves (patients walking to their bay, people the server
 * plays): where a body is at a given game time, so a player sees them cross the ED like a person.
 *
 * The route comes from the client's own grid planner (client/src/world/pathfinding.ts NavGrid, pure
 * geometry), over the layout's walls (door gaps, open and curtained sides walkable) and solid props
 * as boxes, like tests/navWorld.ts. They walk at the player's walking speed in REAL time, so a walk
 * costs (length / speed) × rate seconds of game time, as it does a human.
 */
import * as THREE from 'three';
import { openDoorLeaves } from '../../client/src/world/doorLeaves';
import type { LayoutDef, PropDef, RoomDef, Side } from '../../shared/layout';
import { roomAt } from '../../shared/layout';
import { NavGrid } from '../../client/src/world/pathfinding';

/** the player's walking speed (client/src/world/controls.ts WALK), m per real second */
export const WALK_SPEED = 2.1;
const WALL_T = 0.12;

function half(p: PropDef): [number, number] {
  if (p.w !== undefined && p.d !== undefined) return [p.w / 2, p.d / 2];
  switch (p.kind) {
    case 'bed':
    case 'stretcher':
      return [0.5, 1.1];
    case 'examTable':
      return [0.4, 0.95];
    case 'vending':
      return [0.48, 0.4];
    case 'plant':
      return [0.26, 0.26];
    case 'trash':
    case 'vitalsMachine':
      return [0.2, 0.2];
    case 'cart':
      return [0.28, 0.24];
    case 'crashCart':
      return [0.38, 0.28];
    case 'sofa':
      return [0.9, 0.41];
    case 'cabinet':
      return [0.5, 0.25];
    case 'chair':
      return [0.26, 0.26];
    default:
      return [(p.w ?? 0.6) / 2, (p.d ?? 0.6) / 2];
  }
}

function propBox(p: PropDef): THREE.Box3 {
  const [hw, hd] = half(p);
  const r = p.rot ?? 0;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const ex = hw * c + hd * s;
  const ez = hw * s + hd * c;
  return new THREE.Box3(new THREE.Vector3(p.x - ex, 0, p.z - ez), new THREE.Vector3(p.x + ex, 2, p.z + ez));
}

function walls(r: RoomDef): THREE.Box3[] {
  if (r.kind === 'corridor' || r.kind === 'exterior' || r.kind === 'station') return [];
  const out: THREE.Box3[] = [];
  const { x, z, w, d } = r.rect;
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    if (r.openSides?.includes(side) || r.curtainSides?.includes(side)) continue;
    const len = side === 'n' || side === 's' ? w : d;
    for (const door of r.doors) if (door.side === side && !door.y) out.push(...openDoorLeaves(r, door));
    const gaps = r.doors.filter((dd) => dd.side === side && !dd.y).map((dd) => [dd.offset, dd.offset + dd.width] as const).sort((a, b) => a[0] - b[0]);
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

const grids = new WeakMap<LayoutDef, NavGrid>();

/** the ground floor's walking grid (built once per layout) */
export function serverNav(layout: LayoutDef): NavGrid {
  let g = grids.get(layout);
  if (!g) {
    const colliders: THREE.Box3[] = [];
    for (const r of layout.rooms) colliders.push(...walls(r));
    for (const p of layout.props) if (p.solid && (p.y ?? 0) < 0.3) colliders.push(propBox(p));
    g = new NavGrid(colliders, { minX: -1, maxX: layout.width + 1, minZ: -1, maxZ: layout.depth + 9 });
    grids.set(layout, g);
  }
  return g;
}

export interface Pt {
  x: number;
  z: number;
}

/** a walking route from a to b (the planner's polyline; a straight line if it finds none) */
export function route(layout: LayoutDef, a: Pt, b: Pt): Pt[] {
  const path = serverNav(layout).findPath(a.x, a.z, b.x, b.z);
  const pts: Pt[] = [{ x: a.x, z: a.z }, ...(path ?? [new THREE.Vector2(b.x, b.z)]).map((v) => ({ x: v.x, z: v.y }))];
  // drop zero-length steps
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 1e-3);
}

export function routeLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

export interface WalkerPose {
  x: number;
  z: number;
  yaw: number;
  motion: 'idle' | 'walk' | 'sit';
  speed: number;
  room: string;
}

/**
 * A body that walks routes in game time. walkTo() returns the arrival time; poseAt(t) is a pure
 * function of the routes taken and t, so a replay puts the body in the same places.
 */
export class Walker {
  private pts: Pt[] = [];
  private cum: number[] = [];
  private t0 = 0;
  private t1 = 0;
  private end: { x: number; z: number; rot: number; sit: boolean };

  constructor(
    private layout: LayoutDef,
    /** game seconds per real second */
    private rate: number,
    start: { x: number; z: number; rot: number },
  ) {
    this.end = { ...start, sit: false };
  }

  /** walk from wherever the body is at game time t to (x, z), then face rot (and sit down) */
  walkTo(t: number, x: number, z: number, rot: number, sit = false): number {
    const here = this.poseAt(t);
    const pts = Math.hypot(x - here.x, z - here.z) < 0.05 ? [{ x, z }] : route(this.layout, here, { x, z });
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const len = this.cum[this.cum.length - 1];
    this.t0 = t;
    this.t1 = t + (len / WALK_SPEED) * this.rate;
    this.end = { x, z, rot, sit };
    return this.t1;
  }

  /** game time the current walk ends */
  get arrival(): number {
    return this.t1;
  }

  poseAt(t: number): WalkerPose {
    const room = (x: number, z: number) => roomAt(this.layout, x, z)?.id ?? 'exterior';
    if (t >= this.t1 || this.pts.length < 2) {
      const { x, z, rot, sit } = this.end;
      return { x, z, yaw: rot, motion: sit ? 'sit' : 'idle', speed: 0, room: room(x, z) };
    }
    const total = this.cum[this.cum.length - 1];
    const s = Math.max(0, Math.min(total, ((t - this.t0) / Math.max(1e-6, this.t1 - this.t0)) * total));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    const k = (s - this.cum[i - 1]) / seg;
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    return { x, z, yaw: Math.atan2(b.x - a.x, b.z - a.z), motion: 'walk', speed: WALK_SPEED, room: room(x, z) };
  }
}

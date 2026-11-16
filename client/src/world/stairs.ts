/**
 * Stair flights and landings from layout data (shared/layout.ts RampDef / LandingDef).
 * - Flights: solid steps filled down to the floor, with vinyl treads and contrasting nosings.
 * - Landings: solid podiums.
 * - Railings: a handrail on wall sides; a balustrade with posts on open flight sides; guardrails
 *   on open landing edges. Open sides get colliders so nobody walks off.
 * Walking height comes from `standHeight` (used by World.ts) plus the controller's climb rule.
 */
import * as THREE from 'three';
import type { LandingDef, LayoutDef, RampDef, Rect, Side } from '../../../shared/layout';
import { G, add, lambert, pbr } from './materials';

const WALL_T = 0.12; // as in builder.ts
const RAIL_H = 0.9; // handrail height above the pitch line
const GUARD_H = 1.1; // guardrail height on landings
const UP = new THREE.Vector3(0, 1, 0);

export function stepCount(r: RampDef): number {
  return r.steps ?? Math.max(2, Math.round(r.rise / 0.17));
}

/** fraction 0..1 from a flight's low edge to its high edge (unclamped) */
function frac(r: RampDef, x: number, z: number): number {
  const { x: rx, z: rz, w, d } = r.rect;
  return r.up === 'n' ? (rz + d - z) / d : r.up === 's' ? (z - rz) / d : r.up === 'w' ? (rx + w - x) / w : (x - rx) / w;
}

const inside = (rc: Rect, x: number, z: number) => x >= rc.x && x <= rc.x + rc.w && z >= rc.z && z <= rc.z + rc.d;

/**
 * Height you stand at, at (x, z): the highest flight or landing there, else 0 (the floor).
 * On a flight it follows the step tops to within ±half a riser, so feet neither sink into the
 * treads nor float, and the camera still glides instead of jolting per step.
 */
export function standHeight(layout: LayoutDef, x: number, z: number): number {
  let y = 0;
  for (const l of layout.landings ?? []) if (inside(l.rect, x, z)) y = Math.max(y, l.y);
  for (const r of layout.ramps ?? []) {
    if (!inside(r.rect, x, z)) continue;
    const riser = r.rise / stepCount(r);
    y = Math.max(y, (r.base ?? 0) + Math.min(r.rise, Math.max(0, frac(r, x, z)) * r.rise + riser / 2));
  }
  return y;
}

export function buildStairs(layout: LayoutDef, parent: THREE.Group): { colliders: THREE.Box3[] } {
  const ramps = layout.ramps ?? [];
  const landings = layout.landings ?? [];
  const colliders: THREE.Box3[] = [];
  if (!ramps.length && !landings.length) return { colliders };

  const tread = pbr('floor_vinyl', { color: '#cfcbc3', tile: 1, roughness: 0.6, normalScale: 0.3 });
  const body = pbr('concrete', { color: '#cbc5ba', tile: 1.5, roughness: 0.9 });
  const nosing = lambert('#c99a2e', { roughness: 0.55 }); // contrasting nosing: visible step edges
  const steel = pbr('steel', { tile: 0.3, roughness: 0.4 });
  const roomRect = new Map(layout.rooms.map((r) => [r.id, r.rect]));

  /** the inner face of the room wall on `side`, if `rect` runs along that wall */
  const wallFace = (room: string, side: Side, rc: Rect): number | null => {
    const rr = roomRect.get(room);
    if (!rr) return null;
    const tol = WALL_T + 0.25;
    if (side === 'n') return rc.z - rr.z < tol ? rr.z + WALL_T : null;
    if (side === 's') return rr.z + rr.d - (rc.z + rc.d) < tol ? rr.z + rr.d - WALL_T : null;
    if (side === 'w') return rc.x - rr.x < tol ? rr.x + WALL_T : null;
    return rr.x + rr.w - (rc.x + rc.w) < tol ? rr.x + rr.w - WALL_T : null;
  };
  const bar = (a: THREE.Vector3, b: THREE.Vector3, rad = 0.022) => {
    const m = new THREE.Mesh(G.cyl(rad, rad, a.distanceTo(b), 10), steel);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    parent.add(m);
  };
  const post = (x: number, z: number, y0: number, y1: number) => add(parent, G.cyl(0.02, 0.02, y1 - y0, 8), steel, x, (y0 + y1) / 2, z);
  /** a thin collider along a line at (x1,z1)→(x2,z2), floor to `top` */
  const fence = (x1: number, z1: number, x2: number, z2: number, top: number) => {
    const t = 0.05;
    colliders.push(new THREE.Box3(new THREE.Vector3(Math.min(x1, x2) - t, 0, Math.min(z1, z2) - t), new THREE.Vector3(Math.max(x1, x2) + t, top, Math.max(z1, z2) + t)));
  };

  // ── flights ──
  for (const r of ramps) {
    const n = stepCount(r);
    const base = r.base ?? 0;
    const riser = r.rise / n;
    const { x: rx, z: rz, w, d } = r.rect;
    const alongZ = r.up === 'n' || r.up === 's';
    const run = alongZ ? d : w;
    const t = run / n;
    /** world (x, z) at distance s from the low edge, at cross position c (an x for n/s flights, a z for e/w) */
    const at = (s: number, c: number): [number, number] =>
      r.up === 'n' ? [c, rz + d - s] : r.up === 's' ? [c, rz + s] : r.up === 'w' ? [rx + w - s, c] : [rx + s, c];
    for (let i = 0; i < n; i++) {
      const top = base + (i + 1) * riser;
      const [cx, cz] = at((i + 0.5) * t, alongZ ? rx + w / 2 : rz + d / 2);
      const sx = alongZ ? w : t;
      const sz = alongZ ? t : d;
      add(parent, G.box(sx, top - 0.02, sz), body, cx, (top - 0.02) / 2, cz);
      add(parent, G.box(sx, 0.02, sz), tread, cx, top - 0.01, cz);
      // nosing strip along the step's front (low-side) edge
      const [nx, nz] = at(i * t + 0.025, alongZ ? rx + w / 2 : rz + d / 2);
      add(parent, G.box(alongZ ? w - 0.04 : 0.05, 0.006, alongZ ? 0.05 : d - 0.04), nosing, nx, top + 0.003, nz);
    }
    // the two long sides: a wall handrail, or a balustrade with a collider
    for (const side of (alongZ ? ['w', 'e'] : ['n', 's']) as Side[]) {
      const face = wallFace(r.room, side, r.rect);
      const sign = side === 'w' || side === 'n' ? 1 : -1; // inward direction across the flight
      const edge = side === 'w' ? rx : side === 'e' ? rx + w : side === 'n' ? rz : rz + d;
      const c = face !== null ? face + sign * 0.07 : edge + sign * 0.05;
      const s1 = 0.12;
      const s2 = run - 0.04;
      const h = (s: number) => base + RAIL_H + (s / run) * r.rise;
      const [x1, z1] = at(s1, c);
      const [x2, z2] = at(s2, c);
      bar(new THREE.Vector3(x1, h(s1), z1), new THREE.Vector3(x2, h(s2), z2));
      if (face !== null) {
        // wall brackets
        for (const s of [s1 + 0.2, run / 2, s2 - 0.2]) {
          const [bx, bz] = at(s, c - sign * 0.035);
          add(parent, G.box(alongZ ? 0.07 : 0.025, 0.025, alongZ ? 0.025 : 0.07), steel, bx, h(s) - 0.03, bz);
        }
        continue;
      }
      // balustrade: posts on the step tops, a mid rail, and a collider
      const np = Math.max(2, Math.round((s2 - s1) / 0.9) + 1);
      for (let k = 0; k < np; k++) {
        const s = s1 + ((s2 - s1) * k) / (np - 1);
        const [px, pz] = at(s, c);
        post(px, pz, base + Math.min(r.rise, (Math.floor(s / t) + 1) * riser), h(s));
      }
      bar(new THREE.Vector3(x1, h(s1) - 0.45, z1), new THREE.Vector3(x2, h(s2) - 0.45, z2), 0.012);
      const [fx1, fz1] = at(0.02, edge + sign * 0.05);
      const [fx2, fz2] = at(run, edge + sign * 0.05);
      fence(fx1, fz1, fx2, fz2, base + r.rise + GUARD_H);
    }
  }

  // ── landings: solid podiums; guardrails where nothing joins and no wall closes the edge ──
  const joins: Rect[] = [...ramps.map((r) => r.rect), ...landings.map((l) => l.rect)];
  for (const l of landings) {
    const { x, z, w, d } = l.rect;
    add(parent, G.box(w, l.y - 0.02, d), body, x + w / 2, (l.y - 0.02) / 2, z + d / 2);
    add(parent, G.box(w, 0.02, d), tread, x + w / 2, l.y - 0.01, z + d / 2);
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      if (wallFace(l.room, side, l.rect) !== null) continue;
      const alongX = side === 'n' || side === 's';
      const lo = alongX ? x : z;
      const hi = alongX ? x + w : z + d;
      const line = side === 'n' ? z : side === 's' ? z + d : side === 'w' ? x : x + w;
      // the parts of this edge where a flight or another landing joins
      const covered: [number, number][] = [];
      for (const o of joins) {
        if (o === l.rect) continue;
        const meets =
          side === 'n' ? Math.abs(o.z + o.d - line) < 0.06 : side === 's' ? Math.abs(o.z - line) < 0.06 : side === 'w' ? Math.abs(o.x + o.w - line) < 0.06 : Math.abs(o.x - line) < 0.06;
        if (!meets) continue;
        const a = Math.max(lo, alongX ? o.x : o.z);
        const b = Math.min(hi, alongX ? o.x + o.w : o.z + o.d);
        if (b > a) covered.push([a, b]);
      }
      covered.sort((p, q) => p[0] - q[0]);
      const open: [number, number][] = [];
      let cur = lo;
      for (const [a, b] of covered) {
        if (a > cur) open.push([cur, a]);
        cur = Math.max(cur, b);
      }
      if (cur < hi) open.push([cur, hi]);
      const inset = side === 'n' || side === 'w' ? 0.05 : -0.05;
      for (const [a, b] of open) {
        if (b - a < 0.4) continue; // the slot between two flights: too narrow to fall through
        const p = (u: number): [number, number] => (alongX ? [u, line + inset] : [line + inset, u]);
        const [x1, z1] = p(a + 0.04);
        const [x2, z2] = p(b - 0.04);
        bar(new THREE.Vector3(x1, l.y + GUARD_H, z1), new THREE.Vector3(x2, l.y + GUARD_H, z2));
        bar(new THREE.Vector3(x1, l.y + GUARD_H / 2, z1), new THREE.Vector3(x2, l.y + GUARD_H / 2, z2), 0.012);
        const np = Math.max(2, Math.round((b - a) / 1.1) + 1);
        for (let k = 0; k < np; k++) {
          const [px, pz] = p(a + 0.04 + ((b - a - 0.08) * k) / (np - 1));
          post(px, pz, l.y, l.y + GUARD_H);
        }
        fence(x1, z1, x2, z2, l.y + GUARD_H);
      }
    }
  }
  return { colliders };
}

/** stair footprints, for keeping NPC paths off them */
export function stairRects(layout: LayoutDef): Rect[] {
  return [...(layout.ramps ?? []).map((r: RampDef) => r.rect), ...(layout.landings ?? []).map((l: LandingDef) => l.rect)];
}

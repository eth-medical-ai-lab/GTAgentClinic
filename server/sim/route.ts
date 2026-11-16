/**
 * How long a walk through the waiting room takes the way NPCs walk it (client/src/world/steering.ts):
 * round the rows of chairs (and the legs of whoever sits in them), the registration counter and the
 * vending machine, not through them. The ambient choreography (ambient.ts) times scenes on it, so
 * someone called from a seat at the far end of a row arrives when the nurse greets them.
 *
 * A visibility graph over the obstacles grown by a body's clearance: shortest route between their
 * corners. Rough on purpose (±10 %): it only has to be close to the client's real route.
 */
import type { LayoutDef } from '../../shared/layout';

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
interface P {
  x: number;
  z: number;
}

/** body-centre clearance from furniture and legs (pathfinding.ts NPC_CLEARANCE) plus a little */
const CLEAR = 0.32;
const cache = new WeakMap<LayoutDef, Box[]>();

function obstacles(layout: LayoutDef): Box[] {
  const hit = cache.get(layout);
  if (hit) return hit;
  let boxes: Box[] = [];
  for (const p of layout.props) {
    if (p.room !== 'waiting' || (p.y ?? 0) > 0.3) continue;
    const r = p.rot ?? 0;
    let hw: number;
    let zf: number;
    let zb: number;
    if (p.kind === 'chair') {
      // seat ±0.26, and the legs of whoever sits in it, out to 0.6 m in front
      hw = 0.26;
      zf = /desk/.test(p.id) ? 0.32 : 0.6;
      zb = /desk/.test(p.id) ? 0.32 : 0.27;
    } else if (p.solid) {
      hw = (p.w ?? (p.kind === 'vending' ? 0.96 : 0.5)) / 2;
      zf = zb = (p.d ?? (p.kind === 'vending' ? 0.8 : 0.5)) / 2;
    } else continue;
    // the rotated rectangle's bounds, grown by the clearance
    const pts: [number, number][] = [
      [-hw, -zb],
      [hw, -zb],
      [-hw, zf],
      [hw, zf],
    ];
    const xs = pts.map(([lx, lz]) => p.x + lx * Math.cos(r) + lz * Math.sin(r));
    const zs = pts.map(([lx, lz]) => p.z - lx * Math.sin(r) + lz * Math.cos(r));
    boxes.push({ x0: Math.min(...xs) - CLEAR, z0: Math.min(...zs) - CLEAR, x1: Math.max(...xs) + CLEAR, z1: Math.max(...zs) + CLEAR });
  }
  // a row of chairs is one obstacle: merge overlapping boxes
  for (let merged = true; merged; ) {
    merged = false;
    const out: Box[] = [];
    for (const b of boxes) {
      const o = out.find((q) => q.x0 < b.x1 && b.x0 < q.x1 && q.z0 < b.z1 && b.z0 < q.z1);
      if (o) {
        o.x0 = Math.min(o.x0, b.x0);
        o.z0 = Math.min(o.z0, b.z0);
        o.x1 = Math.max(o.x1, b.x1);
        o.z1 = Math.max(o.z1, b.z1);
        merged = true;
      } else out.push({ ...b });
    }
    boxes = out;
  }
  cache.set(layout, boxes);
  return boxes;
}

const inside = (b: Box, p: P) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;

/** the segment a→b crosses box b's interior (Liang–Barsky) */
function crosses(box: Box, a: P, b: P): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const e = 1e-6;
  for (const [p, q] of [
    [-dx, a.x - (box.x0 + e)],
    [dx, box.x1 - e - a.x],
    [-dz, a.z - (box.z0 + e)],
    [dz, box.z1 - e - a.z],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** an end inside an obstacle's clearance (a step in front of a chair): out to its nearest edge first */
function escape(boxes: Box[], p: P): { p: P; extra: number } {
  for (const q of boxes) {
    if (!inside(q, p)) continue;
    const opts: [number, number, number][] = [
      [q.x0 - 0.001, p.z, p.x - q.x0],
      [q.x1 + 0.001, p.z, q.x1 - p.x],
      [p.x, q.z0 - 0.001, p.z - q.z0],
      [p.x, q.z1 + 0.001, q.z1 - p.z],
    ];
    opts.sort((u, v) => u[2] - v[2]);
    return { p: { x: opts[0][0], z: opts[0][1] }, extra: opts[0][2] };
  }
  return { p, extra: 0 };
}

/** length of the walk from a to b round the waiting room's furniture (m), and its corners */
export function routeLength(layout: LayoutDef, from: P, to: P): { length: number; corners: number } {
  const boxes = obstacles(layout);
  const ea = escape(boxes, from);
  const eb = escape(boxes, to);
  const a = ea.p;
  const b = eb.p;
  const nodes: P[] = [a, b];
  for (const q of boxes) nodes.push({ x: q.x0 - 0.01, z: q.z0 - 0.01 }, { x: q.x1 + 0.01, z: q.z0 - 0.01 }, { x: q.x0 - 0.01, z: q.z1 + 0.01 }, { x: q.x1 + 0.01, z: q.z1 + 0.01 });
  const ok = (p: P, q: P) => boxes.every((bx) => !crosses(bx, p, q));
  const dist = nodes.map(() => Infinity);
  const via = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || boxes.some((q) => inside(q, nodes[v]))) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (d < dist[v] && ok(nodes[u], nodes[v])) {
        dist[v] = d;
        via[v] = u;
      }
    }
  }
  if (dist[1] === Infinity) return { length: Math.hypot(to.x - from.x, to.z - from.z) * 1.25, corners: 1 };
  let corners = ea.extra > 0 ? 1 : 0;
  for (let i = via[1]; i > 0; i = via[i]) corners++;
  return { length: ea.extra + dist[1] + eb.extra, corners };
}

/**
 * Seconds to walk a→b at `pace` along that route: setting off (turning to go, getting up to speed),
 * slowing for each corner, and stopping. Never less than the plain straight-line estimate.
 */
export function routeWalkSecs(layout: LayoutDef, a: P, b: P, pace: number): number {
  const { length, corners } = routeLength(layout, a, b);
  const straight = (Math.hypot(a.x - b.x, a.z - b.z) * 1.25) / pace + 0.6;
  return Math.max(straight, length / pace + 1.3 + 0.35 * corners);
}

/**
 * The player's own walk up to something (a sofa seat), through furniture as tight as a person fits:
 * A* on a 10 cm grid over just the area between here and there, round the colliders on that storey
 * kept a body's radius clear (the controller's 0.3 m, controls.ts), then string-pulled into straight
 * legs that keep that clearance. The storeys' nav grids (pathfinding.ts: 35 cm cells, every box
 * inflated) are made for NPC routes and lose the gaps a person walks through: on Floor 2 the 80 cm
 * between a patient room's visitor chair and its wall, the only way round to the sofa.
 */
import * as THREE from 'three';

const CELL = 0.1;
/** cell centres this clear of every box (the controller's radius and a centimetre) */
const R_CELL = 0.31;
/** a straight leg this clear all along (the cells' own steps keep ≥ 0.302) */
const R_LEG = 0.295;
/** the area searched: the box round both ends and this much more */
const MARGIN = 3;
const MAX_CELLS = 250_000;

type P = { x: number; z: number };

/**
 * Waypoints from `from` to `to` (without the start, ending at `to` exactly), null when there is no
 * way through, undefined when it can't say (the area too big to search, or one end wedged in
 * tighter than it plans for: use the nav grid).
 */
export function finePath(colliders: readonly THREE.Box3[], floorY: number, from: P, to: P): THREE.Vector2[] | null | undefined {
  const minX = Math.min(from.x, to.x) - MARGIN;
  const minZ = Math.min(from.z, to.z) - MARGIN;
  const cols = Math.ceil((Math.max(from.x, to.x) + MARGIN - minX) / CELL);
  const rows = Math.ceil((Math.max(from.z, to.z) + MARGIN - minZ) / CELL);
  if (cols * rows > MAX_CELLS) return undefined;
  const maxX = minX + cols * CELL;
  const maxZ = minZ + rows * CELL;
  // what blocks a body on this storey (as the controller sees it: feet to head)
  const boxes = colliders.filter((b) => !b.isEmpty() && b.max.y > floorY + 0.05 && b.min.y < floorY + 2 && b.max.x > minX - R_CELL && b.min.x < maxX + R_CELL && b.max.z > minZ - R_CELL && b.min.z < maxZ + R_CELL);
  const blocked = new Uint8Array(cols * rows);
  for (const b of boxes) {
    const c0 = Math.max(0, Math.floor((b.min.x - R_CELL - minX) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((b.max.x + R_CELL - minX) / CELL));
    const r0 = Math.max(0, Math.floor((b.min.z - R_CELL - minZ) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((b.max.z + R_CELL - minZ) / CELL));
    for (let r = r0; r <= r1; r++) {
      const cz = minZ + (r + 0.5) * CELL;
      const dz = Math.max(b.min.z - cz, 0, cz - b.max.z);
      for (let c = c0; c <= c1; c++) {
        const cx = minX + (c + 0.5) * CELL;
        const dx = Math.max(b.min.x - cx, 0, cx - b.max.x);
        if (dx * dx + dz * dz < R_CELL * R_CELL) blocked[r * cols + c] = 1;
      }
    }
  }
  const free = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !blocked[r * cols + c];
  const cellOf = (p: P): [number, number] => [Math.floor((p.x - minX) / CELL), Math.floor((p.z - minZ) / CELL)];
  // (standing right up against something, or a spot found a centimetre tighter: the nearest free cell)
  const nearest = (p: P): number | null => {
    const [c, r] = cellOf(p);
    for (let ring = 0; ring <= 4; ring++) {
      let best = -1;
      let bd = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring || !free(c + dc, r + dr)) continue;
          const d = dc * dc + dr * dr;
          if (d < bd) {
            bd = d;
            best = (r + dr) * cols + c + dc;
          }
        }
      }
      if (best >= 0) return best;
    }
    return null;
  };
  const start = nearest(from);
  const goal = nearest(to);
  // (wedged in somewhere a centimetre tighter than this asks: no say)
  if (start === null || goal === null) return undefined;
  // A* (8 neighbours, no cutting a blocked corner)
  const n = cols * rows;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new Heap();
  const gc = goal % cols;
  const gr = (goal - gc) / cols;
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - gc);
    const dr = Math.abs(r - gr);
    return Math.max(dx, dr) + 0.4142 * Math.min(dx, dr);
  };
  g[start] = 0;
  heap.push(start, h(start % cols, (start - (start % cols)) / cols));
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (!free(nc, nr) || (dr && dc && (!free(cc + dc, cr) || !free(cc, cr + dr)))) continue;
        const ni = nr * cols + nc;
        if (closed[ni]) continue;
        const ng = g[cur] + (dr && dc ? 1.4142 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + h(nc, nr));
        }
      }
    }
  }
  if (!found) return null;
  const pts: P[] = [];
  for (let i = goal; i !== -1; i = came[i]) {
    const c = i % cols;
    pts.push({ x: minX + (c + 0.5) * CELL, z: minZ + ((i - c) / cols + 0.5) * CELL });
    if (i === start) break;
  }
  pts.reverse();
  pts[0] = from;
  pts.push(to);
  // straight legs as long as they stay clear (the steps between neighbouring cells always do)
  const clearLeg = (a: P, b: P) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.04));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const z = a.z + ((b.z - a.z) * i) / steps;
      for (const bx of boxes) {
        const dx = Math.max(bx.min.x - x, 0, x - bx.max.x);
        const dz = Math.max(bx.min.z - z, 0, z - bx.max.z);
        if (dx * dx + dz * dz < R_LEG * R_LEG) return false;
      }
    }
    return true;
  };
  const out: THREE.Vector2[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && clearLeg(pts[i], pts[j + 1])) j++;
    out.push(new THREE.Vector2(pts[j].x, pts[j].z));
    i = j;
  }
  return out;
}

/** a binary min-heap of cell ids by key */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const a = this.ids;
    const k = this.keys;
    a.push(id);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.ids;
    const k = this.keys;
    const top = a[0];
    const lastId = a.pop()!;
    const lastK = k.pop()!;
    if (a.length) {
      a[0] = lastId;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

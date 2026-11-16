/**
 * A drink's surface in its cup (amenities.ts), as plain geometry: how high it stands for a fill, and
 * the level plane that holds it however the cup is tipped, cut to the inside of the cup, so it never
 * pokes through the wall or stands above the rim. Everything is in the cup's own frame (y up its
 * axis, the bottom of the cup at y = 0).
 */
import * as THREE from 'three';

/** a cup's inside: inner radius at the bottom and at the rim, the inner bottom's height, a full serving's depth (88 % of the inside) */
export interface CupInside {
  r0: number;
  r1: number;
  base: number;
  hFull: number;
}

/** points round the surface's outline (before it is cut by the bottom and the rim) */
export const SURF_N = 32;
/** the most it can have once cut */
export const SURF_MAX = SURF_N + 8;

/** the inside's depth (rim above the inner bottom) */
const depth = (c: CupInside) => c.hFull / 0.88;

/** the surface's height above the inner bottom for a fill (0..1) with the cup upright (a frustum: the level falls faster near the bottom) */
export function levelFor(c: CupInside, fill: number): number {
  const H = c.hFull;
  if (c.r0 === c.r1) return H * fill;
  const vol = (h: number) => {
    const r = c.r0 + ((c.r1 - c.r0) * h) / depth(c);
    return h * (c.r0 * c.r0 + c.r0 * r + r * r);
  };
  const want = vol(H) * fill;
  let lo = 0;
  let hi = H;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    if (vol(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** the area of a disc of radius r on one side of a chord at signed distance d from its centre */
export function discPart(d: number, r: number): number {
  if (d >= r) return Math.PI * r * r;
  if (d <= -r) return 0;
  return r * r * Math.acos(-d / r) + d * Math.sqrt(r * r - d * d);
}

/** a hair inside the wall (the surface never shows through it) */
const INSET = 0.0007;

/** the inside's volume below the plane n·p = c (n = world up in the cup's frame), by slices */
export function volumeBelow(cup: CupInside, n: THREE.Vector3, c: number, slices = 24): number {
  const hi = depth(cup);
  const r0 = cup.r0 - INSET;
  const k = (cup.r1 - cup.r0) / hi;
  const s = Math.hypot(n.x, n.z);
  const ny = Math.max(0.05, n.y);
  let v = 0;
  for (let i = 0; i < slices; i++) {
    const h = ((i + 0.5) / slices) * hi;
    const r = r0 + k * h;
    const y = cup.base + h;
    v += s < 1e-6 ? (ny * y <= c ? Math.PI * r * r : 0) : discPart((c - ny * y) / s, r);
  }
  return (v * hi) / slices;
}

/**
 * The drink's surface for a fill with the cup tipped so that world up is `n` in its frame: the
 * outline of the level plane holding the drink's volume, cut to the inside of the cup (its wall,
 * its bottom, its rim). A convex polygon, clockwise seen from above; empty when there's nothing.
 */
export function surfaceOutline(cup: CupInside, fill: number, n: THREE.Vector3): THREE.Vector3[] {
  const b = cup.base;
  const hi = depth(cup);
  const r0 = cup.r0 - INSET;
  const k = (cup.r1 - cup.r0) / hi;
  const rAt = (h: number) => r0 + k * h;
  const level = levelFor(cup, fill);
  const s = Math.hypot(n.x, n.z);
  const ny = Math.max(0.05, n.y);
  let c: number;
  if (s < 0.004) c = ny * (b + level);
  else {
    // the plane n·p = c whose part of the cup holds the drink's volume (bisection)
    const rl = rAt(level);
    const want = (Math.PI / 3) * level * (r0 * r0 + r0 * rl + rl * rl);
    let lo = Math.min(ny * b - s * r0, ny * (b + hi) - s * rAt(hi));
    let up = Math.max(ny * b + s * r0, ny * (b + hi) + s * rAt(hi));
    for (let it = 0; it < 22; it++) {
      const mid = (lo + up) / 2;
      if (volumeBelow(cup, n, mid) < want) lo = mid;
      else up = mid;
    }
    c = (lo + up) / 2;
  }
  // where the plane meets the (endless) wall all the way round, then cut by the bottom and the rim
  let poly: THREE.Vector3[] = [];
  for (let j = 0; j < SURF_N; j++) {
    const a = (j / SURF_N) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const sig = n.x * ca + n.z * sa;
    const h = (c - ny * b - r0 * sig) / Math.max(0.02, k * sig + ny);
    const r = Math.max(0.001, rAt(Math.max(-0.15, h)));
    poly.push(new THREE.Vector3(r * ca, (c - r * sig) / ny, r * sa));
  }
  const clip = (pts: THREE.Vector3[], y: number, keepAbove: boolean) => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const pin = keepAbove ? p.y >= y : p.y <= y;
      const qin = keepAbove ? q.y >= y : q.y <= y;
      if (pin) out.push(p);
      if (pin !== qin) out.push(p.clone().lerp(q, (y - p.y) / (q.y - p.y)));
    }
    return out;
  };
  poly = clip(clip(poly, b + 0.0008, true), b + hi, false);
  return poly.length >= 3 ? poly.slice(0, SURF_MAX) : [];
}

/** write an outline as a triangle fan facing up (`n`) into a geometry made for it (SURF_MAX × 3 vertices) */
export function writeSurface(g: THREE.BufferGeometry, poly: THREE.Vector3[], n: THREE.Vector3) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const m = poly.length;
  if (m < 3) {
    g.setDrawRange(0, 0);
    return;
  }
  const mid = new THREE.Vector3();
  for (const p of poly) mid.add(p);
  mid.divideScalar(m);
  let v = 0;
  for (let i = 0; i < m; i++) {
    // (the outline runs clockwise seen from above: wound the other way, the top is the front face)
    for (const p of [mid, poly[(i + 1) % m], poly[i]]) {
      pos.setXYZ(v, p.x, p.y, p.z);
      nor.setXYZ(v, n.x, n.y, n.z);
      v++;
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  g.setDrawRange(0, v);
}

/**
 * Hospital bedding (client/src/world/bedding.ts): the blanket draped over a lying patient stays
 * inside the bed (never through the side rails, the footboard or a stretcher's push handle, the
 * hem above the deck), clears the fitted sheet (no z-fighting), covers the body without anything
 * poking through, and keeps to its triangle budget; the made-up bed's linen faces outward.
 * The body here is a synthetic one of capsules, lying the way avatars.ts lays a patient down.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bedLinen, bedSpec, drapeBlanket, type BedKind } from '../client/src/world/bedding';

type Seg = [number, number, number, number, number, number, number];
/** a supine body in the bed frame (x across, y up, z toward the foot), lying on the 0.64 m surface */
function body(height = 1.7, feetApart = 0.1): { pts: number[]; pelvisZ: number; neckZ: number } {
  const k = height / 1.7;
  const y = 0.755;
  const zf = 0.53 * height; // the soles (avatars.ts puts the body's origin there)
  const z = (fromFeet: number) => zf - fromFeet * k;
  const segs: Seg[] = [
    // torso (three capsules side by side), pelvis to neck
    [0, y, z(0.85), 0, y + 0.01, z(1.36), 0.12],
    [0.07, y - 0.01, z(0.88), 0.08, y, z(1.32), 0.1],
    [-0.07, y - 0.01, z(0.88), -0.08, y, z(1.32), 0.1],
  ];
  for (const sx of [-1, 1]) {
    const fx = sx * feetApart;
    segs.push(
      [sx * 0.09, y - 0.01, z(0.85), fx, y - 0.015, z(0.47), 0.075], // thigh
      [fx, y - 0.015, z(0.47), fx, y - 0.015, z(0.07), 0.05], // shin
      [fx, y - 0.01, z(0.04), fx + sx * 0.01, y + 0.17, z(0.0), 0.04], // foot, toes up
      [sx * 0.2, y + 0.01, z(1.3), sx * 0.23, y, z(1.02), 0.042], // upper arm
      [sx * 0.23, y, z(1.02), sx * 0.24, y, z(0.78), 0.035], // forearm
      [sx * 0.24, y, z(0.78), sx * 0.245, y - 0.005, z(0.68), 0.03], // hand
    );
  }
  const pts: number[] = [];
  for (const [ax, ay, az, bx, by, bz, r] of segs) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(2, Math.ceil(len / 0.012));
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
    const u = new THREE.Vector3(1, 0, 0).cross(d);
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(d);
    u.normalize();
    const v = d.clone().cross(u).normalize();
    for (let i = 0; i <= n; i++)
      for (let a = 0; a < 24; a++) {
        const t = i / n;
        const ang = (a / 24) * Math.PI * 2;
        const c = Math.cos(ang) * r;
        const s = Math.sin(ang) * r;
        pts.push(ax + (bx - ax) * t + u.x * c + v.x * s, ay + (by - ay) * t + u.y * c + v.y * s, az + (bz - az) * t + u.z * c + v.z * s);
      }
  }
  return { pts, pelvisZ: z(0.85), neckZ: z(1.4) };
}

const kinds: BedKind[] = ['bed', 'stretcher'];

describe('a patient’s blanket', () => {
  for (const kind of kinds)
    for (const height of [1.5, 1.6, 1.8, 1.9])
      it(`${kind}, a ${height} m patient: inside the bed, clear of the sheet, over the whole body`, () => {
        const s = bedSpec(kind);
        const b = body(height);
        const g = drapeBlanket({ ...b, spec: s, dy: 0, seed: 7 });
        const pos = g.getAttribute('position');
        const tris = g.index!.count / 3;
        expect(tris).toBeGreaterThan(2000);
        expect(tris).toBeLessThanOrEqual(4000);
        const xIn = s.hw - s.r;
        let maxX = 0;
        let maxZ = -9;
        let minY = 9;
        let onSheet = 9;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
          maxX = Math.max(maxX, Math.abs(x));
          maxZ = Math.max(maxZ, z);
          minY = Math.min(minY, y);
          // over the mattress: never within 3 mm of the fitted sheet (round its edges too)
          const e = Math.hypot(Math.max(0, Math.abs(x) - xIn), Math.max(0, z - (s.zFoot - s.r)));
          if (y > s.top - s.r) onSheet = Math.min(onSheet, Math.hypot(e, y - (s.top - s.r)) - (s.r + 0.004));
        }
        expect(maxX, 'through the side rails').toBeLessThan(s.railIn - 0.002);
        if (height < 1.85) expect(maxZ, 'through the footboard / handle').toBeLessThan(s.footIn - 0.002);
        expect(minY, 'hem on the deck').toBeGreaterThan(s.deck + 0.004);
        expect(onSheet, 'touching the fitted sheet').toBeGreaterThan(0.003);

        // nothing of the body pokes through the blanket (below the turn-down, over the mattress)
        const idx = g.index!;
        const blanketTris = g.groups.length ? g.groups[0].count / 3 : tris;
        const A = new THREE.Vector3();
        const B = new THREE.Vector3();
        const C = new THREE.Vector3();
        const cover: [number, number, number, number, number, number, number, number, number][] = [];
        for (let t = 0; t < blanketTris; t++) {
          A.fromBufferAttribute(pos, idx.getX(t * 3));
          B.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
          C.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
          cover.push([A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z]);
        }
        const zTop = Math.min(s.zFoot - s.r - 0.35, b.pelvisZ + 0.5 * (b.neckZ - b.pelvisZ));
        let worst = 1;
        for (let k = 0; k < b.pts.length; k += 9) {
          const [x, y, z] = [b.pts[k], b.pts[k + 1], b.pts[k + 2]];
          if (z < zTop + 0.2 || z > s.zFoot - s.r || y < s.top + 0.02) continue;
          let over = -9;
          for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of cover) {
            const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(d) < 1e-12) continue;
            const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
            const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            over = Math.max(over, l1 * ay + l2 * by + l3 * cy);
          }
          worst = Math.min(worst, over - y);
        }
        expect(worst, 'body through the blanket').toBeGreaterThan(0.002);
      });

  it('a skirt of a few big triangles across the thighs stays under it, not just its corners', () => {
    const s = bedSpec('bed');
    const b = body(1.6);
    // a low-poly skirt: a 40 cm wide panel over the thighs, raised in the middle, as 4 triangles
    const base = b.pts.length / 3;
    const y = 0.86;
    const z0 = b.pelvisZ - 0.02;
    const z1 = b.pelvisZ + 0.34;
    b.pts.push(-0.2, y - 0.05, z0, 0, y, z0, 0.2, y - 0.05, z0, -0.2, y - 0.06, z1, 0, y - 0.01, z1, 0.2, y - 0.06, z1);
    const tris = [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5].map((k) => base + k);
    const g = drapeBlanket({ ...b, tris, spec: s, dy: 0, seed: 11 });
    const pos = g.getAttribute('position');
    const idx = g.index!;
    const n = g.groups[0].count / 3;
    const under = (x: number, z: number) => {
      let best = -9;
      const A = new THREE.Vector3();
      const B = new THREE.Vector3();
      const C = new THREE.Vector3();
      for (let t = 0; t < n; t++) {
        A.fromBufferAttribute(pos, idx.getX(t * 3));
        B.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
        C.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
        const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / d;
        const l2 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / d;
        if (l1 < -1e-6 || l2 < -1e-6 || 1 - l1 - l2 < -1e-6) continue;
        best = Math.max(best, l1 * A.y + l2 * B.y + (1 - l1 - l2) * C.y);
      }
      return best;
    };
    // the panel's surface, sampled inside its triangles
    let worst = 1;
    for (let k = 0; k < tris.length; k += 3) {
      const [a, bb, c] = [tris[k] * 3, tris[k + 1] * 3, tris[k + 2] * 3];
      for (let u = 0; u <= 8; u++)
        for (let v = 0; v <= 8 - u; v++) {
          const [wa, wb] = [u / 8, v / 8];
          const wc = 1 - wa - wb;
          const P = [0, 1, 2].map((o) => b.pts[a + o] * wa + b.pts[bb + o] * wb + b.pts[c + o] * wc);
          worst = Math.min(worst, under(P[0], P[2]) - P[1]);
        }
    }
    expect(worst, 'skirt through the blanket').toBeGreaterThan(0.004);
  });

  for (const kind of kinds)
    it(`${kind}: the blanket lies clear of the fitted sheet's wrinkles (no flicker between them)`, () => {
      const s = bedSpec(kind);
      const sheet = bedLinen(kind).sheet.getAttribute('position');
      const g = drapeBlanket({ ...body(1.7), spec: s, dy: 0, seed: 4 });
      const pos = g.getAttribute('position');
      const flat = (x: number, z: number) => Math.abs(x) < s.hw - s.r - 0.02 && z > -0.2 && z < s.zFoot - s.r - 0.02;
      let sheetTop = -9;
      for (let i = 0; i < sheet.count; i++) if (flat(sheet.getX(i), sheet.getZ(i))) sheetTop = Math.max(sheetTop, sheet.getY(i));
      const idx = g.index!;
      let low = 9;
      for (let k = 0; k < g.groups[0].count; k++) {
        const i = idx.getX(k);
        if (flat(pos.getX(i), pos.getZ(i))) low = Math.min(low, pos.getY(i));
      }
      expect(low - sheetTop).toBeGreaterThan(0.003);
    });

  it('a tall patient’s feet still end up under the blanket, inside the footboard', () => {
    const s = bedSpec('bed');
    const g = drapeBlanket({ ...body(1.84), spec: s, dy: 0, seed: 3 });
    const pos = g.getAttribute('position');
    let maxZ = -9;
    for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
    expect(maxZ).toBeLessThan(s.footIn - 0.002);
    expect(maxZ).toBeGreaterThan(0.53 * 1.84);
  });
});

describe('a made-up bed', () => {
  for (const kind of kinds)
    it(`${kind}: sheet, pillow and folded blanket face outward, inside the frame, on the mattress`, () => {
      const s = bedSpec(kind);
      const l = bedLinen(kind);
      for (const [name, g] of Object.entries(l)) {
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const idx = g.index!;
        let agree = 0;
        const A = new THREE.Vector3();
        const B = new THREE.Vector3();
        const C = new THREE.Vector3();
        const n = new THREE.Vector3();
        for (let t = 0; t < idx.count; t += 3) {
          A.fromBufferAttribute(pos, idx.getX(t));
          B.fromBufferAttribute(pos, idx.getX(t + 1));
          C.fromBufferAttribute(pos, idx.getX(t + 2));
          const f = B.clone().sub(A).cross(C.clone().sub(A));
          n.fromBufferAttribute(nor, idx.getX(t));
          if (f.dot(n) >= 0) agree++;
        }
        expect(agree / (idx.count / 3), `${name}: winding matches its normals`).toBeGreaterThan(0.97);
        for (let i = 0; i < pos.count; i++) {
          const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
          expect(Number.isFinite(x + y + z), name).toBe(true);
          expect(Math.abs(x), `${name} through the rails`).toBeLessThan(s.railIn - 0.01);
          expect(Math.abs(z), `${name} through the head/footboard`).toBeLessThan(s.footIn - 0.01);
          expect(y, `${name} below the mattress`).toBeGreaterThan(s.bottom);
        }
        // the top of each piece faces up
        let top = 0;
        for (let i = 1; i < pos.count; i++) if (pos.getY(i) > pos.getY(top)) top = i;
        expect(nor.getY(top), `${name}: its top faces up`).toBeGreaterThan(0.8);
        expect(g.index!.count / 3, `${name}: triangles`).toBeLessThan(2500);
      }
    });
});

/**
 * The articulated bed's bend (client/src/world/bedRig.ts Bend): the flat bed mapped onto one whose
 * backrest is up. Back and forth it returns the same point; every layer over or under the mattress top
 * stays a smooth curve that never folds back on itself; the layers stay as far apart as they were (the
 * sheet never gets into the mattress); and the made-up linen bent at 80° still faces outward and lies
 * on the mattress.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bedLinen, bedSpec, bendGeometry, type BedKind } from '../client/src/world/bedding';
import { Bend } from '../client/src/world/bedRig';

const DEG = Math.PI / 180;
const kinds: BedKind[] = ['bed', 'stretcher'];
const angles = [0, 15, 30, 45, 60, 80];

describe('the backrest’s bend', () => {
  for (const kind of kinds)
    for (const deg of angles) {
      const s = bedSpec(kind);
      const b = new Bend(s, deg * DEG);
      it(`${kind} at ${deg}°: there and back is the same point (outside the crease's fold)`, () => {
        const o = [0, 0, 0];
        const back = [0, 0];
        let worst = 0;
        for (let h = -0.19; h <= 0.3; h += 0.01)
          for (let z = -0.98; z <= 0.98; z += 0.005) {
            // a layer higher than the fillet's radius, inside the crease: the cloth bunches there (no single point to return to)
            if (h > s.hinge.r - 0.005 && Math.abs(z - s.hinge.z) < (h + 0.01) * Math.tan((deg * DEG) / 2) + 0.01) continue;
            b.map(s.top + h, z, o);
            b.unmap(o[0], o[1], back);
            worst = Math.max(worst, Math.hypot(back[0] - (s.top + h), back[1] - z));
          }
        expect(worst).toBeLessThan(0.001);
      });

      it(`${kind} at ${deg}°: each layer a smooth curve, no fold, no jump; the head end turned by the angle`, () => {
        const o = [0, 0, 0];
        const th = deg * DEG;
        for (let h = -0.19; h <= 0.3; h += 0.02) {
          // under the top the crease's arc is wider than the stretch of mattress it is made from (a thick
          // mattress's underside stretches round the hinge): by its radius over the fillet's, nowhere more
          const r = s.hinge.r;
          const stretch = h < r && th > 0 ? Math.max(1, ((r - h) * th) / (2 * r * Math.tan(th / 2))) : 1;
          let prev: [number, number] | null = null;
          let prevDir: [number, number] | null = null;
          for (let z = -0.98; z <= 0.98; z += 0.004) {
            b.map(s.top + h, z, o);
            const p: [number, number] = [o[0], o[1]];
            if (prev) {
              const d: [number, number] = [p[0] - prev[0], p[1] - prev[1]];
              const len = Math.hypot(d[0], d[1]);
              // never stretched past that, never folded back
              expect(len).toBeLessThan(0.004 * stretch * 1.05 + 1e-6);
              if (prevDir) expect(d[0] * prevDir[0] + d[1] * prevDir[1]).toBeGreaterThan(-1e-9);
              prevDir = d;
            }
            prev = p;
          }
        }
        // the backrest's end: turned about the crease by the angle (its top rises by its length × sin)
        b.map(s.top, -s.zFoot, o);
        expect(o[0] - s.top).toBeCloseTo((s.zFoot + s.hinge.z) * Math.sin(deg * DEG), 6);
      });

      it(`${kind} at ${deg}°: the layers stay apart (the sheet over the mattress, the mattress over its deck)`, () => {
        const a = [0, 0, 0];
        const c = [0, 0, 0];
        let least = Infinity;
        for (let z = -0.97; z <= 0.97; z += 0.003) {
          // the mattress top and the sheet 4 mm over it; the mattress bottom and the deck's top
          for (const [h0, h1] of [[0, 0.004], [-0.14, -0.139]]) {
            b.map(s.top + h0, z, a);
            b.map(s.top + h1, z, c);
            least = Math.min(least, Math.hypot(c[0] - a[0], c[1] - a[1]) / (h1 - h0));
          }
        }
        expect(least).toBeGreaterThan(0.9);
      });
    }

  for (const kind of kinds)
    it(`${kind}: the made-up linen bent to 80° faces outward and stays on the mattress`, () => {
      const s = bedSpec(kind);
      const b = new Bend(s, 80 * DEG);
      const g = bedLinen(kind).sheet.clone();
      bendGeometry(g, b);
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
        if (f.lengthSq() < 1e-14 || f.dot(n) >= 0) agree++;
      }
      expect(agree / (idx.count / 3)).toBeGreaterThan(0.97);
      // its top, as on the flat bed: over the mattress (never into it)
      const back = [0, 0];
      let low = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getX(i)) > s.hw - s.r) continue;
        b.unmap(pos.getY(i), pos.getZ(i), back);
        if (back[0] > s.top - 0.01 && Math.abs(back[1]) < s.zFoot - s.r) low = Math.min(low, back[0] - s.top);
      }
      expect(low).toBeGreaterThan(0.0035);
    });
});

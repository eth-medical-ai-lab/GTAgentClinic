/**
 * A drink's surface in its cup (client/src/world/drinkLevel.ts) stays level in the world however the
 * cup is tipped for a sip, keeps the drink's volume, and never pokes through the cup's wall or stands
 * above its rim: the paper cup (a frustum) and the mug (a cylinder), full to nearly empty, upright to
 * tipped 80°.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { levelFor, surfaceOutline, volumeBelow, type CupInside } from '../client/src/world/drinkLevel';

// amenities.ts buildCup: r0, r1, the inner bottom, a full serving 88 % of the inside's depth
const PAPER: CupInside = { r0: 0.029, r1: 0.0425, base: 0.006, hFull: (0.115 - 0.006) * 0.88 };
const MUG: CupInside = { r0: 0.038, r1: 0.038, base: 0.009, hFull: (0.095 - 0.009) * 0.88 };

/** world up in the cup's frame with the cup tipped by `tilt` toward `azimuth` */
const upIn = (tilt: number, azimuth: number) => new THREE.Vector3(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));

describe('a drink stays level in a tipped cup', () => {
  for (const [name, cup] of [['paper cup', PAPER], ['mug', MUG]] as const) {
    const depth = cup.hFull / 0.88;
    const wall = (y: number) => cup.r0 + ((cup.r1 - cup.r0) * (y - cup.base)) / depth;
    it(`${name}: inside the wall, under the rim, level, from full to the last sip`, () => {
      for (const fill of [1, 0.75, 0.5, 0.25, 0.12, 0.05]) {
        for (const deg of [0, 10, 20, 35, 50, 65, 80]) {
          for (const az of [0, 1.3, Math.PI, 4.4]) {
            const n = upIn((deg * Math.PI) / 180, az);
            const poly = surfaceOutline(cup, fill, n);
            expect(poly.length, `${fill}/${deg}°`).toBeGreaterThanOrEqual(3);
            const c0 = poly[0].dot(n);
            for (const p of poly) {
              // on the cup's inside: above the bottom, not above the rim, not through the wall
              expect(p.y).toBeGreaterThanOrEqual(cup.base);
              expect(p.y).toBeLessThanOrEqual(cup.base + depth + 1e-6);
              expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(wall(p.y) + 1e-6);
              // and level in the world: one plane perpendicular to world up
              expect(Math.abs(p.dot(n) - c0)).toBeLessThan(1e-6);
            }
          }
        }
      }
    });

    it(`${name}: the tipped surface holds the same volume as the upright one (until it reaches the rim)`, () => {
      for (const fill of [0.75, 0.4, 0.12]) {
        const level = levelFor(cup, fill);
        const n0 = new THREE.Vector3(0, 1, 0);
        const upright = volumeBelow(cup, n0, cup.base + level, 400);
        for (const deg of [15, 40, 60]) {
          const n = upIn((deg * Math.PI) / 180, 0.7);
          const poly = surfaceOutline(cup, fill, n);
          const top = Math.max(...poly.map((p) => p.y));
          if (top >= cup.base + depth - 1e-4) continue; // at the rim: the sip is in your mouth
          const v = volumeBelow(cup, n, poly[0].dot(n), 400);
          expect(Math.abs(v - upright) / upright, `${fill}/${deg}°`).toBeLessThan(0.03);
        }
      }
    });
  }

  it('a full cup reaches the lip at about 20°, the last sips need most of the way over', () => {
    const atRim = (fill: number, deg: number) => {
      const poly = surfaceOutline(PAPER, fill, upIn((deg * Math.PI) / 180, 0));
      return Math.max(...poly.map((p) => p.y)) >= PAPER.base + PAPER.hFull / 0.88 - 1e-4;
    };
    expect(atRim(1, 8)).toBe(false);
    expect(atRim(1, 22)).toBe(true);
    expect(atRim(0.12, 45)).toBe(false);
  });
});

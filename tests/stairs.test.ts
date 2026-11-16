/** Stair walking height: a dog-leg stair core climbs without steps the controller can't take. */
import { describe, expect, it } from 'vitest';
import type { LayoutDef } from '../shared/layout';
import { LAYOUTS } from '../shared/layout';
import { standHeight, stepCount } from '../client/src/world/stairs';

// a 2.6 × 6 m core at the origin: flight 1 north on the west side, flight 2 south on the east side
const core = {
  ...Object.values(LAYOUTS)[0],
  ramps: [
    { id: 'f1', room: 'stairs', rect: { x: 0.12, z: 1.6, w: 1.2, d: 2.5 }, up: 'n', rise: 1.5, steps: 9 },
    { id: 'f2', room: 'stairs', rect: { x: 1.52, z: 1.6, w: 1.2, d: 2.5 }, up: 's', rise: 1.5, base: 1.5, steps: 9 },
  ],
  landings: [
    { id: 'half', room: 'stairs', rect: { x: 0.12, z: 0.12, w: 2.6, d: 1.48 }, y: 1.5 },
    { id: 'upper', room: 'stairs', rect: { x: 1.52, z: 4.1, w: 1.2, d: 1.4 }, y: 3.0 },
  ],
} as LayoutDef;

describe('standHeight', () => {
  it('is the floor outside the stairs and the landing height on a landing', () => {
    expect(standHeight(core, 0.7, 5.5)).toBe(0);
    expect(standHeight(core, 1.0, 0.8)).toBe(1.5);
    expect(standHeight(core, 2.1, 4.8)).toBe(3.0);
  });

  it('follows the step tops within half a riser', () => {
    const r = core.ramps![0];
    const riser = r.rise / stepCount(r);
    for (let i = 0; i < 9; i++) {
      // middle of tread i (counted from the bottom, which is the south edge for an 'n' flight)
      const z = r.rect.z + r.rect.d - (i + 0.5) * (r.rect.d / 9);
      const treadTop = (i + 1) * riser;
      expect(Math.abs(standHeight(core, 0.7, z) - treadTop)).toBeLessThanOrEqual(riser / 2 + 1e-9);
    }
  });

  it('walks floor → flight 1 → half-landing → flight 2 → upper landing with no step over 0.45 m', () => {
    const path: [number, number][] = [];
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.05);
      for (let i = 0; i <= n; i++) path.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n]);
    };
    seg(0.7, 5.8, 0.7, 4.3); // approach flight 1's foot
    seg(0.7, 4.3, 0.7, 0.8); // up flight 1 onto the half-landing
    seg(0.7, 0.8, 2.1, 0.8); // across the half-landing
    seg(2.1, 0.8, 2.1, 4.8); // up flight 2 onto the upper landing
    let prev = standHeight(core, ...path[0]);
    let maxJump = 0;
    for (const p of path) {
      const y = standHeight(core, ...p);
      maxJump = Math.max(maxJump, Math.abs(y - prev));
      prev = y;
    }
    expect(maxJump).toBeLessThan(0.45);
    expect(prev).toBe(3.0);
  });
});

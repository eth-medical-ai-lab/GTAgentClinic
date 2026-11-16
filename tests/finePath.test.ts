/**
 * The player's fine walk planner (client/src/world/finePath.ts): through a gap a person fits (the
 * 80 cm by a visitor's chair that the 35 cm nav grid loses), not through one they don't, every leg
 * keeping the controller's radius clear, and only what stands on that storey in the way.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { finePath } from '../client/src/world/finePath';

const box = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = 1) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
/** a wall across z = 0 from x −5 to 5 with a gap of `w` round x = 0 */
const wallWithGap = (w: number, y0 = 0) => [box(-5, -0.06, -w / 2, 0.06, y0, y0 + 2.6), box(w / 2, -0.06, 5, 0.06, y0, y0 + 2.6)];

/** the least clearance along the walk from `from` (to the boxes, m) */
function leastClearance(from: { x: number; z: number }, path: THREE.Vector2[], boxes: THREE.Box3[]) {
  let least = Infinity;
  let a = new THREE.Vector2(from.x, from.z);
  for (const b of path) {
    for (let i = 0; i <= 200; i++) {
      const x = a.x + ((b.x - a.x) * i) / 200;
      const z = a.y + ((b.y - a.y) * i) / 200;
      for (const q of boxes) least = Math.min(least, Math.hypot(Math.max(q.min.x - x, 0, x - q.max.x), Math.max(q.min.z - z, 0, z - q.max.z)));
    }
    a = b;
  }
  return least;
}

describe('finePath', () => {
  it('walks straight across open floor', () => {
    const p = finePath([], 0, { x: 0, z: 0 }, { x: 3, z: 1 });
    expect(p).toHaveLength(1);
    expect(p![0].x).toBeCloseTo(3);
    expect(p![0].y).toBeCloseTo(1);
  });

  it('goes through an 80 cm gap, a body’s radius clear all the way, and ends where it was asked', () => {
    const boxes = wallWithGap(0.8);
    const from = { x: -1.5, z: -2 };
    const p = finePath(boxes, 0, from, { x: 1.2, z: 2 });
    expect(p).toBeTruthy();
    expect(p![p!.length - 1].x).toBeCloseTo(1.2);
    expect(p![p!.length - 1].y).toBeCloseTo(2);
    expect(leastClearance(from, p!, boxes)).toBeGreaterThanOrEqual(0.29);
  });

  it('finds no way through a gap narrower than a person', () => {
    expect(finePath(wallWithGap(0.55), 0, { x: 0, z: -2 }, { x: 0, z: 2 })).toBeNull();
  });

  it('only what stands on that storey is in the way', () => {
    // the floor below's wall (y 0–2.6) doesn't block Floor 2 (y 3)
    const p = finePath(wallWithGap(0.3), 3, { x: 0, z: -2 }, { x: 0, z: 2 });
    expect(p).toHaveLength(1);
    expect(finePath(wallWithGap(0.3, 3), 3, { x: 0, z: -2 }, { x: 0, z: 2 })).toBeNull();
  });

  it('round a chair: past its far side when the near side is too tight', () => {
    // a chair 0.35 m off a bed's foot, 0.85 m off the wall: the way is past the wall side
    const boxes = [box(-3, -0.5, 0, 0.5), box(0.35, -0.35, 1.05, 0.35), box(1.9, -3, 2.1, 3)];
    const from = { x: 0.7, z: -1.5 };
    const p = finePath(boxes, 0, from, { x: 0.7, z: 1.5 });
    expect(p).toBeTruthy();
    expect(Math.max(...p!.map((q) => q.x))).toBeGreaterThan(1.3);
    expect(leastClearance(from, p!, boxes)).toBeGreaterThanOrEqual(0.29);
  });
});

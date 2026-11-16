import { describe, expect, it } from 'vitest';
import { Vector2 } from 'three';
import { dischargeOverlap } from '../client/src/world/dischargeRoute';
import { openDoorLeaves } from '../client/src/world/doorLeaves';
import { dischargeExit, dischargePickup, LAYOUTS, roomById } from '../shared/layout';
import { navWorld } from './navWorld';

const layout = LAYOUTS.ed;
const world = navWorld(layout);
const nav = world.grid.npcLayer(world.footprints);
const exit = dischargeExit(layout);

describe('discharge route clearance', () => {
  for (const bed of ['ft_1', 'ft_2', 'bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'bed_6', 'resus']) {
    it.each(['walking', 'wheelchair'] as const)(`%s exit from ${bed} clears door leaves, walls and furniture`, mobility => {
      const start = dischargePickup(layout, bed)!;
      const wheel = mobility === 'wheelchair';
      const yaw = roomById(layout, bed)!.spots.bed.rot ?? 0;
      const route = nav.route(start.x, start.z, exit.x, exit.z, { clearance: wheel ? 0.45 : 0.3 })
        ?? nav.route(start.x, start.z, exit.x, exit.z, { clearance: 0.4 });
      expect(route).toBeTruthy();
      const issue = dischargeOverlap(nav, route!, wheel, yaw, []);
      expect(issue, issue).toBeUndefined();
    });
  }

  it('reports an overlap halfway through a path even with clear endpoints', () => {
    const ft = roomById(layout, 'ft_1')!;
    const [leaf] = openDoorLeaves(ft, ft.doors[0]);
    expect(world.colliders.some(box => box.equals(leaf))).toBe(true);
    // Across the face of the parked leaf, one metre inside the room.
    const x = ft.rect.x + ft.doors[0].offset + 0.03, z = ft.rect.z + 1;
    const throughDoor = nav.fallbackRoute([new Vector2(x + 0.6, z)], x - 0.6, z);
    expect(dischargeOverlap(nav, throughDoor, false, 0, [])).toMatch(/Overlap between walking patient and Fast Track 1 n door leaf.*at .*along exit route/);
  });

  it('checks the footrests and the nurse even when the rider centre clears the obstacle', () => {
    const route = nav.fallbackRoute([new Vector2(8, 27)], 5, 27);
    expect(dischargeOverlap(nav, route, true, Math.PI / 2, [{ x: 8.55, z: 27, r: 0.1 }])).toContain('footrests and parked wheelchair');
    expect(dischargeOverlap(nav, route, true, Math.PI / 2, [{ x: 4.3, z: 27, r: 0.1 }])).toContain('escorting nurse and parked wheelchair');
  });
});

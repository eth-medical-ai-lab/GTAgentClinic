import { Box3, Vector3 } from 'three';
import type { DoorDef, RoomDef, Side } from '../../../shared/layout';

export const WALL_T = 0.12;
export const DOOR_H = 2.25;

export function sideFrame(r: RoomDef, side: Side) {
  // returns start point, direction (unit along wall), length, inward normal
  const { x, z, w, d } = r.rect;
  switch (side) {
    case 'n':
      return { sx: x, sz: z, dx: 1, dz: 0, len: w, nx: 0, nz: 1 };
    case 's':
      return { sx: x, sz: z + d, dx: 1, dz: 0, len: w, nx: 0, nz: -1 };
    case 'w':
      return { sx: x, sz: z, dx: 0, dz: 1, len: d, nx: 1, nz: 0 };
    case 'e':
      return { sx: x + w, sz: z, dx: 0, dz: 1, len: d, nx: -1, nz: 0 };
  }
}

/** The parked, inward-open leaves, including their kick plates. Render and navigate the same solids. */
export function openDoorLeaves(room: RoomDef, door: DoorDef): Box3[] {
  if (door.kind !== 'door' && door.kind !== 'double') return [];
  const f = sideFrame(room, door.side);
  const count = door.kind === 'double' ? 2 : 1;
  const length = door.width / count - 0.04;
  const y = door.y ?? 0;
  const leaves: Box3[] = [];
  for (let i = 0; i < count; i++) {
    const hinge = i === 0 ? door.offset + 0.03 : door.offset + door.width - 0.03;
    const inset = WALL_T / 2 + 0.05 + length / 2;
    const x = f.sx + f.dx * hinge + f.nx * inset;
    const z = f.sz + f.dz * hinge + f.nz * inset;
    const hw = (f.dx * 0.05 + Math.abs(f.nx) * length) / 2;
    const hd = (f.dz * 0.05 + Math.abs(f.nz) * length) / 2;
    const box = new Box3(new Vector3(x - hw, y, z - hd), new Vector3(x + hw, y + DOOR_H - 0.05, z + hd));
    leaves.push(Object.assign(box, { name: `${room.label} ${door.side} door leaf ${i + 1}` }));
  }
  return leaves;
}

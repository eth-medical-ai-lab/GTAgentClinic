import * as THREE from 'three';
import type { LayoutDef } from '../../../shared/layout';
import type { Interactable } from './builder';
import { DOOR_H, sideFrame } from './doorLeaves';
import { playSound } from '../audio/soundscape';
import { G, add, lambert } from './materials';

/** height of the cutaway walls in top-down view (builder.ts / upperFloor.ts LOW_H) */
const CUT_H = 1.05;
/** how far a leaf turns per second, and how far it opens (a right angle, into the room) */
const SPEED = 2.2;
const OPEN_ANGLE = Math.PI / 2;
/** the ground floor's rooms whose doorway gets a swinging door: the accessible and all-gender restrooms */
export const RESTROOM_DOOR_ROOMS = ['restroom_acc', 'restrooms'] as const;

export interface SwingDoor {
  key: string;
  angle(): number;
  isOpen(): boolean;
  /** E on the door: swing it the other way, unless closing it would catch someone in the swing */
  use(id: string): boolean;
  update(dt: number, playerX: number, playerZ: number): void;
}

/** where the solids and the aim targets of a leaf go (the ground floor's, or an upper storey's) */
export interface SwingTargets {
  colliders: THREE.Box3[];
  interactables: Interactable[];
}

export interface SwingLeafSpec {
  /** interaction key, also the `use` id */
  key: string;
  /** the group the full-height leaf is drawn under (the storey's tall group) */
  parent: THREE.Object3D;
  /** optional cutaway group (the storey's low group) so a 1.05 m stub stays visible in top-down view */
  lowParent?: THREE.Object3D;
  targets: SwingTargets;
  /** storey index for an upper level (floors.ts); undefined on the ground floor */
  level?: number;
  /** the hinge, on the wall's centreline, and the direction the shut leaf runs from it */
  hinge: { x: number; z: number };
  along: { x: number; z: number };
  /** the direction the open leaf points: into the room */
  into: { x: number; z: number };
  /** leaf length, leaf height, and the height its base stands at */
  leaf: number;
  height: number;
  y0: number;
  /** the leaf's colour */
  paint?: string;
}

/**
 * A hinged leaf that starts shut. E on it swings it through 90° into the room, or shut again. Solid
 * wherever it is in its swing, so people and the wheelchair are kept out until it's opened. It won't
 * shut on someone standing in its swing.
 */
export function buildSwingLeaf(s: SwingLeafSpec): SwingDoor {
  const { key, parent, targets } = s;
  const { hinge: h, leaf: lw, height: H, y0 } = s;
  // yaw that lays the leaf along the wall (shut) and along the room's inward normal (open)
  const closedYaw = Math.atan2(-s.along.z, s.along.x);
  const openYaw = Math.atan2(-s.into.z, s.into.x);
  const turn = Math.atan2(Math.sin(openYaw - closedYaw), Math.cos(openYaw - closedYaw)); // ±π/2

  const paint = lambert(s.paint ?? '#dfe5e8', { roughness: 0.55 });
  const steel = lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 });
  const makeLeaf = (targetParent: THREE.Object3D, leafH: number) => {
    const g = new THREE.Group();
    g.name = `swing-door-${key}`;
    g.position.set(h.x, y0, h.z);
    g.rotation.y = closedYaw;
    targetParent.add(g);
    const mesh = add(g, G.rbox(lw, leafH, 0.045, 0.01), paint, lw / 2, leafH / 2, 0);
    mesh.castShadow = true;
    // kick plate on the face, and a lever handle near the free edge when tall enough to reach 1.0 m
    add(g, G.box(lw - 0.04, 0.25, 0.05), steel, lw / 2, 0.14, 0);
    if (leafH >= 1.02) {
      add(g, G.box(0.14, 0.03, 0.05), steel, lw - 0.12, 1.0, 0);
      add(g, G.box(0.04, 0.12, 0.06), steel, lw - 0.1, 1.0, 0);
    }
    return g;
  };
  const group = makeLeaf(parent, H);
  const lowGroup = s.lowParent ? makeLeaf(s.lowParent, Math.min(H, CUT_H)) : null;

  // the leaf's footprint at a given turn, padded so it reads as a target and blocks the gap
  const pad = 0.12;
  const footprint = (yaw: number, box: THREE.Box3) => {
    const ex = h.x + Math.cos(yaw) * lw;
    const ez = h.z - Math.sin(yaw) * lw;
    box.min.set(Math.min(h.x, ex) - pad, y0, Math.min(h.z, ez) - pad);
    box.max.set(Math.max(h.x, ex) + pad, y0 + H, Math.max(h.z, ez) + pad);
    return box;
  };

  // the leaf is solid wherever it is in its swing
  const collider = footprint(closedYaw, new THREE.Box3());
  targets.colliders.push(collider);

  const target = { kind: 'use' as const, id: key, label: 'Open door' };
  const box = footprint(closedYaw, new THREE.Box3());
  const interactable: Interactable = { key, target, box, center: box.getCenter(new THREE.Vector3()), level: s.level };
  targets.interactables.push(interactable);

  const OFF = new THREE.Vector3(1e6, -1e6, 1e6);
  let angle = 0;
  let wantOpen = false;
  let px = 0;
  let pz = 0;

  // the whole quarter-circle the leaf sweeps: the shut footprint united with the fully open one
  const sweep = footprint(closedYaw, new THREE.Box3()).union(footprint(closedYaw + turn, new THREE.Box3()));
  /** the player is in the leaf's swing (closing now would push them out of it) */
  const inSwing = () => px > sweep.min.x - 0.1 && px < sweep.max.x + 0.1 && pz > sweep.min.z - 0.1 && pz < sweep.max.z + 0.1;

  return {
    key,
    angle: () => Math.round(angle * 100) / 100,
    isOpen: () => wantOpen,
    use(id: string): boolean {
      if (id !== key) return false;
      if (wantOpen && inSwing()) return true;
      wantOpen = !wantOpen;
      target.label = wantOpen ? 'Close door' : 'Open door';
      return true;
    },
    update(dt: number, playerX: number, playerZ: number) {
      px = playerX;
      pz = playerZ;
      const goal = wantOpen ? OPEN_ANGLE : 0;
      const step = SPEED * dt;
      const before = angle;
      angle = goal > angle ? Math.min(goal, angle + step) : Math.max(goal, angle - step);
      const yaw = closedYaw + angle * Math.sign(turn);
      group.rotation.y = yaw;
      if (lowGroup) lowGroup.rotation.y = yaw;
      footprint(yaw, collider);
      // hidden only when neither the full-height nor cutaway group is visible
      if (parent.visible || s.lowParent?.visible) box.copy(collider);
      else box.set(OFF, OFF);
      interactable.center = box.getCenter(new THREE.Vector3());
      // the thud when it lands at either end of its swing (only the closing thud is in the sound set)
      if (angle !== before && (angle === 0 || angle === OPEN_ANGLE)) {
        playSound('door.close', { at: { x: h.x, y: y0 + 1.2, z: h.z }, gain: 0.5, range: 12 });
      }
    },
  };
}

/** the swinging door on a ground-floor room's first doorway (the layout's doorway is an open gap) */
export function buildRoomSwingDoor(
  roomId: string,
  parent: THREE.Object3D,
  layout: LayoutDef,
  targets: SwingTargets,
  lowParent?: THREE.Object3D,
): SwingDoor | null {
  const room = layout.rooms.find((r) => r.id === roomId);
  const door = room?.doors[0];
  if (!room || !door) return null;
  const f = sideFrame(room, door.side);
  const at = door.offset + 0.03;
  return buildSwingLeaf({
    key: `door:${roomId}`,
    parent,
    lowParent,
    targets,
    hinge: { x: f.sx + f.dx * at, z: f.sz + f.dz * at },
    along: { x: f.dx, z: f.dz },
    into: { x: f.nx, z: f.nz },
    leaf: door.width - 0.04,
    height: DOOR_H - 0.05,
    y0: 0,
  });
}

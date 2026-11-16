/**
 * Desk chairs that roll: the office chairs at workstations, registration and the clinic. props.ts
 * keeps them out of the static merge (userData.deskChair); this merges each one into a few meshes,
 * gives it a slim collider (you can't walk through a chair; NPCs already route round its real
 * footprint, pathfinding.ts), and moves it: getting up from a workstation pushes the chair back from
 * the desk and swivels it (workstation.ts), and once you have walked off it rolls back in.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackGeo } from './materials';

/**
 * The collider's half size (m): the seat and its column, not the whole 0.5 m seat and wheel star.
 * Slim enough that you still fit between the station's back-to-back desk chairs (≈ 0.63 m gap).
 */
const HALF = 0.15;
/** rolling back in after you've left: how long (s) */
const ROLL_IN = 0.6;

export class DeskChair {
  /** pushed back this far (m) along `dir` (away from its desk), swivelled by `turn` (rad) */
  push = 0;
  turn = 0;
  dir = { x: 0, z: 1 };
  /** while you sit in it (or step out of it) it doesn't block you */
  solid = true;
  /** rolling back in: from where, since when (performance clock, s) */
  rollIn: { push: number; turn: number; t0: number } | null = null;
  /** when you stood up from it (s); it rolls back in once you've walked off */
  leftAt = 0;
  readonly box = new THREE.Box3();

  constructor(
    readonly id: string,
    readonly group: THREE.Object3D,
    readonly home: { x: number; z: number; rot: number },
  ) {
    this.pose(0, 0);
  }

  /** where its seat is now */
  center(out = { x: 0, z: 0 }) {
    out.x = this.home.x + this.dir.x * this.push;
    out.z = this.home.z + this.dir.z * this.push;
    return out;
  }

  /** push it back (m, along `dir`) and swivel it (rad); the collider follows */
  pose(push: number, turn: number, dir?: { x: number; z: number }) {
    if (dir) this.dir = { x: dir.x, z: dir.z };
    this.push = push;
    this.turn = turn;
    const c = this.center();
    this.group.position.set(c.x, this.group.position.y, c.z);
    this.group.rotation.y = this.home.rot + turn;
    this.group.updateMatrixWorld(true);
    this.updateBox();
  }

  setSolid(on: boolean) {
    this.solid = on;
    this.updateBox();
  }

  private updateBox() {
    if (!this.solid) {
      this.box.makeEmpty();
      return;
    }
    const a = this.home.rot + this.turn;
    const h = HALF * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
    const c = this.center();
    this.box.min.set(c.x - h, 0, c.z - h);
    this.box.max.set(c.x + h, 0.95, c.z + h);
  }

  /** out of the way? (m from its seat to (x, z)) */
  distanceTo(x: number, z: number) {
    const c = this.center();
    return Math.hypot(c.x - x, c.z - z);
  }

  /** once a frame while it is pushed back: roll back in when `free` (you've walked off, nobody needs it) */
  settle(now: number, free: boolean) {
    if (this.push <= 1e-4 && Math.abs(this.turn) <= 1e-4 && !this.rollIn) return;
    if (!this.rollIn) {
      if (!free) return;
      this.rollIn = { push: this.push, turn: this.turn, t0: now };
    }
    const k = Math.min(1, (now - this.rollIn.t0) / ROLL_IN);
    const e = k * k * (3 - 2 * k);
    this.pose(this.rollIn.push * (1 - e), this.rollIn.turn * (1 - e));
    if (k >= 1) this.rollIn = null;
  }
}

/** one mesh per material, in the group's own frame (a chair is ~13 parts: wheels, arms, column, seat, back) */
function mergeLocal(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const parts: THREE.Mesh[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    let g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    let list = buckets.get(m.material);
    if (!list) buckets.set(m.material, (list = []));
    list.push(g);
    parts.push(m);
  });
  for (const p of parts) p.removeFromParent();
  for (const o of [...group.children]) if (!o.children.length && !(o as THREE.Mesh).isMesh) o.removeFromParent();
  for (const [mat, geos] of buckets) {
    const g = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!g) continue;
    const mesh = new THREE.Mesh(trackGeo(g), mat);
    // like the static furniture it was merged with before: receives shadows, casts none
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noMerge = true;
    group.add(mesh);
  }
}

/** every desk chair under `root`, merged, with its collider added to `colliders` (by prop id) */
export function deskChairs(root: THREE.Object3D, colliders: THREE.Box3[]): Map<string, DeskChair> {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.deskChair) found.push(o);
  });
  const out = new Map<string, DeskChair>();
  for (const g of found) {
    mergeLocal(g);
    const chair = new DeskChair(g.userData.deskChair as string, g, { x: g.position.x, z: g.position.z, rot: g.rotation.y });
    colliders.push(chair.box);
    out.set(chair.id, chair);
  }
  return out;
}

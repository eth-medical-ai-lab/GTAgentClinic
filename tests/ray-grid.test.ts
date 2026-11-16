/**
 * The grid raycast for the world's big merged meshes (client/src/world/rayGrid.ts) finds exactly the
 * hits three's own Mesh.raycast finds: the same faces at the same distances, points and normals, for
 * straight-down probes (putting a thing down), aimed rays, near/far limits, every material side, an
 * indexed geometry, a moved and scaled mesh, and after its vertices change.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { accelerateRaycasts } from '../client/src/world/rayGrid';

/** deterministic random in [0, 1) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** boxes and table tops scattered over a 40 × 30 m floor plan, merged into one non-indexed mesh */
function scattered(rnd: () => number, n: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(0.2 + rnd() * 2, 0.05 + rnd() * 1.2, 0.2 + rnd() * 2).toNonIndexed();
    g.rotateY(rnd() * Math.PI);
    g.translate(rnd() * 40, rnd() * 1.4, rnd() * 30);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

/** the same meshes twice: one keeps three's raycast, the other gets the grid */
function world() {
  const rnd = rng(7);
  const build = () => {
    const root = new THREE.Group();
    const side = (s: THREE.Side) => new THREE.MeshBasicMaterial({ side: s });
    root.add(new THREE.Mesh(scattered(rng(1), 400), side(THREE.FrontSide)));
    root.add(new THREE.Mesh(scattered(rng(2), 300), side(THREE.BackSide)));
    root.add(new THREE.Mesh(scattered(rng(3), 300), side(THREE.DoubleSide)));
    // an indexed floor with many segments, at floor level
    const floor = new THREE.PlaneGeometry(40, 30, 40, 30).rotateX(-Math.PI / 2).translate(20, 0, 15);
    root.add(new THREE.Mesh(floor, side(THREE.FrontSide)));
    // a moved, turned and scaled one
    const moved = new THREE.Mesh(scattered(rng(4), 200), side(THREE.DoubleSide));
    moved.position.set(3, 0.2, -2);
    moved.rotation.set(0, 0.7, 0.05);
    moved.scale.set(1.2, 0.9, 1.1);
    root.add(moved);
    root.updateMatrixWorld(true);
    return root;
  };
  const slow = build();
  const fast = build();
  accelerateRaycasts(fast);
  return { slow, fast, rnd };
}

type Hit = { obj: number; face: number; d: number; p: number[]; n: number[] };
function hits(root: THREE.Object3D, rc: THREE.Raycaster): Hit[] {
  return rc
    .intersectObject(root, true)
    .map((h) => ({ obj: root.children.indexOf(h.object), face: h.faceIndex!, d: h.distance, p: h.point.toArray(), n: h.face!.normal.toArray() }))
    .sort((a, b) => a.d - b.d || a.obj - b.obj || a.face - b.face);
}

function same(a: Hit[], b: Hit[], what: string) {
  expect(b.length, what).toBe(a.length);
  a.forEach((h, i) => {
    expect(b[i].obj, what).toBe(h.obj);
    expect(b[i].face, what).toBe(h.face);
    expect(b[i].d, what).toBeCloseTo(h.d, 9);
    b[i].p.forEach((v, k) => expect(v, what).toBeCloseTo(h.p[k], 9));
    b[i].n.forEach((v, k) => expect(v, what).toBeCloseTo(h.n[k], 9));
  });
}

describe('grid raycast', () => {
  it('gives every big mesh the grid raycast', () => {
    const { fast } = world();
    for (const m of fast.children) expect((m as THREE.Mesh).raycast).not.toBe(THREE.Mesh.prototype.raycast);
  });

  it('straight-down probes (on cell edges too) find what three finds', () => {
    const { slow, fast, rnd } = world();
    const rc = new THREE.Raycaster();
    let total = 0;
    for (let i = 0; i < 400; i++) {
      // every fourth on a whole metre: the grid's cell edges
      const x = i % 4 ? rnd() * 44 - 2 : Math.round(rnd() * 40);
      const z = i % 4 ? rnd() * 34 - 2 : Math.round(rnd() * 30);
      const y = rnd() * 3;
      rc.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
      rc.near = 0;
      rc.far = i % 3 ? 1.6 : Infinity;
      const a = hits(slow, rc);
      same(a, hits(fast, rc), `down ${i}`);
      total += a.length;
    }
    expect(total).toBeGreaterThan(200);
  });

  it('aimed rays, near and far limits, find what three finds', () => {
    const { slow, fast, rnd } = world();
    const rc = new THREE.Raycaster();
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const o = new THREE.Vector3(rnd() * 50 - 5, rnd() * 4, rnd() * 40 - 5);
      const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.7, rnd() - 0.5).normalize();
      rc.set(o, dir);
      rc.near = i % 5 ? 0 : 0.5;
      rc.far = [2.8, 6, 200, Infinity][i % 4];
      const a = hits(slow, rc);
      same(a, hits(fast, rc), `aim ${i}`);
      total += a.length;
    }
    expect(total).toBeGreaterThan(200);
  });

  it('follows vertices that move', () => {
    const { slow, fast, rnd } = world();
    const rc = new THREE.Raycaster();
    rc.set(new THREE.Vector3(10, 3, 10), new THREE.Vector3(0, -1, 0));
    hits(fast, rc); // (its grid is built now)
    for (const root of [slow, fast]) {
      const pos = (root.children[0] as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) pos.setX(v, pos.getX(v) + 7.5);
      pos.needsUpdate = true;
      (root.children[0] as THREE.Mesh).geometry.computeBoundingSphere();
    }
    for (let i = 0; i < 200; i++) {
      rc.set(new THREE.Vector3(rnd() * 50, 3, rnd() * 30), new THREE.Vector3(0, -1, 0));
      rc.far = 3;
      same(hits(slow, rc), hits(fast, rc), `moved ${i}`);
    }
  });
});

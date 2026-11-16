/**
 * Storeys for the 3D world: builds the floors above the ground (upperFloor.ts), the elevator bank
 * (elevator.ts), Stair 1's self-closing door onto Level 2, and the ward's people (ward.ts), and
 * answers the questions that depend on which storey you are on:
 *
 *   groundAt(x, z, y)   the floor under you: stairs, an upper slab within reach, an elevator car
 *   ceilingAt(x, z)     that storey's ceiling (the third-person camera stops under it)
 *   roomAt(x, z)        the room on your storey (HUD and server location: "Floor 2 · Nurses' station")
 *   viewLevel           0 downstairs, 1 upstairs — what is drawn, lit, pickable and pathed
 *
 * Lights don't stop at slabs, so the rig switches each storey's lights by viewLevel (lighting.ts);
 * the ground floor's people are hidden upstairs (they would be drawn under the floor).
 */
import * as THREE from 'three';
import type { LayoutDef, Rect } from '../../../shared/layout';
import type { CameraMode } from '../../../shared/types';
import { elevatorBanks, levelY, onSlab, roomAtLevel, shaftExtent, underUpper, upperLevels, type LevelDef } from '../../../shared/floors';
import type { BuiltWorld, Interactable } from './builder';
import type { Keyholder } from './cabinets';
import type { Character } from './characters';
import type { PlayerController } from './controls';
import type { PlayerGestures } from './gesture';
import type { InteractTarget } from './index';
import type { LabelLayer } from './labels';
import { buildElevators, type ElevatorRig } from './elevator';
import { G, add, canvasTexture, lambert, own, pbr } from './materials';
import { NavGrid } from './pathfinding';
import { standHeight } from './stairs';
import { buildUpperLevel, type UpperBuilt } from './upperFloor';
import { Ward } from './ward';
import { playSound } from '../audio/soundscape';

export interface FloorsDeps {
  /** a short line at the bottom of the screen */
  hint?: (text: string, ms?: number) => void;
  labels: () => LabelLayer;
  controller: () => PlayerController;
  /** the player's hand going out to a button: turn first, then reach (gesture.ts) */
  gestures: () => PlayerGestures;
  camera: THREE.PerspectiveCamera;
  mode: () => CameraMode;
  container: HTMLElement;
}

export interface Floors {
  /** what the ground floor's NPC nav grid must treat as solid (the elevator entrances, closed) */
  readonly groundBlockers: THREE.Box3[];
  /** add the storeys' colliders, occluders, interactables, lights and screens to the built world (after the ground nav grid) */
  attach(): void;
  /** the storey you are on (0 = ground) and its floor height */
  readonly viewLevel: number;
  readonly floorY: number;
  groundAt(x: number, z: number, y?: number): number;
  ceilingAt(x: number, z: number): number | null;
  /** location id for the HUD / server */
  roomAt(x: number, z: number): string;
  /** the nav grid of your storey when it isn't the ground floor's */
  navFor(): NavGrid | null;
  /** a ground-floor NPC at (x, z) that isn't drawn from where you are */
  hideNpc(x: number, z: number): boolean;
  /** an interactable that is on your storey */
  pickable(it: { level?: number; key?: string }): boolean;
  /** for the light rig: does a light tagged with this storey matter from where you are (see attach) */
  levelOn(level: number): boolean;
  /** inside an elevator car: its panel is the prompt even when you aren't aiming at it */
  fallback(): { key: string; target: InteractTarget; center: THREE.Vector3; dist: number } | null;
  /** E on a floors target (elevator buttons); false = not ours */
  use(id: string): boolean;
  setCutaway(cut: boolean): void;
  setNight(night: boolean): void;
  setClock(hhmm: string): void;
  /** per frame, after the controller moved you */
  update(dt: number, t: number): void;
  /** per frame, after the camera is placed: the ride's motion */
  camera(t: number): void;
  /** the ward's patients in their beds, with their storey (a bedside visit: care.ts) */
  wardPatients(): { id: string; ch: Character; x: number; z: number; yaw: number; level: number }[];
  /** where the ward's people are when you are up there (none from downstairs) */
  wardPeople(): ReturnType<Ward['people']>;
  /** who keeps each upper storey's controlled-drug key, and how to send for her (cabinets.ts) */
  keyholders(): Keyholder[];
  ward: Ward | null;
  lift: ElevatorRig['bank'] | undefined;
  debug(): unknown;
  dispose(): void;
}

const inRect = (r: Rect, x: number, z: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && z >= r.z - pad && z <= r.z + r.d + pad;

export function createFloors(scene: THREE.Scene, layout: LayoutDef, built: BuiltWorld, deps: FloorsDeps): Floors {
  const levels = upperLevels(layout);
  const root = new THREE.Group();
  root.name = 'floors';
  scene.add(root);
  const ups: UpperBuilt[] = [];
  const navs = new Map<number, NavGrid>();
  const W = layout.width;
  const D = layout.depth;

  // what joins the built world in attach() (after the ground floor's nav grid has been built)
  const add_ = { colliders: [] as THREE.Box3[], occluders: [] as THREE.Box3[], cameraBlockers: [] as THREE.Box3[], interactables: [] as Interactable[] };
  for (const L of levels) {
    const up = buildUpperLevel(layout, L);
    ups.push(up);
    root.add(up.base, up.tall, up.low, up.shell);
    add_.colliders.push(...up.colliders);
    add_.occluders.push(...up.occluders);
    add_.cameraBlockers.push(...up.cameraBlockers);
    add_.interactables.push(...up.interactables);
    for (const nl of up.nightLights) root.add(nl.light);
    // the slab muffles voices and stops picks between storeys (thin boxes under the floor, not over the stair core)
    for (const r of slabRects(L)) add_.occluders.push(new THREE.Box3(new THREE.Vector3(r.x, L.y - 0.06, r.z), new THREE.Vector3(r.x + r.w, L.y - 0.008, r.z + r.d)));
  }

  // ── elevators ──
  const bankDef = elevatorBanks(layout)[0];
  const allLevels = [0, ...levels.map((l) => l.index)];
  const rig: ElevatorRig | null = bankDef && levels.length ? buildElevators(bankDef, allLevels, (l) => levelY(layout, l)) : null;
  const groundBlockers: THREE.Box3[] = [];
  if (rig && bankDef) {
    root.add(rig.cars, rig.shell);
    for (const g of rig.landings.values()) root.add(g.tall, g.low);
    add_.colliders.push(...rig.colliders);
    add_.cameraBlockers.push(...rig.cameraBlockers);
    add_.occluders.push(...rig.occluders);
    add_.interactables.push(...rig.interactables);
    for (const l of rig.lights) root.add(l);
    // the cars are behind the north wall: let the player in there, and keep everyone else out of the
    // strip behind the building on either side of the hoistway
    const sh = shaftExtent(bankDef);
    built.bounds.minZ = Math.min(built.bounds.minZ, sh.z0 + 0.15);
    for (const [x0, x1] of [[-40, sh.x0], [sh.x1, W + 40]]) add_.colliders.push(new THREE.Box3(new THREE.Vector3(x0, -1, sh.z0 - 3), new THREE.Vector3(x1, 40, -0.13)));
    // NPCs downstairs don't ride (yet): to their nav grid the entrances are shut
    for (const c of bankDef.cars) groundBlockers.push(new THREE.Box3(new THREE.Vector3(c.x - 0.75, 0, sh.z0), new THREE.Vector3(c.x + 0.75, 2.3, 0.06)));
  }

  // ── Stair 1's door onto Level 2: self-closing, opens as you come (in the stair core's wall) ──
  const fireDoor = buildFireDoor(root, layout, levels[0]);
  const L1 = levels[0];
  let ward: Ward | null = null;
  let attached = false;

  /**
   * Pressing a button you aren't facing (the car's panel is the prompt wherever you look, and 1 / 2
   * work without aiming): gesture.ts turns you to it first (the body; in first person the view, tipped
   * toward it only if it is well out of view), then the hand on its side goes out, and the body keeps
   * facing it until the hand is back. Walking off makes the press at once and lets go.
   */
  const press = (at: THREE.Vector3, onPress: () => void) => void deps.gestures().start(at, onPress);

  // floor-level number keys inside a car (1 / 2): the panel without aiming at it
  const onKey = (e: KeyboardEvent) => {
    if (!rig || e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    const n = e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : e.code === 'Digit2' || e.code === 'Numpad2' ? 1 : -1;
    if (n < 0 || !deps.controller().enabled) return;
    const c = deps.controller();
    const x = c.pos.x;
    const z = c.pos.y;
    const at = rig.sendButtonAt(x, z, n);
    // the floor is chosen when the finger gets to its button
    if (at) press(at, () => void rig?.sendFrom(x, z, n));
  };
  window.addEventListener('keydown', onKey);

  // ── state ──
  let viewLevel = 0;
  let doorHintAt = -1e9;
  let cut = false;
  let night = true;
  let py = 0;
  let px = 0;
  let pz = 0;
  const lastPos = new THREE.Vector2(NaN, NaN);
  const vel = new THREE.Vector2();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();

  const applyVisibility = () => {
    built.tall.visible = !cut;
    built.low.visible = cut;
    for (const up of ups) {
      const on = viewLevel >= up.level.index;
      up.base.visible = on;
      up.tall.visible = on && !cut;
      up.low.visible = viewLevel === up.level.index && cut;
      up.shell.visible = !cut;
    }
    if (rig) {
      for (const [lvl, g] of rig.landings) {
        g.tall.visible = viewLevel >= lvl && !cut;
        g.low.visible = viewLevel === lvl && cut;
      }
      rig.shell.visible = !cut;
      rig.setCutaway(cut);
    }
    if (fireDoor) fireDoor.group.visible = !cut;
  };
  applyVisibility();

  const floors: Floors = {
    groundBlockers,
    attach() {
      if (attached) return;
      attached = true;
      built.colliders.push(...add_.colliders);
      built.occluders.push(...add_.occluders);
      built.cameraBlockers.push(...add_.cameraBlockers);
      built.interactables.push(...add_.interactables);
      // Light tags (the rig asks levelOn): a ground-floor light under an upper storey only matters
      // downstairs (10 cm under the slab it would light the bottom of every wall up here): level 0.
      // The rest of the ground floor's interior is out of sight from upstairs except in the cutaway: −1.
      // A double-height room's lights (the stair core) and the outside's stay untagged.
      const tall = new Set(layout.rooms.filter((r) => (r.ceilingHeight ?? layout.wallHeight) > layout.wallHeight + 0.01).map((r) => r.id));
      if (ups.length) for (const f of built.fixtures) if (f.level === undefined && !tall.has(f.room)) f.level = underUpper(layout, f.x, f.z, 0.4) ? 0 : -1;
      for (const up of ups) {
        built.fixtures.push(...up.fixtures);
        built.roomHours.push(...up.roomHours);
        built.details.clocks.push(...up.clocks);
        // workstation and small screens get the world's shared screen materials (patients' TVs stay dark)
        for (const s of up.screens) if (s.kind !== 'tv') built.screens.push(s);
      }
      // nav grids per upper storey: its walls and props, the stair core's walls, the cars' walls
      for (const L of levels) {
        const o = L.outline;
        const solid = built.colliders.filter((b) => b.max.y > L.y + 0.3 && b.min.y < L.y + 1.8 && b.max.x > o.x - 1 && b.min.x < o.x + o.w + 1 && b.max.z > o.z - 4 && b.min.z < o.z + o.d + 1);
        navs.set(L.index, new NavGrid(solid, { minX: o.x - 1, maxX: o.x + o.w + 1, minZ: o.z - 3.2, maxZ: o.z + o.d + 1 }));
      }
      // the stair door is solid while shut (a dynamic box, so not in the nav grids)
      if (fireDoor) built.colliders.push(fireDoor.collider);
      if (L1) ward = new Ward(scene, L1, navs.get(L1.index)!, deps.labels, built.occluders);
      // the ward's patients: E goes to the bedside (no tablet up here: care.ts turns you to them)
      for (const p of ward?.patients() ?? []) {
        const along = Math.abs(Math.sin(p.yaw)) > 0.5;
        const box = new THREE.Box3(new THREE.Vector3(p.x - (along ? 0.95 : 0.45), L1.y + 0.3, p.z - (along ? 0.45 : 0.95)), new THREE.Vector3(p.x + (along ? 0.95 : 0.45), L1.y + 1.05, p.z + (along ? 0.45 : 0.95)));
        built.interactables.push({ key: `ward:${p.id}`, target: { kind: 'use', id: `ward:${p.id}`, label: 'See the patient' }, box, center: box.getCenter(new THREE.Vector3()), level: L1.index });
      }
    },
    get ward() { return ward; },
    lift: rig?.bank,
    get viewLevel() {
      return viewLevel;
    },
    get floorY() {
      return levelY(layout, viewLevel);
    },
    groundAt(x, z, y = 0) {
      if (rig) {
        const car = rig.carAt(x, z);
        if (car && Math.abs(y - car.y) < 1.6) return car.y;
      }
      let g = standHeight(layout, x, z);
      for (const L of levels) if (y >= L.y - 0.6 && onSlab(L, x, z)) g = Math.max(g, L.y);
      return g;
    },
    ceilingAt(x, z) {
      if (rig) {
        const car = rig.carAt(x, z);
        if (car && Math.abs(py - car.y) < 1.6) return car.y + bankDef!.car.h;
      }
      const L = levels.find((l) => l.index === viewLevel);
      if (L && inRect(L.outline, x, z, 1)) return L.y + L.height;
      // downstairs, the rooms under an upper storey have the normal ceiling (the stair core its own)
      return null;
    },
    roomAt(x, z) {
      if (rig && bankDef) {
        const car = rig.carAt(x, z);
        if (car) return bankDef.lobbies[car.level] ?? 'lobby';
      }
      return roomAtLevel(layout, x, z, viewLevel)?.id ?? 'exterior';
    },
    navFor() {
      return viewLevel > 0 ? (navs.get(viewLevel) ?? null) : null;
    },
    hideNpc(x, z) {
      // everyone downstairs is indoors under the roof or the slab: only the cutaway shows the ED's dollhouse
      if (viewLevel === 0) return false;
      if (x < -0.5 || x > W + 0.5 || z < -0.5 || z > D + 0.5) return false;
      return !cut || underUpper(layout, x, z, 0.2);
    },
    levelOn(level) {
      if (level >= 1) return viewLevel >= level;
      if (level === 0) return viewLevel === 0;
      return viewLevel === 0 || cut;
    },
    pickable(it) {
      if ((it.level ?? 0) !== viewLevel) return false;
      // inside a car only its own panel answers (aiming out of the doors isn't "hold the doors")
      if (rig && it.key?.includes(':call:') && rig.carAt(px, pz)) return false;
      return true;
    },
    fallback() {
      if (!rig) return null;
      const c = deps.controller();
      const car = rig.carAt(c.pos.x, c.pos.y);
      if (!car || car.ride) return null;
      const p: Interactable | undefined = rig.panelFor(car);
      if (!p) return null;
      return { key: p.key, target: p.target, center: p.center.clone(), dist: Math.hypot(p.center.x - c.pos.x, p.center.z - c.pos.y) };
    },
    use(id) {
      // the bathrooms' doors upstairs (swingDoors.ts)
      if (ups.some((u) => u.swingDoors.some((d) => d.use(id)))) return true;
      if (!rig || !id.startsWith('elev:')) return false;
      const at = rig.buttonAt(id);
      if (!at) return false;
      // you turn to it, the hand goes out; the button takes the press when the finger is there
      press(at, () => rig?.use(id));
      return true;
    },
    setCutaway(c) {
      if (c === cut) return;
      cut = c;
      applyVisibility();
    },
    setNight(n) {
      night = n;
      for (const up of ups) up.setNight(n);
      ward?.setNight(n);
    },
    setClock(hhmm) {
      for (const up of ups) up.board?.update(hhmm);
    },
    update(dt, t) {
      const c = deps.controller();
      px = c.pos.x;
      pz = c.pos.y;
      py = c.y;
      if (!Number.isNaN(lastPos.x) && dt > 0) vel.set((px - lastPos.x) / dt, (pz - lastPos.y) / dt);
      lastPos.set(px, pz);
      // the storey you're on: above two-thirds of the way up the stairs (or of a ride) it's Floor 2
      let lvl = 0;
      for (const L of levels) if (py > L.y - 0.6) lvl = Math.max(lvl, L.index);
      if (lvl !== viewLevel) {
        viewLevel = lvl;
        applyVisibility();
      }
      rig?.update(dt, { x: px, z: pz, y: py, vx: vel.x, vz: vel.y });
      // standing in the doorway after choosing a floor holds the doors open (the light curtain): say so
      if (rig && rig.doorwayHold() > 2.5 && t - doorHintAt > 20) {
        doorHintAt = t;
        deps.hint?.('Step all the way into the car: the doors stay open while you stand in the doorway', 4500);
      }
      if (rig) {
        // a car is drawn when it is at your storey, or you are in it (the shaft is closed otherwise)
        const fy = levelY(layout, viewLevel);
        rig.cars.children.forEach((g) => {
          if (!g.name.startsWith('elevator-')) return;
          const inside = rig.carAt(px, pz);
          g.visible = Math.abs(g.position.y - fy) < 2.4 || (!!inside && g.name === `elevator-${inside.id}`);
        });
        for (const l of rig.lights) l.visible = Math.abs(l.position.y - (fy + 2.2)) < 2.6;
      }
      fireDoor?.update(dt, px, pz, py, vel.x, vel.y);
      for (const up of ups) for (const d of up.swingDoors) d.update(dt, px, pz);
      for (const up of ups) for (const nl of up.nightLights) {
        const on = night && viewLevel === up.level.index;
        nl.light.visible = on;
        nl.light.intensity = on ? 0.55 : 0;
        nl.mat.emissiveIntensity = night ? 1.6 : 0.1;
      }
      if (ward) {
        deps.camera.updateMatrixWorld();
        pv.multiplyMatrices(deps.camera.projectionMatrix, deps.camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv, deps.camera.coordinateSystem, deps.camera.reversedDepth);
        ward.update(dt, t, { show: viewLevel === L1.index, player: c.pos, camera: deps.camera, cutaway: cut, width: deps.container.clientWidth, height: deps.container.clientHeight, frustum });
      }
    },
    camera(t) {
      if (rig) deps.camera.position.y += rig.feel(px, pz, t);
    },
    wardPatients() {
      return (ward?.patients() ?? []).map((p) => ({ ...p, level: L1.index }));
    },
    wardPeople() {
      return ward && viewLevel === L1.index ? ward.people() : [];
    },
    keyholders() {
      // Ward 2 East's night charge nurse (ward.ts) holds the ward's controlled-drug key
      return ward && L1 ? [{ level: L1.index, id: 'ward_ana', name: 'Ana', role: 'the nurse in charge', npcs: ward.errands, busy: () => null }] : [];
    },
    debug() {
      const cars = rig ? rig.cars.children.filter((g) => g.name.startsWith('elevator-')).map((g) => ({ name: g.name, visible: g.visible, y: g.position.y })) : [];
      const lights = rig ? rig.lights.map((l) => ({ visible: l.visible, y: Math.round(l.position.y * 100) / 100 })) : [];
      return { level: viewLevel, floorY: levelY(layout, viewLevel), room: floors.roomAt(px, pz), elevator: rig?.state() ?? null, cars, lights, ward: ward?.state() ?? null, fireDoor: fireDoor ? fireDoor.angle() : null, reach: deps.gestures().active };
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      rig?.dispose();
      ward?.dispose();
      scene.remove(root);
    },
  };
  return floors;
}

/** the parts of an upper storey's outline that have a slab (not the stair core rising through) */
function slabRects(L: LevelDef): Rect[] {
  const o = L.outline;
  const xs = [...new Set([o.x, o.x + o.w, ...L.holes.flatMap((h) => [h.x, h.x + h.w])])].sort((a, b) => a - b);
  const zs = [...new Set([o.z, o.z + o.d, ...L.holes.flatMap((h) => [h.z, h.z + h.d])])].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (!L.holes.some((h) => cx > h.x && cx < h.x + h.w && cz > h.z && cz < h.z + h.d)) out.push({ x: xs[i], z: zs[j], w: xs[i + 1] - xs[i], d: zs[j + 1] - zs[j] });
    }
  return out;
}

/**
 * Stair 1's fire door at Level 2 (in the core's east wall, opening into the lobby): a red steel
 * leaf with a wired-glass vision panel and a push bar, on a closer. It swings open as you come up
 * to it from either side and closes behind you, so the landing is never a dead end and the ward's
 * light doesn't spill down the stairwell.
 */
function buildFireDoor(root: THREE.Group, layout: LayoutDef, L: LevelDef | undefined) {
  const stairs = layout.rooms.find((r) => r.id === 'stairs');
  const d = stairs?.doors.find((dd) => (dd.y ?? 0) > 0 && dd.side === 'e');
  if (!stairs || !d || !L) return null;
  const x = stairs.rect.x + stairs.rect.w; // the core's outer wall line (x 51.0)
  const z0 = stairs.rect.z + d.offset;
  const w = d.width;
  const Y = d.y ?? L.y;
  const group = new THREE.Group();
  group.name = 'stair-door';
  root.add(group);
  // hinge on the lobby side's north jamb; the leaf swings into the lobby
  const hinge = new THREE.Group();
  hinge.position.set(x + 0.1, Y, z0 + 0.04);
  group.add(hinge);
  const red = lambert('#9c2f2a', { roughness: 0.42, metalness: 0.2 });
  const ss = lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 });
  const lw = w - 0.06;
  const leaf = add(hinge, G.rbox(0.045, 2.18, lw, 0.008), red, 0, 1.09, lw / 2);
  leaf.castShadow = true;
  add(hinge, G.box(0.05, 0.6, 0.14), lambert('#1d2328', { roughness: 0.08, metalness: 0.4 }), 0, 1.45, lw - 0.28);
  for (const s of [-1, 1]) {
    add(hinge, G.rbox(0.05, 0.05, lw - 0.25, 0.02), ss, s * 0.06, 0.98, lw / 2 + 0.05);
    add(hinge, G.box(0.02, 0.012, lw - 0.1), lambert('#5b6064', { roughness: 0.8 }), s * 0.026, 0.12, lw / 2);
  }
  add(hinge, G.box(0.06, 0.06, 0.3), lambert('#b9bfc4', { roughness: 0.4 }), 0.05, 2.08, 0.25);
  // signs: the stair side says where you are, the lobby side says it's the way out
  const sign = (text: string[], bg: string) => {
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 384, 256);
    ctx.fillStyle = bg === '#f4f1ea' ? '#1f2328' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    text.forEach((t, i) => {
      ctx.font = `${i === 0 ? 800 : 600} ${i === 0 ? 46 : 30}px ui-sans-serif, system-ui, Arial, sans-serif`;
      ctx.fillText(t, 192, 62 + i * 64);
    });
    return own(new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.5 }));
  };
  // (on the hinge half, clear of the vision panel; 3 mm proud of the leaf)
  add(hinge, G.plane(0.42, 0.28), sign(['LEVEL 2', 'Ward 2 East', 'Fire door — keep closed'], '#f4f1ea'), -0.0255, 1.6, 0.3, 0, -Math.PI / 2, 0);
  add(hinge, G.plane(0.42, 0.28), sign(['STAIR 1', 'Exit · Level 1', 'Fire door — keep closed'], '#0d7a3a'), 0.0255, 1.6, 0.3, 0, Math.PI / 2, 0);
  // threshold plate through the double wall
  add(group, G.box(0.36, 0.01, w), pbr('steel', { tile: 0.5, roughness: 0.6 }), x + 0.0, Y + 0.004, z0 + w / 2);
  const box = new THREE.Box3(new THREE.Vector3(x - 0.14, Y, z0), new THREE.Vector3(x + 0.14, Y + 2.25, z0 + w));
  const OFF = new THREE.Vector3(1e6, -1e6, 1e6);
  const collider = box.clone();
  let angle = 0;
  let wantOpenUntil = 0;
  let wasOpen = false;
  const center = new THREE.Vector3(x, Y + 1, z0 + w / 2);
  return {
    group,
    collider,
    angle: () => Math.round(angle * 100) / 100,
    update(dt: number, px: number, pz: number, py: number, vx = 0, vz = 0) {
      const now = performance.now() / 1000;
      // it opens for someone going through it, not for walking past it in the lobby: in line with the
      // opening, within 1.4 m of it and walking at it, or already in the doorway (on the way through)
      const along = pz - center.z;
      const across = px - x; // + on the lobby side, − in the stair core
      const inLine = Math.abs(py - Y) < 0.8 && Math.abs(along) < w / 2 + 0.25;
      const toward = across > 0 ? -vx : vx;
      const coming = inLine && Math.abs(across) < 1.4 && toward > 0.25 && Math.abs(vz) < toward * 1.5;
      const inDoorway = inLine && Math.abs(across) < 0.45;
      if (coming || inDoorway) wantOpenUntil = now + 1.2;
      const target = now < wantOpenUntil ? 1.5 : 0;
      const speed = target > angle ? 3.2 : 1.6; // opens briskly, the closer brings it back slower
      angle = target > angle ? Math.min(target, angle + dt * speed) : Math.max(target, angle - dt * speed);
      hinge.rotation.y = angle;
      // solid while (almost) shut
      if (angle < 0.5) collider.copy(box);
      else collider.set(OFF, OFF);
      const open = angle > 0.05;
      if (wasOpen && !open) playSound('door.close', { at: { x: center.x, y: Y + 1.2, z: center.z }, gain: 0.7, range: 16 });
      wasOpen = open;
    },
  };
}

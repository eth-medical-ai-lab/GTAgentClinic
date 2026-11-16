/**
 * Lighting rig: a real light behind every emissive fixture the builder placed (LED troffers,
 * exam lights over beds, canopy downlights), image-based ambient + reflections, a night sky,
 * and the exterior lamps. On high quality the exam lights cast soft shadows, so patients
 * and beds sit in the room instead of floating.
 *
 * Units are three.js' physical ones (candela, decay 2); exposure is set in renderer.ts.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { PMREMGenerator, type WebGPURenderer } from 'three/webgpu';
import type { BuiltWorld, Fixture } from '../builder';
import { createOutdoorRig } from '../exterior';
import { tune } from './renderer';

export interface LightRig {
  setNight(night: boolean): void;
  /** game clock (hours, 0–24): rooms with opening hours (e.g. the outpatient clinic) switch their lights off when closed */
  setClock(hour: number): void;
  /**
   * per frame, before rendering: lights whose reach doesn't touch the view (and lights of closed
   * rooms) are switched off. Only shadowless lights, which the clustered pipeline keeps in a data
   * texture, so this never recompiles a shader.
   */
  cull(camera: THREE.Camera & { coordinateSystem: number; reversedDepth?: boolean }, levelOn?: (level: number) => boolean): void;
  /** call once per frame: advances the progressive GI bake (no-op when done/disabled) */
  update(): void;
  /** 0..1 progress of the GI bake (1 when disabled or done) */
  readonly giProgress: number;
  dispose(): void;
}

const TROFFER = { color: '#fff1df', intensity: 7.5, distance: 5.5 };
const EXAM = { color: '#fff7ec', intensity: 9, distance: 6 };
const DOWN = { color: '#ffe6c2', intensity: 10, distance: 9 };
/** resus procedure light (resusGear.ts): a focused pool on the trolley; never shadowed, so it stays clustered and cullable */
const PROC = { color: '#fff8ef', intensity: 14, distance: 4.5, angle: 0.55, penumbra: 0.6 };
const LI = () => tune('li', 1.1);

function fixtureLight(f: Fixture, shadows: boolean): THREE.Light {
  if (f.kind === 'procedure') {
    const s = new THREE.SpotLight(PROC.color, PROC.intensity * tune('pli', 1), PROC.distance, PROC.angle, PROC.penumbra, 2);
    s.position.set(f.x, f.y, f.z);
    s.target.position.set(f.x, 0, f.z);
    return s;
  }
  if (f.kind === 'exam') {
    // a reading light over the bed, not a procedure light: at 3.2× it burned the linen out to pure
    // white, and the bloom off the pillow lay over the patient's face like a haze
    const s = new THREE.SpotLight(EXAM.color, EXAM.intensity * 1.3 * tune('ei', 1), EXAM.distance, 0.95, 0.85, 2);
    s.position.set(f.x, f.y, f.z);
    s.target.position.set(f.x, 0, f.z + 0.05);
    if (shadows) {
      s.castShadow = true;
      s.shadow.mapSize.setScalar(1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.02;
      s.shadow.radius = 4;
      s.shadow.camera.near = 0.3;
      s.shadow.camera.far = 6;
    }
    return s;
  }
  const spec = f.kind === 'downlight' ? DOWN : TROFFER;
  const p = new THREE.PointLight(spec.color, spec.intensity * LI(), tune('ld', spec.distance), 2);
  // A recessed troffer shines down, never onto its own ceiling. As a point light 10 cm below the
  // tiles it lit them hardest of all (a glare around every panel, and the bloom on top of it); just
  // above the ceiling plane, the tiles face away from it and everything below is lit as before
  // (these lights cast no shadows, so the ceiling doesn't block them). The tiles' own brightness
  // is the light the room bounces back up (builder.ts CEILING_BOUNCE).
  p.position.set(f.x, f.kind === 'troffer' ? f.y + 0.1 : f.y - 0.05, f.z);
  return p;
}

export interface LightingOptions {
  shadows: boolean;
  /** low quality: merge each room's troffers into ≤2 lights (cheap forward shading) */
  fewLights?: boolean;
  /** bake an irradiance probe grid over the building interior (indirect bounce light) */
  gi: boolean;
  building: { width: number; depth: number; height: number };
}

export function buildLighting(renderer: WebGPURenderer, scene: THREE.Scene, built: BuiltWorld, opts: LightingOptions): LightRig {
  const group = new THREE.Group();
  group.name = 'lights';
  scene.add(group);

  let fixtures = built.fixtures;
  if (opts.fewLights) {
    // per room: keep exam/down lights, replace the troffer grid by ≤2 brighter, wider lights
    const byRoom = new Map<string, Fixture[]>();
    for (const f of fixtures) if (f.kind === 'troffer') byRoom.set(f.room, [...(byRoom.get(f.room) ?? []), f]);
    const merged: Fixture[] = fixtures.filter((f) => f.kind !== 'troffer');
    for (const list of byRoom.values()) {
      const k = Math.min(2, list.length);
      for (let i = 0; i < k; i++) {
        const part = list.slice(Math.floor((i * list.length) / k), Math.floor(((i + 1) * list.length) / k));
        const c = part.reduce((a, f) => ({ x: a.x + f.x / part.length, y: f.y, z: a.z + f.z / part.length }), { x: 0, y: 0, z: 0 });
        merged.push({ ...part[0], x: c.x, y: c.y, z: c.z, weight: part.length } as Fixture & { weight: number });
      }
    }
    fixtures = merged;
  }
  const hoursRooms = new Set(built.roomHours.map((r) => r.room));
  const roomLights = new Map<string, { light: THREE.Light; base: number }[]>();
  // `level`: which storey a light belongs to (floors.ts tags them); lights don't stop at slabs, so cull()
  // asks `levelOn` whether that storey's lights matter from where you are
  const cullable: { light: THREE.PointLight | THREE.SpotLight; room: string; level?: number }[] = [];
  for (const f of fixtures) {
    const l = fixtureLight(f, opts.shadows);
    const w = (f as Fixture & { weight?: number }).weight;
    if (w && w > 1) {
      (l as THREE.PointLight).intensity *= Math.sqrt(w) * 1.4;
      (l as THREE.PointLight).distance *= 1 + Math.sqrt(w) * 0.6;
    }
    if (hoursRooms.has(f.room)) roomLights.set(f.room, [...(roomLights.get(f.room) ?? []), { light: l, base: l.intensity }]);
    if (!l.castShadow) cullable.push({ light: l as THREE.PointLight, room: f.room, level: f.level });
    group.add(l);
    if ((l as THREE.SpotLight).target) group.add((l as THREE.SpotLight).target);
  }
  if (opts.fewLights) group.children.forEach((c) => ((c as THREE.Light).castShadow = false));

  // soft fill so deep corners never go pitch black (bounce light approximation)
  const hemiBase = tune('hemi', 0.03);
  const hemi = new THREE.HemisphereLight('#e8eef4', '#8f877c', hemiBase);
  group.add(hemi);

  // image-based lighting: a neutral interior with light panels → realistic reflections on
  // polished vinyl, steel, glass and skin highlights
  const pmrem = new PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTex = pmrem.fromScene(roomEnv, 0.03).texture;
  roomEnv.dispose();
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = tune('env', 0.15);

  // outside (exterior.ts): Poly Haven sky + fog, LED area lights / canopy downlights / wall packs,
  // the sun with shadows on high, and a box-projected reflection probe for outdoor materials only
  // (the interior keeps the room environment above)
  const outdoor = createOutdoorRig(renderer, scene, { exterior: built.exterior, lamps: built.lamps, root: built.root }, { shadows: opts.shadows, group });

  // ── baked GI: irradiance probes (L2 SH) every ~1.5 m, two layers, one bounce ──
  let probes: LightProbeGrid | null = null;
  let bakeIndex = 0;
  let bakePass = 0;
  let total = 0;
  const BOUNCES = 1;
  let waitFrames = 30; // let textures and avatars stream in before capturing
  if (opts.gi && tune('gi', 0) > 0) {
    const { width, depth, height } = opts.building;
    const cx = Math.max(2, Math.round(width / 1.5));
    const cz = Math.max(2, Math.round(depth / 1.5));
    probes = new LightProbeGrid(width, height, depth, cx, 2, cz);
    probes.position.set(width / 2, height / 2, depth / 2);
    probes.updateBoundingBox();
    probes.visible = false; // until the first pass completes
    scene.add(probes);
    total = cx * 2 * cz;
  }

  for (const l of outdoor.lights) cullable.push({ light: l, room: 'exterior' });
  let isNight: boolean | null = null;
  const openNow = new Map<string, boolean>();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const reach = new THREE.Sphere();
  const noCull = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nocull');
  return {
    setClock(hour: number) {
      for (const rh of built.roomHours) {
        const [from, to] = rh.hours;
        const open = from <= to ? hour >= from && hour < to : hour >= from || hour < to;
        if (openNow.get(rh.room) === open) continue;
        openNow.set(rh.room, open);
        // closed: the room's lights go out (cull() keeps them off); diffusers dark
        for (const { light } of roomLights.get(rh.room) ?? []) light.visible = open;
        for (const m of rh.mats) m.emissiveIntensity = open ? rh.base : 0.02;
      }
    },
    cull(camera, levelOn) {
      camera.updateMatrixWorld();
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv, camera.coordinateSystem as THREE.CoordinateSystem, camera.reversedDepth ?? false);
      for (const c of cullable) {
        if (openNow.get(c.room) === false || (levelOn && c.level !== undefined && !levelOn(c.level))) {
          c.light.visible = false;
          continue;
        }
        if (noCull) {
          c.light.visible = true;
          continue;
        }
        // the light group sits at the origin, so light positions are world positions
        reach.center.copy(c.light.position);
        reach.radius = c.light.distance > 0 ? c.light.distance : 30;
        c.light.visible = frustum.intersectsSphere(reach);
      }
    },
    get giProgress() {
      if (!probes) return 1;
      return Math.min(1, (bakePass * total + bakeIndex) / ((BOUNCES + 1) * total));
    },
    update() {
      outdoor.update();
      if (!probes || bakePass > BOUNCES) return;
      if (waitFrames-- > 0) return;
      const count = Math.min(24, total - bakeIndex);
      probes.bake(renderer, scene, { cubemapSize: 16, near: 0.05, far: 60, start: bakeIndex, count, pass: bakePass });
      bakeIndex += count;
      if (bakeIndex >= total) {
        bakeIndex = 0;
        bakePass++;
        if (bakePass === 1) {
          // first pass done: switch the GI on and drop the flat fill it replaces
          probes.visible = true;
          hemi.intensity = hemi.intensity * 0.25;
        }
      }
    },
    setNight(night: boolean) {
      if (night === isNight) return;
      isNight = night;
      outdoor.setNight(night);
      for (const d of built.night.dimMats) d.mat.color.copy(d.day).multiplyScalar(night ? 0.55 : 1);
      for (const m of built.night.lampMats) m.emissiveIntensity = night ? 4 : 0.1;
      hemi.intensity = night ? hemiBase : hemiBase * 1.5;
    },
    dispose() {
      if (probes) {
        scene.remove(probes);
        probes.dispose();
      }
      outdoor.dispose();
      scene.remove(group);
      envTex.dispose();
    },
  };
}

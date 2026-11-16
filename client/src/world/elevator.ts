/**
 * The elevator bank in 3D (logic: elevatorModel.ts). Per landing: stainless entrances with
 * centre-opening hall doors, a position indicator with arrival lanterns, and the hall call
 * station. Per car: a lit bed-elevator car (brushed steel, handrails, bumper rails, mirror, LED
 * ceiling), its doors and its operating panel. Outside: the hoistway enclosure against the
 * building's north wall, rising past the roof for the overrun.
 *
 * Collisions (y-aware, see controls.ts): car walls and the hoistway are solid at every height; each
 * entrance has a "gate" box at its landing that is solid unless that car stands there with its
 * doors open. So nobody steps into an empty shaft, and nobody leaves a car between floors.
 */
import * as THREE from 'three';
import type { ElevatorBankDef } from '../../../shared/floors';
import { shaftExtent } from '../../../shared/floors';
import type { Interactable } from './builder';
import { ElevatorBank, doorEase, type CarState, type Dir } from './elevatorModel';
import { G, add, canvasTexture, lambert, makeCanvas, own, pbr } from './materials';
import { mergeByMaterial } from './vehicles';
import { playSound, type SoundHandle } from '../audio/soundscape';
import { sharedAudio } from '../ui/speech';

const OW = 1.3; // clear opening
const OH = 2.2;
const LEAF = OW / 2 + 0.02;
const CAR_H = 2.4;
/** car interior: x ±CW, z from Z_IN (behind the car doors) back by the car's depth */
const CW = 0.8;
const Z_IN = -0.22;
/** light-curtain zone around the door line (player centre) */
const CURTAIN = { z0: -0.48, z1: 0.36, half: 0.72 };

export interface ElevatorRig {
  readonly def: ElevatorBankDef;
  readonly bank: ElevatorBank;
  /** entrances per landing (shown with that storey) */
  readonly landings: Map<number, { tall: THREE.Group; low: THREE.Group }>;
  /** the cars (they move; always in the scene) */
  readonly cars: THREE.Group;
  /** hoistway enclosure (outside) */
  readonly shell: THREE.Group;
  readonly colliders: THREE.Box3[];
  readonly cameraBlockers: THREE.Box3[];
  readonly occluders: THREE.Box3[];
  readonly interactables: Interactable[];
  readonly lights: THREE.PointLight[];
  /** the car whose inside (x, z) is in, if any */
  carAt(x: number, z: number): CarState | null;
  /** floor / ceiling height inside a car at (x, z), else null */
  groundAt(x: number, z: number): number | null;
  ceilingAt(x: number, z: number): number | null;
  /** advance the bank and the 3D (player: where you are and which way you are walking) */
  update(dt: number, player: { x: number; z: number; y: number; vx: number; vz: number }): void;
  /** press the button an interactable stands for; returns where the button is (for the hand) */
  use(id: string): THREE.Vector3 | null;
  /** the world position of the button behind an interactable id (before pressing) */
  buttonAt(id: string): THREE.Vector3 | null;
  /** inside a car: its panel's interactable (the prompt when you aren't aiming at anything) */
  panelFor(car: CarState): Interactable | undefined;
  /** select a floor inside the car you are in (number keys) */
  sendFrom(x: number, z: number, level: number): THREE.Vector3 | null;
  /** where that floor's button is in the car at (x, z), without pressing it */
  sendButtonAt(x: number, z: number, level: number): THREE.Vector3 | null;
  /** cutaway: car ceilings off so you can see in */
  setCutaway(cut: boolean): void;
  /** slight motion felt in a moving car at (x, z): a vertical camera offset (m) */
  feel(x: number, z: number, t: number): number;
  /** for tests / debug */
  /** seconds the player has held a car's doors open from its doorway while it has somewhere to go (0 = not) */
  doorwayHold(): number;
  state(): { cars: { id: string; y: number; level: number; door: number; phase: string; moving: boolean; stops: number[] }[]; hall: Record<number, string[]> };
  dispose(): void;
}

const FLOOR_NAME: Record<number, string> = { 0: 'Floor 1 · Emergency · Clinic · Cafeteria', 1: 'Floor 2 · Ward 2 East' };

export function buildElevators(def: ElevatorBankDef, levels: number[], levelY: (l: number) => number): ElevatorRig {
  const bank = new ElevatorBank(
    def.cars.map((c) => c.id),
    levels,
    levelY,
    undefined,
    // A waits downstairs, B upstairs: whichever floor you call from, a car is usually there
    def.cars.map((_, i) => levels[i % levels.length]),
  );
  const top = Math.max(...levels);
  const bottom = Math.min(...levels);
  const sh = shaftExtent(def);
  const colliders: THREE.Box3[] = [];
  const cameraBlockers: THREE.Box3[] = [];
  const occluders: THREE.Box3[] = [];
  const interactables: Interactable[] = [];
  const lights: THREE.PointLight[] = [];
  const landings = new Map<number, { tall: THREE.Group; low: THREE.Group }>();
  const carsGroup = new THREE.Group();
  carsGroup.name = 'elevator-cars';
  const shellRaw = new THREE.Group();
  const shell = new THREE.Group();

  // ── materials ──
  const ss = lambert('#c6cbcf', { roughness: 0.34, metalness: 0.6 });
  const ssDark = lambert('#9aa1a6', { roughness: 0.3, metalness: 0.7 });
  const alu = lambert('#b9bfc4', { roughness: 0.35, metalness: 0.85 });
  const black = lambert('#16191b', { roughness: 0.32 });
  const rubber = lambert('#3a3f44', { roughness: 0.85 });
  // a satin mirror panel: lighter than the walls, softly reflective (the room environment is dim)
  const mirror = lambert('#e9eef1', { roughness: 0.12, metalness: 0.35 });
  const ceilingWhite = lambert('#eef0ef', { roughness: 0.5 });
  const carFloor = pbr('floor_vinyl', { color: '#7b8186', tile: 0.8, roughness: 0.68, normalScale: 0.4 });
  const ledPanel = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e6', emissiveIntensity: 2.6, roughness: 0.6 }));

  const wallFace = def.faceZ;
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

  // ── indicators: canvas displays (floor + direction), one per entrance and one in each car ──
  interface Display {
    ctx: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    key: string;
    lantern: boolean;
  }
  const displays: { car: CarState; level: number | null; d: Display }[] = [];
  const makeDisplay = (w: number, h: number, lantern: boolean): { mat: THREE.MeshStandardMaterial; d: Display } => {
    const { canvas, ctx } = makeCanvas(w, h);
    const tex = canvasTexture(canvas);
    const mat = own(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.4, roughness: 0.25 }));
    return { mat, d: { ctx, tex, key: '', lantern } };
  };
  const drawDisplay = (dsp: Display, floor: number, arrow: Dir | null, lantern: Dir | null) => {
    const key = `${floor}|${arrow}|${lantern}`;
    if (key === dsp.key) return;
    dsp.key = key;
    const { ctx } = dsp;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.fillStyle = '#06080a';
    ctx.fillRect(0, 0, W, H);
    const tri = (cx: number, cy: number, s: number, up: boolean, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - s, up ? cy + s * 0.6 : cy - s * 0.6);
      ctx.lineTo(cx + s, up ? cy + s * 0.6 : cy - s * 0.6);
      ctx.lineTo(cx, up ? cy - s * 0.8 : cy + s * 0.8);
      ctx.closePath();
      ctx.fill();
    };
    if (dsp.lantern) {
      // arrival lantern either side: lit green ▲ / red ▼ while a car stands here
      tri(H * 0.5, H * 0.5, H * 0.32, true, lantern === 'up' ? '#4dff88' : '#1c2a22');
      tri(W - H * 0.5, H * 0.5, H * 0.32, false, lantern === 'down' ? '#ff5a4d' : '#2a1c1c');
    }
    ctx.fillStyle = '#ffb02e';
    ctx.font = `700 ${Math.round(H * 0.72)}px ui-sans-serif, system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(floor + 1), W * (dsp.lantern ? 0.56 : 0.6), H * 0.54);
    if (arrow) tri(W * (dsp.lantern ? 0.39 : 0.28), H * 0.5, H * 0.18, arrow === 'up', '#ffb02e');
    dsp.tex.needsUpdate = true;
  };

  // ── buttons: lit rings (own material each) ──
  const lamps = new Map<string, THREE.MeshStandardMaterial>();
  const lampMat = (key: string, color = '#ffb347') => {
    const m = own(new THREE.MeshStandardMaterial({ color: '#4a4f54', emissive: color, emissiveIntensity: 0.06, roughness: 0.35 }));
    lamps.set(key, m);
    return m;
  };
  const setLamp = (key: string, on: boolean) => {
    const m = lamps.get(key);
    if (m) m.emissiveIntensity = on ? 2.4 : 0.06;
  };
  const buttons = new Map<string, THREE.Vector3>();

  // ── landings ──
  const callTargets: { level: number; it: Interactable; dirs: Dir[] }[] = [];
  const doorLeaves: { car: CarState; level: number; meshes: THREE.Mesh[] }[] = [];
  const gates: { car: CarState; level: number; box: THREE.Box3; on: THREE.Box3 }[] = [];
  const OFF = new THREE.Vector3(1e6, -1e6, 1e6);
  for (const level of levels) {
    const Y = levelY(level);
    const tallStatic = new THREE.Group();
    const lowStatic = new THREE.Group();
    const tall = new THREE.Group();
    const low = new THREE.Group();
    tall.add(tallStatic);
    low.add(lowStatic);
    landings.set(level, { tall, low });
    for (const c of def.cars) {
      const car = bank.car(c.id)!;
      const cx = c.x;
      // stainless frame: jambs and head wrap the opening's reveal (and the builder's trim in it)
      for (const s of [-1, 1]) add(tallStatic, G.rbox(0.12, OH + 0.12, 0.38, 0.01), ss, cx + s * (OW / 2 + 0.06), Y + (OH + 0.12) / 2, -0.02);
      add(tallStatic, G.rbox(OW + 0.36, 0.12, 0.38, 0.01), ss, cx, Y + OH + 0.06, -0.02);
      // sill: aluminium threshold with the door track groove
      add(tallStatic, G.box(OW, 0.012, 0.36), alu, cx, Y + 0.006, -0.03);
      add(tallStatic, G.box(OW, 0.004, 0.012), black, cx, Y + 0.013, 0.04);
      // hall doors (in the wall's thickness; they slide into the piers)
      const meshes: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const leaf = add(tall, G.rbox(LEAF, OH - 0.01, 0.03, 0.006), ss, cx + s * LEAF / 2, Y + OH / 2, 0.04);
        leaf.userData.noMerge = true;
        leaf.castShadow = true;
        meshes.push(leaf);
      }
      doorLeaves.push({ car, level, meshes });
      // position indicator + arrival lanterns over the entrance
      const disp = makeDisplay(256, 64, true);
      drawDisplay(disp.d, car.level, null, null);
      add(tallStatic, G.rbox(0.62, 0.17, 0.04, 0.01), black, cx, Y + OH + 0.3, wallFace + 0.02);
      add(tall, G.plane(0.58, 0.145), disp.mat, cx, Y + OH + 0.3, wallFace + 0.041).userData.noMerge = true;
      displays.push({ car, level, d: disp.d });
      // landing designation on the jamb (raised numeral + braille)
      if (c === def.cars[0]) {
        const { canvas, ctx } = makeCanvas(64, 64);
        ctx.fillStyle = '#2b3034';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#e8ecef';
        ctx.font = '800 40px ui-sans-serif, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(level + 1), 32, 28);
        for (let i = 0; i < 3; i++) ctx.fillRect(22 + i * 9, 52, 4, 4);
        const plate = own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.4 }));
        add(tall, G.plane(0.07, 0.07), plate, cx - (OW / 2 + 0.06), Y + 1.5, 0.171).userData.noMerge = true;
      }
      // gate: solid unless this car stands here with its doors open
      const on = box(cx - 0.66, Y, -0.2, cx + 0.66, Y + 2.3, 0.06);
      const g = on.clone();
      gates.push({ car, level, box: g, on });
      colliders.push(g);
      cameraBlockers.push(g);
      occluders.push(g);
      // the jambs are solid (the throat between the lobby and the car)
      for (const s of [-1, 1]) {
        const jb = box(cx + s * (OW / 2) - (s < 0 ? 0.12 : 0), 0, -0.2, cx + s * (OW / 2) + (s > 0 ? 0.12 : 0), sh.top, 0.17);
        colliders.push(jb);
        occluders.push(jb);
      }
      // the hoistway side of the entrance (between the piers and the shaft), from over these doors
      // up to the next landing's sill (not across the entrance above)
      const upTo = levels.filter((l) => l > level).map(levelY).sort((a, b) => a - b)[0] ?? levelY(top) + 3;
      add(tallStatic, G.box(OW + 0.4, upTo - (Y + OH + 0.12), 0.06), lambert('#5e6366', { roughness: 0.8 }), cx, (Y + OH + 0.12 + upTo) / 2, -0.24);
    }
    // hall call station between the entrances: ▲ at the bottom landing, ▼ at the top, both between
    const px = def.callX;
    const dirs: Dir[] = level === bottom ? ['up'] : level === top ? ['down'] : ['up', 'down'];
    const face = makeCanvas(128, 336);
    face.ctx.fillStyle = '#c3c8cb';
    face.ctx.fillRect(0, 0, 128, 336);
    face.ctx.fillStyle = '#b8231f';
    face.ctx.font = '800 17px ui-sans-serif, Arial, sans-serif';
    face.ctx.textAlign = 'center';
    face.ctx.fillText('FIRE', 64, 26);
    face.ctx.fillStyle = '#2b3034';
    face.ctx.font = '700 15px ui-sans-serif, Arial, sans-serif';
    face.ctx.fillText(`LEVEL ${level + 1}`, 64, 300);
    for (let i = 0; i < 6; i++) face.ctx.fillRect(49 + (i % 2) * 20, 312 + Math.floor(i / 2) * 7, 4, 4);
    const faceMat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(face.canvas), roughness: 0.45 }));
    add(tallStatic, G.rbox(0.13, 0.34, 0.012, 0.004), ss, px, Y + 1.0 + 0.17, wallFace + 0.006);
    add(tall, G.plane(0.12, 0.315), faceMat, px, Y + 1.0 + 0.17, wallFace + 0.0135).userData.noMerge = true;
    dirs.forEach((dir, i) => {
      const by = Y + 1.0 + (dirs.length === 1 ? 0.13 : 0.18 - i * 0.1);
      add(tallStatic, G.cyl(0.026, 0.026, 0.012, 24), lambert('#d9dde0', { roughness: 0.16, metalness: 1 }), px, by, wallFace + 0.019, Math.PI / 2, 0, 0);
      add(tallStatic, G.circle(0.013, 3), lambert('#2b3034', { roughness: 0.45 }), px, by + 0.002, wallFace + 0.0262, 0, 0, dir === 'up' ? Math.PI / 2 : -Math.PI / 2);
      add(tall, G.torus(0.03, 0.0035, 6, 24), lampMat(`call:${level}:${dir}`), px, by, wallFace + 0.017).userData.noMerge = true;
      buttons.set(`call:${level}`, new THREE.Vector3(px, by, wallFace + 0.03));
    });
    add(tallStatic, G.cyl(0.015, 0.015, 0.012, 16), lambert('#b8231f', { roughness: 0.35, metalness: 0.3 }), px, Y + 1.0 + 0.3, wallFace + 0.019, Math.PI / 2, 0, 0);
    // the whole elevator wall answers "call" (aim at the doors or the panel)
    const xs = def.cars.map((c) => c.x);
    const ib = box(Math.min(...xs) - OW / 2 - 0.1, Y + 0.2, wallFace - 0.05, Math.max(...xs) + OW / 2 + 0.1, Y + 2.5, wallFace + 0.22);
    // (keys don't start with "use:": World resolves those as amenities after a walk-to)
    const call: Interactable = { key: `elev:${def.id}:call:${level}`, target: { kind: 'use', id: `elev:${def.id}:call:${level}`, label: 'Call the elevator' }, box: ib, center: ib.getCenter(new THREE.Vector3()), level };
    interactables.push(call);
    callTargets.push({ level, it: call, dirs });
    // cutaway: the hoistway's walls cut at 1.05 m around the cars at this landing
    const lowWall = lambert('#8c9194', { roughness: 0.8 });
    add(lowStatic, G.box(0.2, 1.05, sh.z1 - sh.z0), lowWall, sh.x0 + 0.1, Y + 0.525, (sh.z0 + sh.z1) / 2);
    add(lowStatic, G.box(0.2, 1.05, sh.z1 - sh.z0), lowWall, sh.x1 - 0.1, Y + 0.525, (sh.z0 + sh.z1) / 2);
    add(lowStatic, G.box(sh.x1 - sh.x0, 1.05, 0.2), lowWall, (sh.x0 + sh.x1) / 2, Y + 0.525, sh.z0 + 0.1);
    mergeKeep(tallStatic);
    mergeKeep(lowStatic);
  }

  // ── cars ──
  const carViews: { car: CarState; group: THREE.Group; ceiling: THREE.Group; leaves: THREE.Mesh[]; light: THREE.PointLight; panel: Interactable; panelId: string; disp: Display; cx: number }[] = [];
  for (const c of def.cars) {
    const car = bank.car(c.id)!;
    const cx = c.x;
    const D = def.car.d;
    const zb = Z_IN - D; // back wall's inner face
    const g = new THREE.Group();
    g.name = `elevator-${c.id}`;
    const st = new THREE.Group();
    g.add(st);
    // floor + car sill
    add(st, G.box(CW * 2 + 0.06, 0.06, D + 0.06), carFloor, 0, -0.03, (Z_IN + zb) / 2);
    add(st, G.box(OW, 0.012, 0.1), alu, 0, 0.006, Z_IN + 0.04);
    // side and back walls (brushed steel panels with dark seams)
    for (const s of [-1, 1]) {
      add(st, G.box(0.04, CAR_H, D), ss, s * (CW + 0.02), CAR_H / 2, (Z_IN + zb) / 2);
      for (let k = 1; k < 4; k++) add(st, G.box(0.006, CAR_H - 0.1, 0.008), ssDark, s * (CW - 0.002), CAR_H / 2, Z_IN - (D * k) / 4);
      // handrail at 0.9 m on stand-offs, bumper rail (beds) at 0.25 m
      add(st, G.cyl(0.02, 0.02, D - 0.5, 12), alu, s * (CW - 0.07), 0.9, (Z_IN + zb) / 2, Math.PI / 2, 0, 0);
      for (const zz of [Z_IN - 0.35, zb + 0.35]) add(st, G.box(0.06, 0.03, 0.03), alu, s * (CW - 0.035), 0.9, zz);
      add(st, G.rbox(0.03, 0.16, D - 0.2, 0.01), rubber, s * (CW - 0.015), 0.28, (Z_IN + zb) / 2);
    }
    add(st, G.box(CW * 2 + 0.08, CAR_H, 0.04), ss, 0, CAR_H / 2, zb - 0.02);
    add(st, G.box(CW * 2 - 0.3, 1.1, 0.008), mirror, 0, 1.62, zb + 0.005);
    add(st, G.cyl(0.02, 0.02, CW * 2 - 0.4, 12), alu, 0, 0.9, zb + 0.07, 0, 0, Math.PI / 2);
    add(st, G.rbox(CW * 2 - 0.2, 0.16, 0.03, 0.01), rubber, 0, 0.28, zb + 0.015);
    // front: returns beside the door (wide enough to hide the open leaves) and the transom
    for (const s of [-1, 1]) add(st, G.box(0.5, CAR_H, 0.08), ss, s * (OW / 2 + 0.25), CAR_H / 2, Z_IN + 0.04);
    add(st, G.box(OW + 1.0, CAR_H - OH, 0.08), ss, 0, OH + (CAR_H - OH) / 2, Z_IN + 0.04);
    // capacity plate + inspection certificate
    const certC = makeCanvas(192, 256);
    certC.ctx.fillStyle = '#f6f4ec';
    certC.ctx.fillRect(0, 0, 192, 256);
    certC.ctx.fillStyle = '#1e2a33';
    certC.ctx.textAlign = 'center';
    certC.ctx.font = '800 17px ui-sans-serif, Arial, sans-serif';
    certC.ctx.fillText('BED ELEVATOR ' + c.id, 96, 34);
    certC.ctx.font = '600 15px ui-sans-serif, Arial, sans-serif';
    ['Rated load 2000 kg', '26 persons', '', 'Inspected and certified', 'Next inspection due:', 'see building office', '', 'In case of fire', 'use the stairs'].forEach((t, i) => certC.ctx.fillText(t, 96, 70 + i * 21));
    const certMat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(certC.canvas), roughness: 0.6 }));
    add(st, G.box(0.006, 0.27, 0.2), alu, CW - 0.003, 1.55, zb + 0.55);
    add(st, G.plane(0.18, 0.25), certMat, CW - 0.007, 1.55, zb + 0.55, 0, -Math.PI / 2, 0).userData.noMerge = true;
    // car operating panel on the left wall by the door: floor buttons, door open/close, alarm, display
    const cop = new THREE.Group();
    const copX = -CW + 0.006;
    const copZ = Z_IN - 0.45;
    add(cop, G.box(0.012, 0.9, 0.24), ss, copX, 1.3, copZ);
    const copFace = makeCanvas(96, 360);
    copFace.ctx.fillStyle = '#c3c8cb';
    copFace.ctx.fillRect(0, 0, 96, 360);
    copFace.ctx.fillStyle = '#2b3034';
    copFace.ctx.font = '700 22px ui-sans-serif, Arial, sans-serif';
    copFace.ctx.textAlign = 'center';
    copFace.ctx.textBaseline = 'middle';
    // (rows top → bottom: display, 2, 1, open, close, alarm)
    copFace.ctx.fillText('2', 24, 128);
    copFace.ctx.fillText('1', 24, 172);
    copFace.ctx.fillText('◀▶', 24, 216);
    copFace.ctx.fillText('▶◀', 24, 256);
    copFace.ctx.fillStyle = '#b07a00';
    copFace.ctx.fillText('🔔', 24, 300);
    const copMat = own(new THREE.MeshStandardMaterial({ map: canvasTexture(copFace.canvas), roughness: 0.45 }));
    add(cop, G.plane(0.23, 0.86), copMat, copX + 0.007, 1.3, copZ, 0, Math.PI / 2, 0).userData.noMerge = true;
    const btn = (y: number, key: string | null, color = '#ffb347') => {
      add(cop, G.cyl(0.022, 0.022, 0.014, 20), lambert('#d9dde0', { roughness: 0.16, metalness: 1 }), copX + 0.012, y, copZ + 0.03, 0, 0, Math.PI / 2);
      if (key) add(cop, G.torus(0.026, 0.0035, 6, 22), lampMat(key, color), copX + 0.009, y, copZ + 0.03, 0, Math.PI / 2, 0).userData.noMerge = true;
    };
    const rowY = (row: number) => 1.3 + 0.43 - (row / 360) * 0.86;
    btn(rowY(128), `car:${c.id}:1`);
    btn(rowY(172), `car:${c.id}:0`);
    btn(rowY(216), null);
    btn(rowY(256), null);
    btn(rowY(300), null, '#ffcc00');
    // car position display at the top of the panel
    const disp = makeDisplay(128, 64, false);
    drawDisplay(disp.d, car.level, null, null);
    add(cop, G.plane(0.18, 0.09), disp.mat, copX + 0.008, rowY(52), copZ, 0, Math.PI / 2, 0).userData.noMerge = true;
    mergeKeep(cop);
    g.add(cop);
    // ceiling: white panel, two LED panels, a vent slot (hidden in the cutaway)
    const ceiling = new THREE.Group();
    add(ceiling, G.box(CW * 2 + 0.08, 0.04, D + 0.04), ceilingWhite, 0, CAR_H + 0.02, (Z_IN + zb) / 2);
    for (const zz of [Z_IN - D * 0.28, Z_IN - D * 0.72]) add(ceiling, G.plane(1.1, 0.62), ledPanel, 0, CAR_H - 0.002, zz, Math.PI / 2, 0, 0).userData.noMerge = true;
    add(ceiling, G.box(1.0, 0.004, 0.08), black, 0, CAR_H - 0.003, zb + 0.12);
    g.add(ceiling);
    // car doors: inside the front panel's thickness, sliding behind the returns
    const leaves: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const leaf = add(g, G.rbox(LEAF, OH - 0.01, 0.025, 0.006), ss, s * LEAF / 2, OH / 2, Z_IN + 0.04);
      leaf.userData.noMerge = true;
      leaves.push(leaf);
    }
    mergeKeep(st);
    g.position.set(cx, car.y, 0);
    carsGroup.add(g);
    // the car's light: short reach, so it stays in the car even through closed doors
    const light = new THREE.PointLight('#fff1df', 7, 3.0, 2);
    light.position.set(cx, car.y + CAR_H - 0.15, Z_IN - D / 2);
    lights.push(light);
    // car walls are solid at every height (the car moves; the shaft's lines don't)
    const H = sh.top;
    for (const s of [-1, 1]) {
      const wb = box(cx + s * CW + (s < 0 ? -0.06 : 0), 0, zb - 0.06, cx + s * CW + (s > 0 ? 0.06 : 0), H, Z_IN + 0.08);
      colliders.push(wb);
      cameraBlockers.push(wb);
      occluders.push(wb);
    }
    const back = box(cx - CW - 0.06, 0, zb - 0.06, cx + CW + 0.06, H, zb);
    colliders.push(back);
    cameraBlockers.push(back);
    occluders.push(back);
    const panelBox = new THREE.Box3();
    const panelId = `elev:${def.id}:car:${c.id}`;
    const panel: Interactable = { key: panelId, target: { kind: 'use', id: panelId, label: '' }, box: panelBox, center: new THREE.Vector3(), level: car.level };
    interactables.push(panel);
    carViews.push({ car, group: g, ceiling, leaves, light, panel, panelId, disp: disp.d, cx });
    displays.push({ car, level: null, d: disp.d });
  }

  // ── the hoistway outside: walls up past the roof (overrun), a vented machine head, coping ──
  {
    const clad = pbr('concrete', { color: '#cfc9bd', tile: 3, roughness: 0.92 });
    clad.userData.outdoor = true;
    const cap = lambert('#9da2a5', { roughness: 0.35, metalness: 0.8 });
    const h = sh.top;
    add(shellRaw, G.box(0.2, h, sh.z1 - sh.z0), clad, sh.x0 + 0.1, h / 2, (sh.z0 + sh.z1) / 2);
    add(shellRaw, G.box(0.2, h, sh.z1 - sh.z0), clad, sh.x1 - 0.1, h / 2, (sh.z0 + sh.z1) / 2);
    add(shellRaw, G.box(sh.x1 - sh.x0, h, 0.2), clad, (sh.x0 + sh.x1) / 2, h / 2, sh.z0 + 0.1);
    add(shellRaw, G.box(sh.x1 - sh.x0 + 0.1, 0.25, sh.z1 - sh.z0 + 0.1), clad, (sh.x0 + sh.x1) / 2, h - 0.125, (sh.z0 + sh.z1) / 2);
    add(shellRaw, G.rbox(sh.x1 - sh.x0 + 0.2, 0.07, sh.z1 - sh.z0 + 0.2, 0.015), cap, (sh.x0 + sh.x1) / 2, h + 0.035, (sh.z0 + sh.z1) / 2);
    // louvred vent near the top of the north face, and a pit floor at the bottom
    add(shellRaw, G.box(1.4, 0.5, 0.03), lambert('#5d6062', { roughness: 0.6, metalness: 0.4 }), (sh.x0 + sh.x1) / 2, h - 0.7, sh.z0 - 0.015);
    for (let i = 0; i < 6; i++) add(shellRaw, G.box(1.36, 0.02, 0.05), lambert('#3c3f41', { roughness: 0.6 }), (sh.x0 + sh.x1) / 2, h - 0.9 + i * 0.08, sh.z0 - 0.03);
    shell.add(mergeByMaterial(shellRaw, { castShadow: true }));
    const pit = add(carsGroup, G.box(sh.x1 - sh.x0 - 0.4, 0.04, sh.z1 - sh.z0 - 0.2), lambert('#3f4245', { roughness: 0.9 }), (sh.x0 + sh.x1) / 2, -0.06, (sh.z0 + sh.z1) / 2 - 0.1);
    pit.userData.noMerge = true;
    for (const [x0, x1] of [[sh.x0, sh.x0 + 0.2], [sh.x1 - 0.2, sh.x1]]) {
      const wb = box(x0, 0, sh.z0, x1, h, sh.z1);
      colliders.push(wb);
      occluders.push(wb);
    }
    const nb = box(sh.x0, 0, sh.z0, sh.x1, h, sh.z0 + 0.2);
    colliders.push(nb);
    occluders.push(nb);
  }

  // ── sound: synthesized once (chime, button beep, ride hum) on the shared audio context ──
  let sfx: { chime1: AudioBuffer; chime2: AudioBuffer; beep: AudioBuffer; hum: AudioBuffer } | null = null;
  const ensureSfx = () => {
    if (sfx) return sfx;
    const ctx = sharedAudio(false)?.ctx;
    if (!ctx) return null;
    sfx = synthElevatorSounds(ctx);
    return sfx;
  };
  const hums = new Map<string, SoundHandle>();
  const entranceAt = (car: CarState, level: number) => ({ x: def.cars.find((c) => c.id === car.id)!.x, y: levelY(level) + 2.3, z: wallFace + 0.25 });
  bank.on((e) => {
    const s = ensureSfx();
    if (e.kind === 'arrive') {
      if (s) {
        const buf = e.dir === 'down' ? s.chime2 : s.chime1;
        playSound(buf, { at: entranceAt(e.car, e.level), gain: 0.9, range: 30, name: 'elevator arrival chime' });
        const cv = carViews.find((v) => v.car === e.car);
        if (cv) playSound(buf, { at: { x: cv.cx, y: e.car.y + 2.2, z: Z_IN - 1.2 }, gain: 0.45, range: 12, name: 'elevator arrival chime' });
      }
    } else if (e.kind === 'doors') {
      const lvl = e.car.level;
      playSound(e.opening ? 'door.slide.open' : 'door.slide.close', { at: entranceAt(e.car, lvl), gain: 0.45, rate: 0.82, range: 18 });
    } else if (e.kind === 'depart') {
      const cv = carViews.find((v) => v.car === e.car);
      if (s && cv && !hums.has(e.car.id)) hums.set(e.car.id, playSound(s.hum, { at: { x: cv.cx, y: e.car.y + 1.2, z: Z_IN - 1.2 }, loop: true, gain: 0, range: 22, name: 'elevator car hum' }));
    }
  });
  const beep = (at: THREE.Vector3) => {
    const s = ensureSfx();
    if (s) playSound(s.beep, { at: { x: at.x, y: at.y, z: at.z }, gain: 0.5, range: 10, name: 'elevator button beep' });
  };

  // ── per frame ──
  let cutaway = false;
  const v3 = new THREE.Vector3();
  const insideCar = (cx: number, x: number, z: number) => Math.abs(x - cx) < CW && z < Z_IN + 0.05 && z > Z_IN - def.car.d;
  /** per car: how long the player has stood in its doorway while it waited to leave (doorwayHold) */
  const heldFor = new Map<string, number>();
  const rig: ElevatorRig = {
    def,
    bank,
    landings,
    cars: carsGroup,
    shell,
    colliders,
    cameraBlockers,
    occluders,
    interactables,
    lights,
    carAt(x, z) {
      for (const v of carViews) if (insideCar(v.cx, x, z)) return v.car;
      return null;
    },
    groundAt(x, z) {
      for (const v of carViews) if (Math.abs(x - v.cx) < CW && z < Z_IN + 0.1 && z > Z_IN - def.car.d) return v.car.y;
      return null;
    },
    doorwayHold() {
      let m = 0;
      for (const s of heldFor.values()) m = Math.max(m, s);
      return m;
    },
    ceilingAt(x, z) {
      const c = rig.carAt(x, z);
      return c ? c.y + CAR_H : null;
    },
    update(dt, p) {
      // light curtain at each entrance; walking into a parked car's closed doors from inside opens them
      bank.update(dt, (car) => {
        const v = carViews.find((cv) => cv.car === car)!;
        const inDoorway = Math.abs(p.x - v.cx) < CURTAIN.half && p.z > CURTAIN.z0 && p.z < CURTAIN.z1 && Math.abs(p.y - car.y) < 1.2;
        heldFor.set(car.id, inDoorway && car.stops.size > 0 ? (heldFor.get(car.id) ?? 0) + dt : 0);
        return inDoorway;
      });
      for (const v of carViews) {
        const car = v.car;
        if (insideCar(v.cx, p.x, p.z) && Math.abs(p.y - car.y) < 1.0 && !car.ride && car.departIn < 0 && car.phase === 'closed' && !car.stops.size && p.z > Z_IN - 0.45 && p.vz > 0.2) bank.open(car.id);
      }
      for (const v of carViews) {
        const car = v.car;
        v.group.position.y = car.y;
        v.light.position.y = car.y + CAR_H - 0.15;
        const open = doorEase(car.door);
        v.leaves[0].position.x = -LEAF / 2 - open * (LEAF - 0.02);
        v.leaves[1].position.x = LEAF / 2 + open * (LEAF - 0.02);
        v.ceiling.visible = !cutaway;
        // the panel's interactable rides along
        v.panel.box.min.set(v.cx - CW - 0.02, car.y + 0.8, Z_IN - 0.75);
        v.panel.box.max.set(v.cx - CW + 0.22, car.y + 1.8, Z_IN - 0.15);
        v.panel.box.getCenter(v.panel.center);
        v.panel.level = car.level;
        const dest = levels.find((l) => l !== car.level) ?? car.level;
        const going = [...car.calls][0];
        const label = going !== undefined || car.ride ? `${FLOOR_NAME[going ?? car.ride?.to ?? dest] ?? 'Floor'} — on its way` : `Press ${dest + 1} · ${FLOOR_NAME[dest] ?? `Floor ${dest + 1}`}`;
        if (v.panel.target.kind !== 'use' || v.panel.target.label !== label) v.panel.target = { kind: 'use', id: v.panelId, label };
        // ride hum follows the car and its speed
        const hum = hums.get(car.id);
        if (hum) {
          if (!car.ride && car.v === 0) {
            hum.stop(0.6);
            hums.delete(car.id);
          } else hum.setGain(0.25 + 0.75 * Math.min(1, Math.abs(car.v) / 0.9));
        }
      }
      for (const dl of doorLeaves) {
        const here = !dl.car.ride && dl.car.departIn < 0 && dl.car.level === dl.level;
        const open = here ? doorEase(dl.car.door) : 0;
        const cx = def.cars.find((c) => c.id === dl.car.id)!.x;
        dl.meshes[0].position.x = cx - LEAF / 2 - open * (LEAF - 0.02);
        dl.meshes[1].position.x = cx + LEAF / 2 + open * (LEAF - 0.02);
      }
      for (const g of gates) {
        const pass = !g.car.ride && g.car.departIn < 0 && g.car.level === g.level && g.car.door > 0.4;
        if (pass) g.box.set(OFF, OFF);
        else g.box.copy(g.on);
      }
      // call labels: hold the doors of a car standing open here, else call one
      for (const ct of callTargets) {
        const here = bank.cars.some((c) => !c.ride && c.departIn < 0 && c.level === ct.level && c.phase !== 'closed');
        const label = here ? 'Hold the elevator doors' : `Call the elevator ${ct.dirs.map((d) => (d === 'up' ? '▲' : '▼')).join(' ')}`;
        if (ct.it.target.kind === 'use' && ct.it.target.label !== label) ct.it.target = { ...ct.it.target, label };
      }
      // lamps and displays
      for (const level of levels) for (const dir of ['up', 'down'] as Dir[]) setLamp(`call:${level}:${dir}`, !!bank.hall.get(level)?.has(dir) || bank.cars.some((c) => c.stops.has(level) && !c.calls.has(level) && c.level !== level));
      for (const c of bank.cars) for (const level of levels) setLamp(`car:${c.id}:${level}`, c.calls.has(level));
      for (const d of displays) {
        const car = d.car;
        const moving = !!car.ride || car.departIn >= 0;
        const lantern = d.level !== null && !moving && car.level === d.level && car.phase !== 'closed' ? car.dir : null;
        drawDisplay(d.d, car.level, moving ? car.dir : null, lantern);
      }
      void v3;
    },
    use(id) {
      const parts = id.split(':');
      if (parts[0] !== 'elev' || parts[1] !== def.id) return null;
      if (parts[2] === 'call') {
        const level = Number(parts[3]);
        bank.call(level, level === top ? 'down' : 'up');
        const at = buttons.get(`call:${level}`) ?? null;
        if (at) beep(at);
        return at;
      }
      if (parts[2] === 'car') {
        const v = carViews.find((cv) => cv.car.id === parts[3]);
        if (!v) return null;
        const dest = levels.find((l) => l !== v.car.level) ?? v.car.level;
        bank.send(v.car.id, dest);
        const at = rig.buttonAt(id);
        if (at) beep(at);
        return at;
      }
      return null;
    },
    buttonAt(id) {
      const parts = id.split(':');
      if (parts[2] === 'call') return buttons.get(`call:${parts[3]}`)?.clone() ?? null;
      const v = carViews.find((cv) => cv.car.id === parts[3]);
      if (!v) return null;
      const dest = levels.find((l) => l !== v.car.level) ?? v.car.level;
      return new THREE.Vector3(v.cx - CW + 0.02, v.car.y + 1.3 + 0.43 - ((dest === top ? 128 : 172) / 360) * 0.86, Z_IN - 0.42);
    },
    panelFor(car) {
      return carViews.find((v) => v.car === car)?.panel;
    },
    sendFrom(x, z, level) {
      const car = rig.carAt(x, z);
      const at = rig.sendButtonAt(x, z, level);
      if (!car || !at) return null;
      bank.send(car.id, level);
      beep(at);
      return at;
    },
    sendButtonAt(x, z, level) {
      const car = rig.carAt(x, z);
      if (!car || !levels.includes(level)) return null;
      const v = carViews.find((cv) => cv.car === car)!;
      return new THREE.Vector3(v.cx - CW + 0.02, car.y + 1.3 + 0.43 - ((level === top ? 128 : 172) / 360) * 0.86, Z_IN - 0.42);
    },
    setCutaway(cut) {
      cutaway = cut;
    },
    feel(x, z, t) {
      const car = rig.carAt(x, z);
      if (!car || !car.ride) return 0;
      // inertia: the body sinks a little as the car accelerates up (and rises as it slows), plus a faint rumble
      return Math.max(-0.014, Math.min(0.014, -car.a * 0.012)) + Math.sin(t * 2 * Math.PI * 11) * 0.0006 * Math.min(1, Math.abs(car.v));
    },
    state() {
      return {
        cars: bank.cars.map((c) => ({ id: c.id, y: Math.round(c.y * 1000) / 1000, level: c.level, door: Math.round(c.door * 100) / 100, phase: c.phase, moving: !!c.ride || c.departIn >= 0, stops: [...c.stops] })),
        hall: Object.fromEntries([...bank.hall.entries()].map(([l, s]) => [l, [...s]])),
      };
    },
    dispose() {
      for (const h of hums.values()) h.stop(0);
      hums.clear();
    },
  };
  return rig;
}

/** merge a static group's meshes by material (keeping noMerge ones), in place */
function mergeKeep(group: THREE.Group) {
  const keep: THREE.Object3D[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.noMerge) keep.push(o);
  });
  for (const k of keep) k.userData.keep = true;
  const merged = mergeByMaterial(group, { castShadow: false });
  for (const k of keep) {
    k.userData.keep = false;
  }
  // mergeByMaterial re-parents the kept meshes into `merged`; replace the group's children
  const children = [...group.children];
  for (const ch of children) group.remove(ch);
  group.add(merged);
}

/**
 * The bank's sounds: a two-partial bell chime (one for up, two descending for down — the usual
 * convention), a short button beep, and a loopable ride hum (motor tone + low rumble + air).
 */
function synthElevatorSounds(ctx: AudioContext): { chime1: AudioBuffer; chime2: AudioBuffer; beep: AudioBuffer; hum: AudioBuffer } {
  const sr = ctx.sampleRate;
  const buf = (sec: number, fill: (t: number, i: number) => number) => {
    const n = Math.round(sec * sr);
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = fill(i / sr, i);
    return b;
  };
  const ding = (t: number, f: number) => {
    if (t < 0) return 0;
    const a = Math.min(1, t / 0.004);
    return a * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.42) * 0.55 + Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.12) * 0.18 + Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / 0.05) * 0.08);
  };
  const chime1 = buf(1.6, (t) => ding(t, 1046.5) * 0.7);
  const chime2 = buf(2.1, (t) => (ding(t, 1046.5) + ding(t - 0.55, 830.6)) * 0.6);
  const beep = buf(0.12, (t) => (t < 0.07 ? Math.sin(2 * Math.PI * 1320 * t) * Math.min(1, t / 0.003) * Math.min(1, (0.07 - t) / 0.01) * 0.35 : 0));
  // a seamless 2 s loop: harmonics that fit whole periods, plus filtered noise faded at the seam
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  let lp = 0;
  let lp2 = 0;
  const hum = buf(2.0, (t) => {
    const n = rnd();
    lp += (n - lp) * 0.02; // rumble
    lp2 += (n - lp2) * 0.25; // air
    const motor = Math.sin(2 * Math.PI * 100 * t) * 0.12 + Math.sin(2 * Math.PI * 200 * t) * 0.05 + Math.sin(2 * Math.PI * 300 * t) * 0.025;
    const edge = Math.min(1, t / 0.05, (2.0 - t) / 0.05);
    return (motor + lp * 1.6 + lp2 * 0.08 * edge) * 0.6;
  });
  return { chime1, chime2, beep, hum };
}

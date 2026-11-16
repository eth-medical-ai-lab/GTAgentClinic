import type { WorldSave } from '../../../shared/saveGame';
/**
 * Ward 2 East's people: the night charge nurse at the station, a nurse on her rounds-partner's
 * loop, and patients in four of the six rooms (asleep at night). Ambient and client-side, like the
 * waiting-room crowd's look: never sent to the server, never seen by AI agents, never scored. They
 * path on floor 2's own nav grid and say short scripted lines (speech bubbles) when you come near.
 */
import * as THREE from 'three';
import type { Appearance, BedPosition } from '../../../shared/types';
import type { LevelDef } from '../../../shared/floors';
import type { AvatarCharacter } from './avatars';
import { rigAt, type BedRig } from './bedRig';
import { createCharacter, headAnchor, type Character } from './characters';
import type { LabelLayer } from './labels';
import type { NavGrid } from './pathfinding';
import { lerpAngle } from './controls';

type Stop = { x: number; z: number; rot: number; wait: number; sit?: boolean };

interface WardNpc {
  id: string;
  ch: Character;
  pos: THREE.Vector2;
  yaw: number;
  path: THREE.Vector2[] | null;
  /** the stop it is walking to / standing at */
  stop: number;
  stops: Stop[];
  waitUntil: number;
  patient: boolean;
  lines: { night: string[]; day: string[] };
  /** how close you must be for a line (m), and when it may speak again */
  near: number;
  nextLine: number;
  lineIx: number;
  animAcc: number;
  shadowsOff?: boolean;
  /** a patient: how the bed is set (bedRig.ts moves its backrest there), and the bed once found */
  bedPos?: BedPosition;
  rig?: BedRig | null;
  /** an errand of the player's (cabinets.ts: the controlled-drug key): where to stand and face; her rounds wait */
  errand?: { x: number; z: number; rot: number } | null;
}

const SKIN = { a: '#c99372', b: '#efcfb8', c: '#e8c6ab', d: '#b98563', e: '#f2d6c4' };

/**
 * How someone looks, for the procedural fallback body and the avatar's height and age. The avatar
 * itself is casting.ts's (its CAST.ward_… entries keep every face on the map unique).
 */
const look = (a: Appearance): Appearance => a;

export class Ward {
  private npcs: WardNpc[] = [];
  private Y: number;
  private lastLineAt = -1e9;
  private night = true;
  private occlusion = new Map<string, boolean>();
  private frameNo = 0;
  private visible = false;
  private readonly tmp = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 2);

  constructor(
    private scene: THREE.Scene,
    L: LevelDef,
    private nav: NavGrid,
    private labels: () => LabelLayer,
    private occluders: THREE.Box3[],
  ) {
    this.Y = L.y;
    const room = (id: string) => L.rooms.find((r) => r.id === id)!;
    const spot = (id: string, s: string): { x: number; z: number; rot: number } => {
      const r = room(id);
      const p = r.spots[s] ?? r.entry;
      return { x: p.x, z: p.z, rot: p.rot ?? 0 };
    };
    const st = (id: string, s: string, wait: number, sit = false): Stop => ({ ...spot(id, s), wait, sit });
    // ── the charge nurse: at the station, a round to 201 and 202 now and then ──
    this.add({
      id: 'ward_ana',
      role: 'nurse',
      sex: 'f',
      appearance: look({ skin: SKIN.a, hair: '#1b1410', hairStyle: 'bun', outfit: 'scrubs', outfitColor: '#2f6b5f', height: 1.66, build: 'average', age: 'adult', accessories: ['badge'] }),
      stops: [st('f2_station', 'desk-1', 70, true), st('f2_room_201', 'bedside', 12), st('f2_room_202', 'bedside', 10), st('f2_station', 'desk-1', 95, true), st('f2_meds', 'dispenser', 9), st('f2_room_205', 'bedside', 11)],
      near: 3.0,
      lines: {
        night: [
          'Evening, Doctor. All quiet up here — touch wood.',
          'Admitting someone from the ED? 203 and 206 are made up and ready.',
          'Shh — 202 has only just dropped off.',
          'If you’re seeing 205: post-op hip, a bit muddled tonight. Her delirium screen is due at two.',
          'The ED is one floor down — the elevators are just past the station.',
        ],
        day: ['Afternoon, Doctor. Ward round’s done — 204 might go home tomorrow.', 'Need a bed? 203 and 206 are ready.', 'Pharmacy is on its way up with 202’s furosemide.'],
      },
    });
    // ── the second nurse: obs and meds round ──
    this.add({
      id: 'ward_theo',
      role: 'nurse',
      sex: 'm',
      appearance: look({ skin: SKIN.c, hair: '#5a3d28', hairStyle: 'short', outfit: 'scrubs', outfitColor: '#2f6b5f', height: 1.8, build: 'average', age: 'adult', accessories: ['badge'] }),
      stops: [st('f2_station', 'cart', 14), st('f2_meds', 'dispenser', 8), st('f2_room_204', 'bedside', 14), st('f2_room_205', 'bedside', 13), st('f2_corridor', 'east', 4), st('f2_room_202', 'chair', 9), st('f2_station', 'board', 16)],
      near: 2.6,
      lines: {
        night: ['Twenty-two hundred obs are done. Everyone’s stable.', '204’s cefazolin is due at six — I’ve got it.', 'Mind the trolley, Doc.', '205 needed something for pain earlier. She’s settled now.'],
        day: ['Physio is coming at three for 205.', '204’s leg looks better — the redness is inside the lines.', 'Two discharges pending, if anyone signs the letters.'],
      },
      start: 3,
    });
    // ── patients: four of six beds ──
    const patients: [string, Appearance, 'f' | 'm'][] = [
      ['f2_room_201', look({ skin: SKIN.b, hair: '#e6e6e6', hairStyle: 'bun', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.6, build: 'slim', age: 'old' }), 'f'],
      ['f2_room_202', look({ skin: SKIN.d, hair: '#7a7068', hairStyle: 'short', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.76, build: 'heavy', age: 'old' }), 'm'],
      ['f2_room_204', look({ skin: SKIN.e, hair: '#3b2a20', hairStyle: 'short', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.8, build: 'average', age: 'adult' }), 'm'],
      ['f2_room_205', look({ skin: SKIN.b, hair: '#f0f0f0', hairStyle: 'short', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.56, build: 'slim', age: 'old' }), 'f'],
    ];
    const ptLines: Record<string, { night: string[]; day: string[] }> = {
      f2_room_201: { night: [], day: ['Morning, Doctor. My breathing’s easier today.'] },
      f2_room_202: { night: ['(snoring softly)'], day: ['They weigh me every morning. Down a kilo!'] },
      f2_room_204: { night: [], day: ['When can I go home, Doc?'] },
      f2_room_205: { night: ['Mm… is it morning, love?'], day: ['My hip’s sore, but they got me into the chair today.'] },
    };
    // how each lies (bedRig.ts): propped up at 45° for 201's breathing and 202's heart failure (on
    // furosemide: orthopnoea), 30° for 205, muddled after her hip (aspiration), and 204 nearly flat with
    // his cellulitic left leg raised on a pillow
    const bedPos: Record<string, BedPosition> = {
      f2_room_201: { headDeg: 45 },
      f2_room_202: { headDeg: 45 },
      f2_room_204: { headDeg: 20, legUp: 'L' },
      f2_room_205: { headDeg: 30 },
    };
    for (const [id, a, sex] of patients) {
      const b = spot(id, 'bed');
      this.add({ id: `ward_pt_${id.slice(-3)}`, role: 'patient', sex, appearance: a, stops: [{ ...b, wait: 1e9 }], near: 1.7, lines: ptLines[id], patient: true, bed: bedPos[id] });
    }
  }

  private add(o: { id: string; role: 'nurse' | 'patient'; sex: 'f' | 'm'; appearance: Appearance; stops: Stop[]; near: number; lines: { night: string[]; day: string[] }; patient?: boolean; start?: number; bed?: BedPosition }) {
    // the avatar: casting.ts (castFor) by id
    const ch = createCharacter({ id: o.id, role: o.role, appearance: o.appearance, sex: o.sex });
    ch.root.visible = false;
    this.scene.add(ch.root);
    const s0 = o.stops[o.start ?? 0];
    const n: WardNpc = { id: o.id, ch, pos: new THREE.Vector2(s0.x, s0.z), yaw: s0.rot, path: null, stop: o.start ?? 0, stops: o.stops, waitUntil: performance.now() / 1000 + (o.patient ? 1e9 : 6 + this.npcs.length * 9), patient: !!o.patient, lines: o.lines, near: o.near, nextLine: 0, lineIx: 0, animAcc: 0, bedPos: o.bed };
    this.npcs.push(n);
    this.settle(n);
  }

  /** at a stop: sit at the desk, lie in bed, or stand */
  private settle(n: WardNpc) {
    const s = n.stops[n.stop];
    n.pos.set(s.x, s.z);
    n.yaw = s.rot;
    if (n.patient) {
      n.ch.setPosture('lie', 0.64);
      (n.ch as Character & { act?: string }).act = this.night ? 'sleep' : undefined;
    } else if (s.sit) {
      n.ch.seatKind = 'desk';
      n.ch.setPosture('sit', undefined, 0.48);
    } else n.ch.setPosture('stand');
  }

  setNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    for (const n of this.npcs) if (n.patient) (n.ch as Character & { act?: string }).act = night ? 'sleep' : undefined;
  }

  /** ids of the ward's people (debug/tests) */
  ids(): string[] {
    return this.npcs.map((n) => n.id);
  }

  /** where everyone up here is (someone standing where you'd stand at a bedside: care.ts) */
  people() {
    return this.npcs.map((n) => ({ id: n.id, x: n.pos.x, z: n.pos.y, yaw: n.yaw, posture: n.ch.posture }));
  }

  /**
   * Errands for the ward's nurses (cabinets.ts: the nurse in charge brings the controlled-drug key):
   * walk to a spot and face a way, stay there, then go back to the stop of her rounds she left.
   * Like World's for the ED's NPCs (payment.ts NpcErrands); only while you are up here.
   */
  readonly errands = {
    get: (id: string) => {
      const n = this.npcs.find((m) => m.id === id);
      return n && this.visible && !n.patient ? { x: n.pos.x, z: n.pos.y, yaw: n.yaw, walking: !!n.path, ch: n.ch } : null;
    },
    go: (id: string, x: number, z: number, rot: number) => {
      const n = this.npcs.find((m) => m.id === id);
      if (!n || n.patient) return false;
      const p = this.nav.findPath(n.pos.x, n.pos.y, x, z);
      n.errand = { x, z, rot };
      n.ch.setPosture('stand');
      n.path = p && p.length ? p : [new THREE.Vector2(x, z)];
      return true;
    },
    face: (id: string, yaw: number) => {
      const n = this.npcs.find((m) => m.id === id);
      if (n && !n.path) n.yaw = yaw;
    },
    home: (id: string) => {
      const n = this.npcs.find((m) => m.id === id);
      if (!n?.errand) return;
      n.errand = null;
      const s = n.stops[n.stop];
      const p = this.nav.findPath(n.pos.x, n.pos.y, s.x, s.z);
      if (p && p.length) n.path = p;
      else {
        this.settle(n);
        n.waitUntil = performance.now() / 1000 + s.wait;
      }
    },
    homeOf: (id: string) => {
      const n = this.npcs.find((m) => m.id === id);
      const s = n?.stops[n.stop];
      return s ? { x: s.x, z: s.z, rot: s.rot } : null;
    },
  };

  /** the patients in their beds (a bedside visit: care.ts) */
  patients(): { id: string; ch: Character; x: number; z: number; yaw: number }[] {
    return this.npcs.filter((n) => n.patient).map((n) => ({ id: n.id, ch: n.ch, x: n.pos.x, z: n.pos.y, yaw: n.yaw }));
  }

  snapshot(): NonNullable<WorldSave['ward']> {
    const t = performance.now() / 1000;
    return this.npcs.map(n => ({ id: n.id, x: n.pos.x, z: n.pos.y, yaw: n.yaw, stop: n.stop,
      path: n.path?.map(p => [p.x, p.y]), wait: n.waitUntil - t, nextLine: n.nextLine - t, lineIx: n.lineIx }));
  }

  restore(saved: NonNullable<WorldSave['ward']>) {
    const t = performance.now() / 1000;
    for (const row of saved) {
      const n = this.npcs.find(p => p.id === row.id);
      if (!n) continue;
      n.stop = row.stop;
      this.settle(n);
      n.pos.set(row.x, row.z);
      n.yaw = row.yaw;
      n.path = row.path?.map(([x, z]) => new THREE.Vector2(x, z)) ?? null;
      if (n.path) n.ch.setPosture('stand');
      n.waitUntil = t + row.wait;
      n.nextLine = t + row.nextLine;
      n.lineIx = row.lineIx;
    }
  }

  state() {
    return this.npcs.map((n) => ({ id: n.id, x: Math.round(n.pos.x * 100) / 100, z: Math.round(n.pos.y * 100) / 100, posture: n.ch.posture, walking: !!n.path, stop: n.stop }));
  }

  /**
   * Per frame. `show`: the player is on this floor (or looking at it in the cutaway); while hidden
   * nothing is drawn and the clock of their rounds just runs on.
   */
  update(dt: number, t: number, ctx: { show: boolean; player: THREE.Vector2; camera: THREE.Camera; cutaway: boolean; width: number; height: number; frustum: THREE.Frustum }) {
    const now = performance.now() / 1000;
    this.frameNo++;
    if (this.visible !== ctx.show) {
      this.visible = ctx.show;
      for (const n of this.npcs) n.ch.root.visible = ctx.show;
      if (!ctx.show) for (const n of this.npcs) this.labels().place(n.id, 0, 0, false, false);
    }
    for (const n of this.npcs) {
      let moving = false;
      // a patient's bed: its backrest as the ward has them, the body on it (bedRig.ts, avatars.ts)
      if (n.patient && n.bedPos) {
        n.rig ??= rigAt(this.scene, n.pos.x, this.Y, n.pos.y, n.yaw);
        n.rig?.want(n.bedPos.headDeg);
        const av = n.ch as AvatarCharacter;
        if (n.rig && 'bed' in av) av.bed = { rig: n.rig, pos: n.bedPos };
      }
      // ── rounds: wait, then walk to the next stop ──
      if (!n.patient) {
        if (n.path && n.path.length) {
          const tgt = n.path[0];
          const dx = tgt.x - n.pos.x;
          const dz = tgt.y - n.pos.y;
          const d = Math.hypot(dx, dz);
          const step = 1.15 * dt;
          // On rounds, wait for a resident standing in the way and resume once they pass.
          const fraction = d > 0 ? Math.min(1, step / d) : 0;
          const nextGap = Math.hypot(n.pos.x + dx * fraction - ctx.player.x, n.pos.y + dz * fraction - ctx.player.y);
          const yielding = ctx.show && nextGap < 0.55 && nextGap < n.pos.distanceTo(ctx.player);
          if (!yielding && d <= step) {
            n.pos.copy(tgt);
            n.path.shift();
            if (!n.path.length) {
              n.path = null;
              if (n.errand) {
                // there for the errand: standing, turned to it, until it is over (errands().home)
                n.yaw = n.errand.rot;
                n.waitUntil = Infinity;
              } else {
                this.settle(n);
                n.waitUntil = now + n.stops[n.stop].wait * (0.8 + 0.4 * hash01(n.id, n.stop + Math.floor(now)));
              }
            }
          } else if (!yielding) {
            n.pos.x += (dx / d) * step;
            n.pos.y += (dz / d) * step;
            n.yaw = lerpAngle(n.yaw, Math.atan2(dx, dz), Math.min(1, dt * 9));
          }
          moving = !yielding && !!n.path;
        } else if (now > n.waitUntil) {
          n.stop = (n.stop + 1) % n.stops.length;
          const s = n.stops[n.stop];
          const p = this.nav.findPath(n.pos.x, n.pos.y, s.x, s.z);
          if (p && p.length) {
            n.path = p;
            n.ch.setPosture('stand');
          } else {
            this.settle(n);
            n.waitUntil = now + s.wait;
          }
        }
      }
      if (!this.visible) continue;
      // ── look at you when you're close; say something now and then ──
      const dx = ctx.player.x - n.pos.x;
      const dz = ctx.player.y - n.pos.y;
      const dp = Math.hypot(dx, dz);
      if (!moving && dp < 3.5 && !(n.patient && this.night)) {
        let rel = Math.atan2(dx, dz) - n.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        n.ch.lookYaw = Math.abs(rel) < 1.6 ? rel : 0;
      } else n.ch.lookYaw = 0;
      const lines = this.night ? n.lines.night : n.lines.day;
      if (lines.length && dp < n.near && now > n.nextLine && now - this.lastLineAt > 5) {
        this.labels().ensure(n.id, '', '', null, undefined);
        this.labels().say(n.id, lines[n.lineIx % lines.length]);
        n.lineIx++;
        n.nextLine = now + 28;
        this.lastLineAt = now;
      }
      n.ch.root.position.set(n.pos.x, this.Y, n.pos.y);
      n.ch.root.rotation.y = n.yaw;
      // upstairs, nobody needs to be in the ED's exam-light shadow maps (avatars are never frustum-culled there)
      if (!n.shadowsOff && (n.ch as Character & { ready?: boolean }).ready) {
        n.ch.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
        n.shadowsOff = true;
      }
      // animate near people at full rate, far ones at 10 Hz, off-screen ones at 4 Hz
      this.sphere.center.set(n.pos.x, this.Y + 0.9, n.pos.y);
      const inView = ctx.frustum.intersectsSphere(this.sphere);
      n.ch.root.visible = inView;
      const every = !inView ? 0.25 : dp > 14 ? 0.1 : 0;
      n.animAcc += dt;
      if (n.animAcc >= every) {
        n.ch.update(Math.min(n.animAcc, 0.5), t, moving, moving ? 1.15 : 0);
        n.animAcc = 0;
      }
    }
    if (this.visible) this.placeLabels(ctx);
  }

  /** speech bubbles over heads (no name tags: like the ED's ambient staff, they're not for talking) */
  private placeLabels(ctx: { camera: THREE.Camera; cutaway: boolean; width: number; height: number }) {
    const cam = ctx.camera.position;
    for (const n of this.npcs) {
      headAnchor(n.ch, this.tmp);
      const dist = this.tmp.distanceTo(cam);
      const p = this.tmp.clone().project(ctx.camera);
      if (!(p.z < 1 && Math.abs(p.x) < 1.2 && p.y > -1.2 && p.y < 1.3) || !n.ch.root.visible) {
        this.labels().place(n.id, 0, 0, false, false);
        continue;
      }
      let occluded = false;
      if (!ctx.cutaway) {
        if (this.frameNo % 4 === 0 || !this.occlusion.has(n.id)) {
          this.ray.set(cam, this.tmp.clone().sub(cam).normalize());
          occluded = this.occluders.some((o) => {
            const hit = this.ray.ray.intersectBox(o, new THREE.Vector3());
            return !!hit && hit.distanceTo(cam) < dist - 0.2;
          });
          this.occlusion.set(n.id, occluded);
        } else occluded = this.occlusion.get(n.id)!;
      }
      this.labels().place(n.id, ((p.x + 1) / 2) * ctx.width, ((1 - p.y) / 2) * ctx.height, false, !occluded && dist < 16, Math.max(0.72, Math.min(1.08, 1.25 - dist / 14)));
    }
  }

  dispose() {
    for (const n of this.npcs) {
      this.scene.remove(n.ch.root);
      n.ch.dispose?.();
      this.labels().remove(n.id);
    }
    this.npcs = [];
  }
}

/** a stable 0..1 from an id and a number (rounds vary a little without Math.random) */
function hash01(id: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Life in the CT suite and the X-ray room: the radiographers (Jordan in CT, Sam in X-ray; client-side
 * like Ward 2 East's people, never sent to the server or seen by agents), the patient carried on the
 * couch through the gantry, the lasers, the injector, the tube crane, the collimator light, the
 * warning lights over the doors, the consoles' screens and the scanner's sounds.
 *
 * Everything plays the server's imaging slot (NpcView.scan: the study and from when to when) on game
 * time through imagingPlan.ts, from the moment the patient is on the couch (or at the wall stand):
 * nothing here changes the simulation. World.ts asks `carry()` where a patient on the couch is carried
 * to, after placing them where the server's spot is.
 */
import * as THREE from 'three';
import type { LayoutDef } from '../../../shared/layout';
import type { Appearance, NpcView, PlayerView } from '../../../shared/types';
import { clockAt } from '../../../shared/types';
import { playSound, type SoundHandle } from '../audio/soundscape';
import { createCharacter, headAnchor, type Character } from './characters';
import { lerpAngle } from './controls';
import type { CtRig, ImagingRig, Screen, XrRig } from './imaging';
import { YOKE } from './imaging';
import { CT, XR, ctProgress, ctProtocol, ctStateAt, ctTimeline, xrStateAt, xrStudy, xrTarget, xrTimeline, type CtPhase, type CtProtocol, type CtState, type Seg, type TubePose, type XrPhase, type XrState, type XrStudy } from './imagingPlan';
import { drawCtExam, drawCtImages, drawCtWorklist, drawGantry, drawInjHead, drawInjector, drawXrConsole, drawXrGen } from './imagingScreens';
import type { LabelLayer } from './labels';
import type { NavGrid } from './pathfinding';

const PI = Math.PI;

/** an NPC as World.ts keeps it */
export interface WorldNpc {
  v: NpcView;
  ch: Character;
  pos: THREE.Vector2;
  yaw: number;
  path: unknown;
}

export interface ImagingDeps {
  scene: THREE.Scene;
  rig: ImagingRig;
  layout: LayoutDef;
  nav: NavGrid;
  labels: () => LabelLayer;
  camera: THREE.Camera;
  container: HTMLElement;
  occluders: THREE.Box3[];
  npcs: () => Iterable<WorldNpc>;
  /** the storey being looked at (0 = the ground floor) */
  level: () => number;
  player: () => { x: number; z: number };
  cutaway: () => boolean;
}

interface Visit {
  id: string;
  name: string;
  pid: string;
  code: string;
  modality: string;
  since: number;
  until: number;
  /** game time the patient was on the couch / at the stand (null: still on the way) */
  settled: number | null;
  height: number;
  /** lines already said this visit */
  said: Set<string>;
}

interface Tech {
  id: string;
  ch: Character;
  pos: THREE.Vector2;
  yaw: number;
  path: THREE.Vector2[] | null;
  /** where it is going or is: a key, the place, sitting there */
  at: string;
  dest: { x: number; z: number; rot: number; sit: boolean };
  animAcc: number;
  shadowsOff?: boolean;
  /** what to look at when standing still (a patient), world x/z */
  look: { x: number; z: number } | null;
}

/**
 * A looped sound kept while a condition holds. A handle from before the soundscape started (the first
 * click) is a dummy: tried again every 2 s. A live one is kept (out of earshot it costs nothing).
 */
class Loop {
  private h: SoundHandle | null = null;
  private live = false;
  private triedAt = -1e9;
  constructor(
    private name: string,
    private at: { x: number; y: number; z: number },
  ) {}
  set(on: boolean, gain = 1) {
    if (!on) {
      if (this.h) this.h.stop(0.6);
      this.h = null;
      return;
    }
    const now = performance.now();
    if (!this.h || (!this.live && now - this.triedAt > 2000)) {
      this.h = playSound(this.name, { at: this.at, loop: true, gain, range: 24 });
      this.live = !!Object.getOwnPropertyDescriptor(this.h, 'playing')?.get;
      this.triedAt = now;
    } else if (this.live) this.h.setGain(gain);
  }
  stop() {
    this.h?.stop(0.2);
    this.h = null;
  }
}

const SKIN = { jordan: '#c68e63', sam: '#e8c6ab' };

/** a radiographer's lines, by what is happening */
const CT_LINES: Record<string, (p: CtProtocol) => string | null> = {
  arrive: () => "Hi, I'm Jordan, I'll be doing your scan. Lie on your back for me, head this end.",
  lift: () => "I'm going to raise the table now.",
  lasers: (p) => (p.region === 'head' ? 'Bright lights coming on — close your eyes, and keep your head very still.' : 'Bright lights coming on — close your eyes for a moment.'),
  connect: () => "I'm connecting the contrast to your drip.",
  toConsole: () => "I'll be just behind the window. You'll hear me through the speaker.",
  scoutHold: (p) => (p.breathHold ? 'Breathe in… and hold your breath.' : null),
  scoutBreathe: (p) => (p.breathHold ? 'Breathe away.' : null),
  inject: () => "The contrast is going in. You'll feel warm all over, maybe like you've wet yourself — you haven't, and it passes.",
  scanHold: (p) => (p.breathHold ? 'Breathe in… and hold your breath.' : 'Keep very still now.'),
  scanBreathe: (p) => (p.breathHold ? 'Breathe away. That was the scan.' : 'All done with the scanning.'),
  return: () => 'That was it. You did really well.',
  unload: () => "I'm lowering the table. We'll get you back to your bay.",
};
const XR_LINES: Record<string, (st: XrStudy, view: string) => string | null> = {
  arrive: (st) => (st.erect ? "Hi, I'm Sam from X-ray. Stand facing the plate for me, chest right up against it." : "Hi, I'm Sam from X-ray. Hop up onto the table for me and lie back."),
  position: (st) => (st.erect ? 'Chin up on the top, hands on your hips, and roll your shoulders forward.' : 'Let your foot relax — I’ll do the moving.'),
  hold: (st) => (st.erect ? 'Big breath in… and hold it.' : 'Keep very still for me…'),
  done1: (st) => (st.erect ? 'And breathe.' : 'Lovely.'),
  reposition: (st, v) => (st.erect ? 'Now turn to your right — left side against the plate, arms up over your head.' : v === 'LAT' ? 'Now let your knee fall out to the side for me.' : "I'm turning your foot in a little."),
  review: () => 'The pictures look good.',
  done: () => 'All done, thank you. You can head back now.',
};

const lastFirst = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toUpperCase();
  const last = parts.pop()!;
  return `${last.toUpperCase()}, ${parts.join(' ')}`;
};
function accession(prefix: string, id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return `${prefix}26-${String(48000 + ((h >>> 0) % 900)).padStart(5, '0')}`;
}

/**
 * The body's section where the axial laser crosses it: [half width with the arms at the sides,
 * thickness] (m, for a 1.75 m adult) at a point along it, as a fraction of height from the hips
 * (− toward the head).
 */
const SECTION: [number, number, number][] = [
  [-0.475, 0.04, 0.06],
  [-0.45, 0.075, 0.17],
  [-0.4, 0.085, 0.19],
  [-0.36, 0.07, 0.15],
  [-0.33, 0.055, 0.11],
  [-0.3, 0.23, 0.17],
  [-0.2, 0.25, 0.22],
  [-0.1, 0.25, 0.22],
  [0, 0.23, 0.19],
  [0.08, 0.2, 0.16],
  [0.25, 0.17, 0.13],
  [0.32, 0.14, 0.11],
  [0.46, 0.12, 0.09],
  [0.5, 0.12, 0.15],
  [0.535, 0.08, 0.1],
];
export function bodySection(o: number, height: number): [number, number] | null {
  if (o < SECTION[0][0] || o > SECTION[SECTION.length - 1][0]) return null;
  for (let i = 1; i < SECTION.length; i++) {
    const [a, wa, ta] = SECTION[i - 1];
    const [b, wb, tb] = SECTION[i];
    if (o <= b) {
      const k = (o - a) / (b - a);
      const s = height / 1.75;
      return [(wa + (wb - wa) * k) * s, (ta + (tb - ta) * k) * s];
    }
  }
  return null;
}

const approach = (cur: number, to: number, rate: number, dt: number) => (Math.abs(to - cur) <= rate * dt ? to : cur + Math.sign(to - cur) * rate * dt);

export class ImagingLife {
  private techs: Tech[] = [];
  private viewT = 0;
  private viewAt = 0;
  private scale = 0;
  private tNow = 0;
  private clockStart = '22:00';
  private frameNo = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly occl = new Map<string, boolean>();

  // ── CT ──
  private ctVisit: Visit | null = null;
  private ctTl: Seg<CtPhase>[] | null = null;
  private ctProt: CtProtocol | null = null;
  private ctState: CtState = ctStateAt(ctProtocol('ct_abd_iv'), null, 0, 1.75);
  /** what is shown: couch lift (0..1), travel (m), rotor speed; the line's last end point */
  readonly ctDisp = { lift: 0, travel: 0, spin: 0 };
  private ctBeam = false;
  private ctLastPhase = '';
  private ctScreenKey = ['', '', '', '', '', ''];
  private ctScreenAt = 0;
  private lineEnd = new THREE.Vector3(1e9, 0, 0);
  private ctSounds: { spin: Loop; xray: Loop; table: Loop } | null = null;

  // ── X-ray ──
  private xrVisit: Visit | null = null;
  private xrTl: Seg<XrPhase>[] | null = null;
  private xrSt: XrStudy | null = null;
  private xrTargetPose: ReturnType<typeof xrTarget> | null = null;
  private xrState: XrState | null = null;
  readonly xrDisp = { tube: { ...XR.park } as TubePose, standY: 1.35, buckyZ: 0, turn: 0 };
  private xrPrep = false;
  private xrBeam = false;
  private xrScreenKey = ['', ''];
  private xrScreenAt = 0;
  private xrLastKey = '';

  constructor(private d: ImagingDeps) {
    const { ct, xr } = d.rig;
    if (ct) {
      this.addTech('img_ct_jordan', 'f', { skin: SKIN.jordan, hair: '#2a1b14', hairStyle: 'ponytail', outfit: 'scrubs', outfitColor: '#3a4f7a', height: 1.68, build: 'average', age: 'adult', accessories: ['badge'], avatar: { id: 'Medical_Female_01', head: 'Medical_Female_03', scrubs: '#3a4f7a', skin: SKIN.jordan, hair: '#2a1b14' } } as Appearance, ct.seat);
      this.ctSounds = { spin: new Loop('ct.spin', ct.sound), xray: new Loop('ct.xray', ct.sound), table: new Loop('ct.table', { x: ct.sound.x, y: 0.6, z: ct.sound.z + 1.2 }) };
    }
    if (xr) this.addTech('img_xr_sam', 'm', { skin: SKIN.sam, hair: '#3b2a20', hairStyle: 'short', outfit: 'scrubs', outfitColor: '#2f5f6f', height: 1.8, build: 'average', age: 'adult', accessories: ['badge'], avatar: { id: 'Medical_Male_05' } } as Appearance, xr.seat);
    // everything at rest
    if (ct) this.poseCt(ct, 0);
    if (xr) this.poseXr(xr);
  }

  private addTech(id: string, sex: 'f' | 'm', appearance: Appearance, seat: { x: number; z: number; rot: number }) {
    const ch = createCharacter({ id, role: 'tech', appearance, sex });
    this.d.scene.add(ch.root);
    const t: Tech = { id, ch, pos: new THREE.Vector2(seat.x, seat.z), yaw: seat.rot, path: null, at: 'seat', dest: { ...seat, sit: true }, animAcc: 0, look: null };
    this.techs.push(t);
    this.settle(t);
  }

  // ───────────────────────────── the clock ─────────────────────────────

  view(v: PlayerView) {
    if (v.t < this.viewT - 1) this.tNow = v.t;
    this.viewT = v.t;
    this.viewAt = performance.now();
    this.clockStart = v.clockStart;
    const live = v.mode === 'realtime' && !v.settings.paused && !v.ended;
    this.scale = live ? v.settings.timeScale * (v.player.focus && v.settings.focusSlowdown ? 0.35 : 1) : 0;
  }

  /** game time now: the last view's, run on at the game's speed (never backwards, a few seconds at most) */
  private now(): number {
    const dt = Math.min(3, (performance.now() - this.viewAt) / 1000);
    const t = this.viewT + dt * this.scale;
    this.tNow = Math.max(this.tNow, t);
    if (this.tNow > this.viewT + 3 * Math.max(1, this.scale)) this.tNow = this.viewT;
    return this.tNow;
  }

  // ───────────────────────────── per frame ─────────────────────────────

  update(dt: number, t: number) {
    this.frameNo++;
    const now = this.now();
    const { ct, xr } = this.d.rig;
    // the patients in each room (the earliest sent, if two)
    let ctNpc: WorldNpc | null = null;
    let xrNpc: WorldNpc | null = null;
    for (const st of this.d.npcs()) {
      const v = st.v;
      if (v.role !== 'patient' || !v.visible) continue;
      if (v.location === 'ct' && (!ctNpc || (v.scan?.since ?? 0) < (ctNpc.v.scan?.since ?? 0))) ctNpc = st;
      if (v.location === 'xray' && (!xrNpc || (v.scan?.since ?? 0) < (xrNpc.v.scan?.since ?? 0))) xrNpc = st;
    }
    if (ct) this.stepCt(ct, ctNpc, now, dt);
    if (xr) this.stepXr(xr, xrNpc, now, dt);
    this.stepTechs(dt, t);
  }

  private visitFor(st: WorldNpc, prev: Visit | null, now: number, slotMin: number): Visit {
    const v = st.v;
    if (prev && prev.id === v.id && prev.since === (v.scan?.since ?? prev.since)) return prev;
    return {
      id: v.id,
      name: v.name,
      pid: v.patientId ?? v.id,
      code: v.scan?.code ?? (slotMin > 8 ? 'ct_abd_iv' : 'xr_chest'),
      modality: v.scan?.modality ?? (slotMin > 8 ? 'CT' : 'XR'),
      since: v.scan?.since ?? now,
      until: v.scan?.until ?? now + slotMin * 60,
      settled: null,
      height: st.ch.height || 1.75,
      said: new Set(),
    };
  }

  // ── CT ──

  private stepCt(rig: CtRig, npc: WorldNpc | null, now: number, dt: number) {
    const tech = this.techs.find((x) => x.id === 'img_ct_jordan');
    if (npc && npc.v.scan?.modality !== 'MRI') {
      const visit = this.visitFor(npc, this.ctVisit, now, 12);
      if (visit !== this.ctVisit) {
        this.ctVisit = visit;
        this.ctTl = null;
        this.ctProt = ctProtocol(visit.code);
        this.ctLastPhase = '';
      }
      // on the couch: arrived, lying, at the table spot
      const spot = this.d.layout.rooms.find((r) => r.id === 'ct')?.spots.table;
      if (visit.settled === null && !npc.path && npc.ch.posture === 'lie' && spot && Math.hypot(npc.pos.x - spot.x, npc.pos.y - spot.z) < 0.6) {
        visit.settled = now;
        this.ctTl = ctTimeline(this.ctProt!, now, visit.until);
      }
      this.ctState = ctStateAt(this.ctProt!, this.ctTl, now, visit.height);
    } else {
      if (this.ctVisit) this.ctVisit = null;
      this.ctTl = null;
      this.ctState = ctStateAt(ctProtocol('ct_abd_iv'), null, now, 1.75);
      this.ctState = { ...this.ctState, phase: 'idle', tech: 'console' };
    }
    const s = this.ctState;
    const v = this.ctVisit;
    // the couch follows the plan at the drive's speeds (and back home when the room is empty)
    const prevLift = this.ctDisp.lift;
    const prevTravel = this.ctDisp.travel;
    this.ctDisp.lift = approach(this.ctDisp.lift, s.lift, 0.12, dt * Math.max(1, this.scale / 6));
    this.ctDisp.travel = approach(this.ctDisp.travel, s.travel, 0.45, dt * Math.max(1, this.scale / 6));
    this.ctDisp.spin = approach(this.ctDisp.spin, s.spin, 0.35, dt);
    this.poseCt(rig, now);
    // the radiographer
    if (tech) {
      const atTable = s.tech === 'table';
      const pat = npc ? { x: npc.pos.x, z: npc.pos.y } : null;
      this.send(tech, atTable ? 'table' : 'seat', atTable ? { ...rig.tableSide, sit: false } : { ...rig.seat, sit: true }, atTable ? pat : null);
    }
    // lines, once each per visit, as the steps begin
    if (v && this.ctProt && tech) {
      const p = this.ctProt;
      const say = (key: string) => {
        if (v.said.has(key)) return;
        v.said.add(key);
        const line = CT_LINES[key]?.(p);
        if (line) this.say(tech, line);
      };
      const nearTable = Math.hypot(tech.pos.x - rig.tableSide.x, tech.pos.y - rig.tableSide.z) < 1.2;
      if (s.phase === 'arrive' && nearTable) say('arrive');
      if (s.phase === 'position') {
        if (s.u > 0.04) say('lift');
        if (s.lasers) say('lasers');
        if (s.connected && p.contrast) say('connect');
      }
      if (s.phase === 'toConsole') say('toConsole');
      if (s.phase === 'scout' && s.breath === 'hold') say('scoutHold');
      if (s.phase === 'scout' && s.breath === 'breathe') say('scoutBreathe');
      if (s.phase === 'inject' && s.contrast > 0.02) say('inject');
      if (s.phase === 'scan' && s.u > 0.05) say('scanHold');
      if (s.phase === 'recon' || (s.phase === 'scan' && s.breath === 'breathe')) say('scanBreathe');
      if (s.phase === 'return' && nearTable) say('return');
      if (s.phase === 'unload') say('unload');
    }
    // sounds: the rotor, the beam, the couch's drive, the tone as an exposure starts
    if (this.ctSounds) {
      this.ctSounds.spin.set(this.ctDisp.spin > 0.03, 0.35 + 0.65 * this.ctDisp.spin);
      this.ctSounds.xray.set(s.beam);
      const moving = Math.abs(this.ctDisp.travel - prevTravel) / Math.max(1e-3, dt) > 0.01 || Math.abs(this.ctDisp.lift - prevLift) / Math.max(1e-3, dt) > 0.003;
      this.ctSounds.table.set(moving);
      if (s.beam && !this.ctBeam && !(this.ctProt?.tracking && s.phase === 'inject')) playSound('scan.beep', { at: { x: rig.seat.x - 0.5, y: 1.0, z: rig.seat.z }, range: 14 });
    }
    this.ctBeam = s.beam;
    // the door's warning light and the gantry's X-ray lamp: on exactly while the beam is
    for (const m of rig.warn) setLamp(m, s.beam);
    rig.beamLamp.emissiveIntensity = s.beam ? 3 : 0;
    rig.beamLamp.color.set(s.beam ? '#ffd27a' : '#4a3410');
    this.ctScreens(rig, now, s);
    this.ctLastPhase = s.phase;
  }

  /** puts the couch, cradle, lasers and the injector where ctDisp and the state have them */
  private poseCt(rig: CtRig, now: number) {
    const top = CT.topLoad + (CT.topScan - CT.topLoad) * this.ctDisp.lift;
    const s = this.ctState;
    rig.upper.position.y = top - CT.cradleT - 0.168;
    rig.column.scale.y = Math.max(0.05, rig.upper.position.y - 0.11);
    rig.cradle.position.set(0, top, CT.cradleHome - this.ctDisp.travel);
    // lasers: the axial line over the body under the external laser, the lines on the pad
    rig.lasers.visible = s.lasers;
    if (s.lasers) {
      const padTop = top + CT.padT;
      const v = this.ctVisit;
      const h = v?.height ?? 1.75;
      const o = (CT.laserZ - (CT.hipsHome - this.ctDisp.travel)) / h;
      const sec = v?.settled != null ? bodySection(o, h) : null;
      rig.laserArc.visible = !!sec;
      if (sec) {
        rig.laserArc.position.y = padTop;
        rig.laserArc.scale.set(sec[0] + 0.006, sec[1] + 0.006, 1);
      }
      rig.laserPad.position.y = padTop + 0.0015;
      const hw = sec ? sec[0] : 0;
      const [l, r, sag] = rig.laserPad.children;
      for (const [m, sgn] of [[l, -1], [r, 1]] as [THREE.Object3D, number][]) {
        m.visible = hw + 0.03 < CT.cradleW / 2 - 0.02;
        m.position.x = sgn * Math.min(CT.cradleW / 2 - 0.07, hw + 0.08);
      }
      const len = Math.max(0.02, CT.cradleHome + CT.cradleLen - this.ctDisp.travel - CT.laserZ - 0.02);
      sag.scale.z = len / 2.1;
      sag.position.z = len / 2;
    }
    // injector: plungers and fluid as the volumes go down; its line to the IV while connected
    const p = this.ctProt;
    const inj = rig.injector;
    const fullA = 0.19 * Math.min(1, (p?.ml ?? 100) / 125);
    const fullB = 0.19 * Math.min(1, (p?.flush ?? 50) / 125);
    const la = p?.contrast ? Math.max(0.004, fullA * (1 - s.contrast)) : 0.004;
    const lb = p?.contrast ? Math.max(0.004, fullB * (1 - s.saline)) : 0.004;
    inj.fluid[0].scale.z = la;
    inj.fluid[1].scale.z = lb;
    inj.plunger[0].position.z = 0.28 - la - 0.006;
    inj.plunger[1].position.z = 0.28 - lb - 0.006;
    inj.led.emissiveIntensity = s.contrast > 0 && s.saline < 1 ? 2.4 : s.connected ? 1.2 : 0.3;
    inj.led.emissive.set(s.contrast > 0 && s.saline < 1 ? '#f2a51c' : '#3fb950');
    const showLine = s.connected && !!this.ctVisit?.settled;
    inj.line.visible = showLine;
    if (showLine) {
      // to the patient's right antecubital fossa: beside the trunk, on the side of the injector
      const sc = rig.scanner;
      const r = sc.rot ?? 0;
      const h = this.ctVisit?.height ?? 1.75;
      const lz = CT.hipsHome - this.ctDisp.travel - 0.15 * h;
      const lx = -0.21 * (h / 1.75);
      const end = new THREE.Vector3(sc.x + lx * Math.cos(r) + lz * Math.sin(r), top + CT.padT + 0.07, sc.z - lx * Math.sin(r) + lz * Math.cos(r));
      if (end.distanceTo(this.lineEnd) > 0.008) {
        this.lineEnd.copy(end);
        const a = inj.tip;
        const mid = a.clone().lerp(end, 0.5);
        mid.y = Math.min(a.y, end.y) - 0.18;
        const curve = new THREE.CatmullRomCurve3([a.clone(), a.clone().lerp(mid, 0.5).setY(a.y - 0.12), mid, end.clone().lerp(mid, 0.3), end], false, 'centripetal');
        const old = inj.line.geometry;
        inj.line.geometry = new THREE.TubeGeometry(curve, 28, 0.0035, 6, false);
        old.dispose();
      }
    }
    void now;
  }

  private ctScreens(rig: CtRig, now: number, s: CtState) {
    const near = this.near(rig.seat.x - 1.5, rig.seat.z, 16);
    const nowMs = performance.now();
    if (!near && this.ctScreenKey[0] !== '') return;
    if (nowMs - this.ctScreenAt < 120) return;
    this.ctScreenAt = nowMs;
    const v = this.ctVisit;
    const p = v ? this.ctProt : null;
    const clock = clockAt(this.clockStart, now);
    const info = { clock, patient: v ? { name: lastFirst(v.name), id: accession('CT', v.pid) } : null, protocol: p, st: s, progress: ctProgress(this.ctTl, now), since: v ? clockAt(this.clockStart, v.since) : undefined };
    const r2 = (x: number) => Math.round(x * 50);
    const base = `${clock}|${v?.id ?? ''}|${s.phase}`;
    const keys = [
      `${base}`,
      `${base}|${r2(s.scout)}|${r2(s.scan)}|${r2(info.progress)}|${s.beam}|${s.breath}|${s.phase === 'inject' ? r2(s.u) : 0}`,
      `${base}|${s.phase === 'recon' ? Math.ceil(s.u * 4) : 0}`,
      `${base}|${r2(s.contrast)}|${r2(s.saline)}|${s.connected}`,
      `${r2(s.contrast)}|${r2(s.saline)}|${s.connected}|${v?.id ?? ''}`,
      `${s.breath}|${s.beam}|${s.lasers}|${Math.round(this.ctDisp.travel * 100)}|${Math.round(this.ctDisp.lift * 40)}|${this.breathCountdown(now)}`,
    ];
    const draw = (i: number, scr: Screen, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
      if (keys[i] === this.ctScreenKey[i]) return;
      this.ctScreenKey[i] = keys[i];
      fn(scr.ctx, scr.canvas.width, scr.canvas.height);
      scr.tex.needsUpdate = true;
    };
    const [w1, w2, w3] = rig.console;
    if (w1) draw(0, w1, (c, w, h) => drawCtWorklist(c, w, h, info));
    if (w2) draw(1, w2, (c, w, h) => drawCtExam(c, w, h, info));
    if (w3) draw(2, w3, (c, w, h) => drawCtImages(c, w, h, info));
    draw(3, rig.injRemote, (c, w, h) => drawInjector(c, w, h, p, s));
    draw(4, rig.injHead, (c, w, h) => drawInjHead(c, w, h, p, s));
    const top = CT.topLoad + (CT.topScan - CT.topLoad) * this.ctDisp.lift;
    draw(5, rig.gantry, (c, w, h) => drawGantry(c, w, h, s, this.ctDisp.travel, top + CT.padT, this.breathCountdown(now)));
  }

  /** real seconds left in the breath hold, for the gantry's display */
  private breathCountdown(now: number): number | null {
    const s = this.ctState;
    if (s.breath !== 'hold' || !this.ctTl) return null;
    const seg = this.ctTl.find((x) => now >= x.t0 && now < x.t1);
    if (!seg) return null;
    const end = seg.phase === 'scan' ? seg.t0 + 0.88 * (seg.t1 - seg.t0) : seg.phase === 'scout' ? seg.t0 + 0.86 * (seg.t1 - seg.t0) : seg.t1;
    return Math.max(1, Math.ceil((end - now) / Math.max(1, this.scale)));
  }

  // ── X-ray ──

  private stepXr(rig: XrRig, npc: WorldNpc | null, now: number, dt: number) {
    const tech = this.techs.find((x) => x.id === 'img_xr_sam');
    let target: { tube: TubePose; standY: number; buckyX: number } = { tube: { ...XR.park }, standY: 1.35, buckyX: rig.table.x };
    if (npc) {
      const visit = this.visitFor(npc, this.xrVisit, now, 6);
      if (visit !== this.xrVisit) {
        this.xrVisit = visit;
        this.xrTl = null;
        this.xrSt = xrStudy(visit.code);
        this.xrLastKey = '';
      }
      const st = this.xrSt!;
      const room = this.d.layout.rooms.find((r) => r.id === 'xray');
      const spot = st.erect ? room?.spots.wallStand : room?.spots.table;
      const posture = st.erect ? 'stand' : 'lie';
      if (spot) this.xrTargetPose = xrTarget(st, { x: spot.x, z: spot.z, height: visit.height });
      if (visit.settled === null && !npc.path && npc.ch.posture === posture && spot && Math.hypot(npc.pos.x - spot.x, npc.pos.y - spot.z) < 0.6) {
        visit.settled = now;
        this.xrTl = xrTimeline(st, now, visit.until);
      }
      target = this.xrTargetPose ?? target;
      this.xrState = xrStateAt(st, this.xrTl, now, target);
    } else {
      this.xrVisit = null;
      this.xrTl = null;
      this.xrState = null;
    }
    const s = this.xrState;
    // the tube at the crane's speeds; the stand's detector; the bucky under the limb
    const goal = s ? s.tube : XR.park;
    const tp = this.xrDisp.tube;
    const k = dt * Math.max(1, this.scale / 6);
    tp.x = approach(tp.x, goal.x, 0.5, k);
    tp.z = approach(tp.z, goal.z, 0.5, k);
    tp.y = approach(tp.y, goal.y, 0.35, k);
    tp.tilt = approach(tp.tilt, goal.tilt, 0.6, k);
    this.xrDisp.standY = approach(this.xrDisp.standY, s ? s.standY : 1.35, 0.2, k);
    this.xrDisp.buckyZ = approach(this.xrDisp.buckyZ, Math.max(-0.6, Math.min(0.6, (s ? s.buckyX : rig.table.x) - rig.table.x)), 0.4, k);
    this.xrDisp.turn = s ? approach(this.xrDisp.turn, s.turn, 1.6, dt) : 0;
    this.poseXr(rig);
    // the collimator's light on the patient
    const st = this.xrSt;
    const v = this.xrVisit;
    rig.light.visible = !!(s?.light && st && v?.settled != null);
    if (rig.light.visible && st && this.xrTargetPose) {
      if (st.erect) {
        const lat = s!.turn < -0.5;
        rig.light.position.set(XR.standFace - (lat ? 0.37 : 0.31), this.xrDisp.standY, tp.z);
        rig.light.rotation.set(0, -PI / 2, 0);
        rig.light.scale.set(st.field[0] * (lat ? 0.85 : 1), st.field[1], 1);
      } else {
        rig.light.position.set(tp.x, XR.top + XR.pad + 0.004, tp.z);
        rig.light.rotation.set(-PI / 2, 0, 0);
        rig.light.scale.set(st.field[1], st.field[0], 1);
      }
    }
    // the radiographer: with the patient, or behind the screen
    if (tech) {
      const pat = npc ? { x: npc.pos.x, z: npc.pos.y } : null;
      if (s && s.tech === 'patient' && pat && st) {
        const spot = st.erect ? { x: pat.x - 0.62, z: pat.z + 0.5, rot: Math.atan2(0.62, -0.5), sit: false } : { x: Math.min(44.6, Math.max(42.2, (this.xrTargetPose?.tube.x ?? pat.x) - 0.15)), z: rig.table.z + 0.82, rot: PI, sit: false };
        this.send(tech, 'patient', spot, pat);
      } else this.send(tech, 'seat', { ...rig.seat, sit: false }, null);
    }
    // lines
    if (v && st && tech && s) {
      const view = st.views[s.view] ?? '';
      const key = `${s.phase}|${s.view}`;
      const say = (k: string, text: string | null) => {
        if (!text || v.said.has(k)) return;
        v.said.add(k);
        this.say(tech, text);
      };
      const nearPatient = Math.hypot(tech.pos.x - (npc?.pos.x ?? 0), tech.pos.y - (npc?.pos.y ?? 0)) < 1.6;
      if (s.phase === 'arrive' && nearPatient) say('arrive', XR_LINES.arrive(st, view));
      if (s.phase === 'position' && s.u > 0.25) say('position', XR_LINES.position(st, view));
      if (s.phase === 'expose' && s.u > 0.05) say(`hold${s.view}`, XR_LINES.hold(st, view));
      if (s.phase === 'expose' && s.u > 0.75) say(`done${s.view}`, XR_LINES.done1(st, view));
      if (s.phase === 'reposition' && s.u > 0.15) say(`repos${s.view}`, XR_LINES.reposition(st, view));
      if (s.phase === 'review') say('review', XR_LINES.review(st, view));
      if (s.phase === 'done' && nearPatient) say('done', XR_LINES.done(st, view));
      this.xrLastKey = key;
    }
    // exposure sounds: the anode's spin-up as the radiographer prepares, the tone at the exposure
    const prep = !!s?.prep;
    const beam = !!s?.beam;
    if (prep && !this.xrPrep) playSound('xray.expose', { at: { x: tp.x, y: tp.y, z: tp.z }, range: 22 });
    if (beam && !this.xrBeam) playSound('scan.beep', { at: { x: rig.seat.x, y: 1.0, z: rig.seat.z - 0.4 }, range: 14 });
    this.xrPrep = prep;
    this.xrBeam = beam;
    for (const m of rig.warn) setLamp(m, prep || beam);
    this.xrScreens(rig, now, s);
  }

  private poseXr(rig: XrRig) {
    const tp = this.xrDisp.tube;
    const x = Math.max(XR.railX[0] + 0.25, Math.min(XR.railX[1] - 0.25, tp.x));
    const z = Math.max(XR.railZ[0] + 0.15, Math.min(XR.railZ[1] - 0.15, tp.z));
    rig.bridge.position.x = x;
    rig.carriage.position.z = z;
    rig.yoke.position.y = tp.y;
    rig.head.rotation.z = tp.tilt * (PI / 2);
    rig.inner.scale.y = Math.max(0.05, XR.railY - 0.62 - (tp.y + YOKE - 0.02));
    rig.standCarriage.position.y = this.xrDisp.standY;
    rig.bucky.position.z = this.xrDisp.buckyZ;
    const b = rig.tubeHit.box;
    b.min.set(x - 0.32, tp.y - 0.4, z - 0.32);
    b.max.set(x + 0.32, tp.y + 0.3, z + 0.32);
    b.getCenter(rig.tubeHit.center);
  }

  private xrScreens(rig: XrRig, now: number, s: XrState | null) {
    const near = this.near(rig.seat.x, rig.seat.z, 14);
    const nowMs = performance.now();
    if (!near && this.xrScreenKey[0] !== '') return;
    if (nowMs - this.xrScreenAt < 120) return;
    this.xrScreenAt = nowMs;
    const v = this.xrVisit;
    const st = v ? this.xrSt : null;
    const state: XrState = s ?? { phase: 'idle', u: 0, view: 0, taken: 0, tube: { ...XR.park }, light: false, prep: false, beam: false, standY: 1.35, buckyX: 0, tech: 'booth', turn: 0 };
    const clock = clockAt(this.clockStart, now);
    const info = { clock, patient: v ? { name: lastFirst(v.name), id: accession('XR', v.pid) } : null, study: st, st: state };
    const keys = [`${clock}|${v?.id ?? ''}|${state.phase}|${state.view}|${state.taken}|${state.prep}|${state.beam}`, `${st?.code ?? ''}|${state.prep}|${state.beam}`];
    if (keys[0] !== this.xrScreenKey[0]) {
      this.xrScreenKey[0] = keys[0];
      drawXrConsole(rig.console.ctx, rig.console.canvas.width, rig.console.canvas.height, info);
      rig.console.tex.needsUpdate = true;
    }
    if (keys[1] !== this.xrScreenKey[1]) {
      this.xrScreenKey[1] = keys[1];
      drawXrGen(rig.gen.ctx, rig.gen.canvas.width, rig.gen.canvas.height, st, state);
      rig.gen.tex.needsUpdate = true;
    }
  }

  /** the player is near (x, z) on the ground floor */
  private near(x: number, z: number, r: number): boolean {
    if (this.d.level() !== 0) return false;
    const p = this.d.player();
    return Math.hypot(p.x - x, p.z - z) < r;
  }

  // ───────────────────────────── the radiographers ─────────────────────────────

  private send(t: Tech, key: string, dest: { x: number; z: number; rot: number; sit: boolean }, look: { x: number; z: number } | null) {
    t.look = look;
    if (t.at === key && Math.hypot(t.dest.x - dest.x, t.dest.z - dest.z) < 0.25) return;
    t.at = key;
    t.dest = dest;
    const p = this.d.nav.findPath(t.pos.x, t.pos.y, dest.x, dest.z);
    if (p && p.length) {
      t.path = p;
      t.ch.setPosture('stand');
    } else {
      // no route (blocked for a moment): there in a step
      t.path = null;
      this.settle(t);
    }
  }

  private settle(t: Tech) {
    t.pos.set(t.dest.x, t.dest.z);
    t.yaw = t.dest.rot;
    if (t.dest.sit) {
      t.ch.seatKind = 'desk';
      t.ch.setPosture('sit', undefined, 0.48);
    } else t.ch.setPosture('stand');
  }

  private say(t: Tech, text: string) {
    this.d.labels().ensure(t.id, '', '', null, undefined);
    this.d.labels().say(t.id, text, 6500);
  }

  private stepTechs(dt: number, time: number) {
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const ground = this.d.level() === 0;
    const pl = this.d.player();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    for (const t of this.techs) {
      let moving = false;
      if (t.path && t.path.length) {
        const tgt = t.path[0];
        const dx = tgt.x - t.pos.x;
        const dz = tgt.y - t.pos.y;
        const d = Math.hypot(dx, dz);
        const step = 1.2 * dt;
        if (d <= step) {
          t.pos.copy(tgt);
          t.path.shift();
          if (!t.path.length) {
            t.path = null;
            this.settle(t);
          }
        } else {
          t.pos.x += (dx / d) * step;
          t.pos.y += (dz / d) * step;
          t.yaw = lerpAngle(t.yaw, Math.atan2(dx, dz), Math.min(1, dt * 9));
        }
        moving = !!t.path;
      }
      // standing by the patient: turned to them, looking at them
      if (!moving && t.look && t.ch.posture === 'stand') {
        const want = Math.atan2(t.look.x - t.pos.x, t.look.z - t.pos.y);
        t.yaw = lerpAngle(t.yaw, want, Math.min(1, dt * 4));
        t.ch.lookYaw = 0;
      } else if (!moving && Math.hypot(pl.x - t.pos.x, pl.z - t.pos.y) < 3) {
        let rel = Math.atan2(pl.x - t.pos.x, pl.z - t.pos.y) - t.yaw;
        while (rel > PI) rel -= PI * 2;
        while (rel < -PI) rel += PI * 2;
        t.ch.lookYaw = Math.abs(rel) < 1.6 ? rel : 0;
      } else t.ch.lookYaw = 0;
      t.ch.root.position.set(t.pos.x, 0, t.pos.y);
      t.ch.root.rotation.y = t.yaw;
      if (!t.shadowsOff && (t.ch as Character & { ready?: boolean }).ready) {
        t.ch.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
        t.shadowsOff = true;
      }
      sphere.center.set(t.pos.x, 0.9, t.pos.y);
      const inView = ground && this.frustum.intersectsSphere(sphere);
      t.ch.root.visible = ground && inView;
      const dp = Math.hypot(pl.x - t.pos.x, pl.z - t.pos.y);
      const every = !inView ? 0.25 : dp > 18 ? 0.1 : 0;
      t.animAcc += dt;
      if (t.animAcc >= every) {
        t.ch.update(Math.min(t.animAcc, 0.5), time, moving, moving ? 1.2 : 0);
        t.animAcc = 0;
      }
    }
    this.placeLabels(ground);
  }

  private placeLabels(ground: boolean) {
    const labels = this.d.labels();
    const cam = this.d.camera;
    const w = this.d.container.clientWidth;
    const h = this.d.container.clientHeight;
    for (const t of this.techs) {
      if (!labels.ids().includes(t.id)) continue;
      headAnchor(t.ch, this.tmp);
      const dist = this.tmp.distanceTo(cam.position);
      const p = this.tmp.clone().project(cam);
      if (!ground || !(p.z < 1 && Math.abs(p.x) < 1.2 && p.y > -1.2 && p.y < 1.3)) {
        labels.place(t.id, 0, 0, false, false);
        continue;
      }
      let occluded = false;
      if (!this.d.cutaway()) {
        if (this.frameNo % 4 === 0 || !this.occl.has(t.id)) {
          this.ray.set(cam.position, this.tmp.clone().sub(cam.position).normalize());
          occluded = this.d.occluders.some((o) => {
            const hit = this.ray.ray.intersectBox(o, new THREE.Vector3());
            return !!hit && hit.distanceTo(cam.position) < dist - 0.2;
          });
          this.occl.set(t.id, occluded);
        } else occluded = this.occl.get(t.id)!;
      }
      labels.place(t.id, ((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h, false, !occluded && dist < 16, Math.max(0.72, Math.min(1.08, 1.25 - dist / 14)));
    }
  }

  // ───────────────────────────── World.ts hooks ─────────────────────────────

  /**
   * Where a patient in a suite is carried from their spot: on the CT couch, up with it and into the
   * gantry; at the chest stand, turned for the lateral. null: not ours (or walking).
   */
  carry(st: WorldNpc): { x: number; y: number; z: number; yaw: number } | null {
    if (st.path) return null;
    const ct = this.d.rig.ct;
    const cv = this.ctVisit;
    if (ct && cv && cv.id === st.v.id && cv.settled !== null && st.ch.posture === 'lie') {
      const r = ct.scanner.rot ?? 0;
      const d = this.ctDisp.travel;
      return { x: -d * Math.sin(r), y: (CT.topScan - CT.topLoad) * this.ctDisp.lift, z: -d * Math.cos(r), yaw: 0 };
    }
    const xv = this.xrVisit;
    if (xv && xv.id === st.v.id && xv.settled !== null && this.xrSt?.erect) return { x: 0, y: 0, z: 0, yaw: this.xrDisp.turn };
    return null;
  }

  /** tests (__acWorld.imaging()): each suite's study, step, couch, tube and lights; the radiographers */
  debug() {
    const ct = this.d.rig.ct;
    const xr = this.d.rig.xr;
    const now = this.tNow;
    const r2 = (v: number) => Math.round(v * 1000) / 1000;
    let cradle: Record<string, number> | null = null;
    if (ct) {
      const top = CT.topLoad + (CT.topScan - CT.topLoad) * this.ctDisp.lift;
      const r = ct.scanner.rot ?? 0;
      const head = CT.cradleHome - this.ctDisp.travel;
      const at = (z: number) => ({ x: ct.scanner.x + z * Math.sin(r), z: ct.scanner.z + z * Math.cos(r) });
      cradle = { top: r2(top), padTop: r2(top + CT.padT), headX: r2(at(head).x), headZ: r2(at(head).z), footZ: r2(at(head + CT.cradleLen).z), x: r2(ct.scanner.x), planeZ: r2(ct.scanner.z), boreY: CT.isoY, boreR: CT.boreR, frontZ: r2(ct.scanner.z + CT.gantryHalf), backZ: r2(ct.scanner.z - CT.gantryHalf) };
    }
    return {
      t: r2(now),
      scale: this.scale,
      ct: ct
        ? {
            visit: this.ctVisit ? { id: this.ctVisit.id, code: this.ctVisit.code, since: this.ctVisit.since, until: this.ctVisit.until, settled: this.ctVisit.settled } : null,
            phase: this.ctState.phase,
            u: r2(this.ctState.u),
            lift: r2(this.ctDisp.lift),
            travel: r2(this.ctDisp.travel),
            spin: r2(this.ctDisp.spin),
            beam: this.ctState.beam,
            lasers: this.ctState.lasers,
            breath: this.ctState.breath,
            contrast: r2(this.ctState.contrast),
            warn: ct.warn.map((m) => m.emissiveIntensity > 0.5),
            lamp: ct.beamLamp.emissiveIntensity > 0.5,
            line: ct.injector.line.visible,
            cradle,
            timeline: this.ctTl?.map((s) => ({ phase: s.phase, t0: r2(s.t0), t1: r2(s.t1) })) ?? null,
          }
        : null,
      xr: xr
        ? {
            visit: this.xrVisit ? { id: this.xrVisit.id, code: this.xrVisit.code, since: this.xrVisit.since, until: this.xrVisit.until, settled: this.xrVisit.settled } : null,
            phase: this.xrState?.phase ?? 'idle',
            view: this.xrState?.view ?? 0,
            taken: this.xrState?.taken ?? 0,
            tube: { x: r2(this.xrDisp.tube.x), y: r2(this.xrDisp.tube.y), z: r2(this.xrDisp.tube.z), tilt: r2(this.xrDisp.tube.tilt) },
            standY: r2(this.xrDisp.standY),
            turn: r2(this.xrDisp.turn),
            light: xr.light.visible,
            prep: this.xrPrep,
            beam: this.xrBeam,
            warn: xr.warn.map((m) => m.emissiveIntensity > 0.5),
            timeline: this.xrTl?.map((s) => ({ phase: s.phase, view: s.view ?? null, t0: r2(s.t0), t1: r2(s.t1) })) ?? null,
          }
        : null,
      techs: this.techs.map((t) => ({ id: t.id, x: r2(t.pos.x), z: r2(t.pos.y), yaw: r2(t.yaw), posture: t.ch.posture, walking: !!t.path, at: t.at })),
    };
  }

  dispose() {
    this.ctSounds?.spin.stop();
    this.ctSounds?.xray.stop();
    this.ctSounds?.table.stop();
    for (const t of this.techs) {
      this.d.scene.remove(t.ch.root);
      t.ch.dispose?.();
      this.d.labels().remove(t.id);
    }
    this.techs = [];
  }
}

/** a warning light's lens on or off */
function setLamp(m: THREE.MeshStandardMaterial, on: boolean) {
  const want = on ? 2.4 : 0.0;
  if (m.emissiveIntensity === want) return;
  m.emissiveIntensity = want;
  m.color.set(on ? '#ffffff' : '#5a1c1c');
}

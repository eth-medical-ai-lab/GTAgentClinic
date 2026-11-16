/**
 * Replays the waiting room's choreography (server/sim/ambient.ts) through the client's NPC
 * steering (client/src/world/steering.ts) without a browser: everyone in the plan follows their
 * timeline the way World.ts does (a new place → walk there; sitting → sit down on arrival), at
 * 60 Hz real time. Records where everyone is, for the checks in tests/steering.test.ts.
 */
import * as THREE from 'three';
import { LAYOUTS, type PropDef } from '../shared/layout';
import { SCENARIOS } from '../content/scenarios';
import { planAmbient, type Plan, type Seg } from '../server/sim/ambient';
import { NpcSteering, type SteerNpc } from '../client/src/world/steering';
import { footprintDistance, type Footprint } from '../client/src/world/pathfinding';
import { navWorld } from './navWorld';

export interface SimNpc extends SteerNpc {
  v: { id: string; posture: string; role: string; visible?: boolean; ambient?: { pace?: number; props?: string[] } };
  path: unknown[] | null;
  key: string;
  dest: { x: number; z: number; rot: number };
}

export interface Frame {
  t: number;
  pos: Map<string, { x: number; z: number; posture: string; yaw: number }>;
}

/** the chair footprint the ambient tests use: 0.5 wide × 0.48 deep, centred 2 cm forward of the prop's origin */
export function chairFootprint(c: PropDef): Footprint {
  const r = c.rot ?? 0;
  return { x: c.x + Math.sin(r) * 0.02, z: c.z + Math.cos(r) * 0.02, hw: 0.25, hd: 0.24, rot: r };
}

/**
 * someone's footprint: standing, a 0.25 m disc; seated (the chair is furniture), the legs out in front:
 * knees (0.3 m out, r 0.27) and feet (0.6 m out, r 0.28) — seated avatars' toe joints were measured
 * in the browser at up to 0.75 m in front of the seat and 0.27 m to the side
 */
export function personDiscs(p: { x: number; z: number; posture: string; yaw: number }): { x: number; z: number; r: number }[] {
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  if (p.posture === 'sit')
    return [
      { x: p.x + fx * 0.3, z: p.z + fz * 0.3, r: 0.27 },
      { x: p.x + fx * 0.6, z: p.z + fz * 0.6, r: 0.28 },
    ];
  return [{ x: p.x, z: p.z, r: 0.25 }];
}

const seatsOf = (layout = LAYOUTS.ed) => layout.props.filter((p) => p.kind === 'chair' || p.kind === 'stool');

export class WaitingRoomSim {
  readonly world = navWorld(LAYOUTS.ed);
  readonly steer: NpcSteering;
  readonly npcs = new Map<string, SimNpc>();
  readonly frames: Frame[] = [];
  readonly chairs = LAYOUTS.ed.props.filter((p) => p.kind === 'chair' && p.room === 'waiting');
  private seats = seatsOf();
  steerMs: number[] = [];

  constructor(readonly plan: Plan, readonly scale: number) {
    this.steer = new NpcSteering(this.world.grid, this.world.footprints);
    this.steer.onSit = (st) => this.finalPosture(st as SimNpc);
  }

  private seatNear(x: number, z: number) {
    let best: PropDef | undefined;
    let bd = 0.75;
    for (const s of this.seats) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { x: best.x, z: best.z, rot: best.rot ?? 0 } : undefined;
  }

  /** World.applyFinalPosture, for the parts that move: seated → in the seat; standing → facing the spot */
  private finalPosture(st: SimNpc) {
    const seat = st.v.posture === 'sit' ? this.seatNear(st.dest.x, st.dest.z) : undefined;
    if (seat) {
      st.pos.set(seat.x, seat.z);
      st.yaw = seat.rot;
      st.ch.posture = 'sit';
    } else {
      if (st.v.posture === 'sit') st.pos.set(st.dest.x, st.dest.z);
      st.yaw = st.dest.rot;
      st.ch.posture = st.v.posture === 'walk' ? 'stand' : st.v.posture;
    }
  }

  /** World.syncNpcs: the view at game time gt */
  private sync(gt: number, scene?: { lena: Seg[]; float: Seg[] }) {
    const segs: [string, Seg][] = [];
    for (const [id, tl] of this.plan.people) {
      const s = tl.at(gt);
      if (s) segs.push([id, s]);
    }
    if (scene) {
      // the triage nurse plays the scene (the stand-in's walk from the back is the same steering)
      const s = scene.lena.find((x) => gt >= x.t0 && gt < x.t1);
      if (s) segs.push(['rn_lena', s]);
    }
    const seen = new Set<string>();
    for (const [id, s] of segs) {
      seen.add(id);
      const key = `${s.at.x.toFixed(2)},${s.at.z.toFixed(2)}`;
      let st = this.npcs.get(id);
      if (!st) {
        st = { v: { id, posture: s.posture, role: 'visitor', ambient: { pace: s.pace, props: s.props } }, pos: new THREE.Vector2(s.at.x, s.at.z), yaw: s.at.rot, ch: { posture: s.posture === 'walk' ? 'stand' : s.posture }, path: null, key, dest: { ...s.at } };
        this.npcs.set(id, st);
        this.finalPosture(st);
        continue;
      }
      st.v = { ...st.v, posture: s.posture, ambient: { pace: s.pace, props: s.props } };
      if (st.key !== key) {
        st.key = key;
        st.dest = { ...s.at };
        const wheel = !!s.props?.includes('wheelchair');
        const seat = s.posture === 'sit' && !wheel ? this.seatNear(s.at.x, s.at.z) : undefined;
        const fromSeat = st.ch.posture === 'sit' && !wheel ? this.seatNear(st.pos.x, st.pos.y) : undefined;
        this.steer.walk(st, st.dest, { pace: s.pace ?? 1.25, seat, fromSeat, face: s.at.rot, timed: true, radius: wheel ? 0.4 : 0.25 });
        st.path = [st.dest];
        if (!s.pushedBy) st.ch.posture = 'stand';
      }
    }
    for (const id of [...this.npcs.keys()]) if (!seen.has(id) && !this.npcs.get(id)!.path) this.npcs.delete(id);
  }

  /** run real seconds [t0, t1) of game time gt = t·scale; records every `every`-th frame */
  run(t0: number, t1: number, o: { scene?: { lena: Seg[]; float: Seg[] }; every?: number; dt?: number } = {}) {
    const dt = o.dt ?? 1 / 60;
    let n = 0;
    for (let t = t0; t < t1; t += dt) {
      this.sync(t * this.scale, o.scene);
      const a = performance.now();
      this.steer.update(dt, this.npcs.values(), null);
      for (const st of this.npcs.values()) {
        if (!st.path) continue;
        const r = this.steer.step(st, dt);
        if (r.arrived) {
          st.path = null;
          this.finalPosture(st);
        }
      }
      this.steerMs.push(performance.now() - a);
      if (n++ % (o.every ?? 1) === 0) {
        const pos = new Map<string, { x: number; z: number; posture: string; yaw: number }>();
        for (const [id, st] of this.npcs) pos.set(id, { x: st.pos.x, z: st.pos.y, posture: st.path ? 'walk' : st.ch.posture, yaw: st.yaw });
        this.frames.push({ t, pos });
      }
    }
  }

  /** closest the walker came (body centre) to chair footprints and other people's footprints, over the recorded frames */
  clearances(id: string, from = 0, ownChair?: PropDef): { chair: number; chairAt: string; person: number; personAt: string } {
    let chair = Infinity;
    let chairAt = '';
    let person = Infinity;
    let personAt = '';
    const fps = this.chairs.filter((c) => c !== ownChair).map((c) => [c, chairFootprint(c)] as const);
    for (const f of this.frames) {
      if (f.t < from) continue;
      const me = f.pos.get(id);
      if (!me || me.posture !== 'walk') continue;
      for (const [c, fp] of fps) {
        const d = footprintDistance(fp, me.x, me.z);
        if (d < chair) {
          chair = d;
          chairAt = `${c.id} at t=${f.t.toFixed(2)} (${me.x.toFixed(2)}, ${me.z.toFixed(2)})`;
        }
      }
      for (const [oid, o] of f.pos) {
        if (oid === id) continue;
        for (const disc of personDiscs(o)) {
          const d = Math.hypot(me.x - disc.x, me.z - disc.z) - disc.r;
          if (d < person) {
            person = d;
            personAt = `${oid} (${o.posture}) at t=${f.t.toFixed(2)} (${me.x.toFixed(2)}, ${me.z.toFixed(2)})`;
          }
        }
      }
    }
    return { chair, chairAt, person, personAt };
  }
}

/** the night shift's ambient plan for a seed, and its call scenes (who is called, when, in real seconds) */
export function callScenes(seed: number, mapId = 'night_shift') {
  const sc = SCENARIOS[mapId];
  const plan = planAmbient({ seed, mapId, layout: LAYOUTS.ed, durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
  const scenes = plan.scenes.filter((s) => s.kind === 'call').map((s) => {
    const id = s.id.slice('call_'.length);
    const tl = plan.people.get(id)!;
    // stand-up: the first standing segment after the scene starts
    const up = tl.segs.find((g) => g.t0 >= s.t0 && g.posture === 'stand')!;
    const seated = tl.at(s.t0)!;
    return { scene: s, id, up, seat: seated, tUp: up.t0 / sc.defaultTimeScale, t1: s.t1 / sc.defaultTimeScale };
  });
  return { plan, scale: sc.defaultTimeScale, scenes };
}

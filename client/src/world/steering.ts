/**
 * NPC walking (World.ts stepNpcs) on routes from the NavGrid's NPC layer (pathfinding.ts):
 * - speed eases in and out (≈1 m/s² up, ~1.4 down), slows before turns and when arriving (the
 *   route's speed profile); the body turns with an eased, capped turn rate; at the end it turns
 *   to face the way the spot faces, and sitting down it turns round and backs into the seat
 * - people: a spatial hash (2 m cells) finds who is near; about ten times a second each walker
 *   looks 2.4 s ahead at anyone it would come too close to (walking, standing, seated with their
 *   legs out, the player) and picks a speed and a sidestep within its route's free room that
 *   keeps clear: oncoming people are passed on the right, slower ones overtaken on the left, and
 *   it pauses to let someone by. Held up for 1.5 s it re-plans round whoever is in the way.
 * - routes are planned the frame after they are asked for (everyone's new destination known by
 *   then, so nobody about to move is planned round), at most ~2.5 ms of planning a frame
 */
import type * as THREE from 'three';
import { NPC_CLEARANCE, ROUTE_DS, routeAt, type Disc, type Footprint, type NavGrid, type NpcNav, type Route, type SeatRef } from './pathfinding';

/** the slice of World's NPC state the steering reads and moves */
export interface SteerNpc {
  v: { id: string; posture: string; role: string; visible?: boolean; ambient?: { pushedBy?: string; act?: string; look?: string; urgent?: boolean; props?: string[] } };
  pos: THREE.Vector2;
  yaw: number;
  ch: { posture: string };
}

export interface WalkOpts {
  /** m/s */
  pace: number;
  /** sit down at the end, on this seat (approach in front of it, turn round, back in) */
  seat?: SeatRef;
  /** seated here now: the first step is straight out of it */
  fromSeat?: SeatRef;
  /** the way to face once there (radians, yaw); undefined keeps the walking direction */
  face?: number;
  /** timed by the server's choreography on the straight line (+25 %): a longer route walks up to 25 % faster */
  timed?: boolean;
  /** body radius (m): 0.25 on foot, ~0.4 in a wheelchair */
  radius?: number;
}

export interface StepResult {
  moving: boolean;
  speed: number;
  /** done: arrived, turned, sat down (or no route could be found: `failed`) */
  arrived: boolean;
  failed?: boolean;
}

type Phase = 'plan' | 'walk' | 'turn' | 'sit' | 'done';

interface Walker {
  id: string;
  phase: Phase;
  dest: { x: number; z: number };
  o: WalkOpts;
  /** a newer destination waiting to be planned (keeps walking the old route meanwhile) */
  next: { dest: { x: number; z: number }; o: WalkOpts } | null;
  route: Route | null;
  s: number;
  /** sidestep off the route's line (m, + = right) and where it is heading */
  d: number;
  dT: number;
  v: number;
  pace: number;
  /** speed the people around allow (m/s) */
  cap: number;
  lastSf: number;
  yawRate: number;
  blocked: number;
  /** held up only by people standing or sitting still (they won't make way) */
  stillBlock: boolean;
  squeeze: number;
  planAt: number;
  avoidAt: number;
  replans: number;
  vx: number;
  vz: number;
  sitFrom: [number, number];
  sitTo: [number, number];
  sitT: number;
  failed: boolean;
}

/** someone in the way, for this frame */
interface Body {
  id: string;
  /** the NPC it belongs to (a seated person is two bodies: legs and feet) */
  owner: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  /** 0 walking, 1 standing, 2 seated (legs), 3 the player, 4 lying / crouched */
  kind: number;
  /** who gives way: the player 4, an emergency 3, staff 2, patients 1, the waiting room 0 */
  prio: number;
  partner?: string;
  still: boolean;
}

const ARRIVED: StepResult = { moving: false, speed: 0, arrived: true };
const HOLD: StepResult = { moving: false, speed: 0, arrived: false };
const HASH_CELL = 2;
const LOOK = 2.4;
const SF = [1, 0.7, 0.45, 0.2, 0];
const LAT = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// route lookups (uniform samples): index + fraction into scratch
let ri = 0;
let rf = 0;
function locate(r: Route, s: number) {
  const i = Math.min(r.n - 2, Math.max(0, Math.floor(s / ROUTE_DS)));
  const s0 = i * ROUTE_DS;
  const s1 = Math.min(r.length, (i + 1) * ROUTE_DS);
  ri = i;
  rf = s1 > s0 ? clamp((s - s0) / (s1 - s0), 0, 1) : 0;
}
const lerpAt = (a: Float32Array) => a[ri] + (a[ri + 1] - a[ri]) * rf;
/** position on the route at arc length s (on its exact lines and arcs), sidestepped d to the right, into out */
function pointAt(r: Route, s: number, d: number, out: { x: number; z: number; tx: number; tz: number }) {
  routeAt(r, s, out);
  // right of the walking direction: (-tz, tx)
  out.x -= out.tz * d;
  out.z += out.tx * d;
}

export interface SteerStats {
  frames: number;
  /** steering CPU per frame (ms): hash, avoidance, integration — route planning counted apart */
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  /** walkers moving, on average and at most */
  meanWalkers: number;
  maxWalkers: number;
  /** route planning: per route (ms), routes, re-plans when held up, walks with no route at all (stood still) */
  planMeanMs: number;
  planMaxMs: number;
  routes: number;
  replans: number;
  failed: number;
}

export class NpcSteering {
  readonly nav: NpcNav;
  private readonly grid: NavGrid;
  private walkers = new Map<string, Walker>();
  private queue: string[] = [];
  private npcs = new Map<string, SteerNpc>();
  private bodies: Body[] = [];
  private byId = new Map<string, Body>();
  private prev = new Map<string, [number, number]>();
  private hcols: number;
  private hrows: number;
  private head: Int32Array;
  private next: Int32Array = new Int32Array(64);
  private found: Body[] = [];
  private threats: Body[] = [];
  private clock = 0;
  private frameMs = 0;
  private ring = new Float32Array(600);
  private ringN = 0;
  private walkersNow = 0;
  private walkerSum = 0;
  private frames = 0;
  private maxMs = 0;
  private maxWalkers = 0;
  private replans = 0;
  private unroutable = 0;
  /** the last few walks that found no NPC route (debug): who, from, to, why */
  readonly misses: { id: string; from: [number, number]; to: [number, number]; why: string; fallback: boolean }[] = [];
  private scratch = { x: 0, z: 0, tx: 0, tz: 0 };
  /** avoidance scratch: the route ahead per speed, the others ahead, weights, my places */
  private future = new Float32Array(SF.length * 8 * 6);
  private tb = new Float32Array(12 * 8 * 2);
  private tw = new Float32Array(12 * 5);
  private myX = new Float32Array(8);
  private myZ = new Float32Array(8);
  private myTx = new Float32Array(8);
  private myTz = new Float32Array(8);
  /** called when a walker starts sitting down (World: put it in the seat's posture) */
  onSit: ((st: SteerNpc) => void) | null = null;
  /** the speed a walker may have at arc length s of route r (m/s; Infinity = any): curtains.ts holds it at a closed curtain */
  gate: ((id: string, r: Route, s: number, pace: number) => number) | null = null;
  /** while the gate holds a walker still: the way to face instead of along the route (toward the curtain's edge) */
  gateFace: ((id: string) => number | undefined) | null = null;

  constructor(grid: NavGrid, footprints: Footprint[] = []) {
    this.grid = grid;
    this.nav = grid.npcLayer(footprints);
    this.hcols = Math.ceil((grid.maxX - grid.minX) / HASH_CELL) + 1;
    this.hrows = Math.ceil((grid.maxZ - grid.minZ) / HASH_CELL) + 1;
    this.head = new Int32Array(this.hcols * this.hrows);
  }

  /** start walking to dest (planned next frame); keeps walking its current route meanwhile */
  walk(st: SteerNpc, dest: { x: number; z: number }, o: WalkOpts): void {
    const id = st.v.id;
    this.npcs.set(id, st);
    const w = this.walkers.get(id);
    if (w && w.phase === 'walk') w.next = { dest, o };
    else {
      this.walkers.set(id, {
        id, phase: 'plan', dest, o, next: null, route: null, s: 0, d: 0, dT: 0, v: 0, pace: o.pace, cap: Infinity, lastSf: 1, yawRate: w?.yawRate ?? 0,
        blocked: 0, stillBlock: false, squeeze: 0, planAt: -1e9, avoidAt: 0, replans: 0, vx: 0, vz: 0, sitFrom: [0, 0], sitTo: [0, 0], sitT: 0, failed: false,
      });
    }
    if (!this.queue.includes(id)) this.queue.push(id);
  }

  /** stop walking (removed, teleported, or pushed in a wheelchair now) */
  cancel(id: string): void {
    this.walkers.delete(id);
  }

  remove(id: string): void {
    this.walkers.delete(id);
    this.npcs.delete(id);
    this.prev.delete(id);
  }

  /** the route an NPC is walking (debug, plots) */
  routeOf(id: string): Route | null {
    return this.walkers.get(id)?.route ?? null;
  }

  /**
   * once a frame, before stepping: who is where (spatial hash), and the routes asked for. The player
   * may be bigger than someone on foot (r: in a wheelchair); `obstacles` are things that stand still
   * and move now and then (a parked wheelchair), walked round like someone seated.
   */
  update(dt: number, npcs: Iterable<SteerNpc>, player: { x: number; z: number; r?: number } | null, obstacles: readonly { x: number; z: number; r: number }[] = []): void {
    // last frame's cost (update + every step) into the stats
    if (this.frames > 0) {
      this.ring[this.ringN++ % this.ring.length] = this.frameMs;
      this.maxMs = Math.max(this.maxMs, this.frameMs);
      this.walkerSum += this.walkersNow;
      this.maxWalkers = Math.max(this.maxWalkers, this.walkersNow);
    }
    this.frames++;
    this.walkersNow = 0;
    const t0 = now();
    this.clock += dt;
    this.collect(npcs, player, dt, obstacles);
    this.frameMs = now() - t0;
    // planning (not part of the per-frame steering cost; it has its own stats)
    const p0 = now();
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const w = this.walkers.get(id);
      const st = this.npcs.get(id);
      if (w && st) this.planWalker(w, st);
      if (now() - p0 > 2.5) break;
    }
  }

  private collect(npcs: Iterable<SteerNpc>, player: { x: number; z: number; r?: number } | null, dt: number, obstacles: readonly { x: number; z: number; r: number }[]) {
    const bodies = this.bodies;
    bodies.length = 0;
    this.byId.clear();
    const inv = dt > 1e-4 ? 1 / dt : 0;
    for (const st of npcs) {
      const v = st.v;
      if (v.visible === false) continue;
      this.npcs.set(v.id, st);
      const x = st.pos.x;
      const z = st.pos.y;
      const p = this.prev.get(v.id);
      let vx = p ? (x - p[0]) * inv : 0;
      let vz = p ? (z - p[1]) * inv : 0;
      if (p) {
        p[0] = x;
        p[1] = z;
      } else this.prev.set(v.id, [x, z]);
      if (vx * vx + vz * vz > 16) vx = vz = 0; // a teleport, not a walk
      const w = this.walkers.get(v.id);
      const amb = v.ambient;
      const walking = !!w && w.phase === 'walk';
      if (walking) {
        vx = w.vx;
        vz = w.vz;
      }
      const prio = amb?.urgent ? 3 : v.role === 'visitor' || v.role === 'patient' ? (v.role === 'patient' ? 1 : 0) : 2;
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      const b: Body = { id: v.id, owner: v.id, x, z, vx, vz, r: 0.25, kind: walking ? 0 : 1, prio, still: !walking && vx * vx + vz * vz < 0.04 };
      const wheel = !!amb?.props?.includes('wheelchair');
      if (wheel && st.ch.posture === 'sit') {
        // in a wheelchair: the chair and the legs on its footrests
        b.x = x + fx * 0.15;
        b.z = z + fz * 0.15;
        b.r = 0.42;
        if (!walking) b.kind = 2;
      } else if (st.ch.posture === 'sit' && !walking) {
        // the chair is furniture already: the legs out in front are the obstacle — knees, then feet
        // (toe joints measured up to 0.75 m in front of the seat and 0.27 m to the side)
        b.x = x + fx * 0.3;
        b.z = z + fz * 0.3;
        b.r = 0.27;
        b.kind = 2;
        const feet: Body = { ...b, id: `${v.id}~feet`, x: x + fx * 0.6, z: z + fz * 0.6, r: 0.28 };
        bodies.push(feet);
      } else if (st.ch.posture === 'lie' && !walking) {
        if (amb?.act !== 'floor' && amb?.act !== 'come_round') continue; // on a bed: the bed is the obstacle
        b.x = x + fx * 0.75;
        b.z = z + fz * 0.75;
        b.r = 0.65;
        b.kind = 4;
      } else if (amb?.act === 'crouch' || amb?.act === 'crouch_talk') {
        b.r = 0.35;
        b.kind = 4;
      }
      if (amb?.pushedBy) b.partner = amb.pushedBy;
      // hands on someone (kneeling by them, holding their legs up, steadying them): close enough to touch them
      else if (amb?.look && (amb.act === 'hold_legs' || amb.act === 'steady' || amb.act === 'crouch_talk' || amb.act === 'crouch')) b.partner = amb.look;
      bodies.push(b);
      this.byId.set(v.id, b);
    }
    // a pusher and the wheelchair are one
    for (const b of bodies) if (b.partner) {
      const q = this.byId.get(b.partner);
      if (q) q.partner = b.owner;
    }
    if (player) {
      const p = this.prev.get('__player');
      const vx = p ? (player.x - p[0]) * inv : 0;
      const vz = p ? (player.z - p[1]) * inv : 0;
      if (p) {
        p[0] = player.x;
        p[1] = player.z;
      } else this.prev.set('__player', [player.x, player.z]);
      const fast = vx * vx + vz * vz > 64;
      const b: Body = { id: '__player', owner: '__player', x: player.x, z: player.z, vx: fast ? 0 : vx, vz: fast ? 0 : vz, r: player.r ?? 0.25, kind: 3, prio: 4, still: fast || vx * vx + vz * vz < 0.04 };
      bodies.push(b);
      this.byId.set(b.id, b);
    }
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const b: Body = { id: `__obstacle${i}`, owner: `__obstacle${i}`, x: o.x, z: o.z, vx: 0, vz: 0, r: o.r, kind: 2, prio: 4, still: true };
      bodies.push(b);
      this.byId.set(b.id, b);
    }
    // spatial hash
    this.head.fill(-1);
    if (this.next.length < bodies.length) this.next = new Int32Array(bodies.length * 2);
    for (let i = 0; i < bodies.length; i++) {
      const h = this.cellOf(bodies[i].x, bodies[i].z);
      this.next[i] = this.head[h];
      this.head[h] = i;
    }
  }

  private cellOf(x: number, z: number): number {
    const c = clamp(Math.floor((x - this.grid.minX) / HASH_CELL), 0, this.hcols - 1);
    const r = clamp(Math.floor((z - this.grid.minZ) / HASH_CELL), 0, this.hrows - 1);
    return r * this.hcols + c;
  }

  /** Reuse the walking system's actual body, knee, foot and wheelchair footprints. */
  playerObstacles(out: Disc[]) {
    out.length = 0;
    for (const b of this.bodies) {
      if (b.kind !== 3) out.push(b); // exclude the player’s own body
    }
  }

  /** bodies within R of (x, z) */
  private query(x: number, z: number, R: number): Body[] {
    const out = this.found;
    out.length = 0;
    const c0 = clamp(Math.floor((x - R - this.grid.minX) / HASH_CELL), 0, this.hcols - 1);
    const c1 = clamp(Math.floor((x + R - this.grid.minX) / HASH_CELL), 0, this.hcols - 1);
    const r0 = clamp(Math.floor((z - R - this.grid.minZ) / HASH_CELL), 0, this.hrows - 1);
    const r1 = clamp(Math.floor((z + R - this.grid.minZ) / HASH_CELL), 0, this.hrows - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (let i = this.head[r * this.hcols + c]; i !== -1; i = this.next[i]) {
          const b = this.bodies[i];
          if ((b.x - x) * (b.x - x) + (b.z - z) * (b.z - z) <= R * R) out.push(b);
        }
      }
    }
    return out;
  }

  /** people to plan round: everyone standing, sitting or lying still; held up, also slow walkers nearby */
  private peopleFor(w: Walker, x: number, z: number, held: boolean): Disc[] {
    const me = this.byId.get(w.id);
    const out: Disc[] = [];
    for (const b of this.bodies) {
      if (b.owner === w.id || b.owner === me?.partner) continue;
      const pending = this.walkers.get(b.owner);
      if (pending && (pending.phase === 'plan' || pending.next)) continue; // about to move: not an obstacle to plan round
      const slow = b.vx * b.vx + b.vz * b.vz < 0.35 * 0.35;
      if (b.kind === 0) {
        // nearly there (a step out of a chair, the last metre): plan round where they will stand
        const pw = this.walkers.get(b.owner);
        const r = pw?.route;
        if (r && r.length - pw.s < 1.5) out.push({ x: r.end.x, z: r.end.z, r: b.r });
        if (!(held && slow && Math.hypot(b.x - x, b.z - z) < 5)) continue;
      }
      if (b.kind === 3 && !b.still && !held) continue;
      out.push({ x: b.x, z: b.z, r: b.r });
    }
    return out;
  }

  private planWalker(w: Walker, st: SteerNpc) {
    const held = w.phase === 'walk' && !w.next; // a re-plan because someone is in the way
    if (w.next) {
      w.dest = w.next.dest;
      w.o = w.next.o;
      w.next = null;
    }
    const o = w.o;
    const x = st.pos.x;
    const z = st.pos.y;
    const clearance = Math.max(NPC_CLEARANCE, (o.radius ?? 0.25) + 0.05);
    const opts = { clearance, seat: o.seat, fromSeat: o.fromSeat };
    let route = this.nav.route(x, z, w.dest.x, w.dest.z, { ...opts, people: this.peopleFor(w, x, z, held) });
    // boxed in by people (or someone stands on the spot): plan round the furniture and the things parked
    // about (the corridor wheelchair: a route through it stalls against it), else the furniture only
    if (!route) route = this.nav.route(x, z, w.dest.x, w.dest.z, { ...opts, people: this.bodies.filter((b) => b.id.startsWith('__obstacle')).map((b) => ({ x: b.x, z: b.z, r: b.r })) });
    if (!route) route = this.nav.route(x, z, w.dest.x, w.dest.z, opts);
    // a tight spot (between the desk chairs of the nurses' station): squeeze through at 0.2 m
    if (!route) route = this.nav.route(x, z, w.dest.x, w.dest.z, { ...opts, clearance: 0.2 });
    if (!route) {
      const why = this.nav.lastFail;
      const p = this.grid.findPath(x, z, w.dest.x, w.dest.z);
      if (p && p.length) route = this.nav.fallbackRoute(p, x, z);
      this.misses.push({ id: w.id, from: [x, z], to: [w.dest.x, w.dest.z], why, fallback: !!route });
      if (this.misses.length > 20) this.misses.shift();
    }
    w.planAt = this.clock;
    if (!route) {
      this.unroutable++;
      w.phase = 'done';
      w.failed = true;
      return;
    }
    w.route = route;
    w.s = 0;
    w.d = 0;
    w.dT = 0;
    w.blocked = 0;
    w.phase = 'walk';
    w.pace = o.pace;
    if (o.timed) {
      const allowed = Math.hypot(w.dest.x - x, w.dest.z - z) * 1.25 + 0.4;
      w.pace = o.pace * clamp(route.length / Math.max(0.5, allowed), 1, 1.25);
    }
  }

  /** advance one walking NPC (World calls this for each NPC with a path) */
  step(st: SteerNpc, dt: number): StepResult {
    const t0 = now();
    const w = this.walkers.get(st.v.id);
    let res: StepResult;
    if (!w) res = ARRIVED;
    else {
      switch (w.phase) {
        case 'plan':
          res = HOLD;
          break;
        case 'walk':
          res = this.walkStep(w, st, dt);
          this.walkersNow++;
          break;
        case 'turn':
          res = this.turnStep(w, st, dt);
          break;
        case 'sit':
          res = this.sitStep(w, st, dt);
          break;
        default:
          res = w.failed ? { ...ARRIVED, failed: true } : ARRIVED;
          this.walkers.delete(w.id);
      }
    }
    this.frameMs += now() - t0;
    return res;
  }

  private walkStep(w: Walker, st: SteerNpc, dt: number): StepResult {
    const r = w.route!;
    if (this.clock >= w.avoidAt) {
      this.avoid(w, st);
      w.avoidAt = this.clock + 0.09 + hashId(w.id) * 0.03;
    }
    const L = r.length;
    const exempt = w.s < r.head || w.s >= r.tail;
    locate(r, w.s);
    const vProfile = lerpAt(r.vmax);
    let vT = Math.min(w.pace, vProfile, w.cap);
    // face the way the route goes before striding off (a start, a sharp corner)
    const sc = this.scratch;
    pointAt(r, Math.min(L, w.s + 0.15), 0, sc);
    const want = Math.atan2(sc.tx, sc.tz);
    const off = Math.abs(wrap(want - st.yaw));
    if (off > 0.5) vT = Math.min(vT, 0.12 + 0.55 * Math.max(0, Math.cos(off)));
    // the stop profile only reaches zero at the very end: creep the last millimetres
    else if (L - w.s < 0.3 && w.cap > 0.1) vT = Math.max(vT, 0.035);
    if (this.gate) vT = Math.min(vT, this.gate(w.id, r, w.s, w.pace));
    // speed: eased in and out; brakes harder only for someone in the way
    const up = 1.0;
    const down = w.cap < w.v ? 2.4 : 1.4;
    w.v += clamp(vT - w.v, -down * dt, up * dt);
    if (w.v < 0) w.v = 0;
    w.s = Math.min(L, w.s + w.v * dt);
    // sidestep, within the free room on that side
    locate(r, w.s);
    const rl = exempt ? 0 : lerpAt(r.roomL);
    const rr = exempt ? 0 : lerpAt(r.roomR);
    const target = clamp(w.dT, -rl, rr);
    const rate = 0.5 * Math.max(w.v, 0.3);
    w.d += clamp(target - w.d, -rate * dt, rate * dt);
    w.d = clamp(w.d, -rl, rr);
    pointAt(r, w.s, w.d, sc);
    const ox = st.pos.x;
    const oz = st.pos.y;
    st.pos.set(sc.x, sc.z);
    const inv = dt > 1e-4 ? 1 / dt : 0;
    w.vx = (sc.x - ox) * inv;
    w.vz = (sc.z - oz) * inv;
    const sp = Math.hypot(w.vx, w.vz);
    const held = sp > 0.05 ? undefined : this.gateFace?.(w.id);
    if (sp > 0.05) this.turnToward(w, st, Math.atan2(w.vx, w.vz), dt, 4.5);
    else if (held !== undefined) this.turnToward(w, st, held, dt, 4.5);
    else if (off > 0.3) this.turnToward(w, st, want, dt, 4.5);
    // held up by someone: re-plan round them after 1.5 s; right at the end, call it arrived
    if (w.cap < 0.18 * w.pace && L - w.s > 0.05) w.blocked += dt;
    else w.blocked = Math.max(0, w.blocked - dt * 2);
    const face = w.o.seat ? w.o.seat.rot : w.o.face;
    if (w.blocked > 1.0 && L - w.s < 0.8 && !w.o.seat) {
      // someone stands on the spot: this is close enough
      w.v = 0;
      w.vx = w.vz = 0;
      w.phase = face !== undefined ? 'turn' : 'done';
      return HOLD;
    } else if (w.blocked > (w.stillBlock ? 0.6 : 1.5) && this.clock - w.planAt > 1.0 && !w.next && !this.queue.includes(w.id)) {
      // someone standing still won't make way: walk round them soon; someone walking gets a moment to pass
      this.replans++;
      w.replans++;
      w.blocked = 0;
      w.planAt = this.clock;
      // still held up after re-planning: squeeze past (shoulders brushing) for a moment
      if (w.replans >= 2) w.squeeze = 2.5;
      this.queue.push(w.id);
    }
    if (w.squeeze > 0) w.squeeze -= dt;
    if (L - w.s <= 0.002) {
      w.v = 0;
      w.vx = w.vz = 0;
      if (face !== undefined && !w.failed) {
        w.phase = 'turn';
        return { moving: true, speed: sp, arrived: false };
      }
      w.phase = 'done';
      return { moving: false, speed: 0, arrived: false };
    }
    return { moving: sp > 0.06 || w.v > 0.06, speed: Math.max(sp, w.v), arrived: false };
  }

  private turnStep(w: Walker, st: SteerNpc, dt: number): StepResult {
    const face = w.o.seat ? w.o.seat.rot : (w.o.face ?? st.yaw);
    this.turnToward(w, st, face, dt, 3.6);
    if (Math.abs(wrap(face - st.yaw)) < 0.01 && Math.abs(w.yawRate) < 0.3) {
      st.yaw = face;
      w.yawRate = 0;
      if (w.o.seat) {
        // sit: World puts it in the seat's posture (and position); it backs in over ~0.65 s
        w.sitFrom = [st.pos.x, st.pos.y];
        this.onSit?.(st);
        w.sitTo = [st.pos.x, st.pos.y];
        st.pos.set(w.sitFrom[0], w.sitFrom[1]);
        w.sitT = 0;
        w.phase = 'sit';
      } else w.phase = 'done';
    }
    return HOLD;
  }

  private sitStep(w: Walker, st: SteerNpc, dt: number): StepResult {
    w.sitT = Math.min(1, w.sitT + dt / 0.65);
    const e = w.sitT * w.sitT * (3 - 2 * w.sitT);
    st.pos.set(w.sitFrom[0] + (w.sitTo[0] - w.sitFrom[0]) * e, w.sitFrom[1] + (w.sitTo[1] - w.sitFrom[1]) * e);
    if (w.sitT >= 1) w.phase = 'done';
    return HOLD;
  }

  /** body yaw toward target: eased in (capped angular acceleration) and out (proportional), capped rate */
  private turnToward(w: Walker, st: SteerNpc, target: number, dt: number, maxRate: number) {
    const diff = wrap(target - st.yaw);
    const want = clamp(diff * 9, -maxRate, maxRate);
    w.yawRate += clamp(want - w.yawRate, -20 * dt, 20 * dt);
    let step = w.yawRate * dt;
    if (Math.abs(step) > Math.abs(diff)) {
      step = diff;
      w.yawRate = 0;
    }
    st.yaw = wrap(st.yaw + step);
  }

  /**
   * Who is about to be in the way, and what to do about it: simulate a few speeds × sidesteps
   * 2.4 s ahead along the route against everyone near (moving at their current velocity), keep
   * the cheapest — progress lost, sidestep, closeness (worse the sooner), and the rule of the road.
   */
  private avoid(w: Walker, st: SteerNpc) {
    const r = w.route!;
    const x = st.pos.x;
    const z = st.pos.y;
    const me = this.byId.get(w.id);
    const myR = w.o.radius ?? 0.25;
    const pace = w.pace;
    const sc = this.scratch;
    pointAt(r, w.s, 0, sc);
    const mtx = sc.tx;
    const mtz = sc.tz;
    const near = this.query(x, z, 3.4);
    const threats = this.threats;
    threats.length = 0;
    for (const b of near) {
      if (b.owner === w.id || b.owner === me?.partner) continue;
      const rx = b.x - x;
      const rz = b.z - z;
      const R = myR + b.r + 0.45;
      if (rx * rx + rz * rz < R * R) {
        threats.push(b);
        continue;
      }
      const ux = mtx * pace - b.vx;
      const uz = mtz * pace - b.vz;
      const uu = ux * ux + uz * uz;
      if (uu < 1e-4) continue;
      const tca = (rx * ux + rz * uz) / uu;
      if (tca < 0 || tca > LOOK + 0.3) continue;
      const cx = rx - ux * tca;
      const cz = rz - uz * tca;
      if (cx * cx + cz * cz < (R + 0.25) * (R + 0.25)) threats.push(b);
    }
    if (!threats.length) {
      w.cap = Infinity;
      w.dT = 0;
      w.lastSf = 1;
      w.stillBlock = false;
      return;
    }
    // a crowded aisle (a seated person is knees and feet): the nearest dozen matter
    if (threats.length > 12) threats.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
    const exempt = w.s < r.head || w.s >= r.tail;
    const prioMe = me?.prio ?? 0;
    const hMe = hashId(w.id);
    const squeeze = w.squeeze > 0;
    const K = 8;
    const dtK = LOOK / K;
    // where the route goes in the next LOOK seconds at each speed: point, tangent, free room each side
    const F = this.future;
    for (let si = 0; si < SF.length; si++) {
      const v = pace * SF[si];
      for (let k = 0; k < K; k++) {
        const s = Math.min(r.length, w.s + v * (k + 1) * dtK);
        routeAt(r, s, sc);
        locate(r, s);
        const o = (si * K + k) * 6;
        F[o] = sc.x;
        F[o + 1] = sc.z;
        F[o + 2] = sc.tx;
        F[o + 3] = sc.tz;
        F[o + 4] = lerpAt(r.roomR);
        F[o + 5] = lerpAt(r.roomL);
      }
    }
    // where they will be then, and how much each one matters
    const nT = Math.min(threats.length, 12);
    const TB = this.tb;
    const tw = this.tw;
    for (let j = 0; j < nT; j++) {
      const b = threats[j];
      for (let k = 0; k < K; k++) {
        TB[(j * K + k) * 2] = b.x + b.vx * (k + 1) * dtK;
        TB[(j * K + k) * 2 + 1] = b.z + b.vz * (k + 1) * dtK;
      }
      const walker = b.kind === 0 || b.kind === 3;
      // politeness: give way to the player, an emergency, staff; between equals, a coin decided by name
      tw[j * 5] = b.prio > prioMe ? 1.5 : b.prio < prioMe ? 0.7 : hMe < hashId(b.id) ? 1.2 : 0.85;
      tw[j * 5 + 1] = squeeze ? 0.06 : walker ? 0.3 : 0.22;
      tw[j * 5 + 2] = squeeze ? -0.04 : 0.06;
      // the rule of the road: oncoming (1) pass on my left, slower ahead (2) overtake on the left
      const along = b.vx * mtx + b.vz * mtz;
      const sp = Math.hypot(b.vx, b.vz);
      tw[j * 5 + 3] = b.kind !== 0 ? 0 : sp > 0.3 && along < -0.5 * sp ? 1 : sp > 0.2 && along > 0.5 * sp && along < pace * 0.9 ? 2 : 0;
      tw[j * 5 + 4] = myR + b.r;
    }
    const myX = this.myX;
    const myZ = this.myZ;
    const myTx = this.myTx;
    const myTz = this.myTz;
    let best = Infinity;
    let bestSf = 1;
    let bestD = 0;
    for (let si = 0; si < SF.length; si++) {
      const sf = SF[si];
      const v = pace * sf;
      const rate = 0.5 * Math.max(v, 0.3);
      for (const lt of LAT) {
        if (exempt && lt !== 0) continue;
        let cost = 1.4 * (1 - sf) * (1 - sf) + 0.5 * Math.abs(lt) + 0.6 * Math.abs(lt - w.dT) + 0.25 * Math.abs(sf - w.lastSf);
        // my places for this speed and sidestep (within the room on that side)
        for (let k = 0; k < K; k++) {
          const o = (si * K + k) * 6;
          const room = lt >= 0 ? F[o + 4] : -F[o + 5];
          const goal = lt >= 0 ? Math.min(lt, room) : Math.max(lt, room);
          const t = (k + 1) * dtK;
          const d = w.d + clamp(goal - w.d, -rate * t, rate * t);
          myX[k] = F[o] - F[o + 3] * d;
          myZ[k] = F[o + 1] + F[o + 2] * d;
          myTx[k] = F[o + 2];
          myTz[k] = F[o + 3];
        }
        for (let j = 0; j < nT && cost < best; j++) {
          const pol = tw[j * 5];
          const comfort = tw[j * 5 + 1];
          const hard = tw[j * 5 + 2];
          const rule = tw[j * 5 + 3];
          const rr = tw[j * 5 + 4];
          let minGap = Infinity;
          let sideAtMin = 0;
          for (let k = 0; k < K; k++) {
            const bx = TB[(j * K + k) * 2];
            const bz = TB[(j * K + k) * 2 + 1];
            const gap = Math.hypot(myX[k] - bx, myZ[k] - bz) - rr;
            const wt = 1 - ((k + 1) * dtK) / (LOOK * 1.4);
            if (gap < comfort) cost += (comfort - gap) * (comfort - gap) * 14 * wt * pol;
            if (gap < hard) cost += (k < 3 ? 40 : 14) * pol;
            if (gap < minGap) {
              minGap = gap;
              // which side of my walking direction they are on when we are closest (+ = my right)
              sideAtMin = (bx - myX[k]) * -myTz[k] + (bz - myZ[k]) * myTx[k];
            }
          }
          if (rule && minGap < 0.9) {
            if (rule === 1 && sideAtMin > 0) cost += 0.9;
            else if (rule === 2 && sideAtMin < 0 && sf > 0.8) cost += 0.35;
          }
        }
        if (cost < best) {
          best = cost;
          bestSf = sf;
          bestD = lt;
        }
      }
    }
    w.lastSf = bestSf;
    w.cap = bestSf >= 0.999 ? Infinity : pace * bestSf;
    w.dT = bestD;
    w.stillBlock = threats.every((b) => b.kind !== 0 && (b.kind !== 3 || b.still));
  }

  /** per-frame steering cost and planning statistics */
  stats(planning?: NpcNav['stats']): SteerStats {
    const n = Math.min(this.ringN, this.ring.length);
    const vals = Array.from(this.ring.subarray(0, n)).sort((a, b) => a - b);
    const ps = planning ?? this.nav.stats;
    return {
      frames: this.frames,
      meanMs: n ? vals.reduce((s, v) => s + v, 0) / n : 0,
      p95Ms: n ? vals[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
      maxMs: this.maxMs,
      meanWalkers: this.frames > 1 ? this.walkerSum / (this.frames - 1) : 0,
      maxWalkers: this.maxWalkers,
      planMeanMs: ps.routes ? ps.ms / ps.routes : 0,
      planMaxMs: ps.maxMs,
      routes: ps.routes,
      replans: this.replans,
      failed: this.unroutable,
    };
  }

  /** reset the statistics (a fresh measuring window) */
  resetStats(): void {
    this.ringN = 0;
    this.maxMs = 0;
    this.walkerSum = 0;
    this.maxWalkers = 0;
    this.frames = 0;
  }
}

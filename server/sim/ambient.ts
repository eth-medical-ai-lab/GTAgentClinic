/**
 * Ambient life: the waiting-room crowd, their small talk, the triage nurse calling names, and at
 * most one emergency per shift (a vasovagal faint at the walk-in door). Content: content/ambient.ts.
 *
 * Isolation — agent runs are research data, so none of this may move a clinical number:
 *  - its own seed stream (hashSeed(seed, 'ambient', map)); never the session's rng, timers or seq
 *  - it never writes session state. Staff it "borrows" for a moment (the triage nurse, security,
 *    the clerk) change only in the 3D view, as an NpcView overlay; their StaffState, tasks and
 *    location are untouched, and the triage nurse is borrowed only while she is idle at her desk
 *    and you are not with her (otherwise a stand-in nurse who exists only here comes instead)
 *  - nothing reaches the agent API or the action space; speech events it emits are marked ambient
 *  - the plan is made once at session start, so the same seed gives the same schedule; view(t)
 *    and the spoken lines are functions of game time (plus which nurse a scene got, latched)
 *
 * Choreography runs in game time paced by the map's default time scale, so a minute of drama
 * takes about a real minute at the default speed.
 */
import { AMBIENT, AFTERMATH, COLLAPSE_LINES, COLLAPSE_PAGE, COUPLE, DESK, DOG, FAMILY, FLOAT_RN, INJURIES, MASK_LINE, PERSONAS, PHONE_CALL, REGISTER, STRANGERS, TRIAGE, type AmbientDef, type CollapseRole, type ConvoScript, type CrowdPersona } from '../../content/ambient';
import type { TtsVoice } from '../../content/types';
import type { LayoutDef } from '../../shared/layout';
import type { AmbientAct, AmbientCue, AmbientNpcView, AmbientProp, Emotion, LocationId, NpcView, Posture } from '../../shared/types';
import { hashSeed, Rng } from './rng';
import { routeWalkSecs } from './route';

const M = 60;

export interface Place {
  x: number;
  z: number;
  rot: number;
}

/** one stretch of time an ambient person spends doing one thing in one place */
export interface Seg {
  t0: number;
  t1: number;
  room: LocationId;
  at: Place;
  posture: Posture;
  act?: AmbientAct;
  pace?: number;
  look?: string;
  /** replaces the persona's own props for this stretch */
  props?: AmbientProp[];
  pushedBy?: string;
  legsUp?: boolean;
  urgent?: boolean;
  emotion?: Emotion;
}

/** a line someone says (voiced lines become speech events; murmurs only move the mouth) */
export interface Line {
  t: number;
  /** npc id, or a role resolved when the scene runs ('nurse') */
  who: string;
  text: string;
  voiced: boolean;
  volume: number;
  /** seconds of game time the mouth moves */
  dur: number;
  scene?: string;
}

export interface Cue {
  t: number;
  who: string;
  kind: AmbientCue;
  text?: string;
}

/** a scene that needs the triage nurse: played by her if she is free when it starts, else by the stand-in */
export interface NurseScene {
  id: string;
  t0: number;
  t1: number;
  kind: 'call' | 'collapse';
  lena: Seg[];
  float: Seg[];
}

// ───────────────────────────── geometry (ED layout, waiting room x 0–10, z 15–24) ─────────────────────────────

const PI = Math.PI;
/** just outside the walk-in door, in the dark of the drop-off lane */
const OUTSIDE: Place = { x: 5.1, z: 27.6, rot: PI };
/** inside the corridor door, where the nurse stands to call the next name */
const CALL_SPOT: Place = { x: 4.7, z: 15.95, rot: 0 };
/** a step in front of her, where the called person meets her */
const MEET_SPOT: Place = { x: 4.3, z: 16.55, rot: PI };
/** "through to the back": far along the main corridor, out of sight of the waiting room */
const BACK: Place = { x: 30.5, z: 13.7, rot: PI / 2 };
/** the stand-in nurse comes from (and goes back to) the treatment area */
const FLOAT_HOME: Place = { x: 26.5, z: 13.6, rot: -PI / 2 };
/** the corridor outside triage, where the triage nurse peels off back to her desk */
const TRIAGE_DOOR: Place = { x: 12.3, z: 14.4, rot: PI };
/** her desk chair (shared/layout.ts tr_desk_chair), facing her screen */
const LENA_DESK: Place = { x: 13.6, z: 19.0, rot: PI / 2 };
/** out of triage to the call spot: through the triage door, along the corridor, in at the waiting room's door */
const LENA_OUT: Place[] = [LENA_DESK, { x: 12.3, z: 16.0, rot: PI }, TRIAGE_DOOR, { x: 4.85, z: 13.9, rot: 0 }, CALL_SPOT];
/** at the registration counter's public ledge (x ≈ 7.89), facing the clerk behind it */
const DESK_SPOT: Place = { x: 7.5, z: 20.7, rot: PI / 2 };
const DESK_QUEUE: Place = { x: 6.9, z: 21.2, rot: PI / 2 };
/** in front of the vending machine (its face is x ≈ 0.9), clear of the wall chair at (1.75, 23.45) */
const VENDING: Place = { x: 1.4, z: 22.7, rot: -PI / 2 };
/**
 * Standing up from a chair, people step forward off it first: 0.72 m in front of the chair's centre
 * (its front edge is 0.26 m out, a standing body ≈ 0.22 m deep, plus 0.25 m clear). Every other
 * standing place in this file keeps the same clearance from every chair, wall chairs included.
 */
const STEP_OFF = 0.72;
/** security stands beside the walk-in door, not in it */
const GUARD_POST: Place = { x: 6.6, z: 23.2, rot: -2.7 };
/** a few places to stand when every chair is taken */
const STANDING: Place[] = [
  { x: 9.35, z: 17.3, rot: -PI / 2 },
  { x: 9.35, z: 18.3, rot: -PI / 2 },
  { x: 0.6, z: 21.7, rot: PI / 2 },
  { x: 6.2, z: 17.0, rot: 0.6 },
];

/** where the faint happens: just inside the walk-in door, east of the centre rows; he sinks back, head toward the door */
const FALL: Place = { x: 5.75, z: 22.6, rot: PI };
/** someone pushing a wheelchair stands this far behind its centre, hands on the handles (client crowd.ts, World.ts) */
export const PUSH_GAP = 0.7;

/** the chairs the planner never uses: the shift's own visitors (vis_1…3) and the family member who steps out */
const RESERVED_SPOTS = ['chair-2', 'chair-5', 'chair-9', 'chair-11'];

/**
 * client/src/world/items.ts leaves a magazine or cup on ~30 % of the waiting-room chairs (seeded by
 * prop id: same FNV-1a + mixer, first draw < 0.3); nobody sits on those.
 */
export function chairHasClutter(propId: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < propId.length; i++) h = Math.imul(h ^ propId.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < 0.3;
}

export interface Seat extends Place {
  id: string;
  /** neighbours in the same row (0.75 m apart) */
  next: string[];
}

export function waitingSeats(layout: LayoutDef): Seat[] {
  const room = layout.rooms.find((r) => r.id === 'waiting');
  const reserved = RESERVED_SPOTS.map((k) => room?.spots[k]).filter((s) => !!s);
  // public seats only: not the clerk's office chair behind the counter
  const chairs = layout.props.filter((p) => p.kind === 'chair' && p.room === 'waiting' && !/desk/.test(p.id) && !chairHasClutter(p.id));
  const free = chairs.filter((p) => !reserved.some((r) => Math.hypot(r!.x - p.x, r!.z - p.z) < 0.2));
  return free.map((p) => ({
    id: p.id,
    x: p.x,
    z: p.z,
    rot: p.rot ?? 0,
    next: free.filter((q) => q !== p && Math.abs((q.rot ?? 0) - (p.rot ?? 0)) < 0.01 && Math.hypot(q.x - p.x, q.z - p.z) < 0.8).map((q) => q.id),
  }));
}

/** seconds it takes to say a line at an unhurried pace */
export function speakSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(0.9, words / 2.6 + 0.35);
}

/** walking seconds between two points (paths bend round furniture: +25 %) */
export function walkSecs(a: Place, b: Place, pace: number): number {
  return (Math.hypot(a.x - b.x, a.z - b.z) * 1.25) / pace + 0.6;
}

/** fill {placeholders} it has values for; others stay (e.g. {nurse}, filled when the scene runs) */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** walking seconds along waypoints (corridors: no detour factor) */
export function walkVia(points: Place[], pace: number): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return d / pace + 0.6;
}

export type { AmbientDef, CollapseRole, ConvoScript, CrowdPersona, TtsVoice };

// ───────────────────────────── timelines ─────────────────────────────

/** one person's day: consecutive stretches (Seg), appended in time order, then patched with gestures */
export class Timeline {
  segs: Seg[] = [];
  constructor(readonly id: string) {}

  /** from t on, be here doing this (ends the previous stretch) */
  set(t: number, s: Omit<Seg, 't0' | 't1'>): this {
    const last = this.segs[this.segs.length - 1];
    if (last && last.t1 > t) last.t1 = t;
    if (last && last.t1 <= last.t0) this.segs.pop();
    this.segs.push({ ...s, t0: t, t1: Infinity });
    return this;
  }

  /** gone from t on */
  leave(t: number): void {
    const last = this.segs[this.segs.length - 1];
    if (last && last.t1 > t) last.t1 = t;
    if (last && last.t1 <= last.t0) this.segs.pop();
  }

  last(): Seg | undefined {
    return this.segs[this.segs.length - 1];
  }

  /** the stretch covering time t */
  at(t: number): Seg | undefined {
    let lo = 0;
    let hi = this.segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segs[mid];
      if (t < s.t0) hi = mid - 1;
      else if (t >= s.t1) lo = mid + 1;
      else return s;
    }
    return undefined;
  }

  /** seated (or, with `standing`, at least staying put) for the whole of [t0, t1) */
  seatedThrough(t0: number, t1: number, standing = false): boolean {
    const s = this.at(t0);
    if (!s || (s.posture !== 'sit' && !(standing && s.posture === 'stand'))) return false;
    for (let i = this.segs.indexOf(s); i < this.segs.length && this.segs[i].t0 < t1; i++) {
      const x = this.segs[i];
      if (x.posture !== s.posture || x.at.x !== s.at.x || x.at.z !== s.at.z) return false;
      if (x.t1 < t1 && this.segs[i + 1]?.t0 !== x.t1) return false;
    }
    return true;
  }

  /** layer gestures/looks over [t0, t1) without moving anyone (splits stretches at the edges) */
  patch(t0: number, t1: number, f: Partial<Seg>, only: (s: Seg) => boolean = () => true): void {
    const out: Seg[] = [];
    for (const s of this.segs) {
      if (s.t1 <= t0 || s.t0 >= t1 || !only(s)) {
        out.push(s);
        continue;
      }
      if (s.t0 < t0) out.push({ ...s, t1: t0 });
      out.push({ ...s, ...f, t0: Math.max(s.t0, t0), t1: Math.min(s.t1, t1) });
      if (s.t1 > t1) out.push({ ...s, t0: t1 });
    }
    this.segs = out;
  }
}

// ───────────────────────────── seats ─────────────────────────────

class SeatMap {
  private holder = new Map<string, string>();
  private seatOf = new Map<string, string>();
  constructor(readonly seats: Seat[]) {}

  isFree(id: string): boolean {
    return !this.holder.has(id);
  }

  of(who: string): Seat | undefined {
    const id = this.seatOf.get(who);
    return id ? this.seats.find((s) => s.id === id) : undefined;
  }

  take(seat: Seat, who: string): Seat {
    this.release(who);
    this.holder.set(seat.id, who);
    this.seatOf.set(who, seat.id);
    return seat;
  }

  release(who: string): void {
    const id = this.seatOf.get(who);
    if (id) this.holder.delete(id);
    this.seatOf.delete(who);
  }

  /** a free seat (with a free neighbour when `pair`), away from where people already sit when possible */
  pick(rng: Rng, opts: { pair?: boolean; nextTo?: string; avoid?: (s: Seat) => boolean } = {}): Seat | undefined {
    if (opts.nextTo) {
      const mate = this.of(opts.nextTo);
      const adj = mate?.next.map((id) => this.seats.find((s) => s.id === id)!).filter((s) => this.isFree(s.id));
      if (adj?.length) return rng.pick(adj);
    }
    let cands = this.seats.filter((s) => this.isFree(s.id) && !opts.avoid?.(s));
    if (opts.pair) {
      const pairs = cands.filter((s) => s.next.some((n) => this.isFree(n)));
      if (pairs.length) cands = pairs;
    }
    if (!cands.length) return undefined;
    // strangers leave a gap when they can: prefer seats whose neighbours are free
    const lonely = cands.filter((s) => s.next.every((n) => this.isFree(n)));
    return rng.pick(lonely.length && !opts.pair ? lonely : cands);
  }
}

// ───────────────────────────── the plan ─────────────────────────────

export interface Plan {
  /** crowd members (persona ids) and the staff overlays (sec_dave, clerk_paul, vis_1…3) */
  people: Map<string, Timeline>;
  scenes: NurseScene[];
  lines: Line[];
  cues: Cue[];
  /** game time of this shift's emergency, if it has one */
  collapseAt?: number;
}

/** speakers whose lines the plan writes against staff (never moved in the simulation) */
const STAFF_SPEAKERS = new Set(['clerk_paul', 'sec_dave', 'rn_lena', 'nurse']);
/** the shift's own seated visitors (content/scenarios.ts): dressed and animated here, never moved far */
const VISITORS = ['vis_1', 'vis_2', 'vis_3'];

interface Who {
  id: string;
  persona?: CrowdPersona;
  pace: number;
  /** busy (walking, at the desk, in a scene) until */
  busyUntil: number;
  arrivedT: number;
  gone?: number;
}

export class Planner {
  readonly rng: Rng;
  readonly people = new Map<string, Timeline>();
  readonly scenes: NurseScene[] = [];
  readonly lines: Line[] = [];
  readonly cues: Cue[] = [];
  readonly seats: SeatMap;
  readonly who = new Map<string, Who>();
  collapseAt?: number;
  private quiet: [number, number] | null = null;
  private clerkFree = 0;
  private nurseFree = 0;
  private readonly vars: Record<string, string>;

  constructor(
    readonly def: AmbientDef,
    readonly layout: LayoutDef,
    seed: number,
    mapId: string,
    readonly endT: number,
    /** game seconds per real second at the map's default speed */
    readonly scale: number,
    night: boolean,
  ) {
    this.rng = new Rng(hashSeed(seed, 'ambient', mapId));
    this.seats = new SeatMap(waitingSeats(layout));
    this.vars = { tonight: night ? 'tonight' : 'today' };
  }

  /** real seconds at the default speed → game seconds */
  g(sec: number): number {
    return sec * this.scale;
  }

  tl(id: string): Timeline {
    let t = this.people.get(id);
    if (!t) this.people.set(id, (t = new Timeline(id)));
    return t;
  }

  isQuiet(t0: number, t1: number): boolean {
    return !!this.quiet && t0 < this.quiet[1] && t1 > this.quiet[0];
  }

  /** present, seated (or standing put, with `standing`) and not busy for the next `forSec` real seconds */
  available(id: string, t: number, forSec = 30, standing = false): boolean {
    const w = this.who.get(id);
    if (!w || w.gone !== undefined || w.busyUntil > t || t < w.arrivedT) return false;
    const t1 = t + this.g(forSec);
    return this.tl(id).seatedThrough(t, t1, standing) && !this.isQuiet(t, t1);
  }

  /** a line at game time t; returns when the speaker is done (game s) */
  say(t: number, who: string, text: string, o: { voiced?: boolean; volume?: number; scene?: string } = {}): number {
    const words = fill(text, this.vars);
    const voiced = o.voiced ?? true;
    const dur = this.g(voiced ? speakSeconds(words) : 1.4 + this.rng.next() * 1.6);
    this.lines.push({ t, who, text: words, voiced, volume: o.volume ?? 0.42, dur, scene: o.scene });
    return t + dur;
  }

  /**
   * Play a two-person script from t: lines alternate with natural gaps; the speaker gestures and
   * the other listens (both look at each other). Returns the end time (game s).
   */
  script(t: number, sc: ConvoScript, cast: Record<string, string>, o: { volume?: number; scene?: string; seated?: boolean } = {}): number {
    const ids = Object.values(cast);
    for (const ln of sc.lines) {
      t += this.g((ln.pause ?? 0) + 0.55 + this.rng.next() * 0.9);
      const who = cast[ln.who] ?? ln.who;
      const end = this.say(t, who, ln.text, { voiced: ln.voiced, volume: o.volume, scene: o.scene });
      const seated = (s: Seg) => s.posture === 'sit' || o.seated === false;
      if (!STAFF_SPEAKERS.has(who) || this.people.has(who)) this.tl(who).patch(t, end, { act: ln.act ?? 'talk', look: ids.find((x) => x !== who) }, seated);
      for (const other of ids) {
        if (other === who || (STAFF_SPEAKERS.has(other) && !this.people.has(other))) continue;
        this.tl(other).patch(t, end, { act: ln.react ?? 'listen', look: who }, seated);
      }
      t = end;
    }
    return t;
  }

  // ── people in place ──

  private sitDown(id: string, t: number, seat: Place, o: Partial<Seg> = {}): void {
    this.tl(id).set(t, { room: 'waiting', at: { x: seat.x, z: seat.z, rot: seat.rot }, posture: 'sit', pace: this.who.get(id)?.pace, ...o });
  }

  private seatFor(id: string, nextTo?: string): Place {
    const companions = Object.values(PERSONAS).some((q) => q.companionOf === id && this.who.has(q.id));
    const seat = this.seats.pick(this.rng, { nextTo, pair: companions });
    if (seat) return this.seats.take(seat, id);
    // every chair taken: stand along a wall
    const taken = new Set([...this.people.values()].map((tl) => tl.last()).filter((s) => s && s.posture === 'stand').map((s) => `${s!.at.x},${s!.at.z}`));
    const spot = STANDING.find((s) => !taken.has(`${s.x},${s.z}`)) ?? STANDING[0];
    return spot;
  }

  /** where someone stands once up from where they are at time t: a step in front of their chair */
  private upFrom(id: string, t: number, rot?: number): Place {
    const s = this.tl(id).at(t);
    if (!s) return OUTSIDE;
    if (s.posture !== 'sit') return { ...s.at, rot: rot ?? s.at.rot };
    return { x: s.at.x + Math.sin(s.at.rot) * STEP_OFF, z: s.at.z + Math.cos(s.at.rot) * STEP_OFF, rot: rot ?? s.at.rot };
  }

  /** settle into the seat (or standing spot) they hold, doing nothing in particular */
  private settle(id: string, t: number, o: Partial<Seg> = {}): void {
    const seat = this.seats.of(id);
    const w = this.who.get(id)!;
    if (seat) this.sitDown(id, t, seat, o);
    else {
      const at = this.seatFor(id);
      if ('id' in at) this.sitDown(id, t, at as Seat, o);
      else this.tl(id).set(t, { room: 'waiting', at, posture: 'stand', pace: w.pace, ...o });
    }
  }

  /** everyone waiting when the shift starts, companions beside their person */
  seatPresent(): void {
    const ids = [...this.def.present].sort((a, b) => Number(!!PERSONAS[a].companionOf) - Number(!!PERSONAS[b].companionOf));
    for (const id of ids) {
      const p = PERSONAS[id];
      // waiting a while already: arrived 20–150 min before the shift (only the order of calls cares)
      this.who.set(id, { id, persona: p, pace: p.pace ?? 1.25, busyUntil: 0, arrivedT: -this.g(60) * this.rng.range(20, 150) });
      const seat = this.seats.pick(this.rng, { nextTo: p.companionOf, pair: Object.values(PERSONAS).some((q) => q.companionOf === id && this.def.present.includes(q.id)) });
      if (seat) this.sitDown(id, 0, this.seats.take(seat, id));
      else this.tl(id).set(0, { room: 'waiting', at: STANDING[this.rng.int(0, STANDING.length - 1)], posture: 'stand' });
    }
  }

  /** the shift's visitors (vis_1…3, content/scenarios.ts) keep their chairs; here they get faces to pull */
  dressVisitors(): void {
    const room = this.layout.rooms.find((r) => r.id === 'waiting')!;
    const chairs: Record<string, string> = { vis_1: 'chair-2', vis_2: 'chair-5', vis_3: 'chair-9' };
    for (const id of VISITORS) {
      const sp = room.spots[chairs[id]];
      if (!sp) continue;
      this.who.set(id, { id, pace: 1.2, busyUntil: 0, arrivedT: -this.g(60) * 120 });
      this.tl(id).set(0, { room: 'waiting', at: { x: sp.x, z: sp.z, rot: sp.rot ?? 0 }, posture: 'sit', props: id === 'vis_2' ? ['mask'] : id === 'vis_1' ? ['phone', 'laptop'] : id === 'vis_3' ? ['newspaper'] : undefined });
    }
    // security stands beside the walk-in door rather than in it; the clerk keeps his desk
    this.tl('sec_dave').set(0, { room: 'waiting', at: GUARD_POST, posture: 'stand', pace: 1.3 });
    const desk = room.spots.desk;
    if (desk) this.tl('clerk_paul').set(0, { room: 'waiting', at: { x: desk.x, z: desk.z, rot: desk.rot ?? 0 }, posture: 'sit' });
  }

  /** Two visitors take turns leaving their waiting-room chairs, using the restroom and returning.
   * Set real walking time aside for the long trip through the ED and the hospital street. */
  planRestroomVisits(): void {
    let depart = this.rng.range(0.6, 1.6) * M;
    const street: Place = { x: 53.6, z: 11.6, rot: PI / 2 };
    const stall: Place = { x: 69.65, z: 3.45, rot: PI / 2 };
    const sink: Place = { x: 68.1, z: 3.35, rot: -PI / 2 };
    for (let n = 0; depart < this.endT; n++) {
      const tl = this.tl(n % 2 === 0 ? 'vis_3' : 'vis_1');
      const home = tl.segs[0];
      const pace = 1.35;
      const set = (t: number, room: string, at: Place) => tl.set(t, { room, at, posture: 'stand', pace });
      set(depart, 'street', street);
      let t = depart + this.g(walkSecs(home.at, street, pace) + 12);
      set(t, 'restrooms', stall);
      t += this.g(walkSecs(street, stall, pace) + this.rng.range(28, 46));
      set(t, 'restrooms', sink);
      t += this.g(24);
      set(t, 'street', street);
      t += this.g(walkSecs(sink, street, pace) + 8);
      tl.set(t, { room: 'waiting', at: home.at, posture: 'sit', props: home.props, pace });
      depart = t + this.g(walkSecs(street, home.at, pace)) + this.rng.range(3, 8) * M;
    }
  }

  /** a walk-in: through the door, registration, a seat */
  arrive(id: string, t: number): void {
    const p = PERSONAS[id];
    const pace = p.pace ?? 1.25;
    this.who.set(id, { id, persona: p, pace, busyUntil: Infinity, arrivedT: t });
    const tl = this.tl(id);
    const masked = p.props?.includes('mask');
    tl.set(t, { room: 'exterior', at: OUTSIDE, posture: 'stand', pace, props: masked ? p.props!.filter((x) => x !== 'mask') : undefined });
    let at = t + this.g(1);
    if (masked) {
      // the sign says masks if you're coughing; security points at the box by the door
      const door: Place = { x: 5.6, z: 23.2, rot: PI };
      tl.set(at, { room: 'waiting', at: door, posture: 'stand', pace, act: 'cough', props: p.props!.filter((x) => x !== 'mask') });
      at += this.g(walkSecs(OUTSIDE, door, pace));
      this.cues.push({ t: at, who: id, kind: 'cough' });
      this.say(at + this.g(0.6), 'sec_dave', MASK_LINE, { volume: 0.7 });
      at += this.g(4.5);
    }
    const queue = this.clerkFree > at + this.g(walkSecs(OUTSIDE, DESK_SPOT, pace));
    tl.set(at, { room: 'waiting', at: queue ? DESK_QUEUE : DESK_SPOT, posture: 'stand', pace, look: 'clerk_paul' });
    at += this.g(walkSecs(OUTSIDE, DESK_SPOT, pace));
    if (queue) {
      at = Math.max(at, this.clerkFree);
      tl.set(at, { room: 'waiting', at: DESK_SPOT, posture: 'stand', pace, look: 'clerk_paul' });
      at += this.g(1.5);
    }
    const end = this.script(at, REGISTER, { a: id }, { volume: 0.55, seated: false });
    this.clerkFree = end + this.g(2);
    const seat = this.seatFor(id, p.companionOf ?? (id === 'amb_knee' && this.seats.of('amb_wrist') ? 'amb_wrist' : undefined));
    if ('id' in seat) this.sitDown(id, end, seat as Seat);
    else tl.set(end, { room: 'waiting', at: seat, posture: 'stand', pace });
    this.who.get(id)!.busyUntil = end + this.g(walkSecs(DESK_SPOT, seat, pace) + 2);
  }

  // ── the triage nurse calls the next name ──

  /** best next person to call: most urgent first, then longest waiting */
  private nextToCall(t: number): string | undefined {
    const cands = [...this.who.values()].filter((w) => w.persona?.callName && this.available(w.id, t, 45, true));
    cands.sort((a, b) => (a.persona!.esi ?? 4) - (b.persona!.esi ?? 4) || a.arrivedT - b.arrivedT);
    return cands[0]?.id;
  }

  /** "Tyler Nguyen?" — they get up and go through with her (companions follow). Returns when the nurse is free again. */
  callScene(t: number, id: string): number {
    const p = PERSONAS[id];
    const w = this.who.get(id)!;
    const scene = `call_${id}`;
    // she is at the door a few seconds before she calls, reading the name off her clipboard; the call comes
    // late enough for the stand-in to walk all the way in from the treatment area (she never just appears there)
    const read = 3.5;
    const tCall = t + this.g(Math.max(19, walkSecs(FLOAT_HOME, CALL_SPOT, 1.35) + read + 1.5));
    const [first] = p.callName!.split(' ');
    const name = p.callName!;
    // the nurse: from her desk (up out of her chair, timed on her route out of triage), or (stand-in) from the treatment area
    const lena = new Timeline('rn_lena');
    lena.set(t, { room: 'triage', at: LENA_DESK, posture: 'sit' });
    lena.set(tCall - this.g(walkVia(LENA_OUT, 1.35) + 1.2 + read), { room: 'waiting', at: CALL_SPOT, posture: 'stand', pace: 1.35, act: 'clipboard', props: ['clipboard'] });
    const flt = new Timeline(FLOAT_RN.id);
    flt.set(t, { room: 'hub', at: FLOAT_HOME, posture: 'stand', pace: 1.35, props: ['clipboard'] });
    flt.set(tCall - this.g(walkSecs(FLOAT_HOME, CALL_SPOT, 1.35) + read), { room: 'waiting', at: CALL_SPOT, posture: 'stand', pace: 1.35, act: 'clipboard', props: ['clipboard'] });
    const called = this.say(tCall, 'nurse', fill(this.rng.pick(TRIAGE.call), { name, first }), { volume: 0.8, scene });
    // they hear their name, answer, get up and come over
    const tAns = called + this.g(0.9 + this.rng.next());
    const voiced = !!this.def.voices[id];
    this.say(tAns, id, this.rng.pick(TRIAGE.answer), { voiced, volume: 0.55 });
    const tUp = tAns + this.g(0.8);
    const tl = this.tl(id);
    const up = this.upFrom(id, t);
    tl.set(tUp, { room: 'waiting', at: up, posture: 'stand', look: 'nurse', pace: 0.6 });
    const mates = [...this.who.values()].filter((m) => m.persona?.companionOf === id && m.gone === undefined && this.tl(m.id).at(tUp));
    for (const m of mates) this.tl(m.id).set(tUp + this.g(0.6), { room: 'waiting', at: this.upFrom(m.id, tUp), posture: 'stand', look: 'nurse', pace: 0.6 });
    const tWalk = tUp + this.g(2);
    tl.set(tWalk, { room: 'waiting', at: MEET_SPOT, posture: 'stand', pace: w.pace, look: 'nurse' });
    // NPCs walk round the rows of chairs (client steering.ts): timed on that route, not the straight line
    const tMeet = tWalk + this.g(routeWalkSecs(this.layout, up, MEET_SPOT, w.pace));
    const greeted = this.say(tMeet + this.g(0.3), 'nurse', fill(p.greet ?? this.rng.pick(TRIAGE.greet), { name, first }), { volume: 0.6, scene });
    const tGo = greeted + this.g(0.6);
    // through to the back: the patient (and family) walk down the corridor; the nurse peels off at triage
    this.seats.release(id);
    tl.set(tGo, { room: 'hub', at: BACK, posture: 'stand', pace: w.pace });
    const gone = tGo + this.g(walkSecs(MEET_SPOT, BACK, w.pace) + 2);
    tl.leave(gone);
    w.gone = gone;
    mates.forEach((m, i) => {
      this.say(tUp + this.g(1.4), m.id, m.persona?.followLine ?? this.rng.pick(TRIAGE.companion), { voiced: !!this.def.voices[m.id], volume: 0.4 });
      this.seats.release(m.id);
      this.tl(m.id).set(tGo + this.g(0.7 + i * 0.5), { room: 'hub', at: { x: BACK.x - 0.8 - i * 0.7, z: BACK.z + 0.5, rot: BACK.rot }, posture: 'stand', pace: m.pace });
      this.tl(m.id).leave(gone + this.g(1.5));
      m.gone = gone + this.g(1.5);
    });
    lena.set(tGo, { room: 'hub', at: TRIAGE_DOOR, posture: 'stand', pace: 1.35, props: ['clipboard'] });
    const tDoor = tGo + this.g(walkSecs(CALL_SPOT, TRIAGE_DOOR, 1.35));
    lena.set(tDoor, { room: 'triage', at: LENA_DESK, posture: 'sit', pace: 1.35 });
    const lenaHome = tDoor + this.g(walkSecs(TRIAGE_DOOR, LENA_DESK, 1.35) + 1);
    lena.leave(lenaHome);
    flt.set(tGo + this.g(0.4), { room: 'hub', at: { x: BACK.x + 0.8, z: BACK.z - 0.4, rot: BACK.rot }, posture: 'stand', pace: 1.35, props: ['clipboard'] });
    const fltGone = tGo + this.g(walkSecs(CALL_SPOT, BACK, 1.35) + 2);
    flt.leave(fltGone);
    this.scenes.push({ id: scene, t0: t, t1: Math.max(lenaHome, fltGone), kind: 'call', lena: lena.segs, float: flt.segs });
    return Math.max(lenaHome, fltGone);
  }

  // ── the impatient man, a trip to the vending machine, giving up ──

  /** walk somewhere, do a thing there, come back to the seat */
  private errand(id: string, t: number, place: Place, stay: number, o: { act?: AmbientAct; look?: string; after?: Partial<Seg>; afterAct?: [AmbientAct, number] } = {}): number {
    const w = this.who.get(id)!;
    const tl = this.tl(id);
    const seat = tl.at(t)!.at;
    const up = this.upFrom(id, t);
    tl.set(t, { room: 'waiting', at: up, posture: 'stand', act: 'idle', pace: 0.6 });
    tl.set(t + this.g(1.6), { room: 'waiting', at: place, posture: 'stand', pace: w.pace, act: o.act, look: o.look });
    const there = t + this.g(1.6 + routeWalkSecs(this.layout, up, place, w.pace));
    const back = there + this.g(stay);
    tl.set(back, { room: 'waiting', at: seat, posture: 'sit', pace: w.pace, ...o.after });
    w.busyUntil = back + this.g(walkSecs(place, seat, w.pace) + 1.5);
    if (o.afterAct) tl.patch(w.busyUntil, w.busyUntil + o.afterAct[1] * M, { act: o.afterAct[0] }, (x) => x.posture === 'sit' && !x.act);
    return there;
  }

  deskVisit(id: string, t: number, which: number): void {
    const there = this.errand(id, t, DESK_SPOT, 16, { look: 'clerk_paul', afterAct: ['impatient', 2] });
    const end = this.script(there + this.g(0.4), DESK[which % DESK.length], { a: id }, { volume: 0.6, seated: false });
    this.clerkFree = Math.max(this.clerkFree, end + this.g(1));
  }

  vendingTrip(id: string, t: number): void {
    const p = PERSONAS[id];
    this.errand(id, t, VENDING, 22, { act: 'idle', after: { props: [...(p?.props ?? []), 'can'] }, afterAct: ['drink', 2.5] });
  }

  /** had enough: walks out without being seen (LWBS) */
  giveUp(id: string, t: number): void {
    const w = this.who.get(id)!;
    const tl = this.tl(id);
    const seat = tl.at(t)!.at;
    tl.set(t, { room: 'waiting', at: this.upFrom(id, t), posture: 'stand', act: 'impatient', pace: 0.6 });
    const said = this.say(t + this.g(0.8), id, "Forget it. I'll see my own doctor tomorrow.", { voiced: !!this.def.voices[id], volume: 0.55 });
    this.say(said + this.g(0.5), 'clerk_paul', "Sir, if it gets worse, please come straight back.", { volume: 0.55 });
    tl.set(said + this.g(1), { room: 'exterior', at: OUTSIDE, posture: 'stand', pace: w.pace });
    this.seats.release(id);
    w.gone = said + this.g(1 + walkSecs(seat, OUTSIDE, w.pace) + 1);
    tl.leave(w.gone);
  }

  // ── the shift, in time order ──

  /** no scenes start around the emergency: from a few minutes before it until it is over */
  reserveCollapse(): void {
    const c = this.def.collapse;
    if (!c || this.rng.next() >= c.chance) return;
    this.collapseAt = Math.round(this.rng.range(c.window[0], c.window[1]) * M);
    this.quiet = [this.collapseAt - this.g(40), this.collapseAt + this.g(150)];
  }

  /** arrivals, calls, desk visits, errands and departures, each checking who is free at that moment */
  planDay(): void {
    type Ev = { t: number; kind: 'arrive' | 'call' | 'desk' | 'giveup' | 'vending' | 'wake'; id?: string; n?: number; tries?: number };
    const evs: Ev[] = [];
    const push = (e: Ev) => {
      evs.push(e);
      evs.sort((a, b) => a.t - b.t);
    };
    const end = this.endT / M;
    for (const a of this.def.arrivals) push({ t: this.rng.range(a.window[0], a.window[1]) * M, kind: 'arrive', id: a.persona });
    push({ t: this.rng.range(3, 9) * M, kind: 'call' });
    if (this.who.has('amb_impatient')) {
      push({ t: this.rng.range(15, 40) * M, kind: 'desk', id: 'amb_impatient', n: 0 });
      push({ t: this.rng.range(70, 115) * M, kind: 'desk', id: 'amb_impatient', n: 1 });
      push({ t: this.rng.range(end * 0.6, end * 0.8) * M, kind: 'giveup', id: 'amb_impatient' });
    }
    for (let i = 0; i < 3; i++) push({ t: this.rng.range(8, end - 20) * M, kind: 'vending' });
    if (this.who.has('amb_sleeper')) push({ t: this.rng.range(end * 0.4, end * 0.7) * M, kind: 'wake', id: 'amb_sleeper' });
    const later = (e: Ev, min: number) => (e.tries ?? 0) < 4 && push({ ...e, t: e.t + min * M, tries: (e.tries ?? 0) + 1 });
    while (evs.length) {
      const e = evs.shift()!;
      if (e.t >= this.endT - 5 * M) continue;
      if (this.isQuiet(e.t - this.g(15), e.t + this.g(70))) {
        push({ ...e, t: this.quiet![1] + this.g(25 + this.rng.next() * 30) });
        continue;
      }
      switch (e.kind) {
        case 'arrive':
          if (this.clerkFree > e.t + this.g(30)) later(e, 2);
          else this.arrive(e.id!, e.t);
          break;
        case 'call': {
          const id = this.nurseFree <= e.t ? this.nextToCall(e.t) : undefined;
          if (!id) {
            push({ t: Math.max(this.nurseFree, e.t) + this.rng.range(3, 6) * M, kind: 'call' });
            break;
          }
          this.nurseFree = this.callScene(e.t, id) + this.g(10);
          push({ t: e.t + this.rng.range(this.def.callEvery[0], this.def.callEvery[1]) * M, kind: 'call' });
          break;
        }
        case 'desk':
          if (this.available(e.id!, e.t, 60) && this.clerkFree < e.t) this.deskVisit(e.id!, e.t, e.n ?? 0);
          else later(e, 3);
          break;
        case 'giveup':
          if (this.available(e.id!, e.t, 30, true)) this.giveUp(e.id!, e.t);
          else later(e, 4);
          break;
        case 'vending': {
          const ids = [...this.who.values()].filter((w) => w.persona && !['amb_walker', 'amb_sleeper', 'amb_migraine', 'amb_faint'].includes(w.id) && this.available(w.id, e.t, 90));
          if (ids.length) this.vendingTrip(this.rng.pick(ids).id, e.t);
          else later(e, 5);
          break;
        }
        case 'wake':
          if (this.available(e.id!, e.t, 30)) this.wakeAndGo(e.id!, e.t);
          else later(e, 5);
          break;
      }
    }
  }

  /** the brother texts: he wakes, reads it, and goes through to see him */
  private wakeAndGo(id: string, t: number): void {
    const w = this.who.get(id)!;
    const tl = this.tl(id);
    const seat = tl.at(t)!.at;
    tl.set(t, { room: 'waiting', at: seat, posture: 'sit', act: 'phone_text', props: ['phone'] });
    tl.set(t + this.g(9), { room: 'waiting', at: this.upFrom(id, t), posture: 'stand', act: 'idle', props: ['phone'], pace: 0.6 });
    tl.set(t + this.g(10.5), { room: 'hub', at: BACK, posture: 'stand', pace: w.pace });
    this.seats.release(id);
    w.gone = t + this.g(10.5 + walkSecs(seat, BACK, w.pace) + 2);
    tl.leave(w.gone);
  }

  // ── waiting: idles, small talk, the phone call, the dog ──

  /** seated stretches at one seat with nothing else going on (merged), clipped to the shift */
  private stretches(tl: Timeline): [number, number][] {
    const out: [number, number][] = [];
    for (const s of tl.segs) {
      if (s.posture !== 'sit' || s.act) continue;
      const t1 = Math.min(s.t1, this.endT);
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev[1] - s.t0) < 1) prev[1] = t1;
      else if (t1 > s.t0) out.push([s.t0, t1]);
    }
    return out;
  }

  /** what people do while they wait: their idles in turn, a few minutes each */
  planIdles(): void {
    const own: Record<string, AmbientAct[]> = {
      // working on a laptop on her lap (dressVisitors gives her one); she's the one after a phone charger
      vis_1: ['laptop', 'laptop', 'phone_text', 'look', 'wait'],
      vis_2: ['cough', 'idle', 'sleep', 'idle', 'cough'],
      // a broadsheet open in both hands (dressVisitors gives him the paper)
      vis_3: ['read', 'read', 'look', 'wait', 'yawn'],
    };
    for (const [id, tl] of this.people) {
      const idles = PERSONAS[id]?.idles ?? own[id];
      if (!idles?.length) continue;
      for (const [a, b] of this.stretches(tl)) {
        let t = a;
        while (t < b) {
          const act = this.rng.pick(idles);
          const len = this.rng.range(2, 6) * M;
          const t1 = Math.min(b, t + len);
          tl.patch(t, t1, { act }, (x) => x.posture === 'sit' && !x.act);
          if (act === 'cough' && !this.isQuiet(t, t1)) {
            this.cues.push({ t: t + this.g(1.5), who: id, kind: 'cough' });
            if (t1 - t > this.g(25)) this.cues.push({ t: t + (t1 - t) * 0.55, who: id, kind: 'cough' });
          }
          t = t1;
        }
      }
    }
  }

  /** rough length of a script in real seconds (for checking that both stay put) */
  private scriptSecs(sc: ConvoScript): number {
    return sc.lines.reduce((n, l) => n + (l.pause ?? 0) + 1.45 + (l.voiced === false ? 3 : speakSeconds(l.text)), 0);
  }

  private talkFree = new Map<string, number>();

  /** both seated, nothing else on, not already talking */
  private canTalk(ids: string[], t: number, secs: number): boolean {
    return ids.every((id) => (this.talkFree.get(id) ?? 0) <= t && this.available(id, t, secs + 2));
  }

  private talk(t: number, sc: ConvoScript, cast: Record<string, string>, volume = 0.4): number {
    const end = this.script(t, sc, cast, { volume });
    for (const id of Object.values(cast)) this.talkFree.set(id, end + this.g(20));
    return end;
  }

  /** seated next to each other at time t */
  private neighbours(a: string, b: string, t: number): boolean {
    const x = this.tl(a).at(t);
    const y = this.tl(b).at(t);
    return !!x && !!y && x.posture === 'sit' && y.posture === 'sit' && Math.hypot(x.at.x - y.at.x, x.at.z - y.at.z) < 0.8;
  }

  /** a conversation that comes back every so often while both are there */
  private recurring(ids: [string, string], scripts: ConvoScript[], first: [number, number], every: [number, number]): void {
    if (!ids.every((id) => this.people.has(id))) return;
    const order = this.shuffle(scripts);
    let k = 0;
    for (let t = this.rng.range(first[0], first[1]) * M; t < this.endT && k < order.length * 2; t += this.rng.range(every[0], every[1]) * M) {
      const sc = order[k % order.length];
      if (!this.canTalk(ids, t, this.scriptSecs(sc))) continue;
      this.talk(t, sc, { a: ids[0], b: ids[1] });
      k++;
    }
  }

  private shuffle<T>(xs: T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  planTalk(): void {
    this.recurring(['amb_cut', 'amb_cut_partner'], COUPLE, [3, 9], [7, 15]);
    // the daughter rings her brother early on, then checks in with her father now and then
    if (this.people.has('amb_daughter')) {
      for (let t = this.rng.range(4, 14) * M, n = 0; n < 6 && t < this.endT; t += 3 * M, n++) {
        if (!this.canTalk(['amb_daughter'], t, this.scriptSecs(PHONE_CALL))) continue;
        this.tl('amb_daughter').patch(t, t + this.g(this.scriptSecs(PHONE_CALL)), { act: 'phone_call' }, (x) => x.posture === 'sit');
        this.talk(t, PHONE_CALL, { a: 'amb_daughter' }, 0.45);
        break;
      }
    }
    this.recurring(['amb_daughter', 'amb_walker'], FAMILY, [16, 30], [18, 35]);
    // the two sports injuries compare notes once the knee has sat down next to the wrist
    const knee = this.who.get('amb_knee');
    if (knee && this.people.has('amb_wrist')) {
      for (let t = knee.busyUntil + this.rng.range(1, 4) * M, n = 0; n < 8 && t < this.endT; t += 2 * M, n++) {
        if (!this.neighbours('amb_wrist', 'amb_knee', t) || !this.canTalk(['amb_wrist', 'amb_knee'], t, this.scriptSecs(INJURIES))) continue;
        this.talk(t, INJURIES, { a: 'amb_wrist', b: 'amb_knee' });
        break;
      }
    }
    // strangers in neighbouring seats, now and then
    const talkers = [...this.people.keys()].filter((id) => PERSONAS[id] && this.def.voices[id]);
    for (let t = this.rng.range(10, 20) * M; t < this.endT; t += this.rng.range(14, 26) * M) {
      const pairs: [string, string][] = [];
      for (const a of talkers) for (const b of talkers) if (a < b && PERSONAS[a].companionOf !== b && PERSONAS[b].companionOf !== a && this.neighbours(a, b, t)) pairs.push([a, b]);
      const sc = this.rng.pick(STRANGERS);
      const pair = this.shuffle(pairs).find((p) => this.canTalk(p, t, this.scriptSecs(sc)));
      if (pair) this.talk(t, sc, { a: pair[0], b: pair[1] });
    }
    this.planDog();
  }

  /** the small dog barks now and then; she hushes it; a neighbour asks; security has a word once */
  private planDog(): void {
    const owner = 'amb_dog';
    const tl = this.people.get(owner);
    if (!tl) return;
    let barks = 0;
    let warned = false;
    let asked = false;
    for (let t = this.rng.range(2, 6) * M; t < this.endT; t += this.rng.range(6, 14) * M) {
      const seg = tl.at(t);
      if (!seg || seg.posture !== 'sit') continue;
      this.cues.push({ t, who: owner, kind: 'dog_bark' });
      barks++;
      if (this.isQuiet(t, t + this.g(20))) continue;
      // everyone near looks over for a moment
      for (const [id, other] of this.people) {
        const o = other.at(t);
        if (id !== owner && o && o.posture === 'sit' && Math.hypot(o.at.x - seg.at.x, o.at.z - seg.at.z) < 3.5 && (this.talkFree.get(id) ?? 0) <= t) other.patch(t, t + this.g(3), { look: owner }, (x) => x.posture === 'sit');
      }
      if ((this.talkFree.get(owner) ?? 0) <= t && this.rng.next() < 0.5) {
        const end = this.say(t + this.g(1.6), owner, this.rng.pick(DOG.hush), { voiced: !!this.def.voices[owner], volume: 0.32 });
        tl.patch(t, end + this.g(1), { act: 'look' }, (x) => x.posture === 'sit');
        this.talkFree.set(owner, end + this.g(5));
      }
      const mate = [...this.people.keys()].find((id) => id !== owner && this.def.voices[id] && this.neighbours(owner, id, t + this.g(8)));
      if (!asked && mate && this.canTalk([owner, mate], t + this.g(8), this.scriptSecs(DOG.neighbour))) {
        this.talk(t + this.g(8), DOG.neighbour, { a: owner, b: mate });
        asked = true;
      } else if (!warned && barks >= 2 && this.canTalk([owner], t + this.g(4), 30)) {
        this.guardWord(t + this.g(4), seg.at);
        warned = true;
      }
    }
  }

  /** security walks over to the dog's owner, has a word, and goes back to the door */
  private guardWord(t: number, seat: Place): void {
    const dave = this.tl('sec_dave');
    const facing: Place = { x: seat.x + Math.sin(seat.rot) * 0.95, z: seat.z + Math.cos(seat.rot) * 0.95, rot: seat.rot + PI };
    dave.set(t, { room: 'waiting', at: facing, posture: 'stand', pace: 1.2, look: 'amb_dog' });
    const there = t + this.g(walkSecs(GUARD_POST, facing, 1.2));
    const end = this.script(there + this.g(0.5), DOG.security, { a: 'amb_dog' }, { volume: 0.5, seated: false });
    dave.set(end + this.g(1), { room: 'waiting', at: GUARD_POST, posture: 'stand', pace: 1.2 });
    this.talkFree.set('amb_dog', end + this.g(10));
  }

  // ── the emergency ──

  /**
   * A vasovagal faint just inside the walk-in door (see content/ambient.ts COLLAPSE_LINES for the
   * story). Times below are seconds from the moment his knees buckle (B).
   */
  planCollapse(): void {
    const tc = this.collapseAt;
    if (tc === undefined) return;
    const P = 'amb_faint';
    const F = 'amb_faint_friend';
    const pat = this.tl(P);
    const fr = this.tl(F);
    this.who.set(P, { id: P, persona: PERSONAS[P], pace: 1, busyUntil: Infinity, arrivedT: tc });
    this.who.set(F, { id: F, persona: PERSONAS[F], pace: 1.1, busyUntil: Infinity, arrivedT: tc });
    const walkIn = walkSecs(OUTSIDE, FALL, 1.0);
    const B = tc + this.g(walkIn + 5.5);
    const at = (s: number) => B + this.g(s);
    const urgent = true;
    const towel: AmbientProp[] = ['towel'];
    // places around him (lying: head toward the door at +z, his right side is east, the open side of
    // the room: the end of a row of chairs is half a metre from his left, so everyone works from his right)
    const right = (dz: number): Place => ({ x: FALL.x + 0.55, z: FALL.z + dz, rot: -PI / 2 });
    // his legs raised for the faint: she squats past his heels with his ankles in her hands (client
    // crowd.ts 'hold_legs'; the legs only rise while she holds them: hips ~22°, heels ~30 cm up)
    const feet: Place = { x: FALL.x, z: FALL.z - 1.3, rot: 0 };
    // the corridor wheelchair (client wheelchair.ts parks it at (8.6, 14.3) by the waiting room's wall,
    // facing −z): he takes it from beside it, turns it out (crowd.ts) and wheels it in, parks it beside
    // the patient turned to him, and holds its handles
    const FETCH: Place = { x: 9.3, z: 14.3, rot: -PI / 2 };
    const HANDLES: Place = { x: 7.35, z: 21.7, rot: -PI / 2 };
    const WHEEL: Place = { x: HANDLES.x - PUSH_GAP, z: HANDLES.z, rot: HANDLES.rot };
    const door: Place = { x: 4.7, z: 15.6, rot: 0 };
    // ── the patient: walks in, prodrome, faints, comes round, sits up, stands, into the wheelchair ──
    pat.set(tc, { room: 'exterior', at: OUTSIDE, posture: 'stand', props: towel, urgent });
    pat.set(tc + this.g(0.4), { room: 'waiting', at: FALL, posture: 'stand', pace: 1.0, props: towel, urgent, emotion: 'anxious' });
    pat.set(at(-5.5), { room: 'waiting', at: FALL, posture: 'stand', act: 'unsteady', props: towel, urgent, emotion: 'confused' });
    pat.set(at(0), { room: 'waiting', at: FALL, posture: 'stand', act: 'buckle', props: towel, urgent, emotion: 'drowsy' });
    pat.set(at(1.6), { room: 'waiting', at: FALL, posture: 'lie', act: 'floor', props: towel, urgent });
    pat.set(at(37.5), { room: 'waiting', at: FALL, posture: 'lie', act: 'floor', legsUp: true, props: towel, urgent });
    pat.set(at(46), { room: 'waiting', at: FALL, posture: 'lie', act: 'come_round', legsUp: true, props: towel, urgent, emotion: 'confused' });
    pat.set(at(62.5), { room: 'waiting', at: FALL, posture: 'lie', act: 'come_round', props: towel, urgent, emotion: 'confused' });
    pat.set(at(64.2), { room: 'waiting', at: FALL, posture: 'stand', act: 'crouch', props: towel, urgent });
    pat.set(at(66.5), { room: 'waiting', at: FALL, posture: 'stand', act: 'unsteady', props: towel, urgent });
    // a step and a turn, and he sits back into it (the client walks him to its front, turns him, lowers him in)
    pat.set(at(67.5), { room: 'waiting', at: WHEEL, posture: 'sit', pace: 0.45, props: [...towel, 'wheelchair'], urgent, emotion: 'sad' });
    pat.set(at(73), { room: 'hub', at: BACK, posture: 'sit', pace: 1.15, props: [...towel, 'wheelchair'], pushedBy: 'nurse', urgent });
    const route = [WHEEL, door, { x: 4.9, z: 13.6, rot: 0 }, BACK];
    const arrived = at(73) + this.g(walkVia(route, 1.15));
    pat.leave(arrived + this.g(3));
    // ── his friend ──
    fr.set(tc, { room: 'exterior', at: { x: OUTSIDE.x + 0.6, z: OUTSIDE.z + 0.4, rot: PI }, posture: 'stand', urgent });
    fr.set(tc + this.g(0.6), { room: 'waiting', at: { x: 6.4, z: 22.95, rot: -2.3 }, posture: 'stand', pace: 1.05, look: P, urgent });
    fr.set(at(1.2), { room: 'waiting', at: right(-0.15), posture: 'stand', act: 'crouch_talk', look: P, urgent });
    // up again when security comes, out of the nurse's way (her place is his right side, by his chest)
    fr.set(at(4.4), { room: 'waiting', at: { x: 7.05, z: 22.0, rot: -2.0 }, posture: 'stand', act: 'touch_face', look: P, urgent, emotion: 'anxious' });
    fr.set(at(37.5), { room: 'waiting', at: feet, posture: 'stand', act: 'hold_legs', pace: 1.0, look: P, urgent });
    fr.set(at(62.5), { room: 'waiting', at: { x: 6.6, z: 20.7, rot: PI }, posture: 'stand', look: P, urgent });
    // she follows a few steps behind the chair (never between the nurse and the handles)
    fr.set(at(75), { room: 'hub', at: { x: BACK.x - 1.6, z: BACK.z + 0.6, rot: BACK.rot }, posture: 'stand', pace: 1.0, urgent });
    fr.leave(arrived + this.g(4));
    // ── security: first on scene, radios, fetches the wheelchair, holds it for him, settles the room ──
    const dave = this.tl('sec_dave');
    dave.set(at(2.3), { room: 'waiting', at: right(0.5), posture: 'stand', pace: 2.6, urgent });
    dave.set(at(3.6), { room: 'waiting', at: right(0.5), posture: 'stand', act: 'crouch_talk', look: P, urgent });
    // up and a step back as the nurse comes (her place is beside him; kneeling, they would box him in)
    const stood: Place = { x: 6.85, z: 22.95, rot: -2.3 };
    dave.set(at(19.5), { room: 'waiting', at: stood, posture: 'stand', look: P, urgent });
    // sent for it once the nurse has checked him (COLLAPSE_LINES 26.5). Timed on how NPCs really walk
    // through a room of people standing to watch (~0.8 m/s): he is at the chair before he takes it
    dave.set(at(28), { room: 'hub', at: FETCH, posture: 'stand', pace: 1.6, urgent });
    const back = at(28) + this.g(walkVia([stood, door, FETCH], 0.8) + 2.5);
    dave.set(back, { room: 'waiting', at: HANDLES, posture: 'stand', pace: 1.1, act: 'push', props: ['wheelchair'], urgent });
    dave.set(back + this.g(walkVia([FETCH, door, HANDLES], 1.1)), { room: 'waiting', at: HANDLES, posture: 'stand', act: 'push', props: ['wheelchair'], look: P, urgent });
    // he lets the patient have it (the chair stays where it is), hands still on the handles
    dave.set(at(67.5), { room: 'waiting', at: HANDLES, posture: 'stand', act: 'push', look: P, urgent });
    dave.set(at(70.2), { room: 'waiting', at: { x: 7.75, z: 22.4, rot: -2.3 }, posture: 'stand', look: P, urgent });
    dave.set(at(77), { room: 'waiting', at: GUARD_POST, posture: 'stand', pace: 1.2 });
    // ── registration calls it in; the operator pages it overhead ──
    const paul = this.tl('clerk_paul');
    paul.patch(at(8.6), at(13.2), { act: 'phone_call', props: ['phone'], look: P });
    paul.patch(at(0.5), at(73), { look: P }, (x) => !x.act);
    this.cues.push({ t: at(13.6), who: 'clerk_paul', kind: 'overhead', text: COLLAPSE_PAGE });
    this.planCollapseNurse(B, P, right(-0.12), WHEEL, HANDLES, route, arrived);
    this.planCollapseCrowd(B, P, F);
    for (const ln of COLLAPSE_LINES) {
      const who = ln.who === 'patient' ? P : ln.who === 'friend' ? F : ln.who === 'guard' ? 'sec_dave' : ln.who === 'clerk' ? 'clerk_paul' : ln.who === 'nurse' ? 'nurse' : this.filmer ?? P;
      this.say(at(ln.at), who, ln.text, { volume: ln.volume ?? 0.8, scene: ln.who === 'nurse' ? 'collapse' : undefined });
    }
  }

  /** who films it on their phone (someone young with one) */
  private filmer?: string;

  /** the nurse's part, played by the triage nurse (from her desk) or the stand-in (from the treatment area) */
  private planCollapseNurse(B: number, P: string, kneel: Place, WHEEL: Place, HANDLES: Place, route: Place[], arrived: number): void {
    const at = (s: number) => B + this.g(s);
    const corridor: Place[] = [{ x: 4.85, z: 13.9, rot: 0 }, { x: 4.7, z: 15.6, rot: 0 }];
    // beside the wheelchair's front corner, on his left once he has turned his back to it to sit down
    const beside: Place = { x: WHEEL.x - 0.15, z: WHEEL.z + 0.65, rot: PI };
    const make = (id: string, home: Place, room: LocationId, via: Place[]): Timeline => {
      const tl = new Timeline(id);
      tl.set(at(7.6), { room, at: home, posture: id === 'rn_lena' ? 'sit' : 'stand' });
      // (kneeling by him is what she goes there for: the client lets her come close to him on the way)
      tl.set(at(8), { room: 'waiting', at: kneel, posture: 'stand', act: 'crouch_talk', look: P, pace: 3.0, urgent: true });
      // NPCs don't sprint round corners and chairs (client steering.ts): ~1.7 m/s on average, plus getting up
      const there = at(8) + this.g(walkVia([home, ...via, ...corridor, kneel], 1.7) + 1.2);
      tl.set(there, { room: 'waiting', at: kneel, posture: 'stand', act: 'crouch_talk', look: P, urgent: true });
      // up beside him as he gets to his feet: her hands on his arm (client crowd.ts 'steady')
      tl.set(at(66), { room: 'waiting', at: kneel, posture: 'stand', act: 'steady', look: P, urgent: true });
      tl.set(at(68), { room: 'waiting', at: beside, posture: 'stand', act: 'steady', pace: 0.6, look: P, urgent: true });
      tl.set(at(70.6), { room: 'waiting', at: HANDLES, posture: 'stand', act: 'push', pace: 0.8, look: P, urgent: true });
      // pushing: the client keeps her behind the chair (act push + look = who's in it)
      tl.set(at(73), { room: 'hub', at: route[route.length - 1], posture: 'stand', act: 'push', look: P, pace: 1.15, urgent: true });
      return tl;
    };
    const lena = make('rn_lena', LENA_DESK, 'triage', [{ x: 12.3, z: 16.0, rot: PI }, TRIAGE_DOOR]);
    lena.set(arrived, { room: 'hub', at: TRIAGE_DOOR, posture: 'stand', pace: 1.35 });
    const tDoor = arrived + this.g(walkVia([BACK, TRIAGE_DOOR], 1.35));
    lena.set(tDoor, { room: 'triage', at: LENA_DESK, posture: 'sit', pace: 1.35 });
    lena.leave(tDoor + this.g(walkSecs(TRIAGE_DOOR, LENA_DESK, 1.35) + 1));
    const flt = make(FLOAT_RN.id, FLOAT_HOME, 'hub', []);
    flt.leave(arrived + this.g(3));
    this.scenes.push({ id: 'collapse', t0: at(7.6), t1: Math.max(lena.last()!.t1, flt.last()!.t1), kind: 'collapse', lena: lena.segs, float: flt.segs });
  }

  /** the room reacts: people get up and stare, someone films, they sit back down and murmur */
  private planCollapseCrowd(B: number, P: string, F: string): void {
    const at = (s: number) => B + this.g(s);
    const end = at(81);
    const watchers = [...this.people.keys()].filter((id) => id !== P && id !== F && (PERSONAS[id] || VISITORS.includes(id)) && this.people.get(id)!.seatedThrough(at(1), end));
    this.filmer = ['amb_wrist', 'amb_knee', 'amb_earbuds', 'vis_1'].find((id) => watchers.includes(id));
    for (const id of watchers) {
      const tl = this.tl(id);
      const seat = tl.at(at(1))!.at;
      const toward = Math.atan2(FALL.x - seat.x, FALL.z - seat.z);
      const frail = id === 'amb_walker' || id === 'amb_migraine' || id === 'vis_2';
      const stands = id === this.filmer || (!frail && this.rng.next() < 0.55);
      const t0 = at(2.6 + this.rng.next() * 1.8);
      const t1 = at(76.5 + this.rng.next() * 4);
      if (stands) {
        const up: Place = { x: seat.x + Math.sin(seat.rot) * STEP_OFF, z: seat.z + Math.cos(seat.rot) * STEP_OFF, rot: toward };
        tl.patch(t0, t1, { posture: 'stand', at: up, act: 'idle', look: P, pace: 0.9, urgent: true });
        // filming until security tells them to put the phone away (COLLAPSE_LINES)
        if (id === this.filmer) tl.patch(at(18), at(58), { act: 'film', props: ['phone'] });
      } else tl.patch(t0, t1, { act: 'idle', look: P, urgent: true });
    }
    const speakers = this.shuffle(watchers.filter((id) => this.def.voices[id]));
    speakers.slice(0, 3).forEach((id, i) => this.say(at(79 + i * 3.4), id, AFTERMATH[i % AFTERMATH.length], { volume: 0.38 }));
  }

  /** ambient people's lines go out in time order */
  finish(): Plan {
    this.lines.sort((a, b) => a.t - b.t);
    this.cues.sort((a, b) => a.t - b.t);
    return { people: this.people, scenes: this.scenes, lines: this.lines, cues: this.cues, collapseAt: this.collapseAt };
  }
}

/** the whole shift's ambient plan — a pure function of the seed and the map */
export function planAmbient(o: { seed: number; mapId: string; layout: LayoutDef; durationMin: number; timeScale: number; shiftStart: string }): Plan | null {
  const crowded = o.mapId === 'mixed_roster' && !!o.layout.treatmentSpaces;
  const def = AMBIENT[crowded ? 'orientation' : o.mapId];
  if (!def) return null;
  const hour = Number(o.shiftStart.split(':')[0]);
  const p = new Planner(def, o.layout, o.seed, o.mapId, o.durationMin * M, o.timeScale, hour >= 20 || hour < 7);
  p.reserveCollapse();
  p.seatPresent();
  p.dressVisitors();
  if (crowded) p.planRestroomVisits();
  p.planDay();
  p.planIdles();
  p.planTalk();
  p.planCollapse();
  return p.finish();
}

// ───────────────────────────── at run time ─────────────────────────────

/** what the ambient layer reads from the session (structural, so this file never imports the session) */
export interface AmbientHost {
  readonly t: number;
  readonly seed: number;
  readonly playerLocation: LocationId;
  readonly layout: LayoutDef;
  readonly scenario: { id: string; durationMin: number; defaultTimeScale: number; shiftStart: string };
  readonly staff: Map<string, { def: { home: { room: LocationId; spot: string } }; location: LocationId; spot: string; current?: unknown; queue: unknown[] }>;
  readonly conversations: Map<string, { lines: { t: number }[] }>;
  emit(e: { kind: 'speech'; npcId: string; name: string; text: string; volume: number; ambient: true }): void;
  dirty: boolean;
}

/** rooms from which you'd hear the waiting room (the corridor door is open, triage is next door) */
const EARSHOT = new Set<LocationId>(['waiting', 'triage', 'hub']);
const NURSES: Record<string, string> = { rn_lena: 'Lena', [FLOAT_RN.id]: FLOAT_RN.name.split(' ')[0] };

export class AmbientLife {
  readonly plan: Plan | null;
  private lineIdx = 0;
  private cueIdx = 0;
  private lastCue = new Map<string, Cue>();
  private murmur = new Map<string, number>();
  private latch = new Map<string, 'lena' | 'float'>();
  /** scenes the triage nurse was called away from (gameplay comes first) */
  private released = new Set<string>();
  /** she was talked to mid-scene: stays where she is until the conversation goes quiet */
  private hold: { room: LocationId; at: Place; until: number; sit: boolean } | null = null;
  private lastSegKey = '';

  constructor(private readonly host: AmbientHost) {
    const sc = host.scenario;
    this.plan = planAmbient({ seed: host.seed, mapId: sc.id, layout: host.layout, durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart });
  }

  /** the triage nurse may be borrowed: idle at her desk, nobody with her or talking to her */
  private lenaFree(): boolean {
    const st = this.host.staff.get('rn_lena');
    if (!st || st.current || st.queue.length || st.location !== st.def.home.room || st.spot !== st.def.home.spot) return false;
    if (this.host.playerLocation === st.location) return false;
    const last = this.host.conversations.get('rn_lena')?.lines.at(-1);
    return !last || this.host.t - last.t > 180;
  }

  private scenesAt(t: number): NurseScene[] {
    return this.plan?.scenes.filter((s) => t >= s.t0 && t < s.t1) ?? [];
  }

  /** who plays the nurse in this scene (decided once, when it starts) */
  private cast(sc: NurseScene): 'lena' | 'float' {
    let c = this.latch.get(sc.id);
    if (!c) this.latch.set(sc.id, (c = this.lenaFree() ? 'lena' : 'float'));
    return c;
  }

  private nurseOf(sceneId: string | undefined, t: number): string | undefined {
    const sc = sceneId ? this.plan?.scenes.find((s) => s.id === sceneId) : this.scenesAt(t)[0];
    if (!sc) return undefined;
    const c = this.cast(sc);
    if (c === 'lena' && this.released.has(sc.id)) return undefined;
    return c === 'lena' ? 'rn_lena' : FLOAT_RN.id;
  }

  voiceOf(npcId: string): TtsVoice | undefined {
    const id = npcId as keyof AmbientDef['voices'];
    return AMBIENT[this.host.layout.treatmentSpaces ? 'orientation' : this.host.scenario.id]?.voices[id];
  }

  /** Called after each advance of the clock: cast scenes that start, say lines that come due. */
  tick(): void {
    const plan = this.plan;
    if (!plan) return;
    const t = this.host.t;
    for (const sc of this.scenesAt(t)) {
      if (this.cast(sc) !== 'lena' || this.released.has(sc.id)) continue;
      // gameplay needs her (a task, a move, you talking to her): she's released at once
      const st = this.host.staff.get('rn_lena');
      const talked = this.host.conversations.get('rn_lena')?.lines.at(-1);
      if (talked && talked.t >= sc.t0) {
        const seg = segAt(sc.lena, t);
        // (talked to at her desk she stays in her chair: standing there would put her inside it)
        if (seg) this.hold = { room: seg.room, at: seg.at, until: talked.t + 90, sit: seg.posture === 'sit' };
        this.released.add(sc.id);
      } else if (!st || st.current || st.queue.length || st.location !== st.def.home.room) this.released.add(sc.id);
    }
    if (this.hold) {
      const last = this.host.conversations.get('rn_lena')?.lines.at(-1);
      if (last) this.hold.until = Math.max(this.hold.until, last.t + 90);
      if (t >= this.hold.until) this.hold = null;
    }
    while (this.cueIdx < plan.cues.length && plan.cues[this.cueIdx].t <= t) {
      const c = plan.cues[this.cueIdx++];
      this.lastCue.set(c.who, c);
    }
    while (this.lineIdx < plan.lines.length && plan.lines[this.lineIdx].t <= t) {
      const ln = plan.lines[this.lineIdx++];
      if (t - ln.t > 20) continue; // the clock jumped (an agent's wait): what was missed stays unsaid
      this.say(ln, t);
    }
    // a segment boundary passed: send the new view soon
    const key = `${this.lineIdx}|${this.cueIdx}|${[...plan.people.values()].map((tl) => tl.at(t)?.t0 ?? -1).join(',')}`;
    if (key !== this.lastSegKey) {
      this.lastSegKey = key;
      this.host.dirty = true;
    }
  }

  private present(id: string, t: number): boolean {
    if (id === FLOAT_RN.id) return this.scenesAt(t).some((sc) => this.cast(sc) === 'float' && !!segAt(sc.float, t));
    return !!this.plan?.people.get(id)?.at(t);
  }

  private say(ln: Line, t: number): void {
    const who = ln.who === 'nurse' ? this.nurseOf(ln.scene, ln.t) : ln.who;
    if (!who) return;
    if ((PERSONAS[who] || who === FLOAT_RN.id) && !this.present(who, t)) return;
    if (!ln.voiced) {
      this.murmur.set(who, ln.t + ln.dur);
      return;
    }
    // nobody near enough to hear it: no speech (and no synthesis)
    if (!EARSHOT.has(this.host.playerLocation)) return;
    const text = fill(ln.text, { nurse: NURSES[who] ?? 'Lena' });
    this.host.emit({ kind: 'speech', npcId: who, name: nameOf(who), text, volume: ln.volume, ambient: true });
  }

  /**
   * The crowd as NPC views, plus overlays on the staff it borrows (views.ts calls this on the
   * finished list). Only the 3D view changes: the session's staff state is never touched.
   */
  apply(npcs: NpcView[]): void {
    const plan = this.plan;
    if (!plan) return;
    const t = this.host.t;
    const scenes = this.scenesAt(t);
    const nurse = this.nurseOf(scenes[0]?.id, t);
    const resolve = (id: string | undefined) => (id === 'nurse' ? nurse : id);
    const extra = (id: string, seg: Seg, crowd: boolean, props?: AmbientProp[]): AmbientNpcView => {
      const cue = this.lastCue.get(id);
      const mu = this.murmur.get(id);
      return {
        crowd,
        act: seg.act,
        at: seg.at,
        pace: seg.pace,
        look: resolve(seg.look),
        props: seg.props ?? props,
        murmurUntil: mu !== undefined && mu > t ? mu : undefined,
        cue: cue && t - cue.t < 15 ? { kind: cue.kind, t: cue.t, text: cue.text } : undefined,
        pushedBy: resolve(seg.pushedBy),
        legsUp: seg.legsUp,
        urgent: seg.urgent,
      };
    };
    const overlay = (v: NpcView, seg: Seg) => {
      v.location = seg.room;
      v.spot = 'ambient';
      v.posture = seg.posture;
      if (seg.emotion) v.emotion = seg.emotion;
      // no small-talk bark bubble ("Evening, folks.") while they kneel over a fainted man
      if (seg.urgent) v.bark = undefined;
      v.ambient = extra(v.id, seg, false);
    };
    for (const [id, tl] of plan.people) {
      const seg = tl.at(t);
      if (!seg) continue;
      const p = PERSONAS[id];
      if (p) {
        npcs.push({ id, name: p.callName ? 'Waiting patient' : 'Visitor', role: 'visitor', title: 'Waiting', location: seg.room, spot: 'ambient', posture: seg.posture, appearance: p.appearance, talkable: false, emotion: seg.emotion ?? p.emotion, visible: true, ambient: extra(id, seg, true, p.props) });
        continue;
      }
      // staff the plan dresses (security, the clerk, the seated visitors): only while gameplay has them at home
      const v = npcs.find((n) => n.id === id);
      const st = this.host.staff.get(id);
      if (v && st && !st.current && st.location === st.def.home.room && st.spot === st.def.home.spot) overlay(v, seg);
    }
    for (const sc of scenes) {
      if (this.cast(sc) === 'float') {
        const seg = segAt(sc.float, t);
        if (seg) npcs.push({ id: FLOAT_RN.id, name: FLOAT_RN.name, role: 'nurse', title: 'RN', location: seg.room, spot: 'ambient', posture: seg.posture, appearance: FLOAT_RN.appearance, talkable: false, visible: true, ambient: extra(FLOAT_RN.id, seg, true) });
      } else if (!this.released.has(sc.id)) {
        const seg = segAt(sc.lena, t);
        const v = npcs.find((n) => n.id === 'rn_lena');
        if (seg && v) overlay(v, seg);
      }
    }
    if (this.hold) {
      const v = npcs.find((n) => n.id === 'rn_lena');
      const st = this.host.staff.get('rn_lena');
      if (v && st && !st.current && !st.queue.length && st.location === st.def.home.room) overlay(v, { t0: t, t1: t + 1, room: this.hold.room, at: this.hold.at, posture: this.hold.sit ? 'sit' : 'stand' });
    }
  }

  /** for tests and debugging: the crowd present at time t */
  crowdAt(t: number): string[] {
    return [...(this.plan?.people.entries() ?? [])].filter(([id, tl]) => PERSONAS[id] && tl.at(t)).map(([id]) => id);
  }
}

function segAt(segs: Seg[], t: number): Seg | undefined {
  return segs.find((s) => t >= s.t0 && t < s.t1);
}

function nameOf(id: string): string {
  if (id === FLOAT_RN.id) return FLOAT_RN.name;
  const p = PERSONAS[id];
  if (p) return p.callName ?? 'Visitor';
  return { rn_lena: 'Lena Novak', sec_dave: 'Dave Morrison', clerk_paul: 'Paul Lindgren' }[id] ?? id;
}

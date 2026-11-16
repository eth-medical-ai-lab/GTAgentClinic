/**
 * Hand hygiene and masks, for the debrief's infection-control section (listed for reflection, never
 * scored). Recorded in its own trace (`GameSession.ic`), beside the scoring log and never in it:
 * where you went (with the patients there as you came in), whom you examined, every alcohol rub,
 * hand wash and mask on or off (Action 'hygiene', 0 min).
 *
 * WHO "My 5 Moments for Hand Hygiene", moments 1 and 4, from that trace (`whoMoments`, pure):
 * - An episode is a run of examinations of one patient (examining = touching). Stepping out of the
 *   bay and back in, touching nothing on the way, doesn't end it. Each episode is one moment-1 and
 *   one moment-4 opportunity.
 * - What makes hands dirty again: touching another patient, and rooms where you touch things that
 *   aren't a patient (the station's keyboards, a phone, the med cabinet: any room that is neither
 *   transit nor someone's bed space as you came in). Corridors, lobbies and the waiting room are
 *   transit: walking through them touches nothing.
 * - Moment 1 (before touching a patient) is met by a rub or a wash after you last left such a room or
 *   touched another patient, and before the episode's first examination: at the dispenser outside
 *   the bay, or inside it. A rub at the station before walking over doesn't count.
 * - Moment 4 (after touching a patient) is met by a rub or a wash after the episode's last
 *   examination, before you go into such a room or touch another patient: in the bay, or at the
 *   dispenser right outside it. Still at the patient's bed space when the trace ends: not due yet
 *   (`open`).
 * One rub between two patients meets moment 4 for the first and moment 1 for the second, as WHO
 * counts it. Moments 2, 3 and 5 (aseptic tasks, body fluids, touching only the patient's
 * surroundings) aren't simulated.
 *
 * Masks: on each visit to a patient on droplet or airborne precautions (content CaseDef.precautions,
 * from the moment they apply), was a mask on as you went in?
 *
 * Gloves (non-sterile, single use): on each examination of a patient on contact precautions, were
 * gloves on? And each time gloves came off, were the hands cleaned after (WHO: gloves don't replace
 * hand hygiene), before touching anyone, putting on a new pair or going into a room where you touch
 * things?
 */
import { upperRoom } from '../../shared/floors';
import { roomById, type LayoutDef } from '../../shared/layout';
import type { ActionResult, HygieneKind, HygieneOpportunity, HygieneRecord, InfectionControlDebrief, LocationId, PrecautionKind } from '../../shared/types';
import type { GameSession, PatientState } from './session';

/** one entry of the trace */
export type IcEvent =
  | { t: number; kind: 'enter'; room: LocationId; from: LocationId; /** the patients there as you came in */ patients: string[] }
  | { t: number; kind: 'contact'; room: LocationId; pid: string }
  | { t: number; kind: HygieneKind; room: LocationId; at?: string };

export const HYGIENE_KINDS: readonly HygieneKind[] = ['rub', 'wash', 'mask_on', 'mask_off', 'gloves_on', 'gloves_off'];

/** places you walk through without touching anything: corridors, lobbies, the waiting room, outdoors */
const TRANSIT_IDS = new Set(['ems', 'lobby', 'f2_lobby']);
export function isTransit(layout: LayoutDef, room: LocationId): boolean {
  if (TRANSIT_IDS.has(room)) return true;
  const r = roomById(layout, room) ?? upperRoom(layout, room)?.room;
  return !!r && (r.kind === 'corridor' || r.kind === 'waiting' || r.kind === 'exterior');
}

export function roomLabel(layout: LayoutDef, room: LocationId): string {
  return roomById(layout, room)?.label ?? upperRoom(layout, room)?.room.label ?? room;
}

// ───────────────────────────── recording ─────────────────────────────

/** you went into `room` (Action 'move': humans report it as they walk, agents as they move) */
export function recordMove(s: GameSession, room: LocationId) {
  s.ic.push({ t: s.t, kind: 'enter', room, from: s.playerLocation, patients: s.presentPatients().filter((p) => p.location === room).map((p) => p.id) });
}

/** you examined a patient (touching them) */
export function recordContact(s: GameSession, p: PatientState) {
  s.ic.push({ t: s.t, kind: 'contact', room: p.location, pid: p.id });
}

const DONE: Record<HygieneKind, string> = {
  rub: 'Hands rubbed with alcohol until dry: palms, backs, between the fingers, thumbs, fingertips.',
  wash: 'Hands washed with soap and water, rinsed and dried with paper towels.',
  mask_on: 'Surgical mask on: loops behind the ears, nose wire pinched, chin covered.',
  mask_off: 'Mask off by the ear loops and binned. Clean your hands now.',
  gloves_on: 'Non-sterile nitrile gloves on, a fresh pair, the cuffs over the wrists.',
  gloves_off: 'Gloves off inside out (glove to glove, then a bare finger under the cuff) and binned. Clean your hands now.',
};

/** Action 'hygiene' (0 min) */
export function hygieneAction(s: GameSession, kind: unknown, at: unknown): ActionResult {
  if (typeof kind !== 'string' || !HYGIENE_KINDS.includes(kind as HygieneKind)) return { ok: false, message: 'kind must be "rub", "wash", "mask_on", "mask_off", "gloves_on" or "gloves_off".' };
  const k = kind as HygieneKind;
  if (k === 'mask_on' && s.masked) return { ok: false, message: 'Your mask is already on.' };
  if (k === 'mask_off' && !s.masked) return { ok: false, message: 'You are not wearing a mask.' };
  if (k === 'gloves_on' && s.gloved) return { ok: false, message: 'You have gloves on already.' };
  if (k === 'gloves_off' && !s.gloved) return { ok: false, message: 'You are not wearing gloves.' };
  if ((k === 'rub' || k === 'wash') && s.gloved) return { ok: false, message: 'Take the gloves off first: hand hygiene is for bare hands.' };
  if (k === 'mask_on') s.masked = true;
  if (k === 'mask_off') s.masked = false;
  if (k === 'gloves_on') s.gloved = true;
  if (k === 'gloves_off') s.gloved = false;
  s.ic.push({ t: s.t, kind: k, room: s.playerLocation, ...(typeof at === 'string' && at ? { at: at.slice(0, 60) } : {}) });
  s.dirty = true;
  return { ok: true, message: DONE[k] };
}

// ───────────────────────────── precautions ─────────────────────────────

/** when a patient's precautions began (game s), or undefined if none apply (yet) */
export function precautionsSince(s: GameSession, p: PatientState): number | undefined {
  const pc = p.c.precautions;
  if (!pc) return undefined;
  if (!pc.afterFacts?.length) return p.arrivalT;
  let at: number | undefined;
  for (const e of s.log) if (e.kind === 'fact' && e.pid === p.id && pc.afterFacts.includes(e.factId!) && (at === undefined || e.t < at)) at = e.t;
  return at;
}

/** the precautions in force for a patient now (board rows: the sign at the room) */
export function activePrecautions(s: GameSession, p: PatientState): PrecautionKind | undefined {
  const since = precautionsSince(s, p);
  return since !== undefined && since <= s.t ? p.c.precautions!.kind : undefined;
}

// ───────────────────────────── WHO moments 1 and 4 ─────────────────────────────

export interface MomentResult {
  moment: 1 | 4;
  /** the episode's first (moment 1) or last (moment 4) examination */
  t: number;
  pid: string;
  ok: boolean;
  by?: { t: number; kind: 'rub' | 'wash'; room: LocationId };
}

interface Stay {
  room: LocationId;
  /**
   * a room where you touch things that aren't a patient (the station's keyboard, the phone, the med
   * cabinet): not a corridor, and nobody's bed space as you came in. Leaving one starts moment 1 over.
   */
  dirty: boolean;
  /** index of the 'enter' event that began it (−1: where the shift started) and of the one that ended it */
  enterI: number;
  exitI: number;
}

/**
 * Moments 1 and 4 from a trace (see the header); `start` is where you were when the shift began.
 * Windows are taken in trace order, not by clock: in step mode a move and a rub can share a second.
 * An episode goes on while you step out into a corridor and back to the same patient (nothing
 * touched in between, as WHO counts it). Pure.
 */
export function whoMoments(events: readonly IcEvent[], start: LocationId, transit: (room: LocationId) => boolean): { moments: MomentResult[]; open: number } {
  const stays: Stay[] = [{ room: start, dirty: !transit(start), enterI: -1, exitI: Infinity }];
  events.forEach((e, i) => {
    if (e.kind !== 'enter') return;
    const cur = stays[stays.length - 1];
    if (e.room === cur.room) return;
    cur.exitI = i;
    stays.push({ room: e.room, dirty: !transit(e.room) && !e.patients.length, enterI: i, exitI: Infinity });
  });
  const hh: { e: { t: number; kind: 'rub' | 'wash'; room: LocationId }; i: number }[] = [];
  const contacts: { e: Extract<IcEvent, { kind: 'contact' }>; i: number }[] = [];
  events.forEach((e, i) => {
    if (e.kind === 'rub' || e.kind === 'wash') hh.push({ e: { t: e.t, kind: e.kind, room: e.room }, i });
    else if (e.kind === 'contact') contacts.push({ e, i });
  });
  // episodes: runs of examinations of one patient (stepping out and back in, touching nothing, goes on)
  const episodes: { pid: string; room: LocationId; firstI: number; lastI: number; first: number; last: number }[] = [];
  for (const { e, i } of contacts) {
    const ep = episodes[episodes.length - 1];
    const detour = ep && stays.some((s) => s.dirty && s.enterI > ep.lastI && s.enterI < i);
    if (ep && ep.pid === e.pid && !detour && !contacts.some((c) => c.i > ep.lastI && c.i < i && c.e.pid !== e.pid)) {
      ep.lastI = i;
      ep.last = e.t;
    } else episodes.push({ pid: e.pid, room: e.room, firstI: i, lastI: i, first: e.t, last: e.t });
  }
  const moments: MomentResult[] = [];
  let open = 0;
  const by = (h: (typeof hh)[number] | undefined) => (h ? { t: h.e.t, kind: h.e.kind, room: h.e.room } : undefined);
  for (const ep of episodes) {
    // ── moment 1: since you last left a room where you touch things, or touched someone else ──
    let w0 = -1;
    for (const s of stays) if (s.dirty && s.exitI < ep.firstI) w0 = Math.max(w0, s.exitI);
    for (const c of contacts) if (c.i < ep.firstI && c.e.pid !== ep.pid) w0 = Math.max(w0, c.i);
    const before = [...hh].reverse().find((h) => h.i > w0 && h.i < ep.firstI);
    moments.push({ moment: 1, t: ep.first, pid: ep.pid, ok: !!before, by: by(before) });
    // ── moment 4: before you go into such a room or touch someone else ──
    let w1 = Infinity;
    for (const s of stays) if (s.dirty && s.enterI > ep.lastI) w1 = Math.min(w1, s.enterI);
    for (const c of contacts) if (c.i > ep.lastI && c.e.pid !== ep.pid) w1 = Math.min(w1, c.i);
    const after = hh.find((h) => h.i > ep.lastI && h.i < w1);
    // still at this patient's bed space when the trace ends, nothing else touched: not due yet
    if (!after && w1 === Infinity && stays[stays.length - 1].room === ep.room) {
      open++;
      continue;
    }
    moments.push({ moment: 4, t: ep.last, pid: ep.pid, ok: !!after, by: by(after) });
  }
  return { moments, open };
}

/** was a mask on at time t (mask_on / mask_off events before it) */
function maskedAt(events: readonly IcEvent[], t: number): boolean {
  let on = false;
  for (const e of events) {
    if (e.t > t) break;
    if (e.kind === 'mask_on') on = true;
    else if (e.kind === 'mask_off') on = false;
  }
  return on;
}

/** were gloves on just before trace entry `i` (gloves_on / gloves_off before it, in trace order) */
function glovedBefore(events: readonly IcEvent[], i: number): boolean {
  let on = false;
  for (let j = 0; j < i; j++) {
    const e = events[j];
    if (e.kind === 'gloves_on') on = true;
    else if (e.kind === 'gloves_off') on = false;
  }
  return on;
}

/**
 * Hand hygiene after taking gloves off: a rub or a wash after each gloves_off, before the next
 * examination, the next pair of gloves, or a room where you touch things. Nothing at all since (the
 * trace ends): `open`. Pure.
 */
export function afterGloves(events: readonly IcEvent[], transit: (room: LocationId) => boolean): { i: number; t: number; ok: boolean; open: boolean; by?: { t: number; kind: 'rub' | 'wash'; room: LocationId } }[] {
  const out: { i: number; t: number; ok: boolean; open: boolean; by?: { t: number; kind: 'rub' | 'wash'; room: LocationId } }[] = [];
  events.forEach((e, i) => {
    if (e.kind !== 'gloves_off') return;
    let end = events.length;
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j];
      if (x.kind === 'contact' || x.kind === 'gloves_on' || (x.kind === 'enter' && !transit(x.room) && !x.patients.length)) {
        end = j;
        break;
      }
    }
    const h = events.slice(i + 1, end).find((x): x is Extract<IcEvent, { kind: HygieneKind }> => x.kind === 'rub' || x.kind === 'wash');
    out.push({ i, t: e.t, ok: !!h, open: !h && end === events.length, ...(h ? { by: { t: h.t, kind: h.kind as 'rub' | 'wash', room: h.room } } : {}) });
  });
  return out;
}

// ───────────────────────────── the debrief section ─────────────────────────────

export function infectionControl(s: GameSession): InfectionControlDebrief {
  const L = s.layout;
  // where the shift started: the first move's origin
  const first = s.ic.find((e): e is Extract<IcEvent, { kind: 'enter' }> => e.kind === 'enter');
  const { moments, open } = whoMoments(s.ic, first?.from ?? s.playerLocation, (room) => isTransit(L, room));
  const who = (pid: string) => {
    const p = s.patients.get(pid);
    return { name: p ? `${p.c.patient.firstName} ${p.c.patient.lastName}` : pid, bedLabel: p?.bedLabel ?? '' };
  };
  const opportunities: HygieneOpportunity[] = moments.map((m) => ({
    moment: m.moment,
    t: m.t,
    patientId: m.pid,
    ...who(m.pid),
    ok: m.ok,
    ...(m.by ? { by: { t: m.by.t, kind: m.by.kind, roomLabel: roomLabel(L, m.by.room) } } : {}),
  }));
  const count = (k: 1 | 4) => ({ met: moments.filter((m) => m.moment === k && m.ok).length, of: moments.filter((m) => m.moment === k).length });
  const actions: HygieneRecord[] = s.ic
    .filter((e): e is Extract<IcEvent, { kind: HygieneKind }> => HYGIENE_KINDS.includes(e.kind as HygieneKind))
    .map((e) => ({ t: e.t, kind: e.kind, room: e.room, roomLabel: roomLabel(L, e.room), ...(e.at ? { at: e.at } : {}) }));
  // masks where droplet or airborne precautions applied as you went in
  const masks: InfectionControlDebrief['masks'] = [];
  for (const e of s.ic) {
    if (e.kind !== 'enter') continue;
    for (const pid of e.patients) {
      const p = s.patients.get(pid);
      const kind = p?.c.precautions?.kind;
      if (!p || (kind !== 'droplet' && kind !== 'airborne')) continue;
      const since = precautionsSince(s, p);
      if (since === undefined || since > e.t) continue;
      masks.push({ t: e.t, patientId: pid, ...who(pid), precaution: kind, masked: maskedAt(s.ic, e.t) });
    }
  }
  // gloves at each examination of someone on contact precautions (from when they apply)
  const gloves: NonNullable<InfectionControlDebrief['gloves']> = [];
  s.ic.forEach((e, i) => {
    if (e.kind !== 'contact') return;
    const p = s.patients.get(e.pid);
    if (!p || p.c.precautions?.kind !== 'contact') return;
    const since = precautionsSince(s, p);
    if (since === undefined || since > e.t) return;
    gloves.push({ t: e.t, patientId: e.pid, ...who(e.pid), gloved: glovedBefore(s.ic, i) });
  });
  const after = afterGloves(s.ic, (room) => isTransit(L, room)).map((g) => ({
    t: g.t,
    ok: g.ok,
    ...(g.open ? { open: true } : {}),
    ...(g.by ? { by: { t: g.by.t, kind: g.by.kind, roomLabel: roomLabel(L, g.by.room) } } : {}),
  }));
  return { actions, moment1: count(1), moment4: count(4), opportunities, masks, open, gloves, afterGloves: after };
}

/**
 * The AI resident as seen by watchers (observe mode).
 *
 * Sessions created over REST/MCP are played by an agent. For those, this module keeps:
 *  - who drives it (label/model) → PlayerView.driver;
 *  - the `ai_doctor` NPC: it stands where the agent is (location = the session's player
 *    location) at a spot chosen from what it last did — bedside for talk/examine, a desk at a
 *    workstation for orders and charting, the phone for calls, the room entry otherwise — with
 *    a short activity label ("Examining Bed 4 — abdomen") and its latest think-aloud line as
 *    the speech bubble;
 *  - the think-aloud feed: agent narration (POST /api/sessions/:id/narration) plus notable
 *    server events (pages, results, arrivals), in a bounded ring buffer, emitted live as
 *    GameEvent {kind: 'narration'};
 *  - watch pacing: a real-time gap between consecutive actions so the avatar can walk and a
 *    learner can read along. Step mode means game time never moves during the gap.
 *
 * State lives beside the session (WeakMap) — the simulation itself is untouched, and human
 * sessions have no entry here, so they never show an ai_doctor.
 */
import { EXAM_BY_ID, ORDERS } from '../../shared/catalog';
import { roomById, spotFor } from '../../shared/layout';
import { DISPO_LABELS, type Action, type ActionResult, type Appearance, type DriverView, type GameEvent, type NarrationEntry, type NarrationKind, type NpcView, type Posture } from '../../shared/types';
import type { GameSession } from './session';

export const AI_DOCTOR_ID = 'ai_doctor';
/** characters per narration line (longer text is cut with an ellipsis) */
export const NARRATION_MAX_CHARS = 1200;
/** entries kept per session */
export const NARRATION_RING = 300;
/** rate limit: token bucket per session */
export const NARRATION_BURST = 30;
export const NARRATION_PER_SEC = 6;
export const DEFAULT_PACE_SEC = 1.5;
export const MAX_PACE_SEC = 10;
/** a paced action never waits longer than this, whatever the walk */
const MAX_WAIT_MS = 15_000;
const AGENT_KINDS: NarrationKind[] = ['thought', 'action', 'result', 'reflection'];
const ACTIVITY_MAX = 58;

export interface AgentDriver {
  label: string;
  model?: string;
  /** launched from the menu (POST /api/observe): the server owns the agent process */
  observe?: boolean;
}

export interface DoctorPose {
  location: string;
  spot: string;
  posture: Posture;
  activity: string;
}

interface DoctorState {
  driver: AgentDriver;
  pose: DoctorPose;
  /** consecutive orders for one patient, shown as one activity ("Ordering lactate, blood cultures") */
  burst: { pid: string; items: string[] } | null;
  bark?: { text: string; t: number };
  barkSeq: number;
  feed: NarrationEntry[];
  seq: number;
  feedDirty: boolean;
  bucket: { tokens: number; at: number };
  paceMs: number;
  /** wall-clock ms before which the next action waits (pacing) */
  readyAt: number;
  /** serializes paced actions (an agent may send several at once) */
  chain: Promise<unknown>;
}

const registry = new WeakMap<GameSession, DoctorState>();

/** white coat over whites (casting maps ai_doctor to the Rocketbox doctor) */
const DOCTOR_LOOK: Appearance = { skin: '#e0b896', hair: '#3b2a1f', hairStyle: 'short', outfit: 'coat', outfitColor: '#f4f6f8', pantsColor: '#dfe4e8', height: 1.8, build: 'average', age: 'adult', accessories: ['stethoscope', 'badge'] };

// ───────────────────────────── registry ─────────────────────────────

export function attachAiDoctor(s: GameSession, driver: AgentDriver, opts: { paceSec?: number } = {}): void {
  const st: DoctorState = {
    driver: { label: (driver.label || 'AI agent').slice(0, 60), model: driver.model?.slice(0, 60), observe: !!driver.observe },
    pose: { location: s.playerLocation, ...seat(s, s.playerLocation, 'desk'), activity: 'Starting the shift' },
    burst: null,
    barkSeq: 0,
    feed: [],
    seq: 0,
    feedDirty: false,
    bucket: { tokens: NARRATION_BURST, at: Date.now() },
    paceMs: paceToMs(opts.paceSec ?? 0),
    readyAt: 0,
    chain: Promise.resolve(),
  };
  registry.set(s, st);
  // pages sent before the agent was attached (the scenario intro) belong in the transcript
  for (const page of s.pages) feedFromEvent(s, { kind: 'page', page });
}

export function isAgentSession(s: GameSession): boolean {
  return registry.has(s);
}

export function driverView(s: GameSession): DriverView {
  const st = registry.get(s);
  if (!st) return { kind: 'human' };
  return { kind: 'agent', label: st.driver.label, model: st.driver.model, observe: st.driver.observe, paceSec: st.paceMs / 1000 };
}

/** the AI resident as an NPC for PlayerView.npcs (null for human sessions) */
export function aiDoctorNpc(s: GameSession): NpcView | null {
  const st = registry.get(s);
  if (!st) return null;
  const here = st.pose.location === s.playerLocation;
  return {
    id: AI_DOCTOR_ID,
    name: st.driver.label,
    role: 'resident',
    title: 'AI resident',
    location: s.playerLocation,
    spot: here ? st.pose.spot : 'entry',
    posture: here ? st.pose.posture : 'stand',
    activity: s.ended ? 'Shift over' : st.pose.activity,
    appearance: DOCTOR_LOOK,
    // talkable keeps the name tag + activity label visible; spectators cannot act in agent sessions
    talkable: true,
    emotion: 'neutral',
    bark: st.bark,
    visible: true,
  };
}

export function currentPose(s: GameSession): DoctorPose | undefined {
  return registry.get(s)?.pose;
}

// ───────────────────────────── pose & activity ─────────────────────────────

/** first spot of `names` that the room defines, else its entry */
function spotIn(s: GameSession, room: string, ...names: string[]): string {
  const r = roomById(s.layout, room);
  for (const n of names) if (r?.spots[n]) return n;
  return 'entry';
}

/** a seat at a workstation (desk) or by a phone; rooms without one → standing at the entry */
function seat(s: GameSession, room: string, kind: 'desk' | 'phone'): { spot: string; posture: Posture } {
  // station desk-3 and workroom desk-b/desk-c are free (nurses and the attending use the others)
  if (kind === 'desk') {
    if (room === 'station') return { spot: 'desk-3', posture: 'sit' };
    if (room === 'workroom') return { spot: 'desk-b', posture: 'sit' };
  } else {
    if (room === 'station') return { spot: 'phone', posture: 'stand' };
    if (room === 'workroom') return { spot: 'desk-c', posture: 'sit' };
  }
  return { spot: 'entry', posture: 'stand' };
}

function isBay(s: GameSession, room: string): boolean {
  const r = roomById(s.layout, room);
  return !!r && !!r.spots.bed;
}

function cap(text: string, n = ACTIVITY_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

const roomLabel = (s: GameSession, id: string) => roomById(s.layout, id)?.label ?? id;
const bedOf = (s: GameSession, pid: string) => s.patients.get(pid)?.bedLabel ?? pid;
const ACRONYM = /^[A-Z0-9/]{2,}\b|^[a-z][A-Z]/;

/** "Blood cultures x2 (aerobic + anaerobic)" → "blood cultures x2"; keeps acronyms (CBC, ECG, hCG) */
export function orderShort(code: string, dose?: string): string {
  let n = (ORDERS[code]?.name ?? code).replace(/\s*\([^)]*\)/g, '').trim();
  for (const sep of [', ', ' + ']) {
    const i = n.indexOf(sep);
    if (i >= 8) n = n.slice(0, i);
  }
  if (!ACRONYM.test(n)) n = n.charAt(0).toLowerCase() + n.slice(1);
  return dose ? `${n} ${dose}` : n;
}

function npcName(s: GameSession, npcId: string): { name: string; kind: 'patient' | 'family' | 'staff' | 'unknown'; room?: string; detail?: string } {
  if (npcId.startsWith('pt_')) {
    const p = s.patients.get(npcId.slice(3));
    if (p) return { name: `${p.c.patient.firstName} ${p.c.patient.lastName}`, kind: 'patient', room: p.location, detail: p.bedLabel };
  }
  for (const p of s.patients.values()) {
    if (p.c.family?.npcId === npcId) return { name: p.c.family.name, kind: 'family', room: p.family?.status === 'out' ? 'waiting' : p.bed, detail: p.c.family.relation.split(' (')[0] };
  }
  const st = s.staff.get(npcId);
  if (st) return { name: st.def.name, kind: 'staff', room: st.location, detail: st.def.title.split(' — ')[0] };
  return { name: npcId, kind: 'unknown' };
}

const SERVICES: [RegExp, string][] = [
  [/cardiolog/i, 'cardiology'],
  [/surg/i, 'surgery'],
  [/hospitalist|admission/i, 'the hospitalist'],
  [/\bm?icu\b|critical care/i, 'the ICU'],
  [/ortho/i, 'orthopedics'],
  [/ob\/?gyn|obstet/i, 'OB/GYN'],
  [/radiolog/i, 'radiology'],
  [/pharm/i, 'pharmacy'],
  [/\blab\b|laborator/i, 'the lab'],
];

function contactLabel(s: GameSession, contactId: string): string {
  const internal = s.scenario.internalContacts.find((c) => c.contact.id === contactId)?.contact;
  if (internal) {
    const svc = SERVICES.find(([re]) => re.test(`${internal.role} ${internal.name}`));
    return svc ? svc[1] : internal.name;
  }
  return s.playerContacts.get(contactId)?.contact.name ?? contactId;
}

function patientOfEcg(s: GameSession, ecgId: string) {
  for (const p of s.patients.values()) if (p.ecgs.some((e) => e.id === ecgId)) return p;
  return undefined;
}

function itemById(s: GameSession, itemId: string) {
  return s.items().find((x) => x.item.id === itemId);
}

/** a short human label of what the agent is doing — shown under its name tag */
export function describeAction(s: GameSession, a: Action, burst?: string[]): string {
  switch (a.type) {
    case 'move':
      return cap(`Walking to ${roomLabel(s, a.to)}`);
    case 'talk': {
      const n = npcName(s, a.npcId);
      return cap(`Talking with ${n.name}${n.detail ? ` (${n.detail})` : ''}`);
    }
    case 'examine': {
      const m = EXAM_BY_ID[a.maneuver];
      const where = `Examining ${bedOf(s, a.patientId)}`;
      if (!m) return cap(`${where} — ${a.maneuver}`);
      const full = `${where} — ${m.system.toLowerCase()}: ${m.label.replace(/\s*\([^)]*\)/g, '')}`;
      return full.length <= ACTIVITY_MAX ? full : cap(`${where} — ${m.system.toLowerCase()}`);
    }
    case 'inspect': {
      const hit = itemById(s, a.itemId);
      return cap(`Looking at ${hit ? hit.item.label.replace(/\s*\([^)]*\)/g, '') : a.itemId}`);
    }
    case 'give_item': {
      const hit = itemById(s, a.itemId);
      return cap(`Handing back ${hit ? hit.item.label.replace(/\s*\([^)]*\)/g, '') : a.itemId}`);
    }
    case 'order': {
      const items = burst?.length ? burst : [orderShort(a.code, a.params?.dose)];
      const bed = ` (${bedOf(s, a.patientId)})`;
      let list = items.join(', ');
      for (let k = items.length - 1; k >= 1 && `Ordering ${list}${bed}`.length > ACTIVITY_MAX; k--) list = `${items.slice(0, k).join(', ')} +${items.length - k}`;
      return cap(`Ordering ${list}${bed}`);
    }
    case 'cancel_order': {
      for (const p of s.patients.values()) {
        const o = p.orders.find((x) => x.id === a.orderId);
        if (o) return cap(`Cancelling ${orderShort(o.code)} (${p.bedLabel})`);
      }
      return 'Cancelling an order';
    }
    case 'ehr_view':
      if (a.section === 'board') return 'Reading the tracking board';
      return cap(`Reading ${bedOf(s, a.patientId)} chart — ${a.section}${a.query ? ` “${a.query}”` : ''}`);
    case 'sign_ecg': {
      const p = patientOfEcg(s, a.ecgId);
      return cap(`Reading & signing the ${p ? `${p.bedLabel} ` : ''}ECG`);
    }
    case 'note':
      return cap(`Writing a note — ${bedOf(s, a.patientId)}`);
    case 'set_diagnoses':
      return cap(`Working diagnosis ${bedOf(s, a.patientId)}: ${a.diagnoses[0] ?? '—'}`);
    case 'disposition':
      return cap(`Disposition ${bedOf(s, a.patientId)}: ${DISPO_LABELS[a.decision] ?? a.decision}`);
    case 'assign_self':
      return cap(`Signing up for ${bedOf(s, a.patientId)}`);
    case 'mark_read':
      return cap(`Reviewing ${bedOf(s, a.patientId)} results`);
    case 'ack_page':
      return 'Reading a page';
    case 'call':
      return cap(`Calling ${contactLabel(s, a.contactId)}`);
    case 'hangup':
      return 'Hanging up the phone';
    case 'escalate':
      return cap(`Escalating ${bedOf(s, a.patientId)} — ${a.mode === 'call' ? 'phoning the attending' : 'attending to the bedside'}`);
    case 'hygiene':
      return a.kind === 'rub' ? 'Cleaning hands (alcohol rub)' : a.kind === 'wash' ? 'Washing hands' : a.kind === 'mask_on' ? 'Putting on a mask' : 'Taking off the mask';
    case 'wait':
      return cap(`Waiting ${Math.round(a.minutes)} min`);
    case 'end_shift':
      return 'Ending the shift';
    default:
      return cap(String((a as { type?: string }).type ?? 'Working'));
  }
}

/**
 * Where the avatar stands after action `a` (pure apart from session lookups):
 * talk/examine → that patient's bedside; orders/EHR/notes → a workstation seat (sitting);
 * calls → by the station or workroom phone; moves → the room entry (bay: foot of the bed,
 * station: the tracking board). Anything that does not fit keeps the previous spot.
 */
export function nextPose(s: GameSession, prev: DoctorPose, a: Action, ok: boolean, burst?: string[]): DoctorPose {
  const loc = s.playerLocation;
  const keep = prev.location === loc ? { spot: prev.spot, posture: prev.posture } : { spot: spotIn(s, loc, 'entry'), posture: 'stand' as Posture };
  const stand = (spot: string) => ({ spot, posture: 'stand' as Posture });
  let where = keep;
  if (ok) {
    switch (a.type) {
      case 'move':
        where = stand(isBay(s, loc) ? spotIn(s, loc, 'foot', 'entry') : loc === 'station' ? 'board' : 'entry');
        break;
      case 'talk': {
        const n = npcName(s, a.npcId);
        if (n.room !== loc) break;
        if (n.kind === 'patient') where = stand(isBay(s, loc) ? spotIn(s, loc, 'bedside', 'bedside_l', 'foot') : spotIn(s, loc, 'tech', 'entry'));
        else if (isBay(s, loc)) where = stand(spotIn(s, loc, 'foot', 'bedside'));
        else if (loc === 'station') where = stand('board');
        else where = stand('entry');
        break;
      }
      case 'examine': {
        const p = s.patients.get(a.patientId);
        if (p && p.location === loc) where = stand(isBay(s, loc) ? spotIn(s, loc, 'bedside', 'bedside_l', 'foot') : spotIn(s, loc, 'tech', 'entry'));
        break;
      }
      case 'give_item': {
        // beside the patient, to hand it over
        const hit = itemById(s, a.itemId);
        if (hit && hit.p.bed === loc) where = stand(spotIn(s, loc, 'bedside', 'foot', 'entry'));
        break;
      }
      case 'inspect': {
        const hit = itemById(s, a.itemId);
        if (hit && hit.p.bed === loc) where = stand(spotIn(s, loc, hit.item.where === 'bedside' ? 'bedside' : 'foot', 'entry'));
        break;
      }
      case 'order':
      case 'cancel_order':
      case 'ehr_view':
      case 'sign_ecg':
      case 'note':
      case 'set_diagnoses':
      case 'disposition':
      case 'assign_self':
      case 'mark_read':
      case 'ack_page':
      case 'wait': {
        // charting happens at a desk; at the bedside (dx, dispo, notes) the doctor stays put
        const desk = seat(s, loc, 'desk');
        if (desk.spot !== 'entry' || loc === 'triage') where = desk;
        break;
      }
      case 'call':
      case 'hangup': {
        const phone = seat(s, loc, 'phone');
        if (phone.spot !== 'entry') where = phone;
        break;
      }
    }
  }
  const activity = describeAction(s, a, a.type === 'order' && ok ? burst : undefined);
  return { location: loc, ...where, activity: ok ? activity : cap(`${activity} — failed`) };
}

/** after each action of an agent session: new pose/activity, bubble, and the pacing gap */
export function recordAction(s: GameSession, a: Action, result: ActionResult, now = Date.now()): void {
  const st = registry.get(s);
  if (!st) return;
  const prev = st.pose;
  if (a.type === 'order') {
    if (result.ok) {
      const item = orderShort(a.code, a.params?.dose);
      if (st.burst?.pid === a.patientId) st.burst.items.push(item);
      else st.burst = { pid: a.patientId, items: [item] };
    }
  } else st.burst = null;
  st.pose = nextPose(s, prev, a, result.ok, st.burst?.items);
  // what the doctor says out loud to someone is its speech bubble too
  if ((a.type === 'talk' || a.type === 'call') && result.ok) setBark(st, s, a.text);
  st.readyAt = now + gapMs(s, st.paceMs, prev, st.pose, a);
  s.dirty = true;
}

/**
 * Real-time gap after an action: the pace, stretched to the avatar's walk (≈1.3 m/s along the
 * navmesh, ~35% longer than the straight line) up to 4× the pace; a burst of orders at one
 * desk goes faster. 0 when pacing is off.
 */
export function gapMs(s: GameSession, paceMs: number, prev: DoctorPose, next: DoctorPose, a: Action): number {
  if (paceMs <= 0) return 0;
  const p = spotFor(s.layout, prev.location, prev.spot);
  const q = spotFor(s.layout, next.location, next.spot);
  const walkMs = p && q ? (Math.hypot(p.x - q.x, p.z - q.z) * 1.35 * 1000) / 1.3 : 0;
  if (a.type === 'order' && walkMs < 300) return Math.round(paceMs * 0.6);
  return Math.round(Math.min(Math.max(paceMs, walkMs), paceMs * 4));
}

// ───────────────────────────── pacing ─────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function paceToMs(sec: unknown): number {
  const n = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0;
  return Math.round(Math.max(0, Math.min(MAX_PACE_SEC, n)) * 1000);
}

/**
 * Run an agent action at watchable speed: waits until the previous action's gap has passed
 * (agent think time counts toward it) and runs one action at a time. Human sessions and
 * pace 0 run immediately.
 */
export function paced<T>(s: GameSession, fn: () => Promise<T>): Promise<T> {
  const st = registry.get(s);
  if (!st) return fn();
  const run = st.chain.then(async () => {
    const wait = Math.min(st.readyAt - Date.now(), MAX_WAIT_MS);
    if (st.paceMs > 0 && wait > 0 && !s.ended) await sleep(wait);
    return fn();
  });
  st.chain = run.catch(() => undefined);
  return run;
}

/** set the watch pace (seconds between actions, 0–10); returns the value applied */
export function setPace(s: GameSession, sec: unknown): number | null {
  const st = registry.get(s);
  if (!st) return null;
  st.paceMs = paceToMs(sec);
  if (st.paceMs === 0) st.readyAt = 0;
  s.dirty = true;
  return st.paceMs / 1000;
}

// ───────────────────────────── narration ─────────────────────────────

/** strip control/bidi characters, normalize newlines, cap the length */
export function cleanNarrationText(raw: string, max = NARRATION_MAX_CHARS): string {
  const t = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​‪-‮⁦-⁩]/g, '')
    .replace(/[  ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** the speech-bubble version of a thought: its first sentence(s), ≤ 140 characters */
export function snippet(text: string, max = 140): string {
  const first = text.replace(/^[#>*\-\s]+/, '').split('\n').find((l) => l.trim()) ?? '';
  const line = first.replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end >= 12 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…';
}

function setBark(st: DoctorState, s: GameSession, text: string) {
  const b = snippet(text);
  if (!b) return;
  // bark.t only has to change for the 3D client to pop a new bubble; several lines can share a game second
  st.barkSeq = (st.barkSeq + 1) % 1000;
  st.bark = { text: b, t: s.t + st.barkSeq / 1000 };
}

function push(s: GameSession, st: DoctorState, e: { kind: NarrationKind; text: string; patientId?: string; tone?: NarrationEntry['tone'] }, now = Date.now()): NarrationEntry {
  const entry: NarrationEntry = { id: ++st.seq, t: s.t, at: now, kind: e.kind, text: e.text };
  if (e.patientId) entry.patientId = e.patientId;
  if (e.tone) entry.tone = e.tone;
  st.feed.push(entry);
  if (st.feed.length > NARRATION_RING) st.feed.splice(0, st.feed.length - NARRATION_RING);
  if (e.kind === 'thought' || e.kind === 'reflection') setBark(st, s, e.text);
  st.feedDirty = true;
  s.emit({ kind: 'narration', entry });
  return entry;
}

export interface HttpReply {
  status: number;
  body: Record<string, unknown>;
}

const USAGE = 'Body must be {"text": "…", "kind"?: "thought" | "action" | "result" | "reflection", "patientId"?: "p_…"}';

/** POST /api/sessions/:id/narration — validated, size-capped, rate-limited, ring-buffered, emitted live */
export function narrationRequest(s: GameSession, body: unknown, now = Date.now()): HttpReply {
  const st = registry.get(s);
  if (!st) return { status: 409, body: { error: 'Narration is only accepted for agent-driven sessions (created with POST /api/sessions).' } };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: USAGE } };
  const b = body as Record<string, unknown>;
  if (typeof b.text !== 'string') return { status: 400, body: { error: USAGE } };
  const kind = (b.kind ?? 'thought') as NarrationKind;
  if (!AGENT_KINDS.includes(kind)) return { status: 400, body: { error: `kind must be one of ${AGENT_KINDS.join(', ')}` } };
  if (b.patientId !== undefined && typeof b.patientId !== 'string') return { status: 400, body: { error: 'patientId must be a string' } };
  const text = cleanNarrationText(b.text);
  if (!text) return { status: 400, body: { error: 'text is empty' } };
  // token bucket
  const bk = st.bucket;
  bk.tokens = Math.min(NARRATION_BURST, bk.tokens + ((now - bk.at) / 1000) * NARRATION_PER_SEC);
  bk.at = now;
  if (bk.tokens < 1) return { status: 429, body: { error: `Too many narration lines: at most ${NARRATION_PER_SEC}/s (bursts of ${NARRATION_BURST}).`, retryAfterMs: Math.ceil(((1 - bk.tokens) / NARRATION_PER_SEC) * 1000) } };
  bk.tokens -= 1;
  const patientId = typeof b.patientId === 'string' && s.patients.has(b.patientId) ? b.patientId : undefined;
  const entry = push(s, st, { kind, text, patientId, tone: kind === 'result' && /^(✗|failed)/i.test(text) ? 'warn' : undefined }, now);
  return { status: 201, body: { ok: true, id: entry.id } };
}

/** GET /api/sessions/:id/narration[?since=<id>] */
export function narrationEntries(s: GameSession, sinceId = 0): NarrationEntry[] {
  return (registry.get(s)?.feed ?? []).filter((e) => e.id > sinceId);
}

/** server-side lines (lifecycle, debrief): not rate-limited */
export function systemNote(s: GameSession, text: string, tone?: NarrationEntry['tone'], kind: 'system' | 'event' = 'system'): void {
  const st = registry.get(s);
  if (st) push(s, st, { kind, text: cleanNarrationText(text), tone });
}

/** notable simulation events become feed lines so the transcript shows what the agent reacted to */
export function feedFromEvent(s: GameSession, e: GameEvent): void {
  const st = registry.get(s);
  if (!st) return;
  switch (e.kind) {
    case 'page':
      push(s, st, { kind: 'event', text: `📟 ${e.page.from}: ${e.page.text}`, patientId: e.page.patientId, tone: e.page.priority === 'critical' ? 'bad' : e.page.priority === 'urgent' ? 'warn' : 'info' });
      break;
    case 'result':
      push(s, st, { kind: 'event', text: `🧪 ${e.text}`, patientId: e.patientId, tone: e.critical ? 'bad' : 'info' });
      break;
    case 'arrival':
      push(s, st, { kind: 'event', text: `🚑 ${e.text}`, patientId: e.patientId, tone: 'info' });
      break;
    case 'alarm':
      push(s, st, { kind: 'event', text: `🔔 ${e.text}`, patientId: e.patientId, tone: 'bad' });
      break;
    case 'toast':
      if (!s.ended) push(s, st, { kind: 'event', text: e.text, tone: e.tone ?? 'info' });
      break;
  }
}

/** true once per change of the feed — lets the server re-save the run log's transcript */
export function takeFeedDirty(s: GameSession): boolean {
  const st = registry.get(s);
  if (!st?.feedDirty) return false;
  st.feedDirty = false;
  return true;
}

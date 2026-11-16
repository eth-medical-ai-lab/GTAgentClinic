/**
 * Escalate to the attending (Action `escalate`): the resident asks the supervising attending for
 * help with a patient, at the bedside now or on the phone.
 *
 * bedside: she drops what she is doing (her current task ends) and pages "On my way to Bed 4.".
 *   She walks there through the ordinary staff task queue, as a nurse walks to a bay: a
 *   top-priority 'escalate' task, so the 3D client animates the walk. After a minute to get up and
 *   the walk, she arrives, says a short opener aloud (bark) and is talkable there. After STAY_MIN
 *   game minutes she goes back where she was (her desk, or board rounds if they started meanwhile).
 *   If the patient is still unstable she stays instead, re-checking every RECHECK_MIN.
 * call: her line ("ED attending — Dr. Shaw", contact id `attending`) opens at the top of the phone
 *   directory and she picks up. The conversation runs in server/npc/dialogue.ts with her own staff
 *   persona, so she is the same character as in person.
 *
 * Both modes put the escalation into her [Situation] (dialogue.ts → staffSituation): the patient,
 * the reason, and the vitals and monitor alarms at that moment. When the patient is unstable
 * (`assess`), she drops the Socratic teaching and gives direct stabilization guidance first.
 *
 * Deterministic: no randomness, and walking times come from the layout. Not scored: the debrief
 * lists every escalation.
 */
import { monitorAlarms } from '../../shared/alarms';
import { roomById, walkSeconds } from '../../shared/layout';
import type { Action, ActionResult, ChatLine, Contact, EscalationMode, EscalationRecord, EscalationView, Posture, Vitals } from '../../shared/types';
import { map as mapOf } from '../../shared/units';
import type { Conversation, GameSession, PatientState, StaffState, Task } from './session';

/** game seconds per minute (session.ts `M`; kept local so this module imports session.ts for types only) */
const MIN = 60;

/** contact id of the attending's phone line */
export const ATTENDING_LINE = 'attending';
const LINE_EXTENSION = 'x4000';
/** minutes she takes to drop what she is doing before she walks over */
export const SET_OFF_MIN = 1;
/** minutes she stays at the bedside before going back, if the patient is stable by then */
export const STAY_MIN = 10;
/** while the patient stays unstable she stays too, re-checking this often (minutes) */
export const RECHECK_MIN = 5;
/** a critical page counts as active while unread, or for this long after it was sent (minutes) */
const CRITICAL_PAGE_MIN = 30;
const LETHAL_RHYTHMS: Record<string, string> = { vt: 'VT', vf: 'VF', asystole: 'asystole' };

/** the patient as the attending finds them: measured vitals, monitor alarms, and whether that is unstable */
export interface Assessment {
  /** HR, BP, RR, SpO₂ (+ O₂ delivery) as the bedside monitor would read them this minute, and GCS */
  vitals: Vitals;
  onMonitor: boolean;
  /** monitor alarm labels (only when the patient is on a monitor) */
  alarms: string[];
  /** active critical pages about this patient ("22:31 Aisha (RN): …") */
  criticalPages: string[];
  unstable: boolean;
  /** the criteria met, e.g. "SBP 84 < 90" (empty when stable) */
  why: string[];
  /** the most pressing finding in spoken words, for her opener ("pressure's 84 over 50") */
  headline?: string;
}

interface Place {
  location: string;
  spot: string;
  posture: Posture;
  activity?: string;
}

export interface EscalationState {
  id: string;
  pid: string;
  mode: EscalationMode;
  reason?: string;
  t: number;
  attendingId: string;
  /** the patient at the moment of escalation (her context and the debrief) */
  snapshot: Assessment;
  status: 'en_route' | 'at_bedside' | 'on_call' | 'done';
  etaT?: number;
  arrivedT?: number;
  endedT?: number;
  /** what she said first: the arrival bark, or picking up the phone */
  opener?: string;
  /** where she goes back to afterwards */
  returnTo?: Place;
  /** she already said she is staying (patient still unstable) */
  stayed?: boolean;
}

// ───────────────────────────── names ─────────────────────────────

/** the attending on duty: the scenario's first staff member with that role */
export function attendingOf(s: GameSession): StaffState | undefined {
  for (const st of s.staff.values()) if (st.def.role === 'attending') return st;
  return undefined;
}

const surname = (name: string) => name.replace(/^Dr\.?\s+/, '').trim().split(/\s+/).pop() ?? name;

/** "Dr. Evelyn Shaw" → "Dr. Shaw" */
export function drName(name: string): string {
  return /^Dr\.?\s/.test(name) ? `Dr. ${surname(name)}` : name;
}

/** how she addresses the patient: "Mrs. Brunner", "Mr. Okafor" */
function patientRef(p: PatientState): string {
  const pt = p.c.patient;
  return `${pt.sex === 'F' ? (pt.age >= 60 ? 'Mrs.' : 'Ms.') : 'Mr.'} ${pt.lastName}`;
}

function pron(p: PatientState) {
  return p.c.patient.sex === 'F' ? { subj: 'she', obj: 'her', poss: 'her' } : { subj: 'he', obj: 'him', poss: 'his' };
}

/** "HR 118, BP 84/50 (MAP 61), RR 26, SpO₂ 93% on RA, GCS 13" */
export function vitalsText(v: Vitals): string {
  const parts: string[] = [];
  if (v.hr !== undefined) parts.push(`HR ${v.hr}`);
  if (v.sbp !== undefined && v.dbp !== undefined) parts.push(`BP ${v.sbp}/${v.dbp} (MAP ${mapOf(v)})`);
  if (v.rr !== undefined) parts.push(`RR ${v.rr}`);
  if (v.spo2 !== undefined) parts.push(`SpO₂ ${v.spo2}% on ${v.o2 ?? 'RA'}`);
  if (v.gcs !== undefined) parts.push(`GCS ${v.gcs}`);
  return parts.join(', ');
}

// ───────────────────────────── stability ─────────────────────────────

/**
 * Is the patient unstable right now? Vitals as the bedside monitor would read them this minute,
 * whether or not the patient is on one. Unstable = any of: SBP < 90 or MAP < 65; SpO₂ < 90 %;
 * GCS ≤ 8, or down ≥ 2 points from its best in the last hour; a lethal rhythm; an active critical
 * page (unread, or sent in the last 30 min).
 */
export function assess(s: GameSession, p: PatientState): Assessment {
  const m = s.minutesSinceArrival(p);
  const ph = p.physio;
  const hr = Math.round(ph.measured('hr', m));
  const sbp = Math.round(ph.measured('sbp', m));
  const dbp = Math.round(ph.measured('dbp', m));
  const rr = Math.round(ph.measured('rr', m));
  const spo2 = Math.min(100, Math.round(ph.measured('spo2', m)));
  const gcs = Math.round(ph.value('gcs', m));
  const vitals: Vitals = { hr, sbp, dbp, rr, spo2, gcs, o2: p.o2 ?? 'RA' };
  const map = mapOf(vitals) ?? 0;
  const rhythm = p.c.ecg.params.rhythm;
  const alarms = p.onMonitor ? monitorAlarms({ hr, sbp, spo2, rhythm }).map((a) => a.label) : [];
  let best = gcs;
  for (let k = 5; k <= 60; k += 5) best = Math.max(best, Math.round(ph.value('gcs', Math.max(0, m - k))));
  const crit = s.pages.filter((pg) => pg.patientId === p.id && pg.priority === 'critical' && (!pg.read || s.t - pg.t <= CRITICAL_PAGE_MIN * MIN));
  const pr = pron(p);
  const why: string[] = [];
  let headline: string | undefined;
  const lethal = LETHAL_RHYTHMS[rhythm];
  if (lethal) {
    why.push(`${lethal} on the monitor`);
    headline ??= `${lethal} on the monitor`;
  }
  if (sbp < 90) {
    why.push(`SBP ${sbp} < 90`);
    headline ??= `pressure's ${sbp} over ${dbp}`;
  }
  if (map < 65) {
    why.push(`MAP ${map} < 65`);
    headline ??= `MAP's ${map}`;
  }
  if (spo2 < 90) {
    why.push(`SpO₂ ${spo2}% < 90`);
    headline ??= `sats are ${spo2} percent`;
  }
  if (gcs <= best - 2) {
    why.push(`GCS ${gcs}, down from ${best} within the hour`);
    headline ??= `${pr.subj}'s getting drowsier, GCS ${gcs}`;
  } else if (gcs <= 8) {
    why.push(`GCS ${gcs} ≤ 8`);
    headline ??= `GCS ${gcs}, think about ${pr.poss} airway`;
  }
  if (crit.length) {
    const last = crit[crit.length - 1];
    why.push(crit.length > 1 ? `${crit.length} critical pages (latest ${s.clock(last.t)})` : `critical page at ${s.clock(last.t)}`);
    headline ??= 'I saw the critical page';
  }
  return { vitals, onMonitor: p.onMonitor, alarms, criticalPages: crit.map((pg) => `${s.clock(pg.t)} ${pg.from}: "${pg.text}"`), unstable: why.length > 0, why, headline };
}

// ───────────────────────────── the action ─────────────────────────────

const live = (e: EscalationState) => e.status === 'en_route' || e.status === 'at_bedside';

/** her bedside escalation in progress (on her way, or there), if any */
export function activeVisit(s: GameSession, staffId: string): EscalationState | undefined {
  return s.escalations.findLast((e) => e.attendingId === staffId && live(e));
}

/** the escalation her phone line is about (the latest by phone); none = the line is not open */
export function lineEscalation(s: GameSession): EscalationState | undefined {
  return s.escalations.findLast((e) => e.mode === 'call');
}

export function escalate(s: GameSession, a: Extract<Action, { type: 'escalate' }>): ActionResult {
  const p = typeof a.patientId === 'string' ? s.patients.get(a.patientId) : undefined;
  if (!p) return { ok: false, message: `Unknown patient "${a.patientId}": use a patientId from the board (e.g. ${s.presentPatients()[0]?.id ?? 'p_…'}).` };
  if (!p.arrived) return { ok: false, message: `${p.c.patient.lastName} has not arrived yet.` };
  if (p.departed) return { ok: false, message: `${p.c.patient.lastName} has left the department.` };
  if (p.discharge?.phase === 'leaving') return { ok: false, message: 'The patient is on the way to the exit.' };
  if (a.mode !== 'bedside' && a.mode !== 'call') return { ok: false, message: 'mode must be "bedside" (she comes now) or "call" (talk it through on the phone).' };
  const st = attendingOf(s);
  if (!st) return { ok: false, message: 'There is no attending on duty to escalate to.' };
  const who = drName(st.def.name);
  const cur = activeVisit(s, st.def.id);
  if (cur?.pid === p.id && (a.mode === 'bedside' || cur.status === 'at_bedside')) {
    const msg = cur.status === 'en_route' ? `${who} is already on her way to ${p.bedLabel} (expected ${s.clock(cur.etaT ?? s.t)}).` : `${who} is already at ${p.bedLabel}: talk to her there.`;
    return { ok: true, message: msg, data: { escalationId: cur.id } };
  }
  const reason = typeof a.reason === 'string' ? a.reason.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined : undefined;
  const e: EscalationState = { id: `esc${s.escalations.length + 1}`, pid: p.id, mode: a.mode, reason, t: s.t, attendingId: st.def.id, snapshot: assess(s, p), status: a.mode === 'bedside' ? 'en_route' : 'on_call' };
  s.escalations.push(e);
  s.logEvent({ kind: 'escalate', pid: p.id, decision: a.mode, text: reason });
  s.dirty = true;
  if (a.mode === 'bedside') {
    sendToBedside(s, st, p, e);
    const mins = Math.max(1, Math.ceil(((e.etaT ?? s.t) - s.t) / MIN));
    return { ok: true, message: `${who} is on her way to ${p.bedLabel} (about ${mins} min). Talk to her there once she arrives.`, data: { escalationId: e.id, etaT: e.etaT } };
  }
  openLine(s, st, p, e);
  return { ok: true, text: `${who} picked up (phone line "${ATTENDING_LINE}"): "${e.opener}" Answer her with call (contactId "${ATTENDING_LINE}"); her line works from anywhere.`, data: { escalationId: e.id, contactId: ATTENDING_LINE } };
}

// ───────────────────────────── bedside ─────────────────────────────

function sendToBedside(s: GameSession, st: StaffState, p: PatientState, e: EscalationState) {
  // she drops what she is doing: an earlier visit ends (she goes on from there), her current task stops
  let returnTo: Place | undefined;
  for (const x of s.escalations) {
    if (x === e || x.attendingId !== st.def.id || !live(x)) continue;
    returnTo ??= x.returnTo;
    x.status = 'done';
    x.endedT = s.t;
  }
  e.returnTo = returnTo ?? { location: st.location, spot: st.spot, posture: st.posture, activity: st.activity };
  for (const q of st.queue) if (q.kind === 'escalate') q.canceled = true;
  if (st.current) {
    st.current.canceled = true;
    st.current.endT = s.t;
  }
  const where = p.location !== p.bed ? p.location : p.bed;
  // an estimate until she sets off (session.processStaff starts the task on its next pass)
  e.etaT = s.t + walkSeconds(s.layout, st.location, where) + SET_OFF_MIN * MIN;
  st.activity = `Coming to ${p.bedLabel} — escalation`;
  s.enqueue(st.def.id, visitTask(s, st, p, e, SET_OFF_MIN + STAY_MIN, `Coming to ${p.bedLabel} — escalation`));
  s.page(`${drName(st.def.name)} (attending)`, `On my way to ${p.bedLabel}.`, 'info', p.id);
  // her task never started (the patient left first, which cancels queued tasks): she is not "on her way" forever
  s.at(e.etaT + 5 * MIN, () => {
    if (e.status === 'en_route') endVisit(s, st, p, e);
  });
}

/** where she stands in the room: the foot of the bed, else beside it (in Fast Track the stool takes 'bedside') */
function bedsideSpot(s: GameSession, room: string): string {
  const r = roomById(s.layout, room);
  for (const n of ['foot', 'bedside_l', 'bedside']) if (r?.spots[n]) return n;
  return 'entry';
}

/** her walk there plus the stay (or one more re-check), as a task in her queue */
function visitTask(s: GameSession, st: StaffState, p: PatientState, e: EscalationState, minutes: number, label: string): Omit<Task, 'id' | 'staffId' | 'createdT'> {
  return {
    kind: 'escalate',
    pid: p.id,
    orderIds: [],
    location: p.bed,
    durationMin: minutes,
    priority: -1, // ahead of anything else in her queue
    label,
    meta: { escalationId: e.id },
    onStart: (task) => {
      st.spot = bedsideSpot(s, st.location);
      st.activity = label;
      if (e.status !== 'en_route') return;
      // the walk is timed by processStaff; she arrives after getting up and walking, then stays STAY_MIN
      e.etaT = (task.endT ?? s.t) - STAY_MIN * MIN;
      s.at(e.etaT, () => arrive(s, st, p, e));
    },
    done: () => visitOver(s, st, p, e),
  };
}

function arrive(s: GameSession, st: StaffState, p: PatientState, e: EscalationState) {
  if (e.status !== 'en_route') return;
  if (p.departed) return endVisit(s, st, p, e);
  e.status = 'at_bedside';
  e.arrivedT = s.t;
  st.activity = `With ${p.bedLabel} — escalation`;
  if (p.firstContactT === undefined) p.firstContactT = s.t; // a physician has seen the patient
  const now = assess(s, p);
  e.opener = now.unstable ? `I'm here. ${capital(now.headline ?? 'this looks sick')} — let's stabilize ${pron(p).obj} first. What's running so far?` : `What's going on with ${patientRef(p)}?`;
  // the opener also starts her transcript on the tablet
  const opening = pushLine(s, st.def.id, st.def.name, e.opener, { npcId: st.def.id });
  s.bark(st.def.id, e.opener, opening.id);
  s.dirty = true;
}

/** the stay (or a re-check) is over: she stays with an unstable patient, otherwise she goes back */
function visitOver(s: GameSession, st: StaffState, p: PatientState, e: EscalationState) {
  if (e.status !== 'at_bedside') return;
  if (!p.departed && assess(s, p).unstable) {
    if (!e.stayed) {
      e.stayed = true;
      s.bark(st.def.id, `I'm staying until ${pron(p).subj}'s more stable.`);
    }
    s.enqueue(st.def.id, visitTask(s, st, p, e, RECHECK_MIN, `Staying at ${p.bedLabel} — not stable yet`));
    return;
  }
  endVisit(s, st, p, e);
}

/** Release the attending as soon as a home discharge takes the patient off the unit. */
export function endBedsideVisitOnExit(s: GameSession, p: PatientState) {
  const e = s.escalations.findLast(e => e.pid === p.id && live(e));
  const st = e && s.staff.get(e.attendingId);
  if (e && st) endVisit(s, st, p, e);
}

function endVisit(s: GameSession, st: StaffState, p: PatientState, e: EscalationState) {
  e.status = 'done';
  e.endedT = s.t;
  if (st.current?.meta?.escalationId === e.id) {
    st.current.canceled = true;
    st.current.endT = s.t;
  }
  for (const q of st.queue) if (q.meta?.escalationId === e.id) q.canceled = true;
  if (!p.departed && p.discharge?.phase !== 'leaving') {
    s.bark(st.def.id, `Call me if anything changes with ${patientRef(p)}.`);
    st.nextBarkT = Math.max(st.nextBarkT, s.t + 5 * MIN); // let the parting line stand before any small talk
  }
  goBack(s, st, e.returnTo);
}

const seated = (spot: string) => spot.startsWith('desk') || spot.startsWith('chair') || spot === 'nurse';

function goBack(s: GameSession, st: StaffState, to?: Place) {
  const home = st.def.home;
  const dest: Place = to ?? { location: home.room, spot: home.spot, posture: seated(home.spot) ? 'sit' : 'stand' };
  st.location = dest.location;
  st.spot = dest.spot;
  st.posture = dest.posture;
  st.activity = dest.activity;
  st.idleSinceT = s.t;
  s.dirty = true;
  // finishing a task clears the activity (session.processStaff): put e.g. "Board rounds" back on the next pass
  const act = dest.activity;
  if (act) s.at(s.t + 1, () => {
    if (!st.current && st.location === dest.location && !st.activity) st.activity = act;
  });
}

/** board rounds (or anything else) want her somewhere while she is on an escalation: she goes there afterwards */
export function holdForEscalation(s: GameSession, staffId: string, place: Place): boolean {
  const e = activeVisit(s, staffId);
  if (!e) return false;
  e.returnTo = place;
  return true;
}

/** talking to her while she is still walking over: not yet (she is talkable once she is there) */
export function attendingEnRoute(s: GameSession, npcId: string): string | null {
  const e = s.escalations.findLast((x) => x.attendingId === npcId && x.status === 'en_route');
  if (!e) return null;
  const st = s.staff.get(npcId);
  const p = s.patients.get(e.pid);
  return `${st ? drName(st.def.name) : 'The attending'} is on her way to ${p?.bedLabel ?? 'the patient'} (expected ${s.clock(e.etaT ?? s.t)}): talk to her there once she arrives.`;
}

// ───────────────────────────── phone ─────────────────────────────

function pushLine(s: GameSession, key: string, title: string, text: string, extra: Partial<Conversation>, speaker: ChatLine['speaker'] = 'npc', name = title) {
  let c = s.conversations.get(key);
  if (!c) {
    c = { key, title, lines: [], typing: false, history: [], ...extra };
    s.conversations.set(key, c);
  }
  const line = { id: `esc-l${++s.nextChatLine}`, t: s.t, speaker, name, text };
  c.lines.push(line);
  return line;
}

/** her line in the phone directory (top of the list once it is open) */
export function attendingLineContact(s: GameSession): Contact | undefined {
  const e = lineEscalation(s);
  const st = e && s.staff.get(e.attendingId);
  if (!e || !st) return undefined;
  return {
    id: ATTENDING_LINE,
    name: `ED attending — ${drName(st.def.name)}`,
    role: `${st.def.name}, your supervising attending`,
    org: 'Grand Therapies Medical Center',
    phone: LINE_EXTENSION,
    kind: 'internal',
    description: 'Your attending: talk a patient through on the phone.',
    patientId: e.pid,
  };
}

function openLine(s: GameSession, st: StaffState, p: PatientState, e: EscalationState) {
  // a phone contact for her voice (server/tts casts phone lines from session.playerContacts)
  if (!s.playerContacts.has(ATTENDING_LINE)) {
    const persona = st.def.persona;
    s.playerContacts.set(ATTENDING_LINE, {
      contact: { id: ATTENDING_LINE, name: `ED attending — ${drName(st.def.name)}`, role: 'Supervising attending', org: 'Grand Therapies Medical Center', phone: LINE_EXTENSION, kind: 'internal' },
      voice: st.def.voice,
      persona: { personality: persona?.personality ?? 'ED attending', voice: persona?.voice ?? 'Calm, concise', healthLiteracy: 'high', opening: `${surname(st.def.name)}.`, facts: [], unknowns: [], behavior: persona?.rules ?? [], capacity: 'intact', fallback: 'Go ahead.' },
    });
  }
  e.opener = `${surname(st.def.name)}. What's going on with ${patientRef(p)}${e.snapshot.unstable ? ` — is ${pron(p).subj} stable right now?` : '?'}`;
  ringLine(s, e);
}

/** her phone rings and she picks up with the escalation's opener; mid-call she turns to the new patient */
export function ringLine(s: GameSession, e: EscalationState): void {
  const c = attendingLineContact(s);
  const p = s.patients.get(e.pid);
  if (!c || !p) return;
  const key = `phone:${ATTENDING_LINE}`;
  const conv = s.conversations.get(key);
  const inCall = !!conv?.lines.length && conv.lines[conv.lines.length - 1].text !== 'Call ended.';
  const extra = { contactId: ATTENDING_LINE, pid: e.pid };
  if (!inCall) {
    pushLine(s, key, c.name, `Calling ${c.name} (${c.phone})…`, extra, 'system', 'Phone');
    s.logEvent({ kind: 'call', contactId: ATTENDING_LINE, pid: e.pid });
  } else {
    pushLine(s, key, c.name, `Escalating ${p.bedLabel} (${p.c.patient.lastName})${e.reason ? `: ${e.reason}` : ''}`, extra, 'system', 'Phone');
  }
  const opener = e.opener ?? `${surname(c.name)}.`;
  const opening = pushLine(s, key, c.name, opener, extra);
  if (conv) conv.pid = e.pid;
  s.emit({ kind: 'speech', lineId: opening.id, contactId: ATTENDING_LINE, name: opening.name, text: opening.text });
  s.dirty = true;
}

// ───────────────────────────── her context ─────────────────────────────

const UNSTABLE_GUIDE =
  'The patient is UNSTABLE: drop the Socratic teaching for now. Tell the resident directly and specifically what to do to stabilize, in priority order (airway and breathing; circulation: access, monitor, fluids or vasopressors; oxygen; time-critical drugs; who else to call), and check each step is being done. Say only what is needed now; teach once the patient is stable.';
const STABLE_GUIDE = 'The patient is not unstable right now: let the resident present, give brief feedback and teach Socratically with one question, but correct anything unsafe directly.';

/**
 * The escalations for the attending's [Situation] (dialogue.ts): the bedside visit in progress, the
 * latest phone escalation (last hour) and visits that ended in the last 30 min.
 */
export function escalationSituation(s: GameSession, staffId: string): string {
  const line = lineEscalation(s);
  const relevant = s.escalations.filter((e) => e.attendingId === staffId && (live(e) || (e === line && s.t - e.t <= 60 * MIN) || (e.status === 'done' && e.mode === 'bedside' && s.t - (e.endedT ?? e.t) <= 30 * MIN)));
  const out: string[] = [];
  for (const e of relevant.slice(-3).reverse()) {
    const p = s.patients.get(e.pid);
    if (!p) continue;
    const pt = p.c.patient;
    const snap = e.snapshot;
    const how = e.mode === 'bedside' ? 'asked you to come to the bedside' : 'called you on the phone';
    let txt = `ESCALATION at ${s.clock(e.t)}: the resident ${how} about ${p.bedLabel}, ${pt.firstName} ${pt.lastName} (${pt.age}${pt.sex}, "${p.c.presentation.chiefComplaint}"); reason given: ${e.reason ? `"${e.reason}"` : 'none'}. At that moment: ${vitalsText(snap.vitals)}; monitor alarms: ${snap.alarms.join(', ') || (snap.onMonitor ? 'none' : 'not on a monitor')}; critical pages: ${snap.criticalPages.join(' | ') || 'none'}.`;
    if (e.status === 'done') {
      txt += ` You went to the bedside${e.arrivedT !== undefined ? ` at ${s.clock(e.arrivedT)}` : ''}; that visit is over.`;
      out.push(txt);
      continue;
    }
    if (e.status === 'en_route') txt += ' You are on your way there now.';
    if (e.status === 'at_bedside') txt += ` You are at the bedside (since ${s.clock(e.arrivedT ?? s.t)}) and opened with: "${e.opener}".`;
    if (e.status === 'on_call') txt += ` You picked up with: "${e.opener}".`;
    if (!p.departed) {
      const now = assess(s, p);
      txt += ` Now (${s.clock()}): ${vitalsText(now.vitals)}${now.alarms.length ? `, alarms ${now.alarms.join(', ')}` : ''}: ${now.unstable ? `UNSTABLE (${now.why.join('; ')})` : 'stable by the numbers'}. ${now.unstable ? UNSTABLE_GUIDE : STABLE_GUIDE}`;
    } else txt += ' The patient has left the department.';
    out.push(txt);
  }
  return out.join(' ');
}

// ───────────────────────────── views, agent text, debrief ─────────────────────────────

export function escalationViews(s: GameSession): EscalationView[] {
  return s.escalations.map((e) => ({
    id: e.id,
    patientId: e.pid,
    bedLabel: s.patients.get(e.pid)?.bedLabel ?? e.pid,
    mode: e.mode,
    attendingId: e.attendingId,
    attendingName: s.staff.get(e.attendingId)?.def.name ?? 'Attending',
    status: e.status,
    t: e.t,
    etaT: e.etaT,
    arrivedT: e.arrivedT,
    reason: e.reason,
    contactId: e.mode === 'call' ? ATTENDING_LINE : undefined,
  }));
}

/** observation lines for AI agents (agentText.ts) */
export function escalationText(s: GameSession): string | null {
  const lines: string[] = [];
  for (const e of s.escalations) {
    const p = s.patients.get(e.pid);
    const st = s.staff.get(e.attendingId);
    if (!p || !st) continue;
    if (e.status === 'en_route') lines.push(`- ${st.def.name} is on her way to ${p.bedLabel} (you escalated at ${s.clock(e.t)}; expected ${s.clock(e.etaT ?? s.t)}): talk to her there once she arrives (npcId: ${st.def.id}).`);
    else if (e.status === 'at_bedside') lines.push(`- ${st.def.name} is at ${p.bedLabel} (since ${s.clock(e.arrivedT ?? s.t)}): talk to her there (npcId: ${st.def.id}).`);
  }
  const line = lineEscalation(s);
  const lp = line && s.patients.get(line.pid);
  if (line && lp) lines.push(`- Her phone line is open: call contactId "${ATTENDING_LINE}" from anywhere (last escalated ${lp.bedLabel} at ${s.clock(line.t)}).`);
  return lines.length ? `Escalations to the attending:\n${lines.join('\n')}` : null;
}

/** the debrief's list: time, patient, vitals then, and whether the patient was unstable */
export function escalationRecords(s: GameSession): EscalationRecord[] {
  return s.escalations.flatMap((e) => {
    const p = s.patients.get(e.pid);
    if (!p) return [];
    const snap = e.snapshot;
    return [{ t: e.t, patientId: e.pid, name: `${p.c.patient.firstName} ${p.c.patient.lastName}`, bedLabel: p.bedLabel, mode: e.mode, reason: e.reason, vitals: snap.vitals, onMonitor: snap.onMonitor, alarms: snap.alarms, unstable: snap.unstable, why: snap.why, arrivedAt: e.arrivedT }];
  });
}

function capital(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

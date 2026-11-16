/**
 * Watcher chats (observe mode). While an AI doctor plays its shift, the person watching, a med
 * student on the floor, can talk to anyone: patients, family, nurses, the attending, other staff,
 * people in the waiting room. Everything here is off the record, because an agent run is research
 * data and must stay untouched and reproducible:
 *
 *  - Own threads, per watcher (a random id per browser tab) and NPC, kept beside the session in a
 *    WeakMap. They never enter s.conversations, the PlayerView, the agent's observation, the
 *    narration feed or the run log, so the AI doctor never sees them.
 *  - No actions. The reply schema is {say, emotion}, and nothing an NPC says to a student is
 *    applied: no verbal orders, vitals, cultures-first or stop-the-med catches, consent, stepping
 *    out, accepted consults or faxes; no revealed facts or counseling; no emotion, first-contact
 *    time or flag changes.
 *  - Read-only. Building an NPC's [Situation] only reads the session: no s.log, s.emit, s.dirty,
 *    rng draws, timers, seq or clock. Line ids come from a counter of their own (dialogue.ts's
 *    numbering shows up in the agent's view and must not move).
 *  - The LLM, when the session's NPCs have one: a conversation key of its own, one watcher call at
 *    a time per server, usage counted in the process and day totals but never in the run's, and
 *    scripted replies whenever an NPC budget is set (--max-tokens / --max-usd), so watchers can't
 *    use up the budget the AI run's NPCs depend on.
 *
 * NPCs know they are talking to a student from the doctor's team: patients tell their story and
 * ask for the doctor, staff explain in general terms and send decisions back to the resident.
 * tests/watcher.test.ts replays a scripted shift with and without watcher chats and requires the
 * same event log, debrief, observations, views, conversations and random stream.
 */
import { FLOAT_RN, PERSONAS } from '../../content/ambient';
import { SMALL_TALK } from '../../content/smalltalk';
import type { PersonaDef } from '../../content/types';
import { roomById } from '../../shared/layout';
import type { ChatLine, ClientMsg, Emotion, NpcRole, ServerMsg, WatcherThreadView } from '../../shared/types';
import { LlmError, type LlmCallUsage } from '../llm/provider';
import { AI_DOCTOR_ID, isAgentSession } from '../sim/aiDoctor';
import type { GameSession, PatientState, StaffState } from '../sim/session';
import type { SpeechEvent } from '../tts/casting';
import { chartSummary, familySituation, patientSituation } from './dialogue';
import { EMOTIONS, familySpec, patientSpec, staffSpec } from './prompts';

/** characters per watcher message */
export const WATCHER_MAX_CHARS = 500;
/** rate limit per watcher: a burst, then one message per WATCHER_REFILL_MS */
export const WATCHER_BURST = 4;
export const WATCHER_REFILL_MS = 2500;
const MAX_WATCHERS = 16;
const MAX_THREADS = 40;
const MAX_LINES = 80;
const MAX_HISTORY = 24;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Appended to the NPC's own system prompt: who is talking now, and that nothing they say counts. */
export const STUDENT_FRAME = `## Right now: a medical student, not the doctor (this overrides the sections above)
The person talking to you is a MEDICAL STUDENT shadowing tonight's ED team. They are with the resident who looks after the patients, but they are not the doctor: they cannot examine, order, treat or decide anything, and nothing they say changes anyone's care. Their messages are marked "Student:".
- Stay in character and answer as you would a student: briefly and naturally, 1–3 short spoken sentences.
- Patient or family: you may tell them your story and how you feel. Anything you want done (pain relief, a test, an answer, going home) is for the doctor: ask them to tell the doctor, or ask when the doctor is coming. Where it fits, they may tell you the doctor will be with you shortly.
- Staff: friendly but busy. Explain what is going on in general terms; orders, plans and decisions go through the resident. If the student raises a concern (a medication, a patient's identity, a missing test), take it seriously and tell them to bring it to the doctor right away.
- Never say you did, are doing or will do anything because of what the student said: you only act on the doctor's instructions.
- Reply with "say" and "emotion" only.`;

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { say: { type: 'string' }, emotion: { type: 'string', enum: [...EMOTIONS] } },
  required: ['say', 'emotion'],
  additionalProperties: false,
};

// ───────────────────────────── who is being talked to ─────────────────────────────

type Who =
  | { kind: 'patient'; npcId: string; name: string; p: PatientState }
  | { kind: 'family'; npcId: string; name: string; p: PatientState }
  | { kind: 'staff'; npcId: string; name: string; st: StaffState }
  | { kind: 'bystander'; npcId: string; name: string; role: 'waiting' | 'companion' | 'nurse' | 'staff' };

const roomLabel = (s: GameSession, id: string) => roomById(s.layout, id)?.label ?? id;

function resolve(s: GameSession, npcId: string): Who | { error: string } {
  if (npcId === AI_DOCTOR_ID) return { error: "The AI resident is mid-shift and can't hear you. Its reasoning is in the transcript panel." };
  if (npcId.startsWith('pt_')) {
    const p = s.patients.get(npcId.slice(3));
    if (!p || !p.arrived || p.departed) return { error: 'That patient is not in the department.' };
    if (p.location !== p.bed) return { error: `${p.c.patient.firstName} is in ${roomLabel(s, p.location)} right now.` };
    return { kind: 'patient', npcId, name: `${p.c.patient.firstName} ${p.c.patient.lastName}`, p };
  }
  for (const p of s.patients.values()) {
    if (p.c.family?.npcId !== npcId) continue;
    if (!p.family || p.family.status === 'absent' || p.departed) return { error: `${p.c.family.name} is not here.` };
    return { kind: 'family', npcId, name: p.c.family.name, p };
  }
  const st = s.staff.get(npcId);
  if (st) return st.visible ? { kind: 'staff', npcId, name: st.def.name, st } : { error: `${st.def.name} is not on the floor right now.` };
  // the waiting room (server/sim/ambient.ts) and others off the record (content/smalltalk.ts): scripted lines, no LLM
  if (npcId === FLOAT_RN.id) return { kind: 'bystander', npcId, name: FLOAT_RN.name, role: 'nurse' };
  const crowd = PERSONAS[npcId];
  if (crowd && s.ambient.crowdAt(s.t).includes(npcId)) return { kind: 'bystander', npcId, name: crowd.callName ?? 'Visitor', role: crowd.companionOf ? 'companion' : 'waiting' };
  const other = SMALL_TALK[npcId];
  if (other) return { kind: 'bystander', npcId, name: other.name, role: other.kind === 'staff' ? 'staff' : 'waiting' };
  return { error: 'Nobody by that name is here.' };
}

/** "Dr. Evelyn Shaw" → "Dr. Shaw", "Rosa Martinez" → "Rosa" */
const short = (name: string) => (name.startsWith('Dr.') ? `Dr. ${name.split(' ').slice(-1)[0]}` : name.split(' ')[0]);

// ───────────────────────────── what they know right now ─────────────────────────────

const STUDENT_HERE = ' Right now a MEDICAL STUDENT from the doctor\'s team is talking to you, not the doctor.]';

function staffSituation(s: GameSession, st: StaffState): string {
  // like dialogue.ts's, minus anything about a mistake the staff member is about to make: a student can't catch it
  const parts = [`[Situation ${s.clock()}: You are in ${roomLabel(s, st.location)}.${st.activity ? ` Current task: ${st.activity}.` : ' You have a moment.'}`];
  const present = s.presentPatients();
  if (st.def.role === 'attending') parts.push(`Board: ${present.map((p) => chartSummary(s, p, 'brief')).join(' | ') || 'empty'}.`);
  else if (st.def.role === 'nurse' || st.def.role === 'tech') {
    const mine = present.filter((p) => st.def.role !== 'nurse' || !st.def.assigned || st.def.assigned.includes(p.bed) || st.def.id === 'rn_rosa');
    parts.push(`Patients you know about: ${mine.map((p) => chartSummary(s, p, 'brief')).join(' | ') || 'none'}.`);
  }
  return parts.join(' ') + STUDENT_HERE;
}

function situation(s: GameSession, w: Who): string {
  if (w.kind === 'patient') return patientSituation(s, w.p).replace(/\]$/, STUDENT_HERE);
  if (w.kind === 'family') return familySituation(s, w.p).replace(/\]$/, STUDENT_HERE);
  if (w.kind === 'staff') return staffSituation(s, w.st);
  return `[Situation ${s.clock()}: the waiting room.${STUDENT_HERE}`;
}

function system(s: GameSession, w: Who): string | null {
  const key = `${s.id}:watch`;
  let base: string;
  if (w.kind === 'patient') base = patientSpec(key, w.p.id, w.p.c).system;
  else if (w.kind === 'family') base = familySpec(key, w.p.id, w.p.c).system;
  else if (w.kind === 'staff') {
    const brief = w.st.def.role === 'attending' ? s.presentPatients().map((p) => `- ${p.c.patient.lastName} (${p.bedLabel}): ${p.c.truth.diagnosis.label}. Key pitfalls: ${p.c.teaching.slice(0, 2).join(' ')}`).join('\n') || '- (no patients yet)' : '';
    base = staffSpec(key, w.st.def, s.scenario, brief).system;
  } else return null; // the waiting-room crowd stays scripted
  return `${base}\n\n${STUDENT_FRAME}`;
}

// ───────────────────────────── scripted replies (no LLM) ─────────────────────────────

const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9\s/-]/g, ' ').replace(/\s+/g, ' ')} `;
const GREETING = /\b(hi|hello|hey|good (morning|evening|afternoon|night)|my name is|i m a|i am a|student|nice to meet)\b/;
const STUDENT = /\b(student|shadowing|with the (doctor|team|resident)|doctor s team|doctors team)\b/;
/** asking a staff member to do or stop something: a request about something clinical, or a safety stop */
const REQUEST = /\b(give|start|hang|draw|get|order|send|run|put|place|bolus|push|administer|can you|could you|would you|please|let s|need you|stop|hold|cancel|check|recheck)\b/;
const CLINICAL = /\b(mg|mcg|ml|dose|meds?|medication|drug|aspirin|heparin|metoprolol|antibiotics?|meropenem|ceftriaxone|fluids?|bolus|saline|cultures?|blood|labs?|lactate|troponin|vitals|temp|temperature|monitor|iv|oxygen|o2|ecg|ekg|x-?ray|ct|scan|wristband|patient|bed \d)\b/;
const SAFETY = /\b(wrong (patient|person|bed|med|drug|name)|cultures? first|stop)\b/;
/** a patient or relative asked about what happens next, or offered help: that's for the doctor */
const NEXT = /\b(need anything|get you anything|can i get|anything i can|do you want|do you need|how long|when (will|is|can)|what happens|what s wrong|what is wrong|what s going on|results?)\b/;
const STATUS = /\b(how|what|status|update|busy|going on|happening|patients?)\b/;

function personaOf(w: Who): PersonaDef | undefined {
  if (w.kind === 'patient') return w.p.c.persona;
  if (w.kind === 'family') return w.p.c.family?.persona;
  return undefined;
}

/** a patient's or relative's story, by keyword (as offline.ts), told to a student */
function storyReply(w: Who & { kind: 'patient' | 'family' }, t: string, firstTurn: boolean): { say: string; emotion: Emotion } {
  const persona = personaOf(w)!;
  const emotion: Emotion = w.kind === 'patient' ? w.p.emotion : 'anxious';
  const scored = persona.facts
    .map((f) => ({ f, s: f.keywords.reduce((a, k) => a + (t.includes(k.toLowerCase()) ? (k.length > 5 ? 2 : 1) : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const parts: string[] = [];
  const impaired = w.kind === 'patient' && persona.capacity === 'impaired';
  if (firstTurn || (GREETING.test(t) && !scored.length)) {
    if (STUDENT.test(t) && !impaired) parts.push(w.kind === 'patient' ? 'Oh, a student. Okay.' : "Oh, you're with the doctors?");
    parts.push(persona.opening);
  }
  for (const x of scored.slice(0, 2)) parts.push(x.f.text);
  if (!scored.length && !firstTurn && NEXT.test(t) && !impaired) {
    parts.push(w.kind === 'patient' ? 'Could you ask the doctor for me? I just want to know what happens next.' : w.p.counseled.size ? 'The doctor said they would keep us posted. Do you know when they will be back?' : 'Nobody has told us anything yet. When is the doctor coming?');
  }
  if (!parts.length) parts.push(persona.fallback);
  return { say: parts.join(' '), emotion };
}

function staffReply(role: NpcRole | 'bystander' | 'other', name: string, raw: string, t: string, firstTurn: boolean): string {
  const asksAction = SAFETY.test(t) || (REQUEST.test(t) && CLINICAL.test(t));
  const greet = firstTurn || GREETING.test(t);
  const question = raw.includes('?') || STATUS.test(t);
  switch (role) {
    case 'nurse': {
      if (asksAction) return 'I take orders from the doctor, not from students. If something looks wrong to you, tell your resident right away.';
      const parts: string[] = [];
      if (greet) parts.push(`Hi, I'm ${short(name)}. You're shadowing the AI resident tonight? Stick close to them.`);
      if (STATUS.test(t)) parts.push("It's a busy night: everyone's on the board at the station, and your resident is working through it.");
      return parts.join(' ') || "Good question for your resident. I've got to keep moving.";
    }
    case 'tech':
      if (asksAction) return 'I run ECGs and draws when the doctor orders them. Ask your resident.';
      return "Hey! I'm on my way to a patient. Catch me later and I'll show you how we place the leads.";
    case 'attending':
      if (asksAction) return 'That call belongs to the resident looking after the patient. What would you do, and why? Then watch what they do.';
      if (greet && !question) return "Welcome! Watch how your resident works the board: who's sickest, and what can't wait. What have you noticed so far?";
      return 'Good question. What would you want to know first, and what would change your management? Keep watching the resident.';
    case 'clerk':
      return "Hi! Registration's here. The doctors are in the back, and the board's at the station.";
    case 'security':
      return 'Evening. Keep the ambulance bay doors clear and you will be fine.';
    case 'bystander':
      return "Are you a doctor? I've been waiting a while. Any idea how much longer?";
    default:
      return asksAction ? "You'd have to ask the doctor about that." : "Hi there. You're with the doctors? Your resident's around the station.";
  }
}

/** The scripted (offline) answer to a student: deterministic, in character, never an action. */
function studentReply(w: Who, text: string, firstTurn: boolean): { say: string; emotion: Emotion } {
  const t = norm(text);
  if (w.kind === 'patient' || w.kind === 'family') return storyReply(w, t, firstTurn);
  if (w.kind === 'bystander') {
    if (w.role === 'nurse') return { say: staffReply('nurse', w.name, text, t, firstTurn), emotion: 'neutral' };
    if (w.role === 'staff') return { say: staffReply('other', w.name, text, t, firstTurn), emotion: 'neutral' };
    return { say: w.role === 'companion' ? "I'm just here with someone who's being seen. Are you with the doctors?" : staffReply('bystander', w.name, text, t, firstTurn), emotion: 'neutral' };
  }
  return { say: staffReply(w.st.def.role, w.name, text, t, firstTurn), emotion: 'neutral' };
}

// ───────────────────────────── threads ─────────────────────────────

interface Thread {
  npcId: string;
  title: string;
  lines: ChatLine[];
  typing: boolean;
  /** LLM-facing history: user turns carry the [Situation], assistant turns the JSON replies */
  history: { role: 'user' | 'assistant'; content: string }[];
}

interface Watcher {
  threads: Map<string, Thread>;
  bucket: { tokens: number; at: number };
  seen: number;
}

interface Watchers {
  byId: Map<string, Watcher>;
}

const registry = new WeakMap<GameSession, Watchers>();
/** watcher line ids: unique in the process (the client keys live captions by line id), never dialogue.ts's counter */
let lineSeq = 0;

function watchersOf(s: GameSession): Watchers {
  let w = registry.get(s);
  if (!w) registry.set(s, (w = { byId: new Map() }));
  return w;
}

function watcher(s: GameSession, id: string, now: number): Watcher {
  const all = watchersOf(s);
  let w = all.byId.get(id);
  if (!w) {
    if (all.byId.size >= MAX_WATCHERS) {
      const oldest = [...all.byId.entries()].sort((a, b) => a[1].seen - b[1].seen)[0];
      all.byId.delete(oldest[0]);
    }
    all.byId.set(id, (w = { threads: new Map(), bucket: { tokens: WATCHER_BURST, at: now }, seen: now }));
  }
  w.seen = now;
  return w;
}

function thread(w: Watcher, npcId: string, title: string): Thread {
  let th = w.threads.get(npcId);
  if (!th) {
    if (w.threads.size >= MAX_THREADS) w.threads.delete(w.threads.keys().next().value!);
    w.threads.set(npcId, (th = { npcId, title, lines: [], typing: false, history: [] }));
  }
  th.title = title;
  return th;
}

function line(s: GameSession, speaker: ChatLine['speaker'], name: string, text: string, emotion?: Emotion): ChatLine {
  const l: ChatLine = { id: `w${++lineSeq}`, t: s.t, speaker, name, text };
  if (emotion) l.emotion = emotion;
  return l;
}

function view(s: GameSession, th: Thread): WatcherThreadView {
  return { sessionId: s.id, npcId: th.npcId, title: th.title, lines: th.lines.slice(), typing: th.typing };
}

/** a watcher's thread with one NPC (for a tablet opened again, e.g. after a reload) */
export function watcherThread(s: GameSession, watcherId: string, npcId: string): WatcherThreadView | null {
  const th = registry.get(s)?.byId.get(watcherId)?.threads.get(npcId);
  return th ? view(s, th) : null;
}

/** how many watcher threads a session has (tests, debugging) */
export function watcherThreadCount(s: GameSession): number {
  let n = 0;
  for (const w of registry.get(s)?.byId.values() ?? []) n += w.threads.size;
  return n;
}

// ───────────────────────────── talking ─────────────────────────────

/** one watcher LLM call at a time per server: watchers never crowd out the AI run's NPC turns */
let llmChain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = llmChain.then(fn, fn);
  llmChain = run.catch(() => undefined);
  return run;
}

function validate(json: Record<string, unknown> | null, text: string): { say: string; emotion: Emotion } | null {
  const raw = json && typeof json.say === 'string' ? json.say : json ? '' : text;
  const say = raw.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!say) return null;
  const emotion = json && (EMOTIONS as readonly string[]).includes(json.emotion as string) ? (json.emotion as Emotion) : 'neutral';
  return { say, emotion };
}

async function answer(s: GameSession, w: Who, th: Thread, text: string, firstTurn: boolean): Promise<{ say: string; emotion: Emotion; source: 'llm' | 'offline' }> {
  const message = `${situation(s, w)}\nStudent: ${text}`;
  const remember = (r: { say: string; emotion: Emotion }) => {
    th.history.push({ role: 'user', content: message }, { role: 'assistant', content: JSON.stringify(r) });
    if (th.history.length > MAX_HISTORY) th.history.splice(0, th.history.length - MAX_HISTORY);
  };
  const provider = s.brain.provider;
  const ledger = s.brain.ledger;
  const budgeted = !!(ledger.options.maxTokens || ledger.options.maxUsd);
  const sys = system(s, w);
  if (provider && sys && !budgeted && !ledger.overBudget()) {
    // counted in the process and day totals, never in the run's own usage (sessionId undefined)
    const record = (u: LlmCallUsage | undefined) => u && ledger.recordNpc(undefined, `watch:${w.npcId}`, w.name, u);
    try {
      const res = await oneAtATime(() => provider.chat({ key: `${s.id}:watch`, system: sys, schema: SCHEMA, history: th.history, message }));
      record(res.usage);
      ledger.setPlan(res.plan);
      const r = validate(res.json, res.text);
      if (r) {
        remember(r);
        return { ...r, source: 'llm' };
      }
    } catch (e) {
      if (e instanceof LlmError) record(e.usage);
      console.warn(`[watcher] ${w.name}: LLM error, scripted reply instead (${(e as Error).message.slice(0, 160)})`);
    }
  }
  const r = studentReply(w, text, firstTurn);
  remember(r);
  return { ...r, source: 'offline' };
}

export type WatcherResult =
  | { ok: true; thread: WatcherThreadView; speech: SpeechEvent; source: 'llm' | 'offline' }
  | { ok: false; error: string; thread?: WatcherThreadView };

/**
 * A watcher says `text` to `npcId`. Only for agent-driven sessions (observe mode); reads the
 * session, never writes it. The NPC's answer goes back to this watcher alone.
 */
export async function watcherTalk(s: GameSession, watcherId: string, npcId: string, raw: string, now = Date.now()): Promise<WatcherResult> {
  if (!isAgentSession(s)) return { ok: false, error: "Watcher chats are for watching an AI doctor's shift." };
  if (typeof watcherId !== 'string' || !ID.test(watcherId)) return { ok: false, error: 'Bad watcher id.' };
  if (typeof npcId !== 'string' || npcId.length > 80) return { ok: false, error: 'Nobody by that name is here.' };
  if (s.ended) return { ok: false, error: 'The shift is over.' };
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, WATCHER_MAX_CHARS) : '';
  if (!text) return { ok: false, error: 'Say something.' };
  const who = resolve(s, npcId);
  if ('error' in who) return { ok: false, error: who.error };
  const w = watcher(s, watcherId, now);
  const th = thread(w, npcId, who.name);
  if (th.typing) return { ok: false, error: `${short(who.name)} is still answering.`, thread: view(s, th) };
  const b = w.bucket;
  b.tokens = Math.min(WATCHER_BURST, b.tokens + (now - b.at) / WATCHER_REFILL_MS);
  b.at = now;
  if (b.tokens < 1) return { ok: false, error: 'One moment: let them answer first.', thread: view(s, th) };
  b.tokens -= 1;

  const firstTurn = !th.lines.some((l) => l.speaker === 'npc');
  th.lines.push(line(s, 'player', 'You', text));
  th.typing = true;
  try {
    const r = await answer(s, who, th, text, firstTurn);
    const spoken = line(s, 'npc', who.name, r.say, r.emotion);
    th.lines.push(spoken);
    if (th.lines.length > MAX_LINES) th.lines.splice(0, th.lines.length - MAX_LINES);
    return { ok: true, thread: view(s, { ...th, typing: false }), speech: { kind: 'speech', lineId: spoken.id, npcId, name: spoken.name, text: spoken.text, emotion: spoken.emotion }, source: r.source };
  } finally {
    th.typing = false;
  }
}

export type WatcherClientMsg = Extract<ClientMsg, { type: 'watcher_talk' | 'watcher_thread' }>;

/**
 * server/index.ts: a watcher's message over the WebSocket. Replies go to that socket only:
 * the thread, and the NPC's line as a speech event (bubble and voice for this watcher alone).
 */
export async function watcherMessage(s: GameSession | undefined, msg: WatcherClientMsg, out: { send(m: ServerMsg): void; voice(e: SpeechEvent): SpeechEvent }): Promise<void> {
  const npcId = typeof msg.npcId === 'string' ? msg.npcId.slice(0, 80) : '';
  const empty = (): WatcherThreadView => ({ sessionId: s?.id ?? '', npcId, title: '', lines: [], typing: false });
  if (!s) return out.send({ type: 'watcher_chat', thread: empty(), error: 'Not watching a shift.' });
  if (msg.type === 'watcher_thread') {
    const ok = isAgentSession(s) && typeof msg.watcherId === 'string' && ID.test(msg.watcherId);
    return out.send({ type: 'watcher_chat', thread: (ok && watcherThread(s, msg.watcherId, npcId)) || empty() });
  }
  const r = await watcherTalk(s, msg.watcherId, npcId, msg.text);
  if (!r.ok) return out.send({ type: 'watcher_chat', thread: r.thread ?? watcherThread(s, msg.watcherId, npcId) ?? empty(), error: r.error });
  out.send({ type: 'event', event: out.voice(r.speech) });
  out.send({ type: 'watcher_chat', thread: r.thread });
}

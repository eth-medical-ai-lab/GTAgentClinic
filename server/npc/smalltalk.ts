/**
 * Off-the-record small talk. Everyone who walks around and isn't part of a case can be stopped for a
 * word: the waiting-room crowd and its stand-in triage nurse (sim/ambient.ts), registration, security,
 * housekeeping, the shift's seated visitors, the cafeteria and the outpatient clinic. Who they are:
 * content/smalltalk.ts.
 *
 * Off the record:
 *  - their conversations live here (one map per session), never in session.conversations, whose
 *    recent lines AI agents read in their observations
 *  - nothing is logged, scored or charted; no game time (session.ts); nothing drawn from the
 *    session's random stream (the scripted replies vary by a hash of who and which turn)
 *  - nobody here knows anything about the patients on the board: the prompt and the [Situation]
 *    carry no case information, and nobody takes clinical orders (no actions at all)
 * views.ts marks them talkable (offRecord) and shows their conversations (markSmallTalk).
 */
import { FLOAT_RN, PERSONAS } from '../../content/ambient';
import { radioClue } from '../../shared/nightRadio';
import { DEFAULT_LINES, DIRECTIONS, SMALL_TALK, STAFF_COFFEE, type Area, type Place, type SmallTalkIntent, type SmallTalkPersona } from '../../content/smalltalk';
import type { ActionResult, AmbientProp, ChatLine, Emotion, LocationId, NpcView, Posture } from '../../shared/types';
import type { Conversation, GameSession } from '../sim/session';
import type { NpcReply } from './brain';
import { schemaFor, type NpcSpec } from './prompts';

const HOSPITAL = 'Grand Therapies Medical Center';
const SCHEMA = schemaFor({ factIds: [], counselIds: [], actionIds: [] });

const convs = new WeakMap<GameSession, Map<string, Conversation>>();

/** someone off the record (here or not): the roster minus anyone the gameplay talks to */
export function isSmallTalk(s: GameSession, npcId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SMALL_TALK, npcId) && !s.staff.get(npcId)?.def.talkable;
}

/** where they are and what they're doing right now */
interface Here {
  room: LocationId;
  posture: Posture;
  act?: string;
  props?: AmbientProp[];
  urgent?: boolean;
  emotion?: Emotion;
}

/** the crowd and the stand-in nurse as the 3D view shows them now (view-only state, see ambient.ts) */
function ambientViews(s: GameSession): NpcView[] {
  const out: NpcView[] = [];
  s.ambient.apply(out);
  return out;
}

function presence(s: GameSession, npcId: string, crowd: NpcView[]): Here | null {
  const st = s.staff.get(npcId);
  if (st) {
    // the ambient plan dresses some of them (security, the clerk, the seated visitors) while they're at home
    const seg = s.ambient.plan?.people.get(npcId)?.at(s.t);
    const home = !st.current && st.location === st.def.home.room && st.spot === st.def.home.spot;
    if (seg && home) return { room: seg.room, posture: seg.posture, act: seg.act, props: seg.props, urgent: seg.urgent, emotion: seg.emotion };
    return { room: st.location, posture: st.posture };
  }
  if (!PERSONAS[npcId] && npcId !== FLOAT_RN.id) return null;
  const v = crowd.find((n) => n.id === npcId);
  return v ? { room: v.location, posture: v.posture, act: v.ambient?.act, props: v.ambient?.props, urgent: v.ambient?.urgent, emotion: v.emotion } : null;
}

/** minutes a waiting person has waited (people there from the start had already waited a while) */
function waitedMin(s: GameSession, npcId: string, p: SmallTalkPersona): number | undefined {
  if (p.kind !== 'public') return undefined;
  const first = s.ambient.plan?.people.get(npcId)?.segs[0]?.t0;
  if (first === undefined) return p.waitedMin === undefined ? undefined : p.waitedMin + s.t / 60;
  return first <= 0 ? (p.waitedMin ?? 60) + s.t / 60 : (s.t - first) / 60;
}

export function waitSentence(min: number): string {
  if (min < 8) return 'I only just got here.';
  if (min < 50) return `About ${Math.max(10, Math.round(min / 10) * 10)} minutes.`;
  if (min < 80) return 'About an hour now.';
  if (min < 110) return 'An hour and a half, about.';
  if (min < 145) return 'About two hours now.';
  if (min < 175) return 'Two and a half hours.';
  return `Over ${Math.floor(min / 60)} hours now.`;
}

/** people in the waiting room right now (the crowd and the shift's seated visitors) */
function waitingCount(s: GameSession, crowd: NpcView[]): number {
  return crowd.filter((v) => v.location === 'waiting' && v.role === 'visitor').length + [...s.staff.values()].filter((st) => st.def.role === 'visitor' && st.location === 'waiting').length;
}

function areaOf(room: LocationId): Area {
  if (room === 'cafeteria') return 'cafeteria';
  if (room === 'clinic' || room === 'clinic_hall' || room.startsWith('exam_')) return 'clinic';
  if (['street', 'lobby', 'restrooms', 'restroom_acc', 'stairs'].includes(room)) return 'street';
  return 'ed';
}

function isNight(s: GameSession): boolean {
  const h = Number(s.clock().split(':')[0]);
  return h >= 20 || h < 7;
}

// ───────────────────────────── the LLM's view ─────────────────────────────

/** what they're doing, for the [Situation] (ambient acts, shared/types.ts AmbientAct) */
const DOING: Record<string, string> = {
  sleep: 'You were dozing in your chair and the doctor has just woken you: groggy for a moment.',
  phone_text: 'You were texting on your phone.',
  phone_call: 'You are in the middle of a phone call: you cover the phone to answer briefly.',
  read: 'You were reading a newspaper.',
  laptop: 'You were working on your laptop.',
  cough: 'You keep having to cough.',
  touch_face: 'You are rubbing your face, uncomfortable.',
  impatient: 'You are fed up with waiting.',
  talk_angry: 'You are fed up with waiting.',
  talk: 'You were chatting with the person next to you.',
  listen: 'You were chatting with the person next to you.',
  laugh: 'You were chatting with the person next to you.',
  drink: 'You are having a drink from a can.',
  film: 'You were filming the commotion on your phone; security just told you to stop.',
  clipboard: 'You are calling the next patient from the waiting list, clipboard in hand.',
  push: 'You are pushing a wheelchair.',
  crouch: 'You are kneeling beside a young man who has just fainted on the floor.',
  crouch_talk: 'You are kneeling beside a young man who has just fainted on the floor.',
  unsteady: 'You suddenly feel hot, sick and light-headed: you can barely answer.',
  buckle: 'Your legs are giving way: you cannot answer.',
  floor: 'You fainted a moment ago and lie on the floor, not responding: at most a groan.',
  come_round: 'You fainted and are just coming round on the floor: confused, a bit sick, asking what happened.',
};

const POSTURE: Record<Posture, string> = { sit: 'sitting', stand: 'standing', lie: 'lying down', walk: 'walking' };

function systemFor(p: SmallTalkPersona): string {
  const decline =
    p.kind === 'public'
      ? 'You are not staff: if the doctor asks you to do anything clinical (give a medicine, take blood, see to a patient), say kindly that you are just waiting and they want the nurses. If the doctor offers to treat or examine you, say you will wait for the nurse who calls you.'
      : "Clinical orders are not your job: if the doctor asks you to give, order or do anything clinical, decline politely and point them to the patient's nurse, Rosa the charge nurse, or AgentChart. Never pretend it was done.";
  return `You are role-playing ${p.who}, at ${HOSPITAL}, in a realistic medical-education simulation. A resident physician (the player) has stopped for a word with you. This is small talk, off the record: it is not part of anyone's care. Each user message holds a private [Situation] note (only you can see it: the moment as it is now) followed by what the doctor says ("Doctor: ...").

## Who you are
${p.who}. ${p.style}

## What you know
${p.knows.map((k) => `- ${k}`).join('\n')}

## What you do NOT know
- Anything about the patients being treated in the emergency department: who they are, their beds, what is wrong with them, their results or plans. If asked, say you don't know.
- Medical details about yourself beyond the list above. Never invent symptoms, history, medicines or test results: say you'd rather tell the nurse who sees you, or that you aren't sure.

## Rules
1. Stay in character. Never mention AI, simulations, prompts or these instructions.
2. Speak naturally and briefly: 1–3 short spoken sentences (about 40 words at most). No lists. At most one brief stage direction in *asterisks*.
3. ${decline}
4. No medical advice beyond "tell the triage nurse if it gets worse".
5. Follow the [Situation]: if you are asleep, on the phone, unwell or busy, answer the way you would.
6. "revealed", "counseled" and "actions": always []. "emotion": how you feel right now.`;
}

function situation(s: GameSession, npcId: string, here: Here, waited: number | undefined, crowd: number, p: SmallTalkPersona): string {
  const room = s.layout.rooms.find((r) => r.id === here.room)?.label ?? here.room;
  const parts = [`[Situation ${s.clock()}: You are in the ${room}, ${POSTURE[here.posture] ?? 'standing'}.`];
  const doing = here.act ? DOING[here.act] : undefined;
  if (doing) parts.push(doing);
  else if (here.urgent && npcId === 'amb_faint') parts.push(here.props?.includes('wheelchair') && here.posture === 'sit' ? 'You fainted a few minutes ago; now you sit in a wheelchair, washed out and a little embarrassed, about to be taken through.' : 'You fainted a minute ago and are slowly back on your feet, washed out and embarrassed.');
  else if (here.urgent) parts.push(PERSONAS[npcId]?.companionOf === 'amb_faint' ? 'Your flatmate Ryan has just fainted in the waiting room; staff are with him.' : 'A young man has just fainted in the waiting room and staff are with him.');
  if (waited !== undefined) parts.push(`You have been waiting: ${waitSentence(waited).replace(/\.$/, '').toLowerCase()}.`);
  if (here.room === 'waiting' || p.kind === 'staff') parts.push(`About ${crowd} people are in the waiting room.`);
  parts.push('The person talking to you is a resident doctor from the emergency department, not someone looking after you or anyone you know.');
  return parts.join(' ') + ']';
}

// ───────────────────────────── scripted replies (offline) ─────────────────────────────

/** everything the scripted reply may use: nothing from the cases except names to steer away from */
export interface ScriptState {
  npcId: string;
  /** the doctor's turns before this one */
  turn: number;
  act?: string;
  props?: AmbientProp[];
  urgent?: boolean;
  posture?: Posture;
  waited?: number;
  crowd: number;
  night: boolean;
  room: LocationId;
  /** asleep and not talked to just now: wakes up first */
  woke: boolean;
  /** lower-case names of the patients and families in this shift (questions about them get "I don't know") */
  names: string[];
  emotion?: Emotion;
}

function norm(t: string): string {
  return ` ${t.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9'\s/-]/g, ' ').replace(/\s+/g, ' ')} `;
}

/** FNV-1a: the same person, intent and turn always pick the same line */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const RX = {
  dose: /\b\d+(\.\d+)?\s*(mg|mcg|micrograms?|g|grams?|ml|l|units?|mmol|meq|joules?|j)\b/,
  clinical:
    /\b(epinephrine|epi|adrenaline|amiodarone|atropine|morphine|fentanyl|ketamine|propofol|midazolam|lorazepam|aspirin|nitro\w*|gtn|heparin|enoxaparin|insulin|dextrose|antibiotics?|ceftriaxone|meropenem|vancomycin|pip\w*|tazo\w*|metoprolol|diltiazem|adenosine|naloxone|saline|fluids?|bolus|oxygen|o2|monitor|ecg|ekg|12[- ]?lead|x[- ]?ray|xray|ct|mri|ultrasound|scan|bloods?|labs?|blood work|cultures?|troponin|lactate|cbc|bmp|vitals|cath lab|defib\w*|cardiovert\w*|cpr|intubat\w*|sedat\w*|transfus\w*|iv|im|stat|cannula|catheter|splint|sutures?|stitch\w*|tetanus|paracetamol|acetaminophen|tylenol|ibuprofen|ondansetron|painkillers?|pain relief|medicine|medication|meds|drugs?|injection|jab|tablet|pills?)\b/,
  imperative:
    /\b(give|start|hang|push|administer|draw|order|inject|run|send|page|put|place|book|prescribe|set up|hook|draw up|take (his|her|their|a|an|some)|get (him|her|them|a|an|me|some|the)|check (his|her|their|the))\b|\b(can|could|would|will) you\b|\bi need you\b|\bwe need\b|\bi want you\b|\blet's\b|\bplease\b|\bstat\b|\bnow\b/,
  offer: /\b(do you (want|need)|would you like|can i get you|shall i (get|give)|i can (get|give)|i'll (get|give)|have you (had|taken)|did they give you|want (some|any))\b/,
  pain: /\b(does it hurt|hurts?|hurting|sore|in pain|painful|how bad)\b/,
  beds: /\b(bed|room|bay)\s*\d\b|\bfast ?track\b|\bresus\b|\bthe (patient|lady|woman|man|guy|gentleman|grandma|old (lady|man)) (in|from|on|with)\b|\bother patients?\b|\bwho('s| is) (in|back)\b|\b(stemi|heart attack|sepsis|septic|appendic\w*|fibrillation|afib|a-fib|infarct\w*)\b/,
  where: /\b(where('s| is| are| can| do)|which way|how do i (get|find)|looking for|directions?|is there (a|an|any)|any (coffee|food|toilets?|restrooms?)|anywhere)\b/,
  restroom: /\b(restrooms?|toilets?|bathrooms?|loo|washrooms?|wc|lavatory|gents|ladies)\b/,
  coffee: /\b(coffee|caffeine|espresso|latte|cappuccino)\b/,
  cafeteria: /\b(cafeteria|canteen|caf|food|eat|snacks?|sandwich\w*|soup|meal|hungry)\b/,
  vending: /\b(vending|machine|soda|cola|drinks?|water|juice|chocolate|crisps|chips)\b/,
  exit: /\b(exit|way out|parking|car park|leave)\b/,
  triage: /\b(triage|registration|reception|desk)\b/,
  doing: /\b(what are you (doing|reading|watching|working on|listening to|up to)|what('s| is) (that|in the (paper|news))|anything (good )?in the (paper|news)|good (book|paper|read)|working late)\b/,
  why: /\b(what brings you|brought you|why are you here|what happened|what('s| is) (wrong|up|going on|the matter|with the)|how did (you|that|it|this) happen|what did you do|are you (a )?patient|are you (waiting|here) (for|with)|who are you (here )?(with|for|waiting)|what are you (here|in) for|is that your|your (wrist|hand|knee|eye|back|arm|thumb|head|stomach|belly|tummy|shoulder|ear|cough|dog|husband|wife|dad|father|brother|mum|mom|mother|flatmate|friend|son|daughter))\b/,
  wait: /\b(how long|been (here|waiting)|waiting (long|for long|a while)|wait(ing)? times?|when (did|were) you (arrive|get here|come in))\b/,
  busy: /\b(busy|how many|full|packed|crowded|quiet)\b/,
  job: /\b(what do you do|your job|you work here|work here|worked here|what('s| is) your (job|role)|are you (a |the )?(nurse|doctor|staff|security|guard|cleaner|receptionist|cashier|clerk)|what('s| is) it like)\b/,
  exam: /\b(let me (take a )?(look|see|check|examine)|can i (take a |have a )?(look|see|check|examine)|may i (look|examine)|examine|take a look|have a look|show me)\b/,
  feel: /\b(how are you|how're you|how are things|how do you feel|feeling|are you (ok|okay|alright|all right)|you (ok|okay|alright|all right)|need anything|comfortable|how('s| is) (it|the|your) (going|night|shift|day|break))\b/,
  name: /\b(what('s| is) your name|who are you|your name)\b/,
  thanks: /\b(thanks|thank you|cheers|bye|goodbye|good night|goodnight|take care|see you|good luck|feel better|get well|hang in there|sorry (for|about) the wait|won't be long|shouldn't be long|they'll call you)\b/,
  greet: /\b(hi|hello|hey|hiya|good (morning|evening|afternoon)|excuse me|sorry to bother|morning|evening)\b/,
};

const PLACES: Place[] = ['restroom', 'coffee', 'cafeteria', 'vending', 'exit', 'triage'];

/** what someone is doing, if you ask (by their ambient act) */
const ACT_DOING: Record<string, string[]> = {
  read: ['Just the paper. Nothing good in it, as usual.', 'Reading the paper. Old habits.'],
  laptop: ['Work. It follows you everywhere.', 'Emails. Might as well get something done.'],
  phone_text: ['Just texting.', 'Scrolling. Nothing else to do.'],
  drink: ['Having a drink. The machine finally worked.'],
  sleep: ['Trying to sleep, mostly.'],
};

function placeAsked(t: string): Place | undefined {
  return PLACES.find((k) => RX[k].test(t));
}

/** the intent of the doctor's line, most specific first */
export function smallTalkIntent(text: string, names: string[] = []): SmallTalkIntent | { place: Place } {
  const t = norm(text);
  const clinical = RX.clinical.test(t) || RX.dose.test(t);
  if (clinical && RX.offer.test(t)) return 'offer';
  if (RX.dose.test(t) || (clinical && RX.imperative.test(t))) return 'order';
  if (RX.beds.test(t) || names.some((n) => n.length > 2 && t.includes(` ${n} `))) return 'patients';
  const place = placeAsked(t);
  if (place && RX.where.test(t)) return { place };
  if (RX.doing.test(t)) return 'doing';
  if (RX.exam.test(t)) return 'exam';
  if (/\b(worked here|work here long|been working here)\b/.test(t)) return 'job';
  if (RX.wait.test(t)) return 'wait';
  if (RX.pain.test(t)) return 'feel';
  if (RX.why.test(t)) return 'why';
  if (RX.busy.test(t)) return 'busy';
  if (RX.job.test(t)) return 'job';
  if (clinical) return 'offer';
  if (RX.feel.test(t)) return 'feel';
  if (RX.name.test(t)) return 'greet';
  if (RX.thanks.test(t)) return 'thanks';
  if (RX.greet.test(t)) return 'greet';
  return 'fallback';
}

/** a deterministic scripted reply: by intent, the person's state and a hash of who and which turn */
export function scriptedReply(p: SmallTalkPersona, text: string, st: ScriptState): NpcReply {
  const say = (line: string, emotion?: Emotion): NpcReply => ({
    say: line
      .replace(/\{wait\}/g, waitSentence(st.waited ?? 30))
      .replace(/\{crowd\}/g, String(st.crowd))
      .replace(/\{tonight\}/g, st.night ? 'tonight' : 'today')
      .trim(),
    emotion: emotion ?? st.emotion ?? 'neutral',
    revealed: [],
    counseled: [],
    actions: [],
  });
  const pick = (key: string, list: string[]) => (list.length ? list[hash(`${st.npcId}|${key}|${st.turn}`) % list.length] : '');
  const lines = (i: SmallTalkIntent): string[] => p.lines[i] ?? DEFAULT_LINES[p.kind][i] ?? DEFAULT_LINES[p.kind].fallback ?? [];

  // out cold, or about to be: no conversation
  if (st.act === 'floor') return say("*doesn't respond: eyes closed, breathing*", 'drowsy');
  if (st.act === 'buckle') return say('*his knees give way*', 'drowsy');
  if (st.act === 'unsteady') return say("I… don't feel good. Really hot…", 'confused');
  if (st.act === 'come_round') return say(pick('come_round', ['Wh… what happened? Why am I on the floor?', 'I just felt hot… and sick. Then nothing.', "Sorry… I'm okay. I think."]), 'confused');

  const intent = smallTalkIntent(text, st.names);
  let line: string;
  if (typeof intent === 'object') {
    line = DIRECTIONS[intent.place][areaOf(st.room)];
    if (intent.place === 'coffee' && p.kind === 'staff' && st.room !== 'cafeteria') line += ` ${STAFF_COFFEE}`;
  } else if (st.urgent && p.lines.urgent && intent !== 'thanks') line = pick('urgent', p.lines.urgent);
  else if (intent === 'doing' && st.act && ACT_DOING[st.act]) line = pick('doing', ACT_DOING[st.act]);
  else if (intent === 'greet' && RX.name.test(norm(text))) line = `I'm ${p.name}.`;
  else if (intent === 'greet' && p.kind === 'public' && !(p.lines.greet ?? []).some((g) => g.includes(p.name))) line = `${pick('greet', lines('greet'))} I'm ${p.name}.`;
  else line = pick(intent, lines(intent));

  // what they were in the middle of colours the answer
  if (st.woke) line = `Mm? Oh, sorry, I dozed off. ${intent === 'greet' ? `I'm ${p.name}.` : line}`;
  else if (st.act === 'phone_call' && !line.startsWith('*')) line = `*covers the phone* ${line}`;
  return say(line);
}

// ───────────────────────────── talk ─────────────────────────────

function conversationOf(s: GameSession, npcId: string, p: SmallTalkPersona): Conversation {
  let m = convs.get(s);
  if (!m) convs.set(s, (m = new Map()));
  let c = m.get(npcId);
  if (!c) m.set(npcId, (c = { key: npcId, npcId, title: p.name, lines: [], typing: false, history: [] }));
  return c;
}

function line(s: GameSession, speaker: ChatLine['speaker'], name: string, text: string, emotion?: Emotion): ChatLine {
  return { id: `st${++s.nextChatLine}`, t: s.t, speaker, name, text, emotion };
}

/** lower-case first and last names of this shift's patients and families (never said, only steered away from) */
function caseNames(s: GameSession): string[] {
  const out: string[] = [];
  for (const p of s.patients.values()) {
    out.push(p.c.patient.firstName, p.c.patient.lastName);
    if (p.c.family) out.push(...p.c.family.name.split(' '));
  }
  return out.map((n) => n.toLowerCase());
}

/** talk to someone off the record: no game time, nothing logged (data.offRecord tells session.ts) */
export async function smallTalk(s: GameSession, npcId: string, text: string, topic?: 'night-radio'): Promise<ActionResult> {
  const p = SMALL_TALK[npcId];
  const done = (r: ActionResult): ActionResult => ({ ...r, costMin: 0, data: { ...((r.data as object) ?? {}), npcId, offRecord: true } });
  text = text.trim().slice(0, 600);
  if (!text) return done({ ok: false, message: 'Say something.' });
  const crowd = ambientViews(s);
  const here = presence(s, npcId, crowd);
  if (!here) return done({ ok: false, message: `${p.name} isn't here right now.` });
  if (s.mode === 'step' && s.playerLocation !== here.room) return done({ ok: false, message: `You need to be in the same place to talk (they are in "${here.room}", you are in "${s.playerLocation}").` });

  const conv = conversationOf(s, npcId, p);
  const lastNpc = conv.lines.findLast((l) => l.speaker === 'npc');
  const waited = waitedMin(s, npcId, p);
  const count = waitingCount(s, crowd);
  // the faint (sim/ambient.ts): everyone involved is "urgent" from his arrival, but it happens at collapseAt
  const fainted = (s.ambient.plan?.collapseAt ?? Infinity) <= s.t;
  if (!fainted) here.urgent = false;
  const st: ScriptState = {
    npcId,
    turn: conv.lines.filter((l) => l.speaker === 'player').length,
    act: here.act,
    props: here.props,
    urgent: here.urgent,
    posture: here.posture,
    waited,
    crowd: count,
    night: isNight(s),
    room: here.room,
    woke: here.act === 'sleep' && (!lastNpc || s.t - lastNpc.t > 120),
    names: caseNames(s),
    emotion: here.emotion ?? PERSONAS[npcId]?.emotion,
  };
  const clue = topic === 'night-radio' ? radioClue(npcId) : undefined;
  const spec: NpcSpec = {
    key: `${s.id}:smalltalk:${npcId}`,
    kind: 'smalltalk',
    name: p.name,
    system: systemFor(p),
    schema: SCHEMA,
    factIds: [],
    counselIds: [],
    actionIds: [],
    offline: (t) => clue
      ? { say: clue.reply, emotion: 'happy', actions: [], revealed: [], counseled: [] }
      : scriptedReply(p, t, st),
  };
  conv.lines.push(line(s, 'player', 'You', text));
  conv.typing = true;
  s.dirty = true;
  const reply = await s.reply(spec, conv, situation(s, npcId, here, waited, count, p), text, { firstTurn: st.turn === 0 }, !clue);
  if (reply.notice) s.emit({ kind: 'toast', text: reply.notice, tone: 'warn' });
  conv.typing = false;
  const spoken = line(s, 'npc', p.name, reply.say, reply.emotion);
  conv.lines.push(spoken);
  if (conv.lines.length > 120) conv.lines.splice(0, conv.lines.length - 120);
  s.emit({ kind: 'speech', lineId: spoken.id, npcId, name: spoken.name, text: spoken.text, emotion: spoken.emotion });
  s.dirty = true;
  return done({ ok: true, text: reply.say, data: { emotion: reply.emotion, source: reply.source, notes: [], ...(clue ? { radioClue: clue.npc } : {}) } });
}

// ───────────────────────────── the view ─────────────────────────────

/**
 * views.ts: everyone off the record who is in the view becomes talkable (offRecord, so the tablet
 * shows small-talk prompts), and you learn a stranger's first name once they've spoken to you.
 * Returns the off-record conversations for the view.
 */
export function markSmallTalk(s: GameSession, npcs: NpcView[]): Conversation[] {
  const m = convs.get(s);
  for (const v of npcs) {
    if (v.talkable || !isSmallTalk(s, v.id)) continue;
    v.talkable = true;
    v.offRecord = true;
    if (/^(Waiting patient|Visitor)$/.test(v.name) && m?.get(v.id)?.lines.some((l) => l.speaker === 'npc')) v.name = SMALL_TALK[v.id].name;
  }
  return m ? [...m.values()] : [];
}

/**
 * Persona → system prompt + JSON schema. System prompts are STABLE per NPC (cacheable,
 * reusable by warm CLI sessions); everything that changes goes into the per-turn
 * [Situation] note instead.
 */
import type { CaseDef, ConsultDef, PersonaDef, PhoneContactDef, ScenarioDef, StaffDef } from '../../content/types';
import { ORDERS } from '../../shared/catalog';
import type { NpcReply } from './brain';
import type { OfflineCtx } from './offline';

export const EMOTIONS = ['neutral', 'pain', 'anxious', 'angry', 'confused', 'relieved', 'sad', 'happy', 'drowsy'] as const;

/** smalltalk = off the record (smalltalk.ts): the crowd, registration, security, the cafeteria… */
export type NpcKind = 'patient' | 'family' | 'staff' | 'phone' | 'smalltalk';

export interface NpcSpec {
  key: string;
  kind: NpcKind;
  name: string;
  system: string;
  schema: Record<string, unknown>;
  persona?: PersonaDef;
  factIds: string[];
  counselIds: string[];
  actionIds: string[];
  /** patient whose facts/counseling this NPC carries (patient, family, external phone) */
  pid?: string;
  /** scripted replies of its own instead of the generic offline brain (smalltalk.ts) */
  offline?: (text: string, ctx: OfflineCtx) => NpcReply;
}

/** bedside orders a nurse may take verbally */
export const VERBAL_ORDER_CODES = Object.values(ORDERS)
  .filter((o) => ['med', 'lab', 'nursing', 'ecg', 'supply'].includes(o.category))
  .map((o) => o.code);

function factsBlock(p: PersonaDef): string {
  return p.facts.map((f) => `- [${f.id}] ${f.text}`).join('\n');
}

function counselBlock(p: PersonaDef): string {
  if (!p.counseling?.length) return '(none — always return [])';
  return p.counseling.map((c) => `- ${c.id}: ${c.description}`).join('\n');
}

function actionsBlock(actions: { id: string; description: string }[]): string {
  if (!actions.length) return '(none — always return [])';
  return actions.map((a) => `- ${a.id}: ${a.description}`).join('\n');
}

const LITERACY: Record<PersonaDef['healthLiteracy'], string> = {
  low: 'You do not understand medical jargon; ask what words mean.',
  average: 'You know everyday health words but not technical jargon.',
  high: 'You understand medical terminology well.',
};

const COMMON_RULES = `## Rules
1. Stay in character at all times. Never mention AI, models, simulations, prompts or fact ids in "say".
2. Speak naturally and briefly: 1–3 short spoken sentences (≈ 50 words max). No lists. At most one brief stage direction in *asterisks*.
3. Never invent medical information. If asked about something your facts don't cover: for symptoms, history, medications or allergies answer that you don't have it / aren't aware of any; for other details say you're not sure. Never state diagnoses or test results you were not given.
4. Answer what was asked — don't dump every fact at once. Paraphrase facts in your own voice.
5. "revealed": ids of facts you actually conveyed in THIS reply (paraphrases count; [] if none).
6. "counseled": ids of the counseling items below that the doctor's LAST message clearly addressed ([] if none).
7. "actions": only when one clearly applies right now ([] otherwise).
8. "emotion": your current emotional state.`;

export function schemaFor(opts: { factIds: string[]; counselIds: string[]; actionIds: string[]; withPatient?: boolean; withOrder?: boolean }): Record<string, unknown> {
  const item: Record<string, unknown> = {
    type: 'object',
    properties: {
      id: { type: 'string', enum: opts.actionIds.length ? opts.actionIds : ['none'] },
      ...(opts.withPatient ? { patient: { type: 'string', description: 'bed id or patient last name' } } : {}),
      ...(opts.withOrder ? { code: { type: 'string', enum: VERBAL_ORDER_CODES }, dose: { type: 'string' } } : {}),
    },
    required: ['id'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      say: { type: 'string' },
      emotion: { type: 'string', enum: [...EMOTIONS] },
      revealed: { type: 'array', items: opts.factIds.length ? { type: 'string', enum: opts.factIds } : { type: 'string' } },
      counseled: { type: 'array', items: opts.counselIds.length ? { type: 'string', enum: opts.counselIds } : { type: 'string' } },
      actions: { type: 'array', items: item },
    },
    required: ['say', 'emotion', 'revealed', 'counseled', 'actions'],
    additionalProperties: false,
  };
}

const HOSPITAL = 'Grand Therapies Medical Center';
const FRAME = (who: string) =>
  `You are role-playing ${who} in the emergency department of ${HOSPITAL}, part of a realistic medical-education simulation. A resident physician (the player) talks to you. Each user message contains a private [Situation] note from the simulator (only you can see it — it describes the current moment) followed by what the doctor says ("Doctor: ...").`;

// ───────────────────────────── patients & families ─────────────────────────────

export function patientSpec(key: string, pid: string, c: CaseDef): NpcSpec {
  const p = c.persona;
  const who = `${c.patient.firstName} ${c.patient.lastName}, a ${c.patient.age}-year-old ${c.patient.sex === 'F' ? 'woman' : 'man'} who came to the ED with "${c.presentation.chiefComplaint.toLowerCase()}"`;
  const system = `${FRAME(who)}

## Who you are
${p.personality}
Speaking style: ${p.voice}
Health literacy: ${p.healthLiteracy}. ${LITERACY[p.healthLiteracy]}${p.capacity === 'impaired' ? '\nIMPORTANT: you are acutely unwell and confused; your answers are unreliable and drift.' : ''}
When greeted for the first time you say something like: "${p.opening}"
Answer the question asked, briefly and naturally. Volunteer the main complaint and immediate concerns, but leave other history for follow-up questions. For open questions, give a short account rather than a complete medical history. Do not list unrelated negative symptoms. Answer relevant follow-up questions fully.

## Facts you know about yourself (the ONLY medical facts you may state)
${factsBlock(p)}

## What you do NOT know
${p.unknowns.map((u) => `- ${u}`).join('\n')}

## How you behave
${p.behavior.map((b) => `- ${b}`).join('\n')}

## Counseling items (for "counseled")
${counselBlock(p)}

## Actions you may take
${actionsBlock(p.actions ?? [])}

${COMMON_RULES}`;
  const factIds = p.facts.map((f) => f.id);
  const counselIds = (p.counseling ?? []).map((x) => x.id);
  const actionIds = (p.actions ?? []).map((a) => a.id);
  return { key, kind: 'patient', name: `${c.patient.firstName} ${c.patient.lastName}`, system, schema: schemaFor({ factIds, counselIds, actionIds }), persona: p, factIds, counselIds, actionIds, pid };
}

export function familySpec(key: string, pid: string, c: CaseDef): NpcSpec {
  const f = c.family!;
  const p = f.persona;
  const who = `${f.name}, the ${f.relation.toLowerCase()} of the patient ${c.patient.firstName} ${c.patient.lastName} (${c.patient.age}${c.patient.sex})`;
  const system = `${FRAME(who)}

## Who you are
${p.personality}
Speaking style: ${p.voice}
Health literacy: ${p.healthLiteracy}. ${LITERACY[p.healthLiteracy]}
When the doctor first talks to you, you say something like: "${p.opening}"

## Facts you know about the patient (the ONLY medical facts you may state)
${factsBlock(p)}

## What you do NOT know
${p.unknowns.map((u) => `- ${u}`).join('\n')}

## How you behave
${p.behavior.map((b) => `- ${b}`).join('\n')}

## Counseling items (for "counseled")
${counselBlock(p)}

## Actions you may take
${actionsBlock(p.actions ?? [])}

${COMMON_RULES}`;
  const factIds = p.facts.map((x) => x.id);
  const counselIds = (p.counseling ?? []).map((x) => x.id);
  const actionIds = (p.actions ?? []).map((a) => a.id);
  return { key, kind: 'family', name: f.name, system, schema: schemaFor({ factIds, counselIds, actionIds }), persona: p, factIds, counselIds, actionIds, pid };
}

// ───────────────────────────── staff ─────────────────────────────

const NURSE_ACTIONS = [
  { id: 'verbal_order', description: 'Carry out an order the doctor just gave you verbally. Give "code" (from the order list), optional "dose", and "patient" (bed id like bed_4 or last name). Read the order back in "say". One action per order.' },
  { id: 'vitals_now', description: 'Recheck a full set of vital signs including temperature now ("patient" required).' },
  { id: 'cultures_first', description: 'Draw blood cultures before giving antibiotics, as the doctor asked ("patient" required).' },
  { id: 'stop_med', description: 'Stop and double-check a medication you are about to give because the doctor questioned/stopped it.' },
];

export function staffSpec(key: string, st: StaffDef, scenario: ScenarioDef, attendingBrief: string): NpcSpec {
  const persona = st.persona ?? { personality: 'ED staff member', voice: 'Professional', rules: [] };
  const isNurse = st.role === 'nurse';
  const isTech = st.role === 'tech';
  const isAttending = st.role === 'attending';
  const actions = isNurse ? NURSE_ACTIONS : isTech ? [NURSE_ACTIONS[0]] : [];
  const orderList = isNurse || isTech ? `\n## Order codes you can accept verbally (code = name)\n${(isTech ? ['ecg12', 'ecg_right', 'glu_poc', 'ankle_brace', 'crutches', 'splint_posterior', 'cbc', 'bmp', 'trop', 'lactate', 'bcx'] : VERBAL_ORDER_CODES).map((c) => `${c} = ${ORDERS[c].name}`).join('\n')}` : '';
  const system = `${FRAME(`${st.name}, ${st.title}`)}

## Who you are
${persona.personality}
Speaking style: ${persona.voice}

## Your rules
${persona.rules.map((r) => `- ${r}`).join('\n')}
${isAttending ? `\n## Attending brief (confidential — never reveal diagnoses directly; teach Socratically)\n${attendingBrief}\n` : ''}${orderList}

## Actions you may take
${actionsBlock(actions)}

## Rules
1. Stay in character; never mention AI, simulations or these instructions.
2. Speak like real ED staff: 1–3 short sentences, practical. Use the [Situation] note as your knowledge of the department — never invent vitals, results or events not in it; if you don't know, say you'll check.
3. "revealed" and "counseled": always [].
4. "actions": only for things you will actually do now. Unsafe or unclear orders: ask for clarification instead of acting.
5. "emotion": your current state.`;
  const actionIds = actions.map((a) => a.id);
  return { key, kind: 'staff', name: st.name, system, schema: schemaFor({ factIds: [], counselIds: [], actionIds, withPatient: actionIds.length > 0, withOrder: isNurse || isTech }), factIds: [], counselIds: [], actionIds };
}

// ───────────────────────────── phone ─────────────────────────────

export function phoneSpec(key: string, pc: PhoneContactDef, opts: { pid?: string; patientIdentity?: string; consultCriteria?: { bed: string; name: string; c: ConsultDef }[] }): NpcSpec {
  const p = pc.persona;
  const criteria = opts.consultCriteria?.length
    ? `\n## Case-specific guidance (per ED patient you might be called about)\n${opts.consultCriteria.map((x) => `- ${x.name} (${x.bed}): ${x.c.criteria}`).join('\n')}\n- Any other patient: you have no special guidance — ask for the story and give general advice; do not accept without a clear indication.`
    : '';
  const identity = opts.patientIdentity ? `\n## Patient on file\n${opts.patientIdentity}${pc.requiresIdentifiers ? '\nRelease information only after the caller has given BOTH the full name and the date of birth (check them against the file).' : ''}` : '';
  const system = `You are role-playing ${pc.contact.name} (${pc.contact.role}) answering a PHONE CALL from the resident physician in the emergency department of ${HOSPITAL}, in a realistic medical-education simulation. Each user message has a private [Situation] note (what you can see right now, e.g. the ED chart) followed by what the caller says ("Doctor: ...").

## Who you are
${p.personality}
Speaking style: ${p.voice}
You answer the phone with something like: "${p.opening}"
${identity}
## Facts you know (the ONLY specific facts you may state; ids in brackets)
${p.facts.length ? factsBlock(p) : '(no special facts — rely on the [Situation] note)'}

## What you do NOT know
${p.unknowns.map((u) => `- ${u}`).join('\n')}

## How you behave
${p.behavior.map((b) => `- ${b}`).join('\n')}
${criteria}

## Actions you may take
${actionsBlock(p.actions ?? [])}${(p.actions ?? []).some((a) => a.id === 'accept') ? '\nFor "accept"/"decline" set "patient" to the bed id (e.g. bed_2) of the patient discussed.' : ''}

${COMMON_RULES.replace('1–3 short spoken sentences (≈ 50 words max)', '1–4 short sentences, phone style (≈ 60 words max)')}`;
  const factIds = p.facts.map((f) => f.id);
  const counselIds = (p.counseling ?? []).map((x) => x.id);
  const actionIds = (p.actions ?? []).map((a) => a.id);
  return { key, kind: 'phone', name: pc.contact.name, system, schema: schemaFor({ factIds, counselIds, actionIds, withPatient: actionIds.some((a) => a === 'accept' || a === 'decline') }), persona: p, factIds, counselIds, actionIds, pid: opts.pid };
}

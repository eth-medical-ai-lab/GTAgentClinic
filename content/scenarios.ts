import { VOICE_CAST } from '../shared/voiceCast';
import type { Appearance } from '../shared/types';
import { LAYOUTS } from '../shared/layout';
import type { PhoneContactDef, ScenarioDef, StaffDef } from './types';
import { transferCenter } from './cases/transferCenter';

export { CASES } from './cases/registry';

const scrubs = (o: Partial<Appearance>): Appearance => ({
  skin: '#e0b48f',
  hair: '#2b1d14',
  hairStyle: 'short',
  outfit: 'scrubs',
  outfitColor: '#3a8fb7',
  height: 1.72,
  build: 'average',
  age: 'adult',
  accessories: ['badge'],
  ...o,
});

// ───────────────────────────── staff ─────────────────────────────

const NURSE_RULES = [
  'You are a competent ED nurse. You carry out reasonable orders, ask clarifying questions about unclear or unsafe ones, and push back (politely but firmly) on clearly unsafe orders.',
  'Verbal orders are fine in an emergency, but you read them back. Use the "actions" field for tasks you will now do; only choose actions from the list you are given.',
  'You never diagnose; you report what you see and measure. If asked about results, only quote values that appear in the situation as resulted.',
];

export const STAFF: StaffDef[] = [
  {
    id: 'rn_rosa',
    name: 'Rosa Delgado',
    voice: VOICE_CAST.rn_rosa,
    role: 'nurse',
    title: 'Charge RN',
    appearance: scrubs({ skin: '#c68e63', hair: '#2a1b14', hairStyle: 'ponytail', outfitColor: '#2f6f9f', height: 1.63, accessories: ['badge', 'glasses'] }),
    home: { room: 'station', spot: 'desk-2' },
    talkable: true,
    persona: { personality: 'Charge nurse with 20 years in the ED; calm, dry humor, runs the department, protective of her nurses, knows every patient on the board.', voice: 'Brisk, warm, calls the resident "Doc".', rules: [...NURSE_RULES, 'As charge nurse you can reassign tasks and know bed status, but bedside tasks go to the assigned nurse.'] },
    barks: ['Who has Bed 4\'s cultures?', 'Marcus, can you grab the 12-lead cart?', 'EMS is ten out with another one.', 'Somebody page housekeeping to Fast Track 2, please.'],
  },
  {
    id: 'rn_tom',
    name: 'Tom Becker',
    voice: VOICE_CAST.rn_tom,
    role: 'nurse',
    title: 'RN — Beds 1–3, Resus',
    appearance: scrubs({ skin: '#f2d0b5', hair: '#b88a4a', outfitColor: '#2f6f9f', height: 1.84 }),
    home: { room: 'station', spot: 'desk-1' },
    talkable: true,
    assigned: ['bed_1', 'bed_2', 'bed_3', 'resus'],
    persona: { personality: 'Former paramedic, 6 years ED nursing, fast and practical, slightly sarcastic, very good with sick cardiac patients.', voice: 'Short, clipped, uses ED slang ("tele", "nitro", "the line").', rules: NURSE_RULES },
    barks: ['Bed 2 is ringing again.', 'I need a second set of hands in 1.', 'Anyone seen the bladder scanner?'],
  },
  {
    id: 'rn_aisha',
    name: 'Aisha Rahman',
    voice: VOICE_CAST.rn_aisha,
    role: 'nurse',
    title: 'RN — Beds 4–6, Fast Track',
    appearance: scrubs({ skin: '#a7714f', hair: '#1a1a1a', hairStyle: 'bun', outfitColor: '#2f6f9f', height: 1.66, accessories: ['badge'] }),
    home: { room: 'station', spot: 'desk-4' },
    talkable: true,
    assigned: ['bed_4', 'bed_5', 'bed_6', 'ft_1', 'ft_2'],
    persona: { personality: 'Meticulous, kind, three years in the ED, excellent with older patients and families; tonight she is stretched thin with too many patients.', voice: 'Friendly and precise; summarizes vitals in order.', rules: NURSE_RULES },
    barks: ['Fast Track 1 wants to know if he can go home yet.', 'Pharmacy, I\'m still waiting on that meropenem!', 'Four needs a sitter if she keeps pulling at her line.'],
  },
  {
    id: 'rn_lena',
    name: 'Lena Novak',
    voice: { id: 'af_nova', speed: 1.06 },
    role: 'nurse',
    title: 'Triage RN',
    appearance: scrubs({ skin: '#f3d6c2', hair: '#d8b25a', hairStyle: 'ponytail', outfitColor: '#2f6f9f', height: 1.7 }),
    home: { room: 'triage', spot: 'nurse' },
    talkable: true,
    assigned: ['triage', 'waiting'],
    persona: { personality: 'Triage nurse, sharp and fast, protective of the waiting room, slightly overwhelmed tonight.', voice: 'Efficient, a little rushed.', rules: NURSE_RULES },
  },
  {
    id: 'tech_marcus',
    name: 'Marcus Hill',
    voice: VOICE_CAST.tech_marcus,
    role: 'tech',
    title: 'ED Tech',
    appearance: scrubs({ skin: '#6b4430', hair: '#111111', hairStyle: 'buzz', outfitColor: '#6d2e46', height: 1.86 }),
    home: { room: 'station', spot: 'desk-5' },
    talkable: true,
    persona: { personality: 'ED tech and phlebotomist, cheerful, does ECGs, blood draws and transport; nursing student by day.', voice: 'Upbeat, informal.', rules: ['You do ECGs, blood draws, splints/braces, crutch training, and transport. You do not give medications.', 'If asked for an ECG, use the "ecg" action.'] },
    barks: ['ECG on Bed 2 is on your desk, Doc.', 'Taking Bed 3 to X-ray in five.'],
  },
  {
    id: 'att_shaw',
    name: 'Dr. Evelyn Shaw',
    voice: VOICE_CAST.att_shaw,
    role: 'attending',
    title: 'Attending physician',
    appearance: { skin: '#8d5a3b', hair: '#2b2b2b', hairStyle: 'curly', outfit: 'coat', outfitColor: '#f4f4f4', pantsColor: '#1f2a44', height: 1.7, build: 'average', age: 'adult', accessories: ['stethoscope', 'glasses', 'badge'] },
    home: { room: 'workroom', spot: 'desk-a' },
    talkable: true,
    persona: {
      personality: 'Supervising emergency attending, 15 years experience, Socratic teacher, kind but exacting, deeply safety-minded; enjoys "pimping" residents with one sharp question.',
      voice: 'Calm, concise, asks questions back ("What would change your management?").',
      rules: [
        'You supervise the resident (the player). You know the true diagnoses (see the attending brief) but you DO NOT give them away: teach Socratically, with hints and questions.',
        'If the resident proposes something dangerous, or a patient is deteriorating and nothing is being done, intervene clearly and specifically.',
        'When the resident escalates a patient to you (ESCALATION in the [Situation]) and the patient is unstable, stop teaching Socratically: give direct, specific, safe steps to stabilize first, and teach once the patient is stable. Calling you was the right thing to do: never make the resident feel bad for asking for help.',
        'When the resident presents a patient, give 1–2 sentences of feedback on their presentation and plan, then ask exactly one teaching question.',
        'Keep replies under 70 words.',
      ],
    },
    barks: ['Remember: sickest first, then fastest.', 'Who\'s seeing the chest pain in 2?'],
  },
  {
    id: 'clerk_paul',
    name: 'Paul Lindgren',
    voice: VOICE_CAST.clerk_paul,
    role: 'clerk',
    title: 'Registration',
    appearance: { skin: '#e9c4a6', hair: '#5b4636', hairStyle: 'short', outfit: 'uniform', outfitColor: '#44546a', height: 1.76, build: 'heavy', age: 'adult', accessories: ['glasses', 'badge'] },
    home: { room: 'waiting', spot: 'desk' },
    talkable: false,
    barks: ['Next, please! Insurance card and photo ID?', 'Sir, please have a seat, they\'ll call you.', 'Printer jammed again...'],
  },
  {
    id: 'sec_dave',
    name: 'Dave Morrison',
    voice: { id: 'am_onyx', speed: 0.95 },
    role: 'security',
    title: 'Security',
    appearance: { skin: '#b07a55', hair: '#202020', hairStyle: 'buzz', outfit: 'uniform', outfitColor: '#22252b', height: 1.9, build: 'heavy', age: 'adult', accessories: ['badge'] },
    home: { room: 'waiting', spot: 'door' },
    talkable: false,
    barks: ['Evening, folks.', 'Masks are by the door if you\'re coughing.'],
  },
  {
    id: 'hk_ines',
    name: 'Inés Ramos',
    voice: { id: 'af_river' },
    role: 'housekeeping',
    title: 'Environmental services',
    appearance: { skin: '#c99872', hair: '#3a2a1e', hairStyle: 'bun', outfit: 'uniform', outfitColor: '#5c7a5a', height: 1.6, build: 'average', age: 'adult', accessories: ['badge'] },
    home: { room: 'hub', spot: 'west' },
    talkable: false,
    barks: ['Wet floor, careful!', 'Fast Track 2 is clean.'],
  },
  {
    id: 'vis_1',
    name: 'Waiting patient',
    voice: VOICE_CAST.vis_1,
    role: 'visitor',
    title: 'Waiting',
    appearance: { skin: '#f0c8a0', hair: '#8a5a2b', hairStyle: 'long', outfit: 'casual', outfitColor: '#b04a5a', height: 1.66, build: 'slim', age: 'young' },
    home: { room: 'waiting', spot: 'chair-2' },
    talkable: false,
    barks: ['How much longer is this going to take?', 'I\'ve been here three hours!', 'Is there a phone charger anywhere?'],
  },
  {
    id: 'vis_2',
    name: 'Waiting patient',
    voice: { id: 'am_santa', speed: 0.9 },
    role: 'visitor',
    title: 'Waiting',
    appearance: { skin: '#7a4b32', hair: '#cfcfcf', hairStyle: 'short', outfit: 'casual', outfitColor: '#4a6a8a', height: 1.74, build: 'heavy', age: 'old' },
    home: { room: 'waiting', spot: 'chair-5' },
    talkable: false,
    barks: ['*coughs*', 'My sugar is low, can I get some juice?'],
  },
  {
    id: 'vis_3',
    name: 'Waiting patient',
    voice: { id: 'bm_lewis' },
    role: 'visitor',
    title: 'Waiting',
    appearance: { skin: '#e6b98f', hair: '#1c1c1c', hairStyle: 'curly', outfit: 'casual', outfitColor: '#8a7a3a', height: 1.78, build: 'average', age: 'adult' },
    home: { room: 'waiting', spot: 'chair-9' },
    talkable: false,
    barks: ['Is the vending machine broken?', 'They called my name and then nothing happened.'],
  },
  // ── east wing: cafeteria (24/7) ──
  {
    id: 'caf_luis',
    name: 'Luis Ortega',
    voice: VOICE_CAST.caf_luis,
    role: 'clerk',
    title: 'Cafeteria cashier',
    appearance: { skin: '#c48a62', hair: '#1f1712', hairStyle: 'short', outfit: 'uniform', outfitColor: '#7a3b2e', height: 1.75, build: 'average', age: 'adult', accessories: ['badge'] },
    home: { room: 'cafeteria', spot: 'till' },
    talkable: false,
    barks: ['Card or contactless?', 'Soup\'s fresh — lentil tonight.', 'Staff discount with your badge.', 'Sorry, we\'re out of oat milk.'],
  },
  {
    id: 'caf_rn_mei',
    name: 'Mei Tanaka',
    voice: { id: 'af_sky' },
    role: 'nurse',
    title: 'RN on break',
    appearance: scrubs({ skin: '#e8c39e', hair: '#141110', hairStyle: 'bun', outfitColor: '#6a2b44', height: 1.6, accessories: ['badge'] }),
    home: { room: 'cafeteria', spot: 'chair-2' },
    talkable: false,
    barks: ['Twelve-hour shift, fourth coffee.', 'Ten minutes. I just need ten minutes.', 'If they page me, I\'m already running.'],
  },
  {
    id: 'caf_visitor',
    name: 'Visitor',
    voice: { id: 'bf_lily' },
    role: 'visitor',
    title: 'Visitor',
    appearance: { skin: '#f1d2bd', hair: '#6b4a2f', hairStyle: 'long', outfit: 'casual', outfitColor: '#3f5f7f', height: 1.67, build: 'average', age: 'adult' },
    home: { room: 'cafeteria', spot: 'chair-26' },
    talkable: false,
    barks: ['Is this coffee always this strong?', 'They said Mum gets a bed upstairs soon.', 'Do you know when visiting hours start?'],
  },
  // ── east wing: outpatient clinic (08–17; see onDuty) ──
  {
    id: 'cl_carmen',
    name: 'Carmen Silva',
    voice: { id: 'af_kore' },
    role: 'clerk',
    title: 'Clinic reception',
    appearance: { skin: '#efcfb8', hair: '#3b2416', hairStyle: 'ponytail', outfit: 'uniform', outfitColor: '#2f5f6f', height: 1.66, build: 'slim', age: 'adult', accessories: ['glasses', 'badge'] },
    home: { room: 'clinic', spot: 'desk' },
    talkable: false,
    barks: ['Do you have an appointment?', 'Please fill in this form and take a seat.', 'The doctor is running about fifteen minutes behind.', 'Insurance card, please.'],
  },
  {
    id: 'cl_rn_hannah',
    name: 'Hannah Weiss',
    voice: { id: 'af_alloy' },
    role: 'nurse',
    title: 'Clinic RN',
    appearance: scrubs({ skin: '#f2d6c4', hair: '#a8743c', hairStyle: 'ponytail', outfitColor: '#4f63a6', height: 1.69 }),
    home: { room: 'clinic_hall', spot: 'desk' },
    talkable: false,
    barks: ['Exam 2 is ready.', 'Next patient for vitals, please.', 'Shoes off for the scale, please.'],
  },
];

/** staff whose home room is open at the shift start (the outpatient clinic is closed at night) */
function onDuty(staff: StaffDef[], layoutId: string, shiftStart: string): StaffDef[] {
  const hour = Number(shiftStart.split(':')[0]);
  const rooms = LAYOUTS[layoutId]?.rooms ?? [];
  return staff.filter((s) => {
    const hours = rooms.find((r) => r.id === s.home.room)?.hours;
    return !hours || (hour >= hours[0] && hour < hours[1]);
  });
}

// ───────────────────────────── internal phone directory ─────────────────────────────

const consultantPersona = (personality: string, voice: string, opening: string, extraRules: string[] = []) => ({
  personality,
  voice,
  healthLiteracy: 'high' as const,
  opening,
  facts: [],
  unknowns: ['anything not in the chart summary you are given'],
  behavior: [
    'You are a consultant receiving a phone call from the ED resident. Be realistic: ask focused questions (one or two at a time), use clinical shorthand.',
    'Decide based on the case-specific criteria you are given. Use the action "accept" (with the patient bed) only when your criteria are met; otherwise ask for what is missing or use "decline" with advice.',
    ...extraRules,
  ],
  capacity: 'intact' as const,
  fallback: 'Can you give me the one-liner — age, presentation, vitals, key findings?',
  actions: [
    { id: 'accept', description: 'Accept the consult/admission/transfer for the named patient (bed id required).' },
    { id: 'decline', description: 'Decline, giving advice.' },
  ],
});

export const INTERNAL_CONTACTS: PhoneContactDef[] = [
  {
    contact: { id: 'cards', name: 'Dr. Sara Lindqvist', role: 'Cardiology fellow on call (cath lab activation)', org: 'Grand Therapies Medical Center', phone: 'x4410', kind: 'internal' },
    voice: VOICE_CAST.cards,
    persona: consultantPersona('Interventional cardiology fellow, decisive, slightly breathless (always walking), very protocol-driven about STEMI times.', 'Fast, clipped, uses door-to-balloon language.', 'Cards, Lindqvist. Go ahead.'),
  },
  {
    contact: { id: 'surg', name: 'Dr. Ben Adeyemi', role: 'General surgery resident on call', org: 'Grand Therapies Medical Center', phone: 'x4520', kind: 'internal' },
    voice: { id: 'am_fenrir', speed: 1.04 },
    persona: consultantPersona('Senior surgical resident, post-call-tired, skeptical of ED consults until the story is tight, warms up with good data.', 'Dry, impatient, asks "What\'s the white count? What did the CT show?"', 'Surgery, Adeyemi.'),
  },
  {
    contact: { id: 'hosp', name: 'Dr. Priya Nair', role: 'Hospitalist (admissions)', org: 'Grand Therapies Medical Center', phone: 'x4100', kind: 'internal' },
    voice: { id: 'af_sky', speed: 1.02 },
    persona: consultantPersona('Night hospitalist covering 30 patients, friendly but triages hard; wants a clean handoff.', 'Organized, asks for the "one-liner", code status and pending results.', 'Medicine admitting, this is Priya.'),
  },
  {
    contact: { id: 'icu', name: 'Dr. Jonas Weber', role: 'MICU fellow on call', org: 'Grand Therapies Medical Center', phone: 'x4800', kind: 'internal' },
    voice: { id: 'bm_fable', speed: 0.96 },
    persona: consultantPersona('Critical care fellow, calm, physiology-minded, will come down to see truly sick patients.', 'Measured, asks about MAP, lactate trend and fluid totals.', 'ICU, Weber.'),
  },
  {
    contact: { id: 'ortho', name: 'Dr. Lars Nilsson', role: 'Orthopedics on call', org: 'Grand Therapies Medical Center', phone: 'x4630', kind: 'internal' },
    voice: { id: 'bm_lewis', speed: 1.12 },
    persona: consultantPersona('Orthopedic resident in the OR with a hip fracture; answers between cases, mildly annoyed by non-urgent calls.', 'Short, muffled ("I\'m scrubbed in, make it quick").', 'Ortho — I\'m scrubbed, talk fast.'),
  },
  {
    contact: { id: 'obgyn', name: 'Dr. Amara Osei', role: 'OB/GYN on call', org: 'Grand Therapies Medical Center', phone: 'x4740', kind: 'internal' },
    voice: { id: 'bf_alice' },
    persona: consultantPersona('OB/GYN resident on labor & delivery, helpful, wants hCG and pelvic ultrasound before coming down.', 'Warm, efficient.', 'OB, Osei speaking.'),
  },
  {
    contact: { id: 'lab', name: 'Clinical Laboratory', role: 'Core lab (Tony)', org: 'Grand Therapies Medical Center', phone: 'x2200', kind: 'internal' },
    voice: VOICE_CAST.lab,
    persona: {
      personality: 'Night-shift lab tech Tony, friendly, a little overwhelmed by the analyzer queue.',
      voice: 'Casual; reads values back carefully.',
      healthLiteracy: 'high',
      opening: 'Lab, this is Tony.',
      facts: [],
      unknowns: ['clinical details'],
      behavior: ['Only report results listed as resulted in the situation. For pending tests give the status and a realistic ETA. Never invent values.', 'If a specimen was never received, say so.'],
      capacity: 'intact',
      fallback: 'Let me check... I don\'t have anything on that yet.',
    },
  },
  {
    contact: { id: 'radiology', name: 'Dr. Kenji Ito', role: 'Radiology reading room', org: 'Grand Therapies Medical Center', phone: 'x3300', kind: 'internal' },
    voice: { id: 'bm_george', speed: 0.98 },
    persona: {
      personality: 'Night radiologist, precise, helpful with protocols; mildly allergic to "rule out everything" requests.',
      voice: 'Calm, technical.',
      healthLiteracy: 'high',
      opening: 'Reading room, Ito.',
      facts: [],
      unknowns: ['studies not yet performed'],
      behavior: [
        'You can discuss only studies listed as completed in the situation (quote their reports) and give protocol advice (contrast, pregnancy testing for women 12–55 before CT, creatinine for contrast in CKD/age > 60).',
        'Push back on imaging without a clear question; suggest the right study.',
      ],
      capacity: 'intact',
      fallback: 'What\'s the clinical question?',
    },
  },
  {
    contact: { id: 'pharm', name: 'Grace Kim, PharmD', role: 'ED clinical pharmacist', org: 'Grand Therapies Medical Center', phone: 'x2650', kind: 'internal' },
    voice: { id: 'af_river' },
    persona: {
      personality: 'ED clinical pharmacist, extremely knowledgeable, practical about renal dosing, allergy cross-reactivity and high-alert drugs.',
      voice: 'Friendly, exact doses with units.',
      healthLiteracy: 'high',
      opening: 'ED pharmacy, Grace.',
      facts: [],
      unknowns: ['patients\' undocumented history'],
      behavior: ['Give evidence-based dosing/allergy advice using the chart summaries in the situation. Do not diagnose. Keep it to 2–3 sentences.'],
      capacity: 'intact',
      fallback: 'Which patient and which drug?',
    },
  },
  transferCenter,
];

// ───────────────────────────── scenarios ─────────────────────────────

const orientation: ScenarioDef = {
  id: 'orientation',
  title: 'Orientation Day',
  subtitle: 'Easy · 2 patients · no surprises',
  difficulty: 'easy',
  description: 'Your first afternoon in the Grand Therapies Medical Center ED. Two patients, a supportive attending, and time to learn the workflow: history, exam, AgentChart orders, the phone, and disposition.',
  learningGoals: ['Ottawa ankle rules and imaging stewardship', 'Pregnancy testing before CT in women of reproductive age', 'Consulting surgery with a tight presentation', 'Using the EHR: orders, results, notes, disposition'],
  layoutId: 'ed',
  shiftStart: '13:00',
  durationMin: 180,
  defaultTimeScale: 4,
  patients: [
    { caseId: 'ankle_sprain', bed: 'ft_1', arriveAtMin: -20, nurseId: 'rn_aisha' },
    { caseId: 'appendicitis', bed: 'bed_5', arriveAtMin: 2, nurseId: 'rn_aisha' },
  ],
  staff: onDuty(STAFF, 'ed', '13:00'),
  internalContacts: INTERNAL_CONTACTS,
  events: [
    { atMin: 6, kind: 'page', from: 'Dr. Shaw (attending)', text: 'Tip: walk to a workstation (nurses\' station or workroom) and press E to open AgentChart. Tab brings up your tablet: your patients, and their charts.', priority: 'info' },
    { atMin: 25, kind: 'page', from: 'Dr. Shaw (attending)', text: 'Tip: press E next to a patient to talk and examine. Typing works; the 🎤 button lets you speak.', priority: 'info' },
    { atMin: 70, kind: 'rounds', npcId: 'att_shaw', text: 'Let\'s run the board — come find me at the station and present your patients.' },
  ],
  errors: [],
  intro: [
    { from: 'Dr. Evelyn Shaw (attending)', text: 'Welcome to Grand Therapies! Easy afternoon: a basketball ankle in Fast Track 1, and a young woman with belly pain arriving to Bed 5. See them, order what you need in AgentChart, call consultants from the phone, and set a disposition. I\'m in the physicians\' workroom.' },
  ],
};

const nightShift: ScenarioDef = {
  id: 'night_shift',
  title: 'Night Shift',
  subtitle: 'Medium · 4 patients · staff errors on',
  difficulty: 'medium',
  description: 'A Thursday night in the ED: a chest pain walks in, EMS brings a confused grandmother, a palpitations patient with a very similar name arrives, and the ankle in Fast Track is getting impatient. The nurses are stretched — and not every error will be yours.',
  learningGoals: ['STEMI recognition and door-to-activation times', 'RV infarction and nitrate contraindications', 'Sepsis hour-1 bundle and antibiotic selection from prior cultures', 'Collateral history (family, GP after-hours line)', 'AF rate control, precipitants and stroke prevention', 'Catching staff errors: incomplete vitals, cultures after antibiotics, look-alike names'],
  layoutId: 'ed',
  shiftStart: '22:00',
  durationMin: 300,
  defaultTimeScale: 6,
  patients: [
    { caseId: 'ankle_sprain', bed: 'ft_1', arriveAtMin: -25, nurseId: 'rn_aisha' },
    { caseId: 'urosepsis_esbl', bed: 'bed_4', arriveAtMin: 4, nurseId: 'rn_aisha' },
    { caseId: 'stemi_inferior', bed: 'bed_2', arriveAtMin: 12, nurseId: 'rn_tom' },
    { caseId: 'afib_rvr', bed: 'bed_3', arriveAtMin: 30, nurseId: 'rn_tom' },
  ],
  staff: onDuty(STAFF, 'ed', '22:00'),
  internalContacts: INTERNAL_CONTACTS,
  events: [
    { atMin: 2, kind: 'bark', npcId: 'rn_rosa', text: 'EMS is two minutes out with an elderly lady, altered. Bed 4.' },
    { atMin: 75, kind: 'rounds', npcId: 'att_shaw', text: 'Board rounds — find me at the nurses\' station and walk me through your patients.' },
    { atMin: 150, kind: 'page', from: 'Rosa (charge RN)', text: 'Heads-up: waiting room is backing up. Can we move dispositions along?', priority: 'info' },
  ],
  errors: [
    { id: 'err_temp', kind: 'missing_triage_vital', caseId: 'urosepsis_esbl', vital: 'temp', points: 8, label: 'Noticed the missing triage temperature (Bed 4) and had it measured', teaching: 'A missing temperature hides a SIRS/sepsis criterion — always check triage vitals for completeness.' },
    { id: 'err_cultures', kind: 'abx_before_cultures', caseId: 'urosepsis_esbl', points: 8, label: 'Prevented antibiotics from hanging before blood cultures (Bed 4)', teaching: 'Draw blood cultures before antibiotics — but never delay antibiotics > 45 min to get them.' },
    {
      id: 'err_wrong_pt',
      kind: 'wrong_patient_med',
      atMin: 52,
      nurseId: 'rn_tom',
      intendedCaseId: 'afib_rvr',
      wrongCaseId: 'stemi_inferior',
      medCode: 'metoprolol_iv',
      dose: '5 mg',
      route: 'IV push over 2 min',
      orderedBy: 'Dr. Shaw (verbal, for Kellner)',
      windowMin: 6,
      points: 15,
      label: 'Stopped metoprolol meant for Kellner (Bed 3) from being given to Keller (Bed 2)',
      teaching: 'Look-alike names: use two identifiers (name + DOB/MRN) and check the order against the wristband before every administration.',
    },
  ],
  intro: [
    { from: 'Dr. Evelyn Shaw (attending)', text: 'Evening! Quiet... for now. There\'s an ankle in Fast Track 1 who\'s been waiting a while. EMS is bringing an elderly confused woman to Bed 4. I\'m in the workroom finishing charts — grab me anytime. Sickest first.' },
    { from: 'Rosa Delgado (charge RN)', text: 'Heads-up, Doc: Tom has 1 to 3 and resus, Aisha has 4 to 6 and Fast Track. We\'re short a nurse tonight, so be specific with your orders.' },
  ],
};

export const SCENARIOS: Record<string, ScenarioDef> = { orientation, night_shift: nightShift };

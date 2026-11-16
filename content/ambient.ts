/**
 * Ambient life (SERVER-ONLY content, no clinical truth): who sits in the waiting room, what they
 * carry, the small talk they make, and the occasional emergency (a vasovagal faint at the walk-in
 * door). Purely atmospheric: never scored, not in the agent API or the action space, and scheduled
 * by server/sim/ambient.ts from its own seed stream, so clinical runs stay comparable.
 *
 * Writing rules:
 *  - quiet, ordinary lines; no medical advice, nothing offensive, no brand names
 *  - names never look like anyone on the board or in the cases (look-alike names are a gameplay
 *    error to catch; tests/ambient.test.ts checks it)
 *  - visible cues match the complaint (ice pack on a wrist, a mask on whoever coughs)
 */
import type { AmbientAct, AmbientProp, Appearance, Emotion } from '../shared/types';
import type { TtsVoice } from '../shared/voices';

export interface CrowdPersona {
  id: string;
  /** what the triage nurse calls out ("Tyler Nguyen?"); companions have none */
  callName?: string;
  sex: 'm' | 'f';
  appearance: Appearance;
  /** worn or carried the whole time */
  props?: AmbientProp[];
  /** seated idles they cycle through (repeat an entry to weight it) */
  idles: AmbientAct[];
  emotion?: Emotion;
  /** sits next to this persona and leaves with them */
  companionOf?: string;
  /** why they're here (for authors; never shown) */
  note: string;
  /** walking pace m/s (default 1.25; elderly ≈ 0.75) */
  pace?: number;
  /** triage acuity: the nurse calls lower numbers first (default 4); companions have none */
  esi?: 3 | 4 | 5;
  /** what the nurse says when they come over (default: TRIAGE.greet) */
  greet?: string;
  /** a companion's word as they get up to go with their person */
  followLine?: string;
}

const casual = (o: Partial<Appearance>): Appearance => ({
  skin: '#e0b48f',
  hair: '#2b1d14',
  hairStyle: 'short',
  outfit: 'casual',
  outfitColor: '#4a5a6a',
  height: 1.74,
  build: 'average',
  age: 'adult',
  ...o,
});

/** already waiting when a shift starts */
const SEATED: CrowdPersona[] = [
  {
    id: 'amb_wrist',
    callName: 'Tyler Nguyen',
    sex: 'm',
    appearance: casual({ skin: '#d9b08a', hair: '#141110', height: 1.78, build: 'slim', age: 'young', outfitColor: '#2f3b4c' }),
    props: ['icepack', 'phone'],
    idles: ['phone_text', 'phone_text', 'idle', 'look', 'touch_face'],
    note: '19, came off his skateboard, painful left wrist (ESI 4: needs an X-ray). Ice pack from the desk.',
  },
  {
    id: 'amb_cut',
    callName: 'Elena Costa',
    sex: 'f',
    appearance: casual({ skin: '#e3b995', hair: '#3a2417', hairStyle: 'long', height: 1.64, outfitColor: '#6b2f3a' }),
    props: ['bandage'],
    idles: ['idle', 'wait', 'listen', 'look'],
    note: '46, cut her palm slicing bread; gauze from triage, hand held up (ESI 4: sutures).',
  },
  {
    id: 'amb_cut_partner',
    sex: 'm',
    appearance: casual({ skin: '#d8a982', hair: '#2a2420', height: 1.8, build: 'heavy', outfitColor: '#3c4a3a' }),
    // the broadsheet he grabbed on the way out: open in both hands, folded on his lap when they talk
    props: ['newspaper'],
    idles: ['read', 'read', 'look', 'idle', 'yawn'],
    companionOf: 'amb_cut',
    followLine: "I'll come with you.",
    note: 'Her husband. Reads the paper he grabbed on the way out, watches the TV, fetches water, makes her laugh.',
  },
  {
    id: 'amb_walker',
    callName: 'Harold Fischer',
    sex: 'm',
    appearance: casual({ skin: '#e6c2a5', hair: '#d6d6d6', height: 1.7, build: 'slim', age: 'old', outfitColor: '#5b5348' }),
    props: ['walker'],
    idles: ['idle', 'idle', 'sleep', 'look'],
    emotion: 'drowsy',
    pace: 0.7,
    esi: 3,
    note: '84, two falls at home this week, more unsteady than usual; brought in by his daughter (ESI 3).',
  },
  {
    id: 'amb_daughter',
    sex: 'f',
    appearance: casual({ skin: '#e8c4a8', hair: '#5a3d28', hairStyle: 'bun', height: 1.66, outfitColor: '#2e4a63' }),
    props: ['phone'],
    idles: ['wait', 'phone_text', 'look', 'idle'],
    emotion: 'anxious',
    companionOf: 'amb_walker',
    followLine: 'Come on, Dad. Slowly.',
    note: 'His daughter, came straight from work; keeps her brother updated by phone.',
  },
  {
    id: 'amb_earbuds',
    callName: 'Chloe Park',
    sex: 'f',
    appearance: casual({ skin: '#ecd0b8', hair: '#151213', hairStyle: 'ponytail', height: 1.62, build: 'slim', age: 'young', outfitColor: '#c9c3b8' }),
    props: ['earbuds', 'phone'],
    idles: ['phone_text', 'phone_text', 'phone_text', 'look'],
    note: '23, lower abdominal cramps since this morning (ESI 4). Scrolling, music on.',
  },
  {
    id: 'amb_sleeper',
    sex: 'm',
    appearance: casual({ skin: '#a8724f', hair: '#1a1410', hairStyle: 'buzz', height: 1.83, outfitColor: '#3d3d42' }),
    idles: ['sleep'],
    note: '31, waiting for his brother who is being seen in the back; asleep, slumped.',
  },
  {
    id: 'amb_impatient',
    callName: 'Greg Walsh',
    sex: 'm',
    appearance: casual({ skin: '#e4b896', hair: '#6b5a48', height: 1.79, build: 'heavy', outfitColor: '#56606b' }),
    idles: ['impatient', 'impatient', 'look', 'wait'],
    emotion: 'angry',
    esi: 5,
    note: '52, low back pain since lifting a fridge, no red flags (ESI 5); asks the desk how much longer.',
  },
  {
    id: 'amb_dog',
    callName: 'Joan Hale',
    greet: 'Mrs. Hale? You can come through and see your husband now.',
    sex: 'f',
    appearance: casual({ skin: '#f0d3bf', hair: '#8a6b4a', hairStyle: 'long', height: 1.65, outfitColor: '#7a5c3e' }),
    // (she texts now and then: the phone is in her hand, as for everyone who texts)
    props: ['carrier', 'phone'],
    idles: ['wait', 'idle', 'phone_text', 'look'],
    emotion: 'anxious',
    esi: 5,
    note: 'Her husband came in by ambulance; she followed from home with their small dog in a carrier. Called through to see him.',
  },
];

/** walk-ins later in a shift (each scenario says when) */
const WALK_INS: CrowdPersona[] = [
  {
    id: 'amb_knee',
    callName: 'Josh Bennett',
    sex: 'm',
    appearance: casual({ skin: '#e9c3a0', hair: '#4a3420', height: 1.81, build: 'average', age: 'young', outfitColor: '#24476b' }),
    props: ['phone'],
    idles: ['phone_text', 'idle', 'look', 'touch_face'],
    pace: 0.85,
    note: '27, twisted his knee at five-a-side, limping, can bear weight (ESI 4).',
  },
  {
    id: 'amb_cough',
    callName: "Liam O'Connor",
    sex: 'm',
    appearance: casual({ skin: '#efd2bd', hair: '#8b5a32', height: 1.76, outfitColor: '#5a3f2e' }),
    props: ['mask'],
    idles: ['cough', 'idle', 'cough', 'wait', 'yawn'],
    note: '38, three days of cough and fever; puts on a mask at the door as the sign asks (ESI 4).',
  },
  {
    id: 'amb_migraine',
    callName: 'Nadia Kovac',
    sex: 'f',
    appearance: casual({ skin: '#ecc9ae', hair: '#241914', hairStyle: 'long', height: 1.68, build: 'slim', outfitColor: '#3b3f4a' }),
    idles: ['touch_face', 'touch_face', 'wait', 'sleep'],
    emotion: 'pain',
    esi: 3,
    note: '34, her usual migraine but worse, light hurts, no red flags (ESI 3). Eyes closed, head in hand.',
  },
  {
    id: 'amb_thumb',
    callName: 'Sam Carter',
    sex: 'm',
    appearance: casual({ skin: '#b98260', hair: '#1c1612', hairStyle: 'buzz', height: 1.77, outfitColor: '#6a6f2e' }),
    props: ['bandage', 'phone'],
    idles: ['phone_text', 'idle', 'look'],
    note: '29, cut his thumb opening a tin; dressing from triage (ESI 4).',
  },
  // the emergency (server/sim/ambient.ts: collapse): a vasovagal faint just inside the walk-in door
  {
    id: 'amb_faint',
    callName: 'Ryan Doyle',
    sex: 'm',
    appearance: casual({ skin: '#ead0bb', hair: '#2e2018', height: 1.8, build: 'slim', age: 'young', outfitColor: '#2b2f36' }),
    props: ['towel'],
    idles: ['idle'],
    emotion: 'anxious',
    note: '24, sliced his forearm on a broken glass, towel wrapped round it; sees the blood under the bright lights, feels hot and sick, faints (vasovagal). Comes round within a minute.',
  },
  {
    id: 'amb_faint_friend',
    sex: 'f',
    appearance: casual({ skin: '#e2b48e', hair: '#1d1512', hairStyle: 'ponytail', height: 1.66, build: 'slim', age: 'young', outfitColor: '#8a3d52' }),
    idles: ['wait'],
    emotion: 'anxious',
    companionOf: 'amb_faint',
    note: 'His flatmate, drove him in.',
  },
  // more of the evening's walk-ins
  {
    id: 'amb_vomit',
    callName: 'Sofia Marin',
    sex: 'f',
    appearance: casual({ skin: '#e8c2a2', hair: '#3b2a1f', hairStyle: 'bun', height: 1.63, outfitColor: '#4f5d6e' }),
    idles: ['wait', 'touch_face', 'idle', 'sleep'],
    emotion: 'sad',
    note: '41, vomiting and diarrhoea since dinner, keeping fluids down now (ESI 4).',
  },
  {
    id: 'amb_back',
    callName: 'Peter Lang',
    sex: 'm',
    appearance: casual({ skin: '#e2b999', hair: '#8c8c8c', height: 1.77, build: 'heavy', outfitColor: '#3e4a57' }),
    props: ['phone'],
    idles: ['wait', 'idle', 'phone_text', 'stretch'],
    emotion: 'pain',
    pace: 0.8,
    esi: 5,
    note: '61, low back pain after gardening, walks stiffly, no leg symptoms (ESI 5).',
  },
  {
    id: 'amb_rash',
    callName: 'Amy Chen',
    sex: 'f',
    appearance: casual({ skin: '#eccfb3', hair: '#120f0e', hairStyle: 'long', height: 1.6, build: 'slim', age: 'young', outfitColor: '#2d5a4a' }),
    props: ['phone'],
    idles: ['phone_text', 'touch_face', 'phone_text', 'look'],
    note: '26, itchy hives after a new shellfish dish, breathing fine, took an antihistamine (ESI 4).',
  },
  {
    id: 'amb_eye',
    callName: 'Raj Patel',
    sex: 'm',
    appearance: casual({ skin: '#9c6a4b', hair: '#141212', height: 1.75, outfitColor: '#5e4b3c' }),
    idles: ['touch_face', 'touch_face', 'wait', 'idle'],
    note: '45, metal fleck in his eye from grinding, waters, vision fine (ESI 4).',
  },
  {
    id: 'amb_burn',
    callName: 'Lucy Ward',
    sex: 'f',
    appearance: casual({ skin: '#f0d0b8', hair: '#a0703f', hairStyle: 'ponytail', height: 1.67, age: 'young', outfitColor: '#7b3a3a' }),
    props: ['bandage'],
    idles: ['wait', 'idle', 'look'],
    emotion: 'pain',
    note: '24, splashed boiling water on the back of her hand, small blister (ESI 4).',
  },
];

export const PERSONAS: Record<string, CrowdPersona> = Object.fromEntries([...SEATED, ...WALK_INS].map((p) => [p.id, p]));

// ───────────────────────────── small talk ─────────────────────────────

export interface ScriptLine {
  /** 'a' / 'b' = the two people in the scene; or a staff NPC id (clerk_paul, sec_dave, rn_lena) */
  who: string;
  text: string;
  /** false: said under the breath (mouth and hands move; no audio, no bubble) */
  voiced?: boolean;
  /** the speaker's gesture (default talk) */
  act?: AmbientAct;
  /** what the other one does meanwhile (default listen) */
  react?: AmbientAct;
  /** extra pause before this line, seconds at normal speed (a phone call's other side, a beat) */
  pause?: number;
}

export interface ConvoScript {
  id: string;
  lines: ScriptLine[];
}

/** a = the patient with the cut hand, b = her husband */
export const COUPLE: ConvoScript[] = [
  {
    id: 'couple_hand',
    lines: [
      { who: 'b', text: 'How is the hand?' },
      { who: 'a', text: "Throbbing. It's better if I keep it up." },
      { who: 'b', text: 'Want me to get you some water?' },
      { who: 'a', text: "I'm okay. Just stay here." },
      { who: 'b', text: '…', voiced: false },
      { who: 'a', text: "I can't believe I did that with a bread knife." },
      { who: 'b', text: "From now on I'm slicing the bread.", react: 'laugh' },
    ],
  },
  {
    id: 'couple_wait',
    lines: [
      { who: 'a', text: 'Did they say how long?' },
      { who: 'b', text: 'She said they see the sickest first.' },
      { who: 'a', text: 'So, a while.' },
      { who: 'b', text: "Probably. Want my jacket? It's cold in here.", pause: 1.5 },
      { who: 'a', text: 'Please.' },
    ],
  },
  {
    id: 'couple_tv',
    lines: [
      { who: 'b', text: 'Is that the game?', act: 'look' },
      { who: 'a', text: "It's the news. Weather's next." },
      { who: 'b', text: 'Snow again, I bet.' },
      { who: 'a', text: "In November? Don't.", act: 'laugh' },
      { who: 'b', text: '…', voiced: false },
    ],
  },
];

/** a = the daughter, b = her father (he mostly murmurs) */
export const FAMILY: ConvoScript[] = [
  {
    id: 'family_dad',
    lines: [
      { who: 'a', text: 'You okay, Dad? Do you need anything?' },
      { who: 'b', text: "I'm fine.", voiced: false },
      { who: 'a', text: "They'll call us soon." },
      { who: 'b', text: '…', voiced: false, pause: 1 },
      { who: 'a', text: "I know you want your own chair. Soon, I promise." },
    ],
  },
];

/** the daughter on the phone to her brother (one side of the call; pauses are him talking) */
export const PHONE_CALL: ConvoScript = {
  id: 'phone_brother',
  lines: [
    { who: 'a', text: "Hi, it's me. We're still in the waiting room.", act: 'phone_call' },
    { who: 'a', text: 'They checked him at triage. They said maybe two hours…', act: 'phone_call', pause: 3 },
    { who: 'a', text: "No, he's okay. Tired. He keeps asking for his own chair.", act: 'phone_call', pause: 3.5 },
    { who: 'a', text: "I'll call you as soon as we know more. Okay. Bye.", act: 'phone_call', pause: 3 },
  ],
};

/** two strangers in neighbouring seats (a spoke first) */
export const STRANGERS: ConvoScript[] = [
  {
    id: 'strangers_long',
    lines: [
      { who: 'a', text: 'Have you been here long?' },
      { who: 'b', text: 'A couple of hours. You?' },
      { who: 'a', text: 'Hour and a half.' },
      { who: 'b', text: 'Busy {tonight}, they said.', act: 'idle' },
    ],
  },
  {
    id: 'strangers_charger',
    lines: [
      { who: 'a', text: "Sorry, you wouldn't have a phone charger?" },
      { who: 'b', text: 'Not on me, sorry.' },
      { who: 'a', text: 'No worries.', act: 'idle' },
    ],
  },
];

/** the wrist and the knee, once both are waiting (a = wrist) */
export const INJURIES: ConvoScript = {
  id: 'strangers_injuries',
  lines: [
    { who: 'b', text: 'What happened to you?' },
    { who: 'a', text: 'Came off my skateboard. You?' },
    { who: 'b', text: 'Knee went at five-a-side.' },
    { who: 'a', text: 'Ouch.', react: 'laugh' },
  ],
};

/** the impatient man at registration (a), and the clerk */
export const DESK: ConvoScript[] = [
  {
    id: 'desk_how_long',
    lines: [
      { who: 'a', text: "Excuse me. I've been here two hours. How much longer?", act: 'talk_angry' },
      { who: 'clerk_paul', text: "I'm sorry, sir. We see the most urgent patients first, and you're on the list." },
      { who: 'a', text: 'Right. The list.', act: 'impatient' },
    ],
  },
  {
    id: 'desk_again',
    lines: [
      { who: 'a', text: 'Any idea yet? Even roughly?', act: 'talk_angry' },
      { who: 'clerk_paul', text: "I really can't say. If anything gets worse, tell the triage nurse straight away." },
      { who: 'a', text: 'Yeah. Fine.', act: 'impatient' },
    ],
  },
];

/** checking in at registration (a = the walk-in) */
export const REGISTER: ConvoScript = {
  id: 'register',
  lines: [
    { who: 'clerk_paul', text: 'Hi there. What brings you in {tonight}?' },
    { who: 'a', text: '…', voiced: false },
    { who: 'clerk_paul', text: 'Okay. Can I see a photo ID and your insurance card?', pause: 1 },
    { who: 'a', text: '…', voiced: false, act: 'idle' },
    { who: 'clerk_paul', text: "Thanks. Take a seat, and the triage nurse will call you." },
  ],
};

/** the small dog in its carrier (a = its owner, b = whoever she sits next to) */
export const DOG = {
  hush: ['Shh, Bella. It’s okay.', 'Shh. Good girl.', "Bella, quiet. We're nearly done."],
  neighbour: {
    id: 'dog_neighbour',
    lines: [
      { who: 'b', text: 'Is that a dog in there?', act: 'look' },
      { who: 'a', text: "Sorry. That's Bella. I couldn't leave her at home." },
      { who: 'b', text: "She's fine. I like dogs." },
    ],
  } satisfies ConvoScript,
  security: {
    id: 'dog_security',
    lines: [
      { who: 'sec_dave', text: 'Ma’am, the dog has to stay in the carrier, okay?' },
      { who: 'a', text: "Of course. Sorry, she's just nervous." },
    ],
  } satisfies ConvoScript,
};

/** the triage nurse calling the next patient; {name} = their call name, {first} = first name */
export const TRIAGE = {
  call: ['{name}?', '{name}? …{first}?'],
  answer: ["That's me.", 'Here.', 'Yes, me.'],
  greet: ["Hi, I'm {nurse}, one of the nurses. Come on through.", "Hi {first}. Come with me, I'll check your vitals.", 'Come on through, this way.'],
  back: ['{name}? We have a room for you now.'],
  companion: ["Let's go."],
};

/** walk-in with a cough: security points to the masks by the door */
export const MASK_LINE = "Masks are right there, sir, if you're coughing.";

// ───────────────────────────── the emergency: a faint at the walk-in door ─────────────────────────────

export type CollapseRole = 'patient' | 'friend' | 'guard' | 'nurse' | 'clerk' | 'filmer';

/**
 * Vasovagal syncope, the way it plays out in a waiting room: prodrome (hot, pale, unsteady), knees
 * buckle, he sinks to the floor; his friend shouts; security reaches him first and radios for a
 * nurse; registration calls a rapid response; the triage nurse runs over and checks response,
 * breathing and pulse, keeps him flat with his legs raised, sends for a wheelchair; he comes round
 * within a minute (no chest pain, no palpitations, no head strike), sits up slowly, and is wheeled
 * through for a monitor, a finger-stick glucose and an ECG (every syncope gets one).
 * `at` = seconds at normal game speed from the moment his knees buckle (negative: before).
 */
export const COLLAPSE_LINES: { at: number; who: CollapseRole; text: string; volume?: number }[] = [
  { at: -4.5, who: 'friend', text: "You okay? You've gone really pale.", volume: 0.75 },
  { at: -2, who: 'patient', text: 'I feel… really hot.', volume: 0.55 },
  { at: 0.4, who: 'friend', text: 'Ryan? Ryan!', volume: 1 },
  { at: 2.2, who: 'friend', text: 'Help! Somebody help, he just collapsed!', volume: 1 },
  { at: 4.6, who: 'guard', text: 'Sir? Sir, can you hear me?', volume: 0.95 },
  { at: 7.5, who: 'guard', text: 'Security to triage, I need a nurse in the waiting room, now.', volume: 0.85 },
  { at: 9.2, who: 'clerk', text: 'Registration. Rapid response to the emergency waiting room, please.', volume: 0.7 },
  // the triage nurse comes round from triage by the corridor (~20 m): with him from ~21 s
  { at: 23, who: 'nurse', text: 'Sir, can you hear me? Open your eyes for me.', volume: 0.9 },
  { at: 26.5, who: 'nurse', text: "He's breathing. Good pulse, a bit slow. Dave, grab us a wheelchair, please.", volume: 0.8 },
  { at: 30, who: 'nurse', text: 'Did he hit his head?', volume: 0.8 },
  { at: 32, who: 'friend', text: 'No, he sort of sank down. He looked at his arm and went white.', volume: 0.8 },
  { at: 36.5, who: 'nurse', text: "Okay. Let's keep him flat and lift his legs. Can you hold his ankles up for me?", volume: 0.85 },
  { at: 41.5, who: 'nurse', text: 'Can everyone give us a little room, please?', volume: 0.9 },
  { at: 46, who: 'patient', text: 'What… what happened?', volume: 0.6 },
  { at: 48.5, who: 'nurse', text: "You fainted. You're okay. Stay down a minute.", volume: 0.75 },
  { at: 53, who: 'nurse', text: 'Any chest pain? Did your heart race before it happened?', volume: 0.75 },
  { at: 56, who: 'guard', text: 'Sir, please put the phone away. No filming in here.', volume: 0.85 },
  { at: 58.5, who: 'patient', text: 'No. I just felt hot, and sick.', volume: 0.6 },
  { at: 61.5, who: 'nurse', text: "Okay. You can put his legs down. We'll sit you up slowly.", volume: 0.75 },
  { at: 70, who: 'nurse', text: "There we go. We'll get you on a monitor, check your sugar and do an ECG.", volume: 0.75 },
  { at: 75.5, who: 'guard', text: "Okay, folks, he's in good hands. Please take your seats.", volume: 0.85 },
];

/** what the waiting room murmurs once he is wheeled away (some said aloud, quietly) */
export const AFTERMATH = ['Poor guy.', 'Is he okay?', 'He just went down.', 'That was scary.'];

/** overhead page (through the soundscape's PA) */
export const COLLAPSE_PAGE = 'Rapid response, emergency department waiting room.';

// ───────────────────────────── per scenario ─────────────────────────────

export interface AmbientDef {
  /** personas waiting when the shift starts (vis_1…3 in the staff roster sit there too) */
  present: string[];
  /** walk-ins: persona + arrival window (minutes after the shift starts) */
  arrivals: { persona: string; window: [number, number] }[];
  /** at most one emergency per shift: its chance and window (minutes) */
  collapse?: { chance: number; window: [number, number] };
  /** minutes between the triage nurse's calls */
  callEvery: [number, number];
  /**
   * TTS casting for crowd members who speak aloud (Kokoro ids). Distinct from each other and from
   * everyone whose place is in or next to the waiting room (clerk, security, triage, vis_*, the
   * soundscape's TV and PA voices); a far-away character may share one (26 voices for ~30 people).
   */
  voices: Record<string, TtsVoice>;
}

export const AMBIENT: Record<string, AmbientDef> = {
  night_shift: {
    present: ['amb_wrist', 'amb_cut', 'amb_cut_partner', 'amb_walker', 'amb_daughter', 'amb_earbuds', 'amb_sleeper', 'amb_impatient', 'amb_dog'],
    arrivals: [
      { persona: 'amb_knee', window: [8, 30] },
      { persona: 'amb_vomit', window: [20, 60] },
      { persona: 'amb_cough', window: [32, 75] },
      { persona: 'amb_back', window: [45, 100] },
      { persona: 'amb_migraine', window: [65, 120] },
      { persona: 'amb_rash', window: [90, 150] },
      { persona: 'amb_thumb', window: [115, 200] },
      { persona: 'amb_eye', window: [140, 215] },
      { persona: 'amb_burn', window: [175, 255] },
    ],
    collapse: { chance: 0.75, window: [25, 150] },
    callEvery: [18, 30],
    voices: {
      amb_faint: { id: 'am_liam' },
      amb_faint_friend: { id: 'af_aoede', speed: 1.05 },
      amb_daughter: { id: 'bf_isabella' },
      amb_cut: { id: 'bf_alice', speed: 0.98 },
      amb_cut_partner: { id: 'am_fenrir', speed: 0.96 },
      amb_impatient: { id: 'bm_fable', speed: 1.04 },
      amb_dog: { id: 'af_sarah', speed: 0.97 },
      amb_wrist: { id: 'am_michael', speed: 1.06 },
      amb_knee: { id: 'am_echo', speed: 0.97 },
      amb_float_rn: { id: 'bf_emma', speed: 1.05 },
    },
  },
  orientation: {
    present: ['amb_wrist', 'amb_cut', 'amb_cut_partner', 'amb_walker', 'amb_daughter', 'amb_earbuds', 'amb_sleeper', 'amb_impatient', 'amb_dog', 'amb_knee', 'amb_thumb'],
    arrivals: [
      { persona: 'amb_cough', window: [8, 40] },
      { persona: 'amb_vomit', window: [15, 50] },
      { persona: 'amb_back', window: [30, 80] },
      { persona: 'amb_migraine', window: [40, 95] },
      { persona: 'amb_rash', window: [60, 120] },
      { persona: 'amb_eye', window: [90, 150] },
    ],
    collapse: { chance: 0.6, window: [20, 120] },
    callEvery: [12, 20],
    voices: {
      amb_faint: { id: 'am_michael' },
      amb_faint_friend: { id: 'bf_emma', speed: 1.05 },
      amb_daughter: { id: 'bf_isabella' },
      amb_cut: { id: 'bf_alice', speed: 0.98 },
      amb_cut_partner: { id: 'am_fenrir', speed: 0.96 },
      amb_impatient: { id: 'bm_fable', speed: 1.04 },
      amb_dog: { id: 'af_sarah', speed: 0.97 },
      amb_wrist: { id: 'am_echo', speed: 1.06 },
      amb_knee: { id: 'am_eric', speed: 0.97 },
      amb_float_rn: { id: 'af_alloy', speed: 1.05 },
    },
  },
};

/** a stand-in nurse for the triage nurse when she is busy with you (never pulls her from gameplay) */
export const FLOAT_RN = {
  id: 'amb_float_rn',
  name: 'Jo Bauer',
  appearance: { skin: '#e7c3a6', hair: '#4a3324', hairStyle: 'ponytail', outfit: 'scrubs', outfitColor: '#2f6f9f', height: 1.68, build: 'average', age: 'adult', accessories: ['badge'] } satisfies Appearance,
};

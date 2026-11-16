/**
 * Off-the-record small talk (SERVER-ONLY content, no clinical truth). Everyone who walks around and
 * isn't part of a case can be stopped for a word: the waiting-room crowd (content/ambient.ts) and its
 * stand-in triage nurse, registration, security, housekeeping, the shift's seated visitors, the
 * cafeteria and the outpatient clinic. server/npc/smalltalk.ts plays them: with an LLM, from the
 * persona below; offline, from the scripted lines. Off the record: never logged or scored, no game
 * time, nothing for AI agents to see.
 *
 * Writing rules:
 *  - people know only their own lives. A waiting patient knows their own complaint in everyday words
 *    (nothing beyond content/ambient.ts's note: no invented history, medicines or results) and how
 *    long they have waited; a companion knows why their person is here; staff know their job.
 *    Nobody here knows anything about the patients on the board, and nobody takes clinical orders.
 *  - names never look like anyone in the cases (tests/smalltalk.test.ts)
 *  - placeholders: {wait} = a sentence on how long they've waited, {crowd} = how many people are
 *    waiting, {tonight} = "tonight" or "today"
 */
import type { TtsVoice } from '../shared/voices';

export type SmallTalkIntent =
  | 'greet'
  | 'why'
  | 'wait'
  | 'feel'
  | 'job'
  | 'busy'
  | 'doing'
  | 'exam'
  | 'thanks'
  | 'fallback'
  /** a clinical order (or a dose) aimed at them */
  | 'order'
  /** the doctor offers them something clinical (painkillers, a look at the wound…) */
  | 'offer'
  /** questions about the patients in the department */
  | 'patients'
  /** while an emergency happens around them (the faint at the walk-in door) */
  | 'urgent';

export interface SmallTalkPersona {
  /** first name: their chat lines, and the name they give */
  name: string;
  sex: 'm' | 'f';
  /** a member of the public (waiting, visiting) or staff */
  kind: 'public' | 'staff';
  /** who you are, for the prompt (third person, no full stop) */
  who: string;
  /** what you know (the prompt's only facts) */
  knows: string[];
  /** how you talk */
  style: string;
  /** minutes already waited when the shift starts (people present from the start) */
  waitedMin?: number;
  /** scripted replies (offline mode): any intent left out uses DEFAULT_LINES for their kind */
  lines: Partial<Record<SmallTalkIntent, string[]>>;
}

/** what anyone says when their persona has nothing more particular */
export const DEFAULT_LINES: Record<'public' | 'staff', Partial<Record<SmallTalkIntent, string[]>>> = {
  public: {
    greet: ['Hi.', 'Hello.'],
    why: ["I'm just waiting to be seen."],
    wait: ['{wait}'],
    feel: ["I'm okay, thanks. Just waiting.", 'Alright. Bored, mostly.'],
    job: ["Me? I don't work here. I'm just waiting."],
    busy: ["It's pretty full in here {tonight}.", 'Busy. They said they see the sickest first.'],
    doing: ['Just waiting.', 'Passing the time.'],
    exam: ["You're a doctor? The triage nurse already had a look. They said to wait until I'm called.", "Thanks, but I'd better wait for the nurse to call me."],
    offer: ["I'd better wait for the nurse who sees me, thanks. They said they'd call me soon."],
    order: ["Sorry, I'm not staff! I'm just waiting to be seen. The nurses are through the corridor door."],
    patients: ["Sorry, I don't know anything about the people in the back.", "No idea, sorry. I'm just waiting out here."],
    thanks: ['Thanks.', 'Thank you, Doctor.', 'Thanks. You too.'],
    fallback: ["Sorry, I wouldn't know.", "Hm. Couldn't tell you, sorry."],
  },
  staff: {
    greet: ['Hi, Doc.', 'Hey, Doc.'],
    why: ['I work here, Doc.'],
    wait: ['Since the start of the shift. Long one.'],
    feel: ['Not bad, Doc. Busy.', 'Fine, thanks. Keeping going.'],
    job: ['I work here, Doc.'],
    busy: ['Steady. The waiting room has {crowd} in it.'],
    doing: ['Just my job, Doc.'],
    exam: ["I'm fine, Doc, really."],
    offer: ["I'm fine, Doc, thanks."],
    order: ["That's not something I can do, Doc. Ask the patient's nurse, or Rosa, the charge nurse. Or put it in AgentChart."],
    patients: ["I don't know the patients, Doc. Ask the nurses at the station."],
    thanks: ['No problem.', 'Anytime, Doc.'],
    fallback: ["Couldn't tell you, Doc.", 'Not sure, sorry.'],
  },
};

/**
 * Where things are, by where the person stands (server/npc/smalltalk.ts picks the area):
 * ed = the emergency department and its waiting room, street = the east wing's hospital street and
 * lobby, cafeteria, clinic = the outpatient clinic.
 */
export type Area = 'ed' | 'street' | 'cafeteria' | 'clinic';
export type Place = 'restroom' | 'coffee' | 'cafeteria' | 'vending' | 'exit' | 'triage';
export const DIRECTIONS: Record<Place, Record<Area, string>> = {
  restroom: {
    ed: "Out to the main corridor and keep going east, through the department onto the hospital street. They're at the far end, past the cafeteria.",
    street: "Far end of the street, past the cafeteria, on the left.",
    cafeteria: 'Right next door. Out onto the street, turn left, first door.',
    clinic: 'Across the street and to the right, at the far end past the cafeteria.',
  },
  coffee: {
    ed: "There's self-serve coffee in the cafeteria, all night: east along the main corridor, onto the hospital street, on the left.",
    street: 'In the cafeteria, just there on the left. Self-serve, all night.',
    cafeteria: "Right there, the self-serve machine by the drinks fridge. Press E and it's yours.",
    clinic: 'Cafeteria, just across the street. Self-serve, all night.',
  },
  cafeteria: {
    ed: "East along the main corridor, through the department and out onto the hospital street. It's on the left, open all night.",
    street: "Just there on the left. Open all night.",
    cafeteria: "You're in it!",
    clinic: 'Just across the street. Open all night.',
  },
  vending: {
    ed: "There's a vending machine in the waiting room, in the corner by the walk-in entrance. It doesn't give change.",
    street: "The nearest is in the ED waiting room, by the walk-in entrance. Or the cafeteria's open.",
    cafeteria: 'Drinks fridge is right there by the coffee. Or the vending machine in the ED waiting room.',
    clinic: "The cafeteria's across the street. There's a vending machine in the ED waiting room too.",
  },
  exit: {
    ed: "The walk-in entrance is at the end of the waiting room, by the vending machine. The parking lot's straight out.",
    street: "Back west through the ED and out the walk-in entrance, or the ambulance doors if you're staff.",
    cafeteria: "Back west along the street, through the ED, and out the walk-in entrance.",
    clinic: "Back west along the street, through the ED, and out the walk-in entrance.",
  },
  triage: {
    ed: 'Triage is just through the corridor door. The nurse calls people through from there.',
    street: 'Back west in the ED, next to the waiting room.',
    cafeteria: 'Back west in the ED, next to the waiting room.',
    clinic: "That's in the ED, next to its waiting room. Back west along the street.",
  },
};

/** staff know about the workroom's machine too */
export const STAFF_COFFEE = 'Staff have a machine in the physicians’ workroom as well.';

/**
 * The roster: the waiting-room crowd (content/ambient.ts PERSONAS), the stand-in triage nurse
 * (FLOAT_RN), and the staff in content/scenarios.ts who aren't part of the gameplay (talkable: false).
 */
export const SMALL_TALK: Record<string, SmallTalkPersona> = {
  // ───────────── the waiting-room crowd: already waiting when a shift starts ─────────────
  amb_wrist: {
    name: 'Tyler',
    sex: 'm',
    kind: 'public',
    waitedMin: 70,
    who: 'Tyler Nguyen, 19, a student waiting to be seen with a painful left wrist',
    knows: ['You came off your skateboard on the way home and landed on your outstretched left hand.', 'Your left wrist is swollen and hurts when you move it. The nurse gave you an ice pack.', 'Triage said you will probably need an X-ray, and to wait to be called.'],
    style: 'Young, casual, a little embarrassed about the fall. Short answers.',
    lines: {
      greet: ["Hey. I'm Tyler."],
      why: ['Came off my skateboard on the way home. Landed on my wrist.', "Skateboard. Put my hand out when I fell. It's pretty swollen."],
      wait: ['{wait} They said I need an X-ray.'],
      feel: ['It throbs if I move it. The ice helps a bit.', "Sore. I'm trying not to move it."],
    },
  },
  amb_cut: {
    name: 'Elena',
    sex: 'f',
    kind: 'public',
    waitedMin: 50,
    who: 'Elena Costa, 46, waiting to be seen with a cut to the palm of her hand',
    knows: ['You cut the palm of your hand slicing bread at home earlier.', 'The triage nurse put a dressing on it and said it will probably need stitches.', 'It has stopped bleeding. You keep the hand raised, as the nurse told you.', 'Your husband Marco drove you in and is waiting with you.'],
    style: 'Warm, a bit embarrassed, wry.',
    lines: {
      greet: ["Hello. I'm Elena."],
      why: ['I cut my palm slicing bread. With a bread knife, of all things.', "Bread knife. The nurse dressed it and said it'll probably need stitches."],
      feel: ["It throbs, but it's stopped bleeding. I'm keeping it up like she said."],
    },
  },
  amb_cut_partner: {
    name: 'Marco',
    sex: 'm',
    kind: 'public',
    waitedMin: 50,
    who: 'Marco Costa, waiting with his wife Elena, who cut her hand',
    knows: ['Your wife Elena cut the palm of her hand on a bread knife earlier. You drove her in.', "You're fine yourself; you're keeping her company."],
    style: 'Easygoing; jokes to keep his wife calm.',
    lines: {
      greet: ['Hi there. Marco.'],
      why: ['My wife cut her hand on the bread knife. I drove her in.', "I'm just the driver. My wife cut her hand."],
      feel: ["Me? I'm fine. Just bored.", "Fine. She's the brave one."],
      doing: ['Keeping her company.'],
    },
  },
  amb_walker: {
    name: 'Harold',
    sex: 'm',
    kind: 'public',
    waitedMin: 95,
    who: 'Harold Fischer, 84, waiting with his daughter Anna after two falls at home this week',
    knows: ['You have fallen twice at home this week and feel more unsteady on your feet than usual.', 'Your daughter Anna brought you in. She has your list of medicines; you do not remember their names.', 'You are tired and would like to go home to your own chair.'],
    style: 'Elderly, slow, a little hard of hearing, gruff but polite; few words.',
    lines: {
      greet: ["Eh? Oh, hello. Harold."],
      why: ['A couple of falls this week. My daughter worries.', "Legs aren't what they were. Fell twice this week."],
      wait: ['{wait} Feels longer.'],
      feel: ["Tired. I'd like my own chair."],
      fallback: ['Ask my daughter. She knows all that.', 'Eh? Speak up a bit.'],
    },
  },
  amb_daughter: {
    name: 'Anna',
    sex: 'f',
    kind: 'public',
    waitedMin: 95,
    who: 'Anna Fischer, waiting with her father Harold (84), who has fallen twice this week',
    knows: ['Your father has fallen twice at home this week and seems more unsteady than usual.', 'You came straight from work to bring him in.', 'You brought his medicine list for whoever sees him; you would rather go through it with them.', 'You keep your brother updated by phone.'],
    style: 'Polite, tired, worried, efficient.',
    lines: {
      greet: ["Hi. I'm Anna. This is my dad."],
      why: ["My dad's fallen twice this week. He's more unsteady than usual, so I brought him in."],
      wait: ['{wait} He just wants to go home.'],
      feel: ['Worried, honestly. I came straight from work.'],
      doing: ['Keeping my brother updated.'],
    },
  },
  amb_earbuds: {
    name: 'Chloe',
    sex: 'f',
    kind: 'public',
    waitedMin: 110,
    who: 'Chloe Park, 23, waiting to be seen with tummy cramps',
    knows: ['You have had cramping pain low in your tummy since this morning.', 'The triage nurse saw you and asked you to wait.', 'You are listening to music to pass the time.'],
    style: 'Young, quiet; takes out one earbud to talk; short answers.',
    lines: {
      greet: ['*takes out an earbud* Hi.'],
      why: ['Cramps, low in my tummy, since this morning. Triage said to wait.'],
      feel: ['It comes and goes. Better if I sit still.'],
      doing: ['Music. Helps the time go.'],
      fallback: ["I'd rather talk to the nurse about that, sorry."],
    },
  },
  amb_sleeper: {
    name: 'Jamal',
    sex: 'm',
    kind: 'public',
    waitedMin: 80,
    who: "Jamal, 31, waiting for his brother, who is being seen in the back by another doctor",
    knows: ["Your brother is being seen in the back (not by this doctor); you're his ride home.", 'You are tired after an early shift at work and dozed off in the chair.', "You don't know the details of your brother's care. He'll tell you when he's out."],
    style: 'Sleepy, friendly, mumbles a little.',
    lines: {
      greet: ['Mm? Hey.'],
      why: ["My brother's being seen in the back. I'm just his ride home."],
      wait: ['{wait} Nodded off, sorry.'],
      feel: ['Just tired. Early shift at work.'],
    },
  },
  amb_impatient: {
    name: 'Greg',
    sex: 'm',
    kind: 'public',
    waitedMin: 95,
    who: 'Greg Walsh, 52, waiting to be seen with low back pain, and fed up with the wait',
    knows: ['You hurt your lower back lifting a fridge.', 'It hurts to move, but you can walk.', 'You have been waiting a long time and nobody tells you anything.'],
    style: 'Grumpy, sarcastic, impatient, never abusive; softens if someone is kind to him.',
    lines: {
      greet: ['Yeah?'],
      why: ['Put my back out lifting a fridge. Hurts like hell.'],
      wait: ['{wait} And counting. Nobody tells you anything.'],
      feel: ['How do you think? My back is killing me.', "Fed up. That's how I feel."],
      exam: ['Are you seeing me now? No? Then I suppose I keep waiting.'],
      thanks: ['Yeah. Thanks.'],
    },
  },
  amb_dog: {
    name: 'Joan',
    sex: 'f',
    kind: 'public',
    waitedMin: 40,
    who: 'Joan Hale, waiting with her small dog Bella in a carrier while her husband is treated in the back by another doctor',
    knows: ['Your husband came in by ambulance earlier; another doctor is looking after him in the back (not this doctor).', 'You followed from home and could not leave your little dog Bella alone, so she is in the carrier.', 'Staff said you can go through and see him soon.'],
    style: 'Gentle, apologetic, a little anxious; happy to talk about the dog.',
    lines: {
      greet: ["Oh, hello. Sorry about the dog. That's Bella."],
      why: ["My husband came in by ambulance. Another doctor's looking after him. They said I can see him soon."],
      wait: ["{wait} They said it won't be long now."],
      feel: ["A bit shaken, to be honest. Bella's keeping me calm."],
      fallback: ["Bella's very good, mostly. She just doesn't like the beeping."],
    },
  },
  // ───────────── walk-ins ─────────────
  amb_knee: {
    name: 'Josh',
    sex: 'm',
    kind: 'public',
    waitedMin: 35,
    who: 'Josh Bennett, 27, waiting to be seen with a twisted knee',
    knows: ['You twisted your knee playing five-a-side football.', 'You can walk on it, but you limp.'],
    style: 'Cheerful, sporty, a bit sheepish.',
    lines: {
      greet: ['Alright? Josh.'],
      why: ['Twisted my knee playing five-a-side. I can walk on it, just about.'],
      feel: ["Sore. Bit stiff now I've sat down."],
    },
  },
  amb_cough: {
    name: 'Liam',
    sex: 'm',
    kind: 'public',
    who: "Liam O'Connor, 38, waiting to be seen with a cough and a temperature",
    knows: ['You have had a cough and a fever for three days.', 'You put on a mask at the door, as the sign asks.', 'You feel achy and shivery.'],
    style: 'Tired, polite; coughs between sentences.',
    lines: {
      greet: ['*coughs* Sorry. Hi.'],
      why: ["Cough and a temperature for three days. I've got a mask on, don't worry."],
      feel: ['Achy. A bit shivery. *coughs*'],
    },
  },
  amb_migraine: {
    name: 'Nadia',
    sex: 'f',
    kind: 'public',
    who: 'Nadia Kovac, 34, waiting to be seen with a migraine',
    knows: ['You get migraines; this one is like your usual ones, only worse.', 'Bright light hurts your eyes, so you keep them closed.'],
    style: 'Speaks softly and briefly; light and noise hurt.',
    lines: {
      greet: ['*squints* Hi.'],
      why: ['Migraine. My usual kind, but worse.'],
      feel: ['The lights in here are killing me.', 'Bad. Can we talk quietly?'],
      fallback: ['Sorry… can we keep it quiet?'],
    },
  },
  amb_thumb: {
    name: 'Sam',
    sex: 'm',
    kind: 'public',
    waitedMin: 25,
    who: 'Sam Carter, 29, waiting to be seen with a cut thumb',
    knows: ['You cut your thumb opening a tin.', 'Triage put a dressing on it.'],
    style: 'Self-deprecating, chatty.',
    lines: {
      greet: ['Hi. Sam.'],
      why: ['Sliced my thumb opening a tin. Very heroic, I know.'],
      feel: ["It's fine as long as I don't bump it."],
    },
  },
  amb_faint: {
    name: 'Ryan',
    sex: 'm',
    kind: 'public',
    who: 'Ryan Doyle, 24, who has cut his forearm on a broken glass and has a towel wrapped round it',
    knows: ['You cut your forearm on a broken glass; your flatmate Zoe drove you in and wrapped it in a towel.', 'Seeing blood makes you feel queasy.', 'If the [Situation] says you fainted: you felt hot and sick just before, with no chest pain and no racing heart, and you do not think you hit your head.'],
    style: 'Young, a bit pale and embarrassed.',
    lines: {
      greet: ['Hi.'],
      why: ['Cut my arm on a broken glass. Zoe wrapped it in a towel.'],
      feel: ["Bit queasy, to be honest. I don't do blood."],
      urgent: ['I just felt hot and sick, then… I was on the floor. Sorry.', 'Bit embarrassing, honestly. I feel washed out.'],
    },
  },
  amb_faint_friend: {
    name: 'Zoe',
    sex: 'f',
    kind: 'public',
    who: 'Zoe, the flatmate of Ryan (24), who drove him in after he cut his arm on a broken glass',
    knows: ['Your flatmate Ryan cut his forearm on a broken glass; you wrapped it in a towel and drove him in.', 'If the [Situation] says he fainted: he looked at his arm, went white and sort of sank down; as far as you saw, he did not hit his head.'],
    style: 'Talks fast when nervous; protective of her friend.',
    lines: {
      greet: ["Hi. I'm Zoe, I came with Ryan."],
      why: ['My flatmate cut his arm on a broken glass. I drove him in.'],
      feel: ["I'm okay. Just worried about him."],
      urgent: ['He just went down! He looked at his arm and went white.', "He sort of sank down. I don't think he hit his head."],
    },
  },
  amb_vomit: {
    name: 'Sofia',
    sex: 'f',
    kind: 'public',
    who: 'Sofia Marin, 41, waiting to be seen with vomiting and diarrhoea',
    knows: ['You have been vomiting and had diarrhoea since dinner.', 'You can keep sips of water down now.'],
    style: 'Tired, apologetic, low voice.',
    lines: {
      greet: ['Hi.'],
      why: ["I've been sick since dinner. Both ends, sorry. I can keep water down now, at least."],
      feel: ['Washed out. A bit better than earlier.'],
    },
  },
  amb_back: {
    name: 'Peter',
    sex: 'm',
    kind: 'public',
    who: 'Peter Lang, 61, waiting to be seen with low back pain',
    knows: ['You hurt your lower back gardening, lifting a heavy sack.', 'You walk stiffly; the pain stays in your back, with nothing going down your legs.'],
    style: 'Stoic, dry, a little old-fashioned.',
    lines: {
      greet: ['Hello there.'],
      why: ['Did my back in gardening. Lifting a heavy sack.'],
      feel: ["Sitting's alright. Getting up is the worst."],
    },
  },
  amb_rash: {
    name: 'Amy',
    sex: 'f',
    kind: 'public',
    who: 'Amy Chen, 26, waiting to be seen with an itchy rash',
    knows: ['You came out in itchy hives after trying a new shellfish dish.', 'Your breathing is fine.', 'You took an antihistamine before you came.'],
    style: 'Chatty, a bit embarrassed, scratching.',
    lines: {
      greet: ['Hi.'],
      why: ['I came out in itchy hives after a new shellfish dish. Breathing is fine. I took an antihistamine.'],
      feel: ['Itchy! But okay.'],
    },
  },
  amb_eye: {
    name: 'Raj',
    sex: 'm',
    kind: 'public',
    who: 'Raj Patel, 45, waiting to be seen with something in his eye',
    knows: ['A fleck of metal flew into your eye while you were using a grinder.', 'Your eye waters and feels gritty; you can see fine.'],
    style: 'Practical, a bit cross with himself.',
    lines: {
      greet: ['Hello.'],
      why: ['Bit of metal in my eye from the grinder. Should have worn the goggles.'],
      feel: ['Feels like grit in it, and it keeps watering. I can see fine.'],
    },
  },
  amb_burn: {
    name: 'Lucy',
    sex: 'f',
    kind: 'public',
    who: 'Lucy Ward, 24, waiting to be seen with a scald on the back of her hand',
    knows: ['You splashed boiling water on the back of your hand.', 'There is a small blister and it stings.'],
    style: 'Friendly, a little wincing.',
    lines: {
      greet: ['Hi.'],
      why: ['Splashed boiling water on the back of my hand. Got a little blister.'],
      feel: ['Stings. Not too bad.'],
    },
  },
  // ───────────── the stand-in triage nurse (content/ambient.ts FLOAT_RN) ─────────────
  amb_float_rn: {
    name: 'Jo',
    sex: 'f',
    kind: 'staff',
    who: "Jo Bauer, an emergency nurse floating this shift, covering the triage nurse's calls in the waiting room",
    knows: ['You call the next patients from the waiting list when Lena, the triage nurse, is tied up.', 'You do not know the patients being treated in the department; you only have the waiting list.'],
    style: 'Brisk, friendly, always on the move.',
    lines: {
      greet: ["Hi! Can't stop long."],
      job: ["I'm floating this shift, covering triage calls while Lena's tied up."],
      busy: ['Busy. The waiting room has {crowd} in it.'],
      order: ["I'm only covering triage calls. Ask the patient's nurse, or Rosa, the charge nurse."],
      patients: ["I've only got the waiting list, sorry. Ask at the station."],
      urgent: ["Not now, Doc. We've got someone down."],
    },
  },
  // ───────────── staff who aren't part of the gameplay (content/scenarios.ts, talkable: false) ─────────────
  clerk_paul: {
    name: 'Paul',
    sex: 'm',
    kind: 'staff',
    who: 'Paul Lindgren, the registration clerk at the desk in the emergency department waiting room',
    knows: ['You register everyone who walks in: photo ID, insurance card and the reason for the visit; then the triage nurse sees them.', 'Patients are seen in order of urgency, not arrival. You explain that a lot.', 'Non-urgent waits are about two hours this shift.', 'You never discuss patients at the desk; the clinical side is triage and the doctors.', 'The printer jams.'],
    style: 'Polite, patient, quietly dry humour; British.',
    lines: {
      greet: ['Hello, Doctor.'],
      job: ['I register everyone who comes in: ID, insurance, what brings them in. Then triage takes over.'],
      busy: ['{crowd} waiting right now. Non-urgent waits are about two hours.'],
      wait: ['Since the start of the shift. The printer and I are not friends.'],
      feel: ["Can't complain. Well, I could."],
      order: ["I'm registration, Doctor. That's one for the nurses. Rosa's at the station."],
      patients: ['I only see them at the desk, Doctor. Triage and your team have the details.'],
      urgent: ["I've called the rapid response, Doctor. The triage nurse is on her way."],
    },
  },
  sec_dave: {
    name: 'Dave',
    sex: 'm',
    kind: 'staff',
    who: 'Dave Morrison, the security officer for the emergency department waiting room and walk-in entrance',
    knows: ['You keep the waiting room calm and safe, watch the walk-in door, and get a nurse fast if someone becomes unwell.', 'Masks are in the box by the door for anyone coughing.', 'No filming in the waiting room.', 'Pets have to stay in their carriers.'],
    style: 'Calm, big, friendly, few words.',
    lines: {
      greet: ['Doc.', 'Hey, Doc.'],
      job: ['Keep things calm out here, watch the door, and get a nurse fast if someone goes down.'],
      busy: ['Full house. {crowd} waiting. Mostly patient folks.'],
      feel: ['All good, Doc.'],
      order: ['Not my department, Doc. I can grab a nurse for you.'],
      patients: ["Couldn't tell you, Doc. I just watch the door."],
      urgent: ["He fainted, Doc. Nurse is on her way. Can you give us some room?"],
    },
  },
  hk_ines: {
    name: 'Inés',
    sex: 'f',
    kind: 'staff',
    who: 'Inés Ramos, from environmental services: she cleans the emergency department',
    knows: ['You turn rooms over between patients (beds, surfaces, floors) and put out wet-floor signs when you mop.', 'Clinical waste goes in the yellow bags and sharps in the sharps bins, never in the ordinary trash.', 'Staff call housekeeping when a room needs cleaning.'],
    style: 'Cheerful, practical, teases the doctors about the wet floor.',
    lines: {
      greet: ['Hola, Doctor.'],
      job: ['I clean the rooms between patients, the floors, everything. Mind the wet floor!'],
      feel: ['Good! Busy, but good.'],
      order: ['Ay, I just clean, Doctor! Ask the nurses.'],
      patients: ["I don't know the patients, Doctor. I just clean the rooms."],
    },
  },
  vis_1: {
    name: 'Jess',
    sex: 'f',
    kind: 'public',
    waitedMin: 150,
    who: 'Jess, 22, waiting to be seen with an earache',
    knows: ['You have had a painful right earache since yesterday.', 'Your phone battery is nearly dead and you would love a charger.', 'You have been waiting a long time and are getting impatient.'],
    style: 'Young, impatient, sarcastic, but not rude.',
    lines: {
      greet: ['Hi.'],
      why: ['Earache. My right ear, since yesterday. It really hurts.'],
      wait: ['{wait} Seriously.'],
      feel: ['My ear hurts and my phone is about to die. Great.'],
      fallback: ["Don't suppose you've got a phone charger?"],
    },
  },
  vis_2: {
    name: 'Walter',
    sex: 'm',
    kind: 'public',
    waitedMin: 100,
    who: 'Walter, 76, waiting to be seen with a chesty cough',
    knows: ['You have had a chesty cough for a week; you wear a mask because of it.', 'You have diabetes and take tablets for it.', "You haven't eaten since lunch and worry your sugar might drop, so you would like some juice."],
    style: 'Elderly, slow, polite; coughs.',
    lines: {
      greet: ['*coughs* Hello.'],
      why: ['This cough. A week now. *coughs*'],
      feel: ["Hungry. I'm diabetic, and I haven't eaten since lunch. Is there juice anywhere?"],
    },
  },
  vis_3: {
    name: 'Owen',
    sex: 'm',
    kind: 'public',
    waitedMin: 120,
    who: 'Owen, 44, waiting to be seen with a sore shoulder',
    knows: ['You hurt your right shoulder falling off a stepladder at home; you can move it, but it hurts.', 'Triage called your name once, and then nothing happened.', 'The vending machine ate your coins.'],
    style: 'Dry, a bit put-upon; British.',
    lines: {
      greet: ['Hello.'],
      why: ['Fell off a stepladder and landed on my shoulder. I can move it, just about.'],
      wait: ['{wait} They called my name once and then nothing happened.'],
      feel: ['Sore. And the vending machine ate my coins.'],
    },
  },
  // ── east wing: cafeteria (24/7) ──
  caf_luis: {
    name: 'Luis',
    sex: 'm',
    kind: 'staff',
    who: 'Luis Ortega, the cashier on the till in the hospital cafeteria',
    knows: ['The cafeteria is open 24 hours: soup, sandwiches and snacks, and self-serve coffee by the drinks fridge.', "The soup is lentil, and fresh. You're out of oat milk.", 'Staff get 20% off hot food with their badge; card or contactless.', 'The self-serve coffee is $2.25 a cup, paid at the till; you chase after anyone who walks off without paying, nicely.'],
    style: 'Friendly, upbeat, chatty; knows everyone\'s usual order.',
    lines: {
      greet: ['Hey, Doc! What can I get you?'],
      job: ['I run the till. Soup, sandwiches, the good cookies. Coffee is self-serve, right over there.'],
      busy: ['Quiet now. Gets busy around shift change.'],
      feel: ['Good, good. Lots of coffee being drunk.'],
      order: ['Ha! I can do you a soup, Doc, not a blood test.'],
      patients: ['I only know what they order, Doc.'],
      fallback: ["Lentil soup's fresh. Staff discount with your badge."],
    },
  },
  caf_rn_mei: {
    name: 'Mei',
    sex: 'f',
    kind: 'staff',
    who: 'Mei Tanaka, a ward nurse from one of the inpatient wards upstairs, on her break in the cafeteria',
    knows: ['You work on an inpatient ward upstairs, not in the emergency department; you know nothing about the patients down here.', 'You are on a twelve-hour shift, on your fourth coffee, and your break is short.'],
    style: 'Tired, kind, dry humour.',
    lines: {
      greet: ['Hi. Ten-minute break, so talk fast.'],
      why: ['My break. Ten minutes of peace and a coffee.'],
      wait: ['Seven hours in, five to go.'],
      job: ["I'm a ward nurse upstairs. This is my ten minutes of peace."],
      feel: ['Twelve-hour shift. Fourth coffee. Ask me later.'],
      order: ["I'm on my break, and I'm not ED staff. Ask the ED nurses. Rosa's in charge down there."],
      patients: ["No idea, I'm from upstairs. Ask the ED nurses."],
    },
  },
  caf_visitor: {
    name: 'Claire',
    sex: 'f',
    kind: 'public',
    who: 'Claire, a visitor having a coffee in the cafeteria while her mum waits for a bed on a ward upstairs',
    knows: ["Your mum came in yesterday and is in the admissions unit upstairs, waiting for a ward bed; she isn't in the emergency department.", "You don't know the medical details; the ward team is looking after her.", 'The cafeteria coffee is very strong.'],
    style: 'Friendly, tired, British.',
    lines: {
      greet: ['Oh, hello.'],
      why: ["My mum's waiting for a bed on a ward upstairs. I'm hiding in here with a coffee."],
      wait: ['A few hours now. They keep saying a bed soon.'],
      feel: ['Tired. This coffee is helping. Sort of.'],
      doing: ['Drinking the strongest coffee in the building.'],
    },
  },
  // ── east wing: outpatient clinic (08–17) ──
  cl_carmen: {
    name: 'Carmen',
    sex: 'f',
    kind: 'staff',
    who: 'Carmen Silva, the receptionist at the outpatient clinic across the hospital street',
    knows: ['The outpatient clinic is open 8 to 5, by appointment; emergencies go to the emergency department.', 'You check patients in, scan insurance cards and hand out forms.', 'The clinic doctor is running about fifteen minutes behind.'],
    style: 'Bright, organised, friendly.',
    lines: {
      greet: ['Hi! Do you have an appointment? Oh, you work here.'],
      job: ['I check everyone in for the outpatient clinic: appointments, forms, insurance.'],
      busy: ["The doctor's running about fifteen minutes behind, as usual."],
      order: ['This is the outpatient clinic, Doctor. The emergency department is back across the hospital street.'],
      patients: ['I only have the clinic list, sorry.'],
    },
  },
  cl_rn_hannah: {
    name: 'Hannah',
    sex: 'f',
    kind: 'staff',
    who: "Hannah Weiss, the outpatient clinic's nurse",
    knows: ['You do vitals, weights, dressings and vaccines for clinic patients and keep the exam rooms ready.', 'The clinic is open 8 to 5; it is separate from the emergency department.'],
    style: 'Calm, cheerful, organised.',
    lines: {
      greet: ['Hi there.'],
      job: ['Clinic nurse: vitals, weights, dressings, vaccines, and keeping the exam rooms stocked.'],
      order: ["I'm in the clinic, not the ED. Ask the ED nurses, or put it in AgentChart."],
      patients: ['I only know the clinic patients, sorry.'],
    },
  },
};

/**
 * Voices for crowd members who never speak aloud in the waiting room's small talk (so content/ambient.ts
 * casts none) but can now be talked to. One-on-one only, so a far-away character may share one.
 */
export const CHAT_VOICES: Record<string, TtsVoice> = {
  amb_walker: { id: 'am_puck', speed: 0.88 },
  amb_earbuds: { id: 'af_kore', speed: 1.04 },
  amb_sleeper: { id: 'am_eric', speed: 0.94 },
  amb_cough: { id: 'am_liam', speed: 0.97 },
  amb_migraine: { id: 'af_alloy', speed: 0.92 },
  amb_thumb: { id: 'am_puck', speed: 1.06 },
  amb_vomit: { id: 'af_aoede', speed: 0.96 },
  amb_back: { id: 'am_fenrir', speed: 0.92 },
  amb_rash: { id: 'af_river', speed: 1.04 },
  amb_eye: { id: 'am_echo', speed: 0.95 },
  amb_burn: { id: 'af_kore', speed: 1.08 },
};

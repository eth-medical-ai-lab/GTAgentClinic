/**
 * The browser demo's scripted conversations. There is no language model in a static page, so the
 * people of the tour are written to feel alive by design:
 *   - each knows a set of topics, reached by whole words, word stems and phrases (synonyms included),
 *     so the questions clinicians actually type land: allergies, medications, the history of the pain…
 *   - they remember what they have told you: asked again, they answer in short ("Like I said…"),
 *     and "go on" or "anything else?" moves on to something they have not said yet;
 *   - greetings, introductions, thanks, kind words and goodbyes get answers of their own;
 *   - when a question does not land, they answer as that person would (a deflection in character)
 *     and offer something they have not said yet, instead of "I don't understand";
 *   - a few facts are never offered and come out only when asked for (Mr. Keller's afternoon pill).
 * The people and their facts are the full game's (content/cases, content/scenarios.ts), cut to a tour
 * that starts at 22:20 (transport.ts). Marcus, Mr. Keller and Tom speak recorded sentences
 * (DEMO_VOICES, scripts/demo-voices.ts); everyone else speaks with the browser's voices.
 */
import type { ChatLine, NpcView } from '../../../shared/types';
import { hash32 } from '../ui/voicePick';

interface Topic {
  /** the suggested question (a chip); a topic without one is reached only by asking */
  ask?: string;
  /**
   * What points here: a word ("arm"), a word stem ("radiat*") or a phrase ("go anywhere"), lower case,
   * without apostrophes ("whats", "dont"). A phrase counts double; a cue marked "!" ("!viagra") decides.
   */
  cues: string[];
  say: string;
  /** said instead when asked again */
  again?: string;
  /** never offered (in chips or when steering): it has to be asked for */
  hidden?: boolean;
}

interface Script {
  hello: string;
  /** a greeting once you have spoken before */
  back?: string;
  meet?: string;
  thanks: string;
  bye: string;
  /** an answer to kind words or reassurance */
  kind?: string;
  /** deflections in character when a question does not land, in turn; what they have not said yet follows */
  steer: string[];
  /** when there is nothing left they have not said */
  done: string;
  topics: Topic[];
}

const scripts: Record<string, Script> = {
  tech_marcus: {
    hello: "Hey, I'm Marcus, the ED tech. First time on nights? I can show you where everything is.",
    back: "Back again, Doc? What do you need?",
    meet: "Marcus. Nice to meet you, Doc. Welcome to nights.",
    thanks: 'Anytime, Doc.',
    bye: 'Holler if you need me.',
    kind: 'Ha, thanks. The coffee helps.',
    steer: ['Ha, you lost me there, Doc.', "That's above my pay grade.", "Good question. I'm just the tech, though."],
    done: "That's the grand tour. Go see Mr. Keller, Doc.",
    topics: [
      { ask: 'Where should I start?', cues: ['start', 'begin', 'first', 'tour', 'show me', 'around', 'where should', 'what should i', 'where do i'],
        say: "See the counter behind me? That's the nurses' station, and Rosa runs it. But honestly, go see Bed 2 first.",
        again: 'Bed 2 first, Doc. Then Rosa at the station.' },
      { ask: 'Anything urgent?', cues: ['urgent', 'sick*', 'worried', 'bed 2', 'keller', 'ecg', 'ekg', 'twelve lead', '12 lead', 'chest pain', 'page*', 'paged', 'anything i should know'],
        say: "I just ran a twelve-lead on Mr. Keller in Bed 2 and paged you. You'll want to see it, Doc. It's in his chart.",
        again: "Bed 2's ECG, Doc. It's waiting for you." },
      { ask: 'What do you do here?', cues: ['job', 'role', 'do here', 'what do you do', 'work', 'tech', 'duties'],
        say: 'ECGs, blood draws, splints, transport. Nursing school by day. Sleep is optional.' },
      { ask: 'Who can I talk to?', cues: ['who', 'talk to', 'team', 'staff', 'people', 'everyone', 'nurse*', 'attending'],
        say: "Rosa's the charge nurse at the station. Tom's with Mr. Keller, and Aisha has Bed 4 and Fast Track. Dr. Shaw is the attending, in the workroom." },
      { cues: ['where', 'find', 'supplies', 'med room', 'medroom', 'medication room', 'bathroom', 'toilet', 'coffee', 'break room', 'machine'],
        say: "Med room's down the corridor, Aisha's in there. Supplies are behind the station. The coffee's terrible, but it's hot." },
      { cues: ['blood*', 'labs', 'draw*', 'troponin', 'sample*'],
        say: "I drew Mr. Keller's bloods at triage. They're in the lab now." },
      { cues: ['aspirin', 'medic*', 'nitro*', 'give', 'drug*', 'morphine'],
        say: "I don't give meds, Doc. That's Tom or Aisha." },
      { cues: ['school', 'nursing', 'study*', 'student', 'class*'],
        say: 'Second year of nursing school. The night shifts pay the tuition.' },
      { cues: ['how long', 'worked here', 'years', 'experience'],
        say: 'Three years here. Long enough to know where the good stretchers hide.' },
      { cues: ['night', 'shift', 'quiet', 'busy', 'tonight'],
        say: "Busy for a Tuesday. Just don't say the Q word." },
      { cues: ['how do i', 'how to', 'controls', 'help', 'tablet', 'examin*'],
        say: 'Walk up to anyone to talk. Your tablet has every chart, and patients have an Examine tab.' },
    ],
  },

  rn_rosa: {
    hello: 'Rosa, charge nurse. Pull up a chair if you can find one. What do you need?',
    back: 'Doc. What else?',
    meet: "Rosa Delgado. Welcome to nights, Doc. You'll do fine. Probably.",
    thanks: "You're welcome, Doc.",
    bye: "Go on. Your patients aren't getting any younger.",
    kind: "Don't get sentimental on me, Doc. Not at this hour.",
    steer: ['Doc, I run a department. Ask me something useful.', 'No idea. And I know everything around here.', 'Ha. Nice try.'],
    done: "That's the whole board. Go see Bed 2.",
    topics: [
      { ask: 'Can I get a handoff?', cues: ['handoff', 'hand off', 'handover', 'hand over', 'patients', 'census', 'who do we have', 'what do we have', 'whats going on', 'update', 'latest', 'busy'],
        say: "Bed 2, Robert Keller, 64, chest pain. His ECG is waiting for you. Bed 4, Mrs. Brunner, 81, confused and septic-looking, and Dr. Shaw started her workup. Fast Track, a young guy with an ankle.",
        again: 'Keller in 2, Brunner in 4, an ankle in Fast Track. Start with 2.' },
      { ask: 'Who should I see first?', cues: ['first', 'sickest', 'priorit*', 'worried', 'urgent', 'see first', 'start with'],
        say: "Bed 2. His ECG has been sitting there since 22:17. Go." },
      { ask: 'Where is the tracking board?', cues: ['board', 'chart*', 'computer', 'record*', 'ehr', 'screen', 'workstation'],
        say: 'Right over the island. The rows are beds. Charts are on the workstation, or take them with you on your tablet.' },
      { cues: ['attending', 'shaw', 'supervis*', 'boss', 'in charge'],
        say: "Dr. Shaw's in the workroom. She'll answer your question with a question. Go anyway." },
      { cues: ['night', 'shift', 'quiet', 'tonight'],
        say: "Listen for the printer. When it stops long enough to hear the coffee machine, we've caught up." },
      { cues: ['how long', 'years', 'experience', 'worked here'],
        say: "Twenty years in this department. I've trained more residents than I can count. You're doing fine so far." },
      { cues: ['nurses', 'staff*', 'short staffed', 'aisha', 'tom'],
        say: "Tom has Beds 1 to 3, Aisha has 4 to 6 and Fast Track. We're one nurse short, so be nice to them." },
      { cues: ['coffee', 'break', 'eat', 'food', 'snack*'],
        say: "Coffee's in the break room. Don't touch the cookies with Marcus's name on them." },
    ],
  },

  pt_p_keller: {
    hello: "Evening, Doc. Robert Keller. Sorry I'm not much company tonight.",
    back: "You're back, Doc. Still here. Still squeezing.",
    meet: 'Robert Keller. Nice to meet you, Doc. Wish it was somewhere else.',
    thanks: "Don't thank me, Doc. I'm just lying here.",
    bye: "Don't go far, Doc.",
    kind: "Appreciate that, Doc. Linda won't let me hear the end of this.",
    steer: [
      "I don't know, Doc. All I know is this pressure won't quit.",
      "Doc, my head's not great right now.",
      'I drove trucks for thirty-one years, Doc. Use small words.',
    ],
    done: "That's about all I've got, Doc. Is it my heart?",
    topics: [
      { ask: 'What brought you in tonight?', cues: ['brought', 'bring*', 'what happened', 'whats going on', 'going on', 'whats wrong', 'wrong', 'problem', 'trouble', 'what brings', 'why are you here', 'how can i help', 'what can i do for you'],
        say: "Doc, it's like an elephant's sitting on my chest. Probably just heartburn, but Linda made me come in.",
        again: 'Like I said, Doc. An elephant on my chest.' },
      { ask: 'When did it start?', cues: ['when', 'start*', 'began', 'begin*', 'onset', 'how long', 'what time', 'what were you doing', 'doing', 'sudden*', 'come on', 'came on'],
        say: "Around quarter to ten, sitting on the couch watching the game. I wasn't doing anything.",
        again: 'Quarter to ten, Doc. On the couch.' },
      { ask: 'What does it feel like?', cues: ['describe', 'what does it feel', 'how does it feel', 'how does the pain feel', 'pain feel', 'feel like', 'what is it like', 'whats it like', 'what kind', 'type of pain', 'character', 'pressure', 'sharp', 'dull', 'squeez*', 'heavy', 'crushing', 'stabbing', 'burning', 'scale', 'out of 10', 'out of ten', 'severity', 'severe', 'how bad', 'how strong'],
        say: "It's a pressure, a heavy squeezing, like an elephant sitting on me. About an eight out of ten, and it hasn't let up.",
        again: 'Still an eight, Doc. Still squeezing.' },
      { ask: 'Where is the pain?', cues: ['where does it hurt', 'where is the pain', 'wheres the pain', 'where is it', 'show me where', 'location', 'point to', 'radiat*', 'spread*', 'go anywhere', 'goes anywhere', 'move anywhere', 'anywhere else', 'arm', 'arms', 'jaw', 'neck', 'shoulder', 'travel*'],
        say: 'Right in the middle of my chest. It goes down my left arm and up into my jaw.',
        again: 'Middle of my chest, Doc. Down the left arm, up the jaw.' },
      { ask: 'Any other symptoms?', cues: ['other symptoms', 'any symptoms', 'sweat*', 'nause*', 'vomit*', 'throw up', 'threw up', 'sick', 'clammy', 'stomach'],
        say: "I'm sweating buckets and sick to my stomach. Threw up once in the car.",
        again: 'The sweats and the stomach, Doc. Threw up once on the way.' },
      { ask: 'Are you short of breath?', cues: ['breath*', 'short of breath', 'sob', 'winded', 'out of breath', 'exert*', 'exercise', 'walking', 'stairs', 'dog', 'weeks'],
        say: "Bit short of breath right now. Truth is, I've been getting winded walking the dog the last few weeks.",
        again: 'Winded walking the dog, Doc. For weeks now.' },
      { ask: 'Any heart problems before?', cues: ['heart problem*', 'heart trouble', 'any heart', 'heart test', 'stress test', 'treadmill', 'cardiac history', 'cardiologist', 'catheter', 'angiogram', 'ever had', 'been told', 'before', 'previous*', 'prior'],
        say: 'Couple years back they did a treadmill heart test. Said it was abnormal and wanted to do a catheter thing. I said no thanks.',
        again: 'The treadmill test, Doc. Abnormal. I said no to the catheter.' },
      { ask: 'What medicines do you take?', cues: ['medic*', 'meds', 'pill', 'pills', 'tablet*', 'prescri*', 'statin', 'atorvastatin', 'metformin', 'lisinopril', 'do you take', 'are you taking', 'you take', 'on any'],
        say: 'Metformin for the sugar and lisinopril for the pressure. I was on a cholesterol pill, but I quit it a few months ago. Made my legs ache.',
        again: 'Metformin and lisinopril, Doc. I quit the cholesterol one.' },
      { ask: 'Any medical problems?', cues: ['medical problem*', 'medical history', 'health problem*', 'problems', 'conditions', 'illness*', 'diabet*', 'sugar', 'blood pressure', 'hypertension', 'cholesterol', 'past history', 'pmh'],
        say: "High blood pressure, sugar diabetes, cholesterol. That's about it.",
        again: 'Pressure, sugar, cholesterol, Doc.' },
      { ask: 'Any allergies?', cues: ['allerg*', 'reaction*', 'react to'],
        say: 'No allergies, Doc. Not that I know of.', again: 'No allergies, Doc.' },
      { ask: 'Do you smoke?', cues: ['smok*', 'cigarette*', 'tobacco', 'vape', 'vaping', 'packs'],
        say: 'I smoke. About a pack a day since I was eighteen.', again: 'Pack a day, Doc. Since I was eighteen.' },
      { ask: 'Any heart disease in your family?', cues: ['family', 'father', 'dad', 'mother', 'mom', 'brother*', 'sister*', 'parents', 'genetic', 'runs in', 'hereditary'],
        say: 'My dad dropped dead of a heart attack at fifty-eight.', again: 'My dad, Doc. Heart attack at fifty-eight.' },
      { ask: 'How are you feeling now?', cues: ['how are you', 'how you doing', 'how do you feel', 'feeling now', 'right now', 'still there', 'still hurt*', 'still have', 'pain now', 'any better', 'any worse', 'getting worse', 'getting better', 'how is the pain', 'hows the pain'],
        say: "Like a truck's parked on my chest, and I used to drive one. It's still there.",
        again: "Still there, Doc. Hasn't let up." },
      { cues: ['!viagra', '!sildenafil', '!cialis', '!tadalafil', '!levitra', '!erectile', 'erection*', 'blue pill', 'sexual', 'other pill*', 'other medic*', 'any other', 'anything else you take', 'every now and then', 'now and then', 'occasional*', 'as needed', 'over the counter', 'supplement*', 'herbal'],
        hidden: true,
        say: "...Okay. Keep your voice down, Doc. I took one of those blue pills this afternoon, around four. Sildenafil. Linda doesn't need to know.",
        again: 'Around four this afternoon, Doc. One pill. Keep it quiet.' },
      { cues: ['heart attack', 'youre having', 'you are having', 'blocked', 'blockage', 'stent', 'cath lab', 'you need', 'we need to', 'emergency procedure', 'stemi', 'clot'],
        say: "A heart attack? Is this the catheter thing they wanted to do before? ...Okay. Do what you've got to do, Doc.",
        again: "Okay, Doc. I'm trusting you on this one." },
      { cues: ['deep breath', 'breathe in', 'breathing in', 'position*', 'lie down', 'lying down', 'sit up', 'lean forward', 'press*', 'press here', 'when i press', 'if i press', 'hurt when', 'tender*', 'pleuritic', 'worse when', 'worse with', 'better when', 'better with'],
        say: "It doesn't change when I breathe or move. Doesn't hurt when I press on my chest." },
      { cues: ['took anything', 'take anything', 'taken anything', 'tried anything', 'anything for it', 'for the pain', 'anything help', 'make it better', 'reliev*', 'antacid*', 'tums', 'painkiller*'],
        say: "Took nothing for it. Figured it'd pass." },
      { cues: ['tear*', 'ripping', 'back pain', 'your back', 'to the back', 'through to', 'between the shoulder*', 'shoulder blade*'],
        say: "Tearing? No, it's more of a squeezing. Not going through to my back." },
      { cues: ['cough*', 'fever*', 'chills', 'leg swelling', 'swollen leg*', 'calf', 'calves', 'travel', 'flight', 'plane', 'palpitat*', 'racing', 'skipping', 'dizz*', 'lighthead*', 'faint*', 'pass out', 'passed out'],
        say: "No cough, no fever, no racing heart, never passed out. Legs are fine. Haven't been anywhere but my couch." },
      { cues: ['bleed*', 'ulcer*', 'stroke*', 'surger*', 'operation*', 'blood thinner*', 'anticoag*', 'warfarin'],
        say: "No bleeding problems, no ulcers, never had a stroke. Had my knee scoped years ago, that's the only surgery." },
      { cues: ['alcohol', 'beer*', 'wine', 'liquor', 'booze', 'whiskey', 'do you drink', 'how much do you drink'],
        say: 'A few beers on the weekend. That\'s it.' },
      { cues: ['recreational', 'cocaine', 'coke', 'marijuana', 'weed', 'cannabis', 'meth', 'heroin', 'illicit', 'street drug*', 'any drug*', 'drug use', 'use drug*', 'use any drug*'],
        say: 'No drugs. Never.' },
      { cues: ['last meal', 'last eat', 'last ate', 'eaten', 'anything to eat', 'eat anything', 'food', 'empty stomach', 'npo'],
        say: "Couple slices of pizza at halftime. Haven't kept anything down since." },
      { cues: ['work', 'job', 'for a living', 'retire*', 'occupation', 'truck*', 'what do you do'],
        say: 'Drove trucks for thirty-one years. Retired now. Linda says I drive her crazy instead.' },
      { cues: ['worr*', 'scared', 'afraid', 'nervous', 'concern*', 'grandson', 'grandkid*', 'ball game', 'baseball', 'saturday'],
        say: "My grandson's got a ball game Saturday. I promised I'd be there. I'm going to make it, right, Doc?" },
      { cues: ['examin*', 'listen to your', 'take a look', 'have a look', 'check your', 'stethoscope', 'can i take', 'can i check', 'can i listen', 'may i', 'take your blood pressure', 'take your pulse'],
        say: 'Go ahead, Doc. Cold hands, I bet.' },
      { cues: ['your name', 'full name', 'date of birth', 'birthday', 'dob', 'when were you born', 'confirm your'],
        say: 'Robert Keller. August ninth, nineteen sixty-two.' },
      { cues: ['result*', 'troponin', 'blood test*', 'labs', 'what did the', 'cholesterol number*', 'cholesterol level*'],
        say: 'You tell me, Doc. Nobody tells me anything in here.' },
    ],
  },

  fam_linda: {
    hello: "I'm Linda, Robert's wife. He won't make a fuss, so I suppose that's my job.",
    back: 'Any news, Doctor?',
    meet: "Linda Keller. Thank goodness. Nobody's told us anything yet.",
    thanks: 'No, thank you. Really.',
    bye: "Please come back and tell us what's happening.",
    kind: "Thank you. I just want someone to tell me he's going to be all right.",
    steer: ["I don't know, he never tells me anything!", "Oh, I'm not sure. Sorry, I'm a bit of a mess.", "You'd have to ask Robert. Good luck getting a straight answer."],
    done: "That's everything I can think of. Is he going to be all right?",
    topics: [
      { ask: 'What did you notice?', cues: ['notice*', 'what did you see', 'what happened', 'happen*', 'look like', 'when did', 'start*', 'what time'],
        say: 'He turned the television off in the middle of the game. White as a sheet, shirt wet through, rubbing his jaw. That was about quarter to ten.',
        again: 'White as a sheet and sweating, about quarter to ten.' },
      { ask: 'Has he had heart trouble before?', cues: ['heart trouble', 'heart problem*', 'heart test', 'stress test', 'cardiolog*', 'angiogram', 'catheter', 'before', 'history', 'ever had'],
        say: 'Two years ago Dr. Cole sent him for a stress test. It was abnormal, and the cardiologist wanted to do an angiogram. He flat-out refused.',
        again: 'The stress test was abnormal. He refused the angiogram, the stubborn man.' },
      { ask: 'What does he take?', cues: ['medic*', 'meds', 'pill*', 'tablet*', 'prescri*', 'statin', 'cholesterol', 'does he take', 'is he on'],
        say: 'Metformin, his blood pressure pill, and he was on one for cholesterol. He stopped that months ago, said it made his legs ache. I told him to call Dr. Cole.',
        again: 'He stopped the cholesterol pill months ago.' },
      { ask: 'How did you get here?', cues: ['drive', 'drove', 'car', 'get here', 'got here', 'arriv*', 'ambulance'],
        say: 'I drove. He wanted to change his shirt first. I brought the spare one with me instead.' },
      { ask: 'How are you holding up?', cues: ['holding up', 'how are you', 'you okay', 'are you ok', 'you alright', 'how do you feel'],
        say: "Better now that somebody's looking at him. Is it his heart? You can tell me." },
      { cues: ['breath*', 'winded', 'walking', 'dog', 'weeks', 'tired', 'exercise', 'stairs'],
        say: "He's been huffing and puffing walking the dog for weeks. He kept saying it was the weather." },
      { cues: ['family', 'father', 'dad', 'parents', 'runs in'],
        say: "His father died of a heart attack in his fifties. I've been worried about this for years." },
      { cues: ['smok*', 'cigarette*', 'tobacco'],
        say: "A pack a day since before I met him. I've been after him to quit for thirty years." },
      { cues: ['allerg*'], say: 'No allergies. Not to anything.' },
      { cues: ['grandson', 'grandkid*', 'grandchild*', 'baseball', 'ball game', 'saturday'],
        say: "Our grandson has a ball game on Saturday. It's all Robert's been talking about." },
      { cues: ['!viagra', '!sildenafil', '!cialis', '!tadalafil', '!erectile', 'blue pill', 'sexual'], hidden: true,
        say: "Viagra? Robert? I... no, I don't think so. Why, does that matter?" },
      { cues: ['heart attack', 'hes having', 'he is having', 'blocked', 'blockage', 'stent', 'cath lab', 'he needs', 'emergency'],
        say: "A heart attack. Oh, Robert. I knew it. Whatever he needs, do it. And don't let him talk you out of it." },
    ],
  },

  rn_tom: {
    hello: "Tom. I'm staying with Mr. Keller.",
    back: 'Doc.',
    meet: 'Tom Becker. I have Beds 1 to 3. Nice to meet you.',
    thanks: 'Yep.',
    bye: "Don't be long, Doc.",
    kind: "Save it for him, Doc. I'm fine.",
    steer: ["Doc, focus. I've got a sick guy here.", 'Not my department, Doc.', 'Ask me about Mr. Keller, Doc.'],
    done: "That's all I've got. Go read his ECG, Doc.",
    topics: [
      { ask: 'How is Robert doing?', cues: ['how is he', 'hows he', 'how is robert', 'hows robert', 'how is mr keller', 'doing', 'status', 'update', 'latest', 'how is the patient', 'is he okay', 'stable'],
        say: "Still describing pressure. Sweaty, gray and nauseated. I don't like how he looks.",
        again: "Same. Pressure, sweats. I still don't like it." },
      { ask: 'What are his vitals?', cues: ['vital*', 'monitor', 'heart rate', 'pulse', 'hr', 'bp', 'blood pressure', 'pressure', 'sats', 'saturation', 'numbers', 'tele'],
        say: 'Heart rate 52, sinus. Pressure 96 over 60, down from 104 at triage. Sats 94 percent on room air.',
        again: '52, 96 over 60, 94 percent. Trending down.' },
      { ask: "What's been done so far?", cues: ['done so far', 'been done', 'what have you done', 'so far', 'line', 'iv', 'labs', 'bloods', 'blood work', 'drawn', 'access'],
        say: "Marcus got a twelve-lead right after triage. He's got an eighteen-gauge in his left arm, bloods are off, and he's on the monitor." },
      { ask: 'What does his ECG show?', cues: ['ecg', 'ekg', 'twelve lead', '12 lead', 'tracing', 'strip', 'st elevation'],
        say: "I'm not reading it for you, Doc. It's in his chart under ECG. Go look. Fast.",
        again: 'His chart, under ECG. Now, Doc.' },
      { ask: 'Has he had aspirin?', cues: ['aspirin', 'asa', 'antiplatelet', '324', 'chew'],
        say: "Not yet. Nobody's ordered it. He's got no allergies, if that's your next question.",
        again: 'No aspirin yet, Doc.' },
      { cues: ['nitro*', 'gtn', 'nitrate*', 'spray', 'under the tongue'],
        say: 'Nitro? With a pressure of 96 and that ECG? Check his right side first, Doc. And ask him about pills.' },
      { cues: ['right sided', 'right side', 'right ventric*', 'v4r', 'rv'],
        say: "Good thinking. That's exactly what I'd want before anybody touches the nitro." },
      { cues: ['oxygen', 'o2', 'nasal cannula', 'non rebreather'],
        say: "He's 94 on room air. I'll put him on oxygen if he drops under 90." },
      { cues: ['cardiolog*', 'cath lab', 'cath', 'call cardio*', 'who do i call', 'consult*', 'lindqvist', 'on call'],
        say: "That's your call, Doc. Cardiology is on the station phone." },
      { cues: ['give', 'start', 'hang', 'order*', 'can you get', 'bolus', 'fluids', 'morphine', 'heparin', 'ticagrelor', 'clopidogrel', 'push'],
        say: "In a full shift you'd write it and I'd give it. On this tour his chart is read-only, Doc." },
      { cues: ['linda', 'wife', 'family'],
        say: "That's Linda. She's been great. She fills in what he leaves out." },
      { cues: ['how long', 'paramedic', 'experience', 'before this', 'worked here'],
        say: "Six years here. Before that, a paramedic. I've seen a few of these." },
    ],
  },

  rn_aisha: {
    hello: "Aisha. I'm covering the far bays and Fast Track. Come in, there's room.",
    back: 'Yes, Doctor?',
    meet: 'Aisha Rahman. Nice to meet you. I have Beds 4 to 6 and Fast Track tonight.',
    thanks: 'Of course.',
    bye: "I'll be in Bed 4 if you need me.",
    kind: "That's kind. It's a busy one.",
    steer: ["Sorry, I'm pulling meds. Can it wait?", "I'm not sure, Doctor.", 'Could you ask me that another way?'],
    done: "That's everything on my side. Mrs. Brunner is the one to watch.",
    topics: [
      { ask: 'How is Mrs. Brunner?', cues: ['brunner', 'bed 4', 'margarethe', 'greta', 'how is she', 'confused', 'septic', 'sepsis', 'vital*'],
        say: "Heart rate 118, pressure 88 over 52, temperature 38.9, sats 93 on room air, GCS 13. She's more confused than when she came in.",
        again: '118, 88 over 52, 38.9, 93 percent. Worse than at triage.' },
      { ask: 'What are you doing in here?', cues: ['doing', 'pulling', 'meds', 'room', 'med room', 'cabinet', 'dispenser'],
        say: 'Pulling her fluid bolus. Dr. Shaw ordered thirty per kilo. We check every dose in here before it goes to the bedside.' },
      { ask: 'Anything in her records?', cues: ['fax', 'records', 'outside records', 'gp', 'whitfield', 'culture', 'notes', 'history'],
        say: "Her GP faxed records earlier. There's an old urine culture in her notes. Read it before anyone picks an antibiotic." },
      { cues: ['antibiotic*', 'meropenem', 'ceftriaxone', 'pip tazo', 'zosyn', 'cefepime', 'ertapenem'],
        say: "Nothing's hung yet. Read the fax first. That's all I'll say." },
      { cues: ['allerg*', 'penicillin'],
        say: 'Penicillin. Hives as a little girl, according to her chart.' },
      { cues: ['okafor', 'daniel', 'ankle', 'fast track', 'basketball'],
        say: 'Daniel in Fast Track rolled his ankle playing basketball. He walked in. He keeps asking about an MRI.' },
      { cues: ['daughter', 'sabine', 'family', 'next of kin'],
        say: "Her daughter Sabine is on her way. She's a pharmacy tech, so she'll know her meds." },
    ],
  },

  att_shaw: {
    hello: 'Evelyn Shaw, attending tonight. Have you seen Bed 2 yet?',
    back: 'Back so soon. What did you find?',
    meet: "Evelyn Shaw. Welcome. I'll be asking you questions all night. Don't take it personally.",
    thanks: 'Thank me by finishing your notes.',
    bye: 'Go. And come back with a plan.',
    kind: "Flattery won't get you out of a question.",
    steer: ['What would change your management?', "Try that again. What's your question?", 'Interesting. Why do you ask?'],
    done: "That's enough teaching for one night. Go see your patients.",
    topics: [
      { ask: 'Where should I start?', cues: ['start', 'first', 'where', 'begin', 'priorit*'],
        say: 'With the sickest. Bed 2 has an ECG waiting for you. What do you think you will find?' },
      { ask: "I've read Bed 2's ECG.", cues: ['stemi', 'st elevation', 'inferior', 'ii iii', 'avf', 'elevat*', 'heart attack', 'myocardial', 'read the ecg', 'seen the ecg', 'read his ecg'],
        say: "Good. Inferior ST elevation. Before you give him anything, what else do you want to know about his heart?",
        again: 'Inferior STEMI. What else do you check before you treat it?' },
      { cues: ['v4r', 'right sided', 'right side', 'right ventric*', 'rv', 'right heart'],
        say: 'Exactly. The right ventricle. And with a pressure of 96, which drug will you be careful with?' },
      { cues: ['nitro*', 'nitrate*', 'gtn'],
        say: "Right. No nitrates until you've ruled out right ventricular involvement. Ask him about erectile dysfunction pills, too. Then call cardiology." },
      { cues: ['!viagra', '!sildenafil', '!pde5', 'pde 5', 'phosphodiesterase', '!tadalafil', '!cialis'],
        say: 'Good catch. A PDE-5 inhibitor in the last day is another reason to keep the nitro away. Who are you calling now?' },
      { cues: ['cath lab', 'cardiolog*', 'pci', 'call cardio*', 'activat*', 'reperfus*', 'stent'],
        say: "Then don't tell me, tell them. Cardiology is at extension 4410. Door to balloon is ticking." },
      { ask: 'What about Bed 4?', cues: ['brunner', 'sepsis', 'septic', 'bed 4', 'urosepsis', 'delirium', 'confused', 'lactate'],
        say: 'Bed 4 is septic until proven otherwise. I started cultures, a lactate and fluids. Which antibiotic, and why?' },
      { cues: ['meropenem', 'ertapenem', 'carbapenem*', 'esbl'],
        say: 'Good. You read the fax. ESBL last spring, so a carbapenem. Her penicillin allergy was childhood hives, so that is fine.' },
      { cues: ['antibiotic*', 'ceftriaxone', 'pip tazo', 'piperacillin', 'zosyn', 'cefepime', 'cipro*', 'levofloxacin'],
        say: 'Read her GP\'s fax before you decide. Her last urine culture is in there.' },
      { cues: ['!ankle', '!okafor', 'xray', 'x ray', '!ottawa', 'sprain*', 'fast track'],
        say: 'The ankle in Fast Track. Can he walk four steps? Any bony tenderness? Then you know whether he needs an X-ray.' },
      { cues: ['plan', 'what should i do', 'what do i do', 'management', 'treat*'],
        say: 'You tell me. What would change your management?' },
      { cues: ['how long', 'experience', 'why emergency', 'why did you', 'career'],
        say: 'Fifteen years. I still learn something every night. Usually from a nurse.' },
    ],
  },

  pt_p_brunner: {
    hello: 'Grüezi... who are you? I have to go home, Mausi has not eaten.',
    back: 'You again? Have you seen my handbag?',
    meet: 'A doctor? So young. Sit, sit.',
    thanks: 'Bitte, bitte.',
    bye: 'Tell Sabine I am here.',
    kind: 'You are kind. Is it morning already?',
    steer: ["Was? I don't understand. Where is Sabine?", 'Is it morning? I must feed Mausi.', 'Who are all these people?'],
    done: 'I am so tired... can I go home now?',
    topics: [
      { ask: 'What is your name?', cues: ['name', 'call you'],
        say: 'I am Margarethe... Greta. Brunner.' },
      { ask: 'Do you know where you are?', cues: ['year', 'date', 'day', 'month', 'where are you', 'where you are', 'know where', 'hospital', 'orient*', 'president'],
        say: 'It is... 1987? I must go home and feed Mausi. Where is my handbag?' },
      { ask: 'How are you feeling?', cues: ['how are you', 'how do you feel', 'feel*', 'tired', 'weak*'],
        say: 'So tired. My legs feel like they belong to someone else.' },
      { ask: 'Does anything hurt?', cues: ['pain', 'hurt*', 'back', 'side', 'flank', 'sore'],
        say: "Here, my back on this side... it hurts. Don't press!" },
      { cues: ['pee', 'urine', 'urinat*', 'toilet', 'burn*', 'bathroom', 'water', 'bladder', 'wee'], hidden: true,
        say: 'Es brennt... it burns when I go to the toilet. And I must go all the time.' },
      { cues: ['fever*', 'hot', 'cold', 'chills', 'shiver*', 'temperature', 'warm'],
        say: 'I am so cold... then so hot. Why is it so cold here?' },
      { cues: ['allerg*', 'penicillin', 'reaction*'],
        say: "Allergies? No, no... I don't think so." },
      { cues: ['medic*', 'meds', 'pill*', 'tablet*'],
        say: 'My pills? Sabine knows. The white ones... and the little round one.' },
      { ask: 'Who found you at home?', cues: ['found', 'neighbo*', 'ambulance', 'how did you get', 'arriv*', 'home'],
        say: 'My neighbor came in. She called my name from the kitchen. Then there were men in uniforms.' },
      { ask: 'Is there someone we can call?', cues: ['sabine', 'daughter', 'family', 'call', 'someone', 'next of kin'],
        say: "Sabine, my daughter. Her number is in my book. She will be cross that I didn't pick up the phone." },
      { cues: ['mausi', 'cat', 'pet'],
        say: 'Mausi is my cat. She only eats the fish in the blue tin.' },
    ],
  },

  pt_p_okafor: {
    hello: 'Hey, Doc! Rolled my ankle on a rebound. Please tell me I can still play next Saturday?',
    back: 'Doc! Any news on my ankle?',
    meet: 'Daniel. Nice to meet you, Doc.',
    thanks: 'Thank you, seriously.',
    bye: "Don't forget about me in here, Doc.",
    kind: "Appreciate it. I've had worse. Probably.",
    steer: ["No idea, Doc. You're the expert!", 'Uh, pass?', 'Ha, I just write software, Doc.'],
    done: 'So, Saturday. Yes or no?',
    topics: [
      { ask: 'What happened to your ankle?', cues: ['happen*', 'how did', 'injur*', 'mechanism', 'roll*', 'twist*', 'land*', 'what did you do'],
        say: "Came down from a rebound and landed on a guy's foot. My right ankle rolled inward." },
      { ask: 'Could you walk afterwards?', cues: ['walk*', 'weight', 'step*', 'stand*', 'bear'],
        say: "I limped off the court and walked in here from my buddy's car. It hurts, but I can do it." },
      { ask: 'Where does it hurt?', cues: ['where', 'location', 'point', 'hurt*', 'show me', 'sore', 'tender*'],
        say: 'On the outside, right in front of and below the ankle bone.' },
      { cues: ['when did', 'when was', 'what time', 'how long ago', 'how long has it'],
        say: 'Around half past seven, at pickup basketball.' },
      { cues: ['pop', 'crack', 'snap', 'sound', 'heard'],
        say: 'No pop or crack that I heard.' },
      { cues: ['before', 'previous*', 'prior', 'history', 'again'],
        say: 'Sprained the same ankle in college, maybe eight years ago. Healed fine.' },
      { cues: ['numb*', 'tingl*', 'toes', 'sensation', 'pins and needles'],
        say: 'No numbness or tingling. My toes wiggle fine.' },
      { cues: ['hit your head', 'head', 'knee', 'other injur*', 'hurt anything else'],
        say: "Just the ankle. Didn't hit my head, knee's fine." },
      { cues: ['medic*', 'meds', 'pill*', 'painkiller*', 'ibuprofen', 'taken anything', 'take anything', 'took'],
        say: "I don't take any medications. Haven't had anything for the pain yet." },
      { cues: ['allerg*'], say: 'No allergies.' },
      { cues: ['medical problem*', 'medical history', 'conditions', 'healthy', 'surger*', 'illness*', 'health problem*'],
        say: 'Totally healthy. No medical problems, no surgeries.' },
      { cues: ['work', 'job', 'for a living', 'smok*', 'drink*', 'alcohol'],
        say: "I'm a software engineer. Basketball twice a week. I drink socially, don't smoke." },
      { ask: 'When do you want to play again?', cues: ['play', 'tournament', 'mri', 'sport', 'return', 'game', 'saturday', 'worried'],
        say: "I've got a tournament next Saturday. My buddy says I definitely need an MRI to be sure nothing's torn." },
      { cues: ['no xray', 'no x ray', 'dont need', 'do not need', 'ottawa', 'sprain*', 'not broken', 'no fracture', 'ice', 'brace', 'crutch*', 'elevat*', 'rest it'],
        say: "So no X-ray? And no MRI? Huh. My buddy's going to be so disappointed. He bet me it was broken." },
      { cues: ['tetanus', 'vaccin*', 'shot', 'tdap', 'jab'],
        say: 'They gave me a tetanus shot when I got stitches a few years ago.' },
    ],
  },

  clerk_paul: {
    hello: "Welcome. I'm Paul, over here at registration. How can I help?",
    thanks: "You're welcome.",
    bye: 'Have a good night.',
    steer: ['I just do registration, sorry.', "You'd have to ask a nurse about that."],
    done: 'Anything else, just ask.',
    topics: [
      { ask: 'Where is the nurses’ station?', cues: ['nurse*', 'station', 'way', 'where', 'find', 'get to'],
        say: 'Through those sliding doors into the main corridor. Look for the big tracking board over the counter.' },
      { ask: 'What happens at registration?', cues: ['registration', 'register', 'job', 'do here', 'insurance', 'id'],
        say: 'I check names, dates of birth and insurance. The triage nurse handles the medical questions.' },
      { cues: ['wait*', 'how long', 'busy', 'line', 'queue'],
        say: 'About an hour for the non-urgent ones tonight. Chest pain goes straight back.' },
      { cues: ['tv', 'television', 'channel', 'remote'],
        say: "The remote vanished in 2019. We've made our peace with the cooking channel." },
    ],
  },

  vis_1: {
    hello: 'Oh, hello. Is this seat in your way?',
    thanks: 'Of course.',
    bye: 'Take care, now.',
    kind: "That's kind of you.",
    steer: ["Sorry, I'm not from around here.", 'Oh, I wouldn’t know about that.'],
    done: "Anyway, I'll be right here.",
    topics: [
      { ask: 'Who are you waiting for?', cues: ['who', 'waiting for', 'brought', 'with you', 'sister'],
        say: "My sister. She asked me to hold her coat. I told her I'd stay right here where she could find me." },
      { ask: 'How is the waiting room?', cues: ['waiting room', 'room', 'quiet', 'busy', 'tv', 'television'],
        say: "The television's been on the same channel all night. I've started guessing what they're saying from the pictures." },
      { cues: ['how long', 'wait*', 'hours'],
        say: 'Two hours. They said she was next. They said that an hour ago.' },
    ],
  },

  cards: {
    hello: 'Cardiology, Dr. Lindqvist speaking. Are you calling about the ECG in Bed 2?',
    thanks: 'Sure. Call me if anything changes.',
    bye: 'Call me back if anything changes.',
    steer: ["Sorry, the line's bad. What do you need?", "Give me the short version. What's on the ECG?"],
    done: "Anything else? Otherwise I'm on my way.",
    topics: [
      { ask: 'I have an inferior STEMI in Bed 2.', cues: ['stemi', 'st elevation', 'inferior', 'ii iii', 'avf', 'heart attack', 'elevat*', 'keller'],
        say: "Inferior STEMI in Bed 2, got it. I'm activating the cath lab now. They'll be ready in about twenty minutes. Has he had aspirin?",
        again: "The cath lab is on its way. Twenty minutes." },
      { cues: ['not yet', 'hasnt', 'has not', 'no aspirin', 'not had', 'nobody'],
        say: 'Then give him 324 milligrams to chew, and heparin per protocol. Hold the nitro until we know his right ventricle.' },
      { cues: ['yes', 'already', 'given', 'had aspirin', 'he has'],
        say: 'Good. Heparin per protocol, and hold the nitro until we know his right ventricle.' },
      { cues: ['v4r', 'right sided', 'right ventric*', 'rv', 'hypotens*', 'low pressure', 'pressure is', 'blood pressure'],
        say: 'Low pressure with an inferior STEMI: think right ventricle. Get V4R, give fluid if he drops, and no nitrates.' },
      { cues: ['!viagra', '!sildenafil', '!pde5', 'pde 5', '!cialis', '!tadalafil'],
        say: 'Sildenafil this afternoon? Then absolutely no nitrates. Good catch.' },
      { ask: 'Where can I see the ECG?', cues: ['where', 'see', 'find', 'look'],
        say: "Open Mr. Keller's chart and look under ECG. Then tell me what you see." },
      { ask: 'Who is on call?', cues: ['who', 'on call', 'fellow', 'attending'],
        say: "You're through to the cardiology fellow on call. It's me all night." },
    ],
  },

  lab: {
    hello: 'Clinical laboratory, night desk. Are you looking for a result?',
    thanks: 'No problem.',
    bye: 'Lab out.',
    steer: ["Sorry, I've only got the lab system in front of me.", 'You might want the nurses for that.'],
    done: 'Anything else from the lab?',
    topics: [
      { ask: "Is Mr. Keller's troponin back?", cues: ['keller', 'troponin', 'trop', 'bed 2', 'chemistry'],
        say: "Mr. Keller's troponin and chemistry came in just after ten. Give the troponin about forty minutes." },
      { ask: "What about Mrs. Brunner's labs?", cues: ['brunner', 'bed 4', 'lactate', 'cbc', 'culture*', 'blood count'],
        say: "Mrs. Brunner's lactate and blood count are running. The cultures take a day or two." },
      { ask: 'Where are the results?', cues: ['where', 'result*', 'find', 'see'],
        say: "They're filed under Results in the patient's chart. Check the collection time if you're looking at two draws from the same visit." },
      { ask: 'Who calls about critical results?', cues: ['critical', 'call', 'page'],
        say: "We page the department with the patient's name, the test and the value. The page stays on the board until somebody acknowledges it." },
    ],
  },

  gp_whitfield: {
    hello: "Maple Street Family Medicine, answering service. Is this about Mrs. Brunner's records?",
    thanks: "You're welcome. Good night.",
    bye: 'Good night.',
    steer: ["I'm only the answering service, I'm afraid.", 'I can take a message for the morning.'],
    done: 'Is there anything else?',
    topics: [
      { ask: 'Did you send the records?', cues: ['fax', 'record*', 'brunner', 'note*', 'result*', 'culture', 'sent', 'send'],
        say: "Yes, they went across at about quarter past ten. Look in her chart under Notes for the fax from our practice." },
      { ask: 'Is the office open?', cues: ['office', 'open', 'hours', 'closed'],
        say: "The office is closed for the night. Dr. Mehta is on call for Dr. Whitfield." },
      { cues: ['doctor', 'mehta', 'whitfield', 'speak to', 'talk to', 'page'],
        say: "Dr. Mehta is on call, but the fax has everything he would tell you tonight." },
    ],
  },
};

// ───────────────────────────── matching ─────────────────────────────

interface Said {
  words: string[];
  /** the message, lower case, without apostrophes, padded with spaces: " whats going on " */
  n: string;
}

function parse(text: string): Said {
  const n = ` ${text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return { n, words: n.trim().split(' ').filter(Boolean) };
}

const phrases = new Map<string, RegExp>();
/** a phrase as a pattern over the padded message; its words may be stems ("heart problem*") */
function phrase(cue: string): RegExp {
  let re = phrases.get(cue);
  if (!re) {
    const words = cue.split(' ').map((w) => (w.endsWith('*') ? `${w.slice(0, -1)}[a-z0-9]*` : w));
    phrases.set(cue, (re = new RegExp(` ${words.join(' ')} `)));
  }
  return re;
}

function cueHits(q: Said, cue: string): number {
  if (cue.startsWith('!')) return cueHits(q, cue.slice(1)) ? 3 : 0;
  if (cue.includes(' ')) return phrase(cue).test(q.n) ? 2 : 0;
  if (cue.endsWith('*')) {
    const stem = cue.slice(0, -1);
    return q.words.some((w) => w.startsWith(stem)) ? 1 : 0;
  }
  return q.words.includes(cue) ? 1 : 0;
}

const score = (q: Said, cues: string[]) => cues.reduce((s, c) => s + cueHits(q, c), 0);

/** what a message is socially, if anything, most decisive first */
const SOCIAL: [kind: 'bye' | 'thanks' | 'meet' | 'who' | 'hello' | 'kind' | 'more', cues: string[]][] = [
  ['bye', ['bye', 'goodbye', 'see you', 'see ya', 'take care', 'later', 'good night', 'goodnight', 'gotta go', 'have to go', 'got to go', 'must go', 'be back', 'catch you']],
  ['thanks', ['thanks', 'thank', 'thx', 'cheers', 'appreciate*', 'ty']],
  ['meet', ['my name', 'im dr', 'im doctor', 'i am dr', 'i am doctor', 'im the doctor', 'im your doctor', 'im one of', 'i am one of', 'im the resident', 'im a resident', 'im the new', 'im new', 'nice to meet', 'pleased to meet', 'good to meet', 'introduce myself']],
  ['who', ['your name', 'who are you', 'whats your name', 'introduce yourself', 'and you are']],
  ['hello', ['hi', 'hello', 'hey', 'hiya', 'howdy', 'evening', 'morning', 'afternoon', 'greetings']],
  ['kind', ['sorry', 'dont worry', 'do not worry', 'youll be', 'you will be', 'going to be ok', 'gonna be ok', 'going to be okay', 'gonna be okay', 'going to be fine', 'gonna be fine', 'be alright', 'be all right', 'were here', 'we are here', 'take good care', 'well take care', 'we will take care', 'good hands', 'youre safe', 'you are safe', 'here for you', 'must be scary', 'must be hard', 'must be frightening', 'sounds hard', 'sounds scary', 'i understand', 'hang in there']],
  ['more', ['go on', 'anything else', 'what else', 'tell me more', 'and then', 'continue', 'keep going', 'then what', 'whats next', 'what next', 'more', 'something else', 'else']],
];

const isSaid = (t: Topic, said: string[]) => said.some((s) => s.includes(t.say) || (!!t.again && s.includes(t.again)));
const answer = (t: Topic, said: string[]) => (isSaid(t, said) ? (t.again ?? t.say) : t.say);
/** the first thing they would volunteer that they have not said yet */
const unsaid = (p: Script, said: string[]) => p.topics.find((t) => !t.hidden && !isSaid(t, said));

/** A scripted reply from `id` (an NPC or a phone contact) to `text`, given the conversation so far. */
export function demoReply(id: string, text: string, previous: ChatLine[]): string {
  const p = scripts[id];
  if (!p) return 'Hello there. Rosa at the station can show you around.';
  const said = previous.filter((l) => l.speaker === 'npc').map((l) => l.text);
  if (text === '__dial__') return p.hello;
  // a suggested question is its topic, whatever else it says
  const chip = p.topics.find((t) => t.ask === text);
  if (chip) return answer(chip, said);
  const q = parse(text);
  let best: { t: Topic; s: number } | undefined;
  for (const t of p.topics) {
    const s = score(q, t.cues);
    // a tie goes to what they have not said yet, then to the earlier topic
    if (s > 0 && (!best || s > best.s || (s === best.s && isSaid(best.t, said) && !isSaid(t, said)))) best = { t, s };
  }
  const found = SOCIAL.map(([kind, cues]) => ({ kind, s: score(q, cues) })).find((x) => x.s > 0);
  const social = found?.kind;
  // a question beats a greeting ("Hi, any allergies?"); "anything else" yields to a topic named outright
  // ("anything else you take?"); thanks, goodbyes and kind words need a topic named more strongly than they are
  // ("Thanks, see you later", "Don't worry, we'll take care of you")
  const topicWins = best && (!found || (social === 'hello' || social === 'meet' || social === 'who' ? true : social === 'more' ? best.s >= 2 : best.s > found.s));
  if (best && topicWins) return answer(best.t, said);
  switch (social) {
    case 'bye': return p.bye;
    case 'thanks': return p.thanks;
    case 'meet':
    case 'who': return p.meet ?? p.hello;
    case 'hello': return said.length ? (p.back ?? p.hello) : p.hello;
    case 'kind': return p.kind ?? p.thanks;
    case 'more': return unsaid(p, said)?.say ?? p.done;
  }
  // nothing landed: a deflection in character, in turn, and something they have not said yet
  const steered = said.filter((s) => p.steer.some((l) => s.startsWith(l))).length;
  return `${p.steer[steered % p.steer.length]} ${unsaid(p, said)?.say ?? p.done}`;
}

/** The suggested questions for `npc` (the tablet's chips): what has not been answered yet, in order. */
export function demoQuestions(npc: NpcView, lines: ChatLine[] = []): string[] {
  const said = lines.filter((l) => l.speaker === 'npc').map((l) => l.text);
  return (scripts[npc.id]?.topics ?? []).filter((t) => t.ask && !t.hidden && !isSaid(t, said)).map((t) => t.ask!);
}

// ───────────────────────────── recorded voices ─────────────────────────────

/** The speakers whose lines are recorded, one MP3 per sentence: client/public/res/audio/<folder>/ */
export const DEMO_VOICES: Readonly<Record<string, string>> = { tech_marcus: 'marcus', pt_p_keller: 'keller', rn_tom: 'becker' };

/** Every line `id` can say on its own (replies are these, or a deflection followed by one). */
export function scriptLines(id: string): string[] {
  const p = scripts[id];
  if (!p) return [];
  return [p.hello, p.back, p.meet, p.thanks, p.bye, p.kind, p.done, ...p.steer, ...p.topics.flatMap((t) => [t.say, t.again])].filter((l): l is string => !!l);
}

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st']);

/** A line's sentences, as they are recorded: "Mr. Keller" and "38.9" do not end one. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.!?…'.includes(text[i])) continue;
    let end = i;
    while (end + 1 < text.length && '.!?…"\'’”)'.includes(text[end + 1])) end++;
    const next = text[end + 1];
    const word = /([A-Za-z]+)$/.exec(text.slice(start, i))?.[1]?.toLowerCase();
    if ((next !== undefined && !/\s/.test(next)) || (text[i] === '.' && end === i && word && ABBREVIATIONS.has(word))) {
      i = end;
      continue;
    }
    const s = text.slice(start, end + 1).trim();
    if (s) out.push(s);
    start = end + 1;
    i = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** a recorded sentence's file name */
export const clipName = (sentence: string) => `${hash32(sentence).toString(16)}.mp3`;

const recorded = new Map<string, Set<string>>();
/** every sentence `id` can say (the recordings it needs) */
export function scriptSentences(id: string): Set<string> {
  let s = recorded.get(id);
  if (!s) recorded.set(id, (s = new Set(scriptLines(id).flatMap(sentences))));
  return s;
}

/** The recorded sentences of a reply, or null when the speaker has no recordings or a sentence is missing. */
export function recordedParts(id: string, text: string): { text: string; url: string }[] | null {
  const folder = DEMO_VOICES[id];
  if (!folder) return null;
  const parts = sentences(text);
  const known = scriptSentences(id);
  if (!parts.length || !parts.every((s) => known.has(s))) return null;
  return parts.map((s) => ({ text: s, url: `/res/audio/${folder}/${clipName(s)}` }));
}

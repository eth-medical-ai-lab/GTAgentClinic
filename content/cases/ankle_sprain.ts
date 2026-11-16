import { okaforExam } from '../../shared/tourExams';
import { VOICE_CAST } from '../../shared/voiceCast';
import { legacy } from './provenance';
import type { CaseDef } from '../types';

export const ankleSprain: CaseDef = {
  specialty: 'musculoskeletal', provenance: legacy('ankle_sprain'),
  id: 'ankle_sprain',
  title: 'Lateral ankle sprain — Ottawa-rule negative',
  summary: '31M basketball inversion injury. Ottawa ankle rules negative → no imaging. He wants an MRI for his tournament; the insurer will not pre-authorize it.',
  difficulty: 1,
  patient: {
    firstName: 'Daniel',
    lastName: 'Okafor',
    sex: 'M',
    age: 31,
    dob: '1995-03-14',
    mrn: '00977120',
    weightKg: 84,
    heightCm: 186,
    language: 'English',
    appearance: { skin: '#5a3a26', hair: '#141010', hairStyle: 'buzz', outfit: 'casual', outfitColor: '#d4a017', pantsColor: '#222831', height: 1.88, build: 'average', age: 'young' },
    insurance: { payer: 'BlueRiver Health', memberId: 'BRH-55821-0', plan: 'PPO', contactId: 'ins_blueriver' },
    codeStatus: 'Full code',
    voice: VOICE_CAST.pt_p_okafor,
  },
  presentation: {
    chiefComplaint: 'R ankle injury',
    arrivalMode: 'Walk-in', walkToBed: true,
    esi: 4,
    triageNote: '31M R ankle inversion injury playing basketball ~2 h PTA. Ambulatory with limp. Swelling lateral ankle. Denies other injuries, no head strike. Pain 6/10. ESI 4.',
    triageVitals: { hr: 84, sbp: 128, dbp: 78, rr: 16, spo2: 99, temp: 36.7, pain: 6, o2: 'RA' },
    documentedAllergies: 'NKDA',
    documentedHomeMeds: [],
    problemList: [],
    encounters: [{ id: 'enc_d1', date: '2023-06-02', type: 'ED visit', department: 'Emergency', reason: 'Hand laceration', summary: '3 cm laceration of the left palm (kitchen knife). Repaired with 5 sutures. Tdap given.' }],
    posture: 'sit',
    // Fast Track: he walked in (ESI 4) and waits sitting on the stretcher's edge, legs over the side, which
    // is also how an ankle is examined. Once ice and elevation have been done he is on the stretcher,
    // reclined to 40° with the injured right leg raised on a pillow, the ankle near heart level (RICE).
    bed: { headDeg: 30, sitting: 'edge', afterOrders: { codes: ['ice_elevate'], bed: { headDeg: 40, legUp: 'R' } } },
    initialEmotion: 'neutral',
  },
  truth: {
    allergies: [],
    diagnosis: {
      label: 'Right lateral ankle sprain (ATFL), Ottawa ankle rules negative',
      icd10: 'S93.491A', // ATFL: "sprain of other ligament of right ankle", initial encounter (ICD-10-CM has no ATFL-specific code)
      accept: ['ankle sprain', 'lateral ankle sprain', 'atfl', 'anterior talofibular', 'sprain of right ankle', 'right ankle sprain', 'inversion sprain', 'sprained ankle', 'ligament sprain'],
      partial: ['ankle injury', 'ankle contusion', 'soft tissue injury', 'ankle pain', 'ligament injury'],
    },
    dispositions: ['discharge'],
    outcomeGood: 'Daniel went home with a brace, ibuprofen and an early-mobilization plan. He skipped the tournament but was back on court three weeks later.',
    outcomeBad: 'Daniel left with unnecessary imaging bills and a rigid splint that slowed his recovery.',
  },
  persona: {
    personality: 'Friendly, upbeat software engineer, a little impatient about waiting; obsessed with whether he can play in next Saturday\'s tournament; his friend told him he "definitely needs an MRI".',
    voice: 'Casual, energetic, jokes about his "career-ending injury".',
    healthLiteracy: 'average',
    opening: 'Hey doc! Rolled my ankle on a rebound. Please tell me I can still play next Saturday?',
    facts: [
      { id: 'do_mech', label: 'Inversion mechanism', key: true, text: 'Came down from a rebound and landed on a guy\'s foot — my right ankle rolled inward.', keywords: ['how', 'happen', 'injury', 'mechanism', 'roll', 'twist', 'land', 'what happened'] },
      { id: 'do_time', text: 'About two hours ago, at pickup basketball.', keywords: ['when', 'time', 'how long'] },
      { id: 'do_weight', label: 'Able to bear weight immediately and in ED', key: true, text: 'I could walk on it right after — limped off the court and walked in here from my buddy\'s car.', keywords: ['walk', 'weight', 'steps', 'bear', 'stand', 'limp'] },
      { id: 'do_pop', text: 'No pop or crack that I heard.', keywords: ['pop', 'crack', 'snap', 'sound', 'heard'] },
      { id: 'do_location', label: 'Pain anterior-inferior to lateral malleolus', key: true, text: 'It hurts on the outside, right in front of and below the ankle bone.', keywords: ['where', 'location', 'point', 'hurt', 'show me', 'side'] },
      { id: 'do_prior', text: 'Sprained the same ankle in college, maybe eight years ago. Healed fine.', keywords: ['before', 'previous', 'prior', 'history', 'sprain', 'injured'] },
      { id: 'do_nv', label: 'No numbness/tingling', key: true, text: 'No numbness or tingling. I can wiggle my toes fine.', keywords: ['numb', 'tingle', 'feel', 'toes', 'sensation', 'pins'] },
      { id: 'do_other', text: 'Just the ankle. Didn\'t hit my head, knee\'s fine.', keywords: ['other', 'head', 'knee', 'else', 'injuries'] },
      { id: 'do_meds', text: 'I don\'t take any medications. Haven\'t taken anything for the pain yet.', keywords: ['medication', 'meds', 'pills', 'take', 'painkiller', 'ibuprofen', 'took'] },
      { id: 'do_allergy', text: 'No allergies.', keywords: ['allerg'] },
      { id: 'do_pmh', text: 'Totally healthy. No medical problems, no surgeries.', keywords: ['medical', 'problems', 'conditions', 'history', 'surgery', 'illness'] },
      { id: 'do_nsaid_safety', text: 'No stomach ulcers, no kidney problems, no bleeding issues.', keywords: ['stomach', 'ulcer', 'kidney', 'bleeding', 'asthma'] },
      { id: 'do_social', text: 'I\'m a software engineer. Basketball twice a week. I drink socially, don\'t smoke.', keywords: ['work', 'job', 'smoke', 'drink', 'alcohol', 'drugs', 'occupation', 'social'] },
      { id: 'do_goal', text: 'I\'ve got a tournament next Saturday. My buddy said I definitely need an MRI to be sure nothing\'s torn.', keywords: ['play', 'tournament', 'mri', 'sport', 'return', 'game', 'goal', 'worried'] },
      { id: 'do_tetanus', text: 'Tetanus? They gave me a shot when I got stitches a few years ago.', keywords: ['tetanus', 'vaccine', 'shot', 'tdap'] },
    ],
    unknowns: ['whether anything is broken', 'test results'],
    behavior: [
      'Ask about the MRI if the doctor doesn\'t bring it up. If the doctor explains clearly why no imaging is needed (Ottawa rules), accept it with mild disappointment.',
      'If you are left waiting a long time with nobody talking to you, get impatient and joke about leaving.',
    ],
    capacity: 'intact',
    fallback: 'No idea, doc — you\'re the expert!',
    counseling: [
      { id: 'do_no_imaging', label: 'Explained why no X-ray/MRI is needed', description: 'The doctor explains that imaging is not needed (Ottawa ankle rules / no bone tenderness, can walk) or that MRI won\'t change management.', keywords: ['ottawa', 'no x-ray', "don't need", 'not needed', 'no mri', 'not broken', 'no fracture'] },
      { id: 'do_rtp', label: 'Return-to-play and rehab plan', description: 'The doctor explains early mobilization/exercises, brace, expected recovery time, or when he can return to basketball.', keywords: ['weeks', 'return', 'play', 'exercise', 'brace', 'rehab', 'physio', 'mobil'] },
      { id: 'do_precautions', label: 'Return precautions', description: 'The doctor tells him when to come back (worsening pain, numbness, inability to walk, calf pain, not improving in 1–2 weeks).', keywords: ['come back', 'return if', 'worse', 'numb', 'cannot walk', 'follow up', 'follow-up'] },
    ],
  },
  phoneContacts: [
    {
      contact: { id: 'ins_blueriver', name: 'BlueRiver Health — Utilization Management', role: 'Insurance pre-authorization line', org: 'External', phone: '1-800-555-0199', kind: 'external' },
      voice: { id: 'bf_lily', speed: 1.04 }, // "Brenda"
      persona: {
        personality: 'Utilization-management representative ("Brenda") reading from a script; polite, robotic, cannot make clinical judgments; uses phrases like "medical necessity criteria" and "reference number".',
        voice: 'Call-center script; hold music jokes; spells out reference numbers.',
        healthLiteracy: 'average',
        opening: 'Thank you for calling BlueRiver Health utilization management, this is Brenda. Your call may be recorded. Can I have the member ID, the CPT code and the ordering provider\'s NPI?',
        facts: [
          { id: 'ins_criteria', text: 'For MRI of the ankle, our medical-necessity criteria require six weeks of documented conservative therapy, or red flags such as suspected fracture not seen on X-ray, or a locked joint.', keywords: ['mri', 'criteria', 'approve', 'authorization', 'necessity', 'requirements'] },
          { id: 'ins_er', text: 'Emergency services never require prior authorization — only scheduled outpatient advanced imaging does.', keywords: ['emergency', 'er', 'x-ray', 'urgent'] },
        ],
        unknowns: ['clinical advice'],
        behavior: [
          'Ask for member ID, CPT code (MRI ankle w/o contrast = 73721), ICD-10 code and clinical justification.',
          'Deny or pend the MRI request for an acute sprain without red flags: give a reference number like "PA-4417-882" and offer a peer-to-peer review.',
          'Never give medical advice.',
        ],
        capacity: 'intact',
        fallback: 'I\'m sorry, I don\'t have that information. Is there anything else I can help with today?',
        actions: [{ id: 'deny_auth', description: 'Deny/pend the authorization request.' }, { id: 'approve_auth', description: 'Approve only if criteria are clearly met.' }],
      },
      phoneActions: [
        { id: 'deny_auth', description: 'Pre-auth denied', note: { title: 'Insurance — prior authorization', type: 'Outside Records', author: 'BlueRiver Health UM', delayMin: 1, text: 'MRI ankle (CPT 73721) — PRIOR AUTHORIZATION NOT APPROVED. Reason: does not meet medical-necessity criteria (acute injury < 6 weeks, no red flags). Ref PA-4417-882. Peer-to-peer available.' }, flag: 'mri_denied' },
      ],
    },
  ],
  consults: [
    {
      contactId: 'ortho',
      criteria: 'Orthopedics on call (busy) pushes back on consults for an Ottawa-negative ankle sprain: recommend functional treatment, brace, NSAIDs, outpatient sports-medicine follow-up if not improving in 1–2 weeks. Do not accept.',
      guard: { type: 'flag', flag: '__never__' },
      onAccept: {},
      declineHint: 'Ortho: "It\'s a sprain — brace, ibuprofen, follow up in clinic if not better."',
    },
  ],
  physiology: {
    baseline: { hr: 84, sbp: 128, dbp: 78, rr: 16, spo2: 99, temp: 36.7, pain: 6, gcs: 15, glucose: 96, lactate: 1.0, creat: 0.95 },
    drift: { pain: 0.1 },
    limits: { pain: [0, 10] },
    noise: { hr: 3, sbp: 3, dbp: 2, rr: 1, spo2: 0.4, temp: 0.1 },
    effects: [
      { tag: 'nsaid', onsetMin: 20, tauMin: 15, durationMin: 360, delta: { pain: -2.5 } },
      { tag: 'analgesic_mild', onsetMin: 20, tauMin: 15, durationMin: 300, delta: { pain: -1.5 } },
      { tag: 'opioid', onsetMin: 5, tauMin: 5, durationMin: 180, delta: { pain: -3 } },
      { tag: 'rice', onsetMin: 5, tauMin: 10, durationMin: 240, delta: { pain: -1 } },
      { tag: 'brace', onsetMin: 2, tauMin: 5, delta: { pain: -0.5 } },
    ],
  },
  labs: {},
  imaging: {
    xr_ankle: { findings: 'Three views of the right ankle. No acute fracture or dislocation. Ankle mortise congruent. Soft-tissue swelling over the lateral malleolus. No joint effusion. Base of the fifth metatarsal unremarkable on included views.', impression: 'No fracture. Lateral soft-tissue swelling consistent with sprain.', imageKey: 'xr_ankle' },
    xr_foot: { findings: 'Three views of the right foot. No fracture or dislocation. Lisfranc alignment normal.', impression: 'No acute osseous abnormality.', imageKey: 'xr_foot' },
    mri_ankle: {
      findings: '',
      impression: '',
      blocked: { from: 'Radiology (Dr. Ito)', message: "Radiology here — we don't do MRIs from the ED for an acute ankle sprain; there's no emergent indication and the scanner is reserved for strokes and cords tonight. If he still needs one later, it's an outpatient study and his insurer will want prior authorization. I'm canceling the order." },
    },
  },
  ecg: {
    params: { rate: 82, rhythm: 'sinus', pr: 150, qrs: 88, qt: 380, axis: 60, seed: 51 },
    machineRead: 'Normal sinus rhythm. Normal ECG.',
    readKeywords: ['normal', 'sinus'],
  },
  exam: okaforExam,
  scoring: {
    dxPoints: 20,
    dispoPoints: 15,
    historyPoints: 10,
    critical: [
      { id: 'ottawa', label: 'Applied the Ottawa ankle/foot rules (malleoli, 5th MT base, navicular, weight bearing)', points: 15, rule: { type: 'exam', maneuvers: ['msk_lat_malleolus', 'msk_med_malleolus', 'msk_5th_mt', 'msk_navicular', 'msk_weight_bearing'], min: 4 } },
      { id: 'nv', label: 'Checked distal neurovascular status', points: 5, rule: { type: 'exam', maneuvers: ['msk_neurovascular'] } },
      { id: 'analgesia', label: 'Analgesia (NSAID or acetaminophen)', points: 10, rule: { type: 'given', tags: ['nsaid', 'analgesic_mild'], withinMin: 120 } },
      { id: 'support', label: 'Functional support (brace) and/or ice, elevation, compression', points: 5, rule: { type: 'order', codes: ['ankle_brace', 'ice_elevate'] } },
      { id: 'counsel', label: 'Explained no imaging needed + return-to-play/rehab plan', points: 10, rule: { type: 'counseled', ids: ['do_no_imaging', 'do_rtp'], all: false } },
    ],
    harms: [],
    lowValue: [
      { codes: ['xr_ankle', 'xr_foot'], penalty: 10, why: 'Ottawa rules negative (no malleolar or midfoot bony tenderness; able to bear weight) → radiographs not indicated (sensitivity ≈ 98–99%).' },
      { codes: ['mri_ankle'], penalty: 12, why: 'MRI has no role in the acute ED management of an ankle sprain.' },
      { codes: ['cbc', 'bmp', 'cmp', 'coags', 'crp', 'esr', 'ua', 'ddimer'], penalty: 4, why: 'Laboratory tests are not indicated for an isolated ankle sprain.' },
      { codes: ['splint_posterior'], penalty: 5, why: 'Rigid immobilization delays recovery compared with functional support for grade I–II sprains.' },
      { codes: ['morphine', 'hydromorphone', 'fentanyl'], penalty: 4, why: 'Opioids are rarely needed for an uncomplicated sprain; NSAIDs are effective.' },
    ],
  },
  items: [
    {
      id: 'okafor_gym_bag',
      kind: 'sportsBag',
      label: "Daniel's gym bag",
      where: 'foot',
      text: 'Basketball shoes (the right lace cut by triage), a water bottle, and a worn lace-up ankle brace with a college team logo — "same ankle, back in college".',
      facts: ['do_prior'],
    },
  ],
  teaching: [
    'Ottawa ankle rules: ankle X-ray only if malleolar-zone pain AND bony tenderness at the posterior edge/tip of either malleolus (distal 6 cm) OR inability to bear weight both immediately and in the ED (4 steps).',
    'Foot X-ray only if midfoot pain AND tenderness at the base of the 5th metatarsal or the navicular, OR inability to bear weight.',
    'Acute lateral ankle sprains: functional treatment (brace, early weight-bearing, exercise therapy) beats rigid immobilization; NSAIDs are effective for pain. MRI adds nothing acutely.',
    'A delayed physical exam (4–5 days) is more accurate for ligament rupture (anterior drawer) once swelling settles.',
    'Prior authorization applies to scheduled advanced imaging, never to emergency care — and knowing the criteria saves everyone a phone call.',
  ],
  references: [
    'Stiell IG, et al. Implementation of the Ottawa ankle rules. JAMA. 1994;271:827–832.',
    'Bachmann LM, et al. Accuracy of Ottawa ankle rules to exclude fractures of the ankle and mid-foot: systematic review. BMJ. 2003;326:417.',
    'Vuurberg G, et al. Diagnosis, treatment and prevention of ankle sprains: update of an evidence-based clinical guideline. Br J Sports Med. 2018;52:956.',
  ],
};

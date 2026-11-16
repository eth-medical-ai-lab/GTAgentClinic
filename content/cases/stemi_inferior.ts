import { kellerExam } from '../../shared/tourExams';
import { VOICE_CAST } from '../../shared/voiceCast';
import { legacy } from './provenance';
import type { CaseDef } from '../types';

export const stemiInferior: CaseDef = {
  specialty: 'cardiology', provenance: legacy('stemi_inferior'),
  id: 'stemi_inferior',
  title: 'Inferior STEMI with right-ventricular involvement',
  summary: '64M with chest pressure; inferior ST elevation, RV involvement, hidden PDE5-inhibitor use — nitrates are a trap.',
  difficulty: 2,
  patient: {
    firstName: 'Robert',
    lastName: 'Keller',
    sex: 'M',
    age: 64,
    dob: '1962-08-09',
    mrn: '00482913',
    weightKg: 96,
    heightCm: 178,
    language: 'English',
    appearance: { skin: '#e8b896', hair: '#9a9a9a', hairStyle: 'short', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.78, build: 'heavy', age: 'old', accessories: ['beard'] },
    pcp: { name: 'Dr. Miriam Cole', practice: 'Lakeside Family Practice', phone: '555-0131', contactId: 'gp_cole' },
    insurance: { payer: 'Unity Health PPO', memberId: 'UHP-7730-1182', plan: 'PPO Gold', contactId: 'ins_unity' },
    emergencyContact: { name: 'Linda Keller', relation: 'Wife', phone: '555-0177', contactId: 'fam_linda_phone' },
    codeStatus: 'Full code (presumed)',
    voice: VOICE_CAST.pt_p_keller,
  },
  presentation: {
    chiefComplaint: 'Chest pain',
    arrivalMode: 'Private vehicle',
    esi: 2,
    triageNote:
      '64M c/o substernal chest pressure since ~21:45 while watching TV, radiating to L arm and jaw, with diaphoresis and nausea (vomited x1 in car). Hx HTN, DM2, smoker. Took nothing for the pain. 12-lead ECG obtained in triage per chest-pain protocol — to physician for review. ESI 2.',
    triageVitals: { hr: 56, sbp: 104, dbp: 66, rr: 20, spo2: 95, temp: 36.8, pain: 8, glucose: 182, o2: 'RA' },
    documentedAllergies: 'NKDA',
    documentedHomeMeds: [
      { name: 'Metformin', dose: '1000 mg', sig: 'PO BID' },
      { name: 'Lisinopril', dose: '20 mg', sig: 'PO daily' },
      { name: 'Atorvastatin', dose: '40 mg', sig: 'PO nightly' },
    ],
    problemList: ['Hypertension', 'Type 2 diabetes mellitus', 'Hyperlipidemia', 'Tobacco use disorder'],
    encounters: [
      { id: 'enc_k1', date: '2023-09-14', type: 'ED visit', department: 'Emergency', reason: 'Low back pain', summary: 'Mechanical low back pain after lifting a tire. Neuro intact. NSAIDs, discharged. A1c 8.1%.' },
    ],
    priorLabs: [
      { analyte: 'creat', value: 0.91, daysAgo: 1150 },
      { analyte: 'a1c', value: 8.1, daysAgo: 1150 },
    ],
    posture: 'lie',
    // Semi-Fowler 45°: a patient with ongoing ischaemic pain rests propped up (more comfortable, less
    // breathless), and he is nauseated and has vomited once, so not flat (aspiration). His inferior/RV
    // infarct is preload-dependent: when the nitrate or the drift drops his systolic below 90, the
    // general rule lays him flat while hypotensive (server/sim/bedPosition.ts). Raising his legs is the
    // usual teaching there, but the physiology has no effect for it, so it is not shown. Flat for CPR (VF).
    bed: { headDeg: 45 },
    initialEmotion: 'pain',
  },
  truth: {
    allergies: [],
    diagnosis: {
      label: 'Acute inferior ST-elevation myocardial infarction with right-ventricular involvement (proximal RCA occlusion)',
      icd10: 'I21.11',
      accept: ['stemi', 'st elevation myocardial infarction', 'st-elevation myocardial infarction', 'st elevation mi', 'inferior mi', 'inferior myocardial infarction', 'inferior stemi', 'inferior wall mi', 'acute myocardial infarction', 'myocardial infarction', 'heart attack', 'rca occlusion', 'right ventricular infarction', 'rv infarct', 'ami'],
      partial: ['acs', 'acute coronary syndrome', 'unstable angina', 'nstemi', 'non-st elevation', 'chest pain', 'angina', 'ischemia'],
    },
    dispositions: ['cath_lab'],
    acceptableDispositions: ['admit_icu'],
    outcomeGood: 'Mr. Keller had a 100% proximal RCA occlusion opened with a drug-eluting stent. RV function recovered; he went home on day 4 on dual antiplatelet therapy, a high-intensity statin and a smoking-cessation plan.',
    outcomeBad: 'Reperfusion was delayed. Mr. Keller developed cardiogenic shock from right-ventricular failure and needed vasopressors and a prolonged ICU stay.',
  },
  persona: {
    personality: 'Stoic retired truck driver who minimizes symptoms ("probably just heartburn, Doc"), gruff humor, hates hospitals, worried about missing his grandson\'s baseball game. Becomes quieter and scared if he gets worse.',
    voice: 'Short, plain sentences, working-class Midwestern American; calls the doctor "Doc".',
    healthLiteracy: 'average',
    opening: "Doc, it's like an elephant's sitting on my chest. Probably just heartburn, but Linda made me come in.",
    facts: [
      { id: 'onset', label: 'Onset at rest ~30 min before arrival', key: true, text: 'It started around quarter to ten, while I was sitting on the couch watching the game. I wasn\'t doing anything.', keywords: ['when', 'start', 'began', 'onset', 'doing', 'how long', 'time'] },
      { id: 'character', label: 'Pressure-type pain 8/10', key: true, text: "It's a pressure, a heavy squeezing, like an elephant sitting on me. About an 8 out of 10. It hasn't let up.", keywords: ['describe', 'feel', 'like', 'pressure', 'sharp', 'scale', 'severity', 'character', 'type', 'kind', 'rate', 'bad'] },
      { id: 'radiation', label: 'Radiation to left arm and jaw', key: true, text: 'It goes down my left arm and up into my jaw.', keywords: ['radiate', 'spread', 'go anywhere', 'arm', 'jaw', 'neck', 'back', 'travel'] },
      { id: 'associated', label: 'Diaphoresis and nausea', text: "I'm sweating buckets and sick to my stomach. Threw up once in the car.", keywords: ['sweat', 'nausea', 'vomit', 'sick', 'throw up', 'other symptoms'] },
      { id: 'exertional', label: 'Weeks of exertional dyspnea', key: true, text: "Bit short of breath right now. Truth is, I've been getting winded walking the dog the last few weeks.", keywords: ['breath', 'breathing', 'short', 'winded', 'exercise', 'exertion', 'walking', 'weeks', 'stairs'] },
      { id: 'stress_test', label: 'Abnormal stress test 2 y ago, declined cath', key: true, text: 'Couple years back they did a treadmill heart test. Said it was abnormal and wanted to do a catheter thing. I said no thanks.', keywords: ['heart', 'stress test', 'test', 'cardiologist', 'before', 'prior', 'catheter', 'angiogram', 'cardiac history', 'heart problems'] },
      { id: 'meds', label: 'Stopped his statin months ago', key: true, text: 'Metformin for the sugar and lisinopril for the pressure. I was on a cholesterol pill but I quit it a few months ago — made my legs ache.', keywords: ['medication', 'medicine', 'meds', 'pills', 'take', 'statin', 'cholesterol', 'prescription'] },
      { id: 'pde5', label: 'Sildenafil ~6 h ago (nitrate contraindication)', key: true, text: '...Yeah, okay. I took one of those blue pills — sildenafil — this afternoon around four. Don\'t make a big deal of it in front of Linda.', keywords: ['viagra', 'sildenafil', 'cialis', 'tadalafil', 'erectile', 'erection', 'sexual', 'other medications', 'anything else', 'pde5', 'blue pill', 'other pills', 'over the counter'] },
      { id: 'allergies', text: 'No allergies.', keywords: ['allerg'] },
      { id: 'pmh', text: 'High blood pressure, sugar diabetes, cholesterol. That\'s about it.', keywords: ['medical', 'problems', 'history', 'conditions', 'diabetes', 'pressure', 'illness'] },
      { id: 'smoking', label: 'Active smoker, 46 pack-years', text: 'I smoke, about a pack a day since I was eighteen.', keywords: ['smoke', 'cigarette', 'tobacco', 'vape'] },
      { id: 'alcohol', text: 'A few beers on the weekend.', keywords: ['alcohol', 'drink', 'beer', 'wine'] },
      { id: 'drugs', text: 'No drugs. Never.', keywords: ['drugs', 'cocaine', 'marijuana', 'meth', 'recreational'] },
      { id: 'family', label: 'Father MI at 58', text: 'My dad dropped dead of a heart attack at fifty-eight.', keywords: ['family', 'father', 'dad', 'mother', 'mom', 'brother', 'genetic', 'runs in'] },
      { id: 'bleeding', label: 'No bleeding/stroke contraindications', text: 'No bleeding problems, no stomach ulcers, never had a stroke. Had my knee scoped years ago, that\'s the only surgery.', keywords: ['bleed', 'bleeding', 'ulcer', 'stroke', 'surgery', 'operation', 'blood thinner', 'contraindication'] },
      { id: 'pleuritic', text: "It doesn't change when I breathe or move. Doesn't hurt to press on my chest.", keywords: ['breathe in', 'deep breath', 'position', 'move', 'press', 'tender', 'pleuritic', 'worse with'] },
      { id: 'tearing', text: "Tearing? No, it's more of a squeezing. Not going through to my back.", keywords: ['tearing', 'ripping', 'back pain', 'between shoulder'] },
    ],
    unknowns: ['his diagnosis', 'test results', 'details of the old stress test beyond "abnormal"', 'his cholesterol numbers'],
    behavior: [
      'Volunteer only the chest pressure and that his wife made him come; reveal other facts only when asked a relevant question.',
      'You are embarrassed about the sildenafil: only admit it if specifically asked about erectile-dysfunction pills, Viagra, or "any other pills/medications, even ones you take occasionally". If your wife Linda is in the room, hesitate and lower your voice.',
      'If the doctor explains you are having a heart attack and need an emergency catheterization, you are scared but agree after one question ("Is this the catheter thing they wanted to do before?").',
      'If you receive nitroglycerin, you feel light-headed and nauseated within minutes.',
    ],
    capacity: 'intact',
    fallback: "I don't know, Doc. All I know is this pressure won't quit.",
    counseling: [
      { id: 'explain_mi', label: 'Explained heart attack + emergency catheterization', description: 'The doctor tells the patient he is having a heart attack (blocked artery) and needs an emergency cardiac catheterization/stent.', keywords: ['heart attack', 'blocked', 'artery', 'cath', 'stent', 'catheter'] },
    ],
    actions: [{ id: 'consent', description: 'Agree to the proposed procedure/treatment after your question is answered.' }],
  },
  family: {
    npcId: 'fam_linda',
    name: 'Linda Keller',
    relation: 'Wife',
    voice: VOICE_CAST.fam_linda,
    appearance: { skin: '#efc6a8', hair: '#c9a46b', hairStyle: 'bun', outfit: 'casual', outfitColor: '#7a4e7e', height: 1.62, build: 'average', age: 'old', accessories: ['glasses'] },
    persona: {
      personality: 'Anxious, talkative, frustrated with her husband for ignoring his health. Grateful for clear explanations.',
      voice: 'Rapid, worried; tends to over-share.',
      healthLiteracy: 'average',
      opening: "He went white as a sheet during the game and started sweating. I told him we're going to the hospital, no arguments!",
      facts: [
        { id: 'l_onset', label: 'Collateral: onset pale/diaphoretic', text: 'He went white as a sheet and broke out in a sweat during the game, maybe a quarter to ten.', keywords: ['when', 'happened', 'start', 'onset', 'what happened'] },
        { id: 'l_stress', label: 'Abnormal stress test 2 y ago, declined cath', key: true, text: 'Two years ago Dr. Cole sent him for a stress test. It was abnormal and the cardiologist wanted to do an angiogram. He flat-out refused.', keywords: ['heart', 'test', 'stress', 'cardiologist', 'history', 'before', 'angiogram', 'cath'] },
        { id: 'l_statin', label: 'Collateral: stopped statin', text: 'He stopped his cholesterol pill months ago. Said it made his legs ache. I told him to call Dr. Cole.', keywords: ['medication', 'meds', 'pills', 'statin', 'cholesterol'] },
        { id: 'l_sob', text: "He's been huffing and puffing walking the dog for weeks.", keywords: ['breath', 'walking', 'weeks', 'tired', 'exercise'] },
        { id: 'l_family', text: 'His father died of a heart attack in his fifties.', keywords: ['family', 'father', 'dad'] },
      ],
      unknowns: ['the sildenafil (she does not know he takes it)', 'medical details she was not told'],
      behavior: ['If asked to step out, you agree reluctantly.', 'If nobody updates you for a long time, ask what is happening.'],
      capacity: 'intact',
      fallback: "I don't know, he never tells me anything!",
      counseling: [{ id: 'l_update', label: 'Updated the wife', description: 'The doctor explains to the wife what is happening and the plan.', keywords: ['heart attack', 'cath', 'plan', 'stent'] }],
      actions: [{ id: 'step_out', description: 'Leave the room for a while when the doctor asks for privacy.' }],
    },
  },
  phoneContacts: [
    {
      contact: { id: 'gp_cole', name: 'Lakeside Family Practice', role: "PCP office (Dr. Miriam Cole) — after-hours line", org: 'External', phone: '555-0131', kind: 'external' },
      requiresIdentifiers: true,
      openingVoice: { id: 'af_aoede' }, // answering service
      voice: { id: 'am_liam', speed: 0.94 }, // Dr. Felix Brandt, woken up
      persona: {
        personality: 'After-hours answering service that patches you to the on-call partner, Dr. Felix Brandt — tired but helpful.',
        voice: 'First the answering service script, then a sleepy physician.',
        healthLiteracy: 'high',
        opening: "Lakeside Family Practice after-hours service. Is this a physician calling? I can page Dr. Brandt, who's covering for Dr. Cole.",
        facts: [
          { id: 'gp_stress', label: 'Abnormal stress test 2 y ago, declined cath', key: true, text: 'February 2024 exercise treadmill test: 1.5 mm horizontal ST depression in II, III and aVF at 7 METs with chest tightness. Cardiology recommended coronary angiography; he declined.', keywords: ['stress', 'test', 'cardiology', 'heart', 'history', 'ischemia'] },
          { id: 'gp_statin', text: 'Atorvastatin 40 was stopped by the patient in July for myalgias; we planned a rechallenge.', keywords: ['statin', 'medication', 'meds', 'atorvastatin'] },
          { id: 'gp_labs', text: 'Last A1c 8.4% in August. LDL 162 off the statin.', keywords: ['labs', 'a1c', 'ldl', 'cholesterol'] },
        ],
        unknowns: ['anything about tonight'],
        behavior: ['Ask for the patient name and date of birth before sharing any information.'],
        capacity: 'intact',
        fallback: "I'd have to check the chart for that, and I don't see it here.",
      },
    },
  ],
  consults: [
    {
      contactId: 'cards',
      criteria:
        'Activate the cath lab (accept) if the caller describes ST elevation in the inferior leads (II, III, aVF) or calls it a STEMI with ongoing symptoms. Ask: time of symptom onset, ECG findings, blood pressure/heart rate, aspirin given, contraindications to anticoagulation, right-sided leads. If told about hypotension or sildenafil, warn: no nitrates, small fluid boluses for RV infarct. Recommend: aspirin 324 mg if not given, heparin 70–100 U/kg bolus per cath lab, ticagrelor can wait for the lab.',
      guard: { type: 'any', rules: [{ type: 'ecg_signed' }, { type: 'order', codes: ['ecg12'] }] },
      onAccept: {
        tag: 'reperfusion',
        tagAfterMin: 45,
        dispo: 'cath_lab',
        service: 'Interventional cardiology',
        departAfterMin: 20,
        note: { title: 'Cardiology — cath lab activation', text: 'STEMI alert accepted by cardiology fellow. Cath lab team activated; ETA 20 min. Recommend ASA 324 mg, UFH bolus per cath lab protocol. Avoid nitrates (RV involvement / recent PDE5 inhibitor).' },
        page: 'Cath lab team activated — they will pick up {bed} in ~20 minutes.',
      },
      declineHint: 'Fellow asks what the ECG actually shows before activating the lab.',
    },
    {
      contactId: 'icu',
      criteria: 'ICU fellow will say this patient needs the cath lab first (call cardiology), but will accept post-PCI if cardiology asks. Do not accept primary admission instead of reperfusion.',
      onAccept: { dispo: 'admit_icu', service: 'Cardiac ICU' },
      declineHint: 'Sounds like a STEMI — call cardiology for the cath lab first.',
    },
  ],
  physiology: {
    baseline: { hr: 56, sbp: 104, dbp: 66, rr: 20, spo2: 95, temp: 36.8, pain: 8, gcs: 15, glucose: 182, lactate: 1.9, creat: 1.02 },
    drift: { hr: -2, sbp: -5, dbp: -3, spo2: -0.4, pain: 0.2, lactate: 0.2 },
    limits: { hr: [30, 150], sbp: [55, 180], dbp: [30, 110], spo2: [80, 100], pain: [0, 10], lactate: [0.6, 9] },
    noise: { hr: 2, sbp: 3, dbp: 2, rr: 1, spo2: 0.6, temp: 0.1 },
    effects: [
      { tag: 'nitrate', onsetMin: 2, tauMin: 3, durationMin: 35, delta: { sbp: -34, dbp: -18, hr: 6, pain: -1 }, harm: { flag: 'nitrate_rv', page: '{bed} BP just dropped to the 70s after the nitro — he is gray, clammy and nauseated!' } },
      { tag: 'opioid', onsetMin: 4, tauMin: 5, durationMin: 120, delta: { pain: -3, sbp: -6, rr: -2 } },
      { tag: 'fluids', onsetMin: 3, tauMin: 15, delta: { sbp: 12, dbp: 5, hr: 2 }, maxUnits: 2 },
      { tag: 'beta_blocker', onsetMin: 3, tauMin: 6, durationMin: 240, delta: { hr: -14, sbp: -16, dbp: -8 }, harm: { flag: 'beta_blocker_brady', page: '{bed} heart rate is in the low 40s and pressure is dropping after the metoprolol!' } },
      { tag: 'ccb', onsetMin: 3, tauMin: 6, durationMin: 180, delta: { hr: -10, sbp: -18, dbp: -10 }, harm: { flag: 'ccb_brady' } },
      { tag: 'oxygen', onsetMin: 1, tauMin: 3, delta: { spo2: 3 } },
      { tag: 'pressor', onsetMin: 2, tauMin: 4, delta: { sbp: 22, dbp: 12, hr: 5 } },
      { tag: 'antiemetic', onsetMin: 5, tauMin: 5, durationMin: 240, delta: {} },
      { tag: 'reperfusion', onsetMin: 0, tauMin: 20, delta: { pain: -6, sbp: 10, hr: 14, lactate: -0.6 }, driftMult: { sbp: 0, dbp: 0, hr: 0, pain: 0, lactate: 0, spo2: 0 } },
    ],
    triggers: [
      { id: 'k_hypotension', when: { var: 'sbp', op: '<', value: 86 }, page: { from: 'nurse', text: '{bed} (Keller) BP is {sbp}/{dbp}, HR {hr}. He looks gray.', priority: 'critical' }, emotion: 'drowsy' },
      { id: 'k_nsvt', when: { afterMin: 75, unlessTag: 'reperfusion' }, page: { from: 'nurse', text: '{bed} (Keller) just had a 12-beat run of V-tach on the monitor — self-terminated. Still has chest pain.', priority: 'critical' }, driftAdd: { sbp: -6 }, flag: 'nsvt' },
      { id: 'k_vf', when: { afterMin: 165, unlessTag: 'reperfusion' }, page: { from: 'nurse', text: 'CODE BLUE {bed} — V-fib! Shocked once, ROSC after 2 minutes. He needs the cath lab NOW.', priority: 'critical' }, jump: { sbp: -15, gcs: -4 }, flag: 'vf_arrest' },
    ],
  },
  labs: {
    trop: { kind: 'sigmoid', base: 9, peak: 4200, t50Min: 330, widthMin: 80 },
    ck: { kind: 'sigmoid', base: 110, peak: 2600, t50Min: 420, widthMin: 100 },
    wbc: 11.6, rbc: 4.9, hgb: 14.6, hct: 43.5, mcv: 89, plt: 228, neut: 74, bands: 1, lymph: 18, mono: 6, eos: 1,
    na: 137, k: 4.3, cl: 101, hco3: 22, bun: 18, creat: { var: 'creat' }, glu: { var: 'glucose' }, ca: 9.2, agap: 14, mg: 1.9, phos: 3.4,
    tprot: 7.1, alb: 4.1, tbili: 0.7, dbili: 0.2, alp: 82, ast: 48, alt: 31,
    pt: 12.4, inr: 1.0, ptt: 29, fib: 330,
    lactate: { var: 'lactate' }, ph_v: 7.34, pco2_v: 44, hco3_v: 23,
    ntprobnp: 410, ddimer: 0.42, crp: 6, pct: 0.05,
    chol: 251, ldl: 168, hdl: 34, tg: 245, a1c: 8.4, tsh: 1.9, ft4: 1.2,
    glu_poc: { var: 'glucose' },
    lipase: 34, etoh: 0, uds: 'Negative for all classes tested',
    abo: 'A positive', abscreen: 'Negative',
  },
  imaging: {
    xr_chest_port: { findings: 'Portable AP chest. Heart size upper normal for technique. No pulmonary vascular congestion or edema. No focal consolidation, effusion or pneumothorax. Mediastinum not widened.', impression: 'No acute cardiopulmonary process.', imageKey: 'cxr_normal' },
    xr_chest: { findings: 'PA and lateral chest. Normal heart size. Clear lungs. No effusion or pneumothorax. Mediastinal contour normal.', impression: 'No acute cardiopulmonary process.', imageKey: 'cxr_normal' },
    cta_aorta: { findings: 'No aortic dissection or intramural hematoma. Mild calcified atherosclerosis of the aortic arch and infrarenal aorta. Coronary artery calcification. No pulmonary embolism to the segmental level.', impression: 'No acute aortic syndrome.', imageKey: 'ct_chest' },
    cta_chest: { findings: 'No pulmonary embolism. Coronary calcifications. Lungs clear.', impression: 'No PE.', imageKey: 'ct_chest' },
    ct_head: { findings: 'No acute intracranial abnormality.', impression: 'Negative head CT.', imageKey: 'ct_head' },
  },
  ecg: {
    autoAtMin: 4,
    params: { rate: 56, rhythm: 'sinus', pr: 184, qrs: 94, qt: 430, axis: 55, st: { II: 2.5, III: 3.5, aVF: 3.0, I: -1.0, aVL: -2.0, V2: -0.5, V1: 0.5 }, seed: 11 },
    machineRead: 'Sinus bradycardia, rate 56. ST elevation inferior leads (II, III, aVF), reciprocal ST depression I, aVL. ***ACUTE MI / STEMI***',
    readKeywords: ['stemi', 'st elevation', 'st-elevation', 'ste ', 'inferior mi', 'inferior infarct', 'inferior stemi', 'acute mi', 'injury', 'infarct'],
    rightSided: {
      params: { rate: 58, rhythm: 'sinus', pr: 184, qrs: 94, qt: 430, axis: 55, st: { II: 2.5, III: 3.5, aVF: 3.0, I: -1.0, aVL: -2.0, V4R: 1.5 }, rightSided: true, seed: 12 },
      machineRead: 'Right-sided leads: ST elevation 1.5 mm in V4R — consistent with right-ventricular infarction.',
    },
  },
  exam: {
    ...kellerExam,
    skin_inspect: [
      { text: 'Cool, clammy, ashen skin. Mottling over both knees.', when: { var: 'sbp', op: '<', value: 85 } },
      { text: kellerExam.skin_inspect },
    ],
  },
  scoring: {
    dxPoints: 20,
    dispoPoints: 15,
    historyPoints: 10,
    secondaryDx: [{ label: 'Right-ventricular involvement recognized', keywords: ['rv ', 'right ventric', 'rv infarct', 'rv involvement', 'v4r'], points: 5 }],
    critical: [
      { id: 'ecg10', label: 'ECG reviewed and signed within 10 min of the tech handing it over (door-to-ECG ≤ 10 min)', points: 15, rule: { type: 'ecg_signed', withinMin: 15 }, teaching: 'Every chest-pain patient needs a 12-lead ECG interpreted by a physician within 10 minutes of arrival.' },
      { id: 'ecg_read', label: 'Recognized inferior STEMI on the ECG', points: 10, rule: { type: 'ecg_read' } },
      { id: 'cath', label: 'Cath lab activated — cardiology accepted (door-to-activation ≤ 30 min)', points: 25, rule: { type: 'consult', contactId: 'cards', withinMin: 40 }, teaching: 'Activate from the ED on the ECG alone — do not wait for troponin.' },
      { id: 'asa', label: 'Aspirin 162–325 mg chewed', points: 10, rule: { type: 'given', tags: ['aspirin'], withinMin: 60 } },
      { id: 'right_ecg', label: 'Right-sided ECG (V4R) in inferior STEMI', points: 10, rule: { type: 'order', codes: ['ecg_right'] } },
      { id: 'anticoag', label: 'Anticoagulation for primary PCI (UFH)', points: 5, rule: { type: 'given', tags: ['anticoagulant'] } },
      { id: 'monitor', label: 'Cardiac monitor + IV access', points: 5, rule: { type: 'all', rules: [{ type: 'order', codes: ['monitor'] }, { type: 'order', codes: ['iv_access'] }] } },
    ],
    harms: [
      { id: 'nitro', label: 'Nitroglycerin given in RV infarction / after a PDE5 inhibitor', penalty: 20, rule: { type: 'given', tags: ['nitrate'] }, teaching: 'RV infarction is preload-dependent and sildenafil within 24 h potentiates nitrate hypotension — both are contraindications.' },
      { id: 'bb', label: 'IV beta-blocker ordered in bradycardic, hypotensive inferior STEMI', penalty: 15, rule: { type: 'given', tags: ['beta_blocker'] }, teaching: 'COMMIT: early IV metoprolol increased cardiogenic shock, especially in patients with low BP/heart rate.' },
      { id: 'discharge', label: 'Discharged a STEMI', penalty: 40, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'STEMI requires emergent reperfusion.' },
    ],
    lowValue: [
      { codes: ['cta_aorta', 'cta_chest'], penalty: 8, why: 'CT angiography without features of dissection/PE delays reperfusion in a classic STEMI.' },
      { codes: ['ddimer'], penalty: 4, why: 'D-dimer has no role when the ECG shows STEMI.' },
      { codes: ['ct_head'], penalty: 6, why: 'No neurologic indication for head CT.' },
      { codes: ['ntprobnp', 'pct', 'crp'], penalty: 2, why: 'Does not change emergent management of STEMI.' },
    ],
  },
  items: [
    {
      id: 'keller_medbag',
      kind: 'medBag',
      label: "Pharmacy bag with Robert's medications (his wife brought it from home)",
      where: 'chair',
      text:
        'Lisinopril 20 mg (daily), metformin 1000 mg (twice daily) — and a pharmacy box of SILDENAFIL 100 mg, dispensed 9 days ago, 2 of 4 tablets left: worth asking when he last took one. No atorvastatin in the bag (the last refill was in June).',
      facts: ['meds'],
      arrivesWith: 'family',
    },
  ],
  // bedside ultrasound (server/sim/pocus.ts): RV infarction at POCUS level (dilated, hypokinetic RV; plethoric IVC; dry lungs)
  pocus: {
    cardiac: {
      text: 'No pericardial effusion. The right ventricle is dilated (as large as the left at the base) and its free wall barely moves. The left ventricle squeezes well overall in this view (its inferior wall is better judged in parasternal views). Slow and regular, about {rate}/min. With the plethoric IVC and A-line lungs, this fits right ventricular infarction.',
    },
    ivc: {
      text: 'IVC plethoric: 2.4 cm with less than 20% collapse on inspiration. High right atrial pressure, matching the raised JVP.',
    },
    lung: {
      text: 'Lung sliding with A-lines, no B-lines: no pulmonary oedema. A dry lung with a full IVC points to the right ventricle, not the left.',
    },
    aorta: {
      text: 'Abdominal aorta 2.1 cm outer wall to outer wall, with a little wall calcification; no aneurysm, no flap seen. The IVC to its right is full.',
    },
  },
  teaching: [
    'Door-to-ECG ≤ 10 min; primary PCI with first-medical-contact-to-device ≤ 90 min. Activate the cath lab from the ED on the ECG — don\'t wait for troponin.',
    'Inferior STEMI (II, III, aVF) with ST elevation III > II and reciprocal depression in aVL suggests RCA occlusion — record right-sided leads: ≥ 1 mm ST elevation in V4R indicates RV infarction.',
    'RV infarction is preload-dependent: avoid nitrates, diuretics and excess opioids; treat hypotension with cautious fluid boluses. Classic triad: hypotension, raised JVP, clear lungs.',
    'Always ask about PDE5 inhibitors before nitrates (sildenafil/vardenafil within 24 h, tadalafil within 48 h).',
    'Bradycardia and hypotension are contraindications to early IV beta-blockade in acute MI (COMMIT).',
  ],
  references: [
    'Byrne RA, et al. 2023 ESC Guidelines for the management of acute coronary syndromes. Eur Heart J. 2023;44:3720–3826.',
    'Rao SV, O\'Donoghue ML, et al. 2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes. Circulation. 2025.',
    'COMMIT Collaborative Group. Early intravenous then oral metoprolol in 45 852 patients with acute myocardial infarction. Lancet. 2005;366:1622–1632.',
  ],
};

import { brunnerExam } from '../../shared/tourExams';
import { VOICE_CAST } from '../../shared/voiceCast';
import { legacy } from './provenance';
import type { CaseDef } from '../types';

export const urosepsis: CaseDef = {
  specialty: 'infectious diseases', provenance: legacy('urosepsis'),
  id: 'urosepsis_esbl',
  title: 'Urosepsis (pyelonephritis) in a delirious older adult with prior ESBL E. coli',
  summary: '81F brought in confused; she cannot give a history. Collateral from daughter + GP reveals urinary symptoms, an anticholinergic, and a prior ESBL culture that changes antibiotic choice.',
  difficulty: 2,
  patient: {
    firstName: 'Margarethe',
    lastName: 'Brunner',
    sex: 'F',
    age: 81,
    dob: '1945-02-11',
    mrn: '00311057',
    weightKg: 58,
    heightCm: 160,
    language: 'English (native Swiss German)',
    appearance: { skin: '#f0d2bd', hair: '#e8e8e8', hairStyle: 'bun', outfit: 'gown', outfitColor: '#9cc3d5', height: 1.6, build: 'slim', age: 'old', accessories: ['glasses'] },
    pcp: { name: 'Dr. Alan Whitfield', practice: 'Maple Street Family Medicine', phone: '555-0142', contactId: 'gp_whitfield' },
    insurance: { payer: 'Medicare Part A/B + Harbor Medigap', memberId: '1EG4-TE5-MK72', plan: 'Medigap G', contactId: 'ins_medicare' },
    emergencyContact: { name: 'Sabine Brunner', relation: 'Daughter (healthcare proxy)', phone: '555-0188', contactId: 'fam_sabine_phone' },
    codeStatus: 'Full code (presumed — not yet discussed)',
    voice: VOICE_CAST.pt_p_brunner,
  },
  presentation: {
    chiefComplaint: 'Confusion, weakness',
    dischargeMobility: 'wheelchair',
    arrivalMode: 'EMS',
    esi: 2,
    emsNote:
      'Medic 14: 81F found by neighbor at ~21:15 sitting in kitchen, confused, not oriented to time. Neighbor states she was "fine two days ago". Skin warm. BP 98/60, HR 108, RR 22, SpO2 95% RA, CBG 212. 18G L antecubital, 250 mL NS en route. Daughter notified by neighbor, on her way from work.',
    triageNote:
      '81F BIBA with acute confusion. Oriented to self only. Unable to provide reliable history. Per EMS neighbor found her confused, baseline unknown. Daughter (Sabine) en route. Hx per old records: HTN, DM2, CKD 3b, OA. ESI 2.',
    triageVitals: { hr: 112, sbp: 94, dbp: 56, rr: 24, spo2: 94, temp: 38.7, pain: 3, gcs: 14, glucose: 212, o2: 'RA' },
    documentedAllergies: [{ substance: 'Penicillin', reaction: 'Hives (childhood)', severity: 'mild' }],
    documentedHomeMeds: [
      { name: 'Metformin', dose: '500 mg', sig: 'PO BID' },
      { name: 'Lisinopril', dose: '10 mg', sig: 'PO daily' },
      { name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' },
      { name: 'Aspirin', dose: '81 mg', sig: 'PO daily' },
    ],
    problemList: ['Hypertension', 'Type 2 diabetes mellitus', 'Chronic kidney disease stage 3b', 'Osteoarthritis of knees'],
    encounters: [
      { id: 'enc_b1', date: '2024-11-03', type: 'ED visit', department: 'Emergency', reason: 'Mechanical fall', summary: 'Tripped on a rug, ground-level fall. Hip/wrist X-rays negative. Cognition intact, independent at home. Creatinine 1.3 mg/dL (eGFR ~39). Discharged with PT referral.' },
    ],
    priorLabs: [
      { analyte: 'creat', value: 1.3, daysAgo: 733 },
      { analyte: 'hgb', value: 12.4, daysAgo: 733 },
      { analyte: 'na', value: 139, daysAgo: 733 },
      { analyte: 'k', value: 4.6, daysAgo: 733 },
    ],
    posture: 'lie',
    // Head up 35° with aspiration precautions (30–45°): 81, delirious and drowsy, febrile and tachypnoeic,
    // so at high risk of aspirating if flat. While hypotensive the general rule lays her flat
    // (server/sim/bedPosition.ts): a trade-off against that risk, so back to 35° as soon as the pressure
    // responds to fluids. Raising her legs is the usual teaching, not shown (no physiology for it). Flat
    // while the urinary catheter goes in.
    bed: { headDeg: 35 },
    initialEmotion: 'confused',
  },
  truth: {
    allergies: [{ substance: 'Penicillin', reaction: 'Hives (childhood)', severity: 'mild' }],
    diagnosis: {
      label: 'Sepsis due to acute pyelonephritis (prior ESBL E. coli), with acute kidney injury and delirium',
      // sepsis with organ dysfunction (AKI, encephalopathy) codes R65.20 (ICD-10-CM I.C.1.d); delirium due to it F05; ESBL Z16.12
      icd10: 'A41.51 / R65.20 / N10 / N17.9 / F05 / Z16.12',
      accept: ['sepsis', 'urosepsis', 'septic shock', 'pyelonephritis', 'sepsis due to uti', 'sepsis secondary to uti', 'uti with sepsis', 'urinary sepsis', 'sepsis from urinary', 'severe sepsis', 'esbl'],
      partial: ['uti', 'urinary tract infection', 'cystitis', 'delirium', 'encephalopathy', 'sirs', 'aki', 'infection', 'dehydration'],
    },
    dispositions: ['admit_stepdown', 'admit_icu'],
    acceptableDispositions: ['admit_telemetry', 'admit_floor'],
    outcomeGood: 'Mrs. Brunner\'s blood cultures grew ESBL-producing E. coli, susceptible to meropenem. Her delirium cleared by day 3, creatinine returned to 1.3, and she went home with her daughter after completing IV therapy.',
    outcomeBad: 'Mrs. Brunner progressed to septic shock requiring norepinephrine; the initial antibiotic did not cover her ESBL organism and she spent five days in the ICU.',
  },
  persona: {
    personality: 'Frail 81-year-old retired seamstress, originally from Switzerland. Normally sharp, polite and proud; tonight acutely delirious: drowsy, then briefly agitated, picking at the sheets, easily distracted.',
    voice: 'Short, drifting sentences; mixes in Swiss German ("Grüezi", "Wo bin ich?", "es brennt", "Mausi"); loses the thread mid-sentence.',
    healthLiteracy: 'low',
    opening: 'Grüezi... who are you? I have to go home, Mausi has not eaten...',
    facts: [
      { id: 'g_name', text: 'I am Margarethe... Greta. Brunner.', keywords: ['name', 'who are you', 'call you'] },
      { id: 'g_orientation', text: 'It is... 1987? I must go home and feed Mausi. Where is my handbag?', keywords: ['year', 'date', 'day', 'where are you', 'know where', 'hospital', 'orient', 'month', 'president'] },
      { id: 'g_burning', label: 'Patient: dysuria (if asked directly)', text: 'Es brennt... it burns, when I go to the toilet. And I must go all the time.', keywords: ['pee', 'urine', 'urinate', 'toilet', 'burn', 'bathroom', 'water', 'bladder'] },
      { id: 'g_back', text: 'Here, my back on this side... it hurts. Don\'t press!', keywords: ['pain', 'hurt', 'back', 'side', 'flank', 'where does it hurt'] },
      { id: 'g_chills', text: 'I am so cold... then so hot. Why is it so cold here?', keywords: ['fever', 'hot', 'cold', 'chills', 'shiver', 'temperature'] },
      { id: 'g_allergy_wrong', text: 'Allergies? No, no... I don\'t think so.', keywords: ['allerg'] },
      { id: 'g_meds_unknown', text: 'My pills? Sabine knows. The white ones... and the little round one.', keywords: ['medication', 'meds', 'pills', 'take', 'medicine'] },
    ],
    unknowns: ['her medications', 'her medical history details', 'her allergies (she wrongly denies them)', 'the date', 'why she is here'],
    behavior: [
      'You are delirious: answer vaguely, drift off-topic, sometimes answer a different question. Your history is unreliable.',
      'Only mention burning urination if asked directly about urination/the toilet; only mention back pain if asked about pain.',
      'When asked about allergies you wrongly say you have none (you are in fact allergic to penicillin).',
      'Intermittently ask for your daughter Sabine or your cat Mausi; sometimes slip into Swiss German.',
      'If your condition is worse (situation says lower blood pressure/drowsy), answer only with a few mumbled words.',
    ],
    capacity: 'impaired',
    fallback: 'Was? ... I don\'t understand. Where is Sabine?',
  },
  family: {
    npcId: 'fam_sabine',
    name: 'Sabine Brunner',
    relation: 'Daughter (healthcare proxy)',
    voice: { id: 'af_kore' },
    arrivesAtMin: 42,
    appearance: { skin: '#f0cdb4', hair: '#7a5230', hairStyle: 'long', outfit: 'casual', outfitColor: '#2f4a6b', pantsColor: '#2b2b2b', height: 1.7, build: 'slim', age: 'adult', accessories: ['glasses'] },
    persona: {
      personality: 'Worried daughter who came straight from her late shift as a pharmacist tech; initially upset that nobody called her, calms down when updated with a clear plan. Organized, knows her mother\'s meds.',
      voice: 'Direct, articulate, slightly shaky; asks "what does that mean?" for jargon.',
      healthLiteracy: 'high',
      opening: "I'm Sabine, her daughter. Is she okay? The neighbor called me — Mom is never confused, she does her crosswords every morning!",
      facts: [
        { id: 's_baseline', label: 'Collateral: baseline cognition intact (acute change)', key: true, text: 'Mom is normally completely sharp. She lives alone, does her own shopping, does the crossword in ink. This confusion is brand new since yesterday evening.', keywords: ['baseline', 'normal', 'usually', 'before', 'confused', 'memory', 'dementia', 'like this', 'independent'] },
        { id: 's_urinary', label: 'Collateral: dysuria + frequency 3 days', key: true, text: 'Three days ago she told me it burned when she peed and she was running to the bathroom all the time. I told her to call Dr. Whitfield. I don\'t think she did.', keywords: ['urine', 'pee', 'bladder', 'burn', 'bathroom', 'symptoms', 'complain', 'sick'] },
        { id: 's_fever', text: 'Last night on the phone she said she was shivering and couldn\'t get warm.', keywords: ['fever', 'chills', 'shiver', 'temperature', 'hot'] },
        { id: 's_intake', text: 'She has barely eaten or drunk anything for two days.', keywords: ['eat', 'drink', 'fluids', 'intake', 'appetite'] },
        { id: 's_meds', label: 'Collateral: oxybutynin (anticholinergic) started 2 mo ago', key: true, text: 'Metformin, lisinopril, amlodipine, baby aspirin — oh, and Dr. Whitfield started her on a bladder pill about two months ago, oxybutynin.', keywords: ['medication', 'meds', 'pills', 'take', 'prescription', 'new'] },
        { id: 's_allergy', label: 'Collateral: penicillin allergy (childhood hives)', key: true, text: 'She\'s allergic to penicillin — she got hives as a little girl in Switzerland, that\'s what she always says. She took cephalexin last year and was fine.', keywords: ['allerg', 'penicillin', 'reaction'] },
        { id: 's_uti_history', label: 'Collateral: prior "resistant" UTI', key: true, text: 'She had a bad bladder infection last spring — they said the usual antibiotics didn\'t work and she needed IV antibiotics at home for a week.', keywords: ['infection', 'before', 'uti', 'history', 'antibiotic', 'resistant', 'previous'] },
        { id: 's_goc', label: 'Goals of care / advance directive', text: 'She has a living will — I\'m her healthcare proxy. She\'d want treatment, antibiotics, all of that — but she told me she never wants to be kept alive on a breathing machine long-term.', keywords: ['code', 'resuscitate', 'living will', 'advance directive', 'wishes', 'goals', 'intubate', 'machine', 'proxy', 'dnr'] },
        { id: 's_falls', text: 'No falls that I know of. She didn\'t hit her head.', keywords: ['fall', 'head', 'trauma', 'hit'] },
      ],
      unknowns: ['lab results', 'the name of the bacteria from last spring', 'exact dates'],
      behavior: ['If nobody has updated you, ask firmly what is going on.', 'If the doctor explains the plan clearly, thank them.', 'Mention "she\'s never like this" early in the conversation (volunteer).'],
      capacity: 'intact',
      fallback: "I'm not sure — Dr. Whitfield's office would know.",
      counseling: [
        { id: 's_update', label: 'Updated the daughter on diagnosis and plan', description: 'The doctor explains to the daughter that her mother likely has a serious infection (sepsis from a kidney/urinary infection) and outlines treatment/admission.', keywords: ['infection', 'sepsis', 'antibiotic', 'admit', 'kidney'] },
        { id: 's_goc_talk', label: 'Discussed goals of care / code status', description: 'The doctor asks about advance directives, code status or her wishes regarding life support.', keywords: ['code', 'living will', 'wishes', 'resuscitat', 'intubat', 'machine'] },
      ],
    },
  },
  phoneContacts: [
    {
      contact: { id: 'gp_whitfield', name: 'Maple Street Family Medicine', role: 'PCP office (Dr. Whitfield) — after hours', org: 'External', phone: '555-0142', kind: 'external' },
      requiresIdentifiers: true,
      openingVoice: VOICE_CAST.gp_whitfield, // answering service
      voice: { id: 'bm_daniel', speed: 0.97 }, // Dr. Raj Mehta, woken up
      persona: {
        personality: 'Night answering service ("Press 2 for the on-call physician" style), then Dr. Raj Mehta, the practice\'s on-call partner — woken up, a bit gruff, but thorough once he has the chart open.',
        voice: 'Answering-service script first; then a sleepy, precise physician.',
        healthLiteracy: 'high',
        opening: 'You\'ve reached Maple Street Family Medicine after-hours. If this is a medical emergency, hang up and dial 911. If you are a clinician, I can page Dr. Mehta, who is on call for Dr. Whitfield.',
        facts: [
          { id: 'gp_esbl', label: 'GP: prior ESBL E. coli culture & susceptibilities', key: true, text: 'March this year: urine culture >100,000 E. coli, ESBL-positive — resistant to ceftriaxone, ciprofloxacin and Bactrim; susceptible to nitrofurantoin, ertapenem and meropenem. She got ertapenem by home infusion for five days.', keywords: ['culture', 'infection', 'uti', 'resistant', 'antibiotic', 'esbl', 'bacteria', 'organism', 'urine'] },
          { id: 'gp_baseline', label: 'GP: baseline creatinine & cognition', text: 'Baseline creatinine is 1.2 to 1.3. Cognition fully intact at her visit in September — she manages her own pillbox.', keywords: ['baseline', 'creatinine', 'kidney', 'cognition', 'memory', 'normal'] },
          { id: 'gp_oxy', label: 'GP: oxybutynin started', text: 'We started oxybutynin 5 mg daily in September for urge incontinence. Yes, I know — Beers list. It was a trial.', keywords: ['medication', 'meds', 'oxybutynin', 'bladder', 'new', 'list'] },
          { id: 'gp_allergy', text: 'Penicillin allergy, childhood hives. She tolerated cephalexin in 2025 without problems.', keywords: ['allerg', 'penicillin', 'cephalosporin'] },
          { id: 'gp_goc', label: 'GP: advance directive on file', text: 'Advance directive on file: full treatment, but no prolonged mechanical ventilation. Daughter Sabine is healthcare proxy.', keywords: ['code', 'advance directive', 'living will', 'wishes', 'proxy', 'dnr', 'goals'] },
        ],
        unknowns: ['what happened tonight', 'current labs'],
        behavior: [
          'Before releasing ANY patient information, require the patient\'s full name AND date of birth. If not given, politely ask for them.',
          'Offer to fax the culture report and medication list if asked or if it is useful.',
        ],
        capacity: 'intact',
        fallback: "I don't have that in front of me. I can fax you what's in the chart.",
        actions: [{ id: 'fax_records', description: 'Fax the culture report, medication list and advance directive to the ED (after the caller verified identity).' }],
      },
      phoneActions: [
        {
          id: 'fax_records',
          description: 'Fax outside records',
          note: {
            title: 'Outside records — Maple Street Family Medicine (fax)',
            type: 'Outside Records',
            author: 'Maple Street Family Medicine',
            delayMin: 12,
            text:
              'URINE CULTURE (collected 03/14/2026): >100,000 CFU/mL Escherichia coli — ESBL PRODUCER.\nAmpicillin R · Cefazolin R · Ceftriaxone R · Cefepime R · Ciprofloxacin R · TMP-SMX R · Nitrofurantoin S · Piperacillin-tazobactam I · Ertapenem S · Meropenem S\nTreated with ertapenem 1 g IV daily x5 (home infusion).\n\nMEDICATIONS: metformin 500 mg BID; lisinopril 10 mg daily; amlodipine 5 mg daily; aspirin 81 mg daily; oxybutynin 5 mg daily (started 09/2026).\nALLERGIES: penicillin (childhood urticaria); tolerated cephalexin 2025.\nBASELINE: creatinine 1.2–1.3 mg/dL; independent ADLs/IADLs; MoCA 27/30 (09/2026).\nADVANCE DIRECTIVE: full treatment; no prolonged mechanical ventilation. HCP: daughter Sabine Brunner.',
          },
          flag: 'gp_records',
        },
      ],
    },
    {
      contact: { id: 'fam_sabine_phone', name: 'Sabine Brunner (mobile)', role: 'Daughter — healthcare proxy', org: 'Family', phone: '555-0188', kind: 'external' },
      voice: { id: 'af_kore', speed: 1.06 }, // same person as the bedside Sabine, hurried
      persona: {
        personality: 'The daughter, driving to the hospital (hands-free), worried.',
        voice: 'Hurried, road noise, short answers.',
        healthLiteracy: 'high',
        opening: "Hello? This is Sabine — is this about my mom? I'm on my way, maybe half an hour.",
        facts: [
          { id: 'sp_baseline', label: 'Collateral: baseline cognition intact (acute change)', key: true, text: 'She is never confused. She does her own shopping and the crossword every day. This is new since yesterday.', keywords: ['baseline', 'normal', 'usually', 'confused', 'memory', 'dementia'] },
          { id: 'sp_urinary', label: 'Collateral: dysuria + frequency 3 days', key: true, text: 'She said three days ago it burned when she peed.', keywords: ['urine', 'pee', 'burn', 'bladder', 'symptoms'] },
          { id: 'sp_allergy', label: 'Collateral: penicillin allergy (childhood hives)', key: true, text: 'Penicillin — hives as a child.', keywords: ['allerg', 'penicillin'] },
          { id: 'sp_uti_history', label: 'Collateral: prior "resistant" UTI', key: true, text: 'She had a resistant bladder infection last spring and needed IV antibiotics at home. Dr. Whitfield\'s office would have the details.', keywords: ['infection', 'before', 'uti', 'antibiotic', 'resistant', 'history'] },
        ],
        unknowns: ['medication doses (she will tell in person)'],
        behavior: ['Keep it brief — you are driving. Say you will be there soon.'],
        capacity: 'intact',
        fallback: "I'll be there soon, can we talk then?",
      },
    },
  ],
  consults: [
    {
      contactId: 'icu',
      criteria: 'Accept to the ICU if the caller describes septic shock (MAP < 65 / SBP < 90 despite ≥ 30 mL/kg fluids, or on norepinephrine) or lactate ≥ 4 with persistent hypotension. If she is fluid-responsive and off pressors, suggest step-down via the hospitalist instead. Ask about lactate trend, fluids given, antibiotics given and timing, cultures drawn, code status.',
      guard: { type: 'any', rules: [{ type: 'flag', flag: 'septic_shock' }, { type: 'given', tags: ['pressor'] }] },
      onAccept: { dispo: 'admit_icu', service: 'Medical ICU', departAfterMin: 45, note: { title: 'ICU consult', text: 'Accepted to MICU for septic shock from pyelonephritis. Continue meropenem, norepinephrine to MAP ≥ 65, repeat lactate in 2 h.' } },
      declineHint: 'ICU fellow: "If she is not on pressors, she can go to step-down — call the hospitalist."',
    },
    {
      contactId: 'hosp',
      criteria: 'Accept to step-down (or floor if lactate cleared and BP stable) for sepsis from pyelonephritis if: cultures drawn, antibiotics started, fluids given, lactate trending down. If the patient is hypotensive on pressors, insist on ICU. Ask about antibiotic choice — if ceftriaxone was given and you hear about prior ESBL, recommend switching to meropenem/ertapenem. Ask about code status and the daughter.',
      onAccept: { dispo: 'admit_stepdown', service: 'Hospital medicine', departAfterMin: 60, note: { title: 'Hospitalist admission', text: 'Accepted to step-down unit: sepsis due to acute pyelonephritis, AKI on CKD 3b, delirium. Hold metformin/lisinopril/oxybutynin. Continue IV carbapenem pending cultures.' } },
      declineHint: 'Hospitalist wants cultures, antibiotics and a repeat lactate first.',
    },
  ],
  physiology: {
    baseline: { hr: 112, sbp: 94, dbp: 56, rr: 24, spo2: 94, temp: 38.7, pain: 3, gcs: 14, glucose: 212, lactate: 3.4, creat: 2.1 },
    drift: { hr: 6, sbp: -9, dbp: -6, rr: 1.5, spo2: -0.8, temp: 0.3, gcs: -0.6, lactate: 0.9, creat: 0.12, glucose: 6 },
    limits: { hr: [50, 165], sbp: [58, 170], dbp: [30, 100], rr: [10, 40], spo2: [80, 100], temp: [35.5, 41], gcs: [7, 15], lactate: [0.7, 12], creat: [0.8, 5], glucose: [70, 400] },
    noise: { hr: 3, sbp: 3, dbp: 2, rr: 1, spo2: 0.7, temp: 0.1 },
    effects: [
      // resuscitation: immediate preload/perfusion gain + slower hypoperfusion-driven lactate production
      { tag: 'fluids', onsetMin: 5, tauMin: 25, delta: { sbp: 11, dbp: 6, hr: -7, lactate: -0.6, creat: -0.12 }, driftMult: { sbp: 0.65, lactate: 0.5, hr: 0.7 }, maxUnits: 3 },
      // source control by an ACTIVE antibiotic reverses the trajectory (negative multipliers = recovery)
      { tag: 'abx_carbapenem', onsetMin: 30, tauMin: 40, driftMult: { hr: -0.8, sbp: -0.8, dbp: -0.8, lactate: -1.2, temp: -0.8, gcs: -1.0, creat: -0.8, rr: -0.6, spo2: -0.6, glucose: -0.5 } },
      // ESBL producer: ceftriaxone/cefepime/fluoroquinolone largely inactive; pip-tazo partially (MERINO)
      { tag: 'abx_ceftriaxone', onsetMin: 30, tauMin: 40, driftMult: { hr: 0.8, sbp: 0.8, lactate: 0.8, temp: 0.7 } },
      { tag: 'abx_cefepime', onsetMin: 30, tauMin: 40, driftMult: { hr: 0.75, sbp: 0.75, lactate: 0.75, temp: 0.7 } },
      { tag: 'abx_piptazo', onsetMin: 30, tauMin: 40, driftMult: { hr: 0.45, sbp: 0.45, lactate: 0.45, temp: 0.4, gcs: 0.5 }, harm: { flag: 'pcn_reaction', page: '{bed} (Brunner) has new hives across her chest and arms after the pip-tazo — no wheeze, BP stable. Want to stop it?', chance: 0.35 } },
      { tag: 'abx_fq', onsetMin: 30, tauMin: 40, driftMult: { hr: 0.9, sbp: 0.9, lactate: 0.9 } },
      { tag: 'abx_ampsulb', onsetMin: 30, tauMin: 40, driftMult: { hr: 0.95, sbp: 0.95, lactate: 0.95 }, harm: { flag: 'pcn_reaction', page: '{bed} (Brunner) has new hives after the Unasyn.', chance: 0.35 } },
      { tag: 'antipyretic', onsetMin: 30, tauMin: 30, durationMin: 300, delta: { temp: -0.8, hr: -4 } },
      { tag: 'pressor', onsetMin: 3, tauMin: 5, delta: { sbp: 24, dbp: 13, hr: 4 } },
      { tag: 'oxygen', onsetMin: 1, tauMin: 3, delta: { spo2: 3 } },
      { tag: 'antipsychotic', onsetMin: 10, tauMin: 10, durationMin: 240, delta: { gcs: -1 } },
      { tag: 'benzodiazepine', onsetMin: 5, tauMin: 5, durationMin: 240, delta: { gcs: -2, rr: -3 }, harm: { flag: 'benzo_delirium', page: '{bed} (Brunner) is much harder to rouse after the lorazepam, sats drifting down.' } },
    ],
    triggers: [
      { id: 'b_hypotension', when: { var: 'sbp', op: '<', value: 88 }, page: { from: 'nurse', text: '{bed} (Brunner) BP {sbp}/{dbp} (MAP {map}), HR {hr}. She is harder to wake up.', priority: 'critical' }, emotion: 'drowsy' },
      { id: 'b_shock', when: { var: 'sbp', op: '<', value: 80 }, page: { from: 'nurse', text: '{bed} (Brunner) MAP is in the 50s and she is mottled. Do you want pressors?', priority: 'critical' }, flag: 'septic_shock', driftAdd: { gcs: -0.4 } },
      { id: 'b_temp_high', when: { var: 'temp', op: '>', value: 39.3 }, page: { from: 'nurse', text: '{bed} (Brunner) is rigoring, temp {temp} °C.', priority: 'urgent' } },
    ],
  },
  labs: {
    wbc: 18.6, rbc: 3.9, hgb: 11.8, hct: 35.6, mcv: 90, plt: 142, neut: 81, bands: 9, lymph: 6, mono: 4, eos: 0,
    na: 133, k: 4.9, cl: 99, hco3: 18, bun: 42, creat: { var: 'creat' }, glu: { var: 'glucose' }, ca: 8.7, agap: 16, mg: 1.8, phos: 3.9,
    tprot: 6.4, alb: 3.1, tbili: 1.1, dbili: 0.4, alp: 98, ast: 32, alt: 24,
    pt: 13.8, inr: 1.2, ptt: 32, fib: 520,
    lactate: { var: 'lactate' }, ph_v: 7.29, pco2_v: 36, hco3_v: 17,
    crp: 186, pct: 9.8, esr: 64,
    trop: { kind: 'series', points: [[0, 21], [180, 24]] }, ck: 140, ntprobnp: 1450, ddimer: 2.1,
    ua_appear: 'Cloudy', ua_color: 'Dark yellow', ua_sg: 1.025, ua_ph: 6.5, ua_prot: '1+', ua_glu: '1+', ua_ket: 'Trace', ua_blood: '1+', ua_nit: 'Positive', ua_le: '3+', ua_wbc: 'TNTC', ua_rbc: 8, ua_bact: 'Many', ua_epi: 'Rare',
    tsh: 2.4, ft4: 1.1, a1c: 7.6, chol: 182, ldl: 96, hdl: 48, tg: 190,
    glu_poc: { var: 'glucose' }, etoh: 0, uds: 'Negative for all classes tested',
    abo: 'O positive', abscreen: 'Negative',
  },
  imaging: {
    xr_chest_port: { findings: 'Portable AP chest. Low lung volumes with bibasilar atelectasis. No focal consolidation, effusion or pneumothorax. Heart size normal for technique.', impression: 'No acute cardiopulmonary process; no pneumonia.', imageKey: 'cxr_normal' },
    xr_chest: { findings: 'No focal consolidation. Mild degenerative thoracic spine changes.', impression: 'No pneumonia.', imageKey: 'cxr_normal' },
    ct_head: { findings: 'No acute intracranial hemorrhage, mass effect or territorial infarct. Age-appropriate volume loss and chronic small-vessel ischemic change.', impression: 'No acute intracranial abnormality.', imageKey: 'ct_head' },
    us_renal: { findings: 'Right kidney 10.4 cm, mildly increased echogenicity bilaterally (medical renal disease). No hydronephrosis, no perinephric collection, no obstructing calculus. Bladder decompressed.', impression: 'No hydronephrosis or abscess.', imageKey: 'us_renal' },
    ct_abd_iv: { findings: 'Striated nephrogram and perinephric fat stranding of the right kidney. No renal or perinephric abscess, no hydronephrosis or obstructing stone. Bladder wall mildly thickened.', impression: 'Right acute pyelonephritis without abscess or obstruction.', imageKey: 'ct_abd' },
  },
  ecg: {
    autoAtMin: 20,
    params: { rate: 112, rhythm: 'sinus', pr: 150, qrs: 86, qt: 330, axis: 20, st: { V5: -0.4, V6: -0.4 }, seed: 21 },
    machineRead: 'Sinus tachycardia, rate 112. Nonspecific ST-T wave abnormality. Abnormal ECG.',
    readKeywords: ['sinus tach', 'sinus tachycardia', 'nonspecific', 'no stemi', 'no acute st'],
  },
  exam: {
    ...brunnerExam,
    skin_inspect: [
      { text: 'Hot skin; mottling over both knees. Cool fingertips.', when: { var: 'sbp', op: '<', value: 85 } },
      { text: brunnerExam.skin_inspect },
    ],
    skin_capref: [
      { text: 'Capillary refill 4–5 seconds.', when: { var: 'sbp', op: '<', value: 85 } },
      { text: brunnerExam.skin_capref },
    ],
  },
  scoring: {
    dxPoints: 20,
    dispoPoints: 10,
    historyPoints: 10,
    secondaryDx: [
      { label: 'Acute kidney injury recognized', keywords: ['aki', 'acute kidney', 'acute renal', 'kidney injury'], points: 4 },
      { label: 'Delirium recognized', keywords: ['delirium', 'encephalopathy', 'acute confusion', 'altered mental'], points: 4 },
    ],
    critical: [
      { id: 'lactate', label: 'Lactate measured within 1 h', points: 5, rule: { type: 'order', codes: ['lactate', 'vbg'], withinMin: 60 } },
      { id: 'bcx_first', label: 'Blood cultures drawn BEFORE antibiotics', points: 10, rule: { type: 'before', first: { type: 'collected', codes: ['bcx'] }, then: { type: 'given', tags: ['abx'] } } },
      { id: 'abx_1h', label: 'Antibiotics given within ~1 h of arrival', points: 15, rule: { type: 'given', tags: ['abx'], withinMin: 75 } },
      { id: 'abx_esbl', label: 'Antibiotic active against her prior ESBL E. coli (carbapenem)', points: 15, rule: { type: 'given', tags: ['abx_carbapenem'] }, teaching: 'Prior cultures predict current resistance — ceftriaxone does not cover ESBL producers.' },
      { id: 'fluids', label: '30 mL/kg crystalloid (≈1.7 L) within 3 h', points: 10, rule: { type: 'given', tags: ['fluids'], minTotalMl: 1500, withinMin: 180 } },
      { id: 'lactate_repeat', label: 'Repeat lactate (initial > 2 mmol/L)', points: 5, rule: { type: 'collected', codes: ['lactate', 'vbg'], count: 2 } },
      { id: 'pressor_if_shock', label: 'Norepinephrine for MAP < 65 despite fluids', points: 5, rule: { type: 'if', cond: { type: 'flag', flag: 'septic_shock' }, then: { type: 'given', tags: ['pressor'] } } },
      { id: 'collateral', label: 'Obtained collateral history (daughter or GP)', points: 5, rule: { type: 'fact', factIds: ['s_baseline', 's_urinary', 'sp_baseline', 'sp_urinary', 'gp_esbl', 'gp_baseline'] } },
    ],
    harms: [
      { id: 'discharge', label: 'Discharged a septic patient', penalty: 40, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'Sepsis with organ dysfunction requires admission.' },
      { id: 'benzo', label: 'Benzodiazepine for delirium in an older adult', penalty: 6, rule: { type: 'given', tags: ['benzodiazepine'] }, teaching: 'Benzodiazepines worsen delirium (except alcohol/benzodiazepine withdrawal).' },
      { id: 'pcn', label: 'Penicillin-class antibiotic despite documented penicillin allergy', penalty: 5, rule: { type: 'given', tags: ['abx_piptazo', 'abx_ampsulb'] }, teaching: 'Low-risk penicillin allergy histories rarely preclude cephalosporins or carbapenems (cross-reactivity < 1%) — those are safer choices than re-challenging a penicillin in the ED.' },
    ],
    lowValue: [
      { codes: ['ct_head'], penalty: 3, why: 'Non-focal delirium with an obvious infectious source and no fall/anticoagulation — head CT is low-yield.' },
      { codes: ['ddimer'], penalty: 3, why: 'D-dimer is nonspecifically elevated in sepsis; no PE question here.' },
      { codes: ['lipids', 'a1c', 'tsh'], penalty: 2, why: 'Not relevant to emergency management.' },
    ],
  },
  items: [
    {
      id: 'brunner_handbag',
      kind: 'handbag',
      label: "Margarethe Brunner's handbag (EMS brought it along)",
      where: 'chair',
      text:
        'A weekly pill organizer (white tablets plus one small round pill per day) with a pharmacy label: OXYBUTYNIN 5 mg once daily — started 2 months ago. Folded inside: a letter from Maple Street Family Medicine, March 2026 — "Urine culture: E. coli, ESBL-producing; resistant to ceftriaxone, ciprofloxacin and TMP-SMX; susceptible to meropenem, ertapenem and nitrofurantoin." Also house keys and a photo of a grey cat.',
      facts: ['gp_esbl', 'gp_oxy'],
      // she asks for it when disoriented (g_orientation); familiar things at hand help a delirious patient
      returnLine: "My handbag! Oh, thank you, dear. Mausi's photo is in there, you know.",
    },
  ],
  // once the ESBL culture is known (the GP's office, or the letter in her handbag). CDC (Siegel 2006/2007)
  // lists ESBL producers among the MDROs for contact precautions in acute care, subject to local policy;
  // many European hospitals (KRINKO: 3MRGN E. coli outside high-risk units) keep standard precautions.
  // Contact precautions: gown and gloves; no mask needed.
  precautions: { kind: 'contact', reason: 'Prior ESBL-producing E. coli (urine culture, March)', afterFacts: ['gp_esbl'] },
  // bedside ultrasound (server/sim/pocus.ts): kidneys as on us_renal (no hydronephrosis), a dry, hyperdynamic circulation
  pocus: {
    ruq: {
      text: "No free fluid in Morison's pouch or at the liver tip. Right kidney 10.4 cm; its cortex is a little brighter than the liver (medical renal disease, as on the formal scan). No hydronephrosis, no perinephric collection. No pleural fluid above the diaphragm.",
    },
    luq: {
      text: 'No free fluid round the spleen or in the splenorenal recess. Left kidney with the same mildly increased cortical echogenicity, no hydronephrosis. No pleural fluid above the diaphragm.',
    },
    bladder: [
      { when: { flag: 'foley' }, text: 'Catheter balloon in a decompressed bladder; hardly any urine in it.' },
      {
        text: 'Bladder nearly empty (about 40 mL): no retention. The wall looks a little thick (about 5 mm), though an underfilled bladder is hard to judge (the CT also called it mildly thickened). No debris or stones seen.',
      },
    ],
    pelvic: [
      { when: { flag: 'foley' }, text: 'Catheter balloon in an empty bladder; small postmenopausal uterus behind it. No free fluid in the rectouterine pouch.' },
      { text: 'Bladder nearly empty; small postmenopausal uterus behind it. No free fluid in the rectouterine pouch.' },
    ],
    cardiac: {
      text: 'No pericardial effusion. Small, vigorously contracting left ventricle whose walls almost meet in systole (hyperdynamic); right ventricle normal in size. Regular, rate about {rate}/min. Fits sepsis with low filling.',
    },
    ivc: [
      { when: { var: 'sbp', op: '<', value: 100 }, text: 'IVC small, 0.9 cm, collapsing almost completely with each breath (about 80%): low right atrial pressure; she is likely to respond to fluid.' },
      { text: 'IVC 1.6 cm with about 35% collapse on inspiration: better filled after fluid.' },
    ],
  },
  teaching: [
    'Sepsis = infection + organ dysfunction (ΔSOFA ≥ 2). qSOFA (RR ≥ 22, altered mentation, SBP ≤ 100) flags risk — she scored 3/3 at triage.',
    'Hour-1 bundle: lactate (repeat if > 2), blood cultures BEFORE antibiotics, broad-spectrum antibiotics, 30 mL/kg crystalloid for hypotension or lactate ≥ 4, norepinephrine for MAP < 65 despite fluids.',
    'Prior microbiology matters: with prior ESBL E. coli, ceftriaxone is likely inadequate; carbapenems are preferred (MERINO: pip-tazo inferior to meropenem for ceftriaxone-resistant E. coli/Klebsiella bacteremia).',
    'Check triage vitals for completeness — a missing temperature hides a SIRS criterion and a sepsis screen.',
    'Delirium is a medical emergency; establish baseline cognition with collateral history. Anticholinergics such as oxybutynin are Beers-list drugs that precipitate delirium.',
    'Low-risk penicillin allergy labels (remote childhood hives) rarely preclude cephalosporins or carbapenems (cross-reactivity < 1%).',
  ],
  references: [
    'Evans L, et al. Surviving Sepsis Campaign: international guidelines for management of sepsis and septic shock 2021. Crit Care Med. 2021;49:e1063–e1143.',
    'Singer M, et al. The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3). JAMA. 2016;315:801–810.',
    'Harris PNA, et al. Effect of piperacillin-tazobactam vs meropenem on 30-day mortality in E. coli or K. pneumoniae bloodstream infection and ceftriaxone resistance (MERINO). JAMA. 2018;320:984–994.',
    'American Geriatrics Society 2023 Beers Criteria Update Expert Panel. J Am Geriatr Soc. 2023;71:2052–2081.',
    'Khan DA, et al. Drug allergy: a 2022 practice parameter update. J Allergy Clin Immunol. 2022;150:1333–1393.',
  ],
};

/**
 * Mock data for UI development without a server: open the client with ?mock=1.
 * Shapes mirror exactly what the server sends (PlayerView + PatientChart).
 */
import type { Appearance, LabResultView, NpcView, PatientChart, PlayerView, VitalsEntry } from '../../../shared/types';
import { computeFlag } from '../../../shared/units';

const M = 60; // seconds per minute

const look = (o: Partial<Appearance>): Appearance => ({
  skin: '#e8b896',
  hair: '#3b2a20',
  hairStyle: 'short',
  outfit: 'scrubs',
  outfitColor: '#2f6f9f',
  height: 1.75,
  build: 'average',
  age: 'adult',
  ...o,
});

let rid = 0;
function labs(pid: string, sex: 'M' | 'F', orderId: string, collectedMin: number, resultedMin: number, values: Record<string, number | string>): LabResultView[] {
  return Object.entries(values).map(([analyte, value]) => ({
    id: `r${++rid}`,
    orderId,
    patientId: pid,
    analyte,
    value,
    collectedAt: collectedMin * M,
    resultedAt: resultedMin * M,
    flag: computeFlag(analyte, value, sex),
  }));
}

function vit(id: string, tMin: number, source: VitalsEntry['source'], v: Partial<VitalsEntry>): VitalsEntry {
  return { id, t: tMin * M, source, ...v };
}

export function mockCharts(): Record<string, PatientChart> {
  const keller: PatientChart = {
    id: 'p_keller',
    mrn: '00482913',
    name: 'Keller, Robert',
    firstName: 'Robert',
    lastName: 'Keller',
    age: 64,
    sex: 'M',
    dob: '1962-08-09',
    weightKg: 96,
    heightCm: 178,
    bed: 'bed_2',
    bedLabel: 'Bed 2',
    esi: 2,
    chiefComplaint: 'Chest pain',
    arrivedAt: 12 * M,
    arrivalMode: 'Private vehicle',
    flowStatus: 'Roomed',
    allergies: 'NKDA',
    codeStatus: 'Full code (presumed)',
    language: 'English',
    pcp: { name: 'Dr. Miriam Cole', practice: 'Lakeside Family Practice', phone: '555-0131', contactId: 'gp_cole' },
    insurance: { payer: 'Unity Health PPO', memberId: 'UHP-7730-1182', plan: 'PPO Gold', contactId: 'ins_unity' },
    emergencyContact: { name: 'Linda Keller', relation: 'Wife', phone: '555-0177', contactId: 'fam_linda' },
    homeMeds: [
      { name: 'Metformin', dose: '1000 mg', sig: 'PO BID' },
      { name: 'Lisinopril', dose: '20 mg', sig: 'PO daily' },
      { name: 'Atorvastatin', dose: '40 mg', sig: 'PO nightly' },
    ],
    problemList: ['Hypertension', 'Type 2 diabetes mellitus', 'Hyperlipidemia', 'Tobacco use disorder'],
    encounters: [{ id: 'e1', date: '2023-09-14', type: 'ED visit', department: 'Emergency', reason: 'Low back pain', summary: 'Mechanical low back pain after lifting. NSAIDs, discharged. A1c 8.1%.' }],
    vitals: [
      vit('v1', 13, 'Triage', { hr: 56, sbp: 104, dbp: 66, rr: 20, spo2: 95, temp: 36.8, pain: 8, glucose: 182, o2: 'RA', by: 'L. Novak RN' }),
      vit('v2', 30, 'Monitor', { hr: 54, sbp: 100, dbp: 62, rr: 20, spo2: 95, o2: 'RA' }),
      vit('v3', 45, 'Monitor', { hr: 52, sbp: 96, dbp: 60, rr: 22, spo2: 94, o2: 'RA' }),
    ],
    orders: [
      { id: 'o1', patientId: 'p_keller', code: 'ecg12', name: 'ECG 12-lead', category: 'ecg', priority: 'STAT', status: 'Completed', placedAt: 12 * M, placedBy: 'Protocol (triage)', completedAt: 17 * M, costUSD: 50 },
      { id: 'o2', patientId: 'p_keller', code: 'trop', name: 'Troponin T, high-sensitivity', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 20 * M, placedBy: 'You', collectedAt: 24 * M, resultedAt: 66 * M, costUSD: 40 },
      { id: 'o3', patientId: 'p_keller', code: 'bmp', name: 'Basic metabolic panel', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 20 * M, placedBy: 'You', collectedAt: 24 * M, resultedAt: 70 * M, costUSD: 30 },
      { id: 'o4', patientId: 'p_keller', code: 'aspirin', name: 'Aspirin chewable', category: 'med', params: { dose: '324 mg', route: 'PO (chewed)', frequency: 'once' }, priority: 'STAT', status: 'Given', placedAt: 21 * M, placedBy: 'You', completedAt: 27 * M, costUSD: 1 },
      { id: 'o5', patientId: 'p_keller', code: 'xr_chest_port', name: 'XR chest, portable (1 view)', category: 'imaging', priority: 'STAT', status: 'Final', placedAt: 21 * M, placedBy: 'You', completedAt: 52 * M, costUSD: 120 },
      { id: 'o6', patientId: 'p_keller', code: 'trop', name: 'Troponin T, high-sensitivity', category: 'lab', priority: 'STAT', status: 'Collected', statusText: 'Collected 01:24 — in lab', placedAt: 80 * M, placedBy: 'You', collectedAt: 84 * M, costUSD: 40 },
    ],
    labs: [
      ...labs('p_keller', 'M', 'o2', 24, 66, { trop: 78 }),
      ...labs('p_keller', 'M', 'o3', 24, 70, { na: 137, k: 4.3, cl: 101, hco3: 22, bun: 18, creat: 1.02, glu: 186, ca: 9.2, agap: 14 }),
      { id: 'h1', orderId: 'hist', patientId: 'p_keller', analyte: 'creat', value: 0.91, collectedAt: -1100 * 24 * 60 * M, resultedAt: -1100 * 24 * 60 * M, historical: true },
    ],
    imaging: [
      { id: 'i1', orderId: 'o5', patientId: 'p_keller', code: 'xr_chest_port', name: 'XR chest, portable (1 view)', modality: 'XR', status: 'Final', orderedAt: 21 * M, performedAt: 34 * M, reportedAt: 52 * M, findings: 'Portable AP chest. Heart size upper normal. No pulmonary edema, focal consolidation or pneumothorax. Mediastinum not widened.', impression: 'No acute cardiopulmonary process.', radiologist: 'Kenji Ito, MD', imageKey: 'cxr_normal' },
    ],
    ecgs: [
      {
        id: 'ecg1',
        patientId: 'p_keller',
        acquiredAt: 17 * M,
        label: '12-lead ECG',
        params: { rate: 56, rhythm: 'sinus', pr: 180, qrs: 92, qt: 420, axis: 60, st: { II: 2.5, III: 3.5, aVF: 3.0, I: -1.0, aVL: -2.0 }, seed: 7 },
        machineRead: 'Sinus bradycardia, rate 56. Inferior ST elevation — ***ACUTE MI SUSPECTED***. Reciprocal ST depression I, aVL.',
      },
    ],
    mar: [{ id: 'm1', patientId: 'p_keller', orderId: 'o4', med: 'Aspirin chewable', dose: '324 mg', route: 'PO (chewed)', t: 27 * M, by: 'T. Becker RN', status: 'Given' }],
    notes: [
      { id: 'n1', patientId: 'p_keller', t: 13 * M, type: 'Triage', author: 'Lena Novak, RN', title: 'Triage note', text: '64M c/o substernal chest pressure since ~21:45 radiating to L arm and jaw, with diaphoresis and nausea. Hx HTN, DM2, smoker. ECG obtained per protocol — to physician for review. ESI 2.' },
    ],
    diagnoses: [],
    onMonitor: true,
    ivAccess: true,
    npo: false,
    assignedNurse: 'Tom Becker, RN',
    assignedDoctor: 'You',
    alerts: ['NAME ALERT: similar name on unit — Kellner, Robert (Bed 3)'],
    version: 3,
  };

  const brunner: PatientChart = {
    ...keller,
    id: 'p_brunner',
    mrn: '00311057',
    name: 'Brunner, Margarethe',
    firstName: 'Margarethe',
    lastName: 'Brunner',
    age: 81,
    sex: 'F',
    dob: '1945-02-11',
    weightKg: 58,
    heightCm: 160,
    bed: 'bed_4',
    bedLabel: 'Bed 4',
    esi: 2,
    chiefComplaint: 'Confusion, weakness',
    arrivedAt: 4 * M,
    arrivalMode: 'EMS',
    allergies: [{ substance: 'Penicillin', reaction: 'Hives (childhood)', severity: 'mild' }],
    codeStatus: 'Full code (presumed)',
    pcp: { name: 'Dr. Alan Whitfield', practice: 'Maple Street Family Medicine', phone: '555-0142', contactId: 'gp_whitfield' },
    emergencyContact: { name: 'Sabine Brunner', relation: 'Daughter', phone: '555-0188', contactId: 'fam_sabine' },
    homeMeds: [
      { name: 'Metformin', dose: '500 mg', sig: 'PO BID' },
      { name: 'Lisinopril', dose: '10 mg', sig: 'PO daily' },
      { name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' },
      { name: 'Aspirin', dose: '81 mg', sig: 'PO daily' },
    ],
    problemList: ['Hypertension', 'Type 2 diabetes mellitus', 'CKD stage 3a', 'Osteoarthritis'],
    encounters: [{ id: 'e2', date: '2024-11-03', type: 'ED visit', department: 'Emergency', reason: 'Mechanical fall', summary: 'Ground-level fall, no fracture. Creatinine 1.3 mg/dL (eGFR 39).' }],
    vitals: [
      vit('b1', 5, 'Triage', { hr: 112, sbp: 94, dbp: 56, rr: 24, spo2: 94, pain: 3, gcs: 14, o2: 'RA', by: 'L. Novak RN', comment: 'Temp not obtained' }),
      vit('b2', 35, 'Nurse', { hr: 118, sbp: 88, dbp: 52, rr: 26, spo2: 93, temp: 38.9, gcs: 13, o2: 'RA', by: 'A. Rahman RN' }),
      vit('b3', 95, 'Nurse', { hr: 102, sbp: 104, dbp: 60, rr: 22, spo2: 95, temp: 38.2, gcs: 14, o2: '2 L NC', by: 'A. Rahman RN' }),
    ],
    orders: [
      { id: 'b_o1', patientId: 'p_brunner', code: 'lactate', name: 'Lactic acid, venous', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 10 * M, placedBy: 'You', collectedAt: 14 * M, resultedAt: 36 * M, costUSD: 20 },
      { id: 'b_o2', patientId: 'p_brunner', code: 'lactate', name: 'Lactic acid, venous', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 70 * M, placedBy: 'You', collectedAt: 74 * M, resultedAt: 95 * M, costUSD: 20 },
      { id: 'b_o3', patientId: 'p_brunner', code: 'lactate', name: 'Lactic acid, venous', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 140 * M, placedBy: 'You', collectedAt: 144 * M, resultedAt: 166 * M, costUSD: 20 },
      { id: 'b_o4', patientId: 'p_brunner', code: 'cbc', name: 'CBC with differential', category: 'lab', priority: 'STAT', status: 'Resulted', placedAt: 10 * M, placedBy: 'You', collectedAt: 14 * M, resultedAt: 48 * M, costUSD: 25 },
      { id: 'b_o5', patientId: 'p_brunner', code: 'bcx', name: 'Blood cultures x2 (aerobic + anaerobic)', category: 'lab', priority: 'STAT', status: 'In lab', statusText: 'Incubating — preliminary in 12–48 h', placedAt: 10 * M, placedBy: 'You', collectedAt: 14 * M, costUSD: 120 },
      { id: 'b_o6', patientId: 'p_brunner', code: 'meropenem', name: 'Meropenem', category: 'med', params: { dose: '1 g', route: 'IV', frequency: 'q8h' }, priority: 'STAT', status: 'Given', placedAt: 40 * M, placedBy: 'You', completedAt: 52 * M, costUSD: 60 },
      { id: 'b_o7', patientId: 'p_brunner', code: 'lr_bolus', name: "Lactated Ringer's bolus", category: 'med', params: { dose: '30 mL/kg', route: 'IV over 30 min', frequency: 'once' }, priority: 'STAT', status: 'Given', placedAt: 18 * M, placedBy: 'You', completedAt: 25 * M, costUSD: 25 },
    ],
    labs: [
      ...labs('p_brunner', 'F', 'b_o1', 14, 36, { lactate: 3.4 }),
      ...labs('p_brunner', 'F', 'b_o2', 74, 95, { lactate: 4.1 }),
      ...labs('p_brunner', 'F', 'b_o3', 144, 166, { lactate: 2.6 }),
      ...labs('p_brunner', 'F', 'b_o4', 14, 48, { wbc: 18.6, rbc: 3.9, hgb: 11.8, hct: 35.6, mcv: 90, plt: 142, neut: 88, bands: 9, lymph: 6, mono: 4, eos: 0 }),
      { id: 'hb1', orderId: 'hist', patientId: 'p_brunner', analyte: 'creat', value: 1.3, collectedAt: -730 * 24 * 60 * M, resultedAt: -730 * 24 * 60 * M, historical: true, flag: 'H' },
    ],
    imaging: [],
    ecgs: [],
    mar: [
      { id: 'bm1', patientId: 'p_brunner', orderId: 'b_o7', med: "Lactated Ringer's bolus", dose: '1740 mL (30 mL/kg)', route: 'IV', t: 25 * M, by: 'A. Rahman RN', status: 'Started' },
      { id: 'bm2', patientId: 'p_brunner', orderId: 'b_o6', med: 'Meropenem', dose: '1 g', route: 'IV', t: 52 * M, by: 'A. Rahman RN', status: 'Given' },
    ],
    notes: [
      { id: 'bn1', patientId: 'p_brunner', t: 4 * M, type: 'EMS', author: 'Medic 14', title: 'EMS run sheet', text: '81F found by neighbor confused at home. BP 98/60, HR 108, RR 22, SpO2 95% RA, CBG 212. 18G L AC, 250 mL NS en route.' },
      { id: 'bn2', patientId: 'p_brunner', t: 60 * M, type: 'Outside Records', author: 'Maple Street Family Medicine (fax)', title: 'Outside records — urine culture 03/2026', text: 'Urine culture: >100,000 CFU/mL Escherichia coli, ESBL-positive.\nCeftriaxone R · Ciprofloxacin R · TMP-SMX R · Nitrofurantoin S · Ertapenem S · Meropenem S.', unread: true },
    ],
    onMonitor: true,
    alerts: [],
    assignedNurse: 'Aisha Rahman, RN',
    version: 5,
  };

  const okafor: PatientChart = {
    ...keller,
    id: 'p_okafor',
    mrn: '00977120',
    name: 'Okafor, Daniel',
    firstName: 'Daniel',
    lastName: 'Okafor',
    age: 31,
    sex: 'M',
    dob: '1995-03-14',
    weightKg: 84,
    heightCm: 186,
    bed: 'ft_1',
    bedLabel: 'Fast Track 1',
    esi: 4,
    chiefComplaint: 'R ankle injury',
    arrivedAt: -25 * M,
    arrivalMode: 'Walk-in',
    allergies: 'NKDA',
    pcp: undefined,
    emergencyContact: undefined,
    insurance: { payer: 'BlueRiver Health', memberId: 'BRH-55821-0', plan: 'PPO', contactId: 'ins_blueriver' },
    homeMeds: [],
    problemList: [],
    encounters: [],
    vitals: [vit('d1', -24, 'Triage', { hr: 84, sbp: 128, dbp: 78, rr: 16, spo2: 99, temp: 36.7, pain: 6, o2: 'RA', by: 'L. Novak RN' })],
    orders: [],
    labs: [],
    imaging: [],
    ecgs: [],
    mar: [],
    notes: [{ id: 'dn1', patientId: 'p_okafor', t: -24 * M, type: 'Triage', author: 'Lena Novak, RN', title: 'Triage note', text: '31M R ankle inversion injury playing basketball ~2 h PTA. Ambulatory with limp. Swelling lateral ankle. Pain 6/10.' }],
    onMonitor: false,
    ivAccess: false,
    alerts: [],
    assignedNurse: 'Aisha Rahman, RN',
    version: 1,
  };
  return { p_keller: keller, p_brunner: brunner, p_okafor: okafor };
}

export function mockView(charts = mockCharts()): PlayerView {
  const npcs: NpcView[] = [
    { id: 'pt_keller', name: 'Robert Keller', role: 'patient', title: 'Patient — Bed 2', location: 'bed_2', spot: 'bed', posture: 'lie', appearance: look({ skin: '#e8b896', hair: '#9a9a9a', outfit: 'gown', outfitColor: '#9cc3d5', height: charts.p_keller.heightCm / 100, build: 'heavy', age: 'old', accessories: ['beard'] }), patientId: 'p_keller', talkable: true, emotion: 'pain', visible: true },
    { id: 'fam_linda', name: 'Linda Keller', role: 'family', title: 'Wife', location: 'bed_2', spot: 'chair', posture: 'sit', appearance: look({ skin: '#efc6a8', hair: '#c9a46b', hairStyle: 'bun', outfit: 'casual', outfitColor: '#7a4e7e', height: 1.62, age: 'old' }), patientId: 'p_keller', talkable: true, emotion: 'anxious', visible: true },
    { id: 'pt_brunner', name: 'Margarethe Brunner', role: 'patient', title: 'Patient — Bed 4', location: 'bed_4', spot: 'bed', posture: 'lie', appearance: look({ skin: '#f0d2bd', hair: '#e8e8e8', hairStyle: 'bun', outfit: 'gown', outfitColor: '#9cc3d5', build: 'slim', age: 'old', height: 1.6, accessories: ['glasses'] }), patientId: 'p_brunner', talkable: true, emotion: 'confused', visible: true },
    { id: 'pt_okafor', name: 'Daniel Okafor', role: 'patient', title: 'Patient — Fast Track 1', location: 'ft_1', spot: 'bed', posture: 'sit', appearance: look({ skin: '#5a3a26', hair: '#141010', hairStyle: 'buzz', outfit: 'casual', outfitColor: '#d4a017', height: 1.88, build: 'average', age: 'young' }), patientId: 'p_okafor', talkable: true, emotion: 'neutral', visible: true },
    { id: 'rn_rosa', name: 'Rosa Delgado', role: 'nurse', title: 'Charge RN', location: 'station', spot: 'desk-2', posture: 'sit', appearance: look({ skin: '#c68e63', hair: '#2a1b14', hairStyle: 'ponytail', outfitColor: '#3a8fb7', height: 1.63 }), talkable: true, visible: true },
    { id: 'rn_tom', name: 'Tom Becker', role: 'nurse', title: 'RN — Beds 1–3', location: 'bed_2', spot: 'bedside_l', posture: 'stand', activity: 'Repeat vitals — Bed 2', appearance: look({ skin: '#f2d0b5', hair: '#b88a4a', outfitColor: '#3a8fb7', height: 1.83 }), talkable: true, visible: true },
    { id: 'rn_aisha', name: 'Aisha Rahman', role: 'nurse', title: 'RN — Beds 4–6, Fast Track', location: 'medroom', spot: 'dispenser', posture: 'stand', activity: 'Pulling meds', appearance: look({ skin: '#a7714f', hair: '#1a1a1a', hairStyle: 'bun', outfitColor: '#3a8fb7', height: 1.66, accessories: ['badge'] }), talkable: true, visible: true },
    { id: 'tech_marcus', name: 'Marcus Hill', role: 'tech', title: 'ED Tech', location: 'hub', spot: 'center', posture: 'walk', appearance: look({ skin: '#6b4430', hair: '#111', hairStyle: 'buzz', outfitColor: '#6d2e46', height: 1.85 }), talkable: true, visible: true },
    { id: 'att_shaw', name: 'Dr. Evelyn Shaw', role: 'attending', title: 'Attending', location: 'workroom', spot: 'desk-a', posture: 'sit', appearance: look({ skin: '#8d5a3b', hair: '#2b2b2b', hairStyle: 'curly', outfit: 'coat', outfitColor: '#f4f4f4', pantsColor: '#1f2a44', height: 1.7, accessories: ['stethoscope', 'glasses'] }), talkable: true, visible: true },
    { id: 'clerk_paul', name: 'Paul', role: 'clerk', title: 'Registration', location: 'waiting', spot: 'desk', posture: 'sit', appearance: look({ outfit: 'uniform', outfitColor: '#44546a' }), talkable: false, visible: true },
    { id: 'vis_1', name: 'Visitor', role: 'visitor', title: 'Waiting', location: 'waiting', spot: 'chair-2', posture: 'sit', appearance: look({ outfit: 'casual', outfitColor: '#5b7f3a' }), talkable: false, visible: true, bark: { text: 'How much longer is this going to take?', t: 100 * M } },
  ];
  return {
    sessionId: 'mock',
    mapId: 'night_shift',
    mapTitle: 'Night Shift',
    layoutId: 'ed',
    t: 170 * M,
    clockStart: '22:00',
    durationMin: 300,
    mode: 'realtime',
    settings: { timeScale: 6, focusSlowdown: true, paused: false, units: 'US', tts: false, hints: true },
    player: { name: 'Dr. You', location: 'station' },
    board: Object.values(charts).map((c) => ({
      id: c.id,
      name: c.name,
      age: c.age,
      sex: c.sex,
      bed: c.bed,
      bedLabel: c.bedLabel,
      chiefComplaint: c.chiefComplaint,
      esi: c.esi,
      arrivedAt: c.arrivedAt,
      flowStatus: c.flowStatus,
      nurse: c.assignedNurse,
      doctor: c.assignedDoctor,
      newResults: c.id === 'p_brunner' ? 2 : 0,
      pendingLabs: c.orders.filter((o) => o.category === 'lab' && !['Resulted', 'Canceled'].includes(o.status)).length,
      pendingImaging: 0,
      activeOrders: c.orders.length,
      critical: c.id === 'p_brunner',
      alerts: c.alerts,
    })),
    npcs,
    pages: [
      { id: 'pg1', t: 75 * M, from: 'Lab (Tony)', text: 'Critical value: Brunner, Margarethe — lactate 4.1 mmol/L', priority: 'critical', patientId: 'p_brunner', read: false },
      { id: 'pg2', t: 18 * M, from: 'Marcus (ECG tech)', text: 'Doc, can you look at the ECG on Bed 2? Chest pain.', priority: 'urgent', patientId: 'p_keller', read: true },
    ],
    conversations: [
      {
        key: 'pt_keller',
        npcId: 'pt_keller',
        title: 'Robert Keller',
        typing: false,
        lines: [
          { id: 'c1', t: 20 * M, speaker: 'player', name: 'You', text: "Hi Mr. Keller, I'm one of the doctors. What's going on tonight?" },
          { id: 'c2', t: 20 * M, speaker: 'npc', name: 'Robert Keller', text: "It's like an elephant's sitting on my chest, Doc. Started during the game around quarter to ten.", emotion: 'pain' },
        ],
      },
    ],
    contacts: [
      { id: 'cards', name: 'Dr. Sara Lindqvist', role: 'Cardiology fellow (on call)', org: 'Grand Therapies Medical Center', phone: 'x4410', kind: 'internal' },
      { id: 'lab', name: 'Clinical Laboratory', role: 'Lab', org: 'Grand Therapies Medical Center', phone: 'x2200', kind: 'internal' },
      { id: 'gp_whitfield', name: 'Maple Street Family Medicine', role: 'PCP office (Dr. Whitfield)', org: 'External', phone: '555-0142', kind: 'external', patientId: 'p_brunner' },
    ],
    examFindings: {
      p_keller: [{ maneuver: 'neck_jvp', label: 'Jugular venous pressure', system: 'Neck', text: 'JVP elevated to ~12 cm H2O with clear lungs.', t: 22 * M }],
    },
    chartVersions: Object.fromEntries(Object.values(charts).map((c) => [c.id, c.version])),
    monitors: {
      bed_2: { patientId: 'p_keller', hr: 52, sbp: 96, dbp: 60, spo2: 94, rr: 22, rhythm: 'sinus', stII: 2.5 },
      bed_4: { patientId: 'p_brunner', hr: 102, sbp: 104, dbp: 60, spo2: 95, rr: 22, rhythm: 'sinus', alarm: undefined },
    },
    ended: false,
    llm: { provider: 'offline', label: 'Offline (mock)', ok: true },
  };
}

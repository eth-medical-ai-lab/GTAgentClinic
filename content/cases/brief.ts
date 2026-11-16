import type { Dispo, ESI, Sex, Vitals } from '../../shared/types';
import { fnv1a } from '../../shared/hash';
import { ageSpeed } from '../../shared/voices';
import type { CaseDef, PhysioDef, Rule } from '../types';
import type { CaseProvenance } from './provenance';

export type Step = [label: string, rule: Rule];
export type History = [label: string, keywords: string[], reply: string];
export type Consultant = 'icu' | 'hosp' | 'surg' | 'ortho' | 'obgyn' | 'cards' | 'transfer';

/** Room, arrival time, nurse and public encounter identifier belong to the shift. */
export interface CaseBrief {
  id: string;
  file?: string;
  specialty: string;
  age: number;
  sex: Sex;
  difficulty: 1 | 2 | 3;
  esi: ESI;
  complaint: string;
  opening: string;
  facts: History[];
  exam: CaseDef['exam'];
  diagnosis: string;
  synonyms: string[];
  icd10: string;
  disposition: Dispo;
  teaching: string;
  steps: Step[];
  lowValue?: CaseDef['scoring']['lowValue'];
  harms?: CaseDef['scoring']['harms'];
  vitals?: Vitals;
  labs?: CaseDef['labs'];
  imaging?: Record<string, string>;
  ecg?: CaseDef['ecg'];
  counseling?: [label: string, keywords: string[], description: string];
  consultant?: Consultant;
  physiology?: Partial<PhysioDef>;
  items?: CaseDef['items'];
  references?: string[];
  arrivalMode?: CaseDef['presentation']['arrivalMode'];
  walkToBed?: boolean;
  meds?: CaseDef['presentation']['documentedHomeMeds'];
  problems?: string[];
  allergies?: CaseDef['presentation']['documentedAllergies'];
  acceptable?: Dispo[];
  mobility?: CaseDef['presentation']['dischargeMobility'];
  capacity?: CaseDef['persona']['capacity'];
  outcome?: string;
  pocus?: CaseDef['pocus'];
  precautions?: CaseDef['precautions'];
}

// Fictional cast, keyed to case identity so adding a case does not recast existing charts.
const givenNames = {
  F: ['Anika', 'Beatriz', 'Chiara', 'Divya', 'Eleni', 'Fiona', 'Greta', 'Helena', 'Irena', 'Junia', 'Kavita', 'Liora', 'Marta', 'Nora', 'Odette', 'Paula', 'Alba', 'Bernice', 'Celia', 'Dulce', 'Esme', 'Farah', 'Gemma', 'Hana', 'Ingrid', 'Jana', 'Klara', 'Leticia', 'Milena', 'Nelia', 'Orla', 'Pia'],
  M: ['Anton', 'Basil', 'Cyrus', 'Dev', 'Emil', 'Felix', 'Gareth', 'Hugo', 'Ivo', 'Jasper', 'Kiran', 'Leon', 'Miro', 'Nico', 'Oren', 'Pavel', 'Alfie', 'Bram', 'Cian', 'Dario', 'Ewan', 'Finn', 'Goran', 'Han', 'Idris', 'Jorge', 'Kenzo', 'Luca', 'Mateo', 'Nasir', 'Oswin', 'Piero'],
};
const surnames = ['Armitage', 'Bellamy', 'Corbitt', 'Dempster', 'Everhart', 'Fairbank', 'Galbraith', 'Hollander', 'Ibrahim', 'Jankowski', 'Kessler', 'Lovelace', 'Merriman', 'Nakamura', 'Ortega', 'Prentice', 'Quintero', 'Rosenthal', 'Sinclair', 'Trujillo', 'Ullmann', 'Vasquez', 'Whitcomb', 'Xuereb', 'Yoshida', 'Zambrano', 'Abdalla', 'Barreto', 'Clemente', 'Dahlgren', 'Esquivel', 'Fernandes', 'Garrido', 'Hasegawa', 'Ingersoll', 'Jellicoe', 'Kristensen', 'Lombardi', 'Mthembu', 'Navarro', 'Oduro', 'Pereira', 'Rinaldi', 'Serrano', 'Tanimura', 'Urbina', 'Villalta', 'Winters', 'Yamada', 'Zielinski'];
const services: Record<Consultant, string> = { icu: 'Intensive care', hosp: 'Hospital medicine', surg: 'Surgery', ortho: 'Orthopedics', obgyn: 'Obstetrics and gynecology', cards: 'Cardiology', transfer: 'Regional transfer center' };

function cast(b: CaseBrief): CaseDef['patient'] {
  const h = fnv1a(b.id);
  const firstName = givenNames[b.sex][h % givenNames[b.sex].length];
  const lastName = surnames[(h >>> 12) % surnames.length];
  const heightCm = 155 + ((h >>> 12) % 35);
  const voices = b.sex === 'F' ? ['af_kore', 'bf_emma', 'af_aoede', 'af_alloy', 'bf_isabella', 'af_bella'] as const : ['am_puck', 'bm_george', 'am_michael', 'am_fenrir', 'am_eric', 'bm_fable'] as const;
  return { firstName, lastName, age: b.age, sex: b.sex, dob: `${2026 - b.age}-01-${String(1 + h % 28).padStart(2, '0')}`,
    mrn: '7' + String(h).padStart(10, '0'), weightKg: 52 + ((h >>> 6) % 54), heightCm, language: 'English',
    voice: { id: voices[(h >>> 4) % voices.length], speed: ageSpeed(b.age) }, codeStatus: 'Full code',
    insurance: { payer: 'Unverified', plan: '', memberId: '', contactId: '' },
    appearance: { skin: ['#d5a17d', '#825336', '#e5b59b', '#b67b54', '#664633'][h % 5],
      hair: b.age > 65 ? '#958a84' : '#422d24', hairStyle: b.sex === 'F' ? 'bun' : 'short',
      age: b.age >= 65 ? 'old' : b.age < 35 ? 'young' : 'adult', height: heightCm / 100,
      build: 'average', outfit: b.esi >= 4 ? 'casual' : 'gown', outfitColor: b.esi >= 4 ? '#747f98' : '#a3c8ce' } };
}

export function compileBrief(b: CaseBrief, provenance: CaseProvenance): CaseDef {
  const patient = cast(b);
  const vitals = { hr: 82, sbp: 124, dbp: 76, rr: 16, spo2: 98, temp: 36.8, gcs: 15, o2: 'RA', ...b.vitals };
  const { o2: _delivery, ...baseline } = vitals;
  const consultant = b.consultant ?? (b.disposition === 'discharge' ? undefined : 'hosp');
  const steps: Step[] = [...b.steps];
  const firstExam = Object.keys(b.exam)[0];
  if (firstExam && !steps.some(([, rule]) => rule.type === 'exam')) steps.unshift(['Perform the focused examination', { type: 'exam', maneuvers: [firstExam] }]);
  if (b.counseling) steps.push([b.counseling[0], { type: 'counseled', ids: ['counsel'] }]);
  if (consultant) steps.push([`Handoff to ${services[consultant]}`, { type: 'consult', contactId: consultant }]);
  const facts = b.facts.map(([label, keywords, text], i) => ({ id: `hx${i + 1}`, label, keywords, text, key: true }));
  const imaging: CaseDef['imaging'] = {};
  for (const [code, report] of Object.entries(b.imaging ?? {})) imaging[code] = { findings: report, impression: report };
  // Both chest film orders examine the same lungs. Preserve separately authored views when present.
  if (imaging.xr_chest || imaging.xr_chest_port) {
    imaging.xr_chest ??= imaging.xr_chest_port;
    imaging.xr_chest_port ??= imaging.xr_chest;
  }
  const labs = { ...b.labs };
  if (labs.glu !== undefined) labs.glu_poc ??= labs.glu;
  if (typeof labs.glu === 'number') baseline.glucose ??= labs.glu;
  const allergies = b.allergies ?? 'NKDA';
  return { id: b.id, specialty: b.specialty, provenance, title: b.diagnosis, summary: b.complaint, difficulty: b.difficulty, patient,
    presentation: { chiefComplaint: b.complaint, arrivalMode: b.arrivalMode ?? (b.esi <= 2 ? 'EMS' : 'Walk-in'), walkToBed: b.walkToBed, esi: b.esi,
      triageNote: b.opening, triageVitals: vitals, documentedAllergies: allergies, documentedHomeMeds: b.meds ?? [],
      problemList: b.problems ?? [], encounters: [], posture: b.esi >= 4 ? 'sit' : 'lie',
      dischargeMobility: b.mobility, initialEmotion: vitals.pain && vitals.pain >= 5 ? 'pain' : 'neutral' },
    truth: { allergies: allergies === 'NKDA' ? [] : allergies,
      diagnosis: { label: b.diagnosis, icd10: b.icd10, accept: [b.diagnosis, ...b.synonyms], partial: [] },
      dispositions: [b.disposition], acceptableDispositions: b.acceptable,
      outcomeGood: b.outcome ?? (b.disposition === 'discharge' ? 'The patient leaves with a plan for care at home.' : 'The receiving team takes over the patient’s care.'),
      outcomeBad: 'The encounter ends with the care plan incomplete.' },
    persona: { personality: 'Describe the experience in your own words. Answer focused questions from your history.', voice: 'Conversational, plain language.',
      opening: b.opening, facts, healthLiteracy: 'average', unknowns: ['Diagnosis', 'Test results'], behavior: ['Give details when asked.'],
      capacity: b.capacity ?? 'intact', fallback: 'I’m not sure about that.',
      counseling: b.counseling ? [{ id: 'counsel', label: b.counseling[0], keywords: b.counseling[1], description: b.counseling[2] }] : undefined },
    consults: consultant ? [{ contactId: consultant, criteria: `Accept a handoff identifying the patient and concern for ${b.diagnosis}. ${b.teaching}`,
      guard: { type: 'any', rules: [{ type: 'escalated' }, { type: 'exam', maneuvers: Object.keys(b.exam), min: 1 }, { type: 'fact', factIds: facts.map(f => f.id) }] },
      onAccept: { service: services[consultant], dispo: b.disposition, departAfterMin: 8 },
      declineHint: 'Give the patient identifier, working diagnosis and pertinent findings.' }] : [],
    physiology: { effects: [], ...b.physiology, baseline: { ...baseline, ...b.physiology?.baseline } },
    labs, imaging, ecg: b.ecg ?? { params: { rate: vitals.hr, rhythm: 'sinus' },
      machineRead: vitals.hr > 100 ? 'Sinus tachycardia.' : vitals.hr < 60 ? 'Sinus bradycardia.' : 'Sinus rhythm.',
      readKeywords: ['sinus'] },
    exam: b.exam, scoring: { dxPoints: 14, dispoPoints: 10, historyPoints: 10, critical: steps.map(([label, rule], i) => ({ id: `step${i + 1}`, label, rule, points: 6 })), harms: b.harms ?? [], lowValue: b.lowValue ?? [] },
    teaching: [b.teaching], references: b.references ?? [], items: b.items, pocus: b.pocus, precautions: b.precautions };
}

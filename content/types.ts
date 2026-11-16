/**
 * Content schema (SERVER-ONLY). Cases carry hidden ground truth — diagnoses,
 * physiology, future lab values, persona facts — that must never reach clients.
 */
import type {
  Allergy,
  Appearance,
  Contact,
  DischargeProgress,
  Dispo,
  EcgParams,
  Emotion,
  ESI,
  HomeMed,
  LocationId,
  NpcRole,
  PrecautionKind,
  PriorEncounter,
  Sex,
  Vitals,
} from '../shared/types';
import type { TtsVoice } from '../shared/voices';
import type { PocusWindow } from '../shared/pocus';

/**
 * Note on `voice` fields: they cast the character's TTS voice (a Kokoro voice id, see shared/voices.ts)
 * and are always authored explicitly — never inferred from a name. Not to be confused with
 * `persona.voice`, which describes speaking style to the LLM.
 */
export type { TtsVoice };

// ───────────────────────────── physiology ─────────────────────────────

export type PhysVar = 'hr' | 'sbp' | 'dbp' | 'rr' | 'spo2' | 'temp' | 'pain' | 'gcs' | 'glucose' | 'lactate' | 'creat';

export type VarMap = Partial<Record<PhysVar, number>>;

export type CurveDef =
  /** logistic rise from base to peak; t is minutes since arrival */
  | { kind: 'sigmoid'; base: number; peak: number; t50Min: number; widthMin: number }
  /** piecewise-linear [minutesSinceArrival, value] */
  | { kind: 'series'; points: [number, number][] };

export interface EffectDef {
  /** intervention tag, from med tags (shared/catalog) or special tags: reperfusion, surgical_care, rice, brace */
  tag: string;
  onsetMin?: number;
  /** ramp time constant (min) */
  tauMin?: number;
  /** effect wears off after this many minutes (symptomatic meds) */
  durationMin?: number;
  /** full-effect shift per dose unit */
  delta?: VarMap;
  /** multiplies baseline drift once onset is reached (product over active effects; negative = reversal) */
  driftMult?: VarMap;
  /** cap on dose units counted (e.g. fluid liters) */
  maxUnits?: number;
  /** harmful in this patient: sets a flag and pages a nurse message on administration */
  harm?: { flag: string; page?: string; chance?: number };
}

export interface TriggerDef {
  id: string;
  when: { var: PhysVar; op: '<' | '>'; value: number } | { afterMin: number; unlessTag?: string };
  page?: { from: 'nurse' | 'tech' | 'lab' | 'attending'; text: string; priority: 'info' | 'urgent' | 'critical' };
  /** add to baseline drift (per hour) once triggered */
  driftAdd?: VarMap;
  /** immediate step change */
  jump?: VarMap;
  flag?: string;
  emotion?: Emotion;
}

export interface PhysioDef {
  baseline: VarMap;
  /** change per hour while untreated */
  drift?: VarMap;
  limits?: Partial<Record<PhysVar, [number, number]>>;
  /** measurement noise SD */
  noise?: VarMap;
  effects: EffectDef[];
  triggers?: TriggerDef[];
}

// ───────────────────────────── labs / imaging / ECG truth ─────────────────────────────

export type LabTruth = number | string | { var: PhysVar } | CurveDef;

export interface ImagingTruth {
  findings: string;
  impression: string;
  imageKey?: string;
  /** radiologist calls the ED with this message when finalized */
  criticalCall?: string;
  /** study is refused / not performed, with an explanatory page */
  blocked?: { from: string; message: string };
}

export interface EcgTruth {
  /** A source adaptation can lack a 12-lead tracing even when pulse is recorded. */
  unavailable?: boolean;
  params: EcgParams;
  machineRead: string;
  /** keywords that make a physician interpretation "correct" */
  readKeywords: string[];
  rightSided?: { params: EcgParams; machineRead: string };
  /** acquired automatically by protocol N minutes after arrival */
  autoAtMin?: number;
}

// ───────────────────────────── personas ─────────────────────────────

export interface FactDef {
  id: string;
  /** first-person text the NPC can say (used verbatim by the offline provider) */
  text: string;
  keywords: string[];
  /** label in the debrief ("Radiation of pain") — key facts are scored */
  label?: string;
  key?: boolean;
  /** mentions it without being asked */
  volunteer?: boolean;
}

export interface CounselItem {
  id: string;
  label: string;
  /** what counts as having addressed it (for the LLM judge) */
  description: string;
  keywords: string[];
}

export interface PersonaDef {
  personality: string;
  voice: string;
  healthLiteracy: 'low' | 'average' | 'high';
  /** what they say first when greeted */
  opening: string;
  facts: FactDef[];
  unknowns: string[];
  behavior: string[];
  capacity: 'intact' | 'impaired';
  /** offline reply when nothing matches */
  fallback: string;
  counseling?: CounselItem[];
  /** structured actions this NPC may take (besides speaking) */
  actions?: { id: string; description: string }[];
}

export interface FamilyDef {
  npcId: string;
  name: string;
  relation: string;
  appearance: Appearance;
  /** minutes after the patient's arrival; omit = arrives with patient */
  arrivesAtMin?: number;
  persona: PersonaDef;
  /** TTS casting */
  voice?: TtsVoice;
}

export interface PhoneActionDef {
  id: string;
  description: string;
  /** chart note delivered after delay (e.g. faxed outside records) */
  note?: { title: string; type: 'Outside Records' | 'Consult'; text: string; delayMin: number; author: string };
  flag?: string;
}

export interface PhoneContactDef {
  contact: Omit<Contact, 'patientId'>;
  persona: PersonaDef;
  phoneActions?: PhoneActionDef[];
  /** must state patient name + DOB before PHI is released */
  requiresIdentifiers?: boolean;
  /** TTS casting for whoever talks on this line */
  voice?: TtsVoice;
  /** if someone else picks up first (an answering service), the voice of the scripted opening */
  openingVoice?: TtsVoice;
}

/** how a consultant reacts to this specific case */
export interface ConsultDef {
  contactId: string;
  /** natural-language acceptance criteria for the consultant persona */
  criteria: string;
  /** server-side guard: accepting is only allowed if this rule holds (prevents LLM over-acceptance) */
  guard?: Rule;
  onAccept: {
    tag?: string;
    tagAfterMin?: number;
    dispo?: Dispo;
    service?: string;
    departAfterMin?: number;
    note?: { title: string; text: string };
    page?: string;
  };
  declineHint: string;
}

// ───────────────────────────── scoring rules ─────────────────────────────

export type Rule =
  | { type: 'order'; codes: string[]; withinMin?: number }
  | { type: 'given'; tags?: string[]; codes?: string[]; withinMin?: number; minTotalMl?: number }
  | { type: 'collected'; codes: string[]; withinMin?: number; count?: number }
  | { type: 'before'; first: Rule; then: Rule }
  | { type: 'consult'; contactId: string; withinMin?: number }
  | { type: 'called'; contactIds: string[] }
  | { type: 'fact'; factIds: string[]; all?: boolean }
  | { type: 'counseled'; ids: string[]; all?: boolean }
  | { type: 'exam'; maneuvers: string[]; min?: number }
  | { type: 'ecg_signed'; withinMin?: number }
  | { type: 'ecg_read'; }
  | { type: 'escalated' }
  | { type: 'vitals'; vars: (keyof Vitals)[]; withinMin?: number }
  | { type: 'dispo'; decisions: Dispo[] }
  | { type: 'dx'; keywords: string[] }
  | { type: 'flag'; flag: string }
  | { type: 'not'; rule: Rule }
  | { type: 'any'; rules: Rule[] }
  | { type: 'all'; rules: Rule[] }
  /** if cond does not hold the item is not applicable (excluded from max) */
  | { type: 'if'; cond: Rule; then: Rule };

export interface CriticalDef {
  id: string;
  label: string;
  points: number;
  rule: Rule;
  teaching?: string;
}

export interface HarmDef {
  id: string;
  label: string;
  penalty: number;
  rule: Rule;
  teaching: string;
}

export interface ScoringDef {
  dxPoints: number;
  dispoPoints: number;
  historyPoints: number;
  critical: CriticalDef[];
  harms: HarmDef[];
  lowValue: { codes: string[]; penalty: number; why: string }[];
  secondaryDx?: { label: string; keywords: string[]; points: number }[];
}

// ───────────────────────────── case ─────────────────────────────

/**
 * Belongings and documents at the bedside that a doctor can pick up and inspect (humans in 3D,
 * agents via the `inspect` action). Inspecting reveals `text`; listed `facts` count as history
 * elicited (same scoring as asking). Think "brown-bag" medication review: meds EMS collected from
 * home, a GP letter in a handbag, a bag of sports gear.
 */
export interface CaseItemDef {
  id: string;
  kind: 'medBag' | 'pillBottle' | 'handbag' | 'letter' | 'sportsBag' | 'phone' | 'glasses' | 'wallet';
  label: string;
  /** placement in the patient's bay */
  where: 'bedside' | 'chair' | 'foot';
  text: string;
  facts?: string[];
  /** 'family': only appears once the family member is present */
  arrivesWith?: 'patient' | 'family';
  /** what the patient says when it is handed back (`give_item`; default: a plain thank-you) */
  returnLine?: string;
}

/**
 * The patient's bed position (shared/types.ts BedPosition) as the case's nurse sets it. Shown in the
 * 3D view only: never logged, never scored, never in the agents' text. The general rules
 * (server/sim/bedPosition.ts) come first: flat for an abdominal exam, a catheter or CPR, flat while
 * hypotensive, sat up when short of breath. Say why in a comment: it is a clinical choice.
 */
export interface CaseBedDef {
  /** head of the bed, degrees above horizontal (the ED default is semi-Fowler, 30–45) */
  headDeg: number;
  sitting?: 'edge' | 'upright';
  knees?: boolean;
  legUp?: 'L' | 'R';
  /** while an observed vital (the charted set, or the monitor when on it) is past a threshold: sit up more */
  symptomatic?: { var: 'hr' | 'rr' | 'spo2'; op: '<' | '>'; value: number; headDeg: number; sitting?: 'upright' };
  /** once one of these orders has been carried out (e.g. ice and elevation): this position instead */
  afterOrders?: { codes: string[]; bed: Omit<CaseBedDef, 'afterOrders' | 'symptomatic'> };
}

/**
 * Bedside ultrasound, one window (shared/pocus.ts; exam maneuver pocus_<window>): the read as a doctor
 * would document it (server/sim/pocus.ts). `when` picks a variant like an exam finding does
 * (physiology now, or a session flag such as "foley"): the first whose condition holds, else the last.
 */
export interface PocusTruth {
  text: string;
  when?: { var: PhysVar; op: '<' | '>'; value: number } | { flag: string };
}

export interface CaseDef {
  specialty: string;
  provenance: import('./cases/provenance').CaseProvenance;
  id: string;
  title: string;
  summary: string;
  difficulty: 1 | 2 | 3;
  patient: {
    firstName: string;
    lastName: string;
    sex: Sex;
    age: number;
    dob: string;
    mrn: string;
    weightKg: number;
    heightCm: number;
    language: string;
    appearance: Appearance;
    pcp?: { name: string; practice: string; phone: string; contactId: string };
    insurance: { payer: string; memberId: string; plan: string; contactId: string };
    emergencyContact?: { name: string; relation: string; phone: string; contactId: string };
    codeStatus: string;
    /** TTS casting; omitted → a default from sex and age */
    voice?: TtsVoice;
  };
  presentation: {
    chiefComplaint: string;
    arrivalMode: 'Walk-in' | 'EMS' | 'Private vehicle';
    /** Can safely walk unassisted from the public entrance to the assigned bay at presentation. */
    walkToBed?: boolean;
    esi: ESI;
    triageNote: string;
    emsNote?: string;
    triageVitals: Vitals;
    documentedAllergies: Allergy[] | 'NKDA';
    documentedHomeMeds: HomeMed[];
    problemList: string[];
    encounters: PriorEncounter[];
    priorLabs?: { analyte: string; value: number | string; daysAgo: number }[];
    /** on the stretcher or the bed's edge (bed.sitting 'edge' wins, when there is one) */
    posture: 'lie' | 'sit';
    /** how the nurse sets the bed (server/sim/bedPosition.ts); without one: 30° lying, the edge sitting */
    bed?: CaseBedDef;
    /** Assistance needed to leave the ED with this presentation; independent walking is the default. */
    dischargeMobility?: DischargeProgress['mobility'];
    initialEmotion: Emotion;
  };
  truth: {
    allergies: Allergy[];
    diagnosis: { label: string; icd10: string; accept: string[]; partial: string[] };
    dispositions: Dispo[];
    acceptableDispositions?: Dispo[];
    outcomeGood: string;
    outcomeBad: string;
  };
  persona: PersonaDef;
  family?: FamilyDef;
  phoneContacts?: PhoneContactDef[];
  consults: ConsultDef[];
  physiology: PhysioDef;
  labs: Record<string, LabTruth>;
  imaging: Record<string, ImagingTruth>;
  ecg: EcgTruth;
  /** exam maneuver id → finding override (string, or variants evaluated against physiology) */
  exam: Record<string, string | { text: string; when?: { var: PhysVar; op: '<' | '>'; value: number } }[]>;
  scoring: ScoringDef;
  teaching: string[];
  references: string[];
  /** belongings/documents at the bedside (see CaseItemDef) */
  items?: CaseItemDef[];
  /** bedside ultrasound findings per window; windows not listed are normal (PocusTruth) */
  pocus?: Partial<Record<PocusWindow, PocusTruth | PocusTruth[]>>;
  /**
   * Transmission-based precautions on top of standard precautions, where the case warrants them
   * (shared/types.ts PrecautionKind). `afterFacts`: they start once one of these facts is known (a
   * culture result the GP's office reads out); omitted, they apply from arrival. The 3D view signs
   * the room and puts the PPE outside it; the debrief lists masks worn where droplet or airborne
   * precautions applied. Never scored, never in the agents' observation text.
   */
  precautions?: { kind: PrecautionKind; reason: string; afterFacts?: string[] };
}

// ───────────────────────────── scenario (map) ─────────────────────────────

export interface StaffDef {
  id: string;
  name: string;
  role: NpcRole;
  title: string;
  appearance: Appearance;
  home: { room: LocationId; spot: string };
  talkable: boolean;
  /** for nurses: assigned rooms */
  assigned?: LocationId[];
  persona?: { personality: string; voice: string; rules: string[] };
  /** ambient lines (no LLM) */
  barks?: string[];
  /** TTS casting */
  voice?: TtsVoice;
}

export type StaffErrorDef =
  | { id: string; kind: 'missing_triage_vital'; caseId: string; vital: 'temp' | 'rr' | 'spo2'; points: number; label: string; teaching: string }
  | { id: string; kind: 'abx_before_cultures'; caseId: string; points: number; label: string; teaching: string }
  | {
      id: string;
      kind: 'wrong_patient_med';
      atMin: number;
      nurseId: string;
      intendedCaseId: string;
      wrongCaseId: string;
      medCode: string;
      dose: string;
      route: string;
      orderedBy: string;
      windowMin: number;
      points: number;
      label: string;
      teaching: string;
    };

export interface ScriptedEventDef {
  atMin: number;
  kind: 'page' | 'bark' | 'rounds' | 'toast';
  from?: string;
  npcId?: string;
  text: string;
  priority?: 'info' | 'urgent' | 'critical';
}

export interface ScenarioDef {
  id: string;
  title: string;
  subtitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  learningGoals: string[];
  layoutId: string;
  shiftStart: string;
  durationMin: number;
  defaultTimeScale: number;
  /** Composed shifts room due arrivals in the first available staffed bay in this pool. */
  bedPool?: { bed: LocationId; nurseId: string }[];
  patients: { caseId: string; bed: LocationId; arriveAtMin: number; nurseId: string }[];
  staff: StaffDef[];
  internalContacts: PhoneContactDef[];
  events: ScriptedEventDef[];
  errors: StaffErrorDef[];
  intro: { from: string; text: string }[];
}

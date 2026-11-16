import type { PlayerSave, SlotInfo } from './saveGame';
/**
 * Shared protocol + view types.
 *
 * Design rule: everything in this file is "player-visible". Hidden ground truth
 * (diagnoses, future lab values, persona facts) lives in content/ and server/ and
 * never crosses the wire. Human clients (3D) and AI agents (HTTP/MCP) receive the
 * same views and send the same Action union — that parity is what makes the game
 * usable as an agent-training environment.
 */
import type { NpcSelection } from './llm';

// ───────────────────────────── basics ─────────────────────────────

export type Sex = 'M' | 'F';
export type ESI = 1 | 2 | 3 | 4 | 5;
export type LocationId = string; // room ids from the map layout
export type PatientId = string;
export type NpcId = string;
export type CameraMode = 'first' | 'third' | 'top';
export type UnitSystem = 'US' | 'SI';
export type Emotion = 'neutral' | 'pain' | 'anxious' | 'angry' | 'confused' | 'relieved' | 'sad' | 'happy' | 'drowsy';

/** Game time is seconds since shift start. */
export type GameTime = number;

// ───────────────────────────── vitals ─────────────────────────────

export interface Vitals {
  hr?: number;
  sbp?: number;
  dbp?: number;
  rr?: number;
  spo2?: number;
  /** °C internally; formatted per unit system */
  temp?: number;
  pain?: number; // 0-10
  gcs?: number;
  /** POC glucose, mg/dL internally */
  glucose?: number;
  /** oxygen delivery, e.g. "RA", "2 L NC", "15 L NRB" */
  o2?: string;
}

export interface VitalsEntry extends Vitals {
  id: string;
  t: GameTime;
  source: 'Triage' | 'Nurse' | 'Monitor' | 'EMS';
  by?: string;
  comment?: string;
}

// ───────────────────────────── catalog ─────────────────────────────

export type OrderCategory = 'lab' | 'imaging' | 'med' | 'nursing' | 'consult' | 'ecg' | 'procedure' | 'supply';
export type LabSection = 'Hematology' | 'Chemistry' | 'Cardiac' | 'Coagulation' | 'Blood Gas' | 'Urinalysis' | 'Microbiology' | 'Toxicology' | 'Endocrine' | 'Inflammatory' | 'Point of Care' | 'Blood Bank';

export interface LabAnalyteDef {
  code: string;
  name: string;
  short: string;
  section: LabSection;
  /** conventional (US) unit — internal canonical unit */
  unit: string;
  unitSI?: string;
  /** multiply conventional value by this to get SI */
  toSI?: number;
  ref?: [number, number] | { M: [number, number]; F: [number, number] };
  critLow?: number;
  critHigh?: number;
  decimals?: number;
  decimalsSI?: number;
  /** non-numeric result (e.g. "Negative", "3+") */
  text?: boolean;
  /** normal text value when text=true */
  normalText?: string;
}

export interface MedDef {
  generic: string;
  brand?: string;
  drugClass: string;
  doses: string[]; // first = default
  routes: string[]; // first = default
  frequencies: string[]; // first = default
  /** physiology intervention tags triggered on administration */
  tags: string[];
  /** fluid volume per administration if relevant */
  volumeMl?: number;
  /** cross-reactivity / allergy groups this med belongs to */
  allergyGroups?: string[];
  highAlert?: boolean;
}

export interface OrderDef {
  code: string;
  name: string;
  category: OrderCategory;
  synonyms?: string[];
  /** lab: analytes resulted by this order */
  analytes?: string[];
  specimen?: 'Blood' | 'Urine' | 'POC' | 'Swab' | 'Blood culture' | 'Arterial blood' | 'Venous blood';
  /** min,max minutes from collection to result */
  tatMin?: [number, number];
  /** imaging / ECG */
  modality?: 'XR' | 'CT' | 'US' | 'MRI' | 'ECG';
  contrast?: boolean;
  /** min,max minutes from order to images acquired, then report */
  acquireMin?: [number, number];
  readMin?: [number, number];
  med?: MedDef;
  /** nursing / procedure duration in minutes */
  durationMin?: number;
  costUSD: number;
  /** shown in order composer */
  description?: string;
}

export interface OrderSetDef {
  code: string;
  name: string;
  items: { code: string; params?: OrderParams; defaultChecked: boolean }[];
}

// ───────────────────────────── orders & results ─────────────────────────────

export type Priority = 'STAT' | 'Routine';

export interface OrderParams {
  dose?: string;
  route?: string;
  frequency?: string;
  comment?: string;
  /** consult: question for the consultant */
  question?: string;
}

export type OrderStatus =
  | 'Ordered'
  | 'Pending verification'
  | 'Collected'
  | 'In lab'
  | 'Scheduled'
  | 'In progress'
  | 'Completed'
  | 'Preliminary'
  | 'Final'
  | 'Resulted'
  | 'Given'
  | 'Active'
  | 'Canceled'
  | 'Held';

export interface OrderView {
  id: string;
  patientId: PatientId;
  code: string;
  name: string;
  category: OrderCategory;
  params?: OrderParams;
  priority: Priority;
  status: OrderStatus;
  statusText?: string;
  placedAt: GameTime;
  placedBy: string;
  collectedAt?: GameTime;
  resultedAt?: GameTime;
  completedAt?: GameTime;
  canceledAt?: GameTime;
  costUSD: number;
}

export type ResultFlag = 'H' | 'L' | 'HH' | 'LL' | 'A';

export interface LabResultView {
  id: string;
  orderId: string;
  patientId: PatientId;
  analyte: string; // LabAnalyteDef.code
  /** conventional units (numbers) or text */
  value: number | string;
  collectedAt: GameTime;
  resultedAt: GameTime;
  flag?: ResultFlag;
  comment?: string;
  /** historical result from a prior encounter (negative times) */
  historical?: boolean;
}

export type ImagingStatus = 'Ordered' | 'Scheduled' | 'In progress' | 'Completed' | 'Preliminary' | 'Final' | 'Canceled';

export interface ImagingView {
  id: string;
  orderId: string;
  patientId: PatientId;
  code: string;
  name: string;
  modality: 'XR' | 'CT' | 'US' | 'MRI';
  status: ImagingStatus;
  orderedAt: GameTime;
  performedAt?: GameTime;
  reportedAt?: GameTime;
  findings?: string;
  impression?: string;
  radiologist?: string;
  /** key into the client's procedural image renderer */
  imageKey?: string;
}

export type Lead = 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V4R';

export interface EcgParams {
  rate: number;
  rhythm: 'sinus' | 'afib' | 'flutter' | 'svt' | 'vt' | 'vf' | 'asystole' | 'paced';
  pr?: number; // ms
  qrs?: number; // ms
  qt?: number; // ms
  axis?: number; // degrees
  /** ST deviation in mm (+ elevation, − depression) */
  st?: Partial<Record<Lead, number>>;
  tInversion?: Lead[];
  qWaves?: Lead[];
  peakedT?: boolean;
  /** include right-sided lead V4R strip */
  rightSided?: boolean;
  /** baseline wander / artifact 0..1 */
  noise?: number;
  /** seed for beat-to-beat variability */
  seed?: number;
}

export interface EcgView {
  id: string;
  patientId: PatientId;
  acquiredAt: GameTime;
  label: string; // "12-lead ECG", "Right-sided ECG"
  params: EcgParams;
  machineRead: string;
  signedAt?: GameTime;
  physicianRead?: string;
}

export interface MarEntry {
  id: string;
  patientId: PatientId;
  orderId?: string;
  med: string;
  dose: string;
  route: string;
  t: GameTime;
  by: string;
  status: 'Given' | 'Held' | 'Refused' | 'Stopped' | 'Started';
  comment?: string;
}

export type NoteType = 'Triage' | 'Nursing' | 'EMS' | 'Outside Records' | 'Radiology' | 'Consult' | 'Physician' | 'Prior Visit' | 'Registration' | 'Pharmacy';

export interface NoteView {
  id: string;
  patientId: PatientId;
  t: GameTime;
  type: NoteType;
  author: string;
  title: string;
  text: string;
  unread?: boolean;
}

export type Dispo =
  | 'discharge'
  | 'observation'
  | 'admit_floor'
  | 'admit_telemetry'
  | 'admit_stepdown'
  | 'admit_icu'
  | 'or'
  | 'cath_lab'
  | 'transfer'
  | 'ama';

export const DISPO_LABELS: Record<Dispo, string> = {
  discharge: 'Discharge home',
  observation: 'ED observation',
  admit_floor: 'Admit — medical/surgical floor',
  admit_telemetry: 'Admit — telemetry',
  admit_stepdown: 'Admit — step-down / IMC',
  admit_icu: 'Admit — ICU',
  or: 'To operating room',
  cath_lab: 'To cardiac cath lab',
  transfer: 'Transfer to another facility',
  ama: 'Left against medical advice',
};

export interface DispositionView {
  decision: Dispo;
  service?: string;
  t: GameTime;
  diagnoses: string[];
  instructions?: string;
}

/** A signed home discharge in progress. Times are game seconds since shift start. */
export interface DischargeProgress {
  patientId: PatientId;
  nurseId: NpcId;
  mobility: 'walking' | 'wheelchair';
  phase: 'paperwork' | 'awaiting_nurse' | 'handoff' | 'leaving' | 'departed';
  since: GameTime;
  /** Expected end of the current step, when known. A queued nurse has no fixed ETA. */
  until?: GameTime;
  /** Start of the nurse’s trip to the bedside, available once the task is assigned. */
  from?: { x: number; z: number };
  /** Interpolation origin when playback speed changes mid-exit. The phase still began at since. */
  travelStart?: GameTime;
}

export function dischargeStatus(d: DischargeProgress): string {
  switch (d.phase) {
    case 'paperwork': return 'Preparing discharge paperwork';
    case 'awaiting_nurse': return d.until === undefined ? 'Awaiting nurse handoff' : 'Nurse on the way to bedside';
    case 'handoff': return 'Nurse reviewing discharge instructions';
    case 'leaving': return d.mobility === 'wheelchair' ? 'Wheelchair escort to exit' : 'Walking to exit';
    case 'departed': return 'Departed for home';
  }
}

export interface PriorEncounter {
  id: string;
  date: string; // display date, e.g. "2024-03-12"
  type: string; // "ED visit", "Inpatient", "Clinic"
  department: string;
  reason: string;
  summary: string;
}

export interface Allergy {
  substance: string;
  reaction: string;
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
}

export interface HomeMed {
  name: string;
  dose: string;
  sig: string;
  lastTaken?: string;
}

// ───────────────────────────── patient chart (EHR) ─────────────────────────────

export type PatientFlowStatus = 'Waiting' | 'In triage' | 'Roomed' | 'In imaging' | 'Dispo decided' | 'Departed';

export interface PatientChart {
  id: PatientId;
  mrn: string;
  name: string; // "Keller, Robert"
  firstName: string;
  lastName: string;
  age: number;
  sex: Sex;
  dob: string;
  weightKg: number;
  heightCm: number;
  bed: LocationId;
  bedLabel: string;
  esi: ESI;
  chiefComplaint: string;
  arrivedAt: GameTime;
  departedAt?: GameTime;
  arrivalMode: string;
  flowStatus: PatientFlowStatus;
  /** documented allergies (may be incomplete!) — 'NKDA' means none documented */
  allergies: Allergy[] | 'NKDA' | 'Not yet reviewed';
  codeStatus: string;
  language: string;
  pcp?: { name: string; practice: string; phone: string; contactId: string };
  insurance?: { payer: string; memberId: string; plan: string; contactId: string };
  emergencyContact?: { name: string; relation: string; phone: string; contactId: string };
  /** documented home meds (med rec) — may be incomplete */
  homeMeds: HomeMed[] | 'Not yet reconciled';
  problemList: string[];
  encounters: PriorEncounter[];
  vitals: VitalsEntry[];
  orders: OrderView[];
  labs: LabResultView[];
  imaging: ImagingView[];
  ecgs: EcgView[];
  mar: MarEntry[];
  notes: NoteView[];
  /** player's working diagnoses */
  diagnoses: string[];
  disposition?: DispositionView;
  discharge?: DischargeProgress;
  onMonitor: boolean;
  ivAccess: boolean;
  npo: boolean;
  assignedNurse?: string;
  assignedDoctor?: string;
  /** safety banners, e.g. "NAME ALERT: similar name on unit (Kellner, Robert — Bed 3)" */
  alerts: string[];
  version: number;
}

export interface PatientBoardRow {
  id: PatientId;
  name: string;
  age: number;
  sex: Sex;
  bed: LocationId;
  bedLabel: string;
  chiefComplaint: string;
  esi: ESI;
  arrivedAt: GameTime;
  departedAt?: GameTime;
  flowStatus: PatientFlowStatus;
  nurse?: string;
  doctor?: string;
  newResults: number;
  pendingLabs: number;
  pendingImaging: number;
  activeOrders: number;
  critical: boolean;
  dispo?: Dispo;
  discharge?: DischargeProgress;
  alerts: string[];
  /**
   * Transmission-based precautions in force (CaseDef.precautions, once its trigger is met): the 3D
   * view puts the sign and the PPE at the room's entrance. Not in the agents' observation text.
   */
  precautions?: PrecautionKind;
}

export function lengthOfStay(patient: Pick<PatientBoardRow, 'arrivedAt' | 'departedAt'>, now: GameTime): number {
  return Math.max(0, (patient.departedAt ?? now) - patient.arrivedAt);
}

// ───────────────────────────── infection control ─────────────────────────────

/**
 * Transmission-based precautions on top of standard precautions (CDC 2007 isolation guideline):
 * contact = gown and gloves for contact with the patient or the bed space; droplet = a surgical mask
 * within the room (influenza, pertussis, meningococcal disease); airborne = an N95/FFP2 respirator and
 * a negative-pressure room with the door closed (tuberculosis, measles, varicella).
 */
export type PrecautionKind = 'contact' | 'droplet' | 'airborne';

/** a hand-hygiene action or a mask going on or off (Action 'hygiene') */
export type HygieneKind = 'rub' | 'wash' | 'mask_on' | 'mask_off' | 'gloves_on' | 'gloves_off';

/** one hand-hygiene action or mask change as recorded (Debrief.infectionControl) */
export interface HygieneRecord {
  t: GameTime;
  kind: HygieneKind;
  /** where you were (your location then) and its label */
  room: LocationId;
  roomLabel: string;
  /** the dispenser or sink, when the client named it */
  at?: string;
}

/**
 * A WHO "My 5 Moments" opportunity: moment 1 before touching a patient, moment 4 after touching a
 * patient. One per visit to a patient's space in which you examined them (server/sim/hygiene.ts).
 */
export interface HygieneOpportunity {
  moment: 1 | 4;
  /** moment 1: your first examination in the visit; moment 4: your last */
  t: GameTime;
  patientId: PatientId;
  name: string;
  bedLabel: string;
  ok: boolean;
  /** the hand hygiene that met it */
  by?: { t: GameTime; kind: 'rub' | 'wash'; roomLabel: string };
}

/** Debrief: hand hygiene and masks this shift. Listed for reflection; not scored. */
export interface InfectionControlDebrief {
  /** every rub, wash, mask on and off, in order */
  actions: HygieneRecord[];
  moment1: { met: number; of: number };
  moment4: { met: number; of: number };
  opportunities: HygieneOpportunity[];
  /** visits to patients on droplet or airborne precautions: was a mask on when you went in? */
  masks: { t: GameTime; patientId: PatientId; name: string; bedLabel: string; precaution: PrecautionKind; masked: boolean }[];
  /** moment 4s not yet due: still in the patient's space when the shift ended */
  open: number;
  /** each examination of a patient on contact precautions: were gloves on? */
  gloves?: { t: GameTime; patientId: PatientId; name: string; bedLabel: string; gloved: boolean }[];
  /** each time gloves came off: hands cleaned after (before touching anyone or anything else)? `open`: nothing since */
  afterGloves?: { t: GameTime; ok: boolean; open?: boolean; by?: { t: GameTime; kind: 'rub' | 'wash'; roomLabel: string } }[];
}

// ───────────────────────────── NPCs / world ─────────────────────────────

export type NpcRole =
  | 'patient'
  | 'family'
  | 'nurse'
  | 'tech'
  | 'attending'
  | 'resident'
  | 'clerk'
  | 'security'
  | 'ems'
  | 'housekeeping'
  | 'visitor'
  | 'consultant';

export interface Appearance {
  skin: string; // hex
  hair: string; // hex
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'ponytail' | 'curly' | 'buzz';
  outfit: 'scrubs' | 'gown' | 'casual' | 'coat' | 'ems' | 'uniform' | 'suit';
  outfitColor: string; // hex
  pantsColor?: string;
  height: number; // meters, ~1.55–1.95
  build: 'slim' | 'average' | 'heavy';
  age: 'young' | 'adult' | 'old';
  accessories?: ('glasses' | 'stethoscope' | 'cap' | 'badge' | 'mask' | 'beard')[];
}

export type Posture = 'stand' | 'sit' | 'lie' | 'walk';

/**
 * How a patient lies or sits on the bed or stretcher, as a nurse would set it (server/sim/bedPosition.ts):
 * the head of the bed, and how the body rests on it. View only: never logged, never scored.
 */
export interface BedPosition {
  /** the backrest above horizontal (°): 0 flat, 30–45 semi-Fowler, 60–80 high Fowler */
  headDeg: number;
  /** on the edge, legs over the side ('edge'), or sitting up in bed, off the backrest a little ('upright') */
  sitting?: 'edge' | 'upright';
  /** hips and knees bent, feet on the mattress (a position of comfort with abdominal pain; the abdominal exam) */
  knees?: boolean;
  /** this leg rests raised on a pillow (an injured ankle: elevation) */
  legUp?: 'L' | 'R';
  /** why, in a few words (tests, debugging): 'case default', 'abdominal exam', 'hypotension' … */
  reason?: string;
}

export interface ItemView {
  id: string;
  patientId: PatientId;
  kind: string;
  label: string;
  /** the bay it sits in, and where in the bay */
  location: LocationId;
  where: 'bedside' | 'chair' | 'foot';
  inspected: boolean;
  /** handed back to the patient (`give_item`): it lies beside them in bed */
  given?: boolean;
}

export type IntakeMobility = 'walking' | 'wheelchair' | 'stretcher';
export interface NpcView {
  id: NpcId;
  name: string;
  role: NpcRole;
  title: string; // "RN", "Attending", "Patient — Bed 2", "Daughter"
  location: LocationId;
  /** named spot inside the location: 'bed' | 'bedside' | 'chair-2' | 'desk-1' | 'center' ... */
  spot: string;
  posture: Posture;
  activity?: string;
  appearance: Appearance;
  patientId?: PatientId;
  /** Home discharge involving this patient or the assigned bedside nurse. */
  discharge?: DischargeProgress;
  /** Patient actor whose transport handles this crew member is pushing. */
  escortOf?: string;
  /** Current bedside nursing task, after matching the patient and treatment space. */
  bedsidePatientId?: PatientId;
  /** Public arrival in progress. The clinical encounter opens when the patient reaches the bay. */
  walkIn?: { patientId: string; sex: Sex; since: GameTime; until: GameTime; from: { x: number; z: number; rot?: number }; bed: LocationId; mobility?: IntakeMobility; stage?: 'intake' | 'bed' | 'return' };
  talkable: boolean;
  /**
   * talkable off the record (server/npc/smalltalk.ts): the waiting-room crowd, registration, security,
   * housekeeping, the cafeteria and the clinic. Small talk only: never scored or logged, no game time
   */
  offRecord?: boolean;
  emotion?: Emotion;
  /** latest ambient line (speech bubble) */
  bark?: { text: string; t: GameTime };
  visible: boolean;
  /** waiting-room life (server/sim/ambient.ts): purely visual, never part of gameplay or the agent API */
  ambient?: AmbientNpcView;
  /** a patient on their bed or stretcher: the head of the bed and how they lie or sit on it (view only) */
  bedPosition?: BedPosition;
  /** a patient in the CT or X-ray room: the study and its slot there (view only; client/src/world/imagingLife.ts plays it) */
  scan?: ScanView;
}

/** a study being done in the CT or X-ray room (NpcView.scan): what is played there, and from when to when */
export interface ScanView {
  modality: 'CT' | 'XR' | 'MRI';
  /** order code ('ct_abd_iv', 'xr_chest', …) and its name */
  code: string;
  study: string;
  /** game time the patient was sent, and when the simulation brings them back */
  since: GameTime;
  until: GameTime;
}

/**
 * What an ambient body is doing; the client picks the mocap clip (or an upper-body layer over
 * sitting/standing) for it. Seated vs standing comes from `posture`.
 */
export type AmbientAct =
  | 'idle'
  | 'wait'
  | 'look'
  | 'stretch'
  | 'yawn'
  | 'cough'
  | 'touch_face'
  | 'impatient'
  | 'talk'
  | 'talk_angry'
  | 'listen'
  | 'laugh'
  | 'phone_text'
  | 'phone_call'
  | 'film'
  | 'drink'
  | 'carry'
  | 'push'
  | 'clipboard'
  | 'sleep'
  | 'crouch'
  | 'crouch_talk'
  | 'unsteady'
  | 'buckle'
  | 'floor'
  | 'come_round'
  /** squatting at the feet of someone lying (look), their ankles in both hands: the legs raised for a faint */
  | 'hold_legs'
  /** standing beside someone (look), hands on their arm while they get up and sit down */
  | 'steady'
  /** seated: a broadsheet held open in both hands, a page turned now and then */
  | 'read'
  /** seated: typing on a laptop on the lap */
  | 'laptop';

/** objects worn or carried by ambient people (built procedurally: client/src/world/accessories.ts) */
export type AmbientProp = 'phone' | 'earbuds' | 'headphones' | 'mask' | 'icepack' | 'bandage' | 'sling' | 'walker' | 'carrier' | 'can' | 'clipboard' | 'towel' | 'wheelchair' | 'newspaper' | 'laptop';

/** one-shot sounds an ambient person makes (client: audio module, positional) */
export type AmbientCue = 'dog_bark' | 'cough' | 'overhead';

export interface AmbientNpcView {
  /** true = a crowd member that exists only for atmosphere; false = real staff borrowed for a moment */
  crowd: boolean;
  act?: AmbientAct;
  /** exact place to be (overrides `spot`): x, z (meters) and facing yaw */
  at?: { x: number; z: number; rot: number };
  /** walking pace to `at` (m/s); 2.3 and up runs */
  pace?: number;
  /** turn the head (and, while standing still, the body) toward this NPC */
  look?: string;
  props?: AmbientProp[];
  /** quiet talk without audio (mouth + gestures) until this game time */
  murmurUntil?: GameTime;
  /** a one-shot sound; `t` dedupes it, `text` is what an overhead page says */
  cue?: { kind: AmbientCue; t: GameTime; text?: string };
  /** rides in a wheelchair pushed by this NPC (stays seated while moving) */
  pushedBy?: string;
  /** lying with the legs raised (someone holds them up: a faint) */
  legsUp?: boolean;
  /** keep animating at full rate off-screen (an emergency in progress) */
  urgent?: boolean;
}

// ───────────────────────────── conversations & phone ─────────────────────────────

export interface ChatLine {
  id: string;
  t: GameTime;
  speaker: 'player' | 'npc' | 'system';
  name: string;
  text: string;
  emotion?: Emotion;
}

export interface ConversationView {
  key: string; // npc id or "phone:<contactId>"
  npcId?: NpcId;
  contactId?: string;
  title: string;
  lines: ChatLine[];
  typing: boolean;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  org: string;
  phone: string;
  kind: 'internal' | 'external';
  description?: string;
  /** related patient (GP office, family, insurer) */
  patientId?: PatientId;
}

export interface PageView {
  id: string;
  t: GameTime;
  from: string;
  text: string;
  priority: 'info' | 'urgent' | 'critical';
  patientId?: PatientId;
  read: boolean;
}

// ───────────────────────────── exam ─────────────────────────────

export interface ExamManeuverDef {
  id: string;
  label: string;
  system: string;
  /** default finding when the case does not override it */
  normal: string;
  minutes: number;
  /** requires chaperone (e.g. pelvic exam) */
  chaperone?: boolean;
}

export interface ExamFinding {
  maneuver: string;
  label: string;
  system: string;
  text: string;
  t: GameTime;
}

// ───────────────────────────── actions (human + AI share these) ─────────────────────────────

export type Action =
  | { type: 'add_roster_patient' }
  /** walk to a location (AI: costs walking time; human client: reports position changes) */
  | { type: 'move'; to: LocationId }
  /** say something to an NPC in the same location (patient, family, nurse, attending, tech) */
  | { type: 'talk'; npcId: NpcId; text: string; topic?: 'night-radio' }
  /** perform an exam maneuver on a patient (must be at bedside) */
  | { type: 'examine'; patientId: PatientId; maneuver: string }
  /** place an order (must be at a workstation, or as a verbal order via 'talk' to a nurse) */
  | { type: 'order'; patientId: PatientId; code: string; params?: OrderParams; priority?: Priority }
  | { type: 'cancel_order'; orderId: string }
  /** speak on the phone (starts the call if needed; must be at a phone) */
  | { type: 'call'; contactId: string; text: string; patientId?: PatientId }
  | { type: 'hangup'; contactId: string }
  /** read part of the chart — for AI agents this returns text; humans use the EHR UI */
  | { type: 'ehr_view'; patientId: PatientId; section: EhrSection; query?: string }
  | { type: 'sign_ecg'; ecgId: string; interpretation: string }
  | { type: 'note'; patientId: PatientId; title: string; text: string }
  | { type: 'set_diagnoses'; patientId: PatientId; diagnoses: string[] }
  | { type: 'disposition'; patientId: PatientId; decision: Dispo; service?: string; diagnoses: string[]; instructions?: string; wheelchair?: boolean }
  | { type: 'assign_self'; patientId: PatientId }
  | { type: 'ack_page'; pageId: string }
  | { type: 'mark_read'; patientId: PatientId }
  /** pick up and look at a patient's belongings/documents at the bedside (must be in that bay) */
  | { type: 'inspect'; itemId: string }
  /** hand a patient's belonging back to them (must be in that bay): it lies beside them in bed; not scored */
  | { type: 'give_item'; itemId: string }
  /**
   * call the supervising attending about a patient (any time, from anywhere): 'bedside' = she walks
   * over now and is talkable there; 'call' = her phone line opens (contact "attending")
   */
  | { type: 'escalate'; patientId: PatientId; mode: EscalationMode; reason?: string }
  /**
   * hand hygiene (an alcohol rub, or washing with soap and water) or putting a surgical mask on or
   * taking it off, wherever you are now; `at` names the dispenser or sink. Costs no game time. Recorded
   * for the debrief's infection-control section (WHO moments 1 and 4, masks where required); not scored.
   */
  | { type: 'hygiene'; kind: HygieneKind; at?: string }
  | { type: 'wait'; minutes: number }
  | { type: 'end_shift' };

export type EhrSection =
  | 'summary'
  | 'vitals'
  | 'labs'
  | 'imaging'
  | 'ecg'
  | 'orders'
  | 'mar'
  | 'notes'
  | 'history'
  | 'board';

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** reply text for talk/call, findings for exam, chart text for ehr_view */
  text?: string;
  data?: unknown;
  /** game minutes consumed (step mode) */
  costMin?: number;
}

// ───────────────────────────── escalation to the attending ─────────────────────────────

/** 'bedside' = come now; 'call' = talk it through on the phone */
export type EscalationMode = 'bedside' | 'call';

/** An escalation as the player sees it (PlayerView.escalations): who is coming where, or whose line is open. */
export interface EscalationView {
  id: string;
  patientId: PatientId;
  bedLabel: string;
  mode: EscalationMode;
  attendingId: NpcId;
  attendingName: string;
  /** bedside: en_route → at_bedside → done; call: on_call (her line stays in the phone directory) */
  status: 'en_route' | 'at_bedside' | 'on_call' | 'done';
  t: GameTime;
  /** bedside: when she is (expected) at the patient */
  etaT?: GameTime;
  arrivedT?: GameTime;
  reason?: string;
  /** call: the phone contact id of her line */
  contactId?: string;
}

/** Debrief: one escalation and the patient's state at that moment (listed for reflection; not scored). */
export interface EscalationRecord {
  t: GameTime;
  patientId: PatientId;
  name: string;
  bedLabel: string;
  mode: EscalationMode;
  reason?: string;
  /** measured at the moment of escalation: HR, BP, RR, SpO₂ (+ O₂ delivery), GCS */
  vitals: Vitals;
  onMonitor: boolean;
  /** bedside-monitor alarms active then (a patient not on a monitor has none) */
  alarms: string[];
  /** SBP < 90 or MAP < 65, SpO₂ < 90 %, GCS ≤ 8 or down ≥ 2 within the hour, a lethal rhythm, or an active critical page */
  unstable: boolean;
  /** which of those criteria were met (empty when stable) */
  why: string[];
  /** bedside: when the attending reached the patient */
  arrivedAt?: GameTime;
}

// ───────────────────────────── scoring / debrief ─────────────────────────────

export type ScoreKind = 'critical' | 'dx' | 'dispo' | 'harm' | 'stewardship' | 'history' | 'safety' | 'time' | 'exam';

export interface ScoreItem {
  id?: string;
  kind: ScoreKind;
  label: string;
  points: number;
  max: number;
  ok: boolean;
  detail?: string;
}

export interface CaseDebrief {
  caseId?: string;
  /** Shown after the shift; older saved runs do not have authorship information. */
  origin?: { kind: 'original' | 'adapted' | 'legacy'; author: string; review: string; source?: { recordId: string; url: string; license: string } };
  patientId: PatientId;
  name: string;
  bedLabel: string;
  caseTitle: string;
  trueDiagnosis: string;
  yourDiagnoses: string[];
  dxVerdict: 'correct' | 'partial' | 'incorrect' | 'none';
  disposition?: Dispo;
  expectedDispositions: Dispo[];
  dispoCorrect: boolean | null;
  score: number;
  maxScore: number;
  items: ScoreItem[];
  keyFacts: { label: string; elicited: boolean; source: string }[];
  teaching: string[];
  references: string[];
  outcome: string;
  costUSD: number;
  timeline: { t: GameTime; text: string }[];
}

export interface Debrief {
  mapId: string;
  mapTitle: string;
  playerName: string;
  seed: number;
  score: number;
  maxScore: number;
  percent: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  endedAt: GameTime;
  costUSD: number;
  cases: CaseDebrief[];
  safetyEvents: { label: string; caught: boolean; points: number; detail: string }[];
  /** every escalation to the attending, in order (not scored) */
  escalations?: EscalationRecord[];
  /** hand hygiene and masks (not scored) */
  infectionControl?: InfectionControlDebrief;
}

// ───────────────────────────── settings / session ─────────────────────────────

export interface GameSettings {
  /** game seconds per real second (realtime mode) */
  timeScale: number;
  /** slow the clock while a conversation/EHR is open */
  focusSlowdown: boolean;
  paused: boolean;
  units: UnitSystem;
  tts: boolean;
  hints: boolean;
}

export interface LlmStatus {
  provider: 'claude-code' | 'anthropic-api' | 'codex' | 'openai-api' | 'vllm' | 'offline';
  label: string;
  model?: string;
  ok: boolean;
  detail?: string;
}

// ───────────────────────────── LLM usage (tokens / cost) ─────────────────────────────

/** Token and cost totals over a set of LLM calls. Costs are list-price USD — "API-equivalent" for subscription logins. */
export interface UsageTotals {
  /** NPC turns (one provider call each) or, for an agent, assistant messages */
  calls: number;
  /** underlying API requests (a turn may retry, e.g. structured-output validation) */
  requests: number;
  /** uncached input */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
  /** summed wall-clock latency in ms (average = latencyMs / calls) */
  latencyMs: number;
}

/** Optional estimate coverage; older usage records and other providers retain their shape. */
export interface PricedUsageTotals extends UsageTotals {
  codexPricedCalls?: number;
  codexUnpricedCalls?: number;
  openaiPricedCalls?: number;
  openaiUnpricedCalls?: number;
}

/** Subscription usage windows, as reported by Claude Code's rate_limit_event (if any). */
export interface PlanWindow {
  id: string; // five_hour | seven_day | seven_day_opus | …
  label: string;
  /** 0–1 */
  utilization: number;
  /** epoch seconds */
  resetsAt?: number;
  status?: string;
}

export interface PlanUsage {
  windows: PlanWindow[];
  status?: string;
  /** the window the CLI reports as binding */
  limitingWindow?: string;
  usingOverage?: boolean;
  /** epoch ms when observed */
  at: number;
}

/** The AI doctor's own spend (reported by agents/claude-doctor.ts), cumulative for this session. */
export interface AgentUsageView extends PricedUsageTotals {
  /** false when token counts are available but dollar cost is not */
  costAvailable?: boolean;
  label: string;
  model?: string;
  billing: 'subscription' | 'api' | 'unknown';
  final: boolean;
  plan?: PlanUsage;
  /** epoch ms of the last report */
  at: number;
}

export interface UsageView {
  costAvailable?: boolean;
  provider: LlmStatus['provider'];
  models: string[];
  /** costs are list-price estimates for a subscription login, not a bill */
  apiEquivalent: boolean;
  session: PricedUsageTotals;
  byNpc: { key: string; name: string; totals: PricedUsageTotals }[];
  agent?: AgentUsageView;
  /** NPC usage today across all shifts (local day, persisted) */
  today: PricedUsageTotals;
  /** NPC usage since this server process started */
  process: PricedUsageTotals;
  plan?: PlanUsage;
  budget?: { maxTokens?: number; maxUsd?: number; exceeded: boolean };
}

/** GET /api/usage */
export interface UsageSummary {
  provider: LlmStatus['provider'];
  models: string[];
  apiEquivalent: boolean;
  process: { since: string; npc: PricedUsageTotals; agent: PricedUsageTotals };
  today: { date: string; npc: PricedUsageTotals; agent: PricedUsageTotals };
  allTime: { since?: string; npc: PricedUsageTotals; agent: PricedUsageTotals };
  plan?: PlanUsage;
  budget?: { maxTokens?: number; maxUsd?: number; exceeded: boolean; usedTokens: number; usedUSD: number };
  sessions: { id: string; map?: string; player?: string; createdAt: string; npc: PricedUsageTotals; byNpc: UsageView['byNpc']; agent?: AgentUsageView }[];
}

export interface MapSummary {
  kind?: 'practice' | 'mixed';
  specialty?: string;
  id: string;
  title: string;
  subtitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  patients: number;
  shiftStart: string;
  durationMin: number;
  layoutId: string;
  learningGoals: string[];
}

export interface MonitorView {
  patientId: PatientId;
  hr: number;
  sbp: number;
  dbp: number;
  spo2: number;
  rr: number;
  rhythm: EcgParams['rhythm'];
  /** active alarm text, e.g. "SBP LOW" */
  alarm?: string;
  /** ST deviation in lead II (mm), drives the monitor trace */
  stII?: number;
}

export interface PlayerView {
  sessionId: string;
  mapId: string;
  mapTitle: string;
  layoutId: string;
  t: GameTime;
  clockStart: string; // "22:00"
  durationMin: number;
  mode: 'realtime' | 'step';
  settings: GameSettings;
  /** masked: a surgical mask on (Action 'hygiene' mask_on / mask_off) */
  player: { name: string; location: LocationId; focus?: 'chat' | 'ehr' | 'phone' | null; masked?: boolean; gloved?: boolean };
  board: PatientBoardRow[];
  rosterCapacity?: { occupied: number; beds: number; approaching: number; available: number; canAdd: boolean };
  npcs: NpcView[];
  pages: PageView[];
  conversations: ConversationView[];
  contacts: Contact[];
  examFindings: Record<PatientId, ExamFinding[]>;
  chartVersions: Record<PatientId, number>;
  /** live bedside monitors (only patients on continuous monitoring), keyed by bay/room id */
  monitors: Record<LocationId, MonitorView>;
  /** patients' belongings/documents at the bedside that can be picked up and inspected */
  items?: ItemView[];
  /** escalations to the attending this shift, oldest first (the HUD shows the one on her way) */
  escalations?: EscalationView[];
  ended: boolean;
  llm: LlmStatus;
  /** LLM token/cost usage for this shift (NPCs, plus the AI doctor if one reports) */
  usage?: UsageView;
  hint?: string;
  /** who plays this shift; absent = a human (older servers, mocks) */
  driver?: DriverView;
}

// ───────────────────────────── AI doctor (observe mode) ─────────────────────────────

/**
 * Who plays a session. Humans play in the 3D client (WebSocket "start"); agents play over
 * REST/MCP and appear in the world as the `ai_doctor` NPC, which spectators can follow.
 */
export interface DriverView {
  kind: 'human' | 'agent';
  /** the agent's display name, e.g. "Claude sonnet" or "Scripted baseline" */
  label?: string;
  model?: string;
  /** launched from the menu (POST /api/observe): the server owns the process and can stop it */
  observe?: boolean;
  /** real-time pause between the agent's actions so watchers can follow (seconds, 0 = none) */
  paceSec?: number;
}

/**
 * A watcher's own conversation with an NPC while watching an AI doctor (server/npc/watcher.ts).
 * Off the record: never in the session's conversations, the agent's observation or the run log.
 */
export interface WatcherThreadView {
  sessionId: string;
  npcId: NpcId;
  title: string;
  lines: ChatLine[];
  typing: boolean;
}

/** thought/action/result/reflection come from the agent (POST /api/sessions/:id/narration); event/system from the server */
export type NarrationKind = 'thought' | 'action' | 'result' | 'reflection' | 'event' | 'system';

/** One line of the AI resident's think-aloud feed, kept in a bounded ring buffer per session. */
export interface NarrationEntry {
  /** increasing per session */
  id: number;
  /** game time when it was said */
  t: GameTime;
  /** epoch ms */
  at: number;
  kind: NarrationKind;
  text: string;
  patientId?: PatientId;
  tone?: 'info' | 'good' | 'warn' | 'bad';
}

// ───────────────────────────── wire protocol (WebSocket) ─────────────────────────────

export type ClientMsg =
  | { type: 'slots'; owner: string }
  | { type: 'save_slot'; owner: string; slot: number; revision: string | null; name: string; player: PlayerSave }
  | { type: 'load_slot'; owner: string; slot: number }
  | { type: 'leave_solo' }
  | { type: 'start'; owner?: string; mapId: string; seed?: number; playerName: string; settings?: Partial<GameSettings>; npc?: NpcSelection }
  | { type: 'resume'; sessionId: string; driverToken?: string }
  | { type: 'action'; action: Action; reqId?: string }
  | { type: 'settings'; settings: Partial<GameSettings> }
  | { type: 'focus'; focus: 'chat' | 'ehr' | 'phone' | null }
  | { type: 'chart'; patientId: PatientId }
  /** observe mode: the watcher's own off-the-record talk with an NPC (server/npc/watcher.ts); never an action */
  | { type: 'watcher_talk'; watcherId: string; npcId: NpcId; text: string }
  | { type: 'watcher_thread'; watcherId: string; npcId: NpcId }
  /**
   * a staff member's line prompted by what this player does in the 3D world, off the record (the
   * cafeteria's cashier asking for a coffee: client/src/world/payment.ts). The server only voices it
   * and sends it back to this socket as a speech event; never an action, never in the session or its log
   */
  | { type: 'aside'; npcId: NpcId; text: string }
  | { type: 'ping' };

/** Server TTS mode (--tts): Kokoro neural voices, browser voices only, or silent. */
export type TtsMode = 'kokoro' | 'browser' | 'off';

/** Voice attached to a speech event by the server (absent when TTS is off). */
export interface SpeechVoice {
  /** cast Kokoro voice id, e.g. "af_heart" (af/am = US female/male, bf/bm = UK female/male) */
  id: string;
  /** speaking rate, 1 = normal */
  speed: number;
  /** neural clips in playback order, one per sentence: GET /api/tts/:id → audio/wav. id '' or no clips → browser voice */
  clips?: { id: string; text: string }[];
  /** telephone line: the client applies a band-pass */
  phone?: boolean;
}

export type GameEvent =
  | { kind: 'page'; page: PageView }
  /** `volume` < 1: quiet background talk (waiting-room small talk, server/sim/ambient.ts); `ambient` lines are never gameplay */
  | { kind: 'speech'; lineId?: string; npcId?: NpcId; contactId?: string; name: string; text: string; emotion?: Emotion; voice?: SpeechVoice; volume?: number; ambient?: boolean }
  | { kind: 'arrival'; patientId: PatientId; text: string; mode: string }
  | { kind: 'result'; patientId: PatientId; text: string; critical?: boolean }
  | { kind: 'toast'; text: string; tone?: 'info' | 'good' | 'warn' | 'bad' }
  | { kind: 'alarm'; patientId: PatientId; text: string }
  /** a line of the AI resident's think-aloud feed (agent-driven sessions only) */
  | { kind: 'narration'; entry: NarrationEntry }
  | { kind: 'ended' };

export type ServerMsg =
  | { type: 'slots'; slots: (SlotInfo | null)[] }
  | { type: 'slot_saved'; info: SlotInfo }
  | { type: 'slot_loaded'; player: PlayerSave; sessionId: string }
  | { type: 'slot_error'; message: string }
  /** ttsNote: why the voices are not what was asked for (e.g. the optional neural engine isn't installed) */
  | { type: 'welcome'; version: string; llm: LlmStatus; online?: boolean; maps: MapSummary[]; tts?: TtsMode; ttsNote?: string }
  /** online/offline switched on the title screen (POST /api/llm-mode): the new default, for every open tab */
  | { type: 'llm'; llm: LlmStatus; online: boolean }
  | { type: 'state'; view: PlayerView }
  | { type: 'chart'; chart: PatientChart }
  | { type: 'actionResult'; reqId?: string; result: ActionResult }
  | { type: 'event'; event: GameEvent }
  | { type: 'debrief'; debrief: Debrief }
  /** to one watcher only: their thread with an NPC after a watcher_talk / watcher_thread */
  | { type: 'watcher_chat'; thread: WatcherThreadView; error?: string }
  | { type: 'error'; message: string };

// ───────────────────────────── helpers ─────────────────────────────

/** "22:00" + seconds → "22:47" (wraps past midnight) */
export function clockAt(clockStart: string, t: GameTime): string {
  const [h, m] = clockStart.split(':').map(Number);
  const total = Math.floor((h * 60 + m) * 60 + t);
  const mins = Math.floor(total / 60) % (24 * 60);
  const hh = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const mm = ((mins % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function minutes(t: GameTime): number {
  return t / 60;
}

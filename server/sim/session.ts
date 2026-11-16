/**
 * GameSession — authoritative simulation of one shift for one player (human or AI).
 *
 * Everything the player can observe is derived from this state via views.ts;
 * hidden truth (case definitions, physiology) never leaves the server.
 */
import { CASES } from '../../content/scenarios';
import { resolveScenario } from './shiftRoster';
import type { CaseDef, EffectDef, PhoneContactDef, ScenarioDef, StaffDef, StaffErrorDef } from '../../content/types';
import { ANALYTES, EXAM_BY_ID, ORDERS } from '../../shared/catalog';
import { pocusWindowOf } from '../../shared/pocus';
import { dischargeExit, dischargePickup, LAYOUTS, roomById, spotFor, walkSeconds, type LayoutDef } from '../../shared/layout';
import { upperRoom, walkSecondsAny } from '../../shared/floors';
import type {
  Action,
  ActionResult,
  ChatLine,
  DischargeProgress,
  DispositionView,
  EcgView,
  Emotion,
  ExamFinding,
  GameEvent,
  GameSettings,
  ImagingView,
  IntakeMobility,
  LabResultView,
  LocationId,
  MarEntry,
  NoteView,
  OrderParams,
  OrderView,
  PageView,
  PatientFlowStatus,
  Posture,
  Priority,
  VitalsEntry,
} from '../../shared/types';
import { UNAVAILABLE_RESULT, computeFlag, formatLabValue, formatVitalsLine, labUnit, map as mapOf, spokenVitals } from '../../shared/units';
import type { NpcBrain } from '../npc/brain';
import { route, routeLength, Walker, WALK_SPEED } from './walker';
import { AmbientLife } from './ambient';
import { ATTENDING_LINE, attendingEnRoute, endBedsideVisitOnExit, escalate, holdForEscalation, type EscalationState } from './escalation';
import { hygieneAction, recordContact, recordMove, type IcEvent } from './hygiene';
import { Physiology } from './physiology';
import { ultrasoundRead } from './pocus';
import { hashSeed, Rng } from './rng';

export const M = 60;

// ───────────────────────────── state types ─────────────────────────────

export interface LogEntry {
  t: number;
  kind:
    | 'order'
    | 'cancel'
    | 'collected'
    | 'given'
    | 'fact'
    | 'counseled'
    | 'exam'
    | 'call'
    | 'consult_accept'
    | 'ecg_signed'
    | 'vitals'
    | 'dispo'
    | 'flag'
    | 'dx'
    | 'safety'
    | 'talk'
    | 'inspect'
    | 'result'
    /** escalated to the attending: decision = mode, text = reason */
    | 'escalate';
  pid?: string;
  code?: string;
  orderId?: string;
  tags?: string[];
  volumeMl?: number;
  byError?: string;
  factId?: string;
  id?: string;
  maneuver?: string;
  contactId?: string;
  correct?: boolean;
  vars?: string[];
  decision?: string;
  flag?: string;
  diagnoses?: string[];
  errorId?: string;
  caught?: boolean;
  npcId?: string;
  text?: string;
}

export interface OrderState extends OrderView {
  /** administration handled by a scripted event (no automatic nurse task after verification) */
  noAutoGive?: boolean;
  resultDueT?: number;
  imagingId?: string;
  volumeMl?: number;
}

export type TaskKind = 'draw' | 'urine' | 'poc' | 'give' | 'nursing' | 'ecg' | 'supply' | 'assess' | 'vitals' | 'transport' | 'wrong_med' | 'escalate' | 'discharge';

export interface Task {
  id: string;
  staffId: string;
  kind: TaskKind;
  pid?: string;
  orderIds: string[];
  location: LocationId;
  durationMin: number;
  priority: number;
  createdT: number;
  startT?: number;
  endT?: number;
  label: string;
  done: (task: Task) => void;
  onStart?: (task: Task) => void;
  canceled?: boolean;
  meta?: Record<string, unknown>;
}

export interface StaffState {
  def: StaffDef;
  location: LocationId;
  spot: string;
  posture: Posture;
  activity?: string;
  queue: Task[];
  current?: Task;
  bark?: { text: string; t: number };
  idleSinceT: number;
  nextBarkT: number;
  visible: boolean;
}

export interface FamilyState {
  status: 'absent' | 'present' | 'out';
  returnT?: number;
}

export interface PatientState {
  id: string;
  c: CaseDef;
  arrivalT: number;
  bed: LocationId;
  bedLabel: string;
  nurseId: string;
  arrived: boolean;
  departed: boolean;
  departT?: number;
  location: LocationId;
  flow: PatientFlowStatus;
  physio: Physiology;
  orders: OrderState[];
  labs: LabResultView[];
  vitals: VitalsEntry[];
  ecgs: EcgView[];
  mar: MarEntry[];
  notes: NoteView[];
  imaging: ImagingView[];
  diagnoses: string[];
  dispo?: DispositionView;
  discharge?: DischargeProgress;
  acceptedBy?: string;
  onMonitor: boolean;
  ivAccess: boolean;
  npo: boolean;
  o2?: string;
  alerts: string[];
  version: number;
  emotion: Emotion;
  exam: ExamFinding[];
  revealed: Set<string>;
  /** belongings/documents already inspected (CaseItemDef ids) */
  inspected: Set<string>;
  /** belongings handed back to the patient (CaseItemDef ids): they lie beside them in bed */
  given: Set<string>;
  counseled: Set<string>;
  family?: FamilyState;
  newResults: number;
  firstContactT?: number;
  doctor?: string;
  vitalsEveryMin: number;
  nextVitalsT: number;
  nextMonitorRecordT: number;
  firedTriggers: Set<string>;
  allergiesReviewed: boolean;
  /** time when an imaging hold page was last sent */
  holdPagedT?: number;
  /**
   * in the CT or X-ray room now: which study and its slot (views.ts shows it to the 3D suite; view
   * only: never logged, scored or read back by the simulation)
   */
  scan?: { room: LocationId; code: string; since: number; until: number };
  waitComplaintsSent: number;
}

export interface Conversation {
  key: string;
  npcId?: string;
  contactId?: string;
  pid?: string;
  title: string;
  lines: ChatLine[];
  typing: boolean;
  /** LLM-facing history: user turns carry [Situation] notes, assistant turns are the JSON replies */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** phone: identifiers verified (name + DOB said) per patient */
  verified?: Set<string>;
}

export interface SafetyState {
  def: StaffErrorDef;
  pid: string;
  status: 'pending' | 'active' | 'caught' | 'missed' | 'na';
  t?: number;
  detail?: string;
}

export interface SessionOptions {
  scenarioId: string;
  /** a scenario built at run time instead of SCENARIOS[scenarioId] */
  scenario?: ScenarioDef;
  /** Saved composed shift, including the original draw if the case catalog has grown. */
  roster?: ScenarioDef['patients'];
  /** a fixed session id; default s_<time>_<seeded> */
  id?: string;
  seed?: number;
  playerName: string;
  mode: 'realtime' | 'step';
  settings?: Partial<GameSettings>;
  brain: NpcBrain;
}

type RosterEntry = ScenarioDef['patients'][number];
type IntakeSpot = { x: number; z: number; rot: number };
interface IntakeTrip {
  patient: PatientState;
  walker: Walker;
  since: number;
  from: IntakeSpot;
  to: IntakeSpot;
  mobility: IntakeMobility;
  entrance: 'public' | 'ems';
  stage: 'intake' | 'bed' | 'return';
}

type Listener = (e: GameEvent) => void;

const DEFAULT_SETTINGS: GameSettings = { timeScale: 6, focusSlowdown: true, paused: false, units: 'US', tts: false, hints: true };

// ───────────────────────────── session ─────────────────────────────

export class GameSession {
  readonly id: string;
  readonly scenario: ScenarioDef;
  readonly layout: LayoutDef;
  readonly seed: number;
  readonly rng: Rng;
  readonly mode: 'realtime' | 'step';
  readonly playerName: string;
  readonly brain: NpcBrain;
  reply: NpcBrain['reply'];
  nextChatLine = 0;
  settings: GameSettings;
  t = 0;
  playerLocation: LocationId;
  focus: 'chat' | 'ehr' | 'phone' | null = null;
  patients = new Map<string, PatientState>();
  /** A walk-in reserves a bed but has no open encounter until physically roomed. */
  readonly incoming = new Map<string, IntakeTrip>();
  /** Holding places at registration and EMS handover do not occupy a clinical bed. */
  readonly holding = new Map<string, IntakeTrip>();
  readonly returning = new Map<string, IntakeTrip>();
  private readonly admittedEarly = new Set<RosterEntry>();
  staff = new Map<string, StaffState>();
  pages: PageView[] = [];
  conversations = new Map<string, Conversation>();
  log: LogEntry[] = [];
  flags = new Set<string>();
  safety: SafetyState[] = [];
  /** escalations to the attending, oldest first (escalation.ts) */
  escalations: EscalationState[] = [];
  /** hand hygiene, masks, where you went and whom you examined (hygiene.ts; beside the scoring log, never in it) */
  ic: IcEvent[] = [];
  /** a surgical mask on (Action 'hygiene') */
  masked = false;
  /** non-sterile gloves on (Action 'hygiene') */
  gloved = false;
  ended = false;
  endedAt?: number;
  private timers: { t: number; seq: number; fn: () => void }[] = [];
  /** Patients physically on their way out, with the game seconds per real second used for their ETA. */
  private homeExits = new Map<PatientState, number>();
  private roomQueue: ScenarioDef['patients'] = [];
  private entranceFreeT = 0;
  private seq = 0;
  private listeners = new Set<Listener>();
  private lastPhysioCheck = -999;
  dirty = true;
  createdAt = Date.now();
  lastActivity = Date.now();
  playerContacts = new Map<string, PhoneContactDef>();
  /** waiting-room life (ambient.ts): own seed stream, writes nothing here, only the 3D view sees it */
  readonly ambient: AmbientLife;

  constructor(opts: SessionOptions) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    const scenario = opts.scenario ?? resolveScenario(opts.scenarioId, this.seed, opts.roster);
    if (!scenario) throw new Error(`Unknown map "${opts.scenarioId}"`);
    this.scenario = scenario;
    this.layout = LAYOUTS[scenario.layoutId];
    this.rng = new Rng(this.seed);
    this.mode = opts.mode;
    this.playerName = opts.playerName || 'Resident';
    this.brain = opts.brain;
    this.reply = opts.brain.reply.bind(opts.brain);
    this.settings = { ...DEFAULT_SETTINGS, timeScale: scenario.defaultTimeScale, ...opts.settings };
    // (the seeded draw happens either way, so a fixed id leaves the rng stream unchanged)
    const tag = Math.floor(this.rng.next() * 1e6).toString(36);
    this.id = opts.id ?? `s_${Date.now().toString(36)}_${tag}`;
    this.playerLocation = 'station';
    this.init();
    this.ambient = new AmbientLife(this);
  }

  // ───────── events ─────────

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(e: GameEvent) {
    this.dirty = true;
    for (const l of this.listeners) l(e);
  }

  page(from: string, text: string, priority: PageView['priority'] = 'info', pid?: string) {
    const p: PageView = { id: `pg${++this.seq}`, t: this.t, from, text, priority, patientId: pid, read: false };
    this.pages.push(p);
    if (this.pages.length > 80) this.pages.shift();
    this.emit({ kind: 'page', page: p });
  }

  bark(staffId: string, text: string, lineId?: string) {
    const s = this.staff.get(staffId);
    if (s) s.bark = { text, t: this.t };
    this.emit({ kind: 'speech', ...(lineId ? { lineId } : {}), npcId: staffId, name: s?.def.name ?? staffId, text });
  }

  logEvent(e: Omit<LogEntry, 't'> & { t?: number }) {
    this.log.push({ t: this.t, ...e } as LogEntry);
  }

  // ───────── timers ─────────

  at(t: number, fn: () => void) {
    this.timers.push({ t, seq: ++this.seq, fn });
    this.timers.sort((a, b) => a.t - b.t || a.seq - b.seq);
  }

  after(minutes: number, fn: () => void) {
    this.at(this.t + minutes * M, fn);
  }

  // ───────── setup ─────────

  private init() {
    for (const s of this.scenario.staff) {
      this.staff.set(s.id, {
        def: s,
        location: s.home.room,
        spot: s.home.spot,
        posture: s.home.spot.startsWith('desk') || s.home.spot.startsWith('chair') || s.home.spot === 'nurse' ? 'sit' : 'stand',
        queue: [],
        idleSinceT: 0,
        nextBarkT: (4 + this.rng.next() * 20) * M,
        visible: true,
      });
    }
    for (const pd of this.scenario.patients) {
      if (this.scenario.bedPool) {
        const queue = () => {
          if (this.admittedEarly.has(pd)) return;
          this.roomQueue.push(pd);
          this.roomNext();
        };
        if (pd.arriveAtMin <= 0) queue();
        else this.at(pd.arriveAtMin * M, queue);
        continue;
      }
      const p = this.makePatient(pd);
      this.registerPatient(p);
      if (p.arrivalT <= 0) this.arrive(p, true);
      else this.at(p.arrivalT, () => this.arrive(p, false));
    }
    // Preserve the authored name-alert exercise on fixed maps.
    if (!this.scenario.bedPool) this.updateNameAlerts([...this.patients.values()]);
    // safety errors
    for (const e of this.scenario.errors) {
      const caseId = e.kind === 'wrong_patient_med' ? e.wrongCaseId : e.caseId;
      const p = [...this.patients.values()].find((x) => x.c.id === caseId);
      if (!p) continue;
      this.safety.push({ def: e, pid: p.id, status: 'pending' });
      if (e.kind === 'wrong_patient_med') this.at(e.atMin * M, () => this.startWrongPatientMed(e));
    }
    // scripted events
    for (const ev of this.scenario.events) {
      this.at(ev.atMin * M, () => {
        if (ev.kind === 'page') this.page(ev.from ?? 'Charge RN', ev.text, ev.priority ?? 'info');
        else if (ev.kind === 'bark' && ev.npcId) this.bark(ev.npcId, ev.text);
        else if (ev.kind === 'toast') this.emit({ kind: 'toast', text: ev.text });
        else if (ev.kind === 'rounds' && ev.npcId) {
          const s = this.staff.get(ev.npcId);
          const rounds = { location: 'station', spot: 'desk-6', posture: 'sit' as const, activity: 'Board rounds — waiting for you' };
          // at a bedside the resident escalated: rounds wait until she is done there
          const held = !!s && holdForEscalation(this, s.def.id, rounds);
          if (s && !held) {
            s.location = rounds.location;
            s.spot = rounds.spot;
            s.posture = rounds.posture;
            s.activity = rounds.activity;
          }
          this.page(s?.def.name ?? 'Attending', held ? `${ev.text} (Once I'm done at the bedside.)` : ev.text, 'urgent');
          this.flags.add('rounds_started');
        }
      });
    }
    // intro
    for (const i of this.scenario.intro) this.page(i.from, i.text, 'info');
  }

  // ───────── arrivals ─────────

  private updateNameAlerts(roster: PatientState[]) {
    for (const a of roster) {
      const alerts = roster.filter(b => a !== b && a.c.patient.firstName === b.c.patient.firstName
        && similarNames(a.c.patient.lastName, b.c.patient.lastName))
        .map(b => `NAME ALERT: similar name on unit — ${b.c.patient.lastName}, ${b.c.patient.firstName} (${b.bedLabel})`);
      if (alerts.join('|') !== a.alerts.join('|')) {
        a.alerts = alerts;
        // Fixed maps assign these before their first snapshot; a running shift must resend the chart.
        if (this.scenario.bedPool) this.touch(a);
      }
    }
  }

  private makePatient(pd: ScenarioDef['patients'][number]): PatientState {
    const c = CASES[pd.caseId];
    if (!c) throw new Error(`Unknown case ${pd.caseId}`);
    const surnameId = `p_${c.patient.lastName.toLowerCase()}`;
    const id = this.patients.has(surnameId) || this.incoming.has(surnameId) || this.holding.has(surnameId)
      ? `${surnameId}_${this.patients.size + this.incoming.size + this.holding.size + 1}` : surnameId;
    const bedRoom = roomById(this.layout, pd.bed);
    const p: PatientState = {
      id,
      c,
      arrivalT: pd.arriveAtMin * M,
      bed: pd.bed,
      bedLabel: bedRoom?.label ?? pd.bed,
      nurseId: pd.nurseId,
      arrived: false,
      departed: false,
      location: pd.bed,
      flow: 'Waiting',
      physio: new Physiology(c.physiology, `${this.seed}:${id}`),
      orders: [],
      labs: [],
      vitals: [],
      ecgs: [],
      mar: [],
      notes: [],
      imaging: [],
      diagnoses: [],
      onMonitor: false,
      ivAccess: c.presentation.arrivalMode === 'EMS',
      npo: false,
      alerts: [],
      version: 1,
      emotion: c.presentation.initialEmotion,
      exam: [],
      revealed: new Set(),
      inspected: new Set(),
      given: new Set(),
      counseled: new Set(),
      family: c.family ? { status: 'absent' } : undefined,
      newResults: 0,
      vitalsEveryMin: c.presentation.esi <= 2 ? 30 : 60,
      nextVitalsT: 0,
      nextMonitorRecordT: 0,
      firedTriggers: new Set(),
      allergiesReviewed: false,
      waitComplaintsSent: 0,
    };
    return p;
  }

  private registerPatient(p: PatientState) {
    this.patients.set(p.id, p);
    for (const pc of p.c.phoneContacts ?? []) this.playerContacts.set(pc.contact.id, pc);
  }

  private freeBeds() {
    const used = new Set(this.presentPatients().map(p => p.bed));
    for (const { patient } of this.incoming.values()) used.add(patient.bed);
    return this.scenario.bedPool!.filter(r => !used.has(r.bed));
  }

  private openEncounter(p: PatientState) {
    p.arrivalT = this.t;
    this.registerPatient(p);
    this.arrive(p, this.t === 0);
  }

  private intakeTrip(p: PatientState, from: IntakeSpot, to: IntakeSpot, mobility: IntakeMobility,
      entrance: IntakeTrip['entrance'], stage: IntakeTrip['stage'], since = this.t): IntakeTrip {
    const speed = mobility === 'walking' ? 1.25 : 1.05;
    const walker = new Walker(this.layout, this.scenario.defaultTimeScale * WALK_SPEED / speed, from);
    walker.walkTo(since, to.x, to.z, to.rot);
    return { patient: p, walker, since, from, to, mobility, entrance, stage };
  }

  private goToBed(p: PatientState, from: IntakeSpot, mode: IntakeMobility, entrance: IntakeTrip['entrance'], since = this.t) {
    const trolleySpot = mode === 'stretcher' ? roomById(this.layout, p.bed)?.spots.intakeTrolley : undefined;
    const pickup = trolleySpot ?? dischargePickup(this.layout, p.bed)!;
    const parkingYaw = mode !== 'walking' ? spotFor(this.layout, p.bed, 'bed')?.rot : pickup.rot;
    const trip = this.intakeTrip(p, from, { ...pickup, rot: parkingYaw ?? 0 }, mode, entrance, 'bed', since);
    this.incoming.set(p.id, trip);
    this.at(Math.ceil(trip.walker.arrival), () => {
      if (!this.incoming.delete(p.id)) return;
      this.openEncounter(p);
      if (mode !== 'walking') {
        const home = this.intakeOrigin(entrance);
        const toward = (home.x - trip.to.x) * Math.sin(trip.to.rot) + (home.z - trip.to.z) * Math.cos(trip.to.rot);
        const back = this.intakeTrip(p, { ...trip.to, rot: trip.to.rot + (toward < 0 ? Math.PI : 0) }, home, mode, entrance, 'return');
        this.returning.set(p.id, back);
        this.at(Math.ceil(back.walker.arrival), () => { this.returning.delete(p.id); this.dirty = true; });
      }
    });
    this.dirty = true;
  }

  private intakeOrigin(entrance: IntakeTrip['entrance']): IntakeSpot {
    // Rear apron of the parked ambulance, and the pavement outside the public doors.
    return entrance === 'ems' ? { x: 41.6, z: 26.7, rot: Math.PI } : { ...dischargeExit(this.layout), rot: Math.PI };
  }

  /** Move a waiting arrival to a free bed, then let the next person enter at each door. */
  private progressSurge() {
    const free = this.freeBeds();
    for (const [id, trip] of this.holding) {
      if (this.t < trip.walker.arrival || !free.length) continue;
      const p = trip.patient;
      const index = free.findIndex(r => r.bed === p.bed);
      const [room] = free.splice(index >= 0 ? index : 0, 1);
      Object.assign(p, { ...room, bedLabel: roomById(this.layout, room.bed)!.label });
      this.holding.delete(id);
      this.goToBed(p, trip.to, trip.mobility, trip.entrance);
    }
    for (const entrance of ['public', 'ems'] as const) {
      if ([...this.holding.values()].some(v => v.entrance === entrance)) continue;
      const i = this.roomQueue.findIndex(pd => (CASES[pd.caseId].presentation.arrivalMode === 'EMS') === (entrance === 'ems'));
      if (i < 0) continue;
      const [pd] = this.roomQueue.splice(i, 1);
      const p = this.makePatient(pd), pr = p.c.presentation;
      const ems = entrance === 'ems';
      const mode: IntakeMobility = ems || pr.esi <= 2 ? 'stretcher' : pr.walkToBed && pr.dischargeMobility !== 'wheelchair' ? 'walking' : 'wheelchair';
      const from = this.intakeOrigin(entrance);
      const to = ems ? { x: 41.5, z: 19.7, rot: Math.PI } : { x: 6.55, z: 20.0, rot: Math.PI };
      const trip = this.intakeTrip(p, from, to, mode, entrance, 'intake');
      this.holding.set(p.id, trip);
      this.at(Math.ceil(trip.walker.arrival), () => this.progressSurge());
      this.dirty = true;
    }
  }

  /** Only roomed patients enter the chart. Patients visiting CT retain their bed. */
  private roomNext() {
    if (!this.scenario.bedPool) return;
    if (this.layout.treatmentSpaces && this.t > 0) { this.progressSurge(); return; }
    const next = this.roomQueue[0];
    if (!next) return;
    const free = this.freeBeds();
    const room = free.find(slot => slot.bed === next.bed) ?? free[0];
    if (!room) return;
    this.roomQueue.shift();
    const p = this.makePatient({ ...next, ...room, arriveAtMin: this.t / M });
    const entry = p.c.presentation;
    if (this.t > 0 && entry.walkToBed && entry.arrivalMode === 'Walk-in' && entry.esi >= 3 && entry.dischargeMobility !== 'wheelchair') {
      const since = Math.max(this.t, this.entranceFreeT);
      this.entranceFreeT = since + 2 * this.scenario.defaultTimeScale;
      this.goToBed(p, dischargeExit(this.layout), 'walking', 'public', since);
    } else this.openEncounter(p);
  }

  rosterCapacity() {
    if (!this.layout.treatmentSpaces) return undefined;
    const occupied = this.presentPatients().length, beds = this.scenario.bedPool!.length;
    const available = beds - occupied - this.incoming.size;
    return { occupied, beds, approaching: this.holding.size + this.incoming.size, available,
      canAdd: !this.ended && available > 0 && this.patients.size + this.incoming.size < this.scenario.patients.length };
  }

  private addRosterPatient(): ActionResult {
    const capacity = this.rosterCapacity();
    if (!capacity?.canAdd) return { ok: false, message: !capacity ? 'Use Full Roster to add patients.' :
      !capacity.available ? 'Every stretcher is occupied or reserved.' : 'Everyone on the roster has arrived.' };
    const [room] = this.freeBeds();
    let p: PatientState;
    const held = this.holding.values().next().value;
    if (held) {
      p = held.patient;
      this.holding.delete(p.id);
      Object.assign(p, room, { bedLabel: roomById(this.layout, room.bed)!.label });
    } else {
      const next = this.roomQueue.shift() ?? this.scenario.patients.find(pd => pd.arriveAtMin * M > this.t && !this.admittedEarly.has(pd));
      if (!next) return { ok: false, message: 'Everyone on the roster has arrived.' };
      this.admittedEarly.add(next);
      p = this.makePatient({ ...next, ...room });
    }
    this.openEncounter(p);
    if (this.t > 0) this.progressSurge();
    return { ok: true, message: p.bedLabel + ' is ready for assessment.', data: { patientId: p.id, bed: p.bed } };
  }

  private arrive(p: PatientState, preArrived: boolean) {
    const c = p.c;
    p.arrived = true;
    if (this.scenario.bedPool) this.updateNameAlerts(this.presentPatients());
    p.flow = 'Roomed';
    p.location = p.bed;
    const tA = p.arrivalT;
    // registration + EMS + triage records
    if (c.presentation.emsNote) this.addNote(p, { t: tA, type: 'EMS', author: 'Medic 14', title: 'EMS run sheet', text: c.presentation.emsNote });
    const tv = { ...c.presentation.triageVitals };
    let comment: string | undefined;
    const tempErr = this.safety.find((s) => s.pid === p.id && s.def.kind === 'missing_triage_vital');
    if (tempErr && tempErr.def.kind === 'missing_triage_vital') {
      delete (tv as Record<string, unknown>)[tempErr.def.vital];
      comment = tempErr.def.vital === 'temp' ? 'Temp not obtained (patient agitated)' : `${tempErr.def.vital.toUpperCase()} not obtained`;
      tempErr.status = 'active';
      tempErr.t = tA;
    }
    p.vitals.push({ id: `v${++this.seq}`, t: tA + 1 * M, source: 'Triage', by: 'L. Novak RN', comment, ...tv });
    this.addNote(p, { t: tA + 2 * M, type: 'Triage', author: 'Lena Novak, RN', title: `Triage note — ESI ${c.presentation.esi}`, text: c.presentation.triageNote });
    for (const pl of c.presentation.priorLabs ?? []) {
      const tt = -pl.daysAgo * 24 * 60 * M;
      p.labs.push({ id: `h${++this.seq}`, orderId: 'historical', patientId: p.id, analyte: pl.analyte, value: pl.value, collectedAt: tt, resultedAt: tt, flag: computeFlag(pl.analyte, pl.value, c.patient.sex), historical: true });
    }
    p.nextVitalsT = Math.max(this.t, tA) + p.vitalsEveryMin * M;
    p.nextMonitorRecordT = this.t + 15 * M;
    if (c.family && c.family.arrivesAtMin === undefined && p.family) p.family.status = 'present';
    if (c.family?.arrivesAtMin !== undefined) {
      this.at(Math.max(this.t, tA + c.family.arrivesAtMin * M), () => {
        if (p.departed || !p.family) return;
        p.family.status = 'present';
        this.page('Rosa (charge RN)', `${c.family!.name} (${c.family!.relation.split(' ')[0].toLowerCase()} of ${p.bedLabel}) just arrived and is asking for an update.`, 'info', p.id);
        this.touch(p);
      });
    }
    // auto ECG per triage protocol
    if (c.ecg.autoAtMin !== undefined) {
      const when = Math.max(this.t, tA + c.ecg.autoAtMin * M);
      this.at(when, () => this.acquireEcg(p, false, 'Protocol (triage)'));
    }
    // nurse initial assessment
    this.enqueue(p.nurseId, { kind: 'assess', pid: p.id, orderIds: [], location: p.bed, durationMin: 4, priority: c.presentation.esi, label: `Initial assessment — ${p.bedLabel}`, done: () => {} });
    if (!preArrived) {
      this.emit({ kind: 'arrival', patientId: p.id, mode: c.presentation.arrivalMode, text: `New patient: ${p.bedLabel} — ${c.patient.age}${c.patient.sex} ${c.presentation.chiefComplaint} (ESI ${c.presentation.esi}, ${c.presentation.arrivalMode})` });
      if (c.presentation.arrivalMode === 'EMS') this.bark('rn_rosa', `EMS is here — ${p.bedLabel}, ${c.presentation.chiefComplaint.toLowerCase()}.`);
    }
    this.touch(p);
  }

  // ───────── helpers ─────────

  touch(p: PatientState) {
    p.version++;
    this.dirty = true;
  }

  minutesSinceArrival(p: PatientState, t = this.t): number {
    return (t - p.arrivalT) / M;
  }

  addNote(p: PatientState, n: Omit<NoteView, 'id' | 'patientId'>) {
    p.notes.push({ id: `n${++this.seq}`, patientId: p.id, ...n });
    this.touch(p);
  }

  patientByBedOrName(ref: string | undefined, roster = this.presentPatients()): PatientState | undefined {
    if (!ref) return;
    const r = ref.trim().toLowerCase();
    const exact = roster.find(p => p.id === r || p.bed === r || p.bedLabel.toLowerCase() === r);
    if (exact) return exact;
    const namedBed = roster.find(p => r.includes(p.bedLabel.toLowerCase()));
    if (namedBed) return namedBed;
    const fullNames = roster.filter(p => r.includes(`${p.c.patient.firstName} ${p.c.patient.lastName}`.toLowerCase()));
    if (fullNames.length === 1) return fullNames[0];
    const matches = roster.filter(p => r.includes(p.c.patient.lastName.toLowerCase()));
    return matches.length === 1 ? matches[0] : undefined;
  }

  presentPatients(): PatientState[] {
    return [...this.patients.values()].filter((p) => p.arrived && !p.departed);
  }

  dischargePatient(nurse: StaffState): PatientState | undefined {
    const task = nurse.current;
    return task?.kind === 'discharge' && task.pid ? this.patients.get(task.pid) : undefined;
  }

  // ───────── clock ─────────

  /** realtime: advance by real seconds × time scale */
  tick(realDtSec: number) {
    if (this.ended || this.settings.paused || this.mode !== 'realtime') return;
    let scale = this.settings.timeScale;
    if (this.focus && this.settings.focusSlowdown) scale *= 0.35;
    this.advance(realDtSec * scale);
  }

  advance(gameSec: number) {
    const rate = this.exitClockRate();
    for (const [p, previous] of this.homeExits) {
      if (previous === rate) continue;
      const d = p.discharge!;
      const ratio = rate / previous;
      const until = this.t + (d.until! - this.t) * ratio;
      // Keep the same fraction of the route on both sides of a speed/focus change.
      const travelStart = this.t - (this.t - (d.travelStart ?? d.since)) * ratio;
      p.discharge = { ...d, travelStart, until };
      const escort = this.staff.get(d.nurseId)?.current;
      if (escort?.kind === 'discharge' && escort.pid === p.id) escort.endT = until;
      this.homeExits.set(p, rate);
      this.touch(p);
    }
    const target = this.t + gameSec;
    while (this.t < target && !this.ended) {
      const step = Math.min(15, target - this.t);
      this.t += step;
      while (this.timers.length && this.timers[0].t <= this.t) {
        const tm = this.timers.shift()!;
        tm.fn();
      }
      for (const p of this.homeExits.keys()) {
        if (this.t < p.discharge!.until!) continue;
        const nurse = this.staff.get(p.discharge!.nurseId)!;
        if (p.discharge!.mobility === 'wheelchair') {
          nurse.location = 'waiting';
          nurse.spot = 'door';
        }
        this.depart(p);
        this.page(nurse.def.name, `${p.c.patient.firstName} ${p.c.patient.lastName} has left the ED for home.`, 'info', p.id);
      }
      this.processStaff();
      if (this.t - this.lastPhysioCheck >= 30) {
        this.lastPhysioCheck = this.t;
        this.processPatients();
        this.processAmbient();
      }
      if (this.t >= this.scenario.durationMin * M) this.end('Shift over');
    }
    this.ambient.tick();
    this.dirty = true;
  }

  // ───────── staff / tasks ─────────

  enqueue(staffId: string, task: Omit<Task, 'id' | 'staffId' | 'createdT'>): Task {
    const s = this.staff.get(staffId) ?? this.staff.get('rn_rosa')!;
    const full: Task = { id: `t${++this.seq}`, staffId: s.def.id, createdT: this.t, ...task };
    const discharge = task.pid && this.patients.get(task.pid)?.discharge;
    if (discharge && (discharge.phase === 'leaving' || discharge.phase === 'departed')) full.canceled = true;
    s.queue.push(full);
    return full;
  }

  /** pick the less busy of nurse vs tech for blood draws */
  drawer(p: PatientState): string {
    const nurse = this.staff.get(p.nurseId);
    const tech = this.staff.get('tech_marcus');
    if (!tech) return p.nurseId;
    const load = (s?: StaffState) => (s ? s.queue.length + (s.current ? 1 : 0) : 99);
    return load(tech) < load(nurse) ? 'tech_marcus' : p.nurseId;
  }

  private processStaff() {
    for (const s of this.staff.values()) {
      if (s.current && this.t >= (s.current.endT ?? 0)) {
        const task = s.current;
        s.current = undefined;
        if (!task.canceled) task.done(task);
        s.activity = undefined;
        s.idleSinceT = this.t;
        this.dirty = true;
      }
      if (!s.current) {
        s.queue = s.queue.filter((q) => !q.canceled);
        if (s.queue.length) {
          s.queue.sort((a, b) => a.priority - b.priority || a.createdT - b.createdT);
          const task = s.queue.shift()!;
          const p = task.pid ? this.patients.get(task.pid) : undefined;
          const loc = p && task.location === p.bed && p.location !== p.bed && !p.departed ? p.location : task.location;
          let travelSec = walkSeconds(this.layout, s.location, loc);
          if (task.kind === 'discharge' && p?.discharge) {
            const from = spotFor(this.layout, s.location, s.spot);
            const to = dischargePickup(this.layout, loc);
            // Clinical queue tasks use room-entry travel. For a visible handoff allow the actual
            // walk from desk/previous bedside, around walls, plus turning to face the patient.
            if (from && to) {
              const meters = routeLength(route(this.layout, from, to));
              travelSec = Math.ceil((meters / 1.3 + 3) * this.scenario.defaultTimeScale);
            }
            p.discharge = { ...p.discharge, since: this.t, until: this.t + travelSec, from: from && { x: from.x, z: from.z } };
            this.touch(p);
          }
          task.startT = this.t;
          task.endT = this.t + travelSec + task.durationMin * M;
          s.current = task;
          s.location = loc;
          s.spot = roomById(this.layout, loc)?.spots.bedside_l ? 'bedside_l' : loc === 'medroom' ? 'dispenser' : 'entry';
          s.posture = 'stand';
          s.activity = task.label;
          task.onStart?.(task);
          this.dirty = true;
        } else if (this.t - s.idleSinceT > 60 && (s.location !== s.def.home.room || s.spot !== s.def.home.spot) && !s.def.id.startsWith('att_')) {
          s.location = s.def.home.room;
          s.spot = s.def.home.spot;
          s.posture = s.def.home.spot.startsWith('desk') || s.def.home.spot.startsWith('chair') || s.def.home.spot === 'nurse' ? 'sit' : 'stand';
          this.dirty = true;
        }
      }
    }
  }

  private processAmbient() {
    for (const s of this.staff.values()) {
      if (!s.def.barks?.length || this.t < s.nextBarkT) continue;
      // busy nurses, and an attending at an escalated bedside, keep their small talk for later
      if (s.current && (s.def.role === 'nurse' || s.current.kind === 'escalate')) {
        s.nextBarkT = this.t + 5 * M;
        continue;
      }
      s.bark = { text: this.rng.pick(s.def.barks), t: this.t };
      s.nextBarkT = this.t + (10 + this.rng.next() * 25) * M;
      this.dirty = true;
    }
  }

  // ───────── patients: vitals, triggers, monitor, departures ─────────

  private processPatients() {
    for (const p of this.presentPatients()) {
      if (p.discharge?.phase === 'leaving') continue;
      const m = this.minutesSinceArrival(p);
      const ph = p.physio;
      // triggers
      for (const tr of ph.def.triggers ?? []) {
        if (p.firedTriggers.has(tr.id)) continue;
        let fire = false;
        if ('var' in tr.when) {
          const v = ph.value(tr.when.var, m);
          fire = tr.when.op === '<' ? v < tr.when.value : v > tr.when.value;
        } else {
          fire = m >= tr.when.afterMin && !(tr.when.unlessTag && ph.hasTag(tr.when.unlessTag));
          if (tr.when.unlessTag && ph.hasTag(tr.when.unlessTag)) p.firedTriggers.add(tr.id); // averted
          if (p.departed) fire = false;
        }
        if (!fire || p.firedTriggers.has(tr.id)) continue;
        p.firedTriggers.add(tr.id);
        ph.fireTrigger(tr, m);
        if (tr.flag) {
          this.flags.add(`${p.id}:${tr.flag}`);
          this.logEvent({ kind: 'flag', pid: p.id, flag: tr.flag });
        }
        if (tr.emotion) p.emotion = tr.emotion;
        if (tr.page) {
          const from = tr.page.from === 'nurse' ? `${this.staff.get(p.nurseId)?.def.name.split(' ')[0] ?? 'Nurse'} (RN)` : tr.page.from === 'lab' ? 'Lab (Tony)' : tr.page.from === 'tech' ? 'Marcus (tech)' : 'Dr. Shaw';
          this.page(from, this.fill(tr.page.text, p), tr.page.priority, p.id);
          if (tr.page.priority === 'critical') this.emit({ kind: 'alarm', patientId: p.id, text: this.fill(tr.page.text, p) });
        }
        this.touch(p);
      }
      // emotion from physiology
      const pain = ph.value('pain', m);
      const gcs = ph.value('gcs', m);
      if (gcs < 13) p.emotion = 'drowsy';
      else if (p.c.persona.capacity === 'impaired') p.emotion = 'confused';
      else if (pain >= 6) p.emotion = 'pain';
      else if (pain <= 3 && p.emotion === 'pain') p.emotion = 'relieved';
      // monitor flowsheet + routine nursing vitals
      if (p.onMonitor && this.t >= p.nextMonitorRecordT) {
        p.nextMonitorRecordT = this.t + 15 * M;
        p.vitals.push({ id: `v${++this.seq}`, t: this.t, source: 'Monitor', ...this.measureVitals(p, false) });
        this.touch(p);
      }
      if (this.t >= p.nextVitalsT && p.location === p.bed) {
        p.nextVitalsT = this.t + p.vitalsEveryMin * M;
        this.enqueue(p.nurseId, { kind: 'vitals', pid: p.id, orderIds: [], location: p.bed, durationMin: 3, priority: 4, label: `Vitals — ${p.bedLabel}`, done: () => this.recordVitals(p, 'Nurse', true) });
      }
      // waiting-room style impatience for low-acuity patients nobody has seen
      if (p.c.presentation.esi >= 4 && p.firstContactT === undefined) {
        const waited = m;
        if (waited > 90 && p.waitComplaintsSent === 0) {
          p.waitComplaintsSent = 1;
          const wait = p.c.patient.sex === 'M' ? "him — he's" : "her — she's";
          this.page(`${this.staff.get(p.nurseId)?.def.name.split(' ')[0] ?? 'Nurse'} (RN)`, `${p.bedLabel} (${p.c.patient.firstName}) is asking when a doctor will see ${wait} been here ${Math.round(waited)} min.`, 'info', p.id);
        } else if (waited > 200 && p.waitComplaintsSent === 1) {
          p.waitComplaintsSent = 2;
          p.dispo = { decision: 'ama', t: this.t, diagnoses: [] };
          this.logEvent({ kind: 'flag', pid: p.id, flag: 'lwbs' });
          this.page('Rosa (charge RN)', `${p.bedLabel} got tired of waiting and left without being seen.`, 'urgent', p.id);
          this.depart(p);
        }
      }
    }
    // families stepping back in
    for (const p of this.patients.values()) {
      if (p.family?.status === 'out' && p.family.returnT !== undefined && this.t >= p.family.returnT) {
        p.family.status = 'present';
        this.dirty = true;
      }
    }
  }

  fill(text: string, p: PatientState): string {
    const v = this.trueVitals(p);
    return text
      .replaceAll('{bed}', p.bedLabel)
      .replace('{sbp}', String(Math.round(v.sbp)))
      .replace('{dbp}', String(Math.round(v.dbp)))
      .replace('{hr}', String(Math.round(v.hr)))
      .replace('{map}', String(mapOf({ sbp: v.sbp, dbp: v.dbp }) ?? ''))
      .replace('{temp}', v.temp.toFixed(1));
  }

  trueVitals(p: PatientState) {
    return p.physio.all(this.minutesSinceArrival(p));
  }

  measureVitals(p: PatientState, withTemp: boolean): Omit<VitalsEntry, 'id' | 't' | 'source'> {
    const m = this.minutesSinceArrival(p);
    const ph = p.physio;
    const v: Omit<VitalsEntry, 'id' | 't' | 'source'> = {
      hr: Math.round(ph.measured('hr', m)),
      sbp: Math.round(ph.measured('sbp', m)),
      dbp: Math.round(ph.measured('dbp', m)),
      rr: Math.round(ph.measured('rr', m)),
      spo2: Math.min(100, Math.round(ph.measured('spo2', m))),
      o2: p.o2 ?? 'RA',
    };
    if (withTemp) v.temp = Math.round(ph.measured('temp', m) * 10) / 10;
    if (withTemp) {
      v.pain = Math.round(ph.value('pain', m));
      v.gcs = Math.round(ph.value('gcs', m));
    }
    return v;
  }

  recordVitals(p: PatientState, source: 'Nurse' | 'Triage', withTemp: boolean) {
    const by = this.staff.get(p.nurseId)?.def.name ?? 'RN';
    const entry: VitalsEntry = { id: `v${++this.seq}`, t: this.t, source, by: by.split(' ').map((s, i) => (i === 0 ? s[0] + '.' : s)).join(' ') + ' RN', ...this.measureVitals(p, withTemp) };
    p.vitals.push(entry);
    this.logEvent({ kind: 'vitals', pid: p.id, vars: Object.keys(entry).filter((k) => ['hr', 'sbp', 'rr', 'spo2', 'temp', 'pain', 'gcs'].includes(k)) });
    // missing-temperature error caught?
    if (withTemp) {
      const err = this.safety.find((s) => s.pid === p.id && s.def.kind === 'missing_triage_vital' && s.status === 'active');
      if (err && this.flags.has(`${p.id}:temp_requested`)) {
        err.status = 'caught';
        err.t = this.t;
        err.detail = `Temperature measured at ${this.clock()}: ${entry.temp} °C.`;
        this.logEvent({ kind: 'safety', pid: p.id, errorId: err.def.id, caught: true });
      }
    }
    this.touch(p);
  }

  /**
   * A requested set of vitals is reported back as a nurse would: a message that reaches the doctor
   * anywhere (page), and a short readback said aloud at the bedside (heard if the player is near).
   */
  private reportVitals(p: PatientState) {
    const v = p.vitals[p.vitals.length - 1];
    if (!v) return;
    const nurse = this.staff.get(p.nurseId);
    const from = `${nurse?.def.name.split(' ')[0] ?? 'Nurse'} (RN)`;
    this.page(from, `${p.bedLabel} vitals at ${this.clock(v.t)}: ${formatVitalsLine(v, this.settings.units)}.`, 'info', p.id);
    if (nurse) this.bark(nurse.def.id, `${p.bedLabel} vitals: ${spokenVitals(v, this.settings.units)}.`);
  }

  clock(t = this.t): string {
    const [h, m] = this.scenario.shiftStart.split(':').map(Number);
    const mins = Math.floor(((h * 60 + m) * 60 + t) / 60);
    return `${String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((mins % 60) + 60) % 60).padStart(2, '0')}`;
  }

  depart(p: PatientState) {
    if (p.departed) return;
    this.homeExits.delete(p);
    p.departed = true;
    p.departT = this.t;
    p.flow = 'Departed';
    if (this.scenario.bedPool) {
      this.updateNameAlerts(this.presentPatients());
      endBedsideVisitOnExit(this, p);
    }
    if (p.discharge) p.discharge = { ...p.discharge, phase: 'departed', since: this.t, until: undefined, travelStart: undefined };
    p.onMonitor = false;
    if (p.family) p.family.status = 'absent';
    for (const s of this.staff.values()) {
      for (const q of s.queue) if (q.pid === p.id) q.canceled = true;
      if (s.current?.pid === p.id && (this.scenario.bedPool || s.current.kind === 'discharge')) {
        s.current.canceled = true;
        s.current.endT = this.t;
      }
    }
    this.touch(p);
    this.roomNext();
    if (this.scenario.bedPool && this.patients.size === this.scenario.patients.length && !this.presentPatients().length) {
      this.end('All patients have left the department');
    }
  }

  // ───────── orders ─────────

  placeOrder(pid: string, code: string, params: OrderParams | undefined, priority: Priority | undefined, by: string): ActionResult {
    const p = this.patients.get(pid);
    const def = ORDERS[code];
    if (!p) return { ok: false, message: `Unknown patient ${pid}` };
    if (!def) return { ok: false, message: `Unknown order code "${code}"` };
    if (!p.arrived) return { ok: false, message: 'Patient has not arrived yet.' };
    if (p.departed) return { ok: false, message: `${p.c.patient.lastName} has left the department.` };
    if (p.discharge?.phase === 'leaving') return { ok: false, message: 'The patient is leaving the department.' };
    const prio: Priority = priority ?? 'STAT';
    const o: OrderState = {
      id: `o${++this.seq}`,
      patientId: pid,
      code,
      name: def.name,
      category: def.category,
      params: def.med ? { dose: params?.dose ?? def.med.doses[0], route: params?.route ?? def.med.routes[0], frequency: params?.frequency ?? def.med.frequencies[0], comment: params?.comment } : params,
      priority: prio,
      status: 'Ordered',
      placedAt: this.t,
      placedBy: by,
      costUSD: def.costUSD,
    };
    p.orders.push(o);
    this.logEvent({ kind: 'order', pid, code, orderId: o.id, text: by });
    if (p.firstContactT === undefined && by !== 'Protocol') p.firstContactT = this.t;
    const urgent = prio === 'STAT' ? 1 : 3;

    switch (def.category) {
      case 'lab':
        this.orderLab(p, o, urgent);
        break;
      case 'ecg':
        o.status = 'Scheduled';
        this.enqueue('tech_marcus', { kind: 'ecg', pid, orderIds: [o.id], location: p.bed, durationMin: 5, priority: urgent, label: `ECG — ${p.bedLabel}`, done: () => this.acquireEcg(p, code === 'ecg_right', by, o) });
        break;
      case 'imaging':
        this.orderImaging(p, o);
        break;
      case 'med':
        this.orderMed(p, o, urgent);
        break;
      case 'nursing':
      case 'supply':
      case 'procedure':
        this.orderNursing(p, o, urgent);
        break;
      case 'consult':
        o.status = 'Ordered';
        o.statusText = 'Call the consultant from a phone to discuss';
        break;
    }
    this.touch(p);
    return { ok: true, message: `Ordered: ${def.name}${o.params?.dose ? ' ' + o.params.dose : ''} (${prio})`, data: { orderId: o.id } };
  }

  cancelOrder(orderId: string): ActionResult {
    for (const p of this.patients.values()) {
      const o = p.orders.find((x) => x.id === orderId);
      if (!o) continue;
      if (['Resulted', 'Final', 'Given', 'Completed', 'Canceled'].includes(o.status)) return { ok: false, message: `Cannot cancel — order is ${o.status.toLowerCase()}.` };
      o.status = 'Canceled';
      o.canceledAt = this.t;
      for (const s of this.staff.values()) {
        for (const q of [...s.queue, ...(s.current ? [s.current] : [])]) {
          if (q.orderIds.includes(orderId)) {
            q.orderIds = q.orderIds.filter((x) => x !== orderId);
            if (q.orderIds.length === 0 && q.kind !== 'assess') q.canceled = true;
          }
        }
      }
      this.logEvent({ kind: 'cancel', pid: p.id, orderId, code: o.code });
      this.touch(p);
      return { ok: true, message: `Canceled: ${o.name}` };
    }
    return { ok: false, message: 'Order not found.' };
  }

  private orderLab(p: PatientState, o: OrderState, urgent: number) {
    const def = ORDERS[o.code];
    if (def.specimen === 'POC') {
      this.enqueue(p.nurseId, { kind: 'poc', pid: p.id, orderIds: [o.id], location: p.bed, durationMin: 2, priority: urgent, label: `Fingerstick glucose — ${p.bedLabel}`, done: (task) => task.orderIds.forEach((id) => this.collect(p, id)) });
      return;
    }
    if (def.specimen === 'Urine') {
      const existing = this.findPendingTask(p, 'urine');
      if (existing) {
        existing.orderIds.push(o.id);
        return;
      }
      const dur = this.flags.has(`${p.id}:foley`) ? 3 : p.c.persona.capacity === 'impaired' ? 12 : 8 + this.rng.int(0, 10);
      this.enqueue(p.nurseId, { kind: 'urine', pid: p.id, orderIds: [o.id], location: p.bed, durationMin: dur, priority: urgent + 1, label: `Urine specimen — ${p.bedLabel}`, done: (task) => task.orderIds.forEach((id) => this.collect(p, id)) });
      return;
    }
    const existing = this.findPendingTask(p, 'draw');
    if (existing) {
      existing.orderIds.push(o.id);
      if (o.code === 'bcx') existing.durationMin += 4;
      existing.priority = Math.min(existing.priority, urgent);
      return;
    }
    const who = this.drawer(p);
    this.enqueue(who, {
      kind: 'draw',
      pid: p.id,
      orderIds: [o.id],
      location: p.bed,
      durationMin: o.code === 'bcx' ? 9 : 5,
      priority: urgent,
      label: `Drawing labs — ${p.bedLabel}`,
      done: (task) => task.orderIds.forEach((id) => this.collect(p, id)),
    });
  }

  findPendingTask(p: PatientState, kind: TaskKind): Task | undefined {
    for (const s of this.staff.values()) {
      const t = s.queue.find((q) => q.pid === p.id && q.kind === kind && !q.canceled);
      if (t) return t;
    }
    return undefined;
  }

  /** specimen collected → schedule result */
  collect(p: PatientState, orderId: string) {
    const o = p.orders.find((x) => x.id === orderId);
    if (!o || o.status === 'Canceled' || o.collectedAt !== undefined) return;
    const def = ORDERS[o.code];
    o.collectedAt = this.t;
    o.status = 'Collected';
    this.logEvent({ kind: 'collected', pid: p.id, code: o.code, orderId });
    if (o.code === 'bcx' || o.code === 'ucx') {
      o.status = 'In lab';
      o.statusText = 'Incubating — preliminary result in 12–48 h';
      this.touch(p);
      return;
    }
    const [lo, hi] = def.tatMin ?? [20, 45];
    const frac = o.priority === 'STAT' ? this.rng.range(0, 0.55) : this.rng.range(0.4, 1);
    const tat = lo + (hi - lo) * frac;
    o.resultDueT = this.t + tat * M;
    this.after(Math.min(2, tat / 2), () => {
      if (o.status === 'Collected') {
        o.status = 'In lab';
        o.statusText = `Received in lab ${this.clock()}`;
        this.touch(p);
      }
    });
    this.at(o.resultDueT, () => this.resultLab(p, o));
    this.touch(p);
  }

  labValue(p: PatientState, analyte: string, collectedT: number, drawIndex: number): number | string {
    const c = p.c;
    const a = ANALYTES[analyte];
    const truth = c.labs[analyte];
    const minute = this.minutesSinceArrival(p, collectedT);
    let v: number | string;
    if (truth === undefined) {
      if (c.provenance.kind === 'adapted') return UNAVAILABLE_RESULT;
      if (a?.text) return a.normalText ?? 'Negative';
      const r = a?.ref ? (Array.isArray(a.ref) ? a.ref : a.ref[c.patient.sex]) : [0, 1];
      const rr = new Rng(hashSeed(this.seed, p.id, analyte));
      v = r[0] + (r[1] - r[0]) * (0.3 + 0.4 * rr.next());
      if (analyte === 'agap') {
        const na = Number(this.labValue(p, 'na', collectedT, drawIndex));
        const cl = Number(this.labValue(p, 'cl', collectedT, drawIndex));
        const hco3 = Number(this.labValue(p, 'hco3', collectedT, drawIndex));
        v = na - cl - hco3;
      }
    } else if (typeof truth === 'number' || typeof truth === 'string') {
      v = truth;
    } else if ('var' in truth) {
      v = p.physio.value(truth.var, minute);
    } else if (truth.kind === 'sigmoid') {
      v = truth.base + (truth.peak - truth.base) / (1 + Math.exp(-(minute - truth.t50Min) / truth.widthMin));
    } else {
      const pts = truth.points;
      if (minute <= pts[0][0]) v = pts[0][1];
      else if (minute >= pts[pts.length - 1][0]) v = pts[pts.length - 1][1];
      else {
        let i = 0;
        while (pts[i + 1][0] < minute) i++;
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        v = y0 + ((y1 - y0) * (minute - x0)) / (x1 - x0);
      }
    }
    if (typeof v === 'number' && drawIndex > 0 && typeof truth !== 'object') {
      // analytical/biological variation on repeat draws of static values
      const rr = new Rng(hashSeed(this.seed, p.id, analyte, drawIndex));
      v = v * (1 + rr.normal(0.015));
    }
    if (typeof v === 'number') {
      const dec = a?.decimals ?? 1;
      v = Math.round(v * 10 ** dec) / 10 ** dec;
    }
    return v;
  }

  private resultLab(p: PatientState, o: OrderState) {
    if (o.status === 'Canceled' || o.collectedAt === undefined) return;
    const def = ORDERS[o.code];
    const crits: string[] = [];
    for (const an of def.analytes ?? []) {
      const prior = p.labs.filter((l) => l.analyte === an && !l.historical).length;
      const value = this.labValue(p, an, o.collectedAt, prior);
      const flag = computeFlag(an, value, p.c.patient.sex);
      p.labs.push({ id: `r${++this.seq}`, orderId: o.id, patientId: p.id, analyte: an, value, collectedAt: o.collectedAt, resultedAt: this.t, flag });
      if (flag === 'HH' || flag === 'LL') crits.push(`${ANALYTES[an]?.short ?? an} ${formatLabValue(an, value, 'US')} ${labUnit(an, 'US')}`);
    }
    o.status = 'Resulted';
    o.resultedAt = this.t;
    o.statusText = undefined;
    p.newResults++;
    this.logEvent({ kind: 'result', pid: p.id, code: o.code, orderId: o.id });
    if (crits.length) {
      this.page('Lab (Tony)', `Critical value — ${p.c.patient.lastName}, ${p.c.patient.firstName} (${p.bedLabel}): ${crits.join(', ')}. Please read back.`, 'critical', p.id);
      this.emit({ kind: 'result', patientId: p.id, text: `CRITICAL ${p.bedLabel}: ${crits.join(', ')}`, critical: true });
    } else {
      this.emit({ kind: 'result', patientId: p.id, text: `${p.bedLabel}: ${def.name} resulted` });
    }
    this.touch(p);
  }

  // ───────── ECG ─────────

  acquireEcg(p: PatientState, right: boolean, by: string, o?: OrderState) {
    if (p.departed || p.discharge?.phase === 'leaving') return;
    const truth = p.c.ecg;
    if (truth.unavailable) {
      if (o) { o.status = 'Canceled'; o.canceledAt = this.t; o.statusText = 'No 12-lead tracing available for this encounter.'; }
      this.page(by, `${p.bedLabel}: no 12-lead tracing available for interpretation.`, 'info', p.id);
      this.touch(p);
      return;
    }
    let params = { ...truth.params, seed: (truth.params.seed ?? 1) + p.ecgs.length };
    let read = truth.machineRead;
    if (right) {
      if (truth.rightSided) {
        params = { ...truth.rightSided.params, seed: (truth.rightSided.params.seed ?? 2) + p.ecgs.length };
        read = truth.rightSided.machineRead;
      } else {
        params = { ...params, rightSided: true, st: { ...(params.st ?? {}), V4R: 0 } };
        read += ' Right-sided leads: no ST elevation in V4R.';
      }
    }
    // rate/rhythm reflect current physiology (e.g. after rate control or reperfusion)
    const m = this.minutesSinceArrival(p);
    params.rate = Math.round(p.physio.value('hr', m));
    if (p.physio.hasTag('reperfusion') && params.st) {
      params = { ...params, st: Object.fromEntries(Object.entries(params.st).map(([k, v]) => [k, (v as number) * 0.4])) };
      read = read.replace('***ACUTE MI / STEMI***', 'Evolving inferior infarct, ST elevation improving.');
    }
    const ecg: EcgView = { id: `ecg${++this.seq}`, patientId: p.id, acquiredAt: this.t, label: right ? 'ECG — right-sided leads' : '12-lead ECG', params, machineRead: read };
    p.ecgs.push(ecg);
    if (o) {
      o.status = 'Completed';
      o.completedAt = this.t;
    }
    this.page('Marcus (ECG tech)', `ECG done on ${p.bedLabel} (${p.c.patient.lastName}) — please review and sign.`, p.c.presentation.chiefComplaint.toLowerCase().includes('chest') ? 'urgent' : 'info', p.id);
    this.touch(p);
  }

  // ───────── imaging ─────────

  private orderImaging(p: PatientState, o: OrderState) {
    const def = ORDERS[o.code];
    const truth = p.c.imaging[o.code];
    const img: ImagingView = { id: `img${++this.seq}`, orderId: o.id, patientId: p.id, code: o.code, name: def.name, modality: def.modality as ImagingView['modality'], status: 'Ordered', orderedAt: this.t };
    p.imaging.push(img);
    o.imagingId = img.id;
    if (truth?.blocked) {
      this.after(this.rng.range(3, 6), () => {
        if (o.status === 'Canceled') return;
        this.page(truth.blocked!.from, truth.blocked!.message, 'urgent', p.id);
        o.status = 'Canceled';
        o.canceledAt = this.t;
        o.statusText = 'Canceled by radiology';
        img.status = 'Canceled';
        this.touch(p);
      });
      return;
    }
    const [aLo, aHi] = def.acquireMin ?? [20, 45];
    const acquireT = this.t + this.rng.range(aLo, aHi) * M;
    o.status = 'Scheduled';
    o.statusText = `Expected ~${this.clock(acquireT)}`;
    img.status = 'Scheduled';
    const tryAcquire = () => {
      if (o.status === 'Canceled' || p.departed || p.discharge) return;
      if (this.needsPregnancyHold(p, def.modality)) {
        o.statusText = 'ON HOLD — pregnancy test required before imaging';
        if (p.holdPagedT === undefined || this.t - p.holdPagedT > 20 * M) {
          p.holdPagedT = this.t;
          const ordered = p.orders.some((x) => (x.code === 'hcg_u' || x.code === 'hcg_q') && x.status !== 'Canceled' && x.status !== 'Resulted');
          this.page(def.modality === 'CT' ? 'CT tech (Jordan)' : 'Radiology tech', ordered ? `${p.bedLabel}: we're holding the ${def.name} until the pregnancy test results.` : `${p.bedLabel} is a ${p.c.patient.age}-year-old woman — I need a pregnancy test before I can do the ${def.name}. Can you order one?`, 'urgent', p.id);
        }
        this.touch(p);
        this.after(2, tryAcquire);
        return;
      }
      this.performImaging(p, o, img);
    };
    this.at(acquireT, tryAcquire);
  }

  private needsPregnancyHold(p: PatientState, modality?: string): boolean {
    if (p.c.patient.sex !== 'F' || p.c.patient.age < 12 || p.c.patient.age > 55) return false;
    if (modality !== 'CT' && modality !== 'XR') return false;
    return !p.labs.some((l) => !l.historical && (l.analyte === 'hcg_u' || l.analyte === 'hcg_q') && l.value !== UNAVAILABLE_RESULT);
  }

  private performImaging(p: PatientState, o: OrderState, img: ImagingView) {
    const def = ORDERS[o.code];
    const room = def.modality === 'CT' || def.modality === 'MRI' ? 'ct' : def.modality === 'XR' && o.code !== 'xr_chest_port' ? 'xray' : p.bed;
    const scanMin = def.modality === 'CT' ? 12 : def.modality === 'MRI' ? 40 : def.modality === 'US' ? 20 : 6;
    o.status = 'In progress';
    o.statusText = room === p.bed ? 'Being performed at bedside' : `Patient in ${room.toUpperCase()}`;
    img.status = 'In progress';
    // the slot in the suite, for its presentation (views.ts); the timers below stay as they were
    const visit = room !== p.bed ? { room, code: o.code, since: this.t, until: this.t + scanMin * M } : undefined;
    if (room !== p.bed) {
      p.location = room;
      p.flow = 'In imaging';
      p.scan = visit;
    }
    this.touch(p);
    this.after(scanMin, () => {
      if (visit && p.scan === visit) p.scan = undefined;
      if (room !== p.bed && !p.departed) {
        p.location = p.bed;
        p.flow = p.dispo ? 'Dispo decided' : 'Roomed';
      }
      img.status = 'Completed';
      img.performedAt = this.t;
      o.status = 'Completed';
      o.statusText = 'Awaiting radiologist read';
      this.touch(p);
      const [rLo, rHi] = def.readMin ?? [20, 40];
      this.after(this.rng.range(rLo, rHi), () => {
        const truth = p.c.imaging[o.code] ?? (p.c.provenance.kind === 'legacy' ? defaultImaging(o.code) : { findings: 'No report available for this study.', impression: 'Unavailable.' });
        img.status = 'Final';
        img.reportedAt = this.t;
        img.findings = truth.findings;
        img.impression = truth.impression;
        img.radiologist = 'Kenji Ito, MD';
        img.imageKey = truth.imageKey;
        o.status = 'Final';
        o.resultedAt = this.t;
        o.statusText = undefined;
        p.newResults++;
        this.addNote(p, { t: this.t, type: 'Radiology', author: 'Kenji Ito, MD', title: `${def.name} — final report`, text: `FINDINGS: ${truth.findings}\n\nIMPRESSION: ${truth.impression}`, unread: true });
        if (truth.criticalCall) this.page('Radiology (Dr. Ito)', truth.criticalCall, 'critical', p.id);
        else this.emit({ kind: 'result', patientId: p.id, text: `${p.bedLabel}: ${def.name} — ${truth.impression}` });
        this.logEvent({ kind: 'result', pid: p.id, code: o.code, orderId: o.id });
        this.touch(p);
      });
    });
  }

  // ───────── medications ─────────

  private orderMed(p: PatientState, o: OrderState, urgent: number) {
    const def = ORDERS[o.code];
    const med = def.med!;
    o.status = 'Pending verification';
    o.statusText = 'Pharmacy verifying';
    const verifyMin = (o.priority === 'STAT' ? this.rng.range(2, 6) : this.rng.range(8, 15)) + (med.highAlert ? 3 : 0);
    this.after(verifyMin, () => {
      if (o.status === 'Canceled' || p.departed) return;
      if (o.noAutoGive) return;
      o.status = 'Ordered';
      o.statusText = 'Verified — awaiting administration';
      this.touch(p);
      const isAbx = med.tags.includes('abx');
      const route = o.params?.route ?? med.routes[0];
      const adminMin = /infusion|continuous/i.test(route + (o.params?.frequency ?? '')) ? 5 : /PO|SL|ODT/.test(route) ? 2 : 3;
      const task = this.enqueue(p.nurseId, {
        kind: 'give',
        pid: p.id,
        orderIds: [o.id],
        location: p.bed,
        durationMin: 3 + adminMin,
        priority: urgent,
        label: `Giving ${med.generic} ${o.params?.dose ?? ''} — ${p.bedLabel}`.trim(),
        done: () => this.administer(p, o),
      });
      if (isAbx) this.armCultureCheck(p, o, task);
    });
  }

  /** staff error: antibiotics hung before cultures are drawn */
  private armCultureCheck(p: PatientState, o: OrderState, task: Task) {
    const err = this.safety.find((s) => s.pid === p.id && s.def.kind === 'abx_before_cultures' && (s.status === 'pending' || s.status === 'active'));
    if (!err) return;
    task.onStart = (tk) => {
      const bcx = p.orders.find((x) => x.code === 'bcx' && x.status !== 'Canceled');
      if (!bcx || bcx.collectedAt !== undefined) {
        if (err.status === 'pending') err.status = 'na';
        return;
      }
      err.status = 'active';
      err.t = this.t;
      const nurse = this.staff.get(tk.staffId)!;
      const name = nurse.def.name.split(' ')[0];
      this.bark(nurse.def.id, `Hanging the ${ORDERS[o.code].med!.generic} on ${p.bedLabel} now — I'll grab the cultures after, the lab line is backed up.`);
      this.page(`${name} (RN)`, `Starting ${ORDERS[o.code].med!.generic} on ${p.bedLabel} now; blood cultures not drawn yet — will get them after.`, 'info', p.id);
      tk.endT = Math.max(tk.endT ?? this.t, this.t + 3 * M); // window to intervene
      tk.done = () => {
        if (this.flags.has(`${p.id}:cultures_first`)) {
          this.collect(p, bcx.id);
          err.status = 'caught';
          err.detail = `You told ${name} to draw cultures first — collected ${this.clock()}, antibiotics followed.`;
          this.logEvent({ kind: 'safety', pid: p.id, errorId: err.def.id, caught: true });
          this.after(2, () => this.administer(p, o));
        } else {
          this.administer(p, o);
          err.status = 'missed';
          err.detail = `${ORDERS[o.code].med!.generic} started ${this.clock()} before blood cultures were drawn.`;
          this.logEvent({ kind: 'safety', pid: p.id, errorId: err.def.id, caught: false });
          this.after(8, () => this.collect(p, bcx.id));
        }
      };
    };
  }

  doseUnits(p: PatientState, o: OrderState): { units: number; volumeMl?: number } {
    const med = ORDERS[o.code].med!;
    if (!med.tags.includes('fluids')) return { units: 1 };
    const dose = o.params?.dose ?? med.doses[0];
    let ml = med.volumeMl ?? 1000;
    const mlkg = /([\d.]+)\s*mL\/kg/i.exec(dose);
    const mlAbs = /([\d.]+)\s*mL/i.exec(dose);
    if (mlkg) ml = parseFloat(mlkg[1]) * p.c.patient.weightKg;
    else if (mlAbs) ml = parseFloat(mlAbs[1]);
    ml = Math.round(ml / 10) * 10;
    return { units: ml / 1000, volumeMl: ml };
  }

  administer(p: PatientState, o: OrderState, byError?: string, overrideTarget?: PatientState) {
    const target = overrideTarget ?? p;
    if (o.status === 'Canceled' || target.departed || target.discharge?.phase === 'leaving') return;
    const def = ORDERS[o.code];
    const med = def.med!;
    const { units, volumeMl } = this.doseUnits(target, o);
    const minute = this.minutesSinceArrival(target);
    const nurse = this.staff.get(target.nurseId);
    const continuous = /continuous/.test(o.params?.frequency ?? '') || /infusion/i.test(o.params?.route ?? '');
    target.mar.push({
      id: `mar${++this.seq}`,
      patientId: target.id,
      orderId: overrideTarget ? undefined : o.id,
      med: def.name,
      dose: volumeMl ? `${volumeMl} mL${/kg/.test(o.params?.dose ?? '') ? ` (${o.params?.dose})` : ''}` : o.params?.dose ?? med.doses[0],
      route: o.params?.route ?? med.routes[0],
      t: this.t,
      by: nurse ? `${nurse.def.name.split(' ')[0][0]}. ${nurse.def.name.split(' ').slice(-1)[0]} RN` : 'RN',
      status: volumeMl || continuous ? 'Started' : 'Given',
      comment: byError ? 'Scanned without wristband check' : undefined,
    });
    for (const tag of med.tags) {
      target.physio.apply(tag, minute, units);
      const harm = target.physio.harmFor(tag);
      if (harm) {
        const chance = harm.chance ?? 1;
        const roll = new Rng(hashSeed(this.seed, target.id, tag, 'harm')).next();
        if (roll < chance) {
          this.flags.add(`${target.id}:${harm.flag}`);
          this.logEvent({ kind: 'flag', pid: target.id, flag: harm.flag });
          if (harm.page) {
            this.after(tag === 'nitrate' || tag === 'beta_blocker' ? 4 : 15, () => {
              if (target.departed || target.discharge?.phase === 'leaving') return;
              const text = this.fill(harm.page!, target);
              this.page(`${nurse?.def.name.split(' ')[0] ?? 'Nurse'} (RN)`, text, 'critical', target.id);
              this.emit({ kind: 'alarm', patientId: target.id, text });
            });
          }
        }
      }
    }
    // generic true-allergy reaction when the case has no specific harm effect
    const allergyHit = (med.allergyGroups ?? []).find((g) => target.c.truth.allergies.some((a) => a.substance.toLowerCase().includes(g)));
    if (allergyHit && !med.tags.some((tg) => target.physio.harmFor(tg))) {
      this.flags.add(`${target.id}:allergic_reaction`);
      this.after(12, () => {
        if (!target.departed && target.discharge?.phase !== 'leaving') {
          this.page(`${nurse?.def.name.split(' ')[0] ?? 'Nurse'} (RN)`, `${target.bedLabel} has new hives and itching after the ${med.generic}.`, 'urgent', target.id);
        }
      });
    }
    if (target.c.id === 'stemi_inferior' && med.tags.includes('pressor')) this.flags.add(`${target.id}:pressor`);
    this.logEvent({ kind: 'given', pid: target.id, code: o.code, tags: med.tags, volumeMl, byError });
    if (!overrideTarget) {
      o.status = continuous || /q\d+h|BID|daily/i.test(o.params?.frequency ?? '') ? 'Active' : 'Given';
      o.completedAt = this.t;
      o.statusText = o.status === 'Active' ? (continuous ? 'Infusing' : 'Scheduled doses continue') : undefined;
    }
    this.touch(target);
    if (target !== p) this.touch(p);
  }

  // ───────── nursing / supply orders ─────────

  private orderNursing(p: PatientState, o: OrderState, urgent: number) {
    const def = ORDERS[o.code];
    const staffId = def.category === 'supply' || def.category === 'procedure' ? 'tech_marcus' : p.nurseId;
    const label = `${def.name} — ${p.bedLabel}`;
    const finish = () => {
      if (o.status === 'Canceled') return;
      o.status = 'Completed';
      o.completedAt = this.t;
      const m = this.minutesSinceArrival(p);
      switch (o.code) {
        case 'monitor':
          p.onMonitor = true;
          p.nextMonitorRecordT = this.t;
          o.status = 'Active';
          break;
        case 'iv_access':
          p.ivAccess = true;
          break;
        case 'vitals_now':
        case 'orthostatics':
          this.recordVitals(p, 'Nurse', true);
          this.reportVitals(p);
          break;
        case 'vitals_q15':
          p.vitalsEveryMin = 15;
          p.nextVitalsT = this.t + 15 * M;
          o.status = 'Active';
          this.recordVitals(p, 'Nurse', true);
          break;
        case 'vitals_q1h':
          p.vitalsEveryMin = 60;
          p.nextVitalsT = this.t + 60 * M;
          o.status = 'Active';
          this.recordVitals(p, 'Nurse', true);
          break;
        case 'o2_nc':
          p.o2 = '2 L NC';
          p.physio.apply('oxygen', m, 1);
          o.status = 'Active';
          break;
        case 'oxygen_nrb':
          p.o2 = '15 L NRB';
          p.physio.apply('high_flow_oxygen', m, 1);
          o.status = 'Active';
          break;
        case 'npo':
          p.npo = true;
          o.status = 'Active';
          break;
        case 'foley':
          this.flags.add(`${p.id}:foley`);
          o.status = 'Active';
          break;
        case 'bladder_scan':
          this.addNote(p, { t: this.t, type: 'Nursing', author: this.staff.get(p.nurseId)?.def.name ?? 'RN', title: 'Bladder scan', text: `Bladder scan: post-void residual ${this.rng.int(40, 140)} mL.` });
          break;
        case 'ice_elevate':
          p.physio.apply('rice', m, 1);
          o.status = 'Active';
          break;
        case 'ankle_brace':
          p.physio.apply('brace', m, 1);
          break;
        case 'fall_precautions':
        case 'delirium_bundle':
          o.status = 'Active';
          this.flags.add(`${p.id}:${o.code}`);
          break;
      }
      this.touch(p);
    };
    if (o.code === 'vitals_now' || o.code === 'vitals_q15' || o.code === 'vitals_q1h') this.flags.add(`${p.id}:temp_requested`);
    o.status = 'Scheduled';
    this.enqueue(staffId, { kind: def.category === 'nursing' ? 'nursing' : 'supply', pid: p.id, orderIds: [o.id], location: p.bed, durationMin: def.durationMin ?? 3, priority: urgent + (o.code === 'npo' ? 0 : 1), label, done: finish });
  }

  // ───────── staff error: wrong-patient medication ─────────

  private startWrongPatientMed(e: Extract<StaffErrorDef, { kind: 'wrong_patient_med' }>) {
    const st = this.safety.find((s) => s.def.id === e.id)!;
    const wrong = [...this.patients.values()].find((p) => p.c.id === e.wrongCaseId);
    const intended = [...this.patients.values()].find((p) => p.c.id === e.intendedCaseId);
    if (!wrong || !intended || !wrong.arrived || wrong.departed || !intended.arrived || intended.departed ||
        wrong.discharge?.phase === 'leaving' || intended.discharge?.phase === 'leaving') {
      st.status = 'na';
      return;
    }
    // an order for the intended patient (attending's verbal order if none exists)
    let o = intended.orders.find((x) => x.code === e.medCode && x.status !== 'Canceled' && x.status !== 'Given');
    if (!o) {
      const r = this.placeOrder(intended.id, e.medCode, { dose: e.dose, route: e.route, frequency: 'once' }, 'STAT', e.orderedBy);
      o = intended.orders.find((x) => x.id === (r.data as { orderId: string } | undefined)?.orderId);
      if (o) {
        // skip normal pharmacy flow: the erroneous administration replaces it
        o.status = 'Ordered';
        o.statusText = 'Verified — awaiting administration';
        for (const s of this.staff.values()) for (const q of s.queue) if (q.orderIds.includes(o.id)) q.canceled = true;
      }
    } else {
      for (const s of this.staff.values()) for (const q of s.queue) if (q.orderIds.includes(o!.id)) q.canceled = true;
    }
    if (!o) {
      st.status = 'na';
      return;
    }
    const order = o;
    order.noAutoGive = true;
    st.status = 'active';
    st.t = this.t;
    const nurse = this.staff.get(e.nurseId)!;
    const first = nurse.def.name.split(' ')[0];
    const announce = `Heading into ${wrong.bedLabel} with ${ORDERS[e.medCode].med!.generic} ${e.dose} IV for Mr. Kel—... ${wrong.c.patient.lastName}.`;
    this.flags.add(`wrongmed_active:${e.id}`);
    this.enqueue(e.nurseId, {
      kind: 'wrong_med',
      pid: wrong.id,
      orderIds: [order.id],
      location: wrong.bed,
      durationMin: e.windowMin,
      priority: 0,
      label: `Giving ${ORDERS[e.medCode].med!.generic} ${e.dose} — ${wrong.bedLabel}`,
      meta: { errorId: e.id },
      onStart: () => {
        this.bark(e.nurseId, announce);
        this.page(`${first} (RN)`, announce, 'info', wrong.id);
      },
      done: () => {
        this.flags.delete(`wrongmed_active:${e.id}`);
        if (st.status === 'caught') return;
        // error reaches the patient
        this.administer(intended, order, e.id, wrong);
        st.status = 'missed';
        st.detail = `${first} gave ${ORDERS[e.medCode].med!.generic} ${e.dose} (ordered for ${intended.c.patient.lastName}, ${intended.bedLabel}) to ${wrong.c.patient.lastName} (${wrong.bedLabel}) at ${this.clock()}.`;
        this.logEvent({ kind: 'safety', pid: wrong.id, errorId: e.id, caught: false });
        // the intended patient's dose is still outstanding — it gets given later
        this.enqueue(intended.nurseId, { kind: 'give', pid: intended.id, orderIds: [order.id], location: intended.bed, durationMin: 4, priority: 2, label: `Giving ${ORDERS[e.medCode].med!.generic} ${e.dose} — ${intended.bedLabel}`, done: () => this.administer(intended, order) });
        this.addNote(wrong, { t: this.t, type: 'Nursing', author: nurse.def.name, title: 'Medication event', text: `${ORDERS[e.medCode].med!.generic} ${e.dose} IV administered — order belonged to ${intended.c.patient.lastName}, ${intended.c.patient.firstName}. Physician notified. Incident report filed.` });
      },
    });
  }

  /** called when the player stops the wrong-patient administration (via dialogue action) */
  stopWrongMed(): string | null {
    const st = this.safety.find((s) => s.def.kind === 'wrong_patient_med' && s.status === 'active');
    if (!st || st.def.kind !== 'wrong_patient_med') return null;
    const e = st.def;
    st.status = 'caught';
    st.t = this.t;
    const intended = [...this.patients.values()].find((p) => p.c.id === e.intendedCaseId)!;
    const wrong = [...this.patients.values()].find((p) => p.c.id === e.wrongCaseId)!;
    st.detail = `You stopped ${ORDERS[e.medCode].med!.generic} meant for ${intended.c.patient.lastName} (${intended.bedLabel}) before it reached ${wrong.c.patient.lastName} (${wrong.bedLabel}).`;
    this.logEvent({ kind: 'safety', pid: wrong.id, errorId: e.id, caught: true });
    this.flags.delete(`wrongmed_active:${e.id}`);
    const nurse = this.staff.get(e.nurseId)!;
    if (nurse.current?.kind === 'wrong_med') {
      nurse.current.endT = this.t;
    }
    // give it to the right patient
    const order = intended.orders.find((x) => x.code === e.medCode && x.status === 'Ordered');
    if (order) {
      this.enqueue(intended.nurseId, { kind: 'give', pid: intended.id, orderIds: [order.id], location: intended.bed, durationMin: 4, priority: 1, label: `Giving ${ORDERS[e.medCode].med!.generic} ${e.dose} — ${intended.bedLabel}`, done: () => this.administer(intended, order) });
    }
    return st.detail;
  }

  // ───────── exam ─────────

  examine(pid: string, maneuver: string): ActionResult {
    const p = this.patients.get(pid);
    const def = EXAM_BY_ID[maneuver];
    if (!p || !p.arrived || p.departed) return { ok: false, message: 'Patient not available.' };
    if (p.discharge?.phase === 'leaving') return { ok: false, message: 'The patient is on the way to the exit.' };
    if (!def) return { ok: false, message: `Unknown exam maneuver "${maneuver}"` };
    if (p.location !== p.bed) return { ok: false, message: `${p.c.patient.firstName} is in ${p.location.toUpperCase()} right now.` };
    const m = this.minutesSinceArrival(p);
    const ov = p.c.exam[maneuver];
    let text = p.c.provenance.kind === 'adapted' ? 'No finding recorded for this maneuver.' : def.normal;
    if (typeof ov === 'string') text = ov;
    else if (Array.isArray(ov)) {
      for (const variant of ov) {
        if (!variant.when) {
          text = variant.text;
          break;
        }
        const v = p.physio.value(variant.when.var, m);
        if (variant.when.op === '<' ? v < variant.when.value : v > variant.when.value) {
          text = variant.text;
          break;
        }
      }
    }
    // bedside ultrasound, one view (pocus.ts): the case's read or a normal study for this patient
    const us = pocusWindowOf(maneuver);
    if (us) text = ultrasoundRead(this, p, us);
    if (maneuver === 'neuro_gcs') {
      const g = Math.round(p.physio.value('gcs', m));
      text = g >= 15 ? 'GCS 15 (E4 V5 M6).' : g === 14 ? 'GCS 14 (E4 V4 M6) — confused speech.' : g === 13 ? 'GCS 13 (E3 V4 M6) — eyes open to voice, confused.' : `GCS ${g} (E${Math.max(1, Math.min(4, g - 9))} V${Math.max(1, Math.min(5, g - 7))} M${Math.min(6, Math.max(1, g - 5))}).`;
    }
    if (def.chaperone) text = `(Chaperoned by ${this.staff.get(p.nurseId)?.def.name ?? 'RN'}) ${text}`;
    // an ultrasound read says so wherever the finding is listed (bedside list, chart, agents' text)
    const label = us ? `Ultrasound — ${def.label}` : def.label;
    const f: ExamFinding = { maneuver, label, system: def.system, text, t: this.t };
    p.exam.push(f);
    if (p.firstContactT === undefined) p.firstContactT = this.t;
    this.logEvent({ kind: 'exam', pid, maneuver });
    this.touch(p);
    return { ok: true, text: `${label}: ${text}`, costMin: def.minutes };
  }

  // ───────── ECG signing / diagnoses / dispositions ─────────

  signEcg(ecgId: string, interpretation: string): ActionResult {
    for (const p of this.patients.values()) {
      const e = p.ecgs.find((x) => x.id === ecgId);
      if (!e) continue;
      if (e.signedAt !== undefined) return { ok: false, message: 'ECG already signed.' };
      e.signedAt = this.t;
      e.physicianRead = interpretation;
      const read = ` ${interpretation.toLowerCase()} `;
      this.logEvent({ kind: 'ecg_signed', pid: p.id, id: ecgId, correct: ecgReadCorrect(read, p.c.ecg.readKeywords) });
      if (p.firstContactT === undefined) p.firstContactT = this.t;
      this.touch(p);
      return { ok: true, message: `ECG signed at ${this.clock()}.` };
    }
    return { ok: false, message: 'ECG not found.' };
  }

  setDiagnoses(pid: string, dx: string[]): ActionResult {
    const p = this.patients.get(pid);
    if (!p) return { ok: false, message: 'Unknown patient.' };
    p.diagnoses = dx.map((d) => d.trim()).filter(Boolean).slice(0, 10);
    this.logEvent({ kind: 'dx', pid, diagnoses: p.diagnoses });
    this.touch(p);
    return { ok: true, message: `Working diagnoses updated (${p.diagnoses.length}).` };
  }

  disposition(pid: string, decision: DispositionView['decision'], service: string | undefined, dx: string[], instructions?: string, wheelchair = false): ActionResult {
    const p = this.patients.get(pid);
    if (!p || !p.arrived) return { ok: false, message: 'Unknown patient.' };
    if (p.discharge) {
      return decision === 'discharge'
        ? { ok: true, message: 'Discharge has already been signed.' }
        : { ok: false, message: 'The signed discharge is final for this encounter.' };
    }
    if (p.departed) return { ok: false, message: 'Patient already left the department.' };
    if (decision === 'discharge' && instructions !== undefined && typeof instructions !== 'string') return { ok: false, message: 'Discharge instructions must be text.' };
    if (decision === 'discharge' && typeof wheelchair !== 'boolean') return { ok: false, message: 'The wheelchair request must be true or false.' };
    if (decision === 'discharge' && p.dispo) return { ok: false, message: 'A disposition is already recorded for this encounter.' };
    if (dx.length) this.setDiagnoses(pid, dx);
    p.dispo = { decision, service, t: this.t, diagnoses: p.diagnoses, instructions };
    p.flow = 'Dispo decided';
    this.logEvent({ kind: 'dispo', pid, decision });
    if (p.firstContactT === undefined) p.firstContactT = this.t;
    let msg = `Disposition: ${decision}.`;
    if (decision === 'discharge') {
      this.startDischarge(p, wheelchair);
      msg = 'Discharge signed. Paperwork is being prepared for the bedside nurse.';
    } else if (decision === 'ama') {
      this.after(2, () => { if (p.dispo?.decision === 'ama') this.depart(p); });
      msg = 'Patient leaving AMA.';
    } else if (decision === 'observation') {
      msg = 'Placed in ED observation.';
    } else if (p.acceptedBy) {
      msg = `Accepted by ${p.acceptedBy}; transport arranged.`;
    } else {
      msg = 'Bed request placed — the admitting/accepting team must accept: call them from a phone.';
      this.after(12, () => {
        if (!p.acceptedBy && !p.departed && p.dispo?.decision === decision) this.page('Rosa (charge RN)', `${p.bedLabel} has a dispo of "${decision.replace('_', ' ')}" but nobody has accepted — did you call them?`, 'info', p.id);
      });
    }
    this.touch(p);
    return { ok: true, message: msg };
  }

  private exitClockRate(): number {
    if (this.mode === 'step') return this.scenario.defaultTimeScale;
    return this.settings.timeScale * (this.focus && this.settings.focusSlowdown ? 0.35 : 1);
  }

  private startDischarge(p: PatientState, wheelchair: boolean) {
    const nurse = this.staff.get(p.nurseId) ?? this.staff.get('rn_rosa')!;
    const mobility = wheelchair ? 'wheelchair' : p.c.presentation.dischargeMobility ?? 'walking';
    const escort = mobility === 'wheelchair';
    const paperworkMin = 2;
    const handoffMin = 2;
    const signed = p.dispo!;
    const progress = (phase: DischargeProgress['phase'], until?: number) => {
      p.discharge = { patientId: p.id, nurseId: nurse.def.id, mobility, phase, since: this.t, until };
      this.touch(p);
    };
    const leave = () => {
      if (p.discharge?.phase !== 'handoff') return;
      this.addNote(p, {
        t: this.t, type: 'Nursing', author: nurse.def.name, title: 'Discharge handoff',
        text: `Discharge paperwork handed to the patient. ${signed.instructions?.trim() ? 'Reviewed the signed discharge instructions.' : 'No written instructions were entered.'} ${escort ? 'Escorting the patient to the exit by wheelchair.' : 'Patient leaving on foot.'}`,
      });
      const start = dischargePickup(this.layout, p.bed) ?? roomById(this.layout, p.bed)!.entry;
      const meters = routeLength(route(this.layout, start, dischargeExit(this.layout)));
      const rate = this.exitClockRate();
      const until = this.t + rate * (meters / (escort ? 1.1 : 1.3) + 2);
      progress('leaving', until);
      this.homeExits.set(p, rate);
      this.closeDischargedCare(p);
      if (escort) {
        nurse.current!.endT = until;
        nurse.activity = `Wheelchair escort to exit — ${p.bedLabel}`;
      }
    };
    const requestNurse = () => {
      if (p.discharge?.phase !== 'awaiting_nurse') return;
      // Finish an acquired study, including a bedside ultrasound, before the final review.
      if (p.imaging.some(i => i.status === 'In progress')) {
        this.at(Math.max(this.t + 1, p.scan?.until ?? this.t + M), requestNurse);
        return;
      }
      this.enqueue(nurse.def.id, {
        kind: 'discharge', pid: p.id, orderIds: [], location: p.bed, durationMin: handoffMin, priority: 3,
        label: `On the way for discharge handoff — ${p.bedLabel}`,
        onStart: (task) => {
          const arrival = task.endT! - handoffMin * M;
          this.at(arrival, () => {
            if (p.discharge?.phase !== 'awaiting_nurse' || task.canceled) return;
            nurse.activity = `Discharge handoff — ${p.bedLabel}`;
            progress('handoff', arrival + handoffMin * M);
            this.bark(nurse.def.id, 'Here are your discharge papers. Let’s go over them together.');
          });
          if (escort) this.at(arrival + handoffMin * M, leave);
        },
        done: () => { if (!escort) leave(); },
      });
    };
    progress('paperwork', this.t + paperworkMin * M);
    this.after(paperworkMin, () => {
      if (p.discharge?.phase !== 'paperwork') return;
      this.addNote(p, {
        t: this.t, type: 'Physician', author: this.playerName, title: 'Discharge paperwork',
        text: [`Discharge home. Diagnoses: ${signed.diagnoses.join(', ') || 'None recorded'}.`, signed.instructions?.trim() || 'No written instructions entered.'].join('\n'),
      });
      progress('awaiting_nurse');
      requestNurse();
    });
  }

  private closeDischargedCare(p: PatientState) {
    p.onMonitor = false;
    p.ivAccess = false;
    p.o2 = undefined;
    endBedsideVisitOnExit(this, p);
    const interrupted = this.safety.find(s => s.status === 'active' && s.def.kind === 'wrong_patient_med' &&
      (s.pid === p.id || s.def.intendedCaseId === p.c.id));
    if (interrupted?.def.kind === 'wrong_patient_med') {
      const e = interrupted.def;
      interrupted.status = 'na';
      this.flags.delete(`wrongmed_active:${e.id}`);
      const intended = [...this.patients.values()].find(pt => pt.c.id === e.intendedCaseId)!;
      const order = intended.orders.find(o => o.code === e.medCode && o.status === 'Ordered');
      if (intended !== p && order) {
        this.enqueue(intended.nurseId, { kind: 'give', pid: intended.id, orderIds: [order.id], location: intended.bed, durationMin: 4, priority: 1, label: `Giving ${order.name} — ${intended.bedLabel}`, done: () => this.administer(intended, order) });
      }
    }
    for (const o of p.orders) {
      if (o.status === 'Active') {
        o.status = 'Completed';
        o.statusText = 'ED order ended at discharge';
      } else if (['Pending verification', 'Ordered', 'Scheduled', 'Held'].includes(o.status)) {
        // Administrative closure, not a player cancellation (which is recorded and scored).
        // Collected specimens and acquired studies still get results.
        o.status = 'Canceled';
        o.statusText = `Not performed before discharge at ${this.clock()}`;
        const image = o.imagingId && p.imaging.find(i => i.id === o.imagingId);
        if (image) image.status = 'Canceled';
      }
    }
    // No more bedside tasks; the assigned nurse can still be escorting this patient.
    const stop = (task: Task) => (task.pid === p.id && task.kind !== 'discharge') || (!!interrupted && task.meta?.errorId === interrupted.def.id);
    for (const st of this.staff.values()) {
      for (const task of st.queue) if (stop(task)) task.canceled = true;
      if (st.current && stop(st.current)) {
        st.current.canceled = true;
        st.current.endT = this.t;
      }
    }
  }

  /** consultant accepted via phone */
  acceptConsult(p: PatientState, contactId: string, contactName: string): string {
    if (p.discharge || p.departed) return 'The patient already has a final disposition.';
    const cd = p.c.consults.find((c) => c.contactId === contactId);
    if (!cd) return '';
    p.acceptedBy = contactName;
    this.logEvent({ kind: 'consult_accept', pid: p.id, contactId });
    for (const o of p.orders) if (o.category === 'consult' && o.code.endsWith(contactId === 'cards' ? 'cardiology' : contactId === 'surg' ? 'surgery' : contactId === 'hosp' ? 'medicine' : contactId)) {
      o.status = 'Completed';
      o.statusText = `Accepted by ${contactName}`;
    }
    const a = cd.onAccept;
    if (a.tag) {
      const tag = a.tag;
      this.after(a.tagAfterMin ?? 0, () => p.physio.apply(tag, this.minutesSinceArrival(p), 1));
    }
    if (a.note) this.addNote(p, { t: this.t, type: 'Consult', author: contactName, title: a.note.title, text: a.note.text, unread: true });
    if (a.page) this.page(contactName, this.fill(a.page, p), 'info', p.id);
    if (!p.dispo && a.dispo) p.dispo = { decision: a.dispo, service: a.service, t: this.t, diagnoses: p.diagnoses };
    if (a.departAfterMin !== undefined) {
      this.after(a.departAfterMin, () => {
        if (!p.departed && !p.discharge) {
          if (!p.dispo && a.dispo) p.dispo = { decision: a.dispo, service: a.service, t: this.t, diagnoses: p.diagnoses };
          this.page('Rosa (charge RN)', `${p.bedLabel} (${p.c.patient.lastName}) is leaving the ED${a.service ? ' to ' + a.service : ''}.`, 'info', p.id);
          this.depart(p);
        }
      });
    }
    p.flow = 'Dispo decided';
    this.touch(p);
    return `${contactName} accepted ${p.c.patient.lastName}.`;
  }

  // ───────── end ─────────

  end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.endedAt = this.t;
    for (const s of this.safety) if (s.status === 'pending' || s.status === 'active') s.status = s.status === 'active' ? 'missed' : 'na';
    this.emit({ kind: 'toast', text: `${reason} — preparing your debrief…`, tone: 'info' });
    this.emit({ kind: 'ended' });
  }

  // ───────── belongings / documents (inspect) ─────────

  /** case items currently in the department (patient arrived; family-carried items once family is there) */
  items(): { p: PatientState; item: NonNullable<CaseDef['items']>[number] }[] {
    const out: { p: PatientState; item: NonNullable<CaseDef['items']>[number] }[] = [];
    for (const p of this.presentPatients()) {
      if (p.discharge?.phase === 'leaving') continue;
      for (const item of p.c.items ?? []) {
        if (item.arrivesWith === 'family' && p.family?.status !== 'present') continue;
        out.push({ p, item });
      }
    }
    return out;
  }

  inspect(itemId: string): ActionResult {
    const hit = this.items().find((x) => x.item.id === itemId);
    if (!hit) return { ok: false, message: `There is no "${itemId}" here to inspect.` };
    const { p, item } = hit;
    if (this.mode === 'step' && this.playerLocation !== p.bed) return { ok: false, message: `${item.label} is in ${p.bedLabel} — move there first.` };
    const first = !p.inspected.has(item.id);
    p.inspected.add(item.id);
    if (first) this.logEvent({ kind: 'inspect', pid: p.id, code: item.id });
    for (const f of item.facts ?? []) {
      if (!p.revealed.has(f)) {
        p.revealed.add(f);
        this.logEvent({ kind: 'fact', pid: p.id, factId: f, npcId: `item:${item.id}` });
      }
    }
    this.touch(p);
    return { ok: true, text: `${item.label}: ${item.text}` };
  }

  /**
   * Hand a belonging back to its owner (a confused patient asking for her handbag): it lies beside
   * them in bed from now on. Not scored. The patient knows they have it (dialogue.ts) and, if awake
   * enough, says thank you.
   */
  giveItem(itemId: string): ActionResult {
    const hit = this.items().find((x) => x.item.id === itemId);
    if (!hit) return { ok: false, message: `There is no "${itemId}" here to hand over.` };
    const { p, item } = hit;
    if (this.mode === 'step' && this.playerLocation !== p.bed) return { ok: false, message: `${item.label} is in ${p.bedLabel} — move there first.` };
    const name = `${p.c.patient.firstName} ${p.c.patient.lastName}`;
    if (p.location !== p.bed) return { ok: false, message: `${name} is not in ${p.bedLabel} right now.` };
    if (p.given.has(item.id)) return { ok: true, message: `${name} already has it.` };
    p.given.add(item.id);
    this.touch(p);
    // too drowsy to take it: it is left beside them
    if (this.trueVitals(p).gcs < 13) return { ok: true, message: `${name} is too drowsy to take it; you leave it beside them in bed.` };
    const line = item.returnLine ?? 'Oh, thank you. I was looking for that.';
    this.emit({ kind: 'speech', npcId: `pt_${p.id}`, name, text: line, emotion: p.emotion });
    return { ok: true, message: `${name} has it now.`, text: `${name}: “${line}”` };
  }

  // ───────── actions (human + AI) ─────────

  async act(action: Action): Promise<ActionResult> {
    this.lastActivity = Date.now();
    if (this.ended && action.type !== 'ack_page') return { ok: false, message: 'The shift has ended.' };
    const step = this.mode === 'step';
    const cost = (min: number, r: ActionResult): ActionResult => {
      if (step && min > 0) this.advance(min * M);
      return { ...r, costMin: step ? min : 0 };
    };
    switch (action.type) {
      case 'add_roster_patient': return this.addRosterPatient();
      case 'move': {
        // any storey's rooms (shared/floors.ts: Floor 2 is ambient, so no case ever needs you there)
        const room = roomById(this.layout, action.to) ?? upperRoom(this.layout, action.to)?.room;
        if (!room) return { ok: false, message: `Unknown location "${action.to}"` };
        const secs = walkSecondsAny(this.layout, this.playerLocation, action.to);
        if (action.to !== this.playerLocation) recordMove(this, action.to);
        this.playerLocation = action.to;
        this.dirty = true;
        return cost(secs / 60, { ok: true, message: `You are in ${room.label}.` });
      }
      case 'talk': {
        // an escalated attending is talkable once she is at the bedside, not while she walks over
        const enRoute = attendingEnRoute(this, action.npcId);
        if (enRoute) return { ok: false, message: enRoute };
        const { talk } = await import('../npc/dialogue');
        const r = await talk(this, action.npcId, action.text, action.topic);
        // small talk with the crowd and the extras is off the record: no game time (npc/smalltalk.ts)
        return (r.data as { offRecord?: boolean } | undefined)?.offRecord ? r : cost(1, r);
      }
      case 'call': {
        const { call } = await import('../npc/dialogue');
        // the attending's line (after an escalation by phone) rings your own phone: it works from anywhere
        if (step && action.contactId !== ATTENDING_LINE && !['station', 'workroom'].includes(this.playerLocation)) return { ok: false, message: 'You need a phone: go to the nurses\' station or the physician workroom.' };
        const r = await call(this, action.contactId, action.text, action.patientId);
        return cost(1, r);
      }
      case 'escalate': {
        const r = escalate(this, action);
        return cost(r.ok ? 0.5 : 0, r);
      }
      case 'hygiene':
        // hand hygiene, masks: no game time (hygiene.ts; the debrief lists it, unscored)
        return { ...hygieneAction(this, action.kind, action.at), costMin: 0 };
      case 'hangup': {
        const conv = this.conversations.get(`phone:${action.contactId}`);
        if (conv) conv.lines.push({ id: `l${++this.seq}`, t: this.t, speaker: 'system', name: 'Phone', text: 'Call ended.' });
        this.dirty = true;
        return { ok: true, message: 'Call ended.' };
      }
      case 'examine': {
        if (step) {
          const p = this.patients.get(action.patientId);
          if (p && this.playerLocation !== p.location) return { ok: false, message: `You must be at the bedside (${p.bedLabel}) — use move first.` };
        }
        const r = this.examine(action.patientId, action.maneuver);
        const ex = r.ok ? this.patients.get(action.patientId) : undefined;
        if (ex) recordContact(this, ex);
        // a refused exam (patient gone, on the way out, unknown maneuver) takes no time
        return cost(r.ok ? (r.costMin ?? 1) : 0, r);
      }
      case 'order': {
        if (step && !this.atWorkstation()) return { ok: false, message: 'Orders are placed at a workstation (station, workroom or triage) — or give a verbal order to a nurse.' };
        return cost(0.5, this.placeOrder(action.patientId, action.code, action.params, action.priority, 'You'));
      }
      case 'cancel_order':
        return cost(0.3, this.cancelOrder(action.orderId));
      case 'ehr_view': {
        if (step && !this.atWorkstation()) return { ok: false, message: 'You need a workstation to read the chart.' };
        const { ehrText } = await import('./agentText');
        const p = this.patients.get(action.patientId);
        if (!p && action.section !== 'board') return { ok: false, message: 'Unknown patient.' };
        if (p && (action.section === 'labs' || action.section === 'imaging' || action.section === 'summary')) {
          p.newResults = 0;
          this.touch(p);
        }
        return cost(0.5, { ok: true, text: ehrText(this, action.patientId, action.section, action.query) });
      }
      case 'sign_ecg':
        return cost(0.5, this.signEcg(action.ecgId, action.interpretation));
      case 'note': {
        const p = this.patients.get(action.patientId);
        if (!p) return { ok: false, message: 'Unknown patient.' };
        this.addNote(p, { t: this.t, type: 'Physician', author: `${this.playerName} (resident)`, title: action.title, text: action.text });
        return cost(2, { ok: true, message: 'Note signed.' });
      }
      case 'set_diagnoses':
        return cost(0.5, this.setDiagnoses(action.patientId, action.diagnoses));
      case 'disposition':
        return cost(1, this.disposition(action.patientId, action.decision, action.service, action.diagnoses, action.instructions, action.wheelchair));
      case 'assign_self': {
        const p = this.patients.get(action.patientId);
        if (!p) return { ok: false, message: 'Unknown patient.' };
        p.doctor = this.playerName;
        this.touch(p);
        return { ok: true, message: `You are now the physician for ${p.bedLabel}.` };
      }
      case 'ack_page': {
        const pg = this.pages.find((x) => x.id === action.pageId);
        if (pg) pg.read = true;
        this.dirty = true;
        return { ok: true };
      }
      case 'inspect': {
        const r = this.inspect(action.itemId);
        return cost(r.ok ? 1 : 0, r);
      }
      case 'give_item':
        return cost(0, this.giveItem(action.itemId));
      case 'mark_read': {
        const p = this.patients.get(action.patientId);
        if (!p) return { ok: false, message: 'Unknown patient.' };
        p.newResults = 0;
        for (const n of p.notes) n.unread = false;
        this.touch(p);
        return { ok: true };
      }
      case 'wait': {
        const mins = Math.max(0, Math.min(120, action.minutes));
        this.advance(mins * M);
        return { ok: true, message: `Waited ${mins} min — now ${this.clock()}.`, costMin: mins };
      }
      case 'end_shift':
        this.end('You ended the shift');
        return { ok: true, message: 'Shift ended.' };
    }
    // an action type the game doesn't know (an agent's typo, or one written for an older version)
    const type = String((action as { type?: unknown }).type);
    if (type === 'pocus') return { ok: false, message: 'Bedside ultrasound views are exam maneuvers: use examine with maneuver pocus_<window>, e.g. pocus_rlq.' };
    return { ok: false, message: `Unknown action "${type}".` };
  }

  atWorkstation(): boolean {
    return ['station', 'workroom', 'triage'].includes(this.playerLocation);
  }
}

// ───────────────────────────── utils ─────────────────────────────

function similarNames(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  if (x.slice(0, 5) === y.slice(0, 5)) return true;
  return levenshtein(x, y) <= 2;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function defaultImaging(code: string): { findings: string; impression: string; imageKey?: string } {
  const def = ORDERS[code];
  return { findings: `${def?.name ?? 'Study'}: no acute abnormality identified.`, impression: 'No acute findings.', imageKey: undefined };
}

export type { EffectDef };

/**
 * Does a physician's ECG interpretation contain the case's key finding? Only negations of the
 * case's *own* keywords count against it ("AF with RVR, no ST elevation" is a correct AF read;
 * "no STEMI" is itself a keyword for a non-ischemic tracing).
 */
export function ecgReadCorrect(interpretation: string, keywords: string[]): boolean {
  const read = ` ${interpretation.toLowerCase()} `;
  const kws = keywords.map((k) => k.toLowerCase());
  const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = kws.some((k) => read.includes(k));
  const negated = kws.some((k) => !/^(no|not|without)\b/.test(k.trim()) && new RegExp(`\\b(no|without|not|absent)\\s+(evidence\\s+of\\s+|signs?\\s+of\\s+)?${esc(k.trim())}`).test(read));
  return hit && !negated;
}

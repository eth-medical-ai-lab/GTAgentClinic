import { roomById } from '../../shared/layout';
/**
 * Projections from hidden session state → player-visible views.
 * This file is the information firewall: it must never copy case truth.
 */
import { monitorAlarms } from '../../shared/alarms';
import { ORDERS } from '../../shared/catalog';
import { erectStudy } from '../../shared/imaging';
import type { Contact, ConversationView, MonitorView, NpcView, PatientBoardRow, PatientChart, PlayerView, ScanView } from '../../shared/types';
import type { LlmStatus } from '../../shared/types';
import { markSmallTalk } from '../npc/smalltalk';
import { aiDoctorNpc, driverView } from './aiDoctor';
import { bedPositionFor } from './bedPosition';
import { attendingLineContact, escalationViews } from './escalation';
import { activePrecautions } from './hygiene';
import { type GameSession, type PatientState } from './session';
import { applyDischargePresentation } from './dischargePresentation';

export function boardRow(s: GameSession, p: PatientState): PatientBoardRow {
  const c = p.c;
  const nurse = s.staff.get(p.nurseId);
  // isolation signage for the 3D view (agentText.ts doesn't print it: the agents' text stays as it was)
  const precautions = activePrecautions(s, p);
  return {
    id: p.id,
    name: `${c.patient.lastName}, ${c.patient.firstName}`,
    age: c.patient.age,
    sex: c.patient.sex,
    bed: p.bed,
    bedLabel: p.bedLabel,
    chiefComplaint: c.presentation.chiefComplaint,
    esi: c.presentation.esi,
    arrivedAt: p.arrivalT,
    departedAt: p.departT,
    flowStatus: p.flow,
    nurse: nurse?.def.name,
    doctor: p.doctor,
    newResults: p.newResults,
    pendingLabs: p.orders.filter((o) => o.category === 'lab' && !['Resulted', 'Canceled'].includes(o.status) && o.code !== 'bcx' && o.code !== 'ucx').length,
    pendingImaging: p.orders.filter((o) => o.category === 'imaging' && !['Final', 'Canceled'].includes(o.status)).length,
    activeOrders: p.orders.filter((o) => !['Canceled'].includes(o.status)).length,
    critical: s.pages.some((pg) => pg.patientId === p.id && pg.priority === 'critical' && !pg.read),
    dispo: p.dispo?.decision,
    discharge: p.discharge,
    alerts: p.alerts,
    ...(precautions ? { precautions } : {}),
  };
}

export function buildChart(s: GameSession, p: PatientState): PatientChart {
  const c = p.c;
  const nurse = s.staff.get(p.nurseId);
  return {
    id: p.id,
    mrn: c.patient.mrn,
    name: `${c.patient.lastName}, ${c.patient.firstName}`,
    firstName: c.patient.firstName,
    lastName: c.patient.lastName,
    age: c.patient.age,
    sex: c.patient.sex,
    dob: c.patient.dob,
    weightKg: c.patient.weightKg,
    heightCm: c.patient.heightCm,
    bed: p.bed,
    bedLabel: p.bedLabel,
    esi: c.presentation.esi,
    chiefComplaint: c.presentation.chiefComplaint,
    arrivedAt: p.arrivalT,
    departedAt: p.departT,
    arrivalMode: c.presentation.arrivalMode,
    flowStatus: p.flow,
    allergies: c.presentation.documentedAllergies,
    codeStatus: c.patient.codeStatus,
    language: c.patient.language,
    pcp: c.patient.pcp,
    insurance: c.patient.insurance,
    emergencyContact: c.patient.emergencyContact,
    homeMeds: c.presentation.documentedHomeMeds,
    problemList: c.presentation.problemList,
    encounters: c.presentation.encounters,
    vitals: p.vitals,
    orders: p.orders.map(({ resultDueT, imagingId, volumeMl, ...o }) => o),
    labs: p.labs,
    imaging: p.imaging,
    ecgs: p.ecgs,
    mar: p.mar,
    notes: p.notes,
    diagnoses: p.diagnoses,
    disposition: p.dispo,
    discharge: p.discharge,
    onMonitor: p.onMonitor,
    ivAccess: p.ivAccess,
    npo: p.npo,
    assignedNurse: nurse?.def.name,
    assignedDoctor: p.doctor,
    alerts: p.alerts,
    version: p.version,
  };
}

function monitorFor(s: GameSession, p: PatientState): MonitorView {
  const m = s.minutesSinceArrival(p);
  const ph = p.physio;
  const hr = Math.round(ph.measured('hr', m));
  const sbp = Math.round(ph.measured('sbp', m));
  const dbp = Math.round(ph.measured('dbp', m));
  const spo2 = Math.min(100, Math.round(ph.measured('spo2', m)));
  const rr = Math.round(ph.measured('rr', m));
  const rhythm = p.c.ecg.params.rhythm;
  // shared/alarms.ts: the same table drives the monitor's banner and its IEC 60601-1-8 alarm tones
  const alarms = monitorAlarms({ hr, sbp, spo2, rhythm }).map((a) => a.label);
  const st = p.c.ecg.params.st?.II ?? 0;
  return {
    patientId: p.id,
    hr,
    sbp,
    dbp,
    spo2,
    rr,
    rhythm,
    alarm: alarms.length ? alarms.join(' · ') : undefined,
    stII: ph.hasTag('reperfusion') ? st * 0.4 : st,
  };
}

export function buildView(s: GameSession, llm: LlmStatus): PlayerView {
  const npcs: NpcView[] = [];
  const board: PatientBoardRow[] = [];
  const monitors: Record<string, MonitorView> = {};
  const surge = !!s.layout.treatmentSpaces;
  for (const trip of [...s.holding.values(), ...s.incoming.values(), ...s.returning.values()]) {
    const { patient: p, walker, since, from, to, stage, mobility, entrance } = trip;
    if (s.t < since) continue;
    const pose = walker.poseAt(s.t);
    const actor = 'pt_' + p.id, escort = 'intake_escort_' + p.id;
    const publicWaiting = stage === 'intake' && entrance === 'public';
    const label = stage === 'bed' ? p.bedLabel : publicWaiting ? 'registration' : 'EMS handover';
    const active = s.t < walker.arrival;
    const title = active ? (mobility === 'walking' ? 'Walking to ' : 'Transport to ') + label : 'Waiting at ' + label;
    if (stage !== 'return') npcs.push({
      id: actor, role: 'patient', name: `${p.c.patient.firstName} ${p.c.patient.lastName}`, title, appearance: p.c.patient.appearance,
      location: pose.room, spot: 'entry', posture: mobility === 'stretcher' ? 'lie' : mobility === 'wheelchair' ? 'sit' : 'stand',
      talkable: false, visible: true, ambient: { crowd: false, at: to,
        ...(mobility === 'wheelchair' ? { props: ['wheelchair'], pushedBy: escort } : {}) },
      walkIn: { patientId: p.id, sex: p.c.patient.sex, bed: stage === 'bed' ? p.bed : pose.room, from,
        since, until: walker.arrival, ...(surge ? { mobility, stage } : {}) },
    });
    if (surge && mobility !== 'walking') {
      const ems = entrance === 'ems';
      npcs.push({ id: escort, role: ems ? 'ems' : 'tech', name: ems ? 'Ambulance crew' : 'ED transporter',
        title: 'Patient transport', location: pose.room, spot: 'entry', posture: 'stand', talkable: false, visible: true,
        appearance: { outfit: ems ? 'ems' : 'scrubs', outfitColor: ems ? '#324456' : '#407988', skin: '#ac7c59',
          hair: '#43382e', hairStyle: 'short', height: 1.77, age: 'adult', build: 'average', accessories: ['badge'] },
        ...(stage === 'return' ? { walkIn: { patientId: p.id, sex: p.c.patient.sex, bed: pose.room, from, since, until: walker.arrival, stage, mobility } } : { escortOf: actor }),
        ambient: { crowd: false, at: to, ...(stage !== 'return' ? { look: actor } : {}),
          ...(mobility === 'wheelchair' ? { act: 'push', ...(stage === 'return' ? { props: ['wheelchair'] } : {}) } : {}) } });
    }
  }
  for (const p of s.patients.values()) {
    if (!p.arrived) continue;
    board.push(boardRow(s, p));
    if (p.departed && s.scenario.bedPool) continue; // release the 3D model when another patient can take the bay
    const c = p.c;
    const inImaging = p.location !== p.bed;
    // the head of the bed and how they lie or sit (bedPosition.ts: view only, from what can be observed)
    const bedPosition = bedPositionFor(s, p);
    // in the CT or X-ray room: the study and its slot, for the suite's presentation (view only;
    // client/src/world/imagingLife.ts). A chest film is taken standing at the wall stand
    const scan = inImaging && p.scan?.room === p.location ? p.scan : undefined;
    const erect = !!scan && erectStudy(scan.code);
    const patient: NpcView = {
      id: `pt_${p.id}`,
      name: `${c.patient.firstName} ${c.patient.lastName}`,
      role: 'patient',
      title: `Patient — ${p.bedLabel}`,
      location: p.location,
      spot: inImaging ? (erect ? 'wallStand' : 'table') : 'bed',
      posture: inImaging ? (erect ? 'stand' : 'lie') : bedPosition.sitting === 'edge' ? 'sit' : 'lie',
      bedPosition,
      discharge: p.discharge,
      ...(scan ? { scan: { modality: (ORDERS[scan.code]?.modality ?? 'CT') as ScanView['modality'], code: scan.code, study: ORDERS[scan.code]?.name ?? scan.code, since: scan.since, until: scan.until } } : {}),
      appearance: c.patient.appearance,
      patientId: p.id,
      talkable: !p.departed && !inImaging,
      emotion: p.emotion,
      visible: !p.departed,
    };
    if (patient.discharge) applyDischargePresentation(patient, p.bed, s.layout, s.t);
    npcs.push(patient);
    if (c.family && p.family && p.family.status !== 'absent') {
      const out = p.family.status === 'out';
      const spots = roomById(s.layout, p.bed)?.spots;
      // At high-acuity beds a relative stands at the foot, leaving both nursing sides clear.
      const stand = surge && !out && ((!spots?.chair) || (c.presentation.esi <= 2 && !!spots.foot));
      npcs.push({
        id: c.family.npcId,
        name: c.family.name,
        role: 'family',
        title: `${c.family.relation.split(' (')[0]} of ${c.patient.firstName}`,
        location: out ? 'waiting' : p.bed,
        spot: out ? 'chair-11' : stand ? 'foot' : 'chair',
        posture: stand ? 'stand' : 'sit',
        appearance: c.family.appearance,
        patientId: p.id,
        talkable: !p.departed,
        visible: !p.departed,
      });
    }
    if (p.onMonitor && !p.departed && !inImaging) monitors[p.bed] = monitorFor(s, p);
  }
  for (const st of s.staff.values()) {
    const dischargePatient = s.dischargePatient(st);
    const task = st.current;
    const target = surge && st.def.role === 'nurse' && task?.pid && !task.canceled && ['assess', 'vitals', 'draw', 'give', 'nursing'].includes(task.kind)
      ? s.patients.get(task.pid) : undefined;
    const staff: NpcView = {
      id: st.def.id,
      name: st.def.name,
      role: st.def.role,
      title: st.def.title,
      location: st.location,
      spot: st.spot,
      posture: st.posture,
      activity: st.activity,
      ...(target && !target.departed && target.bed === st.location && target.location === target.bed ? { bedsidePatientId: target.id } : {}),
      appearance: st.def.appearance,
      talkable: st.def.talkable,
      bark: st.bark && s.t - st.bark.t < 60 * 3 ? st.bark : undefined,
      visible: st.visible,
      discharge: dischargePatient?.discharge,
    };
    if (dischargePatient) applyDischargePresentation(staff, dischargePatient.bed, s.layout, s.t);
    npcs.push(staff);
  }
  // the waiting-room crowd, and how the staff it borrows look right now (view only; ambient.ts)
  s.ambient.apply(npcs);
  // agent-driven shifts: the AI resident walks the floor as an NPC (aiDoctor.ts); never in human sessions
  const aiDoctor = aiDoctorNpc(s);
  if (aiDoctor) npcs.push(aiDoctor);
  // everyone else who walks around can be stopped for a word, off the record (npc/smalltalk.ts)
  const offRecord = markSmallTalk(s, npcs);
  const conversations: ConversationView[] = [...s.conversations.values(), ...offRecord].map((cv) => ({
    key: cv.key,
    npcId: cv.npcId,
    contactId: cv.contactId,
    title: cv.title,
    lines: cv.lines.slice(-60),
    typing: cv.typing,
  }));
  return {
    sessionId: s.id,
    mapId: s.scenario.id,
    mapTitle: s.scenario.title,
    layoutId: s.scenario.layoutId,
    t: s.t,
    clockStart: s.scenario.shiftStart,
    durationMin: s.scenario.durationMin,
    mode: s.mode,
    ...(surge ? { rosterCapacity: s.rosterCapacity() } : {}),
    settings: s.settings,
    player: { name: s.playerName, location: s.playerLocation, focus: s.focus, ...(s.masked ? { masked: true } : {}), ...(s.gloved ? { gloved: true } : {}) },
    board: board.sort((a, b) => a.esi - b.esi || a.arrivedAt - b.arrivedAt),
    npcs,
    pages: s.pages.slice(-40),
    conversations,
    contacts: contactsFor(s),
    examFindings: Object.fromEntries([...s.patients.values()].filter(p => p.arrived).map((p) => [p.id, p.exam])),
    chartVersions: Object.fromEntries([...s.patients.values()].filter((p) => p.arrived).map((p) => [p.id, p.version])),
    monitors,
    ended: s.ended,
    llm,
    usage: s.brain.ledger.sessionView(s.id, s.brain.provider ? llm.provider : 'offline'),
    driver: driverView(s),
    items: s.items().map(({ p, item }) => ({ id: item.id, patientId: p.id, kind: item.kind, label: item.label, location: p.bed, where: item.where, inspected: p.inspected.has(item.id), given: p.given.has(item.id) })),
    escalations: escalationViews(s),
  };
}

export function contactsFor(s: GameSession): Contact[] {
  // the attending's line heads the directory once a patient was escalated to her by phone
  const line = attendingLineContact(s);
  const out: Contact[] = [...(line ? [line] : []), ...s.scenario.internalContacts.map((c) => ({ ...c.contact }))];
  for (const p of s.patients.values()) {
    if (!p.arrived) continue;
    for (const pc of p.c.phoneContacts ?? []) out.push({ ...pc.contact, patientId: p.id });
  }
  return out;
}

export function orderLabel(code: string): string {
  return ORDERS[code]?.name ?? code;
}

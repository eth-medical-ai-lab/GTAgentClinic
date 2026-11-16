/**
 * Talking to NPCs and phoning contacts: builds the per-turn [Situation] from simulator
 * state (what that NPC can know), calls the brain, and applies validated actions.
 */
import type { CaseDef, PhoneContactDef } from '../../content/types';
import { ANALYTES, ORDERS } from '../../shared/catalog';
import type { ActionResult, ChatLine } from '../../shared/types';
import { formatLabValue, formatVitalsLine, labUnit } from '../../shared/units';
import { ATTENDING_LINE, escalationSituation, lineEscalation, ringLine } from '../sim/escalation';
import { evalRule } from '../sim/scoring';
import type { Conversation, GameSession, PatientState } from '../sim/session';
import type { NpcAction, NpcReply } from './brain';
import type { OfflineCtx } from './offline';
import { familySpec, patientSpec, phoneSpec, staffSpec, type NpcSpec } from './prompts';
import { isSmallTalk, smallTalk } from './smalltalk';

const specCache = new WeakMap<GameSession, Map<string, NpcSpec>>();

function cachedSpec(s: GameSession, key: string, make: () => NpcSpec): NpcSpec {
  let m = specCache.get(s);
  if (!m) specCache.set(s, (m = new Map()));
  let spec = m.get(key);
  if (!spec) m.set(key, (spec = make()));
  return spec;
}

function line(s: GameSession, speaker: ChatLine['speaker'], name: string, text: string, emotion?: ChatLine['emotion']): ChatLine {
  return { id: `l${++s.nextChatLine}`, t: s.t, speaker, name, text, emotion };
}

function conversation(s: GameSession, key: string, title: string, extra: Partial<Conversation> = {}): Conversation {
  let c = s.conversations.get(key);
  if (!c) {
    c = { key, title, lines: [], typing: false, history: [], ...extra };
    s.conversations.set(key, c);
  }
  return c;
}

// ───────────────────────────── situation builders ─────────────────────────────

function medsGiven(s: GameSession, p: PatientState, lay: boolean): string {
  if (!p.mar.length) return lay ? 'You have not been given any medicine yet.' : 'Nothing given yet.';
  return (lay ? 'Medicines you were given: ' : 'Given: ') + p.mar.slice(-6).map((m) => `${m.med.split(' ')[0]} ${m.dose} at ${s.clock(m.t)}`).join(', ') + '.';
}

function patientFeel(s: GameSession, p: PatientState): string {
  const v = s.trueVitals(p);
  const cues: string[] = [`Your pain is about ${Math.round(v.pain)}/10.`];
  if (v.sbp < 85) cues.push('You feel faint, cold, and very weak.');
  else if (v.sbp < 95) cues.push('You feel a bit light-headed.');
  if (v.hr > 125) cues.push('Your heart is racing.');
  if (v.hr < 48) cues.push('You feel woozy and washed out.');
  if (v.temp > 38.5) cues.push('You feel feverish and shivery.');
  if (v.spo2 < 91) cues.push('You feel short of breath.');
  if (v.gcs < 13) cues.push('You are very drowsy and muddled — answer only with a few mumbled words.');
  else if (v.gcs < 15 && p.c.persona.capacity === 'impaired') cues.push('You are confused and distractible.');
  return cues.join(' ');
}

/** a belonging as the patient would call it */
const LAY_ITEM: Record<string, string> = { handbag: 'handbag', sportsBag: 'sports bag', medBag: 'bag of medicines', pillBottle: 'pill bottle', letter: 'letter', phone: 'phone', glasses: 'glasses', wallet: 'wallet' };

/** (also read by server/npc/watcher.ts for off-the-record watcher chats: these builders only read state) */
export function patientSituation(s: GameSession, p: PatientState): string {
  const parts = [`[Situation ${s.clock()}: You are in ${p.bedLabel} of the emergency department.`, patientFeel(s, p)];
  if (p.c.family) {
    if (p.family?.status === 'present') parts.push(`${p.c.family.name} (${p.c.family.relation.split(' (')[0].toLowerCase()}) is in the room with you.`);
    else parts.push(`${p.c.family.name} is NOT in the room right now — you are alone with the doctor.`);
  }
  const given = (p.c.items ?? []).filter((it) => p.given.has(it.id));
  if (given.length) parts.push(`The doctor handed you your ${given.map((it) => LAY_ITEM[it.kind] ?? it.kind).join(' and your ')}: you have it with you in bed.`);
  if (p.ivAccess) parts.push('You have an IV in your arm.');
  if (p.onMonitor) parts.push('You are hooked up to a heart monitor.');
  if (p.npo) parts.push('You were told not to eat or drink.');
  parts.push(medsGiven(s, p, true));
  if (p.acceptedBy) parts.push(`You have been told a specialist team (${p.acceptedBy}) is coming to take over your care.`);
  if (p.dispo) parts.push(`Plan you were told about: ${p.dispo.decision.replace('_', ' ')}.`);
  return parts.join(' ') + ']';
}

export function familySituation(s: GameSession, p: PatientState): string {
  const v = s.trueVitals(p);
  const look = v.sbp < 88 || v.gcs < 13 ? 'looks worse — pale and very drowsy' : v.pain >= 6 ? 'is clearly in pain' : 'looks a bit more comfortable';
  const updated = p.counseled.size > 0 ? 'A doctor has explained some things to you already.' : 'Nobody has explained anything to you yet.';
  return `[Situation ${s.clock()}: You are at the bedside in ${p.bedLabel}. ${p.c.patient.firstName} ${look}. ${updated} ${medsGiven(s, p, true)}${p.dispo ? ` Plan: ${p.dispo.decision.replace('_', ' ')}.` : ''}]`;
}

export function chartSummary(s: GameSession, p: PatientState, depth: 'brief' | 'full'): string {
  const c = p.c;
  const units = s.settings.units;
  const lastV = p.vitals[p.vitals.length - 1];
  const latest = new Map<string, string>();
  for (const l of p.labs) {
    if (l.historical) continue;
    const a = ANALYTES[l.analyte];
    latest.set(l.analyte, `${a?.short ?? l.analyte} ${formatLabValue(l.analyte, l.value, units)}${typeof l.value === 'number' ? ' ' + labUnit(l.analyte, units) : ''}${l.flag ? ` (${l.flag})` : ''}`);
  }
  const labs = [...latest.values()];
  const pendingLabs = p.orders.filter((o) => o.category === 'lab' && !['Resulted', 'Canceled'].includes(o.status)).map((o) => `${o.name} [${o.status}]`);
  const img = p.imaging.map((i) => `${i.name}: ${i.status}${i.impression ? ` — ${i.impression}` : ''}`);
  const ecg = p.ecgs.map((e) => `${e.label} ${s.clock(e.acquiredAt)}: machine read "${e.machineRead}"${e.physicianRead ? `; physician read "${e.physicianRead}"` : ''}`);
  const out = [
    `${c.patient.lastName}, ${c.patient.firstName} — ${c.patient.age}${c.patient.sex}, DOB ${c.patient.dob}, ${p.bedLabel} (${p.bed}), CC "${c.presentation.chiefComplaint}", ESI ${c.presentation.esi}, arrived ${s.clock(p.arrivalT)}. Status: ${p.flow}${p.dispo ? `, dispo ${p.dispo.decision}` : ''}.`,
    `Allergies (documented): ${c.presentation.documentedAllergies === 'NKDA' ? 'NKDA' : c.presentation.documentedAllergies.map((a) => a.substance).join(', ')}. Weight ${c.patient.weightKg} kg.`,
    `Latest vitals (${lastV ? s.clock(lastV.t) : '—'}): ${lastV ? formatVitalsLine(lastV, units) : 'none'}.`,
  ];
  if (depth === 'full' || labs.length) out.push(`Resulted labs: ${labs.join(', ') || 'none'}.${pendingLabs.length ? ` Pending: ${pendingLabs.join(', ')}.` : ''}`);
  if (img.length) out.push(`Imaging: ${img.join('; ')}.`);
  if (ecg.length) out.push(`ECG: ${ecg.join('; ')}.`);
  out.push(medsGiven(s, p, false));
  if (p.diagnoses.length) out.push(`ED working diagnoses: ${p.diagnoses.join('; ')}.`);
  if (depth === 'full') {
    const active = p.orders.filter((o) => !['Canceled', 'Resulted', 'Final', 'Given', 'Completed'].includes(o.status)).map((o) => `${o.name}${o.params?.dose ? ' ' + o.params.dose : ''} [${o.status}]`);
    if (active.length) out.push(`Active/pending orders: ${active.join(', ')}.`);
  }
  return out.join(' ');
}

function staffSituation(s: GameSession, staffId: string): string {
  const st = s.staff.get(staffId)!;
  const parts = [`[Situation ${s.clock()}: You are in ${s.layout.rooms.find((r) => r.id === st.location)?.label ?? st.location}.${st.activity ? ` Current task: ${st.activity}.` : ' You are free right now.'}`];
  const mine = s.presentPatients().filter((p) => st.def.role !== 'nurse' || !st.def.assigned || st.def.assigned.includes(p.bed) || st.def.id === 'rn_rosa');
  if (st.def.role === 'attending') {
    parts.push(`Board: ${s.presentPatients().map((p) => chartSummary(s, p, 'brief')).join(' | ') || 'empty'}.`);
    const rounds = s.flags.has('rounds_started') ? ' You asked the resident to run the board with you — if they present a patient, give feedback and ask one teaching question.' : '';
    parts.push(rounds);
    parts.push(escalationSituation(s, staffId)); // the resident called you about a patient (server/sim/escalation.ts)
  } else {
    parts.push(`Patients you know about: ${mine.map((p) => chartSummary(s, p, 'full')).join(' | ') || 'none'}.`);
    if (st.queue.length) parts.push(`Your task list: ${st.queue.map((q) => q.label).join('; ')}.`);
  }
  // staff-error knowledge (the nurse believes she is right)
  for (const err of s.safety) {
    if (err.status !== 'active') continue;
    const d = err.def;
    if (d.kind === 'wrong_patient_med' && d.nurseId === staffId) {
      const wrong = s.patients.get(err.pid)!;
      parts.push(`You are about to give ${ORDERS[d.medCode].med?.generic} ${d.dose} IV to ${wrong.c.patient.firstName} ${wrong.c.patient.lastName} in ${wrong.bedLabel}, believing it was ordered for him. (Truth you have not noticed: it was ordered for a patient with a similar name in another bed; you skipped the wristband check.) If the doctor questions this medication, the patient, the name, or tells you to stop/check — double-check, realize the mix-up, apologize, and use the stop_med action.`);
    }
    if (d.kind === 'abx_before_cultures' && s.patients.get(err.pid)?.nurseId === staffId) {
      const p = s.patients.get(err.pid)!;
      parts.push(`You are starting antibiotics on ${p.bedLabel} before drawing the ordered blood cultures (the lab line is backed up). If the doctor tells you to draw cultures first, agree and use cultures_first.`);
    }
    if (d.kind === 'missing_triage_vital' && (st.def.role === 'nurse')) {
      const p = s.patients.get(err.pid)!;
      if (!s.flags.has(`${p.id}:temp_requested`)) parts.push(`Note: no temperature has been recorded for ${p.bedLabel} since triage (triage could not get one). If asked about her temperature, say it hasn't been measured yet; offer to check it.`);
    }
  }
  return parts.join(' ') + ']';
}

function phoneSituation(s: GameSession, pc: PhoneContactDef, pid?: string): string {
  const id = pc.contact.id;
  const parts = [`[Situation ${s.clock()}:`];
  if (['cards', 'surg', 'hosp', 'icu', 'ortho', 'obgyn', 'pharm'].includes(id)) {
    parts.push(`You can see these ED charts: ${s.presentPatients().map((p) => chartSummary(s, p, 'full')).join(' | ') || 'none'}.`);
    for (const p of s.presentPatients()) {
      const cd = p.c.consults.find((x) => x.contactId === id);
      if (!cd) continue;
      const ok = cd.guard ? evalRule(s, p, cd.guard, s.log).ok : true;
      parts.push(`Acceptance prerequisites for ${p.c.patient.lastName} (${p.bed}) ${ok ? 'are met in the chart' : 'are NOT yet met in the chart — do not accept yet; ask for what is missing'}.${p.acceptedBy ? ` (Already accepted by ${p.acceptedBy}.)` : ''}`);
    }
  } else if (id === 'lab') {
    parts.push(
      `Lab status: ${s
        .presentPatients()
        .map((p) => `${p.c.patient.lastName} (${p.bedLabel}): ${p.orders.filter((o) => o.category === 'lab').map((o) => `${o.name} — ${o.status}${o.resultDueT ? ` (ETA ${s.clock(o.resultDueT)})` : ''}`).join('; ') || 'no lab orders'}`)
        .join(' | ')}. Resulted values: ${s.presentPatients().map((p) => chartSummary(s, p, 'brief')).join(' | ')}.`,
    );
  } else if (id === 'radiology') {
    parts.push(`Imaging worklist: ${s.presentPatients().map((p) => `${p.c.patient.lastName} (${p.bedLabel}, ${p.c.patient.age}${p.c.patient.sex}): ${p.imaging.map((i) => `${i.name} — ${i.status}${i.impression ? `; report: ${i.findings} IMPRESSION: ${i.impression}` : ''}`).join('; ') || 'no imaging'}`).join(' | ')}.`);
  } else if (pid) {
    const p = s.patients.get(pid);
    if (p) parts.push(`The call concerns ${p.c.patient.firstName} ${p.c.patient.lastName}.`);
  }
  const conv = s.conversations.get(`phone:${id}`);
  if (pc.requiresIdentifiers) parts.push(conv?.verified?.size ? 'The caller HAS given the patient\'s full name and date of birth — you may share information.' : 'The caller has NOT yet given both the full name and date of birth.');
  return parts.join(' ') + ']';
}

// ───────────────────────────── shared helpers ─────────────────────────────

function bedsCtx(s: GameSession) {
  return s.presentPatients().map((p) => ({ bed: p.bed, label: p.bedLabel, lastName: p.c.patient.lastName }));
}

function recordFacts(s: GameSession, pid: string | undefined, reply: NpcReply, npcId: string) {
  if (!pid) return;
  const p = s.patients.get(pid);
  if (!p) return;
  for (const f of reply.revealed) {
    if (!p.revealed.has(f)) {
      p.revealed.add(f);
      s.logEvent({ kind: 'fact', pid, factId: f, npcId });
    }
  }
  for (const c of reply.counseled) {
    if (!p.counseled.has(c)) {
      p.counseled.add(c);
      s.logEvent({ kind: 'counseled', pid, id: c });
    }
  }
}

function resolvePatient(s: GameSession, roster: PatientState[], ref: string | undefined, fallback?: PatientState): PatientState | undefined {
  // Resolve on the board the NPC saw when they spoke, even if a bed turned over during their reply.
  const p = ref ? s.patientByBedOrName(ref, roster) : fallback;
  return p?.departed ? undefined : p;
}

function applyStaffActions(s: GameSession, staffId: string, actions: NpcAction[], roster: PatientState[], fallback?: PatientState): string[] {
  const st = s.staff.get(staffId)!;
  const notes: string[] = [];
  for (const a of actions) {
    const p = resolvePatient(s, roster, a.patient, fallback);
    switch (a.id) {
      case 'verbal_order': {
        if (!p || !a.code || !ORDERS[a.code]) break;
        const def = ORDERS[a.code];
        const dose = a.dose && def.med ? def.med.doses.find((d) => d.toLowerCase().replace(/\s/g, '') === a.dose!.toLowerCase().replace(/\s/g, '')) ?? a.dose : undefined;
        const r = s.placeOrder(p.id, a.code, dose ? { dose } : undefined, 'STAT', `Verbal order via ${st.def.name}`);
        if (r.ok) notes.push(`📝 Verbal order entered by ${st.def.name.split(' ')[0]}: ${def.name}${dose ? ' ' + dose : ''} — ${p.bedLabel}`);
        break;
      }
      case 'vitals_now': {
        if (!p) break;
        s.flags.add(`${p.id}:temp_requested`);
        s.placeOrder(p.id, 'vitals_now', undefined, 'STAT', `Verbal order via ${st.def.name}`);
        notes.push(`📝 ${st.def.name.split(' ')[0]} will recheck vitals incl. temperature — ${p.bedLabel}`);
        break;
      }
      case 'cultures_first': {
        if (!p) break;
        s.flags.add(`${p.id}:cultures_first`);
        if (!p.orders.some((o) => o.code === 'bcx' && o.status !== 'Canceled')) s.placeOrder(p.id, 'bcx', undefined, 'STAT', `Verbal order via ${st.def.name}`);
        notes.push(`🧫 ${st.def.name.split(' ')[0]} will draw blood cultures before antibiotics — ${p.bedLabel}`);
        break;
      }
      case 'stop_med': {
        const detail = s.stopWrongMed();
        if (detail) notes.push(`🛑 Medication error prevented: ${detail}`);
        break;
      }
    }
  }
  return notes;
}

// ───────────────────────────── talk ─────────────────────────────

export async function talk(s: GameSession, npcId: string, text: string, topic?: 'night-radio'): Promise<ActionResult> {
  // the crowd, registration, security, housekeeping, cafeteria and clinic: small talk, off the record
  if (isSmallTalk(s, npcId)) return smallTalk(s, npcId, text, topic);
  text = text.trim().slice(0, 1200);
  if (!text) return { ok: false, message: 'Say something.' };
  let spec: NpcSpec;
  let situation: string;
  let pid: string | undefined;
  let location: string | undefined;
  let fallbackPatient: PatientState | undefined;
  const offline: OfflineCtx = { firstTurn: false, beds: bedsCtx(s) };

  if (npcId.startsWith('pt_')) {
    const p = s.patients.get(npcId.slice(3));
    if (!p || !p.arrived || p.departed) return { ok: false, message: 'That patient is not here.' };
    if (p.discharge?.phase === 'leaving') return { ok: false, message: 'The patient is on the way to the exit.' };
    if (p.location !== p.bed) return { ok: false, message: `${p.c.patient.firstName} is in ${p.location.toUpperCase()} right now.` };
    pid = p.id;
    location = p.bed;
    spec = cachedSpec(s, npcId, () => patientSpec(`${s.id}:${npcId}`, p.id, p.c));
    situation = patientSituation(s, p);
    if (p.firstContactT === undefined) p.firstContactT = s.t;
  } else {
    const fam = [...s.patients.values()].find((p) => p.c.family?.npcId === npcId);
    if (fam) {
      if (!fam.family || fam.family.status === 'absent' || fam.departed) return { ok: false, message: `${fam.c.family!.name} is not here.` };
      pid = fam.id;
      location = fam.family.status === 'out' ? 'waiting' : fam.bed;
      spec = cachedSpec(s, npcId, () => familySpec(`${s.id}:${npcId}`, fam.id, fam.c));
      situation = familySituation(s, fam);
    } else {
      const st = s.staff.get(npcId);
      if (!st || !st.def.talkable) return { ok: false, message: 'Nobody by that id to talk to.' };
      if (s.dischargePatient(st)?.discharge?.phase === 'leaving') {
        return { ok: false, message: 'The nurse is escorting a patient to the exit.' };
      }
      location = st.location;
      const brief = s
        .presentPatients()
        .map((p) => `- ${p.c.patient.lastName} (${p.bedLabel}): ${p.c.truth.diagnosis.label}. Key pitfalls: ${p.c.teaching.slice(0, 2).join(' ')}`)
        .join('\n');
      spec = cachedSpec(s, npcId, () => staffSpec(`${s.id}:${npcId}`, st.def, s.scenario, brief || '- (no patients yet)'));
      // attending brief must reflect patients present → refresh spec when the board changes
      if (st.def.role === 'attending' && !spec.system.includes(brief || '- (no patients yet)')) {
        specCache.get(s)!.delete(npcId);
        spec = cachedSpec(s, npcId, () => staffSpec(`${s.id}:${npcId}:${s.presentPatients().length}`, st.def, s.scenario, brief || '- (no patients yet)'));
      }
      situation = staffSituation(s, npcId);
      fallbackPatient = s.presentPatients().find((p) => p.bed === s.playerLocation) ?? s.presentPatients().find((p) => p.bed === st.location);
      offline.defaultBed = fallbackPatient?.bed;
    }
  }
  if (s.mode === 'step' && location && s.playerLocation !== location) return { ok: false, message: `You need to be in the same place to talk (they are in "${location}", you are in "${s.playerLocation}"). Use move first.` };

  const conv = conversation(s, npcId, spec.name, { npcId, pid });
  offline.firstTurn = conv.lines.length === 0;
  conv.lines.push(line(s, 'player', 'You', text));
  conv.typing = true;
  s.dirty = true;
  s.logEvent({ kind: 'talk', pid, npcId, text });

  const roster = s.presentPatients();
  const reply = await s.reply(spec, conv, situation, text, offline);
  if (reply.notice) s.emit({ kind: 'toast', text: reply.notice, tone: 'warn' });
  conv.typing = false;
  const spoken = line(s, 'npc', spec.name, reply.say, reply.emotion);
  conv.lines.push(spoken);
  s.emit({ kind: 'speech', lineId: spoken.id, npcId, name: spoken.name, text: spoken.text, emotion: spoken.emotion });
  recordFacts(s, pid, reply, npcId);

  // apply actions
  const notes: string[] = [];
  if (spec.kind === 'staff') notes.push(...applyStaffActions(s, npcId, reply.actions, roster, fallbackPatient));
  for (const a of reply.actions) {
    if (a.id === 'step_out' && pid) {
      const p = s.patients.get(pid)!;
      if (p.family) {
        p.family.status = 'out';
        p.family.returnT = s.t + 15 * 60;
        notes.push(`${p.c.family!.name} stepped out to the waiting room.`);
      }
    }
    if (a.id === 'consent' && pid) s.flags.add(`${pid}:consent`);
  }
  if (spec.kind === 'patient' && pid) {
    const p = s.patients.get(pid)!;
    if (reply.emotion) p.emotion = reply.emotion;
  }
  for (const n of notes) {
    conv.lines.push(line(s, 'system', 'System', n));
    s.emit({ kind: 'toast', text: n, tone: n.startsWith('🛑') ? 'good' : 'info' });
  }
  s.dirty = true;
  return { ok: true, text: reply.say, data: { npcId, emotion: reply.emotion, source: reply.source, notes, ...(pid && reply.revealed.length ? { historyPatient: pid } : {}) } };
}

// ───────────────────────────── phone ─────────────────────────────

function verifyIdentifiers(c: CaseDef, text: string): boolean {
  const t = text.toLowerCase();
  const [y, m, d] = c.patient.dob.split('-');
  const nameOk = t.includes(c.patient.lastName.toLowerCase());
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  const dobOk =
    t.includes(y) &&
    (t.includes(`${mi}/${di}`) || t.includes(`${m}/${d}`) || t.includes(`${di}.${mi}`) || t.includes(`${d}.${m}`) || t.includes(`${y}-${m}-${d}`) || t.includes(months[mi - 1]) || t.includes(months[mi - 1].slice(0, 3)));
  return nameOk && dobOk;
}

export async function call(s: GameSession, contactId: string, text: string, pidHint?: string): Promise<ActionResult> {
  if (contactId === ATTENDING_LINE) return attendingCall(s, text);
  const internal = s.scenario.internalContacts.find((c) => c.contact.id === contactId);
  const external = s.playerContacts.get(contactId);
  const pc = internal ?? external;
  if (!pc) return { ok: false, message: `No such contact "${contactId}".` };
  // which patient does an external contact belong to?
  let pid = pidHint;
  if (external) {
    const owner = [...s.patients.values()].find((p) => p.c.phoneContacts?.some((x) => x.contact.id === contactId));
    if (owner && !owner.arrived) return { ok: false, message: 'No reason to call them yet.' };
    pid = owner?.id;
  }
  const key = `phone:${contactId}`;
  const conv = conversation(s, key, pc.contact.name, { contactId, pid, verified: new Set() });
  if (conv.lines.length === 0 || conv.lines[conv.lines.length - 1]?.text === 'Call ended.') {
    conv.lines.push(line(s, 'system', 'Phone', `Calling ${pc.contact.name} (${pc.contact.phone})…`));
    const opening = line(s, 'npc', pc.contact.name, pc.persona.opening);
    conv.lines.push(opening);
    s.logEvent({ kind: 'call', contactId, pid });
    s.emit({ kind: 'speech', lineId: opening.id, contactId, name: opening.name, text: opening.text });
  }
  text = text.trim().slice(0, 1500);
  if (!text || text === '__dial__') {
    s.dirty = true;
    return { ok: true, text: pc.persona.opening };
  }
  // identity verification (deterministic guard for PHI release)
  const owner = pid ? s.patients.get(pid) : undefined;
  if (pc.requiresIdentifiers && owner) {
    const all = conv.lines.filter((l) => l.speaker === 'player').map((l) => l.text).join(' ') + ' ' + text;
    if (verifyIdentifiers(owner.c, all)) conv.verified!.add(owner.id);
  }
  const consultCriteria = internal
    ? s.presentPatients().flatMap((p) => p.c.consults.filter((cd) => cd.contactId === contactId).map((cd) => ({ pid: p.id, bed: p.bed, name: `${p.c.patient.firstName} ${p.c.patient.lastName}`, c: cd })))
    : undefined;
  const specKey = `${key}:${consultCriteria?.map((x) => x.pid).join(',') ?? ''}`;
  const spec = cachedSpec(s, specKey, () =>
    phoneSpec(`${s.id}:${specKey}`, pc, {
      pid,
      patientIdentity: owner ? `${owner.c.patient.firstName} ${owner.c.patient.lastName}, DOB ${owner.c.patient.dob}` : undefined,
      consultCriteria,
    }),
  );
  const situation = phoneSituation(s, pc, pid);
  const offline: OfflineCtx = {
    firstTurn: false,
    beds: bedsCtx(s),
    identifiersOk: pc.requiresIdentifiers ? (owner ? conv.verified!.has(owner.id) : false) : undefined,
    acceptable: Object.fromEntries(s.presentPatients().map((p) => {
      const cd = p.c.consults.find((x) => x.contactId === contactId);
      return [p.bed, !!cd && (!cd.guard || evalRule(s, p, cd.guard, s.log).ok)];
    })),
    dxKeywords: Object.fromEntries(s.presentPatients().map((p) => [p.bed, [...p.c.truth.diagnosis.accept, ...p.c.truth.diagnosis.partial]])),
  };
  conv.lines.push(line(s, 'player', 'You', text));
  conv.typing = true;
  s.dirty = true;
  const roster = s.presentPatients();
  const reply = await s.reply(spec, conv, situation, text, offline);
  if (reply.notice) s.emit({ kind: 'toast', text: reply.notice, tone: 'warn' });
  conv.typing = false;
  const spoken = line(s, 'npc', pc.contact.name, reply.say, reply.emotion);
  conv.lines.push(spoken);
  s.emit({ kind: 'speech', lineId: spoken.id, contactId, name: spoken.name, text: spoken.text });

  // facts from external contacts count toward that patient's history; withheld until identity verified
  if (owner && (!pc.requiresIdentifiers || conv.verified!.has(owner.id))) recordFacts(s, owner.id, reply, contactId);

  const notes: string[] = [];
  for (const a of reply.actions) {
    if (a.id === 'accept') {
      const p = resolvePatient(s, roster, a.patient);
      if (!p) continue;
      const cd = p.c.consults.find((x) => x.contactId === contactId);
      if (!cd || p.acceptedBy || p.discharge || p.departed) continue;
      if (cd.guard && !evalRule(s, p, cd.guard, s.log).ok) {
        notes.push(`(${pc.contact.name} will accept once the chart supports it — ${cd.declineHint})`);
        continue;
      }
      notes.push(`✅ ${s.acceptConsult(p, contactId, pc.contact.name)}`);
    }
    const pa = pc.phoneActions?.find((x) => x.id === a.id);
    if (pa && owner) {
      if (pc.requiresIdentifiers && !conv.verified!.has(owner.id)) continue;
      if (pa.flag && s.flags.has(`${owner.id}:${pa.flag}`)) continue;
      if (pa.flag) s.flags.add(`${owner.id}:${pa.flag}`);
      if (pa.note) {
        const note = pa.note;
        s.after(note.delayMin, () => {
          s.addNote(owner, { t: s.t, type: note.type, author: note.author, title: note.title, text: note.text, unread: true });
          s.page('Unit clerk', `${note.title} received for ${owner.bedLabel}.`, 'info', owner.id);
        });
        notes.push(`📠 ${pa.description} — arriving in ~${note.delayMin} min.`);
      }
    }
  }
  for (const n of notes) {
    conv.lines.push(line(s, 'system', 'System', n));
    s.emit({ kind: 'toast', text: n, tone: n.startsWith('✅') ? 'good' : 'info' });
  }
  s.dirty = true;
  return { ok: true, text: reply.say, data: { contactId, source: reply.source, notes } };
}

// ───────────────────────────── the attending's phone line ─────────────────────────────

/**
 * The attending on the phone after an escalation by phone (server/sim/escalation.ts): the same
 * character as in person (her staff persona and attending brief), with the escalation in her [Situation].
 */
async function attendingCall(s: GameSession, text: string): Promise<ActionResult> {
  const esc = lineEscalation(s);
  const st = esc && s.staff.get(esc.attendingId);
  if (!esc || !st) return { ok: false, message: `The attending's line opens when you escalate a patient by phone: {"type":"escalate","patientId":"…","mode":"call"}.` };
  const key = `phone:${ATTENDING_LINE}`;
  const prev = s.conversations.get(key);
  if (!prev?.lines.length || prev.lines[prev.lines.length - 1].text === 'Call ended.') ringLine(s, esc);
  const conv = s.conversations.get(key)!;
  text = text.trim().slice(0, 1500);
  if (!text || text === '__dial__') {
    s.dirty = true;
    return { ok: true, text: esc.opener };
  }
  const brief = s.presentPatients().map((p) => `- ${p.c.patient.lastName} (${p.bedLabel}): ${p.c.truth.diagnosis.label}. Key pitfalls: ${p.c.teaching.slice(0, 2).join(' ')}`).join('\n') || '- (no patients yet)';
  let spec = cachedSpec(s, key, () => staffSpec(`${s.id}:${key}`, st.def, s.scenario, brief));
  if (!spec.system.includes(brief)) {
    specCache.get(s)!.delete(key);
    spec = cachedSpec(s, key, () => staffSpec(`${s.id}:${key}:${s.presentPatients().length}`, st.def, s.scenario, brief));
  }
  const situation = staffSituation(s, st.def.id).replace(/\]$/, ' You are on the PHONE with the resident: you cannot see or examine the patient yourself.]');
  conv.lines.push(line(s, 'player', 'You', text));
  conv.typing = true;
  s.dirty = true;
  const reply = await s.reply(spec, conv, situation, text, { firstTurn: false, beds: bedsCtx(s), defaultBed: s.patients.get(esc.pid)?.bed });
  if (reply.notice) s.emit({ kind: 'toast', text: reply.notice, tone: 'warn' });
  conv.typing = false;
  const spoken = line(s, 'npc', conv.title, reply.say, reply.emotion);
  conv.lines.push(spoken);
  s.emit({ kind: 'speech', lineId: spoken.id, contactId: ATTENDING_LINE, name: spoken.name, text: spoken.text });
  s.dirty = true;
  return { ok: true, text: reply.say, data: { contactId: ATTENDING_LINE, source: reply.source, notes: [] } };
}

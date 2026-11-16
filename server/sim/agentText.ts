/**
 * Text renderings of the player's view for AI agents (HTTP/MCP). Content parity
 * with the 3D client + AgentChart: same information, no hidden truth.
 */
import { ANALYTES, EXAM_MANEUVERS, ORDERS } from '../../shared/catalog';
import { dischargeStatus, DISPO_LABELS, lengthOfStay, type EhrSection } from '../../shared/types';
import { formatLabValue, formatVitalsLine, labUnit, refRangeText } from '../../shared/units';
import { LAYOUTS, roomById } from '../../shared/layout';
import { POCUS_WINDOWS, pocusManeuver } from '../../shared/pocus';
import { ATTENDING_LINE, escalationText } from './escalation';
import { M, type GameSession, type PatientState } from './session';
import { boardRow, contactsFor } from './views';

function hm(s: GameSession, t: number): string {
  if (t < -24 * 3600) return `${Math.round(-t / 86400)} days ago`;
  return s.clock(t);
}

export function boardText(s: GameSession): string {
  const rows = [...s.patients.values()].filter((p) => p.arrived).map((p) => boardRow(s, p));
  if (!rows.length) return 'Tracking board: no patients yet.';
  const lines = rows
    .sort((a, b) => a.esi - b.esi || a.arrivedAt - b.arrivedAt)
    .map((r) => {
      const los = Math.round(lengthOfStay(r, s.t) / M);
      const flags = [r.newResults ? `${r.newResults} new result(s)` : '', r.pendingLabs ? `${r.pendingLabs} lab(s) pending` : '', r.pendingImaging ? `${r.pendingImaging} imaging pending` : '', r.critical ? 'CRITICAL PAGE' : '', r.dispo ? `dispo: ${r.dispo}` : '', ...r.alerts].filter(Boolean);
      return `- [${r.bedLabel}] ${r.name}, ${r.age}${r.sex} — "${r.chiefComplaint}" — ESI ${r.esi} — LOS ${los} min — ${r.discharge ? dischargeStatus(r.discharge) : r.flowStatus}${r.nurse ? ` — RN ${r.nurse}` : ''} (patientId: ${r.id})${flags.length ? `\n    ${flags.join(' · ')}` : ''}`;
    });
  return `Tracking board (${rows.length} patients):\n${lines.join('\n')}`;
}

export function observationText(s: GameSession, recentLines = 6): string {
  const units = s.settings.units;
  const out: string[] = [];
  out.push(`TIME ${s.clock()} (${Math.round(s.t / M)} of ${s.scenario.durationMin} min) — map "${s.scenario.title}" — you are in: ${roomById(s.layout, s.playerLocation)?.label ?? s.playerLocation} (${s.playerLocation})${s.ended ? ' — SHIFT ENDED' : ''}`);
  out.push(boardText(s));
  // who is here
  const here: string[] = [];
  for (const p of s.patients.values()) {
    if (!p.arrived || p.departed) continue;
    if (p.location === s.playerLocation && p.discharge?.phase !== 'leaving') here.push(`patient ${p.c.patient.firstName} ${p.c.patient.lastName} (npcId: pt_${p.id})`);
    if (p.c.family && p.family?.status === 'present' && p.bed === s.playerLocation) here.push(`${p.c.family.relation} ${p.c.family.name} (npcId: ${p.c.family.npcId})`);
    if (p.c.family && p.family?.status === 'out' && s.playerLocation === 'waiting') here.push(`${p.c.family.relation} ${p.c.family.name} (npcId: ${p.c.family.npcId})`);
  }
  for (const st of s.staff.values()) {
    if (!st.def.talkable || st.location !== s.playerLocation) continue;
    if (s.dischargePatient(st)?.discharge?.phase === 'leaving') continue;
    here.push(`${st.def.title} ${st.def.name} (npcId: ${st.def.id})${st.activity ? ` — ${st.activity}` : ''}`);
  }
  out.push(`People here: ${here.length ? here.join('; ') : 'nobody you can talk to'}.`);
  // belongings/documents at this bedside (inspect them: brown-bag med review, letters…)
  const items = s.items().filter(({ p }) => p.bed === s.playerLocation);
  if (items.length) out.push(`Belongings you can inspect here: ${items.map(({ p, item }) => `${item.label} ${p.given.has(item.id) ? 'with the patient, in bed' : `on the ${item.where}`}${p.inspected.has(item.id) ? ' (inspected)' : ''} (itemId: ${item.id})`).join('; ')}.`);
  const staffElsewhere = [...s.staff.values()].filter((st) => st.def.talkable && st.location !== s.playerLocation).map((st) => `${st.def.name} @ ${st.location}${st.activity ? ` (${st.activity})` : ''}`);
  out.push(`Staff elsewhere: ${staffElsewhere.join('; ')}.`);
  // the attending on her way / at a bedside / on the phone after an escalation
  const esc = escalationText(s);
  if (esc) out.push(esc);
  // monitors visible from here
  for (const p of s.presentPatients()) {
    if (p.onMonitor && p.location === s.playerLocation) {
      const v = s.measureVitals(p, false);
      out.push(`Bedside monitor (${p.bedLabel}): ${formatVitalsLine(v, units)}`);
    }
  }
  const unread = s.pages.filter((p) => !p.read).slice(-8);
  if (unread.length) out.push(`Unread pages:\n${unread.map((p) => `- [${hm(s, p.t)}] ${p.from}: ${p.text} (pageId: ${p.id})`).join('\n')}`);
  const recent = [...s.conversations.values()].flatMap((c) => c.lines.slice(-recentLines).map((l) => ({ c, l }))).sort((a, b) => a.l.t - b.l.t).slice(-recentLines);
  if (recent.length) out.push(`Recent conversation:\n${recent.map(({ c, l }) => `- [${c.title}] ${l.name}: ${l.text}`).join('\n')}`);
  return out.join('\n\n');
}

function labsText(s: GameSession, p: PatientState, query?: string): string {
  const units = s.settings.units;
  const q = query?.toLowerCase().trim();
  const labs = p.labs.filter((l) => !q || l.analyte.includes(q) || ANALYTES[l.analyte]?.name.toLowerCase().includes(q) || ANALYTES[l.analyte]?.short.toLowerCase().includes(q));
  if (!labs.length) return q ? `No results matching "${query}".` : 'No lab results yet.';
  const by = new Map<string, typeof labs>();
  for (const l of labs) by.set(l.analyte, [...(by.get(l.analyte) ?? []), l]);
  const lines: string[] = [];
  for (const [an, rs] of by) {
    const a = ANALYTES[an];
    const series = rs
      .sort((x, y) => x.collectedAt - y.collectedAt)
      .map((r) => `${formatLabValue(an, r.value, units)}${r.flag ? ` ${r.flag}` : ''} @${hm(s, r.collectedAt)}${r.historical ? ' (historical)' : ''}`)
      .join(' → ');
    lines.push(`${a?.section ?? ''} | ${a?.name ?? an} (${an}) [${labUnit(an, units)}; ref ${refRangeText(an, p.c.patient.sex, units)}]: ${series}`);
  }
  const pending = p.orders.filter((o) => o.category === 'lab' && !['Resulted', 'Canceled'].includes(o.status));
  if (pending.length) lines.push(`Pending: ${pending.map((o) => `${o.name} (${o.status}${o.statusText ? ` — ${o.statusText}` : ''})`).join('; ')}`);
  return lines.join('\n');
}

export function ehrText(s: GameSession, pid: string, section: EhrSection, query?: string): string {
  if (section === 'board') return boardText(s);
  const p = s.patients.get(pid);
  if (!p) return 'Unknown patient.';
  const c = p.c;
  const units = s.settings.units;
  const head = `${c.patient.lastName}, ${c.patient.firstName} · ${c.patient.age}${c.patient.sex} · DOB ${c.patient.dob} · MRN ${c.patient.mrn} · ${p.bedLabel} · ESI ${c.presentation.esi} · ${p.discharge ? dischargeStatus(p.discharge) : p.flow}\nAllergies: ${c.presentation.documentedAllergies === 'NKDA' ? 'NKDA' : c.presentation.documentedAllergies.map((a) => `${a.substance} (${a.reaction})`).join(', ')} · Weight ${c.patient.weightKg} kg · Code: ${c.patient.codeStatus}${p.alerts.length ? `\n⚠ ${p.alerts.join(' | ')}` : ''}`;
  switch (section) {
    case 'summary': {
      const lastV = p.vitals[p.vitals.length - 1];
      const notes = p.notes.slice(-4).map((n) => `- [${hm(s, n.t)}] ${n.type}: ${n.title}`).join('\n');
      const active = p.orders.filter((o) => !['Canceled'].includes(o.status)).map((o) => `- ${o.name}${o.params?.dose ? ` ${o.params.dose}` : ''}: ${o.status}${o.statusText ? ` (${o.statusText})` : ''}`).join('\n');
      return `${head}\nCC: ${c.presentation.chiefComplaint} · arrived ${hm(s, p.arrivalT)} by ${c.presentation.arrivalMode}\nLatest vitals (${lastV ? hm(s, lastV.t) + ', ' + lastV.source : 'none'}): ${lastV ? formatVitalsLine(lastV, units) : '—'}${lastV?.comment ? ` [${lastV.comment}]` : ''}\nOn monitor: ${p.onMonitor ? 'yes' : 'no'} · IV: ${p.ivAccess ? 'yes' : 'no'} · NPO: ${p.npo ? 'yes' : 'no'}\nWorking dx: ${p.diagnoses.join('; ') || '—'}${p.dispo ? `\nDisposition: ${DISPO_LABELS[p.dispo.decision]}${p.dispo.service ? ` (${p.dispo.service})` : ''}` : ''}\nOrders:\n${active || '- none'}\nRecent notes:\n${notes || '- none'}\nECGs: ${p.ecgs.map((e) => `${e.id} (${hm(s, e.acquiredAt)}${e.signedAt !== undefined ? ', signed' : ', UNSIGNED'})`).join(', ') || 'none'}`;
    }
    case 'vitals':
      return `${head}\nVitals flowsheet:\n${p.vitals.map((v) => `- ${hm(s, v.t)} [${v.source}${v.by ? ' ' + v.by : ''}] ${formatVitalsLine(v, units)}${v.comment ? ` (${v.comment})` : ''}`).join('\n') || 'none'}`;
    case 'labs':
      return `${head}\nResults${query ? ` matching "${query}"` : ''}:\n${labsText(s, p, query)}`;
    case 'imaging':
      return `${head}\nImaging:\n${p.imaging.map((i) => `- ${i.name}: ${i.status}${i.impression ? `\n  FINDINGS: ${i.findings}\n  IMPRESSION: ${i.impression} (${i.radiologist}, ${hm(s, i.reportedAt!)})` : ''}`).join('\n') || 'none ordered'}`;
    case 'ecg':
      return `${head}\nECGs:\n${p.ecgs.map((e) => `- ${e.id} ${e.label} acquired ${hm(s, e.acquiredAt)} — rate ${e.params.rate}, rhythm ${e.params.rhythm}${e.params.pr ? `, PR ${e.params.pr} ms` : ''}${e.params.qrs ? `, QRS ${e.params.qrs} ms` : ''}${e.params.qt ? `, QT ${e.params.qt} ms` : ''}\n  Machine read: ${e.machineRead}\n  ${e.signedAt !== undefined ? `Signed ${hm(s, e.signedAt)}: ${e.physicianRead}` : 'UNSIGNED — use sign_ecg with your interpretation'}`).join('\n') || 'none'}`;
    case 'orders':
      return `${head}\nOrders:\n${p.orders.map((o) => `- ${o.id} ${o.name}${o.params?.dose ? ` ${o.params.dose} ${o.params.route ?? ''} ${o.params.frequency ?? ''}` : ''} [${o.priority}] — ${o.status}${o.statusText ? ` (${o.statusText})` : ''} — placed ${hm(s, o.placedAt)} by ${o.placedBy}`).join('\n') || 'none'}`;
    case 'mar':
      return `${head}\nMedication administration record:\n${p.mar.map((m) => `- ${hm(s, m.t)} ${m.med} ${m.dose} ${m.route} — ${m.status} by ${m.by}${m.comment ? ` (${m.comment})` : ''}`).join('\n') || 'nothing given'}`;
    case 'notes': {
      const q = query?.toLowerCase();
      const notes = p.notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.type.toLowerCase().includes(q));
      for (const n of notes) n.unread = false;
      return `${head}\nNotes:\n${notes.map((n) => `--- [${hm(s, n.t)}] ${n.type} — ${n.title} (${n.author})\n${n.text}`).join('\n') || 'none'}`;
    }
    case 'history':
      return `${head}\nProblem list: ${c.presentation.problemList.join('; ') || 'none documented'}\nHome medications (documented): ${c.presentation.documentedHomeMeds.map((m) => `${m.name} ${m.dose} ${m.sig}`).join('; ') || 'none documented'}\nPCP: ${c.patient.pcp ? `${c.patient.pcp.name}, ${c.patient.pcp.practice} (${c.patient.pcp.phone}, contactId ${c.patient.pcp.contactId})` : 'none'}\nInsurance: ${c.patient.insurance.payer} ${c.patient.insurance.memberId}\nEmergency contact: ${c.patient.emergencyContact ? `${c.patient.emergencyContact.name} (${c.patient.emergencyContact.relation}) ${c.patient.emergencyContact.phone}` : 'none'}\nPrior encounters:\n${c.presentation.encounters.map((e) => `- ${e.date} ${e.type} (${e.department}): ${e.reason} — ${e.summary}`).join('\n') || '- none'}\nHistorical labs: ${p.labs.filter((l) => l.historical).map((l) => `${ANALYTES[l.analyte]?.short ?? l.analyte} ${formatLabValue(l.analyte, l.value, units)} (${hm(s, l.collectedAt)})`).join(', ') || 'none'}`;
  }
  return head;
}

/** the escalate action, for agents (catalog): what each mode does and how to follow up */
const ESCALATE_DOC = `## escalate to the attending (any time, from anywhere; 0.5 min)
{"type":"escalate","patientId":"p_…","mode":"bedside","reason":"SBP 84 after 2 L"} = she drops what she is doing and walks to the patient (about 1–2 min: "wait" if needed); talk to her there (npcId att_shaw) once she arrives. She stays while the patient is unstable, otherwise goes back after about 10 min.
{"type":"escalate","patientId":"p_…","mode":"call","reason":"…"} = her phone line opens and she picks up: talk with {"type":"call","contactId":"${ATTENDING_LINE}","text":"…"} (works from anywhere).
For an unstable patient (SBP < 90 or MAP < 65, SpO₂ < 90 %, falling GCS, a critical page) she gives direct stabilization steps first and teaches afterwards. The debrief lists every escalation; it does not cost points.`;

/** bedside ultrasound, for agents (catalog): the views are exam maneuvers */
const POCUS_DOC = `## bedside ultrasound (exam maneuvers pocus_<window>; at the bedside, the patient in their bed)
{"type":"examine","patientId":"p_…","maneuver":"pocus_rlq"} = you scan one view and get the read as text. Views: ${POCUS_WINDOWS.map((w) => `${pocusManeuver(w.id)} = ${w.label} (${w.minutes} min)`).join('; ')}. FAST = pocus_ruq + pocus_luq + pocus_pelvic + pocus_cardiac. Not scored; it is in your record like any exam.`;

export function catalogText(): string {
  const cats = new Map<string, string[]>();
  for (const o of Object.values(ORDERS)) cats.set(o.category, [...(cats.get(o.category) ?? []), `${o.code} = ${o.name}${o.med ? ` [doses: ${o.med.doses.join(' | ')}]` : ''}`]);
  const exam = EXAM_MANEUVERS.map((m) => `${m.id} = ${m.system}: ${m.label}`).join('\n');
  const rooms = [...LAYOUTS.ed.rooms, ...(LAYOUTS.ed_surge.treatmentSpaces ?? [])].map((r) => `${r.id} = ${r.label}${r.id.startsWith('hall_') ? ' (Full Roster)' : ''}${r.hours ? ` (open ${String(r.hours[0]).padStart(2, '0')}:00–${r.hours[1]}:00)` : ''}`).join('\n');
  return `${[...cats.entries()].map(([k, v]) => `## ${k}\n${v.join('\n')}`).join('\n\n')}\n\n## exam maneuvers\n${exam}\n\n## locations (move to: room id)\n${rooms}\n\n${ESCALATE_DOC}\n\n${POCUS_DOC}`;
}

export function contactsText(s: GameSession): string {
  return contactsFor(s)
    .map((c) => `- ${c.id}: ${c.name} — ${c.role} (${c.phone})${c.patientId ? ` [re: ${c.patientId}]` : ''}`)
    .join('\n');
}

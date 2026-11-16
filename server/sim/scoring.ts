/**
 * Deterministic scoring from the event log. Same rules for humans and AI agents;
 * no LLM judging here, so results are reproducible and comparable across players.
 */
import type { Rule } from '../../content/types';
import { authorLabel, reviewLabel } from '../../content/cases/provenance';
import { ORDERS } from '../../shared/catalog';
import { dischargeStatus, type CaseDebrief, type Debrief, type Dispo, type ScoreItem } from '../../shared/types';
import { escalationRecords } from './escalation';
import { infectionControl } from './hygiene';
import { M, type GameSession, type LogEntry, type PatientState } from './session';

type Verdict = { ok: boolean; na?: boolean; detail?: string };

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `;
}

function relMin(p: PatientState, t: number): number {
  return (t - p.arrivalT) / M;
}

export function evalRule(s: GameSession, p: PatientState, rule: Rule, log: LogEntry[]): Verdict {
  const mine = log.filter((e) => e.pid === p.id);
  const within = (e: LogEntry, w?: number) => w === undefined || relMin(p, e.t) <= w;
  switch (rule.type) {
    case 'order': {
      const hits = mine.filter((e) => e.kind === 'order' && rule.codes.includes(e.code!) && within(e, rule.withinMin));
      const canceled = new Set(mine.filter((e) => e.kind === 'cancel').map((e) => e.orderId));
      const hit = hits.find((h) => !canceled.has(h.orderId));
      return { ok: !!hit, detail: hit ? `ordered at +${Math.round(relMin(p, hit.t))} min` : undefined };
    }
    case 'given': {
      const hits = mine.filter((e) => e.kind === 'given' && !e.byError && ((rule.tags && e.tags?.some((t) => rule.tags!.includes(t))) || (rule.codes && rule.codes.includes(e.code!))) && within(e, rule.withinMin));
      if (rule.minTotalMl !== undefined) {
        const total = hits.reduce((a, e) => a + (e.volumeMl ?? 0), 0);
        return { ok: total >= rule.minTotalMl, detail: `${total} mL given` };
      }
      return { ok: hits.length > 0, detail: hits[0] ? `given at +${Math.round(relMin(p, hits[0].t))} min` : undefined };
    }
    case 'collected': {
      const hits = mine.filter((e) => e.kind === 'collected' && rule.codes.includes(e.code!) && within(e, rule.withinMin));
      return { ok: hits.length >= (rule.count ?? 1) };
    }
    case 'before': {
      const first = firstTime(s, p, rule.first, log);
      const then = firstTime(s, p, rule.then, log);
      if (first === undefined || then === undefined) return { ok: false, detail: first === undefined ? 'first step never happened' : 'second step never happened' };
      return { ok: first <= then, detail: first <= then ? 'in the right order' : 'wrong order' };
    }
    case 'consult': {
      const hit = mine.find((e) => e.kind === 'consult_accept' && e.contactId === rule.contactId && within(e, rule.withinMin));
      const late = mine.find((e) => e.kind === 'consult_accept' && e.contactId === rule.contactId);
      return { ok: !!hit, detail: hit ? `accepted at +${Math.round(relMin(p, hit.t))} min` : late ? `accepted late (+${Math.round(relMin(p, late.t))} min)` : 'never accepted' };
    }
    case 'called':
      return { ok: log.some((e) => e.kind === 'call' && rule.contactIds.includes(e.contactId!)) };
    case 'fact': {
      const got = rule.factIds.filter((f) => p.revealed.has(f));
      return { ok: rule.all ? got.length === rule.factIds.length : got.length > 0 };
    }
    case 'counseled': {
      const got = rule.ids.filter((f) => p.counseled.has(f));
      return { ok: rule.all ? got.length === rule.ids.length : got.length > 0 };
    }
    case 'exam': {
      const done = new Set(mine.filter((e) => e.kind === 'exam').map((e) => e.maneuver));
      const n = rule.maneuvers.filter((m) => done.has(m)).length;
      return { ok: n >= (rule.min ?? rule.maneuvers.length), detail: `${n}/${rule.maneuvers.length} performed` };
    }
    case 'ecg_signed': {
      const hit = mine.find((e) => e.kind === 'ecg_signed');
      if (!hit) return { ok: false, detail: 'ECG never signed' };
      return { ok: within(hit, rule.withinMin), detail: `signed at +${Math.round(relMin(p, hit.t))} min after arrival` };
    }
    case 'escalated':
      return { ok: mine.some((e) => e.kind === 'escalate') };
    case 'ecg_read':
      return { ok: mine.some((e) => e.kind === 'ecg_signed' && e.correct) };
    case 'vitals': {
      return { ok: mine.some((e) => e.kind === 'vitals' && rule.vars.every((v) => e.vars?.includes(v)) && within(e, rule.withinMin)) };
    }
    case 'dispo':
      return { ok: !!p.dispo && rule.decisions.includes(p.dispo.decision) };
    case 'dx': {
      const all = norm([...p.diagnoses, ...(p.dispo?.diagnoses ?? [])].join(' | '));
      return { ok: rule.keywords.some((k) => all.includes(k.toLowerCase())) };
    }
    case 'flag':
      return { ok: s.flags.has(`${p.id}:${rule.flag}`) || s.flags.has(rule.flag) };
    case 'not': {
      const v = evalRule(s, p, rule.rule, log);
      return { ok: !v.ok };
    }
    case 'any': {
      const vs = rule.rules.map((r) => evalRule(s, p, r, log));
      return { ok: vs.some((v) => v.ok), detail: vs.find((v) => v.ok)?.detail };
    }
    case 'all': {
      const vs = rule.rules.map((r) => evalRule(s, p, r, log));
      return { ok: vs.every((v) => v.ok) };
    }
    case 'if': {
      const c = evalRule(s, p, rule.cond, log);
      if (!c.ok) return { ok: true, na: true, detail: 'not applicable' };
      return evalRule(s, p, rule.then, log);
    }
  }
}

function firstTime(s: GameSession, p: PatientState, rule: Rule, log: LogEntry[]): number | undefined {
  const mine = log.filter((e) => e.pid === p.id);
  if (rule.type === 'collected') return mine.find((e) => e.kind === 'collected' && rule.codes.includes(e.code!))?.t;
  if (rule.type === 'given') return mine.find((e) => e.kind === 'given' && !e.byError && ((rule.tags && e.tags?.some((t) => rule.tags!.includes(t))) || (rule.codes && rule.codes.includes(e.code!))))?.t;
  if (rule.type === 'order') return mine.find((e) => e.kind === 'order' && rule.codes.includes(e.code!))?.t;
  return evalRule(s, p, rule, log).ok ? 0 : undefined;
}

/**
 * Whole-word/phrase match on normalized text, so short synonyms can't match inside other words
 * ("ami" must not match "family", "aki" not "taking", "uti" not "routine").
 */
export function hasTerm(text: string, term: string): boolean {
  const t = norm(term).trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  // allow simple inflections (sprain → sprained, infection → infections)
  return new RegExp(`(^|[^a-z0-9])${esc}(?:s|es|ed|d|ing)?($|[^a-z0-9])`).test(text);
}

/** the diagnosis verdict of the debrief */
export function dxVerdict(p: PatientState): { verdict: CaseDebrief['dxVerdict']; your: string[] } {
  const your = [...new Set([...p.diagnoses, ...(p.dispo?.diagnoses ?? [])])];
  if (!your.length) return { verdict: 'none', your };
  const text = norm(your.join(' | '));
  const d = p.c.truth.diagnosis;
  if (d.accept.some((a) => hasTerm(text, a))) return { verdict: 'correct', your };
  if (d.partial.some((a) => hasTerm(text, a))) return { verdict: 'partial', your };
  return { verdict: 'incorrect', your };
}

export function caseDebrief(s: GameSession, p: PatientState): CaseDebrief {
  const c = p.c;
  const sc = c.scoring;
  const items: ScoreItem[] = [];
  const log = s.log;

  // diagnosis
  const dx = dxVerdict(p);
  const dxPts = dx.verdict === 'correct' ? sc.dxPoints : dx.verdict === 'partial' ? Math.round(sc.dxPoints / 2) : 0;
  items.push({ kind: 'dx', id: 'diagnosis', label: `Diagnosis: ${c.truth.diagnosis.label}`, points: dxPts, max: sc.dxPoints, ok: dx.verdict === 'correct', detail: dx.your.length ? `You wrote: ${dx.your.join('; ')}` : 'No diagnosis recorded' });
  for (const sd of sc.secondaryDx ?? []) {
    const ok = sd.keywords.some((k) => norm(dx.your.join(' | ')).includes(k.toLowerCase()));
    items.push({ kind: 'dx', label: sd.label, points: ok ? sd.points : 0, max: sd.points, ok });
  }

  // disposition
  const dispo = p.dispo?.decision as Dispo | undefined;
  const best = c.truth.dispositions;
  const okish = c.truth.acceptableDispositions ?? [];
  let dispoPts = 0;
  let dispoCorrect: boolean | null = null;
  if (dispo) {
    if (best.includes(dispo)) {
      dispoPts = sc.dispoPoints;
      dispoCorrect = true;
    } else if (okish.includes(dispo)) {
      dispoPts = Math.round(sc.dispoPoints / 2);
      dispoCorrect = false;
    } else dispoCorrect = false;
  }
  items.push({ kind: 'dispo', id: 'disposition', label: `Disposition (best: ${best.join(' / ')})`, points: dispoPts, max: sc.dispoPoints, ok: dispoCorrect === true, detail: dispo ? `You chose: ${dispo}` : 'No disposition — still in the ED at end of shift' });

  // history (key facts, deduplicated by label across patient/family/phone sources)
  const keyFacts = new Map<string, { elicited: boolean; source: string }>();
  const addFacts = (facts: { id: string; key?: boolean; label?: string }[], source: string) => {
    for (const f of facts) {
      if (!f.key) continue;
      const label = (f.label ?? f.id).replace(/^(Collateral|GP|Patient):\s*/i, '');
      const prev = keyFacts.get(label);
      const got = p.revealed.has(f.id);
      if (!prev) keyFacts.set(label, { elicited: got, source: got ? source : '' });
      else if (got && !prev.elicited) keyFacts.set(label, { elicited: true, source });
    }
  };
  addFacts(c.persona.facts, 'patient');
  if (c.family) addFacts(c.family.persona.facts, c.family.relation.toLowerCase());
  for (const pc of c.phoneContacts ?? []) addFacts(pc.persona.facts, pc.contact.name);
  const kfList = [...keyFacts.entries()].map(([label, v]) => ({ label, elicited: v.elicited, source: v.source }));
  const frac = kfList.length ? kfList.filter((k) => k.elicited).length / kfList.length : 0;
  items.push({ kind: 'history', id: 'key-history', label: `History: key facts elicited (${kfList.filter((k) => k.elicited).length}/${kfList.length})`, points: Math.round(sc.historyPoints * frac), max: sc.historyPoints, ok: frac >= 0.7 });

  // critical actions
  for (const ca of sc.critical) {
    const v = evalRule(s, p, ca.rule, log);
    if (v.na) {
      items.push({ kind: 'critical', id: ca.id, label: ca.label, points: 0, max: 0, ok: true, detail: 'Not applicable this time' });
      continue;
    }
    items.push({ kind: 'critical', id: ca.id, label: ca.label, points: v.ok ? ca.points : 0, max: ca.points, ok: v.ok, detail: v.detail ?? ca.teaching });
  }
  // harms
  for (const h of sc.harms) {
    const v = evalRule(s, p, h.rule, log);
    if (v.ok) items.push({ kind: 'harm', label: h.label, points: -h.penalty, max: 0, ok: false, detail: h.teaching });
  }
  // stewardship
  const canceledQuick = new Set(p.orders.filter((o) => o.canceledAt !== undefined && o.canceledAt - o.placedAt < 5 * M && o.collectedAt === undefined).map((o) => o.id));
  const orderedCodes = new Set(p.orders.filter((o) => !canceledQuick.has(o.id) && o.placedBy !== 'Protocol (triage)' && !o.placedBy.startsWith('Dr. Shaw')).map((o) => o.code));
  for (const lv of sc.lowValue) {
    const hit = lv.codes.filter((cde) => orderedCodes.has(cde));
    if (hit.length) items.push({ kind: 'stewardship', label: `Low-value: ${hit.map((h) => ORDERS[h]?.name ?? h).join(', ')}`, points: -lv.penalty, max: 0, ok: false, detail: lv.why });
  }
  const cost = p.orders.filter((o) => !canceledQuick.has(o.id)).reduce((a, o) => a + o.costUSD, 0);

  const score = items.reduce((a, i) => a + i.points, 0);
  const maxScore = items.reduce((a, i) => a + i.max, 0);
  const majorHarm = items.some((i) => i.kind === 'harm' && i.points <= -15);
  const good = !majorHarm && dx.verdict === 'correct' && dispoCorrect !== false && score >= maxScore * 0.6;
  let outcome = good ? c.truth.outcomeGood : c.truth.outcomeBad;
  if (p.discharge && !p.departed) {
    outcome = `Discharge home was signed. At the end of play, ${c.patient.firstName} was still in the ED (${dischargeStatus(p.discharge).toLowerCase()}).`;
  } else if (!dispo && dx.verdict === 'none') {
    outcome = `${c.patient.firstName} was still in the ED without a diagnosis or disposition when your shift ended — the next resident inherits the case.`;
  }

  const timeline = log
    .filter((e) => e.pid === p.id && ['order', 'given', 'consult_accept', 'dispo', 'ecg_signed', 'safety', 'flag', 'escalate'].includes(e.kind))
    .slice(0, 40)
    .map((e) => ({ t: e.t, text: describe(e) }));

  const origin = c.provenance;
  return {
    caseId: c.id,
    origin: { kind: origin.kind, author: authorLabel(origin), review: reviewLabel(origin),
      ...(origin.kind === 'adapted' ? { source: { recordId: origin.recordId, url: origin.source.url, license: origin.source.license } } : {}) },
    patientId: p.id,
    name: `${c.patient.firstName} ${c.patient.lastName}`,
    bedLabel: p.bedLabel,
    caseTitle: c.title,
    trueDiagnosis: `${c.truth.diagnosis.label} (${c.truth.diagnosis.icd10})`,
    yourDiagnoses: dx.your,
    dxVerdict: dx.verdict,
    disposition: dispo,
    expectedDispositions: best,
    dispoCorrect,
    score: Math.max(-maxScore, score),
    maxScore,
    items,
    keyFacts: kfList,
    teaching: c.teaching,
    references: c.references,
    outcome,
    costUSD: cost,
    timeline,
  };
}

function describe(e: LogEntry): string {
  switch (e.kind) {
    case 'order':
      return `Ordered ${ORDERS[e.code!]?.name ?? e.code}${e.text && e.text !== 'You' ? ` (${e.text})` : ''}`;
    case 'given':
      return `${e.byError ? '⚠ ' : ''}Given: ${ORDERS[e.code!]?.name ?? e.code}${e.volumeMl ? ` ${e.volumeMl} mL` : ''}${e.byError ? ' (staff error)' : ''}`;
    case 'consult_accept':
      return `Consult accepted (${e.contactId})`;
    case 'dispo':
      return `Disposition: ${e.decision}`;
    case 'ecg_signed':
      return `ECG signed${e.correct ? ' — correct read' : ''}`;
    case 'safety':
      return e.caught ? 'Safety catch ✓' : 'Safety event reached patient ✗';
    case 'flag':
      return `Event: ${e.flag}`;
    case 'escalate':
      return `Escalated to the attending (${e.decision === 'call' ? 'phone' : 'bedside'})${e.text ? `: ${e.text}` : ''}`;
    default:
      return e.kind;
  }
}

export function debrief(s: GameSession): Debrief {
  const cases = [...s.patients.values()].filter((p) => p.arrived).map((p) => caseDebrief(s, p));
  const safetyEvents = s.safety
    .filter((x) => x.status !== 'na' && x.status !== 'pending')
    .map((x) => ({ label: x.def.label, caught: x.status === 'caught', points: x.status === 'caught' ? x.def.points : 0, detail: `${x.detail ?? ''} ${x.def.teaching}`.trim() }));
  const safetyMax = s.safety.filter((x) => x.status !== 'na' && x.status !== 'pending').reduce((a, x) => a + x.def.points, 0);
  const score = cases.reduce((a, c) => a + c.score, 0) + safetyEvents.reduce((a, e) => a + e.points, 0);
  const maxScore = cases.reduce((a, c) => a + c.maxScore, 0) + safetyMax;
  const percent = maxScore > 0 ? Math.max(0, Math.round((100 * score) / maxScore)) : 0;
  const grade: Debrief['grade'] = percent >= 85 ? 'A' : percent >= 70 ? 'B' : percent >= 55 ? 'C' : percent >= 40 ? 'D' : 'F';
  return {
    mapId: s.scenario.id,
    mapTitle: s.scenario.title,
    playerName: s.playerName,
    seed: s.seed,
    score,
    maxScore,
    percent,
    grade,
    endedAt: s.endedAt ?? s.t,
    costUSD: cases.reduce((a, c) => a + c.costUSD, 0),
    cases,
    safetyEvents,
    // listed for reflection, not scored
    escalations: escalationRecords(s),
    // hand hygiene (WHO moments 1 and 4) and masks: listed for reflection, not scored (hygiene.ts)
    infectionControl: infectionControl(s),
  };
}

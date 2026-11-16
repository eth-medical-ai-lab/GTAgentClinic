/**
 * The patient's bed position (shared/types.ts BedPosition): the head of the bed, and how they lie or
 * sit on it, as the nurse sets it. View only (views.ts): a pure function of what the player can
 * observe (the case's default, the vitals as charted or on the monitor, the exams and procedures under
 * way). It reads the session and changes nothing: never logged, never scored, never in the agents'
 * observation text, so an AI doctor's run and debrief are the same with or without it.
 *
 * First rule that applies:
 *  - away from the bed (imaging): on the table, flat
 *  - CPR (a trigger flagged as an arrest, its first 3 game minutes): flat
 *  - an abdominal or genital exam in the last 2 game minutes: flat (knees bent for the abdomen,
 *    to relax its wall), then back up
 *  - a urinary catheter going in (the nurse at the bedside with it): flat
 *  - hypotension (observed systolic < 90): flat. Raising the legs (the passive leg raise) is the usual
 *    teaching, but the physiology has no effect for it, so it is not shown; Trendelenburg is not
 *    recommended. Short of breath as well: kept at 30° instead.
 *  - short of breath (observed RR ≥ 26/min or SpO2 < 92 %): sat up, 70°
 *  - the case's own (content/types.ts CaseBedDef): its position once an order is carried out, its
 *    symptomatic angle, its default; without one, 30° lying (the ED's semi-Fowler) or on the edge
 */
import type { CaseBedDef } from '../../content/types';
import type { BedPosition } from '../../shared/types';
import type { GameSession, PatientState } from './session';

/** game seconds per minute */
const M = 60;
/** how long the bed stays flat after an abdominal exam, and for CPR (game minutes) */
const EXAM_FLAT_MIN = 2;
const CPR_FLAT_MIN = 3;
/** orders whose bedside part is done with the patient flat */
const FLAT_FOR: Record<string, string> = { foley: 'urinary catheter' };

type Observed = { hr?: number; sbp?: number; rr?: number; spo2?: number };

/**
 * The vitals the player could see now: the monitor's numbers when the patient is on it, else the
 * latest charted value of each (triage, the nurse's sets).
 */
function observed(s: GameSession, p: PatientState): Observed {
  if (p.onMonitor) {
    const m = s.minutesSinceArrival(p);
    const ph = p.physio;
    return { hr: Math.round(ph.measured('hr', m)), sbp: Math.round(ph.measured('sbp', m)), rr: Math.round(ph.measured('rr', m)), spo2: Math.min(100, Math.round(ph.measured('spo2', m))) };
  }
  const out: Observed = {};
  for (const k of ['hr', 'sbp', 'rr', 'spo2'] as const)
    for (let i = p.vitals.length - 1; i >= 0; i--) {
      const v = p.vitals[i];
      if (v.t > s.t || v[k] === undefined) continue;
      out[k] = v[k];
      break;
    }
  return out;
}

const pass = (v: number | undefined, op: '<' | '>', x: number) => v !== undefined && (op === '<' ? v < x : v > x);

/** the case's bed with its order-dependent and symptomatic variants applied */
function caseBed(s: GameSession, p: PatientState, obs: Observed): BedPosition {
  const pr = p.c.presentation;
  const def: CaseBedDef = pr.bed ?? (pr.posture === 'sit' ? { headDeg: 30, sitting: 'edge' } : { headDeg: 30 });
  const after = def.afterOrders;
  if (after && p.orders.some((o) => after.codes.includes(o.code) && (o.status === 'Active' || o.status === 'Completed'))) return { ...after.bed, reason: `after ${after.codes.join('/')}` };
  const sy = def.symptomatic;
  const base: BedPosition = { headDeg: def.headDeg, ...(def.sitting ? { sitting: def.sitting } : {}), ...(def.knees ? { knees: true } : {}), ...(def.legUp ? { legUp: def.legUp } : {}) };
  if (sy && pass(obs[sy.var], sy.op, sy.value)) return { ...base, headDeg: Math.max(base.headDeg, sy.headDeg), ...(sy.sitting ? { sitting: sy.sitting } : {}), reason: `symptomatic (${sy.var} ${sy.op} ${sy.value})` };
  return { ...base, reason: pr.bed ? 'case default' : 'ED default' };
}

/** the bedside part of a flat-lying procedure under way: its name, or null */
function flatProcedure(s: GameSession, p: PatientState): string | null {
  for (const st of s.staff.values()) {
    const tk = st.current;
    if (!tk || tk.pid !== p.id || tk.endT === undefined || s.t < tk.endT - tk.durationMin * M) continue;
    for (const id of tk.orderIds) {
      const o = p.orders.find((x) => x.id === id);
      if (o && FLAT_FOR[o.code]) return FLAT_FOR[o.code];
    }
  }
  return null;
}

export function bedPositionFor(s: GameSession, p: PatientState): BedPosition {
  if (p.location !== p.bed) return { headDeg: 0, reason: 'imaging table' };
  const m = s.minutesSinceArrival(p);
  for (const tr of p.physio.def.triggers ?? []) {
    const at = p.physio.fired.get(tr.id);
    if (at !== undefined && tr.flag && /arrest/.test(tr.flag) && m - at >= 0 && m - at < CPR_FLAT_MIN) return { headDeg: 0, reason: 'CPR' };
  }
  for (let i = p.exam.length - 1; i >= 0; i--) {
    const f = p.exam[i];
    if (s.t - f.t > EXAM_FLAT_MIN * M) break;
    if (f.system === 'Abdomen' || f.system === 'GU') return { headDeg: 0, ...(f.system === 'Abdomen' ? { knees: true } : {}), reason: f.system === 'Abdomen' ? 'abdominal exam' : 'genital exam' };
  }
  const proc = flatProcedure(s, p);
  if (proc) return { headDeg: 0, reason: proc };
  const obs = observed(s, p);
  const breathless = pass(obs.rr, '>', 25) || pass(obs.spo2, '<', 92);
  if (pass(obs.sbp, '<', 90)) return breathless ? { headDeg: 30, reason: 'hypotension, short of breath' } : { headDeg: 0, reason: 'hypotension' };
  const own = caseBed(s, p, obs);
  if (breathless && own.sitting !== 'edge') return { headDeg: Math.max(own.headDeg, 70), sitting: 'upright', ...(own.legUp ? { legUp: own.legUp } : {}), reason: 'short of breath' };
  if (p.bed.startsWith('hall_') && own.sitting === 'edge') return { headDeg: 12, reason: 'resting on hallway stretcher' };
  return own;
}

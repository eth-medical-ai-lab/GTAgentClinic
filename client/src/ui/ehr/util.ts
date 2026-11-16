/**
 * Small formatting / clinical helpers shared by AgentChart sections.
 */
import type { GameTime, OrderView, PatientChart, ResultFlag } from '../../../../shared/types';
import { clockAt } from '../../../../shared/types';

export const DAY = 86400;

/** "22:47" for in-encounter times; "730 d ago" for historical results. */
export function fmtTime(clockStart: string, t: GameTime): string {
  if (t <= -DAY) return `${Math.round(-t / DAY)} d ago`;
  return clockAt(clockStart, t);
}

/** Length of stay "h:mm". */
export function fmtLos(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function minutesAgo(now: GameTime, t: GameTime): string {
  const m = Math.max(0, Math.round((now - t) / 60));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function flagClass(flag?: ResultFlag): string {
  if (!flag) return '';
  if (flag === 'HH' || flag === 'LL') return 'ehr-crit';
  if (flag === 'A') return 'ehr-abn-text';
  return 'ehr-abn';
}

export function flagText(flag?: ResultFlag): string {
  if (!flag) return '';
  if (flag === 'HH') return '!!H';
  if (flag === 'LL') return '!!L';
  return flag;
}

const DONE = new Set(['Resulted', 'Final', 'Completed', 'Given', 'Canceled']);

export function isActiveOrder(o: OrderView): boolean {
  return !DONE.has(o.status);
}

export function allergyList(chart: PatientChart): string[] {
  if (!Array.isArray(chart.allergies)) return [];
  return chart.allergies.map((a) => `${a.substance} ${a.reaction}`.toLowerCase());
}

export function hasAllergyTo(chart: PatientChart, words: string[]): boolean {
  const all = allergyList(chart);
  return all.some((a) => words.some((w) => a.includes(w)));
}

export const PENICILLIN_WORDS = ['penicillin', 'amoxicillin', 'ampicillin', 'pcn', 'augmentin', 'piperacillin'];

export function bmi(chart: PatientChart): number | undefined {
  if (!chart.heightCm || !chart.weightKg) return undefined;
  const m = chart.heightCm / 100;
  return chart.weightKg / (m * m);
}

/** Expand weight-based doses like "30 mL/kg" or "1 mg/kg" for display. */
export function weightDoseHint(dose: string | undefined, weightKg: number): string | null {
  if (!dose) return null;
  const m = dose.match(/([\d.]+)\s*(mL|mg|mcg|units)\/kg/i);
  if (!m) return null;
  const amount = parseFloat(m[1]) * weightKg;
  const unit = m[2];
  const rounded = unit.toLowerCase() === 'ml' ? Math.round(amount / 10) * 10 : Math.round(amount * 10) / 10;
  return `= ${rounded} ${unit} for ${weightKg} kg`;
}

export function vitalAbnormal(key: string, v: number | undefined): boolean {
  if (v === undefined || Number.isNaN(v)) return false;
  switch (key) {
    case 'hr':
      return v > 100 || v < 50;
    case 'sbp':
      return v < 90 || v > 180;
    case 'dbp':
      return v < 50 || v > 110;
    case 'map':
      return v < 65;
    case 'rr':
      return v > 22 || v < 10;
    case 'spo2':
      return v < 92;
    case 'temp':
      return v >= 38 || v < 36;
    case 'pain':
      return v >= 7;
    case 'gcs':
      return v < 15;
    case 'glucose':
      return v < 70 || v > 180;
    default:
      return false;
  }
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

/** Stable "nice" axis ticks. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * pow >= raw) ?? 10) * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

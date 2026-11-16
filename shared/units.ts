import { ANALYTES, refRange } from './catalog';
import type { ResultFlag, Sex, UnitSystem, Vitals } from './types';

export const UNAVAILABLE_RESULT = 'Not available';

export function labUnit(code: string, units: UnitSystem): string {
  const a = ANALYTES[code];
  if (!a) return '';
  return units === 'SI' && a.unitSI !== undefined ? a.unitSI : a.unit;
}

export function convertLab(code: string, value: number, units: UnitSystem): number {
  const a = ANALYTES[code];
  if (!a || units === 'US' || a.toSI === undefined) return value;
  return value * a.toSI;
}

export function formatLabValue(code: string, value: number | string, units: UnitSystem): string {
  if (typeof value === 'string') return value;
  const a = ANALYTES[code];
  if (!a) return String(value);
  const v = convertLab(code, value, units);
  const dec = units === 'SI' && a.decimalsSI !== undefined ? a.decimalsSI : a.decimals ?? 1;
  return v.toFixed(dec);
}

export function refRangeText(code: string, sex: Sex, units: UnitSystem): string {
  const a = ANALYTES[code];
  if (!a) return '';
  if (a.text) return a.normalText ?? '';
  const r = refRange(a, sex);
  if (!r) return '';
  const lo = formatLabValue(code, r[0], units);
  const hi = formatLabValue(code, r[1], units);
  if (r[0] === 0) return `< ${hi}`;
  return `${lo} – ${hi}`;
}

/** Flag a result against sex-specific reference/critical ranges (conventional units). */
export function computeFlag(code: string, value: number | string, sex: Sex): ResultFlag | undefined {
  const a = ANALYTES[code];
  if (!a || value === UNAVAILABLE_RESULT) return undefined;
  if (typeof value === 'string') {
    if (!a.text || !a.normalText) return undefined;
    const v = value.toLowerCase();
    const normal = a.normalText.toLowerCase();
    if (v === normal || v.startsWith('pending') || v.startsWith('no growth') || v === 'negative' || v === 'none seen' || v === 'few' || v === 'clear' || v === 'yellow') return undefined;
    return 'A';
  }
  if (a.critLow !== undefined && value < a.critLow) return 'LL';
  if (a.critHigh !== undefined && value > a.critHigh) return 'HH';
  const r = refRange(a, sex);
  if (!r) return undefined;
  if (value < r[0]) return 'L';
  if (value > r[1]) return 'H';
  return undefined;
}

export function formatTemp(c: number | undefined, units: UnitSystem): string {
  if (c === undefined || Number.isNaN(c)) return '—';
  return units === 'US' ? `${(c * 9 / 5 + 32).toFixed(1)} °F` : `${c.toFixed(1)} °C`;
}

export function formatGlucose(mgdl: number | undefined, units: UnitSystem): string {
  if (mgdl === undefined) return '—';
  return units === 'SI' ? `${(mgdl * 0.0555).toFixed(1)} mmol/L` : `${Math.round(mgdl)} mg/dL`;
}

export function formatBP(v: Vitals): string {
  if (v.sbp === undefined || v.dbp === undefined) return '—';
  return `${Math.round(v.sbp)}/${Math.round(v.dbp)}`;
}

export function map(v: Vitals): number | undefined {
  if (v.sbp === undefined || v.dbp === undefined) return undefined;
  return Math.round((v.sbp + 2 * v.dbp) / 3);
}

export function formatVitalsLine(v: Vitals, units: UnitSystem): string {
  const parts: string[] = [];
  if (v.hr !== undefined) parts.push(`HR ${Math.round(v.hr)}`);
  if (v.sbp !== undefined) parts.push(`BP ${formatBP(v)} (MAP ${map(v)})`);
  if (v.rr !== undefined) parts.push(`RR ${Math.round(v.rr)}`);
  if (v.spo2 !== undefined) parts.push(`SpO2 ${Math.round(v.spo2)}%${v.o2 ? ' on ' + v.o2 : ''}`);
  parts.push(`T ${formatTemp(v.temp, units)}`);
  if (v.pain !== undefined) parts.push(`Pain ${Math.round(v.pain)}/10`);
  if (v.gcs !== undefined) parts.push(`GCS ${Math.round(v.gcs)}`);
  if (v.glucose !== undefined) parts.push(`Glu ${formatGlucose(v.glucose, units)}`);
  return parts.join(' · ');
}

/** oxygen delivery read aloud: "RA" → "room air", "2 L NC" → "2 liters nasal cannula" */
function spokenO2(o2: string | undefined): string {
  if (!o2 || /^RA$/i.test(o2)) return 'room air';
  return o2.replace(/\bL\b/, 'liters').replace(/\bNC\b/, 'nasal cannula').replace(/\bNRB\b/, 'non-rebreather').replace(/\bFM\b/, 'face mask');
}

/** a nurse's spoken readback for TTS, e.g. "pressure 96 over 58, heart rate 112, resp rate 22, sats 93 percent on room air, temp 38.6" */
export function spokenVitals(v: Vitals, units: UnitSystem): string {
  const parts: string[] = [];
  if (v.sbp !== undefined && v.dbp !== undefined) parts.push(`pressure ${Math.round(v.sbp)} over ${Math.round(v.dbp)}`);
  if (v.hr !== undefined) parts.push(`heart rate ${Math.round(v.hr)}`);
  if (v.rr !== undefined) parts.push(`resp rate ${Math.round(v.rr)}`);
  if (v.spo2 !== undefined) parts.push(`sats ${Math.round(v.spo2)} percent on ${spokenO2(v.o2)}`);
  if (v.temp !== undefined) parts.push(`temp ${units === 'US' ? (v.temp * 9 / 5 + 32).toFixed(1) : v.temp.toFixed(1)}`);
  return parts.join(', ');
}

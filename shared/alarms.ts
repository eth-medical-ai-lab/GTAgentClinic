/**
 * Bedside-monitor alarm conditions. One table serves the server (the `MonitorView.alarm` text), the
 * 3D monitor (banner colour and flash rate) and the client soundscape (IEC 60601-1-8 alarm tones),
 * so what a monitor shows and what it sounds can never disagree.
 *
 * Medium priority (yellow): the limit alarms monitors in this game have always shown:
 *   SBP < 90 mmHg, HR < 45 or > 140 /min, SpO₂ < 90 %.
 * High priority (red): the life-threatening extremes, like a monitor's "extreme brady / extreme tachy"
 *   and "desat" alarms: HR < 40 or > 160 /min, SpO₂ < 85 %, SBP < 70 mmHg, and the lethal rhythms
 *   (VT, VF, asystole). A high condition keeps its limit label (e.g. SpO₂ 82 % still reads "SpO₂ LOW").
 */

export type AlarmPriority = 'high' | 'medium';

export interface MonitorAlarm {
  label: string;
  priority: AlarmPriority;
}

export interface AlarmInputs {
  hr: number;
  sbp: number;
  spo2: number;
  rhythm?: string;
}

/** The limits, for docs and tests. */
export const ALARM_LIMITS = {
  medium: { sbpBelow: 90, hrBelow: 45, hrAbove: 140, spo2Below: 90 },
  high: { sbpBelow: 70, hrBelow: 40, hrAbove: 160, spo2Below: 85 },
} as const;

const RHYTHM_ALARMS: Record<string, string> = { vt: 'VTACH', vf: 'VFIB/VTACH', asystole: 'ASYSTOLE' };

/** Active alarm conditions, in the order the monitor lists them. */
export function monitorAlarms(v: AlarmInputs): MonitorAlarm[] {
  const out: MonitorAlarm[] = [];
  const M = ALARM_LIMITS.medium;
  const H = ALARM_LIMITS.high;
  const lethal = v.rhythm ? RHYTHM_ALARMS[v.rhythm] : undefined;
  if (lethal) out.push({ label: lethal, priority: 'high' });
  if (v.sbp < M.sbpBelow) out.push({ label: 'SBP LOW', priority: v.sbp < H.sbpBelow ? 'high' : 'medium' });
  // a lethal rhythm supersedes the rate alarms derived from it
  if (!lethal) {
    if (v.hr < M.hrBelow) out.push({ label: 'HR LOW', priority: v.hr < H.hrBelow ? 'high' : 'medium' });
    if (v.hr > M.hrAbove) out.push({ label: 'HR HIGH', priority: v.hr > H.hrAbove ? 'high' : 'medium' });
  }
  if (v.spo2 < M.spo2Below) out.push({ label: 'SpO₂ LOW', priority: v.spo2 < H.spo2Below ? 'high' : 'medium' });
  return out;
}

/** The highest active priority, or null when nothing alarms. */
export function alarmPriority(v: AlarmInputs): AlarmPriority | null {
  let p: AlarmPriority | null = null;
  for (const a of monitorAlarms(v)) {
    if (a.priority === 'high') return 'high';
    p = 'medium';
  }
  return p;
}

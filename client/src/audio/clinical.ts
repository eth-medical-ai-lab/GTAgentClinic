/**
 * Clinical sound rules for the bedside monitors: pure functions, no Web Audio, unit-tested.
 *
 * QRS / pulse tone: one short beep per beat, its pitch modulated by SpO₂ as pulse oximeters do
 *   (the tone drops as saturation falls). Log-linear: 662 Hz at 100 %, one octave lower per 24 %
 *   (the "typical pulse oximeter" logarithmic mapping described in Philips' patent US10687763),
 *   i.e. half a semitone per 1 %, about 19 Hz/% near 100 % (commercial oximeters measure 4–21 Hz
 *   per %). Stepped per whole percent, and clamped at 50 % so the lowest tones stay audible.
 *
 * Alarm signals: IEC 60601-1-8 "general" alarm (all pulses at one pitch).
 *   high priority  = 10 pulses: 3 + 2, pause, 3 + 2; repeats after the interburst interval
 *   medium priority = 3 pulses
 *   The constants below sit inside the standard's ranges (Tables 3 and 4): pulse spacing
 *   (end of one pulse to start of the next) x = 50–125 ms for high, y = 125–250 ms for medium;
 *   3rd→4th and 8th→9th spacing 2x + td; 5th→6th 0.35–1.30 s; effective pulse duration td
 *   75–200 ms (high) / 125–250 ms (medium); rise and fall 10–20 % of td; interburst interval
 *   2.5–15 s (high) / 2.5–30 s (medium); fundamental 150–1000 Hz with at least four harmonics in
 *   300–4000 Hz within ±15 dB of it. High is louder than medium.
 */
import type { AlarmPriority } from '../../../shared/alarms';

// ───────────────────────────── pulse-oximeter tone ─────────────────────────────

export const QRS_TONE = { hzAt100: 662, pctPerOctave: 24, clampPct: 50, durSec: 0.08 } as const;

/** QRS/pulse tone pitch (Hz) for an SpO₂ reading, stepped per whole percent. */
export function qrsToneHz(spo2: number): number {
  const s = Math.max(QRS_TONE.clampPct, Math.min(100, Math.round(Number.isFinite(spo2) ? spo2 : 100)));
  return QRS_TONE.hzAt100 * 2 ** ((s - 100) / QRS_TONE.pctPerOctave);
}

/** Rhythms without a detectable QRS: no beat tone (the monitor alarms instead). */
export function hasQrs(rhythm: string | undefined): boolean {
  return rhythm !== 'vf' && rhythm !== 'asystole';
}

// ───────────────────────────── IEC 60601-1-8 alarm bursts ─────────────────────────────

export interface AlarmPulse {
  /** start of the pulse's effective duration, seconds from the burst start */
  at: number;
  /** effective duration td */
  dur: number;
}

export interface AlarmTone {
  priority: AlarmPriority;
  f0: number;
  /** relative amplitudes of harmonics 1, 2, 3 … (1 = fundamental) */
  harmonics: readonly number[];
  pulses: AlarmPulse[];
  rise: number;
  fall: number;
  /** interburst interval: end of the last pulse to the start of the next burst */
  interburst: number;
  /** level relative to high priority (high is the loudest) */
  gain: number;
}

export const IEC_TIMING = {
  high: { td: 0.125, x: 0.085, pause56: 0.6, tb: 3.5, f0: 659.3, gain: 1 },
  medium: { td: 0.18, y: 0.16, tb: 9, f0: 523.3, gain: 0.6 },
  riseFrac: 0.15,
} as const;

/** 0, −4.4, −6.9, −9.9, −13.2, −17.1 dB: harmonics 2–5 lie within 15 dB of the fundamental */
const HARMONICS = [1, 0.6, 0.45, 0.32, 0.22, 0.14] as const;

function pulsesFrom(td: number, gaps: number[]): AlarmPulse[] {
  const out: AlarmPulse[] = [{ at: 0, dur: td }];
  for (const g of gaps) {
    const prev = out[out.length - 1];
    out.push({ at: prev.at + prev.dur + g, dur: td });
  }
  return out;
}

export function alarmTone(priority: AlarmPriority): AlarmTone {
  if (priority === 'high') {
    const { td, x, pause56, tb, f0, gain } = IEC_TIMING.high;
    const skip = 2 * x + td;
    const pulses = pulsesFrom(td, [x, x, skip, x, pause56, x, x, skip, x]);
    return { priority, f0, harmonics: HARMONICS, pulses, rise: td * IEC_TIMING.riseFrac, fall: td * IEC_TIMING.riseFrac, interburst: tb, gain };
  }
  const { td, y, tb, f0, gain } = IEC_TIMING.medium;
  return { priority, f0, harmonics: HARMONICS, pulses: pulsesFrom(td, [y, y]), rise: td * IEC_TIMING.riseFrac, fall: td * IEC_TIMING.riseFrac, interburst: tb, gain };
}

/** seconds from a burst's start to the end of its last pulse */
export function burstLength(t: AlarmTone): number {
  const last = t.pulses[t.pulses.length - 1];
  return last.at + last.dur;
}

// ───────────────────────────── when an alarm is audible ─────────────────────────────

export const ALARM_AUDIO = {
  /** alarm condition delay before the tone starts (s): monitors average out a stray reading */
  onsetSec: { high: 2, medium: 5 },
  /** the condition must stay away this long before the tone stops */
  clearSec: 2,
  /** AUDIO PAUSED after an acknowledgement (opening the monitor = its pause key) */
  pauseSec: 120,
  /** a nurse silences an unattended medium-priority alarm after this long (s); high keeps sounding */
  staffAckSec: [40, 80] as const,
};

/**
 * Per-monitor alarm state with onset/clear hysteresis and audio pause. Times are seconds on any
 * monotonic clock. `audible(now)` gives the priority to sound right now, or null.
 */
export class AlarmState {
  private condition: AlarmPriority | null = null;
  /** start of the condition (any priority), and of its high-priority part */
  private since = 0;
  private highSince = 0;
  private clearedAt = 0;
  private sounding: AlarmPriority | null = null;
  private soundingSince = 0;
  private pausedUntil = 0;
  private pausedPriority: AlarmPriority | null = null;
  private staffAckAt = Infinity;

  constructor(private rand: () => number = Math.random) {}

  /** feed the current condition (from monitorAlarms) */
  update(p: AlarmPriority | null, now: number): void {
    if (p) {
      if (!this.condition) this.since = this.highSince = now;
      else if (p === 'high' && this.condition !== 'high') this.highSince = now;
      this.condition = p;
      this.clearedAt = 0;
    } else if (this.condition && !this.clearedAt) this.clearedAt = now;
    if (this.clearedAt && now - this.clearedAt >= ALARM_AUDIO.clearSec) {
      this.condition = null;
      this.clearedAt = 0;
    }
    const { onsetSec } = ALARM_AUDIO;
    let want: AlarmPriority | null = null;
    if (this.condition === 'high') {
      if (now - this.highSince >= onsetSec.high) want = 'high';
      else if (this.sounding === 'medium') want = 'medium'; // escalating: keep the yellow tone until red is confirmed
    } else if (this.condition === 'medium' && now - this.since >= onsetSec.medium) want = 'medium';
    if (want !== this.sounding) {
      this.sounding = want;
      this.soundingSince = now;
      this.staffAckAt = want === 'medium' ? this.nextStaffAck(now) : Infinity;
    }
    // a pause ran out while a yellow alarm still sounds: a nurse will silence it again later
    if (this.sounding === 'medium' && this.staffAckAt === Infinity && now >= this.pausedUntil) this.staffAckAt = this.nextStaffAck(now);
    if (this.sounding && now >= this.staffAckAt) this.acknowledge(now);
  }

  private nextStaffAck(now: number): number {
    const [a, b] = ALARM_AUDIO.staffAckSec;
    return now + a + this.rand() * (b - a);
  }

  /** the alarm-pause key: silence for pauseSec (a later escalation to high breaks through) */
  acknowledge(now: number, sec = ALARM_AUDIO.pauseSec): void {
    if (!this.sounding) return;
    this.pausedUntil = now + sec;
    this.pausedPriority = this.sounding;
    this.staffAckAt = Infinity;
  }

  audible(now: number): AlarmPriority | null {
    if (!this.sounding) return null;
    if (now < this.pausedUntil && !(this.sounding === 'high' && this.pausedPriority === 'medium')) return null;
    return this.sounding;
  }

  /** seconds of AUDIO PAUSED left for an active condition (the monitor shows it), else 0 */
  pauseRemaining(now: number): number {
    return this.sounding && this.audible(now) === null ? Math.max(0, this.pausedUntil - now) : 0;
  }

  /** how long the current tone has been sounding (s) */
  soundingFor(now: number): number {
    return this.sounding ? now - this.soundingSince : 0;
  }
}

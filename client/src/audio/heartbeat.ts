/**
 * One beat clock per patient, shared by everything that shows or sounds the heartbeat: the 3D
 * bedside monitor's ECG/pleth sweep (world/screens.ts), the monitor panel (ui/MonitorPanel.tsx) and
 * the QRS tone (audio/monitors.ts). Each R wave is drawn and beeped from the same beat time, so
 * tone and trace stay in step, in sinus rhythm and in atrial fibrillation alike.
 *
 * Times are seconds on the performance clock (performance.now() / 1000). Beats are generated about
 * a second ahead from the latest monitored HR and rhythm; pure (no DOM), unit-tested.
 */

/** beat-to-beat variability: sinus ±3 % (normal HRV), AF irregularly irregular (RR 0.55–1.45 × mean) */
function rrFactor(rhythm: string, rand: () => number): number {
  switch (rhythm) {
    case 'afib':
      return 0.55 + rand() * 0.9;
    case 'paced':
      return 1;
    case 'flutter':
    case 'svt':
    case 'vt':
      return 0.99 + rand() * 0.02;
    default:
      return 0.97 + rand() * 0.06;
  }
}

export class BeatTrain {
  /** ascending beat (R-wave) times */
  readonly beats: number[] = [];
  private hr = 60;
  private rhythm = 'sinus';
  private next = NaN;

  constructor(private rand: () => number = Math.random) {}

  /** latest monitored rate and rhythm; asystole/VF (or HR 0) produce no beats */
  set(hr: number, rhythm: string | undefined): this {
    this.hr = Number.isFinite(hr) ? hr : 0;
    this.rhythm = rhythm ?? 'sinus';
    return this;
  }

  private get beating(): boolean {
    return this.hr >= 10 && this.rhythm !== 'asystole' && this.rhythm !== 'vf';
  }

  /** make sure beats are known up to now + ahead (and forget those older than 10 s) */
  ensure(now: number, ahead = 1): this {
    if (!this.beating) {
      this.next = NaN;
      return this;
    }
    const rr = 60 / Math.min(250, this.hr);
    if (!Number.isFinite(this.next) || this.next < now - 3) {
      // first beat (or after a pause in rhythm / a long gap): somewhere in the coming RR interval
      const last = this.beats[this.beats.length - 1];
      this.next = last !== undefined && now - last < rr * 1.5 ? last + rr : now + this.rand() * rr;
    }
    const horizon = now + ahead;
    let guard = 0;
    while (this.next <= horizon && guard++ < 2000) {
      this.beats.push(this.next);
      this.next += rr * rrFactor(this.rhythm, this.rand);
    }
    let drop = 0;
    while (drop < this.beats.length && this.beats[drop] < now - 10) drop++;
    if (drop) this.beats.splice(0, drop);
    return this;
  }

  /** beats with t0 <= b < t1, appended to `out` */
  between(t0: number, t1: number, out: number[] = []): number[] {
    for (const b of this.beats) if (b >= t0 && b < t1) out.push(b);
    return out;
  }

  /** the last beat at or before t (NaN if none known) */
  lastAtOrBefore(t: number): number {
    let r = NaN;
    for (const b of this.beats) {
      if (b > t) break;
      r = b;
    }
    return r;
  }

  /** the first beat after t (NaN if none generated yet) */
  firstAfter(t: number): number {
    for (const b of this.beats) if (b > t) return b;
    return NaN;
  }
}

const trains = new Map<string, BeatTrain>();

/** The beat clock of one patient (key: patientId). */
export function beatTrain(patientId: string): BeatTrain {
  let tr = trains.get(patientId);
  if (!tr) {
    tr = new BeatTrain();
    trains.set(patientId, tr);
  }
  return tr;
}

/** performance-clock seconds (the shared beat time base) */
export function beatClock(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

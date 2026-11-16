/**
 * A realistic ECG beat for the menu and loading-screen traces and the wordmark's pulse. The beat is
 * a sum of Gaussian waves (P, Q, R, S, and an asymmetric T), the way synthetic-ECG models build one
 * (McSharry et al., IEEE Trans Biomed Eng 2003), so the trace curves like a monitor's, not like
 * straight segments joined at corners.
 *
 * Times are fractions of one RR interval at 60/min (1 s): P at 0.22 s, a narrow QRS around 0.40 s
 * (about 80 ms), T at 0.67 s (QT about 0.40 s). Amplitudes are relative to the R wave.
 */
interface Wave {
  at: number;
  amp: number;
  /** width (s) before the peak, and after it if different (the T wave rises slower than it falls) */
  w: number;
  w2?: number;
}

const WAVES: Wave[] = [
  { at: 0.22, amp: 0.13, w: 0.026 }, // P
  { at: 0.372, amp: -0.11, w: 0.009 }, // Q
  { at: 0.4, amp: 1, w: 0.0105 }, // R
  { at: 0.428, amp: -0.24, w: 0.011 }, // S
  { at: 0.67, amp: 0.27, w: 0.058, w2: 0.038 }, // T
];

/** the trace at phase t (0…1 of a beat): 0 = baseline, 1 = the top of the R wave */
export function ecgLevel(t: number): number {
  let y = 0;
  for (const v of WAVES) {
    const d = t - v.at;
    const w = d > 0 && v.w2 ? v.w2 : v.w;
    y += v.amp * Math.exp(-(d * d) / (2 * w * w));
  }
  return y;
}

/** sample phases for one beat: every 1/200, and every 1/1500 through the QRS so the R peak is never cut off */
const PHASES: number[] = (() => {
  const s = new Set<number>();
  for (let i = 0; i <= 200; i++) s.add(i / 200);
  for (let t = 0.34; t <= 0.46; t += 1 / 1500) s.add(Math.round(t * 1e6) / 1e6);
  return [...s].sort((a, b) => a - b);
})();

/**
 * An SVG path of `beats` beats from x0, each `beatW` wide, on baseline y0 with an R wave `amp` tall
 * (SVG y grows downward, so the R wave points up).
 */
export function ecgPath(beats: number, beatW: number, y0: number, amp: number, x0 = 0): string {
  const out: string[] = [];
  for (let k = 0; k < beats; k++)
    for (const t of PHASES) {
      if (k > 0 && t === 0) continue;
      out.push(`${(x0 + (k + t) * beatW).toFixed(2)} ${(y0 - amp * ecgLevel(t)).toFixed(2)}`);
    }
  return `M${out.join('L')}`;
}

/** one beat between flat baseline: from x0 to x1, the beat starting at `start` and `beatW` wide */
export function ecgPulse(x0: number, x1: number, start: number, beatW: number, y0: number, amp: number): string {
  const pts: string[] = [`${x0} ${y0}`];
  for (const t of PHASES) pts.push(`${(start + t * beatW).toFixed(2)} ${(y0 - amp * ecgLevel(t)).toFixed(2)}`);
  pts.push(`${x1} ${y0}`);
  return `M${pts.join('L')}`;
}

/** the beat as [x, y] points across `beatW` (for anything that rides the trace, like the loading screen's pen) */
export function ecgPoints(beatW: number, y0: number, amp: number): [number, number][] {
  return PHASES.map((t) => [t * beatW, y0 - amp * ecgLevel(t)]);
}

/**
 * Procedural 12-lead ECG synthesis.
 *
 * Each beat is a sum of Gaussian waves (P, q, R, S, T) whose per-lead amplitudes come
 * from a simple frontal-plane vector projection (limb leads) and a precordial R-wave
 * progression table (V1–V6, V4R). ST deviation (mm, 1 mm = 0.1 mV) is added as a
 * plateau from the J point that merges into the T wave (coved / hyperacute shape
 * for elevation, flattened T for depression). Rhythms: sinus, AF (irregularly
 * irregular RR + fibrillatory baseline, no P), flutter (sawtooth F waves, 2:1),
 * SVT, VT, VF, asystole, paced. All randomness is seeded → identical tracing on
 * every render.
 */
import type { EcgParams, Lead } from '../../../../shared/types';

export const LIMB_ANGLE: Partial<Record<Lead, number>> = { I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90 };

interface Morph {
  p: number;
  q: number;
  r: number;
  s: number;
  t: number;
  /** ST deviation in mV */
  st: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRECORDIAL: Record<string, Omit<Morph, 'st'>> = {
  V1: { p: 0.05, q: 0, r: 0.22, s: -0.95, t: -0.04 },
  V2: { p: 0.07, q: 0, r: 0.42, s: -1.4, t: 0.42 },
  V3: { p: 0.08, q: 0, r: 0.78, s: -0.82, t: 0.48 },
  V4: { p: 0.08, q: -0.03, r: 1.32, s: -0.42, t: 0.44 },
  V5: { p: 0.08, q: -0.07, r: 1.42, s: -0.2, t: 0.34 },
  V6: { p: 0.08, q: -0.08, r: 1.08, s: -0.1, t: 0.27 },
  V4R: { p: 0.04, q: 0, r: 0.18, s: -0.62, t: 0.06 },
};

const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180);

export function morphology(lead: Lead, p: EcgParams): Morph {
  const axis = p.axis ?? 60;
  let m: Omit<Morph, 'st'>;
  const ang = LIMB_ANGLE[lead];
  if (ang !== undefined) {
    const proj = cosd(axis - ang);
    const amp = 1.2;
    let r: number;
    let s: number;
    if (proj >= 0) {
      r = amp * proj + 0.07;
      s = -0.08 - 0.22 * (1 - proj);
    } else {
      r = 0.1 * (1 + proj) + 0.04;
      s = amp * proj - 0.06;
    }
    const q = (lead === 'I' || lead === 'aVL') && proj > 0.25 ? -0.07 : lead === 'II' || lead === 'aVF' ? -0.03 : 0;
    const t = 0.3 * cosd(axis - 20 - ang);
    const pw = 0.12 * cosd(55 - ang);
    m = { p: pw, q, r, s, t };
  } else {
    m = { ...PRECORDIAL[lead] };
  }
  const st = ((p.st?.[lead] ?? 0) as number) * 0.1;
  let { t, q, r } = m;
  if (p.qWaves?.includes(lead)) {
    q = -0.32;
    r = r * 0.6;
  }
  if (p.tInversion?.includes(lead)) t = -Math.max(0.18, Math.abs(t) * 1.1);
  if (p.peakedT) t = t > 0 ? t * 2.3 + 0.2 : t;
  if (st > 0.05) t = Math.max(t, 0.05) + st * 0.75; // hyperacute T merging with the elevated ST
  if (st < -0.05) t = t * 0.35 + st * 0.4; // flattened / inverted T with depression
  return { ...m, q, r, t, st };
}

/** R-peak times (s) for the whole recording. */
export function beatTimes(p: EcgParams, duration: number): number[] {
  const rng = mulberry32((p.seed ?? 1) * 9973 + 17);
  const rate = Math.max(15, p.rate || 60);
  const mean = 60 / rate;
  const out: number[] = [];
  let t = 0.18 + rng() * mean * 0.7;
  while (t < duration + 1.2) {
    out.push(t);
    let rr: number;
    if (p.rhythm === 'afib') rr = mean * (0.6 + rng() * 0.8);
    else if (p.rhythm === 'sinus') rr = mean * (1 + (rng() - 0.5) * 0.05);
    else rr = mean;
    t += rr;
  }
  return out;
}

const gauss = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w));
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function beatWave(dt: number, m: Morph, p: EcgParams, lead: Lead): number {
  const wide = p.rhythm === 'vt' || p.rhythm === 'paced';
  const qrs = (wide ? Math.max(150, p.qrs ?? 160) : p.qrs ?? 90) / 1000;
  const pr = (p.pr ?? 160) / 1000;
  const qt = (p.qt ?? 400) / 1000;
  const onset = -qrs * 0.45;
  let v = 0;

  const hasP = p.rhythm === 'sinus' || p.rhythm === 'paced';
  if (hasP) {
    const pc = onset - pr + 0.045;
    if (lead === 'V1') v += 0.06 * gauss(dt, pc - 0.012, 0.014) - 0.05 * gauss(dt, pc + 0.02, 0.014);
    else v += m.p * gauss(dt, pc, 0.022);
  }

  if (p.rhythm === 'paced') {
    v += 1.4 * gauss(dt, onset - 0.004, 0.0012); // pacing spike
  }

  if (wide) {
    // broad, notched complex with discordant T
    const dir = m.r + m.s >= 0 ? 1 : -1;
    const big = Math.max(Math.abs(m.r), Math.abs(m.s)) * 1.25 + 0.4;
    v += dir * big * gauss(dt, onset + qrs * 0.38, qrs * 0.2);
    v += -dir * 0.25 * gauss(dt, onset + qrs * 0.75, qrs * 0.14);
    v += -dir * 0.45 * (dt < onset + qt * 0.7 ? gauss(dt, onset + qt * 0.7, 0.07) : gauss(dt, onset + qt * 0.7, 0.05));
    return v;
  }

  v += m.q * gauss(dt, onset + qrs * 0.15, qrs * 0.085);
  v += m.r * gauss(dt, 0, qrs * 0.125);
  v += m.s * gauss(dt, qrs * 0.3, qrs * 0.11);

  const j = onset + qrs;
  const tPeak = onset + qt * 0.72;
  if (m.st !== 0) {
    const rise = smoothstep(j - 0.012, j + 0.02, dt);
    const fall = 1 - smoothstep(tPeak - 0.01, tPeak + 0.11, dt);
    v += m.st * rise * fall;
  }
  const tw = dt < tPeak ? 0.058 : 0.042;
  v += m.t * gauss(dt, tPeak, tw);
  // small U wave in V2–V3
  if (lead === 'V2' || lead === 'V3') v += 0.03 * gauss(dt, tPeak + 0.16, 0.03);
  return v;
}

function leadBaselineGain(lead: Lead): number {
  switch (lead) {
    case 'V1':
    case 'II':
    case 'III':
    case 'aVF':
      return 1;
    case 'V4R':
      return 0.8;
    default:
      return 0.55;
  }
}

/** Sample one lead between tStart and tEnd (seconds) in mV. */
export function sampleLead(lead: Lead, p: EcgParams, tStart: number, tEnd: number, hz: number, beats: number[]): number[] {
  const m = morphology(lead, p);
  const n = Math.max(2, Math.round((tEnd - tStart) * hz));
  const out = new Array<number>(n);
  const rng = mulberry32((p.seed ?? 1) * 131 + lead.length * 7 + lead.charCodeAt(lead.length - 1));
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const noise = p.noise ?? 0.15;
  const fGain = leadBaselineGain(lead);
  let bi = 0;
  for (let i = 0; i < n; i++) {
    const t = tStart + i / hz;
    let v = 0;
    if (p.rhythm === 'asystole') {
      v = 0.015 * Math.sin(6.28 * 0.3 * t + ph[0]);
    } else if (p.rhythm === 'vf') {
      const a = 0.35 + 0.2 * Math.sin(6.28 * 0.4 * t + ph[1]);
      v = a * (Math.sin(6.28 * 5.2 * t + ph[0] + 1.5 * Math.sin(6.28 * 0.7 * t)) + 0.5 * Math.sin(6.28 * 3.7 * t + ph[2]));
      v *= fGain + 0.4;
    } else {
      while (bi < beats.length - 1 && beats[bi + 1] < t - 0.8) bi++;
      for (let k = bi; k < beats.length && beats[k] < t + 0.9; k++) {
        const dt = t - beats[k];
        if (dt > -0.6 && dt < 0.8) v += beatWave(dt, m, p, lead);
      }
      if (p.rhythm === 'afib') {
        v += 0.045 * fGain * (Math.sin(6.28 * 6.1 * t + ph[0]) + 0.6 * Math.sin(6.28 * 7.4 * t + ph[1]) + 0.45 * Math.sin(6.28 * 4.6 * t + ph[2]));
      } else if (p.rhythm === 'flutter') {
        const ph5 = (t * 5 + ph[3]) % 1; // 300/min sawtooth
        const saw = ph5 < 0.8 ? -ph5 / 0.8 : -(1 - (ph5 - 0.8) / 0.2);
        v += 0.18 * fGain * (saw + 0.5) * (lead === 'aVR' || lead === 'aVL' || lead === 'I' ? -0.4 : 1);
      }
    }
    // baseline wander + tiny muscle noise
    v += noise * (0.05 * Math.sin(6.28 * 0.28 * t + ph[1]) + 0.012 * Math.sin(6.28 * 37 * t + ph[2]) + 0.008 * Math.sin(6.28 * 53 * t + ph[3]));
    out[i] = v;
  }
  return out;
}

export interface Measurements {
  rate: number;
  pr?: number;
  qrs: number;
  qt: number;
  qtc: number;
  axis: number;
}

export function measurements(p: EcgParams): Measurements {
  const rr = 60 / Math.max(15, p.rate || 60);
  const qt = p.qt ?? 400;
  return {
    rate: Math.round(p.rate),
    pr: p.rhythm === 'sinus' || p.rhythm === 'paced' ? p.pr ?? 160 : undefined,
    qrs: p.rhythm === 'vt' || p.rhythm === 'paced' ? Math.max(150, p.qrs ?? 160) : p.qrs ?? 90,
    qt,
    qtc: Math.round(qt / Math.sqrt(rr)),
    axis: p.axis ?? 60,
  };
}

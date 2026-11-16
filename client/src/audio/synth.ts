/**
 * Offline synthesis of the soundscape's sounds: each function renders PCM (Float32Array, −1..1) at
 * the AudioContext's sample rate once; the engine plays them as buffers, so a beep, step or ring
 * costs one AudioBufferSourceNode at runtime. Pure (no Web Audio, no DOM) and unit-tested.
 *
 * Everything here is synthetic in reality too (monitor and alarm tones, ring tones, pump and
 * printer beeps) or mechanical noise that filtered noise models well (HVAC, fans, compressors,
 * door operators, footsteps on sheet vinyl). No recordings.
 */
import type { AlarmTone } from './clinical';

export type Rand = () => number;
export type Pcm = Float32Array;
export type StereoPcm = [Float32Array, Float32Array];

const TAU = Math.PI * 2;

export function mulberry(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── building blocks ─────────────────────────────

/** RBJ-cookbook biquad run over a whole buffer (in place) */
export function biquad(x: Pcm, sr: number, type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking', f: number, q = 0.707, gainDb = 0): Pcm {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'lowpass') [b0, b1, b2, a0, a1, a2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al];
  else if (type === 'highpass') [b0, b1, b2, a0, a1, a2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al];
  else if (type === 'bandpass') [b0, b1, b2, a0, a1, a2] = [al, 0, -al, 1 + al, -2 * cs, 1 - al];
  else [b0, b1, b2, a0, a1, a2] = [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
  return x;
}

export function white(n: number, rand: Rand): Pcm {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  return x;
}

/** pink noise (−3 dB/octave), Paul Kellet's filter */
export function pink(n: number, rand: Rand): Pcm {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return x;
}

/** brown noise (−6 dB/octave), leaky integrator */
export function brown(n: number, rand: Rand): Pcm {
  const x = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = (v + 0.02 * (rand() * 2 - 1)) / 1.02;
    x[i] = v * 3.5;
  }
  return x;
}

export function peak(x: Pcm): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export function normalize(x: Pcm, to = 0.9): Pcm {
  const p = peak(x);
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= to / p;
  return x;
}

export function rms(x: Pcm): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** scale so the RMS level is `db` dBFS */
export function level(x: Pcm, db: number): Pcm {
  const r = rms(x);
  const k = r > 0 ? 10 ** (db / 20) / r : 0;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** add `src` into `dst` starting at sample `at`, scaled */
export function mix(dst: Pcm, src: Pcm, at: number, gain = 1): void {
  const o = Math.max(0, Math.round(at));
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
}

/** raised-cosine fade in/out over `a` and `r` seconds */
export function fades(x: Pcm, sr: number, a: number, r: number): Pcm {
  const na = Math.max(1, Math.round(a * sr));
  const nr = Math.max(1, Math.round(r * sr));
  for (let i = 0; i < na && i < x.length; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / na);
  for (let i = 0; i < nr && i < x.length; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nr);
  return x;
}

/** make a noise loop seamless: cross-fade the last `xf` seconds into the start, then drop them */
export function seamless(x: Pcm, sr: number, xf = 0.25): Pcm {
  const n = Math.round(xf * sr);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * Math.sqrt(k) + x[x.length - n + i] * Math.sqrt(1 - k);
  }
  return out;
}

/** exponentially decaying burst of filtered noise: clicks, scuffs, thumps */
export function burst(sr: number, rand: Rand, dur: number, decay: number, f: number, type: 'lowpass' | 'highpass' | 'bandpass', q = 0.9): Pcm {
  const n = Math.max(1, Math.round(dur * sr));
  const x = white(n, rand);
  for (let i = 0; i < n; i++) x[i] *= Math.exp(-i / sr / decay);
  biquad(x, sr, type, f, q);
  return x;
}

/** decaying sine (optionally gliding from f0 to f1) */
export function tone(sr: number, dur: number, f0: number, f1 = f0, decay = dur, attack = 0.002): Pcm {
  const n = Math.max(1, Math.round(dur * sr));
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 + (f1 - f0) * (i / n);
    ph += (TAU * f) / sr;
    x[i] = Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t / attack);
  }
  return x;
}

// ───────────────────────────── monitors ─────────────────────────────

/** QRS / pulse tone: a short, nearly pure beep (small harmonic content, as from a monitor speaker) */
export function qrsBeep(sr: number, hz: number, dur = 0.08): Pcm {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  const a = 0.004 * sr;
  const r = 0.022 * sr;
  for (let i = 0; i < n; i++) {
    const ph = (TAU * hz * i) / sr;
    const env = Math.min(1, i / a) * Math.min(1, (n - i) / r);
    x[i] = (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * env;
  }
  return normalize(x, 0.9);
}

/** one IEC 60601-1-8 alarm burst (all pulses of a high- or medium-priority signal) */
export function alarmBurst(sr: number, t: AlarmTone): Pcm {
  const last = t.pulses[t.pulses.length - 1];
  const n = Math.round((last.at + last.dur + 0.02) * sr);
  const x = new Float32Array(n);
  for (const p of t.pulses) {
    const i0 = Math.round(p.at * sr);
    const len = Math.round(p.dur * sr);
    const ra = Math.max(1, t.rise * sr);
    const fa = Math.max(1, t.fall * sr);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const env = (i < ra ? 0.5 - 0.5 * Math.cos((Math.PI * i) / ra) : 1) * (len - i < fa ? 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / fa) : 1);
      const ph = (TAU * t.f0 * (i0 + i)) / sr;
      let v = 0;
      for (let h = 0; h < t.harmonics.length; h++) v += t.harmonics[h] * Math.sin((h + 1) * ph);
      x[i0 + i] = v * env;
    }
  }
  return normalize(x, 0.9);
}

/**
 * Automatic NIBP measurement (~26 s): the cuff pump's buzz while inflating, step deflation with
 * valve ticks, then the exhaust hiss.
 */
export function nibpCycle(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(26 * sr));
  const inflate = 7.5;
  // A small diaphragm pump inside the monitor: a muffled, smooth hum that rises a little as cuff
  // pressure builds, under the air going into the cuff. It used to be a raw sawtooth at 92→110 Hz
  // with a ~50 Hz throb, i.e. a two-stroke engine revving; playtesters heard a chainsaw.
  const ni = Math.round(inflate * sr);
  const air = biquad(pink(ni, rand), sr, 'lowpass', 420, 0.6);
  let ph = 0;
  for (let i = 0; i < ni; i++) {
    const t = i / sr;
    const f = 58 + 9 * (t / inflate);
    ph += (TAU * f) / sr;
    const env = Math.min(1, t / 0.4) * Math.min(1, (inflate - t) / 0.12);
    const hum = Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.4) + 0.06 * Math.sin(3 * ph + 1.1);
    x[i] = (hum * 0.3 + air[i] * 0.55) * env;
  }
  biquad(x, sr, 'lowpass', 300, 0.7);
  // deflation: a valve tick and a breath of air every ~0.9 s
  for (let t = inflate + 0.6; t < 22.5; t += 0.85 + rand() * 0.15) {
    mix(x, burst(sr, rand, 0.012, 0.002, 2600, 'bandpass', 1.4), t * sr, 0.35);
    mix(x, burst(sr, rand, 0.09, 0.03, 3200, 'bandpass', 0.7), t * sr, 0.06);
  }
  const hiss = burst(sr, rand, 1.6, 0.45, 2500, 'bandpass', 0.5);
  mix(x, fades(hiss, sr, 0.02, 0.4), 23 * sr, 0.35);
  return normalize(x, 0.6);
}

// ───────────────────────────── phones ─────────────────────────────

/**
 * Desk-phone ring burst (2 s, the North American 2 s on / 4 s off cadence): an electronic trill
 * alternating two tones at ~20 Hz.
 */
export function deskRing(sr: number, f1 = 1020, f2 = 1340, dur = 2): Pcm {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const sel = 0.5 + 0.5 * Math.tanh(8 * Math.sin(TAU * 20 * t));
    ph += (TAU * (f1 + (f2 - f1) * sel)) / sr;
    // odd harmonics: a small speaker driven by a square-ish tone
    x[i] = Math.sin(ph) + 0.28 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph);
  }
  biquad(x, sr, 'lowpass', 4200, 0.7);
  return normalize(fades(x, sr, 0.012, 0.03), 0.9);
}

/** a generic mobile ringtone (marimba-like arpeggio, 2.4 s; not any real phone's tune) */
export function mobileRing(sr: number, rand: Rand): Pcm {
  const notes = [76, 83, 79, 88, 86, 79, 83, 76];
  const step = 0.15;
  const x = new Float32Array(Math.round((notes.length * step * 2 + 0.4) * sr));
  for (let rep = 0; rep < 2; rep++) {
    notes.forEach((m, k) => {
      const hz = 440 * 2 ** ((m - 69) / 12);
      const at = (rep * notes.length + k) * step;
      const v = tone(sr, 0.35, hz, hz, 0.09, 0.002);
      const o = tone(sr, 0.35, hz * 4, hz * 4, 0.02, 0.001);
      for (let i = 0; i < v.length; i++) v[i] += 0.3 * o[i];
      mix(x, v, at * sr, 0.85 + 0.15 * rand());
    });
  }
  biquad(x, sr, 'highpass', 400, 0.7); // phone speaker
  return normalize(x, 0.9);
}

/** a phone vibrating on a hard surface (0.9 s: two buzzes) */
export function vibrate(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(0.9 * sr));
  for (const at of [0, 0.5]) {
    const n = Math.round(0.38 * sr);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.sign(Math.sin((TAU * 165 * i) / sr)) * (0.7 + 0.3 * rand());
    biquad(b, sr, 'bandpass', 330, 1.2);
    mix(x, fades(b, sr, 0.01, 0.02), at * sr);
  }
  return normalize(x, 0.8);
}

/** handset lifted (rattle of plastic) or put down (thunk) */
export function handset(sr: number, rand: Rand, down: boolean): Pcm {
  const x = new Float32Array(Math.round(0.25 * sr));
  for (let k = 0; k < (down ? 2 : 3); k++) mix(x, burst(sr, rand, 0.03, 0.004, 2400 + rand() * 1500, 'bandpass', 1.1), (0.01 + k * (0.018 + rand() * 0.02)) * sr, 0.6);
  if (down) mix(x, tone(sr, 0.12, 140, 90, 0.03), 0.02 * sr, 0.8);
  return normalize(x, 0.8);
}

// ───────────────────────────── people moving ─────────────────────────────

export type Surface = 'vinyl' | 'asphalt' | 'concrete';

/**
 * One footstep: heel strike, the body's thump, then the toe's scuff. Soft rubber soles on sheet
 * vinyl, gritty on asphalt, a harder slap on concrete stairs. `heavy` = running / landing.
 */
export function footstep(sr: number, rand: Rand, surface: Surface, heavy = false): Pcm {
  const x = new Float32Array(Math.round(0.22 * sr));
  const k = heavy ? 1.6 : 1;
  const heelF = surface === 'asphalt' ? 3200 : surface === 'concrete' ? 2200 : 1700;
  mix(x, burst(sr, rand, 0.03, 0.005 * k, heelF + rand() * 600, 'bandpass', 0.8), 0, 0.5 * k);
  mix(x, tone(sr, 0.09, 95 + rand() * 25, 60, 0.025 * k), 0.002 * sr, (surface === 'concrete' ? 0.55 : 0.4) * k);
  mix(x, burst(sr, rand, 0.06, 0.02, 350, 'lowpass', 0.7), 0.003 * sr, 0.5 * k);
  const toe = (0.035 + rand() * 0.035) * sr;
  const scuff = burst(sr, rand, 0.09, surface === 'asphalt' ? 0.04 : 0.022, surface === 'asphalt' ? 4200 : 2600, 'bandpass', 0.6);
  if (surface === 'asphalt') for (let i = 0; i < scuff.length; i++) if (rand() < 0.02) scuff[i] += (rand() - 0.5) * 0.8; // grit
  mix(x, scuff, toe, surface === 'asphalt' ? 0.45 : 0.28);
  // rubber soles squeak on hospital vinyl now and then
  if (surface === 'vinyl' && rand() < 0.06) {
    const n = Math.round(0.06 * sr);
    const s = new Float32Array(n);
    let ph = 0;
    const f0 = 2100 + rand() * 900;
    for (let i = 0; i < n; i++) {
      ph += (TAU * (f0 + 500 * (i / n) + 120 * Math.sin((TAU * 42 * i) / sr))) / sr;
      s[i] = Math.sin(ph) * Math.sin((Math.PI * i) / n);
    }
    mix(x, s, toe, 0.12);
  }
  return normalize(fades(x, sr, 0.0005, 0.05), heavy ? 0.9 : 0.75);
}

/** automatic sliding door: operator motor and belt, then the leaves stopping (open) or meeting (close) */
export function slidingDoor(sr: number, rand: Rand, open: boolean): Pcm {
  const dur = open ? 1.5 : 1.8;
  const n = Math.round(dur * sr);
  // The operator: a smooth electric whine and the belt and rollers rumbling while the leaves travel.
  // It used to be a sawtooth sweeping 85→155 Hz and back, which revved like a small engine.
  const motor = new Float32Array(n);
  const roll = biquad(brown(n, rand), sr, 'lowpass', 380, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const travel = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 1.5; // speeds up, then slows
    const f = (open ? 170 : 150) + 90 * travel;
    ph += (TAU * f) / sr;
    motor[i] = (Math.sin(ph) * 0.18 + roll[i] * 0.8) * travel;
  }
  const air = white(n, rand);
  for (let i = 0; i < n; i++) air[i] *= Math.sin(Math.PI * (i / n)) ** 2;
  biquad(air, sr, 'bandpass', open ? 900 : 650, 0.6);
  const x = new Float32Array(n + Math.round(0.2 * sr));
  mix(x, motor, 0, 0.6);
  mix(x, air, 0, 0.25);
  mix(x, tone(sr, 0.16, 75, 55, 0.05), (dur - 0.08) * sr, open ? 0.25 : 0.45);
  mix(x, burst(sr, rand, 0.04, 0.006, 1800, 'bandpass', 1), (dur - 0.07) * sr, open ? 0.15 : 0.3);
  return normalize(fades(x, sr, 0.05, 0.05), 0.85);
}

// ───────────────────────────── station & bedside equipment ─────────────────────────────

/** laser printer job (~6 s): wake-up whir, two pages picked, fed and ejected */
export function printerJob(sr: number, rand: Rand): Pcm {
  const dur = 6.2;
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  const fan = biquad(white(n, rand), sr, 'lowpass', 900, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const on = Math.min(1, t / 0.5) * Math.min(1, (dur - t) / 0.6);
    ph += (TAU * 205) / sr;
    x[i] = fan[i] * 0.25 * on + (Math.sin(ph) * 0.25 + Math.sin(2 * ph) * 0.12) * on * (t > 0.6 ? 1 : t / 0.6);
  }
  for (const page of [1.4, 3.3]) {
    mix(x, burst(sr, rand, 0.08, 0.025, 380, 'lowpass', 0.8), page * sr, 0.9);
    const feed = burst(sr, rand, 1.1, 0.6, 3000, 'bandpass', 0.5);
    for (let i = 0; i < feed.length; i++) feed[i] *= 0.6 + 0.4 * Math.sin((TAU * 9 * i) / sr);
    mix(x, fades(feed, sr, 0.05, 0.15), (page + 0.1) * sr, 0.5);
    mix(x, burst(sr, rand, 0.03, 0.006, 1500, 'bandpass', 1), (page + 1.3) * sr, 0.5);
  }
  return normalize(fades(x, sr, 0.05, 0.3), 0.8);
}

/** thermal label printer (specimen labels): a short stepper-motor buzz and the tear */
export function labelPrinter(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(1.3 * sr));
  const n = Math.round(0.95 * sr);
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.sign(Math.sin((TAU * (380 + 30 * rand()) * i) / sr)) * (0.6 + 0.4 * Math.sin((TAU * 24 * i) / sr));
  biquad(m, sr, 'lowpass', 2200, 0.8);
  mix(x, fades(m, sr, 0.02, 0.04), 0, 0.5);
  mix(x, burst(sr, rand, 0.12, 0.03, 2600, 'bandpass', 0.6), 1.05 * sr, 0.6);
  return normalize(x, 0.7);
}

/** infusion-pump alert: three short high beeps; the caller repeats it every ~3 s */
export function pumpBeeps(sr: number): Pcm {
  const x = new Float32Array(Math.round(0.8 * sr));
  for (let k = 0; k < 3; k++) {
    const b = tone(sr, 0.09, 1975, 1975, 1, 0.003);
    fades(b, sr, 0.004, 0.01);
    mix(x, b, k * 0.17 * sr, 0.8);
  }
  return x;
}

/** keyboard typing (~6 s): words of 3–8 keys, spaces, short thinking pauses */
export function typing(sr: number, rand: Rand, seconds = 6): Pcm {
  const x = new Float32Array(Math.round((seconds + 0.2) * sr));
  let t = 0.05;
  while (t < seconds) {
    const keys = 3 + Math.floor(rand() * 6);
    for (let k = 0; k < keys && t < seconds; k++) {
      mix(x, burst(sr, rand, 0.02, 0.0025, 3000 + rand() * 2500, 'bandpass', 0.8), t * sr, 0.5 + 0.3 * rand());
      mix(x, burst(sr, rand, 0.03, 0.008, 650 + rand() * 300, 'bandpass', 1.2), (t + 0.004) * sr, 0.35);
      t += 0.085 + rand() * 0.09;
    }
    // space bar: lower and longer
    mix(x, burst(sr, rand, 0.04, 0.01, 420, 'bandpass', 1), t * sr, 0.55);
    t += 0.16 + rand() * 0.2 + (rand() < 0.15 ? 0.6 + rand() * 0.8 : 0);
  }
  return normalize(x, 0.7);
}

/** nurse-call annunciator: a soft bell "ding" (inharmonic partials, ~1 s ring-out) */
export function nurseCall(sr: number): Pcm {
  const x = tone(sr, 1.2, 1318.5, 1318.5, 0.32, 0.003);
  const p2 = tone(sr, 1.2, 2637, 2637, 0.16, 0.002);
  const p3 = tone(sr, 1.2, 1318.5 * 2.76, 1318.5 * 2.76, 0.07, 0.001);
  for (let i = 0; i < x.length; i++) x[i] += 0.3 * p2[i] + 0.12 * p3[i];
  return normalize(x, 0.8);
}

/** pneumatic tube carrier arriving at the station: rising air rush, the carrier dropping in, a chime */
export function tubeArrival(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(2.8 * sr));
  const n = Math.round(1.3 * sr);
  const rush = white(n, rand);
  for (let i = 0; i < n; i++) rush[i] *= (i / n) ** 2;
  biquad(rush, sr, 'bandpass', 700, 0.5);
  mix(x, rush, 0, 0.6);
  mix(x, tone(sr, 0.2, 110, 70, 0.05), 1.3 * sr, 0.9);
  for (let k = 0; k < 3; k++) mix(x, burst(sr, rand, 0.03, 0.005, 2200 + rand() * 1200, 'bandpass', 1), (1.32 + k * 0.05 + rand() * 0.03) * sr, 0.4);
  mix(x, fades(tone(sr, 0.12, 2093, 2093, 1, 0.003), sr, 0.004, 0.02), 1.75 * sr, 0.25);
  mix(x, fades(tone(sr, 0.16, 1568, 1568, 1, 0.003), sr, 0.004, 0.03), 1.9 * sr, 0.25);
  return normalize(x, 0.85);
}

// ───────────────────────────── distant building life ─────────────────────────────

/** something heavy hitting the floor (a fall, a dropped bag): low thump and a small bounce */
export function thud(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(0.6 * sr));
  mix(x, tone(sr, 0.4, 70, 38, 0.11, 0.003), 0, 1);
  mix(x, burst(sr, rand, 0.25, 0.07, 260, 'lowpass', 0.7), 0, 0.9);
  mix(x, tone(sr, 0.2, 60, 45, 0.05), 0.16 * sr, 0.3);
  return normalize(x, 0.9);
}

/** a cart or stretcher rolling past: wheel rumble, rattling contents, sometimes a squeaky castor */
export function cartRoll(sr: number, rand: Rand): Pcm {
  const dur = 2.6 + rand() * 1.4;
  const n = Math.round(dur * sr);
  const x = biquad(brown(n, rand), sr, 'lowpass', 380, 0.7);
  // a 10–12 cm caster at walking pace turns ~3–4×/s; a deep 7–12 Hz pulse on the rumble sounded
  // like a two-stroke engine (a chainsaw) rather than wheels
  const wheel = 2.8 + rand() * 1.4;
  for (let i = 0; i < n; i++) x[i] *= (0.85 + 0.15 * Math.sin((TAU * wheel * i) / sr)) * Math.sin((Math.PI * i) / n);
  for (let t = 0.1; t < dur - 0.1; t += 0.05 + rand() * 0.22) mix(x, burst(sr, rand, 0.02, 0.004, 2500 + rand() * 2500, 'bandpass', 1.2), t * sr, 0.12 * Math.sin((Math.PI * t) / dur));
  if (rand() < 0.4) {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (TAU * (2600 + 200 * Math.sin((TAU * wheel * i) / sr))) / sr;
      x[i] += 0.03 * Math.sin(ph) * Math.max(0, Math.sin((TAU * wheel * 0.5 * i) / sr)) * Math.sin((Math.PI * i) / n);
    }
  }
  return normalize(x, 0.8);
}

/** a swing door closing: latch click and the leaf settling */
export function doorClose(sr: number, rand: Rand): Pcm {
  const x = new Float32Array(Math.round(0.5 * sr));
  mix(x, tone(sr, 0.25, 85, 60, 0.06), 0.01 * sr, 0.8);
  mix(x, burst(sr, rand, 0.12, 0.03, 500, 'lowpass', 0.8), 0.01 * sr, 0.6);
  mix(x, burst(sr, rand, 0.02, 0.003, 3000, 'bandpass', 1.2), 0, 0.5);
  mix(x, burst(sr, rand, 0.02, 0.003, 2600, 'bandpass', 1.2), 0.07 * sr, 0.25);
  return normalize(x, 0.85);
}

/** vehicle reversing alarm cycle: ~1.1 kHz, 0.5 s on / 0.5 s off */
export function reverseBeep(sr: number): Pcm {
  const x = new Float32Array(Math.round(1.0 * sr));
  const n = Math.round(0.5 * sr);
  for (let i = 0; i < n; i++) {
    const ph = (TAU * 1120 * i) / sr;
    x[i] = Math.sin(ph) + 0.3 * Math.sin(3 * ph);
  }
  fades(x.subarray(0, n), sr, 0.006, 0.01);
  return normalize(x, 0.8);
}


/** music leaking from someone's earbuds (8 s loop at 96 BPM): only the tinny top end gets out */
export function earbuds(sr: number, rand: Rand): Pcm {
  const beat = 60 / 96;
  const bars = 3;
  const x = new Float32Array(Math.round(bars * 4 * beat * sr));
  for (let k = 0; k < bars * 8; k++) {
    const t = (k * beat) / 2;
    mix(x, burst(sr, rand, 0.05, 0.012, 8000, 'highpass', 0.7), t * sr, k % 2 ? 0.25 : 0.4);
    if (k % 4 === 2) mix(x, burst(sr, rand, 0.14, 0.05, 2600, 'bandpass', 0.6), t * sr, 0.55);
  }
  biquad(x, sr, 'highpass', 1500, 0.7);
  return normalize(x, 0.8);
}

// ───────────────────────────── beds and hums ─────────────────────────────

/** stereo HVAC/room-tone bed: decorrelated pink-brown noise, seamless loop */
export function roomToneBed(sr: number, rand: Rand, seconds = 6): StereoPcm {
  const ch = (): Pcm => {
    const n = Math.round(seconds * sr);
    const p = pink(n, rand);
    const b = brown(n, rand);
    for (let i = 0; i < n; i++) p[i] = 0.6 * p[i] + 0.4 * b[i];
    return seamless(p, sr);
  };
  return [level(ch(), -20), level(ch(), -20)];
}

/** stereo outdoor bed: distant traffic rumble and tyre hiss rising and falling, seamless loop */
export function outdoorBed(sr: number, rand: Rand, seconds = 8): StereoPcm {
  const ch = (phase: number): Pcm => {
    const n = Math.round(seconds * sr);
    const rumble = biquad(brown(n, rand), sr, 'lowpass', 260, 0.7);
    const hiss = biquad(white(n, rand), sr, 'bandpass', 1400, 0.4);
    for (let i = 0; i < n; i++) {
      const s = 0.5 + 0.5 * Math.sin((TAU * i) / n + phase);
      rumble[i] = rumble[i] * (0.7 + 0.3 * s) + hiss[i] * 0.05 * s;
    }
    return seamless(rumble, sr);
  };
  return [level(ch(0), -20), level(ch(2.2), -20)];
}

export type HumKind = 'fridge' | 'vending' | 'ct' | 'pc' | 'exhaust';

/**
 * Seamless 2 s equipment hum. Mains here is 60 Hz (a US-style hospital), so transformers and
 * compressors hum at 120 Hz and its harmonics; fans add band-limited noise.
 */
export function hum(sr: number, rand: Rand, kind: HumKind): Pcm {
  const dur = 2;
  const n = Math.round(dur * sr) + Math.round(0.25 * sr);
  const spec: Record<HumKind, { h: number[]; noiseF: number; noise: number; q: number }> = {
    fridge: { h: [1, 0.5, 0.3, 0.12], noiseF: 320, noise: 0.5, q: 0.6 },
    // a soft compressor hum under a low condenser-fan whoosh. Eight strong harmonics up to 960 Hz
    // over 700 Hz noise was a sawtooth-like rasp that playtesters heard as a chainsaw.
    vending: { h: [1, 0.32, 0.14, 0.05], noiseF: 380, noise: 0.42, q: 0.6 },
    ct: { h: [0.6, 0.3, 0.6, 0.2], noiseF: 1100, noise: 1.4, q: 0.4 },
    pc: { h: [0.2, 0.1], noiseF: 1800, noise: 0.5, q: 0.5 },
    exhaust: { h: [0.3, 0.1], noiseF: 650, noise: 1.2, q: 0.5 },
  };
  const s = spec[kind];
  const noise = biquad(pink(n, rand), sr, 'bandpass', s.noiseF, s.q);
  level(noise, -20);
  // the noise is cross-faded into a loop; the tones have whole cycles in 2 s, so they wrap exactly
  const x = seamless(noise, sr, 0.25);
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (let k = 0; k < s.h.length; k++) v += s.h[k] * Math.sin((TAU * 120 * (k + 1) * i) / sr + k);
    x[i] = x[i] * s.noise + v * 0.06;
  }
  return normalize(x, 0.7);
}

/** stereo room impulse response: exponential decay to −60 dB over rt60, darker as it decays */
export function roomIR(sr: number, rand: Rand, rt60 = 0.75, seconds = 1.1): StereoPcm {
  const n = Math.round(seconds * sr);
  const ch = (): Pcm => {
    const lo = biquad(white(n, rand), sr, 'lowpass', 1800, 0.6);
    const hi = white(n, rand);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const d = Math.exp((-6.91 * t) / rt60);
      const bright = Math.exp(-t / 0.12);
      x[i] = d * (lo[i] * (1 - bright) + hi[i] * bright * 0.6);
    }
    // a few early reflections from the corridor walls and ceiling
    for (const [t, g] of [[0.011, 0.5], [0.019, 0.35], [0.031, 0.3], [0.047, 0.22]]) x[Math.round(t * sr)] += g * (rand() < 0.5 ? -1 : 1);
    return x;
  };
  return [normalize(ch(), 0.5), normalize(ch(), 0.5)];
}

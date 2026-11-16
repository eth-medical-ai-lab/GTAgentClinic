/**
 * Sounds for the things you can use (world/amenities.ts), synthesized like the rest of the
 * soundscape (synth.ts): rendered once to PCM at the AudioContext's rate, then played as buffers.
 * No recordings.
 *
 *   brew      a bean-to-cup machine: button beep, grinder, the vibratory pump, the pour into the cup
 *             (its resonance rises as the cup fills and the air column above the coffee shortens),
 *             the last drips. 15.3 s, matching the brew in amenities.ts
 *   vend      keypad beeps, the spiral motor, a can dropping into the flap
 *   pump      an alcohol hand-rub dispenser's pump
 *   rub       hands rubbing (about 4 s)
 *   toss      a paper cup dropped into a bin; tossCan: a can
 *   canOpen   a can's tab: click and hiss
 *   sip       a quiet sip
 *   cupDown   a cup set down on a table
 *   water     a tap running into a steel basin (2 s, seamless: looped while it runs)
 *   lever     a wrist-blade tap lever turned
 *   lather    soapy hands, wet and squelchy (about 3.5 s)
 *   towel     a paper towel pulled from its dispenser
 *   binLid    a pedal bin's lid dropping shut
 *   elastic   a mask's ear loop snapped into place
 *   payBeep   a card terminal approving a phone tap (payment.ts)
 *   cupPull   a paper cup slid out of its stack; lidSnap: a lid pressed on; mugLift: a mug off the rack
 */
import { biquad, burst, fades, mix, mulberry, normalize, pink, seamless, tone, white, type Pcm } from './synth';

const TAU = Math.PI * 2;

/** a resonator whose centre frequency can change every sample (Chamberlin state-variable band-pass) */
function sweep(x: Pcm, sr: number, f: (t: number) => number, q: number): Pcm {
  let low = 0;
  let band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const k = 2 * Math.sin((Math.PI * Math.min(f(i / sr), sr / 7)) / sr);
    low += k * band;
    const high = x[i] - low - damp * band;
    band += k * high;
    x[i] = band;
  }
  return x;
}

/** the timeline amenities.ts animates against (seconds from the button press) */
export const BREW = { grindAt: 0.35, grindEnd: 2.95, pourAt: 3.7, pourEnd: 13.7, done: 15.0, length: 15.3 };

export function brew(sr: number): Pcm {
  const out = new Float32Array(Math.round(BREW.length * sr));
  const rand = mulberry(4021);
  mix(out, tone(sr, 0.1, 2200, 2200, 0.2, 0.003), 0.04 * sr, 0.2);
  // grinder: motor whine plus the crackle of beans in the burrs
  {
    const n = Math.round((BREW.grindEnd - BREW.grindAt) * sr);
    const grains = biquad(white(n, rand), sr, 'bandpass', 1900, 0.7);
    const g = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (TAU * (150 + 22 * Math.min(1, t / 0.15))) / sr;
      const gate = 0.55 + 0.45 * Math.sin(TAU * 43 * t + Math.sin(t * 7) * 2);
      const motor = 0.35 * Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph) + 0.06 * Math.sin(5 * ph);
      g[i] = motor * 0.45 + grains[i] * 1.1 * gate * (0.8 + 0.2 * rand());
    }
    fades(g, sr, 0.04, 0.2);
    mix(out, g, BREW.grindAt * sr, 0.55);
  }
  // pump: a vibratory pump on 50 Hz mains, many harmonics, a little rattle
  {
    const t0 = 3.2;
    const n = Math.round((BREW.pourEnd + 0.25 - t0) * sr);
    const p = new Float32Array(n);
    const rattle = biquad(white(n, rand), sr, 'bandpass', 700, 2);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (let k = 1; k <= 8; k++) s += Math.sin(TAU * 50 * k * t + k) / k;
      p[i] = s * 0.5 + rattle[i] * 0.25;
    }
    biquad(p, sr, 'lowpass', 1400);
    fades(p, sr, 0.15, 0.3);
    mix(out, p, t0 * sr, 0.16);
  }
  // the pour: a thin stream into a paper cup; the cavity resonance climbs as the cup fills
  {
    const len = BREW.pourEnd - BREW.pourAt;
    const n = Math.round(len * sr);
    const s = white(n, rand);
    sweep(s, sr, (t) => 850 + 1900 * Math.pow(t / len, 0.8), 6);
    const hiss = biquad(white(n, rand), sr, 'highpass', 3500);
    let am = 0.6;
    for (let i = 0; i < n; i++) {
      if (i % 64 === 0) am = 0.55 + 0.45 * rand();
      s[i] = s[i] * am * 0.9 + hiss[i] * 0.05;
    }
    fades(s, sr, 0.25, 0.6);
    mix(out, s, BREW.pourAt * sr, 0.42);
  }
  for (const [t, f] of [
    [13.95, 1500],
    [14.3, 1320],
    [14.75, 1650],
    [15.1, 1400],
  ] as const)
    mix(out, tone(sr, 0.09, f, f * 0.8, 0.03), t * sr, 0.1);
  return normalize(out, 0.9);
}

/** keypad beeps, the spiral motor, the can landing in the flap (the drop lands at VEND.drop s) */
export const VEND = { motorAt: 0.45, motorEnd: 1.75, drop: 2.0, length: 2.6 };

export function vend(sr: number): Pcm {
  const out = new Float32Array(Math.round(VEND.length * sr));
  const rand = mulberry(77);
  for (const t of [0, 0.17]) mix(out, tone(sr, 0.07, 1850, 1850, 0.2, 0.002), t * sr, 0.18);
  {
    const n = Math.round((VEND.motorEnd - VEND.motorAt) * sr);
    const m = biquad(white(n, rand), sr, 'lowpass', 520);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (TAU * (92 + 6 * Math.sin((i / sr) * 9))) / sr;
      m[i] = m[i] * 0.6 + (((ph / TAU) % 1) * 2 - 1) * 0.35;
    }
    biquad(m, sr, 'lowpass', 900);
    fades(m, sr, 0.05, 0.08);
    mix(out, m, VEND.motorAt * sr, 0.5);
  }
  mix(out, burst(sr, rand, 0.25, 0.07, 170, 'lowpass'), VEND.drop * sr, 1.4);
  mix(out, burst(sr, rand, 0.12, 0.05, 2600, 'bandpass', 6), VEND.drop * sr, 0.9);
  mix(out, burst(sr, rand, 0.08, 0.03, 3300, 'bandpass', 5), (VEND.drop + 0.11) * sr, 0.5);
  return normalize(out, 0.9);
}

export function pump(sr: number): Pcm {
  const rand = mulberry(5);
  const out = new Float32Array(Math.round(0.3 * sr));
  mix(out, burst(sr, rand, 0.06, 0.012, 1800, 'bandpass', 3), 0, 0.6);
  mix(out, burst(sr, rand, 0.22, 0.05, 900, 'bandpass', 1.2), 0.03 * sr, 1);
  mix(out, burst(sr, rand, 0.1, 0.03, 2400, 'bandpass', 2), 0.12 * sr, 0.5);
  return normalize(out, 0.9);
}

export function rub(sr: number, seconds = 4): Pcm {
  const rand = mulberry(31);
  const n = Math.round(seconds * sr);
  const x = biquad(pink(n, rand), sr, 'highpass', 1700);
  let jit = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 2048 === 0) jit = rand() * 0.6;
    x[i] *= 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(Math.PI * 2.6 * t + jit)), 1.5);
  }
  fades(x, sr, 0.15, 0.4);
  return normalize(x, 0.9);
}

export function toss(sr: number): Pcm {
  const rand = mulberry(9);
  const out = new Float32Array(Math.round(0.35 * sr));
  mix(out, burst(sr, rand, 0.15, 0.035, 700, 'lowpass'), 0, 1);
  mix(out, burst(sr, rand, 0.25, 0.06, 3200, 'highpass'), 0.02 * sr, 0.35);
  return normalize(out, 0.9);
}

export function tossCan(sr: number): Pcm {
  const rand = mulberry(10);
  const out = new Float32Array(Math.round(0.45 * sr));
  mix(out, burst(sr, rand, 0.2, 0.06, 2800, 'bandpass', 5), 0, 1);
  mix(out, burst(sr, rand, 0.12, 0.04, 3600, 'bandpass', 6), 0.13 * sr, 0.5);
  mix(out, burst(sr, rand, 0.1, 0.03, 600, 'lowpass'), 0, 0.6);
  return normalize(out, 0.9);
}

export function canOpen(sr: number): Pcm {
  const rand = mulberry(12);
  const out = new Float32Array(Math.round(0.6 * sr));
  mix(out, tone(sr, 0.015, 3200, 2400, 0.006, 0.0005), 0, 0.8);
  mix(out, burst(sr, rand, 0.5, 0.16, 2600, 'highpass'), 0.01 * sr, 0.7);
  return normalize(out, 0.9);
}

export function sip(sr: number): Pcm {
  const rand = mulberry(14);
  const n = Math.round(0.4 * sr);
  const x = biquad(white(n, rand), sr, 'bandpass', 1300, 1.8);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] *= Math.sin(Math.PI * Math.min(1, t / 0.4)) * (0.6 + 0.4 * Math.sin(TAU * 17 * t));
  }
  return normalize(x, 0.9);
}

export function cupDown(sr: number): Pcm {
  const rand = mulberry(16);
  const out = new Float32Array(Math.round(0.08 * sr));
  mix(out, burst(sr, rand, 0.05, 0.01, 1400, 'lowpass'), 0, 1);
  return normalize(out, 0.9);
}

/** a tap running into a steel basin: a hiss with a gurgling, burbling low end; seamless for looping */
export function water(sr: number): Pcm {
  const rand = mulberry(41);
  const n = Math.round(2 * sr);
  const hiss = biquad(white(n, rand), sr, 'bandpass', 3200, 0.6);
  const body = biquad(pink(n, rand), sr, 'bandpass', 700, 0.9);
  const out = new Float32Array(n);
  let bub = 0;
  for (let i = 0; i < n; i++) {
    // drops landing: short random swells of the low band
    if (i % 400 === 0) bub = 0.5 + rand() * 0.7;
    out[i] = 0.55 * hiss[i] + 0.8 * body[i] * bub;
  }
  return normalize(seamless(out, sr, 0.3), 0.8);
}

/** a wrist-blade lever: a soft plastic-and-metal clack */
export function lever(sr: number): Pcm {
  const rand = mulberry(43);
  const out = new Float32Array(Math.round(0.18 * sr));
  mix(out, burst(sr, rand, 0.05, 0.012, 2200, 'bandpass', 3), 0, 1);
  mix(out, tone(sr, 0.08, 1150, 1050, 0.03), 0.004 * sr, 0.35);
  return normalize(out, 0.85);
}

/** soapy hands: wet squelches in the rhythm of the rubbing */
export function lather(sr: number, seconds = 3.5): Pcm {
  const rand = mulberry(47);
  const n = Math.round(seconds * sr);
  const x = biquad(pink(n, rand), sr, 'bandpass', 1300, 1.4);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.pow(Math.abs(Math.sin(Math.PI * 2.4 * t)), 2.5);
    x[i] *= 0.15 + 0.85 * env * (0.7 + 0.3 * Math.sin(TAU * 31 * t));
  }
  fades(x, sr, 0.1, 0.3);
  return normalize(x, 0.8);
}

/** a paper towel pulled out: a dry tearing rustle */
export function towel(sr: number): Pcm {
  const rand = mulberry(53);
  const n = Math.round(0.45 * sr);
  const x = biquad(white(n, rand), sr, 'highpass', 2600);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] *= Math.sin(Math.PI * Math.min(1, t / 0.45)) * (0.4 + 0.6 * (rand() < 0.08 ? 1 : 0.35));
  }
  return normalize(x, 0.8);
}

/** a pedal bin's steel lid dropping shut */
export function binLid(sr: number): Pcm {
  const rand = mulberry(59);
  const out = new Float32Array(Math.round(0.4 * sr));
  mix(out, burst(sr, rand, 0.08, 0.02, 900, 'lowpass'), 0, 1);
  mix(out, tone(sr, 0.3, 2400, 2350, 0.12), 0.002 * sr, 0.18);
  mix(out, tone(sr, 0.25, 3900, 3900, 0.08), 0.002 * sr, 0.08);
  return normalize(out, 0.85);
}

/** a card terminal approving a contactless payment: one clean high beep (payment.ts) */
export function payBeep(sr: number): Pcm {
  const out = new Float32Array(Math.round(0.24 * sr));
  mix(out, tone(sr, 0.16, 2350, 2350, 0.14, 0.003), 0, 1);
  mix(out, tone(sr, 0.16, 4700, 4700, 0.05, 0.003), 0, 0.12);
  return normalize(out, 0.7);
}

/** a paper cup slid up out of its stack: a soft papery whisper with a little catch at the rim */
export function cupPull(sr: number): Pcm {
  const rand = mulberry(67);
  const n = Math.round(0.3 * sr);
  const x = biquad(white(n, rand), sr, 'bandpass', 3400, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] *= Math.sin(Math.PI * Math.min(1, t / 0.3)) * 0.5;
  }
  mix(x, burst(sr, rand, 0.03, 0.008, 1500, 'bandpass', 2), 0.22 * sr, 0.6);
  return normalize(x, 0.6);
}

/** a plastic lid pressed onto a paper cup: two quick clicks round the rim */
export function lidSnap(sr: number): Pcm {
  const rand = mulberry(71);
  const out = new Float32Array(Math.round(0.14 * sr));
  mix(out, burst(sr, rand, 0.025, 0.006, 2600, 'bandpass', 3), 0, 1);
  mix(out, burst(sr, rand, 0.025, 0.006, 3100, 'bandpass', 3), 0.055 * sr, 0.75);
  return normalize(out, 0.75);
}

/** a ceramic mug lifted off a wooden shelf: a dull knock and a short ring */
export function mugLift(sr: number): Pcm {
  const rand = mulberry(73);
  const out = new Float32Array(Math.round(0.25 * sr));
  mix(out, burst(sr, rand, 0.04, 0.01, 700, 'lowpass'), 0, 0.8);
  mix(out, tone(sr, 0.2, 3150, 3120, 0.06), 0.003 * sr, 0.12);
  return normalize(out, 0.6);
}

/** an elastic ear loop let go behind the ear */
export function elastic(sr: number): Pcm {
  const rand = mulberry(61);
  const out = new Float32Array(Math.round(0.12 * sr));
  mix(out, burst(sr, rand, 0.03, 0.008, 1800, 'bandpass', 2), 0, 1);
  mix(out, tone(sr, 0.06, 260, 180, 0.03), 0, 0.4);
  return normalize(out, 0.7);
}

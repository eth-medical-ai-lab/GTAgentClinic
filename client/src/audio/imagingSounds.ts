/**
 * The CT scanner and the X-ray room, synthesized (no recordings), for the soundscape's built-ins:
 *
 *   ct.spin     the gantry rotating (seamless 2 s loop): a soft whir with the rotation's swish
 *               (twice a second) over the bearing's hum
 *   ct.xray     the tube while the beam is on (loop): a faint high whine and buzz on top of the spin
 *   ct.table    the couch's drive moving (loop): a low motor whir
 *   scan.beep   the console's tone when an exposure starts
 *   xray.expose a radiography exposure: the rotating anode spinning up (prepare), the exposure's
 *               tone, then the anode spinning down
 *
 * Pure (no Web Audio): rendered once to PCM at the context's rate, like synth.ts.
 */
import { biquad, level, normalize, pink, seamless, type Pcm, type Rand } from './synth';

const TAU = Math.PI * 2;

/** the gantry spinning: whole cycles in 2 s so the loop wraps cleanly */
export function ctSpin(sr: number, rand: Rand): Pcm {
  const dur = 2;
  const n = Math.round(dur * sr) + Math.round(0.25 * sr);
  const air = biquad(pink(n, rand), sr, 'bandpass', 520, 0.5);
  level(air, -20);
  const hiss = biquad(pink(n, rand), sr, 'highpass', 2400, 0.7);
  level(hiss, -30);
  for (let i = 0; i < n; i++) air[i] += hiss[i];
  const x = seamless(air, sr, 0.25);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    // the swish of the rotating mass passing by, 2 Hz, and the drive's hum at 60 / 180 Hz
    const swish = 0.65 + 0.35 * Math.sin(TAU * 2 * t) ** 2;
    const hum = 0.05 * Math.sin(TAU * 60 * t) + 0.025 * Math.sin(TAU * 180 * t + 1) + 0.012 * Math.sin(TAU * 420 * t + 2);
    x[i] = x[i] * swish * 1.2 + hum;
  }
  return normalize(x, 0.6);
}

/** the tube during an exposure: a thin high whine with a little buzz (loop) */
export function ctXray(sr: number, rand: Rand): Pcm {
  const dur = 2;
  const n = Math.round(dur * sr) + Math.round(0.25 * sr);
  const buzz = biquad(pink(n, rand), sr, 'bandpass', 3200, 2.5);
  level(buzz, -24);
  const x = seamless(buzz, sr, 0.25);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = x[i] + 0.03 * Math.sin(TAU * 2500 * t) + 0.015 * Math.sin(TAU * 5000 * t + 0.5) + 0.02 * Math.sin(TAU * 120 * t);
  }
  return normalize(x, 0.4);
}

/** the couch's drive: a low whir with a slight wobble (loop, 1 s) */
export function ctTable(sr: number, rand: Rand): Pcm {
  const dur = 1;
  const n = Math.round(dur * sr) + Math.round(0.2 * sr);
  const motor = biquad(pink(n, rand), sr, 'lowpass', 700, 0.7);
  level(motor, -22);
  const x = seamless(motor, sr, 0.2);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = x[i] + 0.04 * Math.sin(TAU * 240 * t + 0.3 * Math.sin(TAU * 4 * t)) + 0.02 * Math.sin(TAU * 480 * t);
  }
  return normalize(x, 0.5);
}

/** two short console tones */
export function scanBeep(sr: number): Pcm {
  const n = Math.round(0.42 * sr);
  const x = new Float32Array(n);
  for (const [t0, f] of [[0, 880], [0.2, 660]] as [number, number][]) {
    const a = Math.round(t0 * sr);
    const len = Math.round(0.16 * sr);
    for (let i = 0; i < len && a + i < n; i++) {
      const env = Math.min(1, i / (0.004 * sr)) * Math.min(1, (len - i) / (0.02 * sr));
      x[a + i] += 0.5 * env * Math.sin((TAU * f * i) / sr);
    }
  }
  return x;
}

/** an X-ray exposure: anode spin-up (~1.2 s), the exposure tone, spin-down (~2.5 s) */
export function xrayExpose(sr: number, rand: Rand): Pcm {
  const dur = 4.2;
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  const noise = biquad(pink(n, rand), sr, 'bandpass', 900, 0.8);
  level(noise, -26);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // rotor speed: up to full by 1.2 s, held through the exposure, coasting down after 1.6 s
    const up = Math.min(1, t / 1.2);
    const speed = t < 1.6 ? up * up * (3 - 2 * up) : Math.max(0, 1 - (t - 1.6) / 2.5);
    const f = 60 + 140 * speed;
    ph += (TAU * f) / sr;
    const whine = speed * (0.12 * Math.sin(ph) + 0.06 * Math.sin(ph * 3 + 0.4) + 0.03 * Math.sin(ph * 5));
    x[i] = whine + noise[i] * speed * 0.9;
    // the exposure: a short tone at 1.25–1.5 s
    if (t > 1.25 && t < 1.5) {
      const k = Math.min(1, (t - 1.25) / 0.01) * Math.min(1, (1.5 - t) / 0.02);
      x[i] += 0.32 * k * Math.sin(TAU * 1000 * t);
    }
  }
  return normalize(x, 0.7);
}

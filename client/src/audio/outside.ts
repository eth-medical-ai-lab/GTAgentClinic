/**
 * Outside the building:
 *  - an occasional siren in the distance: either passing by on the road south of the hospital, or
 *    approaching, getting louder for half a minute until the crew switches it off a block away (as
 *    ambulances usually do near a hospital at night). Wail, sometimes yelp; Doppler shift and
 *    distance-dependent air absorption; through the walls when you're inside.
 *  - when EMS crews walk in, their ambulance sits in the bay: reversing alarm, rear doors, the
 *    stretcher coming off. (An idling-diesel loop used to run here; its synthesized pulse train
 *    sounded like a chainsaw, so it was removed. A recorded idle could replace it.)
 */
import type { LayoutDef } from '../../../shared/layout';
import { Emitter, dB, rampTo, type Engine, type Vec3 } from './engine';
import { cartRoll, doorClose, mulberry, reverseBeep } from './synth';

const C = 343;
const LEVEL = { siren: dB(-24), reverse: dB(-25), doors: dB(-26), stretcher: dB(-28) };

export type SirenKind = 'pass' | 'approach';

interface Siren {
  outside?: boolean;
  stopAt: number;
  nodes: AudioNode[];
  osc: OscillatorNode;
  muffle: BiquadFilterNode;
  out: GainNode;
}

export class Outside {
  private rand = mulberry(101);
  private nextSirenAt = 0;
  private siren: Siren | null = null;
  private bayEm: Emitter;
  private center: Vec3;
  private roadZ: number;
  private arrival: Record<'reverse' | 'door1' | 'door2' | 'stretcher', () => AudioBuffer>;

  constructor(private eng: Engine, layout: LayoutDef) {
    const amb = layout.props.find((p) => p.kind === 'ambulance');
    const bay = amb ? { x: amb.x, y: 1.2, z: amb.z } : { x: layout.width / 2, y: 1.2, z: layout.depth + 4 };
    this.bayEm = new Emitter(eng, bay, { ref: 3, rolloff: 1.1, range: 45 });
    this.arrival = {
      reverse: eng.sound('reverse', () => reverseBeep(eng.sr)),
      door1: eng.sound('swing:rear', () => doorClose(eng.sr, mulberry(107))),
      door2: eng.sound('swing:rear2', () => doorClose(eng.sr, mulberry(109))),
      stretcher: eng.sound('cart:stretcher', () => cartRoll(eng.sr, mulberry(113))),
    };
    this.center = { x: layout.width / 2, y: 1.5, z: layout.depth / 2 };
    this.roadZ = layout.depth + 55;
  }

  private between(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  /** an EMS crew just walked in: their ambulance is in the bay */
  ambulanceArrived(perfNow: number): void {
    const e = this.eng;
    const t = e.now;
    e.count('ambulance');
    const a = this.arrival;
    const beep = a.reverse();
    for (let k = 0; k < 6; k++) this.bayEm.play(beep, t + 1.5 + k, { gain: LEVEL.reverse });
    this.bayEm.play(a.door1(), t + 9.5, { gain: LEVEL.doors, rate: 0.8 });
    this.bayEm.play(a.door2(), t + 10.2, { gain: LEVEL.doors * 0.8, rate: 0.75 });
    this.bayEm.play(a.stretcher(), t + 12, { gain: LEVEL.stretcher, rate: 0.85 });
  }

  /** start a siren now (also the public API's 'siren.pass' / 'siren.approach') */
  startSiren(kind: SirenKind): void {
    this.stopSiren(0.5);
    const e = this.eng;
    const c = e.ctx;
    e.count(`siren.${kind}`);
    const t0 = c.currentTime + 0.05;
    const dir = this.rand() < 0.5 ? 1 : -1;
    const v = this.between(13, 18);
    // path along the road: x(t) = x0 + dir·v·t
    const span = kind === 'pass' ? 520 : this.between(520, 680) - 160;
    const T = span / v;
    const x0 = kind === 'pass' ? this.center.x - dir * 260 : this.center.x - dir * (span + 160);
    const N = Math.max(2, Math.ceil(T * 40));
    const freq = new Float32Array(N);
    const gain = new Float32Array(N);
    const lp = new Float32Array(N);
    const px = new Float32Array(N);
    const yelpFrom = kind === 'approach' ? T - this.between(6, 10) : Infinity;
    let prevR = NaN;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * T;
      const x = x0 + dir * v * t;
      const r = Math.hypot(x - this.center.x, this.roadZ - this.center.z);
      const vr = Number.isFinite(prevR) ? (r - prevR) / (T / (N - 1)) : 0;
      prevR = r;
      const period = t > yelpFrom ? 0.32 : 4.8;
      const sweep = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
      freq[i] = (700 + 850 * sweep) * (C / (C + vr));
      const edge = Math.min(1, t / 1.5, (T - t) / (kind === 'pass' ? 2.5 : 0.25));
      gain[i] = Math.min(1, 60 / r) * Math.max(0, edge);
      lp[i] = Math.max(700, Math.min(8000, 9000 * (100 / r) ** 0.6));
      px[i] = x;
    }
    const osc = c.createOscillator();
    osc.type = 'square';
    const horn = c.createBiquadFilter();
    horn.type = 'bandpass';
    horn.frequency.value = 1300;
    horn.Q.value = 0.6;
    const env = c.createGain();
    env.gain.value = 0;
    const air = c.createBiquadFilter();
    air.type = 'lowpass';
    const muffle = c.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    const out = c.createGain();
    out.gain.value = LEVEL.siren;
    const pan = c.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0; // distance is in the envelope above; the panner only gives direction
    if (pan.positionX) {
      pan.positionY.value = 2;
      pan.positionZ.value = this.roadZ;
      pan.positionX.setValueCurveAtTime(px, t0, T);
    }
    osc.frequency.setValueCurveAtTime(freq, t0, T);
    env.gain.setValueCurveAtTime(gain, t0, T);
    air.frequency.setValueCurveAtTime(lp, t0, T);
    osc.connect(horn).connect(env).connect(air).connect(muffle).connect(out).connect(pan).connect(e.bus);
    osc.start(t0);
    osc.stop(t0 + T + 0.05);
    const s: Siren = { stopAt: t0 + T, nodes: [horn, env, air, muffle, out, pan], osc, muffle, out };
    osc.onended = () => {
      for (const n of s.nodes) n.disconnect();
      if (this.siren === s) this.siren = null;
    };
    this.siren = s;
  }

  private stopSiren(fade = 0.3): void {
    const s = this.siren;
    if (!s) return;
    this.siren = null;
    const t = this.eng.now;
    rampTo(s.out.gain, 0, t, fade);
    try {
      s.osc.stop(t + fade + 0.05);
    } catch {
      /* already stopping */
    }
  }

  frame(perfNow: number, night: boolean, outside: boolean): void {
    this.bayEm.update();
    if (!this.nextSirenAt) this.nextSirenAt = perfNow + this.between(90, 420);
    else if (perfNow >= this.nextSirenAt) {
      this.nextSirenAt = perfNow + this.between(night ? 420 : 300, night ? 960 : 720);
      this.startSiren(this.rand() < 0.4 ? 'approach' : 'pass');
    }
    // inside, the building's envelope takes the top off and most of the level
    const s = this.siren;
    if (s && s.outside !== outside) {
      s.outside = outside;
      const t = this.eng.now;
      rampTo(s.muffle.frequency, outside ? 20000 : 750, t, 0.8);
      rampTo(s.out.gain, outside ? LEVEL.siren : LEVEL.siren * dB(-10), t, 0.8);
    }
  }

  stop(): void {
    this.stopSiren(0.2);
  }

  dispose(): void {
    this.stop();
    this.bayEm.dispose();
  }
}

/**
 * Web Audio plumbing for the soundscape: one ambience bus on the AudioContext the NPC voices use
 * (ui/speech.ts), positional emitters, loops and non-positional beds.
 *
 *   sources → emitter (gain → wall low-pass → panner) → bus → limiter → level (setting) → master
 *
 * Emitters pan with 'equalpower' (cheap) unless they ask for HRTF; walls between the listener and
 * the emitter close a low-pass and lower the level, like the voices. An emitter out of range plays
 * nothing, and an idle one disconnects from the bus, so a quiet building costs next to nothing.
 */
import * as THREE from 'three';
import type { Pcm, StereoPcm } from './synth';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Listener extends Vec3 {
  fx: number;
  fy: number;
  fz: number;
}

export const dB = (d: number) => 10 ** (d / 20);

/**
 * Glide a parameter to `value` over `sec` with a ramp that ends. (setTargetAtTime never ends, and
 * Chrome then computes the parameter per sample: per-sample filter coefficients, per-sample panning.)
 */
export function rampTo(p: AudioParam, value: number, t: number, sec: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(value, t + Math.max(0.005, sec));
}

export class Engine {
  readonly ctx: AudioContext;
  /**
   * Sample rate of the rendered sounds: 24 kHz (nothing here has much above 10 kHz), half the
   * memory and synthesis time of 48 kHz; buffer sources resample on playback.
   */
  readonly sr: number;
  /** everything ambient mixes here */
  readonly bus: GainNode;
  /** the player's ambient level */
  readonly level: GainNode;
  private limiter: DynamicsCompressorNode;
  listener: Listener = { x: 0, y: 1.6, z: 0, fx: 0, fy: 0, fz: -1 };
  private buffers = new Map<string, AudioBuffer>();
  /** how many of each event played (tests, the debug hook) */
  readonly counts: Record<string, number> = {};
  /** what each buffer is, and the latest plays: the "What's playing" list (right-click 🎚, or ?sounds=1) */
  private names = new WeakMap<AudioBuffer, string>();
  readonly recent: { name: string; x: number; y: number; z: number; t: number; loop: boolean }[] = [];
  label(b: AudioBuffer, name: string): void {
    this.names.set(b, name);
  }
  note(b: AudioBuffer, pos: Vec3, loop: boolean): void {
    this.recent.push({ name: this.names.get(b) ?? `unnamed sound (${b.duration.toFixed(1)} s)`, x: pos.x, y: pos.y, z: pos.z, t: performance.now(), loop });
    if (this.recent.length > 60) this.recent.shift();
  }
  private ray = new THREE.Ray();
  private hit = new THREE.Vector3();

  constructor(ctx: AudioContext, private master: AudioNode, private occluders: readonly THREE.Box3[]) {
    this.ctx = ctx;
    this.sr = Math.min(ctx.sampleRate, 24000);
    this.bus = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.bus.connect(this.limiter).connect(this.level).connect(master);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  count(event: string): void {
    this.counts[event] = (this.counts[event] ?? 0) + 1;
  }

  setLevel(g: number, sec = 0.6): void {
    rampTo(this.level.gain, g, this.ctx.currentTime, sec);
  }

  private warmQueue: [string, () => Pcm | StereoPcm][] = [];
  private warmTimer = 0;

  /**
   * A sound that will be needed: rendered in idle time (one per idle slice, so walking up to the
   * station never hitches the frame), or at once if it's wanted earlier. Returns its getter.
   */
  sound(key: string, render: () => Pcm | StereoPcm): () => AudioBuffer {
    if (!this.buffers.has(key)) {
      this.warmQueue.push([key, render]);
      this.scheduleWarm();
    }
    return () => this.buffer(key, render);
  }

  private scheduleWarm(): void {
    if (this.warmTimer || !this.warmQueue.length) return;
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = () => {
      this.warmTimer = 0;
      const next = this.warmQueue.shift();
      if (next && !this.buffers.has(next[0])) this.buffer(next[0], next[1]);
      this.scheduleWarm();
    };
    this.warmTimer = ric ? ric(run, { timeout: 2000 }) : (setTimeout(run, 30) as unknown as number);
  }

  /** a rendered sound, cached by key (render runs once, lazily) */
  buffer(key: string, render: () => Pcm | StereoPcm): AudioBuffer {
    let b = this.buffers.get(key);
    if (!b) {
      const pcm = render();
      const chans = Array.isArray(pcm) ? pcm : [pcm];
      b = this.ctx.createBuffer(chans.length, chans[0].length, this.sr);
      chans.forEach((c, i) => b!.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      this.buffers.set(key, b);
      this.names.set(b, key);
    }
    return b;
  }

  /** walls between two points: 0, 1, or 2 (= two or more) */
  walls(a: Vec3, b: Vec3): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.6) return 0;
    this.ray.origin.set(a.x, a.y, a.z);
    this.ray.direction.set(dx / d, dy / d, dz / d);
    let n = 0;
    for (const o of this.occluders) {
      const h = this.ray.intersectBox(o, this.hit);
      if (h && h.distanceTo(this.ray.origin) < d - 0.3 && ++n >= 2) break;
    }
    return n;
  }

  distance(p: Vec3): number {
    const l = this.listener;
    return Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
  }

  dispose(): void {
    try {
      this.level.disconnect();
    } catch {
      /* already */
    }
    this.warmQueue = [];
    this.buffers.clear();
    void this.master;
  }
}

export interface EmitterOpts {
  /** HRTF instead of equal-power panning: voices and the most important point sources only */
  hrtf?: boolean;
  /** inverse-distance reference (m) and roll-off, as PannerNode */
  ref?: number;
  rolloff?: number;
  /** beyond this distance (m) nothing plays */
  range?: number;
  /** walls muffle it (default true) */
  occlude?: boolean;
  /** level (linear) */
  gain?: number;
}

/** one playing buffer with its own gain (fades) */
export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  stop(fade?: number): void;
}

const MUFFLE = [
  { f: 20000, g: 1 },
  { f: 1100, g: 0.5 },
  { f: 480, g: 0.28 },
];

/** A point in the world that sounds come from (a monitor, a phone, an NPC's feet). */
export class Emitter {
  readonly pos: Vec3;
  readonly range: number;
  private input: GainNode;
  private muffle: BiquadFilterNode;
  private panner: PannerNode;
  private connected = false;
  private active = 0;
  private idleSince = 0;
  private wallsAt = 0;
  walls = 0;
  dist = 0;
  private disposed = false;

  constructor(private eng: Engine, pos: Vec3, private opts: EmitterOpts = {}) {
    const c = eng.ctx;
    this.pos = { ...pos };
    this.range = opts.range ?? 30;
    this.input = c.createGain();
    this.input.gain.value = opts.gain ?? 1;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.panner = c.createPanner();
    this.panner.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = opts.ref ?? 1.5;
    this.panner.rolloffFactor = opts.rolloff ?? 1.3;
    this.panner.maxDistance = 80;
    this.setPosition(pos, true);
    this.input.connect(this.muffle).connect(this.panner);
    this.wallsAt = Math.random() * 0.2;
    this.dist = eng.distance(pos);
  }

  /** move it; plain values, not automation, so the panner stays cheap (a few cm per frame is inaudible) */
  setPosition(p: Vec3, _jump = false): void {
    const pos = this.pos;
    if (Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) + Math.abs(p.z - pos.z) < 0.01 && this.placed) return;
    this.placed = true;
    pos.x = p.x;
    pos.y = p.y;
    pos.z = p.z;
    const pn = this.panner;
    if (pn.positionX) {
      pn.positionX.value = p.x;
      pn.positionY.value = p.y;
      pn.positionZ.value = p.z;
    } else (pn as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
  }

  private placed = false;

  /** HRTF while it matters (e.g. an alarming monitor nearby), equal-power otherwise */
  setHrtf(on: boolean): void {
    const m: PanningModelType = on ? 'HRTF' : 'equalpower';
    if (this.panner.panningModel !== m) this.panner.panningModel = m;
  }

  inRange(): boolean {
    return this.dist <= this.range;
  }

  get busy(): boolean {
    return this.active > 0;
  }

  /** distance, walls, and parking; the soundscape calls it ~30× a second */
  update(): void {
    if (this.disposed) return;
    const now = this.eng.now;
    this.dist = this.eng.distance(this.pos);
    if (this.connected && this.active === 0 && now - this.idleSince > 3) {
      this.panner.disconnect();
      this.connected = false;
    }
    if (!this.connected || now < this.wallsAt) return;
    this.wallsAt = now + 0.2;
    const w = this.opts.occlude === false ? 0 : this.eng.walls(this.eng.listener, this.pos);
    if (w !== this.walls) {
      this.walls = w;
      const t = this.eng.ctx.currentTime;
      rampTo(this.muffle.frequency, MUFFLE[w].f, t, 0.25);
      rampTo(this.input.gain, (this.opts.gain ?? 1) * MUFFLE[w].g, t, 0.25);
    }
  }

  private wake(): void {
    if (this.connected) return;
    this.panner.connect(this.eng.bus);
    this.connected = true;
    this.walls = this.opts.occlude === false ? 0 : this.eng.walls(this.eng.listener, this.pos);
    this.muffle.frequency.value = MUFFLE[this.walls].f;
    this.input.gain.value = (this.opts.gain ?? 1) * MUFFLE[this.walls].g;
    this.wallsAt = this.eng.now + 0.2;
  }

  /** play a buffer at audio time `when` (0 = now); null when out of range */
  play(buf: AudioBuffer, when = 0, o: { gain?: number; rate?: number; loop?: boolean; offset?: number; fadeIn?: number; force?: boolean } = {}): Voice | null {
    if (this.disposed || (!o.force && !this.inRange())) return null;
    this.eng.note(buf, this.pos, !!o.loop);
    this.wake();
    const c = this.eng.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!o.loop;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = c.createGain();
    const at = Math.max(c.currentTime, when);
    const level = o.gain ?? 1;
    if (o.fadeIn) {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + o.fadeIn);
    } else g.gain.value = level;
    src.connect(g).connect(this.input);
    this.active++;
    src.onended = () => {
      g.disconnect();
      if (--this.active === 0) this.idleSince = this.eng.now;
    };
    src.start(at, o.offset ? o.offset % buf.duration : 0);
    return {
      src,
      gain: g,
      stop(fade = 0.08) {
        const t = c.currentTime;
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + fade);
          src.stop(t + fade + 0.02);
        } catch {
          /* not started yet or already stopped */
        }
      },
    };
  }

  /** route an arbitrary node (e.g. a live oscillator chain or a media element) into this emitter */
  attach(node: AudioNode): () => void {
    this.wake();
    node.connect(this.input);
    this.active++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try {
        node.disconnect(this.input);
      } catch {
        /* already */
      }
      if (--this.active === 0) this.idleSince = this.eng.now;
    };
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.panner.disconnect();
      this.input.disconnect();
    } catch {
      /* already */
    }
  }
}

/** A looping buffer at an emitter that runs only while the listener is in range (and `on`). */
export class Loop {
  private v: Voice | null = null;
  on = true;

  constructor(readonly em: Emitter, private buf: () => AudioBuffer, public gain = 1, private fade = 0.8) {}

  get playing(): boolean {
    return !!this.v;
  }

  update(): void {
    const want = this.on && this.em.inRange();
    if (want && !this.v) {
      const b = this.buf();
      this.v = this.em.play(b, 0, { loop: true, offset: Math.random() * b.duration, gain: this.gain, fadeIn: this.fade });
    } else if (!want && this.v) {
      this.v.stop(this.fade);
      this.v = null;
    }
  }

  setGain(g: number, tau = 0.5): void {
    this.gain = g;
    if (this.v) rampTo(this.v.gain.gain, g, this.v.src.context.currentTime, tau * 2);
  }

  stop(fade = 0.3): void {
    this.v?.stop(fade);
    this.v = null;
  }
}

/**
 * A non-positional stereo bed (room tone, outdoor air): a loop through a variable low-pass, with an
 * optional "air" band (diffuser hiss) above 2.5 kHz. Silent beds stop their source.
 */
export class Bed {
  private src: AudioBufferSourceNode | null = null;
  private out: GainNode;
  private lp: BiquadFilterNode;
  private main: GainNode;
  private air: GainNode | null = null;
  private hp: BiquadFilterNode | null = null;
  private target = 0;
  private quietSince = 0;

  constructor(private eng: Engine, private buf: () => AudioBuffer, withAir: boolean) {
    const c = eng.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.6;
    this.main = c.createGain();
    this.lp.connect(this.main).connect(this.out);
    if (withAir) {
      this.hp = c.createBiquadFilter();
      this.hp.type = 'highpass';
      this.hp.frequency.value = 2500;
      this.air = c.createGain();
      this.air.gain.value = 0;
      this.hp.connect(this.air).connect(this.out);
    }
    this.out.connect(eng.bus);
  }

  private last = '';

  /** level (linear), low-pass corner (Hz), air band level (linear, relative); cheap to call often */
  set(level: number, lpHz: number, air = 0, tau = 1.2): void {
    const t = this.eng.now;
    const key = `${level.toFixed(4)}|${Math.round(lpHz)}|${air.toFixed(3)}`;
    if (key !== this.last) {
      this.last = key;
      this.target = level;
      rampTo(this.out.gain, level, t, tau * 2.5);
      rampTo(this.lp.frequency, lpHz, t, tau * 2.5);
      if (this.air) rampTo(this.air.gain, air, t, tau * 2.5);
    }
    if (level > 0.0005 && !this.src) {
      const b = this.buf();
      this.eng.note(b, this.eng.listener, true);
      const s = this.eng.ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.connect(this.lp);
      if (this.hp) s.connect(this.hp);
      s.start(0, Math.random() * b.duration);
      this.src = s;
    }
    if (level <= 0.0005) this.quietSince ||= t;
    else this.quietSince = 0;
    // stop the source once it has faded out completely
    if (this.src && this.quietSince && t - this.quietSince > tau * 6) {
      this.src.stop();
      this.src.disconnect();
      this.src = null;
    }
  }

  get level(): number {
    return this.target;
  }

  /** fade out and stop the source now (ambience off) */
  halt(fade = 0.3): void {
    const t = this.eng.now;
    this.last = '';
    this.target = 0;
    rampTo(this.out.gain, 0, t, fade);
    if (this.src) {
      this.src.stop(t + fade + 0.05);
      this.src = null;
    }
    this.quietSince = 0;
  }

  dispose(): void {
    try {
      this.src?.stop();
      this.out.disconnect();
    } catch {
      /* already */
    }
    this.src = null;
  }
}

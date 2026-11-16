/**
 * Spoken ambience through the server's Kokoro TTS (POST /api/tts with priority "background", so
 * it never delays an NPC's reply). Only while NPC voices are on (🔊) and the model is ready; with
 * voices off the rest of the soundscape plays on without it.
 *
 *  - overhead pages: sparse, routine and never a code (codes only when an event asks, via the API),
 *    fewer at night, each said twice by the operator; through a ceiling-speaker chain (band-pass
 *    300 Hz–4.5 kHz, cone resonance, a little amplifier drive) and a short room reverb; they wait
 *    for a gap in NPC speech
 *  - the waiting-room TV: quiet local news and weather, through a TV speaker
 *  - the station radio's host between pieces, and staff answering the phone
 */
import type { LayoutDef } from '../../../shared/layout';
import { anySpeaking, neuralVoicesOn } from '../ui/speech';
import { showTvItem } from '../world/screens';
import { Emitter, dB, rampTo, type Engine, type Vec3 } from './engine';
import { mulberry, roomIR } from './synth';

export interface PageOptions {
  /** Kokoro voice id (default: the operator) */
  voice?: string;
  speed?: number;
  /** times said (default 2, the way operators page); a code is usually said 3 times */
  repeat?: number;
  /** 'stat' jumps the queue and doesn't wait for a gap in conversation */
  priority?: 'routine' | 'stat';
}

const OPERATOR = { voice: 'af_sky', speed: 0.95 };
const TV = { anchor: { voice: 'bm_george', speed: 1 }, weather: { voice: 'bf_lily', speed: 1.02 } };
const LEVEL = { pa: dB(-7), tv: dB(-11), say: dB(-10) };

/** routine overhead pages; names and extensions match nobody in the shifts */
const PAGES_DAY = [
  'Respiratory therapy to the emergency department, please.',
  'Housekeeping to the waiting room, please.',
  'Doctor Lee, please call extension four two one seven.',
  'Patient transport to radiology, please.',
  'Pharmacy, please call extension three three zero five.',
  'Interpreter services, please call the emergency department.',
  'Environmental services to the cafeteria, please.',
  'Doctor Sullivan, please call the operator.',
  'Phlebotomy to the emergency department, please.',
  'Biomedical engineering, please call extension five five one two.',
];
const PAGES_NIGHT = [
  'Respiratory therapy to the emergency department, please.',
  'Doctor Lee, please call extension four two one seven.',
  'Housekeeping to the emergency department, please.',
  'Patient transport, please call extension two two four one.',
  'Doctor Ramirez, please call the operator.',
];

/** a fictional local channel: bland, timeless items (the TV screen shows each headline) */
const TV_LINES: { who: keyof typeof TV; head: string; text: string }[] = [
  { who: 'anchor', head: 'City approves two new bus lines', text: 'Our top story: the city council has approved funding for two new bus lines between the east side and the downtown medical district.' },
  { who: 'anchor', head: 'Route 9 northbound closed overnight', text: 'Road crews will close the northbound lanes of Route Nine near the river bridge overnight for resurfacing. Expect delays until five a.m.' },
  { who: 'anchor', head: 'Flu shots at county clinics', text: 'Health officials remind residents that flu shots are available at pharmacies and community clinics across the county.' },
  { who: 'anchor', head: 'Library winter reading starts Monday', text: 'The public library starts its winter reading program on Monday, with events for children and adults at every branch.' },
  { who: 'anchor', head: 'Home team wins in overtime, 3–2', text: 'In sports, the home team won in overtime last night, three to two, their fourth straight win at home.' },
  { who: 'anchor', head: 'Coming up: the weather', text: "That's a look at the headlines. Now, the weather." },
  { who: 'weather', head: 'Clear tonight, low 41°F', text: 'A cool, clear night ahead, with lows around forty-one degrees and a light breeze from the northwest.' },
  { who: 'weather', head: 'Tomorrow: sun, then clouds, high 56°F', text: 'Tomorrow, sunshine in the morning, clouds building in the afternoon, and a high near fifty-six.' },
  { who: 'weather', head: 'Rain late Saturday, Sunday drier', text: 'Rain moves in late on Saturday, so if you have outdoor plans this weekend, Sunday looks like the better day.' },
];

interface Pending extends Required<Omit<PageOptions, 'priority'>> {
  text: string;
  stat: boolean;
  at: number;
}

export class Spoken {
  private rand = mulberry(131);
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer | null>>();
  private aborter = new AbortController();
  private status = { ok: false, at: -1e9, checking: false };
  private queue: Pending[] = [];
  private paBusyUntil = 0;
  private paFetching = false;
  private nextPageAt = 0;
  private pa: { input: GainNode; out: GainNode; muffle: BiquadFilterNode; connectedUntil: number; outside?: boolean } | null = null;
  private tv?: { em: Emitter; input: GainNode; output: AudioNode; line: number; nextAt: number; busyUntil: number; fetching: boolean };
  private sayEm: Emitter[] = [];
  private disposed = false;
  /** built-in ambiences other systems can switch: the TV, and the routine pages (API pages always play) */
  tvOn = true;
  pagingOn = true;

  constructor(private eng: Engine, layout: LayoutDef) {
    const tv = layout.props.find((p) => p.kind === 'tv' && layout.rooms.find((r) => r.id === p.room)?.kind === 'waiting') ?? layout.props.find((p) => p.kind === 'tv');
    if (tv) {
      const em = new Emitter(eng, { x: tv.x, y: tv.y ?? 2, z: tv.z }, { ref: 2, rolloff: 1.3, range: 18 });
      const c = eng.ctx;
      // a flat-panel TV's small speakers
      const input = c.createGain();
      input.gain.value = LEVEL.tv;
      const pk = filt(c, 'peaking', 2800, 1);
      pk.gain.value = 3;
      const output = filt(c, 'lowpass', 7000, 0.7);
      input.connect(filt(c, 'highpass', 160, 0.7)).connect(pk).connect(output);
      this.tv = { em, input, output, line: 0, nextAt: 0, busyUntil: 0, fetching: false };
    }
    for (let i = 0; i < 2; i++) this.sayEm.push(new Emitter(eng, { x: 0, y: 1.6, z: 0 }, { ref: 1.6, rolloff: 1.3, range: 25 }));
  }

  private between(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  /** neural voices on and the server's model ready (checked at most every 20 s) */
  private ready(perfNow: number): boolean {
    if (!neuralVoicesOn()) return false;
    if (perfNow - this.status.at > 20 && !this.status.checking) {
      this.status.checking = true;
      fetch('/api/tts', { signal: this.aborter.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { status?: string } | null) => (this.status.ok = j?.status === 'ready'))
        .catch(() => (this.status.ok = false))
        .finally(() => {
          this.status.checking = false;
          this.status.at = performance.now() / 1000;
        });
    }
    return this.status.ok;
  }

  /** a synthesized line as an AudioBuffer (cached; null if the server can't) */
  private clip(text: string, voice: string, speed: number): Promise<AudioBuffer | null> {
    const key = `${voice}|${speed}|${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return Promise.resolve(hit);
    }
    let p = this.inflight.get(key);
    if (!p) {
      p = fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice, speed, priority: 'background' }), signal: this.aborter.signal })
        .then(async (r) => (r.ok ? await this.eng.ctx.decodeAudioData(await r.arrayBuffer()) : null))
        .catch(() => null)
        .then((b) => {
          this.inflight.delete(key);
          if (b && !this.disposed) {
            this.cache.set(key, b);
            while (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
          }
          return b;
        });
      this.inflight.set(key, p);
    }
    return p;
  }

  // ───────────────────────────── overhead paging ─────────────────────────────

  /** the ceiling-speaker chain, built on first use; connected to the bus only while a page plays */
  private paChain() {
    if (this.pa) return this.pa;
    const c = this.eng.ctx;
    const input = c.createGain();
    const drive = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
    }
    drive.curve = curve;
    const cone = filt(c, 'peaking', 2300, 1.1);
    cone.gain.value = 5;
    // 24 dB/octave each side: 300 Hz – 4.5 kHz, a small ceiling speaker
    input.connect(filt(c, 'highpass', 300, 0.7)).connect(filt(c, 'highpass', 300, 0.7)).connect(filt(c, 'lowpass', 4500, 0.7)).connect(filt(c, 'lowpass', 4500, 0.7)).connect(cone).connect(drive);
    const out = c.createGain();
    out.gain.value = LEVEL.pa;
    drive.connect(out);
    // the next ceiling speakers down the corridor, and the hard room around them
    for (const [ms, g, pan] of [[23, 0.32, -0.6], [41, 0.22, 0.6]] as const) {
      const d = c.createDelay(0.1);
      d.delayTime.value = ms / 1000;
      const dg = c.createGain();
      dg.gain.value = g;
      const sp = c.createStereoPanner();
      sp.pan.value = pan;
      drive.connect(d).connect(dg).connect(sp).connect(out);
    }
    const verb = c.createConvolver();
    // a ConvolverNode's impulse must be at the context's own rate
    const ir = roomIR(c.sampleRate, mulberry(137), 0.85);
    const irBuf = c.createBuffer(2, ir[0].length, c.sampleRate);
    ir.forEach((ch, i) => irBuf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    verb.buffer = irBuf;
    const wet = c.createGain();
    wet.gain.value = 0.45;
    drive.connect(verb).connect(wet).connect(out);
    // outdoors you hear it faintly through the doors
    const muffle = filt(c, 'lowpass', 20000, 0.5);
    out.connect(muffle);
    this.pa = { input, out, muffle, connectedUntil: 0 };
    return this.pa;
  }

  /** queue an overhead page (the public API's overheadPage) */
  page(text: string, o: PageOptions = {}): void {
    const p: Pending = { text, voice: o.voice ?? OPERATOR.voice, speed: o.speed ?? OPERATOR.speed, repeat: Math.max(1, Math.min(4, o.repeat ?? 2)), stat: o.priority === 'stat', at: performance.now() / 1000 };
    if (p.stat) this.queue.unshift(p);
    else this.queue.push(p);
    if (this.queue.length > 4) this.queue.length = 4;
  }

  private pageFrame(perfNow: number, night: boolean, outside: boolean): void {
    if (!this.nextPageAt) this.nextPageAt = perfNow + this.between(60, 200);
    if (perfNow >= this.nextPageAt) {
      this.nextPageAt = perfNow + (night ? this.between(600, 1200) : this.between(240, 480));
      const pool = night ? PAGES_NIGHT : PAGES_DAY;
      if (this.pagingOn && this.queue.length < 2) this.page(pool[Math.floor(this.rand() * pool.length)]);
    }
    const pa = this.pa;
    if (pa && pa.connectedUntil && this.eng.now > pa.connectedUntil) {
      pa.muffle.disconnect();
      pa.connectedUntil = 0;
    }
    if (pa && pa.outside !== outside) {
      pa.outside = outside;
      rampTo(pa.muffle.frequency, outside ? 900 : 20000, this.eng.now, 0.6);
    }
    const next = this.queue[0];
    if (!next || this.paFetching || this.eng.now < this.paBusyUntil) return;
    if (perfNow - next.at > 90) {
      this.queue.shift(); // stale
      return;
    }
    if (!next.stat && anySpeaking()) return; // wait for a gap in the conversation
    if (!this.ready(perfNow)) return;
    this.paFetching = true;
    void this.clip(next.text, next.voice, next.speed).then((buf) => {
      this.paFetching = false;
      if (this.queue[0] === next) this.queue.shift();
      if (!buf || this.disposed) return;
      const chain = this.paChain();
      if (!chain.connectedUntil) chain.muffle.connect(this.eng.bus);
      const c = this.eng.ctx;
      let at = c.currentTime + 0.1;
      for (let i = 0; i < next.repeat; i++) {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(chain.input);
        src.onended = () => src.disconnect();
        src.start(at);
        at += buf.duration + 0.9;
      }
      chain.connectedUntil = at + 1.5; // the reverb tail, then disconnect (no cost while silent)
      this.eng.count('page');
      this.paBusyUntil = at + 4;
    });
  }

  // ───────────────────────────── TV, radio host, phone pick-ups ─────────────────────────────

  private tvFrame(perfNow: number, night: boolean): void {
    const tv = this.tv;
    if (!tv || !this.tvOn) return;
    tv.em.update();
    if (!tv.em.inRange() || tv.fetching || this.eng.now < tv.busyUntil || perfNow < tv.nextAt) return;
    if (!this.ready(perfNow)) return;
    const line = TV_LINES[tv.line % TV_LINES.length];
    const who = TV[line.who];
    tv.fetching = true;
    void this.clip(line.text, who.voice, who.speed).then((buf) => {
      tv.fetching = false;
      if (!buf || this.disposed || !tv.em.inRange()) {
        tv.nextAt = performance.now() / 1000 + 5;
        return;
      }
      tv.line++;
      const c = this.eng.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(tv.input);
      const detach = tv.em.attach(tv.output);
      src.onended = () => {
        src.disconnect();
        detach();
      };
      tv.input.gain.value = LEVEL.tv * (night ? dB(-3) : 1);
      src.start(c.currentTime + 0.05);
      showTvItem(line.who === 'weather' ? 'weather' : 'news', line.head);
      this.eng.count('tv.line');
      tv.busyUntil = c.currentTime + buf.duration + 0.1;
      // a breath between items; a commercial break after the weather
      const pause = tv.line % TV_LINES.length === 0 ? this.between(25, 45) : this.between(1.2, 3.5);
      tv.nextAt = performance.now() / 1000 + buf.duration + pause;
    });
  }

  /** say a line at a place (a nurse answering the phone, the radio host); returns false if it can't */
  say(text: string, voice: string, at: Vec3 | null, through?: AudioNode, opts: { speed?: number; gain?: number } = {}): boolean {
    const perfNow = performance.now() / 1000;
    if (!this.ready(perfNow)) return false;
    void this.clip(text, voice, opts.speed ?? 1).then((buf) => {
      if (!buf || this.disposed) return;
      const c = this.eng.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = opts.gain ?? LEVEL.say;
      src.connect(g);
      let detach = () => {};
      if (through) g.connect(through);
      else if (at) {
        const em = this.sayEm.find((e) => !e.busy) ?? this.sayEm[0];
        em.setPosition(at, true);
        em.update();
        detach = em.attach(g);
      }
      src.onended = () => {
        g.disconnect();
        detach();
      };
      src.start(c.currentTime + 0.05);
    });
    return true;
  }

  frame(perfNow: number, night: boolean, outside: boolean): void {
    this.pageFrame(perfNow, night, outside);
    this.tvFrame(perfNow, night);
    for (const e of this.sayEm) e.update();
  }

  stop(): void {
    this.queue = [];
    this.aborter.abort();
    this.aborter = new AbortController();
    this.paFetching = false;
    if (this.tv) this.tv.fetching = false;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.pa?.muffle.disconnect();
    this.tv?.em.dispose();
    for (const e of this.sayEm) e.dispose();
    this.cache.clear();
  }
}

function filt(c: BaseAudioContext, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
  const n = c.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

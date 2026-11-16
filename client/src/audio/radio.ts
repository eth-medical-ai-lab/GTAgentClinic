/**
 * The nurses' station radio: a classical station playing public-domain (CC0) recordings — Bach's
 * Goldberg Variations, Kimiko Ishizaka, from scripts/assets/fetch-audio.mjs (credits in
 * client/public/res/audio/radio/CREDITS.txt) — quietly, through a small speaker. The broadcast runs
 * on a virtual timeline, so the piece has moved on when you come back; it only streams (an <audio>
 * element, decoded progressively, never whole in memory) while you are within earshot. Between
 * pieces the host now and then back-announces and gives the time (spoken, so with voices on).
 */
import type { LayoutDef } from '../../../shared/layout';
import { Emitter, dB, rampTo, type Engine } from './engine';
import { mulberry } from './synth';

interface Track {
  file: string;
  title: string;
  durationSec: number;
}

const BASE = '/res/audio/radio/';
const HOST = { voice: 'bm_lewis', speed: 0.92 };
// quiet: background for the people at the station, barely there a room away (a playtest: "a bit less loud")
const LEVEL = { day: dB(-19), night: dB(-22) };
const GAP = 3;
const HOST_GAP = 10;

/** 23:05 → "eleven oh five" */
export function spokenTime(hh: number, mm: number): string {
  const W = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
  const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
  const h = W[hh % 12];
  if (mm === 0) return `${h} o'clock`;
  const m = mm < 10 ? `oh ${W[mm]}` : mm < 20 ? TEENS[mm - 10] : `${TENS[Math.floor(mm / 10)]}${mm % 10 ? `-${W[mm % 10]}` : ''}`;
  return `${h} ${m}`;
}

function show(hh: number): string {
  return hh >= 22 || hh < 6 ? 'Overnight Classics' : hh < 12 ? 'Morning Classics' : hh < 17 ? 'Afternoon Classics' : 'Evening Classics';
}

export class Radio {
  private tracks: Track[] = [];
  private order: number[] = [];
  private epoch = 0;
  private cycle = 0;
  private el: HTMLAudioElement | null = null;
  private media: MediaElementAudioSourceNode | null = null;
  private input: GainNode;
  private output: BiquadFilterNode;
  private em: Emitter | null = null;
  private detach: (() => void) | null = null;
  private loaded = -1;
  private hostSlot = -1;
  /** keep the speaker connected while the host talks (perf s) */
  private holdUntil = 0;
  private failed = false;
  private night = true;
  private lastError = '';
  /** a different running order and a different moment of the broadcast every shift */
  private rand = mulberry(Math.floor(Math.random() * 2 ** 32));

  constructor(private eng: Engine, layout: LayoutDef, private say: (text: string, voice: string, through: AudioNode, speed: number) => boolean) {
    const c = eng.ctx;
    // a small radio: no deep bass, no air, a bit of midrange honk
    this.input = c.createGain();
    this.input.gain.value = LEVEL.night;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    const mid = c.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1500;
    mid.gain.value = 2.5;
    this.output = c.createBiquadFilter();
    this.output.type = 'lowpass';
    this.output.frequency.value = 5000;
    this.input.connect(hp).connect(mid).connect(this.output);
    // on the back counter of the station island, next to a workstation
    const st = layout.rooms.find((r) => r.kind === 'station');
    const pc = layout.props.find((p) => p.id === 'st_pc_6') ?? layout.props.find((p) => p.kind === 'computer' && p.room === st?.id);
    const pos = pc ? { x: pc.x + 0.45, y: (pc.y ?? 1) + 0.12, z: pc.z } : st ? { x: st.rect.x + st.rect.w * 0.7, y: 1.15, z: st.rect.z + st.rect.d - 0.4 } : null;
    if (pos) this.em = new Emitter(eng, pos, { ref: 1.2, rolloff: 1.6, range: 15 });
    void fetch(`${BASE}tracks.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((t: Track[]) => {
        this.tracks = Array.isArray(t) ? t.filter((x) => x.file && x.durationSec > 0) : [];
        this.order = this.tracks.map((_, i) => i).sort(() => this.rand() - 0.5);
        this.cycle = this.order.reduce((s, i, k) => s + this.tracks[i].durationSec + (k % 2 ? HOST_GAP : GAP), 0);
        this.epoch = performance.now() / 1000 - this.rand() * this.cycle;
      })
      .catch(() => (this.failed = true));
  }

  /** where the broadcast is now: a track and an offset, or a gap (k = slot index) */
  private position(perfNow: number): { kind: 'track'; track: number; offset: number } | { kind: 'gap'; slot: number; hostSlot: boolean; prev: number } {
    let p = (perfNow - this.epoch) % this.cycle;
    if (p < 0) p += this.cycle;
    for (let k = 0; k < this.order.length; k++) {
      const t = this.tracks[this.order[k]];
      if (p < t.durationSec) return { kind: 'track', track: this.order[k], offset: p };
      p -= t.durationSec;
      const gap = k % 2 ? HOST_GAP : GAP;
      if (p < gap) return { kind: 'gap', slot: k, hostSlot: k % 2 === 1, prev: this.order[k] };
      p -= gap;
    }
    return { kind: 'gap', slot: -1, hostSlot: false, prev: -1 };
  }

  private element(): HTMLAudioElement | null {
    if (this.el || this.failed) return this.el;
    try {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('error', () => {
        this.lastError = `media error ${el.error?.code ?? '?'}`;
        this.loaded = -1;
      });
      this.media = this.eng.ctx.createMediaElementSource(el);
      this.media.connect(this.input);
      this.el = el;
    } catch {
      this.failed = true;
    }
    return this.el;
  }

  frame(perfNow: number, hh: number, mm: number): void {
    const em = this.em;
    if (!em || !this.cycle || this.failed) return;
    em.update();
    const audible = em.inRange();
    if (!audible) {
      this.pause(perfNow, true);
      return;
    }
    const night = hh >= 22 || hh < 6;
    if (night !== this.night) {
      this.night = night;
      rampTo(this.input.gain, night ? LEVEL.night : LEVEL.day, this.eng.now, 3);
    }
    const pos = this.position(perfNow);
    if (pos.kind === 'gap') {
      this.pause(perfNow);
      // the host back-announces in every other gap (once), if voices are on
      if (pos.hostSlot && this.hostSlot !== pos.slot && pos.prev >= 0) {
        this.hostSlot = pos.slot;
        const t = this.tracks[pos.prev];
        const line = `That was ${t.title} from Bach's Goldberg Variations, played by Kimiko Ishizaka. It's ${spokenTime(hh, mm)}, and this is ${show(hh)}.`;
        this.connect();
        if (this.say(line, HOST.voice, this.input, HOST.speed)) this.holdUntil = perfNow + HOST_GAP + 2;
      }
      return;
    }
    const el = this.element();
    if (!el) return;
    this.connect();
    if (this.loaded !== pos.track) {
      const want = pos.track;
      this.loaded = want;
      this.ready = false;
      this.playing = false;
      void this.urlFor(want).then((url) => {
        if (!url || this.loaded !== want || !this.el) return;
        this.el.src = url;
        this.ready = true;
      });
      // keep this piece and the next one; free the others
      const next = this.order[(this.order.indexOf(want) + 1) % this.order.length];
      void this.urlFor(next);
      for (const [i, p] of this.urls) {
        if (i === want || i === next) continue;
        void p.then((u) => u && URL.revokeObjectURL(u));
        this.urls.delete(i);
      }
    }
    // wait for the metadata, then join the broadcast where it is
    if (!this.ready || el.readyState < 1) return;
    if (Math.abs(el.currentTime - pos.offset) > 2) el.currentTime = pos.offset;
    if (el.paused && !this.playing) {
      this.playing = true;
      void el.play().then(
        () => (this.lastError = ''),
        (e: Error) => {
          this.playing = false;
          this.lastError = `${e.name}: ${e.message}`;
        },
      );
    }
  }

  private connect(): void {
    if (!this.detach && this.em) this.detach = this.em.attach(this.output);
  }

  private urls = new Map<number, Promise<string | null>>();
  private ready = false;

  /**
   * A piece as an object URL: the small compressed file is fetched whole once, so seeking needs no
   * HTTP Range support from the server (Safari insists on it for media URLs).
   */
  private urlFor(i: number): Promise<string | null> {
    let p = this.urls.get(i);
    if (!p) {
      p = fetch(BASE + this.tracks[i].file)
        .then(async (r) => (r.ok ? URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' })) : null))
        .catch(() => null);
      this.urls.set(i, p);
    }
    return p;
  }

  private playing = false;

  private pause(perfNow: number, now = false): void {
    this.playing = false;
    if (this.el && !this.el.paused) this.el.pause();
    // the speaker chain stays attached while the host talks; detached, it costs nothing
    if (this.detach && (now || perfNow > this.holdUntil)) {
      this.detach();
      this.detach = null;
    }
  }

  /** for tests / the debug hook */
  stats(): { playing: boolean; track: string | null; tracks: number; error?: string; at?: number; broadcast?: string } {
    const pos = this.cycle ? this.position(performance.now() / 1000) : null;
    return {
      playing: !!this.el && !this.el.paused,
      track: this.loaded >= 0 ? this.tracks[this.loaded]?.file ?? null : null,
      tracks: this.tracks.length,
      at: this.el ? Math.round(this.el.currentTime) : undefined,
      broadcast: pos ? (pos.kind === 'track' ? `${this.tracks[pos.track].file} @${Math.round(pos.offset)} s` : 'between pieces') : undefined,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  stop(): void {
    this.pause(0, true);
  }

  dispose(): void {
    this.stop();
    if (this.el) {
      this.el.removeAttribute('src');
      this.el.load();
    }
    this.media?.disconnect();
    this.em?.dispose();
    this.el = null;
    for (const p of this.urls.values()) void p.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

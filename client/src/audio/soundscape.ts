/**
 * GTAgentClinic soundscape: the emergency department's ambient sound, positional and muffled by
 * walls like the NPC voices, on the same AudioContext and listener (ui/speech.ts).
 *
 *   monitors.ts  bedside monitors: QRS tone pitched by SpO₂, IEC 60601-1-8 alarms, NIBP cycles
 *   ambience.ts  HVAC room tone per room type, outdoor air, equipment hum (vending, fridges, CT…)
 *   life.ts      phones, printers, infusion pumps, typing, nurse call, tube station, distant carts
 *   movement.ts  footsteps (player and NPCs, surface-aware) and the automatic sliding doors
 *   outside.ts   distant sirens (passing, or approaching until switched off), ambulance arrivals
 *   spoken.ts    overhead pages, the waiting-room TV, phone pick-ups (Kokoro TTS; needs voices on)
 *   radio.ts     the station radio: CC0 recordings, on a virtual broadcast timeline
 *
 * It starts with the first click (the browser's autoplay rule), follows the HUD's 🎚 setting
 * (Off / Low / Med / High, saved in this browser; independent of the 🔊 voice toggle), and idles
 * cheaply: sources beyond earshot are parked, the context is suspended while the tab is hidden,
 * and with ambience and voices both off it is suspended too.
 *
 * ─────────────────────────── API for other systems ───────────────────────────
 * Safe to call at any time: before the world starts (or with ambience off) calls are no-ops,
 * except startAmbience, which is remembered.
 *
 *   import { playSound, startAmbience, stopAmbience, overheadPage } from '../audio/soundscape';
 *
 *   const h = playSound(sound, opts?)          → SoundHandle { stop(fadeSec?), setGain(g), playing }
 *     sound   a built-in name (BUILTIN_SOUNDS below: 'phone.mobile', 'phone.vibrate', 'earbuds',
 *             'thud', 'footstep.run', 'door.close', 'cart', 'siren.approach', …),
 *             { url: '/res/audio/…' } (any file the browser decodes; fetched and cached once),
 *             or an AudioBuffer
 *     opts.at    { x, y?, z }  a point in the world (m; y defaults to 1.2)
 *     opts.npc   'vis_4'       follow that NPC's head (muffled by walls like their voice)
 *     opts.loop  true          repeat until h.stop() (looped built-ins include their pauses)
 *     opts.gain  1             linear, relative to the built-in's natural level
 *     opts.rate  1             playback rate (pitch)
 *     opts.range 30            audible radius (m); beyond it nothing plays (and costs nothing)
 *     opts.hrtf  false         HRTF panning: only for the few sources whose direction matters
 *     opts.delay 0             seconds from now
 *     No `at`/`npc`: plays at the listener (non-positional), e.g. a sting.
 *
 *   startAmbience(name, spec?)   a named, continuous sound. Built-ins run by themselves and can be
 *                                switched: 'radio', 'tv', 'traffic', 'hvac', 'paging'. Your own:
 *                                startAmbience('waiting-murmur', { sound: { url }, at: { x: 5, z: 19 }, gain: 0.8 })
 *   stopAmbience(name, fadeSec = 1.5)
 *
 *   overheadPage(text, { voice?, speed?, repeat = 2, priority: 'routine' | 'stat' })
 *     Spoken by the operator through the ceiling-speaker chain (voices on). Routine pages wait for
 *     a gap in NPC speech; 'stat' doesn't. Never page a code unless an event calls for one:
 *       overheadPage('Code Blue, emergency department, waiting room.', { priority: 'stat', repeat: 3 })
 */
import type * as THREE from 'three';
import { roomById, type LayoutDef } from '../../../shared/layout';
import type { NpcView, PlayerView } from '../../../shared/types';
import { clockAt } from '../../../shared/types';
import { store } from '../store';
import { anySpeaking, castVoiceOf, sharedAudio } from '../ui/speech';
import { alarmTone, burstLength } from './clinical';
import { Ambience } from './ambience';
import { Emitter, Engine, dB, rampTo, type Listener, type Vec3, type Voice } from './engine';
import { Life } from './life';
import { Monitors } from './monitors';
import { Movement } from './movement';
import { Outside, type SirenKind } from './outside';
import { Radio } from './radio';
import { AMBIENT_GAIN, ambientLevel, onAmbientLevel, type AmbientLevel } from './settings';
import { Spoken, type PageOptions } from './spoken';
import { showTvItem } from '../world/screens';
import * as S from './synth';
import * as IS from './imagingSounds';

export type { PageOptions } from './spoken';

export type SoundSource = string | { url: string } | AudioBuffer;

export interface PlayOptions {
  at?: { x: number; y?: number; z: number };
  npc?: string;
  loop?: boolean;
  gain?: number;
  rate?: number;
  range?: number;
  hrtf?: boolean;
  delay?: number;
  /** what an AudioBuffer of your own is, for the "What's playing" list (right-click 🎚) */
  name?: string;
}

export interface SoundHandle {
  stop(fadeSec?: number): void;
  setGain(gain: number): void;
  readonly playing: boolean;
}

export interface AmbienceSpec {
  sound: SoundSource;
  at?: { x: number; y?: number; z: number };
  npc?: string;
  gain?: number;
  range?: number;
}

/** what the 3D world gives the soundscape (World.ts) */
export interface WorldProbe {
  /** wall boxes, as for the voices' muffling */
  occluders: readonly THREE.Box3[];
  /** every NPC: its view, floor position (m), head height, and whether it is walking */
  eachNpc(fn: (v: NpcView, x: number, z: number, headY: number, moving: boolean) => void): void;
}

type Render = (sr: number, rand: S.Rand) => S.Pcm;
const pad = (x: S.Pcm, sr: number, sec: number): S.Pcm => {
  const out = new Float32Array(x.length + Math.round(sec * sr));
  out.set(x);
  return out;
};

/** built-in sounds: renderer and natural level (dB re full scale before distance) */
export const BUILTIN_SOUNDS: Record<string, { render: Render; db: number; note: string }> = {
  'phone.desk': { render: (sr) => pad(S.deskRing(sr), sr, 4), db: -18, note: 'desk phone, one 2 s ring + 4 s pause (loop it)' },
  'phone.mobile': { render: (sr, r) => pad(S.mobileRing(sr, r), sr, 1.2), db: -24, note: 'generic mobile ringtone (loop it)' },
  'phone.vibrate': { render: (sr, r) => pad(S.vibrate(sr, r), sr, 1.1), db: -28, note: 'a phone buzzing on a hard surface (loop it)' },
  'phone.pickup': { render: (sr, r) => S.handset(sr, r, false), db: -30, note: 'handset lifted' },
  'phone.hangup': { render: (sr, r) => S.handset(sr, r, true), db: -30, note: 'handset put down' },
  pager: { render: (sr) => pad(S.pumpBeeps(sr), sr, 0.4), db: -30, note: 'a pager / badge chirp' },
  footstep: { render: (sr, r) => S.footstep(sr, r, 'vinyl'), db: -29, note: 'one step on sheet vinyl' },
  'footstep.run': { render: (sr, r) => S.footstep(sr, r, 'vinyl', true), db: -26, note: 'one running step' },
  'door.slide.open': { render: (sr, r) => S.slidingDoor(sr, r, true), db: -24, note: 'automatic door opening' },
  'door.slide.close': { render: (sr, r) => S.slidingDoor(sr, r, false), db: -25, note: 'automatic door closing' },
  'door.close': { render: (sr, r) => S.doorClose(sr, r), db: -26, note: 'swing door closing' },
  printer: { render: (sr, r) => S.printerJob(sr, r), db: -29, note: 'laser printer job' },
  labels: { render: (sr, r) => S.labelPrinter(sr, r), db: -31, note: 'specimen-label printer' },
  'pump.alarm': { render: (sr) => pad(S.pumpBeeps(sr), sr, 2.2), db: -27, note: 'infusion-pump alert (loop it)' },
  'alarm.high': { render: (sr) => pad(S.alarmBurst(sr, alarmTone('high')), sr, alarmTone('high').interburst - 0.02), db: -13, note: 'IEC high-priority burst + interburst (loop it)' },
  'alarm.medium': { render: (sr) => pad(S.alarmBurst(sr, alarmTone('medium')), sr, alarmTone('medium').interburst - 0.02), db: -17, note: 'IEC medium-priority burst (loop it)' },
  nibp: { render: (sr, r) => S.nibpCycle(sr, r), db: -30, note: 'NIBP cuff cycle (~26 s)' },
  keyboard: { render: (sr, r) => S.typing(sr, r), db: -33, note: 'typing (~6 s)' },
  earbuds: { render: (sr, r) => S.earbuds(sr, r), db: -30, note: 'music leaking from earbuds (loop it)' },
  thud: { render: (sr, r) => S.thud(sr, r), db: -20, note: 'a body or a bag hitting the floor' },
  cart: { render: (sr, r) => S.cartRoll(sr, r), db: -27, note: 'cart / stretcher rolling past' },
  'nurse.call': { render: (sr) => S.nurseCall(sr), db: -27, note: 'nurse-call chime' },
  tube: { render: (sr, r) => S.tubeArrival(sr, r), db: -27, note: 'pneumatic-tube carrier arriving' },
  'reverse.beeper': { render: (sr) => S.reverseBeep(sr), db: -25, note: 'vehicle reversing alarm (loop it)' },
  // the CT scanner and the X-ray room (imagingSounds.ts; played by world/imagingLife.ts)
  'ct.spin': { render: (sr, r) => IS.ctSpin(sr, r), db: -27, note: 'CT gantry rotating (loop it)' },
  'ct.xray': { render: (sr, r) => IS.ctXray(sr, r), db: -36, note: 'CT tube during an exposure (loop it)' },
  'ct.table': { render: (sr, r) => IS.ctTable(sr, r), db: -33, note: 'CT couch moving (loop it)' },
  'scan.beep': { render: (sr) => IS.scanBeep(sr), db: -30, note: 'console tone at the start of an exposure' },
  'xray.expose': { render: (sr, r) => IS.xrayExpose(sr, r), db: -27, note: 'X-ray exposure: anode spin-up, exposure tone, spin-down' },
  'siren.pass': { render: () => new Float32Array(1), db: 0, note: 'a siren passing in the distance (outside)' },
  'siren.approach': { render: () => new Float32Array(1), db: 0, note: 'a siren approaching, switched off a block away' },
};

const BUILTIN_AMBIENCE = ['radio', 'tv', 'traffic', 'hvac', 'paging'] as const;
type BuiltinAmbience = (typeof BUILTIN_AMBIENCE)[number];

interface ApiSound {
  em: Emitter;
  voice: Voice | null;
  buf: AudioBuffer | null;
  npc?: string;
  /** at the listener (non-positional) */
  self: boolean;
  loop: boolean;
  gain: number;
  rate: number;
  /** audio time to start a one-shot */
  at: number;
  done: boolean;
}

const ANSWER: Record<string, string> = { station: 'Emergency department', workroom: 'Physician workroom' };
const BYE = ['Okay. Thanks, bye.', "Sure, I'll let them know. Bye.", 'Got it. Bye-bye.', 'Okay, will do. Thanks.'];

let active: Soundscape | null = null;
/** startAmbience/stopAmbience calls, replayed when a soundscape starts */
const wantedAmbience = new Map<string, AmbienceSpec | 'on' | 'off'>();
const isBuiltin = (name: string): name is BuiltinAmbience => (BUILTIN_AMBIENCE as readonly string[]).includes(name);

export class Soundscape {
  private eng: Engine | null = null;
  private monitors!: Monitors;
  private ambience!: Ambience;
  private life!: Life;
  private movement!: Movement;
  private outside!: Outside;
  private spoken!: Spoken;
  private radio!: Radio;
  private lastView: PlayerView | null = null;
  private level: AmbientLevel = ambientLevel();
  private gameT = 0;
  private hh = 22;
  private mm = 0;
  private night = true;
  private npcPos = new Map<string, Vec3>();
  private sounds = new Set<ApiSound>();
  private named = new Map<string, SoundHandle>();
  private disabled = new Set<BuiltinAmbience>();
  private urlBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private seenEms = new Set<string>();
  /** the first view only records who is already here */
  private emsPrimed = false;
  private emsAt = -1e9;
  private lastPanelBay: string | null = null;
  private pendingSay: { at: number; text: string; voice: string; pos: Vec3 }[] = [];
  private unsubs: (() => void)[] = [];
  /** main-thread cost of the last 150 frames (ms) */
  private frameTimes = new Float32Array(150);
  private tick = 0;
  private resuming = false;
  /** sound frames per second (World calls ~30/s when it renders fast enough) */
  private rate = 30;
  private lastFrame = 0;
  private gap = 0.033;
  private started = false;
  private disposed = false;

  constructor(private layout: LayoutDef, private probe: WorldProbe) {
    active = this;
    this.unsubs.push(onAmbientLevel(() => this.applyLevel()));
    this.unsubs.push(
      store.subscribe(() => {
        // opening a bedside monitor = its alarm-pause key
        const p = store.get().panel;
        const bay = p?.kind === 'monitor' ? p.bay : null;
        if (bay && bay !== this.lastPanelBay) this.monitors?.acknowledge(bay, performance.now() / 1000);
        this.lastPanelBay = bay;
      }),
    );
    const onVis = () => this.onVisibility();
    document.addEventListener('visibilitychange', onVis);
    this.unsubs.push(() => document.removeEventListener('visibilitychange', onVis));
    // Safari may refuse a resume() outside a gesture: retry on the next one
    const onGesture = () => {
      const ctx = this.eng?.ctx;
      if (ctx && ctx.state === 'suspended' && !document.hidden && this.wantsContext()) void ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    this.unsubs.push(() => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    });
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /** build the graph once the shared context runs (after the first click) and ambience is on */
  private start(): boolean {
    if (this.eng) return true;
    if (this.level === 'off') return false;
    const a = sharedAudio(false);
    if (!a) return false;
    if (a.ctx.state !== 'running') {
      // asleep from an earlier "off" (or another world): wake it; we start on a later frame
      if (a.ctx.state === 'suspended' && !document.hidden && !this.resuming) {
        this.resuming = true;
        void a.ctx.resume().finally(() => (this.resuming = false));
      }
      return false;
    }
    const eng = new Engine(a.ctx, a.master, this.probe.occluders);
    this.eng = eng;
    const perfToCtx = (p: number) => this.perfToCtx(p);
    this.monitors = new Monitors(eng, this.layout, perfToCtx);
    this.ambience = new Ambience(eng, this.layout);
    this.movement = new Movement(eng, this.layout);
    this.ambience.setDoorProbe((pos) => this.movement.doorOpenAt(pos));
    this.spoken = new Spoken(eng, this.layout);
    this.life = new Life(eng, this.layout, (who, at, place) => this.answered(who, at, place));
    this.outside = new Outside(eng, this.layout);
    this.radio = new Radio(eng, this.layout, (text, voice, through, speed) => this.spoken.say(text, voice, null, through, { speed, gain: 1 }));
    this.started = true;
    if (this.lastView) this.setView(this.lastView);
    for (const [name, want] of wantedAmbience) {
      if (want === 'off') this.stopAmbience(name, 0);
      else this.startAmbience(name, want === 'on' ? undefined : want);
    }
    this.applyLevel();
    return true;
  }

  /** audio-clock time at which a sound is heard at performance time `perfSec` */
  private perfToCtx(perfSec: number): number {
    const ctx = this.eng!.ctx;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime && ts.performanceTime) return Math.max(ctx.currentTime, ts.contextTime + (perfSec * 1000 - ts.performanceTime) / 1000);
    return Math.max(ctx.currentTime, ctx.currentTime + perfSec - performance.now() / 1000 - (ctx.outputLatency || ctx.baseLatency || 0));
  }

  private wantsContext(): boolean {
    return this.level !== 'off' || !!store.get().view?.settings.tts || anySpeaking();
  }

  private applyLevel(): void {
    this.level = ambientLevel();
    const eng = this.eng;
    if (!eng) {
      const ctx = sharedAudio(false)?.ctx;
      if (ctx && this.level !== 'off' && ctx.state === 'suspended' && !document.hidden) void ctx.resume().catch(() => {});
      return;
    }
    eng.setLevel(AMBIENT_GAIN[this.level]);
    if (this.level === 'off') {
      this.stopLayers();
      // nothing else needs the audio thread: let it sleep
      if (!this.wantsContext()) setTimeout(() => !this.disposed && !this.wantsContext() && eng.ctx.state === 'running' && void eng.ctx.suspend(), 600);
    } else if (eng.ctx.state === 'suspended' && !document.hidden) void eng.ctx.resume().catch(() => {});
  }

  private onVisibility(): void {
    const ctx = this.eng?.ctx ?? sharedAudio(false)?.ctx;
    if (!ctx) return;
    if (document.hidden) {
      this.stopLayers(); // nothing half-played when you come back
      if (ctx.state === 'running') void ctx.suspend();
    } else if (ctx.state === 'suspended' && this.wantsContext()) void ctx.resume().catch(() => {});
  }

  private stopLayers(): void {
    if (!this.started) return;
    this.monitors.dispose();
    this.monitors = new Monitors(this.eng!, this.layout, (p) => this.perfToCtx(p));
    if (this.lastView) this.monitors.view(this.lastView.monitors, this.gameT);
    this.ambience.stop();
    this.life.stop();
    this.outside.stop();
    this.spoken.stop();
    this.radio.stop();
    // loops restart by themselves when the sound comes back; one-shots are over
    for (const s of this.sounds) {
      s.voice?.stop(0.1);
      s.voice = null;
      if (!s.loop) this.drop(s);
    }
  }

  private drop(s: ApiSound): void {
    s.done = true;
    s.voice?.stop(0.1);
    s.voice = null;
    s.em.dispose();
    this.sounds.delete(s);
  }

  // ───────────────────────────── per frame (World.ts, ~30 Hz) ─────────────────────────────

  frame(nowMs: number, listener: Listener, me: { y: number; grounded: boolean; rolling?: boolean }): void {
    if (this.disposed || this.level === 'off' || document.hidden) return;
    if (!this.start()) return;
    const eng = this.eng!;
    if (eng.ctx.state !== 'running') return;
    const t0 = performance.now();
    const perfNow = nowMs / 1000;
    eng.listener = listener;
    this.npcPos.clear();
    this.probe.eachNpc((v, x, z, y) => v.visible && this.npcPos.set(v.id, { x, y, z }));
    const each = this.probe.eachNpc;
    // beats, steps and moving sources every frame; the slow layers 10, 5 or 4 times a second
    const tick = ++this.tick;
    if (tick % 3 === 0) this.ambience.frame(perfNow, this.hh + this.mm / 60, this.night);
    const outside = this.ambience.isOutside;
    this.monitors.frame(perfNow, this.gameT, this.night, this.gap);
    this.movement.frame(perfNow, { x: listener.x, z: listener.z, y: me.y, grounded: me.grounded, rolling: me.rolling }, each);
    if (tick % 3 === 1) this.life.frame(perfNow, this.night, !outside, each);
    if (tick % 6 === 2) this.outside.frame(perfNow, this.night, outside);
    if (tick % 6 === 5) {
      this.spoken.frame(perfNow, this.night, outside);
      for (const p of this.pendingSay.splice(0)) {
        if (p.at > perfNow) this.pendingSay.push(p);
        else this.spoken.say(p.text, p.voice, p.pos);
      }
    }
    if (tick % 8 === 4) {
      if (!this.disabled.has('radio')) this.radio.frame(perfNow, this.hh, this.mm);
      else this.radio.stop();
    }
    this.apiFrame();
    this.frameTimes[tick % this.frameTimes.length] = performance.now() - t0;
    const gap = this.lastFrame ? (nowMs - this.lastFrame) / 1000 : 0.033;
    this.rate += (1 / Math.max(0.001, gap) - this.rate) * 0.05;
    // the longest recent gap, decaying over a few seconds
    this.gap = Math.max(gap, this.gap * 0.985);
    this.lastFrame = nowMs;
  }

  private apiFrame(): void {
    const eng = this.eng!;
    for (const s of this.sounds) {
      if (s.done) continue;
      if (s.npc) {
        const p = this.npcPos.get(s.npc);
        if (p) s.em.setPosition(p);
        else if (!s.loop && !s.voice) {
          this.drop(s);
          continue;
        }
      } else if (s.self) {
        const l = eng.listener;
        s.em.setPosition({ x: l.x, y: l.y, z: l.z }, true);
      }
      s.em.update();
      if (!s.buf) continue;
      if (s.loop) {
        if (s.em.inRange() && !s.voice) s.voice = s.em.play(s.buf, 0, { loop: true, gain: s.gain, rate: s.rate, fadeIn: 0.4, offset: Math.random() * s.buf.duration });
        else if (!s.em.inRange() && s.voice) {
          s.voice.stop(0.4);
          s.voice = null;
        }
      } else if (!s.voice) {
        s.voice = s.em.play(s.buf, Math.max(eng.now, s.at), { gain: s.gain, rate: s.rate });
        if (!s.voice) this.drop(s);
        else s.voice.src.addEventListener('ended', () => this.drop(s));
      }
    }
  }

  // ───────────────────────────── the server's view ─────────────────────────────

  view(v: PlayerView): void {
    this.lastView = v;
    if (this.started) this.setView(v);
  }

  private setView(v: PlayerView): void {
    this.gameT = v.t;
    const [hh, mm] = clockAt(v.clockStart, v.t).split(':').map(Number);
    this.hh = hh;
    this.mm = mm;
    this.night = hh >= 20 || hh < 7;
    this.monitors.view(v.monitors, v.t);
    this.life.setView(v, store.get().charts);
    // an EMS crew walking in: their ambulance is in the bay
    const ems = new Set<string>();
    for (const n of v.npcs) if (n.role === 'ems' && n.visible) ems.add(n.id);
    const now = performance.now() / 1000;
    for (const id of ems) {
      if (this.emsPrimed && !this.seenEms.has(id) && now - this.emsAt > 60 && this.level !== 'off') {
        this.emsAt = now;
        this.outside.ambulanceArrived(now);
      }
    }
    this.seenEms = ems;
    this.emsPrimed = true;
  }

  /** a nurse, clerk or doctor picked up a ringing desk phone: say hello in their own voice */
  private answered(who: NpcView, at: Vec3, place: string): number | void {
    const voice = castVoiceOf(who.id);
    if (!voice) return;
    const doctor = /^Dr\.?\s/.test(who.name) || who.role === 'attending' || who.role === 'resident';
    const parts = who.name.replace(/^Dr\.?\s+/, '').split(/\s+/);
    const where = ANSWER[roomById(this.layout, place)?.kind === 'station' ? 'station' : place] ?? 'Emergency department';
    const hello = doctor ? `${where}, this is Doctor ${parts[parts.length - 1]}.` : `${where}, this is ${parts[0]}.`;
    const pos = { x: at.x, y: 1.5, z: at.z };
    const perfNow = performance.now() / 1000;
    if (!this.spoken.say(hello, voice, pos)) return;
    const len = 9 + Math.random() * 14;
    this.pendingSay.push({ at: perfNow + len, text: BYE[Math.floor(Math.random() * BYE.length)], voice, pos });
    return len + 2.5;
  }

  // ───────────────────────────── API ─────────────────────────────

  private bufferFor(src: SoundSource, name?: string): Promise<AudioBuffer | null> | AudioBuffer | null {
    const eng = this.eng!;
    if (src instanceof AudioBuffer) {
      if (name) eng.label(src, name);
      return src;
    }
    if (typeof src === 'string') {
      const b = BUILTIN_SOUNDS[src];
      if (!b) {
        console.warn(`[sound] unknown built-in sound "${src}"`);
        return null;
      }
      return eng.buffer(`api:${src}`, () => S.normalize(b.render(eng.sr, S.mulberry(src.length * 7919)), 0.9));
    }
    let p = this.urlBuffers.get(src.url);
    if (!p) {
      const fileName = src.url.split('?')[0].split('/').pop() ?? src.url;
      p = fetch(src.url)
        .then(async (r) => {
          if (!r.ok) return null;
          const b = await eng.ctx.decodeAudioData(await r.arrayBuffer());
          eng.label(b, `file ${fileName}`);
          return b;
        })
        .catch(() => null);
      this.urlBuffers.set(src.url, p);
    }
    return p;
  }

  play(src: SoundSource, o: PlayOptions = {}): SoundHandle {
    const dead: SoundHandle = { stop() {}, setGain() {}, playing: false };
    if (!this.started || this.level === 'off' || this.disposed) return dead;
    const eng = this.eng!;
    if (src === 'siren.pass' || src === 'siren.approach') {
      this.outside.startSiren(src === 'siren.pass' ? 'pass' : ('approach' as SirenKind));
      return { stop: () => this.outside.stop(), setGain() {}, playing: true };
    }
    const builtin = typeof src === 'string' ? BUILTIN_SOUNDS[src] : undefined;
    const self = !o.at && !o.npc;
    const pos = o.at ? { x: o.at.x, y: o.at.y ?? 1.2, z: o.at.z } : (o.npc && this.npcPos.get(o.npc)) || { ...eng.listener };
    const em = new Emitter(eng, pos, { hrtf: !!o.hrtf, ref: 1.2, rolloff: self ? 0 : 1.3, range: self ? 1e9 : o.range ?? 30, occlude: !self });
    const s: ApiSound = { em, voice: null, buf: null, npc: o.npc, self, loop: !!o.loop, gain: (o.gain ?? 1) * dB(builtin?.db ?? -20), rate: o.rate ?? 1, at: eng.now + (o.delay ?? 0), done: false };
    const b = this.bufferFor(src, o.name);
    if (!b) {
      em.dispose();
      return dead;
    }
    if (b instanceof AudioBuffer) s.buf = b;
    else void b.then((buf) => (buf && !s.done ? (s.buf = buf) : this.drop(s)));
    this.sounds.add(s);
    return {
      stop: (fade = 0.15) => {
        s.voice?.stop(fade);
        s.voice = null;
        s.done = true;
        setTimeout(() => this.drop(s), fade * 1000 + 200);
      },
      setGain: (g: number) => {
        s.gain = g * dB(builtin?.db ?? -20);
        if (s.voice) rampTo(s.voice.gain.gain, s.gain, eng.now, 0.2);
      },
      get playing() {
        return !s.done && !!s.voice;
      },
    };
  }

  startAmbience(name: string, spec?: AmbienceSpec): void {
    if (isBuiltin(name)) {
      this.disabled.delete(name);
      this.applyBuiltins();
      return;
    }
    if (!spec) return;
    this.named.get(name)?.stop(0.5);
    this.named.set(name, this.play(spec.sound, { at: spec.at, npc: spec.npc, gain: spec.gain, range: spec.range, loop: true }));
  }

  stopAmbience(name: string, fade = 1.5): void {
    if (isBuiltin(name)) {
      this.disabled.add(name);
      this.applyBuiltins();
      return;
    }
    this.named.get(name)?.stop(fade);
    this.named.delete(name);
  }

  private applyBuiltins(): void {
    if (!this.started) return;
    this.ambience.hvacOn = !this.disabled.has('hvac');
    this.ambience.trafficOn = !this.disabled.has('traffic');
    this.spoken.tvOn = !this.disabled.has('tv');
    this.spoken.pagingOn = !this.disabled.has('paging');
  }

  page(text: string, o?: PageOptions): void {
    if (this.started && this.level !== 'off') this.spoken.page(text, o);
  }

  /** the latest sounds within `windowMs`: buffer name, seconds ago, metres from you */
  recent(windowMs: number): { name: string; ago: number; dist: number; loop: boolean }[] {
    const eng = this.eng;
    if (!eng) return [];
    const now = performance.now();
    const l = eng.listener;
    return eng.recent.filter((r) => now - r.t < windowMs).map((r) => ({ name: r.name, ago: (now - r.t) / 1000, dist: Math.hypot(r.x - l.x, r.y - l.y, r.z - l.z), loop: r.loop }));
  }

  stats() {
    const eng = this.eng;
    return {
      started: this.started,
      context: eng?.ctx.state ?? sharedAudio(false)?.ctx.state ?? 'none',
      level: this.level,
      room: this.started ? this.ambience.current?.id ?? (this.ambience.isOutside ? 'outside' : null) : null,
      night: this.night,
      monitors: this.started ? this.monitors.stats(performance.now() / 1000) : [],
      radio: this.started ? this.radio.stats() : null,
      doors: this.started ? this.movement.doorStates() : [],
      apiSounds: this.sounds.size,
      counts: { ...(eng?.counts ?? {}) },
      ...this.frameCost(),
      framesPerSec: +this.rate.toFixed(1),
    };
  }

  /** median and worst main-thread ms per sound frame (the frame runs ~30× a second) */
  private frameCost(): { frameMs: number; frameMsMax: number } {
    const n = Math.min(this.tick, this.frameTimes.length);
    if (!n) return { frameMs: 0, frameMsMax: 0 };
    const a = Array.from(this.frameTimes.subarray(0, n)).sort((x, y) => x - y);
    return { frameMs: +a[Math.floor(n / 2)].toFixed(3), frameMsMax: +a[n - 1].toFixed(3) };
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    if (this.started) {
      this.monitors.dispose();
      this.ambience.dispose();
      this.life.dispose();
      this.movement.dispose();
      this.outside.dispose();
      this.spoken.dispose();
      this.radio.dispose();
      for (const s of [...this.sounds]) this.drop(s);
      this.eng!.dispose();
    }
    if (active === this) active = null;
  }
}

/** World.ts: one soundscape per 3D world */
export function createSoundscape(layout: LayoutDef, probe: WorldProbe): Soundscape {
  active?.dispose();
  return new Soundscape(layout, probe);
}

// ───────────────────────────── public API (module level) ─────────────────────────────

/** Play a built-in sound, a file ({ url }) or an AudioBuffer at a point, on an NPC, or at the listener. */
export function playSound(sound: SoundSource, opts?: PlayOptions): SoundHandle {
  return active ? active.play(sound, opts) : { stop() {}, setGain() {}, playing: false };
}

/** Start a named ambience: a built-in ('radio', 'tv', 'traffic', 'hvac', 'paging') or your own looping sound. */
export function startAmbience(name: string, spec?: AmbienceSpec): void {
  if (isBuiltin(name)) wantedAmbience.set(name, 'on');
  else if (spec) wantedAmbience.set(name, spec);
  active?.startAmbience(name, spec);
}

/** Stop a named ambience (built-ins stay off until started again). */
export function stopAmbience(name: string, fadeSec = 1.5): void {
  if (isBuiltin(name)) wantedAmbience.set(name, 'off');
  else wantedAmbience.delete(name);
  active?.stopAmbience(name, fadeSec);
}

/** An overhead page through the PA (operator's voice, said twice). Codes only when an event calls for one. */
export function overheadPage(text: string, opts?: PageOptions): void {
  active?.page(text, opts);
}

/** what the engine's buffer names stand for, in words (the "What's playing" list) */
const SOUND_NAMES: [RegExp, string][] = [
  [/^nibp$/, 'BP cuff pump (bedside monitor, every 15 game min)'],
  [/^alarm:high$/, 'monitor alarm, high priority'],
  [/^alarm:medium$/, 'monitor alarm, medium priority'],
  [/^qrs:/, 'monitor beep (heartbeat tone)'],
  [/^bed:hvac$/, 'room tone (ventilation)'],
  [/^bed:outdoor$/, 'outdoor ambience'],
  [/^door:(open|close)$/, 'automatic sliding door'],
  [/^swing:/, 'swing door'],
  [/^thud$/, 'door closing (thud)'],
  [/^cart:/, 'cart or stretcher wheels'],
  [/^step:/, 'footsteps'],
  [/^typing:/, 'keyboard typing'],
  [/^hum:vending$/, 'vending machine hum'],
  [/^hum:fridge$/, 'fridge hum'],
  [/^hum:ct$/, 'CT scanner hum'],
  [/^hum:pc$/, 'computer fan'],
  [/^hum:exhaust$/, 'exhaust fan'],
  [/^ring:/, 'desk phone ringing'],
  [/^(pickup|hangup)$/, 'phone handset'],
  [/^labels$/, 'label printer'],
  [/^printer$/, 'printer'],
  [/^pump$/, 'infusion pump beeps'],
  [/^call$/, 'nurse call chime'],
  [/^tube$/, 'pneumatic tube arrival'],
  [/^reverse$/, 'vehicle reversing beeper'],
];

function describeSound(name: string): string {
  const api = name.startsWith('api:') ? name.slice(4) : name;
  if (BUILTIN_SOUNDS[api]) return BUILTIN_SOUNDS[api].note;
  for (const [re, words] of SOUND_NAMES) if (re.test(name)) return words;
  return name;
}

/** What played lately (right-click 🎚, or ?sounds=1): in words, seconds ago, metres away, newest first. */
export function recentSounds(windowMs = 30000): { what: string; key: string; ago: number; dist: number; loop: boolean }[] {
  return (active?.recent(windowMs) ?? [])
    .map((r) => ({ what: describeSound(r.name), key: r.name, ago: r.ago, dist: r.dist, loop: r.loop }))
    .reverse();
}

// test/automation hook (?debug=1)
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__acSound = {
    stats: () => active?.stats() ?? null,
    playSound,
    startAmbience,
    stopAmbience,
    overheadPage,
    sounds: () => Object.keys(BUILTIN_SOUNDS),
    context: () => sharedAudio(false)?.ctx.state ?? 'none',
    /** wake the shared context (to measure a running but silent graph) */
    wake: () => sharedAudio(false)?.ctx.resume(),
    /** draw the waiting-room TV's news frame without speech (screenshots) */
    tvPreview: (kind: 'news' | 'weather', headline: string) => showTvItem(kind, headline),
    burstSeconds: (p: 'high' | 'medium') => burstLength(alarmTone(p)),
  };
}

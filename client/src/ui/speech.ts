/**
 * NPC voices and push-to-talk dictation. Both are progressive enhancements — the game is fully
 * playable with typing.
 *
 * Speech events carry the NPC's cast voice and, once server-side Kokoro is ready, one neural clip
 * per sentence (GET /api/tts/:clipId → WAV). Clips play through one WebAudio graph (one
 * AudioContext, resumed on the first user gesture). Each speaker has a queue: a clip is scheduled
 * on the audio clock right where that speaker's previous audio ends, so sentences join without
 * gaps and lines never overlap, however busy the main thread is with the 3D scene. Phone lines
 * get a telephone band-pass. Without clips (model still downloading, failed, or `--tts browser`)
 * a line falls back to the best matching browser voice (voicePick.ts). Turning voice off (🔊)
 * stops everything at once.
 *
 * Spatial audio: in-world speakers go through an HRTF panner (inverse distance roll-off) and a
 * low-pass that closes when a wall is in between, so voices fade and turn as you walk away and
 * sound muffled from the next room. Phone calls stay "in your ear". The 3D world feeds positions
 * via updateSpatialAudio() every frame.
 *
 * The hospital soundscape (audio/soundscape.ts) plays through the same AudioContext and listener
 * (sharedAudio()); it suspends the context while the tab is hidden, and a line arriving meanwhile
 * waits until the tab is visible again.
 *
 * Lip-sync API for the 3D world (keys are npc ids, or "phone:<contactId>"):
 *   speechLevel(key) — smoothed 0..1 amplitude of what that speaker is saying right now
 *   isSpeaking(key)  — true while a line for that speaker is audible
 */
import { speechChunks } from '../../../shared/speechText';
import type { SpeechVoice, TtsMode } from '../../../shared/types';
import { voiceTraits } from '../../../shared/voices';
import { store } from '../store';
import { browserProsody, pickBrowserVoice, voiceSex } from './voicePick';
import { browserDemo } from '../demo/mode';
import { DEMO_VOICES, recordedParts } from '../demo/dialogue';
import { finishAll, noteLine, partBoundary, partEnded, partStarted, setParts, unvoice, type Caption } from './captions';
import { mouthAt, visemeTimeline, type Mouth } from './visemes';

interface Part {
  text: string;
  clip?: string;
  audio?: Promise<AudioBuffer | null>;
}

interface Line {
  parts: Part[];
  voice?: SpeechVoice;
  at: number;
  /** 0..1: quiet background talk (the waiting room's small talk) */
  gain?: number;
  /** the live caption this line drives (bubble + tablet reveal in step with the voice) */
  cap?: Caption;
}

interface Channel {
  key: string;
  phone: boolean;
  queue: Line[];
  busy: boolean;
  /** bumped on stop: async work for an older generation discards itself */
  gen: number;
  /** scheduled/playing clips, and the audio-clock time (s) where this speaker's audio ends */
  sources: Set<AudioBufferSourceNode>;
  endAt: number;
  /** a browser utterance is being spoken */
  browser: boolean;
  utterance?: SpeechSynthesisUtterance;
  input?: AudioNode;
  analyser?: AnalyserNode;
  /** in-world speakers only: distance/direction + wall muffling (null for phone calls) */
  panner?: PannerNode;
  muffle?: BiquadFilterNode;
  /** in-world speakers only: the line's own loudness (after the analyser, so lip-sync stays full) */
  vol?: GainNode;
  /** latest distance gain (0..1), used to set the volume of browser-voice fallbacks */
  distGain: number;
  level: number;
  levelT: number;
  startedAt: number;
  boundaryAt: number;
  /** what is being said and when (performance.now ms), scheduled clips included: the mouth's shapes follow the words (visemes.ts) */
  said: { text: string; start: number; dur: number }[];
}

/** lines that waited longer than this behind earlier ones are skipped */
const STALE_MS = 25_000;
const MAX_QUEUED_LINES = 4;

const hasWindow = typeof window !== 'undefined';
let ttsMode: TtsMode = 'kokoro';
const channels = new Map<string, Channel>();
let aborter = hasWindow && 'AbortController' in window ? new AbortController() : null;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Server's --tts mode, from the welcome message. 'off' silences NPCs entirely. */
export function setTtsMode(mode: TtsMode | undefined) {
  ttsMode = mode ?? 'kokoro';
  if (ttsMode === 'off') stopSpeaking();
}

function voiceOn(): boolean {
  return ttsMode !== 'off' && !!store.get().view?.settings.tts;
}

/** voices are on and the server speaks with Kokoro (the soundscape's PA, TV and radio host need clips) */
export function neuralVoicesOn(): boolean {
  return ttsMode === 'kokoro' && voiceOn();
}

/** the Kokoro voice the server cast for a speaker (npc id), once they have spoken */
const castVoices = new Map<string, string>();
export function castVoiceOf(key: string): string | undefined {
  return castVoices.get(key);
}

// ───────────────────────────── WebAudio ─────────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx || !hasWindow) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.connect(ctx.destination);
  return ctx;
}

/**
 * The one AudioContext (and its master gain), shared with the soundscape (audio/soundscape.ts) so
 * voices and ambience use one audio thread and one listener. `create: false` never creates it.
 */
export function sharedAudio(create = true): { ctx: AudioContext; master: GainNode } | null {
  const c = create ? audio() : ctx;
  return c && master ? { ctx: c, master } : null;
}

/** a hidden tab keeps its AudioContext suspended (battery): wait until it is visible again */
function whenVisible(maxMs: number): Promise<boolean> {
  if (!hasWindow || !document.hidden) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      resolve(!document.hidden);
    };
    const onVis = () => !document.hidden && done();
    const timer = setTimeout(done, maxMs);
    document.addEventListener('visibilitychange', onVis);
  });
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
function unlock() {
  const c = audio();
  if (!c) return;
  const done = () => {
    if (c.state === 'running') for (const g of GESTURES) window.removeEventListener(g, unlock, true);
  };
  if (c.state === 'running') done();
  else void c.resume().then(done, () => {});
}
if (hasWindow) for (const g of GESTURES) window.addEventListener(g, unlock, true);

/** a context that is not running yet (no gesture) gets a brief chance to resume; never play late */
async function running(c: AudioContext): Promise<boolean> {
  if (c.state === 'running') return true;
  // the soundscape suspends the context while the tab is hidden; a reply waits until you're back
  if (!(await whenVisible(STALE_MS))) return false;
  if ((c.state as AudioContextState) === 'running') return true;
  await Promise.race([c.resume().catch(() => {}), sleep(400)]);
  return (c.state as AudioContextState) === 'running';
}

function biquad(c: AudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** distance model shared by the WebAudio panner and the browser-voice fallback */
const REF_DISTANCE = 1.8;
const ROLLOFF = 1.4;
function inverseGain(d: number): number {
  return REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (Math.max(d, REF_DISTANCE) - REF_DISTANCE));
}

/**
 * per-speaker input node:
 *   phone:    telephone band-pass → analyser (lip-sync) → master
 *   in-world: analyser (lip-sync, unattenuated) → line volume → wall low-pass → HRTF panner → master
 */
function input(ch: Channel, c: AudioContext): AudioNode | null {
  if (!master) return null;
  if (!ch.input) {
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    if (ch.phone) analyser.connect(master);
    else {
      const muffle = biquad(c, 'lowpass', 20000, 0.5);
      const panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = REF_DISTANCE;
      panner.rolloffFactor = ROLLOFF;
      panner.maxDistance = 60;
      const p = lastPos.get(ch.key);
      if (p) setParam3(panner.positionX, panner.positionY, panner.positionZ, p, c, 0);
      const vol = c.createGain();
      analyser.connect(vol).connect(muffle).connect(panner).connect(master);
      ch.panner = panner;
      ch.muffle = muffle;
      ch.vol = vol;
    }
    ch.analyser = analyser;
    if (ch.phone) {
      // ~300–3400 Hz telephone band (24 dB/oct each side) with a little presence and make-up gain
      const presence = biquad(c, 'peaking', 1800, 0.9);
      presence.gain.value = 4;
      const makeup = c.createGain();
      makeup.gain.value = 1.6;
      const hp = biquad(c, 'highpass', 300);
      hp.connect(biquad(c, 'highpass', 300)).connect(biquad(c, 'lowpass', 3400)).connect(biquad(c, 'lowpass', 3400)).connect(presence).connect(makeup).connect(analyser);
      ch.input = hp;
    } else ch.input = analyser;
  }
  return ch.input;
}

/** a clip's audio; `tries` > 1 retries a failed download (not one aborted by stopSpeaking) */
async function fetchClip(url: string, tries = 1): Promise<AudioBuffer | null> {
  const c = audio();
  if (!c) return null;
  const signal = aborter?.signal;
  for (let i = 0; i < tries && !signal?.aborted; i++) {
    try {
      const r = await fetch(url, { signal });
      if (r.ok) return await c.decodeAudioData(await r.arrayBuffer());
    } catch {
      /* offline for a moment, or aborted */
    }
  }
  return null;
}

/** fetch a line's clips one after another (one request in flight per line), starting now */
function prefetch(parts: Part[]) {
  let prev: Promise<unknown> = Promise.resolve();
  for (const p of parts) {
    if (!p.clip) continue;
    const id = p.clip;
    p.audio = prev.then(() => fetchClip(`/api/tts/${encodeURIComponent(id)}`));
    prev = p.audio;
  }
}

/** Schedule a clip on the audio clock right after this speaker's previous audio. Returns its start (audio clock) or -1. */
function schedule(ch: Channel, c: AudioContext, buf: AudioBuffer, gain = 1): number {
  const into = input(ch, c);
  if (!into) return -1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(into);
  const at = Math.max(c.currentTime + 0.03, ch.endAt);
  ch.vol?.gain.setValueAtTime(gain, at);
  src.onended = () => ch.sources.delete(src);
  src.start(at);
  ch.sources.add(src);
  if (at > ch.endAt + 0.05) ch.startedAt = performance.now();
  ch.endAt = at + buf.duration;
  return at;
}

function clipActive(ch: Channel): boolean {
  return !!ctx && ch.sources.size > 0 && ctx.currentTime < ch.endAt;
}

/** wait (audio clock) until this speaker's scheduled clips have played */
async function drained(ch: Channel, gen: number) {
  while (ctx && ch.gen === gen && ctx.currentTime < ch.endAt) await sleep(Math.max(20, (ch.endAt - ctx.currentTime) * 1000));
}

// ───────────────────────────── browser fallback ─────────────────────────────

let systemVoices: SpeechSynthesisVoice[] = [];
if (hasWindow && 'speechSynthesis' in window) {
  const load = () => (systemVoices = window.speechSynthesis.getVoices());
  load();
  window.speechSynthesis.addEventListener?.('voiceschanged', load);
}

function speakBrowser(ch: Channel, text: string, voice?: SpeechVoice, gain = 1, cap?: { c?: Caption; i: number }): Promise<void> {
  if (!hasWindow || !('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const traits = voice ? voiceTraits(voice.id) : null;
    const lang = traits?.lang ?? 'en-US';
    const v = pickBrowserVoice(systemVoices, { sex: traits?.sex, lang }, ch.key);
    // a recorded demo speaker is never voiced by a browser voice that may not be a man's: silent instead
    if (browserDemo && DEMO_VOICES[ch.key] && (!v || voiceSex(v) !== 'M')) {
      unvoice(cap?.c);
      resolve();
      return;
    }
    if (v) u.voice = v;
    u.lang = v?.lang ?? lang;
    const p = browserProsody(ch.key, voice?.speed ?? 1);
    u.pitch = p.pitch;
    u.rate = p.rate;
    // browser voices can't be routed through WebAudio: at least start them at the right loudness
    if (!ch.phone) u.volume = Math.max(0.05, Math.min(1, ch.distGain * gain));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (cap) partEnded(cap.c, cap.i);
      if (ch.utterance === u) {
        ch.utterance = undefined;
        ch.browser = false;
      }
      resolve();
    };
    // some engines never fire onend; allow generous time for the browser's own queue
    const guard = setTimeout(finish, 8000 + (text.split(/\s+/).length / 2.2 / p.rate) * 1000);
    // a browser voice doesn't say how long it will take: about 15 letters a second at rate 1, set
    // right again at every word it reports
    const said = { text, start: 0, dur: (text.length / (15 * p.rate)) * 1000 };
    u.onstart = () => {
      ch.browser = true;
      ch.startedAt = performance.now();
      if (cap) partStarted(cap.c, cap.i, ch.startedAt);
      said.start = ch.startedAt;
      ch.said = [said];
    };
    u.onboundary = (e) => {
      ch.boundaryAt = performance.now();
      if (cap) partBoundary(cap.c, cap.i, e.charIndex);
      if (text.length) said.start = ch.boundaryAt - (e.charIndex / text.length) * said.dur;
    };
    u.onend = finish;
    u.onerror = finish;
    ch.utterance = u;
    window.speechSynthesis.speak(u);
  });
}

// ───────────────────────────── queues ─────────────────────────────

function channel(key: string, phone: boolean): Channel {
  let ch = channels.get(key);
  if (!ch) {
    ch = { key, phone, queue: [], busy: false, gen: 0, sources: new Set(), endAt: 0, browser: false, level: 0, levelT: 0, startedAt: 0, boundaryAt: 0, distGain: 1, said: [] };
    channels.set(key, ch);
  }
  return ch;
}

async function run(ch: Channel) {
  const gen = ch.gen;
  ch.busy = true;
  try {
    while (ch.gen === gen && ch.queue.length) {
      const line = ch.queue.shift()!;
      if (performance.now() - line.at > STALE_MS) {
        unvoice(line.cap);
        continue;
      }
      for (const [i, part] of line.parts.entries()) {
        if (ch.gen !== gen || !voiceOn()) return;
        const buf = part.audio ? await part.audio : null;
        if (ch.gen !== gen || !voiceOn()) return;
        const c = buf ? audio() : null;
        if (buf && c) {
          if (await running(c)) {
            const at = schedule(ch, c, buf, line.gain);
            // the caption follows the audio clock: this part plays from `at` for buf.duration
            if (at >= 0) {
              const start = performance.now() + (at - c.currentTime) * 1000;
              partStarted(line.cap, i, start, buf.duration * 1000);
              ch.said.push({ text: part.text, start, dur: buf.duration * 1000 });
            }
          }
        } else {
          // a clip that could not be fetched (or was never queued) is spoken by the browser instead
          // The first browser utterance can run directly inside the tap or keypress
          // that sent the question. Only defer it if a neural clip is still playing.
          if (clipActive(ch)) await drained(ch, gen);
          if (ch.gen === gen) await speakBrowser(ch, part.text, line.voice, line.gain, { c: line.cap, i });
        }
      }
    }
  } finally {
    if (ch.gen === gen) ch.busy = false;
  }
}

/**
 * Speak an NPC line (from a speech event). key = npc id or "phone:<contactId>".
 * opts.gain (0..1) makes it quieter, e.g. waiting-room small talk (speech events' `volume`).
 */
export function speakNpc(key: string, _name: string, text: string, voice?: SpeechVoice, opts: { gain?: number; transcriptKey?: string } = {}) {
  // every speech event gets its own live caption (the bubble and the tablet stream it); no voice = reading pace
  const cap = noteLine(key, text, true, opts.transcriptKey);
  if (!voiceOn()) return unvoice(cap);
  let parts: Part[];
  // the browser demo's recorded speakers: one clip per sentence (a reply can join a deflection and an answer)
  const recorded = browserDemo ? recordedParts(key, text) : null;
  if (recorded) {
    parts = recorded.map((r) => ({ text: r.text, audio: fetchClip(r.url, 2) }));
  } else {
    parts = voice?.clips ? voice.clips.map((c) => ({ text: c.text, clip: c.id || undefined })) : speechChunks(text).map((t) => ({ text: t }));
  }
  if (!parts.length) return unvoice(cap);
  setParts(cap, parts.map((p) => p.text));
  if (voice?.id) castVoices.set(key, voice.id);
  const ch = channel(key, !!voice?.phone || key.startsWith('phone:'));
  prefetch(parts);
  ch.queue.push({ parts, voice, at: performance.now(), gain: opts.gain === undefined ? undefined : Math.max(0, Math.min(1, opts.gain)), cap });
  if (ch.queue.length > MAX_QUEUED_LINES) for (const dropped of ch.queue.splice(0, ch.queue.length - MAX_QUEUED_LINES)) unvoice(dropped.cap);
  if (!ch.busy) void run(ch);
}

/** Stop all NPC speech immediately (voice toggled off, left the shift). */
export function stopSpeaking() {
  finishAll(); // captions of interrupted lines show in full
  aborter?.abort();
  aborter = hasWindow && 'AbortController' in window ? new AbortController() : null;
  for (const ch of channels.values()) {
    ch.gen++;
    ch.queue = [];
    ch.busy = false;
    for (const src of ch.sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    ch.sources.clear();
    ch.endAt = 0;
    ch.utterance = undefined;
    ch.browser = false;
    ch.said = [];
  }
  if (hasWindow && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

// stop at once when voice is switched off or the session goes away
let wasOn = false;
store.subscribe(() => {
  const on = voiceOn();
  if (wasOn && !on) stopSpeaking();
  wasOn = on;
});

// ───────────────────────────── spatial audio ─────────────────────────────

export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  /** forward direction (unit) */
  fx: number;
  fy: number;
  fz: number;
}

export interface SourcePose {
  x: number;
  y: number;
  z: number;
  /** a wall is between listener and speaker */
  occluded: boolean;
}

const lastPos = new Map<string, { x: number; y: number; z: number }>();

function setParam3(px: AudioParam | undefined, py: AudioParam | undefined, pz: AudioParam | undefined, v: { x: number; y: number; z: number }, c: AudioContext, tau = 0.04) {
  if (!px || !py || !pz) return;
  const t = c.currentTime;
  if (tau <= 0) {
    px.value = v.x;
    py.value = v.y;
    pz.value = v.z;
  } else {
    px.setTargetAtTime(v.x, t, tau);
    py.setTargetAtTime(v.y, t, tau);
    pz.setTargetAtTime(v.z, t, tau);
  }
}

/**
 * Called by the 3D world every frame (or a few times a second): moves the listener to the
 * player's head and every in-world speaker to its NPC. `sourceOf` returns null for unknown keys.
 */
export function updateSpatialAudio(listener: ListenerPose, sourceOf: (key: string) => SourcePose | null) {
  for (const ch of channels.values()) {
    if (ch.phone) continue;
    const p = sourceOf(ch.key);
    if (!p) continue;
    lastPos.set(ch.key, p);
    ch.distGain = inverseGain(Math.hypot(p.x - listener.x, p.y - listener.y, p.z - listener.z)) * (p.occluded ? 0.55 : 1);
    if (!ctx) continue;
    if (ch.panner) setParam3(ch.panner.positionX, ch.panner.positionY, ch.panner.positionZ, p, ctx);
    if (ch.muffle) ch.muffle.frequency.setTargetAtTime(p.occluded ? 950 : 20000, ctx.currentTime, 0.12);
  }
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    setParam3(l.positionX, l.positionY, l.positionZ, listener, ctx);
    setParam3(l.forwardX, l.forwardY, l.forwardZ, { x: listener.fx, y: listener.fy, z: listener.fz }, ctx);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  } else {
    // older Safari: deprecated setters
    (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(listener.x, listener.y, listener.z);
    (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(listener.fx, listener.fy, listener.fz, 0, 1, 0);
  }
}

// ───────────────────────────── lip-sync API ─────────────────────────────

const frame = new Float32Array(512);

/** true while a line for this speaker (npc id or "phone:<contactId>") is audible */
export function isSpeaking(key: string): boolean {
  const ch = channels.get(key);
  return !!ch && (ch.browser || clipActive(ch));
}

/** true while anyone's line is audible or queued (the overhead PA waits for a gap) */
export function anySpeaking(): boolean {
  for (const ch of channels.values()) if (ch.browser || ch.busy || clipActive(ch)) return true;
  return false;
}

/**
 * The mouth shape of the word this speaker is saying right now (visemes.ts), or null when they are
 * silent or nothing is known about their words. Cheap; call once per frame.
 */
export function speechMouth(key: string): Mouth | null {
  const ch = channels.get(key);
  if (!ch?.said.length || !(clipActive(ch) || ch.browser)) return null;
  const now = performance.now();
  while (ch.said.length > 1 && now > ch.said[0].start + ch.said[0].dur) ch.said.shift();
  for (const s of ch.said) if (now >= s.start && now < s.start + s.dur) return mouthAt(visemeTimeline(s.text), (now - s.start) / s.dur);
  return null;
}

/** Smoothed 0..1 speech amplitude for this speaker, for mouth animation. Cheap; call once per frame. */
export function speechLevel(key: string): number {
  const ch = channels.get(key);
  if (!ch) return 0;
  const now = performance.now();
  let target = 0;
  if (clipActive(ch) && ch.analyser) {
    ch.analyser.getFloatTimeDomainData(frame);
    let ss = 0;
    for (let i = 0; i < frame.length; i++) ss += frame[i] * frame[i];
    target = Math.min(1, Math.sqrt(ss / frame.length) * 4);
  } else if (ch.browser) {
    // browser voices expose no audio: a syllable-rate envelope plus word-boundary pulses
    const t = (now - ch.startedAt) / 1000;
    const env = 0.3 + 0.32 * Math.abs(Math.sin(t * Math.PI * 4.3)) * (0.75 + 0.25 * Math.sin(t * 2.1));
    target = Math.min(1, env + (ch.boundaryAt ? 0.3 * Math.exp(-(now - ch.boundaryAt) / 90) : 0));
  }
  const dt = Math.min(0.25, Math.max(0, (now - ch.levelT) / 1000));
  ch.levelT = now;
  const tau = target > ch.level ? 0.03 : 0.09; // fast attack, slower release
  ch.level += (target - ch.level) * (1 - Math.exp(-dt / tau));
  if (ch.level < 0.002) ch.level = 0;
  return ch.level;
}

// ───────────────────────────── dictation ─────────────────────────────

type Rec = { start(): void; stop(): void; abort(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null; interimResults: boolean; lang: string; continuous: boolean };

export function dictationSupported(): boolean {
  return typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
}

/** A running dictation. stop(): wait for recognition to finish. cancel(): discard; nothing more is delivered. */
export interface Dictation {
  stop(): void;
  cancel(): void;
}

/**
 * Start dictation. onText receives the running transcript (final=false), then exactly once the
 * whole utterance (final=true) on successful completion. Errors and a five-second stop timeout
 * leave the interim transcript for manual review; they never deliver a final utterance.
 * onEnd always fires once; `error` is the recognizer's error code or 'timeout'.
 */
export function startDictation(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): Dictation {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    onEnd('unsupported');
    return { stop() {}, cancel() {} };
  }
  const rec: Rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  let latest = ''; // finalised + still-interim text: stop() may end before the last words are final
  let live = true; // false once cancelled or delivered: later results (e.g. the NPC's own voice) are ignored
  let error: string | undefined;
  let ended = false;
  let stopping = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(stopTimer);
    onEnd(error);
  };
  rec.onresult = (e: any) => {
    if (!live) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    const next = (finalText + interim).trim();
    if (next) latest = next;
    onText(latest, false);
  };
  rec.onerror = (e: any) => {
    if (!live) return;
    live = false;
    error = e?.error ?? 'error';
    end();
    try { rec.abort(); } catch { /* already stopped */ }
  };
  rec.onend = () => {
    if (live) {
      live = false;
      onText(latest, true);
    }
    end();
  };
  try {
    rec.start();
  } catch {
    live = false;
    error = 'busy';
    end();
  }
  return {
    stop: () => {
      if (!live || stopping) return;
      stopping = true;
      stopTimer = setTimeout(() => {
        if (!live) return;
        live = false;
        error = 'timeout';
        end();
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      }, 5000);
      try {
        rec.stop();
      } catch {
        /* already stopped; allow its completion event or the timeout */
      }
    },
    cancel: () => {
      live = false;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      end();
    },
  };
}

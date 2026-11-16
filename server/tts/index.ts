/**
 * Server-side NPC voices.
 *
 *   --tts kokoro (default) | browser | off      (or AGENTCLINIC_TTS)
 *
 * kokoro: Kokoro-82M (Apache-2.0) via kokoro-js in a worker thread, lazily loaded the first time a
 *   session turns voice on; model files are cached outside the repo (~/.cache/GTAgentClinic/models).
 *   Each speech event gets its cast voice plus one clip id per sentence; synthesis starts right
 *   away (first sentences first) and clients fetch GET /api/tts/:clipId → audio/wav. Clips are
 *   cached by hash(voice + speed + text) in a byte-bounded LRU. While the model downloads/loads,
 *   or if it fails, events carry only the voice and clients use a matching browser voice.
 *   The engine (kokoro-js + transformers.js, ~440 MB) is optional: `npm run voices:install` puts it
 *   in voices/node_modules. Without it, kokoro falls back to browser voices with a hint (createTts).
 * browser: never loads the model; clients always use browser voices (still sex/accent-matched).
 * off: no voice info at all; clients stay silent.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, renameSync } from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { speechChunks } from '../../shared/speechText';
import type { SpeechVoice, TtsMode } from '../../shared/types';
import { clampSpeed, isKokoroVoice, KOKORO_VOICES } from '../../shared/voices';
import type { GameSession } from '../sim/session';
import { castVoice, type SpeechEvent } from './casting';
import { concatWav, encodeWav, fadeEdges, normalizeLoudness } from './wav';

export type TtsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** workerData for worker.mjs */
export interface TtsWorkerInit {
  modelId: string;
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  cacheDir: string;
  threads: number;
  /** file URL of voices/engine.mjs; absent = import the packages from the game's own node_modules */
  engine?: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the optional voice engine is: voices/ (npm run voices:install) or the game's own node_modules (older installs). */
export interface VoiceEngine {
  where: 'voices' | 'game';
  /** file URL of voices/engine.mjs */
  entry?: string;
}

export function findVoiceEngine(root = ROOT): VoiceEngine | null {
  const has = (base: string) => existsSync(path.join(base, 'node_modules', 'kokoro-js', 'package.json')) && existsSync(path.join(base, 'node_modules', '@huggingface', 'transformers', 'package.json'));
  const voices = path.join(root, 'voices');
  if (has(voices) && existsSync(path.join(voices, 'engine.mjs'))) return { where: 'voices', entry: pathToFileURL(path.join(voices, 'engine.mjs')).href };
  if (has(root)) return { where: 'game' };
  return null;
}

/** why the server speaks with browser voices although kokoro was asked for (npm start's output, the menu, /api/tts) */
export const VOICES_NOT_INSTALLED = 'Neural voices are optional and not installed: npm run voices:install (about 440 MB), then restart the game.';

/** messages from worker.mjs */
export type TtsWorkerMsg =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  | { type: 'done'; id: string; pcm: Float32Array; sampleRate: number; ms: number }
  | { type: 'fail'; id: string; message: string }
  | { type: 'fatal'; message: string };

/** Hugging Face repo with the ONNX export (override with AGENTCLINIC_TTS_MODEL, e.g. for a mirror) */
const MODEL_ID = process.env.AGENTCLINIC_TTS_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPES = ['fp32', 'fp16', 'q8', 'q4', 'q4f16'] as const;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_MAX_CLIPS = 1500;
const QUEUE_MAX = 200;
const JOB_TIMEOUT_MS = 60_000;
const MAX_CRASHES = 3;

interface Job {
  id: string;
  text: string;
  voice: string;
  speed: number;
  /** 0 = first sentence of a line (latency-critical), 1 = continuation / ad hoc */
  priority: number;
  seq: number;
  wanted: () => boolean;
  waiters: number;
  promise: Promise<Buffer | null>;
  resolve: (b: Buffer | null) => void;
}

/**
 * Where GTAgentClinic keeps downloads outside the repo: ~/.cache/GTAgentClinic (XDG_CACHE_HOME
 * respected), or %LOCALAPPDATA%\GTAgentClinic\cache on Windows. Releases before v0.2 used an
 * "agentclinic" folder: it's moved over once (a rename, so the ~326 MB voice model isn't
 * downloaded again).
 */
export function defaultCacheDir(): string {
  if (process.env.AGENTCLINIC_CACHE_DIR) return process.env.AGENTCLINIC_CACHE_DIR;
  const win = process.platform === 'win32' && process.env.LOCALAPPDATA;
  const root = win ? process.env.LOCALAPPDATA! : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const dir = win ? path.join(root, 'GTAgentClinic', 'cache') : path.join(root, 'GTAgentClinic');
  const legacy = win ? path.join(root, 'agentclinic', 'cache') : path.join(root, 'agentclinic');
  try {
    if (!existsSync(dir) && existsSync(legacy) && !lstatSync(legacy).isSymbolicLink()) {
      mkdirSync(path.dirname(dir), { recursive: true });
      renameSync(legacy, dir);
      console.log(`  moved the old cache ${legacy} → ${dir}`);
    }
  } catch {
    /* another process moved it, or a different volume: the new folder simply starts empty */
  }
  return dir;
}

export function parseTtsMode(v: string | undefined): TtsMode {
  const m = (v ?? '').trim().toLowerCase();
  if (m === 'browser' || m === 'off') return m;
  if (m === 'none' || m === 'false' || m === '0') return 'off';
  return 'kokoro';
}

export function clipId(voice: string, speed: number, text: string): string {
  return createHash('sha256').update(`${voice}|${speed.toFixed(2)}|${text}`).digest('hex').slice(0, 32);
}

export class TtsService {
  readonly mode: TtsMode;
  status: TtsStatus = 'idle';
  detail?: string;
  readonly dtype: (typeof DTYPES)[number];
  readonly threads: number;
  readonly cacheDir: string;
  readonly modelDir: string;
  private worker?: Worker;
  private cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private jobs = new Map<string, Job>();
  private running?: Job;
  private runTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private crashes = 0;
  private readyWaiters: (() => void)[] = [];
  private lastProgressLog = 0;
  readonly stats = { loadMs: 0, clips: 0, audioS: 0, synthMs: 0, encodeMs: 0, hits: 0, misses: 0, dropped: 0, failed: 0 };

  /** where kokoro loads the engine from */
  readonly engine: VoiceEngine;
  /** why the mode is not what was asked for (e.g. browser voices because the engine isn't installed) */
  readonly note?: string;

  constructor(mode: TtsMode, opts: { dtype?: string; threads?: number; cacheDir?: string; engine?: VoiceEngine; note?: string } = {}) {
    this.mode = mode;
    this.engine = opts.engine ?? { where: 'game' };
    this.note = opts.note;
    const d = (opts.dtype ?? process.env.AGENTCLINIC_TTS_DTYPE ?? 'fp32').toLowerCase();
    this.dtype = (DTYPES as readonly string[]).includes(d) ? (d as (typeof DTYPES)[number]) : 'fp32';
    const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    // leave cores for the browser's 3D rendering and the sim; 6 on a 10-core M1 Max
    this.threads = Math.max(1, Math.min(16, opts.threads ?? (Number(process.env.AGENTCLINIC_TTS_THREADS) || Math.max(2, Math.min(6, cores - 4)))));
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.modelDir = path.join(this.cacheDir, 'models');
  }

  /** path of the ONNX weights transformers.js caches for this dtype */
  get modelFile(): string {
    const file = { fp32: 'model.onnx', fp16: 'model_fp16.onnx', q8: 'model_quantized.onnx', q4: 'model_q4.onnx', q4f16: 'model_q4f16.onnx' }[this.dtype];
    return path.join(this.modelDir, ...MODEL_ID.split('/'), 'onnx', file);
  }

  get label(): string {
    if (this.mode === 'off') return 'off (NPCs are silent)';
    if (this.mode === 'browser') return this.note ? `browser voices · ${this.note}` : 'browser voices (--tts browser)';
    const mb = { fp32: 326, fp16: 163, q8: 92 }[this.dtype as 'fp32'];
    const where = existsSync(this.modelFile) ? `model cached in ${this.modelDir}` : `first use downloads ${mb ? `~${mb} MB` : 'the model'} to ${this.modelDir}`;
    return `Kokoro-82M neural TTS (${this.dtype}) · loads when a player turns voice on · ${where}`;
  }

  /** Start loading the model in the background (first use). Safe to call often. */
  warm(): void {
    if (this.mode !== 'kokoro' || this.worker || this.status === 'failed') return;
    this.status = 'loading';
    const t0 = Date.now();
    const init: TtsWorkerInit = { modelId: MODEL_ID, dtype: this.dtype, cacheDir: this.modelDir, threads: this.threads, ...(this.engine.entry ? { engine: this.engine.entry } : {}) };
    let w: Worker;
    try {
      w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: init, name: 'kokoro-tts' });
    } catch (e) {
      this.fail(`could not start the TTS worker: ${(e as Error).message}`);
      return;
    }
    this.worker = w;
    console.log(`[tts] loading Kokoro-82M (${this.dtype}, ${this.threads} threads) from ${this.modelDir} …`);
    w.on('message', (m: TtsWorkerMsg) => this.onMessage(w, m, t0));
    w.on('error', (e: unknown) => this.onCrash(w, e instanceof Error ? e.message : String(e)));
    w.on('exit', (code) => this.onCrash(w, `worker exited (code ${code})`));
  }

  private onMessage(w: Worker, m: TtsWorkerMsg, t0: number) {
    if (w !== this.worker) return;
    switch (m.type) {
      case 'progress': {
        const now = Date.now();
        if (m.total > 5e6 && now - this.lastProgressLog > 4000) {
          this.lastProgressLog = now;
          console.log(`[tts] downloading ${m.file}: ${Math.round((100 * m.loaded) / m.total)}% of ${Math.round(m.total / 1e6)} MB`);
        }
        break;
      }
      case 'ready':
        this.status = 'ready';
        this.crashes = 0;
        this.stats.loadMs = Date.now() - t0;
        console.log(`[tts] Kokoro ready in ${(this.stats.loadMs / 1000).toFixed(1)} s (${this.dtype}, ${this.threads} threads)`);
        for (const r of this.readyWaiters.splice(0)) r();
        this.pump();
        break;
      case 'fatal':
        this.fail(m.message);
        break;
      case 'done':
      case 'fail': {
        const job = this.running;
        if (!job || job.id !== m.id) break;
        clearTimeout(this.runTimer);
        this.running = undefined;
        this.jobs.delete(job.id);
        if (m.type === 'done') {
          // ~1 ms of DSP per clip on this thread: level-match voices, de-click edges, 16-bit WAV
          const t = performance.now();
          normalizeLoudness(m.pcm, m.sampleRate);
          fadeEdges(m.pcm, m.sampleRate);
          const buf = encodeWav(m.pcm, m.sampleRate);
          this.stats.encodeMs += performance.now() - t;
          this.stats.clips++;
          this.stats.audioS += m.pcm.length / m.sampleRate;
          this.stats.synthMs += m.ms;
          this.store(job.id, buf);
          job.resolve(buf);
        } else {
          this.stats.failed++;
          console.warn(`[tts] synthesis failed (${job.voice}): ${m.message}`);
          job.resolve(null);
        }
        this.pump();
        break;
      }
    }
  }

  private onCrash(w: Worker, why: string) {
    if (w !== this.worker) return;
    this.worker = undefined;
    clearTimeout(this.runTimer);
    if (this.running) {
      this.jobs.delete(this.running.id);
      this.running.resolve(null);
      this.running = undefined;
    }
    if (this.status !== 'ready') return this.fail(why);
    if (++this.crashes >= MAX_CRASHES) return this.fail(`${why} (${this.crashes} crashes)`);
    console.warn(`[tts] ${why} — restarting Kokoro`);
    this.status = 'idle';
    this.warm();
  }

  private fail(why: string) {
    this.status = 'failed';
    this.detail = why;
    const w = this.worker;
    this.worker = undefined;
    clearTimeout(this.runTimer);
    void w?.terminate();
    console.warn(`[tts] Kokoro unavailable (${why}) — NPCs will use browser voices`);
    for (const job of this.jobs.values()) job.resolve(null);
    this.jobs.clear();
    this.running = undefined;
    for (const r of this.readyWaiters.splice(0)) r();
  }

  private store(id: string, buf: Buffer) {
    const old = this.cache.get(id);
    if (old) {
      this.cache.delete(id);
      this.cacheBytes -= old.length;
    }
    this.cache.set(id, buf);
    this.cacheBytes += buf.length;
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= CACHE_MAX_BYTES && this.cache.size <= CACHE_MAX_CLIPS) break;
      this.cache.delete(k);
      this.cacheBytes -= v.length;
    }
  }

  /** Send the next job to the worker: first sentences before continuations, then FIFO. */
  private pump() {
    if (this.status !== 'ready' || !this.worker || this.running) return;
    for (;;) {
      let next: Job | undefined;
      for (const j of this.jobs.values()) if (!next || j.priority < next.priority || (j.priority === next.priority && j.seq < next.seq)) next = j;
      if (!next) return;
      if (next.waiters === 0 && !next.wanted()) {
        // nobody can hear it any more (voice switched off, client gone)
        this.jobs.delete(next.id);
        this.stats.dropped++;
        next.resolve(null);
        continue;
      }
      this.running = next;
      const w = this.worker;
      this.runTimer = setTimeout(() => {
        if (this.worker === w) {
          console.warn('[tts] synthesis timed out — restarting the worker');
          void w.terminate();
        }
      }, JOB_TIMEOUT_MS);
      w.postMessage({ type: 'synth', id: next.id, text: next.text, voice: next.voice, speed: next.speed });
      return;
    }
  }

  /** Queue one chunk (or reuse a cached / pending clip); returns the clip id, or null when the queue is full. */
  request(text: string, voice: string, speed: number, priority: number, wanted: () => boolean): string | null {
    const id = clipId(voice, speed, text);
    if (this.cache.has(id)) return id;
    const pending = this.jobs.get(id);
    if (pending) {
      pending.priority = Math.min(pending.priority, priority);
      const prev = pending.wanted;
      pending.wanted = () => prev() || wanted();
      return id;
    }
    if (this.jobs.size >= QUEUE_MAX) return null;
    let resolve!: (b: Buffer | null) => void;
    const promise = new Promise<Buffer | null>((r) => (resolve = r));
    this.jobs.set(id, { id, text, voice, speed, priority, seq: ++this.seq, wanted, waiters: 0, promise, resolve });
    this.pump();
    return id;
  }

  /** A finished clip; waits for a pending one. undefined = unknown id (never requested or evicted). */
  async clip(id: string, timeoutMs = 45_000): Promise<Buffer | null | undefined> {
    const hit = this.cache.get(id);
    if (hit) {
      this.cache.delete(id);
      this.cache.set(id, hit);
      this.stats.hits++;
      return hit;
    }
    const job = this.jobs.get(id);
    if (!job) {
      this.stats.misses++;
      return undefined;
    }
    job.waiters++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([job.promise, new Promise<null>((r) => (timer = setTimeout(() => r(null), timeoutMs)))]);
    } finally {
      clearTimeout(timer);
      job.waiters--;
    }
  }

  /** Resolve once the model is ready (or failed / timed out). */
  whenReady(timeoutMs: number): Promise<boolean> {
    if (this.status === 'ready') return Promise.resolve(true);
    if (this.mode !== 'kokoro' || this.status === 'failed') return Promise.resolve(false);
    this.warm();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.status === 'ready'), timeoutMs);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve(this.status === 'ready');
      });
    });
  }

  /**
   * Attach the cast voice (and, once Kokoro is ready, per-sentence clip ids) to a speech event,
   * starting synthesis immediately. `wanted` tells whether anyone can still hear this session.
   */
  speech(s: GameSession, e: SpeechEvent, wanted: () => boolean): SpeechEvent {
    if (this.mode === 'off') return e;
    const cast = castVoice(s, e);
    const voice: SpeechVoice = { id: cast.id, speed: cast.speed, ...(cast.phone ? { phone: true } : {}) };
    if (this.mode === 'kokoro' && wanted()) {
      if (this.status === 'ready') {
        // id '' = not queued (queue full): the client speaks that part with a browser voice
        // waiting-room small talk (e.ambient) queues behind every NPC line, like the soundscape's background speech
        voice.clips = speechChunks(e.text).map((text, i) => ({ id: this.request(text, cast.id, cast.speed, e.ambient ? 2 : i === 0 ? 0 : 1, wanted) ?? '', text }));
      } else this.warm();
    }
    return { ...e, voice };
  }

  /** background = ambient speech (overhead pages, TV, radio host): queued behind every NPC line */
  async synthesize(text: string, voice: string, speed: number, background = false): Promise<Buffer | null> {
    if (!(await this.whenReady(10 * 60_000))) return null;
    const ids: string[] = [];
    for (const [i, chunk] of speechChunks(text).entries()) {
      const id = this.request(chunk, voice, speed, background ? 2 : i === 0 ? 0 : 1, () => true);
      if (!id) return null;
      ids.push(id);
    }
    const bufs = await Promise.all(ids.map((id) => this.clip(id, 120_000)));
    if (bufs.some((b) => !b)) return null;
    return concatWav(bufs as Buffer[]);
  }

  info() {
    const s = this.stats;
    return {
      mode: this.mode,
      status: this.mode === 'kokoro' ? this.status : this.mode,
      detail: this.detail,
      note: this.note,
      engine: this.mode === 'kokoro' ? this.engine.where : undefined,
      model: MODEL_ID,
      dtype: this.dtype,
      threads: this.threads,
      modelCache: this.modelDir,
      loadMs: s.loadMs || undefined,
      queue: this.jobs.size,
      cache: { clips: this.cache.size, mb: +(this.cacheBytes / 1e6).toFixed(1) },
      synthesized: {
        clips: s.clips,
        audioS: +s.audioS.toFixed(1),
        rtf: s.audioS ? +(s.synthMs / 1000 / s.audioS).toFixed(3) : undefined,
        mainThreadMsPerClip: s.clips ? +(s.encodeMs / s.clips).toFixed(2) : undefined,
        cacheHits: s.hits,
        dropped: s.dropped,
        failed: s.failed,
      },
      voices: Object.keys(KOKORO_VOICES),
    };
  }

  /** /api/tts routes. parts = url path segments, e.g. ['api', 'tts', '<clipId>'] */
  async http(req: http.IncomingMessage, res: http.ServerResponse, parts: string[]): Promise<void> {
    const sendJson = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const sendWav = (buf: Buffer, cacheable: boolean) => {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': buf.length, 'cache-control': cacheable ? 'private, max-age=86400, immutable' : 'no-store' });
      res.end(buf);
    };
    if (req.method === 'GET' && parts.length === 2) return sendJson(200, this.info());
    if (req.method === 'GET' && parts.length === 3) {
      const id = parts[2];
      if (!/^[0-9a-f]{32}$/.test(id)) return sendJson(400, { error: 'bad clip id' });
      const buf = await this.clip(id);
      if (buf) return sendWav(buf, true);
      if (buf === undefined) return sendJson(404, { error: 'unknown or expired clip' });
      return sendJson(503, { error: 'clip unavailable', status: this.status, detail: this.detail });
    }
    if (req.method === 'POST' && parts.length === 2) {
      if (this.mode !== 'kokoro') return sendJson(503, { error: `server TTS is ${this.mode}` });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 16_384) return sendJson(413, { error: 'body too large' });
        chunks.push(c as Buffer);
      }
      let b: { text?: unknown; voice?: unknown; speed?: unknown; priority?: unknown };
      try {
        b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return sendJson(400, { error: 'body must be JSON {text, voice, speed, priority?}' });
      }
      const text = typeof b.text === 'string' ? b.text.slice(0, 2000) : '';
      const voice = b.voice === undefined ? 'af_heart' : b.voice;
      if (!speechChunks(text).length) return sendJson(400, { error: 'nothing speakable in "text"' });
      if (!isKokoroVoice(voice)) return sendJson(400, { error: 'unknown voice', voices: Object.keys(KOKORO_VOICES) });
      const wav = await this.synthesize(text, voice, clampSpeed(typeof b.speed === 'number' ? b.speed : 1), b.priority === 'background');
      if (!wav) return sendJson(503, { error: 'synthesis unavailable', status: this.status, detail: this.detail });
      return sendWav(wav, false);
    }
    return sendJson(405, { error: 'GET /api/tts, GET /api/tts/:clipId or POST /api/tts {text, voice, speed}' });
  }

  dispose(): void {
    const w = this.worker;
    this.worker = undefined;
    void w?.terminate();
  }
}

/** The server's voices: --tts / AGENTCLINIC_TTS, with kokoro falling back to browser voices (and saying so) when the optional engine is missing. */
export function createTts(flag: string | undefined, root = ROOT): TtsService {
  const mode = parseTtsMode(flag);
  if (mode !== 'kokoro') return new TtsService(mode);
  const engine = findVoiceEngine(root);
  return engine ? new TtsService('kokoro', { engine }) : new TtsService('browser', { note: VOICES_NOT_INSTALLED });
}

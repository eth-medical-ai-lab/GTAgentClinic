/**
 * Kokoro TTS worker thread. Owns the ONNX model so phonemization and inference never block the
 * server's 100 ms simulation loop. Started lazily by TtsService.warm() (server/tts/index.ts).
 *
 * Plain JavaScript with no relative imports on purpose: worker threads do not reliably get tsx's
 * TypeScript resolution (Node 22 strips types natively but needs explicit extensions; Node 20
 * cannot run .ts at all), so this file loads the same way under tsx, plain node, any version.
 * The protocol types live in index.ts (TtsWorkerInit / TtsWorkerMsg).
 *
 * main → worker: { type: 'synth', id, text, voice, speed }
 * worker → main: { type: 'progress', file, loaded, total }
 *                { type: 'ready', ms }                        model loaded + warm-up inference done
 *                { type: 'done', id, pcm, sampleRate, ms }    pcm: Float32Array (transferred)
 *                { type: 'fail', id, message }
 *                { type: 'fatal', message }                   model could not be loaded
 */
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';

const init = workerData;
const port = parentPort;

/**
 * The optional engine: voices/engine.mjs (npm run voices:install puts the packages in voices/node_modules),
 * or, as in older installs, the game's own node_modules. TtsService only starts this worker when one exists.
 */
async function engine() {
  if (init.engine) {
    const m = await import(init.engine);
    return { tf: m.tf, KokoroTTS: m.KokoroTTS };
  }
  const tf = await import('@huggingface/transformers');
  const { KokoroTTS } = await import('kokoro-js');
  return { tf, KokoroTTS };
}

async function load() {
  const t0 = performance.now();
  const { tf, KokoroTTS } = await engine();
  // keep downloads out of the repo (transformers.js defaults to node_modules/@huggingface/transformers/.cache)
  tf.env.cacheDir = init.cacheDir;
  tf.env.allowLocalModels = false;
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file && p.total) port.postMessage({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total });
  };
  // kokoro-js's from_pretrained does not forward session options (threads), so build the model here
  const [model, tokenizer] = await Promise.all([
    tf.StyleTextToSpeech2Model.from_pretrained(init.modelId, {
      dtype: init.dtype,
      device: 'cpu',
      progress_callback,
      session_options: { intraOpNumThreads: init.threads, interOpNumThreads: 1, enableCpuMemArena: false },
    }),
    tf.AutoTokenizer.from_pretrained(init.modelId, { progress_callback }),
  ]);
  const tts = new KokoroTTS(model, tokenizer);
  await tts.generate('Ready.', { voice: 'af_heart', speed: 1 }); // first run allocates and optimizes
  port.postMessage({ type: 'ready', ms: Math.round(performance.now() - t0) });
  return tts;
}

const ready = load();
ready.catch((e) => port.postMessage({ type: 'fatal', message: e instanceof Error ? e.message : String(e) }));

// one synthesis at a time (the main thread also sends one job at a time)
let chain = Promise.resolve();
port.on('message', (m) => {
  if (m?.type !== 'synth') return;
  chain = chain.then(async () => {
    try {
      const tts = await ready;
      const t0 = performance.now();
      const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
      const pcm = new Float32Array(out.audio);
      port.postMessage({ type: 'done', id: m.id, pcm, sampleRate: out.sampling_rate, ms: Math.round(performance.now() - t0) }, [pcm.buffer]);
    } catch (e) {
      port.postMessage({ type: 'fail', id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  });
});

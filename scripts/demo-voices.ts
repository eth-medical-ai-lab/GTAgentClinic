/**
 * Records the browser demo's voiced lines (client/src/demo/dialogue.ts DEMO_VOICES): every sentence
 * Marcus, Mr. Keller and Tom can say, one MP3 each, in their cast voices (shared/voiceCast.ts) with the
 * game's own engine (Kokoro-82M: npm run voices:install). Each clip is trimmed to its speech, so the
 * sentences of a reply follow one another as one person speaks. Writes
 * client/public/res/audio/<folder>/<hash>.mp3 (24 kHz mono, 64 kb/s) and removes clips no line uses.
 *
 *   npx tsx scripts/demo-voices.ts           record what is missing, remove what is unused
 *   npx tsx scripts/demo-voices.ts --check   list what is missing or unused and exit 1 if anything is
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_VOICES, clipName, scriptSentences } from '../client/src/demo/dialogue';
import { createTts } from '../server/tts';
import { encodeWav, fadeEdges, wavInfo } from '../server/tts/wav';
import { VOICE_CAST } from '../shared/voiceCast';

const check = process.argv.includes('--check');
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const AUDIO = path.join(ROOT, 'client/public/res/audio');

const plan = Object.entries(DEMO_VOICES).map(([id, folder]) => {
  const voice = (VOICE_CAST as Record<string, { id: string; speed: number }>)[id];
  if (!voice) throw new Error(`${id} has no cast voice in shared/voiceCast.ts`);
  const dir = path.join(AUDIO, folder);
  const want = new Map([...scriptSentences(id)].map((s) => [clipName(s), s]));
  const have = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')) : [];
  return { id, folder, voice, dir, missing: [...want].filter(([f]) => !have.includes(f)), unused: have.filter((f) => !want.has(f)) };
});

for (const p of plan) console.log(`${p.folder}: ${p.missing.length} to record, ${p.unused.length} unused (${p.voice.id} at ${p.voice.speed})`);
if (check) process.exit(plan.some((p) => p.missing.length || p.unused.length) ? 1 : 0);

const tts = createTts('kokoro', ROOT);
if (tts.mode !== 'kokoro') throw new Error('The voice engine is not installed: npm run voices:install');
tts.warm();
const tmp = path.join(tmpdir(), `demo-voices-${process.pid}.wav`);
try {
  for (const p of plan) {
    mkdirSync(p.dir, { recursive: true });
    for (const file of p.unused) rmSync(path.join(p.dir, file));
    for (const [file, sentence] of p.missing) {
      const wav = await tts.synthesize(sentence, p.voice.id, p.voice.speed);
      if (!wav) throw new Error(`no audio for "${sentence}"`);
      writeFileSync(tmp, trimmed(wav));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', path.join(p.dir, file)]);
      console.log(`  ${p.folder}/${file}  ${sentence}`);
    }
  }
} finally {
  rmSync(tmp, { force: true });
  tts.dispose();
}

/**
 * A clip cut to its speech (10 ms frames over −32 dBFS), with a breath before and a pause after:
 * Kokoro pads every clip with about 0.4 s of silence before and 0.6 s after.
 */
function trimmed(wav: Buffer): Buffer {
  const w = wavInfo(wav);
  const x = Float32Array.from({ length: w.samples }, (_, i) => wav.readInt16LE(w.dataOffset + i * 2) / 32768);
  const frame = Math.round(w.sampleRate * 0.01);
  let first = -1, last = -1;
  for (let f = 0; f * frame < x.length; f++) {
    let e = 0;
    const end = Math.min(x.length, (f + 1) * frame);
    for (let i = f * frame; i < end; i++) e += x[i] * x[i];
    if (Math.sqrt(e / (end - f * frame)) > 0.025) {
      if (first < 0) first = f;
      last = f + 1;
    }
  }
  if (first < 0) return wav;
  const from = Math.max(0, first * frame - Math.round(w.sampleRate * 0.06));
  const to = Math.min(x.length, last * frame + Math.round(w.sampleRate * 0.22));
  const y = x.slice(from, to);
  fadeEdges(y, w.sampleRate, 8);
  return encodeWav(y, w.sampleRate);
}

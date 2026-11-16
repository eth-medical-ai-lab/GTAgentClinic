/**
 * WAV helpers for NPC clips: 16-bit PCM mono, light loudness normalization
 * (Kokoro voices differ by ~9 dB out of the box) and edge fades against clicks.
 */

/** Scale so speech-active frames sit near targetRms, without letting peaks exceed `peak`. */
export function normalizeLoudness(x: Float32Array, sampleRate: number, targetRms = 0.1, peak = 0.95, maxGain = 4): number {
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  let energy = 0;
  let n = 0;
  let maxAbs = 0;
  for (let s = 0; s < x.length; s += frame) {
    let e = 0;
    const end = Math.min(x.length, s + frame);
    for (let i = s; i < end; i++) {
      const v = x[i];
      e += v * v;
      const a = v < 0 ? -v : v;
      if (a > maxAbs) maxAbs = a;
    }
    // frames above -45 dBFS count as speech
    if (e / (end - s) > 0.0056 * 0.0056) {
      energy += e;
      n += end - s;
    }
  }
  if (!n || !maxAbs) return 1;
  const rms = Math.sqrt(energy / n);
  let gain = Math.min(maxGain, Math.max(0.25, targetRms / rms));
  if (maxAbs * gain > peak) gain = peak / maxAbs;
  if (gain !== 1) for (let i = 0; i < x.length; i++) x[i] *= gain;
  return gain;
}

export function fadeEdges(x: Float32Array, sampleRate: number, ms = 6): void {
  const n = Math.min(Math.floor(x.length / 2), Math.round((sampleRate * ms) / 1000));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
}

function header(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Float32 [-1, 1] → 16-bit PCM mono WAV. */
export function encodeWav(x: Float32Array, sampleRate: number): Buffer {
  const pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i];
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (!LITTLE_ENDIAN) data.swap16();
  return Buffer.concat([header(data.length, sampleRate), data]);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: number;
  durationS: number;
  /** RMS of the whole clip, 0..1 */
  rms: number;
  peak: number;
  dataOffset: number;
}

/** Parse a 16-bit PCM WAV (what encodeWav writes); throws on anything else. */
export function wavInfo(buf: Buffer): WavInfo {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('expected 16-bit PCM');
      const samples = Math.floor(Math.min(size, buf.length - off - 8) / 2 / fmt.channels);
      let ss = 0;
      let peak = 0;
      for (let i = 0; i < samples * fmt.channels; i++) {
        const v = buf.readInt16LE(off + 8 + i * 2) / 0x8000;
        ss += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, samples, durationS: samples / fmt.sampleRate, rms: Math.sqrt(ss / Math.max(1, samples * fmt.channels)), peak, dataOffset: off + 8 };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/** Join same-format clips with a short pause between sentences. */
export function concatWav(clips: Buffer[], gapS = 0.12): Buffer {
  if (!clips.length) return encodeWav(new Float32Array(0), 24000);
  const infos = clips.map(wavInfo);
  const sr = infos[0].sampleRate;
  const gap = Math.round(sr * gapS) * 2;
  const pcm = clips.map((c, i) => c.subarray(infos[i].dataOffset, infos[i].dataOffset + infos[i].samples * 2));
  const dataBytes = pcm.reduce((s, p) => s + p.length, 0) + gap * (pcm.length - 1);
  const parts: Buffer[] = [header(dataBytes, sr)];
  pcm.forEach((p, i) => {
    if (i) parts.push(Buffer.alloc(gap));
    parts.push(p);
  });
  return Buffer.concat(parts);
}

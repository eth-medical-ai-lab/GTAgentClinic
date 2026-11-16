/**
 * Live captions: how much of an NPC's line has been said so far, so the speech bubble and the tablet
 * reveal it word by word in step with the voice.
 *
 * - net.ts notes every spoken line as its speech event arrives (noteLine).
 * - speech.ts reports when each part of the line starts playing:
 *   - neural voice: the clip's start on the audio clock and its duration;
 *   - browser voice: its start, word boundaries and end.
 * - With voices off, or if the voice never starts, the line runs at a brisk reading pace instead.
 * - revealed() turns that into a character count, snapped to whole words.
 * - The tablet asks with a small lag, like a live dictation device transcribing.
 */

interface Part {
  offset: number;
  length: number;
  /** performance.now() when this part started playing */
  start?: number;
  /** when it ends (known up front for audio clips; set on end for browser speech) */
  end?: number;
  /** browser speech: last word-boundary char index within the part, and when it fired */
  boundary?: number;
  boundaryAt?: number;
}

export interface Caption {
  key: string;
  transcriptKey?: string;
  text: string;
  arrived: number;
  parts: Part[];
  voiced: boolean;
  /** reveal everything at once (speech stopped, line dropped) */
  done: boolean;
}

/** reading pace when a line isn't voiced (chars/s): quick, but you still see it stream */
const READ_CPS = 34;
/** fills the gaps between a browser voice's word boundaries (≈ 180 words a minute) */
const SPEECH_CPS = 15;
/** if the voice hasn't started by then (slow synthesis, blocked audio), stream at reading pace */
const WAIT_MS = 2500;
const MAX = 80;

const captions: Caption[] = [];

/** a line was spoken (speech event): start its caption; voiced = a voice will try to say it */
export function noteLine(key: string, text: string, voiced: boolean, transcriptKey?: string): Caption {
  const c: Caption = { key, transcriptKey, text, arrived: performance.now(), parts: [], voiced, done: false };
  captions.push(c);
  if (captions.length > MAX) captions.splice(0, captions.length - MAX);
  return c;
}

/** the newest caption for this speaker and text */
export function captionFor(key: string, text: string): Caption | undefined {
  for (let i = captions.length - 1; i >= 0; i--) if (captions[i].key === key && captions[i].text === text) return captions[i];
  return undefined;
}

/** Chat line IDs are unique within a shift. Identical replies keep their own playback timing. */
export function transcriptKey(sessionId: string, lineId: string): string {
  return sessionId + '/' + lineId;
}

export function captionForLine(lineKey: string): Caption | undefined {
  return captions.findLast(c => c.transcriptKey === lineKey);
}

/** speech.ts splits a line into parts (sentences/clips): spread them over the text by length */
export function setParts(c: Caption, partTexts: string[]) {
  const total = partTexts.reduce((a, t) => a + t.length, 0) || 1;
  let acc = 0;
  c.parts = partTexts.map((t) => {
    const offset = Math.round((acc / total) * c.text.length);
    acc += t.length;
    const end = Math.round((acc / total) * c.text.length);
    return { offset, length: end - offset };
  });
}

export function partStarted(c: Caption | undefined, i: number, at: number, durationMs?: number) {
  const p = c?.parts[i];
  if (!p) return;
  p.start = at;
  if (durationMs !== undefined) p.end = at + durationMs;
}

export function partBoundary(c: Caption | undefined, i: number, charIndex: number) {
  const p = c?.parts[i];
  if (!p) return;
  p.boundary = charIndex;
  p.boundaryAt = performance.now();
}

export function partEnded(c: Caption | undefined, i: number) {
  const p = c?.parts[i];
  if (p) p.end = Math.min(p.end ?? Infinity, performance.now());
}

/** the voice won't say this line after all (voice off, line skipped as stale): read it instead */
export function unvoice(c: Caption | undefined) {
  if (c && c.voiced && !c.parts.some((p) => p.start !== undefined)) {
    c.voiced = false;
    c.arrived = performance.now();
  }
}

/** speech was stopped: show every unfinished line in full */
export function finishAll() {
  for (const c of captions) c.done = true;
}

/** characters of the line shown at `now`, `lagMs` behind the voice, snapped to whole words */
export function revealed(c: Caption, now = performance.now(), lagMs = 0): number {
  const len = c.text.length;
  if (c.done) return len;
  const t = now - lagMs;
  const anyStarted = c.parts.some((p) => p.start !== undefined);
  let n: number;
  if (!c.voiced || !c.parts.length || (!anyStarted && t - c.arrived > WAIT_MS)) {
    const from = c.voiced ? c.arrived + WAIT_MS : c.arrived + 120;
    n = ((t - from) * READ_CPS) / 1000;
  } else {
    n = 0;
    for (const p of c.parts) {
      if (p.start === undefined || t < p.start) break;
      if (p.end !== undefined && t >= p.end) {
        n = p.offset + p.length;
        continue;
      }
      if (p.boundary !== undefined) n = p.offset + Math.min(p.length, p.boundary + ((t - (p.boundaryAt ?? t)) * SPEECH_CPS) / 1000);
      else if (p.end !== undefined) n = p.offset + (p.length * (t - p.start)) / Math.max(1, p.end - p.start);
      else n = p.offset + Math.min(p.length, ((t - p.start) * SPEECH_CPS) / 1000);
      break;
    }
  }
  if (n <= 0) return 0;
  if (n >= len) return len;
  // a word appears as it starts being said
  const space = c.text.indexOf(' ', Math.floor(n));
  return space < 0 ? len : space;
}

/** still revealing? */
export function streaming(c: Caption, now = performance.now(), lagMs = 0): boolean {
  return revealed(c, now, lagMs) < c.text.length;
}

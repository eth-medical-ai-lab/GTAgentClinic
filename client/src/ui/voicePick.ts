/**
 * Browser speechSynthesis voice selection for the fallback path (Kokoro not downloaded yet,
 * still loading, failed, or --tts browser). Pure functions so they can be unit-tested.
 *
 *  - never uses macOS novelty voices (Bahh, Zarvox, …) or the robotic Eloquence voices (Eddy, Flo, …)
 *  - matches the cast Kokoro voice's sex and accent (af/am → en-US female/male, bf/bm → en-GB)
 *  - prefers high-quality voices (Premium / Enhanced / Natural / Neural / Google / Microsoft … Online)
 *  - otherwise takes the best normal voice available, never a mismatched novelty voice
 *  - pitch 1.0 ± 0.04 and rate 0.95–1.05 (× the cast speed), stable per NPC
 */
import type { Sex } from '../../../shared/types';
import type { VoiceLang } from '../../../shared/voices';

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI?: string;
  localService?: boolean;
  default?: boolean;
}

/** macOS novelty voices, plus older MacinTalk-era names still listed on some systems */
export const NOVELTY_VOICES = [
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Wobble', 'Fred', 'Good News', 'Jester', 'Junior', 'Kathy',
  'Organ', 'Superstar', 'Ralph', 'Trinoids', 'Whisper', 'Zarvox', 'Deranged', 'Hysterical', 'Pipe Organ', 'Princess', 'Agnes', 'Bruce', 'Vicki', 'Victoria',
];
/** robotic Eloquence voices (each in US and UK variants) */
export const ELOQUENCE_VOICES = ['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'];

const BLOCKED = new Set([...NOVELTY_VOICES, ...ELOQUENCE_VOICES].map((n) => n.toLowerCase()));

/** Known system voices by sex (a fact about the voice catalog, not about any NPC). */
const FEMALE = new Set(
  'samantha karen moira tessa tara veena sangeeta lekha isha allison ava susan zoe noelle joelle serena kate fiona martha catherine nicky zira hazel aria jenny sonia libby michelle emma ana natasha clara jane sara nancy heera neerja molly maisie hayley elizabeth cora monica amber ashley salli joanna kendra kimberly ivy kajal ruth olivia aditi raveena'.split(' '),
);
const MALE = new Set(
  'daniel rishi aman alex tom evan nathan oliver arthur lee gordon aaron david mark george guy ryan christopher eric roger steffan andrew brian thomas william liam mitchell prabhat connor brandon jacob tony davis jason matthew joey justin kevin russell geraint'.split(' '),
);
/** normal-quality voices people know (Apple's built-ins, Windows desktop voices) */
const KNOWN_NORMAL = new Set(
  'samantha daniel karen moira tessa rishi aman tara alex allison ava susan tom zoe evan nathan noelle joelle serena kate oliver fiona arthur martha catherine gordon lee veena sangeeta david zira mark hazel george'.split(' '),
);

/** "Eddy (English (UK))" → "Eddy", "Microsoft Aria Online (Natural) - English (United States)" → "Microsoft Aria Online" */
export function baseVoiceName(name: string): string {
  return name.replace(/\s*\(.*$/, '').replace(/\s+-\s+.*$/, '').trim();
}

export function isBlockedVoice(v: VoiceLike): boolean {
  if (BLOCKED.has(baseVoiceName(v.name).toLowerCase())) return true;
  return /com\.apple\.eloquence\./i.test(v.voiceURI ?? '');
}

/** 3 = Premium/Neural/Natural/Microsoft Online, 2 = Enhanced/Google, 1 = known normal voice, 0 = other */
export function voiceQuality(v: VoiceLike): number {
  const n = v.name;
  if (/\b(premium|neural|natural)\b/i.test(n) || /\bmicrosoft\b.*\bonline\b/i.test(n)) return 3;
  if (/\benhanced\b/i.test(n) || /\bgoogle\b/i.test(n) || /\.(premium|enhanced)\./i.test(v.voiceURI ?? '')) return 2;
  return baseVoiceName(n)
    .toLowerCase()
    .split(/\s+/)
    .some((w) => KNOWN_NORMAL.has(w))
    ? 1
    : 0;
}

/** Sex of a system voice when its name tells (known names, "Female"/"Male"), else undefined. */
export function voiceSex(v: VoiceLike): Sex | undefined {
  const n = v.name.toLowerCase();
  if (/\bfemale\b/.test(n)) return 'F';
  if (/\bmale\b/.test(n)) return 'M';
  if (/^google us english$/.test(n.trim())) return 'F';
  for (const w of baseVoiceName(n).split(/\s+/)) {
    if (FEMALE.has(w)) return 'F';
    if (MALE.has(w)) return 'M';
  }
  return undefined;
}

export function langRegion(lang: string): { lang: string; region: string } {
  const [l = '', r = ''] = lang.replace(/_/g, '-').split('-');
  return { lang: l.toLowerCase(), region: r.toUpperCase() };
}

/** 3 exact accent, 2 close (GB ↔ IE/AU/NZ/ZA/Scotland, US ↔ CA), 1 other English */
export function accentScore(want: VoiceLang, lang: string): number {
  const { region } = langRegion(lang);
  const w = want === 'en-GB' ? 'GB' : 'US';
  if (region === w) return 3;
  if (w === 'GB' && ['IE', 'AU', 'NZ', 'ZA', 'SC'].includes(region)) return 2;
  if (w === 'US' && region === 'CA') return 2;
  return 1;
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Best English, non-blocked voice for a speaker: sex match first, then quality class
 * (high-quality > known normal > other), then accent, then Premium/Natural over Enhanced/Google;
 * exact ties are spread across speakers by a stable hash of the speaker key.
 */
export function pickBrowserVoice<V extends VoiceLike>(voices: readonly V[], want: { sex?: Sex; lang: VoiceLang }, key: string): V | null {
  let best: V | null = null;
  let bestScore: number[] = [];
  for (const v of voices) {
    if (langRegion(v.lang).lang !== 'en' || isBlockedVoice(v)) continue;
    const sex = voiceSex(v);
    const sexScore = !want.sex || !sex ? 1 : sex === want.sex ? 2 : 0;
    const q = voiceQuality(v);
    const score = [sexScore, Math.min(q, 2), accentScore(want.lang, v.lang), q, hash32(`${key}|${v.name}`)];
    if (!best || compare(score, bestScore) > 0) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Stable per-speaker prosody: pitch 1 ± 0.04, rate (0.95–1.05) × cast speed. */
export function browserProsody(key: string, speed = 1): { pitch: number; rate: number } {
  const h = hash32(key);
  const u1 = (h & 0xffff) / 0x10000;
  const u2 = (h >>> 16) / 0x10000;
  const rate = Math.min(1.25, Math.max(0.75, speed * (0.95 + 0.1 * u1)));
  return { pitch: Math.round((1 + (u2 - 0.5) * 0.08) * 1000) / 1000, rate: Math.round(rate * 1000) / 1000 };
}

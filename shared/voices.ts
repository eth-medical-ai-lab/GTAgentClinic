/**
 * NPC voice casting: the Kokoro-82M English voices (hexgrad, Apache-2.0, as shipped with kokoro-js 1.2)
 * plus small pure helpers shared by the server (casting, synthesis) and the client (browser fallback).
 *
 * Voice ids encode accent + sex in the prefix: af/am = American English female/male,
 * bf/bm = British English female/male. Sex is always taken from this authored casting (or a
 * patient's chart sex) — never inferred from a character's name.
 */
import type { Sex } from './types';

/** grade = the model authors' overall quality grade; f0 = measured median pitch (Hz) on a reference sentence */
export const KOKORO_VOICES = {
  af_heart: { grade: 'A', f0: 195 },
  af_bella: { grade: 'A-', f0: 195 },
  af_nicole: { grade: 'B-', f0: 155, note: 'whispery and very slow — not cast' },
  af_aoede: { grade: 'C+', f0: 179 },
  af_kore: { grade: 'C+', f0: 159 },
  af_sarah: { grade: 'C+', f0: 192 },
  af_alloy: { grade: 'C', f0: 145 },
  af_nova: { grade: 'C', f0: 162 },
  af_sky: { grade: 'C-', f0: 156 },
  af_jessica: { grade: 'D', f0: 209 },
  af_river: { grade: 'D', f0: 174 },
  am_fenrir: { grade: 'C+', f0: 148 },
  am_michael: { grade: 'C+', f0: 112 },
  am_puck: { grade: 'C+', f0: 112 },
  am_echo: { grade: 'D', f0: 110 },
  am_eric: { grade: 'D', f0: 156 },
  am_liam: { grade: 'D', f0: 126 },
  am_onyx: { grade: 'D', f0: 85 },
  am_santa: { grade: 'D-', f0: 154 },
  am_adam: { grade: 'F+', f0: 114, note: 'lowest quality — not cast' },
  bf_emma: { grade: 'B-', f0: 183 },
  bf_isabella: { grade: 'C', f0: 203 },
  bf_alice: { grade: 'D', f0: 207 },
  bf_lily: { grade: 'D', f0: 202 },
  bm_george: { grade: 'C', f0: 140 },
  bm_fable: { grade: 'C', f0: 129 },
  bm_lewis: { grade: 'D+', f0: 89 },
  bm_daniel: { grade: 'D', f0: 124 },
} as const satisfies Record<string, { grade: string; f0: number; note?: string }>;

export type KokoroVoiceId = keyof typeof KOKORO_VOICES;

/** Authored TTS casting for one character. speed: 1 = normal, elderly speakers ≈ 0.85–0.95. */
export interface TtsVoice {
  id: KokoroVoiceId;
  speed?: number;
}

export type VoiceLang = 'en-US' | 'en-GB';

export function isKokoroVoice(id: unknown): id is KokoroVoiceId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(KOKORO_VOICES, id);
}

/** Sex and accent of a Kokoro voice id, from its prefix (af/am/bf/bm). */
export function voiceTraits(id: string): { sex: Sex; lang: VoiceLang } | null {
  const m = /^([ab])([fm])_/.exec(id);
  if (!m) return null;
  return { sex: m[2] === 'f' ? 'F' : 'M', lang: m[1] === 'a' ? 'en-US' : 'en-GB' };
}

export const MIN_SPEED = 0.7;
export const MAX_SPEED = 1.3;

export function clampSpeed(speed: number | undefined): number {
  const s = typeof speed === 'number' && Number.isFinite(speed) ? speed : 1;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) * 100) / 100;
}

/** default pace by age when the casting gives none: a little slower for elderly speakers */
export function ageSpeed(age: number | undefined): number {
  if (age === undefined) return 1;
  return age >= 80 ? 0.88 : age >= 70 ? 0.93 : age >= 65 ? 0.96 : 1;
}

/** Fallback for a patient without an authored voice, from the chart's sex and age. */
export function defaultPatientVoice(sex: Sex, age: number): Required<TtsVoice> {
  const id: KokoroVoiceId =
    sex === 'F' ? (age < 35 ? 'af_aoede' : age < 65 ? 'af_kore' : 'af_alloy') : age < 35 ? 'am_puck' : age < 65 ? 'am_michael' : 'am_fenrir';
  return { id, speed: ageSpeed(age) };
}

/**
 * Used only when content forgot to cast someone (tests require casting for all shipped content).
 * There is no sex-neutral Kokoro voice, so this is a fixed, clearly flagged default.
 */
export const UNCAST_VOICE: Required<TtsVoice> = { id: 'af_heart', speed: 1 };

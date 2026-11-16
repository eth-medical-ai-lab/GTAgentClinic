import { describe, expect, it } from 'vitest';
import { captionForLine, noteLine, revealed, transcriptKey } from '../client/src/ui/captions';
import { browserProsody, ELOQUENCE_VOICES, isBlockedVoice, NOVELTY_VOICES, pickBrowserVoice, voiceQuality, voiceSex, type VoiceLike } from '../client/src/ui/voicePick';
import { CASES, SCENARIOS } from '../content/scenarios';
import type { TtsVoice } from '../content/types';
import { NpcBrain } from '../server/npc/brain';
import { GameSession } from '../server/sim/session';
import { castVoice } from '../server/tts/casting';
import { clipId, parseTtsMode, TtsService } from '../server/tts/index';
import { concatWav, encodeWav, normalizeLoudness, wavInfo } from '../server/tts/wav';
import { speechChunks, speechText, splitSentences } from '../shared/speechText';
import { isKokoroVoice, voiceTraits } from '../shared/voices';

it('keeps an earlier tablet reply complete when the same words are spoken again', () => {
  const text = "I'm feeling a little better.";
  const first = transcriptKey('shift-a', 'l1');
  const second = transcriptKey('shift-a', 'l2');
  const oldReply = noteLine('patient', text, false, first);
  oldReply.done = true;
  const newReply = noteLine('patient', text, false, second);
  noteLine('another-speaker', text, false);
  expect(revealed(captionForLine(first)!, newReply.arrived)).toBe(text.length);
  expect(revealed(captionForLine(second)!, newReply.arrived)).toBe(0);
  expect(captionForLine(transcriptKey('shift-b', 'l1'))).toBeUndefined();
});

// macOS Sonoma/Sequoia English voices as speechSynthesis lists them (`say -v '?'`)
const regional = (n: string) => [
  { name: `${n} (English (US))`, lang: 'en-US' },
  { name: `${n} (English (UK))`, lang: 'en-GB' },
];
const MAC: VoiceLike[] = [
  ...NOVELTY_VOICES.slice(0, 19).map((name) => ({ name, lang: 'en-US' })),
  ...ELOQUENCE_VOICES.flatMap(regional),
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Karen', lang: 'en-AU' },
  { name: 'Moira', lang: 'en-IE' },
  { name: 'Tessa', lang: 'en-ZA' },
  { name: 'Rishi', lang: 'en-IN' },
  { name: 'Aman', lang: 'en-IN' },
  { name: 'Tara', lang: 'en-IN' },
];
const NORMAL = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi', 'Aman', 'Tara'];

const want = (id: string) => {
  const t = voiceTraits(id)!;
  return { sex: t.sex, lang: t.lang };
};

describe('browser voice fallback', () => {
  it('blocks every macOS novelty and Eloquence voice, and nothing normal', () => {
    expect(MAC).toHaveLength(43);
    const blocked = MAC.filter(isBlockedVoice).map((v) => v.name);
    expect(blocked).toHaveLength(35);
    for (const n of NORMAL) expect(isBlockedVoice({ name: n, lang: 'en-US' })).toBe(false);
    expect(isBlockedVoice({ name: 'Zarvox', lang: 'en-US' })).toBe(true);
    expect(isBlockedVoice({ name: 'Grandpa (English (UK))', lang: 'en-GB' })).toBe(true);
    expect(isBlockedVoice({ name: 'Shelley', lang: 'en-US', voiceURI: 'com.apple.eloquence.en-US.Shelley' })).toBe(true);
  });

  it('never picks a blocked voice, for any cast voice or speaker', () => {
    for (const id of ['af_heart', 'am_fenrir', 'bf_emma', 'bm_george']) {
      for (let k = 0; k < 40; k++) {
        const v = pickBrowserVoice(MAC, want(id), `npc_${k}`);
        expect(v && NORMAL.includes(v.name)).toBe(true);
      }
    }
    expect(pickBrowserVoice(MAC.filter(isBlockedVoice), { sex: 'F', lang: 'en-US' }, 'x')).toBeNull();
  });

  it('matches sex and accent on a stock Mac', () => {
    expect(pickBrowserVoice(MAC, want('af_heart'), 'att_shaw')!.name).toBe('Samantha');
    expect(pickBrowserVoice(MAC, want('bm_george'), 'radiology')!.name).toBe('Daniel');
    // no British female voice: a Commonwealth female voice, never Daniel or a novelty voice
    for (let k = 0; k < 20; k++) expect(['Karen', 'Moira', 'Tessa']).toContain(pickBrowserVoice(MAC, want('bf_emma'), `k${k}`)!.name);
    // no US male voice installed: still a male voice
    for (let k = 0; k < 20; k++) expect(['Daniel', 'Rishi', 'Aman']).toContain(pickBrowserVoice(MAC, want('am_michael'), `k${k}`)!.name);
  });

  it('prefers high-quality voices', () => {
    const rich: VoiceLike[] = [
      ...MAC,
      { name: 'Samantha (Enhanced)', lang: 'en-US' },
      { name: 'Ava (Premium)', lang: 'en-US' },
      { name: 'Google UK English Female', lang: 'en-GB', localService: false },
      { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US' },
    ];
    expect(voiceQuality({ name: 'Ava (Premium)', lang: 'en-US' })).toBeGreaterThan(voiceQuality({ name: 'Samantha', lang: 'en-US' }));
    expect(pickBrowserVoice(rich, want('af_heart'), 'a')!.name).toBe('Ava (Premium)');
    expect(pickBrowserVoice(rich, want('bf_emma'), 'b')!.name).toBe('Google UK English Female');
    expect(pickBrowserVoice(rich, want('am_puck'), 'c')!.name).toMatch(/Microsoft Guy Online/);
    expect(voiceSex({ name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US' })).toBe('M');
    expect(voiceSex({ name: 'Google UK English Female', lang: 'en-GB' })).toBe('F');
  });

  it('uses the best normal voice rather than a mismatched novelty voice', () => {
    const few: VoiceLike[] = [{ name: 'Samantha', lang: 'en-US' }, { name: 'Fred', lang: 'en-US' }, { name: 'Ralph', lang: 'en-US' }, { name: 'Rocko (English (US))', lang: 'en-US' }];
    expect(pickBrowserVoice(few, want('am_onyx'), 'sec_dave')!.name).toBe('Samantha');
  });

  it('keeps prosody natural and stable per NPC', () => {
    for (let k = 0; k < 200; k++) {
      const p = browserProsody(`npc_${k}`);
      expect(p.pitch).toBeGreaterThanOrEqual(0.96);
      expect(p.pitch).toBeLessThanOrEqual(1.04);
      expect(p.rate).toBeGreaterThanOrEqual(0.95);
      expect(p.rate).toBeLessThanOrEqual(1.05);
    }
    expect(browserProsody('rn_rosa')).toEqual(browserProsody('rn_rosa'));
    expect(browserProsody('pt_x', 0.86).rate).toBeLessThan(0.91); // elderly casting stays slower
  });
});

describe('voice casting (content)', () => {
  const brain = new NpcBrain(null);

  it('casts every speaking character with a valid Kokoro voice', () => {
    const missing: string[] = [];
    const check = (who: string, v: TtsVoice | undefined) => {
      if (!v || !isKokoroVoice(v.id) || v.id === 'af_nicole' || v.id === 'am_adam') missing.push(who);
    };
    for (const sc of Object.values(SCENARIOS)) {
      for (const st of sc.staff) check(st.id, st.voice);
      for (const pc of sc.internalContacts) check(pc.contact.id, pc.voice);
    }
    for (const c of Object.values(CASES)) {
      check(`${c.id} patient`, c.patient.voice);
      if (c.family) check(c.family.npcId, c.family.voice);
      for (const pc of c.phoneContacts ?? []) check(pc.contact.id, pc.voice);
    }
    expect(missing).toEqual([]);
  });

  it('gives characters who share a scenario floor distinct voices', () => {
    for (const sc of Object.values(SCENARIOS)) {
      const seen = new Map<string, string>();
      const add = (who: string, v?: TtsVoice) => {
        expect(seen.get(v!.id), `${sc.id}: ${who} shares ${v!.id} with ${seen.get(v!.id)}`).toBeUndefined();
        seen.set(v!.id, who);
      };
      for (const st of sc.staff) add(st.id, st.voice);
      for (const { caseId } of sc.patients) {
        const c = CASES[caseId];
        add(`${caseId} patient`, c.patient.voice);
        if (c.family) add(c.family.npcId, c.family.voice);
      }
    }
  });

  it('matches chart sex, slows elderly patients, and keeps one voice per person', () => {
    for (const c of Object.values(CASES)) {
      expect(voiceTraits(c.patient.voice!.id)!.sex, c.id).toBe(c.patient.sex);
      if (c.patient.age >= 70) expect(c.patient.voice!.speed ?? 1, c.id).toBeLessThan(0.95);
    }
    const sabine = CASES.urosepsis_esbl;
    expect(sabine.phoneContacts!.find((p) => p.contact.id === 'fam_sabine_phone')!.voice!.id).toBe(sabine.family!.voice!.id);
  });

  it('resolves speech events to the authored voice', () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 7, playerName: 'Test', mode: 'step', brain });
    const brunner = [...s.patients.values()].find((p) => p.c.patient.lastName === 'Brunner')!;
    expect(castVoice(s, { kind: 'speech', npcId: 'att_shaw', name: 'Dr. Evelyn Shaw', text: 'Hi.' })).toMatchObject({ id: 'af_heart', phone: false });
    expect(castVoice(s, { kind: 'speech', npcId: `pt_${brunner.id}`, name: 'Margarethe', text: 'Grüezi.' })).toMatchObject({ id: 'bf_emma', speed: 0.86 });
    expect(castVoice(s, { kind: 'speech', npcId: 'fam_sabine', name: 'Sabine', text: 'Mom?' })).toMatchObject({ id: 'af_kore' });
    const gp = brunner.c.phoneContacts![0];
    expect(castVoice(s, { kind: 'speech', contactId: 'gp_whitfield', name: 'x', text: gp.persona.opening })).toMatchObject({ id: 'af_aoede', phone: true });
    expect(castVoice(s, { kind: 'speech', contactId: 'gp_whitfield', name: 'x', text: 'Mehta here.' })).toMatchObject({ id: 'bm_daniel', phone: true });
    expect(castVoice(s, { kind: 'speech', contactId: 'cards', name: 'x', text: 'Cards.' })).toMatchObject({ id: 'bf_isabella', phone: true });
  });
});

describe('speech text', () => {
  it('drops stage directions and keeps the words', () => {
    expect(speechText('*coughs*')).toBe('');
    expect(speechText('*winces* It hurts here. (sighs) Right here.')).toBe('It hurts here. Right here.');
    expect(speechText('**Stop** — check the wristband! 🙏')).toBe('Stop — check the wristband!');
    expect(speechText('[Situation 22:10: …] Okay.')).toBe('Okay.');
  });

  it('rewrites clinical shorthand speech engines misread', () => {
    expect(speechText('Metoprolol 5 mg IV, BP 94/56.')).toBe('Metoprolol 5 milligrams I-V, B-P 94 over 56.');
    expect(speechText('1 g IV q8h')).toBe('1 gram I-V every 8 hours');
    expect(speechText('Call x4410 or 555-0163.')).toBe('Call extension 4 4 1 0 or 5 5 5, 0 1 6 3.');
    expect(speechText('Ref PA-4417-882.')).toBe('Ref P A, 4 4 1 7, 8 8 2.');
    expect(speechText('Take her to the OR, then the ICU.')).toBe('Take her to the O-R, then the I-C-U.');
    expect(speechText('Creatinine 2.1 mg/dL, lactate 3.4 mmol/L.')).toBe('Creatinine 2.1, lactate 3.4.');
    expect(speechText('Seen 12/14/2026.')).toBe('Seen 12/14/2026.');
  });

  it('splits sentences without breaking abbreviations, initials or decimals', () => {
    expect(splitSentences('Dr. Shaw saw her. E. coli grew. Temp 38.7 now! Okay?')).toEqual(['Dr. Shaw saw her.', 'E. coli grew.', 'Temp 38.7 now!', 'Okay?']);
    expect(splitSentences('Grüezi... who are you? I have to go home.')).toEqual(['Grüezi... who are you?', 'I have to go home.']);
    // short sentences merge into the first chunk; long replies split so the first audio comes fast
    expect(speechChunks("I... I don't know. Where is Sabine?")).toEqual(["I... I don't know. Where is Sabine?"]);
    const chunks = speechChunks("Doc, it's like an elephant's sitting on my chest. Probably just heartburn, but Linda made me come in.");
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBeLessThanOrEqual(80);
  });
});

describe('server TTS plumbing (no model)', () => {
  it('encodes 16-bit PCM WAV and joins clips', () => {
    const x = new Float32Array(24000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 24000));
    const info = wavInfo(encodeWav(x, 24000));
    expect(info).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, samples: 24000 });
    expect(info.rms).toBeGreaterThan(0.2);
    const joined = wavInfo(concatWav([encodeWav(x, 24000), encodeWav(x, 24000)], 0.1));
    expect(joined.durationS).toBeCloseTo(2.1, 2);
    const quiet = x.map((v) => v * 0.1);
    normalizeLoudness(quiet, 24000);
    expect(wavInfo(encodeWav(quiet, 24000)).rms).toBeGreaterThan(0.08);
  });

  it('parses the --tts flag and hashes clips by voice + speed + text', () => {
    expect(parseTtsMode(undefined)).toBe('kokoro');
    expect(parseTtsMode('browser')).toBe('browser');
    expect(parseTtsMode('OFF')).toBe('off');
    expect(clipId('af_heart', 1, 'Hi.')).toBe(clipId('af_heart', 1, 'Hi.'));
    expect(new Set([clipId('af_heart', 1, 'Hi.'), clipId('af_bella', 1, 'Hi.'), clipId('af_heart', 1.04, 'Hi.'), clipId('af_heart', 1, 'Hi!')]).size).toBe(4);
  });

  it('decorates speech events per mode without blocking', () => {
    const s = new GameSession({ scenarioId: 'orientation', seed: 3, playerName: 'Test', mode: 'step', brain: new NpcBrain(null) });
    const e = { kind: 'speech' as const, npcId: 'rn_rosa', name: 'Rosa Delgado', text: 'The ambulance is here with an elderly lady from the nursing home. *sighs* Bed 4 is ready for her, and I already paged the attending.' };
    expect(new TtsService('off').speech(s, e, () => true)).toBe(e);
    expect(new TtsService('browser').speech(s, e, () => true).voice).toEqual({ id: 'af_bella', speed: 1.04 });
    // pretend the model is loaded (no worker): clip ids come back immediately, one per sentence
    const k = new TtsService('kokoro');
    k.status = 'ready';
    const out = k.speech(s, e, () => true).voice!;
    expect(out.clips!.map((c) => c.text)).toEqual(['The ambulance is here with an elderly lady from the nursing home.', 'Bed 4 is ready for her, and I already paged the attending.']);
    expect(out.clips![0].id).toBe(clipId('af_bella', 1.04, 'The ambulance is here with an elderly lady from the nursing home.'));
    // nobody listening: voice only, nothing queued
    expect(new TtsService('kokoro').speech(s, e, () => false).voice!.clips).toBeUndefined();
  });
});

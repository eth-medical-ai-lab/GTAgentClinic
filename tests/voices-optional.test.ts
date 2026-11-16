/**
 * The neural voices are optional (voices/, `npm run voices:install`): without the engine the server
 * speaks with browser voices and says how to get neural ones; with it, Kokoro loads from
 * voices/engine.mjs, or from the game's own node_modules in older installs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTts, findVoiceEngine, TtsService, VOICES_NOT_INSTALLED } from '../server/tts/index';

const tmp = mkdtempSync(path.join(tmpdir(), 'ac-voices-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** a checkout whose node_modules (or voices/node_modules) holds stand-ins for the two engine packages */
function checkout(name: string, where: 'none' | 'game' | 'voices'): string {
  const root = path.join(tmp, name);
  mkdirSync(root, { recursive: true });
  const base = where === 'voices' ? path.join(root, 'voices') : root;
  if (where !== 'none') {
    for (const pkg of ['kokoro-js', '@huggingface/transformers']) {
      mkdirSync(path.join(base, 'node_modules', pkg), { recursive: true });
      writeFileSync(path.join(base, 'node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0' }));
    }
  }
  if (where === 'voices') writeFileSync(path.join(root, 'voices', 'engine.mjs'), '');
  return root;
}

describe('optional neural voices', () => {
  it('without the engine: browser voices, with a one-line hint for npm start, the menu and /api/tts', () => {
    const root = checkout('none', 'none');
    expect(findVoiceEngine(root)).toBeNull();
    const tts = createTts(undefined, root);
    expect(tts.mode).toBe('browser');
    expect(tts.note).toBe(VOICES_NOT_INSTALLED);
    expect(tts.note).toMatch(/npm run voices:install/);
    expect(tts.label).toBe(`browser voices · ${VOICES_NOT_INSTALLED}`);
    expect(tts.info()).toMatchObject({ mode: 'browser', status: 'browser', note: VOICES_NOT_INSTALLED });
    // and it never tries to start the worker
    tts.warm();
    expect(tts.status).toBe('idle');
  });

  it('installed with npm run voices:install: kokoro, loaded through voices/engine.mjs', () => {
    const root = checkout('voices', 'voices');
    const e = findVoiceEngine(root);
    expect(e?.where).toBe('voices');
    expect(e?.entry).toMatch(/^file:.*\/voices\/engine\.mjs$/);
    const tts = createTts('kokoro', root);
    expect(tts.mode).toBe('kokoro');
    expect(tts.note).toBeUndefined();
    expect(tts.engine.entry).toBe(e!.entry);
  });

  it("an older install with the packages in the game's own node_modules works as before", () => {
    const root = checkout('game', 'game');
    expect(findVoiceEngine(root)).toEqual({ where: 'game' });
    const tts = createTts(undefined, root);
    expect(tts.mode).toBe('kokoro');
    expect(tts.engine.entry).toBeUndefined();
  });

  it('--tts browser and --tts off need no engine and add no hint', () => {
    const root = checkout('none2', 'none');
    expect(createTts('browser', root)).toMatchObject({ mode: 'browser', note: undefined });
    expect(createTts('off', root)).toMatchObject({ mode: 'off', note: undefined });
    expect(new TtsService('browser').label).toBe('browser voices (--tts browser)');
  });
});

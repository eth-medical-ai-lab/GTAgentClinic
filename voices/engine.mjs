/**
 * The optional neural-voice engine (Kokoro-82M via kokoro-js and transformers.js, about 440 MB of
 * packages). It lives in its own folder so a default `npm install` of the game stays small:
 * `npm run voices:install` installs it into voices/node_modules, and `npm install` or `npm ci` in
 * the game folder leave it alone. server/tts/worker.mjs imports this file when the packages are not
 * in the game's own node_modules.
 */
export * as tf from '@huggingface/transformers';
export { KokoroTTS } from 'kokoro-js';

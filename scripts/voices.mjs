#!/usr/bin/env node
/**
 * Optional neural NPC voices: Kokoro-82M through kokoro-js and transformers.js (about 440 MB of
 * packages, mostly the ONNX runtime). They have their own folder and lockfile (voices/), so a
 * default install of the game stays small and `npm install` / `npm ci` in the game folder leave
 * them alone. Without them the game speaks with the browser's own voices.
 *
 *   npm run voices:install     install them into voices/node_modules, then restart the game
 *   npm run voices:remove      remove them again (the downloaded voice model is kept; see below)
 *   node scripts/voices.mjs status
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'voices');
const modules = path.join(dir, 'node_modules');
const c = { dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };

/** where the server keeps the downloaded model (same rule as server/tts/index.ts defaultCacheDir) */
function modelDir() {
  if (process.env.AGENTCLINIC_CACHE_DIR) return path.join(process.env.AGENTCLINIC_CACHE_DIR, 'models');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'GTAgentClinic', 'cache', 'models');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'GTAgentClinic', 'models');
}

function bytes(p) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else n += lstatSync(f).size;
    }
  };
  if (existsSync(p)) walk(p);
  return n;
}
const mb = (n) => `${Math.round(n / 1e6)} MB`;
const installedIn = (base) => existsSync(path.join(base, 'node_modules', 'kokoro-js', 'package.json')) && existsSync(path.join(base, 'node_modules', '@huggingface', 'transformers', 'package.json'));

const cmd = process.argv[2] ?? 'status';
if (cmd === 'install') {
  console.log(`${c.dim}  Installing the neural voice engine into voices/node_modules (about 440 MB; a minute or two)…${c.reset}`);
  const r = spawnSync('npm', [existsSync(path.join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-fund', '--no-audit'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 || !installedIn(dir)) {
    console.error(`${c.red}  The voice engine did not install (see above).${c.reset} The game still works with browser voices. Check your internet connection and try again.`);
    process.exit(r.status || 1);
  }
  console.log(`  ${c.green}●${c.reset} Neural voices installed (${mb(bytes(modules))} in voices/node_modules).`);
  console.log(`${c.dim}    Restart the game (Ctrl+C, then npm start) and turn voices on with 🔊. The first time, the server`);
  console.log(`    downloads the Kokoro-82M model (about 326 MB) to ${modelDir()}.${c.reset}`);
} else if (cmd === 'remove') {
  if (!existsSync(modules)) console.log('  The neural voice engine is not installed in voices/node_modules.');
  else {
    const n = bytes(modules);
    rmSync(modules, { recursive: true, force: true });
    console.log(`  ${c.yellow}◌${c.reset} Removed the neural voice engine (${mb(n)}). NPCs use browser voices after the next npm start.`);
  }
  if (existsSync(modelDir())) console.log(`${c.dim}    The downloaded voice model stays in ${modelDir()} (${mb(bytes(modelDir()))}); delete that folder too if you like.${c.reset}`);
} else if (cmd === 'status') {
  if (installedIn(dir)) console.log(`  ${c.green}●${c.reset} Neural voices: installed in voices/node_modules (${mb(bytes(modules))}).`);
  else if (installedIn(root)) console.log(`  ${c.green}●${c.reset} Neural voices: in the game's own node_modules, left from an older install. The next npm install removes them; npm run voices:install keeps neural voices.`);
  else console.log(`  ${c.yellow}◌${c.reset} Neural voices: not installed, so NPCs use browser voices. npm run voices:install adds them (about 440 MB).`);
  const m = modelDir();
  console.log(`${c.dim}    Voice model cache: ${m}${existsSync(m) ? ` (${mb(bytes(m))})` : ' (empty: downloaded on first use, about 326 MB)'}${c.reset}`);
} else {
  console.error('Usage: node scripts/voices.mjs install | remove | status');
  process.exit(2);
}

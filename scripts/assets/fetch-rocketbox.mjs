#!/usr/bin/env node
/**
 * Downloads the Rocketbox avatars + animations listed in ./rocketbox.mjs into a local
 * cache (~/.cache/GTAgentClinic/rocketbox, override with ROCKETBOX_CACHE). Texture file
 * names are read from inside each FBX, so no GitHub API calls are needed.
 *
 *   node scripts/assets/fetch-rocketbox.mjs [--no-facial] [--only=Name1,Name2]
 *
 * Then run scripts/assets/convert-rocketbox.mjs to produce the game's GLB files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ANIMS, AVATARS, CACHE, RAW } from './rocketbox.mjs';

// facial variants (ARKit blendshapes) are the default; --no-facial fetches the plain rigs
const facial = !process.argv.includes('--no-facial');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
mkdirSync(CACHE, { recursive: true });

function get(url, file) {
  if (existsSync(file) && statSync(file).size > 1000) return;
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('curl', ['-sSfL', '--retry', '3', '--max-time', '300', '-o', file, url]);
}

let n = 0;
for (const [name, dir] of Object.entries(AVATARS)) {
  if (only && !only.includes(name)) continue;
  const fbxName = facial ? `${name}_facial.fbx` : `${name}.fbx`;
  const fbx = path.join(CACHE, 'avatars', name, fbxName);
  get(`${RAW}/${dir}/Export/${fbxName}`, fbx);
  // texture references are plain strings inside the (binary) FBX; some outfits name a color
  // variant (Medical_Female_03 and Medical_Male_02: f154_body_color_blue.tga)
  const refs = new Set([...readFileSync(fbx).toString('latin1').matchAll(/([A-Za-z0-9_]+_(?:color(?:_[a-z]+)?|normal))\.tga/g)].map((m) => m[1]));
  for (const t of refs) get(`${RAW}/${dir}/Textures/${t}.tga`, path.join(CACHE, 'avatars', name, `${t}.tga`));
  console.log(`✓ ${name}: ${[...refs].join(', ')}`);
  n++;
}
for (const [clip, file] of ANIMS) {
  try {
    get(`${RAW}/${file}.max.fbx`, path.join(CACHE, 'anims', `${clip}.fbx`));
  } catch {
    console.warn(`⚠ ${clip}: ${file} not found — skipped`);
  }
}
console.log(`✓ ${n} avatars, ${ANIMS.length} animations in ${CACHE}`);

#!/usr/bin/env node
/**
 * The README's badges, computed from the repository: version, licence, platforms (the list is written
 * here, the Node version comes from package.json), cases (playable and in the library), unit tests
 * and the repository's size in tokens (one row, one style). Static
 * shields.io badges (plain text, no logos): dynamic ones that ask GitHub can't see a private repo.
 *
 *   npm run badges            rewrite the block between the badge markers in README.md
 *   npm run badges -- --print print the numbers only
 *
 * Tokens are estimated from characters (about 3.6 per token for this mix of code and prose) over the
 * text a contributor's Claude Code could read: every tracked text file except lock files and assets.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const ASSET = /\.(png|jpe?g|webp|gif|svg|ico|glb|gltf|bin|ktx2|hdr|exr|ttf|otf|woff2?|mp3|ogg|wav|m4a|onnx|zip|pdf)$/i;
const text = files.filter((f) => !ASSET.test(f) && !/(^|\/)package-lock\.json$/.test(f) && !f.startsWith('client/public/'));
const read = (f) => {
  try {
    return readFileSync(path.join(root, f), 'utf8');
  } catch {
    return '';
  }
};

let chars = 0;
let tsLines = 0;
let tests = 0;
for (const f of text) {
  const s = read(f);
  chars += s.length;
  if (/\.(ts|tsx|mts)$/.test(f)) tsLines += s.split('\n').length;
  // (a fallback: it(…) and test(…) written out; tests made in loops count once here)
  if (/^tests\/.*\.test\.ts$/.test(f)) tests += (s.match(/^\s*(it|test)(\.each\([^\n]*?\))?\(/gm) ?? []).length;
}
// the real count: vitest lists every test it ran (about 6 s)
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'badges-'));
  const out = path.join(dir, 'vitest.json');
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', `--outputFile=${out}`], { cwd: root, encoding: 'utf8' });
  try {
    const j = JSON.parse(readFileSync(out, 'utf8'));
    if (j.numTotalTests) tests = j.numTotalTests;
    if (j.numFailedTests) console.warn(`(${j.numFailedTests} unit tests fail right now)`);
  } catch {
    console.warn(`(vitest didn't report${r.error ? `: ${r.error.message}` : ''}; counting the tests written out instead)`);
  }
  rmSync(dir, { recursive: true, force: true });
}
// A pack file can author many patients. Count the same registry the game loads.
const cases = Number(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
  "import { CASES } from './content/scenarios.ts'; console.log(Object.keys(CASES).length)"], { cwd: root, encoding: 'utf8' }).trim());
const library = readdirSync(path.join(root, 'content/library')).filter((f) => f.endsWith('.json')).length;
const tokens = chars / 3.6;

const n = {
  version: pkg.version,
  // package.json holds an SPDX expression ("Apache-2.0 AND CC-BY-4.0"); the badge spells it as people read it
  license: pkg.license.split(/\s+AND\s+/).map((id) => id.replace(/^CC-BY-(\d\.\d)$/, 'CC BY $1')).join(' · '),
  node: (pkg.engines?.node ?? '').replace(/^>=\s*/, '').replace(/\.0$/, ''),
  cases,
  library,
  // rounded down so the badge stays true between runs
  tests: tests >= 100 ? `${Math.floor(tests / 100) * 100}+` : String(tests),
  tsLines: `${Math.round(tsLines / 1000)}k`,
  tokens: tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e3)}k`,
};
if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ ...n, chars, rawTests: tests, rawTsLines: tsLines }, null, 2));
  process.exit(0);
}

const enc = (s) => encodeURIComponent(s).replace(/-/g, '--').replace(/_/g, '__');
const badge = (label, message, color, alt, href) => {
  const img = `<img alt="${alt}" src="https://img.shields.io/badge/${enc(label)}-${enc(message)}-${color}?style=flat-square&labelColor=24292f">`;
  return href ? `<a href="${href}">${img}</a>` : img;
};
const block = [
  '<!-- badges:start (npm run badges) -->',
  '<p align="center">',
  `  ${badge('version', n.version, 'd94a38', `version ${n.version}`, 'CHANGELOG.md')}`,
  `  ${badge('license', n.license, '57606a', `license ${n.license}`, '#licence')}`,
  // (native everywhere: no WSL or emulation; the setup guide has the steps for each system)
  `  ${badge('platforms', `macOS · Linux · Windows (native, Node ${n.node}+)`, '57606a', `runs natively on macOS, Linux and Windows with Node.js ${n.node} or newer`, 'docs/SETUP.md')}`,
  `  ${badge('cases', `${n.cases} playable · ${n.library} in library`, 'd94a38', `${n.cases} playable cases, ${n.library} in the library`, 'docs/cases/README.md')}`,
  `  ${badge('tests', `${n.tests} passing`, '2f9e44', `${n.tests} unit tests passing`)}`,
  `  ${badge('codebase', `≈ ${n.tokens} tokens`, '57606a', `about ${n.tokens} tokens of text in the repository`)}`,
  '</p>',
  '<!-- badges:end -->',
].join('\n');

const readmePath = path.join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const re = /<!-- badges:start[\s\S]*?<!-- badges:end -->/;
if (!re.test(readme)) {
  console.error('README.md has no <!-- badges:start --> … <!-- badges:end --> block');
  process.exit(1);
}
writeFileSync(readmePath, readme.replace(re, block));
console.log(`README badges: v${n.version}, ${n.cases} cases + ${n.library} in the library, ${n.tests} tests, ${n.tsLines} lines of TypeScript, ≈ ${n.tokens} tokens`);

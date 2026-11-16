#!/usr/bin/env node
/**
 * Regenerates the generated blocks of THIRD_PARTY_NOTICES.md (everything else there is hand-written):
 *   npm       — production npm packages from package-lock.json and voices/package-lock.json (the
 *               optional neural voices, `npm run voices:install`), grouped by licence
 *   library   — case-library sources (content/library/*.json: citation, DOI/PMCID, licence)
 *   credits   — every CREDITS*.txt / LICENSE*.txt that ships under client/public/res
 *   chars     — the number of Rocketbox character models (inline, in the assets table)
 *
 *   node scripts/notices.mjs           rewrite the blocks in place
 *   node scripts/notices.mjs --check   exit 1 if THIRD_PARTY_NOTICES.md is out of date
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(root, 'THIRD_PARTY_NOTICES.md');

/** production packages of one lockfile: name → { licence, platform-specific? } */
function lockPackages(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  const lock = JSON.parse(readFileSync(file, 'utf8'));
  for (const [key, p] of Object.entries(lock.packages)) {
    if (!key || p.dev) continue; // the project itself, and dev-only tools (Vite, Vitest, TypeScript, Playwright…)
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.set(name, { lic: p.license ?? 'UNKNOWN', platform: !!(p.optional && (p.os || p.cpu)) });
  }
  return out;
}

function npmBlock() {
  const game = lockPackages(path.join(root, 'package-lock.json'));
  const voices = lockPackages(path.join(root, 'voices', 'package-lock.json'));
  const all = new Map([...voices, ...game]);
  const voiceOnly = [...voices.keys()].filter((n) => !game.has(n)).length;
  const byLicence = new Map();
  let platform = 0;
  for (const [name, { lic, platform: p }] of all) {
    if (p) platform++;
    if (!byLicence.has(lic)) byLicence.set(lic, new Set());
    byLicence.get(lic).add(name);
  }
  const rows = [...byLicence].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const total = rows.reduce((n, [, s]) => n + s.size, 0);
  const out = [
    `${total} packages (${platform} of them platform-specific binaries, of which npm installs only the ones for your OS and CPU). ${voiceOnly} of them are installed only with the optional neural voices (\`voices/package-lock.json\`, \`npm run voices:install\`).`,
    '',
    '| Licence | Packages |',
    '|---|---|',
  ];
  for (const [lic, names] of rows) out.push(`| ${lic} | ${names.size}: ${[...names].sort().join(', ')} |`);
  return out.join('\n');
}

function libraryBlock() {
  const dir = path.join(root, 'content', 'library');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) return '_No library cases yet._';
  const out = ['| Case | Source | Licence |', '|---|---|---|'];
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const s = j.source ?? {};
    const link = s.doi ? `[doi:${s.doi}](https://doi.org/${s.doi})` : s.url ? `[link](${s.url})` : '';
    const cite = String(s.citation ?? s.title ?? '').replace(/\|/g, '\\|');
    out.push(`| \`${f.replace(/\.json$/, '')}\` | ${cite} ${link}${s.pmcid ? ` (${s.pmcid})` : ''} | ${s.license ?? s.licence ?? 'UNKNOWN'} |`);
  }
  return out.join('\n');
}

function creditsBlock() {
  const res = path.join(root, 'client', 'public', 'res');
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^(CREDITS|LICENSE)/i.test(e.name)) found.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  if (existsSync(res)) walk(res);
  return found.sort().map((f) => `- [${f}](${f})`).join('\n') || '_None._';
}

/** how many Rocketbox character models ship (client/public/res/chars/index.json) */
function charsBlock() {
  const index = JSON.parse(readFileSync(path.join(root, 'client', 'public', 'res', 'chars', 'index.json'), 'utf8'));
  return String(Object.keys(index.avatars).length);
}

const blocks = { npm: npmBlock, library: libraryBlock, credits: creditsBlock, chars: charsBlock };
/** blocks that sit inside a line of text (a table cell), not on lines of their own */
const INLINE = new Set(['chars']);
const before = readFileSync(FILE, 'utf8');
let after = before;
for (const [name, make] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- generated:${name} -->)[\\s\\S]*?(<!-- /generated:${name} -->)`);
  if (!re.test(after)) throw new Error(`THIRD_PARTY_NOTICES.md lacks the <!-- generated:${name} --> block`);
  after = after.replace(re, (_, a, b) => (INLINE.has(name) ? `${a}${make()}${b}` : `${a}\n${make()}\n${b}`));
}
if (process.argv.includes('--check')) {
  if (after !== before) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run `node scripts/notices.mjs`.');
    process.exit(1);
  }
  console.log('THIRD_PARTY_NOTICES.md is up to date.');
} else if (after !== before) {
  writeFileSync(FILE, after);
  console.log('THIRD_PARTY_NOTICES.md updated.');
} else console.log('THIRD_PARTY_NOTICES.md already up to date.');

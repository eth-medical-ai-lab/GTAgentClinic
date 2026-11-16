#!/usr/bin/env node
/**
 * Fetches the waiting-room crowd's few recorded sounds (everything else in the soundscape is
 * synthesized, see client/src/audio/): a small dog barking in its carrier, and coughs. Only
 * public-domain or CC0 sources:
 *
 *  - dog: "Scottish Terrier Puppies Playing and Barking" (RegicideAudio, Internet Archive, Public
 *    Domain Mark), cut from the 1952 Frith Films short "Mother Mack Trains Her Seven Puppies"
 *    (Prelinger Archives, public domain)
 *  - coughs: "Man coughing" (stilgar) and "Cough 1" (ezwa), both public domain via PDSounds, and
 *    "Woman coughing three times" (Ashe Kirk, CC0), all on Wikimedia Commons
 *
 *   node scripts/assets/fetch-crowd-audio.mjs [--force]
 *
 * Checks each source's licence in its archive's metadata and its SHA-1, cuts single barks and
 * coughs with your local ffmpeg (mono 22.05 kHz MP3; the barks lightly low-passed: the dog is in a
 * fabric carrier), and writes client/public/res/audio/crowd/ with sounds.json, plus the credits in
 * client/public/res/audio/CREDITS.txt. Needs curl and ffmpeg. The output is committed, so players
 * never run this. Requests carry a generic project User-Agent and no personal details.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const audioDir = path.join(root, 'client', 'public', 'res', 'audio');
const out = path.join(audioDir, 'crowd');
const force = process.argv.includes('--force');
const UA = 'GTAgentClinic-asset-fetch/0.2';

/** where each recording comes from, what licence we expect, and its SHA-1 */
const SOURCES = {
  puppies: {
    kind: 'archive',
    item: 'ScottishTerrierPuppiesPlayingAndBarking',
    file: 'ScottishTerrierPuppiesPlayingAndBarking.flac',
    sha1: 'de44097b515eb82a5ef2d7ff49cdd32a65ee0532',
    license: /publicdomain\/(mark|zero)\//,
    credit: 'Scottish Terrier Puppies Playing and Barking, RegicideAudio (2011), Public Domain Mark 1.0; from "Mother Mack Trains Her Seven Puppies" (Frith Films, 1952, Prelinger Archives, public domain) — https://archive.org/details/ScottishTerrierPuppiesPlayingAndBarking',
  },
  man: {
    kind: 'commons',
    title: 'File:Man coughing.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/cc/Man_coughing.ogg',
    sha1: 'a2757926cfef471aeb4267c015f75261a179c510',
    license: /^(Public domain|CC0)$/,
    credit: 'Man coughing, stilgar (PDSounds #625), public domain — https://commons.wikimedia.org/wiki/File:Man_coughing.ogg',
  },
  ezwa: {
    kind: 'commons',
    title: 'File:Cough 1.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/Cough_1.ogg',
    sha1: '2c4ea79935f720e98cc94c9658811c43036cfc06',
    license: /^(Public domain|CC0)$/,
    credit: 'Cough 1, ezwa (PDSounds #440), public domain — https://commons.wikimedia.org/wiki/File:Cough_1.ogg',
  },
  woman: {
    kind: 'commons',
    title: 'File:Woman coughing three times.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/be/Woman_coughing_three_times.wav',
    sha1: '90f623c33a482438cc709a823384e5f193a080e8',
    license: /^(Public domain|CC0)$/,
    credit: 'Woman coughing three times, Ashe Kirk, CC0 1.0 — https://commons.wikimedia.org/wiki/File:Woman_coughing_three_times.wav',
  },
};

/** the cuts: [output, source, start s, end s, what it is] */
const CUTS = [
  ['dog-bark-1.mp3', 'puppies', 0.0, 1.1, 'three yaps'],
  ['dog-bark-2.mp3', 'puppies', 1.1, 1.8, 'two yaps'],
  ['dog-bark-3.mp3', 'puppies', 2.15, 3.05, 'yaps and a grumble'],
  ['cough-m-1.mp3', 'man', 2.0, 3.2, 'two dry coughs'],
  ['cough-m-2.mp3', 'man', 3.38, 4.65, 'a long cough'],
  ['cough-m-3.mp3', 'ezwa', 3.7, 4.9, 'a chesty cough'],
  ['cough-m-4.mp3', 'ezwa', 7.4, 8.25, 'a short cough'],
  ['cough-f-1.mp3', 'woman', 0.0, 1.0, 'three small coughs'],
];

const curl = (url, dest, headers = []) => execFileSync('curl', ['-sSfL', '--max-time', '120', '--retry', '3', '--retry-delay', '2', '--proto', '=https', '-A', UA, ...headers, '-o', dest, url]);
const sha1 = (f) => createHash('sha1').update(readFileSync(f)).digest('hex');

mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'ac-crowd-'));
try {
  const local = {};
  for (const [key, s] of Object.entries(SOURCES)) {
    // the licence as the archive states it today
    if (s.kind === 'archive') {
      curl(`https://archive.org/metadata/${s.item}/metadata`, path.join(tmp, `${key}.json`));
      const lic = JSON.parse(readFileSync(path.join(tmp, `${key}.json`), 'utf8')).result?.licenseurl ?? '';
      if (!s.license.test(lic)) throw new Error(`${s.item}: unexpected licence "${lic}" — stopping`);
      s.url = `https://archive.org/download/${s.item}/${encodeURIComponent(s.file)}`;
    } else {
      const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata|sha1&iiextmetadatafilter=LicenseShortName&titles=${encodeURIComponent(s.title)}`;
      curl(api, path.join(tmp, `${key}.json`));
      const page = Object.values(JSON.parse(readFileSync(path.join(tmp, `${key}.json`), 'utf8')).query.pages)[0];
      const lic = page?.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value ?? '';
      if (!s.license.test(lic)) throw new Error(`${s.title}: unexpected licence "${lic}" — stopping`);
    }
    const src = path.join(tmp, `${key}${path.extname(s.file ?? s.url)}`);
    console.log(`↓ ${key} ← ${s.url}`);
    curl(s.url, src);
    if (sha1(src) !== s.sha1) throw new Error(`${key}: SHA-1 ${sha1(src)} does not match ${s.sha1}`);
    local[key] = src;
  }
  const manifest = [];
  for (const [name, key, a, b, what] of CUTS) {
    const dest = path.join(out, name);
    const dog = key === 'puppies';
    if (force || !existsSync(dest)) {
      const len = b - a;
      const af = ['aformat=channel_layouts=mono', 'highpass=f=90', dog ? 'lowpass=f=4200' : 'lowpass=f=9000', 'afade=t=in:d=0.012', `afade=t=out:st=${(len - 0.07).toFixed(3)}:d=0.07`, 'loudnorm=I=-19:TP=-2:LRA=9'].join(',');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(a), '-t', String(len), '-i', local[key], '-map_metadata', '-1', '-af', af, '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '48k', dest]);
      console.log(`✂ ${name}: ${what}`);
    } else console.log(`✓ ${name} already present`);
    manifest.push({ file: name, kind: dog ? 'dog_bark' : 'cough', voice: name.includes('-f-') ? 'f' : dog ? undefined : 'm', what, source: SOURCES[key].credit });
  }
  writeFileSync(path.join(out, 'sounds.json'), JSON.stringify(manifest, null, 1) + '\n');
  // credits: our section of the shared audio CREDITS.txt (other sections are left alone)
  const credits = path.join(audioDir, 'CREDITS.txt');
  const begin = '── waiting-room crowd (res/audio/crowd) ──';
  const end = '── end waiting-room crowd ──';
  const section = [
    begin,
    'Public domain and CC0 recordings, cut and normalized by scripts/assets/fetch-crowd-audio.mjs (SHA-1 and licence checked at fetch time):',
    ...[...new Set(CUTS.map((c) => c[1]))].map((k) => `  - ${SOURCES[k].credit}`),
    `Files: ${CUTS.map((c) => c[0]).join(', ')}`,
    end,
  ].join('\n');
  let text = existsSync(credits) ? readFileSync(credits, 'utf8') : 'Audio credits for client/public/res/audio (see also radio/CREDITS.txt).\n';
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  text = i >= 0 && j > i ? text.slice(0, i) + section + text.slice(j + end.length) : `${text.trimEnd()}\n\n${section}\n`;
  writeFileSync(credits, text);
  console.log(`✓ ${CUTS.length} sounds in ${path.relative(root, out)}; credits in ${path.relative(root, credits)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

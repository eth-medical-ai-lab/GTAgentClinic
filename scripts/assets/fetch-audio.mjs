#!/usr/bin/env node
/**
 * Fetches the music for the nurses' station radio: four pieces from "The Open Goldberg Variations"
 * (J. S. Bach, BWV 988, played by Kimiko Ishizaka, 2012), which the performer released into the
 * public domain under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Source: the
 * Internet Archive item The_Open_Goldberg_Variations-11823 (license CC0 1.0 in its metadata).
 *
 *   node scripts/assets/fetch-audio.mjs [--force]
 *
 * Downloads the Ogg Vorbis files (audio data only; nothing downloaded is executed), checks each
 * against the SHA-1 in the item's metadata, and transcodes them with your local ffmpeg to small
 * mono MP3s for a radio speaker (22.05 kHz, 32 kb/s) in client/public/res/audio/radio/, with
 * tracks.json and CREDITS.txt. Needs: curl, ffmpeg + ffprobe (brew install ffmpeg). The output is committed,
 * so players never run this — only maintainers changing the playlist do.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'client', 'public', 'res', 'audio', 'radio');
const force = process.argv.includes('--force');
const ITEM = 'The_Open_Goldberg_Variations-11823';
const BASE = `https://archive.org/download/${ITEM}`;

const TRACKS = [
  { slug: 'goldberg-aria', file: 'Kimiko_Ishizaka_-_01_-_Aria.ogg', title: 'Aria' },
  { slug: 'goldberg-var13', file: 'Kimiko_Ishizaka_-_14_-_Variatio_13_a_2_Clav.ogg', title: 'Variation 13' },
  { slug: 'goldberg-var24', file: 'Kimiko_Ishizaka_-_25_-_Variatio_24_a_1_Clav_Canone_allOttava.ogg', title: 'Variation 24, Canone all’Ottava' },
  { slug: 'goldberg-var19', file: 'Kimiko_Ishizaka_-_20_-_Variatio_19_a_1_Clav.ogg', title: 'Variation 19' },
];

const curl = (url, dest) => execFileSync('curl', ['-sSfL', '--max-time', '180', '--retry', '4', '--retry-delay', '3', '--retry-all-errors', '--proto', '=https', '-o', dest, url]);

mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'ac-radio-'));
try {
  curl(`https://archive.org/metadata/${ITEM}`, path.join(tmp, 'meta.json'));
  const meta = JSON.parse(readFileSync(path.join(tmp, 'meta.json'), 'utf8'));
  const license = meta.metadata?.licenseurl ?? '';
  if (!/publicdomain\/zero\/1\.0/.test(license)) throw new Error(`unexpected license on ${ITEM}: "${license}" — not CC0, stopping`);
  const manifest = [];
  for (const t of TRACKS) {
    const info = meta.files.find((f) => f.name === t.file);
    if (!info) throw new Error(`${t.file} is not in ${ITEM}`);
    const dest = path.join(out, `${t.slug}.mp3`);
    if (force || !existsSync(dest)) {
      const src = path.join(tmp, `${t.slug}.ogg`);
      console.log(`↓ ${t.title} ← ${t.file}`);
      curl(`${BASE}/${encodeURIComponent(t.file)}`, src);
      const sha1 = createHash('sha1').update(readFileSync(src)).digest('hex');
      if (sha1 !== info.sha1) throw new Error(`${t.file}: SHA-1 ${sha1} does not match the archive's ${info.sha1}`);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map_metadata', '-1', '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '32k', dest]);
    } else console.log(`✓ ${t.slug} already present`);
    // the decoded length (the archive's "length" field for the Ogg files is a few seconds short)
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dest]).toString().trim());
    manifest.push({ file: `${t.slug}.mp3`, title: t.title, work: 'Goldberg Variations, BWV 988', composer: 'Johann Sebastian Bach', performer: 'Kimiko Ishizaka', durationSec: Math.round(dur * 10) / 10, source: `${BASE}/${encodeURIComponent(t.file)}`, license: 'CC0 1.0' });
  }
  writeFileSync(path.join(out, 'tracks.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(
    path.join(out, 'CREDITS.txt'),
    [
      'Station radio music — public domain (CC0 1.0 Universal, https://creativecommons.org/publicdomain/zero/1.0/)',
      '',
      'The Open Goldberg Variations: J. S. Bach, Goldberg Variations BWV 988, performed by Kimiko Ishizaka (2012),',
      `released into the public domain by the performer. Source: https://archive.org/details/${ITEM}`,
      'Project: https://opengoldbergvariations.org',
      '',
      ...manifest.map((m) => `${m.file}: ${m.title} (${m.durationSec} s) — ${m.source}`),
      '',
      'Transcoded to mono 22.05 kHz 32 kb/s MP3 by scripts/assets/fetch-audio.mjs (SHA-1 checked against the archive).',
      '',
    ].join('\n'),
  );
  console.log(`done → ${path.relative(root, out)}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

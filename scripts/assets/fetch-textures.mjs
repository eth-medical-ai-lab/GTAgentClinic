#!/usr/bin/env node
/**
 * Fetches the CC0 PBR texture sets used by the 3D world from ambientCG (https://ambientcg.com,
 * public domain / CC0 1.0) and writes compact WebP maps to client/public/res/tex/<key>/.
 * The outdoor sky backgrounds come from Poly Haven (https://polyhaven.com, CC0 1.0): the
 * tonemapped JPG of a "pure sky" HDRI, resized to a 4096×2048 equirectangular WebP in
 * client/public/res/tex/sky/<key>.webp (the exterior's reflection probe captures it, so no
 * HDR file is shipped).
 *
 *   node scripts/assets/fetch-textures.mjs [--force]
 *
 * Needs: curl, unzip, cwebp (brew install webp). The output is committed, so players never
 * run this — only maintainers changing the material set do.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outRoot = path.join(root, 'client', 'public', 'res', 'tex');
const force = process.argv.includes('--force');

/** key → ambientCG asset id, which maps to keep, and the output size */
const SETS = {
  floor_vinyl: { id: 'Terrazzo001', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  floor_alt: { id: 'Terrazzo005', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  wall_paint: { id: 'PaintedPlaster017', maps: ['NormalGL', 'Roughness'], size: 1024 },
  fabric_curtain: { id: 'Fabric062', maps: ['NormalGL', 'Roughness'], size: 512 },
  fabric_seat: { id: 'Fabric030', maps: ['Color', 'NormalGL', 'Roughness'], size: 512 },
  vinyl: { id: 'Leather026', maps: ['NormalGL', 'Roughness'], size: 512 },
  steel: { id: 'Metal009', maps: ['Color', 'NormalGL', 'Roughness', 'Metalness'], size: 512 },
  plastic: { id: 'Plastic010', maps: ['NormalGL', 'Roughness'], size: 512 },
  asphalt: { id: 'Asphalt031', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  concrete: { id: 'Concrete034', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  wood: { id: 'Wood049', maps: ['Color', 'NormalGL', 'Roughness'], size: 512 },
  rubber: { id: 'Rubber004', maps: ['NormalGL', 'Roughness'], size: 512 },
  // exterior: parking-lot asphalt, broom-finished sidewalk concrete, lawn, tree bark + leaves, brick, tread plate
  lot_asphalt: { id: 'Road012A', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  sidewalk: { id: 'Concrete047A', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  grass: { id: 'Grass004', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  bark: { id: 'Bark014', maps: ['Color', 'NormalGL', 'Roughness'], size: 512 },
  leaves: { id: 'LeafSet024', maps: ['Color', 'Opacity'], size: 1024 },
  brick: { id: 'Bricks051', maps: ['Color', 'NormalGL', 'Roughness'], size: 1024 },
  tread_plate: { id: 'DiamondPlate001', maps: ['Color', 'NormalGL', 'Roughness'], size: 512 },
};
const OUT_NAME = { Color: 'color', NormalGL: 'normal', Roughness: 'rough', Metalness: 'metal', Opacity: 'alpha' };

/** key → Poly Haven HDRI id (CC0); the tonemapped JPG becomes the sky background */
const SKIES = {
  night: 'kloppenheim_07_puresky',
  day: 'kloofendal_48d_partly_cloudy_puresky',
};

mkdirSync(outRoot, { recursive: true });
const credits = [];
for (const [key, set] of Object.entries(SETS)) {
  const dir = path.join(outRoot, key);
  credits.push(`${key}: ambientCG ${set.id} — https://ambientcg.com/view?id=${set.id} (CC0 1.0)`);
  if (!force && existsSync(path.join(dir, `${OUT_NAME[set.maps[set.maps.length - 1]]}.webp`))) {
    console.log(`✓ ${key} (${set.id}) already present`);
    continue;
  }
  const tmp = mkdtempSync(path.join(tmpdir(), 'acg-'));
  try {
    const zip = path.join(tmp, 'set.zip');
    console.log(`↓ ${key} ← ${set.id}`);
    execFileSync('curl', ['-sSfL', '--max-time', '120', '-o', zip, `https://ambientcg.com/get?file=${set.id}_1K-JPG.zip`]);
    execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
    mkdirSync(dir, { recursive: true });
    const files = readdirSync(tmp);
    for (const m of set.maps) {
      const f = files.find((n) => n.endsWith(`_${m}.jpg`));
      if (!f) throw new Error(`${set.id}: no ${m} map in archive (${files.join(', ')})`);
      const q = m === 'NormalGL' ? '90' : '82';
      execFileSync('cwebp', ['-quiet', '-q', q, '-resize', String(set.size), String(set.size), path.join(tmp, f), '-o', path.join(dir, `${OUT_NAME[m]}.webp`)]);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
const skyCredits = [];
const skyDir = path.join(outRoot, 'sky');
mkdirSync(skyDir, { recursive: true });
for (const [key, id] of Object.entries(SKIES)) {
  skyCredits.push(`sky/${key}.webp: Poly Haven ${id} (tonemapped, resized) — https://polyhaven.com/a/${id} (CC0 1.0)`);
  const out = path.join(skyDir, `${key}.webp`);
  if (!force && existsSync(out)) {
    console.log(`✓ sky ${key} (${id}) already present`);
    continue;
  }
  const tmp = mkdtempSync(path.join(tmpdir(), 'phs-'));
  try {
    const jpg = path.join(tmp, 'sky.jpg');
    console.log(`↓ sky ${key} ← ${id}`);
    execFileSync('curl', ['-sSfL', '--max-time', '300', '-o', jpg, `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/${id}.jpg`]);
    execFileSync('cwebp', ['-quiet', '-q', '84', '-resize', '4096', '2048', jpg, '-o', out]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
writeFileSync(
  path.join(outRoot, 'CREDITS.txt'),
  `PBR texture sets (all CC0 1.0 / public domain, from ambientCG.com):\n${credits.join('\n')}\n\nSky backgrounds (CC0 1.0 / public domain, from Poly Haven, polyhaven.com):\n${skyCredits.join('\n')}\n`,
);
console.log('done');

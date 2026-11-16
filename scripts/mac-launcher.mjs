#!/usr/bin/env node
/**
 * `npm run mac-launcher`: makes ~/Applications/GTAgentClinic.app on this Mac, for this checkout.
 * Built locally with osacompile (part of macOS); nothing is downloaded and nothing is distributed.
 *
 * The app opens a Terminal window that runs scripts/mac/start-gtagentclinic.command, which is
 * `npm start -- --exit-when-idle` in this folder: you see the server, Ctrl+C or closing the window
 * stops it, and it stops by itself 2 minutes after the last game tab closes. Nothing keeps running
 * in the background. Remove the app by dragging it to the Trash.
 *
 *   npm run mac-launcher                 create or update ~/Applications/GTAgentClinic.app
 *   npm run mac-launcher -- --out DIR    put GTAgentClinic.app in DIR instead
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', reset: '\x1b[0m' };
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outDir = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : path.join(os.homedir(), 'Applications');
const app = path.join(outDir, 'GTAgentClinic.app');
const launcher = path.join(root, 'scripts', 'mac', 'start-gtagentclinic.command');
const home = (p) => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);

if (process.platform !== 'darwin') {
  console.error('npm run mac-launcher makes a macOS app, so it only runs on a Mac. Elsewhere, start the game with npm start.');
  process.exit(1);
}
if (!existsSync(launcher)) {
  console.error(`${c.red}Missing ${launcher}.${c.reset} Is this a complete checkout?`);
  process.exit(1);
}
chmodSync(launcher, 0o755); // a ZIP download may have dropped the executable bit

// ── the applet: open the .command in Terminal (no Apple Events, so no "control Terminal" permission prompt) ──
const asString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const script = `-- GTAgentClinic launcher, made by \`npm run mac-launcher\` for the game in ${root.replace(/\n/g, ' ')}
-- It opens a Terminal window that runs the game (npm start); nothing runs in the background.
on run
	set launcher to ${asString(launcher)}
	try
		do shell script "test -x " & quoted form of launcher
	on error
		display alert "GTAgentClinic can't find its game folder" message "It expected " & launcher & ". If you moved the game folder, run npm run mac-launcher again in its new place. Otherwise drag this app to the Trash." as warning
		return
	end try
	do shell script "open -a Terminal " & quoted form of launcher
end run
`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'gtagentclinic-launcher-'));
try {
  const src = path.join(tmp, 'GTAgentClinic.applescript');
  writeFileSync(src, script);
  mkdirSync(outDir, { recursive: true });
  const replaced = existsSync(app);
  if (replaced) rmSync(app, { recursive: true, force: true });
  const r = spawnSync('/usr/bin/osacompile', ['-o', app, src], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`${c.red}osacompile failed:${c.reset} ${(r.stderr || r.error?.message || '').trim()}`);
    process.exit(1);
  }
  // the app's icon: the game's logo (site/favicon.svg), drawn here and re-sealed with an ad-hoc signature
  let icon = false;
  try {
    const art = logoArt(readFileSync(path.join(root, 'site', 'favicon.svg'), 'utf8'));
    if (!art) throw new Error('the favicon has shapes this little renderer does not draw');
    writeFileSync(path.join(app, 'Contents', 'Resources', 'applet.icns'), icns(art));
    // osacompile's icon also sits in an asset catalog, which macOS prefers: drop it so applet.icns is used
    spawnSync('/usr/bin/plutil', ['-remove', 'CFBundleIconName', path.join(app, 'Contents', 'Info.plist')]);
    rmSync(path.join(app, 'Contents', 'Resources', 'Assets.car'), { force: true });
    const s = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { encoding: 'utf8' });
    icon = s.status === 0;
    spawnSync('/usr/bin/touch', [app]); // Finder picks up the new icon
  } catch {
    /* the default applet icon is fine */
  }
  console.log(`\n  ${c.green}●${c.reset} ${replaced ? 'Updated' : 'Created'} ${c.bold}${home(app)}${c.reset}${icon ? '' : ' (with the default icon)'}`);
  console.log(`${c.dim}    for the game in ${home(root)}${c.reset}\n`);
  console.log('  Open it from Finder (your home folder → Applications), Spotlight or Launchpad, or drag it to the Dock.');
  console.log('  It opens a Terminal window that runs npm start: Ctrl+C or closing that window stops the game,');
  console.log('  and it stops by itself 2 minutes after you close the last game tab. Nothing runs in the background.');
  console.log(`${c.dim}  If you move the game folder, run npm run mac-launcher again. To remove the app: drag it to the Trash,`);
  console.log(`  or run: rm -rf ${home(app).replace(/ /g, '\\ ')}${c.reset}\n`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── a tiny SVG → PNG → ICNS path (no dependencies) for the logo in site/favicon.svg ──

/**
 * The favicon's background rect (fill, rx) and its paths (fill, d) on a 64-unit grid. Straight lines
 * only (M L H V Z, absolute or relative), filled even-odd; anything else → null (default icon).
 */
function logoArt(svg) {
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v ?? '') ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : null);
  const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const rectTag = /<rect\b[^>]*>/.exec(svg)?.[0];
  const bg = rectTag && hex(attr(rectTag, 'fill'));
  if (!bg) return null;
  const paths = [];
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const color = hex(attr(tag, 'fill'));
    const d = attr(tag, 'd');
    if (!color || !d || /[^MmLlHhVvZz\d\s,.+-]/.test(d)) return null;
    const polys = [];
    let poly = null;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    for (const [, cmd, args] of d.matchAll(/([MmLlHhVvZz])([^MmLlHhVvZz]*)/g)) {
      const n = (args.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        x = sx;
        y = sy;
        poly = null;
        continue;
      }
      if (C === 'H' || C === 'V') {
        for (const v of n) {
          if (C === 'H') x = rel ? x + v : v;
          else y = rel ? y + v : v;
          poly?.push([x, y]);
        }
        continue;
      }
      for (let i = 0; i + 1 < n.length; i += 2) {
        x = rel ? x + n[i] : n[i];
        y = rel ? y + n[i + 1] : n[i + 1];
        if (C === 'M' && i === 0) {
          polys.push((poly = [[x, y]]));
          sx = x;
          sy = y;
        } else poly?.push([x, y]); // pairs after a moveto are linetos
      }
    }
    paths.push({ color, polys });
  }
  return { bg, rx: Number(attr(rectTag, 'rx') ?? 0), paths };
}

/** RGBA pixels of the logo at size×size, 4×4 supersampled per pixel; inset like a macOS app icon */
function logo(size, art) {
  const px = Buffer.alloc(size * size * 4);
  const inset = size * 0.1;
  const u = (size - 2 * inset) / 64; // pixels per favicon unit
  const radius = art.rx * u;
  const lo = inset;
  const hi = size - inset;
  const S = 4;
  // per path: its edges, for an even-odd scanline fill
  const edges = art.paths.map((p) => p.polys.flatMap((poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]])));
  const rgba = new Float64Array(4);
  for (let y = 0; y < size; y++) {
    // per sub-row: the x intervals where each path is inside (pixels)
    const rows = [];
    for (let sy = 0; sy < S; sy++) {
      const fy = y + (sy + 0.5) / S;
      const gy = (fy - inset) / u;
      rows.push(
        edges.map((es) => {
          const xs = [];
          for (const [[x0, y0], [x1, y1]] of es) if ((y0 <= gy) !== (y1 <= gy)) xs.push(inset + u * (x0 + ((gy - y0) / (y1 - y0)) * (x1 - x0)));
          return xs.sort((a, b) => a - b);
        }),
      );
    }
    for (let x = 0; x < size; x++) {
      rgba.fill(0);
      for (let sy = 0; sy < S; sy++) {
        const fy = y + (sy + 0.5) / S;
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const dx = Math.max(lo + radius - fx, 0, fx - (hi - radius));
          const dy = Math.max(lo + radius - fy, 0, fy - (hi - radius));
          if (fx < lo || fx > hi || fy < lo || fy > hi || dx * dx + dy * dy > radius * radius) continue;
          let col = art.bg;
          rows[sy].forEach((xs, i) => {
            let inside = false;
            for (const v of xs) if (v <= fx) inside = !inside;
            if (inside) col = art.paths[i].color;
          });
          rgba[0] += col[0];
          rgba[1] += col[1];
          rgba[2] += col[2];
          rgba[3] += 1;
        }
      }
      if (!rgba[3]) continue;
      const i = (y * size + x) * 4;
      px[i] = Math.round(rgba[0] / rgba[3]);
      px[i + 1] = Math.round(rgba[1] / rgba[3]);
      px[i + 2] = Math.round(rgba[2] / rgba[3]);
      px[i + 3] = Math.round((255 * rgba[3]) / (S * S));
    }
  }
  return px;
}

function png(size, art) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const px = logo(size, art);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function icns(art) {
  const entries = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['icp6', 64], ['ic12', 64], ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024]];
  const cache = new Map();
  const parts = entries.map(([type, size]) => {
    if (!cache.has(size)) cache.set(size, png(size, art));
    const data = cache.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

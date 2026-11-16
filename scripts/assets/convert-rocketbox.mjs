#!/usr/bin/env node
/**
 * Converts the cached Rocketbox FBX avatars + animations (see fetch-rocketbox.mjs) into the
 * game's runtime assets, entirely with three.js (FBXLoader → PBR materials → GLTFExporter)
 * inside headless Chromium — no Blender or other native converter needed.
 *
 *   node scripts/assets/convert-rocketbox.mjs [--only=Name1,Name2] [--anims-only] [--previews=dir]
 *   node scripts/assets/convert-rocketbox.mjs --sparsify   re-encode the GLBs already in OUT (no conversion)
 *   node scripts/assets/convert-rocketbox.mjs --tones      re-measure skin/hair tones into index.json
 *
 * Output (client/public/res/chars/):
 *   <Avatar>.glb      skinned mesh, WebP textures (body/head 1024², hair 512² with alpha), facial
 *                     morph targets stored as sparse accessors (glb-sparse.mjs: ~45 % of the dense size)
 *   anims.glb         all clips on one skeleton (rotations + root translation, in place)
 *   index.json        avatar list with sex, height, bone info and native skin/hair tones for the
 *                     runtime (head swaps match the body's skin to the face) and tests/casting.test.ts
 */
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { sparsifyMorphs } from './glb-sparse.mjs';
import { ANIMS, AVATARS, CACHE, OUT, ROOT } from './rocketbox.mjs';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const animsOnly = args.includes('--anims-only');
const previewDir = args.find((a) => a.startsWith('--previews='))?.split('=')[1];
// facial variants carry ARKit blendshapes (blink, jaw, mouth, brows) for lip-sync and expressions
const facial = !args.includes('--no-facial');
const tonesOnly = args.includes('--tones');
mkdirSync(OUT, { recursive: true });
if (previewDir) mkdirSync(previewDir, { recursive: true });

/** avatar GLBs: morph targets → sparse accessors (deltas under 10 µm are float noise from the FBX) */
function writeAvatar(file, buf) {
  const r = sparsifyMorphs(buf, { eps: 1e-3 });
  writeFileSync(file, r.glb);
  return r;
}

if (args.includes('--sparsify')) {
  for (const name of Object.keys(AVATARS)) {
    if (only && !only.includes(name)) continue;
    const file = path.join(OUT, `${name}.glb`);
    if (!existsSync(file)) continue;
    const src = readFileSync(file);
    const r = writeAvatar(file, src);
    console.log(`✓ ${name}: ${(src.length / 1e6).toFixed(2)} → ${(r.glb.length / 1e6).toFixed(2)} MB (morph deltas kept ${((100 * r.kept) / Math.max(1, r.total)).toFixed(1)} %)`);
  }
  process.exit(0);
}

const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body style="margin:0;background:#20262b"><canvas id="c" width="640" height="900"></canvas>
<script type="module" src="/convert.js"></script></body></html>`;

// ─────────────────────────── browser-side converter ───────────────────────────
const CONVERT_JS = String.raw`
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const log = (...a) => console.log(a.map(String).join(' '));

/** FBX load that resolves only after every referenced texture has loaded too */
function loadFbx(base, file) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.addHandler(/\.tga$/i, new TGALoader(manager));
    // FBX texture paths are absolute 3ds Max paths — map every texture to the cached file by base name
    manager.setURLModifier((url) => (/\.(tga|png|jpg)$/i.test(url) ? base + url.split(/[\\/]/).pop() : url));
    let obj = null;
    let settled = false;
    manager.onLoad = () => {
      if (obj && !settled) {
        settled = true;
        resolve(obj);
      }
    };
    manager.onError = (u) => log('texture failed: ' + u);
    // texture loads are queued during parse (before the FBX's own itemEnd), so the manager's
    // onLoad fires only once the FBX *and* all its TGA textures are in
    new FBXLoader(manager).load(base + file, (o) => {
      obj = o;
    }, undefined, reject);
  });
}

/**
 * Error-bounded keyframe reduction: drop keys that linear interpolation between the kept
 * neighbours reproduces within tol (per component). Mocap at 30 fps shrinks ~5–10×.
 */
function reduceTrack(track, tol) {
  const times = track.times, values = track.values, stride = track.getValueSize(), n = times.length;
  if (n <= 2) return track;
  const keep = [0];
  let last = 0;
  for (let i = 2; i < n; i++) {
    let ok = true;
    for (let j = last + 1; j < i && ok; j++) {
      const f = (times[j] - times[last]) / (times[i] - times[last]);
      for (let k = 0; k < stride; k++) {
        const a = values[last * stride + k], b = values[i * stride + k];
        if (Math.abs(a + (b - a) * f - values[j * stride + k]) > tol) { ok = false; break; }
      }
    }
    if (!ok) { keep.push(i - 1); last = i - 1; }
  }
  keep.push(n - 1);
  const t = new Float32Array(keep.length), v = new Float32Array(keep.length * stride);
  keep.forEach((src, dst) => { t[dst] = times[src]; for (let k = 0; k < stride; k++) v[dst * stride + k] = values[src * stride + k]; });
  track.times = t;
  track.values = v;
  return track;
}

/** draw a texture's image into a canvas of the given size (optionally keeping alpha) */
function resample(tex, size) {
  const img = tex.image;
  const drawable = img && (img.data || img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || img instanceof ImageBitmap);
  if (!drawable || !img.width || img.width < 2) return null; // missing texture → caller falls back to a flat color
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (img.data && img.width) {
    // DataTexture (TGALoader) → ImageData
    const src = document.createElement('canvas');
    src.width = img.width; src.height = img.height;
    const id = new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height);
    src.getContext('2d').putImageData(id, 0, 0);
    // FBX UVs assume flipY=true textures; glTF wants flipY=false → bake the flip into the pixels
    g.save();
    if (tex.flipY !== false) { g.translate(0, size); g.scale(1, -1); }
    g.drawImage(src, 0, 0, size, size);
    g.restore();
  } else {
    g.save();
    if (tex.flipY !== false) { g.translate(0, size); g.scale(1, -1); }
    g.drawImage(img, 0, 0, size, size);
    g.restore();
  }
  return c;
}

function toTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false; // glTF convention
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.userData.mimeType = 'image/webp';
  return t;
}

/** recolor near-white fabric pixels (low saturation, high value) to a garment color — skin/hair stay untouched */
function recolorWhites(canvas, hex, strength = 1) {
  const g = canvas.getContext('2d');
  const id = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  const c = new THREE.Color(hex);
  const tr = c.r * 255, tg = c.g * 255, tb = c.b * 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx ? (mx - mn) / mx : 0;
    if (mx > 120 && sat < 0.16) {
      const k = Math.min(1, (0.16 - sat) / 0.06) * Math.min(1, (mx - 120) / 40) * strength;
      const shade = mx / 255; // keep fold shading
      d[i] = r + (tr * shade * 1.05 - r) * k;
      d[i + 1] = gg + (tg * shade * 1.05 - gg) * k;
      d[i + 2] = b + (tb * shade * 1.05 - b) * k;
    }
  }
  g.putImageData(id, 0, 0);
}

function kindOf(name) {
  const n = name.toLowerCase();
  // spectacles (Business_Female_02): alpha-tested like hair, but never recolored as hair
  if (n.includes('glasses')) return 'glasses';
  if (n.includes('opacity') || n.includes('hair') || n.includes('lash')) return 'hair';
  if (n.includes('head')) return 'head';
  return 'body';
}

function convertMaterials(root, opts) {
  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (cache.has(m)) return cache.get(m);
      const srcName = (m.map?.name || m.map?.image?.currentSrc || '') + ' ' + m.name;
      const kind = kindOf(srcName);
      const size = kind === 'hair' || kind === 'glasses' ? 512 : opts.texSize;
      const std = new THREE.MeshStandardMaterial({ name: kind, roughness: kind === 'head' ? 0.55 : kind === 'hair' ? 0.6 : kind === 'glasses' ? 0.3 : 0.8, metalness: 0 });
      const cv = m.map ? resample(m.map, size) : null;
      if (cv) {
        if (kind === 'body' && opts.recolor) recolorWhites(cv, opts.recolor);
        std.map = toTexture(cv, true);
      } else if (m.color) std.color.copy(m.color);
      const nv = m.normalMap ? resample(m.normalMap, Math.min(size, opts.normalSize)) : null;
      if (nv) {
        std.normalMap = toTexture(nv, false);
        std.normalScale = new THREE.Vector2(1, 1);
      }
      if (kind === 'hair' || kind === 'glasses') {
        std.alphaTest = 0.45;
        std.side = THREE.DoubleSide;
        std.transparent = false;
      }
      cache.set(m, std);
      return std;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

function exportGlb(obj, animations = []) {
  return new Promise((resolve, reject) => new GLTFExporter().parse(obj, resolve, reject, { binary: true, animations, onlyVisible: true }));
}

async function post(file, buf) {
  await fetch('/out/' + file, { method: 'POST', body: buf });
}

function boneInfo(root) {
  const names = [];
  let pelvis = null, head = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isBone) {
      names.push(o.name);
      if (/Pelvis$/i.test(o.name)) pelvis = o.getWorldPosition(new THREE.Vector3()).y;
      if (/Head$/i.test(o.name)) head = o.getWorldPosition(new THREE.Vector3()).y;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  return { bones: names.length, boneNames: names, pelvis, head, height: box.max.y - box.min.y };
}

/** ARKit blendshapes the runtime drives: blinks, speech mouth shapes, expression (others are dropped to keep files small) */
const KEEP_MORPHS = /^(AK_(01_BrowDownLeft|02_BrowDownRight|03_BrowInnerUp|09_EyeBlinkLeft|10_EyeBlinkRight|19_EyeSquintLeft|20_EyeSquintRight|25_JawOpen|30_MouthFrownLeft|31_MouthFrownRight|44_MouthSmileLeft|45_MouthSmileRight)|AA_VI_\d+_(PP|FF|SS|aa|E|I|O|U))$/;
/** "blendShape1.AK_25_JawOpen" → "JawOpen", "blendShape1.AA_VI_10_aa" → "V_aa" */
const morphName = (n) => n.replace(/^AK_\d+_/, '').replace(/^AA_VI_\d+_/, 'V_');

function pruneMorphs(root) {
  const kept = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary || !o.geometry.morphAttributes.position) return;
    const names = Object.entries(o.morphTargetDictionary).sort((a, b) => a[1] - b[1]).map(([n]) => n);
    // exact names only: the FBX's duplicate "<name>S" shape entries never match the anchored pattern
    const keepIdx = names.map((n, i) => [n.split('.').pop(), i]).filter(([n]) => KEEP_MORPHS.test(n));
    const seen = new Set();
    const pick = keepIdx.filter(([n]) => (seen.has(n) ? false : (seen.add(n), true)));
    const g = o.geometry;
    g.morphAttributes.position = pick.map(([, i]) => g.morphAttributes.position[i]);
    delete g.morphAttributes.normal; // position deltas are enough for small facial motion
    o.morphTargetInfluences = pick.map(() => 0);
    o.morphTargetDictionary = Object.fromEntries(pick.map(([n], k) => [morphName(n), k]));
    kept.push(...Object.keys(o.morphTargetDictionary));
  });
  return kept;
}

window.convertAvatar = async (name, opts) => {
  const base = '/cache/avatars/' + name + '/';
  const fbx = await loadFbx(base, name + (opts.facial ? '_facial' : '') + '.fbx');
  fbx.traverse((o) => { if (o.isLight || o.isCamera) o.visible = false; });
  fbx.name = name;
  const morphs = [];
  fbx.traverse((o) => { if (o.morphTargetDictionary) morphs.push(...Object.keys(o.morphTargetDictionary)); });
  const unit = fbx.userData.unitScaleFactor ?? 1;
  fbx.scale.setScalar(unit / 100); // cm → m
  fbx.updateMatrixWorld(true);
  convertMaterials(fbx, opts);
  const keptMorphs = opts.facial ? pruneMorphs(fbx) : [];
  // FBX meshes come out non-indexed (3 vertices per triangle): weld them — shrinks the base mesh
  // and, more importantly, every morph target by ~5×
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    const before = o.geometry.attributes.position.count;
    const merged = mergeVertices(o.geometry, 1e-5);
    merged.groups = o.geometry.groups.map((g) => ({ ...g }));
    o.geometry = merged;
    log('weld ' + o.name + ': ' + before + ' → ' + merged.attributes.position.count + ' verts, morphs ' + (merged.morphAttributes.position?.length ?? 0));
  });
  const info = boneInfo(fbx);
  const glb = await exportGlb(fbx);
  await post((opts.outName || name) + '.glb', glb);
  window.__last = fbx;
  return { ...info, morphs: keptMorphs.length ? keptMorphs : morphs.slice(0, 80), size: glb.byteLength };
};

// ── native tones (index.json): what a face looks like before any recoloring ──
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}
/** the runtime's skin test (client/src/world/avatars.ts skinWeight) */
function skinW(h, s, v) {
  if (h < 4 || h > 46 || s < 0.14 || s > 0.74 || v < 0.3) return 0;
  return Math.min(1, (v - 0.3) / 0.08) * Math.min(1, (s - 0.14) / 0.06) * Math.min(1, (0.74 - s) / 0.06);
}
const hex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
function pixelsOf(tex) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/**
 * Mean skin of the face and neck (they run down the middle of the head atlas), and mean hair: the
 * alpha-tested hair cards, else the dark hair painted on the scalp (null = bald or shaved).
 */
window.tones = async (name) => {
  const g = await new GLTFLoader().loadAsync('/outdir/' + name + '.glb');
  const mats = [];
  g.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (!mats.includes(m)) mats.push(m); });
  const head = mats.find((m) => m.name === 'head' && m.map);
  const cards = mats.filter((m) => m.name === 'hair' && m.map);
  let skin = null, hair = null;
  if (head) {
    const { d, w, h } = pixelsOf(head.map);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = Math.floor(h * 0.25); y < h * 0.75; y += 2) for (let x = Math.floor(w * 0.38); x < w * 0.62; x += 2) {
      const i = (y * w + x) * 4;
      const [H, S, V] = hsv(d[i], d[i + 1], d[i + 2]);
      if (skinW(H, S, V) > 0.9) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n > 50) skin = hex(r / n, gg / n, b / n);
    if (!cards.length) {
      // short hair painted on the scalp: the lower corners of the atlas (the GLB stores it upside
      // down: eyes and teeth at the top, the face in the middle, the scalp along the bottom);
      // hair = not skin-like (dark, grey or very fair), the atlas's black padding left out
      let rr = 0, rg = 0, rb = 0, hairy = 0, all = 0;
      for (let y = Math.floor(h * 0.7); y < h; y += 2) for (let x = 0; x < w; x += 2) {
        if (x > w * 0.32 && x < w * 0.68) continue;
        const i = (y * w + x) * 4;
        if (d[i + 3] < 128 || Math.max(d[i], d[i + 1], d[i + 2]) < 10) continue;
        all++;
        const [H, S, V] = hsv(d[i], d[i + 1], d[i + 2]);
        if (V < 0.4 || skinW(H, S, V) < 0.5) { rr += d[i]; rg += d[i + 1]; rb += d[i + 2]; hairy++; }
      }
      if (all && hairy / all > 0.25) hair = hex(rr / hairy, rg / hairy, rb / hairy);
    }
  }
  if (cards.length) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (const m of cards) {
      const { d } = pixelsOf(m.map);
      for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n) hair = hex(r / n, gg / n, b / n);
  }
  return { skin, hair };
};

/** Load all clips; strip non-root translation + scale tracks, make walks in-place, export on one skeleton. */
window.convertAnims = async (clips) => {
  let skeletonRoot = null;
  const out = [];
  const report = [];
  for (const [clipName, , opt] of clips) {
    const obj = await loadFbx('/cache/anims/', clipName + '.fbx');
    obj.traverse((o) => { if (o.isLight || o.isCamera) o.visible = false; });
    let clip = obj.animations[0];
    if (!clip) { report.push(clipName + ': NO CLIP'); continue; }
    if (!skeletonRoot) {
      skeletonRoot = obj;
      skeletonRoot.userData = {};
    }
    clip.name = clipName;
    if (opt?.trim) {
      // only the first seconds of a long take (rocketbox.mjs: { trim: s })
      clip = THREE.AnimationUtils.subclip(clip, clipName, 0, Math.round(opt.trim * 30), 30);
    }
    const keep = [];
    let rootPos = null;
    for (const t of clip.tracks) {
      const [node, prop] = [t.name.slice(0, t.name.lastIndexOf('.')), t.name.slice(t.name.lastIndexOf('.') + 1)];
      if (prop === 'scale' || !/^Bip01/.test(node)) continue; // e.g. MotionExtractionHelper
      if (prop === 'position') {
        if (!/^Bip01$/.test(node)) continue;
        rootPos = t;
      }
      keep.push(t);
    }
    // upper-body layers (rocketbox.mjs: { upper: true }): arms, spine and head only, no root motion
    clip.tracks = opt?.upper ? keep.filter((t) => /Spine|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger/.test(t.name) && !/^Bip01\.|^Bip01$/.test(t.name)) : keep;
    if (opt?.upper) rootPos = null;
    let drift = '';
    if (rootPos) {
      // remove root drift along the two axes that move the most (horizontal plane), keep vertical bob
      const v = rootPos.values, n = rootPos.times.length;
      const span = [0, 1, 2].map((a) => Math.abs(v[(n - 1) * 3 + a] - v[a]));
      const range = [0, 1, 2].map((a) => { let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i++) { mn = Math.min(mn, v[i * 3 + a]); mx = Math.max(mx, v[i * 3 + a]); } return mx - mn; });
      drift = 'span=' + span.map((x) => x.toFixed(1)).join('/') + ' range=' + range.map((x) => x.toFixed(1)).join('/');
      const order = [0, 1, 2].sort((a, b) => span[b] - span[a]);
      if (span[order[0]] > 20) {
        // root motion clip: flatten the travel axis to its mean so the clip plays in place
        for (const a of [order[0]]) {
          const t0 = rootPos.times[0], t1 = rootPos.times[n - 1];
          const v0 = v[a], v1 = v[(n - 1) * 3 + a];
          for (let i = 0; i < n; i++) {
            const f = (rootPos.times[i] - t0) / Math.max(1e-6, t1 - t0);
            v[i * 3 + a] -= v0 + (v1 - v0) * f;
          }
        }
        drift += ' → in-place(axis ' + order[0] + ', ' + (span[order[0]] / Math.max(1e-6, rootPos.times[n - 1] - rootPos.times[0])).toFixed(0) + ' cm/s)';
        clip.userData = { speed: span[order[0]] / 100 / Math.max(1e-6, rootPos.times[n - 1] - rootPos.times[0]) };
      }
    }
    clip.optimize();
    let before = 0, after = 0;
    for (const t of clip.tracks) {
      before += t.times.length;
      // quaternion components: 0.0015 ≈ 0.17°; root translation is in cm here
      reduceTrack(t, t.name.endsWith('.position') ? 0.25 : 0.0015);
      after += t.times.length;
    }
    out.push(clip);
    report.push(clipName + ': ' + clip.duration.toFixed(2) + 's, ' + clip.tracks.length + ' tracks, keys ' + before + '→' + after + ' ' + drift);
  }
  skeletonRoot.traverse((o) => { if (o.isMesh) o.visible = false; });
  const unit = skeletonRoot.userData.unitScaleFactor ?? 1;
  const glb = await exportGlb(skeletonRoot, out);
  await post('anims.glb', glb);
  return { report, size: glb.byteLength, speeds: Object.fromEntries(out.map((c) => [c.name, c.userData?.speed ?? 0])) };
};

/** quick visual check: render the last converted avatar, optionally playing a clip */
window.preview = async (clipName) => {
  const canvas = document.getElementById('c');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#3a4248');
  scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(1.5, 3, 3);
  scene.add(key);
  const obj = window.__last;
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const cam = new THREE.PerspectiveCamera(30, 640 / 900, 0.1, 50);
  const h = box.max.y - box.min.y;
  cam.position.set(0, box.min.y + h * 0.55, h * 2.3);
  cam.lookAt(0, box.min.y + h * 0.5, 0);
  if (clipName) {
    const anim = await new (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader().loadAsync('/outdir/anims.glb');
    const clip = anim.animations.find((c) => c.name === clipName);
    if (clip) {
      clip.tracks = clip.tracks.filter((t) => !t.name.endsWith('.position') || t.name.startsWith('Bip01.'));
      const mixer = new THREE.AnimationMixer(obj);
      // tracks are on sanitized names; the FBX bones use spaces → bind via a name map
      obj.traverse((o) => { if (o.isBone) o.name = THREE.PropertyBinding.sanitizeNodeName(o.name); });
      mixer.clipAction(clip).play();
      mixer.update(1.0);
    }
  }
  r.render(scene, cam);
  return true;
};
`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
page.on('console', (m) => console.log(`  [page] ${m.text()}`));
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
const mime = (f) => (f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream');
await page.route('http://conv.local/**', async (route) => {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  if (route.request().method() === 'POST' && p.startsWith('/out/')) {
    const file = path.join(OUT, path.basename(p));
    const body = route.request().postDataBuffer();
    if (/\.glb$/.test(file) && path.basename(file) !== 'anims.glb') writeAvatar(file, body);
    else writeFileSync(file, body);
    return route.fulfill({ status: 200, body: 'ok' });
  }
  let file = null;
  if (p === '/' || p === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
  if (p === '/convert.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: CONVERT_JS });
  if (p.startsWith('/three/')) file = path.join(THREE_DIR, p.slice('/three/'.length));
  else if (p.startsWith('/cache/')) file = path.join(CACHE, p.slice('/cache/'.length));
  else if (p.startsWith('/outdir/')) file = path.join(OUT, p.slice('/outdir/'.length));
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found ' + p });
  return route.fulfill({ status: 200, contentType: mime(file), body: readFileSync(file) });
});
await page.goto('http://conv.local/');
await page.waitForFunction(() => typeof window.convertAvatar === 'function');

const index = existsSync(path.join(OUT, 'index.json')) ? JSON.parse(readFileSync(path.join(OUT, 'index.json'), 'utf8')) : { avatars: {}, clips: {} };

if (!tonesOnly && (!only || animsOnly || only.includes('anims'))) {
  console.log('▶ animations');
  const r = await page.evaluate((clips) => window.convertAnims(clips), ANIMS);
  for (const line of r.report) console.log('  ' + line);
  console.log(`  anims.glb ${(r.size / 1024).toFixed(0)} KB`);
  index.clips = r.speeds;
}

/** no baked variants: scrub colors are applied at runtime (client/src/world/avatars.ts) */
const VARIANTS = {};

if (!animsOnly && !tonesOnly) {
  for (const name of Object.keys(AVATARS)) {
    if (only && !only.includes(name)) continue;
    const jobs = [{ out: name }, ...(VARIANTS[name] ?? [])];
    for (const job of jobs) {
      const t0 = Date.now();
      const r = await page.evaluate(([n, o]) => window.convertAvatar(n, o), [name, { outName: job.out, recolor: job.recolor, texSize: 1024, normalSize: 512, facial }]);
      const sex = /Female/.test(name) ? 'f' : 'm';
      index.avatars[job.out] = { base: name, sex, height: +r.height.toFixed(3), pelvis: r.pelvis && +r.pelvis.toFixed(3), head: r.head && +r.head.toFixed(3), bones: r.bones, morphs: facial ? r.morphs : [] };
      const size = statSync(path.join(OUT, `${job.out}.glb`)).size; // as written: morphs sparse
      console.log(`✓ ${job.out}: ${(size / 1024).toFixed(0)} KB (dense ${(r.size / 1024).toFixed(0)} KB), h=${r.height.toFixed(2)} m, pelvis=${r.pelvis?.toFixed(2)} head=${r.head?.toFixed(2)}, ${r.bones} bones${r.morphs.length ? `, morphs: ${r.morphs.slice(0, 12).join(' ')}` : ''} (${Date.now() - t0} ms)`);
      if (job.out === name && name === Object.keys(AVATARS)[0]) console.log('  bones: ' + r.boneNames.join(', '));
      if (previewDir) {
        await page.evaluate((clip) => window.preview(clip), sex === 'f' ? 'f_idle' : 'm_idle');
        await page.locator('#c').screenshot({ path: path.join(previewDir, `${job.out}.png`) });
      }
    }
  }
}
if (!animsOnly) {
  // native skin and hair tones, measured on the GLBs as shipped
  for (const name of Object.keys(index.avatars)) {
    if (only && !tonesOnly && !only.includes(name)) continue;
    if (!existsSync(path.join(OUT, `${name}.glb`))) continue;
    const t = await page.evaluate((n) => window.tones(n), name);
    Object.assign(index.avatars[name], { skin: t.skin, hair: t.hair });
    if (tonesOnly) console.log(`✓ ${name}: skin ${t.skin}, hair ${t.hair ?? '(bald / shaved)'}`);
  }
}
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
writeFileSync(
  path.join(OUT, 'LICENSE-Rocketbox.txt'),
  `Characters and animations: Microsoft Rocketbox Avatar Library
https://github.com/microsoft/Microsoft-Rocketbox — MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Converted to glTF (WebP textures, sparse facial morph targets, in-place locomotion) by scripts/assets/convert-rocketbox.mjs.
`,
);
await browser.close();
console.log('done →', OUT);

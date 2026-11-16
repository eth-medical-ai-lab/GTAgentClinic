/**
 * Realistic animated characters: Microsoft Rocketbox avatars (MIT) converted to glTF by
 * scripts/assets/convert-rocketbox.mjs, sharing one mocap animation library (anims.glb).
 *
 * - posture → clip: stand (idle / nervous / cough), walk (normal / slow / fast, stride
 *   matched to ground speed), sit (chair / desk / nervous), lie (breathing, body laid on
 *   the mattress)
 * - speaking: full-body talk gestures when standing, an upper-body talk layer when seated,
 *   and a small nod driven by the voice level (speech.ts) when lying
 * - procedural head/neck turn toward whoever the NPC is looking at
 * - scrub colors / grey hair are applied per cast by recoloring textures once at load
 *
 * Characters are created synchronously (the world needs an object right away) and swap in
 * their model when the GLB arrives; until then the label anchor sits at head height.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PatientBlanket } from './bedding';
import { LEG_PILLOW, pillowPress, type BedRig } from './bedRig';
import { armBones, handQuat, reachArm, type ArmBones } from './hands';
import type { AmbientAct, BedPosition, Emotion, Posture } from '../../../shared/types';
import type { Mouth } from '../ui/visemes';
import type { Mount } from './accessories';
import { HEAD_NEEDS_OWN_BODY, type AvatarCast } from './casting';
import type { Character } from './characters';
import { JumpLayer } from './jump';
import { hashString, leftHanded, PhoneHold } from './phone';

interface AvatarIndex {
  /** skin / hair: the model's native tones (measured by convert-rocketbox.mjs; hair null = bald or shaved) */
  avatars: Record<string, { base: string; sex: 'm' | 'f'; height: number; pelvis: number; head: number; skin?: string | null; hair?: string | null }>;
  /** clip name → ground speed (m/s) for locomotion clips (0 for in-place) */
  clips: Record<string, number>;
}

const BASE = '/res/chars/';
const loader = new GLTFLoader();
let indexP: Promise<AvatarIndex> | null = null;
let clipsP: Promise<Map<string, THREE.AnimationClip>> | null = null;
const models = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, THREE.Texture>();

/** the most a lying patient's thigh is turned to rest a leg on the mattress (rad, about 11°: a staggered heel needs 8–10°) */
const LIFT_MAX = 0.2;

function loadIndex(): Promise<AvatarIndex> {
  if (!indexP) {
    // counted by three's loading manager like the models, so the loading screen does not close while
    // the index is still on its way and no model has started yet (people would appear after it)
    const url = `${BASE}index.json`;
    const lm = THREE.DefaultLoadingManager;
    lm.itemStart(url);
    indexP = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`avatar index ${r.status}`);
        return r.json() as Promise<AvatarIndex>;
      })
      .finally(() => lm.itemEnd(url));
  }
  return indexP;
}

/** a model's sex and own skin tone (index.json), once the index is in; undefined for an unknown model */
export function avatarInfo(id: string): Promise<{ sex: 'm' | 'f'; skin?: string | null } | undefined> {
  return loadIndex().then(
    (i) => i.avatars[id],
    () => undefined,
  );
}

/** keep rotations + root translation only (bone lengths come from each avatar's own skeleton) */
function prepareClip(c: THREE.AnimationClip): THREE.AnimationClip {
  // (the biped's Footsteps helper has no bone in the avatars: binding it only warns)
  c.tracks = c.tracks.filter((t) => (t.name.endsWith('.quaternion') && !t.name.startsWith('Bip01_Footsteps')) || t.name === 'Bip01.position');
  return c;
}

const UPPER = /Spine|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger/;
function upperBody(c: THREE.AnimationClip, name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(
    name,
    c.duration,
    c.tracks.filter((t) => UPPER.test(t.name) && !t.name.startsWith('Bip01.')),
  );
}

function loadClips(): Promise<Map<string, THREE.AnimationClip>> {
  return (clipsP ??= loader.loadAsync(`${BASE}anims.glb`).then((g) => {
    const m = new Map<string, THREE.AnimationClip>();
    for (const c of g.animations) m.set(c.name, prepareClip(c));
    for (const s of ['m', 'f']) {
      const talk = m.get(`${s}_talk`);
      if (talk) m.set(`${s}_talk_upper`, upperBody(talk, `${s}_talk_upper`));
    }
    return m;
  }));
}

function loadModel(id: string): Promise<GLTF> {
  let p = models.get(id);
  if (!p) {
    p = loader.loadAsync(`${BASE}${id}.glb`).then((g) => {
      mergePrimitives(g.scene);
      return g;
    });
    models.set(id, p);
  }
  return p;
}

/**
 * A Rocketbox avatar is one skinned mesh of 7–8 glTF primitives over a single shared vertex buffer
 * (same skin, same morph targets), only ever with three materials (body, head, hair). three.js makes
 * one draw call per primitive; joining the primitives that share a material into one index buffer
 * draws the same triangles in three calls per pass instead of eight. Done once per model, before
 * characters clone it.
 */
function mergePrimitives(scene: THREE.Object3D) {
  const groups: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.children.filter((c) => (c as THREE.SkinnedMesh).isSkinnedMesh).length > 1) groups.push(o);
  });
  for (const o of groups) {
    const byMat = new Map<THREE.Material, THREE.SkinnedMesh[]>();
    for (const c of o.children) {
      const m = c as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || Array.isArray(m.material)) continue;
      byMat.set(m.material, [...(byMat.get(m.material) ?? []), m]);
    }
    for (const list of byMat.values()) {
      const base = list[0].geometry;
      // only primitives that really share the vertex data (and skeleton) can share a draw
      if (list.length < 2 || !list.every((m) => m.geometry.index && m.geometry.attributes.position === base.attributes.position && m.skeleton === list[0].skeleton)) continue;
      const total = list.reduce((n, m) => n + m.geometry.index!.count, 0);
      const idx = base.attributes.position.count > 65535 ? new Uint32Array(total) : new Uint16Array(total);
      let at = 0;
      for (const m of list) {
        idx.set(m.geometry.index!.array as ArrayLike<number>, at);
        at += m.geometry.index!.count;
      }
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
      g.morphAttributes = base.morphAttributes;
      g.morphTargetsRelative = base.morphTargetsRelative;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      list[0].geometry = g;
      for (const m of list.slice(1)) m.removeFromParent();
    }
  }
}

/** warm the caches (called at world creation so characters appear without a pop) */
export function preloadAvatars(ids: string[]) {
  void loadIndex().catch(() => {});
  void loadClips().catch(() => {});
  for (const id of ids) void loadModel(id).catch(() => {});
}

// ───────────────────────────── texture recoloring ─────────────────────────────

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}

type PixelFn = (d: Uint8ClampedArray, w: number, h: number) => void;

function recolor(src: THREE.Texture, key: string, fn: PixelFn): THREE.Texture {
  const ck = `${src.uuid}|${key}`;
  const hit = texCache.get(ck);
  if (hit) return hit;
  const img = src.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return src;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  fn(id.data, c.width, c.height);
  ctx.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = src.colorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.channel = src.channel;
  t.anisotropy = 4;
  texCache.set(ck, t);
  return t;
}

/** near-white, low-saturation garment pixels → scrub color (keeps folds/shading; skin untouched) */
function scrubsFn(hex: string) {
  const c = new THREE.Color(hex).convertLinearToSRGB();
  const tr = c.r * 255;
  const tg = c.g * 255;
  const tb = c.b * 255;
  return (d: Uint8ClampedArray) => {
    for (let i = 0; i < d.length; i += 4) {
      const [, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      if (v > 0.47 && s < 0.16) {
        const k = Math.min(1, (0.16 - s) / 0.06) * Math.min(1, (v - 0.47) / 0.16);
        const shade = Math.min(1.15, v * 1.12);
        d[i] += (tr * shade - d[i]) * k;
        d[i + 1] += (tg * shade - d[i + 1]) * k;
        d[i + 2] += (tb * shade - d[i + 2]) * k;
      }
    }
  };
}

function hueFn(from: [number, number], hex: string) {
  const c = new THREE.Color(hex).convertLinearToSRGB();
  return (d: Uint8ClampedArray) => {
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      if (h >= from[0] && h <= from[1] && s > 0.18 && v > 0.08) {
        const shade = Math.min(1.25, v * 1.7);
        d[i] = c.r * 255 * shade;
        d[i + 1] = c.g * 255 * shade;
        d[i + 2] = c.b * 255 * shade;
      }
    }
  };
}

/** warm hue, moderate saturation, not too dark: skin in these textures (lips/brows blend at the edges) */
function skinWeight(h: number, s: number, v: number): number {
  if (h < 4 || h > 46 || s < 0.14 || s > 0.74 || v < 0.3) return 0;
  return Math.min(1, (v - 0.3) / 0.08) * Math.min(1, (s - 0.14) / 0.06) * Math.min(1, (0.74 - s) / 0.06);
}

/**
 * A face's own shift mask. skinWeight leaves out the lips, flushed cheeks and ears (reds below its hue
 * band) and pale specular sheen (low saturation): right on a body texture, where white coats and
 * shirts are low-saturation too, but on a face moved to a much darker or lighter tone those stay
 * behind as pale, mask-like patches. On a head atlas they shift with the skin. In the eye/teeth atlas
 * (top left: the GLB stores these atlases upside down) only proper skin shifts — the chest and a
 * shoulder run into that corner on most heads — never teeth, eye whites or the mouth; dark hair and
 * brows, and grey hair painted around the scalp (the bottom corners), stay as they are.
 */
function faceWeight(h: number, s: number, v: number, x: number, y: number, w: number, hgt: number): number {
  if (x < w * 0.36 && y < hgt * 0.36) return skinWeight(h, s, v);
  if (v < 0.12) return 0;
  const fade = Math.min(1, (v - 0.12) / 0.1);
  if ((h <= 50 || h >= 330) && s >= 0.06) return fade;
  const scalp = y > hgt * 0.62 && (x < w * 0.3 || x > w * 0.7);
  return s < 0.14 && v > 0.4 && !scalp ? fade : 0;
}

/** flushed skin on a body texture (chest, knuckles): pinker than skinWeight's band, but not a red garment's saturation */
function flushWeight(h: number, s: number, v: number): number {
  if (!(h >= 346 || h < 4) || s < 0.14 || s > 0.55 || v < 0.35) return 0;
  return Math.min(1, (0.55 - s) / 0.08) * Math.min(1, (v - 0.35) / 0.08);
}

/**
 * shift skin toward a target tone, keeping the texture's own shading and pores; `face`: a head atlas
 * (lips, cheeks and sheen shift too: faceWeight)
 */
function skinFn(hex: string, face = false, native?: string | null): PixelFn {
  const t = new THREE.Color(hex).convertLinearToSRGB();
  // the model's own skin tone (index.json, measured once from its face). A model's head texture (face,
  // neck, the V of the chest) and body texture (arms, the rest of the chest) both scale from it by the
  // same factors, so where the two meshes meet at a neckline the tones still match; measuring each
  // texture's own mean gave each its own factors and a hard two-tone step at the seam
  const ref = native ? new THREE.Color(native).convertLinearToSRGB() : null;
  return (d, wd, hgt) => {
    let r = ref ? ref.r * 255 : 0;
    let g = ref ? ref.g * 255 : 0;
    let b = ref ? ref.b * 255 : 0;
    let n = ref ? 1 : 0;
    for (let i = 0; !ref && i < d.length; i += 16) {
      const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      if (skinWeight(h, s, v) > 0.9) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
    if (!ref && n < 50) return;
    const kr = (t.r * 255) / (r / n);
    const kg = (t.g * 255) / (g / n);
    const kb = (t.b * 255) / (b / n);
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
      const p = i >> 2;
      const w = face ? faceWeight(h, s, v, p % wd, Math.floor(p / wd), wd, hgt) : Math.max(skinWeight(h, s, v), flushWeight(h, s, v));
      if (w <= 0) continue;
      d[i] += (Math.min(255, d[i] * kr) - d[i]) * w;
      d[i + 1] += (Math.min(255, d[i + 1] * kg) - d[i + 1]) * w;
      d[i + 2] += (Math.min(255, d[i + 2] * kb) - d[i + 2]) * w;
    }
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** a head atlas's black padding, between its pieces (brightest channel, 0..255): no hair, no skin */
const PADDING = 6;

/**
 * a model's own hair is light (blond down to mid-brown): on its head atlas, darkness can't tell hair
 * from skin (mid-brown under white: its lighter strands stayed brown, streaks through the white)
 */
function lightHair(hex?: string | null): boolean {
  if (!hex) return false;
  const c = new THREE.Color(hex).convertLinearToSRGB();
  return Math.max(c.r, c.g, c.b) > 0.25;
}

/**
 * How much of each pixel of a head atlas is hair (0..1), for a head whose own hair is light: a blond
 * bob is painted onto the head mesh in skin-like tones, so the dark-pixel rule (hairFn 'scalp') finds
 * none of it, and a recolor changed the hair cards alone (white streaks over a blond bob).
 *
 * Strands make a block of pixels streaky and skin is smooth: the variation of a block's luminance
 * decides the region. A necklace or a hair tie is a thin line (opened away); small smooth patches
 * inside hair are holes (closed), and a smooth highlight on the rim of a piece joins it if it is
 * yellower than this face's skin. The face, the mouth atlas and the eyeball are never hair, by where
 * every Rocketbox head atlas has them (stored upside down: eye, teeth and mouth top left, the face in
 * the middle); round the ears and in the eye's surround a block also needs a hair's tone, not an
 * ear's pinks and reds.
 */
function lightHairMask(d: Uint8ClampedArray, w: number, h: number): Float32Array {
  const bs = Math.max(2, Math.round(w / 128));
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  const N = gw * gh;
  /** blocks that aren't the atlas's black padding */
  const real = new Uint8Array(N);
  const hue = new Float32Array(N);
  const val = new Float32Array(N);
  const flat = new Uint8Array(N);
  let score = new Float32Array(N);
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) {
      let r = 0, g = 0, b = 0, n = 0, l1 = 0, l2 = 0;
      for (let y = by * bs; y < Math.min(h, (by + 1) * bs); y++)
        for (let x = bx * bs; x < Math.min(w, (bx + 1) * bs); x++) {
          const i = (y * w + x) * 4;
          if (Math.max(d[i], d[i + 1], d[i + 2]) < PADDING) continue;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
          const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          l1 += l;
          l2 += l * l;
        }
      if (n < bs * bs * 0.3) continue;
      const k = by * gw + bx;
      real[k] = 1;
      [hue[k], , val[k]] = rgbToHsv(r / n, g / n, b / n);
      const mean = l1 / n;
      const cv = Math.sqrt(Math.max(0, l2 / n - mean * mean)) / Math.max(mean, 1);
      flat[k] = cv < 0.02 ? 1 : 0;
      score[k] = smoothstep(0.025, 0.05, cv);
    }
  // this face's own skin: the smooth blocks of the neck, in the middle of the atlas
  const skinHues: number[] = [];
  const skinVals: number[] = [];
  for (let by = Math.floor(gh * 0.35); by < gh * 0.56; by++)
    for (let bx = Math.floor(gw * 0.2); bx < gw * 0.8; bx++) {
      const k = by * gw + bx;
      if (real[k] && flat[k]) {
        skinHues.push(hue[k]);
        skinVals.push(val[k]);
      }
    }
  const median = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0);
  const skinHue = median(skinHues) || 22;
  const skinVal = median(skinVals) || 0.75;
  /** yellower than this skin (never its pinks and reds): blond, and a highlight in it */
  const yellower = (k: number) => hue[k] >= skinHue + 3.5 && hue[k] < 70;
  /** hair by its tone: yellower than the skin, or as warm and clearly darker */
  const toned = (k: number) => yellower(k) || (hue[k] >= skinHue - 2 && hue[k] < 70 && val[k] <= 0.8 * skinVal);
  /** min or max over a (2r+1)² window of real blocks */
  const morph = (src: Float32Array, r: number, pick: (a: number, b: number) => number, start: number) => {
    const o = new Float32Array(N);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        if (!real[y * gw + x]) continue;
        let v = start;
        for (let yy = Math.max(0, y - r); yy <= Math.min(gh - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(gw - 1, x + r); xx++) if (real[yy * gw + xx]) v = pick(v, src[yy * gw + xx]);
        o[y * gw + x] = v;
      }
    return o;
  };
  score = morph(morph(score, 1, Math.min, 1), 1, Math.max, 0); // opening: thin lines go
  score = morph(morph(score, 3, Math.max, 0), 3, Math.min, 1); // closing: holes fill
  /** 0 = never hair, 1 = only by its tone (round the ears, the eye's surround), 2 = free */
  const zone = new Uint8Array(N);
  for (let by = 0; by < gh; by++)
    for (let bx = 0; bx < gw; bx++) {
      const k = by * gw + bx;
      const nx = (bx + 0.5) / gw;
      const ny = (by + 0.5) / gh;
      const face = Math.hypot((nx - 0.5) / 0.19, (ny - 0.66) / 0.15) < 1;
      const mouth = nx < 0.135 && ny < 0.42;
      const eyeball = Math.hypot(nx - 0.265, ny - 0.065) < 0.055;
      const ear = Math.hypot((Math.abs(nx - 0.5) - 0.255) / 0.05, (ny - 0.645) / 0.09) < 1;
      const eyeSurround = Math.hypot((nx - 0.265) / 0.095, (ny - 0.06) / 0.105) < 1;
      zone[k] = face || mouth || eyeball ? 0 : ear || eyeSurround ? 1 : 2;
      if (zone[k] === 0 || (zone[k] === 1 && !toned(k))) score[k] = 0;
    }
  // a smooth highlight on the rim of a hair piece: grow into yellower blocks next to hair (64 px at most)
  for (let pass = 0; pass < 8; pass++) {
    const next = score.slice();
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const k = y * gw + x;
        if (!real[k] || zone[k] !== 2 || score[k] > 0.5 || !yellower(k)) continue;
        if ((x > 0 && score[k - 1] > 0.5) || (x < gw - 1 && score[k + 1] > 0.5) || (y > 0 && score[k - gw] > 0.5) || (y < gh - 1 && score[k + gw] > 0.5)) next[k] = 1;
      }
    score = next;
  }
  // a region's decision, not a pixel's: blur the blocks (3×3), then bilinear up, for a soft hairline
  const blur = new Float32Array(N);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(gh - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(gw - 1, x + 1); xx++)
          if (real[yy * gw + xx]) {
            s += score[yy * gw + xx];
            n++;
          }
      blur[y * gw + x] = n ? s / n : 0;
    }
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.max(d[i], d[i + 1], d[i + 2]) < PADDING) continue;
      const fx = Math.max(0, Math.min(gw - 1.001, (x + 0.5) / bs - 0.5));
      const fy = Math.max(0, Math.min(gh - 1.001, (y + 0.5) / bs - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const top = blur[y0 * gw + x0] * (1 - tx) + blur[y0 * gw + x0 + 1] * tx;
      const bottom = blur[(y0 + 1) * gw + x0] * (1 - tx) + blur[(y0 + 1) * gw + x0 + 1] * tx;
      mask[y * w + x] = smoothstep(0.35, 0.65, top * (1 - ty) + bottom * ty);
    }
  return mask;
}

/**
 * recolor hair toward a target color, preserving strand-to-strand luminance variation.
 * mode 'cards' = the alpha-tested hair texture (every opaque pixel is hair);
 * mode 'scalp' = the head texture, where the pixels much darker than the head's skin are hair. The
 * GLB stores these atlases upside down: the mouth's inside and an eyeball top left (never hair),
 * loose pieces of longer hair along the rest of the top, the face in the middle, the scalp along
 * the bottom.
 * `light` (scalp): the head's own hair is light, so its hair is found by its strands instead
 * (lightHairMask); the brows keep their own color.
 */
function hairFn(hex: string, mode: 'cards' | 'scalp', amount = 1, light = false, skin?: string | null): (d: Uint8ClampedArray, w: number, h: number, orig?: Uint8ClampedArray) => void {
  const t = new THREE.Color(hex).convertLinearToSRGB();
  // dark = hair, measured against this head's own skin (`skin`: its native tone): on a dark face the
  // fixed 0.28–0.42 that suits a light one took shaded skin at the temples and the neck for hair
  const sk = skin ? new THREE.Color(skin).convertLinearToSRGB() : null;
  const skinV = sk ? Math.max(sk.r, sk.g, sk.b) : 0.78;
  const darkLo = 0.36 * skinV;
  const darkHi = 0.54 * skinV;
  const tl = 0.3 * t.r + 0.59 * t.g + 0.11 * t.b;
  const tMax = Math.max(t.r, t.g, t.b);
  // grey and white (age): a silver ramp rather than a tint (see below)
  const silver = tl > 0.4 && (tMax - Math.min(t.r, t.g, t.b)) / Math.max(tMax, 1e-3) < 0.12;
  // orig: the texture's own pixels, to tell hair from skin by (a head whose skin was just shifted to a
  // dark tone would otherwise read as dark scalp hair, and be greyed with it: a grey face on dark hands)
  return (d: Uint8ClampedArray, w: number, hgt: number, orig?: Uint8ClampedArray) => {
    const src = orig ?? d;
    let brows = true;
    const mask = mode === 'scalp' && light ? lightHairMask(src, w, hgt) : null;
    /** how much of this pixel is hair (0..1) */
    const hairW = (i: number): number => {
      if (mode === 'cards') return d[i + 3] > 40 ? 1 : 0;
      const p = i >> 2;
      if (mask) return mask[p];
      const x = (p % w) / w;
      const y = Math.floor(p / w) / hgt;
      // never the mouth's inside or the eyeball and its surround (top left). The rest of the top rows
      // is hair: loose pieces of a bob or a bun are laid out there, and stayed black under a recolor
      if (y < 0.42 && x < 0.135) return 0;
      if (y < 0.17 && x < 0.37 && Math.hypot((x - 0.265) / 0.095, (y - 0.06) / 0.105) < 1) return 0;
      // the face from the chin to the brows (the middle): darker hair takes the brows along, lighter leaves them
      if (!brows && y > 0.42 && y < 0.76 && x > 0.33 && x < 0.67) return 0;
      const v = Math.max(src[i], src[i + 1], src[i + 2]) / 255;
      // (the atlas's black padding is no hair: it would drag the strands' mean down)
      if (v < PADDING / 255) return 0;
      // a soft edge where hair thins into scalp: no speckles of recolored and untouched pixels
      return v <= darkLo ? 1 : v >= darkHi ? 0 : (darkHi - v) / (darkHi - darkLo);
    };
    const lums: number[] = [];
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      // the strands proper: not the cards' see-through fringe, not the scalp's soft edge
      if (hairW(i) < 0.5 || (mode === 'cards' && d[i + 3] < 128)) continue;
      const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
      sum += l;
      n++;
      lums.push(l);
    }
    if (n < 30) return;
    const mean = Math.max(0.02, sum / n);
    brows = tl <= mean * 1.15;
    // silver: the strands' own spread (10th–90th percentile of luminance) mapped onto 72–108 % of the
    // target's, kept below white, so the hair keeps its shading without clipped, streaky patches
    lums.sort((a, b) => a - b);
    const lo = lums[Math.floor(lums.length * 0.1)];
    const hi = Math.max(lo + 0.02, lums[Math.floor(lums.length * 0.9)]);
    const bottom = tl * 0.72;
    const top = Math.min(0.86, tl * 1.08);
    for (let i = 0; i < d.length; i += 4) {
      const k = hairW(i) * amount;
      if (k <= 0) continue;
      const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
      const s = silver
        ? (bottom + (top - bottom) * Math.min(1, Math.max(0, (l - lo) / (hi - lo)))) / Math.max(tl, 1e-3)
        : Math.min(2.2, l / mean) * (tl > 0.01 ? 1 : 0.4);
      d[i] += (Math.min(255, t.r * 255 * s) - d[i]) * k;
      d[i + 1] += (Math.min(255, t.g * 255 * s) - d[i + 1]) * k;
      d[i + 2] += (Math.min(255, t.b * 255 * s) - d[i + 2]) * k;
    }
  };
}

const chain = (...fns: (PixelFn | null)[]): PixelFn => (d, w, h) => {
  for (const f of fns) f?.(d, w, h);
};

/** a head atlas: the skin shifted first, then the hair, whose pixels are picked on the texture as it was */
const headChain =
  (skin: PixelFn | null, hair: ReturnType<typeof hairFn> | null): PixelFn =>
  (d, w, h) => {
    const orig = hair && skin ? d.slice() : undefined;
    skin?.(d, w, h);
    hair?.(d, w, h, orig);
  };

/** skin's roughness (slightly softer specular than the converter's default) */
const SKIN_ROUGHNESS = 0.5;
let glossMap: THREE.Texture | null = null;

/**
 * Roughness over a head atlas: wet eyeballs that catch the ceiling lights, a moist mouth, lips with a
 * little sheen, skin as it was. With one roughness for the whole head the eyes were as matte as the
 * cheeks, and looked painted on. Every Rocketbox head atlas has these in the same places (stored
 * upside down: eye, teeth and mouth top left, the lips just above the middle), so one small texture
 * serves all heads.
 */
function faceGloss(like: THREE.Texture): THREE.Texture {
  if (glossMap) return glossMap;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grey = (rough: number, alpha = 1) => `rgba(${Math.round(rough * 255)},${Math.round(rough * 255)},${Math.round(rough * 255)},${alpha})`;
  g.fillStyle = grey(SKIN_ROUGHNESS);
  g.fillRect(0, 0, S, S);
  // the inside of the mouth, the teeth and the tongue: moist, not polished (at 0.3 the teeth flashed white)
  g.fillStyle = grey(0.42);
  g.fillRect(0, 0, S * 0.135, S * 0.42);
  /** an ellipse of another roughness, fading out over its outer part */
  const spot = (x: number, y: number, rx: number, ry: number, rough: number, core: number) => {
    g.save();
    g.translate(x * S, y * S);
    g.scale(rx * S, ry * S);
    const fade = g.createRadialGradient(0, 0, core, 0, 0, 1);
    fade.addColorStop(0, grey(rough));
    fade.addColorStop(1, grey(rough, 0));
    g.fillStyle = fade;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  spot(0.265, 0.066, 0.052, 0.052, 0.06, 0.8); // the eyeball
  // the lips (men's sit a little lower on the atlas than women's; kept off the skin under the nose,
  // which caught a wet-looking glint)
  spot(0.5, 0.594, 0.06, 0.028, 0.36, 0.4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = like.flipY;
  t.channel = like.channel;
  t.wrapS = like.wrapS;
  t.wrapT = like.wrapT;
  glossMap = t;
  return t;
}

/**
 * The darkest a head of hair is drawn (the brightest channel of its mean tone, sRGB). The models'
 * dark hair is painted near black (0.05–0.16): under the ceiling lights it took no shading at all,
 * a black shape with no top, sides or strands. Black hair reflects a few percent of the light, about
 * this much; lifted to it, the crown catches the light and the strands show.
 */
const HAIR_FLOOR = 0.22;

/**
 * a hair tone below the floor, lifted to it at the same hue (undefined: light enough as it is). The
 * further it is lifted, the less of its color it keeps: near-black hair is painted in warm dark
 * browns, which at full strength came up chestnut on one head and olive on another, not black hair
 * in the light
 */
function liftHair(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const c = new THREE.Color(hex).convertLinearToSRGB();
  const v = Math.max(c.r, c.g, c.b);
  if (v <= 0 || v >= HAIR_FLOOR) return undefined;
  const keep = Math.sqrt(v / HAIR_FLOOR);
  return `#${[c.r, c.g, c.b].map((x) => Math.round((HAIR_FLOOR + ((x / v) * HAIR_FLOOR - HAIR_FLOOR) * keep) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** greying (cast.grey): silver, blended over the hair's own color by the amount — salt and pepper below 1 */
const SILVER = '#bdbdbd';

/**
 * @param bodySkin skin tone for the body only (hands, arms, neck): a worn head's own tone, so the
 *   body matches the face (cast.skin, when set, recolors both)
 */
function dressModel(obj: THREE.Object3D, cast: AvatarCast, bodySkin?: string, native: { head?: string | null; body?: string | null; hair?: string | null } = {}) {
  const done = new Map<THREE.Material, THREE.Material>();
  // a hair color (never darker than HAIR_FLOOR), or greying (silver over the hair's own color by
  // cast.grey), or the model's own dark hair lifted to the floor
  const lifted = !cast.hair && !cast.grey ? liftHair(native.hair) : undefined;
  const hair = (cast.hair ? (liftHair(cast.hair) ?? cast.hair) : undefined) ?? (cast.grey ? SILVER : undefined) ?? lifted;
  const hairAmount = cast.hair || lifted ? 1 : (cast.grey ?? 0);
  const bskin = cast.skin ?? bodySkin;
  obj.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned poses (sitting/lying) leave the bind-pose bounds
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((m) => {
      const hit = done.get(m);
      if (hit) return hit;
      const sm = m as THREE.MeshStandardMaterial;
      let nm: THREE.MeshStandardMaterial | null = null;
      const kind = sm.name;
      if (sm.map && kind === 'body' && (cast.scrubs || cast.hue || bskin)) {
        const garment = cast.scrubs ? scrubsFn(cast.scrubs) : cast.hue ? hueFn(cast.hue.from, cast.hue.to) : null;
        nm = sm.clone();
        nm.map = recolor(sm.map, `body|${cast.scrubs}|${cast.hue?.from}${cast.hue?.to}|${bskin}|${native.body}`, chain(garment, bskin ? skinFn(bskin, false, native.body) : null));
      }
      if (sm.map && kind === 'head' && (cast.skin || hair)) {
        nm = sm.clone();
        // skin first: its sheen rule would otherwise tint freshly greyed hair toward the skin tone
        nm.map = recolor(sm.map, `head|${cast.skin}|${hair}|${hairAmount}|${native.head}|${native.hair}|own-hair`, headChain(cast.skin ? skinFn(cast.skin, true, native.head) : null, hair ? hairFn(hair, 'scalp', hairAmount, lightHair(native.hair), native.head) : null));
      }
      if (sm.map && kind === 'hair' && hair) {
        nm = sm.clone();
        nm.map = recolor(sm.map, `hair|${hair}|${hairAmount}`, hairFn(hair, 'cards', hairAmount));
      }
      // the body's own skin filling a neckline a worn head leaves bare (fillerOf): the worn face's tone
      if (sm.map && kind === 'skin' && bskin) {
        nm = sm.clone();
        nm.map = recolor(sm.map, `skin|${bskin}|${native.body}`, skinFn(bskin, false, native.body));
      }
      const result = nm ?? sm;
      if (kind === 'skin') result.roughness = SKIN_ROUGHNESS;
      if (kind === 'head') {
        // (the map carries the roughness itself: skin's, and glossier eyes, lips and mouth)
        result.roughness = sm.map ? 1 : SKIN_ROUGHNESS;
        if (sm.map) result.roughnessMap = faceGloss(sm.map);
      }
      done.set(m, result);
      return result;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });
}

// ───────────────────────────── head swap ─────────────────────────────

/** what a head brings with it: face (with its blendshapes), hair cards and eyelashes, spectacles */
const HEAD_KINDS = new Set(['head', 'hair', 'glasses']);

/** a body-material part that sits wholly above the neck in the rest pose: a surgical cap and mask, a hood */
function headwear(m: THREE.SkinnedMesh, headY: number): boolean {
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index;
  const n = idx ? idx.count : pos.count;
  let lo = Infinity;
  for (let k = 0; k < n; k += 3) {
    _v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld);
    if (_v.y < lo) lo = _v.y;
  }
  return lo > headY - 0.06;
}

/**
 * Wear another avatar's head (casting.ts `head`): every Rocketbox avatar of a sex shares one rest
 * skeleton (same joints, bind matrices within millimetres), so the donor's face, hair and lashes,
 * bound to this body's bones by name with their own inverse bind matrices, sit where they sat on
 * the donor. The body's own head goes, and so does any cap or mask it wore. Geometry, textures and
 * blendshapes stay shared with the cached donor model.
 */
function wearHead(model: THREE.Object3D, donor: THREE.Object3D, headY: number) {
  model.updateMatrixWorld(true);
  donor.updateMatrixWorld(true); // the cached donor scene is never in the scene graph
  const bones = new Map<string, THREE.Bone>();
  const own: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    else if ((o as THREE.SkinnedMesh).isSkinnedMesh) own.push(o as THREE.SkinnedMesh);
  });
  const kind = (m: THREE.Mesh) => (m.material as THREE.Material).name;
  const parent = own.find((m) => kind(m) === 'body')?.parent ?? own[0]?.parent;
  if (!parent) return;
  const ownHeads = own.filter((m) => kind(m) === 'head');
  for (const m of own) if (HEAD_KINDS.has(kind(m)) || (kind(m) === 'body' && headwear(m, headY))) m.removeFromParent();
  // the clothes (and any skin of the body's own) the worn head has to fit
  const outfit = own.filter((m) => kind(m) === 'body' && m.parent);
  const outfitKey = outfit.map((m) => m.geometry.uuid).join(',');
  // a worn neck seldom fills a collar quite as the outfit's own did: drawn double-sided, the inside of
  // a collar shows cloth beside the neck, not what's behind the figure (shadows cast as before)
  for (const b of outfit) {
    const mat = (b.material as THREE.Material).clone();
    mat.side = THREE.DoubleSide;
    mat.shadowSide = THREE.BackSide;
    b.material = mat;
  }
  donor.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !HEAD_KINDS.has(kind(m))) return;
    const worn = m.clone();
    if (kind(m) === 'head') {
      worn.geometry = fitToOutfit(m, outfit, ownHeads, headY, outfitKey);
      // drawn double-sided: should a neck still end short of a collar, the gap shows skin, never what's behind
      worn.material = (m.material as THREE.Material).clone();
      (worn.material as THREE.Material).side = THREE.DoubleSide;
      // and where it leaves the neckline bare, the outfit's own skin fills in
      for (const oh of ownHeads) {
        const fill = fillerOf(oh, m, worn.geometry, outfit, headY, `${worn.geometry.uuid}|${oh.geometry.uuid}`);
        if (!fill) continue;
        const f = oh.clone();
        f.geometry = fill;
        f.material = (oh.material as THREE.Material).clone();
        (f.material as THREE.Material).name = 'skin';
        f.morphTargetInfluences = undefined;
        f.morphTargetDictionary = undefined;
        parent.add(f);
      }
    }
    worn.bind(new THREE.Skeleton(m.skeleton.bones.map((b) => bones.get(b.name) ?? b), m.skeleton.boneInverses), m.bindMatrix);
    parent.add(worn);
  });
}

const fitted = new Map<string, THREE.BufferGeometry>();
const fillers = new Map<string, THREE.BufferGeometry | null>();
/** how far a worn head's skin may sit outside, or under, the clothes and still be fitted to them (m) */
const FIT_REACH = 0.03;
/** how deep under the cloth fitted skin sits (m): clear of depth precision and of the cloth's folds */
const FIT_DEPTH = 0.004;
/** how far an open neck edge may be drawn down to reach under a lower collar (m) */
const FIT_DROP = 0.09;
const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fc = new THREE.Vector3();
const _fd = new THREE.Vector3();
const _fe = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _fp = new THREE.Vector3();
const _fq = new THREE.Vector3();
const _fin = new THREE.Vector3();
const _fr = new THREE.Vector3();
const _fo = new THREE.Vector3();
const _fbar = new THREE.Vector3();
const _fray = new THREE.Ray();
const _finv = new THREE.Matrix4();

/** a skeleton's bones that move with its head (the head, jaw, eyes, a ponytail's own), by index */
function headBones(bones: THREE.Bone[]): { head: THREE.Bone | undefined; of: Set<number> } {
  const head = bones.find((b) => /Head$/.test(b.name));
  const of = new Set<number>();
  bones.forEach((b, i) => {
    for (let p: THREE.Object3D | null = b; p; p = p.parent) if (p === head) return void of.add(i);
  });
  return { head, of };
}

/** meshes' triangles in the rest pose (world space), bucketed in a grid for short ray casts */
class RestTriangles {
  /** three corners a triangle, 9 floats */
  readonly tri: number[] = [];
  /** a triangle's mesh (index into `meshes`), then its corners' vertex indices */
  readonly src: number[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly seen: Int32Array;
  private stamp = 0;
  constructor(
    readonly meshes: THREE.Mesh[],
    private readonly cellSize: number,
    keep: (lo: number[], hi: number[]) => boolean,
    geometryOf: (m: THREE.Mesh) => THREE.BufferGeometry = (m) => m.geometry,
  ) {
    meshes.forEach((b, mi) => {
      const g = geometryOf(b);
      const bp = g.attributes.position;
      const bi = g.index;
      const n = bi ? bi.count : bp.count;
      for (let k = 0; k < n; k += 3) {
        const t = this.src.length / 4;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        this.src.push(mi);
        for (let j = 0; j < 3; j++) {
          const vi = bi ? bi.getX(k + j) : k + j;
          this.src.push(vi);
          _v.fromBufferAttribute(bp, vi).applyMatrix4(b.matrixWorld);
          this.tri.push(_v.x, _v.y, _v.z);
          for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a], _v.getComponent(a));
            hi[a] = Math.max(hi[a], _v.getComponent(a));
          }
        }
        if (!keep(lo, hi)) {
          this.tri.length -= 9;
          this.src.length -= 4;
          continue;
        }
        for (let x = this.cell(lo[0]); x <= this.cell(hi[0]); x++)
          for (let y = this.cell(lo[1]); y <= this.cell(hi[1]); y++)
            for (let z = this.cell(lo[2]); z <= this.cell(hi[2]); z++) {
              const key = this.key(x, y, z);
              const list = this.grid.get(key);
              if (list) list.push(t);
              else this.grid.set(key, [t]);
            }
      }
    });
    this.seen = new Int32Array(this.src.length / 4);
  }
  get count(): number {
    return this.src.length / 4;
  }
  private cell(v: number): number {
    return Math.floor(v / this.cellSize) + 512;
  }
  private key(x: number, y: number, z: number): number {
    return (x * 1024 + y) * 1024 + z;
  }
  /** a triangle's corners into _fa, _fb, _fc */
  corners(t: number) {
    const k = t * 9;
    _fa.set(this.tri[k], this.tri[k + 1], this.tri[k + 2]);
    _fb.set(this.tri[k + 3], this.tri[k + 4], this.tri[k + 5]);
    _fc.set(this.tri[k + 6], this.tri[k + 7], this.tri[k + 8]);
  }
  /** a triangle's outward face normal */
  normal(t: number, out: THREE.Vector3): THREE.Vector3 {
    this.corners(t);
    return out.subVectors(_fb, _fa).cross(_fd.subVectors(_fc, _fa)).normalize();
  }
  /**
   * The nearest triangle along a ray within `reach`, met from outside it ('out'), from beneath it
   * ('in') or either ('any'). `o` and `d` are never this class's scratch vectors (_fa.._fe, _fq).
   */
  cast(o: THREE.Vector3, d: THREE.Vector3, reach: number, side: 'out' | 'in' | 'any'): { t: number; tri: number } | null {
    _fray.set(o, d);
    _fe.copy(d).multiplyScalar(reach).add(o);
    const [x0, x1, y0, y1, z0, z1] = [this.cell(Math.min(o.x, _fe.x)), this.cell(Math.max(o.x, _fe.x)), this.cell(Math.min(o.y, _fe.y)), this.cell(Math.max(o.y, _fe.y)), this.cell(Math.min(o.z, _fe.z)), this.cell(Math.max(o.z, _fe.z))];
    this.stamp++;
    let best = reach;
    let hit = -1;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          for (const t of this.grid.get(this.key(x, y, z)) ?? []) {
            if (this.seen[t] === this.stamp) continue;
            this.seen[t] = this.stamp;
            this.corners(t);
            // the ray meets a face's front side when the face looks back along it
            if (side !== 'any' && (_fd.subVectors(_fb, _fa).cross(_fe.subVectors(_fc, _fa)).dot(d) < 0) !== (side === 'out')) continue;
            if (!_fray.intersectTriangle(_fa, _fb, _fc, false, _fq)) continue;
            const dist = _fq.distanceTo(o);
            if (dist <= best) {
              best = dist;
              hit = t;
            }
          }
    return hit < 0 ? null : { t: best, tri: hit };
  }
}

/**
 * A worn head never shows through the outfit, nor stops short of it. A donor's neck, shoulders and
 * arms were shaped for its own clothes and weighted to move with them. Against this outfit (rest
 * pose, world space), every vertex of the worn head's skin below the jaw is fitted:
 * - outside the cloth (a fuller neck, broader shoulders: flecks of skin on a collar): moved FIT_DEPTH
 *   behind it;
 * - under the cloth: kept FIT_DEPTH clear of it;
 * - an open neck edge that ends above this collar (a head made for a shirt collar, on a scrub top):
 *   drawn down until it is under the cloth, so the nape shows skin, not the inside of the neck;
 * - and all of it reweighted to move as the outfit's own skin did (the body's own head mesh, rigged
 *   with these clothes), or failing that as the cloth over it: the donor's weights let a shoulder
 *   roll out through the tunic once the arms come down.
 * Whatever is weighted to the head itself (the face, a modelled ponytail lying on the back) stays as
 * it is. Positions and skin weights are copied; the index, normals, uvs and blendshapes stay shared
 * with the cached donor. Cached per donor and outfit.
 */
function fitToOutfit(m: THREE.SkinnedMesh, outfit: THREE.SkinnedMesh[], ownHeads: THREE.SkinnedMesh[], headY: number, outfitKey: string): THREE.BufferGeometry {
  const src = m.geometry;
  const key = `${src.uuid}|${outfitKey}`;
  const cached = fitted.get(key);
  if (cached) return cached;
  const done = (g: THREE.BufferGeometry) => (fitted.set(key, g), g);
  const { position: pos, normal: nrm, skinIndex: si, skinWeight: sw } = src.attributes;
  const bonesOf = m.skeleton.bones;
  const { head: headBone, of: ofHead } = headBones(bonesOf);
  if (!outfit.length || !nrm || !si || !sw || !headBone) return done(src);
  const top = headY - 0.02;
  // what moves with the head (the face, a ponytail) is no part of a neck
  const headWeight = (i: number) => [0, 1, 2, 3].reduce((s, c) => s + (ofHead.has(si.getComponent(i, c)) ? sw.getComponent(i, c) : 0), 0);
  const axis = headBone.getWorldPosition(new THREE.Vector3());
  // the outfit below the neck
  const cloth = new RestTriangles(outfit, FIT_REACH, (lo) => lo[1] <= top + FIT_REACH);
  if (!cloth.count) return done(src);
  const cast = (o: THREE.Vector3, d: THREE.Vector3, reach: number, outside: boolean) => cloth.cast(o, d, reach, outside ? 'out' : 'in');
  const clothNormal = (t: number, out: THREE.Vector3) => cloth.normal(t, out);
  // the outfit's own skin (the body's own head mesh, gone): rigged to stay under this collar
  const ownSkin = new RestTriangles(ownHeads, FIT_REACH, (lo) => lo[1] <= top + FIT_REACH);
  // a rigged surface's own skin weights at a point on it, as this head's bones (by name): four indices, four weights
  const nameIdx = new Map(bonesOf.map((b, i) => [b.name, i] as const));
  const weightsAt = (surface: RestTriangles, t: number, p: THREE.Vector3): number[] | null => {
    surface.corners(t);
    if (!THREE.Triangle.getBarycoord(p, _fa, _fb, _fc, _fbar)) return null;
    const b = surface.meshes[surface.src[t * 4]] as THREE.SkinnedMesh;
    const { skinIndex: bsi, skinWeight: bsw } = b.geometry.attributes;
    if (!bsi || !bsw) return null;
    const acc = new Map<number, number>();
    for (let j = 0; j < 3; j++) {
      const share = Math.max(0, _fbar.getComponent(j));
      const vi = surface.src[t * 4 + 1 + j];
      for (let c = 0; c < 4; c++) {
        const w = bsw.getComponent(vi, c) * share;
        const own = w > 0 ? nameIdx.get(b.skeleton.bones[bsi.getComponent(vi, c)]?.name ?? '') : undefined;
        if (own !== undefined) acc.set(own, (acc.get(own) ?? 0) + w);
      }
    }
    const top4 = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top4.reduce((s, x) => s + x[1], 0);
    if (sum <= 0) return null;
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    top4.forEach(([i, w], c) => {
      out[c] = i;
      out[4 + c] = w / sum;
    });
    return out;
  };
  const clothWeights = (t: number, p: THREE.Vector3) => weightsAt(cloth, t, p);

  // the head's vertices welded by position (uv seams split them), with their mean normals
  const n = pos.count;
  const canon = new Int32Array(n);
  const world = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const ids = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    world.set([_v.x, _v.y, _v.z], i * 3);
    const k = `${Math.round(_v.x * 2e4)},${Math.round(_v.y * 2e4)},${Math.round(_v.z * 2e4)}`;
    let c = ids.get(k);
    if (c === undefined) ids.set(k, (c = i));
    canon[i] = c;
    _fn.fromBufferAttribute(nrm, i).transformDirection(m.matrixWorld);
    for (let a = 0; a < 3; a++) normals[c * 3 + a] += _fn.getComponent(a);
  }
  // open edges (used by one triangle): where the neck ends
  const open = new Set<number>();
  const idx = src.index;
  if (idx) {
    const uses = new Map<number, number>();
    for (let k = 0; k < idx.count; k += 3) {
      const t = [canon[idx.getX(k)], canon[idx.getX(k + 1)], canon[idx.getX(k + 2)]];
      for (let j = 0; j < 3; j++) {
        const [a, b] = [Math.min(t[j], t[(j + 1) % 3]), Math.max(t[j], t[(j + 1) % 3])];
        if (a !== b) uses.set(a * n + b, (uses.get(a * n + b) ?? 0) + 1);
      }
    }
    for (const [e, u] of uses) if (u === 1) open.add(Math.floor(e / n)).add(e % n);
  }

  const moved = new Map<number, THREE.Vector3>(); // welded vertex → new world position
  const weights = new Map<number, number[]>(); // welded vertex → new skin weights
  const fit = (c: number, at: THREE.Vector3 | null, t: number, p: THREE.Vector3) => {
    if (at) moved.set(c, at.clone());
    const w = clothWeights(t, p);
    if (w) weights.set(c, w);
  };
  const neck: number[] = [];
  for (let c = 0; c < n; c++) {
    if (canon[c] !== c) continue;
    _fp.fromArray(world, c * 3);
    const hw = headWeight(c);
    // a neck edge can sit as high as the head joint (a head made for a stand-up collar) and move half
    // with the head; a ponytail's or the face's own edges move with it wholly
    const edge = open.has(c) && _fp.y > headY - 0.3 && _fp.y < headY + 0.015 && hw < 0.9;
    if (!edge && (_fp.y > top || hw >= 0.5)) continue;
    neck.push(c);
    _fn.fromArray(normals, c * 3).normalize();
    // an open neck edge with no cloth over it (looking out from the neck): draw it down until the
    // collar covers it. (Its normal is no guide: at an edge it points down into the collar.)
    const r = _fr.set(_fp.x - axis.x, 0, _fp.z - axis.z).length();
    if (edge && r > 1e-4 && r < 0.12 && !cast(_fp, _fr.normalize(), 0.05, false)) {
      const q = _fp.clone();
      for (let s = 0.005; s <= FIT_DROP + 1e-6 && !moved.has(c); s += 0.005) {
        q.y = _fp.y - s;
        const h = cast(q, _fr, 0.05, false);
        // a centimetre on, well under the collar's edge
        if (h) fit(c, q.clone().setY(q.y - 0.01), h.tri, q.clone().addScaledVector(_fr, h.t));
      }
      if (moved.has(c)) continue;
    }
    if (_fp.y > top || hw >= 0.5) continue;
    // outside the cloth: tuck it in behind
    let h = cast(_fp, _fin.copy(_fn).negate(), FIT_REACH, true);
    if (h) {
      const at = _fq.copy(_fn).multiplyScalar(-h.t).add(_fp); // the point met on the cloth
      const cn = clothNormal(h.tri, new THREE.Vector3());
      const out = _fe.subVectors(_fp, at).dot(cn);
      fit(c, _fp.clone().addScaledVector(cn, -(Math.max(0, out) + FIT_DEPTH)), h.tri, at.clone());
      continue;
    }
    // under the cloth: keep clear of it
    h = cast(_fp, _fn, FIT_REACH, false);
    if (h) {
      const at = _fq.copy(_fn).multiplyScalar(h.t).add(_fp).clone();
      const cn = clothNormal(h.tri, new THREE.Vector3());
      const depth = _fe.subVectors(at, _fp).dot(cn);
      fit(c, depth < FIT_DEPTH ? _fp.clone().addScaledVector(cn, -(FIT_DEPTH - Math.max(0, depth))) : null, h.tri, at);
    }
  }
  // and it moves as the outfit's own skin did, rigged to stay under this collar in every pose (a
  // collar's flap and the shirt beneath it move apart as a shoulder rolls; skin following either one
  // shows through the other): its weights at the nearest point, the cloth's where none is near
  if (ownSkin.count)
    for (const c of neck) {
      const p = moved.get(c) ?? new THREE.Vector3().fromArray(world, c * 3);
      _fn.fromArray(normals, c * 3).normalize();
      _fin.copy(_fn).negate();
      const out = ownSkin.cast(p, _fn, FIT_REACH, 'any');
      const into = ownSkin.cast(p, _fin, FIT_REACH, 'any');
      const h = out && (!into || out.t <= into.t) ? { ...out, d: _fn } : into ? { ...into, d: _fin } : null;
      const w = h && weightsAt(ownSkin, h.tri, p.clone().addScaledVector(h.d, h.t));
      if (w) weights.set(c, w);
    }
  if (!moved.size && !weights.size) return done(src);

  _finv.copy(m.matrixWorld).invert();
  const outPos = new Float32Array(n * 3);
  const outIdx = new Uint16Array(n * 4);
  const outW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = moved.get(canon[i]);
    if (p) _v.copy(p).applyMatrix4(_finv);
    else _v.fromBufferAttribute(pos, i);
    outPos.set([_v.x, _v.y, _v.z], i * 3);
    const w = weights.get(canon[i]);
    for (let c = 0; c < 4; c++) {
      outIdx[i * 4 + c] = w ? w[c] : si.getComponent(i, c);
      outW[i * 4 + c] = w ? w[4 + c] : sw.getComponent(i, c);
    }
  }
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outIdx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outW, 4));
  g.morphAttributes = src.morphAttributes;
  g.morphTargetsRelative = src.morphTargetsRelative;
  g.setIndex(src.index);
  g.boundingBox = src.boundingBox;
  g.boundingSphere = src.boundingSphere;
  return done(g);
}

/**
 * Where a worn head leaves this outfit's neckline bare (a head made for a turtleneck, worn with an
 * open collar), the outfit's own skin fills in: the triangles of the body's own head mesh around the
 * neck and upper chest that nothing of the worn head covers, looking out from the neck's axis, that
 * no cloth hides and that lie on no cloth (a body's own long hair is head mesh too). They keep the
 * body's own texture, recolored to the worn face's tone (material 'skin', see dressModel), and carry
 * no blendshapes. Cached per fitted head and body.
 */
function fillerOf(own: THREE.SkinnedMesh, donor: THREE.SkinnedMesh, worn: THREE.BufferGeometry, outfit: THREE.SkinnedMesh[], headY: number, key: string): THREE.BufferGeometry | null {
  const cached = fillers.get(key);
  if (cached !== undefined) return cached;
  const done = (g: THREE.BufferGeometry | null) => (fillers.set(key, g), g);
  const g = own.geometry;
  const idx = g.index;
  const { position: pos, skinIndex: si, skinWeight: sw } = g.attributes;
  const { head: headBone, of: ofHead } = headBones(own.skeleton.bones);
  const donorHead = donor.skeleton.bones.find((b) => /Head$/.test(b.name));
  if (!idx || !si || !sw || !headBone || !donorHead) return done(null);
  const axis = donorHead.getWorldPosition(new THREE.Vector3());
  const [low, high, reach] = [headY - 0.3, headY - 0.02, 0.15];
  const face = new RestTriangles([donor], 0.04, (lo, hi) => hi[1] >= low && lo[1] <= high + 0.02, () => worn);
  const cloth = new RestTriangles(outfit, 0.04, (lo, hi) => hi[1] >= low - 0.05 && lo[1] <= high + 0.05);
  const headWeight = (i: number) => [0, 1, 2, 3].reduce((s, c) => s + (ofHead.has(si.getComponent(i, c)) ? sw.getComponent(i, c) : 0), 0);
  const keep: number[] = [];
  for (let k = 0; k < idx.count; k += 3) {
    const corners = [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)];
    _fp.set(0, 0, 0);
    let around = true;
    for (const i of corners) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(own.matrixWorld);
      around &&= _v.y >= low && _v.y <= high && Math.hypot(_v.x - axis.x, _v.z - axis.z) <= reach && headWeight(i) < 0.5;
      _fp.add(_v);
    }
    if (!around) continue;
    _fp.multiplyScalar(1 / 3);
    const r = _fr.set(_fp.x - axis.x, 0, _fp.z - axis.z).length();
    if (r < 1e-4) continue;
    _fr.normalize();
    // any of the worn head along the line out from the neck's axis covers it; cloth over it hides it;
    // cloth between it and the axis makes it no skin (the outfit's own long hair lying on a collar)
    if (face.cast(_fo.set(axis.x, _fp.y, axis.z), _fr, r + 0.04, 'any') || cloth.cast(_fp, _fr, 0.05, 'in')) continue;
    if (cloth.cast(_fp, _fin.copy(_fr).negate(), r, 'out')) continue;
    keep.push(...corners);
  }
  if (!keep.length) return done(null);
  const fill = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) fill.setAttribute(name, a);
  fill.setIndex(keep);
  fill.boundingBox = g.boundingBox;
  fill.boundingSphere = g.boundingSphere;
  return done(fill);
}

/** how far apart two '#rrggbb' tones are (sRGB 0..255, per-channel RMS) */
function toneDistance(a: string, b: string): number {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.sqrt(((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2) / 3);
}

// ───────────────────────────── bone helpers ─────────────────────────────

const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _v = new THREE.Vector3();
const _bq = new THREE.Quaternion();
// (layInBed's scratch)
const _lb = Array.from({ length: 15 }, () => new THREE.Vector3());
const _lq = new THREE.Quaternion();
const _lq2 = new THREE.Quaternion();
const _lq3 = new THREE.Quaternion();
const _lm = new THREE.Matrix4();
const _lm2 = new THREE.Matrix4();
const _lm3 = new THREE.Matrix4();
const _lh = new THREE.Vector3();

/** the front of a trunk in its body's frame (y up the trunk, z out of its front): per 2 cm cell across (x) and up (y), how far out its skin comes */
interface Belly {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  z: Float32Array;
}

/** the trunk's front at (x, y) (Belly); −Infinity off the trunk */
function bellyAt(b: Belly, x: number, y: number): number {
  const i = Math.floor((x - b.x0) / 0.02);
  const j = Math.floor((y - b.y0) / 0.02);
  return i < 0 || j < 0 || i >= b.nx || j >= b.ny ? -Infinity : b.z[j * b.nx + i];
}

function rotateAroundWorldAxis(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_qp);
  _axis.copy(axisWorld).applyQuaternion(_qp.invert()).normalize();
  _q.setFromAxisAngle(_axis, angle);
  bone.quaternion.premultiply(_q);
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | undefined {
  let hit: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && re.test(o.name)) hit = o;
  });
  return hit;
}

// ───────────────────────────── face: blinks, lip-sync, expressions ─────────────────────────────

const VOWELS: [string, number][] = [['V_aa', 0.34], ['V_E', 0.24], ['V_I', 0.16], ['V_O', 0.16], ['V_U', 0.1]];
const CLOSURES = ['V_PP', 'V_FF', 'V_SS'];

/** expression targets per emotion (ARKit blendshape weights) */
const EXPRESSION: Partial<Record<Emotion, Record<string, number>>> = {
  pain: { BrowDownLeft: 0.5, BrowDownRight: 0.5, EyeSquintLeft: 0.45, EyeSquintRight: 0.45, MouthFrownLeft: 0.35, MouthFrownRight: 0.35 },
  anxious: { BrowInnerUp: 0.55, MouthFrownLeft: 0.15, MouthFrownRight: 0.15 },
  sad: { BrowInnerUp: 0.6, MouthFrownLeft: 0.4, MouthFrownRight: 0.4 },
  angry: { BrowDownLeft: 0.7, BrowDownRight: 0.7, MouthFrownLeft: 0.3, MouthFrownRight: 0.3 },
  confused: { BrowInnerUp: 0.35, BrowDownLeft: 0.2, EyeBlinkLeft: 0.2, EyeBlinkRight: 0.2 },
  drowsy: { EyeBlinkLeft: 0.45, EyeBlinkRight: 0.45, BrowInnerUp: 0.1 },
  relieved: { MouthSmileLeft: 0.25, MouthSmileRight: 0.25 },
  happy: { MouthSmileLeft: 0.5, MouthSmileRight: 0.5, EyeSquintLeft: 0.15, EyeSquintRight: 0.15 },
};

/** how far the upper lids are down at rest (EyeBlink weight) */
const REST_LID = 0.16;

/**
 * Where the eyes look. Each eyeball hangs off its own bone of the head (Bip01_LEye, _REye), so the
 * eyes can find the person in front before the head has turned, hold them while it nods, and never
 * sit dead still: small darts every second or two, and now and then a glance aside, as people do
 * when they talk and think. Angles are in the head's own frame, limited to what an eye does before
 * the head follows.
 */
class Eyes {
  private rest: THREE.Quaternion[];
  /** the head's forward, up and right in the head bone's own frame (from the rest pose) */
  private fwd = new THREE.Vector3(0, 0, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3(1, 0, 0);
  private yaw = 0;
  private pitch = 0;
  /** (the first one a moment in: a still of a fresh character looks straight ahead) */
  private dart = { yaw: 0, pitch: 0, until: 0.5 + Math.random() * 1.5 };
  private time = 0;

  /** at load, in the rest pose: `model` faces +z */
  constructor(private bones: THREE.Object3D[], private head: THREE.Object3D, model: THREE.Object3D) {
    this.rest = bones.map((b) => b.quaternion.clone());
    const toHead = head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(model.getWorldQuaternion(new THREE.Quaternion()));
    this.fwd.applyQuaternion(toHead);
    this.up.applyQuaternion(toHead);
    this.right.applyQuaternion(toHead);
  }

  /** target: a point to look at (world), or null: straight ahead. After the head's own turn. */
  update(dt: number, target: THREE.Vector3 | null, engaged: boolean) {
    this.time += dt;
    let yaw = 0;
    let pitch = 0;
    if (target) {
      const d = this.head.worldToLocal(_eye.copy(target)).normalize();
      const y = Math.atan2(d.dot(this.right), d.dot(this.fwd));
      // (behind the head, or far to the side: nobody to look at)
      if (Math.abs(y) < 1.2) {
        yaw = Math.max(-EYE_YAW, Math.min(EYE_YAW, y));
        pitch = Math.max(-EYE_PITCH, Math.min(EYE_PITCH, Math.asin(Math.max(-1, Math.min(1, d.dot(this.up))))));
      }
    }
    if (this.time >= this.dart.until) {
      // talking or listening to someone: mostly on them, a glance aside every few seconds; idle: the eyes wander
      const aside = engaged && Math.random() < 0.22;
      const spread = aside ? 0.2 : engaged ? 0.035 : 0.09;
      this.dart.yaw = (Math.random() * 2 - 1) * spread;
      this.dart.pitch = (Math.random() * 2 - 1) * spread * 0.5 - (aside ? 0.06 : 0);
      this.dart.until = this.time + (aside ? 0.5 + Math.random() * 0.6 : 0.7 + Math.random() * 1.8);
    }
    // a saccade: there in a few frames
    const k = Math.min(1, dt * 26);
    this.yaw += (yaw + this.dart.yaw - this.yaw) * k;
    this.pitch += (pitch + this.dart.pitch - this.pitch) * k;
    _eyeQ.setFromAxisAngle(this.up, this.yaw).multiply(_eyeQ2.setFromAxisAngle(this.right, -this.pitch));
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(_eyeQ).multiply(this.rest[i]);
  }
}
/** how far an eye turns in the head (rad): beyond it the head has to follow */
const EYE_YAW = 0.5;
const EYE_PITCH = 0.3;
const _eye = new THREE.Vector3();
const _eyeQ = new THREE.Quaternion();
const _eyeQ2 = new THREE.Quaternion();

/**
 * Drives the ARKit/viseme blendshapes the converter keeps (see convert-rocketbox.mjs):
 * - blinks every 2–6 s (slower and heavier when drowsy)
 * - lip-sync from the voice level: jaw follows loudness, a vowel viseme changes every
 *   ~110 ms while sound is on, brief lip closures (PP/FF/SS) on dips — no phoneme timing
 *   needed, and it reads as speech at conversation distance
 * - expressions eased toward the NPC's emotion
 */
class Face {
  private targets: { mesh: THREE.Mesh; dict: Record<string, number> }[] = [];
  private weights = new Map<string, number>();
  private nextBlink = 1 + Math.random() * 3;
  private blinkT = -1;
  private vowel = 'V_aa';
  private vowelT = 0;
  private closure = '';
  private closureT = 0;
  private lastLevel = 0;
  private level = 0;
  private time = 0;

  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences?.length) this.targets.push({ mesh: m, dict: m.morphTargetDictionary });
    });
  }

  get ok() {
    return this.targets.length > 0;
  }

  /** mouth: the shape of the word being said, where the voice knows its words (ui/visemes.ts) */
  update(dt: number, speaking: number, emotion: Emotion | undefined, eyesShut = 0, mouth: Mouth | null = null) {
    this.time += dt;
    const want = new Map<string, number>();
    // at rest the upper lid covers the top of the iris: the models' eyes are modeled wide open, white
    // showing above the iris, which reads as a startled stare
    want.set('EyeBlinkLeft', REST_LID);
    want.set('EyeBlinkRight', REST_LID);
    // asleep or out cold (ambient crowd): lids down, no blinks
    if (eyesShut > 0) {
      want.set('EyeBlinkLeft', eyesShut);
      want.set('EyeBlinkRight', eyesShut);
    }
    // expression (lids: whichever closes them more)
    for (const [k, v] of Object.entries(EXPRESSION[emotion ?? 'neutral'] ?? {})) want.set(k, Math.max(v, want.get(k) ?? 0));
    // blink
    const drowsy = emotion === 'drowsy' || emotion === 'confused';
    if (this.blinkT < 0 && this.time >= this.nextBlink) this.blinkT = 0;
    if (this.blinkT >= 0) {
      const dur = drowsy ? 0.32 : 0.15;
      this.blinkT += dt;
      const b = Math.sin(Math.min(1, this.blinkT / dur) * Math.PI);
      want.set('EyeBlinkLeft', Math.max(want.get('EyeBlinkLeft') ?? 0, b));
      want.set('EyeBlinkRight', Math.max(want.get('EyeBlinkRight') ?? 0, b));
      if (this.blinkT >= dur) {
        this.blinkT = -1;
        this.nextBlink = this.time + (drowsy ? 1.2 : 2) + Math.random() * 4 + (Math.random() < 0.15 ? -1.6 : 0);
      }
    }
    // lip-sync
    this.level += (speaking - this.level) * Math.min(1, dt * 18);
    const lv = Math.min(1, this.level * 1.8);
    if (mouth && lv > 0.03) {
      // the words' own shapes, as far open as the voice is loud right now (a pause in the sound shuts it)
      const loud = 0.55 + 0.45 * lv;
      want.set('JawOpen', (0.03 + mouth.jaw * 0.42) * loud);
      if (mouth.shape) want.set(`V_${mouth.shape}`, mouth.weight * loud);
    } else if (lv > 0.06) {
      // no words known (a murmur in the waiting room): a vowel shape that changes with the syllables
      this.vowelT -= dt;
      if (this.vowelT <= 0) {
        let r = Math.random();
        for (const [v, p] of VOWELS) {
          if ((r -= p) <= 0) {
            this.vowel = v;
            break;
          }
        }
        this.vowelT = 0.08 + Math.random() * 0.08;
      }
      // a sharp drop in loudness reads as a consonant: briefly close the lips
      if (this.lastLevel - this.level > 0.05 && this.closureT <= 0) {
        this.closure = CLOSURES[Math.floor(Math.random() * CLOSURES.length)];
        this.closureT = 0.07;
      }
      // conversation, not a shout: the jaw drops a little and the lips shape the sound (at 0.12 + 0.4 lv
      // every syllable gaped down to the lower teeth)
      want.set('JawOpen', 0.05 + lv * 0.2);
      want.set(this.vowel, 0.2 + lv * 0.5);
    }
    if (this.closureT > 0) {
      this.closureT -= dt;
      want.set(this.closure, 0.7);
    }
    this.lastLevel = this.level;
    // ease every known weight toward its target and write to the meshes
    const keys = new Set([...this.weights.keys(), ...want.keys()]);
    for (const k of keys) {
      const cur = this.weights.get(k) ?? 0;
      const target = want.get(k) ?? 0;
      const fast = k.startsWith('V_') || k === 'JawOpen' || k.startsWith('EyeBlink');
      const next = cur + (target - cur) * Math.min(1, dt * (fast ? 22 : 4));
      this.weights.set(k, next);
      for (const t of this.targets) {
        const i = t.dict[k];
        if (i !== undefined) t.mesh.morphTargetInfluences![i] = next;
      }
    }
  }
}

// ───────────────────────────── the character ─────────────────────────────

export interface AvatarOptions {
  height?: number;
  old?: boolean;
  /** called once the model is in (e.g. to hide a placeholder) */
  onReady?: () => void;
}

export class AvatarCharacter implements Character {
  readonly root = new THREE.Group();
  height: number;
  head: THREE.Object3D;
  posture: Posture = 'stand';
  emotion?: Emotion;
  lookYaw = 0;
  /** a point for the eyes to look at (world; the head turns by lookYaw), or null: straight ahead */
  lookAtPoint(p: THREE.Vector3 | null) {
    this.gazing = !!p;
    if (p) this.gaze.copy(p);
  }
  speaking = 0;
  /** the mouth shape of the word being said (ui/visemes.ts); null: only the voice level is known */
  mouth: Mouth | null = null;
  airborne = 0;
  seatKind: 'chair' | 'desk' | 'sofa' | 'bed' = 'chair';
  ready = false;
  failed = false;
  /** waiting-room life (shared/types AmbientAct): picks the clip / upper-body layer; undefined = by posture */
  act?: AmbientAct;
  /** after each animation update: procedural pose on top of the mocap (crowd.ts: holding a newspaper, typing) */
  postPose?: (av: AvatarCharacter, dt: number) => void;
  /** lying on the floor with someone holding the legs up (a faint) */
  legsUp = false;
  /** 0..1: how firmly someone's hands hold those legs (crowd.ts): they only rise while held */
  legHold = 0;
  /** the legs' rise, eased (0 flat … 1 heels ~30 cm up) */
  private legLift = 0;
  /**
   * Lying in a bed whose backrest moves (bedRig.ts): its rig, and how they lie on it (the server's
   * BedPosition; the ward's own). The body follows the rig's backrest as it moves (layInBed). null: as
   * on a flat bed. World and the ward set it.
   */
  bed: { rig: BedRig; pos?: BedPosition } | null = null;
  /** 0..1: how ashen the face is (a faint's prodrome) */
  pallor = 0;
  /** seated: height (m) the soles should rest at (floor ≈ 0.025 at the toe joint; a wheelchair's footrests higher) */
  footRest = 0.025;
  /** seated: how far (m) the feet must come up to rest there, measured with the seat fix */
  private footLift = 0;

  private body = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: Map<string, THREE.AnimationClip> | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private talkLayer: THREE.AnimationAction | null = null;
  /** an act's upper-body layer (phone, drink, pushing a wheelchair…) and its clip name */
  private actLayer: THREE.AnimationAction | null = null;
  private actLayerName = '';
  /** floor lying: 0 upright … 1 flat (eased, so a faint sinks instead of snapping) */
  private lieBlend = 0;
  private floor = false;
  /** props waiting for the skeleton, and the bones props hang from */
  private pending: { obj: THREE.Object3D; mount: Mount }[] = [];
  private tinted: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[] | null = null;
  private sex: 'm' | 'f' = 'm';
  private scale = 1;
  private clipSpeed: Record<string, number> = {};
  private bones: { head?: THREE.Object3D; neck?: THREE.Object3D; pelvis?: THREE.Object3D; hand?: THREE.Object3D; handL?: THREE.Object3D; forearmL?: THREE.Object3D; thighs?: THREE.Object3D[]; calves?: THREE.Object3D[]; feet?: THREE.Object3D[]; toes?: THREE.Object3D[] } = {};
  /** the jump layered over the clip (jump.ts), made at the first jump */
  private jump: JumpLayer | null = null;
  /** a phone held in a hand (phone.ts) */
  private phone: PhoneHold | null = null;
  private surfaceY = 0.64;
  private seatY = 0.48;
  private seatFix = new THREE.Vector3();
  private seatFixFor = '';
  /** the sit clip's weight when the fix was measured (< 1 while it still fades in), and where the hips were when it began */
  private seatFixW = 1;
  private seatFrom = new THREE.Vector3();
  /** Neutral shoe orientation and ankle height above the rendered sole, for wheelchair footplates. */
  readonly plantedFeet: Partial<Record<'L' | 'R', { ankle: number; rotation: THREE.Quaternion }>> = {};
  private headYaw = 0;
  private talkHold = 0;
  private nodPhase = Math.random() * 10;
  private shadow: THREE.Mesh;
  private face: Face | null = null;
  private eyes: Eyes | null = null;
  private gaze = new THREE.Vector3();
  private gazing = false;
  private blanket: PatientBlanket | null = null;
  /** in bed: knees up, a leg raised on a pillow (and which), sitting up off the backrest (eased 0..1) */
  private inBed = { knees: 0, leg: 0, side: 'R' as 'L' | 'R', upright: 0 };
  private inBedArms: Partial<Record<'L' | 'R', ArmBones | null>> = {};
  /** the rig whose leg pillow (and head pillow: press) this body put out */
  private pillowRig: BedRig | null = null;
  /** the head pillow under them: when it is next looked at, the head as it was then, the skin worth skinning */
  private pressing = { at: 0, head: new THREE.Vector3(Infinity, 0, 0), neck: new THREE.Vector3(Infinity, 0, 0), deg: NaN, cache: new Map<THREE.SkinnedMesh, Int32Array>() };
  private old: boolean;

  constructor(readonly cast: AvatarCast, opts: AvatarOptions = {}) {
    this.height = Math.min(1.98, Math.max(1.5, opts.height ?? 1.75));
    this.old = !!opts.old;
    this.root.add(this.body);
    // placeholder head anchor until the skeleton exists
    const anchor = new THREE.Object3D();
    anchor.position.y = this.height * 0.88;
    this.body.add(anchor);
    this.head = anchor;
    // soft contact shadow (helps grounding on low quality where there is no AO)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), contactShadowMaterial());
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.006;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
    void this.load(opts.onReady);
  }

  private async load(onReady?: () => void) {
    try {
      let headId = this.cast.head && this.cast.head !== this.cast.id ? this.cast.head : null;
      if (headId && HEAD_NEEDS_OWN_BODY.has(headId)) {
        // a face with no back to its head (casting.ts): worn elsewhere it would be see-through
        console.warn(`[avatar] ${headId}'s head only fits its own body: ${this.cast.id} keeps its own`);
        headId = null;
      }
      const [index, clips, gltf, donor] = await Promise.all([loadIndex(), loadClips(), loadModel(this.cast.id), headId ? loadModel(headId) : null]);
      const info = index.avatars[this.cast.id];
      this.sex = info?.sex ?? 'm';
      this.clipSpeed = index.clips;
      const model = SkeletonUtils.clone(gltf.scene);
      // another avatar's face on this body; the body's skin follows the face unless the cast sets one
      let bodySkin: string | undefined;
      if (donor && headId) {
        wearHead(model, donor.scene, info?.head ?? (this.sex === 'f' ? 1.52 : 1.59));
        const face = index.avatars[headId]?.skin;
        if (face && info?.skin && toneDistance(face, info.skin) > 10) bodySkin = face;
      }
      const headInfo = index.avatars[headId ?? this.cast.id];
      dressModel(model, this.cast, bodySkin, { head: headInfo?.skin, body: info?.skin, hair: headInfo?.hair });
      this.scale = this.height / (info?.height ?? 1.78);
      model.scale.multiplyScalar(this.scale);
      this.body.add(model);
      this.model = model;
      // Cull per camera: bounds from the rest pose, enlarged to cover every clip (sitting,
      // running, lying, since the body group's rotation moves the bounds with it). Without
      // bounds, each character was drawn into all seven exam-light shadow maps every frame.
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const sk = o as THREE.SkinnedMesh;
        if (!sk.isSkinnedMesh) return;
        sk.computeBoundingSphere();
        if (sk.boundingSphere) sk.boundingSphere.radius *= 1.6;
        sk.frustumCulled = true;
      });
      this.clips = clips;
      this.mixer = new THREE.AnimationMixer(model);
      const face = new Face(model);
      if (face.ok) this.face = face;
      this.bones.head = findBone(model, /_Head$/);
      // (still in the rest pose: no clip has played)
      const eyeBones = [findBone(model, /_LEye$/), findBone(model, /_REye$/)].filter((b): b is THREE.Object3D => !!b);
      if (this.bones.head && eyeBones.length === 2) this.eyes = new Eyes(eyeBones, this.bones.head, model);
      this.bones.neck = findBone(model, /_Neck$/);
      this.bones.pelvis = findBone(model, /_Pelvis$/);
      this.bones.hand = findBone(model, /_R_Hand$/);
      this.bones.handL = findBone(model, /_L_Hand$/);
      this.bones.forearmL = findBone(model, /_L_Forearm$/);
      this.bones.thighs = [findBone(model, /_L_Thigh$/), findBone(model, /_R_Thigh$/)].filter((b): b is THREE.Object3D => !!b);
      this.bones.calves = [findBone(model, /_L_Calf$/), findBone(model, /_R_Calf$/)].filter((b): b is THREE.Object3D => !!b);
      this.bones.feet = [findBone(model, /_L_Foot$/), findBone(model, /_R_Foot$/)].filter((b): b is THREE.Object3D => !!b);
      this.bones.toes = [findBone(model, /_L_Toe0$/), findBone(model, /_R_Toe0$/)].filter((b): b is THREE.Object3D => !!b);
      this.measurePlantedFeet(model);
      if (this.bones.head) {
        this.body.remove(this.head);
        this.head = this.bones.head;
      }
      this.ready = true;
      for (const p of this.pending.splice(0)) this.attach(p.obj, p.mount);
      this.play(this.chooseClip(false, 0), 0);
      onReady?.();
    } catch (e) {
      this.failed = true;
      console.warn(`[avatar] ${this.cast.id}: ${(e as Error).message}`);
      onReady?.();
    }
  }

  /** the clip playing now (tests and debugging) */
  get clip(): string {
    return this.currentName;
  }

  /** Measure once, in the model's standing bind pose, before the first mocap clip starts. */
  private measurePlantedFeet(model: THREE.Object3D) {
    if (this.bones.feet?.length !== 2) return;
    this.root.updateMatrixWorld(true);
    const sole = { L: Infinity, R: Infinity };
    const inv = this.root.matrixWorld.clone().invert();
    const vertex = new THREE.Vector3();
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      const pos = m.geometry.getAttribute('position');
      const indices = m.geometry.index;
      const toRoot = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      // In the bind pose the left and right shoes are on opposite sides of the body's centre.
      // Read only drawn vertices: some material primitives share the full mesh's position buffer.
      for (let i = 0, n = indices?.count ?? pos.count; i < n; i++) {
        vertex.fromBufferAttribute(pos, indices ? indices.getX(i) : i).applyMatrix4(toRoot);
        const side = vertex.x >= 0 ? 'L' : 'R';
        sole[side] = Math.min(sole[side], vertex.y);
      }
    });
    const unrotate = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const [i, side] of (['L', 'R'] as const).entries()) {
      const foot = this.bones.feet[i];
      const ankle = foot.getWorldPosition(vertex).applyMatrix4(inv).y - sole[side];
      if (ankle > 0.035 && ankle < 0.18) this.plantedFeet[side] = { ankle, rotation: foot.getWorldQuaternion(new THREE.Quaternion()).premultiply(unrotate) };
    }
  }

  /** world positions of the left and right toe joints (tests: do planted feet stay put?) */
  toesWorld(): [number, number, number][] {
    return (this.bones.toes ?? []).map((b) => b.getWorldPosition(_v).toArray() as [number, number, number]);
  }

  setPosture(p: Posture, surfaceY?: number, seatY?: number) {
    this.posture = p;
    if (surfaceY !== undefined) this.surfaceY = surfaceY;
    if (seatY !== undefined) this.seatY = seatY;
    // lying on the floor (a faint) eases down and back up; on a bed it snaps as before
    this.floor = p === 'lie' && this.surfaceY < 0.2;
  }

  /**
   * Hang a prop (accessories.ts) on a bone or the root. Bone props are modelled in metres in that
   * bone's frame; Rocketbox bones work in centimetres, so the prop is scaled back up.
   */
  attach(obj: THREE.Object3D, mount: Mount): void {
    if (mount === 'root') {
      this.root.add(obj);
      return;
    }
    // about one in ten hold a phone in the left hand (phone.ts mirrors the right-handed phone takes)
    if (obj.name === 'prop:phone' && mount === 'handR' && leftHanded(hashString(JSON.stringify(this.cast)))) mount = 'handL';
    const bone = mount === 'head' ? this.bones.head : mount === 'handR' ? this.bones.hand : mount === 'handL' ? this.bones.handL : this.bones.forearmL;
    if (!this.ready || !bone || !this.model) {
      if (!this.ready && !this.failed) this.pending.push({ obj, mount });
      return;
    }
    this.root.updateMatrixWorld(true);
    const bs = bone.getWorldScale(new THREE.Vector3()).x;
    const ms = this.model.getWorldScale(new THREE.Vector3()).x;
    obj.scale.setScalar(ms / Math.max(1e-6, bs));
    bone.add(obj);
    // a phone in the hand: fitted to this hand, thumb on the screen, at the ear for a call (phone.ts)
    if (obj.name === 'prop:phone' && (mount === 'handR' || mount === 'handL')) {
      this.phone?.dispose();
      this.phone = new PhoneHold(this.model, obj, mount === 'handL' ? 'L' : 'R', this.cast.id, hashString(JSON.stringify(this.cast)));
    }
  }

  detach(obj: THREE.Object3D): void {
    this.pending = this.pending.filter((p) => p.obj !== obj);
    if (this.phone?.prop === obj) {
      this.phone.dispose();
      this.phone = null;
    }
    obj.removeFromParent();
  }

  /** ashen skin (0..1): this character's skin materials get their own copies, tinted cooler and paler */
  private applyPallor(k: number) {
    if (!this.model || (k <= 0.001 && !this.tinted)) return;
    if (!this.tinted) {
      this.tinted = [];
      const seen = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name !== 'head' && mat.name !== 'body') return;
        let own = seen.get(mat);
        if (!own) {
          own = mat.clone();
          seen.set(mat, own);
          this.tinted!.push({ mat: own, base: own.color.clone() });
        }
        m.material = own;
      });
    }
    for (const t of this.tinted) t.mat.color.setRGB(t.base.r * (1 - 0.13 * k), t.base.g * (1 - 0.04 * k), t.base.b * (1 + 0.03 * k));
  }

  private action(name: string): THREE.AnimationAction | null {
    if (!this.mixer || !this.clips) return null;
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.clips.get(name) ?? this.clips.get(name.replace(/^f_/, 'm_')) ?? this.clips.get(`${this.sex}_idle`);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(name, a);
    }
    return a;
  }

  private play(name: string, fade = 0.45) {
    if (name === this.currentName) return;
    const next = this.action(name);
    if (!next) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    // start long idles at a random point so a room full of people isn't in lockstep
    if (!/walk|run|crouch_in/.test(name)) next.time = Math.random() * next.getClip().duration;
    // knees giving way happens once, and stays down
    next.setLoop(/crouch_in/.test(name) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = /crouch_in/.test(name);
    next.play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
    this.currentName = name;
  }

  private chooseClip(moving: boolean, speed: number): string {
    const s = this.sex;
    const emo = this.emotion;
    const upset = emo === 'anxious' || emo === 'pain' || emo === 'angry';
    if (moving) {
      // each pace gets the mocap cycle nearest its natural speed (index.json clips: walk_fast ≈1.5,
      // run_slow ≈2.3–2.4, run ≈2.8–2.9, run_fast ≈5.4–5.8 m/s), so the playback rate stays near 1
      // and cadence and stride look human instead of a sped-up jog
      if (!this.old && speed > 2.3) return speed > 3.9 ? `${s}_run_fast` : speed > 2.65 ? `${s}_run` : `${s}_run_slow`;
      return speed > 1.45 ? `${s}_walk_fast` : this.old || speed < 1.05 ? `${s}_walk_slow` : `${s}_walk`;
    }
    const act = this.actClip();
    if (act) return act;
    if (this.posture === 'lie') return `${s}_idle_breathe`;
    if (this.posture === 'sit') return this.seatKind === 'desk' ? `${s}_sit_desk` : upset ? `${s}_sit_nervous` : `${s}_sit`;
    if (this.talkHold > 0) return upset ? `${s}_talk_nervous` : emo === 'sad' ? `${s}_talk_sad` : `${s}_talk`;
    return upset ? `${s}_idle_nervous` : `${s}_idle`;
  }

  /** the full-body clip an ambient act asks for, or null (the posture decides) */
  private actClip(): string | null {
    const s = this.sex;
    switch (this.posture === 'sit' ? `sit:${this.act}` : this.posture === 'lie' ? '' : `${this.act}`) {
      case 'sit:cough':
        return `${s}_sit_cough`;
      case 'sit:yawn':
        return `${s}_sit_yawn`;
      case 'sit:look':
        return `${s}_sit_look`;
      case 'sit:touch_face':
        return `${s}_sit_face`;
      case 'sit:wait':
      case 'sit:stretch':
        return `${s}_sit_wait`;
      case 'sit:impatient':
        return `${s}_sit_nervous`;
      case 'sit:sleep':
        return `${s}_sit_breathe`;
      // the arms are posed by crowd.ts (a broadsheet held open; typing on a laptop on the lap)
      case 'sit:read':
        return `${s}_sit`;
      case 'sit:laptop':
        return `${s}_sit_desk`;
      case 'crouch':
      // squatting past his heels with his ankles in her hands (the arms: contact.ts)
      case 'hold_legs':
        return `${s}_crouch`;
      case 'crouch_talk':
        return `${s}_crouch_talk`;
      case 'buckle':
        return `${s}_crouch_in`;
      case 'unsteady':
        return `${s}_unsteady`;
      case 'cough':
        return `${s}_idle_cough`;
      case 'look':
        return `${s}_idle_look`;
      case 'impatient':
      case 'wait':
      case 'touch_face':
        return `${s}_idle_nervous`;
      case 'talk_angry':
        return `${s}_talk_nervous`;
      case 'talk':
        return `${s}_talk`;
      case 'listen':
        return `${s}_listen`;
      // 'clipboard' (a nurse calling the next name): standing as usual, talking when she calls; crowd.ts
      // holds the clipboard up in front of her (contact.ts readClipboard). Not the documents clip: that
      // one leans over a table that isn't there, head down, hands low (looked like petting an invisible dog)
      default:
        return null;
    }
  }

  /** the upper-body layer an ambient act wants on top of sitting, standing or walking ('' = none) */
  private actLayerFor(moving: boolean): string {
    const s = this.sex;
    const want: Partial<Record<AmbientAct, string>> = {
      phone_text: `${s}_phone_text_upper`,
      phone_call: `${s}_phone_call_upper`,
      drink: `${s}_drink_upper`,
      carry: `${s}_carry_upper`,
      push: `${s}_push_upper`,
      // (walking with a clipboard: an ordinary walk, the clipboard at her side)
      ...(moving ? {} : { film: `${s}_film_upper`, laugh: `${s}_laugh_upper` }),
    };
    const name = (this.act && want[this.act]) || '';
    // a layer must be a real upper-body clip, never the idle fallback
    return name && this.clips && (this.clips.has(name) || this.clips.has(name.replace(/^f_/, 'm_'))) ? name : '';
  }

  update(dt: number, t: number, moving: boolean, speed: number) {
    if (!this.ready || !this.mixer || !this.model) {
      return;
    }
    this.talkHold = this.speaking > 0.04 ? 0.8 : Math.max(0, this.talkHold - dt);
    const name = this.chooseClip(moving, speed);
    this.play(name, moving || /walk|run/.test(this.currentName) ? 0.25 : 0.5);
    if (moving && this.current) {
      const cs = (this.clipSpeed[name] || 1.1) * this.scale;
      this.current.setEffectiveTimeScale(Math.max(0.4, Math.min(2.2, speed / cs)));
    } else if (this.current) this.current.setEffectiveTimeScale(this.act === 'unsteady' ? 0.6 : this.act === 'buckle' ? 1.35 : this.act === 'sleep' ? 0.75 : this.emotion === 'drowsy' || this.emotion === 'confused' ? 0.7 : 1);

    // an act's upper-body layer (texting, a phone call, a drink, pushing a wheelchair, carrying)
    const layerName = this.actLayerFor(moving);
    if (layerName !== this.actLayerName) {
      if (this.actLayer) this.actLayer.fadeOut(0.35);
      this.actLayer = null;
      this.actLayerName = layerName;
      const a = layerName ? this.action(layerName) : null;
      if (a) {
        a.reset();
        // the mixer averages by weight: 12 : 1 gives the layer the arms (~92 %), a laugh only shades them
        a.setEffectiveWeight(/laugh/.test(layerName) ? 2.5 : 12);
        a.time = Math.random() * a.getClip().duration;
        a.fadeIn(0.35);
        a.play();
        this.actLayer = a;
      }
    }

    // seated talking: gestures on the upper body only (unless the act's layer has the hands)
    const wantLayer = this.posture === 'sit' && !moving && this.talkHold > 0 && !this.actLayer;
    if (wantLayer && !this.talkLayer) {
      const a = this.action(`${this.sex}_talk_upper`);
      if (a) {
        a.reset();
        a.setEffectiveWeight(0);
        a.play();
        this.talkLayer = a;
      }
    }
    if (this.talkLayer) {
      const w = this.talkLayer.getEffectiveWeight();
      const target = wantLayer ? 0.75 : 0;
      this.talkLayer.setEffectiveWeight(w + (target - w) * Math.min(1, dt * 4));
      if (!wantLayer && w < 0.02) {
        this.talkLayer.stop();
        this.talkLayer = null;
      }
    }

    this.mixer.update(dt);
    // eyes shut: fainted, or asleep in a chair or in bed (ward.ts)
    const out = this.act === 'floor' || (this.act === 'sleep' && (this.posture === 'sit' || this.posture === 'lie'));
    this.face?.update(dt, this.speaking, this.emotion, out ? 1 : this.act === 'buckle' ? 0.6 : 0, this.mouth);
    // a faint: grey and clammy from the first sway until well after he comes round
    const pale = this.act === 'unsteady' || this.act === 'buckle' || this.act === 'floor' ? 1 : this.act === 'come_round' || (this.floor && this.lieBlend > 0) ? 0.7 : 0;
    const before = this.pallor;
    this.pallor += (pale - this.pallor) * Math.min(1, dt * (pale > this.pallor ? 0.8 : 0.15));
    if (Math.abs(this.pallor - before) > 0.002 || (pale > 0 && !this.tinted)) this.applyPallor(this.pallor);

    // ── posture placement ──
    const body = this.body;
    if (this.blanket) this.blanket.visible = !moving && this.posture === 'lie' && !this.floor;
    // a faint: sinks to the floor over ~0.9 s (from the crouch), sits back up over ~1.4 s
    const flat = this.floor && this.posture === 'lie' ? 1 : 0;
    if (flat !== this.lieBlend) this.lieBlend = flat > this.lieBlend ? Math.min(1, this.lieBlend + dt / 0.9) : Math.max(0, this.lieBlend - dt / 1.4);
    if (this.lieBlend > 0 && !moving) {
      const e = this.lieBlend * this.lieBlend * (3 - 2 * this.lieBlend);
      body.rotation.set((-Math.PI / 2) * e, 0, 0);
      // (0.135: the back and buttocks on the floor, not 2.5 cm into it — tests/storyboard.ts faint)
      body.position.set(0, 0.135 * e, this.height * 0.53 * e);
      this.shadow.visible = e < 0.4;
    } else if (moving || this.posture === 'stand' || this.posture === 'walk') {
      // getting up: the seat's offset eases out as the standing (or walking) clip fades in, so the hips
      // rise out of the chair instead of first dropping by the offset
      const w = this.current ? Math.min(1, this.current.getEffectiveWeight()) : 1;
      if (this.seatFixFor) {
        this.seatFrom.copy(body.position);
        this.seatFixFor = '';
      }
      if (w < 0.999) body.position.copy(this.seatFrom).multiplyScalar(1 - w);
      else {
        body.position.set(0, 0, 0);
        this.seatFrom.set(0, 0, 0); // later walk/idle transitions are already on the floor
      }
      body.rotation.set(0, 0, 0);
      this.shadow.visible = true;
    } else if (this.posture === 'sit') {
      body.rotation.set(0, 0, 0);
      this.shadow.visible = true;
      // put the pelvis ~10 cm above the seat and over the seat center, measured once per clip. While
      // a sit-down still cross-fades from standing or walking, the hips are only partway down: measure
      // again each frame and ease the fix in with the clip's weight. (Measured on that first, mostly
      // standing frame, it left anyone who walked to a chair sitting ~0.3 m into the floor.)
      const key = `${this.currentName}|${this.seatY.toFixed(2)}`;
      const w = this.current ? Math.min(1, this.current.getEffectiveWeight()) : 1;
      if (this.seatFixFor !== key) this.seatFrom.copy(body.position);
      if ((this.seatFixFor !== key || this.seatFixW < 0.999) && this.bones.pelvis) {
        body.position.set(0, 0, 0);
        this.model.updateMatrixWorld(true);
        this.root.updateMatrixWorld(true);
        const p = this.root.worldToLocal(this.bones.pelvis.getWorldPosition(_v));
        // The business suit extends lower at the hip in the seated clip.
        const hipClearance = this.cast.id === 'Business_Male_05' ? 0.117 : 0.1;
        this.seatFix.set(0, this.seatY + hipClearance - p.y, 0.02 - p.z);
        this.seatFixFor = key;
        this.seatFixW = w;
        // the mocap was recorded on a slightly taller chair than ours (0.48 m): with the hips on the
        // seat, planted feet would end 2–6 cm into the floor. Measure the lowest toe joint once;
        // knees come up just enough (below) for the soles to rest on the floor, hips stay put.
        body.position.copy(this.seatFix);
        this.root.updateMatrixWorld(true);
        let low = Infinity;
        for (const b of this.bones.toes ?? []) low = Math.min(low, this.root.worldToLocal(b.getWorldPosition(_v)).y);
        this.footLift = Number.isFinite(low) ? Math.max(0, this.footRest - low) : 0;
      }
      if (w < 0.999) body.position.copy(this.seatFrom).lerp(this.seatFix, w * w * w);
      else body.position.copy(this.seatFix);
    } else if (this.posture === 'lie') {
      this.shadow.visible = false;
      // supine: head toward −z (pillow end of the bed), face up, back on the mattress
      body.rotation.set(-Math.PI / 2, 0, 0);
      body.position.set(0, this.surfaceY + 0.115, this.height * 0.53);
      // in a bed whose backrest moves: on it at its angle, hips at its crease, legs along the bed, hands resting
      const rig = !this.floor && this.bed ? this.bed.rig : null;
      if (rig) this.layInBed(dt, rig);
      if (this.pillowRig && this.pillowRig !== rig) {
        this.pillowRig.legPillow(null);
        this.pillowRig.press(null);
      }
      this.pillowRig = rig;
      // hospital blanket draped over the body as it lies, top sheet turned down at the chest
      // (bedding.ts; draped again only when the pose, the bed, its backrest or the lying height changes)
      (this.blanket ??= new PatientBlanket(this.root)).update(dt, this.model, this.surfaceY, rig?.bend ?? null);
    }
    if (this.posture !== 'lie' && this.pillowRig) {
      this.pillowRig.legPillow(null);
      this.pillowRig.press(null);
      this.pillowRig = null;
    }

    // ── knees giving way (a faint): the mocap sinks below our floor; the body comes up so the toes and
    // knees stay on it (they went 6–8 cm into it: tests/storyboard.ts faint) ──
    if (this.act === 'buckle' && this.posture === 'stand' && this.lieBlend === 0 && !moving) {
      this.root.updateMatrixWorld(true);
      let low = 0;
      for (const b of this.bones.toes ?? []) low = Math.min(low, this.root.worldToLocal(b.getWorldPosition(_v)).y - 0.025);
      for (const b of this.bones.calves ?? []) low = Math.min(low, this.root.worldToLocal(b.getWorldPosition(_v)).y - 0.07);
      body.position.y -= low;
    }

    // ── procedural head look + talking nod ──
    const { head, neck } = this.bones;
    if (head && neck) {
      this.model.updateMatrixWorld(true);
      const lim = this.posture === 'lie' ? 0.7 : 1.0;
      this.headYaw += (Math.max(-lim, Math.min(lim, this.lookYaw)) - this.headYaw) * Math.min(1, dt * 3.5);
      body.getWorldQuaternion(_bq);
      const up = _v.set(0, 1, 0).applyQuaternion(_bq);
      rotateAroundWorldAxis(neck, up, this.headYaw * 0.4);
      neck.updateMatrixWorld(true);
      rotateAroundWorldAxis(head, up, this.headYaw * 0.6);
      const right = _v.set(1, 0, 0).applyQuaternion(_bq);
      let pitch = 0;
      if (this.posture === 'lie') pitch += this.floor ? -0.08 : 0.28 + this.chinUp(); // chin a little toward the chest (pillow); flat on the floor
      if (this.act === 'sleep' && this.posture === 'sit') pitch += 0.5; // asleep in the chair: chin on the chest
      if (this.speaking > 0.02) {
        this.nodPhase += dt * 9;
        pitch += Math.sin(this.nodPhase) * 0.05 * Math.min(1, this.speaking * 2);
      }
      head.updateMatrixWorld(true);
      rotateAroundWorldAxis(head, right, pitch);
      // the eyes, once the head is where it will be drawn (shut: they stay as they were)
      if (this.eyes && !out) {
        head.updateMatrixWorld(true);
        this.eyes.update(dt, this.gazing ? this.gaze : null, this.gazing || this.speaking > 0.02);
      }
    }

    // ── in a bed: the hands back on the belly (the arms hang from the neck, so turning the head swung them into
    // the trunk), and the pillow pressed under the head and shoulders as they now lie ──
    if (this.posture === 'lie' && this.bed && !this.floor) {
      for (const r of this.handRest) if (r.w > 0 && r.arm) reachArm(r.arm, r.target, r.pole, r.w, r.quat);
      // (the head's last turn, the nod, is in its matrices too)
      this.bones.head?.updateMatrixWorld(true);
      this.onPillow(this.bed.rig);
    }

    // ── seated on a chair lower than the mocap's: hips flex a few degrees so the feet reach the floor ──
    if (this.posture === 'sit' && !moving && this.footLift > 0.003 && this.bones.thighs?.length) {
      body.getWorldQuaternion(_bq);
      const side = _v.set(1, 0, 0).applyQuaternion(_bq);
      // the toes sit ≈ 0.33 × body height in front of the hip joint when seated, so they rise by about that × angle
      const a = Math.min(0.3, this.footLift / (0.33 * this.height));
      for (const b of this.bones.thighs) rotateAroundWorldAxis(b, side, -a);
    }

    // ── a faint, legs raised: hips flexed ~22°, knees straight, heels ~30 cm up — only while someone's
    // hands hold the ankles (legHold, crowd.ts), eased up and back down (never legs hanging in the air) ──
    const lift = this.legsUp && this.lieBlend > 0.95 ? Math.max(0, Math.min(1, this.legHold)) : 0;
    this.legLift += Math.max(-dt / 1.3, Math.min(dt / 1.1, lift - this.legLift));
    if (this.legLift > 0.001 && this.lieBlend > 0.95 && this.bones.thighs?.length) {
      body.getWorldQuaternion(_bq);
      const side = _v.set(1, 0, 0).applyQuaternion(_bq);
      const e = this.legLift * this.legLift * (3 - 2 * this.legLift);
      for (const b of this.bones.thighs) rotateAroundWorldAxis(b, side, -0.39 * e);
    }

    // ── a jump (the player): push-off, the tuck or leap in the air, the landing's knee bend (jump.ts) ──
    if (this.airborne > 0 || this.jump?.active) (this.jump ??= new JumpLayer(this.model, body)).update(dt, this.airborne, this.root.position.y, speed, this.current);
    // ── a phone in the hand: the grip, the thumb on the glass, the screen to the eyes or at the ear (phone.ts) ──
    this.phone?.update(dt, this.act);
    this.postPose?.(this, dt);
    void t;
  }

  /** lying in a bed with its backrest up: how far the trunk is turned up from flat (rad; care.ts aims at the chest by it) */
  get trunkTilt(): number {
    return this.posture === 'lie' && this.bed && !this.floor ? this.bed.rig.bend.head + 0.17 * this.inBed.upright : 0;
  }

  /** tests: how the body lies in its bed: the back's line (layInBed's fit) */
  get bedFit() {
    return this.backFit;
  }

  /** lying in a bed: how far the front of the trunk is out from one of its bones (m, measured on the skin; care.ts), if known */
  frontOf(bone: 'Pelvis' | 'Spine' | 'Spine1' | 'Spine2'): number | undefined {
    return this.posture === 'lie' && this.bed ? this.backFit?.front[bone] : undefined;
  }

  /** tests: the blanket over them as it is now, and their skin (root frame; bedding.ts PatientBlanket.dump) */
  blanketDump() {
    return this.blanket?.visible ? this.blanket.dump(this.model) : null;
  }

  /** in a bed with its backrest part way up: the head bends forward a little more (they look down the bed, not at the ceiling) */
  private chinUp(): number {
    const th = this.posture === 'lie' && this.bed ? this.bed.rig.bend.head : 0;
    return 0.2 * Math.sin(2 * Math.min(th, Math.PI / 4)) - 0.1 * Math.max(0, Math.sin(th) - 0.75);
  }

  /**
   * In a bed whose backrest moves (bedRig.ts), after the flat lying placement: the back on the backrest
   * at its angle; the hip joints over its crease, as high over the mattress as lying flat and on the
   * crease's bisector, so that the back and the thighs both rest on the mattress (a patient slides a
   * few cm toward the foot as the backrest comes up, as in a real bed); the thighs turned back down
   * along the bed; the knees bent up (or just enough to keep a tall patient's feet on the mattress), or
   * one leg raised on a pillow; sitting up, the hands resting on the belly.
   */
  private layInBed(dt: number, rig: BedRig) {
    for (const r of this.handRest) r.w = 0;
    const b = this.bones;
    const model = this.model;
    const thighs = b.thighs;
    const calves = b.calves;
    if (!model || !thighs || thighs.length < 2 || !calves || calves.length < 2) return;
    const body = this.body;
    const pos = this.bed?.pos;
    const ib = this.inBed;
    // the nurse helps them: knees, the leg, sitting up ease in over a couple of seconds
    const k = Math.min(1, dt * 1.6);
    ib.knees += ((pos?.knees ? 1 : 0) - ib.knees) * k;
    ib.upright += ((pos?.sitting === 'upright' ? 1 : 0) - ib.upright) * k;
    if (pos?.legUp && (ib.leg < 0.02 || pos.legUp === ib.side)) ib.side = pos.legUp;
    ib.leg += ((pos?.legUp === ib.side ? 1 : 0) - ib.leg) * k;
    const bend = rig.bend;
    // the crease and the mattress top in the root's frame (the patient lies centred in the bed, turned its way)
    this.root.updateMatrixWorld(true);
    const C = this.root.worldToLocal(rig.toWorld(_lb[0].set(0, bend.T, bend.zH), _lb[1]));
    const top = C.y;
    const th = this.trunkTilt;
    // the hip joints (between the thighs' pivots) in the body's frame, as the clip has them now
    body.updateMatrixWorld(true);
    const hipL = body.worldToLocal(thighs[0].getWorldPosition(_lb[2]).add(thighs[1].getWorldPosition(_lb[3])).multiplyScalar(0.5));
    // the back's line on this body (buttocks to shoulder blades) and the hips' height over it, measured once the
    // clip is in (while it still fades in from sitting or standing, every frame: that pose is a blend)
    const fit = this.backFit?.clip === this.currentName ? this.backFit : (this.backFit = this.fitBack(hipL));
    if ((this.current?.getEffectiveWeight() ?? 1) < 0.99) fit.clip = '';
    // the hips over the crease as high as the back lets them (sunk a little into the mattress), out along its
    // bisector as the backrest comes up; the body turned about them until its back lies on the backrest
    const d = fit.d - 0.008;
    const J = _lb[4].set(0, top + d, C.z + d * Math.tan(th / 2));
    body.rotation.set(-Math.PI / 2 + th - fit.phi, 0, 0);
    body.position.copy(J).sub(_lb[5].copy(hipL).applyEuler(body.rotation));
    body.position.x = 0;
    body.updateMatrixWorld(true);
    // the thighs back down along the bed (the hips bend as far as the trunk went up), the calves on the mattress
    const side = _lb[6].set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_lq));
    for (const t of thighs) rotateAroundWorldAxis(t, side, fit.phi - th + fit.lift[/_L_/.test(t.name) ? 'L' : 'R']);
    const kH = this.height / 1.75;
    const rootQ = this.root.getWorldQuaternion(_lq);
    const inRoot = (bone: THREE.Object3D, out: THREE.Vector3) => this.root.worldToLocal(bone.getWorldPosition(out));
    // the mattress's foot end, in the root's frame (a tall patient's feet must stay on it)
    const footEnd = this.root.worldToLocal(rig.toWorld(_lb[0].set(0, bend.T, rig.spec.zFoot), _lb[1])).z;
    let pillow: { x: number; z: number } | null = null;
    for (let i = 0; i < 2; i++) {
      const thigh = thighs[i];
      const calf = calves[i];
      const foot = b.feet?.[i];
      const left = /_L_/.test(thigh.name);
      const raise = ib.leg * (ib.side === (left ? 'L' : 'R') ? 1 : 0);
      const kn = ib.knees * (1 - raise);
      thigh.updateMatrixWorld(true);
      if (!foot) continue;
      // too tall for the bed (they slid down as it came up): the knee comes up a little, the heel on the mattress
      // and the toes up; if that is not enough, the foot goes flat on the mattress, far enough that the toes stay
      // on it. A raised leg keeps its toes up (its heel at the pillow's end)
      const A0 = inRoot(foot, _lb[7]);
      const thighLen = inRoot(calf, _lb[8]).distanceTo(inRoot(thigh, _lb[9]));
      const limit = footEnd - 0.04;
      const bendFor = (reach: number) => {
        const pull = A0.z + reach * kH - limit;
        return pull > 0 ? Math.acos(Math.max(0.6, 1 - pull / (2 * thighLen))) : 0;
      };
      const kUp = bendFor(0.07);
      const plant = raise > 0.5 ? 0 : kn > 0.002 ? kn : kUp > 0.45 ? 1 : 0;
      const kappa = Math.max(0.8 * kn, plant > 0.5 ? bendFor(0.19) : kUp);
      if (kappa > 0.002) {
        // knees up: the hip bends (~45° for comfort), the shin goes back down to the mattress: to a planted foot's
        // ankle height (feet flat; measured on this body standing), or to where the ankle lay (the heel down)
        const ankleH = A0.y + plant * (top + fit.ankle - A0.y);
        rotateAroundWorldAxis(thigh, side, -kappa);
        thigh.updateMatrixWorld(true);
        const K = inRoot(calf, _lb[7]);
        const A = inRoot(foot, _lb[8]);
        const shin = A.distanceTo(K);
        const now = Math.atan2(A.y - K.y, A.z - K.z);
        const want = -Math.asin(Math.min(0.98, Math.max(0, (K.y - ankleH) / Math.max(0.1, shin))));
        rotateAroundWorldAxis(calf, side, now - want);
        calf.updateMatrixWorld(true);
        const toe = b.toes?.[i];
        if (toe) {
          const F = inRoot(foot, _lb[7]);
          const T = inRoot(toe, _lb[8]);
          const tilt = Math.atan2(T.y - F.y, T.z - F.z);
          // planted: the sole down on the mattress (the toes a little lower than the ankle); else the toes stay up
          if (plant > 0.002) rotateAroundWorldAxis(foot, side, (tilt + 0.3) * plant);
          else rotateAroundWorldAxis(foot, side, Math.min(0, tilt - 1.2));
        }
      }
      if (raise > 0.002) {
        // raised on a pillow under the calf: the leg up as far as the pillow's height, the knee eased a little
        const K = inRoot(calf, _lb[7]);
        const A = foot ? inRoot(foot, _lb[8]) : _lb[8].copy(K).add(_lb[9].set(0, 0, 0.42 * kH));
        const mid = _lb[9].copy(K).add(A).multiplyScalar(0.5);
        const reach = Math.max(0.3, mid.z - J.z);
        rotateAroundWorldAxis(thigh, side, -Math.asin(Math.min(0.5, (LEG_PILLOW.h + 0.005) / reach)) * raise);
        rotateAroundWorldAxis(calf, side, 0.07 * raise);
        if (raise > 0.5) {
          const w = rig.toBed(this.root.localToWorld(_lb[10].copy(mid)), _lb[10]);
          pillow = { x: w.x, z: w.z + 0.02 };
        }
      }
    }
    rig.legPillow(pillow);
    // sitting up, the hands rest on the belly (above the blanket, turned down at the waist: bedding.ts);
    // flat, the arms lie at the sides as the clip has them
    const w = this.handsOnBelly();
    if (w < 0.01) return;
    // the trunk's own axes (root frame): out of the front, toward the head
    const front = _lb[11].set(0, Math.cos(th), Math.sin(th));
    const headward = _lb[12].set(0, Math.sin(th), -Math.cos(th));
    // this body's belly and hands as its skin has them (bellyShape): the hands lie on the shirt, whatever the build
    const shape = this.bellyShape();
    body.updateMatrixWorld(true);
    const bodyQ = body.getWorldQuaternion(_lq3);
    const toBody = _lm2.copy(body.matrixWorld).invert();
    for (const s of ['L', 'R'] as const) {
      const arm = (this.inBedArms[s] ??= armBones(model, s));
      if (!arm) continue;
      const x = s === 'L' ? 1 : -1;
      // in the body's frame: the wrist a hand's length out to the side of the navel; the fingers in toward it and a
      // little down the body, along the belly's slope from the wrist to the fingertips (unmeasured: a guess at its front)
      const W = _lb[7].set(x * 0.13 * kH, hipL.y + 0.2 * kH, hipL.z + 0.13 * kH);
      const f = _lb[14].set(-x * 0.85, -0.45, 0).normalize();
      if (shape) {
        const reach = 0.15 * kH;
        const zW = bellyAt(shape.belly, W.x, W.y);
        const zF = bellyAt(shape.belly, W.x + f.x * reach, W.y + f.y * reach);
        if (zW > -Infinity && zF > -Infinity) {
          W.z = zW + 0.02;
          f.multiplyScalar(reach).setZ(zF - zW).normalize();
        }
      }
      // the palm onto the belly (Rocketbox hands: Y out of the palm), square to the fingers
      const out = _lb[8].set(0, 0, 1).addScaledVector(f, -f.z).normalize();
      const fingers = _lb[9].copy(f).applyQuaternion(bodyQ);
      const palm = _lb[10].copy(out).negate().applyQuaternion(bodyQ);
      const thumb = _lb[13].copy(fingers).cross(palm).multiplyScalar(s === 'R' ? 1 : -1);
      const hq = handQuat(s, fingers, thumb, _lq2);
      // where the hand's skin would be: lifted or lowered until its deepest point is just on the shirt
      const pts = shape?.hands[s];
      if (shape && pts) {
        _lm3.compose(body.localToWorld(_lh.copy(W)), hq, arm.hand.getWorldScale(_lb[13])).premultiply(toBody);
        let deep = -Infinity;
        for (let k = 0; k < pts.length; k += 3) {
          const p = _lh.set(pts[k], pts[k + 1], pts[k + 2]).applyMatrix4(_lm3);
          const z = bellyAt(shape.belly, p.x, p.y);
          if (z > -Infinity) deep = Math.max(deep, z - p.z);
        }
        // The sampled belly is a coarse grid; leave room for the shirt and the fingers'
        // deformation after the wrist is posed (noticeable on the smaller patient bodies).
        if (deep > -Infinity) W.z += deep + 0.009;
      }
      const target = body.localToWorld(W);
      // the elbows out to the sides and back, by the waist
      const shR = this.root.worldToLocal(arm.upper.getWorldPosition(_lb[10]));
      const pole = this.root.localToWorld(shR.add(_lb[13].set(x * 0.4, 0, 0)).addScaledVector(front, -0.12).addScaledVector(headward, -0.3));
      reachArm(arm, target, pole, w, hq);
      // (and again once the head has turned: update)
      const r = this.handRest[s === 'L' ? 0 : 1];
      r.arm = arm;
      r.target.copy(target);
      r.pole.copy(pole);
      r.quat.copy(hq);
      r.w = w;
    }
  }

  /** the hands' rest on the belly this frame (layInBed) */
  private handRest = [0, 1].map(() => ({ arm: null as ArmBones | null, target: new THREE.Vector3(), pole: new THREE.Vector3(), quat: new THREE.Quaternion(), w: 0 }));

  /** the trunk's front and the hands' skin, measured once per clip (bellyShape) */
  private bellyFit: { clip: string; belly: Belly; hands: Record<'L' | 'R', Float32Array | null> } | null = null;

  /**
   * This body's trunk front (Belly, its own frame) and each hand's skin (in its hand bone's frame), from the
   * skin as the clip has it, once the clip is fully in (meanwhile the last one, if any): a broad trunk or a
   * slim one, the hands on the belly rest on the shirt.
   */
  private bellyShape() {
    const model = this.model;
    if (this.bellyFit?.clip === this.currentName || !model || (this.current?.getEffectiveWeight() ?? 1) < 0.99) return this.bellyFit;
    this.body.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const handInv: Record<'L' | 'R', THREE.Matrix4 | null> = { L: null, R: null };
    for (const s of ['L', 'R'] as const) {
      const a = (this.inBedArms[s] ??= armBones(model, s));
      if (a) handInv[s] = new THREE.Matrix4().copy(a.hand.matrixWorld).invert();
    }
    const trunk: number[] = [];
    const hand: Record<'L' | 'R', number[]> = { L: [], R: [] };
    const v = new THREE.Vector3();
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || Array.isArray(m.material) || (m.material as THREE.Material).name !== 'body') return;
      const pos = m.geometry.getAttribute('position');
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      // (the primitives share one vertex buffer: the body's own vertices are the ones its index uses)
      const idx = m.geometry.index;
      const own = new Uint8Array(pos.count);
      if (idx) for (let k = 0; k < idx.count; k++) own[idx.getX(k)] = 1;
      else own.fill(1);
      for (let i = 0; i < pos.count; i++) {
        if (!own[i]) continue;
        let bi = 0;
        for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, bi)) bi = j;
        const name = m.skeleton.bones[si.getComponent(i, bi)]?.name ?? '';
        const isTrunk = /_Pelvis$|_Spine\d?$/.test(name);
        const s = /_L_(Hand|Finger)/.test(name) ? 'L' : /_R_(Hand|Finger)/.test(name) ? 'R' : null;
        if (!isTrunk && !(s && handInv[s] && i % 2 === 0)) continue;
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
        if (isTrunk) {
          v.applyMatrix4(inv);
          trunk.push(v.x, v.y, v.z);
        } else if (s) {
          v.applyMatrix4(handInv[s]!);
          hand[s].push(v.x, v.y, v.z);
        }
      }
    });
    if (trunk.length < 300) return this.bellyFit;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < trunk.length; k += 3) {
      x0 = Math.min(x0, trunk[k]);
      x1 = Math.max(x1, trunk[k]);
      y0 = Math.min(y0, trunk[k + 1]);
      y1 = Math.max(y1, trunk[k + 1]);
    }
    const nx = Math.ceil((x1 - x0) / 0.02) + 1;
    const ny = Math.ceil((y1 - y0) / 0.02) + 1;
    const z = new Float32Array(nx * ny).fill(-Infinity);
    for (let k = 0; k < trunk.length; k += 3) {
      const c = Math.floor((trunk[k + 1] - y0) / 0.02) * nx + Math.floor((trunk[k] - x0) / 0.02);
      z[c] = Math.max(z[c], trunk[k + 2]);
    }
    // (a cell between vertices: its neighbours' mean)
    const filled = new Float32Array(z);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (z[j * nx + i] > -Infinity) continue;
        let sum = 0;
        let n = 0;
        for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (a < 0 || b < 0 || a >= nx || b >= ny || !(z[b * nx + a] > -Infinity)) continue;
          sum += z[b * nx + a];
          n++;
        }
        if (n >= 2) filled[j * nx + i] = sum / n;
      }
    const pack = (p: number[]) => (p.length >= 30 ? new Float32Array(p) : null);
    this.bellyFit = { clip: this.currentName, belly: { x0, y0, nx, ny, z: filled }, hands: { L: pack(hand.L), R: pack(hand.R) } };
    return this.bellyFit;
  }

  /**
   * The back as this body's clip has it (the body's own frame: y up the body, z forward), measured once
   * per clip from the skin: the line touching the back from behind at the buttocks and the shoulder
   * blades, its tilt from the body's axis (phi), how far in front of it the hip joints are (d), and the
   * turn of the legs that lays the calves and heels on the mattress that line lies on (lift). A standing
   * clip's back isn't straight: laid on this line, the back rests on the mattress instead of sinking in.
   */
  private backFit: ReturnType<AvatarCharacter['fitBack']> | null = null;
  private fitBack(hipL: THREE.Vector3) {
    const fit = { clip: this.currentName, phi: 0, d: 0.123, lift: { L: 0, R: 0 }, ankle: 0.075 * (this.height / 1.75), front: {} as Record<string, number> };
    const model = this.model;
    if (!model) return fit;
    this.body.updateMatrixWorld(true);
    const inv = _lm.copy(this.body.matrixWorld).invert();
    const kH = this.height / 1.75;
    // (and how far the front of the trunk is out from its bones, on the midline: care.ts aims an exam there)
    const FRONT = ['Pelvis', 'Spine', 'Spine1', 'Spine2'];
    const at = FRONT.map((n) => {
      const b = model.getObjectByName(`Bip01_${n}`);
      return b ? b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null;
    });
    // the back (the trunk, and the buttocks hanging from the thighs near the hips), and the legs past them
    const back: number[] = [];
    const legs: Record<'L' | 'R', number[]> = { L: [], R: [] };
    let cy = 0;
    let cz = 0;
    // (the clip stands: its soles are on the floor, so the ankles' height over them is a planted foot's)
    let sole = Infinity;
    const v = _lb[13];
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || Array.isArray(m.material) || (m.material as THREE.Material).name !== 'body') return;
      const pos = m.geometry.getAttribute('position');
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      // (the primitives share one vertex buffer: the body's own vertices are the ones its index uses)
      const idx = m.geometry.index;
      const own = new Uint8Array(pos.count);
      if (idx) for (let k = 0; k < idx.count; k++) own[idx.getX(k)] = 1;
      else own.fill(1);
      for (let i = 0; i < pos.count; i += 2) {
        if (!own[i]) continue;
        let bi = 0;
        for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, bi)) bi = j;
        const name = m.skeleton.bones[si.getComponent(i, bi)]?.name ?? '';
        const trunk = /Pelvis|Spine|Neck|Clavicle/.test(name);
        if (!trunk && !/Thigh|Calf|Foot/.test(name)) continue;
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        if (trunk || hipL.y - v.y < 0.18 * kH) {
          back.push(v.y, v.z);
          if (trunk) {
            cy += v.y;
            cz += v.z;
            if (Math.abs(v.x) < 0.04 * kH)
              FRONT.forEach((n, k) => {
                const b = at[k];
                if (b && Math.abs(v.y - b.y) < 0.035 * kH) fit.front[n] = Math.max(fit.front[n] ?? 0, v.z - b.z);
              });
          }
        } else {
          legs[/_L_/.test(name) ? 'L' : 'R'].push(v.y, v.z);
          if (/Foot/.test(name)) sole = Math.min(sole, v.y);
        }
      }
    });
    const ankles = (b: THREE.Object3D | undefined) => (b ? b.getWorldPosition(_lb[12]).applyMatrix4(inv).y : NaN);
    const ankleY = (ankles(this.bones.feet?.[0]) + ankles(this.bones.feet?.[1])) / 2;
    if (Number.isFinite(ankleY - sole)) fit.ankle = Math.max(0.05, Math.min(0.14, ankleY - sole));
    const n = back.length / 2;
    if (n < 100) return fit;
    cy /= n;
    cz /= n;
    // lying on a flat mattress, the trunk settles at the turn that brings its middle lowest: the line
    // (normal (−sin φ, cos φ) in the body's y–z) touching the back from behind, at the shoulder blades and the sacrum
    let best = Infinity;
    for (let phi = -0.35; phi <= 0.35; phi += 0.005) {
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      let lo = Infinity;
      for (let k = 0; k < back.length; k += 2) lo = Math.min(lo, -back[k] * s + back[k + 1] * c);
      const h = -cy * s + cz * c - lo;
      if (h < best) {
        best = h;
        fit.phi = phi;
        fit.d = -hipL.y * s + hipL.z * c - lo;
      }
    }
    // A standing animation can stagger the feet. Rest each leg on the mattress independently.
    for (const side of ['L', 'R'] as const) {
      const points = legs[side];
      let need = -Infinity;
      for (let k = 0; k < points.length; k += 2) {
        const out = hipL.y - points[k];
        if (out > 0.15 * kH) need = Math.max(need, (hipL.z - points[k + 1] - fit.d) / out);
      }
      // Convert the measured rise over run into a rotation. A staggered heel can
      // need 8–10 degrees to settle even with its partner resting on the sheet.
      // (bounded: a clip with a raised knee must not swing a thigh up through the sheet)
      if (Number.isFinite(need)) fit.lift[side] = -Math.max(-LIFT_MAX, Math.min(LIFT_MAX, Math.atan(need)));
    }
    return fit;
  }

  /**
   * The head pillow gives way under the head, neck and shoulders (bedRig.ts press): pressed again (at most ten
   * times a second) as soon as the head has moved (turned to someone), the shoulders have or the backrest has.
   */
  private onPillow(rig: BedRig) {
    const pr = this.pressing;
    const hb = this.bones.head;
    const nb = this.bones.neck;
    const now = performance.now();
    if (!this.model || !hb || now < pr.at) return;
    const h = hb.localToWorld(_v.set(0.1, 0.1, 0.1));
    const n = nb ? nb.getWorldPosition(_lb[0]) : h;
    if (rig.pressing && Math.abs(rig.head - pr.deg) < 0.002 && h.distanceTo(pr.head) < 0.004 && n.distanceTo(pr.neck) < 0.004) return;
    // (every frame while the backrest moves under them)
    pr.at = rig.moving ? 0 : now + 100;
    pr.head.copy(h);
    pr.neck.copy(n);
    pr.deg = rig.head;
    const p = pillowPress(this.model, rig, pr.cache);
    if (p) rig.press(p);
  }

  /** how far the hands have gone to the belly (0 at the sides … 1): as the backrest comes up past ~10° */
  private handsOnBelly(): number {
    const th = this.trunkTilt;
    return Math.min(1, Math.max(0, (th - 0.17) / 0.35));
  }

  /** world position of the right hand (for carrying things), null until the model is loaded */
  handWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.bones.hand) return null;
    return this.bones.hand.getWorldPosition(out);
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.phone?.dispose();
    this.jump?.dispose();
    this.root.removeFromParent();
  }
}

let shadowMat: THREE.MeshBasicMaterial | null = null;
function contactShadowMaterial(): THREE.MeshBasicMaterial {
  if (shadowMat) return shadowMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  shadowMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  return shadowMat;
}

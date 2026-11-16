/**
 * What the waiting-room crowd wears and carries (AmbientProp in shared/types.ts): a phone in a
 * case with a live screen, earbuds or over-ear headphones, a surgical mask, an ice pack, a bandaged
 * hand, a towel round a cut forearm, a drink can, a clipboard, a walker, a pet carrier, a wheelchair.
 *
 * Built procedurally at real size. Each prop is merged into ONE mesh with vertex colours and a
 * shared material, so a prop is one draw call (the phone two: the case, and its glass with what the
 * screen shows — the picture is emissive, so bloom picks it up at night; no lights). Small props cast
 * no shadows. Geometry is built once per kind and shared. How a phone sits in the hand, the thumb on
 * it and what its screen does: phone.ts.
 *
 * Mounting: worn and held props hang off a bone, in that bone's frame. Rocketbox (3ds Max biped)
 * bones work in centimetres (bone scale 0.01), and their axes are
 *   head:  X up, Y forward (where the face looks), Z to the character's left
 *   hands: X along the fingers, Y out of the palm, Z toward the thumb (left hand: −Z)
 *   forearms: X toward the wrist
 * so an offset below is in cm along those axes. Floor props (walker, carrier, wheelchair) hang off
 * the character's root in metres (+z = the way they face).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { AmbientProp } from '../../../shared/types';
import { canvasTexture, trackGeo } from './materials';
import { buildLaptop, buildNewspaper, disposeReading } from './reading';

export type Mount = 'head' | 'handR' | 'handL' | 'forearmL' | 'root';

export interface PropMesh {
  kind: AmbientProp;
  obj: THREE.Object3D;
  mount: Mount;
}

// ───────────────────────────── shared materials ─────────────────────────────

let shared: { paint: THREE.MeshStandardMaterial; screen: THREE.MeshStandardMaterial } | null = null;
function mats() {
  if (!shared) {
    shared = {
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 }),
      // a phone's glass and what it shows (phoneAtlas): the picture is the emission, so it reads lit
      // in any light, and its whites are bright enough to bloom a little at night; never a light source.
      // Black glass around it only reflects.
      screen: new THREE.MeshStandardMaterial({ color: '#000000', map: phoneAtlas(), emissive: '#ffffff', emissiveMap: phoneAtlas(), emissiveIntensity: PHONE_GLOW.night, roughness: 0.16, metalness: 0 }),
    };
  }
  return shared;
}

/** paint a geometry one colour (vertex colours) after transforming it into place */
function part(g: THREE.BufferGeometry, color: string, m?: THREE.Matrix4): THREE.BufferGeometry {
  const geo = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
  if (m) geo.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

/** a tube along points (metres) */
function rod(points: [number, number, number][], r: number, seg = 12): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.05);
  return new THREE.TubeGeometry(curve, seg, r, 6, false);
}

const cache = new Map<string, THREE.BufferGeometry>();
function merged(key: string, build: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = trackGeo(mergeGeometries(build(), false)!);
    g.computeBoundingSphere();
    cache.set(key, g);
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// ───────────────────────────── worn and held (bone frames, metres) ─────────────────────────────

/**
 * Props are modelled in a natural frame (x = the wearer's left, y = up, z = forward, metres) and
 * turned into the bone's frame: for the head (X up, Y forward, Z left) and the right hand (X along
 * the fingers, Y out of the palm, Z the thumb) that is the same rotation: x→Z, y→X, z→Y. The left
 * hand's thumb is −Z, so it gets the same turn plus a half turn about the palm normal.
 */
const TO_BONE = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
const TO_LEFT_HAND = TO_BONE.clone().premultiply(new THREE.Matrix4().makeRotationY(Math.PI));

function framed(m: THREE.Object3D, basis: THREE.Matrix4): THREE.Object3D {
  const g = new THREE.Group();
  m.applyMatrix4(basis);
  g.add(m);
  return g;
}

// ───────────────────────────── the phone ─────────────────────────────

/**
 * A current smartphone in a slim case, at real size (m). Its own frame: origin at the middle of the
 * back, x to the screen's right, y to its top, z out of the screen. phone.ts places it in the hand
 * (fitted to each avatar's hand bones) and drives what the screen shows.
 */
export const PHONE = {
  /** the case: width, height, thickness */
  w: 0.0745,
  h: 0.1535,
  t: 0.0094,
  /** the front glass, inset in the case's lip */
  glassW: 0.0712,
  glassH: 0.1502,
  /** the display inside the bezel (2.2 mm at the sides, 3.1 mm top and bottom) */
  dispW: 0.0668,
  dispH: 0.144,
  /** the glass surface (z), where a thumb lands */
  screenZ: 0.0096,
  /** the earpiece, below the top edge of the glass (m) */
  speaker: 0.0105,
};
/** the screen's light (emissiveIntensity): a touch brighter at night, when it stands out most */
const PHONE_GLOW = { night: 1.25, day: 0.95 };

/** cases (by wearer: phone.ts picks one with a hash): black, navy, sage, burgundy, sand, slate, lilac */
const CASES = ['#141518', '#1f2a44', '#5d6f5f', '#5a2430', '#cdbb9c', '#4b535c', '#9d8fb3'];

function phoneBody(color: string): THREE.BufferGeometry {
  return merged(`phone_body|${color}`, () => {
    const { w, h, t } = PHONE;
    const out = [part(new RoundedBoxGeometry(w, h, t, 3, 0.0045), color, T(0, 0, t / 2))];
    // camera island on the back, top corner (top right seen from the front): two lenses and a flash
    out.push(part(new RoundedBoxGeometry(0.03, 0.03, 0.0026, 2, 0.006), shade(color, 0.82), T(0.0165, 0.056, 0.0004)));
    for (const [x, y] of [[0.0095, 0.0635], [0.0095, 0.0485]] as const) {
      out.push(part(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0014, 20), '#1c1d20', T(x + 0.0007, y, -0.0013, Math.PI / 2, 0, 0)));
      out.push(part(new THREE.CylinderGeometry(0.0041, 0.0041, 0.0012, 18), '#07080b', T(x + 0.0007, y, -0.0021, Math.PI / 2, 0, 0)));
    }
    out.push(part(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0008, 12), '#e9e2c8', T(0.0245, 0.064, -0.0011, Math.PI / 2, 0, 0)));
    // keys through the case: power on the right edge, volume on the left
    out.push(part(new RoundedBoxGeometry(0.0016, 0.016, 0.0032, 1, 0.0007), shade(color, 1.15), T(w / 2 + 0.0004, 0.028, t / 2)));
    for (const y of [0.04, 0.022]) out.push(part(new RoundedBoxGeometry(0.0016, 0.011, 0.0032, 1, 0.0007), shade(color, 1.15), T(-w / 2 - 0.0004, y, t / 2)));
    return out;
  });
}

/** a colour lighter or darker by k (sRGB-ish) */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** in the hand: the phone's frame inside the prop (phone.ts fits it to the hand; this is only a first guess) */
function phone(left: boolean): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'phone';
  const body = mesh(phoneBody(CASES[0]), mats().paint);
  body.name = 'phone_body';
  g.add(body);
  const screen = new PhoneScreen();
  g.add(screen.mesh);
  g.userData.screen = screen;
  // hand frame (cm-scaled metres): X along the fingers, Y out of the palm, Z toward the thumb (left: −Z).
  // Long side diagonal across the palm, screen out of it, back on the palm.
  const s = left ? -1 : 1;
  const a = (35 * Math.PI) / 180;
  const up = new THREE.Vector3(Math.cos(a), 0, s * Math.sin(a));
  const n = new THREE.Vector3(0, 1, 0);
  g.matrix.makeBasis(new THREE.Vector3().crossVectors(up, n), up, n).setPosition(0.115, 0.024, s * 0.022);
  g.matrix.decompose(g.position, g.quaternion, g.scale);
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/** the phone's case colour (CASES index) */
export function setPhoneCase(prop: THREE.Object3D, i: number) {
  const body = prop.getObjectByName('phone_body') as THREE.Mesh | undefined;
  if (body) body.geometry = phoneBody(CASES[((i % CASES.length) + CASES.length) % CASES.length]);
}

export function phoneScreen(prop: THREE.Object3D): PhoneScreen | null {
  return (prop.getObjectByName('phone')?.userData.screen as PhoneScreen | undefined) ?? null;
}

/** day or night: the screens' glow (World.setNight can call this) */
export function setPhoneNight(night: boolean) {
  mats().screen.emissiveIntensity = night ? PHONE_GLOW.night : PHONE_GLOW.day;
}

// ── what a phone shows: one atlas canvas, scrolled per phone ──
//
// 512 × 1024, three 160 px columns (16 px gutters so mipmaps don't bleed):
//   A (x 0)   a messaging thread, tiling top to bottom (it scrolls)
//   B (x 176) a photo feed, tiling (it scrolls)
//   C (x 352) fixed pieces: the keyboard with its input bar, a camera viewfinder, the apps' top bars, black
// No names, logos or brands: text is drawn as grey bars, as it reads from a step away.
const ATLAS_W = 512;
const ATLAS_H = 1024;
const COL = { chat: 0, feed: 176, fixed: 352 };
const COL_W = 160;
/** px: the display is 160 × 345; its top bar 40 (status + app header), the keyboard 144 */
const DISP_PX = (COL_W * PHONE.dispH) / PHONE.dispW;
const TOP_PX = 40;
const KB_PX = 144;
const FIXED = { keyboard: 0, camera: 152, chatTop: 508, feedTop: 556, black: 1000 };

let atlasTex: THREE.CanvasTexture | null = null;
function phoneAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  const c = document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext('2d')!;
  let seed = 9187;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const rr = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  /** something drawn at y, and again a column-height up where it runs off the bottom (the column tiles) */
  const wrap = (y: number, h: number, draw: (y: number) => void) => {
    draw(y);
    if (y + h > ATLAS_H) draw(y - ATLAS_H);
  };
  // ── A: a messaging thread (light theme): incoming white bubbles left, sent blue bubbles right ──
  {
    const x0 = COL.chat;
    g.fillStyle = '#eef1f5';
    g.fillRect(x0, 0, COL_W, ATLAS_H);
    g.save();
    g.beginPath();
    g.rect(x0, 0, COL_W, ATLAS_H);
    g.clip();
    // lay the thread out first, so it ends a gap short of where it starts again (the column tiles)
    const first = 10;
    const items: { y: number; stamp: boolean; sent: boolean; lines: number[]; bw: number; face: string }[] = [];
    let y = first;
    for (;;) {
      const stamp = rand() < 0.14;
      const sent = rand() < 0.48;
      const n = 1 + Math.floor(rand() * rand() * 4);
      const bw = Math.min(118, 34 + rand() * 54 + (n > 1 ? 30 : 0));
      const lines = Array.from({ length: n }, (_, i) => (bw - 14) * (i === n - 1 && n > 1 ? 0.35 + rand() * 0.45 : 0.75 + rand() * 0.25));
      const face = ['#f0b27a', '#8fb9e8', '#a7d3a1', '#d7a6d9'][Math.floor(rand() * 4)];
      const top = y + (stamp ? 14 : 0);
      const end = top + 8 + n * 8;
      if (end > ATLAS_H + first - 7) break;
      items.push({ y: top, stamp, sent, lines, bw, face });
      y = end + 5 + (rand() < 0.3 ? 5 : 0);
    }
    for (const it of items) {
      const bh = 8 + it.lines.length * 8;
      const bx = it.sent ? x0 + COL_W - 7 - it.bw : x0 + 17;
      // a time stamp between bursts
      if (it.stamp) wrap(it.y - 14, 10, (yy) => rr(x0 + 62, yy + 2, 36, 4, 2, '#b7bec8'));
      wrap(it.y, bh, (yy) => {
        if (!it.sent) {
          g.fillStyle = it.face;
          g.beginPath();
          g.arc(x0 + 9, yy + bh - 5, 4.5, 0, Math.PI * 2);
          g.fill();
        }
        rr(bx, yy, it.bw, bh, 7, it.sent ? '#2f7cf6' : '#ffffff');
        it.lines.forEach((lw, i) => rr(bx + 7, yy + 6 + i * 8, lw, 3.2, 1.6, it.sent ? '#d9e6ff' : '#5c6470'));
      });
    }
    g.restore();
  }
  // ── B: a photo feed (cards: who posted, a picture, actions, a caption) ──
  {
    const x0 = COL.feed;
    g.fillStyle = '#ffffff';
    g.fillRect(x0, 0, COL_W, ATLAS_H);
    g.save();
    g.beginPath();
    g.rect(x0, 0, COL_W, ATLAS_H);
    g.clip();
    const photo = (kind: number, x: number, y: number, w: number, h: number) => {
      const grad = (stops: [number, string][]) => {
        const gr = g.createLinearGradient(0, y, 0, y + h);
        for (const [o, col] of stops) gr.addColorStop(o, col);
        g.fillStyle = gr;
        g.fillRect(x, y, w, h);
      };
      const poly = (pts: number[][], fill: string) => {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(x + pts[0][0] * w, y + pts[0][1] * h);
        for (const p of pts.slice(1)) g.lineTo(x + p[0] * w, y + p[1] * h);
        g.closePath();
        g.fill();
      };
      switch (kind % 6) {
        case 0: // sunset over hills
          grad([[0, '#6b5b95'], [0.45, '#f39c6b'], [0.7, '#ffd08a'], [1, '#ffd08a']]);
          g.fillStyle = '#ffe9b8';
          g.beginPath();
          g.arc(x + w * 0.62, y + h * 0.62, h * 0.14, 0, Math.PI * 2);
          g.fill();
          poly([[0, 0.72], [0.25, 0.6], [0.5, 0.74], [0.75, 0.62], [1, 0.7], [1, 1], [0, 1]], '#3d3552');
          break;
        case 1: // a beach
          grad([[0, '#7ec4ef'], [0.5, '#cfeaf9'], [0.52, '#2f8fc2'], [0.7, '#3aa0cf'], [0.72, '#f1e3bd'], [1, '#e3cc97']]);
          g.fillStyle = 'rgba(255,255,255,0.8)';
          g.fillRect(x, y + h * 0.69, w, 2);
          break;
        case 2: // mountains
          grad([[0, '#8fbde3'], [1, '#d7e8f4']]);
          poly([[0, 0.8], [0.3, 0.3], [0.55, 0.7], [0.75, 0.38], [1, 0.75], [1, 1], [0, 1]], '#5b6878');
          poly([[0.24, 0.39], [0.3, 0.3], [0.36, 0.39]], '#f3f6f9');
          poly([[0.7, 0.45], [0.75, 0.38], [0.8, 0.45]], '#f3f6f9');
          poly([[0, 0.86], [1, 0.8], [1, 1], [0, 1]], '#5e8e4f');
          break;
        case 3: // a plate of food on a wooden table
          grad([[0, '#a77a52'], [1, '#8c6340']]);
          g.fillStyle = 'rgba(0,0,0,0.12)';
          for (let i = 0; i < 6; i++) g.fillRect(x, y + (i * h) / 6, w, 1);
          g.fillStyle = '#f4f2ee';
          g.beginPath();
          g.ellipse(x + w / 2, y + h / 2, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
          g.fill();
          for (const [dx, dy, r, col] of [[-0.06, -0.04, 0.12, '#e3913f'], [0.07, 0.03, 0.1, '#7fae4a'], [0.0, 0.1, 0.08, '#c8423b']] as const) {
            g.fillStyle = col;
            g.beginPath();
            g.arc(x + w * (0.5 + dx), y + h * (0.5 + dy), h * r, 0, Math.PI * 2);
            g.fill();
          }
          break;
        case 4: // a city at night (hashed, not rand(): a card drawn twice at the seam must match)
          grad([[0, '#17213b'], [1, '#33456e']]);
          for (let i = 0; i < 9; i++) {
            const bw = w / 9;
            const bh2 = h * (0.3 + (((i * 37) % 11) / 11) * 0.45);
            g.fillStyle = '#0f1526';
            g.fillRect(x + i * bw, y + h - bh2, bw - 1, bh2);
            g.fillStyle = '#ffd27a';
            for (let k = 0; k < 6; k++) if ((i * 7 + k * 5) % 3 !== 0) g.fillRect(x + i * bw + 2 + (k % 2) * 6, y + h - bh2 + 4 + Math.floor(k / 2) * 7, 2, 3);
          }
          break;
        default: // a cat on a sofa
          grad([[0, '#eadfce'], [1, '#d6c5ae']]);
          g.fillStyle = '#7b7470';
          g.beginPath();
          g.ellipse(x + w * 0.55, y + h * 0.7, w * 0.2, h * 0.17, 0, 0, Math.PI * 2);
          g.fill();
          g.beginPath();
          g.arc(x + w * 0.38, y + h * 0.55, h * 0.13, 0, Math.PI * 2);
          g.fill();
          poly([[0.31, 0.47], [0.33, 0.33], [0.37, 0.44]], '#7b7470');
          poly([[0.39, 0.44], [0.43, 0.33], [0.45, 0.47]], '#7b7470');
          break;
      }
    };
    // six cards exactly one column tall, so the feed tiles: picture heights vary, and sum to fit
    const CARDS = 6;
    const spare = ATLAS_H - CARDS * (20 + 47);
    const raw = Array.from({ length: CARDS }, () => 0.8 + rand() * 0.4);
    const sum = raw.reduce((a, b) => a + b, 0);
    const heights = raw.map((r) => Math.floor((r / sum) * spare));
    heights[0] += spare - heights.reduce((a, b) => a + b, 0);
    let y = 0;
    for (let k = 0; k < CARDS; k++) {
      const ih = heights[k];
      const tint = ['#f2a65a', '#6aa8e0', '#9ccf8a', '#c79ad6', '#e0807a'][k % 5];
      const nameW = 34 + rand() * 30;
      const capW = [0.9, 0.75, 0.4].map((f) => (COL_W - 16) * (f - rand() * 0.15));
      const draw = (yy: number) => {
        g.fillStyle = tint;
        g.beginPath();
        g.arc(x0 + 11, yy + 10, 6, 0, Math.PI * 2);
        g.fill();
        rr(x0 + 21, yy + 5, nameW, 4, 2, '#2a2f36');
        rr(x0 + 21, yy + 12, 24, 3, 1.5, '#a3aab3');
        photo(k, x0, yy + 20, COL_W, ih);
        // actions: a heart, a speech bubble, an arrow
        const ay = yy + 20 + ih + 5;
        g.strokeStyle = '#30353c';
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x0 + 10, ay + 3, 2.6, Math.PI, 0);
        g.arc(x0 + 15, ay + 3, 2.6, Math.PI, 0);
        g.lineTo(x0 + 12.5, ay + 9);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.arc(x0 + 27, ay + 4, 4, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(x0 + 37, ay + 7);
        g.lineTo(x0 + 45, ay + 1);
        g.lineTo(x0 + 43, ay + 8);
        g.closePath();
        g.stroke();
        capW.forEach((cw, i) => rr(x0 + 8, ay + 14 + i * 7, cw, 3, 1.5, i === 0 ? '#3b414a' : '#7d858f'));
        g.fillStyle = '#eceef2';
        g.fillRect(x0, ay + 38, COL_W, 4);
      };
      const ch = 20 + ih + 47;
      wrap(y, ch, draw);
      y += ch;
    }
    g.restore();
  }
  // ── C: fixed pieces ──
  {
    const x0 = COL.fixed;
    const status = (y: number, dark: boolean) => {
      const ink = dark ? '#ffffff' : '#1d2127';
      g.fillStyle = ink;
      g.font = '600 9px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText('21:56', x0 + 12, y + 8);
      for (let i = 0; i < 4; i++) g.fillRect(x0 + 112 + i * 4, y + 11 - (i + 1) * 1.6, 2.5, (i + 1) * 1.6);
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.strokeRect(x0 + 132.5, y + 4.5, 15, 7);
      g.fillRect(x0 + 148, y + 6.5, 1.5, 3);
      g.fillRect(x0 + 134, y + 6, 10, 4);
    };
    // the keyboard, with the message field above it
    let y = FIXED.keyboard;
    g.fillStyle = '#f5f6f8';
    g.fillRect(x0, y, COL_W, 26);
    rr(x0 + 6, y + 5, 126, 16, 8, '#ffffff');
    g.strokeStyle = '#d3d7dd';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x0 + 6.5, y + 5.5, 125, 15, 7.5);
    g.stroke();
    rr(x0 + 13, y + 11, 52, 4, 2, '#4a5059');
    g.fillStyle = '#2f7cf6';
    g.beginPath();
    g.arc(x0 + 146, y + 13, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(x0 + 146, y + 8.5);
    g.lineTo(x0 + 150, y + 13.5);
    g.lineTo(x0 + 142, y + 13.5);
    g.closePath();
    g.fill();
    g.fillRect(x0 + 145, y + 13, 2, 4.5);
    y += 26;
    g.fillStyle = '#d2d6dc';
    g.fillRect(x0, y, COL_W, KB_PX - 26);
    const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
    const kw = (COL_W - 6 - 9 * 3) / 10;
    g.font = '500 8px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    rows.forEach((row, r) => {
      const ry = y + 5 + r * 24;
      const off = r === 1 ? kw / 2 + 1.5 : r === 2 ? kw * 1.5 + 4.5 : 0;
      for (let i = 0; i < row.length; i++) {
        const kx = x0 + 3 + off + i * (kw + 3);
        rr(kx, ry + 0.8, kw, 19, 2.5, '#a9aeb6');
        rr(kx, ry, kw, 19, 2.5, '#ffffff');
        g.fillStyle = '#1e2228';
        g.fillText(row[i], kx + kw / 2, ry + 10);
      }
      if (r === 2) {
        rr(x0 + 3, ry, kw * 1.4, 19, 2.5, '#b4b9c1');
        rr(x0 + COL_W - 3 - kw * 1.4, ry, kw * 1.4, 19, 2.5, '#b4b9c1');
      }
    });
    const by = y + 5 + 3 * 24;
    rr(x0 + 3, by, 30, 19, 2.5, '#b4b9c1');
    rr(x0 + 36, by, 88, 19, 2.5, '#ffffff');
    rr(x0 + 127, by, 30, 19, 2.5, '#2f7cf6');
    g.textAlign = 'left';
    // a camera viewfinder (filming): the room, soft; record dot and timer, the shutter
    y = FIXED.camera;
    const cam = g.createLinearGradient(0, y, 0, y + DISP_PX);
    cam.addColorStop(0, '#4a4540');
    cam.addColorStop(0.45, '#77695c');
    cam.addColorStop(0.75, '#5a5048');
    cam.addColorStop(1, '#2d2926');
    g.fillStyle = cam;
    g.fillRect(x0, y, COL_W, DISP_PX);
    for (const [bx, by2, r] of [[40, 40, 26], [120, 30, 22], [80, 120, 34]] as const) {
      const rg = g.createRadialGradient(x0 + bx, y + by2, 0, x0 + bx, y + by2, r);
      rg.addColorStop(0, 'rgba(255,240,210,0.75)');
      rg.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = rg;
      g.fillRect(x0, y, COL_W, DISP_PX);
    }
    rr(x0 + 20, y + 200, 50, 70, 10, 'rgba(30,26,24,0.55)');
    rr(x0 + 92, y + 190, 46, 80, 10, 'rgba(30,26,24,0.5)');
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x0, y, COL_W, 22);
    g.fillRect(x0, y + DISP_PX - 52, COL_W, 52);
    g.fillStyle = '#ff3b30';
    g.beginPath();
    g.arc(x0 + 62, y + 12, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '600 9px system-ui, sans-serif';
    g.fillText('00:12', x0 + 69, y + 12.5);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x0 + 80, y + DISP_PX - 26, 15, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ff3b30';
    rr(x0 + 74, y + DISP_PX - 32, 12, 12, 2.5, '#ff3b30');
    // the apps' top bars: status bar + header
    y = FIXED.chatTop;
    g.fillStyle = '#f8f9fb';
    g.fillRect(x0, y, COL_W, TOP_PX);
    status(y, false);
    g.strokeStyle = '#2f7cf6';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x0 + 12, y + 22);
    g.lineTo(x0 + 8, y + 28);
    g.lineTo(x0 + 12, y + 34);
    g.stroke();
    g.fillStyle = '#8fb9e8';
    g.beginPath();
    g.arc(x0 + 26, y + 28, 7, 0, Math.PI * 2);
    g.fill();
    rr(x0 + 38, y + 23, 48, 4.5, 2, '#20252c');
    rr(x0 + 38, y + 31, 30, 3, 1.5, '#9aa2ac');
    g.fillStyle = '#dde1e7';
    g.fillRect(x0, y + TOP_PX - 1, COL_W, 1);
    y = FIXED.feedTop;
    g.fillStyle = '#ffffff';
    g.fillRect(x0, y, COL_W, TOP_PX);
    status(y, false);
    rr(x0 + 10, y + 23, 44, 7, 3, '#20252c');
    g.strokeStyle = '#20252c';
    g.lineWidth = 1.4;
    g.strokeRect(x0 + 128.5, y + 21.5, 9, 9);
    g.beginPath();
    g.arc(x0 + 148, y + 26, 4.5, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#eceef2';
    g.fillRect(x0, y + TOP_PX - 1, COL_W, 1);
    g.fillStyle = '#000000';
    g.fillRect(x0, FIXED.black, COL_W, ATLAS_H - FIXED.black);
  }
  atlasTex = canvasTexture(c);
  atlasTex.anisotropy = 8;
  atlasTex.wrapT = THREE.RepeatWrapping;
  return atlasTex;
}

export type PhoneApp = 'chat' | 'feed' | 'camera' | 'off';

/**
 * A phone's front, one mesh (one draw): the black glass, and on it the display in three parts — the
 * app's top bar (status bar + header), the content (scrolled through the atlas column, which tiles),
 * and the keyboard, which slides up from the bottom edge. Set `app`, `scroll` and `kb`, then update().
 */
export class PhoneScreen {
  readonly mesh: THREE.Mesh;
  app: PhoneApp = 'off';
  /** px down the content column (grows as the thumb swipes up through a feed, or as messages come in) */
  scroll = 0;
  /** keyboard: 0 hidden … 1 up */
  kb = 0;
  private pos = new Float32Array(16 * 3);
  private uv = new Float32Array(16 * 2);
  private last = '';

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(16 * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    // corners per quad: top-left, top-right, bottom-left, bottom-right; counter-clockwise seen from the front (+z)
    const idx: number[] = [];
    for (let q = 0; q < 4; q++) idx.push(q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 2, q * 4 + 3, q * 4 + 1);
    geo.setIndex(idx);
    // the glass never moves: bounds once
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, PHONE.screenZ), PHONE.glassH / 2 + 0.002);
    this.mesh = mesh(geo, mats().screen);
    this.mesh.name = 'phone_screen';
    this.update(true);
  }

  /** write the quads if anything changed (cheap when nothing did) */
  update(force = false) {
    const key = `${this.app}|${this.scroll.toFixed(1)}|${this.kb.toFixed(3)}`;
    if (key === this.last && !force) return;
    this.last = key;
    const { glassW, glassH, dispW, dispH, screenZ } = PHONE;
    const z = screenZ;
    const zd = screenZ + 0.00008;
    const zk = screenZ + 0.00016;
    /** quad q: x0..x1, y0 (bottom)..y1 (top) at depth zz; atlas px u0..u1, v0 (top row)..v1 (bottom row) */
    const quad = (q: number, x0: number, x1: number, y0: number, y1: number, zz: number, u0: number, u1: number, pTop: number, pBot: number) => {
      const P = this.pos;
      const U = this.uv;
      const corners = [
        [x0, y1, u0, pTop],
        [x1, y1, u1, pTop],
        [x0, y0, u0, pBot],
        [x1, y0, u1, pBot],
      ];
      corners.forEach(([x, y, u, p], i) => {
        P.set([x, y, zz], (q * 4 + i) * 3);
        U.set([u / ATLAS_W, 1 - p / ATLAS_H], (q * 4 + i) * 2);
      });
    };
    const blackU = [COL.fixed + 40, COL.fixed + 120];
    const blackV = [FIXED.black + 4, ATLAS_H - 4];
    quad(0, -glassW / 2, glassW / 2, -glassH / 2, glassH / 2, z, blackU[0], blackU[1], blackV[0], blackV[1]);
    const L = -dispW / 2;
    const R = dispW / 2;
    const top = dispH / 2;
    const bot = -dispH / 2;
    const m = dispH / DISP_PX; // metres per atlas px
    const off = this.app === 'off';
    // collapsed (and black) when there's nothing to show
    const none = (q: number) => quad(q, 0, 0, 0, 0, zd, blackU[0], blackU[1], blackV[0], blackV[1]);
    if (off) {
      none(1);
      none(2);
      none(3);
    } else if (this.app === 'camera') {
      quad(1, L, R, top - TOP_PX * m, top, zd, COL.fixed, COL.fixed + COL_W, FIXED.camera, FIXED.camera + TOP_PX);
      quad(2, L, R, bot, top - TOP_PX * m, zd, COL.fixed, COL.fixed + COL_W, FIXED.camera + TOP_PX, FIXED.camera + DISP_PX);
      none(3);
    } else {
      const col = this.app === 'chat' ? COL.chat : COL.feed;
      const head = this.app === 'chat' ? FIXED.chatTop : FIXED.feedTop;
      quad(1, L, R, top - TOP_PX * m, top, zd, COL.fixed, COL.fixed + COL_W, head, head + TOP_PX);
      // the content: with the keyboard up, a thread shows its newest messages just above it
      const s = this.scroll + (this.app === 'chat' ? this.kb * (KB_PX - 8) : 0);
      const cpx = DISP_PX - TOP_PX;
      quad(2, L, R, bot, top - TOP_PX * m, zd, col, col + COL_W, s, s + cpx);
      if (this.kb > 0.002) {
        const h = KB_PX * this.kb;
        quad(3, L, R, bot, bot + h * m, zk, COL.fixed, COL.fixed + COL_W, FIXED.keyboard, FIXED.keyboard + h);
      } else none(3);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

/** a white bud in each ear */
function earbuds(): THREE.Object3D {
  // ear canals ≈ 5 cm above the head bone (≈ mouth height), level with its axis
  const geo = merged('earbuds', () => [-1, 1].flatMap((s) => [part(new THREE.CapsuleGeometry(0.0065, 0.008, 3, 8), '#f4f4f2', T(s * 0.074, 0.052, 0.004, 0, 0, Math.PI / 2)), part(new THREE.CapsuleGeometry(0.0028, 0.012, 2, 6), '#ececea', T(s * 0.071, 0.039, 0.009, 0.25, 0, 0))]));
  return framed(mesh(geo, mats().paint), TO_BONE);
}

/** over-ear headphones: a band over the crown, cups on the ears */
function headphones(): THREE.Object3D {
  const geo = merged('headphones', () => [part(new THREE.TorusGeometry(0.099, 0.0075, 6, 24, Math.PI), '#202226', T(0, 0.058, 0.002)), ...[-1, 1].map((s) => part(new THREE.CylinderGeometry(0.038, 0.038, 0.026, 18), '#25272b', T(s * 0.09, 0.052, 0.004, 0, 0, Math.PI / 2)))]);
  return framed(mesh(geo, mats().paint), TO_BONE);
}

/**
 * Where a surgical mask's fabric sits on a face: cm forward of the head bone (natural frame), on a
 * 1 cm grid. Rows go from y = 11 down to −3 (up), columns from x = −8 to 8 (the wearer's left).
 * Measured from the adult male Rocketbox heads by scripts/assets/mask-fit.mjs: their face envelope
 * plus 3.5 mm. Near the middle it's a taut string (tented over the nose, straight to the chin, clear
 * of the lips); toward the sides it lies on the cheeks. For reference, the nose tip is at about
 * (0, 8, 13.2), the lips at about (0, 2, 12.1), the chin at about (0, 0, 11.8).
 */
const MASK_DRAPE: number[][] = [
  [5.4, 7.3, 8.7, 9.4, 9.6, 9.8, 10.4, 11.9, 12.4, 11.9, 10.4, 9.8, 9.6, 9.4, 8.7, 7.3, 5.4], // y 11
  [5.6, 7.7, 9.3, 9.8, 10.0, 10.3, 11.3, 12.8, 13.2, 12.8, 11.3, 10.3, 10.0, 9.8, 9.3, 7.7, 5.5], // y 10
  [6.1, 7.9, 9.3, 9.9, 10.3, 11.0, 12.4, 13.5, 13.6, 13.5, 12.4, 11.0, 10.3, 9.9, 9.3, 7.9, 6.1], // y 9
  [5.3, 7.9, 9.3, 10.0, 10.6, 11.9, 12.6, 13.5, 13.6, 13.5, 12.6, 11.9, 10.6, 10.1, 9.3, 7.9, 5.2], // y 8
  [5.4, 7.6, 9.3, 10.1, 10.7, 11.6, 12.6, 13.4, 13.5, 13.4, 12.6, 11.6, 10.7, 10.2, 9.3, 7.6, 5.3], // y 7
  [5.3, 7.4, 9.4, 10.1, 10.8, 11.8, 12.7, 13.3, 13.5, 13.3, 12.7, 11.8, 10.8, 10.2, 9.4, 7.3, 5.3], // y 6
  [5.1, 6.7, 9.1, 10.1, 11.1, 11.8, 12.7, 13.2, 13.4, 13.2, 12.7, 11.8, 11.1, 10.1, 8.8, 6.7, 5.1], // y 5
  [4.6, 7.1, 8.4, 10.1, 11.1, 11.8, 12.6, 13.2, 13.4, 13.2, 12.6, 11.8, 11.1, 10.3, 8.4, 7.1, 4.5], // y 4
  [3.6, 6.8, 9.0, 10.0, 11.0, 11.8, 12.6, 13.1, 13.3, 13.1, 12.6, 11.7, 11.0, 10.0, 9.1, 6.8, 3.7], // y 3
  [2.2, 6.8, 8.6, 9.8, 11.0, 11.9, 12.6, 13.1, 13.2, 13.0, 12.5, 11.8, 11.0, 9.8, 8.5, 6.8, 2.3], // y 2
  [0.3, 3.5, 9.0, 9.6, 10.9, 11.9, 12.6, 13.0, 13.2, 13.0, 12.5, 11.8, 10.8, 9.6, 9.0, 3.5, 0.4], // y 1
  [-0.5, 1.6, 6.0, 9.0, 10.6, 11.6, 12.8, 12.9, 13.1, 12.9, 12.7, 11.5, 10.5, 9.0, 6.0, 1.9, -0.1], // y 0
  [-0.7, 1.1, 3.1, 5.9, 8.7, 10.7, 12.0, 12.3, 12.5, 12.1, 11.8, 10.5, 9.4, 6.0, 3.1, 1.1, -0.7], // y -1
  [-3.0, -1.3, 1.1, 3.3, 6.3, 7.9, 9.4, 10.2, 10.6, 10.1, 9.4, 7.9, 6.2, 4.7, 2.3, -0.1, -1.9], // y -2
  [-4.7, -3.0, -0.7, 2.9, 5.4, 6.6, 7.7, 8.5, 9.0, 8.5, 7.7, 6.6, 5.4, 3.5, 1.2, -1.2, -3.0], // y -3
];

/**
 * The same, measured on one face each (scripts/assets/mask-fit.mjs <id>), for masks worn close to the
 * camera: the player's own (hygiene.ts). The envelope of six men above stands off a single face by up
 * to a centimetre, and a woman's face is smaller still: her nose tip about 1.2 cm and her chin 2–3 cm
 * nearer the head bone than the men's envelope.
 */
const MASK_FITS: Record<string, number[][]> = {
  male: MASK_DRAPE,
  Medical_Male_01: [
    [4.6, 5.5, 8.2, 9.2, 9.5, 9.7, 10.1, 11.3, 11.8, 11.3, 10.0, 9.7, 9.5, 9.2, 8.2, 5.5, 3.2], // y 11
    [3.6, 6.9, 8.7, 9.5, 9.8, 10.0, 10.7, 12.1, 12.6, 12.1, 10.6, 10.0, 9.8, 9.5, 8.7, 6.9, 3.4], // y 10
    [4.1, 6.7, 9.0, 9.7, 10.1, 10.4, 11.5, 13.0, 13.3, 13.0, 11.4, 10.4, 10.1, 9.7, 9.0, 6.7, 4.0], // y 9
    [4.2, 7.2, 8.8, 9.7, 10.5, 10.8, 12.1, 13.2, 13.4, 13.2, 12.1, 10.8, 10.5, 9.7, 8.8, 7.2, 4.2], // y 8
    [4.0, 6.7, 8.4, 9.6, 10.4, 10.9, 12.1, 13.2, 13.4, 13.2, 12.1, 11.0, 10.4, 9.6, 8.4, 6.7, 3.9], // y 7
    [3.5, 5.4, 8.9, 9.3, 10.4, 11.2, 12.2, 13.0, 13.2, 13.0, 12.2, 11.2, 10.4, 9.3, 8.9, 5.4, 3.5], // y 6
    [3.3, 5.6, 7.1, 9.8, 10.7, 11.4, 12.2, 12.9, 13.1, 12.9, 12.2, 11.4, 10.7, 9.8, 7.1, 5.6, 3.3], // y 5
    [2.9, 5.6, 7.5, 8.9, 10.7, 11.4, 12.2, 12.8, 13.0, 12.8, 12.2, 11.4, 10.8, 9.1, 7.5, 5.6, 2.9], // y 4
    [2.5, 4.8, 7.8, 9.3, 10.5, 11.4, 12.2, 12.7, 12.9, 12.7, 12.1, 11.4, 10.5, 9.3, 7.8, 4.8, 2.5], // y 3
    [1.7, 4.1, 7.2, 9.5, 10.7, 11.7, 12.2, 12.6, 12.8, 12.6, 12.2, 11.7, 10.7, 9.5, 7.2, 4.0, 1.7], // y 2
    [-0.7, 1.6, 6.3, 8.9, 10.2, 11.7, 12.2, 12.5, 12.7, 12.5, 12.2, 11.7, 10.2, 8.9, 6.1, 1.6, -0.7], // y 1
    [-0.7, 1.1, 4.0, 7.3, 9.4, 11.3, 12.2, 12.4, 12.5, 12.3, 12.2, 11.1, 9.4, 7.3, 4.1, 1.1, -0.7], // y 0
    [-0.3, 1.5, 3.0, 4.1, 7.3, 10.1, 10.7, 11.4, 11.7, 11.4, 10.7, 10.0, 7.3, 4.5, 3.1, 1.5, -0.3], // y -1
    [-2.0, -0.3, 1.8, 0.7, 1.6, 7.1, 8.3, 9.2, 9.5, 9.2, 8.2, 7.1, 4.8, 2.4, 0.8, -1.3, -3.2], // y -2
    [-3.7, -2.1, -0.3, -1.1, -1.2, 5.3, 6.2, 7.2, 7.6, 7.1, 5.6, 3.9, 1.4, -1.0, -3.5, -5.9, -7.6], // y -3
  ],
  Medical_Female_02: [
    [1.9, 4.5, 7.5, 8.9, 9.2, 9.4, 9.5, 9.9, 10.2, 9.9, 9.5, 9.4, 9.2, 8.9, 7.5, 3.9, 1.6], // y 11
    [1.8, 4.5, 7.5, 8.8, 9.3, 9.5, 9.9, 10.5, 10.9, 10.5, 9.9, 9.5, 9.3, 8.8, 7.4, 4.3, 1.4], // y 10
    [1.7, 5.7, 8.1, 8.8, 9.3, 9.7, 10.3, 11.4, 11.9, 11.4, 10.3, 9.7, 9.3, 8.8, 8.1, 4.5, 1.2], // y 9
    [1.5, 4.9, 8.0, 8.9, 9.4, 9.8, 10.8, 12.1, 12.3, 12.1, 10.8, 9.8, 9.4, 8.9, 8.0, 3.6, 0.8], // y 8
    [1.4, 4.6, 8.0, 8.8, 9.3, 10.0, 11.1, 12.1, 12.3, 12.1, 11.1, 10.0, 9.3, 8.8, 8.0, 3.5, 0.7], // y 7
    [1.4, 3.8, 6.8, 8.4, 9.5, 10.2, 11.1, 11.9, 12.2, 11.9, 11.1, 10.2, 9.5, 8.4, 6.8, 3.0, 0.9], // y 6
    [1.1, 3.0, 5.8, 8.3, 9.4, 10.3, 11.1, 11.8, 12.0, 11.8, 11.1, 10.3, 9.4, 8.3, 5.7, 2.3, 0.5], // y 5
    [0.0, 2.2, 5.3, 7.0, 9.2, 10.2, 11.0, 11.6, 11.8, 11.6, 11.0, 10.2, 9.2, 7.0, 5.3, 1.6, -0.3], // y 4
    [-0.1, 2.0, 4.6, 7.3, 8.8, 10.1, 10.8, 11.4, 11.6, 11.4, 10.8, 10.1, 8.8, 7.3, 4.3, 1.8, -0.1], // y 3
    [-0.5, 1.6, 4.0, 6.2, 8.2, 9.9, 10.7, 11.2, 11.4, 11.2, 10.7, 9.9, 8.3, 6.2, 3.9, 1.5, -0.5], // y 2
    [-2.1, -0.1, 2.3, 5.1, 7.5, 9.4, 10.6, 11.0, 11.2, 11.1, 10.6, 9.4, 7.4, 5.1, 2.3, -0.1, -2.1], // y 1
    [-3.9, -2.0, 0.4, 3.0, 6.1, 8.0, 9.6, 10.8, 11.0, 10.8, 9.6, 7.8, 6.1, 3.0, 0.4, -2.0, -3.9], // y 0
    [-4.3, -2.6, -0.2, 2.2, 3.0, 4.9, 7.1, 8.3, 8.7, 8.4, 7.1, 5.1, 3.0, 2.2, 0.4, -2.0, -4.0], // y -1
    [-5.6, -3.8, -1.4, 1.0, 1.6, 0.5, 2.7, 5.5, 5.9, 5.6, 4.2, 1.9, 1.6, 1.6, -0.8, -3.2, -5.0], // y -2
    [-7.3, -5.5, -3.1, -0.8, -0.4, -2.2, -1.7, 3.5, 3.9, 3.6, 2.2, -0.2, -0.5, -0.5, -2.6, -5.0, -6.7], // y -3
  ],
};

/** the drape table for a face (its avatar id), the men's envelope when there's none of its own */
export function maskFitFor(face: string): string {
  return MASK_FITS[face] ? face : 'male';
}

/** Catmull-Rom sample of a drape table at (x, y) cm, clamped to the grid */
function drapeAtIn(x: number, y: number, table: number[][] = MASK_DRAPE): number {
  const gx = Math.min(16, Math.max(0, x + 8));
  const gy = Math.min(14, Math.max(0, 11 - y));
  const ix = Math.min(15, Math.floor(gx)), iy = Math.min(13, Math.floor(gy));
  const fx = gx - ix, fy = gy - iy;
  const v = (i: number, j: number) => table[Math.min(14, Math.max(0, j))][Math.min(16, Math.max(0, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (j: number) => cr(v(ix - 1, j), v(ix, j), v(ix + 1, j), v(ix + 2, j), fx);
  return cr(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), fy);
}

/**
 * A blue three-ply surgical mask fitted to the face (MASK_DRAPE). It runs from the nose bridge
 * (nose-wire binding along the top) to under the chin, and from cheek to cheek. Three pleats are
 * opened over the mouth. It's light blue outside and white inside, with elastic loops behind the
 * ears. Built in cm in the natural frame, then scaled to metres.
 */
function mask(fit = 'male'): THREE.Object3D {
  const table = MASK_FITS[fit] ?? MASK_DRAPE;
  // a woman's head is narrower and her ears a little lower: the loops follow (the men's: as measured)
  const ear = fit.includes('Female') ? { sx: 0.92, sy: 0.95 } : { sx: 1, sy: 1 };
  const drapeAt = (x: number, y: number) => drapeAtIn(x, y, table);
  const geo = merged(fit === 'male' ? 'mask' : `mask:${fit}`, () => {
    const S = 34, Tn = 26;
    // outline: top edge over the nose bridge to the cheekbones, bottom edge under the chin
    const half = (t: number) => 6.4 + 0.6 * t; // half-width: jaw corner 6.4 → cheekbone corner 7.0
    const yTop = (x: number) => 10.0 - 3.0 * Math.pow(Math.min(1, Math.abs(x) / 7.0), 1.35);
    const yBot = (x: number) => -2.0 + 2.6 * Math.pow(Math.min(1, Math.abs(x) / 6.4), 1.7);
    const PLEATS = [0.35, 0.52, 0.69];
    const outer = new THREE.Color('#8cc0e3'), seam = new THREE.Color('#77abd2'), wire = new THREE.Color('#b5d6ee'), inner = new THREE.Color('#f1f3f2');
    const layer = (inside: boolean) => {
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      for (let j = 0; j <= Tn; j++) {
        const t = j / Tn;
        for (let i = 0; i <= S; i++) {
          const s = (i / S) * 2 - 1;
          const x = s * half(t);
          const y = yBot(x) + t * (yTop(x) - yBot(x));
          let z = drapeAt(x, y);
          // the pleats open over the mouth: a soft outward bulge, strongest mid-mask
          z += 0.35 * Math.pow(1 - s * s, 1.5) * Math.pow(Math.sin(Math.PI * t), 1.2);
          // each pleat is a small fold: a ridge, and a shaded crease just below it
          let shade = 1;
          const fade = 1 - Math.pow(Math.abs(s), 6);
          for (const c of PLEATS) {
            z += 0.09 * fade * Math.exp(-(((t - c) / 0.03) ** 2));
            shade -= 0.2 * fade * Math.exp(-(((t - c + 0.035) / 0.018) ** 2));
          }
          if (inside) z -= 0.07; // the inner ply
          pos.push(x * 0.01, y * 0.01, z * 0.01);
          const base = inside ? inner : t > 0.93 ? wire : Math.abs(s) > 0.94 || t < 0.05 ? seam : outer;
          const k = inside ? 1 : shade;
          col.push(base.r * k, base.g * k, base.b * k);
        }
      }
      for (let j = 0; j < Tn; j++)
        for (let i = 0; i < S; i++) {
          const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
          // x = wearer's left, y = up, z = forward is right-handed, so (a, b, c) faces +z: the outer
          // ply faces out of the face, the inner ply (reversed) faces the skin
          if (inside) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g.toNonIndexed();
    };
    // elastic ear loops: from each corner, over the top of the ear, round its back, under the lobe
    const loops = [-1, 1].map((sx) => {
      const top = [sx * 7.0, 7.0, drapeAt(sx * 7.0, 7.0) - 0.1];
      const bot = [sx * 6.4, 0.6, drapeAt(sx * 6.4, 0.6) - 0.1];
      const behind = [[sx * 7.9, 8.7, 2.6], [sx * 8.2, 7.6, -0.8], [sx * 8.0, 4.8, -2.1], [sx * 7.7, 2.3, -0.9]].map(([x, y, z]) => [x * ear.sx, y * ear.sy, z]);
      const pts = [top, ...behind, bot].map(([x, y, z]) => [x * 0.01, y * 0.01, z * 0.01] as [number, number, number]);
      return part(rod(pts, 0.0011, 28), '#f3f3f0');
    });
    // geometry carries its own vertex colours; part() would repaint it, so keep only position/normal/color
    return [layer(false), layer(true), ...loops];
  });
  const m = mesh(geo, maskMat());
  return framed(m, TO_BONE);
}

let maskM: THREE.MeshStandardMaterial | null = null;
function maskMat() {
  // non-woven polypropylene: matte. Both plies are single-sided (each faces out of its own side).
  return (maskM ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.FrontSide }));
}

/** a blue gel pack wrapped round the wrist with a crepe bandage (forearm bone: X toward the wrist) */
function icepack(): THREE.Object3D {
  const geo = merged('icepack', () => [part(new THREE.CylinderGeometry(0.047, 0.045, 0.085, 16), '#3f7fcf', T(0.22, 0, 0, 0, 0, Math.PI / 2)), part(new THREE.CylinderGeometry(0.049, 0.049, 0.03, 16), '#e9e2cf', T(0.235, 0, 0, 0, 0, Math.PI / 2))]);
  return mesh(geo, mats().paint);
}

/** gauze round the palm: wide across it, thin through it (hand bone: X fingers, Y palm, Z thumb) */
function bandage(): THREE.Object3D {
  const geo = merged('bandage', () => {
    const g = new THREE.CylinderGeometry(1, 1, 0.1, 16);
    g.scale(0.03, 1, 0.054);
    return [part(g, '#f3f0e8', T(0.06, 0.004, 0.004, 0, 0, Math.PI / 2))];
  });
  return mesh(geo, mats().paint);
}

/** a hand towel round the forearm, a little blood seeping through */
function towel(): THREE.Object3D {
  const geo = merged('towel', () => {
    const stain = new THREE.SphereGeometry(0.02, 8, 6);
    stain.scale(1.7, 0.4, 1.2);
    return [part(new THREE.CylinderGeometry(0.054, 0.058, 0.15, 14), '#ecebe5', T(0.15, 0, 0, 0, 0, Math.PI / 2)), part(stain, '#8e2a2a', T(0.16, 0.05, 0.02))];
  });
  return mesh(geo, mats().paint);
}

/** a drink can in the grip, its axis toward the thumb */
function can(): THREE.Object3D {
  const geo = merged('can', () => [part(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 16), '#b8312a', T(0.075, 0.045, 0, Math.PI / 2, 0, 0)), part(new THREE.CylinderGeometry(0.03, 0.033, 0.006, 16), '#c9ccd0', T(0.075, 0.045, 0.063, Math.PI / 2, 0, 0))]);
  return mesh(geo, mats().paint);
}

/** a clipboard with the triage list, its edge in the hand */
function clipboard(): THREE.Object3D {
  const geo = merged('clipboard', () => [part(new THREE.BoxGeometry(0.23, 0.31, 0.005), '#7b5a3a'), part(new THREE.BoxGeometry(0.21, 0.28, 0.002), '#f5f4ef', T(0, -0.01, 0.004)), part(new THREE.BoxGeometry(0.08, 0.03, 0.008), '#b9bec3', T(0, 0.14, 0.006))]);
  const g = mesh(geo, mats().paint);
  g.position.set(-0.02, 0.09, 0.03);
  g.rotation.set(-0.2, 0, 0.1);
  return framed(g, TO_LEFT_HAND);
}

// ───────────────────────────── on the floor (the character's root, metres, +z = facing) ─────────────────────────────

/** a front-wheeled walker, tennis balls on the back legs (it glides; everyone's grandad has them) */
/** the rollator's push grips (its frame: x across, z ahead): crowd.ts puts the hands here */
export const WALKER_GRIPS = { x: 0.27, y: 0.875, z: -0.02 };
/** its front wheels: radius (m) and where their axles are */
export const WALKER_WHEEL = { r: 0.05, x: 0.27, y: 0.05, z: 0.22 };

function walker(): THREE.Object3D {
  const geo = merged('walker', () => {
    const out: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const x = s * 0.27;
      out.push(part(rod([[x, 0.05, 0.21], [x, 0.84, 0.18], [x, 0.87, 0.1], [x, 0.87, -0.12], [x, 0.84, -0.18], [x, 0.04, -0.22]], 0.012, 24), '#b9c0c6'));
      out.push(part(new THREE.CylinderGeometry(0.019, 0.019, 0.16, 10), '#5b6168', T(x, 0.875, -0.02, Math.PI / 2, 0, 0)));
      out.push(part(new THREE.SphereGeometry(0.032, 10, 8), '#d9df3a', T(x, 0.032, -0.22)));
    }
    out.push(part(rod([[-0.27, 0.68, 0.19], [0.27, 0.68, 0.19]], 0.011, 4), '#b9c0c6'));
    out.push(part(rod([[-0.27, 0.3, 0.2], [0.27, 0.3, 0.2]], 0.009, 4), '#b9c0c6'));
    return out;
  });
  const g = new THREE.Group();
  g.add(mesh(geo, mats().paint));
  // the front wheels roll (crowd.ts turns them by the distance walked): a tyre with a hub mark to see it turn
  const wheel = merged('walkerWheel', () => [
    part(new THREE.CylinderGeometry(WALKER_WHEEL.r, WALKER_WHEEL.r, 0.028, 14), '#2a2d31', T(0, 0, 0, 0, 0, Math.PI / 2)),
    part(new THREE.BoxGeometry(0.03, 0.06, 0.012), '#8a9096', T(0, 0, 0, 0, 0, 0)),
  ]);
  for (const s of [-1, 1]) {
    const w = mesh(wheel, mats().paint);
    w.name = 'wheel';
    w.position.set(s * WALKER_WHEEL.x, WALKER_WHEEL.y, WALKER_WHEEL.z);
    g.add(w);
  }
  return g;
}

/** a soft-sided pet carrier, mesh windows at the ends, a small dog inside you can't quite see */
function carrier(): THREE.Object3D {
  const geo = merged('carrier', () => {
    // heather-grey fabric with black mesh windows at both ends and down the side
    const out = [part(new RoundedBoxGeometry(0.46, 0.27, 0.27, 3, 0.04), '#6d7178', T(0, 0.135, 0))];
    for (const s of [-1, 1]) out.push(part(new THREE.BoxGeometry(0.004, 0.17, 0.19), '#121417', T(s * 0.231, 0.15, 0)));
    for (const s of [-1, 1]) out.push(part(new THREE.BoxGeometry(0.3, 0.14, 0.004), '#16181c', T(0, 0.155, s * 0.137)));
    out.push(part(new THREE.BoxGeometry(0.47, 0.03, 0.28), '#3a3d42', T(0, 0.015, 0)));
    out.push(part(new THREE.TorusGeometry(0.075, 0.009, 6, 16, Math.PI), '#1d232e', T(0, 0.27, 0.05)));
    out.push(part(new THREE.TorusGeometry(0.075, 0.009, 6, 16, Math.PI), '#1d232e', T(0, 0.27, -0.05)));
    return out;
  });
  return mesh(geo, mats().paint);
}

/** a standard manual wheelchair (origin under the seat on the floor; push handles behind, −z) */
function wheelchair(): THREE.Object3D {
  const geo = merged('wheelchair', () => {
    const out: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      out.push(part(new THREE.TorusGeometry(0.3, 0.018, 8, 32), '#1d1f22', T(s * 0.3, 0.31, -0.08, 0, Math.PI / 2, 0)));
      out.push(part(new THREE.TorusGeometry(0.26, 0.007, 5, 28), '#c9ced3', T(s * 0.325, 0.31, -0.08, 0, Math.PI / 2, 0)));
      out.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), '#8d949b', T(s * 0.29, 0.31, -0.08, 0, 0, Math.PI / 2)));
      out.push(part(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 14), '#1d1f22', T(s * 0.21, 0.055, 0.33, 0, 0, Math.PI / 2)));
      out.push(part(rod([[s * 0.22, 0.12, 0.33], [s * 0.24, 0.47, 0.3], [s * 0.24, 0.48, -0.18], [s * 0.24, 0.92, -0.25], [s * 0.22, 0.96, -0.35]], 0.012, 24), '#b4bbc2'));
      out.push(part(rod([[s * 0.24, 0.47, 0.28], [s * 0.15, 0.12, 0.42]], 0.01, 6), '#b4bbc2'));
      out.push(part(new THREE.BoxGeometry(0.15, 0.014, 0.12), '#2a2e33', T(s * 0.12, 0.11, 0.43)));
      out.push(part(new THREE.BoxGeometry(0.05, 0.03, 0.34), '#23272c', T(s * 0.25, 0.7, 0.03)));
      out.push(part(new THREE.CylinderGeometry(0.017, 0.017, 0.09, 10), '#16181b', T(s * 0.22, 0.965, -0.37, Math.PI / 2, 0, 0)));
    }
    out.push(part(new THREE.BoxGeometry(0.44, 0.035, 0.42), '#20252c', T(0, 0.48, 0.05)));
    out.push(part(new THREE.BoxGeometry(0.42, 0.4, 0.025), '#20252c', T(0, 0.72, -0.22, -0.08, 0, 0)));
    return out;
  });
  return mesh(geo, mats().paint);
}

// ───────────────────────────── the catalogue ─────────────────────────────

export const MOUNTS: Record<AmbientProp, Mount> = {
  phone: 'handR',
  earbuds: 'head',
  headphones: 'head',
  mask: 'head',
  icepack: 'forearmL',
  bandage: 'handL',
  sling: 'forearmL',
  walker: 'root',
  carrier: 'root',
  can: 'handR',
  clipboard: 'handL',
  towel: 'forearmL',
  wheelchair: 'root',
  // reading.ts: posed in front of the body (or on the lap / at the side) by crowd.ts
  newspaper: 'root',
  laptop: 'root',
};

/** a fresh instance of a prop (geometry and materials shared with every other wearer) */
export function buildProp(kind: AmbientProp, opts: { mount?: Mount; fit?: string } = {}): PropMesh | null {
  const mount = opts.mount ?? MOUNTS[kind];
  let obj: THREE.Object3D;
  switch (kind) {
    case 'phone':
      obj = phone(mount === 'handL');
      break;
    case 'earbuds':
      obj = earbuds();
      break;
    case 'headphones':
      obj = headphones();
      break;
    case 'mask':
      // (opts.fit: a face's own drape table, maskFitFor; the crowd wears the men's envelope)
      obj = mask(opts.fit);
      break;
    case 'icepack':
    case 'sling':
      obj = icepack();
      break;
    case 'bandage':
      obj = bandage();
      break;
    case 'towel':
      obj = towel();
      break;
    case 'can':
      obj = can();
      break;
    case 'clipboard':
      obj = clipboard();
      break;
    case 'walker':
      obj = walker();
      break;
    case 'carrier':
      obj = carrier();
      break;
    case 'wheelchair':
      obj = wheelchair();
      break;
    case 'newspaper':
      obj = buildNewspaper();
      break;
    case 'laptop':
      obj = buildLaptop();
      break;
    default:
      return null;
  }
  obj.name = `prop:${kind}`;
  obj.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return { kind, obj, mount };
}

/** release the shared prop geometry/materials (World.dispose; geometry is also tracked by materials.ts) */
export function disposeProps() {
  cache.clear();
  shared?.paint.dispose();
  shared?.screen.dispose();
  atlasTex?.dispose();
  maskM?.dispose();
  shared = null;
  atlasTex = null;
  maskM = null;
  disposeReading();
}

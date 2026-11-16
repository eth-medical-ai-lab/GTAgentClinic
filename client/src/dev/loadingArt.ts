/**
 * Loading-screen comic panels, rendered from the game's own Rocketbox avatars (avatars.ts) and
 * procedural props (props.ts, vehicles.ts) with an offline ink look:
 *
 *   1. lit pass      the scene with hard key, rim and fill lights (+ shadow maps), linear HDR
 *   2. g-buffer pass view normal, view depth and a material class per pixel (skin, hair, body…)
 *   3. ink pass      outer contours from depth jumps (thick), creases and class borders from the
 *                    g-buffer (thin), the lit luminance posterized into black / halftone / white
 *   4. downsample    supersampled 2×, box-filtered to the output size
 *
 * Dev page only (client/src/dev/loading-art.html). scripts/assets/render-loading-art.mjs drives it
 * in headless Chromium and writes client/public/res/loading/*.webp.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AvatarCharacter } from '../world/avatars';
import type { AvatarCast } from '../world/casting';
import { buildProp as buildEquipment } from '../world/props';
import { buildAmbulance } from '../world/vehicles';
import { pbr } from '../world/materials';

// ───────────────────────────── ink renderer ─────────────────────────────

/** material classes in the g-buffer (blue channel) */
const CLS = { bg: 0, skin: 0.2, hair: 0.4, body: 0.6, prop: 0.8, set: 1 } as const;

const GBUF_VS = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vN;
varying float vZ;
void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = normalize(transformedNormal);
  vZ = -mvPosition.z;
}`;

const GBUF_FS = /* glsl */ `
#include <common>
#include <uv_pars_fragment>
#include <color_pars_fragment>
#include <map_pars_fragment>
#include <alphatest_pars_fragment>
uniform float uClass;
uniform vec3 uDiffuse;
uniform int uMode;
varying vec3 vN;
varying float vZ;
void main() {
  vec4 diffuseColor = vec4(uDiffuse, 1.0);
  #include <map_fragment>
  #include <color_fragment>
  #include <alphatest_fragment>
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  // mode 0: view normal, class, view depth; mode 1: unlit albedo (local colour, for spotting blacks)
  gl_FragColor = uMode == 1 ? vec4(diffuseColor.rgb, 1.0) : vec4(n.xy, uClass, vZ);
}`;

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const INK_FS = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tG;
uniform sampler2D tAlb;
uniform float spotT;
uniform vec2 res;
uniform float px;
uniform float exposure;
uniform float gamma;
uniform float lineOuter;
uniform float lineInner;
uniform float crease;
uniform float cell;
uniform float loT;
uniform float hiT;
uniform float skinLo;
uniform float hairExp;
uniform float hairMax;
uniform int bgMode;
uniform vec2 bgCenter;
uniform float bgRays;
uniform float bgTone;
uniform float paper;
uniform float inkTone;
uniform int debug;
varying vec2 vUv;

float lum(vec2 uv) { return dot(texture2D(tColor, uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }

/** cosine spot halftone, 45° screen: 1 = ink */
float halftone(vec2 fc, float darkness, float cellPx) {
  float a = 0.7853982;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * fc / cellPx;
  float s = 0.5 * (cos(6.2831853 * p.x) + cos(6.2831853 * p.y));
  float thr = 1.0 - 2.0 * clamp(darkness, 0.0, 1.0);
  float w = max(fwidth(s) * 0.8, 1e-4);
  return smoothstep(thr - w, thr + w, s);
}

vec3 nrm(vec4 g) { return vec3(g.xy, sqrt(max(0.0, 1.0 - dot(g.xy, g.xy)))); }

float background(vec2 fc) {
  vec2 uv = fc / res;
  if (bgMode == 1) {
    // sunburst: rays from bgCenter, alternating halftone and black, darker toward the edges
    vec2 d = (uv - bgCenter) * vec2(res.x / res.y, 1.0);
    float ang = atan(d.y, d.x);
    float ray = step(0.5, fract(ang / 6.2831853 * bgRays));
    float fall = smoothstep(0.15, 1.1, length(d));
    float dark = mix(bgTone, 1.0, fall);
    return ray > 0.5 ? 1.0 : halftone(fc, dark, cell * px);
  }
  if (bgMode == 2) {
    // night gradient: black at the top, halftone toward a lighter horizon
    float dark = mix(bgTone, 1.0, smoothstep(0.25, 0.95, uv.y));
    return halftone(fc, dark, cell * px);
  }
  return bgTone;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec4 g = texture2D(tG, vUv);
  float z = g.a;
  bool bg = z <= 0.0;
  vec2 e = 1.0 / res;

  // local depth slope (the smaller one-sided difference, so a slope never spans an edge)
  vec2 grad = vec2(0.0);
  if (!bg) {
    float zr = texture2D(tG, vUv + vec2(e.x, 0.0)).a, zl = texture2D(tG, vUv - vec2(e.x, 0.0)).a;
    float zu = texture2D(tG, vUv + vec2(0.0, e.y)).a, zd = texture2D(tG, vUv - vec2(0.0, e.y)).a;
    float gx1 = zr - z, gx2 = z - zl, gy1 = zu - z, gy2 = z - zd;
    grad.x = (zr <= 0.0 || zl <= 0.0) ? 0.0 : (abs(gx1) < abs(gx2) ? gx1 : gx2);
    grad.y = (zu <= 0.0 || zd <= 0.0) ? 0.0 : (abs(gy1) < abs(gy2) ? gy1 : gy2);
  }

  float R = lineOuter * px;
  float r = lineInner * px;
  float outer = 0.0;
  float inner = 0.0;
  vec3 n0 = nrm(g);
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3926991 + 0.19;
    vec2 dir = vec2(cos(a), sin(a));
    for (int k = 1; k <= 3; k++) {
      vec2 o = dir * R * float(k) / 3.0;
      vec4 gn = texture2D(tG, vUv + o * e);
      if (gn.a <= 0.0) continue;
      if (bg) { outer = 1.0; continue; }
      float zp = z + dot(grad, o);
      float thr = 0.025 + 0.025 * z;
      if (gn.a < min(zp, z) - thr) outer = 1.0;
    }
    if (bg) continue;
    vec2 o2 = dir * r;
    vec4 gm = texture2D(tG, vUv + o2 * e);
    if (gm.a <= 0.0) continue;
    float near = abs(gm.a - (z + dot(grad, o2))) < 0.05 + 0.03 * z ? 1.0 : 0.0;
    if (near > 0.5 && dot(n0, nrm(gm)) < crease) inner = 1.0;
    if (abs(gm.b - g.b) > 0.05 && gm.a < z + 0.02) inner = 1.0;
  }

  float ink;
  if (bg) {
    ink = background(fc);
  } else {
    float isHair = abs(g.b - ${CLS.hair.toFixed(2)}) < 0.05 ? 1.0 : 0.0;
    float L = lum(vUv) * exposure * mix(1.0, hairExp, isHair);
    float t = pow(1.0 - exp(-L), gamma);
    t = mix(t, min(t, hairMax), isHair); // hair never goes paper-white: at most a halftone sheen
    // spotting blacks: dark local colour (hair, brows, dark cloth) is solid ink, with at most a
    // halftone sheen where it is strongly lit
    float alb = dot(texture2D(tAlb, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    float spot = 1.0 - smoothstep(spotT * 0.55, spotT, alb);
    t = mix(t, min(t, 0.32), spot);
    float isSkin = abs(g.b - ${CLS.skin.toFixed(2)}) < 0.05 ? 1.0 : 0.0;
    float lo = mix(loT, skinLo, isSkin);
    float black = smoothstep(lo + 0.015, lo - 0.015, t);
    float white = smoothstep(hiT - 0.015, hiT + 0.015, t);
    float mid = clamp((t - lo) / max(0.01, hiT - lo), 0.0, 1.0);
    float h = halftone(fc, mix(0.7, 0.1, mid), cell * px);
    ink = mix(mix(h, 1.0, black), 0.0, white);
  }
  ink = max(ink, max(outer, inner));
  float v = mix(paper, inkTone, ink);
  gl_FragColor = vec4(vec3(v), 1.0);
  if (debug == 1) gl_FragColor = vec4(vec3(g.b), 1.0); // material class
  if (debug == 2) gl_FragColor = vec4(vec3(1.0 - exp(-lum(vUv) * exposure)), 1.0); // lit tone
}`;

const DOWN_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 srcRes;
uniform int ss;
uniform float levels;
uniform float lo;
uniform float hi;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * float(ss);
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    if (x >= ss || y >= ss) continue;
    acc += texture2D(tSrc, (base + vec2(float(x), float(y)) + 0.5) / srcRes).rgb;
  }
  // a few grey levels between ink and paper: anti-aliased edges, and a palette that lossless WebP
  // stores in ~100 KB per panel (continuous greys cost 3-5x more, lossy WebP smears the dots)
  float v = clamp((acc.r / float(ss * ss) - lo) / (hi - lo), 0.0, 1.0);
  v = floor(v * (levels - 1.0) + 0.5) / (levels - 1.0);
  gl_FragColor = vec4(vec3(mix(lo, hi, v)), 1.0);
}`;

export interface InkStyle {
  exposure: number;
  gamma: number;
  /** outer contour radius and crease line radius, in px at 1920 wide */
  lineOuter: number;
  lineInner: number;
  /** crease when neighbouring normals' cosine drops below this */
  crease: number;
  /** halftone cell, px at 1920 wide */
  cell: number;
  /** tone thresholds: below loT solid black, above hiT white, halftone between */
  loT: number;
  hiT: number;
  /** skin's black threshold (faces keep cleaner) */
  skinLo: number;
  /** exposure multiplier for hair (comic hair: mostly solid black with highlights) */
  hairExp: number;
  /** brightest tone hair may reach (rim-lit hair otherwise reads as a bald scalp) */
  hairMax: number;
  /** albedo luminance (linear) below which a surface is spotted black */
  spotT: number;
  /** 0 flat bgTone, 1 sunburst, 2 night gradient */
  bgMode: number;
  bgCenter: [number, number];
  bgRays: number;
  /** flat background ink (0 white … 1 black), or the rays'/gradient's lightest darkness */
  bgTone: number;
  paper: number;
  inkTone: number;
  /** 0 ink, 1 the g-buffer's material class, 2 the lit tone (tuning) */
  debug: number;
}

export const DEFAULT_STYLE: InkStyle = {
  exposure: 1.6,
  gamma: 1.0,
  lineOuter: 4.2,
  lineInner: 1.5,
  crease: 0.6,
  cell: 7,
  loT: 0.2,
  hiT: 0.62,
  skinLo: 0.12,
  hairExp: 0.32,
  hairMax: 0.36,
  spotT: 0.05,
  bgMode: 0,
  bgCenter: [0.5, 0.5],
  bgRays: 28,
  bgTone: 1,
  paper: 0.96,
  inkTone: 0.04,
  debug: 0,
};

class Ink {
  readonly renderer: THREE.WebGLRenderer;
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private gbufMats = new Map<THREE.Material, THREE.ShaderMaterial>();
  // uniform objects stay the same across renders (three caches them per program); only values change
  private inkMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: INK_FS,
    uniforms: {
      tColor: { value: null },
      tG: { value: null },
      tAlb: { value: null },
      res: { value: new THREE.Vector2() },
      px: { value: 1 },
      bgCenter: { value: new THREE.Vector2(0.5, 0.5) },
      ...Object.fromEntries(Object.entries(DEFAULT_STYLE).filter(([k]) => k !== 'bgCenter').map(([k, v]) => [k, { value: v }])),
    },
  });
  private downMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS,
    fragmentShader: DOWN_FS,
    uniforms: { tSrc: { value: null }, srcRes: { value: new THREE.Vector2() }, ss: { value: 2 }, levels: { value: 8 }, lo: { value: 0 }, hi: { value: 1 } },
  });

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private gbufFor(src: THREE.Material, cls: number): THREE.ShaderMaterial {
    let m = this.gbufMats.get(src);
    if (!m) {
      const s = src as THREE.MeshStandardMaterial;
      const map = s.map ?? null;
      const cut = s.alphaTest > 0 || s.transparent ? s.alphaTest || 0.5 : 0;
      m = new THREE.ShaderMaterial({
        vertexShader: GBUF_VS,
        fragmentShader: GBUF_FS,
        side: s.side,
        vertexColors: !!s.vertexColors,
        uniforms: {
          uClass: { value: cls },
          uMode: { value: 0 },
          uDiffuse: { value: (s.color ?? new THREE.Color(1, 1, 1)).clone() },
          map: { value: map },
          mapTransform: { value: map ? map.matrix : new THREE.Matrix3() },
          alphaTest: { value: cut },
        },
      });
      if (map) Object.assign(m, { map });
      m.alphaTest = cut;
      this.gbufMats.set(src, m);
    }
    return m;
  }

  /** renders `scene` through the ink pipeline into the canvas (w × h) */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, style: InkStyle, ss = 2) {
    const r = this.renderer;
    r.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const W = w * ss;
    const H = h * ss;
    const color = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    const gbuf = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const inked = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const albedo = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

    // 1. lit pass
    const bg = scene.background;
    scene.background = null;
    r.setRenderTarget(color);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);

    // 2. g-buffer pass
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const shadowOff: THREE.Light[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Light).isLight && (o as THREE.Light).castShadow) shadowOff.push(o as THREE.Light);
      if (!m.isMesh || !m.visible) return;
      const cls = (m.userData.inkClass as number | undefined) ?? CLS.set;
      swapped.push([m, m.material]);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((mm) => {
        const own = (mm.userData.inkClass as number | undefined) ?? (/^(head)$/.test(mm.name) ? CLS.skin : /^hair$/.test(mm.name) ? CLS.hair : /^body$/.test(mm.name) ? CLS.body : cls);
        return this.gbufFor(mm, own);
      });
      m.material = Array.isArray(m.material) ? out : out[0];
    });
    for (const l of shadowOff) l.castShadow = false;
    r.setRenderTarget(gbuf);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    // 2b. albedo pass (same materials, unlit local colour)
    for (const gm of this.gbufMats.values()) gm.uniforms.uMode.value = 1;
    r.setRenderTarget(albedo);
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(scene, camera);
    for (const gm of this.gbufMats.values()) gm.uniforms.uMode.value = 0;
    for (const [m, mat] of swapped) m.material = mat;
    for (const l of shadowOff) l.castShadow = true;
    scene.background = bg;

    // 3. ink pass
    const u = this.inkMat.uniforms;
    u.tColor.value = color.texture;
    u.tG.value = gbuf.texture;
    u.tAlb.value = albedo.texture;
    u.res.value.set(W, H);
    u.px.value = (ss * w) / 1920;
    for (const k of Object.keys(style) as (keyof InkStyle)[]) {
      if (k === 'bgCenter') u.bgCenter.value.set(...style.bgCenter);
      else u[k].value = style[k];
    }
    this.quad.material = this.inkMat;
    r.setRenderTarget(inked);
    r.render(this.quadScene, this.quadCam);

    // 4. downsample to the canvas
    this.downMat.uniforms.tSrc.value = inked.texture;
    this.downMat.uniforms.srcRes.value.set(W, H);
    this.downMat.uniforms.ss.value = ss;
    this.downMat.uniforms.lo.value = style.inkTone;
    this.downMat.uniforms.hi.value = style.paper;
    this.quad.material = this.downMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);

    color.dispose();
    gbuf.dispose();
    inked.dispose();
    albedo.dispose();
  }
}

// ───────────────────────────── the crew ─────────────────────────────

const BASE = '/res/chars/';
let clipsP: Promise<Map<string, THREE.AnimationClip>> | null = null;
/** the shared mocap library, filtered like avatars.ts does (rotations + root translation) */
function loadClips(): Promise<Map<string, THREE.AnimationClip>> {
  return (clipsP ??= new GLTFLoader().loadAsync(`${BASE}anims.glb`).then((g) => {
    const m = new Map<string, THREE.AnimationClip>();
    for (const c of g.animations) {
      c.tracks = c.tracks.filter((t) => (t.name.endsWith('.quaternion') && !t.name.startsWith('Bip01_Footsteps')) || t.name === 'Bip01.position');
      m.set(c.name, c);
    }
    return m;
  }));
}

export interface Doc {
  ch: AvatarCharacter;
  sex: 'm' | 'f';
  bones: Map<string, THREE.Bone>;
  mixer: THREE.AnimationMixer;
  morphs: THREE.Mesh[];
}

async function makeDoc(cast: AvatarCast, height: number, boost = 1): Promise<Doc> {
  const ch = await new Promise<AvatarCharacter>((resolve) => {
    const c: AvatarCharacter = new AvatarCharacter(cast, { height, onReady: () => resolve(c) });
  });
  if (ch.failed) throw new Error(`avatar ${cast.id} failed to load`);
  const bones = new Map<string, THREE.Bone>();
  const morphs: THREE.Mesh[] = [];
  ch.root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    const m = o as THREE.Mesh;
    if (m.isMesh && m.morphTargetDictionary) morphs.push(m);
    if (m.isMesh) m.userData.inkClass = CLS.body;
    // posed far from the bind pose, a skinned mesh's bounds go stale (hair vanished in close-ups);
    // an offline frame can afford to draw everything
    if (m.isMesh) m.frustumCulled = false;
    // denser hair cards: comic hair is a solid shape (the same cut-off feeds the g-buffer)
    if (m.isMesh && !Array.isArray(m.material) && m.material.name === 'hair') {
      m.material = m.material.clone();
      m.material.alphaTest = 0.22;
    }
    if (m.isMesh && boost !== 1) {
      // own copies: other characters may share this model's materials
      const own = (mat: THREE.Material) => {
        const c = mat.clone() as THREE.MeshStandardMaterial;
        if (c.name === 'head' || c.name === 'body') c.color.multiplyScalar(boost);
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    }
  });
  // the soft contact-shadow disc under the feet: the ink pass draws real shadows instead
  for (const c of ch.root.children) if ((c as THREE.Mesh).isMesh) c.visible = false;
  return { ch, sex: /Female/.test(cast.id) ? 'f' : 'm', bones, mixer: new THREE.AnimationMixer(ch.root), morphs };
}

function bone(d: Doc, name: string): THREE.Bone {
  const b = d.bones.get(`Bip01_${name}`) ?? d.bones.get(name);
  if (!b) throw new Error(`no bone ${name}`);
  return b;
}

/** freeze a clip frame (seconds) as the base pose */
async function pose(d: Doc, clip: string, t: number) {
  const clips = await loadClips();
  const c = clips.get(clip) ?? clips.get(clip.replace(/^f_/, 'm_'));
  if (!c) throw new Error(`no clip ${clip}`);
  d.mixer.stopAllAction();
  d.mixer.clipAction(c).play();
  d.mixer.setTime(Math.min(t, c.duration - 0.001));
  d.ch.root.updateMatrixWorld(true);
}

function face(d: Doc, w: Record<string, number>) {
  for (const m of d.morphs) {
    for (const [k, v] of Object.entries(w)) {
      const i = m.morphTargetDictionary![k];
      if (i !== undefined) m.morphTargetInfluences![i] = v;
    }
  }
}

// ── posing helpers (world space) ──

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** turn a bone by a world-space rotation (keeps its children attached) */
function rotateWorld(b: THREE.Object3D, q: THREE.Quaternion) {
  b.parent!.getWorldQuaternion(_q2);
  // world' = q · world  ⇒  local' = parentW⁻¹ · q · parentW · local
  const pw = _q2.clone();
  b.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw));
  b.updateMatrixWorld(true);
}

function turn(b: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle));
}

function wpos(b: THREE.Object3D, out = new THREE.Vector3()) {
  return b.getWorldPosition(out);
}

/** rotate bone so that the direction from it to `child` points along `dir` (world) */
function aim(b: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  const from = wpos(child).sub(wpos(b)).normalize();
  _q.setFromUnitVectors(from, dir.clone().normalize());
  rotateWorld(b, _q);
}

/** the character's frame: origin at the feet, left (+x), up, forward (+z) */
function frame(d: Doc) {
  const q = d.ch.root.getWorldQuaternion(new THREE.Quaternion());
  return {
    o: d.ch.root.getWorldPosition(new THREE.Vector3()),
    left: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
  };
}

/** midpoint of the shoulder joints */
function shoulders(d: Doc) {
  return wpos(bone(d, 'L_UpperArm')).add(wpos(bone(d, 'R_UpperArm'))).multiplyScalar(0.5);
}

/** a point offset from `p` in the character's frame (metres) */
function off(d: Doc, p: THREE.Vector3, left: number, up: number, fwd: number) {
  const f = frame(d);
  return p.clone().addScaledVector(f.left, left).addScaledVector(f.up, up).addScaledVector(f.fwd, fwd);
}

/** a direction in the character's frame */
function dirIn(d: Doc, left: number, up: number, fwd: number) {
  const f = frame(d);
  return new THREE.Vector3().addScaledVector(f.left, left).addScaledVector(f.up, up).addScaledVector(f.fwd, fwd).normalize();
}

/**
 * Two-bone IK: put the wrist of arm `side` at `target`, the elbow bending toward `pole` (world
 * points). Bone lengths come from the current pose.
 */
function reach(d: Doc, side: 'L' | 'R', target: THREE.Vector3, pole: THREE.Vector3) {
  const up = bone(d, `${side}_UpperArm`);
  const fo = bone(d, `${side}_Forearm`);
  const ha = bone(d, `${side}_Hand`);
  const S = wpos(up);
  const a = wpos(fo).distanceTo(S);
  const b = wpos(ha).distanceTo(wpos(fo));
  const toT = target.clone().sub(S);
  const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  const x = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().sub(S);
  const pdir = p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const elbow = S.clone().addScaledVector(dir, x).addScaledVector(pdir, h);
  aim(up, fo, elbow.clone().sub(S));
  aim(fo, ha, target.clone().sub(wpos(fo)));
}

/**
 * A hand's world basis. Rocketbox hands: local X along the fingers, Y out of the palm, Z toward
 * the thumb on the right hand and away from it on the left (accessories.ts).
 */
function handBasis(d: Doc, side: 'L' | 'R') {
  const q = bone(d, `${side}_Hand`).getWorldQuaternion(new THREE.Quaternion());
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return {
    pos: wpos(bone(d, `${side}_Hand`)),
    fingers: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    palm: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    thumb: side === 'R' ? z : z.negate(),
  };
}

/** turn a hand so its fingers point along `fingers` and its palm faces `palm` (world) */
function orientHand(d: Doc, side: 'L' | 'R', fingers: THREE.Vector3, palm: THREE.Vector3) {
  const hb = bone(d, `${side}_Hand`);
  const q = hb.getWorldQuaternion(new THREE.Quaternion());
  const cx = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const cy = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const cur = new THREE.Matrix4().makeBasis(cx, cy, cx.clone().cross(cy));
  const tx = fingers.clone().normalize();
  const ty = palm.clone().sub(tx.clone().multiplyScalar(palm.dot(tx))).normalize();
  const want = new THREE.Matrix4().makeBasis(tx, ty, tx.clone().cross(ty));
  const r = new THREE.Quaternion().setFromRotationMatrix(want).multiply(new THREE.Quaternion().setFromRotationMatrix(cur).invert());
  rotateWorld(hb, r);
}

/** a fist round a handle: thumb (the handle's axis) along `thumb`, palm facing `palm` (world) */
function gripHand(d: Doc, side: 'L' | 'R', thumb: THREE.Vector3, palm: THREE.Vector3) {
  const t = thumb.clone().normalize();
  const p = palm.clone().sub(t.clone().multiplyScalar(palm.dot(t))).normalize();
  // right hand: fingers × palm = thumb; left hand: fingers × palm = −thumb
  orientHand(d, side, side === 'R' ? p.clone().cross(t) : t.clone().cross(p), p);
}

/** curl the four fingers (radians per joint) and the thumb */
function curl(d: Doc, side: 'L' | 'R', fingers: number, thumb = 0) {
  for (let f = 1; f <= 4; f++) {
    for (const s of ['', '1', '2']) {
      const b = d.bones.get(`Bip01_${side}_Finger${f}${s}`);
      if (b) b.rotateZ(fingers * (s === '' ? 0.9 : 1));
    }
  }
  for (const s of ['1', '2']) {
    const b = d.bones.get(`Bip01_${side}_Finger0${s}`);
    if (b) b.rotateZ(thumb);
  }
  d.ch.root.updateMatrixWorld(true);
}

/** head and chest attitude: yaw (+ = toward the character's left), pitch (+ = chin up), roll */
function attitude(d: Doc, o: { yaw?: number; pitch?: number; roll?: number; chestPitch?: number; chestYaw?: number }) {
  const f = frame(d);
  if (o.chestPitch) for (const n of ['Spine1', 'Spine2']) turn(bone(d, n), f.left, -o.chestPitch / 2);
  if (o.chestYaw) for (const n of ['Spine1', 'Spine2']) turn(bone(d, n), f.up, o.chestYaw / 2);
  const neck = bone(d, 'Neck');
  const head = bone(d, 'Head');
  if (o.yaw) {
    turn(neck, f.up, o.yaw * 0.4);
    turn(head, f.up, o.yaw * 0.6);
  }
  if (o.pitch) {
    turn(neck, f.left, -o.pitch * 0.5);
    turn(head, f.left, -o.pitch * 0.5);
  }
  if (o.roll) turn(head, f.fwd, o.roll);
}

// ── poses ──

/** arms folded across the chest, right forearm on top, right hand on the left biceps */
function crossArms(d: Doc, o: { lift?: number } = {}) {
  const M = shoulders(d);
  const k = d.sex === 'f' ? 0.92 : 1;
  const lift = o.lift ?? 0;
  reach(d, 'R', off(d, M, 0.1 * k, -0.27 * k + lift, 0.2 * k), off(d, M, -0.6, -0.55, 0.05));
  reach(d, 'L', off(d, M, -0.12 * k, -0.31 * k + lift, 0.16 * k), off(d, M, 0.6, -0.55, 0.05));
  orientHand(d, 'R', dirIn(d, 0.85, 0.25, -0.25), dirIn(d, 0, -0.2, -1));
  orientHand(d, 'L', dirIn(d, -0.85, 0.1, -0.35), dirIn(d, 0, 0.3, -1));
  curl(d, 'R', 0.25, 0.1);
  curl(d, 'L', 0.35, 0.1);
}

/** hands on the hips, elbows out */
function akimbo(d: Doc) {
  const M = shoulders(d);
  const k = d.sex === 'f' ? 0.93 : 1;
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    reach(d, side, off(d, M, s * 0.2 * k, -0.4 * k, -0.01), off(d, M, s * 1.0, -0.22, -0.25));
    orientHand(d, side, dirIn(d, -s * 0.2, -0.55, 0.8), dirIn(d, -s, 0, -0.15));
    curl(d, side, 0.2, 0.05);
  }
}

/** paddles crossed in an X in front of the chest, wrists crossed, plates up and out */
function paddlesX(d: Doc) {
  const M = shoulders(d);
  const k = d.sex === 'f' ? 0.93 : 1;
  for (const [side, s] of [['R', -1], ['L', 1]] as const) {
    // each wrist crosses to the other side; the paddle continues the forearm up and out
    reach(d, side, off(d, M, -s * 0.07 * k, -0.17 * k, 0.27 * k), off(d, M, s * 0.6, -0.6, 0.1));
    const fo = wpos(bone(d, `${side}_Forearm`));
    const wr = wpos(bone(d, `${side}_Hand`));
    const along = wr.clone().sub(fo).normalize();
    const thumb = along.add(dirIn(d, 0, 0.45, 0)).normalize();
    gripHand(d, side, thumb, dirIn(d, 0, 0, -1));
    curl(d, side, 0.95, 0.4);
  }
}

/** defibrillator paddles held up beside the head, plates facing forward */
function paddlesUp(d: Doc, o: { spread?: number; height?: number } = {}) {
  const M = shoulders(d);
  const sp = o.spread ?? 0.3;
  const ht = o.height ?? 0.12;
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    reach(d, side, off(d, M, s * sp, ht, 0.16), off(d, M, s * 0.7, -0.3, -0.25));
    orientHand(d, side, dirIn(d, s * 1, 0, 0.15), dirIn(d, 0, 0, 1));
    curl(d, side, 0.95, 0.4);
  }
}

// ───────────────────────────── accessories (procedural, world space after posing) ─────────────────────────────

const ACC = {
  lens: () => new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.15, metalness: 0.2 }),
  metal: () => new THREE.MeshStandardMaterial({ color: '#d9d9d9', roughness: 0.3, metalness: 0.6 }),
  tubing: () => new THREE.MeshStandardMaterial({ color: '#121212', roughness: 0.5 }),
  plastic: (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }),
  glint: () => new THREE.MeshBasicMaterial({ color: '#ffffff' }),
};

function tag(o: THREE.Object3D, cls: number = CLS.prop) {
  o.traverse((c) => {
    c.userData.inkClass = cls;
    c.castShadow = true;
  });
  return o;
}

/** place a local-frame object (x left, y up, z forward) at `origin` with the given world basis */
function placeIn(obj: THREE.Object3D, origin: THREE.Vector3, left: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3) {
  const m = new THREE.Matrix4().makeBasis(left, up, fwd).setPosition(origin);
  obj.applyMatrix4(m);
  return obj;
}

function tube(points: [number, number, number][], r: number, mat: THREE.Material, seg = 48, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5);
  return new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, 8, closed), mat);
}

/** aviator lens outline for the wearer's left lens (u outward, v up), metres */
function lensShape(sign: 1 | -1) {
  const s = new THREE.Shape();
  const P = (u: number, v: number) => [sign * u, v] as const;
  s.moveTo(...P(-0.022, 0.018));
  s.lineTo(...P(0.024, 0.02));
  s.bezierCurveTo(...P(0.031, 0.02), ...P(0.033, 0.008), ...P(0.031, -0.004));
  s.bezierCurveTo(...P(0.029, -0.02), ...P(0.017, -0.03), ...P(0.004, -0.03));
  s.bezierCurveTo(...P(-0.01, -0.03), ...P(-0.019, -0.022), ...P(-0.022, -0.01));
  s.bezierCurveTo(...P(-0.025, 0.0), ...P(-0.025, 0.012), ...P(-0.022, 0.018));
  return s;
}

/** aviator sunglasses on the head, from the eye bones */
function aviators(d: Doc, scene: THREE.Scene) {
  const g = new THREE.Group();
  const wrap = (geo: THREE.BufferGeometry) => {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - 2.4 * p.getX(i) * p.getX(i));
    geo.computeVertexNormals();
    return geo;
  };
  const lens = ACC.lens();
  const metal = ACC.metal();
  for (const s of [1, -1] as const) {
    const shape = lensShape(s);
    const geo = wrap(new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: false, curveSegments: 16 }).translate(s * 0.031, 0, 0));
    g.add(new THREE.Mesh(geo, lens));
    // rim
    const pts = shape.getSpacedPoints(48).map((p) => [p.x + s * 0.031, p.y, 0.0022 - 2.4 * (p.x + s * 0.031) ** 2] as [number, number, number]);
    g.add(tube(pts, 0.0012, metal, 96, true));
    // two glints across the lens (comic highlight)
    for (const [len, du] of [[0.017, 0], [0.008, 0.007]] as const) {
      const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.0026, len), ACC.glint());
      const u = s * (0.02 + du);
      glint.position.set(u, 0.003 - du * 0.4, 0.0036 - 2.4 * u * u);
      glint.rotation.z = s * 0.75;
      g.add(glint);
    }
    // temple arm back to the ear
    g.add(tube([[s * 0.057, 0.014, -0.006], [s * 0.066, 0.012, -0.04], [s * 0.071, 0.006, -0.085], [s * 0.069, -0.012, -0.1]], 0.0013, metal, 24));
  }
  // double bridge
  g.add(tube([[0.009, 0.019, 0.003], [0, 0.0195, 0.0032], [-0.009, 0.019, 0.003]], 0.0012, metal, 8));
  g.add(tube([[0.008, 0.008, 0.002], [0, 0.012, 0.004], [-0.008, 0.008, 0.002]], 0.0011, metal, 8));
  // head frame from the head bone (X up, Y forward, Z left) and the eyes
  const hq = bone(d, 'Head').getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(1, 0, 0).applyQuaternion(hq);
  const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
  const left = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
  const eyes = wpos(bone(d, 'LEye')).add(wpos(bone(d, 'REye'))).multiplyScalar(0.5);
  const scale = wpos(bone(d, 'LEye')).distanceTo(wpos(bone(d, 'REye'))) / 0.062;
  g.scale.setScalar(scale);
  placeIn(g, eyes.clone().addScaledVector(fwd, 0.021 * scale).addScaledVector(up, -0.002), left, up, fwd);
  tag(g);
  bone(d, 'Head').attach(g);
  void scene;
  return g;
}

/** a stethoscope draped round the neck, chest piece on the left, earpieces on the right */
function stethoscope(d: Doc) {
  const N = wpos(bone(d, 'Neck'));
  const S2 = wpos(bone(d, 'Spine2'));
  const up = N.clone().sub(S2).normalize();
  const left = wpos(bone(d, 'L_UpperArm')).sub(wpos(bone(d, 'R_UpperArm')));
  left.sub(up.clone().multiplyScalar(left.dot(up))).normalize();
  const fwd = left.clone().cross(up).normalize();
  const g = new THREE.Group();
  const k = d.sex === 'f' ? 0.93 : 1;
  const P = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
  const tubing = ACC.tubing();
  const metal = ACC.metal();
  g.add(
    tube(
      [P(0.075, -0.3, 0.135), P(0.085, -0.17, 0.14), P(0.08, -0.05, 0.1), P(0.07, 0.015, 0.03), P(0.04, 0.035, -0.045), P(0, 0.04, -0.07), P(-0.04, 0.035, -0.045), P(-0.07, 0.015, 0.03), P(-0.08, -0.05, 0.1), P(-0.085, -0.17, 0.14), P(-0.08, -0.25, 0.135)],
      0.0055,
      tubing,
      96,
    ),
  );
  // chest piece (diaphragm)
  const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 24), metal);
  cp.position.set(...P(0.075, -0.32, 0.14));
  cp.rotation.x = Math.PI / 2;
  g.add(cp);
  // binaural: two metal tubes from the Y, earpieces up
  for (const s of [1, -1]) g.add(tube([P(-0.08, -0.25, 0.135), P(-0.08 + s * 0.018, -0.2, 0.15), P(-0.08 + s * 0.022, -0.15, 0.155)], 0.0028, metal, 12));
  placeIn(g, N, left, up, fwd);
  tag(g);
  bone(d, 'Spine2').attach(g);
  return g;
}

/**
 * A defibrillator paddle in hand `side`: grip along the thumb, the electrode plate beyond it. The
 * electrode faces the palm side, or the knuckle side with `flip` (so it shows when palms face in).
 * Its coiled cable leaves the bottom of the handle and falls away from the body.
 */
function paddle(d: Doc, side: 'L' | 'R', o: { flip?: boolean } = {}) {
  const g = new THREE.Group();
  const dark = ACC.plastic('#1b1b1b');
  const mid = ACC.plastic('#8a8a8a');
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.13, 20), dark);
  g.add(handle);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.021, 0.022, 20), mid);
  collar.position.y = 0.076;
  g.add(collar);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.05, 0.026), dark);
  neck.position.y = 0.108;
  g.add(neck);
  const housing = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.14, 0.03, 3, 0.012), dark);
  housing.position.y = 0.2;
  g.add(housing);
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.124, 0.006, 2, 0.006), ACC.plastic('#f4f4f4'));
  face.position.set(0, 0.2, 0.016);
  g.add(face);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 12), mid);
  btn.position.set(0, 0.088, -0.022);
  btn.rotation.x = Math.PI / 2;
  g.add(btn);
  if (o.flip) g.rotation.y = Math.PI;
  const body = new THREE.Group();
  body.add(g);
  // in the fist: grip axis along the thumb
  const hb = handBasis(d, side);
  const yAxis = hb.thumb.clone().normalize();
  const zAxis = hb.palm.clone().sub(yAxis.clone().multiplyScalar(hb.palm.dot(yAxis))).normalize();
  const xAxis = yAxis.clone().cross(zAxis);
  const grip = hb.pos.clone().addScaledVector(hb.fingers, 0.045).addScaledVector(hb.palm, 0.022);
  body.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(grip));
  tag(body);
  bone(d, `${side}_Hand`).attach(body);
  // the coiled cable, in world space: out of the handle, then away from the body and down
  const f = frame(d);
  const out = f.left.clone().multiplyScalar(side === 'L' ? 1 : -1);
  const down = new THREE.Vector3(0, -1, 0);
  const p0 = grip.clone().addScaledVector(yAxis, -0.068);
  const p1 = p0.clone().addScaledVector(yAxis, -0.06);
  const p2 = p1.clone().addScaledVector(out, 0.1).addScaledVector(down, 0.12).addScaledVector(f.fwd, -0.04);
  const p3 = p2.clone().addScaledVector(out, 0.05).addScaledVector(down, 0.22).addScaledVector(f.fwd, -0.2);
  const p4 = p3.clone().addScaledVector(down, 0.3).addScaledVector(f.fwd, -0.35);
  const guide = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]);
  const pts: THREE.Vector3[] = [];
  const n = 320;
  const len = guide.getLength();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = guide.getPointAt(t);
    const tan = guide.getTangentAt(t);
    const ref = Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a1 = ref.sub(tan.clone().multiplyScalar(ref.dot(tan))).normalize();
    const b1 = tan.clone().cross(a1);
    const w = (t * len * 2 * Math.PI) / 0.02;
    const r = t < 0.12 ? 0 : 0.008 * Math.min(1, (t - 0.12) / 0.04);
    pts.push(p.addScaledVector(a1, Math.cos(w) * r).addScaledVector(b1, Math.sin(w) * r));
  }
  const cable = tag(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 1400, 0.0028, 6), dark));
  d.ch.root.parent?.attach(cable);
  return body;
}

// ───────────────────────────── scene kit ─────────────────────────────

function lights(
  scene: THREE.Scene,
  o: { key: [number, number, number]; keyI?: number; rim?: [number, number, number]; rimI?: number; rim2?: [number, number, number]; fill?: number; target?: [number, number, number]; extent?: number; spot?: number },
) {
  const tgt = new THREE.Vector3(...(o.target ?? [0, 1, 0]));
  let key: THREE.DirectionalLight | THREE.SpotLight;
  if (o.spot) {
    // a pool of light round the subject: the floor falls off into black
    const sp = new THREE.SpotLight(0xffffff, o.keyI ?? 3.2, 0, o.spot, 0.6, 0);
    sp.shadow.camera.near = 0.5;
    sp.shadow.camera.far = 40;
    key = sp;
  } else {
    const dl = new THREE.DirectionalLight(0xffffff, o.keyI ?? 3.2);
    const sc = dl.shadow.camera;
    const e = o.extent ?? 4;
    sc.left = -e;
    sc.right = e;
    sc.top = e;
    sc.bottom = -e;
    sc.near = 0.1;
    sc.far = 40;
    key = dl;
  }
  key.position.set(...o.key).add(tgt);
  key.target.position.copy(tgt);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  scene.add(key, key.target);
  for (const r of [o.rim, o.rim2]) {
    if (!r) continue;
    const rim = new THREE.DirectionalLight(0xffffff, o.rimI ?? 2.4);
    rim.position.set(...r).add(tgt);
    rim.target.position.copy(tgt);
    scene.add(rim, rim.target);
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, o.fill ?? 0.25));
}

function floor(scene: THREE.Scene, tone = '#777777') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.9 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  m.userData.inkClass = CLS.set;
  scene.add(m);
  return m;
}

/** a brick wall (CC0 ambientCG set from /res/tex), w × h metres, facing +z */
function brickWall(scene: THREE.Scene, w: number, h: number, z: number, x = 0) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.9, uv.getY(i) * h * 0.9);
  const m = new THREE.Mesh(geo, pbr('brick', { worldUV: false, roughness: 0.95 }));
  m.position.set(x, h / 2, z);
  m.receiveShadow = true;
  m.userData.inkClass = CLS.set;
  scene.add(m);
  return m;
}

function cam(fov: number, pos: [number, number, number], look: [number, number, number]) {
  const c = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 200);
  c.position.set(...pos);
  c.lookAt(...look);
  return c;
}

// ───────────────────────────── panels ─────────────────────────────

interface Built {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** extra views composited side by side (pose lab) */
  views?: THREE.PerspectiveCamera[];
  style: Partial<InkStyle>;
}

type Params = Record<string, string>;

const CREW: Record<string, { cast: AvatarCast; height: number; boost?: number }> = {
  rex: { cast: { id: 'Medical_Male_01' }, height: 1.84 },
  vic: { cast: { id: 'Medical_Female_02', hair: '#120e0c' }, height: 1.72 },
  tess: { cast: { id: 'Medical_Female_01', skin: '#9a6446', hair: '#17130f' }, height: 1.7, boost: 1.9 },
  marcus: { cast: { id: 'Medical_Male_04' }, height: 1.86 },
};

async function member(name: string, clip: string, t: number) {
  const c = CREW[name];
  const d = await makeDoc(c.cast, c.height, c.boost);
  await pose(d, `${d.sex}_${clip}`, t);
  return d;
}

/** one crew member from three angles, for tuning poses */
async function lab(p: Params): Promise<Built> {
  const scene = new THREE.Scene();
  const d = await member(p.who ?? 'rex', p.clip ?? 'idle', Number(p.t ?? 0.5));
  scene.add(d.ch.root);
  d.ch.root.updateMatrixWorld(true);
  if (p.pose === 'cross') crossArms(d);
  if (p.pose === 'akimbo') akimbo(d);
  if (p.pose === 'paddles') paddlesUp(d);
  if (p.pose === 'paddlesX') paddlesX(d);
  attitude(d, { pitch: 0.12, yaw: 0.1 });
  face(d, { MouthSmileLeft: 0.4, BrowDownLeft: 0.35, BrowDownRight: 0.35, EyeSquintLeft: 0.3, EyeSquintRight: 0.3 });
  aviators(d, scene);
  if (p.steth !== '0') stethoscope(d);
  if (p.pose === 'paddles' || p.pose === 'paddlesX') {
    paddle(d, 'L', { flip: p.pose === 'paddlesX' });
    paddle(d, 'R', { flip: p.pose === 'paddlesX' });
  }
  floor(scene);
  lights(scene, { key: [-2.5, 4, 3.5], rim: [3, 3, -4] });
  const head = wpos(bone(d, 'Head'));
  const views =
    p.view === 'face'
      ? [cam(16, [0, head.y + 0.05, 1.3], [0, head.y + 0.06, 0]), cam(16, [0.9, head.y + 0.05, 0.95], [0, head.y + 0.06, 0]), cam(16, [1.3, head.y + 0.05, 0.1], [0, head.y + 0.06, 0])]
      : [cam(24, [0, 0.9, 4.2], [0, 1.15, 0]), cam(24, [2.6, 1.3, 3.0], [0, 1.2, 0]), cam(24, [3.9, 1.3, 0.2], [0, 1.2, 0])];
  return { scene, camera: views[0], views, style: { bgMode: 0, bgTone: 0.0, exposure: 2.8, hiT: 0.55, loT: 0.22, lineOuter: 5, lineInner: 2, skinLo: 0.2 } };
}


// ── the shipped panels ──

const NOIR: Partial<InkStyle> = { bgMode: 1, bgTone: 0.74, bgRays: 26, exposure: 2.6, hiT: 0.55, loT: 0.24, lineOuter: 4.6, lineInner: 1.8, skinLo: 0.2 };
const COOL = { MouthSmileLeft: 0.45, BrowDownLeft: 0.4, BrowDownRight: 0.3, EyeSquintLeft: 0.3, EyeSquintRight: 0.25 };

/** turn a character (yaw about its feet) to face a world point */
function faceTo(d: Doc, x: number, z: number, extra = 0) {
  const p = d.ch.root.position;
  d.ch.root.rotation.y = Math.atan2(x - p.x, z - p.z) + extra;
  d.ch.root.updateMatrixWorld(true);
}

async function place(scene: THREE.Scene, who: string, clip: string, t: number, at: [number, number], look: [number, number], yaw = 0) {
  const d = await member(who, clip, t);
  d.ch.root.position.set(at[0], 0, at[1]);
  scene.add(d.ch.root);
  faceTo(d, look[0], look[1], yaw);
  await pose(d, `${d.sex}_${clip}`, t); // re-pose in place (the mixer writes local transforms only)
  return d;
}

/** shift the frame so the subject sits right of centre (fraction of the width), keeping verticals */
function shift(c: THREE.PerspectiveCamera, fx: number, fy = 0) {
  c.setViewOffset(1920, 1080, -fx * 1920, -fy * 1080, 1920, 1080);
  return c;
}

/** The crew: four of them in a V, low angle, arms folded and hands on hips. */
async function crew(): Promise<Built> {
  const scene = new THREE.Scene();
  const eye: [number, number] = [0.2, 5];
  const vic = await place(scene, 'vic', 'idle', 1.4, [0.05, 0.45], eye, 0.05);
  const rex = await place(scene, 'rex', 'idle', 0.5, [-0.72, -0.05], eye, 0.22);
  const tess = await place(scene, 'tess', 'idle', 2.2, [0.8, -0.12], eye, -0.18);
  const marcus = await place(scene, 'marcus', 'idle', 0.9, [1.5, -0.68], eye, -0.3);
  akimbo(vic);
  crossArms(rex);
  crossArms(tess);
  crossArms(marcus);
  attitude(vic, { pitch: 0.1, yaw: -0.05, roll: 0.04 });
  attitude(rex, { pitch: 0.14, yaw: -0.15 });
  attitude(tess, { pitch: 0.08, yaw: 0.12, roll: -0.05 });
  attitude(marcus, { pitch: 0.05, yaw: 0.1 });
  for (const d of [vic, rex, tess, marcus]) {
    face(d, COOL);
    aviators(d, scene);
  }
  stethoscope(rex);
  stethoscope(tess);
  floor(scene, '#4a4a4a');
  lights(scene, { key: [-4.4, 4.4, 1.8], keyI: 3.6, spot: 0.55, rim: [3.5, 2.5, -4], rim2: [-3.5, 2, -4], rimI: 2.6, fill: 0.14, target: [0.35, 1, 0] });
  const camera = shift(cam(40, [0.3, 0.34, 3.3], [0.3, 1.48, 0]), 0.17);
  return { scene, camera, style: { ...NOIR, bgCenter: [0.67, 0.66] } };
}

/** "Clear." — Vic, paddles crossed, from below. */
async function clear(): Promise<Built> {
  const scene = new THREE.Scene();
  const vic = await place(scene, 'vic', 'idle', 1.4, [0, 0], [0.3, 4], 0.12);
  paddlesX(vic);
  attitude(vic, { pitch: 0.16, yaw: -0.1, roll: -0.05 });
  face(vic, { ...COOL, MouthSmileLeft: 0.55 });
  aviators(vic, scene);
  paddle(vic, 'L', { flip: true });
  paddle(vic, 'R', { flip: true });
  floor(scene, '#444444');
  lights(scene, { key: [-3.4, 3.2, 1.4], keyI: 3.8, spot: 0.5, rim: [2.6, 2.2, -3.4], rim2: [-2.6, 1.6, -3.4], rimI: 3.0, fill: 0.13, target: [0, 1.3, 0] });
  const camera = shift(cam(36, [0.22, 0.86, 1.62], [0.02, 1.5, 0]), 0.18);
  return { scene, camera, style: { ...NOIR, bgCenter: [0.68, 0.74] } };
}

/** Rex leans on the crash cart, arms folded; Tess, hands on hips. */
async function cart(): Promise<Built> {
  const scene = new THREE.Scene();
  const eye: [number, number] = [0.5, 4];
  const rex = await place(scene, 'rex', 'idle', 0.5, [0, 0.12], eye, 0.25);
  // lean back against the cart (pivot at the feet)
  rex.ch.root.rotateX(-0.09);
  rex.ch.root.updateMatrixWorld(true);
  crossArms(rex);
  attitude(rex, { pitch: 0.18, yaw: -0.3, roll: 0.06 });
  face(rex, { ...COOL, MouthSmileLeft: 0.6 });
  aviators(rex, scene);
  stethoscope(rex);
  const tess = await place(scene, 'tess', 'idle', 2.2, [0.92, 0.3], eye, -0.35);
  akimbo(tess);
  attitude(tess, { pitch: 0.1, yaw: -0.25, roll: 0.05 });
  face(tess, COOL);
  aviators(tess, scene);
  stethoscope(tess);
  const cc = buildEquipment({ id: 'cc', kind: 'crashCart', room: 'trauma', x: 0, z: 0 });
  cc.group.position.set(-0.05, 0, -0.42);
  cc.group.rotation.y = 0.35;
  tag(cc.group, CLS.set);
  scene.add(cc.group);
  floor(scene, '#4a4a4a');
  brickWall(scene, 14, 6, -1.25, 0.5);
  lights(scene, { key: [-2.8, 4.2, 2.6], keyI: 3.6, spot: 0.5, rim: [3.2, 2.4, -0.9], rim2: [-3, 2, -0.9], rimI: 2.4, fill: 0.14, target: [0.45, 1, 0] });
  const camera = shift(cam(38, [0.62, 0.45, 2.95], [0.48, 1.42, 0]), 0.17);
  return { scene, camera, style: { ...NOIR, bgCenter: [0.67, 0.66] } };
}

/** The walk: the crew comes out of the ambulance bay toward you. */
async function walk(): Promise<Built> {
  const scene = new THREE.Scene();
  const eye: [number, number] = [0.3, 9];
  const rex = await place(scene, 'rex', 'walk', 0.12, [0, 0.4], eye, 0);
  const vic = await place(scene, 'vic', 'walk', 0.55, [-0.9, -0.1], eye, 0.04);
  const tess = await place(scene, 'tess', 'walk', 0.33, [0.92, -0.2], eye, -0.04);
  const marcus = await place(scene, 'marcus', 'walk', 0.8, [1.75, -0.85], eye, -0.06);
  for (const d of [rex, vic, tess, marcus]) {
    attitude(d, { pitch: 0.06 });
    face(d, COOL);
    aviators(d, scene);
  }
  stethoscope(rex);
  stethoscope(tess);
  const amb = { group: new THREE.Group(), lightBar: [] as THREE.Mesh[] };
  buildAmbulance(amb);
  amb.group.position.set(0.5, 0, -5.2);
  amb.group.rotation.y = -0.22;
  tag(amb.group, CLS.set);
  scene.add(amb.group);
  floor(scene, '#444444');
  lights(scene, { key: [-4.2, 4.6, 2.6], keyI: 3.6, spot: 0.6, rim: [2.5, 3, -5], rim2: [-2.5, 2.5, -5], rimI: 2.6, fill: 0.16, target: [0.4, 1, -1.5], extent: 9 });
  const camera = shift(cam(34, [0.45, 0.4, 4.1], [0.45, 1.52, 0]), 0.16);
  return { scene, camera, style: { ...NOIR, bgMode: 2, bgTone: 0.82 } };
}

/** Close-up: Vic in front, Rex over her shoulder. */
async function stare(): Promise<Built> {
  const scene = new THREE.Scene();
  const vic = await place(scene, 'vic', 'idle', 1.4, [0.12, 0.25], [0.6, 3], -0.1);
  const rex = await place(scene, 'rex', 'idle', 0.5, [-0.42, -0.35], [0.6, 3], 0.3);
  crossArms(vic);
  crossArms(rex);
  attitude(vic, { pitch: 0.05, yaw: -0.2, roll: -0.05 });
  attitude(rex, { pitch: 0.12, yaw: 0.18 });
  face(vic, { ...COOL, MouthSmileLeft: 0.35, MouthSmileRight: 0.15 });
  face(rex, { ...COOL, MouthSmileLeft: 0.6 });
  aviators(vic, scene);
  aviators(rex, scene);
  stethoscope(rex);
  // no floor: their feet are out of frame, and a lit floor reads as a white band behind them
  lights(scene, { key: [-3.4, 1.3, 1.4], keyI: 3.8, rim: [2.8, 2.2, -3.4], rim2: [-2.4, 1.5, -3.4], rimI: 3.0, fill: 0.12, target: [0, 1.5, 0] });
  const camera = shift(cam(24, [0.45, 1.38, 2.05], [0.0, 1.58, 0]), 0.16);
  return { scene, camera, style: { ...NOIR, bgCenter: [0.66, 0.66], hairExp: 0.22 } };
}

const PANELS: Record<string, (p: Params) => Promise<Built>> = { crew, clear, cart, walk, stare, lab };

// ───────────────────────────── page API ─────────────────────────────

const canvas = document.createElement('canvas');
const ink = new Ink(canvas);

interface RenderOpts {
  w?: number;
  h?: number;
  ss?: number;
  type?: string;
  quality?: number;
  style?: Partial<InkStyle>;
  params?: Params;
}

async function render(name: string, o: RenderOpts = {}): Promise<string> {
  const make = PANELS[name];
  if (!make) throw new Error(`no panel ${name}`);
  const built = await make(o.params ?? {});
  await idle(); // late textures (props' PBR sets) must be in before the frame
  const w = o.w ?? 1920;
  const h = o.h ?? 1080;
  const style = { ...DEFAULT_STYLE, ...built.style, ...o.style };
  if (!built.views) {
    ink.render(built.scene, built.camera, w, h, style, o.ss ?? 2);
    return canvas.toDataURL(o.type ?? 'image/png', o.quality ?? 0.82);
  }
  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h;
  const ctx = sheet.getContext('2d')!;
  const vw = Math.floor(w / built.views.length);
  built.views.forEach((c, i) => {
    ink.render(built.scene, c, vw, h, style, o.ss ?? 2);
    ctx.drawImage(canvas, i * vw, 0);
  });
  return sheet.toDataURL(o.type ?? 'image/png', o.quality ?? 0.82);
}

/** resolves once three's loading manager has had nothing new for a moment */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    const lm = THREE.DefaultLoadingManager;
    const prev = lm.onLoad;
    let t = window.setTimeout(done, 400);
    lm.onLoad = () => {
      prev?.();
      window.clearTimeout(t);
      t = window.setTimeout(done, 400);
    };
    function done() {
      lm.onLoad = prev;
      resolve();
    }
  });
}

declare global {
  interface Window {
    __art?: { panels: string[]; render: typeof render };
  }
}
window.__art = { panels: Object.keys(PANELS).filter((n) => n !== 'lab'), render };

// interactive preview when opened in a browser (?api=1: driven by the render script instead)
const q = new URLSearchParams(location.search);
if (!q.has('api')) {
  const out = document.getElementById('out')!;
  out.innerHTML = '';
  const names = q.get('panel') ? [q.get('panel')!] : window.__art.panels;
  for (const name of names) {
    const url = await render(name, { w: 960, h: 540, params: Object.fromEntries(q) });
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.alt = name;
    img.src = url;
    const cap = document.createElement('figcaption');
    cap.textContent = name;
    fig.append(img, cap);
    out.append(fig);
  }
}


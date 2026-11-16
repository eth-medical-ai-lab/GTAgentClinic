/**
 * GPU renderer for the hospital: three.js WebGPURenderer (falls back to WebGL 2 by itself),
 * physically based lighting with clustered (Forward+) light culling for the many ceiling
 * fixtures, and a post stack chosen by quality:
 *
 *   low     direct render, MSAA, no post
 *   medium  GTAO ambient occlusion (½ res) + bloom + temporal AA
 *   high    + full-res-ish AO radius, soft shadows from key lights, higher pixel ratio
 *   ultra   + native pixel ratio
 *
 * Everything else in the world talks to this through `Gfx`.
 */
import * as THREE from 'three';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { float, mix, mrt, normalView, output, packNormalToRGB, pass, sample, screenUV, smoothstep, unpackRGBToNormal, uniform, vec2, vec4, velocity } from 'three/tsl';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';

import { setActiveQuality, type Quality } from './quality';
export { QUALITIES, preferredQuality, saveQuality, type Quality } from './quality';

export interface Gfx {
  readonly renderer: WebGPURenderer;
  readonly quality: Quality;
  readonly backend: 'webgpu' | 'webgl';
  readonly shadows: boolean;
  render(): void;
  setSize(w: number, h: number): void;
  /** 0..1 strength of the ambient-occlusion darkening (artistic control) */
  setAO(strength: number): void;
  setBloom(strength: number): void;
  dispose(): void;
}

type AdapterLike = { isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } };
async function webgpuAdapterIsFast(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const a = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as AdapterLike | null;
    return !!a && !(a.isFallbackAdapter || a.info?.isFallbackAdapter);
  } catch {
    return false;
  }
}

/** dev tuning via URL (?tm=agx|aces|neutral&exp=1&ao=0.85&bloom=0.2) — art-direction iteration without rebuilds */
export function tune(name: string, fallback: number): number {
  const v = new URLSearchParams(location.search).get(name);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** true when WebGL runs on a CPU rasterizer (SwiftShader, llvmpipe, "Microsoft Basic Render") */
export function softwareGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return true;
  }
}

export async function createGfx(canvasParent: HTMLElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, requested?: Quality | null): Promise<Gfx> {
  const fast = await webgpuAdapterIsFast();
  // auto: fast WebGPU → high; hardware WebGL 2 → medium; CPU rasterizer → low
  const quality: Quality = requested ?? (fast ? 'high' : softwareGL() ? 'low' : 'medium');
  const renderer = new WebGPURenderer({ antialias: quality === 'low', powerPreference: 'high-performance', forceWebGL: !fast });
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, quality === 'ultra' ? 2 : quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1));
  renderer.setSize(canvasParent.clientWidth || 1, canvasParent.clientHeight || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const tm = new URLSearchParams(location.search).get('tm') ?? 'aces';
  renderer.toneMapping = tm === 'aces' ? THREE.ACESFilmicToneMapping : tm === 'agx' ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = tune('exp', 0.62);
  const shadows = quality === 'high' || quality === 'ultra';
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // many ceiling fixtures: Forward+ clustered light culling keeps per-pixel cost bounded
  renderer.lighting = new ClusteredLighting(512, 32, 24, 48);
  canvasParent.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
  setActiveQuality(quality);

  let pipeline: RenderPipeline | null = null;
  const aoStrength = uniform(tune('ao', 1.5));
  const bloomStrength = uniform(tune('bloom', 0.22));
  if (quality !== 'low') {
    pipeline = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const vel = scenePass.getTextureNode('velocity');
    const normalTex = scenePass.getTexture('normal');
    normalTex.type = THREE.UnsignedByteType;
    const normal = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uv)));

    const aoPass = ao(depth, normal, camera);
    aoPass.resolutionScale = quality === 'medium' ? 0.5 : 0.75;
    aoPass.radius.value = tune('aor', 0.75);
    aoPass.thickness.value = 1.0;
    aoPass.distanceExponent.value = 1.4;
    aoPass.scale.value = 1.0;
    aoPass.samples.value = quality === 'medium' ? 8 : 16;
    // Rotate GTAO's sample pattern every frame so the TRAA below averages the noise away. Without this
    // the pattern stays fixed on screen and shows as a crawling black/white speckle along contact edges
    // (patient outlines on the sheet, bed rails, wall corners).
    aoPass.useTemporalFiltering = true;
    // ...and smooth it in space first (depth- and normal-aware). TRAA clips its history to ±1σ of the
    // current, noisy neighbourhood, so GTAO's per-frame grain (3 slices a pixel) never fully averaged
    // out where AO is strong: narrow gaps (between a wall and a bay curtain's edge) showed as a
    // black-and-white speckle. ?aodn=0 turns it off (A/B).
    const aoRaw = aoPass.getTextureNode().sample(screenUV);
    // (typed as a bare Node; it is the same vec4 at run time)
    const aoTerm = tune('aodn', 1) > 0 ? (denoise(aoPass.getTextureNode(), depth, normal, camera) as unknown as typeof aoRaw).r : aoRaw.r;
    // AO darkens the lit image (contact shadows under beds, in corners, between people).
    // saturate(): with a strength > 1, mix(1, ao, s) goes negative where ao < 1 − 1/s (deep creases,
    // e.g. between a lying patient's arm and torso). TRAA's flicker reduction divides by max(rgb) + 1,
    // so a pixel near −1 blew up into a huge value that bloom spread into a flashing white orb.
    const lit = vec4(color.rgb.mul(mix(float(1), aoTerm, aoStrength).saturate()), color.a);
    const aa = traa(lit, depth, vel, camera);
    const glow = bloom(aa, bloomStrength, 0.35, 0.92);
    // subtle lens vignette (photographic falloff toward the corners)
    const d = screenUV.sub(vec2(0.5, 0.5)).length();
    const vignette = mix(float(1), smoothstep(float(0.85), float(0.35), d), float(tune('vig', 0.22)));
    const graded = vec4(aa.add(glow).rgb.mul(vignette), float(1));
    const debug = new URLSearchParams(location.search).get('view');
    pipeline.outputNode = debug === 'ao' ? vec4(aoTerm, aoTerm, aoTerm, float(1)) : graded;
  }

  return {
    renderer,
    quality,
    backend,
    shadows,
    render() {
      if (pipeline) pipeline.render();
      else renderer.render(scene, camera);
    },
    setSize(w, h) {
      renderer.setSize(w, h);
    },
    setAO(s) {
      aoStrength.value = s;
    },
    setBloom(s) {
      bloomStrength.value = s;
    },
    dispose() {
      pipeline?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

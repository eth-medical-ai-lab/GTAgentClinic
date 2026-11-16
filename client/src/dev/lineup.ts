/**
 * Cast lineup (dev page, client/src/dev/lineup.html): every authored cast — or every model as it
 * ships — rendered with the game's own avatar code (avatars.ts: head swaps, scrubs, garment hues,
 * skin and hair recolors) under a near-neutral overhead light.
 *
 *   ?set=staff|recolored|crowd|all|models  or  ?ids=rn_rosa,amb_dog   (CAST ids; with set=models, GLB names)
 *   ?view=face   head shots, front and three-quarter;  ?view=bust  forehead to mid-chest (necklines)
 *   ?view=nape   the same framing from behind and three-quarter rear (collars, the upper back)
 *   ?view=full   full figures from the front;  ?view=back  from behind
 *   ?view=turn   full figures: front, left, right, back, three-quarter rear
 *   ?view=head   the head from behind, left, right and above
 *   ?check=holes see-through check on the head and bust views (window.__lineup.holes): each head is drawn as
 *                the game draws it, then with every surface double-sided; pixels only the second pass
 *                covers are holes in the mesh (missing geometry, flipped faces) that show what's behind
 *   ?paint=head  the head meshes flat: outside green, inside red (which mesh shows at a neckline, and
 *                where a gap shows the inside of a neck), the outfit's own filler skin blue;  ?zoom=3  larger tiles
 */
import * as THREE from 'three';
import { AvatarCharacter } from '../world/avatars';
import { CAST, faceOf, type AvatarCast } from '../world/casting';

const q = new URLSearchParams(location.search);
const STAFF = ['player', 'ai_doctor', 'rn_rosa', 'rn_tom', 'rn_aisha', 'rn_lena', 'tech_marcus', 'att_shaw', 'clerk_paul', 'sec_dave', 'hk_ines', 'amb_float_rn', 'caf_luis', 'caf_rn_mei', 'cl_carmen', 'cl_rn_hannah'];
const recolored = (c: AvatarCast) => !!c.skin || (!!c.head && c.head !== c.id);
const SETS: Record<string, () => string[]> = {
  staff: () => [...STAFF, ...Object.keys(CAST).filter((id) => !STAFF.includes(id) && /^(rn|tech|att|clerk|sec|hk|caf_rn|cl|staff|ward|l2)_/.test(id) && !/^ward_pt_/.test(id))],
  recolored: () => Object.keys(CAST).filter((id) => recolored(CAST[id])),
  crowd: () => Object.keys(CAST).filter((id) => /^(amb|vis|caf_visitor)/.test(id)),
  all: () => Object.keys(CAST),
};
type View = 'face' | 'bust' | 'nape' | 'full' | 'back' | 'turn' | 'head';
const view = (['face', 'bust', 'nape', 'full', 'back', 'turn', 'head'].includes(q.get('view') ?? '') ? q.get('view') : 'face') as View;
const checkHoles = q.get('check') === 'holes';
/** camera bearings around each figure (0 = in front of it) and whether the shot is of the head */
const SHOTS: Record<View, { a: number; up?: boolean; label: string }[]> = {
  face: [{ a: 0, label: '' }, { a: 0.62, label: ' ¾' }],
  bust: [{ a: 0, label: '' }, { a: 0.62, label: ' ¾' }],
  nape: [{ a: Math.PI, label: ' back' }, { a: Math.PI * 0.78, label: ' ¾ rear' }],
  full: [{ a: 0, label: '' }],
  back: [{ a: Math.PI, label: ' back' }],
  turn: [{ a: 0, label: '' }, { a: Math.PI / 2, label: ' L' }, { a: -Math.PI / 2, label: ' R' }, { a: Math.PI, label: ' back' }, { a: Math.PI * 0.78, label: ' ¾ rear' }],
  head: [{ a: Math.PI, label: ' back' }, { a: Math.PI / 2, label: ' L' }, { a: -Math.PI / 2, label: ' R' }, { a: Math.PI, up: true, label: ' top' }],
};
const shots = SHOTS[view];
const bust = view === 'bust' || view === 'nape';
const headShot = view === 'face' || view === 'head' || bust;
const zoom = Math.max(1, Math.min(4, Number(q.get('zoom')) || 1));
const TW = (headShot ? 230 : 170) * zoom;
const TH = (headShot ? 270 : 420) * zoom;

type Entry = { key: string; cast: AvatarCast };
async function entries(): Promise<Entry[]> {
  // ?casts=[{"key":"try","cast":{"id":"Female_Adult_17","skin":"#c99872"}}]: casts that aren't authored (yet)
  if (q.get('casts')) return JSON.parse(q.get('casts')!) as Entry[];
  if (q.get('set') === 'models' || q.get('set') === 'donors') {
    const index = (await (await fetch('/res/chars/index.json')).json()) as { avatars: Record<string, { sex: 'm' | 'f' }> };
    const names = q.get('ids')?.split(',') ?? Object.keys(index.avatars);
    // donors: each model's head on a plain scrubs body of its sex, as a head swap would wear it
    if (q.get('set') === 'donors') return names.map((id) => ({ key: id, cast: { id: index.avatars[id].sex === 'f' ? 'Medical_Female_01' : 'Medical_Male_04', head: id } }));
    return names.map((id) => ({ key: id, cast: { id } }));
  }
  const ids = (q.get('ids')?.split(',') ?? SETS[q.get('set') ?? 'all']()).filter((id) => CAST[id]);
  return ids.map((id) => ({ key: id, cast: CAST[id] }));
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !checkHoles, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setScissorTest(true);
const scene = new THREE.Scene();
const BG = new THREE.Color('#3a4046');
scene.background = BG;
// ?light=ward (default): ceiling panels, cool, from above and slightly in front; a floor bounce, a side
// fill. ?light=waiting: the waiting room's neutral-white panels straight overhead, harder, less fill
// (the game's own light is near-neutral: check final looks in the game itself)
const waiting = q.get('light') === 'waiting';
scene.add(new THREE.HemisphereLight(waiting ? '#f4f6fa' : '#e4ecf4', '#5a5650', waiting ? 0.8 : 1.3));
const key = new THREE.DirectionalLight(waiting ? '#f6f8ff' : '#f2f6ff', waiting ? 2.6 : 2.2);
key.position.set(0.4, 4, waiting ? 0.8 : 2.2);
scene.add(key);
const fill = new THREE.DirectionalLight('#ffe9d6', waiting ? 0.25 : 0.5);
fill.position.set(-3, 1.4, 1);
scene.add(fill);
const back = new THREE.DirectionalLight('#eef2f8', 0.9); // so heads seen from behind are lit too
back.position.set(0.2, 3, -3);
scene.add(back);

(window as unknown as { __lineup: unknown }).__lineup = { ready: false };

/** a surface's draw side, for the see-through check */
function sides(root: THREE.Object3D, side: THREE.Side | null, saved: Map<THREE.Material, THREE.Side>) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of [m.material].flat()) {
      if (side === null) {
        const s = saved.get(mat);
        if (s !== undefined && mat.side !== s) {
          mat.side = s;
          mat.needsUpdate = true;
        }
      } else {
        if (!saved.has(mat)) saved.set(mat, mat.side);
        if (mat.side !== side) {
          mat.side = side;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

async function main() {
  const list = await entries();
  const COLS = Math.min(list.length * shots.length, headShot ? 8 : 15);
  const ROWS = Math.ceil((list.length * shots.length) / COLS);
  renderer.setSize(COLS * TW, ROWS * TH);
  // far enough apart that a side view never looks through a neighbour
  const spacing = view === 'turn' || view === 'back' ? 14 : 4;
  const chars = list.map((e, i) => {
    const c = new AvatarCharacter(e.cast, { height: 1.74 });
    c.root.position.set(i * spacing, 0, 0);
    c.setPosture('stand');
    scene.add(c.root);
    return c;
  });
  const t0 = performance.now();
  while (chars.some((c) => !c.ready && !c.failed) && performance.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 100));
  // ?steps=40 lets eased things settle (lids, eyes); ?gaze=20,-5 turns everyone's eyes to a point that
  // many degrees to their left and up; ?speak=0.5 is mid-word at that voice level
  const steps = Math.max(1, Number(q.get('steps')) || 1);
  const gaze = q.get('gaze')?.split(',').map((d) => (Number(d) * Math.PI) / 180);
  const speak = Number(q.get('speak')) || 0;
  for (let s = 0; s < steps; s++)
    for (const c of chars) {
      if (gaze) c.lookAtPoint(new THREE.Vector3(c.root.position.x + Math.sin(gaze[0]) * 2, 1.6 + Math.tan(gaze[1] ?? 0) * 2, Math.cos(gaze[0]) * 2));
      c.speaking = speak;
      c.update(1 / 30, 0.5 + s / 30, false, 0);
    }
  if (q.get('paint') === 'head') {
    // outer side green, inner side red: red at a collar is a gap that shows the inside of the neck
    const green = new THREE.MeshBasicMaterial({ color: '#20e050', side: THREE.FrontSide, name: 'head' });
    const red = new THREE.MeshBasicMaterial({ color: '#ff2a2a', side: THREE.BackSide, name: 'head' });
    const blue = new THREE.MeshBasicMaterial({ color: '#2a6bff', side: THREE.DoubleSide, name: 'skin' });
    for (const c of chars) {
      const heads: THREE.SkinnedMesh[] = [];
      c.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && ((o as THREE.Mesh).material as THREE.Material).name === 'head' && heads.push(o as THREE.SkinnedMesh));
      for (const m of heads) {
        m.material = green;
        const inner = m.clone();
        inner.material = red;
        inner.bind(m.skeleton, m.bindMatrix);
        m.parent!.add(inner);
      }
      // the body's own skin filling a bare neckline (avatars.ts fillerOf): blue
      c.root.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).name === 'skin' && ((o as THREE.Mesh).material = blue));
    }
  }
  scene.updateMatrixWorld(true);
  const wrap = document.getElementById('wrap')!;
  const head = new THREE.Vector3();
  const cam = new THREE.PerspectiveCamera(headShot ? 17 : 26, TW / TH, 0.05, 60);
  const gl = renderer.getContext();
  const holes: { key: string; shot: string; frac: number; px: number }[] = [];
  let k = 0;
  chars.forEach((c, i) => {
    for (const s of shots) {
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      c.head.getWorldPosition(head);
      // bust: from the forehead to the middle of the chest (necklines, where head and body meet)
      const at = head.clone().add(new THREE.Vector3(0, bust ? -0.13 : headShot ? 0.03 : 0, 0));
      const dist = bust ? 1.6 : 0.95;
      if (headShot && s.up) {
        cam.position.set(at.x + 0.001, at.y + 0.95, at.z - 0.25);
        cam.lookAt(at);
      } else if (headShot) {
        cam.position.set(at.x + Math.sin(s.a) * dist, at.y + 0.02, at.z + Math.cos(s.a) * dist);
        cam.lookAt(at);
      } else {
        const x = c.root.position.x;
        cam.position.set(x + Math.sin(s.a) * 4.4, 1.0, Math.cos(s.a) * 4.4);
        cam.lookAt(x, 0.92, 0);
      }
      const y = (ROWS - 1 - row) * TH;
      renderer.setViewport(col * TW, y, TW, TH);
      renderer.setScissor(col * TW, y, TW, TH);
      if (checkHoles && (view === 'head' || bust)) {
        // head views: the skull's square on screen (the head bone sits at its base; the skull is ~0.2 m
        // across), not inside a collar. Bust views: the neck and the top of the chest, where a worn head
        // meets the outfit
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        const skull = head.clone().add(new THREE.Vector3(0, bust ? -0.12 : 0.09, 0));
        const p = skull.clone().project(cam);
        const half = Math.round(((bust ? 0.12 : s.up ? 0.09 : 0.11) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.distanceTo(skull))) * TH);
        const cx = Math.round(((p.x + 1) / 2) * TW);
        const cy = Math.round(((p.y + 1) / 2) * TH);
        const rx = Math.max(0, cx - half);
        const ry = Math.max(0, cy - half);
        const rw = Math.max(1, Math.min(TW, cx + half) - rx);
        const rh = Math.max(1, Math.min(TH, cy + half) - ry);
        const read = () => {
          const buf = new Uint8Array(rw * rh * 4);
          gl.readPixels(col * TW + rx, y + ry, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return buf;
        };
        const magenta = (b: Uint8Array, j: number) => b[j] > 200 && b[j + 1] < 60 && b[j + 2] > 200;
        scene.background = new THREE.Color('#ff00ff');
        renderer.toneMapping = THREE.NoToneMapping;
        // what the game shows (the whole figure: a hood or a collar may cover a head's open edges), against
        // the head alone drawn double-sided (a collar seen from above is no part of a head) — or, at a
        // neckline, the whole figure double-sided (the inside of a tunic seen where skin should be)
        renderer.render(scene, cam);
        const asGame = read();
        const hidden: THREE.Object3D[] = [];
        c.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!bust && m.isMesh && m.visible && !['head', 'hair', 'glasses'].includes((m.material as THREE.Material).name)) {
            m.visible = false;
            hidden.push(m);
          }
        });
        const saved = new Map<THREE.Material, THREE.Side>();
        sides(c.root, THREE.DoubleSide, saved);
        renderer.render(scene, cam);
        const solid = read();
        sides(c.root, null, saved);
        for (const m of hidden) m.visible = true;
        let covered = 0;
        let through = 0;
        // ?mark=1: paint the see-through pixels green over the tile
        const marks = q.get('mark') ? new ImageData(rw, rh) : null;
        for (let j = 0; j < solid.length; j += 4) {
          if (magenta(solid, j)) continue;
          covered++;
          if (magenta(asGame, j)) {
            through++;
            if (marks) {
              const p = j / 4;
              const o = ((rh - 1 - Math.floor(p / rw)) * rw + (p % rw)) * 4; // GL rows run bottom-up
              marks.data.set([40, 255, 80, 255], o);
            }
          }
        }
        if (marks && through) {
          const cv = document.createElement('canvas');
          cv.width = rw;
          cv.height = rh;
          cv.getContext('2d')!.putImageData(marks, 0, 0);
          Object.assign(cv.style, { position: 'absolute', left: `${col * TW + rx}px`, top: `${row * TH + (TH - ry - rh)}px`, pointerEvents: 'none', outline: '1px dashed #3f8' });
          document.getElementById('wrap')!.appendChild(cv);
        }
        holes.push({ key: list[i].key, shot: s.label.trim(), frac: covered ? through / covered : 0, px: through });
        scene.background = BG;
        renderer.toneMapping = THREE.NeutralToneMapping;
      }
      renderer.render(scene, cam);
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = `${list[i].key}${s.label}${q.get('set') === 'models' ? '' : ` · ${faceOf(list[i].cast).replace(/_Adult|_Female|_Male/g, '')}`}${c.failed ? ' (failed)' : ''}`;
      l.style.left = `${col * TW + 4}px`;
      l.style.top = `${row * TH + 4}px`;
      wrap.appendChild(l);
      k++;
    }
  });
  (window as unknown as { __lineup: unknown }).__lineup = { ready: true, ids: list.map((e) => e.key), failed: chars.filter((c) => c.failed).length, holes };
  // for scripted checks from the console / Playwright
  Object.assign(window, { __lineupScene: { THREE, scene, chars: chars.map((c, i) => ({ key: list[i].key, root: c.root })) } });
}
void main();

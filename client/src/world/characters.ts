/**
 * Characters. The default is a realistic animated avatar (avatars.ts); the stylized
 * procedural low-poly human below is the fallback (no WebGL assets, ?avatars=0, load failure).
 * Joints: hips → thighs → knees → shins; torso → shoulders → elbows; torso → neck/head.
 */
import * as THREE from 'three';
import type { Appearance, Emotion, NpcRole, Posture } from '../../../shared/types';
import type { Mouth } from '../ui/visemes';
import { AvatarCharacter } from './avatars';
import { castFor } from './casting';
import { G, add, lambert } from './materials';

export interface Character {
  root: THREE.Group;
  height: number;
  /** label anchor: the head bone for realistic avatars */
  head: THREE.Object3D;
  posture: Posture;
  emotion?: Emotion;
  /** set the resting posture; walking is driven by update(moving=true) */
  setPosture(p: Posture, surfaceY?: number, seatY?: number): void;
  /** advance animation; speed in m/s when moving */
  update(dt: number, t: number, moving: boolean, speed: number): void;
  /** desired head yaw relative to the body (look at someone), radians */
  lookYaw: number;
  /** a point for the eyes to look at (world), or null: straight ahead (realistic avatars) */
  lookAtPoint?(p: THREE.Vector3 | null): void;
  /** the mouth shape of the word being said (ui/visemes.ts), or null: unknown (realistic avatars) */
  mouth?: Mouth | null;
  /** 0..1 voice level while this character is talking (drives gestures / nods) */
  speaking?: number;
  /** what kind of seat a sitting character uses (desk = typing pose) */
  seatKind?: 'chair' | 'desk' | 'sofa' | 'bed';
  dispose?(): void;
  /** world position of the right hand (realistic avatars) */
  handWorld?(out: THREE.Vector3): THREE.Vector3 | null;
  /** 1 while in the air (jumping, dropping off a step): legs tuck; 0 on the ground */
  airborne?: number;
}

export interface CharacterSpec {
  /** NPC id ('player' for the player's own avatar) */
  id: string;
  role: NpcRole | 'player';
  appearance: Appearance;
  sex?: 'm' | 'f';
}

/**
 * Realistic avatar for an NPC (see avatars.ts / casting.ts). Falls back to the stylized
 * procedural body when ?avatars=0 is set or the model cannot be loaded.
 */
export function createCharacter(spec: CharacterSpec): Character {
  if (new URLSearchParams(location.search).get('avatars') === '0') return createProceduralCharacter(spec.appearance);
  const cast = castFor(spec.id, spec.role, spec.appearance, spec.sex);
  const av = new AvatarCharacter(cast, {
    height: spec.appearance.height,
    old: spec.appearance.age === 'old',
    onReady: () => {
      if (!av.failed) return;
      // swap in the procedural body if the GLB failed
      const fb = createProceduralCharacter(spec.appearance);
      av.root.add(fb.root);
      Object.assign(av, { head: fb.head, update: fb.update.bind(fb), setPosture: fb.setPosture.bind(fb) });
    },
  });
  return av;
}

const SLEEVES: Record<Appearance['outfit'], 'short' | 'long'> = {
  scrubs: 'short',
  gown: 'short',
  casual: 'long',
  coat: 'long',
  ems: 'long',
  uniform: 'short',
  suit: 'long',
};

export function createProceduralCharacter(a: Appearance): Character {
  const H = Math.min(2.0, Math.max(1.45, a.height || 1.72));
  const bk = a.build === 'heavy' ? 1.22 : a.build === 'slim' ? 0.9 : 1.0;
  const old = a.age === 'old';
  const hipY = 0.475 * H;
  const thighL = 0.24 * H;
  const shinL = hipY - thighL - 0.045;
  const torsoL = 0.3 * H;
  const headR = 0.074 * H;
  const neckL = 0.035 * H;
  const shoulderX = 0.112 * H * (0.88 + 0.12 * bk);
  const hipX = 0.052 * H * (0.9 + 0.1 * bk);
  const legR = 0.037 * H * Math.sqrt(bk);
  const armR = 0.026 * H * Math.sqrt(bk);
  const upperArmL = 0.165 * H;
  const foreArmL = 0.15 * H;
  const torsoR = 0.104 * H * bk;

  const skin = lambert(a.skin);
  const hairM = lambert(a.hair, { flat: a.hairStyle === 'curly' });
  const outfitC = a.outfitColor;
  let topC = outfitC;
  let pantsC = a.pantsColor ?? outfitC;
  let shoeC = '#2a2a2a';
  let coatC: string | null = null;
  let skirt = false;
  let stripes = false;
  switch (a.outfit) {
    case 'scrubs':
      shoeC = '#e9eaeb';
      break;
    case 'gown':
      pantsC = a.skin;
      shoeC = '#e8c547'; // non-slip hospital socks
      skirt = true;
      break;
    case 'casual':
      pantsC = a.pantsColor ?? '#3b4a63';
      shoeC = '#efefef';
      break;
    case 'coat':
      coatC = outfitC;
      topC = a.pantsColor ?? '#cfe0f2';
      pantsC = a.pantsColor ?? '#2b3a55';
      shoeC = '#2b2b2b';
      break;
    case 'ems':
      topC = outfitC || '#1e2a44';
      pantsC = a.pantsColor ?? topC;
      stripes = true;
      shoeC = '#151515';
      break;
    case 'uniform':
      pantsC = a.pantsColor ?? '#2b2f36';
      shoeC = '#151515';
      break;
    case 'suit':
      pantsC = a.pantsColor ?? outfitC;
      shoeC = '#151515';
      break;
  }
  const topM = lambert(topC);
  const pantsM = lambert(pantsC);
  const shoeM = lambert(shoeC);
  const coatM = coatC ? lambert(coatC) : null;
  const sleeveM = coatM ?? topM;
  const longSleeves = SLEEVES[a.outfit] === 'long';

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = hipY;
  body.add(hips);

  // pelvis
  add(hips, G.capsule(hipX + legR * 0.6, 0.02, 3, 8), skirt ? topM : pantsM, 0, 0.0, 0, 0, 0, Math.PI / 2).scale.set(1, 1, 0.75);

  // legs
  const mkLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * hipX, 0, 0);
    hips.add(hip);
    add(hip, G.capsule(legR, Math.max(0.01, thighL - legR), 3, 8), pantsM, 0, -thighL / 2, 0);
    const knee = new THREE.Group();
    knee.position.y = -thighL;
    hip.add(knee);
    add(knee, G.capsule(legR * 0.86, Math.max(0.01, shinL - legR * 0.8), 3, 8), skirt ? skin : pantsM, 0, -shinL / 2, 0);
    if (stripes) add(knee, G.cyl(legR * 0.95, legR * 0.95, 0.035, 8), lambert('#d9e021', { emissive: '#4a4d07' }), 0, -shinL * 0.45, 0);
    add(knee, G.box(legR * 2.1, 0.06, legR * 3.6), shoeM, 0, -shinL - 0.012, legR * 0.7);
    return { hip, knee };
  };
  const L = mkLeg(-1);
  const R = mkLeg(1);

  // torso
  const torso = new THREE.Group();
  hips.add(torso);
  const torsoMesh = add(torso, G.cyl(torsoR, torsoR * 0.9, torsoL * 0.92, 10), topM, 0, torsoL * 0.46, 0);
  torsoMesh.scale.set(1.32, 1, 0.78);
  add(torso, G.capsule(armR * 1.35, shoulderX * 2 - armR * 1.6, 3, 8), coatM ?? topM, 0, torsoL - armR * 0.8, 0, 0, 0, Math.PI / 2);
  if (skirt) {
    const sk = add(torso, G.cyl(torsoR * 1.05, torsoR * 1.32, 0.2 * H, 10), topM, 0, -0.08 * H, 0);
    sk.scale.set(1.25, 1, 0.82);
  }
  if (coatM) {
    const shell = add(torso, G.cyl(torsoR * 1.07, torsoR * 1.02, torsoL * 0.94, 10), coatM, 0, torsoL * 0.47, -0.004);
    shell.scale.set(1.34, 1, 0.8);
    const tails = add(torso, G.cyl(torsoR * 1.06, torsoR * 1.25, 0.21 * H, 10), coatM, 0, -0.095 * H, -0.004);
    tails.scale.set(1.3, 1, 0.82);
    // open front showing the scrubs/shirt underneath
    add(torso, G.box(torsoR * 0.55, torsoL * 0.55, 0.02), topM, 0, torsoL * 0.62, torsoR * 0.78);
    // pocket + pen
    add(torso, G.box(torsoR * 0.42, torsoR * 0.32, 0.01), lambert('#e6e6e6'), -torsoR * 0.7, torsoL * 0.55, torsoR * 0.79);
    add(torso, G.box(0.008, 0.05, 0.008), lambert('#2a62c9'), -torsoR * 0.62, torsoL * 0.62, torsoR * 0.8);
  }
  if (stripes) {
    const band = add(torso, G.cyl(torsoR * 1.01, torsoR * 1.01, 0.04, 10), lambert('#d9e021', { emissive: '#4a4d07' }), 0, torsoL * 0.35, 0);
    band.scale.set(1.33, 1, 0.79);
  }
  if (a.outfit === 'suit') add(torso, G.box(torsoR * 0.45, torsoL * 0.4, 0.02), lambert('#f2f2f2'), 0, torsoL * 0.7, torsoR * 0.77);
  if (a.outfit === 'scrubs') add(torso, G.box(torsoR * 0.35, torsoL * 0.16, 0.012), skin, 0, torsoL * 0.88, torsoR * 0.77, 0, 0, Math.PI / 4).scale.set(1, 1, 1);

  // neck + head
  add(torso, G.cyl(0.03 * H, 0.033 * H, neckL + 0.02, 8), skin, 0, torsoL + neckL / 2, 0);
  const head = new THREE.Group();
  head.position.y = torsoL + neckL + headR * 0.92;
  torso.add(head);
  const skull = add(head, G.sphere(headR, 14, 11), skin, 0, 0, 0);
  skull.scale.set(0.93, 1.05, 0.98);
  const eyeM = lambert('#1d1d1f');
  for (const s of [-1, 1]) add(head, G.sphere(headR * 0.1, 6, 5), eyeM, s * headR * 0.34, headR * 0.06, headR * 0.9);
  add(head, G.sphere(headR * 0.13, 6, 5), skin, 0, -headR * 0.12, headR * 0.98).scale.set(0.8, 1, 0.8); // nose nub
  for (const s of [-1, 1]) add(head, G.sphere(headR * 0.2, 6, 5), skin, s * headR * 0.92, 0, 0).scale.set(0.45, 1, 0.8); // ears

  const hasCap = a.accessories?.includes('cap');
  // hair
  const capHair = (rad: number, mat: THREE.Material, upish = 0.3, back = 0.15) => {
    const m = add(head, G.sphere(headR * rad, 14, 10), mat, 0, headR * upish, -headR * back);
    m.scale.set(1, 0.92, 1.02);
    return m;
  };
  if (hasCap) {
    capHair(1.08, lambert('#4e7ab5'), 0.32, 0.12);
  } else {
    switch (a.hairStyle) {
      case 'short':
        capHair(1.07, hairM);
        break;
      case 'buzz':
        capHair(1.025, hairM, 0.25, 0.12);
        break;
      case 'bald':
        if (old) {
          const ring = add(head, G.torus(headR * 0.86, headR * 0.16, 6, 16, Math.PI * 1.2), hairM, 0, -headR * 0.05, -headR * 0.1, Math.PI / 2, 0, Math.PI * 0.9);
          ring.scale.set(1, 1, 1);
        }
        break;
      case 'long':
        capHair(1.08, hairM);
        add(head, G.box(headR * 1.75, headR * 2.1, headR * 0.55), hairM, 0, -headR * 0.75, -headR * 0.62);
        break;
      case 'bun':
        capHair(1.07, hairM);
        add(head, G.sphere(headR * 0.42, 10, 8), hairM, 0, headR * 0.62, -headR * 0.86);
        break;
      case 'ponytail':
        capHair(1.07, hairM);
        add(head, G.capsule(headR * 0.2, headR * 1.1, 3, 8), hairM, 0, -headR * 0.35, -headR * 1.12, 0.25, 0, 0);
        break;
      case 'curly': {
        capHair(1.14, hairM, 0.34, 0.12);
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2;
          add(head, G.sphere(headR * 0.42, 6, 5), hairM, Math.cos(ang) * headR * 0.78, headR * (0.62 + 0.1 * Math.sin(ang * 2)), Math.sin(ang) * headR * 0.7 - headR * 0.18);
        }
        break;
      }
    }
  }
  // accessories
  const acc = new Set(a.accessories ?? []);
  if (acc.has('beard')) {
    const b = add(head, G.sphere(headR * 0.62, 10, 8), hairM, 0, -headR * 0.5, headR * 0.42);
    b.scale.set(1.25, 0.95, 0.85);
  }
  if (acc.has('glasses')) {
    const gm = lambert('#2a2a2a');
    for (const s of [-1, 1]) add(head, G.torus(headR * 0.2, headR * 0.035, 5, 12), gm, s * headR * 0.36, headR * 0.06, headR * 0.98);
    add(head, G.box(headR * 0.3, headR * 0.05, headR * 0.05), gm, 0, headR * 0.1, headR * 1.0);
  }
  if (acc.has('mask')) {
    const mk = add(head, G.box(headR * 1.35, headR * 0.75, headR * 0.5), lambert('#a9d3ea'), 0, -headR * 0.42, headR * 0.72);
    mk.scale.set(1, 1, 1);
  }
  if (acc.has('stethoscope')) {
    const sm = lambert('#2c3136');
    add(torso, G.torus(0.055 * H, 0.008 * H, 6, 18, Math.PI * 1.1), sm, 0, torsoL + 0.005, 0.01, Math.PI / 2 - 0.25, 0, Math.PI * 0.95);
    for (const s of [-1, 1]) add(torso, G.cyl(0.006 * H, 0.006 * H, torsoL * 0.38, 6), sm, s * 0.045 * H, torsoL * 0.73, torsoR * 0.8);
    add(torso, G.cyl(0.018 * H, 0.018 * H, 0.012, 10), lambert('#c9ced2'), 0.045 * H, torsoL * 0.52, torsoR * 0.82, Math.PI / 2, 0, 0);
  }
  if (acc.has('badge')) add(torso, G.box(0.04 * H, 0.05 * H, 0.008), lambert('#f5f5f5'), torsoR * 0.55, torsoL * 0.72, torsoR * 0.8);

  // arms
  const mkArm = (side: number) => {
    const sh = new THREE.Group();
    sh.position.set(side * shoulderX, torsoL - armR * 1.1, 0);
    torso.add(sh);
    add(sh, G.capsule(armR * 1.08, Math.max(0.01, upperArmL - armR), 3, 8), sleeveM, 0, -upperArmL / 2, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -upperArmL;
    sh.add(elbow);
    add(elbow, G.capsule(armR * 0.92, Math.max(0.01, foreArmL - armR), 3, 8), longSleeves ? sleeveM : skin, 0, -foreArmL / 2, 0);
    if (stripes) add(elbow, G.cyl(armR, armR, 0.03, 8), lambert('#d9e021', { emissive: '#4a4d07' }), 0, -foreArmL * 0.3, 0);
    add(elbow, G.sphere(armR * 1.15, 8, 6), skin, 0, -foreArmL - armR * 0.6, 0);
    return { sh, elbow };
  };
  const LA = mkArm(-1);
  const RA = mkArm(1);

  // contact shadow
  const shadow = new THREE.Mesh(G.circle(0.34 * (0.9 + 0.1 * bk), 20), lambert('#000000', { opacity: 0.22 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  const stoop = old ? 0.13 : 0;
  const headTopY = hipY + torsoL + neckL + headR * 1.9;
  let posture: Posture = 'stand';
  let surfaceY = 0.64;
  let seatY = 0.47;
  let walkPhase = Math.random() * 10;
  let headYaw = 0;

  const ch: Character = {
    root,
    height: H,
    head,
    posture,
    emotion: undefined,
    lookYaw: 0,
    setPosture(p, sY, seY) {
      posture = p;
      ch.posture = p;
      if (sY !== undefined) surfaceY = sY;
      if (seY !== undefined) seatY = seY;
    },
    update(dt, t, moving, speed) {
      // reset
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      torso.rotation.set(stoop, 0, 0);
      torso.scale.set(1, 1, 1);
      L.hip.rotation.set(0, 0, 0);
      R.hip.rotation.set(0, 0, 0);
      L.knee.rotation.set(0, 0, 0);
      R.knee.rotation.set(0, 0, 0);
      LA.sh.rotation.set(0, 0, -0.07);
      RA.sh.rotation.set(0, 0, 0.07);
      LA.elbow.rotation.set(-0.12, 0, 0);
      RA.elbow.rotation.set(-0.12, 0, 0);
      head.rotation.set(0, 0, 0);
      shadow.visible = true;
      const emo = ch.emotion;
      const breath = Math.sin(t * (emo === 'anxious' || emo === 'pain' ? 3.2 : 1.7)) * 0.012;
      // smooth head look
      headYaw += (Math.max(-0.9, Math.min(0.9, ch.lookYaw)) - headYaw) * Math.min(1, dt * 4);

      if (moving) {
        const freq = speed / (0.62 * 2);
        walkPhase += dt * Math.PI * 2 * freq;
        const s = Math.sin(walkPhase);
        const amp = Math.min(0.55, 0.3 + speed * 0.12) * (old ? 0.75 : 1);
        L.hip.rotation.x = s * amp;
        R.hip.rotation.x = -s * amp;
        L.knee.rotation.x = Math.max(0, -Math.sin(walkPhase - 0.6)) * amp * 1.3;
        R.knee.rotation.x = Math.max(0, Math.sin(walkPhase - 0.6)) * amp * 1.3;
        LA.sh.rotation.x = -s * amp * 0.75;
        RA.sh.rotation.x = s * amp * 0.75;
        LA.elbow.rotation.x = -0.25;
        RA.elbow.rotation.x = -0.25;
        body.position.y = Math.abs(Math.cos(walkPhase)) * 0.025;
        head.rotation.y = 0;
        headYaw *= 0.9;
      } else if (posture === 'sit') {
        body.position.set(0, seatY + 0.035 - hipY, -0.06);
        L.hip.rotation.x = -Math.PI / 2 + 0.05;
        R.hip.rotation.x = -Math.PI / 2 + 0.05;
        L.knee.rotation.x = Math.PI / 2 - 0.05;
        R.knee.rotation.x = Math.PI / 2 - 0.05;
        L.hip.rotation.z = 0.05;
        R.hip.rotation.z = -0.05;
        LA.sh.rotation.x = -0.45;
        RA.sh.rotation.x = -0.45;
        LA.elbow.rotation.x = -0.75;
        RA.elbow.rotation.x = -0.75;
        torso.scale.y = 1 + breath;
        head.rotation.y = headYaw;
        if (emo === 'pain') {
          RA.sh.rotation.set(-0.45, -0.95, -0.05);
          RA.elbow.rotation.x = -1.95;
        }
      } else if (posture === 'lie') {
        shadow.visible = false;
        const headCenterY = hipY + torsoL + neckL + headR * 0.92;
        body.rotation.x = -Math.PI / 2;
        body.position.set(0, surfaceY + 0.085 * bk + 0.02, -0.74 + headCenterY);
        torso.rotation.x = 0;
        head.rotation.x = 0.22;
        torso.scale.z = 1 + breath * 1.5;
        LA.sh.rotation.set(0, 0, -0.12);
        RA.sh.rotation.set(0, 0, 0.12);
        if (emo === 'pain') {
          RA.sh.rotation.set(-0.3, -1.0, -0.05);
          RA.elbow.rotation.x = -2.05;
        }
        if (emo === 'confused' || emo === 'drowsy') head.rotation.z = 0.25 + Math.sin(t * 0.4) * 0.15;
        else head.rotation.y = headYaw * 0.6;
      } else {
        // stand idle
        torso.scale.y = 1 + breath;
        head.rotation.y = headYaw + Math.sin(t * 0.37 + walkPhase) * 0.08;
        if (emo === 'pain') {
          RA.sh.rotation.set(-0.4, -0.95, -0.05);
          RA.elbow.rotation.x = -1.95;
        } else if (emo === 'anxious') {
          head.rotation.y += Math.sin(t * 1.3) * 0.12;
        }
        if (emo === 'confused' || emo === 'drowsy') head.rotation.z = 0.18;
      }
    },
  };
  void headTopY;
  return ch;
}

/** World-space anchor slightly above the head (for labels/bubbles). */
export function headAnchor(ch: Character, out: THREE.Vector3): THREE.Vector3 {
  ch.head.getWorldPosition(out);
  out.y += ch.height * 0.11 + 0.12;
  return out;
}

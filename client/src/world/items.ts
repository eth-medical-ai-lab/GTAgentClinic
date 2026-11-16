/**
 * Things lying around the ED — GTA-style: walk up, [E] pick up, [F] inspect up close (drag to
 * rotate), [G] put it down where you look. Big equipment can be inspected in place.
 *
 *  - decor items: clipboards, mugs, specimen tubes, BVMs… scattered on counters, desks, carts,
 *    bedside tables and waiting-room chairs (client-side, cosmetic, but every one has a real
 *    description — many teach something)
 *  - case items: a patient's belongings from the server (PlayerView.items). Inspecting one calls
 *    the server's `inspect` action, whose findings count as history (same action AI agents use).
 *  - fixtures: crash cart, wheelchair, infusion pump… inspectable in place (FIXTURE_INFO)
 *
 * All items are built procedurally at real-world size (meters), origin at the bottom center.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LayoutDef, PropDef } from '../../../shared/layout';
import { G, add, canvasTexture, glass, lambert, makeCanvas, own, pbr, rboxB, trackGeo, tube } from './materials';
import { RESUS_INFO } from './resusGear';
import { IMAGING_INFO } from './imaging';

export interface ItemSpec {
  label: string;
  desc: string;
  pickable: boolean;
  build: () => THREE.Group;
}

// ───────────────────────────── small helpers ─────────────────────────────

const plastic = (c: string, r = 0.4) => lambert(c, { roughness: r });
const metal = (c = '#c9ced2', r = 0.28) => lambert(c, { roughness: r, metalness: 0.9 });
const paper = () => lambert('#f6f5f0', { roughness: 0.9 });

function labelTex(lines: string[], bg: string, fg: string, w = 256, h = 128, accent?: string): THREE.MeshStandardMaterial {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, Math.round(h * 0.24));
  }
  ctx.fillStyle = fg;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    const size = i === 0 ? Math.round(h * 0.17) : Math.round(h * 0.12);
    ctx.font = `${i === 0 ? 800 : 600} ${size}px ui-sans-serif, system-ui, Arial, sans-serif`;
    ctx.fillStyle = i === 0 && accent ? '#ffffff' : fg;
    ctx.fillText(l, w * 0.06, h * (i === 0 ? 0.04 : 0.3 + (i - 1) * 0.17), w * 0.9);
  });
  return own(new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: 0.6 }));
}

function lathe(points: [number, number][], mat: THREE.Material, seg = 24): THREE.Mesh {
  return new THREE.Mesh(trackGeo(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg)), mat);
}

const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
};

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

// ───────────────────────────── item catalog ─────────────────────────────

export const ITEM_KINDS: Record<string, ItemSpec> = {
  coffeeMug: {
    label: 'coffee mug',
    desc: 'Lukewarm coffee, about a third left. "WORLD\'S OKAYEST RESIDENT" printed on the side.',
    pickable: true,
    build: () => {
      const m = lathe([[0, 0], [0.04, 0], [0.042, 0.004], [0.043, 0.095], [0.039, 0.095], [0.038, 0.01], [0, 0.01]], plastic('#f2f2ee', 0.25));
      const coffee = at(new THREE.Mesh(G.circle(0.038, 20), lambert('#3a2414', { roughness: 0.15 })), 0, 0.065, 0, -Math.PI / 2);
      const handle = at(new THREE.Mesh(G.torus(0.024, 0.006, 8, 16, Math.PI), plastic('#f2f2ee', 0.25)), 0.043, 0.05, 0, 0, 0, -Math.PI / 2);
      return group(m, coffee, handle);
    },
  },
  paperCup: {
    label: 'paper coffee cup',
    desc: 'Cafeteria coffee with a plastic lid. Someone wrote "Rosa — DO NOT TOUCH" on the sleeve.',
    pickable: true,
    build: () => {
      const cup = lathe([[0, 0], [0.028, 0], [0.04, 0.12], [0, 0.12]], paper());
      const sleeve = lathe([[0.031, 0.03], [0.038, 0.085], [0.036, 0.085], [0.029, 0.03]], lambert('#9c6b3d', { roughness: 0.9 }));
      const lid = at(new THREE.Mesh(G.cyl(0.042, 0.042, 0.012, 20), plastic('#f4f4f4', 0.3)), 0, 0.124, 0);
      return group(cup, sleeve, lid);
    },
  },
  clipboard: {
    label: 'clipboard',
    desc: 'Nursing flowsheet: hourly vitals and I/O columns, half filled in. A sticky note: "Bed 4 — no temp at triage!!"',
    pickable: true,
    build: () => {
      const board = rboxB(new THREE.Group(), 0.23, 0.006, 0.32, 0.004, lambert('#8a5a34', { roughness: 0.6 }), 0, 0, 0);
      const sheet = at(new THREE.Mesh(G.plane(0.21, 0.28), labelTex(['NURSING FLOWSHEET', 'Time   HR   BP   SpO2  T', '22:00  88  132/80  97  —', '22:15  92  128/76  96  —', '22:30  ', 'I/O:'], '#fbfbf7', '#30363b', 256, 340, '#2c6e8f')), 0, 0.0065, 0.01, -Math.PI / 2);
      const clip = rboxB(new THREE.Group(), 0.09, 0.012, 0.03, 0.004, metal(), 0, 0.006, -0.14);
      return group(board, sheet, clip);
    },
  },
  pen: {
    label: 'pen',
    desc: 'A drug-company pen. The cap has been chewed.',
    pickable: true,
    build: () => group(at(new THREE.Mesh(G.cyl(0.0045, 0.0045, 0.14, 10), plastic('#1f4f9f', 0.3)), 0, 0.0045, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.box(0.03, 0.002, 0.004), metal()), 0.04, 0.009, 0)),
  },
  stethoscope: {
    label: 'stethoscope',
    desc: 'A cardiology stethoscope someone left behind. Diaphragm for high-pitched sounds (S1/S2, murmurs of AR/MR), bell — light pressure — for low-pitched S3/S4 and mitral stenosis.',
    pickable: true,
    build: () => {
      const tubeM = lambert('#20262b', { roughness: 0.5 });
      const t1 = tube(new THREE.Group(), [[-0.12, 0.008, 0.02], [-0.05, 0.008, 0.09], [0.05, 0.008, 0.07], [0.1, 0.008, -0.02], [0.03, 0.008, -0.1], [-0.06, 0.008, -0.06]], 0.0045, tubeM, 40, 6);
      const chest = at(new THREE.Mesh(G.cyl(0.022, 0.022, 0.012, 20), metal('#d5d9dc', 0.2)), -0.14, 0.006, 0.0);
      const ear = tube(new THREE.Group(), [[-0.06, 0.008, -0.06], [-0.1, 0.008, -0.1], [-0.08, 0.008, -0.15]], 0.0025, metal(), 12, 6);
      return group(t1, chest, ear);
    },
  },
  gloveBox: {
    label: 'box of nitrile gloves',
    desc: 'Nitrile exam gloves, size M, powder-free. Latex-free (check the allergy list anyway).',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.24, 0.09, 0.125, 0.005, labelTex(['NITRILE EXAM GLOVES', 'Size M · powder-free · 100'], '#e9eef7', '#2a3a66', 256, 128, '#3d63b8'), 0, 0, 0), at(new THREE.Mesh(G.box(0.06, 0.012, 0.04), lambert('#7b6be0', { roughness: 0.7 })), 0, 0.092, 0)),
  },
  sanitizer: {
    label: 'hand sanitizer',
    desc: 'Alcohol-based hand rub (70% ethanol). WHO\'s five moments: before touching a patient, before aseptic tasks, after body-fluid exposure, after touching a patient, after touching their surroundings. It does not kill C. difficile spores — wash with soap and water for that.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.032, 0], [0.033, 0.13], [0.012, 0.15], [0, 0.15]], plastic('#e9f3f5', 0.2)), at(new THREE.Mesh(G.cyl(0.007, 0.007, 0.03, 8), plastic('#2bb3a3')), 0, 0.165, 0), at(new THREE.Mesh(G.box(0.03, 0.006, 0.01), plastic('#2bb3a3')), 0.012, 0.18, 0)),
  },
  syringe: {
    label: '10 mL syringe',
    desc: 'Sterile 10 mL Luer-lock syringe, still in its peel pack. Pre-filled saline flushes are in the drawer below.',
    pickable: true,
    build: () => group(at(new THREE.Mesh(G.cyl(0.008, 0.008, 0.1, 12), glass('#f4fbff', 0.5)), 0, 0.008, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.003, 0.003, 0.06, 8), plastic('#ffffff')), -0.075, 0.008, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.003, 0.002, 0.02, 8), plastic('#2a62c9')), 0.06, 0.008, 0, 0, 0, Math.PI / 2)),
  },
  salineBag: {
    label: 'bag of normal saline',
    desc: '0.9% sodium chloride, 1000 mL. Na⁺ 154, Cl⁻ 154 mmol/L — large volumes cause hyperchloremic acidosis; balanced crystalloids (Ringer\'s lactate) are often preferred in sepsis.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.13, 0.02, 0.22, 0.008, glass('#eaf6fb', 0.6), 0, 0, 0), at(new THREE.Mesh(G.plane(0.09, 0.12), labelTex(['0.9% NaCl', '1000 mL', 'Sodium Chloride Inj. USP'], '#ffffff', '#1d3557', 160, 200, '#1d6fb8')), 0, 0.0205, 0.0, -Math.PI / 2)),
  },
  specimenTubes: {
    label: 'rack of blood tubes',
    desc: 'Order of draw: blood cultures → light blue (citrate: PT/INR) → gold (SST: chemistry) → green (lithium heparin: electrolytes, troponin) → lavender (EDTA: CBC) → grey (fluoride: lactate/glucose). Mislabelled tubes are the most common lab error.',
    pickable: true,
    build: () => {
      const g = group(rboxB(new THREE.Group(), 0.16, 0.035, 0.05, 0.005, plastic('#e8e8e8'), 0, 0, 0));
      ['#8fb8e8', '#e0b23c', '#3d9a4f', '#8e5ec4', '#8a8f94'].forEach((c, i) => {
        g.add(at(new THREE.Mesh(G.cyl(0.0065, 0.0065, 0.09, 10), glass('#fbe9e9', 0.7)), -0.06 + i * 0.03, 0.06, 0));
        g.add(at(new THREE.Mesh(G.cyl(0.0075, 0.0075, 0.016, 10), plastic(c, 0.3)), -0.06 + i * 0.03, 0.108, 0));
      });
      return g;
    },
  },
  urineCup: {
    label: 'specimen cup',
    desc: 'Sterile urine specimen cup. Clean-catch midstream; a straight-catheter sample is better in a confused older patient.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.03, 0], [0.033, 0.075], [0, 0.075]], glass('#f6fbff', 0.6)), at(new THREE.Mesh(G.cyl(0.036, 0.036, 0.014, 20), plastic('#e2c13a', 0.3)), 0, 0.082, 0)),
  },
  tissueBox: {
    label: 'box of tissues',
    desc: 'Tissues. Families need these more often than you\'d think.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.22, 0.09, 0.115, 0.006, lambert('#9cc6d8', { roughness: 0.8 }), 0, 0, 0), at(new THREE.Mesh(G.sphere(0.035, 8, 6), paper()), 0, 0.1, 0)),
  },
  waterCup: {
    label: 'cup of water',
    desc: 'A plastic cup of water with a bendy straw. Check the NPO status before handing it to a patient.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.028, 0], [0.034, 0.1], [0, 0.1]], glass('#f2fbff', 0.35)), at(new THREE.Mesh(G.cyl(0.03, 0.03, 0.065, 16), glass('#d8f0ff', 0.45)), 0, 0.035, 0), tube(new THREE.Group(), [[0.01, 0.02, 0], [0.012, 0.13, 0], [0.03, 0.15, 0]], 0.002, plastic('#e04f6f'), 8, 5)),
  },
  kidneyDish: {
    label: 'emesis basin',
    desc: 'Kidney-shaped emesis basin. If you are reaching for this, also think about antiemetics (ondansetron 4 mg IV) and aspiration risk.',
    pickable: true,
    build: () => {
      const shape = new THREE.Shape();
      shape.absellipse(0, 0, 0.12, 0.06, 0, Math.PI * 2, false, 0);
      const geo = trackGeo(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 }));
      geo.rotateX(-Math.PI / 2);
      return group(new THREE.Mesh(geo, plastic('#8fc6dc', 0.35)));
    },
  },
  phoneMobile: {
    label: 'mobile phone',
    desc: 'A staff mobile with a cracked screen protector. Locked. Seven missed calls from "Pharmacy".',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.075, 0.008, 0.155, 0.006, lambert('#15181b', { roughness: 0.25 }), 0, 0, 0), at(new THREE.Mesh(G.plane(0.068, 0.145), lambert('#0b2233', { roughness: 0.1, emissive: '#0b2233', emissiveIntensity: 0.4 })), 0, 0.0085, 0, -Math.PI / 2)),
  },
  magazine: {
    label: 'magazine',
    desc: 'A dog-eared health magazine from 2024: "10 SUPERFOODS THAT FIGHT INFLAMMATION". Someone did the crossword.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.21, 0.006, 0.28, 0.002, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.21, 0.28), labelTex(['HEALTH TODAY', '10 superfoods that', 'fight inflammation', 'Sleep better tonight'], '#f3e2c4', '#2b2b2b', 210, 280, '#c0392b')), 0, 0.0062, 0, -Math.PI / 2)),
  },
  waterBottle: {
    label: 'water bottle',
    desc: 'Half-empty 500 mL bottle of water. Not yours.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.032, 0], [0.033, 0.16], [0.012, 0.2], [0.012, 0.215], [0, 0.215]], glass('#dff1fb', 0.4)), at(new THREE.Mesh(G.cyl(0.013, 0.013, 0.02, 12), plastic('#2a62c9')), 0, 0.222, 0), at(new THREE.Mesh(G.cyl(0.0335, 0.0335, 0.05, 20), plastic('#4aa3df')), 0, 0.09, 0)),
  },
  binder: {
    label: 'binder',
    desc: '"ED POLICIES & PROCEDURES — rev. 2019". Chapter 7: sepsis bundle. Chapter 12: what to do when the computers go down (pens and paper requisitions).',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.06, 0.3, 0.27, 0.008, lambert('#1f4f7f', { roughness: 0.5 }), 0, 0, 0), at(new THREE.Mesh(G.plane(0.27, 0.06), labelTex(['ED POLICIES'], '#ffffff', '#1f2a3a', 256, 64)), 0.0305, 0.24, 0, 0, Math.PI / 2, Math.PI / 2)),
  },
  thermometer: {
    label: 'tympanic thermometer',
    desc: 'Infrared ear thermometer with disposable probe covers. Pull the ear up and back in adults. A missing temperature at triage is a classic miss in elderly sepsis.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.045, 0.03, 0.14, 0.012, plastic('#f2f4f6', 0.3), 0, 0, 0), at(new THREE.Mesh(G.cone(0.012, 0.035, 12), plastic('#e9eef2')), 0, 0.015, -0.085, -Math.PI / 2), at(new THREE.Mesh(G.plane(0.03, 0.02), lambert('#9fd7c6', { emissive: '#3fae8f', emissiveIntensity: 0.4 })), 0, 0.031, 0.01, -Math.PI / 2)),
  },
  pulseOx: {
    label: 'pulse oximeter',
    desc: 'Fingertip pulse oximeter. Reads falsely high in carbon-monoxide poisoning and can overestimate saturation in darker skin — trust a blood gas when it matters.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.035, 0.03, 0.06, 0.01, plastic('#2f6f9f', 0.35), 0, 0, 0), at(new THREE.Mesh(G.plane(0.022, 0.014), lambert('#071018', { emissive: '#36d1a6', emissiveIntensity: 0.6 })), 0, 0.0305, 0.005, -Math.PI / 2)),
  },
  bpCuff: {
    label: 'blood-pressure cuff',
    desc: 'Adult BP cuff. The bladder should cover ~80% of the arm circumference — a cuff that is too small over-reads.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.15, 0.03, 0.12, 0.012, lambert('#283f6a', { roughness: 0.8 }), 0, 0, 0), tube(new THREE.Group(), [[0.06, 0.02, 0.05], [0.1, 0.02, 0.1], [0.16, 0.02, 0.08]], 0.004, lambert('#20262b', { roughness: 0.5 }), 12, 6)),
  },
  pillCup: {
    label: 'pill cup',
    desc: 'Paper medication cup: two white tablets. Nobody wrote down whose they are — that is how wrong-patient errors start.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.018, 0], [0.024, 0.035], [0, 0.035]], paper()), at(new THREE.Mesh(G.sphere(0.006, 8, 6), lambert('#ffffff', { roughness: 0.6 })), 0.004, 0.012, 0), at(new THREE.Mesh(G.sphere(0.006, 8, 6), lambert('#ffffff', { roughness: 0.6 })), -0.005, 0.012, 0.003)),
  },
  bvm: {
    label: 'bag-valve mask',
    desc: 'Adult self-inflating bag-valve mask with reservoir. Connect O₂ at 15 L/min; two-person technique seals best. With a pulse: 1 breath every 6 s, each over 1 s — watch the chest rise, not the bag.',
    pickable: true,
    build: () => {
      const bag = new THREE.Mesh(G.sphere(0.06, 16, 12), plastic('#3c8fd0', 0.45));
      bag.scale.set(1, 1, 1.9);
      const mask = at(new THREE.Mesh(G.cone(0.055, 0.06, 16), glass('#e8f4ff', 0.6)), 0, 0.06, 0.15, Math.PI / 2);
      return group(at(bag, 0, 0.06, 0), mask);
    },
  },
  laryngoscope: {
    label: 'laryngoscope',
    desc: 'Macintosh 3 blade on a battery handle. Click it open and check the light *before* you need it. Video laryngoscope is in the airway cart.',
    pickable: true,
    build: () => group(at(new THREE.Mesh(G.cyl(0.014, 0.014, 0.13, 14), metal('#bfc5c9', 0.35)), 0, 0.014, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.box(0.012, 0.004, 0.11), metal('#e3e6e8', 0.15)), 0.07, 0.03, 0.05, 0.3)),
  },
  donutBox: {
    label: 'box of donuts',
    desc: 'Two glazed donuts left of a dozen. A note: "From the night shift in Cardiology — thanks for the STEMI calls!"',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.3, 0.07, 0.3, 0.008, lambert('#f2a9c4', { roughness: 0.8 }), 0, 0, 0), at(new THREE.Mesh(G.torus(0.035, 0.016, 8, 16), lambert('#d99a55', { roughness: 0.5 })), -0.06, 0.08, 0, -Math.PI / 2), at(new THREE.Mesh(G.torus(0.035, 0.016, 8, 16), lambert('#d99a55', { roughness: 0.5 })), 0.06, 0.08, 0.02, -Math.PI / 2)),
  },
  textbook: {
    label: 'textbook',
    desc: 'A heavy emergency-medicine textbook, bookmarked at "Inferior MI: think right ventricle — avoid nitrates and give volume".',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.22, 0.06, 0.28, 0.004, lambert('#7a1f2b', { roughness: 0.6 }), 0, 0, 0), at(new THREE.Mesh(G.plane(0.2, 0.26), labelTex(['EMERGENCY', 'MEDICINE', '9th edition'], '#7a1f2b', '#f2e6c9', 200, 260)), 0, 0.0605, 0, -Math.PI / 2)),
  },
  tourniquet: {
    label: 'tourniquet',
    desc: 'Disposable latex-free tourniquet strip. Release it within a minute — prolonged stasis falsely raises potassium and lactate.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.45, 0.002, 0.025, 0.001, lambert('#5aa6e0', { roughness: 0.6 }), 0, 0, 0)),
  },
  // ── east wing: cafeteria + clinic clutter ──
  tray: {
    label: 'cafeteria tray',
    desc: 'Half a turkey sandwich, a cold bowl of soup and a pager-shaped gap where someone\'s lunch break ended.',
    pickable: true,
    build: () => {
      const g = group(rboxB(new THREE.Group(), 0.46, 0.018, 0.34, 0.008, lambert('#6b4a33', { roughness: 0.5 }), 0, 0, 0));
      g.add(at(lathe([[0, 0], [0.1, 0], [0.12, 0.012], [0.125, 0.018], [0.11, 0.016], [0, 0.008]], plastic('#f4f4f0', 0.25), 28), -0.08, 0.018, 0));
      g.add(at(lathe([[0, 0], [0.04, 0], [0.06, 0.055], [0.056, 0.055], [0, 0.02]], plastic('#e9e3d6', 0.3), 20), 0.12, 0.018, -0.05));
      g.add(at(new THREE.Mesh(G.circle(0.05, 16), lambert('#b5652a', { roughness: 0.4 })), 0.12, 0.06, -0.05, -Math.PI / 2));
      g.add(at(new THREE.Mesh(G.box(0.012, 0.003, 0.17), metal()), 0.06, 0.021, 0.04));
      g.add(at(new THREE.Mesh(G.box(0.1, 0.004, 0.1), paper()), 0.15, 0.02, 0.09, 0, 0.3));
      return g;
    },
  },
  napkins: {
    label: 'napkin dispenser',
    desc: 'Stainless napkin dispenser. Take one, not twelve.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.13, 0.15, 0.09, 0.012, metal('#cfd4d7', 0.25), 0, 0, 0), at(new THREE.Mesh(G.box(0.1, 0.12, 0.004), paper()), 0, 0.075, 0.046)),
  },
  sandwich: {
    label: 'sandwich',
    desc: 'Turkey on whole wheat, best before tomorrow. 430 kcal and 1.4 g of salt — about a quarter of the adult daily limit of 6 g.',
    pickable: true,
    build: () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.07, 0);
      shape.lineTo(0.07, 0);
      shape.lineTo(-0.07, 0.11);
      shape.closePath();
      const geo = trackGeo(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }));
      geo.rotateX(-Math.PI / 2);
      return group(new THREE.Mesh(geo, glass('#f3efe2', 0.7)), at(new THREE.Mesh(G.box(0.12, 0.05, 0.07), lambert('#d9b98a', { roughness: 0.8 })), -0.02, 0.03, -0.03));
    },
  },
  leaflet: {
    label: 'patient leaflet',
    desc: '"Your blood pressure, explained": check it at home sitting down after 5 minutes\' rest, two readings a minute apart, morning and evening for a week — then bring the numbers.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.1, 0.004, 0.21, 0.002, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.1, 0.21), labelTex(['BLOOD PRESSURE', 'What the numbers', 'mean for you'], '#ffffff', '#1d3557', 100, 210, '#c0392b')), 0, 0.0042, 0, -Math.PI / 2)),
  },
  tongueDepressors: {
    label: 'jar of tongue depressors',
    desc: 'Wooden tongue depressors. Press on the front two-thirds of the tongue — touch the back third and everyone gags.',
    pickable: true,
    build: () => {
      const g = group(lathe([[0, 0], [0.045, 0], [0.045, 0.12], [0.043, 0.12], [0.043, 0.004], [0, 0.004]], glass('#eef6f8', 0.4), 24));
      for (let i = 0; i < 7; i++) g.add(at(new THREE.Mesh(G.box(0.018, 0.15, 0.002), lambert('#dcc08e', { roughness: 0.9 })), Math.cos(i * 2.4) * 0.02, 0.09, Math.sin(i * 2.4) * 0.02, 0.08 * Math.sin(i), i * 0.9, 0.1 * Math.cos(i)));
      return g;
    },
  },
  // ── out of cupboards, carts and drawers (cabinets.ts puts them there; open it to take one) ──
  gauzePack: {
    label: 'pack of gauze swabs',
    desc: 'Sterile gauze swabs, 10 × 10 cm, five to a pack. On a bleeding wound: firm, direct pressure for a full 10 minutes without lifting to look; if it soaks through, add more on top rather than peeling the clot away.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.11, 0.012, 0.11, 0.003, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.1, 0.1), labelTex(['GAUZE SWABS', '10 × 10 cm · 8-ply', 'Sterile · 5'], '#ffffff', '#1d3557', 128, 128, '#2a7fb8')), 0, 0.0125, 0, -Math.PI / 2)),
  },
  ivCannula: {
    label: '18G IV cannula',
    desc: 'Peripheral IV cannula, 18G (green): about 100 mL/min of crystalloid under gravity. Enough for most adults, blood and CT angiography; in major haemorrhage put in two 16G (grey) or bigger. Write the date on the dressing.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.045, 0.008, 0.14, 0.003, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.04, 0.06), labelTex(['IV CANNULA', '18G · 45 mm', 'Sterile'], '#ffffff', '#1d3557', 64, 96, '#2e9e4f')), 0, 0.0085, 0.035, -Math.PI / 2), at(new THREE.Mesh(G.cyl(0.006, 0.006, 0.03, 10), plastic('#2e9e4f', 0.3)), 0, 0.012, -0.03, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.0012, 0.0012, 0.045, 6), metal()), 0, 0.012, -0.068, Math.PI / 2)),
  },
  ivSet: {
    label: 'IV giving set',
    desc: 'Gravity administration set, 20 drops per mL. Drops per minute = mL × drop factor ÷ minutes: 1 L over 8 hours is about 42 drops/min. Prime it fully so no air goes into the vein; blood needs a blood set with its 170–260 µm filter.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.15, 0.018, 0.22, 0.006, glass('#eef6fa', 0.55), 0, 0, 0), at(new THREE.Mesh(G.torus(0.05, 0.0025, 6, 24), plastic('#e8f2f6', 0.3)), 0, 0.009, 0.02, -Math.PI / 2), at(new THREE.Mesh(G.plane(0.12, 0.06), labelTex(['IV ADMINISTRATION SET', '20 drops/mL · 180 cm'], '#ffffff', '#1d3557', 160, 80, '#3a7bd5')), 0, 0.0185, -0.07, -Math.PI / 2)),
  },
  dressing: {
    label: 'transparent IV dressing',
    desc: 'Sterile, transparent, semi-permeable dressing for a cannula site: you can see the insertion point through it. Check the site every shift (a visual infusion phlebitis score) and take the cannula out once it is no longer needed, or when the site is red, sore or swollen.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.09, 0.004, 0.11, 0.002, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.085, 0.1), labelTex(['TRANSPARENT', 'IV DRESSING', '6 × 7 cm · sterile'], '#ffffff', '#1d3557', 96, 112, '#1f9e8f')), 0, 0.0045, 0, -Math.PI / 2)),
  },
  gown: {
    label: 'patient gown',
    desc: 'A clean patient gown, ties at the back. Leave the neck tie loose enough for ECG leads, and ask before you untie anything: dignity is part of the examination.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.3, 0.05, 0.24, 0.02, lambert('#9cc3d5', { roughness: 1 }), 0, 0, 0), at(new THREE.Mesh(G.box(0.3, 0.004, 0.012), lambert('#5f8fb0', { roughness: 1 })), 0, 0.03, 0.06)),
  },
  blanket: {
    label: 'cellular blanket',
    desc: 'A folded cotton cellular blanket. Keeping a patient warm is treatment: below 35 °C a bleeding trauma patient clots worse, and older patients cool quickly on a trolley.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.34, 0.08, 0.3, 0.025, lambert('#e9e4d6', { roughness: 1 }), 0, 0, 0)),
  },
  isoGown: {
    label: 'isolation gown',
    desc: 'Disposable fluid-resistant isolation gown. Contact precautions: gown and gloves on before you go in. Off at the door (CDC order): gloves, eye protection, gown, then the mask, and clean your hands; or roll gown and gloves off together, inside out.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.3, 0.04, 0.22, 0.015, lambert('#f2d36b', { roughness: 1 }), 0, 0, 0)),
  },
  adrenaline: {
    label: 'prefilled epinephrine 1 mg/10 mL',
    desc: 'Epinephrine (adrenaline) 1 mg in 10 mL (0.1 mg/mL), prefilled. Cardiac arrest: 1 mg IV or IO every 3–5 minutes, as soon as you can in a non-shockable rhythm, after the third shock in VF or pulseless VT (ERC; the AHA gives it after the second). Never this one for anaphylaxis: that is 0.5 mg of the 1 mg/mL strength, intramuscular, into the thigh.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.045, 0.03, 0.2, 0.004, paper(), 0, 0, 0), at(new THREE.Mesh(G.plane(0.04, 0.18), labelTex(['EPINEPHRINE', '1 mg/10 mL', 'Prefilled syringe', 'IV/IO'], '#ffffff', '#1d1028', 64, 288, '#7b3fa0')), 0, 0.0305, 0, -Math.PI / 2)),
  },
  salineFlush: {
    label: 'saline flush syringe',
    desc: 'Prefilled 0.9% sodium chloride flush, 10 mL. Flush a cannula before and after every drug with a push-pause technique, and between two drugs that might not mix. For central lines 10 mL is the smallest barrel: smaller syringes push pressures high enough to rupture a catheter.',
    pickable: true,
    build: () => group(at(new THREE.Mesh(G.cyl(0.008, 0.008, 0.1, 12), plastic('#f4f6f8', 0.3)), 0, 0.008, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.0085, 0.0085, 0.05, 12), lambert('#2a62c9', { roughness: 0.5 })), 0.01, 0.008, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.003, 0.003, 0.055, 8), plastic('#ffffff')), -0.075, 0.008, 0, 0, 0, Math.PI / 2), at(new THREE.Mesh(G.cyl(0.004, 0.003, 0.012, 8), plastic('#e9eef2')), 0.056, 0.008, 0, 0, 0, Math.PI / 2)),
  },
  // ── case items (belongings; server text overrides desc) ──
  medBag: {
    label: 'bag of medications',
    desc: 'A ziplock bag with medication boxes.',
    pickable: true,
    build: () => {
      const bag = rboxB(new THREE.Group(), 0.2, 0.06, 0.25, 0.02, glass('#eef8ff', 0.35), 0, 0, 0);
      const boxes = group(
        rboxB(new THREE.Group(), 0.06, 0.035, 0.11, 0.003, labelTex(['SILDENAFIL', '100 mg'], '#ffffff', '#33497a', 64, 110, '#4f6db8'), -0.05, 0.005, -0.03),
        rboxB(new THREE.Group(), 0.06, 0.035, 0.11, 0.003, labelTex(['LISINOPRIL'], '#ffffff', '#24543a', 64, 110, '#3b8a5c'), 0.04, 0.005, 0.02),
        at(lathe([[0, 0], [0.02, 0], [0.02, 0.06], [0, 0.06]], plastic('#e68a2e', 0.3)), 0.0, 0.005, 0.08, Math.PI / 2),
      );
      return group(bag, boxes);
    },
  },
  pillBottle: {
    label: 'pill bottle',
    desc: 'A prescription bottle.',
    pickable: true,
    build: () => group(lathe([[0, 0], [0.022, 0], [0.022, 0.07], [0, 0.07]], lambert('#e4842a', { roughness: 0.25, opacity: 0.85 })), at(new THREE.Mesh(G.cyl(0.0235, 0.0235, 0.018, 20), plastic('#f5f5f5', 0.3)), 0, 0.079, 0), at(new THREE.Mesh(G.cyl(0.0225, 0.0225, 0.04, 20), labelTex(['Rx', 'Take 1 tab daily'], '#ffffff', '#222222', 128, 64)), 0, 0.035, 0)),
  },
  handbag: {
    label: 'handbag',
    desc: 'A black leather handbag.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.3, 0.2, 0.1, 0.03, pbr('vinyl', { color: '#1d1a19', tile: 0.2, roughness: 0.6 }), 0, 0, 0), tube(new THREE.Group(), [[-0.09, 0.19, 0], [-0.07, 0.29, 0], [0.07, 0.29, 0], [0.09, 0.19, 0]], 0.006, lambert('#141110', { roughness: 0.5 }), 16, 6)),
  },
  sportsBag: {
    label: 'gym bag',
    desc: 'A gym bag.',
    pickable: true,
    build: () => {
      const b = new THREE.Mesh(G.capsule(0.13, 0.3, 4, 12), lambert('#1f3b73', { roughness: 0.8 }));
      b.rotation.z = Math.PI / 2;
      b.position.y = 0.13;
      return group(b, tube(new THREE.Group(), [[-0.12, 0.24, 0], [0, 0.36, 0], [0.12, 0.24, 0]], 0.008, lambert('#141414', { roughness: 0.7 }), 12, 6));
    },
  },
  letter: {
    label: 'letter',
    desc: 'A folded letter.',
    pickable: true,
    build: () => group(rboxB(new THREE.Group(), 0.22, 0.004, 0.11, 0.002, paper(), 0, 0, 0)),
  },
  phone: {
    label: 'phone',
    desc: 'A phone.',
    pickable: true,
    build: () => ITEM_KINDS.phoneMobile.build(),
  },
};

/** big things you can't carry but can look at */
export const FIXTURE_INFO: Record<string, { title: string; desc: string }> = {
  crashCart: { title: 'Crash cart', desc: 'Defibrillator on top (biphasic: 120–200 J for VF/pVT; synchronized cardioversion for unstable tachycardias). Drawers: airway, IV/IO access, and ACLS drugs — epinephrine 1 mg/10 mL every 3–5 min, amiodarone 300 mg then 150 mg, adenosine 6 mg → 12 mg rapid push, calcium, bicarbonate. The yellow board is for CPR on a soft mattress. Checked daily — sign the log.' },
  bed: { title: 'Hospital bed', desc: 'Electric bed: head-up 30° reduces aspiration and helps breathing; Trendelenburg won\'t fix hypotension (fluids will). Brakes on before transfers; rails up for confused patients — but rails don\'t prevent falls, supervision does.' },
  stretcher: { title: 'Stretcher', desc: 'Transport stretcher with an O₂ cylinder holder and IV pole. Check the cylinder gauge before a CT trip — a full E-cylinder lasts ~40 min at 15 L/min.' },
  monitor: { title: 'Patient monitor', desc: 'Continuous ECG, SpO₂, NIBP and respiratory rate. Alarm fatigue is real — but never silence an alarm you haven\'t looked at.' },
  ivPole: { title: 'IV pole with infusion pump', desc: 'Five-wheel IV pole, 1 L saline and a large-volume pump running at 125 mL/h. Pumps have drug libraries with hard limits for high-alert drugs (insulin, heparin, potassium) — still double-check concentration and rate, and label every line with drug and time.' },
  ultrasound: { title: 'Point-of-care ultrasound', desc: 'Phased-array, curvilinear and linear probes. FAST, RUSH (pump, tank, pipes), IVC, lung (B-lines, sliding), DVT two-point compression, appendix with graded compression. Clean the probe between patients.' },
  vitalsMachine: { title: 'Vital-signs monitor', desc: 'Spot-check NIBP, SpO₂ and temperature on a rolling stand.' },
  medDispenser: { title: 'Automated medication dispenser', desc: 'Pharmacy-stocked cabinet: scan your badge, choose the patient, the drawer pops. Overrides without pharmacist verification are logged and reviewed.' },
  cart: { title: 'Supply cart', desc: 'IV start kits, flushes, dressings, blood tubes, ECG electrodes. Restock what you use.' },
  sink: { title: 'Hand-wash sink', desc: 'Soap and water for C. difficile and norovirus (alcohol rub doesn\'t kill spores). The tap has a long elbow lever: lift it with the back of the wrist, press it down the same way, so clean hands never touch it. [E] wash your hands.' },
  cabinet: { title: 'Supply cabinet', desc: 'Gloves, cannulas, syringes, dressings, gauze, giving sets and flushes on its shelves. First in, first out: new stock goes to the back.' },
  cdCupboard: { title: 'Controlled-drug cupboard', desc: 'A locked steel cupboard fixed to the wall; the key stays with the nurse in charge. Every withdrawal goes in the controlled-drug register, signed by you and a witness.' },
  vending: { title: 'Vending machine', desc: 'Chips, chocolate, energy drinks: coins, or tap a card or phone on the reader above the keypad. A note taped on: "DOES NOT GIVE CHANGE".' },
  ctScanner: { title: 'CT scanner', desc: '64-slice CT. Contrast studies need a creatinine/eGFR policy check and an allergy history; women 12–55 need a pregnancy test first.' },
  xrayTable: { title: 'X-ray table', desc: 'Digital radiography. Portable films go to resus and the bays.' },
  coffee: { title: 'Coffee machine', desc: 'The most important machine in the department. Descaling overdue.' },
  fridge: { title: 'Fridge', desc: '"STAFF FOOD ONLY — NO SPECIMENS, NO MEDICATIONS". There are specimens.' },
  printer: { title: 'Label printer', desc: 'Prints patient ID labels. Label tubes at the bedside, in front of the patient — never pre-label.' },
  sofa: { title: 'Family room sofa', desc: 'Where families wait for news. A box of tissues on the armrest.' },
  plant: { title: 'Potted plant', desc: 'Plastic. Dusty.' },
  trash: { title: 'Waste bin', desc: 'General waste only. Sharps in the yellow/red sharps bins, contaminated material in the yellow bags.' },
  ambulance: { title: 'Ambulance', desc: 'Type III box ambulance. The crew handed over with "MIST": mechanism/medical complaint, injuries/information, signs, treatment so far.' },
  lamp: { title: 'Parking-lot light', desc: 'Sodium lamp. Flickers.' },
  stool: { title: 'Rolling stool', desc: 'Sit down when you talk to patients: they perceive you stayed twice as long.' },
  chair: { title: 'Chair', desc: 'Upholstered visitor chair.' },
  desk: { title: 'Desk', desc: 'Workstation desk.' },
  counter: { title: 'Nurses\' station counter', desc: 'The ED\'s nerve centre: phones, workstations, the tracking board above.' },
  wheelchair: { title: 'Wheelchair', desc: 'Brakes on before the patient sits or stands; footrests up for transfers.' },
  linenCart: { title: 'Linen cart', desc: 'Clean sheets, gowns and blankets. A warm blanket fixes more complaints than you\'d think.' },
  isolationCart: { title: 'Isolation cart', desc: 'Gowns, gloves, surgical masks, N95s, eye protection. Droplet (plus standard) precautions for influenza; contact for MDROs such as ESBL or MRSA; airborne (N95/FFP2, negative-pressure room) for TB, measles, varicella.' },
  wow: { title: 'Workstation on wheels', desc: 'Tap your badge on the reader beside the laptop to open AgentChart.' },
  wetFloor: { title: 'Wet-floor sign', desc: '"CAUTION — WET FLOOR". Inés just mopped.' },
  aed: { title: 'AED cabinet', desc: 'Automated external defibrillator — opening the cabinet triggers an alarm. Pads: right upper chest / left lower lateral chest.' },
  extinguisher: { title: 'Fire extinguisher', desc: 'CO₂ extinguisher (safe on electrical equipment). PASS: pull, aim, squeeze, sweep. Oxygen-enriched rooms burn fast.' },
  clock: { title: 'Wall clock', desc: 'Synced to the hospital network. Use it for time-of-event documentation: door-to-ECG, door-to-needle, time of last known well.' },
  bedsideTable: { title: 'Bedside table', desc: 'Water, tissues, the call bell — and whatever the family brought.' },
  infusionPump: { title: 'Infusion pump', desc: 'Large-volume pump with a drug library and hard limits for high-alert drugs (insulin, heparin, potassium). Double-check concentration and rate.' },
  oxygen: { title: 'Oxygen cylinder cart', desc: 'E-cylinders for transport. Close the valve after use.' },
  // ── east wing ──
  elevatorDoor: { title: 'Elevator', desc: 'Bed elevator: 1.3 m doors and a car deep enough for a bed and two staff. Out of service tonight — Levels 2–4 (inpatient wards) are not in this build. In a fire, never take the elevator: use the stairs.' },
  callPanel: { title: 'Elevator call button', desc: 'Only ▲ on the lowest floor. The red key switch is firefighters\' recall: on a fire alarm the cars come down here, open, and wait for the fire service.' },
  fireDoor: { title: 'Fire door — Level 2', desc: 'Stair 1, Level 2: inpatient wards — not in this build, so it stays locked. Fire doors self-close and must never be wedged open; they keep smoke out of the stair, your protected escape route. Hospitals evacuate sideways first (into the next fire compartment), then down.' },
  servingCounter: { title: 'Serving counter', desc: 'Hot and cold food behind a sneeze guard. Cold food is held at 5 °C or below, hot food at 60 °C or above; in the danger zone between, bacteria can double in about 20 minutes.' },
  till: { title: 'Till', desc: 'Card or contactless: tap your phone on the terminal. Staff get 20% off hot food with their badge. The night cashier also minds the lost-and-found box.' },
  coffeeStation: { title: 'Self-serve coffee', desc: 'Coffee, decaf, tea and hot water, 24/7: $2.25 a cup, paid at the till. Caffeine\'s half-life is about 5 hours, so the 3 a.m. cup is still with you at 8. Lids on before you walk: hot drinks are a classic cause of scalds.' },
  drinksFridge: { title: 'Drinks fridge', desc: 'A 500 mL cola holds about 53 g of sugar — 13 teaspoons. Water is on the bottom shelf.' },
  trayRack: { title: 'Tray rack', desc: 'Trays, cutlery and napkins. Used trays go on top of the waste station.' },
  wasteStation: { title: 'Waste and recycling', desc: 'Landfill · recycling · compost, with a tray return on top. Clinical waste never goes here: sharps into a sharps bin, blood-soaked items into clinical-waste bags.' },
  toiletStall: { title: 'Toilet stalls', desc: 'All-gender stalls with full-height partitions and doors. The locks show vacant or occupied and can be opened from outside in an emergency.' },
  toilet: { title: 'Accessible toilet', desc: 'Seat at about 45 cm, a grab bar on the wall side, a fold-down bar on the open side and space for a wheelchair alongside. The red cord calls for help — falls in restrooms are common, so if it alarms, go straight away.' },
  vanity: { title: 'Hand basins', desc: 'Sensor taps and soap. Gloves don\'t replace hand hygiene: for C. diff, wash with soap and water for 20 seconds after taking them off — alcohol rub doesn\'t kill the spores.' },
  handDryer: { title: 'Hand dryer', desc: 'Warm-air dryer. Dry your hands completely: damp hands pass on far more bacteria than dry ones.' },
  babyChange: { title: 'Baby-changing station', desc: 'Fold-down changing table. Fasten the strap, keep a hand on the baby, and wipe it down before and after.' },
  handRub: { title: 'Hand-rub dispenser', desc: 'Alcohol hand rub before you touch a patient and after (WHO moments 1 and 4), on the way in and on the way out: a palmful, 20–30 seconds, palms, backs, between the fingers, thumbs, fingertips, until dry. For C. diff and norovirus, wash with soap and water instead. [E] clean your hands.' },
  soapDispenser: { title: 'Soap dispenser', desc: 'Liquid soap for a hand wash: wet, soap, 40–60 seconds in all, rinse, the tap off with the wrist or elbow on its lever, dry with a paper towel. Wash when hands are visibly soiled, after C. diff or norovirus, and after the toilet. [E] wash your hands.' },
  towelDispenser: { title: 'Paper towels', desc: 'Single-use towels: pat dry, and drop them in the pedal bin. Wet hands spread far more microbes than dry ones.' },
  gloveHolder: { title: 'Examination gloves', desc: 'Non-sterile nitrile gloves, single use: for contact with blood, body fluids, mucous membranes or broken skin, and under contact precautions (e.g. C. difficile, MRSA, ESBL). Clean your hands before you put them on and after you take them off: gloves have holes you can\'t see. A fresh pair for each patient and each task. [E] put a pair on, [G] take them off into the bin.' },
  pedalBin: { title: 'Pedal bin', desc: 'Paper towels and used masks. Foot pedal, so the hands you just cleaned stay clean.' },
  maskBox: { title: 'Surgical masks', desc: 'Three-ply medical face masks. Coloured side out, nose wire up and pinched, chin covered; touch only the loops. Single use: a new one each time, binned when it comes off, then clean your hands. For airborne precautions (TB, measles, varicella) you need an N95/FFP2 respirator instead. [E] put one on.' },
  maskStation: { title: 'Respiratory hygiene station', desc: 'At the door: masks for anyone with a cough or fever, hand rub, and a sign asking them to tell the desk. Masking people who cough cuts the spread of droplet infections in the waiting room.' },
  examTable: { title: 'Exam table', desc: 'Fresh paper for every patient and a wipe of the vinyl in between. For the abdomen: patient flat, knees bent, and look before you touch.' },
  diagSet: { title: 'Wall diagnostic set', desc: 'Otoscope and ophthalmoscope on their charger, an aneroid BP gauge and cuff, and a sharps bin. Otoscope: pull the pinna up and back in adults, down and back in small children. BP: seated for 5 minutes, back supported, arm at heart level — talking or crossed legs push the reading up.' },
  scale: { title: 'Column scale', desc: 'Scale with a height rod: shoes off, light clothing. BMI = weight (kg) / height (m)². Unintended loss of more than 5% of body weight in 6–12 months deserves a work-up.' },
  // Resus 1 + 2: pendants, ventilator, infusion tower, defibrillator cart, airway trolley, … (resusGear.ts)
  ...RESUS_INFO,
  // the CT suite and the X-ray room: scanner, injector, console, aprons, tube, wall stand, … (imaging.ts)
  ...IMAGING_INFO,
};

// ───────────────────────────── scatter (decor) ─────────────────────────────

export interface ItemInstance {
  id: string;
  kind: string;
  label: string;
  desc: string;
  pickable: boolean;
  root: THREE.Group;
  box: THREE.Box3;
  /** server case item id (inspect reveals history) */
  caseItemId?: string;
}

/** merge an item's meshes by material (fewer draw calls) — transforms are baked relative to the item root */
function compact(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    let geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (geo.index) geo = geo.toNonIndexed();
    for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    const mat = m.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(trackGeo(merged), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  void keep;
  return out;
}

let seq = 0;
export function makeItem(kind: string, opts: { label?: string; desc?: string; caseItemId?: string } = {}): ItemInstance {
  const spec = ITEM_KINDS[kind] ?? ITEM_KINDS.letter;
  const root = new THREE.Group();
  root.add(compact(spec.build()));
  root.userData.item = true;
  return { id: `item${++seq}`, kind, label: opts.label ?? spec.label, desc: opts.desc ?? spec.desc, pickable: spec.pickable, root, box: new THREE.Box3(), caseItemId: opts.caseItemId };
}

/** deterministic pseudo-random (per prop id) so the clutter is the same every run */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** local (x, z) on a prop's top → world position, honoring the prop's rotation */
function onProp(p: PropDef, lx: number, lz: number, y: number): THREE.Vector3 {
  const r = p.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new THREE.Vector3(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c);
}

/** where decor goes: kind lists per surface type, placed along the prop's top */
export function scatterDecor(layout: LayoutDef, extraSurfaces: { id: string; x: number; z: number; y: number; rot: number; w: number; d: number; kinds: string[] }[]): { inst: ItemInstance; pos: THREE.Vector3; yaw: number }[] {
  const out: { inst: ItemInstance; pos: THREE.Vector3; yaw: number }[] = [];
  const put = (p: PropDef | (typeof extraSurfaces)[number], kinds: string[], top: number, w: number, d: number, every = 0.45) => {
    const rand = rng((p as { id: string }).id);
    const n = Math.max(1, Math.min(kinds.length, Math.floor(w / every)));
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length];
      const lx = -w / 2 + ((i + 0.5) * w) / n + (rand() - 0.5) * 0.12;
      const lz = (rand() - 0.5) * Math.max(0, d - 0.25);
      out.push({ inst: makeItem(kind), pos: onProp(p as PropDef, lx, lz, top), yaw: (p.rot ?? 0) + (rand() - 0.5) * 0.9 });
    }
  };
  for (const p of layout.props) {
    const room = layout.rooms.find((r) => r.id === p.room);
    // east wing: café tables (some cleared, some mid-meal), the servery, clinic desks and the waiting area
    if (p.kind === 'cafeTable' && p.room === 'cafeteria') {
      const rand = rng(p.id);
      const pick = rand();
      // kept sparse: every item is its own draw call (≈1 item per table on average)
      const kinds = pick < 0.3 ? [] : pick < 0.6 ? ['paperCup'] : pick < 0.82 ? ['tray'] : ['tray', 'napkins'];
      if (kinds.length) put(p, kinds, (p.h ?? 0.75) + 0.002, (p.w ?? 0.8) - 0.1, 0.3, 0.22);
      continue;
    }
    if (p.kind === 'cafeTable') {
      put(p, ['magazine', 'leaflet'], (p.h ?? 0.75) + 0.002, (p.d ?? 0.6) - 0.1, 0.25, 0.4);
      continue;
    }
    if (p.kind === 'servingCounter') {
      // the open end by the till: napkins and a stray sandwich
      out.push({ inst: makeItem('napkins'), pos: onProp(p, (p.w ?? 4) / 2 - 1.15, 0.2, (p.h ?? 0.92) + 0.002), yaw: p.rot ?? 0 });
      continue;
    }
    if (p.kind === 'desk' && (p.room === 'clinic' || p.room === 'clinic_hall' || p.room.startsWith('exam_'))) {
      const W = p.w ?? 1.4;
      const D = p.d ?? 0.7;
      // [kind, local x, local z, yaw], clear of the computer; at reception they sit on the raised transaction top
      const spots: [string, number, number, number][] =
        p.room === 'clinic'
          ? [['clipboard', -W / 2 + 0.4, D * 0.3, -0.2], ['leaflet', W / 2 - 0.6, D * 0.3, 0.1]]
          : p.room === 'clinic_hall'
            ? [['clipboard', -0.42, 0.02, 0.15], ['thermometer', 0.5, 0.12, -0.4]]
            : p.room === 'exam_1'
              ? [['clipboard', 0.3, 0.1, 0.15], ['gloveBox', 0.44, -0.18, 0], ['tongueDepressors', 0.52, 0.12, 0]]
              : [['clipboard', 0.3, 0.1, 0.15], ['gloveBox', 0.44, -0.18, 0]];
      const top = (p.h ?? 0.78) + 0.002;
      for (const [kind, lx, lz, yaw] of spots) out.push({ inst: makeItem(kind), pos: onProp(p, lx, lz, top), yaw: (p.rot ?? 0) + yaw });
      continue;
    }
    if (p.kind === 'chair' && p.room === 'clinic' && !p.id.includes('desk')) {
      const rand = rng(p.id);
      // on the seat cushion (its top 0.48 m, props.ts waitingChair), not 4 cm over it
      if (rand() < 0.1) out.push({ inst: makeItem(rand() < 0.6 ? 'magazine' : 'leaflet'), pos: onProp(p, 0, 0.03, 0.48 + 0.002), yaw: (p.rot ?? 0) + rand() });
      continue;
    }
    if (p.kind === 'counter' && room?.kind === 'station') {
      // leave the computer spots free: items sit on the counter's back half
      const W = p.w ?? 2;
      const kinds = p.id.endsWith('_n') ? ['clipboard', 'coffeeMug', 'specimenTubes', 'pen', 'binder', 'gloveBox', 'paperCup', 'stethoscope'] : p.id.endsWith('_s') ? ['clipboard', 'phoneMobile', 'gauzePack', 'urineCup', 'pen', 'tissueBox'] : ['sanitizer'];
      const first = out.length;
      put(p, kinds, (p.h ?? 1.05) + 0.002, W - 0.4, 0.2, 1.3);
      // …and never on a monitor's spot (a binder stood through Workstation 3's screen): slide along the counter into the gap
      const ax = Math.cos(p.rot ?? 0);
      const az = -Math.sin(p.rot ?? 0);
      for (const it of out.slice(first))
        for (const pc of layout.props) {
          if (pc.kind !== 'computer' || Math.hypot(pc.x - it.pos.x, pc.z - it.pos.z) > 0.6) continue;
          const along = (it.pos.x - pc.x) * ax + (it.pos.z - pc.z) * az;
          if (Math.abs(along) >= 0.5) continue;
          const shift = (along >= 0 ? 0.5 : -0.5) - along;
          it.pos.x += ax * shift;
          it.pos.z += az * shift;
        }
    } else if (p.kind === 'desk' && (p.h ?? 0.78) >= 1.0) {
      // a registration counter (props.ts): the public's pen and leaflets on the raised transaction top,
      // the clerk's cup on the work surface behind it. The generic scatter below put things at the
      // ledge's height across the whole depth, so a clipboard hovered over the work surface in front of the clerk.
      const H = p.h ?? 1.05;
      const D = p.d ?? 1.1;
      const spots: [string, number, number, number, number][] = [
        ['pen', -0.35, D * 0.3, H + 0.002, 0.3],
        ['leaflet', 0.42, D * 0.3, H + 0.002, -0.1],
        // clear of the clerk's screen (w_pc, local x 0–0.5)
        ['paperCup', -0.45, -D * 0.28, 0.777, 0],
      ];
      for (const [kind, lx, lz, y, yaw] of spots) out.push({ inst: makeItem(kind), pos: onProp(p, lx, lz, y), yaw: (p.rot ?? 0) + yaw });
    } else if (p.kind === 'desk') {
      const W = p.w ?? 1.4;
      const kinds = room?.kind === 'triage' ? ['thermometer', 'pulseOx', 'bpCuff', 'clipboard'] : room?.kind === 'waiting' ? ['clipboard', 'pen', 'paperCup'] : ['coffeeMug', 'textbook', 'clipboard', 'donutBox', 'pen'];
      put(p, kinds, (p.h ?? 0.78) + 0.002, W - 0.3, (p.d ?? 0.7) - 0.2, 0.5);
    } else if (p.kind === 'crashCart') {
      put(p, ['bvm', 'laryngoscope'], 1.055, 0.5, 0.3, 0.25);
    } else if (p.kind === 'airwayCart') {
      // resus airway trolley top (its video laryngoscope is fixed on the pole)
      put(p, ['bvm', 'laryngoscope'], 1.012, 0.36, 0.3, 0.18);
    } else if (p.kind === 'cart') {
      put(p, ['syringe', 'salineBag', 'tourniquet'], 0.955, 0.45, 0.3, 0.15);
    } else if (p.kind === 'chair' && room?.kind === 'waiting') {
      const rand = rng(p.id);
      // on the seat cushion (its top 0.48 m, props.ts waitingChair), not 4 cm over it
      if (rand() < 0.3) out.push({ inst: makeItem(rand() < 0.6 ? 'magazine' : rand() < 0.5 ? 'waterBottle' : 'paperCup'), pos: onProp(p, 0, 0.03, 0.48 + 0.002), yaw: (p.rot ?? 0) + rand() });
    } else if (p.kind === 'coffee') {
      put(p, ['paperCup', 'paperCup'], 0.93, 0.6, 0.3, 0.3);
    }
  }
  for (const s of extraSurfaces) put(s, s.kinds, s.y, s.w, s.d, 0.18);
  return out;
}

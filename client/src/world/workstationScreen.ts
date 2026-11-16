/**
 * What the workstation login draws (workstation.ts): the monitor's sign-in screen in its states
 * (locked → badge accepted → AgentChart → signed out), the ID badge you tap, and the contactless
 * mark on the badge readers. Canvas 2D, drawn on demand: the login screen only redraws while a
 * login runs, a few dozen times in all.
 */
import * as THREE from 'three';
import { canvasTexture, makeCanvas, own } from './materials';

export type LoginState = 'lock' | 'auth' | 'chart' | 'signout';

export interface LoginInfo {
  /** "Workstation 3" */
  label: string;
  /** game clock "HH:MM" */
  clock: string;
  /** 0..1 progress of "Signing in…" */
  progress: number;
  /** what AgentChart opens on: the tracking board, a patient's chart, or the MAR at the dispenser */
  opens: 'board' | 'patient' | 'mar';
  /** a cabinet's touchscreen (portrait-ish, bigger type) */
  cabinet: boolean;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const TEAL = '#0f6e6e';
const HEAD = '#0c3a40';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** the AgentChart mark: a teal rounded square with an ECG trace (as in the EHR's top bar) */
function logo(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.fillStyle = TEAL;
  roundRect(c, x, y, s, s, s * 0.27);
  c.fill();
  c.strokeStyle = '#ffffff';
  c.lineWidth = Math.max(1.2, s * 0.08);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const k = s / 24;
  c.beginPath();
  const pts = [[3, 12], [7, 12], [9, 7], [12, 16], [14, 10], [15.5, 12], [21, 12]];
  pts.forEach(([px, py], i) => (i ? c.lineTo(x + px * k, y + py * k) : c.moveTo(x + px * k, y + py * k)));
  c.stroke();
}

/** three arcs, the contactless symbol */
function contactless(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineWidth = Math.max(1.5, s * 0.11);
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(cx - s * 0.32, cy, s * (0.28 + i * 0.22), -0.85, 0.85);
    c.stroke();
  }
}

function backdrop(c: CanvasRenderingContext2D, W: number, H: number) {
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0a2f34');
  g.addColorStop(1, '#105c61');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // a faint diagonal weave, like a lock-screen wallpaper
  c.strokeStyle = 'rgba(255,255,255,0.035)';
  c.lineWidth = 1;
  for (let i = -H; i < W; i += 14) {
    c.beginPath();
    c.moveTo(i, H);
    c.lineTo(i + H, 0);
    c.stroke();
  }
}

/**
 * Draw the sign-in screen. Sizes follow the canvas, so desk monitors (16:9-ish), the laptop on a
 * cart and the dispenser's touchscreen all lay out from the same code.
 */
export function drawLogin(c: CanvasRenderingContext2D, W: number, H: number, state: LoginState, info: LoginInfo) {
  const u = H / 100; // layout unit: 1 % of the height
  if (state === 'chart') return drawChart(c, W, H, info);
  backdrop(c, W, H);
  // top bar: logo, product, hospital; clock at the right
  logo(c, 4 * u, 4 * u, 9 * u);
  c.fillStyle = '#ffffff';
  c.font = `700 ${6.2 * u}px ${FONT}`;
  c.textBaseline = 'alphabetic';
  c.fillText(info.cabinet ? 'AgentChart Meds' : 'AgentChart', 15.5 * u, 9.6 * u);
  c.fillStyle = 'rgba(214,236,236,0.72)';
  c.font = `500 ${3.6 * u}px ${FONT}`;
  c.fillText('Grand Therapies MC · Emergency', 15.5 * u, 14 * u);
  c.textAlign = 'right';
  c.fillStyle = '#e6f4f4';
  c.font = `600 ${7 * u}px ${FONT}`;
  c.fillText(info.clock, W - 4 * u, 11 * u);
  c.textAlign = 'left';

  // the sign-in card
  const cw = Math.min(W * 0.64, 118 * u);
  const ch = 50 * u;
  const cx = (W - cw) / 2;
  const cy = 27 * u;
  c.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(c, cx + 0.8 * u, cy + 1.6 * u, cw, ch, 3.2 * u);
  c.fill();
  c.fillStyle = '#f6fafa';
  roundRect(c, cx, cy, cw, ch, 3.2 * u);
  c.fill();
  const mid = cx + cw / 2;
  c.textAlign = 'center';
  if (state === 'lock') {
    contactless(c, mid + 2 * u, cy + 15 * u, 11 * u, TEAL);
    c.fillStyle = '#16302f';
    c.font = `700 ${6.4 * u}px ${FONT}`;
    c.fillText('Tap your badge to sign in', mid, cy + 33 * u);
    c.fillStyle = '#5d7276';
    c.font = `500 ${3.7 * u}px ${FONT}`;
    c.fillText(info.label, mid, cy + 41.5 * u);
  } else if (state === 'auth') {
    // green tick, who is signing in, a progress bar
    c.fillStyle = '#2b8a3e';
    c.beginPath();
    c.arc(mid, cy + 13 * u, 7.5 * u, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.6 * u;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(mid - 3.4 * u, cy + 13.2 * u);
    c.lineTo(mid - 0.8 * u, cy + 15.8 * u);
    c.lineTo(mid + 3.8 * u, cy + 10.2 * u);
    c.stroke();
    c.fillStyle = '#16302f';
    c.font = `700 ${6 * u}px ${FONT}`;
    c.fillText('Badge accepted', mid, cy + 30 * u);
    c.fillStyle = '#5d7276';
    c.font = `500 ${3.8 * u}px ${FONT}`;
    c.fillText(info.progress < 1 ? 'Signing in · Resident, Emergency Medicine' : 'Opening AgentChart…', mid, cy + 37.5 * u);
    const bw = cw * 0.7;
    c.fillStyle = '#dbe6e7';
    roundRect(c, mid - bw / 2, cy + 42 * u, bw, 2.2 * u, 1.1 * u);
    c.fill();
    c.fillStyle = TEAL;
    roundRect(c, mid - bw / 2, cy + 42 * u, Math.max(2.2 * u, bw * Math.min(1, info.progress)), 2.2 * u, 1.1 * u);
    c.fill();
  } else {
    c.fillStyle = '#16302f';
    c.font = `700 ${6.2 * u}px ${FONT}`;
    c.fillText('Signed out', mid, cy + 22 * u);
    c.fillStyle = '#5d7276';
    c.font = `500 ${3.8 * u}px ${FONT}`;
    c.fillText('Your session has ended.', mid, cy + 30 * u);
    contactless(c, mid + 1.4 * u, cy + 40 * u, 6 * u, '#9fb7bb');
  }
  c.textAlign = 'left';
  c.fillStyle = 'rgba(214,236,236,0.55)';
  c.font = `500 ${3.1 * u}px ${FONT}`;
  c.fillText(info.cabinet ? 'Pharmacy-verified doses only · overrides are reviewed' : 'Simulated record · not for clinical use', 4 * u, H - 4 * u);
}

/** AgentChart's first frame, so the hand-over to the real UI (ui/EhrTransition.tsx) doesn't jump */
function drawChart(c: CanvasRenderingContext2D, W: number, H: number, info: LoginInfo) {
  const u = H / 100;
  c.fillStyle = '#eef2f4';
  c.fillRect(0, 0, W, H);
  // top bar with the patient tabs
  const bar = 9 * u;
  c.fillStyle = HEAD;
  c.fillRect(0, 0, W, bar);
  logo(c, 1.6 * u, 1.6 * u, bar - 3.2 * u);
  c.fillStyle = '#e7f2f2';
  c.font = `700 ${3.6 * u}px ${FONT}`;
  c.fillText('AgentChart', bar + 0.4 * u, bar * 0.62);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i === 0 && info.opens === 'board' ? '#eef2f4' : 'rgba(255,255,255,0.09)';
    roundRect(c, bar + 22 * u + i * 15 * u, 2.2 * u, 13.5 * u, bar - 2.2 * u, 1.2 * u);
    c.fill();
  }
  if (info.opens === 'board') {
    // the department list
    c.fillStyle = '#ffffff';
    c.fillRect(2 * u, bar + 2 * u, W - 4 * u, H - bar - 8 * u);
    c.fillStyle = '#1d2a30';
    c.font = `700 ${3.6 * u}px ${FONT}`;
    c.fillText('Emergency Department — all patients', 4 * u, bar + 7.5 * u);
    const esi = ['#e8590c', '#b3261e', '#e0a10b', '#2f9e44', '#e0a10b', '#1c7ed6', '#2f9e44', '#e0a10b'];
    for (let r = 0; r < 8; r++) {
      const y = bar + 11 * u + r * 8.4 * u;
      c.fillStyle = r % 2 ? '#ffffff' : '#f4f7f8';
      c.fillRect(2 * u, y, W - 4 * u, 8.4 * u);
      c.fillStyle = esi[r];
      c.beginPath();
      c.arc(6 * u, y + 4.2 * u, 1.5 * u, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#7b8f98';
      c.fillRect(10 * u, y + 3.4 * u, W * 0.18, 1.6 * u);
      c.fillStyle = '#3d4f57';
      c.fillRect(W * 0.34, y + 3.4 * u, W * 0.24, 1.6 * u);
      c.fillStyle = r === 1 ? '#c92a2a' : '#9fb0b7';
      c.fillRect(W * 0.66, y + 3.4 * u, W * 0.12, 1.6 * u);
    }
  } else {
    // a chart: patient banner, the section nav, a table (the MAR at the dispenser)
    c.fillStyle = '#ffffff';
    c.fillRect(0, bar, W, 12 * u);
    c.fillStyle = '#1d2a30';
    c.fillRect(3 * u, bar + 3 * u, W * 0.22, 3 * u);
    c.fillStyle = '#9fb0b7';
    c.fillRect(3 * u, bar + 8 * u, W * 0.5, 1.6 * u);
    c.fillStyle = '#fde2e1';
    c.fillRect(W * 0.76, bar + 3 * u, W * 0.2, 6 * u);
    c.fillStyle = '#f7f9fa';
    c.fillRect(0, bar + 12 * u, W * 0.16, H - bar - 12 * u);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = (info.opens === 'mar' ? i === 7 : i === 0) ? '#cfe8e5' : '#e3eaed';
      c.fillRect(1.5 * u, bar + 16 * u + i * 7 * u, W * 0.16 - 3 * u, 4.6 * u);
    }
    c.fillStyle = '#ffffff';
    c.fillRect(W * 0.18, bar + 15 * u, W * 0.8, H - bar - 21 * u);
    for (let r = 0; r < 7; r++) {
      const y = bar + 18 * u + r * 8 * u;
      c.fillStyle = '#3d4f57';
      c.fillRect(W * 0.2, y, W * 0.2, 1.6 * u);
      for (let k = 0; k < 4; k++) {
        c.fillStyle = (r + k) % 3 ? '#2b8a3e' : '#c8d3d8';
        c.fillRect(W * 0.46 + k * W * 0.12, y - 0.6 * u, W * 0.07, 2.8 * u);
      }
    }
  }
  // status bar
  c.fillStyle = '#e3e9ec';
  c.fillRect(0, H - 4.5 * u, W, 4.5 * u);
}

// ───────────────────────────── the login screen texture ─────────────────────────────

export interface LoginScreen {
  material: THREE.MeshBasicMaterial;
  draw(state: LoginState, info: LoginInfo): void;
}

const screens = new Map<string, LoginScreen>();

/** one canvas per screen shape (desk monitor, laptop, dispenser), made once and redrawn per login */
export function loginScreen(w: number, h: number): LoginScreen {
  const W = 512;
  const H = Math.round((W * h) / w);
  const key = `${W}x${H}`;
  let s = screens.get(key);
  if (!s) {
    const { canvas, ctx } = makeCanvas(W, H);
    const tex = canvasTexture(canvas);
    const material = own(new THREE.MeshBasicMaterial({ map: tex }));
    // the same boost the world gives every screen (World.ts), so swapping it in doesn't change brightness
    material.color.setScalar(1.55);
    s = {
      material,
      draw(state, info) {
        drawLogin(ctx, W, H, state, info);
        tex.needsUpdate = true;
      },
    };
    screens.set(key, s);
  }
  return s;
}

/** forget the canvases (the textures and materials themselves go with the world's caches) */
export function disposeLoginScreens() {
  screens.clear();
}

// ───────────────────────────── badge and reader art ─────────────────────────────

/** the resident's ID badge (CR80, portrait): photo, name, role band, barcode */
export function badgeTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 204;
  const { canvas, ctx: c } = makeCanvas(W, H);
  c.fillStyle = '#fbfcfc';
  c.fillRect(0, 0, W, H);
  c.fillStyle = TEAL;
  c.fillRect(0, 0, W, 34);
  logo(c, 8, 7, 20);
  c.fillStyle = '#ffffff';
  c.font = `700 11px ${FONT}`;
  c.fillText('AgentClinic', 33, 17);
  c.font = `500 9px ${FONT}`;
  c.fillText('Grand Therapies MC', 33, 28);
  // photo
  c.fillStyle = '#c9d6dc';
  c.fillRect(34, 44, 60, 70);
  c.fillStyle = '#7d8f99';
  c.beginPath();
  c.arc(64, 70, 15, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(64, 114, 26, 18, 0, Math.PI, 0);
  c.fill();
  c.fillStyle = '#16302f';
  c.textAlign = 'center';
  c.font = `800 13px ${FONT}`;
  c.fillText('RESIDENT', 64, 134);
  c.font = `500 9.5px ${FONT}`;
  c.fillStyle = '#4b5f63';
  c.fillText('Emergency Medicine', 64, 147);
  c.fillStyle = '#1c5fa8';
  c.fillRect(0, 156, W, 18);
  c.fillStyle = '#ffffff';
  c.font = `800 11px ${FONT}`;
  c.fillText('PHYSICIAN', 64, 169);
  c.fillStyle = '#16191b';
  for (let x = 20, i = 0; x < 108; i++) {
    const w = 1 + ((i * 7) % 3);
    c.fillRect(x, 181, w, 15);
    x += w + 1 + ((i * 5) % 2);
  }
  return canvasTexture(canvas);
}

/** the contactless mark on a reader's face (light on dark plastic) */
export function readerFaceTexture(): THREE.CanvasTexture {
  const { canvas, ctx: c } = makeCanvas(64, 80);
  c.fillStyle = '#30363b';
  c.fillRect(0, 0, 64, 80);
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 2;
  roundRect(c, 4, 4, 56, 72, 8);
  c.stroke();
  contactless(c, 34, 44, 18, '#c6d2d6');
  return canvasTexture(canvas);
}

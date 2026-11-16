/**
 * Live canvas screens: bedside monitors (vitals + sweeping ECG/pleth), the tracking
 * board, workstation screens, TV, whiteboard and small device screens.
 */
import * as THREE from 'three';
import { alarmPriority } from '../../../shared/alarms';
import type { MonitorView, PatientBoardRow } from '../../../shared/types';
import { clockAt } from '../../../shared/types';
import { beatClock, beatTrain } from '../audio/heartbeat';
import { monitorAudioPaused } from '../audio/monitors';
import { canvasTexture, makeCanvas, own } from './materials';

const ESI_COLORS = ['#b3261e', '#b3261e', '#e8590c', '#e0a10b', '#2f9e44', '#1c7ed6'];

// ───────────────────────────── bedside monitor ─────────────────────────────

export class BedsideMonitor {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private W = 384;
  private Hh = 256;
  private sweepX = 0;
  private lastY = -1;
  private lastPY = -1;
  /** beat-clock time (s) of the last column drawn: the sweep runs in real time */
  private time = 0;
  /** R waves near the sweep, from the patient's shared beat clock (audio/heartbeat.ts): the QRS tone beeps on the same beats */
  private beats: number[] = [];
  private data: MonitorView | null = null;
  private label: string;
  private dirty = true;

  constructor(label: string) {
    const { canvas, ctx } = makeCanvas(this.W, this.Hh);
    this.ctx = ctx;
    this.label = label;
    this.texture = canvasTexture(canvas);
    this.material = own(new THREE.MeshBasicMaterial({ map: this.texture }));
    this.clear();
  }

  set(data: MonitorView | undefined) {
    const had = !!this.data;
    this.data = data ?? null;
    if (data) beatTrain(data.patientId).set(data.hr, data.rhythm);
    if (had !== !!this.data) {
      this.clear();
      this.sweepX = 0;
      this.time = 0;
    }
  }

  private clear() {
    const c = this.ctx;
    c.fillStyle = '#05080a';
    c.fillRect(0, 0, this.W, this.Hh);
    if (!this.data) {
      c.fillStyle = '#1f2a30';
      c.font = '600 18px ui-sans-serif, system-ui, sans-serif';
      c.fillText(this.label.toUpperCase(), 14, 30);
      c.fillStyle = '#2c3a41';
      c.font = '500 15px ui-sans-serif, system-ui, sans-serif';
      c.fillText('STANDBY — no patient connected', 14, 132);
    }
    this.dirty = true;
  }

  /** ECG amplitude for time t (seconds) around beat times */
  private ecg(t: number): number {
    const d = this.data!;
    const st = Math.max(-3, Math.min(4, d.stII ?? 0)) * 0.07;
    let v = 0;
    for (const b of this.beats) {
      const x = t - b;
      if (x < -0.3 || x > 0.6) continue;
      const g = (mu: number, sig: number, a: number) => a * Math.exp(-((x - mu) ** 2) / (2 * sig * sig));
      if (d.rhythm === 'vt') {
        // wide, bizarre complexes without P waves
        v += g(0.0, 0.04, 1.05) + g(0.11, 0.06, -0.5);
        continue;
      }
      if (d.rhythm !== 'afib') v += g(-0.16, 0.025, 0.12);
      v += g(-0.03, 0.012, -0.12) + g(0, 0.016, 1.0) + g(0.034, 0.014, -0.3);
      // ST segment + T wave
      if (x > 0.05 && x < 0.22) v += st * Math.min(1, (x - 0.05) / 0.03) * Math.min(1, (0.22 - x) / 0.04);
      v += g(0.26, 0.05, 0.28 + st * 0.6);
    }
    if (d.rhythm === 'afib') v += 0.035 * Math.sin(t * 2 * Math.PI * 6.3) + 0.02 * Math.sin(t * 2 * Math.PI * 8.7 + 1.3);
    if (d.rhythm === 'vf') v += 0.32 * Math.sin(t * 2 * Math.PI * 5.3) * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 0.7)) + 0.12 * Math.sin(t * 2 * Math.PI * 8.1 + 2);
    return v;
  }

  private pleth(t: number): number {
    let v = 0;
    for (const b of this.beats) {
      const x = t - b - 0.18;
      if (x < 0 || x > 1.2) continue;
      v += Math.exp(-((x - 0.12) ** 2) / 0.006) * 0.9 + Math.exp(-((x - 0.34) ** 2) / 0.01) * 0.35;
    }
    return v;
  }

  /** advance the sweep by dt seconds; returns whether the texture changed */
  tick(dt: number, blink: boolean): void {
    const d = this.data;
    if (!d) {
      if (this.dirty) {
        this.texture.needsUpdate = true;
        this.dirty = false;
      }
      return;
    }
    const c = this.ctx;
    const traceW = 268;
    const pxPerSec = 70;
    void dt;
    // the sweep follows the beat clock in real time (also when this monitor wasn't ticked for a while)
    const now = beatClock();
    if (!this.time || now - this.time > traceW / pxPerSec) {
      this.time = now - 1 / pxPerSec;
      this.lastY = -1;
    }
    const steps = Math.floor((now - this.time) * pxPerSec);
    // beats are known ~1 s ahead, so a P wave is drawn before its R wave and the pleth after it
    this.beats = beatTrain(d.patientId).ensure(now, 1).between(this.time - 1.4, now + 0.35);
    for (let i = 0; i < steps; i++) {
      this.time += 1 / pxPerSec;
      const x = this.sweepX;
      // erase ahead
      c.fillStyle = '#05080a';
      c.fillRect(x, 26, 10, 200);
      const yE = 100 - this.ecg(this.time) * 62;
      const yP = 182 - this.pleth(this.time) * 30;
      if (this.lastY >= 0 && x > 0) {
        c.strokeStyle = '#3cf06b';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x - 1, this.lastY);
        c.lineTo(x, yE);
        c.stroke();
        c.strokeStyle = '#3ad7ff';
        c.beginPath();
        c.moveTo(x - 1, this.lastPY);
        c.lineTo(x, yP);
        c.stroke();
      }
      this.lastY = yE;
      this.lastPY = yP;
      this.sweepX = (x + 1) % traceW;
      if (this.sweepX === 0) this.lastY = -1;
    }
    // numerics column
    c.fillStyle = '#05080a';
    c.fillRect(traceW + 4, 0, this.W - traceW - 4, this.Hh);
    c.fillRect(0, 0, traceW + 4, 26);
    c.fillRect(0, 226, this.W, 30);
    c.fillStyle = '#7d8c94';
    c.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    c.fillText(`${this.label.toUpperCase()}  ·  II`, 8, 18);
    c.fillText('PLETH', 8, 145);
    const num = (label: string, value: string, color: string, y: number, size = 40) => {
      c.fillStyle = color;
      c.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      c.fillText(label, traceW + 12, y - size + 6);
      c.font = `700 ${size}px ui-monospace, Menlo, monospace`;
      c.fillText(value, traceW + 12, y);
    };
    num('HR', String(Math.round(d.hr)), '#3cf06b', 66, 44);
    num('SpO₂', String(Math.round(d.spo2)), '#3ad7ff', 128, 36);
    num('RR', String(Math.round(d.rr)), '#ffd84a', 182, 30);
    c.fillStyle = '#f2f2f2';
    c.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    c.fillText('NIBP', 8, 244);
    c.font = '700 22px ui-monospace, Menlo, monospace';
    const map = Math.round((d.sbp + 2 * d.dbp) / 3);
    c.fillStyle = d.sbp < 90 ? '#ff5b57' : '#f2f2f2';
    c.fillText(`${Math.round(d.sbp)}/${Math.round(d.dbp)} (${map})`, 52, 248);
    if (d.rhythm === 'afib') {
      c.fillStyle = '#ffd84a';
      c.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      c.fillText('AFIB', 230, 244);
    }
    void blink;
    if (d.alarm) {
      // IEC 60601-1-8 visual signal: high priority flashes red at 2 Hz, medium yellow at 0.6 Hz (the tones match)
      const high = (alarmPriority(d) ?? 'medium') === 'high';
      const period = high ? 500 : 1660;
      if (performance.now() % period < period / 2) {
        c.fillStyle = high ? '#d0201c' : '#e8b30b';
        c.fillRect(0, 0, this.W, 24);
        c.fillStyle = high ? '#ffffff' : '#1b1300';
        c.font = '700 14px ui-sans-serif, system-ui, sans-serif';
        c.fillText(`⚠ ${d.alarm}`, 10, 17);
      } else {
        c.fillStyle = '#05080a';
        c.fillRect(0, 0, this.W, 24);
      }
      // the alarm-pause key was pressed (opening the monitor): audio paused, the visual keeps going
      const paused = monitorAudioPaused(d.patientId, now);
      if (paused > 0) {
        const txt = `🔕 ${Math.floor(paused / 60)}:${String(Math.floor(paused % 60)).padStart(2, '0')}`;
        c.font = '700 13px ui-sans-serif, system-ui, sans-serif';
        const w = c.measureText(txt).width + 10;
        c.fillStyle = '#05080a';
        c.fillRect(this.W - w - 4, 2, w + 2, 20);
        c.fillStyle = '#e6e6e6';
        c.fillText(txt, this.W - w + 1, 17);
      }
    }
    this.texture.needsUpdate = true;
  }
}

// ───────────────────────────── tracking board ─────────────────────────────

export class TrackingBoardScreen {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private sig = '';
  private W = 1280;
  private Hh = 360;

  constructor() {
    const { canvas, ctx } = makeCanvas(this.W, this.Hh);
    this.ctx = ctx;
    this.texture = canvasTexture(canvas);
    this.material = own(new THREE.MeshBasicMaterial({ map: this.texture }));
    this.draw([], 0, '22:00');
  }

  update(rows: PatientBoardRow[], t: number, clockStart: string) {
    const minute = Math.floor(t / 60);
    const sig = JSON.stringify([minute, rows.map((r) => [r.id, r.bedLabel, r.esi, r.flowStatus, r.newResults, r.pendingLabs, r.pendingImaging, r.critical, r.nurse, r.dispo])]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.draw(rows, t, clockStart);
  }

  private draw(rows: PatientBoardRow[], t: number, clockStart: string) {
    const c = this.ctx;
    const W = this.W;
    c.fillStyle = '#0b1b26';
    c.fillRect(0, 0, W, this.Hh);
    c.fillStyle = '#0f6e6e';
    c.fillRect(0, 0, W, 46);
    c.fillStyle = '#ffffff';
    c.font = '700 24px ui-sans-serif, system-ui, sans-serif';
    c.fillText('Grand Therapies MC — ED Tracking', 18, 31);
    c.font = '700 26px ui-monospace, Menlo, monospace';
    c.textAlign = 'right';
    c.fillText(clockAt(clockStart, t), W - 18, 32);
    c.textAlign = 'left';
    const cols = [
      { x: 18, h: 'BED' },
      { x: 150, h: 'ESI' },
      { x: 210, h: 'PATIENT' },
      { x: 500, h: 'AGE' },
      { x: 580, h: 'COMPLAINT' },
      { x: 860, h: 'LOS' },
      { x: 950, h: 'RN' },
      { x: 1110, h: 'STATUS' },
    ];
    c.fillStyle = '#7fa4b5';
    c.font = '700 15px ui-sans-serif, system-ui, sans-serif';
    for (const col of cols) c.fillText(col.h, col.x, 70);
    const active = rows.filter((r) => r.flowStatus !== 'Departed');
    const rowH = Math.min(46, (this.Hh - 84) / Math.max(1, active.length));
    active.forEach((r, i) => {
      const y = 84 + i * rowH;
      if (i % 2 === 0) {
        c.fillStyle = 'rgba(255,255,255,0.04)';
        c.fillRect(0, y, W, rowH);
      }
      const mid = y + rowH / 2 + 7;
      c.font = '700 20px ui-sans-serif, system-ui, sans-serif';
      c.fillStyle = '#e6f1f6';
      c.fillText(r.bedLabel, cols[0].x, mid);
      c.fillStyle = ESI_COLORS[r.esi] ?? '#888';
      c.fillRect(cols[1].x, y + rowH / 2 - 14, 30, 28);
      c.fillStyle = r.esi === 3 ? '#1b1300' : '#ffffff';
      c.textAlign = 'center';
      c.fillText(String(r.esi), cols[1].x + 15, mid);
      c.textAlign = 'left';
      c.fillStyle = '#e6f1f6';
      const name = r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name;
      c.fillText(name, cols[2].x, mid);
      c.font = '500 19px ui-sans-serif, system-ui, sans-serif';
      c.fillText(`${r.age}${r.sex}`, cols[3].x, mid);
      const cc = r.chiefComplaint.length > 22 ? r.chiefComplaint.slice(0, 21) + '…' : r.chiefComplaint;
      c.fillText(cc, cols[4].x, mid);
      const los = Math.max(0, Math.floor((t - r.arrivedAt) / 60));
      c.font = '600 19px ui-monospace, Menlo, monospace';
      c.fillText(`${Math.floor(los / 60)}:${String(los % 60).padStart(2, '0')}`, cols[5].x, mid);
      c.font = '500 18px ui-sans-serif, system-ui, sans-serif';
      c.fillText((r.nurse ?? '—').split(',')[0].split(' ')[0], cols[6].x, mid);
      let fx = cols[7].x;
      const flag = (txt: string, bg: string, fg = '#fff') => {
        c.font = '700 13px ui-sans-serif, system-ui, sans-serif';
        const w = c.measureText(txt).width + 12;
        c.fillStyle = bg;
        c.fillRect(fx, y + rowH / 2 - 11, w, 22);
        c.fillStyle = fg;
        c.fillText(txt, fx + 6, y + rowH / 2 + 5);
        fx += w + 5;
      };
      if (r.critical) flag('!', '#d0201c');
      if (r.newResults) flag(`NEW ${r.newResults}`, '#2f9e44');
      if (r.pendingLabs) flag(`LAB ${r.pendingLabs}`, '#2b5f86');
      if (r.pendingImaging) flag('IMG', '#6d4aa8');
      if (r.dispo) flag('DISPO', '#a0731c');
    });
    if (!active.length) {
      c.fillStyle = '#56707d';
      c.font = '500 20px ui-sans-serif, system-ui, sans-serif';
      c.fillText('No patients in department', 18, 120);
    }
    this.texture.needsUpdate = true;
  }
}

// ───────────────────────────── static screens ─────────────────────────────

export function computerScreen(): THREE.MeshBasicMaterial {
  const { canvas, ctx: c } = makeCanvas(256, 148);
  c.fillStyle = '#eef3f5';
  c.fillRect(0, 0, 256, 148);
  c.fillStyle = '#0f6e6e';
  c.fillRect(0, 0, 256, 16);
  c.fillStyle = '#ffffff';
  c.font = '700 10px ui-sans-serif, system-ui, sans-serif';
  c.fillText('AgentChart', 6, 12);
  c.fillStyle = '#dce7ec';
  c.fillRect(0, 16, 46, 132);
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i === 2 ? '#0f6e6e' : '#9fb7c1';
    c.fillRect(6, 24 + i * 14, 34, 6);
  }
  c.fillStyle = '#f7d8d6';
  c.fillRect(52, 22, 198, 14);
  for (let i = 0; i < 7; i++) {
    c.fillStyle = i % 2 ? '#ffffff' : '#f4f7f8';
    c.fillRect(52, 42 + i * 14, 198, 14);
    c.fillStyle = '#7b8f98';
    c.fillRect(56, 47 + i * 14, 60, 4);
    c.fillStyle = i === 3 ? '#d0201c' : '#3d4f57';
    c.fillRect(150, 47 + i * 14, 30, 4);
  }
  return own(new THREE.MeshBasicMaterial({ map: canvasTexture(canvas) }));
}

export function tvScreen(): THREE.MeshBasicMaterial {
  const { canvas, ctx: c } = makeCanvas(512, 288);
  const grad = c.createLinearGradient(0, 0, 512, 288);
  grad.addColorStop(0, '#0f6e6e');
  grad.addColorStop(1, '#173b5e');
  c.fillStyle = grad;
  c.fillRect(0, 0, 512, 288);
  c.fillStyle = '#ffffff';
  c.font = '700 30px ui-sans-serif, system-ui, sans-serif';
  c.fillText('Welcome to Grand Therapies', 28, 70);
  c.font = '500 21px ui-sans-serif, system-ui, sans-serif';
  c.fillText('Patients are seen by urgency, not arrival time.', 28, 130);
  c.fillText('Please tell staff if your symptoms get worse.', 28, 166);
  c.fillStyle = '#9ff0d8';
  c.font = '600 20px ui-sans-serif, system-ui, sans-serif';
  c.fillText('Clean hands save lives  ✋', 28, 236);
  const tex = canvasTexture(canvas);
  tvCanvas = { c, tex };
  return own(new THREE.MeshBasicMaterial({ map: tex }));
}

let tvCanvas: { c: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null = null;

/**
 * While the waiting-room TV talks (audio/spoken.ts), it shows a news channel: the item's headline in
 * a lower third, or the weather. A fictional local channel.
 */
export function showTvItem(kind: 'news' | 'weather', headline: string): void {
  if (!tvCanvas) return;
  const { c, tex } = tvCanvas;
  const W = 512;
  const H = 288;
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, kind === 'weather' ? '#1c4f8a' : '#1d2b44');
  bg.addColorStop(1, kind === 'weather' ? '#3a86c8' : '#3b4f6e');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  if (kind === 'weather') {
    // the forecast card follows what is being said: temperature, when, sun or cloud
    const temp = /(\d+)°/.exec(headline)?.[1];
    const when = headline.split(/[,:]/)[0].toUpperCase();
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = '700 64px ui-sans-serif, system-ui, sans-serif';
    c.fillText(temp ? `${temp}°F` : '—', 270, 140);
    c.font = '600 18px ui-sans-serif, system-ui, sans-serif';
    c.fillText(when.slice(0, 24), 270, 172);
    const sunny = /clear|sun/i.test(headline);
    c.fillStyle = sunny ? '#ffd84a' : '#d9e2ec';
    c.beginPath();
    if (sunny) c.arc(160, 112, 44, 0, Math.PI * 2);
    else
      for (const [x, y, r] of [[130, 120, 34], [170, 104, 42], [212, 122, 30]]) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      }
    c.fill();
  } else {
    // studio: a desk, a backdrop of screens
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 4; i++) c.fillRect(40 + i * 112, 40, 96, 60);
    c.fillStyle = '#0d1626';
    c.fillRect(150, 150, 212, 50);
  }
  const tag = kind === 'weather' ? 'WEATHER' : 'LIVE';
  c.font = '800 17px ui-sans-serif, system-ui, sans-serif';
  const tagW = Math.ceil(c.measureText(tag).width) + 24;
  c.fillStyle = '#c62828';
  c.fillRect(0, 206, tagW, 30);
  c.fillStyle = '#ffffff';
  c.fillText(tag, 12, 227);
  c.fillStyle = 'rgba(8,14,26,0.92)';
  c.fillRect(tagW, 206, W - tagW, 30);
  c.fillRect(0, 236, W, 30);
  c.fillStyle = '#ffffff';
  c.font = '700 16px ui-sans-serif, system-ui, sans-serif';
  const words = headline.split(' ');
  let line = '';
  for (const w of words) {
    if (c.measureText(`${line} ${w}`.toUpperCase()).width > W - tagW - 24) break;
    line = line ? `${line} ${w}` : w;
  }
  c.fillText(line.toUpperCase(), tagW + 12, 227);
  c.fillStyle = '#aab6c8';
  c.font = '600 13px ui-sans-serif, system-ui, sans-serif';
  c.fillText('CHANNEL 7 NEWS · TRAFFIC: ROUTE 9 NORTHBOUND CLOSED OVERNIGHT · FLU SHOTS AT COUNTY CLINICS', 12, 256);
  tex.needsUpdate = true;
}

export function whiteboardScreen(): THREE.MeshLambertMaterial {
  const { canvas, ctx: c } = makeCanvas(640, 388);
  c.fillStyle = '#fbfbf8';
  c.fillRect(0, 0, 640, 388);
  c.font = '700 34px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
  c.fillStyle = '#1d4fa3';
  c.fillText('ED TEAM — TONIGHT', 24, 52);
  c.font = '500 26px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
  c.fillStyle = '#20242a';
  const lines = ['Attending: Dr. Shaw', 'Charge RN: Rosa (x2210)', 'Cath lab on call: Dr. Lindqvist x4410', 'Surgery: Dr. Adeyemi x4520'];
  lines.forEach((l, i) => c.fillText(l, 28, 104 + i * 42));
  c.fillStyle = '#c62828';
  c.font = '700 28px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
  c.fillText('Sepsis? → cultures BEFORE abx!', 28, 300);
  c.fillStyle = '#2e7d32';
  c.fillText('2 identifiers before every med ✔', 28, 346);
  return own(new THREE.MeshLambertMaterial({ map: canvasTexture(canvas) }));
}

export function smallScreen(): THREE.MeshBasicMaterial {
  const { canvas, ctx: c } = makeCanvas(128, 80);
  c.fillStyle = '#0a1a1f';
  c.fillRect(0, 0, 128, 80);
  c.fillStyle = '#2bb3a3';
  c.fillRect(6, 6, 116, 10);
  c.fillStyle = '#5cc8ff';
  for (let i = 0; i < 4; i++) c.fillRect(8, 24 + i * 13, 40 + ((i * 37) % 60), 6);
  return own(new THREE.MeshBasicMaterial({ map: canvasTexture(canvas) }));
}

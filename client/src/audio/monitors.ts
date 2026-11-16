/**
 * Bedside monitors (only patients on continuous monitoring have one running, as in
 * PlayerView.monitors): the QRS/pulse tone on every beat of the shared beat clock, pitched by SpO₂;
 * IEC 60601-1-8 alarm bursts from the shared alarm table (shared/alarms.ts); and the automatic
 * NIBP cuff cycle every 15 game minutes. Opening a monitor (its panel) is pressing its alarm-pause
 * key: AUDIO PAUSED for 2 minutes.
 */
import { alarmPriority, type AlarmPriority } from '../../../shared/alarms';
import type { LayoutDef } from '../../../shared/layout';
import type { MonitorView } from '../../../shared/types';
import { AlarmState, QRS_TONE, alarmTone, burstLength, hasQrs, qrsToneHz } from './clinical';
import { Emitter, dB, type Engine, type Vec3, type Voice } from './engine';
import { beatTrain } from './heartbeat';
import { alarmBurst, mulberry, nibpCycle, qrsBeep } from './synth';

/** heard at perf time b + QRS_DELAY: the tone follows the R wave by the detection delay */
const QRS_DELAY = 0.03;
/**
 * Beats are scheduled at least 1 s ahead on the audio clock (longer while frames come slowly), so a
 * stalled frame (a shader compile, a busy GPU) never drops a beep; a beat up to LATE seconds
 * overdue still sounds, a hair late. HR changes reach the tone within about a second, as a
 * monitor's own averaging would.
 */
const LOOKAHEAD = 1;
const LOOKAHEAD_MAX = 1.6;
const LATE = 0.15;
const NIBP_EVERY_GAME_S = 15 * 60;
/**
 * Levels re NPC speech (clips at about −21 dBFS): at the foot of the bed the QRS tone sits ~10 dB
 * under a voice there, like a monitor's beep (~45 dBA) under conversation (~55 dBA); an alarm about
 * as loud as the voice. Night mode turns the beat tone down.
 */
// the cuff pump is inside the monitor and muffled: a quiet hum you notice at the bedside, not down the hall
const LEVEL = { qrs: dB(-19), qrsNight: dB(-23), high: dB(-13), medium: dB(-13), nibp: dB(-35) };

interface Bay {
  id: string;
  qrsEm: Emitter;
  alarmEm: Emitter;
  data?: MonitorView;
  alarm: AlarmState;
  /** beat times (perf s) up to which beeps are scheduled */
  beepedUntil: number;
  burst?: { voice: Voice; priority: AlarmPriority; endsAt: number };
  nextBurstAt: number;
  nibpGameT: number;
  nibpRealAt: number;
  /** counters for tests and the debug hook */
  beeps: number;
  bursts: number;
}

/** what the 3D monitor may show about its audio: paused alarms (IEC "AUDIO PAUSED") */
const audioPausedUntil = new Map<string, number>();
export function monitorAudioPaused(patientId: string, perfNow: number): number {
  const until = audioPausedUntil.get(patientId) ?? 0;
  return until > perfNow ? until - perfNow : 0;
}

export class Monitors {
  private bays = new Map<string, Bay>();
  private rand = mulberry(42);
  private qrs = new Map<number, () => AudioBuffer>();
  private lookahead = LOOKAHEAD;
  private burstBuf: Record<AlarmPriority, () => AudioBuffer>;
  private nibpBuf: () => AudioBuffer;

  /** perfToCtx: performance-clock → audio-clock mapping for beat-exact scheduling */
  constructor(private eng: Engine, layout: LayoutDef, private perfToCtx: (perfSec: number) => number) {
    const sr = eng.sr;
    this.burstBuf = {
      high: eng.sound('alarm:high', () => alarmBurst(sr, alarmTone('high'))),
      medium: eng.sound('alarm:medium', () => alarmBurst(sr, alarmTone('medium'))),
    };
    this.nibpBuf = eng.sound('nibp', () => nibpCycle(sr, mulberry(43)));
    for (let s = 100; s >= 80; s--) this.qrsBuf(qrsToneHz(s));
    for (const p of layout.props) {
      if (p.kind !== 'monitor') continue;
      const id = p.bay ?? p.room;
      if (this.bays.has(id)) continue;
      const pos: Vec3 = { x: p.x, y: p.y ?? 1.55, z: p.z };
      this.bays.set(id, {
        id,
        qrsEm: new Emitter(eng, pos, { ref: 1.2, rolloff: 1.3, range: 24 }),
        alarmEm: new Emitter(eng, pos, { ref: 1.2, rolloff: 0.9, range: 45 }),
        alarm: new AlarmState(this.rand),
        beepedUntil: 0,
        nextBurstAt: 0,
        nibpGameT: Infinity,
        nibpRealAt: 0,
        beeps: 0,
        bursts: 0,
      });
    }
  }

  /** latest monitors from the view (keyed by bay) */
  view(monitors: Record<string, MonitorView> | undefined, gameT: number): void {
    for (const b of this.bays.values()) {
      const m = monitors?.[b.id];
      if (m && !b.data) b.nibpGameT = gameT + 20 + this.rand() * 60; // first cuff reading soon after hook-up
      if (!m && b.data) b.nibpGameT = Infinity;
      b.data = m;
      if (m) beatTrain(m.patientId).set(m.hr, m.rhythm);
    }
  }

  /** the alarm-pause key of the monitor in `bay` */
  acknowledge(bay: string, perfNow: number): void {
    this.bays.get(bay)?.alarm.acknowledge(perfNow);
  }

  /** frameGap: the longest recent gap between sound frames (s) */
  frame(perfNow: number, gameT: number, night: boolean, frameGap = 0.033): void {
    const ctxNow = this.eng.now;
    this.lookahead = Math.min(LOOKAHEAD_MAX, Math.max(LOOKAHEAD, frameGap * 2.5));
    const alarming: Bay[] = [];
    for (const b of this.bays.values()) {
      b.qrsEm.update();
      b.alarmEm.update();
      const m = b.data;
      b.alarm.update(m ? alarmPriority(m) : null, perfNow);
      if (m) audioPausedUntil.set(m.patientId, perfNow + b.alarm.pauseRemaining(perfNow));
      if (!m) {
        this.stopBurst(b);
        continue;
      }
      this.beeps(b, m, perfNow, night);
      const p = b.alarm.audible(perfNow);
      if (p) alarming.push(b);
      this.alarms(b, p, ctxNow);
      if (gameT >= b.nibpGameT) {
        b.nibpGameT = gameT + NIBP_EVERY_GAME_S;
        if (perfNow - b.nibpRealAt > 60) {
          b.nibpRealAt = perfNow;
          if (b.qrsEm.play(this.nibpBuf(), 0, { gain: LEVEL.nibp })) this.eng.count('nibp');
        }
      }
    }
    // HRTF (precise direction) only for the two nearest alarming monitors
    alarming.sort((a, b) => a.alarmEm.dist - b.alarmEm.dist);
    for (const b of this.bays.values()) b.alarmEm.setHrtf(alarming.indexOf(b) >= 0 && alarming.indexOf(b) < 2 && b.alarmEm.dist < 15);
  }

  private beeps(b: Bay, m: MonitorView, perfNow: number, night: boolean): void {
    const tr = beatTrain(m.patientId).ensure(perfNow, this.lookahead + 0.3);
    const from = Math.max(b.beepedUntil, perfNow - LATE);
    const to = perfNow + this.lookahead;
    b.beepedUntil = to;
    if (!hasQrs(m.rhythm) || !b.qrsEm.inRange()) return;
    const buf = this.qrsBuf(qrsToneHz(m.spo2))();
    for (const beat of tr.between(from, to)) {
      if (b.qrsEm.play(buf, this.perfToCtx(beat + QRS_DELAY), { gain: night ? LEVEL.qrsNight : LEVEL.qrs })) b.beeps++;
    }
  }

  private alarms(b: Bay, p: AlarmPriority | null, ctxNow: number): void {
    if (!p) {
      this.stopBurst(b);
      b.nextBurstAt = 0;
      return;
    }
    if (b.burst && b.burst.priority !== p) {
      // escalation/de-escalation: the new signal starts at once
      this.stopBurst(b);
      b.nextBurstAt = 0;
    }
    if (b.burst && ctxNow > b.burst.endsAt) b.burst = undefined;
    if (b.burst || ctxNow < b.nextBurstAt - 0.05 || !b.alarmEm.inRange()) return;
    const tone = alarmTone(p);
    const at = Math.max(ctxNow + 0.05, b.nextBurstAt);
    const voice = b.alarmEm.play(this.burstBuf[p](), at, { gain: LEVEL[p] * tone.gain });
    const len = burstLength(tone);
    if (voice) {
      b.burst = { voice, priority: p, endsAt: at + len };
      b.bursts++;
    }
    b.nextBurstAt = at + len + tone.interburst;
  }

  /** the beep for one SpO₂ step (pre-rendered for 80–100 %) */
  private qrsBuf(hz: number): () => AudioBuffer {
    const k = Math.round(hz * 10);
    let g = this.qrs.get(k);
    if (!g) {
      g = this.eng.sound(`qrs:${k}`, () => qrsBeep(this.eng.sr, hz, QRS_TONE.durSec));
      this.qrs.set(k, g);
    }
    return g;
  }

  private stopBurst(b: Bay): void {
    if (!b.burst) return;
    b.burst.voice.stop(0.04);
    b.burst = undefined;
  }

  /** for tests and the debug hook */
  stats(perfNow: number) {
    const out: { bay: string; patientId: string; hr: number; spo2: number; toneHz: number; alarm: AlarmPriority | null; beeps: number; bursts: number }[] = [];
    for (const b of this.bays.values()) {
      if (!b.data) continue;
      const d = b.data;
      out.push({ bay: b.id, patientId: d.patientId, hr: d.hr, spo2: d.spo2, toneHz: Math.round(qrsToneHz(d.spo2)), alarm: b.alarm.audible(perfNow), beeps: b.beeps, bursts: b.bursts });
    }
    return out;
  }

  dispose(): void {
    for (const b of this.bays.values()) {
      this.stopBurst(b);
      b.qrsEm.dispose();
      b.alarmEm.dispose();
    }
    this.bays.clear();
  }
}

/**
 * Soundscape rules that must be clinically right: monitor alarm table (shared with the server's
 * banner), IEC 60601-1-8 burst timing, SpO₂ pitch mapping, the shared beat clock, and the
 * synthesized sounds (finite, no clipping).
 */
import { describe, expect, it } from 'vitest';
import { ALARM_LIMITS, alarmPriority, monitorAlarms } from '../shared/alarms';
import { ALARM_AUDIO, AlarmState, IEC_TIMING, alarmTone, burstLength, hasQrs, qrsToneHz } from '../client/src/audio/clinical';
import { BeatTrain } from '../client/src/audio/heartbeat';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('monitor alarm table', () => {
  it('keeps the banner labels the monitor always showed', () => {
    const labels = (v: Parameters<typeof monitorAlarms>[0]) => monitorAlarms(v).map((a) => a.label);
    expect(labels({ hr: 80, sbp: 120, spo2: 98 })).toEqual([]);
    expect(labels({ hr: 44, sbp: 89, spo2: 89 })).toEqual(['SBP LOW', 'HR LOW', 'SpO₂ LOW']);
    expect(labels({ hr: 141, sbp: 90, spo2: 90 })).toEqual(['HR HIGH']);
    expect(labels({ hr: 45, sbp: 90, spo2: 90 })).toEqual([]);
    expect(labels({ hr: 140, sbp: 120, spo2: 97 })).toEqual([]);
  });
  it('raises life-threatening extremes to high priority', () => {
    expect(alarmPriority({ hr: 134, sbp: 112, spo2: 96, rhythm: 'afib' })).toBeNull();
    expect(alarmPriority({ hr: 150, sbp: 112, spo2: 96 })).toBe('medium');
    expect(alarmPriority({ hr: 165, sbp: 112, spo2: 96 })).toBe('high');
    expect(alarmPriority({ hr: 39, sbp: 112, spo2: 96 })).toBe('high');
    expect(alarmPriority({ hr: 80, sbp: 85, spo2: 96 })).toBe('medium');
    expect(alarmPriority({ hr: 80, sbp: 68, spo2: 96 })).toBe('high');
    expect(alarmPriority({ hr: 80, sbp: 120, spo2: 87 })).toBe('medium');
    expect(alarmPriority({ hr: 80, sbp: 120, spo2: 84 })).toBe('high');
    expect(ALARM_LIMITS.high.spo2Below).toBeLessThan(ALARM_LIMITS.medium.spo2Below);
  });
  it('alarms on lethal rhythms whatever the computed rate', () => {
    expect(monitorAlarms({ hr: 0, sbp: 0, spo2: 70, rhythm: 'asystole' })[0]).toEqual({ label: 'ASYSTOLE', priority: 'high' });
    expect(monitorAlarms({ hr: 180, sbp: 80, spo2: 90, rhythm: 'vt' }).map((a) => a.label)).toEqual(['VTACH', 'SBP LOW']);
    expect(alarmPriority({ hr: 300, sbp: 0, spo2: 60, rhythm: 'vf' })).toBe('high');
  });
});

describe('IEC 60601-1-8 alarm bursts', () => {
  const spacing = (t: ReturnType<typeof alarmTone>) => t.pulses.slice(1).map((p, i) => p.at - (t.pulses[i].at + t.pulses[i].dur));
  it('high priority: 10 pulses, 3 + 2, pause, 3 + 2', () => {
    const t = alarmTone('high');
    expect(t.pulses).toHaveLength(10);
    const { x, td } = IEC_TIMING.high;
    expect(x).toBeGreaterThanOrEqual(0.05);
    expect(x).toBeLessThanOrEqual(0.125);
    for (const p of t.pulses) {
      expect(p.dur).toBeGreaterThanOrEqual(0.075);
      expect(p.dur).toBeLessThanOrEqual(0.2);
    }
    const s = spacing(t);
    const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
    [0, 1, 3, 5, 6, 8].forEach((i) => near(s[i], x));
    near(s[2], 2 * x + td);
    near(s[7], 2 * x + td);
    expect(s[4]).toBeGreaterThanOrEqual(0.35);
    expect(s[4]).toBeLessThanOrEqual(1.3);
    expect(t.interburst).toBeGreaterThanOrEqual(2.5);
    expect(t.interburst).toBeLessThanOrEqual(15);
    expect(burstLength(t)).toBeLessThan(4);
  });
  it('medium priority: 3 slower pulses, quieter than high', () => {
    const t = alarmTone('medium');
    expect(t.pulses).toHaveLength(3);
    for (const g of spacing(t)) {
      expect(g).toBeGreaterThanOrEqual(0.125);
      expect(g).toBeLessThanOrEqual(0.25);
    }
    for (const p of t.pulses) {
      expect(p.dur).toBeGreaterThanOrEqual(0.125);
      expect(p.dur).toBeLessThanOrEqual(0.25);
    }
    expect(t.interburst).toBeGreaterThanOrEqual(2.5);
    expect(t.interburst).toBeLessThanOrEqual(30);
    expect(t.gain).toBeLessThan(alarmTone('high').gain);
  });
  it('pulse spectrum: f0 150–1000 Hz, ≥ 4 harmonics in 300–4000 Hz within ±15 dB, rise 10–20 % of td', () => {
    for (const pr of ['high', 'medium'] as const) {
      const t = alarmTone(pr);
      expect(t.f0).toBeGreaterThanOrEqual(150);
      expect(t.f0).toBeLessThanOrEqual(1000);
      const strong = t.harmonics.filter((a, i) => i > 0 && (i + 1) * t.f0 >= 300 && (i + 1) * t.f0 <= 4000 && Math.abs(20 * Math.log10(a)) <= 15);
      expect(strong.length).toBeGreaterThanOrEqual(4);
      const td = t.pulses[0].dur;
      expect(t.rise / td).toBeGreaterThanOrEqual(0.1);
      expect(t.rise / td).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('alarm audio state', () => {
  it('waits for the alarm delay, clears with hysteresis, pauses on acknowledge', () => {
    const a = new AlarmState(() => 0.5);
    a.update('medium', 0);
    expect(a.audible(1)).toBeNull();
    a.update('medium', ALARM_AUDIO.onsetSec.medium);
    expect(a.audible(ALARM_AUDIO.onsetSec.medium)).toBe('medium');
    a.update(null, 6);
    a.update(null, 7);
    expect(a.audible(7)).toBe('medium'); // still within the clear delay
    a.update(null, 8.5);
    expect(a.audible(8.5)).toBeNull();
    // escalation to red breaks through a yellow pause
    a.update('medium', 10);
    a.update('medium', 16);
    a.acknowledge(16);
    expect(a.audible(17)).toBeNull();
    a.update('high', 20);
    a.update('high', 23);
    expect(a.audible(23)).toBe('high');
  });
  it('a nurse silences an unattended yellow alarm; red keeps sounding', () => {
    const y = new AlarmState(() => 0);
    for (let t = 0; t <= 60; t += 1) y.update('medium', t);
    expect(y.audible(60)).toBeNull();
    const r = new AlarmState(() => 0);
    for (let t = 0; t <= 300; t += 1) r.update('high', t);
    expect(r.audible(300)).toBe('high');
  });
});

describe('SpO₂ tone and beat clock', () => {
  it('pitch falls with saturation: 662 Hz at 100 %, an octave per 24 %, stepped per percent', () => {
    expect(qrsToneHz(100)).toBeCloseTo(662, 6);
    expect(qrsToneHz(76)).toBeCloseTo(331, 6);
    expect(qrsToneHz(97.4)).toBe(qrsToneHz(97));
    for (let s = 60; s < 100; s++) expect(qrsToneHz(s)).toBeLessThan(qrsToneHz(s + 1));
    expect(qrsToneHz(30)).toBe(qrsToneHz(50));
    expect(hasQrs('sinus') && hasQrs('afib') && !hasQrs('vf') && !hasQrs('asystole')).toBe(true);
  });
  it('beats follow the HR; AF is irregular; asystole is silent', () => {
    const count = (hr: number, rhythm: string) => {
      const tr = new BeatTrain(seeded(7)).set(hr, rhythm);
      const seen = new Set<number>();
      for (let t = 0; t < 70; t += 0.05) for (const b of tr.ensure(t, 1).between(5, 65)) seen.add(b);
      return [...seen].sort((a, b) => a - b);
    };
    const sinus = count(72, 'sinus');
    expect(sinus.length).toBeGreaterThanOrEqual(70);
    expect(sinus.length).toBeLessThanOrEqual(74);
    const af = count(120, 'afib');
    expect(Math.abs(af.length - 120)).toBeLessThanOrEqual(10);
    const rr = af.slice(1).map((b, i) => b - af[i]);
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const cv = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length) / mean;
    expect(cv).toBeGreaterThan(0.15);
    expect(count(0, 'asystole')).toHaveLength(0);
    expect(count(250, 'vf')).toHaveLength(0);
  });
});

describe('synthesized sounds', () => {
  it('render finite, unclipped PCM at common sample rates', async () => {
    const S = await import('../client/src/audio/synth');
    for (const sr of [24000, 44100, 48000]) {
      const r = S.mulberry(3);
      const sounds: Record<string, Float32Array> = {
        qrs: S.qrsBeep(sr, qrsToneHz(94)),
        high: S.alarmBurst(sr, alarmTone('high')),
        medium: S.alarmBurst(sr, alarmTone('medium')),
        nibp: S.nibpCycle(sr, r),
        ring: S.deskRing(sr),
        mobile: S.mobileRing(sr, r),
        vibrate: S.vibrate(sr, r),
        pickup: S.handset(sr, r, false),
        hangup: S.handset(sr, r, true),
        stepVinyl: S.footstep(sr, r, 'vinyl'),
        stepAsphalt: S.footstep(sr, r, 'asphalt', true),
        door: S.slidingDoor(sr, r, true),
        printer: S.printerJob(sr, r),
        label: S.labelPrinter(sr, r),
        pump: S.pumpBeeps(sr),
        typing: S.typing(sr, r),
        call: S.nurseCall(sr),
        tube: S.tubeArrival(sr, r),
        thud: S.thud(sr, r),
        cart: S.cartRoll(sr, r),
        swing: S.doorClose(sr, r),
        reverse: S.reverseBeep(sr),
        earbuds: S.earbuds(sr, r),
        fridge: S.hum(sr, r, 'fridge'),
        vending: S.hum(sr, r, 'vending'),
        ...Object.fromEntries(S.roomToneBed(sr, r).map((c, i) => [`room${i}`, c])),
        ...Object.fromEntries(S.roomIR(sr, r).map((c, i) => [`ir${i}`, c])),
      };
      for (const [name, x] of Object.entries(sounds)) {
        expect(x.length, name).toBeGreaterThan(0);
        let bad = 0;
        for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) bad++;
        expect(bad, name).toBe(0);
        expect(S.peak(x), name).toBeLessThanOrEqual(1);
        expect(S.peak(x), name).toBeGreaterThan(0.01);
      }
      // the QRS beep is at the tone the oximeter mapping asks for: count zero crossings
      const q = S.qrsBeep(sr, 600, 0.08);
      let zc = 0;
      for (let i = 1; i < q.length; i++) if (q[i - 1] < 0 && q[i] >= 0) zc++;
      expect(Math.abs(zc / 0.08 - 600)).toBeLessThan(40);
      // 2 s hum loops wrap without a click: the seam step is like any other step
      const h = S.hum(sr, S.mulberry(5), 'fridge');
      expect(h.length).toBe(2 * sr);
      let maxStep = 0;
      for (let i = 1; i < h.length; i++) maxStep = Math.max(maxStep, Math.abs(h[i] - h[i - 1]));
      expect(Math.abs(h[0] - h[h.length - 1])).toBeLessThanOrEqual(maxStep * 1.05);
    }
  });
});

describe('department rules', () => {
  it('infusion pumps only where the chart shows a running infusion', async () => {
    const { infusing } = await import('../client/src/audio/life');
    type Chart = Parameters<typeof infusing>[0];
    const chart = (mar: unknown[], orders: unknown[]) => ({ mar, orders }) as unknown as Chart;
    expect(infusing(chart([], []))).toBe(false);
    expect(infusing(chart([{ status: 'Given', med: 'Aspirin', route: 'PO', t: 60 }], []))).toBe(false);
    expect(infusing(chart([{ status: 'Started', orderId: 'o1', med: 'NS bolus', route: 'IV', t: 60 }], []))).toBe(true);
    expect(infusing(chart([{ status: 'Started', orderId: 'o1', med: 'NS', t: 60 }, { status: 'Stopped', orderId: 'o1', med: 'NS', t: 1900 }], []))).toBe(false);
    expect(infusing(chart([], [{ category: 'med', status: 'Active', name: 'Heparin (UFH) bolus + infusion, ACS nomogram', params: { frequency: 'continuous' } }]))).toBe(true);
    expect(infusing(chart([], [{ category: 'nursing', status: 'Active', name: 'Continuous cardiac monitoring + pulse oximetry' }]))).toBe(false);
  });
  it('the radio host gives the time the way people say it', async () => {
    const { spokenTime } = await import('../client/src/audio/radio');
    expect(spokenTime(23, 5)).toBe('eleven oh five');
    expect(spokenTime(0, 0)).toBe("twelve o'clock");
    expect(spokenTime(13, 45)).toBe('one forty-five');
    expect(spokenTime(22, 30)).toBe('ten thirty');
    expect(spokenTime(6, 17)).toBe('six seventeen');
  });
  it('footstep cadence: ~1.9 steps/s walking (0.7 m steps), ~2.8 running at 5 m/s', async () => {
    const { cadence } = await import('../client/src/audio/movement');
    expect(cadence(1.3)).toBeCloseTo(1.875, 3);
    expect(1.3 / cadence(1.3)).toBeGreaterThan(0.6);
    expect(1.3 / cadence(1.3)).toBeLessThan(0.8);
    expect(cadence(5)).toBeCloseTo(2.8, 3);
  });
});

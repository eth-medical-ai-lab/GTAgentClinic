import { useEffect, useRef } from 'react';
import type { MonitorView } from '../../../shared/types';
import { beatClock, beatTrain } from '../audio/heartbeat';
import { store, useStore } from '../store';

/** Fullscreen-ish bedside monitor with a live, procedurally drawn ECG/pleth trace. */
export function MonitorPanel({ bay }: { bay: string }) {
  const mon = useStore((s) => s.view?.monitors[bay]);
  const row = useStore((s) => s.view?.board.find((r) => r.bed === bay && r.flowStatus !== 'Departed'));
  const ref = useRef<HTMLCanvasElement>(null);
  const monRef = useRef<MonitorView | undefined>(mon);
  monRef.current = mon;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    let x = 0;
    const ecgY: number[] = [];
    const plethY: number[] = [];
    const W = cv.width;
    const H = cv.height;
    const speed = 160; // px per second, in real time
    let lastT = beatClock();
    const draw = () => {
      const m = monRef.current;
      const now = beatClock();
      const steps = Math.min(W, Math.round((now - lastT) * speed));
      lastT += steps / speed;
      // the patient's shared beat clock: these R waves are the ones the QRS tone beeps on
      const train = m ? beatTrain(m.patientId).set(m.hr, m.rhythm).ensure(now, 1) : null;
      for (let i = 0; i < steps; i++) {
        const t = lastT - (steps - 1 - i) / speed;
        if (!m || !train) {
          ecgY[x] = 0;
          plethY[x] = 0;
        } else {
          // this kernel puts the R wave 0.16 s into the cycle
          const b = train.lastAtOrBefore(t + 0.16);
          const next = train.firstAfter(b);
          const nextRR = Number.isFinite(next) ? next - b : 60 / Math.max(25, m.hr);
          const lastBeat = Number.isFinite(b) ? b - 0.16 : t - 1;
          const ph = t - lastBeat;
          const st = (m.stII ?? 0) * 0.1;
          let y = 0;
          if (m.rhythm !== 'afib') y += 0.12 * Math.exp(-(((ph - 0.06) / 0.025) ** 2));
          else y += 0.03 * Math.sin(t * 47) + 0.02 * Math.sin(t * 31);
          y += -0.12 * Math.exp(-(((ph - 0.14) / 0.008) ** 2));
          y += 1.0 * Math.exp(-(((ph - 0.16) / 0.009) ** 2));
          y += -0.25 * Math.exp(-(((ph - 0.18) / 0.01) ** 2));
          y += st * (ph > 0.19 && ph < 0.36 ? 1 : 0);
          y += (0.25 + st) * Math.exp(-(((ph - 0.36) / 0.05) ** 2));
          ecgY[x] = y;
          const pp = (ph % nextRR) / nextRR;
          plethY[x] = Math.max(0, Math.sin(Math.PI * Math.min(1, pp * 2.2)) * (pp < 0.45 ? 1 : 0.55)) * (m.spo2 > 90 ? 1 : 0.6);
        }
        x = (x + 1) % W;
      }
      ctx.fillStyle = '#05080a';
      ctx.fillRect(0, 0, W, H);
      const lane = (arr: number[], y0: number, scale: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < W; i++) {
          if (Math.abs(i - x) < 12) {
            ctx.stroke();
            ctx.beginPath();
            continue;
          }
          const yy = y0 - (arr[i] ?? 0) * scale;
          if (i === 0 || Math.abs(i - x) === 12) ctx.moveTo(i, yy);
          else ctx.lineTo(i, yy);
        }
        ctx.stroke();
      };
      lane(ecgY, H * 0.42, H * 0.28, '#3cff6e');
      lane(plethY, H * 0.9, H * 0.22, '#3bd6ff');
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="monitor-panel panel">
      <button className="close-x" onClick={() => store.set({ panel: null })}>
        ×
      </button>
      <div className="mp-title">
        {row ? `${row.bedLabel} — ${row.name}` : bay} {mon?.alarm && <span className="mp-alarm">⚠ {mon.alarm}</span>}
      </div>
      <div className="mp-body">
        <canvas ref={ref} width={640} height={300} />
        <div className="mp-nums">
          <div className="mp-n hr">
            <span>HR {mon?.rhythm === 'afib' ? 'AF' : ''}</span>
            {mon?.hr ?? '--'}
          </div>
          <div className="mp-n bp">
            <span>NIBP</span>
            {mon ? `${mon.sbp}/${mon.dbp}` : '--/--'}
            <small>{mon ? `(${Math.round((mon.sbp + 2 * mon.dbp) / 3)})` : ''}</small>
          </div>
          <div className="mp-n spo2">
            <span>SpO₂</span>
            {mon?.spo2 ?? '--'}
          </div>
          <div className="mp-n rr">
            <span>RR</span>
            {mon?.rr ?? '--'}
          </div>
        </div>
      </div>
      {!mon && <div className="dim" style={{ padding: 12 }}>No patient connected to this monitor.</div>}
    </div>
  );
}

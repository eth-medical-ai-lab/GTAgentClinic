/**
 * The doctor's tablet with nobody to talk to (Tab): AgentChart Mobile's patient list, at your side,
 * so you can keep walking. A patient opens their full chart (AgentChart). The department's tracking
 * board is on the workstations and the wall: Tab used to put it full screen anywhere, which no ED has.
 * Tab again (or Esc, or ×) puts the tablet away.
 */
import { clockAt, dischargeStatus, lengthOfStay, type PatientBoardRow } from '../../../shared/types';
import { store, useStore } from '../store';
import { fmtLos } from './ehr/util';
import { useTuck } from './tuck';

export function TabletHome() {
  const view = useStore((s) => s.view);
  const { ref, off, tucking, handlers } = useTuck<HTMLDivElement>({
    minimized: false,
    onTuck: () => store.set({ panel: null }),
  });
  if (!view) return null;
  // the sickest first, then who has waited longest
  const rows = [...view.board].sort((a, b) => a.esi - b.esi || a.arrivedAt - b.arrivedAt);
  const gestureStyle = off ? { transform: `perspective(1600px) translate(${off.x}px, ${off.y}px) rotateY(-7deg) rotateX(3deg) rotateZ(0.5deg)`, transition: 'transform 0.06s linear' } : undefined;
  return (
    <div ref={ref} className={`tablet${tucking ? ' tucking' : ''}`} style={gestureStyle} role="dialog" aria-label="Tablet: patients" {...handlers}>
      <div className="tablet-cam" />
      <div className="tablet-screen">
        <div className="tablet-status">
          <span className="mono">{clockAt(view.clockStart, view.t)}</span>
          <span>AgentChart Mobile</span>
          <span>Wi‑Fi · 86%</span>
        </div>
        <button className="close-x" onClick={() => store.set({ panel: null })} title="Put it away (Tab or Esc)">
          ×
        </button>
        <div className="sp-head">
          <div>
            <b>Patients</b>
            <div className="dim">{rows.filter((r) => r.flowStatus !== 'Departed').length} in the department</div>
          </div>
        </div>
        <div className="th-list">
          {rows.map((r) => (
            <Row key={r.id} r={r} t={view.t} />
          ))}
        </div>
        <div className="tablet-hint">Tap a patient for the full chart · the tracking board is on the workstations</div>
      </div>
    </div>
  );
}

function Row({ r, t }: { r: PatientBoardRow; t: number }) {
  return (
    <button className={`th-row${r.critical ? ' crit' : ''}`} onClick={() => store.set({ panel: { kind: 'ehr', patientId: r.id } })} title={`Open ${r.name}'s chart`}>
      <span className={`th-esi tb-esi-${r.esi}`} title={`Triage ESI ${r.esi} (1 = most critical, 5 = least urgent)`}>{r.esi}</span>
      <span className="th-main">
        <span>
          <b>{r.bedLabel}</b> · {r.name}, {r.age} {r.sex}
        </span>
        <span className="dim">{r.discharge ? dischargeStatus(r.discharge) : r.chiefComplaint}</span>
      </span>
      <span className="th-side">
        {r.newResults > 0 && <span className="th-new">{r.newResults} new</span>}
        <span className="dim mono">{fmtLos(lengthOfStay(r, t))}</span>
      </span>
    </button>
  );
}

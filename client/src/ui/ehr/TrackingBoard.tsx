/**
 * ED tracking board — the "big screen" overview of every patient in the department.
 * Used fullscreen (a workstation's board) in a dark wall-display style, and inside AgentChart (light).
 */
import { useMemo } from 'react';
import type { Action, ActionResult, PatientBoardRow, PlayerView, UnitSystem } from '../../../../shared/types';
import { dischargeStatus, DISPO_LABELS, clockAt, lengthOfStay } from '../../../../shared/types';
import { classNames, fmtLos } from './util';
import './ehr.css';

export interface TrackingBoardProps {
  view: PlayerView;
  units: UnitSystem;
  onOpenChart?: (patientId: string) => void;
  onClose?: () => void;
  /** optional — falls back to the global client when not provided */
  onAction?: (a: Action) => Promise<ActionResult>;
}

export function sortBoard(rows: PatientBoardRow[]): PatientBoardRow[] {
  return [...rows].sort((a, b) => {
    const da = a.flowStatus === 'Departed' ? 1 : 0;
    const db = b.flowStatus === 'Departed' ? 1 : 0;
    return da - db || a.esi - b.esi || a.arrivedAt - b.arrivedAt;
  });
}

export function BoardTable({
  view,
  variant,
  onOpenChart,
  selectedId,
}: {
  view: PlayerView;
  variant: 'dark' | 'light';
  onOpenChart?: (pid: string) => void;
  selectedId?: string | null;
}) {
  const rows = useMemo(() => sortBoard(view.board), [view.board]);

  return (
    <div className={classNames('tb-wrap', variant === 'dark' ? 'tb-dark' : 'tb-light')}>
      <table className="tb-table">
        <thead>
          <tr>
            <th style={{ width: 92 }}>Bed</th>
            <th style={{ width: 46 }}>ESI</th>
            <th>Patient</th>
            <th>Chief complaint</th>
            <th style={{ width: 62 }}>LOS</th>
            <th>RN</th>
            <th>Status</th>
            <th>Dispo</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="tb-empty">
                No patients in the department.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const departed = r.flowStatus === 'Departed';
            const los = lengthOfStay(r, view.t);
            const longWait = los > 4 * 3600;
            return (
              <tr
                key={r.id}
                className={classNames('tb-row', departed && 'tb-departed', r.critical && 'tb-critical', selectedId === r.id && 'tb-selected')}
                onClick={() => onOpenChart?.(r.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenChart?.(r.id);
                }}
              >
                <td className="tb-bed">{r.bedLabel}</td>
                <td>
                  <span className={`tb-esi tb-esi-${r.esi}`}>{r.esi}</span>
                </td>
                <td>
                  <div className="tb-name">{r.name}</div>
                  <div className="tb-sub">
                    {r.age} y {r.sex} · {r.discharge ? dischargeStatus(r.discharge) : r.flowStatus}
                  </div>
                </td>
                <td className="tb-cc">{r.chiefComplaint}</td>
                <td className={classNames('tb-los', longWait && 'tb-los-long')}>{fmtLos(los)}</td>
                <td className="tb-staff">{r.nurse ? r.nurse.replace(/, RN$/, '') : '—'}</td>
                <td>
                  <div className="tb-icons">
                    {r.critical && (
                      <span className="tb-ic tb-ic-crit" title="Critical result / alert">
                        !!
                      </span>
                    )}
                    {r.newResults > 0 && (
                      <span className="tb-ic tb-ic-new" title={`${r.newResults} new result(s)`}>
                        NEW {r.newResults}
                      </span>
                    )}
                    {r.pendingLabs > 0 && (
                      <span className="tb-ic tb-ic-lab" title={`${r.pendingLabs} lab order(s) pending`}>
                        LAB {r.pendingLabs}
                      </span>
                    )}
                    {r.pendingImaging > 0 && (
                      <span className="tb-ic tb-ic-img" title={`${r.pendingImaging} imaging study(ies) pending`}>
                        IMG {r.pendingImaging}
                      </span>
                    )}
                    {r.alerts.length > 0 && (
                      <span className="tb-ic tb-ic-alert" title={r.alerts.join('\n')}>
                        ⚠
                      </span>
                    )}
                    {!r.critical && r.newResults === 0 && r.pendingLabs === 0 && r.pendingImaging === 0 && r.alerts.length === 0 && <span className="tb-quiet">—</span>}
                  </div>
                </td>
                <td className="tb-dispo">{r.dispo ? DISPO_LABELS[r.dispo] : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TrackingBoard(props: TrackingBoardProps) {
  const { view } = props;
  const active = view.board.filter((r) => r.flowStatus !== 'Departed');
  const byEsi = [1, 2, 3, 4, 5].map((e) => active.filter((r) => r.esi === e).length);
  const waiting = active.filter((r) => r.flowStatus === 'Waiting' || r.flowStatus === 'In triage').length;
  return (
    <div className="tb-screen" onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div className="tb-frame">
        <div className="tb-header">
          <div className="tb-title">
            <span className="tb-logo">✚</span>
            <div>
              <div className="tb-h1">Emergency Department — Tracking Board</div>
              <div className="tb-h2">Grand Therapies MC · {view.mapTitle}</div>
            </div>
          </div>
          <div className="tb-census">
            <div className="tb-stat">
              <b>{active.length}</b>
              <span>in dept</span>
            </div>
            <div className="tb-stat">
              <b>{waiting}</b>
              <span>waiting</span>
            </div>
            <div className="tb-esibar">
              {byEsi.map((n, i) => (
                <span key={i} className={`tb-esi tb-esi-${i + 1}`} title={`ESI ${i + 1}`}>
                  {n}
                </span>
              ))}
            </div>
          </div>
          <div className="tb-clock">{clockAt(view.clockStart, view.t)}</div>
          {props.onClose && (
            <button className="tb-close" onClick={props.onClose} title="Close (Tab / Esc)">
              ✕
            </button>
          )}
        </div>
        <BoardTable view={view} variant="dark" onOpenChart={props.onOpenChart} />
        <div className="tb-legend">
          <span>
            <span className="tb-ic tb-ic-crit">!!</span> critical
          </span>
          <span>
            <span className="tb-ic tb-ic-new">NEW</span> new results
          </span>
          <span>
            <span className="tb-ic tb-ic-lab">LAB</span> labs pending
          </span>
          <span>
            <span className="tb-ic tb-ic-img">IMG</span> imaging pending
          </span>
          <span>⚠ safety alert</span>
          <span className="tb-hint">
            Click a row to open the chart · <kbd>Tab</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

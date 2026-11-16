import { useState } from 'react';
import { classNames } from '../util';
import { browserDemo } from '../../../demo/mode';
import type { SectionProps } from './common';

const STEPS = ['Ordered', 'Scheduled', 'In progress', 'Completed', 'Preliminary', 'Final'];

export function Imaging(p: SectionProps) {
  const { chart, fmt } = p;
  const studies = [...chart.imaging].sort((a, b) => b.orderedAt - a.orderedAt);
  const [sel, setSel] = useState<string | undefined>(studies[0]?.id);
  const [pacs, setPacs] = useState(false);
  const s = studies.find((x) => x.id === sel) ?? studies[0];

  if (!s)
    return (
      <div className="ehr-card">
        <div className="ehr-empty big">No imaging ordered for this encounter.</div>
        {!browserDemo && <button className="ehr-btn primary" onClick={() => p.openOrderEntry()}>
          + New order
        </button>}
      </div>
    );

  const step = STEPS.indexOf(s.status);
  const hasReport = s.status === 'Preliminary' || s.status === 'Final';

  return (
    <div className="ehr-split">
      <div className="ehr-split-list">
        {studies.map((x) => (
          <button key={x.id} className={classNames('ehr-study', x.id === s.id && 'on')} onClick={() => setSel(x.id)}>
            <span className={`ehr-mod ehr-mod-${x.modality}`}>{x.modality}</span>
            <span className="ehr-study-name">{x.name}</span>
            <span className={`ehr-status s-${x.status.replace(/\s+/g, '-').toLowerCase()}`}>{x.status}</span>
            <span className="ehr-dim ehr-small">ordered {fmt(x.orderedAt)}</span>
          </button>
        ))}
      </div>
      <div className="ehr-split-main">
        <div className="ehr-card">
          <div className="ehr-card-h">
            {s.name}
            <span className="ehr-card-sub">Accession {s.id.toUpperCase()}</span>
            {!browserDemo && <button className="ehr-btn small" onClick={() => setPacs(true)} disabled={s.status === 'Ordered' || s.status === 'Scheduled' || s.status === 'Canceled'}>
              View images
            </button>}
          </div>
          {s.status !== 'Canceled' && (
            <div className="ehr-steps">
              {STEPS.map((x, i) => (
                <div key={x} className={classNames('ehr-step', i <= step && 'done', i === step && 'cur')}>
                  <span className="ehr-step-dot" />
                  {x}
                </div>
              ))}
            </div>
          )}
          <div className="ehr-kv">
            <span>Ordered</span>
            <b>{fmt(s.orderedAt)}</b>
          </div>
          <div className="ehr-kv">
            <span>Performed</span>
            <b>{s.performedAt !== undefined ? fmt(s.performedAt) : '—'}</b>
          </div>
          <div className="ehr-kv">
            <span>Reported</span>
            <b>{s.reportedAt !== undefined ? `${fmt(s.reportedAt)}${s.radiologist ? ' · ' + s.radiologist : ''}` : '—'}</b>
          </div>
        </div>
        {hasReport ? (
          <div className="ehr-card ehr-report">
            <div className="ehr-report-h">{s.status === 'Preliminary' ? 'PRELIMINARY REPORT' : 'FINAL REPORT'}</div>
            <div className="ehr-report-sec">EXAM</div>
            <div>{s.name}</div>
            <div className="ehr-report-sec">FINDINGS</div>
            <div className="ehr-pre">{s.findings ?? '—'}</div>
            <div className="ehr-report-sec">IMPRESSION</div>
            <div className="ehr-pre ehr-impression">{s.impression ?? '—'}</div>
            {s.radiologist && <div className="ehr-dim ehr-sign">Electronically signed by {s.radiologist}</div>}
          </div>
        ) : (
          <div className="ehr-card">
            <div className="ehr-empty big">
              {s.status === 'Completed' ? 'Images acquired — awaiting radiologist read. You can call the reading room to discuss.' : s.status === 'Canceled' ? 'Study canceled.' : 'No report yet.'}
            </div>
          </div>
        )}
      </div>
      {pacs && (
        <div className="ehr-modal-back" onMouseDown={(e) => e.target === e.currentTarget && setPacs(false)}>
          <div className="ehr-pacs">
            <div className="ehr-pacs-bar">
              <span>AgentChart PACS · {s.name}</span>
              <span className="ehr-pacs-tools">
                {['W/L', 'Zoom', 'Pan', 'Measure', 'Cine', 'Invert'].map((t) => (
                  <button key={t} disabled>
                    {t}
                  </button>
                ))}
              </span>
              <button className="ehr-x light" onClick={() => setPacs(false)}>
                ✕
              </button>
            </div>
            <div className="ehr-pacs-body">
              <div className="ehr-pacs-thumbs">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="ehr-pacs-thumb" />
                ))}
              </div>
              <div className="ehr-pacs-view">
                <div className="ehr-pacs-msg">
                  <div className="ehr-pacs-icon">◩</div>
                  <b>PACS viewer not yet connected</b>
                  <p>Image review for this study will be available in a future release. Use the radiology report, or call the reading room to review the images with the radiologist.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
